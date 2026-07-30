#!/usr/bin/env bash
set -euo pipefail

terminal_recovery_only=false
if [[ "${1:-}" == "--recover-terminal-only" ]]; then
  terminal_recovery_only=true
  shift
fi
if [[ "$#" -ne 0 ]]; then
  echo "Usage: $0 [--recover-terminal-only]" >&2
  exit 2
fi

: "${CLOUDFLARE_R2_ACCOUNT_ID:?}"
: "${CLOUDFLARE_R2_BUCKET:?}"
: "${ALIYUN_OSS_BUCKET:?}"
: "${ALIYUN_OSS_ENDPOINT:?}"
: "${ALIYUN_REGION:?}"
: "${POLICY_KEY:?}"
: "${LEGACY_ALIYUN_KEY:?}"
: "${LEGACY_R2_KEY:?}"
: "${LEGACY_ALIYUN_URL:?}"
: "${LEGACY_R2_URL:?}"
: "${OPEN_TRANSACTION_KEY:?}"
: "${FROM_VERSION:?}"
: "${ROLLOUT:?}"

r2_endpoint="https://${CLOUDFLARE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
oss_endpoint="${ALIYUN_OSS_ENDPOINT#https://}"
oss_endpoint="https://${oss_endpoint#http://}"
target_version="$(jq -er .version dist/candidate/candidate.json)"
target_tag="$(jq -er .tag dist/candidate/candidate.json)"
source_commit="$(jq -er .sourceCommit dist/candidate/candidate.json)"
transaction_id="${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
transaction_prefix="biyan/updater/transactions/${transaction_id}"
legacy_staging_key="${transaction_prefix}/staging/legacy-latest.json"
journal=dist/state/promotion-journal.json

assert_aws_conditional_capabilities() {
  local put_skeleton delete_skeleton
  put_skeleton="$(aws s3api put-object --generate-cli-skeleton input)"
  delete_skeleton="$(aws s3api delete-object --generate-cli-skeleton input)"
  jq -e 'has("IfMatch") and has("IfNoneMatch")' \
    <<<"$put_skeleton" >/dev/null || return 1
  jq -e 'has("IfMatch")' <<<"$delete_skeleton" >/dev/null || return 1
}

assert_aws_conditional_capabilities
mkdir -p dist/state/probes dist/state/snapshots dist/state/ledger

probe_r2() {
  local key="$1" name="$2" rc
  if aws s3api head-object --bucket "$CLOUDFLARE_R2_BUCKET" --key "$key" \
    --endpoint-url "$r2_endpoint" \
    >"dist/state/probes/${name}.stdout" \
    2>"dist/state/probes/${name}.stderr"; then
    rc=0
  else
    rc=$?
  fi
  node scripts/updater/promotion-transaction.mjs classify-probe \
    --provider r2 --key "$key" --exit-code "$rc" \
    --stdout "dist/state/probes/${name}.stdout" \
    --stderr "dist/state/probes/${name}.stderr" \
    --output "dist/state/probes/${name}.json"
}

probe_oss() {
  local key="$1" name="$2" rc
  if ossutil api head-object --bucket "$ALIYUN_OSS_BUCKET" --key "$key" \
    --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" --output-format json --quiet \
    >"dist/state/probes/${name}.stdout" \
    2>"dist/state/probes/${name}.stderr"; then
    rc=0
  else
    rc=$?
  fi
  node scripts/updater/promotion-transaction.mjs classify-probe \
    --provider oss --key "$key" --exit-code "$rc" \
    --stdout "dist/state/probes/${name}.stdout" \
    --stderr "dist/state/probes/${name}.stderr" \
    --output "dist/state/probes/${name}.json"
}

put_oss_json() {
  local file="$1" key="$2" overwrite="${3:-true}"
  local args=(ossutil api put-object --bucket "$ALIYUN_OSS_BUCKET" --key "$key" \
    --body "file://${file}" --content-type application/json \
    --cache-control no-store --object-acl default \
    --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" --output-format json --quiet)
  # OSS overwrites by default. Omit the flag for mutable journal state instead
  # of relying on ossutil to serialize an explicit boolean false header.
  if [[ "$overwrite" != true ]]; then args+=(--forbid-overwrite true); fi
  "${args[@]}"
}

put_r2_json() {
  local file="$1" key="$2" overwrite="${3:-true}"
  local args=(
    s3api put-object --bucket "$CLOUDFLARE_R2_BUCKET" --key "$key"
    --body "$file" --content-type application/json --cache-control no-store
    --endpoint-url "$r2_endpoint"
  )
  if [[ "$overwrite" != true ]]; then args+=(--if-none-match '*'); fi
  aws "${args[@]}" >/dev/null
}

persist_journal() {
  (
    set -euo pipefail
    node scripts/updater/promotion-transaction.mjs validate-journal --journal "$journal"
    local sequence history_key
    sequence="$(jq -er .sequence "$journal")"
    history_key="${transaction_prefix}/journal-$(printf '%04d' "$sequence").json"
    put_r2_json "$journal" "$history_key" false
    put_oss_json "$journal" "$history_key" false
    aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" \
      --key "$history_key" --endpoint-url "$r2_endpoint" \
      "dist/state/journal-r2-history-${sequence}.json" \
      >"dist/state/journal-r2-history-${sequence}-metadata.json"
    ossutil cp "oss://${ALIYUN_OSS_BUCKET}/${history_key}" \
      "dist/state/journal-oss-history-${sequence}.json" --force \
      --endpoint "$oss_endpoint" --region "$ALIYUN_REGION"
    cmp "$journal" "dist/state/journal-r2-history-${sequence}.json"
    cmp "$journal" "dist/state/journal-oss-history-${sequence}.json"
    put_r2_json "$journal" "$OPEN_TRANSACTION_KEY"
    put_oss_json "$journal" "$OPEN_TRANSACTION_KEY" true
    aws s3 cp "s3://${CLOUDFLARE_R2_BUCKET}/${OPEN_TRANSACTION_KEY}" \
      dist/state/journal-r2-readback.json --endpoint-url "$r2_endpoint"
    ossutil cp "oss://${ALIYUN_OSS_BUCKET}/${OPEN_TRANSACTION_KEY}" \
      dist/state/journal-oss-readback.json --force \
      --endpoint "$oss_endpoint" --region "$ALIYUN_REGION"
    cmp "$journal" dist/state/journal-r2-readback.json
    cmp "$journal" dist/state/journal-oss-readback.json
  )
}

publish_transaction_next_policy() {
  local key expected_sha
  key="$(jq -er .nextPolicy.key "$journal")"
  expected_sha="$(jq -er .nextPolicy.sha256 "$journal")"
  probe_r2 "$key" next-policy-r2
  probe_oss "$key" next-policy-oss
  if jq -e '.state == "absent"' \
    dist/state/probes/next-policy-r2.json >/dev/null; then
    put_r2_json dist/state/next-policy.json "$key" false
  else
    jq -e '.state == "exists"' \
      dist/state/probes/next-policy-r2.json >/dev/null
  fi
  if jq -e '.state == "absent"' \
    dist/state/probes/next-policy-oss.json >/dev/null; then
    ossutil api put-object --bucket "$ALIYUN_OSS_BUCKET" --key "$key" \
      --body file://dist/state/next-policy.json \
      --content-type application/json --cache-control no-store \
      --object-acl private --forbid-overwrite true \
      --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" \
      --output-format json --quiet >/dev/null
  else
    jq -e '.state == "exists"' \
      dist/state/probes/next-policy-oss.json >/dev/null
  fi
  aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" --key "$key" \
    --endpoint-url "$r2_endpoint" dist/state/next-policy-r2-readback.json \
    >dist/state/next-policy-r2-readback-metadata.json
  ossutil cp "oss://${ALIYUN_OSS_BUCKET}/${key}" \
    dist/state/next-policy-oss-readback.json --force \
    --endpoint "$oss_endpoint" --region "$ALIYUN_REGION"
  ossutil api head-object --bucket "$ALIYUN_OSS_BUCKET" --key "$key" \
    --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" \
    --output-format json --quiet >dist/state/next-policy-oss-readback-metadata.json
  cmp dist/state/next-policy.json dist/state/next-policy-r2-readback.json
  cmp dist/state/next-policy.json dist/state/next-policy-oss-readback.json
  test "$(sha256sum dist/state/next-policy-r2-readback.json | cut -d' ' -f1)" \
    = "$expected_sha"
  node scripts/updater/promotion-transaction.mjs backup-metadata-plan \
    --metadata dist/state/next-policy-r2-readback-metadata.json \
    --output dist/state/next-policy-r2-metadata-plan.json
  node scripts/updater/promotion-transaction.mjs backup-metadata-plan \
    --metadata dist/state/next-policy-oss-readback-metadata.json \
    --output dist/state/next-policy-oss-metadata-plan.json
  jq -e '
    .contentType == "application/json" and .cacheControl == "no-store"
  ' dist/state/next-policy-r2-metadata-plan.json >/dev/null
  jq -e '
    .contentType == "application/json" and .cacheControl == "no-store"
  ' dist/state/next-policy-oss-metadata-plan.json >/dev/null
}

advance_journal() {
  local state="$1" checkpoint="$2" entry="${3:-}"
  local args=(
    advance-journal --journal "$journal" --state "$state"
    --checkpoint "$checkpoint" --updated-at "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
    --output dist/state/promotion-journal.next.json
  )
  if [[ -n "$entry" ]]; then args+=(--immutable-entry "$entry"); fi
  node scripts/updater/promotion-transaction.mjs "${args[@]}"
  mv dist/state/promotion-journal.next.json "$journal"
  persist_journal
}

delete_open_journal() {
  (
    set -euo pipefail
    local r2_state oss_state open_journal_etag
    local r2_delete_needed=false oss_delete_needed=false

    # Classify both providers before the first delete. A missing provider means
    # a prior cleanup attempt already completed that side; unknown still fails.
    probe_r2 "$OPEN_TRANSACTION_KEY" open-r2-predelete-probe
    r2_state="$(jq -er .state \
      dist/state/probes/open-r2-predelete-probe.json)"
    if [[ "$r2_state" == exists ]]; then
      r2_delete_needed=true
      aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" \
        --key "$OPEN_TRANSACTION_KEY" --endpoint-url "$r2_endpoint" \
        dist/state/open-journal-r2-predelete.json \
        >dist/state/open-journal-r2-predelete-metadata.json
      cmp "$journal" dist/state/open-journal-r2-predelete.json
      test "$(jq -er .transactionId \
        dist/state/open-journal-r2-predelete.json)" = "$transaction_id"
      node scripts/updater/promotion-transaction.mjs backup-metadata-plan \
        --metadata dist/state/open-journal-r2-predelete-metadata.json \
        --output dist/state/open-journal-r2-predelete-metadata-plan.json
      jq -e '
        .contentType == "application/json" and .cacheControl == "no-store"
      ' dist/state/open-journal-r2-predelete-metadata-plan.json >/dev/null
      open_journal_etag="$(node scripts/updater/promotion-transaction.mjs \
        extract-r2-etag \
        --metadata dist/state/open-journal-r2-predelete-metadata.json)"
    else
      test "$r2_state" = absent
    fi

    probe_oss "$OPEN_TRANSACTION_KEY" open-oss-predelete-probe
    oss_state="$(jq -er .state \
      dist/state/probes/open-oss-predelete-probe.json)"
    if [[ "$oss_state" == exists ]]; then
      oss_delete_needed=true
      ossutil cp "oss://${ALIYUN_OSS_BUCKET}/${OPEN_TRANSACTION_KEY}" \
        dist/state/open-journal-oss-predelete.json --force \
        --endpoint "$oss_endpoint" --region "$ALIYUN_REGION"
      ossutil api head-object --bucket "$ALIYUN_OSS_BUCKET" \
        --key "$OPEN_TRANSACTION_KEY" --endpoint "$oss_endpoint" \
        --region "$ALIYUN_REGION" --output-format json --quiet \
        >dist/state/open-journal-oss-predelete-metadata.json
      cmp "$journal" dist/state/open-journal-oss-predelete.json
      test "$(jq -er .transactionId \
        dist/state/open-journal-oss-predelete.json)" = "$transaction_id"
      node scripts/updater/promotion-transaction.mjs backup-metadata-plan \
        --metadata dist/state/open-journal-oss-predelete-metadata.json \
        --output dist/state/open-journal-oss-predelete-metadata-plan.json
      jq -e '
        .contentType == "application/json" and .cacheControl == "no-store"
      ' dist/state/open-journal-oss-predelete-metadata-plan.json >/dev/null
    else
      test "$oss_state" = absent
    fi

    if [[ "$r2_delete_needed" == true ]]; then
      aws s3api delete-object --bucket "$CLOUDFLARE_R2_BUCKET" \
        --key "$OPEN_TRANSACTION_KEY" --if-match "$open_journal_etag" \
        --endpoint-url "$r2_endpoint" >/dev/null
    fi
    if [[ "$oss_delete_needed" == true ]]; then
      # OSS has no destination If-Match delete. Re-read bytes and metadata
      # immediately before its delete and accept a concurrent absence as done.
      probe_oss "$OPEN_TRANSACTION_KEY" open-oss-immediate-probe
      oss_state="$(jq -er .state \
        dist/state/probes/open-oss-immediate-probe.json)"
      if [[ "$oss_state" == exists ]]; then
        ossutil cp "oss://${ALIYUN_OSS_BUCKET}/${OPEN_TRANSACTION_KEY}" \
          dist/state/open-journal-oss-immediate.json --force \
          --endpoint "$oss_endpoint" --region "$ALIYUN_REGION"
        ossutil api head-object --bucket "$ALIYUN_OSS_BUCKET" \
          --key "$OPEN_TRANSACTION_KEY" --endpoint "$oss_endpoint" \
          --region "$ALIYUN_REGION" --output-format json --quiet \
          >dist/state/open-journal-oss-immediate-metadata.json
        cmp "$journal" dist/state/open-journal-oss-immediate.json
        test "$(jq -er .transactionId \
          dist/state/open-journal-oss-immediate.json)" = "$transaction_id"
        node scripts/updater/promotion-transaction.mjs backup-metadata-plan \
          --metadata dist/state/open-journal-oss-immediate-metadata.json \
          --output dist/state/open-journal-oss-immediate-metadata-plan.json
        jq -e '
          .contentType == "application/json" and .cacheControl == "no-store"
        ' dist/state/open-journal-oss-immediate-metadata-plan.json >/dev/null
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
      dist/state/probes/open-r2-deleted.json >/dev/null
    jq -e '.state == "absent"' \
      dist/state/probes/open-oss-deleted.json >/dev/null
  )
}

publish_snapshot_backup_r2() {
  local index="$1" file="$2" key="$3" name="$4" plan="$5"
  local content_type cache_control
  content_type="$(jq -er .contentType "$plan")"
  cache_control="$(jq -er .cacheControl "$plan")"
  probe_r2 "$key" "${name}-probe"
  if jq -e '.state == "absent"' \
    "dist/state/probes/${name}-probe.json" >/dev/null; then
    aws s3api put-object --bucket "$CLOUDFLARE_R2_BUCKET" --key "$key" \
      --body "$file" --content-type "$content_type" \
      --cache-control "$cache_control" --if-none-match '*' \
      --endpoint-url "$r2_endpoint" >/dev/null
  else
    jq -e '.state == "exists"' \
      "dist/state/probes/${name}-probe.json" >/dev/null
  fi
  aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" --key "$key" \
    --endpoint-url "$r2_endpoint" "dist/state/${name}-readback" \
    >"dist/state/${name}-metadata.json"
  node scripts/updater/promotion-transaction.mjs verify-snapshot-readback \
    --journal "$journal" --index "$index" \
    --bytes "dist/state/${name}-readback" \
    --metadata "dist/state/${name}-metadata.json" \
    --output "dist/state/${name}-verified.json"
}

publish_snapshot_backup_oss() {
  local index="$1" file="$2" key="$3" name="$4" plan="$5" acl="$6"
  local content_type cache_control
  content_type="$(jq -er .contentType "$plan")"
  cache_control="$(jq -er .cacheControl "$plan")"
  probe_oss "$key" "${name}-probe"
  if jq -e '.state == "absent"' \
    "dist/state/probes/${name}-probe.json" >/dev/null; then
    ossutil api put-object --bucket "$ALIYUN_OSS_BUCKET" --key "$key" \
      --body "file://${file}" --content-type "$content_type" \
      --cache-control "$cache_control" --object-acl "$acl" \
      --forbid-overwrite true --endpoint "$oss_endpoint" \
      --region "$ALIYUN_REGION" --output-format json --quiet >/dev/null
  else
    jq -e '.state == "exists"' \
      "dist/state/probes/${name}-probe.json" >/dev/null
  fi
  ossutil cp "oss://${ALIYUN_OSS_BUCKET}/${key}" \
    "dist/state/${name}-readback" --force \
    --endpoint "$oss_endpoint" --region "$ALIYUN_REGION"
  ossutil api head-object --bucket "$ALIYUN_OSS_BUCKET" --key "$key" \
    --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" \
    --output-format json --quiet >"dist/state/${name}-metadata.json"
  ossutil api get-object-acl --bucket "$ALIYUN_OSS_BUCKET" --key "$key" \
    --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" \
    --output-format json --quiet >"dist/state/${name}-acl.json"
  node scripts/updater/promotion-transaction.mjs verify-snapshot-readback \
    --journal "$journal" --index "$index" \
    --bytes "dist/state/${name}-readback" \
    --metadata "dist/state/${name}-metadata.json" \
    --acl "dist/state/${name}-acl.json" \
    --output "dist/state/${name}-verified.json"
}

classify_ledger_object() {
  local stage="$1" index="$2"
  local provider key expected_sha expected_type expected_cache actual_sha state
  provider="$(jq -er --argjson index "$index" \
    '.[$index].provider' dist/state/ledger-cleanup.json)"
  key="$(jq -er --argjson index "$index" \
    '.[$index].key' dist/state/ledger-cleanup.json)"
  expected_sha="$(jq -er --argjson index "$index" \
    '.[$index].sha256' dist/state/ledger-cleanup.json)"
  expected_type="$(jq -er --argjson index "$index" \
    '.[$index].contentType' dist/state/ledger-cleanup.json)"
  expected_cache="$(jq -er --argjson index "$index" \
    '.[$index].cacheControl' dist/state/ledger-cleanup.json)"
  mkdir -p dist/state/ledger-cleanup
  if [[ "$provider" == r2 ]]; then
    probe_r2 "$key" "ledger-${stage}-${index}-r2" || return 1
    state="$(jq -er .state \
      "dist/state/probes/ledger-${stage}-${index}-r2.json")" || return 1
    printf '%s\n' "$state" \
      >"dist/state/ledger-cleanup/${stage}-${index}.state"
    if [[ "$state" == absent ]]; then return 0; fi
    test "$state" = exists || return 1
    aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" --key "$key" \
      --endpoint-url "$r2_endpoint" \
      "dist/state/ledger-cleanup/${stage}-${index}.bytes" \
      >"dist/state/ledger-cleanup/${stage}-${index}.metadata.json" \
      || return 1
    node scripts/updater/promotion-transaction.mjs extract-r2-etag \
      --metadata "dist/state/ledger-cleanup/${stage}-${index}.metadata.json" \
      >"dist/state/ledger-cleanup/${stage}-${index}.etag" \
      || return 1
  elif [[ "$provider" == oss ]]; then
    probe_oss "$key" "ledger-${stage}-${index}-oss" || return 1
    state="$(jq -er .state \
      "dist/state/probes/ledger-${stage}-${index}-oss.json")" || return 1
    printf '%s\n' "$state" \
      >"dist/state/ledger-cleanup/${stage}-${index}.state"
    if [[ "$state" == absent ]]; then return 0; fi
    test "$state" = exists || return 1
    ossutil cp "oss://${ALIYUN_OSS_BUCKET}/${key}" \
      "dist/state/ledger-cleanup/${stage}-${index}.bytes" --force \
      --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" \
      || return 1
    ossutil api head-object --bucket "$ALIYUN_OSS_BUCKET" --key "$key" \
      --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" \
      --output-format json --quiet \
      >"dist/state/ledger-cleanup/${stage}-${index}.metadata.json" \
      || return 1
  else
    return 1
  fi
  actual_sha="$(sha256sum \
    "dist/state/ledger-cleanup/${stage}-${index}.bytes" | cut -d' ' -f1)"
  test "$actual_sha" = "$expected_sha" || return 1
  node scripts/updater/promotion-transaction.mjs backup-metadata-plan \
    --metadata "dist/state/ledger-cleanup/${stage}-${index}.metadata.json" \
    --output "dist/state/ledger-cleanup/${stage}-${index}.metadata-plan.json" \
    || return 1
  jq -e --arg contentType "$expected_type" \
    --arg cacheControl "$expected_cache" '
      .contentType == $contentType and .cacheControl == $cacheControl
    ' "dist/state/ledger-cleanup/${stage}-${index}.metadata-plan.json" \
    >/dev/null || return 1
}

verify_json_metadata() {
  local metadata="$1" output="$2" cache_control="$3"
  node scripts/updater/promotion-transaction.mjs backup-metadata-plan \
    --metadata "$metadata" --output "$output"
  jq -e --arg cache "$cache_control" '
    .contentType == "application/json" and .cacheControl == $cache
  ' "$output" >/dev/null
}

recover_terminal_open_journal() {
  mkdir -p \
    dist/state/terminal-recovery \
    dist/state/terminal-recovery/backups \
    dist/state/terminal-recovery/live

  probe_r2 "$OPEN_TRANSACTION_KEY" terminal-open-r2
  probe_oss "$OPEN_TRANSACTION_KEY" terminal-open-oss
  local r2_state oss_state
  r2_state="$(jq -er .state \
    dist/state/probes/terminal-open-r2.json)"
  oss_state="$(jq -er .state \
    dist/state/probes/terminal-open-oss.json)"
  if [[ "$r2_state" == absent && "$oss_state" == absent ]]; then
    jq -n '{
      schema: 1,
      status: "none",
      terminalState: null,
      transactionId: null,
      sameRequest: false
    }' >dist/state/terminal-promotion-recovery.json
    return
  fi
  case "$r2_state:$oss_state" in
    exists:exists|exists:absent|absent:exists) ;;
    *) echo "Terminal promotion lock state is unclassified" >&2; return 1 ;;
  esac

  local terminal_journal
  terminal_journal=dist/state/terminal-recovery/open-journal.json
  if [[ "$r2_state" == exists ]]; then
    aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" \
      --key "$OPEN_TRANSACTION_KEY" --endpoint-url "$r2_endpoint" \
      dist/state/terminal-recovery/open-journal-r2.json \
      >dist/state/terminal-recovery/open-journal-r2-metadata.json
    verify_json_metadata \
      dist/state/terminal-recovery/open-journal-r2-metadata.json \
      dist/state/terminal-recovery/open-journal-r2-metadata-plan.json \
      no-store
    cp dist/state/terminal-recovery/open-journal-r2.json "$terminal_journal"
  fi
  if [[ "$oss_state" == exists ]]; then
    ossutil cp \
      "oss://${ALIYUN_OSS_BUCKET}/${OPEN_TRANSACTION_KEY}" \
      dist/state/terminal-recovery/open-journal-oss.json --force \
      --endpoint "$oss_endpoint" --region "$ALIYUN_REGION"
    ossutil api head-object --bucket "$ALIYUN_OSS_BUCKET" \
      --key "$OPEN_TRANSACTION_KEY" --endpoint "$oss_endpoint" \
      --region "$ALIYUN_REGION" --output-format json --quiet \
      >dist/state/terminal-recovery/open-journal-oss-metadata.json
    verify_json_metadata \
      dist/state/terminal-recovery/open-journal-oss-metadata.json \
      dist/state/terminal-recovery/open-journal-oss-metadata-plan.json \
      no-store
    if [[ "$r2_state" == exists ]]; then
      cmp "$terminal_journal" \
        dist/state/terminal-recovery/open-journal-oss.json
    else
      cp dist/state/terminal-recovery/open-journal-oss.json \
        "$terminal_journal"
    fi
  fi

  node scripts/updater/promotion-transaction.mjs validate-journal \
    --journal "$terminal_journal"
  local terminal_state terminal_sequence history_key next_policy_key
  terminal_state="$(jq -er .state "$terminal_journal")"
  case "$terminal_state" in
    committed|rolled-back) ;;
    *)
      echo "Open promotion journal is not terminal" >&2
      return 1
      ;;
  esac
  jq -e '.recovery.required == false' "$terminal_journal" >/dev/null
  transaction_id="$(jq -er .transactionId "$terminal_journal")"
  transaction_prefix="biyan/updater/transactions/${transaction_id}"
  terminal_sequence="$(jq -er .sequence "$terminal_journal")"
  history_key="${transaction_prefix}/journal-$(printf '%04d' \
    "$terminal_sequence").json"

  aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" \
    --key "$history_key" --endpoint-url "$r2_endpoint" \
    dist/state/terminal-recovery/history-r2.json \
    >dist/state/terminal-recovery/history-r2-metadata.json
  ossutil cp "oss://${ALIYUN_OSS_BUCKET}/${history_key}" \
    dist/state/terminal-recovery/history-oss.json --force \
    --endpoint "$oss_endpoint" --region "$ALIYUN_REGION"
  ossutil api head-object --bucket "$ALIYUN_OSS_BUCKET" \
    --key "$history_key" --endpoint "$oss_endpoint" \
    --region "$ALIYUN_REGION" --output-format json --quiet \
    >dist/state/terminal-recovery/history-oss-metadata.json
  cmp "$terminal_journal" dist/state/terminal-recovery/history-r2.json
  cmp "$terminal_journal" dist/state/terminal-recovery/history-oss.json
  verify_json_metadata \
    dist/state/terminal-recovery/history-r2-metadata.json \
    dist/state/terminal-recovery/history-r2-metadata-plan.json no-store
  verify_json_metadata \
    dist/state/terminal-recovery/history-oss-metadata.json \
    dist/state/terminal-recovery/history-oss-metadata-plan.json no-store

  next_policy_key="$(jq -er .nextPolicy.key "$terminal_journal")"
  aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" \
    --key "$next_policy_key" --endpoint-url "$r2_endpoint" \
    dist/state/terminal-recovery/next-policy-r2.json \
    >dist/state/terminal-recovery/next-policy-r2-metadata.json
  ossutil cp "oss://${ALIYUN_OSS_BUCKET}/${next_policy_key}" \
    dist/state/terminal-recovery/next-policy-oss.json --force \
    --endpoint "$oss_endpoint" --region "$ALIYUN_REGION"
  ossutil api head-object --bucket "$ALIYUN_OSS_BUCKET" \
    --key "$next_policy_key" --endpoint "$oss_endpoint" \
    --region "$ALIYUN_REGION" --output-format json --quiet \
    >dist/state/terminal-recovery/next-policy-oss-metadata.json
  cmp dist/state/terminal-recovery/next-policy-r2.json \
    dist/state/terminal-recovery/next-policy-oss.json
  test "$(sha256sum \
    dist/state/terminal-recovery/next-policy-r2.json | cut -d' ' -f1)" \
    = "$(jq -er .nextPolicy.sha256 "$terminal_journal")"
  verify_json_metadata \
    dist/state/terminal-recovery/next-policy-r2-metadata.json \
    dist/state/terminal-recovery/next-policy-r2-metadata-plan.json no-store
  verify_json_metadata \
    dist/state/terminal-recovery/next-policy-oss-metadata.json \
    dist/state/terminal-recovery/next-policy-oss-metadata-plan.json no-store

  local policy_index legacy_oss_index legacy_r2_index policy_existed
  policy_index="$(jq -er --arg key "$POLICY_KEY" '
    [.snapshots | to_entries[]
      | select(.value.provider == "r2" and .value.key == $key)]
    | if length == 1 then .[0].key else error("policy snapshot") end
  ' "$terminal_journal")"
  legacy_oss_index="$(jq -er --arg key "$LEGACY_ALIYUN_KEY" '
    [.snapshots | to_entries[]
      | select(.value.provider == "oss" and .value.key == $key)]
    | if length == 1 then .[0].key else error("OSS legacy snapshot") end
  ' "$terminal_journal")"
  legacy_r2_index="$(jq -er --arg key "$LEGACY_R2_KEY" '
    [.snapshots | to_entries[]
      | select(.value.provider == "r2" and .value.key == $key)]
    | if length == 1 then .[0].key else error("R2 legacy snapshot") end
  ' "$terminal_journal")"
  test "$(jq '.snapshots | length' "$terminal_journal")" = 3
  policy_existed="$(jq -r --argjson index "$policy_index" \
    '.snapshots[$index].existed' "$terminal_journal")"
  case "$policy_existed" in
    true|false) ;;
    *) echo "Terminal policy snapshot existence is invalid" >&2; return 1 ;;
  esac

  local policy_backup legacy_oss_backup legacy_r2_backup
  if [[ "$policy_existed" == true ]]; then
    policy_backup="$(jq -er --argjson index "$policy_index" \
      '.snapshots[$index].backupKey' "$terminal_journal")"
    aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" \
      --key "$policy_backup" --endpoint-url "$r2_endpoint" \
      dist/state/terminal-recovery/backups/policy.json \
      >dist/state/terminal-recovery/backups/policy-metadata.json
    node scripts/updater/promotion-transaction.mjs verify-snapshot-readback \
      --journal "$terminal_journal" --index "$policy_index" \
      --bytes dist/state/terminal-recovery/backups/policy.json \
      --metadata dist/state/terminal-recovery/backups/policy-metadata.json \
      --output dist/state/terminal-recovery/backups/policy-verified.json
  fi

  legacy_oss_backup="$(jq -er --argjson index "$legacy_oss_index" \
    '.snapshots[$index].backupKey' "$terminal_journal")"
  ossutil cp "oss://${ALIYUN_OSS_BUCKET}/${legacy_oss_backup}" \
    dist/state/terminal-recovery/backups/legacy-oss.json --force \
    --endpoint "$oss_endpoint" --region "$ALIYUN_REGION"
  ossutil api head-object --bucket "$ALIYUN_OSS_BUCKET" \
    --key "$legacy_oss_backup" --endpoint "$oss_endpoint" \
    --region "$ALIYUN_REGION" --output-format json --quiet \
    >dist/state/terminal-recovery/backups/legacy-oss-metadata.json
  ossutil api get-object-acl --bucket "$ALIYUN_OSS_BUCKET" \
    --key "$legacy_oss_backup" --endpoint "$oss_endpoint" \
    --region "$ALIYUN_REGION" --output-format json --quiet \
    >dist/state/terminal-recovery/backups/legacy-oss-acl.json
  node scripts/updater/promotion-transaction.mjs verify-snapshot-readback \
    --journal "$terminal_journal" --index "$legacy_oss_index" \
    --bytes dist/state/terminal-recovery/backups/legacy-oss.json \
    --metadata dist/state/terminal-recovery/backups/legacy-oss-metadata.json \
    --acl dist/state/terminal-recovery/backups/legacy-oss-acl.json \
    --output dist/state/terminal-recovery/backups/legacy-oss-verified.json

  legacy_r2_backup="$(jq -er --argjson index "$legacy_r2_index" \
    '.snapshots[$index].backupKey' "$terminal_journal")"
  aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" \
    --key "$legacy_r2_backup" --endpoint-url "$r2_endpoint" \
    dist/state/terminal-recovery/backups/legacy-r2.json \
    >dist/state/terminal-recovery/backups/legacy-r2-metadata.json
  node scripts/updater/promotion-transaction.mjs verify-snapshot-readback \
    --journal "$terminal_journal" --index "$legacy_r2_index" \
    --bytes dist/state/terminal-recovery/backups/legacy-r2.json \
    --metadata dist/state/terminal-recovery/backups/legacy-r2-metadata.json \
    --output dist/state/terminal-recovery/backups/legacy-r2-verified.json

  : "${PHASE:?}"
  : "${EXPECTED_CURRENT:?}"
  : "${DRY_RUN:?}"
  local plan_args
  plan_args=(
    terminal-recovery-plan
    --journal "$terminal_journal"
    --next-policy dist/state/terminal-recovery/next-policy-r2.json
    --candidate dist/candidate/candidate.json
    --phase "$PHASE"
    --from-version "$FROM_VERSION"
    --expected-current "$EXPECTED_CURRENT"
    --rollout "$ROLLOUT"
    --smoke-evidence dist/state/verified-smoke.json
    --health-evidence dist/state/verified-health.json
    --output dist/state/terminal-recovery/plan.json
  )
  if [[ "$policy_existed" == true ]]; then
    plan_args+=(
      --before-policy dist/state/terminal-recovery/backups/policy.json
    )
  else
    plan_args+=(--before-policy-absent true)
  fi
  node scripts/updater/promotion-transaction.mjs "${plan_args[@]}"
  test "$(jq -er .terminalState \
    dist/state/terminal-recovery/plan.json)" = "$terminal_state"
  test "$(jq -er .transactionId \
    dist/state/terminal-recovery/plan.json)" = "$transaction_id"

  jq '[
    .immutableLedger[]
    | select(.createdByTransaction and .verified)
  ] | unique_by([.provider, .key])' "$terminal_journal" \
    >dist/state/ledger-cleanup.json
  local ledger_count ledger_index ledger_state
  ledger_count="$(jq -er length dist/state/ledger-cleanup.json)"
  for ((ledger_index = 0; ledger_index < ledger_count; ledger_index += 1)); do
    classify_ledger_object terminal "$ledger_index"
    ledger_state="$(cat \
      "dist/state/ledger-cleanup/terminal-${ledger_index}.state")"
    if [[ "$terminal_state" == committed ]]; then
      test "$ledger_state" = exists
    else
      test "$ledger_state" = absent
    fi
  done

  probe_r2 "$POLICY_KEY" terminal-live-policy
  local live_policy_state
  live_policy_state="$(jq -er .state \
    dist/state/probes/terminal-live-policy.json)"
  if [[ "$terminal_state" == committed ]]; then
    test "$live_policy_state" = exists
    aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" \
      --key "$POLICY_KEY" --endpoint-url "$r2_endpoint" \
      dist/state/terminal-recovery/live/policy.json \
      >dist/state/terminal-recovery/live/policy-metadata.json
    cmp dist/state/terminal-recovery/next-policy-r2.json \
      dist/state/terminal-recovery/live/policy.json
    verify_json_metadata \
      dist/state/terminal-recovery/live/policy-metadata.json \
      dist/state/terminal-recovery/live/policy-metadata-plan.json no-store
  elif [[ "$policy_existed" == true ]]; then
    test "$live_policy_state" = exists
    aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" \
      --key "$POLICY_KEY" --endpoint-url "$r2_endpoint" \
      dist/state/terminal-recovery/live/policy.json \
      >dist/state/terminal-recovery/live/policy-metadata.json
    node scripts/updater/promotion-transaction.mjs verify-snapshot-readback \
      --journal "$terminal_journal" --index "$policy_index" \
      --bytes dist/state/terminal-recovery/live/policy.json \
      --metadata dist/state/terminal-recovery/live/policy-metadata.json \
      --output dist/state/terminal-recovery/live/policy-verified.json
  else
    test "$live_policy_state" = absent
  fi

  local expected_legacy_oss expected_legacy_r2 legacy_target_key
  if [[ "$terminal_state" == committed ]]; then
    legacy_target_key="$(jq -er .legacyTarget.key \
      dist/state/terminal-recovery/plan.json)"
    ossutil cp "oss://${ALIYUN_OSS_BUCKET}/${legacy_target_key}" \
      dist/state/terminal-recovery/legacy-target-oss.json --force \
      --endpoint "$oss_endpoint" --region "$ALIYUN_REGION"
    ossutil api head-object --bucket "$ALIYUN_OSS_BUCKET" \
      --key "$legacy_target_key" --endpoint "$oss_endpoint" \
      --region "$ALIYUN_REGION" --output-format json --quiet \
      >dist/state/terminal-recovery/legacy-target-oss-metadata.json
    aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" \
      --key "$legacy_target_key" --endpoint-url "$r2_endpoint" \
      dist/state/terminal-recovery/legacy-target-r2.json \
      >dist/state/terminal-recovery/legacy-target-r2-metadata.json
    cmp dist/state/terminal-recovery/legacy-target-oss.json \
      dist/state/terminal-recovery/legacy-target-r2.json
    test "$(sha256sum \
      dist/state/terminal-recovery/legacy-target-r2.json | cut -d' ' -f1)" \
      = "$(jq -er .legacyTarget.sha256 \
        dist/state/terminal-recovery/plan.json)"
    verify_json_metadata \
      dist/state/terminal-recovery/legacy-target-oss-metadata.json \
      dist/state/terminal-recovery/legacy-target-oss-metadata-plan.json \
      "public, max-age=31536000, immutable"
    verify_json_metadata \
      dist/state/terminal-recovery/legacy-target-r2-metadata.json \
      dist/state/terminal-recovery/legacy-target-r2-metadata-plan.json \
      "public, max-age=31536000, immutable"
    expected_legacy_oss=dist/state/terminal-recovery/legacy-target-oss.json
    expected_legacy_r2=dist/state/terminal-recovery/legacy-target-r2.json
  else
    expected_legacy_oss=dist/state/terminal-recovery/backups/legacy-oss.json
    expected_legacy_r2=dist/state/terminal-recovery/backups/legacy-r2.json
  fi

  probe_oss "$LEGACY_ALIYUN_KEY" terminal-live-legacy-oss
  probe_r2 "$LEGACY_R2_KEY" terminal-live-legacy-r2
  jq -e '.state == "exists"' \
    dist/state/probes/terminal-live-legacy-oss.json >/dev/null
  jq -e '.state == "exists"' \
    dist/state/probes/terminal-live-legacy-r2.json >/dev/null
  ossutil cp "oss://${ALIYUN_OSS_BUCKET}/${LEGACY_ALIYUN_KEY}" \
    dist/state/terminal-recovery/live/legacy-oss.json --force \
    --endpoint "$oss_endpoint" --region "$ALIYUN_REGION"
  ossutil api head-object --bucket "$ALIYUN_OSS_BUCKET" \
    --key "$LEGACY_ALIYUN_KEY" --endpoint "$oss_endpoint" \
    --region "$ALIYUN_REGION" --output-format json --quiet \
    >dist/state/terminal-recovery/live/legacy-oss-metadata.json
  ossutil api get-object-acl --bucket "$ALIYUN_OSS_BUCKET" \
    --key "$LEGACY_ALIYUN_KEY" --endpoint "$oss_endpoint" \
    --region "$ALIYUN_REGION" --output-format json --quiet \
    >dist/state/terminal-recovery/live/legacy-oss-acl.json
  aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" \
    --key "$LEGACY_R2_KEY" --endpoint-url "$r2_endpoint" \
    dist/state/terminal-recovery/live/legacy-r2.json \
    >dist/state/terminal-recovery/live/legacy-r2-metadata.json
  cmp "$expected_legacy_oss" \
    dist/state/terminal-recovery/live/legacy-oss.json
  cmp "$expected_legacy_r2" \
    dist/state/terminal-recovery/live/legacy-r2.json
  if [[ "$terminal_state" == committed ]]; then
    verify_json_metadata \
      dist/state/terminal-recovery/live/legacy-oss-metadata.json \
      dist/state/terminal-recovery/live/legacy-oss-metadata-plan.json \
      "public, max-age=60, must-revalidate"
    verify_json_metadata \
      dist/state/terminal-recovery/live/legacy-r2-metadata.json \
      dist/state/terminal-recovery/live/legacy-r2-metadata-plan.json \
      "public, max-age=60, must-revalidate"
    node scripts/updater/promotion-transaction.mjs verify-snapshot-acl \
      --journal "$terminal_journal" --index "$legacy_oss_index" \
      --acl dist/state/terminal-recovery/live/legacy-oss-acl.json
  else
    node scripts/updater/promotion-transaction.mjs verify-snapshot-readback \
      --journal "$terminal_journal" --index "$legacy_oss_index" \
      --bytes dist/state/terminal-recovery/live/legacy-oss.json \
      --metadata dist/state/terminal-recovery/live/legacy-oss-metadata.json \
      --acl dist/state/terminal-recovery/live/legacy-oss-acl.json \
      --output dist/state/terminal-recovery/live/legacy-oss-verified.json
    node scripts/updater/promotion-transaction.mjs verify-snapshot-readback \
      --journal "$terminal_journal" --index "$legacy_r2_index" \
      --bytes dist/state/terminal-recovery/live/legacy-r2.json \
      --metadata dist/state/terminal-recovery/live/legacy-r2-metadata.json \
      --output dist/state/terminal-recovery/live/legacy-r2-verified.json
  fi
  node scripts/updater/promotion-transaction.mjs poll-url \
    --url "$LEGACY_ALIYUN_URL" --expected "$expected_legacy_oss" \
    --timeout-seconds 600 --interval-seconds 10 \
    --output dist/state/terminal-recovery/live/legacy-aliyun-cdn.json
  node scripts/updater/promotion-transaction.mjs poll-url \
    --url "$LEGACY_R2_URL" --expected "$expected_legacy_r2" \
    --timeout-seconds 600 --interval-seconds 10 \
    --output dist/state/terminal-recovery/live/legacy-r2-cdn.json

  : "${BIYAN_SIGNING_KEY:?}"
  : "${ROLLOUT_SALT:?}"
  : "${DYNAMIC_UPDATER_BASE_URL:?}"
  local router_count router_index router_current router_target router_rollout
  local expected_status expected_state endpoint status signed_state key value
  local -a curl_args
  router_count="$(jq -er '(.routers // [.router]) | length' \
    dist/state/terminal-recovery/plan.json)"
  for ((router_index = 0; router_index < router_count; router_index += 1)); do
    router_current="$(jq -er --argjson index "$router_index" \
      '(.routers // [.router])[$index].currentVersion' \
      dist/state/terminal-recovery/plan.json)"
    router_target="$(jq -er --argjson index "$router_index" \
      '(.routers // [.router])[$index].targetVersion' \
      dist/state/terminal-recovery/plan.json)"
    router_rollout="$(jq -er --argjson index "$router_index" \
      '(.routers // [.router])[$index].rollout' \
      dist/state/terminal-recovery/plan.json)"
    expected_status="$(jq -er --argjson index "$router_index" \
      '(.routers // [.router])[$index].expectedStatus' \
      dist/state/terminal-recovery/plan.json)"
    expected_state="$(jq -r --argjson index "$router_index" \
      '(.routers // [.router])[$index].expectedState // ""' \
      dist/state/terminal-recovery/plan.json)"
    node scripts/updater/sign-request.mjs \
      --current-version "$router_current" \
      --target-version "$router_target" \
      --rollout "$router_rollout" --salt "$ROLLOUT_SALT" \
      --output "dist/state/terminal-recovery/router-${router_index}-request-headers.json"
    endpoint="${DYNAMIC_UPDATER_BASE_URL}/windows/x86_64/${router_current}"
    curl_args=(
      --proto '=https' --tlsv1.2 --silent --show-error
      --connect-timeout 10 --max-time 120
      --dump-header "dist/state/terminal-recovery/router-${router_index}-response.headers"
      --output "dist/state/terminal-recovery/router-${router_index}-response.json"
      --write-out '%{http_code}' "$endpoint"
    )
    while IFS=$'\t' read -r key value; do
      curl_args+=(--header "$key: $value")
    done < <(jq -r 'to_entries[] | [.key, .value] | @tsv' \
      "dist/state/terminal-recovery/router-${router_index}-request-headers.json")
    status="$(curl "${curl_args[@]}")"
    test "$status" = "$expected_status"
    if [[ "$expected_status" == 200 ]]; then
      test "$(jq -er .version \
        "dist/state/terminal-recovery/router-${router_index}-response.json")" \
        = "$router_target"
    else
      test ! -s \
        "dist/state/terminal-recovery/router-${router_index}-response.json"
      signed_state="$(awk -F ': *' '
        tolower($1) == "x-biyan-updater-state" {
          gsub(/\r/, "", $2)
          value = $2
        }
        END { print value }
      ' "dist/state/terminal-recovery/router-${router_index}-response.headers")"
      test "$signed_state" = "$expected_state"
    fi
  done

  if [[ "$DRY_RUN" == true ]]; then
    echo "Dry-run verified a terminal journal but will not delete it" >&2
    return 1
  fi

  journal="$terminal_journal"
  delete_open_journal
  jq -n \
    --arg state "$terminal_state" \
    --arg transaction "$transaction_id" \
    --argjson same "$(jq -er .sameRequest \
      dist/state/terminal-recovery/plan.json)" \
    '{
      schema: 1,
      status: "cleaned-terminal-promotion",
      terminalState: $state,
      transactionId: $transaction,
      sameRequest: $same
    }' >dist/state/terminal-promotion-recovery.json
}

if [[ "$terminal_recovery_only" == true ]]; then
  recover_terminal_open_journal
  exit 0
fi

resume_from_pause=false
if [[ -f dist/state/current-policy.json ]] \
  && jq -e '.paused == true' dist/state/current-policy.json >/dev/null; then
  resume_from_pause=true
fi
current_legacy_version="$(jq -r '.legacyBridgeVersion // empty' \
  dist/state/current-policy.json 2>/dev/null || true)"
next_legacy_version="$(jq -er .legacyBridgeVersion \
  dist/state/next-policy.json)"
first_legacy_promotion=false
if [[ "$current_legacy_version" == "" ]]; then
  first_legacy_promotion=true
fi
update_legacy=false
if [[ "$current_legacy_version" != "$next_legacy_version" ]] \
  || [[ "$resume_from_pause" == true ]]; then
  update_legacy=true
fi
legacy_publish_source=dist/candidate/latest.json
if [[ "$current_legacy_version" != "$next_legacy_version" ]]; then
  test "$next_legacy_version" = "$target_version"
fi

probe_r2 "$OPEN_TRANSACTION_KEY" open-r2-commit
probe_oss "$OPEN_TRANSACTION_KEY" open-oss-commit
jq -e '.state == "absent"' dist/state/probes/open-r2-commit.json >/dev/null
jq -e '.state == "absent"' dist/state/probes/open-oss-commit.json >/dev/null

probe_r2 "$POLICY_KEY" policy-r2-commit
probe_oss "$LEGACY_ALIYUN_KEY" legacy-oss-commit
probe_r2 "$LEGACY_R2_KEY" legacy-r2-commit
jq -e '.state == "exists"' dist/state/probes/legacy-oss-commit.json >/dev/null
jq -e '.state == "exists"' dist/state/probes/legacy-r2-commit.json >/dev/null

policy_existed="$(jq -r '.state == "exists"' dist/state/probes/policy-r2-commit.json)"
policy_original_etag=""
if [[ "$policy_existed" == true ]]; then
  policy_original_etag="$(node scripts/updater/promotion-transaction.mjs \
    extract-r2-etag \
    --metadata dist/state/probes/policy-r2-commit.stdout)"
  aws s3 cp "s3://${CLOUDFLARE_R2_BUCKET}/${POLICY_KEY}" \
    dist/state/snapshots/policy.json --endpoint-url "$r2_endpoint"
  cmp dist/state/current-policy.json dist/state/snapshots/policy.json
fi
ossutil cp "oss://${ALIYUN_OSS_BUCKET}/${LEGACY_ALIYUN_KEY}" \
  dist/state/snapshots/legacy-oss.json --force \
  --endpoint "$oss_endpoint" --region "$ALIYUN_REGION"
aws s3 cp "s3://${CLOUDFLARE_R2_BUCKET}/${LEGACY_R2_KEY}" \
  dist/state/snapshots/legacy-r2.json --endpoint-url "$r2_endpoint"
cmp dist/state/snapshots/legacy-oss.json dist/state/snapshots/legacy-r2.json

if [[ "$resume_from_pause" == true ]]; then
  active_a_version="$(jq -er .legacyBridgeVersion \
    dist/state/current-policy.json)"
  active_a_manifest_key="$(jq -er --arg version "$active_a_version" \
    '.releases[$version].manifestKey' dist/state/current-policy.json)"
  aws s3 cp "s3://${CLOUDFLARE_R2_BUCKET}/${active_a_manifest_key}" \
    dist/state/resume-active-a.json --endpoint-url "$r2_endpoint"
  node scripts/updater/legacy-pause-transaction.mjs validate-resume \
    --policy dist/state/current-policy.json \
    --expected-current "$(jq -er .currentVersion dist/state/current-policy.json)" \
    --oss-legacy dist/state/snapshots/legacy-oss.json \
    --r2-legacy dist/state/snapshots/legacy-r2.json \
    --active-a dist/state/resume-active-a.json \
    --output dist/state/resume-validation.json
  if [[ "$next_legacy_version" == "$current_legacy_version" ]]; then
    legacy_publish_source=dist/state/resume-active-a.json
  fi
fi

ossutil api get-object-acl --bucket "$ALIYUN_OSS_BUCKET" \
  --key "$LEGACY_ALIYUN_KEY" --endpoint "$oss_endpoint" \
  --region "$ALIYUN_REGION" --output-format json --quiet \
  > dist/state/snapshots/legacy-oss-acl.json
legacy_oss_acl="$(node scripts/updater/promotion-transaction.mjs \
  extract-oss-acl --acl dist/state/snapshots/legacy-oss-acl.json)"
case "$legacy_oss_acl" in
  default|private|public-read) ;;
  *) echo "Unsupported OSS ACL snapshot: $legacy_oss_acl" >&2; exit 1 ;;
esac

policy_backup="${transaction_prefix}/backups/policy.json"
legacy_oss_backup="${transaction_prefix}/backups/legacy-oss.json"
legacy_r2_backup="${transaction_prefix}/backups/legacy-r2.json"
jq -n \
  --arg policy_key "$POLICY_KEY" \
  --arg policy_backup "$policy_backup" \
  --argjson policy_existed "$policy_existed" \
  --arg policy_sha "$(if [[ "$policy_existed" == true ]]; then sha256sum dist/state/snapshots/policy.json | cut -d' ' -f1; fi)" \
  --slurpfile policy_meta dist/state/probes/policy-r2-commit.stdout \
  --arg legacy_oss_key "$LEGACY_ALIYUN_KEY" \
  --arg legacy_oss_backup "$legacy_oss_backup" \
  --arg legacy_oss_sha "$(sha256sum dist/state/snapshots/legacy-oss.json | cut -d' ' -f1)" \
  --slurpfile legacy_oss_meta dist/state/probes/legacy-oss-commit.stdout \
  --slurpfile legacy_oss_acl dist/state/snapshots/legacy-oss-acl.json \
  --arg legacy_r2_key "$LEGACY_R2_KEY" \
  --arg legacy_r2_backup "$legacy_r2_backup" \
  --arg legacy_r2_sha "$(sha256sum dist/state/snapshots/legacy-r2.json | cut -d' ' -f1)" \
  --slurpfile legacy_r2_meta dist/state/probes/legacy-r2-commit.stdout \
  '[
    {
      provider:"r2", key:$policy_key, existed:$policy_existed,
      bytesSha256:(if $policy_existed then $policy_sha else null end),
      metadata:(if $policy_existed then ($policy_meta[0] // {}) else null end),
      acl:null,
      backupKey:(if $policy_existed then $policy_backup else null end)
    },
    {
      provider:"oss", key:$legacy_oss_key, existed:true,
      bytesSha256:$legacy_oss_sha, metadata:($legacy_oss_meta[0] // {}),
      acl:($legacy_oss_acl[0] // {}), backupKey:$legacy_oss_backup
    },
    {
      provider:"r2", key:$legacy_r2_key, existed:true,
      bytesSha256:$legacy_r2_sha, metadata:($legacy_r2_meta[0] // {}),
      acl:null, backupKey:$legacy_r2_backup
    }
  ]' > dist/state/snapshots.json

node scripts/updater/promotion-transaction.mjs create-journal \
  --run-id "$GITHUB_RUN_ID" --run-attempt "$GITHUB_RUN_ATTEMPT" \
  --target-tag "$target_tag" --target-version "$target_version" \
  --source-commit "$source_commit" \
  --next-policy dist/state/next-policy.json \
  --created-at "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" \
  --snapshots dist/state/snapshots.json --output "$journal"
publish_transaction_next_policy
persist_journal

if [[ "$policy_existed" == true ]]; then
  node scripts/updater/promotion-transaction.mjs backup-metadata-plan \
    --metadata dist/state/probes/policy-r2-commit.stdout \
    --output dist/state/policy-backup-metadata-plan.json
fi
node scripts/updater/promotion-transaction.mjs backup-metadata-plan \
  --metadata dist/state/probes/legacy-oss-commit.stdout \
  --output dist/state/legacy-oss-backup-metadata-plan.json
node scripts/updater/promotion-transaction.mjs backup-metadata-plan \
  --metadata dist/state/probes/legacy-r2-commit.stdout \
  --output dist/state/legacy-r2-backup-metadata-plan.json

if [[ "$policy_existed" == true ]]; then
  publish_snapshot_backup_r2 0 dist/state/snapshots/policy.json \
    "$policy_backup" policy-backup \
    dist/state/policy-backup-metadata-plan.json
fi
publish_snapshot_backup_oss 1 dist/state/snapshots/legacy-oss.json \
  "$legacy_oss_backup" legacy-oss-backup \
  dist/state/legacy-oss-backup-metadata-plan.json "$legacy_oss_acl"
publish_snapshot_backup_r2 2 dist/state/snapshots/legacy-r2.json \
  "$legacy_r2_backup" legacy-r2-backup \
  dist/state/legacy-r2-backup-metadata-plan.json
if [[ "$first_legacy_promotion" == true ]]; then
  test "$(jq -er .legacyPauseFallback.transactionId \
    dist/state/next-policy.json)" = "$transaction_id"
  ossutil cp "oss://${ALIYUN_OSS_BUCKET}/${legacy_oss_backup}" \
    dist/state/fallback-backup-oss.json --force \
    --endpoint "$oss_endpoint" --region "$ALIYUN_REGION"
  aws s3 cp "s3://${CLOUDFLARE_R2_BUCKET}/${legacy_r2_backup}" \
    dist/state/fallback-backup-r2.json --endpoint-url "$r2_endpoint"
  cmp dist/state/snapshots/legacy-oss.json dist/state/fallback-backup-oss.json
  cmp dist/state/snapshots/legacy-r2.json dist/state/fallback-backup-r2.json
  node scripts/updater/legacy-pause-transaction.mjs \
    validate-fallback-bytes \
    --policy dist/state/next-policy.json \
    --oss dist/state/fallback-backup-oss.json \
    --r2 dist/state/fallback-backup-r2.json \
    --output dist/state/fallback-backup-validation.json
fi

policy_write_attempted=false
policy_written_etag=""
legacy_oss_write_attempted=false
legacy_r2_write_attempted=false
rollback() {
  local original_rc=$? rollback_failed=0
  local legacy_restore_performed=false
  local legacy_oss_restore_needed=false legacy_r2_restore_needed=false
  if [[ "$original_rc" -eq 0 ]]; then original_rc=1; fi
  trap - ERR INT TERM
  set +e
  if node scripts/updater/promotion-transaction.mjs advance-journal \
    --journal "$journal" --state rollback-required \
    --checkpoint rollback-started \
    --updated-at "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" \
    --output dist/state/promotion-journal.rollback.json; then
    mv dist/state/promotion-journal.rollback.json "$journal"
    persist_journal || rollback_failed=1
  else
    rollback_failed=1
  fi

  # Phase 1 is read/classify only. Every mutable object is classified before
  # any restore or cleanup mutation. Any unknown state leaves the open journal
  # in place and causes phase 2 to perform zero recovery writes.
  if [[ "$policy_write_attempted" == true ]]; then
    policy_classification_ok=true
    probe_r2 "$POLICY_KEY" rollback-policy-live \
      || policy_classification_ok=false
    if [[ "$policy_classification_ok" == true ]]; then
      live_policy_state="$(jq -er .state \
        dist/state/probes/rollback-policy-live.json)" \
        || policy_classification_ok=false
    fi
    if [[ "$policy_classification_ok" == true \
      && "$live_policy_state" == exists ]]; then
      aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" \
        --key "$POLICY_KEY" --endpoint-url "$r2_endpoint" \
        dist/state/rollback-policy-live.json \
        > dist/state/rollback-policy-live-metadata.json \
        || policy_classification_ok=false
    fi
    if [[ "$policy_classification_ok" == true ]]; then
      rollback_classify_args=(
        classify-policy-rollback
        --policy-existed "$policy_existed"
        --next dist/state/next-policy.json
        --live-state "$live_policy_state"
        --output dist/state/rollback-policy-decision.json
      )
      if [[ "$policy_existed" == true ]]; then
        rollback_classify_args+=(--original dist/state/snapshots/policy.json)
      fi
      if [[ "$live_policy_state" == exists ]]; then
        rollback_classify_args+=(--live dist/state/rollback-policy-live.json)
      fi
      node scripts/updater/promotion-transaction.mjs \
        "${rollback_classify_args[@]}" || policy_classification_ok=false
    fi
    if [[ "$policy_classification_ok" != true ]]; then
      rollback_failed=1
    fi
  else
    if [[ "$policy_existed" == true ]]; then
      if aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" \
        --key "$POLICY_KEY" --endpoint-url "$r2_endpoint" \
        dist/state/rollback-policy-untouched.json \
        >dist/state/rollback-policy-untouched-metadata.json; then
        cmp dist/state/snapshots/policy.json \
          dist/state/rollback-policy-untouched.json || rollback_failed=1
      else
        rollback_failed=1
      fi
    else
      probe_r2 "$POLICY_KEY" rollback-policy-untouched \
        || rollback_failed=1
      jq -e '.state == "absent"' \
        dist/state/probes/rollback-policy-untouched.json >/dev/null \
        || rollback_failed=1
    fi
  fi

  if [[ "$update_legacy" == true ]]; then
    oss_classification_ok=true
    ossutil cp "oss://${ALIYUN_OSS_BUCKET}/${LEGACY_ALIYUN_KEY}" \
      dist/state/rollback-legacy-oss-live.json --force \
      --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" \
      || oss_classification_ok=false
    if [[ "$oss_classification_ok" == true ]]; then
      if [[ "$legacy_oss_write_attempted" == true ]]; then
        if cmp -s dist/state/snapshots/legacy-oss.json \
          "$legacy_publish_source"; then
          cmp dist/state/snapshots/legacy-oss.json \
            dist/state/rollback-legacy-oss-live.json \
            || oss_classification_ok=false
          jq -n \
            '{action:"no-change",reason:"target-already-equals-snapshot"}' \
            >dist/state/rollback-legacy-oss-decision.json
        else
          node scripts/updater/legacy-pause-transaction.mjs \
            classify-rollback --object-kind legacy-oss \
            --live-state exists \
            --live dist/state/rollback-legacy-oss-live.json \
            --before dist/state/snapshots/legacy-oss.json \
            --paused "$legacy_publish_source" \
            --output dist/state/rollback-legacy-oss-decision.json \
            || oss_classification_ok=false
        fi
      else
        cmp dist/state/snapshots/legacy-oss.json \
          dist/state/rollback-legacy-oss-live.json \
          || oss_classification_ok=false
      fi
    fi
    if [[ "$oss_classification_ok" != true ]]; then rollback_failed=1; fi

    r2_classification_ok=true
    aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" \
      --key "$LEGACY_R2_KEY" --endpoint-url "$r2_endpoint" \
      dist/state/rollback-legacy-r2-live.json \
      >dist/state/rollback-legacy-r2-live-metadata.json \
      || r2_classification_ok=false
    if [[ "$r2_classification_ok" == true ]]; then
      if [[ "$legacy_r2_write_attempted" == true ]]; then
        if cmp -s dist/state/snapshots/legacy-r2.json \
          "$legacy_publish_source"; then
          cmp dist/state/snapshots/legacy-r2.json \
            dist/state/rollback-legacy-r2-live.json \
            || r2_classification_ok=false
          jq -n \
            '{action:"no-change",reason:"target-already-equals-snapshot"}' \
            >dist/state/rollback-legacy-r2-decision.json
        else
          node scripts/updater/legacy-pause-transaction.mjs \
            classify-rollback --object-kind legacy-r2 \
            --live-state exists \
            --live dist/state/rollback-legacy-r2-live.json \
            --before dist/state/snapshots/legacy-r2.json \
            --paused "$legacy_publish_source" \
            --output dist/state/rollback-legacy-r2-decision.json \
            || r2_classification_ok=false
        fi
      else
        cmp dist/state/snapshots/legacy-r2.json \
          dist/state/rollback-legacy-r2-live.json \
          || r2_classification_ok=false
      fi
    fi
    if [[ "$r2_classification_ok" != true ]]; then rollback_failed=1; fi
  fi

  jq '[
    .immutableLedger[]
    | select(.createdByTransaction and .verified)
  ] | unique_by([.provider, .key]) | reverse' \
    "$journal" >dist/state/ledger-cleanup.json \
    || rollback_failed=1
  ledger_count="$(jq -er length dist/state/ledger-cleanup.json)" \
    || rollback_failed=1
  ledger_classification_ok=true
  if [[ "$rollback_failed" -eq 0 ]]; then
    for ((ledger_index = 0; ledger_index < ledger_count; ledger_index += 1)); do
      classify_ledger_object classified "$ledger_index" \
        || ledger_classification_ok=false
    done
  else
    ledger_classification_ok=false
  fi
  if [[ "$ledger_classification_ok" != true ]]; then rollback_failed=1; fi

  # Phase 2 may mutate only after every classification succeeded. Both legacy
  # objects are re-read before the first restore; the policy remains last.
  if [[ "$rollback_failed" -eq 0 && "$update_legacy" == true ]]; then
    if [[ "$legacy_oss_write_attempted" == true ]] \
      && [[ "$(jq -r .action \
        dist/state/rollback-legacy-oss-decision.json)" == restore ]]; then
      legacy_oss_restore_needed=true
      ossutil cp "oss://${ALIYUN_OSS_BUCKET}/${LEGACY_ALIYUN_KEY}" \
        dist/state/rollback-legacy-oss-prewrite.json --force \
        --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" \
        || rollback_failed=1
      cmp dist/state/rollback-legacy-oss-live.json \
        dist/state/rollback-legacy-oss-prewrite.json \
        || rollback_failed=1
    fi
    if [[ "$legacy_r2_write_attempted" == true ]] \
      && [[ "$(jq -r .action \
        dist/state/rollback-legacy-r2-decision.json)" == restore ]]; then
      legacy_r2_restore_needed=true
      aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" \
        --key "$LEGACY_R2_KEY" --endpoint-url "$r2_endpoint" \
        dist/state/rollback-legacy-r2-prewrite.json \
        >dist/state/rollback-legacy-r2-prewrite-metadata.json \
        || rollback_failed=1
      cmp dist/state/rollback-legacy-r2-live.json \
        dist/state/rollback-legacy-r2-prewrite.json \
        || rollback_failed=1
      rollback_legacy_r2_etag="$(node \
        scripts/updater/promotion-transaction.mjs extract-r2-etag \
        --metadata dist/state/rollback-legacy-r2-prewrite-metadata.json)" \
        || rollback_failed=1
    fi
  fi
  if [[ "$rollback_failed" -eq 0 \
    && "$legacy_oss_restore_needed" == true ]]; then
    ossutil api put-object --bucket "$ALIYUN_OSS_BUCKET" \
      --key "$LEGACY_ALIYUN_KEY" \
      --body file://dist/state/snapshots/legacy-oss.json \
      --content-type "$(jq -er .contentType \
        dist/state/legacy-oss-backup-metadata-plan.json)" \
      --cache-control "$(jq -er .cacheControl \
        dist/state/legacy-oss-backup-metadata-plan.json)" \
      --object-acl "$legacy_oss_acl" --endpoint "$oss_endpoint" \
      --region "$ALIYUN_REGION" --output-format json --quiet >/dev/null \
      || rollback_failed=1
    if [[ "$rollback_failed" -eq 0 ]]; then legacy_restore_performed=true; fi
  fi
  if [[ "$rollback_failed" -eq 0 \
    && "$legacy_r2_restore_needed" == true ]]; then
    aws s3api put-object --bucket "$CLOUDFLARE_R2_BUCKET" \
      --key "$LEGACY_R2_KEY" \
      --body dist/state/snapshots/legacy-r2.json \
      --content-type "$(jq -er .contentType \
        dist/state/legacy-r2-backup-metadata-plan.json)" \
      --cache-control "$(jq -er .cacheControl \
        dist/state/legacy-r2-backup-metadata-plan.json)" \
      --if-match "$rollback_legacy_r2_etag" \
      --endpoint-url "$r2_endpoint" >/dev/null \
      || rollback_failed=1
    if [[ "$rollback_failed" -eq 0 ]]; then legacy_restore_performed=true; fi
  fi

  if [[ "$rollback_failed" -eq 0 && "$update_legacy" == true ]]; then
    ossutil cp "oss://${ALIYUN_OSS_BUCKET}/${LEGACY_ALIYUN_KEY}" \
      dist/state/rollback-legacy-oss.json --force \
      --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" \
      || rollback_failed=1
    ossutil api head-object --bucket "$ALIYUN_OSS_BUCKET" \
      --key "$LEGACY_ALIYUN_KEY" --endpoint "$oss_endpoint" \
      --region "$ALIYUN_REGION" --output-format json --quiet \
      > dist/state/rollback-legacy-oss-metadata.json \
      || rollback_failed=1
    aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" \
      --key "$LEGACY_R2_KEY" --endpoint-url "$r2_endpoint" \
      dist/state/rollback-legacy-r2.json \
      > dist/state/rollback-legacy-r2-metadata.json \
      || rollback_failed=1
    ossutil api get-object-acl --bucket "$ALIYUN_OSS_BUCKET" \
      --key "$LEGACY_ALIYUN_KEY" --endpoint "$oss_endpoint" \
      --region "$ALIYUN_REGION" --output-format json --quiet \
      > dist/state/rollback-legacy-oss-acl.json || rollback_failed=1
    node scripts/updater/promotion-transaction.mjs \
      verify-snapshot-readback --journal "$journal" --index 1 \
      --bytes dist/state/rollback-legacy-oss.json \
      --metadata dist/state/rollback-legacy-oss-metadata.json \
      --acl dist/state/rollback-legacy-oss-acl.json \
      --output dist/state/rollback-legacy-oss-verified.json \
      || rollback_failed=1
    node scripts/updater/promotion-transaction.mjs \
      verify-snapshot-readback --journal "$journal" --index 2 \
      --bytes dist/state/rollback-legacy-r2.json \
      --metadata dist/state/rollback-legacy-r2-metadata.json \
      --output dist/state/rollback-legacy-r2-verified.json \
      || rollback_failed=1
  fi
  if [[ "$rollback_failed" -eq 0 \
    && "$legacy_restore_performed" == true ]]; then
    aliyun cdn RefreshObjectCaches --ObjectPath "$LEGACY_ALIYUN_URL" \
      --ObjectType File > dist/state/rollback-aliyun-cache-purge.json \
      || rollback_failed=1
    jq -e '.RefreshTaskId or .RequestId' \
      dist/state/rollback-aliyun-cache-purge.json >/dev/null \
      || rollback_failed=1
    curl --proto '=https' --tlsv1.2 -fsS -X POST \
      "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/purge_cache" \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      -H "Content-Type: application/json" \
      --data "{\"files\":[\"${LEGACY_R2_URL}\"]}" \
      > dist/state/rollback-cloudflare-cache-purge.json \
      || rollback_failed=1
    jq -e '.success == true' \
      dist/state/rollback-cloudflare-cache-purge.json >/dev/null \
      || rollback_failed=1
    node scripts/updater/promotion-transaction.mjs poll-url \
      --url "$LEGACY_ALIYUN_URL" \
      --expected dist/state/snapshots/legacy-oss.json \
      --timeout-seconds 600 --interval-seconds 10 \
      --output dist/state/rollback-legacy-aliyun-cdn.json \
      || rollback_failed=1
    node scripts/updater/promotion-transaction.mjs poll-url \
      --url "$LEGACY_R2_URL" \
      --expected dist/state/snapshots/legacy-r2.json \
      --timeout-seconds 600 --interval-seconds 10 \
      --output dist/state/rollback-legacy-r2-cdn.json \
      || rollback_failed=1
  fi

  # The policy is restored only after both legacy origins and their public
  # cache endpoints have converged to the original snapshot.
  if [[ "$rollback_failed" -eq 0 && "$policy_write_attempted" == true ]] \
    && [[ "$(jq -r .action dist/state/rollback-policy-decision.json)" == restore ]]; then
    aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" \
      --key "$POLICY_KEY" --endpoint-url "$r2_endpoint" \
      dist/state/rollback-policy-prewrite.json \
      >dist/state/rollback-policy-prewrite-metadata.json \
      || rollback_failed=1
    cmp dist/state/rollback-policy-live.json \
      dist/state/rollback-policy-prewrite.json || rollback_failed=1
    live_policy_etag="$(node scripts/updater/promotion-transaction.mjs \
      extract-r2-etag \
      --metadata dist/state/rollback-policy-prewrite-metadata.json)" \
      || rollback_failed=1
    if [[ -n "$policy_written_etag" ]]; then
      test "$live_policy_etag" = "$policy_written_etag" \
        || rollback_failed=1
    fi
    if [[ "$rollback_failed" -eq 0 && "$policy_existed" == true ]]; then
      aws s3api put-object --bucket "$CLOUDFLARE_R2_BUCKET" \
        --key "$POLICY_KEY" --body dist/state/snapshots/policy.json \
        --content-type "$(jq -er .contentType \
          dist/state/policy-backup-metadata-plan.json)" \
        --cache-control "$(jq -er .cacheControl \
          dist/state/policy-backup-metadata-plan.json)" \
        --if-match "$live_policy_etag" --endpoint-url "$r2_endpoint" \
        >/dev/null || rollback_failed=1
    elif [[ "$rollback_failed" -eq 0 ]]; then
      aws s3api delete-object --bucket "$CLOUDFLARE_R2_BUCKET" \
        --key "$POLICY_KEY" --if-match "$live_policy_etag" \
        --endpoint-url "$r2_endpoint" >/dev/null \
        || rollback_failed=1
    fi
  fi
  if [[ "$rollback_failed" -eq 0 \
    && "$policy_write_attempted" == true ]]; then
    if [[ "$policy_existed" == true ]]; then
      aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" \
        --key "$POLICY_KEY" --endpoint-url "$r2_endpoint" \
        dist/state/rollback-policy.json \
        > dist/state/rollback-policy-metadata.json \
        || rollback_failed=1
      node scripts/updater/promotion-transaction.mjs \
        verify-snapshot-readback --journal "$journal" --index 0 \
        --bytes dist/state/rollback-policy.json \
        --metadata dist/state/rollback-policy-metadata.json \
        --output dist/state/rollback-policy-verified.json \
        || rollback_failed=1
    else
      probe_r2 "$POLICY_KEY" rollback-policy-absent || rollback_failed=1
      jq -e '.state == "absent"' \
        dist/state/probes/rollback-policy-absent.json >/dev/null \
        || rollback_failed=1
    fi
  fi
  # Reclassify every ledger object immediately before cleanup. No delete is
  # attempted unless all objects still have the journal-bound bytes/metadata.
  ledger_predelete_ok=true
  if [[ "$rollback_failed" -eq 0 ]]; then
    for ((ledger_index = 0; ledger_index < ledger_count; ledger_index += 1)); do
      classify_ledger_object predelete "$ledger_index" \
        || ledger_predelete_ok=false
    done
  else
    ledger_predelete_ok=false
  fi
  if [[ "$ledger_predelete_ok" != true ]]; then rollback_failed=1; fi
  # An object absent during phase 1 must not reappear under the same key.
  # exists->absent is a completed prior cleanup; exists->exists is deletable.
  if [[ "$rollback_failed" -eq 0 ]]; then
    for ((ledger_index = 0; ledger_index < ledger_count; ledger_index += 1)); do
      initial_ledger_state="$(cat \
        "dist/state/ledger-cleanup/classified-${ledger_index}.state")" \
        || { rollback_failed=1; break; }
      predelete_ledger_state="$(cat \
        "dist/state/ledger-cleanup/predelete-${ledger_index}.state")" \
        || { rollback_failed=1; break; }
      if [[ "$initial_ledger_state" == absent ]]; then
        if [[ "$predelete_ledger_state" != absent ]]; then
          rollback_failed=1
          break
        fi
      elif [[ "$initial_ledger_state" == exists ]]; then
        if [[ "$predelete_ledger_state" != exists \
          && "$predelete_ledger_state" != absent ]]; then
          rollback_failed=1
          break
        fi
      else
        rollback_failed=1
        break
      fi
    done
  fi
  if [[ "$rollback_failed" -eq 0 ]]; then
    for ((ledger_index = 0; ledger_index < ledger_count; ledger_index += 1)); do
      ledger_provider="$(jq -er --argjson index "$ledger_index" \
        '.[$index].provider' dist/state/ledger-cleanup.json)" \
        || { rollback_failed=1; break; }
      ledger_key="$(jq -er --argjson index "$ledger_index" \
        '.[$index].key' dist/state/ledger-cleanup.json)" \
        || { rollback_failed=1; break; }
      ledger_state="$(cat \
        "dist/state/ledger-cleanup/predelete-${ledger_index}.state")" \
        || { rollback_failed=1; break; }
      if [[ "$ledger_state" == absent ]]; then continue; fi
      if [[ "$ledger_state" != exists ]]; then
        rollback_failed=1
        break
      fi
      if [[ "$ledger_provider" == oss ]]; then
        ossutil api delete-object --bucket "$ALIYUN_OSS_BUCKET" \
          --key "$ledger_key" --endpoint "$oss_endpoint" \
          --region "$ALIYUN_REGION" --output-format json --quiet >/dev/null \
          || { rollback_failed=1; break; }
      else
        ledger_etag="$(cat \
          "dist/state/ledger-cleanup/predelete-${ledger_index}.etag")" \
          || { rollback_failed=1; break; }
        aws s3api delete-object --bucket "$CLOUDFLARE_R2_BUCKET" \
          --key "$ledger_key" --if-match "$ledger_etag" \
          --endpoint-url "$r2_endpoint" >/dev/null \
          || { rollback_failed=1; break; }
      fi
    done
  fi
  if [[ "$rollback_failed" -eq 0 ]]; then
    for ((ledger_index = 0; ledger_index < ledger_count; ledger_index += 1)); do
      ledger_provider="$(jq -er --argjson index "$ledger_index" \
        '.[$index].provider' dist/state/ledger-cleanup.json)" \
        || { rollback_failed=1; break; }
      ledger_key="$(jq -er --argjson index "$ledger_index" \
        '.[$index].key' dist/state/ledger-cleanup.json)" \
        || { rollback_failed=1; break; }
      if [[ "$ledger_provider" == r2 ]]; then
        probe_r2 "$ledger_key" "ledger-deleted-${ledger_index}-r2" \
          || { rollback_failed=1; break; }
        jq -e '.state == "absent"' \
          "dist/state/probes/ledger-deleted-${ledger_index}-r2.json" \
          >/dev/null || { rollback_failed=1; break; }
      elif [[ "$ledger_provider" == oss ]]; then
        probe_oss "$ledger_key" "ledger-deleted-${ledger_index}-oss" \
          || { rollback_failed=1; break; }
        jq -e '.state == "absent"' \
          "dist/state/probes/ledger-deleted-${ledger_index}-oss.json" \
          >/dev/null || { rollback_failed=1; break; }
      else
        rollback_failed=1
        break
      fi
    done
  fi

  if [[ "$rollback_failed" -eq 0 ]]; then
    node scripts/updater/promotion-transaction.mjs advance-journal \
      --journal "$journal" --state rolled-back \
      --checkpoint rollback-verified \
      --updated-at "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" \
      --output dist/state/promotion-journal.rolled-back.json
    mv dist/state/promotion-journal.rolled-back.json "$journal"
    persist_journal || rollback_failed=1
  fi
  if [[ "$rollback_failed" -eq 0 ]]; then
    delete_open_journal || rollback_failed=1
  fi
  if [[ "$rollback_failed" -ne 0 ]]; then
    node scripts/updater/promotion-transaction.mjs recovery-commands \
      --journal "$journal" --output dist/state/RECOVERY_COMMANDS.sh || true
    echo "Rollback incomplete; durable open journal blocks every policy writer." >&2
  fi
  exit "$original_rc"
}
trap rollback ERR INT TERM

publish_immutable_oss() {
  local file="$1" key="$2" content_type="$3" probe_name entry
  probe_name="immutable-$(printf '%s' "$key" | tr '/.' '--')"
  probe_oss "$key" "$probe_name"
  if jq -e '.state == "exists"' "dist/state/probes/${probe_name}.json" >/dev/null; then
    ossutil cp "oss://${ALIYUN_OSS_BUCKET}/${key}" "dist/state/${probe_name}" \
      --force --endpoint "$oss_endpoint" --region "$ALIYUN_REGION"
    cmp "$file" "dist/state/${probe_name}"
    return
  fi
  jq -n --arg key "$key" --arg sha "$(sha256sum "$file" | cut -d' ' -f1)" \
    --arg content_type "$content_type" \
    '{
      provider:"oss", key:$key, sha256:$sha,
      contentType:$content_type,
      cacheControl:"public, max-age=31536000, immutable",
      createdByTransaction:true, verified:false
    }' \
    > dist/state/ledger/entry.json
  advance_journal committing "before-create-oss-${probe_name}" dist/state/ledger/entry.json
  ossutil api put-object --bucket "$ALIYUN_OSS_BUCKET" --key "$key" \
    --body "file://${file}" --content-type "$content_type" \
    --cache-control "public, max-age=31536000, immutable" \
    --object-acl default --forbid-overwrite true \
    --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" --output-format json --quiet >/dev/null
  ossutil cp "oss://${ALIYUN_OSS_BUCKET}/${key}" "dist/state/${probe_name}" \
    --force --endpoint "$oss_endpoint" --region "$ALIYUN_REGION"
  cmp "$file" "dist/state/${probe_name}"
  jq '.verified = true' dist/state/ledger/entry.json \
    > dist/state/ledger/entry-verified.json
  advance_journal committing "verified-create-oss-${probe_name}" \
    dist/state/ledger/entry-verified.json
}

while IFS=$'\t' read -r file signature_file object_key; do
  publish_immutable_oss "dist/candidate/${file}" "$object_key" application/octet-stream
  publish_immutable_oss "dist/candidate/${signature_file}" "${object_key}.sig" text/plain
done < <(jq -r '.assets[] | [.file, .signatureFile, .objectKey] | @tsv' dist/candidate/candidate.json)

manifest_key="$(jq -er .manifestKey dist/candidate/candidate.json)"
publish_immutable_oss dist/candidate/latest.json "$manifest_key" application/json
probe_r2 "$manifest_key" immutable-manifest-r2
if jq -e '.state == "exists"' dist/state/probes/immutable-manifest-r2.json >/dev/null; then
  aws s3 cp "s3://${CLOUDFLARE_R2_BUCKET}/${manifest_key}" \
    dist/state/existing-manifest-r2.json --endpoint-url "$r2_endpoint"
  cmp dist/candidate/latest.json dist/state/existing-manifest-r2.json
else
  jq -n --arg key "$manifest_key" \
    --arg sha "$(sha256sum dist/candidate/latest.json | cut -d' ' -f1)" \
    '{
      provider:"r2", key:$key, sha256:$sha,
      contentType:"application/json",
      cacheControl:"public, max-age=31536000, immutable",
      createdByTransaction:true, verified:false
    }' \
    > dist/state/ledger/entry-r2.json
  advance_journal committing before-create-r2-manifest dist/state/ledger/entry-r2.json
  aws s3api put-object --bucket "$CLOUDFLARE_R2_BUCKET" --key "$manifest_key" \
    --body dist/candidate/latest.json --content-type application/json \
    --cache-control "public, max-age=31536000, immutable" \
    --if-none-match '*' --endpoint-url "$r2_endpoint" >/dev/null
  aws s3 cp "s3://${CLOUDFLARE_R2_BUCKET}/${manifest_key}" \
    dist/state/manifest-r2-readback.json --endpoint-url "$r2_endpoint"
  cmp dist/candidate/latest.json dist/state/manifest-r2-readback.json
  jq '.verified = true' dist/state/ledger/entry-r2.json \
    > dist/state/ledger/entry-r2-verified.json
  advance_journal committing verified-create-r2-manifest \
    dist/state/ledger/entry-r2-verified.json
fi

while IFS=$'\t' read -r file signature_file object_key; do
  for remote_file in "$file:$object_key" "$signature_file:${object_key}.sig"; do
    local_file="dist/candidate/${remote_file%%:*}"
    remote_key="${remote_file#*:}"
    public_url="https://static.mitapp.cn/${remote_key}"
    curl --proto '=https' --tlsv1.2 -fsSI --retry 12 --retry-all-errors \
      --retry-delay 10 --connect-timeout 10 --max-time 180 "$public_url" \
      > "dist/state/public-$(basename "$remote_key").headers"
    grep -Eiq '^content-length:' "dist/state/public-$(basename "$remote_key").headers"
    test -s "$local_file"
  done
done < <(jq -r '.assets[] | [.file, .signatureFile, .objectKey] | @tsv' dist/candidate/candidate.json)
node scripts/updater/promotion-transaction.mjs poll-url \
  --url "https://static.mitapp.cn/${manifest_key}" \
  --expected dist/candidate/latest.json --timeout-seconds 600 \
  --interval-seconds 10 --output dist/state/immutable-manifest-cdn.json

if [[ "$update_legacy" == true ]]; then
  advance_journal committing before-legacy-dual-write
  ossutil api put-object --bucket "$ALIYUN_OSS_BUCKET" --key "$legacy_staging_key" \
    --body "file://${legacy_publish_source}" --content-type application/json \
    --cache-control "public, max-age=60, must-revalidate" --object-acl default \
    --forbid-overwrite true --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" \
    --output-format json --quiet >/dev/null
  aws s3api put-object --bucket "$CLOUDFLARE_R2_BUCKET" --key "$legacy_staging_key" \
    --body "$legacy_publish_source" --content-type application/json \
    --cache-control "public, max-age=60, must-revalidate" --if-none-match '*' \
    --endpoint-url "$r2_endpoint" >/dev/null
  ossutil cp "oss://${ALIYUN_OSS_BUCKET}/${legacy_staging_key}" \
    dist/state/staged-legacy-oss.json --force \
    --endpoint "$oss_endpoint" --region "$ALIYUN_REGION"
  aws s3 cp "s3://${CLOUDFLARE_R2_BUCKET}/${legacy_staging_key}" \
    dist/state/staged-legacy-r2.json --endpoint-url "$r2_endpoint"
  cmp "$legacy_publish_source" dist/state/staged-legacy-oss.json
  cmp dist/state/staged-legacy-oss.json dist/state/staged-legacy-r2.json

  # Re-read each mutable legacy object immediately before its write. R2 uses
  # the exact live ETag as an atomic condition. OSS has no destination ETag
  # condition for PutObject, so the shared journal lock, immediate byte
  # classification, and mandatory post-write byte readback are one boundary.
  ossutil cp "oss://${ALIYUN_OSS_BUCKET}/${LEGACY_ALIYUN_KEY}" \
    dist/state/forward-legacy-oss.json --force \
    --endpoint "$oss_endpoint" --region "$ALIYUN_REGION"
  if cmp -s dist/state/snapshots/legacy-oss.json \
    dist/state/staged-legacy-oss.json; then
    cmp dist/state/snapshots/legacy-oss.json \
      dist/state/forward-legacy-oss.json
    jq -n '{action:"no-change",reason:"target-already-equals-snapshot"}' \
      >dist/state/forward-legacy-oss-decision.json
  else
    node scripts/updater/legacy-pause-transaction.mjs classify-cas \
      --object-kind legacy-oss --live-state exists \
      --live dist/state/forward-legacy-oss.json \
      --before dist/state/snapshots/legacy-oss.json \
      --paused dist/state/staged-legacy-oss.json \
      --output dist/state/forward-legacy-oss-decision.json
  fi
  if [[ "$(jq -r .action dist/state/forward-legacy-oss-decision.json)" == write ]]; then
    legacy_oss_write_attempted=true
    ossutil api put-object --bucket "$ALIYUN_OSS_BUCKET" \
      --key "$LEGACY_ALIYUN_KEY" \
      --body file://dist/state/staged-legacy-oss.json \
      --content-type application/json \
      --cache-control "public, max-age=60, must-revalidate" \
      --object-acl "$legacy_oss_acl" --endpoint "$oss_endpoint" \
      --region "$ALIYUN_REGION" --output-format json --quiet >/dev/null
  fi
  ossutil cp "oss://${ALIYUN_OSS_BUCKET}/${LEGACY_ALIYUN_KEY}" \
    dist/state/forward-legacy-oss-readback.json --force \
    --endpoint "$oss_endpoint" --region "$ALIYUN_REGION"
  cmp dist/state/staged-legacy-oss.json \
    dist/state/forward-legacy-oss-readback.json

  aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" \
    --key "$LEGACY_R2_KEY" --endpoint-url "$r2_endpoint" \
    dist/state/forward-legacy-r2.json \
    >dist/state/forward-legacy-r2-metadata.json
  if cmp -s dist/state/snapshots/legacy-r2.json \
    dist/state/staged-legacy-r2.json; then
    cmp dist/state/snapshots/legacy-r2.json \
      dist/state/forward-legacy-r2.json
    jq -n '{action:"no-change",reason:"target-already-equals-snapshot"}' \
      >dist/state/forward-legacy-r2-decision.json
  else
    node scripts/updater/legacy-pause-transaction.mjs classify-cas \
      --object-kind legacy-r2 --live-state exists \
      --live dist/state/forward-legacy-r2.json \
      --before dist/state/snapshots/legacy-r2.json \
      --paused dist/state/staged-legacy-r2.json \
      --output dist/state/forward-legacy-r2-decision.json
  fi
  if [[ "$(jq -r .action dist/state/forward-legacy-r2-decision.json)" == write ]]; then
    legacy_r2_write_attempted=true
    forward_legacy_r2_etag="$(node \
      scripts/updater/promotion-transaction.mjs extract-r2-etag \
      --metadata dist/state/forward-legacy-r2-metadata.json)"
    aws s3api put-object --bucket "$CLOUDFLARE_R2_BUCKET" \
      --key "$LEGACY_R2_KEY" --body dist/state/staged-legacy-r2.json \
      --content-type application/json \
      --cache-control "public, max-age=60, must-revalidate" \
      --if-match "$forward_legacy_r2_etag" \
      --endpoint-url "$r2_endpoint" >/dev/null
  fi
  aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" \
    --key "$LEGACY_R2_KEY" --endpoint-url "$r2_endpoint" \
    dist/state/forward-legacy-r2-readback.json \
    >dist/state/forward-legacy-r2-readback-metadata.json
  cmp dist/state/staged-legacy-r2.json \
    dist/state/forward-legacy-r2-readback.json

  aliyun cdn RefreshObjectCaches --ObjectPath "$LEGACY_ALIYUN_URL" \
    --ObjectType File > dist/state/aliyun-cache-purge.json
  jq -e '.RefreshTaskId or .RequestId' dist/state/aliyun-cache-purge.json >/dev/null
  curl --proto '=https' --tlsv1.2 -fsS -X POST \
    "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/purge_cache" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Content-Type: application/json" \
    --data "{\"files\":[\"${LEGACY_R2_URL}\"]}" > dist/state/cloudflare-cache-purge.json
  jq -e '.success == true' dist/state/cloudflare-cache-purge.json >/dev/null
  node scripts/updater/promotion-transaction.mjs poll-url \
    --url "$LEGACY_ALIYUN_URL" --expected "$legacy_publish_source" \
    --timeout-seconds 600 --interval-seconds 10 \
    --output dist/state/legacy-aliyun-cdn.json
  node scripts/updater/promotion-transaction.mjs poll-url \
    --url "$LEGACY_R2_URL" --expected "$legacy_publish_source" \
    --timeout-seconds 600 --interval-seconds 10 \
    --output dist/state/legacy-r2-cdn.json
  advance_journal committing legacy-origins-verified-before-policy
fi

# The policy CAS is deliberately last. In particular, a paused policy must
# remain paused until both legacy origins serve the active A-lineage manifest
# byte-for-byte. Any failure before or after this point is still covered by the
# same durable journal and rollback boundary.
if [[ "$policy_existed" == true ]]; then
  aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" \
    --key "$POLICY_KEY" --endpoint-url "$r2_endpoint" \
    dist/state/policy-final-cas.json \
    > dist/state/policy-final-cas-metadata.json
  cmp dist/state/current-policy.json dist/state/policy-final-cas.json
  test "$(node scripts/updater/promotion-transaction.mjs extract-r2-etag \
    --metadata dist/state/policy-final-cas-metadata.json)" \
    = "$policy_original_etag"
else
  probe_r2 "$POLICY_KEY" policy-final-cas
  jq -e '.state == "absent"' dist/state/probes/policy-final-cas.json >/dev/null
fi
advance_journal committing before-policy-write
policy_put_args=(
  s3api put-object --bucket "$CLOUDFLARE_R2_BUCKET" --key "$POLICY_KEY"
  --body dist/state/next-policy.json --content-type application/json
  --cache-control no-store --endpoint-url "$r2_endpoint"
)
if [[ "$policy_existed" == true ]]; then
  policy_put_args+=(--if-match "$policy_original_etag")
else
  policy_put_args+=(--if-none-match '*')
fi
policy_write_attempted=true
aws "${policy_put_args[@]}" > dist/state/policy-put-result.json
policy_written_etag="$(node scripts/updater/promotion-transaction.mjs \
  extract-r2-etag --metadata dist/state/policy-put-result.json)"
aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" \
  --key "$POLICY_KEY" --endpoint-url "$r2_endpoint" \
  dist/state/policy-readback.json > dist/state/policy-readback-metadata.json
cmp dist/state/next-policy.json dist/state/policy-readback.json
test "$(node scripts/updater/promotion-transaction.mjs extract-r2-etag \
  --metadata dist/state/policy-readback-metadata.json)" \
  = "$policy_written_etag"

probe_index=0
while IFS= read -r probe_from; do
  probe_target="$(jq -r --arg from "$probe_from" \
    '.transitions[$from].to // $from' dist/state/next-policy.json)"
  probe_rollout="$(jq -r --arg from "$probe_from" \
    '.transitions[$from].rollout // 0' dist/state/next-policy.json)"
  node scripts/updater/sign-request.mjs --current-version "$probe_from" \
    --target-version "$probe_target" --rollout "$probe_rollout" \
    --salt "$ROLLOUT_SALT" \
    --output "dist/state/probe-${probe_index}-headers.json"
  endpoint="${DYNAMIC_UPDATER_BASE_URL}/windows/x86_64/${probe_from}"
  curl_args=(
    --proto '=https' --tlsv1.2 -sS --connect-timeout 10 --max-time 120
    -D "dist/state/probe-${probe_index}-response.headers"
    -o "dist/state/probe-${probe_index}-response.json"
    -w '%{http_code}' "$endpoint"
  )
  while IFS=$'\t' read -r key value; do
    curl_args+=(-H "$key: $value")
  done < <(jq -r 'to_entries[] | [.key, .value] | @tsv' \
    "dist/state/probe-${probe_index}-headers.json")
  status="$(curl "${curl_args[@]}")"
  if [[ "$probe_rollout" == "0" ]]; then
    test "$status" = "204"
    test ! -s "dist/state/probe-${probe_index}-response.json"
    probe_state="$(awk -F ': *' '
      tolower($1) == "x-biyan-updater-state" {
        gsub(/\r/, "", $2)
        value = $2
      }
      END { print value }
    ' "dist/state/probe-${probe_index}-response.headers")"
    test "$probe_state" = "no-transition"
  else
    test "$status" = "200"
    test "$(jq -er .version \
      "dist/state/probe-${probe_index}-response.json")" = "$probe_target"
  fi
  probe_index=$((probe_index + 1))
done < <(
  if [[ "$PHASE" == DIRECT_C ]]; then
    jq -nr --arg from "$FROM_VERSION" --arg target "$target_version" \
      --slurpfile policy dist/state/next-policy.json \
      '([$from] + ($policy[0].transitions | keys) + [$target]) | unique[]'
  else
    printf '%s\n' "$FROM_VERSION"
  fi
)

if [[ "$update_legacy" == true ]]; then
  ossutil api delete-object --bucket "$ALIYUN_OSS_BUCKET" \
    --key "$legacy_staging_key" --endpoint "$oss_endpoint" \
    --region "$ALIYUN_REGION" --output-format json --quiet >/dev/null
  aws s3api delete-object --bucket "$CLOUDFLARE_R2_BUCKET" \
    --key "$legacy_staging_key" --endpoint-url "$r2_endpoint" >/dev/null
fi
advance_journal committed policy-and-origins-verified
trap - ERR INT TERM
delete_open_journal
