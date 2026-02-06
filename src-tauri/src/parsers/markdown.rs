use crate::error::{ReaderError, Result};
use crate::models::NewDocument;
use std::fs;
use std::path::Path;

pub struct MarkdownParser {
    file_path: String,
}

impl MarkdownParser {
    pub fn new(file_path: &str) -> Result<Self> {
        let path = Path::new(file_path);
        if !path.exists() {
            return Err(ReaderError::NotFound(file_path.to_string()));
        }
        Ok(Self {
            file_path: file_path.to_string(),
        })
    }

    pub fn parse_all(&self) -> Result<(NewDocument, Vec<(String, i32, String, Vec<String>)>)> {
        let content = fs::read_to_string(&self.file_path)?;
        let (title, sections) = self.parse_markdown(&content);

        let metadata = NewDocument {
            title,
            author: None,
            language: None,
            file_path: self.file_path.clone(),
            file_type: "markdown".to_string(),
        };

        Ok((metadata, sections))
    }

    fn parse_markdown(&self, content: &str) -> (String, Vec<(String, i32, String, Vec<String>)>) {
        let mut title = Path::new(&self.file_path)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Untitled")
            .to_string();

        let mut sections: Vec<(String, i32, String, Vec<String>)> = Vec::new();
        let mut current_section_title = "Content".to_string();
        let mut current_buffer: Vec<String> = Vec::new();
        let mut section_order = 0;
        let mut in_code_block = false;

        let push_section = |sections: &mut Vec<(String, i32, String, Vec<String>)>,
                            title: &str,
                            order: i32,
                            buffer: &[String]| {
            let paragraphs = split_paragraphs(buffer);
            sections.push((
                title.to_string(),
                order,
                format!("section{}", order + 1),
                paragraphs,
            ));
        };

        for line in content.lines() {
            let trimmed = line.trim();

            if trimmed.starts_with("```") {
                in_code_block = !in_code_block;
            }

            if !in_code_block && trimmed.starts_with('#') {
                let heading = trimmed.trim_start_matches('#').trim();
                if !heading.is_empty() {
                    if trimmed.starts_with("# ") {
                        title = heading.to_string();
                    }

                    if has_meaningful_content(&current_buffer) {
                        push_section(
                            &mut sections,
                            &current_section_title,
                            section_order,
                            &current_buffer,
                        );
                        current_buffer.clear();
                        section_order += 1;
                    }

                    current_section_title = heading.to_string();
                    continue;
                }
            }

            current_buffer.push(line.to_string());
        }

        if has_meaningful_content(&current_buffer) || sections.is_empty() {
            push_section(
                &mut sections,
                &current_section_title,
                section_order,
                &current_buffer,
            );
        }

        (title, sections)
    }
}

fn split_paragraphs(lines: &[String]) -> Vec<String> {
    let mut paragraphs = Vec::new();
    let mut current = String::new();

    for line in lines {
        let trimmed = line.trim();

        if trimmed.is_empty() {
            if !current.trim().is_empty() {
                paragraphs.push(current.trim().to_string());
                current.clear();
            }
            continue;
        }

        if !current.is_empty() {
            current.push(' ');
        }
        current.push_str(trimmed);
    }

    if !current.trim().is_empty() {
        paragraphs.push(current.trim().to_string());
    }

    if paragraphs.is_empty() {
        paragraphs.push("No readable content extracted from Markdown file.".to_string());
    }

    paragraphs
}

fn has_meaningful_content(lines: &[String]) -> bool {
    lines.iter().any(|line| !line.trim().is_empty())
}
