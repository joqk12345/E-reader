import { useCallback, useEffect, useMemo, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useStore } from '../store/useStore';
import { matchesAnyShortcut } from '../utils/shortcuts';
import { TOCPanel } from './TOCPanel';
import { ReaderContent } from './ReaderContent';
import { ToolPanel } from './ToolPanel';
import { FloatingAudiobookControl } from './FloatingAudiobookControl';

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
  } = useStore();
  const [tocCollapsed, setTocCollapsed] = useState(false);
  const [tocWidth, setTocWidth] = useState(256);
  const [headerToolsCollapsed, setHeaderToolsCollapsed] = useState(false);
  const [windowMaximized, setWindowMaximized] = useState(false);
  const [toolCollapsed, setToolCollapsed] = useState(false);
  const [toolWidth, setToolWidth] = useState(320);
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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      if (matchesAnyShortcut(event, keymap.next_page)) {
        event.preventDefault();
        handleFlipPage('next');
      } else if (matchesAnyShortcut(event, keymap.prev_page)) {
        event.preventDefault();
        handleFlipPage('prev');
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [handleFlipPage, keymap]);

  useEffect(() => {
    const onNextPage = () => handleFlipPage('next');
    const onPrevPage = () => handleFlipPage('prev');
    const onToggleHeaderTools = () => setHeaderToolsCollapsed((prev) => !prev);

    window.addEventListener('reader:next-page', onNextPage as EventListener);
    window.addEventListener('reader:prev-page', onPrevPage as EventListener);
    window.addEventListener('reader:toggle-header-tools', onToggleHeaderTools as EventListener);

    return () => {
      window.removeEventListener('reader:next-page', onNextPage as EventListener);
      window.removeEventListener('reader:prev-page', onPrevPage as EventListener);
      window.removeEventListener(
        'reader:toggle-header-tools',
        onToggleHeaderTools as EventListener
      );
    };
  }, [handleFlipPage]);

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
        <ReaderContent />
        <ToolPanel {...toolPanelProps} />
      </div>
      <FloatingAudiobookControl />
    </div>
  );
}
