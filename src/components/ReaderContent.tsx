import { useState, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { invoke } from '@tauri-apps/api/core';
import { splitIntoSentences } from '../utils/sentences';

export function ReaderContent() {
  const {
    paragraphs,
    isLoading,
    currentSectionId,
    translationMode,
    readerBackgroundColor,
    readerFontSize,
    currentReadingSentenceKey,
  } = useStore();
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [loadingSentences, setLoadingSentences] = useState<Set<string>>(new Set());
  const autoTranslate = true;

  // 翻译单个句子
  const translateSentence = async (paragraphId: string, sentence: string, index: number) => {
    const key = `${paragraphId}_${index}`;
    if (translations[key]) return;

    // 根据设置的翻译方向确定目标语言
    const targetLang = translationMode === 'zh-en' ? 'en' : 'zh';

    setLoadingSentences(prev => new Set(prev).add(key));
    try {
      const result = await invoke<string>('translate', {
        text: sentence,
        targetLang
      });
      setTranslations(prev => ({
        ...prev,
        [key]: result
      }));
    } catch (error) {
      console.error('Failed to translate sentence:', error);
    } finally {
      setLoadingSentences(prev => {
        const newSet = new Set(prev);
        newSet.delete(key);
        return newSet;
      });
    }
  };

  // 点击翻译句子
  const handleTranslateSentence = async (paragraphId: string, sentence: string, index: number) => {
    await translateSentence(paragraphId, sentence, index);
  };

  // 自动翻译当前章节所有句子（开启双语时）
  useEffect(() => {
    if (translationMode === 'off' || !autoTranslate) return;

    let cancelled = false;
    const pending: Array<{ paragraphId: string; sentence: string; index: number }> = [];

    for (const paragraph of paragraphs) {
      const sentences = splitIntoSentences(paragraph.text);
      sentences.forEach((sentence, index) => {
        const key = `${paragraph.id}_${index}`;
        if (translations[key]) return;
        if (loadingSentences.has(key)) return;
        if (!sentence.trim()) return;
        pending.push({ paragraphId: paragraph.id, sentence, index });
      });
    }

    if (pending.length === 0) return;

    const maxConcurrency = 3;
    const runWorker = async () => {
      while (pending.length > 0 && !cancelled) {
        const item = pending.shift();
        if (!item) return;
        await translateSentence(item.paragraphId, item.sentence, item.index);
      }
    };

    const workers = Array.from(
      { length: Math.min(maxConcurrency, pending.length) },
      () => runWorker()
    );

    void Promise.all(workers);

    return () => {
      cancelled = true;
    };
  }, [translationMode, autoTranslate, paragraphs, translations, loadingSentences]);

  // 当翻译方向变化时，清空翻译缓存
  useEffect(() => {
    if (translationMode !== 'off') {
      setTranslations({});
      setLoadingSentences(new Set());
    }
  }, [translationMode]);

  // 关闭双语模式时清空翻译缓存
  useEffect(() => {
    if (translationMode === 'off') {
      setTranslations({});
      setLoadingSentences(new Set());
    }
  }, [translationMode]);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ backgroundColor: readerBackgroundColor }}>
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="mt-2 text-sm text-gray-600">Loading content...</p>
        </div>
      </div>
    );
  }

  if (paragraphs.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ backgroundColor: readerBackgroundColor }}>
        <p className="text-gray-500">
          {currentSectionId
            ? 'No content extracted for this section. The parser may have failed.'
            : 'Select a section from the table of contents'}
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto" style={{ backgroundColor: readerBackgroundColor }}>
      <div className="max-w-3xl mx-auto px-8 py-12">
        <article className="prose max-w-none">
          {paragraphs.map((paragraph) => {
            const sentences = splitIntoSentences(paragraph.text);
            return (
              <div key={paragraph.id} className="mb-4">
                {sentences.map((sentence, index) => {
                  const key = `${paragraph.id}_${index}`;
                  const isReading = currentReadingSentenceKey === key;
                  return (
                    <div key={index} className="mb-2">
                      <p
                        className={isReading ? 'text-gray-900 rounded px-2 py-1 bg-amber-100 border border-amber-300' : 'text-gray-800'}
                        style={{ fontSize: `${readerFontSize}px`, lineHeight: 1.85 }}
                      >
                        {sentence}
                      </p>
                      {translationMode !== 'off' && (
                        <div className="flex items-center gap-2 ml-4">
                          {loadingSentences.has(key) ? (
                            <p
                              className="text-blue-600"
                              style={{ fontSize: `${Math.max(readerFontSize - 3, 12)}px`, lineHeight: 1.75 }}
                            >
                              Loading...
                            </p>
                          ) : translations[key] ? (
                            <p
                              className="text-blue-600"
                              style={{ fontSize: `${Math.max(readerFontSize - 3, 12)}px`, lineHeight: 1.75 }}
                            >
                              {translations[key]}
                            </p>
                          ) : (
                            <button
                              onClick={() => handleTranslateSentence(paragraph.id, sentence, index)}
                              className="text-xs text-blue-600 hover:text-blue-800 underline"
                            >
                              Translate
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </article>
      </div>
    </div>
  );
}
