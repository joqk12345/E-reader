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
    get_document_previews, get_document_source_url, get_paragraph_context, get_section_paragraphs,
    get_summary_cache, import_epub, import_markdown, import_markdown_content, import_pdf,
    import_url, index_document, list_annotations, list_documents, list_tts_voices,
    get_mcp_status, install_cli_shell_command, mcp_request, set_mcp_reader_enabled, search, search_by_embedding, summarize,
    translate, tts_synthesize, update_config, test_model_connection, get_update_target, upsert_embeddings_batch,
    validate_local_embedding_model_path,
};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::Emitter;

#[cfg(target_os = "macos")]
fn build_app_menu<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<Menu<R>> {
    let about_item = MenuItem::with_id(
        app,
        "reader_open_about_settings",
        "◉R  About Reader",
        true,
        None::<&str>,
    )?;
    let settings_item = MenuItem::with_id(
        app,
        "reader_open_settings",
        "⚙  Settings...",
        true,
        Some("Cmd+,"),
    )?;
    let install_cli_item = MenuItem::with_id(
        app,
        "reader_install_cli_shell_command",
        "Shell Command: Install 'reader-cli' in PATH...",
        true,
        None::<&str>,
    )?;
    let app_menu = Submenu::with_items(
        app,
        "◉R Reader",
        true,
        &[
            &about_item,
            &PredefinedMenuItem::separator(app)?,
            &settings_item,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;

    let file_menu = Submenu::with_items(
        app,
        "File",
        true,
        &[&PredefinedMenuItem::close_window(app, None)?],
    )?;
    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let window_menu = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;
    let help_menu = Submenu::with_items(app, "Help", true, &[&install_cli_item])?;

    Menu::with_items(app, &[&app_menu, &file_menu, &edit_menu, &window_menu, &help_menu])
}

#[cfg(not(target_os = "macos"))]
fn build_app_menu<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<Menu<R>> {
    Menu::default(app)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .menu(build_app_menu)
        .on_menu_event(|app, event| {
            if event.id().as_ref() == "reader_open_about_settings" {
                let _ = app.emit("reader://open-settings-about", ());
            } else if event.id().as_ref() == "reader_open_settings" {
                let _ = app.emit("reader://open-settings", ());
            } else if event.id().as_ref() == "reader_install_cli_shell_command" {
                let app_handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    let payload = match install_cli_shell_command() {
                        Ok(result) => serde_json::json!({
                            "ok": true,
                            "result": result,
                        }),
                        Err(error) => serde_json::json!({
                            "ok": false,
                            "error": error.to_string(),
                        }),
                    };
                    let _ = app_handle.emit("reader://cli-shell-command-installed", payload);
                });
            }
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            logger::init_logging();
            database::init_db(app.handle())?;
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
            get_document_source_url,
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
            test_model_connection,
            get_mcp_status,
            set_mcp_reader_enabled,
            install_cli_shell_command,
            mcp_request,
            get_update_target,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
