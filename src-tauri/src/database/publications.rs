use crate::publication::ingest::IngestedArchive;
use rusqlite::{params, Connection};
use serde_json::Value;
use std::path::Path;

#[derive(Debug, Clone)]
pub(crate) struct PreparedResource {
    pub id: String,
    pub href: String,
    pub media_type: String,
    pub properties: Vec<String>,
    pub sha256: String,
    pub size: u64,
    pub fallback_href: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct PreparedSpineItem {
    pub id: String,
    pub resource_id: String,
    pub spine_index: u32,
    pub linear: bool,
    pub page_spread: Option<String>,
    pub properties: Vec<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct PreparedNavigationNode {
    pub id: String,
    pub parent_id: Option<String>,
    pub kind: String,
    pub label: String,
    pub href: Option<String>,
    pub fragment: Option<String>,
    pub order_index: u32,
    pub depth: u32,
}

#[derive(Debug, Clone)]
pub(crate) struct PreparedContentBlock {
    pub id: String,
    pub spine_item_id: String,
    pub block_index: u32,
    pub kind: String,
    pub plain_text: String,
    pub language: Option<String>,
    pub direction: Option<String>,
    pub locator: Value,
    pub cfi: Option<String>,
    pub css_selector: Option<String>,
    pub text_quote_prefix: Option<String>,
    pub text_quote_exact: Option<String>,
    pub text_quote_suffix: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct PreparedImportReport {
    pub id: String,
    pub severity: String,
    pub code: String,
    pub resource_href: Option<String>,
    pub message: String,
    pub created_at: i64,
}

#[derive(Debug, Clone)]
pub(crate) struct PreparedPublicationImport {
    pub id: String,
    pub document_id: String,
    pub rendition_layout: Option<String>,
    pub content_policy_version: u32,
    pub imported_at: i64,
    pub resources: Vec<PreparedResource>,
    pub spine: Vec<PreparedSpineItem>,
    pub navigation: Vec<PreparedNavigationNode>,
    pub content_blocks: Vec<PreparedContentBlock>,
    pub reports: Vec<PreparedImportReport>,
}

#[derive(Debug, thiserror::Error)]
pub(crate) enum PublicationCommitError {
    #[error("archive identity is inconsistent with its content-addressed path")]
    ArchiveIdentityMismatch,
    #[error("publication archive I/O failed: {0}")]
    ArchiveIo(#[from] std::io::Error),
    #[error("publication numeric value is outside SQLite range: {0}")]
    NumericOverflow(&'static str),
    #[error("publication database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("publication metadata serialization failed: {0}")]
    Serialization(#[from] serde_json::Error),
}

fn sqlite_integer(value: u64, field: &'static str) -> Result<i64, PublicationCommitError> {
    i64::try_from(value).map_err(|_| PublicationCommitError::NumericOverflow(field))
}

fn validate_archive_identity(archive: &IngestedArchive) -> Result<String, PublicationCommitError> {
    if archive.sha256.len() != 64
        || !archive
            .sha256
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(PublicationCommitError::ArchiveIdentityMismatch);
    }
    let expected_name = format!("{}.epub", archive.sha256);
    let expected_prefix = &archive.sha256[..2];
    if archive.path.file_name().and_then(|name| name.to_str()) != Some(expected_name.as_str())
        || archive
            .path
            .parent()
            .and_then(Path::file_name)
            .and_then(|name| name.to_str())
            != Some(expected_prefix)
    {
        return Err(PublicationCommitError::ArchiveIdentityMismatch);
    }
    let metadata = std::fs::symlink_metadata(&archive.path)?;
    if !metadata.file_type().is_file()
        || metadata.len() != archive.compressed_size
        || !metadata.permissions().readonly()
    {
        return Err(PublicationCommitError::ArchiveIdentityMismatch);
    }
    archive
        .path
        .to_str()
        .map(str::to_owned)
        .ok_or(PublicationCommitError::ArchiveIdentityMismatch)
}

pub(crate) fn commit_publication_import(
    conn: &Connection,
    archive: &IngestedArchive,
    prepared: &PreparedPublicationImport,
) -> Result<String, PublicationCommitError> {
    let archive_path = validate_archive_identity(archive)?;
    let archive_size = sqlite_integer(archive.compressed_size, "archive_size")?;
    let resource_properties = prepared
        .resources
        .iter()
        .map(|resource| serde_json::to_string(&resource.properties))
        .collect::<Result<Vec<_>, _>>()?;
    let spine_properties = prepared
        .spine
        .iter()
        .map(|item| serde_json::to_string(&item.properties))
        .collect::<Result<Vec<_>, _>>()?;
    let block_locators = prepared
        .content_blocks
        .iter()
        .map(|block| serde_json::to_string(&block.locator))
        .collect::<Result<Vec<_>, _>>()?;

    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    let transaction = conn.unchecked_transaction()?;
    transaction.execute(
        "INSERT INTO publications
         (id, document_id, format, schema_version, rendition_layout, source_hash,
          archive_path, archive_size, content_policy_version, import_status,
          imported_at, updated_at)
         VALUES (?1, ?2, 'epub', 1, ?3, ?4, ?5, ?6, ?7, 'ready', ?8, ?8)",
        params![
            prepared.id,
            prepared.document_id,
            prepared.rendition_layout,
            archive.sha256,
            archive_path,
            archive_size,
            prepared.content_policy_version,
            prepared.imported_at,
        ],
    )?;

    for (resource, properties) in prepared.resources.iter().zip(resource_properties) {
        transaction.execute(
            "INSERT INTO publication_resources
             (id, publication_id, href, media_type, properties, sha256, size, fallback_href)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                resource.id,
                prepared.id,
                resource.href,
                resource.media_type,
                properties,
                resource.sha256,
                sqlite_integer(resource.size, "resource_size")?,
                resource.fallback_href,
            ],
        )?;
    }

    for (item, properties) in prepared.spine.iter().zip(spine_properties) {
        transaction.execute(
            "INSERT INTO publication_spine
             (id, publication_id, resource_id, spine_index, linear, page_spread, properties)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                item.id,
                prepared.id,
                item.resource_id,
                item.spine_index,
                item.linear,
                item.page_spread,
                properties,
            ],
        )?;
    }

    let mut navigation = prepared.navigation.iter().collect::<Vec<_>>();
    navigation.sort_by_key(|node| (node.depth, node.order_index));
    for node in navigation {
        transaction.execute(
            "INSERT INTO navigation_nodes
             (id, publication_id, parent_id, kind, label, href, fragment, order_index, depth)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                node.id,
                prepared.id,
                node.parent_id,
                node.kind,
                node.label,
                node.href,
                node.fragment,
                node.order_index,
                node.depth,
            ],
        )?;
    }

    for (block, locator) in prepared.content_blocks.iter().zip(block_locators) {
        transaction.execute(
            "INSERT INTO content_blocks
             (id, publication_id, spine_item_id, block_index, kind, plain_text,
              language, direction, locator_json, cfi, css_selector, text_quote_prefix,
              text_quote_exact, text_quote_suffix)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![
                block.id,
                prepared.id,
                block.spine_item_id,
                block.block_index,
                block.kind,
                block.plain_text,
                block.language,
                block.direction,
                locator,
                block.cfi,
                block.css_selector,
                block.text_quote_prefix,
                block.text_quote_exact,
                block.text_quote_suffix,
            ],
        )?;
    }

    for report in &prepared.reports {
        transaction.execute(
            "INSERT INTO import_reports
             (id, publication_id, severity, code, resource_href, message, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                report.id,
                prepared.id,
                report.severity,
                report.code,
                report.resource_href,
                report.message,
                report.created_at,
            ],
        )?;
    }

    transaction.commit()?;
    Ok(prepared.id.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::{create_tables, v2_schema::migrate_v2_database};
    use crate::publication::{
        archive::ArchiveLimits,
        ingest::{ingest_epub_archive, ArchiveIngestLimits},
        store::ZipPublicationStore,
    };
    use std::{fs, path::PathBuf};

    struct Workspace(PathBuf);

    impl Workspace {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "reader-publication-commit-{name}-{}",
                uuid::Uuid::new_v4()
            ));
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

    fn database(path: &std::path::Path) -> Connection {
        let conn = Connection::open(path).unwrap();
        create_tables(&conn).unwrap();
        drop(conn);
        migrate_v2_database(path, &path.with_extension("before-v2.bak")).unwrap();
        let conn = Connection::open(path).unwrap();
        conn.execute("PRAGMA foreign_keys = ON", []).unwrap();
        conn.execute(
            "INSERT INTO documents
             (id, title, file_path, file_type, created_at, updated_at)
             VALUES ('document-1', 'Imported EPUB', '/original/book.epub', 'epub', 1, 1)",
            [],
        )
        .unwrap();
        conn
    }

    fn prepared() -> PreparedPublicationImport {
        PreparedPublicationImport {
            id: "publication-1".into(),
            document_id: "document-1".into(),
            rendition_layout: Some("reflowable".into()),
            content_policy_version: 1,
            imported_at: 10,
            resources: vec![PreparedResource {
                id: "resource-chapter".into(),
                href: "EPUB/chapter.xhtml".into(),
                media_type: "application/xhtml+xml".into(),
                properties: vec![],
                sha256: "a".repeat(64),
                size: 393,
                fallback_href: None,
            }],
            spine: vec![PreparedSpineItem {
                id: "spine-1".into(),
                resource_id: "resource-chapter".into(),
                spine_index: 0,
                linear: true,
                page_spread: None,
                properties: vec![],
            }],
            navigation: vec![
                PreparedNavigationNode {
                    id: "nav-parent".into(),
                    parent_id: None,
                    kind: "toc".into(),
                    label: "Part".into(),
                    href: None,
                    fragment: None,
                    order_index: 0,
                    depth: 0,
                },
                PreparedNavigationNode {
                    id: "nav-child".into(),
                    parent_id: Some("nav-parent".into()),
                    kind: "toc".into(),
                    label: "Chapter".into(),
                    href: Some("EPUB/chapter.xhtml".into()),
                    fragment: None,
                    order_index: 0,
                    depth: 1,
                },
            ],
            content_blocks: vec![PreparedContentBlock {
                id: "block-1".into(),
                spine_item_id: "spine-1".into(),
                block_index: 0,
                kind: "heading".into(),
                plain_text: "Chapter One".into(),
                language: Some("en".into()),
                direction: Some("ltr".into()),
                locator: serde_json::json!({
                    "schemaVersion": 1,
                    "href": "EPUB/chapter.xhtml",
                    "locations": { "cfi": "epubcfi(/6/2!/4/2)" }
                }),
                cfi: Some("epubcfi(/6/2!/4/2)".into()),
                css_selector: Some("h1".into()),
                text_quote_prefix: None,
                text_quote_exact: Some("Chapter One".into()),
                text_quote_suffix: None,
            }],
            reports: vec![PreparedImportReport {
                id: "report-1".into(),
                severity: "info".into(),
                code: "publication.imported".into(),
                resource_href: None,
                message: "Publication metadata committed".into(),
                created_at: 10,
            }],
        }
    }

    fn count(conn: &Connection, table: &str) -> i64 {
        conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
            row.get(0)
        })
        .unwrap()
    }

    #[test]
    fn atomically_commits_all_publication_layers_to_the_canonical_archive() {
        let workspace = Workspace::new("success");
        let source = workspace.path("selected.epub");
        fs::copy(fixture("minimal-epub3.epub"), &source).unwrap();
        let archive = ingest_epub_archive(
            &source,
            &workspace.path("appdata/publications"),
            ArchiveIngestLimits::default(),
        )
        .unwrap();
        let conn = database(&workspace.path("reader.db"));

        let publication_id = commit_publication_import(&conn, &archive, &prepared()).unwrap();
        assert_eq!(publication_id, "publication-1");
        for (table, expected) in [
            ("publications", 1),
            ("publication_resources", 1),
            ("publication_spine", 1),
            ("navigation_nodes", 2),
            ("content_blocks", 1),
            ("import_reports", 1),
        ] {
            assert_eq!(count(&conn, table), expected, "unexpected {table} count");
        }

        fs::remove_file(&source).unwrap();
        let canonical_path: String = conn
            .query_row(
                "SELECT archive_path FROM publications WHERE id = 'publication-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let mut store =
            ZipPublicationStore::open(canonical_path, ArchiveLimits::default()).unwrap();
        let chapter = store.load_text("EPUB/nav.xhtml", "chapter.xhtml").unwrap();
        assert!(chapter.contains("Chapter One"));
    }

    #[test]
    fn rolls_back_every_database_row_when_any_prepared_child_is_invalid() {
        let workspace = Workspace::new("rollback");
        let archive = ingest_epub_archive(
            &fixture("minimal-epub3.epub"),
            &workspace.path("appdata/publications"),
            ArchiveIngestLimits::default(),
        )
        .unwrap();
        let conn = database(&workspace.path("reader.db"));
        let mut invalid = prepared();
        invalid.resources.push(PreparedResource {
            id: "duplicate-href".into(),
            ..invalid.resources[0].clone()
        });

        assert!(commit_publication_import(&conn, &archive, &invalid).is_err());
        for table in [
            "publications",
            "publication_resources",
            "publication_spine",
            "navigation_nodes",
            "content_blocks",
            "import_reports",
        ] {
            assert_eq!(count(&conn, table), 0, "{table} must roll back");
        }
        assert!(
            archive.path.exists(),
            "canonical archive remains GC-recoverable"
        );
    }

    #[test]
    fn rejects_forged_archive_identity_before_starting_the_transaction() {
        let workspace = Workspace::new("identity");
        let mut archive = ingest_epub_archive(
            &fixture("minimal-epub3.epub"),
            &workspace.path("appdata/publications"),
            ArchiveIngestLimits::default(),
        )
        .unwrap();
        archive.sha256 = "0".repeat(64);
        let conn = database(&workspace.path("reader.db"));

        let error = commit_publication_import(&conn, &archive, &prepared()).unwrap_err();
        assert!(matches!(
            error,
            PublicationCommitError::ArchiveIdentityMismatch
        ));
        assert_eq!(count(&conn, "publications"), 0);
    }
}
