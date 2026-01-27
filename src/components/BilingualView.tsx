import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface BilingualViewProps {
  paragraphId: string;
  originalText: string;
}

export const BilingualView: React.FC<BilingualViewProps> = ({ paragraphId, originalText }) => {
  const [translation, setTranslation] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [targetLang, setTargetLang] = useState<'zh' | 'en'>('en');

  useEffect(() => {
    loadTranslation();
  }, [paragraphId, targetLang]);

  const loadTranslation = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await invoke<string>('translate', {
        text: undefined,
        paragraphId,
        targetLang,
      });
      setTranslation(result);
    } catch (err) {
      console.error('Failed to load translation:', err);
      setError(err instanceof Error ? err.message : 'Translation failed');
      setTranslation('');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLanguageChange = (lang: 'zh' | 'en') => {
    setTargetLang(lang);
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
        <h3 className="text-sm font-semibold text-gray-900">Bilingual View</h3>
        <div className="flex gap-2">
          <button
            onClick={() => handleLanguageChange('en')}
            className={`px-3 py-1 text-xs rounded-md transition-colors ${
              targetLang === 'en'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            English
          </button>
          <button
            onClick={() => handleLanguageChange('zh')}
            className={`px-3 py-1 text-xs rounded-md transition-colors ${
              targetLang === 'zh'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            中文
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-4 mt-4 p-3 bg-red-50 border border-red-200 rounded-md">
          <p className="text-xs text-red-600">{error}</p>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-2 gap-4 h-full">
          {/* Original */}
          <div className="flex flex-col">
            <div className="mb-2">
              <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                Original
              </span>
            </div>
            <div className="flex-1 p-4 bg-gray-50 border border-gray-200 rounded-lg overflow-y-auto">
              <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
                {originalText}
              </p>
            </div>
          </div>

          {/* Translation */}
          <div className="flex flex-col">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                Translation
              </span>
              {isLoading && (
                <span className="text-xs text-blue-600">Loading...</span>
              )}
            </div>
            <div className="flex-1 p-4 bg-blue-50 border border-blue-200 rounded-lg overflow-y-auto">
              {isLoading ? (
                <div className="flex items-center justify-center h-full">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                </div>
              ) : translation ? (
                <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
                  {translation}
                </p>
              ) : (
                <p className="text-sm text-gray-400 italic">No translation available</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
