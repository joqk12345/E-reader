import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useStore } from '../store/useStore';
import { matchesAnyShortcut } from '../utils/shortcuts';
import { TOCPanel } from './TOCPanel';
import { ReaderContent } from './ReaderContent';
import { ToolPanel } from './ToolPanel';
import { FloatingAudiobookControl } from './FloatingAudiobookControl';
import { loadReaderViewSettings } from './readerTheme';

type ReaderProps = {
  onOpenSettings?: () => void;
};

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  return target.isContentEditable;
};

export function Reader({ onOpenSettings }: ReaderProps) {
  const {
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
  const [tocCollapsed, setTocCollapsed] = useState(false);
  const [tocWidth, setTocWidth] = useState(256);
  const [headerToolsCollapsed, setHeaderToolsCollapsed] = useState(false);
  const [windowMaximized, setWindowMaximized] = useState(false);
  const [toolCollapsed, setToolCollapsed] = useState(false);
  const [toolWidth, setToolWidth] = useState(320);
  const [readingMode, setReadingMode] = useState(false);
  const [contentStats, setContentStats] = useState({
    sourceWords: 0,
    translatedWords: 0,
    paragraphCount: 0,
  });
  const [bilingualViewMode, setBilingualViewMode] = useState<'both' | 'source' | 'translation'>(
    () => loadReaderViewSettings(readerFontSize).bilingualViewMode
  );
  const [readingViewMenuOpen, setReadingViewMenuOpen] = useState(false);
  const readingViewMenuRef = useRef<HTMLDivElement | null>(null);
  const readingModeSnapshotRef = useRef<{
    headerToolsCollapsed: boolean;
    tocCollapsed: boolean;
    toolCollapsed: boolean;
  } | null>(null);
  const minTocWidth = 200;
  const maxTocWidth = 420;
  const minToolWidth = 280;
  const maxToolWidth = 460;

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

  const applyReadingMode = useCallback(
    (enabled: boolean) => {
      if (enabled) {
        if (!readingModeSnapshotRef.current) {
          readingModeSnapshotRef.current = {
            headerToolsCollapsed,
            tocCollapsed,
            toolCollapsed,
          };
        }
        setHeaderToolsCollapsed(true);
        setTocCollapsed(true);
        setToolCollapsed(true);
      } else {
        const snapshot = readingModeSnapshotRef.current;
        if (snapshot) {
          setHeaderToolsCollapsed(snapshot.headerToolsCollapsed);
          setTocCollapsed(snapshot.tocCollapsed);
          setToolCollapsed(snapshot.toolCollapsed);
          readingModeSnapshotRef.current = null;
        }
      }
      setReadingMode(enabled);
      window.dispatchEvent(
        new CustomEvent('reader:reading-mode-changed', {
          detail: { enabled },
        })
      );
    },
    [headerToolsCollapsed, tocCollapsed, toolCollapsed]
  );

  const toggleReadingMode = useCallback(() => {
    applyReadingMode(!readingMode);
  }, [applyReadingMode, readingMode]);

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
      }>
    ) => {
      setContentStats({
        sourceWords: event.detail?.sourceWords || 0,
        translatedWords: event.detail?.translatedWords || 0,
        paragraphCount: event.detail?.paragraphCount || 0,
      });
    };
    window.addEventListener('reader:content-stats', onContentStats as EventListener);
    return () => window.removeEventListener('reader:content-stats', onContentStats as EventListener);
  }, []);

  useEffect(() => {
    const refresh = () => {
      const settings = loadReaderViewSettings(readerFontSize);
      setBilingualViewMode(settings.bilingualViewMode);
    };
    refresh();
    window.addEventListener('reader:view-settings-updated', refresh as EventListener);
    return () => window.removeEventListener('reader:view-settings-updated', refresh as EventListener);
  }, [readerFontSize]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!readingViewMenuRef.current || !target) return;
      if (!readingViewMenuRef.current.contains(target)) {
        setReadingViewMenuOpen(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, []);

  const setBilingualModeFromHeader = (mode: 'both' | 'source' | 'translation') => {
    window.dispatchEvent(
      new CustomEvent('reader:set-bilingual-view-mode', {
        detail: { mode },
      })
    );
    setBilingualViewMode(mode);
    setReadingViewMenuOpen(false);
  };

  const headerPaddingClass = windowMaximized ? 'py-0' : headerToolsCollapsed ? 'py-2' : 'py-4';

  return (
    <div className="h-screen flex flex-col bg-white">
      <header
        className={`flex items-center justify-between px-6 border-b border-gray-200 bg-white transition-all ${headerPaddingClass}`}
      >
        <div className="flex items-center gap-3">
          {!headerToolsCollapsed && (
            <>
              <button
                onClick={goBack}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                ← Back to Library
              </button>
              <button
                onClick={() => void cycleTranslationMode()}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                  translationMode !== 'off'
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
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
                  className="px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
                >
                  Reading View ▾
                </button>
                {readingViewMenuOpen && (
                  <div className="absolute left-0 top-11 z-40 min-w-[220px] rounded-lg border border-gray-200 bg-white p-1.5 shadow-lg">
                    <button
                      onClick={() => setBilingualModeFromHeader('source')}
                      className={`flex w-full items-center justify-between rounded px-2.5 py-1.5 text-sm ${
                        bilingualViewMode === 'source'
                          ? 'bg-blue-50 text-blue-700'
                          : 'text-gray-700 hover:bg-gray-50'
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
                          ? 'bg-blue-50 text-blue-700'
                          : 'text-gray-700 hover:bg-gray-50'
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
                          ? 'bg-blue-50 text-blue-700'
                          : 'text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      <span>Source + Translation</span>
                      <span>{bilingualViewMode === 'both' ? '✓' : ''}</span>
                    </button>
                    <div className="my-1 h-px bg-gray-200" />
                    <button
                      onClick={() => {
                        window.dispatchEvent(new CustomEvent('reader:open-annotations'));
                        setReadingViewMenuOpen(false);
                      }}
                      className="flex w-full items-center justify-between rounded px-2.5 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      <span>Open Annotations</span>
                      <span>→</span>
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        <h1 className="text-xl font-semibold text-gray-900">Reader</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={onOpenSettings}
            className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
            title="Open settings (Cmd/Ctrl + ,)"
            aria-label="Open settings"
          >
            ⚙️ Settings
          </button>
          <button
            onClick={() => setHeaderToolsCollapsed((prev) => !prev)}
            className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
            title={headerToolsCollapsed ? 'Expand header tools' : 'Collapse header tools'}
            aria-label={headerToolsCollapsed ? 'Expand header tools' : 'Collapse header tools'}
          >
            {headerToolsCollapsed ? 'Tools: Show' : 'Tools: Hide'}
          </button>
        </div>
      </header>
      <div className="flex-1 flex overflow-hidden">
        <TOCPanel {...tocPanelProps} />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <ReaderContent />
          {!readingMode && (
            <div className="h-7 border-t border-gray-200 bg-white px-3 text-[11px] text-gray-600 flex items-center justify-end overflow-x-auto whitespace-nowrap">
              <span>
                Word Stats: Source {contentStats.sourceWords} · Translation {contentStats.translatedWords} · Paragraphs {contentStats.paragraphCount}
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
