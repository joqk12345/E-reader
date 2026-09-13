import React, { useState } from 'react';
import { PanelButton } from './ui/Button';
import { invoke } from '@tauri-apps/api/core';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useStore } from '../store/useStore';

export const DeepAnalysisPanel: React.FC = () => {
  const { selectedDocumentId, currentSectionId, currentParagraph } = useStore();
  const [result, setResult] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);

  const getTargetLabel = () => {
    if (currentParagraph) return 'Current Paragraph';
    if (currentSectionId) return 'Current Section';
    if (selectedDocumentId) return 'Entire Document';
    return 'None';
  };

  const stripThinking = (text: string) => {
    if (!text) return text;
    return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  };

  const runAnalysis = async () => {
    if (!selectedDocumentId) {
      setError('Please select a document first');
      return;
    }
    setIsRunning(true);
    setError(null);
    try {
      const analysis = await invoke<string>('deep_analyze', {
        docId: currentParagraph ? undefined : selectedDocumentId,
        sectionId: currentParagraph ? undefined : currentSectionId || undefined,
        paragraphId: currentParagraph?.id || undefined,
      });
      setResult(stripThinking(analysis));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message || 'Deep analysis failed');
      setResult('');
    } finally {
      setIsRunning(false);
    }
  };

  const handleCopy = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(result);
    setIsCopied(true);
    window.setTimeout(() => setIsCopied(false), 1200);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between">
          <span className="text-size-subheading text-navigation">
            Target: <span className="font-medium text-heading">{getTargetLabel()}</span>
          </span>
          <PanelButton
            onClick={() => void runAnalysis()}
            disabled={isRunning || !selectedDocumentId}
            className="px-3 py-1.5 text-size-subheading bg-action text-on-action rounded-md hover:bg-action disabled:bg-control-border transition-colors"
          >
            {isRunning ? 'Analyzing...' : 'Run Deep Analysis'}
          </PanelButton>
        </div>
      </div>

      {error && (
        <div role="alert" className="reader-ai-error p-4">
          <p className="text-size-subheading">{error}</p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4">
        {!result && !error && !isRunning && (
          <div className="reader-ai-empty flex items-center justify-center h-full text-size-subheading">
            Run deep analysis to generate structured concept and logic output.
          </div>
        )}
        {result && (
          <article className="reader-ai-card">
            <div className="mb-4 flex items-start justify-between gap-3 border-b border-border pb-3">
              <div className="min-w-0">
                <div className="reader-kicker text-size-meta font-medium uppercase text-muted">
                  Deep Analysis
                </div>
                <div className="mt-1 truncate text-size-subheading font-medium text-heading">
                  {getTargetLabel()}
                </div>
              </div>
              <PanelButton
                onClick={() => void handleCopy()}
                className={`reader-ai-action inline-flex shrink-0 items-center gap-2 border text-size-caption transition-colors ${
                isCopied
                  ? 'border-success/25 bg-success/10 text-success'
                  : 'border-border bg-surface text-muted hover:bg-surface-subtle hover:text-secondary'
              }`}
                title={isCopied ? 'Copied' : 'Copy analysis'}
                aria-label={isCopied ? 'Copied' : 'Copy analysis'}
              >
                <span aria-hidden="true">{isCopied ? '✓' : '⧉'}</span>
                <span>{isCopied ? 'Copied' : 'Copy'}</span>
              </PanelButton>
            </div>
            <div className="reader-markdown break-words">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{result}</ReactMarkdown>
            </div>
          </article>
        )}
      </div>
    </div>
  );
};
