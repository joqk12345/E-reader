use super::archive::{
    normalized_entry_path, validate_epub_archive, ArchiveLimits, ArchiveSafetyError,
};
use super::resources::{PublicationResourceIndex, ResourceResolveError};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{Cursor, Read, Seek, SeekFrom};
use std::path::Path;
use xml::attribute::OwnedAttribute;
use xml::reader::{EventReader, XmlEvent};
use zip::ZipArchive;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PackageMetadata {
    pub title: Option<String>,
    pub creator: Option<String>,
    pub language: Option<String>,
    pub rendition_layout: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PackageResource {
    pub manifest_id: String,
    pub href: String,
    pub media_type: String,
    pub properties: Vec<String>,
    pub sha256: String,
    pub size: u64,
    pub fallback_manifest_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PackageSpineItem {
    pub manifest_id: String,
    pub spine_index: u32,
    pub linear: bool,
    pub properties: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PreparedPackage {
    pub root_file: String,
    pub metadata: PackageMetadata,
    pub resources: Vec<PackageResource>,
    pub spine: Vec<PackageSpineItem>,
    pub toc_manifest_id: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub(crate) enum PackagePrepareError {
    #[error("publication archive is unsafe: {0}")]
    Archive(#[from] ArchiveSafetyError),
    #[error("publication resource path is invalid: {0}")]
    Resource(#[from] ResourceResolveError),
    #[error("publication package is invalid: {0}")]
    InvalidPackage(String),
    #[error("publication package I/O failed: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Debug)]
struct RawManifestItem {
    id: String,
    href: String,
    media_type: String,
    properties: Vec<String>,
    fallback_manifest_id: Option<String>,
}

#[derive(Debug)]
struct RawPackage {
    metadata: PackageMetadata,
    manifest: Vec<RawManifestItem>,
    spine: Vec<PackageSpineItem>,
    toc_manifest_id: Option<String>,
}

fn invalid(message: impl Into<String>) -> PackagePrepareError {
    PackagePrepareError::InvalidPackage(message.into())
}

fn attribute(attributes: &[OwnedAttribute], name: &str) -> Option<String> {
    attributes
        .iter()
        .find(|attribute| attribute.name.local_name == name)
        .map(|attribute| attribute.value.clone())
}

fn parse_container(bytes: &[u8]) -> Result<String, PackagePrepareError> {
    for event in EventReader::new(Cursor::new(bytes)) {
        match event.map_err(|error| invalid(format!("container.xml: {error}")))? {
            XmlEvent::StartElement {
                name, attributes, ..
            } if name.local_name == "rootfile" => {
                let media_type = attribute(&attributes, "media-type");
                if media_type.as_deref() == Some("application/oebps-package+xml") {
                    return attribute(&attributes, "full-path")
                        .ok_or_else(|| invalid("container rootfile is missing full-path"));
                }
            }
            _ => {}
        }
    }
    Err(invalid("container has no supported package rootfile"))
}

fn set_metadata_value(metadata: &mut PackageMetadata, property: &str, value: String) {
    let value = value.trim().to_string();
    if value.is_empty() {
        return;
    }
    match property {
        "title" if metadata.title.is_none() => metadata.title = Some(value),
        "creator" if metadata.creator.is_none() => metadata.creator = Some(value),
        "language" if metadata.language.is_none() => metadata.language = Some(value),
        "rendition:layout" => metadata.rendition_layout = value,
        _ => {}
    }
}

fn parse_opf(bytes: &[u8]) -> Result<RawPackage, PackagePrepareError> {
    let mut metadata = PackageMetadata {
        title: None,
        creator: None,
        language: None,
        rendition_layout: "reflowable".into(),
    };
    let mut manifest = Vec::new();
    let mut spine = Vec::new();
    let mut in_metadata = false;
    let mut in_manifest = false;
    let mut in_spine = false;
    let mut toc_manifest_id = None;
    let mut text_property: Option<String> = None;
    let mut text = String::new();

    for event in EventReader::new(Cursor::new(bytes)) {
        match event.map_err(|error| invalid(format!("package OPF: {error}")))? {
            XmlEvent::StartElement {
                name, attributes, ..
            } => match name.local_name.as_str() {
                "metadata" => in_metadata = true,
                "manifest" => in_manifest = true,
                "spine" => {
                    in_spine = true;
                    toc_manifest_id = attribute(&attributes, "toc");
                }
                "title" | "creator" | "language" if in_metadata => {
                    text_property = Some(name.local_name);
                    text.clear();
                }
                "meta" if in_metadata => {
                    if let Some(property) = attribute(&attributes, "property") {
                        if property == "rendition:layout" {
                            text_property = Some(property);
                            text.clear();
                        }
                    }
                }
                "item" if in_manifest => {
                    let id = attribute(&attributes, "id")
                        .ok_or_else(|| invalid("manifest item is missing id"))?;
                    let href = attribute(&attributes, "href")
                        .ok_or_else(|| invalid(format!("manifest item {id} is missing href")))?;
                    let media_type = attribute(&attributes, "media-type").ok_or_else(|| {
                        invalid(format!("manifest item {id} is missing media-type"))
                    })?;
                    manifest.push(RawManifestItem {
                        id,
                        href,
                        media_type,
                        properties: attribute(&attributes, "properties")
                            .map(|value| value.split_whitespace().map(str::to_owned).collect())
                            .unwrap_or_default(),
                        fallback_manifest_id: attribute(&attributes, "fallback"),
                    });
                }
                "itemref" if in_spine => {
                    let manifest_id = attribute(&attributes, "idref")
                        .ok_or_else(|| invalid("spine itemref is missing idref"))?;
                    spine.push(PackageSpineItem {
                        manifest_id,
                        spine_index: spine.len() as u32,
                        linear: attribute(&attributes, "linear").as_deref() != Some("no"),
                        properties: attribute(&attributes, "properties")
                            .map(|value| value.split_whitespace().map(str::to_owned).collect())
                            .unwrap_or_default(),
                    });
                }
                _ => {}
            },
            XmlEvent::Characters(value) | XmlEvent::CData(value) if text_property.is_some() => {
                text.push_str(&value)
            }
            XmlEvent::EndElement { name } => {
                if text_property.as_deref() == Some(name.local_name.as_str())
                    || (name.local_name == "meta"
                        && text_property.as_deref() == Some("rendition:layout"))
                {
                    if let Some(property) = text_property.take() {
                        set_metadata_value(&mut metadata, &property, std::mem::take(&mut text));
                    }
                }
                match name.local_name.as_str() {
                    "metadata" => in_metadata = false,
                    "manifest" => in_manifest = false,
                    "spine" => in_spine = false,
                    _ => {}
                }
            }
            _ => {}
        }
    }

    if manifest.is_empty() {
        return Err(invalid("package manifest is empty"));
    }
    if spine.is_empty() {
        return Err(invalid("package spine is empty"));
    }
    Ok(RawPackage {
        metadata,
        manifest,
        spine,
        toc_manifest_id,
    })
}

fn read_entry(
    archive: &mut ZipArchive<File>,
    entry_indices: &HashMap<String, usize>,
    path: &str,
) -> Result<Vec<u8>, PackagePrepareError> {
    let index = entry_indices
        .get(path)
        .copied()
        .ok_or_else(|| invalid(format!("archive resource is missing: {path}")))?;
    let mut entry = archive
        .by_index(index)
        .map_err(|error| ArchiveSafetyError::InvalidZip(error.to_string()))?;
    let mut bytes = Vec::with_capacity(entry.size() as usize);
    entry.read_to_end(&mut bytes)?;
    Ok(bytes)
}

pub(crate) fn prepare_package(
    archive_path: &Path,
    limits: ArchiveLimits,
) -> Result<PreparedPackage, PackagePrepareError> {
    let mut file = File::open(archive_path)?;
    validate_epub_archive(&mut file, limits)?;
    file.seek(SeekFrom::Start(0))?;
    let mut archive =
        ZipArchive::new(file).map_err(|error| ArchiveSafetyError::InvalidZip(error.to_string()))?;
    let mut entry_indices = HashMap::new();
    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|error| ArchiveSafetyError::InvalidZip(error.to_string()))?;
        if entry.is_dir() {
            continue;
        }
        let path = normalized_entry_path(entry.name())
            .ok_or_else(|| ArchiveSafetyError::UnsafePath(entry.name().into()))?;
        entry_indices.insert(path, index);
    }
    let resource_index = PublicationResourceIndex::new(entry_indices.keys().cloned())?;
    let container = read_entry(&mut archive, &entry_indices, "META-INF/container.xml")?;
    let raw_root_file = parse_container(&container)?;
    let root_file = resource_index.resolve_direct(&raw_root_file)?.path;
    let opf = read_entry(&mut archive, &entry_indices, &root_file)?;
    let raw = parse_opf(&opf)?;

    let mut seen_ids = HashSet::new();
    let mut seen_hrefs = HashSet::new();
    let mut resources = Vec::with_capacity(raw.manifest.len());
    for item in raw.manifest {
        if !seen_ids.insert(item.id.clone()) {
            return Err(invalid(format!("duplicate manifest id: {}", item.id)));
        }
        let href = resource_index.resolve(&root_file, &item.href)?.path;
        if !seen_hrefs.insert(href.clone()) {
            return Err(invalid(format!(
                "duplicate canonical manifest href: {href}"
            )));
        }
        let bytes = read_entry(&mut archive, &entry_indices, &href)?;
        resources.push(PackageResource {
            manifest_id: item.id,
            href,
            media_type: item.media_type,
            properties: item.properties,
            sha256: format!("{:x}", Sha256::digest(&bytes)),
            size: bytes.len() as u64,
            fallback_manifest_id: item.fallback_manifest_id,
        });
    }
    resources.sort_by(|left, right| left.href.cmp(&right.href));

    let resource_ids = resources
        .iter()
        .map(|resource| resource.manifest_id.as_str())
        .collect::<HashSet<_>>();
    for resource in &resources {
        if let Some(fallback) = resource.fallback_manifest_id.as_deref() {
            if !resource_ids.contains(fallback) {
                return Err(invalid(format!(
                    "manifest fallback {fallback} does not exist"
                )));
            }
        }
    }
    for item in &raw.spine {
        if !resource_ids.contains(item.manifest_id.as_str()) {
            return Err(invalid(format!(
                "spine references unknown manifest id: {}",
                item.manifest_id
            )));
        }
    }

    Ok(PreparedPackage {
        root_file,
        metadata: raw.metadata,
        resources,
        spine: raw.spine,
        toc_manifest_id: raw.toc_manifest_id,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::{Cursor, Write};
    use std::path::PathBuf;
    use zip::write::SimpleFileOptions;
    use zip::{CompressionMethod, ZipWriter};

    fn fixture(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../tests/fixtures/epub")
            .join(name)
    }

    #[test]
    fn prepares_epub3_manifest_metadata_and_spine_without_flattening_content() {
        let package =
            prepare_package(&fixture("minimal-epub3.epub"), ArchiveLimits::default()).unwrap();

        assert_eq!(package.root_file, "EPUB/package.opf");
        assert_eq!(package.metadata.title.as_deref(), Some("Minimal EPUB 3"));
        assert_eq!(package.metadata.language.as_deref(), Some("en"));
        assert_eq!(package.metadata.rendition_layout, "reflowable");
        assert_eq!(
            package
                .resources
                .iter()
                .map(|resource| resource.href.as_str())
                .collect::<Vec<_>>(),
            vec![
                "EPUB/chapter.xhtml",
                "EPUB/image.svg",
                "EPUB/nav.xhtml",
                "EPUB/styles.css",
            ]
        );
        assert!(package
            .resources
            .iter()
            .all(|resource| { resource.sha256.len() == 64 && resource.size > 0 }));
        assert_eq!(
            package.spine,
            vec![PackageSpineItem {
                manifest_id: "chapter".into(),
                spine_index: 0,
                linear: true,
                properties: vec![],
            }]
        );
    }

    #[test]
    fn preserves_short_epub2_spine_and_resolves_percent_encoded_unicode_paths() {
        let epub2 =
            prepare_package(&fixture("short-toc-epub2.epub"), ArchiveLimits::default()).unwrap();
        assert_eq!(epub2.spine.len(), 2);
        assert_eq!(epub2.toc_manifest_id.as_deref(), Some("ncx"));
        assert_eq!(epub2.spine[0].manifest_id, "one");
        assert_eq!(epub2.spine[1].manifest_id, "two");

        let unicode = prepare_package(
            &fixture("nonascii-path-epub2.epub"),
            ArchiveLimits::default(),
        )
        .unwrap();
        assert!(unicode
            .resources
            .iter()
            .any(|resource| resource.href == "OEBPS/章节.xhtml"));
        assert_eq!(unicode.spine[0].manifest_id, "chapter");
    }

    fn package_epub(path: &Path, package: &str, include_chapter: bool) {
        let container = r#"<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>"#;
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        let stored = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        let deflated = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        writer.start_file("mimetype", stored).unwrap();
        writer.write_all(b"application/epub+zip").unwrap();
        for (name, bytes) in [
            ("META-INF/container.xml", container.as_bytes()),
            ("EPUB/package.opf", package.as_bytes()),
        ] {
            writer.start_file(name, deflated).unwrap();
            writer.write_all(bytes).unwrap();
        }
        if include_chapter {
            writer.start_file("EPUB/chapter.xhtml", deflated).unwrap();
            writer.write_all(b"<html/>").unwrap();
        }
        fs::write(path, writer.finish().unwrap().into_inner()).unwrap();
    }

    #[test]
    fn rejects_manifest_entries_that_collide_after_href_canonicalization() {
        let root = std::env::temp_dir().join(format!(
            "reader-package-duplicate-{}.epub",
            uuid::Uuid::new_v4()
        ));
        let package = r#"<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Duplicate</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2020-01-01T00:00:00Z</meta></metadata><manifest><item id="one" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="two" href="%63hapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/></spine></package>"#;
        package_epub(&root, package, true);
        let error = prepare_package(&root, ArchiveLimits::default()).unwrap_err();
        let _ = fs::remove_file(&root);

        assert!(matches!(
            error,
            PackagePrepareError::InvalidPackage(message)
                if message.contains("duplicate canonical manifest href")
        ));
    }

    #[test]
    fn preserves_fixed_layout_metadata_but_does_not_parse_malformed_xhtml_as_package_xml() {
        let fixed = prepare_package(
            &fixture("fixed-layout-epub3.epub"),
            ArchiveLimits::default(),
        )
        .unwrap();
        assert_eq!(fixed.metadata.rendition_layout, "pre-paginated");
        assert_eq!(fixed.spine[0].properties, vec!["page-spread-center"]);

        let malformed_content = prepare_package(
            &fixture("malformed-xhtml-epub3.epub"),
            ArchiveLimits::default(),
        )
        .unwrap();
        assert_eq!(malformed_content.spine.len(), 1);
    }

    #[test]
    fn rejects_missing_manifest_bytes_and_unknown_spine_references() {
        let missing = std::env::temp_dir().join(format!(
            "reader-package-missing-{}.epub",
            uuid::Uuid::new_v4()
        ));
        let package = r#"<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata/><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>"#;
        package_epub(&missing, package, false);
        let missing_error = prepare_package(&missing, ArchiveLimits::default()).unwrap_err();
        let _ = fs::remove_file(&missing);
        assert!(matches!(missing_error, PackagePrepareError::Resource(_)));

        let unknown = std::env::temp_dir().join(format!(
            "reader-package-spine-{}.epub",
            uuid::Uuid::new_v4()
        ));
        let package = r#"<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata/><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="unknown"/></spine></package>"#;
        package_epub(&unknown, package, true);
        let unknown_error = prepare_package(&unknown, ArchiveLimits::default()).unwrap_err();
        let _ = fs::remove_file(&unknown);
        assert!(matches!(
            unknown_error,
            PackagePrepareError::InvalidPackage(message)
                if message.contains("spine references unknown manifest id")
        ));
    }
}
