import React, { useEffect, useMemo, useState } from 'react';
import { PanelButton } from './ui/Button';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../store/useStore';

type SummaryStyle = 'brief' | 'detailed' | 'bullet';
type SummaryScope = 'document' | 'section' | 'paragraph';

const SUMMARY_STYLE_OPTIONS: Array<{ value: SummaryStyle; label: string }> = [
  { value: 'detailed', label: 'Detailed' },
  { value: 'bullet', label: 'Bullet' },
  { value: 'brief', label: 'Compact' },
];

type SummaryTarget = {
  cacheKey: string;
  label: string;
  scope: SummaryScope;
  request: {
    docId?: string;
    sectionId?: string;
    paragraphId?: string;
    text?: string;
    style: SummaryStyle;
  };
};

const hashText = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const joinParagraphs = (paragraphs: { text: string }[]) =>
  paragraphs
    .map((paragraph) => paragraph.text.trim())
    .filter(Boolean)
    .join('\n\n');

export const SummaryPanel: React.FC = () => {
  const {
    selectedDocumentId,
    currentSectionId,
    currentDocumentType,
    focusedParagraphId,
    visibleParagraphs,
    summaryCache,
    setSummaryCache,
  } = useStore();
  const [style, setStyle] = useState<SummaryStyle>('brief');
  const [scope, setScope] = useState<SummaryScope>('section');
  const [summary, setSummary] = useState<string>('');
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stripThinking = (text: string) => {
    if (!text) return text;
    return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  };

  const focusedParagraph = useMemo(
    () => visibleParagraphs.find((paragraph) => paragraph.id === focusedParagraphId) || null,
    [focusedParagraphId, visibleParagraphs]
  );

  const currentSectionParagraphs = useMemo(
    () =>
      currentSectionId
        ? visibleParagraphs.filter((paragraph) => paragraph.section_id === currentSectionId)
        : [],
    [currentSectionId, visibleParagraphs]
  );

  const availableScopes = useMemo<SummaryScope[]>(() => {
    const scopes: SummaryScope[] = [];
    if (selectedDocumentId) scopes.push('document');
    if (currentSectionId) scopes.push('section');
    if (focusedParagraph) scopes.push('paragraph');
    return scopes;
  }, [currentSectionId, focusedParagraph, selectedDocumentId]);

  useEffect(() => {
    if (availableScopes.includes(scope)) {
      return;
    }
    if (availableScopes.includes('section')) {
      setScope('section');
      return;
    }
    if (availableScopes.includes('document')) {
      setScope('document');
      return;
    }
    if (availableScopes.includes('paragraph')) {
      setScope('paragraph');
    }
  }, [availableScopes, scope]);

  const target = useMemo<SummaryTarget | null>(() => {
    if (scope === 'paragraph' && focusedParagraph) {
      return {
        scope,
        label: 'Current Paragraph',
        cacheKey: `paragraph:${focusedParagraph.id}:${style}`,
        request: {
          paragraphId: focusedParagraph.id,
          style,
        },
      };
    }

    if (scope === 'section' && currentSectionId) {
      const sectionText = joinParagraphs(currentSectionParagraphs);
      if (sectionText) {
        return {
          scope,
          label: 'Current Section',
          cacheKey: `section:${currentSectionId}:${style}:${hashText(sectionText)}`,
          request: {
            text: sectionText,
            style,
          },
        };
      }
      return {
        scope,
        label: 'Current Section',
        cacheKey: `section:${currentSectionId}:${style}`,
        request: {
          sectionId: currentSectionId,
          style,
        },
      };
    }

    if (scope === 'document' && selectedDocumentId) {
      const documentText =
        currentDocumentType === 'markdown' ? joinParagraphs(visibleParagraphs) : '';
      if (documentText) {
        return {
          scope,
          label: 'Entire Document',
          cacheKey: `document:${selectedDocumentId}:${style}:${hashText(documentText)}`,
          request: {
            text: documentText,
            style,
          },
        };
      }
      return {
        scope,
        label: 'Entire Document',
        cacheKey: `document:${selectedDocumentId}:${style}`,
        request: {
          docId: selectedDocumentId,
          style,
        },
      };
    }

    return null;
  }, [
    currentDocumentType,
    currentSectionId,
    currentSectionParagraphs,
    focusedParagraph,
    scope,
    selectedDocumentId,
    style,
    visibleParagraphs,
  ]);

  useEffect(() => {
    setSummary('');
  }, [scope, selectedDocumentId, currentSectionId, focusedParagraphId]);

  useEffect(() => {
    setSummary(target ? summaryCache[target.cacheKey] || '' : '');
  }, [summaryCache, target]);

  useEffect(() => {
    if (!target || summaryCache[target.cacheKey]) return;

    const loadCachedSummary = async () => {
      try {
        const cached = await invoke<string | null>('get_summary_cache', target.request);
        if (cached) {
          const cleaned = stripThinking(cached);
          setSummary(cleaned);
          setSummaryCache(target.cacheKey, cleaned);
        }
      } catch (err) {
        console.warn('Failed to load cached summary:', err);
      }
    };

    void loadCachedSummary();
  }, [summaryCache, setSummaryCache, target]);

  const getFriendlyError = (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    const normalized = message.toLowerCase();
    if (
      normalized.includes('502') ||
      normalized.includes('bad gateway') ||
      normalized.includes('connection refused') ||
      normalized.includes('econnrefused') ||
      normalized.includes('failed to send request')
    ) {
      return 'LM Studio 服务未开启或模型未加载。请先启动 LM Studio 并加载模型。';
    }
    return message || 'Summarization failed';
  };

  const handleSummarize = async () => {
    if (!target) {
      setError('No summary target is available');
      return;
    }

    setIsSummarizing(true);
    setError(null);
    try {
      const result = await invoke<string>('summarize', target.request);
      const cleaned = stripThinking(result);
      setSummary(cleaned);
      setSummaryCache(target.cacheKey, cleaned);
    } catch (err) {
      console.error('Summarize failed:', err);
      setError(getFriendlyError(err));
      setSummary('');
    } finally {
      setIsSummarizing(false);
    }
  };

  const handleCopy = async () => {
    if (!summary) return;
    try {
      await navigator.clipboard.writeText(summary);
      setIsCopied(true);
      window.setTimeout(() => setIsCopied(false), 1200);
    } catch (err) {
      console.error('Copy summary failed:', err);
      setError('Copy failed. Please retry.');
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-border">
        <div className="mb-3">
          <div className="mb-2 text-size-subheading font-medium text-secondary">Scope:</div>
          <div className="flex flex-wrap gap-2">
            {(['document', 'section', 'paragraph'] as SummaryScope[]).map((item) => {
              const enabled = availableScopes.includes(item);
              return (
                <PanelButton
                  key={item}
                  onClick={() => setScope(item)}
                  disabled={!enabled}
                  className={`px-3 py-1.5 text-size-subheading rounded-lg transition-colors ${
                    scope === item
                      ? 'bg-action text-on-action'
                      : 'bg-surface-subtle text-secondary hover:bg-surface-hover disabled:bg-surface-subtle disabled:text-faint'
                  }`}
                >
                  {item.charAt(0).toUpperCase() + item.slice(1)}
                </PanelButton>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-4 mb-3">
          <span className="text-size-subheading font-medium text-secondary">Style:</span>
          <div className="flex gap-2">
            {SUMMARY_STYLE_OPTIONS.map((item) => (
              <PanelButton
                key={item.value}
                onClick={() => setStyle(item.value)}
                className={`px-3 py-1.5 text-size-subheading rounded-lg transition-colors ${
                  style === item.value
                    ? 'bg-action text-on-action'
                    : 'bg-surface-subtle text-secondary hover:bg-surface-hover'
                }`}
              >
                {item.label}
              </PanelButton>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-size-subheading text-navigation">
            Target: <span className="font-medium text-heading">{target?.label || 'None'}</span>
          </span>
          <PanelButton
            onClick={() => void handleSummarize()}
            disabled={isSummarizing || !target}
            className="px-3 py-1.5 text-size-subheading bg-action text-on-action rounded-md hover:bg-action disabled:bg-control-border transition-colors"
          >
            {isSummarizing ? 'Summarizing...' : 'Generate Summary'}
          </PanelButton>
        </div>
      </div>

      {error && (
        <div role="alert" className="reader-ai-error p-4">
          <p className="text-size-subheading">{error}</p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4">
        {!summary && !error && !isSummarizing && (
          <div className="reader-ai-empty flex flex-col items-center justify-center h-full">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mb-3 text-faint" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-size-subheading">Click "Generate Summary" to create a summary</p>
          </div>
        )}

        {summary && (
          <div className="prose prose-sm max-w-none">
            <article className="reader-ai-card border border-border bg-surface">
              <div className="mb-3 flex items-center justify-between gap-3 border-b border-border pb-3">
                <div className="min-w-0">
                  <div className="reader-kicker text-size-meta font-medium uppercase text-muted">Summary</div>
                  <div className="mt-1 text-size-subheading font-medium text-heading">Generated Summary</div>
                </div>
                <PanelButton
                  onClick={() => void handleCopy()}
                  className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-size-subheading transition-colors ${
                    isCopied
                      ? 'border-success/25 bg-success/10 text-success'
                      : 'border-border bg-surface text-navigation hover:bg-surface-subtle hover:text-foreground'
                  }`}
                  title={isCopied ? 'Copied' : 'Copy summary'}
                  aria-label={isCopied ? 'Copied' : 'Copy summary'}
                >
                  {isCopied ? (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                      <path fillRule="evenodd" d="M16.704 5.29a1 1 0 010 1.414l-7.25 7.25a1 1 0 01-1.414 0l-3.25-3.25a1 1 0 111.414-1.414l2.543 2.543 6.543-6.543a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                      <path d="M6 2a2 2 0 00-2 2v8a2 2 0 002 2h1V6a2 2 0 012-2h5V4a2 2 0 00-2-2H6z" />
                      <path d="M9 6a1 1 0 00-1 1v9a2 2 0 002 2h6a1 1 0 001-1V8.414a1 1 0 00-.293-.707l-1.414-1.414A1 1 0 0014.586 6H9z" />
                    </svg>
                  )}
                  <span>{isCopied ? 'Copied' : 'Copy'}</span>
                </PanelButton>
              </div>

              {style === 'bullet' ? (
                <div className="whitespace-pre-wrap">{summary}</div>
              ) : (
                <p className="text-foreground leading-relaxed whitespace-pre-wrap">{summary}</p>
              )}
            </article>
          </div>
        )}
      </div>
    </div>
  );
};
