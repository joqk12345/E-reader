#!/bin/bash
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Reader Release Script ===${NC}"
echo ""

# Check if version argument is provided
if [ -z "$1" ]; then
    echo -e "${RED}Error: Version number required${NC}"
    echo "Usage: ./scripts/release.sh <version>"
    echo "Example: ./scripts/release.sh 0.2.0"
    exit 1
fi

RAW_VERSION=$1
VERSION="${RAW_VERSION#v}"
VERSION_TAG="v$VERSION"
SEMVER_PATTERN='^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$'

if [[ ! "${VERSION}" =~ ${SEMVER_PATTERN} ]]; then
    echo -e "${RED}Error: Invalid semver version '${RAW_VERSION}'${NC}"
    echo "Examples: 0.4.6, 0.4.6-rc.1, 0.4.6+build.1"
    echo "You can also pass a prefixed tag like: v0.4.6"
    exit 1
fi

echo -e "${YELLOW}This will create release $VERSION_TAG${NC}"
echo ""

# Confirm with user
read -p "Do you want to continue? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Release cancelled"
    exit 1
fi

echo -e "${GREEN}Syncing version across release files...${NC}"
./scripts/sync-version.sh "$VERSION"

# Commit changes
echo -e "${GREEN}Committing version changes...${NC}"
git add package.json package-lock.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
if git diff --cached --quiet; then
    echo -e "${YELLOW}No version file changes to commit (already at $VERSION).${NC}"
else
    git commit -m "chore: bump version to $VERSION"
fi

# Create tag
echo -e "${GREEN}Creating git tag $VERSION_TAG...${NC}"
git tag -a "$VERSION_TAG" -m "Release $VERSION_TAG"

# Push to remote
echo -e "${GREEN}Pushing to remote...${NC}"
git push origin main
git push origin "$VERSION_TAG"

echo ""
echo -e "${GREEN}✓ Release $VERSION_TAG created successfully!${NC}"
echo ""
echo "GitHub Actions will now:"
echo "  1. Build the application for all platforms"
echo "  2. Create a draft release"
echo "  3. Upload the installers"
echo ""
echo "Check the progress at:"
echo "  https://github.com/joqk12345/E-reader/actions"
echo ""
echo "Once complete, publish the release at:"
echo "  https://github.com/joqk12345/E-reader/releases"
