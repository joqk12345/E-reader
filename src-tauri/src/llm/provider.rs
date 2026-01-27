use crate::{error::Result, ReaderError};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[async_trait]
pub trait AiClient: Send + Sync {
    async fn generate_embedding(&self, text: &str) -> Result<Vec<f32>>;

    async fn chat(
        &self,
        messages: Vec<ChatMessage>,
        temperature: f32,
        max_tokens: usize,
    ) -> Result<String>;
}
