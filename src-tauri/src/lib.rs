mod commands;
mod config;
mod database;
mod error;
mod logger;
mod llm;
mod models;
mod mcp;
mod parsers;
mod search;

pub use error::{ReaderError, Result};

use tauri::Manager;
use commands::{
    import_epub, import_pdf, list_documents, get_document, delete_document,
    get_document_sections, get_section_paragraphs, index_document, search,
    translate, summarize, get_summary_cache, get_config, update_config, mcp_request,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
            list_documents,
            get_document,
            delete_document,
            get_document_sections,
            get_section_paragraphs,
            index_document,
            search,
            translate,
            summarize,
            get_summary_cache,
            get_config,
            update_config,
            mcp_request,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
