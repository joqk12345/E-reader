import { useEffect, useMemo, useRef, useState } from 'react';
import { matchesAnyShortcut } from '../../../utils/shortcuts';
import { open as openExternal } from '@tauri-apps/plugin-shell';
import 'foliate-js/view.js';
import { useStore } from '../../../store/useStore';
import { PanelButton } from '../../../components/ui/Button';
import { ReaderRange, ReaderSelect } from '../../../components/ui/ReaderControls';
import { ToolPanel } from '../../../components/ToolPanel';
import { DEFAULT_VIEW_SETTINGS, READER_THEMES, type ReaderViewSettings } from '../../../components/readerTheme';
import { useReaderViewSettings } from '../useReaderViewSettings';
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
const FOLIATE_RENDERER_PREFERENCES = {
  gap: '5%',
  margin: '48px',
  maxInlineSize: '720px',
  maxColumnCount: '2',
} as const;

const applyAudioHighlight = (doc: Document, sentence: string) => {
  const target = sentence.trim();
  const view = doc.defaultView as (Window & { CSS?: { highlights?: { delete: (name: string) => void; set: (name: string, value: unknown) => void } };
  Highlight?: new (range: Range) => unknown }) | null;
  const highlights = view?.CSS?.highlights;
  highlights?.delete('reader-audio-highlight');
  if (!target || !doc.body) return;

  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    if (!node.parentElement?.closest('script,style,nav')) nodes.push(node);
  }
  const fullText = nodes.map((item) => item.data).join('');
  const start = fullText.indexOf(target);
  if (start < 0) return;
  let offset = 0;
  let startNode: Text | null = null;
  let endNode: Text | null = null;
  let startOffset = 0;
  let endOffset = 0;
  for (const item of nodes) {
    const nextOffset = offset + item.data.length;
    if (!startNode && start >= offset && start < nextOffset) {
      startNode = item;
      startOffset = start - offset;
    }
    const end = start + target.length;
    if (end > offset && end <= nextOffset) {
      endNode = item;
      endOffset = end - offset;
      break;
    }
    offset = nextOffset;
  }
  if (!startNode || !endNode) return;
  const range = doc.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  if (highlights && view?.Highlight) {
    highlights.set('reader-audio-highlight', new view.Highlight(range));
    return;
  }
  if (startNode === endNode && !startNode.parentElement?.closest('script,style,nav')) {
    const mark = doc.createElement('span');
    mark.dataset.readerAudioHighlight = 'true';
    mark.className = 'reader-audio-highlight';
    try {
      range.surroundContents(mark);
    } catch {
      // Preserve complex EPUB markup if the fallback range cannot be wrapped.
    }
  }
};

const applyDocumentPreferences = (doc: Document, settings: ReaderViewSettings) => {
  const theme = READER_THEMES[settings.theme];
  let style = doc.head.querySelector<HTMLStyleElement>('style[data-reader-settings]');
  if (!style) {
    style = doc.createElement('style');
    style.dataset.readerSettings = 'foliate';
    doc.head.append(style);
  }
  style.textContent = `
    :root {
      color-scheme: ${theme.isDark ? 'dark' : 'light'};
      --reader-audio-highlight-bg: ${theme.link};
      --reader-audio-highlight-fg: ${theme.background};
    }
    body {
      background: ${theme.background};
      color: ${theme.foreground};
      font-family: Charter, "Source Serif 4", Georgia, "Noto Serif CJK SC", "Songti SC", STSong, serif;
      font-size: ${settings.fontSize}px;
      line-height: ${settings.lineHeight};
      max-width: ${settings.contentWidth}ch;
      margin-inline: auto;
      letter-spacing: ${settings.cjkLetterSpacingEnabled ? settings.cjkLetterSpacing : 0}em;
    }
    a { color: ${theme.link}; }
    ::selection { background: ${theme.secondary}; color: ${theme.foreground}; }
  `;
};

const applyRendererPreferences = (
  view: FoliateViewElement,
  flow: 'paginated' | 'scrolled',
  settings: ReaderViewSettings
) => {
  const renderer = view.renderer;
  if (!renderer) return;
  renderer.setAttribute('flow', flow);
  renderer.setAttribute('gap', FOLIATE_RENDERER_PREFERENCES.gap);
  renderer.setAttribute('margin', FOLIATE_RENDERER_PREFERENCES.margin);
  renderer.setAttribute('max-inline-size', FOLIATE_RENDERER_PREFERENCES.maxInlineSize);
  renderer.setAttribute('max-column-count', settings.layoutMode === 'double' ? FOLIATE_RENDERER_PREFERENCES.maxColumnCount : '1');
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
  const publicationBlocks = useStore((state) => state.publicationBlocks);
  const keymap = useStore((state) => state.keymap);
  const goBack = useStore((state) => state.goBack);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<FoliateViewElement | null>(null);
  const [toc, setToc] = useState<FoliateTocItem[]>([]);
  const [flow, setFlow] = useState<'paginated' | 'scrolled'>('paginated');
  const [tocOpen, setTocOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toolOpen, setToolOpen] = useState(false);
  const [toolWidth, setToolWidth] = useState(320);
  const [selectedText, setSelectedText] = useState('');
  const [readerFontSize, setReaderFontSize] = useState(DEFAULT_VIEW_SETTINGS.fontSize);
  const { viewSettings, setViewSettings } = useReaderViewSettings(readerFontSize, setReaderFontSize);
  const loadedDocumentsRef = useRef<Set<Document>>(new Set());
  const selectionDocumentsRef = useRef<Set<Document>>(new Set());
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
    if (view) applyRendererPreferences(view, flow, viewSettings);
  }, [flow, viewSettings]);

  useEffect(() => {
    loadedDocumentsRef.current.forEach((doc) => applyDocumentPreferences(doc, viewSettings));
  }, [viewSettings]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, button, [contenteditable="true"]')) return;
      if (matchesAnyShortcut(event, keymap.next_page)) {
        event.preventDefault();
        void viewRef.current?.next();
      } else if (matchesAnyShortcut(event, keymap.prev_page)) {
        event.preventDefault();
        void viewRef.current?.prev();
      }
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [keymap]);

  useEffect(() => {
    const onAudioState = (event: Event) => {
      const detail = (event as CustomEvent<{ currentSentence?: string }>).detail;
      loadedDocumentsRef.current.forEach((doc) => applyAudioHighlight(doc, detail?.currentSentence || ''));
    };
    window.addEventListener('reader:audiobook-state', onAudioState as EventListener);
    return () => window.removeEventListener('reader:audiobook-state', onAudioState as EventListener);
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !selectedDocument || selectedDocument.file_type !== 'epub') return;

    let disposed = false;
    let bookSession: TauriEpubBookSession | null = null;
    let currentHref: string | null = null;
    const onDocumentKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, button, [contenteditable="true"]')) return;
      if (matchesAnyShortcut(event, keymap.next_page)) {
        event.preventDefault();
        void viewRef.current?.next();
      } else if (matchesAnyShortcut(event, keymap.prev_page)) {
        event.preventDefault();
        void viewRef.current?.prev();
      }
    };
    let lastPositionUpdatedAt = 0;
    const selectionListeners = new Map<Document, { onSelectionChange: () => void; onMouseUp: () => void }>();
    const updateSelection = (doc: Document) => {
      const text = doc.getSelection()?.toString().trim().slice(0, 300) || '';
      if (!disposed) setSelectedText(text);
    };
    const securityProbeTimers = new Set<number>();
    const view = window.document.createElement('foliate-view') as FoliateViewElement;
    view.className = 'block h-full w-full bg-surface-subtle';
    view.setAttribute('aria-label', `EPUB reader: ${selectedDocument.title}`);
    host.replaceChildren(view);
    viewRef.current = view;
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      const narrow = host.clientWidth < 760;
      view.dataset.narrow = narrow ? 'true' : 'false';
      applyRendererPreferences(view, flow, {
        ...viewSettings,
        layoutMode: narrow ? 'single' : viewSettings.layoutMode,
      });
    });
    resizeObserver?.observe(host);
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
      loadedDocumentsRef.current.add(doc);
      const onSelectionChange = () => updateSelection(doc);
      const onMouseUp = () => updateSelection(doc);
      selectionListeners.set(doc, { onSelectionChange, onMouseUp });
      selectionDocumentsRef.current.add(doc);
      doc.addEventListener('selectionchange', onSelectionChange);
      doc.addEventListener('mouseup', onMouseUp);
      doc.addEventListener('keydown', onDocumentKeyDown, { capture: true });
      applyDocumentPreferences(doc, viewSettings);
      const mediaStyle = doc.createElement('style');
      mediaStyle.dataset.readerMedia = 'foliate';
      mediaStyle.textContent = `
        img, svg, video { max-inline-size: 100%; block-size: auto; }
        ::highlight(reader-audio-highlight), .reader-audio-highlight {
          background: var(--reader-audio-highlight-bg);
          color: var(--reader-audio-highlight-fg);
          text-decoration: underline;
          text-decoration-thickness: 0.12em;
        }
      `;
      doc.head.append(mediaStyle);

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
        applyRendererPreferences(view, 'paginated', viewSettings);
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
      selectionListeners.forEach(({ onSelectionChange, onMouseUp }, doc) => {
        doc.removeEventListener('selectionchange', onSelectionChange);
        doc.removeEventListener('mouseup', onMouseUp);
        doc.removeEventListener('keydown', onDocumentKeyDown, { capture: true });
        doc.getSelection()?.removeAllRanges();
        loadedDocumentsRef.current.delete(doc);
        selectionDocumentsRef.current.delete(doc);
      });
      selectionListeners.clear();
      setSelectedText('');
      resizeObserver?.disconnect();
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
  }, [keymap, selectedDocument, viewSettings]);

  const navigate = (href: string) => {
    void viewRef.current?.goTo(href);
  };

  if (!selectedDocument) return null;

  return (
    <div data-testid="foliate-epub-reader" className="flex h-screen min-h-0 flex-col bg-surface-subtle text-foreground">
      <header className="flex h-12 shrink-0 items-center gap-3 overflow-x-auto border-b border-border bg-surface px-3">
        <PanelButton
          type="button"
          onClick={goBack}
          className="rounded-md border border-control-border px-2.5 py-1.5 text-size-subheading hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          ← Library
        </PanelButton>
        <PanelButton
          type="button"
          onClick={() => setTocOpen((open) => !open)}
          className="rounded-md border border-control-border px-2.5 py-1.5 text-size-caption text-navigation hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          aria-expanded={tocOpen}
          aria-label={tocOpen ? 'Collapse contents' : 'Expand contents'}
        >
          {tocOpen ? 'Hide contents' : 'Show contents'}
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
        <PanelButton
          type="button"
          onClick={() => setToolOpen((open) => !open)}
          className="rounded-md border border-control-border px-2.5 py-1.5 text-size-caption text-navigation hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          aria-expanded={toolOpen}
          aria-label="Reader tools"
        >
          Tools
        </PanelButton>
        <PanelButton
          type="button"
          onClick={() => setSettingsOpen((open) => !open)}
          className="rounded-md border border-control-border px-2.5 py-1.5 text-size-caption text-navigation hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          aria-expanded={settingsOpen}
          aria-label="Reader settings"
        >
          Settings
        </PanelButton>
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

      {settingsOpen && (
        <section aria-label="Reader settings" className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-surface px-3 py-2 text-size-caption">
          <label className="inline-flex items-center gap-2 text-secondary">
            Reading theme
            <ReaderSelect
              aria-label="Reading theme"
              value={viewSettings.theme}
              onChange={(event) => setViewSettings((current) => ({ ...current, theme: event.target.value as ReaderViewSettings['theme'] }))}
            >
              {Object.keys(READER_THEMES).map((theme) => <option key={theme} value={theme}>{theme}</option>)}
            </ReaderSelect>
          </label>
          <label className="inline-flex items-center gap-2 text-secondary">
            Text size
            <ReaderRange aria-label="Text size" type="range" min="12" max="30" step="1" value={viewSettings.fontSize} onChange={(event) => setViewSettings((current) => ({ ...current, fontSize: Number(event.target.value) }))} />
          </label>
          <label className="inline-flex items-center gap-2 text-secondary">
            Line height
            <ReaderRange aria-label="Line height" type="range" min="1.2" max="2.4" step="0.1" value={viewSettings.lineHeight} onChange={(event) => setViewSettings((current) => ({ ...current, lineHeight: Number(event.target.value) }))} />
          </label>
          <label className="inline-flex items-center gap-2 text-secondary">
            Text width
            <ReaderRange aria-label="Text width" type="range" min="36" max="120" step="1" value={viewSettings.contentWidth} onChange={(event) => setViewSettings((current) => ({ ...current, contentWidth: Number(event.target.value) }))} />
          </label>
        </section>
      )}

      <div className="flex min-h-0 flex-1">
        {tocOpen && (
          <aside className="reader-foliate-toc w-64 shrink-0 overflow-y-auto border-r border-border bg-surface p-2" aria-label="Table of contents">
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
        )}

        <main className="relative min-w-0 flex-1 overflow-auto bg-surface-subtle">
          <div ref={hostRef} className="h-full w-full" />
          {selectedText && (
            <div className="absolute inset-x-3 bottom-3 z-10 flex items-center gap-2 rounded-md border border-border bg-surface p-2 shadow-panel" aria-label="Selection actions">
              <span className="min-w-0 flex-1 truncate text-size-caption text-secondary">{selectedText}</span>
              <PanelButton
                type="button"
                aria-label="Close selection actions"
                onClick={() => {
                  selectionDocumentsRef.current.forEach((doc) => doc.getSelection()?.removeAllRanges());
                  setSelectedText('');
                }}
              >
                Close
              </PanelButton>
              <PanelButton type="button" onClick={() => { setToolOpen(true); window.dispatchEvent(new CustomEvent('reader:open-understand', { detail: { mode: 'simple', selectedText } })); }}>Understand</PanelButton>
              <PanelButton type="button" onClick={() => { setToolOpen(true); window.dispatchEvent(new CustomEvent('reader:translate-selection', { detail: { selectedText, autoRun: true } })); }}>Translate</PanelButton>
              <PanelButton type="button" onClick={() => { setToolOpen(true); window.dispatchEvent(new CustomEvent('reader:chat-explain', { detail: { selectedText } })); }}>Chat</PanelButton>
              <PanelButton
                type="button"
                onClick={() => {
                  setToolOpen(true);
                  const block = publicationBlocks.find((candidate) =>
                    candidate.plainText.toLocaleLowerCase().includes(selectedText.toLocaleLowerCase()),
                  );
                  window.dispatchEvent(new CustomEvent('reader:take-note', { detail: {
                    docId: selectedDocument.id,
                    paragraphId: block?.id,
                    selectedText,
                  } }));
                }}
              >
                Note
              </PanelButton>
              <PanelButton type="button" onClick={() => { setToolOpen(true); window.dispatchEvent(new CustomEvent('reader:open-annotations')); }}>Mark</PanelButton>
              <PanelButton
                type="button"
                onClick={() => {
                  setToolOpen(true);
                  const block = publicationBlocks.find((candidate) =>
                    candidate.plainText.toLocaleLowerCase().includes(selectedText.toLocaleLowerCase()),
                  );
                  window.dispatchEvent(new CustomEvent('reader:open-audiobook'));
                  window.setTimeout(() => {
                    window.dispatchEvent(new CustomEvent('reader:audiobook-start', {
                      detail: block ? { paragraphId: block.id, selectedText } : { selectedText },
                    }));
                  }, 0);
                }}
              >
                Audio
              </PanelButton>
            </div>
          )}
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
        {toolOpen && (
          <aside className="shrink-0 border-l border-border bg-surface" style={{ width: `${toolWidth}px` }} aria-label="Reader tools">
            <ToolPanel
              collapsed={false}
              width={toolWidth}
              minWidth={280}
              maxWidth={460}
              onToggleCollapse={() => setToolOpen(false)}
              onWidthChange={setToolWidth}
            />
          </aside>
        )}
      </div>
    </div>
  );
}
