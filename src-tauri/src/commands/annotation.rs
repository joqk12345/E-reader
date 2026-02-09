use crate::database;
use crate::error::{ReaderError, Result};
use tauri::AppHandle;

const STYLE_SINGLE_UNDERLINE: &str = "single_underline";
const STYLE_DOUBLE_UNDERLINE: &str = "double_underline";
const STYLE_WAVY_STRIKETHROUGH: &str = "wavy_strikethrough";

#[derive(Clone, serde::Serialize)]
pub struct AnnotationOutput {
    pub id: String,
    pub paragraph_id: String,
    pub selected_text: String,
    pub style: String,
    pub note: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[tauri::command]
pub async fn list_annotations(
    app_handle: AppHandle,
    paragraph_ids: Vec<String>,
) -> Result<Vec<AnnotationOutput>> {
    let conn = database::get_connection(&app_handle)?;
    let annotations = database::list_annotations_by_paragraph_ids(&conn, &paragraph_ids)?;
    Ok(annotations
        .into_iter()
        .map(|item| AnnotationOutput {
            id: item.id,
            paragraph_id: item.paragraph_id,
            selected_text: item.selected_text,
            style: item.style,
            note: item.note,
            created_at: item.created_at,
            updated_at: item.updated_at,
        })
        .collect())
}

#[tauri::command]
pub async fn create_annotation(
    app_handle: AppHandle,
    paragraph_id: String,
    selected_text: String,
    style: String,
    note: Option<String>,
) -> Result<AnnotationOutput> {
    let text = selected_text.trim().to_string();
    if text.is_empty() {
        return Err(ReaderError::InvalidArgument(
            "Selected text cannot be empty".to_string(),
        ));
    }
    if !matches!(
        style.as_str(),
        STYLE_SINGLE_UNDERLINE | STYLE_DOUBLE_UNDERLINE | STYLE_WAVY_STRIKETHROUGH
    ) {
        return Err(ReaderError::InvalidArgument(format!(
            "Unsupported annotation style: {}",
            style
        )));
    }

    let cleaned_note = note.and_then(|v| {
        let trimmed = v.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    });

    let conn = database::get_connection(&app_handle)?;
    let created = database::insert_annotation(
        &conn,
        &paragraph_id,
        &text,
        &style,
        cleaned_note.as_deref(),
    )?;
    Ok(AnnotationOutput {
        id: created.id,
        paragraph_id: created.paragraph_id,
        selected_text: created.selected_text,
        style: created.style,
        note: created.note,
        created_at: created.created_at,
        updated_at: created.updated_at,
    })
}

#[tauri::command]
pub async fn delete_annotation(app_handle: AppHandle, id: String) -> Result<()> {
    let conn = database::get_connection(&app_handle)?;
    database::delete_annotation(&conn, &id)?;
    Ok(())
}
