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
import { loadReaderViewSettings, type ReaderViewSettings } from './readerTheme';
import { useReaderPanelLayout } from '../features/reader/useReaderPanelLayout';
import { Button, type ButtonProps } from './ui/Button';

function ReaderButton({ variant = 'ghost', size = 'sm', ...props }: ButtonProps) {
  return <Button variant={variant} size={size} {...props} />;
}

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
      onToggleCollapse: () => {
        setTocCollapsed((prev) => {
          const next = !prev;
          if (!next) setToolCollapsed(true);
          return next;
        });
      },
      onWidthChange: handleTocWidthChange,
    }),
    [setTocCollapsed, setToolCollapsed, tocCollapsed, tocWidth]
  );

  const toggleToolPanel = useCallback(() => {
    setToolCollapsed((previous) => {
      const next = !previous;
      if (!next) setTocCollapsed(true);
      return next;
    });
  }, [setTocCollapsed, setToolCollapsed]);

  const toolPanelProps = useMemo(
    () => ({
      collapsed: toolCollapsed,
      width: toolWidth,
      minWidth: minToolWidth,
      maxWidth: maxToolWidth,
      onToggleCollapse: toggleToolPanel,
      onWidthChange: (width: number) => setToolWidth(width),
    }),
    [toggleToolPanel, toolCollapsed, toolWidth]
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
    const onToggleHeaderTools = () => {
      setSourceLinkMenuOpen(false);
      setReadingViewMenuOpen((previous) => !previous);
    };
    const onToggleReadingMode = () => toggleReadingMode();

    window.addEventListener('reader:next-page', onNextPage as EventListener);
    window.addEventListener('reader:prev-page', onPrevPage as EventListener);
    window.addEventListener('reader:toggle-view-menu', onToggleHeaderTools as EventListener);
    window.addEventListener('reader:toggle-header-tools', onToggleHeaderTools as EventListener);
    window.addEventListener('reader:toggle-reading-mode', onToggleReadingMode as EventListener);

    return () => {
      window.removeEventListener('reader:next-page', onNextPage as EventListener);
      window.removeEventListener('reader:prev-page', onPrevPage as EventListener);
      window.removeEventListener('reader:toggle-view-menu', onToggleHeaderTools as EventListener);
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
    const refresh = (event?: Event) => {
      const detail = event ? (event as CustomEvent<ReaderViewSettings>).detail : undefined;
      const settings = detail || loadReaderViewSettings(readerFontSize);
      setBilingualViewMode(settings.bilingualViewMode);
    };
    refresh();
    window.addEventListener('reader:view-settings-updated', refresh as EventListener);
    return () => window.removeEventListener('reader:view-settings-updated', refresh as EventListener);
  }, [readerFontSize]);

  useEffect(() => {
    if (!readingViewMenuOpen && !sourceLinkMenuOpen) return;
    const openMenu = readingViewMenuOpen ? readingViewMenuRef.current : sourceLinkMenuRef.current;
    const focusFrame = window.requestAnimationFrame(() => {
      openMenu?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    });
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
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as Node | null;
      if (!target || !openMenu?.contains(target)) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
        const items = Array.from(openMenu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') || []);
        if (items.length === 0) return;
        event.preventDefault();
        const currentIndex = items.findIndex((item) => item === document.activeElement);
        const nextIndex = event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? items.length - 1
            : event.key === 'ArrowDown'
              ? (currentIndex + 1 + items.length) % items.length
              : (currentIndex - 1 + items.length) % items.length;
        items[nextIndex]?.focus();
        return;
      }
      if (event.key !== 'Escape') return;
      event.preventDefault();
      const triggerId = readingViewMenuOpen ? 'reader-view-trigger' : 'reader-source-link-trigger';
      setReadingViewMenuOpen(false);
      setSourceLinkMenuOpen(false);
      window.requestAnimationFrame(() => document.getElementById(triggerId)?.focus());
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [readingViewMenuOpen, sourceLinkMenuOpen]);

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

  const headerPaddingClass = readingMode
    ? 'h-8 px-2 py-0'
    : windowMaximized
      ? 'px-4 py-0'
      : 'px-4 py-1.5';
  const showCompactHeader = readingMode;

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
    <div
      data-testid="reader-page"
      data-reader-theme={loadReaderViewSettings(readerFontSize).theme}
      className="h-screen flex flex-col bg-surface"
    >
      <header
        className={`relative flex items-center border-b ${readingMode ? 'border-transparent bg-surface/95' : 'border-border bg-surface'} transition-all ${headerPaddingClass}`}
      >
        <div className={`z-10 flex min-w-0 flex-1 items-center ${readingMode ? 'gap-1' : 'gap-3'}`}>
          {showCompactHeader && (
            <ReaderButton
              onClick={goBack}
              data-testid="reader-back-button"
              className={`inline-flex items-center justify-center rounded-md border bg-surface hover:bg-surface-subtle focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-focus ${
                readingMode
                  ? 'h-6 w-6 border-border text-size-caption text-muted'
                  : 'h-8 w-8 border-control-border text-secondary'
              }`}
              title="Back to Library"
              aria-label="Back to Library"
            >
              ←
            </ReaderButton>
          )}
          {!showCompactHeader && (
            <>
              <ReaderButton
                onClick={goBack}
                data-testid="reader-back-button"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-control-border bg-surface text-secondary hover:bg-surface-subtle focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-focus"
                title="Back to Library"
                aria-label="Back to Library"
              >
                ←
              </ReaderButton>
              <div className="relative" ref={readingViewMenuRef}>
                <ReaderButton
                  id="reader-view-trigger"
                  onClick={() => {
                    setSourceLinkMenuOpen(false);
                    setReadingViewMenuOpen((prev) => !prev);
                  }}
                  className="px-3 py-2 text-size-subheading font-medium text-secondary bg-surface-subtle rounded-md hover:bg-surface-hover"
                  aria-expanded={readingViewMenuOpen}
                  aria-controls="reader-view-menu"
                  aria-haspopup="menu"
                >
                  View
                </ReaderButton>
                {readingViewMenuOpen && (
                  <div id="reader-view-menu" role="menu" aria-label="Reader view" className="reader-chrome-menu absolute left-0 top-11 z-40">
                    <ReaderButton
                      role="menuitem"
                      onClick={() => void cycleTranslationMode()}
                      className="reader-chrome-menu-item text-secondary hover:bg-surface-subtle"
                    >
                      <span>Translation</span>
                      <span>{translationMode === 'off' ? 'Off' : translationMode === 'en-zh' ? 'EN→ZH' : 'ZH→EN'}</span>
                    </ReaderButton>
                    <div className="my-1 h-px bg-surface-hover" />
                    <ReaderButton
                      role="menuitem"
                      onClick={() => setBilingualModeFromHeader('source')}
                      className={`flex w-full items-center justify-between rounded px-2.5 py-1.5 text-size-subheading ${
                        bilingualViewMode === 'source'
                          ? 'bg-action-subtle text-action-text'
                          : 'text-secondary hover:bg-surface-subtle'
                      }`}
                    >
                      <span>Source Only</span>
                      <span>{bilingualViewMode === 'source' ? '✓' : ''}</span>
                    </ReaderButton>
                    <ReaderButton
                      role="menuitem"
                      onClick={() => setBilingualModeFromHeader('translation')}
                      disabled={translationMode === 'off'}
                      className={`flex w-full items-center justify-between rounded px-2.5 py-1.5 text-size-subheading disabled:cursor-not-allowed disabled:opacity-50 ${
                        bilingualViewMode === 'translation'
                          ? 'bg-action-subtle text-action-text'
                          : 'text-secondary hover:bg-surface-subtle'
                      }`}
                    >
                      <span>Translation Only</span>
                      <span>{bilingualViewMode === 'translation' ? '✓' : ''}</span>
                    </ReaderButton>
                    <ReaderButton
                      role="menuitem"
                      onClick={() => setBilingualModeFromHeader('both')}
                      disabled={translationMode === 'off'}
                      className={`flex w-full items-center justify-between rounded px-2.5 py-1.5 text-size-subheading disabled:cursor-not-allowed disabled:opacity-50 ${
                        bilingualViewMode === 'both'
                          ? 'bg-action-subtle text-action-text'
                          : 'text-secondary hover:bg-surface-subtle'
                      }`}
                    >
                      <span>Source + Translation</span>
                      <span>{bilingualViewMode === 'both' ? '✓' : ''}</span>
                    </ReaderButton>
                    <div className="my-1 h-px bg-surface-hover" />
                    <div className="px-2.5 py-1.5 text-size-meta text-muted">
                      Source {contentStats.sourceWords} · Translation {contentStats.translatedWords} · Paragraphs {contentStats.paragraphCount} · Page {contentStats.currentPage}/{contentStats.totalPages}
                    </div>
                    <div className="my-1 h-px bg-surface-hover" />
                    <ReaderButton
                      role="menuitem"
                      onClick={() => {
                        window.dispatchEvent(new CustomEvent('reader:open-annotations'));
                        setReadingViewMenuOpen(false);
                      }}
                      className="flex w-full items-center justify-between rounded px-2.5 py-1.5 text-size-subheading text-secondary hover:bg-surface-subtle"
                    >
                      <span>Open Annotations</span>
                      <span>→</span>
                    </ReaderButton>
                    <ReaderButton
                      role="menuitem"
                      onClick={() => {
                        openChatPanel();
                        setReadingViewMenuOpen(false);
                      }}
                      className="flex w-full items-center justify-between rounded px-2.5 py-1.5 text-size-subheading text-secondary hover:bg-surface-subtle"
                    >
                      <span>Open Chat</span>
                      <span>→</span>
                    </ReaderButton>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {!readingMode && (
          <h1 className="pointer-events-none absolute left-1/2 max-w-[var(--reader-title-max-width)] -translate-x-1/2 truncate text-size-heading font-medium text-heading" title={selectedDocument?.title || 'Reader'}>
            {selectedDocument?.title || 'Reader'}
          </h1>
        )}

        <div className="z-10 flex min-w-0 flex-1 items-center justify-end gap-2">
          {!readingMode && (
            <ReaderButton
              type="button"
              onClick={toggleToolPanel}
              aria-expanded={!toolCollapsed}
              aria-controls="reader-tool-panel"
              className="px-3 py-1.5 text-size-subheading font-medium text-secondary bg-surface-subtle rounded-md hover:bg-surface-hover"
            >
              Tools
            </ReaderButton>
          )}
          {readingMode && selectedDocumentId && (
            <ReaderButton
              onClick={openChatPanel}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border bg-surface text-size-caption text-muted hover:bg-surface-subtle"
              title="Open chat for current text"
              aria-label="Open chat for current text"
            >
              💬
            </ReaderButton>
          )}
          {!readingMode && showSourceLinkActions && (
            <div className="relative" ref={sourceLinkMenuRef}>
              <ReaderButton
                id="reader-source-link-trigger"
                onClick={() => {
                  setReadingViewMenuOpen(false);
                  setSourceLinkMenuOpen((prev) => !prev);
                }}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-surface-hover text-foreground hover:bg-control-border"
                title="Imported link actions"
                aria-label="Imported link actions"
                aria-expanded={sourceLinkMenuOpen}
                aria-controls="reader-source-link-menu"
                aria-haspopup="menu"
              >
                ⤴
              </ReaderButton>
              {sourceLinkMenuOpen && (
                <div id="reader-source-link-menu" role="menu" aria-label="Imported link actions" className="reader-chrome-menu absolute right-0 top-11 z-40 bg-surface-subtle">
                  <ReaderButton
                    role="menuitem"
                    onClick={() => {
                      void copySourceUrl();
                      setSourceLinkMenuOpen(false);
                    }}
                    className="flex w-full items-center rounded-lg px-3 py-2 text-left text-size-label leading-6 text-heading hover:bg-surface-hover/80"
                  >
                    Copy Link
                  </ReaderButton>
                  <ReaderButton
                    role="menuitem"
                    onClick={() => {
                      openSourceUrlInBrowser();
                      setSourceLinkMenuOpen(false);
                    }}
                    className="flex w-full items-center rounded-lg px-3 py-2 text-left text-size-label leading-6 text-heading hover:bg-surface-hover/80"
                  >
                    Open in DefaultBrowser
                  </ReaderButton>
                </div>
              )}
            </div>
          )}
          {readingMode ? (
            <ReaderButton
              onClick={toggleReadingMode}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border bg-surface text-size-caption text-muted hover:bg-surface-subtle"
              title="Exit reading mode"
              aria-label="Exit reading mode"
            >
              ✕
            </ReaderButton>
          ) : null}
        </div>
      </header>
      <div className="flex-1 flex overflow-hidden">
        <TOCPanel {...tocPanelProps} />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <ReaderContent />
        </div>
        <ToolPanel {...toolPanelProps} />
      </div>
      <FloatingAudiobookControl />
    </div>
  );
}
