#!/usr/bin/env node

import { createHash } from 'node:crypto'
import fs from 'node:fs'

export const STABLE_POLICY_KEY = 'biyan/updater/stable/policy.json'
export const LEGACY_MANIFEST_KEY = 'mita/latest.json'
export const LEGACY_PUBLIC_URLS = Object.freeze({
  oss: 'https://static.mitapp.cn/mita/latest.json',
  r2: 'https://updates.mita.so/mita/latest.json',
})
export const LEGACY_PAUSE_JOURNAL_STATES = Object.freeze([
  'prepared',
  'committing',
  'rollback-required',
  'rolled-back',
  'committed',
])

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const TRANSACTION_ID_PATTERN = /^[1-9][0-9]*-[1-9][0-9]*$/
const OBJECT_KINDS = new Set(['policy', 'legacy-oss', 'legacy-r2'])

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  )
}

function assertPlainObject(value, description) {
  if (!isPlainObject(value)) {
    throw new Error(`${description} must be an object`)
  }
}

function assertExactKeys(value, expectedKeys, description) {
  assertPlainObject(value, description)
  const actual = Object.keys(value).sort()
  const expected = [...expectedKeys].sort()
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error(
      `${description} keys must be exactly ${expected.join(', ')}; found ${
        actual.join(', ') || '(none)'
      }`
    )
  }
}

function assertVersion(value, description) {
  if (!VERSION_PATTERN.test(value ?? '')) {
    throw new Error(`${description} must be an explicit stable version`)
  }
}

function assertSha256(value, description) {
  if (!SHA256_PATTERN.test(value ?? '')) {
    throw new Error(`${description} must be a lowercase SHA-256`)
  }
}

function assertTransactionId(value, description = 'Transaction ID') {
  if (!TRANSACTION_ID_PATTERN.test(value ?? '')) {
    throw new Error(
      `${description} must be an exact positive GitHub run-attempt identity`
    )
  }
}

function assertCanonicalTimestamp(value, description) {
  const timestamp = new Date(value)
  if (
    typeof value !== 'string' ||
    Number.isNaN(timestamp.valueOf()) ||
    timestamp.toISOString() !== value
  ) {
    throw new Error(`${description} must be canonical ISO-8601`)
  }
}

function requireBytes(value, description) {
  if (!Buffer.isBuffer(value) || value.length === 0) {
    throw new Error(`${description} must be nonempty bytes`)
  }
  return value
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function parseJsonBytes(value, description) {
  requireBytes(value, description)
  let parsed
  try {
    parsed = JSON.parse(value.toString('utf8'))
  } catch (error) {
    throw new Error(
      `${description} is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
  assertPlainObject(parsed, description)
  return parsed
}

function compareVersions(left, right) {
  assertVersion(left, 'Left version')
  assertVersion(right, 'Right version')
  const a = left.split('.').map(Number)
  const b = right.split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index]
  }
  return 0
}

function fallbackBackupKey(transactionId, provider) {
  return (
    `biyan/updater/transactions/${transactionId}/backups/legacy-${provider}.json`
  )
}

function pauseBackupKey(transactionId, name) {
  return `biyan/updater/transactions/${transactionId}/backups/${name}.json`
}

function validateFallbackObject(fallback) {
  assertExactKeys(
    fallback,
    ['version', 'manifestSha256', 'transactionId', 'backups'],
    'Legacy pause fallback'
  )
  assertVersion(fallback.version, 'Legacy pause fallback version')
  assertSha256(
    fallback.manifestSha256,
    'Legacy pause fallback manifestSha256'
  )
  assertTransactionId(
    fallback.transactionId,
    'Legacy pause fallback transactionId'
  )
  assertExactKeys(
    fallback.backups,
    ['oss', 'r2'],
    'Legacy pause fallback backups'
  )
  for (const provider of ['oss', 'r2']) {
    const expected = fallbackBackupKey(fallback.transactionId, provider)
    if (fallback.backups[provider] !== expected) {
      throw new Error(
        `Legacy pause fallback backups.${provider} must be exactly ${expected}`
      )
    }
  }
  return structuredClone(fallback)
}

export function createLegacyPauseFallback(input) {
  assertExactKeys(
    input,
    ['version', 'manifestSha256', 'transactionId'],
    'Legacy pause fallback inputs'
  )
  return validateFallbackObject({
    version: input.version,
    manifestSha256: input.manifestSha256,
    transactionId: input.transactionId,
    backups: {
      oss: fallbackBackupKey(input.transactionId, 'oss'),
      r2: fallbackBackupKey(input.transactionId, 'r2'),
    },
  })
}

/**
 * Validate the immutable fallback pointer embedded in a live updater policy.
 */
export function validateLegacyPauseFallback(policy) {
  assertPlainObject(policy, 'Updater policy')
  if (!Object.hasOwn(policy, 'legacyPauseFallback')) {
    throw new Error('Updater policy must contain legacyPauseFallback')
  }
  return validateFallbackObject(policy.legacyPauseFallback)
}

export function validateLegacyPauseFallbackBytes(input) {
  assertExactKeys(
    input,
    ['fallback', 'ossBytes', 'r2Bytes'],
    'Legacy pause fallback byte inputs'
  )
  const { fallback, ossBytes, r2Bytes } = input
  const normalized = validateFallbackObject(fallback)
  requireBytes(ossBytes, 'OSS fallback manifest')
  requireBytes(r2Bytes, 'R2 fallback manifest')
  if (!ossBytes.equals(r2Bytes)) {
    throw new Error('Legacy pause fallback manifests must be byte-identical')
  }
  const actualSha256 = sha256(ossBytes)
  if (actualSha256 !== normalized.manifestSha256) {
    throw new Error(
      'Legacy pause fallback manifest bytes do not match manifestSha256'
    )
  }
  const manifest = parseJsonBytes(ossBytes, 'Legacy pause fallback manifest')
  if (manifest.version !== normalized.version) {
    throw new Error(
      `Legacy pause fallback manifest version must be exactly ${normalized.version}`
    )
  }
  return {
    fallback: normalized,
    manifestSha256: actualSha256,
    version: normalized.version,
  }
}

function validatePolicyIdentity(policy, expectedCurrentVersion, paused) {
  assertPlainObject(policy, 'Updater policy')
  if (policy.schema !== 1 || policy.channel !== 'stable') {
    throw new Error('Updater policy must be schema 1 on the stable channel')
  }
  assertVersion(expectedCurrentVersion, 'Expected current version')
  if (policy.currentVersion !== expectedCurrentVersion) {
    throw new Error(
      `Updater policy CAS failed: expected current ${expectedCurrentVersion}, got ${
        policy.currentVersion ?? '(missing)'
      }`
    )
  }
  if (policy.paused !== paused) {
    throw new Error(`Updater policy paused must be exactly ${paused}`)
  }
  assertVersion(policy.legacyBridgeVersion, 'Updater policy legacyBridgeVersion')
  assertPlainObject(policy.releases, 'Updater policy releases')
  const release = policy.releases[policy.legacyBridgeVersion]
  assertPlainObject(release, 'Updater policy active A release')
  if (release.effectivePhase !== 'A') {
    throw new Error(
      'Updater policy legacy bridge must resolve to an effective phase A release'
    )
  }
  if (!['A', 'RECOVERY'].includes(release.phase)) {
    throw new Error(
      'Updater policy legacy bridge release phase must be A or RECOVERY'
    )
  }
  assertSha256(
    release.manifestSha256,
    'Updater policy active A manifestSha256'
  )
  const fallback = validateLegacyPauseFallback(policy)
  if (compareVersions(fallback.version, policy.legacyBridgeVersion) >= 0) {
    throw new Error(
      'Legacy pause fallback version must be older than the active A bridge'
    )
  }
  return { release, fallback }
}

/**
 * Validate the privileged policy read and both public legacy A entrypoint
 * objects before any pause write is attempted.
 */
export function validateLivePauseInputs(input) {
  assertExactKeys(
    input,
    [
      'policyBytes',
      'expectedCurrentVersion',
      'ossLegacyBytes',
      'r2LegacyBytes',
    ],
    'Live legacy pause inputs'
  )
  const {
    policyBytes,
    expectedCurrentVersion,
    ossLegacyBytes,
    r2LegacyBytes,
  } = input
  const policy = parseJsonBytes(policyBytes, 'Live updater policy')
  const { release, fallback } = validatePolicyIdentity(
    policy,
    expectedCurrentVersion,
    false
  )
  requireBytes(ossLegacyBytes, 'Live OSS legacy manifest')
  requireBytes(r2LegacyBytes, 'Live R2 legacy manifest')
  if (!ossLegacyBytes.equals(r2LegacyBytes)) {
    throw new Error('Live OSS/R2 legacy manifests must be byte-identical')
  }
  const manifestSha256 = sha256(ossLegacyBytes)
  if (manifestSha256 !== release.manifestSha256) {
    throw new Error(
      'Live legacy A bytes do not match the policy A manifestSha256'
    )
  }
  const manifest = parseJsonBytes(ossLegacyBytes, 'Live legacy A manifest')
  if (manifest.version !== policy.legacyBridgeVersion) {
    throw new Error(
      `Live legacy A manifest version must be exactly ${policy.legacyBridgeVersion}`
    )
  }
  return {
    policy: structuredClone(policy),
    policySha256: sha256(policyBytes),
    expectedCurrentVersion,
    activeAVersion: policy.legacyBridgeVersion,
    activeAManifestSha256: manifestSha256,
    fallback,
  }
}

/**
 * Validate a paused policy, the fallback bytes currently served by both
 * legacy origins, and the immutable active-A bytes that a promotion will
 * restore before unpausing the Router.
 */
export function validateLegacyResumeInputs(input) {
  assertExactKeys(
    input,
    [
      'policyBytes',
      'expectedCurrentVersion',
      'ossLegacyBytes',
      'r2LegacyBytes',
      'activeABytes',
    ],
    'Legacy resume inputs'
  )
  const policy = parseJsonBytes(input.policyBytes, 'Paused updater policy')
  const { release, fallback } = validatePolicyIdentity(
    policy,
    input.expectedCurrentVersion,
    true
  )
  validateLegacyPauseFallbackBytes({
    fallback,
    ossBytes: input.ossLegacyBytes,
    r2Bytes: input.r2LegacyBytes,
  })
  requireBytes(input.activeABytes, 'Legacy resume active A manifest')
  const activeASha256 = sha256(input.activeABytes)
  if (activeASha256 !== release.manifestSha256) {
    throw new Error(
      'Legacy resume active A bytes do not match the policy A manifestSha256'
    )
  }
  const activeAManifest = parseJsonBytes(
    input.activeABytes,
    'Legacy resume active A manifest'
  )
  if (activeAManifest.version !== policy.legacyBridgeVersion) {
    throw new Error(
      `Legacy resume active A manifest version must be exactly ${policy.legacyBridgeVersion}`
    )
  }
  return {
    currentVersion: policy.currentVersion,
    activeAVersion: policy.legacyBridgeVersion,
    activeAManifestSha256: activeASha256,
    fallback,
  }
}

function withoutMutablePauseFields(policy) {
  const copy = structuredClone(policy)
  delete copy.paused
  delete copy.updatedAt
  return copy
}

function equivalentJson(left, right) {
  return JSON.stringify(sortJson(left)) === JSON.stringify(sortJson(right))
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson)
  if (!isPlainObject(value)) return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortJson(value[key])])
  )
}

function validateSnapshot(snapshot, expected, description) {
  assertExactKeys(
    snapshot,
    Object.keys(expected),
    description
  )
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (snapshot[key] !== expectedValue) {
      throw new Error(`${description}.${key} must be exactly ${expectedValue}`)
    }
  }
}

export function createLegacyPauseJournal(input) {
  assertExactKeys(
    input,
    [
      'transactionId',
      'createdAt',
      'expectedCurrentVersion',
      'policyBeforeBytes',
      'ossLegacyBeforeBytes',
      'r2LegacyBeforeBytes',
      'ossLegacyAclBytes',
      'proposedPausedPolicyBytes',
      'ossFallbackBytes',
      'r2FallbackBytes',
    ],
    'Legacy pause journal inputs'
  )
  const {
    transactionId,
    createdAt,
    expectedCurrentVersion,
    policyBeforeBytes,
    ossLegacyBeforeBytes,
    r2LegacyBeforeBytes,
    ossLegacyAclBytes,
    proposedPausedPolicyBytes,
    ossFallbackBytes,
    r2FallbackBytes,
  } = input
  assertTransactionId(transactionId)
  assertCanonicalTimestamp(createdAt, 'Legacy pause journal createdAt')
  const live = validateLivePauseInputs({
    policyBytes: policyBeforeBytes,
    expectedCurrentVersion,
    ossLegacyBytes: ossLegacyBeforeBytes,
    r2LegacyBytes: r2LegacyBeforeBytes,
  })
  validateLegacyPauseFallbackBytes({
    fallback: live.fallback,
    ossBytes: ossFallbackBytes,
    r2Bytes: r2FallbackBytes,
  })
  requireBytes(ossLegacyAclBytes, 'OSS legacy ACL snapshot')
  parseJsonBytes(ossLegacyAclBytes, 'OSS legacy ACL snapshot')

  const proposedPolicy = parseJsonBytes(
    proposedPausedPolicyBytes,
    'Proposed paused updater policy'
  )
  validatePolicyIdentity(proposedPolicy, expectedCurrentVersion, true)
  if (
    !equivalentJson(
      withoutMutablePauseFields(live.policy),
      withoutMutablePauseFields(proposedPolicy)
    )
  ) {
    throw new Error(
      'Proposed paused updater policy may change only paused and updatedAt'
    )
  }
  assertCanonicalTimestamp(
    proposedPolicy.updatedAt,
    'Proposed paused updater policy updatedAt'
  )
  if (Date.parse(proposedPolicy.updatedAt) < Date.parse(createdAt)) {
    throw new Error(
      'Proposed paused updater policy updatedAt must not precede journal creation'
    )
  }

  return {
    schema: 1,
    kind: 'legacy-pause',
    transactionId,
    state: 'prepared',
    createdAt,
    expectedCurrentVersion,
    policySnapshot: {
      provider: 'r2',
      key: STABLE_POLICY_KEY,
      bytesSha256: live.policySha256,
      backupKey: pauseBackupKey(transactionId, 'policy-before-pause'),
    },
    legacySnapshots: {
      oss: {
        provider: 'oss',
        key: LEGACY_MANIFEST_KEY,
        version: live.activeAVersion,
        manifestSha256: live.activeAManifestSha256,
        backupKey: pauseBackupKey(transactionId, 'legacy-a-oss'),
        aclSha256: sha256(ossLegacyAclBytes),
        aclBackupKey: pauseBackupKey(
          transactionId,
          'legacy-a-oss-acl'
        ),
      },
      r2: {
        provider: 'r2',
        key: LEGACY_MANIFEST_KEY,
        version: live.activeAVersion,
        manifestSha256: live.activeAManifestSha256,
        backupKey: pauseBackupKey(transactionId, 'legacy-a-r2'),
      },
    },
    fallback: live.fallback,
    proposedPausedPolicySha256: sha256(proposedPausedPolicyBytes),
    checkpoints: [],
    recoveryRequired: false,
  }
}

export function validateLegacyPauseJournal(journal) {
  assertExactKeys(
    journal,
    [
      'schema',
      'kind',
      'transactionId',
      'state',
      'createdAt',
      'expectedCurrentVersion',
      'policySnapshot',
      'legacySnapshots',
      'fallback',
      'proposedPausedPolicySha256',
      'checkpoints',
      'recoveryRequired',
    ],
    'Legacy pause journal'
  )
  if (journal.schema !== 1 || journal.kind !== 'legacy-pause') {
    throw new Error('Legacy pause journal schema/kind is invalid')
  }
  assertTransactionId(journal.transactionId)
  if (!LEGACY_PAUSE_JOURNAL_STATES.includes(journal.state)) {
    throw new Error(`Unknown legacy pause journal state: ${journal.state}`)
  }
  assertCanonicalTimestamp(journal.createdAt, 'Legacy pause journal createdAt')
  assertVersion(
    journal.expectedCurrentVersion,
    'Legacy pause journal expectedCurrentVersion'
  )
  validateSnapshot(
    journal.policySnapshot,
    {
      provider: 'r2',
      key: STABLE_POLICY_KEY,
      bytesSha256: journal.policySnapshot?.bytesSha256,
      backupKey: pauseBackupKey(
        journal.transactionId,
        'policy-before-pause'
      ),
    },
    'Legacy pause policy snapshot'
  )
  assertSha256(
    journal.policySnapshot.bytesSha256,
    'Legacy pause policy snapshot bytesSha256'
  )

  assertExactKeys(
    journal.legacySnapshots,
    ['oss', 'r2'],
    'Legacy pause legacy snapshots'
  )
  for (const provider of ['oss', 'r2']) {
    const snapshot = journal.legacySnapshots[provider]
    const expected = {
      provider,
      key: LEGACY_MANIFEST_KEY,
      version: snapshot?.version,
      manifestSha256: snapshot?.manifestSha256,
      backupKey: pauseBackupKey(
        journal.transactionId,
        `legacy-a-${provider}`
      ),
    }
    if (provider === 'oss') {
      expected.aclSha256 = snapshot?.aclSha256
      expected.aclBackupKey = pauseBackupKey(
        journal.transactionId,
        'legacy-a-oss-acl'
      )
    }
    validateSnapshot(
      snapshot,
      expected,
      `Legacy pause ${provider.toUpperCase()} snapshot`
    )
    assertVersion(
      snapshot.version,
      `Legacy pause ${provider.toUpperCase()} snapshot version`
    )
    assertSha256(
      snapshot.manifestSha256,
      `Legacy pause ${provider.toUpperCase()} snapshot manifestSha256`
    )
    if (provider === 'oss') {
      assertSha256(
        snapshot.aclSha256,
        'Legacy pause OSS snapshot aclSha256'
      )
    }
  }
  if (
    journal.legacySnapshots.oss.version !==
      journal.legacySnapshots.r2.version ||
    journal.legacySnapshots.oss.manifestSha256 !==
      journal.legacySnapshots.r2.manifestSha256
  ) {
    throw new Error(
      'Legacy pause OSS/R2 snapshots must describe identical A bytes'
    )
  }
  const fallback = validateFallbackObject(journal.fallback)
  if (
    compareVersions(
      fallback.version,
      journal.legacySnapshots.r2.version
    ) >= 0
  ) {
    throw new Error(
      'Legacy pause journal fallback must be older than its A snapshots'
    )
  }
  assertSha256(
    journal.proposedPausedPolicySha256,
    'Legacy pause proposed policy SHA-256'
  )
  if (!Array.isArray(journal.checkpoints)) {
    throw new Error('Legacy pause journal checkpoints must be an array')
  }
  let previousTimestamp = Date.parse(journal.createdAt)
  journal.checkpoints.forEach((checkpoint, index) => {
    assertExactKeys(
      checkpoint,
      ['sequence', 'name', 'at'],
      `Legacy pause checkpoint ${index}`
    )
    if (checkpoint.sequence !== index + 1) {
      throw new Error(
        `Legacy pause checkpoint ${index} sequence must be ${index + 1}`
      )
    }
    if (typeof checkpoint.name !== 'string' || !checkpoint.name.trim()) {
      throw new Error(`Legacy pause checkpoint ${index} name is required`)
    }
    assertCanonicalTimestamp(
      checkpoint.at,
      `Legacy pause checkpoint ${index} at`
    )
    if (Date.parse(checkpoint.at) < previousTimestamp) {
      throw new Error('Legacy pause checkpoint timestamps must be monotonic')
    }
    previousTimestamp = Date.parse(checkpoint.at)
  })
  if (typeof journal.recoveryRequired !== 'boolean') {
    throw new Error('Legacy pause journal recoveryRequired must be boolean')
  }
  const expectedRecoveryRequired = ['committing', 'rollback-required'].includes(
    journal.state
  )
  if (journal.recoveryRequired !== expectedRecoveryRequired) {
    throw new Error(
      `Legacy pause journal recoveryRequired must be ${expectedRecoveryRequired} in state ${journal.state}`
    )
  }
  return journal
}

export function advanceLegacyPauseJournal(input) {
  assertExactKeys(
    input,
    ['journal', 'state', 'checkpoint', 'updatedAt'],
    'Legacy pause journal advance inputs'
  )
  const journal = structuredClone(input.journal)
  validateLegacyPauseJournal(journal)
  if (!LEGACY_PAUSE_JOURNAL_STATES.includes(input.state)) {
    throw new Error(`Unknown legacy pause journal state: ${input.state}`)
  }
  if (typeof input.checkpoint !== 'string' || !input.checkpoint.trim()) {
    throw new Error('Legacy pause journal checkpoint is required')
  }
  assertCanonicalTimestamp(
    input.updatedAt,
    'Legacy pause journal checkpoint time'
  )
  const previousTimestamp =
    journal.checkpoints.at(-1)?.at ?? journal.createdAt
  if (Date.parse(input.updatedAt) < Date.parse(previousTimestamp)) {
    throw new Error('Legacy pause checkpoint timestamps must be monotonic')
  }
  const transitions = {
    prepared: new Set(['committing', 'rollback-required']),
    committing: new Set(['committing', 'committed', 'rollback-required']),
    'rollback-required': new Set(['rollback-required', 'rolled-back']),
    'rolled-back': new Set(),
    committed: new Set(),
  }
  if (!transitions[journal.state].has(input.state)) {
    throw new Error(
      `Invalid legacy pause journal transition ${journal.state} -> ${input.state}`
    )
  }
  journal.state = input.state
  journal.recoveryRequired = ['committing', 'rollback-required'].includes(
    input.state
  )
  journal.checkpoints.push({
    sequence: journal.checkpoints.length + 1,
    name: input.checkpoint,
    at: input.updatedAt,
  })
  validateLegacyPauseJournal(journal)
  return journal
}

function validateByteDecisionInput(input, description) {
  assertExactKeys(
    input,
    ['objectKind', 'liveState', 'liveBytes', 'beforeBytes', 'pausedBytes'],
    description
  )
  if (!OBJECT_KINDS.has(input.objectKind)) {
    throw new Error(`Unsupported legacy pause object kind: ${input.objectKind}`)
  }
  if (input.liveState !== 'exists') {
    throw new Error(
      `${description} requires an exact exists state; found ${
        input.liveState ?? '(missing)'
      }`
    )
  }
  requireBytes(input.liveBytes, `${description} live bytes`)
  requireBytes(input.beforeBytes, `${description} before bytes`)
  requireBytes(input.pausedBytes, `${description} paused bytes`)
  if (input.beforeBytes.equals(input.pausedBytes)) {
    throw new Error(`${description} before and paused bytes must differ`)
  }
}

/**
 * Content-CAS decision made immediately before each forward pause write.
 */
export function classifyLegacyPauseCas(input) {
  validateByteDecisionInput(input, 'Legacy pause CAS')
  if (input.liveBytes.equals(input.beforeBytes)) {
    return { action: 'write', reason: 'before-pause-bytes-are-live' }
  }
  if (input.liveBytes.equals(input.pausedBytes)) {
    return { action: 'no-change', reason: 'paused-bytes-are-already-live' }
  }
  throw new Error(
    `Legacy pause CAS refused unknown live bytes for ${input.objectKind}`
  )
}

/**
 * Roll back only bytes written by this pause transaction. A third state is
 * never guessed or overwritten.
 */
export function classifyLegacyPauseRollback(input) {
  validateByteDecisionInput(input, 'Legacy pause rollback')
  if (input.liveBytes.equals(input.pausedBytes)) {
    return { action: 'restore', reason: 'paused-bytes-are-live' }
  }
  if (input.liveBytes.equals(input.beforeBytes)) {
    return { action: 'no-change', reason: 'before-pause-bytes-are-live' }
  }
  throw new Error(
    `Legacy pause rollback refused unknown live bytes for ${input.objectKind}`
  )
}

function validatePublicEndpointReadback(value, provider, fallbackBytes) {
  assertExactKeys(
    value,
    ['url', 'status', 'bytes'],
    `Public ${provider.toUpperCase()} legacy readback`
  )
  if (value.url !== LEGACY_PUBLIC_URLS[provider]) {
    throw new Error(
      `Public ${provider.toUpperCase()} legacy readback URL must be exactly ${
        LEGACY_PUBLIC_URLS[provider]
      }`
    )
  }
  if (value.status !== 200) {
    throw new Error(
      `Public ${provider.toUpperCase()} legacy readback status must be 200`
    )
  }
  requireBytes(
    value.bytes,
    `Public ${provider.toUpperCase()} legacy readback bytes`
  )
  if (!value.bytes.equals(fallbackBytes)) {
    throw new Error(
      `Public ${provider.toUpperCase()} legacy readback does not match fallback bytes`
    )
  }
}

export function validatePublicPauseReadback(input) {
  assertExactKeys(
    input,
    [
      'policyBytes',
      'expectedPausedPolicyBytes',
      'fallbackBytes',
      'oss',
      'r2',
      'routerStatus',
    ],
    'Public legacy pause readback inputs'
  )
  const {
    policyBytes,
    expectedPausedPolicyBytes,
    fallbackBytes,
    oss,
    r2,
    routerStatus,
  } = input
  requireBytes(policyBytes, 'Paused policy readback')
  requireBytes(expectedPausedPolicyBytes, 'Expected paused policy')
  if (!policyBytes.equals(expectedPausedPolicyBytes)) {
    throw new Error('Paused policy readback must match the proposed bytes exactly')
  }
  const policy = parseJsonBytes(policyBytes, 'Paused policy readback')
  if (policy.schema !== 1 || policy.channel !== 'stable' || policy.paused !== true) {
    throw new Error(
      'Paused policy readback must be schema 1, stable, and paused'
    )
  }
  const fallback = validateLegacyPauseFallback(policy)
  requireBytes(fallbackBytes, 'Legacy pause fallback readback target')
  if (sha256(fallbackBytes) !== fallback.manifestSha256) {
    throw new Error(
      'Legacy pause fallback readback target does not match manifestSha256'
    )
  }
  const fallbackManifest = parseJsonBytes(
    fallbackBytes,
    'Legacy pause fallback readback target'
  )
  if (fallbackManifest.version !== fallback.version) {
    throw new Error(
      `Legacy pause fallback readback version must be exactly ${fallback.version}`
    )
  }
  validatePublicEndpointReadback(oss, 'oss', fallbackBytes)
  validatePublicEndpointReadback(r2, 'r2', fallbackBytes)
  if (routerStatus !== 204) {
    throw new Error('Paused updater Router readback status must be 204')
  }
  return {
    status: 'passed',
    policySha256: sha256(policyBytes),
    fallbackVersion: fallback.version,
    fallbackManifestSha256: fallback.manifestSha256,
    ossStatus: oss.status,
    r2Status: r2.status,
    routerStatus,
  }
}

export function validateRouterPauseProbe(input) {
  assertExactKeys(
    input,
    ['beforeStatus', 'beforeState', 'afterStatus', 'afterState'],
    'Router pause probe inputs'
  )
  if (input.beforeStatus !== 204 || input.beforeState !== 'no-transition') {
    throw new Error(
      'Router pre-pause capability probe must be authenticated 204/no-transition'
    )
  }
  if (input.afterStatus !== 204 || input.afterState !== 'paused') {
    throw new Error(
      'Router post-pause probe must be authenticated 204/paused'
    )
  }
  return {
    status: 'passed',
    before: { status: input.beforeStatus, state: input.beforeState },
    after: { status: input.afterStatus, state: input.afterState },
  }
}

function parseArgs(argv) {
  const result = {}
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith('--') || value === undefined || value.startsWith('--')) {
      throw new Error(`Invalid CLI argument near ${key ?? '(end)'}`)
    }
    const name = key.slice(2)
    if (Object.hasOwn(result, name)) {
      throw new Error(`Duplicate CLI argument: --${name}`)
    }
    result[name] = value
  }
  return result
}

function requireCliArgs(args, expected, command) {
  assertExactKeys(args, expected, `${command} arguments`)
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

function runCli() {
  const [command, ...rawArgs] = process.argv.slice(2)
  const args = parseArgs(rawArgs)
  if (command === 'create-fallback') {
    requireCliArgs(
      args,
      ['version', 'manifest-sha256', 'transaction-id', 'output'],
      command
    )
    writeJson(
      args.output,
      createLegacyPauseFallback({
        version: args.version,
        manifestSha256: args['manifest-sha256'],
        transactionId: args['transaction-id'],
      })
    )
    return
  }
  if (command === 'validate-fallback') {
    requireCliArgs(args, ['policy', 'output'], command)
    const policy = JSON.parse(fs.readFileSync(args.policy, 'utf8'))
    writeJson(args.output, validateLegacyPauseFallback(policy))
    return
  }
  if (command === 'validate-fallback-bytes') {
    requireCliArgs(args, ['policy', 'oss', 'r2', 'output'], command)
    const policy = JSON.parse(fs.readFileSync(args.policy, 'utf8'))
    writeJson(
      args.output,
      validateLegacyPauseFallbackBytes({
        fallback: validateLegacyPauseFallback(policy),
        ossBytes: fs.readFileSync(args.oss),
        r2Bytes: fs.readFileSync(args.r2),
      })
    )
    return
  }
  if (command === 'validate-live') {
    requireCliArgs(
      args,
      ['policy', 'expected-current', 'oss-legacy', 'r2-legacy', 'output'],
      command
    )
    writeJson(
      args.output,
      validateLivePauseInputs({
        policyBytes: fs.readFileSync(args.policy),
        expectedCurrentVersion: args['expected-current'],
        ossLegacyBytes: fs.readFileSync(args['oss-legacy']),
        r2LegacyBytes: fs.readFileSync(args['r2-legacy']),
      })
    )
    return
  }
  if (command === 'validate-resume') {
    requireCliArgs(
      args,
      [
        'policy',
        'expected-current',
        'oss-legacy',
        'r2-legacy',
        'active-a',
        'output',
      ],
      command
    )
    writeJson(
      args.output,
      validateLegacyResumeInputs({
        policyBytes: fs.readFileSync(args.policy),
        expectedCurrentVersion: args['expected-current'],
        ossLegacyBytes: fs.readFileSync(args['oss-legacy']),
        r2LegacyBytes: fs.readFileSync(args['r2-legacy']),
        activeABytes: fs.readFileSync(args['active-a']),
      })
    )
    return
  }
  if (command === 'create-journal') {
    requireCliArgs(
      args,
      [
        'transaction-id',
        'created-at',
        'expected-current',
        'policy-before',
        'oss-legacy-before',
        'r2-legacy-before',
        'oss-legacy-acl',
        'proposed-policy',
        'oss-fallback',
        'r2-fallback',
        'output',
      ],
      command
    )
    writeJson(
      args.output,
      createLegacyPauseJournal({
        transactionId: args['transaction-id'],
        createdAt: args['created-at'],
        expectedCurrentVersion: args['expected-current'],
        policyBeforeBytes: fs.readFileSync(args['policy-before']),
        ossLegacyBeforeBytes: fs.readFileSync(args['oss-legacy-before']),
        r2LegacyBeforeBytes: fs.readFileSync(args['r2-legacy-before']),
        ossLegacyAclBytes: fs.readFileSync(args['oss-legacy-acl']),
        proposedPausedPolicyBytes: fs.readFileSync(args['proposed-policy']),
        ossFallbackBytes: fs.readFileSync(args['oss-fallback']),
        r2FallbackBytes: fs.readFileSync(args['r2-fallback']),
      })
    )
    return
  }
  if (command === 'validate-journal') {
    requireCliArgs(args, ['journal'], command)
    validateLegacyPauseJournal(
      JSON.parse(fs.readFileSync(args.journal, 'utf8'))
    )
    return
  }
  if (command === 'advance-journal') {
    requireCliArgs(
      args,
      ['journal', 'state', 'checkpoint', 'updated-at', 'output'],
      command
    )
    writeJson(
      args.output,
      advanceLegacyPauseJournal({
        journal: JSON.parse(fs.readFileSync(args.journal, 'utf8')),
        state: args.state,
        checkpoint: args.checkpoint,
        updatedAt: args['updated-at'],
      })
    )
    return
  }
  if (command === 'classify-cas' || command === 'classify-rollback') {
    requireCliArgs(
      args,
      ['object-kind', 'live-state', 'live', 'before', 'paused', 'output'],
      command
    )
    const classifier =
      command === 'classify-cas'
        ? classifyLegacyPauseCas
        : classifyLegacyPauseRollback
    writeJson(
      args.output,
      classifier({
        objectKind: args['object-kind'],
        liveState: args['live-state'],
        liveBytes: fs.readFileSync(args.live),
        beforeBytes: fs.readFileSync(args.before),
        pausedBytes: fs.readFileSync(args.paused),
      })
    )
    return
  }
  if (command === 'validate-readback') {
    requireCliArgs(
      args,
      [
        'policy',
        'expected-policy',
        'fallback',
        'oss-url',
        'oss-status',
        'oss-bytes',
        'r2-url',
        'r2-status',
        'r2-bytes',
        'router-status',
        'output',
      ],
      command
    )
    writeJson(
      args.output,
      validatePublicPauseReadback({
        policyBytes: fs.readFileSync(args.policy),
        expectedPausedPolicyBytes: fs.readFileSync(args['expected-policy']),
        fallbackBytes: fs.readFileSync(args.fallback),
        oss: {
          url: args['oss-url'],
          status: Number(args['oss-status']),
          bytes: fs.readFileSync(args['oss-bytes']),
        },
        r2: {
          url: args['r2-url'],
          status: Number(args['r2-status']),
          bytes: fs.readFileSync(args['r2-bytes']),
        },
        routerStatus: Number(args['router-status']),
      })
    )
    return
  }

  if (command === 'validate-router-probe') {
    requireCliArgs(
      args,
      [
        'before-status',
        'before-state',
        'after-status',
        'after-state',
        'output',
      ],
      command
    )
    writeJson(
      args.output,
      validateRouterPauseProbe({
        beforeStatus: Number(args['before-status']),
        beforeState: args['before-state'],
        afterStatus: Number(args['after-status']),
        afterState: args['after-state'],
      })
    )
    return
  }
  throw new Error(
    'Usage: legacy-pause-transaction.mjs <create-fallback|validate-fallback|validate-fallback-bytes|validate-live|validate-resume|create-journal|validate-journal|advance-journal|classify-cas|classify-rollback|validate-readback|validate-router-probe> ...'
  )
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    runCli()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
