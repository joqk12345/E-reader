import React, { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../store/useStore';
import {
  embedQuery,
  getEmbeddingStatus,
  indexDocumentWithLocalEmbedding,
  type EmbeddingProfile,
  type EmbeddingStatus,
} from '../services/embeddingIndex';
import { localEmbeddingEngine } from '../services/localEmbedding';

interface SearchResult {
  paragraph_id: string;
  snippet: string;
  score: number;
  location: string;
}

interface ParagraphContext {
  paragraph_id: string;
  doc_id: string;
  section_id: string;
}

interface Config {
  embedding_provider?: 'local_transformers' | 'lmstudio' | 'openai_compatible' | 'ollama';
  embedding_model?: string;
  embedding_dimension?: number;
  embedding_auto_reindex?: boolean;
  embedding_local_model_path?: string;
}

interface DownloadEmbeddingModelResponse {
  model: string;
  target_dir: string;
  files: string[];
}

interface LocalModelValidationResponse {
  valid: boolean;
  checked_path: string;
  missing_files: string[];
}

type SearchMode = 'semantic-local' | 'keyword-fallback';
const SEARCH_TIMEOUT_MS = 20_000;

export const SearchPanel: React.FC = () => {
  const isZh = (typeof navigator !== 'undefined' ? navigator.language : 'en').toLowerCase().startsWith('zh');
  const t = {
    noModelsLoaded: isZh
      ? 'LM Studio 未加载 embedding 模型。请先在 LM Studio 加载 embedding 模型，并在设置中填写对应的 Embedding Model 名称。'
      : 'No embedding model is loaded in LM Studio. Please load one and set the Embedding Model in Settings.',
    lmStudioUnavailable: isZh
      ? 'LM Studio 服务未开启或模型未加载。请先启动 LM Studio 并加载模型。'
      : 'LM Studio is unavailable or model not loaded. Please start LM Studio and load a model.',
    htmlModelError: isZh
      ? '本地 embedding 模型下载返回了 HTML（通常是代理拦截）。请在 Settings 中设置 Embedding Download Base URL（如 https://hf-mirror.com）后重试。'
      : 'Local embedding model download returned HTML (usually proxy interception). Set Embedding Download Base URL (e.g. https://hf-mirror.com) in Settings and retry.',
    searchFailed: isZh ? '搜索失败' : 'Search failed',
    searchTimeout: isZh ? '搜索超时，请重试或缩短关键词范围。' : 'Search timed out. Please retry or narrow your query.',
    modeSemantic: isZh ? '语义检索（本地）' : 'Semantic (Local)',
    modeKeyword: isZh ? '关键词回退' : 'Keyword Fallback',
    statusUnavailable: isZh ? '状态不可用' : 'Status unavailable',
    loadingModel: isZh ? '模型加载中...' : 'Loading model...',
    reindexing: isZh ? '重建索引中...' : 'Reindexing...',
    rebuildIndex: isZh ? '重建索引' : 'Rebuild Index',
    searching: isZh ? '搜索中...' : 'Searching...',
    search: isZh ? '搜索' : 'Search',
    noResultHint: isZh
      ? '无结果。请尝试重建索引或更换查询词。'
      : 'No results. Try rebuilding the index or using a different query.',
    enterQueryHint: isZh ? '输入关键词开始搜索' : 'Enter a query to search',
    modelHint: isZh
      ? '检测到本地模型不可用。可一键切换到默认模型并触发下载。'
      : 'Local model is unavailable. You can switch to the default model and trigger download.',
    useDefaultAndDownload: isZh
      ? '使用 Xenova/all-MiniLM-L6-v2 并下载'
      : 'Use Xenova/all-MiniLM-L6-v2 and Download',
    downloadingModel: isZh ? '模型下载中...' : 'Downloading model...',
    modelInitDone: isZh
      ? '模型已开始下载/初始化。下载完成后请重新点击 Search 或 Rebuild Index。'
      : 'Model download/initialization started. Click Search or Rebuild Index again after it completes.',
    modelLocalReady: isZh
      ? '模型已下载到本地目录并启用。'
      : 'Model has been downloaded and enabled from local path.',
    localPathInvalid: isZh
      ? '本地模型目录缺少必要文件，请重新下载模型或修正 Local Model Path。'
      : 'Local model directory is missing required files. Please redownload model or fix Local Model Path.',
    cannotLocateParagraph: isZh ? '无法在数据库中定位该段落。' : 'Unable to locate this paragraph in database.',
    searchPlaceholder: isZh ? '输入你的查询内容...' : 'Enter your search query...',
    resultsLabel: isZh ? '结果数:' : 'Results:',
  };
  const {
    documents,
    selectedDocumentId,
    currentDocumentType,
    selectDocument,
    loadSections,
    selectSection,
    loadParagraphs,
    loadDocumentParagraphs,
    setFocusedParagraphId,
    setSearchHighlight,
    clearSearchHighlight,
  } = useStore();
  const [query, setQuery] = useState('');
  const [topK, setTopK] = useState(10);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isIndexing, setIsIndexing] = useState(false);
  const [searchMode, setSearchMode] = useState<SearchMode>('semantic-local');
  const [embeddingStatus, setEmbeddingStatus] = useState<EmbeddingStatus | null>(null);
  const [indexProgress, setIndexProgress] = useState<{ phase: string; done: number; total: number } | null>(null);
  const [showModelDownloadHint, setShowModelDownloadHint] = useState(false);
  const [isDownloadingModel, setIsDownloadingModel] = useState(false);
  const queryInputRef = useRef<HTMLTextAreaElement | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
    let timer: number | null = null;
    const timeoutPromise = new Promise<T>((_, reject) => {
      timer = window.setTimeout(() => {
        reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)} seconds`));
      }, timeoutMs);
    });
    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    }
  };

  const getFriendlyError = (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    const normalized = message.toLowerCase();
    if (normalized.includes('timed out')) {
      return t.searchTimeout;
    }
    if (normalized.includes('no models loaded')) {
      return t.noModelsLoaded;
    }
    if (
      normalized.includes('502') ||
      normalized.includes('bad gateway') ||
      normalized.includes('connection refused') ||
      normalized.includes('econnrefused') ||
      normalized.includes('failed to send request')
    ) {
      return t.lmStudioUnavailable;
    }
    if (
      normalized.includes("unrecognized token '<'") ||
      normalized.includes('unexpected token <')
    ) {
      setShowModelDownloadHint(true);
      return t.htmlModelError;
    }
    if (
      normalized.includes('local model is unavailable') ||
      normalized.includes('local model path') ||
      normalized.includes('failed to download https://huggingface.co') ||
      normalized.includes('failed to download')
    ) {
      setShowModelDownloadHint(true);
      return message || t.modelHint;
    }
    return message || t.searchFailed;
  };

  const loadConfig = async (): Promise<Config> => {
    return invoke<Config>('get_config');
  };

  const validateLocalModelPath = async (path?: string): Promise<void> => {
    const raw = (path || '').trim();
    if (!raw) return;
    const result = await invoke<LocalModelValidationResponse>('validate_local_embedding_model_path', {
      path: raw,
    });
    if (!result.valid) {
      setShowModelDownloadHint(true);
      throw new Error(`${t.localPathInvalid} (${result.checked_path}) missing: ${result.missing_files.join(', ')}`);
    }
  };

  const getCurrentProfile = async (): Promise<EmbeddingProfile> => {
    const config = await loadConfig();
    return {
      provider: config.embedding_provider || 'local_transformers',
      model: config.embedding_model || 'Xenova/all-MiniLM-L6-v2',
      dimension: config.embedding_dimension || 384,
    };
  };

  const refreshStatus = async () => {
    try {
      const status = await getEmbeddingStatus(selectedDocumentId || undefined);
      setEmbeddingStatus(status);
    } catch (e) {
      console.warn('Failed to refresh embedding status:', e);
    }
  };

  useEffect(() => {
    void refreshStatus();
  }, [selectedDocumentId]);

  useEffect(() => {
    const onFocusSearch = () => {
      window.setTimeout(() => {
        queryInputRef.current?.focus();
      }, 40);
    };
    window.addEventListener('reader:focus-search', onFocusSearch as EventListener);
    return () => window.removeEventListener('reader:focus-search', onFocusSearch as EventListener);
  }, []);

  const runKeywordFallbackSearch = async () => {
    setSearchMode('keyword-fallback');
    const fallbackResults = await withTimeout(
      invoke<SearchResult[]>('search', {
        options: {
          query,
          top_k: topK,
          doc_id: selectedDocumentId || undefined,
          force_keyword: true,
        },
      }),
      SEARCH_TIMEOUT_MS,
      'Keyword search'
    );
    setResults(fallbackResults);
    setSearchHighlight(
      query.trim(),
      fallbackResults.map((item) => item.paragraph_id)
    );
  };

  const handleSearch = async () => {
    if (!query.trim()) return;

    setIsSearching(true);
    setError(null);
    setShowModelDownloadHint(false);
    try {
      const config = await loadConfig();
      const provider = config.embedding_provider || 'local_transformers';
      if (provider === 'local_transformers') {
        await validateLocalModelPath(config.embedding_local_model_path);
        const profile = await getCurrentProfile();
        const vector = await withTimeout(
          embedQuery(query, profile, config.embedding_local_model_path),
          SEARCH_TIMEOUT_MS,
          'Embedding query'
        );
        const semanticResults = await withTimeout(
          invoke<SearchResult[]>('search_by_embedding', {
            request: {
              query_vector: vector,
              top_k: topK,
              doc_id: selectedDocumentId || undefined,
              query_text: query,
            },
          }),
          SEARCH_TIMEOUT_MS,
          'Semantic search'
        );
        setSearchMode('semantic-local');
        setResults(semanticResults);
        setSearchHighlight(
          query.trim(),
          semanticResults.map((item) => item.paragraph_id)
        );
      } else {
        await runKeywordFallbackSearch();
      }
    } catch (err) {
      console.error('Search failed, fallback to keyword mode:', err);
      try {
        await runKeywordFallbackSearch();
      } catch (fallbackErr) {
        console.error('Fallback search failed:', fallbackErr);
        setError(getFriendlyError(fallbackErr));
        setResults([]);
        clearSearchHighlight();
      }
    } finally {
      setIsSearching(false);
      void refreshStatus();
    }
  };

  const handleIndexDocument = async () => {
    if (!selectedDocumentId) return;
    setIsIndexing(true);
    setError(null);
    setShowModelDownloadHint(false);
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      const profile = await getCurrentProfile();
      const config = await loadConfig();
      await validateLocalModelPath(config.embedding_local_model_path);
      await indexDocumentWithLocalEmbedding(selectedDocumentId, profile, {
        signal: abort.signal,
        localModelPath: config.embedding_local_model_path,
        onProgress: (progress) => setIndexProgress(progress),
      });
      setIndexProgress(null);
      await refreshStatus();
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      console.error('Index failed:', err);
      setError(getFriendlyError(err));
    } finally {
      setIsIndexing(false);
    }
  };

  const handleUseDefaultModelAndDownload = async () => {
    try {
      setIsDownloadingModel(true);
      setError(null);
      const currentConfig = await invoke<Record<string, unknown>>('get_config');
      const download = await invoke<DownloadEmbeddingModelResponse>('download_embedding_model_files', {
        request: { model: 'Xenova/all-MiniLM-L6-v2' },
      });
      const nextConfig = {
        ...currentConfig,
        embedding_provider: 'local_transformers',
        embedding_model: 'Xenova/all-MiniLM-L6-v2',
        embedding_dimension: 384,
        embedding_local_model_path: download.target_dir,
      };
      await invoke('update_config', { config: nextConfig });
      await validateLocalModelPath(download.target_dir);
      await localEmbeddingEngine.init('Xenova/all-MiniLM-L6-v2', download.target_dir);
      setShowModelDownloadHint(false);
      setError(`${t.modelLocalReady} ${download.target_dir}`);
    } catch (err) {
      console.error('Failed to initialize local model:', err);
      setError(getFriendlyError(err));
    } finally {
      setIsDownloadingModel(false);
    }
  };

  const handleResultClick = async (result: SearchResult) => {
    try {
      const context = await invoke<ParagraphContext | null>('get_paragraph_context', {
        paragraphId: result.paragraph_id,
      });
      if (!context) {
        setError(t.cannotLocateParagraph);
        return;
      }
      const targetDocType = documents.find((doc) => doc.id === context.doc_id)?.file_type;
      const markdownTarget = targetDocType === 'markdown' || currentDocumentType === 'markdown';

      if (selectedDocumentId !== context.doc_id) {
        selectDocument(context.doc_id);
        await loadSections(context.doc_id);
        if (markdownTarget) {
          await loadDocumentParagraphs(context.doc_id);
        }
      }
      selectSection(context.section_id);
      if (!markdownTarget) {
        await loadParagraphs(context.section_id);
      }
      setFocusedParagraphId(context.paragraph_id);
    } catch (err) {
      console.error('Jump to search result failed:', err);
      setError(getFriendlyError(err));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSearch();
    }
  };

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const statusText = embeddingStatus
    ? isZh
      ? `${embeddingStatus.indexed}/${embeddingStatus.total} 已索引${embeddingStatus.stale > 0 ? `，${embeddingStatus.stale} 需重建` : ''}`
      : `${embeddingStatus.indexed}/${embeddingStatus.total} indexed${embeddingStatus.stale > 0 ? `, ${embeddingStatus.stale} stale` : ''}`
    : t.statusUnavailable;

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-gray-200">
        <textarea
          ref={queryInputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t.searchPlaceholder}
          className="w-full p-3 border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
          rows={3}
        />

        <div className="mt-3 flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <span>{t.resultsLabel}</span>
            <select
              value={topK}
              onChange={(e) => setTopK(Number(e.target.value))}
              className="border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
            </select>
          </label>

          {selectedDocumentId && (
            <button
              onClick={() => void handleIndexDocument()}
              disabled={isIndexing}
              className="px-3 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:bg-gray-200 transition-colors"
            >
              {isIndexing ? t.reindexing : t.rebuildIndex}
            </button>
          )}

          <button
            onClick={() => void handleSearch()}
            disabled={isSearching || !query.trim()}
            className="ml-auto px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
          >
            {isSearching ? t.searching : t.search}
          </button>
        </div>

        <div className="mt-3 text-xs text-gray-600 space-y-1">
          <p>Mode: {searchMode === 'semantic-local' ? t.modeSemantic : t.modeKeyword}</p>
          <p>{statusText}</p>
          {indexProgress && (
            <p>
              {indexProgress.phase === 'loading_model'
                ? t.loadingModel
                : `${indexProgress.phase}: ${indexProgress.done}/${indexProgress.total}`}
            </p>
          )}
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border-b border-red-200">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {showModelDownloadHint && (
        <div className="p-4 bg-amber-50 border-b border-amber-200 space-y-2">
          <p className="text-sm text-amber-700">
            {t.modelHint}
          </p>
          <button
            onClick={() => void handleUseDefaultModelAndDownload()}
            disabled={isDownloadingModel}
            className="px-3 py-2 text-sm bg-amber-600 text-white rounded hover:bg-amber-700 disabled:bg-amber-300"
          >
            {isDownloadingModel ? t.downloadingModel : t.useDefaultAndDownload}
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4">
        {results.length === 0 && !error && !isSearching && (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mb-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <p className="text-sm">
              {query.trim()
                ? t.noResultHint
                : t.enterQueryHint}
            </p>
          </div>
        )}

        <div className="space-y-3">
          {results.map((result, idx) => (
            <div
              key={result.paragraph_id}
              className="p-3 bg-white border border-gray-200 rounded-lg hover:shadow-md hover:border-blue-300 transition-shadow cursor-pointer"
              onClick={() => void handleResultClick(result)}
            >
              <div className="flex items-start justify-between mb-2">
                <span className="text-xs text-gray-500 font-mono">
                  #{idx + 1} • {result.location}
                </span>
                <span className="text-xs text-blue-600 font-semibold">
                  {(result.score * 100).toFixed(1)}%
                </span>
              </div>
              <p className="text-sm text-gray-800 leading-relaxed">
                {result.snippet}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
