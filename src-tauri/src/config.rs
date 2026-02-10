use crate::{error::Result, ReaderError};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeymapConfig {
    #[serde(default = "default_keymap_next_page")]
    pub next_page: Vec<String>,
    #[serde(default = "default_keymap_prev_page")]
    pub prev_page: Vec<String>,
    #[serde(default = "default_keymap_open_settings")]
    pub open_settings: Vec<String>,
}

impl Default for KeymapConfig {
    fn default() -> Self {
        Self {
            next_page: default_keymap_next_page(),
            prev_page: default_keymap_prev_page(),
            open_settings: default_keymap_open_settings(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
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
    pub chat_model: String,
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
    vec!["PageUp".to_string(), "Shift+Space".to_string(), "K".to_string()]
}

fn default_keymap_open_settings() -> Vec<String> {
    vec!["Cmd+,".to_string(), "Ctrl+,".to_string()]
}

impl Default for Config {
    fn default() -> Self {
        Config {
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
            chat_model: "local-model".to_string(),
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

    // Backward compatibility: persist new embedding fields if missing in old config files.
    let needs_backfill = value
        .as_object()
        .map(|obj| !obj.contains_key("embedding_provider") || !obj.contains_key("keymap"))
        .unwrap_or(false);
    if needs_backfill || changed {
        save_config(&config)?;
    }

    Ok(config)
}

pub fn save_config(config: &Config) -> Result<()> {
    let config_path = get_config_path()?;

    let content = serde_json::to_string_pretty(config)
        .map_err(|e| ReaderError::Internal(format!("Failed to serialize config: {}", e)))?;

    fs::write(&config_path, content)?;

    Ok(())
}
