import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../store/useStore';
import {
  formatShortcutListInput,
  normalizeKeymap,
  parseShortcutListInput,
  type Keymap,
} from '../utils/shortcuts';

type AiProvider = 'lmstudio' | 'openai';
type EmbeddingProvider = 'local_transformers' | 'lmstudio' | 'openai_compatible' | 'ollama';

interface Config {
  provider: AiProvider;
  lm_studio_url: string;
  embedding_provider: EmbeddingProvider;
  embedding_model: string;
  embedding_dimension: number;
  embedding_auto_reindex: boolean;
  embedding_ollama_url?: string;
  embedding_ollama_model?: string;
  embedding_local_model_path?: string;
  embedding_download_base_url?: string;
  chat_model: string;
  openai_api_key?: string;
  openai_base_url?: string;
  tts_provider: 'auto' | 'edge' | 'cosyvoice';
  edge_tts_voice: string;
  edge_tts_proxy?: string;
  cosyvoice_base_url?: string;
  cosyvoice_api_key?: string;
  translation_mode: 'off' | 'en-zh' | 'zh-en';
  reader_background_color: string;
  reader_font_size: number;
  keymap: Keymap;
}

interface SettingsProps {
  onClose: () => void;
}

interface EmbeddingStatus {
  indexed: number;
  total: number;
  stale: number;
}

export const Settings: React.FC<SettingsProps> = ({ onClose }) => {
  const loadAppConfig = useStore((state) => state.loadConfig);
  const [config, setConfig] = useState<Config>({
    provider: 'lmstudio',
    lm_studio_url: '',
    embedding_provider: 'local_transformers',
    embedding_model: 'Xenova/all-MiniLM-L6-v2',
    embedding_dimension: 384,
    embedding_auto_reindex: true,
    embedding_ollama_url: '',
    embedding_ollama_model: '',
    embedding_local_model_path: '',
    embedding_download_base_url: '',
    chat_model: '',
    openai_api_key: '',
    openai_base_url: 'https://api.openai.com/v1',
    tts_provider: 'auto',
    edge_tts_voice: 'en-US-AriaNeural',
    edge_tts_proxy: '',
    cosyvoice_base_url: '',
    cosyvoice_api_key: '',
    translation_mode: 'off',
    reader_background_color: '#F4F8EE',
    reader_font_size: 18,
    keymap: normalizeKeymap(undefined),
  });
  const [shortcutInput, setShortcutInput] = useState({
    next_page: formatShortcutListInput(config.keymap.next_page),
    prev_page: formatShortcutListInput(config.keymap.prev_page),
    open_settings: formatShortcutListInput(config.keymap.open_settings),
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [embeddingStatus, setEmbeddingStatus] = useState<EmbeddingStatus | null>(null);

  useEffect(() => {
    loadConfig();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const loadConfig = async () => {
    setIsLoading(true);
    try {
      const loadedConfig = await invoke<Config>('get_config');
      const normalized = {
        ...loadedConfig,
        keymap: normalizeKeymap(loadedConfig.keymap),
      };
      setConfig(normalized);
      setShortcutInput({
        next_page: formatShortcutListInput(normalized.keymap.next_page),
        prev_page: formatShortcutListInput(normalized.keymap.prev_page),
        open_settings: formatShortcutListInput(normalized.keymap.open_settings),
      });
      try {
        const status = await invoke<EmbeddingStatus>('get_embedding_profile_status', { docId: null });
        setEmbeddingStatus(status);
      } catch (e) {
        console.warn('Failed to load embedding status:', e);
      }
    } catch (error) {
      console.error('Failed to load config:', error);
      setMessage({ type: 'error', text: 'Failed to load configuration' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setMessage(null);

    try {
      await invoke('update_config', { config });
      await loadAppConfig();
      setMessage({ type: 'success', text: 'Configuration saved successfully!' });
      setTimeout(() => onClose(), 1500);
    } catch (error) {
      console.error('Failed to save config:', error);
      setMessage({ type: 'error', text: 'Failed to save configuration' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleChange = (field: keyof Config) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setConfig((prev) => ({ ...prev, [field]: e.target.value }));
    setMessage(null);
  };

  const handleShortcutChange = (field: keyof Keymap) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setShortcutInput((prev) => ({ ...prev, [field]: value }));
    setConfig((prev) => ({
      ...prev,
      keymap: {
        ...prev.keymap,
        [field]: parseShortcutListInput(value),
      },
    }));
    setMessage(null);
  };

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4 max-h-[85vh] flex flex-col"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
          <h2 className="text-xl font-semibold text-gray-900">Settings</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4 space-y-4 overflow-y-auto flex-1">
          {/* Message */}
          {message && (
            <div
              className={`p-3 rounded-md ${
                message.type === 'success'
                  ? 'bg-green-50 border border-green-200 text-green-700'
                  : 'bg-red-50 border border-red-200 text-red-700'
              }`}
            >
              <p className="text-sm">{message.text}</p>
            </div>
          )}

          {/* AI Provider Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Chat/Translate Provider
            </label>
            <select
              value={config.provider}
              onChange={(e) => setConfig((prev) => ({ ...prev, provider: e.target.value as AiProvider }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="lmstudio">LM Studio (Local)</option>
              <option value="openai">OpenAI (Cloud)</option>
            </select>
            <p className="mt-1 text-xs text-gray-500">
              {config.provider === 'lmstudio'
                ? 'Use local LM Studio for offline, privacy-focused AI features'
                : 'Use OpenAI API for cloud-based AI features (requires API key)'}
            </p>
          </div>

          {/* Embedding Configuration */}
          <div className="p-3 bg-gray-50 border border-gray-200 rounded-md space-y-3">
            <p className="text-sm font-medium text-gray-800">Embedding</p>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Embedding Provider
              </label>
              <select
                value={config.embedding_provider}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    embedding_provider: e.target.value as EmbeddingProvider,
                  }))
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="local_transformers">Local Transformers (Offline First)</option>
                <option value="lmstudio">LM Studio</option>
                <option value="openai_compatible">OpenAI Compatible</option>
                <option value="ollama">Ollama</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Embedding Model
              </label>
              <input
                type="text"
                value={config.embedding_model}
                onChange={handleChange('embedding_model')}
                placeholder="Xenova/all-MiniLM-L6-v2"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-gray-500">
                Recommended local model: Xenova/all-MiniLM-L6-v2 (384 dimensions)
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Embedding Dimension
              </label>
              <input
                type="number"
                value={config.embedding_dimension}
                readOnly
                className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-100 text-gray-600"
              />
            </div>

            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={config.embedding_auto_reindex}
                onChange={(e) =>
                  setConfig((prev) => ({ ...prev, embedding_auto_reindex: e.target.checked }))
                }
              />
              <span>Auto reindex when embedding profile changes</span>
            </label>
            {config.embedding_provider === 'local_transformers' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Local Model Path (Optional)
                </label>
                <input
                  type="text"
                  value={config.embedding_local_model_path || ''}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, embedding_local_model_path: e.target.value }))
                  }
                  placeholder="/Users/you/.../Xenova_all-MiniLM-L6-v2"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="mt-1 text-xs text-gray-500">
                  If set, local embedding loads model files from this directory first.
                </p>
              </div>
            )}
            {config.embedding_provider === 'local_transformers' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Embedding Download Base URL (Optional)
                </label>
                <input
                  type="text"
                  value={config.embedding_download_base_url || ''}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, embedding_download_base_url: e.target.value }))
                  }
                  placeholder="https://hf-mirror.com"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="mt-1 text-xs text-gray-500">
                  If Hugging Face is blocked, set a mirror base URL. Example: https://hf-mirror.com
                </p>
              </div>
            )}
            {embeddingStatus && (
              <p className="text-xs text-gray-500">
                Indexed: {embeddingStatus.indexed}/{embeddingStatus.total}
                {embeddingStatus.stale > 0 ? `, stale: ${embeddingStatus.stale}` : ''}
              </p>
            )}

            {config.embedding_provider === 'ollama' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Ollama URL
                  </label>
                  <input
                    type="text"
                    value={config.embedding_ollama_url || ''}
                    onChange={(e) => setConfig((prev) => ({ ...prev, embedding_ollama_url: e.target.value }))}
                    placeholder="http://localhost:11434"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Ollama Embedding Model
                  </label>
                  <input
                    type="text"
                    value={config.embedding_ollama_model || ''}
                    onChange={(e) => setConfig((prev) => ({ ...prev, embedding_ollama_model: e.target.value }))}
                    placeholder="nomic-embed-text"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </>
            )}
          </div>

          {/* LM Studio Configuration */}
          {config.provider === 'lmstudio' && (
            <>
              {/* LM Studio URL */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  LM Studio URL
                </label>
                <input
                  type="text"
                  value={config.lm_studio_url}
                  onChange={handleChange('lm_studio_url')}
                  placeholder="http://localhost:1234/v1"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="mt-1 text-xs text-gray-500">
                  The API endpoint for LM Studio (e.g., http://localhost:1234/v1)
                </p>
              </div>
            </>
          )}

          {/* OpenAI Configuration */}
          {config.provider === 'openai' && (
            <>
              {/* OpenAI API Key */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  API Key
                </label>
                <input
                  type="password"
                  value={config.openai_api_key || ''}
                  onChange={(e) => setConfig((prev) => ({ ...prev, openai_api_key: e.target.value }))}
                  placeholder="sk-..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Your API key for OpenAI or compatible services
                </p>
              </div>

              {/* OpenAI Base URL */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  API Endpoint
                </label>
                <input
                  type="text"
                  value={config.openai_base_url || ''}
                  onChange={(e) => setConfig((prev) => ({ ...prev, openai_base_url: e.target.value }))}
                  placeholder="https://api.openai.com/v1"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="mt-1 text-xs text-gray-500">
                  API endpoint URL (for OpenAI, Azure OpenAI, or other OpenAI-compatible services)
                </p>
              </div>
            </>
          )}

          <div className="p-3 bg-gray-50 border border-gray-200 rounded-md">
            <p className="text-xs text-gray-600">
              Translation direction is now managed from the macOS menu bar: <span className="font-medium">Reading → Translation Direction</span>.
            </p>
          </div>

          <div className="p-3 bg-gray-50 border border-gray-200 rounded-md space-y-3">
            <p className="text-sm font-medium text-gray-800">Keyboard Shortcuts</p>
            <p className="text-xs text-gray-500">
              Use <span className="font-medium">;</span> to separate multiple bindings, e.g. <span className="font-medium">PageDown; Space; J</span>.
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Next Page / Next Section
              </label>
              <input
                type="text"
                value={shortcutInput.next_page}
                onChange={handleShortcutChange('next_page')}
                placeholder="PageDown; Space; J"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Previous Page / Previous Section
              </label>
              <input
                type="text"
                value={shortcutInput.prev_page}
                onChange={handleShortcutChange('prev_page')}
                placeholder="PageUp; Shift+Space; K"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Open Settings
              </label>
              <input
                type="text"
                value={shortcutInput.open_settings}
                onChange={handleShortcutChange('open_settings')}
                placeholder="Cmd+,; Ctrl+,"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Chat Model */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Chat Model
            </label>
            <input
              type="text"
              value={config.chat_model}
              onChange={handleChange('chat_model')}
              placeholder="local-model"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="mt-1 text-xs text-gray-500">
              Model name for chat, translation, and summarization
            </p>
            <p className="mt-1 text-xs text-gray-500">
              {config.provider === 'openai'
                ? 'OpenAI: gpt-4o, gpt-4-turbo, gpt-3.5-turbo, etc.'
                : 'LM Studio: Any local model loaded (e.g., Llama 3.1, Qwen 2.5)'}
            </p>
          </div>

          {/* TTS Provider */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              TTS Provider
            </label>
            <select
              value={config.tts_provider}
              onChange={(e) => setConfig((prev) => ({ ...prev, tts_provider: e.target.value as 'auto' | 'edge' | 'cosyvoice' }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="auto">Auto (ZH→CosyVoice, Others→Edge)</option>
              <option value="edge">Edge TTS</option>
              <option value="cosyvoice">CosyVoice</option>
            </select>
          </div>

          {/* Edge Voice */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Edge Voice
            </label>
            <input
              type="text"
              value={config.edge_tts_voice || ''}
              onChange={(e) => setConfig((prev) => ({ ...prev, edge_tts_voice: e.target.value }))}
              placeholder="en-US-AriaNeural"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="mt-1 text-xs text-gray-500">
              Example: en-US-AriaNeural / zh-CN-XiaoxiaoNeural
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Edge TTS Proxy (Optional)
            </label>
            <input
              type="text"
              value={config.edge_tts_proxy || ''}
              onChange={(e) => setConfig((prev) => ({ ...prev, edge_tts_proxy: e.target.value }))}
              placeholder="http://127.0.0.1:7890"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="mt-1 text-xs text-gray-500">
              Used only for Edge TTS network requests. Leave empty to use system env proxy.
            </p>
          </div>

          {/* CosyVoice Config */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              CosyVoice Base URL
            </label>
            <input
              type="text"
              value={config.cosyvoice_base_url || ''}
              onChange={(e) => setConfig((prev) => ({ ...prev, cosyvoice_base_url: e.target.value }))}
              placeholder="http://localhost:8000"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              CosyVoice API Key (Optional)
            </label>
            <input
              type="password"
              value={config.cosyvoice_api_key || ''}
              onChange={(e) => setConfig((prev) => ({ ...prev, cosyvoice_api_key: e.target.value }))}
              placeholder="Optional bearer token"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-lg flex-shrink-0">
          <button
            onClick={onClose}
            disabled={isSaving}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
          >
            {isSaving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
};
