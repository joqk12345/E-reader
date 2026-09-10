use serde::{Deserialize, Serialize};

pub const LOCATOR_SCHEMA_VERSION: u32 = 1;
pub const LOCATOR_QUOTE_CONTEXT_CHARS: usize = 48;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublicationLocatorV1 {
    pub schema_version: u32,
    pub publication_id: String,
    pub source_hash: String,
    pub href: String,
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub media_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub locations: LocatorLocationsV1,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<LocatorTextV1>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocatorLocationsV1 {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cfi: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progression: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_progression: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub css_selector: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocatorTextV1 {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub before: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub highlight: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub after: Option<String>,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum LocatorValidationError {
    #[error("unsupported locator schema version: {0}")]
    UnsupportedSchema(u32),
    #[error("locator publication identity does not match")]
    PublicationMismatch,
    #[error("locator source hash does not match")]
    SourceHashMismatch,
    #[error("locator source hash is invalid")]
    InvalidSourceHash,
    #[error("locator href does not match")]
    HrefMismatch,
    #[error("locator href is invalid")]
    InvalidHref,
    #[error("locator has no usable anchor")]
    MissingAnchor,
    #[error("locator progression is outside [0, 1]")]
    InvalidProgression,
    #[error("locator position must be positive")]
    InvalidPosition,
    #[error("locator text quote context exceeds {LOCATOR_QUOTE_CONTEXT_CHARS} characters")]
    QuoteContextTooLong,
    #[error("locator text highlight is empty")]
    EmptyHighlight,
}

fn valid_progression(value: Option<f64>) -> bool {
    value.is_none_or(|value| value.is_finite() && (0.0..=1.0).contains(&value))
}

pub fn validate_locator_v1(
    locator: &PublicationLocatorV1,
    expected_publication_id: &str,
    expected_source_hash: &str,
    expected_href: &str,
) -> Result<(), LocatorValidationError> {
    if locator.schema_version != LOCATOR_SCHEMA_VERSION {
        return Err(LocatorValidationError::UnsupportedSchema(
            locator.schema_version,
        ));
    }
    if locator.publication_id != expected_publication_id {
        return Err(LocatorValidationError::PublicationMismatch);
    }
    if locator.source_hash != expected_source_hash {
        return Err(LocatorValidationError::SourceHashMismatch);
    }
    if locator.source_hash.len() != 64
        || !locator
            .source_hash
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(LocatorValidationError::InvalidSourceHash);
    }
    if locator.href != expected_href {
        return Err(LocatorValidationError::HrefMismatch);
    }
    let lower_href = locator.href.to_ascii_lowercase();
    if locator.href.is_empty()
        || locator.href.starts_with('/')
        || locator.href.contains('\\')
        || locator.href.chars().any(char::is_control)
        || locator
            .href
            .split(['/', '#'])
            .any(|segment| segment == "." || segment == "..")
        || lower_href.contains("%2f")
        || lower_href.contains("%5c")
        || url::Url::parse(&locator.href).is_ok()
    {
        return Err(LocatorValidationError::InvalidHref);
    }
    if !valid_progression(locator.locations.progression)
        || !valid_progression(locator.locations.total_progression)
    {
        return Err(LocatorValidationError::InvalidProgression);
    }
    if locator.locations.position == Some(0) {
        return Err(LocatorValidationError::InvalidPosition);
    }
    if let Some(text) = &locator.text {
        if text
            .before
            .as_deref()
            .is_some_and(|value| value.chars().count() > LOCATOR_QUOTE_CONTEXT_CHARS)
            || text
                .after
                .as_deref()
                .is_some_and(|value| value.chars().count() > LOCATOR_QUOTE_CONTEXT_CHARS)
        {
            return Err(LocatorValidationError::QuoteContextTooLong);
        }
        if text
            .highlight
            .as_deref()
            .is_some_and(|value| value.trim().is_empty())
        {
            return Err(LocatorValidationError::EmptyHighlight);
        }
    }
    let has_anchor = locator
        .locations
        .cfi
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
        || locator.locations.progression.is_some()
        || locator.locations.position.is_some()
        || locator
            .locations
            .css_selector
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
        || locator
            .text
            .as_ref()
            .and_then(|text| text.highlight.as_deref())
            .is_some_and(|value| !value.trim().is_empty());
    if !has_anchor {
        return Err(LocatorValidationError::MissingAnchor);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn locator() -> PublicationLocatorV1 {
        PublicationLocatorV1 {
            schema_version: 1,
            publication_id: "publication-1".into(),
            source_hash: "a".repeat(64),
            href: "EPUB/chapter.xhtml".into(),
            media_type: Some("application/xhtml+xml".into()),
            title: None,
            locations: LocatorLocationsV1 {
                css_selector: Some("body > p:nth-of-type(1)".into()),
                ..LocatorLocationsV1::default()
            },
            text: Some(LocatorTextV1 {
                before: Some("Before".into()),
                highlight: Some("Exact text".into()),
                after: Some("After".into()),
            }),
        }
    }

    #[test]
    fn round_trips_the_versioned_camel_case_contract_and_validates_identity() {
        let locator = locator();
        validate_locator_v1(
            &locator,
            "publication-1",
            &"a".repeat(64),
            "EPUB/chapter.xhtml",
        )
        .unwrap();
        let json = serde_json::to_value(&locator).unwrap();
        assert_eq!(json["schemaVersion"], 1);
        assert_eq!(json["locations"]["cssSelector"], "body > p:nth-of-type(1)");
        assert_eq!(json["text"]["highlight"], "Exact text");
        assert!(json["locations"].get("cfi").is_none());
        assert_eq!(
            serde_json::from_value::<PublicationLocatorV1>(json).unwrap(),
            locator
        );
    }

    #[test]
    fn rejects_cross_publication_source_and_href_application() {
        let locator = locator();
        assert_eq!(
            validate_locator_v1(&locator, "other", &"a".repeat(64), &locator.href),
            Err(LocatorValidationError::PublicationMismatch)
        );
        assert_eq!(
            validate_locator_v1(
                &locator,
                &locator.publication_id,
                &"b".repeat(64),
                &locator.href
            ),
            Err(LocatorValidationError::SourceHashMismatch)
        );
        assert_eq!(
            validate_locator_v1(
                &locator,
                &locator.publication_id,
                &locator.source_hash,
                "EPUB/other.xhtml",
            ),
            Err(LocatorValidationError::HrefMismatch)
        );
    }

    #[test]
    fn rejects_missing_or_malformed_anchors_and_quote_bounds() {
        let mut invalid = locator();
        invalid.schema_version = 0;
        assert_eq!(
            validate_locator_v1(
                &invalid,
                &invalid.publication_id,
                &invalid.source_hash,
                &invalid.href,
            ),
            Err(LocatorValidationError::UnsupportedSchema(0))
        );

        let mut invalid = locator();
        invalid.source_hash = "A".repeat(64);
        assert_eq!(
            validate_locator_v1(
                &invalid,
                &invalid.publication_id,
                &invalid.source_hash,
                &invalid.href,
            ),
            Err(LocatorValidationError::InvalidSourceHash)
        );
        let mut invalid = locator();
        invalid.href = "https://example.com/book.xhtml".into();
        assert_eq!(
            validate_locator_v1(
                &invalid,
                &invalid.publication_id,
                &invalid.source_hash,
                &invalid.href,
            ),
            Err(LocatorValidationError::InvalidHref)
        );

        let mut invalid = locator();
        invalid.locations = LocatorLocationsV1::default();
        invalid.text = None;
        assert_eq!(
            validate_locator_v1(
                &invalid,
                &invalid.publication_id,
                &invalid.source_hash,
                &invalid.href,
            ),
            Err(LocatorValidationError::MissingAnchor)
        );

        for progression in [-0.01, 1.01, f64::NAN, f64::INFINITY] {
            let mut invalid = locator();
            invalid.locations.progression = Some(progression);
            assert_eq!(
                validate_locator_v1(
                    &invalid,
                    &invalid.publication_id,
                    &invalid.source_hash,
                    &invalid.href,
                ),
                Err(LocatorValidationError::InvalidProgression)
            );
        }
        let mut invalid = locator();
        invalid.locations.position = Some(0);
        assert_eq!(
            validate_locator_v1(
                &invalid,
                &invalid.publication_id,
                &invalid.source_hash,
                &invalid.href,
            ),
            Err(LocatorValidationError::InvalidPosition)
        );

        let mut invalid = locator();
        invalid.text.as_mut().unwrap().before = Some("前".repeat(49));
        assert_eq!(
            validate_locator_v1(
                &invalid,
                &invalid.publication_id,
                &invalid.source_hash,
                &invalid.href,
            ),
            Err(LocatorValidationError::QuoteContextTooLong)
        );
        let mut invalid = locator();
        invalid.text.as_mut().unwrap().highlight = Some("  ".into());
        assert_eq!(
            validate_locator_v1(
                &invalid,
                &invalid.publication_id,
                &invalid.source_hash,
                &invalid.href,
            ),
            Err(LocatorValidationError::EmptyHighlight)
        );
    }

    #[test]
    fn rejects_unknown_json_fields_instead_of_silently_weakening_the_contract() {
        let mut json = serde_json::to_value(locator()).unwrap();
        json.as_object_mut()
            .unwrap()
            .insert("unknown".into(), serde_json::json!(true));
        assert!(serde_json::from_value::<PublicationLocatorV1>(json).is_err());
    }
}
