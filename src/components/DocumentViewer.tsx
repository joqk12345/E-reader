import type { ReactNode } from 'react';
import type { Document } from '../types';
import { Button } from './ui/Button';

type DocumentViewerProps = {
  documentType: string | null;
  document: Document | null;
  onBack: () => void;
  children: ReactNode;
};

export function DocumentViewer({ documentType, document, onBack, children }: DocumentViewerProps) {
  if (documentType !== 'pdf' && documentType !== 'markdown') return <>{children}</>;

  const formatName = documentType === 'pdf' ? 'PDF' : 'Markdown';

  return (
    <div
      data-testid="unsupported-document"
      className="flex h-full min-h-0 items-center justify-center bg-surface-subtle px-6 text-center"
    >
      <section className="max-w-md rounded-panel border border-border bg-surface p-6 shadow-panel">
        <div className="text-size-title font-semibold text-heading">{formatName} is no longer supported</div>
        <p className="mt-2 text-size-subheading text-secondary">
          This document format is no longer supported.
        </p>
        <p className="mt-2 text-size-caption text-muted">
          {document?.title || 'This document'} remains in your Library. You can delete it there without changing the original file.
        </p>
        <Button
          variant="secondary"
          size="sm"
          data-testid="unsupported-document-back"
          className="mt-5"
          onClick={onBack}
        >
          Back to Library
        </Button>
      </section>
    </div>
  );
}
