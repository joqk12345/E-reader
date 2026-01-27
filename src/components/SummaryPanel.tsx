import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../store/useStore';

type SummaryStyle = 'brief' | 'detailed' | 'bullet';

export const SummaryPanel: React.FC = () => {
  const { selectedDocumentId, currentSectionId, currentParagraph, summaryCache, setSummaryCache } = useStore();
  const [style, setStyle] = useState<SummaryStyle>('brief');
  const [summary, setSummary] = useState<string>('');
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getSummaryKey = () => {
    if (currentParagraph) return `paragraph:${currentParagraph.id}:${style}`;
    if (currentSectionId) return `section:${currentSectionId}:${style}`;
    if (selectedDocumentId) return `document:${selectedDocumentId}:${style}`;
    return '';
  };

  const stripThinking = (text: string) => {
    if (!text) return text;
    return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  };

  useEffect(() => {
    const key = getSummaryKey();
    setSummary(key ? summaryCache[key] || '' : '');
  }, [style, currentParagraph, currentSectionId, selectedDocumentId, summaryCache]);

  useEffect(() => {
    const key = getSummaryKey();
    if (!key || summaryCache[key]) return;

    const loadCachedSummary = async () => {
      try {
        const cached = await invoke<string | null>('get_summary_cache', {
          docId: currentParagraph ? undefined : selectedDocumentId,
          sectionId: currentParagraph ? undefined : currentSectionId || undefined,
          paragraphId: currentParagraph?.id || undefined,
          style,
        });
        if (cached) {
          const cleaned = stripThinking(cached);
          setSummary(cleaned);
          setSummaryCache(key, cleaned);
        }
      } catch (err) {
        // Silent fail: cache miss or transient error should not block UI
        console.warn('Failed to load cached summary:', err);
      }
    };

    loadCachedSummary();
  }, [
    style,
    currentParagraph,
    currentSectionId,
    selectedDocumentId,
    summaryCache,
    setSummaryCache,
  ]);

  const getFriendlyError = (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    const normalized = message.toLowerCase();
    if (
      normalized.includes('502') ||
      normalized.includes('bad gateway') ||
      normalized.includes('connection refused') ||
      normalized.includes('econnrefused') ||
      normalized.includes('failed to send request')
    ) {
      return 'LM Studio 服务未开启或模型未加载。请先启动 LM Studio 并加载模型。';
    }
    return message || 'Summarization failed';
  };

  const handleSummarize = async () => {
    if (!selectedDocumentId) {
      setError('Please select a document first');
      return;
    }

    setIsSummarizing(true);
    setError(null);
    try {
      const cacheKey = getSummaryKey();
      const result = await invoke<string>('summarize', {
        docId: currentParagraph ? undefined : selectedDocumentId,
        sectionId: currentParagraph ? undefined : currentSectionId || undefined,
        paragraphId: currentParagraph?.id || undefined,
        style,
      });
      const cleaned = stripThinking(result);
      setSummary(cleaned);
      if (cacheKey) {
        setSummaryCache(cacheKey, cleaned);
      }
    } catch (err) {
      console.error('Summarize failed:', err);
      setError(getFriendlyError(err));
      setSummary('');
    } finally {
      setIsSummarizing(false);
    }
  };

  const getTargetLabel = () => {
    if (currentParagraph) return 'Current Paragraph';
    if (currentSectionId) return 'Current Section';
    if (selectedDocumentId) return 'Entire Document';
    return 'None';
  };

  return (
    <div className="flex flex-col h-full">
      {/* Options */}
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center gap-4 mb-3">
          <span className="text-sm font-medium text-gray-700">Style:</span>
          <div className="flex gap-2">
            {(['brief', 'detailed', 'bullet'] as SummaryStyle[]).map((s) => (
              <button
                key={s}
                onClick={() => setStyle(s)}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  style === s
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-600">
            Target: <span className="font-medium text-gray-900">{getTargetLabel()}</span>
          </span>
          <button
            onClick={handleSummarize}
            disabled={isSummarizing || !selectedDocumentId}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
          >
            {isSummarizing ? 'Summarizing...' : 'Generate Summary'}
          </button>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="p-4 bg-red-50 border-b border-red-200">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {/* Summary Result */}
      <div className="flex-1 overflow-y-auto p-4">
        {!summary && !error && !isSummarizing && (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mb-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-sm">Click "Generate Summary" to create a summary</p>
          </div>
        )}

        {summary && (
          <div className="prose prose-sm max-w-none">
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              {style === 'bullet' ? (
                <div className="whitespace-pre-wrap">{summary}</div>
              ) : (
                <p className="text-gray-800 leading-relaxed whitespace-pre-wrap">{summary}</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
