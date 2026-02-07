use crate::database;
use crate::error::Result;
use crate::parsers::{EpubParser, MarkdownParser, PdfParser};
use tauri::AppHandle;

#[derive(Clone, serde::Serialize)]
pub struct ImportProgress {
    pub current: usize,
    pub total: usize,
    pub message: String,
}

#[tauri::command]
pub async fn import_epub(app_handle: AppHandle, file_path: String) -> Result<String> {
    let mut parser = EpubParser::new(&file_path)?;
    let (metadata, chapters) = parser.parse_all()?;
    import_document_internal(app_handle, metadata, chapters).await
}

#[tauri::command]
pub async fn import_pdf(app_handle: AppHandle, file_path: String) -> Result<String> {
    let parser = PdfParser::new(&file_path)?;
    let (metadata, chapters) = parser.parse_all()?;
    import_document_internal(app_handle, metadata, chapters).await
}

#[tauri::command]
pub async fn import_markdown(app_handle: AppHandle, file_path: String) -> Result<String> {
    let parser = MarkdownParser::new(&file_path)?;
    let (metadata, chapters) = parser.parse_all()?;
    import_document_internal(app_handle, metadata, chapters).await
}

async fn import_document_internal(
    app_handle: AppHandle,
    metadata: crate::models::NewDocument,
    chapters: Vec<(String, i32, String, Vec<String>)>,
) -> Result<String> {
    // Get database connection
    let conn = database::get_connection(&app_handle)?;

    // Start transaction for data integrity
    let tx = conn.unchecked_transaction()?;

    // Insert document
    let doc = database::insert_document(&tx, metadata)?;

    tracing::info!(
        "Importing document {} with {} chapters",
        doc.id,
        chapters.len()
    );

    // Insert sections and paragraphs
    for (title, order_index, href, paragraphs) in chapters {
        tracing::info!(
            "Processing chapter {}: {} ({} paragraphs)",
            title,
            href,
            paragraphs.len()
        );

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

        tracing::info!(
            "Inserted {} paragraphs for section {}",
            paragraphs.len(),
            section.id
        );
    }

    // Commit transaction to save all changes atomically
    tx.commit()?;

    tracing::info!("Document import completed successfully");
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

#[tauri::command]
pub async fn get_document_sections(
    app_handle: AppHandle,
    doc_id: String,
) -> Result<Vec<crate::models::Section>> {
    let conn = database::get_connection(&app_handle)?;
    let sections = database::list_sections(&conn, &doc_id)?;
    Ok(sections)
}

#[tauri::command]
pub async fn get_section_paragraphs(
    app_handle: AppHandle,
    section_id: String,
) -> Result<Vec<crate::models::Paragraph>> {
    let conn = database::get_connection(&app_handle)?;
    let paragraphs = database::list_paragraphs_by_section(&conn, &section_id)?;
    Ok(paragraphs)
}
