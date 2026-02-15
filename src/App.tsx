import { Library } from './components/Library';
import { Reader } from './components/Reader';
import { Settings } from './components/Settings';
import { useStore } from './store/useStore';
import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getEmbeddingStatus, indexDocumentWithLocalEmbedding, type EmbeddingProfile } from './services/embeddingIndex';
import { matchesAnyShortcut } from './utils/shortcuts';

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
  if (status === 'ok') return 'text-emerald-700';
  if (status === 'warn') return 'text-amber-700';
  return 'text-rose-700';
};

function App() {
  const {
    selectedDocumentId,
    loadConfig,
    readerFontSize,
    persistReaderFontSize,
    keymap,
  } = useStore();
  const [showSettings, setShowSettings] = useState(false);
  const [settingsSection, setSettingsSection] = useState<'reading' | 'translation' | 'ai' | 'audio' | 'shortcuts'>('reading');
  const autoIndexingKeysRef = useRef<Set<string>>(new Set());
  const [runtimeConfig, setRuntimeConfig] = useState<Config | null>(null);
  const [embeddingStatus, setEmbeddingStatus] = useState<EmbeddingStatus | null>(null);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

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
        if ((config.embedding_provider || 'local_transformers') !== 'local_transformers') return;

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
        await indexDocumentWithLocalEmbedding(selectedDocumentId, profile, {
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
    const onKeyDown = async (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      if (matchesAnyShortcut(event, keymap.open_settings)) {
        event.preventDefault();
        setSettingsSection('reading');
        setShowSettings(true);
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
    persistReaderFontSize,
    readerFontSize,
    selectedDocumentId,
  ]);

  return (
    <>
      {showSettings && (
        <Settings
          initialSection={settingsSection}
          onClose={() => setShowSettings(false)}
        />
      )}

      <div className="h-screen w-screen bg-gray-50 flex flex-col">
        <div className="flex-1 min-h-0">
          {selectedDocumentId ? (
            <Reader
              onOpenSettings={() => {
                setSettingsSection('reading');
                setShowSettings(true);
              }}
            />
          ) : (
          <Library
            onOpenSettings={() => {
              setSettingsSection('reading');
              setShowSettings(true);
            }}
            statusBar={
              <div className="flex items-center gap-4">
                <span className="font-semibold text-gray-700">Runtime</span>
                <span>
                  Chat: <span className="text-gray-800">{runtimeConfig?.chat_model || 'N/A'}</span> ·{' '}
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
                  Embedding: <span className="text-gray-800">{runtimeConfig?.embedding_model || 'N/A'}</span> ·{' '}
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
                  Index: <span className="text-gray-800">{embeddingStatus ? `${embeddingStatus.indexed}/${embeddingStatus.total}` : 'N/A'}</span>
                </span>
                <span>
                  TTS: <span className="text-gray-800">
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
            }
          />
        )}
        </div>
      </div>
    </>
  );
}

export default App;
