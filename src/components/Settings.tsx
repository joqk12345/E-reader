import React, { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { open as openExternal } from '@tauri-apps/plugin-shell';
import { useStore } from '../store/useStore';
import {
  formatShortcutListInput,
  normalizeKeymap,
  parseShortcutListInput,
  type Keymap,
} from '../utils/shortcuts';
import {  LEGACY_READER_BACKGROUND,
  READER_THEMES,
  clamp,
  loadReaderViewSettings,
  persistReaderViewSettings,
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
import { AiProfilesPanel } from './settings/AiProfilesPanel';
import type { SettingsSection } from './settings/settingsTypes';
import { useAppTheme } from '../features/app/useAppTheme';
import type { AppThemePreference } from './appTheme';
import { Input } from './ui/Input';
import { Select } from './ui/Select';
import { Button } from './ui/Button';
import {
  checkForUpdates,
  clearDismissedUpdateVersion,
  getDismissedUpdateVersion,
  getErrorMessage,
  isAutoUpdateEnabled,
  loadCachedUpdateResult,
  saveUpdateResult,
  setAutoUpdateEnabled,
  setDismissedUpdateVersion,
  UPDATE_CHECK_INTERVAL_MS,
  type UpdateCheckResult,
  type UpdateTarget,
} from '../services/updater';

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
  enable_thinking: boolean;
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

interface McpStatus {
  project_root: string;
  config_path: string;
  config_exists: boolean;
  launcher_path: string;
  launcher_exists: boolean;
  reader_configured: boolean;
  configured_command: string | null;
  configured_args: string[];
  tool_names: string[];
  tools_available: number;
  resources_available: number;
  connected_clients: number | null;
  transport: string;
  server_version: string | null;
  test_ok: boolean;
  test_error: string | null;
  checked_at: number;
}

const MCP_SETUP_DOCS_URL = 'https://vmark.app/guide/mcp-setup.html';
const MCP_UI_PREFS_KEY = 'reader-mcp-ui-prefs';
const APP_WEBSITE_URL = 'https://joqk12345.github.io/E-reader/';
const APP_GITHUB_URL = 'https://github.com/joqk12345/E-reader.git';
const APP_RELEASES_URL = 'https://github.com/joqk12345/E-reader/releases';

const normalizeVersionForDisplay = (version: string): string => version.trim().replace(/^v/i, '') || '—';

interface McpUiPrefs {
  startOnLaunch: boolean;
  autoApproveEdits: boolean;
}

const defaultMcpUiPrefs: McpUiPrefs = {
  startOnLaunch: true,
  autoApproveEdits: false,
};

const loadMcpUiPrefs = (): McpUiPrefs => {
  try {
    const raw = localStorage.getItem(MCP_UI_PREFS_KEY);
    if (!raw) return defaultMcpUiPrefs;
    const parsed = JSON.parse(raw) as Partial<McpUiPrefs>;
    return {
      startOnLaunch: parsed.startOnLaunch ?? defaultMcpUiPrefs.startOnLaunch,
      autoApproveEdits: parsed.autoApproveEdits ?? defaultMcpUiPrefs.autoApproveEdits,
    };
  } catch {
    return defaultMcpUiPrefs;
  }
};

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
  if (type === 'editor') {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M5 6h14M12 6v12M8 18h8" />
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
  if (type === 'integrations') {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M8 7V5a2 2 0 1 1 4 0v2" />
        <path d="M12 17v2a2 2 0 1 0 4 0v-2" />
        <path d="M6 9h10a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 1 2-2Z" />
      </svg>
    );
  }
  if (type === 'about') {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 10v6" />
        <circle cx="12" cy="7.5" r="0.8" fill="currentColor" stroke="none" />
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
  const { preference: appTheme, setPreference: setAppTheme } = useAppTheme();
  const loadAppConfig = useStore((state) => state.loadConfig);
  const setReaderBackgroundColor = useStore((state) => state.setReaderBackgroundColor);
  const setReaderFontSize = useStore((state) => state.setReaderFontSize);
  const settingsShellRef = useRef<HTMLDivElement | null>(null);
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
    enable_thinking: false,
    openai_api_key: '',
    openai_base_url: 'https://api.openai.com/v1',
    tts_provider: 'auto',
    edge_tts_voice: 'en-US-AriaNeural',
    edge_tts_proxy: '',
    cosyvoice_base_url: '',
    cosyvoice_api_key: '',
    translation_mode: 'off',
    reader_background_color: LEGACY_READER_BACKGROUND,
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
  const [mcpStatus, setMcpStatus] = useState<McpStatus | null>(null);
  const [isTestingMcp, setIsTestingMcp] = useState(false);
  const [isTogglingMcp, setIsTogglingMcp] = useState(false);
  const [mcpUiPrefs, setMcpUiPrefs] = useState<McpUiPrefs>(() => loadMcpUiPrefs());
  const [appVersion, setAppVersion] = useState('—');
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(() => loadCachedUpdateResult());
  const [autoUpdatesEnabled, setAutoUpdatesEnabled] = useState<boolean>(() => isAutoUpdateEnabled());

  useEffect(() => {
    void loadConfig();
  }, []);

  useEffect(() => {
    let active = true;
    const loadVersion = async () => {
      try {
        const version = await getVersion();
        if (active) setAppVersion(version);
      } catch (error) {
        console.warn('Failed to load app version:', error);
      }
    };
    void loadVersion();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    const panel = settingsShellRef.current;
    if (!panel) return;
    const previousActiveElement = document.activeElement as HTMLElement | null;
    const getFocusableElements = () =>
      Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );

    requestAnimationFrame(() => {
      getFocusableElements()[0]?.focus();
    });

    const onTab = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const focusable = getFocusableElements();
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onTab);
    return () => {
      document.removeEventListener('keydown', onTab);
      previousActiveElement?.focus();
    };
  }, []);

  useEffect(() => {
    persistReaderViewSettings(readerViewSettings);
  }, [readerViewSettings]);

  useEffect(() => {
    setActiveSection(initialSection);
  }, [initialSection]);

  const loadMcpStatus = useCallback(async (checkConnection = false) => {
    if (checkConnection) setIsTestingMcp(true);
    try {
      const status = await invoke<McpStatus>('get_mcp_status', { checkConnection });
      setMcpStatus(status);
      if (checkConnection) {
        if (status.test_ok) {
          setMessage({ type: 'success', text: 'Reader MCP server is reachable.' });
        } else {
          setMessage({
            type: 'error',
            text: status.test_error || 'Reader MCP server check failed.',
          });
        }
      }
    } catch (error) {
      console.error('Failed to load MCP status:', error);
      if (checkConnection) {
        setMessage({ type: 'error', text: 'Failed to test MCP server connection.' });
      }
    } finally {
      if (checkConnection) setIsTestingMcp(false);
    }
  }, []);

  const handleCopy = async (text: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setMessage({ type: 'success', text: successMessage });
    } catch {
      setMessage({ type: 'error', text: 'Failed to copy to clipboard.' });
    }
  };

  const openExternalUrl = useCallback((url: string) => {
    return openExternal(url).catch((error) => {
      console.warn('Failed to open external link via shell plugin, fallback to window.open:', error);
      window.open(url, '_blank', 'noopener,noreferrer');
    });
  }, []);

  const handleExternalLinkClick = useCallback((event: React.MouseEvent<HTMLAnchorElement>, url: string) => {
    event.preventDefault();
    void openExternalUrl(url);
  }, [openExternalUrl]);

  const runUpdateCheck = useCallback(async (manual: boolean) => {
    setIsCheckingUpdates(true);
    try {
      const currentVersion = await getVersion();
      const target = await invoke<UpdateTarget>('get_update_target');
      const result = await checkForUpdates(currentVersion, target);
      setUpdateResult(result);
      saveUpdateResult(result);
      const dismissedVersion = getDismissedUpdateVersion();
      if (dismissedVersion && dismissedVersion !== result.latestVersion) {
        clearDismissedUpdateVersion();
      }
      if (manual) {
        setMessage({
          type: 'success',
          text: result.updateAvailable
            ? `Update ${result.latestVersion} is available.`
            : `Reader is up to date (${result.currentVersion}).`,
        });
      }
    } catch (error) {
      const text = getErrorMessage(error);
      setUpdateResult((previous) => ({
        currentVersion: previous?.currentVersion || normalizeVersionForDisplay(appVersion),
        latestVersion: previous?.latestVersion || '—',
        updateAvailable: false,
        releaseUrl: previous?.releaseUrl || APP_RELEASES_URL,
        downloadUrl: previous?.downloadUrl || null,
        releaseName: previous?.releaseName || null,
        publishedAt: previous?.publishedAt || null,
        notes: previous?.notes || null,
        checkedAt: Date.now(),
        error: text,
      }));
      if (manual) {
        setMessage({ type: 'error', text });
      }
    } finally {
      setIsCheckingUpdates(false);
    }
  }, [appVersion]);

  useEffect(() => {
    if (activeSection !== 'about' || isCheckingUpdates) return;
    if (!autoUpdatesEnabled) return;
    const isStale = !updateResult || Date.now() - updateResult.checkedAt >= UPDATE_CHECK_INTERVAL_MS;
    if (isStale) {
      void runUpdateCheck(false);
    }
  }, [activeSection, autoUpdatesEnabled, isCheckingUpdates, runUpdateCheck, updateResult]);

  const handleToggleAutoUpdates = (next: boolean) => {
    setAutoUpdatesEnabled(next);
    setAutoUpdateEnabled(next);
    if (next) {
      void runUpdateCheck(false);
    }
  };

  const handleSkipThisVersion = () => {
    if (!updateResult?.latestVersion) return;
    setDismissedUpdateVersion(updateResult.latestVersion);
    setMessage({
      type: 'success',
      text: `Skipped update v${updateResult.latestVersion}.`,
    });
  };

  const updateMcpUiPrefs = (patch: Partial<McpUiPrefs>) => {
    setMcpUiPrefs((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(MCP_UI_PREFS_KEY, JSON.stringify(next));
      } catch (error) {
        console.warn('Failed to persist MCP UI preferences:', error);
      }
      return next;
    });
  };

  const handleToggleMcpEnabled = async (enabled: boolean) => {
    setIsTogglingMcp(true);
    try {
      const status = await invoke<McpStatus>('set_mcp_reader_enabled', { enabled });
      setMcpStatus(status);
      setMessage({
        type: 'success',
        text: enabled ? 'Reader MCP server enabled in .mcp.json.' : 'Reader MCP server disabled in .mcp.json.',
      });
      if (enabled) {
        await loadMcpStatus(true);
      }
    } catch (error) {
      console.error('Failed to update MCP config:', error);
      setMessage({ type: 'error', text: getErrorMessage(error) || 'Failed to update MCP configuration.' });
    } finally {
      setIsTogglingMcp(false);
    }
  };

  useEffect(() => {
    if (activeSection !== 'integrations') return;
    let cancelled = false;
    const refresh = async () => {
      if (cancelled || isTestingMcp || isTogglingMcp) return;
      await loadMcpStatus(false);
    };

    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeSection, isTestingMcp, isTogglingMcp, loadMcpStatus]);

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
      await loadMcpStatus(false);
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
      persistReaderViewSettings(readerViewSettings);
      setReaderBackgroundColor(nextConfig.reader_background_color);
      setReaderFontSize(readerViewSettings.fontSize);
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
      if (key === 'contentWidth') return { ...prev, contentWidth: clamp(prev.contentWidth + delta, 36, 120) };
      return {
        ...prev,
        cjkLetterSpacing: clamp(Math.round((prev.cjkLetterSpacing + delta) * 100) / 100, 0.02, 0.12),
      };
    });
  };

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 backdrop-blur-sm">
        <div className="rounded-panel bg-surface p-8 shadow-panel">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-action" />
        </div>
      </div>
    );
  }

  const navGroups: Array<{ label: string; items: Array<{ id: SettingsSection; label: string }> }> = [
    {
      label: 'Reading',
      items: [
        { id: 'reading', label: 'Appearance' },
        { id: 'editor', label: 'Typography' },
        { id: 'translation', label: 'Translation' },
      ],
    },
    {
      label: 'Assistive tools',
      items: [
        { id: 'ai', label: 'AI & Embedding' },
        { id: 'audio', label: 'Audio' },
      ],
    },
    {
      label: 'Workspace',
      items: [
        { id: 'shortcuts', label: 'Shortcuts' },
        { id: 'integrations', label: 'Integrations' },
      ],
    },
    {
      label: 'Reader',
      items: [{ id: 'about', label: 'About' }],
    },
  ];

  const sectionDetails: Record<SettingsSection, { eyebrow: string; title: string; description: string }> = {
    reading: { eyebrow: 'Reading', title: 'Appearance', description: 'Set the atmosphere for every reading session.' },
    editor: { eyebrow: 'Reading', title: 'Typography', description: 'Tune the page so long passages remain comfortable.' },
    translation: { eyebrow: 'Reading', title: 'Translation', description: 'Choose how source text and translations meet.' },
    ai: { eyebrow: 'Assistive tools', title: 'AI & Embedding', description: 'Connect the models that help you understand what you read.' },
    audio: { eyebrow: 'Assistive tools', title: 'Audio', description: 'Configure narration and playback services.' },
    shortcuts: { eyebrow: 'Workspace', title: 'Shortcuts', description: 'Make frequent reading actions feel effortless.' },
    integrations: { eyebrow: 'Workspace', title: 'Integrations', description: 'Connect Reader to the tools around your library.' },
    about: { eyebrow: 'Reader', title: 'About', description: 'Version, updates, and project information.' },
  };
  const activeSectionDetails = sectionDetails[activeSection];

  const edgeDisabled = config.tts_provider === 'cosyvoice';
  const cosyDisabled = config.tts_provider === 'edge';
  const mcpEnabled = Boolean(mcpStatus?.reader_configured);
  const mcpConnectedClients = mcpStatus?.connected_clients ?? 0;
  const mcpRunning = Boolean(mcpStatus?.test_ok) || mcpConnectedClients > 0;
  const mcpConnectionText = isTestingMcp
    ? 'Checking'
    : mcpRunning
      ? 'Running'
      : mcpEnabled
        ? 'Enabled'
        : 'Stopped';
  const mcpCheckedAt = mcpStatus?.checked_at
    ? new Date(mcpStatus.checked_at).toLocaleString()
    : '—';
  const mcpVersion = mcpStatus?.server_version || '0.1.0';
  const mcpLaunchCommand = [
    mcpStatus?.configured_command || mcpStatus?.launcher_path || '',
    ...(mcpStatus?.configured_args || []),
  ]
    .filter(Boolean)
    .join(' ');
  const listeningLabel = mcpStatus?.transport === 'stdio' ? 'stdio' : mcpStatus?.transport || '—';
  const mcpSnippet = JSON.stringify(
    {
      mcpServers: {
        reader: {
          command: mcpStatus?.launcher_path || './mcp-server/bin/reader-mcp-server.sh',
        },
      },
    },
    null,
    2
  );
  const updateCheckedAt = updateResult?.checkedAt
    ? new Date(updateResult.checkedAt).toLocaleString()
    : '—';
  const dismissedVersion = getDismissedUpdateVersion();
  const isDismissedVersion = Boolean(updateResult?.latestVersion && dismissedVersion === updateResult.latestVersion);
  const showUpdateAvailableCard = Boolean(updateResult?.updateAvailable && !isDismissedVersion);
  const updatePublishedAt = updateResult?.publishedAt
    ? new Date(updateResult.publishedAt).toLocaleDateString()
    : '—';
  const updateStatusText = isCheckingUpdates
    ? 'Checking for updates...'
    : updateResult?.error
      ? `Check failed: ${updateResult.error}`
      : updateResult?.updateAvailable
        ? isDismissedVersion
          ? `v${updateResult.latestVersion} available (skipped)`
          : `v${updateResult.latestVersion} available`
        : updateResult
          ? `Up to date (v${updateResult.currentVersion})`
          : 'Not checked yet';
  const updateSubtext = updateResult?.updateAvailable
    ? 'A newer release is available on GitHub.'
    : 'Reader currently ships through GitHub Releases and Homebrew Cask.';
  const updateTargetUrl = updateResult?.downloadUrl || updateResult?.releaseUrl || APP_RELEASES_URL;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        ref={settingsShellRef}
        data-settings-shell
        data-testid="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reader-settings-title"
        tabIndex={-1}
        className="flex h-[78vh] w-full max-w-[900px] overflow-hidden rounded-panel border border-border bg-surface-subtle shadow-panel"
        onClick={(event) => event.stopPropagation()}
      >
        <aside className="flex w-[208px] shrink-0 flex-col border-r border-border bg-surface px-3 py-4">
          <div className="mb-6 px-2">
            <div className="font-serif text-size-brand font-medium tracking-tight text-heading">Reader</div>
            <div className="mt-1 text-size-meta leading-4 text-muted">A quiet place for difficult books.</div>
          </div>
          <nav className="space-y-5">
            {navGroups.map((group) => (
              <div key={group.label}>
                <div className="mb-1 px-2 text-size-micro font-semibold uppercase tracking-[0.14em] text-faint">{group.label}</div>
                <div className="space-y-0.5">
                  {group.items.map((item) => {
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
                </div>
              </div>
            ))}
          </nav>
          <div className="mt-auto border-t border-border px-2 pt-4 text-size-meta leading-4 text-muted">
            App theme applies immediately. Reading preferences are saved with <span className="font-medium text-secondary">Save settings</span>.
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between border-b border-border bg-surface/90 px-8 py-4">
            <div className="flex items-center gap-2">
              <h1 id="reader-settings-title" className="font-serif text-size-display font-medium tracking-tight text-heading">Settings</h1>
              <span className="rounded-md border border-border bg-surface-subtle px-1.5 py-0.5 text-size-micro font-medium text-muted">⌘ ,</span>
            </div>
            <Button
              type="button"
              onClick={onClose}
              data-testid="settings-close-button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-size-title text-muted transition hover:bg-surface-hover hover:text-heading"
              aria-label="Close settings"
            >
              ×
            </Button>
          </header>

          <main className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
            <div className="mb-6">
              <div className="mb-2 text-size-micro font-semibold uppercase tracking-[0.16em] text-action">{activeSectionDetails.eyebrow}</div>
              <h2 className="font-serif text-size-hero font-medium leading-tight tracking-tight text-heading">{activeSectionDetails.title}</h2>
              <p className="mt-2 max-w-xl text-size-control leading-5 text-muted">{activeSectionDetails.description}</p>
            </div>

            {message && (
              <div className={`mb-4 rounded-xl border px-4 py-3 text-size-subheading ${message.type === 'success' ? 'border-success/25 bg-success/10 text-success' : 'border-danger/25 bg-danger-subtle text-danger'}`}>
                {message.text}
              </div>
            )}

            {activeSection === 'reading' && (
              <>
                <SettingsCard>
                <SettingRow
                  title="App theme"
                  description="Set the appearance of the Reader workspace"
                  right={
                    <Select
                      aria-label="App theme"
                      className={`${compactControlClass} w-[200px]`}
                      value={appTheme}
                      onChange={(event) => setAppTheme(event.target.value as AppThemePreference)}
                    >
                      <option value="system">System</option>
                      <option value="light">Light</option>
                      <option value="dark">Dark</option>
                    </Select>
                  }
                />
                <SettingsDivider />
                <SettingRow
                  title="Theme"
                  description="Choose your reading canvas"
                  right={
                    <div className="flex items-center gap-3">
                      {themeOrder.map((id) => (
                        <Button
                          key={id}
                          type="button"
                          onClick={() => setReaderViewSettings((prev) => ({ ...prev, theme: id }))}
                          aria-label={`Use ${id} reading theme`}
                          aria-pressed={readerViewSettings.theme === id}
                          className="h-7 w-7 rounded-full border-2"
                          style={{
                            backgroundColor: READER_THEMES[id].background,
                            borderColor: readerViewSettings.theme === id ? 'rgb(var(--color-action))' : 'transparent',
                          }}
                        />
                      ))}
                    </div>
                  }
                />
                <SettingsDivider />
                <SettingRow
                  title="Column Layout"
                  description="Switch between single-column and two-column reading"
                  right={
                    <Select
                      className={`${compactControlClass} w-[200px]`}
                      value={readerViewSettings.layoutMode}
                      onChange={(e) =>
                        setReaderViewSettings((prev) => ({
                          ...prev,
                          layoutMode: e.target.value as 'single' | 'double',
                        }))
                      }
                    >
                      <option value="single">Single Column</option>
                      <option value="double">Two Columns</option>
                    </Select>
                  }
                />
                <SettingRow
                  title="Bilingual View"
                  description="Default display mode for source/translation in reader toolbar"
                  right={
                    <Select
                      className={`${compactControlClass} w-[240px]`}
                      value={readerViewSettings.bilingualViewMode}
                      onChange={(e) =>
                        setReaderViewSettings((prev) => ({
                          ...prev,
                          bilingualViewMode: e.target.value as 'both' | 'source' | 'translation',
                        }))
                      }
                    >
                      <option value="both">Source + Translation</option>
                      <option value="source">Source Only</option>
                      <option value="translation">Translation Only</option>
                    </Select>
                  }
                />
                </SettingsCard>
                <div
                className="mt-4 overflow-hidden rounded-2xl border p-5 transition-colors"
                style={{
                  backgroundColor: READER_THEMES[readerViewSettings.theme].background,
                  borderColor: READER_THEMES[readerViewSettings.theme].border,
                  color: READER_THEMES[readerViewSettings.theme].foreground,
                }}
                aria-live="polite"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-size-micro font-semibold uppercase tracking-[0.14em] opacity-70">Live preview</span>
                  <span className="text-size-caption opacity-70">{readerViewSettings.theme}</span>
                </div>
                <p className="mt-4 font-serif text-size-hero-sm leading-tight">A quiet page for difficult books.</p>
                <p className="mt-2 max-w-xl text-size-control leading-6 opacity-80">
                  Theme changes are previewed here immediately and applied to the reader when you save.
                </p>
                <div
                  className="mt-4 rounded-xl border px-4 py-3 text-size-control"
                  style={{
                    backgroundColor: READER_THEMES[readerViewSettings.theme].secondary,
                    borderColor: READER_THEMES[readerViewSettings.theme].border,
                  }}
                >
                  Reading surface · Aa 123
                </div>
                </div>
              </>
            )}

            {activeSection === 'editor' && (
              <SettingsCard>
                <SettingRow
                  title="Font Size"
                  description="Main reading text size"
                  right={
                    <>
                      <Button type="button" aria-label="Decrease font size" className="h-8 w-8 rounded-lg border border-control-border bg-surface text-size-body text-secondary transition hover:bg-surface-hover" onClick={() => adjustReaderSetting('fontSize', -1)}>−</Button>
                      <Button type="button" aria-label="Increase font size" className="h-8 w-8 rounded-lg border border-control-border bg-surface text-size-body text-secondary transition hover:bg-surface-hover" onClick={() => adjustReaderSetting('fontSize', 1)}>+</Button>
                      <span className="w-14 text-right text-size-control text-secondary">{readerViewSettings.fontSize}px</span>
                    </>
                  }
                />
                <SettingRow
                  title="Line Height"
                  description="Vertical rhythm and readability"
                  right={
                    <>
                      <Button type="button" aria-label="Decrease line height" className="h-8 w-8 rounded-lg border border-control-border bg-surface text-size-body text-secondary transition hover:bg-surface-hover" onClick={() => adjustReaderSetting('lineHeight', -0.1)}>−</Button>
                      <Button type="button" aria-label="Increase line height" className="h-8 w-8 rounded-lg border border-control-border bg-surface text-size-body text-secondary transition hover:bg-surface-hover" onClick={() => adjustReaderSetting('lineHeight', 0.1)}>+</Button>
                      <span className="w-14 text-right text-size-control text-secondary">{readerViewSettings.lineHeight.toFixed(1)}</span>
                    </>
                  }
                />
                <SettingRow
                  title="Content Width"
                  description="Set line length for focus"
                  right={
                    <>
                      <Button type="button" aria-label="Decrease content width" className="h-8 w-8 rounded-lg border border-control-border bg-surface text-size-body text-secondary transition hover:bg-surface-hover" onClick={() => adjustReaderSetting('contentWidth', -2)}>−</Button>
                      <Button type="button" aria-label="Increase content width" className="h-8 w-8 rounded-lg border border-control-border bg-surface text-size-body text-secondary transition hover:bg-surface-hover" onClick={() => adjustReaderSetting('contentWidth', 2)}>+</Button>
                      <span className="w-14 text-right text-size-control text-secondary">{readerViewSettings.contentWidth}em</span>
                    </>
                  }
                />
                <SettingRow
                  title="CJK Letter Spacing"
                  description="Spacing between CJK characters"
                  right={
                    <>
                      <Button type="button" aria-label="Decrease CJK letter spacing" className="h-8 w-8 rounded-lg border border-control-border bg-surface text-size-body text-secondary transition hover:bg-surface-hover" onClick={() => adjustReaderSetting('cjkLetterSpacing', -0.01)}>−</Button>
                      <Button type="button" aria-label="Increase CJK letter spacing" className="h-8 w-8 rounded-lg border border-control-border bg-surface text-size-body text-secondary transition hover:bg-surface-hover" onClick={() => adjustReaderSetting('cjkLetterSpacing', 0.01)}>+</Button>
                      <span className="w-14 text-right text-size-control text-secondary">{readerViewSettings.cjkLetterSpacing.toFixed(2)}em</span>
                    </>
                  }
                />
                <SettingRow
                  title="CJK Spacing Toggle"
                  description="Enable/disable CJK spacing effect"
                  right={<ToggleSwitch label="Enable CJK letter spacing" checked={readerViewSettings.cjkLetterSpacingEnabled} onChange={(next) => setReaderViewSettings((prev) => ({ ...prev, cjkLetterSpacingEnabled: next }))} />}
                />
                <SettingRow
                  title="Expand Details"
                  description="Automatically expand all details blocks"
                  right={<ToggleSwitch label="Expand details automatically" checked={readerViewSettings.expandDetails} onChange={(next) => setReaderViewSettings((prev) => ({ ...prev, expandDetails: next }))} />}
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
                      label="Enable bilingual translation"
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
                    <Select
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
                    </Select>
                  }
                  disabled={config.translation_mode === 'off'}
                />
              </SettingsCard>
            )}

            {activeSection === 'ai' && (
              <AiProfilesPanel />
            )}

            {activeSection === 'audio' && (
              <SettingsCard>
                <SettingRow
                  title="TTS Provider"
                  description="Select speech engine"
                  right={
                    <Select className={`${compactControlClass} w-[260px]`} value={config.tts_provider} onChange={(e) => setConfig((prev) => ({ ...prev, tts_provider: e.target.value as 'auto' | 'edge' | 'cosyvoice' }))}>
                      <option value="auto">Auto</option>
                      <option value="edge">Edge TTS</option>
                      <option value="cosyvoice">CosyVoice</option>
                    </Select>
                  }
                />
                <SettingsDivider />
                <SettingRow
                  title="Edge Voice"
                  description="Voice preset for Edge TTS"
                  right={<Input className={`${compactControlClass} w-[260px]`} disabled={edgeDisabled} value={config.edge_tts_voice || ''} onChange={(e) => setConfig((prev) => ({ ...prev, edge_tts_voice: e.target.value }))} />}
                  disabled={edgeDisabled}
                />
                <SettingRow
                  title="Edge Proxy"
                  description="Optional network proxy"
                  right={<Input className={`${compactControlClass} w-[260px]`} disabled={edgeDisabled} value={config.edge_tts_proxy || ''} onChange={(e) => setConfig((prev) => ({ ...prev, edge_tts_proxy: e.target.value }))} />}
                  disabled={edgeDisabled}
                />
                <SettingRow
                  title="CosyVoice URL"
                  description="Endpoint for CosyVoice service"
                  right={<Input className={`${compactControlClass} w-[260px]`} disabled={cosyDisabled} value={config.cosyvoice_base_url || ''} onChange={(e) => setConfig((prev) => ({ ...prev, cosyvoice_base_url: e.target.value }))} />}
                  disabled={cosyDisabled}
                />
                <SettingRow
                  title="CosyVoice API Key"
                  description="Optional auth token"
                  right={<Input type="password" className={`${compactControlClass} w-[260px]`} disabled={cosyDisabled} value={config.cosyvoice_api_key || ''} onChange={(e) => setConfig((prev) => ({ ...prev, cosyvoice_api_key: e.target.value }))} />}
                  disabled={cosyDisabled}
                />
              </SettingsCard>
            )}

            {activeSection === 'shortcuts' && (
              <SettingsCard>
                <SettingRow title="Next Page" description="Move to next section" right={<Input className={`${compactControlClass} w-[260px]`} value={shortcutInput.next_page} onChange={handleShortcutChange('next_page')} />} />
                <SettingRow title="Previous Page" description="Move to previous section" right={<Input className={`${compactControlClass} w-[260px]`} value={shortcutInput.prev_page} onChange={handleShortcutChange('prev_page')} />} />
                <SettingRow title="Open Settings" description="Quickly open this panel" right={<Input className={`${compactControlClass} w-[260px]`} value={shortcutInput.open_settings} onChange={handleShortcutChange('open_settings')} />} />
                <SettingRow title="Toggle Maximize Window" description="Maximize or restore app window" right={<Input className={`${compactControlClass} w-[260px]`} value={shortcutInput.toggle_window_maximize} onChange={handleShortcutChange('toggle_window_maximize')} />} />
                <SettingRow title="Toggle Header Toolbar" description="Show or hide reader header tools" right={<Input className={`${compactControlClass} w-[260px]`} value={shortcutInput.toggle_header_tools} onChange={handleShortcutChange('toggle_header_tools')} />} />
                <SettingRow title="Increase Font Size" description="Increase reader font size" right={<Input className={`${compactControlClass} w-[260px]`} value={shortcutInput.font_increase} onChange={handleShortcutChange('font_increase')} />} />
                <SettingRow title="Decrease Font Size" description="Decrease reader font size" right={<Input className={`${compactControlClass} w-[260px]`} value={shortcutInput.font_decrease} onChange={handleShortcutChange('font_decrease')} />} />
                <SettingRow title="Reset Font Size" description="Reset reader font size to default" right={<Input className={`${compactControlClass} w-[260px]`} value={shortcutInput.font_reset} onChange={handleShortcutChange('font_reset')} />} />
                <SettingRow title="Open Search" description="Focus search tool" right={<Input className={`${compactControlClass} w-[260px]`} value={shortcutInput.open_search} onChange={handleShortcutChange('open_search')} />} />
                <SettingRow title="Audio Play" description="Start playback" right={<Input className={`${compactControlClass} w-[260px]`} value={shortcutInput.audio_play} onChange={handleShortcutChange('audio_play')} />} />
                <SettingRow title="Audio Pause/Resume" description="Toggle pause" right={<Input className={`${compactControlClass} w-[260px]`} value={shortcutInput.audio_toggle_pause} onChange={handleShortcutChange('audio_toggle_pause')} />} />
                <SettingRow title="Audio Stop" description="Stop playback" right={<Input className={`${compactControlClass} w-[260px]`} value={shortcutInput.audio_stop} onChange={handleShortcutChange('audio_stop')} />} />
                <SettingRow title="Toggle Reading Mode" description="Enter/exit minimal reader mode" right={<Input className={`${compactControlClass} w-[260px]`} value={shortcutInput.toggle_reading_mode} onChange={handleShortcutChange('toggle_reading_mode')} />} />
              </SettingsCard>
            )}

            {activeSection === 'integrations' && (
              <div className="space-y-4">
                <SettingsCard>
                  <SettingRow
                    title="Enable MCP Server"
                    description="Allow AI assistants to access Reader business tools"
                    right={
                      <>
                        <StatusDot success={mcpRunning || mcpEnabled} text={mcpConnectionText} />
                        <ToggleSwitch
                          label="Enable MCP server"
                          checked={mcpEnabled}
                          disabled={isTogglingMcp}
                          onChange={(next) => void handleToggleMcpEnabled(next)}
                        />
                      </>
                    }
                  />
                  <SettingRow
                    title="Start on launch"
                    description="Auto-load Reader MCP configuration when Reader opens"
                    right={
                      <ToggleSwitch
                        label="Start MCP on launch"
                        checked={mcpUiPrefs.startOnLaunch}
                        onChange={(next) => updateMcpUiPrefs({ startOnLaunch: next })}
                      />
                    }
                  />
                  <SettingRow
                    title="Auto-approve edits"
                    description="Apply MCP-driven edits without confirmation (use with caution)"
                    right={
                      <ToggleSwitch
                        label="Auto-approve MCP edits"
                        checked={mcpUiPrefs.autoApproveEdits}
                        onChange={(next) => updateMcpUiPrefs({ autoApproveEdits: next })}
                      />
                    }
                  />
                  <SettingsDivider />
                  <div className="px-1 py-2">
                    <p className="flex items-center gap-2 text-size-control text-muted">
                      <span>Listening on</span>
                      <code className="rounded bg-surface-subtle px-2 py-0.5 font-mono text-size-caption text-secondary">{listeningLabel}</code>
                      <Button
                        type="button"
                        onClick={() => void handleCopy(mcpLaunchCommand || mcpSnippet, 'MCP command copied.')}
                        className="rounded border border-control-border bg-surface px-1.5 py-0.5 text-size-meta text-navigation hover:bg-surface-subtle"
                      >
                        Copy
                      </Button>
                    </p>
                    <p className="mt-2 text-size-caption text-muted">
                      Project-level stdio MCP server. AI clients discover it via <code>.mcp.json</code>.
                    </p>
                  </div>
                  <SettingsDivider />
                  <div className="flex items-center gap-2 py-1">
                    <Button
                      type="button"
                      onClick={() => void loadMcpStatus(true)}
                      disabled={isTestingMcp}
                      className="rounded-lg border border-control-border bg-surface-subtle px-2.5 py-1.5 text-size-control text-secondary shadow-sm hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isTestingMcp ? 'Checking...' : 'Test Connection'}
                    </Button>
                    <Button
                      type="button"
                      onClick={() => void loadMcpStatus(false)}
                      className="rounded-lg border border-control-border bg-surface px-2.5 py-1.5 text-size-control text-secondary hover:bg-surface-subtle"
                    >
                      Refresh Status
                    </Button>
                  </div>
                </SettingsCard>

                <SettingsCard>
                  <KVInfo
                    rows={[
                      {
                        key: 'Version',
                        value: <span className="font-mono text-size-meta text-secondary">{mcpVersion}</span>,
                      },
                      {
                        key: 'Tools Available',
                        value: (
                          <span className="font-medium text-action">{mcpStatus?.tools_available ?? '—'} tools</span>
                        ),
                      },
                      {
                        key: 'Resources Available',
                        value: <span className="font-medium text-secondary">{mcpStatus?.resources_available ?? 0}</span>,
                      },
                      {
                        key: 'Connected Clients',
                        value: <span className="font-medium text-success">{mcpConnectedClients}</span>,
                      },
                      {
                        key: 'Last Checked',
                        value: <span className="text-secondary">{mcpCheckedAt}</span>,
                      },
                      {
                        key: 'Config',
                        value: (
                          <span className="font-mono text-size-meta text-secondary">
                            {mcpStatus?.config_exists ? 'loaded' : 'missing'}
                          </span>
                        ),
                      },
                    ]}
                  />
                  {mcpStatus?.test_error ? (
                    <div className="mt-3 rounded-lg border border-danger/25 bg-danger-subtle px-3 py-2 text-size-caption text-danger">
                      {mcpStatus.test_error}
                    </div>
                  ) : null}
                </SettingsCard>

                <SettingsCard>
                  <div className="space-y-3 py-2">
                    <div className="flex items-center justify-between">
                      <div className="text-size-subheading font-semibold text-heading">Install MCP Configuration</div>
                      <Button
                        type="button"
                        onClick={() => void handleCopy(mcpSnippet, 'MCP snippet copied.')}
                        className="rounded-lg border border-control-border bg-surface px-2.5 py-1 text-size-caption text-secondary hover:bg-surface-subtle"
                      >
                        Copy
                      </Button>
                    </div>
                    <pre className="overflow-x-auto rounded-lg bg-heading p-3 text-size-caption text-surface-subtle">{mcpSnippet}</pre>
                    <a
                      href={MCP_SETUP_DOCS_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-size-control text-action hover:underline"
                    >
                      MCP Setup Guide ↗
                    </a>
                  </div>
                </SettingsCard>
              </div>
            )}

            {activeSection === 'about' && (
              <div className="space-y-3">
                <SettingsCard>
                  <div className="flex items-start justify-between gap-3 px-1 py-1">
                    <a
                      href={APP_WEBSITE_URL}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(event) => handleExternalLinkClick(event, APP_WEBSITE_URL)}
                      className="flex items-center gap-3 group"
                    >
                      <img
                        src="/reader-logo.svg"
                        alt="Reader Logo"
                        className="h-14 w-14 rounded-xl border border-border bg-surface p-1 shadow-sm"
                      />
                      <div>
                        <div className="text-size-heading leading-none font-semibold tracking-tight text-heading group-hover:text-action">Reader</div>
                        <div className="mt-1 text-size-control text-muted">Version {appVersion}</div>
                      </div>
                    </a>
                    <div className="flex flex-col items-end gap-1.5 pt-1">
                      <a
                        href={APP_WEBSITE_URL}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(event) => handleExternalLinkClick(event, APP_WEBSITE_URL)}
                        className="flex items-center gap-1.5 text-size-label text-muted transition-colors hover:text-action"
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                          <circle cx="12" cy="12" r="9" />
                          <path d="M3 12h18M12 3a13.4 13.4 0 0 1 0 18M12 3a13.4 13.4 0 0 0 0 18" />
                        </svg>
                        <span>Website</span>
                      </a>
                      <a
                        href={APP_GITHUB_URL}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(event) => handleExternalLinkClick(event, APP_GITHUB_URL)}
                        className="flex items-center gap-1.5 text-size-label text-muted transition-colors hover:text-action"
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12 .5a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.5-1.4-1.3-1.8-1.3-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.8 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.6.1-3.2 0 0 1-.3 3.3 1.2a11.8 11.8 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.6.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.5-2.8 5.5-5.5 5.8.4.4.8 1.1.8 2.2v3.2c0 .3.2.7.8.6A12 12 0 0 0 12 .5Z" />
                        </svg>
                        <span>GitHub</span>
                      </a>
                    </div>
                  </div>
                </SettingsCard>

                {showUpdateAvailableCard && (
                  <SettingsCard>
                    <div className="flex items-start justify-between gap-4 px-1 py-1">
                      <div>
                        <div className="text-size-heading leading-tight font-semibold tracking-tight text-heading">Update Available</div>
                        <div className="mt-3 text-size-title leading-tight font-semibold tracking-tight text-heading">
                          Version {updateResult?.latestVersion}
                          <span className="ml-2 text-size-label font-medium text-faint">(current: {appVersion})</span>
                        </div>
                        <div className="mt-2 text-size-control text-muted">Released: {updatePublishedAt}</div>
                        <div className="mt-4 text-size-control text-muted">See release notes at</div>
                        <a
                          href={updateResult?.releaseUrl || APP_RELEASES_URL}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(event) => handleExternalLinkClick(event, updateResult?.releaseUrl || APP_RELEASES_URL)}
                          className="text-size-control text-navigation hover:text-action hover:underline break-all"
                        >
                          {updateResult?.releaseUrl || APP_RELEASES_URL}
                        </a>
                      </div>
                      <div className="flex min-w-[180px] flex-col gap-3">
                        <Button
                          type="button"
                          onClick={() => void openExternalUrl(updateTargetUrl)}
                          className="rounded-lg bg-action px-4 py-2.5 text-size-control font-medium text-on-action hover:bg-action-text"
                        >
                          Download
                        </Button>
                        <Button
                          type="button"
                          onClick={handleSkipThisVersion}
                          className="rounded-lg border border-control-border bg-surface px-4 py-2.5 text-size-control font-medium text-secondary hover:bg-surface-subtle"
                        >
                          Skip
                        </Button>
                      </div>
                    </div>
                  </SettingsCard>
                )}

                <SettingsCard>
                  <div className="space-y-3 px-1 py-1">
                    <div>
                      <div className="text-size-heading leading-tight font-semibold tracking-tight text-heading">Updates</div>
                    </div>
                    <div className="rounded-xl border border-border bg-surface-subtle px-4 py-3">
                      <SettingRow
                        title="Automatic updates"
                        description="Check for updates on startup"
                        right={<ToggleSwitch label="Enable automatic updates" checked={autoUpdatesEnabled} onChange={handleToggleAutoUpdates} />}
                      />
                      <SettingsDivider />
                      <div className="flex items-center justify-between gap-4">
                        <div className="text-size-label font-semibold text-heading">Check for updates</div>
                        <div className="flex items-center gap-4">
                          <div className="text-size-label text-action">{updateStatusText}</div>
                          <Button
                            type="button"
                            onClick={() => void runUpdateCheck(true)}
                            disabled={isCheckingUpdates}
                            className="rounded-lg border border-control-border bg-surface px-3 py-1.5 text-size-control font-medium text-secondary hover:bg-surface-subtle disabled:opacity-60"
                          >
                            {isCheckingUpdates ? 'Checking...' : 'Check Now'}
                          </Button>
                        </div>
                      </div>
                      <div className="mt-2 text-size-caption text-muted">Last checked: {updateCheckedAt}</div>
                    </div>
                    <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-surface-subtle px-4 py-3">
                      <div>
                        <div className="text-size-label font-semibold text-heading">Current version: {appVersion}</div>
                        <div className="text-size-control text-muted">{updateSubtext}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          onClick={() => void openExternalUrl(updateTargetUrl)}
                          className="min-w-[132px] rounded-lg bg-action px-2.5 py-1 text-size-caption font-medium text-on-action hover:bg-action-text"
                        >
                          {updateResult?.updateAvailable ? `Download v${updateResult.latestVersion}` : 'Open Releases'}
                        </Button>
                      </div>
                    </div>
                  </div>
                </SettingsCard>
              </div>
            )}
          </main>

          <footer className="flex items-center justify-between border-t border-border bg-surface/90 px-8 py-3">
            <SecondaryActionButton icon={<span>↻</span>} label="Reload" onClick={() => void loadConfig()} />

            <div className="flex items-center gap-3">
              <Button
                type="button"
                onClick={onClose}
                disabled={isSaving}
                className="rounded-xl border border-control-border bg-surface px-4 py-2 text-size-control font-medium text-secondary transition hover:bg-surface-hover disabled:opacity-50"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void handleSave()}
                disabled={isSaving}
                className="rounded-xl bg-action px-4 py-2 text-size-control font-medium text-on-action shadow-sm transition hover:bg-action-text disabled:opacity-50"
              >
                {isSaving ? 'Saving...' : 'Save Settings'}
              </Button>
            </div>
          </footer>
        </section>
      </div>
    </div>
  );
};
