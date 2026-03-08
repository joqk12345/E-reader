use crate::{error::Result, ReaderError};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use uuid::Uuid;

const AI_CONFIG_VERSION: u32 = 4;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AiProvider {
    LmStudio,
    OpenAi,
}

impl Default for AiProvider {
    fn default() -> Self {
        AiProvider::LmStudio
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProviderType {
    OpenAiCompatible,
    OpenAi,
    LmStudio,
    Ollama,
    LocalTransformers,
}

impl Default for ProviderType {
    fn default() -> Self {
        ProviderType::LmStudio
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ModelCapability {
    Chat,
    Embedding,
    Multimodal,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum AgentSlot {
    Chat,
    Summary,
    Translate,
    DeepAnalyze,
    Embedding,
}

impl AgentSlot {
    pub fn required_capability(&self) -> ModelCapability {
        match self {
            AgentSlot::Embedding => ModelCapability::Embedding,
            AgentSlot::Chat
            | AgentSlot::Summary
            | AgentSlot::Translate
            | AgentSlot::DeepAnalyze => ModelCapability::Chat,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderProfile {
    pub id: String,
    pub display_name: String,
    #[serde(default)]
    pub provider_type: ProviderType,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub test_model: Option<String>,
    #[serde(default = "now_ts")]
    pub created_at: u64,
    #[serde(default = "now_ts")]
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelProfile {
    pub id: String,
    pub provider_profile_id: String,
    pub profile_name: String,
    pub model_name: String,
    pub capability: ModelCapability,
    #[serde(default = "default_true")]
    pub enabled: bool,

    #[serde(default)]
    pub temperature: Option<f32>,
    #[serde(default)]
    pub max_tokens: Option<usize>,
    #[serde(default)]
    pub top_p: Option<f32>,
    #[serde(default)]
    pub system_prompt: Option<String>,
    #[serde(default)]
    pub enable_thinking: Option<bool>,
    #[serde(default)]
    pub embedding_dimension: Option<u32>,

    #[serde(default = "now_ts")]
    pub created_at: u64,
    #[serde(default = "now_ts")]
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentConfig {
    pub slot: AgentSlot,
    #[serde(default)]
    pub primary_model_id: Option<String>,
    #[serde(default)]
    pub fallback_model_id: Option<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,

    #[serde(default)]
    pub temperature: Option<f32>,
    #[serde(default)]
    pub max_tokens: Option<usize>,
    #[serde(default)]
    pub system_prompt: Option<String>,

    #[serde(default)]
    pub target_language: Option<String>,
    #[serde(default)]
    pub detail_level: Option<String>,
    #[serde(default)]
    pub warn_on_auto_summary: Option<bool>,
    #[serde(default)]
    pub translation_parallelism: Option<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AiProfiles {
    #[serde(default)]
    pub providers: Vec<ProviderProfile>,
    #[serde(default)]
    pub models: Vec<ModelProfile>,
    #[serde(default)]
    pub agents: Vec<AgentConfig>,
}

impl AiProfiles {
    pub fn ensure_agent_slots(&mut self) {
        let mut existing: HashSet<AgentSlot> = self.agents.iter().map(|a| a.slot.clone()).collect();
        for slot in [
            AgentSlot::Chat,
            AgentSlot::Summary,
            AgentSlot::Translate,
            AgentSlot::DeepAnalyze,
            AgentSlot::Embedding,
        ] {
            if !existing.contains(&slot) {
                self.agents.push(AgentConfig {
                    slot: slot.clone(),
                    primary_model_id: None,
                    fallback_model_id: None,
                    enabled: true,
                    temperature: None,
                    max_tokens: None,
                    system_prompt: None,
                    target_language: None,
                    detail_level: None,
                    warn_on_auto_summary: None,
                    translation_parallelism: if matches!(slot, AgentSlot::Translate) {
                        Some(5)
                    } else {
                        None
                    },
                });
                existing.insert(slot);
            }
        }
    }

    pub fn get_agent(&self, slot: &AgentSlot) -> Option<&AgentConfig> {
        self.agents.iter().find(|a| &a.slot == slot)
    }

    pub fn get_model(&self, id: &str) -> Option<&ModelProfile> {
        self.models.iter().find(|m| m.id == id)
    }

    pub fn get_provider(&self, id: &str) -> Option<&ProviderProfile> {
        self.providers.iter().find(|p| p.id == id)
    }

    pub fn is_initialized(&self) -> bool {
        // Consider profiles initialized once user has any persisted AI profile data.
        // Using strict providers+models presence causes user-created partial drafts
        // (e.g. provider added before models) to be overwritten by legacy bootstrap.
        !self.providers.is_empty() || !self.models.is_empty() || !self.agents.is_empty()
    }

    pub fn has_provider_type(&self, provider_type: ProviderType) -> bool {
        self.providers
            .iter()
            .any(|p| p.provider_type == provider_type)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeymapConfig {
    #[serde(default = "default_keymap_next_page")]
    pub next_page: Vec<String>,
    #[serde(default = "default_keymap_prev_page")]
    pub prev_page: Vec<String>,
    #[serde(default = "default_keymap_open_settings")]
    pub open_settings: Vec<String>,
    #[serde(default = "default_keymap_toggle_window_maximize")]
    pub toggle_window_maximize: Vec<String>,
    #[serde(default = "default_keymap_toggle_header_tools")]
    pub toggle_header_tools: Vec<String>,
    #[serde(default = "default_keymap_font_increase")]
    pub font_increase: Vec<String>,
    #[serde(default = "default_keymap_font_decrease")]
    pub font_decrease: Vec<String>,
    #[serde(default = "default_keymap_font_reset")]
    pub font_reset: Vec<String>,
    #[serde(default = "default_keymap_open_search")]
    pub open_search: Vec<String>,
    #[serde(default = "default_keymap_audio_play")]
    pub audio_play: Vec<String>,
    #[serde(default = "default_keymap_audio_toggle_pause")]
    pub audio_toggle_pause: Vec<String>,
    #[serde(default = "default_keymap_audio_stop")]
    pub audio_stop: Vec<String>,
    #[serde(default = "default_keymap_toggle_reading_mode")]
    pub toggle_reading_mode: Vec<String>,
}

impl Default for KeymapConfig {
    fn default() -> Self {
        Self {
            next_page: default_keymap_next_page(),
            prev_page: default_keymap_prev_page(),
            open_settings: default_keymap_open_settings(),
            toggle_window_maximize: default_keymap_toggle_window_maximize(),
            toggle_header_tools: default_keymap_toggle_header_tools(),
            font_increase: default_keymap_font_increase(),
            font_decrease: default_keymap_font_decrease(),
            font_reset: default_keymap_font_reset(),
            open_search: default_keymap_open_search(),
            audio_play: default_keymap_audio_play(),
            audio_toggle_pause: default_keymap_audio_toggle_pause(),
            audio_stop: default_keymap_audio_stop(),
            toggle_reading_mode: default_keymap_toggle_reading_mode(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    #[serde(default = "default_config_version")]
    pub config_version: u32,

    pub provider: AiProvider,
    pub lm_studio_url: String,
    #[serde(default = "default_embedding_provider")]
    pub embedding_provider: String,
    #[serde(default = "default_embedding_model")]
    pub embedding_model: String,
    #[serde(default = "default_embedding_dimension")]
    pub embedding_dimension: u32,
    #[serde(default = "default_embedding_auto_reindex")]
    pub embedding_auto_reindex: bool,
    #[serde(default)]
    pub embedding_ollama_url: Option<String>,
    #[serde(default)]
    pub embedding_ollama_model: Option<String>,
    #[serde(default)]
    pub embedding_local_model_path: Option<String>,
    #[serde(default)]
    pub embedding_download_base_url: Option<String>,
    #[serde(default = "default_chat_model")]
    pub chat_model: String,
    #[serde(default = "default_enable_thinking")]
    pub enable_thinking: bool,
    pub openai_api_key: Option<String>,
    pub openai_base_url: Option<String>,
    #[serde(default = "default_tts_provider")]
    pub tts_provider: String,
    #[serde(default = "default_edge_tts_voice")]
    pub edge_tts_voice: String,
    #[serde(default)]
    pub edge_tts_proxy: Option<String>,
    #[serde(default)]
    pub cosyvoice_base_url: Option<String>,
    #[serde(default)]
    pub cosyvoice_api_key: Option<String>,
    #[serde(default = "default_translation_mode", alias = "translation_direction")]
    pub translation_mode: String,
    #[serde(default = "default_reader_background_color")]
    pub reader_background_color: String,
    #[serde(default = "default_reader_font_size")]
    pub reader_font_size: u32,
    #[serde(default)]
    pub keymap: KeymapConfig,

    #[serde(default)]
    pub ai_profiles: AiProfiles,
}

fn default_true() -> bool {
    true
}

fn default_config_version() -> u32 {
    AI_CONFIG_VERSION
}

fn now_ts() -> u64 {
    chrono::Utc::now().timestamp_millis() as u64
}

fn default_reader_background_color() -> String {
    "#F4F8EE".to_string()
}

fn default_embedding_provider() -> String {
    "local_transformers".to_string()
}

fn default_embedding_model() -> String {
    "Xenova/all-MiniLM-L6-v2".to_string()
}

fn default_embedding_dimension() -> u32 {
    384
}

fn default_embedding_auto_reindex() -> bool {
    true
}

fn default_chat_model() -> String {
    String::new()
}

fn default_enable_thinking() -> bool {
    false
}

fn normalize_local_embedding_model(model: &str) -> String {
    let trimmed = model.trim();
    if trimmed.is_empty() {
        return default_embedding_model();
    }
    let lower = trimmed.to_lowercase();
    if lower == "all-minilm-l6-v2" {
        return default_embedding_model();
    }
    if lower == "text-embedding-ada-002"
        || lower == "text-embedding-3-small"
        || lower == "text-embedding-3-large"
    {
        return default_embedding_model();
    }
    trimmed.to_string()
}

fn default_translation_mode() -> String {
    "off".to_string()
}

fn default_tts_provider() -> String {
    "auto".to_string()
}

fn default_edge_tts_voice() -> String {
    "en-US-AriaNeural".to_string()
}

fn default_reader_font_size() -> u32 {
    18
}

fn default_keymap_next_page() -> Vec<String> {
    vec!["PageDown".to_string(), "Space".to_string(), "J".to_string()]
}

fn default_keymap_prev_page() -> Vec<String> {
    vec![
        "PageUp".to_string(),
        "Shift+Space".to_string(),
        "K".to_string(),
    ]
}

fn default_keymap_open_settings() -> Vec<String> {
    vec!["Cmd+,".to_string(), "Ctrl+,".to_string()]
}

fn default_keymap_toggle_window_maximize() -> Vec<String> {
    vec!["Cmd+Shift+M".to_string(), "Ctrl+Shift+M".to_string()]
}

fn default_keymap_toggle_header_tools() -> Vec<String> {
    vec!["Cmd+Shift+T".to_string(), "Ctrl+Shift+T".to_string()]
}

fn default_keymap_font_increase() -> Vec<String> {
    vec!["Cmd+=".to_string(), "Ctrl+=".to_string()]
}

fn default_keymap_font_decrease() -> Vec<String> {
    vec!["Cmd+-".to_string(), "Ctrl+-".to_string()]
}

fn default_keymap_font_reset() -> Vec<String> {
    vec!["Cmd+0".to_string(), "Ctrl+0".to_string()]
}

fn default_keymap_open_search() -> Vec<String> {
    vec!["Cmd+F".to_string(), "Ctrl+F".to_string()]
}

fn default_keymap_audio_play() -> Vec<String> {
    vec!["Cmd+Shift+P".to_string(), "Ctrl+Shift+P".to_string()]
}

fn default_keymap_audio_toggle_pause() -> Vec<String> {
    vec![
        "Cmd+Shift+Space".to_string(),
        "Ctrl+Shift+Space".to_string(),
    ]
}

fn default_keymap_audio_stop() -> Vec<String> {
    vec!["Cmd+Shift+S".to_string(), "Ctrl+Shift+S".to_string()]
}

fn default_keymap_toggle_reading_mode() -> Vec<String> {
    vec!["Cmd+Shift+R".to_string(), "Ctrl+Shift+R".to_string()]
}

impl Default for Config {
    fn default() -> Self {
        let mut config = Config {
            config_version: default_config_version(),
            provider: AiProvider::LmStudio,
            lm_studio_url: "http://localhost:1234/v1".to_string(),
            embedding_provider: default_embedding_provider(),
            embedding_model: default_embedding_model(),
            embedding_dimension: default_embedding_dimension(),
            embedding_auto_reindex: default_embedding_auto_reindex(),
            embedding_ollama_url: None,
            embedding_ollama_model: None,
            embedding_local_model_path: None,
            embedding_download_base_url: None,
            chat_model: default_chat_model(),
            enable_thinking: default_enable_thinking(),
            openai_api_key: None,
            openai_base_url: Some("https://api.openai.com/v1".to_string()),
            tts_provider: default_tts_provider(),
            edge_tts_voice: default_edge_tts_voice(),
            edge_tts_proxy: None,
            cosyvoice_base_url: None,
            cosyvoice_api_key: None,
            translation_mode: default_translation_mode(),
            reader_background_color: default_reader_background_color(),
            reader_font_size: default_reader_font_size(),
            keymap: KeymapConfig::default(),
            ai_profiles: AiProfiles::default(),
        };
        config.ai_profiles = build_ai_profiles_from_legacy(&config);
        ensure_quickstart_default_providers(&mut config);
        config
    }
}

fn provider_type_from_legacy(config: &Config) -> ProviderType {
    match config.provider {
        AiProvider::OpenAi => ProviderType::OpenAi,
        AiProvider::LmStudio => {
            if config.embedding_provider == "ollama" {
                ProviderType::Ollama
            } else if config.embedding_provider == "openai_compatible" {
                ProviderType::OpenAiCompatible
            } else {
                ProviderType::LmStudio
            }
        }
    }
}

fn build_ai_profiles_from_legacy(config: &Config) -> AiProfiles {
    let now = now_ts();
    let provider_id = Uuid::new_v4().to_string();
    let chat_model_id = Uuid::new_v4().to_string();
    let embedding_model_id = Uuid::new_v4().to_string();

    let provider_type = provider_type_from_legacy(config);

    let base_url = match provider_type {
        ProviderType::OpenAi => config.openai_base_url.clone(),
        ProviderType::OpenAiCompatible | ProviderType::LmStudio => {
            Some(config.lm_studio_url.clone())
        }
        ProviderType::Ollama => config
            .embedding_ollama_url
            .clone()
            .or_else(|| Some("http://localhost:11434/v1".to_string())),
        ProviderType::LocalTransformers => None,
    };

    let provider = ProviderProfile {
        id: provider_id.clone(),
        display_name: match provider_type {
            ProviderType::OpenAi => "OpenAI".to_string(),
            ProviderType::LmStudio => "LM Studio".to_string(),
            ProviderType::Ollama => "Ollama".to_string(),
            ProviderType::OpenAiCompatible => "OpenAI Compatible".to_string(),
            ProviderType::LocalTransformers => "Local Transformers".to_string(),
        },
        provider_type,
        base_url,
        api_key: config.openai_api_key.clone(),
        enabled: true,
        test_model: Some(config.chat_model.clone()).filter(|s| !s.trim().is_empty()),
        created_at: now,
        updated_at: now,
    };

    let mut models = Vec::new();
    if !config.chat_model.trim().is_empty() {
        models.push(ModelProfile {
            id: chat_model_id.clone(),
            provider_profile_id: provider_id.clone(),
            profile_name: "Default Chat".to_string(),
            model_name: config.chat_model.clone(),
            capability: ModelCapability::Chat,
            enabled: true,
            temperature: None,
            max_tokens: None,
            top_p: None,
            system_prompt: None,
            enable_thinking: Some(config.enable_thinking),
            embedding_dimension: None,
            created_at: now,
            updated_at: now,
        });
    }

    models.push(ModelProfile {
        id: embedding_model_id.clone(),
        provider_profile_id: provider_id.clone(),
        profile_name: "Default Embedding".to_string(),
        model_name: config.embedding_model.clone(),
        capability: ModelCapability::Embedding,
        enabled: true,
        temperature: None,
        max_tokens: None,
        top_p: None,
        system_prompt: None,
        enable_thinking: None,
        embedding_dimension: Some(config.embedding_dimension),
        created_at: now,
        updated_at: now,
    });

    let chat_primary = models
        .iter()
        .find(|m| m.capability == ModelCapability::Chat)
        .map(|m| m.id.clone());

    let mut profiles = AiProfiles {
        providers: vec![provider],
        models,
        agents: vec![
            AgentConfig {
                slot: AgentSlot::Chat,
                primary_model_id: chat_primary.clone(),
                fallback_model_id: None,
                enabled: true,
                temperature: None,
                max_tokens: None,
                system_prompt: None,
                target_language: None,
                detail_level: None,
                warn_on_auto_summary: None,
                translation_parallelism: None,
            },
            AgentConfig {
                slot: AgentSlot::Summary,
                primary_model_id: chat_primary.clone(),
                fallback_model_id: None,
                enabled: true,
                temperature: None,
                max_tokens: None,
                system_prompt: None,
                target_language: None,
                detail_level: Some("medium".to_string()),
                warn_on_auto_summary: Some(true),
                translation_parallelism: None,
            },
            AgentConfig {
                slot: AgentSlot::Translate,
                primary_model_id: chat_primary.clone(),
                fallback_model_id: None,
                enabled: true,
                temperature: None,
                max_tokens: None,
                system_prompt: None,
                target_language: Some("English".to_string()),
                detail_level: None,
                warn_on_auto_summary: None,
                translation_parallelism: Some(5),
            },
            AgentConfig {
                slot: AgentSlot::DeepAnalyze,
                primary_model_id: chat_primary,
                fallback_model_id: None,
                enabled: true,
                temperature: None,
                max_tokens: None,
                system_prompt: None,
                target_language: None,
                detail_level: None,
                warn_on_auto_summary: None,
                translation_parallelism: None,
            },
            AgentConfig {
                slot: AgentSlot::Embedding,
                primary_model_id: Some(embedding_model_id),
                fallback_model_id: None,
                enabled: true,
                temperature: None,
                max_tokens: None,
                system_prompt: None,
                target_language: None,
                detail_level: None,
                warn_on_auto_summary: None,
                translation_parallelism: None,
            },
        ],
    };
    profiles.ensure_agent_slots();
    profiles
}

fn ensure_quickstart_default_providers(config: &mut Config) -> bool {
    let mut changed = false;
    let now = now_ts();

    if !config.ai_profiles.has_provider_type(ProviderType::LmStudio) {
        config.ai_profiles.providers.push(ProviderProfile {
            id: Uuid::new_v4().to_string(),
            display_name: "LM Studio".to_string(),
            provider_type: ProviderType::LmStudio,
            base_url: Some("http://localhost:1234/v1".to_string()),
            api_key: None,
            enabled: true,
            test_model: None,
            created_at: now,
            updated_at: now,
        });
        changed = true;
    }

    if !config.ai_profiles.has_provider_type(ProviderType::Ollama) {
        config.ai_profiles.providers.push(ProviderProfile {
            id: Uuid::new_v4().to_string(),
            display_name: "Ollama".to_string(),
            provider_type: ProviderType::Ollama,
            base_url: Some("http://localhost:11434/v1".to_string()),
            api_key: None,
            enabled: true,
            test_model: None,
            created_at: now,
            updated_at: now,
        });
        changed = true;
    }

    changed
}

fn to_legacy_provider(provider_type: &ProviderType) -> AiProvider {
    match provider_type {
        ProviderType::OpenAi => AiProvider::OpenAi,
        ProviderType::LmStudio
        | ProviderType::OpenAiCompatible
        | ProviderType::Ollama
        | ProviderType::LocalTransformers => AiProvider::LmStudio,
    }
}

fn sync_legacy_fields_from_ai_profiles(config: &mut Config) {
    let Some(chat_agent) = config.ai_profiles.get_agent(&AgentSlot::Chat) else {
        return;
    };
    if let Some(model_id) = chat_agent.primary_model_id.as_ref() {
        if let Some(model) = config.ai_profiles.get_model(model_id) {
            config.chat_model = model.model_name.clone();
            if let Some(thinking) = model.enable_thinking {
                config.enable_thinking = thinking;
            }
            if let Some(provider) = config.ai_profiles.get_provider(&model.provider_profile_id) {
                config.provider = to_legacy_provider(&provider.provider_type);
                if let Some(base_url) = provider.base_url.as_ref() {
                    match provider.provider_type {
                        ProviderType::OpenAi => {
                            config.openai_base_url = Some(base_url.clone());
                        }
                        _ => {
                            config.lm_studio_url = base_url.clone();
                        }
                    }
                }
                if matches!(provider.provider_type, ProviderType::OpenAi) {
                    config.openai_api_key = provider.api_key.clone();
                }
            }
        }
    }

    let Some(embed_agent) = config.ai_profiles.get_agent(&AgentSlot::Embedding) else {
        return;
    };
    if let Some(model_id) = embed_agent.primary_model_id.as_ref() {
        if let Some(model) = config.ai_profiles.get_model(model_id) {
            config.embedding_model = model.model_name.clone();
            if let Some(dim) = model.embedding_dimension {
                config.embedding_dimension = dim;
            }
            if let Some(provider) = config.ai_profiles.get_provider(&model.provider_profile_id) {
                config.embedding_provider = match provider.provider_type {
                    ProviderType::LocalTransformers => "local_transformers",
                    ProviderType::LmStudio => "lmstudio",
                    ProviderType::OpenAiCompatible | ProviderType::OpenAi => "openai_compatible",
                    ProviderType::Ollama => "ollama",
                }
                .to_string();
                if matches!(provider.provider_type, ProviderType::Ollama) {
                    config.embedding_ollama_url = provider.base_url.clone();
                }
            }
        }
    }
}

pub fn get_config_path() -> Result<PathBuf> {
    let mut path = dirs::config_dir()
        .ok_or_else(|| ReaderError::Internal("Failed to get config directory".to_string()))?;

    path.push("reader");
    fs::create_dir_all(&path)?;

    path.push("config.json");
    Ok(path)
}

pub fn load_config() -> Result<Config> {
    let config_path = get_config_path()?;

    if !config_path.exists() {
        let default_config = Config::default();
        save_config(&default_config)?;
        return Ok(default_config);
    }

    let content = fs::read_to_string(&config_path)?;
    let value: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| ReaderError::Internal(format!("Failed to parse config: {}", e)))?;
    let mut config: Config = serde_json::from_value(value.clone())
        .map_err(|e| ReaderError::Internal(format!("Failed to parse config: {}", e)))?;

    // Normalize embedding profile for local transformers.
    let normalized_model = if config.embedding_provider == "local_transformers" {
        normalize_local_embedding_model(&config.embedding_model)
    } else {
        config.embedding_model.clone()
    };
    let mut changed = false;
    if normalized_model != config.embedding_model {
        config.embedding_model = normalized_model;
        changed = true;
    }
    if config.embedding_dimension == 0 {
        config.embedding_dimension = default_embedding_dimension();
        changed = true;
    }

    let previous_version = config.config_version;
    if previous_version < AI_CONFIG_VERSION {
        config.config_version = AI_CONFIG_VERSION;
        changed = true;
    }

    if !config.ai_profiles.is_initialized() {
        config.ai_profiles = build_ai_profiles_from_legacy(&config);
        changed = true;
    }
    config.ai_profiles.ensure_agent_slots();
    for agent in &mut config.ai_profiles.agents {
        if matches!(agent.slot, AgentSlot::Translate) && agent.translation_parallelism.is_none() {
            agent.translation_parallelism = Some(5);
            changed = true;
        }
    }

    if ensure_quickstart_default_providers(&mut config) {
        changed = true;
    }

    // Backward compatibility: persist new fields if missing in old config files.
    let needs_backfill = value
        .as_object()
        .map(|obj| {
            !obj.contains_key("embedding_provider")
                || !obj.contains_key("keymap")
                || !obj.contains_key("config_version")
                || !obj.contains_key("ai_profiles")
        })
        .unwrap_or(false);
    if needs_backfill || changed {
        save_config(&config)?;
    }

    Ok(config)
}

pub fn save_config(config: &Config) -> Result<()> {
    let config_path = get_config_path()?;

    let mut to_save = config.clone();
    to_save.config_version = AI_CONFIG_VERSION;
    to_save.ai_profiles.ensure_agent_slots();
    if !to_save.ai_profiles.is_initialized() {
        to_save.ai_profiles = build_ai_profiles_from_legacy(&to_save);
    }
    sync_legacy_fields_from_ai_profiles(&mut to_save);

    let content = serde_json::to_string_pretty(&to_save)
        .map_err(|e| ReaderError::Internal(format!("Failed to serialize config: {}", e)))?;

    fs::write(&config_path, content)?;

    Ok(())
}
