import { useState, useEffect, useRef, useMemo, type ReactNode, type ReactElement, Children, cloneElement, isValidElement } from 'react';
import { useStore } from '../store/useStore';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { splitIntoSentences } from '../utils/sentences';
import type { Annotation, AnnotationStyle } from '../types';

const markdownTranslationKey = (paragraphId: string) => `${paragraphId}__md`;
const PDF_IMAGE_MARKER_RE = /^\[\[PDF_IMAGE:(.+)\]\]$/;
const annotationStyleOrder: AnnotationStyle[] = ['single_underline', 'double_underline', 'wavy_strikethrough'];
const annotationStyleLabel: Record<AnnotationStyle, string> = {
  single_underline: '单下划线',
  double_underline: '双下划线',
  wavy_strikethrough: '波浪删除线',
};

type SelectionDraft = {
  paragraphId: string;
  selectedText: string;
  style: AnnotationStyle;
  note: string;
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const renderTextWithHighlight = (text: string, query: string): ReactNode => {
  const keyword = query.trim();
  if (!keyword) return text;
  const escaped = escapeRegExp(keyword);
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

const annotationClassName = (style: AnnotationStyle) => {
  if (style === 'double_underline') {
    return 'decoration-2 underline decoration-double decoration-emerald-600 underline-offset-2';
  }
  if (style === 'wavy_strikethrough') {
    return 'line-through decoration-rose-500 decoration-wavy decoration-2';
  }
  return 'underline decoration-2 decoration-sky-600 underline-offset-2';
};

const renderTextWithAnnotation = (text: string, annotation: Annotation, keyPrefix: string): ReactNode => {
  const target = annotation.selected_text.trim();
  if (!target) return text;
  const regex = new RegExp(`(${escapeRegExp(target)})`, 'ig');
  const parts = text.split(regex);
  if (parts.length <= 1) return text;
  return parts.map((part, idx) => {
    if (part.toLowerCase() === target.toLowerCase()) {
      return (
        <span
          key={`${keyPrefix}-a-${annotation.id}-${idx}`}
          className={`${annotationClassName(annotation.style)} rounded-sm px-0.5`}
          title={annotation.note || annotationStyleLabel[annotation.style]}
        >
          {part}
        </span>
      );
    }
    return <span key={`${keyPrefix}-t-${annotation.id}-${idx}`}>{part}</span>;
  });
};

const mapTextNodes = (
  node: ReactNode,
  mapper: (text: string, keyPrefix: string) => ReactNode,
  keyPrefix: string,
): ReactNode => {
  if (typeof node === 'string') {
    return mapper(node, keyPrefix);
  }
  if (Array.isArray(node)) {
    return node.map((child, idx) => (
      <span key={`${keyPrefix}-n-${idx}`}>{mapTextNodes(child, mapper, `${keyPrefix}-${idx}`)}</span>
    ));
  }
  if (isValidElement(node)) {
    const element = node as ReactElement<{ children?: ReactNode }>;
    if (element.props.children === undefined) return element;
    return cloneElement(
      element,
      undefined,
      mapTextNodes(element.props.children, mapper, `${keyPrefix}-c`)
    );
  }
  return node;
};

const renderTextWithDecorations = (
  text: string,
  searchQuery: string,
  annotations: Annotation[],
  keyPrefix: string,
): ReactNode => {
  let rendered: ReactNode = text;
  for (const annotation of annotations) {
    rendered = mapTextNodes(
      rendered,
      (chunk, chunkKey) => renderTextWithAnnotation(chunk, annotation, `${keyPrefix}-${chunkKey}`),
      `${keyPrefix}-${annotation.id}`
    );
  }
  if (searchQuery.trim()) {
    rendered = mapTextNodes(
      rendered,
      (chunk) => renderTextWithHighlight(chunk, searchQuery),
      `${keyPrefix}-search`
    );
  }
  return rendered;
};

const highlightMarkdownNode = (node: ReactNode, query: string, annotations: Annotation[], keyPrefix: string): ReactNode => {
  if (typeof node === 'string') {
    return renderTextWithDecorations(node, query, annotations, keyPrefix);
  }
  if (Array.isArray(node)) {
    return node.map((child, idx) => <span key={`hn-${idx}`}>{highlightMarkdownNode(child, query, annotations, `${keyPrefix}-${idx}`)}</span>);
  }
  if (isValidElement(node)) {
    const element = node as ReactElement<{ children?: ReactNode }>;
    if (element.props.children === undefined) return element;
    return cloneElement(
      element,
      undefined,
      highlightMarkdownNode(element.props.children, query, annotations, `${keyPrefix}-c`)
    );
  }
  return node;
};

const renderMarkdownChildren = (children: ReactNode, query: string, annotations: Annotation[], keyPrefix: string): ReactNode => {
  const keyword = query.trim();
  if (!keyword && annotations.length === 0) return children;
  return Children.map(children, (child, idx) => highlightMarkdownNode(child, keyword, annotations, `${keyPrefix}-${idx}`));
};

const parsePdfImageMarker = (text: string): string | null => {
  const m = text.trim().match(PDF_IMAGE_MARKER_RE);
  if (!m) return null;
  const path = m[1]?.trim();
  return path || null;
};

const parsePdfPageFromLocation = (location?: string): number | null => {
  if (!location) return null;
  const m = location.match(/page(\d+)/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function ReaderContent() {
  const {
    documents,
    selectedDocumentId,
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
  const [annotationsByParagraph, setAnnotationsByParagraph] = useState<Record<string, Annotation[]>>({});
  const [selectionDraft, setSelectionDraft] = useState<SelectionDraft | null>(null);
  const [isAnnotationPanelOpen, setIsAnnotationPanelOpen] = useState(false);
  const [pdfDisplayMode, setPdfDisplayMode] = useState<'text' | 'original'>('text');
  const sentenceRefs = useRef<Record<string, HTMLParagraphElement | null>>({});
  const paragraphRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const contentRef = useRef<HTMLDivElement | null>(null);
  const translationsRef = useRef<Record<string, string>>({});
  const inFlightRef = useRef<Set<string>>(new Set());
  const pendingPatchRef = useRef<Record<string, string>>({});
  const flushTimerRef = useRef<number | null>(null);
  const autoTranslate = true;
  const matchedParagraphSet = useRef<Set<string>>(new Set());

  useEffect(() => {
    matchedParagraphSet.current = new Set(searchMatchedParagraphIds);
  }, [searchMatchedParagraphIds]);

  const allAnnotations = useMemo(
    () =>
      Object.values(annotationsByParagraph)
        .flat()
        .sort((a, b) => b.created_at - a.created_at),
    [annotationsByParagraph]
  );
  const selectedDoc = documents.find((doc) => doc.id === selectedDocumentId) || null;
  const currentPdfPath = currentDocumentType === 'pdf' ? selectedDoc?.file_path || '' : '';

  const renderWithSearchHighlight = (text: string, enableHighlight: boolean, paragraphAnnotations: Annotation[], keyPrefix: string) => {
    const query = searchHighlightQuery.trim();
    const effectiveQuery = enableHighlight ? query : '';
    return renderTextWithDecorations(text, effectiveQuery, paragraphAnnotations, keyPrefix);
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

  useEffect(() => {
    const paragraphIds = paragraphs.map((item) => item.id);
    if (paragraphIds.length === 0) {
      setAnnotationsByParagraph({});
      return;
    }

    let cancelled = false;
    const load = async () => {
      try {
        const rows = await invoke<Annotation[]>('list_annotations', { paragraphIds });
        if (cancelled) return;
        const grouped: Record<string, Annotation[]> = {};
        for (const item of rows) {
          if (!grouped[item.paragraph_id]) {
            grouped[item.paragraph_id] = [];
          }
          grouped[item.paragraph_id].push(item);
        }
        setAnnotationsByParagraph(grouped);
      } catch (err) {
        console.error('Failed to load annotations:', err);
      }
    };
    void load();

    return () => {
      cancelled = true;
    };
  }, [paragraphs]);

  const clearSelectionDraft = () => {
    setSelectionDraft(null);
    const selection = window.getSelection();
    selection?.removeAllRanges();
  };

  const handleSelectionEnd = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-annotation-popover="true"]')) {
      return;
    }
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      setSelectionDraft(null);
      return;
    }
    const selectedText = selection.toString().trim();
    if (!selectedText) {
      setSelectionDraft(null);
      return;
    }
    const range = selection.getRangeAt(0);
    const origin = range.commonAncestorContainer;
    const baseElement = origin.nodeType === Node.ELEMENT_NODE
      ? (origin as Element)
      : origin.parentElement;
    const paragraphEl = baseElement?.closest('[data-paragraph-id]');
    const paragraphId = paragraphEl?.getAttribute('data-paragraph-id');
    if (!paragraphId) {
      setSelectionDraft(null);
      return;
    }

    setSelectionDraft({
      paragraphId,
      selectedText: selectedText.slice(0, 300),
      style: 'single_underline',
      note: '',
    });
  };

  const handleCreateAnnotation = async () => {
    if (!selectionDraft) return;
    try {
      const created = await invoke<Annotation>('create_annotation', {
        paragraphId: selectionDraft.paragraphId,
        selectedText: selectionDraft.selectedText,
        style: selectionDraft.style,
        note: selectionDraft.note,
      });
      setAnnotationsByParagraph((prev) => {
        const list = prev[created.paragraph_id] || [];
        return {
          ...prev,
          [created.paragraph_id]: [created, ...list],
        };
      });
      clearSelectionDraft();
    } catch (err) {
      console.error('Failed to create annotation:', err);
    }
  };

  const handleDeleteAnnotation = async (annotationId: string, paragraphId: string) => {
    try {
      await invoke('delete_annotation', { id: annotationId });
      setAnnotationsByParagraph((prev) => ({
        ...prev,
        [paragraphId]: (prev[paragraphId] || []).filter((item) => item.id !== annotationId),
      }));
    } catch (err) {
      console.error('Failed to delete annotation:', err);
    }
  };

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
    <div
      ref={contentRef}
      className="flex-1 overflow-y-auto"
      style={{ backgroundColor: readerBackgroundColor }}
      onMouseUp={handleSelectionEnd}
    >
      <div className="max-w-4xl mx-auto px-8 py-12">
        {currentDocumentType === 'pdf' && (
          <div className="mb-4 flex items-center justify-end gap-2">
            <button
              onClick={() => setPdfDisplayMode('text')}
              className={`rounded-lg border px-3 py-1.5 text-sm ${
                pdfDisplayMode === 'text'
                  ? 'border-blue-600 bg-blue-50 text-blue-700'
                  : 'border-slate-300 bg-white text-slate-700'
              }`}
            >
              文本解析
            </button>
            <button
              onClick={() => setPdfDisplayMode('original')}
              className={`rounded-lg border px-3 py-1.5 text-sm ${
                pdfDisplayMode === 'original'
                  ? 'border-blue-600 bg-blue-50 text-blue-700'
                  : 'border-slate-300 bg-white text-slate-700'
              }`}
            >
              PDF原文
            </button>
          </div>
        )}
        {currentDocumentType === 'pdf' && pdfDisplayMode === 'original' && currentPdfPath ? (
          <section className="rounded-lg border border-slate-200 bg-white p-2">
            <iframe
              title="PDF Original Viewer"
              src={convertFileSrc(currentPdfPath)}
              className="h-[82vh] w-full rounded"
            />
          </section>
        ) : (
        <>
          <div className="mb-4 flex justify-end">
            <button
              data-annotation-popover="true"
              onClick={() => setIsAnnotationPanelOpen(true)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:border-slate-400 hover:bg-slate-50"
            >
              批注与划线 ({allAnnotations.length})
            </button>
          </div>
          <article className="prose max-w-none">
          {paragraphs.map((paragraph) => {
            const sentences = splitIntoSentences(paragraph.text);
            const isSearchMatchedParagraph = matchedParagraphSet.current.has(paragraph.id);
            const shouldHighlightText = isSearchMatchedParagraph && Boolean(searchHighlightQuery.trim());
            const paragraphAnnotations = annotationsByParagraph[paragraph.id] || [];
            const currentPage = parsePdfPageFromLocation(paragraph.location);
            const shouldShowPdfPreview = false;
            const isReadingParagraph = Boolean(
              currentReadingSentenceKey &&
                currentReadingSentenceKey.startsWith(`${paragraph.id}_`)
            );

            return (
              <div key={paragraph.id}>
                {shouldShowPdfPreview && (
                  <section className="mb-3 rounded-lg border border-slate-200 bg-white p-2">
                    <div className="mb-2 text-xs text-slate-500">Page {currentPage}</div>
                    <iframe
                      title={`PDF Page ${currentPage}`}
                      src={`${convertFileSrc(currentPdfPath)}#page=${currentPage}&zoom=page-width`}
                      className="h-[70vh] w-full rounded"
                    />
                  </section>
                )}
                <div
                  ref={(el) => {
                    paragraphRefs.current[paragraph.id] = el;
                  }}
                  data-paragraph-id={paragraph.id}
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
                          h1: ({ children }) => <h1 className="mt-6 mb-3 text-3xl font-bold text-gray-900">{renderMarkdownChildren(children, shouldHighlightText ? searchHighlightQuery : '', paragraphAnnotations, `h1-${paragraph.id}`)}</h1>,
                          h2: ({ children }) => <h2 className="mt-5 mb-3 text-2xl font-bold text-gray-900">{renderMarkdownChildren(children, shouldHighlightText ? searchHighlightQuery : '', paragraphAnnotations, `h2-${paragraph.id}`)}</h2>,
                          h3: ({ children }) => <h3 className="mt-4 mb-2 text-xl font-semibold text-gray-900">{renderMarkdownChildren(children, shouldHighlightText ? searchHighlightQuery : '', paragraphAnnotations, `h3-${paragraph.id}`)}</h3>,
                          h4: ({ children }) => <h4 className="mt-4 mb-2 text-lg font-semibold text-gray-900">{renderMarkdownChildren(children, shouldHighlightText ? searchHighlightQuery : '', paragraphAnnotations, `h4-${paragraph.id}`)}</h4>,
                          h5: ({ children }) => <h5 className="mt-3 mb-2 text-base font-semibold text-gray-900">{renderMarkdownChildren(children, shouldHighlightText ? searchHighlightQuery : '', paragraphAnnotations, `h5-${paragraph.id}`)}</h5>,
                          h6: ({ children }) => <h6 className="mt-3 mb-2 text-sm font-semibold text-gray-900">{renderMarkdownChildren(children, shouldHighlightText ? searchHighlightQuery : '', paragraphAnnotations, `h6-${paragraph.id}`)}</h6>,
                          p: ({ children }) => <p className="my-2 text-gray-800">{renderMarkdownChildren(children, shouldHighlightText ? searchHighlightQuery : '', paragraphAnnotations, `p-${paragraph.id}`)}</p>,
                          ul: ({ children }) => <ul className="my-2 list-disc pl-6">{renderMarkdownChildren(children, shouldHighlightText ? searchHighlightQuery : '', paragraphAnnotations, `ul-${paragraph.id}`)}</ul>,
                          ol: ({ children }) => <ol className="my-2 list-decimal pl-6">{renderMarkdownChildren(children, shouldHighlightText ? searchHighlightQuery : '', paragraphAnnotations, `ol-${paragraph.id}`)}</ol>,
                          li: ({ children }) => <li className="my-1">{renderMarkdownChildren(children, shouldHighlightText ? searchHighlightQuery : '', paragraphAnnotations, `li-${paragraph.id}`)}</li>,
                          blockquote: ({ children }) => <blockquote className="my-3 border-l-4 border-gray-300 pl-4 italic text-gray-700">{renderMarkdownChildren(children, shouldHighlightText ? searchHighlightQuery : '', paragraphAnnotations, `quote-${paragraph.id}`)}</blockquote>,
                          code: ({ children }) => (
                            <code className="rounded bg-gray-200 px-1 py-0.5 text-gray-900">
                              {renderMarkdownChildren(children, shouldHighlightText ? searchHighlightQuery : '', paragraphAnnotations, `code-${paragraph.id}`)}
                            </code>
                          ),
                          pre: ({ children }) => (
                            <pre
                              className="my-3 overflow-x-auto rounded border border-gray-200 bg-gray-50 p-3 text-gray-800"
                              style={{ fontSize: `${Math.max(readerFontSize - 2, 12)}px` }}
                            >
                              {renderMarkdownChildren(children, shouldHighlightText ? searchHighlightQuery : '', paragraphAnnotations, `pre-${paragraph.id}`)}
                            </pre>
                          ),
                          a: ({ href, children }) => (
                            <a href={href} target="_blank" rel="noreferrer" className="text-blue-600 underline hover:text-blue-800">
                              {renderMarkdownChildren(children, shouldHighlightText ? searchHighlightQuery : '', paragraphAnnotations, `a-${paragraph.id}`)}
                            </a>
                          ),
                          table: ({ children }) => (
                            <div className="my-3 overflow-x-auto">
                              <table className="min-w-full border border-gray-200 text-left">{renderMarkdownChildren(children, shouldHighlightText ? searchHighlightQuery : '', paragraphAnnotations, `table-${paragraph.id}`)}</table>
                            </div>
                          ),
                          thead: ({ children }) => <thead className="bg-gray-100">{renderMarkdownChildren(children, shouldHighlightText ? searchHighlightQuery : '', paragraphAnnotations, `thead-${paragraph.id}`)}</thead>,
                          th: ({ children }) => <th className="border border-gray-200 px-3 py-2 font-semibold text-gray-800">{renderMarkdownChildren(children, shouldHighlightText ? searchHighlightQuery : '', paragraphAnnotations, `th-${paragraph.id}`)}</th>,
                          td: ({ children }) => <td className="border border-gray-200 px-3 py-2 text-gray-800">{renderMarkdownChildren(children, shouldHighlightText ? searchHighlightQuery : '', paragraphAnnotations, `td-${paragraph.id}`)}</td>,
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
                  (() => {
                    const imagePath = parsePdfImageMarker(paragraph.text);
                    if (imagePath) {
                      return (
                        <figure className="my-3">
                          <img
                            src={convertFileSrc(imagePath)}
                            alt="PDF image"
                            className="max-h-[36rem] w-auto max-w-full rounded border border-gray-200 object-contain"
                          />
                        </figure>
                      );
                    }
                    return sentences.map((sentence, index) => {
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
                          {renderWithSearchHighlight(sentence, isSearchMatchedParagraph, paragraphAnnotations, `${paragraph.id}-${index}`)}
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
                    });
                  })()
                )}
                </div>
              </div>
            );
          })}
          </article>
        </>
        )}
      </div>
      {selectionDraft && (
        <div
          data-annotation-popover="true"
          className="fixed bottom-6 left-1/2 z-50 w-[min(92vw,28rem)] -translate-x-1/2 rounded-lg border border-gray-200 bg-white p-3 shadow-xl"
          onMouseDown={(e) => e.stopPropagation()}
          onMouseUp={(e) => e.stopPropagation()}
        >
          <p className="mb-2 line-clamp-2 text-xs text-gray-600">“{selectionDraft.selectedText}”</p>
          <div className="mb-2 flex items-center gap-2">
            {annotationStyleOrder.map((style) => (
              <button
                key={style}
                onClick={() => setSelectionDraft((prev) => (prev ? { ...prev, style } : prev))}
                className={`rounded border px-2 py-1 text-xs ${
                  selectionDraft.style === style
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-300 text-gray-700 hover:border-gray-400'
                }`}
              >
                {annotationStyleLabel[style]}
              </button>
            ))}
          </div>
          <textarea
            value={selectionDraft.note}
            onChange={(e) => setSelectionDraft((prev) => (prev ? { ...prev, note: e.target.value } : prev))}
            placeholder="批注内容（可选）"
            rows={3}
            className="mb-2 w-full resize-none rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="flex justify-end gap-2">
            <button onClick={clearSelectionDraft} className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700">
              取消
            </button>
            <button
              onClick={() => void handleCreateAnnotation()}
              className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700"
            >
              添加批注
            </button>
          </div>
        </div>
      )}
      {isAnnotationPanelOpen && (
        <>
          <div
            data-annotation-popover="true"
            className="fixed inset-0 z-40 bg-black/20"
            onClick={() => setIsAnnotationPanelOpen(false)}
          />
          <aside
            data-annotation-popover="true"
            className="fixed right-0 top-0 z-50 h-full w-[min(92vw,26rem)] border-l border-slate-200 bg-white p-4 shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
            onMouseUp={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center">
              <h3 className="text-base font-semibold text-slate-800">批注与划线 ({allAnnotations.length})</h3>
              <button
                onClick={() => setIsAnnotationPanelOpen(false)}
                className="ml-auto rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
              >
                关闭
              </button>
            </div>
            {allAnnotations.length === 0 ? (
              <p className="text-sm text-slate-500">暂无批注。选中文本后可创建。</p>
            ) : (
              <div className="h-[calc(100%-3rem)] space-y-2 overflow-y-auto pr-1">
                {allAnnotations.map((item) => (
                  <div key={item.id} className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="mb-1 flex items-center gap-2">
                      <span className="rounded bg-white px-2 py-0.5 text-xs text-slate-700">
                        {annotationStyleLabel[item.style]}
                      </span>
                      <button
                        onClick={() => {
                          setFocusedParagraphId(item.paragraph_id);
                          setIsAnnotationPanelOpen(false);
                        }}
                        className="text-xs text-blue-600 underline-offset-2 hover:underline"
                      >
                        跳转定位
                      </button>
                      <button
                        onClick={() => void handleDeleteAnnotation(item.id, item.paragraph_id)}
                        className="ml-auto text-xs text-rose-600 underline-offset-2 hover:underline"
                      >
                        删除
                      </button>
                    </div>
                    <p className="text-sm text-slate-800">“{item.selected_text}”</p>
                    {item.note && item.note.trim().length > 0 && (
                      <p className="mt-1 text-xs text-amber-800">批注: {item.note}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </aside>
        </>
      )}
    </div>
  );
}
