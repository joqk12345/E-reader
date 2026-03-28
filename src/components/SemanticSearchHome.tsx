import React, { useEffect, useState } from 'react';
import { SearchPanel } from './SearchPanel';

type SemanticSearchHomeProps = {
  statusBar?: React.ReactNode;
};

const SEARCH_HISTORY_KEY = 'reader.searchHistory';

export const SemanticSearchHome: React.FC<SemanticSearchHomeProps> = ({ statusBar }) => {
  const [searchHistory, setSearchHistory] = useState<string[]>([]);

  useEffect(() => {
    const loadHistory = () => {
      if (typeof window === 'undefined') return;
      try {
        const raw = window.localStorage.getItem(SEARCH_HISTORY_KEY);
        if (!raw) {
          setSearchHistory([]);
          return;
        }
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setSearchHistory(parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0));
        }
      } catch (error) {
        console.warn('Failed to load semantic search history:', error);
      }
    };

    loadHistory();
    window.addEventListener('reader:search-history-updated', loadHistory as EventListener);
    return () => window.removeEventListener('reader:search-history-updated', loadHistory as EventListener);
  }, []);

  const runHistoryQuery = (query: string) => {
    window.dispatchEvent(new CustomEvent('reader:run-search', { detail: { query } }));
  };

  const clearHistory = () => {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(SEARCH_HISTORY_KEY);
    setSearchHistory([]);
    window.dispatchEvent(new CustomEvent('reader:search-history-updated'));
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-gray-50">
      <div className="border-b border-gray-200 bg-white px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700 shadow-sm">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4.5 w-4.5" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35m1.6-5.15a6.75 6.75 0 1 1-13.5 0 6.75 6.75 0 0 1 13.5 0Z" />
            </svg>
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-900">Semantic Search</div>
            <div className="text-xs text-slate-500">
              Search across the whole library with the active embedding profile.
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 p-6">
        <div className="grid h-full min-h-0 gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          <div className="flex min-h-0 flex-col rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">Recent Queries</div>
                <div className="text-xs text-slate-500">Click to search again.</div>
              </div>
              {searchHistory.length > 0 && (
                <button
                  type="button"
                  onClick={clearHistory}
                  className="text-xs text-slate-500 hover:text-slate-700"
                >
                  Clear
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-3">
              {searchHistory.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                  No recent searches yet.
                </div>
              ) : (
                <div className="space-y-2">
                  {searchHistory.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => runHistoryQuery(item)}
                      className="block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                    >
                      {item}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="min-h-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <SearchPanel />
          </div>
        </div>
      </div>

      {statusBar && (
        <div className="h-7 border-t border-gray-200 bg-white px-3 text-[11px] text-gray-600 flex items-center overflow-x-auto whitespace-nowrap">
          {statusBar}
        </div>
      )}
    </div>
  );
};
