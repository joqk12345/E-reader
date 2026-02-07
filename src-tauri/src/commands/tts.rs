use crate::config::load_config;
use crate::error::{ReaderError, Result};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::process::Command;
use uuid::Uuid;

#[derive(Debug, Clone, Deserialize)]
pub struct TtsRequest {
    pub text: String,
    pub language: String,
    pub provider: Option<String>,
    pub voice: Option<String>,
    pub rate: Option<f32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TtsAudio {
    pub audio: Vec<u8>,
    pub mime_type: String,
    pub provider: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TtsVoice {
    pub provider: String,
    pub language: String,
    pub id: String,
    pub name: String,
}

#[tauri::command]
pub async fn list_tts_voices() -> Result<Vec<TtsVoice>> {
    let mut voices = Vec::new();
    voices.push(TtsVoice {
        provider: "edge".to_string(),
        language: "en".to_string(),
        id: "en-US-AriaNeural".to_string(),
        name: "Aria (English)".to_string(),
    });
    voices.push(TtsVoice {
        provider: "edge".to_string(),
        language: "zh".to_string(),
        id: "zh-CN-XiaoxiaoNeural".to_string(),
        name: "Xiaoxiao (中文)".to_string(),
    });
    voices.push(TtsVoice {
        provider: "cosyvoice".to_string(),
        language: "zh".to_string(),
        id: "cosyvoice-default".to_string(),
        name: "CosyVoice Default".to_string(),
    });
    Ok(voices)
}

#[tauri::command]
pub async fn tts_synthesize(request: TtsRequest) -> Result<TtsAudio> {
    if request.text.trim().is_empty() {
        return Err(ReaderError::InvalidArgument("TTS text cannot be empty".to_string()));
    }

    let config = load_config()?;
    let language = normalize_language(&request.language);
    let selected_provider = select_provider(
        request.provider.as_deref(),
        &config.tts_provider,
        language,
        config.cosyvoice_base_url.as_deref(),
    );
    let rate = request.rate.unwrap_or(1.0).clamp(0.6, 1.8);

    match selected_provider.as_str() {
        "cosyvoice" => synthesize_cosyvoice(&request, &config, language, rate).await,
        _ => synthesize_edge(&request, &config, language, rate).await,
    }
}

fn normalize_language(language: &str) -> &str {
    let lower = language.to_lowercase();
    if lower.starts_with("zh") {
        "zh"
    } else {
        "en"
    }
}

fn select_provider(
    request_provider: Option<&str>,
    config_provider: &str,
    language: &str,
    cosyvoice_base_url: Option<&str>,
) -> String {
    let candidate = request_provider.unwrap_or(config_provider).to_lowercase();
    if candidate == "edge" {
        return "edge".to_string();
    }
    if candidate == "cosyvoice" {
        return "cosyvoice".to_string();
    }

    if language == "zh" && cosyvoice_base_url.is_some() {
        "cosyvoice".to_string()
    } else {
        "edge".to_string()
    }
}

fn edge_default_voice(language: &str, configured_voice: &str) -> String {
    if !configured_voice.trim().is_empty() {
        return configured_voice.to_string();
    }
    if language == "zh" {
        "zh-CN-XiaoxiaoNeural".to_string()
    } else {
        "en-US-AriaNeural".to_string()
    }
}

async fn synthesize_edge(
    request: &TtsRequest,
    config: &crate::config::Config,
    language: &str,
    rate: f32,
) -> Result<TtsAudio> {
    let voice = request
        .voice
        .clone()
        .unwrap_or_else(|| edge_default_voice(language, &config.edge_tts_voice));
    let rate_percent = ((rate - 1.0) * 100.0).round() as i32;
    let rate_string = if rate_percent >= 0 {
        format!("+{}%", rate_percent)
    } else {
        format!("{}%", rate_percent)
    };

    let output_path = std::env::temp_dir().join(format!("reader-edge-tts-{}.mp3", Uuid::new_v4()));

    let output = Command::new("python3")
        .arg("-m")
        .arg("edge_tts")
        .arg("--text")
        .arg(&request.text)
        .arg("--voice")
        .arg(&voice)
        .arg("--rate")
        .arg(&rate_string)
        .arg("--write-media")
        .arg(&output_path)
        .output()
        .await
        .map_err(|e| {
            ReaderError::ModelApi(format!(
                "Failed to execute python3 edge-tts: {}",
                e
            ))
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let hint = if stderr.contains("No module named edge_tts") {
            " (Install with: python3 -m pip install edge-tts)"
        } else {
            ""
        };
        return Err(ReaderError::ModelApi(format!(
            "Edge TTS process failed: {}{}",
            if stderr.is_empty() {
                "unknown error".to_string()
            } else {
                stderr
            },
            hint
        )));
    }

    let audio = tokio::fs::read(&output_path)
        .await
        .map_err(|e| ReaderError::ModelApi(format!("Edge TTS audio read failed: {}", e)))?;
    let _ = tokio::fs::remove_file(&output_path).await;

    if audio.is_empty() {
        return Err(ReaderError::ModelApi(
            "Edge TTS returned empty audio payload".to_string(),
        ));
    }

    Ok(TtsAudio {
        audio,
        mime_type: "audio/mpeg".to_string(),
        provider: "edge".to_string(),
    })
}

async fn synthesize_cosyvoice(
    request: &TtsRequest,
    config: &crate::config::Config,
    language: &str,
    rate: f32,
) -> Result<TtsAudio> {
    let base_url = config
        .cosyvoice_base_url
        .as_ref()
        .ok_or_else(|| ReaderError::InvalidArgument("CosyVoice base URL is not configured".to_string()))?;
    let url = format!("{}/tts", base_url.trim_end_matches('/'));
    let voice = request
        .voice
        .clone()
        .unwrap_or_else(|| "cosyvoice-default".to_string());

    let payload = json!({
        "text": request.text,
        "voice": voice,
        "lang": language,
        "speed": rate,
        "format": "mp3"
    });

    let client = reqwest::Client::new();
    let mut req = client.post(url).json(&payload);
    if let Some(api_key) = &config.cosyvoice_api_key {
        if !api_key.trim().is_empty() {
            req = req.bearer_auth(api_key);
        }
    }

    let response = req
        .send()
        .await
        .map_err(|e| ReaderError::ModelApi(format!("CosyVoice request failed: {}", e)))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(ReaderError::ModelApi(format!(
            "CosyVoice returned {}: {}",
            status, body
        )));
    }

    let mime_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("audio/mpeg")
        .to_string();

    let audio = response
        .bytes()
        .await
        .map_err(|e| ReaderError::ModelApi(format!("CosyVoice audio decode failed: {}", e)))?
        .to_vec();

    Ok(TtsAudio {
        audio,
        mime_type,
        provider: "cosyvoice".to_string(),
    })
}
