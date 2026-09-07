import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
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
          <span className="text-sm text-navigation">
            Target: <span className="font-medium text-heading">{getTargetLabel()}</span>
          </span>
          <button
            onClick={() => void runAnalysis()}
            disabled={isRunning || !selectedDocumentId}
            className="px-3 py-1.5 text-sm bg-action text-on-action rounded-md hover:bg-action disabled:bg-control-border transition-colors"
          >
            {isRunning ? 'Analyzing...' : 'Run Deep Analysis'}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-danger-subtle border-b border-danger/25">
          <p className="text-sm text-danger">{error}</p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4">
        {!result && !error && !isRunning && (
          <div className="flex items-center justify-center h-full text-sm text-muted">
            Run deep analysis to generate structured concept and logic output.
          </div>
        )}
        {result && (
          <div className="relative bg-surface border border-border rounded-lg p-4">
            <button
              onClick={() => void handleCopy()}
              className={`absolute top-2 right-2 inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors ${
                isCopied
                  ? 'border-success/25 bg-success/10 text-success'
                  : 'border-border bg-surface text-muted hover:bg-surface-subtle hover:text-secondary'
              }`}
              title={isCopied ? 'Copied' : 'Copy analysis'}
              aria-label={isCopied ? 'Copied' : 'Copy analysis'}
            >
              {isCopied ? '✓' : '⧉'}
            </button>
            <pre className="whitespace-pre-wrap text-sm text-foreground leading-relaxed">
              {result}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};
