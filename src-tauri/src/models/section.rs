use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Represents a section within a document
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Section {
    pub id: i64,
    pub doc_id: i64,
    pub title: String,
    pub order_index: i32,
    pub href: Option<String>,
    pub created_at: DateTime<Utc>,
}

/// Represents a new section to be inserted
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewSection {
    pub doc_id: i64,
    pub title: String,
    pub order_index: i32,
    pub href: Option<String>,
}

impl Section {
    /// Creates a new Section with current timestamp
    pub fn new(new_section: NewSection) -> Self {
        Section {
            id: 0, // Will be set by database
            doc_id: new_section.doc_id,
            title: new_section.title,
            order_index: new_section.order_index,
            href: new_section.href,
            created_at: Utc::now(),
        }
    }
}
