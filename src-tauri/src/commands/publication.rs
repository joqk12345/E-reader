use crate::database;
use crate::publication::archive::ArchiveLimits;
use crate::publication::resources::ResourceResolveError;
use crate::publication::sessions::{PublicationSessionError, PublicationSessionRegistry};
use crate::publication::store::PublicationStoreError;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::{AppHandle, State};

const SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublicationOpenRequestV2 {
    pub document_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublicationResourceRequestV2 {
    pub session_id: String,
    pub base_href: String,
    pub href: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublicationCloseRequestV2 {
    pub session_id: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PublicationSessionV2 {
    pub schema_version: u32,
    pub session_id: String,
    pub document_id: String,
    pub resource_sizes: HashMap<String, u64>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PublicationTextV2 {
    pub schema_version: u32,
    pub text: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PublicationBlobV2 {
    pub schema_version: u32,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PublicationSizeV2 {
    pub schema_version: u32,
    pub size: u64,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PublicationCommandErrorV2 {
    pub code: String,
    pub message: String,
    pub recoverable: bool,
}

fn internal_error(message: impl Into<String>) -> PublicationCommandErrorV2 {
    PublicationCommandErrorV2 {
        code: "publication.internal".into(),
        message: message.into(),
        recoverable: false,
    }
}

fn command_error(
    code: &str,
    message: impl Into<String>,
    recoverable: bool,
) -> PublicationCommandErrorV2 {
    PublicationCommandErrorV2 {
        code: code.into(),
        message: message.into(),
        recoverable,
    }
}

fn map_session_error(error: PublicationSessionError) -> PublicationCommandErrorV2 {
    let message = error.to_string();
    match error {
        PublicationSessionError::SessionNotFound(_) => {
            command_error("publication.session_not_found", message, true)
        }
        PublicationSessionError::StateUnavailable => internal_error(message),
        PublicationSessionError::Store(PublicationStoreError::Resolve(resolve_error)) => {
            match resolve_error {
                ResourceResolveError::ResourceNotAllowed(_) => {
                    command_error("publication.resource_not_found", message, true)
                }
                ResourceResolveError::ExternalReference(_) => {
                    command_error("publication.external_resource_blocked", message, false)
                }
                ResourceResolveError::BaseNotAllowed(_)
                | ResourceResolveError::UnsafeReference(_)
                | ResourceResolveError::InvalidResourcePath(_) => {
                    command_error("publication.resource_unsafe", message, false)
                }
            }
        }
        PublicationSessionError::Store(PublicationStoreError::Archive(_)) => {
            command_error("publication.archive_unsafe", message, false)
        }
        PublicationSessionError::Store(PublicationStoreError::InvalidText(_)) => {
            command_error("publication.resource_invalid_text", message, true)
        }
        PublicationSessionError::Store(PublicationStoreError::Io(_))
        | PublicationSessionError::Store(PublicationStoreError::ResourceSizeMismatch { .. }) => {
            internal_error(message)
        }
    }
}

fn open_for_document(
    conn: &Connection,
    registry: &PublicationSessionRegistry,
    request: PublicationOpenRequestV2,
) -> Result<PublicationSessionV2, PublicationCommandErrorV2> {
    let document = database::get_document(conn, &request.document_id)
        .map_err(|error| internal_error(error.to_string()))?
        .ok_or_else(|| {
            command_error(
                "publication.document_not_found",
                format!("Document not found: {}", request.document_id),
                true,
            )
        })?;
    if document.file_type != "epub" {
        return Err(command_error(
            "publication.unsupported_format",
            format!("Document is not an EPUB: {}", request.document_id),
            false,
        ));
    }

    let session_id = registry
        .open(&document.id, &document.file_path, ArchiveLimits::default())
        .map_err(map_session_error)?;
    let resource_sizes = match registry.resource_sizes(&session_id) {
        Ok(sizes) => sizes,
        Err(error) => {
            let _ = registry.close(&session_id);
            return Err(map_session_error(error));
        }
    };
    Ok(PublicationSessionV2 {
        schema_version: SCHEMA_VERSION,
        session_id,
        document_id: document.id,
        resource_sizes,
    })
}

fn load_text(
    registry: &PublicationSessionRegistry,
    request: PublicationResourceRequestV2,
) -> Result<PublicationTextV2, PublicationCommandErrorV2> {
    let text = registry
        .load_text(&request.session_id, &request.base_href, &request.href)
        .map_err(map_session_error)?;
    Ok(PublicationTextV2 {
        schema_version: SCHEMA_VERSION,
        text,
    })
}

fn load_blob(
    registry: &PublicationSessionRegistry,
    request: PublicationResourceRequestV2,
) -> Result<PublicationBlobV2, PublicationCommandErrorV2> {
    let bytes = registry
        .load_blob(&request.session_id, &request.base_href, &request.href)
        .map_err(map_session_error)?;
    Ok(PublicationBlobV2 {
        schema_version: SCHEMA_VERSION,
        bytes,
    })
}

fn get_size(
    registry: &PublicationSessionRegistry,
    request: PublicationResourceRequestV2,
) -> Result<PublicationSizeV2, PublicationCommandErrorV2> {
    let size = registry
        .get_size(&request.session_id, &request.base_href, &request.href)
        .map_err(map_session_error)?;
    Ok(PublicationSizeV2 {
        schema_version: SCHEMA_VERSION,
        size,
    })
}

#[tauri::command]
pub fn publication_open_v2(
    app_handle: AppHandle,
    registry: State<'_, PublicationSessionRegistry>,
    request: PublicationOpenRequestV2,
) -> Result<PublicationSessionV2, PublicationCommandErrorV2> {
    let conn =
        database::get_connection(&app_handle).map_err(|error| internal_error(error.to_string()))?;
    open_for_document(&conn, &registry, request)
}

#[tauri::command]
pub fn publication_load_text_v2(
    registry: State<'_, PublicationSessionRegistry>,
    request: PublicationResourceRequestV2,
) -> Result<PublicationTextV2, PublicationCommandErrorV2> {
    load_text(&registry, request)
}

#[tauri::command]
pub fn publication_load_blob_v2(
    registry: State<'_, PublicationSessionRegistry>,
    request: PublicationResourceRequestV2,
) -> Result<PublicationBlobV2, PublicationCommandErrorV2> {
    load_blob(&registry, request)
}

#[tauri::command]
pub fn publication_get_size_v2(
    registry: State<'_, PublicationSessionRegistry>,
    request: PublicationResourceRequestV2,
) -> Result<PublicationSizeV2, PublicationCommandErrorV2> {
    get_size(&registry, request)
}

#[tauri::command]
pub fn publication_close_v2(
    registry: State<'_, PublicationSessionRegistry>,
    request: PublicationCloseRequestV2,
) -> Result<(), PublicationCommandErrorV2> {
    registry
        .close(&request.session_id)
        .map_err(map_session_error)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::params;
    use serde_json::json;
    use std::path::PathBuf;

    fn fixture(name: &str) -> String {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../tests/fixtures/epub")
            .join(name)
            .to_string_lossy()
            .into_owned()
    }

    fn documents() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE documents (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                author TEXT,
                language TEXT,
                file_path TEXT NOT NULL,
                file_type TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );",
        )
        .unwrap();
        conn
    }

    fn insert_document(conn: &Connection, id: &str, file_type: &str, file_path: &str) {
        conn.execute(
            "INSERT INTO documents VALUES (?1, 'Fixture', NULL, NULL, ?2, ?3, 0, 0)",
            params![id, file_path, file_type],
        )
        .unwrap();
    }

    #[test]
    fn open_request_accepts_only_document_identity_not_an_arbitrary_path() {
        let request: PublicationOpenRequestV2 =
            serde_json::from_value(json!({ "documentId": "doc-1" })).unwrap();
        assert_eq!(request.document_id, "doc-1");
        assert!(serde_json::from_value::<PublicationOpenRequestV2>(json!({
            "documentId": "doc-1",
            "filePath": "/etc/passwd"
        }))
        .is_err());
    }

    #[test]
    fn opens_from_database_document_and_serves_versioned_resource_dtos() {
        let conn = documents();
        insert_document(&conn, "doc-epub", "epub", &fixture("minimal-epub3.epub"));
        let registry = PublicationSessionRegistry::default();
        let session = open_for_document(
            &conn,
            &registry,
            PublicationOpenRequestV2 {
                document_id: "doc-epub".into(),
            },
        )
        .unwrap();
        assert_eq!(session.schema_version, 1);
        assert_eq!(session.document_id, "doc-epub");
        assert!(session.resource_sizes["EPUB/chapter.xhtml"] > 0);
        assert!(session.resource_sizes["EPUB/image.svg"] > 0);

        let text = load_text(
            &registry,
            PublicationResourceRequestV2 {
                session_id: session.session_id.clone(),
                base_href: "EPUB/nav.xhtml".into(),
                href: "chapter.xhtml".into(),
            },
        )
        .unwrap();
        assert_eq!(text.schema_version, 1);
        assert!(text.text.contains("structured text"));
        let optional_missing = load_text(
            &registry,
            PublicationResourceRequestV2 {
                session_id: session.session_id.clone(),
                base_href: String::new(),
                href: "META-INF/encryption.xml".into(),
            },
        )
        .unwrap_err();
        assert_eq!(optional_missing.code, "publication.resource_not_found");

        let size = get_size(
            &registry,
            PublicationResourceRequestV2 {
                session_id: session.session_id.clone(),
                base_href: "EPUB/chapter.xhtml".into(),
                href: "image.svg".into(),
            },
        )
        .unwrap();
        let blob = load_blob(
            &registry,
            PublicationResourceRequestV2 {
                session_id: session.session_id,
                base_href: "EPUB/chapter.xhtml".into(),
                href: "image.svg".into(),
            },
        )
        .unwrap();
        assert_eq!(blob.schema_version, 1);
        assert_eq!(size.size, blob.bytes.len() as u64);
    }

    #[test]
    fn returns_stable_errors_for_missing_non_epub_and_unknown_session_requests() {
        let conn = documents();
        insert_document(&conn, "doc-pdf", "pdf", "/tmp/book.pdf");
        let registry = PublicationSessionRegistry::default();

        let missing = open_for_document(
            &conn,
            &registry,
            PublicationOpenRequestV2 {
                document_id: "missing".into(),
            },
        )
        .unwrap_err();
        assert_eq!(missing.code, "publication.document_not_found");
        assert!(missing.recoverable);

        let unsupported = open_for_document(
            &conn,
            &registry,
            PublicationOpenRequestV2 {
                document_id: "doc-pdf".into(),
            },
        )
        .unwrap_err();
        assert_eq!(unsupported.code, "publication.unsupported_format");

        let unknown = load_text(
            &registry,
            PublicationResourceRequestV2 {
                session_id: "unknown".into(),
                base_href: "EPUB/nav.xhtml".into(),
                href: "chapter.xhtml".into(),
            },
        )
        .unwrap_err();
        assert_eq!(unknown.code, "publication.session_not_found");
        assert!(unknown.recoverable);
    }
}
