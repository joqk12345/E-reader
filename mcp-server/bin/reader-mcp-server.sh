#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_FILE="${READER_MCP_LAUNCHER_LOG:-/tmp/reader-mcp-launcher.log}"
NODE_BIN="${NODE_BIN:-}"

if [[ -z "$NODE_BIN" ]]; then
  if command -v node >/dev/null 2>&1; then
    NODE_BIN="$(command -v node)"
  elif [[ -x "/Users/mac/.nvm/versions/node/v22.18.0/bin/node" ]]; then
    NODE_BIN="/Users/mac/.nvm/versions/node/v22.18.0/bin/node"
  elif [[ -x "/opt/homebrew/bin/node" ]]; then
    NODE_BIN="/opt/homebrew/bin/node"
  else
    printf '[%s] node binary not found\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >>"$LOG_FILE" 2>/dev/null || true
    exit 127
  fi
fi

printf '[%s] launch node=%s script=%s\n' \
  "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$NODE_BIN" "$ROOT_DIR/src/cli.mjs" \
  >>"$LOG_FILE" 2>/dev/null || true

exec "$NODE_BIN" "$ROOT_DIR/src/cli.mjs" "$@"
