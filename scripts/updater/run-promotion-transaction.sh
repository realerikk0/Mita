#!/usr/bin/env bash
set -euo pipefail

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
effective_phase="$(jq -er --arg version "$target_version" \
  '.releases[$version].effectivePhase' dist/state/next-policy.json)"
transaction_id="${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
transaction_prefix="biyan/updater/transactions/${transaction_id}"
legacy_staging_key="${transaction_prefix}/staging/legacy-latest.json"
journal=dist/state/promotion-journal.json
update_legacy=false
if [[ "$effective_phase" == "A" ]]; then update_legacy=true; fi

mkdir -p dist/state/probes dist/state/snapshots dist/state/ledger

probe_r2() {
  local key="$1" name="$2" rc
  set +e
  aws s3api head-object --bucket "$CLOUDFLARE_R2_BUCKET" --key "$key" \
    --endpoint-url "$r2_endpoint" \
    >"dist/state/probes/${name}.stdout" 2>"dist/state/probes/${name}.stderr"
  rc=$?
  set -e
  node scripts/updater/promotion-transaction.mjs classify-probe \
    --provider r2 --key "$key" --exit-code "$rc" \
    --stdout "dist/state/probes/${name}.stdout" \
    --stderr "dist/state/probes/${name}.stderr" \
    --output "dist/state/probes/${name}.json"
}

probe_oss() {
  local key="$1" name="$2" rc
  set +e
  ossutil api head-object --bucket "$ALIYUN_OSS_BUCKET" --key "$key" \
    --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" --output-format json \
    >"dist/state/probes/${name}.stdout" 2>"dist/state/probes/${name}.stderr"
  rc=$?
  set -e
  node scripts/updater/promotion-transaction.mjs classify-probe \
    --provider oss --key "$key" --exit-code "$rc" \
    --stdout "dist/state/probes/${name}.stdout" \
    --stderr "dist/state/probes/${name}.stderr" \
    --output "dist/state/probes/${name}.json"
}

put_oss_json() {
  local file="$1" key="$2" overwrite="${3:-true}"
  ossutil api put-object --bucket "$ALIYUN_OSS_BUCKET" --key "$key" \
    --body "file://${file}" --content-type application/json \
    --cache-control no-store --object-acl default \
    --forbid-overwrite "$([[ "$overwrite" == true ]] && echo false || echo true)" \
    --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" --output-format json
}

put_r2_json() {
  local file="$1" key="$2"
  aws s3api put-object --bucket "$CLOUDFLARE_R2_BUCKET" --key "$key" \
    --body "$file" --content-type application/json --cache-control no-store \
    --endpoint-url "$r2_endpoint" >/dev/null
}

persist_journal() {
  (
    set -euo pipefail
    node scripts/updater/promotion-transaction.mjs validate-journal --journal "$journal"
    local sequence history_key
    sequence="$(jq -er .sequence "$journal")"
    history_key="${transaction_prefix}/journal-$(printf '%04d' "$sequence").json"
    put_r2_json "$journal" "$history_key"
    put_oss_json "$journal" "$history_key" false
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
    aws s3api delete-object --bucket "$CLOUDFLARE_R2_BUCKET" \
      --key "$OPEN_TRANSACTION_KEY" --endpoint-url "$r2_endpoint" >/dev/null
    ossutil api delete-object --bucket "$ALIYUN_OSS_BUCKET" \
      --key "$OPEN_TRANSACTION_KEY" --endpoint "$oss_endpoint" \
      --region "$ALIYUN_REGION" --output-format json >/dev/null
  )
}

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

ossutil api get-object-acl --bucket "$ALIYUN_OSS_BUCKET" \
  --key "$LEGACY_ALIYUN_KEY" --endpoint "$oss_endpoint" \
  --region "$ALIYUN_REGION" --output-format json \
  > dist/state/snapshots/legacy-oss-acl.json
legacy_oss_acl="$(jq -er '.acl // .Acl // .objectAcl // .ObjectAcl' \
  dist/state/snapshots/legacy-oss-acl.json)"
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
  --created-at "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" \
  --snapshots dist/state/snapshots.json --output "$journal"
persist_journal

if [[ "$policy_existed" == true ]]; then
  aws s3 cp "s3://${CLOUDFLARE_R2_BUCKET}/${POLICY_KEY}" \
    "s3://${CLOUDFLARE_R2_BUCKET}/${policy_backup}" \
    --copy-props metadata-directive --endpoint-url "$r2_endpoint"
fi
ossutil api copy-object --bucket "$ALIYUN_OSS_BUCKET" \
  --key "$legacy_oss_backup" \
  --copy-source "/${ALIYUN_OSS_BUCKET}/${LEGACY_ALIYUN_KEY}" \
  --metadata-directive COPY --forbid-overwrite true \
  --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" --output-format json >/dev/null
aws s3 cp "s3://${CLOUDFLARE_R2_BUCKET}/${LEGACY_R2_KEY}" \
  "s3://${CLOUDFLARE_R2_BUCKET}/${legacy_r2_backup}" \
  --copy-props metadata-directive --endpoint-url "$r2_endpoint"

policy_write_attempted=false
policy_write_completed=false
policy_written_etag=""
rollback() {
  local original_rc=$? rollback_failed=0 policy_restore_performed=false
  if [[ "$original_rc" -eq 0 ]]; then original_rc=1; fi
  trap - ERR INT TERM
  set +e
  node scripts/updater/promotion-transaction.mjs advance-journal \
    --journal "$journal" --state rollback-required \
    --checkpoint rollback-started \
    --updated-at "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" \
    --output dist/state/promotion-journal.rollback.json
  if [[ $? -eq 0 ]]; then
    mv dist/state/promotion-journal.rollback.json "$journal"
    persist_journal || rollback_failed=1
  else
    rollback_failed=1
  fi

  if [[ "$policy_write_attempted" == true ]]; then
    if ! probe_r2 "$POLICY_KEY" rollback-policy-live; then
      rollback_failed=1
    fi
    set +e
    if [[ "$rollback_failed" -eq 0 ]]; then
      live_policy_state="$(jq -er .state \
        dist/state/probes/rollback-policy-live.json)" \
        || rollback_failed=1
    fi
    if [[ "$rollback_failed" -eq 0 && "$live_policy_state" == exists ]]; then
      aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" \
        --key "$POLICY_KEY" --endpoint-url "$r2_endpoint" \
        dist/state/rollback-policy-live.json \
        > dist/state/rollback-policy-live-metadata.json \
        || rollback_failed=1
    fi
    if [[ "$rollback_failed" -eq 0 ]]; then
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
        "${rollback_classify_args[@]}" || rollback_failed=1
    fi
    if [[ "$rollback_failed" -eq 0 ]] \
      && [[ "$(jq -r .action dist/state/rollback-policy-decision.json)" == restore ]]; then
      if [[ -n "$policy_written_etag" ]]; then
        live_policy_etag="$(node scripts/updater/promotion-transaction.mjs \
          extract-r2-etag \
          --metadata dist/state/rollback-policy-live-metadata.json)" \
          || rollback_failed=1
        test "$live_policy_etag" = "$policy_written_etag" \
          || rollback_failed=1
      fi
      if [[ "$rollback_failed" -eq 0 && "$policy_existed" == true ]]; then
        aws s3 cp "s3://${CLOUDFLARE_R2_BUCKET}/${policy_backup}" \
          "s3://${CLOUDFLARE_R2_BUCKET}/${POLICY_KEY}" \
          --copy-props metadata-directive --endpoint-url "$r2_endpoint" \
          || rollback_failed=1
      elif [[ "$rollback_failed" -eq 0 ]]; then
        aws s3api delete-object --bucket "$CLOUDFLARE_R2_BUCKET" \
          --key "$POLICY_KEY" --endpoint-url "$r2_endpoint" >/dev/null \
          || rollback_failed=1
      fi
      if [[ "$rollback_failed" -eq 0 ]]; then
        policy_restore_performed=true
      fi
    fi
  fi
  if [[ "$update_legacy" == true ]]; then
    ossutil api copy-object --bucket "$ALIYUN_OSS_BUCKET" \
      --key "$LEGACY_ALIYUN_KEY" \
      --copy-source "/${ALIYUN_OSS_BUCKET}/${legacy_oss_backup}" \
      --metadata-directive COPY --endpoint "$oss_endpoint" \
      --region "$ALIYUN_REGION" --output-format json >/dev/null \
      || rollback_failed=1
    ossutil api put-object-acl --bucket "$ALIYUN_OSS_BUCKET" \
      --key "$LEGACY_ALIYUN_KEY" --object-acl "$legacy_oss_acl" \
      --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" \
      --output-format json >/dev/null || rollback_failed=1
    aws s3 cp "s3://${CLOUDFLARE_R2_BUCKET}/${legacy_r2_backup}" \
      "s3://${CLOUDFLARE_R2_BUCKET}/${LEGACY_R2_KEY}" \
      --copy-props metadata-directive --endpoint-url "$r2_endpoint" \
      || rollback_failed=1
    ossutil cp "oss://${ALIYUN_OSS_BUCKET}/${LEGACY_ALIYUN_KEY}" \
      dist/state/rollback-legacy-oss.json --force \
      --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" \
      || rollback_failed=1
    ossutil api head-object --bucket "$ALIYUN_OSS_BUCKET" \
      --key "$LEGACY_ALIYUN_KEY" --endpoint "$oss_endpoint" \
      --region "$ALIYUN_REGION" --output-format json \
      > dist/state/rollback-legacy-oss-metadata.json \
      || rollback_failed=1
    aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" \
      --key "$LEGACY_R2_KEY" --endpoint-url "$r2_endpoint" \
      dist/state/rollback-legacy-r2.json \
      > dist/state/rollback-legacy-r2-metadata.json \
      || rollback_failed=1
    ossutil api get-object-acl --bucket "$ALIYUN_OSS_BUCKET" \
      --key "$LEGACY_ALIYUN_KEY" --endpoint "$oss_endpoint" \
      --region "$ALIYUN_REGION" --output-format json \
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
  if [[ "$policy_restore_performed" == true ]]; then
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
  if [[ "${release_published:-false}" == true ]]; then
    gh release edit "$target_tag" --draft --latest=false || rollback_failed=1
  fi
  while IFS=$'\t' read -r provider key; do
    if [[ "$provider" == oss ]]; then
      ossutil api delete-object --bucket "$ALIYUN_OSS_BUCKET" --key "$key" \
        --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" \
        --output-format json >/dev/null || rollback_failed=1
    else
      aws s3api delete-object --bucket "$CLOUDFLARE_R2_BUCKET" --key "$key" \
        --endpoint-url "$r2_endpoint" >/dev/null || rollback_failed=1
    fi
  done < <(jq -r '
    [.immutableLedger[]
      | select(.createdByTransaction and .verified)]
    | unique_by([.provider, .key])
    | reverse[]
    | [.provider, .key]
    | @tsv
  ' "$journal")

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
    '{provider:"oss",key:$key,sha256:$sha,createdByTransaction:true,verified:false}' \
    > dist/state/ledger/entry.json
  advance_journal committing "before-create-oss-${probe_name}" dist/state/ledger/entry.json
  ossutil api put-object --bucket "$ALIYUN_OSS_BUCKET" --key "$key" \
    --body "file://${file}" --content-type "$content_type" \
    --cache-control "public, max-age=31536000, immutable" \
    --object-acl default --forbid-overwrite true \
    --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" --output-format json >/dev/null
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
    '{provider:"r2",key:$key,sha256:$sha,createdByTransaction:true,verified:false}' \
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
policy_write_completed=true
policy_written_etag="$(node scripts/updater/promotion-transaction.mjs \
  extract-r2-etag --metadata dist/state/policy-put-result.json)"
aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" \
  --key "$POLICY_KEY" --endpoint-url "$r2_endpoint" \
  dist/state/policy-readback.json > dist/state/policy-readback-metadata.json
cmp dist/state/next-policy.json dist/state/policy-readback.json
test "$(node scripts/updater/promotion-transaction.mjs extract-r2-etag \
  --metadata dist/state/policy-readback-metadata.json)" \
  = "$policy_written_etag"

if [[ "$update_legacy" == true ]]; then
  advance_journal committing before-legacy-dual-write
  ossutil api put-object --bucket "$ALIYUN_OSS_BUCKET" --key "$legacy_staging_key" \
    --body file://dist/candidate/latest.json --content-type application/json \
    --cache-control "public, max-age=60, must-revalidate" --object-acl default \
    --forbid-overwrite true --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" \
    --output-format json >/dev/null
  aws s3api put-object --bucket "$CLOUDFLARE_R2_BUCKET" --key "$legacy_staging_key" \
    --body dist/candidate/latest.json --content-type application/json \
    --cache-control "public, max-age=60, must-revalidate" --if-none-match '*' \
    --endpoint-url "$r2_endpoint" >/dev/null
  ossutil cp "oss://${ALIYUN_OSS_BUCKET}/${legacy_staging_key}" \
    dist/state/staged-legacy-oss.json --force \
    --endpoint "$oss_endpoint" --region "$ALIYUN_REGION"
  aws s3 cp "s3://${CLOUDFLARE_R2_BUCKET}/${legacy_staging_key}" \
    dist/state/staged-legacy-r2.json --endpoint-url "$r2_endpoint"
  cmp dist/candidate/latest.json dist/state/staged-legacy-oss.json
  cmp dist/state/staged-legacy-oss.json dist/state/staged-legacy-r2.json
  ossutil api put-object --bucket "$ALIYUN_OSS_BUCKET" --key "$LEGACY_ALIYUN_KEY" \
    --body file://dist/state/staged-legacy-oss.json --content-type application/json \
    --cache-control "public, max-age=60, must-revalidate" --object-acl "$legacy_oss_acl" \
    --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" --output-format json >/dev/null
  aws s3api put-object --bucket "$CLOUDFLARE_R2_BUCKET" --key "$LEGACY_R2_KEY" \
    --body dist/state/staged-legacy-r2.json --content-type application/json \
    --cache-control "public, max-age=60, must-revalidate" \
    --endpoint-url "$r2_endpoint" >/dev/null

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
    --url "$LEGACY_ALIYUN_URL" --expected dist/candidate/latest.json \
    --timeout-seconds 600 --interval-seconds 10 \
    --output dist/state/legacy-aliyun-cdn.json
  node scripts/updater/promotion-transaction.mjs poll-url \
    --url "$LEGACY_R2_URL" --expected dist/candidate/latest.json \
    --timeout-seconds 600 --interval-seconds 10 \
    --output dist/state/legacy-r2-cdn.json
fi

node scripts/updater/sign-request.mjs --current-version "$FROM_VERSION" \
  --target-version "$target_version" --rollout "$ROLLOUT" --salt "$ROLLOUT_SALT" \
  --output dist/state/probe-headers.json
endpoint="${DYNAMIC_UPDATER_BASE_URL}/windows/x86_64/${FROM_VERSION}"
curl_args=(--proto '=https' --tlsv1.2 -sS --connect-timeout 10 --max-time 120 \
  -o dist/state/probe-response.json -w '%{http_code}' "$endpoint")
while IFS=$'\t' read -r key value; do curl_args+=(-H "$key: $value"); done \
  < <(jq -r 'to_entries[] | [.key, .value] | @tsv' dist/state/probe-headers.json)
status="$(curl "${curl_args[@]}")"
if ! jq -e --arg from "$FROM_VERSION" '.transitions[$from]' \
  dist/state/next-policy.json >/dev/null || [[ "$ROLLOUT" == "0" ]]; then
  test "$status" = "204"
else
  test "$status" = "200"
  test "$(jq -r .version dist/state/probe-response.json)" = "$target_version"
fi

advance_journal committing before-release-publish
release_published=false
gh release edit "$target_tag" --draft=false --latest
release_published=true
if [[ "$update_legacy" == true ]]; then
  ossutil api delete-object --bucket "$ALIYUN_OSS_BUCKET" \
    --key "$legacy_staging_key" --endpoint "$oss_endpoint" \
    --region "$ALIYUN_REGION" --output-format json >/dev/null
  aws s3api delete-object --bucket "$CLOUDFLARE_R2_BUCKET" \
    --key "$legacy_staging_key" --endpoint-url "$r2_endpoint" >/dev/null
fi
advance_journal committed release-and-origins-verified
trap - ERR INT TERM
delete_open_journal
