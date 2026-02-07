use crate::models::{Document, NewDocument};
use chrono::Utc;
use rusqlite::{params, Connection, Result};
use thiserror::Error;
use uuid::Uuid;

#[derive(Error, Debug)]
pub enum DocumentError {
    #[error("Document not found")]
    NotFound,
    #[error("Database error: {0}")]
    DatabaseError(#[from] rusqlite::Error),
}

/// Inserts a new document into the database
///
/// Generates a UUID v4 for the document ID and sets created_at and updated_at
/// timestamps to the current Unix timestamp.
pub fn insert(conn: &Connection, new_doc: NewDocument) -> Result<Document, DocumentError> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().timestamp();

    conn.execute(
        "INSERT INTO documents (id, title, author, language, file_path, file_type, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            &id,
            &new_doc.title,
            &new_doc.author,
            &new_doc.language,
            &new_doc.file_path,
            &new_doc.file_type,
            now,
            now,
        ],
    )?;

    Ok(Document {
        id,
        title: new_doc.title,
        author: new_doc.author,
        language: new_doc.language,
        file_path: new_doc.file_path,
        file_type: new_doc.file_type,
        created_at: now,
        updated_at: now,
    })
}

/// Lists all documents in the database
///
/// Returns documents ordered by created_at in descending order (newest first).
pub fn list(conn: &Connection) -> Result<Vec<Document>, DocumentError> {
    let mut stmt = conn.prepare(
        "SELECT id, title, author, language, file_path, file_type, created_at, updated_at
         FROM documents
         ORDER BY created_at DESC",
    )?;

    let documents = stmt
        .query_map([], |row| {
            Ok(Document {
                id: row.get(0)?,
                title: row.get(1)?,
                author: row.get(2)?,
                language: row.get(3)?,
                file_path: row.get(4)?,
                file_type: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(documents)
}

/// Gets a document by ID
///
/// Returns None if the document doesn't exist.
pub fn get(conn: &Connection, id: &str) -> Result<Option<Document>, DocumentError> {
    let mut stmt = conn.prepare(
        "SELECT id, title, author, language, file_path, file_type, created_at, updated_at
         FROM documents
         WHERE id = ?1",
    )?;

    let documents = stmt
        .query_map(params![id], |row| {
            Ok(Document {
                id: row.get(0)?,
                title: row.get(1)?,
                author: row.get(2)?,
                language: row.get(3)?,
                file_path: row.get(4)?,
                file_type: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(documents.into_iter().next())
}

/// Deletes a document by ID
///
/// Returns NotFound error if the document doesn't exist (no rows affected).
/// Related sections and paragraphs are automatically deleted via CASCADE.
pub fn delete(conn: &Connection, id: &str) -> Result<(), DocumentError> {
    let rows_affected = conn.execute("DELETE FROM documents WHERE id = ?1", params![id])?;

    if rows_affected == 0 {
        return Err(DocumentError::NotFound);
    }

    Ok(())
}
