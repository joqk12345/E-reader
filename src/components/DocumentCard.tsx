import React from 'react';
import type { Document } from '../types';

interface DocumentCardProps {
  document: Document;
  onClick: () => void;
  onDelete: () => void;
  variant?: 'grid' | 'list' | 'compact';
}

export const DocumentCard: React.FC<DocumentCardProps> = ({ document, onClick, onDelete, variant = 'grid' }) => {
  const getFileTypeIcon = () => {
    if (document.file_type === 'epub') return '📚';
    if (document.file_type === 'markdown') return '📝';
    return '📄';
  };

  const getFileTypeLabel = () => {
    if (document.file_type === 'epub') return 'EPUB';
    if (document.file_type === 'markdown') return 'Markdown';
    return 'PDF';
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleDateString();
  };

  if (variant === 'compact') {
    return (
      <div
        className="bg-white rounded-md border border-gray-200 hover:border-blue-300 transition-colors cursor-pointer px-3 py-2"
        onClick={onClick}
      >
        <div className="flex items-center gap-2">
          <span className="text-lg">{getFileTypeIcon()}</span>
          <p className="flex-1 min-w-0 text-sm font-medium text-gray-900 truncate">{document.title}</p>
          <span className="text-[11px] text-gray-500">{getFileTypeLabel()}</span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="text-gray-400 hover:text-red-500 transition-colors p-1"
            aria-label="Delete document"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  if (variant === 'list') {
    return (
      <div
        className="bg-white rounded-lg border border-gray-200 hover:border-blue-300 hover:shadow-sm transition-all cursor-pointer px-4 py-3"
        onClick={onClick}
      >
        <div className="flex items-center gap-3">
          <span className="text-2xl">{getFileTypeIcon()}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-gray-900 truncate">{document.title}</h3>
              <span className="text-[11px] text-gray-600 bg-gray-100 rounded px-2 py-0.5">{getFileTypeLabel()}</span>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {document.author ? `${document.author} · ` : ''}Added {formatDate(document.created_at)}
            </p>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="text-gray-400 hover:text-red-500 transition-colors p-1"
            aria-label="Delete document"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow cursor-pointer p-4"
      onClick={onClick}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3 flex-1">
          <span className="text-3xl">{getFileTypeIcon()}</span>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-gray-900 truncate">{document.title}</h3>
            {document.author && (
              <p className="text-sm text-gray-600 truncate">{document.author}</p>
            )}
            <p className="text-xs text-gray-500 mt-1">
              Added {formatDate(document.created_at)}
            </p>
          </div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="text-gray-400 hover:text-red-500 transition-colors p-1"
          aria-label="Delete document"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>
    </div>
  );
};
