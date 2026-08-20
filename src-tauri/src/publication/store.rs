use super::archive::{
    normalized_entry_path, validate_epub_archive, ArchiveLimits, ArchiveSafetyError,
};
use super::resources::{PublicationResourceIndex, ResolvedResource, ResourceResolveError};
use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use zip::ZipArchive;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum PublicationStoreError {
    #[error(transparent)]
    Archive(#[from] ArchiveSafetyError),
    #[error(transparent)]
    Resolve(#[from] ResourceResolveError),
    #[error("publication I/O error: {0}")]
    Io(String),
    #[error("publication resource is not UTF-8 text: {0}")]
    InvalidText(String),
    #[error("publication resource {path} declared {declared} bytes but produced {actual}")]
    ResourceSizeMismatch {
        path: String,
        declared: u64,
        actual: u64,
    },
}

fn read_bounded_resource(
    reader: &mut impl Read,
    path: &str,
    declared_size: u64,
) -> Result<Vec<u8>, PublicationStoreError> {
    let mut bytes = Vec::new();
    reader
        .take(declared_size.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|error| PublicationStoreError::Io(error.to_string()))?;
    let actual = bytes.len() as u64;
    if actual != declared_size {
        return Err(PublicationStoreError::ResourceSizeMismatch {
            path: path.into(),
            declared: declared_size,
            actual,
        });
    }
    Ok(bytes)
}

pub struct ZipPublicationStore {
    archive: ZipArchive<File>,
    resources: PublicationResourceIndex,
    entry_indices: HashMap<String, usize>,
    resource_sizes: HashMap<String, u64>,
}

impl std::fmt::Debug for ZipPublicationStore {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ZipPublicationStore")
            .field("resource_count", &self.entry_indices.len())
            .finish_non_exhaustive()
    }
}

impl ZipPublicationStore {
    pub fn open(
        source_path: impl AsRef<Path>,
        limits: ArchiveLimits,
    ) -> Result<Self, PublicationStoreError> {
        let mut file = File::open(source_path.as_ref())
            .map_err(|error| PublicationStoreError::Io(error.to_string()))?;
        validate_epub_archive(&mut file, limits)?;
        file.seek(SeekFrom::Start(0))
            .map_err(|error| PublicationStoreError::Io(error.to_string()))?;

        let mut archive = ZipArchive::new(file)
            .map_err(|error| ArchiveSafetyError::InvalidZip(error.to_string()))?;
        let mut entry_indices = HashMap::new();
        let mut resource_sizes = HashMap::new();
        for index in 0..archive.len() {
            let entry = archive
                .by_index(index)
                .map_err(|error| PublicationStoreError::Io(error.to_string()))?;
            if entry.is_dir() {
                continue;
            }
            let path = normalized_entry_path(entry.name())
                .ok_or_else(|| ArchiveSafetyError::UnsafePath(entry.name().into()))?;
            resource_sizes.insert(path.clone(), entry.size());
            entry_indices.insert(path, index);
        }
        let resources = PublicationResourceIndex::new(entry_indices.keys().cloned())?;

        Ok(Self {
            archive,
            resources,
            entry_indices,
            resource_sizes,
        })
    }

    pub fn resource_sizes(&self) -> HashMap<String, u64> {
        self.resource_sizes.clone()
    }

    pub fn resolve(
        &self,
        base_href: &str,
        reference: &str,
    ) -> Result<ResolvedResource, PublicationStoreError> {
        if base_href.is_empty() {
            self.resources.resolve_direct(reference).map_err(Into::into)
        } else {
            self.resources
                .resolve(base_href, reference)
                .map_err(Into::into)
        }
    }

    pub fn get_size(
        &mut self,
        base_href: &str,
        reference: &str,
    ) -> Result<u64, PublicationStoreError> {
        let resolved = self.resolve(base_href, reference)?;
        let index = self.entry_index(&resolved.path)?;
        self.archive
            .by_index(index)
            .map(|entry| entry.size())
            .map_err(|error| PublicationStoreError::Io(error.to_string()))
    }

    pub fn load_blob(
        &mut self,
        base_href: &str,
        reference: &str,
    ) -> Result<Vec<u8>, PublicationStoreError> {
        let resolved = self.resolve(base_href, reference)?;
        let index = self.entry_index(&resolved.path)?;
        let mut entry = self
            .archive
            .by_index(index)
            .map_err(|error| PublicationStoreError::Io(error.to_string()))?;
        let declared_size = entry.size();
        read_bounded_resource(&mut entry, &resolved.path, declared_size)
    }

    pub fn load_text(
        &mut self,
        base_href: &str,
        reference: &str,
    ) -> Result<String, PublicationStoreError> {
        let resolved = self.resolve(base_href, reference)?;
        let bytes = self.load_blob(base_href, reference)?;
        String::from_utf8(bytes).map_err(|_| PublicationStoreError::InvalidText(resolved.path))
    }

    fn entry_index(&self, path: &str) -> Result<usize, PublicationStoreError> {
        self.entry_indices.get(path).copied().ok_or_else(|| {
            PublicationStoreError::Resolve(ResourceResolveError::ResourceNotAllowed(path.into()))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::publication::archive::ArchiveSafetyError;
    use crate::publication::resources::ResourceResolveError;
    use std::io::Cursor;
    use std::path::PathBuf;

    fn fixture(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../tests/fixtures/epub")
            .join(name)
    }

    fn store() -> ZipPublicationStore {
        ZipPublicationStore::open(fixture("minimal-epub3.epub"), ArchiveLimits::default()).unwrap()
    }

    #[test]
    fn loads_text_relative_to_an_allowlisted_base_without_flattening_xhtml() {
        let mut store = store();
        let text = store
            .load_text("EPUB/nav.xhtml", "chapter.xhtml#details")
            .unwrap();
        assert!(text.contains("<em>structured text</em>"));
        assert!(text.contains("<img src=\"image.svg\""));
    }

    #[test]
    fn loads_blob_and_reports_uncompressed_size_on_demand() {
        let mut store = store();
        let bytes = store.load_blob("EPUB/chapter.xhtml", "image.svg").unwrap();
        assert!(bytes.starts_with(b"<svg"));
        assert_eq!(
            store
                .get_size("EPUB/chapter.xhtml", "image.svg#blue-square")
                .unwrap(),
            bytes.len() as u64
        );
    }

    #[test]
    fn blocks_unknown_and_external_resources_before_reading_archive_bytes() {
        let mut store = store();
        assert_eq!(
            store
                .load_blob("EPUB/chapter.xhtml", "missing.svg")
                .unwrap_err(),
            PublicationStoreError::Resolve(ResourceResolveError::ResourceNotAllowed(
                "EPUB/missing.svg".into()
            ))
        );
        assert_eq!(
            store
                .load_blob("EPUB/chapter.xhtml", "https://example.com/tracker.png")
                .unwrap_err(),
            PublicationStoreError::Resolve(ResourceResolveError::ExternalReference(
                "https://example.com/tracker.png".into()
            ))
        );
    }

    #[test]
    fn preserves_active_content_fixture_evidence_but_blocks_its_remote_resources() {
        let mut store = ZipPublicationStore::open(
            fixture("active-content-epub3.epub"),
            ArchiveLimits::default(),
        )
        .unwrap();
        let chapter = store.load_text("", "EPUB/chapter.xhtml").unwrap();
        assert!(chapter.contains("payload.js"));
        assert!(chapter.contains("readerInlineScriptExecuted"));
        assert!(chapter.contains("https://example.invalid/reader-epub-image-probe.png"));
        assert_eq!(
            store
                .load_blob(
                    "EPUB/chapter.xhtml",
                    "https://example.invalid/reader-epub-image-probe.png"
                )
                .unwrap_err(),
            PublicationStoreError::Resolve(ResourceResolveError::ExternalReference(
                "https://example.invalid/reader-epub-image-probe.png".into()
            ))
        );
    }

    #[test]
    fn bounded_reader_rejects_content_larger_than_declared_metadata() {
        let error =
            read_bounded_resource(&mut Cursor::new(b"1234"), "resource.bin", 3).unwrap_err();
        assert_eq!(
            error,
            PublicationStoreError::ResourceSizeMismatch {
                path: "resource.bin".into(),
                declared: 3,
                actual: 4,
            }
        );
    }

    #[test]
    fn applies_archive_limits_before_creating_a_readable_store() {
        let error = ZipPublicationStore::open(
            fixture("minimal-epub3.epub"),
            ArchiveLimits {
                max_entries: 1,
                ..ArchiveLimits::default()
            },
        )
        .unwrap_err();
        assert_eq!(
            error,
            PublicationStoreError::Archive(ArchiveSafetyError::TooManyEntries {
                actual: 7,
                limit: 1
            })
        );
    }
}
