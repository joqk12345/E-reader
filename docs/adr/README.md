# Reader Architecture Decision Records

| ADR | Status | Decision |
|---|---|---|
| [ADR-001](001-epub-rendering-engine.md) | Conditional Phase 0 acceptance | Use pinned foliate-js behind a Reader-owned EPUB adapter; default enablement remains gated |
| [ADR-002](002-publication-resource-storage.md) | Accepted V2 target | Keep an immutable validated EPUB archive in app data and read scoped resources on demand |
| [ADR-003](003-publication-locator-and-reanchoring.md) | Accepted V2 contract | Use a versioned Locator with EPUB CFI plus selector, quote, and progression fallbacks |
| [ADR-004](004-publication-content-security-policy.md) | Accepted V2 contract | Render a derived sanitized publication view under restrictive CSP and scoped capabilities |

ADR-001 through ADR-004 close the initial Phase 0 engine/resource/locator/content-policy decisions. Their production evidence and implementation conditions remain binding.

An ADR records a decision and its evidence limits. It does not override the feature flag, migration, security, compatibility, or exact-tree quality gates in the [Reader V2 plan](../plans/2026-08-19-reader-v2-refactor-plan.md).
