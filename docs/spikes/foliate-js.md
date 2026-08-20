# foliate-js EPUB Engine Spike

Status: experimental, disabled by default

Pinned upstream: [`johnfactotum/foliate-js@78914aef4466eb960965702401634c2cb348e9b1`](https://github.com/johnfactotum/foliate-js/commit/78914aef4466eb960965702401634c2cb348e9b1)

## Purpose

This is the first executable spike from the [Reader V2 refactor plan](../plans/2026-08-19-reader-v2-refactor-plan.md). It validates the browser-side rendering surface before the production importer, resource loader, database schema, and migration are implemented.

The spike currently proves the integration shape:

- lazy-load `foliate-js` only when the feature flag is enabled;
- open an existing imported EPUB source;
- preserve nested foliate TOC items;
- navigate by href;
- switch paginated/scrolled flow;
- move previous/next;
- receive `load`, `relocate`, and `external-link` events;
- persist the last CFI locally per document;
- inject a reader stylesheet without flattening XHTML;
- keep all upstream calls inside one experimental adapter component.

## Run

```bash
npm ci
VITE_EPUB_ENGINE=foliate npm run tauri dev
```

Import an EPUB through the normal Library flow and open it. EPUB documents use the spike reader; PDF and Markdown continue to use the V1 reader. Without `VITE_EPUB_ENGINE=foliate`, all formats use V1.

## Current transport (still experimental)

The flagged spike now opens an opaque publication session from `documentId`, passes `TauriPublicationLoader` into foliate-js's `EPUB` constructor, and gives the resulting book object to `foliate-view`. The foliate path no longer reads `document.file_path` or calls `convertFileSrc`; text and Blob resources are read on demand through versioned `publication_*_v2` commands and the Rust publication allowlist. Session cleanup is idempotent across initialization failure, reader failure, document changes, and component unmount.

Do **not** enable this by default or ship it yet:

- a production CSP baseline now blocks inline/eval/blob/remote scripts, remote image/font/media/frame sources, objects, and forms, but cross-platform Tauri WebView evidence is still missing;
- the asset protocol static scope is limited to app-private data/cache; startup restores only exact imported PDF paths and the explicitly configured local model directory;
- foliate manifest script resources are denied again at the loader event boundary;
- `Vec<u8>` Blob transport now has opt-in invoke-boundary counters, but still needs real Tauri WebView and process-memory measurements; follow [`../development/epub-performance-probe.md`](../development/epub-performance-probe.md);
- `active-content-epub3.epub` now supplies manifest/inline script, event-handler, remote fetch/image/CSS/frame/form, and `javascript:` probes. The flagged reader emits a delayed execution/resource-timing report for this fixture; follow [`../development/epub-security-probe.md`](../development/epub-security-probe.md). It must still be exercised in supported Tauri WebViews before those CSP outcomes count as proven.

The loader and book-session boundaries are contract-tested, including synchronous resource sizes, detached loader methods, optional missing resources, initialization failure, and exact-once cleanup. [ADR-002](../adr/002-publication-resource-storage.md) selects an immutable, content-addressed archive copy in app data as the V2 production source; the current V1 database path remains a transitional spike input. A Tauri WebView fixture run is still required before checking the transport exit criterion.

## Known build finding

Vite 8 reports an `Invalid glob pattern: vendor/pdfjs/*` warning while analyzing foliate-js `pdf.js`. EPUB output still builds. [ADR-001](../adr/001-epub-rendering-engine.md) conditionally accepts foliate-js for continued Phase 0 work but requires this unwanted PDF build path to be patched, vendored, or bypassed by an EPUB-only wrapper before beta.

## Exit criteria

The spike is accepted for production architecture only after:

- [ ] EPUB 2/3 fixture matrix is recorded;
- [ ] nested TOC, images, CSS, fonts, SVG, RTL and fixed-layout results are recorded;
- [ ] CFI survives restart, theme changes and viewport changes;
- [ ] annotation overlayer can restore a CFI range;
- [ ] `TauriPublicationLoader` works without broad asset access;
- [ ] CSP tests block script, external fetch, `javascript:` and dangerous embeds;
- [ ] memory use is measured on 10MB, 50MB and image-heavy EPUBs;
- [x] API wrapper contract and upstream update process are documented in ADR-001.
