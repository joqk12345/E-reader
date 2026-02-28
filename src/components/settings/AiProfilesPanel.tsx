import React, { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { compactControlClass, SettingsCard, SettingsDivider, StatusDot, ToggleSwitch } from './SettingsUI';

type ProviderType =
  | 'open_ai_compatible'
  | 'open_ai'
  | 'lm_studio'
  | 'ollama'
  | 'local_transformers'
  | 'openai_compatible'
  | 'openai'
  | 'lmstudio';
type ModelCapability = 'chat' | 'embedding' | 'multimodal';
type AgentSlot = 'chat' | 'summary' | 'translate' | 'deep_analyze' | 'embedding';

type ProviderProfile = {
  id: string;
  display_name: string;
  provider_type: ProviderType;
  base_url?: string;
  api_key?: string;
  enabled: boolean;
  test_model?: string;
  created_at: number;
  updated_at: number;
};

type ModelProfile = {
  id: string;
  provider_profile_id: string;
  profile_name: string;
  model_name: string;
  capability: ModelCapability;
  enabled: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  system_prompt?: string;
  enable_thinking?: boolean;
  embedding_dimension?: number;
  created_at: number;
  updated_at: number;
};

type AgentConfig = {
  slot: AgentSlot;
  primary_model_id?: string;
  fallback_model_id?: string;
  enabled: boolean;
  temperature?: number;
  max_tokens?: number;
  system_prompt?: string;
  target_language?: string;
  detail_level?: 'short' | 'medium' | 'detailed';
  warn_on_auto_summary?: boolean;
  translation_parallelism?: number;
};

type ProfilesPayload = {
  providers: ProviderProfile[];
  models: ModelProfile[];
  agents: AgentConfig[];
};

type ProviderTestResult = {
  ok: boolean;
  provider_type: string;
  endpoint: string;
  model: string;
  latency_ms?: number;
  detail: string;
};

type ModelTestResult = {
  ok: boolean;
  model_id: string;
  capability: string;
  endpoint: string;
  latency_ms?: number;
  detail: string;
};

const AGENT_SLOT_LABEL: Record<AgentSlot, string> = {
  chat: 'Chat',
  summary: 'Summary',
  translate: 'Translation',
  deep_analyze: 'Deep Analyze',
  embedding: 'Embedding',
};

const SLOT_ORDER: AgentSlot[] = ['chat', 'summary', 'translate', 'deep_analyze', 'embedding'];

const defaultProvider = (): ProviderProfile => ({
  id: '',
  display_name: '',
  provider_type: 'lm_studio',
  base_url: 'http://localhost:1234/v1',
  api_key: '',
  enabled: true,
  test_model: '',
  created_at: 0,
  updated_at: 0,
});

const providerTypeDefaults: Record<ProviderType, { name: string; baseUrl: string }> = {
  lm_studio: { name: 'LM Studio', baseUrl: 'http://localhost:1234/v1' },
  open_ai: { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  open_ai_compatible: { name: 'OpenAI Compatible', baseUrl: 'https://api.siliconflow.cn/v1' },
  ollama: { name: 'Ollama', baseUrl: 'http://localhost:11434/v1' },
  local_transformers: { name: 'Local Transformers', baseUrl: '' },
  lmstudio: { name: 'LM Studio', baseUrl: 'http://localhost:1234/v1' },
  openai: { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  openai_compatible: { name: 'OpenAI Compatible', baseUrl: 'https://api.siliconflow.cn/v1' },
};

const normalizeProviderType = (value: ProviderType): ProviderType => {
  if (value === 'lmstudio') return 'lm_studio';
  if (value === 'openai') return 'open_ai';
  if (value === 'openai_compatible') return 'open_ai_compatible';
  return value;
};

const defaultModel = (): ModelProfile => ({
  id: '',
  provider_profile_id: '',
  profile_name: '',
  model_name: '',
  capability: 'chat',
  enabled: true,
  temperature: undefined,
  max_tokens: undefined,
  top_p: undefined,
  system_prompt: '',
  enable_thinking: false,
  embedding_dimension: 384,
  created_at: 0,
  updated_at: 0,
});

const capabilityForSlot = (slot: AgentSlot): ModelCapability => {
  if (slot === 'embedding') return 'embedding';
  return 'chat';
};

const isLocalBaseUrl = (base?: string): boolean => {
  const v = (base || '').toLowerCase();
  return v.includes('localhost') || v.includes('127.0.0.1') || v.includes('0.0.0.0');
};

export const AiProfilesPanel: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'providers' | 'models' | 'agents'>('providers');
  const [profiles, setProfiles] = useState<ProfilesPayload>({ providers: [], models: [], agents: [] });

  const [selectedProviderId, setSelectedProviderId] = useState<string>('');
  const [selectedModelId, setSelectedModelId] = useState<string>('');
  const [selectedSlot, setSelectedSlot] = useState<AgentSlot>('summary');

  const [providerDraft, setProviderDraft] = useState<ProviderProfile>(defaultProvider());
  const [modelDraft, setModelDraft] = useState<ModelProfile>(defaultModel());
  const [agentDraft, setAgentDraft] = useState<AgentConfig | null>(null);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string>('');
  const [providerTestResult, setProviderTestResult] = useState<ProviderTestResult | null>(null);
  const [modelTestResult, setModelTestResult] = useState<ModelTestResult | null>(null);

  const loadProfiles = async () => {
    setLoading(true);
    try {
      const payload = await invoke<ProfilesPayload>('get_ai_profiles');
      setProfiles(payload);
      if (!selectedProviderId && payload.providers.length > 0) {
        setSelectedProviderId(payload.providers[0].id);
      }
      if (!selectedModelId && payload.models.length > 0) {
        setSelectedModelId(payload.models[0].id);
      }
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadProfiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const p = profiles.providers.find((x) => x.id === selectedProviderId);
    if (p) setProviderDraft({ ...p, provider_type: normalizeProviderType(p.provider_type) });
    else setProviderDraft(defaultProvider());
  }, [profiles.providers, selectedProviderId]);

  useEffect(() => {
    const m = profiles.models.find((x) => x.id === selectedModelId);
    if (m) setModelDraft({ ...m });
    else {
      const next = defaultModel();
      next.provider_profile_id = profiles.providers[0]?.id || '';
      setModelDraft(next);
    }
  }, [profiles.models, profiles.providers, selectedModelId]);

  useEffect(() => {
    const a = profiles.agents.find((x) => x.slot === selectedSlot);
    if (a) setAgentDraft({ ...a });
    else setAgentDraft({ slot: selectedSlot, enabled: true, translation_parallelism: selectedSlot === 'translate' ? 5 : undefined });
  }, [profiles.agents, selectedSlot]);

  const providerOptions = profiles.providers;
  const capability = capabilityForSlot(selectedSlot);
  const candidateModels = useMemo(
    () => profiles.models.filter((m) => (capability === 'embedding' ? m.capability === 'embedding' : m.capability === 'chat' || m.capability === 'multimodal')),
    [profiles.models, capability]
  );

  const saveProvider = async () => {
    setSaving(true);
    try {
      const saved = await invoke<ProviderProfile>('save_provider_profile', { profile: providerDraft });
      await loadProfiles();
      setSelectedProviderId(saved.id);
      setMessage('Provider saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const deleteProviderById = async (providerId: string) => {
    setSaving(true);
    try {
      await invoke('delete_provider_profile', { id: providerId });
      setSelectedProviderId('');
      await loadProfiles();
      setMessage('Provider deleted.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const testProvider = async () => {
    setSaving(true);
    setProviderTestResult(null);
    try {
      const result = await invoke<ProviderTestResult>('test_provider_profile', { profile: providerDraft });
      setProviderTestResult(result);
      setMessage(result.ok ? 'Provider test passed.' : 'Provider test failed.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const saveModel = async () => {
    setSaving(true);
    try {
      const payload: ModelProfile = {
        ...modelDraft,
        embedding_dimension: modelDraft.capability === 'embedding' ? modelDraft.embedding_dimension || 384 : undefined,
      };
      const saved = await invoke<ModelProfile>('save_model_profile', { model: payload });
      await loadProfiles();
      setSelectedModelId(saved.id);
      setMessage('Model saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const deleteModelById = async (modelId: string) => {
    setSaving(true);
    try {
      await invoke('delete_model_profile', { id: modelId });
      setSelectedModelId('');
      await loadProfiles();
      setMessage('Model deleted.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProviderClick = () => {
    if (!selectedProviderId) return;
    const targetId = selectedProviderId;
    const ok = window.confirm(
      'Delete this provider?\n\nModels still referencing it will block deletion.'
    );
    if (!ok) return;
    void deleteProviderById(targetId);
  };

  const handleDeleteModelClick = () => {
    if (!selectedModelId) return;
    const targetId = selectedModelId;
    const ok = window.confirm(
      'Delete this model?\n\nAgent slots still referencing it will block deletion.'
    );
    if (!ok) return;
    void deleteModelById(targetId);
  };

  const testModel = async () => {
    if (!modelDraft.id) {
      setMessage('Save model before testing.');
      return;
    }
    setSaving(true);
    setModelTestResult(null);
    try {
      const result = await invoke<ModelTestResult>('test_model_profile', {
        modelId: modelDraft.id,
      });
      setModelTestResult(result);
      setMessage(result.ok ? 'Model test passed.' : 'Model test failed.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const saveAgent = async () => {
    if (!agentDraft) return;
    setSaving(true);
    try {
      const saved = await invoke<AgentConfig>('save_agent_config', {
        slot: selectedSlot,
        configPatch: agentDraft,
      });
      await loadProfiles();
      setAgentDraft(saved);
      setMessage('Agent config saved.');
      window.dispatchEvent(new CustomEvent('reader://ai-profiles-updated'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const showApiKeyRequired =
    normalizeProviderType(providerDraft.provider_type) === 'open_ai' && !isLocalBaseUrl(providerDraft.base_url);

  const updateProviderType = (nextType: ProviderType) => {
    const normalizedNext = normalizeProviderType(nextType);
    setProviderDraft((prev) => {
      const normalizedPrev = normalizeProviderType(prev.provider_type);
      const prevDefaults = providerTypeDefaults[normalizedPrev];
      const nextDefaults = providerTypeDefaults[normalizedNext];
      const baseTrimmed = (prev.base_url || '').trim();
      const shouldSwapBase = !baseTrimmed || (prevDefaults ? baseTrimmed === prevDefaults.baseUrl : false);
      const shouldSwapName =
        !prev.display_name.trim() || (prevDefaults ? prev.display_name.trim() === prevDefaults.name : false);
      return {
        ...prev,
        provider_type: normalizedNext,
        base_url: shouldSwapBase ? nextDefaults?.baseUrl || prev.base_url : prev.base_url,
        display_name: shouldSwapName ? nextDefaults?.name || prev.display_name : prev.display_name,
      };
    });
  };

  return (
    <div className="space-y-4">
      <SettingsCard>
        <div className="flex items-center justify-between py-2">
          <div className="inline-flex rounded-lg border border-slate-300 bg-slate-100 p-0.5 text-sm">
            <button
              type="button"
              className={`rounded-md px-3 py-1.5 ${activeTab === 'providers' ? 'bg-white shadow-sm' : 'text-slate-600'}`}
              onClick={() => setActiveTab('providers')}
            >
              Providers
            </button>
            <button
              type="button"
              className={`rounded-md px-3 py-1.5 ${activeTab === 'models' ? 'bg-white shadow-sm' : 'text-slate-600'}`}
              onClick={() => setActiveTab('models')}
            >
              Models
            </button>
            <button
              type="button"
              className={`rounded-md px-3 py-1.5 ${activeTab === 'agents' ? 'bg-white shadow-sm' : 'text-slate-600'}`}
              onClick={() => setActiveTab('agents')}
            >
              Agents
            </button>
          </div>
          {loading ? <span className="text-xs text-slate-500">Loading...</span> : null}
        </div>
      </SettingsCard>

      {activeTab === 'providers' && (
        <div className="grid grid-cols-[240px_minmax(0,1fr)] gap-4">
          <SettingsCard>
            <div className="space-y-2 py-2">
              {providerOptions.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  onClick={() => setSelectedProviderId(p.id)}
                  className={`w-full rounded-md px-2 py-1.5 text-left text-sm ${selectedProviderId === p.id ? 'bg-blue-100 text-blue-700' : 'hover:bg-slate-100'}`}
                >
                  {p.display_name}
                </button>
              ))}
              <button
                type="button"
                className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-left text-sm"
                onClick={() => {
                  setSelectedProviderId('');
                  const next = defaultProvider();
                  next.display_name = `Provider ${profiles.providers.length + 1}`;
                  setProviderDraft(next);
                }}
              >
                + New Provider
              </button>
            </div>
          </SettingsCard>

          <SettingsCard>
            <div className="space-y-3 py-2">
              <label className="block text-sm">
                <span className="mb-1 block text-slate-600">Display Name</span>
                <input className={`${compactControlClass} w-full`} value={providerDraft.display_name} onChange={(e) => setProviderDraft((prev) => ({ ...prev, display_name: e.target.value }))} />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-slate-600">Provider Type</span>
                <select className={`${compactControlClass} w-full`} value={providerDraft.provider_type} onChange={(e) => updateProviderType(e.target.value as ProviderType)}>
                  <option value="lm_studio">LM Studio</option>
                  <option value="open_ai">OpenAI</option>
                  <option value="open_ai_compatible">OpenAI Compatible</option>
                  <option value="ollama">Ollama</option>
                  <option value="local_transformers">Local Transformers</option>
                </select>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-slate-600">Base URL</span>
                <input
                  className={`${compactControlClass} w-full`}
                  value={providerDraft.base_url || ''}
                  onChange={(e) => setProviderDraft((prev) => ({ ...prev, base_url: e.target.value }))}
                  disabled={providerDraft.provider_type === 'local_transformers'}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-slate-600">API Key {showApiKeyRequired ? '(Required)' : '(Optional)'}</span>
                <input type="password" className={`${compactControlClass} w-full`} value={providerDraft.api_key || ''} onChange={(e) => setProviderDraft((prev) => ({ ...prev, api_key: e.target.value }))} />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-slate-600">Test Model</span>
                <input className={`${compactControlClass} w-full`} value={providerDraft.test_model || ''} onChange={(e) => setProviderDraft((prev) => ({ ...prev, test_model: e.target.value }))} />
              </label>
              <div className="flex items-center justify-between py-1">
                <span className="text-sm text-slate-600">Enabled</span>
                <ToggleSwitch checked={providerDraft.enabled} onChange={(next) => setProviderDraft((prev) => ({ ...prev, enabled: next }))} />
              </div>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => void saveProvider()} disabled={saving} className="inline-flex h-8 items-center rounded-lg border border-slate-300 bg-slate-100 px-3 text-[13px] text-slate-700 shadow-sm hover:bg-slate-200 disabled:opacity-60">Save</button>
                <button type="button" onClick={() => setProviderDraft(selectedProviderId ? profiles.providers.find((p) => p.id === selectedProviderId) || defaultProvider() : defaultProvider())} disabled={saving} className="inline-flex h-8 items-center rounded-lg border border-slate-300 bg-white px-3 text-[13px] text-slate-700 hover:bg-slate-50 disabled:opacity-60">Reset</button>
                <button type="button" onClick={() => void testProvider()} disabled={saving} className="inline-flex h-8 items-center rounded-lg border border-blue-300 bg-blue-50 px-3 text-[13px] text-blue-700 hover:bg-blue-100 disabled:opacity-60">Test</button>
                <button
                  type="button"
                  onClick={handleDeleteProviderClick}
                  disabled={saving || !selectedProviderId}
                  className="inline-flex h-8 items-center rounded-lg border border-rose-300 bg-rose-50 px-3 text-[13px] text-rose-700 hover:bg-rose-100 disabled:opacity-60"
                >
                  Delete
                </button>
              </div>
              {providerTestResult ? (
                <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-sm">
                  <div className="mb-1 flex items-center gap-2">
                    <StatusDot success={providerTestResult.ok} text={providerTestResult.ok ? 'ok' : 'failed'} />
                    <span className="text-xs text-slate-500">{providerTestResult.endpoint}</span>
                  </div>
                  <div className="text-xs text-slate-600">{providerTestResult.detail}</div>
                </div>
              ) : null}
            </div>
          </SettingsCard>
        </div>
      )}

      {activeTab === 'models' && (
        <div className="grid grid-cols-[240px_minmax(0,1fr)] gap-4">
          <SettingsCard>
            <div className="space-y-2 py-2">
              {profiles.models.map((m) => (
                <button
                  type="button"
                  key={m.id}
                  onClick={() => setSelectedModelId(m.id)}
                  className={`w-full rounded-md px-2 py-1.5 text-left text-sm ${selectedModelId === m.id ? 'bg-blue-100 text-blue-700' : 'hover:bg-slate-100'}`}
                >
                  {m.profile_name}
                </button>
              ))}
              <button
                type="button"
                className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-left text-sm"
                onClick={() => {
                  setSelectedModelId('');
                  setModelDraft({ ...defaultModel(), provider_profile_id: profiles.providers[0]?.id || '' });
                }}
              >
                + New Model
              </button>
            </div>
          </SettingsCard>

          <SettingsCard>
            {profiles.providers.length === 0 ? (
              <div className="space-y-2 py-2">
                <p className="text-sm text-slate-600">No providers available.</p>
                <button type="button" className="inline-flex h-8 items-center rounded-lg border border-slate-300 bg-slate-100 px-3 text-[13px] text-slate-700" onClick={() => setActiveTab('providers')}>Create Provider</button>
              </div>
            ) : (
              <div className="space-y-3 py-2">
                <label className="block text-sm">
                  <span className="mb-1 block text-slate-600">Provider</span>
                  <select className={`${compactControlClass} w-full`} value={modelDraft.provider_profile_id} onChange={(e) => setModelDraft((prev) => ({ ...prev, provider_profile_id: e.target.value }))}>
                    {profiles.providers.map((p) => (
                      <option key={p.id} value={p.id}>{p.display_name}</option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-slate-600">Profile Name</span>
                  <input className={`${compactControlClass} w-full`} value={modelDraft.profile_name} onChange={(e) => setModelDraft((prev) => ({ ...prev, profile_name: e.target.value }))} />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-slate-600">Model Name</span>
                  <input className={`${compactControlClass} w-full`} value={modelDraft.model_name} onChange={(e) => setModelDraft((prev) => ({ ...prev, model_name: e.target.value }))} />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-slate-600">Capability</span>
                  <select className={`${compactControlClass} w-full`} value={modelDraft.capability} onChange={(e) => setModelDraft((prev) => ({ ...prev, capability: e.target.value as ModelCapability }))}>
                    <option value="chat">Chat</option>
                    <option value="embedding">Embedding</option>
                    <option value="multimodal">Multimodal</option>
                  </select>
                </label>
                <div>
                  <button type="button" className="mb-2 text-sm text-blue-600 hover:underline">show advanced parameters</button>
                  <div className="grid grid-cols-2 gap-2">
                    <input className={`${compactControlClass} w-full`} placeholder="temperature" value={modelDraft.temperature ?? ''} onChange={(e) => setModelDraft((prev) => ({ ...prev, temperature: e.target.value ? Number(e.target.value) : undefined }))} />
                    <input className={`${compactControlClass} w-full`} placeholder="max_tokens" value={modelDraft.max_tokens ?? ''} onChange={(e) => setModelDraft((prev) => ({ ...prev, max_tokens: e.target.value ? Number(e.target.value) : undefined }))} />
                    <input className={`${compactControlClass} w-full`} placeholder="top_p" value={modelDraft.top_p ?? ''} onChange={(e) => setModelDraft((prev) => ({ ...prev, top_p: e.target.value ? Number(e.target.value) : undefined }))} />
                    {modelDraft.capability === 'embedding' ? (
                      <input className={`${compactControlClass} w-full`} placeholder="embedding_dimension" value={modelDraft.embedding_dimension ?? ''} onChange={(e) => setModelDraft((prev) => ({ ...prev, embedding_dimension: e.target.value ? Number(e.target.value) : 384 }))} />
                    ) : (
                      <div className="flex items-center justify-between rounded-lg border border-slate-300 bg-white px-2.5">
                        <span className="text-xs text-slate-500">enable thinking</span>
                        <ToggleSwitch checked={!!modelDraft.enable_thinking} onChange={(next) => setModelDraft((prev) => ({ ...prev, enable_thinking: next }))} />
                      </div>
                    )}
                  </div>
                </div>
                <label className="block text-sm">
                  <span className="mb-1 block text-slate-600">System Prompt</span>
                  <textarea className="min-h-[76px] w-full rounded-lg border border-slate-300 px-2.5 py-2 text-[13px] text-slate-800 outline-none focus:ring-2 focus:ring-blue-500" value={modelDraft.system_prompt || ''} onChange={(e) => setModelDraft((prev) => ({ ...prev, system_prompt: e.target.value }))} />
                </label>
                <div className="flex items-center justify-between py-1">
                  <span className="text-sm text-slate-600">Enabled</span>
                  <ToggleSwitch checked={modelDraft.enabled} onChange={(next) => setModelDraft((prev) => ({ ...prev, enabled: next }))} />
                </div>
                <div className="flex gap-2 pt-1">
                  <button type="button" onClick={() => void saveModel()} disabled={saving} className="inline-flex h-8 items-center rounded-lg border border-slate-300 bg-slate-100 px-3 text-[13px] text-slate-700 shadow-sm hover:bg-slate-200 disabled:opacity-60">Save</button>
                  <button type="button" onClick={() => setModelDraft(selectedModelId ? profiles.models.find((m) => m.id === selectedModelId) || defaultModel() : defaultModel())} disabled={saving} className="inline-flex h-8 items-center rounded-lg border border-slate-300 bg-white px-3 text-[13px] text-slate-700 hover:bg-slate-50 disabled:opacity-60">Reset</button>
                  <button type="button" onClick={() => void testModel()} disabled={saving || !modelDraft.id} className="inline-flex h-8 items-center rounded-lg border border-blue-300 bg-blue-50 px-3 text-[13px] text-blue-700 hover:bg-blue-100 disabled:opacity-60">Test</button>
                  <button
                    type="button"
                    onClick={handleDeleteModelClick}
                    disabled={saving || !selectedModelId}
                    className="inline-flex h-8 items-center rounded-lg border border-rose-300 bg-rose-50 px-3 text-[13px] text-rose-700 hover:bg-rose-100 disabled:opacity-60"
                  >
                    Delete
                  </button>
                </div>
                {modelTestResult ? (
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-sm">
                    <div className="mb-1 flex items-center gap-2">
                      <StatusDot success={modelTestResult.ok} text={modelTestResult.ok ? 'ok' : 'failed'} />
                      <span className="text-xs text-slate-500">{modelTestResult.endpoint}</span>
                    </div>
                    <div className="text-xs text-slate-600">{modelTestResult.detail}</div>
                  </div>
                ) : null}
              </div>
            )}
          </SettingsCard>
        </div>
      )}

      {activeTab === 'agents' && (
        <div className="grid grid-cols-[240px_minmax(0,1fr)] gap-4">
          <SettingsCard>
            <div className="space-y-2 py-2">
              {SLOT_ORDER.map((slot) => (
                <button
                  type="button"
                  key={slot}
                  onClick={() => setSelectedSlot(slot)}
                  className={`w-full rounded-md px-2 py-1.5 text-left text-sm ${selectedSlot === slot ? 'bg-blue-100 text-blue-700' : 'hover:bg-slate-100'}`}
                >
                  {AGENT_SLOT_LABEL[slot]}
                </button>
              ))}
            </div>
          </SettingsCard>

          <SettingsCard>
            {!agentDraft ? null : (
              <div className="space-y-3 py-2">
                <div className="text-sm font-medium text-slate-700">{AGENT_SLOT_LABEL[selectedSlot]} Agent Config</div>
                {candidateModels.length === 0 ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <p className="text-sm text-amber-800">No models available for this slot capability.</p>
                    <button type="button" className="mt-2 inline-flex h-8 items-center rounded-lg border border-amber-300 bg-white px-3 text-[13px] text-amber-800" onClick={() => setActiveTab('models')}>Go to Models</button>
                  </div>
                ) : (
                  <>
                    <label className="block text-sm">
                      <span className="mb-1 block text-slate-600">Primary Model</span>
                      <select
                        className={`${compactControlClass} w-full`}
                        value={agentDraft.primary_model_id || ''}
                        onChange={(e) => setAgentDraft((prev) => (prev ? { ...prev, primary_model_id: e.target.value || undefined } : prev))}
                      >
                        <option value="">-- none --</option>
                        {candidateModels.map((m) => (
                          <option key={m.id} value={m.id}>{m.profile_name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="block text-sm">
                      <span className="mb-1 block text-slate-600">Fallback Model</span>
                      <select
                        className={`${compactControlClass} w-full`}
                        value={agentDraft.fallback_model_id || ''}
                        onChange={(e) => setAgentDraft((prev) => (prev ? { ...prev, fallback_model_id: e.target.value || undefined } : prev))}
                      >
                        <option value="">-- none --</option>
                        {candidateModels
                          .filter((m) => m.id !== agentDraft.primary_model_id)
                          .map((m) => (
                            <option key={m.id} value={m.id}>{m.profile_name}</option>
                          ))}
                      </select>
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <input className={`${compactControlClass} w-full`} placeholder="temperature" value={agentDraft.temperature ?? ''} onChange={(e) => setAgentDraft((prev) => (prev ? { ...prev, temperature: e.target.value ? Number(e.target.value) : undefined } : prev))} />
                      <input className={`${compactControlClass} w-full`} placeholder="max_tokens" value={agentDraft.max_tokens ?? ''} onChange={(e) => setAgentDraft((prev) => (prev ? { ...prev, max_tokens: e.target.value ? Number(e.target.value) : undefined } : prev))} />
                    </div>
                    <label className="block text-sm">
                      <span className="mb-1 block text-slate-600">System Prompt</span>
                      <textarea className="min-h-[76px] w-full rounded-lg border border-slate-300 px-2.5 py-2 text-[13px] text-slate-800 outline-none focus:ring-2 focus:ring-blue-500" value={agentDraft.system_prompt || ''} onChange={(e) => setAgentDraft((prev) => (prev ? { ...prev, system_prompt: e.target.value } : prev))} />
                    </label>
                    {selectedSlot === 'translate' && (
                      <div className="space-y-2">
                        <label className="block text-sm">
                          <span className="mb-1 block text-slate-600">Target Language</span>
                          <input className={`${compactControlClass} w-full`} value={agentDraft.target_language || ''} onChange={(e) => setAgentDraft((prev) => (prev ? { ...prev, target_language: e.target.value } : prev))} />
                        </label>
                        <label className="block text-sm">
                          <span className="mb-1 block text-slate-600">
                            Translation Parallelism ({Math.min(10, Math.max(1, agentDraft.translation_parallelism ?? 5))})
                          </span>
                          <input
                            type="range"
                            min={1}
                            max={10}
                            step={1}
                            className="w-full"
                            value={Math.min(10, Math.max(1, agentDraft.translation_parallelism ?? 5))}
                            onChange={(e) =>
                              setAgentDraft((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      translation_parallelism: Math.min(10, Math.max(1, Number(e.target.value) || 5)),
                                    }
                                  : prev
                              )
                            }
                          />
                          <p className="mt-1 text-xs text-slate-500">Range 1-10, default 5.</p>
                        </label>
                      </div>
                    )}
                    {selectedSlot === 'summary' && (
                      <div className="space-y-2">
                        <label className="block text-sm">
                          <span className="mb-1 block text-slate-600">Detail Level</span>
                          <select className={`${compactControlClass} w-full`} value={agentDraft.detail_level || 'medium'} onChange={(e) => setAgentDraft((prev) => (prev ? { ...prev, detail_level: e.target.value as 'short' | 'medium' | 'detailed' } : prev))}>
                            <option value="short">Short</option>
                            <option value="medium">Medium</option>
                            <option value="detailed">Detailed</option>
                          </select>
                        </label>
                        <div className="flex items-center justify-between py-1">
                          <span className="text-sm text-slate-600">Warn on auto-summary</span>
                          <ToggleSwitch checked={!!agentDraft.warn_on_auto_summary} onChange={(next) => setAgentDraft((prev) => (prev ? { ...prev, warn_on_auto_summary: next } : prev))} />
                        </div>
                      </div>
                    )}
                    <div className="flex items-center justify-between py-1">
                      <span className="text-sm text-slate-600">Enabled</span>
                      <ToggleSwitch checked={agentDraft.enabled} onChange={(next) => setAgentDraft((prev) => (prev ? { ...prev, enabled: next } : prev))} />
                    </div>
                    <SettingsDivider />
                    <div className="flex items-center justify-between">
                      <button type="button" onClick={() => void saveAgent()} disabled={saving} className="inline-flex h-8 items-center rounded-lg border border-slate-300 bg-slate-100 px-3 text-[13px] text-slate-700 shadow-sm hover:bg-slate-200 disabled:opacity-60">Save</button>
                      <a href="#" className="text-sm text-blue-600 hover:underline">custom prompts</a>
                    </div>
                  </>
                )}
              </div>
            )}
          </SettingsCard>
        </div>
      )}

      {message ? (
        <SettingsCard>
          <p className="py-2 text-sm text-slate-700">{message}</p>
        </SettingsCard>
      ) : null}
    </div>
  );
};
