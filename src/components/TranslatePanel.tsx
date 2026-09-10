import React, { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../store/useStore';
import { Checkbox } from './ui/Checkbox';
import { Button } from './ui/Button';
import { Textarea } from './ui/Textarea';
import { ThinkingDisclosure } from './ThinkingDisclosure';
import { parseThinkingBlocks } from '../utils/thinking';

type TargetLang = 'zh' | 'en';

type TranslateRequest = {
  id: number;
  selectedText: string;
  autoRun?: boolean;
} | null;

type TranslatePanelProps = {
  request?: TranslateRequest;
};

export const TranslatePanel: React.FC<TranslatePanelProps> = ({ request }) => {
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
  const parsedTranslation = useMemo(() => parseThinkingBlocks(translation), [translation]);

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

  const runTranslate = async (inputText?: string) => {
    const raw = inputText ?? text;
    const hasText = raw.trim();
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
        text: hasText ? hasText : undefined,
        paragraphId: hasParagraph && !hasText ? currentParagraph.id : undefined,
        targetLang: effectiveTarget,
      });
      setTranslation(result);
    } catch (err) {
      console.error('Translate failed:', err);
      const message = err instanceof Error ? err.message : 'Translation failed';
      if (message.toLowerCase().includes('timed out')) {
        setError('Translation timed out. Please retry with shorter text or check model/network.');
      } else {
        setError(message);
      }
      setTranslation('');
    } finally {
      setIsTranslating(false);
    }
  };

  useEffect(() => {
    const selectedText = request?.selectedText?.trim();
    if (!selectedText) return;
    setText(selectedText);
    setTranslation('');
    if (request?.autoRun) {
      void runTranslate(selectedText);
    }
  }, [request?.id, request?.selectedText, request?.autoRun]);

  const handleTranslate = async () => {
    await runTranslate();
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
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-4 mb-3">
          <span className="text-size-subheading font-medium text-secondary">Target Language:</span>
          <div className="flex gap-2">
            {(['en', 'zh'] as TargetLang[]).map((lang) => (
              <Button
                variant={targetLang === lang ? 'primary' : 'secondary'}
                size="sm"
                key={lang}
                onClick={() => setTargetLang(lang)}
                className={`rounded-lg text-size-control ${
                  targetLang === lang
                    ? ''
                    : 'bg-surface-subtle hover:bg-surface-hover'
                }`}
              >
                {getLanguageName(lang)}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-size-subheading text-secondary">
            <Checkbox
              checked={autoDetect}
              onChange={(e) => setAutoDetect(e.target.checked)}
              className="h-4 w-4"
            />
            Auto-detect target language
          </label>
          <Button
            variant="secondary"
            size="sm"
            onClick={useCurrentParagraph}
            disabled={!currentParagraph}
            className="rounded-lg bg-surface-subtle text-size-control hover:bg-surface-hover"
          >
            Use Current Paragraph
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleTranslate}
            disabled={isTranslating || (!text.trim() && !currentParagraph)}
            className="rounded-lg px-4 text-size-control"
          >
            {isTranslating ? 'Translating...' : 'Translate'}
          </Button>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="p-4 bg-danger-subtle border-b border-danger/25">
          <p className="text-size-subheading text-danger">{error}</p>
        </div>
      )}

      {/* Input/Output */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-4">
          {/* Input */}
          <div>
            <label className="block text-size-subheading font-medium text-secondary mb-2">
              Original Text
            </label>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Enter text to translate or click 'Use Current Paragraph'"
              className="w-full resize-none rounded-lg p-3"
              rows={8}
            />
          </div>

          {/* Output */}
          <div>
            <label className="block text-size-subheading font-medium text-secondary mb-2">
              Translation
            </label>
            {translation ? (
              <div className="w-full p-3 bg-action-subtle border border-action-subtle rounded-lg min-h-[200px]">
                {parsedTranslation.visibleText ? (
                  <p className="text-foreground leading-relaxed whitespace-pre-wrap">
                    {parsedTranslation.visibleText}
                  </p>
                ) : (
                  <p className="text-size-subheading text-faint italic">No translation available</p>
                )}
                <ThinkingDisclosure
                  thinkingBlocks={parsedTranslation.thinkingBlocks}
                  summaryLabel="Show model thinking"
                  className={parsedTranslation.visibleText ? 'mt-3' : ''}
                />
              </div>
            ) : (
              <div className="w-full p-3 bg-surface-subtle border border-border rounded-lg min-h-[200px] flex items-center justify-center text-faint">
                <p className="text-size-subheading">Translation will appear here</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
