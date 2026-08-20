use super::archive::ArchiveLimits;
use super::ingest::{ingest_epub_archive, ArchiveIngestError, ArchiveIngestLimits};
use super::navigation::{prepare_navigation, NavigationPrepareError};
use super::package::{prepare_package, PackagePrepareError};
use crate::database::publications::{
    commit_publication_import, PreparedContentBlock, PreparedImportReport,
    PreparedNavigationNode as DatabaseNavigationNode, PreparedPublicationImport, PreparedResource,
    PreparedSpineItem, PublicationCommitError,
};
use rusqlite::{Connection, OptionalExtension};
use std::collections::HashMap;
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
        message: "Publication archive, package, and navigation prepared".into(),
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

    let prepared = PreparedPublicationImport {
        id: publication_id.clone(),
        document_id: document_id.to_string(),
        rendition_layout: Some(package.metadata.rendition_layout),
        content_policy_version: 1,
        imported_at,
        resources,
        spine,
        navigation,
        content_blocks: Vec::<PreparedContentBlock>::new(),
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
        assert_eq!(count(&conn, "content_blocks"), 0);
        assert_eq!(count(&conn, "import_reports"), 1);

        fs::remove_file(source).unwrap();
        let mut store =
            ZipPublicationStore::open(&outcome.archive_path, ArchiveLimits::default()).unwrap();
        assert!(store
            .load_text("EPUB/nav.xhtml", "chapter.xhtml")
            .unwrap()
            .contains("Chapter One"));
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
