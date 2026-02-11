use crate::database;
use crate::error::{ReaderError, Result};
use crate::parsers::{EpubParser, MarkdownParser, PdfParser};
use reqwest::Url;
use std::collections::HashSet;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tokio::time::Duration;

#[derive(Clone, serde::Serialize)]
pub struct ImportProgress {
    pub current: usize,
    pub total: usize,
    pub message: String,
}

#[tauri::command]
pub async fn import_epub(app_handle: AppHandle, file_path: String) -> Result<String> {
    let mut parser = EpubParser::new(&file_path)?;
    let (metadata, chapters) = parser.parse_all()?;
    import_document_internal(app_handle, metadata, chapters).await
}

#[tauri::command]
pub async fn import_pdf(app_handle: AppHandle, file_path: String) -> Result<String> {
    let parser = PdfParser::new(&file_path)?;
    let (metadata, chapters) = parser.parse_all()?;
    import_document_internal(app_handle, metadata, chapters).await
}

#[tauri::command]
pub async fn import_markdown(app_handle: AppHandle, file_path: String) -> Result<String> {
    let parser = MarkdownParser::new(&file_path)?;
    let (metadata, chapters) = parser.parse_all()?;
    import_document_internal(app_handle, metadata, chapters).await
}

#[tauri::command]
pub async fn import_url(app_handle: AppHandle, url: String) -> Result<String> {
    let normalized_url = normalize_http_url(&url)?;
    let reader_url = format!("https://r.jina.ai/{}", normalized_url.as_str());

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("reader/0.3.5")
        .build()
        .map_err(|e| ReaderError::ModelApi(format!("Failed to create HTTP client: {}", e)))?;

    let response = client
        .get(&reader_url)
        .send()
        .await
        .map_err(|e| ReaderError::ModelApi(format!("Failed to fetch URL via jina reader: {}", e)))?;

    if !response.status().is_success() {
        return Err(ReaderError::ModelApi(format!(
            "URL fetch failed with status {}",
            response.status()
        )));
    }

    let text = response
        .text()
        .await
        .map_err(|e| ReaderError::ModelApi(format!("Failed to read fetched content: {}", e)))?;
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err(ReaderError::ModelApi(
            "Fetched content is empty. The source site may block extraction.".to_string(),
        ));
    }
    if trimmed.len() > 2_000_000 {
        return Err(ReaderError::ModelApi(
            "Fetched content is too large (over 2MB)".to_string(),
        ));
    }

    let metadata = extract_reader_metadata(trimmed);
    let extracted_title = metadata
        .title
        .clone()
        .unwrap_or_else(|| inferred_title_from_url(&normalized_url));
    let cleaned_body = extract_and_clean_reader_markdown(trimmed);
    if cleaned_body.trim().is_empty() {
        return Err(ReaderError::ModelApi(
            "No readable article body found after cleanup. The source may block content extraction."
                .to_string(),
        ));
    }
    let summary = build_body_summary(&cleaned_body);
    let media_links = extract_media_links(&cleaned_body);
    let media_section = if media_links.is_empty() {
        "_No key image/video links detected._".to_string()
    } else {
        media_links
            .iter()
            .map(|link| format!("- {}", link))
            .collect::<Vec<_>>()
            .join("\n")
    };
    let author = metadata.author.unwrap_or_else(|| "Unknown".to_string());
    let published = metadata
        .published_time
        .unwrap_or_else(|| "Unknown".to_string());

    let markdown = format!(
        "# {}\n\n\
         > Source: {}\n\
         > Author: {}\n\
         > Published: {}\n\n\
         ## Summary\n\n\
         {}\n\n\
         ## Media Links\n\n\
         {}\n\n\
         ## Content\n\n\
         {}",
        extracted_title,
        normalized_url,
        author,
        published,
        summary,
        media_section,
        cleaned_body
    );

    let markdown_path = build_import_markdown_path(&app_handle, &normalized_url)?;
    if let Some(parent) = markdown_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&markdown_path, markdown)?;

    import_markdown(app_handle, markdown_path.to_string_lossy().to_string()).await
}

#[tauri::command]
pub async fn fetch_url_html(url: String) -> Result<String> {
    let normalized_url = normalize_http_url(&url)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("reader/0.3.5")
        .build()
        .map_err(|e| ReaderError::ModelApi(format!("Failed to create HTTP client: {}", e)))?;
    let response = client
        .get(normalized_url.clone())
        .send()
        .await
        .map_err(|e| ReaderError::ModelApi(format!("Failed to fetch URL: {}", e)))?;
    if !response.status().is_success() {
        return Err(ReaderError::ModelApi(format!(
            "URL fetch failed with status {}",
            response.status()
        )));
    }
    response
        .text()
        .await
        .map_err(|e| ReaderError::ModelApi(format!("Failed to read fetched HTML: {}", e)))
}

#[tauri::command]
pub async fn import_markdown_content(
    app_handle: AppHandle,
    title: Option<String>,
    source_url: Option<String>,
    content: String,
) -> Result<String> {
    let safe_title = title
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Imported Article".to_string());
    let source_url_normalized = source_url
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .and_then(|s| normalize_http_url(&s).ok())
        .map(|u| u.to_string());
    let source_block = source_url_normalized
        .clone()
        .map(|s| format!("> Source: {}\n\n", s))
        .unwrap_or_default();

    let markdown = format!("# {}\n\n{}{}", safe_title, source_block, content.trim());

    let markdown_path = build_import_markdown_path(
        &app_handle,
        &normalize_http_url(source_url_normalized.as_deref().unwrap_or("https://example.com"))?,
    )?;
    if let Some(parent) = markdown_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&markdown_path, markdown)?;

    import_markdown(app_handle, markdown_path.to_string_lossy().to_string()).await
}

async fn import_document_internal(
    app_handle: AppHandle,
    metadata: crate::models::NewDocument,
    chapters: Vec<(String, i32, String, Vec<String>)>,
) -> Result<String> {
    // Get database connection
    let conn = database::get_connection(&app_handle)?;

    // Start transaction for data integrity
    let tx = conn.unchecked_transaction()?;

    // Insert document
    let doc = database::insert_document(&tx, metadata)?;

    tracing::info!(
        "Importing document {} with {} chapters",
        doc.id,
        chapters.len()
    );

    // Insert sections and paragraphs
    for (title, order_index, href, paragraphs) in chapters {
        tracing::info!(
            "Processing chapter {}: {} ({} paragraphs)",
            title,
            href,
            paragraphs.len()
        );

        let section = database::insert_section(&tx, &doc.id, &title, order_index, &href)?;

        for (para_order, para_text) in paragraphs.iter().enumerate() {
            let location = format!("{}#p{}", href, para_order);
            database::insert_paragraph(
                &tx,
                &doc.id,
                &section.id,
                para_order as i32,
                para_text,
                &location,
            )?;
        }

        tracing::info!(
            "Inserted {} paragraphs for section {}",
            paragraphs.len(),
            section.id
        );
    }

    // Commit transaction to save all changes atomically
    tx.commit()?;

    tracing::info!("Document import completed successfully");
    Ok(doc.id)
}

#[tauri::command]
pub async fn list_documents(app_handle: AppHandle) -> Result<Vec<crate::models::Document>> {
    let conn = database::get_connection(&app_handle)?;
    let docs = database::list_documents(&conn)?;
    Ok(docs)
}

#[tauri::command]
pub async fn get_document(
    app_handle: AppHandle,
    id: String,
) -> Result<Option<crate::models::Document>> {
    let conn = database::get_connection(&app_handle)?;
    let doc = database::get_document(&conn, &id)?;
    Ok(doc)
}

#[tauri::command]
pub async fn delete_document(app_handle: AppHandle, id: String) -> Result<()> {
    let conn = database::get_connection(&app_handle)?;
    database::delete_document(&conn, &id)?;
    Ok(())
}

#[tauri::command]
pub async fn get_document_sections(
    app_handle: AppHandle,
    doc_id: String,
) -> Result<Vec<crate::models::Section>> {
    let conn = database::get_connection(&app_handle)?;
    let sections = database::list_sections(&conn, &doc_id)?;
    Ok(sections)
}

#[tauri::command]
pub async fn get_section_paragraphs(
    app_handle: AppHandle,
    section_id: String,
) -> Result<Vec<crate::models::Paragraph>> {
    let conn = database::get_connection(&app_handle)?;
    let paragraphs = database::list_paragraphs_by_section(&conn, &section_id)?;
    Ok(paragraphs)
}

fn normalize_http_url(input: &str) -> Result<Url> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(ReaderError::InvalidArgument("URL cannot be empty".to_string()));
    }

    let with_scheme = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{}", trimmed)
    };

    let parsed = Url::parse(&with_scheme)
        .map_err(|e| ReaderError::InvalidArgument(format!("Invalid URL: {}", e)))?;
    match parsed.scheme() {
        "http" | "https" => Ok(parsed),
        _ => Err(ReaderError::InvalidArgument(
            "Only http/https URLs are supported".to_string(),
        )),
    }
}

fn inferred_title_from_url(url: &Url) -> String {
    let host = url.host_str().unwrap_or("web");
    let tail = url
        .path_segments()
        .and_then(|mut segs| segs.next_back())
        .filter(|s| !s.is_empty())
        .unwrap_or("article");
    let tail = tail.replace('-', " ").replace('_', " ");
    format!("{} - {}", host, tail)
}

#[derive(Default)]
struct ReaderMetadata {
    title: Option<String>,
    author: Option<String>,
    published_time: Option<String>,
}

fn extract_reader_metadata(text: &str) -> ReaderMetadata {
    let mut meta = ReaderMetadata::default();
    for line in text.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("Title:") {
            let title = rest.trim();
            if !title.is_empty() {
                meta.title = Some(title.to_string());
            }
        } else if let Some(rest) = trimmed.strip_prefix("Author:") {
            let author = rest.trim();
            if !author.is_empty() {
                meta.author = Some(author.to_string());
            }
        } else if let Some(rest) = trimmed.strip_prefix("Published Time:") {
            let published = rest.trim();
            if !published.is_empty() {
                meta.published_time = Some(published.to_string());
            }
        }
    }
    meta
}

fn extract_and_clean_reader_markdown(text: &str) -> String {
    let mut lines: Vec<String> = Vec::new();
    let mut in_markdown_block = false;

    for raw in text.lines() {
        let line = raw.trim_end_matches('\r');
        let trimmed = line.trim();

        if !in_markdown_block {
            if let Some(rest) = trimmed.strip_prefix("Markdown Content:") {
                in_markdown_block = true;
                let first = rest.trim();
                if !first.is_empty() {
                    lines.push(first.to_string());
                }
            }
            continue;
        }

        lines.push(line.to_string());
    }

    if !in_markdown_block {
        lines = text.lines().map(|s| s.to_string()).collect();
    }

    let mut cleaned: Vec<String> = Vec::new();
    for line in lines {
        if is_reader_noise_line(&line) {
            continue;
        }
        cleaned.push(line);
    }

    let trimmed = trim_leading_noise_block(&cleaned);
    let pruned = prune_navigation_clusters(&trimmed);
    collapse_blank_lines(&pruned)
}

fn is_reader_noise_line(line: &str) -> bool {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return false;
    }
    let lower = trimmed.to_ascii_lowercase();

    if lower.starts_with("source:")
        || lower.starts_with("title:")
        || lower.starts_with("url source:")
        || lower.starts_with("published time:")
        || lower.starts_with("markdown content:")
    {
        return true;
    }

    if lower.starts_with("image ")
        || lower == "close"
        || lower == "primary navigation"
        || lower == "search the blog"
        || lower == "api dashboard"
        || lower == "all posts"
        || lower == "using codex"
        || lower == "使用 codex"
    {
        return true;
    }

    const NAV_TOKENS: &[&str] = &[
        "home",
        "api",
        "docs",
        "codex",
        "chatgpt",
        "learn",
        "resources",
        "getting started",
        "overview",
        "quickstart",
        "explore",
        "pricing",
        "ambassadors",
        "concepts",
        "integrations",
        "configuration",
        "commands",
        "troubleshooting",
        "features",
        "settings",
        "using codex",
        "app",
        "ide extension",
        "cli",
        "web",
        "rules",
        "skills",
        "administration",
        "authentication",
        "security",
        "enterprise",
        "automation",
        "non-interactive mode",
        "codex sdk",
        "app server",
        "mcp server",
        "github action",
        "videos",
        "blog",
        "cookbooks",
        "releases",
        "changelog",
        "feature maturity",
        "open source",
        "commerce",
        "github",
        "slack",
        "linear",
        "config file",
        "config basics",
        "advanced config",
        "config reference",
        "sample config",
        "使用 codex",
        "应用程序",
        "概述",
        "功能",
        "设置",
        "评价",
        "自动化任务",
        "工作流程",
        "本地环境",
        "命令",
        "故障排除",
        "快捷命令",
        "命令行选项",
        "斜杠命令",
    ];
    if NAV_TOKENS.iter().any(|token| lower == *token) {
        return true;
    }

    if trimmed.contains(" * ") && !contains_sentence_punctuation(trimmed) {
        return true;
    }

    if trimmed.starts_with("* ") {
        let body = trimmed.trim_start_matches("* ").trim();
        let body_lower = body.to_ascii_lowercase();
        if NAV_TOKENS
            .iter()
            .any(|token| body_lower == *token || body == *token)
        {
            return true;
        }
    }

    // Typical menu row: many short UI words, no sentence punctuation.
    let words: Vec<&str> = trimmed.split_whitespace().collect();
    if words.len() >= 5 && words.len() <= 16 && !contains_sentence_punctuation(trimmed) {
        let short_words = words.iter().filter(|w| w.len() <= 12).count();
        if short_words * 100 / words.len() >= 90 {
            let nav_hits = words
                .iter()
                .filter(|w| {
                    let wl = w.to_ascii_lowercase();
                    NAV_TOKENS
                        .iter()
                        .any(|token| wl == *token || token.split_whitespace().any(|t| t == wl))
                })
                .count();
            if nav_hits >= 2 {
                return true;
            }
        }
    }

    false
}

fn prune_navigation_clusters(lines: &[String]) -> Vec<String> {
    let mut out = Vec::with_capacity(lines.len());
    let mut i = 0usize;

    while i < lines.len() {
        let mut j = i;
        while j < lines.len() && !lines[j].trim().is_empty() {
            j += 1;
        }
        // cluster: [i, j)
        if j > i {
            let cluster = &lines[i..j];
            if !looks_like_navigation_cluster(cluster) {
                out.extend_from_slice(cluster);
            }
        }
        if j < lines.len() {
            out.push(lines[j].clone());
        }
        i = j + 1;
    }

    out
}

fn looks_like_navigation_cluster(cluster: &[String]) -> bool {
    if cluster.is_empty() {
        return false;
    }

    let mut nav_like = 0usize;
    let mut bullet_like = 0usize;
    let mut sentence_like = 0usize;

    for line in cluster {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if is_reader_noise_line(trimmed) {
            nav_like += 1;
            continue;
        }
        if trimmed.starts_with("* ") || trimmed.contains(" * ") {
            bullet_like += 1;
            nav_like += 1;
        }
        if contains_sentence_punctuation(trimmed) || trimmed.split_whitespace().count() >= 14 {
            sentence_like += 1;
        }
    }

    let len = cluster.iter().filter(|l| !l.trim().is_empty()).count();
    if len == 0 {
        return false;
    }

    // Drop long menu-like blocks: many nav/bullet lines, very few sentence lines.
    (len >= 4 && nav_like * 100 / len >= 60 && sentence_like == 0)
        || (len >= 6 && bullet_like * 100 / len >= 40 && sentence_like <= 1)
}

fn trim_leading_noise_block(lines: &[String]) -> Vec<String> {
    let mut start = 0usize;
    let mut found_start = false;
    for (idx, line) in lines.iter().enumerate() {
        if is_probable_article_line(line) {
            start = idx;
            found_start = true;
            break;
        }
    }
    if !found_start {
        return lines.to_vec();
    }
    lines[start..].to_vec()
}

fn is_probable_article_line(line: &str) -> bool {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return false;
    }
    if trimmed.starts_with('#') && trimmed.len() >= 8 {
        return true;
    }
    let words = trimmed.split_whitespace().count();
    if words >= 8 && contains_sentence_punctuation(trimmed) {
        return true;
    }
    trimmed.chars().count() >= 80
}

fn contains_sentence_punctuation(text: &str) -> bool {
    text.chars()
        .any(|c| matches!(c, '.' | ',' | ';' | ':' | '!' | '?' | '。' | '，' | '；' | '：' | '！' | '？'))
}

fn collapse_blank_lines(lines: &[String]) -> String {
    let mut out = String::new();
    let mut previous_blank = false;

    for line in lines {
        let trimmed_end = line.trim_end();
        let is_blank = trimmed_end.trim().is_empty();
        if is_blank {
            if previous_blank {
                continue;
            }
            previous_blank = true;
            out.push('\n');
            continue;
        }
        previous_blank = false;
        out.push_str(trimmed_end);
        out.push('\n');
    }

    out.trim().to_string()
}

fn build_body_summary(body: &str) -> String {
    let mut paragraphs = Vec::new();
    for part in body.split("\n\n") {
        let p = part.trim();
        if p.is_empty() || p.starts_with('#') || p.starts_with('>') {
            continue;
        }
        if p.starts_with("- ") || p.starts_with("* ") {
            continue;
        }
        paragraphs.push(p.to_string());
        if paragraphs.len() >= 2 {
            break;
        }
    }
    if paragraphs.is_empty() {
        "_No clear summary could be extracted._".to_string()
    } else {
        paragraphs.join("\n\n")
    }
}

fn extract_media_links(body: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();

    for raw in body.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }

        if let Some(start) = line.find("](") {
            let url_part = &line[start + 2..];
            if let Some(end) = url_part.find(')') {
                let candidate = url_part[..end].trim();
                if is_media_url(candidate) && seen.insert(candidate.to_string()) {
                    out.push(candidate.to_string());
                }
            }
        }

        for token in line.split_whitespace() {
            let token = token.trim_matches(|c: char| matches!(c, '(' | ')' | '[' | ']' | '"' | '\''));
            if is_media_url(token) && seen.insert(token.to_string()) {
                out.push(token.to_string());
            }
        }
    }

    out
}

fn is_media_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return false;
    }
    lower.ends_with(".png")
        || lower.ends_with(".jpg")
        || lower.ends_with(".jpeg")
        || lower.ends_with(".gif")
        || lower.ends_with(".webp")
        || lower.ends_with(".svg")
        || lower.ends_with(".mp4")
        || lower.ends_with(".mov")
        || lower.contains("youtube.com/watch")
        || lower.contains("youtu.be/")
        || lower.contains("vimeo.com/")
}

fn build_import_markdown_path(app_handle: &AppHandle, url: &Url) -> Result<PathBuf> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| ReaderError::Internal(format!("Failed to resolve app data dir: {}", e)))?;

    let safe_host = url.host_str().unwrap_or("web").replace('.', "_");
    let safe_tail = url
        .path_segments()
        .and_then(|mut segs| segs.next_back())
        .filter(|s| !s.is_empty())
        .unwrap_or("article")
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '-' | '_') {
                c
            } else {
                '_'
            }
        })
        .collect::<String>();
    let ts = chrono::Utc::now().timestamp();

    Ok(app_data_dir
        .join("imports")
        .join("url")
        .join(format!("{}_{}_{}.md", safe_host, safe_tail, ts)))
}
