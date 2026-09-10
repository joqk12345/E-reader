import { useEffect, useMemo, useRef, useState } from 'react';
import { open as openExternal } from '@tauri-apps/plugin-shell';
import 'foliate-js/view.js';
import { useStore } from '../../../store/useStore';
import { PanelButton } from '../../../components/ui/Button';
import { DEFAULT_VIEW_SETTINGS, READER_THEMES } from '../../../components/readerTheme';
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
  getFoliateLocatorQuote,
  getTocSubitems,
  isAllowedExternalLink,
  type FoliateRelocation,
  type FoliateTocItem,
} from './foliateModel';
import {
  getPublicationPositionV2,
  savePublicationPositionV2,
} from '../locator/publicationPosition';
import type { PublicationLocatorV1 } from '../locator/publicationLocator';

type FoliateBook = {
  toc?: FoliateTocItem[];
  dir?: 'ltr' | 'rtl';
  rendition?: { layout?: string };
  sections?: Array<{ id?: string }>;
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
const FOLIATE_THEME = READER_THEMES.sepia;
const FOLIATE_RENDERER_PREFERENCES = {
  gap: '5%',
  margin: '48px',
  maxInlineSize: '720px',
  maxColumnCount: '2',
} as const;

const applyRendererPreferences = (
  view: FoliateViewElement,
  flow: 'paginated' | 'scrolled'
) => {
  const renderer = view.renderer;
  if (!renderer) return;
  renderer.setAttribute('flow', flow);
  renderer.setAttribute('gap', FOLIATE_RENDERER_PREFERENCES.gap);
  renderer.setAttribute('margin', FOLIATE_RENDERER_PREFERENCES.margin);
  renderer.setAttribute('max-inline-size', FOLIATE_RENDERER_PREFERENCES.maxInlineSize);
  renderer.setAttribute('max-column-count', FOLIATE_RENDERER_PREFERENCES.maxColumnCount);
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
            <PanelButton
              type="button"
              disabled={!item.href}
              onClick={() => item.href && onNavigate(item.href)}
              className="w-full rounded-md px-2 py-1.5 text-left text-size-subheading text-secondary hover:bg-surface-subtle disabled:cursor-default disabled:text-faint"
              style={{ paddingInlineStart: `calc(var(--toc-indent) + ${depth} * var(--toc-indent-step))` }}
            >
              {item.label?.trim() || 'Untitled'}
            </PanelButton>
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
    let currentHref: string | null = null;
    let lastPositionUpdatedAt = 0;
    const securityProbeTimers = new Set<number>();
    const view = window.document.createElement('foliate-view') as FoliateViewElement;
    view.className = 'block h-full w-full bg-surface-subtle';
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
      const { doc, index } = (event as FoliateLoadEvent).detail;
      const sectionHref = view.book?.sections?.[index]?.id;
      if (sectionHref) currentHref = sectionHref.split(/[?#]/u, 1)[0];
      const style = doc.createElement('style');
      style.dataset.readerSpike = 'foliate';
      style.textContent = `
        :root { color-scheme: light; }
        body {
          background: ${FOLIATE_THEME.background};
          color: ${FOLIATE_THEME.foreground};
          font-family: Charter, "Source Serif 4", Georgia, serif;
          font-size: ${DEFAULT_VIEW_SETTINGS.fontSize}px;
          line-height: ${DEFAULT_VIEW_SETTINGS.lineHeight};
        }
        a { color: ${FOLIATE_THEME.link}; }
        img, svg, video { max-inline-size: 100%; block-size: auto; }
        ::selection { background: ${FOLIATE_THEME.secondary}; color: ${FOLIATE_THEME.foreground}; }
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
      const session = bookSession;
      const href = currentHref || detail.tocItem?.href?.split(/[?#]/u, 1)[0] || null;
      if (session?.publicationId && session.sourceHash && href && detail.cfi) {
        const updatedAt = Math.max(Date.now(), lastPositionUpdatedAt + 1);
        lastPositionUpdatedAt = updatedAt;
        const locator: PublicationLocatorV1 = {
          schemaVersion: 1,
          publicationId: session.publicationId,
          sourceHash: session.sourceHash,
          href,
          locations: {
            cfi: detail.cfi,
            totalProgression:
              typeof detail.fraction === 'number' && Number.isFinite(detail.fraction)
                ? detail.fraction
                : undefined,
          },
          text: detail.range ? getFoliateLocatorQuote(detail.range) : undefined,
        };
        void savePublicationPositionV2(
          selectedDocument.id,
          locator,
          {
            progression:
              typeof detail.fraction === 'number' && Number.isFinite(detail.fraction)
                ? detail.fraction
                : null,
            updatedAt,
          }
        ).catch((cause: unknown) => {
          if (!disposed) console.warn('Failed to persist EPUB reading position:', cause);
        });
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
        let lastLocation = localStorage.getItem(foliatePositionKey(selectedDocument.id)) || undefined;
        if (openedSession.publicationId && openedSession.sourceHash) {
          const persistedPosition = await getPublicationPositionV2(selectedDocument.id);
          lastLocation = persistedPosition?.locator.locations.cfi || lastLocation;
          if (persistedPosition) lastPositionUpdatedAt = persistedPosition.updatedAt;
        }
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
    <div className="flex h-screen min-h-0 flex-col bg-surface-subtle text-foreground">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-surface px-3">
        <PanelButton
          type="button"
          onClick={goBack}
          className="rounded-md border border-control-border px-2.5 py-1.5 text-size-subheading hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          ← Library
        </PanelButton>
        <div className="min-w-0 flex-1">
          <div className="truncate text-size-subheading font-semibold text-heading">{selectedDocument.title}</div>
          <div className="truncate text-size-caption text-muted">
            foliate-js spike{locationLabel ? ` · ${locationLabel}` : ''}
            {securityProbe
              ? ` · security probe ${securityProbe.passed ? 'PASS' : 'FAIL'}`
              : ''}
          </div>
        </div>
        <div className="inline-flex rounded-md border border-control-border p-0.5">
          {(['paginated', 'scrolled'] as const).map((value) => (
            <PanelButton
              key={value}
              type="button"
              onClick={() => setFlow(value)}
              className={`rounded px-2 py-1 text-size-caption ${
                flow === value ? 'bg-action text-on-action' : 'text-navigation hover:bg-surface-subtle'
              }`}
            >
              {value === 'paginated' ? 'Pages' : 'Scroll'}
            </PanelButton>
          ))}
        </div>
        <PanelButton
          type="button"
          onClick={() => void viewRef.current?.prev()}
          className="rounded-md border border-control-border px-2.5 py-1.5 text-size-subheading hover:bg-surface-subtle"
          aria-label="Previous page"
        >
          ←
        </PanelButton>
        <PanelButton
          type="button"
          onClick={() => void viewRef.current?.next()}
          className="rounded-md border border-control-border px-2.5 py-1.5 text-size-subheading hover:bg-surface-subtle"
          aria-label="Next page"
        >
          →
        </PanelButton>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="w-64 shrink-0 overflow-y-auto border-r border-border bg-surface p-2" aria-label="Table of contents">
          <div className="reader-meta-label px-2 py-2 text-size-caption font-semibold uppercase text-muted">
            Contents
          </div>
          {toc.length > 0 ? (
            <TocBranch items={toc} onNavigate={navigate} />
          ) : (
            <p className="px-2 py-3 text-size-subheading text-muted">
              {loading ? 'Loading contents…' : 'No table of contents'}
            </p>
          )}
        </aside>

        <main className="relative min-w-0 flex-1 overflow-hidden bg-surface-subtle">
          <div ref={hostRef} className="h-full w-full" />
          {loading && (
            <div className="absolute inset-0 grid place-items-center bg-surface-subtle/90 text-size-subheading text-secondary">
              Opening EPUB with foliate-js…
            </div>
          )}
          {error && (
            <div className="absolute inset-0 grid place-items-center bg-surface-subtle p-8">
              <div className="reader-ai-card max-w-lg border border-danger/25 bg-danger-subtle text-size-subheading text-danger">
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
