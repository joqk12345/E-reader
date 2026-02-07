import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

type AiProvider = 'lmstudio' | 'openai';

interface Config {
  provider: AiProvider;
  lm_studio_url: string;
  embedding_model: string;
  chat_model: string;
  openai_api_key?: string;
  openai_base_url?: string;
  tts_provider: 'auto' | 'edge' | 'cosyvoice';
  edge_tts_voice: string;
  cosyvoice_base_url?: string;
  cosyvoice_api_key?: string;
  translation_mode: 'off' | 'en-zh' | 'zh-en';
  reader_background_color: string;
  reader_font_size: number;
}

interface SettingsProps {
  onClose: () => void;
}

export const Settings: React.FC<SettingsProps> = ({ onClose }) => {
  const [config, setConfig] = useState<Config>({
    provider: 'lmstudio',
    lm_studio_url: '',
    embedding_model: '',
    chat_model: '',
    openai_api_key: '',
    openai_base_url: 'https://api.openai.com/v1',
    tts_provider: 'auto',
    edge_tts_voice: 'en-US-AriaNeural',
    cosyvoice_base_url: '',
    cosyvoice_api_key: '',
    translation_mode: 'off',
    reader_background_color: '#F4F8EE',
    reader_font_size: 18,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    setIsLoading(true);
    try {
      const loadedConfig = await invoke<Config>('get_config');
      setConfig(loadedConfig);
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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
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
        <div className="px-6 py-4 space-y-4">
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
              AI Provider
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

          {/* Common Model Settings (for both providers) */}
          {/* Embedding Model */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Embedding Model
            </label>
            <input
              type="text"
              value={config.embedding_model}
              onChange={handleChange('embedding_model')}
              placeholder="text-embedding-ada-002"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="mt-1 text-xs text-gray-500">
              Model name for generating embeddings (semantic search)
            </p>
            <p className="mt-1 text-xs text-gray-500">
              {config.provider === 'openai'
                ? 'OpenAI: text-embedding-3-small, text-embedding-3-large, text-embedding-ada-002'
                : 'LM Studio: text-embedding-ada-002 (or compatible model)'}
            </p>
          </div>

          <div className="p-3 bg-gray-50 border border-gray-200 rounded-md">
            <p className="text-xs text-gray-600">
              Translation direction is now managed from the macOS menu bar: <span className="font-medium">Reading → Translation Direction</span>.
            </p>
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
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-lg">
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
