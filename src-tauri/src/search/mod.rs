use crate::database::{embeddings, paragraphs, get_connection};
use crate::error::{ReaderError, Result};
use crate::llm::LmStudioClient;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Calculates the cosine similarity between two vectors
///
/// Formula: dot_product(a, b) / (norm(a) * norm(b))
/// Returns a value between -1 and 1, where 1 means identical direction,
/// 0 means orthogonal, and -1 means opposite direction.
pub fn cosine_similarity(a: &[f32], b: &[f32]) -> Result<f32> {
    if a.len() != b.len() {
        return Err(ReaderError::Internal(format!(
            "Vector dimension mismatch: {} vs {}",
            a.len(),
            b.len()
        )));
    }

    if a.is_empty() {
        return Err(ReaderError::Internal("Cannot compute similarity of empty vectors".to_string()));
    }

    let dot_product: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();

    if norm_a == 0.0 || norm_b == 0.0 {
        return Ok(0.0);
    }

    Ok(dot_product / (norm_a * norm_b))
}

/// Result from a semantic search query
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub paragraph_id: String,
    pub snippet: String,
    pub score: f32,
    pub location: String,
}

/// Options for semantic search
#[derive(Debug, Clone, Deserialize)]
pub struct SearchOptions {
    /// The query text to search for (required)
    pub query: String,

    /// Maximum number of results to return (default: 10)
    #[serde(default = "default_top_k")]
    pub top_k: usize,

    /// Optional document ID to restrict search to a specific document
    #[serde(default)]
    pub doc_id: Option<String>,
}

fn default_top_k() -> usize {
    10
}

/// Performs semantic search using embeddings
///
/// 1. Generates an embedding for the query text
/// 2. Compares the query embedding with all stored embeddings using cosine similarity
/// 3. Returns the top_k most similar paragraphs with their scores
pub async fn semantic_search(
    conn: &Connection,
    llm_client: &LmStudioClient,
    options: SearchOptions,
) -> Result<Vec<SearchResult>> {
    // Generate embedding for the query
    let query_embedding = llm_client.generate_embedding(&options.query).await?;

    // Get all embeddings (optionally filtered by document)
    let embeddings = if let Some(doc_id) = &options.doc_id {
        embeddings::list_by_document(conn, doc_id)?
            .into_iter()
            .filter_map(|emb| {
                if emb.vector.len() == query_embedding.len() {
                    Some((emb.paragraph_id, emb.vector))
                } else {
                    tracing::warn!(
                        "Embedding dimension mismatch for paragraph {}: expected {}, got {}",
                        emb.paragraph_id,
                        query_embedding.len(),
                        emb.vector.len()
                    );
                    None
                }
            })
            .collect()
    } else {
        embeddings::list_all_vectors(conn)?
            .into_iter()
            .filter_map(|emb| {
                if emb.vector.len() == query_embedding.len() {
                    Some((emb.paragraph_id, emb.vector))
                } else {
                    tracing::warn!(
                        "Embedding dimension mismatch for paragraph {}: expected {}, got {}",
                        emb.paragraph_id,
                        query_embedding.len(),
                        emb.vector.len()
                    );
                    None
                }
            })
            .collect()
    };

    if embeddings.is_empty() {
        return Ok(Vec::new());
    }

    // Calculate cosine similarity for each embedding
    let mut similarities: Vec<(String, f32)> = embeddings
        .into_iter()
        .map(|(paragraph_id, vector)| {
            let score = cosine_similarity(&query_embedding, &vector).unwrap_or(0.0);
            (paragraph_id, score)
        })
        .collect();

    // Sort by score (descending)
    similarities.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    // Get paragraph IDs for the top results
    let top_paragraph_ids: Vec<String> = similarities
        .iter()
        .take(options.top_k)
        .map(|(id, _)| id.clone())
        .collect();

    // Build a query to get all paragraphs in one go
    if top_paragraph_ids.is_empty() {
        return Ok(Vec::new());
    }

    let mut placeholders = top_paragraph_ids
        .iter()
        .map(|_| "?")
        .collect::<Vec<_>>()
        .join(",");

    let query = format!(
        "SELECT id, text, location FROM paragraphs WHERE id IN ({})",
        placeholders
    );

    let mut stmt = conn.prepare(&query)?;

    let paragraph_map: HashMap<String, (String, String)> = top_paragraph_ids
        .iter()
        .enumerate()
        .map(|(i, id)| (id.clone(), i))
        .collect();

    let mut paragraphs_result = HashMap::new();
    let rows = stmt.query_map(
        top_paragraph_ids.iter().map(|s| s as &dyn rusqlite::ToSql).collect::<Vec<_>>().as_slice(),
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                (row.get::<_, String>(1)?, row.get::<_, String>(2)?),
            ))
        },
    )?;

    for row in rows {
        let (id, (text, location)) = row?;
        paragraphs_result.insert(id, (text, location));
    }

    // Build the final results with scores and snippets
    let mut results = Vec::new();
    for (paragraph_id, score) in similarities.iter().take(options.top_k) {
        if let Some((text, location)) = paragraphs_result.get(paragraph_id) {
            // Create a snippet (first 200 characters)
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

    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cosine_similarity_identical() {
        let a = vec![1.0, 2.0, 3.0];
        let b = vec![1.0, 2.0, 3.0];
        let result = cosine_similarity(&a, &b).unwrap();
        assert!((result - 1.0).abs() < 1e-6);
    }

    #[test]
    fn test_cosine_similarity_orthogonal() {
        let a = vec![1.0, 0.0];
        let b = vec![0.0, 1.0];
        let result = cosine_similarity(&a, &b).unwrap();
        assert!((result - 0.0).abs() < 1e-6);
    }

    #[test]
    fn test_cosine_similarity_opposite() {
        let a = vec![1.0, 2.0, 3.0];
        let b = vec![-1.0, -2.0, -3.0];
        let result = cosine_similarity(&a, &b).unwrap();
        assert!((result - (-1.0)).abs() < 1e-6);
    }

    #[test]
    fn test_cosine_similarity_dimension_mismatch() {
        let a = vec![1.0, 2.0];
        let b = vec![1.0, 2.0, 3.0];
        assert!(cosine_similarity(&a, &b).is_err());
    }

    #[test]
    fn test_cosine_similarity_empty() {
        let a: Vec<f32> = vec![];
        let b: Vec<f32> = vec![];
        assert!(cosine_similarity(&a, &b).is_err());
    }
}
