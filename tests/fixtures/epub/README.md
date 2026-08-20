# Reader EPUB Fixtures

These deliberately small publications are compatibility evidence for Reader V2. Their metadata and SHA-256 digests are registered in `manifest.json`; validate them with:

```bash
npm run test:fixtures
```

| Fixture | Purpose |
|---|---|
| `minimal-epub3.epub` | EPUB 3 nav, nested TOC, XHTML structure, relative CSS, and SVG resource |
| `short-toc-epub2.epub` | EPUB 2 NCX with an intentional two-entry author TOC, guarding against the V1 `< 15` TOC heuristic |
| `active-content-epub3.epub` | EPUB 3 security probe containing manifest/inline scripts, an event handler, remote fetch/image/CSS/frame/form targets, and a `javascript:` link |

All fixtures were authored for this project and dedicated to the public domain under CC0-1.0. They contain no third-party text, fonts, or images. ZIP entries use a fixed `2020-01-01` timestamp; `mimetype` is the first entry and is stored without compression.

Security fixtures must register at least one `blocked:*` expectation. `active-content-epub3.epub` intentionally remains a structurally readable container: Rust tests preserve its attack probes as WebView evidence while proving that publication resource resolution rejects its remote URLs. Its CSP expectations remain expected outcomes—not proof of browser enforcement—until the fixture is exercised in each supported Tauri WebView.
