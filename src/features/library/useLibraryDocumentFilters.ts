import { useCallback, useMemo } from 'react';
import type { Document as ReaderDocument, DocumentTagAssignment } from '../../types';

type DocumentInsight = { category: string };
type TypeFilter = 'all' | 'epub' | 'markdown';
type SortBy = 'recent' | 'title' | 'type';

export const FAVORITES_CATEGORY = 'Favorites';
export const RECENTS_CATEGORY = 'Recents';

export const normalizeFileType = (fileType: string): 'epub' | 'pdf' | 'markdown' => {
  const normalized = fileType.trim().toLowerCase();
  if (normalized === 'md') return 'markdown';
  if (normalized === 'epub' || normalized === 'pdf' || normalized === 'markdown') return normalized;
  return 'markdown';
};

export function useLibraryDocumentFilters({
  documents,
  typeFilter,
  sortBy,
  searchText,
  categoryFilter,
  groupByCategory,
  selectedTagIds,
  tagMatchMode,
  documentTagMap,
  favoriteDocumentIds,
  documentInsights,
}: {
  documents: ReaderDocument[];
  typeFilter: TypeFilter;
  sortBy: SortBy;
  searchText: string;
  categoryFilter: string;
  groupByCategory: boolean;
  selectedTagIds: string[];
  tagMatchMode: 'any' | 'all';
  documentTagMap: Record<string, DocumentTagAssignment[]>;
  favoriteDocumentIds: Record<string, boolean>;
  documentInsights: Record<string, DocumentInsight>;
}) {
  const getDocumentCategory = useCallback(
    (docId: string) => favoriteDocumentIds[docId] ? FAVORITES_CATEGORY : documentInsights[docId]?.category || '其他',
    [documentInsights, favoriteDocumentIds],
  );

  const getDocumentCardCategory = useCallback(
    (docId: string) => categoryFilter === RECENTS_CATEGORY ? undefined : getDocumentCategory(docId),
    [categoryFilter, getDocumentCategory],
  );

  const shouldGroupDisplayedDocuments = groupByCategory && categoryFilter !== RECENTS_CATEGORY;

  const displayedDocuments = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    const filtered = documents.filter((doc) => {
      const docType = normalizeFileType(doc.file_type);
      if (typeFilter !== 'all' && docType !== typeFilter) return false;
      if (categoryFilter !== 'all' && categoryFilter !== RECENTS_CATEGORY && getDocumentCategory(doc.id) !== categoryFilter) return false;
      if (selectedTagIds.length > 0) {
        const docTagIds = new Set((documentTagMap[doc.id] || []).map((item) => item.tag_id));
        const matches = tagMatchMode === 'all'
          ? selectedTagIds.every((tagId) => docTagIds.has(tagId))
          : selectedTagIds.some((tagId) => docTagIds.has(tagId));
        if (!matches) return false;
      }
      if (!query) return true;
      const title = doc.title.toLowerCase();
      const author = (doc.author || '').toLowerCase();
      const filePath = doc.file_path.toLowerCase();
      return title.includes(query) || author.includes(query) || filePath.includes(query);
    });

    const sorted = [...filtered];
    if (categoryFilter === RECENTS_CATEGORY || sortBy === 'recent') sorted.sort((a, b) => b.updated_at - a.updated_at);
    else if (sortBy === 'title') sorted.sort((a, b) => a.title.localeCompare(b.title));
    else sorted.sort((a, b) => normalizeFileType(a.file_type).localeCompare(normalizeFileType(b.file_type)) || a.title.localeCompare(b.title));
    return sorted;
  }, [categoryFilter, documentTagMap, documents, getDocumentCategory, searchText, selectedTagIds, sortBy, tagMatchMode, typeFilter]);

  const categoryOptions = useMemo(() => {
    const categories = new Set<string>();
    documents.forEach((doc) => categories.add(getDocumentCategory(doc.id)));
    return Array.from(categories).sort((a, b) => a.localeCompare(b));
  }, [documents, getDocumentCategory]);

  const regularCategoryOptions = useMemo(
    () => categoryOptions.filter((category) => category !== FAVORITES_CATEGORY && category !== RECENTS_CATEGORY),
    [categoryOptions],
  );

  const groupedEntries = useMemo(() => {
    const grouped = displayedDocuments.reduce<Record<string, ReaderDocument[]>>((acc, doc) => {
      const category = getDocumentCategory(doc.id);
      (acc[category] ||= []).push(doc);
      return acc;
    }, {});
    return Object.entries(grouped).sort((a, b) => {
      if (a[0] === FAVORITES_CATEGORY && b[0] !== FAVORITES_CATEGORY) return -1;
      if (b[0] === FAVORITES_CATEGORY && a[0] !== FAVORITES_CATEGORY) return 1;
      return b[1].length - a[1].length || a[0].localeCompare(b[0]);
    });
  }, [displayedDocuments, getDocumentCategory]);

  const typeSummaries = useMemo(() => {
    const count = (type: ReturnType<typeof normalizeFileType>) => documents.filter((doc) => normalizeFileType(doc.file_type) === type).length;
    return [
      { key: 'all' as const, label: 'All', count: documents.length },
      { key: 'epub' as const, label: 'EPUB', count: count('epub') },
      { key: 'markdown' as const, label: 'Markdown', count: count('markdown') },
    ];
  }, [documents]);

  const favoriteCount = useMemo(
    () => documents.reduce((acc, doc) => acc + (favoriteDocumentIds[doc.id] ? 1 : 0), 0),
    [documents, favoriteDocumentIds],
  );

  return {
    getDocumentCategory,
    getDocumentCardCategory,
    shouldGroupDisplayedDocuments,
    displayedDocuments,
    categoryOptions,
    regularCategoryOptions,
    groupedEntries,
    typeSummaries,
    favoriteCount,
    quickCategories: regularCategoryOptions.slice(0, 10),
  };
}
