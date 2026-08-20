# ADR-002: Store an immutable validated publication archive and read resources on demand

- Status: **Accepted as the V2 storage target; current source-path implementation is transitional**
- Date: 2026-08-20
- Decision owners: Reader V2 maintainers

## Context

Reader must render original EPUB XHTML, CSS, images, fonts, SVG, and package/navigation files without flattening them into paragraphs. The renderer needs random access to publication resources, while the WebView must not receive arbitrary filesystem paths or broad asset-protocol access.

The Phase 0 implementation currently opens the EPUB path stored on the V1 `documents` row. It validates ZIP metadata, builds a publication allowlist, and reads individual entries through an opaque session. This proves the loader boundary, but it is not a durable storage model:

- the user may move, replace, or delete the original file;
- a path may later point to different bytes;
- migration and backup cannot rely on an external source remaining available;
- opening directly from arbitrary source locations complicates sandboxing and diagnostics.

At the same time, eagerly extracting every EPUB into application data would create many files, increase import cost and cleanup complexity, and widen the filesystem surface without proving a rendering benefit.

## Decision

For V2 imports, Reader will keep an **immutable, validated copy of the canonical EPUB archive in application data** and read individual ZIP entries on demand.

```text
user-selected source (read-only)
  -> bounded streaming copy + SHA-256
  -> ZIP safety validation
  -> atomic publish into app data by content hash
  -> transactional publication metadata commit
  -> opaque read session
  -> allowlisted random-access ZIP entry reads
  -> TauriPublicationLoader
```

The original user file remains untouched. It is import input, not the production rendering source.

### Canonical archive layout

The intended logical layout is:

```text
$APPDATA/publications/sha256/<first-two-hash-chars>/<sha256>.epub
```

The exact directory spelling may change during implementation, but these invariants may not:

- the filename is derived from the verified content hash, not user input;
- the stored archive is immutable after publication;
- two imports with identical bytes may share the same archive object;
- database rows refer to a controlled archive object and its hash, never a frontend-supplied path;
- temporary copies are not visible as committed publications.

### Import and commit protocol

1. Open the selected source read-only.
2. Stream it to a uniquely named temporary file under the target application-data filesystem while computing SHA-256 and enforcing a compressed-file size budget.
3. Rewind/open the temporary file and run ZIP safety validation before parsing or publication.
4. Parse package/navigation metadata and produce diagnostics without mutating the original.
5. Atomically rename the validated temporary file to its content-addressed destination. If that hash already exists, verify it is a regular file with the expected size/hash and reuse it.
6. Commit publication, resource, spine, navigation, and import-report rows in one database transaction.
7. On any failure, roll back database changes and remove only the uncommitted temporary file. Never delete the user's source.

A crash-recovery task may remove stale temporary files after a conservative age threshold. It must not delete referenced archive objects.

### Runtime access

- Rust owns archive paths, file handles, ZIP parsing, limits, and resource allowlists.
- The frontend opens a publication by database identity and receives only an opaque UUID session plus scoped metadata such as the resource-size index.
- `loadText`, `loadBlob`, and `getSize` resolve canonical publication hrefs before reading an entry.
- Resources are decompressed only when requested. Reader does not hold the entire uncompressed publication in WebView or Rust memory.
- Session closure releases file handles and invalidates subsequent requests.
- Separate publications cannot resolve each other's resources, even when entry names are identical.

### Derived data and caches

The immutable archive is canonical for faithful rendering. The following are derived and rebuildable:

- parsed manifest/spine/navigation rows;
- semantic content blocks and search/embedding indexes;
- generated covers/thumbnails;
- decompressed hot-resource caches;
- compatibility and import reports, except user-visible diagnostic history retained by policy.

Large derived binary caches belong under application cache, not beside canonical archives. Cache loss must not make a publication unreadable.

### Integrity

- Store source SHA-256 and compressed byte size on the publication/archive record.
- Verify the hash during import and whenever an existing content-addressed object is unexpectedly inconsistent.
- A later background scrub may re-hash archives, but opening every book must not require a full-file hash pass.
- ZIP entry reads remain bounded by the validated archive limits and verify actual decompressed bytes against declared entry size.
- Do not trust filename extensions or manifest MIME values as security boundaries.

### Deletion and garbage collection

Deleting a document removes its publication rows transactionally but removes the canonical archive only when no publication references that hash.

Archive garbage collection must:

- derive reachability from committed database rows;
- avoid following symlinks;
- operate only inside the controlled publication root;
- tolerate interruption and be idempotent;
- report conflicts/corruption instead of deleting ambiguous files.

A shared archive is never removed while another publication references it. Backups and active migration snapshots count as references according to their retention policy.

## Blob transport decision

The current `publication_load_blob_v2` returns `Vec<u8>` through Tauri IPC. This remains acceptable for the Phase 0 spike because reads are bounded and observable, but it is **not yet selected as the permanent large-resource transport**.

Use real WebView measurements before choosing among:

1. bounded `Vec<u8>` IPC for small/normal resources;
2. chunked/streamed commands for large resources;
3. a publication-scoped custom protocol;
4. controlled temporary URLs with explicit lifetime and revocation.

Any replacement must preserve document identity, publication allowlists, CSP, session revocation, and cross-publication isolation. Performance is not grounds for reintroducing broad asset scope.

## Alternatives considered

### Read directly from the user's original archive

This is the current transition path and avoids duplicate storage. It is rejected as the production model because availability and integrity depend on an external mutable path. It remains useful as migration input and V1 fallback until controlled-copy import is implemented.

### Eagerly extract every resource into an application-data directory

This simplifies conventional URL serving but multiplies files, increases import and cleanup work, exposes path/collision edge cases, and consumes space before resources are used. It is rejected as the default canonical representation. Selective derived caches remain allowed when evidence justifies them.

### Store every resource as a database BLOB

This provides transactional metadata/resource coupling but would make large binary I/O, database growth, backup, and incremental cleanup more expensive. It is rejected for canonical publication bytes. Small metadata and semantic content remain appropriate for SQLite.

### Content-address every individual resource

Per-resource deduplication can reduce repeated font/image storage across books, but requires full extraction, MIME/integrity metadata, reference counting, and more complex import transactions. It is deferred until corpus measurements show archive-level deduplication is insufficient.

## Consequences

### Positive

- Reading remains stable if the original file is moved or deleted.
- Rendering bytes are immutable and tied to a recorded hash.
- Random-access loading preserves local-first behavior without eager extraction.
- The WebView never needs a source filesystem path.
- Archive-level deduplication is simple and compatible with backup/migration.
- Derived indexes can be rebuilt from a canonical source.

### Negative and risks

- Import duplicates source bytes unless another identical archive already exists.
- Application data and backup sizes increase.
- ZIP random access and Tauri Blob transport may become performance bottlenecks.
- Atomic rename requires the temporary file and final archive to use the same filesystem.
- Reference counting/garbage collection must be correct before automatic deletion is enabled.
- Existing V1 documents require controlled re-import and cannot be silently switched if their source is missing.

## Migration and rollback

- Add V2 publication/archive tables; do not repurpose or drop V1 document paths.
- Re-import from the original source only when it still exists and passes validation.
- A failed V2 import retains all V1 rows and the original file.
- Feature flags can return rendering to V1 while the immutable archive remains available.
- Before schema migration, create a versioned database backup; archive publication and database commit must be recoverable independently.
- Missing V1 source files produce a visible migration report, not deletion or an empty publication.

## Implementation status

Already implemented for the transition path:

- ZIP path, symlink, duplicate, entry-count, size, total-size, and compression-ratio validation;
- publication-scoped canonical href resolution and external-resource blocking;
- bounded on-demand ZIP text/Blob reads and size checks;
- opaque UUID sessions opened from database `documentId`;
- frontend loader/session lifecycle and invoke-boundary metrics.

Still required for this ADR to be fully realized:

- controlled streaming copy and SHA-256 archive object;
- atomic publication/archive database transaction;
- V2 publication/resource/spine/navigation schema;
- reference-aware deletion and garbage collection;
- backup, recovery, and V1 migration behavior;
- WebView performance evidence and final Blob transport choice.

## Acceptance criteria

- Moving/deleting the original after successful V2 import does not break reading.
- Re-importing identical bytes reuses one validated archive object without corrupting references.
- Import failure leaves no committed publication and never modifies the source.
- A publication cannot read an unknown, external, traversal, or other-publication resource.
- Deleting one of two references does not remove the shared archive.
- Cache deletion does not affect core reading.
- Backup/restore retains database-to-archive integrity.
- Performance meets the approved first-screen, navigation, memory, and IPC budgets.

## Evidence

- [Reader V2 refactor plan](../plans/2026-08-19-reader-v2-refactor-plan.md)
- [ADR-001: EPUB rendering engine](001-epub-rendering-engine.md)
- [foliate-js spike report](../spikes/foliate-js.md)
- [EPUB performance probe](../development/epub-performance-probe.md)
- `src-tauri/src/publication/archive.rs`
- `src-tauri/src/publication/resources.rs`
- `src-tauri/src/publication/store.rs`
- `src-tauri/src/publication/sessions.rs`
