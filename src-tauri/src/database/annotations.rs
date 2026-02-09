use crate::models::Annotation;
use rusqlite::{params, Connection, Result};
use thiserror::Error;
use uuid::Uuid;

#[derive(Error, Debug)]
pub enum AnnotationError {
    #[error("Database error: {0}")]
    DatabaseError(#[from] rusqlite::Error),
}

pub fn insert(
    conn: &Connection,
    paragraph_id: &str,
    selected_text: &str,
    style: &str,
    note: Option<&str>,
) -> Result<Annotation, AnnotationError> {
    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp();

    conn.execute(
        "INSERT INTO annotations (id, paragraph_id, selected_text, style, note, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![&id, paragraph_id, selected_text, style, note, now, now],
    )?;

    Ok(Annotation {
        id,
        paragraph_id: paragraph_id.to_string(),
        selected_text: selected_text.to_string(),
        style: style.to_string(),
        note: note.map(|v| v.to_string()),
        created_at: now,
        updated_at: now,
    })
}

pub fn delete(conn: &Connection, id: &str) -> Result<(), AnnotationError> {
    conn.execute("DELETE FROM annotations WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn list_by_paragraph_ids(
    conn: &Connection,
    paragraph_ids: &[String],
) -> Result<Vec<Annotation>, AnnotationError> {
    if paragraph_ids.is_empty() {
        return Ok(Vec::new());
    }

    let placeholders = paragraph_ids
        .iter()
        .map(|_| "?")
        .collect::<Vec<_>>()
        .join(",");

    let sql = format!(
        "SELECT id, paragraph_id, selected_text, style, note, created_at, updated_at
         FROM annotations
         WHERE paragraph_id IN ({})
         ORDER BY created_at DESC",
        placeholders
    );

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(
        paragraph_ids
            .iter()
            .map(|id| id as &dyn rusqlite::ToSql)
            .collect::<Vec<_>>()
            .as_slice(),
        |row| {
            Ok(Annotation {
                id: row.get(0)?,
                paragraph_id: row.get(1)?,
                selected_text: row.get(2)?,
                style: row.get(3)?,
                note: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        },
    )?;

    let annotations = rows.collect::<Result<Vec<_>, _>>()?;
    Ok(annotations)
}
