import { useCallback, useEffect, useRef, useState } from 'react';

type TranslationParagraph = { id: string; text: string };
type TranslateRequest = (text: string, targetLang: 'zh' | 'en', attempts?: number) => Promise<string>;

export function useReaderTranslation({
  translationMode,
  currentSectionId,
  visibleParagraphs,
  translationParallelism,
  autoTranslate,
  getTranslationItems,
  invokeTranslate,
}: {
  translationMode: string;
  currentSectionId: string | null;
  visibleParagraphs: TranslationParagraph[];
  translationParallelism: number;
  autoTranslate: boolean;
  getTranslationItems: (paragraph: TranslationParagraph) => Array<{ key: string; text: string }>;
  invokeTranslate: TranslateRequest;
}) {
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [translationErrors, setTranslationErrors] = useState<Record<string, string>>({});
  const translationsRef = useRef<Record<string, string>>({});
  const inFlightRef = useRef<Set<string>>(new Set());
  const pendingPatchRef = useRef<Record<string, string>>({});
  const flushTimerRef = useRef<number | null>(null);

  const clearFlushTimer = useCallback(() => {
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
  }, []);

  const scheduleFlushTranslations = useCallback(() => {
    if (flushTimerRef.current !== null) return;
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null;
      const patch = pendingPatchRef.current;
      pendingPatchRef.current = {};
      if (Object.keys(patch).length > 0) setTranslations((prev) => ({ ...prev, ...patch }));
    }, 120);
  }, []);

  const translateSentence = useCallback(async (key: string, sentence: string) => {
    if (translationsRef.current[key] || inFlightRef.current.has(key)) return;
    const targetLang = translationMode === 'zh-en' ? 'en' : 'zh';
    inFlightRef.current.add(key);
    try {
      const result = await invokeTranslate(sentence, targetLang, 2);
      translationsRef.current[key] = result;
      pendingPatchRef.current[key] = result;
      setTranslationErrors((prev) => {
        if (!prev[key]) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
      scheduleFlushTranslations();
    } catch (error) {
      console.error('Failed to translate sentence:', error);
      const message = error instanceof Error ? error.message : String(error);
      setTranslationErrors((prev) => ({ ...prev, [key]: message }));
    } finally {
      inFlightRef.current.delete(key);
    }
  }, [invokeTranslate, scheduleFlushTranslations, translationMode]);

  const handleTranslateSentence = useCallback(
    async (paragraphId: string, sentence: string, index: number) => {
      await translateSentence(`${paragraphId}_${index}`, sentence);
    },
    [translateSentence],
  );

  const handleTranslateMarkdownParagraph = useCallback(
    async (paragraphId: string, text: string) => {
      if (text.trim()) await translateSentence(`${paragraphId}__md`, text);
    },
    [translateSentence],
  );

  useEffect(() => {
    if (translationMode === 'off' || !autoTranslate) return;
    let cancelled = false;
    const pending: Array<{ key: string; text: string }> = [];
    visibleParagraphs.forEach((paragraph) => {
      getTranslationItems(paragraph).forEach(({ key, text }) => {
        if (!text.trim()) return;
        if (translationsRef.current[key] || inFlightRef.current.has(key)) return;
        pending.push({ key, text });
      });
    });
    if (pending.length === 0) return;
    const runWorker = async () => {
      while (pending.length > 0 && !cancelled) {
        const item = pending.shift();
        if (!item) return;
        await translateSentence(item.key, item.text);
      }
    };
    void Promise.all(Array.from({ length: Math.min(Math.max(1, translationParallelism), pending.length) }, runWorker));
    return () => {
      cancelled = true;
    };
  }, [autoTranslate, getTranslationItems, translationMode, translationParallelism, translateSentence, visibleParagraphs]);

  useEffect(() => {
    clearFlushTimer();
    pendingPatchRef.current = {};
    translationsRef.current = {};
    inFlightRef.current.clear();
    setTranslations({});
    setTranslationErrors({});
  }, [clearFlushTimer, currentSectionId, translationMode]);

  useEffect(() => clearFlushTimer, [clearFlushTimer]);

  return { translations, translationErrors, handleTranslateSentence, handleTranslateMarkdownParagraph };
}
