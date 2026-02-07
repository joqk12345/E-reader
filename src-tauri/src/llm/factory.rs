use crate::config::{AiProvider, Config};
use crate::error::Result;
use crate::llm::{AiClient, LmStudioClient, OpenAiClient};
use std::sync::Arc;

pub fn create_client(config: &Config) -> Result<Arc<dyn AiClient>> {
    match config.provider {
        AiProvider::LmStudio => {
            let client = LmStudioClient::new(
                config.lm_studio_url.clone(),
                config.embedding_model.clone(),
                config.chat_model.clone(),
            )?;
            Ok(Arc::new(client))
        }
        AiProvider::OpenAi => {
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
            )?;
            Ok(Arc::new(client))
        }
    }
}
