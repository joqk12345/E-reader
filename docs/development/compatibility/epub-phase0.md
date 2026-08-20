# EPUB Compatibility Report

Generated: 2026-08-20T15:28:58Z
Commit: `e47fbd2b053b`

> This report records evidence, not inferred support. `not-run` is not a passing result, and configuration/unit evidence is not a substitute for a real WebView probe.

## Summary

| Total | Pass | Fail | Blocked | Not run |
|---:|---:|---:|---:|---:|
| 39 | 0 | 0 | 0 | 39 |

## Matrix

| Fixture | Category | Expectation | Status | Environment | Evidence |
|---|---|---|---|---|---|
| active-content-epub3 | security | blocked:inline-script-csp | not-run | — | — |
| active-content-epub3 | security | blocked:javascript-url | not-run | — | — |
| active-content-epub3 | security | blocked:manifest-script | not-run | — | — |
| active-content-epub3 | security | blocked:onload-handler-csp | not-run | — | — |
| active-content-epub3 | security | blocked:remote-css-csp | not-run | — | — |
| active-content-epub3 | security | blocked:remote-fetch-csp | not-run | — | — |
| active-content-epub3 | security | blocked:remote-form-csp | not-run | — | — |
| active-content-epub3 | security | blocked:remote-frame-csp | not-run | — | — |
| active-content-epub3 | security | blocked:remote-image-csp | not-run | — | — |
| active-content-epub3 | security | open | not-run | — | — |
| fixed-layout-epub3 | expected-limitation | fixed-layout:expected-limitation | not-run | — | — |
| fixed-layout-epub3 | expected-limitation | open | not-run | — | — |
| fixed-layout-epub3 | expected-limitation | rendition-pre-paginated | not-run | — | — |
| fixed-layout-epub3 | expected-limitation | viewport-800x600 | not-run | — | — |
| malformed-xhtml-epub3 | malformed | diagnostic:malformed-xhtml | not-run | — | — |
| malformed-xhtml-epub3 | malformed | diagnostic:missing-fragment | not-run | — | — |
| malformed-xhtml-epub3 | malformed | open-with-diagnostic | not-run | — | — |
| minimal-epub3 | epub3 | epub3-nav | not-run | — | — |
| minimal-epub3 | epub3 | nested-toc | not-run | — | — |
| minimal-epub3 | epub3 | open | not-run | — | — |
| minimal-epub3 | epub3 | relative-css | not-run | — | — |
| minimal-epub3 | epub3 | svg-resource | not-run | — | — |
| nonascii-path-epub2 | epub2 | epub2-ncx | not-run | — | — |
| nonascii-path-epub2 | epub2 | non-ascii-path | not-run | — | — |
| nonascii-path-epub2 | epub2 | open | not-run | — | — |
| nonascii-path-epub2 | epub2 | percent-encoded-href | not-run | — | — |
| rtl-ruby-epub3 | epub3 | epub3-nav | not-run | — | — |
| rtl-ruby-epub3 | epub3 | open | not-run | — | — |
| rtl-ruby-epub3 | epub3 | rtl | not-run | — | — |
| rtl-ruby-epub3 | epub3 | ruby | not-run | — | — |
| short-toc-epub2 | epub2 | epub2-ncx | not-run | — | — |
| short-toc-epub2 | epub2 | open | not-run | — | — |
| short-toc-epub2 | epub2 | short-author-toc | not-run | — | — |
| short-toc-epub2 | epub2 | two-spine-items | not-run | — | — |
| table-footnote-mathml-epub3 | epub3 | footnote | not-run | — | — |
| table-footnote-mathml-epub3 | epub3 | mathml | not-run | — | — |
| table-footnote-mathml-epub3 | epub3 | noteref-return | not-run | — | — |
| table-footnote-mathml-epub3 | epub3 | open | not-run | — | — |
| table-footnote-mathml-epub3 | epub3 | table | not-run | — | — |
