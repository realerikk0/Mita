#!/usr/bin/env bash
set -euo pipefail

url="${1:-}"
is_nightly="${2:-false}"
repo_url="${3:-}"
repo_nightly="${4:-false}"
default_url="${5:-}"
default_nightly="${6:-false}"
if [ -z "$url" ]; then url="$repo_url"; is_nightly="$repo_nightly"; fi
if [ -z "$url" ]; then url="$default_url"; is_nightly="$default_nightly"; fi
[ -n "$url" ] || { echo "No Biyan installer URL was provided" >&2; exit 1; }

curl -fsSL --retry 5 "$url" -o /tmp/biyan-installer.deb
test -s /tmp/biyan-installer.deb
echo "BIYAN_APP_URL=$url" >> "$GITHUB_ENV"
echo "IS_NIGHTLY=$is_nightly" >> "$GITHUB_ENV"
