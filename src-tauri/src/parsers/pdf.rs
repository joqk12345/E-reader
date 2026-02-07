use crate::error::{ReaderError, Result};
use crate::models::NewDocument;
use std::path::Path;

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
        // For now, extract basic info from filename
        // A full implementation would use pdf crate to read metadata
        let title = Path::new(&self.file_path)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Untitled")
            .to_string();

        Ok(NewDocument {
            title,
            author: None,
            language: None,
            file_path: self.file_path.clone(),
            file_type: "pdf".to_string(),
        })
    }

    pub fn extract_text_by_page(&self) -> Result<Vec<(String, Vec<String>)>> {
        // Simplified PDF text extraction
        // For now, return placeholder implementation
        // A full implementation would use pdf crate or pdf-extract
        let pages = vec![(
            "Page 1".to_string(),
            vec![
                "PDF text extraction not yet fully implemented. Please check back later."
                    .to_string(),
            ],
        )];

        Ok(pages)
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
