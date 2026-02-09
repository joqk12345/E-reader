use crate::config::load_config;
use crate::database;
use crate::error::{ReaderError, Result};
use crate::llm::LmStudioClient;
use crate::search::{SearchOptions, SearchResult};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;

// MCP Tool Schemas (from mcp_schemas/reader-tools.schema.json)
const TOOLS: &[(&str, &str, &str)] = &[
    (
        "reader.search",
        "Search documents using semantic search",
        "Search",
    ),
    ("reader.get_section", "Get a section's content", "Read"),
    (
        "reader.summarize",
        "Summarize a document, section, or paragraph",
        "Analyze",
    ),
    (
        "reader.translate",
        "Translate text or a paragraph",
        "Transform",
    ),
    (
        "reader.bilingual_view",
        "Get bilingual view of a paragraph",
        "Read",
    ),
    (
        "reader.open_location",
        "Open reader at a specific location",
        "Navigate",
    ),
];

pub fn get_tools_list() -> Value {
    let tools: Vec<Value> = TOOLS
        .iter()
        .map(|(name, desc, category)| {
            serde_json::json!({
                "name": name,
                "description": desc,
                "category": category,
            })
        })
        .collect();

    serde_json::json!({ "tools": tools })
}

#[derive(Deserialize)]
struct SearchArgs {
    query: String,
    #[serde(default = "default_top_k")]
    top_k: usize,
    #[serde(rename = "doc_id", default)]
    doc_id: Option<String>,
    #[serde(rename = "section_id", default)]
    section_id: Option<String>,
}

fn default_top_k() -> usize {
    10
}

pub async fn handle_search(app_handle: &AppHandle, args: Value) -> Result<Value> {
    let args: SearchArgs = serde_json::from_value(args)
        .map_err(|e| ReaderError::InvalidArgument(format!("Invalid search args: {}", e)))?;

    let conn = database::get_connection(app_handle)?;
    let config = load_config()?;

    let llm_client = LmStudioClient::new(
        config.lm_studio_url,
        config.embedding_model,
        config.chat_model,
    )?;

    // Note: Current implementation only supports doc_id filtering
    // section_id is accepted for future compatibility but not used
    let options = SearchOptions {
        query: args.query.clone(),
        top_k: args.top_k,
        doc_id: args.doc_id,
        force_keyword: false,
    };

    let results = crate::search::semantic_search(&conn, &llm_client, options).await?;

    let results_json: Vec<Value> = results
        .into_iter()
        .map(|r| {
            serde_json::json!({
                "paragraph_id": r.paragraph_id,
                "snippet": r.snippet,
                "score": r.score,
                "location": r.location,
            })
        })
        .collect();

    Ok(serde_json::json!({ "results": results_json }))
}

#[derive(Deserialize)]
struct GetSectionArgs {
    #[serde(rename = "doc_id")]
    doc_id: String,
    #[serde(rename = "section_id")]
    section_id: String,
}

pub async fn handle_get_section(app_handle: &AppHandle, args: Value) -> Result<Value> {
    let args: GetSectionArgs = serde_json::from_value(args)
        .map_err(|e| ReaderError::InvalidArgument(format!("Invalid get_section args: {}", e)))?;

    let conn = database::get_connection(app_handle)?;
    let section = database::get_section(&conn, &args.section_id)?
        .ok_or_else(|| ReaderError::NotFound(format!("Section {}", args.section_id)))?;

    let paragraphs = database::list_paragraphs_by_section(&conn, &args.section_id)?;

    let paragraphs_json: Vec<Value> = paragraphs
        .into_iter()
        .map(|p| {
            serde_json::json!({
                "paragraph_id": p.id,
                "text": p.text,
                "location": p.location,
            })
        })
        .collect();

    Ok(serde_json::json!({
        "title": section.title,
        "paragraphs": paragraphs_json,
    }))
}

#[derive(Deserialize)]
struct SummarizeArgs {
    #[serde(rename = "doc_id")]
    doc_id: Option<String>,
    #[serde(rename = "section_id")]
    section_id: Option<String>,
    #[serde(rename = "paragraph_id")]
    paragraph_id: Option<String>,
    #[serde(default = "default_summary_style")]
    style: String,
}

fn default_summary_style() -> String {
    "brief".to_string()
}

pub async fn handle_summarize(app_handle: &AppHandle, args: Value) -> Result<Value> {
    let args: SummarizeArgs = serde_json::from_value(args)
        .map_err(|e| ReaderError::InvalidArgument(format!("Invalid summarize args: {}", e)))?;

    // Validate that exactly one of doc_id, section_id, or paragraph_id is provided
    let provided_count = [
        args.doc_id.is_some(),
        args.section_id.is_some(),
        args.paragraph_id.is_some(),
    ]
    .iter()
    .filter(|&&x| x)
    .count();

    if provided_count != 1 {
        return Err(ReaderError::InvalidArgument(
            "Exactly one of 'doc_id', 'section_id', or 'paragraph_id' must be provided".to_string(),
        ));
    }

    // Validate style
    if !matches!(args.style.as_str(), "brief" | "detailed" | "bullet") {
        return Err(ReaderError::InvalidArgument(format!(
            "Style must be one of: brief, detailed, bullet. Got: {}",
            args.style
        )));
    }

    // Call the existing summarize command logic
    let summary = if let Some(pid) = &args.paragraph_id {
        crate::commands::summarize(
            app_handle.clone(),
            None,
            None,
            Some(pid.clone()),
            args.style,
        )
        .await?
    } else if let Some(sid) = &args.section_id {
        crate::commands::summarize(
            app_handle.clone(),
            None,
            Some(sid.clone()),
            None,
            args.style,
        )
        .await?
    } else {
        crate::commands::summarize(app_handle.clone(), args.doc_id, None, None, args.style).await?
    };

    Ok(serde_json::json!({ "summary": summary }))
}

#[derive(Deserialize)]
struct TranslateArgs {
    text: Option<String>,
    #[serde(rename = "paragraph_id")]
    paragraph_id: Option<String>,
    #[serde(rename = "target_lang")]
    target_lang: String,
}

pub async fn handle_translate(app_handle: &AppHandle, args: Value) -> Result<Value> {
    let args: TranslateArgs = serde_json::from_value(args)
        .map_err(|e| ReaderError::InvalidArgument(format!("Invalid translate args: {}", e)))?;

    // Validate that exactly one of text or paragraph_id is provided
    match (&args.text, &args.paragraph_id) {
        (None, None) => {
            return Err(ReaderError::InvalidArgument(
                "Either 'text' or 'paragraph_id' must be provided".to_string(),
            ));
        }
        (Some(_), Some(_)) => {
            return Err(ReaderError::InvalidArgument(
                "Only one of 'text' or 'paragraph_id' should be provided, not both".to_string(),
            ));
        }
        _ => {}
    }

    // Call the existing translate command logic
    let translation = crate::commands::translate(
        app_handle.clone(),
        args.text,
        args.paragraph_id,
        args.target_lang,
    )
    .await?;

    Ok(serde_json::json!({ "translation": translation }))
}

#[derive(Deserialize)]
struct BilingualViewArgs {
    #[serde(rename = "paragraph_id")]
    paragraph_id: String,
}

pub async fn handle_bilingual_view(app_handle: &AppHandle, args: Value) -> Result<Value> {
    let args: BilingualViewArgs = serde_json::from_value(args)
        .map_err(|e| ReaderError::InvalidArgument(format!("Invalid bilingual_view args: {}", e)))?;

    let conn = database::get_connection(app_handle)?;
    let paragraph = database::get_paragraph(&conn, &args.paragraph_id)?
        .ok_or_else(|| ReaderError::NotFound(format!("Paragraph {}", args.paragraph_id)))?;

    // Get translation (default to English)
    let translation = crate::commands::translate(
        app_handle.clone(),
        None,
        Some(args.paragraph_id.clone()),
        "en".to_string(),
    )
    .await?;

    Ok(serde_json::json!({
        "original": paragraph.text,
        "translation": translation,
    }))
}

#[derive(Deserialize)]
struct OpenLocationArgs {
    #[serde(rename = "doc_id")]
    doc_id: String,
    location: String,
}

pub async fn handle_open_location(_app_handle: &AppHandle, args: Value) -> Result<Value> {
    let _args: OpenLocationArgs = serde_json::from_value(args)
        .map_err(|e| ReaderError::InvalidArgument(format!("Invalid open_location args: {}", e)))?;

    // TODO: Implement jumping to location in UI
    // For now, just return success
    Ok(serde_json::json!({ "ok": true }))
}

pub async fn handle_tool_call(
    app_handle: &AppHandle,
    tool_name: &str,
    arguments: Value,
) -> Result<Value> {
    match tool_name {
        "reader.search" => handle_search(app_handle, arguments).await,
        "reader.get_section" => handle_get_section(app_handle, arguments).await,
        "reader.summarize" => handle_summarize(app_handle, arguments).await,
        "reader.translate" => handle_translate(app_handle, arguments).await,
        "reader.bilingual_view" => handle_bilingual_view(app_handle, arguments).await,
        "reader.open_location" => handle_open_location(app_handle, arguments).await,
        _ => Err(ReaderError::InvalidArgument(format!(
            "Unknown tool: {}",
            tool_name
        ))),
    }
}
