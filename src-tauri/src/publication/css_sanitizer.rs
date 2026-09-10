use super::resources::PublicationResourceIndex;
use super::sanitizer::{
    SanitizationDiagnostic, SanitizationStatus, SanitizedContent, CONTENT_POLICY_VERSION,
};
use cssparser::{serialize_string, Parser, ParserInput, ToCss, Token};
use std::collections::BTreeMap;
use url::Url;

#[derive(Debug, Clone, Copy)]
pub struct CssSanitizationLimits {
    pub max_input_bytes: usize,
    pub max_tokens: usize,
    pub max_nesting_depth: usize,
}

impl Default for CssSanitizationLimits {
    fn default() -> Self {
        Self {
            max_input_bytes: 1024 * 1024,
            max_tokens: 100_000,
            max_nesting_depth: 32,
        }
    }
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum CssSanitizationError {
    #[error("unsupported publication content policy version: {0}")]
    UnsupportedPolicy(u32),
    #[error("publication stylesheet exceeds the sanitization byte limit: {actual} > {limit}")]
    InputTooLarge { actual: usize, limit: usize },
    #[error("publication stylesheet is not valid UTF-8")]
    InvalidEncoding,
    #[error("publication stylesheet exceeds the token limit: {actual} > {limit}")]
    TooManyTokens { actual: usize, limit: usize },
    #[error("publication stylesheet exceeds the nesting limit: {actual} > {limit}")]
    NestingTooDeep { actual: usize, limit: usize },
}

struct CssContext<'a> {
    resource_href: &'a str,
    resources: &'a PublicationResourceIndex,
    limits: CssSanitizationLimits,
    token_count: usize,
    diagnostics: BTreeMap<&'static str, u32>,
    error: Option<CssSanitizationError>,
}

impl CssContext<'_> {
    fn count_token(&mut self) -> bool {
        self.token_count += 1;
        if self.token_count > self.limits.max_tokens {
            self.error = Some(CssSanitizationError::TooManyTokens {
                actual: self.token_count,
                limit: self.limits.max_tokens,
            });
            false
        } else {
            true
        }
    }

    fn enter_depth(&mut self, depth: usize) -> bool {
        if depth > self.limits.max_nesting_depth {
            self.error = Some(CssSanitizationError::NestingTooDeep {
                actual: depth,
                limit: self.limits.max_nesting_depth,
            });
            false
        } else {
            true
        }
    }

    fn diagnostic(&mut self, code: &'static str) {
        *self.diagnostics.entry(code).or_default() += 1;
    }

    fn classify_url(&self, value: &str) -> Result<(), &'static str> {
        if value.chars().any(char::is_control) {
            return Err("publication.unsafe_url_removed");
        }
        if let Ok(url) = Url::parse(value) {
            return if matches!(url.scheme(), "http" | "https") {
                Err("publication.remote_resource_blocked")
            } else {
                Err("publication.unsafe_url_removed")
            };
        }
        self.resources
            .resolve(self.resource_href, value)
            .map(|_| ())
            .map_err(|_| "publication.unsafe_url_removed")
    }
}

fn sanitized_url(value: &str, context: &mut CssContext<'_>) -> String {
    if let Err(code) = context.classify_url(value.trim()) {
        context.diagnostic(code);
        "#reader-blocked-resource".into()
    } else {
        value.into()
    }
}

fn nested_output(
    parser: &mut Parser<'_, '_>,
    context: &mut CssContext<'_>,
    depth: usize,
) -> String {
    if !context.enter_depth(depth) {
        return String::new();
    }
    parser
        .parse_nested_block(|nested| {
            Ok::<_, cssparser::ParseError<'_, ()>>(sanitize_components(nested, context, depth))
        })
        .unwrap_or_else(|_| {
            context.diagnostic("publication.stylesheet_degraded");
            String::new()
        })
}

fn quoted_url_argument(
    parser: &mut Parser<'_, '_>,
    context: &mut CssContext<'_>,
    depth: usize,
) -> Option<String> {
    if !context.enter_depth(depth) {
        return None;
    }
    parser
        .parse_nested_block(|nested| {
            let mut value = None;
            while let Ok(token) = nested
                .next_including_whitespace_and_comments()
                .map(Clone::clone)
            {
                if !context.count_token() {
                    break;
                }
                match token {
                    Token::WhiteSpace(_) | Token::Comment(_) => {}
                    Token::QuotedString(candidate) if value.is_none() => {
                        value = Some(candidate.to_string())
                    }
                    _ => {
                        context.diagnostic("publication.stylesheet_degraded");
                        value = None;
                    }
                }
            }
            Ok::<_, cssparser::ParseError<'_, ()>>(value)
        })
        .unwrap_or_else(|_| {
            context.diagnostic("publication.stylesheet_degraded");
            None
        })
}

fn discard_import(parser: &mut Parser<'_, '_>, context: &mut CssContext<'_>, depth: usize) {
    while let Ok(token) = parser
        .next_including_whitespace_and_comments()
        .map(Clone::clone)
    {
        if !context.count_token() || matches!(token, Token::Semicolon) {
            break;
        }
        if matches!(
            token,
            Token::Function(_)
                | Token::ParenthesisBlock
                | Token::SquareBracketBlock
                | Token::CurlyBracketBlock
        ) {
            let _ = nested_output(parser, context, depth + 1);
        }
    }
}

fn sanitize_components(
    parser: &mut Parser<'_, '_>,
    context: &mut CssContext<'_>,
    depth: usize,
) -> String {
    let mut output = String::new();
    while context.error.is_none() {
        let token = match parser
            .next_including_whitespace_and_comments()
            .map(Clone::clone)
        {
            Ok(token) => token,
            Err(_) => break,
        };
        if !context.count_token() {
            break;
        }
        match token {
            Token::AtKeyword(name) if name.eq_ignore_ascii_case("import") => {
                context.diagnostic("publication.stylesheet_import_removed");
                discard_import(parser, context, depth);
            }
            Token::Ident(name)
                if name.eq_ignore_ascii_case("behavior")
                    || name.eq_ignore_ascii_case("-moz-binding") =>
            {
                context.diagnostic("publication.css_execution_removed");
                output.push_str("reader-disabled-property");
            }
            Token::Function(name) if name.eq_ignore_ascii_case("expression") => {
                context.diagnostic("publication.css_execution_removed");
                let _ = nested_output(parser, context, depth + 1);
                output.push_str("initial");
            }
            Token::Function(name) if name.eq_ignore_ascii_case("url") => {
                let value = quoted_url_argument(parser, context, depth + 1);
                let value = value
                    .as_deref()
                    .map(|value| sanitized_url(value, context))
                    .unwrap_or_else(|| "#reader-blocked-resource".into());
                output.push_str("url(");
                let _ = serialize_string(&value, &mut output);
                output.push(')');
            }
            Token::UnquotedUrl(value) => {
                let value = sanitized_url(&value, context);
                output.push_str("url(");
                let _ = serialize_string(&value, &mut output);
                output.push(')');
            }
            Token::Function(_) => {
                let _ = token.to_css(&mut output);
                output.push_str(&nested_output(parser, context, depth + 1));
                output.push(')');
            }
            Token::ParenthesisBlock => {
                output.push('(');
                output.push_str(&nested_output(parser, context, depth + 1));
                output.push(')');
            }
            Token::SquareBracketBlock => {
                output.push('[');
                output.push_str(&nested_output(parser, context, depth + 1));
                output.push(']');
            }
            Token::CurlyBracketBlock => {
                output.push('{');
                output.push_str(&nested_output(parser, context, depth + 1));
                output.push('}');
            }
            Token::BadUrl(_) => {
                context.diagnostic("publication.stylesheet_degraded");
                context.diagnostic("publication.unsafe_url_removed");
                output.push_str("url(\"#reader-blocked-resource\")");
            }
            Token::BadString(_)
            | Token::CloseParenthesis
            | Token::CloseSquareBracket
            | Token::CloseCurlyBracket => {
                context.diagnostic("publication.stylesheet_degraded");
            }
            _ => {
                let _ = token.to_css(&mut output);
            }
        }
    }
    output
}

pub fn sanitize_css(
    bytes: &[u8],
    resource_href: &str,
    resources: &PublicationResourceIndex,
    policy_version: u32,
    limits: CssSanitizationLimits,
) -> Result<SanitizedContent, CssSanitizationError> {
    if policy_version != CONTENT_POLICY_VERSION {
        return Err(CssSanitizationError::UnsupportedPolicy(policy_version));
    }
    if bytes.len() > limits.max_input_bytes {
        return Err(CssSanitizationError::InputTooLarge {
            actual: bytes.len(),
            limit: limits.max_input_bytes,
        });
    }
    let source = std::str::from_utf8(bytes).map_err(|_| CssSanitizationError::InvalidEncoding)?;
    let mut input = ParserInput::new(source);
    let mut parser = Parser::new(&mut input);
    let mut context = CssContext {
        resource_href,
        resources,
        limits,
        token_count: 0,
        diagnostics: BTreeMap::new(),
        error: None,
    };
    let sanitized = sanitize_components(&mut parser, &mut context, 0);
    if let Some(error) = context.error {
        return Err(error);
    }
    let diagnostics = context
        .diagnostics
        .into_iter()
        .map(|(code, count)| SanitizationDiagnostic {
            code: code.into(),
            count,
        })
        .collect::<Vec<_>>();
    Ok(SanitizedContent {
        bytes: sanitized.into_bytes(),
        media_type: "text/css".into(),
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
            "EPUB/styles/book.css",
            "EPUB/images/paper.png",
            "EPUB/fonts/body.woff2",
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
    fn preserves_safe_layout_rules_and_allowlisted_local_resources() {
        let source = br#"@font-face { font-family: ReaderBody; src: url('../fonts/body.woff2') format('woff2'); }
            body { color: #222; background-image: url(../images/paper.png); margin: 1rem; }
            @media (prefers-color-scheme: dark) { body { color: rgb(230 230 230); } }"#;
        let result = sanitize_css(
            source,
            "EPUB/styles/book.css",
            &resources(),
            CONTENT_POLICY_VERSION,
            CssSanitizationLimits::default(),
        )
        .unwrap();
        let output = text(&result);

        assert_eq!(result.status, SanitizationStatus::Exact);
        assert!(result.diagnostics.is_empty());
        for preserved in [
            "@font-face",
            "ReaderBody",
            "../fonts/body.woff2",
            "../images/paper.png",
            "@media",
            "margin",
        ] {
            assert!(output.contains(preserved), "safe CSS was lost: {preserved}");
        }
    }

    #[test]
    fn removes_imports_remote_and_scriptable_urls_and_legacy_execution() {
        let source = br#"@import url('https://attacker.invalid/import.css');
            @import '../styles/also-local.css';
            body {
              background: URL(https://attacker.invalid/track.png);
              list-style-image: url('data:image/svg+xml,<svg onload=alert(1)>');
              cursor: url(javascript:alert(1));
              width: e\78pression(alert(1));
              behavior: url(#default#time2);
              -moz-binding: url('https://attacker.invalid/binding.xml');
              color: navy;
            }"#;
        let result = sanitize_css(
            source,
            "EPUB/styles/book.css",
            &resources(),
            CONTENT_POLICY_VERSION,
            CssSanitizationLimits::default(),
        )
        .unwrap();
        let output = text(&result).to_ascii_lowercase();

        assert!(output.contains("color"));
        for removed in [
            "@import",
            "attacker.invalid",
            "data:image",
            "javascript:",
            "expression(",
            "behavior:",
            "-moz-binding",
        ] {
            assert!(!output.contains(removed), "unsafe CSS survived: {removed}");
        }
        assert_eq!(result.status, SanitizationStatus::Degraded);
        assert_eq!(
            diagnostic_count(&result, "publication.stylesheet_import_removed"),
            2
        );
        assert!(diagnostic_count(&result, "publication.remote_resource_blocked") >= 2);
        assert!(diagnostic_count(&result, "publication.unsafe_url_removed") >= 2);
        assert!(diagnostic_count(&result, "publication.css_execution_removed") >= 3);
    }

    #[test]
    fn neutralizes_the_registered_active_content_stylesheet_fixture() {
        let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../tests/fixtures/epub/active-content-epub3.epub");
        let mut archive = zip::ZipArchive::new(std::fs::File::open(fixture).unwrap()).unwrap();
        let mut source = Vec::new();
        archive
            .by_name("EPUB/style.css")
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

        let result = sanitize_css(
            &source,
            "EPUB/style.css",
            &fixture_resources,
            CONTENT_POLICY_VERSION,
            CssSanitizationLimits::default(),
        )
        .unwrap();

        assert!(!text(&result).contains("example.invalid"));
        assert_eq!(result.status, SanitizationStatus::Degraded);
        assert_eq!(
            diagnostic_count(&result, "publication.remote_resource_blocked"),
            1
        );
    }

    #[test]
    fn malformed_css_is_degraded_deterministically_without_raw_fallback() {
        let source = b"p { color: red; background: url(https://attacker.invalid/a b); } }";
        let first = sanitize_css(
            source,
            "EPUB/styles/book.css",
            &resources(),
            CONTENT_POLICY_VERSION,
            CssSanitizationLimits::default(),
        )
        .unwrap();
        let second = sanitize_css(
            source,
            "EPUB/styles/book.css",
            &resources(),
            CONTENT_POLICY_VERSION,
            CssSanitizationLimits::default(),
        )
        .unwrap();

        assert_eq!(first, second);
        assert!(text(&first).contains("color"));
        assert!(!text(&first).contains("attacker.invalid"));
        assert!(diagnostic_count(&first, "publication.stylesheet_degraded") >= 1);
    }

    #[test]
    fn refuses_invalid_encoding_policy_and_resource_limits() {
        assert_eq!(
            sanitize_css(
                &[0xff],
                "EPUB/styles/book.css",
                &resources(),
                CONTENT_POLICY_VERSION,
                CssSanitizationLimits::default(),
            )
            .unwrap_err(),
            CssSanitizationError::InvalidEncoding
        );
        assert!(matches!(
            sanitize_css(
                b"12345",
                "EPUB/styles/book.css",
                &resources(),
                CONTENT_POLICY_VERSION,
                CssSanitizationLimits {
                    max_input_bytes: 4,
                    max_tokens: 10,
                    max_nesting_depth: 2
                },
            ),
            Err(CssSanitizationError::InputTooLarge { .. })
        ));
        assert!(matches!(
            sanitize_css(
                b"a { color: red; margin: 0; }",
                "EPUB/styles/book.css",
                &resources(),
                CONTENT_POLICY_VERSION,
                CssSanitizationLimits {
                    max_input_bytes: 1024,
                    max_tokens: 3,
                    max_nesting_depth: 2
                },
            ),
            Err(CssSanitizationError::TooManyTokens { .. })
        ));
        assert!(matches!(
            sanitize_css(
                b"@media screen { @supports (display: grid) { a { color: red } } }",
                "EPUB/styles/book.css",
                &resources(),
                CONTENT_POLICY_VERSION,
                CssSanitizationLimits {
                    max_input_bytes: 1024,
                    max_tokens: 100,
                    max_nesting_depth: 1
                },
            ),
            Err(CssSanitizationError::NestingTooDeep { .. })
        ));
        assert_eq!(
            sanitize_css(
                b"a { color: red }",
                "EPUB/styles/book.css",
                &resources(),
                0,
                CssSanitizationLimits::default(),
            )
            .unwrap_err(),
            CssSanitizationError::UnsupportedPolicy(0)
        );
    }
}
