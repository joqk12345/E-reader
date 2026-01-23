use serde::{Deserialize, Serialize};

/// Represents a paragraph within a document
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Paragraph {
    pub id: String,
    pub doc_id: String,
    pub section_id: String,
    pub order_index: i32,
    pub text: String,
    pub location: String,
}
