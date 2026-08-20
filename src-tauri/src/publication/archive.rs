use std::collections::HashSet;
use std::io::{Read, Seek};
use std::path::{Component, Path};
use zip::ZipArchive;

#[derive(Debug, Clone, Copy)]
pub struct ArchiveLimits {
    pub max_entries: usize,
    pub max_single_file_size: u64,
    pub max_total_uncompressed_size: u64,
    pub max_compression_ratio: u64,
}

impl Default for ArchiveLimits {
    fn default() -> Self {
        Self {
            max_entries: 10_000,
            max_single_file_size: 64 * 1024 * 1024,
            max_total_uncompressed_size: 512 * 1024 * 1024,
            max_compression_ratio: 200,
        }
    }
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ArchiveSafetyError {
    #[error("invalid ZIP archive: {0}")]
    InvalidZip(String),
    #[error("unsafe archive path: {0}")]
    UnsafePath(String),
    #[error("duplicate archive path: {0}")]
    DuplicatePath(String),
    #[error("archive has {actual} entries; limit is {limit}")]
    TooManyEntries { actual: usize, limit: usize },
    #[error("archive entry {path} is {actual} bytes; per-file limit is {limit}")]
    SingleFileTooLarge {
        path: String,
        actual: u64,
        limit: u64,
    },
    #[error("archive expands to {actual} bytes; total limit is {limit}")]
    TotalSizeTooLarge { actual: u64, limit: u64 },
    #[error("archive entry {path} has compression ratio {ratio}; limit is {limit}")]
    CompressionRatioTooHigh {
        path: String,
        ratio: u64,
        limit: u64,
    },
}

#[derive(Debug, PartialEq, Eq)]
pub struct ArchiveSummary {
    pub entries: usize,
    pub total_uncompressed_size: u64,
}

pub(super) fn normalized_entry_path(name: &str) -> Option<String> {
    if name.is_empty()
        || name.contains('\\')
        || name.chars().any(char::is_control)
        || name.starts_with('/')
        || (name.len() >= 3
            && name.as_bytes()[0].is_ascii_alphabetic()
            && name.as_bytes()[1] == b':'
            && name.as_bytes()[2] == b'/')
    {
        return None;
    }

    let mut components = Vec::new();
    for component in Path::new(name).components() {
        match component {
            Component::Normal(value) => components.push(value.to_string_lossy().into_owned()),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => return None,
        }
    }
    (!components.is_empty()).then(|| components.join("/"))
}

pub fn validate_epub_archive<R: Read + Seek>(
    reader: R,
    limits: ArchiveLimits,
) -> Result<ArchiveSummary, ArchiveSafetyError> {
    let mut archive = ZipArchive::new(reader)
        .map_err(|error| ArchiveSafetyError::InvalidZip(error.to_string()))?;
    let entries = archive.len();
    if entries > limits.max_entries {
        return Err(ArchiveSafetyError::TooManyEntries {
            actual: entries,
            limit: limits.max_entries,
        });
    }

    let mut seen_paths = HashSet::with_capacity(entries);
    let mut total_uncompressed_size = 0_u64;
    for index in 0..entries {
        let entry = archive
            .by_index(index)
            .map_err(|error| ArchiveSafetyError::InvalidZip(error.to_string()))?;
        let raw_path = entry.name().to_string();
        if entry.is_symlink() {
            return Err(ArchiveSafetyError::UnsafePath(raw_path));
        }
        let normalized_path = normalized_entry_path(&raw_path)
            .ok_or_else(|| ArchiveSafetyError::UnsafePath(raw_path.clone()))?;
        if !seen_paths.insert(normalized_path.clone()) {
            return Err(ArchiveSafetyError::DuplicatePath(normalized_path));
        }

        let size = entry.size();
        if size > limits.max_single_file_size {
            return Err(ArchiveSafetyError::SingleFileTooLarge {
                path: normalized_path,
                actual: size,
                limit: limits.max_single_file_size,
            });
        }
        total_uncompressed_size = total_uncompressed_size.checked_add(size).ok_or(
            ArchiveSafetyError::TotalSizeTooLarge {
                actual: u64::MAX,
                limit: limits.max_total_uncompressed_size,
            },
        )?;
        if total_uncompressed_size > limits.max_total_uncompressed_size {
            return Err(ArchiveSafetyError::TotalSizeTooLarge {
                actual: total_uncompressed_size,
                limit: limits.max_total_uncompressed_size,
            });
        }

        let compressed_size = entry.compressed_size();
        let ratio = if size == 0 {
            0
        } else if compressed_size == 0 {
            u64::MAX
        } else {
            size.div_ceil(compressed_size)
        };
        if ratio > limits.max_compression_ratio {
            return Err(ArchiveSafetyError::CompressionRatioTooHigh {
                path: normalized_path,
                ratio,
                limit: limits.max_compression_ratio,
            });
        }
    }

    Ok(ArchiveSummary {
        entries,
        total_uncompressed_size,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::{Cursor, Write};
    use std::path::PathBuf;
    use zip::write::SimpleFileOptions;
    use zip::{CompressionMethod, ZipWriter};

    fn archive(entries: &[(&str, &[u8])], compression: CompressionMethod) -> Cursor<Vec<u8>> {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        let options = SimpleFileOptions::default().compression_method(compression);
        for (name, bytes) in entries {
            writer.start_file(*name, options).unwrap();
            writer.write_all(bytes).unwrap();
        }
        writer.finish().unwrap()
    }

    fn symlink_archive() -> Cursor<Vec<u8>> {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        writer
            .add_symlink(
                "EPUB/link.xhtml",
                "../outside.xhtml",
                SimpleFileOptions::default(),
            )
            .unwrap();
        writer.finish().unwrap()
    }

    fn fixture(name: &str) -> File {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../tests/fixtures/epub")
            .join(name);
        File::open(path).unwrap()
    }

    #[test]
    fn accepts_registered_valid_and_active_content_fixture_containers() {
        for name in [
            "minimal-epub3.epub",
            "short-toc-epub2.epub",
            "active-content-epub3.epub",
        ] {
            let summary = validate_epub_archive(fixture(name), ArchiveLimits::default()).unwrap();
            assert!(summary.entries >= 6, "{name} should expose its ZIP entries");
            assert!(summary.total_uncompressed_size > 0);
        }
    }

    #[test]
    fn rejects_parent_absolute_and_backslash_paths() {
        for unsafe_path in ["../escape.xhtml", "/absolute.xhtml", "..\\escape.xhtml"] {
            let error = validate_epub_archive(
                archive(&[(unsafe_path, b"unsafe")], CompressionMethod::Stored),
                ArchiveLimits::default(),
            )
            .unwrap_err();
            assert_eq!(
                error,
                ArchiveSafetyError::UnsafePath(unsafe_path.to_string())
            );
        }
    }

    #[test]
    fn rejects_symbolic_link_entries() {
        let error = validate_epub_archive(symlink_archive(), ArchiveLimits::default()).unwrap_err();
        assert_eq!(
            error,
            ArchiveSafetyError::UnsafePath("EPUB/link.xhtml".into())
        );
    }

    #[test]
    fn rejects_duplicate_archive_paths() {
        let error = validate_epub_archive(
            archive(
                &[
                    ("EPUB/chapter.xhtml", b"one"),
                    ("EPUB/./chapter.xhtml", b"two"),
                ],
                CompressionMethod::Stored,
            ),
            ArchiveLimits::default(),
        )
        .unwrap_err();
        assert_eq!(
            error,
            ArchiveSafetyError::DuplicatePath("EPUB/chapter.xhtml".into())
        );
    }

    #[test]
    fn enforces_entry_single_file_and_total_size_limits() {
        let two_entries = archive(
            &[("one", b"1234"), ("two", b"5678")],
            CompressionMethod::Stored,
        );
        let error = validate_epub_archive(
            two_entries,
            ArchiveLimits {
                max_entries: 1,
                ..ArchiveLimits::default()
            },
        )
        .unwrap_err();
        assert_eq!(
            error,
            ArchiveSafetyError::TooManyEntries {
                actual: 2,
                limit: 1
            }
        );

        let error = validate_epub_archive(
            archive(&[("large", b"1234")], CompressionMethod::Stored),
            ArchiveLimits {
                max_single_file_size: 3,
                ..ArchiveLimits::default()
            },
        )
        .unwrap_err();
        assert_eq!(
            error,
            ArchiveSafetyError::SingleFileTooLarge {
                path: "large".into(),
                actual: 4,
                limit: 3
            },
        );

        let error = validate_epub_archive(
            archive(
                &[("one", b"1234"), ("two", b"5678")],
                CompressionMethod::Stored,
            ),
            ArchiveLimits {
                max_total_uncompressed_size: 7,
                ..ArchiveLimits::default()
            },
        )
        .unwrap_err();
        assert_eq!(
            error,
            ArchiveSafetyError::TotalSizeTooLarge {
                actual: 8,
                limit: 7
            }
        );
    }

    #[test]
    fn rejects_a_high_compression_ratio_before_extraction() {
        let zeros = vec![0_u8; 64 * 1024];
        let error = validate_epub_archive(
            archive(
                &[("bomb.bin", zeros.as_slice())],
                CompressionMethod::Deflated,
            ),
            ArchiveLimits {
                max_compression_ratio: 5,
                ..ArchiveLimits::default()
            },
        )
        .unwrap_err();
        assert!(matches!(
            error,
            ArchiveSafetyError::CompressionRatioTooHigh { path, ratio, limit: 5 }
                if path == "bomb.bin" && ratio > 5
        ));
    }
}
