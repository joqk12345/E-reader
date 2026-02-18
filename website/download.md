# Download Reader

<style>
.download-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin: 1rem 0 1.25rem;
}

.download-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  padding: 0.65rem 0.95rem;
  font-weight: 600;
  text-decoration: none;
  border: 1px solid var(--vp-c-divider);
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg-soft);
}

.download-btn:hover {
  color: #fff;
  background: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
}
</style>

Get the latest Reader build for your platform.

<div class="download-actions">
  <a class="download-btn" href="https://github.com/joqk12345/E-reader/releases" target="_blank" rel="noreferrer">Download from GitHub Releases</a>
  <a class="download-btn" href="https://github.com/joqk12345/E-reader" target="_blank" rel="noreferrer">View Source on GitHub</a>
</div>

## macOS (Homebrew)

```bash
brew tap joqk12345/tap
brew list --cask reader >/dev/null 2>&1 && brew upgrade --cask reader || brew install --cask --adopt reader
```

## Manual Installation

1. Open [Reader Releases](https://github.com/joqk12345/E-reader/releases).
2. Download the package for your OS:
   - macOS: `.dmg` (Intel / Apple Silicon)
   - Linux: `.deb` or `.AppImage`
   - Windows: `.msi` or `.exe`
3. Install and launch Reader.

## System Requirements

- macOS 12+ (recommended)
- Windows 10+ or modern Linux desktop
- 200 MB available disk space

## Build from Source

```bash
git clone https://github.com/joqk12345/E-reader.git
cd E-reader
npm install
npm run tauri build
```

Need setup details? See [Installation Guide](/guide/install).
