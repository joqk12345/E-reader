mod annotation;
mod config;
mod embedding;
mod import;
mod index;
mod mcp;
mod search;
mod translate;
mod tts;

pub use annotation::{create_annotation, delete_annotation, list_annotations};
pub use config::{get_config, update_config};
pub use embedding::{
    clear_embeddings_by_profile, download_embedding_model_files, get_document_paragraphs,
    get_embedding_profile_status, search_by_embedding, upsert_embeddings_batch,
    validate_local_embedding_model_path, EmbeddingProfileStatus, SearchByEmbeddingResult,
};
pub use import::{
    delete_document, fetch_url_html, get_document, get_document_sections, get_section_paragraphs,
    get_document_previews, import_epub, import_markdown, import_markdown_content, import_pdf,
    import_url, list_documents,
};
pub use index::index_document;
pub use mcp::{mcp_request, McpState};
pub use search::{get_paragraph_context, search, ParagraphContextOutput, SearchResultOutput};
pub use translate::{chat_with_context, deep_analyze, get_summary_cache, summarize, translate};
pub use tts::{list_tts_voices, tts_synthesize};
