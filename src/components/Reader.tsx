import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import { TOCPanel } from './TOCPanel';
import { ReaderContent } from './ReaderContent';
import { ToolPanel } from './ToolPanel';

export function Reader() {
  const { selectedDocumentId, loadSections, goBack, bilingualMode, toggleBilingualMode } = useStore();
  const [tocCollapsed, setTocCollapsed] = useState(false);
  const [tocWidth, setTocWidth] = useState(256);
  const minTocWidth = 200;
  const maxTocWidth = 420;

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

  useEffect(() => {
    if (selectedDocumentId) {
      loadSections(selectedDocumentId);
    }
  }, [selectedDocumentId, loadSections]);

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
            onClick={toggleBilingualMode}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              bilingualMode
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {bilingualMode ? '🌐 Bilingual On' : '🌐 Bilingual Off'}
          </button>
        </div>
        <h1 className="text-xl font-semibold text-gray-900">Reader</h1>
        <div className="w-32"></div>
      </header>
      <div className="flex-1 flex overflow-hidden">
        <TOCPanel {...tocPanelProps} />
        <ReaderContent />
        <ToolPanel />
      </div>
    </div>
  );
}
