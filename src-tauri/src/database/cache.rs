use rusqlite::{Connection, Result, params};
use uuid::Uuid;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum CacheError {
    #[error("Translation not found")]
    TranslationNotFound,
    #[error("Summary not found")]
    SummaryNotFound,
    #[error("Database error: {0}")]
    DatabaseError(#[from] rusqlite::Error),
}

/// Represents a cached translation
pub struct Translation {
    pub id: String,
    pub paragraph_id: String,
    pub target_lang: String,
    pub translation: String,
    pub created_at: i64,
}

/// Represents a cached summary
pub struct Summary {
    pub id: String,
    pub target_id: String,
    pub target_type: String,
    pub style: String,
    pub summary: String,
    pub created_at: i64,
}

/// Saves a translation to the cache
///
/// Generates a UUID v4 for the translation ID and stores the translation
/// with the paragraph_id and target_lang. Enforces uniqueness on (paragraph_id, target_lang).
pub fn save_translation(
    conn: &Connection,
    paragraph_id: &str,
    target_lang: &str,
    translation: &str,
) -> Result<Translation, CacheError> {
    let id = Uuid::new_v4().to_string();
    let created_at = chrono::Utc::now().timestamp();

    conn.execute(
        "INSERT OR REPLACE INTO cache_translations (id, paragraph_id, target_lang, translation, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![&id, paragraph_id, target_lang, translation, created_at],
    )?;

    Ok(Translation {
        id,
        paragraph_id: paragraph_id.to_string(),
        target_lang: target_lang.to_string(),
        translation: translation.to_string(),
        created_at,
    })
}

/// Gets a translation from the cache
///
/// Returns None if the translation doesn't exist.
pub fn get_translation(
    conn: &Connection,
    paragraph_id: &str,
    target_lang: &str,
) -> Result<Option<Translation>, CacheError> {
    let mut stmt = conn.prepare(
        "SELECT id, paragraph_id, target_lang, translation, created_at
         FROM cache_translations
         WHERE paragraph_id = ?1 AND target_lang = ?2"
    )?;

    let translations = stmt.query_map(params![paragraph_id, target_lang], |row| {
        Ok(Translation {
            id: row.get(0)?,
            paragraph_id: row.get(1)?,
            target_lang: row.get(2)?,
            translation: row.get(3)?,
            created_at: row.get(4)?,
        })
    })?.collect::<Result<Vec<_>, _>>()?;

    Ok(translations.into_iter().next())
}

/// Saves a summary to the cache
///
/// Generates a UUID v4 for the summary ID and stores the summary
/// with the target_id, target_type, and style. Enforces uniqueness on (target_id, target_type, style).
pub fn save_summary(
    conn: &Connection,
    target_id: &str,
    target_type: &str,
    style: &str,
    summary: &str,
) -> Result<Summary, CacheError> {
    let id = Uuid::new_v4().to_string();
    let created_at = chrono::Utc::now().timestamp();

    conn.execute(
        "INSERT OR REPLACE INTO cache_summaries (id, target_id, target_type, style, summary, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![&id, target_id, target_type, style, summary, created_at],
    )?;

    Ok(Summary {
        id,
        target_id: target_id.to_string(),
        target_type: target_type.to_string(),
        style: style.to_string(),
        summary: summary.to_string(),
        created_at,
    })
}

/// Gets a summary from the cache
///
/// Returns None if the summary doesn't exist.
pub fn get_summary(
    conn: &Connection,
    target_id: &str,
    target_type: &str,
    style: &str,
) -> Result<Option<Summary>, CacheError> {
    let mut stmt = conn.prepare(
        "SELECT id, target_id, target_type, style, summary, created_at
         FROM cache_summaries
         WHERE target_id = ?1 AND target_type = ?2 AND style = ?3"
    )?;

    let summaries = stmt.query_map(params![target_id, target_type, style], |row| {
        Ok(Summary {
            id: row.get(0)?,
            target_id: row.get(1)?,
            target_type: row.get(2)?,
            style: row.get(3)?,
            summary: row.get(4)?,
            created_at: row.get(5)?,
        })
    })?.collect::<Result<Vec<_>, _>>()?;

    Ok(summaries.into_iter().next())
}
