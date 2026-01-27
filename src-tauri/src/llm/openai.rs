use crate::error::Result;
use crate::llm::provider::{AiClient, ChatMessage};
use crate::ReaderError;
use async_trait::async_trait;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Serialize)]
struct EmbeddingRequest {
    input: String,
    model: String,
}

#[derive(Debug, Deserialize)]
struct EmbeddingResponse {
    data: Vec<EmbeddingData>,
}

#[derive(Debug, Deserialize)]
struct EmbeddingData {
    embedding: Vec<f32>,
}

#[derive(Debug, Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    temperature: f32,
    max_tokens: usize,
}

#[derive(Debug, Deserialize)]
struct ChatResponse {
    choices: Vec<ChatChoice>,
}

#[derive(Debug, Deserialize)]
struct ChatChoice {
    message: ChatMessage,
}

pub struct OpenAiClient {
    client: Client,
    base_url: String,
    api_key: String,
    embedding_model: String,
    chat_model: String,
}

impl OpenAiClient {
    pub fn new(
        base_url: String,
        api_key: String,
        embedding_model: String,
        chat_model: String,
    ) -> Result<Self> {
        let client = Client::builder()
            .timeout(Duration::from_secs(120))
            .build()
            .map_err(|e| ReaderError::Internal(format!("Failed to create HTTP client: {}", e)))?;

        Ok(OpenAiClient {
            client,
            base_url,
            api_key,
            embedding_model,
            chat_model,
        })
    }
}

#[async_trait]
impl AiClient for OpenAiClient {
    async fn generate_embedding(&self, text: &str) -> Result<Vec<f32>> {
        let url = format!("{}/embeddings", self.base_url);

        let request = EmbeddingRequest {
            input: text.to_string(),
            model: self.embedding_model.clone(),
        };

        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .json(&request)
            .send()
            .await
            .map_err(|e| ReaderError::ModelApi(format!("Failed to send request: {}", e)))?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response
                .text()
                .await
                .unwrap_or_else(|_| "Unknown error".to_string());
            return Err(ReaderError::ModelApi(format!(
                "Embedding API error ({}): {}",
                status, error_text
            )));
        }

        let embedding_response: EmbeddingResponse = response
            .json()
            .await
            .map_err(|e| ReaderError::ModelApi(format!("Failed to parse response: {}", e)))?;

        if embedding_response.data.is_empty() {
            return Err(ReaderError::ModelApi("No embedding data in response".to_string()));
        }

        Ok(embedding_response.data[0].embedding.clone())
    }

    async fn chat(
        &self,
        messages: Vec<ChatMessage>,
        temperature: f32,
        max_tokens: usize,
    ) -> Result<String> {
        let url = format!("{}/chat/completions", self.base_url);

        let request = ChatRequest {
            model: self.chat_model.clone(),
            messages,
            temperature,
            max_tokens,
        };

        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .json(&request)
            .send()
            .await
            .map_err(|e| ReaderError::ModelApi(format!("Failed to send request: {}", e)))?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response
                .text()
                .await
                .unwrap_or_else(|_| "Unknown error".to_string());
            return Err(ReaderError::ModelApi(format!(
                "Chat API error ({}): {}",
                status, error_text
            )));
        }

        let chat_response: ChatResponse = response
            .json()
            .await
            .map_err(|e| ReaderError::ModelApi(format!("Failed to parse response: {}", e)))?;

        if chat_response.choices.is_empty() {
            return Err(ReaderError::ModelApi("No choices in response".to_string()));
        }

        Ok(chat_response.choices[0].message.content.clone())
    }
}
