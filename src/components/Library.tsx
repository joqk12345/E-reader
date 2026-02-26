import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../store/useStore';
import { DocumentCard } from './DocumentCard';
import type { Document as ReaderDocument } from '../types';

type LibraryProps = {
  statusBar?: React.ReactNode;
};

type DocumentPreview = {
  doc_id: string;
  preview: string;
};

type DocumentInsight = {
  category: string;
  tags: string[];
};

const FAVORITES_CATEGORY = 'Favorites';
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

const TAG_RULES: Array<{ tag: string; keywords: string[] }> = [
  { tag: 'LLM', keywords: ['llm', '大模型', 'gpt', 'qwen', 'vllm'] },
  { tag: 'RAG', keywords: ['rag', 'retrieval', '检索增强'] },
  { tag: 'Agent', keywords: ['agent', '智能体'] },
  { tag: 'Rust', keywords: ['rust', 'cargo', 'tauri'] },
  { tag: 'Python', keywords: ['python', 'pandas', 'numpy'] },
  { tag: 'Web', keywords: ['react', 'frontend', 'browser', 'web'] },
  { tag: '数据库', keywords: ['sqlite', 'database', 'postgres', 'mysql', '向量库'] },
  { tag: '性能', keywords: ['performance', 'benchmark', 'latency', '优化', '吞吐'] },
  { tag: '产品', keywords: ['product', '用户', '增长', '体验'] },
  { tag: '投资', keywords: ['investment', 'stock', '基金', '投资'] },
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

  const tags = TAG_RULES
    .filter((rule) => rule.keywords.some((keyword) => corpus.includes(keyword)))
    .map((rule) => rule.tag);

  const fileTypeTag = doc.file_type.toUpperCase();
  if (!tags.includes(fileTypeTag)) {
    tags.push(fileTypeTag);
  }

  return {
    category: bestCategory,
    tags: tags.slice(0, 5),
  };
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

  const getDocumentCategory = (docId: string) => {
    if (favoriteDocumentIds[docId]) {
      return FAVORITES_CATEGORY;
    }
    return documentInsights[docId]?.category || '其他';
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
    } catch (error) {
      console.error('Delete failed:', error);
      alert('Failed to delete document');
    }
  };

  const handleUnifiedImport = () => {
    setShowImportDialog(true);
  };

  const displayedDocuments = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    const filtered = documents.filter((doc) => {
      const docType = normalizeFileType(doc.file_type);
      if (typeFilter !== 'all' && docType !== typeFilter) return false;
      if (categoryFilter !== 'all' && getDocumentCategory(doc.id) !== categoryFilter) {
        return false;
      }
      if (!q) return true;
      const title = doc.title.toLowerCase();
      const author = (doc.author || '').toLowerCase();
      const filePath = doc.file_path.toLowerCase();
      return title.includes(q) || author.includes(q) || filePath.includes(q);
    });

    const sorted = [...filtered];
    if (sortBy === 'recent') {
      sorted.sort((a, b) => b.updated_at - a.updated_at);
    } else if (sortBy === 'title') {
      sorted.sort((a, b) => a.title.localeCompare(b.title));
    } else {
      sorted.sort((a, b) => normalizeFileType(a.file_type).localeCompare(normalizeFileType(b.file_type)) || a.title.localeCompare(b.title));
    }
    return sorted;
  }, [categoryFilter, documents, favoriteDocumentIds, searchText, sortBy, typeFilter, documentInsights]);

  const categoryOptions = useMemo(() => {
    const categories = new Set<string>();
    documents.forEach((doc) => categories.add(getDocumentCategory(doc.id)));
    return Array.from(categories).sort((a, b) => a.localeCompare(b));
  }, [documents, favoriteDocumentIds, documentInsights]);

  const regularCategoryOptions = useMemo(
    () => categoryOptions.filter((category) => category !== FAVORITES_CATEGORY),
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
                      <span className="w-4 text-center text-[18px] leading-none">{groupByCategory ? '✓' : ''}</span>
                      <span className="text-base font-medium leading-6">Group by category</span>
                    </button>
                  </div>
                )}
              </div>

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
            <p className="text-sm mt-2">Try clearing search text or switching type filter</p>
          </div>
        ) : groupByCategory ? (
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
                        category={getDocumentCategory(doc.id)}
                        tags={documentInsights[doc.id]?.tags || []}
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
                        category={getDocumentCategory(doc.id)}
                        tags={documentInsights[doc.id]?.tags || []}
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
                category={getDocumentCategory(doc.id)}
                tags={documentInsights[doc.id]?.tags || []}
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
                category={getDocumentCategory(doc.id)}
                tags={documentInsights[doc.id]?.tags || []}
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
