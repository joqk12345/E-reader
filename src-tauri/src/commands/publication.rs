use crate::database;
use crate::publication::archive::ArchiveLimits;
use crate::publication::importer::{
    import_existing_document_v2, PublicationImportError, PublicationImportLimits,
};
use crate::publication::ingest::ArchiveIngestError;
use crate::publication::locator::{validate_locator_v1, PublicationLocatorV1};
use crate::publication::resources::ResourceResolveError;
use crate::publication::sessions::{
    PublicationContentPolicy, PublicationSessionError, PublicationSessionRegistry,
};
use crate::publication::store::PublicationStoreError;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use tauri::{AppHandle, Manager, State};

const SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublicationOpenRequestV2 {
    pub document_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublicationImportExistingRequestV2 {
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublicationGetBlocksRequestV2 {
    pub document_id: String,
    pub offset: Option<u32>,
    pub limit: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublicationGetPositionRequestV2 {
    pub document_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublicationSavePositionRequestV2 {
    pub document_id: String,
    pub locator: PublicationLocatorV1,
    pub progression: Option<f64>,
    pub updated_at: i64,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PublicationRenderModeV2 {
    Sanitized,
    LegacyRaw,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PublicationResourceSizeBasisV2 {
    ArchiveUncompressed,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PublicationSessionV2 {
    pub schema_version: u32,
    pub session_id: String,
    pub document_id: String,
    pub publication_id: Option<String>,
    pub source_hash: Option<String>,
    pub render_mode: PublicationRenderModeV2,
    pub content_policy_version: Option<u32>,
    pub resource_size_basis: PublicationResourceSizeBasisV2,
    pub resource_sizes: HashMap<String, u64>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PublicationImportExistingV2 {
    pub schema_version: u32,
    pub publication_id: String,
    pub document_id: String,
    pub source_hash: String,
    pub reused: bool,
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

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PublicationBlockV2 {
    pub id: String,
    pub spine_index: u32,
    pub block_index: u32,
    pub href: String,
    pub kind: String,
    pub plain_text: String,
    pub language: Option<String>,
    pub direction: Option<String>,
    pub locator: PublicationLocatorV1,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PublicationBlocksV2 {
    pub schema_version: u32,
    pub publication_id: String,
    pub document_id: String,
    pub source_hash: String,
    pub offset: u32,
    pub limit: u32,
    pub total: u32,
    pub has_more: bool,
    pub blocks: Vec<PublicationBlockV2>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PublicationPositionV2 {
    pub schema_version: u32,
    pub publication_id: String,
    pub document_id: String,
    pub source_hash: String,
    pub locator: PublicationLocatorV1,
    pub progression: Option<f64>,
    pub updated_at: i64,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PublicationSavePositionV2 {
    #[serde(flatten)]
    pub position: PublicationPositionV2,
    pub accepted: bool,
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
        PublicationSessionError::ContentRefused { .. } => {
            command_error("publication.content_refused", message, false)
        }
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

fn map_import_error(error: PublicationImportError) -> PublicationCommandErrorV2 {
    let message = error.to_string();
    match error {
        PublicationImportError::DocumentNotFound(_) => {
            command_error("publication.document_not_found", message, true)
        }
        PublicationImportError::UnsupportedFormat(_) => {
            command_error("publication.unsupported_format", message, false)
        }
        PublicationImportError::SourceChanged => {
            command_error("publication.source_changed", message, true)
        }
        PublicationImportError::ContentRefused { .. } | PublicationImportError::Blocks(_) => {
            command_error("publication.content_refused", message, false)
        }
        PublicationImportError::Archive(ArchiveIngestError::SourceNotRegular(_))
        | PublicationImportError::Archive(ArchiveIngestError::Io(_)) => {
            command_error("publication.source_unavailable", message, true)
        }
        PublicationImportError::Archive(ArchiveIngestError::SourceTooLarge { .. })
        | PublicationImportError::Archive(ArchiveIngestError::UnsafeArchive(_)) => {
            command_error("publication.archive_unsafe", message, false)
        }
        PublicationImportError::Archive(ArchiveIngestError::ExistingObjectUnsafe(_))
        | PublicationImportError::Archive(ArchiveIngestError::ExistingObjectMismatch(_)) => {
            command_error("publication.archive_corrupt", message, false)
        }
        PublicationImportError::Package(_) => {
            command_error("publication.package_invalid", message, false)
        }
        PublicationImportError::Navigation(_) => {
            command_error("publication.navigation_invalid", message, false)
        }
        PublicationImportError::InvalidPrepared(_)
        | PublicationImportError::Commit(_)
        | PublicationImportError::Database(_) => internal_error(message),
    }
}

fn publication_import_v2_enabled() -> bool {
    option_env!("VITE_EPUB_ENGINE") == Some("foliate")
        || std::env::var("READER_PUBLICATION_ENGINE_V2").is_ok_and(|value| value == "1")
        || std::env::var("VITE_EPUB_ENGINE").is_ok_and(|value| value == "foliate")
}

fn import_existing_for_document(
    conn: &Connection,
    publication_root: &Path,
    request: PublicationImportExistingRequestV2,
    enabled: bool,
    imported_at: i64,
) -> Result<PublicationImportExistingV2, PublicationCommandErrorV2> {
    if !enabled {
        return Err(command_error(
            "publication.feature_disabled",
            "V2 publication import is disabled",
            true,
        ));
    }
    let outcome = import_existing_document_v2(
        conn,
        &request.document_id,
        publication_root,
        PublicationImportLimits::default(),
        imported_at,
    )
    .map_err(map_import_error)?;
    Ok(PublicationImportExistingV2 {
        schema_version: SCHEMA_VERSION,
        publication_id: outcome.publication_id,
        document_id: request.document_id,
        source_hash: outcome.source_hash,
        reused: outcome.reused,
    })
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

    let canonical = conn
        .query_row(
            "SELECT id, archive_path, content_policy_version, source_hash
             FROM publications WHERE document_id = ?1",
            [&document.id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        )
        .optional()
        .map_err(|error| internal_error(error.to_string()))?;
    let uses_canonical = canonical.is_some();
    let (session_id, render_mode, content_policy_version, publication_id, source_hash) =
        if let Some((publication_id, archive_path, policy_version, source_hash)) = canonical {
            let policy_version = u32::try_from(policy_version)
                .map_err(|_| internal_error("invalid publication content policy version"))?;
            let mut statement = conn
                .prepare(
                    "SELECT href, media_type FROM publication_resources
                 WHERE publication_id = ?1 ORDER BY href",
                )
                .map_err(|error| internal_error(error.to_string()))?;
            let media_types = statement
                .query_map([&publication_id], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(|error| internal_error(error.to_string()))?
                .collect::<Result<HashMap<_, _>, _>>()
                .map_err(|error| internal_error(error.to_string()))?;
            let session_id = registry.open_sanitized(
                &document.id,
                &archive_path,
                ArchiveLimits::default(),
                PublicationContentPolicy {
                    version: policy_version,
                    media_types,
                },
            );
            (
                session_id,
                PublicationRenderModeV2::Sanitized,
                Some(policy_version),
                Some(publication_id),
                Some(source_hash),
            )
        } else {
            (
                registry.open(&document.id, &document.file_path, ArchiveLimits::default()),
                PublicationRenderModeV2::LegacyRaw,
                None,
                None,
                None,
            )
        };
    let session_id = session_id.map_err(|error| {
        if uses_canonical
            && matches!(
                &error,
                PublicationSessionError::Store(PublicationStoreError::Io(_))
            )
        {
            command_error(
                "publication.canonical_unavailable",
                error.to_string(),
                false,
            )
        } else {
            map_session_error(error)
        }
    })?;
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
        publication_id,
        source_hash,
        render_mode,
        content_policy_version,
        resource_size_basis: PublicationResourceSizeBasisV2::ArchiveUncompressed,
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

fn get_blocks_for_document(
    conn: &Connection,
    request: PublicationGetBlocksRequestV2,
) -> Result<PublicationBlocksV2, PublicationCommandErrorV2> {
    const DEFAULT_LIMIT: u32 = 100;
    const MAX_LIMIT: u32 = 200;
    const MAX_OFFSET: u32 = 50_000;

    let offset = request.offset.unwrap_or(0);
    let limit = request.limit.unwrap_or(DEFAULT_LIMIT);
    if limit == 0 || limit > MAX_LIMIT || offset > MAX_OFFSET {
        return Err(command_error(
            "publication.page_invalid",
            format!("Block page must use limit 1..={MAX_LIMIT} and offset 0..={MAX_OFFSET}"),
            true,
        ));
    }
    let document = database::get_document(conn, &request.document_id)
        .map_err(|error| internal_error(error.to_string()))?
        .ok_or_else(|| {
            command_error(
                "publication.document_not_found",
                format!("Document not found: {}", request.document_id),
                true,
            )
        })?;
    let publication = conn
        .query_row(
            "SELECT id, source_hash FROM publications
             WHERE document_id = ?1 AND import_status = 'ready'",
            [&document.id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(|error| internal_error(error.to_string()))?
        .ok_or_else(|| {
            command_error(
                "publication.not_imported",
                format!("Document has no ready V2 publication: {}", document.id),
                true,
            )
        })?;
    let (publication_id, source_hash) = publication;
    let total_i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM content_blocks WHERE publication_id = ?1",
            [&publication_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| internal_error(error.to_string()))?;
    let total = u32::try_from(total_i64)
        .map_err(|_| internal_error("publication block count is outside the supported range"))?;

    let mut statement = conn
        .prepare(
            "SELECT cb.id, ps.spine_index, cb.block_index, pr.href, pr.media_type,
                    cb.kind, cb.plain_text, cb.language, cb.direction, cb.locator_json,
                    cb.cfi, cb.css_selector, cb.text_quote_prefix, cb.text_quote_exact,
                    cb.text_quote_suffix
             FROM content_blocks cb
             JOIN publication_spine ps
               ON ps.id = cb.spine_item_id AND ps.publication_id = cb.publication_id
             JOIN publication_resources pr
               ON pr.id = ps.resource_id AND pr.publication_id = cb.publication_id
             WHERE cb.publication_id = ?1
             ORDER BY ps.spine_index, cb.block_index, cb.id
             LIMIT ?2 OFFSET ?3",
        )
        .map_err(|error| internal_error(error.to_string()))?;
    let rows = statement
        .query_map(
            params![publication_id, i64::from(limit), i64::from(offset)],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, Option<String>>(7)?,
                    row.get::<_, Option<String>>(8)?,
                    row.get::<_, String>(9)?,
                    row.get::<_, Option<String>>(10)?,
                    row.get::<_, Option<String>>(11)?,
                    row.get::<_, Option<String>>(12)?,
                    row.get::<_, Option<String>>(13)?,
                    row.get::<_, Option<String>>(14)?,
                ))
            },
        )
        .map_err(|error| internal_error(error.to_string()))?;
    let mut blocks = Vec::new();
    for row in rows {
        let (
            id,
            spine_index,
            block_index,
            href,
            media_type,
            kind,
            plain_text,
            language,
            direction,
            locator_json,
            cfi,
            css_selector,
            text_quote_prefix,
            text_quote_exact,
            text_quote_suffix,
        ) = row.map_err(|error| internal_error(error.to_string()))?;
        let locator =
            serde_json::from_str::<PublicationLocatorV1>(&locator_json).map_err(|error| {
                command_error(
                    "publication.locator_invalid",
                    format!("Stored locator for block {id} is invalid: {error}"),
                    false,
                )
            })?;
        validate_locator_v1(&locator, &publication_id, &source_hash, &href).map_err(|error| {
            command_error(
                "publication.locator_invalid",
                format!("Stored locator for block {id} is invalid: {error}"),
                false,
            )
        })?;
        let locator_text = locator.text.as_ref();
        if locator.media_type.as_deref() != Some(media_type.as_str())
            || locator.locations.cfi != cfi
            || locator.locations.css_selector != css_selector
            || locator_text.and_then(|text| text.before.as_ref()) != text_quote_prefix.as_ref()
            || locator_text.and_then(|text| text.highlight.as_ref()) != text_quote_exact.as_ref()
            || locator_text.and_then(|text| text.after.as_ref()) != text_quote_suffix.as_ref()
            || text_quote_exact.as_deref() != Some(plain_text.as_str())
        {
            return Err(command_error(
                "publication.locator_invalid",
                format!("Stored locator fields for block {id} are inconsistent"),
                false,
            ));
        }
        blocks.push(PublicationBlockV2 {
            id,
            spine_index: u32::try_from(spine_index)
                .map_err(|_| internal_error("invalid publication spine index"))?,
            block_index: u32::try_from(block_index)
                .map_err(|_| internal_error("invalid publication block index"))?,
            href,
            kind,
            plain_text,
            language,
            direction,
            locator,
        });
    }
    let has_more = u64::from(offset) + (blocks.len() as u64) < u64::from(total);
    Ok(PublicationBlocksV2 {
        schema_version: SCHEMA_VERSION,
        publication_id,
        document_id: document.id,
        source_hash,
        offset,
        limit,
        total,
        has_more,
        blocks,
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

fn position_publication(
    conn: &Connection,
    document_id: &str,
) -> Result<(String, String), PublicationCommandErrorV2> {
    let document = database::get_document(conn, document_id)
        .map_err(|error| internal_error(error.to_string()))?
        .ok_or_else(|| {
            command_error(
                "publication.document_not_found",
                format!("Document not found: {document_id}"),
                true,
            )
        })?;
    if document.file_type != "epub" {
        return Err(command_error(
            "publication.unsupported_format",
            format!("Document is not an EPUB: {document_id}"),
            false,
        ));
    }
    conn.query_row(
        "SELECT id, source_hash FROM publications
         WHERE document_id = ?1 AND import_status = 'ready'",
        [document.id],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
    )
    .optional()
    .map_err(|error| internal_error(error.to_string()))?
    .ok_or_else(|| {
        command_error(
            "publication.not_imported",
            format!("Document has no ready V2 publication: {document_id}"),
            true,
        )
    })
}

fn read_position_for_publication(
    conn: &Connection,
    publication_id: &str,
    document_id: &str,
    source_hash: &str,
) -> Result<Option<PublicationPositionV2>, PublicationCommandErrorV2> {
    let row = conn
        .query_row(
            "SELECT locator_json, progression, updated_at
             FROM reading_positions WHERE publication_id = ?1",
            [publication_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<f64>>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|error| internal_error(error.to_string()))?;
    let Some((locator_json, progression, updated_at)) = row else {
        return Ok(None);
    };
    let locator = serde_json::from_str::<PublicationLocatorV1>(&locator_json).map_err(|error| {
        command_error(
            "publication.locator_invalid",
            format!("Stored reading position locator is invalid: {error}"),
            false,
        )
    })?;
    validate_locator_v1(&locator, publication_id, source_hash, &locator.href).map_err(|error| {
        command_error(
            "publication.locator_invalid",
            format!("Stored reading position locator is invalid: {error}"),
            false,
        )
    })?;
    Ok(Some(PublicationPositionV2 {
        schema_version: SCHEMA_VERSION,
        publication_id: publication_id.into(),
        document_id: document_id.into(),
        source_hash: source_hash.into(),
        locator,
        progression,
        updated_at,
    }))
}

fn get_position_for_document(
    conn: &Connection,
    request: PublicationGetPositionRequestV2,
) -> Result<Option<PublicationPositionV2>, PublicationCommandErrorV2> {
    let (publication_id, source_hash) = position_publication(conn, &request.document_id)?;
    read_position_for_publication(conn, &publication_id, &request.document_id, &source_hash)
}

fn save_position_for_document(
    conn: &Connection,
    request: PublicationSavePositionRequestV2,
) -> Result<PublicationSavePositionV2, PublicationCommandErrorV2> {
    if request.updated_at <= 0 {
        return Err(command_error(
            "publication.position_invalid",
            "Reading position updatedAt must be positive",
            true,
        ));
    }
    if !request
        .progression
        .is_none_or(|value| value.is_finite() && (0.0..=1.0).contains(&value))
    {
        return Err(command_error(
            "publication.position_invalid",
            "Reading position progression must be within [0, 1]",
            true,
        ));
    }
    let (publication_id, source_hash) = position_publication(conn, &request.document_id)?;
    validate_locator_v1(
        &request.locator,
        &publication_id,
        &source_hash,
        &request.locator.href,
    )
    .map_err(|error| {
        command_error(
            "publication.locator_invalid",
            format!("Reading position locator is invalid: {error}"),
            true,
        )
    })?;
    let resource_exists: bool = conn
        .query_row(
            "SELECT EXISTS(
               SELECT 1 FROM publication_resources
               WHERE publication_id = ?1 AND href = ?2
             )",
            params![publication_id, request.locator.href],
            |row| row.get(0),
        )
        .map_err(|error| internal_error(error.to_string()))?;
    if !resource_exists {
        return Err(command_error(
            "publication.locator_invalid",
            "Reading position href is not a publication resource",
            true,
        ));
    }

    let locator_json = serde_json::to_string(&request.locator)
        .map_err(|error| internal_error(error.to_string()))?;
    conn.execute(
        "INSERT INTO reading_positions
           (publication_id, locator_json, progression, updated_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(publication_id) DO UPDATE SET
           locator_json = excluded.locator_json,
           progression = excluded.progression,
           updated_at = excluded.updated_at
         WHERE excluded.updated_at > reading_positions.updated_at",
        params![
            publication_id,
            locator_json,
            request.progression,
            request.updated_at
        ],
    )
    .map_err(|error| internal_error(error.to_string()))?;
    let accepted = conn.changes() == 1;
    let position =
        read_position_for_publication(conn, &publication_id, &request.document_id, &source_hash)?
            .ok_or_else(|| internal_error("reading position disappeared after save"))?;
    Ok(PublicationSavePositionV2 { position, accepted })
}

#[tauri::command]
pub fn publication_import_existing_v2(
    app_handle: AppHandle,
    request: PublicationImportExistingRequestV2,
) -> Result<PublicationImportExistingV2, PublicationCommandErrorV2> {
    let conn =
        database::get_connection(&app_handle).map_err(|error| internal_error(error.to_string()))?;
    let app_data = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| internal_error(error.to_string()))?;
    import_existing_for_document(
        &conn,
        &app_data.join("publications"),
        request,
        publication_import_v2_enabled(),
        chrono::Utc::now().timestamp(),
    )
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
pub fn publication_get_blocks_v2(
    app_handle: AppHandle,
    request: PublicationGetBlocksRequestV2,
) -> Result<PublicationBlocksV2, PublicationCommandErrorV2> {
    let conn =
        database::get_connection(&app_handle).map_err(|error| internal_error(error.to_string()))?;
    get_blocks_for_document(&conn, request)
}

#[tauri::command]
pub fn publication_get_position_v2(
    app_handle: AppHandle,
    request: PublicationGetPositionRequestV2,
) -> Result<Option<PublicationPositionV2>, PublicationCommandErrorV2> {
    let conn =
        database::get_connection(&app_handle).map_err(|error| internal_error(error.to_string()))?;
    get_position_for_document(&conn, request)
}

#[tauri::command]
pub fn publication_save_position_v2(
    app_handle: AppHandle,
    request: PublicationSavePositionRequestV2,
) -> Result<PublicationSavePositionV2, PublicationCommandErrorV2> {
    let conn =
        database::get_connection(&app_handle).map_err(|error| internal_error(error.to_string()))?;
    save_position_for_document(&conn, request)
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
    use serde_json::json;
    use std::fs;
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
            );
            CREATE TABLE publications (
                id TEXT PRIMARY KEY,
                document_id TEXT NOT NULL UNIQUE,
                archive_path TEXT NOT NULL,
                content_policy_version INTEGER NOT NULL DEFAULT 1,
                source_hash TEXT NOT NULL DEFAULT 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                import_status TEXT NOT NULL DEFAULT 'ready'
            );
            CREATE TABLE publication_resources (
                publication_id TEXT NOT NULL,
                href TEXT NOT NULL,
                media_type TEXT NOT NULL
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
    fn import_request_accepts_only_document_identity_and_honors_the_feature_flag() {
        let request: PublicationImportExistingRequestV2 =
            serde_json::from_value(json!({ "documentId": "doc-1" })).unwrap();
        assert_eq!(request.document_id, "doc-1");
        assert!(
            serde_json::from_value::<PublicationImportExistingRequestV2>(json!({
                "documentId": "doc-1",
                "filePath": "/tmp/untrusted.epub"
            }))
            .is_err()
        );

        let conn = documents();
        let root =
            std::env::temp_dir().join(format!("reader-disabled-import-{}", uuid::Uuid::new_v4()));
        let error = import_existing_for_document(
            &conn,
            &root,
            PublicationImportExistingRequestV2 {
                document_id: "doc-1".into(),
            },
            false,
            100,
        )
        .unwrap_err();
        assert_eq!(error.code, "publication.feature_disabled");
        assert!(!root.exists());
    }

    #[test]
    fn enabled_import_command_runs_the_existing_document_pipeline() {
        let root =
            std::env::temp_dir().join(format!("reader-command-import-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let db_path = root.join("reader.db");
        let conn = Connection::open(&db_path).unwrap();
        database::create_tables(&conn).unwrap();
        drop(conn);
        database::v2_schema::migrate_v2_database(&db_path, &root.join("before-v2.bak")).unwrap();
        let conn = Connection::open(&db_path).unwrap();
        insert_document(&conn, "doc-epub", "epub", &fixture("minimal-epub3.epub"));

        let response = import_existing_for_document(
            &conn,
            &root.join("publications"),
            PublicationImportExistingRequestV2 {
                document_id: "doc-epub".into(),
            },
            true,
            100,
        )
        .unwrap();

        assert_eq!(response.schema_version, 1);
        assert_eq!(response.document_id, "doc-epub");
        assert_eq!(response.source_hash.len(), 64);
        let blocks = get_blocks_for_document(
            &conn,
            PublicationGetBlocksRequestV2 {
                document_id: "doc-epub".into(),
                offset: None,
                limit: None,
            },
        )
        .unwrap();
        assert_eq!(blocks.publication_id, response.publication_id);
        assert_eq!(blocks.source_hash, response.source_hash);
        assert!(!blocks.blocks.is_empty());
        assert_eq!(blocks.blocks[0].locator.locations.cfi, None);
        let publication_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM publications", [], |row| row.get(0))
            .unwrap();
        assert_eq!(publication_count, 1);
        drop(conn);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn reading_position_is_identity_bound_and_stale_writes_cannot_regress_it() {
        let root =
            std::env::temp_dir().join(format!("reader-position-command-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let db_path = root.join("reader.db");
        let conn = Connection::open(&db_path).unwrap();
        database::create_tables(&conn).unwrap();
        drop(conn);
        database::v2_schema::migrate_v2_database(&db_path, &root.join("before-v2.bak")).unwrap();
        let conn = Connection::open(&db_path).unwrap();
        insert_document(&conn, "doc-epub", "epub", &fixture("minimal-epub3.epub"));
        let imported = import_existing_for_document(
            &conn,
            &root.join("publications"),
            PublicationImportExistingRequestV2 {
                document_id: "doc-epub".into(),
            },
            true,
            100,
        )
        .unwrap();
        let block = get_blocks_for_document(
            &conn,
            PublicationGetBlocksRequestV2 {
                document_id: "doc-epub".into(),
                offset: Some(0),
                limit: Some(1),
            },
        )
        .unwrap()
        .blocks
        .remove(0);

        let first = save_position_for_document(
            &conn,
            PublicationSavePositionRequestV2 {
                document_id: "doc-epub".into(),
                locator: block.locator.clone(),
                progression: Some(0.25),
                updated_at: 200,
            },
        )
        .unwrap();
        assert!(first.accepted);
        assert_eq!(first.position.publication_id, imported.publication_id);
        assert_eq!(first.position.progression, Some(0.25));

        let stale = save_position_for_document(
            &conn,
            PublicationSavePositionRequestV2 {
                document_id: "doc-epub".into(),
                locator: block.locator.clone(),
                progression: Some(0.75),
                updated_at: 100,
            },
        )
        .unwrap();
        assert!(!stale.accepted);
        assert_eq!(stale.position.progression, Some(0.25));
        assert_eq!(stale.position.updated_at, 200);

        let current = get_position_for_document(
            &conn,
            PublicationGetPositionRequestV2 {
                document_id: "doc-epub".into(),
            },
        )
        .unwrap()
        .unwrap();
        assert_eq!(current.locator, block.locator);
        assert_eq!(current.progression, Some(0.25));

        assert!(
            serde_json::from_value::<PublicationGetPositionRequestV2>(json!({
                "documentId": "doc-epub",
                "filePath": "/tmp/untrusted.epub"
            }))
            .is_err()
        );
        let invalid = save_position_for_document(
            &conn,
            PublicationSavePositionRequestV2 {
                document_id: "doc-epub".into(),
                locator: PublicationLocatorV1 {
                    publication_id: "other-publication".into(),
                    ..block.locator
                },
                progression: Some(0.5),
                updated_at: 300,
            },
        )
        .unwrap_err();
        assert_eq!(invalid.code, "publication.locator_invalid");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn open_prefers_the_v2_canonical_archive_and_does_not_mask_its_corruption() {
        let conn = documents();
        insert_document(
            &conn,
            "doc-canonical",
            "epub",
            &fixture("short-toc-epub2.epub"),
        );
        conn.execute(
            "INSERT INTO publications (id, document_id, archive_path, content_policy_version)
             VALUES ('publication-1', 'doc-canonical', ?1, 1)",
            [fixture("minimal-epub3.epub")],
        )
        .unwrap();
        for (href, media_type) in [
            ("EPUB/chapter.xhtml", "application/xhtml+xml"),
            ("EPUB/image.svg", "image/svg+xml"),
            ("EPUB/nav.xhtml", "application/xhtml+xml"),
        ] {
            conn.execute(
                "INSERT INTO publication_resources (publication_id, href, media_type)
                 VALUES ('publication-1', ?1, ?2)",
                params![href, media_type],
            )
            .unwrap();
        }
        let registry = PublicationSessionRegistry::default();
        let session = open_for_document(
            &conn,
            &registry,
            PublicationOpenRequestV2 {
                document_id: "doc-canonical".into(),
            },
        )
        .unwrap();
        assert!(session.resource_sizes.contains_key("EPUB/chapter.xhtml"));
        assert!(!session.resource_sizes.contains_key("OEBPS/one.xhtml"));
        assert_eq!(session.render_mode, PublicationRenderModeV2::Sanitized);
        assert_eq!(session.content_policy_version, Some(1));
        registry.close(&session.session_id).unwrap();

        conn.execute(
            "UPDATE publications SET archive_path = '/missing/canonical.epub'
             WHERE id = 'publication-1'",
            [],
        )
        .unwrap();
        let error = open_for_document(
            &conn,
            &registry,
            PublicationOpenRequestV2 {
                document_id: "doc-canonical".into(),
            },
        )
        .unwrap_err();
        assert_eq!(error.code, "publication.canonical_unavailable");
    }

    #[test]
    fn canonical_command_session_serves_sanitized_manifest_resources_end_to_end() {
        let conn = documents();
        insert_document(
            &conn,
            "doc-active",
            "epub",
            &fixture("short-toc-epub2.epub"),
        );
        conn.execute(
            "INSERT INTO publications (id, document_id, archive_path, content_policy_version)
             VALUES ('publication-active', 'doc-active', ?1, 1)",
            [fixture("active-content-epub3.epub")],
        )
        .unwrap();
        for (href, media_type) in [
            ("EPUB/chapter.xhtml", "application/xhtml+xml"),
            ("EPUB/nav.xhtml", "application/xhtml+xml"),
            ("EPUB/style.css", "text/css"),
            ("EPUB/payload.js", "application/javascript"),
        ] {
            conn.execute(
                "INSERT INTO publication_resources (publication_id, href, media_type)
                 VALUES ('publication-active', ?1, ?2)",
                params![href, media_type],
            )
            .unwrap();
        }
        let registry = PublicationSessionRegistry::default();
        let session = open_for_document(
            &conn,
            &registry,
            PublicationOpenRequestV2 {
                document_id: "doc-active".into(),
            },
        )
        .unwrap();

        assert_eq!(session.render_mode, PublicationRenderModeV2::Sanitized);
        let chapter = load_text(
            &registry,
            PublicationResourceRequestV2 {
                session_id: session.session_id.clone(),
                base_href: String::new(),
                href: "EPUB/chapter.xhtml".into(),
            },
        )
        .unwrap()
        .text;
        assert!(chapter.contains("Active content must remain inert"));
        assert!(!chapter.contains("<script"));
        assert!(!chapter.contains("reader-epub-image-probe"));
        let script_error = load_blob(
            &registry,
            PublicationResourceRequestV2 {
                session_id: session.session_id,
                base_href: String::new(),
                href: "EPUB/payload.js".into(),
            },
        )
        .unwrap_err();
        assert_eq!(script_error.code, "publication.content_refused");
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
        assert_eq!(session.render_mode, PublicationRenderModeV2::LegacyRaw);
        assert_eq!(session.content_policy_version, None);
        assert_eq!(
            session.resource_size_basis,
            PublicationResourceSizeBasisV2::ArchiveUncompressed
        );
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
    fn block_request_is_identity_only_and_uses_bounded_pagination() {
        let request: PublicationGetBlocksRequestV2 = serde_json::from_value(json!({
            "documentId": "doc-1",
            "offset": 1,
            "limit": 1
        }))
        .unwrap();
        assert_eq!(request.document_id, "doc-1");
        assert!(
            serde_json::from_value::<PublicationGetBlocksRequestV2>(json!({
                "documentId": "doc-1",
                "filePath": "/etc/passwd"
            }))
            .is_err()
        );

        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE documents (
                id TEXT PRIMARY KEY, title TEXT NOT NULL, author TEXT, language TEXT,
                file_path TEXT NOT NULL, file_type TEXT NOT NULL,
                created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
             );
             CREATE TABLE publications (
                id TEXT PRIMARY KEY, document_id TEXT NOT NULL UNIQUE,
                source_hash TEXT NOT NULL, import_status TEXT NOT NULL
             );
             CREATE TABLE publication_resources (
                id TEXT PRIMARY KEY, publication_id TEXT NOT NULL,
                href TEXT NOT NULL, media_type TEXT NOT NULL
             );
             CREATE TABLE publication_spine (
                id TEXT PRIMARY KEY, publication_id TEXT NOT NULL,
                resource_id TEXT NOT NULL, spine_index INTEGER NOT NULL
             );
             CREATE TABLE content_blocks (
                id TEXT PRIMARY KEY, publication_id TEXT NOT NULL,
                spine_item_id TEXT NOT NULL, block_index INTEGER NOT NULL,
                kind TEXT NOT NULL, plain_text TEXT NOT NULL,
                language TEXT, direction TEXT, locator_json TEXT NOT NULL,
                cfi TEXT, css_selector TEXT, text_quote_prefix TEXT,
                text_quote_exact TEXT, text_quote_suffix TEXT
             );",
        )
        .unwrap();
        insert_document(&conn, "doc-1", "epub", "/unused.epub");
        conn.execute(
            "INSERT INTO publications VALUES ('publication-1', 'doc-1', ?1, 'ready')",
            ["a".repeat(64)],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO publication_resources VALUES
             ('resource-1', 'publication-1', 'EPUB/chapter.xhtml', 'application/xhtml+xml')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO publication_spine VALUES
             ('spine-1', 'publication-1', 'resource-1', 0)",
            [],
        )
        .unwrap();
        for (index, text) in ["First", "Second", "Third"].into_iter().enumerate() {
            let selector = format!("body > p:nth-of-type({})", index + 1);
            let locator = json!({
                "schemaVersion": 1,
                "publicationId": "publication-1",
                "sourceHash": "a".repeat(64),
                "href": "EPUB/chapter.xhtml",
                "type": "application/xhtml+xml",
                "locations": { "cssSelector": selector },
                "text": { "highlight": text }
            });
            conn.execute(
                "INSERT INTO content_blocks VALUES
                 (?1, 'publication-1', 'spine-1', ?2, 'paragraph', ?3,
                  'en', 'ltr', ?4, NULL, ?5, NULL, ?3, NULL)",
                params![
                    format!("block-{index}"),
                    index as i64,
                    text,
                    locator.to_string(),
                    selector,
                ],
            )
            .unwrap();
        }

        let page = get_blocks_for_document(
            &conn,
            PublicationGetBlocksRequestV2 {
                document_id: "doc-1".into(),
                offset: Some(1),
                limit: Some(1),
            },
        )
        .unwrap();
        assert_eq!(page.schema_version, 1);
        assert_eq!(page.publication_id, "publication-1");
        assert_eq!(page.source_hash, "a".repeat(64));
        assert_eq!(page.total, 3);
        assert!(page.has_more);
        assert_eq!(page.blocks.len(), 1);
        assert_eq!(page.blocks[0].plain_text, "Second");
        assert_eq!(page.blocks[0].href, "EPUB/chapter.xhtml");
        assert_eq!(page.blocks[0].spine_index, 0);
        assert_eq!(page.blocks[0].block_index, 1);

        let invalid_page = get_blocks_for_document(
            &conn,
            PublicationGetBlocksRequestV2 {
                document_id: "doc-1".into(),
                offset: None,
                limit: Some(0),
            },
        )
        .unwrap_err();
        assert_eq!(invalid_page.code, "publication.page_invalid");

        conn.execute(
            "UPDATE content_blocks SET locator_json = '{\"schemaVersion\":99}'
             WHERE id = 'block-1'",
            [],
        )
        .unwrap();
        let corrupt = get_blocks_for_document(
            &conn,
            PublicationGetBlocksRequestV2 {
                document_id: "doc-1".into(),
                offset: Some(1),
                limit: Some(1),
            },
        )
        .unwrap_err();
        assert_eq!(corrupt.code, "publication.locator_invalid");
        assert!(!corrupt.recoverable);
    }

    #[test]
    fn block_query_distinguishes_missing_documents_from_not_imported_documents() {
        let conn = documents();
        insert_document(&conn, "legacy", "epub", "/unused.epub");
        let missing = get_blocks_for_document(
            &conn,
            PublicationGetBlocksRequestV2 {
                document_id: "missing".into(),
                offset: None,
                limit: None,
            },
        )
        .unwrap_err();
        assert_eq!(missing.code, "publication.document_not_found");
        let legacy = get_blocks_for_document(
            &conn,
            PublicationGetBlocksRequestV2 {
                document_id: "legacy".into(),
                offset: None,
                limit: None,
            },
        )
        .unwrap_err();
        assert_eq!(legacy.code, "publication.not_imported");
        assert!(legacy.recoverable);
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
