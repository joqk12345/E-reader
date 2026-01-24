mod commands;
mod database;
mod error;
mod logger;
mod models;
mod parsers;

pub use error::{ReaderError, Result};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|handle| {
            logger::init_logging();
            database::init_db(handle)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::import_epub,
            commands::import_pdf,
            commands::list_documents,
            commands::get_document,
            commands::delete_document,
            commands::get_document_sections,
            commands::get_section_paragraphs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
