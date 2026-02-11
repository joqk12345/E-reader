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
    clear_embeddings_by_profile, create_annotation, delete_annotation, delete_document,
    deep_analyze, download_embedding_model_files, fetch_url_html, get_config, get_document,
    get_document_paragraphs, get_document_sections, get_embedding_profile_status,
    get_paragraph_context, get_section_paragraphs, get_summary_cache, import_epub, import_markdown,
    import_markdown_content, import_pdf, import_url,
    index_document, list_annotations, list_documents, list_tts_voices, mcp_request, search,
    search_by_embedding, summarize, translate, tts_synthesize, update_config,
    upsert_embeddings_batch, validate_local_embedding_model_path,
};
use std::sync::{Arc, Mutex};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    Emitter, Manager,
};

const MENU_EVENT_NAME: &str = "reader-menu-action";
const MENU_READING_SUBMENU_ID: &str = "reader.menu.reading";

const MENU_FONT_CURRENT: &str = "reader.font.current";
const MENU_FONT_INCREASE: &str = "reader.font.increase";
const MENU_FONT_DECREASE: &str = "reader.font.decrease";
const MENU_FONT_RESET: &str = "reader.font.reset";
const MENU_THEME_GREEN: &str = "reader.theme.green";
const MENU_THEME_PAPER: &str = "reader.theme.paper";
const MENU_THEME_GRAY: &str = "reader.theme.gray";
const MENU_THEME_WARM: &str = "reader.theme.warm";
const MENU_THEME_CUSTOM: &str = "reader.theme.custom";
const MENU_TRANSLATION_CURRENT: &str = "reader.translation.current";
const MENU_TRANSLATION_OFF: &str = "reader.translation.off";
const MENU_TRANSLATION_EN_ZH: &str = "reader.translation.en_zh";
const MENU_TRANSLATION_ZH_EN: &str = "reader.translation.zh_en";
const MENU_OPEN_SETTINGS: &str = "reader.action.open_settings";
const MENU_TOGGLE_MAXIMIZE: &str = "reader.action.toggle_maximize";
const MENU_TOGGLE_HEADER_TOOLS: &str = "reader.action.toggle_header_tools";
const MENU_NEXT_PAGE: &str = "reader.action.next_page";
const MENU_PREV_PAGE: &str = "reader.action.prev_page";

const MIN_FONT_SIZE: u32 = 14;
const MAX_FONT_SIZE: u32 = 28;

fn is_chinese_locale() -> bool {
    std::env::var("LC_ALL")
        .or_else(|_| std::env::var("LANG"))
        .map(|locale| locale.to_lowercase().starts_with("zh"))
        .unwrap_or(false)
}

fn clamp_font_size(size: u32) -> u32 {
    size.clamp(MIN_FONT_SIZE, MAX_FONT_SIZE)
}

fn font_size_label(font_size: u32, zh: bool) -> String {
    let size = clamp_font_size(font_size);
    if zh {
        format!("当前字号: {}", size)
    } else {
        format!("Font Size: {}", size)
    }
}

fn normalize_translation_direction(direction: &str) -> &'static str {
    if direction == "zh-en" {
        "zh-en"
    } else if direction == "off" {
        "off"
    } else {
        "en-zh"
    }
}

fn translation_direction_label(direction: &str, zh: bool) -> String {
    let direction = normalize_translation_direction(direction);
    match (direction, zh) {
        ("off", true) => "当前模式: 关闭".to_string(),
        ("en-zh", true) => "当前方向: 英译中".to_string(),
        ("zh-en", true) => "当前方向: 中译英".to_string(),
        ("off", false) => "Current Mode: Off".to_string(),
        ("en-zh", false) => "Current Direction: English → Chinese".to_string(),
        ("zh-en", false) => "Current Direction: Chinese → English".to_string(),
        _ => "Current Mode: Off".to_string(),
    }
}

fn set_font_size_menu_label<R: tauri::Runtime>(app: &tauri::AppHandle<R>, size: u32, zh: bool) {
    if let Some(menu) = app.menu() {
        if let Some(reading_submenu) = menu
            .get(MENU_READING_SUBMENU_ID)
            .and_then(|item| item.as_submenu().cloned())
        {
            if let Some(font_item) = reading_submenu
                .get(MENU_FONT_CURRENT)
                .and_then(|item| item.as_menuitem().cloned())
            {
                if let Err(err) = font_item.set_text(font_size_label(size, zh)) {
                    tracing::error!("Failed to update font size menu label: {}", err);
                }
            }
        }
    }
}

fn set_translation_menu_label<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    direction: &str,
    zh: bool,
) {
    if let Some(menu) = app.menu() {
        if let Some(reading_submenu) = menu
            .get(MENU_READING_SUBMENU_ID)
            .and_then(|item| item.as_submenu().cloned())
        {
            if let Some(direction_item) = reading_submenu
                .get(MENU_TRANSLATION_CURRENT)
                .and_then(|item| item.as_menuitem().cloned())
            {
                if let Err(err) =
                    direction_item.set_text(translation_direction_label(direction, zh))
                {
                    tracing::error!("Failed to update translation direction menu label: {}", err);
                }
            }
        }
    }
}

fn build_app_menu<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<Menu<R>> {
    let zh = is_chinese_locale();
    let (initial_font_size, initial_translation_direction) = crate::config::load_config()
        .map(|config| {
            (
                clamp_font_size(config.reader_font_size),
                normalize_translation_direction(&config.translation_mode).to_string(),
            )
        })
        .unwrap_or((18, "en-zh".to_string()));
    let menu = Menu::default(app)?;

    let reading_menu = Submenu::with_id_and_items(
        app,
        MENU_READING_SUBMENU_ID,
        if zh { "阅读" } else { "Reading" },
        true,
        &[
            &MenuItem::with_id(
                app,
                MENU_FONT_CURRENT,
                font_size_label(initial_font_size, zh),
                false,
                None::<&str>,
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                MENU_OPEN_SETTINGS,
                if zh { "打开设置" } else { "Open Settings" },
                true,
                Some("CmdOrCtrl+,"),
            )?,
            &MenuItem::with_id(
                app,
                MENU_TOGGLE_MAXIMIZE,
                if zh { "切换最大化窗口" } else { "Toggle Maximize Window" },
                true,
                Some("CmdOrCtrl+Shift+M"),
            )?,
            &MenuItem::with_id(
                app,
                MENU_TOGGLE_HEADER_TOOLS,
                if zh { "切换顶部工具栏" } else { "Toggle Header Toolbar" },
                true,
                Some("CmdOrCtrl+Shift+T"),
            )?,
            &MenuItem::with_id(
                app,
                MENU_NEXT_PAGE,
                if zh { "下一页/下一章节" } else { "Next Page/Section" },
                true,
                Some("PageDown"),
            )?,
            &MenuItem::with_id(
                app,
                MENU_PREV_PAGE,
                if zh { "上一页/上一章节" } else { "Previous Page/Section" },
                true,
                Some("PageUp"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                MENU_FONT_INCREASE,
                if zh {
                    "增大字体"
                } else {
                    "Increase Font Size"
                },
                true,
                Some("CmdOrCtrl+="),
            )?,
            &MenuItem::with_id(
                app,
                MENU_FONT_DECREASE,
                if zh {
                    "减小字体"
                } else {
                    "Decrease Font Size"
                },
                true,
                Some("CmdOrCtrl+-"),
            )?,
            &MenuItem::with_id(
                app,
                MENU_FONT_RESET,
                if zh {
                    "重置字体"
                } else {
                    "Reset Font Size"
                },
                true,
                Some("CmdOrCtrl+0"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                MENU_THEME_GREEN,
                if zh {
                    "护眼主题: 经典绿"
                } else {
                    "Theme: Classic Green"
                },
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                app,
                MENU_THEME_PAPER,
                if zh {
                    "护眼主题: 浅米纸"
                } else {
                    "Theme: Paper Beige"
                },
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                app,
                MENU_THEME_GRAY,
                if zh {
                    "护眼主题: 柔和灰"
                } else {
                    "Theme: Soft Gray"
                },
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                app,
                MENU_THEME_WARM,
                if zh {
                    "护眼主题: 暖杏色"
                } else {
                    "Theme: Warm Apricot"
                },
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                app,
                MENU_THEME_CUSTOM,
                if zh {
                    "自定义主题..."
                } else {
                    "Custom Theme..."
                },
                true,
                None::<&str>,
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                MENU_TRANSLATION_CURRENT,
                translation_direction_label(&initial_translation_direction, zh),
                false,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                app,
                MENU_TRANSLATION_OFF,
                if zh { "Off (关闭)" } else { "Off" },
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                app,
                MENU_TRANSLATION_EN_ZH,
                if zh {
                    "English → Chinese (英译中)"
                } else {
                    "English → Chinese"
                },
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                app,
                MENU_TRANSLATION_ZH_EN,
                if zh {
                    "Chinese → English (中译英)"
                } else {
                    "Chinese → English"
                },
                true,
                None::<&str>,
            )?,
        ],
    )?;

    menu.append(&reading_menu)?;
    Ok(menu)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let zh = is_chinese_locale();
    let (initial_font_size, initial_translation_direction) = crate::config::load_config()
        .map(|config| {
            (
                clamp_font_size(config.reader_font_size),
                normalize_translation_direction(&config.translation_mode).to_string(),
            )
        })
        .unwrap_or((18, "en-zh".to_string()));
    let current_font_size = Arc::new(Mutex::new(initial_font_size));
    let current_font_size_for_menu = Arc::clone(&current_font_size);
    let current_translation_direction = Arc::new(Mutex::new(initial_translation_direction));
    let current_translation_direction_for_menu = Arc::clone(&current_translation_direction);

    tauri::Builder::default()
        .menu(build_app_menu)
        .on_menu_event(move |app, event| {
            let mut font_size_guard = match current_font_size_for_menu.lock() {
                Ok(guard) => guard,
                Err(err) => {
                    tracing::error!("Failed to lock font size state: {}", err);
                    return;
                }
            };
            let mut direction_guard = match current_translation_direction_for_menu.lock() {
                Ok(guard) => guard,
                Err(err) => {
                    tracing::error!("Failed to lock translation direction state: {}", err);
                    return;
                }
            };

            let action = match event.id().as_ref() {
                MENU_FONT_INCREASE => {
                    *font_size_guard = clamp_font_size((*font_size_guard).saturating_add(1));
                    set_font_size_menu_label(app, *font_size_guard, zh);
                    Some("font_increase")
                }
                MENU_FONT_DECREASE => {
                    *font_size_guard = clamp_font_size((*font_size_guard).saturating_sub(1));
                    set_font_size_menu_label(app, *font_size_guard, zh);
                    Some("font_decrease")
                }
                MENU_FONT_RESET => {
                    *font_size_guard = 18;
                    set_font_size_menu_label(app, *font_size_guard, zh);
                    Some("font_reset")
                }
                MENU_THEME_GREEN => Some("theme_green"),
                MENU_THEME_PAPER => Some("theme_paper"),
                MENU_THEME_GRAY => Some("theme_gray"),
                MENU_THEME_WARM => Some("theme_warm"),
                MENU_THEME_CUSTOM => Some("theme_custom"),
                MENU_TRANSLATION_OFF => {
                    *direction_guard = "off".to_string();
                    set_translation_menu_label(app, &direction_guard, zh);
                    Some("translation_off")
                }
                MENU_TRANSLATION_EN_ZH => {
                    *direction_guard = "en-zh".to_string();
                    set_translation_menu_label(app, &direction_guard, zh);
                    Some("translation_en_zh")
                }
                MENU_TRANSLATION_ZH_EN => {
                    *direction_guard = "zh-en".to_string();
                    set_translation_menu_label(app, &direction_guard, zh);
                    Some("translation_zh_en")
                }
                MENU_OPEN_SETTINGS => Some("open_settings"),
                MENU_TOGGLE_MAXIMIZE => {
                    if let Some(main_window) = app.get_webview_window("main") {
                        match main_window.is_maximized() {
                            Ok(true) => {
                                if let Err(err) = main_window.unmaximize() {
                                    tracing::error!("Failed to unmaximize window: {}", err);
                                }
                            }
                            Ok(false) => {
                                if let Err(err) = main_window.maximize() {
                                    tracing::error!("Failed to maximize window: {}", err);
                                }
                            }
                            Err(err) => {
                                tracing::error!("Failed to read window maximize state: {}", err);
                            }
                        }
                    } else {
                        tracing::error!("Main window not found for maximize toggle");
                    }
                    None
                }
                MENU_TOGGLE_HEADER_TOOLS => Some("toggle_header_tools"),
                MENU_NEXT_PAGE => Some("next_page"),
                MENU_PREV_PAGE => Some("prev_page"),
                _ => None,
            };

            if let Some(action) = action {
                if let Err(err) = app.emit(MENU_EVENT_NAME, action) {
                    tracing::error!("Failed to emit menu action event: {}", err);
                }
            }
        })
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
            tts_synthesize,
            list_tts_voices,
            get_config,
            update_config,
            mcp_request,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
