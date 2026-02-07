import { useState, useEffect, useRef, type ReactNode, type ReactElement, Children, cloneElement, isValidElement } from 'react';
import { useStore } from '../store/useStore';
import { invoke } from '@tauri-apps/api/core';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { splitIntoSentences } from '../utils/sentences';

const markdownTranslationKey = (paragraphId: string) => `${paragraphId}__md`;

const renderTextWithHighlight = (text: string, query: string): ReactNode => {
  const keyword = query.trim();
  if (!keyword) return text;
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'ig');
  const parts = text.split(regex);
  if (parts.length <= 1) return text;
  return parts.map((part, idx) => {
    if (part.toLowerCase() === keyword.toLowerCase()) {
      return (
        <mark key={`mark-${idx}`} className="bg-yellow-200 text-inherit px-0.5 rounded">
          {part}
        </mark>
      );
    }
    return <span key={`text-${idx}`}>{part}</span>;
  });
};

const highlightMarkdownNode = (node: ReactNode, query: string): ReactNode => {
  if (typeof node === 'string') {
    return renderTextWithHighlight(node, query);
  }
  if (Array.isArray(node)) {
    return node.map((child, idx) => <span key={`hn-${idx}`}>{highlightMarkdownNode(child, query)}</span>);
  }
  if (isValidElement(node)) {
    const element = node as ReactElement<{ children?: ReactNode }>;
    if (element.props.children === undefined) return element;
    return cloneElement(
      element,
      undefined,
      highlightMarkdownNode(element.props.children, query)
    );
  }
  return node;
};

const renderMarkdownChildren = (children: ReactNode, query: string): ReactNode => {
  const keyword = query.trim();
  if (!keyword) return children;
  return Children.map(children, (child) => highlightMarkdownNode(child, keyword));
};

export function ReaderContent() {
  const {
    paragraphs,
    isLoading,
    currentSectionId,
    currentDocumentType,
    translationMode,
    readerBackgroundColor,
    readerFontSize,
    currentReadingSentenceKey,
    focusedParagraphId,
    setFocusedParagraphId,
    searchHighlightQuery,
    searchMatchedParagraphIds,
  } = useStore();
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const sentenceRefs = useRef<Record<string, HTMLParagraphElement | null>>({});
  const paragraphRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const translationsRef = useRef<Record<string, string>>({});
  const inFlightRef = useRef<Set<string>>(new Set());
  const pendingPatchRef = useRef<Record<string, string>>({});
  const flushTimerRef = useRef<number | null>(null);
  const autoTranslate = true;
  const matchedParagraphSet = useRef<Set<string>>(new Set());

  useEffect(() => {
    matchedParagraphSet.current = new Set(searchMatchedParagraphIds);
  }, [searchMatchedParagraphIds]);

  const renderWithSearchHighlight = (text: string, enableHighlight: boolean) => {
    const query = searchHighlightQuery.trim();
    if (!enableHighlight || !query) return text;
    return renderTextWithHighlight(text, query);
  };

  const clearFlushTimer = () => {
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
  };

  const scheduleFlushTranslations = () => {
    if (flushTimerRef.current !== null) return;
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null;
      const patch = pendingPatchRef.current;
      pendingPatchRef.current = {};
      if (Object.keys(patch).length === 0) return;
      setTranslations((prev) => ({ ...prev, ...patch }));
    }, 120);
  };

  // 翻译单个句子
  const translateSentence = async (key: string, sentence: string) => {
    if (translationsRef.current[key] || inFlightRef.current.has(key)) return;

    // 根据设置的翻译方向确定目标语言
    const targetLang = translationMode === 'zh-en' ? 'en' : 'zh';
    inFlightRef.current.add(key);
    try {
      const result = await invoke<string>('translate', {
        text: sentence,
        targetLang,
      });
      translationsRef.current[key] = result;
      pendingPatchRef.current[key] = result;
      scheduleFlushTranslations();
    } catch (error) {
      console.error('Failed to translate sentence:', error);
    } finally {
      inFlightRef.current.delete(key);
    }
  };

  // 点击翻译句子
  const handleTranslateSentence = async (paragraphId: string, sentence: string, index: number) => {
    const key = `${paragraphId}_${index}`;
    await translateSentence(key, sentence);
  };

  // 自动翻译当前章节所有句子（开启双语时）
  useEffect(() => {
    if (translationMode === 'off' || !autoTranslate) return;

    let cancelled = false;
    const pending: Array<{ key: string; text: string }> = [];

    for (const paragraph of paragraphs) {
      if (currentDocumentType === 'markdown') {
        const key = markdownTranslationKey(paragraph.id);
        if (translationsRef.current[key]) continue;
        if (inFlightRef.current.has(key)) continue;
        if (!paragraph.text.trim()) continue;
        pending.push({ key, text: paragraph.text });
        continue;
      }

      const sentences = splitIntoSentences(paragraph.text);
      sentences.forEach((sentence, index) => {
        const key = `${paragraph.id}_${index}`;
        if (translationsRef.current[key]) return;
        if (inFlightRef.current.has(key)) return;
        if (!sentence.trim()) return;
        pending.push({ key, text: sentence });
      });
    }

    if (pending.length === 0) return;

    const maxConcurrency = 3;
    const runWorker = async () => {
      while (pending.length > 0 && !cancelled) {
        const item = pending.shift();
        if (!item) return;
        await translateSentence(item.key, item.text);
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
  }, [translationMode, autoTranslate, paragraphs, currentDocumentType]);

  // 当章节或翻译方向变化时，清空翻译缓存并重建任务
  useEffect(() => {
    clearFlushTimer();
    pendingPatchRef.current = {};
    translationsRef.current = {};
    inFlightRef.current.clear();
    setTranslations({});
  }, [currentSectionId, translationMode]);

  useEffect(() => {
    return () => clearFlushTimer();
  }, []);

  // 跟随当前朗读句子自动滚动
  useEffect(() => {
    if (!currentReadingSentenceKey) return;
    const el = sentenceRefs.current[currentReadingSentenceKey];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const paragraphId = currentReadingSentenceKey.split('_')[0];
    if (!paragraphId) return;
    const paragraphEl = paragraphRefs.current[paragraphId];
    if (!paragraphEl) return;
    paragraphEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [currentReadingSentenceKey]);

  useEffect(() => {
    if (!focusedParagraphId) return;
    const el = paragraphRefs.current[focusedParagraphId];
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const timer = window.setTimeout(() => {
      setFocusedParagraphId(null);
    }, 1600);
    return () => window.clearTimeout(timer);
  }, [focusedParagraphId, setFocusedParagraphId]);

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
      <div className="max-w-4xl mx-auto px-8 py-12">
        <article className="prose max-w-none">
          {paragraphs.map((paragraph) => {
            const sentences = splitIntoSentences(paragraph.text);
            const isSearchMatchedParagraph = matchedParagraphSet.current.has(paragraph.id);
            const shouldHighlightText = isSearchMatchedParagraph && Boolean(searchHighlightQuery.trim());
            const isReadingParagraph = Boolean(
              currentReadingSentenceKey &&
                currentReadingSentenceKey.startsWith(`${paragraph.id}_`)
            );

            return (
              <div
                key={paragraph.id}
                ref={(el) => {
                  paragraphRefs.current[paragraph.id] = el;
                }}
                className={`mb-4 rounded ${
                  focusedParagraphId === paragraph.id ? 'bg-blue-50/70 ring-1 ring-blue-200' : ''
                } ${isSearchMatchedParagraph ? 'bg-yellow-50/60' : ''} ${
                  currentDocumentType === 'markdown' && isReadingParagraph
                    ? 'bg-amber-100/80 ring-1 ring-amber-300'
                    : ''
                }`}
              >
                {currentDocumentType === 'markdown' ? (
                  <div className="space-y-2">
                    <div
                      className="markdown-content text-gray-800"
                      style={{ fontSize: `${readerFontSize}px`, lineHeight: 1.85 }}
                    >
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          h1: ({ children }) => <h1 className="mt-6 mb-3 text-3xl font-bold text-gray-900">{renderMarkdownChildren(children, shouldHighlightText ? searchHighlightQuery : '')}</h1>,
                          h2: ({ children }) => <h2 className="mt-5 mb-3 text-2xl font-bold text-gray-900">{renderMarkdownChildren(children, shouldHighlightText ? searchHighlightQuery : '')}</h2>,
                          h3: ({ children }) => <h3 className="mt-4 mb-2 text-xl font-semibold text-gray-900">{renderMarkdownChildren(children, shouldHighlightText ? searchHighlightQuery : '')}</h3>,
                          h4: ({ children }) => <h4 className="mt-4 mb-2 text-lg font-semibold text-gray-900">{renderMarkdownChildren(children, shouldHighlightText ? searchHighlightQuery : '')}</h4>,
                          h5: ({ children }) => <h5 className="mt-3 mb-2 text-base font-semibold text-gray-900">{renderMarkdownChildren(children, shouldHighlightText ? searchHighlightQuery : '')}</h5>,
                          h6: ({ children }) => <h6 className="mt-3 mb-2 text-sm font-semibold text-gray-900">{renderMarkdownChildren(children, shouldHighlightText ? searchHighlightQuery : '')}</h6>,
                          p: ({ children }) => <p className="my-2 text-gray-800">{renderMarkdownChildren(children, shouldHighlightText ? searchHighlightQuery : '')}</p>,
                          ul: ({ children }) => <ul className="my-2 list-disc pl-6">{renderMarkdownChildren(children, shouldHighlightText ? searchHighlightQuery : '')}</ul>,
                          ol: ({ children }) => <ol className="my-2 list-decimal pl-6">{renderMarkdownChildren(children, shouldHighlightText ? searchHighlightQuery : '')}</ol>,
                          li: ({ children }) => <li className="my-1">{renderMarkdownChildren(children, shouldHighlightText ? searchHighlightQuery : '')}</li>,
                          blockquote: ({ children }) => <blockquote className="my-3 border-l-4 border-gray-300 pl-4 italic text-gray-700">{renderMarkdownChildren(children, shouldHighlightText ? searchHighlightQuery : '')}</blockquote>,
                          code: ({ children }) => (
                            <code className="rounded bg-gray-200 px-1 py-0.5 text-gray-900">
                              {renderMarkdownChildren(children, shouldHighlightText ? searchHighlightQuery : '')}
                            </code>
                          ),
                          pre: ({ children }) => (
                            <pre
                              className="my-3 overflow-x-auto rounded border border-gray-200 bg-gray-50 p-3 text-gray-800"
                              style={{ fontSize: `${Math.max(readerFontSize - 2, 12)}px` }}
                            >
                              {renderMarkdownChildren(children, shouldHighlightText ? searchHighlightQuery : '')}
                            </pre>
                          ),
                          a: ({ href, children }) => (
                            <a href={href} target="_blank" rel="noreferrer" className="text-blue-600 underline hover:text-blue-800">
                              {renderMarkdownChildren(children, shouldHighlightText ? searchHighlightQuery : '')}
                            </a>
                          ),
                          table: ({ children }) => (
                            <div className="my-3 overflow-x-auto">
                              <table className="min-w-full border border-gray-200 text-left">{renderMarkdownChildren(children, shouldHighlightText ? searchHighlightQuery : '')}</table>
                            </div>
                          ),
                          thead: ({ children }) => <thead className="bg-gray-100">{renderMarkdownChildren(children, shouldHighlightText ? searchHighlightQuery : '')}</thead>,
                          th: ({ children }) => <th className="border border-gray-200 px-3 py-2 font-semibold text-gray-800">{renderMarkdownChildren(children, shouldHighlightText ? searchHighlightQuery : '')}</th>,
                          td: ({ children }) => <td className="border border-gray-200 px-3 py-2 text-gray-800">{renderMarkdownChildren(children, shouldHighlightText ? searchHighlightQuery : '')}</td>,
                        }}
                      >
                        {paragraph.text}
                      </ReactMarkdown>
                    </div>
                    {translationMode !== 'off' && (
                      <div className="ml-4 rounded border-l-2 border-blue-200 pl-3">
                        {translations[markdownTranslationKey(paragraph.id)] ? (
                          <div
                            className="markdown-content text-blue-700"
                            style={{ fontSize: `${Math.max(readerFontSize - 3, 12)}px`, lineHeight: 1.75 }}
                          >
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {translations[markdownTranslationKey(paragraph.id)]}
                            </ReactMarkdown>
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                ) : (
                  sentences.map((sentence, index) => {
                    const key = `${paragraph.id}_${index}`;
                    const isReading = currentReadingSentenceKey === key;
                    return (
                      <div key={index} className="mb-2">
                        <p
                          ref={(el) => {
                            sentenceRefs.current[key] = el;
                          }}
                          className={isReading ? 'text-gray-900 rounded px-2 py-1 bg-amber-100 border border-amber-300' : 'text-gray-800'}
                          style={{ fontSize: `${readerFontSize}px`, lineHeight: 1.85 }}
                        >
                          {renderWithSearchHighlight(sentence, isSearchMatchedParagraph)}
                        </p>
                        {translationMode !== 'off' && (
                          <div className="flex items-center gap-2 ml-4">
                            {translations[key] ? (
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
                  })
                )}
              </div>
            );
          })}
        </article>
      </div>
    </div>
  );
}
