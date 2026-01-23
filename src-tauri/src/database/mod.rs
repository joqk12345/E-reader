mod schema;
mod documents;
mod sections;
mod paragraphs;

use rusqlite::{Connection, Result};
use std::path::PathBuf;
use tauri::AppHandle;
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
    conn.execute("PRAGMA journal_mode = WAL", [])?;

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
