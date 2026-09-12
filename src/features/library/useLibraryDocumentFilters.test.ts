import { describe, expect, it, vi } from 'vitest';
import type { Document } from '../../types';

vi.mock('react', () => ({
  useCallback: (callback: unknown) => callback,
  useMemo: (factory: () => unknown) => factory(),
}));

import { useLibraryDocumentFilters } from './useLibraryDocumentFilters';

const documents: Document[] = [
  { id: 'epub-1', title: 'Book', file_path: '/book.epub', file_type: 'epub', created_at: 1, updated_at: 2 },
  { id: 'markdown-1', title: 'Notes', file_path: '/notes.md', file_type: 'markdown', created_at: 1, updated_at: 1 },
  { id: 'legacy-pdf', title: 'Archive', file_path: '/archive.pdf', file_type: 'pdf', created_at: 1, updated_at: 0 },
];

describe('useLibraryDocumentFilters', () => {
  it('offers only EPUB and Markdown as importable type summaries while retaining legacy PDF records', () => {
    const result = useLibraryDocumentFilters({
      documents,
      typeFilter: 'all',
      sortBy: 'recent',
      searchText: '',
      categoryFilter: 'all',
      groupByCategory: false,
      selectedTagIds: [],
      tagMatchMode: 'any',
      documentTagMap: {},
      favoriteDocumentIds: {},
      documentInsights: {},
    });

    expect(result.typeSummaries.map((item) => item.key)).toEqual(['all', 'epub', 'markdown']);
    expect(result.displayedDocuments.map((item) => item.id)).toEqual(['epub-1', 'markdown-1', 'legacy-pdf']);
  });
});
