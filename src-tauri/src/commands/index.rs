use crate::config::load_config;
use crate::database::get_connection;
use crate::database::{get_embedding, insert_embedding, list_paragraphs};
use crate::error::Result;
use crate::llm::create_client;
use tauri::AppHandle;
use tracing::{error, info, warn};

/// Indexes a document by generating embeddings for all its paragraphs
///
/// This command:
/// 1. Lists all paragraphs for the document
/// 2. Skips paragraphs that already have embeddings
/// 3. Generates embeddings for paragraphs that don't have them
/// 4. Returns the count of newly indexed paragraphs
///
/// # Arguments
/// * `doc_id` - The ID of the document to index
///
/// # Returns
/// The number of paragraphs that were newly indexed
#[tauri::command]
pub async fn index_document(app_handle: AppHandle, doc_id: String) -> Result<usize> {
    info!("Starting document indexing for doc_id: {}", doc_id);

    // Load configuration and create LLM client
    let config = load_config()?;
    let llm_client = create_client(&config)?;
    let embedding_provider = config.embedding_provider.clone();
    let embedding_model = config.embedding_model.clone();

    // Get database connection
    let conn = get_connection(&app_handle)?;

    // List all paragraphs for the document
    let paragraphs = list_paragraphs(&conn, &doc_id).map_err(|e| {
        error!("Failed to list paragraphs for document {}: {}", doc_id, e);
        e
    })?;

    info!(
        "Found {} paragraphs for document {}",
        paragraphs.len(),
        doc_id
    );

    let mut indexed_count = 0;

    // Process each paragraph
    for paragraph in paragraphs {
        // Check if embedding already exists
        match get_embedding(&conn, &paragraph.id) {
            Ok(Some(_)) => {
                // Embedding already exists, skip
                info!("Skipping paragraph {} (already indexed)", paragraph.id);
                continue;
            }
            Ok(None) => {
                // No embedding exists, generate one
                info!("Generating embedding for paragraph {}", paragraph.id);

                match llm_client.generate_embedding(&paragraph.text).await {
                    Ok(embedding_vector) => {
                        // Store the embedding
                        match insert_embedding(
                            &conn,
                            &paragraph.id,
                            embedding_vector,
                            &embedding_provider,
                            &embedding_model,
                        ) {
                            Ok(_) => {
                                indexed_count += 1;
                                info!("Successfully indexed paragraph {}", paragraph.id);
                            }
                            Err(e) => {
                                error!(
                                    "Failed to insert embedding for paragraph {}: {}",
                                    paragraph.id, e
                                );
                                return Err(e.into());
                            }
                        }
                    }
                    Err(e) => {
                        error!(
                            "Failed to generate embedding for paragraph {}: {}",
                            paragraph.id, e
                        );
                        return Err(e);
                    }
                }
            }
            Err(e) => {
                error!(
                    "Failed to check embedding existence for paragraph {}: {}",
                    paragraph.id, e
                );
                return Err(e.into());
            }
        }
    }

    info!(
        "Document indexing complete: {} paragraphs newly indexed",
        indexed_count
    );
    Ok(indexed_count)
}
