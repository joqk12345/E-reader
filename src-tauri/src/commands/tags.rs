use super::ai_profiles::chat_with_agent_slot;
use crate::config::{load_config, AgentSlot};
use crate::database::{
    self, clear_pending_suggestions_for_doc, ensure_tag, get_connection, insert_tag_suggestion,
    normalize_tag_name, resolve_tag_by_name, NewTagSuggestion, ReviewTagSuggestionAction,
};
use crate::error::Result;
use crate::llm::ChatMessage;
use crate::models::{
    BatchTagReviewItem, DocumentTagAssignment, RelatedDocument, TagAlias, TagFacet, TagRecord,
    TagSuggestion,
};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use tauri::AppHandle;
use tokio::time::{timeout, Duration};

const TAG_SUGGESTION_TIMEOUT_SECS: u64 = 45;
const MAX_TAG_SUGGESTIONS: usize = 8;

#[derive(Debug, Clone, Deserialize)]
pub struct ApplyDocumentTagsRequest {
    pub doc_ids: Vec<String>,
    pub tag_ids: Option<Vec<String>>,
    pub tag_names: Option<Vec<String>>,
    pub source: Option<String>,
    pub create_as_temporary: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ApplyDocumentTagsResponse {
    pub applied: usize,
    pub tags: Vec<TagRecord>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ListTagLibraryRequest {
    pub search: Option<String>,
    pub only_temporary: Option<bool>,
    pub only_unused: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SuggestDocumentTagsRequest {
    pub doc_id: String,
    pub refresh: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SuggestTagsForDocumentsRequest {
    pub doc_ids: Vec<String>,
    pub refresh: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SuggestTagsForDocumentsResponse {
    pub processed_docs: usize,
    pub created_suggestions: usize,
    pub matched_pending: usize,
    pub new_candidate_pending: usize,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ReviewTagSuggestionsRequest {
    pub actions: Vec<ReviewTagSuggestionsInput>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ReviewTagSuggestionsInput {
    pub suggestion_ids: Vec<String>,
    pub action: String,
    pub tag_id: Option<String>,
    pub new_tag_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RenameTagRequest {
    pub tag_id: String,
    pub new_name: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MergeTagsRequest {
    pub source_tag_id: String,
    pub target_tag_id: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AddTagAliasRequest {
    pub tag_id: String,
    pub alias: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RemoveTagAliasRequest {
    pub alias_id: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PromoteTemporaryTagRequest {
    pub tag_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CleanupUnusedTagsResponse {
    pub deleted: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SuggestedTagCandidate {
    name: String,
    #[serde(default)]
    reason: Option<String>,
    #[serde(default)]
    confidence: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SuggestedTagEnvelope {
    #[serde(default)]
    tags: Vec<SuggestedTagCandidate>,
}

fn tag_rules() -> [(&'static str, &'static [&'static str]); 10] {
    [
        ("LLM", &["llm", "大模型", "gpt", "qwen", "vllm"]),
        ("RAG", &["rag", "retrieval", "检索增强"]),
        ("Agent", &["agent", "智能体"]),
        ("Rust", &["rust", "cargo", "tauri"]),
        ("Python", &["python", "pandas", "numpy"]),
        ("Web", &["react", "frontend", "browser", "web"]),
        (
            "数据库",
            &["sqlite", "database", "postgres", "mysql", "向量库"],
        ),
        (
            "性能",
            &["performance", "benchmark", "latency", "优化", "吞吐"],
        ),
        ("产品", &["product", "用户", "增长", "体验"]),
        ("投资", &["investment", "stock", "基金", "投资"]),
    ]
}

fn parse_json_payload(raw: &str) -> Option<SuggestedTagEnvelope> {
    let trimmed = raw.trim();
    let direct = serde_json::from_str::<SuggestedTagEnvelope>(trimmed).ok();
    if direct.is_some() {
        return direct;
    }
    if let Ok(tags) = serde_json::from_str::<Vec<SuggestedTagCandidate>>(trimmed) {
        return Some(SuggestedTagEnvelope { tags });
    }
    let fenced = trimmed
        .strip_prefix("```json")
        .and_then(|value| value.strip_suffix("```"))
        .map(str::trim)
        .or_else(|| {
            trimmed
                .strip_prefix("```")
                .and_then(|value| value.strip_suffix("```"))
                .map(str::trim)
        });
    if let Some(block) = fenced {
        if let Ok(env) = serde_json::from_str::<SuggestedTagEnvelope>(block) {
            return Some(env);
        }
        if let Ok(tags) = serde_json::from_str::<Vec<SuggestedTagCandidate>>(block) {
            return Some(SuggestedTagEnvelope { tags });
        }
    }
    let first_brace = trimmed.find('{');
    let last_brace = trimmed.rfind('}');
    if let (Some(start), Some(end)) = (first_brace, last_brace) {
        if start <= end {
            if let Ok(env) = serde_json::from_str::<SuggestedTagEnvelope>(&trimmed[start..=end]) {
                return Some(env);
            }
        }
    }
    let first_bracket = trimmed.find('[');
    let last_bracket = trimmed.rfind(']');
    if let (Some(start), Some(end)) = (first_bracket, last_bracket) {
        if start <= end {
            if let Ok(tags) =
                serde_json::from_str::<Vec<SuggestedTagCandidate>>(&trimmed[start..=end])
            {
                return Some(SuggestedTagEnvelope { tags });
            }
        }
    }
    None
}

fn build_heuristic_candidates(corpus: &str) -> Vec<SuggestedTagCandidate> {
    let normalized = corpus.to_lowercase();
    tag_rules()
        .into_iter()
        .filter(|(_, keywords)| keywords.iter().any(|keyword| normalized.contains(keyword)))
        .take(MAX_TAG_SUGGESTIONS)
        .map(|(name, keywords)| SuggestedTagCandidate {
            name: name.to_string(),
            reason: Some(format!("matched keywords: {}", keywords.join(", "))),
            confidence: Some(0.45),
        })
        .collect()
}

fn dedupe_candidates(candidates: Vec<SuggestedTagCandidate>) -> Vec<SuggestedTagCandidate> {
    let mut seen = HashSet::new();
    let mut deduped = Vec::new();
    for candidate in candidates {
        let normalized = normalize_tag_name(&candidate.name);
        if normalized.is_empty() || !seen.insert(normalized) {
            continue;
        }
        deduped.push(candidate);
        if deduped.len() >= MAX_TAG_SUGGESTIONS {
            break;
        }
    }
    deduped
}

fn build_tag_prompt(title: &str, author: Option<&str>, content: &str) -> Vec<ChatMessage> {
    let system = r#"You are a document tagger.
Return ONLY JSON in this shape: {"tags":[{"name":"...", "reason":"...", "confidence":0.0}]}
Rules:
- Suggest at most 8 concise topical tags.
- Prefer stable topic names already common in knowledge bases.
- Avoid file-format tags, generic tags like "article", "document", "reading", or author names.
- Confidence must be between 0 and 1.
- If the content is too weak, return {"tags":[]}"#;
    let user = format!(
        "Title: {}\nAuthor: {}\nContent:\n{}",
        title,
        author.unwrap_or("Unknown"),
        content
    );
    vec![
        ChatMessage {
            role: "system".to_string(),
            content: system.to_string(),
        },
        ChatMessage {
            role: "user".to_string(),
            content: user,
        },
    ]
}

fn load_document_tagging_context(
    app_handle: &AppHandle,
    doc_id: &str,
) -> Result<(String, Option<String>, String, HashSet<String>)> {
    let conn = get_connection(app_handle)?;
    let doc = database::get_document(&conn, doc_id)?
        .ok_or_else(|| crate::ReaderError::NotFound(format!("Document {} not found", doc_id)))?;
    let paragraphs = database::list_paragraphs(&conn, doc_id)?;
    let content = paragraphs
        .iter()
        .take(24)
        .map(|item| item.text.trim())
        .filter(|item| !item.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");
    let existing = database::list_document_tags(&conn, Some(doc_id))?
        .into_iter()
        .map(|item| item.normalized_name)
        .collect::<HashSet<_>>();
    Ok((doc.title, doc.author, content, existing))
}

async fn generate_candidates_with_fallback(
    title: &str,
    author: Option<&str>,
    content: &str,
) -> (Vec<SuggestedTagCandidate>, String) {
    if content.trim().is_empty() {
        return (Vec::new(), "heuristic".to_string());
    }

    if let Ok(config) = load_config() {
        let messages = build_tag_prompt(title, author, content);
        let ai_result = timeout(
            Duration::from_secs(TAG_SUGGESTION_TIMEOUT_SECS),
            chat_with_agent_slot(&config, AgentSlot::Summary, messages, 0.2, 1200),
        )
        .await;

        if let Ok(Ok(raw)) = ai_result {
            if let Some(payload) = parse_json_payload(&raw) {
                let deduped = dedupe_candidates(payload.tags);
                if !deduped.is_empty() {
                    return (deduped, "ai".to_string());
                }
            }
        }
    }

    (
        dedupe_candidates(build_heuristic_candidates(&format!(
            "{}\n{}",
            title, content
        ))),
        "heuristic".to_string(),
    )
}

async fn generate_and_store_document_suggestions(
    app_handle: &AppHandle,
    doc_id: &str,
    refresh: bool,
    batch_mode: bool,
) -> Result<Vec<TagSuggestion>> {
    if refresh {
        let conn = get_connection(app_handle)?;
        clear_pending_suggestions_for_doc(&conn, doc_id)?;
    }

    let (title, author, content, existing_tags) =
        load_document_tagging_context(app_handle, doc_id)?;
    let (candidates, mode) =
        generate_candidates_with_fallback(&title, author.as_deref(), &content).await;
    if candidates.is_empty() {
        return Ok(Vec::new());
    }

    let mut created = Vec::new();
    let conn = get_connection(app_handle)?;
    for candidate in candidates {
        let normalized = normalize_tag_name(&candidate.name);
        if normalized.is_empty() || existing_tags.contains(&normalized) {
            continue;
        }
        let matched_tag = resolve_tag_by_name(&conn, &candidate.name)?;
        let source = if mode == "heuristic" {
            "heuristic".to_string()
        } else if batch_mode {
            "ai_batch".to_string()
        } else {
            "ai_single".to_string()
        };
        let suggestion = insert_tag_suggestion(
            &conn,
            NewTagSuggestion {
                doc_id: doc_id.to_string(),
                proposed_name: candidate.name,
                source,
                matched_tag_id: matched_tag.as_ref().map(|tag| tag.id.clone()),
                reason: candidate.reason,
                confidence: candidate.confidence.map(|value| value.clamp(0.0, 1.0)),
            },
        )?;
        created.push(suggestion);
    }
    Ok(created)
}

#[tauri::command]
pub async fn list_document_tags(
    app_handle: AppHandle,
    doc_id: Option<String>,
) -> Result<Vec<DocumentTagAssignment>> {
    let conn = get_connection(&app_handle)?;
    database::list_document_tags(&conn, doc_id.as_deref()).map_err(Into::into)
}

#[tauri::command]
pub async fn list_tag_library(
    app_handle: AppHandle,
    request: Option<ListTagLibraryRequest>,
) -> Result<Vec<TagRecord>> {
    let conn = get_connection(&app_handle)?;
    let request = request.unwrap_or(ListTagLibraryRequest {
        search: None,
        only_temporary: None,
        only_unused: None,
    });
    database::list_tag_library(
        &conn,
        request.search.as_deref(),
        request.only_temporary.unwrap_or(false),
        request.only_unused.unwrap_or(false),
    )
    .map_err(Into::into)
}

#[tauri::command]
pub async fn list_tag_facets(
    app_handle: AppHandle,
    search: Option<String>,
) -> Result<Vec<TagFacet>> {
    let conn = get_connection(&app_handle)?;
    database::list_tag_facets(&conn, search.as_deref()).map_err(Into::into)
}

#[tauri::command]
pub async fn list_tag_suggestions(
    app_handle: AppHandle,
    doc_id: Option<String>,
    status: Option<String>,
) -> Result<Vec<TagSuggestion>> {
    let conn = get_connection(&app_handle)?;
    database::list_tag_suggestions(&conn, doc_id.as_deref(), status.as_deref()).map_err(Into::into)
}

#[tauri::command]
pub async fn list_batch_tag_review_items(app_handle: AppHandle) -> Result<Vec<BatchTagReviewItem>> {
    let conn = get_connection(&app_handle)?;
    database::list_batch_tag_review_items(&conn).map_err(Into::into)
}

#[tauri::command]
pub async fn get_related_documents_by_tags(
    app_handle: AppHandle,
    doc_id: String,
    limit: Option<usize>,
) -> Result<Vec<RelatedDocument>> {
    let conn = get_connection(&app_handle)?;
    database::get_related_documents_by_tags(&conn, &doc_id, limit.unwrap_or(8)).map_err(Into::into)
}

#[tauri::command]
pub async fn apply_document_tags(
    app_handle: AppHandle,
    request: ApplyDocumentTagsRequest,
) -> Result<ApplyDocumentTagsResponse> {
    let conn = get_connection(&app_handle)?;
    let mut tag_ids = request.tag_ids.unwrap_or_default();
    let mut created_tags = Vec::new();
    for name in request.tag_names.unwrap_or_default() {
        let tag = ensure_tag(&conn, &name, request.create_as_temporary.unwrap_or(false))?;
        tag_ids.push(tag.id.clone());
        created_tags.push(tag);
    }
    tag_ids.sort();
    tag_ids.dedup();

    let applied = database::apply_document_tags(
        &conn,
        &request.doc_ids,
        &tag_ids,
        request.source.as_deref().unwrap_or("manual"),
    )?;

    let tag_index = database::list_tag_library(&conn, None, false, false)?
        .into_iter()
        .map(|tag| (tag.id.clone(), tag))
        .collect::<HashMap<_, _>>();
    let mut tags: Vec<TagRecord> = created_tags;
    let existing_ids = tags
        .iter()
        .map(|tag| tag.id.clone())
        .collect::<HashSet<_>>();
    for tag_id in tag_ids {
        if existing_ids.contains(&tag_id) {
            continue;
        }
        if let Some(tag) = tag_index.get(&tag_id) {
            tags.push(tag.clone());
        }
    }

    Ok(ApplyDocumentTagsResponse { applied, tags })
}

#[tauri::command]
pub async fn remove_document_tag(
    app_handle: AppHandle,
    doc_id: String,
    tag_id: String,
) -> Result<()> {
    let conn = get_connection(&app_handle)?;
    database::remove_document_tag(&conn, &doc_id, &tag_id).map_err(Into::into)
}

#[tauri::command]
pub async fn suggest_document_tags(
    app_handle: AppHandle,
    request: SuggestDocumentTagsRequest,
) -> Result<Vec<TagSuggestion>> {
    generate_and_store_document_suggestions(
        &app_handle,
        &request.doc_id,
        request.refresh.unwrap_or(true),
        false,
    )
    .await
}

#[tauri::command]
pub async fn suggest_tags_for_documents(
    app_handle: AppHandle,
    request: SuggestTagsForDocumentsRequest,
) -> Result<SuggestTagsForDocumentsResponse> {
    let mut created_suggestions = 0;
    let mut matched_pending = 0;
    let mut new_candidate_pending = 0;

    for doc_id in &request.doc_ids {
        let suggestions = generate_and_store_document_suggestions(
            &app_handle,
            doc_id,
            request.refresh.unwrap_or(true),
            true,
        )
        .await?;
        created_suggestions += suggestions.len();
        matched_pending += suggestions
            .iter()
            .filter(|item| item.matched_tag_id.is_some())
            .count();
        new_candidate_pending += suggestions
            .iter()
            .filter(|item| item.matched_tag_id.is_none())
            .count();
    }

    Ok(SuggestTagsForDocumentsResponse {
        processed_docs: request.doc_ids.len(),
        created_suggestions,
        matched_pending,
        new_candidate_pending,
    })
}

#[tauri::command]
pub async fn review_tag_suggestions(
    app_handle: AppHandle,
    request: ReviewTagSuggestionsRequest,
) -> Result<database::ReviewTagSuggestionResult> {
    let conn = get_connection(&app_handle)?;
    let actions = request
        .actions
        .into_iter()
        .map(|action| ReviewTagSuggestionAction {
            suggestion_ids: action.suggestion_ids,
            action: action.action,
            tag_id: action.tag_id,
            new_tag_name: action.new_tag_name,
        })
        .collect::<Vec<_>>();
    database::review_tag_suggestions(&conn, &actions).map_err(Into::into)
}

#[tauri::command]
pub async fn rename_tag(app_handle: AppHandle, request: RenameTagRequest) -> Result<TagRecord> {
    let conn = get_connection(&app_handle)?;
    database::rename_tag(&conn, &request.tag_id, &request.new_name).map_err(Into::into)
}

#[tauri::command]
pub async fn merge_tags(app_handle: AppHandle, request: MergeTagsRequest) -> Result<TagRecord> {
    let conn = get_connection(&app_handle)?;
    database::merge_tags(&conn, &request.source_tag_id, &request.target_tag_id).map_err(Into::into)
}

#[tauri::command]
pub async fn add_tag_alias(app_handle: AppHandle, request: AddTagAliasRequest) -> Result<TagAlias> {
    let conn = get_connection(&app_handle)?;
    database::add_tag_alias(&conn, &request.tag_id, &request.alias).map_err(Into::into)
}

#[tauri::command]
pub async fn remove_tag_alias(app_handle: AppHandle, request: RemoveTagAliasRequest) -> Result<()> {
    let conn = get_connection(&app_handle)?;
    database::remove_tag_alias(&conn, &request.alias_id).map_err(Into::into)
}

#[tauri::command]
pub async fn promote_temporary_tag(
    app_handle: AppHandle,
    request: PromoteTemporaryTagRequest,
) -> Result<TagRecord> {
    let conn = get_connection(&app_handle)?;
    database::promote_temporary_tag(&conn, &request.tag_id).map_err(Into::into)
}

#[tauri::command]
pub async fn cleanup_unused_tags(app_handle: AppHandle) -> Result<CleanupUnusedTagsResponse> {
    let conn = get_connection(&app_handle)?;
    let deleted = database::cleanup_unused_tags(&conn)?;
    Ok(CleanupUnusedTagsResponse { deleted })
}
