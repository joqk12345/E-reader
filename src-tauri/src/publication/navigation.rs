use super::archive::ArchiveLimits;
use super::package::PreparedPackage;
use super::resources::{PublicationResourceIndex, ResourceResolveError};
use super::store::{PublicationStoreError, ZipPublicationStore};
use std::io::Cursor;
use std::path::Path;
use xml::attribute::OwnedAttribute;
use xml::reader::{EventReader, XmlEvent};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PreparedNavigationNode {
    pub parent_index: Option<usize>,
    pub depth: u32,
    pub order_index: u32,
    pub label: String,
    pub href: Option<String>,
    pub fragment: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub(crate) enum NavigationPrepareError {
    #[error("publication has no EPUB navigation resource")]
    MissingNavigation,
    #[error("publication navigation is invalid: {0}")]
    InvalidNavigation(String),
    #[error("publication navigation resource is invalid: {0}")]
    Resource(#[from] ResourceResolveError),
    #[error("publication navigation could not be loaded: {0}")]
    Store(#[from] PublicationStoreError),
}

fn invalid(message: impl Into<String>) -> NavigationPrepareError {
    NavigationPrepareError::InvalidNavigation(message.into())
}

fn attribute(attributes: &[OwnedAttribute], name: &str) -> Option<String> {
    attributes
        .iter()
        .find(|attribute| attribute.name.local_name == name)
        .map(|attribute| attribute.value.clone())
}

fn normalized_label(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn sibling_order(nodes: &[PreparedNavigationNode], parent_index: Option<usize>) -> u32 {
    nodes
        .iter()
        .filter(|node| node.parent_index == parent_index)
        .count() as u32
}

#[derive(Debug)]
struct PendingListItem {
    parent_index: Option<usize>,
    depth: u32,
    node_index: Option<usize>,
}

#[derive(Debug)]
struct LabelCapture {
    element: String,
    href: Option<String>,
    text: String,
}

fn parse_epub3_navigation(
    bytes: &[u8],
    base_href: &str,
    resources: &PublicationResourceIndex,
) -> Result<Vec<PreparedNavigationNode>, NavigationPrepareError> {
    let mut nodes = Vec::new();
    let mut list_items: Vec<PendingListItem> = Vec::new();
    let mut capture: Option<LabelCapture> = None;
    let mut in_toc = false;

    for event in EventReader::new(Cursor::new(bytes)) {
        match event.map_err(|error| invalid(format!("nav.xhtml: {error}")))? {
            XmlEvent::StartElement {
                name, attributes, ..
            } => {
                if name.local_name == "nav"
                    && attribute(&attributes, "type")
                        .is_some_and(|value| value.split_whitespace().any(|token| token == "toc"))
                {
                    in_toc = true;
                } else if in_toc && name.local_name == "li" {
                    let parent_index = list_items.iter().rev().find_map(|item| item.node_index);
                    list_items.push(PendingListItem {
                        parent_index,
                        depth: list_items.len() as u32,
                        node_index: None,
                    });
                } else if in_toc
                    && capture.is_none()
                    && matches!(name.local_name.as_str(), "a" | "span")
                    && list_items
                        .last()
                        .is_some_and(|item| item.node_index.is_none())
                {
                    capture = Some(LabelCapture {
                        element: name.local_name,
                        href: attribute(&attributes, "href"),
                        text: String::new(),
                    });
                }
            }
            XmlEvent::Characters(value) | XmlEvent::CData(value) if capture.is_some() => {
                capture
                    .as_mut()
                    .expect("capture checked")
                    .text
                    .push_str(&value);
            }
            XmlEvent::EndElement { name } => {
                if capture
                    .as_ref()
                    .is_some_and(|active| active.element == name.local_name)
                {
                    let completed = capture.take().expect("capture checked");
                    let label = normalized_label(&completed.text);
                    if label.is_empty() {
                        return Err(invalid("EPUB 3 navigation item has an empty label"));
                    }
                    let pending = list_items
                        .last_mut()
                        .ok_or_else(|| invalid("navigation label is outside a list item"))?;
                    let (href, fragment) = if let Some(reference) = completed.href {
                        let resolved = resources.resolve(base_href, &reference)?;
                        (Some(resolved.path), resolved.fragment)
                    } else {
                        (None, None)
                    };
                    let node_index = nodes.len();
                    let order_index = sibling_order(&nodes, pending.parent_index);
                    nodes.push(PreparedNavigationNode {
                        parent_index: pending.parent_index,
                        depth: pending.depth,
                        order_index,
                        label,
                        href,
                        fragment,
                    });
                    pending.node_index = Some(node_index);
                }
                if in_toc && name.local_name == "li" {
                    let item = list_items
                        .pop()
                        .ok_or_else(|| invalid("unbalanced EPUB 3 navigation list"))?;
                    if item.node_index.is_none() {
                        return Err(invalid("EPUB 3 navigation list item has no label"));
                    }
                } else if name.local_name == "nav" && in_toc {
                    in_toc = false;
                }
            }
            _ => {}
        }
    }
    if nodes.is_empty() {
        return Err(invalid("EPUB 3 table of contents is empty"));
    }
    Ok(nodes)
}

fn parse_epub2_ncx(
    bytes: &[u8],
    base_href: &str,
    resources: &PublicationResourceIndex,
) -> Result<Vec<PreparedNavigationNode>, NavigationPrepareError> {
    let mut nodes: Vec<PreparedNavigationNode> = Vec::new();
    let mut stack: Vec<usize> = Vec::new();
    let mut in_nav_map = false;
    let mut in_nav_label = false;
    let mut label_text: Option<String> = None;

    for event in EventReader::new(Cursor::new(bytes)) {
        match event.map_err(|error| invalid(format!("toc.ncx: {error}")))? {
            XmlEvent::StartElement {
                name, attributes, ..
            } => match name.local_name.as_str() {
                "navMap" => in_nav_map = true,
                "navPoint" if in_nav_map => {
                    let parent_index = stack.last().copied();
                    let index = nodes.len();
                    nodes.push(PreparedNavigationNode {
                        parent_index,
                        depth: stack.len() as u32,
                        order_index: sibling_order(&nodes, parent_index),
                        label: String::new(),
                        href: None,
                        fragment: None,
                    });
                    stack.push(index);
                }
                "navLabel" if !stack.is_empty() => in_nav_label = true,
                "text" if in_nav_label => label_text = Some(String::new()),
                "content" if !stack.is_empty() => {
                    let reference = attribute(&attributes, "src")
                        .ok_or_else(|| invalid("NCX content is missing src"))?;
                    let resolved = resources.resolve(base_href, &reference)?;
                    let node = &mut nodes[*stack.last().expect("stack checked")];
                    node.href = Some(resolved.path);
                    node.fragment = resolved.fragment;
                }
                _ => {}
            },
            XmlEvent::Characters(value) | XmlEvent::CData(value) if label_text.is_some() => {
                label_text.as_mut().expect("label checked").push_str(&value);
            }
            XmlEvent::EndElement { name } => match name.local_name.as_str() {
                "text" if label_text.is_some() => {
                    let label = normalized_label(&label_text.take().expect("label checked"));
                    nodes[*stack
                        .last()
                        .ok_or_else(|| invalid("NCX label has no navPoint"))?]
                    .label = label;
                }
                "navLabel" => in_nav_label = false,
                "navPoint" if in_nav_map => {
                    let index = stack
                        .pop()
                        .ok_or_else(|| invalid("unbalanced NCX navPoint"))?;
                    if nodes[index].label.is_empty() || nodes[index].href.is_none() {
                        return Err(invalid("NCX navPoint requires label and content"));
                    }
                }
                "navMap" => in_nav_map = false,
                _ => {}
            },
            _ => {}
        }
    }
    if nodes.is_empty() {
        return Err(invalid("EPUB 2 NCX table of contents is empty"));
    }
    Ok(nodes)
}

pub(crate) fn prepare_navigation(
    archive_path: &Path,
    package: &PreparedPackage,
    limits: ArchiveLimits,
) -> Result<Vec<PreparedNavigationNode>, NavigationPrepareError> {
    let resources = PublicationResourceIndex::new(
        package
            .resources
            .iter()
            .map(|resource| resource.href.clone()),
    )?;
    let mut store = ZipPublicationStore::open(archive_path, limits)?;

    if let Some(nav) = package
        .resources
        .iter()
        .find(|resource| resource.properties.iter().any(|property| property == "nav"))
    {
        let text = store.load_text(&nav.href, "")?;
        return parse_epub3_navigation(text.as_bytes(), &nav.href, &resources);
    }
    if let Some(toc_id) = package.toc_manifest_id.as_deref() {
        let ncx = package
            .resources
            .iter()
            .find(|resource| resource.manifest_id == toc_id)
            .ok_or_else(|| {
                invalid(format!(
                    "spine toc references unknown manifest id: {toc_id}"
                ))
            })?;
        let text = store.load_text(&ncx.href, "")?;
        return parse_epub2_ncx(text.as_bytes(), &ncx.href, &resources);
    }
    Err(NavigationPrepareError::MissingNavigation)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::publication::package::prepare_package;
    use crate::publication::resources::PublicationResourceIndex;
    use std::path::PathBuf;

    fn fixture(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../tests/fixtures/epub")
            .join(name)
    }

    #[test]
    fn preserves_nested_epub3_author_navigation_and_fragments() {
        let path = fixture("minimal-epub3.epub");
        let package = prepare_package(&path, ArchiveLimits::default()).unwrap();
        let nodes = prepare_navigation(&path, &package, ArchiveLimits::default()).unwrap();

        assert_eq!(
            nodes,
            vec![
                PreparedNavigationNode {
                    parent_index: None,
                    depth: 0,
                    order_index: 0,
                    label: "Chapter One".into(),
                    href: Some("EPUB/chapter.xhtml".into()),
                    fragment: None,
                },
                PreparedNavigationNode {
                    parent_index: Some(0),
                    depth: 1,
                    order_index: 0,
                    label: "Details".into(),
                    href: Some("EPUB/chapter.xhtml".into()),
                    fragment: Some("details".into()),
                },
            ]
        );
    }

    #[test]
    fn keeps_a_short_epub2_ncx_as_the_author_toc_instead_of_replacing_it_with_spine() {
        let path = fixture("short-toc-epub2.epub");
        let package = prepare_package(&path, ArchiveLimits::default()).unwrap();
        let nodes = prepare_navigation(&path, &package, ArchiveLimits::default()).unwrap();

        assert_eq!(nodes.len(), 2);
        assert_eq!(nodes[0].label, "Opening");
        assert_eq!(nodes[0].href.as_deref(), Some("OEBPS/one.xhtml"));
        assert_eq!(nodes[0].parent_index, None);
        assert_eq!(nodes[1].label, "Closing");
        assert_eq!(nodes[1].href.as_deref(), Some("OEBPS/two.xhtml"));
        assert_eq!(nodes[1].order_index, 1);
    }

    #[test]
    fn rejects_external_or_unknown_navigation_targets() {
        let index =
            PublicationResourceIndex::new(["EPUB/nav.xhtml", "EPUB/chapter.xhtml"]).unwrap();
        let external = r#"<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="https://example.invalid/track">Remote</a></li></ol></nav></body></html>"#;
        let unknown = r#"<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="missing.xhtml">Missing</a></li></ol></nav></body></html>"#;

        assert!(matches!(
            parse_epub3_navigation(external.as_bytes(), "EPUB/nav.xhtml", &index),
            Err(NavigationPrepareError::Resource(_))
        ));
        assert!(matches!(
            parse_epub3_navigation(unknown.as_bytes(), "EPUB/nav.xhtml", &index),
            Err(NavigationPrepareError::Resource(_))
        ));
    }
}
