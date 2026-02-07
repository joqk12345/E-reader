mod cache;
mod documents;
pub mod embeddings;
pub mod paragraphs;
mod schema;
mod sections;

use rusqlite::{Connection, Result};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tracing::{error, info};

pub use schema::create_tables;

// Document operations
pub use documents::DocumentError;
pub use documents::{
    delete as delete_document, get as get_document, insert as insert_document,
    list as list_documents,
};

// Section operations
pub use sections::SectionError;
pub use sections::{
    get as get_section, insert as insert_section, list_by_document as list_sections,
};

// Paragraph operations
pub use paragraphs::ParagraphError;
pub use paragraphs::{
    get as get_paragraph, insert as insert_paragraph, list_by_document as list_paragraphs,
    list_by_section as list_paragraphs_by_section,
};

// Embedding operations
pub use embeddings::{bytes_to_vec_f32, vec_f32_to_bytes};
pub use embeddings::{
    clear_by_profile as clear_embeddings_by_profile, get as get_embedding,
    insert as insert_embedding, list_all_vectors, list_by_document, list_by_profile,
    upsert_batch as upsert_embeddings_batch,
};
pub use embeddings::{Embedding, EmbeddingError};

// Cache operations
pub use cache::{
    get_summary, get_text_translation, get_translation, save_summary, save_text_translation,
    save_translation,
};
pub use cache::{CacheError, Summary, Translation};

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
    std::fs::create_dir_all(&app_data_dir).expect("Failed to create app data directory");

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
