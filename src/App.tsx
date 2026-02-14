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
  embedding_provider?: 'local_transformers' | 'lmstudio' | 'openai_compatible' | 'ollama';
  embedding_model?: string;
  embedding_dimension?: number;
  embedding_auto_reindex?: boolean;
  embedding_local_model_path?: string;
};

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  return target.isContentEditable;
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

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

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

      <div className="h-screen w-screen bg-gray-50">
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
          />
        )}
      </div>
    </>
  );
}

export default App;
