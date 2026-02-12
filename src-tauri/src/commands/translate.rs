use crate::config::load_config;
use crate::database::{
    get_connection, get_paragraph, get_summary, get_text_translation, get_translation,
    save_summary, save_text_translation, save_translation,
};
use crate::error::{ReaderError, Result};
use crate::llm::{create_client, ChatMessage};
use sha2::{Digest, Sha256};
use tauri::AppHandle;
use tokio::time::{timeout, Duration};

const TRANSLATE_TIMEOUT_SECS: u64 = 30;
const CHAT_TIMEOUT_SECS: u64 = 45;

#[derive(Debug, Clone, serde::Deserialize)]
pub struct ChatTurnInput {
    pub role: String,
    pub content: String,
}

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
    fn hash_text(value: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(value.as_bytes());
        format!("{:x}", hasher.finalize())
    }

    // Validate that exactly one of text or paragraph_id is provided
    match (&text, &paragraph_id) {
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

    // Load configuration and create LLM client
    let config = load_config()?;
    let llm_client = create_client(&config)?;

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
        // Use provided text directly with text-hash cache
        let raw_text = text.clone().unwrap();
        let text_hash = hash_text(&raw_text);
        let conn = get_connection(&app_handle)?;
        if let Some(cached) = get_text_translation(&conn, &text_hash, &target_lang)? {
            return Ok(cached.translation);
        }
        raw_text
    };

    // Build translation prompt
    let target_lang_name = match target_lang.as_str() {
        "zh" => "Chinese",
        "en" => "English",
        _ => &target_lang,
    };

    let system_prompt = format!(
        "You are a professional translator. Translate the following text to {}. \
        If the input contains Markdown, preserve the original Markdown structure and syntax \
        (headings, lists, links, code blocks, tables) while translating natural language text. \
        Provide only the translation without any additional commentary or explanation.",
        target_lang_name
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

    // Call LLM with timeout to avoid endless "translating" state in UI
    let translation = timeout(
        Duration::from_secs(TRANSLATE_TIMEOUT_SECS),
        llm_client.chat(messages, 0.3, 2000),
    )
    .await
    .map_err(|_| {
        ReaderError::ModelApi(format!(
            "Translation request timed out after {} seconds",
            TRANSLATE_TIMEOUT_SECS
        ))
    })??;

    // Cache result if we have a paragraph_id
    if let Some(pid) = &paragraph_id {
        let conn = get_connection(&app_handle)?;
        save_translation(&conn, pid, &target_lang, &translation)?;
    } else if let Some(raw_text) = &text {
        let conn = get_connection(&app_handle)?;
        let text_hash = hash_text(raw_text);
        save_text_translation(&conn, &text_hash, &target_lang, &translation)?;
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
    let provided_count = [
        doc_id.is_some(),
        section_id.is_some(),
        paragraph_id.is_some(),
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
    if !matches!(style.as_str(), "brief" | "detailed" | "bullet") {
        return Err(ReaderError::InvalidArgument(format!(
            "Style must be one of: brief, detailed, bullet. Got: {}",
            style
        )));
    }

    // Determine target_id and target_type, and load content
    let (target_id, target_type, content): (String, String, String) = if let Some(pid) =
        &paragraph_id
    {
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
            return Err(ReaderError::NotFound(format!(
                "Section {} has no content",
                &target_id
            )));
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
            return Err(ReaderError::NotFound(format!(
                "Document {} has no content",
                &target_id
            )));
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

    // Load configuration and create LLM client
    let config = load_config()?;
    let llm_client = create_client(&config)?;

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
    let provided_count = [
        doc_id.is_some(),
        section_id.is_some(),
        paragraph_id.is_some(),
    ]
    .iter()
    .filter(|&&x| x)
    .count();

    if provided_count != 1 {
        return Err(ReaderError::InvalidArgument(
            "Exactly one of 'doc_id', 'section_id', or 'paragraph_id' must be provided".to_string(),
        ));
    }

    if !matches!(style.as_str(), "brief" | "detailed" | "bullet") {
        return Err(ReaderError::InvalidArgument(format!(
            "Style must be one of: brief, detailed, bullet. Got: {}",
            style
        )));
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

/// Deep analysis pipeline for document/section/paragraph.
///
/// Output is structured in markdown and follows a fixed analysis template:
/// concepts, definitions, concept relations, COT-style logic, facts vs opinions,
/// FAQ, visualizations (mermaid), analogies, and quote highlights.
#[tauri::command]
pub async fn deep_analyze(
    app_handle: AppHandle,
    doc_id: Option<String>,
    section_id: Option<String>,
    paragraph_id: Option<String>,
) -> Result<String> {
    let provided_count = [
        doc_id.is_some(),
        section_id.is_some(),
        paragraph_id.is_some(),
    ]
    .iter()
    .filter(|&&x| x)
    .count();

    if provided_count != 1 {
        return Err(ReaderError::InvalidArgument(
            "Exactly one of 'doc_id', 'section_id', or 'paragraph_id' must be provided".to_string(),
        ));
    }

    let analysis_style = "deep_pipeline_v1";

    let (target_id, target_type, content): (String, String, String) = if let Some(pid) =
        &paragraph_id
    {
        let target_id = pid.clone();
        let target_type = "paragraph".to_string();
        let conn = get_connection(&app_handle)?;
        if let Some(cached) = get_summary(&conn, &target_id, &target_type, analysis_style)? {
            return Ok(cached.summary);
        }
        let paragraph = get_paragraph(&conn, &target_id)?
            .ok_or_else(|| ReaderError::NotFound(format!("Paragraph {} not found", &target_id)))?;
        (target_id, target_type, paragraph.text)
    } else if let Some(sid) = &section_id {
        let target_id = sid.clone();
        let target_type = "section".to_string();
        let conn = get_connection(&app_handle)?;
        if let Some(cached) = get_summary(&conn, &target_id, &target_type, analysis_style)? {
            return Ok(cached.summary);
        }
        use crate::database::list_paragraphs_by_section;
        let paragraphs = list_paragraphs_by_section(&conn, &target_id)?;
        if paragraphs.is_empty() {
            return Err(ReaderError::NotFound(format!(
                "Section {} has no content",
                &target_id
            )));
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
        let conn = get_connection(&app_handle)?;
        if let Some(cached) = get_summary(&conn, &target_id, &target_type, analysis_style)? {
            return Ok(cached.summary);
        }
        use crate::database::list_paragraphs;
        let paragraphs = list_paragraphs(&conn, &target_id)?;
        if paragraphs.is_empty() {
            return Err(ReaderError::NotFound(format!(
                "Document {} has no content",
                &target_id
            )));
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

    let system_prompt = r#"你是一个严格的“信息深度分析引擎”。请仅基于给定文本输出 Markdown，禁止臆测。

必须输出以下章节（按顺序）：
## 1) 概念清单（中英文）
- 列举文本中的名词性成分/概念
- 每项格式：`- 中文名（English）`

## 2) 概念定义（中英文）
- 对第1节每个概念给出简明定义
- 每项格式：`- 中文名（English）：定义...`

## 3) 概念关系（中英文）
- 给出概念间关系（包含等式/方程/逻辑表达，如适用）
- 优先使用：包含、并列、因果、推导、约束、假设-结论

## 4) COT逻辑梳理（显式步骤）
- 用编号步骤给出：定义 -> 分类 -> 比较 -> 因果 -> 科学方法论
- 每步最多3行，强调可验证性

## 5) 事实与看法（病毒）
### 5.1 事实
- 仅可被文本直接支持的事实
### 5.2 看法
- 作者观点、推测、价值判断

## 6) FAQ（由文中问题整理）
- 提取显式或隐式问题并给出简答
- 格式：`Q: ...` / `A: ...`

## 7) Visualization
- 先给一段“图示索引”说明每张图主题
- 然后给多个独立 mermaid 代码块
- 每个代码块使用单独 `subgraph`，一个 subgraph 表示一张图
- 至少包含：概念图、因果链图、方法流程图（若文本支持）

## 8) 类比清单
- 列举文中出现的所有类比，若无则写“未发现明确类比”

## 9) 金句（10条）
- 给出10条高价值句子（若原文不足10条，尽量接近并注明不足）
- 每条后补一句“意义解读”

输出要求：
- 语言：中文为主，概念名必须中英双语
- 严禁输出与文本无关内容
- 保留结构化层级，便于后续程序处理"#;

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

    let config = load_config()?;
    let llm_client = create_client(&config)?;
    let analysis = llm_client.chat(messages, 0.3, 3600).await?;

    let conn = get_connection(&app_handle)?;
    save_summary(&conn, &target_id, &target_type, analysis_style, &analysis)?;

    Ok(analysis)
}

#[tauri::command]
pub async fn chat_with_context(
    app_handle: AppHandle,
    question: String,
    doc_id: Option<String>,
    section_id: Option<String>,
    paragraph_id: Option<String>,
    history: Option<Vec<ChatTurnInput>>,
) -> Result<String> {
    let q = question.trim();
    if q.is_empty() {
        return Err(ReaderError::InvalidArgument(
            "Question cannot be empty".to_string(),
        ));
    }

    let provided_count = [
        doc_id.is_some(),
        section_id.is_some(),
        paragraph_id.is_some(),
    ]
    .iter()
    .filter(|&&x| x)
    .count();

    if provided_count != 1 {
        return Err(ReaderError::InvalidArgument(
            "Exactly one of 'doc_id', 'section_id', or 'paragraph_id' must be provided".to_string(),
        ));
    }

    let conn = get_connection(&app_handle)?;
    let (context_scope, context_text) = if let Some(pid) = &paragraph_id {
        let p = get_paragraph(&conn, pid)?
            .ok_or_else(|| ReaderError::NotFound(format!("Paragraph {} not found", pid)))?;
        ("Current paragraph".to_string(), p.text)
    } else if let Some(sid) = &section_id {
        use crate::database::list_paragraphs_by_section;
        let paragraphs = list_paragraphs_by_section(&conn, sid)?;
        if paragraphs.is_empty() {
            return Err(ReaderError::NotFound(format!("Section {} has no content", sid)));
        }
        let text = paragraphs
            .iter()
            .map(|p| p.text.as_str())
            .collect::<Vec<_>>()
            .join("\n\n");
        ("Current section".to_string(), text)
    } else if let Some(did) = &doc_id {
        use crate::database::list_paragraphs;
        let paragraphs = list_paragraphs(&conn, did)?;
        if paragraphs.is_empty() {
            return Err(ReaderError::NotFound(format!("Document {} has no content", did)));
        }
        let text = paragraphs
            .iter()
            .take(180)
            .map(|p| p.text.as_str())
            .collect::<Vec<_>>()
            .join("\n\n");
        ("Current document".to_string(), text)
    } else {
        unreachable!("validated above")
    };

    let max_context_chars = 24_000;
    let trimmed_context = context_text.chars().take(max_context_chars).collect::<String>();

    let mut messages = vec![
        ChatMessage {
            role: "system".to_string(),
            content: "You are a reading assistant for QA over a document context. Answer based only on the provided context. If context is insufficient, say what is missing and do not fabricate. Keep answers concise, accurate, and directly actionable.".to_string(),
        },
        ChatMessage {
            role: "system".to_string(),
            content: format!(
                "Context scope: {}\nContext content:\n{}",
                context_scope, trimmed_context
            ),
        },
    ];

    if let Some(hist) = history {
        for turn in hist.into_iter().rev().take(8).collect::<Vec<_>>().into_iter().rev() {
            let role = turn.role.to_lowercase();
            if !matches!(role.as_str(), "user" | "assistant") {
                continue;
            }
            let content = turn.content.trim();
            if content.is_empty() {
                continue;
            }
            messages.push(ChatMessage {
                role,
                content: content.to_string(),
            });
        }
    }

    messages.push(ChatMessage {
        role: "user".to_string(),
        content: q.to_string(),
    });

    let config = load_config()?;
    let llm_client = create_client(&config)?;

    let answer = timeout(
        Duration::from_secs(CHAT_TIMEOUT_SECS),
        llm_client.chat(messages, 0.2, 1200),
    )
    .await
    .map_err(|_| {
        ReaderError::ModelApi(format!(
            "Chat request timed out after {} seconds",
            CHAT_TIMEOUT_SECS
        ))
    })??;

    Ok(answer)
}
