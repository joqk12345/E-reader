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
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-600">
            Target: <span className="font-medium text-gray-900">{getTargetLabel()}</span>
          </span>
          <button
            onClick={() => void runAnalysis()}
            disabled={isRunning || !selectedDocumentId}
            className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:bg-gray-300 transition-colors"
          >
            {isRunning ? 'Analyzing...' : 'Run Deep Analysis'}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border-b border-red-200">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4">
        {!result && !error && !isRunning && (
          <div className="flex items-center justify-center h-full text-sm text-gray-500">
            Run deep analysis to generate structured concept and logic output.
          </div>
        )}
        {result && (
          <div className="relative bg-white border border-gray-200 rounded-lg p-4">
            <button
              onClick={() => void handleCopy()}
              className={`absolute top-2 right-2 inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors ${
                isCopied
                  ? 'border-green-200 bg-green-50 text-green-700'
                  : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50 hover:text-gray-700'
              }`}
              title={isCopied ? 'Copied' : 'Copy analysis'}
              aria-label={isCopied ? 'Copied' : 'Copy analysis'}
            >
              {isCopied ? '✓' : '⧉'}
            </button>
            <pre className="whitespace-pre-wrap text-sm text-gray-800 leading-relaxed">
              {result}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};
