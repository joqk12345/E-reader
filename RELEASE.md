# Release Guide

This document explains how to create releases for the Reader application.

## Automated Release Process

This project uses GitHub Actions for automated building and releasing.

### Creating a New Release

1. **Update the version in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`:**
   ```bash
   # Update version from 0.3.0 to 0.3.1, for example
   ```

2. **Commit your changes:**
   ```bash
   git add .
   git commit -m "chore: bump version to 0.3.1"
   git push origin main
   ```

3. **Create and push a version tag:**
   ```bash
   git tag v0.3.1
   git push origin v0.3.1
   ```

4. **GitHub Actions will automatically:**
   - Build the application for multiple platforms (Linux, macOS, Windows)
   - Create a GitHub Release
   - Upload the built artifacts to the release

5. **Visit the releases page:**
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

## Signing the Application (Optional)

To sign your application, set up the following secrets in your GitHub repository:

- `TAURI_PRIVATE_KEY`: Your Tauri private key
- `TAURI_KEY_PASSWORD`: Your key password

Generate a key pair:
```bash
npm run tauri signer generate
```

Keep the private key secure and never commit it to the repository!

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
