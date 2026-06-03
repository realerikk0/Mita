#!/usr/bin/env bash
set -euo pipefail

ASSETS_JSON="${RELEASE_ASSETS_JSON:-dist/release-assets.json}"
ASSETS_DIR="${RELEASE_ASSETS_DIR:-dist/release-assets}"
OUTPUT_JSON="${BAIDU_SHARE_JSON:-dist/baidu-share.json}"
REMOTE_ROOT="${BAIDU_REMOTE_ROOT:-/Mita/releases}"
SHARE_PASSWORD="${BAIDU_SHARE_PASSWORD:-mita}"
DRY_RUN_VALUE="${DRY_RUN:-false}"
BAIDUPCS_BIN="${BAIDUPCS_GO_BIN:-BaiduPCS-Go}"
KEEP_RELEASES="${BAIDU_KEEP_RELEASES:-2}"
RAW_ASSET_UPLOAD_VALUE="${BAIDU_UPLOAD_RAW_ASSETS:-true}"

is_true() {
  case "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" in
    1 | true | yes | y) return 0 ;;
    *) return 1 ;;
  esac
}

json_value() {
  local expr="$1"
  node -e "const fs = require('node:fs'); const data = JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); const value = ${expr}; if (value == null) process.exit(1); console.log(value)" "$ASSETS_JSON"
}

create_share_bundle() {
  local bundle_path="${ASSETS_DIR}/Mita_${TAG#v}_release_assets.zip"
  rm -f "$bundle_path"

  python3 - "$bundle_path" "${asset_paths[@]}" <<'PY'
import os
import sys
import zipfile

bundle_path, *asset_paths = sys.argv[1:]
with zipfile.ZipFile(bundle_path, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
    for asset_path in asset_paths:
        archive.write(asset_path, arcname=os.path.basename(asset_path))
PY

  printf '%s\n' "$bundle_path"
}

show_quota() {
  "$BAIDUPCS_BIN" quota || true
}

try_share_path() {
  local remote_path="$1"
  local share_output

  if ! share_output="$("$BAIDUPCS_BIN" share set --period=0 -p "$SHARE_PASSWORD" -f "$remote_path" 2>&1)"; then
    printf '%s\n' "$share_output"
    return 1
  fi

  printf '%s\n' "$share_output"
  share_url="$(printf '%s\n' "$share_output" | grep -Eo 'https?://[^[:space:]]+' | head -n 1 || true)"
  if [ -z "$share_url" ]; then
    return 1
  fi

  share_remote_path="$remote_path"
  return 0
}

upload_bundle_share() {
  echo "Creating a bundled Baidu download share at $SHARE_DIR" >&2
  bundle_path="$(create_share_bundle)"
  "$BAIDUPCS_BIN" mkdir "$SHARE_DIR" >/dev/null 2>&1 || true
  "$BAIDUPCS_BIN" upload --policy overwrite "$bundle_path" "$SHARE_DIR"

  if ! try_share_path "$SHARE_DIR"; then
    bundle_remote_path="${SHARE_DIR%/}/$(basename "$bundle_path")"
    echo "Baidu download directory share failed; trying bundle file directly at $bundle_remote_path" >&2
    try_share_path "$bundle_remote_path" || true
  fi
}

prune_old_release_dirs() {
  if ! [[ "$KEEP_RELEASES" =~ ^[0-9]+$ ]]; then
    echo "Skipping Baidu release cleanup: BAIDU_KEEP_RELEASES must be a non-negative integer, got '$KEEP_RELEASES'"
    return
  fi

  local releases_root="${REMOTE_ROOT%/}"
  local list_output
  list_output="$("$BAIDUPCS_BIN" ls "$releases_root" 2>/dev/null || true)"
  if [ -z "$list_output" ]; then
    echo "No existing Baidu release directories found under $releases_root"
    return
  fi

  local release_tags=()
  while IFS= read -r tag; do
    release_tags+=("$tag")
  done < <(printf '%s\n' "$list_output" | grep -Eo 'v[0-9]+\.[0-9]+\.[0-9]+' | sort -Vu)

  if [ "${#release_tags[@]}" -le "$KEEP_RELEASES" ]; then
    echo "Baidu release cleanup skipped: ${#release_tags[@]} release directories, keeping $KEEP_RELEASES"
    return
  fi

  local prune_count=$(( ${#release_tags[@]} - KEEP_RELEASES ))
  echo "Pruning $prune_count old Baidu release directories under $releases_root; keeping newest $KEEP_RELEASES"
  for ((i = 0; i < prune_count; i++)); do
    local tag="${release_tags[$i]}"
    local remote_path="${releases_root}/${tag}"
    if [ "$remote_path" = "$REMOTE_DIR" ]; then
      echo "Skipping current release directory during cleanup: $remote_path"
      continue
    fi
    echo "Removing old Baidu release directory: $remote_path"
    "$BAIDUPCS_BIN" rm "$remote_path" || true
  done
}

if [ ! -f "$ASSETS_JSON" ]; then
  echo "Release asset manifest is missing: $ASSETS_JSON" >&2
  exit 1
fi

TAG="$(json_value 'data.tagName')"
REMOTE_DIR="${REMOTE_ROOT%/}/${TAG}"
SHARE_DIR="${REMOTE_ROOT%/}/${TAG}-download"

asset_paths=()
while IFS= read -r asset_name; do
  asset_path="${ASSETS_DIR}/${asset_name}"
  if [ ! -f "$asset_path" ]; then
    echo "Downloaded release asset is missing: $asset_path" >&2
    exit 1
  fi
  asset_paths+=("$asset_path")
done < <(node -e "const fs = require('node:fs'); const data = JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); for (const asset of Object.values(data.assets)) console.log(asset.name)" "$ASSETS_JSON")

mkdir -p "$(dirname "$OUTPUT_JSON")"

if is_true "$DRY_RUN_VALUE"; then
  REMOTE_DIR="$REMOTE_DIR" SHARE_PASSWORD="$SHARE_PASSWORD" OUTPUT_JSON="$OUTPUT_JSON" node <<'NODE'
const fs = require('node:fs')

const share = {
  dryRun: true,
  url: 'https://pan.baidu.com/s/DRY_RUN',
  password: process.env.SHARE_PASSWORD || 'mita',
  remotePath: process.env.REMOTE_DIR,
}

fs.writeFileSync(process.env.OUTPUT_JSON, `${JSON.stringify(share, null, 2)}\n`)
console.log(`Dry run: wrote Baidu share placeholder to ${process.env.OUTPUT_JSON}`)
NODE
  exit 0
fi

if ! command -v "$BAIDUPCS_BIN" >/dev/null 2>&1; then
  echo "BaiduPCS-Go binary was not found in PATH" >&2
  exit 1
fi

if [ -n "${BAIDUPCS_GO_COOKIES:-}" ]; then
  "$BAIDUPCS_BIN" login --cookies="${BAIDUPCS_GO_COOKIES}"
elif [ -n "${BAIDUPCS_GO_BDUSS:-}" ]; then
  login_args=(--bduss="${BAIDUPCS_GO_BDUSS}")
  if [ -n "${BAIDUPCS_GO_STOKEN:-}" ]; then
    login_args+=(--stoken="${BAIDUPCS_GO_STOKEN}")
  fi
  if [ -n "${BAIDUPCS_GO_PTOKEN:-}" ]; then
    login_args+=(--ptoken="${BAIDUPCS_GO_PTOKEN}")
  fi
  "$BAIDUPCS_BIN" login "${login_args[@]}"
else
  echo "BAIDUPCS_GO_COOKIES or BAIDUPCS_GO_BDUSS is required when DRY_RUN is false" >&2
  exit 1
fi

show_quota
prune_old_release_dirs
show_quota

share_url=""
share_remote_path="$REMOTE_DIR"
if is_true "$RAW_ASSET_UPLOAD_VALUE"; then
  "$BAIDUPCS_BIN" mkdir "$REMOTE_DIR" >/dev/null 2>&1 || true
  "$BAIDUPCS_BIN" upload --policy overwrite "${asset_paths[@]}" "$REMOTE_DIR"

  if ! try_share_path "$REMOTE_DIR"; then
    echo "Primary Baidu release directory share failed; falling back to a bundled download package" >&2
    upload_bundle_share
  fi
else
  echo "Skipping raw Baidu release asset upload; uploading bundled download share only" >&2
  upload_bundle_share
fi

if [ -z "$share_url" ]; then
  echo "BaiduPCS-Go did not return a share URL" >&2
  exit 1
fi

SHARE_URL="$share_url" SHARE_PASSWORD="$SHARE_PASSWORD" SHARE_REMOTE_PATH="$share_remote_path" OUTPUT_JSON="$OUTPUT_JSON" node <<'NODE'
const fs = require('node:fs')

const share = {
  dryRun: false,
  url: process.env.SHARE_URL,
  password: process.env.SHARE_PASSWORD || 'mita',
  remotePath: process.env.SHARE_REMOTE_PATH,
}

fs.writeFileSync(process.env.OUTPUT_JSON, `${JSON.stringify(share, null, 2)}\n`)
console.log(`Wrote Baidu share metadata to ${process.env.OUTPUT_JSON}`)
NODE
