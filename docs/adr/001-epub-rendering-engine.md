# ADR-001: Use foliate-js behind the Reader EPUB adapter boundary

- Status: **Accepted conditionally for Phase 0; not approved for default production enablement**
- Date: 2026-08-20
- Decision owners: Reader V2 maintainers
- Upstream revision reviewed: `johnfactotum/foliate-js@78914aef4466eb960965702401634c2cb348e9b1`

## Context

Reader V1 destroys EPUB structure during import by flattening XHTML to paragraphs. V2 needs an engine that can render original publication resources, preserve nested navigation, expose EPUB CFI, support reflowable and fixed-layout books, and work with a publication-scoped random-access loader rather than an arbitrary filesystem URL.

The engine must remain replaceable because EPUB rendering has a long compatibility tail and because the selected upstream library explicitly describes its API as unstable.

## Decision

Use **foliate-js as the preferred EPUB rendering engine candidate**, isolated behind Reader-owned adapters. Continue Phase 0 and Phase 3 work on this architecture:

```text
Reader shell
  -> Reader EpubAdapter (stable application contract; Phase 3)
    -> foliate book/view wrapper
      -> TauriPublicationLoader
        -> publication_*_v2 commands
          -> validated ZIP store and publication allowlist
```

This decision permits continued implementation and evidence gathering. It does **not** permit enabling the engine by default or claiming production security/compatibility until the exit conditions below pass.

### Dependency policy

- The reviewed source is pinned to the immutable GitHub archive for commit `78914aef4466eb960965702401634c2cb348e9b1` in both `package.json` and `package-lock.json`.
- Floating branches, tags without immutable integrity, and direct edits under `node_modules` are prohibited.
- The archive pin is acceptable during the spike. Before beta, choose either a reviewed vendored copy/submodule or a reproducible patch mechanism if upstream changes are required.
- foliate-js is MIT licensed. Preserve its license when vendoring or distributing modified source.

### Adapter boundary

Direct foliate-js imports and object-model knowledge are limited to the foliate integration directory, currently:

- `src/features/reader/foliate/FoliateEpubSpikeReader.tsx`
- `src/features/reader/foliate/TauriEpubBookSession.ts`
- `src/types/foliate-js.d.ts`

Application components outside that boundary must not depend on foliate book, renderer, relocation, or TOC object shapes. The spike component will later be replaced by the stable `EpubAdapter` described in the V2 plan.

### Resource and lifecycle contract

- The frontend opens by database `documentId`, never by arbitrary path.
- `TauriPublicationLoader` implements asynchronous `loadText`/`loadBlob` and synchronous cached `getSize`.
- Rust owns archive validation, publication allowlists, file handles, and opaque sessions.
- Book destruction and session closure are idempotent and occur on initialization failure, reader failure, document change, and unmount.
- V1 remains the default and rollback path while `VITE_EPUB_ENGINE=foliate` is unset.

### Security policy

foliate-js warns that its blob-document model and WebKit sandbox requirements cannot safely support scripted EPUB without CSP. Reader therefore requires defense in depth:

- production CSP blocks publication scripts and remote subresources;
- manifest script resources are denied at the foliate loader event boundary;
- external links are user-initiated and allowlisted to HTTP(S)/mailto;
- publication resources resolve only through the backend allowlist;
- active-content fixtures must pass real WebView probes before release.

Configuration/unit tests are not substitutes for macOS WKWebView, Windows WebView2, and Linux WebKitGTK evidence.

## Why foliate-js

The reviewed revision provides the closest fit to Reader's required boundary:

- EPUB 2/3 parsing, nested TOC/page list, CFI and href navigation;
- reflowable pagination, scrolling, RTL progression, and fixed-layout rendering;
- a small loader interface (`loadText`, `loadBlob`, synchronous `getSize`) that maps to scoped Tauri commands;
- lazy resource loading rather than mandatory whole-book extraction into browser memory;
- transform and relocation events needed for themes, security policy, locators, and later annotation/TTS work;
- existing use in stable Foliate application releases.

The Phase 0 spike has demonstrated the adapter shape, opaque-session loader, nested TOC handling, CFI persistence, lifecycle cleanup, security probes, and invoke-boundary metrics.

## Alternatives considered

### epub.js

Advantages include a larger EPUB-specific ecosystem and established usage. It remains the first fallback candidate if foliate-js fails the corpus, WebView, locator, or maintenance gates. It was not selected for the first implementation because foliate-js offers a compact book interface, direct CFI/progress primitives, fixed-layout integration, and a loader shape that maps cleanly to Reader's scoped resource store.

### Readium Web

Readium offers strong standards experience and publication models. It may be preferable for broader interoperability, but integration and packaging are heavier for the current desktop application. Re-evaluate it if the selected engine cannot meet P0 compatibility or security isolation.

### Custom renderer

A custom iframe renderer would maximize control but would require Reader to own EPUB CSS, pagination, CFI, fixed-layout, RTL, footnote, and WebView compatibility behavior. This is rejected unless both maintained engine options have blocking failures.

## Consequences

### Positive

- Reader can replace the lossy EPUB path incrementally while retaining V1 rollback.
- The backend, not the WebView, controls archive and filesystem access.
- Engine instability is concentrated behind a testable wrapper.
- Existing foliate CFI, pagination, fixed-layout, progress, and overlayer primitives can accelerate later phases.

### Negative and risks

- Upstream has no stable release and may break APIs at any commit.
- `view.js` references an experimental PDF adapter; Vite currently emits an invalid `vendor/pdfjs/*` glob warning and includes unwanted format chunks. This must be patched, vendored, or bypassed with an EPUB-only wrapper before beta.
- Paginator behavior inherits CSS multi-column limitations and WebView differences.
- Blob/`Vec<u8>` IPC may have unacceptable serialization or memory overhead.
- CSP inheritance for blob documents must be proven separately on every supported WebView.
- Font obfuscation may require an explicit SHA-1 implementation/secure-context decision.

## Upstream update procedure

For every proposed foliate-js revision:

1. Record the old and new immutable commit IDs.
2. Review the upstream diff, with special attention to `epub.js`, `view.js`, `paginator.js`, `fixed-layout.js`, iframe sandboxing, link handling, Blob URL creation, loader calls, and vendored code.
3. Confirm license files and dependency changes.
4. Update both package manifests; never edit installed output.
5. Run loader/book-session contract tests, fixture validation, full frontend/Rust tests, build, Cargo check, and the exact-tree TDD gate.
6. Re-run the EPUB 2/3 compatibility matrix, active-content WebView probe, CFI restoration scenarios, and representative performance measurements.
7. Record regressions, local patches, and the resulting decision in this ADR or a superseding ADR.

An upstream update is rejected if it weakens the document-identity/session boundary, requires broad asset scope, executes publication scripts, bypasses external-link policy, breaks locator restoration, or exceeds the accepted performance budget without an approved mitigation.

## Production exit conditions

All of the following remain mandatory before default enablement:

- P0 EPUB 2/3 compatibility matrix and platform results are recorded;
- nested TOC, CSS, images, fonts, SVG, RTL, tables/footnotes, and declared fixed-layout scope pass;
- CFI restoration survives restart, viewport, flow, and theme changes;
- active-content and remote-request probes pass on WKWebView, WebView2, and WebKitGTK;
- 10MB, 50MB, and image-heavy EPUB measurements establish acceptable first-screen, chapter navigation, IPC, and memory behavior;
- the unwanted foliate PDF build path/warning is resolved;
- annotation overlayer and locator fallback prototypes are viable;
- Reader's stable `EpubAdapter` contract replaces direct spike usage.

If a blocking condition fails, keep V1 available and run the same failing evidence against epub.js or Readium before reconsidering the engine.

## Evidence

- [Reader V2 refactor plan](../plans/2026-08-19-reader-v2-refactor-plan.md)
- [foliate-js spike report](../spikes/foliate-js.md)
- [EPUB security probe protocol](../development/epub-security-probe.md)
- [EPUB performance probe protocol](../development/epub-performance-probe.md)
- [EPUB fixture registry](../../tests/fixtures/epub/README.md)
