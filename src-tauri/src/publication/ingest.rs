use super::archive::{validate_epub_archive, ArchiveLimits, ArchiveSafetyError};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy)]
pub struct ArchiveIngestLimits {
    pub max_compressed_size: u64,
    pub archive: ArchiveLimits,
}

impl Default for ArchiveIngestLimits {
    fn default() -> Self {
        Self {
            max_compressed_size: 512 * 1024 * 1024,
            archive: ArchiveLimits::default(),
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct IngestedArchive {
    pub sha256: String,
    pub compressed_size: u64,
    pub path: PathBuf,
    pub reused: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum ArchiveIngestError {
    #[error("publication source is not a regular file: {0}")]
    SourceNotRegular(PathBuf),
    #[error("publication source is {actual} bytes; compressed limit is {limit}")]
    SourceTooLarge { actual: u64, limit: u64 },
    #[error("publication archive is unsafe: {0}")]
    UnsafeArchive(#[from] ArchiveSafetyError),
    #[error("existing archive object is unsafe: {0}")]
    ExistingObjectUnsafe(PathBuf),
    #[error("existing archive object does not match its content address: {0}")]
    ExistingObjectMismatch(PathBuf),
    #[error("publication archive I/O failed: {0}")]
    Io(#[from] std::io::Error),
}

struct TemporaryArchive {
    path: PathBuf,
    remove_on_drop: bool,
}

impl TemporaryArchive {
    fn new(path: PathBuf) -> Self {
        Self {
            path,
            remove_on_drop: true,
        }
    }

    fn disarm(&mut self) {
        self.remove_on_drop = false;
    }
}

impl Drop for TemporaryArchive {
    fn drop(&mut self) {
        if self.remove_on_drop {
            let _ = fs::remove_file(&self.path);
        }
    }
}

fn hash_file(path: &Path) -> Result<String, ArchiveIngestError> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn verify_existing_object(
    path: &Path,
    expected_size: u64,
    expected_hash: &str,
) -> Result<(), ArchiveIngestError> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.file_type().is_file() {
        return Err(ArchiveIngestError::ExistingObjectUnsafe(path.to_path_buf()));
    }
    if metadata.len() != expected_size || hash_file(path)? != expected_hash {
        return Err(ArchiveIngestError::ExistingObjectMismatch(
            path.to_path_buf(),
        ));
    }
    let mut permissions = metadata.permissions();
    if !permissions.readonly() {
        permissions.set_readonly(true);
        fs::set_permissions(path, permissions)?;
    }
    Ok(())
}

fn set_readonly(path: &Path) -> Result<(), ArchiveIngestError> {
    let mut permissions = fs::metadata(path)?.permissions();
    permissions.set_readonly(true);
    fs::set_permissions(path, permissions)?;
    Ok(())
}

pub fn ingest_epub_archive(
    source_path: &Path,
    publication_root: &Path,
    limits: ArchiveIngestLimits,
) -> Result<IngestedArchive, ArchiveIngestError> {
    let source_metadata = fs::symlink_metadata(source_path)?;
    if !source_metadata.file_type().is_file() {
        return Err(ArchiveIngestError::SourceNotRegular(
            source_path.to_path_buf(),
        ));
    }
    if source_metadata.len() > limits.max_compressed_size {
        return Err(ArchiveIngestError::SourceTooLarge {
            actual: source_metadata.len(),
            limit: limits.max_compressed_size,
        });
    }

    let temporary_root = publication_root.join("tmp");
    fs::create_dir_all(&temporary_root)?;
    let temporary_path = temporary_root.join(format!(".ingest-{}.epub", uuid::Uuid::new_v4()));
    let mut temporary = TemporaryArchive::new(temporary_path.clone());
    let mut source = File::open(source_path)?;
    let mut destination = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary_path)?;
    let mut hasher = Sha256::new();
    let mut compressed_size = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];

    loop {
        let read = source.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        compressed_size =
            compressed_size
                .checked_add(read as u64)
                .ok_or(ArchiveIngestError::SourceTooLarge {
                    actual: u64::MAX,
                    limit: limits.max_compressed_size,
                })?;
        if compressed_size > limits.max_compressed_size {
            return Err(ArchiveIngestError::SourceTooLarge {
                actual: compressed_size,
                limit: limits.max_compressed_size,
            });
        }
        hasher.update(&buffer[..read]);
        destination.write_all(&buffer[..read])?;
    }
    destination.flush()?;
    destination.sync_all()?;
    drop(destination);

    validate_epub_archive(File::open(&temporary_path)?, limits.archive)?;

    let sha256 = format!("{:x}", hasher.finalize());
    let object_path = publication_root
        .join("sha256")
        .join(&sha256[..2])
        .join(format!("{sha256}.epub"));
    fs::create_dir_all(
        object_path
            .parent()
            .expect("content-addressed path has a parent"),
    )?;

    match fs::hard_link(&temporary_path, &object_path) {
        Ok(()) => {
            // Remove the temporary link before setting the inode read-only; on Windows,
            // a read-only attribute can otherwise prevent deleting that temporary name.
            fs::remove_file(&temporary_path)?;
            temporary.disarm();
            if let Err(error) = set_readonly(&object_path) {
                let _ = fs::remove_file(&object_path);
                return Err(error);
            }
            Ok(IngestedArchive {
                sha256,
                compressed_size,
                path: object_path,
                reused: false,
            })
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            verify_existing_object(&object_path, compressed_size, &sha256)?;
            Ok(IngestedArchive {
                sha256,
                compressed_size,
                path: object_path,
                reused: true,
            })
        }
        Err(error) => Err(error.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    const MINIMAL_SHA256: &str = "fa03b03d20bd3b843da1db0318a090ad2c8d426b4c41feae9fae5bccfea1a4d7";

    struct Workspace(PathBuf);

    impl Workspace {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "reader-archive-ingest-{name}-{}",
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

    fn temporary_files(root: &Path) -> Vec<PathBuf> {
        let mut found = Vec::new();
        let Ok(entries) = fs::read_dir(root) else {
            return found;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                found.extend(temporary_files(&path));
            } else if path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.contains(".ingest-"))
            {
                found.push(path);
            }
        }
        found
    }

    #[test]
    fn streams_validated_bytes_to_the_content_addressed_immutable_path() {
        let workspace = Workspace::new("valid");
        let source = workspace.path("user-selected.epub");
        let root = workspace.path("app-publications");
        fs::copy(fixture("minimal-epub3.epub"), &source).unwrap();
        let original = fs::read(&source).unwrap();

        let ingested = ingest_epub_archive(&source, &root, ArchiveIngestLimits::default()).unwrap();

        assert_eq!(ingested.sha256, MINIMAL_SHA256);
        assert_eq!(ingested.compressed_size, original.len() as u64);
        assert_eq!(
            ingested.path,
            root.join("sha256/fa")
                .join(format!("{MINIMAL_SHA256}.epub"))
        );
        assert!(!ingested.reused);
        assert_eq!(fs::read(&ingested.path).unwrap(), original);
        assert_eq!(fs::read(&source).unwrap(), original);
        assert!(fs::metadata(&ingested.path)
            .unwrap()
            .permissions()
            .readonly());
        assert!(temporary_files(&root).is_empty());
    }

    #[test]
    fn reuses_an_identical_archive_without_creating_another_object() {
        let workspace = Workspace::new("reuse");
        let root = workspace.path("app-publications");
        let source = fixture("minimal-epub3.epub");

        let first = ingest_epub_archive(&source, &root, ArchiveIngestLimits::default()).unwrap();
        let second = ingest_epub_archive(&source, &root, ArchiveIngestLimits::default()).unwrap();

        assert!(!first.reused);
        assert!(second.reused);
        assert_eq!(first.path, second.path);
        assert!(temporary_files(&root).is_empty());
    }

    #[test]
    fn rejects_oversized_or_invalid_sources_without_publishing_partial_objects() {
        let workspace = Workspace::new("failures");
        let root = workspace.path("app-publications");
        let valid_source = fixture("minimal-epub3.epub");
        let valid_size = fs::metadata(&valid_source).unwrap().len();
        let error = ingest_epub_archive(
            &valid_source,
            &root,
            ArchiveIngestLimits {
                max_compressed_size: valid_size - 1,
                archive: ArchiveLimits::default(),
            },
        )
        .unwrap_err();
        assert!(matches!(error, ArchiveIngestError::SourceTooLarge { .. }));

        let invalid = workspace.path("not-an-epub.epub");
        fs::write(&invalid, b"not a ZIP archive").unwrap();
        let error =
            ingest_epub_archive(&invalid, &root, ArchiveIngestLimits::default()).unwrap_err();
        assert!(matches!(error, ArchiveIngestError::UnsafeArchive(_)));
        assert!(temporary_files(&root).is_empty());
        assert!(!root.join("sha256").exists());
    }

    #[test]
    fn never_overwrites_a_corrupt_object_at_the_expected_hash_path() {
        let workspace = Workspace::new("collision");
        let root = workspace.path("app-publications");
        let destination = root
            .join("sha256/fa")
            .join(format!("{MINIMAL_SHA256}.epub"));
        fs::create_dir_all(destination.parent().unwrap()).unwrap();
        fs::write(&destination, b"corrupt existing object").unwrap();

        let error = ingest_epub_archive(
            &fixture("minimal-epub3.epub"),
            &root,
            ArchiveIngestLimits::default(),
        )
        .unwrap_err();

        assert!(matches!(
            error,
            ArchiveIngestError::ExistingObjectMismatch(path) if path == destination
        ));
        assert_eq!(fs::read(&destination).unwrap(), b"corrupt existing object");
        assert!(temporary_files(&root).is_empty());
    }
}
