use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Annotation {
    pub id: String,
    pub paragraph_id: String,
    pub selected_text: String,
    pub style: String,
    pub note: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}
