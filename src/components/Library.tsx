import React, { useEffect, useMemo, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { useStore } from '../store/useStore';
import { DocumentCard } from './DocumentCard';

type LibraryProps = {
  onOpenSettings?: () => void;
};

export const Library: React.FC<LibraryProps> = ({ onOpenSettings }) => {
  const { documents, isLoading, loadDocuments, importEpub, importPdf, importMarkdown, deleteDocument, selectDocument } = useStore();
  const [viewMode, setViewMode] = useState<'grid' | 'list' | 'compact'>('grid');
  const [typeFilter, setTypeFilter] = useState<'all' | 'epub' | 'pdf' | 'markdown'>('all');
  const [sortBy, setSortBy] = useState<'recent' | 'title' | 'type'>('recent');
  const [searchText, setSearchText] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [isImportingUrl, setIsImportingUrl] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null);

  const normalizeUrl = (input: string) => {
    const trimmed = input.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
    return `https://${trimmed}`;
  };

  const extractPublishedTime = (doc: Document): string | undefined => {
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
      if (typeFilter !== 'all' && doc.file_type !== typeFilter) return false;
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
      sorted.sort((a, b) => a.file_type.localeCompare(b.file_type) || a.title.localeCompare(b.title));
    }
    return sorted;
  }, [documents, searchText, sortBy, typeFilter]);

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

      <div className="h-full flex flex-col bg-gray-50">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-gray-900">Library</h1>
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
                    className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    onClick={() => void handleImportUrl()}
                    disabled={isImportingUrl || !urlInput.trim()}
                    className="h-10 px-4 text-sm bg-gray-800 text-white rounded-md hover:bg-gray-900 disabled:bg-gray-400 transition-colors"
                  >
                    {isImportingUrl ? 'Importing...' : 'Import URL'}
                  </button>
                </div>
                <button
                  onClick={handleImport}
                  disabled={isLoading}
                  className="h-10 px-4 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
                >
                  {isLoading ? 'Importing...' : 'Import Document'}
                </button>
              </div>
              <button
                onClick={onOpenSettings}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                ⚙️ Settings
              </button>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Filter by title, author, or path..."
              className="w-72 max-w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />

            <div className="inline-flex rounded-md border border-gray-300 overflow-hidden">
              {(['grid', 'list', 'compact'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`px-2.5 py-1.5 text-xs capitalize ${
                    viewMode === mode ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>

            <div className="inline-flex rounded-md border border-gray-300 overflow-hidden">
              {(['all', 'epub', 'pdf', 'markdown'] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setTypeFilter(type)}
                  className={`px-2.5 py-1.5 text-xs uppercase ${
                    typeFilter === type ? 'bg-gray-800 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'recent' | 'title' | 'type')}
              className="ml-auto px-2.5 py-1.5 text-xs border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
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
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {displayedDocuments.map((doc) => (
              <DocumentCard
                key={doc.id}
                document={doc}
                variant="grid"
                onClick={() => selectDocument(doc.id)}
                onDelete={() => handleDeleteRequest(doc.id, doc.title)}
              />
            ))}
          </div>
        ) : (
          <div className={viewMode === 'list' ? 'space-y-3' : 'space-y-2'}>
            {displayedDocuments.map((doc) => (
              <DocumentCard
                key={doc.id}
                document={doc}
                variant={viewMode}
                onClick={() => selectDocument(doc.id)}
                onDelete={() => handleDeleteRequest(doc.id, doc.title)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
    </>
  );
};
