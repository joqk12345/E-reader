use super::archive::ArchiveLimits;
use super::store::{PublicationStoreError, ZipPublicationStore};
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum PublicationSessionError {
    #[error("publication session not found: {0}")]
    SessionNotFound(String),
    #[error("publication session state is unavailable")]
    StateUnavailable,
    #[error(transparent)]
    Store(#[from] PublicationStoreError),
}

struct PublicationSession {
    document_id: String,
    store: ZipPublicationStore,
}

type SharedSession = Arc<Mutex<PublicationSession>>;

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
        let store = ZipPublicationStore::open(source_path, limits)?;
        let session = Arc::new(Mutex::new(PublicationSession {
            document_id: document_id.into(),
            store,
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
        let result = session
            .lock()
            .map_err(|_| PublicationSessionError::StateUnavailable)?
            .store
            .load_text(base_href, href)?;
        Ok(result)
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
            .store
            .load_blob(base_href, href)?;
        Ok(result)
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
    use std::path::PathBuf;

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
