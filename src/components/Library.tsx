import React, { useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { useStore } from '../store/useStore';
import { DocumentCard } from './DocumentCard';
import { Settings } from './Settings';

export const Library: React.FC = () => {
  const { documents, isLoading, loadDocuments, importEpub, importPdf, importMarkdown, deleteDocument, selectDocument } = useStore();
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  const handleImport = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: 'Documents',
            extensions: ['epub', 'pdf', 'md']
          }
        ]
      });

      if (selected && typeof selected === 'string') {
        const ext = selected.split('.').pop()?.toLowerCase();
        if (ext === 'epub') {
          await importEpub(selected);
        } else if (ext === 'pdf') {
          await importPdf(selected);
        } else if (ext === 'md') {
          await importMarkdown(selected);
        }
      }
    } catch (error) {
      console.error('Import failed:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      alert(`Failed to import document: ${errorMessage}`);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this document?')) {
      try {
        await deleteDocument(id);
      } catch (error) {
        console.error('Delete failed:', error);
        alert('Failed to delete document');
      }
    }
  };

  return (
    <>
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}

      <div className="h-full flex flex-col bg-gray-50">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-gray-900">Library</h1>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowSettings(true)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                ⚙️ Settings
              </button>
              <button
                onClick={handleImport}
                disabled={isLoading}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
              >
                {isLoading ? 'Importing...' : 'Import Document'}
              </button>
            </div>
          </div>
        </div>

      {/* Documents Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        {documents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mb-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            <p className="text-lg">No documents yet</p>
            <p className="text-sm mt-2">Import an EPUB, PDF, or Markdown file to get started</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {documents.map((doc) => (
              <DocumentCard
                key={doc.id}
                document={doc}
                onClick={() => selectDocument(doc.id)}
                onDelete={() => handleDelete(doc.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
    </>
  );
};
