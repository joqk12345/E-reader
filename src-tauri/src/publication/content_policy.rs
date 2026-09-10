#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RenderResourceKind {
    Raw,
    Xhtml,
    Css,
    Svg,
    Script,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub(crate) enum ResourceClassificationError {
    #[error("active resource is missing manifest media classification: {0}")]
    UnclassifiedActive(String),
}

pub(crate) fn classify_render_resource(
    path: &str,
    media_type: Option<&str>,
) -> Result<RenderResourceKind, ResourceClassificationError> {
    let extension = path
        .rsplit_once('.')
        .map(|(_, extension)| extension.to_ascii_lowercase());
    let media_type = media_type.map(|value| {
        value
            .split(';')
            .next()
            .unwrap_or(value)
            .trim()
            .to_ascii_lowercase()
    });
    let active_extension = matches!(
        extension.as_deref(),
        Some("xhtml" | "html" | "htm" | "css" | "svg" | "js" | "mjs")
    );
    if active_extension && media_type.is_none() {
        return Err(ResourceClassificationError::UnclassifiedActive(path.into()));
    }
    if matches!(extension.as_deref(), Some("js" | "mjs"))
        || media_type.as_deref().is_some_and(|media_type| {
            media_type.contains("javascript")
                || media_type.contains("ecmascript")
                || media_type == "application/wasm"
        })
    {
        return Ok(RenderResourceKind::Script);
    }
    if matches!(extension.as_deref(), Some("xhtml" | "html" | "htm"))
        || matches!(
            media_type.as_deref(),
            Some("application/xhtml+xml" | "text/html")
        )
    {
        return Ok(RenderResourceKind::Xhtml);
    }
    if extension.as_deref() == Some("css") || media_type.as_deref() == Some("text/css") {
        return Ok(RenderResourceKind::Css);
    }
    if extension.as_deref() == Some("svg") || media_type.as_deref() == Some("image/svg+xml") {
        return Ok(RenderResourceKind::Svg);
    }
    Ok(RenderResourceKind::Raw)
}
