use crate::config::{
    load_config, save_config, AgentConfig, AgentSlot, Config, ModelCapability, ModelProfile,
    ProviderProfile, ProviderType,
};
use crate::error::{ReaderError, Result};
use crate::llm::{create_client_for_profile, ChatMessage};
use reqwest::Client;
use serde::Serialize;
use std::time::{Duration, Instant};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize)]
pub struct AiProfilesPayload {
    pub providers: Vec<ProviderProfile>,
    pub models: Vec<ModelProfile>,
    pub agents: Vec<AgentConfig>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProviderTestResult {
    pub ok: bool,
    pub provider_type: String,
    pub endpoint: String,
    pub model: String,
    pub latency_ms: Option<u64>,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ModelTestResult {
    pub ok: bool,
    pub model_id: String,
    pub capability: String,
    pub endpoint: String,
    pub latency_ms: Option<u64>,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ResolvedRuntimeResult {
    pub slot: AgentSlot,
    pub primary_model_id: Option<String>,
    pub fallback_model_id: Option<String>,
    pub provider_display_name: Option<String>,
    pub model_name: Option<String>,
    pub temperature: Option<f32>,
    pub max_tokens: Option<usize>,
    pub system_prompt: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ResolvedRuntime {
    pub primary: Option<(ProviderProfile, ModelProfile)>,
    pub fallback: Option<(ProviderProfile, ModelProfile)>,
    pub temperature: Option<f32>,
    pub max_tokens: Option<usize>,
    pub system_prompt: Option<String>,
}

fn merge_temperature(agent: Option<f32>, model: Option<f32>, default_value: f32) -> f32 {
    agent.or(model).unwrap_or(default_value)
}

fn merge_max_tokens(agent: Option<usize>, model: Option<usize>, default_value: usize) -> usize {
    agent.or(model).unwrap_or(default_value)
}

fn fallback_error(slot: &AgentSlot, primary_err: &str, fallback_err: &str) -> ReaderError {
    ReaderError::ModelApi(format!(
        r#"{{"slot":"{:?}","primary_error":"{}","fallback_error":"{}","actionable_hint":"Check provider endpoint, API key, and selected model availability."}}"#,
        slot,
        primary_err.replace('"', "'"),
        fallback_err.replace('"', "'")
    ))
}

fn requires_api_key(provider: &ProviderProfile) -> bool {
    match provider.provider_type {
        ProviderType::OpenAi => true,
        ProviderType::OpenAiCompatible => false,
        ProviderType::LmStudio | ProviderType::Ollama | ProviderType::LocalTransformers => false,
    }
}

fn validate_provider(profile: &ProviderProfile) -> Result<()> {
    if profile.display_name.trim().is_empty() {
        return Err(ReaderError::InvalidArgument(
            "Display name cannot be empty".to_string(),
        ));
    }

    if requires_api_key(profile) {
        let key = profile.api_key.as_ref().map(|s| s.trim()).unwrap_or("");
        if key.is_empty() {
            return Err(ReaderError::InvalidArgument(
                "API key is required for this provider".to_string(),
            ));
        }
    }

    match profile.provider_type {
        ProviderType::LocalTransformers => {}
        _ => {
            let base = profile.base_url.as_ref().map(|s| s.trim()).unwrap_or("");
            if base.is_empty() {
                return Err(ReaderError::InvalidArgument(
                    "Base URL is required for this provider".to_string(),
                ));
            }
            if !base.starts_with("http://") && !base.starts_with("https://") {
                return Err(ReaderError::InvalidArgument(
                    "Base URL must start with http:// or https://".to_string(),
                ));
            }
        }
    }

    Ok(())
}

fn validate_model(config: &Config, model: &ModelProfile) -> Result<()> {
    if model.provider_profile_id.trim().is_empty() {
        return Err(ReaderError::InvalidArgument(
            "Provider is required".to_string(),
        ));
    }
    if config
        .ai_profiles
        .providers
        .iter()
        .all(|p| p.id != model.provider_profile_id)
    {
        return Err(ReaderError::InvalidArgument(
            "Provider profile does not exist".to_string(),
        ));
    }
    if model.profile_name.trim().is_empty() {
        return Err(ReaderError::InvalidArgument(
            "Profile name cannot be empty".to_string(),
        ));
    }
    if model.model_name.trim().is_empty() {
        return Err(ReaderError::InvalidArgument(
            "Model name cannot be empty".to_string(),
        ));
    }
    if matches!(model.capability, ModelCapability::Embedding)
        && model.embedding_dimension.unwrap_or(0) == 0
    {
        return Err(ReaderError::InvalidArgument(
            "Embedding model requires embedding_dimension".to_string(),
        ));
    }
    Ok(())
}

fn model_matches_slot_capability(model: &ModelProfile, slot: &AgentSlot) -> bool {
    match slot.required_capability() {
        ModelCapability::Embedding => model.capability == ModelCapability::Embedding,
        ModelCapability::Chat => {
            model.capability == ModelCapability::Chat
                || model.capability == ModelCapability::Multimodal
        }
        ModelCapability::Multimodal => model.capability == ModelCapability::Multimodal,
    }
}

fn validate_agent_config(config: &Config, agent: &AgentConfig) -> Result<()> {
    if let (Some(primary), Some(fallback)) = (
        agent.primary_model_id.as_ref(),
        agent.fallback_model_id.as_ref(),
    ) {
        if primary == fallback {
            return Err(ReaderError::InvalidArgument(
                "Primary and fallback models must be different".to_string(),
            ));
        }
    }

    for model_id in [
        agent.primary_model_id.as_ref(),
        agent.fallback_model_id.as_ref(),
    ] {
        if let Some(model_id) = model_id {
            let model = config
                .ai_profiles
                .models
                .iter()
                .find(|m| &m.id == model_id)
                .ok_or_else(|| {
                    ReaderError::InvalidArgument(format!("Model {} does not exist", model_id))
                })?;
            if !model_matches_slot_capability(model, &agent.slot) {
                return Err(ReaderError::InvalidArgument(format!(
                    "Model capability does not match slot {:?}",
                    agent.slot
                )));
            }
        }
    }

    if let Some(parallelism) = agent.translation_parallelism {
        if parallelism < 1 || parallelism > 10 {
            return Err(ReaderError::InvalidArgument(
                "translation_parallelism must be in range 1..=10".to_string(),
            ));
        }
    }

    Ok(())
}

fn build_ai_profiles_payload(config: &Config) -> AiProfilesPayload {
    AiProfilesPayload {
        providers: config.ai_profiles.providers.clone(),
        models: config.ai_profiles.models.clone(),
        agents: config.ai_profiles.agents.clone(),
    }
}

#[tauri::command]
pub async fn get_ai_profiles() -> Result<AiProfilesPayload> {
    let mut config = load_config()?;
    config.ai_profiles.ensure_agent_slots();
    Ok(build_ai_profiles_payload(&config))
}

#[tauri::command]
pub async fn save_provider_profile(profile: ProviderProfile) -> Result<ProviderProfile> {
    let mut config = load_config()?;
    let now = chrono::Utc::now().timestamp_millis() as u64;

    let mut next = profile;
    if next.id.trim().is_empty() {
        next.id = Uuid::new_v4().to_string();
        next.created_at = now;
    }
    next.updated_at = now;
    validate_provider(&next)?;

    if let Some(existing) = config
        .ai_profiles
        .providers
        .iter_mut()
        .find(|p| p.id == next.id)
    {
        *existing = next.clone();
    } else {
        config.ai_profiles.providers.push(next.clone());
    }

    save_config(&config)?;
    Ok(next)
}

#[tauri::command]
pub async fn save_model_profile(model: ModelProfile) -> Result<ModelProfile> {
    let mut config = load_config()?;
    let now = chrono::Utc::now().timestamp_millis() as u64;

    let mut next = model;
    if next.id.trim().is_empty() {
        next.id = Uuid::new_v4().to_string();
        next.created_at = now;
    }
    next.updated_at = now;
    validate_model(&config, &next)?;

    if let Some(existing) = config
        .ai_profiles
        .models
        .iter_mut()
        .find(|m| m.id == next.id)
    {
        *existing = next.clone();
    } else {
        config.ai_profiles.models.push(next.clone());
    }

    save_config(&config)?;
    Ok(next)
}

#[tauri::command]
pub async fn save_agent_config(slot: AgentSlot, config_patch: AgentConfig) -> Result<AgentConfig> {
    if slot != config_patch.slot {
        return Err(ReaderError::InvalidArgument(
            "slot mismatch between argument and payload".to_string(),
        ));
    }
    let mut config = load_config()?;
    let mut normalized = config_patch;
    if matches!(slot, AgentSlot::Translate) && normalized.translation_parallelism.is_none() {
        normalized.translation_parallelism = Some(5);
    }
    validate_agent_config(&config, &normalized)?;

    if let Some(existing) = config
        .ai_profiles
        .agents
        .iter_mut()
        .find(|a| a.slot == slot)
    {
        *existing = normalized.clone();
    } else {
        config.ai_profiles.agents.push(normalized.clone());
    }

    save_config(&config)?;
    Ok(normalized)
}

#[tauri::command]
pub async fn delete_provider_profile(id: String) -> Result<()> {
    let mut config = load_config()?;
    if config
        .ai_profiles
        .models
        .iter()
        .any(|m| m.provider_profile_id == id)
    {
        return Err(ReaderError::InvalidArgument(
            "Cannot delete provider: models still depend on it".to_string(),
        ));
    }

    let len_before = config.ai_profiles.providers.len();
    config.ai_profiles.providers.retain(|p| p.id != id);
    if len_before == config.ai_profiles.providers.len() {
        return Err(ReaderError::NotFound("Provider not found".to_string()));
    }

    save_config(&config)?;
    Ok(())
}

#[tauri::command]
pub async fn delete_model_profile(id: String) -> Result<()> {
    let mut config = load_config()?;
    if config.ai_profiles.agents.iter().any(|a| {
        a.primary_model_id
            .as_ref()
            .map(|m| m == &id)
            .unwrap_or(false)
            || a.fallback_model_id
                .as_ref()
                .map(|m| m == &id)
                .unwrap_or(false)
    }) {
        return Err(ReaderError::InvalidArgument(
            "Cannot delete model: agents still depend on it".to_string(),
        ));
    }

    let len_before = config.ai_profiles.models.len();
    config.ai_profiles.models.retain(|m| m.id != id);
    if len_before == config.ai_profiles.models.len() {
        return Err(ReaderError::NotFound("Model not found".to_string()));
    }

    save_config(&config)?;
    Ok(())
}

#[tauri::command]
pub async fn test_provider_profile(profile: ProviderProfile) -> Result<ProviderTestResult> {
    validate_provider(&profile)?;

    let endpoint = profile.base_url.clone().unwrap_or_default();
    let started = Instant::now();

    if matches!(profile.provider_type, ProviderType::LocalTransformers) {
        return Ok(ProviderTestResult {
            ok: true,
            provider_type: "local_transformers".to_string(),
            endpoint: "local".to_string(),
            model: profile.test_model.clone().unwrap_or_default(),
            latency_ms: Some(0),
            detail: "Local transformers provider does not require endpoint probing".to_string(),
        });
    }

    let http_client = Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| ReaderError::ModelApi(format!("Failed to create HTTP client: {}", e)))?;

    let mut req = http_client.get(format!("{}/models", endpoint.trim_end_matches('/')));
    if let Some(key) = profile.api_key.as_ref().filter(|k| !k.trim().is_empty()) {
        req = req.header("Authorization", format!("Bearer {}", key));
    }

    let response = req
        .send()
        .await
        .map_err(|e| ReaderError::ModelApi(format!("Provider test request failed: {}", e)))?;

    let latency = Some(started.elapsed().as_millis() as u64);
    if response.status().is_success() {
        Ok(ProviderTestResult {
            ok: true,
            provider_type: format!("{:?}", profile.provider_type).to_lowercase(),
            endpoint,
            model: profile.test_model.clone().unwrap_or_default(),
            latency_ms: latency,
            detail: "Provider endpoint is reachable".to_string(),
        })
    } else {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        Ok(ProviderTestResult {
            ok: false,
            provider_type: format!("{:?}", profile.provider_type).to_lowercase(),
            endpoint,
            model: profile.test_model.clone().unwrap_or_default(),
            latency_ms: latency,
            detail: format!("Provider test failed ({}): {}", status, text),
        })
    }
}

#[tauri::command]
pub async fn test_model_profile(
    model_id: String,
    prompt: Option<String>,
) -> Result<ModelTestResult> {
    let config = load_config()?;
    let model = config
        .ai_profiles
        .models
        .iter()
        .find(|m| m.id == model_id)
        .cloned()
        .ok_or_else(|| ReaderError::NotFound("Model not found".to_string()))?;

    let provider = config
        .ai_profiles
        .providers
        .iter()
        .find(|p| p.id == model.provider_profile_id)
        .cloned()
        .ok_or_else(|| ReaderError::NotFound("Provider not found".to_string()))?;

    let endpoint = provider
        .base_url
        .clone()
        .unwrap_or_else(|| "local".to_string());
    let started = Instant::now();

    let client = create_client_for_profile(&provider, &model)?;

    let result_detail = match model.capability {
        ModelCapability::Embedding => {
            let _ = client
                .generate_embedding(prompt.as_deref().unwrap_or("ping"))
                .await?;
            "Embedding call succeeded".to_string()
        }
        ModelCapability::Chat | ModelCapability::Multimodal => {
            let reply = client
                .chat(
                    vec![
                        ChatMessage {
                            role: "system".to_string(),
                            content: "You are a connectivity probe. Reply with exactly: OK"
                                .to_string(),
                        },
                        ChatMessage {
                            role: "user".to_string(),
                            content: prompt.unwrap_or_else(|| "Ping".to_string()),
                        },
                    ],
                    model.temperature.unwrap_or(0.0),
                    model.max_tokens.unwrap_or(32),
                )
                .await?;
            format!("Model reply: {}", reply.trim())
        }
    };

    Ok(ModelTestResult {
        ok: true,
        model_id,
        capability: format!("{:?}", model.capability).to_lowercase(),
        endpoint,
        latency_ms: Some(started.elapsed().as_millis() as u64),
        detail: result_detail,
    })
}

pub fn resolve_agent_runtime_with_config(
    config: &Config,
    slot: AgentSlot,
) -> Result<ResolvedRuntime> {
    let agent = config
        .ai_profiles
        .get_agent(&slot)
        .ok_or_else(|| ReaderError::NotFound(format!("Agent slot {:?} not found", slot)))?
        .clone();

    let resolve_model = |model_id: &str| -> Result<(ProviderProfile, ModelProfile)> {
        let model = config
            .ai_profiles
            .models
            .iter()
            .find(|m| m.id == model_id)
            .cloned()
            .ok_or_else(|| ReaderError::NotFound(format!("Model {} not found", model_id)))?;

        if !model_matches_slot_capability(&model, &slot) {
            return Err(ReaderError::InvalidArgument(format!(
                "Model {} capability does not match slot {:?}",
                model_id, slot
            )));
        }

        let provider = config
            .ai_profiles
            .providers
            .iter()
            .find(|p| p.id == model.provider_profile_id)
            .cloned()
            .ok_or_else(|| {
                ReaderError::NotFound(format!(
                    "Provider {} not found for model {}",
                    model.provider_profile_id, model.id
                ))
            })?;

        Ok((provider, model))
    };

    let primary = agent
        .primary_model_id
        .as_ref()
        .map(|id| resolve_model(id))
        .transpose()?;

    let fallback = agent
        .fallback_model_id
        .as_ref()
        .map(|id| resolve_model(id))
        .transpose()?;

    Ok(ResolvedRuntime {
        primary,
        fallback,
        temperature: agent.temperature,
        max_tokens: agent.max_tokens,
        system_prompt: agent.system_prompt,
    })
}

#[tauri::command]
pub async fn resolve_agent_runtime(slot: AgentSlot) -> Result<ResolvedRuntimeResult> {
    let config = load_config()?;
    let resolved = resolve_agent_runtime_with_config(&config, slot.clone())?;

    let (provider_display_name, model_name, primary_model_id) = resolved
        .primary
        .as_ref()
        .map(|(p, m)| {
            (
                Some(p.display_name.clone()),
                Some(m.model_name.clone()),
                Some(m.id.clone()),
            )
        })
        .unwrap_or((None, None, None));

    Ok(ResolvedRuntimeResult {
        slot,
        primary_model_id,
        fallback_model_id: resolved.fallback.as_ref().map(|(_, m)| m.id.clone()),
        provider_display_name,
        model_name,
        temperature: resolved.temperature,
        max_tokens: resolved.max_tokens,
        system_prompt: resolved.system_prompt,
    })
}

pub async fn chat_with_agent_slot(
    config: &Config,
    slot: AgentSlot,
    messages: Vec<ChatMessage>,
    default_temperature: f32,
    default_max_tokens: usize,
) -> Result<String> {
    let runtime = resolve_agent_runtime_with_config(config, slot.clone())?;
    let (primary_provider, primary_model) = runtime.primary.ok_or_else(|| {
        ReaderError::InvalidArgument(format!("No primary model configured for {:?}", slot))
    })?;

    let primary_temp = merge_temperature(
        runtime.temperature,
        primary_model.temperature,
        default_temperature,
    );
    let primary_max = merge_max_tokens(
        runtime.max_tokens,
        primary_model.max_tokens,
        default_max_tokens,
    );

    let primary_client = create_client_for_profile(&primary_provider, &primary_model)?;
    let first_attempt = primary_client
        .chat(messages.clone(), primary_temp, primary_max)
        .await;
    let primary_result = match first_attempt {
        Ok(output) => Ok(output),
        Err(_) => {
            primary_client
                .chat(messages.clone(), primary_temp, primary_max)
                .await
        }
    };

    match primary_result {
        Ok(output) => Ok(output),
        Err(primary_err) => {
            let Some((fallback_provider, fallback_model)) = runtime.fallback else {
                return Err(primary_err);
            };
            let fallback_temp = merge_temperature(
                runtime.temperature,
                fallback_model.temperature,
                default_temperature,
            );
            let fallback_max = merge_max_tokens(
                runtime.max_tokens,
                fallback_model.max_tokens,
                default_max_tokens,
            );
            let fallback_client = create_client_for_profile(&fallback_provider, &fallback_model)?;
            match fallback_client
                .chat(messages, fallback_temp, fallback_max)
                .await
            {
                Ok(output) => Ok(output),
                Err(fallback_err) => Err(fallback_error(
                    &slot,
                    &primary_err.to_string(),
                    &fallback_err.to_string(),
                )),
            }
        }
    }
}

pub async fn embedding_with_agent_slot(
    config: &Config,
    slot: AgentSlot,
    text: &str,
) -> Result<Vec<f32>> {
    let runtime = resolve_agent_runtime_with_config(config, slot.clone())?;
    let (primary_provider, primary_model) = runtime.primary.ok_or_else(|| {
        ReaderError::InvalidArgument(format!("No primary model configured for {:?}", slot))
    })?;

    let primary_client = create_client_for_profile(&primary_provider, &primary_model)?;
    let primary_result = match primary_client.generate_embedding(text).await {
        Ok(vec) => Ok(vec),
        Err(_) => primary_client.generate_embedding(text).await,
    };

    match primary_result {
        Ok(vec) => Ok(vec),
        Err(primary_err) => {
            let Some((fallback_provider, fallback_model)) = runtime.fallback else {
                return Err(primary_err);
            };
            let fallback_client = create_client_for_profile(&fallback_provider, &fallback_model)?;
            match fallback_client.generate_embedding(text).await {
                Ok(vec) => Ok(vec),
                Err(fallback_err) => Err(fallback_error(
                    &slot,
                    &primary_err.to_string(),
                    &fallback_err.to_string(),
                )),
            }
        }
    }
}
