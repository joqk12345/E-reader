use crate::error::{ReaderError, Result};
use crate::models::NewDocument;
use std::path::Path;
use pdf::file::File as PdfFile;
use pdf::content::{Text as PdfText};

pub struct PdfParser {
    file_path: String,
}

impl PdfParser {
    pub fn new(file_path: &str) -> Result<Self> {
        let path = Path::new(file_path);
        if !path.exists() {
            return Err(ReaderError::NotFound(file_path.to_string()));
        }
        Ok(Self {
            file_path: file_path.to_string(),
        })
    }

    pub fn get_metadata(&self) -> Result<NewDocument> {
        let file = std::fs::File::open(&self.file_path)?;
        let doc = PdfFile::open(file)
            .map_err(|e| ReaderError::PdfParse(format!("Failed to open PDF: {}", e)))?;

        // Try to get title from metadata, otherwise use filename
        let title = doc.get_title()
            .and_then(|t| if t.is_empty() { None } else { Some(t.to_string()) })
            .unwrap_or_else(|| {
                Path::new(&self.file_path)
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("Untitled")
                    .to_string()
            });

        let author = doc.get_author()
            .and_then(|a| if a.is_empty() { None } else { Some(a.to_string()) });

        Ok(NewDocument {
            title,
            author,
            language: None, // PDF language detection requires heuristics
            file_path: self.file_path.clone(),
            file_type: "pdf".to_string(),
        })
    }

    pub fn extract_text_by_page(&self) -> Result<Vec<(String, Vec<String>)>> {
        let file = std::fs::File::open(&self.file_path)?;
        let doc = PdfFile::open(file)
            .map_err(|e| ReaderError::PdfParse(format!("Failed to open PDF: {}", e)))?;

        let mut pages = Vec::new();
        let page_count = doc.get_num_pages()
            .map_err(|e| ReaderError::PdfParse(format!("Failed to get page count: {}", e)))?;

        for page_num in 0..page_count {
            let page = doc.get_page(page_num)
                .map_err(|e| ReaderError::PdfParse(format!("Failed to get page {}: {}", page_num, e)))?;

            let text = self.extract_text_from_page(&page)?;
            let title = format!("Page {}", page_num + 1);

            pages.push((title, text));
        }

        Ok(pages)
    }

    fn extract_text_from_page(&self, page: &pdf::page::Page) -> Result<Vec<String>> {
        let mut paragraphs = Vec::new();
        let mut current_paragraph = String::new();

        // Extract text content
        for text_item in page.get_text()?.iter() {
            match text_item {
                PdfText::Text(text) => {
                    current_paragraph.push_str(text);
                    current_paragraph.push(' ');
                }
                PdfText::Newline => {
                    if !current_paragraph.trim().is_empty() {
                        paragraphs.push(current_paragraph.trim().to_string());
                        current_paragraph = String::new();
                    }
                }
                _ => {}
            }
        }

        // Don't forget the last paragraph
        if !current_paragraph.trim().is_empty() {
            paragraphs.push(current_paragraph.trim().to_string());
        }

        // Filter out very short "paragraphs" that are likely artifacts
        paragraphs = paragraphs.into_iter()
            .filter(|p| p.len() > 10)
            .collect();

        Ok(paragraphs)
    }

    pub fn parse_all(&self) -> Result<(NewDocument, Vec<(String, i32, String, Vec<String>)>)> {
        let metadata = self.get_metadata()?;
        let pages = self.extract_text_by_page()?;

        let mut chapters = Vec::new();

        for (order_index, (title, paragraphs)) in pages.into_iter().enumerate() {
            let href = format!("page{}", order_index + 1);
            chapters.push((title, order_index as i32, href, paragraphs));
        }

        Ok((metadata, chapters))
    }
}
