mod import;
mod index;
mod search;
mod translate;
mod tts;
mod config;
mod mcp;
mod embedding;

pub use import::{import_epub, import_pdf, import_markdown, list_documents, get_document, delete_document, get_document_sections, get_section_paragraphs};
pub use index::index_document;
pub use search::{search, get_paragraph_context, SearchResultOutput, ParagraphContextOutput};
pub use translate::{translate, summarize, get_summary_cache};
pub use tts::{tts_synthesize, list_tts_voices};
pub use config::{get_config, update_config};
pub use mcp::{mcp_request, McpState};
pub use embedding::{
    get_document_paragraphs,
    upsert_embeddings_batch,
    search_by_embedding,
    get_embedding_profile_status,
    clear_embeddings_by_profile,
    download_embedding_model_files,
    validate_local_embedding_model_path,
    EmbeddingProfileStatus,
    SearchByEmbeddingResult,
};
