use crate::config::{load_config, save_config, Config};
use crate::error::Result;
use crate::llm::{create_client, ChatMessage};
use std::time::Instant;
use tokio::time::{timeout, Duration};

/// Gets the current configuration
///
/// Returns the LM Studio URL and model settings
#[tauri::command]
pub async fn get_config() -> Result<Config> {
    let config = load_config()?;
    Ok(config)
}

/// Saves the configuration
///
/// Updates the LM Studio URL and model settings
#[tauri::command]
pub async fn update_config(config: Config) -> Result<()> {
    let mut next = config;

    // AI profiles are managed by dedicated commands (save_provider_profile/save_model_profile/save_agent_config).
    // `update_config` is still used by legacy/general settings and may carry stale ai_profiles snapshot.
    // Always preserve persisted ai_profiles here to prevent accidental overwrite.
    let persisted = load_config()?;
    next.ai_profiles = persisted.ai_profiles;

    save_config(&next)?;
    Ok(())
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ModelConnectionTestResult {
    pub ok: bool,
    pub provider: String,
    pub endpoint: String,
    pub model: String,
    pub latency_ms: Option<u64>,
    pub detail: String,
}

/// Tests model service connectivity with the given config (or persisted config if omitted).
///
/// Performs a minimal chat completion request and returns structured diagnostic info.
#[tauri::command]
pub async fn test_model_connection(config: Option<Config>) -> Result<ModelConnectionTestResult> {
    let config = if let Some(config) = config {
        config
    } else {
        load_config()?
    };

    let provider = match config.provider {
        crate::config::AiProvider::LmStudio => "lmstudio".to_string(),
        crate::config::AiProvider::OpenAi => "openai".to_string(),
    };

    let endpoint = if provider == "openai" {
        config
            .openai_base_url
            .clone()
            .unwrap_or_else(|| "https://api.openai.com/v1".to_string())
    } else {
        config.lm_studio_url.clone()
    };

    if config.chat_model.trim().is_empty() {
        return Ok(ModelConnectionTestResult {
            ok: false,
            provider,
            endpoint,
            model: config.chat_model.clone(),
            latency_ms: None,
            detail: "Chat model is empty. Please set Chat Model first.".to_string(),
        });
    }

    if provider == "openai" {
        let key_empty = config
            .openai_api_key
            .as_ref()
            .map(|k| k.trim().is_empty())
            .unwrap_or(true);
        if key_empty {
            return Ok(ModelConnectionTestResult {
                ok: false,
                provider,
                endpoint,
                model: config.chat_model.clone(),
                latency_ms: None,
                detail: "OpenAI API key is empty. Please set OpenAI API Key first.".to_string(),
            });
        }
    }

    let model = config.chat_model.clone();
    let client = match create_client(&config) {
        Ok(client) => client,
        Err(error) => {
            return Ok(ModelConnectionTestResult {
                ok: false,
                provider,
                endpoint,
                model,
                latency_ms: None,
                detail: error.to_string(),
            })
        }
    };

    let messages = vec![
        ChatMessage {
            role: "system".to_string(),
            content: "You are a connectivity probe. Reply with exactly: OK".to_string(),
        },
        ChatMessage {
            role: "user".to_string(),
            content: "Ping".to_string(),
        },
    ];

    let started = Instant::now();
    let result = timeout(Duration::from_secs(20), client.chat(messages, 0.0, 16)).await;
    let latency_ms = Some(started.elapsed().as_millis() as u64);

    match result {
        Ok(Ok(reply)) => Ok(ModelConnectionTestResult {
            ok: true,
            provider,
            endpoint,
            model,
            latency_ms,
            detail: format!("Connected. Model reply: {}", reply.trim()),
        }),
        Ok(Err(error)) => Ok(ModelConnectionTestResult {
            ok: false,
            provider,
            endpoint,
            model,
            latency_ms,
            detail: error.to_string(),
        }),
        Err(_) => Ok(ModelConnectionTestResult {
            ok: false,
            provider,
            endpoint,
            model,
            latency_ms,
            detail: "Connection test timed out after 20 seconds".to_string(),
        }),
    }
}
