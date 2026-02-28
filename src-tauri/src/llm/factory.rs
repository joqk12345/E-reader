use crate::config::{Config, ModelProfile, ProviderProfile, ProviderType};
use crate::error::Result;
use crate::llm::{AiClient, LmStudioClient, OpenAiClient};
use crate::ReaderError;
use std::sync::Arc;

pub fn create_client(config: &Config) -> Result<Arc<dyn AiClient>> {
    match config.provider {
        crate::config::AiProvider::LmStudio => {
            let client = LmStudioClient::new(
                config.lm_studio_url.clone(),
                config.embedding_model.clone(),
                config.chat_model.clone(),
                config.enable_thinking,
            )?;
            Ok(Arc::new(client))
        }
        crate::config::AiProvider::OpenAi => {
            let api_key = config.openai_api_key.as_ref().ok_or_else(|| {
                crate::ReaderError::Internal("OpenAI API key is not configured".to_string())
            })?;

            let base_url = config
                .openai_base_url
                .as_ref()
                .cloned()
                .unwrap_or_else(|| "https://api.openai.com/v1".to_string());

            let client = OpenAiClient::new(
                base_url,
                api_key.clone(),
                config.embedding_model.clone(),
                config.chat_model.clone(),
                config.enable_thinking,
            )?;
            Ok(Arc::new(client))
        }
    }
}

fn default_base_url(provider_type: &ProviderType) -> Option<String> {
    match provider_type {
        ProviderType::OpenAi => Some("https://api.openai.com/v1".to_string()),
        ProviderType::LmStudio => Some("http://localhost:1234/v1".to_string()),
        ProviderType::Ollama => Some("http://localhost:11434/v1".to_string()),
        ProviderType::OpenAiCompatible => Some("http://localhost:8000/v1".to_string()),
        ProviderType::LocalTransformers => None,
    }
}

pub fn create_client_for_profile(
    provider: &ProviderProfile,
    model: &ModelProfile,
) -> Result<Arc<dyn AiClient>> {
    let model_name = model.model_name.trim();
    if model_name.is_empty() {
        return Err(ReaderError::InvalidArgument(
            "Model name cannot be empty".to_string(),
        ));
    }

    let base_url = provider
        .base_url
        .clone()
        .or_else(|| default_base_url(&provider.provider_type))
        .ok_or_else(|| ReaderError::InvalidArgument("Provider base_url is required".to_string()))?;

    let enable_thinking = model.enable_thinking.unwrap_or(false);
    match provider.provider_type {
        ProviderType::OpenAi => {
            let api_key = provider.api_key.as_ref().map(|v| v.trim()).unwrap_or("");
            if api_key.is_empty() {
                return Err(ReaderError::InvalidArgument(
                    "OpenAI provider requires API key".to_string(),
                ));
            }
            let client = OpenAiClient::new(
                base_url,
                api_key.to_string(),
                model_name.to_string(),
                model_name.to_string(),
                enable_thinking,
            )?;
            Ok(Arc::new(client))
        }
        ProviderType::OpenAiCompatible => {
            let api_key = provider.api_key.as_ref().map(|v| v.trim()).unwrap_or("");
            if api_key.is_empty() {
                let client = LmStudioClient::new(
                    base_url,
                    model_name.to_string(),
                    model_name.to_string(),
                    enable_thinking,
                )?;
                Ok(Arc::new(client))
            } else {
                let client = OpenAiClient::new(
                    base_url,
                    api_key.to_string(),
                    model_name.to_string(),
                    model_name.to_string(),
                    enable_thinking,
                )?;
                Ok(Arc::new(client))
            }
        }
        ProviderType::LmStudio | ProviderType::Ollama => {
            let client = LmStudioClient::new(
                base_url,
                model_name.to_string(),
                model_name.to_string(),
                enable_thinking,
            )?;
            Ok(Arc::new(client))
        }
        ProviderType::LocalTransformers => Err(ReaderError::InvalidArgument(
            "Local transformers provider is frontend-only for embedding generation".to_string(),
        )),
    }
}
