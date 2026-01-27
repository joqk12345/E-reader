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
pub struct Config {
    pub provider: AiProvider,
    pub lm_studio_url: String,
    pub embedding_model: String,
    pub chat_model: String,
    pub openai_api_key: Option<String>,
    pub openai_base_url: Option<String>,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            provider: AiProvider::LmStudio,
            lm_studio_url: "http://localhost:1234/v1".to_string(),
            embedding_model: "text-embedding-ada-002".to_string(),
            chat_model: "local-model".to_string(),
            openai_api_key: None,
            openai_base_url: Some("https://api.openai.com/v1".to_string()),
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
    let config: Config = serde_json::from_str(&content)
        .map_err(|e| ReaderError::Internal(format!("Failed to parse config: {}", e)))?;

    Ok(config)
}

pub fn save_config(config: &Config) -> Result<()> {
    let config_path = get_config_path()?;

    let content = serde_json::to_string_pretty(config)
        .map_err(|e| ReaderError::Internal(format!("Failed to serialize config: {}", e)))?;

    fs::write(&config_path, content)?;

    Ok(())
}
