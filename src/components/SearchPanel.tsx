import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../store/useStore';

interface SearchResult {
  paragraph_id: string;
  snippet: string;
  score: number;
  location: string;
}

export const SearchPanel: React.FC = () => {
  const { selectedDocumentId } = useStore();
  const [query, setQuery] = useState('');
  const [topK, setTopK] = useState(10);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isIndexing, setIsIndexing] = useState(false);

  const getFriendlyError = (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    const normalized = message.toLowerCase();
    if (normalized.includes('no models loaded')) {
      return 'LM Studio 未加载 embedding 模型。请先在 LM Studio 加载 embedding 模型，并在设置中填写对应的 Embedding Model 名称。';
    }
    if (
      normalized.includes('502') ||
      normalized.includes('bad gateway') ||
      normalized.includes('connection refused') ||
      normalized.includes('econnrefused') ||
      normalized.includes('failed to send request')
    ) {
      return 'LM Studio 服务未开启或模型未加载。请先启动 LM Studio 并加载模型。';
    }
    return message || 'Search failed';
  };

  const handleSearch = async () => {
    if (!query.trim()) return;

    setIsSearching(true);
    setError(null);
    try {
      const searchResults = await invoke<SearchResult[]>('search', {
        options: {
          query,
          top_k: topK,
          doc_id: selectedDocumentId || undefined,
        }
      });
      setResults(searchResults);
    } catch (err) {
      console.error('Search failed:', err);
      setError(getFriendlyError(err));
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleIndexDocument = async () => {
    if (!selectedDocumentId) return;
    setIsIndexing(true);
    setError(null);
    try {
      await invoke<number>('index_document', { docId: selectedDocumentId });
    } catch (err) {
      console.error('Index failed:', err);
      setError(getFriendlyError(err));
    } finally {
      setIsIndexing(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSearch();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Search Input */}
      <div className="p-4 border-b border-gray-200">
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter your search query..."
          className="w-full p-3 border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
          rows={3}
        />

        {/* Options */}
        <div className="mt-3 flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <span>Results:</span>
            <select
              value={topK}
              onChange={(e) => setTopK(Number(e.target.value))}
              className="border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
            </select>
          </label>

          {selectedDocumentId && (
            <button
              onClick={handleIndexDocument}
              disabled={isIndexing}
              className="px-3 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:bg-gray-200 transition-colors"
            >
              {isIndexing ? 'Indexing...' : 'Index Document'}
            </button>
          )}

          <button
            onClick={handleSearch}
            disabled={isSearching || !query.trim()}
            className="ml-auto px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
          >
            {isSearching ? 'Searching...' : 'Search'}
          </button>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="p-4 bg-red-50 border-b border-red-200">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {/* Results */}
      <div className="flex-1 overflow-y-auto p-4">
        {results.length === 0 && !error && !isSearching && (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mb-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <p className="text-sm">
              {query.trim()
                ? 'No results. If this is a new document, click "Index Document" first.'
                : 'Enter a query to search'}
            </p>
          </div>
        )}

        <div className="space-y-3">
          {results.map((result, idx) => (
            <div
              key={result.paragraph_id}
              className="p-3 bg-white border border-gray-200 rounded-lg hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between mb-2">
                <span className="text-xs text-gray-500 font-mono">
                  #{idx + 1} • {result.location}
                </span>
                <span className="text-xs text-blue-600 font-semibold">
                  {(result.score * 100).toFixed(1)}%
                </span>
              </div>
              <p className="text-sm text-gray-800 leading-relaxed">
                {result.snippet}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
