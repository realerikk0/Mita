#!/usr/bin/env node

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const OPEN_TRANSACTION_KEY =
  'biyan/updater/transactions/open.json'
export const TRANSACTION_PREFIX = 'biyan/updater/transactions'
export const TRUSTED_HEALTH_EVIDENCE_ORIGIN = 'https://static.mitapp.cn'
export const JOURNAL_STATES = Object.freeze([
  'prepared',
  'committing',
  'rollback-required',
  'rolled-back',
  'committed',
])

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const RUN_ID_PATTERN = /^[1-9][0-9]*$/

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  )
}

function assertPlainObject(value, description) {
  if (!isPlainObject(value)) throw new Error(`${description} must be an object`)
}

function assertExactKeys(value, expected, description) {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    throw new Error(
      `${description} keys must be exactly ${wanted.join(', ')}; found ${
        actual.join(', ') || '(none)'
      }`
    )
  }
}

function readJson(file, description = file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(
      `${description} is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

export function validateHealthEvidenceUrl(value, expectedSha256) {
  assertSha256(expectedSha256, 'Health evidence SHA-256')
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('Health evidence URL must be a valid URL')
  }
  const expectedPath =
    `/biyan/updater/evidence/${expectedSha256}/rollout-health.json`
  if (
    url.origin !== TRUSTED_HEALTH_EVIDENCE_ORIGIN ||
    url.pathname !== expectedPath ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      `Health evidence URL must be exactly ${TRUSTED_HEALTH_EVIDENCE_ORIGIN}${expectedPath}`
    )
  }
  return url.href
}

export function extractR2Etag(metadata) {
  assertPlainObject(metadata, 'R2 object metadata')
  const etag = metadata.ETag ?? metadata.etag
  if (
    typeof etag !== 'string' ||
    !/^"[0-9a-f]{32,64}(?:-[1-9][0-9]*)?"$/i.test(etag)
  ) {
    throw new Error('R2 object metadata has no strict quoted ETag')
  }
  return etag
}

export function classifyPolicyRollback({
  policyExisted,
  originalBytes = null,
  nextBytes,
  liveState,
  liveBytes = null,
}) {
  if (typeof policyExisted !== 'boolean') {
    throw new Error('Policy rollback requires an exact original existence state')
  }
  if (!Buffer.isBuffer(nextBytes) || nextBytes.length === 0) {
    throw new Error('Policy rollback requires nonempty proposed policy bytes')
  }
  if (liveState === 'absent') {
    if (policyExisted) {
      throw new Error(
        'Policy rollback is ambiguous: the original policy disappeared'
      )
    }
    return { action: 'no-change', reason: 'policy-remains-absent' }
  }
  if (liveState !== 'exists' || !Buffer.isBuffer(liveBytes)) {
    throw new Error('Policy rollback live state is not classifiable')
  }
  if (liveBytes.equals(nextBytes)) {
    return { action: 'restore', reason: 'proposed-policy-is-live' }
  }
  if (
    policyExisted &&
    Buffer.isBuffer(originalBytes) &&
    liveBytes.equals(originalBytes)
  ) {
    return { action: 'no-change', reason: 'original-policy-is-live' }
  }
  throw new Error(
    'Policy rollback is ambiguous: live bytes match neither original nor proposed policy'
  )
}

function normalizedMetadata(value) {
  assertPlainObject(value, 'Object metadata')
  const scalars = new Map()
  const customMetadata = {}
  const visit = (childValue, parentKey = '') => {
    if (!childValue || typeof childValue !== 'object') return
    for (const [key, child] of Object.entries(childValue)) {
      const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '')
      if (
        ['metadata', 'custom', 'custommetadata'].includes(parentKey) &&
        (typeof child === 'string' || typeof child === 'number')
      ) {
        customMetadata[key.replace(/^x-(?:amz|oss)-meta-/i, '')] = String(child)
      }
      if (typeof child === 'string' || typeof child === 'number') {
        if (!scalars.has(normalized)) scalars.set(normalized, String(child))
      } else {
        visit(child, normalized)
      }
    }
  }
  visit(value)
  const required = (name) => {
    const found = scalars.get(name)
    if (!found) throw new Error(`Object metadata is missing ${name}`)
    return found
  }
  const optional = (name) => scalars.get(name) ?? null
  return {
    cacheControl: required('cachecontrol'),
    contentType: required('contenttype'),
    contentEncoding: optional('contentencoding'),
    contentDisposition: optional('contentdisposition'),
    contentLanguage: optional('contentlanguage'),
    expires: optional('expires'),
    storageClass: optional('storageclass'),
    customMetadata: Object.fromEntries(
      Object.entries(customMetadata).sort(([left], [right]) =>
        left.localeCompare(right)
      )
    ),
  }
}

function normalizedAcl(value) {
  assertPlainObject(value, 'OSS ACL metadata')
  const values = []
  const visit = (childValue) => {
    if (!childValue || typeof childValue !== 'object') return
    for (const [key, child] of Object.entries(childValue)) {
      if (
        ['acl', 'objectacl'].includes(
          key.toLowerCase().replace(/[^a-z0-9]/g, '')
        ) &&
        typeof child === 'string'
      ) {
        values.push(child)
      } else {
        visit(child)
      }
    }
  }
  visit(value)
  const unique = [...new Set(values)]
  if (unique.length !== 1) {
    throw new Error('OSS ACL metadata has no unambiguous ACL')
  }
  return unique[0]
}

export function verifySnapshotReadback({
  snapshot,
  bytes,
  metadata,
  acl = null,
}) {
  validateObjectSnapshot(snapshot, 'Recovery snapshot')
  if (!snapshot.existed) {
    throw new Error('Absent recovery snapshots require an absence probe')
  }
  if (sha256Bytes(bytes) !== snapshot.bytesSha256) {
    throw new Error('Recovery snapshot bytes do not match')
  }
  const expectedMetadata = normalizedMetadata(snapshot.metadata)
  const actualMetadata = normalizedMetadata(metadata)
  if (JSON.stringify(actualMetadata) !== JSON.stringify(expectedMetadata)) {
    throw new Error('Recovery snapshot metadata does not match')
  }
  if (
    snapshot.provider === 'oss' &&
    normalizedAcl(acl) !== normalizedAcl(snapshot.acl)
  ) {
    throw new Error('Recovery snapshot ACL does not match')
  }
  return {
    provider: snapshot.provider,
    key: snapshot.key,
    sha256: snapshot.bytesSha256,
    metadata: actualMetadata,
    acl: snapshot.provider === 'oss' ? normalizedAcl(acl) : null,
  }
}

function assertSha256(value, description) {
  if (!SHA256_PATTERN.test(value ?? '')) {
    throw new Error(`${description} must be a lowercase SHA-256`)
  }
}

function assertVersion(value, description) {
  if (!VERSION_PATTERN.test(value ?? '')) {
    throw new Error(`${description} must be an explicit stable version`)
  }
}

function assertRunIdentity(runId, runAttempt) {
  if (!RUN_ID_PATTERN.test(String(runId ?? ''))) {
    throw new Error('Transaction runId must be a positive GitHub run ID')
  }
  if (!RUN_ID_PATTERN.test(String(runAttempt ?? ''))) {
    throw new Error('Transaction runAttempt must be a positive GitHub run attempt')
  }
}

export function classifyRemoteProbe({
  provider,
  key,
  exitCode,
  stdout = '',
  stderr = '',
}) {
  if (!['r2', 'oss'].includes(provider)) {
    throw new Error(`Unsupported remote probe provider: ${provider}`)
  }
  if (exitCode === 0) {
    return { provider, key, state: 'exists' }
  }
  const detail = `${stdout}\n${stderr}`
  const exactNotFound =
    provider === 'r2'
      ? /(?:\b404\b|NoSuchKey|Not Found)/i.test(detail)
      : /(?:\b404\b|NoSuchKey|SymlinkTargetNotExist|Not Found)/i.test(detail)
  const permissionOrTransportFailure =
    /(?:AccessDenied|Forbidden|InvalidAccessKey|SignatureDoesNotMatch|Unauthorized|timeout|timed out|connection|network|TLS|certificate|5\d\d)/i.test(
      detail
    )
  if (exactNotFound && !permissionOrTransportFailure) {
    return { provider, key, state: 'absent' }
  }
  throw new Error(
    `${provider.toUpperCase()} probe for ${key} failed and must not be treated as absent`
  )
}

export function validateApprovedATransition({
  policy,
  candidate,
  manifestBytes,
  currentPolicy,
  nextPolicy,
}) {
  assertPlainObject(policy, 'Approved A transition policy')
  assertExactKeys(
    policy,
    ['schema', 'state', 'current', 'approvedNext'],
    'Approved A transition policy'
  )
  if (policy.schema !== 1 || policy.state !== 'pre-a') {
    throw new Error('Approved A transition policy must be schema 1 in pre-a state')
  }
  assertPlainObject(policy.current, 'Approved A transition current')
  assertExactKeys(
    policy.current,
    ['version', 'manifestSha256'],
    'Approved A transition current'
  )
  assertVersion(policy.current.version, 'Approved A current version')
  assertSha256(
    policy.current.manifestSha256,
    'Approved A current manifestSha256'
  )
  assertPlainObject(policy.approvedNext, 'Approved A transition approvedNext')
  assertExactKeys(
    policy.approvedNext,
    ['version', 'manifestSha256', 'requiredPlatforms'],
    'Approved A transition approvedNext'
  )
  assertVersion(policy.approvedNext.version, 'Approved A next version')
  assertSha256(
    policy.approvedNext.manifestSha256,
    'Approved A next manifestSha256'
  )
  const expectedPlatforms = [
    'darwin-aarch64',
    'darwin-x86_64',
    'windows-x86_64',
    'linux-x86_64',
  ]
  if (
    !Array.isArray(policy.approvedNext.requiredPlatforms) ||
    policy.approvedNext.requiredPlatforms.join('\0') !==
      expectedPlatforms.join('\0')
  ) {
    throw new Error(
      `Approved A requiredPlatforms must be exactly ${expectedPlatforms.join(', ')}`
    )
  }
  if (
    candidate?.migrationPhase !== 'A' ||
    candidate?.dataSchema !== 1 ||
    candidate?.version !== policy.approvedNext.version
  ) {
    throw new Error('Initial A candidate does not match the approved next A identity')
  }
  const manifestSha256 = sha256Bytes(manifestBytes)
  if (
    candidate.manifestSha256 !== manifestSha256 ||
    policy.approvedNext.manifestSha256 !== manifestSha256
  ) {
    throw new Error('Initial A candidate manifest hash is not explicitly approved')
  }
  if (
    (currentPolicy?.legacyBridgeVersion ?? null) !== null ||
    nextPolicy?.legacyBridgeVersion !== candidate.version
  ) {
    throw new Error('Approved A transition requires null -> exact A legacy bridge')
  }
  return {
    version: candidate.version,
    manifestSha256,
    requiredPlatforms: [...expectedPlatforms],
  }
}

function validateObjectSnapshot(snapshot, description) {
  assertPlainObject(snapshot, description)
  assertExactKeys(
    snapshot,
    [
      'provider',
      'key',
      'existed',
      'bytesSha256',
      'metadata',
      'acl',
      'backupKey',
    ],
    description
  )
  if (!['r2', 'oss'].includes(snapshot.provider)) {
    throw new Error(`${description} has an unsupported provider`)
  }
  if (
    typeof snapshot.key !== 'string' ||
    !snapshot.key ||
    snapshot.key.startsWith('/') ||
    snapshot.key.includes('..')
  ) {
    throw new Error(`${description} has an unsafe object key`)
  }
  if (typeof snapshot.existed !== 'boolean') {
    throw new Error(`${description} existed must be boolean`)
  }
  if (snapshot.existed) {
    assertSha256(snapshot.bytesSha256, `${description} bytesSha256`)
    assertPlainObject(snapshot.metadata, `${description} metadata`)
    if (snapshot.provider === 'oss') {
      if (!isPlainObject(snapshot.acl)) {
        throw new Error(`${description} OSS ACL evidence is not restorable`)
      }
    } else if (snapshot.acl !== null) {
      throw new Error(`${description} R2 ACL must be null`)
    }
    if (
      typeof snapshot.backupKey !== 'string' ||
      !snapshot.backupKey.startsWith(`${TRANSACTION_PREFIX}/`)
    ) {
      throw new Error(`${description} backupKey must be transaction-scoped`)
    }
  } else if (
    snapshot.bytesSha256 !== null ||
    snapshot.metadata !== null ||
    snapshot.acl !== null ||
    snapshot.backupKey !== null
  ) {
    throw new Error(`${description} absent snapshot must contain only null state`)
  }
}

export function createJournal({
  runId,
  runAttempt,
  targetTag,
  targetVersion,
  sourceCommit,
  snapshots,
  createdAt,
}) {
  assertRunIdentity(runId, runAttempt)
  if (!/^v\d+\.\d+\.\d+$/.test(targetTag ?? '')) {
    throw new Error('Transaction targetTag must be an explicit stable tag')
  }
  assertVersion(targetVersion, 'Transaction targetVersion')
  if (targetTag !== `v${targetVersion}`) {
    throw new Error('Transaction target tag/version mismatch')
  }
  if (!/^[0-9a-f]{40}$/.test(sourceCommit ?? '')) {
    throw new Error('Transaction sourceCommit must be a lowercase commit SHA')
  }
  if (!Array.isArray(snapshots) || snapshots.length === 0) {
    throw new Error('Transaction must snapshot every mutable object')
  }
  snapshots.forEach((snapshot, index) =>
    validateObjectSnapshot(snapshot, `Transaction snapshot ${index}`)
  )
  const timestamp = new Date(createdAt)
  if (
    Number.isNaN(timestamp.valueOf()) ||
    timestamp.toISOString() !== createdAt
  ) {
    throw new Error('Transaction createdAt must be canonical ISO-8601')
  }
  return {
    schema: 1,
    transactionId: `${runId}-${runAttempt}`,
    runId: String(runId),
    runAttempt: String(runAttempt),
    state: 'prepared',
    targetTag,
    targetVersion,
    sourceCommit,
    createdAt,
    updatedAt: createdAt,
    sequence: 0,
    snapshots,
    immutableLedger: [],
    checkpoints: [],
    recovery: {
      required: false,
      commandsArtifact: `updater-promotion-${targetTag}-${runId}`,
    },
  }
}

export function validateJournal(journal) {
  assertPlainObject(journal, 'Promotion transaction journal')
  assertExactKeys(
    journal,
    [
      'schema',
      'transactionId',
      'runId',
      'runAttempt',
      'state',
      'targetTag',
      'targetVersion',
      'sourceCommit',
      'createdAt',
      'updatedAt',
      'sequence',
      'snapshots',
      'immutableLedger',
      'checkpoints',
      'recovery',
    ],
    'Promotion transaction journal'
  )
  if (journal.schema !== 1 || !JOURNAL_STATES.includes(journal.state)) {
    throw new Error('Promotion transaction journal schema/state is invalid')
  }
  assertRunIdentity(journal.runId, journal.runAttempt)
  if (journal.transactionId !== `${journal.runId}-${journal.runAttempt}`) {
    throw new Error('Promotion transaction journal identity mismatch')
  }
  if (
    journal.targetTag !== `v${journal.targetVersion}` ||
    !/^[0-9a-f]{40}$/.test(journal.sourceCommit ?? '')
  ) {
    throw new Error('Promotion transaction target identity is invalid')
  }
  if (!Number.isInteger(journal.sequence) || journal.sequence < 0) {
    throw new Error('Promotion transaction sequence must be nonnegative')
  }
  if (!Array.isArray(journal.snapshots) || journal.snapshots.length === 0) {
    throw new Error('Promotion transaction snapshots are missing')
  }
  journal.snapshots.forEach((snapshot, index) =>
    validateObjectSnapshot(snapshot, `Transaction snapshot ${index}`)
  )
  if (!Array.isArray(journal.immutableLedger)) {
    throw new Error('Promotion immutable ledger must be an array')
  }
  for (const [index, entry] of journal.immutableLedger.entries()) {
    assertPlainObject(entry, `Promotion immutable ledger ${index}`)
    assertExactKeys(
      entry,
      ['provider', 'key', 'sha256', 'createdByTransaction', 'verified'],
      `Promotion immutable ledger ${index}`
    )
    if (!['r2', 'oss'].includes(entry.provider)) {
      throw new Error(`Promotion immutable ledger ${index} provider is invalid`)
    }
    assertSha256(entry.sha256, `Promotion immutable ledger ${index} sha256`)
    if (
      typeof entry.createdByTransaction !== 'boolean' ||
      typeof entry.verified !== 'boolean'
    ) {
      throw new Error(`Promotion immutable ledger ${index} flags are invalid`)
    }
  }
  if (!Array.isArray(journal.checkpoints)) {
    throw new Error('Promotion transaction checkpoints must be an array')
  }
  assertPlainObject(journal.recovery, 'Promotion transaction recovery')
  assertExactKeys(
    journal.recovery,
    ['required', 'commandsArtifact'],
    'Promotion transaction recovery'
  )
  if (
    typeof journal.recovery.required !== 'boolean' ||
    typeof journal.recovery.commandsArtifact !== 'string' ||
    !journal.recovery.commandsArtifact
  ) {
    throw new Error('Promotion transaction recovery metadata is invalid')
  }
  return journal
}

export function advanceJournal(
  journalInput,
  { state, checkpoint, immutableEntry, updatedAt }
) {
  const journal = structuredClone(validateJournal(journalInput))
  if (!JOURNAL_STATES.includes(state)) {
    throw new Error(`Invalid promotion journal state: ${state}`)
  }
  const allowed = {
    prepared: new Set(['prepared', 'committing', 'rollback-required']),
    committing: new Set(['committing', 'rollback-required', 'committed']),
    'rollback-required': new Set(['rollback-required', 'rolled-back']),
    'rolled-back': new Set(['rolled-back']),
    committed: new Set(['committed']),
  }
  if (!allowed[journal.state].has(state)) {
    throw new Error(`Invalid promotion journal transition ${journal.state} -> ${state}`)
  }
  if (typeof checkpoint !== 'string' || !checkpoint.trim()) {
    throw new Error('Promotion journal checkpoint is required')
  }
  if (immutableEntry) {
    const probe = structuredClone(journal)
    probe.immutableLedger.push(immutableEntry)
    validateJournal(probe)
    journal.immutableLedger.push(immutableEntry)
  }
  const timestamp = new Date(updatedAt)
  if (
    Number.isNaN(timestamp.valueOf()) ||
    timestamp.toISOString() !== updatedAt ||
    Date.parse(updatedAt) < Date.parse(journal.updatedAt)
  ) {
    throw new Error('Promotion journal updatedAt must be monotonic ISO-8601')
  }
  journal.state = state
  journal.updatedAt = updatedAt
  journal.sequence += 1
  journal.checkpoints.push({
    sequence: journal.sequence,
    name: checkpoint,
    at: updatedAt,
  })
  journal.recovery.required = ['committing', 'rollback-required'].includes(state)
  return validateJournal(journal)
}

export function recoveryCommands(journalInput) {
  const journal = validateJournal(journalInput)
  const lines = [
    '# Generated from the durable promotion journal; run only in release-distribution recovery.',
    'set -euo pipefail',
    ': "${CLOUDFLARE_R2_ACCOUNT_ID:?}"',
    ': "${CLOUDFLARE_R2_BUCKET:?}"',
    ': "${ALIYUN_OSS_BUCKET:?}"',
    ': "${ALIYUN_OSS_ENDPOINT:?}"',
    ': "${ALIYUN_REGION:?}"',
    ': "${CLOUDFLARE_ZONE_ID:?}"',
    ': "${CLOUDFLARE_API_TOKEN:?}"',
    ': "${LEGACY_ALIYUN_URL:?}"',
    ': "${LEGACY_R2_URL:?}"',
    'JOURNAL="${JOURNAL:-promotion-journal.json}"',
    'r2_endpoint="https://${CLOUDFLARE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com"',
    'oss_endpoint="${ALIYUN_OSS_ENDPOINT#https://}"',
    'oss_endpoint="https://${oss_endpoint#http://}"',
    `transaction_id='${journal.transactionId}'`,
    `expected_tag='${journal.targetTag}'`,
  ]
  for (
    let index = journal.snapshots.length - 1;
    index >= 0;
    index -= 1
  ) {
    const snapshot = journal.snapshots[index]
    if (snapshot.existed) {
      if (snapshot.provider === 'r2') {
        lines.push(
          `aws s3 cp "s3://\${CLOUDFLARE_R2_BUCKET}/${snapshot.backupKey}" "s3://\${CLOUDFLARE_R2_BUCKET}/${snapshot.key}" --copy-props metadata-directive --endpoint-url "$r2_endpoint"`
        )
      } else {
        lines.push(
          `ossutil api copy-object --bucket "$ALIYUN_OSS_BUCKET" --key '${snapshot.key}' --copy-source "/\${ALIYUN_OSS_BUCKET}/${snapshot.backupKey}" --metadata-directive COPY --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" --output-format json >/dev/null`,
          `acl="$(jq -er '.snapshots[${index}].acl | .acl // .Acl // .objectAcl // .ObjectAcl' "$JOURNAL")"`,
          'case "$acl" in default|private|public-read) ;; *) echo "Unsafe ACL in journal" >&2; exit 1;; esac',
          `ossutil api put-object-acl --bucket "$ALIYUN_OSS_BUCKET" --key '${snapshot.key}' --object-acl "$acl" --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" --output-format json >/dev/null`
        )
      }
    } else {
      if (snapshot.provider === 'r2') {
        lines.push(
          `aws s3api delete-object --bucket "$CLOUDFLARE_R2_BUCKET" --key '${snapshot.key}' --endpoint-url "$r2_endpoint" >/dev/null`
        )
      } else {
        lines.push(
          `ossutil api delete-object --bucket "$ALIYUN_OSS_BUCKET" --key '${snapshot.key}' --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" --output-format json >/dev/null`
        )
      }
    }
  }
  for (const entry of journal.immutableLedger
    .filter((item) => item.createdByTransaction && item.verified)
    .reverse()) {
    if (entry.provider === 'r2') {
      lines.push(
        `aws s3api delete-object --bucket "$CLOUDFLARE_R2_BUCKET" --key '${entry.key}' --endpoint-url "$r2_endpoint" >/dev/null`
      )
    } else {
      lines.push(
        `ossutil api delete-object --bucket "$ALIYUN_OSS_BUCKET" --key '${entry.key}' --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" --output-format json >/dev/null`
      )
    }
  }
  lines.push('mkdir -p recovery-readback')
  for (const [index, snapshot] of journal.snapshots.entries()) {
    if (!snapshot.existed) continue
    if (snapshot.provider === 'r2') {
      lines.push(
        `aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" --key '${snapshot.key}' --endpoint-url "$r2_endpoint" "recovery-readback/r2-${index}" > "recovery-readback/r2-${index}-metadata.json"`,
        `node scripts/updater/promotion-transaction.mjs verify-snapshot-readback --journal "$JOURNAL" --index '${index}' --bytes "recovery-readback/r2-${index}" --metadata "recovery-readback/r2-${index}-metadata.json" --output "recovery-readback/r2-${index}-verified.json"`
      )
    } else {
      lines.push(
        `ossutil cp "oss://\${ALIYUN_OSS_BUCKET}/${snapshot.key}" "recovery-readback/oss-${index}" --force --endpoint "$oss_endpoint" --region "$ALIYUN_REGION"`,
        `ossutil api head-object --bucket "$ALIYUN_OSS_BUCKET" --key '${snapshot.key}' --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" --output-format json > "recovery-readback/oss-${index}-metadata.json"`,
        `ossutil api get-object-acl --bucket "$ALIYUN_OSS_BUCKET" --key '${snapshot.key}' --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" --output-format json > "recovery-readback/oss-${index}-acl.json"`,
        `node scripts/updater/promotion-transaction.mjs verify-snapshot-readback --journal "$JOURNAL" --index '${index}' --bytes "recovery-readback/oss-${index}" --metadata "recovery-readback/oss-${index}-metadata.json" --acl "recovery-readback/oss-${index}-acl.json" --output "recovery-readback/oss-${index}-verified.json"`
      )
    }
  }
  const legacyOssIndex = journal.snapshots.findIndex(
    ({ provider, key, existed }) =>
      existed && provider === 'oss' && key === 'mita/latest.json'
  )
  const legacyR2Index = journal.snapshots.findIndex(
    ({ provider, key, existed }) =>
      existed && provider === 'r2' && key === 'mita/latest.json'
  )
  if (legacyOssIndex < 0 || legacyR2Index < 0) {
    throw new Error('Recovery journal has no complete dual legacy snapshot')
  }
  lines.push(
    'aliyun cdn RefreshObjectCaches --ObjectPath "$LEGACY_ALIYUN_URL" --ObjectType File > recovery-readback/aliyun-cache-purge.json',
    'jq -e \'.RefreshTaskId or .RequestId\' recovery-readback/aliyun-cache-purge.json >/dev/null',
    'curl --proto \'=https\' --tlsv1.2 -fsS -X POST "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/purge_cache" -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" -H "Content-Type: application/json" --data "{\\"files\\":[\\"${LEGACY_R2_URL}\\"]}" > recovery-readback/cloudflare-cache-purge.json',
    'jq -e \'.success == true\' recovery-readback/cloudflare-cache-purge.json >/dev/null',
    `node scripts/updater/promotion-transaction.mjs poll-url --url "$LEGACY_ALIYUN_URL" --expected "recovery-readback/oss-${legacyOssIndex}" --timeout-seconds 600 --interval-seconds 10 --output recovery-readback/legacy-aliyun-cdn.json`,
    `node scripts/updater/promotion-transaction.mjs poll-url --url "$LEGACY_R2_URL" --expected "recovery-readback/r2-${legacyR2Index}" --timeout-seconds 600 --interval-seconds 10 --output recovery-readback/legacy-r2-cdn.json`,
    'gh release edit "$expected_tag" --draft --latest=false',
    `aws s3api delete-object --bucket "$CLOUDFLARE_R2_BUCKET" --key '${OPEN_TRANSACTION_KEY}' --endpoint-url "$r2_endpoint" >/dev/null`,
    `ossutil api delete-object --bucket "$ALIYUN_OSS_BUCKET" --key '${OPEN_TRANSACTION_KEY}' --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" --output-format json >/dev/null`
  )
  return `${lines.join('\n')}\n`
}

export async function pollPublicBytes({
  url,
  expectedBytes,
  timeoutMs = 10 * 60 * 1000,
  intervalMs = 10 * 1000,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  sleep = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
}) {
  if (
    typeof url !== 'string' ||
    !url.startsWith('https://') ||
    typeof fetchImpl !== 'function'
  ) {
    throw new Error('CDN poll requires an explicit HTTPS URL')
  }
  const expected = Buffer.from(expectedBytes)
  const expectedSha256 = sha256Bytes(expected)
  const deadline = now() + timeoutMs
  let last = 'no response'
  do {
    try {
      const response = await fetchImpl(url, {
        redirect: 'error',
        headers: {
          'cache-control': 'no-cache',
          pragma: 'no-cache',
        },
      })
      const bytes = Buffer.from(await response.arrayBuffer())
      const actualSha256 = sha256Bytes(bytes)
      last = `HTTP ${response.status}, sha256 ${actualSha256}`
      if (response.status === 200 && bytes.equals(expected)) {
        return {
          url,
          status: 200,
          sha256: expectedSha256,
          verifiedAt: new Date(now()).toISOString(),
        }
      }
    } catch (error) {
      last = error instanceof Error ? error.message : String(error)
    }
    if (now() >= deadline) break
    await sleep(intervalMs)
  } while (now() <= deadline)
  throw new Error(
    `CDN did not converge to ${expectedSha256} within ${timeoutMs}ms: ${last}`
  )
}

function parseArgs(argv) {
  const [command, ...rest] = argv
  const args = {}
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index]
    const value = rest[index + 1]
    if (!flag?.startsWith('--') || value === undefined) {
      throw new Error(`Unexpected or incomplete argument: ${flag ?? '(missing)'}`)
    }
    if (args[flag]) throw new Error(`Duplicate argument: ${flag}`)
    args[flag] = value
  }
  return { command, args }
}

async function runCli() {
  const { command, args } = parseArgs(process.argv.slice(2))
  if (command === 'classify-probe') {
    const result = classifyRemoteProbe({
      provider: args['--provider'],
      key: args['--key'],
      exitCode: Number(args['--exit-code']),
      stdout: args['--stdout']
        ? fs.readFileSync(path.resolve(args['--stdout']), 'utf8')
        : '',
      stderr: args['--stderr']
        ? fs.readFileSync(path.resolve(args['--stderr']), 'utf8')
        : '',
    })
    fs.writeFileSync(
      path.resolve(args['--output']),
      `${JSON.stringify(result, null, 2)}\n`
    )
    return
  }
  if (command === 'validate-approved-a') {
    const result = validateApprovedATransition({
      policy: readJson(path.resolve(args['--policy'])),
      candidate: readJson(path.resolve(args['--candidate'])),
      manifestBytes: fs.readFileSync(path.resolve(args['--manifest'])),
      currentPolicy: readJson(path.resolve(args['--current-policy'])),
      nextPolicy: readJson(path.resolve(args['--next-policy'])),
    })
    if (args['--output']) {
      fs.writeFileSync(
        path.resolve(args['--output']),
        `${JSON.stringify(result, null, 2)}\n`
      )
    }
    return
  }
  if (command === 'validate-health-evidence-url') {
    const url = validateHealthEvidenceUrl(
      args['--url'],
      args['--sha256']
    )
    if (args['--output']) {
      fs.writeFileSync(
        path.resolve(args['--output']),
        `${JSON.stringify({ url }, null, 2)}\n`
      )
    }
    return
  }
  if (command === 'extract-r2-etag') {
    process.stdout.write(
      `${extractR2Etag(readJson(path.resolve(args['--metadata'])))}\n`
    )
    return
  }
  if (command === 'classify-policy-rollback') {
    const policyExisted =
      args['--policy-existed'] === 'true'
        ? true
        : args['--policy-existed'] === 'false'
          ? false
          : null
    const liveState = args['--live-state']
    const result = classifyPolicyRollback({
      policyExisted,
      originalBytes: args['--original']
        ? fs.readFileSync(path.resolve(args['--original']))
        : null,
      nextBytes: fs.readFileSync(path.resolve(args['--next'])),
      liveState,
      liveBytes:
        liveState === 'exists' && args['--live']
          ? fs.readFileSync(path.resolve(args['--live']))
          : null,
    })
    fs.writeFileSync(
      path.resolve(args['--output']),
      `${JSON.stringify(result, null, 2)}\n`
    )
    return
  }
  if (command === 'verify-snapshot-readback') {
    const journal = validateJournal(
      readJson(path.resolve(args['--journal']))
    )
    const index = Number(args['--index'])
    if (!Number.isInteger(index) || !journal.snapshots[index]) {
      throw new Error('Recovery snapshot index is invalid')
    }
    const snapshot = journal.snapshots[index]
    const result = verifySnapshotReadback({
      snapshot,
      bytes: fs.readFileSync(path.resolve(args['--bytes'])),
      metadata: readJson(path.resolve(args['--metadata'])),
      acl: args['--acl']
        ? readJson(path.resolve(args['--acl']))
        : null,
    })
    if (args['--output']) {
      fs.writeFileSync(
        path.resolve(args['--output']),
        `${JSON.stringify(result, null, 2)}\n`
      )
    }
    return
  }
  if (command === 'validate-journal') {
    validateJournal(readJson(path.resolve(args['--journal'])))
    return
  }
  if (command === 'create-journal') {
    const journal = createJournal({
      runId: args['--run-id'],
      runAttempt: args['--run-attempt'],
      targetTag: args['--target-tag'],
      targetVersion: args['--target-version'],
      sourceCommit: args['--source-commit'],
      createdAt: args['--created-at'],
      snapshots: readJson(path.resolve(args['--snapshots'])),
    })
    fs.writeFileSync(
      path.resolve(args['--output']),
      `${JSON.stringify(journal, null, 2)}\n`
    )
    return
  }
  if (command === 'advance-journal') {
    const immutableEntry = args['--immutable-entry']
      ? readJson(path.resolve(args['--immutable-entry']))
      : undefined
    const journal = advanceJournal(readJson(path.resolve(args['--journal'])), {
      state: args['--state'],
      checkpoint: args['--checkpoint'],
      immutableEntry,
      updatedAt: args['--updated-at'],
    })
    fs.writeFileSync(
      path.resolve(args['--output']),
      `${JSON.stringify(journal, null, 2)}\n`
    )
    return
  }
  if (command === 'recovery-commands') {
    fs.writeFileSync(
      path.resolve(args['--output']),
      recoveryCommands(readJson(path.resolve(args['--journal'])))
    )
    return
  }
  if (command === 'poll-url') {
    const evidence = await pollPublicBytes({
      url: args['--url'],
      expectedBytes: fs.readFileSync(path.resolve(args['--expected'])),
      timeoutMs: Number(args['--timeout-seconds'] ?? 600) * 1000,
      intervalMs: Number(args['--interval-seconds'] ?? 10) * 1000,
    })
    fs.writeFileSync(
      path.resolve(args['--output']),
      `${JSON.stringify(evidence, null, 2)}\n`
    )
    return
  }
  throw new Error(`Unknown promotion transaction command: ${command}`)
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? '')) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
