use super::archive::ArchiveLimits;
use super::content_policy::{classify_render_resource, RenderResourceKind};
use super::css_sanitizer::{sanitize_css, CssSanitizationLimits};
use super::resources::PublicationResourceIndex;
use super::sanitizer::{sanitize_xhtml, SanitizationLimits, CONTENT_POLICY_VERSION};
use super::store::{PublicationStoreError, ZipPublicationStore};
use super::svg_sanitizer::sanitize_svg;
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum PublicationSessionError {
    #[error("publication session not found: {0}")]
    SessionNotFound(String),
    #[error("publication session state is unavailable")]
    StateUnavailable,
    #[error("publication render content was refused for {path}: {reason}")]
    ContentRefused { path: String, reason: String },
    #[error(transparent)]
    Store(#[from] PublicationStoreError),
}

struct PublicationSession {
    document_id: String,
    store: ZipPublicationStore,
    content_policy: Option<PublicationContentPolicy>,
    sanitized_resources: Option<PublicationResourceIndex>,
    sanitized_cache: HashMap<String, Vec<u8>>,
}

fn content_refused(path: &str, reason: impl Into<String>) -> PublicationSessionError {
    PublicationSessionError::ContentRefused {
        path: path.into(),
        reason: reason.into(),
    }
}

impl PublicationSession {
    fn load_render_blob(
        &mut self,
        base_href: &str,
        href: &str,
    ) -> Result<Vec<u8>, PublicationSessionError> {
        let resolved = self.store.resolve(base_href, href)?;
        let Some(policy) = &self.content_policy else {
            return self
                .store
                .load_resolved_blob(&resolved.path)
                .map_err(Into::into);
        };
        let kind = classify_render_resource(
            &resolved.path,
            policy.media_types.get(&resolved.path).map(String::as_str),
        )
        .map_err(|error| content_refused(&resolved.path, error.to_string()))?;
        if kind == RenderResourceKind::Script {
            return Err(content_refused(
                &resolved.path,
                "script resources are not renderable",
            ));
        }
        if kind == RenderResourceKind::Raw {
            return self
                .store
                .load_resolved_blob(&resolved.path)
                .map_err(Into::into);
        }
        if let Some(bytes) = self.sanitized_cache.get(&resolved.path) {
            return Ok(bytes.clone());
        }
        let source = self.store.load_resolved_blob(&resolved.path)?;
        let resources = self
            .sanitized_resources
            .as_ref()
            .ok_or_else(|| content_refused(&resolved.path, "sanitizer allowlist is unavailable"))?;
        let sanitized = match kind {
            RenderResourceKind::Xhtml => sanitize_xhtml(
                &source,
                &resolved.path,
                resources,
                policy.version,
                SanitizationLimits::default(),
            )
            .map_err(|error| content_refused(&resolved.path, error.to_string()))?,
            RenderResourceKind::Css => sanitize_css(
                &source,
                &resolved.path,
                resources,
                policy.version,
                CssSanitizationLimits::default(),
            )
            .map_err(|error| content_refused(&resolved.path, error.to_string()))?,
            RenderResourceKind::Svg => sanitize_svg(
                &source,
                &resolved.path,
                resources,
                policy.version,
                SanitizationLimits::default(),
            )
            .map_err(|error| content_refused(&resolved.path, error.to_string()))?,
            RenderResourceKind::Raw | RenderResourceKind::Script => unreachable!(),
        };
        self.sanitized_cache
            .insert(resolved.path, sanitized.bytes.clone());
        Ok(sanitized.bytes)
    }
}

type SharedSession = Arc<Mutex<PublicationSession>>;

#[derive(Debug, Clone)]
pub struct PublicationContentPolicy {
    pub version: u32,
    pub media_types: HashMap<String, String>,
}

#[derive(Default)]
pub struct PublicationSessionRegistry {
    sessions: Mutex<HashMap<String, SharedSession>>,
}

impl PublicationSessionRegistry {
    pub fn open(
        &self,
        document_id: impl Into<String>,
        source_path: impl AsRef<Path>,
        limits: ArchiveLimits,
    ) -> Result<String, PublicationSessionError> {
        self.open_with_policy(document_id, source_path, limits, None)
    }

    fn open_with_policy(
        &self,
        document_id: impl Into<String>,
        source_path: impl AsRef<Path>,
        limits: ArchiveLimits,
        content_policy: Option<PublicationContentPolicy>,
    ) -> Result<String, PublicationSessionError> {
        let store = ZipPublicationStore::open(source_path, limits)?;
        let sanitized_resources = content_policy
            .as_ref()
            .map(|policy| PublicationResourceIndex::new(policy.media_types.keys().cloned()))
            .transpose()
            .map_err(PublicationStoreError::Resolve)?;
        if let Some(policy) = &content_policy {
            if policy.version != CONTENT_POLICY_VERSION {
                return Err(PublicationSessionError::ContentRefused {
                    path: "<publication>".into(),
                    reason: format!("unsupported content policy version: {}", policy.version),
                });
            }
            for href in policy.media_types.keys() {
                store.resolve("", href)?;
            }
        }
        let session = Arc::new(Mutex::new(PublicationSession {
            document_id: document_id.into(),
            store,
            content_policy,
            sanitized_resources,
            sanitized_cache: HashMap::new(),
        }));
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| PublicationSessionError::StateUnavailable)?;
        loop {
            let session_id = uuid::Uuid::new_v4().to_string();
            if !sessions.contains_key(&session_id) {
                sessions.insert(session_id.clone(), Arc::clone(&session));
                return Ok(session_id);
            }
        }
    }

    pub fn open_sanitized(
        &self,
        document_id: impl Into<String>,
        source_path: impl AsRef<Path>,
        limits: ArchiveLimits,
        policy: PublicationContentPolicy,
    ) -> Result<String, PublicationSessionError> {
        self.open_with_policy(document_id, source_path, limits, Some(policy))
    }

    pub fn document_id(&self, session_id: &str) -> Result<String, PublicationSessionError> {
        let session = self.session(session_id)?;
        let document_id = session
            .lock()
            .map_err(|_| PublicationSessionError::StateUnavailable)?
            .document_id
            .clone();
        Ok(document_id)
    }

    pub fn resource_sizes(
        &self,
        session_id: &str,
    ) -> Result<HashMap<String, u64>, PublicationSessionError> {
        let session = self.session(session_id)?;
        let sizes = session
            .lock()
            .map_err(|_| PublicationSessionError::StateUnavailable)?
            .store
            .resource_sizes();
        Ok(sizes)
    }

    pub fn load_text(
        &self,
        session_id: &str,
        base_href: &str,
        href: &str,
    ) -> Result<String, PublicationSessionError> {
        let session = self.session(session_id)?;
        let bytes = session
            .lock()
            .map_err(|_| PublicationSessionError::StateUnavailable)?
            .load_render_blob(base_href, href)?;
        String::from_utf8(bytes).map_err(|_| {
            PublicationSessionError::Store(PublicationStoreError::InvalidText(href.into()))
        })
    }

    pub fn load_blob(
        &self,
        session_id: &str,
        base_href: &str,
        href: &str,
    ) -> Result<Vec<u8>, PublicationSessionError> {
        let session = self.session(session_id)?;
        let result = session
            .lock()
            .map_err(|_| PublicationSessionError::StateUnavailable)?
            .load_render_blob(base_href, href);
        result
    }

    pub fn get_size(
        &self,
        session_id: &str,
        base_href: &str,
        href: &str,
    ) -> Result<u64, PublicationSessionError> {
        let session = self.session(session_id)?;
        let result = session
            .lock()
            .map_err(|_| PublicationSessionError::StateUnavailable)?
            .store
            .get_size(base_href, href)?;
        Ok(result)
    }

    pub fn close(&self, session_id: &str) -> Result<(), PublicationSessionError> {
        let removed = self
            .sessions
            .lock()
            .map_err(|_| PublicationSessionError::StateUnavailable)?
            .remove(session_id);
        removed
            .map(|_| ())
            .ok_or_else(|| PublicationSessionError::SessionNotFound(session_id.into()))
    }

    fn session(&self, session_id: &str) -> Result<SharedSession, PublicationSessionError> {
        self.sessions
            .lock()
            .map_err(|_| PublicationSessionError::StateUnavailable)?
            .get(session_id)
            .cloned()
            .ok_or_else(|| PublicationSessionError::SessionNotFound(session_id.into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::publication::resources::ResourceResolveError;
    use std::io::Write;
    use std::path::PathBuf;
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    fn fixture(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../tests/fixtures/epub")
            .join(name)
    }

    #[test]
    fn opens_unpredictable_document_bound_sessions_and_closes_them() {
        let registry = PublicationSessionRegistry::default();
        let session_id = registry
            .open(
                "document-1",
                fixture("minimal-epub3.epub"),
                ArchiveLimits::default(),
            )
            .unwrap();

        assert_ne!(session_id, "document-1");
        assert!(uuid::Uuid::parse_str(&session_id).is_ok());
        assert_eq!(registry.document_id(&session_id).unwrap(), "document-1");
        assert!(registry
            .load_text(&session_id, "EPUB/nav.xhtml", "chapter.xhtml")
            .unwrap()
            .contains("structured text"));

        registry.close(&session_id).unwrap();
        assert_eq!(
            registry.document_id(&session_id).unwrap_err(),
            PublicationSessionError::SessionNotFound(session_id)
        );
    }

    #[test]
    fn isolates_resource_allowlists_between_publication_sessions() {
        let registry = PublicationSessionRegistry::default();
        let epub3 = registry
            .open(
                "document-epub3",
                fixture("minimal-epub3.epub"),
                ArchiveLimits::default(),
            )
            .unwrap();
        let epub2 = registry
            .open(
                "document-epub2",
                fixture("short-toc-epub2.epub"),
                ArchiveLimits::default(),
            )
            .unwrap();

        let error = registry
            .load_blob(&epub2, "OEBPS/one.xhtml", "../EPUB/image.svg")
            .unwrap_err();
        assert_eq!(
            error,
            PublicationSessionError::Store(PublicationStoreError::Resolve(
                ResourceResolveError::ResourceNotAllowed("EPUB/image.svg".into())
            ))
        );
        assert!(
            registry
                .get_size(&epub3, "EPUB/chapter.xhtml", "image.svg")
                .unwrap()
                > 0
        );
    }

    #[test]
    fn canonical_sessions_sanitize_active_fixture_resources_and_refuse_scripts() {
        let registry = PublicationSessionRegistry::default();
        let session_id = registry
            .open_sanitized(
                "active-document",
                fixture("active-content-epub3.epub"),
                ArchiveLimits::default(),
                PublicationContentPolicy {
                    version: 1,
                    media_types: HashMap::from([
                        ("EPUB/chapter.xhtml".into(), "application/xhtml+xml".into()),
                        ("EPUB/style.css".into(), "text/css".into()),
                        ("EPUB/payload.js".into(), "application/javascript".into()),
                    ]),
                },
            )
            .unwrap();

        let chapter = registry
            .load_text(&session_id, "", "EPUB/chapter.xhtml")
            .unwrap();
        assert!(chapter.contains("Active content must remain inert"));
        for removed in [
            "<script",
            "onload=",
            "example.invalid/reader-epub-image-probe",
            "example.invalid/reader-epub-frame-probe",
            "example.invalid/reader-epub-form-probe",
            "<iframe",
            "<form",
            "javascript:",
        ] {
            assert!(
                !chapter.contains(removed),
                "active XHTML survived: {removed}"
            );
        }
        let css = String::from_utf8(
            registry
                .load_blob(&session_id, "", "EPUB/style.css")
                .unwrap(),
        )
        .unwrap();
        assert!(!css.contains("example.invalid"));
        assert!(matches!(
            registry.load_blob(&session_id, "", "EPUB/payload.js"),
            Err(PublicationSessionError::ContentRefused { .. })
        ));
    }

    #[test]
    fn canonical_sessions_preserve_safe_xhtml_svg_and_cache_identical_render_bytes() {
        let registry = PublicationSessionRegistry::default();
        let session_id = registry
            .open_sanitized(
                "safe-document",
                fixture("minimal-epub3.epub"),
                ArchiveLimits::default(),
                PublicationContentPolicy {
                    version: 1,
                    media_types: HashMap::from([
                        ("EPUB/chapter.xhtml".into(), "application/xhtml+xml".into()),
                        ("EPUB/image.svg".into(), "image/svg+xml".into()),
                    ]),
                },
            )
            .unwrap();

        let chapter = registry
            .load_text(&session_id, "", "EPUB/chapter.xhtml")
            .unwrap();
        assert!(chapter.contains("<em>structured text</em>"));
        let first = registry
            .load_blob(&session_id, "EPUB/chapter.xhtml", "image.svg")
            .unwrap();
        let second = registry
            .load_blob(&session_id, "", "EPUB/image.svg")
            .unwrap();
        assert_eq!(first, second);
        assert!(first.starts_with(b"<svg"));
        assert!(!first.windows(5).any(|window| window == b"<html"));
    }

    #[test]
    fn sanitizer_failures_never_fall_back_to_raw_resource_bytes() {
        let path = std::env::temp_dir().join(format!(
            "reader-invalid-render-resource-{}.epub",
            uuid::Uuid::new_v4()
        ));
        let file = std::fs::File::create(&path).unwrap();
        let mut writer = ZipWriter::new(file);
        writer
            .start_file("EPUB/invalid.xhtml", SimpleFileOptions::default())
            .unwrap();
        writer.write_all(&[0xff, 0xfe, b'<', b'p', b'>']).unwrap();
        writer.finish().unwrap();

        let registry = PublicationSessionRegistry::default();
        let session_id = registry
            .open_sanitized(
                "invalid-content",
                &path,
                ArchiveLimits::default(),
                PublicationContentPolicy {
                    version: 1,
                    media_types: HashMap::from([(
                        "EPUB/invalid.xhtml".into(),
                        "application/xhtml+xml".into(),
                    )]),
                },
            )
            .unwrap();
        let error = registry
            .load_blob(&session_id, "", "EPUB/invalid.xhtml")
            .unwrap_err();
        assert!(matches!(
            error,
            PublicationSessionError::ContentRefused { .. }
        ));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn canonical_sessions_refuse_unknown_active_extensions_and_policy_versions() {
        let registry = PublicationSessionRegistry::default();
        let unsupported = registry.open_sanitized(
            "unsupported-policy",
            fixture("minimal-epub3.epub"),
            ArchiveLimits::default(),
            PublicationContentPolicy {
                version: 999,
                media_types: HashMap::new(),
            },
        );
        assert!(matches!(
            unsupported,
            Err(PublicationSessionError::ContentRefused { .. })
        ));

        let session_id = registry
            .open_sanitized(
                "missing-manifest-media",
                fixture("minimal-epub3.epub"),
                ArchiveLimits::default(),
                PublicationContentPolicy {
                    version: 1,
                    media_types: HashMap::new(),
                },
            )
            .unwrap();
        assert!(matches!(
            registry.load_text(&session_id, "", "EPUB/chapter.xhtml"),
            Err(PublicationSessionError::ContentRefused { .. })
        ));
    }

    #[test]
    fn rejects_unknown_session_ids_for_every_operation() {
        let registry = PublicationSessionRegistry::default();
        for error in [
            registry
                .load_text("unknown", "EPUB/nav.xhtml", "chapter.xhtml")
                .unwrap_err(),
            registry
                .load_blob("unknown", "EPUB/nav.xhtml", "chapter.xhtml")
                .unwrap_err(),
            registry
                .get_size("unknown", "EPUB/nav.xhtml", "chapter.xhtml")
                .unwrap_err(),
            registry.close("unknown").unwrap_err(),
        ] {
            assert_eq!(
                error,
                PublicationSessionError::SessionNotFound("unknown".into())
            );
        }
    }
}
