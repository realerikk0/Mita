import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  LEGACY_MANIFEST_KEY,
  LEGACY_PUBLIC_URLS,
  STABLE_POLICY_KEY,
  advanceLegacyPauseJournal,
  classifyLegacyPauseCas,
  classifyLegacyPauseRollback,
  createLegacyPauseFallback,
  createLegacyPauseJournal,
  validateLegacyPauseFallback,
  validateLegacyPauseFallbackBytes,
  validateLegacyPauseJournal,
  validateLegacyResumeInputs,
  validateLivePauseInputs,
  validatePublicPauseReadback,
  validateRouterPauseProbe,
} from '../legacy-pause-transaction.mjs'

const createdAt = '2026-07-28T12:00:00.000Z'
const updatedAt = '2026-07-28T12:00:01.000Z'
const pauseTransactionId = '456-2'
const fallbackTransactionId = '123-1'
const repoRoot = path.resolve(import.meta.dirname, '../../..')

function bytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`)
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

const fallbackBytes = bytes({
  version: '0.6.633',
  platforms: {
    'darwin-aarch64': {
      signature: 'fallback-mac-signature',
      url: 'https://static.mitapp.cn/mita/stable/v0.6.633/Biyan.app.tar.gz',
    },
    'windows-x86_64': {
      signature: 'fallback-windows-signature',
      url: 'https://static.mitapp.cn/mita/stable/v0.6.633/Biyan_0.6.633_x64-setup.exe',
    },
  },
})

const activeABytes = bytes({
  version: '0.6.643',
  sourceCommit: '38e6d9290a8b9b0f152ff2a7eefb550e6ead7df5',
  migrationPhase: 'A',
  dataSchema: 1,
  platforms: {
    'darwin-aarch64': {
      signature: 'a-mac-signature',
      url: 'https://static.mitapp.cn/biyan/updater/releases/v0.6.643/Biyan.app.tar.gz',
    },
    'windows-x86_64': {
      signature: 'a-windows-signature',
      url: 'https://static.mitapp.cn/biyan/updater/releases/v0.6.643/Biyan_0.6.643_x64-setup.exe',
    },
  },
})

const fallback = {
  version: '0.6.633',
  manifestSha256: sha256(fallbackBytes),
  transactionId: fallbackTransactionId,
  backups: {
    oss:
      `biyan/updater/transactions/${fallbackTransactionId}/backups/legacy-oss.json`,
    r2:
      `biyan/updater/transactions/${fallbackTransactionId}/backups/legacy-r2.json`,
  },
}
const ossAclBytes = bytes({ acl: 'public-read' })

function policy(overrides = {}) {
  return {
    schema: 1,
    channel: 'stable',
    currentVersion: '0.6.643',
    legacyBridgeVersion: '0.6.643',
    paused: false,
    completedPhases: ['A'],
    releases: {
      '0.6.643': {
        phase: 'A',
        effectivePhase: 'A',
        tag: 'v0.6.643',
        manifestKey: 'biyan/updater/releases/v0.6.643/latest.json',
        manifestSha256: sha256(activeABytes),
      },
    },
    transitions: {},
    phaseMilestones: {
      A: { fullAt: createdAt, version: '0.6.643' },
    },
    stableCyclesAfterB: [],
    legacyPauseFallback: structuredClone(fallback),
    ...overrides,
  }
}

function proposedPolicy(overrides = {}) {
  return {
    ...policy(),
    paused: true,
    updatedAt,
    ...overrides,
  }
}

function liveInputs(overrides = {}) {
  return {
    policyBytes: bytes(policy()),
    expectedCurrentVersion: '0.6.643',
    ossLegacyBytes: activeABytes,
    r2LegacyBytes: activeABytes,
    ...overrides,
  }
}

function journalInputs(overrides = {}) {
  return {
    transactionId: pauseTransactionId,
    createdAt,
    expectedCurrentVersion: '0.6.643',
    policyBeforeBytes: bytes(policy()),
    ossLegacyBeforeBytes: activeABytes,
    r2LegacyBeforeBytes: activeABytes,
    ossLegacyAclBytes: ossAclBytes,
    proposedPausedPolicyBytes: bytes(proposedPolicy()),
    ossFallbackBytes: fallbackBytes,
    r2FallbackBytes: fallbackBytes,
    ...overrides,
  }
}

function readbackInputs(overrides = {}) {
  const pausedBytes = bytes(proposedPolicy())
  return {
    policyBytes: pausedBytes,
    expectedPausedPolicyBytes: pausedBytes,
    fallbackBytes,
    oss: {
      url: LEGACY_PUBLIC_URLS.oss,
      status: 200,
      bytes: fallbackBytes,
    },
    r2: {
      url: LEGACY_PUBLIC_URLS.r2,
      status: 200,
      bytes: fallbackBytes,
    },
    routerStatus: 204,
    ...overrides,
  }
}

test('policy fallback binds exact identity and provider-specific backup keys', () => {
  assert.deepEqual(
    createLegacyPauseFallback({
      version: '0.6.633',
      manifestSha256: fallback.manifestSha256,
      transactionId: fallbackTransactionId,
    }),
    fallback
  )
  assert.deepEqual(validateLegacyPauseFallback(policy()), fallback)

  const cases = [
    {
      value: { ...fallback, unreviewed: true },
      pattern: /keys must be exactly/,
    },
    {
      value: { ...fallback, version: 'v0.6.633' },
      pattern: /explicit stable version/,
    },
    {
      value: { ...fallback, manifestSha256: 'A'.repeat(64) },
      pattern: /lowercase SHA-256/,
    },
    {
      value: { ...fallback, transactionId: '../123-1' },
      pattern: /run-attempt identity/,
    },
    {
      value: {
        ...fallback,
        backups: { ...fallback.backups, extra: 'unknown' },
      },
      pattern: /keys must be exactly/,
    },
    {
      value: {
        ...fallback,
        backups: {
          ...fallback.backups,
          oss: fallback.backups.r2,
        },
      },
      pattern: /backups\.oss must be exactly/,
    },
    {
      value: {
        ...fallback,
        backups: {
          ...fallback.backups,
          r2: 'biyan/updater/transactions/999-1/backups/legacy-r2.json',
        },
      },
      pattern: /backups\.r2 must be exactly/,
    },
  ]
  for (const { value, pattern } of cases) {
    assert.throws(
      () =>
        validateLegacyPauseFallback({
          ...policy(),
          legacyPauseFallback: value,
        }),
      pattern
    )
  }
  const missing = policy()
  delete missing.legacyPauseFallback
  assert.throws(
    () => validateLegacyPauseFallback(missing),
    /must contain legacyPauseFallback/
  )
})

test('journal advances only across explicit durable transaction states', () => {
  const prepared = createLegacyPauseJournal(journalInputs())
  const committing = advanceLegacyPauseJournal({
    journal: prepared,
    state: 'committing',
    checkpoint: 'before-policy-write',
    updatedAt,
  })
  assert.equal(committing.state, 'committing')
  assert.equal(committing.recoveryRequired, true)
  assert.deepEqual(committing.checkpoints, [
    { sequence: 1, name: 'before-policy-write', at: updatedAt },
  ])
  const committed = advanceLegacyPauseJournal({
    journal: committing,
    state: 'committed',
    checkpoint: 'policy-and-origins-verified',
    updatedAt: '2026-07-28T12:00:02.000Z',
  })
  assert.equal(committed.state, 'committed')
  assert.equal(committed.recoveryRequired, false)

  assert.throws(
    () =>
      advanceLegacyPauseJournal({
        journal: prepared,
        state: 'committed',
        checkpoint: 'skip-write',
        updatedAt,
      }),
    /Invalid legacy pause journal transition/
  )
  assert.throws(
    () =>
      advanceLegacyPauseJournal({
        journal: committing,
        state: 'committing',
        checkpoint: 'clock-regression',
        updatedAt: createdAt,
      }),
    /timestamps must be monotonic/
  )
})

test('fallback backup contents must be byte-identical and match version/hash', () => {
  assert.deepEqual(
    validateLegacyPauseFallbackBytes({
      fallback,
      ossBytes: fallbackBytes,
      r2Bytes: fallbackBytes,
    }),
    {
      fallback,
      manifestSha256: fallback.manifestSha256,
      version: '0.6.633',
    }
  )
  assert.throws(
    () =>
      validateLegacyPauseFallbackBytes({
        fallback,
        ossBytes: fallbackBytes,
        r2Bytes: Buffer.concat([fallbackBytes, Buffer.from(' ')]),
      }),
    /byte-identical/
  )
  assert.throws(
    () =>
      validateLegacyPauseFallbackBytes({
        fallback: { ...fallback, manifestSha256: 'a'.repeat(64) },
        ossBytes: fallbackBytes,
        r2Bytes: fallbackBytes,
      }),
    /do not match manifestSha256/
  )
  const wrongVersion = bytes({ version: '0.6.632' })
  assert.throws(
    () =>
      validateLegacyPauseFallbackBytes({
        fallback: {
          ...fallback,
          manifestSha256: sha256(wrongVersion),
        },
        ossBytes: wrongVersion,
        r2Bytes: wrongVersion,
      }),
    /version must be exactly 0\.6\.633/
  )
  assert.throws(
    () =>
      validateLegacyPauseFallbackBytes({
        fallback,
        ossBytes: fallbackBytes,
        r2Bytes: fallbackBytes,
        extra: true,
      }),
    /keys must be exactly/
  )
})

test('live validation CAS-binds policy and byte-identical active A manifests', () => {
  const validated = validateLivePauseInputs(liveInputs())
  assert.equal(validated.policySha256, sha256(bytes(policy())))
  assert.equal(validated.activeAVersion, '0.6.643')
  assert.equal(validated.activeAManifestSha256, sha256(activeABytes))
  assert.deepEqual(validated.fallback, fallback)

  const currentB = policy({
    currentVersion: '0.6.644',
    releases: {
      ...policy().releases,
      '0.6.644': {
        phase: 'B',
        effectivePhase: 'B',
        manifestSha256: 'b'.repeat(64),
      },
    },
  })
  assert.equal(
    validateLivePauseInputs(
      liveInputs({
        policyBytes: bytes(currentB),
        expectedCurrentVersion: '0.6.644',
      })
    ).activeAVersion,
    '0.6.643'
  )
})

test('live validation rejects paused, drifted, non-A, stale, and unknown inputs', () => {
  assert.throws(
    () =>
      validateLivePauseInputs(
        liveInputs({ policyBytes: bytes(policy({ paused: true })) })
      ),
    /paused must be exactly false/
  )
  assert.throws(
    () =>
      validateLivePauseInputs(
        liveInputs({ expectedCurrentVersion: '0.6.644' })
      ),
    /policy CAS failed/
  )
  assert.throws(
    () =>
      validateLivePauseInputs(
        liveInputs({
          policyBytes: bytes(policy({ legacyBridgeVersion: '0.6.644' })),
        })
      ),
    /active A release must be an object/
  )
  const wrongPhase = policy()
  wrongPhase.releases['0.6.643'].effectivePhase = 'B'
  assert.throws(
    () =>
      validateLivePauseInputs(
        liveInputs({ policyBytes: bytes(wrongPhase) })
      ),
    /effective phase A/
  )
  const unknownPhase = policy()
  unknownPhase.releases['0.6.643'].phase = 'UNKNOWN'
  assert.throws(
    () =>
      validateLivePauseInputs(
        liveInputs({ policyBytes: bytes(unknownPhase) })
      ),
    /phase must be A or RECOVERY/
  )
  assert.throws(
    () =>
      validateLivePauseInputs(
        liveInputs({
          r2LegacyBytes: Buffer.concat([activeABytes, Buffer.from(' ')]),
        })
      ),
    /byte-identical/
  )
  const unreviewed = bytes({ version: '0.6.643', platforms: {} })
  assert.throws(
    () =>
      validateLivePauseInputs(
        liveInputs({
          ossLegacyBytes: unreviewed,
          r2LegacyBytes: unreviewed,
        })
      ),
    /do not match the policy A manifestSha256/
  )
  const futureFallback = {
    ...fallback,
    version: '0.6.644',
  }
  const futurePolicy = policy({ legacyPauseFallback: futureFallback })
  assert.throws(
    () =>
      validateLivePauseInputs(
        liveInputs({ policyBytes: bytes(futurePolicy) })
      ),
    /fallback version must be older/
  )
  assert.throws(
    () => validateLivePauseInputs({ ...liveInputs(), unreviewed: true }),
    /keys must be exactly/
  )
})

test('resume validation binds paused fallback origins to the immutable active A', () => {
  assert.deepEqual(
    validateLegacyResumeInputs({
      policyBytes: bytes(policy({ paused: true })),
      expectedCurrentVersion: '0.6.643',
      ossLegacyBytes: fallbackBytes,
      r2LegacyBytes: fallbackBytes,
      activeABytes,
    }),
    {
      currentVersion: '0.6.643',
      activeAVersion: '0.6.643',
      activeAManifestSha256: sha256(activeABytes),
      fallback,
    }
  )
  assert.throws(
    () =>
      validateLegacyResumeInputs({
        policyBytes: bytes(policy()),
        expectedCurrentVersion: '0.6.643',
        ossLegacyBytes: fallbackBytes,
        r2LegacyBytes: fallbackBytes,
        activeABytes,
      }),
    /paused must be exactly true/
  )
  assert.throws(
    () =>
      validateLegacyResumeInputs({
        policyBytes: bytes(policy({ paused: true })),
        expectedCurrentVersion: '0.6.643',
        ossLegacyBytes: fallbackBytes,
        r2LegacyBytes: fallbackBytes,
        activeABytes: Buffer.concat([activeABytes, Buffer.from('x')]),
      }),
    /do not match the policy A manifestSha256/
  )
})

test('journal captures pre-pause policy/A snapshots and validated fallback', () => {
  const journal = createLegacyPauseJournal(journalInputs())
  assert.equal(validateLegacyPauseJournal(journal), journal)
  assert.deepEqual(journal.policySnapshot, {
    provider: 'r2',
    key: STABLE_POLICY_KEY,
    bytesSha256: sha256(bytes(policy())),
    backupKey:
      `biyan/updater/transactions/${pauseTransactionId}/backups/policy-before-pause.json`,
  })
  assert.deepEqual(journal.legacySnapshots, {
    oss: {
      provider: 'oss',
      key: LEGACY_MANIFEST_KEY,
      version: '0.6.643',
      manifestSha256: sha256(activeABytes),
      backupKey:
        `biyan/updater/transactions/${pauseTransactionId}/backups/legacy-a-oss.json`,
      aclSha256: sha256(ossAclBytes),
      aclBackupKey:
        `biyan/updater/transactions/${pauseTransactionId}/backups/legacy-a-oss-acl.json`,
    },
    r2: {
      provider: 'r2',
      key: LEGACY_MANIFEST_KEY,
      version: '0.6.643',
      manifestSha256: sha256(activeABytes),
      backupKey:
        `biyan/updater/transactions/${pauseTransactionId}/backups/legacy-a-r2.json`,
    },
  })
  assert.deepEqual(journal.fallback, fallback)
  assert.equal(
    journal.proposedPausedPolicySha256,
    sha256(bytes(proposedPolicy()))
  )
  assert.equal(journal.state, 'prepared')
  assert.equal(journal.recoveryRequired, false)
  assert.deepEqual(journal.checkpoints, [])
})

test('journal creation rejects policy mutation, bad fallback, and unsafe identity', () => {
  assert.throws(
    () =>
      createLegacyPauseJournal(
        journalInputs({
          proposedPausedPolicyBytes: bytes(
            proposedPolicy({ currentVersion: '0.6.644' })
          ),
        })
      ),
    /policy CAS failed/
  )
  assert.throws(
    () =>
      createLegacyPauseJournal(
        journalInputs({
          proposedPausedPolicyBytes: bytes(
            proposedPolicy({ completedPhases: ['A', 'B'] })
          ),
        })
      ),
    /may change only paused and updatedAt/
  )
  assert.throws(
    () =>
      createLegacyPauseJournal(
        journalInputs({
          proposedPausedPolicyBytes: bytes(
            proposedPolicy({ paused: false })
          ),
        })
      ),
    /paused must be exactly true/
  )
  assert.throws(
    () =>
      createLegacyPauseJournal(
        journalInputs({
          proposedPausedPolicyBytes: bytes(
            proposedPolicy({ updatedAt: '2026-07-28T11:59:59.000Z' })
          ),
        })
      ),
    /must not precede journal creation/
  )
  assert.throws(
    () =>
      createLegacyPauseJournal(
        journalInputs({
          r2FallbackBytes: Buffer.concat([fallbackBytes, Buffer.from('x')]),
        })
      ),
    /byte-identical/
  )
  assert.throws(
    () =>
      createLegacyPauseJournal(
        journalInputs({ transactionId: '../../456-2' })
      ),
    /run-attempt identity/
  )
  assert.throws(
    () =>
      createLegacyPauseJournal(
        journalInputs({ createdAt: '2026-07-28T12:00:00Z' })
      ),
    /canonical ISO-8601/
  )
  assert.throws(
    () => createLegacyPauseJournal({ ...journalInputs(), extra: true }),
    /keys must be exactly/
  )
})

test('journal validation rejects unknown state and any unreviewed shape', () => {
  const journal = createLegacyPauseJournal(journalInputs())
  assert.throws(
    () =>
      validateLegacyPauseJournal({
        ...journal,
        state: 'partially-paused',
      }),
    /Unknown legacy pause journal state/
  )
  assert.throws(
    () =>
      validateLegacyPauseJournal({
        ...journal,
        state: 'committing',
        recoveryRequired: false,
      }),
    /recoveryRequired must be true/
  )
  assert.throws(
    () =>
      validateLegacyPauseJournal({
        ...journal,
        unreviewed: true,
      }),
    /keys must be exactly/
  )
  const unsafeBackup = structuredClone(journal)
  unsafeBackup.legacySnapshots.oss.backupKey =
    'biyan/updater/transactions/other/backups/legacy-a-oss.json'
  assert.throws(
    () => validateLegacyPauseJournal(unsafeBackup),
    /backupKey must be exactly/
  )
  const unsafeAclBackup = structuredClone(journal)
  unsafeAclBackup.legacySnapshots.oss.aclBackupKey =
    'biyan/updater/transactions/other/backups/legacy-a-oss-acl.json'
  assert.throws(
    () => validateLegacyPauseJournal(unsafeAclBackup),
    /aclBackupKey must be exactly/
  )
  const driftedClouds = structuredClone(journal)
  driftedClouds.legacySnapshots.r2.manifestSha256 = 'c'.repeat(64)
  assert.throws(
    () => validateLegacyPauseJournal(driftedClouds),
    /must describe identical A bytes/
  )
  const badCheckpoint = {
    ...journal,
    checkpoints: [{ sequence: 2, name: 'write-policy', at: updatedAt }],
  }
  assert.throws(
    () => validateLegacyPauseJournal(badCheckpoint),
    /sequence must be 1/
  )
})

test('forward content-CAS writes only known before bytes and is idempotent', () => {
  const common = {
    objectKind: 'legacy-oss',
    liveState: 'exists',
    beforeBytes: activeABytes,
    pausedBytes: fallbackBytes,
  }
  assert.deepEqual(
    classifyLegacyPauseCas({ ...common, liveBytes: activeABytes }),
    { action: 'write', reason: 'before-pause-bytes-are-live' }
  )
  assert.deepEqual(
    classifyLegacyPauseCas({ ...common, liveBytes: fallbackBytes }),
    { action: 'no-change', reason: 'paused-bytes-are-already-live' }
  )
  assert.throws(
    () =>
      classifyLegacyPauseCas({
        ...common,
        liveBytes: Buffer.from('unknown'),
      }),
    /refused unknown live bytes/
  )
})

test('rollback restores only transaction-written bytes and rejects unknown state', () => {
  const common = {
    objectKind: 'policy',
    liveState: 'exists',
    beforeBytes: bytes(policy()),
    pausedBytes: bytes(proposedPolicy()),
  }
  assert.deepEqual(
    classifyLegacyPauseRollback({
      ...common,
      liveBytes: common.pausedBytes,
    }),
    { action: 'restore', reason: 'paused-bytes-are-live' }
  )
  assert.deepEqual(
    classifyLegacyPauseRollback({
      ...common,
      liveBytes: common.beforeBytes,
    }),
    { action: 'no-change', reason: 'before-pause-bytes-are-live' }
  )
  for (const invalid of [
    { ...common, liveState: 'absent', liveBytes: Buffer.alloc(0) },
    { ...common, liveState: 'unknown', liveBytes: Buffer.from('unknown') },
    { ...common, objectKind: 'other', liveBytes: common.pausedBytes },
    {
      ...common,
      liveBytes: common.pausedBytes,
      beforeBytes: common.pausedBytes,
    },
    { ...common, liveBytes: Buffer.from('third-state') },
    { ...common, liveBytes: common.pausedBytes, extra: true },
  ]) {
    assert.throws(
      () => classifyLegacyPauseRollback(invalid),
      /requires an exact exists state|Unsupported legacy pause object kind|must differ|refused unknown live bytes|keys must be exactly/
    )
  }
})

test('Router pause proof distinguishes active no-transition from paused', () => {
  assert.deepEqual(
    validateRouterPauseProbe({
      beforeStatus: 204,
      beforeState: 'no-transition',
      afterStatus: 204,
      afterState: 'paused',
    }),
    {
      status: 'passed',
      before: { status: 204, state: 'no-transition' },
      after: { status: 204, state: 'paused' },
    }
  )

  for (const invalid of [
    {
      beforeStatus: 204,
      beforeState: '',
      afterStatus: 204,
      afterState: 'paused',
    },
    {
      beforeStatus: 204,
      beforeState: 'paused',
      afterStatus: 204,
      afterState: 'paused',
    },
    {
      beforeStatus: 200,
      beforeState: 'no-transition',
      afterStatus: 204,
      afterState: 'paused',
    },
    {
      beforeStatus: 204,
      beforeState: 'no-transition',
      afterStatus: 204,
      afterState: 'no-transition',
    },
    {
      beforeStatus: 204,
      beforeState: 'no-transition',
      afterStatus: 204,
      afterState: '',
    },
    {
      beforeStatus: 204,
      beforeState: 'no-transition',
      afterStatus: 200,
      afterState: 'paused',
    },
  ]) {
    assert.throws(
      () => validateRouterPauseProbe(invalid),
      /pre-pause capability probe|post-pause probe/
    )
  }
  assert.throws(
    () =>
      validateRouterPauseProbe({
        beforeStatus: 204,
        beforeState: 'no-transition',
        afterStatus: 204,
        afterState: 'paused',
        unreviewed: true,
      }),
    /keys must be exactly/
  )
})

test('public readback proves exact paused policy, both fallback bytes, and Router 204', () => {
  assert.deepEqual(validatePublicPauseReadback(readbackInputs()), {
    status: 'passed',
    policySha256: sha256(bytes(proposedPolicy())),
    fallbackVersion: '0.6.633',
    fallbackManifestSha256: fallback.manifestSha256,
    ossStatus: 200,
    r2Status: 200,
    routerStatus: 204,
  })
})

test('public readback rejects stale cache, wrong endpoint/status, and unpaused policy', () => {
  assert.throws(
    () =>
      validatePublicPauseReadback(
        readbackInputs({ policyBytes: bytes(policy({ paused: true })) })
      ),
    /must match the proposed bytes exactly/
  )
  const unpausedBytes = bytes(policy())
  assert.throws(
    () =>
      validatePublicPauseReadback(
        readbackInputs({
          policyBytes: unpausedBytes,
          expectedPausedPolicyBytes: unpausedBytes,
        })
      ),
    /stable, and paused/
  )
  assert.throws(
    () =>
      validatePublicPauseReadback(
        readbackInputs({
          oss: {
            url: LEGACY_PUBLIC_URLS.oss,
            status: 200,
            bytes: activeABytes,
          },
        })
      ),
    /does not match fallback bytes/
  )
  assert.throws(
    () =>
      validatePublicPauseReadback(
        readbackInputs({
          r2: {
            url: 'https://updates.mita.so.evil.invalid/mita/latest.json',
            status: 200,
            bytes: fallbackBytes,
          },
        })
      ),
    /URL must be exactly/
  )
  assert.throws(
    () =>
      validatePublicPauseReadback(
        readbackInputs({
          oss: {
            url: LEGACY_PUBLIC_URLS.oss,
            status: 304,
            bytes: fallbackBytes,
          },
        })
      ),
    /status must be 200/
  )
  assert.throws(
    () => validatePublicPauseReadback(readbackInputs({ routerStatus: 200 })),
    /Router readback status must be 204/
  )
  assert.throws(
    () =>
      validatePublicPauseReadback({
        ...readbackInputs(),
        unreviewed: true,
      }),
    /keys must be exactly/
  )
  const extraEndpointKey = readbackInputs()
  extraEndpointKey.oss = { ...extraEndpointKey.oss, etag: 'unknown' }
  assert.throws(
    () => validatePublicPauseReadback(extraEndpointKey),
    /keys must be exactly/
  )
})

test('pause workflows recover a partially deleted terminal lock before new mutation', () => {
  const runner = fs.readFileSync(
    path.join(repoRoot, 'scripts/updater/run-pause-transaction.sh'),
    'utf8'
  )
  const recoveryStart = runner.indexOf('recover_terminal_open_journal() {')
  const recoveryEnd = runner.indexOf(
    '\n}\n\nprobe_r2 "$OPEN_TRANSACTION_KEY" open-r2',
    recoveryStart
  )
  const recovery = runner.slice(recoveryStart, recoveryEnd)
  const gate = runner.indexOf(
    'recover_terminal_open_journal \\\n    "$initial_open_r2_state"'
  )
  const firstNewMutation = runner.indexOf(
    'legacy-pause-transaction.mjs create-journal',
    gate
  )
  assert.ok(
    recoveryStart >= 0
      && recoveryEnd > recoveryStart
      && gate > recoveryEnd
      && firstNewMutation > gate
  )
  assert.match(recovery, /committed\|rolled-back/)
  assert.match(recovery, /Open pause journal is nonterminal/)
  assert.match(recovery, /terminal-history-r2[\s\S]*terminal-history-oss/)
  assert.match(recovery, /verify_expected_metadata[\s\S]*no-store/)
  assert.match(recovery, /terminal-live-policy/)
  assert.match(recovery, /terminal-live-legacy-oss/)
  assert.match(recovery, /terminal-live-legacy-r2/)
  assert.match(recovery, /poll_legacy_bytes "\$expected_legacy"/)
  assert.match(recovery, /probe_router_state terminal-recovery/)
  assert.match(recovery, /delete_open_journal/)
  assert.match(
    recovery,
    /terminal_cleanup_result=committed[\s\S]*previous-rolled-back-journal\.json[\s\S]*transaction_id="\$new_transaction_id"[\s\S]*terminal_cleanup_result=rolled-back/
  )
  assert.match(
    runner.slice(gate, firstNewMutation),
    /terminal_cleanup_result" == committed[\s\S]*exit 0/
  )

  for (const workflowName of [
    'updater-kill-switch.yml',
    'updater-health-gate.yml',
  ]) {
    const workflow = fs.readFileSync(
      path.join(repoRoot, '.github/workflows', workflowName),
      'utf8'
    )
    assert.match(workflow, /run: bash scripts\/updater\/run-pause-transaction\.sh/)
    assert.match(
      workflow,
      /if: always\(\)[\s\S]*actions\/upload-artifact@v4[\s\S]*dist\/pause\//
    )
  }
})
