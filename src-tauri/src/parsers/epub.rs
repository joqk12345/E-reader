use crate::error::{ReaderError, Result};
use crate::models::NewDocument;
use epub::doc::EpubDoc;
use std::path::Path;

pub struct EpubParser {
    doc: EpubDoc<std::io::BufReader<std::fs::File>>,
    file_path: String,
}

impl EpubParser {
    pub fn new(file_path: &str) -> Result<Self> {
        let path = Path::new(file_path);
        if !path.exists() {
            return Err(ReaderError::NotFound(file_path.to_string()));
        }

        let doc = EpubDoc::new(file_path)
            .map_err(|e| ReaderError::EpubParse(format!("Failed to open EPUB: {}", e)))?;

        Ok(Self {
            doc,
            file_path: file_path.to_string(),
        })
    }

    fn get_metadata_value(&self, key: &str) -> Option<String> {
        for item in &self.doc.metadata {
            if item.property == key {
                return Some(item.value.clone());
            }
        }
        None
    }

    pub fn get_metadata(&self) -> Result<NewDocument> {
        let title = self
            .get_metadata_value("title")
            .or_else(|| self.get_metadata_value("dc:title"))
            .unwrap_or_else(|| "Untitled".to_string());

        let author = self
            .get_metadata_value("creator")
            .or_else(|| self.get_metadata_value("dc:creator"));

        let language = self
            .get_metadata_value("language")
            .or_else(|| self.get_metadata_value("dc:language"));

        Ok(NewDocument {
            title,
            author,
            language,
            file_path: self.file_path.clone(),
            file_type: "epub".to_string(),
        })
    }

    pub fn get_table_of_contents(&self) -> Result<Vec<(String, i32, String)>> {
        let mut chapters = Vec::new();
        let mut order = 0;

        // First, check if TOC from doc.toc has all necessary items
        // If TOC is too small (like < 15 items), use spine instead
        if self.doc.toc.len() < 15 {
            tracing::info!(
                "TOC is too small ({} items), using spine for complete chapters",
                self.doc.toc.len()
            );

            for spine_item in &self.doc.spine {
                if let Some(resource) = self.doc.resources.get(&spine_item.idref) {
                    let href = resource.path.to_str().unwrap_or("").to_string();
                    let title = Self::extract_title_from_idref(&spine_item.idref);
                    chapters.push((title, order, href));
                    order += 1;
                }
            }
        } else {
            // Use normal TOC if it has reasonable number of items
            for item in &self.doc.toc {
                let href = item.content.to_string_lossy().to_string();
                let title = if !item.label.is_empty() {
                    item.label.clone()
                } else {
                    "Untitled".to_string()
                };
                chapters.push((title, order, href));
                order += 1;
            }
        }

        Ok(chapters)
    }

    fn extract_title_from_idref(idref: &str) -> String {
        // Convert idref like "Chapter01" or "Interlude03" to readable title
        let mut title = String::new();
        let mut chars = idref.chars().peekable();

        while let Some(c) = chars.next() {
            if c.is_uppercase() && !title.is_empty() {
                title.push(' ');
            }
            title.push(c);

            // Handle numbers
            if c.is_alphabetic() && chars.peek().map_or(false, |&next| next.is_numeric()) {
                while let Some(next_c) = chars.peek() {
                    if next_c.is_numeric() {
                        title.push(chars.next().unwrap());
                    } else {
                        break;
                    }
                }
            }
        }

        // Make sure we have a readable title
        if title.is_empty() || title == "id" || title == "ref" {
            "Untitled".to_string()
        } else {
            title
        }
    }

    fn normalize_href(href: &str) -> String {
        let base = href
            .split('#')
            .next()
            .unwrap_or(href)
            .split('?')
            .next()
            .unwrap_or(href)
            .trim_start_matches("./")
            .replace('\\', "/");

        percent_decode(&base)
    }

    pub fn get_chapter_content(&mut self, href: &str) -> Result<Vec<String>> {
        let base_href = Self::normalize_href(href);

        // Build a map from path to resource_id
        let resources = &self.doc.resources;
        let mut path_to_id: std::collections::HashMap<String, String> =
            std::collections::HashMap::new();

        for (resource_id, resource_item) in resources.iter() {
            if let Some(path_str) = resource_item.path.to_str() {
                path_to_id.insert(path_str.to_string(), resource_id.clone());
            }
        }

        tracing::info!(
            "Looking for href: '{}'. Found {} resources with paths",
            base_href,
            path_to_id.len()
        );

        // Try to find a resource that matches our href
        for (path, resource_id) in &path_to_id {
            let normalized_path = path.replace('\\', "/");
            if normalized_path.ends_with(&base_href) || normalized_path.contains(&base_href) {
                tracing::info!(
                    "Found matching resource: path='{}' id='{}'",
                    path,
                    resource_id
                );
                if let Some((content, _mime_type)) = self.doc.get_resource(resource_id) {
                    tracing::info!("Successfully retrieved content, {} bytes", content.len());
                    let text = self.extract_text_from_html(&content);
                    tracing::info!("Extracted {} paragraphs", text.len());
                    return Ok(text);
                } else {
                    tracing::warn!("get_resource returned None for id='{}'", resource_id);
                }
            }
        }

        // If href contains a path component, try just the filename
        if let Some(filename) = base_href.split('/').last() {
            if !filename.is_empty() && filename != base_href {
                tracing::info!("Trying filename match: '{}'", filename);
                for (path, resource_id) in &path_to_id {
                    let normalized_path = path.replace('\\', "/");
                    if normalized_path.ends_with(filename) {
                        tracing::info!(
                            "Found matching resource by filename: path='{}' id='{}'",
                            path,
                            resource_id
                        );
                        if let Some((content, _mime_type)) = self.doc.get_resource(resource_id) {
                            tracing::info!(
                                "Successfully retrieved content, {} bytes",
                                content.len()
                            );
                            let text = self.extract_text_from_html(&content);
                            tracing::info!("Extracted {} paragraphs", text.len());
                            return Ok(text);
                        }
                    }
                }
            }
        }

        // Log the available resources for debugging
        tracing::warn!(
            "Could not find chapter content for href: '{}'. Available paths: {:?}",
            base_href,
            path_to_id.keys().take(5).cloned().collect::<Vec<_>>()
        );

        Ok(Vec::new())
    }

    fn extract_text_from_html(&self, html: &[u8]) -> Vec<String> {
        let html_str = String::from_utf8_lossy(html);

        // Simple HTML tag removal
        let text = html_str
            .replace("<p>", "\n")
            .replace("</p>", "\n")
            .replace("<br>", "\n")
            .replace("<br/>", "\n")
            .replace("<div>", "\n")
            .replace("</div>", "\n");

        // Remove all other HTML tags
        let re = regex::Regex::new(r"<[^>]+>").unwrap();
        let text = re.replace_all(&text, "");

        // Split into paragraphs and filter empty
        text.split('\n')
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .collect()
    }

    pub fn parse_all(&mut self) -> Result<(NewDocument, Vec<(String, i32, String, Vec<String>)>)> {
        let metadata = self.get_metadata()?;
        let toc = self.get_table_of_contents()?;

        // Debug: Log all available resources
        tracing::info!("EPUB contains {} resources", self.doc.resources.len());
        for (i, (_id, item)) in self.doc.resources.iter().take(20).enumerate() {
            tracing::info!("Resource {}: path={:?} mime={:?}", i, item.path, item.mime);
        }

        let mut chapters = Vec::new();

        for (title, order_index, href) in &toc {
            tracing::info!("Attempting to load chapter: {} href={}", title, href);
            let paragraphs = self.get_chapter_content(href)?;
            tracing::info!(
                "Chapter {} loaded with {} paragraphs",
                title,
                paragraphs.len()
            );
            chapters.push((title.clone(), *order_index, href.clone(), paragraphs));
        }

        Ok((metadata, chapters))
    }
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = &input[i + 1..i + 3];
            if let Ok(value) = u8::from_str_radix(hex, 16) {
                out.push(value);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}
