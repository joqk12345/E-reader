import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../store/useStore';
import {
  formatShortcutListInput,
  normalizeKeymap,
  parseShortcutListInput,
  type Keymap,
} from '../utils/shortcuts';
import {  READER_THEMES,
  VIEW_SETTINGS_KEY,
  clamp,
  loadReaderViewSettings,
  type ReaderThemeId,
  type ReaderViewSettings,
} from './readerTheme';
import {
  KVInfo,
  SecondaryActionButton,
  SettingRow,
  SettingsCard,
  SettingsDivider,
  SidebarNavItem,
  StatusDot,
  ToggleSwitch,
  compactControlClass,
} from './settings/SettingsUI';

type AiProvider = 'lmstudio' | 'openai';
type EmbeddingProvider = 'local_transformers' | 'lmstudio' | 'openai_compatible' | 'ollama';
type SettingsSection = 'reading' | 'translation' | 'ai' | 'audio' | 'shortcuts';

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
  initialSection?: SettingsSection;
}

interface EmbeddingStatus {
  indexed: number;
  total: number;
  stale: number;
}

const themeOrder: ReaderThemeId[] = ['white', 'paper', 'mint', 'sepia', 'night'];

function SidebarIcon({ type }: { type: SettingsSection }) {
  if (type === 'reading') {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    );
  }
  if (type === 'ai') {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="5" y="7" width="14" height="10" rx="2" />
        <path d="M9 7V5m6 2V5m-8 12v2m10-2v2" />
      </svg>
    );
  }
  if (type === 'audio') {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M14 4a8 8 0 0 1 0 16" />
        <path d="M11 7a5 5 0 0 1 0 10" />
        <path d="M8 10H5v4h3l4 3V7l-4 3Z" />
      </svg>
    );
  }
  if (type === 'translation') {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 6h8M8 6v2M6 8l4 6M14 6h6M17 6v10" />
        <path d="M13 16h8M15 12l2 4 2-4" />
      </svg>
    );
  }
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M6 4v6M12 4v10M18 4v4" />
      <path d="M5 10h2M11 14h2M17 8h2" />
      <path d="M4 20h16" />
    </svg>
  );
}

export const Settings: React.FC<SettingsProps> = ({ onClose, initialSection = 'reading' }) => {
  const loadAppConfig = useStore((state) => state.loadConfig);
  const [activeSection, setActiveSection] = useState<SettingsSection>(initialSection);
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
  const [readerViewSettings, setReaderViewSettings] = useState<ReaderViewSettings>(() =>
    loadReaderViewSettings(18)
  );
  const [shortcutInput, setShortcutInput] = useState({
    next_page: formatShortcutListInput(config.keymap.next_page),
    prev_page: formatShortcutListInput(config.keymap.prev_page),
    open_settings: formatShortcutListInput(config.keymap.open_settings),
    toggle_window_maximize: formatShortcutListInput(config.keymap.toggle_window_maximize),
    toggle_header_tools: formatShortcutListInput(config.keymap.toggle_header_tools),
    font_increase: formatShortcutListInput(config.keymap.font_increase),
    font_decrease: formatShortcutListInput(config.keymap.font_decrease),
    font_reset: formatShortcutListInput(config.keymap.font_reset),
    open_search: formatShortcutListInput(config.keymap.open_search),
    audio_play: formatShortcutListInput(config.keymap.audio_play),
    audio_toggle_pause: formatShortcutListInput(config.keymap.audio_toggle_pause),
    audio_stop: formatShortcutListInput(config.keymap.audio_stop),
    toggle_reading_mode: formatShortcutListInput(config.keymap.toggle_reading_mode),
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [embeddingStatus, setEmbeddingStatus] = useState<EmbeddingStatus | null>(null);

  useEffect(() => {
    void loadConfig();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_SETTINGS_KEY, JSON.stringify(readerViewSettings));
      window.dispatchEvent(new CustomEvent('reader:view-settings-updated'));
    } catch (error) {
      console.warn('Failed to persist reader view settings:', error);
    }
  }, [readerViewSettings]);

  useEffect(() => {
    setActiveSection(initialSection);
  }, [initialSection]);

  const loadConfig = async () => {
    setIsLoading(true);
    try {
      const loadedConfig = await invoke<Config>('get_config');
      const normalized = {
        ...loadedConfig,
        keymap: normalizeKeymap(loadedConfig.keymap),
      };
      setConfig(normalized);
      setReaderViewSettings(loadReaderViewSettings(normalized.reader_font_size || 18));
      setShortcutInput({
        next_page: formatShortcutListInput(normalized.keymap.next_page),
        prev_page: formatShortcutListInput(normalized.keymap.prev_page),
        open_settings: formatShortcutListInput(normalized.keymap.open_settings),
        toggle_window_maximize: formatShortcutListInput(normalized.keymap.toggle_window_maximize),
        toggle_header_tools: formatShortcutListInput(normalized.keymap.toggle_header_tools),
        font_increase: formatShortcutListInput(normalized.keymap.font_increase),
        font_decrease: formatShortcutListInput(normalized.keymap.font_decrease),
        font_reset: formatShortcutListInput(normalized.keymap.font_reset),
        open_search: formatShortcutListInput(normalized.keymap.open_search),
        audio_play: formatShortcutListInput(normalized.keymap.audio_play),
        audio_toggle_pause: formatShortcutListInput(normalized.keymap.audio_toggle_pause),
        audio_stop: formatShortcutListInput(normalized.keymap.audio_stop),
        toggle_reading_mode: formatShortcutListInput(normalized.keymap.toggle_reading_mode),
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
    const nextConfig: Config = {
      ...config,
      reader_font_size: readerViewSettings.fontSize,
      reader_background_color: READER_THEMES[readerViewSettings.theme].background,
    };

    try {
      await invoke('update_config', { config: nextConfig });
      await loadAppConfig();
      setConfig(nextConfig);
      setMessage({ type: 'success', text: 'Configuration saved successfully!' });
      setTimeout(() => onClose(), 1000);
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

  const adjustReaderSetting = (
    key: 'fontSize' | 'lineHeight' | 'contentWidth' | 'cjkLetterSpacing',
    delta: number
  ) => {
    setReaderViewSettings((prev) => {
      if (key === 'fontSize') return { ...prev, fontSize: clamp(prev.fontSize + delta, 12, 30) };
      if (key === 'lineHeight') {
        return { ...prev, lineHeight: clamp(Math.round((prev.lineHeight + delta) * 10) / 10, 1.2, 2.4) };
      }
      if (key === 'contentWidth') return { ...prev, contentWidth: clamp(prev.contentWidth + delta, 36, 84) };
      return {
        ...prev,
        cjkLetterSpacing: clamp(Math.round((prev.cjkLetterSpacing + delta) * 100) / 100, 0.02, 0.12),
      };
    });
  };

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35">
        <div className="rounded-2xl bg-white p-8 shadow-xl">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600" />
        </div>
      </div>
    );
  }

  const navItems: Array<{ id: SettingsSection; label: string }> = [
    { id: 'reading', label: 'Appearance' },
    { id: 'translation', label: 'Bilingual Translation' },
    { id: 'ai', label: 'AI & Embedding' },
    { id: 'audio', label: 'Audio' },
    { id: 'shortcuts', label: 'Shortcuts' },
  ];

  const lmDisabled = config.provider !== 'lmstudio';
  const openaiDisabled = config.provider !== 'openai';
  const localEmbeddingDisabled = config.embedding_provider !== 'local_transformers';
  const ollamaEmbeddingDisabled = config.embedding_provider !== 'ollama';
  const edgeDisabled = config.tts_provider === 'cosyvoice';
  const cosyDisabled = config.tts_provider === 'edge';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 backdrop-blur-[1px]" onClick={onClose}>
      <div
        className="mx-4 flex h-[77vh] w-full max-w-[826px] overflow-hidden rounded-3xl border border-slate-200 bg-[#f6f7f9] shadow-[0_24px_60px_rgba(15,23,42,0.28)]"
        onClick={(event) => event.stopPropagation()}
      >
        <aside className="w-[168px] shrink-0 border-r border-slate-200 bg-[#eef0f3] px-2 py-3">
          <div className="px-2 pb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Settings</div>
          <nav className="space-y-1">
            {navItems.map((item) => {
              const active = activeSection === item.id;
              return (
                <SidebarNavItem
                  key={item.id}
                  active={active}
                  label={item.label}
                  icon={<SidebarIcon type={item.id} />}
                  onClick={() => setActiveSection(item.id)}
                />
              );
            })}
          </nav>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <header className="border-b border-slate-200 bg-white/80 px-6 py-3">
            <h1 className="text-center text-[20px] font-semibold tracking-tight text-slate-900">Settings</h1>
          </header>

          <main className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            <h2 className="mb-3 text-[22px] font-bold tracking-tight text-slate-900">
              {activeSection === 'reading' && 'Appearance'}
              {activeSection === 'translation' && 'Bilingual Translation'}
              {activeSection === 'ai' && 'AI & Embedding'}
              {activeSection === 'audio' && 'Audio'}
              {activeSection === 'shortcuts' && 'Shortcuts'}
            </h2>

            {message && (
              <div className={`mb-4 rounded-xl border px-4 py-3 text-sm ${message.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>
                {message.text}
              </div>
            )}

            {activeSection === 'reading' && (
              <SettingsCard>
                <SettingRow
                  title="Theme"
                  description="Choose your reading canvas"
                  right={
                    <div className="flex items-center gap-3">
                      {themeOrder.map((id) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setReaderViewSettings((prev) => ({ ...prev, theme: id }))}
                          className="h-7 w-7 rounded-full border-2"
                          style={{
                            backgroundColor: READER_THEMES[id].background,
                            borderColor: readerViewSettings.theme === id ? '#2563eb' : 'transparent',
                          }}
                        />
                      ))}
                    </div>
                  }
                />
                <SettingsDivider />
                <SettingRow
                  title="Font Size"
                  description="Main reading text size"
                  right={
                    <>
                      <button type="button" className="h-8 w-8 rounded-lg border border-slate-300 bg-white text-base" onClick={() => adjustReaderSetting('fontSize', -1)}>−</button>
                      <button type="button" className="h-8 w-8 rounded-lg border border-slate-300 bg-white text-base" onClick={() => adjustReaderSetting('fontSize', 1)}>+</button>
                      <span className="w-14 text-right text-[13px] text-slate-700">{readerViewSettings.fontSize}px</span>
                    </>
                  }
                />
                <SettingRow
                  title="Line Height"
                  description="Vertical rhythm and readability"
                  right={
                    <>
                      <button type="button" className="h-8 w-8 rounded-lg border border-slate-300 bg-white text-base" onClick={() => adjustReaderSetting('lineHeight', -0.1)}>−</button>
                      <button type="button" className="h-8 w-8 rounded-lg border border-slate-300 bg-white text-base" onClick={() => adjustReaderSetting('lineHeight', 0.1)}>+</button>
                      <span className="w-14 text-right text-[13px] text-slate-700">{readerViewSettings.lineHeight.toFixed(1)}</span>
                    </>
                  }
                />
                <SettingRow
                  title="Content Width"
                  description="Set line length for focus"
                  right={
                    <>
                      <button type="button" className="h-8 w-8 rounded-lg border border-slate-300 bg-white text-base" onClick={() => adjustReaderSetting('contentWidth', -2)}>−</button>
                      <button type="button" className="h-8 w-8 rounded-lg border border-slate-300 bg-white text-base" onClick={() => adjustReaderSetting('contentWidth', 2)}>+</button>
                      <span className="w-14 text-right text-[13px] text-slate-700">{readerViewSettings.contentWidth}em</span>
                    </>
                  }
                />
                <SettingRow
                  title="CJK Letter Spacing"
                  description="Spacing between CJK characters"
                  right={
                    <>
                      <button type="button" className="h-8 w-8 rounded-lg border border-slate-300 bg-white text-base" onClick={() => adjustReaderSetting('cjkLetterSpacing', -0.01)}>−</button>
                      <button type="button" className="h-8 w-8 rounded-lg border border-slate-300 bg-white text-base" onClick={() => adjustReaderSetting('cjkLetterSpacing', 0.01)}>+</button>
                      <span className="w-14 text-right text-[13px] text-slate-700">{readerViewSettings.cjkLetterSpacing.toFixed(2)}em</span>
                    </>
                  }
                />
                <SettingRow
                  title="CJK Spacing Toggle"
                  description="Enable/disable CJK spacing effect"
                  right={<ToggleSwitch checked={readerViewSettings.cjkLetterSpacingEnabled} onChange={(next) => setReaderViewSettings((prev) => ({ ...prev, cjkLetterSpacingEnabled: next }))} />}
                />
                <SettingRow
                  title="Expand Details"
                  description="Automatically expand all details blocks"
                  right={<ToggleSwitch checked={readerViewSettings.expandDetails} onChange={(next) => setReaderViewSettings((prev) => ({ ...prev, expandDetails: next }))} />}
                />
              </SettingsCard>
            )}

            {activeSection === 'translation' && (
              <SettingsCard>
                <SettingRow
                  title="Enable Bilingual Translation"
                  description="Turn on inline bilingual translation features"
                  right={
                    <ToggleSwitch
                      checked={config.translation_mode !== 'off'}
                      onChange={(next) =>
                        setConfig((prev) => ({
                          ...prev,
                          translation_mode: next
                            ? prev.translation_mode === 'off'
                              ? 'en-zh'
                              : prev.translation_mode
                            : 'off',
                        }))
                      }
                    />
                  }
                />
                <SettingsDivider />
                <SettingRow
                  title="Translation Direction"
                  description="Set default translation direction"
                  right={
                    <select
                      className={`${compactControlClass} w-[260px]`}
                      value={config.translation_mode === 'off' ? 'en-zh' : config.translation_mode}
                      disabled={config.translation_mode === 'off'}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          translation_mode: e.target.value as 'en-zh' | 'zh-en',
                        }))
                      }
                    >
                      <option value="en-zh">English → Chinese</option>
                      <option value="zh-en">Chinese → English</option>
                    </select>
                  }
                  disabled={config.translation_mode === 'off'}
                />
              </SettingsCard>
            )}

            {activeSection === 'ai' && (
              <div className="space-y-4">
                <SettingsCard>
                  <SettingRow
                    title="Chat Provider"
                    description="Select AI backend"
                    right={
                      <select className={`${compactControlClass} w-[260px]`} value={config.provider} onChange={(e) => setConfig((prev) => ({ ...prev, provider: e.target.value as AiProvider }))}>
                        <option value="lmstudio">LM Studio (Local)</option>
                        <option value="openai">OpenAI (Cloud)</option>
                      </select>
                    }
                  />
                  <SettingsDivider />
                  <SettingRow
                    title="Embedding Provider"
                    description="Index and retrieval engine"
                    right={
                      <select className={`${compactControlClass} w-[260px]`} value={config.embedding_provider} onChange={(e) => setConfig((prev) => ({ ...prev, embedding_provider: e.target.value as EmbeddingProvider }))}>
                        <option value="local_transformers">Local Transformers</option>
                        <option value="lmstudio">LM Studio</option>
                        <option value="openai_compatible">OpenAI Compatible</option>
                        <option value="ollama">Ollama</option>
                      </select>
                    }
                  />
                  <SettingRow
                    title="Embedding Model"
                    description="Model id used for vectorization"
                    right={<input className={`${compactControlClass} w-[260px]`} value={config.embedding_model} onChange={handleChange('embedding_model')} />}
                  />
                  <SettingRow
                    title="Embedding Dimension"
                    description="Configured vector size"
                    right={<input className={`${compactControlClass} w-[260px]`} value={String(config.embedding_dimension)} disabled readOnly />}
                    disabled
                  />
                  <SettingRow
                    title="Auto Reindex"
                    description="Rebuild index when embedding profile changes"
                    right={
                      <>
                        <StatusDot success={!embeddingStatus || embeddingStatus.stale === 0} text={!embeddingStatus || embeddingStatus.stale === 0 ? 'Healthy' : 'Needs reindex'} />
                        <ToggleSwitch checked={config.embedding_auto_reindex} onChange={(next) => setConfig((prev) => ({ ...prev, embedding_auto_reindex: next }))} />
                      </>
                    }
                  />

                  <SettingsDivider />

                  <SettingRow
                    title="Local Model Path"
                    description="Used only for local transformers"
                    right={<input className={`${compactControlClass} w-[260px]`} disabled={localEmbeddingDisabled} value={config.embedding_local_model_path || ''} onChange={(e) => setConfig((prev) => ({ ...prev, embedding_local_model_path: e.target.value }))} />}
                    disabled={localEmbeddingDisabled}
                  />
                  <SettingRow
                    title="Download Mirror"
                    description="Optional base URL for model download"
                    right={<input className={`${compactControlClass} w-[260px]`} disabled={localEmbeddingDisabled} value={config.embedding_download_base_url || ''} onChange={(e) => setConfig((prev) => ({ ...prev, embedding_download_base_url: e.target.value }))} />}
                    disabled={localEmbeddingDisabled}
                  />
                  <SettingRow
                    title="Ollama URL"
                    description="Used only for Ollama embedding"
                    right={<input className={`${compactControlClass} w-[260px]`} disabled={ollamaEmbeddingDisabled} value={config.embedding_ollama_url || ''} onChange={(e) => setConfig((prev) => ({ ...prev, embedding_ollama_url: e.target.value }))} />}
                    disabled={ollamaEmbeddingDisabled}
                  />
                  <SettingRow
                    title="Ollama Model"
                    description="Embedding model name in Ollama"
                    right={<input className={`${compactControlClass} w-[260px]`} disabled={ollamaEmbeddingDisabled} value={config.embedding_ollama_model || ''} onChange={(e) => setConfig((prev) => ({ ...prev, embedding_ollama_model: e.target.value }))} />}
                    disabled={ollamaEmbeddingDisabled}
                  />

                  <SettingsDivider />

                  <SettingRow
                    title="LM Studio URL"
                    description="Active when provider is LM Studio"
                    right={<input className={`${compactControlClass} w-[260px]`} disabled={lmDisabled} value={config.lm_studio_url} onChange={handleChange('lm_studio_url')} />}
                    disabled={lmDisabled}
                  />
                  <SettingRow
                    title="OpenAI API Key"
                    description="Active when provider is OpenAI"
                    right={<input type="password" className={`${compactControlClass} w-[260px]`} disabled={openaiDisabled} value={config.openai_api_key || ''} onChange={(e) => setConfig((prev) => ({ ...prev, openai_api_key: e.target.value }))} />}
                    disabled={openaiDisabled}
                  />
                  <SettingRow
                    title="OpenAI Endpoint"
                    description="Custom API base URL"
                    right={<input className={`${compactControlClass} w-[260px]`} disabled={openaiDisabled} value={config.openai_base_url || ''} onChange={(e) => setConfig((prev) => ({ ...prev, openai_base_url: e.target.value }))} />}
                    disabled={openaiDisabled}
                  />
                </SettingsCard>

                <SettingsCard>
                  <KVInfo
                    rows={[
                      {
                        key: 'Indexed',
                        value: (
                          <span className="font-medium text-emerald-600">
                            {embeddingStatus ? `${embeddingStatus.indexed}/${embeddingStatus.total}` : '—'}
                          </span>
                        ),
                      },
                      {
                        key: 'Stale',
                        value: (
                          <span className="font-medium text-slate-700">
                            {embeddingStatus ? embeddingStatus.stale : '—'}
                          </span>
                        ),
                      },
                      {
                        key: 'Tools',
                        value: (
                          <a href="#" className="inline-flex items-center gap-1 text-blue-600 hover:underline">
                            open docs ↗
                          </a>
                        ),
                      },
                    ]}
                  />
                </SettingsCard>
              </div>
            )}

            {activeSection === 'audio' && (
              <SettingsCard>
                <SettingRow
                  title="TTS Provider"
                  description="Select speech engine"
                  right={
                    <select className={`${compactControlClass} w-[260px]`} value={config.tts_provider} onChange={(e) => setConfig((prev) => ({ ...prev, tts_provider: e.target.value as 'auto' | 'edge' | 'cosyvoice' }))}>
                      <option value="auto">Auto</option>
                      <option value="edge">Edge TTS</option>
                      <option value="cosyvoice">CosyVoice</option>
                    </select>
                  }
                />
                <SettingsDivider />
                <SettingRow
                  title="Edge Voice"
                  description="Voice preset for Edge TTS"
                  right={<input className={`${compactControlClass} w-[260px]`} disabled={edgeDisabled} value={config.edge_tts_voice || ''} onChange={(e) => setConfig((prev) => ({ ...prev, edge_tts_voice: e.target.value }))} />}
                  disabled={edgeDisabled}
                />
                <SettingRow
                  title="Edge Proxy"
                  description="Optional network proxy"
                  right={<input className={`${compactControlClass} w-[260px]`} disabled={edgeDisabled} value={config.edge_tts_proxy || ''} onChange={(e) => setConfig((prev) => ({ ...prev, edge_tts_proxy: e.target.value }))} />}
                  disabled={edgeDisabled}
                />
                <SettingRow
                  title="CosyVoice URL"
                  description="Endpoint for CosyVoice service"
                  right={<input className={`${compactControlClass} w-[260px]`} disabled={cosyDisabled} value={config.cosyvoice_base_url || ''} onChange={(e) => setConfig((prev) => ({ ...prev, cosyvoice_base_url: e.target.value }))} />}
                  disabled={cosyDisabled}
                />
                <SettingRow
                  title="CosyVoice API Key"
                  description="Optional auth token"
                  right={<input type="password" className={`${compactControlClass} w-[260px]`} disabled={cosyDisabled} value={config.cosyvoice_api_key || ''} onChange={(e) => setConfig((prev) => ({ ...prev, cosyvoice_api_key: e.target.value }))} />}
                  disabled={cosyDisabled}
                />
              </SettingsCard>
            )}

            {activeSection === 'shortcuts' && (
              <SettingsCard>
                <SettingRow title="Next Page" description="Move to next section" right={<input className={`${compactControlClass} w-[260px]`} value={shortcutInput.next_page} onChange={handleShortcutChange('next_page')} />} />
                <SettingRow title="Previous Page" description="Move to previous section" right={<input className={`${compactControlClass} w-[260px]`} value={shortcutInput.prev_page} onChange={handleShortcutChange('prev_page')} />} />
                <SettingRow title="Open Settings" description="Quickly open this panel" right={<input className={`${compactControlClass} w-[260px]`} value={shortcutInput.open_settings} onChange={handleShortcutChange('open_settings')} />} />
                <SettingRow title="Toggle Maximize Window" description="Maximize or restore app window" right={<input className={`${compactControlClass} w-[260px]`} value={shortcutInput.toggle_window_maximize} onChange={handleShortcutChange('toggle_window_maximize')} />} />
                <SettingRow title="Toggle Header Toolbar" description="Show or hide reader header tools" right={<input className={`${compactControlClass} w-[260px]`} value={shortcutInput.toggle_header_tools} onChange={handleShortcutChange('toggle_header_tools')} />} />
                <SettingRow title="Increase Font Size" description="Increase reader font size" right={<input className={`${compactControlClass} w-[260px]`} value={shortcutInput.font_increase} onChange={handleShortcutChange('font_increase')} />} />
                <SettingRow title="Decrease Font Size" description="Decrease reader font size" right={<input className={`${compactControlClass} w-[260px]`} value={shortcutInput.font_decrease} onChange={handleShortcutChange('font_decrease')} />} />
                <SettingRow title="Reset Font Size" description="Reset reader font size to default" right={<input className={`${compactControlClass} w-[260px]`} value={shortcutInput.font_reset} onChange={handleShortcutChange('font_reset')} />} />
                <SettingRow title="Open Search" description="Focus search tool" right={<input className={`${compactControlClass} w-[260px]`} value={shortcutInput.open_search} onChange={handleShortcutChange('open_search')} />} />
                <SettingRow title="Audio Play" description="Start playback" right={<input className={`${compactControlClass} w-[260px]`} value={shortcutInput.audio_play} onChange={handleShortcutChange('audio_play')} />} />
                <SettingRow title="Audio Pause/Resume" description="Toggle pause" right={<input className={`${compactControlClass} w-[260px]`} value={shortcutInput.audio_toggle_pause} onChange={handleShortcutChange('audio_toggle_pause')} />} />
                <SettingRow title="Audio Stop" description="Stop playback" right={<input className={`${compactControlClass} w-[260px]`} value={shortcutInput.audio_stop} onChange={handleShortcutChange('audio_stop')} />} />
                <SettingRow title="Toggle Reading Mode" description="Enter/exit minimal reader mode" right={<input className={`${compactControlClass} w-[260px]`} value={shortcutInput.toggle_reading_mode} onChange={handleShortcutChange('toggle_reading_mode')} />} />
              </SettingsCard>
            )}
          </main>

          <footer className="flex items-center justify-between border-t border-slate-200 bg-white/90 px-6 py-2.5">
            <SecondaryActionButton icon={<span>↻</span>} label="Reload" onClick={() => void loadConfig()} />

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={isSaving}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={isSaving}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
              >
                {isSaving ? 'Saving...' : 'Save Settings'}
              </button>
            </div>
          </footer>
        </section>
      </div>
    </div>
  );
};
