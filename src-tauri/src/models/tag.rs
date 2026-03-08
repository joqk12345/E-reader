use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagAlias {
    pub id: String,
    pub tag_id: String,
    pub alias: String,
    pub normalized_alias: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagRecord {
    pub id: String,
    pub name: String,
    pub normalized_name: String,
    pub is_temporary: bool,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default)]
    pub usage_count: usize,
    #[serde(default)]
    pub pending_suggestion_count: usize,
    #[serde(default)]
    pub aliases: Vec<TagAlias>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentTagAssignment {
    pub doc_id: String,
    pub tag_id: String,
    pub tag_name: String,
    pub normalized_name: String,
    pub is_temporary: bool,
    pub source: String,
    pub applied_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagSuggestion {
    pub id: String,
    pub doc_id: String,
    pub proposed_name: String,
    pub normalized_name: String,
    pub matched_tag_id: Option<String>,
    pub matched_tag_name: Option<String>,
    pub source: String,
    pub status: String,
    pub reason: Option<String>,
    pub confidence: Option<f32>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagFacet {
    pub tag_id: String,
    pub name: String,
    pub normalized_name: String,
    pub count: usize,
    pub is_temporary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelatedDocument {
    pub doc_id: String,
    pub title: String,
    pub file_type: String,
    pub updated_at: i64,
    pub shared_tag_count: usize,
    pub shared_tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchTagReviewDoc {
    pub doc_id: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchTagReviewItem {
    pub normalized_name: String,
    pub proposed_name: String,
    pub matched_tag_id: Option<String>,
    pub matched_tag_name: Option<String>,
    pub doc_count: usize,
    pub suggestion_ids: Vec<String>,
    pub sample_docs: Vec<BatchTagReviewDoc>,
    pub reasons: Vec<String>,
}
