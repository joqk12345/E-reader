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

## Optional: Edge TTS

```bash
python3 -m pip install --user --break-system-packages edge-tts
```

If your network blocks Edge TTS, configure proxy in Reader settings.
