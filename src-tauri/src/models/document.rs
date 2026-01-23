use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Represents a document in the reader
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Document {
    pub id: i64,
    pub title: String,
    pub author: Option<String>,
    pub language: String,
    pub file_path: String,
    pub file_type: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Represents a new document to be inserted
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewDocument {
    pub title: String,
    pub author: Option<String>,
    pub language: String,
    pub file_path: String,
    pub file_type: String,
}

impl Document {
    /// Creates a new Document with current timestamps
    pub fn new(new_doc: NewDocument) -> Self {
        let now = Utc::now();
        Document {
            id: 0, // Will be set by database
            title: new_doc.title,
            author: new_doc.author,
            language: new_doc.language,
            file_path: new_doc.file_path,
            file_type: new_doc.file_type,
            created_at: now,
            updated_at: now,
        }
    }
}
