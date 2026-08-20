use super::migrations::{run_file_migration, MigrationError, MigrationOutcome};
use rusqlite::Transaction;
use std::path::{Path, PathBuf};

pub(crate) const V2_SCHEMA_VERSION: u32 = 1;

fn create_v2_tables(transaction: &Transaction<'_>) -> rusqlite::Result<()> {
    transaction.execute_batch(
        "CREATE TABLE publications (
           id TEXT PRIMARY KEY,
           document_id TEXT NOT NULL UNIQUE REFERENCES documents(id) ON DELETE CASCADE,
           format TEXT NOT NULL CHECK (format IN ('epub', 'pdf', 'markdown')),
           schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
           rendition_layout TEXT,
           source_hash TEXT NOT NULL CHECK (length(source_hash) = 64),
           archive_path TEXT NOT NULL,
           archive_size INTEGER NOT NULL CHECK (archive_size >= 0),
           content_policy_version INTEGER NOT NULL CHECK (content_policy_version >= 1),
           import_status TEXT NOT NULL,
           imported_at INTEGER NOT NULL,
           updated_at INTEGER NOT NULL
         );

         CREATE TABLE publication_resources (
           id TEXT PRIMARY KEY,
           publication_id TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
           href TEXT NOT NULL,
           media_type TEXT NOT NULL,
           properties TEXT NOT NULL DEFAULT '[]',
           sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
           size INTEGER NOT NULL CHECK (size >= 0),
           fallback_href TEXT,
           UNIQUE (publication_id, href),
           UNIQUE (publication_id, id)
         );

         CREATE TABLE publication_spine (
           id TEXT PRIMARY KEY,
           publication_id TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
           resource_id TEXT NOT NULL,
           spine_index INTEGER NOT NULL CHECK (spine_index >= 0),
           linear INTEGER NOT NULL DEFAULT 1 CHECK (linear IN (0, 1)),
           page_spread TEXT,
           properties TEXT NOT NULL DEFAULT '[]',
           UNIQUE (publication_id, spine_index),
           UNIQUE (publication_id, id),
           FOREIGN KEY (publication_id, resource_id)
             REFERENCES publication_resources(publication_id, id) ON DELETE CASCADE
         );

         CREATE TABLE navigation_nodes (
           id TEXT PRIMARY KEY,
           publication_id TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
           parent_id TEXT,
           kind TEXT NOT NULL,
           label TEXT NOT NULL,
           href TEXT,
           fragment TEXT,
           order_index INTEGER NOT NULL CHECK (order_index >= 0),
           depth INTEGER NOT NULL CHECK (depth >= 0),
           UNIQUE (publication_id, id),
           UNIQUE (publication_id, parent_id, kind, order_index),
           FOREIGN KEY (publication_id, parent_id)
             REFERENCES navigation_nodes(publication_id, id) ON DELETE CASCADE
         );

         CREATE TABLE content_blocks (
           id TEXT PRIMARY KEY,
           publication_id TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
           spine_item_id TEXT NOT NULL,
           block_index INTEGER NOT NULL CHECK (block_index >= 0),
           kind TEXT NOT NULL,
           plain_text TEXT NOT NULL,
           language TEXT,
           direction TEXT CHECK (direction IS NULL OR direction IN ('ltr', 'rtl', 'auto')),
           locator_json TEXT NOT NULL,
           cfi TEXT,
           css_selector TEXT,
           text_quote_prefix TEXT,
           text_quote_exact TEXT,
           text_quote_suffix TEXT,
           UNIQUE (publication_id, spine_item_id, block_index),
           FOREIGN KEY (publication_id, spine_item_id)
             REFERENCES publication_spine(publication_id, id) ON DELETE CASCADE
         );

         CREATE TABLE reading_positions (
           publication_id TEXT PRIMARY KEY REFERENCES publications(id) ON DELETE CASCADE,
           locator_json TEXT NOT NULL,
           progression REAL CHECK (progression IS NULL OR (progression >= 0 AND progression <= 1)),
           updated_at INTEGER NOT NULL
         );

         CREATE TABLE import_reports (
           id TEXT PRIMARY KEY,
           publication_id TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
           severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'error')),
           code TEXT NOT NULL,
           resource_href TEXT,
           message TEXT NOT NULL,
           created_at INTEGER NOT NULL
         );

         CREATE INDEX idx_publication_resources_publication
           ON publication_resources(publication_id);
         CREATE INDEX idx_publication_spine_publication
           ON publication_spine(publication_id, spine_index);
         CREATE INDEX idx_navigation_nodes_publication
           ON navigation_nodes(publication_id, kind, parent_id, order_index);
         CREATE INDEX idx_content_blocks_publication
           ON content_blocks(publication_id, spine_item_id, block_index);
         CREATE INDEX idx_import_reports_publication
           ON import_reports(publication_id, severity);",
    )
}

fn default_backup_path(db_path: &Path) -> PathBuf {
    let parent = db_path.parent().unwrap_or_else(|| Path::new("."));
    let database_name = db_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("reader.db");
    let timestamp = chrono::Utc::now().format("%Y%m%dT%H%M%SZ");
    parent.join("migration-backups").join(format!(
        "{database_name}.schema-0-to-{V2_SCHEMA_VERSION}.{timestamp}.{}.bak",
        uuid::Uuid::new_v4()
    ))
}

pub(crate) fn migrate_v2_database(
    db_path: &Path,
    backup_path: &Path,
) -> Result<MigrationOutcome, MigrationError> {
    run_file_migration(db_path, backup_path, V2_SCHEMA_VERSION, create_v2_tables)
}

pub(crate) fn migrate_to_latest(db_path: &Path) -> Result<MigrationOutcome, MigrationError> {
    migrate_v2_database(db_path, &default_backup_path(db_path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::{params, Connection};
    use std::{fs, path::PathBuf};

    struct Workspace(PathBuf);

    impl Workspace {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("reader-v2-schema-{}", uuid::Uuid::new_v4()));
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

    fn legacy_database(path: &Path) {
        let conn = Connection::open(path).unwrap();
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE documents (
               id TEXT PRIMARY KEY,
               title TEXT NOT NULL,
               author TEXT,
               language TEXT,
               file_path TEXT NOT NULL UNIQUE,
               file_type TEXT NOT NULL,
               created_at INTEGER NOT NULL,
               updated_at INTEGER NOT NULL
             );
             CREATE TABLE sections (
               id TEXT PRIMARY KEY,
               doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
               title TEXT NOT NULL,
               order_index INTEGER NOT NULL,
               href TEXT NOT NULL
             );
             CREATE TABLE paragraphs (
               id TEXT PRIMARY KEY,
               doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
               section_id TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
               order_index INTEGER NOT NULL,
               text TEXT NOT NULL,
               location TEXT NOT NULL
             );",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO documents
             (id, title, file_path, file_type, created_at, updated_at)
             VALUES ('legacy-doc', 'Legacy book', '/books/legacy.epub', 'epub', 1, 1)",
            [],
        )
        .unwrap();
    }

    fn tables(conn: &Connection) -> Vec<String> {
        let mut statement = conn
            .prepare(
                "SELECT name FROM sqlite_master
                 WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
                 ORDER BY name",
            )
            .unwrap();
        statement
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    }

    #[test]
    fn appends_the_complete_v2_publication_schema_and_preserves_v1_data() {
        let workspace = Workspace::new();
        let db_path = workspace.path("reader.db");
        let backup_path = workspace.path("migration-backups/before-v2.bak");
        legacy_database(&db_path);

        let outcome = migrate_v2_database(&db_path, &backup_path).unwrap();
        assert!(matches!(
            outcome,
            MigrationOutcome::Applied {
                from: 0,
                to: V2_SCHEMA_VERSION,
                ..
            }
        ));

        let conn = Connection::open(&db_path).unwrap();
        conn.execute("PRAGMA foreign_keys = ON", []).unwrap();
        let version: u32 = conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version, V2_SCHEMA_VERSION);
        assert_eq!(
            tables(&conn),
            vec![
                "content_blocks",
                "documents",
                "import_reports",
                "navigation_nodes",
                "paragraphs",
                "publication_resources",
                "publication_spine",
                "publications",
                "reading_positions",
                "sections",
            ]
        );
        let title: String = conn
            .query_row(
                "SELECT title FROM documents WHERE id = 'legacy-doc'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(title, "Legacy book");

        let backup = Connection::open(&backup_path).unwrap();
        assert!(!tables(&backup).contains(&"publications".to_string()));
        let backup_version: u32 = backup
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(backup_version, 0);
    }

    #[test]
    fn enforces_publication_identity_resource_order_and_cascade_invariants() {
        let workspace = Workspace::new();
        let db_path = workspace.path("reader.db");
        legacy_database(&db_path);
        migrate_v2_database(&db_path, &workspace.path("before-v2.bak")).unwrap();

        let conn = Connection::open(&db_path).unwrap();
        conn.execute("PRAGMA foreign_keys = ON", []).unwrap();
        conn.execute(
            "INSERT INTO publications
             (id, document_id, format, schema_version, source_hash, archive_path, archive_size,
              content_policy_version, import_status, imported_at, updated_at)
             VALUES (?1, 'legacy-doc', 'epub', 1, ?2, ?3, 42, 1, 'ready', 10, 10)",
            params![
                "publication-1",
                "a".repeat(64),
                "/appdata/publications/a.epub"
            ],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO publication_resources
             (id, publication_id, href, media_type, sha256, size)
             VALUES ('resource-1', 'publication-1', 'EPUB/chapter.xhtml',
                     'application/xhtml+xml', ?1, 42)",
            ["b".repeat(64)],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO publication_spine
             (id, publication_id, resource_id, spine_index, linear)
             VALUES ('spine-1', 'publication-1', 'resource-1', 0, 1)",
            [],
        )
        .unwrap();

        assert!(conn
            .execute(
                "INSERT INTO publication_resources
                 (id, publication_id, href, media_type, sha256, size)
                 VALUES ('resource-2', 'publication-1', 'EPUB/chapter.xhtml',
                         'application/xhtml+xml', ?1, 42)",
                ["c".repeat(64)],
            )
            .is_err());
        assert!(conn
            .execute(
                "INSERT INTO publication_spine
                 (id, publication_id, resource_id, spine_index, linear)
                 VALUES ('spine-2', 'publication-1', 'resource-1', 0, 1)",
                [],
            )
            .is_err());

        conn.execute(
            "INSERT INTO documents
             (id, title, file_path, file_type, created_at, updated_at)
             VALUES ('other-doc', 'Other', '/books/other.epub', 'epub', 1, 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO publications
             (id, document_id, format, schema_version, source_hash, archive_path, archive_size,
              content_policy_version, import_status, imported_at, updated_at)
             VALUES ('publication-2', 'other-doc', 'epub', 1, ?1, ?2, 42, 1, 'ready', 10, 10)",
            params!["d".repeat(64), "/appdata/publications/d.epub"],
        )
        .unwrap();
        assert!(conn
            .execute(
                "INSERT INTO publication_spine
                 (id, publication_id, resource_id, spine_index, linear)
                 VALUES ('cross-scope', 'publication-2', 'resource-1', 0, 1)",
                [],
            )
            .is_err());

        conn.execute("DELETE FROM documents WHERE id = 'legacy-doc'", [])
            .unwrap();
        let publication_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM publications WHERE id = 'publication-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let resource_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM publication_resources WHERE publication_id = 'publication-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!((publication_count, resource_count), (0, 0));
    }

    #[test]
    fn rerunning_the_same_schema_is_idempotent_without_replacing_a_backup() {
        let workspace = Workspace::new();
        let db_path = workspace.path("reader.db");
        let first_backup = workspace.path("first.bak");
        legacy_database(&db_path);
        migrate_v2_database(&db_path, &first_backup).unwrap();

        let marker = workspace.path("must-not-be-touched.bak");
        fs::write(&marker, b"marker").unwrap();
        let outcome = migrate_v2_database(&db_path, &marker).unwrap();

        assert_eq!(
            outcome,
            MigrationOutcome::Unchanged {
                version: V2_SCHEMA_VERSION
            }
        );
        assert_eq!(fs::read(marker).unwrap(), b"marker");
    }
}
