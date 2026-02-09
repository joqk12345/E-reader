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
            provider TEXT NOT NULL DEFAULT 'unknown',
            model TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )",
        [],
    )?;

    // Backward-compatible migrations for existing embeddings table
    let mut columns = Vec::new();
    {
        let mut stmt = conn.prepare("PRAGMA table_info(embeddings)")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
        for row in rows {
            columns.push(row?);
        }
    }
    if !columns.iter().any(|c| c == "provider") {
        conn.execute(
            "ALTER TABLE embeddings ADD COLUMN provider TEXT NOT NULL DEFAULT 'unknown'",
            [],
        )?;
    }
    if !columns.iter().any(|c| c == "model") {
        conn.execute(
            "ALTER TABLE embeddings ADD COLUMN model TEXT NOT NULL DEFAULT ''",
            [],
        )?;
    }
    if !columns.iter().any(|c| c == "updated_at") {
        conn.execute(
            "ALTER TABLE embeddings ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
        conn.execute(
            "UPDATE embeddings SET updated_at = created_at WHERE updated_at = 0",
            [],
        )?;
    }

    // Deduplicate historical duplicates before enforcing unique paragraph_id
    conn.execute(
        "DELETE FROM embeddings
         WHERE rowid IN (
           SELECT rowid
           FROM (
             SELECT rowid,
                    ROW_NUMBER() OVER (
                      PARTITION BY paragraph_id
                      ORDER BY updated_at DESC, created_at DESC, rowid DESC
                    ) AS rn
             FROM embeddings
           ) t
           WHERE t.rn > 1
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

    // Create annotations table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS annotations (
            id TEXT PRIMARY KEY,
            paragraph_id TEXT NOT NULL REFERENCES paragraphs(id) ON DELETE CASCADE,
            selected_text TEXT NOT NULL,
            style TEXT NOT NULL,
            note TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
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

    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_embeddings_paragraph_id_unique ON embeddings(paragraph_id)",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_embeddings_profile ON embeddings(provider, model, dim)",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_embeddings_paragraph_id ON embeddings(paragraph_id)",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_annotations_paragraph_id ON annotations(paragraph_id)",
        [],
    )?;

    info!("Database schema created successfully");
    Ok(())
}
