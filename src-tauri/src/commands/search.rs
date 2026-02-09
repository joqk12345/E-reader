use crate::config::load_config;
use crate::database::{embeddings, get_connection};
use crate::error::{ReaderError, Result};
use crate::llm::create_client;
use crate::search::{cosine_similarity, SearchOptions, SearchResult};
use rusqlite::params;
use std::collections::HashMap;
use tauri::AppHandle;
use tokio::task::spawn_blocking;
use tokio::time::{timeout, Duration};

const SEARCH_EMBEDDING_TIMEOUT_SECS: u64 = 20;
const SEARCH_KEYWORD_TIMEOUT_SECS: u64 = 20;

/// Output type for search results
#[derive(Clone, serde::Serialize)]
pub struct SearchResultOutput {
    pub paragraph_id: String,
    pub snippet: String,
    pub score: f32,
    pub location: String,
}

#[derive(Clone, serde::Serialize)]
pub struct ParagraphContextOutput {
    pub paragraph_id: String,
    pub doc_id: String,
    pub section_id: String,
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
    let query = options.query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let top_k = options.top_k.max(1);
    let query_owned = query.to_string();
    let doc_id = options.doc_id.clone();

    if options.force_keyword {
        let fallback = keyword_search_with_timeout(
            app_handle.clone(),
            query_owned.clone(),
            doc_id.clone(),
            top_k,
        )
        .await?;
        return Ok(fallback.into_iter().map(SearchResultOutput::from).collect());
    }

    // Load configuration and create LLM client
    let config = load_config()?;
    if config.embedding_provider == "local_transformers" {
        let fallback = keyword_search_with_timeout(
            app_handle.clone(),
            query_owned.clone(),
            doc_id.clone(),
            top_k,
        )
        .await?;
        return Ok(fallback.into_iter().map(SearchResultOutput::from).collect());
    }
    let llm_client = match create_client(&config) {
        Ok(client) => client,
        Err(err) => {
            tracing::warn!(
                "Semantic search unavailable, falling back to keyword search: {}",
                err
            );
            let fallback = keyword_search_with_timeout(
                app_handle.clone(),
                query_owned.clone(),
                doc_id.clone(),
                top_k,
            )
            .await?;
            return Ok(fallback.into_iter().map(SearchResultOutput::from).collect());
        }
    };

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
            let fallback = keyword_search_with_timeout(
                app_handle.clone(),
                query_owned.clone(),
                doc_id.clone(),
                top_k,
            )
            .await?;
            return Ok(fallback.into_iter().map(SearchResultOutput::from).collect());
        }
    }

    // Generate query embedding (async part - no connection held here)
    let query_embedding = match timeout(
        Duration::from_secs(SEARCH_EMBEDDING_TIMEOUT_SECS),
        llm_client.generate_embedding(query),
    )
    .await
    {
        Ok(Ok(embedding)) => embedding,
        Ok(Err(err)) => {
            tracing::warn!(
                "Embedding generation failed, falling back to keyword search: {}",
                err
            );
            let fallback = keyword_search_with_timeout(
                app_handle.clone(),
                query_owned.clone(),
                doc_id.clone(),
                top_k,
            )
            .await?;
            return Ok(fallback.into_iter().map(SearchResultOutput::from).collect());
        }
        Err(_) => {
            tracing::warn!(
                "Embedding generation timed out after {}s, falling back to keyword search",
                SEARCH_EMBEDDING_TIMEOUT_SECS
            );
            let fallback = keyword_search_with_timeout(
                app_handle.clone(),
                query_owned.clone(),
                doc_id.clone(),
                top_k,
            )
            .await?;
            return Ok(fallback.into_iter().map(SearchResultOutput::from).collect());
        }
    };

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
            .take(top_k)
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
    for (paragraph_id, score) in similarities.iter().take(top_k) {
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

#[tauri::command]
pub fn get_paragraph_context(
    app_handle: AppHandle,
    paragraph_id: String,
) -> Result<Option<ParagraphContextOutput>> {
    let conn = get_connection(&app_handle)?;
    let mut stmt = conn.prepare(
        "SELECT id, doc_id, section_id
         FROM paragraphs
         WHERE id = ?1
         LIMIT 1",
    )?;

    let mut rows = stmt.query(params![paragraph_id])?;
    if let Some(row) = rows.next()? {
        return Ok(Some(ParagraphContextOutput {
            paragraph_id: row.get(0)?,
            doc_id: row.get(1)?,
            section_id: row.get(2)?,
        }));
    }

    Ok(None)
}

fn keyword_search(
    app_handle: &AppHandle,
    query: &str,
    doc_id: Option<&str>,
    top_k: usize,
) -> Result<Vec<SearchResult>> {
    let conn = get_connection(app_handle)?;
    let lowered = query.to_lowercase();
    let like_query = format!("%{}%", lowered);

    let mut results = Vec::new();

    if let Some(doc_id) = doc_id {
        let mut stmt = conn.prepare(
            "SELECT id, text, location
             FROM paragraphs
             WHERE doc_id = ?1 AND lower(text) LIKE ?2
             LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![doc_id, like_query, top_k as i64], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?;
        for row in rows {
            let (paragraph_id, text, location) = row?;
            let snippet = if text.len() > 200 {
                format!("{}...", &text[..200])
            } else {
                text.clone()
            };
            let occurrences = text.to_lowercase().matches(&lowered).count().max(1) as f32;
            results.push(SearchResult {
                paragraph_id,
                snippet,
                score: occurrences.min(10.0) / 10.0,
                location,
            });
        }
    } else {
        let mut stmt = conn.prepare(
            "SELECT id, text, location
             FROM paragraphs
             WHERE lower(text) LIKE ?1
             LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![like_query, top_k as i64], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?;
        for row in rows {
            let (paragraph_id, text, location) = row?;
            let snippet = if text.len() > 200 {
                format!("{}...", &text[..200])
            } else {
                text.clone()
            };
            let occurrences = text.to_lowercase().matches(&lowered).count().max(1) as f32;
            results.push(SearchResult {
                paragraph_id,
                snippet,
                score: occurrences.min(10.0) / 10.0,
                location,
            });
        }
    }

    Ok(results)
}

async fn keyword_search_with_timeout(
    app_handle: AppHandle,
    query: String,
    doc_id: Option<String>,
    top_k: usize,
) -> Result<Vec<SearchResult>> {
    match timeout(
        Duration::from_secs(SEARCH_KEYWORD_TIMEOUT_SECS),
        spawn_blocking(move || keyword_search(&app_handle, &query, doc_id.as_deref(), top_k)),
    )
    .await
    {
        Ok(Ok(search_result)) => search_result,
        Ok(Err(join_err)) => Err(ReaderError::Internal(format!(
            "Keyword search task failed: {}",
            join_err
        ))),
        Err(_) => Err(ReaderError::Internal(format!(
            "Keyword search timed out after {} seconds",
            SEARCH_KEYWORD_TIMEOUT_SECS
        ))),
    }
}
