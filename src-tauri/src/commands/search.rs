use crate::config::load_config;
use crate::database::get_connection;
use crate::error::Result;
use crate::llm::LmStudioClient;
use crate::search::{SearchOptions, SearchResult};
use tauri::AppHandle;

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

    // Get database connection
    let conn = get_connection(&app_handle)?;

    // Perform semantic search
    let results = crate::search::semantic_search(&conn, &llm_client, options).await?;

    // Convert to output format
    let output = results.into_iter().map(SearchResultOutput::from).collect();

    Ok(output)
}
