import { useEffect, useMemo, useRef, useState } from 'react';
import { open as openExternal } from '@tauri-apps/plugin-shell';
import 'foliate-js/view.js';
import { useStore } from '../../../store/useStore';
import {
  openTauriEpubBookSession,
  type TauriEpubBookSession,
} from './TauriEpubBookSession';
import {
  evaluateActiveContentProbe,
  snapshotActiveContentProbe,
  type ActiveContentProbeResult,
} from './securityProbe';
import {
  foliatePositionKey,
  formatFoliateLocation,
  getTocSubitems,
  isAllowedExternalLink,
  type FoliateRelocation,
  type FoliateTocItem,
} from './foliateModel';

type FoliateBook = {
  toc?: FoliateTocItem[];
  dir?: 'ltr' | 'rtl';
  rendition?: { layout?: string };
};

type FoliateRenderer = HTMLElement & {
  next?: () => Promise<void>;
  prev?: () => Promise<void>;
};

type FoliateViewElement = HTMLElement & {
  book?: FoliateBook;
  renderer?: FoliateRenderer;
  lastLocation?: { cfi?: string; fraction?: number; location?: { current?: number; total?: number } };
  open: (book: FoliateBook) => Promise<void>;
  init: (options: { lastLocation?: string; showTextStart?: boolean }) => Promise<void>;
  goTo: (target: string | number) => Promise<void>;
  next: () => Promise<void>;
  prev: () => Promise<void>;
  close: () => void;
};

type FoliateLoadEvent = CustomEvent<{ doc: Document; index: number }>;
type FoliateRelocateEvent = CustomEvent<FoliateRelocation>;
type FoliateExternalLinkEvent = CustomEvent<{ href_?: string }>;

const FOLIATE_PERF_PROBE_ENABLED = import.meta.env.VITE_EPUB_PERF_PROBE === '1';

const applyRendererPreferences = (
  view: FoliateViewElement,
  flow: 'paginated' | 'scrolled'
) => {
  const renderer = view.renderer;
  if (!renderer) return;
  renderer.setAttribute('flow', flow);
  renderer.setAttribute('gap', '5%');
  renderer.setAttribute('margin', '48px');
  renderer.setAttribute('max-inline-size', '720px');
  renderer.setAttribute('max-column-count', '2');
};

function TocBranch({
  items,
  depth = 0,
  onNavigate,
}: {
  items: FoliateTocItem[];
  depth?: number;
  onNavigate: (href: string) => void;
}) {
  return (
    <ul className={depth === 0 ? 'space-y-1' : 'mt-1 space-y-1'}>
      {items.map((item, index) => {
        const children = getTocSubitems(item);
        const key = `${item.href || item.label || 'item'}-${depth}-${index}`;
        return (
          <li key={key}>
            <button
              type="button"
              disabled={!item.href}
              onClick={() => item.href && onNavigate(item.href)}
              className="w-full rounded-md px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100 disabled:cursor-default disabled:text-slate-400"
              style={{ paddingInlineStart: `${8 + depth * 14}px` }}
            >
              {item.label?.trim() || 'Untitled'}
            </button>
            {children.length > 0 && (
              <TocBranch items={children} depth={depth + 1} onNavigate={onNavigate} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function FoliateEpubSpikeReader() {
  const documents = useStore((state) => state.documents);
  const selectedDocumentId = useStore((state) => state.selectedDocumentId);
  const goBack = useStore((state) => state.goBack);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<FoliateViewElement | null>(null);
  const [toc, setToc] = useState<FoliateTocItem[]>([]);
  const [flow, setFlow] = useState<'paginated' | 'scrolled'>('paginated');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [locationLabel, setLocationLabel] = useState('');
  const [securityProbe, setSecurityProbe] = useState<ActiveContentProbeResult | null>(null);

  const selectedDocument = useMemo(
    () => documents.find((item) => item.id === selectedDocumentId) || null,
    [documents, selectedDocumentId]
  );

  useEffect(() => {
    const view = viewRef.current;
    if (view) applyRendererPreferences(view, flow);
  }, [flow]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !selectedDocument || selectedDocument.file_type !== 'epub') return;

    let disposed = false;
    let bookSession: TauriEpubBookSession | null = null;
    const securityProbeTimers = new Set<number>();
    const view = window.document.createElement('foliate-view') as FoliateViewElement;
    view.className = 'block h-full w-full bg-[#f9f0db]';
    view.setAttribute('aria-label', `EPUB reader: ${selectedDocument.title}`);
    host.replaceChildren(view);
    viewRef.current = view;
    setLoading(true);
    setError(null);
    setToc([]);
    setSecurityProbe(null);

    const persistLoadMetrics = (session: TauriEpubBookSession, reason: string) => {
      if (!FOLIATE_PERF_PROBE_ENABLED) return;
      const metrics = session.getMetrics();
      if (!metrics) return;
      const report = {
        schemaVersion: 1,
        documentId: selectedDocument.id,
        reason,
        observedAt: new Date().toISOString(),
        metrics,
      };
      localStorage.setItem(
        `reader:publication-load-metrics:${selectedDocument.id}`,
        JSON.stringify(report)
      );
      console.info('[Reader publication load metrics]', report);
    };

    const onLoad = (event: Event) => {
      const { doc } = (event as FoliateLoadEvent).detail;
      const style = doc.createElement('style');
      style.dataset.readerSpike = 'foliate';
      style.textContent = `
        :root { color-scheme: light; }
        body {
          background: #f9f0db;
          color: #392f25;
          font-family: Charter, "Source Serif 4", Georgia, serif;
          font-size: 18px;
          line-height: 1.75;
        }
        a { color: #7c4a21; }
        img, svg, video { max-inline-size: 100%; block-size: auto; }
        ::selection { background: #e7c995; color: #241c15; }
      `;
      doc.head.append(style);

      const detectedProbe = snapshotActiveContentProbe(doc);
      if (detectedProbe) {
        const timer = window.setTimeout(() => {
          securityProbeTimers.delete(timer);
          if (disposed) return;
          const snapshot = snapshotActiveContentProbe(doc);
          if (!snapshot) return;
          const result = evaluateActiveContentProbe(snapshot);
          localStorage.setItem(
            `reader:security-probe:${selectedDocument.id}:${result.fixtureId}`,
            JSON.stringify({ ...result, observedAt: new Date().toISOString() })
          );
          console.info('[Reader EPUB security probe]', result);
          setSecurityProbe(result);
        }, 1500);
        securityProbeTimers.add(timer);
      }
    };

    const onRelocate = (event: Event) => {
      const detail = (event as FoliateRelocateEvent).detail;
      if (detail.cfi) {
        localStorage.setItem(foliatePositionKey(selectedDocument.id), detail.cfi);
      }
      setLocationLabel(formatFoliateLocation(detail));
    };

    const onExternalLink = (event: Event) => {
      const linkEvent = event as FoliateExternalLinkEvent;
      linkEvent.preventDefault();
      const href = linkEvent.detail?.href_?.trim();
      if (href && isAllowedExternalLink(href)) void openExternal(href);
    };

    view.addEventListener('load', onLoad);
    view.addEventListener('relocate', onRelocate);
    view.addEventListener('external-link', onExternalLink);

    const openBook = async () => {
      try {
        const openedSession = await openTauriEpubBookSession(selectedDocument.id);
        if (disposed) {
          await openedSession.close();
          return;
        }
        bookSession = openedSession;
        await view.open(openedSession.book as FoliateBook);
        if (disposed) return;
        applyRendererPreferences(view, 'paginated');
        setToc(Array.isArray(view.book?.toc) ? view.book.toc : []);
        const lastLocation = localStorage.getItem(foliatePositionKey(selectedDocument.id)) || undefined;
        await view.init({ lastLocation, showTextStart: !lastLocation });
        persistLoadMetrics(openedSession, 'initialized');
        if (!disposed) setLoading(false);
      } catch (cause) {
        view.close();
        const failedSession = bookSession;
        bookSession = null;
        if (failedSession) {
          persistLoadMetrics(failedSession, 'reader-error');
          try {
            await failedSession.close();
          } catch (cleanupCause) {
            console.error('Failed to close publication session after reader error:', cleanupCause);
          }
        }
        if (disposed) return;
        setLoading(false);
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    };

    void openBook();

    return () => {
      disposed = true;
      view.removeEventListener('load', onLoad);
      view.removeEventListener('relocate', onRelocate);
      view.removeEventListener('external-link', onExternalLink);
      for (const timer of securityProbeTimers) window.clearTimeout(timer);
      securityProbeTimers.clear();
      view.close();
      const closingSession = bookSession;
      bookSession = null;
      if (closingSession) {
        persistLoadMetrics(closingSession, 'reader-close');
        void closingSession.close().catch((cause: unknown) => {
          console.error('Failed to close publication session:', cause);
        });
      }
      view.remove();
      if (viewRef.current === view) viewRef.current = null;
    };
  }, [selectedDocument]);

  const navigate = (href: string) => {
    void viewRef.current?.goTo(href);
  };

  if (!selectedDocument) return null;

  return (
    <div className="flex h-screen min-h-0 flex-col bg-slate-50 text-slate-900">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-3">
        <button
          type="button"
          onClick={goBack}
          className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          ← Library
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{selectedDocument.title}</div>
          <div className="truncate text-xs text-slate-500">
            foliate-js spike{locationLabel ? ` · ${locationLabel}` : ''}
            {securityProbe
              ? ` · security probe ${securityProbe.passed ? 'PASS' : 'FAIL'}`
              : ''}
          </div>
        </div>
        <div className="inline-flex rounded-md border border-slate-300 p-0.5">
          {(['paginated', 'scrolled'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setFlow(value)}
              className={`rounded px-2 py-1 text-xs ${
                flow === value ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {value === 'paginated' ? 'Pages' : 'Scroll'}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void viewRef.current?.prev()}
          className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm hover:bg-slate-50"
          aria-label="Previous page"
        >
          ←
        </button>
        <button
          type="button"
          onClick={() => void viewRef.current?.next()}
          className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm hover:bg-slate-50"
          aria-label="Next page"
        >
          →
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="w-64 shrink-0 overflow-y-auto border-r border-slate-200 bg-white p-2" aria-label="Table of contents">
          <div className="px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Contents
          </div>
          {toc.length > 0 ? (
            <TocBranch items={toc} onNavigate={navigate} />
          ) : (
            <p className="px-2 py-3 text-sm text-slate-500">
              {loading ? 'Loading contents…' : 'No table of contents'}
            </p>
          )}
        </aside>

        <main className="relative min-w-0 flex-1 overflow-hidden bg-[#f9f0db]">
          <div ref={hostRef} className="h-full w-full" />
          {loading && (
            <div className="absolute inset-0 grid place-items-center bg-[#f9f0db]/90 text-sm text-slate-600">
              Opening EPUB with foliate-js…
            </div>
          )}
          {error && (
            <div className="absolute inset-0 grid place-items-center bg-[#f9f0db] p-8">
              <div className="max-w-lg rounded-lg border border-rose-200 bg-white p-4 text-sm text-rose-800 shadow-sm">
                <div className="font-semibold">foliate-js could not open this EPUB</div>
                <p className="mt-2 break-words">{error}</p>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
