mod epub;
mod markdown;
mod pdf;

use crate::models::NewDocument;

pub type ParsedChapter = (String, i32, String, Vec<String>);
pub type ParsedChapters = Vec<ParsedChapter>;
pub type ParsedDocument = (NewDocument, ParsedChapters);

pub use epub::EpubParser;
pub use markdown::MarkdownParser;
pub use pdf::PdfParser;
