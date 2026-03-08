import React, { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useStore } from '../store/useStore';
import type { Paragraph, Section } from '../types';
import {
  loadTermGlossary,
  mergeUniqueStrings,
  normalizeStringArray,
  normalizeTermKey,
  normalizeWhitespace,
  saveTermGlossary,
  TERM_GLOSSARY_CHANGED_EVENT,
  type TermGlossaryEntry,
} from './termGlossary';

export type UnderstandMode = 'simple' | 'context' | 'term' | 'takeaway';

export type UnderstandRequest = {
  id: number;
  mode: UnderstandMode;
  selectedText: string;
  sentence: string;
  paragraphId?: string;
} | null;

type UnderstandPanelProps = {
  request?: UnderstandRequest;
};

type ParagraphContextOutput = {
  paragraph_id: string;
  doc_id: string;
  section_id: string;
};

type SupportContext = {
  docId?: string;
  sectionId?: string;
  paragraphId?: string;
};

type RelatedPassage = {
  paragraphId: string;
  docId: string;
  sectionId: string;
  sectionTitle: string;
  snippet: string;
  location: string;
};

type TermInsight = {
  termMeaning: string;
  whyItMattersHere: string;
  commonRenderings: string[];
  conceptTags: string[];
};

const stripThinking = (text: string) => text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
const stripFences = (text: string) =>
  text
    .replace(/^```json\s*/i, '')
    .replace(/^```markdown\s*/i, '')
    .replace(/^```/i, '')
    .replace(/```$/i, '')
    .trim();
const extractJsonBlock = (text: string): string | null => {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  return text.slice(start, end + 1);
};
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const truncate = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;

const buildSnippetAroundTerm = (text: string, term: string) => {
  const source = normalizeWhitespace(text);
  const keyword = term.trim();
  if (!source || !keyword) return truncate(source, 180);
  const lowerSource = source.toLowerCase();
  const lowerKeyword = keyword.toLowerCase();
  const index = lowerSource.indexOf(lowerKeyword);
  if (index < 0) return truncate(source, 180);
  const start = Math.max(0, index - 72);
  const end = Math.min(source.length, index + keyword.length + 72);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < source.length ? '…' : '';
  return `${prefix}${source.slice(start, end).trim()}${suffix}`;
};

const highlightTerm = (text: string, term: string) => {
  const keyword = term.trim();
  if (!keyword) return text;
  const regex = new RegExp(`(${escapeRegExp(keyword)})`, 'ig');
  const parts = text.split(regex);
  if (parts.length <= 1) return text;
  return parts.map((part, index) =>
    part.toLowerCase() === keyword.toLowerCase() ? (
      <mark key={`term-${index}`} className="rounded bg-yellow-200 px-0.5 text-inherit">
        {part}
      </mark>
    ) : (
      <span key={`text-${index}`}>{part}</span>
    ),
  );
};

const parseTermInsight = (raw: string): TermInsight => {
  const cleaned = stripFences(stripThinking(raw));
  const jsonCandidate = extractJsonBlock(cleaned) || cleaned;
  const normalized = jsonCandidate
    .replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":')
    .trim();

  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(normalized) as Record<string, unknown>;
  } catch {
    parsed = {};
  }

  return {
    termMeaning: String(parsed.term_meaning || parsed.termMeaning || '').trim() || '—',
    whyItMattersHere:
      String(parsed.why_it_matters_here || parsed.whyItMattersHere || '').trim() || '—',
    commonRenderings: normalizeStringArray(
      parsed.common_renderings || parsed.commonRenderings,
    ),
    conceptTags: normalizeStringArray(parsed.concept_tags || parsed.conceptTags),
  };
};

const termInsightToMarkdown = (insight: TermInsight) => {
  const renderings = insight.commonRenderings.length
    ? insight.commonRenderings.map((item) => `- ${item}`).join('\n')
    : '- —';
  const tags = insight.conceptTags.length ? insight.conceptTags.map((item) => `- ${item}`).join('\n') : '- —';
  return [
    '## Term Meaning',
    insight.termMeaning,
    '',
    '## Why It Matters Here',
    insight.whyItMattersHere,
    '',
    '## Common Renderings In This Document',
    renderings,
    '',
    '## Concept Tags',
    tags,
  ].join('\n');
};

const modeMeta: Record<UnderstandMode, { label: string; button: string; empty: string }> = {
  simple: {
    label: 'Explain Simply',
    button: 'Explain',
    empty: 'Select a difficult phrase or sentence, then use Explain Simply.',
  },
  context: {
    label: 'Explain with Context',
    button: 'Explain with Context',
    empty: 'Use this when a sentence depends on the surrounding paragraph.',
  },
  term: {
    label: 'Term Lens',
    button: 'Explain Term',
    empty: 'Select a term to see what it means in this document, not just in a dictionary.',
  },
  takeaway: {
    label: 'Takeaway',
    button: 'Extract Takeaway',
    empty: 'Use this to turn the current selection into one concise study note.',
  },
};

const buildPrompt = (
  mode: UnderstandMode,
  selectedText: string,
  sentence: string,
  extras?: {
    sectionContext?: string;
    relatedPassages?: RelatedPassage[];
    glossaryEntry?: TermGlossaryEntry | null;
  },
) => {
  const shared = [
    'You are a reading comprehension assistant for a local-first reader app.',
    `Selected text: "${selectedText}"`,
    `Sentence context: "${sentence}"`,
    'Keep the answer grounded in the provided reading context.',
    'Do not invent facts outside the text.',
    'Respond in Markdown.',
  ];

  if (extras?.sectionContext?.trim()) {
    shared.push(`Nearby section context:\n${extras.sectionContext.trim()}`);
  }

  if (extras?.relatedPassages?.length) {
    shared.push(
      'Other related passages in this document:',
      ...extras.relatedPassages.map(
        (item, index) =>
          `${index + 1}. [${item.sectionTitle || item.location || 'Context'}] ${item.snippet}`,
      ),
    );
  }

  if (extras?.glossaryEntry) {
    shared.push(
      `Reader glossary preferred rendering: ${extras.glossaryEntry.preferredRendering}`,
      `Reader glossary concept tags: ${
        extras.glossaryEntry.conceptTags.length ? extras.glossaryEntry.conceptTags.join(', ') : 'None'
      }`,
      'When helpful, stay consistent with the reader glossary unless the current passage clearly contradicts it.',
    );
  }

  if (mode === 'simple') {
    return [
      ...shared,
      'Task: explain the selected text in plain Chinese for a reader.',
      'Requirements:',
      '- preserve the original meaning',
      '- if the selection is a phrase, explain its role in the sentence',
      '- keep it concise and easy to understand',
      'Format:',
      '## Plain Explanation',
      '2-4 sentences.',
      '## Key Point',
      'One bullet only.',
    ].join('\n');
  }

  if (mode === 'context') {
    return [
      ...shared,
      'Task: explain the selected text and how it connects to the surrounding paragraph.',
      'Requirements:',
      '- first explain the local meaning',
      '- then explain why this sentence matters in the paragraph',
      '- keep the answer focused on comprehension, not writing advice',
      'Format:',
      '## Meaning',
      '2-4 sentences.',
      '## Context Link',
      '1-2 bullets.',
    ].join('\n');
  }

  if (mode === 'term') {
    return [
      ...shared,
      'Task: analyze the selected term in the current document context.',
      'Requirements:',
      '- explain what the term means here, not as a generic encyclopedia entry',
      '- if the term is ambiguous, note the most likely sense in this passage',
      '- infer the common Chinese renderings used or most consistent with this document context',
      '- produce compact concept tags that help the reader categorize the idea',
      'Return strict JSON only with keys: term_meaning, why_it_matters_here, common_renderings, concept_tags.',
      'common_renderings must be an array of short strings.',
      'concept_tags must be an array of short strings.',
    ].join('\n');
  }

  return [
    ...shared,
    'Task: write one concise study takeaway based on the selected text.',
    'Requirements:',
    '- one sentence only',
    '- preserve key terms when they matter',
    '- write it as a reading note, not as a rewrite of the source',
    'Format:',
    '## Takeaway',
    'One sentence only.',
  ].join('\n');
};

export const UnderstandPanel: React.FC<UnderstandPanelProps> = ({ request }) => {
  const {
    documents,
    selectedDocumentId,
    currentDocumentType,
    currentSectionId,
    currentParagraph,
    selectDocument,
    loadSections,
    loadDocumentParagraphs,
    selectSection,
    loadParagraphs,
    setFocusedParagraphId,
  } = useStore();
  const [mode, setMode] = useState<UnderstandMode>('simple');
  const [selectedText, setSelectedText] = useState('');
  const [sentence, setSentence] = useState('');
  const [paragraphId, setParagraphId] = useState<string | undefined>(undefined);
  const [result, setResult] = useState('');
  const [termInsight, setTermInsight] = useState<TermInsight | null>(null);
  const [glossary, setGlossary] = useState<TermGlossaryEntry[]>([]);
  const [isGlossaryLoaded, setIsGlossaryLoaded] = useState(false);
  const [sectionContext, setSectionContext] = useState('');
  const [relatedPassages, setRelatedPassages] = useState<RelatedPassage[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [contextDocId, setContextDocId] = useState<string | null>(selectedDocumentId || null);

  const targetLabel = useMemo(() => {
    if (paragraphId || currentParagraph?.id) return 'Current Paragraph';
    if (currentSectionId) return 'Current Section';
    if (selectedDocumentId) return 'Entire Document';
    return 'None';
  }, [currentParagraph?.id, currentSectionId, paragraphId, selectedDocumentId]);

  const canRun = Boolean(
    selectedText.trim() && (selectedDocumentId || currentSectionId || currentParagraph?.id || paragraphId),
  );

  const currentGlossaryEntry = useMemo(() => {
    const docId = contextDocId || selectedDocumentId;
    const termKey = normalizeTermKey(selectedText);
    if (!docId || !termKey) return null;
    return glossary.find((item) => item.docId === docId && item.termKey === termKey) || null;
  }, [contextDocId, glossary, selectedDocumentId, selectedText]);

  const displayRenderings = useMemo(() => {
    if (!termInsight) return currentGlossaryEntry?.preferredRendering ? [currentGlossaryEntry.preferredRendering] : [];
    const preferred = currentGlossaryEntry?.preferredRendering
      ? [currentGlossaryEntry.preferredRendering]
      : [];
    return mergeUniqueStrings(preferred, termInsight.commonRenderings);
  }, [currentGlossaryEntry?.preferredRendering, termInsight]);

  const displayConceptTags = useMemo(() => {
    return mergeUniqueStrings(currentGlossaryEntry?.conceptTags || [], termInsight?.conceptTags || []);
  }, [currentGlossaryEntry?.conceptTags, termInsight?.conceptTags]);

  useEffect(() => {
    setGlossary(loadTermGlossary());
    setIsGlossaryLoaded(true);
  }, []);

  useEffect(() => {
    const onChanged = () => setGlossary(loadTermGlossary());
    window.addEventListener(TERM_GLOSSARY_CHANGED_EVENT, onChanged as EventListener);
    return () => window.removeEventListener(TERM_GLOSSARY_CHANGED_EVENT, onChanged as EventListener);
  }, []);

  useEffect(() => {
    if (!isGlossaryLoaded) return;
    const currentSnapshot = JSON.stringify(loadTermGlossary());
    const nextSnapshot = JSON.stringify(glossary);
    if (currentSnapshot === nextSnapshot) return;
    saveTermGlossary(glossary);
  }, [glossary, isGlossaryLoaded]);

  const resolveContext = async (targetParagraphId?: string): Promise<SupportContext> => {
    if (targetParagraphId) {
      try {
        const output = await invoke<ParagraphContextOutput | null>('get_paragraph_context', {
          paragraphId: targetParagraphId,
        });
        if (output) {
          return {
            docId: output.doc_id,
            sectionId: output.section_id,
            paragraphId: output.paragraph_id,
          };
        }
      } catch (err) {
        console.warn('Failed to resolve paragraph context:', err);
      }
      return { paragraphId: targetParagraphId, docId: selectedDocumentId || undefined, sectionId: currentSectionId || undefined };
    }
    if (currentParagraph?.id) {
      return {
        paragraphId: currentParagraph.id,
        docId: selectedDocumentId || undefined,
        sectionId: currentSectionId || undefined,
      };
    }
    if (currentSectionId) {
      return { sectionId: currentSectionId, docId: selectedDocumentId || undefined };
    }
    if (selectedDocumentId) return { docId: selectedDocumentId };
    return {};
  };

  const buildChatTarget = (context: SupportContext): SupportContext => {
    if (context.paragraphId) return { paragraphId: context.paragraphId };
    if (context.sectionId) return { sectionId: context.sectionId };
    if (context.docId) return { docId: context.docId };
    return {};
  };

  const loadSectionContext = async (context: SupportContext) => {
    if (!context.sectionId) {
      setSectionContext('');
      return '';
    }
    try {
      const paragraphs = await invoke<Paragraph[]>('get_section_paragraphs', {
        sectionId: context.sectionId,
      });
      if (paragraphs.length === 0) {
        setSectionContext('');
        return '';
      }
      const centerIndex = context.paragraphId
        ? Math.max(0, paragraphs.findIndex((item) => item.id === context.paragraphId))
        : 0;
      const windowStart = Math.max(0, centerIndex - 1);
      const windowEnd = Math.min(paragraphs.length, centerIndex + 2);
      const excerpt = paragraphs
        .slice(windowStart, windowEnd)
        .map((item, index) => {
          const absoluteIndex = windowStart + index;
          const label =
            absoluteIndex === centerIndex ? 'Current paragraph' : absoluteIndex < centerIndex ? 'Previous paragraph' : 'Next paragraph';
          return `${label}: ${normalizeWhitespace(item.text)}`;
        })
        .join('\n');
      setSectionContext(excerpt);
      return excerpt;
    } catch (err) {
      console.warn('Failed to load section context:', err);
      setSectionContext('');
      return '';
    }
  };

  const loadRelatedPassages = async (docId: string, term: string, currentParagraphId?: string) => {
    if (!term.trim()) {
      setRelatedPassages([]);
      return [];
    }
    try {
      const [paragraphs, sections] = await Promise.all([
        invoke<Paragraph[]>('get_document_paragraphs', { docId }),
        invoke<Section[]>('get_document_sections', { docId }),
      ]);
      const sectionTitles = new Map(sections.map((item) => [item.id, item.title]));
      const lowerTerm = term.trim().toLowerCase();
      const matches = paragraphs
        .filter((item) => normalizeWhitespace(item.text).toLowerCase().includes(lowerTerm))
        .sort((a, b) => {
          if (a.id === currentParagraphId) return -1;
          if (b.id === currentParagraphId) return 1;
          return a.order_index - b.order_index;
        })
        .slice(0, 5)
        .map((item) => ({
          paragraphId: item.id,
          docId,
          sectionId: item.section_id,
          sectionTitle: sectionTitles.get(item.section_id) || 'Untitled Section',
          snippet: buildSnippetAroundTerm(item.text, term),
          location: item.location,
        }));
      setRelatedPassages(matches);
      return matches;
    } catch (err) {
      console.warn('Failed to load related passages:', err);
      setRelatedPassages([]);
      return [];
    }
  };

  const getFriendlyError = (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    const normalized = message.toLowerCase();
    if (
      normalized.includes('failed to send request') ||
      normalized.includes('connection refused') ||
      normalized.includes('econnrefused') ||
      normalized.includes('timed out')
    ) {
      return '理解服务暂不可用。请确认当前 AI provider 已启动并可访问。';
    }
    return message || 'Understand request failed';
  };

  const getDisplayMarkdown = () => {
    if (mode === 'term' && termInsight) {
      return termInsightToMarkdown({
        ...termInsight,
        commonRenderings: displayRenderings,
        conceptTags: displayConceptTags,
      });
    }
    return result;
  };

  const run = async (
    nextMode: UnderstandMode = mode,
    nextText: string = selectedText,
    nextSentence: string = sentence,
    nextParagraphId: string | undefined = paragraphId,
  ) => {
    if (!nextText.trim()) {
      setError('Please select text first.');
      setResult('');
      return;
    }
    if (!selectedDocumentId && !currentSectionId && !currentParagraph?.id && !nextParagraphId) {
      setError('Please select a document first.');
      setResult('');
      return;
    }

    setIsRunning(true);
    setError(null);
    setTermInsight(null);
    try {
      const targetContext = await resolveContext(nextParagraphId);
      setContextDocId(targetContext.docId || selectedDocumentId || null);
      const chatTarget = buildChatTarget(targetContext);
      const sectionExcerpt =
        nextMode === 'context' ? await loadSectionContext(targetContext) : '';
      if (nextMode !== 'context') {
        setSectionContext('');
      }
      const passages =
        nextMode === 'term' && targetContext.docId
          ? await loadRelatedPassages(targetContext.docId, nextText, targetContext.paragraphId)
          : [];
      if (nextMode !== 'term') {
        setRelatedPassages([]);
      }
      const answer = await invoke<string>('chat_with_context', {
        question: buildPrompt(nextMode, nextText, nextSentence || nextText, {
          sectionContext: sectionExcerpt,
          relatedPassages: passages,
          glossaryEntry:
            nextMode === 'term' && targetContext.docId
              ? glossary.find(
                  (item) =>
                    item.docId === targetContext.docId &&
                    item.termKey === normalizeTermKey(nextText),
                ) || null
              : null,
        }),
        docId: chatTarget.docId,
        sectionId: chatTarget.sectionId,
        paragraphId: chatTarget.paragraphId,
        history: [],
      });
      if (nextMode === 'term') {
        setTermInsight(parseTermInsight(answer));
        setResult('');
      } else {
        setResult(stripThinking(answer));
      }
    } catch (err) {
      setError(getFriendlyError(err));
      setResult('');
      setTermInsight(null);
    } finally {
      setIsRunning(false);
    }
  };

  useEffect(() => {
    if (!request?.selectedText?.trim()) return;
    setMode(request.mode);
    setSelectedText(request.selectedText);
    setSentence(request.sentence || request.selectedText);
    setParagraphId(request.paragraphId);
    setContextDocId(selectedDocumentId || null);
    void run(request.mode, request.selectedText, request.sentence || request.selectedText, request.paragraphId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.id]);

  const handleCopy = async () => {
    const textToCopy = getDisplayMarkdown().trim();
    if (!textToCopy) return;
    try {
      await navigator.clipboard.writeText(textToCopy);
      setIsCopied(true);
      window.setTimeout(() => setIsCopied(false), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Copy failed');
    }
  };

  const handleAddToNotes = () => {
    const noteText = getDisplayMarkdown().trim();
    if (!selectedText.trim() || !noteText) return;
    window.dispatchEvent(
      new CustomEvent<{
        docId?: string;
        paragraphId?: string;
        selectedText: string;
        noteText?: string;
      }>('reader:take-note', {
        detail: {
          docId: selectedDocumentId || undefined,
          paragraphId,
          selectedText: selectedText.trim(),
          noteText,
        },
      }),
    );
  };

  const handlePassageClick = async (passage: RelatedPassage) => {
    try {
      const targetDocType = documents.find((doc) => doc.id === passage.docId)?.file_type;
      const markdownTarget = targetDocType === 'markdown' || currentDocumentType === 'markdown';

      if (selectedDocumentId !== passage.docId) {
        selectDocument(passage.docId);
        await loadSections(passage.docId);
        if (markdownTarget) {
          await loadDocumentParagraphs(passage.docId);
        }
      }

      selectSection(passage.sectionId);
      if (!markdownTarget) {
        await loadParagraphs(passage.sectionId);
      }
      setFocusedParagraphId(passage.paragraphId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Jump failed');
    }
  };

  const handlePinPreferredRendering = (rendering: string) => {
    const docId = contextDocId || selectedDocumentId;
    const term = normalizeWhitespace(selectedText);
    const preferredRendering = rendering.trim();
    if (!docId || !term || !preferredRendering) return;
    const termKey = normalizeTermKey(term);
    const entry: TermGlossaryEntry = {
      docId,
      term,
      termKey,
      preferredRendering,
      conceptTags: displayConceptTags,
      updatedAt: Date.now(),
    };
    setGlossary((prev) => {
      const others = prev.filter((item) => !(item.docId === docId && item.termKey === termKey));
      return [entry, ...others].slice(0, 500);
    });
  };

  const handleOpenGlossary = () => {
    window.dispatchEvent(
      new CustomEvent<{ term?: string }>('reader:open-glossary', {
        detail: { term: selectedText.trim() || undefined },
      }),
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-gray-200 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-600">
            Target: <span className="font-medium text-gray-900">{targetLabel}</span>
          </span>
          <button
            onClick={() => void run()}
            disabled={!canRun || isRunning}
            className="rounded-md bg-blue-500 px-3 py-1.5 text-sm text-white transition-colors hover:bg-blue-600 disabled:bg-gray-300"
          >
            {isRunning ? 'Running...' : modeMeta[mode].button}
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {(Object.keys(modeMeta) as UnderstandMode[]).map((item) => (
            <button
              key={item}
              onClick={() => {
                setMode(item);
                void run(item, selectedText, sentence, paragraphId);
              }}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                mode === item
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-300 text-gray-700 hover:border-gray-400 hover:bg-gray-50'
              }`}
            >
              {modeMeta[item].label}
            </button>
          ))}
        </div>

        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Selection</div>
          <div className="mt-1 text-sm leading-relaxed text-gray-800">{selectedText || 'No selection yet.'}</div>
        </div>

        {sentence && sentence.trim() && sentence.trim() !== selectedText.trim() && (
          <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
            <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Sentence Context</div>
            <div className="mt-1 text-sm leading-relaxed text-gray-700">{sentence}</div>
          </div>
        )}

        {mode === 'context' && sectionContext && (
          <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
            <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Nearby Section Context</div>
            <pre className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-gray-700 font-sans">
              {sectionContext}
            </pre>
          </div>
        )}
      </div>

      {error && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4">
        {!result && !error && !isRunning && (
          <div className="flex h-full items-center justify-center text-center text-sm text-gray-500">
            {modeMeta[mode].empty}
          </div>
        )}

        {(result || termInsight) && (
          <div className="space-y-3">
            <div className="relative rounded-lg border border-gray-200 bg-white p-4">
              <div className="absolute right-2 top-2 flex items-center gap-2">
                <button
                  onClick={handleAddToNotes}
                  className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50 hover:text-gray-800"
                >
                  Add to Notes
                </button>
                <button
                  onClick={() => void handleCopy()}
                  className={`inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors ${
                    isCopied
                      ? 'border-green-200 bg-green-50 text-green-700'
                      : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50 hover:text-gray-700'
                  }`}
                  title={isCopied ? 'Copied' : 'Copy result'}
                  aria-label={isCopied ? 'Copied' : 'Copy result'}
                >
                  {isCopied ? '✓' : '⧉'}
                </button>
              </div>
              {mode === 'term' && termInsight ? (
                <div className="space-y-4 pr-20">
                  <div>
                    <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                      Term Meaning
                    </div>
                    <div className="mt-1 text-sm leading-relaxed text-gray-800">
                      {termInsight.termMeaning}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                      Why It Matters Here
                    </div>
                    <div className="mt-1 text-sm leading-relaxed text-gray-800">
                      {termInsight.whyItMattersHere}
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                        Common Renderings In This Document
                      </div>
                      <button
                        onClick={handleOpenGlossary}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        Open Glossary
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(displayRenderings.length
                        ? displayRenderings
                        : ['—']).map((item) => (
                        <button
                          key={item}
                          onClick={() => handlePinPreferredRendering(item)}
                          disabled={item === '—'}
                          className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                            currentGlossaryEntry?.preferredRendering === item
                              ? 'border-emerald-300 bg-emerald-100 text-emerald-800'
                              : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-300 hover:bg-emerald-100'
                          } disabled:cursor-default disabled:opacity-70`}
                          title={
                            item === '—'
                              ? 'No rendering available'
                              : currentGlossaryEntry?.preferredRendering === item
                                ? 'Pinned preferred rendering'
                                : 'Pin as preferred rendering'
                          }
                        >
                          {currentGlossaryEntry?.preferredRendering === item ? `Pinned: ${item}` : item}
                        </button>
                      ))}
                    </div>
                    {currentGlossaryEntry?.preferredRendering && (
                      <div className="mt-2 text-xs text-emerald-700">
                        Preferred rendering saved for this document: {currentGlossaryEntry.preferredRendering}
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                      Concept Tags
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(displayConceptTags.length ? displayConceptTags : ['—']).map((item) => (
                        <span
                          key={item}
                          className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700"
                        >
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="prose prose-sm max-w-none pr-20">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{result}</ReactMarkdown>
                </div>
              )}
            </div>

            {mode === 'term' && relatedPassages.length > 0 && (
              <div className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="mb-3 text-sm font-semibold text-gray-800">Related Passages In This Document</div>
                <div className="space-y-2">
                  {relatedPassages.map((item) => (
                    <button
                      key={item.paragraphId}
                      onClick={() => void handlePassageClick(item)}
                      className="block w-full rounded-md border border-gray-100 bg-gray-50 px-3 py-2 text-left transition-colors hover:border-blue-200 hover:bg-blue-50"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                          {item.sectionTitle}
                        </div>
                        <span className="text-xs text-blue-600">Jump</span>
                      </div>
                      <div className="mt-1 text-sm leading-relaxed text-gray-700">
                        {highlightTerm(item.snippet, selectedText)}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
