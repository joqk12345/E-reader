use crate::models::Paragraph;
use rusqlite::{params, Connection, Result};
use thiserror::Error;
use uuid::Uuid;

#[derive(Error, Debug)]
pub enum ParagraphError {
    #[error("Paragraph not found")]
    NotFound,
    #[error("Database error: {0}")]
    DatabaseError(#[from] rusqlite::Error),
}

/// Inserts a new paragraph into the database
///
/// Generates a UUID v4 for the paragraph ID.
pub fn insert(
    conn: &Connection,
    doc_id: &str,
    section_id: &str,
    order_index: i32,
    text: &str,
    location: &str,
) -> Result<Paragraph, ParagraphError> {
    let id = Uuid::new_v4().to_string();

    conn.execute(
        "INSERT INTO paragraphs (id, doc_id, section_id, order_index, text, location)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![&id, doc_id, section_id, order_index, text, location],
    )?;

    Ok(Paragraph {
        id,
        doc_id: doc_id.to_string(),
        section_id: section_id.to_string(),
        order_index,
        text: text.to_string(),
        location: location.to_string(),
    })
}

/// Lists all paragraphs for a section
///
/// Returns paragraphs ordered by order_index in ascending order.
pub fn list_by_section(
    conn: &Connection,
    section_id: &str,
) -> Result<Vec<Paragraph>, ParagraphError> {
    let mut stmt = conn.prepare(
        "SELECT id, doc_id, section_id, order_index, text, location
         FROM paragraphs
         WHERE section_id = ?1
         ORDER BY order_index",
    )?;

    let paragraphs = stmt
        .query_map(params![section_id], |row| {
            Ok(Paragraph {
                id: row.get(0)?,
                doc_id: row.get(1)?,
                section_id: row.get(2)?,
                order_index: row.get(3)?,
                text: row.get(4)?,
                location: row.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(paragraphs)
}

/// Gets a paragraph by ID
///
/// Returns None if the paragraph doesn't exist.
pub fn get(conn: &Connection, id: &str) -> Result<Option<Paragraph>, ParagraphError> {
    let mut stmt = conn.prepare(
        "SELECT id, doc_id, section_id, order_index, text, location
         FROM paragraphs
         WHERE id = ?1",
    )?;

    let paragraphs = stmt
        .query_map(params![id], |row| {
            Ok(Paragraph {
                id: row.get(0)?,
                doc_id: row.get(1)?,
                section_id: row.get(2)?,
                order_index: row.get(3)?,
                text: row.get(4)?,
                location: row.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(paragraphs.into_iter().next())
}

/// Lists all paragraphs for a document
///
/// Returns paragraphs ordered by section_id and order_index in ascending order.
pub fn list_by_document(conn: &Connection, doc_id: &str) -> Result<Vec<Paragraph>, ParagraphError> {
    let mut stmt = conn.prepare(
        "SELECT p.id, p.doc_id, p.section_id, p.order_index, p.text, p.location
         FROM paragraphs p
         JOIN sections s ON p.section_id = s.id
         WHERE p.doc_id = ?1
         ORDER BY s.order_index, p.order_index",
    )?;

    let paragraphs = stmt
        .query_map(params![doc_id], |row| {
            Ok(Paragraph {
                id: row.get(0)?,
                doc_id: row.get(1)?,
                section_id: row.get(2)?,
                order_index: row.get(3)?,
                text: row.get(4)?,
                location: row.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(paragraphs)
}
