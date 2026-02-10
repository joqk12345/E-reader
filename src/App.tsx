import { Library } from './components/Library';
import { Reader } from './components/Reader';
import { Settings } from './components/Settings';
import { useStore } from './store/useStore';
import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getEmbeddingStatus, indexDocumentWithLocalEmbedding, type EmbeddingProfile } from './services/embeddingIndex';
import { matchesAnyShortcut } from './utils/shortcuts';

const MENU_EVENT_NAME = 'reader-menu-action';
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
    readerBackgroundColor,
    persistTranslationMode,
    persistReaderFontSize,
    persistReaderBackgroundColor,
    keymap,
  } = useStore();
  const [customThemeOpen, setCustomThemeOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [customThemeValue, setCustomThemeValue] = useState('#F4F8EE');
  const [customThemeError, setCustomThemeError] = useState<string | null>(null);
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
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      if (!matchesAnyShortcut(event, keymap.open_settings)) return;
      event.preventDefault();
      setShowSettings(true);
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [keymap.open_settings]);

  useEffect(() => {
    let isMounted = true;

    const register = async () => {
      const unlisten = await listen<string>(MENU_EVENT_NAME, async (event) => {
        if (!isMounted) return;
        try {
          switch (event.payload) {
            case 'font_increase': {
              const nextSize = Math.min(MAX_FONT_SIZE, readerFontSize + 1);
              if (nextSize !== readerFontSize) {
                await persistReaderFontSize(nextSize);
              }
              break;
            }
            case 'font_decrease': {
              const nextSize = Math.max(MIN_FONT_SIZE, readerFontSize - 1);
              if (nextSize !== readerFontSize) {
                await persistReaderFontSize(nextSize);
              }
              break;
            }
            case 'font_reset':
              await persistReaderFontSize(18);
              break;
            case 'theme_green':
              await persistReaderBackgroundColor('#F4F8EE');
              break;
            case 'theme_paper':
              await persistReaderBackgroundColor('#F6F1E6');
              break;
            case 'theme_gray':
              await persistReaderBackgroundColor('#EEF1F4');
              break;
            case 'theme_warm':
              await persistReaderBackgroundColor('#FAF2E8');
              break;
            case 'translation_off':
              await persistTranslationMode('off');
              break;
            case 'translation_en_zh':
              await persistTranslationMode('en-zh');
              break;
            case 'translation_zh_en':
              await persistTranslationMode('zh-en');
              break;
            case 'theme_custom': {
              setCustomThemeValue(readerBackgroundColor || '#F4F8EE');
              setCustomThemeError(null);
              setCustomThemeOpen(true);
              break;
            }
            case 'open_settings':
              setShowSettings(true);
              break;
            case 'window_toggle_maximize': {
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
              break;
            }
            case 'toggle_header_tools':
              window.dispatchEvent(new CustomEvent('reader:toggle-header-tools'));
              break;
            case 'next_page':
              window.dispatchEvent(new CustomEvent('reader:next-page'));
              break;
            case 'prev_page':
              window.dispatchEvent(new CustomEvent('reader:prev-page'));
              break;
            default:
              break;
          }
        } catch (error) {
          console.error('Failed to apply menu action:', error);
        }
      });

      return unlisten;
    };

    const unlistenPromise = register();
    return () => {
      isMounted = false;
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [
    persistReaderBackgroundColor,
    persistReaderFontSize,
    persistTranslationMode,
    readerBackgroundColor,
    readerFontSize,
  ]);

  const safeCustomThemeValue = /^#[0-9A-Fa-f]{6}$/.test(customThemeValue)
    ? customThemeValue
    : '#F4F8EE';

  const applyCustomTheme = async () => {
    const value = customThemeValue.trim();
    if (!/^#[0-9A-Fa-f]{6}$/.test(value)) {
      setCustomThemeError('Invalid color. Use #RRGGBB format.');
      return;
    }

    setCustomThemeError(null);
    await persistReaderBackgroundColor(value);
    setCustomThemeOpen(false);
  };

  return (
    <>
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}

      <div className="h-screen w-screen bg-gray-50">
        {selectedDocumentId ? (
          <Reader onOpenSettings={() => setShowSettings(true)} />
        ) : (
          <Library onOpenSettings={() => setShowSettings(true)} />
        )}
      </div>

      {customThemeOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-40 z-50 flex items-center justify-center">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm mx-4 p-5">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Custom Theme</h3>
            <div className="flex items-center gap-3 mb-3">
              <input
                type="color"
                value={safeCustomThemeValue}
                onChange={(e) => setCustomThemeValue(e.target.value)}
                className="h-10 w-14 p-1 border border-gray-300 rounded-md bg-white"
              />
              <input
                type="text"
                value={customThemeValue}
                onChange={(e) => setCustomThemeValue(e.target.value)}
                placeholder="#F4F8EE"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {customThemeError && <p className="text-xs text-red-600 mb-3">{customThemeError}</p>}

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setCustomThemeOpen(false)}
                className="px-3 py-2 text-sm text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={() => void applyCustomTheme()}
                className="px-3 py-2 text-sm text-white bg-blue-600 rounded-md hover:bg-blue-700"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default App;
