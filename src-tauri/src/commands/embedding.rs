use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;

use rusqlite::params;
use tauri::{AppHandle, Manager};

use crate::config::load_config;
use crate::database::{self, get_connection};
use crate::error::{ReaderError, Result};
use crate::models::Paragraph;
use crate::search::cosine_similarity;

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct EmbeddingProfile {
    pub provider: String,
    pub model: String,
    pub dimension: usize,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct EmbeddingItem {
    pub paragraph_id: String,
    pub vector: Vec<f32>,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct UpsertEmbeddingsBatchRequest {
    pub profile: EmbeddingProfile,
    pub items: Vec<EmbeddingItem>,
}

#[derive(Clone, serde::Serialize)]
pub struct UpsertEmbeddingsBatchResponse {
    pub upserted: usize,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct SearchByEmbeddingRequest {
    pub query_vector: Vec<f32>,
    pub top_k: usize,
    pub doc_id: Option<String>,
    pub query_text: Option<String>,
}

#[derive(Clone, serde::Serialize)]
pub struct SearchByEmbeddingResult {
    pub paragraph_id: String,
    pub snippet: String,
    pub score: f32,
    pub location: String,
}

#[derive(Clone, serde::Serialize)]
pub struct EmbeddingProfileStatus {
    pub indexed: usize,
    pub total: usize,
    pub stale: usize,
    pub profile: EmbeddingProfile,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct ClearEmbeddingsByProfileRequest {
    pub profile: EmbeddingProfile,
}

#[derive(Clone, serde::Serialize)]
pub struct ClearEmbeddingsByProfileResponse {
    pub deleted: usize,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct DownloadEmbeddingModelRequest {
    pub model: Option<String>,
}

#[derive(Clone, serde::Serialize)]
pub struct DownloadEmbeddingModelResponse {
    pub model: String,
    pub target_dir: String,
    pub files: Vec<String>,
}

#[derive(Clone, serde::Serialize)]
pub struct ValidateLocalEmbeddingModelResponse {
    pub valid: bool,
    pub checked_path: String,
    pub missing_files: Vec<String>,
}

#[tauri::command]
pub async fn get_document_paragraphs(
    app_handle: AppHandle,
    doc_id: String,
) -> Result<Vec<Paragraph>> {
    let conn = get_connection(&app_handle)?;
    let paragraphs = database::list_paragraphs(&conn, &doc_id)?;
    Ok(paragraphs)
}

#[tauri::command]
pub async fn upsert_embeddings_batch(
    app_handle: AppHandle,
    request: UpsertEmbeddingsBatchRequest,
) -> Result<UpsertEmbeddingsBatchResponse> {
    if request.profile.dimension == 0 {
        return Err(ReaderError::InvalidArgument(
            "Embedding profile dimension must be greater than 0".to_string(),
        ));
    }

    let conn = get_connection(&app_handle)?;
    let pairs = request
        .items
        .iter()
        .map(|item| (item.paragraph_id.clone(), item.vector.clone()))
        .collect::<Vec<_>>();
    let upserted = database::upsert_embeddings_batch(
        &conn,
        &request.profile.provider,
        &request.profile.model,
        request.profile.dimension,
        &pairs,
    )?;
    Ok(UpsertEmbeddingsBatchResponse { upserted })
}

#[tauri::command]
pub async fn search_by_embedding(
    app_handle: AppHandle,
    request: SearchByEmbeddingRequest,
) -> Result<Vec<SearchByEmbeddingResult>> {
    if request.query_vector.is_empty() {
        return Ok(Vec::new());
    }
    let top_k = request.top_k.max(1);
    let profile = current_profile_from_config()?;
    if request.query_vector.len() != profile.dimension {
        return Err(ReaderError::InvalidArgument(format!(
            "Query vector dimension mismatch: expected {}, got {}",
            profile.dimension,
            request.query_vector.len()
        )));
    }

    let conn = get_connection(&app_handle)?;
    let embeddings = database::list_by_profile(
        &conn,
        &profile.provider,
        &profile.model,
        profile.dimension,
        request.doc_id.as_deref(),
    )?;
    if embeddings.is_empty() {
        return Ok(Vec::new());
    }

    let mut similarities: Vec<(String, f32)> = embeddings
        .into_iter()
        .filter_map(|embedding| {
            if embedding.vector.len() != request.query_vector.len() {
                return None;
            }
            let score = cosine_similarity(&request.query_vector, &embedding.vector).unwrap_or(0.0);
            Some((embedding.paragraph_id, score))
        })
        .collect();

    similarities.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    let candidate_k = (top_k.saturating_mul(8)).max(top_k);
    similarities.truncate(candidate_k);
    if similarities.is_empty() {
        return Ok(Vec::new());
    }

    let paragraphs_map = load_paragraph_map(&conn, &similarities)?;
    let query_lower = request.query_text.as_ref().map(|q| q.trim().to_lowercase());
    let query_tokens = tokenize_query(query_lower.as_deref().unwrap_or_default());
    let mut ranked = Vec::new();

    for (paragraph_id, score) in similarities {
        if let Some((text, location)) = paragraphs_map.get(paragraph_id.as_str()) {
            let adjusted_score = if let Some(query) = &query_lower {
                score + lexical_boost(query, &query_tokens, text)
            } else {
                score
            };
            let snippet = if text.len() > 200 {
                format!("{}...", &text[..200])
            } else {
                text.clone()
            };
            ranked.push(SearchByEmbeddingResult {
                paragraph_id,
                snippet,
                score: adjusted_score,
                location: location.clone(),
            });
        }
    }

    ranked.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    ranked.truncate(top_k);
    Ok(ranked)
}

#[tauri::command]
pub async fn get_embedding_profile_status(
    app_handle: AppHandle,
    doc_id: Option<String>,
) -> Result<EmbeddingProfileStatus> {
    let profile = current_profile_from_config()?;
    let conn = get_connection(&app_handle)?;

    let total = if let Some(doc_id) = &doc_id {
        conn.query_row(
            "SELECT COUNT(*) FROM paragraphs WHERE doc_id = ?1",
            params![doc_id],
            |row| row.get::<_, i64>(0),
        )? as usize
    } else {
        conn.query_row("SELECT COUNT(*) FROM paragraphs", [], |row| {
            row.get::<_, i64>(0)
        })? as usize
    };

    let indexed = if let Some(doc_id) = &doc_id {
        conn.query_row(
            "SELECT COUNT(*)
             FROM paragraphs p
             JOIN embeddings e ON e.paragraph_id = p.id
             WHERE p.doc_id = ?1
               AND e.provider = ?2
               AND e.model = ?3
               AND e.dim = ?4",
            params![
                doc_id,
                profile.provider,
                profile.model,
                profile.dimension as i32
            ],
            |row| row.get::<_, i64>(0),
        )? as usize
    } else {
        conn.query_row(
            "SELECT COUNT(*)
             FROM paragraphs p
             JOIN embeddings e ON e.paragraph_id = p.id
             WHERE e.provider = ?1
               AND e.model = ?2
               AND e.dim = ?3",
            params![profile.provider, profile.model, profile.dimension as i32],
            |row| row.get::<_, i64>(0),
        )? as usize
    };

    let stale = if let Some(doc_id) = &doc_id {
        conn.query_row(
            "SELECT COUNT(*)
             FROM paragraphs p
             JOIN embeddings e ON e.paragraph_id = p.id
             WHERE p.doc_id = ?1
               AND (e.provider != ?2 OR e.model != ?3 OR e.dim != ?4)",
            params![
                doc_id,
                profile.provider,
                profile.model,
                profile.dimension as i32
            ],
            |row| row.get::<_, i64>(0),
        )? as usize
    } else {
        conn.query_row(
            "SELECT COUNT(*)
             FROM paragraphs p
             JOIN embeddings e ON e.paragraph_id = p.id
             WHERE (e.provider != ?1 OR e.model != ?2 OR e.dim != ?3)",
            params![profile.provider, profile.model, profile.dimension as i32],
            |row| row.get::<_, i64>(0),
        )? as usize
    };

    Ok(EmbeddingProfileStatus {
        indexed,
        total,
        stale,
        profile,
    })
}

#[tauri::command]
pub async fn clear_embeddings_by_profile(
    app_handle: AppHandle,
    request: ClearEmbeddingsByProfileRequest,
) -> Result<ClearEmbeddingsByProfileResponse> {
    let conn = get_connection(&app_handle)?;
    let deleted = database::clear_embeddings_by_profile(
        &conn,
        &request.profile.provider,
        &request.profile.model,
        request.profile.dimension,
    )?;
    Ok(ClearEmbeddingsByProfileResponse { deleted })
}

#[tauri::command]
pub async fn download_embedding_model_files(
    app_handle: AppHandle,
    request: Option<DownloadEmbeddingModelRequest>,
) -> Result<DownloadEmbeddingModelResponse> {
    let model = request
        .and_then(|r| r.model)
        .unwrap_or_else(|| "Xenova/all-MiniLM-L6-v2".to_string());
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| ReaderError::Internal(format!("Failed to resolve app data dir: {}", e)))?;
    let target_dir = app_data_dir.join("models").join(model.replace('/', "_"));
    std::fs::create_dir_all(&target_dir)?;

    let required_files = vec![
        "config.json",
        "tokenizer.json",
        "tokenizer_config.json",
        "onnx/model_quantized.onnx",
    ];
    let optional_files = vec!["special_tokens_map.json", "onnx/model.onnx"];
    let mut downloaded = Vec::new();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(45))
        .user_agent("reader/0.2.0")
        .build()
        .map_err(|e| ReaderError::ModelApi(format!("Failed to create HTTP client: {}", e)))?;
    let config = load_config()?;
    let endpoints = resolve_embedding_download_endpoints(
        config.embedding_download_base_url.as_deref(),
        std::env::var("HF_ENDPOINT").ok().as_deref(),
    );

    for file in &required_files {
        let bytes = download_file_with_retry(&client, &endpoints, &model, file, 3).await?;
        let path = target_dir.join(file);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&path, &bytes)?;
        downloaded.push(path_to_string(&path));
    }

    for file in &optional_files {
        match download_file_with_retry(&client, &endpoints, &model, file, 2).await {
            Ok(bytes) => {
                let path = target_dir.join(file);
                if let Some(parent) = path.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                std::fs::write(&path, &bytes)?;
                downloaded.push(path_to_string(&path));
            }
            Err(err) => {
                tracing::warn!("Optional model file download skipped ({}): {}", file, err);
            }
        }
    }

    Ok(DownloadEmbeddingModelResponse {
        model,
        target_dir: path_to_string(&target_dir),
        files: downloaded,
    })
}

#[tauri::command]
pub async fn validate_local_embedding_model_path(
    path: String,
) -> Result<ValidateLocalEmbeddingModelResponse> {
    let raw = path.trim();
    if raw.is_empty() {
        return Ok(ValidateLocalEmbeddingModelResponse {
            valid: false,
            checked_path: String::new(),
            missing_files: vec!["path is empty".to_string()],
        });
    }

    let normalized = raw
        .trim_start_matches("file://")
        .trim_end_matches('/')
        .to_string();
    let mut model_dir = PathBuf::from(&normalized);
    if normalized.ends_with("config.json") {
        if let Some(parent) = model_dir.parent() {
            model_dir = parent.to_path_buf();
        }
    }

    let required = vec!["config.json", "tokenizer.json", "tokenizer_config.json"];
    let mut missing = Vec::new();
    for file in required {
        let candidate = model_dir.join(file);
        if !candidate.exists() {
            missing.push(file.to_string());
        }
    }

    let has_quant = model_dir.join("onnx/model_quantized.onnx").exists();
    let has_model = model_dir.join("onnx/model.onnx").exists();
    if !has_quant && !has_model {
        missing.push("onnx/model_quantized.onnx (or onnx/model.onnx)".to_string());
    }

    Ok(ValidateLocalEmbeddingModelResponse {
        valid: missing.is_empty(),
        checked_path: model_dir.to_string_lossy().to_string(),
        missing_files: missing,
    })
}

async fn download_file_with_retry(
    client: &reqwest::Client,
    endpoints: &[String],
    model: &str,
    file: &str,
    max_attempts: usize,
) -> Result<Vec<u8>> {
    let mut errors = Vec::new();

    for endpoint in endpoints {
        let base = endpoint.trim_end_matches('/');
        let url = format!("{}/{}/resolve/main/{}", base, model, file);
        let mut last_err = String::new();

        for attempt in 1..=max_attempts {
            match client
                .get(&url)
                .header(
                    reqwest::header::ACCEPT,
                    "application/octet-stream,application/json;q=0.9,*/*;q=0.8",
                )
                .send()
                .await
            {
                Ok(response) => {
                    if !response.status().is_success() {
                        last_err = format!("HTTP {}", response.status());
                    } else {
                        if let Some(content_type) =
                            response.headers().get(reqwest::header::CONTENT_TYPE)
                        {
                            if let Ok(ct) = content_type.to_str() {
                                if ct.to_ascii_lowercase().contains("text/html") {
                                    last_err = format!(
                                        "received HTML instead of model file (possible proxy interception): {}",
                                        ct
                                    );
                                    if attempt < max_attempts {
                                        tokio::time::sleep(Duration::from_millis(
                                            (attempt as u64) * 800,
                                        ))
                                        .await;
                                    }
                                    continue;
                                }
                            }
                        }

                        let bytes = response.bytes().await.map_err(|e| {
                            ReaderError::ModelApi(format!("Failed to read {}: {}", url, e))
                        })?;
                        if bytes.is_empty() {
                            last_err = "empty response".to_string();
                        } else if looks_like_html(&bytes) {
                            last_err = "received HTML body instead of model file (possible proxy interception)".to_string();
                        } else {
                            return Ok(bytes.to_vec());
                        }
                    }
                }
                Err(e) => {
                    last_err = e.to_string();
                }
            }

            if attempt < max_attempts {
                tokio::time::sleep(Duration::from_millis((attempt as u64) * 800)).await;
            }
        }

        errors.push(format!("{} -> {}", endpoint, last_err));
    }

    Err(ReaderError::ModelApi(format!(
        "Failed to download {} after trying endpoints [{}]. Details: {}",
        file,
        endpoints.join(", "),
        errors.join(" | "),
    )))
}

fn looks_like_html(bytes: &[u8]) -> bool {
    let sample_len = bytes.len().min(256);
    let sample = &bytes[..sample_len];
    let text = String::from_utf8_lossy(sample).to_ascii_lowercase();
    let trimmed = text.trim_start();
    trimmed.starts_with("<!doctype html")
        || trimmed.starts_with("<html")
        || trimmed.starts_with("<head")
        || trimmed.starts_with("<body")
}

fn resolve_embedding_download_endpoints(
    configured_base: Option<&str>,
    env_hf_endpoint: Option<&str>,
) -> Vec<String> {
    let mut endpoints = Vec::new();

    if let Some(base) = configured_base {
        let trimmed = base.trim();
        if !trimmed.is_empty() {
            endpoints.push(trimmed.to_string());
        }
    }
    if let Some(base) = env_hf_endpoint {
        let trimmed = base.trim();
        if !trimmed.is_empty() {
            endpoints.push(trimmed.to_string());
        }
    }

    endpoints.push("https://huggingface.co".to_string());
    endpoints.push("https://hf-mirror.com".to_string());

    let mut unique = Vec::new();
    for endpoint in endpoints {
        if unique
            .iter()
            .any(|item: &String| item.eq_ignore_ascii_case(&endpoint))
        {
            continue;
        }
        unique.push(endpoint);
    }

    unique
}

fn current_profile_from_config() -> Result<EmbeddingProfile> {
    let config = load_config()?;
    Ok(EmbeddingProfile {
        provider: config.embedding_provider,
        model: config.embedding_model,
        dimension: config.embedding_dimension as usize,
    })
}

fn load_paragraph_map(
    conn: &rusqlite::Connection,
    scores: &[(String, f32)],
) -> Result<HashMap<String, (String, String)>> {
    let paragraph_ids = scores.iter().map(|(id, _)| id.clone()).collect::<Vec<_>>();
    let placeholders = paragraph_ids
        .iter()
        .map(|_| "?")
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "SELECT id, text, location FROM paragraphs WHERE id IN ({})",
        placeholders
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut map = HashMap::new();
    let rows = stmt.query_map(
        paragraph_ids
            .iter()
            .map(|id| id as &dyn rusqlite::ToSql)
            .collect::<Vec<_>>()
            .as_slice(),
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                (row.get::<_, String>(1)?, row.get::<_, String>(2)?),
            ))
        },
    )?;
    for row in rows {
        let (id, payload) = row?;
        map.insert(id, payload);
    }
    Ok(map)
}

fn path_to_string(path: &PathBuf) -> String {
    path.to_string_lossy().to_string()
}

fn lexical_boost(query: &str, query_tokens: &[String], text: &str) -> f32 {
    let lowered_text = text.to_lowercase();
    let mut boost = 0.0_f32;

    if !query.is_empty() && lowered_text.contains(query) {
        boost += 0.25;
        let occurrences = lowered_text.matches(query).count() as f32;
        boost += (occurrences * 0.03).min(0.15);
    }

    if !query_tokens.is_empty() {
        let matched = query_tokens
            .iter()
            .filter(|token| lowered_text.contains(token.as_str()))
            .count() as f32;
        boost += (matched / query_tokens.len() as f32) * 0.2;
    }

    boost
}

fn tokenize_query(query: &str) -> Vec<String> {
    query
        .split(|c: char| !c.is_alphanumeric() && !is_cjk(c))
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn is_cjk(c: char) -> bool {
    ('\u{4e00}'..='\u{9fff}').contains(&c)
}
