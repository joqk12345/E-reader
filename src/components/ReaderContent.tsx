import { useState, useEffect, useRef, useMemo, type MouseEvent, type ReactNode, type ReactElement, Children, cloneElement, isValidElement } from 'react';
import { useStore } from '../store/useStore';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { open as openExternal } from '@tauri-apps/plugin-shell';
import katex from 'katex';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { parseSentenceKey, splitIntoSentences, toSpeakableText } from '../utils/sentences';
import type { Annotation, AnnotationStyle, Paragraph } from '../types';
import {
  READER_THEMES,
  VIEW_SETTINGS_KEY,
  clamp,
  loadReaderViewSettings,
  type ReaderViewSettings,
} from './readerTheme';
import { ThinkingDisclosure } from './ThinkingDisclosure';
import { parseThinkingBlocks } from '../utils/thinking';

const markdownTranslationKey = (paragraphId: string) => `${paragraphId}__md`;
const PDF_IMAGE_MARKER_RE = /^\[\[PDF_IMAGE:(.+)\]\]$/;
const annotationStyleOrder: AnnotationStyle[] = ['single_underline', 'double_underline', 'wavy_strikethrough'];
const annotationStyleLabel: Record<AnnotationStyle, string> = {
  single_underline: 'Single Underline',
  double_underline: 'Double Underline',
  wavy_strikethrough: 'Wavy Strikethrough',
};
const READER_INTRO_TEXT = 'Reader: Local-first EPUB/PDF/Markdown reader with AI tools';
const READER_INTRO_INDEX_URL = 'https://joqk12345.github.io/E-reader/';

type SelectionDraft = {
  paragraphId: string;
  selectedText: string;
  style: AnnotationStyle;
  note: string;
};

type SelectionAction = 'simple' | 'context' | 'term' | 'dict' | 'takeaway' | 'ask' | 'play' | 'copy' | 'share' | 'highlight' | 'note';
type SelectionActionMode = 'highlight' | 'note' | null;
const ALL_SELECTION_ACTIONS: SelectionAction[] = ['simple', 'context', 'term', 'dict', 'takeaway', 'ask', 'play', 'copy', 'share', 'highlight', 'note'];

const selectionActionLabel: Record<SelectionAction, string> = {
  simple: 'Explain Simply',
  context: 'With Context',
  term: 'Term',
  dict: 'Dict',
  takeaway: 'Takeaway',
  ask: 'Ask',
  play: 'Read Aloud',
  copy: 'Copy',
  share: 'Share to X',
  highlight: 'Highlight',
  note: 'Take Note',
};
const selectionActionIcon: Record<SelectionAction, string> = {
  simple: '⌕',
  context: '⊹',
  term: '◉',
  dict: '📘',
  takeaway: '≡',
  ask: '✦',
  play: '▶',
  copy: '⧉',
  share: '↗',
  highlight: '＿',
  note: '✎',
};
const DEFAULT_SELECTION_POPOVER_WIDTH = 540;
const BASE_DOUBLE_COLUMN_PAGE_SIZE = 12;
const MIN_DOUBLE_COLUMN_PAGE_SIZE = 10;
const MAX_DOUBLE_COLUMN_PAGE_SIZE = 72;

type CodeRule = {
  regex: RegExp;
  color: string;
};

const inferCodeLanguage = (className?: string): string => {
  if (!className) return '';
  const matched = className.match(/language-([\w-]+)/i);
  return matched?.[1]?.toLowerCase() || '';
};

const toCodeText = (value: ReactNode): string =>
  typeof value === 'string' ? value : String(value ?? '');

const looksLikeLatexMath = (value: string): boolean => {
  const text = value.trim();
  if (!text) return false;
  if (text.includes('\\text{') || text.includes('\\frac') || text.includes('\\math')) return true;
  if (/[\\^_{}]/.test(text) && /[A-Za-z]/.test(text)) return true;
  if (/[α-ωΑ-Ωπγτλσμ]/.test(text)) return true;
  return false;
};

const normalizeArxivAssetUrl = (
  assetUrl: string | null | undefined,
  documentUrl: string | null | undefined
): string => {
  const trimmed = assetUrl?.trim() || '';
  const source = documentUrl?.trim() || '';
  if (!trimmed || !source) return trimmed;

  let docUrl: URL;
  try {
    docUrl = new URL(source);
  } catch {
    return trimmed;
  }

  const isArxivHtmlDoc =
    /(^|\.)arxiv\.org$/i.test(docUrl.hostname) && docUrl.pathname.startsWith('/html/');
  if (!isArxivHtmlDoc) return trimmed;

  const documentId = docUrl.pathname.split('/').filter(Boolean).pop() || '';
  const resourceBase = new URL(docUrl.toString());
  if (!resourceBase.pathname.endsWith('/')) {
    resourceBase.pathname = `${resourceBase.pathname}/`;
  }

  const normalizeRelativeAssetPath = (value: string): string => {
    if (!documentId) return value;
    const prefix = `${documentId}/`;
    return value.startsWith(prefix) ? value.slice(prefix.length) : value;
  };

  const normalizeAbsoluteAssetPath = (asset: URL): string | null => {
    if (!/(^|\.)arxiv\.org$/i.test(asset.hostname) || !documentId) return null;

    const path = asset.pathname;
    const duplicatePrefix = `/html/${documentId}/${documentId}/`;
    if (path.startsWith(duplicatePrefix)) {
      asset.pathname = `/html/${documentId}/${path.slice(duplicatePrefix.length)}`;
      return asset.toString();
    }

    const filename = path.split('/').pop() || '';
    const looksLikeBareHtmlAsset = /^\/html\/[^/]+\.(png|jpe?g|gif|webp|svg)$/i.test(path);
    if (looksLikeBareHtmlAsset && filename) {
      return new URL(filename, resourceBase).toString();
    }

    return null;
  };

  try {
    const asset = new URL(trimmed);
    const normalizedAbsolute = normalizeAbsoluteAssetPath(asset);
    if (normalizedAbsolute) {
      return normalizedAbsolute;
    }
    return asset.toString();
  } catch {
    try {
      return new URL(normalizeRelativeAssetPath(trimmed), resourceBase).toString();
    } catch {
      return trimmed;
    }
  }
};

const stripMathDelimiters = (value: string, displayMode: boolean): string => {
  const text = value.trim();
  if (displayMode) {
    if (text.startsWith('$$') && text.endsWith('$$')) return text.slice(2, -2).trim();
    if (text.startsWith('\\[') && text.endsWith('\\]')) return text.slice(2, -2).trim();
    return text;
  }
  if (text.startsWith('$') && text.endsWith('$') && text.length > 2) return text.slice(1, -1).trim();
  if (text.startsWith('\\(') && text.endsWith('\\)')) return text.slice(2, -2).trim();
  return text;
};

const renderKatexHtml = (value: string, displayMode: boolean): string | null => {
  const formula = stripMathDelimiters(value, displayMode);
  if (!formula) return null;
  try {
    return katex.renderToString(formula, {
      displayMode,
      throwOnError: false,
      strict: 'ignore',
    });
  } catch {
    return null;
  }
};

const buildCodeRules = (language: string, isDark: boolean): CodeRule[] => {
  const baseText = isDark ? '#d6d9de' : '#1f2937';
  const keyword = isDark ? '#f38ba8' : '#8b1d1d';
  const stringColor = isDark ? '#a6e3a1' : '#166534';
  const numberColor = isDark ? '#f9e2af' : '#7c3aed';
  const commentColor = isDark ? '#94a3b8' : '#64748b';
  const functionColor = isDark ? '#89b4fa' : '#1d4ed8';
  const propertyColor = isDark ? '#94e2d5' : '#0f766e';
  const boolColor = isDark ? '#fab387' : '#b45309';

  if (language === 'json') {
    return [
      { regex: /"(?:\\.|[^"\\])*"(?=\s*:)/g, color: propertyColor },
      { regex: /"(?:\\.|[^"\\])*"/g, color: stringColor },
      { regex: /\b-?\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/gi, color: numberColor },
      { regex: /\b(?:true|false|null)\b/g, color: boolColor },
    ];
  }

  if (language === 'python' || language === 'py') {
    return [
      { regex: /#.*/g, color: commentColor },
      { regex: /("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g, color: stringColor },
      { regex: /\b(?:def|class|return|if|elif|else|for|while|in|try|except|finally|with|as|import|from|pass|break|continue|lambda|yield|async|await|raise|and|or|not|is)\b/g, color: keyword },
      { regex: /\b-?\d+(?:\.\d+)?\b/g, color: numberColor },
      { regex: /\b(?:True|False|None)\b/g, color: boolColor },
      { regex: /\b([A-Za-z_][A-Za-z0-9_]*)(?=\s*\()/g, color: functionColor },
    ];
  }

  if (language === 'css' || language === 'scss' || language === 'less') {
    return [
      { regex: /\/\*[\s\S]*?\*\//g, color: commentColor },
      { regex: /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, color: stringColor },
      { regex: /\b(?:@media|@supports|@keyframes|@import|@font-face|@layer)\b/g, color: keyword },
      { regex: /\b[a-z-]+(?=\s*:)/gi, color: propertyColor },
      { regex: /#[0-9a-f]{3,8}\b/gi, color: numberColor },
      { regex: /\b\d+(?:\.\d+)?(?:px|em|rem|vh|vw|%)?\b/g, color: numberColor },
    ];
  }

  if (language === 'html' || language === 'xml') {
    return [
      { regex: /<!--[\s\S]*?-->/g, color: commentColor },
      { regex: /<\/?[A-Za-z][\w:-]*/g, color: keyword },
      { regex: /\s[A-Za-z_:][\w:.-]*(?==)/g, color: propertyColor },
      { regex: /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, color: stringColor },
    ];
  }

  return [
    { regex: /\/\/.*|\/\*[\s\S]*?\*\//g, color: commentColor },
    { regex: /`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, color: stringColor },
    {
      regex: /\b(?:const|let|var|function|return|if|else|for|while|switch|case|break|continue|class|extends|new|import|from|export|default|async|await|try|catch|finally|throw|interface|type|enum|implements|public|private|protected|readonly|static)\b/g,
      color: keyword,
    },
    { regex: /\b-?\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/gi, color: numberColor },
    { regex: /\b(?:true|false|null|undefined)\b/g, color: boolColor },
    { regex: /\b([A-Za-z_$][\w$]*)(?=\s*\()/g, color: functionColor },
    { regex: /\bthis\b/g, color: baseText },
  ];
};

const renderHighlightedCode = (code: string, language: string, isDark: boolean): ReactNode => {
  const rules = buildCodeRules(language, isDark);
  if (rules.length === 0 || !code) return code;

  const tokens: Array<{ start: number; end: number; color: string; priority: number }> = [];
  rules.forEach((rule, priority) => {
    const regex = new RegExp(rule.regex.source, rule.regex.flags.includes('g') ? rule.regex.flags : `${rule.regex.flags}g`);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(code)) !== null) {
      const text = match[0];
      if (!text) {
        regex.lastIndex += 1;
        continue;
      }
      tokens.push({
        start: match.index,
        end: match.index + text.length,
        color: rule.color,
        priority,
      });
    }
  });

  tokens.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return b.end - a.end;
  });

  const nodes: ReactNode[] = [];
  let cursor = 0;
  tokens.forEach((token, idx) => {
    if (token.start < cursor) return;
    if (token.start > cursor) {
      nodes.push(<span key={`plain-${idx}-${cursor}`}>{code.slice(cursor, token.start)}</span>);
    }
    nodes.push(
      <span key={`tok-${idx}-${token.start}`} style={{ color: token.color }}>
        {code.slice(token.start, token.end)}
      </span>
    );
    cursor = token.end;
  });
  if (cursor < code.length) {
    nodes.push(<span key={`plain-tail-${cursor}`}>{code.slice(cursor)}</span>);
  }
  return nodes;
};

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

type UnderstandRequestEventDetail = {
  mode: 'simple' | 'context' | 'term' | 'takeaway';
  selectedText: string;
  sentence: string;
  paragraphId?: string;
};

type RemoteArticleImage = {
  src: string;
  alt: string;
};

type MarkdownParagraphMeta = {
  heading: string | null;
  inMediaLinks: boolean;
};

type MarkdownVisibilityFilterOptions = {
  dropLeadingBeforeFirstH1?: boolean;
  dropLeadingSummarySection?: boolean;
  hideMediaLinksSection?: boolean;
};

type AgentRuntimeConfig = {
  slot: 'chat' | 'summary' | 'translate' | 'deep_analyze' | 'embedding';
  translation_parallelism?: number;
};

type AiProfilesPayload = {
  agents: AgentRuntimeConfig[];
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

type PdfParagraphKind =
  | 'title'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'metadata'
  | 'keywords'
  | 'caption'
  | 'toc'
  | 'table'
  | 'preformatted'
  | 'body';

type PdfTableGroupingResult = {
  paragraphs: Paragraph[];
  memberIdsByLeaderId: Map<string, string[]>;
};

const pdfNumberedHeadingRe = /^(\d+(?:\.\d+)*)\.?\s+(.+)$/;
const pdfBareHeadingLabels = new Set([
  'abstract',
  'contents',
  'introduction',
  'background',
  'motivation',
  'related work',
  'method',
  'methods',
  'approach',
  'experiments',
  'experimental setup',
  'results',
  'discussion',
  'conclusion',
  'conclusions',
  'references',
  'appendix',
  'appendices',
  'acknowledgments',
  'acknowledgements',
]);
const pdfAffiliationKeywordRe =
  /\b(?:university|college|school|department|institute|laboratory|lab|group|center|centre|company|business)\b/i;

const isPdfKeywordsParagraph = (text: string): boolean =>
  /^index terms\s*:/i.test(text.trim());

const isPdfCaptionParagraph = (text: string): boolean =>
  /^(figure|fig\.?|table)\s*\d+[\s.: -]/i.test(text.trim());

const isPdfMetadataParagraph = (text: string): boolean => {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 220) return false;
  if (isPdfKeywordsParagraph(trimmed)) return true;
  if (/@/.test(trimmed) || /^arxiv:/i.test(trimmed) || /^doi:/i.test(trimmed)) return true;
  if (
    trimmed.includes(',') &&
    pdfAffiliationKeywordRe.test(trimmed) &&
    !/[.!?]$/.test(trimmed)
  ) {
    return true;
  }
  const commaCount = (trimmed.match(/,/g) || []).length;
  if (
    commaCount >= 2 &&
    (/\bID\b/.test(trimmed) || /\band\b/.test(trimmed) || /\d/.test(trimmed))
  ) {
    return true;
  }
  return /corresponding author/i.test(trimmed);
};

const normalizePdfTextViewLine = (line: string): string =>
  line
    .replace(/(?:\.\s*){4,}/g, ' … ')
    .replace(/(?:[·•]\s*){4,}/g, ' … ')
    .replace(/\s{2,}/g, ' ')
    .trim();

const normalizePdfTextViewText = (text: string): string =>
  text
    .split('\n')
    .map((line) => normalizePdfTextViewLine(line))
    .join('\n')
    .trim();

const isPdfStandalonePunctuationParagraph = (text: string): boolean => {
  const compact = text.replace(/\s+/g, '').trim();
  if (!compact) return false;
  return /^[.*·•⋅∙…!?:;,_\-–—~|/\\]+$/.test(compact);
};

const isPdfStandalonePageNumberParagraph = (text: string): boolean => {
  const trimmed = text.trim();
  return /^\d{1,3}$/.test(trimmed) || /^(?:[ivxlcdm]{1,8})$/i.test(trimmed);
};

const looksLikePdfTocParagraph = (text: string): boolean => {
  const trimmed = text.trim();
  if (
    !trimmed ||
    parsePdfImageMarker(trimmed) ||
    isPdfCaptionParagraph(trimmed) ||
    isPdfMetadataParagraph(trimmed)
  ) {
    return false;
  }

  return /(?:\.\s*){4,}/.test(trimmed) || /(?:[·•]\s*){4,}/.test(trimmed);
};

const formatPdfTocParagraph = (text: string): string =>
  normalizePdfTextViewText(text).replace(
    /\s+(?=(?:[A-D]\.\d+|\d+\.\d+(?:\.\d+)*)\s+[A-Z])/g,
    '\n'
  );

const getPdfHeadingLevel = (text: string): 1 | 2 | 3 | null => {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (pdfBareHeadingLabels.has(trimmed.toLowerCase())) return 1;

  const match = trimmed.match(pdfNumberedHeadingRe);
  if (!match) return null;
  if (!/[A-Za-z\u4E00-\u9FFF]/.test(match[2] || '')) return null;

  const depth = (match[1]?.split('.').filter(Boolean).length || 1);
  if (depth <= 1) return 1;
  if (depth === 2) return 2;
  return 3;
};

const classifyPdfParagraph = (paragraph: Paragraph, page: number | null): PdfParagraphKind => {
  const text = paragraph.text.trim();
  if (!text) return 'body';
  if (parsePdfImageMarker(text)) return 'body';
  if (page === 1 && paragraph.order_index === 0 && text.length <= 240) return 'title';
  if (isPdfCaptionParagraph(text)) return 'caption';
  if (isPdfKeywordsParagraph(text)) return 'keywords';
  if (isPdfMetadataParagraph(text)) return 'metadata';
  const headingLevel = getPdfHeadingLevel(text);
  if (headingLevel === 1) return 'heading1';
  if (headingLevel === 2) return 'heading2';
  if (headingLevel === 3) return 'heading3';
  if (looksLikePdfTocParagraph(text)) return 'toc';
  if (isLikelyGroupedPdfTableText(text)) return 'table';
  if (text.includes('\n')) return 'preformatted';
  return 'body';
};

const isPdfTableCaptionParagraph = (text: string): boolean => {
  const trimmed = text.trim();
  return /^(table)\s*\d+[\s.: -]/i.test(trimmed) || /^表\s*\d+[\s.:：-]/.test(trimmed);
};

const isPdfBodySentenceParagraph = (text: string): boolean => {
  const trimmed = text.trim();
  if (trimmed.length < 48 || !/[.!?]$/.test(trimmed)) return false;
  return trimmed.split(/\s+/).filter(Boolean).length >= 8;
};

const isPdfPageSnapshotMarker = (text: string): boolean => {
  const path = parsePdfImageMarker(text);
  if (!path) return false;
  return path.includes('/page_') || path.includes('\\page_');
};

const getPdfTextViewVisualNote = (text: string): string | null => {
  const path = parsePdfImageMarker(text);
  if (!path) return null;
  return isPdfPageSnapshotMarker(text)
    ? 'Table/Figure layout omitted in Text View.'
    : 'Figure image omitted in Text View.';
};

const isLikelyPdfVisualNoiseParagraph = (text: string): boolean => {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (parsePdfImageMarker(trimmed)) return false;
  if (isPdfCaptionParagraph(trimmed) || isPdfMetadataParagraph(trimmed)) return false;
  if (getPdfHeadingLevel(trimmed) !== null) return false;

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 8 || trimmed.length > 72) return false;
  if (/[.!?]$/.test(trimmed) && tokens.length >= 5) return false;

  const shortish = tokens.filter((token) => {
    const cleaned = token.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
    return !cleaned || cleaned.length <= 3 || /^\d+$/.test(cleaned);
  }).length;
  const longLowercaseWords = tokens.filter((token) => {
    const cleaned = token.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
    return cleaned.length > 3 && /[a-z]/.test(cleaned);
  }).length;
  const hasDiagramSymbols =
    trimmed.includes('<') ||
    trimmed.includes('>') ||
    trimmed.startsWith('(') ||
    tokens.some((token) => token.includes('_') || token.includes('/') || token.includes('=') || token.includes(':'));

  if (tokens.length <= 2 && trimmed.length <= 24) return true;
  if (/^\([a-z]\)/i.test(trimmed) && tokens.length <= 8 && trimmed.length <= 64) return true;
  if (hasDiagramSymbols && tokens.length <= 6 && longLowercaseWords <= 2) return true;
  if (
    tokens.length <= 5 &&
    trimmed.length <= 48 &&
    longLowercaseWords <= 4 &&
    !trimmed.includes(',') &&
    !/[.!?]$/.test(trimmed)
  ) {
    return true;
  }
  if (tokens.length <= 4 && trimmed.length <= 40 && longLowercaseWords <= 2 && !/[.!?]$/.test(trimmed)) return true;

  return shortish * 100 >= tokens.length * 60 && longLowercaseWords <= 2 && !/[.!?]$/.test(trimmed);
};

const normalizePdfTableToken = (token: string): string =>
  token.replace(/^[,;:()[\]{}]+|[,;:()[\]{}]+$/g, '');

const isLikelyPdfNumericCell = (token: string): boolean => {
  const normalized = normalizePdfTableToken(token);
  if (!normalized) return false;
  if (/^(?:-|–|—|−|n\/a|na)$/i.test(normalized)) return true;
  return /^[-+−]?(?:(?:\d+(?:\.\d+)?)|(?:\.\d+))(?:%|ms|s)?$/i.test(normalized);
};

const getPdfTableRowStats = (text: string) => {
  const tokens = text
    .trim()
    .split(/\s+/)
    .map(normalizePdfTableToken)
    .filter(Boolean);
  const numericCount = tokens.filter(isLikelyPdfNumericCell).length;
  const alphaCount = tokens.filter((token) => /[A-Za-z\u4E00-\u9FFF]/.test(token)).length;
  const longLowercaseCount = tokens.filter(
    (token) => token.length >= 6 && /[a-z]/.test(token)
  ).length;
  return { tokens, numericCount, alphaCount, longLowercaseCount };
};

const isLikelyPdfTableContextLine = (text: string): boolean => {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (
    parsePdfImageMarker(trimmed) ||
    isPdfCaptionParagraph(trimmed) ||
    isPdfMetadataParagraph(trimmed) ||
    isPdfKeywordsParagraph(trimmed) ||
    getPdfHeadingLevel(trimmed) !== null ||
    isPdfBodySentenceParagraph(trimmed)
  ) {
    return false;
  }
  if (/^\([a-z]\)\s+/i.test(trimmed)) return false;
  if (getPdfTextViewVisualNote(trimmed)) return false;

  const { tokens, numericCount, longLowercaseCount } = getPdfTableRowStats(trimmed);
  if (tokens.length < 2 || tokens.length > 18 || trimmed.length > 220) return false;
  if (/[.!?]$/.test(trimmed) && numericCount === 0) return false;
  if (numericCount >= 2) return true;
  if (numericCount >= 1 && tokens.length <= 14) return true;
  if (tokens.length >= 4 && longLowercaseCount <= 3 && !isLikelyPdfVisualNoiseParagraph(trimmed)) {
    return true;
  }
  return false;
};

const isLikelyPdfTableRow = (text: string): boolean => {
  const trimmed = text.trim();
  if (!isLikelyPdfTableContextLine(trimmed)) return false;
  const { tokens, numericCount, alphaCount } = getPdfTableRowStats(trimmed);
  return numericCount >= 2 || (numericCount >= 1 && alphaCount >= 1 && tokens.length <= 14);
};

const hasRecentPdfTableCaption = (paragraphs: Paragraph[], startIndex: number): boolean => {
  const start = paragraphs[startIndex];
  const page = parsePdfPageFromLocation(start.location);
  if (page === null) return false;

  let scanned = 0;
  for (let idx = startIndex - 1; idx >= 0 && scanned < 6; idx -= 1) {
    const candidate = paragraphs[idx];
    const candidatePage = parsePdfPageFromLocation(candidate.location);
    if (candidatePage !== page) break;

    const text = candidate.text.trim();
    if (!text) continue;
    if (isPdfTableCaptionParagraph(text)) return true;
    if (parsePdfImageMarker(text) || getPdfTextViewVisualNote(text)) {
      scanned += 1;
      continue;
    }
    if (
      isPdfBodySentenceParagraph(text) ||
      isPdfCaptionParagraph(text) ||
      isPdfMetadataParagraph(text) ||
      getPdfHeadingLevel(text) !== null
    ) {
      break;
    }
    scanned += 1;
  }

  return false;
};

const isLikelyGroupedPdfTableText = (text: string): boolean => {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return false;

  let numericRows = 0;
  for (const line of lines) {
    if (!isLikelyPdfTableContextLine(line)) return false;
    if (isLikelyPdfTableRow(line)) numericRows += 1;
  }

  return numericRows >= 2;
};

const groupPdfTableParagraphs = (paragraphs: Paragraph[]): PdfTableGroupingResult => {
  if (paragraphs.length === 0) {
    return { paragraphs, memberIdsByLeaderId: new Map() };
  }

  const groupedParagraphs: Paragraph[] = [];
  const memberIdsByLeaderId = new Map<string, string[]>();

  let index = 0;
  while (index < paragraphs.length) {
    const current = paragraphs[index];
    const currentText = current.text.trim();
    const currentPage = parsePdfPageFromLocation(current.location);
    const tableContext = hasRecentPdfTableCaption(paragraphs, index);
    const canStartBlock = tableContext
      ? isLikelyPdfTableContextLine(currentText)
      : isLikelyPdfTableRow(currentText);

    if (!canStartBlock || currentPage === null) {
      groupedParagraphs.push(current);
      index += 1;
      continue;
    }

    const block: Paragraph[] = [];
    let cursor = index;
    while (cursor < paragraphs.length) {
      const candidate = paragraphs[cursor];
      const candidatePage = parsePdfPageFromLocation(candidate.location);
      if (candidatePage !== currentPage) break;

      const candidateText = candidate.text.trim();
      const matches = tableContext
        ? isLikelyPdfTableContextLine(candidateText)
        : isLikelyPdfTableRow(candidateText);
      if (!matches) break;

      block.push(candidate);
      cursor += 1;
    }

    const numericRows = block.filter((paragraph) => isLikelyPdfTableRow(paragraph.text)).length;
    if (block.length >= 2 && numericRows >= 2) {
      const leader = block[0];
      groupedParagraphs.push({
        ...leader,
        text: block.map((paragraph) => paragraph.text.trim()).filter(Boolean).join('\n'),
      });
      memberIdsByLeaderId.set(
        leader.id,
        block.map((paragraph) => paragraph.id)
      );
      index = cursor;
      continue;
    }

    groupedParagraphs.push(current);
    index += 1;
  }

  return { paragraphs: groupedParagraphs, memberIdsByLeaderId };
};

const filterVisiblePdfParagraphs = (paragraphs: Paragraph[]): Paragraph[] => {
  if (paragraphs.length === 0) return paragraphs;

  const byPage = new Map<number, Paragraph[]>();
  for (const paragraph of paragraphs) {
    const page = parsePdfPageFromLocation(paragraph.location) || 1;
    if (!byPage.has(page)) byPage.set(page, []);
    byPage.get(page)!.push(paragraph);
  }

  const hiddenIds = new Set<string>();

  for (const pageParagraphs of byPage.values()) {
    const hasPageSnapshot = pageParagraphs.some((paragraph) =>
      isPdfPageSnapshotMarker(paragraph.text)
    );
    const hasContentsHeading = pageParagraphs.some(
      (paragraph) => paragraph.text.trim().toLowerCase() === 'contents'
    );

    if (hasContentsHeading) {
      for (const paragraph of pageParagraphs) {
        const text = normalizePdfTextViewText(paragraph.text);
        if (
          text &&
          text.toLowerCase() !== 'contents' &&
          (isPdfStandalonePunctuationParagraph(text) ||
            isPdfStandalonePageNumberParagraph(text))
        ) {
          hiddenIds.add(paragraph.id);
        }
      }
    }

    if (hasPageSnapshot) {
      for (const paragraph of pageParagraphs) {
        const text = paragraph.text.trim();
        if (
          text &&
          !parsePdfImageMarker(text) &&
          !isPdfCaptionParagraph(text) &&
          !isPdfMetadataParagraph(text) &&
          getPdfHeadingLevel(text) === null &&
          !isPdfBodySentenceParagraph(text) &&
          isLikelyPdfVisualNoiseParagraph(text)
        ) {
          hiddenIds.add(paragraph.id);
        }
      }
    }

    for (let idx = 0; idx < pageParagraphs.length; idx += 1) {
      const current = pageParagraphs[idx];
      if (!isPdfCaptionParagraph(current.text)) continue;

      let start = idx;
      let backwardNoise = 0;
      while (start > 0) {
        const prev = pageParagraphs[start - 1];
        const prevText = prev.text.trim();
        if (!prevText || parsePdfImageMarker(prevText)) break;
        if (isLikelyPdfVisualNoiseParagraph(prevText)) {
          start -= 1;
          backwardNoise += 1;
          continue;
        }
        break;
      }
      if (backwardNoise >= 3) {
        for (let cursor = start; cursor < idx; cursor += 1) {
          hiddenIds.add(pageParagraphs[cursor].id);
        }
      }

      let end = idx + 1;
      let forwardNoise = 0;
      while (end < pageParagraphs.length) {
        const next = pageParagraphs[end];
        const nextText = next.text.trim();
        if (!nextText || parsePdfImageMarker(nextText)) break;
        if (isLikelyPdfVisualNoiseParagraph(nextText)) {
          end += 1;
          forwardNoise += 1;
          continue;
        }
        break;
      }
      if (forwardNoise >= 3) {
        for (let cursor = idx + 1; cursor < end; cursor += 1) {
          hiddenIds.add(pageParagraphs[cursor].id);
        }
      }

      if (!hasPageSnapshot || !isPdfTableCaptionParagraph(current.text)) {
        continue;
      }

      let cursor = idx + 1;
      while (cursor < pageParagraphs.length && parsePdfImageMarker(pageParagraphs[cursor].text)) {
        cursor += 1;
      }
      while (cursor < pageParagraphs.length && isPdfBodySentenceParagraph(pageParagraphs[cursor].text)) {
        cursor += 1;
      }
      while (cursor < pageParagraphs.length) {
        const candidate = pageParagraphs[cursor];
        const candidateText = candidate.text.trim();
        if (
          !candidateText ||
          parsePdfImageMarker(candidateText) ||
          isPdfCaptionParagraph(candidateText) ||
          getPdfHeadingLevel(candidateText) !== null ||
          isPdfBodySentenceParagraph(candidateText)
        ) {
          break;
        }
        hiddenIds.add(candidate.id);
        cursor += 1;
      }
    }
  }

  return paragraphs.filter((paragraph) => !hiddenIds.has(paragraph.id));
};

const treeLineRe = /(~\/|├──|└──|│\s)/;
const flattenedTreeLineSplitRe = /(?<=[A-Za-z0-9_./-])\d+(?=(?:~\/|[A-Za-z_./-]|├──|└──|│))/g;
const jinaImageRe = /^!\((.+?)\)\[(https?:\/\/[^\]\s]+)\]$/i;
const labelledImageRe = /^image(?:\s+\d+)?\s*:\s*(.+)$/i;
const urlInTextRe = /https?:\/\/[^\s\])\]]+/gi;

const cleanupImageUrl = (value: string): string =>
  value.replace(/[)\].,;:!?]+$/g, '');

const normalizeImageAltText = (value: string): string =>
  value
    .replace(/^[\s"'`“”‘’[(]+/, '')
    .replace(/[\s"'`“”‘’)\]]+$/g, '')
    .trim();

const buildMarkdownImage = (src: string, alt: string): string =>
  `![${normalizeImageAltText(alt) || 'Image'}](${cleanupImageUrl(src)})`;

const isReaderImagePlaceholderLine = (line: string): boolean => {
  const trimmed = line.trim();
  return jinaImageRe.test(trimmed) || labelledImageRe.test(trimmed);
};

const convertReaderImageLine = (
  line: string,
  fallbackImage?: RemoteArticleImage
): { text: string; consumedFallback: boolean } => {
  const trimmed = line.trim();
  if (!trimmed) return { text: line, consumedFallback: false };

  const jinaMatch = trimmed.match(jinaImageRe);
  if (jinaMatch) {
    const [, alt, src] = jinaMatch;
    return { text: buildMarkdownImage(src, alt), consumedFallback: false };
  }

  const labelledMatch = trimmed.match(labelledImageRe);
  if (!labelledMatch) return { text: line, consumedFallback: false };

  const payload = labelledMatch[1]?.trim() || '';
  const urlMatches = [...payload.matchAll(urlInTextRe)];
  const urlCandidate = urlMatches[urlMatches.length - 1]?.[0];
  if (urlCandidate) {
    const src = cleanupImageUrl(urlCandidate);
    const alt = normalizeImageAltText(payload.slice(0, payload.lastIndexOf(urlCandidate)));
    if (!src) return { text: line, consumedFallback: false };
    return {
      text: buildMarkdownImage(src, alt || fallbackImage?.alt || 'Image'),
      consumedFallback: false,
    };
  }

  if (!fallbackImage?.src) return { text: line, consumedFallback: false };

  return {
    text: buildMarkdownImage(fallbackImage.src, payload || fallbackImage.alt || 'Image'),
    consumedFallback: true,
  };
};

const pickImageSourceFromElement = (img: HTMLImageElement): string => {
  const srcset =
    img.getAttribute('srcset') ||
    img.getAttribute('data-srcset') ||
    img.getAttribute('imagesrcset') ||
    '';
  if (srcset) {
    const candidates = srcset
      .split(',')
      .map((entry) => entry.trim().split(/\s+/)[0])
      .filter(Boolean);
    if (candidates.length > 0) {
      return candidates[candidates.length - 1];
    }
  }

  return (
    img.getAttribute('src') ||
    img.getAttribute('data-src') ||
    img.getAttribute('data-original') ||
    img.getAttribute('data-lazy-src') ||
    ''
  );
};

const serializeSvgForImageDataUrl = (svg: SVGElement): string | null => {
  if (typeof XMLSerializer === 'undefined') return null;

  const clone = svg.cloneNode(true);
  if (!(clone instanceof SVGElement)) return null;

  if (!clone.getAttribute('xmlns')) {
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  }

  for (const foreignObject of Array.from(clone.querySelectorAll('foreignObject'))) {
    const firstElement = foreignObject.firstElementChild;
    if (firstElement && !firstElement.getAttribute('xmlns')) {
      firstElement.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    }
  }

  const serialized = new XMLSerializer().serializeToString(clone).trim();
  if (!serialized) return null;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;
};

const extractArticleImagesFromHtml = (html: string, sourceUrl: string): RemoteArticleImage[] => {
  if (typeof DOMParser === 'undefined') return [];

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const container =
    doc.querySelector('main article') ||
    doc.querySelector('article') ||
    doc.querySelector('main') ||
    doc.body;
  if (!container) return [];

  const seen = new Set<string>();
  const images: RemoteArticleImage[] = [];

  for (const img of Array.from(container.querySelectorAll('img'))) {
    const rawSrc = pickImageSourceFromElement(img);
    if (!rawSrc) continue;

    let resolvedSrc = '';
    try {
      resolvedSrc = normalizeArxivAssetUrl(rawSrc, sourceUrl);
    } catch {
      continue;
    }

    const alt = normalizeImageAltText(
      img.getAttribute('alt') || img.getAttribute('aria-label') || ''
    );
    const lowerSrc = resolvedSrc.toLowerCase();
    const lowerAlt = alt.toLowerCase();
    if (
      lowerSrc.includes('logo') ||
      lowerSrc.includes('icon') ||
      lowerSrc.includes('avatar') ||
      lowerAlt.includes('logo') ||
      lowerAlt.includes('icon')
    ) {
      continue;
    }

    if (seen.has(resolvedSrc)) continue;
    seen.add(resolvedSrc);
    images.push({ src: resolvedSrc, alt });
  }

  for (const svg of Array.from(container.querySelectorAll<SVGSVGElement>('figure svg'))) {
    const resolvedSrc = serializeSvgForImageDataUrl(svg);
    if (!resolvedSrc || seen.has(resolvedSrc)) continue;

    const figure = svg.closest('figure');
    const alt = normalizeImageAltText(
      figure?.querySelector('figcaption')?.textContent ||
        svg.getAttribute('aria-label') ||
        svg.getAttribute('title') ||
        'Figure'
    );

    seen.add(resolvedSrc);
    images.push({ src: resolvedSrc, alt });
  }

  return images;
};

const renderRemoteImageGalleryMarkdown = (remoteImages: RemoteArticleImage[]): string =>
  remoteImages
    .map((image) => buildMarkdownImage(image.src, image.alt || 'Article image'))
    .join('\n\n');

const expandFlattenedTreeText = (text: string): string => {
  if (text.includes('\n') || !/[├└]──/.test(text)) {
    return text;
  }

  return text
    .replace(/^\d+(?=(?:~\/|[A-Za-z_./-]|├──|└──|│))/, '')
    .replace(flattenedTreeLineSplitRe, '\n');
};

const normalizeMarkdownForReader = (
  text: string,
  remoteImages: RemoteArticleImage[] = [],
  imageCursor?: { current: number },
  hasInlineImagePlaceholders = false
): string => {
  const source = expandFlattenedTreeText(text.trim());
  if (!source) return source;
  if (source.includes('```')) return source;
  if (
    !hasInlineImagePlaceholders &&
    remoteImages.length > 0 &&
    source === '_No key image/video links detected._'
  ) {
    return renderRemoteImageGalleryMarkdown(remoteImages);
  }

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
    const fallbackImage =
      isReaderImagePlaceholderLine(line) && imageCursor
        ? remoteImages[imageCursor.current]
        : undefined;
    const converted = convertReaderImageLine(line, fallbackImage);
    if (converted.consumedFallback && imageCursor) {
      imageCursor.current += 1;
    }
    out.push(converted.text);
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

const truncateText = (value: string, maxLength: number): string => {
  const normalized = value.trim();
  if (normalized.length <= maxLength) return normalized;
  if (maxLength <= 1) return '…';
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
};

const normalizeInlineText = (value: string): string =>
  value.replace(/\s+/g, ' ').trim();

const markdownHeadingRe = /^#{1,6}\s+(.+)$/;
const markdownHeadingPrefixRe = /^#{1,6}/;
const markdownImageSyntaxRe = /!\[[^\]]*\]\([^)\n]+\)/g;
const bareMediaLinkLineRe = /^\s*[-*]?\s*https?:\/\/\S+\s*$/i;
const summarySectionLabels = new Set([
  'summary',
  'executive summary',
  'abstract',
  'overview',
  'tldr',
  'tl dr',
  'tl;dr',
]);
const contentSectionLabels = new Set([
  'content',
  'main content',
  '正文',
  '内容',
]);
const articleStopHeadings = new Set([
  'keep reading',
  'related posts',
  'related articles',
  'recommended',
  'our research',
  'latest advancements',
  'terms & policies',
]);
const standaloneNoiseParagraphs = new Set([
  'loading…',
  'loading...',
  'share',
  'view all',
  'openai',
]);

const normalizeSectionLabel = (value: string): string =>
  normalizeInlineText(
    value
      .replace(/[*_`~]/g, '')
      .replace(/^[\s"'`“”‘’()[\]{}:：\-]+/, '')
      .replace(/[\s"'`“”‘’()[\]{}:：\-]+$/, '')
  ).toLowerCase();

const extractSectionMarker = (
  text: string
): { label: string; level: number; kind: 'heading' | 'standalone' } | null => {
  const trimmed = text.trim();
  const headingMatch = trimmed.match(markdownHeadingRe);
  if (headingMatch) {
    return {
      label: normalizeSectionLabel(headingMatch[1] || ''),
      level: trimmed.match(markdownHeadingPrefixRe)?.[0].length || 1,
      kind: 'heading',
    };
  }

  if (trimmed.includes('\n')) {
    return null;
  }

  const label = normalizeSectionLabel(trimmed);
  if (!label) {
    return null;
  }

  if (summarySectionLabels.has(label) || contentSectionLabels.has(label)) {
    return {
      label,
      level: 7,
      kind: 'standalone',
    };
  }

  return null;
};

const buildMarkdownParagraphMeta = (
  paragraphs: Paragraph[]
): Record<string, MarkdownParagraphMeta> => {
  let currentHeading: string | null = null;
  const meta: Record<string, MarkdownParagraphMeta> = {};

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.text.trim();
    const headingMatch = trimmed.match(markdownHeadingRe);
    if (headingMatch) {
      currentHeading = normalizeInlineText(headingMatch[1] || '').toLowerCase();
    }
    meta[paragraph.id] = {
      heading: currentHeading,
      inMediaLinks: currentHeading?.includes('media links') || false,
    };
  }

  return meta;
};

const sanitizeMarkdownForTranslation = (
  text: string,
  options?: { inMediaLinks?: boolean }
): string => {
  if (options?.inMediaLinks) {
    return '';
  }

  const cleaned = text
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      if (isReaderImagePlaceholderLine(trimmed)) return false;
      if (trimmed === '_No key image/video links detected._') return false;
      if (bareMediaLinkLineRe.test(trimmed)) return false;
      return true;
    })
    .join('\n')
    .replace(markdownImageSyntaxRe, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return cleaned;
};

const shouldHideMarkdownParagraph = (
  paragraph: Paragraph,
  meta: MarkdownParagraphMeta | undefined,
  options?: MarkdownVisibilityFilterOptions
): boolean => {
  const trimmed = paragraph.text.trim();
  if (!trimmed) return false;

  const normalized = normalizeInlineText(trimmed).toLowerCase();
  if (standaloneNoiseParagraphs.has(normalized)) {
    return true;
  }

  if (meta?.heading && articleStopHeadings.has(meta.heading)) {
    return true;
  }

  if (meta?.heading === 'table of contents') {
    return true;
  }

  if (options?.hideMediaLinksSection && meta?.inMediaLinks) {
    return true;
  }

  if (
    normalized.startsWith('by ') &&
    normalized.length < 120 &&
    !normalized.includes('.')
  ) {
    return true;
  }

  return false;
};

const filterVisibleMarkdownParagraphs = (
  paragraphs: Paragraph[],
  metaById: Record<string, MarkdownParagraphMeta>,
  options?: MarkdownVisibilityFilterOptions
): Paragraph[] => {
  const visible: Paragraph[] = [];
  let stop = false;
  let seenPrimaryHeading = false;
  let seenVisibleBodyAfterPrimaryHeading = false;
  let skipLeadingSectionLevel: number | null = null;

  for (const paragraph of paragraphs) {
    const meta = metaById[paragraph.id];
    const trimmed = paragraph.text.trim();
    const sectionMarker = extractSectionMarker(trimmed);
    const heading = sectionMarker?.label || '';
    const headingLevel = sectionMarker?.level ?? null;
    const isPrimaryHeading = sectionMarker?.kind === 'heading' && sectionMarker.level === 1;
    const isAtDocumentLead =
      visible.length === 0 || (seenPrimaryHeading && !seenVisibleBodyAfterPrimaryHeading);

    if (!seenPrimaryHeading && isPrimaryHeading) {
      seenPrimaryHeading = true;
    }
    if (options?.dropLeadingBeforeFirstH1 && !seenPrimaryHeading) {
      continue;
    }

    if (skipLeadingSectionLevel !== null) {
      if (headingLevel !== null && headingLevel <= skipLeadingSectionLevel) {
        skipLeadingSectionLevel = null;
      } else {
        continue;
      }
    }

    if (
      options?.dropLeadingSummarySection &&
      isAtDocumentLead &&
      headingLevel !== null &&
      summarySectionLabels.has(heading)
    ) {
      skipLeadingSectionLevel = headingLevel;
      continue;
    }

    if (heading && articleStopHeadings.has(heading)) {
      stop = true;
    }
    if (stop) {
      continue;
    }
    if (shouldHideMarkdownParagraph(paragraph, meta, options)) {
      continue;
    }
    visible.push(paragraph);
    if (seenPrimaryHeading && !isPrimaryHeading) {
      seenVisibleBodyAfterPrimaryHeading = true;
    }
  }

  return visible;
};

const filterLeadingSummaryParagraphs = (paragraphs: Paragraph[]): Paragraph[] => {
  const visible: Paragraph[] = [];
  let skipLeadingSummary = false;
  let seenLeadContent = false;

  for (const paragraph of paragraphs) {
    const marker = extractSectionMarker(paragraph.text.trim());
    const label = marker?.label || '';

    if (skipLeadingSummary) {
      if (marker && !summarySectionLabels.has(label)) {
        skipLeadingSummary = false;
      } else {
        continue;
      }
    }

    if (!seenLeadContent && marker && summarySectionLabels.has(label)) {
      skipLeadingSummary = true;
      continue;
    }

    visible.push(paragraph);
    if (!marker) {
      seenLeadContent = true;
    }
  }

  return visible;
};

const hasEmptyReferencesSection = (paragraphs: Paragraph[]): boolean => {
  let inReferences = false;

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.text.trim();
    const marker = extractSectionMarker(trimmed);
    if (marker?.kind === 'heading') {
      if (marker.label === 'references') {
        inReferences = true;
        continue;
      }
      if (inReferences) {
        return true;
      }
      continue;
    }

    if (!inReferences) {
      continue;
    }

    if (trimmed) {
      return false;
    }
  }

  return inReferences;
};

const extractArxivReferencesFromHtml = (html: string): string[] => {
  if (typeof DOMParser === 'undefined') return [];

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const bibliography =
    doc.querySelector('section.ltx_bibliography') ||
    doc.querySelector('.ltx_bibliography');
  if (!bibliography) return [];

  const items = Array.from(bibliography.querySelectorAll('li.ltx_bibitem'));
  return items
    .map((item) => {
      const authorYear = normalizeInlineText(
        item.querySelector('.ltx_tag_bibitem')?.textContent || ''
      );
      const title = normalizeInlineText(
        item.querySelector('.ltx_bib_title')?.textContent || ''
      );
      const journal = normalizeInlineText(
        item.querySelector('.ltx_bib_journal')?.textContent || ''
      );
      const publisher = normalizeInlineText(
        item.querySelector('.ltx_bib_publisher')?.textContent || ''
      );
      const note = normalizeInlineText(
        item.querySelector('.ltx_bib_note')?.textContent || ''
      );
      const link = (item.querySelector('a.ltx_bib_external[href]') as HTMLAnchorElement | null)?.href || '';

      const parts = [authorYear, title, journal || publisher, note].filter(Boolean);
      if (parts.length === 0) return '';

      const body = parts.join('. ');
      return link ? `- ${body}. [Link](${link})` : `- ${body}.`;
    })
    .filter(Boolean);
};

const injectSupplementalReferencesParagraph = (
  paragraphs: Paragraph[],
  referencesMarkdown: string[]
): Paragraph[] => {
  if (referencesMarkdown.length === 0) return paragraphs;

  const next = [...paragraphs];
  for (let i = 0; i < next.length; i += 1) {
    const marker = extractSectionMarker(next[i].text.trim());
    if (marker?.kind === 'heading' && marker.label === 'references') {
      next.splice(i + 1, 0, {
        ...next[i],
        id: `${next[i].id}__supplemental_refs`,
        order_index: next[i].order_index + 0.1,
        text: referencesMarkdown.join('\n'),
      });
      break;
    }
  }
  return next;
};

export function ReaderContent() {
  const {
    documents,
    selectedDocumentId,
    sections,
    paragraphs,
    isLoading,
    currentSectionId,
    currentDocumentType,
    translationMode,
    readerFontSize,
    setReaderFontSize,
    setVisibleParagraphs,
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
  const [columnPageIndex, setColumnPageIndex] = useState(0);
  const [viewSettings, setViewSettings] = useState<ReaderViewSettings>(() =>
    loadReaderViewSettings(readerFontSize)
  );
  const [documentSourceUrl, setDocumentSourceUrl] = useState<string | null>(null);
  const [remoteArticleImages, setRemoteArticleImages] = useState<RemoteArticleImage[]>([]);
  const [supplementalReferences, setSupplementalReferences] = useState<string[]>([]);
  const sentenceRefs = useRef<Record<string, HTMLParagraphElement | null>>({});
  const paragraphRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [contentViewport, setContentViewport] = useState({ width: 0, height: 0 });
  const translationsRef = useRef<Record<string, string>>({});
  const inFlightRef = useRef<Set<string>>(new Set());
  const pendingPatchRef = useRef<Record<string, string>>({});
  const flushTimerRef = useRef<number | null>(null);
  const autoTranslate = true;
  const [translationParallelism, setTranslationParallelism] = useState(5);
  const matchedParagraphSet = useRef<Set<string>>(new Set());
  const popoverDragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const popoverResizeRef = useRef<{ startX: number; startY: number; originWidth: number; originHeight: number } | null>(null);
  const selectionPopoverRef = useRef<HTMLDivElement | null>(null);

  const currentTheme = READER_THEMES[viewSettings.theme] || READER_THEMES.paper;
  const paragraphLineHeight = viewSettings.lineHeight;
  const translationLineHeight = Math.max(1.35, viewSettings.lineHeight - 0.1);
  const cjkLetterSpacing = viewSettings.cjkLetterSpacingEnabled ? `${viewSettings.cjkLetterSpacing}em` : 'normal';
  const isTwoColumnLayout = viewSettings.layoutMode === 'double';
  const isMultimediaMode = viewSettings.markdownRenderMode === 'multimedia';
  const isWebSourceDocument = /^https?:\/\//i.test(documentSourceUrl || '');
  const isArxivHtmlDocument = /^https?:\/\/(www\.)?arxiv\.org\/html\//i.test(documentSourceUrl || '');
  const isTranslationEnabled = translationMode !== 'off';
  const showTranslation = isTranslationEnabled && viewSettings.bilingualViewMode !== 'source';
  const showSource = viewSettings.bilingualViewMode !== 'translation' || !isTranslationEnabled;
  const translationCardBg = currentTheme.isDark ? '#2f3540' : '#e8ebf2';
  const translationCardBorder = currentTheme.isDark ? '#72a5ff' : '#8fb5ff';
  const translationIconColor = currentTheme.isDark ? '#9fc0ff' : '#5f8fe5';

  useEffect(() => {
    let cancelled = false;
    const loadParallelism = async () => {
      try {
        const payload = await invoke<AiProfilesPayload>('get_ai_profiles');
        if (cancelled) return;
        const translateAgent = payload.agents?.find((item) => item.slot === 'translate');
        const raw = Number(translateAgent?.translation_parallelism ?? 5);
        const clamped = Math.min(10, Math.max(1, Number.isFinite(raw) ? raw : 5));
        setTranslationParallelism(clamped);
      } catch {
        if (!cancelled) setTranslationParallelism(5);
      }
    };
    void loadParallelism();

    const onProfilesChanged = () => {
      void loadParallelism();
    };
    window.addEventListener('reader://ai-profiles-updated', onProfilesChanged);
    return () => {
      cancelled = true;
      window.removeEventListener('reader://ai-profiles-updated', onProfilesChanged);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setDocumentSourceUrl(null);

    if (currentDocumentType !== 'markdown' || !selectedDocumentId) {
      return;
    }

    const loadDocumentSourceUrl = async () => {
      try {
        const sourceUrl = await invoke<string | null>('get_document_source_url', {
          docId: selectedDocumentId,
        });
        if (cancelled) return;
        setDocumentSourceUrl(sourceUrl?.trim() || null);
      } catch {
        if (!cancelled) {
          setDocumentSourceUrl(null);
        }
      }
    };

    void loadDocumentSourceUrl();

    return () => {
      cancelled = true;
    };
  }, [currentDocumentType, selectedDocumentId]);

  useEffect(() => {
    let cancelled = false;
    setRemoteArticleImages([]);

    if (!isMultimediaMode || currentDocumentType !== 'markdown' || !documentSourceUrl) {
      return;
    }

    const loadRemoteArticleImages = async () => {
      try {
        const normalizedUrl = documentSourceUrl.trim();
        if (!normalizedUrl) return;

        const html = await invoke<string>('fetch_url_html', { url: normalizedUrl });
        if (cancelled) return;

        setRemoteArticleImages(extractArticleImagesFromHtml(html, normalizedUrl));
      } catch (error) {
        if (!cancelled) {
          console.warn('Failed to load remote article images:', error);
          setRemoteArticleImages([]);
        }
      }
    };

    void loadRemoteArticleImages();

    return () => {
      cancelled = true;
    };
  }, [currentDocumentType, documentSourceUrl, isMultimediaMode]);

  useEffect(() => {
    let cancelled = false;
    setSupplementalReferences([]);

    if (
      currentDocumentType !== 'markdown' ||
      !documentSourceUrl ||
      !/^https?:\/\/(www\.)?arxiv\.org\/html\//i.test(documentSourceUrl) ||
      !hasEmptyReferencesSection(paragraphs)
    ) {
      return;
    }

    const loadSupplementalReferences = async () => {
      try {
        const html = await invoke<string>('fetch_url_html', { url: documentSourceUrl });
        if (cancelled) return;
        setSupplementalReferences(extractArxivReferencesFromHtml(html));
      } catch (error) {
        if (!cancelled) {
          console.warn('Failed to load supplemental arXiv references:', error);
          setSupplementalReferences([]);
        }
      }
    };

    void loadSupplementalReferences();

    return () => {
      cancelled = true;
    };
  }, [currentDocumentType, documentSourceUrl, paragraphs]);

  const renderTranslationCard = (content: ReactNode) => (
    <div
      className={`rounded-md border-l-[3px] px-3 py-2 ${showSource ? 'ml-4' : ''}`}
      style={{ backgroundColor: translationCardBg, borderColor: translationCardBorder }}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-sm leading-none select-none" style={{ color: translationIconColor }}>
          🌐
        </span>
        <div className="min-w-0 flex-1">{content}</div>
      </div>
    </div>
  );
  const renderTranslationOutput = (
    rawTranslation: string,
    renderVisible: (visibleText: string) => ReactNode
  ) => {
    const parsed = parseThinkingBlocks(rawTranslation);

    return (
      <div className="space-y-2">
        {parsed.visibleText ? renderVisible(parsed.visibleText) : null}
        <ThinkingDisclosure
          thinkingBlocks={parsed.thinkingBlocks}
          summaryLabel="Show model thinking"
        />
      </div>
    );
  };
  const markdownParagraphMeta = useMemo(
    () => (currentDocumentType === 'markdown' ? buildMarkdownParagraphMeta(paragraphs) : {}),
    [currentDocumentType, paragraphs]
  );
  const markdownFilterOptions = useMemo<MarkdownVisibilityFilterOptions>(
    () => ({
      dropLeadingBeforeFirstH1: isWebSourceDocument,
      dropLeadingSummarySection: true,
      hideMediaLinksSection: !isMultimediaMode,
    }),
    [isMultimediaMode, isWebSourceDocument]
  );
  const visibleParagraphs = useMemo(
    () =>
      currentDocumentType === 'markdown'
        ? injectSupplementalReferencesParagraph(
            filterVisibleMarkdownParagraphs(paragraphs, markdownParagraphMeta, markdownFilterOptions),
            supplementalReferences
          )
        : currentDocumentType === 'pdf'
          ? filterVisiblePdfParagraphs(filterLeadingSummaryParagraphs(paragraphs))
          : filterLeadingSummaryParagraphs(paragraphs),
    [
      currentDocumentType,
      markdownFilterOptions,
      markdownParagraphMeta,
      paragraphs,
      supplementalReferences,
    ]
  );
  const { paragraphs: renderParagraphs, memberIdsByLeaderId: pdfTableMemberIdsByLeader } = useMemo(
    () =>
      currentDocumentType === 'pdf'
        ? groupPdfTableParagraphs(visibleParagraphs)
        : {
            paragraphs: visibleParagraphs,
            memberIdsByLeaderId: new Map<string, string[]>(),
          },
    [currentDocumentType, visibleParagraphs]
  );
  const sourceWordCount = useMemo(
    () => renderParagraphs.reduce((sum, paragraph) => sum + countWords(paragraph.text || ''), 0),
    [renderParagraphs]
  );
  const translatedWordCount = useMemo(
    () =>
      Object.values(translations).reduce(
        (sum, text) => sum + countWords(typeof text === 'string' ? text : ''),
        0
      ),
    [translations]
  );

  useEffect(() => {
    setVisibleParagraphs(visibleParagraphs);
  }, [setVisibleParagraphs, visibleParagraphs]);

  const doubleColumnPageSize = useMemo(() => {
    if (!isTwoColumnLayout) return renderParagraphs.length || BASE_DOUBLE_COLUMN_PAGE_SIZE;
    const fallbackWidth = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const fallbackHeight = typeof window !== 'undefined' ? window.innerHeight : 900;
    const viewportWidth = contentViewport.width > 0 ? contentViewport.width : fallbackWidth;
    const viewportHeight = contentViewport.height > 0 ? contentViewport.height : fallbackHeight;
    const widthFactor = clamp(viewportWidth / 1180, 0.85, 2.4);
    const heightFactor = clamp(viewportHeight / 860, 0.8, 2.0);
    const fontFactor = clamp(18 / viewSettings.fontSize, 0.75, 1.4);
    const translationFactor = showTranslation ? 0.72 : 1;
    const estimated = BASE_DOUBLE_COLUMN_PAGE_SIZE * widthFactor * heightFactor * fontFactor * translationFactor;
    return Math.round(clamp(estimated, MIN_DOUBLE_COLUMN_PAGE_SIZE, MAX_DOUBLE_COLUMN_PAGE_SIZE));
  }, [
    contentViewport.height,
    contentViewport.width,
    isTwoColumnLayout,
    renderParagraphs.length,
    showTranslation,
    viewSettings.fontSize,
  ]);
  const totalColumnPages = useMemo(() => {
    if (!isTwoColumnLayout) return 1;
    return Math.max(1, Math.ceil(renderParagraphs.length / doubleColumnPageSize));
  }, [doubleColumnPageSize, isTwoColumnLayout, renderParagraphs.length]);
  const displayedParagraphs = useMemo(() => {
    if (!isTwoColumnLayout) return renderParagraphs;
    const start = columnPageIndex * doubleColumnPageSize;
    return renderParagraphs.slice(start, start + doubleColumnPageSize);
  }, [columnPageIndex, doubleColumnPageSize, isTwoColumnLayout, renderParagraphs]);
  const normalizedMarkdownTexts = useMemo(() => {
    const cursor = { current: 0 };
    const normalized: Record<string, string> = {};
    const hasInlineImagePlaceholders = visibleParagraphs.some((paragraph) =>
      paragraph.text.split('\n').some((line) => isReaderImagePlaceholderLine(line))
    );
    for (const paragraph of visibleParagraphs) {
      normalized[paragraph.id] =
        currentDocumentType === 'markdown'
          ? normalizeMarkdownForReader(
              paragraph.text,
              isMultimediaMode ? remoteArticleImages : [],
              isMultimediaMode ? cursor : undefined,
              isMultimediaMode ? hasInlineImagePlaceholders : false
            )
          : paragraph.text;
    }
    return normalized;
  }, [currentDocumentType, isMultimediaMode, remoteArticleImages, visibleParagraphs]);

  const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
  const openExternalUrl = (url: string) => {
    const normalized = url.trim();
    if (!normalized) return;
    const isTauriRuntime =
      typeof window !== 'undefined' &&
      Object.prototype.hasOwnProperty.call(window, '__TAURI_INTERNALS__');

    if (!isTauriRuntime) {
      window.open(normalized, '_blank', 'noopener,noreferrer');
      return;
    }

    void openExternal(normalized).catch((error) => {
      console.warn('Failed to open external link via plugin-shell:', error);
      window.open(normalized, '_blank', 'noopener,noreferrer');
    });
  };

  const openLinkInExternalBrowser = (event: MouseEvent<HTMLAnchorElement>, href?: string) => {
    if (!href) return;
    event.preventDefault();
    event.stopPropagation();
    const raw = href.trim();
    if (!raw) return;
    const normalized = /^(https?:|mailto:)/i.test(raw) ? raw : `https://${raw}`;
    openExternalUrl(normalized);
  };

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
    const onSetMarkdownRenderMode = (
      event: CustomEvent<{ mode?: 'text' | 'multimedia' }>
    ) => {
      const mode = event.detail?.mode;
      if (mode !== 'text' && mode !== 'multimedia') return;
      setViewSettings((prev) => ({ ...prev, markdownRenderMode: mode }));
    };
    const onAnnotationsChanged = () => setAnnotationRefreshTick((prev) => prev + 1);

    window.addEventListener(
      'reader:set-bilingual-view-mode',
      onSetBilingualViewMode as EventListener
    );
    window.addEventListener(
      'reader:set-markdown-render-mode',
      onSetMarkdownRenderMode as EventListener
    );
    window.addEventListener('reader:annotations-changed', onAnnotationsChanged as EventListener);
    return () => {
      window.removeEventListener(
        'reader:set-bilingual-view-mode',
        onSetBilingualViewMode as EventListener
      );
      window.removeEventListener(
        'reader:set-markdown-render-mode',
        onSetMarkdownRenderMode as EventListener
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
          paragraphCount: renderParagraphs.length,
          currentPage: isTwoColumnLayout ? columnPageIndex + 1 : 1,
          totalPages: isTwoColumnLayout ? totalColumnPages : 1,
        },
      })
    );
  }, [
    columnPageIndex,
    isTwoColumnLayout,
    renderParagraphs.length,
    sourceWordCount,
    totalColumnPages,
    translatedWordCount,
  ]);

  useEffect(() => {
    if (!isTwoColumnLayout) {
      setColumnPageIndex(0);
      return;
    }
    setColumnPageIndex((prev) => Math.min(prev, Math.max(0, totalColumnPages - 1)));
  }, [isTwoColumnLayout, totalColumnPages]);

  useEffect(() => {
    setColumnPageIndex(0);
  }, [selectedDocumentId, currentSectionId]);

  useEffect(() => {
    if (!isTwoColumnLayout || !focusedParagraphId) return;
    const idx = visibleParagraphs.findIndex((item) => item.id === focusedParagraphId);
    if (idx < 0) return;
    const page = Math.floor(idx / doubleColumnPageSize);
    setColumnPageIndex(page);
  }, [doubleColumnPageSize, focusedParagraphId, isTwoColumnLayout, visibleParagraphs]);

  useEffect(() => {
    const onFlipRequest = (event: Event) => {
      const flipEvent = event as CustomEvent<{ direction?: 'prev' | 'next' }>;
      if (!isTwoColumnLayout) return;
      const direction = flipEvent.detail?.direction;
      if (direction !== 'prev' && direction !== 'next') return;

      if (direction === 'next' && columnPageIndex < totalColumnPages - 1) {
        setColumnPageIndex((prev) => Math.min(totalColumnPages - 1, prev + 1));
        flipEvent.preventDefault();
      } else if (direction === 'prev' && columnPageIndex > 0) {
        setColumnPageIndex((prev) => Math.max(0, prev - 1));
        flipEvent.preventDefault();
      }
    };

    window.addEventListener('reader:request-flip-page', onFlipRequest as EventListener);
    return () =>
      window.removeEventListener('reader:request-flip-page', onFlipRequest as EventListener);
  }, [columnPageIndex, isTwoColumnLayout, totalColumnPages]);

  useEffect(() => {
    if (viewSettings.fontSize !== readerFontSize) {
      setReaderFontSize(viewSettings.fontSize);
    }
  }, [readerFontSize, setReaderFontSize, viewSettings.fontSize]);

  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;

    const syncSize = () => {
      setContentViewport({
        width: container.clientWidth,
        height: container.clientHeight,
      });
    };

    syncSize();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(syncSize);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

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
  const currentSection = sections.find((item) => item.id === currentSectionId) || null;
  const sortedSections = useMemo(
    () => [...sections].sort((a, b) => a.order_index - b.order_index),
    [sections]
  );
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
    if (!text.trim()) return;
    await translateSentence(markdownTranslationKey(paragraphId), text);
  };

  // 自动翻译当前章节所有句子（开启双语时）
  useEffect(() => {
    if (translationMode === 'off' || !autoTranslate) return;

    let cancelled = false;
    const pending: Array<{ key: string; text: string }> = [];

    for (const paragraph of visibleParagraphs) {
      if (currentDocumentType === 'markdown') {
        const meta = markdownParagraphMeta[paragraph.id];
        const text =
          isMultimediaMode
            ? sanitizeMarkdownForTranslation(paragraph.text, {
                inMediaLinks: meta?.inMediaLinks,
              })
            : paragraph.text;
        const key = markdownTranslationKey(paragraph.id);
        if (translationsRef.current[key]) continue;
        if (inFlightRef.current.has(key)) continue;
        if (!text.trim()) continue;
        pending.push({ key, text });
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

    const maxConcurrency = Math.min(
      Math.max(1, translationParallelism),
      pending.length
    );
    const runWorker = async () => {
      while (pending.length > 0 && !cancelled) {
        const item = pending.shift();
        if (!item) return;
        await translateSentence(item.key, item.text);
      }
    };

    const workers = Array.from(
      { length: maxConcurrency },
      () => runWorker()
    );

    void Promise.all(workers);

    return () => {
      cancelled = true;
    };
  }, [translationMode, autoTranslate, visibleParagraphs, currentDocumentType, translationParallelism, markdownParagraphMeta, isMultimediaMode]);

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

  const openUnderstandPanel = (mode: 'simple' | 'context' | 'term' | 'takeaway') => {
    if (!selectionDraft?.selectedText?.trim()) return;
    const selectedText = selectionDraft.selectedText.trim();
    const sentence = getSentenceForSelection(selectionDraft.paragraphId, selectedText);
    window.dispatchEvent(
      new CustomEvent<UnderstandRequestEventDetail>('reader:open-understand', {
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

  const openDictPanel = () => {
    if (!selectionDraft?.selectedText?.trim()) return;
    const selectedText = selectionDraft.selectedText.trim();
    const sentence = getSentenceForSelection(selectionDraft.paragraphId, selectedText);
    window.dispatchEvent(
      new CustomEvent('reader:open-dict', {
        detail: {
          mode: 'dict',
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

  const handleShareSelectionToX = () => {
    const selectedNow = window.getSelection()?.toString().trim() || '';
    const textToShare = selectedNow || selectionDraft?.selectedText?.trim() || '';
    if (!textToShare) return;
    const normalizedQuote = normalizeInlineText(textToShare);
    const quote = truncateText(normalizedQuote, 140);
    const title = truncateText(normalizeInlineText(selectedDoc?.title || 'Untitled'), 64);
    const author = truncateText(normalizeInlineText(selectedDoc?.author || ''), 42);
    const selectedParagraph = selectionDraft
      ? paragraphs.find((item) => item.id === selectionDraft.paragraphId)
      : null;
    const pdfPage = currentDocumentType === 'pdf'
      ? parsePdfPageFromLocation(selectedParagraph?.location)
      : null;
    const currentSectionIndex = currentSection
      ? sortedSections.findIndex((item) => item.id === currentSection.id) + 1
      : 0;
    const sectionIndexLabel =
      currentSection && currentSectionIndex > 0
        ? `Section ${currentSectionIndex}/${sortedSections.length}: ${truncateText(normalizeInlineText(currentSection.title), 38)}`
        : '';
    const pageLabel = pdfPage ? `Page ${pdfPage}` : '';
    const contentIndex = [sectionIndexLabel, pageLabel].filter(Boolean).join(' · ');

    const metaLine = [`📖 ${title}${author ? ` — ${author}` : ''}`, contentIndex]
      .filter(Boolean)
      .join(' | ');
    const shareText = [
      `“${quote}”`,
      metaLine,
      `${READER_INTRO_TEXT} | Intro & index: ${READER_INTRO_INDEX_URL}`,
      '#Reader #Reading #EPUB #PDF',
    ]
      .filter(Boolean)
      .join('\n');
    const shareUrl = `https://x.com/intent/post?text=${encodeURIComponent(shareText)}`;
    openExternalUrl(shareUrl);
    clearSelectionDraft();
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
    if (action === 'simple') {
      openUnderstandPanel('simple');
      return;
    }
    if (action === 'context') {
      openUnderstandPanel('context');
      return;
    }
    if (action === 'term') {
      openUnderstandPanel('term');
      return;
    }
    if (action === 'dict') {
      openDictPanel();
      return;
    }
    if (action === 'takeaway') {
      openUnderstandPanel('takeaway');
      return;
    }
    if (action === 'ask') {
      setIsQuestionInputExpanded(true);
      return;
    }
    if (action === 'play') {
      setTtsConfirmParagraphId(selectionDraft.paragraphId);
      return;
    }
    if (action === 'copy') {
      void handleCopySelection();
      return;
    }
    if (action === 'share') {
      handleShareSelectionToX();
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

  useEffect(() => {
    if (!isTwoColumnLayout || !currentReadingSentenceKey) return;
    const parsed = parseSentenceKey(currentReadingSentenceKey);
    if (!parsed) return;
    const idx = visibleParagraphs.findIndex((item) => item.id === parsed.paragraphId);
    if (idx < 0) return;
    const page = Math.floor(idx / doubleColumnPageSize);
    setColumnPageIndex(page);
  }, [currentReadingSentenceKey, doubleColumnPageSize, isTwoColumnLayout, visibleParagraphs]);

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
  }, [columnPageIndex, currentReadingSentenceKey]);

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
  }, [columnPageIndex, focusedParagraphId, setFocusedParagraphId]);

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

  const selectionPopoverViewportWidth = window.innerWidth;
  const selectionPopoverViewportHeight = window.innerHeight;
  const selectionPopoverWidth = Math.min(
    selectionPopoverSize.width,
    Math.floor(selectionPopoverViewportWidth * 0.92)
  );
  const selectionPopoverHalfWidth = selectionPopoverWidth / 2;
  const selectionPopoverEdgePadding = 12;
  const selectionPopoverMinCenterX =
    selectionPopoverHalfWidth + selectionPopoverEdgePadding;
  const selectionPopoverMaxCenterX = Math.max(
    selectionPopoverMinCenterX,
    selectionPopoverViewportWidth -
      selectionPopoverHalfWidth -
      selectionPopoverEdgePadding
  );
  const selectionPopoverLeft = selectionAnchor
    ? Math.max(
        selectionPopoverMinCenterX,
        Math.min(
          selectionAnchor.x + selectionPopoverOffset.x,
          selectionPopoverMaxCenterX
        )
      )
    : selectionPopoverMinCenterX;

  return (
    <div
      ref={contentRef}
      className="relative flex-1 overflow-y-auto"
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
                ? { columnCount: 2, columnGap: '3rem', columnFill: 'auto', width: '100%' }
                : undefined
            }
          >
          {displayedParagraphs.map((paragraph) => {
            const isMarkdownParagraph = currentDocumentType === 'markdown';
            const paragraphMeta = isMarkdownParagraph
              ? markdownParagraphMeta[paragraph.id]
              : undefined;
            const isMediaLinksParagraph = paragraphMeta?.inMediaLinks || false;
            const groupedParagraphIds =
              currentDocumentType === 'pdf'
                ? (pdfTableMemberIdsByLeader.get(paragraph.id) || [paragraph.id])
                : [paragraph.id];
            const normalizedMarkdownText = isMarkdownParagraph
              ? (normalizedMarkdownTexts[paragraph.id] || paragraph.text)
              : paragraph.text;
            const translatableMarkdownText = isMarkdownParagraph
              ? (
                  isMultimediaMode
                    ? sanitizeMarkdownForTranslation(paragraph.text, {
                        inMediaLinks: isMediaLinksParagraph,
                      })
                    : paragraph.text
                )
              : paragraph.text;
            const canTranslateMarkdownParagraph = Boolean(translatableMarkdownText.trim());
            const normalizedPdfText =
              currentDocumentType === 'pdf'
                ? normalizePdfTextViewText(paragraph.text)
                : paragraph.text;
            const currentPage = parsePdfPageFromLocation(paragraph.location);
            const shouldShowPdfPreview = false;
            const pdfParagraphKind =
              currentDocumentType === 'pdf'
                ? classifyPdfParagraph(
                    {
                      ...paragraph,
                      text: normalizedPdfText,
                    },
                    currentPage
                  )
                : 'body';
            const pdfDisplayText =
              currentDocumentType === 'pdf' && pdfParagraphKind === 'toc'
                ? formatPdfTocParagraph(paragraph.text)
                : normalizedPdfText;
            const sentences =
              currentDocumentType === 'pdf'
                ? splitIntoSentences(pdfDisplayText).filter(
                    (sentence) =>
                      !isPdfStandalonePunctuationParagraph(sentence) &&
                      !isPdfStandalonePageNumberParagraph(sentence)
                  )
                : splitIntoSentences(paragraph.text);
            const isSearchMatchedParagraph = groupedParagraphIds.some((id) =>
              matchedParagraphSet.current.has(id)
            );
            const shouldHighlightText = isSearchMatchedParagraph && Boolean(searchHighlightQuery.trim());
            const paragraphAnnotations = groupedParagraphIds.flatMap(
              (id) => annotationsByParagraph[id] || []
            );

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
                          remarkPlugins={[remarkGfm, remarkMath]}
                          rehypePlugins={[rehypeKatex]}
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
                            code: ({ className, children }) => {
                              const rawCode = toCodeText(children).replace(/\n$/, '');
                              const language = inferCodeLanguage(className);
                              const displayMathHtml =
                                language === 'math' ? renderKatexHtml(rawCode, true) : null;
                              if (displayMathHtml) {
                                return (
                                  <span
                                    className="my-2 block overflow-x-auto rounded-xl border px-4 py-3 text-center"
                                    style={{
                                      backgroundColor: currentTheme.secondary,
                                      borderColor: currentTheme.border,
                                    }}
                                    dangerouslySetInnerHTML={{ __html: displayMathHtml }}
                                  />
                                );
                              }

                              const inlineMathHtml =
                                !className && isArxivHtmlDocument && looksLikeLatexMath(rawCode)
                                  ? renderKatexHtml(rawCode, false)
                                  : null;
                              if (inlineMathHtml) {
                                return (
                                  <span
                                    className="inline-block align-middle"
                                    dangerouslySetInnerHTML={{ __html: inlineMathHtml }}
                                  />
                                );
                              }

                              return (
                                <code className={className ? `${className} rounded px-1 py-0.5` : 'rounded px-1 py-0.5'} style={{ backgroundColor: currentTheme.codeBg, color: currentTheme.codeText }}>
                                  {renderMarkdownChildren(children, shouldHighlightText ? searchHighlightQuery : '', paragraphAnnotations, `code-${paragraph.id}`)}
                                </code>
                              );
                            },
                            pre: ({ children }) => {
                              const codeNode = Children.toArray(children)[0];
                              if (isValidElement(codeNode)) {
                                const props = codeNode.props as { className?: string; children?: ReactNode };
                                const rawCode = toCodeText(props.children).replace(/\n$/, '');
                                const language = inferCodeLanguage(props.className);
                                const displayMathHtml =
                                  language === 'math' ? renderKatexHtml(rawCode, true) : null;
                                if (displayMathHtml) {
                                  return (
                                    <div
                                      className="my-4 overflow-x-auto rounded-xl border px-4 py-3 text-center"
                                      style={{
                                        fontSize: `${Math.max(viewSettings.fontSize - 1, 13)}px`,
                                        backgroundColor: currentTheme.secondary,
                                        color: currentTheme.foreground,
                                        borderColor: currentTheme.border,
                                        fontFamily: 'Georgia, Times, serif',
                                        lineHeight: 1.8,
                                      }}
                                      dangerouslySetInnerHTML={{ __html: displayMathHtml }}
                                    />
                                  );
                                }
                                if (language === 'math') {
                                  return (
                                    <div
                                      className="my-4 overflow-x-auto rounded-xl border px-4 py-3 text-center"
                                      style={{
                                        fontSize: `${Math.max(viewSettings.fontSize - 1, 13)}px`,
                                        backgroundColor: currentTheme.secondary,
                                        color: currentTheme.foreground,
                                        borderColor: currentTheme.border,
                                        fontFamily: 'Georgia, Times, serif',
                                        lineHeight: 1.8,
                                      }}
                                    >
                                      {rawCode}
                                    </div>
                                  );
                                }
                                return (
                                  <pre
                                    className="my-3 overflow-x-auto rounded border p-3"
                                    style={{ fontSize: `${Math.max(viewSettings.fontSize - 2, 12)}px`, backgroundColor: currentTheme.codeBg, color: currentTheme.codeText, borderColor: currentTheme.border }}
                                  >
                                    <code className={props.className || 'block'} style={{ backgroundColor: 'transparent', color: currentTheme.codeText }}>
                                      {renderHighlightedCode(rawCode, language, currentTheme.isDark)}
                                    </code>
                                  </pre>
                                );
                              }
                              return (
                                <pre
                                  className="my-3 overflow-x-auto rounded border p-3"
                                  style={{ fontSize: `${Math.max(viewSettings.fontSize - 2, 12)}px`, backgroundColor: currentTheme.codeBg, color: currentTheme.codeText, borderColor: currentTheme.border }}
                                >
                                  {renderMarkdownChildren(children, shouldHighlightText ? searchHighlightQuery : '', paragraphAnnotations, `pre-${paragraph.id}`)}
                                </pre>
                              );
                            },
                            a: ({ href, children }) => (
                              <a
                                href={href}
                                target="_blank"
                                rel="noreferrer"
                                className="underline"
                                style={{ color: currentTheme.link }}
                                onClick={(event) => openLinkInExternalBrowser(event, href)}
                              >
                                {renderMarkdownChildren(children, shouldHighlightText ? searchHighlightQuery : '', paragraphAnnotations, `a-${paragraph.id}`)}
                              </a>
                            ),
                            img: ({ src, alt }) => {
                              const normalizedSrc = normalizeArxivAssetUrl(src, documentSourceUrl);
                              const preferEagerImageLoad =
                                isArxivHtmlDocument || normalizedSrc.startsWith('data:image/');
                              if (!isMultimediaMode && !isArxivHtmlDocument) {
                                return (
                                  <span
                                    className="my-2 block text-sm italic"
                                    style={{ color: currentTheme.isDark ? '#9ca3af' : '#6b7280' }}
                                  >
                                    {alt ? `Image: ${normalizeInlineText(alt)}` : 'Image'}
                                  </span>
                                );
                              }

                              if (isMediaLinksParagraph) {
                                return (
                                  <a
                                    href={normalizedSrc}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="my-2 inline-flex max-w-full items-center gap-3 rounded-lg border p-2 no-underline"
                                    style={{ borderColor: currentTheme.border, backgroundColor: currentTheme.secondary }}
                                    onClick={(event) => openLinkInExternalBrowser(event, normalizedSrc)}
                                  >
                                    <img
                                      src={normalizedSrc}
                                      alt={alt || 'Media thumbnail'}
                                      loading={preferEagerImageLoad ? 'eager' : 'lazy'}
                                      fetchPriority={preferEagerImageLoad ? 'high' : 'auto'}
                                      referrerPolicy="no-referrer"
                                      className="h-16 w-24 shrink-0 rounded border object-cover"
                                      style={{ borderColor: currentTheme.border, backgroundColor: currentTheme.background }}
                                    />
                                    <span className="min-w-0 text-sm leading-5" style={{ color: currentTheme.foreground }}>
                                      {alt || 'Open image'}
                                    </span>
                                  </a>
                                );
                              }

                              return (
                                <img
                                  src={normalizedSrc}
                                  alt={alt || 'Article image'}
                                  loading={preferEagerImageLoad ? 'eager' : 'lazy'}
                                  fetchPriority={preferEagerImageLoad ? 'high' : 'auto'}
                                  referrerPolicy="no-referrer"
                                  className="my-4 max-h-[36rem] w-auto max-w-full rounded-lg border object-contain"
                                  style={{ borderColor: currentTheme.border, backgroundColor: currentTheme.secondary }}
                                />
                              );
                            },
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
                      <div className="mt-2">
                        {translations[markdownTranslationKey(paragraph.id)] ? (
                          renderTranslationCard(
                            renderTranslationOutput(
                              translations[markdownTranslationKey(paragraph.id)],
                              (visibleText) => (
                                <div
                                  className="markdown-content"
                                  style={{ fontSize: `${Math.max(viewSettings.fontSize - 3, 12)}px`, lineHeight: translationLineHeight, color: currentTheme.foreground }}
                                >
                              <ReactMarkdown
                                    remarkPlugins={[remarkGfm, remarkMath]}
                                    rehypePlugins={[rehypeKatex]}
                                    components={{
                                      a: ({ href, children }) => (
                                        <a
                                          href={href}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="underline"
                                          style={{ color: currentTheme.link }}
                                          onClick={(event) => openLinkInExternalBrowser(event, href)}
                                        >
                                          {children}
                                        </a>
                                      ),
                                      img: ({ alt }) => (
                                        <span
                                          className="my-1 block text-xs italic"
                                          style={{ color: currentTheme.isDark ? '#9ca3af' : '#6b7280' }}
                                        >
                                          {alt ? `Image: ${normalizeInlineText(alt)}` : 'Image'}
                                        </span>
                                      ),
                                    }}
                                  >
                                    {visibleText}
                                  </ReactMarkdown>
                                </div>
                              )
                            )
                          )
                        ) : canTranslateMarkdownParagraph ? (
                          <div className={`${showSource ? 'ml-4' : ''} flex items-center gap-2 py-1`}>
                            <button
                              onClick={() =>
                                void handleTranslateMarkdownParagraph(
                                  paragraph.id,
                                  translatableMarkdownText
                                )
                              }
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
                        ) : null}
                      </div>
                    )}
                  </div>
                ) : (
                  (() => {
                    const pdfVisualNote = getPdfTextViewVisualNote(paragraph.text);
                    if (pdfVisualNote) {
                      return (
                        <div
                          className="my-3 rounded-lg border px-3 py-2 text-sm italic"
                          style={{
                            color: currentTheme.isDark ? '#cbd5e1' : '#475569',
                            borderColor: currentTheme.border,
                            backgroundColor: currentTheme.secondary,
                          }}
                        >
                          {pdfVisualNote}
                        </div>
                      );
                    }
                    if (currentDocumentType === 'pdf' && showSource) {
                      const pdfText = pdfDisplayText.trim();
                      if (pdfParagraphKind === 'title') {
                        return (
                          <header className="mb-6 text-center">
                            <h1
                              className="text-3xl font-semibold leading-tight tracking-tight text-slate-900"
                              style={{ color: currentTheme.foreground }}
                            >
                              {renderWithSearchHighlight(
                                pdfText,
                                isSearchMatchedParagraph,
                                paragraphAnnotations,
                                `${paragraph.id}-title`
                              )}
                            </h1>
                          </header>
                        );
                      }
                      if (pdfParagraphKind === 'heading1' || pdfParagraphKind === 'heading2' || pdfParagraphKind === 'heading3') {
                        const HeadingTag =
                          pdfParagraphKind === 'heading1'
                            ? 'h2'
                            : pdfParagraphKind === 'heading2'
                              ? 'h3'
                              : 'h4';
                        const headingClassName =
                          pdfParagraphKind === 'heading1'
                            ? 'mt-8 mb-3 text-2xl font-semibold'
                            : pdfParagraphKind === 'heading2'
                              ? 'mt-6 mb-2 text-xl font-semibold'
                              : 'mt-4 mb-2 text-lg font-semibold';
                        return (
                          <HeadingTag
                            className={headingClassName}
                            style={{ color: currentTheme.foreground }}
                          >
                            {renderWithSearchHighlight(
                              pdfText,
                              isSearchMatchedParagraph,
                              paragraphAnnotations,
                              `${paragraph.id}-heading`
                            )}
                          </HeadingTag>
                        );
                      }
                      if (pdfParagraphKind === 'caption') {
                        return (
                          <p
                            className="mb-3 text-center text-sm italic text-slate-600"
                            style={{ color: currentTheme.isDark ? '#cbd5e1' : '#475569' }}
                          >
                            {renderWithSearchHighlight(
                              pdfText,
                              isSearchMatchedParagraph,
                              paragraphAnnotations,
                              `${paragraph.id}-caption`
                            )}
                          </p>
                        );
                      }
                      if (pdfParagraphKind === 'keywords') {
                        return (
                          <p
                            className="mb-4 rounded-lg border px-3 py-2 text-sm italic"
                            style={{
                              color: currentTheme.isDark ? '#cbd5e1' : '#475569',
                              borderColor: currentTheme.border,
                              backgroundColor: currentTheme.secondary,
                            }}
                          >
                            {renderWithSearchHighlight(
                              pdfText,
                              isSearchMatchedParagraph,
                              paragraphAnnotations,
                              `${paragraph.id}-keywords`
                            )}
                          </p>
                        );
                      }
                      if (pdfParagraphKind === 'metadata') {
                        return (
                          <p
                            className={`mb-3 text-sm ${currentPage === 1 ? 'text-center' : ''}`}
                            style={{ color: currentTheme.isDark ? '#9ca3af' : '#64748b' }}
                          >
                            {renderWithSearchHighlight(
                              pdfText,
                              isSearchMatchedParagraph,
                              paragraphAnnotations,
                              `${paragraph.id}-meta`
                            )}
                          </p>
                        );
                      }
                      if (pdfParagraphKind === 'toc') {
                        return (
                          <pre
                            className="mb-3 overflow-x-auto whitespace-pre-wrap bg-transparent px-0 py-0 text-sm leading-7"
                            style={{
                              color: currentTheme.isDark ? '#cbd5e1' : '#475569',
                              fontSize: `${Math.max(viewSettings.fontSize - 2, 12)}px`,
                              fontVariantNumeric: 'tabular-nums',
                            }}
                          >
                            {renderWithSearchHighlight(
                              pdfText,
                              isSearchMatchedParagraph,
                              paragraphAnnotations,
                              `${paragraph.id}-toc`
                            )}
                          </pre>
                        );
                      }
                      if (pdfParagraphKind === 'table') {
                        return (
                          <pre
                            className="mb-4 overflow-x-auto whitespace-pre rounded-lg border px-3 py-3 text-sm leading-7"
                            style={{
                              color: currentTheme.foreground,
                              borderColor: currentTheme.border,
                              backgroundColor: currentTheme.secondary,
                              fontSize: `${Math.max(viewSettings.fontSize - 2, 12)}px`,
                              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                              fontVariantNumeric: 'tabular-nums',
                            }}
                          >
                            {renderWithSearchHighlight(
                              pdfText,
                              isSearchMatchedParagraph,
                              paragraphAnnotations,
                              `${paragraph.id}-table`
                            )}
                          </pre>
                        );
                      }
                      if (pdfParagraphKind === 'preformatted') {
                        return (
                          <pre
                            className="mb-4 overflow-x-auto whitespace-pre-wrap rounded-lg border px-3 py-2 text-sm leading-relaxed"
                            style={{
                              color: currentTheme.foreground,
                              borderColor: currentTheme.border,
                              backgroundColor: currentTheme.secondary,
                              fontSize: `${Math.max(viewSettings.fontSize - 2, 12)}px`,
                            }}
                          >
                            {renderWithSearchHighlight(
                              pdfText,
                              isSearchMatchedParagraph,
                              paragraphAnnotations,
                              `${paragraph.id}-pre`
                            )}
                          </pre>
                        );
                      }
                    }
                    if (
                      currentDocumentType === 'pdf' &&
                      (pdfParagraphKind === 'table' || pdfParagraphKind === 'preformatted')
                    ) {
                      return null;
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
                          <div className="mt-2">
                            {translations[key] ? (
                              renderTranslationCard(
                                renderTranslationOutput(translations[key], (visibleText) => (
                                  <p
                                    style={{ fontSize: `${Math.max(viewSettings.fontSize - 3, 12)}px`, lineHeight: translationLineHeight, color: currentTheme.foreground }}
                                  >
                                    {visibleText}
                                  </p>
                                ))
                              )
                            ) : (
                              <div className={`${showSource ? 'ml-4' : ''} flex items-center gap-2`}>
                                <button
                                  onClick={() => handleTranslateSentence(paragraph.id, sentence, index)}
                                  className="text-xs text-blue-600 hover:text-blue-800 underline"
                                >
                                  Translate
                                </button>
                              </div>
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
            left: `${selectionPopoverLeft}px`,
            top: `${Math.max(12, selectionAnchor.y + selectionPopoverOffset.y)}px`,
            width: `${selectionPopoverWidth}px`,
            height:
              selectionPopoverSize.height > 0
                ? `${Math.min(selectionPopoverSize.height, Math.floor(selectionPopoverViewportHeight * 0.72))}px`
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
