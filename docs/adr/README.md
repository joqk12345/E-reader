# Reader Architecture Decision Records

| ADR | Status | Decision |
|---|---|---|
| [ADR-001](001-epub-rendering-engine.md) | Conditional Phase 0 acceptance | Use pinned foliate-js behind a Reader-owned EPUB adapter; default enablement remains gated |
| [ADR-002](002-publication-resource-storage.md) | Accepted V2 target | Keep an immutable validated EPUB archive in app data and read scoped resources on demand |
| [ADR-003](003-publication-locator-and-reanchoring.md) | Accepted V2 contract | Use a versioned Locator with EPUB CFI plus selector, quote, and progression fallbacks |
| [ADR-004](004-publication-content-security-policy.md) | Accepted V2 contract | Render a derived sanitized publication view under restrictive CSP and scoped capabilities |
| [ADR-005](005-quiet-reader-visual-direction.md) | Accepted design direction | Make reading the primary surface; reveal tools contextually and keep AI assistance subordinate to the text |
| [ADR-006](006-product-slimming-epub-markdown.md) | Accepted product scope | Remove PDF Feature and focus Reader on EPUB and Markdown while preserving historical PDF records safely |
| [ADR-007](007-crap-design-system-refactor.md) | Proposed design direction | Use Contrast, Repetition, Alignment, and Proximity as the shared design review language for 0.5.4 |
| [ADR-008](008-library-sidebar-information-architecture.md) | Proposed design direction | Prioritize common Library paths and progressively disclose Category and Tags filters |
| [ADR-009](009-reader-tools-information-architecture.md) | Proposed design direction | Group Reader tools by task, prioritize frequent actions, and progressively disclose advanced tools |
| [ADR-010](010-home-workspace-information-architecture.md) | Proposed design direction | Make the home screen a continue-reading workspace with progressive disclosure for advanced features |
| [ADR-011](011-library-flat-collection-default.md) | Proposed design direction | Use a flat Library collection by default and keep category grouping as an opt-in view |
| [ADR-012](012-library-view-density-and-display-modes.md) | Proposed design direction | Use List as the default Library view and retain Grid and Compact as density modes |
| [ADR-013](013-library-top-toolbar-hierarchy.md) | Proposed design direction | Separate Library identity, discovery, creation, view, and management actions into clear toolbar layers |
| [ADR-014](014-home-and-library-header-hierarchy.md) | Proposed design direction | Separate global navigation from Library page identity and remove duplicate header subtitles |
| [ADR-015](015-shell-density-and-spacing-rhythm.md) | Proposed design direction | Reduce structural whitespace with a shared density and spacing rhythm while preserving reading and interaction space |
| [ADR-016](016-home-global-navigation-and-page-identity.md) | Proposed design direction | Separate global navigation from page identity and remove redundant homepage top-level identity layers |
| [ADR-017](017-library-result-toolbar-alignment.md) | Proposed design direction | Align Library result status with search tools and keep Import as the primary page action |
| [ADR-018](018-library-identity-toolbar-in-app-shell.md) | Proposed design direction | Move Library identity and page actions into the single App Shell toolbar |
| [ADR-019](019-product-slimming-remove-markdown.md) | Accepted product scope | Remove Markdown document import and reading while preserving historical records and AI Markdown rendering |

ADR-001 through ADR-004 close the initial Phase 0 engine/resource/locator/content-policy decisions. Their production evidence and implementation conditions remain binding.

An ADR records a decision and its evidence limits. It does not override the feature flag, migration, security, compatibility, or exact-tree quality gates in the [Reader V2 plan](../plans/2026-08-19-reader-v2-refactor-plan.md).
