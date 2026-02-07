mod schema;
mod documents;
mod sections;
pub mod paragraphs;
pub mod embeddings;
mod cache;

use rusqlite::{Connection, Result};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tracing::{info, error};

pub use schema::create_tables;

// Document operations
pub use documents::{insert as insert_document, list as list_documents, get as get_document, delete as delete_document};
pub use documents::DocumentError;

// Section operations
pub use sections::{insert as insert_section, list_by_document as list_sections, get as get_section};
pub use sections::SectionError;

// Paragraph operations
pub use paragraphs::{insert as insert_paragraph, list_by_section as list_paragraphs_by_section, list_by_document as list_paragraphs, get as get_paragraph};
pub use paragraphs::ParagraphError;

// Embedding operations
pub use embeddings::{
    insert as insert_embedding,
    upsert_batch as upsert_embeddings_batch,
    clear_by_profile as clear_embeddings_by_profile,
    get as get_embedding,
    list_all_vectors,
    list_by_document,
    list_by_profile,
};
pub use embeddings::{vec_f32_to_bytes, bytes_to_vec_f32};
pub use embeddings::{EmbeddingError, Embedding};

// Cache operations
pub use cache::{save_translation, get_translation, save_text_translation, get_text_translation, save_summary, get_summary};
pub use cache::{Translation, Summary, CacheError};

// Convert EmbeddingError to ReaderError
impl From<EmbeddingError> for crate::ReaderError {
    fn from(err: EmbeddingError) -> Self {
        crate::ReaderError::Embedding(err.to_string())
    }
}

// Convert ParagraphError to ReaderError
impl From<ParagraphError> for crate::ReaderError {
    fn from(err: ParagraphError) -> Self {
        crate::ReaderError::Internal(err.to_string())
    }
}

// Convert CacheError to ReaderError
impl From<CacheError> for crate::ReaderError {
    fn from(err: CacheError) -> Self {
        crate::ReaderError::Internal(err.to_string())
    }
}

// Convert DocumentError to ReaderError
impl From<DocumentError> for crate::ReaderError {
    fn from(err: DocumentError) -> Self {
        crate::ReaderError::Internal(err.to_string())
    }
}

// Convert SectionError to ReaderError
impl From<SectionError> for crate::ReaderError {
    fn from(err: SectionError) -> Self {
        crate::ReaderError::Internal(err.to_string())
    }
}

/// Gets the path to the SQLite database file
///
/// Returns the path to reader.db in the application's data directory
pub fn get_db_path(handle: &AppHandle) -> PathBuf {
    let app_data_dir = handle
        .path()
        .app_data_dir()
        .expect("Failed to get app data directory");

    // Ensure the directory exists
    std::fs::create_dir_all(&app_data_dir)
        .expect("Failed to create app data directory");

    app_data_dir.join("reader.db")
}

/// Opens a connection to the SQLite database
///
/// Enables WAL mode for better concurrency and performance
pub fn get_connection(handle: &AppHandle) -> Result<Connection> {
    let db_path = get_db_path(handle);
    info!("Opening database connection: {:?}", db_path);

    let mut conn = Connection::open(db_path)?;

    // Enable WAL mode for better concurrency
    // Note: journal_mode returns a value, so we use query_row
    let _journal_mode = conn.query_row("PRAGMA journal_mode = WAL", [], |row| {
        row.get::<_, String>(0)
    })?;

    // Set busy timeout to 5 seconds
    conn.busy_timeout(std::time::Duration::from_secs(5))?;

    info!("Database connection opened successfully");
    Ok(conn)
}

/// Initializes the database schema
///
/// Creates all tables and indexes if they don't exist
pub fn init_db(handle: &AppHandle) -> Result<()> {
    info!("Initializing database");

    let conn = get_connection(handle)?;

    create_tables(&conn).map_err(|e| {
        error!("Failed to create database tables: {}", e);
        e
    })?;

    info!("Database initialized successfully");
    Ok(())
}
