#!/usr/bin/env bash
set -euo pipefail

mount=/tmp/biyan-mount
mkdir -p "$mount"
hdiutil attach /tmp/biyan-installer.dmg -mountpoint "$mount" -nobrowse
trap 'hdiutil detach "$mount" >/dev/null 2>&1 || true' EXIT
app="$(find "$mount" -maxdepth 1 -type d -name 'Biyan*.app' -print -quit)"
[ -n "$app" ] || { echo "Biyan app not found in DMG" >&2; exit 1; }
rm -rf "/Applications/$(basename "$app")"
cp -R "$app" /Applications/
app_path="/Applications/$(basename "$app")/Contents/MacOS/$(basename "$app" .app)"
test -x "$app_path"
echo "BIYAN_APP_PATH=$app_path" >> "$GITHUB_ENV"
echo "BIYAN_PROCESS_NAME=$(basename "$app" .app)" >> "$GITHUB_ENV"
