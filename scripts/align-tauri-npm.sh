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
