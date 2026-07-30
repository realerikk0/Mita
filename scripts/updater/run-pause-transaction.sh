#!/usr/bin/env bash
set -Eeuo pipefail

: "${CLOUDFLARE_R2_ACCOUNT_ID:?}"
: "${CLOUDFLARE_R2_BUCKET:?}"
: "${CLOUDFLARE_API_TOKEN:?}"
: "${CLOUDFLARE_ZONE_ID:?}"
: "${ALIYUN_OSS_BUCKET:?}"
: "${ALIYUN_OSS_ENDPOINT:?}"
: "${ALIYUN_REGION:?}"
: "${POLICY_KEY:?}"
: "${LEGACY_ALIYUN_KEY:?}"
: "${LEGACY_R2_KEY:?}"
: "${LEGACY_ALIYUN_URL:?}"
: "${LEGACY_R2_URL:?}"
: "${DYNAMIC_UPDATER_BASE_URL:?}"
: "${OPEN_TRANSACTION_KEY:?}"
: "${EXPECTED_CURRENT:?}"
: "${BIYAN_SIGNING_KEY:?}"
: "${GITHUB_RUN_ID:?}"
: "${GITHUB_RUN_ATTEMPT:?}"

r2_endpoint="https://${CLOUDFLARE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
oss_endpoint="${ALIYUN_OSS_ENDPOINT#https://}"
oss_endpoint="https://${oss_endpoint#http://}"
transaction_id="${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
transaction_prefix="biyan/updater/transactions/${transaction_id}"
state_dir="dist/pause"
probe_dir="${state_dir}/probes"
journal="${state_dir}/legacy-pause-journal.json"

test "$POLICY_KEY" = "biyan/updater/stable/policy.json"
test "$OPEN_TRANSACTION_KEY" = "biyan/updater/transactions/open.json"
test "$LEGACY_ALIYUN_KEY" = "mita/latest.json"
test "$LEGACY_R2_KEY" = "mita/latest.json"
test "$LEGACY_ALIYUN_URL" = "https://static.mitapp.cn/mita/latest.json"
test "$LEGACY_R2_URL" = "https://updates.mita.so/mita/latest.json"
test "$DYNAMIC_UPDATER_BASE_URL" = "https://updates.mita.so/biyan/v1/stable"

assert_aws_conditional_capabilities() {
  local put_skeleton delete_skeleton
  put_skeleton="$(aws s3api put-object --generate-cli-skeleton input)"
  delete_skeleton="$(aws s3api delete-object --generate-cli-skeleton input)"
  jq -e 'has("IfMatch") and has("IfNoneMatch")' \
    <<<"$put_skeleton" >/dev/null || return 1
  jq -e 'has("IfMatch")' <<<"$delete_skeleton" >/dev/null || return 1
}

assert_aws_conditional_capabilities
mkdir -p "$probe_dir"

probe_r2() {
  local key="$1" name="$2" rc
  if aws s3api head-object --bucket "$CLOUDFLARE_R2_BUCKET" --key "$key" \
    --endpoint-url "$r2_endpoint" \
    >"${probe_dir}/${name}.stdout" 2>"${probe_dir}/${name}.stderr"; then
    rc=0
  else
    rc=$?
  fi
  node scripts/updater/promotion-transaction.mjs classify-probe \
    --provider r2 --key "$key" --exit-code "$rc" \
    --stdout "${probe_dir}/${name}.stdout" \
    --stderr "${probe_dir}/${name}.stderr" \
    --output "${probe_dir}/${name}.json"
}

probe_oss() {
  local key="$1" name="$2" rc
  if ossutil api head-object --bucket "$ALIYUN_OSS_BUCKET" --key "$key" \
    --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" \
    --output-format json --quiet \
    >"${probe_dir}/${name}.stdout" 2>"${probe_dir}/${name}.stderr"; then
    rc=0
  else
    rc=$?
  fi
  node scripts/updater/promotion-transaction.mjs classify-probe \
    --provider oss --key "$key" --exit-code "$rc" \
    --stdout "${probe_dir}/${name}.stdout" \
    --stderr "${probe_dir}/${name}.stderr" \
    --output "${probe_dir}/${name}.json"
}

download_r2() {
  local key="$1" output="$2" metadata="$3"
  aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" --key "$key" \
    --endpoint-url "$r2_endpoint" "$output" >"$metadata"
}

download_oss() {
  local key="$1" output="$2"
  ossutil cp "oss://${ALIYUN_OSS_BUCKET}/${key}" "$output" --force \
    --endpoint "$oss_endpoint" --region "$ALIYUN_REGION"
}

put_r2_json() {
  local file="$1" key="$2"
  aws s3api put-object --bucket "$CLOUDFLARE_R2_BUCKET" --key "$key" \
    --body "$file" --content-type application/json --cache-control no-store \
    --endpoint-url "$r2_endpoint" >/dev/null
}

put_oss_json() {
  local file="$1" key="$2" overwrite="$3"
  local args=(ossutil api put-object --bucket "$ALIYUN_OSS_BUCKET" --key "$key" \
    --body "file://${file}" --content-type application/json \
    --cache-control no-store --object-acl default \
    --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" \
    --output-format json --quiet)
  # OSS overwrites by default. Omit the flag for mutable journal state instead
  # of relying on ossutil to serialize an explicit boolean false header.
  if [[ "$overwrite" != true ]]; then args+=(--forbid-overwrite true); fi
  "${args[@]}" >/dev/null
}

publish_immutable_r2() {
  local file="$1" key="$2" name="$3"
  probe_r2 "$key" "$name"
  if jq -e '.state == "exists"' "${probe_dir}/${name}.json" >/dev/null; then
    :
  else
    jq -e '.state == "absent"' "${probe_dir}/${name}.json" >/dev/null
    aws s3api put-object --bucket "$CLOUDFLARE_R2_BUCKET" --key "$key" \
      --body "$file" --content-type application/json --cache-control no-store \
      --if-none-match '*' --endpoint-url "$r2_endpoint" >/dev/null
  fi
  download_r2 "$key" "${state_dir}/${name}.readback" \
    "${state_dir}/${name}.metadata.json"
  cmp "$file" "${state_dir}/${name}.readback"
  node scripts/updater/promotion-transaction.mjs backup-metadata-plan \
    --metadata "${state_dir}/${name}.metadata.json" \
    --output "${state_dir}/${name}.metadata-plan.json"
  jq -e '
    .contentType == "application/json"
    and .cacheControl == "no-store"
  ' "${state_dir}/${name}.metadata-plan.json" >/dev/null
}

publish_immutable_oss() {
  local file="$1" key="$2" name="$3"
  probe_oss "$key" "$name"
  if jq -e '.state == "exists"' "${probe_dir}/${name}.json" >/dev/null; then
    :
  else
    jq -e '.state == "absent"' "${probe_dir}/${name}.json" >/dev/null
    ossutil api put-object --bucket "$ALIYUN_OSS_BUCKET" --key "$key" \
      --body "file://${file}" --content-type application/json \
      --cache-control no-store --object-acl private --forbid-overwrite true \
      --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" \
      --output-format json --quiet >/dev/null
  fi
  download_oss "$key" "${state_dir}/${name}.readback"
  cmp "$file" "${state_dir}/${name}.readback"
  ossutil api head-object --bucket "$ALIYUN_OSS_BUCKET" --key "$key" \
    --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" \
    --output-format json --quiet >"${state_dir}/${name}.metadata.json"
  ossutil api get-object-acl --bucket "$ALIYUN_OSS_BUCKET" --key "$key" \
    --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" \
    --output-format json --quiet >"${state_dir}/${name}.acl.json"
  node scripts/updater/promotion-transaction.mjs backup-metadata-plan \
    --metadata "${state_dir}/${name}.metadata.json" \
    --output "${state_dir}/${name}.metadata-plan.json"
  jq -e '
    .contentType == "application/json"
    and .cacheControl == "no-store"
  ' "${state_dir}/${name}.metadata-plan.json" >/dev/null
  test "$(node scripts/updater/promotion-transaction.mjs extract-oss-acl \
    --acl "${state_dir}/${name}.acl.json")" = private
}

persist_journal() {
  (
    set -euo pipefail
    node scripts/updater/legacy-pause-transaction.mjs validate-journal \
      --journal "$journal"
    local sequence history_key
    sequence="$(jq -er '.checkpoints | length' "$journal")"
    history_key="${transaction_prefix}/journal-$(printf '%04d' "$sequence").json"
    publish_immutable_r2 "$journal" "$history_key" \
      "journal-r2-$(printf '%04d' "$sequence")"
    publish_immutable_oss "$journal" "$history_key" \
      "journal-oss-$(printf '%04d' "$sequence")"
    put_r2_json "$journal" "$OPEN_TRANSACTION_KEY"
    put_oss_json "$journal" "$OPEN_TRANSACTION_KEY" true
    download_r2 "$OPEN_TRANSACTION_KEY" "${state_dir}/journal-r2-readback.json" \
      "${state_dir}/journal-r2-readback-metadata.json"
    download_oss "$OPEN_TRANSACTION_KEY" \
      "${state_dir}/journal-oss-readback.json"
    cmp "$journal" "${state_dir}/journal-r2-readback.json"
    cmp "$journal" "${state_dir}/journal-oss-readback.json"
  )
}

advance_journal() {
  local state="$1" checkpoint="$2"
  node scripts/updater/legacy-pause-transaction.mjs advance-journal \
    --journal "$journal" --state "$state" --checkpoint "$checkpoint" \
    --updated-at "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" \
    --output "${journal}.next"
  mv "${journal}.next" "$journal"
  persist_journal
}

delete_open_journal() {
  (
    set -euo pipefail
    local r2_state oss_state open_journal_etag
    local r2_delete_needed=false oss_delete_needed=false

    probe_r2 "$OPEN_TRANSACTION_KEY" open-r2-predelete-probe
    r2_state="$(jq -er .state \
      "${probe_dir}/open-r2-predelete-probe.json")"
    if [[ "$r2_state" == exists ]]; then
      r2_delete_needed=true
      download_r2 "$OPEN_TRANSACTION_KEY" \
        "${state_dir}/open-journal-r2-predelete.json" \
        "${state_dir}/open-journal-r2-predelete-metadata.json"
      cmp "$journal" "${state_dir}/open-journal-r2-predelete.json"
      test "$(jq -er .transactionId \
        "${state_dir}/open-journal-r2-predelete.json")" = "$transaction_id"
      node scripts/updater/promotion-transaction.mjs backup-metadata-plan \
        --metadata "${state_dir}/open-journal-r2-predelete-metadata.json" \
        --output "${state_dir}/open-journal-r2-predelete-metadata-plan.json"
      jq -e '
        .contentType == "application/json" and .cacheControl == "no-store"
      ' "${state_dir}/open-journal-r2-predelete-metadata-plan.json" >/dev/null
      open_journal_etag="$(node scripts/updater/promotion-transaction.mjs \
        extract-r2-etag \
        --metadata "${state_dir}/open-journal-r2-predelete-metadata.json")"
    else
      test "$r2_state" = absent
    fi

    probe_oss "$OPEN_TRANSACTION_KEY" open-oss-predelete-probe
    oss_state="$(jq -er .state \
      "${probe_dir}/open-oss-predelete-probe.json")"
    if [[ "$oss_state" == exists ]]; then
      oss_delete_needed=true
      download_oss "$OPEN_TRANSACTION_KEY" \
        "${state_dir}/open-journal-oss-predelete.json"
      ossutil api head-object --bucket "$ALIYUN_OSS_BUCKET" \
        --key "$OPEN_TRANSACTION_KEY" --endpoint "$oss_endpoint" \
        --region "$ALIYUN_REGION" --output-format json --quiet \
        >"${state_dir}/open-journal-oss-predelete-metadata.json"
      cmp "$journal" "${state_dir}/open-journal-oss-predelete.json"
      test "$(jq -er .transactionId \
        "${state_dir}/open-journal-oss-predelete.json")" = "$transaction_id"
      node scripts/updater/promotion-transaction.mjs backup-metadata-plan \
        --metadata "${state_dir}/open-journal-oss-predelete-metadata.json" \
        --output "${state_dir}/open-journal-oss-predelete-metadata-plan.json"
      jq -e '
        .contentType == "application/json" and .cacheControl == "no-store"
      ' "${state_dir}/open-journal-oss-predelete-metadata-plan.json" >/dev/null
    else
      test "$oss_state" = absent
    fi

    if [[ "$r2_delete_needed" == true ]]; then
      aws s3api delete-object --bucket "$CLOUDFLARE_R2_BUCKET" \
        --key "$OPEN_TRANSACTION_KEY" --if-match "$open_journal_etag" \
        --endpoint-url "$r2_endpoint" >/dev/null
    fi
    if [[ "$oss_delete_needed" == true ]]; then
      probe_oss "$OPEN_TRANSACTION_KEY" open-oss-immediate-probe
      oss_state="$(jq -er .state \
        "${probe_dir}/open-oss-immediate-probe.json")"
      if [[ "$oss_state" == exists ]]; then
        download_oss "$OPEN_TRANSACTION_KEY" \
          "${state_dir}/open-journal-oss-immediate.json"
        ossutil api head-object --bucket "$ALIYUN_OSS_BUCKET" \
          --key "$OPEN_TRANSACTION_KEY" --endpoint "$oss_endpoint" \
          --region "$ALIYUN_REGION" --output-format json --quiet \
          >"${state_dir}/open-journal-oss-immediate-metadata.json"
        cmp "$journal" "${state_dir}/open-journal-oss-immediate.json"
        test "$(jq -er .transactionId \
          "${state_dir}/open-journal-oss-immediate.json")" = "$transaction_id"
        node scripts/updater/promotion-transaction.mjs backup-metadata-plan \
          --metadata "${state_dir}/open-journal-oss-immediate-metadata.json" \
          --output "${state_dir}/open-journal-oss-immediate-metadata-plan.json"
        jq -e '
          .contentType == "application/json" and .cacheControl == "no-store"
        ' "${state_dir}/open-journal-oss-immediate-metadata-plan.json" >/dev/null
        ossutil api delete-object --bucket "$ALIYUN_OSS_BUCKET" \
          --key "$OPEN_TRANSACTION_KEY" --endpoint "$oss_endpoint" \
          --region "$ALIYUN_REGION" --output-format json --quiet >/dev/null
      else
        test "$oss_state" = absent
      fi
    fi
    probe_r2 "$OPEN_TRANSACTION_KEY" open-r2-deleted
    probe_oss "$OPEN_TRANSACTION_KEY" open-oss-deleted
    jq -e '.state == "absent"' \
      "${probe_dir}/open-r2-deleted.json" >/dev/null
    jq -e '.state == "absent"' \
      "${probe_dir}/open-oss-deleted.json" >/dev/null
  )
}

purge_legacy_caches() {
  local prefix="$1"
  aliyun cdn RefreshObjectCaches --ObjectPath "$LEGACY_ALIYUN_URL" \
    --ObjectType File >"${state_dir}/${prefix}-aliyun-cache-purge.json"
  jq -e '.RefreshTaskId or .RequestId' \
    "${state_dir}/${prefix}-aliyun-cache-purge.json" >/dev/null
  curl --proto '=https' --tlsv1.2 -fsS -X POST \
    "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/purge_cache" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Content-Type: application/json" \
    --data "{\"files\":[\"${LEGACY_R2_URL}\"]}" \
    >"${state_dir}/${prefix}-cloudflare-cache-purge.json"
  jq -e '.success == true' \
    "${state_dir}/${prefix}-cloudflare-cache-purge.json" >/dev/null
}

poll_legacy_bytes() {
  local expected="$1" prefix="$2"
  node scripts/updater/promotion-transaction.mjs poll-url \
    --url "$LEGACY_ALIYUN_URL" --expected "$expected" \
    --timeout-seconds 600 --interval-seconds 10 \
    --output "${state_dir}/${prefix}-legacy-aliyun-cdn.json"
  node scripts/updater/promotion-transaction.mjs poll-url \
    --url "$LEGACY_R2_URL" --expected "$expected" \
    --timeout-seconds 600 --interval-seconds 10 \
    --output "${state_dir}/${prefix}-legacy-r2-cdn.json"
}

probe_router_state() {
  local prefix="$1"
  local headers_json="${state_dir}/${prefix}-router-probe-request.json"
  local response_headers="${state_dir}/${prefix}-router-probe-response.headers"
  local response_body="${state_dir}/${prefix}-router-probe-response.json"
  local status state
  node scripts/updater/sign-request.mjs --current-version "$EXPECTED_CURRENT" \
    --target-version "$EXPECTED_CURRENT" --rollout 0 --salt pause \
    --output "$headers_json"
  local curl_args=(--proto '=https' --tlsv1.2 -sS --connect-timeout 10 \
    --max-time 120 -D "$response_headers" -o "$response_body" \
    -w '%{http_code}' \
    "${DYNAMIC_UPDATER_BASE_URL}/windows/x86_64/${EXPECTED_CURRENT}")
  while IFS=$'\t' read -r key value; do
    curl_args+=(-H "$key: $value")
  done < <(jq -r 'to_entries[] | [.key, .value] | @tsv' "$headers_json")
  status="$(curl "${curl_args[@]}")"
  state="$(awk -F ': *' '
    tolower($1) == "x-biyan-updater-state" {
      gsub(/\r/, "", $2)
      value = $2
    }
    END { print value }
  ' "$response_headers")"
  printf '%s\n' "$status" >"${state_dir}/${prefix}-router-probe.status"
  printf '%s\n' "$state" >"${state_dir}/${prefix}-router-probe.state"
}

fetch_policy_for_cas() {
  local prefix="$1"
  download_r2 "$POLICY_KEY" "${state_dir}/${prefix}-policy.json" \
    "${state_dir}/${prefix}-policy-metadata.json"
}

fetch_legacy_for_cas() {
  local prefix="$1"
  download_oss "$LEGACY_ALIYUN_KEY" \
    "${state_dir}/${prefix}-legacy-oss.json"
  download_r2 "$LEGACY_R2_KEY" \
    "${state_dir}/${prefix}-legacy-r2.json" \
    "${state_dir}/${prefix}-legacy-r2-metadata.json"
}

classify_object() {
  local mode="$1" kind="$2" live="$3" before="$4" paused="$5" output="$6"
  node scripts/updater/legacy-pause-transaction.mjs "classify-${mode}" \
    --object-kind "$kind" --live-state exists --live "$live" \
    --before "$before" --paused "$paused" --output "$output"
}

verify_expected_metadata() {
  local metadata="$1" output="$2" expected_cache="$3"
  node scripts/updater/promotion-transaction.mjs backup-metadata-plan \
    --metadata "$metadata" --output "$output"
  jq -e --arg cacheControl "$expected_cache" '
    .contentType == "application/json" and .cacheControl == $cacheControl
  ' "$output" >/dev/null
}

recover_terminal_open_journal() {
  local new_transaction_id="$transaction_id"
  local new_transaction_prefix="$transaction_prefix"
  local r2_state="$1" oss_state="$2" survivor terminal_state history_key
  local policy_backup legacy_oss_backup legacy_r2_backup acl_backup
  local expected_policy_sha expected_legacy_sha expected_acl actual_acl
  local fallback_oss_key fallback_r2_key expected_legacy router_state

  if [[ "$r2_state" == exists ]]; then
    download_r2 "$OPEN_TRANSACTION_KEY" \
      "${state_dir}/terminal-open-r2.json" \
      "${state_dir}/terminal-open-r2-metadata.json"
    verify_expected_metadata \
      "${state_dir}/terminal-open-r2-metadata.json" \
      "${state_dir}/terminal-open-r2-metadata-plan.json" no-store
    survivor="${state_dir}/terminal-open-r2.json"
  else
    test "$r2_state" = absent
  fi
  if [[ "$oss_state" == exists ]]; then
    download_oss "$OPEN_TRANSACTION_KEY" \
      "${state_dir}/terminal-open-oss.json"
    ossutil api head-object --bucket "$ALIYUN_OSS_BUCKET" \
      --key "$OPEN_TRANSACTION_KEY" --endpoint "$oss_endpoint" \
      --region "$ALIYUN_REGION" --output-format json --quiet \
      >"${state_dir}/terminal-open-oss-metadata.json"
    verify_expected_metadata \
      "${state_dir}/terminal-open-oss-metadata.json" \
      "${state_dir}/terminal-open-oss-metadata-plan.json" no-store
    if [[ -n "${survivor:-}" ]]; then
      cmp "$survivor" "${state_dir}/terminal-open-oss.json"
    else
      survivor="${state_dir}/terminal-open-oss.json"
    fi
  else
    test "$oss_state" = absent
  fi
  test -n "${survivor:-}"
  cp "$survivor" "$journal"
  node scripts/updater/legacy-pause-transaction.mjs validate-journal \
    --journal "$journal"
  terminal_state="$(jq -er .state "$journal")"
  case "$terminal_state" in
    committed|rolled-back) ;;
    *)
      echo "Open pause journal is nonterminal: $terminal_state" >&2
      return 1
      ;;
  esac
  test "$(jq -er .recoveryRequired "$journal")" = false
  test "$(jq -er .expectedCurrentVersion "$journal")" = "$EXPECTED_CURRENT"
  transaction_id="$(jq -er .transactionId "$journal")"
  transaction_prefix="biyan/updater/transactions/${transaction_id}"

  if [[ "$r2_state" == exists ]]; then
    cmp "$journal" "${state_dir}/terminal-open-r2.json"
  fi
  if [[ "$oss_state" == exists ]]; then
    cmp "$journal" "${state_dir}/terminal-open-oss.json"
  fi

  history_key="${transaction_prefix}/journal-$(printf '%04d' \
    "$(jq -er '.checkpoints | length' "$journal")").json"
  download_r2 "$history_key" "${state_dir}/terminal-history-r2.json" \
    "${state_dir}/terminal-history-r2-metadata.json"
  download_oss "$history_key" "${state_dir}/terminal-history-oss.json"
  ossutil api head-object --bucket "$ALIYUN_OSS_BUCKET" --key "$history_key" \
    --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" \
    --output-format json --quiet >"${state_dir}/terminal-history-oss-metadata.json"
  cmp "$journal" "${state_dir}/terminal-history-r2.json"
  cmp "$journal" "${state_dir}/terminal-history-oss.json"
  verify_expected_metadata "${state_dir}/terminal-history-r2-metadata.json" \
    "${state_dir}/terminal-history-r2-metadata-plan.json" no-store
  verify_expected_metadata "${state_dir}/terminal-history-oss-metadata.json" \
    "${state_dir}/terminal-history-oss-metadata-plan.json" no-store

  download_r2 "$POLICY_KEY" "${state_dir}/terminal-live-policy.json" \
    "${state_dir}/terminal-live-policy-metadata.json"
  download_oss "$LEGACY_ALIYUN_KEY" \
    "${state_dir}/terminal-live-legacy-oss.json"
  download_r2 "$LEGACY_R2_KEY" \
    "${state_dir}/terminal-live-legacy-r2.json" \
    "${state_dir}/terminal-live-legacy-r2-metadata.json"
  ossutil api head-object --bucket "$ALIYUN_OSS_BUCKET" \
    --key "$LEGACY_ALIYUN_KEY" --endpoint "$oss_endpoint" \
    --region "$ALIYUN_REGION" --output-format json --quiet \
    >"${state_dir}/terminal-live-legacy-oss-metadata.json"
  ossutil api get-object-acl --bucket "$ALIYUN_OSS_BUCKET" \
    --key "$LEGACY_ALIYUN_KEY" --endpoint "$oss_endpoint" \
    --region "$ALIYUN_REGION" --output-format json --quiet \
    >"${state_dir}/terminal-live-legacy-oss-acl.json"
  verify_expected_metadata "${state_dir}/terminal-live-policy-metadata.json" \
    "${state_dir}/terminal-live-policy-metadata-plan.json" no-store
  verify_expected_metadata \
    "${state_dir}/terminal-live-legacy-oss-metadata.json" \
    "${state_dir}/terminal-live-legacy-oss-metadata-plan.json" \
    "public, max-age=60, must-revalidate"
  verify_expected_metadata \
    "${state_dir}/terminal-live-legacy-r2-metadata.json" \
    "${state_dir}/terminal-live-legacy-r2-metadata-plan.json" \
    "public, max-age=60, must-revalidate"

  acl_backup="$(jq -er .legacySnapshots.oss.aclBackupKey "$journal")"
  download_oss "$acl_backup" "${state_dir}/terminal-legacy-oss-acl-backup.json"
  test "$(sha256sum "${state_dir}/terminal-legacy-oss-acl-backup.json" \
    | cut -d' ' -f1)" = "$(jq -er .legacySnapshots.oss.aclSha256 "$journal")"
  expected_acl="$(node scripts/updater/promotion-transaction.mjs \
    extract-oss-acl \
    --acl "${state_dir}/terminal-legacy-oss-acl-backup.json")"
  actual_acl="$(node scripts/updater/promotion-transaction.mjs \
    extract-oss-acl \
    --acl "${state_dir}/terminal-live-legacy-oss-acl.json")"
  test "$actual_acl" = "$expected_acl"

  if [[ "$terminal_state" == committed ]]; then
    expected_policy_sha="$(jq -er .proposedPausedPolicySha256 "$journal")"
    test "$(sha256sum "${state_dir}/terminal-live-policy.json" \
      | cut -d' ' -f1)" = "$expected_policy_sha"
    test "$(jq -er .paused "${state_dir}/terminal-live-policy.json")" = true
    test "$(jq -er .currentVersion \
      "${state_dir}/terminal-live-policy.json")" = "$EXPECTED_CURRENT"
    jq -S .fallback "$journal" >"${state_dir}/terminal-journal-fallback.json"
    jq -S .legacyPauseFallback "${state_dir}/terminal-live-policy.json" \
      >"${state_dir}/terminal-live-policy-fallback.json"
    cmp "${state_dir}/terminal-journal-fallback.json" \
      "${state_dir}/terminal-live-policy-fallback.json"
    fallback_oss_key="$(jq -er .fallback.backups.oss "$journal")"
    fallback_r2_key="$(jq -er .fallback.backups.r2 "$journal")"
    download_oss "$fallback_oss_key" \
      "${state_dir}/terminal-fallback-oss.json"
    download_r2 "$fallback_r2_key" \
      "${state_dir}/terminal-fallback-r2.json" \
      "${state_dir}/terminal-fallback-r2-metadata.json"
    expected_legacy_sha="$(jq -er .fallback.manifestSha256 "$journal")"
    test "$(sha256sum "${state_dir}/terminal-fallback-oss.json" \
      | cut -d' ' -f1)" = "$expected_legacy_sha"
    test "$(sha256sum "${state_dir}/terminal-fallback-r2.json" \
      | cut -d' ' -f1)" = "$expected_legacy_sha"
    cmp "${state_dir}/terminal-fallback-oss.json" \
      "${state_dir}/terminal-fallback-r2.json"
    cmp "${state_dir}/terminal-fallback-oss.json" \
      "${state_dir}/terminal-live-legacy-oss.json"
    cmp "${state_dir}/terminal-fallback-r2.json" \
      "${state_dir}/terminal-live-legacy-r2.json"
    expected_legacy="${state_dir}/terminal-fallback-oss.json"
    router_state=paused
  else
    policy_backup="$(jq -er .policySnapshot.backupKey "$journal")"
    legacy_oss_backup="$(jq -er .legacySnapshots.oss.backupKey "$journal")"
    legacy_r2_backup="$(jq -er .legacySnapshots.r2.backupKey "$journal")"
    download_r2 "$policy_backup" "${state_dir}/terminal-policy-backup.json" \
      "${state_dir}/terminal-policy-backup-metadata.json"
    download_oss "$legacy_oss_backup" \
      "${state_dir}/terminal-legacy-oss-backup.json"
    download_r2 "$legacy_r2_backup" \
      "${state_dir}/terminal-legacy-r2-backup.json" \
      "${state_dir}/terminal-legacy-r2-backup-metadata.json"
    test "$(sha256sum "${state_dir}/terminal-policy-backup.json" \
      | cut -d' ' -f1)" = "$(jq -er .policySnapshot.bytesSha256 "$journal")"
    expected_legacy_sha="$(jq -er \
      .legacySnapshots.oss.manifestSha256 "$journal")"
    test "$(sha256sum "${state_dir}/terminal-legacy-oss-backup.json" \
      | cut -d' ' -f1)" = "$expected_legacy_sha"
    test "$(sha256sum "${state_dir}/terminal-legacy-r2-backup.json" \
      | cut -d' ' -f1)" = "$expected_legacy_sha"
    cmp "${state_dir}/terminal-policy-backup.json" \
      "${state_dir}/terminal-live-policy.json"
    cmp "${state_dir}/terminal-legacy-oss-backup.json" \
      "${state_dir}/terminal-live-legacy-oss.json"
    cmp "${state_dir}/terminal-legacy-r2-backup.json" \
      "${state_dir}/terminal-live-legacy-r2.json"
    test "$(jq -er .paused "${state_dir}/terminal-live-policy.json")" = false
    expected_legacy="${state_dir}/terminal-legacy-oss-backup.json"
    router_state=no-transition
  fi

  poll_legacy_bytes "$expected_legacy" terminal-recovery
  probe_router_state terminal-recovery
  test "$(cat "${state_dir}/terminal-recovery-router-probe.status")" = 204
  test "$(cat "${state_dir}/terminal-recovery-router-probe.state")" \
    = "$router_state"
  delete_open_journal
  jq -n --arg transactionId "$transaction_id" --arg state "$terminal_state" \
    '{
      status:"cleaned-terminal-open-journal",
      transactionId:$transactionId,
      state:$state
    }' >"${state_dir}/terminal-open-cleanup.json"

  if [[ "$terminal_state" == committed ]]; then
    terminal_cleanup_result=committed
  else
    mv "$journal" "${state_dir}/previous-rolled-back-journal.json"
    transaction_id="$new_transaction_id"
    transaction_prefix="$new_transaction_prefix"
    terminal_cleanup_result=rolled-back
  fi
}

probe_r2 "$OPEN_TRANSACTION_KEY" open-r2
probe_oss "$OPEN_TRANSACTION_KEY" open-oss
initial_open_r2_state="$(jq -er .state "${probe_dir}/open-r2.json")"
initial_open_oss_state="$(jq -er .state "${probe_dir}/open-oss.json")"
if [[ "$initial_open_r2_state" != absent \
  || "$initial_open_oss_state" != absent ]]; then
  recover_terminal_open_journal \
    "$initial_open_r2_state" "$initial_open_oss_state"
  if [[ "$terminal_cleanup_result" == committed ]]; then
    exit 0
  fi
fi

probe_r2 "$POLICY_KEY" policy
probe_oss "$LEGACY_ALIYUN_KEY" legacy-oss
probe_r2 "$LEGACY_R2_KEY" legacy-r2
jq -e '.state == "exists"' "${probe_dir}/policy.json" >/dev/null
jq -e '.state == "exists"' "${probe_dir}/legacy-oss.json" >/dev/null
jq -e '.state == "exists"' "${probe_dir}/legacy-r2.json" >/dev/null

download_r2 "$POLICY_KEY" "${state_dir}/policy-before.json" \
  "${state_dir}/policy-before-metadata.json"
download_oss "$LEGACY_ALIYUN_KEY" "${state_dir}/legacy-a-oss.json"
download_r2 "$LEGACY_R2_KEY" "${state_dir}/legacy-a-r2.json" \
  "${state_dir}/legacy-a-r2-metadata.json"
ossutil api get-object-acl --bucket "$ALIYUN_OSS_BUCKET" \
  --key "$LEGACY_ALIYUN_KEY" --endpoint "$oss_endpoint" \
  --region "$ALIYUN_REGION" --output-format json --quiet \
  >"${state_dir}/legacy-a-oss-acl.json"
legacy_oss_acl="$(node scripts/updater/promotion-transaction.mjs \
  extract-oss-acl --acl "${state_dir}/legacy-a-oss-acl.json")"
case "$legacy_oss_acl" in
  default|private|public-read) ;;
  *)
    echo "Unsupported OSS ACL snapshot: $legacy_oss_acl" >&2
    exit 1
    ;;
esac

node scripts/updater/legacy-pause-transaction.mjs validate-live \
  --policy "${state_dir}/policy-before.json" \
  --expected-current "$EXPECTED_CURRENT" \
  --oss-legacy "${state_dir}/legacy-a-oss.json" \
  --r2-legacy "${state_dir}/legacy-a-r2.json" \
  --output "${state_dir}/validated-live.json"

# This authenticated capability probe must distinguish an active, unpaused
# Router with no current-version transition from the paused branch. An older
# Worker that emits an undifferentiated 204 is rejected before any mutation.
probe_router_state before
test "$(cat "${state_dir}/before-router-probe.status")" = "204"
test "$(cat "${state_dir}/before-router-probe.state")" = "no-transition"

fallback_oss_key="$(jq -er '.fallback.backups.oss' \
  "${state_dir}/validated-live.json")"
fallback_r2_key="$(jq -er '.fallback.backups.r2' \
  "${state_dir}/validated-live.json")"
download_oss "$fallback_oss_key" "${state_dir}/fallback-oss.json"
download_r2 "$fallback_r2_key" "${state_dir}/fallback-r2.json" \
  "${state_dir}/fallback-r2-metadata.json"

created_at="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
node scripts/updater/set-policy-state.mjs \
  "${state_dir}/policy-before.json" "${state_dir}/policy-paused.json" \
  "$EXPECTED_CURRENT" paused
node scripts/updater/legacy-pause-transaction.mjs create-journal \
  --transaction-id "$transaction_id" --created-at "$created_at" \
  --expected-current "$EXPECTED_CURRENT" \
  --policy-before "${state_dir}/policy-before.json" \
  --oss-legacy-before "${state_dir}/legacy-a-oss.json" \
  --r2-legacy-before "${state_dir}/legacy-a-r2.json" \
  --oss-legacy-acl "${state_dir}/legacy-a-oss-acl.json" \
  --proposed-policy "${state_dir}/policy-paused.json" \
  --oss-fallback "${state_dir}/fallback-oss.json" \
  --r2-fallback "${state_dir}/fallback-r2.json" \
  --output "$journal"

policy_backup="$(jq -er .policySnapshot.backupKey "$journal")"
legacy_oss_backup="$(jq -er .legacySnapshots.oss.backupKey "$journal")"
legacy_r2_backup="$(jq -er .legacySnapshots.r2.backupKey "$journal")"
legacy_oss_acl_backup="$(jq -er .legacySnapshots.oss.aclBackupKey "$journal")"
publish_immutable_r2 "${state_dir}/policy-before.json" "$policy_backup" \
  policy-before-backup-r2
publish_immutable_oss "${state_dir}/legacy-a-oss.json" "$legacy_oss_backup" \
  legacy-a-backup-oss
publish_immutable_r2 "${state_dir}/legacy-a-r2.json" "$legacy_r2_backup" \
  legacy-a-backup-r2
publish_immutable_oss "${state_dir}/legacy-a-oss-acl.json" \
  "$legacy_oss_acl_backup" legacy-a-acl-backup-oss
publish_immutable_r2 "${state_dir}/legacy-a-oss-acl.json" \
  "$legacy_oss_acl_backup" legacy-a-acl-backup-r2

journal_ready=true
policy_write_attempted=false
legacy_oss_write_attempted=false
legacy_r2_write_attempted=false

rollback() {
  local original_rc=$? rollback_failed=0
  local legacy_restore_performed=false
  local legacy_oss_restore_needed=false legacy_r2_restore_needed=false
  if [[ "$original_rc" -eq 0 ]]; then original_rc=1; fi
  trap - ERR INT TERM
  set +e

  if [[ "${journal_ready:-false}" != true ]]; then
    exit "$original_rc"
  fi

  if node scripts/updater/legacy-pause-transaction.mjs advance-journal \
    --journal "$journal" --state rollback-required \
    --checkpoint rollback-started \
    --updated-at "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" \
    --output "${journal}.rollback"; then
    mv "${journal}.rollback" "$journal"
    persist_journal || rollback_failed=1
  else
    rollback_failed=1
  fi

  # Classify every attempted object before restoring any object. If any live
  # bytes are neither the before nor paused bytes, preserve everything and
  # leave the durable open journal for operator recovery.
  r2_classification_ok=true
  download_r2 "$LEGACY_R2_KEY" "${state_dir}/rollback-live-legacy-r2.json" \
    "${state_dir}/rollback-live-legacy-r2-metadata.json" \
    || r2_classification_ok=false
  if [[ "$r2_classification_ok" == true ]]; then
    if [[ "$legacy_r2_write_attempted" == true ]]; then
      classify_object rollback legacy-r2 \
        "${state_dir}/rollback-live-legacy-r2.json" \
        "${state_dir}/legacy-a-r2.json" "${state_dir}/fallback-r2.json" \
        "${state_dir}/rollback-legacy-r2-decision.json" \
        || r2_classification_ok=false
    else
      cmp "${state_dir}/legacy-a-r2.json" \
        "${state_dir}/rollback-live-legacy-r2.json" \
        || r2_classification_ok=false
    fi
  fi
  if [[ "$r2_classification_ok" != true ]]; then rollback_failed=1; fi

  oss_classification_ok=true
  download_oss "$LEGACY_ALIYUN_KEY" \
    "${state_dir}/rollback-live-legacy-oss.json" \
    || oss_classification_ok=false
  if [[ "$oss_classification_ok" == true ]]; then
    if [[ "$legacy_oss_write_attempted" == true ]]; then
      classify_object rollback legacy-oss \
        "${state_dir}/rollback-live-legacy-oss.json" \
        "${state_dir}/legacy-a-oss.json" "${state_dir}/fallback-oss.json" \
        "${state_dir}/rollback-legacy-oss-decision.json" \
        || oss_classification_ok=false
    else
      cmp "${state_dir}/legacy-a-oss.json" \
        "${state_dir}/rollback-live-legacy-oss.json" \
        || oss_classification_ok=false
    fi
  fi
  if [[ "$oss_classification_ok" != true ]]; then rollback_failed=1; fi

  policy_classification_ok=true
  fetch_policy_for_cas rollback-live || policy_classification_ok=false
  if [[ "$policy_classification_ok" == true ]]; then
    if [[ "$policy_write_attempted" == true ]]; then
      classify_object rollback policy "${state_dir}/rollback-live-policy.json" \
        "${state_dir}/policy-before.json" "${state_dir}/policy-paused.json" \
        "${state_dir}/rollback-policy-decision.json" \
        || policy_classification_ok=false
    else
      cmp "${state_dir}/policy-before.json" \
        "${state_dir}/rollback-live-policy.json" \
        || policy_classification_ok=false
    fi
  fi
  if [[ "$policy_classification_ok" != true ]]; then rollback_failed=1; fi

  # Re-read and compare both legacy origins before the first restore. Only
  # after both comparisons succeed may either origin be changed.
  if [[ "$rollback_failed" -eq 0 \
    && "$legacy_r2_write_attempted" == true \
    && "$(jq -r .action \
      "${state_dir}/rollback-legacy-r2-decision.json")" == restore ]]; then
    legacy_r2_restore_needed=true
    download_r2 "$LEGACY_R2_KEY" \
      "${state_dir}/rollback-prewrite-legacy-r2.json" \
      "${state_dir}/rollback-prewrite-legacy-r2-metadata.json" \
      || rollback_failed=1
    cmp "${state_dir}/rollback-live-legacy-r2.json" \
      "${state_dir}/rollback-prewrite-legacy-r2.json" \
      || rollback_failed=1
    rollback_legacy_r2_etag="$(node \
      scripts/updater/promotion-transaction.mjs extract-r2-etag \
      --metadata "${state_dir}/rollback-prewrite-legacy-r2-metadata.json")" \
      || rollback_failed=1
  fi
  if [[ "$rollback_failed" -eq 0 \
    && "$legacy_oss_write_attempted" == true \
    && "$(jq -r .action \
      "${state_dir}/rollback-legacy-oss-decision.json")" == restore ]]; then
    legacy_oss_restore_needed=true
    download_oss "$LEGACY_ALIYUN_KEY" \
      "${state_dir}/rollback-prewrite-legacy-oss.json" \
      || rollback_failed=1
    cmp "${state_dir}/rollback-live-legacy-oss.json" \
      "${state_dir}/rollback-prewrite-legacy-oss.json" \
      || rollback_failed=1
  fi
  if [[ "$rollback_failed" -eq 0 \
    && "$legacy_oss_restore_needed" == true ]]; then
    ossutil api put-object --bucket "$ALIYUN_OSS_BUCKET" \
      --key "$LEGACY_ALIYUN_KEY" \
      --body "file://${state_dir}/legacy-a-oss.json" \
      --content-type application/json \
      --cache-control "public, max-age=60, must-revalidate" \
      --object-acl "$legacy_oss_acl" --endpoint "$oss_endpoint" \
      --region "$ALIYUN_REGION" --output-format json --quiet >/dev/null \
      || rollback_failed=1
    if [[ "$rollback_failed" -eq 0 ]]; then legacy_restore_performed=true; fi
  fi
  if [[ "$rollback_failed" -eq 0 \
    && "$legacy_r2_restore_needed" == true ]]; then
    aws s3api put-object --bucket "$CLOUDFLARE_R2_BUCKET" \
      --key "$LEGACY_R2_KEY" --body "${state_dir}/legacy-a-r2.json" \
      --content-type application/json \
      --cache-control "public, max-age=60, must-revalidate" \
      --if-match "$rollback_legacy_r2_etag" \
      --endpoint-url "$r2_endpoint" >/dev/null || rollback_failed=1
    if [[ "$rollback_failed" -eq 0 ]]; then legacy_restore_performed=true; fi
  fi
  if [[ "$rollback_failed" -eq 0 ]]; then
    fetch_legacy_for_cas rollback-verified || rollback_failed=1
    cmp "${state_dir}/legacy-a-oss.json" \
      "${state_dir}/rollback-verified-legacy-oss.json" || rollback_failed=1
    cmp "${state_dir}/legacy-a-r2.json" \
      "${state_dir}/rollback-verified-legacy-r2.json" || rollback_failed=1
  fi
  if [[ "$rollback_failed" -eq 0 \
    && "$legacy_restore_performed" == true ]]; then
    purge_legacy_caches rollback || rollback_failed=1
    poll_legacy_bytes "${state_dir}/legacy-a-oss.json" rollback \
      || rollback_failed=1
  fi

  # The policy is restored last, after both legacy origins and public caches
  # have been verified at the original bytes.
  if [[ "$rollback_failed" -eq 0 \
    && "$policy_write_attempted" == true \
    && "$(jq -r .action \
      "${state_dir}/rollback-policy-decision.json")" == restore ]]; then
    fetch_policy_for_cas rollback-prewrite || rollback_failed=1
    cmp "${state_dir}/rollback-live-policy.json" \
      "${state_dir}/rollback-prewrite-policy.json" || rollback_failed=1
    rollback_policy_etag="$(node scripts/updater/promotion-transaction.mjs \
      extract-r2-etag \
      --metadata "${state_dir}/rollback-prewrite-policy-metadata.json")" \
      || rollback_failed=1
    if [[ "$rollback_failed" -eq 0 ]]; then
      aws s3api put-object --bucket "$CLOUDFLARE_R2_BUCKET" \
        --key "$POLICY_KEY" --body "${state_dir}/policy-before.json" \
        --content-type application/json --cache-control no-store \
        --if-match "$rollback_policy_etag" --endpoint-url "$r2_endpoint" \
        >/dev/null || rollback_failed=1
    fi
  fi
  if [[ "$rollback_failed" -eq 0 ]]; then
    fetch_policy_for_cas rollback-verified || rollback_failed=1
    cmp "${state_dir}/policy-before.json" \
      "${state_dir}/rollback-verified-policy.json" || rollback_failed=1
  fi
  if [[ "$rollback_failed" -eq 0 ]]; then
    probe_router_state rollback || rollback_failed=1
    test "$(cat "${state_dir}/rollback-router-probe.status")" = "204" \
      || rollback_failed=1
    test "$(cat "${state_dir}/rollback-router-probe.state")" = "no-transition" \
      || rollback_failed=1
  fi
  if [[ "$rollback_failed" -eq 0 ]]; then
    node scripts/updater/legacy-pause-transaction.mjs advance-journal \
      --journal "$journal" --state rolled-back \
      --checkpoint rollback-verified \
      --updated-at "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" \
      --output "${journal}.rolled-back" || rollback_failed=1
  fi
  if [[ "$rollback_failed" -eq 0 ]]; then
    mv "${journal}.rolled-back" "$journal"
    persist_journal || rollback_failed=1
  fi
  if [[ "$rollback_failed" -eq 0 ]]; then
    delete_open_journal || rollback_failed=1
  fi
  if [[ "$rollback_failed" -ne 0 ]]; then
    echo "Pause rollback incomplete; durable open journal blocks every policy writer." >&2
  fi
  exit "$original_rc"
}
trap rollback ERR INT TERM

persist_journal
advance_journal committing before-policy-cas

fetch_policy_for_cas forward
classify_object cas policy "${state_dir}/forward-policy.json" \
  "${state_dir}/policy-before.json" "${state_dir}/policy-paused.json" \
  "${state_dir}/forward-policy-decision.json"
test "$(jq -r .action "${state_dir}/forward-policy-decision.json")" = write
policy_write_attempted=true
policy_etag="$(node scripts/updater/promotion-transaction.mjs extract-r2-etag \
  --metadata "${state_dir}/forward-policy-metadata.json")"
aws s3api put-object --bucket "$CLOUDFLARE_R2_BUCKET" --key "$POLICY_KEY" \
  --body "${state_dir}/policy-paused.json" --content-type application/json \
  --cache-control no-store --if-match "$policy_etag" \
  --endpoint-url "$r2_endpoint" >"${state_dir}/policy-put-result.json"
fetch_policy_for_cas paused-readback
cmp "${state_dir}/policy-paused.json" "${state_dir}/paused-readback-policy.json"

advance_journal committing before-legacy-oss-cas
download_oss "$LEGACY_ALIYUN_KEY" "${state_dir}/forward-legacy-oss.json"
classify_object cas legacy-oss "${state_dir}/forward-legacy-oss.json" \
  "${state_dir}/legacy-a-oss.json" "${state_dir}/fallback-oss.json" \
  "${state_dir}/forward-legacy-oss-decision.json"
test "$(jq -r .action "${state_dir}/forward-legacy-oss-decision.json")" = write
legacy_oss_write_attempted=true
ossutil api put-object --bucket "$ALIYUN_OSS_BUCKET" \
  --key "$LEGACY_ALIYUN_KEY" --body "file://${state_dir}/fallback-oss.json" \
  --content-type application/json \
  --cache-control "public, max-age=60, must-revalidate" \
  --object-acl "$legacy_oss_acl" --endpoint "$oss_endpoint" \
  --region "$ALIYUN_REGION" --output-format json --quiet >/dev/null

advance_journal committing before-legacy-r2-cas
download_r2 "$LEGACY_R2_KEY" "${state_dir}/forward-legacy-r2.json" \
  "${state_dir}/forward-legacy-r2-metadata.json"
classify_object cas legacy-r2 "${state_dir}/forward-legacy-r2.json" \
  "${state_dir}/legacy-a-r2.json" "${state_dir}/fallback-r2.json" \
  "${state_dir}/forward-legacy-r2-decision.json"
test "$(jq -r .action "${state_dir}/forward-legacy-r2-decision.json")" = write
legacy_r2_write_attempted=true
legacy_r2_etag="$(node scripts/updater/promotion-transaction.mjs \
  extract-r2-etag --metadata \
  "${state_dir}/forward-legacy-r2-metadata.json")"
aws s3api put-object --bucket "$CLOUDFLARE_R2_BUCKET" \
  --key "$LEGACY_R2_KEY" --body "${state_dir}/fallback-r2.json" \
  --content-type application/json \
  --cache-control "public, max-age=60, must-revalidate" \
  --if-match "$legacy_r2_etag" --endpoint-url "$r2_endpoint" >/dev/null

advance_journal committing before-public-readback
purge_legacy_caches pause
poll_legacy_bytes "${state_dir}/fallback-oss.json" pause

curl --proto '=https' --tlsv1.2 -sS --connect-timeout 10 --max-time 120 \
  -o "${state_dir}/public-legacy-oss.json" -w '%{http_code}' \
  "$LEGACY_ALIYUN_URL" >"${state_dir}/public-legacy-oss.status"
curl --proto '=https' --tlsv1.2 -sS --connect-timeout 10 --max-time 120 \
  -o "${state_dir}/public-legacy-r2.json" -w '%{http_code}' \
  "$LEGACY_R2_URL" >"${state_dir}/public-legacy-r2.status"

probe_router_state after
router_status="$(cat "${state_dir}/after-router-probe.status")"
router_state="$(cat "${state_dir}/after-router-probe.state")"
node scripts/updater/legacy-pause-transaction.mjs validate-router-probe \
  --before-status "$(cat "${state_dir}/before-router-probe.status")" \
  --before-state "$(cat "${state_dir}/before-router-probe.state")" \
  --after-status "$router_status" --after-state "$router_state" \
  --output "${state_dir}/router-pause-proof.json"

node scripts/updater/legacy-pause-transaction.mjs validate-readback \
  --policy "${state_dir}/paused-readback-policy.json" \
  --expected-policy "${state_dir}/policy-paused.json" \
  --fallback "${state_dir}/fallback-oss.json" \
  --oss-url "$LEGACY_ALIYUN_URL" \
  --oss-status "$(cat "${state_dir}/public-legacy-oss.status")" \
  --oss-bytes "${state_dir}/public-legacy-oss.json" \
  --r2-url "$LEGACY_R2_URL" \
  --r2-status "$(cat "${state_dir}/public-legacy-r2.status")" \
  --r2-bytes "${state_dir}/public-legacy-r2.json" \
  --router-status "$router_status" \
  --output "${state_dir}/pause-readback.json"

advance_journal committed policy-and-legacy-origins-verified
trap - ERR INT TERM
delete_open_journal
