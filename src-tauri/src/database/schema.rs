use rusqlite::{Connection, Result};
use tracing::info;

/// Creates all tables and indexes for the reader database
///
/// This function sets up the complete database schema including:
/// - 6 tables: documents, sections, paragraphs, embeddings, cache_summaries, cache_translations
/// - 3 indexes for performance optimization
/// - Foreign key constraints with CASCADE deletes
pub fn create_tables(conn: &Connection) -> Result<()> {
    info!("Creating database schema");

    // Enable foreign keys
    conn.execute("PRAGMA foreign_keys = ON", [])?;

    // Create documents table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS documents (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            author TEXT,
            language TEXT,
            file_path TEXT NOT NULL UNIQUE,
            file_type TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )",
        [],
    )?;

    // Create sections table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS sections (
            id TEXT PRIMARY KEY,
            doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
            title TEXT NOT NULL,
            order_index INTEGER NOT NULL,
            href TEXT NOT NULL,
            UNIQUE(doc_id, order_index)
        )",
        [],
    )?;

    // Create paragraphs table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS paragraphs (
            id TEXT PRIMARY KEY,
            doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
            section_id TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
            order_index INTEGER NOT NULL,
            text TEXT NOT NULL,
            location TEXT NOT NULL,
            UNIQUE(doc_id, section_id, order_index)
        )",
        [],
    )?;

    // Create embeddings table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS embeddings (
            id TEXT PRIMARY KEY,
            paragraph_id TEXT NOT NULL REFERENCES paragraphs(id) ON DELETE CASCADE,
            vector BLOB NOT NULL,
            dim INTEGER NOT NULL,
            created_at INTEGER NOT NULL
        )",
        [],
    )?;

    // Create cache_summaries table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS cache_summaries (
            id TEXT PRIMARY KEY,
            target_id TEXT NOT NULL,
            target_type TEXT NOT NULL,
            style TEXT NOT NULL,
            summary TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            UNIQUE(target_id, target_type, style)
        )",
        [],
    )?;

    // Create cache_translations table (by paragraph_id)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS cache_translations (
            id TEXT PRIMARY KEY,
            paragraph_id TEXT NOT NULL REFERENCES paragraphs(id) ON DELETE CASCADE,
            target_lang TEXT NOT NULL,
            translation TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            UNIQUE(paragraph_id, target_lang)
        )",
        [],
    )?;

    // Create cache_text_translations table (by text hash)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS cache_text_translations (
            id TEXT PRIMARY KEY,
            text_hash TEXT NOT NULL,
            target_lang TEXT NOT NULL,
            translation TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            UNIQUE(text_hash, target_lang)
        )",
        [],
    )?;

    // Create indexes for performance (only 3 indexes as per spec)
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_sections_doc_id ON sections(doc_id)",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_paragraphs_doc_id ON paragraphs(doc_id)",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_paragraphs_section_id ON paragraphs(section_id)",
        [],
    )?;

    info!("Database schema created successfully");
    Ok(())
}
