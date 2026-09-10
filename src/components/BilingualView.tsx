import React, { useState, useEffect } from 'react';
import { PanelButton } from './ui/Button';
import { invoke } from '@tauri-apps/api/core';
import { ThinkingDisclosure } from './ThinkingDisclosure';
import { parseThinkingBlocks } from '../utils/thinking';

interface BilingualViewProps {
  paragraphId: string;
  originalText: string;
}

export const BilingualView: React.FC<BilingualViewProps> = ({ paragraphId, originalText }) => {
  const [translation, setTranslation] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [targetLang, setTargetLang] = useState<'zh' | 'en'>('en');
  const parsedTranslation = parseThinkingBlocks(translation);

  useEffect(() => {
    loadTranslation();
  }, [paragraphId, targetLang]);

  const loadTranslation = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await invoke<string>('translate', {
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
    <div className="flex flex-col h-full bg-surface">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-surface-subtle">
        <h3 className="text-size-subheading font-semibold text-heading">Bilingual View</h3>
        <div className="flex gap-2">
          <PanelButton
            onClick={() => handleLanguageChange('en')}
            className={`px-3 py-1 text-size-caption rounded-md transition-colors ${
              targetLang === 'en'
                ? 'bg-action text-on-action'
                : 'bg-surface-hover text-secondary hover:bg-control-border'
            }`}
          >
            English
          </PanelButton>
          <PanelButton
            onClick={() => handleLanguageChange('zh')}
            className={`px-3 py-1 text-size-caption rounded-md transition-colors ${
              targetLang === 'zh'
                ? 'bg-action text-on-action'
                : 'bg-surface-hover text-secondary hover:bg-control-border'
            }`}
          >
            中文
          </PanelButton>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-4 mt-4 p-3 bg-danger-subtle border border-danger/25 rounded-md">
          <p className="text-size-caption text-danger">{error}</p>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-2 gap-4 h-full">
          {/* Original */}
          <div className="flex flex-col">
            <div className="mb-2">
              <span className="text-size-caption font-semibold text-secondary uppercase tracking-wide">
                Original
              </span>
            </div>
            <div className="flex-1 p-4 bg-surface-subtle border border-border rounded-lg overflow-y-auto">
              <p className="text-size-subheading text-foreground leading-relaxed whitespace-pre-wrap">
                {originalText}
              </p>
            </div>
          </div>

          {/* Translation */}
          <div className="flex flex-col">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-size-caption font-semibold text-secondary uppercase tracking-wide">
                Translation
              </span>
              {isLoading && (
                <span className="text-size-caption text-action">Loading...</span>
              )}
            </div>
            <div className="flex-1 p-4 bg-action-subtle border border-action-subtle rounded-lg overflow-y-auto">
              {isLoading ? (
                <div className="flex items-center justify-center h-full">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-action"></div>
                </div>
              ) : translation ? (
                <div className="space-y-3">
                  {parsedTranslation.visibleText ? (
                    <p className="text-size-subheading text-foreground leading-relaxed whitespace-pre-wrap">
                      {parsedTranslation.visibleText}
                    </p>
                  ) : (
                    <p className="text-size-subheading text-faint italic">No translation available</p>
                  )}
                  <ThinkingDisclosure
                    thinkingBlocks={parsedTranslation.thinkingBlocks}
                    summaryLabel="Show model thinking"
                  />
                </div>
              ) : (
                <p className="text-size-subheading text-faint italic">No translation available</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
