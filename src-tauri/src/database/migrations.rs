use rusqlite::{Connection, Transaction};
use std::path::{Path, PathBuf};
use thiserror::Error;

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum MigrationOutcome {
    Applied {
        from: u32,
        to: u32,
        backup_path: PathBuf,
    },
    Unchanged {
        version: u32,
    },
}

#[derive(Debug, Error)]
pub(crate) enum MigrationError {
    #[error("database downgrade is not allowed: current schema {current}, target {target}")]
    Downgrade { current: u32, target: u32 },
    #[error("migration backup already exists: {0}")]
    BackupExists(PathBuf),
    #[error("database migration failed: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("migration backup path is not valid UTF-8: {0}")]
    InvalidBackupPath(PathBuf),
    #[error("migration backup failed integrity validation: {0}")]
    InvalidBackup(String),
    #[error("migration backup I/O failed: {0}")]
    Io(#[from] std::io::Error),
}

fn create_consistent_backup(
    conn: &Connection,
    backup_path: &Path,
    expected_version: u32,
) -> Result<(), MigrationError> {
    if backup_path.exists() {
        return Err(MigrationError::BackupExists(backup_path.to_path_buf()));
    }
    let parent = backup_path.parent().unwrap_or_else(|| Path::new("."));
    std::fs::create_dir_all(parent)?;
    let file_name = backup_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| MigrationError::InvalidBackupPath(backup_path.to_path_buf()))?;
    let temporary_path = parent.join(format!(".{file_name}.tmp-{}", uuid::Uuid::new_v4()));
    let temporary_text = temporary_path
        .to_str()
        .ok_or_else(|| MigrationError::InvalidBackupPath(temporary_path.clone()))?;

    let result = (|| {
        conn.execute("VACUUM INTO ?1", [temporary_text])?;
        {
            let backup = Connection::open(&temporary_path)?;
            let integrity: String =
                backup.pragma_query_value(None, "quick_check", |row| row.get(0))?;
            if integrity != "ok" {
                return Err(MigrationError::InvalidBackup(integrity));
            }
            let version =
                backup.pragma_query_value(None, "user_version", |row| row.get::<_, u32>(0))?;
            if version != expected_version {
                return Err(MigrationError::InvalidBackup(format!(
                    "expected schema {expected_version}, found {version}"
                )));
            }
        }
        #[cfg(not(windows))]
        std::fs::OpenOptions::new()
            .read(true)
            .open(&temporary_path)?
            .sync_all()?;
        // The temp file and destination share a directory. Unix uses hard_link for
        // atomic no-clobber publication; Windows does not reliably permit hard-linking
        // SQLite files on the hosted test runner, so rename is used there instead.
        #[cfg(windows)]
        std::fs::rename(&temporary_path, backup_path)?;
        #[cfg(not(windows))]
        {
            std::fs::hard_link(&temporary_path, backup_path)?;
            std::fs::remove_file(&temporary_path)?;
        }
        Ok(())
    })();

    if result.is_err() {
        let _ = std::fs::remove_file(&temporary_path);
    }
    result
}

pub(crate) fn run_file_migration<F>(
    db_path: &Path,
    backup_path: &Path,
    target_version: u32,
    migrate: F,
) -> Result<MigrationOutcome, MigrationError>
where
    F: FnOnce(&Transaction<'_>) -> rusqlite::Result<()>,
{
    let mut conn = Connection::open(db_path)?;
    let current = conn.pragma_query_value(None, "user_version", |row| row.get::<_, u32>(0))?;
    if target_version < current {
        return Err(MigrationError::Downgrade {
            current,
            target: target_version,
        });
    }
    if target_version == current {
        return Ok(MigrationOutcome::Unchanged { version: current });
    }

    create_consistent_backup(&conn, backup_path, current)?;

    let transaction = conn.transaction()?;
    if let Err(error) = migrate(&transaction) {
        return Err(MigrationError::Database(error));
    }
    transaction.pragma_update(None, "user_version", target_version)?;
    transaction.commit()?;

    Ok(MigrationOutcome::Applied {
        from: current,
        to: target_version,
        backup_path: backup_path.to_path_buf(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    struct Workspace {
        root: PathBuf,
    }

    impl Workspace {
        fn new(name: &str) -> Self {
            let root = std::env::temp_dir()
                .join(format!("reader-migration-{name}-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&root).unwrap();
            Self { root }
        }

        fn path(&self, name: &str) -> PathBuf {
            self.root.join(name)
        }
    }

    impl Drop for Workspace {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn legacy_database(path: &Path, version: u32) {
        let conn = Connection::open(path).unwrap();
        conn.execute(
            "CREATE TABLE legacy (id INTEGER PRIMARY KEY, value TEXT NOT NULL)",
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO legacy (value) VALUES ('preserve me')", [])
            .unwrap();
        conn.pragma_update(None, "user_version", version).unwrap();
    }

    fn user_version(path: &Path) -> u32 {
        Connection::open(path)
            .unwrap()
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap()
    }

    fn table_exists(path: &Path, name: &str) -> bool {
        Connection::open(path)
            .unwrap()
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
                [name],
                |row| row.get(0),
            )
            .unwrap()
    }

    #[test]
    fn backs_up_the_pre_migration_database_before_committing_an_upgrade() {
        let workspace = Workspace::new("success");
        let db_path = workspace.path("reader.db");
        let backup_path = workspace.path("backups/reader's.schema-1.bak");
        legacy_database(&db_path, 1);

        let outcome = run_file_migration(&db_path, &backup_path, 2, |tx| {
            tx.execute(
                "CREATE TABLE publications (id TEXT PRIMARY KEY, source_hash TEXT NOT NULL)",
                [],
            )?;
            Ok(())
        })
        .unwrap();

        assert_eq!(
            outcome,
            MigrationOutcome::Applied {
                from: 1,
                to: 2,
                backup_path: backup_path.clone(),
            }
        );
        assert_eq!(user_version(&db_path), 2);
        assert!(table_exists(&db_path, "publications"));
        assert_eq!(user_version(&backup_path), 1);
        assert!(!table_exists(&backup_path, "publications"));
        let value: String = Connection::open(&backup_path)
            .unwrap()
            .query_row("SELECT value FROM legacy", [], |row| row.get(0))
            .unwrap();
        assert_eq!(value, "preserve me");
    }

    #[test]
    fn rolls_back_a_failed_migration_and_preserves_its_backup() {
        let workspace = Workspace::new("rollback");
        let db_path = workspace.path("reader.db");
        let backup_path = workspace.path("reader.before-failure.bak");
        legacy_database(&db_path, 1);

        let error = run_file_migration(&db_path, &backup_path, 2, |tx| {
            tx.execute("CREATE TABLE partial_change (id INTEGER)", [])?;
            Err(rusqlite::Error::InvalidQuery)
        })
        .unwrap_err();

        assert!(matches!(error, MigrationError::Database(_)));
        assert_eq!(user_version(&db_path), 1);
        assert!(!table_exists(&db_path, "partial_change"));
        assert_eq!(user_version(&backup_path), 1);
    }

    #[test]
    fn an_already_applied_version_is_idempotent_and_does_not_touch_the_backup_path() {
        let workspace = Workspace::new("idempotent");
        let db_path = workspace.path("reader.db");
        let backup_path = workspace.path("existing-marker");
        legacy_database(&db_path, 2);
        fs::write(&backup_path, b"do not overwrite").unwrap();

        let outcome = run_file_migration(&db_path, &backup_path, 2, |_| {
            panic!("an idempotent migration must not execute")
        })
        .unwrap();

        assert_eq!(outcome, MigrationOutcome::Unchanged { version: 2 });
        assert_eq!(fs::read(&backup_path).unwrap(), b"do not overwrite");
    }

    #[test]
    fn refuses_downgrades_and_existing_backup_destinations_before_running_sql() {
        let workspace = Workspace::new("boundaries");
        let db_path = workspace.path("reader.db");
        legacy_database(&db_path, 2);

        let downgrade = run_file_migration(&db_path, &workspace.path("unused.bak"), 1, |_| {
            panic!("downgrade SQL must not execute")
        })
        .unwrap_err();
        assert!(matches!(
            downgrade,
            MigrationError::Downgrade {
                current: 2,
                target: 1
            }
        ));

        let backup_path = workspace.path("backup's copy.db");
        fs::write(&backup_path, b"existing backup").unwrap();
        let collision = run_file_migration(&db_path, &backup_path, 3, |_| {
            panic!("migration SQL must not execute when backup exists")
        })
        .unwrap_err();
        assert!(matches!(collision, MigrationError::BackupExists(path) if path == backup_path));
        assert_eq!(
            fs::read(workspace.path("backup's copy.db")).unwrap(),
            b"existing backup"
        );
        assert_eq!(user_version(&db_path), 2);
    }
}
