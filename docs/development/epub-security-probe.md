# EPUB WebView Security Probe

`tests/fixtures/epub/active-content-epub3.epub` is an intentionally hostile EPUB 3 fixture. It contains manifest and inline scripts, an `onload` handler, remote fetch/image/CSS/frame/form probes, and a `javascript:` link.

## Run on a Tauri WebView

```bash
VITE_EPUB_ENGINE=foliate npm run tauri dev
```

1. Import `tests/fixtures/epub/active-content-epub3.epub` through the normal Library flow.
2. Open it with the flagged foliate reader and wait at least two seconds.
3. Confirm the reader subtitle says `security probe PASS`.
4. In the Web Inspector console, capture the `[Reader EPUB security probe]` object.
5. Capture the corresponding localStorage record. Its key is:

   ```text
   reader:security-probe:<document-id>:active-content-epub3
   ```

6. Record the OS, WebView version, Reader commit, result, and console CSP violations in the compatibility report.

A passing report requires all three execution markers to remain unset and no resource timing entry whose URL begins with `https://example.invalid`. `javascript:` is independently blocked by the app-shell external-link allowlist and unit test.

## Evidence limits

- The runtime report is real WebView observation, but absence from Resource Timing is not equivalent to packet-level proof that no request left the process.
- `example.invalid` also cannot prove CSP by DNS outcome alone. A future local request collector fixture should provide network-level confirmation.
- macOS WKWebView is not controllable by the available `safaridriver`; the current machine has no `tauri-driver`. Therefore this protocol is manual on macOS and must not be labelled automated E2E.
- A unit/configuration test passing does not check the WebView-specific CSP inheritance behavior of foliate-js blob documents.

Do not check the production security exit criterion until the probe has evidence for macOS WKWebView, Windows WebView2, and Linux WebKitGTK.
