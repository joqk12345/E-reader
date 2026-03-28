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
    add_tag_alias, apply_document_tags, chat_with_context, cleanup_unused_tags,
    clear_embeddings_by_profile, create_annotation, deep_analyze, delete_annotation,
    delete_document, delete_model_profile, delete_provider_profile, download_embedding_model_files,
    fetch_url_html, get_ai_profiles, get_config, get_document, get_document_paragraphs,
    get_document_previews, get_document_sections, get_document_source_url,
    get_embedding_profile_status, get_mcp_status, get_paragraph_context,
    get_related_documents_by_tags, get_section_paragraphs, get_summary_cache,
    get_update_target, import_epub, import_markdown, import_markdown_content, import_pdf,
    import_url, index_document, install_cli_shell_command, list_annotations,
    list_batch_tag_review_items, list_document_tags, list_documents, list_tag_facets,
    list_tag_library, list_tag_suggestions, list_tts_voices, mcp_request, merge_tags,
    promote_temporary_tag, reindex_document_embeddings, remove_document_tag, remove_tag_alias,
    rename_tag, resolve_agent_runtime, review_tag_suggestions, save_agent_config,
    save_model_profile, save_provider_profile, search, search_by_embedding,
    set_mcp_reader_enabled, suggest_document_tags, suggest_tags_for_documents, summarize,
    test_model_connection, test_model_profile, test_provider_profile, translate,
    tts_synthesize, update_config, upsert_embeddings_batch, validate_local_embedding_model_path,
};
use tauri::menu::Menu;
#[cfg(target_os = "macos")]
use tauri::menu::{MenuItem, PredefinedMenuItem, Submenu};
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

    Menu::with_items(
        app,
        &[&app_menu, &file_menu, &edit_menu, &window_menu, &help_menu],
    )
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
            list_document_tags,
            list_tag_library,
            list_tag_facets,
            list_tag_suggestions,
            list_batch_tag_review_items,
            get_related_documents_by_tags,
            apply_document_tags,
            remove_document_tag,
            suggest_document_tags,
            suggest_tags_for_documents,
            review_tag_suggestions,
            rename_tag,
            merge_tags,
            add_tag_alias,
            remove_tag_alias,
            promote_temporary_tag,
            cleanup_unused_tags,
            get_document_sections,
            get_section_paragraphs,
            index_document,
            search,
            get_paragraph_context,
            get_document_paragraphs,
            reindex_document_embeddings,
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
            get_ai_profiles,
            save_provider_profile,
            save_model_profile,
            save_agent_config,
            delete_provider_profile,
            delete_model_profile,
            test_provider_profile,
            test_model_profile,
            resolve_agent_runtime,
            get_mcp_status,
            set_mcp_reader_enabled,
            install_cli_shell_command,
            mcp_request,
            get_update_target,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
