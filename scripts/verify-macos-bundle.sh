#!/bin/bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <bundle-dir>" >&2
  exit 1
fi

bundle_dir="$1"
macos_dir="$bundle_dir/macos"
dmg_dir="$bundle_dir/dmg"

if [[ ! -d "$macos_dir" ]]; then
  echo "Missing macOS bundle directory: $macos_dir" >&2
  exit 1
fi

if [[ ! -d "$dmg_dir" ]]; then
  echo "Missing DMG bundle directory: $dmg_dir" >&2
  exit 1
fi

app_path="$(find "$macos_dir" -maxdepth 1 -type d -name '*.app' -print -quit)"
dmg_path="$(find "$dmg_dir" -maxdepth 1 -type f -name '*.dmg' -print -quit)"

if [[ -z "$app_path" ]]; then
  echo "No .app found under $macos_dir" >&2
  exit 1
fi

if [[ -z "$dmg_path" ]]; then
  echo "No .dmg found under $dmg_dir" >&2
  exit 1
fi

echo "Verifying app bundle: $app_path"
codesign --verify --deep --strict --verbose=2 "$app_path"
spctl -a -vv "$app_path"

echo "Verifying DMG: $dmg_path"
spctl -a -vv -t open --context context:primary-signature "$dmg_path"
