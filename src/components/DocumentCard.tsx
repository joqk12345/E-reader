import React from 'react';
import type { Document } from '../types';
import { Button } from './ui/Button';

interface DocumentCardProps {
  document: Document;
  onClick: () => void;
  onDelete: () => void;
  variant?: 'grid' | 'list' | 'compact';
  category?: string;
  tags?: string[];
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
}

export const DocumentCard: React.FC<DocumentCardProps> = ({
  document,
  onClick,
  onDelete,
  variant = 'grid',
  category,
  tags = [],
  isFavorite = false,
  onToggleFavorite,
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

  const actionPillSizeClassName = 'inline-flex h-8 w-12 items-center justify-center rounded-full transition-colors';
  const favoriteButtonClassName = `${actionPillSizeClassName} ${
    isFavorite ? 'bg-surface-subtle text-warning hover:bg-surface-hover' : 'bg-surface-subtle text-muted hover:bg-surface-hover'
  }`;
  const deleteButtonClassName = `${actionPillSizeClassName} bg-surface-subtle text-muted hover:bg-danger-subtle hover:text-danger`;
  const favoriteButtonTitle = isFavorite ? 'Remove from favorites' : 'Add to favorites';

  if (variant === 'compact') {
    return (
      <div
        className="bg-surface rounded border border-border hover:border-focus-border transition-colors cursor-pointer px-2 py-1"
        onClick={onClick}
      >
        <div className="flex items-center gap-2">
          <span className="text-base leading-none">{getFileTypeIcon()}</span>
          <p className="flex-1 min-w-0 text-xs font-medium text-heading truncate">{document.title}</p>
          {category && <span className="text-size-meta text-action-text bg-action-subtle rounded px-1.5 py-0.5">{category}</span>}
          <span className="text-size-meta text-muted">{getFileTypeLabel()}</span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite?.();
              }}
              className={favoriteButtonClassName}
              aria-label={favoriteButtonTitle}
              title={favoriteButtonTitle}
            >
              <span className="text-lg leading-none">☆</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className={deleteButtonClassName}
              aria-label="Delete document"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (variant === 'list') {
    return (
      <div
        className="bg-surface rounded-md border border-border hover:border-focus-border hover:shadow-sm transition-all cursor-pointer px-2.5 py-1.5"
        onClick={onClick}
      >
        <div className="flex items-start gap-2">
          <span className="text-lg leading-none">{getFileTypeIcon()}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-start gap-1.5">
              <h3 className="flex-1 min-w-0 text-sm font-semibold text-heading leading-tight line-clamp-2 break-words">{document.title}</h3>
              {category && <span className="text-size-meta text-action-text bg-action-subtle rounded px-2 py-0.5">{category}</span>}
              <span className="text-size-meta text-navigation bg-surface-subtle rounded px-2 py-0.5">{getFileTypeLabel()}</span>
            </div>
            <p className="text-size-meta text-muted mt-0.5">
              {document.author ? `${document.author} · ` : ''}Added {formatDate(document.created_at)}
            </p>
            {tags.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {tags.slice(0, 4).map((tag) => (
                  <span key={tag} className="text-size-micro text-navigation bg-surface-subtle rounded px-1 py-0.5">
                    #{tag}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite?.();
              }}
              className={favoriteButtonClassName}
              aria-label={favoriteButtonTitle}
              title={favoriteButtonTitle}
            >
              <span className="text-lg leading-none">☆</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className={deleteButtonClassName}
              aria-label="Delete document"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="bg-surface rounded-md shadow-sm hover:shadow-md transition-shadow cursor-pointer p-2.5"
      onClick={onClick}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-2.5 flex-1">
          <span className="text-xl leading-none">{getFileTypeIcon()}</span>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-heading leading-tight line-clamp-2 break-words">{document.title}</h3>
            <div className="mt-0.5 flex flex-wrap items-center gap-1">
              {category && <span className="text-size-meta text-action-text bg-action-subtle rounded px-1.5 py-0.5">{category}</span>}
            </div>
            {document.author && (
              <p className="text-xs text-navigation truncate">{document.author}</p>
            )}
            <p className="text-size-meta text-muted mt-0.5">
              Added {formatDate(document.created_at)}
            </p>
            {tags.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {tags.slice(0, 4).map((tag) => (
                  <span key={tag} className="text-size-micro text-navigation bg-surface-subtle rounded px-1 py-0.5">
                    #{tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite?.();
            }}
            className={favoriteButtonClassName}
            aria-label={favoriteButtonTitle}
            title={favoriteButtonTitle}
          >
            <span className="text-lg leading-none">☆</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className={deleteButtonClassName}
            aria-label="Delete document"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </Button>
        </div>
      </div>
    </div>
  );
};
