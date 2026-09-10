use super::resources::PublicationResourceIndex;
use cssparser::{Parser, ParserInput, Token};
use kuchikiki::traits::TendrilSink;
use kuchikiki::{parse_html_with_options, NodeRef, ParseOpts};
use std::borrow::Cow;
use std::collections::{BTreeMap, HashSet};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use url::Url;

pub const CONTENT_POLICY_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy)]
pub struct SanitizationLimits {
    pub max_input_bytes: usize,
    pub max_nodes: usize,
}

impl Default for SanitizationLimits {
    fn default() -> Self {
        Self {
            max_input_bytes: 2 * 1024 * 1024,
            max_nodes: 100_000,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SanitizationStatus {
    Exact,
    Degraded,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SanitizationDiagnostic {
    pub code: String,
    pub count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SanitizedContent {
    pub bytes: Vec<u8>,
    pub media_type: String,
    pub encoding: String,
    pub policy_version: u32,
    pub status: SanitizationStatus,
    pub diagnostics: Vec<SanitizationDiagnostic>,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum SanitizationError {
    #[error("unsupported publication content policy version: {0}")]
    UnsupportedPolicy(u32),
    #[error("publication content exceeds the sanitization byte limit: {actual} > {limit}")]
    InputTooLarge { actual: usize, limit: usize },
    #[error("publication content is not valid UTF-8")]
    InvalidEncoding,
    #[error("publication content exceeds the sanitization node limit: {actual} > {limit}")]
    TooManyNodes { actual: usize, limit: usize },
    #[error("publication content serialization failed: {0}")]
    Serialization(String),
}

fn add_diagnostic(diagnostics: &mut BTreeMap<&'static str, u32>, code: &'static str) {
    *diagnostics.entry(code).or_default() += 1;
}

fn is_svg_namespace(namespace: &str) -> bool {
    namespace == "http://www.w3.org/2000/svg"
}

fn removes_subtree(tag: &str) -> bool {
    matches!(
        tag,
        "script" | "iframe" | "frame" | "frameset" | "object" | "embed" | "applet"
    )
}

fn unwrap_element(node: &NodeRef) {
    while let Some(child) = node.first_child() {
        child.detach();
        node.insert_before(child);
    }
    node.detach();
}

fn inspect_svg_css_tokens(
    parser: &mut Parser<'_, '_>,
    resource_href: &str,
    resources: &PublicationResourceIndex,
    depth: usize,
) -> Result<(), &'static str> {
    if depth > 16 {
        return Err("publication.unsafe_url_removed");
    }
    while let Ok(token) = parser
        .next_including_whitespace_and_comments()
        .map(Clone::clone)
    {
        match token {
            Token::UnquotedUrl(value) => {
                sanitize_url(
                    "svg",
                    "presentation",
                    &value,
                    true,
                    resource_href,
                    resources,
                )?;
            }
            Token::Function(name) if name.eq_ignore_ascii_case("url") => {
                let value = parser
                    .parse_nested_block(|nested| {
                        let mut value = None;
                        let mut invalid = false;
                        while let Ok(token) = nested
                            .next_including_whitespace_and_comments()
                            .map(Clone::clone)
                        {
                            match token {
                                Token::WhiteSpace(_) | Token::Comment(_) => {}
                                Token::QuotedString(candidate) if value.is_none() => {
                                    value = Some(candidate.to_string());
                                }
                                _ => invalid = true,
                            }
                        }
                        Ok::<_, cssparser::ParseError<'_, ()>>(if invalid { None } else { value })
                    })
                    .map_err(|_| "publication.unsafe_url_removed")?
                    .ok_or("publication.unsafe_url_removed")?;
                sanitize_url(
                    "svg",
                    "presentation",
                    &value,
                    true,
                    resource_href,
                    resources,
                )?;
            }
            Token::Function(name) if name.eq_ignore_ascii_case("expression") => {
                return Err("publication.unsafe_url_removed");
            }
            Token::Function(_)
            | Token::ParenthesisBlock
            | Token::SquareBracketBlock
            | Token::CurlyBracketBlock => {
                parser
                    .parse_nested_block(|nested| {
                        inspect_svg_css_tokens(nested, resource_href, resources, depth + 1)
                            .map_err(|code| {
                                nested.new_custom_error::<&'static str, &'static str>(code)
                            })?;
                        Ok::<_, cssparser::ParseError<'_, &'static str>>(())
                    })
                    .map_err(|error| match error.kind {
                        cssparser::ParseErrorKind::Custom(code) => code,
                        cssparser::ParseErrorKind::Basic(_) => "publication.unsafe_url_removed",
                    })?;
            }
            Token::BadUrl(_)
            | Token::BadString(_)
            | Token::CloseParenthesis
            | Token::CloseSquareBracket
            | Token::CloseCurlyBracket => {
                return Err("publication.unsafe_url_removed");
            }
            _ => {}
        }
    }
    Ok(())
}

fn sanitize_svg_css_value(
    value: &str,
    resource_href: &str,
    resources: &PublicationResourceIndex,
) -> Result<(), &'static str> {
    let mut input = ParserInput::new(value);
    let mut parser = Parser::new(&mut input);
    inspect_svg_css_tokens(&mut parser, resource_href, resources, 0)
}

fn sanitize_url(
    tag: &str,
    attribute: &str,
    value: &str,
    is_svg: bool,
    resource_href: &str,
    resources: &PublicationResourceIndex,
) -> Result<(), &'static str> {
    if value.chars().any(char::is_control) {
        return Err("publication.unsafe_url_removed");
    }
    if !is_svg && matches!(tag, "a" | "area") && attribute == "href" {
        if let Ok(url) = Url::parse(value) {
            return if matches!(url.scheme(), "http" | "https" | "mailto") {
                Ok(())
            } else {
                Err("publication.unsafe_url_removed")
            };
        }
    }
    if let Ok(url) = Url::parse(value) {
        return if matches!(url.scheme(), "http" | "https") {
            Err("publication.remote_resource_blocked")
        } else {
            Err("publication.unsafe_url_removed")
        };
    }
    resources
        .resolve(resource_href, value)
        .map(|_| ())
        .map_err(|_| "publication.unsafe_url_removed")
}

pub(crate) fn without_xml_declaration(source: &str) -> &str {
    let source = source.strip_prefix('\u{feff}').unwrap_or(source);
    if source.starts_with("<?xml") {
        source
            .find("?>")
            .map_or(source, |end| &source[end.saturating_add(2)..])
    } else {
        source
    }
}

pub fn sanitize_xhtml(
    bytes: &[u8],
    resource_href: &str,
    resources: &PublicationResourceIndex,
    policy_version: u32,
    limits: SanitizationLimits,
) -> Result<SanitizedContent, SanitizationError> {
    if policy_version != CONTENT_POLICY_VERSION {
        return Err(SanitizationError::UnsupportedPolicy(policy_version));
    }
    if bytes.len() > limits.max_input_bytes {
        return Err(SanitizationError::InputTooLarge {
            actual: bytes.len(),
            limit: limits.max_input_bytes,
        });
    }
    let source = std::str::from_utf8(bytes).map_err(|_| SanitizationError::InvalidEncoding)?;
    let source = without_xml_declaration(source);
    let source = if source
        .trim_start()
        .get(..9)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("<!doctype"))
    {
        Cow::Borrowed(source)
    } else {
        Cow::Owned(format!("<!doctype html>{source}"))
    };
    let parse_error_count = Arc::new(AtomicUsize::new(0));
    let parse_error_counter = Arc::clone(&parse_error_count);
    let parsed = parse_html_with_options(ParseOpts {
        on_parse_error: Some(Box::new(move |_| {
            parse_error_counter.fetch_add(1, Ordering::Relaxed);
        })),
        ..ParseOpts::default()
    })
    .one(source.as_ref());
    let document = parsed.document_node;
    let nodes = document.descendants().collect::<Vec<_>>();
    if nodes.len() > limits.max_nodes {
        return Err(SanitizationError::TooManyNodes {
            actual: nodes.len(),
            limit: limits.max_nodes,
        });
    }

    let mut diagnostics = BTreeMap::new();
    let recovered = parse_error_count.load(Ordering::Relaxed);
    if recovered > 0 {
        diagnostics.insert("publication.markup_recovered", recovered as u32);
    }
    let mut ids = HashSet::new();

    for node in nodes {
        let Some(element) = node.as_element() else {
            continue;
        };
        let tag = element.name.local.to_string().to_ascii_lowercase();
        let namespace = element.name.ns.to_string();
        let is_svg = is_svg_namespace(&namespace);

        if removes_subtree(&tag) {
            add_diagnostic(&mut diagnostics, "publication.active_content_removed");
            if matches!(
                tag.as_str(),
                "iframe" | "frame" | "frameset" | "object" | "embed" | "applet"
            ) {
                add_diagnostic(&mut diagnostics, "publication.frame_content_removed");
            }
            if is_svg {
                add_diagnostic(&mut diagnostics, "publication.svg_content_removed");
            }
            node.detach();
            continue;
        }
        if is_svg
            && matches!(
                tag.as_str(),
                "foreignobject"
                    | "animate"
                    | "animatemotion"
                    | "animatetransform"
                    | "set"
                    | "mpath"
            )
        {
            add_diagnostic(&mut diagnostics, "publication.svg_content_removed");
            node.detach();
            continue;
        }
        if is_svg && tag == "a" {
            add_diagnostic(&mut diagnostics, "publication.svg_content_removed");
            unwrap_element(&node);
            continue;
        }
        if tag == "base" {
            add_diagnostic(&mut diagnostics, "publication.unsafe_url_removed");
            node.detach();
            continue;
        }
        if tag == "style" {
            add_diagnostic(&mut diagnostics, "publication.stylesheet_degraded");
            node.detach();
            continue;
        }

        {
            let attributes = element.attributes.borrow();
            if tag == "meta"
                && (attributes.get("http-equiv").is_some_and(|value| {
                    matches!(
                        value.trim().to_ascii_lowercase().as_str(),
                        "refresh" | "content-security-policy"
                    )
                }))
            {
                drop(attributes);
                add_diagnostic(&mut diagnostics, "publication.active_content_removed");
                node.detach();
                continue;
            }
            if tag == "link" {
                let rel = attributes
                    .get("rel")
                    .unwrap_or_default()
                    .to_ascii_lowercase();
                if rel.split_ascii_whitespace().any(|value| {
                    matches!(
                        value,
                        "preload" | "prefetch" | "preconnect" | "dns-prefetch" | "modulepreload"
                    )
                }) {
                    drop(attributes);
                    add_diagnostic(&mut diagnostics, "publication.remote_resource_blocked");
                    node.detach();
                    continue;
                }
            }
        }

        if tag == "form" {
            add_diagnostic(&mut diagnostics, "publication.form_disabled");
            unwrap_element(&node);
            continue;
        }

        let mut attributes = element.attributes.borrow_mut();
        let keys = attributes.map.keys().cloned().collect::<Vec<_>>();
        for key in keys {
            let local = key.local.to_string().to_ascii_lowercase();
            let value = attributes
                .map
                .get(&key)
                .map(|attribute| attribute.value.clone())
                .unwrap_or_default();
            if local.starts_with("on") || local == "srcdoc" {
                attributes.map.swap_remove(&key);
                add_diagnostic(&mut diagnostics, "publication.active_content_removed");
                if is_svg {
                    add_diagnostic(&mut diagnostics, "publication.svg_content_removed");
                }
                continue;
            }
            if local == "style" {
                attributes.map.swap_remove(&key);
                add_diagnostic(&mut diagnostics, "publication.stylesheet_degraded");
                continue;
            }
            if matches!(local.as_str(), "target" | "download" | "ping") {
                attributes.map.swap_remove(&key);
                continue;
            }
            if matches!(local.as_str(), "srcset" | "action" | "formaction") {
                attributes.map.swap_remove(&key);
                add_diagnostic(&mut diagnostics, "publication.unsafe_url_removed");
                continue;
            }
            if is_svg
                && matches!(
                    local.as_str(),
                    "fill"
                        | "stroke"
                        | "filter"
                        | "clip-path"
                        | "mask"
                        | "marker-start"
                        | "marker-mid"
                        | "marker-end"
                        | "cursor"
                )
            {
                if let Err(code) = sanitize_svg_css_value(value.trim(), resource_href, resources) {
                    attributes.map.swap_remove(&key);
                    add_diagnostic(&mut diagnostics, code);
                    add_diagnostic(&mut diagnostics, "publication.svg_content_removed");
                }
                continue;
            }
            if matches!(
                local.as_str(),
                "href" | "src" | "poster" | "data" | "background"
            ) {
                if let Err(code) =
                    sanitize_url(&tag, &local, value.trim(), is_svg, resource_href, resources)
                {
                    attributes.map.swap_remove(&key);
                    add_diagnostic(&mut diagnostics, code);
                }
                continue;
            }
            if local == "id" && !value.is_empty() && !ids.insert(value) {
                attributes.map.swap_remove(&key);
                add_diagnostic(&mut diagnostics, "publication.duplicate_id_removed");
            }
        }
        if matches!(
            tag.as_str(),
            "input" | "button" | "select" | "textarea" | "fieldset"
        ) {
            attributes.insert("disabled", String::new());
        }
    }

    let mut sanitized = Vec::new();
    document
        .serialize(&mut sanitized)
        .map_err(|error| SanitizationError::Serialization(error.to_string()))?;
    let diagnostics = diagnostics
        .into_iter()
        .map(|(code, count)| SanitizationDiagnostic {
            code: code.into(),
            count,
        })
        .collect::<Vec<_>>();
    Ok(SanitizedContent {
        bytes: sanitized,
        media_type: "application/xhtml+xml".into(),
        encoding: "utf-8".into(),
        policy_version,
        status: if diagnostics.is_empty() {
            SanitizationStatus::Exact
        } else {
            SanitizationStatus::Degraded
        },
        diagnostics,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use std::path::PathBuf;

    fn resources() -> PublicationResourceIndex {
        PublicationResourceIndex::new([
            "EPUB/text/chapter.xhtml",
            "EPUB/images/cover.png",
            "EPUB/styles/book.css",
            "EPUB/notes.xhtml",
        ])
        .unwrap()
    }

    fn output_text(result: &SanitizedContent) -> String {
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
    fn preserves_safe_structured_xhtml_without_security_degradation() {
        let source = br#"<!doctype html><html><head><title>Safe</title></head><body>
            <main><h1>Heading</h1><p lang="en" dir="ltr">Text <a href="../notes.xhtml#n1">note</a></p>
            <figure><img src="../images/cover.png" alt="Cover"><figcaption>Caption</figcaption></figure></main>
            </body></html>"#;
        let result = sanitize_xhtml(
            source,
            "EPUB/text/chapter.xhtml",
            &resources(),
            CONTENT_POLICY_VERSION,
            SanitizationLimits::default(),
        )
        .unwrap();
        let output = output_text(&result);

        assert_eq!(result.status, SanitizationStatus::Exact);
        assert!(result.diagnostics.is_empty());
        for preserved in [
            "<main",
            "<h1",
            "<p",
            "lang=\"en\"",
            "dir=\"ltr\"",
            "<figure",
            "<figcaption",
        ] {
            assert!(
                output.contains(preserved),
                "safe structure was lost: {preserved}"
            );
        }
    }

    #[test]
    fn preserves_semantic_markup_while_removing_active_content_and_disabling_forms() {
        let source = r#"<!doctype html><html xmlns="http://www.w3.org/1999/xhtml"><head>
            <base href="https://attacker.invalid/"/><style>body{background:url(https://attacker.invalid/x)}</style>
            <script>globalThis.pwned = true</script></head><body onload="pwn()">
            <h1 id="title">Title</h1><ul><li>One</li></ul><table><tr><td>Cell</td></tr></table>
            <ruby>漢<rt>kan</rt></ruby><math><mi>x</mi></math>
            <img src="../images/cover.png" alt="Cover" onerror="pwn()"/>
            <iframe src="https://attacker.invalid/frame">frame fallback</iframe>
            <form action="https://attacker.invalid/post"><label>Name <input name="name"/></label><button>Send</button></form>
            </body></html>"#;

        let result = sanitize_xhtml(
            source.as_bytes(),
            "EPUB/text/chapter.xhtml",
            &resources(),
            CONTENT_POLICY_VERSION,
            SanitizationLimits::default(),
        )
        .unwrap();
        let output = output_text(&result);

        for preserved in [
            "<h1",
            "<ul",
            "<table",
            "<ruby",
            "<math",
            "../images/cover.png",
            "Name",
            "Send",
        ] {
            assert!(
                output.contains(preserved),
                "missing preserved markup: {preserved}"
            );
        }
        for removed in [
            "<script", "onload", "onerror", "<iframe", "<base", "<style", "<form", "action=",
        ] {
            assert!(
                !output.contains(removed),
                "active markup survived: {removed}"
            );
        }
        assert!(output.contains("disabled"));
        assert_eq!(result.status, SanitizationStatus::Degraded);
        assert!(diagnostic_count(&result, "publication.active_content_removed") >= 3);
        assert_eq!(
            diagnostic_count(&result, "publication.frame_content_removed"),
            1
        );
        assert_eq!(diagnostic_count(&result, "publication.form_disabled"), 1);
        assert_eq!(
            diagnostic_count(&result, "publication.stylesheet_degraded"),
            1
        );
    }

    #[test]
    fn classifies_navigation_and_automatic_resource_urls_by_context() {
        let source = br#"<html><body>
            <a id="local" href="../notes.xhtml#n1" target="_blank" download>Note</a>
            <a id="web" href="https://example.com/read">Web</a>
            <a id="mail" href="mailto:reader@example.com">Mail</a>
            <a id="bad" href="javascript:alert(1)">Bad</a>
            <img id="remote" src="https://attacker.invalid/track.png"/>
            <img id="data" src="data:image/svg+xml,&lt;svg onload=alert(1)&gt;"/>
            <link rel="stylesheet" href="../styles/book.css"/>
            <link rel="preconnect" href="https://attacker.invalid"/>
            </body></html>"#;
        let result = sanitize_xhtml(
            source,
            "EPUB/text/chapter.xhtml",
            &resources(),
            CONTENT_POLICY_VERSION,
            SanitizationLimits::default(),
        )
        .unwrap();
        let output = output_text(&result);

        assert!(output.contains("../notes.xhtml#n1"));
        assert!(output.contains("https://example.com/read"));
        assert!(output.contains("mailto:reader@example.com"));
        assert!(output.contains("../styles/book.css"));
        assert!(!output.contains("javascript:"));
        assert!(!output.contains("data:image"));
        assert!(!output.contains("track.png"));
        assert!(!output.contains("preconnect"));
        assert!(!output.contains("target="));
        assert!(!output.contains("download"));
        assert!(diagnostic_count(&result, "publication.unsafe_url_removed") >= 2);
        assert!(diagnostic_count(&result, "publication.remote_resource_blocked") >= 2);
    }

    #[test]
    fn sanitizes_inline_svg_with_the_same_active_content_boundary() {
        let source = br#"<html><body><svg viewBox="0 0 10 10" onload="pwn()">
            <script>pwn()</script><foreignObject><div>active foreign content</div></foreignObject>
            <animate attributeName="href" values="javascript:pwn()"/><set attributeName="onload" to="pwn()"/>
            <circle cx="5" cy="5" r="4"/><text>Safe label</text>
            <image href="https://attacker.invalid/image.png"/>
            </svg></body></html>"#;
        let result = sanitize_xhtml(
            source,
            "EPUB/text/chapter.xhtml",
            &resources(),
            CONTENT_POLICY_VERSION,
            SanitizationLimits::default(),
        )
        .unwrap();
        let output = output_text(&result);

        assert!(output.contains("<circle"));
        assert!(output.contains("Safe label"));
        for removed in [
            "<script",
            "foreignObject",
            "<animate",
            "<set",
            "onload",
            "attacker.invalid",
        ] {
            assert!(!output.contains(removed), "unsafe SVG survived: {removed}");
        }
        assert!(diagnostic_count(&result, "publication.svg_content_removed") >= 2);
    }

    #[test]
    fn neutralizes_the_registered_active_content_epub_fixture() {
        let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../tests/fixtures/epub/active-content-epub3.epub");
        let mut archive = zip::ZipArchive::new(std::fs::File::open(fixture).unwrap()).unwrap();
        let mut source = Vec::new();
        archive
            .by_name("EPUB/chapter.xhtml")
            .unwrap()
            .read_to_end(&mut source)
            .unwrap();
        let fixture_resources = PublicationResourceIndex::new([
            "EPUB/chapter.xhtml",
            "EPUB/nav.xhtml",
            "EPUB/package.opf",
            "EPUB/payload.js",
            "EPUB/style.css",
            "META-INF/container.xml",
            "mimetype",
        ])
        .unwrap();

        let result = sanitize_xhtml(
            &source,
            "EPUB/chapter.xhtml",
            &fixture_resources,
            CONTENT_POLICY_VERSION,
            SanitizationLimits::default(),
        )
        .unwrap();
        let output = output_text(&result);

        assert!(output.contains("Active content must remain inert"));
        for probe in [
            "<script",
            "onload=",
            "example.invalid/reader-epub-image",
            "<iframe",
            "<form",
            "javascript:",
        ] {
            assert!(!output.contains(probe), "fixture probe survived: {probe}");
        }
        assert_eq!(result.status, SanitizationStatus::Degraded);
    }

    #[test]
    fn recovers_malformed_markup_deterministically_but_refuses_invalid_boundaries() {
        let malformed = b"<html><body><h1>Title<p>Paragraph<script>pwn()</body>";
        let first = sanitize_xhtml(
            malformed,
            "EPUB/text/chapter.xhtml",
            &resources(),
            CONTENT_POLICY_VERSION,
            SanitizationLimits::default(),
        )
        .unwrap();
        let second = sanitize_xhtml(
            malformed,
            "EPUB/text/chapter.xhtml",
            &resources(),
            CONTENT_POLICY_VERSION,
            SanitizationLimits::default(),
        )
        .unwrap();
        assert_eq!(first, second);
        assert!(output_text(&first).contains("Paragraph"));
        assert!(!output_text(&first).contains("<script"));
        assert!(diagnostic_count(&first, "publication.markup_recovered") >= 1);

        assert_eq!(
            sanitize_xhtml(
                &[0xff, 0xfe],
                "EPUB/text/chapter.xhtml",
                &resources(),
                CONTENT_POLICY_VERSION,
                SanitizationLimits::default(),
            )
            .unwrap_err(),
            SanitizationError::InvalidEncoding
        );
        assert!(matches!(
            sanitize_xhtml(
                b"12345",
                "EPUB/text/chapter.xhtml",
                &resources(),
                CONTENT_POLICY_VERSION,
                SanitizationLimits {
                    max_input_bytes: 4,
                    max_nodes: 10
                },
            ),
            Err(SanitizationError::InputTooLarge { .. })
        ));
        assert!(matches!(
            sanitize_xhtml(
                b"<div><span>text</span></div>",
                "EPUB/text/chapter.xhtml",
                &resources(),
                CONTENT_POLICY_VERSION,
                SanitizationLimits {
                    max_input_bytes: 1024,
                    max_nodes: 3
                },
            ),
            Err(SanitizationError::TooManyNodes { .. })
        ));
        assert_eq!(
            sanitize_xhtml(
                b"<p>safe</p>",
                "EPUB/text/chapter.xhtml",
                &resources(),
                0,
                SanitizationLimits::default(),
            )
            .unwrap_err(),
            SanitizationError::UnsupportedPolicy(0)
        );
    }
}
