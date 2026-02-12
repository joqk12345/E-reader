import React from 'react';
import type { Document } from '../types';

interface DocumentCardProps {
  document: Document;
  onClick: () => void;
  onDelete: () => void;
  variant?: 'grid' | 'list' | 'compact';
  category?: string;
  tags?: string[];
}

export const DocumentCard: React.FC<DocumentCardProps> = ({
  document,
  onClick,
  onDelete,
  variant = 'grid',
  category,
  tags = [],
}) => {
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
        className="bg-white rounded border border-gray-200 hover:border-blue-300 transition-colors cursor-pointer px-2 py-1"
        onClick={onClick}
      >
        <div className="flex items-center gap-2">
          <span className="text-base leading-none">{getFileTypeIcon()}</span>
          <p className="flex-1 min-w-0 text-xs font-medium text-gray-900 truncate">{document.title}</p>
          {category && <span className="text-[11px] text-blue-700 bg-blue-50 rounded px-1.5 py-0.5">{category}</span>}
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
        className="bg-white rounded-md border border-gray-200 hover:border-blue-300 hover:shadow-sm transition-all cursor-pointer px-2.5 py-1.5"
        onClick={onClick}
      >
        <div className="flex items-start gap-2">
          <span className="text-lg leading-none">{getFileTypeIcon()}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-start gap-1.5">
              <h3 className="flex-1 min-w-0 text-sm font-semibold text-gray-900 leading-tight line-clamp-2 break-words">{document.title}</h3>
              {category && <span className="text-[11px] text-blue-700 bg-blue-50 rounded px-2 py-0.5">{category}</span>}
              <span className="text-[11px] text-gray-600 bg-gray-100 rounded px-2 py-0.5">{getFileTypeLabel()}</span>
            </div>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {document.author ? `${document.author} · ` : ''}Added {formatDate(document.created_at)}
            </p>
            {tags.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {tags.slice(0, 4).map((tag) => (
                  <span key={tag} className="text-[10px] text-slate-600 bg-slate-100 rounded px-1 py-0.5">
                    #{tag}
                  </span>
                ))}
              </div>
            )}
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
      className="bg-white rounded-md shadow-sm hover:shadow-md transition-shadow cursor-pointer p-2.5"
      onClick={onClick}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-2.5 flex-1">
          <span className="text-xl leading-none">{getFileTypeIcon()}</span>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-gray-900 leading-tight line-clamp-2 break-words">{document.title}</h3>
            {category && <p className="text-xs text-blue-700 mt-0.5">{category}</p>}
            {document.author && (
              <p className="text-xs text-gray-600 truncate">{document.author}</p>
            )}
            <p className="text-[11px] text-gray-500 mt-0.5">
              Added {formatDate(document.created_at)}
            </p>
            {tags.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {tags.slice(0, 4).map((tag) => (
                  <span key={tag} className="text-[10px] text-slate-600 bg-slate-100 rounded px-1 py-0.5">
                    #{tag}
                  </span>
                ))}
              </div>
            )}
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
