use percent_encoding::percent_decode_str;
use std::collections::HashSet;
use url::Url;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ResourceResolveError {
    #[error("invalid publication resource path: {0}")]
    InvalidResourcePath(String),
    #[error("base resource is outside the publication allowlist: {0}")]
    BaseNotAllowed(String),
    #[error("external resource reference is not allowed: {0}")]
    ExternalReference(String),
    #[error("unsafe resource reference: {0}")]
    UnsafeReference(String),
    #[error("resource is outside the publication allowlist: {0}")]
    ResourceNotAllowed(String),
}

#[derive(Debug, PartialEq, Eq)]
pub struct ResolvedResource {
    pub path: String,
    pub fragment: Option<String>,
}

#[derive(Debug)]
pub struct PublicationResourceIndex {
    allowed: HashSet<String>,
}

fn is_valid_percent_encoding(value: &str) -> bool {
    let bytes = value.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            if index + 2 >= bytes.len()
                || !bytes[index + 1].is_ascii_hexdigit()
                || !bytes[index + 2].is_ascii_hexdigit()
            {
                return false;
            }
            index += 3;
        } else {
            index += 1;
        }
    }
    true
}

fn validate_allowlist_path(path: &str) -> bool {
    if path.is_empty()
        || path.starts_with('/')
        || path.contains('\\')
        || path.chars().any(char::is_control)
        || path.ends_with('/')
        || (path.len() >= 3
            && path.as_bytes()[0].is_ascii_alphabetic()
            && path.as_bytes()[1] == b':'
            && path.as_bytes()[2] == b'/')
    {
        return false;
    }
    path.split('/')
        .all(|segment| !segment.is_empty() && segment != "." && segment != "..")
}

fn decode_utf8_component(value: &str, reference: &str) -> Result<String, ResourceResolveError> {
    if !is_valid_percent_encoding(value) {
        return Err(ResourceResolveError::UnsafeReference(reference.into()));
    }
    percent_decode_str(value)
        .decode_utf8()
        .map(|value| value.into_owned())
        .map_err(|_| ResourceResolveError::UnsafeReference(reference.into()))
}

fn decode_path_segment(segment: &str, reference: &str) -> Result<String, ResourceResolveError> {
    let decoded = decode_utf8_component(segment, reference)?;
    if decoded.contains('/')
        || decoded.contains('\\')
        || decoded.chars().any(char::is_control)
        || ((decoded == "." || decoded == "..") && decoded != segment)
    {
        return Err(ResourceResolveError::UnsafeReference(reference.into()));
    }
    Ok(decoded)
}

fn decode_fragment(fragment: &str, reference: &str) -> Result<String, ResourceResolveError> {
    let decoded = decode_utf8_component(fragment, reference)?;
    if decoded.chars().any(char::is_control) {
        return Err(ResourceResolveError::UnsafeReference(reference.into()));
    }
    Ok(decoded)
}

impl PublicationResourceIndex {
    pub fn new<I, S>(paths: I) -> Result<Self, ResourceResolveError>
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        let mut allowed = HashSet::new();
        for path in paths.into_iter().map(Into::into) {
            if !validate_allowlist_path(&path) || !allowed.insert(path.clone()) {
                return Err(ResourceResolveError::InvalidResourcePath(path));
            }
        }
        Ok(Self { allowed })
    }

    pub fn resolve_direct(
        &self,
        reference: &str,
    ) -> Result<ResolvedResource, ResourceResolveError> {
        if reference.starts_with("//") || Url::parse(reference).is_ok() {
            return Err(ResourceResolveError::ExternalReference(reference.into()));
        }
        if reference.starts_with('/') || reference.contains('\\') {
            return Err(ResourceResolveError::UnsafeReference(reference.into()));
        }

        let (before_fragment, raw_fragment) = reference
            .split_once('#')
            .map_or((reference, None), |(before, fragment)| {
                (before, Some(fragment))
            });
        let raw_path = before_fragment
            .split_once('?')
            .map_or(before_fragment, |(path, _)| path);
        let mut segments = Vec::new();
        for raw_segment in raw_path.split('/') {
            if raw_segment.is_empty() || raw_segment == "." || raw_segment == ".." {
                return Err(ResourceResolveError::UnsafeReference(reference.into()));
            }
            segments.push(decode_path_segment(raw_segment, reference)?);
        }
        let path = segments.join("/");
        if !self.allowed.contains(&path) {
            return Err(ResourceResolveError::ResourceNotAllowed(path));
        }
        let fragment = raw_fragment
            .map(|value| decode_fragment(value, reference))
            .transpose()?;
        Ok(ResolvedResource { path, fragment })
    }

    pub fn resolve(
        &self,
        base_href: &str,
        reference: &str,
    ) -> Result<ResolvedResource, ResourceResolveError> {
        if !self.allowed.contains(base_href) {
            return Err(ResourceResolveError::BaseNotAllowed(base_href.into()));
        }
        if reference.starts_with("//") || Url::parse(reference).is_ok() {
            return Err(ResourceResolveError::ExternalReference(reference.into()));
        }
        if reference.starts_with('/') || reference.contains('\\') {
            return Err(ResourceResolveError::UnsafeReference(reference.into()));
        }

        let (before_fragment, raw_fragment) = reference
            .split_once('#')
            .map_or((reference, None), |(before, fragment)| {
                (before, Some(fragment))
            });
        let relative_path = before_fragment
            .split_once('?')
            .map_or(before_fragment, |(path, _)| path);
        let mut segments: Vec<String> = base_href.split('/').map(str::to_owned).collect();
        segments.pop();

        for raw_segment in relative_path.split('/') {
            if raw_segment.is_empty() || raw_segment == "." {
                continue;
            }
            if raw_segment == ".." {
                if segments.pop().is_none() {
                    return Err(ResourceResolveError::UnsafeReference(reference.into()));
                }
                continue;
            }
            segments.push(decode_path_segment(raw_segment, reference)?);
        }

        let path = if relative_path.is_empty() {
            base_href.to_string()
        } else {
            segments.join("/")
        };
        if !self.allowed.contains(&path) {
            return Err(ResourceResolveError::ResourceNotAllowed(path));
        }

        let fragment = raw_fragment
            .map(|value| decode_fragment(value, reference))
            .transpose()?;
        Ok(ResolvedResource { path, fragment })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn index() -> PublicationResourceIndex {
        PublicationResourceIndex::new([
            "EPUB/text/chapter.xhtml",
            "EPUB/styles/main.css",
            "EPUB/images/cover image.svg",
            "EPUB/字体/正文.woff2",
        ])
        .unwrap()
    }

    #[test]
    fn resolves_relative_parent_and_percent_encoded_publication_resources() {
        assert_eq!(
            index()
                .resolve(
                    "EPUB/text/chapter.xhtml",
                    "../styles/main.css?theme=book#rule"
                )
                .unwrap(),
            ResolvedResource {
                path: "EPUB/styles/main.css".into(),
                fragment: Some("rule".into()),
            }
        );
        assert_eq!(
            index()
                .resolve(
                    "EPUB/text/chapter.xhtml",
                    "../images/cover%20image.svg#icon"
                )
                .unwrap(),
            ResolvedResource {
                path: "EPUB/images/cover image.svg".into(),
                fragment: Some("icon".into()),
            }
        );
        assert_eq!(
            index()
                .resolve(
                    "EPUB/styles/main.css",
                    "../%E5%AD%97%E4%BD%93/%E6%AD%A3%E6%96%87.woff2"
                )
                .unwrap()
                .path,
            "EPUB/字体/正文.woff2"
        );
        assert_eq!(
            index()
                .resolve("EPUB/text/chapter.xhtml", "#section%2F1")
                .unwrap()
                .fragment,
            Some("section/1".into())
        );
    }

    #[test]
    fn resolves_direct_allowlisted_paths_and_classifies_missing_or_external_paths() {
        assert_eq!(
            index()
                .resolve_direct("EPUB/images/cover%20image.svg#icon")
                .unwrap(),
            ResolvedResource {
                path: "EPUB/images/cover image.svg".into(),
                fragment: Some("icon".into())
            }
        );
        assert_eq!(
            index().resolve_direct("EPUB/missing.svg").unwrap_err(),
            ResourceResolveError::ResourceNotAllowed("EPUB/missing.svg".into())
        );
        assert_eq!(
            index()
                .resolve_direct("https://example.com/tracker.png")
                .unwrap_err(),
            ResourceResolveError::ExternalReference("https://example.com/tracker.png".into())
        );
    }

    #[test]
    fn rejects_external_and_protocol_relative_references() {
        for reference in [
            "https://example.com/font.woff2",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "data:text/plain,hello",
            "//example.com/image.png",
        ] {
            assert_eq!(
                index()
                    .resolve("EPUB/text/chapter.xhtml", reference)
                    .unwrap_err(),
                ResourceResolveError::ExternalReference(reference.into())
            );
        }
    }

    #[test]
    fn rejects_traversal_backslashes_and_encoded_path_separators() {
        for reference in [
            "../../../outside.xhtml",
            "..\\..\\outside.xhtml",
            "../images%2Foutside.svg",
            "../images%5Coutside.svg",
            "../%2e%2e/outside.xhtml",
        ] {
            assert_eq!(
                index()
                    .resolve("EPUB/text/chapter.xhtml", reference)
                    .unwrap_err(),
                ResourceResolveError::UnsafeReference(reference.into())
            );
        }
    }

    #[test]
    fn rejects_unknown_resources_and_non_allowlisted_bases() {
        assert_eq!(
            index()
                .resolve("EPUB/text/chapter.xhtml", "../images/missing.svg")
                .unwrap_err(),
            ResourceResolveError::ResourceNotAllowed("EPUB/images/missing.svg".into())
        );
        assert_eq!(
            index()
                .resolve("EPUB/text/missing.xhtml", "../styles/main.css")
                .unwrap_err(),
            ResourceResolveError::BaseNotAllowed("EPUB/text/missing.xhtml".into())
        );
    }

    #[test]
    fn rejects_unsafe_or_ambiguous_allowlist_entries() {
        for resource in [
            "../outside.xhtml",
            "/absolute.xhtml",
            "EPUB\\chapter.xhtml",
            "EPUB/./chapter.xhtml",
            "EPUB/text/../chapter.xhtml",
            "",
        ] {
            assert_eq!(
                PublicationResourceIndex::new([resource]).unwrap_err(),
                ResourceResolveError::InvalidResourcePath(resource.into())
            );
        }
        assert_eq!(
            PublicationResourceIndex::new(["EPUB/chapter.xhtml", "EPUB/chapter.xhtml"])
                .unwrap_err(),
            ResourceResolveError::InvalidResourcePath("EPUB/chapter.xhtml".into())
        );
    }
}
