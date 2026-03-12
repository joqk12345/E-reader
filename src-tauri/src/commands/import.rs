use crate::database;
use crate::error::{ReaderError, Result};
use crate::parsers::{EpubParser, MarkdownParser, ParsedChapters, PdfParser};
use regex::Regex;
use reqwest::Url;
use std::collections::HashSet;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tokio::time::Duration;

#[allow(dead_code)]
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

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("reader/0.3.5")
        .build()
        .map_err(|e| ReaderError::ModelApi(format!("Failed to create HTTP client: {}", e)))?;

    let (extracted_title, author, published, cleaned_body) = if is_arxiv_html_url(&normalized_url)
    {
        let html = fetch_text_with_client(&client, &normalized_url, "Failed to fetch arXiv HTML")
            .await?;
        let converted = convert_arxiv_html_to_markdown(&normalized_url, &html)?;
        (
            converted.title,
            converted.author.unwrap_or_else(|| "Unknown".to_string()),
            "Unknown".to_string(),
            converted.body,
        )
    } else {
        let reader_url = Url::parse(&format!("https://r.jina.ai/{}", normalized_url.as_str()))
            .map_err(|e| ReaderError::ModelApi(format!("Invalid jina reader URL: {}", e)))?;
        let text =
            fetch_text_with_client(&client, &reader_url, "Failed to fetch URL via jina reader")
                .await?;
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
        (
            metadata
                .title
                .clone()
                .unwrap_or_else(|| inferred_title_from_url(&normalized_url)),
            metadata.author.unwrap_or_else(|| "Unknown".to_string()),
            metadata
                .published_time
                .unwrap_or_else(|| "Unknown".to_string()),
            extract_and_clean_reader_markdown(trimmed),
        )
    };

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
        extracted_title, normalized_url, author, published, summary, media_section, cleaned_body
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
        &normalize_http_url(
            source_url_normalized
                .as_deref()
                .unwrap_or("https://example.com"),
        )?,
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
    chapters: ParsedChapters,
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

#[derive(Debug, Clone, serde::Serialize)]
pub struct DocumentPreview {
    pub doc_id: String,
    pub preview: String,
}

#[tauri::command]
pub async fn get_document_previews(
    app_handle: AppHandle,
    doc_ids: Vec<String>,
    max_chars: usize,
) -> Result<Vec<DocumentPreview>> {
    let conn = database::get_connection(&app_handle)?;
    let char_limit = max_chars.clamp(160, 4000);
    let mut previews = Vec::new();

    let mut stmt = conn.prepare(
        "SELECT p.text
         FROM paragraphs p
         JOIN sections s ON p.section_id = s.id
         WHERE p.doc_id = ?1
         ORDER BY s.order_index, p.order_index
         LIMIT 12",
    )?;

    for doc_id in doc_ids {
        let rows = stmt.query_map([&doc_id], |row| row.get::<_, String>(0))?;
        let mut merged = String::new();
        for row in rows {
            let text = row.unwrap_or_default();
            let normalized = text.split_whitespace().collect::<Vec<_>>().join(" ");
            if normalized.is_empty() {
                continue;
            }
            if !merged.is_empty() {
                merged.push(' ');
            }
            merged.push_str(&normalized);
            if merged.chars().count() >= char_limit {
                break;
            }
        }

        let preview = merged.chars().take(char_limit).collect::<String>();
        previews.push(DocumentPreview { doc_id, preview });
    }

    Ok(previews)
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
pub async fn get_document_source_url(
    app_handle: AppHandle,
    doc_id: String,
) -> Result<Option<String>> {
    let conn = database::get_connection(&app_handle)?;
    let Some(doc) = database::get_document(&conn, &doc_id)? else {
        return Ok(None);
    };

    if doc.file_type != "markdown" {
        return Ok(None);
    }

    let content = match std::fs::read_to_string(&doc.file_path) {
        Ok(value) => value,
        Err(_) => return Ok(None),
    };

    Ok(extract_source_url_from_markdown(&content))
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

#[derive(Default)]
struct ArxivMarkdownDocument {
    title: String,
    author: Option<String>,
    body: String,
}

#[derive(Clone, Debug)]
struct ArxivTableCell {
    text: String,
    colspan: usize,
    rowspan: usize,
}

#[derive(Clone, Debug)]
struct ExpandedArxivTableCell {
    text: String,
    origin_row: usize,
    origin_col: usize,
}

async fn fetch_text_with_client(
    client: &reqwest::Client,
    url: &Url,
    error_prefix: &str,
) -> Result<String> {
    let response = client
        .get(url.clone())
        .send()
        .await
        .map_err(|e| ReaderError::ModelApi(format!("{}: {}", error_prefix, e)))?;
    if !response.status().is_success() {
        return Err(ReaderError::ModelApi(format!(
            "{} with status {}",
            error_prefix,
            response.status()
        )));
    }
    response
        .text()
        .await
        .map_err(|e| ReaderError::ModelApi(format!("Failed to read fetched content: {}", e)))
}

fn is_arxiv_html_url(url: &Url) -> bool {
    matches!(url.host_str(), Some("arxiv.org") | Some("www.arxiv.org"))
        && url.path().starts_with("/html/")
}

fn convert_arxiv_html_to_markdown(base_url: &Url, html: &str) -> Result<ArxivMarkdownDocument> {
    let article_html = capture_first(
        html,
        r#"(?s)<article\b[^>]*class="[^"]*ltx_document[^"]*"[^>]*>(.*?)</article>"#,
    )
    .ok_or_else(|| ReaderError::ModelApi("Failed to locate arXiv article body".to_string()))?;

    let title = capture_first(
        &article_html,
        r#"(?s)<h1\b[^>]*class="[^"]*ltx_title_document[^"]*"[^>]*>(.*?)</h1>"#,
    )
    .map(|text| strip_html_tags(&text))
    .map(|text| normalize_inline_text(&decode_basic_html_entities(&text)))
    .filter(|text| !text.is_empty())
    .unwrap_or_else(|| inferred_title_from_url(base_url));

    let author = captures_all(
        &article_html,
        r#"(?s)<span\b[^>]*class="[^"]*ltx_personname[^"]*"[^>]*>(.*?)</span>"#,
    )
    .into_iter()
    .map(|text| normalize_inline_text(&decode_basic_html_entities(&strip_html_tags(&text))))
    .filter(|text| !text.is_empty())
    .collect::<Vec<_>>()
    .join(", ");
    let author = if author.is_empty() { None } else { Some(author) };

    let block_re = Regex::new(
        r#"(?s)<h[1-6]\b[^>]*class="[^"]*ltx_title[^"]*"[^>]*>.*?</h[1-6]>|<figure\b.*?</figure>|<table\b.*?</table>|<p\b[^>]*class="[^"]*ltx_p[^"]*"[^>]*>.*?</p>|<li\b[^>]*class="[^"]*ltx_bibitem[^"]*"[^>]*>.*?</li>"#,
    )
    .expect("invalid arxiv block regex");

    let mut blocks = Vec::new();
    for matched in block_re.find_iter(&article_html) {
        let fragment = matched.as_str();
        if fragment.starts_with("<h") {
            if let Some(heading) = render_arxiv_heading(fragment) {
                blocks.push(heading);
            }
        } else if fragment.starts_with("<figure") {
            if fragment.contains("ltx_table") {
                if let Some(table_md) = render_arxiv_table_figure_html(fragment, base_url) {
                    blocks.push(table_md);
                }
            } else if let Some(figure_md) = render_arxiv_figure_html(fragment, base_url) {
                blocks.push(figure_md);
            }
        } else if fragment.starts_with("<table") && fragment.contains("ltx_equation") {
            if let Some(equation_md) = render_arxiv_equation_html(fragment) {
                blocks.push(equation_md);
            }
        } else if fragment.starts_with("<table") {
            if let Some(table_md) = render_arxiv_table_html(fragment, base_url) {
                blocks.push(table_md);
            }
        } else if fragment.starts_with("<p") {
            let paragraph = render_arxiv_inline_html(fragment, base_url);
            if !paragraph.is_empty() {
                blocks.push(paragraph);
            }
        } else if fragment.starts_with("<li") {
            if let Some(reference) = render_arxiv_bibitem_html(fragment, base_url) {
                blocks.push(reference);
            }
        }
    }

    let body = collapse_blank_lines(&blocks);
    Ok(ArxivMarkdownDocument { title, author, body })
}

fn render_arxiv_heading(fragment: &str) -> Option<String> {
    let captures = Regex::new(r#"(?s)<h([1-6])\b[^>]*>(.*?)</h[1-6]>"#)
        .expect("invalid arxiv heading regex")
        .captures(fragment)?;
    let level = captures
        .get(1)
        .and_then(|value| value.as_str().parse::<usize>().ok())
        .unwrap_or(2)
        .clamp(1, 6);
    let text = normalize_inline_text(&decode_basic_html_entities(&strip_html_tags(
        captures.get(2).map(|value| value.as_str()).unwrap_or(""),
    )));
    if text.is_empty() {
        return None;
    }
    if text.eq_ignore_ascii_case("abstract") {
        return Some("## Abstract".to_string());
    }
    Some(format!("{} {}", "#".repeat(level), text))
}

fn render_arxiv_inline_html(fragment: &str, base_url: &Url) -> String {
    let math_re = Regex::new(r#"(?s)<math\b[^>]*>.*?</math>"#).expect("invalid arxiv math regex");
    let anchor_re =
        Regex::new(r#"(?s)<a\b[^>]*href="([^"]+)"[^>]*>(.*?)</a>"#).expect("invalid anchor regex");
    let em_re = Regex::new(r#"(?s)<(em|i)\b[^>]*>(.*?)</(em|i)>"#).expect("invalid em regex");
    let strong_re =
        Regex::new(r#"(?s)<(strong|b)\b[^>]*>(.*?)</(strong|b)>"#).expect("invalid strong regex");
    let br_re = Regex::new(r#"(?i)<br\s*/?>"#).expect("invalid br regex");

    let mut rendered = fragment.to_string();
    rendered = rendered.replace("</p>", "");
    rendered = rendered.replace("<p>", "");

    rendered = math_re
        .replace_all(&rendered, |caps: &regex::Captures| {
            render_arxiv_inline_math_html(caps.get(0).map(|m| m.as_str()).unwrap_or(""))
        })
        .into_owned();
    rendered = anchor_re
        .replace_all(&rendered, |caps: &regex::Captures| {
            let href = caps.get(1).map(|m| m.as_str()).unwrap_or("");
            let text = normalize_inline_text(&decode_basic_html_entities(&strip_html_tags(
                caps.get(2).map(|m| m.as_str()).unwrap_or(""),
            )));
            if text.is_empty() {
                return String::new();
            }
            if let Some(resolved) = resolve_relative_url(base_url, href) {
                format!("[{}]({})", text, resolved)
            } else {
                text
            }
        })
        .into_owned();
    rendered = em_re
        .replace_all(&rendered, |caps: &regex::Captures| {
            let text = normalize_inline_text(&decode_basic_html_entities(&strip_html_tags(
                caps.get(2).map(|m| m.as_str()).unwrap_or(""),
            )));
            if text.is_empty() {
                String::new()
            } else {
                format!("*{}*", text)
            }
        })
        .into_owned();
    rendered = strong_re
        .replace_all(&rendered, |caps: &regex::Captures| {
            let text = normalize_inline_text(&decode_basic_html_entities(&strip_html_tags(
                caps.get(2).map(|m| m.as_str()).unwrap_or(""),
            )));
            if text.is_empty() {
                String::new()
            } else {
                format!("**{}**", text)
            }
        })
        .into_owned();
    rendered = br_re.replace_all(&rendered, "\n").into_owned();
    rendered = decode_basic_html_entities(&strip_html_tags(&rendered));
    normalize_markdown_spacing(&rendered)
}

fn render_arxiv_inline_math_html(fragment: &str) -> String {
    let text = extract_math_tex_from_html(fragment)
        .unwrap_or_else(|| extract_math_plaintext_from_html(fragment));
    if text.is_empty() {
        String::new()
    } else {
        format!("${}$", text)
    }
}

fn render_arxiv_equation_html(fragment: &str) -> Option<String> {
    let body = extract_math_tex_from_html(fragment)
        .or_else(|| {
            let plain = extract_math_plaintext_from_html(fragment);
            if plain.is_empty() {
                None
            } else {
                Some(plain)
            }
        })?;

    let equation_no = capture_first(
        fragment,
        r#"(?s)<span\b[^>]*class="[^"]*ltx_tag_equation[^"]*"[^>]*>(.*?)</span>"#,
    )
    .map(|text| strip_html_tags(&text))
    .map(|text| normalize_inline_text(&decode_basic_html_entities(&text)))
    .filter(|text| !text.is_empty());

    Some(match equation_no {
        Some(no) => format!("$$\n{}\n$$\n{}", body, no),
        None => format!("$$\n{}\n$$", body),
    })
}

fn render_arxiv_figure_html(fragment: &str, base_url: &Url) -> Option<String> {
    let src = capture_first(fragment, r#"(?s)<img\b[^>]*src="([^"]+)""#)
        .and_then(|value| resolve_relative_url(base_url, &value))?;
    let caption = capture_first(fragment, r#"(?s)<figcaption\b[^>]*>(.*?)</figcaption>"#)
        .map(|text| strip_html_tags(&text))
        .map(|text| normalize_inline_text(&decode_basic_html_entities(&text)))
        .filter(|text| !text.is_empty());
    let alt = capture_first(fragment, r#"(?s)<img\b[^>]*alt="([^"]*)""#)
        .unwrap_or_else(|| "Figure".to_string());
    let label = caption.clone().unwrap_or_else(|| alt.clone());

    Some(match caption {
        Some(text) => format!("![{}]({})\n\n*{}*", label, src, text),
        None => format!("![{}]({})", label, src),
    })
}

fn render_arxiv_table_figure_html(fragment: &str, base_url: &Url) -> Option<String> {
    let caption = capture_first(fragment, r#"(?s)<figcaption\b[^>]*>(.*?)</figcaption>"#)
        .map(|html| render_arxiv_inline_html(&html, base_url))
        .map(|text| normalize_inline_text(&text))
        .filter(|text| !text.is_empty());
    let table_fragment = capture_first(fragment, r#"(?s)(<table\b[^>]*class="[^"]*ltx_tabular[^"]*"[^>]*>.*?</table>)"#)?;
    let table_md = render_arxiv_table_html(&table_fragment, base_url)?;

    Some(match caption {
        Some(text) => format!("*{}*\n\n{}", text, table_md),
        None => table_md,
    })
}

fn render_arxiv_bibitem_html(fragment: &str, base_url: &Url) -> Option<String> {
    let author_year = capture_first(
        fragment,
        r#"(?s)<span\b[^>]*class="[^"]*ltx_tag_bibitem[^"]*"[^>]*>(.*?)</span>"#,
    )
    .map(|html| normalize_inline_text(&decode_basic_html_entities(&strip_html_tags(&html))))
    .filter(|text| !text.is_empty());
    let title = capture_first(
        fragment,
        r#"(?s)<span\b[^>]*class="[^"]*ltx_bib_title[^"]*"[^>]*>(.*?)</span>"#,
    )
    .map(|html| normalize_inline_text(&decode_basic_html_entities(&strip_html_tags(&html))))
    .filter(|text| !text.is_empty());
    let journal = capture_first(
        fragment,
        r#"(?s)<span\b[^>]*class="[^"]*ltx_bib_journal[^"]*"[^>]*>(.*?)</span>"#,
    )
    .map(|html| normalize_inline_text(&decode_basic_html_entities(&strip_html_tags(&html))))
    .filter(|text| !text.is_empty());
    let publisher = capture_first(
        fragment,
        r#"(?s)<span\b[^>]*class="[^"]*ltx_bib_publisher[^"]*"[^>]*>(.*?)</span>"#,
    )
    .map(|html| normalize_inline_text(&decode_basic_html_entities(&strip_html_tags(&html))))
    .filter(|text| !text.is_empty());
    let note = capture_first(
        fragment,
        r#"(?s)<span\b[^>]*class="[^"]*ltx_bib_note[^"]*"[^>]*>(.*?)</span>"#,
    )
    .map(|html| render_arxiv_inline_html(&html, base_url))
    .map(|text| normalize_inline_text(&text))
    .filter(|text| !text.is_empty());
    let links = captures_all(
        fragment,
        r#"(?s)<a\b[^>]*class="[^"]*ltx_bib_external[^"]*"[^>]*href="([^"]+)""#,
    )
    .into_iter()
    .filter_map(|href| resolve_relative_url(base_url, &href))
    .collect::<Vec<_>>();

    let mut parts = Vec::new();
    if let Some(text) = author_year {
        parts.push(text);
    }
    if let Some(text) = title {
        parts.push(text);
    }
    if let Some(text) = journal {
        parts.push(text);
    } else if let Some(text) = publisher {
        parts.push(text);
    }
    if let Some(text) = note {
        parts.push(text);
    }
    if parts.is_empty() {
        return None;
    }

    let mut line = format!("- {}", parts.join(". "));
    if !line.ends_with('.') {
        line.push('.');
    }
    if let Some(link) = links.first() {
        line.push_str(&format!(" [Link]({})", link));
    }
    Some(line)
}

fn render_arxiv_table_html(fragment: &str, base_url: &Url) -> Option<String> {
    let row_re = Regex::new(r#"(?s)<tr\b[^>]*>(.*?)</tr>"#).expect("invalid table row regex");
    let cell_re =
        Regex::new(r#"(?s)<(th|td)\b([^>]*)>(.*?)</(th|td)>"#).expect("invalid table cell regex");

    let mut raw_rows = Vec::new();
    for row_caps in row_re.captures_iter(fragment) {
        let row_html = row_caps.get(1).map(|m| m.as_str()).unwrap_or("");
        let mut cells = Vec::new();
        for cell_caps in cell_re.captures_iter(row_html) {
            let attrs = cell_caps.get(2).map(|m| m.as_str()).unwrap_or("");
            let cell_html = cell_caps.get(3).map(|m| m.as_str()).unwrap_or("");
            let cell = normalize_inline_text(&render_arxiv_inline_html(cell_html, base_url));
            if !cell.is_empty() {
                cells.push(ArxivTableCell {
                    text: escape_markdown_table_cell(&cell),
                    colspan: parse_html_table_span(attrs, "colspan"),
                    rowspan: parse_html_table_span(attrs, "rowspan"),
                });
            }
        }
        if !cells.is_empty() {
            raw_rows.push(cells);
        }
    }

    if raw_rows.len() < 2 {
        return None;
    }

    let header_row_count = infer_arxiv_table_header_rows(&raw_rows);
    let rows = expand_arxiv_table_rows(&raw_rows);
    let col_count = rows.iter().map(|row| row.len()).max().unwrap_or(0);
    if col_count == 0 {
        return None;
    }

    let separator = vec!["---".to_string(); col_count];
    let header = flatten_arxiv_table_header(&rows, header_row_count, col_count);
    let mut lines = vec![
        format!("| {} |", header.join(" | ")),
        format!("| {} |", separator.join(" | ")),
    ];
    for (row_idx, row) in rows.iter().enumerate().skip(header_row_count) {
        if let Some(line) = render_arxiv_table_body_row(row, row_idx) {
            lines.push(line);
        }
    }
    Some(lines.join("\n"))
}

fn parse_html_table_span(attrs: &str, name: &str) -> usize {
    capture_first(attrs, &format!(r#"{}\s*=\s*"(\d+)""#, name))
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(1)
}

fn infer_arxiv_table_header_rows(rows: &[Vec<ArxivTableCell>]) -> usize {
    if rows.len() < 2 {
        return rows.len();
    }

    let mut header_rows = 1usize;
    let mut row_idx = 0usize;
    while row_idx < rows.len() && row_idx < header_rows {
        let max_rowspan = rows[row_idx]
            .iter()
            .map(|cell| cell.rowspan)
            .max()
            .unwrap_or(1);
        if rows[row_idx]
            .iter()
            .any(|cell| cell.colspan > 1 || cell.rowspan > 1)
        {
            header_rows = header_rows.max(row_idx + max_rowspan);
        }
        row_idx += 1;
    }

    header_rows.min(rows.len().saturating_sub(1).max(1))
}

fn expand_arxiv_table_rows(
    rows: &[Vec<ArxivTableCell>],
) -> Vec<Vec<Option<ExpandedArxivTableCell>>> {
    let mut grid: Vec<Vec<Option<ExpandedArxivTableCell>>> = Vec::new();

    for (row_idx, row) in rows.iter().enumerate() {
        if grid.len() <= row_idx {
            grid.push(Vec::new());
        }

        let mut col_idx = 0usize;
        for cell in row {
            while grid[row_idx]
                .get(col_idx)
                .and_then(|value| value.as_ref())
                .is_some()
            {
                col_idx += 1;
            }

            for row_offset in 0..cell.rowspan {
                while grid.len() <= row_idx + row_offset {
                    grid.push(Vec::new());
                }
                let target_row = &mut grid[row_idx + row_offset];
                if target_row.len() < col_idx + cell.colspan {
                    target_row.resize(col_idx + cell.colspan, None);
                }
                for col_offset in 0..cell.colspan {
                    target_row[col_idx + col_offset] = Some(ExpandedArxivTableCell {
                        text: cell.text.clone(),
                        origin_row: row_idx,
                        origin_col: col_idx,
                    });
                }
            }

            col_idx += cell.colspan;
        }
    }

    let col_count = grid.iter().map(|row| row.len()).max().unwrap_or(0);
    for row in &mut grid {
        if row.len() < col_count {
            row.resize(col_count, None);
        }
    }

    grid
}

fn flatten_arxiv_table_header(
    rows: &[Vec<Option<ExpandedArxivTableCell>>],
    header_row_count: usize,
    col_count: usize,
) -> Vec<String> {
    (0..col_count)
        .map(|col_idx| {
            let mut labels = Vec::new();
            for row in rows.iter().take(header_row_count) {
                let Some(cell) = row.get(col_idx).and_then(|value| value.as_ref()) else {
                    continue;
                };
                let text = cell.text.trim();
                if text.is_empty() || labels.iter().any(|value| value == text) {
                    continue;
                }
                labels.push(text.to_string());
            }
            if labels.is_empty() {
                String::new()
            } else {
                labels.join(" ")
            }
        })
        .collect()
}

fn render_arxiv_table_body_row(
    row: &[Option<ExpandedArxivTableCell>],
    row_idx: usize,
) -> Option<String> {
    let mut cells = Vec::with_capacity(row.len());
    let mut has_content = false;

    for (col_idx, cell) in row.iter().enumerate() {
        let value = match cell {
            Some(cell) if cell.origin_row == row_idx && cell.origin_col == col_idx => {
                cell.text.clone()
            }
            _ => String::new(),
        };
        if !value.is_empty() {
            has_content = true;
        }
        cells.push(value);
    }

    if !has_content {
        None
    } else {
        Some(format!("| {} |", cells.join(" | ")))
    }
}

fn capture_first(input: &str, pattern: &str) -> Option<String> {
    Regex::new(pattern)
        .ok()?
        .captures(input)
        .and_then(|caps| caps.get(1))
        .map(|value| value.as_str().to_string())
}

fn captures_all(input: &str, pattern: &str) -> Vec<String> {
    let Ok(regex) = Regex::new(pattern) else {
        return Vec::new();
    };
    regex
        .captures_iter(input)
        .filter_map(|caps| caps.get(1).map(|value| value.as_str().to_string()))
        .collect()
}

fn resolve_relative_url(base_url: &Url, href: &str) -> Option<String> {
    let trimmed = href.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.starts_with('#') {
        return base_url.join(trimmed).ok().map(|url| url.to_string());
    }
    if trimmed.starts_with('/') {
        return base_url.join(trimmed).ok().map(|url| url.to_string());
    }
    if trimmed.contains("://") || trimmed.starts_with("mailto:") {
        return base_url.join(trimmed).ok().map(|url| url.to_string());
    }

    let mut resource_base = base_url.clone();
    let current_path = resource_base.path().to_string();
    let document_id = current_path
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or_default()
        .to_string();
    if !current_path.ends_with('/') {
        resource_base.set_path(&format!("{}/", current_path));
    }

    let normalized_trimmed = if !document_id.is_empty() {
        let prefixed = format!("{}/", document_id);
        trimmed.strip_prefix(&prefixed).unwrap_or(trimmed)
    } else {
        trimmed
    };

    resource_base
        .join(normalized_trimmed)
        .ok()
        .map(|url| url.to_string())
}

fn normalize_inline_text(input: &str) -> String {
    input.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn normalize_markdown_spacing(input: &str) -> String {
    let mut out = String::new();
    let mut previous_space = false;
    for ch in input.chars() {
        if ch.is_whitespace() {
            if !previous_space {
                out.push(' ');
            }
            previous_space = true;
        } else {
            out.push(ch);
            previous_space = false;
        }
    }
    out.trim().to_string()
}

fn strip_html_tags(input: &str) -> String {
    Regex::new(r#"(?s)<[^>]+>"#)
        .expect("invalid html strip regex")
        .replace_all(input, "")
        .into_owned()
}

fn decode_basic_html_entities(input: &str) -> String {
    input
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&ndash;", "–")
        .replace("&mdash;", "—")
}

fn extract_math_tex_from_html(input: &str) -> Option<String> {
    capture_first(
        input,
        r#"(?s)<annotation\b[^>]*encoding="application/x-tex"[^>]*>(.*?)</annotation>"#,
    )
    .map(|value| decode_basic_html_entities(&value).trim().to_string())
    .filter(|value| !value.is_empty())
}

fn extract_math_plaintext_from_html(input: &str) -> String {
    let stripped = strip_html_tags(input);
    normalize_inline_text(&decode_basic_html_entities(&stripped))
}

fn escape_markdown_table_cell(value: &str) -> String {
    value.replace('|', "\\|")
}

fn normalize_http_url(input: &str) -> Result<Url> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(ReaderError::InvalidArgument(
            "URL cannot be empty".to_string(),
        ));
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

fn extract_source_url_from_markdown(content: &str) -> Option<String> {
    for line in content.lines().take(40) {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let without_quote = trimmed.trim_start_matches('>').trim();
        let lower = without_quote.to_ascii_lowercase();
        if lower.starts_with("source:") {
            let candidate = without_quote["source:".len()..].trim();
            if let Ok(normalized) = normalize_http_url(candidate) {
                return Some(normalized.to_string());
            }
        }
    }
    None
}

fn inferred_title_from_url(url: &Url) -> String {
    let host = url.host_str().unwrap_or("web");
    let tail = url
        .path_segments()
        .and_then(|mut segs| segs.next_back())
        .filter(|s| !s.is_empty())
        .unwrap_or("article");
    let tail = tail.replace(['-', '_'], " ");
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
    text.chars().any(|c| {
        matches!(
            c,
            '.' | ',' | ';' | ':' | '!' | '?' | '。' | '，' | '；' | '：' | '！' | '？'
        )
    })
}

fn collapse_blank_lines(lines: &[String]) -> String {
    lines
        .iter()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n")
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
            let token =
                token.trim_matches(|c: char| matches!(c, '(' | ')' | '[' | ']' | '"' | '\''));
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_arxiv_html_with_equations_tables_and_figures() {
        let html = r#"
        <article class="ltx_document">
          <h1 class="ltx_title ltx_title_document">Sample Paper</h1>
          <div class="ltx_authors">
            <span class="ltx_personname">Alice</span>
            <span class="ltx_personname">Bob</span>
          </div>
          <div class="ltx_abstract">
            <h6 class="ltx_title ltx_title_abstract">Abstract</h6>
            <p class="ltx_p">We obtain <math><semantics><mi>x</mi><annotation encoding="application/x-tex">x</annotation></semantics></math>.</p>
          </div>
          <h2 class="ltx_title ltx_title_section"><span class="ltx_tag">1</span> Method</h2>
          <p class="ltx_p">See <a href="/html/2602.06036v1#S1">Section 1</a>.</p>
          <table class="ltx_equation ltx_eqn_table">
            <tr>
              <td><math><semantics><mrow><mi>L</mi><mo>=</mo><mi>x</mi></mrow><annotation encoding="application/x-tex">L=x</annotation></semantics></math></td>
              <td><span class="ltx_tag_equation">(1)</span></td>
            </tr>
          </table>
          <figure class="ltx_figure">
            <img src="2602.06036v1/x1.png" alt="Figure"/>
            <figcaption>Figure 1: Overview.</figcaption>
          </figure>
          <figure class="ltx_table">
            <figcaption>Table 1: Results.</figcaption>
            <table class="ltx_tabular">
              <tr><th>Model</th><th>Speedup</th></tr>
              <tr><td>DFlash</td><td>2.5x</td></tr>
            </table>
          </figure>
          <p class="ltx_p">Tail paragraph after the table.</p>
          <h2 class="ltx_title ltx_title_bibliography">References</h2>
          <ul class="ltx_biblist">
            <li class="ltx_bibitem ltx_bib_misc" id="bib.demo">
              <span class="ltx_tag ltx_bib_author-year ltx_role_refnum ltx_tag_bibitem">A. Author (2025)</span>
              <span class="ltx_bibblock"><span class="ltx_text ltx_bib_title">Useful Paper</span>.</span>
              <span class="ltx_bibblock">External Links: <a class="ltx_ref ltx_bib_external" href="https://example.com/paper" title="">Link</a></span>
            </li>
          </ul>
        </article>
        "#;
        let base_url = Url::parse("https://arxiv.org/html/2602.06036v1").unwrap();

        let converted = convert_arxiv_html_to_markdown(&base_url, html).unwrap();

        assert_eq!(converted.title, "Sample Paper");
        assert_eq!(converted.author.as_deref(), Some("Alice, Bob"));
        assert!(converted.body.contains("## Abstract"));
        assert!(converted.body.contains("$$\nL=x\n$$"));
        assert!(converted.body.contains("*Table 1: Results.*"));
        assert!(converted.body.contains("| Model | Speedup |"));
        assert!(converted.body.contains("| DFlash | 2.5x |\n\nTail paragraph after the table."));
        assert!(converted.body.contains("## References"));
        assert!(converted
            .body
            .contains("- A. Author (2025). Useful Paper. [Link](https://example.com/paper)"));
        assert!(converted
            .body
            .contains("![Figure 1: Overview.](https://arxiv.org/html/2602.06036v1/x1.png)"));
    }

    #[test]
    fn flattens_arxiv_table_with_multirow_headers() {
        let fragment = r#"
        <table class="ltx_tabular ltx_centering ltx_align_middle">
          <tr>
            <td rowspan="2">Setting</td>
            <td colspan="2">Math500</td>
            <td colspan="2">HumanEval</td>
            <td colspan="2">MT-Bench</td>
          </tr>
          <tr>
            <td>Speedup</td>
            <td><math><semantics><mi>τ</mi><annotation encoding="application/x-tex">\tau</annotation></semantics></math></td>
            <td>Speedup</td>
            <td><math><semantics><mi>τ</mi><annotation encoding="application/x-tex">\tau</annotation></semantics></math></td>
            <td>Speedup</td>
            <td><math><semantics><mi>τ</mi><annotation encoding="application/x-tex">\tau</annotation></semantics></math></td>
          </tr>
          <tr>
            <td>3-L</td>
            <td>4.69×</td>
            <td>5.64</td>
            <td>3.90×</td>
            <td>4.61</td>
            <td>2.38×</td>
            <td>3.18</td>
          </tr>
        </table>
        "#;
        let base_url = Url::parse("https://arxiv.org/html/2602.06036v1").unwrap();

        let rendered = render_arxiv_table_html(fragment, &base_url).unwrap();

        assert!(rendered.contains(
            "| Setting | Math500 Speedup | Math500 $\\tau$ | HumanEval Speedup | HumanEval $\\tau$ | MT-Bench Speedup | MT-Bench $\\tau$ |"
        ));
        assert!(rendered.contains("| 3-L | 4.69× | 5.64 | 3.90× | 4.61 | 2.38× | 3.18 |"));
    }

    #[test]
    fn resolves_arxiv_relative_asset_urls_from_document_directory() {
        let base_url = Url::parse("https://arxiv.org/html/2602.06036v1").unwrap();

        assert_eq!(
            resolve_relative_url(&base_url, "x4.png").as_deref(),
            Some("https://arxiv.org/html/2602.06036v1/x4.png")
        );
        assert_eq!(
            resolve_relative_url(&base_url, "#S1").as_deref(),
            Some("https://arxiv.org/html/2602.06036v1#S1")
        );
        assert_eq!(
            resolve_relative_url(&base_url, "/html/2602.06036v1#S1").as_deref(),
            Some("https://arxiv.org/html/2602.06036v1#S1")
        );
        assert_eq!(
            resolve_relative_url(&base_url, "2602.06036v1/x4.png").as_deref(),
            Some("https://arxiv.org/html/2602.06036v1/x4.png")
        );
    }
}
