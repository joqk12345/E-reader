import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { open as openExternal } from '@tauri-apps/plugin-shell';
import { useStore } from '../store/useStore';
import { matchesAnyShortcut } from '../utils/shortcuts';
import { TOCPanel } from './TOCPanel';
import { ReaderContent } from './ReaderContent';
import { ToolPanel } from './ToolPanel';
import { FloatingAudiobookControl } from './FloatingAudiobookControl';
import { loadReaderViewSettings } from './readerTheme';
import { useReaderPanelLayout } from '../features/reader/useReaderPanelLayout';

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  return target.isContentEditable;
};

export function Reader() {
  const {
    documents,
    selectedDocumentId,
    currentDocumentType,
    loadSections,
    loadDocumentParagraphs,
    goBack,
    sections,
    currentSectionId,
    paragraphs,
    selectSection,
    loadParagraphs,
    setFocusedParagraphId,
    translationMode,
    cycleTranslationMode,
    keymap,
    readerFontSize,
  } = useStore();
  const [windowMaximized, setWindowMaximized] = useState(false);
  const [contentStats, setContentStats] = useState({
    sourceWords: 0,
    translatedWords: 0,
    paragraphCount: 0,
    currentPage: 1,
    totalPages: 1,
  });
  const [bilingualViewMode, setBilingualViewMode] = useState<'both' | 'source' | 'translation'>(
    () => loadReaderViewSettings(readerFontSize).bilingualViewMode
  );
  const [markdownRenderMode, setMarkdownRenderMode] = useState<'text' | 'multimedia'>(
    () => loadReaderViewSettings(readerFontSize).markdownRenderMode
  );
  const [readingViewMenuOpen, setReadingViewMenuOpen] = useState(false);
  const [sourceLinkMenuOpen, setSourceLinkMenuOpen] = useState(false);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const readingViewMenuRef = useRef<HTMLDivElement | null>(null);
  const sourceLinkMenuRef = useRef<HTMLDivElement | null>(null);
  const {
    tocCollapsed,
    setTocCollapsed,
    tocWidth,
    setTocWidth,
    headerToolsCollapsed,
    setHeaderToolsCollapsed,
    toolCollapsed,
    setToolCollapsed,
    toolWidth,
    setToolWidth,
    readingMode,
    toggleReadingMode,
    minTocWidth,
    maxTocWidth,
    minToolWidth,
    maxToolWidth,
  } = useReaderPanelLayout();
  const selectedDocument = useMemo(
    () => documents.find((doc) => doc.id === selectedDocumentId) || null,
    [documents, selectedDocumentId]
  );
  const showSourceLinkActions = Boolean(sourceUrl);

  const handleTocWidthChange = (width: number) => {
    setTocWidth(width);
  };

  const tocPanelProps = useMemo(
    () => ({
      collapsed: tocCollapsed,
      width: tocWidth,
      minWidth: minTocWidth,
      maxWidth: maxTocWidth,
      onToggleCollapse: () => setTocCollapsed((prev) => !prev),
      onWidthChange: handleTocWidthChange,
    }),
    [tocCollapsed, tocWidth]
  );

  const toolPanelProps = useMemo(
    () => ({
      collapsed: toolCollapsed,
      width: toolWidth,
      minWidth: minToolWidth,
      maxWidth: maxToolWidth,
      onToggleCollapse: () => setToolCollapsed((prev) => !prev),
      onWidthChange: (width: number) => setToolWidth(width),
    }),
    [toolCollapsed, toolWidth]
  );

  useEffect(() => {
    if (selectedDocumentId) {
      void loadSections(selectedDocumentId);
      if (currentDocumentType === 'markdown') {
        void loadDocumentParagraphs(selectedDocumentId);
      }
    }
  }, [selectedDocumentId, currentDocumentType, loadSections, loadDocumentParagraphs]);

  const handleFlipPage = useCallback(
    (direction: 'prev' | 'next') => {
      const pageFlipRequest = new CustomEvent<{ direction: 'prev' | 'next' }>(
        'reader:request-flip-page',
        {
          detail: { direction },
          cancelable: true,
        }
      );
      const shouldContinueSectionFlip = window.dispatchEvent(pageFlipRequest);
      if (!shouldContinueSectionFlip) {
        return;
      }

      if (sections.length === 0) return;
      const currentIndex = Math.max(
        0,
        sections.findIndex((section) => section.id === currentSectionId)
      );
      const delta = direction === 'next' ? 1 : -1;
      const nextIndex = Math.min(sections.length - 1, Math.max(0, currentIndex + delta));
      if (nextIndex === currentIndex) return;
      const nextSection = sections[nextIndex];
      if (!nextSection) return;

      selectSection(nextSection.id);
      if (currentDocumentType === 'markdown') {
        const firstParagraph = paragraphs.find((p) => p.section_id === nextSection.id);
        if (firstParagraph) {
          setFocusedParagraphId(firstParagraph.id);
        }
        return;
      }
      void loadParagraphs(nextSection.id);
    },
    [
      currentDocumentType,
      currentSectionId,
      loadParagraphs,
      paragraphs,
      sections,
      selectSection,
      setFocusedParagraphId,
    ]
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      if (matchesAnyShortcut(event, keymap.next_page)) {
        event.preventDefault();
        handleFlipPage('next');
      } else if (matchesAnyShortcut(event, keymap.prev_page)) {
        event.preventDefault();
        handleFlipPage('prev');
      } else if (matchesAnyShortcut(event, keymap.toggle_reading_mode)) {
        event.preventDefault();
        toggleReadingMode();
      } else if (matchesAnyShortcut(event, keymap.open_search)) {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent('reader:open-search'));
        window.dispatchEvent(new CustomEvent('reader:focus-search'));
      } else if (matchesAnyShortcut(event, keymap.audio_play)) {
        event.preventDefault();
        window.dispatchEvent(
          new CustomEvent('reader:audiobook-control', { detail: { action: 'play' } })
        );
      } else if (matchesAnyShortcut(event, keymap.audio_toggle_pause)) {
        event.preventDefault();
        window.dispatchEvent(
          new CustomEvent('reader:audiobook-control', { detail: { action: 'toggle-pause' } })
        );
      } else if (matchesAnyShortcut(event, keymap.audio_stop)) {
        event.preventDefault();
        window.dispatchEvent(
          new CustomEvent('reader:audiobook-control', { detail: { action: 'stop' } })
        );
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [handleFlipPage, keymap, toggleReadingMode]);

  useEffect(() => {
    const onNextPage = () => handleFlipPage('next');
    const onPrevPage = () => handleFlipPage('prev');
    const onToggleHeaderTools = () => setHeaderToolsCollapsed((prev) => !prev);
    const onToggleReadingMode = () => toggleReadingMode();

    window.addEventListener('reader:next-page', onNextPage as EventListener);
    window.addEventListener('reader:prev-page', onPrevPage as EventListener);
    window.addEventListener('reader:toggle-header-tools', onToggleHeaderTools as EventListener);
    window.addEventListener('reader:toggle-reading-mode', onToggleReadingMode as EventListener);

    return () => {
      window.removeEventListener('reader:next-page', onNextPage as EventListener);
      window.removeEventListener('reader:prev-page', onPrevPage as EventListener);
      window.removeEventListener(
        'reader:toggle-header-tools',
        onToggleHeaderTools as EventListener
      );
      window.removeEventListener(
        'reader:toggle-reading-mode',
        onToggleReadingMode as EventListener
      );
    };
  }, [handleFlipPage, toggleReadingMode]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    const syncMaximizedState = async () => {
      try {
        const appWindow = getCurrentWindow();
        const maximized = await appWindow.isMaximized();
        if (!cancelled) {
          setWindowMaximized(maximized);
        }
      } catch {
        if (!cancelled) {
          setWindowMaximized(false);
        }
      }
    };

    const bindWindowEvents = async () => {
      try {
        const appWindow = getCurrentWindow();
        await syncMaximizedState();
        unlisten = await appWindow.onResized(() => {
          void syncMaximizedState();
        });
      } catch {
        setWindowMaximized(false);
      }
    };

    void bindWindowEvents();

    return () => {
      cancelled = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  useEffect(() => {
    const onContentStats = (
      event: CustomEvent<{
        sourceWords?: number;
        translatedWords?: number;
        paragraphCount?: number;
        currentPage?: number;
        totalPages?: number;
      }>
    ) => {
      setContentStats({
        sourceWords: event.detail?.sourceWords || 0,
        translatedWords: event.detail?.translatedWords || 0,
        paragraphCount: event.detail?.paragraphCount || 0,
        currentPage: event.detail?.currentPage || 1,
        totalPages: event.detail?.totalPages || 1,
      });
    };
    window.addEventListener('reader:content-stats', onContentStats as EventListener);
    return () => window.removeEventListener('reader:content-stats', onContentStats as EventListener);
  }, []);

  useEffect(() => {
    const refresh = () => {
      const settings = loadReaderViewSettings(readerFontSize);
      setBilingualViewMode(settings.bilingualViewMode);
      setMarkdownRenderMode(settings.markdownRenderMode);
    };
    refresh();
    window.addEventListener('reader:view-settings-updated', refresh as EventListener);
    return () => window.removeEventListener('reader:view-settings-updated', refresh as EventListener);
  }, [readerFontSize]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (readingViewMenuRef.current && !readingViewMenuRef.current.contains(target)) {
        setReadingViewMenuOpen(false);
      }
      if (sourceLinkMenuRef.current && !sourceLinkMenuRef.current.contains(target)) {
        setSourceLinkMenuOpen(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setSourceLinkMenuOpen(false);

    if (!selectedDocumentId || !selectedDocument || selectedDocument.file_type !== 'markdown') {
      setSourceUrl(null);
      return;
    }

    void invoke<string | null>('get_document_source_url', { docId: selectedDocumentId })
      .then((value) => {
        if (cancelled) return;
        setSourceUrl(value?.trim() || null);
      })
      .catch(() => {
        if (!cancelled) {
          setSourceUrl(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedDocument, selectedDocumentId]);

  const setBilingualModeFromHeader = (mode: 'both' | 'source' | 'translation') => {
    window.dispatchEvent(
      new CustomEvent('reader:set-bilingual-view-mode', {
        detail: { mode },
      })
    );
    setBilingualViewMode(mode);
    setReadingViewMenuOpen(false);
  };

  const setMarkdownRenderModeFromHeader = (mode: 'text' | 'multimedia') => {
    window.dispatchEvent(
      new CustomEvent('reader:set-markdown-render-mode', {
        detail: { mode },
      })
    );
    setMarkdownRenderMode(mode);
    setReadingViewMenuOpen(false);
  };

  const headerPaddingClass = readingMode
    ? 'h-8 px-2 py-0'
    : windowMaximized
      ? 'px-6 py-0'
      : headerToolsCollapsed
        ? 'px-6 py-2'
        : 'px-6 py-4';
  const showCompactHeader = readingMode || headerToolsCollapsed;

  const openSourceUrlInBrowser = () => {
    const normalized = sourceUrl?.trim();
    if (!normalized) return;
    const isTauriRuntime =
      typeof window !== 'undefined' &&
      Object.prototype.hasOwnProperty.call(window, '__TAURI_INTERNALS__');
    if (!isTauriRuntime) {
      window.open(normalized, '_blank', 'noopener,noreferrer');
      return;
    }
    void openExternal(normalized).catch(() => {
      window.open(normalized, '_blank', 'noopener,noreferrer');
    });
  };

  const copySourceUrl = async () => {
    const normalized = sourceUrl?.trim();
    if (!normalized) return;
    try {
      await navigator.clipboard.writeText(normalized);
      return;
    } catch {
      const textArea = document.createElement('textarea');
      textArea.value = normalized;
      textArea.setAttribute('readonly', '');
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
      } finally {
        document.body.removeChild(textArea);
      }
    }
  };

  const openChatPanel = () => {
    window.dispatchEvent(new CustomEvent('reader:open-chat'));
  };

  return (
    <div className="h-screen flex flex-col bg-surface">
      <header
        className={`relative flex items-center border-b ${readingMode ? 'border-transparent bg-surface/95' : 'border-border bg-surface'} transition-all ${headerPaddingClass}`}
      >
        <div className={`z-10 flex min-w-0 flex-1 items-center ${readingMode ? 'gap-1' : 'gap-3'}`}>
          {showCompactHeader && (
            <button
              onClick={goBack}
              className={`inline-flex items-center justify-center rounded-md border bg-surface hover:bg-surface-subtle focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-focus ${
                readingMode
                  ? 'h-6 w-6 border-border text-xs text-muted'
                  : 'h-8 w-8 border-control-border text-secondary'
              }`}
              title="Back to Library"
              aria-label="Back to Library"
            >
              ←
            </button>
          )}
          {!showCompactHeader && (
            <>
              <button
                onClick={goBack}
                className="px-4 py-2 text-sm font-medium text-secondary bg-surface border border-control-border rounded-md hover:bg-surface-subtle focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-focus"
              >
                ← Back to Library
              </button>
              <button
                onClick={() => void cycleTranslationMode()}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                  translationMode !== 'off'
                    ? 'bg-action text-on-action hover:bg-action-text'
                    : 'bg-surface-subtle text-secondary hover:bg-surface-hover'
                }`}
              >
                {translationMode === 'off'
                  ? '🌐 Translation: Off'
                  : translationMode === 'en-zh'
                    ? '🌐 Translation: EN→ZH'
                    : '🌐 Translation: ZH→EN'}
              </button>
              <div className="relative" ref={readingViewMenuRef}>
                <button
                  onClick={() => setReadingViewMenuOpen((prev) => !prev)}
                  className="px-3 py-2 text-sm font-medium text-secondary bg-surface-subtle rounded-md hover:bg-surface-hover"
                >
                  Reading View ▾
                </button>
                {readingViewMenuOpen && (
                  <div className="absolute left-0 top-11 z-40 min-w-[220px] rounded-lg border border-border bg-surface p-1.5 shadow-lg">
                    <button
                      onClick={() => setMarkdownRenderModeFromHeader('text')}
                      className={`flex w-full items-center justify-between rounded px-2.5 py-1.5 text-sm ${
                        markdownRenderMode === 'text'
                          ? 'bg-action-subtle text-action-text'
                          : 'text-secondary hover:bg-surface-subtle'
                      }`}
                    >
                      <span>Text Parse</span>
                      <span>{markdownRenderMode === 'text' ? '✓' : ''}</span>
                    </button>
                    <button
                      onClick={() => setMarkdownRenderModeFromHeader('multimedia')}
                      className={`flex w-full items-center justify-between rounded px-2.5 py-1.5 text-sm ${
                        markdownRenderMode === 'multimedia'
                          ? 'bg-action-subtle text-action-text'
                          : 'text-secondary hover:bg-surface-subtle'
                      }`}
                    >
                      <span>Multimedia Parse</span>
                      <span>{markdownRenderMode === 'multimedia' ? '✓' : ''}</span>
                    </button>
                    <div className="my-1 h-px bg-surface-hover" />
                    <button
                      onClick={() => setBilingualModeFromHeader('source')}
                      className={`flex w-full items-center justify-between rounded px-2.5 py-1.5 text-sm ${
                        bilingualViewMode === 'source'
                          ? 'bg-action-subtle text-action-text'
                          : 'text-secondary hover:bg-surface-subtle'
                      }`}
                    >
                      <span>Source Only</span>
                      <span>{bilingualViewMode === 'source' ? '✓' : ''}</span>
                    </button>
                    <button
                      onClick={() => setBilingualModeFromHeader('translation')}
                      disabled={translationMode === 'off'}
                      className={`flex w-full items-center justify-between rounded px-2.5 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${
                        bilingualViewMode === 'translation'
                          ? 'bg-action-subtle text-action-text'
                          : 'text-secondary hover:bg-surface-subtle'
                      }`}
                    >
                      <span>Translation Only</span>
                      <span>{bilingualViewMode === 'translation' ? '✓' : ''}</span>
                    </button>
                    <button
                      onClick={() => setBilingualModeFromHeader('both')}
                      disabled={translationMode === 'off'}
                      className={`flex w-full items-center justify-between rounded px-2.5 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${
                        bilingualViewMode === 'both'
                          ? 'bg-action-subtle text-action-text'
                          : 'text-secondary hover:bg-surface-subtle'
                      }`}
                    >
                      <span>Source + Translation</span>
                      <span>{bilingualViewMode === 'both' ? '✓' : ''}</span>
                    </button>
                    <div className="my-1 h-px bg-surface-hover" />
                    <button
                      onClick={() => {
                        window.dispatchEvent(new CustomEvent('reader:open-annotations'));
                        setReadingViewMenuOpen(false);
                      }}
                      className="flex w-full items-center justify-between rounded px-2.5 py-1.5 text-sm text-secondary hover:bg-surface-subtle"
                    >
                      <span>Open Annotations</span>
                      <span>→</span>
                    </button>
                    <button
                      onClick={() => {
                        openChatPanel();
                        setReadingViewMenuOpen(false);
                      }}
                      className="flex w-full items-center justify-between rounded px-2.5 py-1.5 text-sm text-secondary hover:bg-surface-subtle"
                    >
                      <span>Open Chat</span>
                      <span>→</span>
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {!readingMode && (
          <h1 className="pointer-events-none absolute left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 text-xl font-semibold text-heading">
            <img
              src="/reader-logo.svg"
              alt="Reader Logo"
              className="h-5 w-5 rounded-md border border-border bg-surface p-0.5"
            />
            <span>Reader</span>
          </h1>
        )}

        <div className="z-10 flex min-w-0 flex-1 items-center justify-end gap-2">
          {readingMode && selectedDocumentId && (
            <button
              onClick={openChatPanel}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border bg-surface text-xs text-muted hover:bg-surface-subtle"
              title="Open chat for current text"
              aria-label="Open chat for current text"
            >
              💬
            </button>
          )}
          {!readingMode && showSourceLinkActions && (
            <div className="relative" ref={sourceLinkMenuRef}>
              <button
                onClick={() => setSourceLinkMenuOpen((prev) => !prev)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-surface-hover text-foreground hover:bg-control-border"
                title="Imported link actions"
                aria-label="Imported link actions"
              >
                ⤴
              </button>
              {sourceLinkMenuOpen && (
                <div className="absolute right-0 top-11 z-40 min-w-[220px] rounded-2xl border border-control-border bg-surface-subtle p-1.5 shadow-lg">
                  <button
                    onClick={() => {
                      void copySourceUrl();
                      setSourceLinkMenuOpen(false);
                    }}
                    className="flex w-full items-center rounded-lg px-3 py-2 text-left text-[15px] leading-6 text-heading hover:bg-surface-hover/80"
                  >
                    Copy Link
                  </button>
                  <button
                    onClick={() => {
                      openSourceUrlInBrowser();
                      setSourceLinkMenuOpen(false);
                    }}
                    className="flex w-full items-center rounded-lg px-3 py-2 text-left text-[15px] leading-6 text-heading hover:bg-surface-hover/80"
                  >
                    Open in DefaultBrowser
                  </button>
                </div>
              )}
            </div>
          )}
          {readingMode ? (
            <button
              onClick={toggleReadingMode}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border bg-surface text-xs text-muted hover:bg-surface-subtle"
              title="Exit reading mode"
              aria-label="Exit reading mode"
            >
              ✕
            </button>
          ) : (
            <button
              onClick={() => setHeaderToolsCollapsed((prev) => !prev)}
              className="px-3 py-1.5 text-sm font-medium text-secondary bg-surface-subtle rounded-md hover:bg-surface-hover"
              title={headerToolsCollapsed ? 'Expand header tools' : 'Collapse header tools'}
              aria-label={headerToolsCollapsed ? 'Expand header tools' : 'Collapse header tools'}
            >
              {headerToolsCollapsed ? 'Tools: Show' : 'Tools: Hide'}
            </button>
          )}
        </div>
      </header>
      <div className="flex-1 flex overflow-hidden">
        <TOCPanel {...tocPanelProps} />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <ReaderContent />
          {!readingMode && (
            <div className="h-7 border-t border-border bg-surface px-3 text-[11px] text-navigation flex items-center justify-end overflow-x-auto whitespace-nowrap">
              <span>
                Word Stats: Source {contentStats.sourceWords} · Translation {contentStats.translatedWords} · Paragraphs {contentStats.paragraphCount} · Page {contentStats.currentPage}/{contentStats.totalPages}
              </span>
            </div>
          )}
        </div>
        <ToolPanel {...toolPanelProps} />
      </div>
      <FloatingAudiobookControl />
    </div>
  );
}
