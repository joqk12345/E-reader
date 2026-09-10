use super::archive::ArchiveLimits;
use super::blocks::{extract_semantic_blocks, BlockExtractionError, BlockExtractionLimits};
use super::content_policy::{classify_render_resource, RenderResourceKind};
use super::css_sanitizer::{sanitize_css, CssSanitizationLimits};
use super::ingest::{ingest_epub_archive, ArchiveIngestError, ArchiveIngestLimits};
use super::navigation::{prepare_navigation, NavigationPrepareError};
use super::package::{prepare_package, PackagePrepareError, PreparedPackage};
use super::resources::PublicationResourceIndex;
use super::sanitizer::{
    sanitize_xhtml, SanitizationDiagnostic, SanitizationLimits, CONTENT_POLICY_VERSION,
};
use super::store::ZipPublicationStore;
use super::svg_sanitizer::sanitize_svg;
use crate::database::publications::{
    commit_publication_import, PreparedContentBlock, PreparedImportReport,
    PreparedNavigationNode as DatabaseNavigationNode, PreparedPublicationImport, PreparedResource,
    PreparedSpineItem, PublicationCommitError,
};
use rusqlite::{Connection, OptionalExtension};
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy)]
pub(crate) struct PublicationImportLimits {
    pub archive: ArchiveIngestLimits,
}

impl Default for PublicationImportLimits {
    fn default() -> Self {
        Self {
            archive: ArchiveIngestLimits {
                archive: ArchiveLimits::default(),
                ..ArchiveIngestLimits::default()
            },
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PublicationImportOutcome {
    pub publication_id: String,
    pub source_hash: String,
    pub archive_path: PathBuf,
    pub reused: bool,
}

#[derive(Debug, thiserror::Error)]
pub(crate) enum PublicationImportError {
    #[error("document does not exist: {0}")]
    DocumentNotFound(String),
    #[error("document is not an EPUB: {0}")]
    UnsupportedFormat(String),
    #[error("document already has a V2 publication for different source bytes")]
    SourceChanged,
    #[error("prepared publication is inconsistent: {0}")]
    InvalidPrepared(String),
    #[error("publication content was refused for {href}: {reason}")]
    ContentRefused { href: String, reason: String },
    #[error(transparent)]
    Blocks(#[from] BlockExtractionError),
    #[error(transparent)]
    Archive(#[from] ArchiveIngestError),
    #[error(transparent)]
    Package(#[from] PackagePrepareError),
    #[error(transparent)]
    Navigation(#[from] NavigationPrepareError),
    #[error(transparent)]
    Commit(#[from] PublicationCommitError),
    #[error("publication import database error: {0}")]
    Database(#[from] rusqlite::Error),
}

fn record_diagnostics(
    grouped: &mut BTreeMap<(String, String), u32>,
    href: &str,
    diagnostics: &[SanitizationDiagnostic],
) {
    for diagnostic in diagnostics {
        *grouped
            .entry((href.to_string(), diagnostic.code.clone()))
            .or_default() += diagnostic.count;
    }
}

struct PreparedContentPolicy {
    reports: Vec<PreparedImportReport>,
    sanitized_xhtml: HashMap<String, Vec<u8>>,
}

fn prepare_content_policy_reports(
    archive_path: &Path,
    package: &PreparedPackage,
    limits: ArchiveLimits,
    imported_at: i64,
) -> Result<PreparedContentPolicy, PublicationImportError> {
    let resources = PublicationResourceIndex::new(
        package
            .resources
            .iter()
            .map(|resource| resource.href.clone()),
    )
    .map_err(|error| PublicationImportError::ContentRefused {
        href: "<manifest>".into(),
        reason: error.to_string(),
    })?;
    let mut store = ZipPublicationStore::open(archive_path, limits).map_err(|error| {
        PublicationImportError::ContentRefused {
            href: "<publication>".into(),
            reason: error.to_string(),
        }
    })?;
    let mut grouped = BTreeMap::<(String, String), u32>::new();
    let mut sanitized_xhtml = HashMap::new();

    for resource in &package.resources {
        let kind = classify_render_resource(&resource.href, Some(&resource.media_type)).map_err(
            |error| PublicationImportError::ContentRefused {
                href: resource.href.clone(),
                reason: error.to_string(),
            },
        )?;
        if resource
            .properties
            .iter()
            .any(|property| property == "scripted")
        {
            *grouped
                .entry((
                    resource.href.clone(),
                    "publication.active_content_removed".into(),
                ))
                .or_default() += 1;
        }
        if kind == RenderResourceKind::Script {
            *grouped
                .entry((
                    resource.href.clone(),
                    "publication.active_content_removed".into(),
                ))
                .or_default() += 1;
            continue;
        }
        if kind == RenderResourceKind::Raw {
            continue;
        }

        let source = store.load_blob("", &resource.href).map_err(|error| {
            PublicationImportError::ContentRefused {
                href: resource.href.clone(),
                reason: error.to_string(),
            }
        })?;
        let diagnostics = match kind {
            RenderResourceKind::Xhtml => {
                let sanitized = sanitize_xhtml(
                    &source,
                    &resource.href,
                    &resources,
                    CONTENT_POLICY_VERSION,
                    SanitizationLimits::default(),
                )
                .map_err(|error| PublicationImportError::ContentRefused {
                    href: resource.href.clone(),
                    reason: error.to_string(),
                })?;
                let diagnostics = sanitized.diagnostics;
                sanitized_xhtml.insert(resource.href.clone(), sanitized.bytes);
                diagnostics
            }
            RenderResourceKind::Css => {
                sanitize_css(
                    &source,
                    &resource.href,
                    &resources,
                    CONTENT_POLICY_VERSION,
                    CssSanitizationLimits::default(),
                )
                .map_err(|error| PublicationImportError::ContentRefused {
                    href: resource.href.clone(),
                    reason: error.to_string(),
                })?
                .diagnostics
            }
            RenderResourceKind::Svg => {
                sanitize_svg(
                    &source,
                    &resource.href,
                    &resources,
                    CONTENT_POLICY_VERSION,
                    SanitizationLimits::default(),
                )
                .map_err(|error| PublicationImportError::ContentRefused {
                    href: resource.href.clone(),
                    reason: error.to_string(),
                })?
                .diagnostics
            }
            RenderResourceKind::Raw | RenderResourceKind::Script => unreachable!(),
        };
        record_diagnostics(&mut grouped, &resource.href, &diagnostics);
    }

    let reports = grouped
        .into_iter()
        .map(|((href, code), count)| PreparedImportReport {
            id: uuid::Uuid::new_v4().to_string(),
            severity: "warning".into(),
            code,
            resource_href: Some(href),
            message: format!(
                "Content policy v{CONTENT_POLICY_VERSION} handled {count} occurrence(s)"
            ),
            created_at: imported_at,
        })
        .collect();
    Ok(PreparedContentPolicy {
        reports,
        sanitized_xhtml,
    })
}

pub(crate) fn import_existing_document_v2(
    conn: &Connection,
    document_id: &str,
    publication_root: &Path,
    limits: PublicationImportLimits,
    imported_at: i64,
) -> Result<PublicationImportOutcome, PublicationImportError> {
    let document = conn
        .query_row(
            "SELECT file_path, file_type FROM documents WHERE id = ?1",
            [document_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    let (source_path, file_type) = document
        .ok_or_else(|| PublicationImportError::DocumentNotFound(document_id.to_string()))?;
    if !file_type.eq_ignore_ascii_case("epub") {
        return Err(PublicationImportError::UnsupportedFormat(file_type));
    }

    let archive = ingest_epub_archive(Path::new(&source_path), publication_root, limits.archive)?;
    let existing = conn
        .query_row(
            "SELECT id, source_hash, archive_path
             FROM publications WHERE document_id = ?1",
            [document_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()?;
    if let Some((publication_id, source_hash, archive_path)) = existing {
        if source_hash != archive.sha256 || Path::new(&archive_path) != archive.path {
            return Err(PublicationImportError::SourceChanged);
        }
        return Ok(PublicationImportOutcome {
            publication_id,
            source_hash,
            archive_path: archive.path,
            reused: true,
        });
    }

    let package = prepare_package(&archive.path, limits.archive.archive)?;
    let (navigation, navigation_warning) =
        match prepare_navigation(&archive.path, &package, limits.archive.archive) {
            Ok(nodes) => (nodes, None),
            Err(NavigationPrepareError::MissingNavigation) => (
                Vec::new(),
                Some("Publication has no author-provided EPUB navigation".to_string()),
            ),
            Err(error) => return Err(error.into()),
        };

    let content_policy = prepare_content_policy_reports(
        &archive.path,
        &package,
        limits.archive.archive,
        imported_at,
    )?;

    let publication_id = uuid::Uuid::new_v4().to_string();
    let mut resource_ids = HashMap::new();
    for resource in &package.resources {
        resource_ids.insert(
            resource.manifest_id.clone(),
            uuid::Uuid::new_v4().to_string(),
        );
    }
    let resources = package
        .resources
        .iter()
        .map(|resource| {
            let fallback_href = resource
                .fallback_manifest_id
                .as_ref()
                .map(|fallback| {
                    package
                        .resources
                        .iter()
                        .find(|candidate| candidate.manifest_id == *fallback)
                        .map(|candidate| candidate.href.clone())
                        .ok_or_else(|| {
                            PublicationImportError::InvalidPrepared(format!(
                                "unknown fallback manifest id: {fallback}"
                            ))
                        })
                })
                .transpose()?;
            Ok(PreparedResource {
                id: resource_ids[&resource.manifest_id].clone(),
                href: resource.href.clone(),
                media_type: resource.media_type.clone(),
                properties: resource.properties.clone(),
                sha256: resource.sha256.clone(),
                size: resource.size,
                fallback_href,
            })
        })
        .collect::<Result<Vec<_>, PublicationImportError>>()?;

    let spine = package
        .spine
        .iter()
        .map(|item| {
            let id = uuid::Uuid::new_v4().to_string();
            let resource_id = resource_ids
                .get(&item.manifest_id)
                .cloned()
                .ok_or_else(|| {
                    PublicationImportError::InvalidPrepared(format!(
                        "unknown spine manifest id: {}",
                        item.manifest_id
                    ))
                })?;
            let page_spread = item
                .properties
                .iter()
                .find(|property| property.starts_with("page-spread-"))
                .cloned();
            Ok(PreparedSpineItem {
                id,
                resource_id,
                spine_index: item.spine_index,
                linear: item.linear,
                page_spread,
                properties: item.properties.clone(),
            })
        })
        .collect::<Result<Vec<_>, PublicationImportError>>()?;

    let mut content_blocks = Vec::new();
    for (package_spine_item, prepared_spine_item) in package.spine.iter().zip(&spine) {
        let resource = package
            .resources
            .iter()
            .find(|resource| resource.manifest_id == package_spine_item.manifest_id)
            .ok_or_else(|| {
                PublicationImportError::InvalidPrepared(format!(
                    "unknown spine resource during block extraction: {}",
                    package_spine_item.manifest_id
                ))
            })?;
        let kind = classify_render_resource(&resource.href, Some(&resource.media_type)).map_err(
            |error| PublicationImportError::ContentRefused {
                href: resource.href.clone(),
                reason: error.to_string(),
            },
        )?;
        if kind != RenderResourceKind::Xhtml {
            continue;
        }
        let sanitized = content_policy
            .sanitized_xhtml
            .get(&resource.href)
            .ok_or_else(|| {
                PublicationImportError::InvalidPrepared(format!(
                    "missing sanitized spine resource: {}",
                    resource.href
                ))
            })?;
        let remaining_blocks = BlockExtractionLimits::default()
            .max_blocks
            .saturating_sub(content_blocks.len());
        for block in extract_semantic_blocks(
            sanitized,
            &publication_id,
            &archive.sha256,
            &resource.href,
            BlockExtractionLimits {
                max_blocks: remaining_blocks,
            },
        )? {
            content_blocks.push(PreparedContentBlock {
                id: uuid::Uuid::new_v4().to_string(),
                spine_item_id: prepared_spine_item.id.clone(),
                block_index: block.block_index,
                kind: block.kind,
                plain_text: block.plain_text,
                language: block.language,
                direction: block.direction,
                locator: serde_json::to_value(&block.locator).map_err(|error| {
                    PublicationImportError::InvalidPrepared(format!(
                        "semantic block locator serialization failed: {error}"
                    ))
                })?,
                cfi: None,
                css_selector: Some(block.css_selector),
                text_quote_prefix: block.text_quote_prefix,
                text_quote_exact: Some(block.text_quote_exact),
                text_quote_suffix: block.text_quote_suffix,
            });
        }
    }

    let navigation_ids = navigation
        .iter()
        .map(|_| uuid::Uuid::new_v4().to_string())
        .collect::<Vec<_>>();
    let navigation = navigation
        .iter()
        .enumerate()
        .map(|(index, node)| {
            let parent_id = node
                .parent_index
                .map(|parent| {
                    navigation_ids.get(parent).cloned().ok_or_else(|| {
                        PublicationImportError::InvalidPrepared(format!(
                            "navigation parent index is out of range: {parent}"
                        ))
                    })
                })
                .transpose()?;
            Ok(DatabaseNavigationNode {
                id: navigation_ids[index].clone(),
                parent_id,
                kind: "toc".into(),
                label: node.label.clone(),
                href: node.href.clone(),
                fragment: node.fragment.clone(),
                order_index: node.order_index,
                depth: node.depth,
            })
        })
        .collect::<Result<Vec<_>, PublicationImportError>>()?;

    let mut reports = vec![PreparedImportReport {
        id: uuid::Uuid::new_v4().to_string(),
        severity: "info".into(),
        code: "publication.imported".into(),
        resource_href: None,
        message: "Publication archive, package, navigation, and semantic blocks prepared".into(),
        created_at: imported_at,
    }];
    if let Some(message) = navigation_warning {
        reports.push(PreparedImportReport {
            id: uuid::Uuid::new_v4().to_string(),
            severity: "warning".into(),
            code: "publication.navigation_missing".into(),
            resource_href: None,
            message,
            created_at: imported_at,
        });
    }
    reports.extend(content_policy.reports);

    let prepared = PreparedPublicationImport {
        id: publication_id.clone(),
        document_id: document_id.to_string(),
        rendition_layout: Some(package.metadata.rendition_layout),
        content_policy_version: 1,
        imported_at,
        resources,
        spine,
        navigation,
        content_blocks,
        reports,
    };
    commit_publication_import(conn, &archive, &prepared)?;

    Ok(PublicationImportOutcome {
        publication_id,
        source_hash: archive.sha256,
        archive_path: archive.path,
        reused: archive.reused,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::{create_tables, v2_schema::migrate_v2_database};
    use crate::publication::{archive::ArchiveLimits, store::ZipPublicationStore};
    use std::fs;
    use std::io::{Read, Write};
    use zip::write::SimpleFileOptions;
    use zip::{ZipArchive, ZipWriter};

    struct Workspace(PathBuf);

    impl Workspace {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir()
                .join(format!("reader-v2-import-{name}-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn path(&self, name: &str) -> PathBuf {
            self.0.join(name)
        }
    }

    impl Drop for Workspace {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn fixture(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../tests/fixtures/epub")
            .join(name)
    }

    fn database(path: &Path, source: &Path, file_type: &str) -> Connection {
        let conn = Connection::open(path).unwrap();
        create_tables(&conn).unwrap();
        drop(conn);
        migrate_v2_database(path, &path.with_extension("before-v2.bak")).unwrap();
        let conn = Connection::open(path).unwrap();
        conn.execute("PRAGMA foreign_keys = ON", []).unwrap();
        conn.execute(
            "INSERT INTO documents
             (id, title, file_path, file_type, created_at, updated_at)
             VALUES ('document-1', 'Book', ?1, ?2, 1, 1)",
            rusqlite::params![source.to_string_lossy(), file_type],
        )
        .unwrap();
        conn
    }

    fn count(conn: &Connection, table: &str) -> i64 {
        conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
            row.get(0)
        })
        .unwrap()
    }

    fn report_codes(conn: &Connection) -> Vec<(String, Option<String>)> {
        let mut statement = conn
            .prepare(
                "SELECT code, resource_href FROM import_reports
                 ORDER BY code, resource_href",
            )
            .unwrap();
        statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    }

    #[test]
    fn imports_an_existing_document_from_database_identity_through_every_v2_layer() {
        let workspace = Workspace::new("complete");
        let source = workspace.path("selected.epub");
        fs::copy(fixture("minimal-epub3.epub"), &source).unwrap();
        let conn = database(&workspace.path("reader.db"), &source, "epub");
        let publication_root = workspace.path("appdata/publications");

        let outcome = import_existing_document_v2(
            &conn,
            "document-1",
            &publication_root,
            PublicationImportLimits::default(),
            100,
        )
        .unwrap();

        assert!(!outcome.reused);
        assert_eq!(count(&conn, "publications"), 1);
        assert_eq!(count(&conn, "publication_resources"), 4);
        assert_eq!(count(&conn, "publication_spine"), 1);
        assert_eq!(count(&conn, "navigation_nodes"), 2);
        assert_eq!(count(&conn, "content_blocks"), 5);
        assert_eq!(
            count(&conn, "import_reports"),
            1,
            "unexpected reports: {:?}",
            report_codes(&conn)
        );

        let (kind, text, locator_json, cfi, selector, exact): (
            String,
            String,
            String,
            Option<String>,
            Option<String>,
            Option<String>,
        ) = conn
            .query_row(
                "SELECT kind, plain_text, locator_json, cfi, css_selector, text_quote_exact
                 FROM content_blocks ORDER BY block_index LIMIT 1",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!((kind.as_str(), text.as_str()), ("heading-1", "Chapter One"));
        assert_eq!(cfi, None);
        assert_eq!(selector.as_deref(), Some("body > h1:nth-of-type(1)"));
        assert_eq!(exact.as_deref(), Some("Chapter One"));
        let locator: serde_json::Value = serde_json::from_str(&locator_json).unwrap();
        assert_eq!(locator["publicationId"], outcome.publication_id);
        assert_eq!(locator["sourceHash"], outcome.source_hash);
        assert_eq!(locator["href"], "EPUB/chapter.xhtml");
        assert!(locator["locations"].get("cfi").is_none());

        fs::remove_file(source).unwrap();
        let mut store =
            ZipPublicationStore::open(&outcome.archive_path, ArchiveLimits::default()).unwrap();
        assert!(store
            .load_text("EPUB/nav.xhtml", "chapter.xhtml")
            .unwrap()
            .contains("Chapter One"));
    }

    #[test]
    fn imports_table_math_and_footnote_semantics_from_sanitized_spine_dom() {
        let workspace = Workspace::new("structured-blocks");
        let source = fixture("table-footnote-mathml-epub3.epub");
        let conn = database(&workspace.path("reader.db"), &source, "epub");

        import_existing_document_v2(
            &conn,
            "document-1",
            &workspace.path("appdata/publications"),
            PublicationImportLimits::default(),
            100,
        )
        .unwrap();

        let mut statement = conn
            .prepare(
                "SELECT kind, plain_text, cfi, css_selector
                 FROM content_blocks ORDER BY block_index",
            )
            .unwrap();
        let blocks = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();

        assert_eq!(blocks.len(), 7);
        assert!(blocks.contains(&(
            "table-caption".into(),
            "Sample values".into(),
            None,
            Some("body > table:nth-of-type(1) > caption:nth-of-type(1)".into()),
        )));
        assert!(blocks
            .iter()
            .any(|(kind, text, _, _)| kind == "table-row" && text == "Alpha 1"));
        assert!(blocks.iter().any(|(kind, text, cfi, _)| {
            kind == "paragraph"
                && text.contains("x 2 = 4")
                && text.contains("has two roots")
                && cfi.is_none()
        }));
        assert!(blocks.iter().any(|(kind, text, _, _)| {
            kind == "footnote" && text.contains("positive and negative roots")
        }));
    }

    #[test]
    fn persists_grouped_active_content_diagnostics_during_import() {
        let workspace = Workspace::new("active-content-reports");
        let source = fixture("active-content-epub3.epub");
        let conn = database(&workspace.path("reader.db"), &source, "epub");

        import_existing_document_v2(
            &conn,
            "document-1",
            &workspace.path("appdata/publications"),
            PublicationImportLimits::default(),
            100,
        )
        .unwrap();

        let reports = report_codes(&conn);
        let unsafe_block_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM content_blocks
                 WHERE plain_text LIKE '%pwn%' OR plain_text LIKE '%fetch(%'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(unsafe_block_count, 0);
        assert!(count(&conn, "content_blocks") > 0);
        for (code, href) in [
            ("publication.active_content_removed", "EPUB/chapter.xhtml"),
            ("publication.frame_content_removed", "EPUB/chapter.xhtml"),
            ("publication.form_disabled", "EPUB/chapter.xhtml"),
            ("publication.remote_resource_blocked", "EPUB/style.css"),
            ("publication.unsafe_url_removed", "EPUB/chapter.xhtml"),
        ] {
            assert!(
                reports.contains(&(code.into(), Some(href.into()))),
                "missing import diagnostic {code} for {href}: {reports:?}"
            );
        }
        for href in ["EPUB/chapter.xhtml", "EPUB/payload.js"] {
            assert_eq!(
                reports
                    .iter()
                    .filter(|(code, resource_href)| {
                        code == "publication.active_content_removed"
                            && resource_href.as_deref() == Some(href)
                    })
                    .count(),
                1,
                "diagnostics were not grouped for {href}"
            );
        }
    }

    #[test]
    fn sanitizer_refusal_leaves_no_ready_publication_metadata() {
        let workspace = Workspace::new("refused-content");
        let source = workspace.path("invalid-content.epub");
        let mut input =
            ZipArchive::new(fs::File::open(fixture("minimal-epub3.epub")).unwrap()).unwrap();
        let mut output = ZipWriter::new(fs::File::create(&source).unwrap());
        for index in 0..input.len() {
            let mut entry = input.by_index(index).unwrap();
            output
                .start_file(entry.name(), SimpleFileOptions::default())
                .unwrap();
            if entry.name() == "EPUB/chapter.xhtml" {
                output.write_all(&[0xff, 0xfe, b'<', b'p', b'>']).unwrap();
            } else {
                let mut bytes = Vec::new();
                entry.read_to_end(&mut bytes).unwrap();
                output.write_all(&bytes).unwrap();
            }
        }
        output.finish().unwrap();
        let conn = database(&workspace.path("reader.db"), &source, "epub");

        let error = import_existing_document_v2(
            &conn,
            "document-1",
            &workspace.path("appdata/publications"),
            PublicationImportLimits::default(),
            100,
        )
        .unwrap_err();

        assert!(matches!(
            error,
            PublicationImportError::ContentRefused { .. }
        ));
        for table in [
            "publications",
            "publication_resources",
            "publication_spine",
            "navigation_nodes",
            "content_blocks",
            "import_reports",
        ] {
            assert_eq!(count(&conn, table), 0, "partial rows survived in {table}");
        }
    }

    #[test]
    fn records_deterministic_markup_recovery_for_malformed_xhtml() {
        let workspace = Workspace::new("malformed-content-report");
        let source = fixture("malformed-xhtml-epub3.epub");
        let conn = database(&workspace.path("reader.db"), &source, "epub");

        import_existing_document_v2(
            &conn,
            "document-1",
            &workspace.path("appdata/publications"),
            PublicationImportLimits::default(),
            100,
        )
        .unwrap();

        assert!(report_codes(&conn).contains(&(
            "publication.markup_recovered".into(),
            Some("EPUB/chapter.xhtml".into()),
        )));
    }

    #[test]
    fn retries_the_same_document_and_hash_without_duplicating_rows() {
        let workspace = Workspace::new("idempotent");
        let source = fixture("short-toc-epub2.epub");
        let conn = database(&workspace.path("reader.db"), &source, "epub");
        let root = workspace.path("appdata/publications");

        let first = import_existing_document_v2(
            &conn,
            "document-1",
            &root,
            PublicationImportLimits::default(),
            100,
        )
        .unwrap();
        let first_block_count = count(&conn, "content_blocks");
        assert!(first_block_count > 0);
        let second = import_existing_document_v2(
            &conn,
            "document-1",
            &root,
            PublicationImportLimits::default(),
            200,
        )
        .unwrap();

        assert!(second.reused);
        assert_eq!(second.publication_id, first.publication_id);
        assert_eq!(second.source_hash, first.source_hash);
        assert_eq!(count(&conn, "publications"), 1);
        assert_eq!(count(&conn, "navigation_nodes"), 2);
        assert_eq!(count(&conn, "content_blocks"), first_block_count);
    }

    #[test]
    fn refuses_to_silently_replace_an_existing_publication_when_source_bytes_change() {
        let workspace = Workspace::new("changed-source");
        let first_source = fixture("short-toc-epub2.epub");
        let conn = database(&workspace.path("reader.db"), &first_source, "epub");
        let root = workspace.path("appdata/publications");
        let first = import_existing_document_v2(
            &conn,
            "document-1",
            &root,
            PublicationImportLimits::default(),
            100,
        )
        .unwrap();
        conn.execute(
            "UPDATE documents SET file_path = ?1 WHERE id = 'document-1'",
            [fixture("minimal-epub3.epub").to_string_lossy().to_string()],
        )
        .unwrap();

        let error = import_existing_document_v2(
            &conn,
            "document-1",
            &root,
            PublicationImportLimits::default(),
            200,
        )
        .unwrap_err();

        assert!(matches!(error, PublicationImportError::SourceChanged));
        assert_eq!(count(&conn, "publications"), 1);
        let retained_hash: String = conn
            .query_row(
                "SELECT source_hash FROM publications WHERE id = ?1",
                [&first.publication_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(retained_hash, first.source_hash);
    }

    #[test]
    fn rejects_missing_or_non_epub_documents_before_publishing_an_archive() {
        let workspace = Workspace::new("boundaries");
        let source = fixture("minimal-epub3.epub");
        let conn = database(&workspace.path("reader.db"), &source, "pdf");
        let root = workspace.path("appdata/publications");

        assert!(matches!(
            import_existing_document_v2(
                &conn,
                "missing",
                &root,
                PublicationImportLimits::default(),
                100,
            ),
            Err(PublicationImportError::DocumentNotFound(_))
        ));
        assert!(matches!(
            import_existing_document_v2(
                &conn,
                "document-1",
                &root,
                PublicationImportLimits::default(),
                100,
            ),
            Err(PublicationImportError::UnsupportedFormat(_))
        ));
        assert!(!root.exists());
        assert_eq!(count(&conn, "publications"), 0);
    }
}
