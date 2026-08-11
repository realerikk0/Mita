#!/usr/bin/env node

// Historical, read-only validation for the retired schema-1 legacy pause
// transaction. This module deliberately exposes no journal creation,
// transition, write, rollback, purge, or restore interface.

import { createHash } from 'node:crypto'
import fs from 'node:fs'

export const STABLE_POLICY_KEY = 'biyan/updater/stable/policy.json'
export const LEGACY_MANIFEST_KEY = 'mita/latest.json'
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
      }`,
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
      `${description} must be an exact positive GitHub run-attempt identity`,
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
      }`,
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

function transactionBackupKey(transactionId, name) {
  return `biyan/updater/transactions/${transactionId}/backups/${name}.json`
}

function fallbackBackupKey(transactionId, provider) {
  return transactionBackupKey(transactionId, `legacy-${provider}`)
}

function validateFallbackObject(fallback) {
  assertExactKeys(
    fallback,
    ['version', 'manifestSha256', 'transactionId', 'backups'],
    'Legacy pause fallback',
  )
  assertVersion(fallback.version, 'Legacy pause fallback version')
  assertSha256(
    fallback.manifestSha256,
    'Legacy pause fallback manifestSha256',
  )
  assertTransactionId(
    fallback.transactionId,
    'Legacy pause fallback transactionId',
  )
  assertExactKeys(
    fallback.backups,
    ['oss', 'r2'],
    'Legacy pause fallback backups',
  )
  for (const provider of ['oss', 'r2']) {
    const expected = fallbackBackupKey(fallback.transactionId, provider)
    if (fallback.backups[provider] !== expected) {
      throw new Error(
        `Legacy pause fallback backups.${provider} must be exactly ${expected}`,
      )
    }
  }
  return structuredClone(fallback)
}

/** Validate the immutable fallback pointer embedded in a policy. */
export function validateLegacyPauseFallback(policy) {
  assertPlainObject(policy, 'Updater policy')
  if (!Object.hasOwn(policy, 'legacyPauseFallback')) {
    throw new Error('Updater policy must contain legacyPauseFallback')
  }
  return validateFallbackObject(policy.legacyPauseFallback)
}

/** Validate the two archived fallback replicas without changing either one. */
export function validateLegacyPauseFallbackBytes(input) {
  assertExactKeys(
    input,
    ['fallback', 'ossBytes', 'r2Bytes'],
    'Legacy pause fallback byte inputs',
  )
  const fallback = validateFallbackObject(input.fallback)
  const ossBytes = requireBytes(input.ossBytes, 'OSS fallback manifest')
  const r2Bytes = requireBytes(input.r2Bytes, 'R2 fallback manifest')
  if (!ossBytes.equals(r2Bytes)) {
    throw new Error('Legacy pause fallback manifests must be byte-identical')
  }
  const manifestSha256 = sha256(ossBytes)
  if (manifestSha256 !== fallback.manifestSha256) {
    throw new Error(
      'Legacy pause fallback manifest bytes do not match manifestSha256',
    )
  }
  const manifest = parseJsonBytes(ossBytes, 'Legacy pause fallback manifest')
  if (manifest.version !== fallback.version) {
    throw new Error(
      `Legacy pause fallback manifest version must be exactly ${fallback.version}`,
    )
  }
  return {
    fallback,
    manifestSha256,
    version: fallback.version,
  }
}

function validateSnapshot(snapshot, expected, description) {
  assertExactKeys(snapshot, Object.keys(expected), description)
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (snapshot[key] !== expectedValue) {
      throw new Error(`${description}.${key} must be exactly ${expectedValue}`)
    }
  }
}

/**
 * Validate a closed schema-1 historical journal. The accepted shape is fixed
 * so archived incident evidence can be audited after all legacy writers have
 * been retired.
 */
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
    'Legacy pause journal',
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
    'Legacy pause journal expectedCurrentVersion',
  )

  validateSnapshot(
    journal.policySnapshot,
    {
      provider: 'r2',
      key: STABLE_POLICY_KEY,
      bytesSha256: journal.policySnapshot?.bytesSha256,
      backupKey: transactionBackupKey(
        journal.transactionId,
        'policy-before-pause',
      ),
    },
    'Legacy pause policy snapshot',
  )
  assertSha256(
    journal.policySnapshot.bytesSha256,
    'Legacy pause policy snapshot bytesSha256',
  )

  assertExactKeys(
    journal.legacySnapshots,
    ['oss', 'r2'],
    'Legacy pause legacy snapshots',
  )
  for (const provider of ['oss', 'r2']) {
    const snapshot = journal.legacySnapshots[provider]
    const expected = {
      provider,
      key: LEGACY_MANIFEST_KEY,
      version: snapshot?.version,
      manifestSha256: snapshot?.manifestSha256,
      backupKey: transactionBackupKey(
        journal.transactionId,
        `legacy-a-${provider}`,
      ),
    }
    if (provider === 'oss') {
      expected.aclSha256 = snapshot?.aclSha256
      expected.aclBackupKey = transactionBackupKey(
        journal.transactionId,
        'legacy-a-oss-acl',
      )
    }
    validateSnapshot(
      snapshot,
      expected,
      `Legacy pause ${provider.toUpperCase()} snapshot`,
    )
    assertVersion(
      snapshot.version,
      `Legacy pause ${provider.toUpperCase()} snapshot version`,
    )
    assertSha256(
      snapshot.manifestSha256,
      `Legacy pause ${provider.toUpperCase()} snapshot manifestSha256`,
    )
    if (provider === 'oss') {
      assertSha256(snapshot.aclSha256, 'Legacy pause OSS snapshot aclSha256')
    }
  }
  if (
    journal.legacySnapshots.oss.version !== journal.legacySnapshots.r2.version ||
    journal.legacySnapshots.oss.manifestSha256 !==
      journal.legacySnapshots.r2.manifestSha256
  ) {
    throw new Error(
      'Legacy pause OSS/R2 snapshots must describe identical A bytes',
    )
  }

  const fallback = validateFallbackObject(journal.fallback)
  if (compareVersions(fallback.version, journal.legacySnapshots.r2.version) >= 0) {
    throw new Error(
      'Legacy pause journal fallback must be older than its A snapshots',
    )
  }
  assertSha256(
    journal.proposedPausedPolicySha256,
    'Legacy pause proposed policy SHA-256',
  )

  if (!Array.isArray(journal.checkpoints)) {
    throw new Error('Legacy pause journal checkpoints must be an array')
  }
  let previousTimestamp = Date.parse(journal.createdAt)
  journal.checkpoints.forEach((checkpoint, index) => {
    assertExactKeys(
      checkpoint,
      ['sequence', 'name', 'at'],
      `Legacy pause checkpoint ${index}`,
    )
    if (checkpoint.sequence !== index + 1) {
      throw new Error(
        `Legacy pause checkpoint ${index} sequence must be ${index + 1}`,
      )
    }
    if (typeof checkpoint.name !== 'string' || !checkpoint.name.trim()) {
      throw new Error(`Legacy pause checkpoint ${index} name is required`)
    }
    assertCanonicalTimestamp(checkpoint.at, `Legacy pause checkpoint ${index} at`)
    if (Date.parse(checkpoint.at) < previousTimestamp) {
      throw new Error('Legacy pause checkpoint timestamps must be monotonic')
    }
    previousTimestamp = Date.parse(checkpoint.at)
  })

  if (typeof journal.recoveryRequired !== 'boolean') {
    throw new Error('Legacy pause journal recoveryRequired must be boolean')
  }
  const expectedRecoveryRequired = ['committing', 'rollback-required'].includes(
    journal.state,
  )
  if (journal.recoveryRequired !== expectedRecoveryRequired) {
    throw new Error(
      `Legacy pause journal recoveryRequired must be ${expectedRecoveryRequired} in state ${journal.state}`,
    )
  }
  return structuredClone(journal)
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

function writeReport(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

function runCli() {
  const [command, ...rawArgs] = process.argv.slice(2)
  const args = parseArgs(rawArgs)
  if (command === 'validate-fallback') {
    requireCliArgs(args, ['policy', 'output'], command)
    const policy = JSON.parse(fs.readFileSync(args.policy, 'utf8'))
    writeReport(args.output, validateLegacyPauseFallback(policy))
    return
  }
  if (command === 'validate-fallback-bytes') {
    requireCliArgs(args, ['policy', 'oss', 'r2', 'output'], command)
    const policy = JSON.parse(fs.readFileSync(args.policy, 'utf8'))
    writeReport(
      args.output,
      validateLegacyPauseFallbackBytes({
        fallback: validateLegacyPauseFallback(policy),
        ossBytes: fs.readFileSync(args.oss),
        r2Bytes: fs.readFileSync(args.r2),
      }),
    )
    return
  }
  if (command === 'validate-journal') {
    requireCliArgs(args, ['journal', 'output'], command)
    const journal = JSON.parse(fs.readFileSync(args.journal, 'utf8'))
    writeReport(args.output, validateLegacyPauseJournal(journal))
    return
  }
  throw new Error(
    'Usage: legacy-pause-transaction.mjs <validate-fallback|validate-fallback-bytes|validate-journal> ...',
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
