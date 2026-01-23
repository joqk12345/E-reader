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
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            author TEXT,
            language TEXT DEFAULT 'en',
            file_path TEXT NOT NULL UNIQUE,
            file_type TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )",
        [],
    )?;

    // Create sections table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS sections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            doc_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            order_index INTEGER NOT NULL DEFAULT 0,
            href TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE
        )",
        [],
    )?;

    // Create paragraphs table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS paragraphs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            doc_id INTEGER NOT NULL,
            section_id INTEGER,
            order_index INTEGER NOT NULL DEFAULT 0,
            text TEXT NOT NULL,
            location TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE,
            FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE SET NULL
        )",
        [],
    )?;

    // Create embeddings table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS embeddings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            paragraph_id INTEGER NOT NULL,
            vector BLOB NOT NULL,
            dim INTEGER NOT NULL,
            model TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (paragraph_id) REFERENCES paragraphs(id) ON DELETE CASCADE
        )",
        [],
    )?;

    // Create cache_summaries table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS cache_summaries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            target_id INTEGER NOT NULL,
            target_type TEXT NOT NULL,
            style TEXT NOT NULL,
            summary TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(target_id, target_type, style)
        )",
        [],
    )?;

    // Create cache_translations table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS cache_translations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            paragraph_id INTEGER NOT NULL,
            target_lang TEXT NOT NULL,
            translation TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (paragraph_id) REFERENCES paragraphs(id) ON DELETE CASCADE,
            UNIQUE(paragraph_id, target_lang)
        )",
        [],
    )?;

    // Create indexes for performance
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

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_embeddings_paragraph_id ON embeddings(paragraph_id)",
        [],
    )?;

    info!("Database schema created successfully");
    Ok(())
}
