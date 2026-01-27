#!/bin/bash
set -e

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

VERSION=$1
VERSION_TAG="v$VERSION"

echo -e "${YELLOW}This will create release $VERSION_TAG${NC}"
echo ""

# Confirm with user
read -p "Do you want to continue? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Release cancelled"
    exit 1
fi

# Update version in package.json
echo -e "${GREEN}Updating package.json...${NC}"
sed -i.bak "s/\"version\": \".*\"/\"version\": \"$VERSION\"/" package.json
rm -f package.json.bak

# Update version in tauri.conf.json
echo -e "${GREEN}Updating tauri.conf.json...${NC}"
sed -i.bak "s/\"version\": \".*\"/\"version\": \"$VERSION\"/" src-tauri/tauri.conf.json
rm -f src-tauri/tauri.conf.json.bak

# Commit changes
echo -e "${GREEN}Committing version changes...${NC}"
git add package.json src-tauri/tauri.conf.json
git commit -m "chore: bump version to $VERSION"

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
