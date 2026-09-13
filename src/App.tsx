import { Library } from './components/Library';
import { Reader } from './components/Reader';
import { SemanticSearchHome } from './components/SemanticSearchHome';
import { DocumentViewer } from './components/DocumentViewer';
import { Settings } from './components/Settings';
import { useStore } from './store/useStore';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getVersion } from '@tauri-apps/api/app';
import { getEmbeddingStatus, indexDocumentWithConfiguredEmbedding, type EmbeddingProfile } from './services/embeddingIndex';
import {
  checkForUpdates,
  getErrorMessage,
  isAutoUpdateEnabled,
  loadCachedUpdateResult,
  saveUpdateResult,
  UPDATE_CHECK_INTERVAL_MS,
  type UpdateTarget,
} from './services/updater';
import { matchesAnyShortcut } from './utils/shortcuts';
import { Button } from './components/ui/Button';
import type { SettingsSection } from './components/settings/settingsTypes';
import { useAppTheme } from './features/app/useAppTheme';
import { ensurePublicationImportedV2 } from './features/reader/locator/publicationBlocks';

const MIN_FONT_SIZE = 14;
const MAX_FONT_SIZE = 28;
type Config = {
  provider?: 'lmstudio' | 'openai';
  lm_studio_url?: string;
  chat_model?: string;
  openai_api_key?: string;
  openai_base_url?: string;
  embedding_provider?: 'local_transformers' | 'lmstudio' | 'openai_compatible' | 'ollama';
  embedding_model?: string;
  embedding_dimension?: number;
  embedding_auto_reindex?: boolean;
  embedding_ollama_url?: string;
  embedding_local_model_path?: string;
  tts_provider?: 'auto' | 'edge' | 'cosyvoice';
  edge_tts_voice?: string;
  cosyvoice_base_url?: string;
};

type EmbeddingStatus = {
  indexed: number;
  total: number;
  stale: number;
};

type HomeView = 'library' | 'semantic-search';
type LibraryShellMenu = 'display' | 'more' | null;

// Foliate is the default EPUB boundary; set VITE_EPUB_ENGINE=legacy only for emergency rollback.
const FOLIATE_EPUB_SPIKE_ENABLED = import.meta.env.VITE_EPUB_ENGINE !== 'legacy';
const FoliateEpubSpikeReader = lazy(async () => {
  const module = await import('./features/reader/foliate/FoliateEpubSpikeReader');
  return { default: module.FoliateEpubSpikeReader };
});

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  return target.isContentEditable;
};

const normalizeEndpointMode = (url?: string): 'local' | 'http' => {
  const raw = (url || '').trim().toLowerCase();
  if (!raw) return 'local';
  if (raw.includes('localhost') || raw.includes('127.0.0.1') || raw.includes('0.0.0.0')) return 'local';
  return 'http';
};

const statusToneClass = (status: string): string => {
  if (status === 'ok') return 'text-success';
  if (status === 'warn') return 'text-warning';
  return 'text-danger';
};

function App() {
  useAppTheme();
  const {
    selectedDocumentId,
    currentDocumentType,
    documents,
    goBack,
    loadPublicationBlocks,
    loadConfig,
    readerFontSize,
    persistReaderFontSize,
    keymap,
  } = useStore();
  const [showSettings, setShowSettings] = useState(false);
  const [showWorkspaceMenu, setShowWorkspaceMenu] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('reading');
  const [homeView, setHomeView] = useState<HomeView>('library');
  const [libraryShellMenu, setLibraryShellMenu] = useState<LibraryShellMenu>(null);
  const [libraryShellMenuPosition, setLibraryShellMenuPosition] = useState({ top: 0, right: 0 });
  const [libraryImportRequestId, setLibraryImportRequestId] = useState(0);
  const autoIndexingKeysRef = useRef<Set<string>>(new Set());
  const [runtimeConfig, setRuntimeConfig] = useState<Config | null>(null);
  const [embeddingStatus, setEmbeddingStatus] = useState<EmbeddingStatus | null>(null);
  const selectedDocument = documents.find((document) => document.id === selectedDocumentId) || null;

  const openSettings = useCallback((section: SettingsSection = 'reading') => {
    setSettingsSection(section);
    setShowSettings(true);
  }, []);
  const closeLibraryShellMenu = useCallback(() => setLibraryShellMenu(null), []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    window.addEventListener('resize', closeLibraryShellMenu);
    return () => window.removeEventListener('resize', closeLibraryShellMenu);
  }, [closeLibraryShellMenu]);

  useEffect(() => {
    setLibraryShellMenu(null);
  }, [homeView, showSettings, selectedDocumentId]);

  useEffect(() => {
    if (!selectedDocumentId || currentDocumentType !== 'epub') return;
    let cancelled = false;
    const preparePublication = async () => {
      try {
        await ensurePublicationImportedV2(selectedDocumentId);
        if (!cancelled) await loadPublicationBlocks(selectedDocumentId);
      } catch (error) {
        if (!cancelled) console.error('Failed to prepare EPUB publication:', error);
      }
    };
    void preparePublication();
    return () => {
      cancelled = true;
    };
  }, [currentDocumentType, loadPublicationBlocks, selectedDocumentId]);

  useEffect(() => {
    let cancelled = false;
    const runAutomaticUpdateCheck = async () => {
      try {
        if (!isAutoUpdateEnabled()) return;

        const now = Date.now();
        const cached = loadCachedUpdateResult();

        if (cached && now - cached.checkedAt < UPDATE_CHECK_INTERVAL_MS) {
          return;
        }

        const currentVersion = await getVersion();
        const target = await invoke<UpdateTarget>('get_update_target');
        const result = await checkForUpdates(currentVersion, target);
        if (cancelled) return;

        saveUpdateResult(result);
      } catch (error) {
        console.warn('Automatic update check failed:', getErrorMessage(error));
      }
    };

    void runAutomaticUpdateCheck();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refreshRuntimeStatus = async () => {
      try {
        const config = await invoke<Config>('get_config');
        if (cancelled) return;
        setRuntimeConfig(config);
        try {
          const status = await invoke<EmbeddingStatus>('get_embedding_profile_status', { docId: null });
          if (!cancelled) setEmbeddingStatus(status);
        } catch {
          if (!cancelled) setEmbeddingStatus(null);
        }
      } catch {
        if (!cancelled) {
          setRuntimeConfig(null);
          setEmbeddingStatus(null);
        }
      }
    };

    void refreshRuntimeStatus();
    const timer = window.setInterval(() => {
      void refreshRuntimeStatus();
    }, 15000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!selectedDocumentId) return;
    const runAutoIndexForCurrentDocument = async () => {
      let key = '';
      try {
        const config = await invoke<Config>('get_config');
        if (!config.embedding_auto_reindex) return;

        const profile: EmbeddingProfile = {
          provider: config.embedding_provider || 'local_transformers',
          model: config.embedding_model || 'Xenova/all-MiniLM-L6-v2',
          dimension: config.embedding_dimension || 384,
        };
        key = [
          selectedDocumentId,
          profile.provider,
          profile.model,
          profile.dimension,
          config.embedding_local_model_path || '',
        ].join('|');
        if (autoIndexingKeysRef.current.has(key)) return;

        const status = await getEmbeddingStatus(selectedDocumentId);
        if (status.stale === 0 && status.indexed >= status.total) return;

        autoIndexingKeysRef.current.add(key);
        await indexDocumentWithConfiguredEmbedding(selectedDocumentId, profile, {
          localModelPath: config.embedding_local_model_path,
        });
      } catch (error) {
        console.warn('Auto indexing current document skipped:', error);
        if (key) {
          autoIndexingKeysRef.current.delete(key);
        }
      }
    };
    void runAutoIndexForCurrentDocument();
  }, [selectedDocumentId]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let unlistenAbout: (() => void) | null = null;
    let unlistenInstallCli: (() => void) | null = null;
    const setupMenuEvents = async () => {
      try {
        unlisten = await listen('reader://open-settings', () => {
          openSettings('reading');
        });
        unlistenAbout = await listen('reader://open-settings-about', () => {
          openSettings('about');
        });
        unlistenInstallCli = await listen<{
          ok?: boolean;
          error?: string;
          result?: { message?: string; installed_path?: string; profile_file?: string | null };
        }>('reader://cli-shell-command-installed', (event) => {
          const payload = event.payload || {};
          if (payload.ok) {
            const message =
              payload.result?.message ||
              (payload.result?.installed_path
                ? `Installed at ${payload.result.installed_path}`
                : 'reader-cli installed');
            alert(message);
          } else {
            alert(`Install reader-cli failed: ${payload.error || 'Unknown error'}`);
          }
        });
      } catch (error) {
        console.warn('Failed to listen for menu events:', error);
      }
    };
    void setupMenuEvents();

    return () => {
      if (unlisten) unlisten();
      if (unlistenAbout) unlistenAbout();
      if (unlistenInstallCli) unlistenInstallCli();
    };
  }, [openSettings]);

  useEffect(() => {
    const onKeyDown = async (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      if (matchesAnyShortcut(event, keymap.open_settings)) {
        event.preventDefault();
        openSettings('reading');
        return;
      }
      if (matchesAnyShortcut(event, keymap.font_increase)) {
        event.preventDefault();
        const nextSize = Math.min(MAX_FONT_SIZE, readerFontSize + 1);
        if (nextSize !== readerFontSize) {
          await persistReaderFontSize(nextSize);
        }
        return;
      }
      if (matchesAnyShortcut(event, keymap.font_decrease)) {
        event.preventDefault();
        const nextSize = Math.max(MIN_FONT_SIZE, readerFontSize - 1);
        if (nextSize !== readerFontSize) {
          await persistReaderFontSize(nextSize);
        }
        return;
      }
      if (matchesAnyShortcut(event, keymap.font_reset)) {
        event.preventDefault();
        await persistReaderFontSize(18);
        return;
      }
      if (matchesAnyShortcut(event, keymap.toggle_window_maximize)) {
        event.preventDefault();
        try {
          const appWindow = getCurrentWindow();
          const maximized = await appWindow.isMaximized();
          if (maximized) {
            await appWindow.unmaximize();
          } else {
            await appWindow.maximize();
          }
        } catch (windowError) {
          console.error('Failed to toggle maximize:', windowError);
        }
        return;
      }
      if (selectedDocumentId && matchesAnyShortcut(event, keymap.toggle_header_tools)) {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent('reader:toggle-view-menu'));
      }
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [
    keymap,
    openSettings,
    persistReaderFontSize,
    readerFontSize,
    selectedDocumentId,
  ]);

  const runtimeStatusBar = (
    <div className="flex items-center gap-4">
      <span className="font-semibold text-secondary">Runtime</span>
      <span>
        Chat: <span className="text-foreground">{runtimeConfig?.chat_model || 'N/A'}</span> ·{' '}
        <span className="uppercase">{runtimeConfig?.provider === 'openai' ? 'http' : normalizeEndpointMode(runtimeConfig?.lm_studio_url)}</span> ·{' '}
        <span className={statusToneClass(
          runtimeConfig?.provider === 'openai'
            ? (runtimeConfig?.openai_api_key ? 'ok' : 'warn')
            : (runtimeConfig?.chat_model ? 'ok' : 'warn')
        )}>
          {runtimeConfig?.provider === 'openai'
            ? (runtimeConfig?.openai_api_key ? 'ok' : 'missing key')
            : (runtimeConfig?.chat_model ? 'ok' : 'not set')}
        </span>
      </span>
      <span>
        Embedding: <span className="text-foreground">{runtimeConfig?.embedding_model || 'N/A'}</span> ·{' '}
        <span className="uppercase">{runtimeConfig?.embedding_provider === 'local_transformers'
          ? 'local'
          : runtimeConfig?.embedding_provider === 'ollama'
            ? normalizeEndpointMode(runtimeConfig?.embedding_ollama_url)
            : runtimeConfig?.embedding_provider === 'lmstudio'
              ? normalizeEndpointMode(runtimeConfig?.lm_studio_url)
              : normalizeEndpointMode(runtimeConfig?.openai_base_url)}</span> ·{' '}
        <span className={statusToneClass(
          embeddingStatus ? (embeddingStatus.stale > 0 ? 'warn' : 'ok') : 'warn'
        )}>
          {embeddingStatus ? (embeddingStatus.stale > 0 ? 'stale' : 'ok') : 'unknown'}
        </span>
      </span>
      <span>
        Index: <span className="text-foreground">{embeddingStatus ? `${embeddingStatus.indexed}/${embeddingStatus.total}` : 'N/A'}</span>
      </span>
      <span>
        TTS: <span className="text-foreground">
          {runtimeConfig?.tts_provider === 'cosyvoice'
            ? 'CosyVoice'
            : runtimeConfig?.edge_tts_voice || 'Edge TTS'}
        </span> ·{' '}
        <span className="uppercase">
          {runtimeConfig?.tts_provider === 'cosyvoice'
            ? normalizeEndpointMode(runtimeConfig?.cosyvoice_base_url)
            : 'http'}
        </span> ·{' '}
        <span className={statusToneClass(
          runtimeConfig?.tts_provider === 'cosyvoice'
            ? (runtimeConfig?.cosyvoice_base_url ? 'ok' : 'warn')
            : 'ok'
        )}>
          {runtimeConfig?.tts_provider === 'cosyvoice'
            ? (runtimeConfig?.cosyvoice_base_url ? 'ok' : 'missing url')
            : 'ok'}
        </span>
      </span>
    </div>
  );

  return (
    <>
      {showSettings && (
        <Settings
          initialSection={settingsSection}
          onClose={() => setShowSettings(false)}
        />
      )}

      <div className="flex h-screen w-screen flex-col bg-surface-subtle text-foreground">
        <div className="flex-1 min-h-0">
          {selectedDocumentId ? (
            <DocumentViewer documentType={currentDocumentType} document={selectedDocument} onBack={goBack}>
              {FOLIATE_EPUB_SPIKE_ENABLED && currentDocumentType === 'epub' ? (
                <Suspense fallback={<div className="grid h-full place-items-center text-size-subheading text-secondary">Loading foliate-js spike…</div>}>
                  <FoliateEpubSpikeReader />
                </Suspense>
              ) : (
                <Reader />
              )}
            </DocumentViewer>
          ) : (
            <div className="flex h-full min-h-0 flex-col">
              <header className="reader-home-header relative flex shrink-0 items-center justify-between border-b border-border bg-surface px-4">
                <div className="home-brand-mark" aria-label="Reader">R</div>
                {homeView === 'library' ? (
                  <div data-testid="app-library-identity" className="ml-3 flex items-baseline gap-2">
                    <h1 data-testid="workspace-page-title" className="font-serif text-size-heading font-medium tracking-tight text-heading">Library</h1>
                    <span className="text-size-meta text-muted">{documents.length} documents</span>
                  </div>
                ) : (
                  <h1 data-testid="workspace-page-title" className="pointer-events-none absolute left-1/2 -translate-x-1/2 font-serif text-size-heading font-medium tracking-tight text-heading">
                    Semantic Search
                  </h1>
                )}

                <div className="relative ml-auto flex items-center gap-2">
                  {homeView === 'library' && (
                    <>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        id="app-library-display-options-button"
                        data-testid="app-library-display-options-button"
                        aria-label="Display options"
                        aria-controls="library-display-options-menu"
                        aria-expanded={libraryShellMenu === 'display'}
                        onClick={(event) => {
                          const rect = event.currentTarget.getBoundingClientRect();
                          setLibraryShellMenuPosition({ top: rect.bottom, right: window.innerWidth - rect.right });
                          setLibraryShellMenu((current) => current === 'display' ? null : 'display');
                        }}
                      >
                        ⋯
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        id="app-library-more-actions-button"
                        data-testid="app-library-more-actions-button"
                        aria-label="More Library actions"
                        aria-controls="library-more-actions-menu"
                        aria-expanded={libraryShellMenu === 'more'}
                        onClick={(event) => {
                          const rect = event.currentTarget.getBoundingClientRect();
                          setLibraryShellMenuPosition({ top: rect.bottom, right: window.innerWidth - rect.right });
                          setLibraryShellMenu((current) => current === 'more' ? null : 'more');
                        }}
                      >
                        More
                      </Button>
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        data-testid="app-library-import-button"
                        onClick={() => setLibraryImportRequestId((current) => current + 1)}
                      >
                        Import
                      </Button>
                    </>
                  )}
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    data-testid="workspace-select"
                    aria-label="Workspace"
                    aria-expanded={showWorkspaceMenu}
                    onClick={() => setShowWorkspaceMenu((previous) => !previous)}
                    className="home-workspace-button hover:border-focus-border hover:text-action-text"
                  >
                    {homeView === 'library' ? 'Library' : 'Semantic Search'}
                    <span aria-hidden="true">⌄</span>
                  </Button>
                  {showWorkspaceMenu && (
                    <div role="menu" aria-label="Workspace" className="absolute right-0 top-10 z-30 min-w-40 rounded-lg border border-border bg-surface p-1 shadow-panel">
                      {(['library', 'semantic-search'] as const).map((view) => (
                        <Button
                          key={view}
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setHomeView(view);
                            setShowWorkspaceMenu(false);
                          }}
                          className={`w-full rounded-md px-2 py-1.5 text-left text-size-caption ${homeView === view ? 'bg-action-subtle text-action-text' : 'text-secondary hover:bg-surface-subtle'}`}
                        >
                          {view === 'library' ? 'Library' : 'Semantic Search'}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>

                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => openSettings('reading')}
                  data-testid="preferences-button"
                  aria-label="Open Preferences"
                  className="home-preferences hover:border-focus-border hover:text-action-text"
                >
                  <span aria-hidden="true">⚙</span>
                  Preferences
                </Button>
              </header>

              <div data-testid="workspace-content" className="flex-1 min-h-0">
                {homeView === 'library' ? (
                  <Library
                    statusBar={runtimeStatusBar}
                    shellMenu={libraryShellMenu}
                    shellMenuPosition={libraryShellMenuPosition}
                    importRequestId={libraryImportRequestId}
                    onCloseShellMenu={closeLibraryShellMenu}
                  />
                ) : (
                  <SemanticSearchHome statusBar={runtimeStatusBar} />
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default App;
