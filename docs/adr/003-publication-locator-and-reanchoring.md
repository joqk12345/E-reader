# ADR-003: Use a versioned EPUB Locator with CFI and quote-based re-anchoring

- Status: **Accepted as the V2 locator contract; implementation pending**
- Date: 2026-08-20
- Decision owners: Reader V2 maintainers

## Context

Reader V1 identifies EPUB positions with values such as `"{href}#p{index}"`. Those values are paragraph-array coordinates created after lossy XHTML flattening. They are not EPUB CFI, do not identify DOM ranges, and cannot reliably survive changes in layout, theme, parsing, or semantic-block extraction.

V2 needs one position model for:

- current reading position and restart restoration;
- TOC and search navigation;
- annotations and selected ranges;
- semantic content blocks;
- translation, TTS, summary, and citation links back to source;
- migration from V1 paragraph positions;
- diagnostics when a saved position can no longer be resolved.

No single anchor is sufficient. CFI is precise for a stable EPUB DOM but can fail after sanitization/parser changes or publication replacement. CSS selectors can be fragile. Text quotes can be ambiguous. Progression alone is approximate. The contract therefore needs a primary anchor plus deterministic fallbacks and evidence about the publication to which it belongs.

## Decision

Adopt a **versioned Reader Locator DTO** based on the Readium-style shape, with EPUB CFI as the primary EPUB anchor and href/text anchors as required fallbacks.

```ts
type PublicationLocatorV1 = {
  schemaVersion: 1;
  publicationId: string;
  sourceHash: string;
  href: string;
  type?: string;
  title?: string;
  locations: {
    cfi?: string;
    progression?: number;
    totalProgression?: number;
    position?: number;
    cssSelector?: string;
  };
  text?: {
    before?: string;
    highlight?: string;
    after?: string;
  };
};
```

`href` is mandatory and canonical within the publication. A useful persisted locator must also have at least one of CFI, text highlight, CSS selector, progression, or position.

### Identity and scope

- `publicationId` identifies the imported V2 publication, not a V1 document paragraph.
- `sourceHash` binds the locator to immutable publication bytes selected in ADR-002.
- A locator is resolved only inside that publication's manifest/spine allowlist.
- A locator from another publication or source hash is never silently applied.
- When a new edition/re-import has a different source hash, Reader may attempt an explicit migration using href and quote anchors, producing a migration result rather than mutating the old locator invisibly.

### Canonical href

- Resolve against the OPF/resource base using the same canonical URI rules as publication resource access.
- Persist a publication-relative href with no query component.
- Keep a fragment only when it is meaningful as a navigation fallback; the CFI remains separate.
- Reject external schemes, protocol-relative URLs, traversal, encoded separators, and hrefs outside the publication allowlist.
- Preserve Unicode after one well-defined percent-decoding/canonicalization pass; do not compare paths using suffix or substring matching.

### CFI

- Use EPUB CFI for precise EPUB point/range anchors whenever foliate-js can produce and resolve one.
- Persist the complete CFI string, not a renderer-internal object.
- For an annotation, persist start and end locators; do not encode the whole range in an opaque application-specific string.
- CFI creation and resolution remain inside the EPUB adapter. Reader shell and AI features consume the Locator DTO rather than foliate-js APIs.
- Theme, font size, viewport, pagination/scroll mode, and column count must not rewrite CFI because they are presentation changes.
- DOM-transform policy must be deterministic and versioned. If sanitization changes the DOM used for CFI, quote anchors provide recovery and the locator is rewritten only after successful resolution.

### Text quote

For selected text and semantic blocks, persist:

- `highlight`: normalized exact selected text;
- `before`: bounded normalized context immediately before the selection;
- `after`: bounded normalized context immediately after the selection.

Normalization must collapse Unicode whitespace consistently without case-folding or punctuation removal. The exact original selected text remains user-visible annotation data where needed; locator normalization is a matching aid, not a destructive edit of user content.

Initial bounds should be implementation constants covered by tests, with a target of roughly 32–64 Unicode scalar values on each side. Do not persist entire chapters as quote context.

### CSS selector

A CSS selector is an optional same-href fallback:

- prefer stable publisher IDs when unique;
- otherwise generate a deterministic structural selector under the rendered content root;
- never execute arbitrary selector text received from an untrusted frontend without validation/error handling;
- selector failure is recoverable and proceeds to quote matching.

Selectors are secondary because sanitization and publisher markup changes can invalidate them.

### Progression and position

- `progression` is a number in `[0, 1]` within the href/spine item.
- `totalProgression` is a number in `[0, 1]` across the linear reading order.
- `position` is a positive, stable logical position only when generated by the publication index; it is not a DOM paragraph-array index.
- Progression is suitable for coarse recovery and display, not annotation precision.
- Clamp or reject malformed values at DTO boundaries; never pass NaN/infinity to a renderer.

## Resolution algorithm

Resolution is deterministic and records which strategy succeeded.

1. **Validate identity and href**: schema version, publication ID, source hash, and canonical allowlisted href must match.
2. **CFI**: resolve the CFI in the expected spine item. Reject results outside the item or inconsistent with the saved highlighted quote.
3. **CSS selector plus quote**: find the selector in the href and match the quote within/near that node.
4. **Exact quote in href**: search normalized rendered text in the expected href; rank matches using before/after context.
5. **Quote in nearby spine items**: only for explicit migration/re-anchoring, within a small bounded neighborhood, never during ordinary same-source restoration unless policy enables it.
6. **Href progression/position**: restore approximately inside the expected item.
7. **Spine item start**: final readable fallback when href is valid.
8. **Unresolved**: return a typed diagnostic; do not delete the annotation or fabricate a successful exact anchor.

### Ambiguity rules

- One exact quote match with matching context succeeds.
- Multiple matches are scored by exact before/after context and proximity to selector/progression.
- A tie or score below the accepted threshold is `ambiguous`, not arbitrary first-match success.
- Re-anchoring returns `exact`, `reanchored`, `approximate`, `ambiguous`, or `unresolved` status.
- Only `exact`/`reanchored` results may automatically update a precise annotation anchor. Approximate reading-position restoration may update after the user actually navigates there.

Suggested result contract:

```ts
type LocatorResolution = {
  status: 'exact' | 'reanchored' | 'approximate' | 'ambiguous' | 'unresolved';
  strategy?: 'cfi' | 'selector-quote' | 'quote' | 'nearby-quote' | 'position' | 'progression' | 'href';
  locator?: PublicationLocatorV1;
  diagnostic?: { code: string; message: string };
};
```

## Creation rules by feature

### Reading position

Persist href, point CFI, href progression, total progression when available, and current title. Text quote is optional but recommended around the visible anchor for recovery.

Write positions with debouncing and monotonic timestamps. A stale async write must not overwrite a newer position.

### Annotation/selection

Persist start/end locators, exact selected text, bounded before/after context, and source hash. A collapsed selection is not a range annotation.

### Semantic content block

Persist href, block CFI or start/end locator, deterministic selector where available, and text quote. Search/TTS/translation results reference the block locator instead of constructing independent paragraph IDs.

### TOC/navigation

TOC targets may initially contain href/fragment only. After display, the adapter may report a resolved CFI/current locator. Do not rewrite the author-provided TOC structure.

### Search result

A search hit includes a Locator, snippet, and match text. Navigation resolves the locator; it does not merely open the chapter start.

## Persistence

- Persist locator JSON with an explicit `schemaVersion`.
- Store publication ID, href, and selected indexed fields in columns where queries require them; the JSON remains the complete contract.
- Reading position is unique per publication/profile according to product policy.
- Annotation start/end locators are immutable historical anchors unless a successful re-anchor creates an auditable replacement.
- `localStorage` CFI persistence in the current spike is transitional and must not become the V2 source of truth.
- Position and annotation writes are transactional with their owning record.

## Migration from V1

V1 values such as `href#pN` are hints, not trusted V2 locators.

1. Load the V1 paragraph text and neighboring text before migration.
2. Resolve the canonical V2 href.
3. Match an exact quote in the rendered/semantic content for that href.
4. Use neighboring quote context and approximate paragraph order to disambiguate.
5. Generate a fresh V2 Locator/CFI from the resolved DOM range.
6. Preserve the V1 value and migration diagnostic until user acceptance.
7. Mark unmatched/ambiguous annotations as needing repair; never delete them.

Migration is idempotent: rerunning it must reuse a successful mapping or produce the same unresolved diagnostic without duplicating annotations.

## Alternatives considered

### CFI only

Precise on a stable DOM but brittle across sanitization/parser changes and source replacement. Rejected because there is no recovery evidence when a CFI fails.

### Href plus paragraph index

Simple and compatible with V1, but tied to lossy extraction and unstable block boundaries. Rejected as a canonical locator; retained only as migration input.

### CSS selector only

Easy to inspect but fragile under markup normalization and repeated structures. Rejected as the sole anchor.

### Text quote only

Portable across markup changes but ambiguous for repeated text and expensive without href/context bounds. Rejected as the sole anchor; accepted as the primary re-anchoring fallback.

### Global character offset

Sensitive to normalization and publication updates, and expensive to maintain across spine items. Rejected for persistence. Internal search indexes may use offsets if they always map back to a Locator.

## Consequences

### Positive

- Reading, search, annotation, TTS, translation, and semantic blocks share one position language.
- CFI provides exact EPUB navigation while quotes recover from controlled DOM changes.
- Source-hash binding prevents silent application to the wrong edition.
- Ambiguity is visible instead of producing corrupt anchors.
- Renderer-specific objects remain behind the EPUB adapter.

### Negative and risks

- Locator creation/resolution and quote normalization require substantial tests.
- Persisted anchors are larger than paragraph indexes.
- Quote matching can be expensive in long chapters and must be bounded/indexed.
- Sanitization policy and locator generation order must remain coordinated.
- foliate-js API instability may affect CFI generation/resolution.
- Cross-edition migration cannot guarantee exact recovery.

## Required tests

### Unit/contract

- DTO schema/version and malformed number rejection;
- canonical Unicode/percent-encoded href behavior;
- CFI point/range serialization round trip;
- quote normalization and context bounds;
- repeated-quote ambiguity and deterministic scoring;
- fallback order and typed resolution status;
- source-hash/publication mismatch rejection;
- stale position write ordering.

### Fixture/integration

- nested TOC and fragment navigation;
- restart restoration in the same visible block;
- paginated/scrolled and viewport changes;
- reader theme/font-size/line-height changes;
- repeated text, Unicode, RTL, ruby, footnote, and long-chapter cases;
- controlled sanitization-version change;
- missing href/CFI and malformed XHTML diagnostics;
- V1 paragraph/annotation migration idempotency.

### E2E

- open -> navigate -> close -> restart -> restore;
- select -> annotate -> restart -> restore range;
- search result -> exact match highlight;
- TTS/translation result -> same semantic block locator;
- unresolved annotation remains visible in a repair state.

## Implementation status

Already available in the Phase 0 spike:

- foliate relocation events and CFI strings;
- href navigation and nested TOC;
- per-document localStorage CFI as temporary evidence;
- immutable-source decision in ADR-002;
- publication-scoped href/resource resolver.

Still required:

- shared TypeScript/Rust Locator DTO and validation;
- locator database schema and versioned commands;
- CFI plus text-quote creation;
- deterministic resolver/re-anchor engine;
- semantic-block mapping;
- migration and integration/E2E coverage.

## Acceptance criteria

- A saved reading position restores within the same block after restart and presentation changes.
- Annotation ranges restore exactly or report a non-destructive ambiguous/unresolved state.
- Search, TTS, translation, and semantic blocks return the shared Locator DTO.
- A locator cannot escape or cross its publication/source hash.
- Fallback strategy and diagnostic are observable in tests/import reports.
- V1 migration is transactional, idempotent, and preserves unmatched data.

## Evidence

- [Reader V2 refactor plan](../plans/2026-08-19-reader-v2-refactor-plan.md)
- [ADR-001: EPUB rendering engine](001-epub-rendering-engine.md)
- [ADR-002: publication resource storage](002-publication-resource-storage.md)
- [foliate-js spike report](../spikes/foliate-js.md)
- `src/features/reader/foliate/foliateModel.ts`
- `src-tauri/src/publication/resources.rs`
