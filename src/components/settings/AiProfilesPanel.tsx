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

type SetupMode = 'quick' | 'advanced';
type QuickSlot = 'chat' | 'summary' | 'translate' | 'embedding';
type RuntimeSummaryStatus = 'ready' | 'disabled' | 'needs_config' | 'invalid';
type EmbeddingStatus = {
  indexed: number;
  total: number;
  stale: number;
  profile: {
    provider: string;
    model: string;
    dimension: number;
  };
};

const AGENT_SLOT_LABEL: Record<AgentSlot, string> = {
  chat: 'Chat',
  summary: 'Summary',
  translate: 'Translation',
  deep_analyze: 'Deep Analyze',
  embedding: 'Embedding',
};

const QUICK_SLOT_ORDER: Exclude<QuickSlot, 'embedding'>[] = ['chat', 'summary', 'translate'];
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

const defaultAgentConfigForSlot = (slot: AgentSlot): AgentConfig => ({
  slot,
  enabled: true,
  translation_parallelism: slot === 'translate' ? 5 : undefined,
});

const withCopySuffix = (value: string, fallback: string) => {
  const base = value.trim() || fallback;
  return /\bcopy\b$/i.test(base) ? base : `${base} Copy`;
};

const capabilityForSlot = (slot: AgentSlot): ModelCapability => {
  if (slot === 'embedding') return 'embedding';
  return 'chat';
};

const modelMatchesSlotCapability = (
  model: ModelProfile,
  slot: AgentSlot
): boolean => {
  const capability = capabilityForSlot(slot);
  if (capability === 'embedding') {
    return model.capability === 'embedding';
  }
  return model.capability === 'chat' || model.capability === 'multimodal';
};

const isLocalBaseUrl = (base?: string): boolean => {
  const v = (base || '').toLowerCase();
  return v.includes('localhost') || v.includes('127.0.0.1') || v.includes('0.0.0.0');
};

function CompactIconButton({
  label,
  onClick,
  disabled,
  tone = 'neutral',
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'neutral' | 'danger';
  children: React.ReactNode;
}) {
  const toneClass =
    tone === 'danger'
      ? 'border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100'
      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50';

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border ${toneClass} disabled:opacity-60`}
    >
      {children}
    </button>
  );
}

export const AiProfilesPanel: React.FC = () => {
  const [setupMode, setSetupMode] = useState<SetupMode>('quick');
  const [activeTab, setActiveTab] = useState<'providers' | 'models' | 'agents'>('providers');
  const [profiles, setProfiles] = useState<ProfilesPayload>({ providers: [], models: [], agents: [] });

  const [selectedProviderId, setSelectedProviderId] = useState<string>('');
  const [selectedModelId, setSelectedModelId] = useState<string>('');
  const [selectedSlot, setSelectedSlot] = useState<AgentSlot>('summary');

  const [providerDraft, setProviderDraft] = useState<ProviderProfile>(defaultProvider());
  const [modelDraft, setModelDraft] = useState<ModelProfile>(defaultModel());
  const [agentDraft, setAgentDraft] = useState<AgentConfig | null>(null);
  const [showModelAdvanced, setShowModelAdvanced] = useState(false);
  const [showAgentAdvanced, setShowAgentAdvanced] = useState(false);
  const [quickDrafts, setQuickDrafts] = useState<Partial<Record<QuickSlot, AgentConfig>>>({});
  const [quickProviderBySlot, setQuickProviderBySlot] = useState<Partial<Record<QuickSlot, string>>>({});
  const [quickTestResults, setQuickTestResults] = useState<Partial<Record<QuickSlot, ModelTestResult>>>({});
  const [quickTestingSlot, setQuickTestingSlot] = useState<QuickSlot | null>(null);
  const [embeddingStatus, setEmbeddingStatus] = useState<EmbeddingStatus | null>(null);
  const [agentCopySourceSlot, setAgentCopySourceSlot] = useState<AgentSlot | ''>('');

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
    setShowModelAdvanced(false);
    setModelTestResult(null);
  }, [selectedModelId]);

  useEffect(() => {
    const a = profiles.agents.find((x) => x.slot === selectedSlot);
    if (a) setAgentDraft({ ...a });
    else setAgentDraft(defaultAgentConfigForSlot(selectedSlot));
  }, [profiles.agents, selectedSlot]);

  useEffect(() => {
    setShowAgentAdvanced(false);
    setAgentCopySourceSlot('');
  }, [selectedSlot]);

  const providerOptions = profiles.providers;
  const providerById = useMemo(
    () => new Map(profiles.providers.map((provider) => [provider.id, provider])),
    [profiles.providers]
  );
  const modelById = useMemo(
    () => new Map(profiles.models.map((model) => [model.id, model])),
    [profiles.models]
  );
  const capability = capabilityForSlot(selectedSlot);
  const selectableModelProviders = useMemo(() => {
    const currentProviderId = modelDraft.provider_profile_id;
    return profiles.providers.filter((provider) => provider.enabled || provider.id === currentProviderId);
  }, [modelDraft.provider_profile_id, profiles.providers]);
  const candidateModels = useMemo(
    () =>
      profiles.models.filter((model) => {
        if (!model.enabled) return false;
        if (capability === 'embedding') {
          if (model.capability !== 'embedding') return false;
        } else if (!(model.capability === 'chat' || model.capability === 'multimodal')) {
          return false;
        }
        return providerById.get(model.provider_profile_id)?.enabled ?? false;
      }),
    [profiles.models, capability, providerById]
  );
  const currentModelProvider = providerById.get(modelDraft.provider_profile_id);
  const modelUsesDisabledProvider = Boolean(
    currentModelProvider && !currentModelProvider.enabled
  );
  const providerSupportsApiKey = ['open_ai', 'open_ai_compatible'].includes(
    normalizeProviderType(providerDraft.provider_type)
  );
  const providerRequiresBaseUrl =
    normalizeProviderType(providerDraft.provider_type) !== 'local_transformers';
  const providerSupportsProbe = providerRequiresBaseUrl;
  const providerSupportsTestModel =
    normalizeProviderType(providerDraft.provider_type) !== 'local_transformers';
  const modelSupportsDirectTest =
    Boolean(modelDraft.id) &&
    currentModelProvider?.provider_type !== 'local_transformers';
  const invalidPrimarySelection = Boolean(
    agentDraft?.primary_model_id &&
      !candidateModels.some((model) => model.id === agentDraft.primary_model_id)
  );
  const invalidFallbackSelection = Boolean(
    agentDraft?.fallback_model_id &&
      !candidateModels.some((model) => model.id === agentDraft.fallback_model_id)
  );
  const agentCanSave = Boolean(
    agentDraft &&
      (!agentDraft.enabled ||
        (Boolean(agentDraft.primary_model_id) &&
          !invalidPrimarySelection &&
          !invalidFallbackSelection))
  );
  const runtimeSummaries = useMemo(
    () =>
      SLOT_ORDER.map((slot) => {
        const agent = profiles.agents.find((item) => item.slot === slot);
        if (!agent) {
          return {
            slot,
            status: 'needs_config' as RuntimeSummaryStatus,
            detail: 'No agent config yet.',
          };
        }
        if (!agent.enabled) {
          return {
            slot,
            status: 'disabled' as RuntimeSummaryStatus,
            detail: 'Disabled.',
          };
        }
        if (!agent.primary_model_id) {
          return {
            slot,
            status: 'needs_config' as RuntimeSummaryStatus,
            detail: 'Select a primary model.',
          };
        }
        const model = modelById.get(agent.primary_model_id);
        if (!model) {
          return {
            slot,
            status: 'invalid' as RuntimeSummaryStatus,
            detail: 'Primary model no longer exists.',
          };
        }
        if (!modelMatchesSlotCapability(model, slot)) {
          return {
            slot,
            status: 'invalid' as RuntimeSummaryStatus,
            detail: 'Primary model capability does not match this slot.',
          };
        }
        if (!model.enabled) {
          return {
            slot,
            status: 'invalid' as RuntimeSummaryStatus,
            detail: `Model "${model.profile_name}" is disabled.`,
          };
        }
        const provider = providerById.get(model.provider_profile_id);
        if (!provider) {
          return {
            slot,
            status: 'invalid' as RuntimeSummaryStatus,
            detail: 'Assigned provider no longer exists.',
          };
        }
        if (!provider.enabled) {
          return {
            slot,
            status: 'invalid' as RuntimeSummaryStatus,
            detail: `Provider "${provider.display_name}" is disabled.`,
          };
        }
        return {
          slot,
          status: 'ready' as RuntimeSummaryStatus,
          detail: `${provider.display_name} / ${model.profile_name}`,
        };
      }),
    [modelById, profiles.agents, providerById]
  );
  const runtimeSummaryBySlot = useMemo(
    () => new Map(runtimeSummaries.map((summary) => [summary.slot, summary])),
    [runtimeSummaries]
  );
  const availableAgentCopySources = useMemo(
    () =>
      SLOT_ORDER.filter(
        (slot) =>
          slot !== selectedSlot &&
          capabilityForSlot(slot) === capabilityForSlot(selectedSlot) &&
          profiles.agents.some((agent) => agent.slot === slot)
      ),
    [profiles.agents, selectedSlot]
  );

  const isModelAssignableToSlot = (modelId: string | undefined, slot: AgentSlot) => {
    if (!modelId) return false;
    const model = modelById.get(modelId);
    if (!model || !model.enabled || !modelMatchesSlotCapability(model, slot)) return false;
    return providerById.get(model.provider_profile_id)?.enabled ?? false;
  };

  const getAvailableProvidersForSlot = (slot: QuickSlot, currentProviderId?: string) =>
    profiles.providers.filter((provider) => {
      if (provider.id === currentProviderId) return true;
      if (!provider.enabled) return false;
      return profiles.models.some(
        (model) =>
          model.enabled &&
          model.provider_profile_id === provider.id &&
          modelMatchesSlotCapability(model, slot)
      );
    });

  const getAvailableModelsForSlot = (
    slot: QuickSlot,
    providerId?: string,
    currentModelId?: string
  ) =>
    profiles.models.filter((model) => {
      if (providerId && model.provider_profile_id !== providerId) return false;
      if (model.id === currentModelId) return true;
      if (!model.enabled) return false;
      if (!modelMatchesSlotCapability(model, slot)) return false;
      return providerById.get(model.provider_profile_id)?.enabled ?? false;
    });

  useEffect(() => {
    const nextDrafts: Partial<Record<QuickSlot, AgentConfig>> = {};
    const nextProviders: Partial<Record<QuickSlot, string>> = {};

    (['chat', 'summary', 'translate', 'embedding'] as QuickSlot[]).forEach((slot) => {
      const existing = profiles.agents.find((agent) => agent.slot === slot);
      const nextDraft = existing ? { ...existing } : defaultAgentConfigForSlot(slot);
      const fallbackModel = nextDraft.fallback_model_id
        ? modelById.get(nextDraft.fallback_model_id)
        : undefined;

      if (
        fallbackModel &&
        (!fallbackModel.enabled ||
          !modelMatchesSlotCapability(fallbackModel, slot) ||
          !(providerById.get(fallbackModel.provider_profile_id)?.enabled ?? false))
      ) {
        nextDraft.fallback_model_id = undefined;
      }

      const currentPrimary = nextDraft.primary_model_id
        ? modelById.get(nextDraft.primary_model_id)
        : undefined;
      const providerOptions = profiles.providers.filter((provider) => {
        if (provider.id === currentPrimary?.provider_profile_id) return true;
        if (!provider.enabled) return false;
        return profiles.models.some(
          (model) =>
            model.enabled &&
            model.provider_profile_id === provider.id &&
            modelMatchesSlotCapability(model, slot)
        );
      });
      nextProviders[slot] =
        currentPrimary?.provider_profile_id &&
        providerOptions.some((provider) => provider.id === currentPrimary.provider_profile_id)
          ? currentPrimary.provider_profile_id
          : providerOptions[0]?.id || '';
      nextDrafts[slot] = nextDraft;
    });

    setQuickDrafts(nextDrafts);
    setQuickProviderBySlot(nextProviders);
    setQuickTestResults({});
  }, [modelById, profiles.agents, profiles.models, profiles.providers, providerById]);

  const refreshEmbeddingStatus = async () => {
    try {
      const status = await invoke<EmbeddingStatus>('get_embedding_profile_status', { docId: null });
      setEmbeddingStatus(status);
    } catch (error) {
      console.warn('Failed to load embedding status:', error);
      setEmbeddingStatus(null);
    }
  };

  useEffect(() => {
    void refreshEmbeddingStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles.agents, profiles.models, profiles.providers]);

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

  const duplicateProviderDraft = () => {
    if (!selectedProviderId) return;
    setSelectedProviderId('');
    setProviderDraft((prev) => ({
      ...prev,
      id: '',
      display_name: withCopySuffix(prev.display_name, 'Provider'),
      created_at: 0,
      updated_at: 0,
    }));
    setProviderTestResult(null);
    setMessage('Provider copied into a new draft. Save to create it.');
  };

  const duplicateModelDraft = () => {
    if (!selectedModelId) return;
    setSelectedModelId('');
    setModelDraft((prev) => ({
      ...prev,
      id: '',
      profile_name: withCopySuffix(prev.profile_name, 'Model'),
      created_at: 0,
      updated_at: 0,
    }));
    setModelTestResult(null);
    setMessage('Model copied into a new draft. Save to create it.');
  };

  const copyAgentConfigFromSlot = (sourceSlot: AgentSlot) => {
    const source = profiles.agents.find((agent) => agent.slot === sourceSlot);
    if (!source) return;

    const nextPrimaryModelId = isModelAssignableToSlot(source.primary_model_id, selectedSlot)
      ? source.primary_model_id
      : undefined;
    const nextFallbackModelId =
      source.fallback_model_id &&
      source.fallback_model_id !== nextPrimaryModelId &&
      isModelAssignableToSlot(source.fallback_model_id, selectedSlot)
        ? source.fallback_model_id
        : undefined;

    setAgentDraft({
      ...source,
      slot: selectedSlot,
      primary_model_id: nextPrimaryModelId,
      fallback_model_id: nextFallbackModelId,
      translation_parallelism:
        selectedSlot === 'translate' ? source.translation_parallelism ?? 5 : undefined,
      target_language: selectedSlot === 'translate' ? source.target_language : undefined,
      detail_level: selectedSlot === 'summary' ? source.detail_level : undefined,
      warn_on_auto_summary:
        selectedSlot === 'summary' ? source.warn_on_auto_summary : undefined,
    });
    setAgentCopySourceSlot('');
    setMessage(
      `${AGENT_SLOT_LABEL[sourceSlot]} config copied. Save to apply it to ${AGENT_SLOT_LABEL[selectedSlot]}.`
    );
  };

  const updateQuickProvider = (slot: QuickSlot, providerId: string) => {
    setQuickProviderBySlot((prev) => ({ ...prev, [slot]: providerId }));
    setQuickDrafts((prev) => {
      const current = prev[slot] || defaultAgentConfigForSlot(slot);
      const models = getAvailableModelsForSlot(slot, providerId, current.primary_model_id);
      const nextPrimaryModelId =
        current.primary_model_id && models.some((model) => model.id === current.primary_model_id)
          ? current.primary_model_id
          : models[0]?.id;
      return {
        ...prev,
        [slot]: {
          ...current,
          primary_model_id: nextPrimaryModelId,
          fallback_model_id: undefined,
        },
      };
    });
    setQuickTestResults((prev) => ({ ...prev, [slot]: undefined }));
  };

  const updateQuickDraft = (
    slot: QuickSlot,
    updater: (draft: AgentConfig) => AgentConfig
  ) => {
    setQuickDrafts((prev) => {
      const current = prev[slot] || defaultAgentConfigForSlot(slot);
      return {
        ...prev,
        [slot]: updater(current),
      };
    });
    setQuickTestResults((prev) => ({ ...prev, [slot]: undefined }));
  };

  const saveQuickSlot = async (slot: QuickSlot) => {
    const draft = quickDrafts[slot];
    if (!draft) return;
    setSaving(true);
    try {
      await invoke<AgentConfig>('save_agent_config', {
        slot,
        configPatch: draft,
      });
      await loadProfiles();
      setMessage(`${AGENT_SLOT_LABEL[slot]} setup saved.`);
      window.dispatchEvent(new CustomEvent('reader://ai-profiles-updated'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const testQuickSlot = async (slot: QuickSlot) => {
    const modelId = quickDrafts[slot]?.primary_model_id;
    if (!modelId) {
      setMessage(`Choose a primary model for ${AGENT_SLOT_LABEL[slot]} first.`);
      return;
    }
    const model = modelById.get(modelId);
    const provider = model ? providerById.get(model.provider_profile_id) : undefined;
    if (!model || !provider) {
      setMessage('Selected model is unavailable.');
      return;
    }
    if (provider.provider_type === 'local_transformers') {
      setMessage(
        slot === 'embedding'
          ? 'Local Transformers embedding should be validated from Search.'
          : 'Local Transformers models are validated from the Search flow.'
      );
      return;
    }
    setQuickTestingSlot(slot);
    try {
      const result = await invoke<ModelTestResult>('test_model_profile', { modelId });
      setQuickTestResults((prev) => ({ ...prev, [slot]: result }));
      setMessage(
        `${AGENT_SLOT_LABEL[slot]} ${result.ok ? 'test passed.' : 'test failed.'}`
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setQuickTestingSlot(null);
    }
  };

  const openAdvancedForSlot = (slot: AgentSlot) => {
    setSetupMode('advanced');
    setActiveTab('agents');
    setSelectedSlot(slot);
  };

  const renderQuickSlotCard = (slot: Exclude<QuickSlot, 'embedding'>) => {
    const draft = quickDrafts[slot] || defaultAgentConfigForSlot(slot);
    const currentPrimary = draft.primary_model_id ? modelById.get(draft.primary_model_id) : undefined;
    const providerOptions = getAvailableProvidersForSlot(slot, currentPrimary?.provider_profile_id);
    const providerId =
      quickProviderBySlot[slot] &&
      providerOptions.some((provider) => provider.id === quickProviderBySlot[slot])
        ? quickProviderBySlot[slot] || ''
        : providerOptions[0]?.id || '';
    const modelOptions = getAvailableModelsForSlot(slot, providerId, draft.primary_model_id);
    const activeModel = draft.primary_model_id ? modelById.get(draft.primary_model_id) : undefined;
    const activeProvider = activeModel
      ? providerById.get(activeModel.provider_profile_id)
      : undefined;
    const selectedModelId =
      draft.primary_model_id && modelOptions.some((model) => model.id === draft.primary_model_id)
        ? draft.primary_model_id
        : '';
    const summary = runtimeSummaryBySlot.get(slot);
    const testResult = quickTestResults[slot];
    const canSave = !draft.enabled || Boolean(selectedModelId);

    return (
      <SettingsCard key={slot}>
        <div className="space-y-3 py-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-slate-800">{AGENT_SLOT_LABEL[slot]}</div>
              <div className="mt-1 text-xs text-slate-500">
                {slot === 'chat'
                  ? 'Pick the model used for interactive chat.'
                  : slot === 'summary'
                    ? 'Choose the model used for document summaries.'
                    : 'Choose the model used for translation tasks.'}
              </div>
            </div>
            {summary ? (
              <StatusDot success={summary.status === 'ready'} text={summary.status === 'ready' ? 'ready' : summary.status.replace('_', ' ')} />
            ) : null}
          </div>
          {summary ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
              Current: {summary.detail}
            </div>
          ) : null}
          {providerOptions.length === 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <div>No enabled providers with a compatible model are available for this task yet.</div>
              <button
                type="button"
                onClick={() => openAdvancedForSlot(slot)}
                className="mt-2 inline-flex h-8 items-center rounded-lg border border-amber-300 bg-white px-3 text-[13px] text-amber-800 hover:bg-amber-50"
              >
                Open Advanced
              </button>
            </div>
          ) : (
            <>
              <label className="block text-sm">
                <span className="mb-1 block text-slate-600">Provider</span>
                <select
                  className={`${compactControlClass} w-full`}
                  value={providerId}
                  onChange={(e) => updateQuickProvider(slot, e.target.value)}
                >
                  {providerOptions.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.display_name}
                      {provider.enabled ? '' : ' (disabled)'}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-slate-600">Model</span>
                <select
                  className={`${compactControlClass} w-full`}
                  value={selectedModelId}
                  onChange={(e) =>
                    updateQuickDraft(slot, (current) => ({
                      ...current,
                      primary_model_id: e.target.value || undefined,
                    }))
                  }
                >
                  <option value="">-- choose model --</option>
                  {modelOptions.map((model) => {
                    const providerEnabled = providerById.get(model.provider_profile_id)?.enabled ?? false;
                    const isAvailable =
                      model.enabled &&
                      modelMatchesSlotCapability(model, slot) &&
                      providerEnabled;
                    return (
                      <option key={model.id} value={model.id}>
                        {model.profile_name}
                        {isAvailable ? '' : ' (unavailable)'}
                      </option>
                    );
                  })}
                </select>
              </label>
              {slot === 'translate' && (
                <label className="block text-sm">
                  <span className="mb-1 block text-slate-600">
                    Parallelism ({Math.min(10, Math.max(1, draft.translation_parallelism ?? 5))})
                  </span>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    step={1}
                    className="w-full"
                    value={Math.min(10, Math.max(1, draft.translation_parallelism ?? 5))}
                    onChange={(e) =>
                      updateQuickDraft(slot, (current) => ({
                        ...current,
                        translation_parallelism: Math.min(
                          10,
                          Math.max(1, Number(e.target.value) || 5)
                        ),
                      }))
                    }
                  />
                </label>
              )}
              <div className="flex items-center justify-between py-1">
                <span className="text-sm text-slate-600">Enabled</span>
                <ToggleSwitch
                  checked={draft.enabled}
                  onChange={(next) =>
                    updateQuickDraft(slot, (current) => ({ ...current, enabled: next }))
                  }
                />
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => void saveQuickSlot(slot)}
                  disabled={saving || !canSave}
                  className="inline-flex h-8 items-center rounded-lg border border-slate-300 bg-slate-100 px-3 text-[13px] text-slate-700 shadow-sm hover:bg-slate-200 disabled:opacity-60"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => void testQuickSlot(slot)}
                  disabled={
                    saving ||
                    quickTestingSlot === slot ||
                    !selectedModelId ||
                    activeProvider?.provider_type === 'local_transformers'
                  }
                  className="inline-flex h-8 items-center rounded-lg border border-blue-300 bg-blue-50 px-3 text-[13px] text-blue-700 hover:bg-blue-100 disabled:opacity-60"
                >
                  {quickTestingSlot === slot ? 'Testing...' : 'Test'}
                </button>
                <button
                  type="button"
                  onClick={() => openAdvancedForSlot(slot)}
                  className="inline-flex h-8 items-center rounded-lg border border-slate-300 bg-white px-3 text-[13px] text-slate-700 hover:bg-slate-50"
                >
                  Advanced
                </button>
              </div>
              {draft.enabled && !selectedModelId && (
                <div className="text-xs text-amber-700">Enabled tasks need a primary model.</div>
              )}
              {activeProvider?.provider_type === 'local_transformers' ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                  Local Transformers models are validated from the Search flow instead of Model Test.
                </div>
              ) : null}
              {testResult ? (
                <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-sm">
                  <div className="mb-1 flex items-center gap-2">
                    <StatusDot success={testResult.ok} text={testResult.ok ? 'ok' : 'failed'} />
                    <span className="text-xs text-slate-500">{testResult.endpoint}</span>
                  </div>
                  <div className="text-xs text-slate-600">{testResult.detail}</div>
                </div>
              ) : null}
            </>
          )}
        </div>
      </SettingsCard>
    );
  };

  const renderQuickEmbeddingCard = () => {
    const slot: QuickSlot = 'embedding';
    const draft = quickDrafts[slot] || defaultAgentConfigForSlot(slot);
    const currentPrimary = draft.primary_model_id ? modelById.get(draft.primary_model_id) : undefined;
    const providerOptions = getAvailableProvidersForSlot(slot, currentPrimary?.provider_profile_id);
    const providerId =
      quickProviderBySlot[slot] &&
      providerOptions.some((provider) => provider.id === quickProviderBySlot[slot])
        ? quickProviderBySlot[slot] || ''
        : providerOptions[0]?.id || '';
    const modelOptions = getAvailableModelsForSlot(slot, providerId, draft.primary_model_id);
    const activeModel = draft.primary_model_id ? modelById.get(draft.primary_model_id) : undefined;
    const activeProvider = activeModel
      ? providerById.get(activeModel.provider_profile_id)
      : undefined;
    const selectedModelId =
      draft.primary_model_id && modelOptions.some((model) => model.id === draft.primary_model_id)
        ? draft.primary_model_id
        : '';
    const summary = runtimeSummaryBySlot.get(slot);
    const testResult = quickTestResults[slot];
    const isLocalEmbedding = activeProvider?.provider_type === 'local_transformers';
    const canSave = !draft.enabled || Boolean(selectedModelId);

    return (
      <SettingsCard>
        <div className="space-y-4 py-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-slate-800">Embedding & Index</div>
              <div className="mt-1 text-xs text-slate-500">
                Semantic search currently runs on Local Transformers. Remote embedding configs stay available in Advanced.
              </div>
            </div>
            {summary ? (
              <StatusDot success={summary.status === 'ready'} text={summary.status === 'ready' ? 'ready' : summary.status.replace('_', ' ')} />
            ) : null}
          </div>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="space-y-3">
              {summary ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                  Current: {summary.detail}
                </div>
              ) : null}
              {providerOptions.length === 0 ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  <div>No embedding provider with a compatible model is available yet.</div>
                  <button
                    type="button"
                    onClick={() => openAdvancedForSlot(slot)}
                    className="mt-2 inline-flex h-8 items-center rounded-lg border border-amber-300 bg-white px-3 text-[13px] text-amber-800 hover:bg-amber-50"
                  >
                    Open Advanced
                  </button>
                </div>
              ) : (
                <>
                  <label className="block text-sm">
                    <span className="mb-1 block text-slate-600">Provider</span>
                    <select
                      className={`${compactControlClass} w-full`}
                      value={providerId}
                      onChange={(e) => updateQuickProvider(slot, e.target.value)}
                    >
                      {providerOptions.map((provider) => (
                        <option key={provider.id} value={provider.id}>
                          {provider.display_name}
                          {provider.enabled ? '' : ' (disabled)'}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-slate-600">Model</span>
                    <select
                      className={`${compactControlClass} w-full`}
                      value={selectedModelId}
                      onChange={(e) =>
                        updateQuickDraft(slot, (current) => ({
                          ...current,
                          primary_model_id: e.target.value || undefined,
                        }))
                      }
                    >
                      <option value="">-- choose model --</option>
                      {modelOptions.map((model) => {
                        const providerEnabled = providerById.get(model.provider_profile_id)?.enabled ?? false;
                        const isAvailable =
                          model.enabled &&
                          modelMatchesSlotCapability(model, slot) &&
                          providerEnabled;
                        return (
                          <option key={model.id} value={model.id}>
                            {model.profile_name}
                            {isAvailable ? '' : ' (unavailable)'}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="text-xs uppercase tracking-wide text-slate-400">Dimension</div>
                      <div className="mt-1 text-sm text-slate-700">
                        {activeModel?.embedding_dimension || 384}
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="text-xs uppercase tracking-wide text-slate-400">Search Mode</div>
                      <div className="mt-1 text-sm text-slate-700">
                        {isLocalEmbedding ? 'Semantic search + reindex' : 'Keyword fallback today'}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between py-1">
                    <span className="text-sm text-slate-600">Enabled</span>
                    <ToggleSwitch
                      checked={draft.enabled}
                      onChange={(next) =>
                        updateQuickDraft(slot, (current) => ({ ...current, enabled: next }))
                      }
                    />
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => void saveQuickSlot(slot)}
                      disabled={saving || !canSave}
                      className="inline-flex h-8 items-center rounded-lg border border-slate-300 bg-slate-100 px-3 text-[13px] text-slate-700 shadow-sm hover:bg-slate-200 disabled:opacity-60"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => void testQuickSlot(slot)}
                      disabled={
                        saving ||
                        quickTestingSlot === slot ||
                        !selectedModelId ||
                        isLocalEmbedding
                      }
                      className="inline-flex h-8 items-center rounded-lg border border-blue-300 bg-blue-50 px-3 text-[13px] text-blue-700 hover:bg-blue-100 disabled:opacity-60"
                    >
                      {quickTestingSlot === slot ? 'Testing...' : 'Test'}
                    </button>
                    <button
                      type="button"
                      onClick={() => openAdvancedForSlot(slot)}
                      className="inline-flex h-8 items-center rounded-lg border border-slate-300 bg-white px-3 text-[13px] text-slate-700 hover:bg-slate-50"
                    >
                      Advanced
                    </button>
                  </div>
                  {draft.enabled && !selectedModelId && (
                    <div className="text-xs text-amber-700">Enabled tasks need a primary model.</div>
                  )}
                  {isLocalEmbedding ? (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                      Use Search to validate or download the local embedding model.
                    </div>
                  ) : (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                      Remote embedding models are stored here, but semantic search still falls back to keywords unless you switch to Local Transformers.
                    </div>
                  )}
                  {testResult ? (
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-sm">
                      <div className="mb-1 flex items-center gap-2">
                        <StatusDot success={testResult.ok} text={testResult.ok ? 'ok' : 'failed'} />
                        <span className="text-xs text-slate-500">{testResult.endpoint}</span>
                      </div>
                      <div className="text-xs text-slate-600">{testResult.detail}</div>
                    </div>
                  ) : null}
                </>
              )}
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs uppercase tracking-wide text-slate-400">Index Status</div>
              <div className="mt-3 space-y-3 text-sm text-slate-700">
                <div className="flex items-center justify-between gap-4">
                  <span>Indexed</span>
                  <span>{embeddingStatus ? `${embeddingStatus.indexed}/${embeddingStatus.total}` : 'Unknown'}</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span>Stale</span>
                  <span>{embeddingStatus ? embeddingStatus.stale : 'Unknown'}</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span>Active profile</span>
                  <span className="text-right">
                    {embeddingStatus
                      ? `${embeddingStatus.profile.provider} / ${embeddingStatus.profile.model}`
                      : 'Unavailable'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => void refreshEmbeddingStatus()}
                  className="inline-flex h-8 items-center rounded-lg border border-slate-300 bg-white px-3 text-[13px] text-slate-700 hover:bg-slate-100"
                >
                  Refresh Status
                </button>
              </div>
            </div>
          </div>
        </div>
      </SettingsCard>
    );
  };

  return (
    <div className="space-y-4">
      <SettingsCard>
        <div className="space-y-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-slate-800">AI & Embedding</div>
              <div className="text-xs text-slate-500">
                {setupMode === 'quick'
                  ? 'Quick Setup keeps the common task routing on one screen.'
                  : 'Advanced exposes provider, model, fallback, and slot-level controls.'}
              </div>
            </div>
            <div className="inline-flex rounded-lg border border-slate-300 bg-slate-100 p-0.5 text-sm">
              <button
                type="button"
                className={`rounded-md px-3 py-1.5 ${setupMode === 'quick' ? 'bg-white shadow-sm' : 'text-slate-600'}`}
                onClick={() => setSetupMode('quick')}
              >
                Quick Setup
              </button>
              <button
                type="button"
                className={`rounded-md px-3 py-1.5 ${setupMode === 'advanced' ? 'bg-white shadow-sm' : 'text-slate-600'}`}
                onClick={() => setSetupMode('advanced')}
              >
                Advanced
              </button>
            </div>
          </div>
          {setupMode === 'advanced' ? (
            <>
              <SettingsDivider />
              <div className="flex items-center justify-between">
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
            </>
          ) : (
            <div className="text-xs text-slate-500">
              Deep Analyze, fallback models, and other low-frequency controls remain under Advanced.
            </div>
          )}
          {setupMode === 'quick' && loading ? (
            <div className="text-xs text-slate-500">Loading...</div>
          ) : null}
        </div>
      </SettingsCard>

      <SettingsCard>
        <div className="space-y-3 py-2">
          <div>
            <div className="text-sm font-medium text-slate-800">Current Effective Setup</div>
            <div className="text-xs text-slate-500">Only enabled agent, model, and provider combinations can run.</div>
          </div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {runtimeSummaries.map((summary) => {
              const isReady = summary.status === 'ready';
              const isDisabled = summary.status === 'disabled';
              const chipText =
                summary.status === 'ready'
                  ? 'ready'
                  : summary.status === 'disabled'
                    ? 'disabled'
                    : summary.status === 'needs_config'
                      ? 'needs config'
                      : 'invalid';
              return (
                <div
                  key={summary.slot}
                  className={`rounded-lg border p-3 ${
                    isReady
                      ? 'border-emerald-200 bg-emerald-50'
                      : isDisabled
                        ? 'border-slate-200 bg-slate-50'
                        : 'border-amber-200 bg-amber-50'
                  }`}
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <div className="text-sm font-medium text-slate-800">
                      {AGENT_SLOT_LABEL[summary.slot]}
                    </div>
                    <StatusDot success={isReady} text={chipText} />
                  </div>
                  <div className="text-xs text-slate-600">{summary.detail}</div>
                </div>
              );
            })}
          </div>
        </div>
      </SettingsCard>

      {setupMode === 'quick' ? (
        <>
          <div className="grid gap-4 xl:grid-cols-3">
            {QUICK_SLOT_ORDER.map((slot) => renderQuickSlotCard(slot))}
          </div>
          {renderQuickEmbeddingCard()}
        </>
      ) : null}

      {setupMode === 'advanced' && activeTab === 'providers' && (
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
              {providerRequiresBaseUrl ? (
                <label className="block text-sm">
                  <span className="mb-1 block text-slate-600">Base URL</span>
                  <input
                    className={`${compactControlClass} w-full`}
                    value={providerDraft.base_url || ''}
                    onChange={(e) => setProviderDraft((prev) => ({ ...prev, base_url: e.target.value }))}
                  />
                </label>
              ) : (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                  Local Transformers is frontend-only for embedding. No remote endpoint is needed here.
                </div>
              )}
              {providerSupportsApiKey && (
                <label className="block text-sm">
                  <span className="mb-1 block text-slate-600">API Key {showApiKeyRequired ? '(Required)' : '(Optional)'}</span>
                  <input type="password" className={`${compactControlClass} w-full`} value={providerDraft.api_key || ''} onChange={(e) => setProviderDraft((prev) => ({ ...prev, api_key: e.target.value }))} />
                </label>
              )}
              {providerSupportsTestModel && (
                <label className="block text-sm">
                  <span className="mb-1 block text-slate-600">Test Model</span>
                  <input className={`${compactControlClass} w-full`} value={providerDraft.test_model || ''} onChange={(e) => setProviderDraft((prev) => ({ ...prev, test_model: e.target.value }))} />
                </label>
              )}
              <div className="flex items-center justify-between py-1">
                <span className="text-sm text-slate-600">Enabled</span>
                <ToggleSwitch checked={providerDraft.enabled} onChange={(next) => setProviderDraft((prev) => ({ ...prev, enabled: next }))} />
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <button type="button" onClick={() => void saveProvider()} disabled={saving} className="inline-flex h-8 items-center rounded-lg border border-slate-300 bg-slate-100 px-3 text-[13px] text-slate-700 shadow-sm hover:bg-slate-200 disabled:opacity-60">Save</button>
                <CompactIconButton
                  label="Reset provider draft"
                  onClick={() => setProviderDraft(selectedProviderId ? profiles.providers.find((p) => p.id === selectedProviderId) || defaultProvider() : defaultProvider())}
                  disabled={saving}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 12a9 9 0 1 0 3-6.708M3 4v5h5" />
                  </svg>
                </CompactIconButton>
                <CompactIconButton
                  label="Duplicate provider"
                  onClick={duplicateProviderDraft}
                  disabled={saving || !selectedProviderId}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden="true">
                    <rect x="9" y="9" width="10" height="10" rx="2" />
                    <rect x="5" y="5" width="10" height="10" rx="2" />
                  </svg>
                </CompactIconButton>
                {providerSupportsProbe && (
                  <button type="button" onClick={() => void testProvider()} disabled={saving} className="inline-flex h-8 items-center rounded-lg border border-blue-300 bg-blue-50 px-3 text-[13px] text-blue-700 hover:bg-blue-100 disabled:opacity-60">Test</button>
                )}
                <CompactIconButton
                  label="Delete provider"
                  onClick={handleDeleteProviderClick}
                  disabled={saving || !selectedProviderId}
                  tone="danger"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M9 7V5h6v2m-7 0 1 12h6l1-12" />
                  </svg>
                </CompactIconButton>
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

      {setupMode === 'advanced' && activeTab === 'models' && (
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
                    {selectableModelProviders.map((p) => (
                      <option key={p.id} value={p.id}>{p.display_name}{p.enabled ? '' : ' (disabled)'}</option>
                    ))}
                  </select>
                </label>
                {modelUsesDisabledProvider && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                    This model is attached to a disabled provider. Reassign it before using it in an enabled agent.
                  </div>
                )}
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
                {modelDraft.capability === 'embedding' && (
                  <label className="block text-sm">
                    <span className="mb-1 block text-slate-600">Embedding Dimension</span>
                    <input className={`${compactControlClass} w-full`} placeholder="embedding_dimension" value={modelDraft.embedding_dimension ?? ''} onChange={(e) => setModelDraft((prev) => ({ ...prev, embedding_dimension: e.target.value ? Number(e.target.value) : 384 }))} />
                  </label>
                )}
                <div>
                  <button type="button" className="text-sm text-blue-600 hover:underline" onClick={() => setShowModelAdvanced((prev) => !prev)}>
                    {showModelAdvanced ? 'Hide advanced' : 'Show advanced'}
                  </button>
                  {showModelAdvanced && (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <input className={`${compactControlClass} w-full`} placeholder="temperature" value={modelDraft.temperature ?? ''} onChange={(e) => setModelDraft((prev) => ({ ...prev, temperature: e.target.value ? Number(e.target.value) : undefined }))} />
                      <input className={`${compactControlClass} w-full`} placeholder="max_tokens" value={modelDraft.max_tokens ?? ''} onChange={(e) => setModelDraft((prev) => ({ ...prev, max_tokens: e.target.value ? Number(e.target.value) : undefined }))} />
                      {modelDraft.capability !== 'embedding' && (
                        <div className="col-span-2 flex items-center justify-between rounded-lg border border-slate-300 bg-white px-2.5 py-2">
                          <span className="text-xs text-slate-500">Enable thinking</span>
                          <ToggleSwitch checked={!!modelDraft.enable_thinking} onChange={(next) => setModelDraft((prev) => ({ ...prev, enable_thinking: next }))} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between py-1">
                  <span className="text-sm text-slate-600">Enabled</span>
                  <ToggleSwitch checked={modelDraft.enabled} onChange={(next) => setModelDraft((prev) => ({ ...prev, enabled: next }))} />
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <button type="button" onClick={() => void saveModel()} disabled={saving} className="inline-flex h-8 items-center rounded-lg border border-slate-300 bg-slate-100 px-3 text-[13px] text-slate-700 shadow-sm hover:bg-slate-200 disabled:opacity-60">Save</button>
                  <CompactIconButton
                    label="Reset model draft"
                    onClick={() => setModelDraft(selectedModelId ? profiles.models.find((m) => m.id === selectedModelId) || defaultModel() : defaultModel())}
                    disabled={saving}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 12a9 9 0 1 0 3-6.708M3 4v5h5" />
                    </svg>
                  </CompactIconButton>
                  <CompactIconButton
                    label="Duplicate model"
                    onClick={duplicateModelDraft}
                    disabled={saving || !selectedModelId}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden="true">
                      <rect x="9" y="9" width="10" height="10" rx="2" />
                      <rect x="5" y="5" width="10" height="10" rx="2" />
                    </svg>
                  </CompactIconButton>
                  <button type="button" onClick={() => void testModel()} disabled={saving || !modelSupportsDirectTest} className="inline-flex h-8 items-center rounded-lg border border-blue-300 bg-blue-50 px-3 text-[13px] text-blue-700 hover:bg-blue-100 disabled:opacity-60">Test</button>
                  <CompactIconButton
                    label="Delete model"
                    onClick={handleDeleteModelClick}
                    disabled={saving || !selectedModelId}
                    tone="danger"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M9 7V5h6v2m-7 0 1 12h6l1-12" />
                    </svg>
                  </CompactIconButton>
                </div>
                {currentModelProvider?.provider_type === 'local_transformers' && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                    Local Transformers models are used from the Search flow. Use Search to validate/download the local model instead of Model Test.
                  </div>
                )}
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

      {setupMode === 'advanced' && activeTab === 'agents' && (
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
                {availableAgentCopySources.length > 0 ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="text-sm font-medium text-slate-700">Copy From Slot</div>
                    <div className="mt-1 text-xs text-slate-500">
                      Copy another compatible slot as a starting point. Primary and fallback models only carry over if they are still valid here.
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <select
                        className={`${compactControlClass} min-w-[220px]`}
                        value={agentCopySourceSlot}
                        onChange={(e) => setAgentCopySourceSlot((e.target.value as AgentSlot) || '')}
                      >
                        <option value="">-- choose source slot --</option>
                        {availableAgentCopySources.map((slot) => (
                          <option key={slot} value={slot}>
                            {AGENT_SLOT_LABEL[slot]}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => agentCopySourceSlot && copyAgentConfigFromSlot(agentCopySourceSlot)}
                        disabled={!agentCopySourceSlot}
                        className="inline-flex h-8 items-center rounded-lg border border-slate-300 bg-white px-3 text-[13px] text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                      >
                        Copy Config
                      </button>
                    </div>
                  </div>
                ) : null}
                {candidateModels.length === 0 ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <p className="text-sm text-amber-800">No models available for this slot capability.</p>
                    <button type="button" className="mt-2 inline-flex h-8 items-center rounded-lg border border-amber-300 bg-white px-3 text-[13px] text-amber-800" onClick={() => setActiveTab('models')}>Go to Models</button>
                  </div>
                ) : (
                  <>
                    {(invalidPrimarySelection || invalidFallbackSelection) && (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                        This agent still references a disabled or unavailable model. Choose an enabled model before saving.
                      </div>
                    )}
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
                      <span className="mb-1 block text-slate-600">Fallback Model (Optional)</span>
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
                    <div>
                      <button type="button" className="text-sm text-blue-600 hover:underline" onClick={() => setShowAgentAdvanced((prev) => !prev)}>
                        {showAgentAdvanced ? 'Hide advanced' : 'Show advanced'}
                      </button>
                      {showAgentAdvanced && (
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <input className={`${compactControlClass} w-full`} placeholder="temperature" value={agentDraft.temperature ?? ''} onChange={(e) => setAgentDraft((prev) => (prev ? { ...prev, temperature: e.target.value ? Number(e.target.value) : undefined } : prev))} />
                          <input className={`${compactControlClass} w-full`} placeholder="max_tokens" value={agentDraft.max_tokens ?? ''} onChange={(e) => setAgentDraft((prev) => (prev ? { ...prev, max_tokens: e.target.value ? Number(e.target.value) : undefined } : prev))} />
                        </div>
                      )}
                    </div>
                    {selectedSlot === 'translate' && (
                      <div className="space-y-2">
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
                    <div className="flex items-center justify-between py-1">
                      <span className="text-sm text-slate-600">Enabled</span>
                      <ToggleSwitch checked={agentDraft.enabled} onChange={(next) => setAgentDraft((prev) => (prev ? { ...prev, enabled: next } : prev))} />
                    </div>
                    <SettingsDivider />
                    <div className="flex items-center justify-between">
                      <button type="button" onClick={() => void saveAgent()} disabled={saving || !agentCanSave} className="inline-flex h-8 items-center rounded-lg border border-slate-300 bg-slate-100 px-3 text-[13px] text-slate-700 shadow-sm hover:bg-slate-200 disabled:opacity-60">Save</button>
                      <a href="#" className="text-sm text-blue-600 hover:underline">custom prompts</a>
                    </div>
                    {agentDraft.enabled && !agentDraft.primary_model_id && (
                      <div className="text-xs text-amber-700">Enabled agents need a primary model.</div>
                    )}
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
