import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DocumentViewer } from './DocumentViewer';

const document = {
  id: 'legacy-pdf',
  title: 'Old paper',
  file_path: '/old.pdf',
  file_type: 'pdf' as const,
  created_at: 1,
  updated_at: 1,
};

describe('DocumentViewer', () => {
  it('shows a safe unsupported state for historical PDF records', () => {
    const markup = renderToStaticMarkup(
      <DocumentViewer documentType="pdf" document={document} onBack={vi.fn()}>
        <div data-testid="reader-content">reader</div>
      </DocumentViewer>
    );

    expect(markup).toContain('data-testid="unsupported-document"');
    expect(markup).toContain('This document format is no longer supported.');
    expect(markup).toContain('data-testid="unsupported-document-back"');
    expect(markup).not.toContain('data-testid="reader-content"');
  });

  it('passes EPUB and Markdown content to the normal reader path', () => {
    for (const documentType of ['epub', 'markdown']) {
      const markup = renderToStaticMarkup(
        <DocumentViewer documentType={documentType} document={null} onBack={vi.fn()}>
          <div data-testid="reader-content">reader</div>
        </DocumentViewer>
      );
      expect(markup).toContain('data-testid="reader-content"');
      expect(markup).not.toContain('data-testid="unsupported-document"');
    }
  });
});
