# ADR-004: Render a sanitized publication view under restrictive CSP

- Status: **Accepted as the V2 content-security contract; implementation is partial**
- Date: 2026-08-20
- Decision owners: Reader V2 maintainers

## Context

EPUB is an untrusted ZIP-based web publication. It may contain JavaScript, inline event handlers, forms, iframes, external URLs, SVG active content, CSS imports, fonts, malformed markup, and resources designed to read files, exfiltrate data, track users, or exhaust memory.

foliate-js renders publication documents through Blob URLs and requires `allow-scripts` on WebKit iframe sandboxes because of an upstream WebKit limitation. Its own documentation explicitly states that scripted EPUB cannot be supported safely without CSP. An iframe sandbox alone is therefore not a security boundary.

Reader also has legitimate application-shell network requirements for update checks and optional model downloads. A global CSP is necessary but cannot by itself express that app-shell code may contact an audited endpoint while publisher content may not. V2 consequently needs multiple independent controls and a deterministic sanitization policy.

The immutable archive selected by ADR-002 remains the canonical publication source. Security processing must not overwrite it, because Reader needs reproducible imports, diagnostics, migration, and the ability to apply a newer policy later.

## Decision

Treat every publication as hostile and render only a **derived, policy-versioned sanitized view** under restrictive CSP and publication-scoped resource resolution.

```text
immutable publication archive
  -> ZIP/container/resource validation
  -> manifest media classification
  -> DOM/CSS/SVG sanitization policy
  -> publication-scoped URL rewriting
  -> sanitized derived render bytes
  -> foliate Blob document
  -> CSP + loader script denial + iframe isolation
  -> user-initiated external-link bridge
```

No single layer is sufficient. Failure or regression in one layer must still encounter another control.

## Trust boundaries

### Trusted application shell

Reader-owned React code, versioned Tauri commands, and audited bundled dependencies operate as application code. They may access only capabilities granted by Tauri and CSP.

### Untrusted publication content

All archive paths, OPF metadata, XHTML, HTML, CSS, SVG, fonts, media, URLs, filenames, MIME declarations, and embedded metadata are untrusted, even for a book previously imported successfully.

### Trusted canonical bytes, untrusted semantics

After hash verification and immutable storage, archive bytes are trusted only for identity/integrity. They are still not trusted to execute or access capabilities.

## Policy versioning

Every V2 publication/import report records a `contentPolicyVersion`. Sanitized render output and semantic-block extraction identify the policy version that produced them.

- A policy update does not mutate the canonical archive.
- Derived render/cache data may be regenerated.
- Changes that alter rendered DOM structure trigger locator/re-anchor tests from ADR-003.
- A security policy downgrade is never automatic.
- Unsupported active content produces diagnostics, not silent execution.

The initial implementation should use an integer version with Reader-owned release notes and migration tests.

## Sanitization location and contract

Production sanitization occurs in the trusted publication pipeline before content is converted to a renderable Blob URL. It must use a DOM/CSS parser and an explicit allow/deny policy, not regular expressions.

The preferred V2 boundary is a backend render-resource operation or precomputed derived representation based on parsed manifest media types. The frontend may apply additional defensive transforms, but frontend-only string rewriting is not the canonical sanitizer.

Sanitization is deterministic for the same source bytes and policy version. It returns:

- sanitized bytes;
- normalized media type and encoding;
- blocked/rewritten resource diagnostics;
- policy version;
- whether rendering was exact, degraded, or refused.

Malformed input must produce either deterministic parser recovery with a warning or a typed refusal. It must not bypass the policy by falling back to raw source text.

## XHTML/HTML policy

### Always remove or neutralize

- `script` and executable module/script resources;
- all attributes whose normalized name begins with `on`;
- `iframe`, `frame`, `frameset`, `object`, `embed`, and `applet` for the P0 profile;
- `srcdoc`;
- `meta http-equiv=refresh` and equivalent navigation directives;
- publisher CSP/meta security headers that conflict with the application policy;
- executable/plugin-specific attributes and obsolete browser behaviors;
- `javascript:`, `vbscript:`, `file:`, arbitrary `blob:`, and unsafe `data:` URLs;
- automatic form submission and external form actions;
- resource hints that initiate network activity, including external preload/prefetch/preconnect/DNS-prefetch.

Unsupported scripted/interactivity properties are recorded in the import report.

### Forms and controls

P0 does not support interactive publisher forms. Remove form submission behavior and disable/remove controls while preserving useful labels and textual fallback where possible. `form-action 'none'` remains enabled in CSP as defense in depth.

### Preserve when safe

Preserve semantic structure and accessibility metadata where they do not create active behavior:

- headings, paragraphs, lists, tables, figures, captions, code, blockquotes;
- EPUB footnote/noteref semantics;
- language, direction, ARIA labels/relationships, and IDs after uniqueness validation;
- ruby and MathML fallback;
- links after URL classification;
- local publication images/media/styles/fonts resolved through the allowlist.

Sanitization must not flatten the document into plain text.

### Base URL

Ignore publisher-controlled `base` elements for security decisions. Resolution uses the canonical manifest/OPF base known by the backend. Remove or replace `base` in render output so it cannot redirect relative resource resolution.

## URL policy

Every URL-bearing HTML/SVG/CSS attribute is classified with the same canonical publication resolver.

### Allowed automatic loads

- canonical relative resources present in the current publication allowlist;
- internally generated/revocable Blob URLs created by the trusted renderer from those resources;
- fragment-only references within the sanitized document;
- tightly constrained raster image data URLs only if a future test-backed requirement approves them.

Source-authored Blob URLs are never accepted. P0 should reject source-authored data URLs by default; any exception must be media-type specific, size bounded, decoded, and sanitized before use. SVG/HTML data URLs are not an acceptable shortcut.

### External hyperlinks

HTTP, HTTPS, and mailto links may be exposed as user-initiated external navigation. They are never loaded inside the publication frame.

- intercept the click in the Reader/foliate bridge;
- require a real user action;
- normalize and validate the scheme;
- ignore publisher `target`, `download`, opener, and window features;
- pass the validated URL to the Tauri shell-open capability;
- reject JavaScript, data, file, Blob, custom, malformed, and relative-outside-publication URLs;
- provide a confirmation/interstitial if product policy later requires host disclosure.

External-link failure is visible and recoverable. Reader does not navigate the application WebView to the publisher URL.

### External subresources

Remote images, fonts, styles, media, frames, scripts, CSS imports, and fetch/XHR/WebSocket targets are blocked. Reader does not silently fetch them during core reading.

A future explicit “fetch remote publication resource” feature would require a separate ADR, user consent, privacy UI, bounded backend fetch, content validation, caching policy, and import-report provenance. It is not part of P0.

## CSS policy

CSS must be parsed, not filtered with URL regex alone.

- Resolve every `url()` and `@import` through the publication allowlist.
- Block all remote imports/resources and source-authored Blob/file/data URLs unless an explicitly approved media exception applies.
- Remove legacy executable constructs such as `expression`, bindings/behaviors, and scriptable URL schemes.
- Bound stylesheet bytes, import depth, rule count, selector complexity, font count/size, and recursive references to mitigate denial of service.
- Preserve safe publisher layout/typography for Publisher mode.
- Apply Reader accessibility/theme overrides through a later controlled stylesheet layer, not by rewriting the canonical source.
- Do not allow publication CSS to style the application shell.

CSS parser failures produce a diagnostic and a safe degraded stylesheet strategy; they never fall back to unfiltered CSS.

## SVG and MathML policy

SVG is active document content, not just an image format.

- remove scripts and event handlers;
- remove/neutralize external references, foreign content, navigation, and unsafe animation links;
- resolve local image/font/style references through the allowlist;
- disallow SVG `foreignObject` in the P0 profile unless a future sanitizer can recursively apply the XHTML policy;
- apply size/element/reference limits;
- sanitize inline and standalone SVG consistently.

Preserve safe shapes, text, accessibility labels, and local references. MathML is preserved when parsed safely; embedded links/resources use the same URL policy.

## Manifest and media policy

- Do not trust manifest MIME declarations without inspecting expected parser context.
- Script media types and EPUB `scripted` properties generate unsupported-content diagnostics.
- The foliate loader denies manifest resources classified as script before bytes are requested.
- Unknown/unsupported active media types are not rendered through a generic HTML fallback.
- Encryption/DRM is handled explicitly: unsupported DRM is refused with a diagnostic; it is not bypassed.
- Font obfuscation support, if implemented, operates on allowlisted font bytes and does not broaden script/network policy.

## CSP baseline

Production CSP remains mandatory and deny-oriented. At minimum it must enforce the equivalent of:

- scripts only from Reader-owned application sources; no publisher inline/eval/blob/data/remote scripts;
- remote publication image/font/media/frame sources blocked;
- `object-src 'none'`;
- `form-action 'none'`;
- constrained `base-uri` and frame ancestry;
- explicit audited `connect-src` origins for application-shell needs rather than broad `https:`;
- only required Blob/frame/worker sources for Reader-owned rendering/runtime behavior;
- Tauri IPC and controlled asset protocol origins explicitly listed.

Tauri's generated hashes/nonces may augment application assets. `unsafe-eval` must not be added to accommodate a publication. Any application dependency requiring weaker script policy is a release blocker or must be isolated/replaced.

Because the shell and Blob publication documents may inherit policy differently across engines, CSP configuration tests are necessary but not sufficient. Real WKWebView, WebView2, and WebKitGTK probes remain release gates.

## Iframe and origin policy

- Publication documents render in foliate-owned iframe/document contexts, never directly in the React shell DOM.
- Publisher CSS cannot escape into the shell.
- The iframe sandbox is retained, but `allow-scripts` required by WebKit is not treated as permission for publisher script execution; CSP and sanitization remain authoritative.
- Publication code receives no Tauri globals/capability bridge.
- If a future custom protocol or distinct origin can strengthen publication isolation, it may supersede the Blob transport only after preserving locator/resource behavior.

## Tauri capability policy

- Frontend publication code opens only an opaque session by database `documentId`.
- Rust owns source/archive paths and resource handles.
- Asset protocol static scope stays limited to app-private directories; exact legacy PDF/model paths are restored by trusted backend logic.
- Publication rendering must not require broad filesystem scope.
- Shell-open accepts only Reader-validated user-initiated HTTP(S)/mailto URLs.
- No generic filesystem, shell command, HTTP, process, clipboard, or dialog capability is exposed to publication content.

## Diagnostics and user experience

Security degradation is visible without alarming users unnecessarily.

Suggested stable diagnostic codes include:

- `publication.active_content_removed`;
- `publication.remote_resource_blocked`;
- `publication.unsafe_url_removed`;
- `publication.frame_content_removed`;
- `publication.form_disabled`;
- `publication.stylesheet_degraded`;
- `publication.svg_content_removed`;
- `publication.content_refused`.

Diagnostics identify publication href/media type and policy action but must not include secrets or unlimited attacker-controlled content. UI groups repeated findings and distinguishes “book remains readable” from “resource refused.”

## Security evidence

### Automated layers

- ZIP safety and bounded extraction tests;
- URI canonicalization and external/traversal rejection;
- sanitizer unit tests for malformed/adversarial XHTML, CSS, and SVG;
- manifest script loader denial;
- external-link scheme allowlist tests;
- production CSP/asset-scope configuration tests;
- fixture registry hashes/licenses/expected blocked outcomes;
- command/session isolation tests.

### Real WebView layers

The active-content fixture must verify on every supported WebView:

- manifest/inline scripts and event handlers do not execute;
- JavaScript/data/file links cannot reach shell-open;
- remote fetch/image/CSS/font/media/frame/form requests do not leave the publication;
- CSP applies to Blob publication documents;
- safe local CSS/images/fonts/SVG continue to render;
- security failures do not expose Tauri IPC or crash the reader.

Resource Timing observation is useful but not packet-level proof. A local request collector or platform network instrumentation should confirm zero outgoing probes before production acceptance.

## Alternatives considered

### CSP only

Rejected. CSP implementation/inheritance differs across WebViews, the app shell needs some network/Blob capabilities, and parser/render bugs may expose unexpected contexts.

### Sanitization only

Rejected. Sanitizers can regress or miss browser-specific active behavior. CSP, scoped resources, capabilities, and loader denial remain required.

### Iframe sandbox only

Rejected. foliate-js documents the WebKit requirement for `allow-scripts`, and same-origin Blob behavior prevents treating sandboxing as sufficient.

### Trust imported/local books

Rejected. Local files can be malicious, downloaded, forwarded, or modified. Local-first does not imply trusted content.

### Flatten XHTML to plain text

Rejected. It removes the attack surface by destroying the publication, violating content fidelity and the V2 dual-track architecture.

### Fetch remote resources automatically

Rejected for P0 due to tracking, privacy, availability, content-validation, and reproducibility risks.

## Consequences

### Positive

- Publisher content cannot directly execute script or access filesystem/network capabilities.
- Original bytes remain available for deterministic reprocessing and diagnostics.
- Safe EPUB structure and local resources remain renderable.
- Security actions are versioned and observable.
- CSP, sanitizer, resolver, session, and Tauri capabilities provide defense in depth.

### Negative and risks

- Sanitization can change publisher layout or remove interactive textbook content.
- A robust DOM/CSS/SVG sanitizer is significant implementation work.
- Policy changes can alter DOM structure and require locator re-anchoring.
- Shared app/publication CSP remains less isolated than a separate publication origin.
- Cross-platform WebView evidence is expensive and cannot currently be fully automated on macOS.
- Restrictive CSP may expose incompatible application dependencies such as eval-based runtimes.

## Implementation status

Already implemented:

- ZIP safety limits and publication resource allowlist;
- opaque document-bound sessions and no frontend source paths;
- restrictive CSP/asset-scope configuration baseline;
- foliate manifest script denial;
- HTTP(S)/mailto external-link allowlist;
- active-content fixture and runtime execution/resource-timing probe;
- stable resource/security error codes for the current command boundary.

Still required:

- parser-based, policy-versioned XHTML/CSS/SVG sanitizer;
- formal manifest media classification/import diagnostics;
- safe degraded rendering and user-visible import report;
- local network request collector evidence;
- macOS/Windows/Linux WebView matrix;
- sanitizer/locator integration and policy migration tests;
- decision on distinct publication origin/custom protocol if Blob isolation is insufficient.

## Acceptance criteria

- No publisher script/event handler executes in supported WebViews.
- No automatic external publication resource request leaves the app.
- Publication content cannot invoke Tauri capabilities.
- Safe local XHTML/CSS/image/font/SVG fixtures remain readable.
- Sanitizer failures are fail-closed and diagnostic, never raw fallback.
- Sanitization is deterministic for source hash + policy version.
- Locator restoration/re-anchoring remains within ADR-003 tolerances after policy processing.
- V1 PDF/local model functionality does not require broad asset scope.
- Security evidence is recorded for WKWebView, WebView2, and WebKitGTK before default enablement.

## Evidence

- [Reader V2 refactor plan](../plans/2026-08-19-reader-v2-refactor-plan.md)
- [ADR-001: EPUB rendering engine](001-epub-rendering-engine.md)
- [ADR-002: publication resource storage](002-publication-resource-storage.md)
- [ADR-003: publication locator and re-anchoring](003-publication-locator-and-reanchoring.md)
- [foliate-js spike report](../spikes/foliate-js.md)
- [EPUB security probe protocol](../development/epub-security-probe.md)
- [EPUB fixture registry](../../tests/fixtures/epub/README.md)
- `src-tauri/tauri.conf.json`
- `src-tauri/src/publication/archive.rs`
- `src-tauri/src/publication/resources.rs`
- `src-tauri/src/security.rs`
- `src/features/reader/foliate/TauriEpubBookSession.ts`
- `src/features/reader/foliate/foliateModel.ts`
