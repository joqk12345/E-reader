use crate::config::load_config;
use crate::database::{get_connection, get_paragraph, save_translation, get_translation, save_summary, get_summary};
use crate::error::{Result, ReaderError};
use crate::llm::{LmStudioClient};
use crate::llm::lmstudio::ChatMessage;
use tauri::AppHandle;

/// Translates text or a paragraph to a target language
///
/// Accepts either:
/// - `text`: Direct text to translate (use when text is not from database)
/// - `paragraph_id`: ID of paragraph to translate (loads text from database)
///
/// Exactly one of `text` or `paragraph_id` must be provided.
/// Caches results by (paragraph_id, target_lang) when paragraph_id is provided.
/// Uses LLM chat with translation prompt.
#[tauri::command]
pub async fn translate(
    app_handle: AppHandle,
    text: Option<String>,
    paragraph_id: Option<String>,
    target_lang: String,
) -> Result<String> {
    // Validate that exactly one of text or paragraph_id is provided
    match (&text, &paragraph_id) {
        (None, None) => {
            return Err(ReaderError::InvalidArgument(
                "Either 'text' or 'paragraph_id' must be provided".to_string()
            ));
        }
        (Some(_), Some(_)) => {
            return Err(ReaderError::InvalidArgument(
                "Only one of 'text' or 'paragraph_id' should be provided, not both".to_string()
            ));
        }
        _ => {}
    }

    // Load configuration
    let config = load_config()?;

    // Create LLM client
    let llm_client = LmStudioClient::new(
        config.lm_studio_url,
        config.embedding_model,
        config.chat_model,
    )?;

    // Get text to translate
    let text_to_translate = if let Some(pid) = &paragraph_id {
        // Check cache first
        let conn = get_connection(&app_handle)?;
        if let Some(cached) = get_translation(&conn, pid, &target_lang)? {
            return Ok(cached.translation);
        }

        // Load from database
        let paragraph = get_paragraph(&conn, pid)?
            .ok_or_else(|| ReaderError::NotFound(format!("Paragraph {} not found", pid)))?;
        paragraph.text
    } else {
        // Use provided text directly
        text.clone().unwrap()
    };

    // Build translation prompt
    let system_prompt = format!(
        "You are a professional translator. Translate the following text to {}. \
        Provide only the translation without any additional commentary or explanation.",
        target_lang
    );

    let messages = vec![
        ChatMessage {
            role: "system".to_string(),
            content: system_prompt,
        },
        ChatMessage {
            role: "user".to_string(),
            content: text_to_translate.clone(),
        },
    ];

    // Call LLM
    let translation = llm_client.chat(messages, 0.3, 2000).await?;

    // Cache result if we have a paragraph_id
    if let Some(pid) = &paragraph_id {
        let conn = get_connection(&app_handle)?;
        save_translation(&conn, pid, &target_lang, &translation)?;
    }

    Ok(translation)
}

/// Summarizes a document, section, or paragraph
///
/// Accepts exactly one of:
/// - `doc_id`: Summarize entire document
/// - `section_id`: Summarize a specific section
/// - `paragraph_id`: Summarize a specific paragraph
///
/// Style options:
/// - "brief": 1-2 sentences
/// - "detailed": Multiple paragraphs
/// - "bullet": Bullet point format
///
/// Caches by (target_id, type, style) for efficient reuse.
/// Uses LLM chat with style-based prompt.
#[tauri::command]
pub async fn summarize(
    app_handle: AppHandle,
    doc_id: Option<String>,
    section_id: Option<String>,
    paragraph_id: Option<String>,
    style: String,
) -> Result<String> {
    // Validate that exactly one of doc_id, section_id, or paragraph_id is provided
    let provided_count = [doc_id.is_some(), section_id.is_some(), paragraph_id.is_some()]
        .iter()
        .filter(|&&x| x)
        .count();

    if provided_count != 1 {
        return Err(ReaderError::InvalidArgument(
            "Exactly one of 'doc_id', 'section_id', or 'paragraph_id' must be provided".to_string()
        ));
    }

    // Validate style
    if !matches!(style.as_str(), "brief" | "detailed" | "bullet") {
        return Err(ReaderError::InvalidArgument(
            format!("Style must be one of: brief, detailed, bullet. Got: {}", style)
        ));
    }

    // Determine target_id and target_type, and load content
    let (target_id, target_type, content): (String, String, String) = if let Some(pid) = &paragraph_id {
        let target_id = pid.clone();
        let target_type = "paragraph".to_string();

        // Check cache first
        let conn = get_connection(&app_handle)?;
        if let Some(cached) = get_summary(&conn, &target_id, &target_type, &style)? {
            return Ok(cached.summary);
        }

        // Load paragraph
        let paragraph = get_paragraph(&conn, &target_id)?
            .ok_or_else(|| ReaderError::NotFound(format!("Paragraph {} not found", &target_id)))?;
        let content = paragraph.text;

        (target_id, target_type, content)
    } else if let Some(sid) = &section_id {
        let target_id = sid.clone();
        let target_type = "section".to_string();

        // Check cache first
        let conn = get_connection(&app_handle)?;
        if let Some(cached) = get_summary(&conn, &target_id, &target_type, &style)? {
            return Ok(cached.summary);
        }

        // Load all paragraphs in section
        use crate::database::list_paragraphs_by_section;
        let paragraphs = list_paragraphs_by_section(&conn, &target_id)?;
        if paragraphs.is_empty() {
            return Err(ReaderError::NotFound(format!("Section {} has no content", &target_id)));
        }
        let content = paragraphs
            .iter()
            .map(|p| p.text.as_str())
            .collect::<Vec<_>>()
            .join("\n\n");

        (target_id, target_type, content)
    } else if let Some(did) = &doc_id {
        let target_id = did.clone();
        let target_type = "document".to_string();

        // Check cache first
        let conn = get_connection(&app_handle)?;
        if let Some(cached) = get_summary(&conn, &target_id, &target_type, &style)? {
            return Ok(cached.summary);
        }

        // Load all paragraphs in document
        use crate::database::list_paragraphs;
        let paragraphs = list_paragraphs(&conn, &target_id)?;
        if paragraphs.is_empty() {
            return Err(ReaderError::NotFound(format!("Document {} has no content", &target_id)));
        }
        let content = paragraphs
            .iter()
            .map(|p| p.text.as_str())
            .collect::<Vec<_>>()
            .join("\n\n");

        (target_id, target_type, content)
    } else {
        unreachable!("We already validated that exactly one is provided")
    };

    // Build summarization prompt based on style
    let system_prompt = match style.as_str() {
        "brief" => {
            "You are a skilled summarizer. Create a brief summary of the following text in 1-2 sentences. \
             Focus only on the most important points. Provide only the summary without any additional commentary."
        }
        "detailed" => {
            "You are a skilled summarizer. Create a detailed summary of the following text in multiple paragraphs. \
             Cover all the main ideas and supporting points. Maintain the original structure and flow. \
             Provide only the summary without any additional commentary."
        }
        "bullet" => {
            "You are a skilled summarizer. Create a bullet-point summary of the following text. \
             Each bullet point should capture a key idea or point. Use clear, concise bullets. \
             Provide only the bullet points without any introduction or additional commentary."
        }
        _ => unreachable!("We already validated the style")
    };

    let messages = vec![
        ChatMessage {
            role: "system".to_string(),
            content: system_prompt.to_string(),
        },
        ChatMessage {
            role: "user".to_string(),
            content,
        },
    ];

    // Load configuration
    let config = load_config()?;

    // Create LLM client
    let llm_client = LmStudioClient::new(
        config.lm_studio_url,
        config.embedding_model,
        config.chat_model,
    )?;

    // Call LLM with appropriate max_tokens based on style
    let max_tokens = match style.as_str() {
        "brief" => 300,
        "detailed" => 2000,
        "bullet" => 1000,
        _ => 1000,
    };

    let summary = llm_client.chat(messages, 0.5, max_tokens).await?;

    // Cache result
    let conn = get_connection(&app_handle)?;
    save_summary(&conn, &target_id, &target_type, &style, &summary)?;

    Ok(summary)
}

/// Returns a cached summary without calling the LLM.
///
/// Accepts exactly one of:
/// - `doc_id`
/// - `section_id`
/// - `paragraph_id`
#[tauri::command]
pub async fn get_summary_cache(
    app_handle: AppHandle,
    doc_id: Option<String>,
    section_id: Option<String>,
    paragraph_id: Option<String>,
    style: String,
) -> Result<Option<String>> {
    let provided_count = [doc_id.is_some(), section_id.is_some(), paragraph_id.is_some()]
        .iter()
        .filter(|&&x| x)
        .count();

    if provided_count != 1 {
        return Err(ReaderError::InvalidArgument(
            "Exactly one of 'doc_id', 'section_id', or 'paragraph_id' must be provided".to_string()
        ));
    }

    if !matches!(style.as_str(), "brief" | "detailed" | "bullet") {
        return Err(ReaderError::InvalidArgument(
            format!("Style must be one of: brief, detailed, bullet. Got: {}", style)
        ));
    }

    let (target_id, target_type): (String, String) = if let Some(pid) = paragraph_id {
        (pid, "paragraph".to_string())
    } else if let Some(sid) = section_id {
        (sid, "section".to_string())
    } else if let Some(did) = doc_id {
        (did, "document".to_string())
    } else {
        unreachable!("We already validated that exactly one is provided")
    };

    let conn = get_connection(&app_handle)?;
    let cached = get_summary(&conn, &target_id, &target_type, &style)?;
    Ok(cached.map(|c| c.summary))
}
