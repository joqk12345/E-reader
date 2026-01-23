use serde::{Deserialize, Serialize};

/// Represents a section within a document
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Section {
    pub id: String,
    pub doc_id: String,
    pub title: String,
    pub order_index: i32,
    pub href: String,
}
