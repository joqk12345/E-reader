# Release Guide

This document explains how to create releases for the Reader application.

## Automated Release Process

This project uses GitHub Actions for automated building and releasing.

### Creating a New Release

1. **Sync the version across all release files:**
   ```bash
   ./scripts/sync-version.sh 0.3.1
   ```

2. **Verify all version sources match:**
   ```bash
   ./scripts/check-version.sh 0.3.1
   ```

3. **Commit your changes:**
   ```bash
   git add .
   git commit -m "chore: bump version to 0.3.1"
   git push origin main
   ```

4. **Create and push a version tag:**
   ```bash
   git tag v0.3.1
   git push origin v0.3.1
   ```

5. **GitHub Actions will automatically:**
   - Build the application for multiple platforms (Linux, macOS, Windows)
   - Create a GitHub Release
   - Upload the built artifacts to the release

6. **Visit the releases page:**
   - Go to https://github.com/joqk12345/E-reader/releases
   - Review the draft release
   - Edit the release notes if needed
   - Publish the release

## Supported Platforms

The automated build process creates installers for:

- **Linux**: Debian package (.deb) and AppImage
- **macOS**: DMG installer (both Intel and Apple Silicon)
- **Windows**: MSI installer and NSIS setup executable

## Workflows

### CI Workflow (`.github/workflows/ci.yml`)

Runs on every push and pull request to:
- Check TypeScript compilation
- Run Rust tests
- Verify code formatting (rustfmt)
- Run linter (clippy)

### Release Workflow (`.github/workflows/release.yml`)

Triggers on version tags (e.g., `v0.3.1`) to:
- Build release binaries for all platforms
- Create a GitHub Release (as draft)
- Upload installers and bundles

### Homebrew Sync Workflow (`.github/workflows/update-homebrew.yml`)

Triggers when a release is published to:
- Fetch macOS `.dmg` assets for both Apple Silicon and Intel
- Calculate SHA256 checksums
- Update `Casks/reader.rb` in your tap repository (default: `<owner>/homebrew-tap`)
- Commit and push the updated cask

Required repository settings:
- Secret: `HOMEBREW_TAP_GITHUB_TOKEN` (PAT with write access to the tap repo)
- Optional variable: `HOMEBREW_TAP_REPO` (for custom tap repo, e.g. `joqk12345/homebrew-tap`)

## Manual Testing Before Release

Before pushing a release tag, you can test the build locally:

```bash
# Build for your current platform
npm run tauri build

# Test the generated application
# macOS:
open src-tauri/target/release/bundle/macos/reader.app

# Linux:
./src-tauri/target/release/bundle/appimage/reader_*.AppImage

# Windows:
.\src-tauri\target\release\bundle\nsis\reader_*.exe
```

## Version Naming

Follow semantic versioning:

- **Major version** (0.x.x): Breaking changes
- **Minor version** (x.1.x): New features
- **Patch version** (x.x.1): Bug fixes

Example tags:
- `v1.0.0` - First stable release
- `v1.1.0` - Added new features
- `v1.1.1` - Bug fix release

## Signing and Notarizing macOS Releases

`TAURI_PRIVATE_KEY` and `TAURI_KEY_PASSWORD` only sign Tauri updater artifacts. They do **not** satisfy macOS Gatekeeper for downloaded `.dmg` files.

If you publish a macOS DMG without Apple signing and notarization, users will see:

> “Reader” is damaged and can’t be opened. You should move it to the Trash.

To ship a public macOS DMG, add these GitHub secrets:

- `APPLE_CERTIFICATE`: Base64-encoded Developer ID Application certificate (`.p12`)
- `APPLE_CERTIFICATE_PASSWORD`: Password for that `.p12`
- `APPLE_ID`: Apple ID email used for notarization
- `APPLE_PASSWORD`: App-specific password for the Apple ID
- `APPLE_TEAM_ID`: Apple Developer Team ID
- `APPLE_SIGNING_IDENTITY`: Optional explicit identity name, for example `Developer ID Application: Your Name (TEAMID)`

Keep the updater signing secrets as well if you use Tauri's updater:

- `TAURI_PRIVATE_KEY`
- `TAURI_KEY_PASSWORD`

Typical setup:

1. Export your `Developer ID Application` certificate from Keychain Access as a `.p12`.
2. Base64-encode it and store the result in `APPLE_CERTIFICATE`.
3. Create an app-specific password for your Apple ID and store it in `APPLE_PASSWORD`.
4. Push a release tag again after the secrets are configured.

The release workflow now fails fast on macOS if the Apple signing secrets are missing, and it verifies the generated `.app` and `.dmg` before uploading release assets.

## Troubleshooting

### Build Failures

If the CI build fails:
1. Check the Actions tab in GitHub
2. Review the error logs
3. Test locally with the same Rust version: `rustc --version`

### Release Draft Issues

If the release draft has issues:
1. Go to the Releases page
2. Edit the draft release
3. Fix the description or delete and recreate the tag
4. Push the tag again to trigger a new build
