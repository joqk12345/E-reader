import { Library } from './components/Library';
import { Reader } from './components/Reader';
import { SemanticSearchHome } from './components/SemanticSearchHome';
import { Settings } from './components/Settings';
import { useStore } from './store/useStore';
import { useCallback, useEffect, useRef, useState } from 'react';
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
import { Tabs } from './components/ui/Tabs';
import { Button } from './components/ui/Button';
import type { SettingsSection } from './components/settings/settingsTypes';
import { useAppTheme } from './features/app/useAppTheme';

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
    loadConfig,
    readerFontSize,
    persistReaderFontSize,
    keymap,
  } = useStore();
  const [showSettings, setShowSettings] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('reading');
  const [homeView, setHomeView] = useState<HomeView>('library');
  const autoIndexingKeysRef = useRef<Set<string>>(new Set());
  const [runtimeConfig, setRuntimeConfig] = useState<Config | null>(null);
  const [embeddingStatus, setEmbeddingStatus] = useState<EmbeddingStatus | null>(null);

  const openSettings = useCallback((section: SettingsSection = 'reading') => {
    setSettingsSection(section);
    setShowSettings(true);
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

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
        window.dispatchEvent(new CustomEvent('reader:toggle-header-tools'));
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
            <Reader />
          ) : (
            <div className="flex h-full min-h-0 flex-col">
              <header className="flex h-[58px] shrink-0 items-center justify-between border-b border-border bg-surface px-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-action text-size-subheading font-semibold text-on-action shadow-sm">R</div>
                  <div className="leading-none">
                    <div className="font-serif text-size-title font-medium tracking-tight text-heading">Reader</div>
                    <div className="mt-1 text-size-micro font-medium uppercase tracking-[0.16em] text-muted">Your reading desk</div>
                  </div>
                </div>

                <nav aria-label="Workspace">
                  <Tabs
                    items={[{ value: 'library', label: 'Library' }, { value: 'semantic-search', label: 'Semantic Search' }]}
                    value={homeView}
                    onChange={setHomeView}
                  />
                </nav>

                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => openSettings('reading')}
                  className="h-8 rounded-full px-3 text-size-control hover:border-focus-border hover:text-action-text"
                >
                  <span aria-hidden="true">⚙</span>
                  Preferences
                </Button>
              </header>

              <div className="flex-1 min-h-0">
                {homeView === 'library' ? (
                  <Library statusBar={runtimeStatusBar} />
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
