use crate::config::load_config;
use crate::database::{get_connection, embeddings};
use crate::error::Result;
use crate::llm::LmStudioClient;
use crate::search::{SearchOptions, SearchResult, cosine_similarity};
use crate::database::paragraphs;
use tauri::AppHandle;
use rusqlite::Connection;
use std::collections::HashMap;

/// Output type for search results
#[derive(Clone, serde::Serialize)]
pub struct SearchResultOutput {
    pub paragraph_id: String,
    pub snippet: String,
    pub score: f32,
    pub location: String,
}

impl From<SearchResult> for SearchResultOutput {
    fn from(result: SearchResult) -> Self {
        SearchResultOutput {
            paragraph_id: result.paragraph_id,
            snippet: result.snippet,
            score: result.score,
            location: result.location,
        }
    }
}

/// Performs semantic search on document embeddings
///
/// This command:
/// 1. Loads the LLM configuration
/// 2. Generates an embedding for the query text
/// 3. Compares the query embedding with all stored embeddings
/// 4. Returns the top_k most similar paragraphs
#[tauri::command]
pub async fn search(
    app_handle: AppHandle,
    options: SearchOptions,
) -> Result<Vec<SearchResultOutput>> {
    // Load configuration
    let config = load_config()?;

    // Create LLM client
    let llm_client = LmStudioClient::new(
        config.lm_studio_url,
        config.embedding_model,
        config.chat_model,
    )?;

    // Get database connection and collect all embeddings (synchronous part)
    let all_embeddings: Vec<(String, Vec<f32>)>;
    {
        let conn = get_connection(&app_handle)?;

        // Get embeddings based on scope
        all_embeddings = if let Some(doc_id) = &options.doc_id {
            embeddings::list_by_document(&conn, doc_id)?
                .into_iter()
                .filter_map(|emb| {
                    if emb.vector.len() > 0 {
                        Some((emb.paragraph_id, emb.vector))
                    } else {
                        tracing::warn!("Empty embedding for paragraph {}", emb.paragraph_id);
                        None
                    }
                })
                .collect()
        } else {
            embeddings::list_all_vectors(&conn)?
                .into_iter()
                .filter_map(|emb| {
                    if emb.vector.len() > 0 {
                        Some((emb.paragraph_id, emb.vector))
                    } else {
                        tracing::warn!("Empty embedding for paragraph {}", emb.paragraph_id);
                        None
                    }
                })
                .collect()
        };

        // Return early if no embeddings
        if all_embeddings.is_empty() {
            return Ok(Vec::new());
        }

    }

    // Generate query embedding (async part - no connection held here)
    let query_embedding = llm_client.generate_embedding(&options.query).await?;

    // Calculate similarities (synchronous part)
    let mut similarities: Vec<(String, f32)> = all_embeddings
        .into_iter()
        .filter_map(|(paragraph_id, vector)| {
            if vector.len() == query_embedding.len() {
                let score = cosine_similarity(&query_embedding, &vector).unwrap_or(0.0);
                Some((paragraph_id, score))
            } else {
                tracing::warn!(
                    "Embedding dimension mismatch for paragraph {}: expected {}, got {}",
                    paragraph_id,
                    query_embedding.len(),
                    vector.len()
                );
                None
            }
        })
        .collect();

    // Sort by score (descending)
    similarities.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    // Get paragraph data from database (synchronous part)
    let paragraphs_result: HashMap<String, (String, String)>;
    {
        let conn = get_connection(&app_handle)?;

        if similarities.is_empty() {
            return Ok(Vec::new());
        }

        let target_paragraph_ids = similarities
            .iter()
            .take(options.top_k)
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>();

        if target_paragraph_ids.is_empty() {
            return Ok(Vec::new());
        }

        let placeholders = target_paragraph_ids
            .iter()
            .map(|_| "?")
            .collect::<Vec<_>>()
            .join(",");

        let query = format!(
            "SELECT id, text, location FROM paragraphs WHERE id IN ({})",
            placeholders
        );

        let mut stmt = conn.prepare(&query)?;
        let mut result = HashMap::new();

        let rows = stmt.query_map(
            target_paragraph_ids
                .iter()
                .map(|s| s as &dyn rusqlite::ToSql)
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
            let (id, (text, location)) = row?;
            result.insert(id, (text, location));
        }

        paragraphs_result = result;
    }

    // Build final results
    let mut results = Vec::new();
    for (paragraph_id, score) in similarities.iter().take(options.top_k) {
        if let Some((text, location)) = paragraphs_result.get(paragraph_id.as_str()) {
            let snippet = if text.len() > 200 {
                format!("{}...", &text[..200])
            } else {
                text.clone()
            };

            results.push(SearchResult {
                paragraph_id: paragraph_id.clone(),
                snippet,
                score: *score,
                location: location.clone(),
            });
        }
    }

    // Convert to output format
    let output = results.into_iter().map(SearchResultOutput::from).collect();

    Ok(output)
}
