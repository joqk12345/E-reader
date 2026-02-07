import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import { TOCPanel } from './TOCPanel';
import { ReaderContent } from './ReaderContent';
import { ToolPanel } from './ToolPanel';

export function Reader() {
  const {
    selectedDocumentId,
    currentDocumentType,
    loadSections,
    loadDocumentParagraphs,
    goBack,
    translationMode,
    cycleTranslationMode,
  } = useStore();
  const [tocCollapsed, setTocCollapsed] = useState(false);
  const [tocWidth, setTocWidth] = useState(256);
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

  return (
    <div className="h-screen flex flex-col bg-white">
      <header className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-white">
        <div className="flex items-center gap-3">
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
        </div>
        <h1 className="text-xl font-semibold text-gray-900">Reader</h1>
        <div className="w-32"></div>
      </header>
      <div className="flex-1 flex overflow-hidden">
        <TOCPanel {...tocPanelProps} />
        <ReaderContent />
        <ToolPanel {...toolPanelProps} />
      </div>
    </div>
  );
}
