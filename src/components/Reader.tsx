import { useEffect } from 'react';
import { useStore } from '../store/useStore';
import { TOCPanel } from './TOCPanel';
import { ReaderContent } from './ReaderContent';

export function Reader() {
  const { selectedDocumentId, loadSections, goBack } = useStore();

  useEffect(() => {
    if (selectedDocumentId) {
      loadSections(selectedDocumentId);
    }
  }, [selectedDocumentId, loadSections]);

  return (
    <div className="h-screen flex flex-col bg-white">
      <header className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-white">
        <button
          onClick={goBack}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
        >
          ← Back to Library
        </button>
        <h1 className="text-xl font-semibold text-gray-900">Reader</h1>
        <div className="w-32"></div>
      </header>
      <div className="flex-1 flex overflow-hidden">
        <TOCPanel />
        <ReaderContent />
      </div>
    </div>
  );
}
