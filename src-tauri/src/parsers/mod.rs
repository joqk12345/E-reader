mod epub;
mod markdown;
use crate::models::NewDocument;

pub type ParsedChapter = (String, i32, String, Vec<String>);
pub type ParsedChapters = Vec<ParsedChapter>;
pub type ParsedDocument = (NewDocument, ParsedChapters);

pub use epub::EpubParser;
pub use markdown::MarkdownParser;
