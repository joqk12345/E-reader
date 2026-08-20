mod ai_profiles;
mod annotation;
mod config;
mod embedding;
mod import;
mod index;
mod mcp;
mod publication;
mod search;
mod tags;
mod translate;
mod tts;
mod updater;

pub use ai_profiles::{
    delete_model_profile, delete_provider_profile, get_ai_profiles, resolve_agent_runtime,
    save_agent_config, save_model_profile, save_provider_profile, test_model_profile,
    test_provider_profile,
};
pub use annotation::{create_annotation, delete_annotation, list_annotations};
pub use config::{get_config, test_model_connection, update_config};
pub use embedding::{
    clear_embeddings_by_profile, download_embedding_model_files, get_document_paragraphs,
    get_embedding_profile_status, reindex_document_embeddings, search_by_embedding,
    upsert_embeddings_batch, validate_local_embedding_model_path,
};
pub use import::{
    delete_document, fetch_url_html, get_document, get_document_previews, get_document_sections,
    get_document_source_url, get_section_paragraphs, import_epub, import_markdown,
    import_markdown_content, import_pdf, import_url, list_documents,
};
pub use index::index_document;
pub use mcp::{get_mcp_status, install_cli_shell_command, mcp_request, set_mcp_reader_enabled};
pub use publication::{
    publication_close_v2, publication_get_size_v2, publication_load_blob_v2,
    publication_load_text_v2, publication_open_v2,
};
pub use search::{get_paragraph_context, search};
pub use tags::{
    add_tag_alias, apply_document_tags, cleanup_unused_tags, get_related_documents_by_tags,
    list_batch_tag_review_items, list_document_tags, list_tag_facets, list_tag_library,
    list_tag_suggestions, merge_tags, promote_temporary_tag, remove_document_tag, remove_tag_alias,
    rename_tag, review_tag_suggestions, suggest_document_tags, suggest_tags_for_documents,
};
pub use translate::{chat_with_context, deep_analyze, get_summary_cache, summarize, translate};
pub use tts::{list_tts_voices, tts_synthesize};
pub use updater::get_update_target;
