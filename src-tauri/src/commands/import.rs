use crate::database;
use crate::error::Result;
use crate::parsers::EpubParser;
use tauri::AppHandle;

#[derive(Clone, serde::Serialize)]
pub struct ImportProgress {
    pub current: usize,
    pub total: usize,
    pub message: String,
}

#[tauri::command]
pub async fn import_epub(
    app_handle: AppHandle,
    file_path: String,
) -> Result<String> {
    // Parse EPUB
    let parser = EpubParser::new(&file_path)?;
    let (metadata, chapters) = parser.parse_all()?;

    // Get database connection
    let conn = database::get_connection(&app_handle)?;

    // Start transaction for data integrity
    let tx = conn.unchecked_transaction()?;

    // Insert document
    let doc = database::insert_document(&tx, metadata)?;

    // Insert sections and paragraphs
    for (title, order_index, href, paragraphs) in chapters {
        let section = database::insert_section(&tx, &doc.id, &title, order_index, &href)?;

        for (para_order, para_text) in paragraphs.iter().enumerate() {
            let location = format!("{}#p{}", href, para_order);
            database::insert_paragraph(
                &tx,
                &doc.id,
                &section.id,
                para_order as i32,
                para_text,
                &location,
            )?;
        }
    }

    // Commit transaction to save all changes atomically
    tx.commit()?;

    Ok(doc.id)
}

#[tauri::command]
pub async fn list_documents(app_handle: AppHandle) -> Result<Vec<crate::models::Document>> {
    let conn = database::get_connection(&app_handle)?;
    let docs = database::list_documents(&conn)?;
    Ok(docs)
}

#[tauri::command]
pub async fn get_document(
    app_handle: AppHandle,
    id: String,
) -> Result<Option<crate::models::Document>> {
    let conn = database::get_connection(&app_handle)?;
    let doc = database::get_document(&conn, &id)?;
    Ok(doc)
}

#[tauri::command]
pub async fn delete_document(app_handle: AppHandle, id: String) -> Result<()> {
    let conn = database::get_connection(&app_handle)?;
    database::delete_document(&conn, &id)?;
    Ok(())
}
