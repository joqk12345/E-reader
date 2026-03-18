import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../store/useStore';
import { DocumentCard } from './DocumentCard';
import { ConfirmDialog } from './ConfirmDialog';
import { TagNameDialog } from './TagNameDialog';
import type {
  BatchTagReviewItem,
  Document as ReaderDocument,
  DocumentTagAssignment,
  TagFacet,
  TagRecord,
} from '../types';
import {
  applyDocumentTags,
  cleanupUnusedTags,
  listBatchTagReviewItems,
  listDocumentTags,
  listTagFacets,
  listTagLibrary,
  mergeTags,
  promoteTemporaryTag,
  removeDocumentTag,
  removeTagAlias,
  renameTag,
  reviewTagSuggestions,
  suggestTagsForDocuments,
  addTagAlias,
} from '../services/tagService';

type LibraryProps = {
  statusBar?: React.ReactNode;
};

type DocumentPreview = {
  doc_id: string;
  preview: string;
};

type DocumentInsight = {
  category: string;
};

const FAVORITES_CATEGORY = 'Favorites';
const RECENTS_CATEGORY = 'Recents';
const FAVORITES_STORAGE_KEY = 'reader.favoriteDocumentIds';

const normalizeFileType = (fileType: string): 'epub' | 'pdf' | 'markdown' => {
  const normalized = fileType.trim().toLowerCase();
  if (normalized === 'md') return 'markdown';
  if (normalized === 'epub' || normalized === 'pdf' || normalized === 'markdown') {
    return normalized;
  }
  return 'markdown';
};

const CATEGORY_RULES: Array<{ name: string; keywords: string[] }> = [
  { name: 'AI/机器学习', keywords: ['ai', 'llm', 'ml', 'machine learning', '模型', '推理', 'agent', 'rag', 'vllm'] },
  { name: '编程/工程', keywords: ['rust', 'python', 'javascript', 'typescript', 'react', 'tauri', '架构', '代码', '开发'] },
  { name: '商业/产品', keywords: ['product', 'saas', 'startup', 'business', '用户', '增长', '运营', '商业'] },
  { name: '金融/经济', keywords: ['finance', 'economy', 'market', 'stock', 'investment', '金融', '经济', '投资'] },
  { name: '科学/研究', keywords: ['paper', 'research', 'benchmark', 'physics', 'biology', '实验', '论文', '研究'] },
  { name: '教育/教程', keywords: ['tutorial', 'guide', 'course', 'lesson', 'learn', '教学', '教程', '入门'] },
  { name: '新闻/时事', keywords: ['news', 'breaking', 'today', '日报', '新闻', '快讯', '发布'] },
  { name: '文学/社科', keywords: ['novel', 'story', 'history', 'philosophy', '社会', '历史', '小说', '随笔'] },
];

const inferDocumentInsight = (doc: ReaderDocument, preview: string): DocumentInsight => {
  const corpus = `${doc.title} ${doc.author || ''} ${preview}`.toLowerCase();

  let bestCategory = '其他';
  let bestScore = 0;
  for (const rule of CATEGORY_RULES) {
    const score = rule.keywords.reduce((acc, keyword) => (corpus.includes(keyword) ? acc + 1 : acc), 0);
    if (score > bestScore) {
      bestScore = score;
      bestCategory = rule.name;
    }
  }

  return {
    category: bestCategory,
  };
};

const findTagByNameOrAlias = (tags: TagRecord[], raw: string) => {
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return null;
  return (
    tags.find(
      (tag) =>
        tag.name.trim().toLowerCase() === normalized ||
        tag.aliases.some((alias) => alias.alias.trim().toLowerCase() === normalized)
    ) || null
  );
};

export const Library: React.FC<LibraryProps> = ({ statusBar }) => {
  const DEFAULT_CATEGORY_VISIBLE_COUNT = 8;
  const DEFAULT_EXPANDED_CATEGORY_COUNT = 2;
  const { documents, loadDocuments, importEpub, importPdf, importMarkdown, deleteDocument, selectDocument } = useStore();
  const [viewMode, setViewMode] = useState<'grid' | 'list' | 'compact'>('grid');
  const [typeFilter, setTypeFilter] = useState<'all' | 'epub' | 'pdf' | 'markdown'>('all');
  const [sortBy, setSortBy] = useState<'recent' | 'title' | 'type'>('recent');
  const [searchText, setSearchText] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [groupByCategory, setGroupByCategory] = useState(true);
  const [isImportingFile, setIsImportingFile] = useState(false);
  const [isImportingUrl, setIsImportingUrl] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importUrlDraft, setImportUrlDraft] = useState('');
  const [showDisplayMenu, setShowDisplayMenu] = useState(false);
  const [isAutoClassifying, setIsAutoClassifying] = useState(false);
  const [documentInsights, setDocumentInsights] = useState<Record<string, DocumentInsight>>({});
  const [favoriteDocumentIds, setFavoriteDocumentIds] = useState<Record<string, boolean>>({});
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});
  const [expandedCategoryItems, setExpandedCategoryItems] = useState<Record<string, boolean>>({});
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(248);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [allDocumentTags, setAllDocumentTags] = useState<DocumentTagAssignment[]>([]);
  const [tagFacets, setTagFacets] = useState<TagFacet[]>([]);
  const [tagLibrary, setTagLibrary] = useState<TagRecord[]>([]);
  const [pendingReviewItems, setPendingReviewItems] = useState<BatchTagReviewItem[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [tagMatchMode, setTagMatchMode] = useState<'any' | 'all'>('any');
  const [tagSearchText, setTagSearchText] = useState('');
  const [showBatchDialog, setShowBatchDialog] = useState(false);
  const [showTagManager, setShowTagManager] = useState(false);
  const [batchMode, setBatchMode] = useState<'apply-existing' | 'ai-recommend'>('ai-recommend');
  const [batchStartDate, setBatchStartDate] = useState('');
  const [batchEndDate, setBatchEndDate] = useState('');
  const [batchUseCurrentResults, setBatchUseCurrentResults] = useState(true);
  const [batchDocumentSearch, setBatchDocumentSearch] = useState('');
  const [batchDocFilterTagIds, setBatchDocFilterTagIds] = useState<string[]>([]);
  const [batchDocFilterTagMode, setBatchDocFilterTagMode] = useState<'any' | 'all'>('any');
  const [batchDocFilterTagSearch, setBatchDocFilterTagSearch] = useState('');
  const [batchSelectedTagIds, setBatchSelectedTagIds] = useState<string[]>([]);
  const [batchTagSearch, setBatchTagSearch] = useState('');
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [tagManagerSearch, setTagManagerSearch] = useState('');
  const [tagManagerTemporaryOnly, setTagManagerTemporaryOnly] = useState(false);
  const [tagManagerUnusedOnly, setTagManagerUnusedOnly] = useState(false);
  const [isTagDataLoading, setIsTagDataLoading] = useState(false);
  const [batchFeedback, setBatchFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [createTempDraft, setCreateTempDraft] = useState<{ suggestionIds: string[]; value: string } | null>(null);
  const [mapReviewDraft, setMapReviewDraft] = useState<{ suggestionIds: string[]; value: string } | null>(null);
  const [renameDraft, setRenameDraft] = useState<{ tagId: string; value: string } | null>(null);
  const [mergeDraft, setMergeDraft] = useState<{ sourceTagId: string; value: string } | null>(null);
  const [addAliasDraft, setAddAliasDraft] = useState<{ tagId: string; value: string } | null>(null);
  const [batchReplaceDraft, setBatchReplaceDraft] = useState<{ docId: string; oldTagId: string; oldTagName: string; value: string } | null>(null);
  const [batchPreviewActionKey, setBatchPreviewActionKey] = useState<string | null>(null);
  const [expandedReviewItems, setExpandedReviewItems] = useState<Record<string, boolean>>({});
  const [showCleanupUnusedConfirm, setShowCleanupUnusedConfirm] = useState(false);
  const [tagManagerFeedback, setTagManagerFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const displayMenuRef = useRef<HTMLDivElement | null>(null);

  const formatImportErrorMessage = (error: unknown) => {
    const raw = error instanceof Error ? error.message : String(error ?? '');
    const normalized = raw.toLowerCase();
    const isDuplicateFile =
      normalized.includes('unique constraint failed: documents.file_path') ||
      (normalized.includes('documents.file_path') && normalized.includes('unique'));

    if (isDuplicateFile) {
      return '该文件已导入到 Library，无需重复导入。';
    }
    return `导入失败：${raw}`;
  };


  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(FAVORITES_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, boolean>;
      if (parsed && typeof parsed === 'object') {
        setFavoriteDocumentIds(parsed);
      }
    } catch (error) {
      console.warn('Failed to load favorites from local storage:', error);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favoriteDocumentIds));
    } catch (error) {
      console.warn('Failed to save favorites to local storage:', error);
    }
  }, [favoriteDocumentIds]);

  useEffect(() => {
    if (documents.length === 0) return;

    setFavoriteDocumentIds((prev) => {
      const docIdSet = new Set(documents.map((doc) => doc.id));
      const next = Object.entries(prev).reduce<Record<string, boolean>>((acc, [docId, isFavorite]) => {
        if (isFavorite && docIdSet.has(docId)) {
          acc[docId] = true;
        }
        return acc;
      }, {});

      if (Object.keys(next).length === Object.keys(prev).length) {
        return prev;
      }
      return next;
    });
  }, [documents]);

  const refreshTagData = useCallback(async () => {
    setIsTagDataLoading(true);
    try {
      const [nextAssignments, nextFacets, nextLibrary, nextReviewItems] = await Promise.all([
        listDocumentTags(null),
        listTagFacets(),
        listTagLibrary(),
        listBatchTagReviewItems(),
      ]);
      setAllDocumentTags(nextAssignments);
      setTagFacets(nextFacets);
      setTagLibrary(nextLibrary);
      setPendingReviewItems(nextReviewItems);
    } catch (error) {
      console.error('Failed to refresh tag data:', error);
    } finally {
      setIsTagDataLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshTagData();
  }, [refreshTagData, documents]);

  useEffect(() => {
    const valid = new Set(tagFacets.map((item) => item.tag_id));
    setSelectedTagIds((prev) => prev.filter((tagId) => valid.has(tagId)));
    setBatchDocFilterTagIds((prev) => prev.filter((tagId) => valid.has(tagId)));
    setBatchSelectedTagIds((prev) => prev.filter((tagId) => tagLibrary.some((tag) => tag.id === tagId)));
  }, [tagFacets, tagLibrary]);

  const getDocumentCategory = (docId: string) => {
    if (favoriteDocumentIds[docId]) {
      return FAVORITES_CATEGORY;
    }
    return documentInsights[docId]?.category || '其他';
  };

  const getDocumentCardCategory = (docId: string) => {
    if (categoryFilter === RECENTS_CATEGORY) {
      return undefined;
    }
    return getDocumentCategory(docId);
  };

  const isFavoriteDocument = (docId: string) => Boolean(favoriteDocumentIds[docId]);

  const toggleFavoriteDocument = (docId: string) => {
    setFavoriteDocumentIds((prev) => {
      const next = { ...prev };
      if (next[docId]) {
        delete next[docId];
      } else {
        next[docId] = true;
      }
      return next;
    });
  };

  const runAutoClassification = useCallback(async (targetDocs: ReaderDocument[]) => {
    if (targetDocs.length === 0) {
      setDocumentInsights({});
      return;
    }

    setIsAutoClassifying(true);
    try {
      const rows = await invoke<DocumentPreview[]>('get_document_previews', {
        docIds: targetDocs.map((doc) => doc.id),
        maxChars: 1200,
      });
      const previewMap = rows.reduce<Record<string, string>>((acc, item) => {
        acc[item.doc_id] = item.preview || '';
        return acc;
      }, {});
      const next = targetDocs.reduce<Record<string, DocumentInsight>>((acc, doc) => {
        acc[doc.id] = inferDocumentInsight(doc, previewMap[doc.id] || '');
        return acc;
      }, {});
      setDocumentInsights(next);
    } catch (error) {
      console.warn('Auto classify fallback to title-only mode:', error);
      const next = targetDocs.reduce<Record<string, DocumentInsight>>((acc, doc) => {
        acc[doc.id] = inferDocumentInsight(doc, '');
        return acc;
      }, {});
      setDocumentInsights(next);
    } finally {
      setIsAutoClassifying(false);
    }
  }, []);

  useEffect(() => {
    if (documents.length === 0) {
      setDocumentInsights({});
      return;
    }

    let cancelled = false;
    void runAutoClassification(documents).catch(() => {
      if (cancelled) return;
    });

    return () => {
      cancelled = true;
    };
  }, [documents, runAutoClassification]);

  const handleImportFile = async () => {
    setIsImportingFile(true);
    let importedSuccessfully = false;
    try {
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: 'Documents',
            extensions: ['epub', 'pdf', 'md']
          }
        ]
      });

      if (selected && typeof selected === 'string') {
        const ext = selected.split('.').pop()?.toLowerCase();
        if (ext === 'epub') {
          await importEpub(selected);
          importedSuccessfully = true;
        } else if (ext === 'pdf') {
          const docId = await importPdf(selected);
          selectDocument(docId);
          importedSuccessfully = true;
        } else if (ext === 'md') {
          await importMarkdown(selected);
          importedSuccessfully = true;
        }
      }
    } catch (error) {
      console.error('Import failed:', error);
      alert(formatImportErrorMessage(error));
    } finally {
      setIsImportingFile(false);
      if (importedSuccessfully) {
        setShowImportDialog(false);
      }
    }
  };

  const normalizeUrl = (input: string) => {
    const trimmed = input.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
    return `https://${trimmed}`;
  };

  const handleImportUrlBeta = async () => {
    const url = normalizeUrl(importUrlDraft);
    if (!url) return;
    setIsImportingUrl(true);
    let importedSuccessfully = false;
    try {
      const docId = await invoke<string>('import_url', { url });
      await loadDocuments();
      selectDocument(docId);
      importedSuccessfully = true;
    } catch (error) {
      console.error('Import URL failed:', error);
      alert(formatImportErrorMessage(error));
    } finally {
      setIsImportingUrl(false);
      if (importedSuccessfully) {
        setImportUrlDraft('');
        setShowImportDialog(false);
      }
    }
  };

  const handleDeleteRequest = (id: string, title: string) => {
    setPendingDelete({ id, title });
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deleteDocument(pendingDelete.id);
      setPendingDelete(null);
      await refreshTagData();
    } catch (error) {
      console.error('Delete failed:', error);
      alert('Failed to delete document');
    }
  };

  const handleUnifiedImport = () => {
    setShowImportDialog(true);
  };

  const documentTagMap = useMemo(() => {
    return allDocumentTags.reduce<Record<string, DocumentTagAssignment[]>>((acc, item) => {
      if (!acc[item.doc_id]) {
        acc[item.doc_id] = [];
      }
      acc[item.doc_id].push(item);
      return acc;
    }, {});
  }, [allDocumentTags]);

  const filteredTagFacets = useMemo(() => {
    const query = tagSearchText.trim().toLowerCase();
    return tagFacets.filter((facet) => !query || facet.name.toLowerCase().includes(query));
  }, [tagFacets, tagSearchText]);

  const shouldGroupDisplayedDocuments = groupByCategory && categoryFilter !== RECENTS_CATEGORY;

  const displayedDocuments = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    const filtered = documents.filter((doc) => {
      const docType = normalizeFileType(doc.file_type);
      if (typeFilter !== 'all' && docType !== typeFilter) return false;
      if (
        categoryFilter !== 'all' &&
        categoryFilter !== RECENTS_CATEGORY &&
        getDocumentCategory(doc.id) !== categoryFilter
      ) {
        return false;
      }
      if (selectedTagIds.length > 0) {
        const docTagIds = new Set((documentTagMap[doc.id] || []).map((item) => item.tag_id));
        const matches =
          tagMatchMode === 'all'
            ? selectedTagIds.every((tagId) => docTagIds.has(tagId))
            : selectedTagIds.some((tagId) => docTagIds.has(tagId));
        if (!matches) return false;
      }
      if (!q) return true;
      const title = doc.title.toLowerCase();
      const author = (doc.author || '').toLowerCase();
      const filePath = doc.file_path.toLowerCase();
      return title.includes(q) || author.includes(q) || filePath.includes(q);
    });

    const sorted = [...filtered];
    if (categoryFilter === RECENTS_CATEGORY || sortBy === 'recent') {
      sorted.sort((a, b) => b.updated_at - a.updated_at);
    } else if (sortBy === 'title') {
      sorted.sort((a, b) => a.title.localeCompare(b.title));
    } else {
      sorted.sort((a, b) => normalizeFileType(a.file_type).localeCompare(normalizeFileType(b.file_type)) || a.title.localeCompare(b.title));
    }
    return sorted;
  }, [categoryFilter, documents, documentTagMap, favoriteDocumentIds, searchText, selectedTagIds, sortBy, tagMatchMode, typeFilter, documentInsights]);

  const categoryOptions = useMemo(() => {
    const categories = new Set<string>();
    documents.forEach((doc) => categories.add(getDocumentCategory(doc.id)));
    return Array.from(categories).sort((a, b) => a.localeCompare(b));
  }, [documents, favoriteDocumentIds, documentInsights]);

  const regularCategoryOptions = useMemo(
    () => categoryOptions.filter((category) => category !== FAVORITES_CATEGORY && category !== RECENTS_CATEGORY),
    [categoryOptions]
  );

  const groupedEntries = useMemo(() => {
    const grouped = displayedDocuments.reduce<Record<string, ReaderDocument[]>>((acc, doc) => {
      const category = getDocumentCategory(doc.id);
      if (!acc[category]) acc[category] = [];
      acc[category].push(doc);
      return acc;
    }, {});

    return Object.entries(grouped).sort((a, b) => {
      if (a[0] === FAVORITES_CATEGORY && b[0] !== FAVORITES_CATEGORY) return -1;
      if (b[0] === FAVORITES_CATEGORY && a[0] !== FAVORITES_CATEGORY) return 1;
      return b[1].length - a[1].length || a[0].localeCompare(b[0]);
    });
  }, [displayedDocuments, favoriteDocumentIds, documentInsights]);

  const typeSummaries = useMemo(() => {
    const markdownCount = documents.filter((doc) => normalizeFileType(doc.file_type) === 'markdown').length;
    const pdfCount = documents.filter((doc) => normalizeFileType(doc.file_type) === 'pdf').length;
    const epubCount = documents.filter((doc) => normalizeFileType(doc.file_type) === 'epub').length;
    return [
      { key: 'all' as const, label: 'All', count: documents.length },
      { key: 'epub' as const, label: 'EPUB', count: epubCount },
      { key: 'pdf' as const, label: 'PDF', count: pdfCount },
      { key: 'markdown' as const, label: 'Markdown', count: markdownCount },
    ];
  }, [documents]);

  const favoriteCount = useMemo(
    () => documents.reduce((acc, doc) => (isFavoriteDocument(doc.id) ? acc + 1 : acc), 0),
    [documents, favoriteDocumentIds]
  );

  const quickCategories = useMemo(() => regularCategoryOptions.slice(0, 10), [regularCategoryOptions]);

  const toggleCategoryCollapsed = (category: string) => {
    setCollapsedCategories((prev) => ({ ...prev, [category]: !(prev[category] ?? false) }));
  };

  const toggleCategoryExpandedItems = (category: string) => {
    setExpandedCategoryItems((prev) => ({ ...prev, [category]: !(prev[category] ?? false) }));
  };

  const toggleSelectedTagId = (tagId: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((item) => item !== tagId) : [...prev, tagId]
    );
  };

  const toggleBatchSelectedTagId = (tagId: string) => {
    setBatchSelectedTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((item) => item !== tagId) : [...prev, tagId]
    );
  };

  const toggleBatchDocFilterTagId = (tagId: string) => {
    setBatchDocFilterTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((item) => item !== tagId) : [...prev, tagId]
    );
  };

  const selectedBatchDocs = useMemo(() => {
    const baseDocs = batchUseCurrentResults ? displayedDocuments : documents;
    const startTs = batchStartDate ? new Date(`${batchStartDate}T00:00:00`).getTime() / 1000 : null;
    const endTs = batchEndDate ? new Date(`${batchEndDate}T23:59:59`).getTime() / 1000 : null;
    const query = batchDocumentSearch.trim().toLowerCase();
    return baseDocs.filter((doc) => {
      if (startTs && doc.created_at < startTs) return false;
      if (endTs && doc.created_at > endTs) return false;
      if (!query) return true;
      const title = doc.title.toLowerCase();
      const author = (doc.author || '').toLowerCase();
      const filePath = doc.file_path.toLowerCase();
      return title.includes(query) || author.includes(query) || filePath.includes(query);
    });
  }, [batchDocumentSearch, batchEndDate, batchStartDate, batchUseCurrentResults, displayedDocuments, documents]);

  const filteredBatchTags = useMemo(() => {
    const query = batchTagSearch.trim().toLowerCase();
    return tagLibrary.filter(
      (tag) =>
        !query ||
        tag.name.toLowerCase().includes(query) ||
        tag.aliases.some((alias) => alias.alias.toLowerCase().includes(query))
    );
  }, [batchTagSearch, tagLibrary]);

  const filteredBatchDocFilterTags = useMemo(() => {
    const query = batchDocFilterTagSearch.trim().toLowerCase();
    return tagLibrary.filter(
      (tag) =>
        !query ||
        tag.name.toLowerCase().includes(query) ||
        tag.aliases.some((alias) => alias.alias.toLowerCase().includes(query))
    );
  }, [batchDocFilterTagSearch, tagLibrary]);

  const selectedBatchApplyDocs = useMemo(() => {
    if (batchDocFilterTagIds.length === 0) return selectedBatchDocs;
    return selectedBatchDocs.filter((doc) => {
      const docTagIds = new Set((documentTagMap[doc.id] || []).map((item) => item.tag_id));
      return batchDocFilterTagMode === 'all'
        ? batchDocFilterTagIds.every((tagId) => docTagIds.has(tagId))
        : batchDocFilterTagIds.some((tagId) => docTagIds.has(tagId));
    });
  }, [batchDocFilterTagIds, batchDocFilterTagMode, documentTagMap, selectedBatchDocs]);

  const effectiveBatchDocs = batchMode === 'apply-existing' ? selectedBatchApplyDocs : selectedBatchDocs;

  const filteredTagLibrary = useMemo(() => {
    const query = tagManagerSearch.trim().toLowerCase();
    return tagLibrary.filter((tag) => {
      if (tagManagerTemporaryOnly && !tag.is_temporary) return false;
      if (tagManagerUnusedOnly && tag.usage_count > 0) return false;
      if (!query) return true;
      return (
        tag.name.toLowerCase().includes(query) ||
        tag.aliases.some((alias) => alias.alias.toLowerCase().includes(query))
      );
    });
  }, [tagLibrary, tagManagerSearch, tagManagerTemporaryOnly, tagManagerUnusedOnly]);

  const handleBatchApplyExisting = async () => {
    if (effectiveBatchDocs.length === 0 || batchSelectedTagIds.length === 0) return;
    setIsBatchRunning(true);
    setBatchFeedback(null);
    try {
      await applyDocumentTags({
        doc_ids: effectiveBatchDocs.map((doc) => doc.id),
        tag_ids: batchSelectedTagIds,
        source: 'manual',
      });
      setIsBatchRunning(false);
      await refreshTagData();
      setBatchFeedback({
        tone: 'success',
        message: `Applied tags to ${effectiveBatchDocs.length} documents.`,
      });
    } catch (error) {
      console.error('Failed to batch apply tags:', error);
      setBatchFeedback({
        tone: 'error',
        message: `Failed to apply tags in batch: ${String(error)}`,
      });
    } finally {
      setIsBatchRunning(false);
    }
  };

  const handleBatchSuggest = async () => {
    if (selectedBatchDocs.length === 0) return;
    setIsBatchRunning(true);
    setBatchFeedback(null);
    try {
      const result = await suggestTagsForDocuments({
        doc_ids: selectedBatchDocs.map((doc) => doc.id),
        refresh: true,
      });
      setIsBatchRunning(false);
      await refreshTagData();
      setBatchFeedback({
        tone: 'success',
        message: `Processed ${result.processed_docs} documents and created ${result.created_suggestions} suggestions. ${result.matched_pending} matched existing tags, ${result.new_candidate_pending} remain new candidates.`,
      });
    } catch (error) {
      console.error('Failed to batch suggest tags:', error);
      setBatchFeedback({
        tone: 'error',
        message: `Failed to run batch AI suggestions: ${String(error)}`,
      });
    } finally {
      setIsBatchRunning(false);
    }
  };

  const handleBatchPreviewRemoveTag = async (docId: string, tagId: string, tagName: string) => {
    const actionKey = `remove:${docId}:${tagId}`;
    setBatchPreviewActionKey(actionKey);
    setBatchFeedback(null);
    try {
      await removeDocumentTag(docId, tagId);
      await refreshTagData();
      setBatchFeedback({
        tone: 'success',
        message: `Removed #${tagName} from the selected document.`,
      });
    } catch (error) {
      console.error('Failed to remove batch preview tag:', error);
      setBatchFeedback({
        tone: 'error',
        message: `Failed to remove #${tagName}: ${String(error)}`,
      });
    } finally {
      setBatchPreviewActionKey(null);
    }
  };

  const handleConfirmBatchReplaceTag = async () => {
    if (!batchReplaceDraft || !batchReplaceDraft.value.trim()) return;
    const nextName = batchReplaceDraft.value.trim();
    if (nextName.toLowerCase() === batchReplaceDraft.oldTagName.trim().toLowerCase()) {
      setBatchReplaceDraft(null);
      return;
    }
    const actionKey = `replace:${batchReplaceDraft.docId}:${batchReplaceDraft.oldTagId}`;
    setBatchPreviewActionKey(actionKey);
    setBatchFeedback(null);
    try {
      await applyDocumentTags({
        doc_ids: [batchReplaceDraft.docId],
        tag_names: [nextName],
        source: 'manual',
        create_as_temporary: false,
      });
      await removeDocumentTag(batchReplaceDraft.docId, batchReplaceDraft.oldTagId);
      await refreshTagData();
      setBatchFeedback({
        tone: 'success',
        message: `Replaced #${batchReplaceDraft.oldTagName} with #${nextName}.`,
      });
      setBatchReplaceDraft(null);
    } catch (error) {
      console.error('Failed to replace batch preview tag:', error);
      setBatchFeedback({
        tone: 'error',
        message: `Failed to replace #${batchReplaceDraft.oldTagName}: ${String(error)}`,
      });
    } finally {
      setBatchPreviewActionKey(null);
    }
  };

  const handleReviewMatchedItem = async (item: BatchTagReviewItem) => {
    try {
      await reviewTagSuggestions({
        actions: [{ suggestion_ids: item.suggestion_ids, action: 'accept' }],
      });
      await refreshTagData();
    } catch (error) {
      console.error('Failed to accept matched review item:', error);
      alert(`Failed to accept suggestion: ${String(error)}`);
    }
  };

  const handleRejectReviewItem = async (item: BatchTagReviewItem) => {
    try {
      await reviewTagSuggestions({
        actions: [{ suggestion_ids: item.suggestion_ids, action: 'reject' }],
      });
      await refreshTagData();
    } catch (error) {
      console.error('Failed to reject review item:', error);
      alert(`Failed to reject suggestion: ${String(error)}`);
    }
  };

  const handleCreateReviewTag = (item: BatchTagReviewItem) => {
    setCreateTempDraft({
      suggestionIds: item.suggestion_ids,
      value: item.proposed_name,
    });
  };

  const handleConfirmCreateReviewTag = async () => {
    if (!createTempDraft) return;
    try {
      await reviewTagSuggestions({
        actions: [
          {
            suggestion_ids: createTempDraft.suggestionIds,
            action: 'create_tag',
            new_tag_name: createTempDraft.value.trim(),
          },
        ],
      });
      setCreateTempDraft(null);
      await refreshTagData();
    } catch (error) {
      console.error('Failed to create review tag:', error);
      alert(`Failed to create tag: ${String(error)}`);
    }
  };

  const handleMapReviewItem = (item: BatchTagReviewItem) => {
    setMapReviewDraft({
      suggestionIds: item.suggestion_ids,
      value: item.proposed_name,
    });
  };

  const handleConfirmMapReviewItem = async () => {
    if (!mapReviewDraft) return;
    const matched = findTagByNameOrAlias(tagLibrary, mapReviewDraft.value);
    if (!matched) {
      alert('No matching existing tag or alias was found.');
      return;
    }
    try {
      await reviewTagSuggestions({
        actions: [
          {
            suggestion_ids: mapReviewDraft.suggestionIds,
            action: 'map_to_existing_tag',
            tag_id: matched.id,
          },
        ],
      });
      setMapReviewDraft(null);
      await refreshTagData();
    } catch (error) {
      console.error('Failed to map review item:', error);
      alert(`Failed to map suggestion: ${String(error)}`);
    }
  };

  const handleRenameTag = (tag: TagRecord) => {
    setRenameDraft({ tagId: tag.id, value: tag.name });
  };

  const handleConfirmRenameTag = async () => {
    if (!renameDraft) return;
    const nextName = renameDraft.value.trim();
    if (!nextName) return;
    try {
      await renameTag({ tag_id: renameDraft.tagId, new_name: nextName });
      setRenameDraft(null);
      await refreshTagData();
    } catch (error) {
      console.error('Failed to rename tag:', error);
      alert(`Failed to rename tag: ${String(error)}`);
    }
  };

  const handleMergeTag = (tag: TagRecord) => {
    setMergeDraft({ sourceTagId: tag.id, value: '' });
  };

  const handleConfirmMergeTag = async () => {
    if (!mergeDraft) return;
    const target = findTagByNameOrAlias(tagLibrary, mergeDraft.value);
    if (!target || target.id === mergeDraft.sourceTagId) {
      alert('No valid target tag was found.');
      return;
    }
    try {
      await mergeTags({ source_tag_id: mergeDraft.sourceTagId, target_tag_id: target.id });
      setMergeDraft(null);
      await refreshTagData();
    } catch (error) {
      console.error('Failed to merge tags:', error);
      alert(`Failed to merge tags: ${String(error)}`);
    }
  };

  const handleAddAlias = (tag: TagRecord) => {
    setAddAliasDraft({ tagId: tag.id, value: '' });
  };

  const handleConfirmAddAlias = async () => {
    if (!addAliasDraft) return;
    const alias = addAliasDraft.value.trim();
    if (!alias) return;
    try {
      await addTagAlias({ tag_id: addAliasDraft.tagId, alias });
      setAddAliasDraft(null);
      await refreshTagData();
    } catch (error) {
      console.error('Failed to add tag alias:', error);
      alert(`Failed to add alias: ${String(error)}`);
    }
  };

  const handleRemoveAlias = async (aliasId: string) => {
    try {
      await removeTagAlias({ alias_id: aliasId });
      await refreshTagData();
    } catch (error) {
      console.error('Failed to remove tag alias:', error);
      alert(`Failed to remove alias: ${String(error)}`);
    }
  };

  const handlePromoteTemporary = async (tag: TagRecord) => {
    try {
      await promoteTemporaryTag({ tag_id: tag.id });
      await refreshTagData();
    } catch (error) {
      console.error('Failed to promote temporary tag:', error);
      alert(`Failed to promote temporary tag: ${String(error)}`);
    }
  };

  const handleCleanupUnused = async () => {
    setTagManagerFeedback(null);
    try {
      const result = await cleanupUnusedTags();
      await refreshTagData();
      setShowCleanupUnusedConfirm(false);
      setTagManagerFeedback({
        tone: 'success',
        message: `Deleted ${result.deleted} unused tags.`,
      });
    } catch (error) {
      console.error('Failed to cleanup unused tags:', error);
      setTagManagerFeedback({
        tone: 'error',
        message: `Failed to clean up unused tags: ${String(error)}`,
      });
    }
  };

  useEffect(() => {
    if (!showDisplayMenu) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (!displayMenuRef.current?.contains(target)) {
        setShowDisplayMenu(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [showDisplayMenu]);

  useEffect(() => {
    if (!isResizingSidebar) return;

    const onPointerMove = (event: PointerEvent) => {
      const next = Math.min(360, Math.max(210, event.clientX));
      setSidebarWidth(next);
    };
    const onPointerUp = () => setIsResizingSidebar(false);

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [isResizingSidebar]);

  return (
    <>
      <TagNameDialog
        open={Boolean(createTempDraft)}
        title="Create Temporary Tag"
        description="Edit the suggested name before creating the temporary tag."
        value={createTempDraft?.value || ''}
        confirmLabel="Create Temp"
        onChange={(value) =>
          setCreateTempDraft((prev) => (prev ? { ...prev, value } : prev))
        }
        onClose={() => setCreateTempDraft(null)}
        onConfirm={() => void handleConfirmCreateReviewTag()}
      />
      <TagNameDialog
        open={Boolean(mapReviewDraft)}
        title="Map To Existing Tag"
        description="Enter an existing tag name or alias. This will attach the pending suggestion to that existing tag."
        value={mapReviewDraft?.value || ''}
        confirmLabel="Map"
        onChange={(value) =>
          setMapReviewDraft((prev) => (prev ? { ...prev, value } : prev))
        }
        onClose={() => setMapReviewDraft(null)}
        onConfirm={() => void handleConfirmMapReviewItem()}
      />
      <TagNameDialog
        open={Boolean(renameDraft)}
        title="Rename Tag"
        description="Change the canonical tag name. If the old name does not conflict, it will be kept as an alias."
        value={renameDraft?.value || ''}
        confirmLabel="Rename"
        onChange={(value) => setRenameDraft((prev) => (prev ? { ...prev, value } : prev))}
        onClose={() => setRenameDraft(null)}
        onConfirm={() => void handleConfirmRenameTag()}
      />
      <TagNameDialog
        open={Boolean(mergeDraft)}
        title="Merge Tag"
        description="Enter the existing tag name or alias to merge into. The current tag will be folded into that target."
        value={mergeDraft?.value || ''}
        confirmLabel="Merge"
        onChange={(value) => setMergeDraft((prev) => (prev ? { ...prev, value } : prev))}
        onClose={() => setMergeDraft(null)}
        onConfirm={() => void handleConfirmMergeTag()}
      />
      <TagNameDialog
        open={Boolean(addAliasDraft)}
        title="Add Alias"
        description="Add an alternate name for this tag. Aliases are global and must be unique."
        value={addAliasDraft?.value || ''}
        confirmLabel="Add Alias"
        onChange={(value) => setAddAliasDraft((prev) => (prev ? { ...prev, value } : prev))}
        onClose={() => setAddAliasDraft(null)}
        onConfirm={() => void handleConfirmAddAlias()}
      />
      <TagNameDialog
        open={Boolean(batchReplaceDraft)}
        title="Replace Tag"
        description="Change this document tag to another existing tag or a new tag name."
        value={batchReplaceDraft?.value || ''}
        confirmLabel="Replace"
        onChange={(value) => setBatchReplaceDraft((prev) => (prev ? { ...prev, value } : prev))}
        onClose={() => setBatchReplaceDraft(null)}
        onConfirm={() => void handleConfirmBatchReplaceTag()}
      />
      <ConfirmDialog
        open={showCleanupUnusedConfirm}
        title="Cleanup unused tags?"
        description="Delete all unused tags that have no pending suggestions."
        confirmLabel="Delete"
        tone="danger"
        onClose={() => setShowCleanupUnusedConfirm(false)}
        onConfirm={() => void handleCleanupUnused()}
      />

      {pendingDelete && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-40 flex items-center justify-center">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4 p-5">
            <h3 className="text-lg font-semibold text-gray-900">Confirm Delete</h3>
            <p className="mt-2 text-sm text-gray-600">
              Delete document <span className="font-medium text-gray-900">{pendingDelete.title}</span>?
              This action cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setPendingDelete(null)}
                className="px-3 py-2 text-sm text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleConfirmDelete()}
                className="px-3 py-2 text-sm text-white bg-red-600 rounded-md hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {showImportDialog && (
        <div className="fixed inset-0 z-40 bg-black/35 flex items-center justify-center">
          <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-4 shadow-xl">
            <h3 className="text-base font-semibold text-gray-900">Import</h3>
            <p className="mt-1 text-xs text-gray-500">Choose a local EPUB, PDF, or Markdown file.</p>

            <div className="mt-3 space-y-2">
              <button
                type="button"
                onClick={() => void handleImportFile()}
                disabled={isImportingFile || isImportingUrl}
                className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-blue-600 px-3 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:bg-gray-400"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 3h7l5 5v13H7z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14 3v5h5" />
                </svg>
                {isImportingFile ? 'Importing File...' : 'Import File'}
              </button>

              <div className="rounded-md border border-amber-200 bg-amber-50/60 p-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-amber-700">Import from URL</span>
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">Beta</span>
                </div>
                <input
                  value={importUrlDraft}
                  onChange={(e) => setImportUrlDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleImportUrlBeta();
                    }
                  }}
                  placeholder="https://example.com/article"
                  className="w-full rounded border border-amber-200 bg-white px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
                <button
                  type="button"
                  onClick={() => void handleImportUrlBeta()}
                  disabled={!importUrlDraft.trim() || isImportingUrl || isImportingFile}
                  className="mt-2 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-amber-600 px-3 text-xs font-medium text-white transition-colors hover:bg-amber-700 disabled:bg-gray-400"
                >
                  {isImportingUrl ? 'Importing URL...' : 'Import URL (Beta)'}
                </button>
              </div>
            </div>

            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  if (isImportingFile || isImportingUrl) return;
                  setImportUrlDraft('');
                  setShowImportDialog(false);
                }}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showBatchDialog && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/35 p-4">
          <div className="max-h-[88vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-gray-200 bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Batch Tags</h3>
                <p className="text-sm text-gray-500">Filter by imported time (`created_at`) and apply or review tag operations.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowBatchDialog(false)}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
              >
                Close
              </button>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setBatchMode('ai-recommend')}
                className={`rounded-md px-3 py-2 text-sm font-medium ${
                  batchMode === 'ai-recommend' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Run AI Suggestions
              </button>
              <button
                type="button"
                onClick={() => setBatchMode('apply-existing')}
                className={`rounded-md px-3 py-2 text-sm font-medium ${
                  batchMode === 'apply-existing' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Apply Existing Tags
              </button>
            </div>

            {batchFeedback && (
              <div
                className={`mt-4 rounded-lg border px-3 py-2 text-sm ${
                  batchFeedback.tone === 'success'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border-red-200 bg-red-50 text-red-700'
                }`}
              >
                {batchFeedback.message}
              </div>
            )}

            <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
              <label className="inline-flex items-start gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={batchUseCurrentResults}
                  onChange={(event) => setBatchUseCurrentResults(event.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium text-gray-900">Use current library results</span>
                  <span className="mt-1 block text-xs text-gray-500">
                    Reuse the current Library search, type, category, and tag filters before applying the date range.
                  </span>
                </span>
              </label>
            </div>

            <div className="mt-4">
              <label className="text-sm text-gray-700">
                <div className="mb-1 font-medium">Document Search</div>
                <input
                  value={batchDocumentSearch}
                  onChange={(event) => setBatchDocumentSearch(event.target.value)}
                  placeholder="Filter matched documents by title, author, or path..."
                  className="h-9 w-full rounded-md border border-gray-300 px-3"
                />
              </label>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
              <label className="text-sm text-gray-700">
                <div className="mb-1 font-medium">Start Date</div>
                <input
                  type="date"
                  value={batchStartDate}
                  onChange={(event) => setBatchStartDate(event.target.value)}
                  className="h-9 w-full rounded-md border border-gray-300 px-3"
                />
              </label>
              <label className="text-sm text-gray-700">
                <div className="mb-1 font-medium">End Date</div>
                <input
                  type="date"
                  value={batchEndDate}
                  onChange={(event) => setBatchEndDate(event.target.value)}
                  className="h-9 w-full rounded-md border border-gray-300 px-3"
                />
              </label>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
                <div className="font-medium">Matched Documents</div>
                <div className="mt-1 text-2xl font-semibold text-gray-900">{effectiveBatchDocs.length}</div>
                <div className="mt-1 text-xs text-gray-500">
                  Scope: {batchUseCurrentResults ? 'Current library results + date range' : 'Date range only'}
                </div>
                {batchDocumentSearch.trim() && (
                  <div className="mt-1 text-xs text-gray-500">Document search: {batchDocumentSearch.trim()}</div>
                )}
                {batchMode === 'apply-existing' && batchDocFilterTagIds.length > 0 && (
                  <div className="mt-1 text-xs text-gray-500">
                    Existing tag filter: {batchDocFilterTagMode === 'all' ? 'Match all' : 'Match any'}
                  </div>
                )}
                <div className="mt-1 text-xs text-gray-500">
                  {effectiveBatchDocs.slice(0, 3).map((doc) => doc.title).join(' · ') || 'No documents in the current range'}
                </div>
              </div>
            </div>

            {batchMode === 'apply-existing' && (
              <div className="mt-5 space-y-4">
                <div className="rounded-xl border border-gray-200 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-semibold text-gray-900">Filter Target Documents By Existing Tags</h4>
                      <p className="text-xs text-gray-500">Use one or more existing tags to narrow the matched documents before applying new tags.</p>
                    </div>
                    <div className="flex rounded-md bg-gray-100 p-1">
                      <button
                        type="button"
                        onClick={() => setBatchDocFilterTagMode('any')}
                        className={`rounded px-2 py-1 text-xs ${
                          batchDocFilterTagMode === 'any' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        Match Any
                      </button>
                      <button
                        type="button"
                        onClick={() => setBatchDocFilterTagMode('all')}
                        className={`rounded px-2 py-1 text-xs ${
                          batchDocFilterTagMode === 'all' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        Match All
                      </button>
                    </div>
                  </div>
                  <input
                    value={batchDocFilterTagSearch}
                    onChange={(event) => setBatchDocFilterTagSearch(event.target.value)}
                    placeholder="Search tags to filter the target documents..."
                    className="mt-3 h-9 w-full rounded-md border border-gray-300 px-3 text-sm"
                  />
                  <div className="mt-3 flex max-h-40 flex-wrap gap-2 overflow-y-auto">
                    {filteredBatchDocFilterTags.map((tag) => (
                      <button
                        key={`filter-${tag.id}`}
                        type="button"
                        onClick={() => toggleBatchDocFilterTagId(tag.id)}
                        className={`rounded-full border px-2.5 py-1 text-xs ${
                          batchDocFilterTagIds.includes(tag.id)
                            ? 'border-blue-300 bg-blue-50 text-blue-700'
                            : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        #{tag.name} <span className="text-[10px] text-gray-400">{tag.usage_count}</span>
                      </button>
                    ))}
                  </div>
                  {batchDocFilterTagIds.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setBatchDocFilterTagIds([])}
                      className="mt-3 rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
                    >
                      Clear Existing Tag Filter
                    </button>
                  )}
                </div>

                <div className="rounded-xl border border-gray-200 p-4">
                  <div className="mb-3">
                    <h4 className="text-sm font-semibold text-gray-900">Matched Result Preview</h4>
                    <p className="text-xs text-gray-500">These are the documents that will be updated. Current tags refresh after batch apply.</p>
                  </div>
                  <div className="space-y-2">
                    {effectiveBatchDocs.length === 0 ? (
                      <div className="text-sm text-gray-500">No documents match the current batch filters.</div>
                    ) : (
                      effectiveBatchDocs.slice(0, 8).map((doc) => (
                        <div key={`batch-preview-${doc.id}`} className="rounded-lg border border-gray-200 p-3">
                          <div className="text-sm font-medium text-gray-900">{doc.title}</div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {(documentTagMap[doc.id] || []).length === 0 ? (
                              <span className="text-xs text-gray-500">No tags yet</span>
                            ) : (
                              (documentTagMap[doc.id] || []).map((item) => (
                                <div
                                  key={`${doc.id}-${item.tag_id}`}
                                  className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-700"
                                >
                                  <span>#{item.tag_name}</span>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setBatchReplaceDraft({
                                        docId: doc.id,
                                        oldTagId: item.tag_id,
                                        oldTagName: item.tag_name,
                                        value: item.tag_name,
                                      })
                                    }
                                    disabled={batchPreviewActionKey !== null}
                                    className="rounded px-1 text-[10px] text-blue-700 hover:bg-blue-50 disabled:text-gray-400"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleBatchPreviewRemoveTag(doc.id, item.tag_id, item.tag_name)}
                                    disabled={batchPreviewActionKey !== null}
                                    className="rounded px-1 text-[10px] text-red-600 hover:bg-red-50 disabled:text-gray-400"
                                  >
                                    {batchPreviewActionKey === `remove:${doc.id}:${item.tag_id}` ? '...' : 'Remove'}
                                  </button>
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  {effectiveBatchDocs.length > 8 && (
                    <div className="mt-2 text-xs text-gray-500">Showing 8 of {effectiveBatchDocs.length} matched documents.</div>
                  )}
                </div>

                <div className="rounded-xl border border-gray-200 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h4 className="text-sm font-semibold text-gray-900">Tags To Apply</h4>
                      <p className="text-xs text-gray-500">Apply the selected tags directly to the currently matched documents.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleBatchApplyExisting()}
                      disabled={isBatchRunning || effectiveBatchDocs.length === 0 || batchSelectedTagIds.length === 0}
                      className="rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:bg-gray-300"
                    >
                      {isBatchRunning ? 'Applying...' : 'Apply Tags'}
                    </button>
                  </div>
                  <input
                    value={batchTagSearch}
                    onChange={(event) => setBatchTagSearch(event.target.value)}
                    placeholder="Search tags to apply..."
                    className="mt-3 h-9 w-full rounded-md border border-gray-300 px-3 text-sm"
                  />
                  <div className="mt-3 flex max-h-56 flex-wrap gap-2 overflow-y-auto">
                    {filteredBatchTags.map((tag) => (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => toggleBatchSelectedTagId(tag.id)}
                        className={`rounded-full border px-2.5 py-1 text-xs ${
                          batchSelectedTagIds.includes(tag.id)
                            ? 'border-blue-300 bg-blue-50 text-blue-700'
                            : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        #{tag.name} <span className="text-[10px] text-gray-400">{tag.usage_count}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {batchMode === 'ai-recommend' && (
              <div className="mt-5 space-y-4">
                <div className="rounded-xl border border-gray-200 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h4 className="text-sm font-semibold text-gray-900">Generate Tag Suggestions</h4>
                      <p className="text-xs text-gray-500">Suggestions that match existing tags can be accepted directly. New candidates go into the review queue.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleBatchSuggest()}
                      disabled={isBatchRunning || selectedBatchDocs.length === 0}
                      className="rounded-md bg-gray-900 px-3 py-2 text-xs font-medium text-white hover:bg-black disabled:bg-gray-300"
                    >
                      {isBatchRunning ? 'Generating...' : 'Run AI Suggestions'}
                    </button>
                  </div>
                </div>

                <div className="rounded-xl border border-gray-200 p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div>
                      <h4 className="text-sm font-semibold text-gray-900">Pending Review</h4>
                      <p className="text-xs text-gray-500">Grouped by normalized tag name. Suggestions that match existing tags can be accepted directly.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void refreshTagData()}
                      className="rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
                    >
                      Reload
                    </button>
                  </div>
                  <div className="space-y-3">
                    {pendingReviewItems.length === 0 ? (
                      <div className="text-sm text-gray-500">No pending review items.</div>
                    ) : (
                      pendingReviewItems.map((item) => (
                        <div key={`${item.normalized_name}:${item.matched_tag_id || 'new'}`} className="rounded-lg border border-gray-200 p-3">
                          {(() => {
                            const reviewKey = `${item.normalized_name}:${item.matched_tag_id || 'new'}`;
                            const isExpanded = expandedReviewItems[reviewKey] ?? false;
                            const visibleDocs = isExpanded ? item.sample_docs : item.sample_docs.slice(0, 4);

                            return (
                              <>
                                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                  <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="text-sm font-semibold text-gray-900">#{item.proposed_name}</span>
                                      {item.matched_tag_name ? (
                                        <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700">
                                          match: {item.matched_tag_name}
                                        </span>
                                      ) : (
                                        <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">new candidate</span>
                                      )}
                                      <span className="text-[11px] text-gray-500">{item.doc_count} docs</span>
                                    </div>
                                    {item.reasons.length > 0 && (
                                      <p className="mt-1 text-xs leading-5 text-gray-600">{item.reasons.slice(0, 2).join(' / ')}</p>
                                    )}
                                  </div>
                                  <div className="flex shrink-0 flex-wrap gap-1">
                            {item.matched_tag_id ? (
                              <button
                                type="button"
                                onClick={() => void handleReviewMatchedItem(item)}
                                className="rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-emerald-700"
                              >
                                Accept
                              </button>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => void handleCreateReviewTag(item)}
                                  className="rounded-md bg-amber-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-amber-700"
                                >
                                  Create Temp
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleMapReviewItem(item)}
                                  className="rounded-md border border-gray-300 px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50"
                                >
                                  Map
                                </button>
                              </>
                            )}
                            <button
                              type="button"
                              onClick={() => void handleRejectReviewItem(item)}
                              className="rounded-md border border-red-200 px-2 py-1 text-[11px] font-medium text-red-600 hover:bg-red-50"
                            >
                              Reject
                            </button>
                                  </div>
                                </div>

                                <div className="mt-3 rounded-lg bg-gray-50 p-3">
                                  <div className="mb-2 flex items-center justify-between gap-2">
                                    <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Related Documents</div>
                                    {item.sample_docs.length > 4 && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setExpandedReviewItems((prev) => ({
                                            ...prev,
                                            [reviewKey]: !isExpanded,
                                          }))
                                        }
                                        className="text-[11px] font-medium text-blue-700 hover:text-blue-800"
                                      >
                                        {isExpanded ? 'Show less' : `Show more (${item.sample_docs.length - 4})`}
                                      </button>
                                    )}
                                  </div>
                                  <div className="space-y-2">
                                    {visibleDocs.map((doc) => (
                                      <div
                                        key={doc.doc_id}
                                        className="flex items-center justify-between gap-3 rounded-md border border-gray-200 bg-white px-3 py-2"
                                      >
                                        <div className="min-w-0 flex-1 text-sm text-gray-800">
                                          <div className="truncate">{doc.title}</div>
                                        </div>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            selectDocument(doc.doc_id);
                                            setShowBatchDialog(false);
                                          }}
                                          className="shrink-0 rounded-md border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-50"
                                        >
                                          Open
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </>
                            );
                          })()}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {showTagManager && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/35 p-4">
          <div className="max-h-[88vh] w-full max-w-5xl overflow-y-auto rounded-xl border border-gray-200 bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Tag Library</h3>
                <p className="text-sm text-gray-500">Rename, merge, manage aliases, promote temporary tags, and clean up unused tags.</p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setTagManagerFeedback(null);
                    setShowCleanupUnusedConfirm(true);
                  }}
                  className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                >
                  Cleanup Unused
                </button>
                <button
                  type="button"
                  onClick={() => setShowTagManager(false)}
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
                >
                  Close
                </button>
              </div>
            </div>

            {tagManagerFeedback && (
              <div
                className={`mt-4 rounded-lg border px-3 py-2 text-sm ${
                  tagManagerFeedback.tone === 'success'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border-red-200 bg-red-50 text-red-700'
                }`}
              >
                {tagManagerFeedback.message}
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <input
                value={tagManagerSearch}
                onChange={(event) => setTagManagerSearch(event.target.value)}
                placeholder="Search tags or aliases..."
                className="h-9 min-w-[220px] rounded-md border border-gray-300 px-3 text-sm"
              />
              <label className="inline-flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-xs text-gray-700">
                <input
                  type="checkbox"
                  checked={tagManagerTemporaryOnly}
                  onChange={(event) => setTagManagerTemporaryOnly(event.target.checked)}
                />
                Temporary only
              </label>
              <label className="inline-flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-xs text-gray-700">
                <input
                  type="checkbox"
                  checked={tagManagerUnusedOnly}
                  onChange={(event) => setTagManagerUnusedOnly(event.target.checked)}
                />
                Unused only
              </label>
            </div>

            <div className="mt-4 space-y-3">
              {filteredTagLibrary.length === 0 ? (
                <div className="text-sm text-gray-500">No tags match current filters.</div>
              ) : (
                filteredTagLibrary.map((tag) => (
                  <div key={tag.id} className="rounded-xl border border-gray-200 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-gray-900">#{tag.name}</span>
                          {tag.is_temporary && (
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">temporary</span>
                          )}
                          <span className="text-[11px] text-gray-500">{tag.usage_count} docs</span>
                          {tag.pending_suggestion_count > 0 && (
                            <span className="text-[11px] text-gray-500">{tag.pending_suggestion_count} pending</span>
                          )}
                        </div>
                        {tag.aliases.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {tag.aliases.map((alias) => (
                              <span key={alias.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-[11px] text-slate-600">
                                {alias.alias}
                                <button
                                  type="button"
                                  onClick={() => void handleRemoveAlias(alias.id)}
                                  className="text-slate-500 hover:text-red-600"
                                >
                                  ×
                                </button>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-1">
                        <button type="button" onClick={() => void handleRenameTag(tag)} className="rounded-md border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-50">Rename</button>
                        <button type="button" onClick={() => void handleMergeTag(tag)} className="rounded-md border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-50">Merge</button>
                        <button type="button" onClick={() => void handleAddAlias(tag)} className="rounded-md border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-50">Add Alias</button>
                        {tag.is_temporary && (
                          <button type="button" onClick={() => void handlePromoteTemporary(tag)} className="rounded-md border border-amber-200 px-2 py-1 text-[11px] text-amber-700 hover:bg-amber-50">Promote</button>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      <div className={`h-full flex bg-gray-50 ${isResizingSidebar ? 'select-none' : ''}`}>
        <aside
          className="relative shrink-0 border-r border-gray-200 bg-[#f6f7f9] p-3"
          style={{ width: `${sidebarWidth}px` }}
        >
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Formats</h2>
          <div className="space-y-1">
            {typeSummaries.map((item) => {
              const active = typeFilter === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setTypeFilter(item.key)}
                  className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                    active ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  <span>{item.label}</span>
                  <span className={active ? 'text-gray-200' : 'text-gray-500'}>{item.count}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-4 border-t border-gray-200 pt-3">
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Category</h2>
            <div className="space-y-1">
              <button
                type="button"
                onClick={() => setCategoryFilter(FAVORITES_CATEGORY)}
                className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-sm transition-colors ${
                  categoryFilter === FAVORITES_CATEGORY ? 'bg-blue-100 text-blue-700' : 'text-gray-700 hover:bg-gray-200'
                }`}
              >
                <span>Favorite</span>
                <span className={categoryFilter === FAVORITES_CATEGORY ? 'text-blue-600' : 'text-gray-500'}>{favoriteCount}</span>
              </button>
              <button
                type="button"
                onClick={() => setCategoryFilter(RECENTS_CATEGORY)}
                className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-sm transition-colors ${
                  categoryFilter === RECENTS_CATEGORY ? 'bg-blue-100 text-blue-700' : 'text-gray-700 hover:bg-gray-200'
                }`}
              >
                <span>Recents</span>
                <span className={categoryFilter === RECENTS_CATEGORY ? 'text-blue-600' : 'text-gray-500'}>{documents.length}</span>
              </button>
              <div className="my-1 h-px bg-gray-200" />
              <button
                type="button"
                onClick={() => setCategoryFilter('all')}
                className={`w-full rounded-md px-2.5 py-1.5 text-left text-sm transition-colors ${
                  categoryFilter === 'all' ? 'bg-blue-100 text-blue-700' : 'text-gray-700 hover:bg-gray-200'
                }`}
              >
                All
              </button>
              {quickCategories.map((category) => (
                <button
                  key={category}
                  type="button"
                  onClick={() => setCategoryFilter(category)}
                  className={`w-full truncate rounded-md px-2.5 py-1.5 text-left text-sm transition-colors ${
                    categoryFilter === category ? 'bg-blue-100 text-blue-700' : 'text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {category}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 border-t border-gray-200 pt-3">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Tags</h2>
              <span className="text-[10px] text-gray-400">{tagFacets.length}</span>
            </div>
            <input
              value={tagSearchText}
              onChange={(event) => setTagSearchText(event.target.value)}
              placeholder="Filter tags..."
              className="mb-2 h-8 w-full rounded-md border border-gray-300 bg-white px-2 text-xs text-gray-700"
            />
            <div className="mb-2 flex rounded-md bg-white p-1">
              <button
                type="button"
                onClick={() => setTagMatchMode('any')}
                className={`flex-1 rounded px-2 py-1 text-xs ${tagMatchMode === 'any' ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}
              >
                Any
              </button>
              <button
                type="button"
                onClick={() => setTagMatchMode('all')}
                className={`flex-1 rounded px-2 py-1 text-xs ${tagMatchMode === 'all' ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}
              >
                All
              </button>
            </div>
            <div className="max-h-56 space-y-1 overflow-y-auto">
              {filteredTagFacets.length === 0 ? (
                <div className="rounded-md bg-white px-2.5 py-2 text-xs text-gray-500">No tags</div>
              ) : (
                filteredTagFacets.slice(0, 24).map((facet) => {
                  const active = selectedTagIds.includes(facet.tag_id);
                  return (
                    <button
                      key={facet.tag_id}
                      type="button"
                      onClick={() => toggleSelectedTagId(facet.tag_id)}
                      className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-sm transition-colors ${
                        active ? 'bg-blue-100 text-blue-700' : 'bg-white text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      <span className="truncate">
                        #{facet.name}
                        {facet.is_temporary && <span className="ml-1 text-[10px] text-amber-600">temp</span>}
                      </span>
                      <span className={active ? 'text-blue-600' : 'text-gray-500'}>{facet.count}</span>
                    </button>
                  );
                })
              )}
            </div>
            {selectedTagIds.length > 0 && (
              <button
                type="button"
                onClick={() => setSelectedTagIds([])}
                className="mt-2 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
              >
                Clear Tag Filter
              </button>
            )}
          </div>

          <div
            role="separator"
            aria-label="Resize sidebar"
            className={`absolute right-0 top-0 h-full w-1.5 cursor-col-resize transition-colors ${
              isResizingSidebar ? 'bg-blue-300/70' : 'bg-transparent hover:bg-blue-200/60'
            }`}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              setIsResizingSidebar(true);
            }}
          />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="border-b border-gray-200 bg-white px-4 py-2.5">
            <div className="flex items-center gap-2">
              <div className="mr-1 flex shrink-0 items-center gap-2">
                <img
                  src="/reader-logo.svg"
                  alt="Reader Logo"
                  className="h-7 w-7 rounded-md border border-slate-200 bg-white p-0.5 shadow-sm"
                />
                <div className="leading-tight">
                  <div className="text-sm font-semibold text-gray-900">Reader</div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-gray-500">Library</div>
                </div>
              </div>

              <div className="min-w-0 flex-1">
                <input
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="Search library..."
                  className="h-8 w-full rounded-md border border-gray-300 bg-white px-2.5 text-sm text-gray-800 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none"
                />
              </div>

              {isAutoClassifying && (
                <span className="shrink-0 text-[11px] text-gray-500">Indexing...</span>
              )}

              {isTagDataLoading && (
                <span className="shrink-0 text-[11px] text-gray-500">Tags syncing...</span>
              )}

              <div ref={displayMenuRef} className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setShowDisplayMenu((prev) => !prev)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                  aria-label="Display options"
                  title="Display options"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden="true">
                    <circle cx="5" cy="12" r="1.6" />
                    <circle cx="12" cy="12" r="1.6" />
                    <circle cx="19" cy="12" r="1.6" />
                  </svg>
                </button>

                {showDisplayMenu && (
                  <div className="absolute right-0 top-9 z-30 w-72 rounded-xl border border-gray-200 bg-white p-2 shadow-xl">
                    {([
                      ['grid', 'Grid'],
                      ['list', 'List'],
                      ['compact', 'Compact'],
                    ] as const).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => {
                          setViewMode(value);
                          setShowDisplayMenu(false);
                        }}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-gray-800 hover:bg-gray-100"
                      >
                        <span className="w-4 text-center text-[18px] leading-none">{viewMode === value ? '✓' : ''}</span>
                        <span className="text-base font-medium leading-6">{label}</span>
                      </button>
                    ))}

                    <div className="my-2 h-px bg-gray-200" />
                    <div className="px-2 py-1 text-[11px] font-semibold text-gray-400">Sort by...</div>
                    {([
                      ['recent', 'Recent'],
                      ['title', 'Title'],
                      ['type', 'Type'],
                    ] as const).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => {
                          setSortBy(value);
                          setShowDisplayMenu(false);
                        }}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-gray-800 hover:bg-gray-100"
                      >
                        <span className="w-4 text-center text-[18px] leading-none">{sortBy === value ? '✓' : ''}</span>
                        <span className="text-base font-medium leading-6">{label}</span>
                      </button>
                    ))}

                    <div className="my-2 h-px bg-gray-200" />
                    <div className="px-2 py-1 text-[11px] font-semibold text-gray-400">Filter by type...</div>
                    {([
                      ['all', 'All'],
                      ['epub', 'EPUB'],
                      ['pdf', 'PDF'],
                      ['markdown', 'Markdown'],
                    ] as const).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => {
                          setTypeFilter(value);
                          setShowDisplayMenu(false);
                        }}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-gray-800 hover:bg-gray-100"
                      >
                        <span className="w-4 text-center text-[18px] leading-none">{typeFilter === value ? '✓' : ''}</span>
                        <span className="text-base font-medium leading-6">{label}</span>
                      </button>
                    ))}

                    <div className="my-2 h-px bg-gray-200" />
                    <div className="px-2 py-1 text-[11px] font-semibold text-gray-400">Category...</div>
                    <div className="max-h-44 overflow-y-auto">
                      <button
                        type="button"
                        onClick={() => {
                          setCategoryFilter(FAVORITES_CATEGORY);
                          setShowDisplayMenu(false);
                        }}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-gray-800 hover:bg-gray-100"
                      >
                        <span className="w-4 text-center text-[18px] leading-none">{categoryFilter === FAVORITES_CATEGORY ? '✓' : ''}</span>
                        <span className="text-base font-medium leading-6">Favorite</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setCategoryFilter(RECENTS_CATEGORY);
                          setShowDisplayMenu(false);
                        }}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-gray-800 hover:bg-gray-100"
                      >
                        <span className="w-4 text-center text-[18px] leading-none">{categoryFilter === RECENTS_CATEGORY ? '✓' : ''}</span>
                        <span className="text-base font-medium leading-6">Recents</span>
                      </button>
                      <div className="my-1 h-px bg-gray-200" />
                      <button
                        type="button"
                        onClick={() => {
                          setCategoryFilter('all');
                          setShowDisplayMenu(false);
                        }}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-gray-800 hover:bg-gray-100"
                      >
                        <span className="w-4 text-center text-[18px] leading-none">{categoryFilter === 'all' ? '✓' : ''}</span>
                        <span className="text-base font-medium leading-6">All</span>
                      </button>
                      {regularCategoryOptions.map((category) => (
                        <button
                          key={category}
                          type="button"
                          onClick={() => {
                            setCategoryFilter(category);
                            setShowDisplayMenu(false);
                          }}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-gray-800 hover:bg-gray-100"
                        >
                          <span className="w-4 text-center text-[18px] leading-none">{categoryFilter === category ? '✓' : ''}</span>
                          <span className="truncate text-base font-medium leading-6">{category}</span>
                        </button>
                      ))}
                    </div>

                    <div className="my-2 h-px bg-gray-200" />
                    <button
                      type="button"
                      onClick={() => {
                        setGroupByCategory((prev) => !prev);
                        setShowDisplayMenu(false);
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-gray-800 hover:bg-gray-100"
                    >
                      <span className="w-4 text-center text-[18px] leading-none">{shouldGroupDisplayedDocuments ? '✓' : ''}</span>
                      <span className="text-base font-medium leading-6">Group by category</span>
                    </button>
                  </div>
                )}
              </div>

              <button
                onClick={() => setShowBatchDialog(true)}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                Batch Tags
              </button>

              <button
                onClick={() => setShowTagManager(true)}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                Tag Library
              </button>

              <button
                onClick={handleUnifiedImport}
                disabled={isImportingFile || isImportingUrl}
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-blue-600 px-3 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:bg-gray-400"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  className="h-3.5 w-3.5"
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v10m0 0 4-4m-4 4-4-4" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 19h14" />
                </svg>
                {isImportingFile || isImportingUrl ? 'Importing...' : 'Import'}
              </button>
            </div>
          </div>

      {/* Documents Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        {documents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mb-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            <p className="text-lg">No documents yet</p>
            <p className="text-sm mt-2">Import an EPUB, PDF, or Markdown file to get started</p>
          </div>
        ) : displayedDocuments.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <p className="text-base">No documents match current filters</p>
            <p className="text-sm mt-2">Try clearing search text, tag filters, or switching type/category filters</p>
          </div>
        ) : shouldGroupDisplayedDocuments ? (
          <div className="space-y-6">
            {groupedEntries.map(([category, items], categoryIndex) => {
              const defaultCollapsed = categoryIndex >= DEFAULT_EXPANDED_CATEGORY_COUNT;
              const isCollapsed = collapsedCategories[category] ?? defaultCollapsed;
              const showAllItems = expandedCategoryItems[category] ?? false;
              const visibleItems = showAllItems ? items : items.slice(0, DEFAULT_CATEGORY_VISIBLE_COUNT);
              const hasMoreItems = items.length > DEFAULT_CATEGORY_VISIBLE_COUNT;

              return (
              <section key={category}>
                <div className="mb-2 flex items-center justify-between">
                  <button
                    onClick={() => toggleCategoryCollapsed(category)}
                    className="inline-flex items-center gap-2 text-sm font-semibold text-gray-800 hover:text-gray-900"
                  >
                    <span className={`text-xs transition-transform ${isCollapsed ? '-rotate-90' : ''}`}>▾</span>
                    <span>{category}</span>
                  </button>
                  <span className="text-xs text-gray-500">{items.length} docs</span>
                </div>
                {!isCollapsed && (viewMode === 'grid' ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {visibleItems.map((doc) => (
                      <DocumentCard
                        key={doc.id}
                        document={doc}
                        variant="grid"
                        category={getDocumentCardCategory(doc.id)}
                        tags={(documentTagMap[doc.id] || []).map((item) => item.tag_name)}
                        isFavorite={isFavoriteDocument(doc.id)}
                        onToggleFavorite={() => toggleFavoriteDocument(doc.id)}
                        onClick={() => selectDocument(doc.id)}
                        onDelete={() => handleDeleteRequest(doc.id, doc.title)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className={viewMode === 'list' ? 'space-y-2' : 'space-y-1.5'}>
                    {visibleItems.map((doc) => (
                      <DocumentCard
                        key={doc.id}
                        document={doc}
                        variant={viewMode}
                        category={getDocumentCardCategory(doc.id)}
                        tags={(documentTagMap[doc.id] || []).map((item) => item.tag_name)}
                        isFavorite={isFavoriteDocument(doc.id)}
                        onToggleFavorite={() => toggleFavoriteDocument(doc.id)}
                        onClick={() => selectDocument(doc.id)}
                        onDelete={() => handleDeleteRequest(doc.id, doc.title)}
                      />
                    ))}
                  </div>
                ))}
                {!isCollapsed && hasMoreItems && (
                  <div className="mt-2 flex justify-center">
                    <button
                      onClick={() => toggleCategoryExpandedItems(category)}
                      className="text-xs text-blue-600 hover:text-blue-800 underline"
                    >
                      {showAllItems ? 'Show less' : `Show more (${items.length - DEFAULT_CATEGORY_VISIBLE_COUNT})`}
                    </button>
                  </div>
                )}
              </section>
            );
            })}
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {displayedDocuments.map((doc) => (
              <DocumentCard
                key={doc.id}
                document={doc}
                variant="grid"
                category={getDocumentCardCategory(doc.id)}
                tags={(documentTagMap[doc.id] || []).map((item) => item.tag_name)}
                isFavorite={isFavoriteDocument(doc.id)}
                onToggleFavorite={() => toggleFavoriteDocument(doc.id)}
                onClick={() => selectDocument(doc.id)}
                onDelete={() => handleDeleteRequest(doc.id, doc.title)}
              />
            ))}
          </div>
        ) : (
          <div className={viewMode === 'list' ? 'space-y-2' : 'space-y-1.5'}>
            {displayedDocuments.map((doc) => (
              <DocumentCard
                key={doc.id}
                document={doc}
                variant={viewMode}
                category={getDocumentCardCategory(doc.id)}
                tags={(documentTagMap[doc.id] || []).map((item) => item.tag_name)}
                isFavorite={isFavoriteDocument(doc.id)}
                onToggleFavorite={() => toggleFavoriteDocument(doc.id)}
                onClick={() => selectDocument(doc.id)}
                onDelete={() => handleDeleteRequest(doc.id, doc.title)}
              />
            ))}
          </div>
        )}
      </div>
      {statusBar && (
        <div className="h-7 border-t border-gray-200 bg-white px-3 text-[11px] text-gray-600 flex items-center overflow-x-auto whitespace-nowrap">
          {statusBar}
        </div>
      )}
        </div>
    </div>
    </>
  );
};
