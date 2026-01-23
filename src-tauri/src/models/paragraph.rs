use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Represents a paragraph within a document
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Paragraph {
    pub id: i64,
    pub doc_id: i64,
    pub section_id: Option<i64>,
    pub order_index: i32,
    pub text: String,
    pub location: Option<String>,
    pub created_at: DateTime<Utc>,
}

/// Represents a new paragraph to be inserted
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewParagraph {
    pub doc_id: i64,
    pub section_id: Option<i64>,
    pub order_index: i32,
    pub text: String,
    pub location: Option<String>,
}

impl Paragraph {
    /// Creates a new Paragraph with current timestamp
    pub fn new(new_paragraph: NewParagraph) -> Self {
        Paragraph {
            id: 0, // Will be set by database
            doc_id: new_paragraph.doc_id,
            section_id: new_paragraph.section_id,
            order_index: new_paragraph.order_index,
            text: new_paragraph.text,
            location: new_paragraph.location,
            created_at: Utc::now(),
        }
    }
}
