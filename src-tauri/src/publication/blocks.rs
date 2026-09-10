use super::locator::{
    validate_locator_v1, LocatorLocationsV1, LocatorTextV1, LocatorValidationError,
    PublicationLocatorV1, LOCATOR_SCHEMA_VERSION,
};
use kuchikiki::traits::TendrilSink;
use kuchikiki::NodeRef;

pub(crate) const QUOTE_CONTEXT_CHARS: usize = 48;

#[derive(Debug, Clone, Copy)]
pub(crate) struct BlockExtractionLimits {
    pub max_blocks: usize,
}

impl Default for BlockExtractionLimits {
    fn default() -> Self {
        Self { max_blocks: 50_000 }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct SemanticContentBlock {
    pub block_index: u32,
    pub kind: String,
    pub plain_text: String,
    pub language: Option<String>,
    pub direction: Option<String>,
    pub css_selector: String,
    pub text_quote_prefix: Option<String>,
    pub text_quote_exact: String,
    pub text_quote_suffix: Option<String>,
    pub locator: PublicationLocatorV1,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub(crate) enum BlockExtractionError {
    #[error("sanitized XHTML is not UTF-8")]
    InvalidEncoding,
    #[error("semantic block identity is invalid")]
    InvalidIdentity,
    #[error("semantic block count exceeds limit: {actual} > {limit}")]
    TooManyBlocks { actual: usize, limit: usize },
    #[error(transparent)]
    Locator(#[from] LocatorValidationError),
}

fn normalize_text(value: &str) -> String {
    let mut output = String::new();
    let mut pending_space = false;
    for character in value.chars() {
        if character.is_whitespace() {
            pending_space = !output.is_empty();
        } else {
            if pending_space {
                output.push(' ');
            }
            output.push(character);
            pending_space = false;
        }
    }
    output
}

fn block_kind(tag: &str) -> Option<&'static str> {
    match tag {
        "h1" => Some("heading-1"),
        "h2" => Some("heading-2"),
        "h3" => Some("heading-3"),
        "h4" => Some("heading-4"),
        "h5" => Some("heading-5"),
        "h6" => Some("heading-6"),
        "p" => Some("paragraph"),
        "li" => Some("list-item"),
        "blockquote" => Some("blockquote"),
        "pre" => Some("preformatted"),
        "figcaption" => Some("figure-caption"),
        "caption" => Some("table-caption"),
        "dt" => Some("term"),
        "dd" => Some("definition"),
        "tr" => Some("table-row"),
        _ => None,
    }
}

fn element_tag(node: &NodeRef) -> Option<String> {
    node.as_element()
        .map(|element| element.name.local.to_string().to_ascii_lowercase())
}

fn has_block_descendant(node: &NodeRef) -> bool {
    node.descendants()
        .skip(1)
        .filter_map(|descendant| element_tag(&descendant))
        .any(|tag| block_kind(&tag).is_some())
}

fn blocked_by_candidate_ancestor(node: &NodeRef, tag: &str) -> bool {
    node.ancestors()
        .filter_map(|ancestor| element_tag(&ancestor))
        .any(|ancestor| block_kind(&ancestor).is_some() && !(tag == "li" && ancestor == "li"))
}

fn collect_text(node: &NodeRef, root_tag: &str, output: &mut String) {
    for child in node.children() {
        if let Some(text) = child.as_text() {
            output.push_str(&text.borrow());
            output.push(' ');
            continue;
        }
        if root_tag == "li" && element_tag(&child).as_deref() == Some("li") {
            continue;
        }
        collect_text(&child, root_tag, output);
    }
}

fn has_semantic_token(node: &NodeRef, token: &str) -> bool {
    node.inclusive_ancestors().any(|ancestor| {
        ancestor.as_element().is_some_and(|element| {
            element
                .attributes
                .borrow()
                .map
                .iter()
                .any(|(key, attribute)| {
                    (key.local.as_ref().eq_ignore_ascii_case("type")
                        || key.local.as_ref().to_ascii_lowercase().ends_with(":type"))
                        && attribute
                            .value
                            .split_ascii_whitespace()
                            .any(|value| value.eq_ignore_ascii_case(token))
                })
        })
    })
}

fn inherited_attribute(node: &NodeRef, name: &str) -> Option<String> {
    node.inclusive_ancestors().find_map(|ancestor| {
        let element = ancestor.as_element()?;
        element
            .attributes
            .borrow()
            .map
            .iter()
            .find(|(key, _)| {
                key.local.as_ref().eq_ignore_ascii_case(name)
                    || (name == "lang"
                        && key.local.as_ref().to_ascii_lowercase().ends_with(":lang"))
            })
            .map(|(_, attribute)| attribute.value.trim().to_string())
            .filter(|value| !value.is_empty())
    })
}

fn css_string(value: &str) -> String {
    let mut output = String::new();
    for character in value.chars() {
        match character {
            '\\' => output.push_str("\\\\"),
            '"' => output.push_str("\\\""),
            character if character.is_control() => {
                output.push('\\');
                output.push_str(&format!("{:x} ", character as u32));
            }
            character => output.push(character),
        }
    }
    output
}

fn nth_of_type(node: &NodeRef, tag: &str) -> usize {
    node.preceding_siblings()
        .filter(|sibling| element_tag(sibling).as_deref() == Some(tag))
        .count()
        + 1
}

fn css_selector(node: &NodeRef) -> String {
    if let Some(id) = node.as_element().and_then(|element| {
        element
            .attributes
            .borrow()
            .get("id")
            .map(str::to_string)
            .filter(|id| !id.is_empty())
    }) {
        return format!("[id=\"{}\"]", css_string(&id));
    }
    let mut segments = Vec::new();
    for current in node.inclusive_ancestors() {
        let Some(tag) = element_tag(&current) else {
            continue;
        };
        if tag == "html" {
            break;
        }
        if tag == "body" {
            segments.push("body".to_string());
            break;
        }
        segments.push(format!(
            "{tag}:nth-of-type({})",
            nth_of_type(&current, &tag)
        ));
    }
    segments.reverse();
    segments.join(" > ")
}

fn context_prefix(value: &str) -> Option<String> {
    let characters = value.chars().collect::<Vec<_>>();
    let start = characters.len().saturating_sub(QUOTE_CONTEXT_CHARS);
    let context = characters[start..].iter().collect::<String>();
    (!context.is_empty()).then_some(context)
}

fn context_suffix(value: &str) -> Option<String> {
    let context = value.chars().take(QUOTE_CONTEXT_CHARS).collect::<String>();
    (!context.is_empty()).then_some(context)
}

fn valid_identity(publication_id: &str, source_hash: &str, href: &str) -> bool {
    !publication_id.is_empty()
        && !href.is_empty()
        && source_hash.len() == 64
        && source_hash
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

pub(crate) fn extract_semantic_blocks(
    bytes: &[u8],
    publication_id: &str,
    source_hash: &str,
    href: &str,
    limits: BlockExtractionLimits,
) -> Result<Vec<SemanticContentBlock>, BlockExtractionError> {
    if !valid_identity(publication_id, source_hash, href) {
        return Err(BlockExtractionError::InvalidIdentity);
    }
    let source = std::str::from_utf8(bytes).map_err(|_| BlockExtractionError::InvalidEncoding)?;
    let document = kuchikiki::parse_html().one(source).document_node;
    let mut raw_blocks = Vec::<(String, String, Option<String>, Option<String>, String)>::new();

    for node in document.descendants() {
        let Some(tag) = element_tag(&node) else {
            continue;
        };
        let kind = if let Some(kind) = block_kind(&tag) {
            if blocked_by_candidate_ancestor(&node, &tag) {
                continue;
            }
            if kind == "paragraph" && has_semantic_token(&node, "footnote") {
                "footnote"
            } else {
                kind
            }
        } else if matches!(tag.as_str(), "div" | "section" | "article")
            && !has_block_descendant(&node)
        {
            "paragraph"
        } else {
            continue;
        };
        let mut unnormalized = String::new();
        collect_text(&node, &tag, &mut unnormalized);
        let plain_text = normalize_text(&unnormalized);
        if plain_text.is_empty() {
            continue;
        }
        if raw_blocks.len() >= limits.max_blocks {
            return Err(BlockExtractionError::TooManyBlocks {
                actual: raw_blocks.len() + 1,
                limit: limits.max_blocks,
            });
        }
        let language = inherited_attribute(&node, "lang");
        let direction = inherited_attribute(&node, "dir")
            .map(|value| value.to_ascii_lowercase())
            .filter(|value| matches!(value.as_str(), "ltr" | "rtl" | "auto"));
        raw_blocks.push((
            kind.into(),
            plain_text,
            language,
            direction,
            css_selector(&node),
        ));
    }

    let mut blocks = Vec::with_capacity(raw_blocks.len());
    for (index, (kind, plain_text, language, direction, selector)) in raw_blocks.iter().enumerate()
    {
        let before = index
            .checked_sub(1)
            .and_then(|previous| context_prefix(&raw_blocks[previous].1));
        let after = raw_blocks
            .get(index + 1)
            .and_then(|next| context_suffix(&next.1));
        let locator = PublicationLocatorV1 {
            schema_version: LOCATOR_SCHEMA_VERSION,
            publication_id: publication_id.into(),
            source_hash: source_hash.into(),
            href: href.into(),
            media_type: Some("application/xhtml+xml".into()),
            title: None,
            locations: LocatorLocationsV1 {
                css_selector: Some(selector.clone()),
                ..LocatorLocationsV1::default()
            },
            text: Some(LocatorTextV1 {
                before: before.clone(),
                highlight: Some(plain_text.clone()),
                after: after.clone(),
            }),
        };
        validate_locator_v1(&locator, publication_id, source_hash, href)?;
        blocks.push(SemanticContentBlock {
            block_index: index as u32,
            kind: kind.clone(),
            plain_text: plain_text.clone(),
            language: language.clone(),
            direction: direction.clone(),
            css_selector: selector.clone(),
            text_quote_prefix: before,
            text_quote_exact: plain_text.clone(),
            text_quote_suffix: after,
            locator,
        });
    }
    Ok(blocks)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn extract(source: &str) -> Vec<SemanticContentBlock> {
        extract_semantic_blocks(
            source.as_bytes(),
            "publication-1",
            &"a".repeat(64),
            "EPUB/chapter.xhtml",
            BlockExtractionLimits::default(),
        )
        .unwrap()
    }

    #[test]
    fn extracts_structured_blocks_in_document_order_with_versioned_locators() {
        let blocks = extract(
            r#"<!doctype html><html lang="en"><body dir="rtl">
              <h1 id="chapter-title">Chapter title</h1>
              <p>First <em>structured</em> paragraph.</p>
              <ul><li>List one</li><li lang="ar">قائمة</li></ul>
              <blockquote><p>Quoted text</p></blockquote>
              <pre><code>let x = 1;</code></pre>
              <figure><img src="cover.png"><figcaption>Figure caption</figcaption></figure>
              <dl><dt>Term</dt><dd>Definition</dd></dl>
              <table><caption>Values</caption><tr><th>Name</th><th>Value</th></tr><tr><td>A</td><td>1</td></tr></table>
              <aside epub:type="footnote"><p>Footnote text</p></aside>
            </body></html>"#,
        );

        assert_eq!(
            blocks
                .iter()
                .map(|block| (block.kind.as_str(), block.plain_text.as_str()))
                .collect::<Vec<_>>(),
            vec![
                ("heading-1", "Chapter title"),
                ("paragraph", "First structured paragraph."),
                ("list-item", "List one"),
                ("list-item", "قائمة"),
                ("blockquote", "Quoted text"),
                ("preformatted", "let x = 1;"),
                ("figure-caption", "Figure caption"),
                ("term", "Term"),
                ("definition", "Definition"),
                ("table-caption", "Values"),
                ("table-row", "Name Value"),
                ("table-row", "A 1"),
                ("footnote", "Footnote text"),
            ]
        );
        assert_eq!(blocks[0].css_selector, "[id=\"chapter-title\"]");
        assert!(blocks[1].css_selector.starts_with("body > p:nth-of-type("));
        assert_eq!(blocks[0].language.as_deref(), Some("en"));
        assert_eq!(blocks[0].direction.as_deref(), Some("rtl"));
        assert_eq!(blocks[3].language.as_deref(), Some("ar"));

        let locator = &blocks[1].locator;
        assert_eq!(locator.schema_version, 1);
        assert_eq!(locator.publication_id, "publication-1");
        assert_eq!(locator.source_hash, "a".repeat(64));
        assert_eq!(locator.href, "EPUB/chapter.xhtml");
        assert_eq!(locator.media_type.as_deref(), Some("application/xhtml+xml"));
        assert_eq!(
            locator.locations.css_selector.as_deref(),
            Some(blocks[1].css_selector.as_str())
        );
        assert_eq!(
            locator
                .text
                .as_ref()
                .and_then(|text| text.highlight.as_deref()),
            Some(blocks[1].plain_text.as_str())
        );
        assert_eq!(locator.locations.cfi, None);
    }

    #[test]
    fn repeated_text_uses_distinct_selectors_and_bounded_neighbor_context() {
        let long_prefix = "前".repeat(80);
        let long_suffix = "后".repeat(80);
        let source = format!(
            "<!doctype html><html><body><p>{long_prefix}</p><p>Repeated text</p><p>Repeated text</p><p>{long_suffix}</p></body></html>"
        );
        let blocks = extract(&source);

        assert_ne!(blocks[1].css_selector, blocks[2].css_selector);
        assert_eq!(blocks[1].plain_text, blocks[2].plain_text);
        assert_ne!(blocks[1].text_quote_prefix, blocks[2].text_quote_prefix);
        assert_ne!(blocks[1].text_quote_suffix, blocks[2].text_quote_suffix);
        for block in &blocks {
            assert!(
                block
                    .text_quote_prefix
                    .as_deref()
                    .map_or(0, |value| value.chars().count())
                    <= QUOTE_CONTEXT_CHARS
            );
            assert!(
                block
                    .text_quote_suffix
                    .as_deref()
                    .map_or(0, |value| value.chars().count())
                    <= QUOTE_CONTEXT_CHARS
            );
        }
    }

    #[test]
    fn skips_empty_containers_and_refuses_invalid_identity_encoding_and_limits() {
        assert!(extract(
            "<!doctype html><html><body><p>  </p><div><span> </span></div></body></html>"
        )
        .is_empty());
        assert_eq!(
            extract_semantic_blocks(
                &[0xff],
                "publication-1",
                &"a".repeat(64),
                "EPUB/chapter.xhtml",
                BlockExtractionLimits::default(),
            )
            .unwrap_err(),
            BlockExtractionError::InvalidEncoding
        );
        assert_eq!(
            extract_semantic_blocks(
                b"<p>text</p>",
                "",
                "bad-hash",
                "",
                BlockExtractionLimits::default(),
            )
            .unwrap_err(),
            BlockExtractionError::InvalidIdentity
        );
        assert!(matches!(
            extract_semantic_blocks(
                b"<p>one</p><p>two</p>",
                "publication-1",
                &"a".repeat(64),
                "EPUB/chapter.xhtml",
                BlockExtractionLimits { max_blocks: 1 },
            ),
            Err(BlockExtractionError::TooManyBlocks { .. })
        ));
    }
}
