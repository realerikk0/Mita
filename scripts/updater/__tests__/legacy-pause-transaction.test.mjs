import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

import {
  LEGACY_MANIFEST_KEY,
  LEGACY_PAUSE_JOURNAL_STATES,
  STABLE_POLICY_KEY,
  validateLegacyPauseFallback,
  validateLegacyPauseFallbackBytes,
  validateLegacyPauseJournal,
} from '../legacy-pause-transaction.mjs'

const repoRoot = path.resolve(import.meta.dirname, '../../..')
const modulePath = path.join(
  repoRoot,
  'scripts/updater/legacy-pause-transaction.mjs',
)
const createdAt = '2026-07-28T12:00:00.000Z'
const transactionId = '456-2'
const fallbackTransactionId = '123-1'

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`)
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

const fallbackBytes = jsonBytes({
  version: '0.6.633',
  platforms: {
    'darwin-aarch64': {
      signature: 'archived-signature',
      url: 'https://static.mitapp.cn/mita/stable/v0.6.633/Biyan.app.tar.gz',
    },
  },
})

const fallback = {
  version: '0.6.633',
  manifestSha256: sha256(fallbackBytes),
  transactionId: fallbackTransactionId,
  backups: {
    oss: `biyan/updater/transactions/${fallbackTransactionId}/backups/legacy-oss.json`,
    r2: `biyan/updater/transactions/${fallbackTransactionId}/backups/legacy-r2.json`,
  },
}

function historicalJournal(overrides = {}) {
  const manifestSha256 = 'a'.repeat(64)
  return {
    schema: 1,
    kind: 'legacy-pause',
    transactionId,
    state: 'committed',
    createdAt,
    expectedCurrentVersion: '0.6.643',
    policySnapshot: {
      provider: 'r2',
      key: STABLE_POLICY_KEY,
      bytesSha256: 'b'.repeat(64),
      backupKey:
        `biyan/updater/transactions/${transactionId}/backups/policy-before-pause.json`,
    },
    legacySnapshots: {
      oss: {
        provider: 'oss',
        key: LEGACY_MANIFEST_KEY,
        version: '0.6.643',
        manifestSha256,
        backupKey:
          `biyan/updater/transactions/${transactionId}/backups/legacy-a-oss.json`,
        aclSha256: 'c'.repeat(64),
        aclBackupKey:
          `biyan/updater/transactions/${transactionId}/backups/legacy-a-oss-acl.json`,
      },
      r2: {
        provider: 'r2',
        key: LEGACY_MANIFEST_KEY,
        version: '0.6.643',
        manifestSha256,
        backupKey:
          `biyan/updater/transactions/${transactionId}/backups/legacy-a-r2.json`,
      },
    },
    fallback: structuredClone(fallback),
    proposedPausedPolicySha256: 'd'.repeat(64),
    checkpoints: [
      {
        sequence: 1,
        name: 'historical-proof',
        at: '2026-07-28T12:00:01.000Z',
      },
    ],
    recoveryRequired: false,
    ...overrides,
  }
}

test('validates a frozen fallback pointer and its byte-identical replicas', () => {
  assert.deepEqual(
    validateLegacyPauseFallback({ legacyPauseFallback: fallback }),
    fallback,
  )
  assert.deepEqual(
    validateLegacyPauseFallbackBytes({
      fallback,
      ossBytes: fallbackBytes,
      r2Bytes: fallbackBytes,
    }),
    {
      fallback,
      manifestSha256: fallback.manifestSha256,
      version: fallback.version,
    },
  )
})

test('fallback validation is exact and transaction-bound', () => {
  assert.throws(
    () => validateLegacyPauseFallback({}),
    /must contain legacyPauseFallback/,
  )
  assert.throws(
    () =>
      validateLegacyPauseFallback({
        legacyPauseFallback: { ...fallback, extra: true },
      }),
    /keys must be exactly/,
  )
  assert.throws(
    () =>
      validateLegacyPauseFallback({
        legacyPauseFallback: {
          ...fallback,
          backups: { ...fallback.backups, r2: fallback.backups.oss },
        },
      }),
    /backups\.r2 must be exactly/,
  )
  assert.throws(
    () =>
      validateLegacyPauseFallback({
        legacyPauseFallback: { ...fallback, transactionId: '0-1' },
      }),
    /positive GitHub run-attempt identity/,
  )
})

test('fallback byte validation rejects replica, digest, JSON, and version drift', () => {
  assert.throws(
    () =>
      validateLegacyPauseFallbackBytes({
        fallback,
        ossBytes: fallbackBytes,
        r2Bytes: Buffer.from('different'),
      }),
    /byte-identical/,
  )
  assert.throws(
    () =>
      validateLegacyPauseFallbackBytes({
        fallback: { ...fallback, manifestSha256: 'e'.repeat(64) },
        ossBytes: fallbackBytes,
        r2Bytes: fallbackBytes,
      }),
    /do not match manifestSha256/,
  )
  const invalidJson = Buffer.from('{')
  assert.throws(
    () =>
      validateLegacyPauseFallbackBytes({
        fallback: { ...fallback, manifestSha256: sha256(invalidJson) },
        ossBytes: invalidJson,
        r2Bytes: invalidJson,
      }),
    /not valid JSON/,
  )
  const wrongVersion = jsonBytes({ version: '0.6.632' })
  assert.throws(
    () =>
      validateLegacyPauseFallbackBytes({
        fallback: { ...fallback, manifestSha256: sha256(wrongVersion) },
        ossBytes: wrongVersion,
        r2Bytes: wrongVersion,
      }),
    /version must be exactly 0\.6\.633/,
  )
})

test('accepts every closed schema-1 historical journal state', () => {
  for (const state of LEGACY_PAUSE_JOURNAL_STATES) {
    const journal = historicalJournal({
      state,
      recoveryRequired: ['committing', 'rollback-required'].includes(state),
    })
    const validated = validateLegacyPauseJournal(journal)
    assert.deepEqual(validated, journal)
    assert.notEqual(validated, journal)
  }
})

test('historical journal validation rejects schema and recovery drift', () => {
  assert.throws(
    () => validateLegacyPauseJournal({ ...historicalJournal(), schema: 2 }),
    /schema\/kind is invalid/,
  )
  assert.throws(
    () => validateLegacyPauseJournal({ ...historicalJournal(), kind: 'pause' }),
    /schema\/kind is invalid/,
  )
  assert.throws(
    () => validateLegacyPauseJournal({ ...historicalJournal(), extra: true }),
    /keys must be exactly/,
  )
  assert.throws(
    () =>
      validateLegacyPauseJournal({
        ...historicalJournal(),
        state: 'committing',
        recoveryRequired: false,
      }),
    /recoveryRequired must be true/,
  )
})

test('historical journal validation binds every snapshot to its transaction', () => {
  const badPolicy = historicalJournal()
  badPolicy.policySnapshot.backupKey =
    'biyan/updater/transactions/999-1/backups/policy-before-pause.json'
  assert.throws(
    () => validateLegacyPauseJournal(badPolicy),
    /policy snapshot\.backupKey must be exactly/,
  )

  const badLegacyKey = historicalJournal()
  badLegacyKey.legacySnapshots.r2.key = 'mita/other.json'
  assert.throws(
    () => validateLegacyPauseJournal(badLegacyKey),
    /R2 snapshot\.key must be exactly mita\/latest\.json/,
  )

  const mismatchedReplica = historicalJournal()
  mismatchedReplica.legacySnapshots.r2.manifestSha256 = 'f'.repeat(64)
  assert.throws(
    () => validateLegacyPauseJournal(mismatchedReplica),
    /must describe identical A bytes/,
  )

  const tooNewFallback = historicalJournal()
  tooNewFallback.fallback.version = '0.6.644'
  assert.throws(
    () => validateLegacyPauseJournal(tooNewFallback),
    /fallback must be older/,
  )
})

test('historical journal validation enforces canonical monotonic checkpoints', () => {
  const wrongSequence = historicalJournal()
  wrongSequence.checkpoints[0].sequence = 2
  assert.throws(
    () => validateLegacyPauseJournal(wrongSequence),
    /sequence must be 1/,
  )

  const nonCanonical = historicalJournal()
  nonCanonical.createdAt = '2026-07-28T12:00:00Z'
  assert.throws(
    () => validateLegacyPauseJournal(nonCanonical),
    /must be canonical ISO-8601/,
  )

  const backwards = historicalJournal()
  backwards.checkpoints[0].at = '2026-07-28T11:59:59.000Z'
  assert.throws(
    () => validateLegacyPauseJournal(backwards),
    /timestamps must be monotonic/,
  )
})

test('CLI exposes only the three historical read-only validators', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-validator-'))
  try {
    const policyPath = path.join(directory, 'policy.json')
    const fallbackPath = path.join(directory, 'fallback.json')
    const journalPath = path.join(directory, 'journal.json')
    const outputPath = path.join(directory, 'output.json')
    fs.writeFileSync(
      policyPath,
      JSON.stringify({ legacyPauseFallback: fallback }),
    )
    fs.writeFileSync(fallbackPath, fallbackBytes)
    fs.writeFileSync(journalPath, JSON.stringify(historicalJournal()))

    for (const invocation of [
      ['validate-fallback', '--policy', policyPath, '--output', outputPath],
      [
        'validate-fallback-bytes',
        '--policy',
        policyPath,
        '--oss',
        fallbackPath,
        '--r2',
        fallbackPath,
        '--output',
        outputPath,
      ],
      ['validate-journal', '--journal', journalPath, '--output', outputPath],
    ]) {
      const result = spawnSync(process.execPath, [modulePath, ...invocation], {
        encoding: 'utf8',
      })
      assert.equal(result.status, 0, result.stderr)
      assert.doesNotThrow(() => JSON.parse(fs.readFileSync(outputPath, 'utf8')))
    }

    const retiredCommands = [
      'create-fallback',
      'validate-live',
      'validate-resume',
      'create-journal',
      'advance-journal',
      'classify-cas',
      'classify-rollback',
      'validate-readback',
      'validate-router-probe',
    ]
    for (const command of retiredCommands) {
      const result = spawnSync(process.execPath, [modulePath, command], {
        encoding: 'utf8',
      })
      assert.notEqual(result.status, 0, command)
      assert.equal(result.stdout, '')
      assert.match(result.stderr, /Usage:/)
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('retired module and runner contain no production legacy writer surface', () => {
  const source = fs.readFileSync(modulePath, 'utf8')
  assert.doesNotMatch(source, /export function (?:create|advance|classify)/)
  assert.doesNotMatch(source, /LEGACY_PUBLIC_URLS/)
  assert.doesNotMatch(
    source,
    /put-object|delete-object|RefreshObjectCaches|\bfetch\s*\(/,
  )
  assert.equal(
    fs.existsSync(
      path.join(repoRoot, 'scripts/updater/run-pause-transaction.sh'),
    ),
    false,
  )
})
