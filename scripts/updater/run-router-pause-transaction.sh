#!/usr/bin/env bash
set -Eeuo pipefail

: "${CLOUDFLARE_R2_ACCOUNT_ID:?}"
: "${CLOUDFLARE_R2_BUCKET:?}"
: "${POLICY_KEY:?}"
: "${OPEN_TRANSACTION_KEY:?}"
: "${EXPECTED_CURRENT:?}"
: "${DYNAMIC_UPDATER_BASE_URL:?}"
: "${BIYAN_SIGNING_KEY:?}"
: "${ROLLOUT_SALT:?}"

test "$POLICY_KEY" = "biyan/updater/stable/policy.json"
test "$OPEN_TRANSACTION_KEY" = "biyan/updater/transactions/open.json"
test "$DYNAMIC_UPDATER_BASE_URL" = "https://updates.mita.so/biyan/v1/stable"

r2_endpoint="https://${CLOUDFLARE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
state_dir=dist/router-pause
probe_dir="${state_dir}/probes"
mkdir -p "$probe_dir"

put_skeleton="$(aws s3api put-object --generate-cli-skeleton input)"
jq -e 'has("IfMatch")' <<<"$put_skeleton" >/dev/null
unset put_skeleton

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

fetch_policy() {
  local name="$1"
  aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" \
    --key "$POLICY_KEY" --endpoint-url "$r2_endpoint" \
    "${state_dir}/${name}-policy.json" \
    >"${state_dir}/${name}-policy-metadata.json"
}

probe_router() {
  local name="$1" status state key value
  node scripts/updater/sign-request.mjs \
    --current-version "$EXPECTED_CURRENT" \
    --target-version "$EXPECTED_CURRENT" --rollout 0 \
    --salt "$ROLLOUT_SALT" \
    --output "${state_dir}/${name}-router-request.json"
  local -a curl_args=(
    --proto '=https' --tlsv1.2 --silent --show-error
    --connect-timeout 10 --max-time 120
    --dump-header "${state_dir}/${name}-router.headers"
    --output "${state_dir}/${name}-router.body"
    --write-out '%{http_code}'
    "${DYNAMIC_UPDATER_BASE_URL}/windows/x86_64/${EXPECTED_CURRENT}"
  )
  while IFS=$'\t' read -r key value; do
    curl_args+=(--header "$key: $value")
  done < <(jq -r 'to_entries[] | [.key, .value] | @tsv' \
    "${state_dir}/${name}-router-request.json")
  status="$(curl "${curl_args[@]}")"
  state="$(awk -F ': *' '
    tolower($1) == "x-biyan-updater-state" {
      gsub(/\r/, "", $2)
      value = $2
    }
    END { print value }
  ' "${state_dir}/${name}-router.headers")"
  printf '%s\n' "$status" >"${state_dir}/${name}-router.status"
  printf '%s\n' "$state" >"${state_dir}/${name}-router.state"
}

# A promotion or recovery journal blocks a concurrent policy writer.
probe_r2 "$OPEN_TRANSACTION_KEY" open-transaction
jq -e '.state == "absent"' \
  "${probe_dir}/open-transaction.json" >/dev/null

fetch_policy before
test "$(jq -er .currentVersion "${state_dir}/before-policy.json")" \
  = "$EXPECTED_CURRENT"
policy_before_etag="$(node scripts/updater/promotion-transaction.mjs \
  extract-r2-etag --metadata "${state_dir}/before-policy-metadata.json")"

node scripts/updater/router-pause-transaction.mjs prepare \
  --policy "${state_dir}/before-policy.json" \
  --expected-current "$EXPECTED_CURRENT" \
  --paused-at "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" \
  --output-policy "${state_dir}/paused-policy.json" \
  --output "${state_dir}/plan.json"

probe_router before
action="$(jq -er .action "${state_dir}/plan.json")"
if [[ "$action" == no-change ]]; then
  test "$(cat "${state_dir}/before-router.status")" = 204
  test "$(cat "${state_dir}/before-router.state")" = paused
  cp "${state_dir}/before-router.status" "${state_dir}/after-router.status"
  cp "${state_dir}/before-router.state" "${state_dir}/after-router.state"
  node scripts/updater/router-pause-transaction.mjs validate-readback \
    --expected "${state_dir}/paused-policy.json" \
    --actual "${state_dir}/before-policy.json" \
    --output "${state_dir}/pause-readback.json"
  node scripts/updater/router-pause-transaction.mjs validate-router-probe \
    --before-status 204 --before-state paused \
    --after-status 204 --after-state paused \
    --output "${state_dir}/router-pause-proof.json"
  jq -n --arg current "$EXPECTED_CURRENT" '{
    schema:1, kind:"router-pause-result", status:"already-paused",
    currentVersion:$current, mutated:false
  }' >"${state_dir}/summary.json"
  exit 0
fi
test "$action" = write
test "$(cat "${state_dir}/before-router.status")" = 204
test "$(cat "${state_dir}/before-router.state")" = no-transition
node scripts/updater/router-pause-transaction.mjs validate-policy \
  --before-policy "${state_dir}/before-policy.json" \
  --paused-policy "${state_dir}/paused-policy.json" \
  --expected-current "$EXPECTED_CURRENT" \
  --output "${state_dir}/policy-transition.json"

policy_write_attempted=false
fail_closed() {
  local original_rc=$?
  local status=pre-write-failure
  local observed_state=not-checked
  local mutated_json=false
  local requires_review_json=false
  if [[ "$original_rc" -eq 0 ]]; then original_rc=1; fi
  trap - ERR INT TERM
  set +e

  # A pause is a one-way safety action. Once its conditional PUT may have
  # reached Router policy, an error must never write the previous active policy
  # back. Observe the live state for evidence and leave any successful pause in
  # place; a later health-gated promotion is the only authorized resume path.
  if [[ "$policy_write_attempted" == true ]]; then
    status=pause-state-unknown
    observed_state=unavailable
    mutated_json=null
    requires_review_json=true
    if fetch_policy failure-observed; then
      if cmp -s "${state_dir}/paused-policy.json" \
        "${state_dir}/failure-observed-policy.json"; then
        status=paused-unverified
        observed_state=paused
        mutated_json=true
      elif cmp -s "${state_dir}/before-policy.json" \
        "${state_dir}/failure-observed-policy.json"; then
        status=write-not-applied
        observed_state=active
        mutated_json=false
      else
        status=live-policy-drift
        observed_state=unexpected
      fi
    fi
  fi

  jq -n --arg current "$EXPECTED_CURRENT" \
    --arg status "$status" --arg observedState "$observed_state" \
    --argjson writeAttempted "$policy_write_attempted" \
    --argjson mutated "$mutated_json" \
    --argjson requiresOperatorReview "$requires_review_json" '{
      schema:1, kind:"router-pause-result", status:$status,
      currentVersion:$current, policyWriteAttempted:$writeAttempted,
      observedState:$observedState, mutated:$mutated,
      automaticResumeAttempted:false,
      requiresOperatorReview:$requiresOperatorReview
    }' >"${state_dir}/summary.json"
  echo "Router pause failed closed; the previous active policy was not restored." >&2
  exit "$original_rc"
}
trap fail_closed ERR INT TERM

# Re-read at the mutation boundary and bind the write to the exact ETag.
fetch_policy forward
cmp "${state_dir}/before-policy.json" "${state_dir}/forward-policy.json"
test "$(node scripts/updater/promotion-transaction.mjs extract-r2-etag \
  --metadata "${state_dir}/forward-policy-metadata.json")" \
  = "$policy_before_etag"
policy_write_attempted=true
aws s3api put-object --bucket "$CLOUDFLARE_R2_BUCKET" \
  --key "$POLICY_KEY" --body "${state_dir}/paused-policy.json" \
  --content-type application/json --cache-control no-store \
  --if-match "$policy_before_etag" --endpoint-url "$r2_endpoint" \
  >"${state_dir}/policy-put-result.json"

fetch_policy paused-readback
node scripts/updater/router-pause-transaction.mjs validate-readback \
  --expected "${state_dir}/paused-policy.json" \
  --actual "${state_dir}/paused-readback-policy.json" \
  --output "${state_dir}/pause-readback.json"
probe_router after
node scripts/updater/router-pause-transaction.mjs validate-router-probe \
  --before-status "$(cat "${state_dir}/before-router.status")" \
  --before-state "$(cat "${state_dir}/before-router.state")" \
  --after-status "$(cat "${state_dir}/after-router.status")" \
  --after-state "$(cat "${state_dir}/after-router.state")" \
  --output "${state_dir}/router-pause-proof.json"

trap - ERR INT TERM
jq -n --arg current "$EXPECTED_CURRENT" '{
  schema:1, kind:"router-pause-result", status:"paused",
  currentVersion:$current, mutated:true
}' >"${state_dir}/summary.json"
