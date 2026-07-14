#!/usr/bin/env bash
set -euo pipefail

biyan_app_path="${1:-${BIYAN_APP_PATH:-}}"
process_name="${2:-${BIYAN_PROCESS_NAME:-}}"
rp_token="${3:-${RP_TOKEN:-}}"
args=(main.py --enable-reportportal --rp-token "$rp_token")
[ -z "$biyan_app_path" ] || args+=(--biyan-app-path "$biyan_app_path")
[ -z "$process_name" ] || args+=(--biyan-process-name "$process_name")
python "${args[@]}"
