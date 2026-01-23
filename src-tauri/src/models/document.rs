use serde::{Deserialize, Serialize};

/// Represents a document in the reader
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Document {
    pub id: String,
    pub title: String,
    pub author: Option<String>,
    pub language: Option<String>,
    pub file_path: String,
    pub file_type: String,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Represents a new document to be inserted
#[derive(Debug, Serialize, Deserialize)]
pub struct NewDocument {
    pub title: String,
    pub author: Option<String>,
    pub language: Option<String>,
    pub file_path: String,
    pub file_type: String,
}
