mod commands;
mod config;
mod database;
mod error;
mod llm;
mod logger;
mod mcp;
mod models;
mod parsers;
mod search;

pub use error::{ReaderError, Result};

use commands::{
    chat_with_context,
    clear_embeddings_by_profile, create_annotation, delete_annotation, delete_document,
    deep_analyze, download_embedding_model_files, fetch_url_html, get_config, get_document,
    get_document_paragraphs, get_document_sections, get_embedding_profile_status,
    get_document_previews, get_paragraph_context, get_section_paragraphs, get_summary_cache,
    import_epub, import_markdown, import_markdown_content, import_pdf, import_url,
    index_document, list_annotations, list_documents, list_tts_voices, mcp_request, search,
    search_by_embedding, summarize, translate, tts_synthesize, update_config,
    upsert_embeddings_batch, validate_local_embedding_model_path,
};
use tauri::{menu::Menu, Manager};

fn build_app_menu<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<Menu<R>> {
    Menu::default(app)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .menu(build_app_menu)
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            logger::init_logging();
            database::init_db(app.handle())?;
            app.manage(commands::McpState::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            import_epub,
            import_pdf,
            import_markdown,
            import_url,
            fetch_url_html,
            import_markdown_content,
            list_documents,
            get_document_previews,
            get_document,
            delete_document,
            get_document_sections,
            get_section_paragraphs,
            index_document,
            search,
            get_paragraph_context,
            get_document_paragraphs,
            list_annotations,
            create_annotation,
            delete_annotation,
            upsert_embeddings_batch,
            search_by_embedding,
            get_embedding_profile_status,
            clear_embeddings_by_profile,
            download_embedding_model_files,
            validate_local_embedding_model_path,
            translate,
            summarize,
            get_summary_cache,
            deep_analyze,
            chat_with_context,
            tts_synthesize,
            list_tts_voices,
            get_config,
            update_config,
            mcp_request,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
