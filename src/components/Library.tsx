import React, { useEffect, useMemo, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { useStore } from '../store/useStore';
import { DocumentCard } from './DocumentCard';
import type { Document as ReaderDocument } from '../types';

type LibraryProps = {
  onOpenSettings?: () => void;
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

export const Library: React.FC<LibraryProps> = ({ onOpenSettings, statusBar }) => {
  const DEFAULT_CATEGORY_VISIBLE_COUNT = 8;
  const DEFAULT_EXPANDED_CATEGORY_COUNT = 2;
  const { documents, isLoading, loadDocuments, importEpub, importPdf, importMarkdown, deleteDocument, selectDocument } = useStore();
  const [viewMode, setViewMode] = useState<'grid' | 'list' | 'compact'>('grid');
  const [typeFilter, setTypeFilter] = useState<'all' | 'epub' | 'pdf' | 'markdown'>('all');
  const [sortBy, setSortBy] = useState<'recent' | 'title' | 'type'>('recent');
  const [searchText, setSearchText] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [groupByCategory, setGroupByCategory] = useState(true);
  const [urlInput, setUrlInput] = useState('');
  const [isImportingUrl, setIsImportingUrl] = useState(false);
  const [isAutoClassifying, setIsAutoClassifying] = useState(false);
  const [documentInsights, setDocumentInsights] = useState<Record<string, DocumentInsight>>({});
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});
  const [expandedCategoryItems, setExpandedCategoryItems] = useState<Record<string, boolean>>({});
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(248);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const normalizeUrl = (input: string) => {
    const trimmed = input.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
    return `https://${trimmed}`;
  };

  const extractPublishedTime = (doc: globalThis.Document): string | undefined => {
    const selectors = [
      'meta[property="article:published_time"]',
      'meta[name="article:published_time"]',
      'meta[name="publish_date"]',
      'meta[property="og:published_time"]',
      'time[datetime]',
    ];
    for (const selector of selectors) {
      const el = doc.querySelector(selector);
      if (!el) continue;
      const content = el.getAttribute('content') || el.getAttribute('datetime') || el.textContent;
      const value = content?.trim();
      if (value) return value;
    }
    return undefined;
  };

  const normalizeText = (text: string) =>
    text
      .split('\n')
      .map((line) => line.trimEnd())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

  const htmlToMarkdown = (html: string): string => {
    const service = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      emDelimiter: '_',
      bulletListMarker: '-',
      linkStyle: 'inlined',
    });
    service.use(gfm);

    service.addRule('iframe-to-link', {
      filter: 'iframe',
      replacement: (_content, node) => {
        const src = (node as HTMLElement).getAttribute('src')?.trim();
        if (!src) return '';
        return `\n[Embedded media](${src})\n`;
      },
    });

    service.addRule('video-to-link', {
      filter: 'video',
      replacement: (_content, node) => {
        const src =
          (node as HTMLElement).getAttribute('src')?.trim() ||
          (node as HTMLElement).querySelector('source')?.getAttribute('src')?.trim();
        if (!src) return '';
        return `\n[Video](${src})\n`;
      },
    });

    const markdown = service.turndown(html || '');
    return normalizeText(markdown);
  };

  const extractMediaLinks = (contentDoc: Document): string[] => {
    const links = new Set<string>();
    contentDoc
      .querySelectorAll('img[src], video[src], source[src], a[href]')
      .forEach((el) => {
        const attr = el.getAttribute('src') || el.getAttribute('href');
        if (!attr) return;
        const url = attr.trim();
        if (!url.startsWith('http://') && !url.startsWith('https://')) return;
        const lower = url.toLowerCase();
        const isMedia =
          lower.endsWith('.png') ||
          lower.endsWith('.jpg') ||
          lower.endsWith('.jpeg') ||
          lower.endsWith('.gif') ||
          lower.endsWith('.webp') ||
          lower.endsWith('.svg') ||
          lower.endsWith('.mp4') ||
          lower.endsWith('.mov') ||
          lower.includes('youtube.com/watch') ||
          lower.includes('youtu.be/') ||
          lower.includes('vimeo.com/');
        if (isMedia) links.add(url);
      });
    return [...links].slice(0, 20);
  };

  const buildMarkdownFromArticle = (
    sourceUrl: string,
    byline: string | undefined,
    published: string | undefined,
    excerpt: string | undefined,
    contentHtml: string,
    textContent: string,
    mediaLinks: string[]
  ) => {
    const summary =
      excerpt?.trim() ||
      textContent
        .split('\n')
        .map((s) => s.trim())
        .find((s) => s.length > 40) ||
      '_No summary extracted._';
    const mediaBlock =
      mediaLinks.length > 0
        ? mediaLinks.map((link) => `- ${link}`).join('\n')
        : '_No key image/video links detected._';
    const markdownBody = htmlToMarkdown(contentHtml);
    const contentBlock = markdownBody || normalizeText(textContent);

    return [
      `> Source: ${sourceUrl}`,
      `> Author: ${byline?.trim() || 'Unknown'}`,
      `> Published: ${published?.trim() || 'Unknown'}`,
      '',
      '## Summary',
      '',
      summary,
      '',
      '## Media Links',
      '',
      mediaBlock,
      '',
      '## Content',
      '',
      contentBlock,
    ].join('\n');
  };

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  useEffect(() => {
    if (documents.length === 0) {
      setDocumentInsights({});
      return;
    }

    let cancelled = false;
    setIsAutoClassifying(true);
    invoke<DocumentPreview[]>('get_document_previews', {
      docIds: documents.map((doc) => doc.id),
      maxChars: 1200,
    })
      .then((rows) => {
        if (cancelled) return;
        const previewMap = rows.reduce<Record<string, string>>((acc, item) => {
          acc[item.doc_id] = item.preview || '';
          return acc;
        }, {});
        const next = documents.reduce<Record<string, DocumentInsight>>((acc, doc) => {
          acc[doc.id] = inferDocumentInsight(doc, previewMap[doc.id] || '');
          return acc;
        }, {});
        setDocumentInsights(next);
      })
      .catch((error) => {
        console.warn('Auto classify fallback to title-only mode:', error);
        if (cancelled) return;
        const next = documents.reduce<Record<string, DocumentInsight>>((acc, doc) => {
          acc[doc.id] = inferDocumentInsight(doc, '');
          return acc;
        }, {});
        setDocumentInsights(next);
      })
      .finally(() => {
        if (!cancelled) {
          setIsAutoClassifying(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [documents]);

  const handleImport = async () => {
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
        } else if (ext === 'pdf') {
          await importPdf(selected);
        } else if (ext === 'md') {
          await importMarkdown(selected);
        }
      }
    } catch (error) {
      console.error('Import failed:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      alert(`Failed to import document: ${errorMessage}`);
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

  const handleImportUrl = async () => {
    const url = normalizeUrl(urlInput);
    if (!url) return;
    setIsImportingUrl(true);
    try {
      let docId = '';
      try {
        const html = await invoke<string>('fetch_url_html', { url });
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const article = new Readability(doc, { keepClasses: false }).parse();

        if (!article || !article.textContent || article.textContent.trim().length < 120) {
          throw new Error('Readability extracted empty or too-short article');
        }

        const contentDoc = parser.parseFromString(article.content || '', 'text/html');
        const markdownBody = buildMarkdownFromArticle(
          url,
          article.byline || undefined,
          extractPublishedTime(doc),
          article.excerpt || undefined,
          article.content || '',
          article.textContent || '',
          extractMediaLinks(contentDoc)
        );

        docId = await invoke<string>('import_markdown_content', {
          title: article.title || 'Imported Article',
          sourceUrl: url,
          content: markdownBody,
        });
      } catch (readabilityError) {
        console.warn('Readability import failed, fallback to jina reader:', readabilityError);
        docId = await invoke<string>('import_url', { url });
      }
      await loadDocuments();
      selectDocument(docId);
      setUrlInput('');
    } catch (error) {
      console.error('Import URL failed:', error);
      const message = error instanceof Error ? error.message : String(error);
      alert(`Failed to import URL: ${message}`);
    } finally {
      setIsImportingUrl(false);
    }
  };

  const displayedDocuments = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    const filtered = documents.filter((doc) => {
      const docType = normalizeFileType(doc.file_type);
      if (typeFilter !== 'all' && docType !== typeFilter) return false;
      if (categoryFilter !== 'all' && (documentInsights[doc.id]?.category || '其他') !== categoryFilter) {
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
  }, [categoryFilter, documentInsights, documents, searchText, sortBy, typeFilter]);

  const searchableDocuments = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return documents.filter((doc) => {
      if (categoryFilter !== 'all' && (documentInsights[doc.id]?.category || '其他') !== categoryFilter) {
        return false;
      }
      if (!q) return true;
      const title = doc.title.toLowerCase();
      const author = (doc.author || '').toLowerCase();
      const filePath = doc.file_path.toLowerCase();
      return title.includes(q) || author.includes(q) || filePath.includes(q);
    });
  }, [categoryFilter, documentInsights, documents, searchText]);

  const categoryOptions = useMemo(() => {
    const categories = new Set<string>();
    documents.forEach((doc) => categories.add(documentInsights[doc.id]?.category || '其他'));
    return Array.from(categories).sort((a, b) => a.localeCompare(b));
  }, [documentInsights, documents]);

  const groupedEntries = useMemo(() => {
    const grouped = displayedDocuments.reduce<Record<string, ReaderDocument[]>>((acc, doc) => {
      const category = documentInsights[doc.id]?.category || '其他';
      if (!acc[category]) acc[category] = [];
      acc[category].push(doc);
      return acc;
    }, {});

    return Object.entries(grouped).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  }, [displayedDocuments, documentInsights]);

  const typeSummaries = useMemo(() => {
    const markdownCount = searchableDocuments.filter((doc) => normalizeFileType(doc.file_type) === 'markdown').length;
    const pdfCount = searchableDocuments.filter((doc) => normalizeFileType(doc.file_type) === 'pdf').length;
    const epubCount = searchableDocuments.filter((doc) => normalizeFileType(doc.file_type) === 'epub').length;
    return [
      { key: 'all' as const, label: 'All', count: searchableDocuments.length, hint: 'All formats' },
      { key: 'markdown' as const, label: 'Markdown', count: markdownCount, hint: 'Notes & articles' },
      { key: 'pdf' as const, label: 'PDF', count: pdfCount, hint: 'Documents' },
      { key: 'epub' as const, label: 'EPUB', count: epubCount, hint: 'Books' },
    ];
  }, [searchableDocuments]);

  const toggleCategoryCollapsed = (category: string) => {
    setCollapsedCategories((prev) => ({ ...prev, [category]: !(prev[category] ?? false) }));
  };

  const toggleCategoryExpandedItems = (category: string) => {
    setExpandedCategoryItems((prev) => ({ ...prev, [category]: !(prev[category] ?? false) }));
  };

  useEffect(() => {
    if (!isResizingSidebar) return;

    const handleMove = (event: PointerEvent) => {
      const next = Math.min(360, Math.max(200, event.clientX));
      setSidebarWidth(next);
    };
    const handleUp = () => setIsResizingSidebar(false);

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
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

      <div className="h-full flex bg-gray-50">
        <aside
          className="relative shrink-0 border-r border-gray-200 bg-[#f4f5f7] p-2.5"
          style={{ width: sidebarCollapsed ? '42px' : `${sidebarWidth}px` }}
        >
          {sidebarCollapsed ? (
            <button
              onClick={() => setSidebarCollapsed((prev) => !prev)}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-gray-300 bg-white text-xs text-gray-700 hover:bg-gray-100"
              title="Expand sidebar"
              aria-label="Expand sidebar"
            >
              ›
            </button>
          ) : (
            <>
              <div className="mb-2 flex items-center gap-2">
                <button
                  onClick={() => setSidebarCollapsed((prev) => !prev)}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-gray-300 bg-white text-xs text-gray-700 hover:bg-gray-100"
                  title="Collapse sidebar"
                  aria-label="Collapse sidebar"
                >
                  ‹
                </button>
                <div className="flex-1 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 shadow-sm">
                <input
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="Search library..."
                  className="w-full bg-transparent text-xs text-gray-800 placeholder:text-gray-400 focus:outline-none"
                />
              </div>
              </div>

              <div className="mt-4">
                <h3 className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Formats</h3>
                <div className="space-y-1">
                  {typeSummaries.map((item) => {
                    const active = typeFilter === item.key;
                    return (
                      <button
                        key={item.key}
                        onClick={() => setTypeFilter(item.key)}
                        className={`w-full rounded-lg px-2.5 py-1.5 text-left transition-colors ${
                          active ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-200/70'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium">{item.label}</span>
                          <span className={`text-[11px] ${active ? 'text-gray-200' : 'text-gray-500'}`}>{item.count}</span>
                        </div>
                        <p className={`mt-0.5 text-[10px] ${active ? 'text-gray-300' : 'text-gray-500'}`}>{item.hint}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-4 rounded-lg border border-gray-200 bg-white px-2.5 py-2">
                <p className="text-[11px] uppercase tracking-wide text-gray-500">Summary</p>
                <p className="mt-0.5 text-xl font-semibold text-gray-900">{documents.length}</p>
                <p className="text-[11px] text-gray-500">Total documents</p>
              </div>
            </>
          )}

          {!sidebarCollapsed && (
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
          )}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-5 py-3">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold text-gray-900">Library</h1>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 w-[420px] max-w-[42vw]">
                  <input
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void handleImportUrl();
                      }
                    }}
                    placeholder="Paste article URL..."
                    className="flex-1 px-2.5 py-1.5 text-xs border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    onClick={() => void handleImportUrl()}
                    disabled={isImportingUrl || !urlInput.trim()}
                    className="h-8 px-3 text-xs bg-gray-800 text-white rounded-md hover:bg-gray-900 disabled:bg-gray-400 transition-colors"
                  >
                    {isImportingUrl ? 'Importing...' : 'Import URL'}
                  </button>
                </div>
                <button
                  onClick={handleImport}
                  disabled={isLoading}
                  className="h-8 px-3 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
                >
                  {isLoading ? 'Importing...' : 'Import Document'}
                </button>
              </div>
              <button
                onClick={onOpenSettings}
                className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
              >
                ⚙️ Settings
              </button>
            </div>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <div className="inline-flex rounded-md border border-gray-300 overflow-hidden">
              {(['grid', 'list', 'compact'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`px-2 py-1 text-xs capitalize ${
                    viewMode === mode ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>

            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-2 py-1 text-xs border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">Category: All</option>
              {categoryOptions.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>

            <button
              onClick={() => setGroupByCategory((prev) => !prev)}
              className={`px-2 py-1 text-xs rounded-md border ${
                groupByCategory
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              {groupByCategory ? 'Grouped' : 'Ungrouped'}
            </button>

            {isAutoClassifying && (
              <span className="text-xs text-gray-500">Auto-tagging...</span>
            )}

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'recent' | 'title' | 'type')}
              className="ml-auto px-2 py-1 text-xs border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="recent">Sort: Recent</option>
              <option value="title">Sort: Title</option>
              <option value="type">Sort: Type</option>
            </select>
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
                        category={documentInsights[doc.id]?.category}
                        tags={documentInsights[doc.id]?.tags || []}
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
                        category={documentInsights[doc.id]?.category}
                        tags={documentInsights[doc.id]?.tags || []}
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
                category={documentInsights[doc.id]?.category}
                tags={documentInsights[doc.id]?.tags || []}
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
                category={documentInsights[doc.id]?.category}
                tags={documentInsights[doc.id]?.tags || []}
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
