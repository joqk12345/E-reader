use rusqlite::{Connection, Result, params};
use uuid::Uuid;
use crate::models::section::Section;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum SectionError {
    #[error("Section not found")]
    NotFound,
    #[error("Database error: {0}")]
    DatabaseError(#[from] rusqlite::Error),
}

/// Inserts a new section into the database
///
/// Generates a UUID v4 for the section ID.
pub fn insert(
    conn: &Connection,
    doc_id: &str,
    title: &str,
    order_index: i32,
    href: &str,
) -> Result<Section, SectionError> {
    let id = Uuid::new_v4().to_string();

    conn.execute(
        "INSERT INTO sections (id, doc_id, title, order_index, href)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![&id, doc_id, title, order_index, href],
    )?;

    Ok(Section {
        id,
        doc_id: doc_id.to_string(),
        title: title.to_string(),
        order_index,
        href: href.to_string(),
    })
}

/// Lists all sections for a document
///
/// Returns sections ordered by order_index in ascending order.
pub fn list_by_document(conn: &Connection, doc_id: &str) -> Result<Vec<Section>, SectionError> {
    let mut stmt = conn.prepare(
        "SELECT id, doc_id, title, order_index, href
         FROM sections
         WHERE doc_id = ?1
         ORDER BY order_index"
    )?;

    let sections = stmt.query_map(params![doc_id], |row| {
        Ok(Section {
            id: row.get(0)?,
            doc_id: row.get(1)?,
            title: row.get(2)?,
            order_index: row.get(3)?,
            href: row.get(4)?,
        })
    })?.collect::<Result<Vec<_>, _>>()?;

    Ok(sections)
}

/// Gets a section by ID
///
/// Returns None if the section doesn't exist.
pub fn get(conn: &Connection, id: &str) -> Result<Option<Section>, SectionError> {
    let mut stmt = conn.prepare(
        "SELECT id, doc_id, title, order_index, href
         FROM sections
         WHERE id = ?1"
    )?;

    let sections = stmt.query_map(params![id], |row| {
        Ok(Section {
            id: row.get(0)?,
            doc_id: row.get(1)?,
            title: row.get(2)?,
            order_index: row.get(3)?,
            href: row.get(4)?,
        })
    })?.collect::<Result<Vec<_>, _>>()?;

    Ok(sections.into_iter().next())
}
