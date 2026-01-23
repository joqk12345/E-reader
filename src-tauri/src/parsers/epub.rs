use crate::error::{ReaderError, Result};
use crate::models::NewDocument;
use epub::doc::EpubDoc;
use std::path::Path;

pub struct EpubParser {
    doc: EpubDoc<std::io::BufReader<std::fs::File>>,
}

impl EpubParser {
    pub fn new(file_path: &str) -> Result<Self> {
        let path = Path::new(file_path);
        if !path.exists() {
            return Err(ReaderError::NotFound(file_path.to_string()));
        }

        let doc = EpubDoc::new(file_path)
            .map_err(|e| ReaderError::EpubParse(format!("Failed to open EPUB: {}", e)))?;

        Ok(Self { doc })
    }

    pub fn get_metadata(&self) -> Result<NewDocument> {
        let title = self.doc.minfo("title")
            .or_else(|| self.doc.minfo("dc:title"))
            .unwrap_or_else(|| "Untitled".to_string());

        let author = self.doc.minfo("creator")
            .or_else(|| self.doc.minfo("dc:creator"))
            .map(|s| s.to_string());

        let language = self.doc.minfo("language")
            .or_else(|| self.doc.minfo("dc:language"))
            .map(|s| s.to_string());

        Ok(NewDocument {
            title,
            author,
            language,
            file_path: self.doc.path.clone(),
            file_type: "epub".to_string(),
        })
    }

    pub fn get_table_of_contents(&self) -> Result<Vec<(String, i32, String)>> {
        let toc = self.doc.toc()
            .map_err(|e| ReaderError::EpubParse(format!("Failed to read TOC: {}", e)))?;

        let mut chapters = Vec::new();
        let mut order = 0;

        for item in toc {
            if let Some(href) = item.content {
                let title = item.label.unwrap_or_else(|| "Untitled".to_string());
                chapters.push((title, order, href));
                order += 1;
            }
        }

        Ok(chapters)
    }

    pub fn get_chapter_content(&self, href: &str) -> Result<Vec<String>> {
        let content = self.doc.get_resource_by_href(href)
            .map_err(|e| ReaderError::EpubParse(format!("Failed to get chapter: {}", e)))?
            .ok_or_else(|| ReaderError::NotFound(format!("Chapter: {}", href)))?;

        let text = self.extract_text_from_html(&content);
        Ok(text)
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

    pub fn parse_all(&self) -> Result<(NewDocument, Vec<(String, i32, String, Vec<String>)>)> {
        let metadata = self.get_metadata()?;
        let toc = self.get_table_of_contents()?;

        let mut chapters = Vec::new();

        for (title, order_index, href) in &toc {
            let paragraphs = self.get_chapter_content(href)?;
            chapters.push((title.clone(), *order_index, href.clone(), paragraphs));
        }

        Ok((metadata, chapters))
    }
}
