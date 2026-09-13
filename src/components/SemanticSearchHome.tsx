import React from 'react';
import { SearchPanel } from './SearchPanel';

type SemanticSearchHomeProps = {
  statusBar?: React.ReactNode;
};

export const SemanticSearchHome: React.FC<SemanticSearchHomeProps> = ({ statusBar }) => {
  return (
    <div data-testid="semantic-search-page" className="flex h-full min-h-0 flex-col bg-surface-subtle">
      <div className="border-b border-border bg-surface px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-surface-subtle text-secondary shadow-sm">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4.5 w-4.5" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35m1.6-5.15a6.75 6.75 0 1 1-13.5 0 6.75 6.75 0 0 1 13.5 0Z" />
            </svg>
          </div>
          <div className="min-w-0">
            <div className="text-size-subheading font-semibold text-heading">Semantic Search</div>
            <div className="text-size-caption text-muted">
              Search across the whole library with the active embedding profile.
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 px-4 pb-4">
        <div className="h-full min-h-0 overflow-hidden rounded-panel border border-border bg-surface shadow-sm">
          <SearchPanel />
        </div>
      </div>

      {statusBar && (
        <div className="h-7 border-t border-border bg-surface px-3 text-size-meta text-navigation flex items-center overflow-x-auto whitespace-nowrap">
          {statusBar}
        </div>
      )}
    </div>
  );
};
