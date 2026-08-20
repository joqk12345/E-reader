# EPUB Publication Loader Performance Probe

The foliate spike can export measurements taken at the TypeScript/Tauri invoke boundary:

```bash
VITE_EPUB_ENGINE=foliate VITE_EPUB_PERF_PROBE=1 npm run tauri dev
```

Open an EPUB, wait for its first readable screen, navigate through representative chapters, and then close the reader. Reports are printed as `[Reader publication load metrics]` and saved under:

```text
reader:publication-load-metrics:<document-id>
```

Each report contains separate text and Blob counters:

- command request count;
- decoded payload bytes;
- optional missing-resource count;
- non-missing failure count;
- cumulative end-to-end invoke time in milliseconds;
- maximum single Blob payload size.

Record reports for at least a 10MB EPUB, a 50MB EPUB, and an image-heavy EPUB. Capture OS/WebView version, cold/warm status, time to first readable screen, process memory, and Reader commit alongside the JSON report.

## Interpretation limits

- Timing begins immediately before `invoke` and ends after DTO validation and byte conversion. It includes backend command execution, Tauri serialization/deserialization, and frontend conversion, but does not isolate each stage.
- `bytes` is decoded payload size, not JSON/wire size. A `Vec<u8>` may have materially larger transport overhead.
- The counters do not measure renderer layout, Blob URL creation, image decode, memory retention, or frame rendering.
- Unit tests validate accounting behavior only; they are not IPC benchmarks.

Do not choose JSON arrays, streaming, a custom protocol, or controlled temporary URLs solely from unit measurements. Use the real WebView reports and process-memory evidence first.
