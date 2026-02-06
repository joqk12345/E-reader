import React, { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../store/useStore';

type TargetLang = 'zh' | 'en';

export const TranslatePanel: React.FC = () => {
  const { currentParagraph, translationMode } = useStore();
  const defaultTargetLang: TargetLang = useMemo(
    () => (translationMode === 'zh-en' ? 'en' : 'zh'),
    [translationMode]
  );
  const [targetLang, setTargetLang] = useState<TargetLang>(defaultTargetLang);
  const [autoDetect, setAutoDetect] = useState(true);
  const [text, setText] = useState('');
  const [translation, setTranslation] = useState('');
  const [isTranslating, setIsTranslating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!text.trim() && !translation) {
      setTargetLang(defaultTargetLang);
    }
  }, [defaultTargetLang, text, translation]);

  const detectTargetLang = (input: string): TargetLang | null => {
    if (/[\u4e00-\u9fff]/.test(input)) return 'en';
    if (/[a-zA-Z]/.test(input)) return 'zh';
    return null;
  };

  const handleTranslate = async () => {
    const hasText = text.trim();
    const hasParagraph = currentParagraph;

    if (!hasText && !hasParagraph) {
      setError('Please enter text or select a paragraph');
      return;
    }

    setIsTranslating(true);
    setError(null);
    try {
      const effectiveTarget = autoDetect && hasText
        ? (detectTargetLang(hasText) ?? targetLang)
        : targetLang;
      const result = await invoke<string>('translate', {
        text: hasText ? text : undefined,
        paragraphId: hasParagraph && !hasText ? currentParagraph.id : undefined,
        targetLang: effectiveTarget,
      });
      setTranslation(result);
    } catch (err) {
      console.error('Translate failed:', err);
      setError(err instanceof Error ? err.message : 'Translation failed');
      setTranslation('');
    } finally {
      setIsTranslating(false);
    }
  };

  const useCurrentParagraph = () => {
    if (currentParagraph) {
      setText(currentParagraph.text);
    }
  };

  const getLanguageName = (lang: TargetLang) => {
    return lang === 'zh' ? 'Chinese' : 'English';
  };

  return (
    <div className="flex flex-col h-full">
      {/* Options */}
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center gap-4 mb-3">
          <span className="text-sm font-medium text-gray-700">Target Language:</span>
          <div className="flex gap-2">
            {(['en', 'zh'] as TargetLang[]).map((lang) => (
              <button
                key={lang}
                onClick={() => setTargetLang(lang)}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  targetLang === lang
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {getLanguageName(lang)}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={autoDetect}
              onChange={(e) => setAutoDetect(e.target.checked)}
              className="h-4 w-4"
            />
            Auto-detect target language
          </label>
          <button
            onClick={useCurrentParagraph}
            disabled={!currentParagraph}
            className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:bg-gray-50 disabled:text-gray-400 transition-colors"
          >
            Use Current Paragraph
          </button>
          <button
            onClick={handleTranslate}
            disabled={isTranslating || (!text.trim() && !currentParagraph)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
          >
            {isTranslating ? 'Translating...' : 'Translate'}
          </button>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="p-4 bg-red-50 border-b border-red-200">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {/* Input/Output */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-4">
          {/* Input */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Original Text
            </label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Enter text to translate or click 'Use Current Paragraph'"
              className="w-full p-3 border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={8}
            />
          </div>

          {/* Output */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Translation
            </label>
            {translation ? (
              <div className="w-full p-3 bg-blue-50 border border-blue-200 rounded-lg min-h-[200px]">
                <p className="text-gray-800 leading-relaxed whitespace-pre-wrap">{translation}</p>
              </div>
            ) : (
              <div className="w-full p-3 bg-gray-50 border border-gray-200 rounded-lg min-h-[200px] flex items-center justify-center text-gray-400">
                <p className="text-sm">Translation will appear here</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
