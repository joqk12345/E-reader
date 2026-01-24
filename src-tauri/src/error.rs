use thiserror::Error;

#[derive(Error, Debug)]
pub enum ReaderError {
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("EPUB parsing error: {0}")]
    EpubParse(String),

    #[error("PDF parsing error: {0}")]
    PdfParse(String),

    #[error("Model API error: {0}")]
    ModelApi(String),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Invalid argument: {0}")]
    InvalidArgument(String),

    #[error("Model busy")]
    ModelBusy,

    #[error("Internal error: {0}")]
    Internal(String),

    #[error("Embedding error: {0}")]
    Embedding(String),
}

pub type Result<T> = std::result::Result<T, ReaderError>;

// Convert to Tauri's error type
impl serde::Serialize for ReaderError {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::ser::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
