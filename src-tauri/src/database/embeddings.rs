use rusqlite::{Connection, Result, params};
use uuid::Uuid;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum EmbeddingError {
    #[error("Embedding not found")]
    NotFound,
    #[error("Database error: {0}")]
    DatabaseError(#[from] rusqlite::Error),
    #[error("Invalid embedding dimension: expected {expected}, got {actual}")]
    InvalidDimension { expected: usize, actual: usize },
}

/// Represents an embedding vector stored in the database
pub struct Embedding {
    pub id: String,
    pub paragraph_id: String,
    pub vector: Vec<f32>,
    pub dim: i32,
    pub created_at: i64,
}

/// Converts a vector of f32 values to a byte array for storage in BLOB format
///
/// Each f32 is converted to its 4-byte little-endian representation.
pub fn vec_f32_to_bytes(vec: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(vec.len() * 4);
    for value in vec {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    bytes
}

/// Converts a byte array back to a vector of f32 values
///
/// Expects the byte array to contain 4-byte little-endian f32 values.
pub fn bytes_to_vec_f32(bytes: &[u8]) -> Result<Vec<f32>, EmbeddingError> {
    if bytes.len() % 4 != 0 {
        return Err(EmbeddingError::InvalidDimension {
            expected: bytes.len() / 4 * 4,
            actual: bytes.len(),
        });
    }

    let mut vec = Vec::with_capacity(bytes.len() / 4);
    for chunk in bytes.chunks_exact(4) {
        let value = f32::from_le_bytes(chunk.try_into().unwrap());
        vec.push(value);
    }

    Ok(vec)
}

/// Inserts a new embedding into the database
///
/// Generates a UUID v4 for the embedding ID and stores the vector as a BLOB.
pub fn insert(
    conn: &Connection,
    paragraph_id: &str,
    vector: Vec<f32>,
) -> Result<Embedding, EmbeddingError> {
    let id = Uuid::new_v4().to_string();
    let dim = vector.len() as i32;
    let bytes = vec_f32_to_bytes(&vector);
    let created_at = chrono::Utc::now().timestamp();

    conn.execute(
        "INSERT INTO embeddings (id, paragraph_id, vector, dim, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![&id, paragraph_id, &bytes, dim, created_at],
    )?;

    Ok(Embedding {
        id,
        paragraph_id: paragraph_id.to_string(),
        vector,
        dim,
        created_at,
    })
}

/// Gets an embedding by paragraph ID
///
/// Returns None if the embedding doesn't exist.
pub fn get(conn: &Connection, paragraph_id: &str) -> Result<Option<Embedding>, EmbeddingError> {
    let mut stmt = conn.prepare(
        "SELECT id, paragraph_id, vector, dim, created_at
         FROM embeddings
         WHERE paragraph_id = ?1"
    )?;

    let embeddings = stmt.query_map(params![paragraph_id], |row| {
        let bytes: Vec<u8> = row.get(2)?;
        let vector = bytes_to_vec_f32(&bytes)?;
        Ok(Embedding {
            id: row.get(0)?,
            paragraph_id: row.get(1)?,
            vector,
            dim: row.get(3)?,
            created_at: row.get(4)?,
        })
    })?.collect::<Result<Vec<_>, _>>()?;

    Ok(embeddings.into_iter().next())
}

/// Lists all embeddings with their vectors
///
/// Returns all embeddings ordered by created_at in descending order (newest first).
pub fn list_all_vectors(conn: &Connection) -> Result<Vec<Embedding>, EmbeddingError> {
    let mut stmt = conn.prepare(
        "SELECT id, paragraph_id, vector, dim, created_at
         FROM embeddings
         ORDER BY created_at DESC"
    )?;

    let embeddings = stmt.query_map([], |row| {
        let bytes: Vec<u8> = row.get(2)?;
        let vector = bytes_to_vec_f32(&bytes)?;
        Ok(Embedding {
            id: row.get(0)?,
            paragraph_id: row.get(1)?,
            vector,
            dim: row.get(3)?,
            created_at: row.get(4)?,
        })
    })?.collect::<Result<Vec<_>, _>>()?;

    Ok(embeddings)
}

/// Lists all embeddings for a specific document
///
/// Returns embeddings for paragraphs belonging to the specified document,
/// ordered by created_at in descending order (newest first).
pub fn list_by_document(
    conn: &Connection,
    doc_id: &str,
) -> Result<Vec<Embedding>, EmbeddingError> {
    let mut stmt = conn.prepare(
        "SELECT e.id, e.paragraph_id, e.vector, e.dim, e.created_at
         FROM embeddings e
         JOIN paragraphs p ON e.paragraph_id = p.id
         WHERE p.doc_id = ?1
         ORDER BY e.created_at DESC"
    )?;

    let embeddings = stmt.query_map(params![doc_id], |row| {
        let bytes: Vec<u8> = row.get(2)?;
        let vector = bytes_to_vec_f32(&bytes)?;
        Ok(Embedding {
            id: row.get(0)?,
            paragraph_id: row.get(1)?,
            vector,
            dim: row.get(3)?,
            created_at: row.get(4)?,
        })
    })?.collect::<Result<Vec<_>, _>>()?;

    Ok(embeddings)
}
