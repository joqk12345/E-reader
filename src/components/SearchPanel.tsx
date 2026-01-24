import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface SearchResult {
  paragraph_id: string;
  snippet: string;
  score: number;
  location: string;
}

export const SearchPanel: React.FC = () => {
  const [query, setQuery] = useState('');
  const [topK, setTopK] = useState(10);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async () => {
    if (!query.trim()) return;

    setIsSearching(true);
    setError(null);
    try {
      const searchResults = await invoke<SearchResult[]>('search', {
        options: {
          query,
          top_k: topK,
        }
      });
      setResults(searchResults);
    } catch (err) {
      console.error('Search failed:', err);
      setError(err instanceof Error ? err.message : 'Search failed');
      setResults([]);
    } finally {
      setIsSearching(false);
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
            <p className="text-sm">Enter a query to search</p>
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
