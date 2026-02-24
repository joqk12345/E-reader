#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

TAURI_VERSION="$(
  awk '
    BEGIN { in_pkg = 0 }
    /^\[\[package\]\]$/ { in_pkg = 0; next }
    /^name = "tauri"$/ { in_pkg = 1; next }
    in_pkg && /^version = "/ {
      gsub(/^version = "/, "", $0)
      gsub(/"$/, "", $0)
      print
      exit
    }
  ' src-tauri/Cargo.lock
)"

if [[ -z "${TAURI_VERSION}" ]]; then
  echo "Failed to resolve tauri crate version from src-tauri/Cargo.lock" >&2
  exit 1
fi

IFS='.' read -r TAURI_MAJOR TAURI_MINOR _ <<< "${TAURI_VERSION}"
if [[ -z "${TAURI_MAJOR:-}" || -z "${TAURI_MINOR:-}" ]]; then
  echo "Unexpected tauri crate version format: ${TAURI_VERSION}" >&2
  exit 1
fi

TAURI_NPM_RANGE="^${TAURI_MAJOR}.${TAURI_MINOR}.0"
echo "Aligning @tauri-apps/api and @tauri-apps/cli to ${TAURI_NPM_RANGE} (from tauri ${TAURI_VERSION})"

if [[ "${ALIGN_TAURI_NPM_DRY_RUN:-}" == "1" ]]; then
  exit 0
fi

npm install --no-save "@tauri-apps/api@${TAURI_NPM_RANGE}" "@tauri-apps/cli@${TAURI_NPM_RANGE}"

INSTALLED_API_VERSION="$(
  node -p "try { require('./node_modules/@tauri-apps/api/package.json').version } catch (_) { '' }"
)"
INSTALLED_CLI_VERSION="$(
  node -p "try { require('./node_modules/@tauri-apps/cli/package.json').version } catch (_) { '' }"
)"

if [[ -z "${INSTALLED_API_VERSION}" || -z "${INSTALLED_CLI_VERSION}" ]]; then
  echo "Failed to resolve installed @tauri-apps/api or @tauri-apps/cli version" >&2
  exit 1
fi

IFS='.' read -r API_MAJOR API_MINOR _ <<< "${INSTALLED_API_VERSION}"
IFS='.' read -r CLI_MAJOR CLI_MINOR _ <<< "${INSTALLED_CLI_VERSION}"
if [[ "${API_MAJOR}" != "${TAURI_MAJOR}" || "${API_MINOR}" != "${TAURI_MINOR}" ]]; then
  echo "@tauri-apps/api version mismatch after alignment: ${INSTALLED_API_VERSION} (expected ${TAURI_MAJOR}.${TAURI_MINOR}.x)" >&2
  exit 1
fi
if [[ "${CLI_MAJOR}" != "${TAURI_MAJOR}" || "${CLI_MINOR}" != "${TAURI_MINOR}" ]]; then
  echo "@tauri-apps/cli version mismatch after alignment: ${INSTALLED_CLI_VERSION} (expected ${TAURI_MAJOR}.${TAURI_MINOR}.x)" >&2
  exit 1
fi

echo "Aligned npm packages: @tauri-apps/api ${INSTALLED_API_VERSION}, @tauri-apps/cli ${INSTALLED_CLI_VERSION}"
