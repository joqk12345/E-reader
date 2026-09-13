import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useLibrarySidebarResize } from '../features/library/useLibrarySidebarResize';
import { useLibraryImport } from '../features/library/useLibraryImport';
import { Button, type ButtonProps } from './ui/Button';
import { Input } from './ui/Input';
import { Checkbox } from './ui/Checkbox';
import {
  FAVORITES_CATEGORY,
  RECENTS_CATEGORY,
  useLibraryDocumentFilters,
} from '../features/library/useLibraryDocumentFilters';

type LibraryProps = {
  statusBar?: React.ReactNode;
  shellMenu: 'display' | 'more' | null;
  shellMenuPosition: { top: number; right: number };
  importRequestId: number;
  onCloseShellMenu: () => void;
};

type DocumentPreview = {
  doc_id: string;
  preview: string;
};

type DocumentInsight = {
  category: string;
};

const FAVORITES_STORAGE_KEY = 'reader.favoriteDocumentIds';

function LibraryButton({ variant = 'ghost', size = 'sm', ...props }: ButtonProps) {
  return <Button variant={variant} size={size} {...props} />;
}

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

export const Library: React.FC<LibraryProps> = ({
  statusBar,
  shellMenu,
  shellMenuPosition,
  importRequestId,
  onCloseShellMenu,
}) => {
  const DEFAULT_CATEGORY_VISIBLE_COUNT = 8;
  const DEFAULT_EXPANDED_CATEGORY_COUNT = 2;
  const { documents, loadDocuments, importEpub, deleteDocument, selectDocument } = useStore();
  const [viewMode, setViewMode] = useState<'grid' | 'list' | 'compact'>('list');
  const [typeFilter, setTypeFilter] = useState<'all' | 'epub'>('all');
  const [sortBy, setSortBy] = useState<'recent' | 'title' | 'type'>('recent');
  const [searchText, setSearchText] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [groupByCategory, setGroupByCategory] = useState(false);
  const closeDisplayMenu = () => onCloseShellMenu();
  const closeMoreMenu = () => onCloseShellMenu();
  const [isAutoClassifying, setIsAutoClassifying] = useState(false);
  const [documentInsights, setDocumentInsights] = useState<Record<string, DocumentInsight>>({});
  const [favoriteDocumentIds, setFavoriteDocumentIds] = useState<Record<string, boolean>>({});
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});
  const [expandedCategoryItems, setExpandedCategoryItems] = useState<Record<string, boolean>>({});
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null);
  const { sidebarWidth, isResizingSidebar, beginResize } = useLibrarySidebarResize();
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
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const previousImportRequestIdRef = useRef(importRequestId);

  const {
    isImportingFile,
    isImportingUrl,
    showImportDialog,
    setShowImportDialog,
    importUrlDraft,
    setImportUrlDraft,
    handleImportFile,
    handleImportUrlBeta,
  } = useLibraryImport({ loadDocuments, importEpub, selectDocument });

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

  const {
    getDocumentCardCategory,
    shouldGroupDisplayedDocuments,
    displayedDocuments,
    regularCategoryOptions,
    groupedEntries,
    typeSummaries,
    favoriteCount,
    quickCategories,
  } = useLibraryDocumentFilters({
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
  });

  const continueDocument = useMemo(
    () => [...documents]
      .filter((document) => document.file_type === 'epub')
      .sort((left, right) => right.updated_at - left.updated_at)[0],
    [documents]
  );

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
    if (importRequestId === previousImportRequestIdRef.current) return;
    previousImportRequestIdRef.current = importRequestId;
    setShowImportDialog(true);
  }, [importRequestId, setShowImportDialog]);

  useEffect(() => {
    if (!shellMenu) return;
    const menu = shellMenu === 'display' ? displayMenuRef.current : moreMenuRef.current;
    const focusFrame = window.requestAnimationFrame(() => {
      menu?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    });
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target) return;
      if (target.closest('#app-library-display-options-button, #app-library-more-actions-button')) return;
      if (displayMenuRef.current?.contains(target) || moreMenuRef.current?.contains(target)) return;
      onCloseShellMenu();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      const triggerId = shellMenu === 'display'
        ? 'app-library-display-options-button'
        : 'app-library-more-actions-button';
      onCloseShellMenu();
      window.requestAnimationFrame(() => document.getElementById(triggerId)?.focus());
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onCloseShellMenu, shellMenu]);

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
        <div className="fixed inset-0 z-50 bg-foreground bg-opacity-40 flex items-center justify-center">
          <div className="bg-surface rounded-lg shadow-xl w-full max-w-md mx-4 p-5">
            <h3 className="text-size-title font-semibold text-heading">Confirm Delete</h3>
            <p className="mt-2 text-size-subheading text-navigation">
              Delete document <span className="font-medium text-heading">{pendingDelete.title}</span>?
              This action cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <LibraryButton
                onClick={() => setPendingDelete(null)}
                className="px-3 py-2 text-size-subheading text-secondary bg-surface-subtle rounded-md hover:bg-surface-hover"
              >
                Cancel
              </LibraryButton>
              <LibraryButton
                onClick={() => void handleConfirmDelete()}
                className="px-3 py-2 text-size-subheading text-on-action bg-danger rounded-md hover:bg-danger"
              >
                Delete
              </LibraryButton>
            </div>
          </div>
        </div>
      )}

      {showImportDialog && (
        <div data-testid="import-dialog" role="dialog" aria-label="Import document" className="fixed inset-0 z-40 bg-foreground/35 flex items-center justify-center">
          <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-4 shadow-xl">
            <h3 className="text-size-body font-semibold text-heading">Import</h3>
            <p className="mt-1 text-size-caption text-muted">Choose a local EPUB file.</p>

            <div className="mt-3 space-y-2">
              <LibraryButton
                type="button"
                onClick={() => void handleImportFile()}
                disabled={isImportingFile || isImportingUrl}
                className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-action px-3 text-size-caption font-medium text-on-action transition-colors hover:bg-action-text disabled:bg-muted"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 3h7l5 5v13H7z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14 3v5h5" />
                </svg>
                {isImportingFile ? 'Importing File...' : 'Import File'}
              </LibraryButton>

              <div className="rounded-md border border-warning/25 bg-warning-subtle/60 p-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-size-meta font-semibold text-warning">Import from URL</span>
                  <span className="rounded bg-warning-subtle px-1.5 py-0.5 text-size-micro font-medium text-warning">Beta</span>
                </div>
                <Input
                  value={importUrlDraft}
                  onChange={(e) => setImportUrlDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleImportUrlBeta();
                    }
                  }}
                  placeholder="https://example.com/article"
                  className="w-full rounded border border-warning/25 bg-surface px-2.5 py-1.5 text-size-caption focus:outline-none focus:ring-2 focus:ring-warning"
                />
                <LibraryButton
                  type="button"
                  onClick={() => void handleImportUrlBeta()}
                  disabled={!importUrlDraft.trim() || isImportingUrl || isImportingFile}
                  className="mt-2 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-warning px-3 text-size-caption font-medium text-on-action transition-colors hover:bg-warning disabled:bg-muted"
                >
                  {isImportingUrl ? 'Importing URL...' : 'Import URL (Beta)'}
                </LibraryButton>
              </div>
            </div>

            <div className="mt-3 flex justify-end">
              <LibraryButton
                type="button"
                onClick={() => {
                  if (isImportingFile || isImportingUrl) return;
                  setImportUrlDraft('');
                  setShowImportDialog(false);
                }}
                className="rounded-md border border-control-border bg-surface px-3 py-1.5 text-size-caption text-secondary hover:bg-surface-subtle"
              >
                Close
              </LibraryButton>
            </div>
          </div>
        </div>
      )}

      {showBatchDialog && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-foreground/35 p-4">
          <div className="library-modal w-full max-w-4xl">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-size-title font-semibold text-heading">Batch Tags</h3>
                <p className="text-size-subheading text-muted">Filter by imported time (`created_at`) and apply or review tag operations.</p>
              </div>
              <LibraryButton
                type="button"
                onClick={() => setShowBatchDialog(false)}
                className="rounded-md border border-control-border px-3 py-1.5 text-size-caption text-secondary hover:bg-surface-subtle"
              >
                Close
              </LibraryButton>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <LibraryButton
                type="button"
                onClick={() => setBatchMode('ai-recommend')}
                className={`rounded-md px-3 py-2 text-size-subheading font-medium ${
                  batchMode === 'ai-recommend' ? 'bg-action text-on-action' : 'bg-surface-subtle text-secondary hover:bg-surface-hover'
                }`}
              >
                Run AI Suggestions
              </LibraryButton>
              <LibraryButton
                type="button"
                onClick={() => setBatchMode('apply-existing')}
                className={`rounded-md px-3 py-2 text-size-subheading font-medium ${
                  batchMode === 'apply-existing' ? 'bg-action text-on-action' : 'bg-surface-subtle text-secondary hover:bg-surface-hover'
                }`}
              >
                Apply Existing Tags
              </LibraryButton>
            </div>

            {batchFeedback && (
              <div
                className={`mt-4 rounded-lg border px-3 py-2 text-size-subheading ${
                  batchFeedback.tone === 'success'
                    ? 'border-success/25 bg-success/10 text-success'
                    : 'border-danger/25 bg-danger-subtle text-danger'
                }`}
              >
                {batchFeedback.message}
              </div>
            )}

            <div className="mt-4 rounded-lg border border-border bg-surface-subtle p-3">
              <label className="inline-flex items-start gap-2 text-size-subheading text-secondary">
                <Checkbox
                  checked={batchUseCurrentResults}
                  onChange={(event) => setBatchUseCurrentResults(event.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium text-heading">Use current library results</span>
                  <span className="mt-1 block text-size-caption text-muted">
                    Reuse the current Library search, type, category, and tag filters before applying the date range.
                  </span>
                </span>
              </label>
            </div>

            <div className="mt-4">
              <label className="text-size-subheading text-secondary">
                <div className="mb-1 font-medium">Document Search</div>
                <Input
                  value={batchDocumentSearch}
                  onChange={(event) => setBatchDocumentSearch(event.target.value)}
                  placeholder="Filter matched documents by title, author, or path..."
                  className="h-9 w-full rounded-md border border-control-border px-3"
                />
              </label>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
              <label className="text-size-subheading text-secondary">
                <div className="mb-1 font-medium">Start Date</div>
                <Input
                  type="date"
                  value={batchStartDate}
                  onChange={(event) => setBatchStartDate(event.target.value)}
                  className="h-9 w-full rounded-md border border-control-border px-3"
                />
              </label>
              <label className="text-size-subheading text-secondary">
                <div className="mb-1 font-medium">End Date</div>
                <Input
                  type="date"
                  value={batchEndDate}
                  onChange={(event) => setBatchEndDate(event.target.value)}
                  className="h-9 w-full rounded-md border border-control-border px-3"
                />
              </label>
              <div className="rounded-lg border border-border bg-surface-subtle p-3 text-size-subheading text-secondary">
                <div className="font-medium">Matched Documents</div>
                <div className="mt-1 text-size-hero-sm font-semibold text-heading">{effectiveBatchDocs.length}</div>
                <div className="mt-1 text-size-caption text-muted">
                  Scope: {batchUseCurrentResults ? 'Current library results + date range' : 'Date range only'}
                </div>
                {batchDocumentSearch.trim() && (
                  <div className="mt-1 text-size-caption text-muted">Document search: {batchDocumentSearch.trim()}</div>
                )}
                {batchMode === 'apply-existing' && batchDocFilterTagIds.length > 0 && (
                  <div className="mt-1 text-size-caption text-muted">
                    Existing tag filter: {batchDocFilterTagMode === 'all' ? 'Match all' : 'Match any'}
                  </div>
                )}
                <div className="mt-1 text-size-caption text-muted">
                  {effectiveBatchDocs.slice(0, 3).map((doc) => doc.title).join(' · ') || 'No documents in the current range'}
                </div>
              </div>
            </div>

            {batchMode === 'apply-existing' && (
              <div className="mt-5 space-y-4">
                <div className="rounded-xl border border-border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h4 className="text-size-subheading font-semibold text-heading">Filter Target Documents By Existing Tags</h4>
                      <p className="text-size-caption text-muted">Use one or more existing tags to narrow the matched documents before applying new tags.</p>
                    </div>
                    <div className="flex rounded-md bg-surface-subtle p-1">
                      <LibraryButton
                        type="button"
                        onClick={() => setBatchDocFilterTagMode('any')}
                        className={`rounded px-2 py-1 text-size-caption ${
                          batchDocFilterTagMode === 'any' ? 'bg-surface text-action-text shadow-sm' : 'text-navigation hover:bg-surface-subtle'
                        }`}
                      >
                        Match Any
                      </LibraryButton>
                      <LibraryButton
                        type="button"
                        onClick={() => setBatchDocFilterTagMode('all')}
                        className={`rounded px-2 py-1 text-size-caption ${
                          batchDocFilterTagMode === 'all' ? 'bg-surface text-action-text shadow-sm' : 'text-navigation hover:bg-surface-subtle'
                        }`}
                      >
                        Match All
                      </LibraryButton>
                    </div>
                  </div>
                  <Input
                    value={batchDocFilterTagSearch}
                    onChange={(event) => setBatchDocFilterTagSearch(event.target.value)}
                    placeholder="Search tags to filter the target documents..."
                    className="mt-3 h-9 w-full rounded-md border border-control-border px-3 text-size-subheading"
                  />
                  <div className="mt-3 flex max-h-40 flex-wrap gap-2 overflow-y-auto">
                    {filteredBatchDocFilterTags.map((tag) => (
                      <LibraryButton
                        key={`filter-${tag.id}`}
                        type="button"
                        onClick={() => toggleBatchDocFilterTagId(tag.id)}
                        className={`rounded-full border px-2.5 py-1 text-size-caption ${
                          batchDocFilterTagIds.includes(tag.id)
                            ? 'border-focus-border bg-action-subtle text-action-text'
                            : 'border-control-border text-secondary hover:bg-surface-subtle'
                        }`}
                      >
                        #{tag.name} <span className="text-size-micro text-faint">{tag.usage_count}</span>
                      </LibraryButton>
                    ))}
                  </div>
                  {batchDocFilterTagIds.length > 0 && (
                    <LibraryButton
                      type="button"
                      onClick={() => setBatchDocFilterTagIds([])}
                      className="mt-3 rounded-md border border-control-border px-3 py-1.5 text-size-caption text-secondary hover:bg-surface-subtle"
                    >
                      Clear Existing Tag Filter
                    </LibraryButton>
                  )}
                </div>

                <div className="rounded-xl border border-border p-4">
                  <div className="mb-3">
                    <h4 className="text-size-subheading font-semibold text-heading">Matched Result Preview</h4>
                    <p className="text-size-caption text-muted">These are the documents that will be updated. Current tags refresh after batch apply.</p>
                  </div>
                  <div className="space-y-2">
                    {effectiveBatchDocs.length === 0 ? (
                      <div className="text-size-subheading text-muted">No documents match the current batch filters.</div>
                    ) : (
                      effectiveBatchDocs.slice(0, 8).map((doc) => (
                        <div key={`batch-preview-${doc.id}`} className="rounded-lg border border-border p-3">
                          <div className="text-size-subheading font-medium text-heading">{doc.title}</div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {(documentTagMap[doc.id] || []).length === 0 ? (
                              <span className="text-size-caption text-muted">No tags yet</span>
                            ) : (
                              (documentTagMap[doc.id] || []).map((item) => (
                                <div
                                  key={`${doc.id}-${item.tag_id}`}
                                  className="inline-flex items-center gap-1 rounded-full bg-surface-subtle px-2 py-0.5 text-size-meta text-secondary"
                                >
                                  <span>#{item.tag_name}</span>
                                  <LibraryButton
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
                                    className="rounded px-1 text-size-micro text-action-text hover:bg-action-subtle disabled:text-faint"
                                  >
                                    Edit
                                  </LibraryButton>
                                  <LibraryButton
                                    type="button"
                                    onClick={() => void handleBatchPreviewRemoveTag(doc.id, item.tag_id, item.tag_name)}
                                    disabled={batchPreviewActionKey !== null}
                                    className="rounded px-1 text-size-micro text-danger hover:bg-danger-subtle disabled:text-faint"
                                  >
                                    {batchPreviewActionKey === `remove:${doc.id}:${item.tag_id}` ? '...' : 'Remove'}
                                  </LibraryButton>
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  {effectiveBatchDocs.length > 8 && (
                    <div className="mt-2 text-size-caption text-muted">Showing 8 of {effectiveBatchDocs.length} matched documents.</div>
                  )}
                </div>

                <div className="rounded-xl border border-border p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h4 className="text-size-subheading font-semibold text-heading">Tags To Apply</h4>
                      <p className="text-size-caption text-muted">Apply the selected tags directly to the currently matched documents.</p>
                    </div>
                    <LibraryButton
                      type="button"
                      onClick={() => void handleBatchApplyExisting()}
                      disabled={isBatchRunning || effectiveBatchDocs.length === 0 || batchSelectedTagIds.length === 0}
                      className="rounded-md bg-action px-3 py-2 text-size-caption font-medium text-on-action hover:bg-action-text disabled:bg-control-border"
                    >
                      {isBatchRunning ? 'Applying...' : 'Apply Tags'}
                    </LibraryButton>
                  </div>
                  <Input
                    value={batchTagSearch}
                    onChange={(event) => setBatchTagSearch(event.target.value)}
                    placeholder="Search tags to apply..."
                    className="mt-3 h-9 w-full rounded-md border border-control-border px-3 text-size-subheading"
                  />
                  <div className="mt-3 flex max-h-56 flex-wrap gap-2 overflow-y-auto">
                    {filteredBatchTags.map((tag) => (
                      <LibraryButton
                        key={tag.id}
                        type="button"
                        onClick={() => toggleBatchSelectedTagId(tag.id)}
                        className={`rounded-full border px-2.5 py-1 text-size-caption ${
                          batchSelectedTagIds.includes(tag.id)
                            ? 'border-focus-border bg-action-subtle text-action-text'
                            : 'border-control-border text-secondary hover:bg-surface-subtle'
                        }`}
                      >
                        #{tag.name} <span className="text-size-micro text-faint">{tag.usage_count}</span>
                      </LibraryButton>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {batchMode === 'ai-recommend' && (
              <div className="mt-5 space-y-4">
                <div className="rounded-xl border border-border p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h4 className="text-size-subheading font-semibold text-heading">Generate Tag Suggestions</h4>
                      <p className="text-size-caption text-muted">Suggestions that match existing tags can be accepted directly. New candidates go into the review queue.</p>
                    </div>
                    <LibraryButton
                      type="button"
                      onClick={() => void handleBatchSuggest()}
                      disabled={isBatchRunning || selectedBatchDocs.length === 0}
                      className="rounded-md bg-heading px-3 py-2 text-size-caption font-medium text-on-action hover:bg-foreground disabled:bg-control-border"
                    >
                      {isBatchRunning ? 'Generating...' : 'Run AI Suggestions'}
                    </LibraryButton>
                  </div>
                </div>

                <div className="rounded-xl border border-border p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div>
                      <h4 className="text-size-subheading font-semibold text-heading">Pending Review</h4>
                      <p className="text-size-caption text-muted">Grouped by normalized tag name. Suggestions that match existing tags can be accepted directly.</p>
                    </div>
                    <LibraryButton
                      type="button"
                      onClick={() => void refreshTagData()}
                      className="rounded-md border border-control-border px-3 py-1.5 text-size-caption text-secondary hover:bg-surface-subtle"
                    >
                      Reload
                    </LibraryButton>
                  </div>
                  <div className="space-y-3">
                    {pendingReviewItems.length === 0 ? (
                      <div className="text-size-subheading text-muted">No pending review items.</div>
                    ) : (
                      pendingReviewItems.map((item) => (
                        <div key={`${item.normalized_name}:${item.matched_tag_id || 'new'}`} className="rounded-lg border border-border p-3">
                          {(() => {
                            const reviewKey = `${item.normalized_name}:${item.matched_tag_id || 'new'}`;
                            const isExpanded = expandedReviewItems[reviewKey] ?? false;
                            const visibleDocs = isExpanded ? item.sample_docs : item.sample_docs.slice(0, 4);

                            return (
                              <>
                                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                  <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="text-size-subheading font-semibold text-heading">#{item.proposed_name}</span>
                                      {item.matched_tag_name ? (
                                        <span className="rounded bg-success/10 px-1.5 py-0.5 text-size-micro text-success">
                                          match: {item.matched_tag_name}
                                        </span>
                                      ) : (
                                        <span className="rounded bg-warning-subtle px-1.5 py-0.5 text-size-micro text-warning">new candidate</span>
                                      )}
                                      <span className="text-size-meta text-muted">{item.doc_count} docs</span>
                                    </div>
                                    {item.reasons.length > 0 && (
                                      <p className="mt-1 text-size-caption leading-5 text-navigation">{item.reasons.slice(0, 2).join(' / ')}</p>
                                    )}
                                  </div>
                                  <div className="flex shrink-0 flex-wrap gap-1">
                            {item.matched_tag_id ? (
                              <LibraryButton
                                type="button"
                                onClick={() => void handleReviewMatchedItem(item)}
                                className="rounded-md bg-success px-2 py-1 text-size-meta font-medium text-on-action hover:bg-success"
                              >
                                Accept
                              </LibraryButton>
                            ) : (
                              <>
                                <LibraryButton
                                  type="button"
                                  onClick={() => void handleCreateReviewTag(item)}
                                  className="rounded-md bg-warning px-2 py-1 text-size-meta font-medium text-on-action hover:bg-warning"
                                >
                                  Create Temp
                                </LibraryButton>
                                <LibraryButton
                                  type="button"
                                  onClick={() => void handleMapReviewItem(item)}
                                  className="rounded-md border border-control-border px-2 py-1 text-size-meta font-medium text-secondary hover:bg-surface-subtle"
                                >
                                  Map
                                </LibraryButton>
                              </>
                            )}
                            <LibraryButton
                              type="button"
                              onClick={() => void handleRejectReviewItem(item)}
                              className="rounded-md border border-danger/25 px-2 py-1 text-size-meta font-medium text-danger hover:bg-danger-subtle"
                            >
                              Reject
                            </LibraryButton>
                                  </div>
                                </div>

                                <div className="mt-3 rounded-lg bg-surface-subtle p-3">
                                  <div className="mb-2 flex items-center justify-between gap-2">
                                    <div className="text-size-meta font-semibold uppercase tracking-wide text-muted">Related Documents</div>
                                    {item.sample_docs.length > 4 && (
                                      <LibraryButton
                                        type="button"
                                        onClick={() =>
                                          setExpandedReviewItems((prev) => ({
                                            ...prev,
                                            [reviewKey]: !isExpanded,
                                          }))
                                        }
                                        className="text-size-meta font-medium text-action-text hover:text-action"
                                      >
                                        {isExpanded ? 'Show less' : `Show more (${item.sample_docs.length - 4})`}
                                      </LibraryButton>
                                    )}
                                  </div>
                                  <div className="space-y-2">
                                    {visibleDocs.map((doc) => (
                                      <div
                                        key={doc.doc_id}
                                        className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-3 py-2"
                                      >
                                        <div className="min-w-0 flex-1 text-size-subheading text-foreground">
                                          <div className="truncate">{doc.title}</div>
                                        </div>
                                        <LibraryButton
                                          type="button"
                                          onClick={() => {
                                            selectDocument(doc.doc_id);
                                            setShowBatchDialog(false);
                                          }}
                                          className="shrink-0 rounded-md border border-control-border px-2 py-1 text-size-meta text-secondary hover:bg-surface-subtle"
                                        >
                                          Open
                                        </LibraryButton>
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
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-foreground/35 p-4">
          <div className="library-modal w-full max-w-5xl">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-size-title font-semibold text-heading">Tag Library</h3>
                <p className="text-size-subheading text-muted">Rename, merge, manage aliases, promote temporary tags, and clean up unused tags.</p>
              </div>
              <div className="flex gap-2">
                <LibraryButton
                  type="button"
                  onClick={() => {
                    setTagManagerFeedback(null);
                    setShowCleanupUnusedConfirm(true);
                  }}
                  className="rounded-md border border-danger/25 px-3 py-1.5 text-size-caption font-medium text-danger hover:bg-danger-subtle"
                >
                  Cleanup Unused
                </LibraryButton>
                <LibraryButton
                  type="button"
                  onClick={() => setShowTagManager(false)}
                  className="rounded-md border border-control-border px-3 py-1.5 text-size-caption text-secondary hover:bg-surface-subtle"
                >
                  Close
                </LibraryButton>
              </div>
            </div>

            {tagManagerFeedback && (
              <div
                className={`mt-4 rounded-lg border px-3 py-2 text-size-subheading ${
                  tagManagerFeedback.tone === 'success'
                    ? 'border-success/25 bg-success/10 text-success'
                    : 'border-danger/25 bg-danger-subtle text-danger'
                }`}
              >
                {tagManagerFeedback.message}
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Input
                value={tagManagerSearch}
                onChange={(event) => setTagManagerSearch(event.target.value)}
                placeholder="Search tags or aliases..."
                className="h-9 min-w-[220px] rounded-md border border-control-border px-3 text-size-subheading"
              />
              <label className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-size-caption text-secondary">
                <Checkbox
                  checked={tagManagerTemporaryOnly}
                  onChange={(event) => setTagManagerTemporaryOnly(event.target.checked)}
                />
                Temporary only
              </label>
              <label className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-size-caption text-secondary">
                <Checkbox
                  checked={tagManagerUnusedOnly}
                  onChange={(event) => setTagManagerUnusedOnly(event.target.checked)}
                />
                Unused only
              </label>
            </div>

            <div className="mt-4 space-y-3">
              {filteredTagLibrary.length === 0 ? (
                <div className="text-size-subheading text-muted">No tags match current filters.</div>
              ) : (
                filteredTagLibrary.map((tag) => (
                  <div key={tag.id} className="rounded-xl border border-border p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-size-subheading font-semibold text-heading">#{tag.name}</span>
                          {tag.is_temporary && (
                            <span className="rounded bg-warning-subtle px-1.5 py-0.5 text-size-micro text-warning">temporary</span>
                          )}
                          <span className="text-size-meta text-muted">{tag.usage_count} docs</span>
                          {tag.pending_suggestion_count > 0 && (
                            <span className="text-size-meta text-muted">{tag.pending_suggestion_count} pending</span>
                          )}
                        </div>
                        {tag.aliases.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {tag.aliases.map((alias) => (
                              <span key={alias.id} className="inline-flex items-center gap-1 rounded-full bg-surface-subtle px-2 py-1 text-size-meta text-navigation">
                                {alias.alias}
                                <LibraryButton
                                  type="button"
                                  onClick={() => void handleRemoveAlias(alias.id)}
                                  className="text-muted hover:text-danger"
                                >
                                  ×
                                </LibraryButton>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-1">
                        <LibraryButton type="button" onClick={() => void handleRenameTag(tag)} className="rounded-md border border-control-border px-2 py-1 text-size-meta text-secondary hover:bg-surface-subtle">Rename</LibraryButton>
                        <LibraryButton type="button" onClick={() => void handleMergeTag(tag)} className="rounded-md border border-control-border px-2 py-1 text-size-meta text-secondary hover:bg-surface-subtle">Merge</LibraryButton>
                        <LibraryButton type="button" onClick={() => void handleAddAlias(tag)} className="rounded-md border border-control-border px-2 py-1 text-size-meta text-secondary hover:bg-surface-subtle">Add Alias</LibraryButton>
                        {tag.is_temporary && (
                          <LibraryButton type="button" onClick={() => void handlePromoteTemporary(tag)} className="rounded-md border border-warning/25 px-2 py-1 text-size-meta text-warning hover:bg-warning-subtle">Promote</LibraryButton>
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

      <div data-testid="library-page" className={`h-full flex bg-surface-subtle ${isResizingSidebar ? 'select-none' : ''}`}>
        <aside
          data-testid="library-format-filters"
          className="library-format-sidebar relative shrink-0 border-r border-border bg-surface"
          style={{ width: `${sidebarWidth}px` }}
        >
          <Input
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Search your collection..."
            data-testid="library-sidebar-search"
            aria-label="Search your collection"
            className="library-search-input mb-4 text-foreground placeholder:text-muted focus:border-focus focus:outline-none focus:ring-2 focus:ring-action/15"
          />
          <h2 className="mb-2 text-size-meta font-semibold uppercase tracking-[0.14em] text-muted">Formats</h2>
          <div className="space-y-1">
            {typeSummaries.map((item) => {
              const active = typeFilter === item.key;
              return (
                <LibraryButton
                  key={item.key}
                  type="button"
                  onClick={() => setTypeFilter(item.key)}
                  data-testid={`format-filter-${item.key}`}
                  aria-label={`Filter by ${item.label}`}
                  aria-pressed={active}
                  className={`library-filter-button ${
                    active ? 'bg-heading text-on-action' : 'text-navigation hover:bg-surface-hover'
                  }`}
                >
                  <span>{item.label}</span>
                  <span className={active ? 'text-surface-subtle' : 'text-muted'}>{item.count}</span>
                </LibraryButton>
              );
            })}
          </div>

          <div data-testid="library-browse-filters" data-surface="filter-section" className="library-filter-section">
            <h2 className="mb-2 text-size-meta font-semibold uppercase tracking-[0.14em] text-muted">Browse</h2>
            <div className="space-y-1">
              <LibraryButton
                type="button"
                onClick={() => setCategoryFilter(FAVORITES_CATEGORY)}
                className={`library-filter-button ${
                  categoryFilter === FAVORITES_CATEGORY ? 'bg-action-subtle text-action-text' : 'text-navigation hover:bg-surface-hover'
                }`}
              >
                <span>Favorite</span>
                <span className={categoryFilter === FAVORITES_CATEGORY ? 'text-action' : 'text-muted'}>{favoriteCount}</span>
              </LibraryButton>
              <LibraryButton
                type="button"
                onClick={() => setCategoryFilter(RECENTS_CATEGORY)}
                className={`library-filter-button ${
                  categoryFilter === RECENTS_CATEGORY ? 'bg-action-subtle text-action-text' : 'text-navigation hover:bg-surface-hover'
                }`}
              >
                <span>Recents</span>
                <span className={categoryFilter === RECENTS_CATEGORY ? 'text-action' : 'text-muted'}>{documents.length}</span>
              </LibraryButton>
              <div className="my-1 h-px bg-border" />
              <LibraryButton
                type="button"
                onClick={() => setCategoryFilter('all')}
                className={`library-filter-button ${
                  categoryFilter === 'all' ? 'bg-action-subtle text-action-text' : 'text-navigation hover:bg-surface-hover'
                }`}
              >
                All
              </LibraryButton>

            </div>
          </div>

          <LibraryButton
            type="button"
            data-testid="library-more-filters-button"
            aria-expanded={showMoreFilters}
            onClick={() => setShowMoreFilters((previous) => !previous)}
            className="library-more-filters-button mt-3 border border-control-border text-secondary hover:bg-surface-subtle"
          >
            <span>More filters</span>
            <span aria-hidden="true">{showMoreFilters ? '−' : '+'}</span>
          </LibraryButton>

          <div data-testid="library-category-filters" data-surface="filter-section" className={`library-filter-section ${showMoreFilters ? '' : 'hidden'}`}>
              <h2 className="mb-2 text-size-meta font-semibold uppercase tracking-[0.14em] text-muted">Categories</h2>
              <div className="space-y-1">
                {quickCategories.map((category) => (
                  <LibraryButton
                    key={category}
                    type="button"
                    onClick={() => setCategoryFilter(category)}
                    className={`library-filter-button truncate ${
                      categoryFilter === category ? 'bg-action-subtle text-action-text' : 'text-secondary hover:bg-surface-hover'
                    }`}
                  >
                    {category}
                  </LibraryButton>
                ))}
              </div>
          </div>

          <div data-testid="library-tag-filters" data-surface="filter-section" className={`library-filter-section ${showMoreFilters ? '' : 'hidden'}`}>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-size-meta font-semibold uppercase tracking-wide text-muted">Tags</h2>
              <span className="text-size-micro text-faint">{tagFacets.length}</span>
            </div>
            <Input
              value={tagSearchText}
              onChange={(event) => setTagSearchText(event.target.value)}
              placeholder="Filter tags..."
              className="mb-2 h-8 w-full rounded-md border border-control-border bg-surface px-2 text-size-caption text-secondary"
            />
            <div className="mb-2 flex rounded-md bg-surface p-1">
              <LibraryButton
                type="button"
                onClick={() => setTagMatchMode('any')}
                className={`flex-1 rounded px-2 py-1 text-size-caption ${tagMatchMode === 'any' ? 'bg-action-subtle text-action-text' : 'text-navigation hover:bg-surface-subtle'}`}
              >
                Any
              </LibraryButton>
              <LibraryButton
                type="button"
                onClick={() => setTagMatchMode('all')}
                className={`flex-1 rounded px-2 py-1 text-size-caption ${tagMatchMode === 'all' ? 'bg-action-subtle text-action-text' : 'text-navigation hover:bg-surface-subtle'}`}
              >
                All
              </LibraryButton>
            </div>
            <div className="max-h-56 space-y-1 overflow-y-auto">
              {filteredTagFacets.length === 0 ? (
                <div className="rounded-md bg-surface px-2.5 py-2 text-size-caption text-muted">No tags</div>
              ) : (
                filteredTagFacets.slice(0, 24).map((facet) => {
                  const active = selectedTagIds.includes(facet.tag_id);
                  return (
                    <LibraryButton
                      key={facet.tag_id}
                      type="button"
                      onClick={() => toggleSelectedTagId(facet.tag_id)}
                      className={`library-filter-button ${
                        active ? 'bg-action-subtle text-action-text' : 'bg-surface text-secondary hover:bg-surface-hover'
                      }`}
                    >
                      <span className="truncate">
                        #{facet.name}
                        {facet.is_temporary && <span className="ml-1 text-size-micro text-warning">temp</span>}
                      </span>
                      <span className={active ? 'text-action' : 'text-muted'}>{facet.count}</span>
                    </LibraryButton>
                  );
                })
              )}
            </div>
            {selectedTagIds.length > 0 && (
              <LibraryButton
                type="button"
                onClick={() => setSelectedTagIds([])}
                className="library-filter-button mt-2 justify-center border border-control-border text-size-caption text-secondary hover:bg-surface-subtle"
              >
                Clear Tag Filter
              </LibraryButton>
            )}
          </div>

          <div
            role="separator"
            aria-label="Resize sidebar"
            className={`absolute right-0 top-0 h-full w-1.5 cursor-col-resize transition-colors ${
              isResizingSidebar ? 'bg-action-subtle/70' : 'bg-transparent hover:bg-action-subtle/60'
            }`}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              beginResize();
            }}
          />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="contents">
            <div className="contents">
              {isAutoClassifying && (
                <span className="shrink-0 text-size-meta text-muted">Indexing...</span>
              )}

              {isTagDataLoading && (
                <span className="shrink-0 text-size-meta text-muted">Tags syncing...</span>
              )}

              <div className="contents">
                {shellMenu === 'display' && (
                  <div
                    ref={displayMenuRef}
                    id="library-display-options-menu"
                    data-testid="library-display-options-menu"
                    role="menu"
                    aria-label="Display options"
                    className="library-menu fixed z-30 mt-2 w-72 overflow-y-auto"
                    style={{ top: shellMenuPosition.top, right: shellMenuPosition.right, maxHeight: `calc(100vh - ${shellMenuPosition.top}px - var(--space-card))` }}
                  >
                    {([
                      ['grid', 'Grid'],
                      ['list', 'List'],
                      ['compact', 'Compact'],
                    ] as const).map(([value, label]) => (
                      <LibraryButton
                        key={value}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setViewMode(value);
                          closeDisplayMenu();
                        }}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-foreground hover:bg-surface-subtle"
                      >
                        <span className="w-4 text-center text-size-title leading-none">{viewMode === value ? '✓' : ''}</span>
                        <span className="text-size-body font-medium leading-6">{label}</span>
                      </LibraryButton>
                    ))}

                    <div className="my-2 h-px bg-surface-hover" />
                    <div className="px-2 py-1 text-size-meta font-semibold text-faint">Sort by...</div>
                    {([
                      ['recent', 'Recent'],
                      ['title', 'Title'],
                      ['type', 'Type'],
                    ] as const).map(([value, label]) => (
                      <LibraryButton
                        key={value}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setSortBy(value);
                          closeDisplayMenu();
                        }}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-foreground hover:bg-surface-subtle"
                      >
                        <span className="w-4 text-center text-size-title leading-none">{sortBy === value ? '✓' : ''}</span>
                        <span className="text-size-body font-medium leading-6">{label}</span>
                      </LibraryButton>
                    ))}

                    <div className="my-2 h-px bg-surface-hover" />
                    <div className="px-2 py-1 text-size-meta font-semibold text-faint">Filter by type...</div>
                    {([
                      ['all', 'All'],
                      ['epub', 'EPUB'],
                    ] as const).map(([value, label]) => (
                      <LibraryButton
                        key={value}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setTypeFilter(value);
                          closeDisplayMenu();
                        }}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-foreground hover:bg-surface-subtle"
                      >
                        <span className="w-4 text-center text-size-title leading-none">{typeFilter === value ? '✓' : ''}</span>
                        <span className="text-size-body font-medium leading-6">{label}</span>
                      </LibraryButton>
                    ))}

                    <div className="my-2 h-px bg-surface-hover" />
                    <div className="px-2 py-1 text-size-meta font-semibold text-faint">Category...</div>
                    <div className="max-h-44 overflow-y-auto">
                      <LibraryButton
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setCategoryFilter(FAVORITES_CATEGORY);
                          closeDisplayMenu();
                        }}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-foreground hover:bg-surface-subtle"
                      >
                        <span className="w-4 text-center text-size-title leading-none">{categoryFilter === FAVORITES_CATEGORY ? '✓' : ''}</span>
                        <span className="text-size-body font-medium leading-6">Favorite</span>
                      </LibraryButton>
                      <LibraryButton
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setCategoryFilter(RECENTS_CATEGORY);
                          closeDisplayMenu();
                        }}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-foreground hover:bg-surface-subtle"
                      >
                        <span className="w-4 text-center text-size-title leading-none">{categoryFilter === RECENTS_CATEGORY ? '✓' : ''}</span>
                        <span className="text-size-body font-medium leading-6">Recents</span>
                      </LibraryButton>
                      <div className="my-1 h-px bg-surface-hover" />
                      <LibraryButton
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setCategoryFilter('all');
                          closeDisplayMenu();
                        }}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-foreground hover:bg-surface-subtle"
                      >
                        <span className="w-4 text-center text-size-title leading-none">{categoryFilter === 'all' ? '✓' : ''}</span>
                        <span className="text-size-body font-medium leading-6">All</span>
                      </LibraryButton>
                      {regularCategoryOptions.map((category) => (
                        <LibraryButton
                          key={category}
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setCategoryFilter(category);
                            closeDisplayMenu();
                          }}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-foreground hover:bg-surface-subtle"
                        >
                          <span className="w-4 text-center text-size-title leading-none">{categoryFilter === category ? '✓' : ''}</span>
                          <span className="truncate text-size-body font-medium leading-6">{category}</span>
                        </LibraryButton>
                      ))}
                    </div>

                    <div className="my-2 h-px bg-surface-hover" />
                    <LibraryButton
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setGroupByCategory((prev) => !prev);
                        closeDisplayMenu();
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-foreground hover:bg-surface-subtle"
                    >
                      <span className="w-4 text-center text-size-title leading-none">{shouldGroupDisplayedDocuments ? '✓' : ''}</span>
                      <span className="text-size-body font-medium leading-6">Group by category</span>
                    </LibraryButton>
                  </div>
                )}
              </div>

              {shellMenu === 'more' && (
                <div
                  ref={moreMenuRef}
                  id="library-more-actions-menu"
                  data-testid="library-more-actions-menu"
                  role="menu"
                  aria-label="More Library actions"
                  className="library-menu fixed z-30 mt-2 w-48"
                  style={{ top: shellMenuPosition.top, right: shellMenuPosition.right }}
                >
                  <LibraryButton
                    role="menuitem"
                    onClick={() => {
                      closeMoreMenu();
                      setShowBatchDialog(true);
                    }}
                    data-testid="batch-tags-button"
                    className="flex w-full rounded-md px-2 py-1.5 text-left text-size-body font-medium text-foreground hover:bg-surface-subtle"
                  >
                    Batch Tags
                  </LibraryButton>
                  <LibraryButton
                    role="menuitem"
                    onClick={() => {
                      closeMoreMenu();
                      setShowTagManager(true);
                    }}
                    data-testid="tag-library-button"
                    className="flex w-full rounded-md px-2 py-1.5 text-left text-size-body font-medium text-foreground hover:bg-surface-subtle"
                  >
                    Tag Library
                  </LibraryButton>
                </div>
              )}

          </div>
        </div>

      {/* Documents Grid */}
      <div data-testid="library-document-list" className="flex-1 overflow-y-auto p-4">
        {continueDocument && (
          <section data-testid="continue-reading" className="home-continue-reading mb-5">
            <div className="home-section-label">Continue reading</div>
            <div className="home-continue-card">
              <div className="min-w-0">
                <h2 className="truncate text-size-title font-semibold text-heading">{continueDocument.title}</h2>
                {continueDocument.author && <p className="mt-1 truncate text-size-caption text-muted">{continueDocument.author}</p>}
              </div>
              <LibraryButton
                type="button"
                onClick={() => selectDocument(continueDocument.id)}
                className="home-continue-action shrink-0 bg-action text-size-caption font-medium text-on-action hover:bg-action-text"
              >
                Continue
              </LibraryButton>
            </div>
          </section>
        )}
        {documents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mb-4 text-faint" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            <p className="text-size-title">No documents yet</p>
            <p className="text-size-subheading mt-2">Import an EPUB file to get started</p>
          </div>
        ) : displayedDocuments.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted">
            <p className="text-size-body">No documents match current filters</p>
            <p className="text-size-subheading mt-2">Try clearing search text, tag filters, or switching type/category filters</p>
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
              <section key={category} data-testid="library-category-group">
                <div className="mb-2 flex items-center justify-between">
                  <LibraryButton
                    onClick={() => toggleCategoryCollapsed(category)}
                    className="inline-flex items-center gap-2 text-size-subheading font-semibold text-foreground hover:text-heading"
                  >
                    <span className={`text-size-caption transition-transform ${isCollapsed ? '-rotate-90' : ''}`}>▾</span>
                    <span>{category}</span>
                  </LibraryButton>
                  <span className="text-size-caption text-muted">{items.length} docs</span>
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
                    <LibraryButton
                      onClick={() => toggleCategoryExpandedItems(category)}
                      className="text-size-caption text-action hover:text-action underline"
                    >
                      {showAllItems ? 'Show less' : `Show more (${items.length - DEFAULT_CATEGORY_VISIBLE_COUNT})`}
                    </LibraryButton>
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
        <div className="h-7 border-t border-border bg-surface px-3 text-size-meta text-navigation flex items-center overflow-x-auto whitespace-nowrap">
          {statusBar}
        </div>
      )}
        </div>
    </div>
    </>
  );
};
