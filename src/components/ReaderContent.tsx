import { useState, useEffect, useRef, useMemo, type ReactNode, type ReactElement, Children, cloneElement, isValidElement } from 'react';
import { useStore } from '../store/useStore';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { parseSentenceKey, splitIntoSentences, toSpeakableText } from '../utils/sentences';
import type { Annotation, AnnotationStyle } from '../types';
import {
  READER_THEMES,
  VIEW_SETTINGS_KEY,
  loadReaderViewSettings,
  type ReaderViewSettings,
} from './readerTheme';

const markdownTranslationKey = (paragraphId: string) => `${paragraphId}__md`;
const PDF_IMAGE_MARKER_RE = /^\[\[PDF_IMAGE:(.+)\]\]$/;
const annotationStyleOrder: AnnotationStyle[] = ['single_underline', 'double_underline', 'wavy_strikethrough'];
const annotationStyleLabel: Record<AnnotationStyle, string> = {
  single_underline: 'Single Underline',
  double_underline: 'Double Underline',
  wavy_strikethrough: 'Wavy Strikethrough',
};

type SelectionDraft = {
  paragraphId: string;
  selectedText: string;
  style: AnnotationStyle;
  note: string;
};

type SelectionAction = 'ask' | 'play' | 'explain' | 'dict' | 'sentence' | 'copy' | 'highlight' | 'note';
type SelectionActionMode = 'highlight' | 'note' | null;
const ALL_SELECTION_ACTIONS: SelectionAction[] = ['ask', 'play', 'explain', 'dict', 'sentence', 'copy', 'highlight', 'note'];

const selectionActionLabel: Record<SelectionAction, string> = {
  ask: 'Ask',
  play: 'Read Aloud',
  explain: 'Explain',
  dict: 'Dict',
  sentence: 'Sentence',
  copy: 'Copy',
  highlight: 'Highlight',
  note: 'Take Note',
};
const selectionActionIcon: Record<SelectionAction, string> = {
  ask: '✦',
  play: '▶',
  explain: '⌕',
  dict: '📘',
  sentence: '∑',
  copy: '⧉',
  highlight: '＿',
  note: '✎',
};
const DEFAULT_SELECTION_POPOVER_WIDTH = 540;

const normalizeSelectionActionOrder = (input: SelectionAction[]): SelectionAction[] => {
  const dedup = input.filter((item, index) => input.indexOf(item) === index);
  const valid = dedup.filter((item): item is SelectionAction => ALL_SELECTION_ACTIONS.includes(item));
  const missing = ALL_SELECTION_ACTIONS.filter((item) => !valid.includes(item));
  return [...valid, ...missing];
};

type AudiobookStartEventDetail = {
  sentenceKey?: string;
  paragraphId?: string;
};

type DictRequestEventDetail = {
  mode: 'dict' | 'sentence';
  selectedText: string;
  sentence: string;
  paragraphId?: string;
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

const normalizeTextWithMap = (input: string): { normalized: string; map: number[] } => {
  const normalizedChars: string[] = [];
  const map: number[] = [];
  let previousWasSpace = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (/\s/.test(ch)) {
      if (previousWasSpace) continue;
      normalizedChars.push(' ');
      map.push(i);
      previousWasSpace = true;
      continue;
    }
    normalizedChars.push(ch.toLowerCase());
    map.push(i);
    previousWasSpace = false;
  }

  return {
    normalized: normalizedChars.join(''),
    map,
  };
};

const READING_MARK_SELECTOR = 'mark[data-reading-sentence="true"]';

const clearReadingSentenceMarks = (root: ParentNode) => {
  const marks = root.querySelectorAll<HTMLElement>(READING_MARK_SELECTOR);
  marks.forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) {
      parent.insertBefore(mark.firstChild, mark);
    }
    parent.removeChild(mark);
    parent.normalize();
  });
};

const collectTextNodes = (root: Node): Text[] => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    if (current.nodeValue && current.nodeValue.length > 0) {
      nodes.push(current as Text);
    }
    current = walker.nextNode();
  }
  return nodes;
};

const locateTextOffset = (
  textNodes: Text[],
  absoluteOffset: number
): { node: Text; offset: number } | null => {
  let consumed = 0;
  for (const node of textNodes) {
    const length = node.data.length;
    if (absoluteOffset <= consumed + length) {
      return { node, offset: Math.max(0, absoluteOffset - consumed) };
    }
    consumed += length;
  }
  const last = textNodes[textNodes.length - 1];
  return last ? { node: last, offset: last.data.length } : null;
};

const highlightSentenceInElement = (element: HTMLElement, sentence: string): HTMLElement | null => {
  const sentenceNorm = normalizeTextWithMap(sentence).normalized.trim();
  if (!sentenceNorm) return null;

  const textNodes = collectTextNodes(element);
  if (textNodes.length === 0) return null;
  const mergedText = textNodes.map((item) => item.data).join('');
  const mergedNorm = normalizeTextWithMap(mergedText);
  const at = mergedNorm.normalized.toLowerCase().indexOf(sentenceNorm.toLowerCase());
  if (at < 0) return null;

  const startIndex = mergedNorm.map[at];
  const endIndex = mergedNorm.map[at + sentenceNorm.length - 1];
  if (startIndex === undefined || endIndex === undefined) return null;

  const startLoc = locateTextOffset(textNodes, startIndex);
  const endLoc = locateTextOffset(textNodes, endIndex + 1);
  if (!startLoc || !endLoc) return null;

  const range = document.createRange();
  range.setStart(startLoc.node, startLoc.offset);
  range.setEnd(endLoc.node, endLoc.offset);
  if (range.collapsed) return null;

  const mark = document.createElement('mark');
  mark.setAttribute('data-reading-sentence', 'true');
  mark.className = 'rounded bg-amber-100 px-0.5 text-inherit ring-1 ring-amber-300';
  const fragment = range.extractContents();
  mark.appendChild(fragment);
  range.insertNode(mark);
  return mark;
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

const treeLineRe = /(~\/|├──|└──|│\s|^\s{2,}\S)/;
const normalizeMarkdownForReader = (text: string): string => {
  const source = text.trim();
  if (!source) return source;
  if (source.includes('```')) return source;

  const lines = source.split('\n');
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] || '';
    if (treeLineRe.test(line)) {
      const block: string[] = [];
      while (i < lines.length && (treeLineRe.test(lines[i] || '') || !(lines[i] || '').trim())) {
        block.push(lines[i] || '');
        i += 1;
      }
      out.push('```text');
      out.push(...block);
      out.push('```');
      continue;
    }
    out.push(line);
    i += 1;
  }

  return out.join('\n');
};

const countWords = (input: string): number => {
  const trimmed = input.trim();
  if (!trimmed) return 0;
  const cjkChars = (trimmed.match(/[\u4e00-\u9fff]/g) || []).length;
  const latinWords = trimmed
    .replace(/[\u4e00-\u9fff]/g, ' ')
    .match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g);
  return cjkChars + (latinWords ? latinWords.length : 0);
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
    readerFontSize,
    setReaderFontSize,
    currentReadingSentenceKey,
    focusedParagraphId,
    setFocusedParagraphId,
    searchHighlightQuery,
    searchMatchedParagraphIds,
  } = useStore();
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [translationErrors, setTranslationErrors] = useState<Record<string, string>>({});
  const [annotationsByParagraph, setAnnotationsByParagraph] = useState<Record<string, Annotation[]>>({});
  const [selectionDraft, setSelectionDraft] = useState<SelectionDraft | null>(null);
  const [selectionAnchor, setSelectionAnchor] = useState<{ x: number; y: number } | null>(null);
  const [selectionActionMode, setSelectionActionMode] = useState<SelectionActionMode>(null);
  const [selectionQuestion, setSelectionQuestion] = useState('');
  const [isQuestionInputExpanded, setIsQuestionInputExpanded] = useState(false);
  const [isSelectionMenuOpen, setIsSelectionMenuOpen] = useState(false);
  const [isSelectionReorderMode, setIsSelectionReorderMode] = useState(false);
  const [selectionActionOrder, setSelectionActionOrder] = useState<SelectionAction[]>(() => {
    try {
      const raw = localStorage.getItem('reader_selection_action_order');
      if (!raw) return ALL_SELECTION_ACTIONS;
      const parsed = JSON.parse(raw) as SelectionAction[];
      return normalizeSelectionActionOrder(parsed);
    } catch {
      return ALL_SELECTION_ACTIONS;
    }
  });
  const [pointerSortAction, setPointerSortAction] = useState<SelectionAction | null>(null);
  const [selectionPopoverOffset, setSelectionPopoverOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [selectionPopoverSize, setSelectionPopoverSize] = useState<{ width: number; height: number }>({ width: DEFAULT_SELECTION_POPOVER_WIDTH, height: 0 });
  const [ttsConfirmParagraphId, setTtsConfirmParagraphId] = useState<string | null>(null);
  const [pdfDisplayMode, setPdfDisplayMode] = useState<'text' | 'original'>('text');
  const [annotationRefreshTick, setAnnotationRefreshTick] = useState(0);
  const [viewSettings, setViewSettings] = useState<ReaderViewSettings>(() =>
    loadReaderViewSettings(readerFontSize)
  );
  const sentenceRefs = useRef<Record<string, HTMLParagraphElement | null>>({});
  const paragraphRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const contentRef = useRef<HTMLDivElement | null>(null);
  const translationsRef = useRef<Record<string, string>>({});
  const inFlightRef = useRef<Set<string>>(new Set());
  const pendingPatchRef = useRef<Record<string, string>>({});
  const flushTimerRef = useRef<number | null>(null);
  const autoTranslate = true;
  const matchedParagraphSet = useRef<Set<string>>(new Set());
  const popoverDragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const popoverResizeRef = useRef<{ startX: number; startY: number; originWidth: number; originHeight: number } | null>(null);
  const selectionPopoverRef = useRef<HTMLDivElement | null>(null);

  const currentTheme = READER_THEMES[viewSettings.theme] || READER_THEMES.paper;
  const paragraphLineHeight = viewSettings.lineHeight;
  const translationLineHeight = Math.max(1.35, viewSettings.lineHeight - 0.1);
  const cjkLetterSpacing = viewSettings.cjkLetterSpacingEnabled ? `${viewSettings.cjkLetterSpacing}em` : 'normal';
  const isTwoColumnLayout = viewSettings.layoutMode === 'double';
  const isTranslationEnabled = translationMode !== 'off';
  const showTranslation = isTranslationEnabled && viewSettings.bilingualViewMode !== 'source';
  const showSource = viewSettings.bilingualViewMode !== 'translation' || !isTranslationEnabled;
  const sourceWordCount = useMemo(
    () => paragraphs.reduce((sum, paragraph) => sum + countWords(paragraph.text || ''), 0),
    [paragraphs]
  );
  const translatedWordCount = useMemo(
    () =>
      Object.values(translations).reduce(
        (sum, text) => sum + countWords(typeof text === 'string' ? text : ''),
        0
      ),
    [translations]
  );

  const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

  const invokeTranslateWithRetry = async (
    text: string,
    targetLang: 'zh' | 'en',
    attempts = 2
  ): Promise<string> => {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await invoke<string>('translate', { text, targetLang });
      } catch (error) {
        lastError = error;
        if (attempt < attempts) {
          await delay(350 * attempt);
        }
      }
    }
    throw lastError;
  };

  useEffect(() => {
    matchedParagraphSet.current = new Set(searchMatchedParagraphIds);
  }, [searchMatchedParagraphIds]);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_SETTINGS_KEY, JSON.stringify(viewSettings));
    } catch (error) {
      console.warn('Failed to persist reader view settings:', error);
    }
  }, [viewSettings]);

  useEffect(() => {
    const refresh = () => {
      setViewSettings(loadReaderViewSettings(readerFontSize));
    };
    window.addEventListener('reader:view-settings-updated', refresh as EventListener);
    return () => {
      window.removeEventListener('reader:view-settings-updated', refresh as EventListener);
    };
  }, [readerFontSize]);

  useEffect(() => {
    const onSetBilingualViewMode = (
      event: CustomEvent<{ mode?: 'both' | 'source' | 'translation' }>
    ) => {
      const mode = event.detail?.mode;
      if (mode !== 'both' && mode !== 'source' && mode !== 'translation') return;
      setViewSettings((prev) => ({ ...prev, bilingualViewMode: mode }));
    };
    const onAnnotationsChanged = () => setAnnotationRefreshTick((prev) => prev + 1);

    window.addEventListener(
      'reader:set-bilingual-view-mode',
      onSetBilingualViewMode as EventListener
    );
    window.addEventListener('reader:annotations-changed', onAnnotationsChanged as EventListener);
    return () => {
      window.removeEventListener(
        'reader:set-bilingual-view-mode',
        onSetBilingualViewMode as EventListener
      );
      window.removeEventListener('reader:annotations-changed', onAnnotationsChanged as EventListener);
    };
  }, []);

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('reader:content-stats', {
        detail: {
          sourceWords: sourceWordCount,
          translatedWords: translatedWordCount,
          paragraphCount: paragraphs.length,
        },
      })
    );
  }, [paragraphs.length, sourceWordCount, translatedWordCount]);

  useEffect(() => {
    if (viewSettings.fontSize !== readerFontSize) {
      setReaderFontSize(viewSettings.fontSize);
    }
  }, [readerFontSize, setReaderFontSize, viewSettings.fontSize]);

  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;
    const details = container.querySelectorAll('details');
    details.forEach((item) => {
      if (viewSettings.expandDetails) {
        item.setAttribute('open', '');
      } else {
        item.removeAttribute('open');
      }
    });
  }, [paragraphs, viewSettings.expandDetails, currentDocumentType]);

  const selectedDoc = documents.find((doc) => doc.id === selectedDocumentId) || null;
  const currentPdfPath = currentDocumentType === 'pdf' ? selectedDoc?.file_path || '' : '';

  const renderWithSearchHighlight = (text: string, enableHighlight: boolean, paragraphAnnotations: Annotation[], keyPrefix: string) => {
    const query = searchHighlightQuery.trim();
    const effectiveQuery = enableHighlight ? query : '';
    return renderTextWithDecorations(text, effectiveQuery, paragraphAnnotations, keyPrefix);
  };

  const dispatchAudiobookStart = (detail: AudiobookStartEventDetail) => {
    window.dispatchEvent(new CustomEvent<AudiobookStartEventDetail>('reader:audiobook-start', { detail }));
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
      const result = await invokeTranslateWithRetry(sentence, targetLang, 2);
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
  };

  // 点击翻译句子
  const handleTranslateSentence = async (paragraphId: string, sentence: string, index: number) => {
    const key = `${paragraphId}_${index}`;
    await translateSentence(key, sentence);
  };

  const handleTranslateMarkdownParagraph = async (paragraphId: string, text: string) => {
    await translateSentence(markdownTranslationKey(paragraphId), text);
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

    const maxConcurrency = currentDocumentType === 'markdown' ? 1 : 3;
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
    setTranslationErrors({});
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
  }, [paragraphs, annotationRefreshTick]);

  const clearSelectionDraft = () => {
    setSelectionDraft(null);
    setSelectionAnchor(null);
    setSelectionActionMode(null);
    setSelectionQuestion('');
    setIsQuestionInputExpanded(false);
    setIsSelectionMenuOpen(false);
    setIsSelectionReorderMode(false);
    setPointerSortAction(null);
    setSelectionPopoverOffset({ x: 0, y: 0 });
    setSelectionPopoverSize({ width: DEFAULT_SELECTION_POPOVER_WIDTH, height: 0 });
    const selection = window.getSelection();
    selection?.removeAllRanges();
  };

  const handleSelectionEnd = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-annotation-popover="true"],[data-selection-popover="true"]')) {
      return;
    }
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      setSelectionDraft(null);
      setSelectionAnchor(null);
      return;
    }
    const selectedText = selection.toString().trim();
    if (!selectedText) {
      setSelectionDraft(null);
      setSelectionAnchor(null);
      return;
    }
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const origin = range.commonAncestorContainer;
    const baseElement = origin.nodeType === Node.ELEMENT_NODE
      ? (origin as Element)
      : origin.parentElement;
    const paragraphEl = baseElement?.closest('[data-paragraph-id]');
    const paragraphId = paragraphEl?.getAttribute('data-paragraph-id');
    if (!paragraphId) {
      setSelectionDraft(null);
      setSelectionAnchor(null);
      return;
    }

    setSelectionDraft({
      paragraphId,
      selectedText: selectedText.slice(0, 300),
      style: 'single_underline',
      note: '',
    });
    setSelectionQuestion('');
    setIsQuestionInputExpanded(false);
    setSelectionActionMode(null);
    setIsSelectionMenuOpen(false);
    setIsSelectionReorderMode(false);
    setPointerSortAction(null);
    setSelectionPopoverOffset({ x: 0, y: 0 });
    setSelectionPopoverSize({ width: DEFAULT_SELECTION_POPOVER_WIDTH, height: 0 });
    setSelectionAnchor({
      x: rect.left + rect.width / 2,
      y: rect.top - 10,
    });
  };

  const handleCreateHighlightOnly = async () => {
    if (!selectionDraft) return;
    try {
      const created = await invoke<Annotation>('create_annotation', {
        paragraphId: selectionDraft.paragraphId,
        selectedText: selectionDraft.selectedText,
        style: selectionDraft.style,
        note: '',
      });
      setAnnotationsByParagraph((prev) => {
        const list = prev[created.paragraph_id] || [];
        return {
          ...prev,
          [created.paragraph_id]: [created, ...list],
        };
      });
      window.dispatchEvent(new CustomEvent('reader:annotations-changed'));
      clearSelectionDraft();
    } catch (err) {
      console.error('Failed to create highlight:', err);
    }
  };

  const handleExplainSelection = () => {
    if (!selectionDraft?.selectedText?.trim()) return;
    window.dispatchEvent(
      new CustomEvent<{ selectedText: string }>('reader:chat-explain', {
        detail: { selectedText: selectionDraft.selectedText.trim() },
      })
    );
    clearSelectionDraft();
  };

  const handleSaveNoteSelection = () => {
    if (!selectionDraft?.selectedText?.trim()) return;
    window.dispatchEvent(
      new CustomEvent<{ docId?: string; paragraphId?: string; selectedText: string; noteText?: string }>('reader:take-note', {
        detail: {
          docId: selectedDocumentId || undefined,
          paragraphId: selectionDraft.paragraphId,
          selectedText: selectionDraft.selectedText.trim(),
          noteText: selectionDraft.note.trim() || undefined,
        },
      })
    );
    clearSelectionDraft();
  };

  const getSentenceForSelection = (paragraphId: string, selectedText: string): string => {
    const paragraph = paragraphs.find((item) => item.id === paragraphId);
    if (!paragraph) return selectedText;
    const source = toSpeakableText(paragraph.text, {
      markdown: currentDocumentType === 'markdown',
    });
    const sentenceList = splitIntoSentences(source);
    const keyword = selectedText.trim().toLowerCase();
    if (!keyword) return sentenceList[0] || source || selectedText;
    const match = sentenceList.find((item) => item.toLowerCase().includes(keyword));
    return match || sentenceList[0] || source || selectedText;
  };

  const openDictPanel = (mode: 'dict' | 'sentence') => {
    if (!selectionDraft?.selectedText?.trim()) return;
    const selectedText = selectionDraft.selectedText.trim();
    const sentence = getSentenceForSelection(selectionDraft.paragraphId, selectedText);
    window.dispatchEvent(
      new CustomEvent<DictRequestEventDetail>('reader:open-dict', {
        detail: {
          mode,
          selectedText,
          sentence,
          paragraphId: selectionDraft.paragraphId,
        },
      })
    );
    clearSelectionDraft();
  };

  const handleCopySelection = async () => {
    const selectedNow = window.getSelection()?.toString().trim() || '';
    const textToCopy = selectedNow || selectionDraft?.selectedText?.trim() || '';
    if (!textToCopy) return;

    try {
      await navigator.clipboard.writeText(textToCopy);
      clearSelectionDraft();
      return;
    } catch {
      const textArea = document.createElement('textarea');
      textArea.value = textToCopy;
      textArea.setAttribute('readonly', '');
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
      } finally {
        document.body.removeChild(textArea);
      }
      clearSelectionDraft();
    }
  };

  const handleConfirmPlayFromSelection = () => {
    if (!ttsConfirmParagraphId) return;
    dispatchAudiobookStart({ paragraphId: ttsConfirmParagraphId });
    setTtsConfirmParagraphId(null);
    clearSelectionDraft();
  };

  const handleAskQuestionFromSelection = () => {
    const question = selectionQuestion.trim();
    if (!question) return;
    window.dispatchEvent(
      new CustomEvent<{ question: string }>('reader:chat-question', {
        detail: { question },
      })
    );
    clearSelectionDraft();
  };

  const handleSelectionAction = (action: SelectionAction) => {
    if (!selectionDraft) return;
    if (action === 'ask') {
      setIsQuestionInputExpanded(true);
      return;
    }
    if (action === 'play') {
      setTtsConfirmParagraphId(selectionDraft.paragraphId);
      return;
    }
    if (action === 'explain') {
      handleExplainSelection();
      return;
    }
    if (action === 'dict') {
      openDictPanel('dict');
      return;
    }
    if (action === 'sentence') {
      openDictPanel('sentence');
      return;
    }
    if (action === 'copy') {
      void handleCopySelection();
      return;
    }
    if (action === 'highlight') {
      setSelectionActionMode('highlight');
      return;
    }
    if (action === 'note') {
      setSelectionActionMode('note');
    }
  };

  useEffect(() => {
    localStorage.setItem('reader_selection_action_order', JSON.stringify(selectionActionOrder));
  }, [selectionActionOrder]);

  useEffect(() => {
    const normalized = normalizeSelectionActionOrder(selectionActionOrder);
    if (normalized.join('|') !== selectionActionOrder.join('|')) {
      setSelectionActionOrder(normalized);
    }
  }, [selectionActionOrder]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      if (popoverDragRef.current) {
        const dx = event.clientX - popoverDragRef.current.startX;
        const dy = event.clientY - popoverDragRef.current.startY;
        setSelectionPopoverOffset({
          x: popoverDragRef.current.originX + dx,
          y: popoverDragRef.current.originY + dy,
        });
      }
      if (popoverResizeRef.current) {
        const dx = event.clientX - popoverResizeRef.current.startX;
        const dy = event.clientY - popoverResizeRef.current.startY;
        setSelectionPopoverSize({
          width: Math.max(420, popoverResizeRef.current.originWidth + dx),
          height: Math.max(180, popoverResizeRef.current.originHeight + dy),
        });
      }
    };
    const onPointerUp = () => {
      popoverDragRef.current = null;
      popoverResizeRef.current = null;
      setPointerSortAction(null);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, []);

  const reorderSelectionActions = (from: SelectionAction, to: SelectionAction) => {
    if (from === to) return;
    setSelectionActionOrder((prev) => {
      const fromIndex = prev.indexOf(from);
      const toIndex = prev.indexOf(to);
      if (fromIndex < 0 || toIndex < 0) return prev;
      const next = [...prev];
      next.splice(fromIndex, 1);
      next.splice(toIndex, 0, from);
      return next;
    });
  };

  // 跟随当前朗读句子自动滚动
  useEffect(() => {
    if (!currentReadingSentenceKey) return;
    const el = sentenceRefs.current[currentReadingSentenceKey];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const parsed = parseSentenceKey(currentReadingSentenceKey);
    if (!parsed) return;
    const paragraphId = parsed.paragraphId;
    const paragraphEl = paragraphRefs.current[paragraphId];
    if (!paragraphEl) return;
    paragraphEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [currentReadingSentenceKey]);

  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;

    clearReadingSentenceMarks(container);
    if (currentDocumentType !== 'markdown' || !currentReadingSentenceKey) return;

    const parsed = parseSentenceKey(currentReadingSentenceKey);
    if (!parsed) return;
    const paragraphEl = paragraphRefs.current[parsed.paragraphId];
    if (!paragraphEl) return;
    const markdownEl = paragraphEl.querySelector<HTMLElement>('.markdown-content');
    if (!markdownEl) return;

    const paragraph = paragraphs.find((item) => item.id === parsed.paragraphId);
    if (!paragraph) return;
    const sentences = splitIntoSentences(toSpeakableText(paragraph.text, { markdown: true }));
    const sentence = sentences[parsed.sentenceIndex];
    if (!sentence) return;

    const mark = highlightSentenceInElement(markdownEl, sentence);
    if (mark) {
      mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [currentDocumentType, currentReadingSentenceKey, paragraphs]);

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
      <div className="flex-1 flex items-center justify-center" style={{ backgroundColor: currentTheme.background }}>
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="mt-2 text-sm" style={{ color: currentTheme.isDark ? '#9ca3af' : '#4b5563' }}>Loading content...</p>
        </div>
      </div>
    );
  }

  if (paragraphs.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ backgroundColor: currentTheme.background }}>
        <p style={{ color: currentTheme.isDark ? '#9ca3af' : '#6b7280' }}>
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
      style={{ backgroundColor: currentTheme.background, color: currentTheme.foreground }}
      onMouseUp={handleSelectionEnd}
    >
      <div
        className={isTwoColumnLayout ? 'w-full pl-8 pr-5 py-8' : 'mx-auto px-8 py-12'}
        style={isTwoColumnLayout ? { maxWidth: '100%' } : { maxWidth: `${viewSettings.contentWidth}em` }}
      >
        {currentDocumentType === 'pdf' && (
          <div className="mb-4 flex items-center justify-end gap-2">
            <button
              onClick={() => setPdfDisplayMode('text')}
              className="rounded-lg border px-3 py-1.5 text-sm"
              style={
                pdfDisplayMode === 'text'
                  ? { borderColor: currentTheme.link, backgroundColor: currentTheme.secondary, color: currentTheme.link }
                  : { borderColor: currentTheme.border, backgroundColor: currentTheme.background, color: currentTheme.foreground }
              }
            >
              Text View
            </button>
            <button
              onClick={() => setPdfDisplayMode('original')}
              className="rounded-lg border px-3 py-1.5 text-sm"
              style={
                pdfDisplayMode === 'original'
                  ? { borderColor: currentTheme.link, backgroundColor: currentTheme.secondary, color: currentTheme.link }
                  : { borderColor: currentTheme.border, backgroundColor: currentTheme.background, color: currentTheme.foreground }
              }
            >
              PDF Original
            </button>
          </div>
        )}
        {currentDocumentType === 'pdf' && pdfDisplayMode === 'original' && currentPdfPath ? (
          <section className="rounded-lg border p-2" style={{ borderColor: currentTheme.border, backgroundColor: currentTheme.secondary }}>
            <iframe
              title="PDF Original Viewer"
              src={convertFileSrc(currentPdfPath)}
              className="h-[82vh] w-full rounded"
            />
          </section>
        ) : (
        <>
          <article
            className={isTwoColumnLayout ? 'max-w-none' : 'prose max-w-none'}
            style={
              isTwoColumnLayout
                ? { columnCount: 2, columnGap: '3rem', width: '100%' }
                : undefined
            }
          >
          {paragraphs.map((paragraph) => {
            const isMarkdownParagraph = currentDocumentType === 'markdown';
            const normalizedMarkdownText = isMarkdownParagraph
              ? normalizeMarkdownForReader(paragraph.text)
              : paragraph.text;
            const sentences = splitIntoSentences(paragraph.text);
            const isSearchMatchedParagraph = matchedParagraphSet.current.has(paragraph.id);
            const shouldHighlightText = isSearchMatchedParagraph && Boolean(searchHighlightQuery.trim());
            const paragraphAnnotations = annotationsByParagraph[paragraph.id] || [];
            const currentPage = parsePdfPageFromLocation(paragraph.location);
            const shouldShowPdfPreview = false;

            return (
              <div
                key={paragraph.id}
                style={isTwoColumnLayout ? { breakInside: 'avoid-column' } : undefined}
              >
                {shouldShowPdfPreview && (
                  <section className="mb-3 rounded-lg border p-2" style={{ borderColor: currentTheme.border, backgroundColor: currentTheme.secondary }}>
                    <div className="mb-2 text-xs" style={{ color: currentTheme.isDark ? '#9ca3af' : '#64748b' }}>Page {currentPage}</div>
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
                  } ${isSearchMatchedParagraph ? 'bg-yellow-50/60' : ''}`}
                >
                {isMarkdownParagraph ? (
                  <div className="space-y-2">
                    {showSource && (
                      <div
                        className="markdown-content"
                        style={{ fontSize: `${viewSettings.fontSize}px`, lineHeight: paragraphLineHeight, letterSpacing: cjkLetterSpacing, color: currentTheme.foreground }}
                      >
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            h1: ({ children }) => <h1 className="mt-6 mb-3 text-3xl font-bold" style={{ color: currentTheme.foreground }}>{renderMarkdownChildren(children, shouldHighlightText ? searchHighlightQuery : '', paragraphAnnotations, `h1-${paragraph.id}`)}</h1>,
                            h2: ({ children }) => <h2 className="mt-5 mb-3 text-2xl font-bold" style={{ color: currentTheme.foreground }}>{renderMarkdownChildren(children, shouldHighlightText ? searchHighlightQuery : '', paragraphAnnotations, `h2-${paragraph.id}`)}</h2>,
                            h3: ({ children }) => <h3 className="mt-4 mb-2 text-xl font-semibold" style={{ color: currentTheme.foreground }}>{renderMarkdownChildren(children, shouldHighlightText ? searchHighlightQuery : '', paragraphAnnotations, `h3-${paragraph.id}`)}</h3>,
                            h4: ({ children }) => <h4 className="mt-4 mb-2 text-lg font-semibold" style={{ color: currentTheme.foreground }}>{renderMarkdownChildren(children, shouldHighlightText ? searchHighlightQuery : '', paragraphAnnotations, `h4-${paragraph.id}`)}</h4>,
                            h5: ({ children }) => <h5 className="mt-3 mb-2 text-base font-semibold" style={{ color: currentTheme.foreground }}>{renderMarkdownChildren(children, shouldHighlightText ? searchHighlightQuery : '', paragraphAnnotations, `h5-${paragraph.id}`)}</h5>,
                            h6: ({ children }) => <h6 className="mt-3 mb-2 text-sm font-semibold" style={{ color: currentTheme.foreground }}>{renderMarkdownChildren(children, shouldHighlightText ? searchHighlightQuery : '', paragraphAnnotations, `h6-${paragraph.id}`)}</h6>,
                            p: ({ children }) => <p className="my-2" style={{ color: currentTheme.foreground }}>{renderMarkdownChildren(children, shouldHighlightText ? searchHighlightQuery : '', paragraphAnnotations, `p-${paragraph.id}`)}</p>,
                            ul: ({ children }) => <ul className="my-2 list-disc pl-6">{renderMarkdownChildren(children, shouldHighlightText ? searchHighlightQuery : '', paragraphAnnotations, `ul-${paragraph.id}`)}</ul>,
                            ol: ({ children }) => <ol className="my-2 list-decimal pl-6">{renderMarkdownChildren(children, shouldHighlightText ? searchHighlightQuery : '', paragraphAnnotations, `ol-${paragraph.id}`)}</ol>,
                            li: ({ children }) => <li className="my-1">{renderMarkdownChildren(children, shouldHighlightText ? searchHighlightQuery : '', paragraphAnnotations, `li-${paragraph.id}`)}</li>,
                            blockquote: ({ children }) => <blockquote className="my-3 border-l-4 pl-4 italic" style={{ borderColor: currentTheme.border, color: currentTheme.isDark ? '#b6bcc7' : '#374151' }}>{renderMarkdownChildren(children, shouldHighlightText ? searchHighlightQuery : '', paragraphAnnotations, `quote-${paragraph.id}`)}</blockquote>,
                            code: ({ children }) => (
                              <code className="rounded px-1 py-0.5" style={{ backgroundColor: currentTheme.codeBg, color: currentTheme.codeText }}>
                                {renderMarkdownChildren(children, shouldHighlightText ? searchHighlightQuery : '', paragraphAnnotations, `code-${paragraph.id}`)}
                              </code>
                            ),
                            pre: ({ children }) => (
                              <pre
                                className="my-3 overflow-x-auto rounded border p-3"
                                style={{ fontSize: `${Math.max(viewSettings.fontSize - 2, 12)}px`, backgroundColor: currentTheme.codeBg, color: currentTheme.codeText, borderColor: currentTheme.border }}
                              >
                                {renderMarkdownChildren(children, shouldHighlightText ? searchHighlightQuery : '', paragraphAnnotations, `pre-${paragraph.id}`)}
                              </pre>
                            ),
                            a: ({ href, children }) => (
                              <a href={href} target="_blank" rel="noreferrer" className="underline" style={{ color: currentTheme.link }}>
                                {renderMarkdownChildren(children, shouldHighlightText ? searchHighlightQuery : '', paragraphAnnotations, `a-${paragraph.id}`)}
                              </a>
                            ),
                            table: ({ children }) => (
                              <div className="my-3 overflow-x-auto">
                                <table className="min-w-full border text-left" style={{ borderColor: currentTheme.border }}>{renderMarkdownChildren(children, shouldHighlightText ? searchHighlightQuery : '', paragraphAnnotations, `table-${paragraph.id}`)}</table>
                              </div>
                            ),
                            thead: ({ children }) => <thead style={{ backgroundColor: currentTheme.secondary }}>{renderMarkdownChildren(children, shouldHighlightText ? searchHighlightQuery : '', paragraphAnnotations, `thead-${paragraph.id}`)}</thead>,
                            th: ({ children }) => <th className="border px-3 py-2 font-semibold" style={{ borderColor: currentTheme.border, color: currentTheme.foreground }}>{renderMarkdownChildren(children, shouldHighlightText ? searchHighlightQuery : '', paragraphAnnotations, `th-${paragraph.id}`)}</th>,
                            td: ({ children }) => <td className="border px-3 py-2" style={{ borderColor: currentTheme.border, color: currentTheme.foreground }}>{renderMarkdownChildren(children, shouldHighlightText ? searchHighlightQuery : '', paragraphAnnotations, `td-${paragraph.id}`)}</td>,
                          }}
                        >
                          {normalizedMarkdownText}
                        </ReactMarkdown>
                      </div>
                    )}
                    {showTranslation && (
                      <div className="ml-4 rounded border-l-2 border-blue-200 pl-3">
                        {translations[markdownTranslationKey(paragraph.id)] ? (
                          <div
                            className="markdown-content"
                            style={{ fontSize: `${Math.max(viewSettings.fontSize - 3, 12)}px`, lineHeight: translationLineHeight, color: currentTheme.link }}
                          >
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {translations[markdownTranslationKey(paragraph.id)]}
                            </ReactMarkdown>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 py-1">
                            <button
                              onClick={() => void handleTranslateMarkdownParagraph(paragraph.id, paragraph.text)}
                              className="text-xs text-blue-600 hover:text-blue-800 underline"
                            >
                              {translationErrors[markdownTranslationKey(paragraph.id)] ? 'Retry Translation' : 'Translate'}
                            </button>
                            {translationErrors[markdownTranslationKey(paragraph.id)] && (
                              <span className="text-xs text-red-600">
                                {translationErrors[markdownTranslationKey(paragraph.id)]}
                              </span>
                            )}
                          </div>
                        )}
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
                      <div key={key} className="mb-2">
                        {showSource && (
                          <p
                            ref={(el) => {
                              sentenceRefs.current[key] = el;
                            }}
                            className={isReading ? 'rounded px-2 py-1 border border-amber-300 bg-amber-100' : ''}
                            style={{ fontSize: `${viewSettings.fontSize}px`, lineHeight: paragraphLineHeight, letterSpacing: cjkLetterSpacing, color: currentTheme.foreground }}
                          >
                            {renderWithSearchHighlight(sentence, isSearchMatchedParagraph, paragraphAnnotations, `${paragraph.id}-${index}`)}
                          </p>
                        )}
                        {showTranslation && (
                          <div className="flex items-center gap-2 ml-4">
                            {translations[key] ? (
                              <p
                                style={{ fontSize: `${Math.max(viewSettings.fontSize - 3, 12)}px`, lineHeight: translationLineHeight, color: currentTheme.link }}
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
      {selectionDraft && selectionAnchor && (
        <div
          ref={selectionPopoverRef}
          data-selection-popover="true"
          className="fixed z-50 -translate-x-1/2 rounded-xl border border-slate-300 bg-white p-2.5 shadow-[0_14px_36px_rgba(15,23,42,0.16)] overflow-y-auto"
          style={{
            left: `${Math.max(36, Math.min(selectionAnchor.x + selectionPopoverOffset.x, window.innerWidth - 36))}px`,
            top: `${Math.max(12, selectionAnchor.y + selectionPopoverOffset.y)}px`,
            width: `${Math.min(selectionPopoverSize.width, Math.floor(window.innerWidth * 0.92))}px`,
            height:
              selectionPopoverSize.height > 0
                ? `${Math.min(selectionPopoverSize.height, Math.floor(window.innerHeight * 0.72))}px`
                : undefined,
            maxHeight: '72vh',
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onMouseUp={(e) => e.stopPropagation()}
        >
          <div className="mb-2 flex items-center gap-1 rounded-2xl border border-slate-300 bg-gradient-to-r from-slate-50 to-zinc-50 px-2 py-1.5 shadow-sm backdrop-blur">
            <button
              className="rounded-md px-1.5 py-0.5 text-[11px] text-slate-500 hover:bg-slate-100"
              title="Drag to move panel"
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                popoverDragRef.current = {
                  startX: event.clientX,
                  startY: event.clientY,
                  originX: selectionPopoverOffset.x,
                  originY: selectionPopoverOffset.y,
                };
                document.body.style.userSelect = 'none';
                document.body.style.cursor = 'grabbing';
              }}
            >
              ⋮⋮
            </button>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
            {selectionActionOrder.map((action) => (
              <div
                key={action}
                className="shrink-0"
                onPointerDown={(e) => {
                  if (!isSelectionReorderMode || e.button !== 0) return;
                  e.preventDefault();
                  setPointerSortAction(action);
                  document.body.style.userSelect = 'none';
                }}
                onPointerEnter={() => {
                  if (!isSelectionReorderMode || !pointerSortAction) return;
                  if (pointerSortAction === action) return;
                  reorderSelectionActions(pointerSortAction, action);
                  setPointerSortAction(action);
                }}
              >
                {action === 'ask' && !isSelectionReorderMode && isQuestionInputExpanded ? (
                  <div className="shrink-0 flex h-10 w-80 items-center gap-2 rounded-full border border-slate-300 bg-white px-3">
                    <input
                      autoFocus
                      value={selectionQuestion}
                      onChange={(e) => setSelectionQuestion(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAskQuestionFromSelection();
                        }
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          if (!selectionQuestion.trim()) setIsQuestionInputExpanded(false);
                        }
                      }}
                      onBlur={() => {
                        if (!selectionQuestion.trim()) setIsQuestionInputExpanded(false);
                      }}
                      placeholder="Type your question and press Enter"
                      className="w-full bg-transparent text-[13px] text-slate-700 placeholder:text-slate-400 focus:outline-none"
                    />
                    <button
                      onClick={handleAskQuestionFromSelection}
                      disabled={!selectionQuestion.trim()}
                      className="shrink-0 whitespace-nowrap rounded-full border border-slate-300 bg-slate-50 px-3.5 py-1.5 text-[12px] font-medium text-slate-700 hover:border-slate-400 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Submit
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      if (isSelectionReorderMode) return;
                      handleSelectionAction(action);
                    }}
                    className={`whitespace-nowrap rounded-full border px-2.5 py-1.5 text-[12px] font-medium transition ${
                      isSelectionReorderMode
                        ? pointerSortAction === action
                          ? 'cursor-grabbing border-slate-400 bg-slate-200 text-slate-800'
                          : 'cursor-grab border-slate-300 bg-slate-100 text-slate-700'
                        : 'border-slate-300 bg-white text-slate-800 hover:border-slate-400 hover:bg-slate-50'
                    }`}
                  >
                    <span className="inline-flex items-center gap-1.5 align-middle">
                      <span className="text-[11px] text-slate-500">{isSelectionReorderMode ? '☰' : selectionActionIcon[action]}</span>
                      <span>{selectionActionLabel[action]}</span>
                    </span>
                  </button>
                )}
              </div>
            ))}
            </div>
            <div className="relative">
              <button
                onClick={() => setIsSelectionMenuOpen((prev) => !prev)}
                className="rounded-md border border-slate-300 bg-slate-50 px-2 py-1 text-[12px] text-slate-700 hover:bg-slate-100"
                title="More actions"
              >
                ▾
              </button>
              {isSelectionMenuOpen && (
                <div className="absolute right-0 top-9 z-20 w-44 rounded-xl border border-slate-300 bg-white p-1.5 shadow-lg">
                  <button
                    onClick={() => {
                      setIsQuestionInputExpanded(false);
                      setIsSelectionReorderMode((prev) => !prev);
                      setIsSelectionMenuOpen(false);
                    }}
                    className="w-full rounded-lg px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100"
                  >
                    {isSelectionReorderMode ? 'Done Reordering' : 'Reorder'}
                  </button>
                  <button
                    onClick={() => {
                      setSelectionActionOrder(ALL_SELECTION_ACTIONS);
                      setIsSelectionReorderMode(false);
                      setIsSelectionMenuOpen(false);
                    }}
                    className="w-full rounded-lg px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100"
                  >
                    Reset to Default
                  </button>
                </div>
              )}
            </div>
            <button
              onClick={clearSelectionDraft}
              className="rounded-md border border-slate-300 bg-slate-50 px-2 py-1 text-[12px] text-slate-700 hover:bg-slate-100"
              title="Close"
            >
              ×
            </button>
          </div>
          {isSelectionReorderMode && (
            <p className="mb-1.5 text-[10px] text-slate-500">Reorder mode: Drag buttons above to reorder, click menu when done.</p>
          )}
          <p className="mb-1.5 line-clamp-2 rounded border border-slate-300 bg-slate-50 px-2 py-1 text-[11px] text-slate-600">
            “{selectionDraft.selectedText}”
          </p>
          {selectionActionMode === 'highlight' && (
            <>
              <div className="mb-2 flex items-center gap-2 flex-wrap">
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
              <div className="mb-2 flex justify-end gap-2">
                <button
                  onClick={() => setSelectionActionMode(null)}
                  className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700"
                >
                  Back
                </button>
                <button
                  onClick={() => void handleCreateHighlightOnly()}
                  className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700"
                >
                  Save Highlight
                </button>
              </div>
            </>
          )}
          {selectionActionMode === 'note' && (
            <>
              <textarea
                value={selectionDraft.note}
                onChange={(e) => setSelectionDraft((prev) => (prev ? { ...prev, note: e.target.value } : prev))}
                placeholder="Enter note content (optional)"
                rows={3}
                className="mb-2 w-full resize-none rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="mb-2 flex justify-end gap-2">
                <button
                  onClick={() => setSelectionActionMode(null)}
                  className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700"
                >
                  Back
                </button>
                <button
                  onClick={handleSaveNoteSelection}
                  className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700"
                >
                  Save Note
                </button>
              </div>
            </>
          )}
          <div
            className="absolute bottom-1 right-1 h-4 w-4 cursor-nwse-resize text-slate-400"
            title="Drag to resize panel"
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.stopPropagation();
              const rect = selectionPopoverRef.current?.getBoundingClientRect();
              popoverResizeRef.current = {
                startX: event.clientX,
                startY: event.clientY,
                originWidth: rect?.width ?? selectionPopoverSize.width,
                originHeight: rect?.height ?? 260,
              };
              document.body.style.userSelect = 'none';
              document.body.style.cursor = 'nwse-resize';
            }}
          >
            ◢
          </div>
        </div>
      )}
      {ttsConfirmParagraphId && (
        <>
          <div
            data-selection-popover="true"
            className="fixed inset-0 z-50 bg-black/30"
            onClick={() => setTtsConfirmParagraphId(null)}
          />
          <div
            data-selection-popover="true"
            className="fixed left-1/2 top-1/2 z-[60] w-[min(92vw,24rem)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-gray-200 bg-white p-4 shadow-2xl"
          >
            <h4 className="text-sm font-semibold text-gray-900">Start reading from here?</h4>
            <p className="mt-2 text-xs text-gray-600">TTS will start from the paragraph containing the selected text.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setTtsConfirmParagraphId(null)}
                className="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmPlayFromSelection}
                className="rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700"
              >
                Start Reading
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
