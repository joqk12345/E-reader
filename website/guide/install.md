# Installation

## Download prebuilt app

Use releases from GitHub:

- [Reader Releases](https://github.com/joqk12345/reader/releases)

## Build from source

### Prerequisites

- Node.js 22+
- Rust stable
- Platform build dependencies for Tauri

### Steps

```bash
npm ci
npm run tauri build
```

For public macOS distribution, building a `.dmg` is not enough. The app bundle inside the DMG must be signed with a `Developer ID Application` certificate and notarized by Apple, or Gatekeeper will show:

> “Reader” is damaged and can’t be opened. You should move it to the Trash.

For local-only testing of your own build, launch the `.app` directly from `src-tauri/target/release/bundle/macos/` or remove the quarantine attribute after copying it to `/Applications`:

```bash
xattr -dr com.apple.quarantine /Applications/Reader.app
```

## Optional: Edge TTS

```bash
python3 -m pip install --user --break-system-packages edge-tts
```

If your network blocks Edge TTS, configure proxy in Reader settings.
