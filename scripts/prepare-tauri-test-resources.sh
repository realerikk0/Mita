#!/usr/bin/env bash
set -euo pipefail

# Tauri validates bundled resources and external binaries at compile time.
# CI test jobs do not need the real runtime payloads, but the paths must exist.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RESOURCE_DIR="$ROOT_DIR/src-tauri/resources"
BIN_DIR="$RESOURCE_DIR/bin"
TRIPLE="${TAURI_TEST_TARGET_TRIPLE:-}"

if [ -z "$TRIPLE" ] && command -v rustc >/dev/null 2>&1; then
  TRIPLE="$(rustc -vV | awk '/^host:/ { print $2 }')"
fi

ensure_file() {
  local path="$1"
  mkdir -p "$(dirname "$path")"
  [ -f "$path" ] || : > "$path"
}

ensure_executable() {
  ensure_file "$1"
  chmod +x "$1" 2>/dev/null || true
}

ensure_file "$RESOURCE_DIR/LICENSE"
ensure_executable "$BIN_DIR/mita-cli"
ensure_executable "$BIN_DIR/mita-cli.exe"
ensure_executable "$BIN_DIR/jan-cli"
ensure_executable "$BIN_DIR/mita-web-research-mcp.mjs"

for path in \
  "$RESOURCE_DIR/pre-install/.gitkeep" \
  "$RESOURCE_DIR/embedding-models/.gitkeep" \
  "$RESOURCE_DIR/ms-playwright/.gitkeep" \
  "$RESOURCE_DIR/node_modules/playwright/.gitkeep" \
  "$RESOURCE_DIR/node_modules/playwright-core/.gitkeep" \
  "$RESOURCE_DIR/computer-agent-runner/.gitkeep"; do
  ensure_file "$path"
done

if [ -n "$TRIPLE" ]; then
  for bin in uv bun; do
    ensure_executable "$BIN_DIR/${bin}-${TRIPLE}"
    ensure_executable "$BIN_DIR/${bin}-${TRIPLE}.exe"
  done
fi

for icon in 32x32.png 128x128.png 128x128@2x.png icon.icns icon.ico; do
  icon_path="$ROOT_DIR/src-tauri/icons/$icon"
  if [ ! -f "$icon_path" ]; then
    cp "$ROOT_DIR/src-tauri/icons/icon.png" "$icon_path"
  fi
done
