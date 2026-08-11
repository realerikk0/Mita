import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  OPEN_TRANSACTION_KEY,
  STABLE_POLICY_KEY,
  advanceJournal,
  backupMetadataPlan,
  classifyPolicyRollback,
  classifyRemoteProbe,
  createJournal,
  extractR2Etag,
  pollPublicBytes,
  recoveryCommands,
  resolveSplitNonterminalJournal,
  resolveUnifiedNonterminalJournal,
  terminalPromotionRecoveryPlan,
  validateFrozenLegacyInvariant,
  validateJournal,
  verifySnapshotReadback,
} from '../promotion-transaction.mjs'

const repoRoot = path.resolve(import.meta.dirname, '../../..')
const sha = (character) => character.repeat(64)
const sourceCommit = 'a'.repeat(40)
const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`)
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')

function metadata(cacheControl = 'no-store') {
  return {
    ContentType: 'application/json',
    CacheControl: cacheControl,
  }
}

function frozenFixture() {
  const frozenVersion = '0.6.651'
  const targetVersion = '0.6.652'
  const frozenManifest = jsonBytes({
    version: frozenVersion,
    platforms: {
      'windows-x86_64': {
        url: 'https://static.mitapp.cn/Biyan_0.6.651_x64-setup.exe',
        signature: 'signed',
      },
    },
  })
  const frozenManifestSha256 = digest(frozenManifest)
  const frozenRelease = {
    phase: 'RECOVERY',
    effectivePhase: 'C',
    tag: `v${frozenVersion}`,
    manifestKey: `biyan/updater/releases/v${frozenVersion}/latest.json`,
    manifestSha256: frozenManifestSha256,
  }
  const beforePolicy = {
    schema: 1,
    channel: 'stable',
    deploymentMode: 'direct-c',
    currentVersion: frozenVersion,
    legacyBridgeVersion: frozenVersion,
    paused: false,
    releases: {
      [frozenVersion]: frozenRelease,
    },
    transitions: {},
    completedPhases: ['C'],
  }
  const targetManifest = jsonBytes({ version: targetVersion })
  const nextPolicy = structuredClone(beforePolicy)
  nextPolicy.currentVersion = targetVersion
  nextPolicy.releases[targetVersion] = {
    phase: 'RECOVERY',
    effectivePhase: 'C',
    tag: `v${targetVersion}`,
    manifestKey: `biyan/updater/releases/v${targetVersion}/latest.json`,
    manifestSha256: digest(targetManifest),
    smokeEvidenceSha256: sha('b'),
    healthEvidenceSha256: sha('c'),
  }
  nextPolicy.transitions[frozenVersion] = {
    to: targetVersion,
    phase: 'RECOVERY',
    rollout: 100,
    manifestKey: nextPolicy.releases[targetVersion].manifestKey,
  }
  return {
    frozenVersion,
    targetVersion,
    frozenManifest,
    targetManifest,
    beforePolicy,
    nextPolicy,
    beforePolicyBytes: jsonBytes(beforePolicy),
    nextPolicyBytes: jsonBytes(nextPolicy),
  }
}

function policySnapshot(bytes, transactionId = '123-1') {
  return {
    provider: 'r2',
    key: STABLE_POLICY_KEY,
    existed: true,
    bytesSha256: digest(bytes),
    metadata: metadata(),
    acl: null,
    backupKey:
      `biyan/updater/transactions/${transactionId}/backups/policy.json`,
  }
}

function preparedJournal() {
  const fixture = frozenFixture()
  const journal = createJournal({
    runId: '123',
    runAttempt: '1',
    targetTag: `v${fixture.targetVersion}`,
    targetVersion: fixture.targetVersion,
    sourceCommit,
    nextPolicyBytes: fixture.nextPolicyBytes,
    snapshots: [policySnapshot(fixture.beforePolicyBytes)],
    createdAt: '2026-08-11T00:00:00.000Z',
  })
  return { fixture, journal }
}

test('schema-3 Router promotion journal snapshots only policy', () => {
  const { fixture, journal } = preparedJournal()
  assert.equal(journal.schema, 3)
  assert.equal(journal.kind, 'router-promotion')
  assert.equal(journal.snapshots.length, 1)
  assert.equal(journal.snapshots[0].key, STABLE_POLICY_KEY)
  assert.equal(
    journal.nextPolicy.sha256,
    digest(fixture.nextPolicyBytes)
  )
  assert.equal(validateJournal(journal), journal)

  assert.throws(
    () =>
      createJournal({
        runId: '123',
        runAttempt: '1',
        targetTag: 'v0.6.652',
        targetVersion: '0.6.652',
        sourceCommit,
        nextPolicyBytes: fixture.nextPolicyBytes,
        snapshots: [
          policySnapshot(fixture.beforePolicyBytes),
          {
            ...policySnapshot(fixture.beforePolicyBytes),
            provider: 'oss',
            key: 'mita/latest.json',
          },
        ],
        createdAt: '2026-08-11T00:00:00.000Z',
      }),
    /snapshot only the mutable policy/
  )
  assert.throws(
    () => validateJournal({ ...journal, schema: 2 }),
    /schema\/kind\/state/
  )
  assert.throws(
    () => validateJournal({ ...journal, kind: 'legacy-promotion' }),
    /schema\/kind\/state/
  )
  const wrongBackup = policySnapshot(fixture.beforePolicyBytes)
  wrongBackup.backupKey =
    'biyan/updater/transactions/999-1/backups/policy.json'
  assert.throws(
    () =>
      createJournal({
        runId: '123',
        runAttempt: '1',
        targetTag: 'v0.6.652',
        targetVersion: '0.6.652',
        sourceCommit,
        nextPolicyBytes: fixture.nextPolicyBytes,
        snapshots: [wrongBackup],
        createdAt: '2026-08-11T00:00:00.000Z',
      }),
    /backup key is not transaction-bound/
  )
  const driftedJournal = structuredClone(journal)
  driftedJournal.snapshots[0].backupKey =
    'biyan/updater/transactions/999-1/backups/policy.json'
  assert.throws(
    () => validateJournal(driftedJournal),
    /backup key is not transaction-bound/
  )
})

test('journal transitions and split-lock resolution remain exact', () => {
  const { journal } = preparedJournal()
  const committing = advanceJournal(journal, {
    state: 'committing',
    checkpoint: 'before-policy-write',
    updatedAt: '2026-08-11T00:01:00.000Z',
  })
  const rollbackRequired = advanceJournal(committing, {
    state: 'rollback-required',
    checkpoint: 'rollback-started',
    updatedAt: '2026-08-11T00:02:00.000Z',
  })
  const split = resolveSplitNonterminalJournal({
    r2Open: committing,
    ossOpen: rollbackRequired,
  })
  assert.equal(split.canonical.state, 'rollback-required')
  assert.equal(split.previous.state, 'committing')
  assert.equal(
    resolveUnifiedNonterminalJournal({
      r2Open: rollbackRequired,
      ossOpen: structuredClone(rollbackRequired),
    }).canonical.state,
    'rollback-required'
  )
  assert.throws(
    () =>
      resolveSplitNonterminalJournal({
        r2Open: committing,
        ossOpen: {
          ...rollbackRequired,
          transactionId: '999-1',
        },
      }),
    /identity/
  )
})

test('frozen handoff invariant binds version, policy identity, and exact bytes', () => {
  const fixture = frozenFixture()
  const proof = validateFrozenLegacyInvariant({
    currentPolicyBytes: fixture.beforePolicyBytes,
    nextPolicyBytes: fixture.nextPolicyBytes,
    ossLegacyBytes: fixture.frozenManifest,
    r2LegacyBytes: fixture.frozenManifest,
  })
  assert.deepEqual(proof, {
    schema: 1,
    kind: 'frozen-legacy-handoff',
    version: fixture.frozenVersion,
    manifestKey:
      fixture.beforePolicy.releases[fixture.frozenVersion].manifestKey,
    manifestSha256: digest(fixture.frozenManifest),
  })

  const rolling = structuredClone(fixture.nextPolicy)
  rolling.legacyBridgeVersion = fixture.targetVersion
  assert.throws(
    () =>
      validateFrozenLegacyInvariant({
        currentPolicyBytes: fixture.beforePolicyBytes,
        nextPolicyBytes: jsonBytes(rolling),
        ossLegacyBytes: fixture.frozenManifest,
        r2LegacyBytes: fixture.frozenManifest,
      }),
    /preserve the frozen legacy bridge/
  )
  assert.throws(
    () =>
      validateFrozenLegacyInvariant({
        currentPolicyBytes: fixture.beforePolicyBytes,
        nextPolicyBytes: fixture.nextPolicyBytes,
        ossLegacyBytes: fixture.frozenManifest,
        r2LegacyBytes: Buffer.from('{"version":"0.6.650"}\n'),
      }),
    /byte-identical/
  )
  const noncanonicalCurrent = structuredClone(fixture.beforePolicy)
  const noncanonicalNext = structuredClone(fixture.nextPolicy)
  noncanonicalCurrent.releases[fixture.frozenVersion].manifestKey =
    'biyan/updater/releases/frozen/latest.json'
  noncanonicalNext.releases[fixture.frozenVersion].manifestKey =
    'biyan/updater/releases/frozen/latest.json'
  assert.throws(
    () =>
      validateFrozenLegacyInvariant({
        currentPolicyBytes: jsonBytes(noncanonicalCurrent),
        nextPolicyBytes: jsonBytes(noncanonicalNext),
        ossLegacyBytes: fixture.frozenManifest,
        r2LegacyBytes: fixture.frozenManifest,
      }),
    /manifestKey is not canonical/
  )
})

test('terminal recovery plan preserves the frozen release identity', () => {
  const { fixture, journal: prepared } = preparedJournal()
  const committing = advanceJournal(prepared, {
    state: 'committing',
    checkpoint: 'before-policy-write',
    updatedAt: '2026-08-11T00:01:00.000Z',
  })
  const committed = advanceJournal(committing, {
    state: 'committed',
    checkpoint: 'router-policy-and-frozen-handoff-verified',
    updatedAt: '2026-08-11T00:02:00.000Z',
  })
  const candidate = {
    tag: `v${fixture.targetVersion}`,
    version: fixture.targetVersion,
    sourceCommit,
    manifestKey:
      fixture.nextPolicy.releases[fixture.targetVersion].manifestKey,
    manifestSha256:
      fixture.nextPolicy.releases[fixture.targetVersion].manifestSha256,
  }
  const plan = terminalPromotionRecoveryPlan({
    journal: committed,
    nextPolicyBytes: fixture.nextPolicyBytes,
    beforePolicyBytes: fixture.beforePolicyBytes,
    candidate,
    phase: 'RECOVERY',
    fromVersion: fixture.frozenVersion,
    expectedCurrent: fixture.frozenVersion,
    rollout: '100',
    smokeEvidence: { sha256: sha('b') },
    healthEvidence: { sha256: sha('c') },
  })
  assert.equal(plan.kind, 'router-promotion-terminal-recovery')
  assert.equal(plan.policySnapshotIndex, 0)
  assert.equal(plan.frozenLegacy.version, fixture.frozenVersion)
  assert.equal(plan.frozenLegacy.sha256, digest(fixture.frozenManifest))
  assert.equal(plan.sameRequest, true)
  assert.equal('legacyOssSnapshotIndex' in plan, false)
  assert.equal('legacyR2SnapshotIndex' in plan, false)

  const rollingPolicy = structuredClone(fixture.nextPolicy)
  rollingPolicy.releases[fixture.frozenVersion].manifestSha256 = sha('f')
  const rollingBytes = jsonBytes(rollingPolicy)
  const rollingJournal = {
    ...committed,
    nextPolicy: {
      ...committed.nextPolicy,
      sha256: digest(rollingBytes),
    },
  }
  assert.throws(
    () =>
      terminalPromotionRecoveryPlan({
        journal: rollingJournal,
        nextPolicyBytes: rollingBytes,
        beforePolicyBytes: fixture.beforePolicyBytes,
        candidate,
        phase: 'RECOVERY',
        fromVersion: fixture.frozenVersion,
        expectedCurrent: fixture.frozenVersion,
        rollout: '100',
        smokeEvidence: { sha256: sha('b') },
        healthEvidence: { sha256: sha('c') },
      }),
    /preserve the frozen legacy release identity/
  )
})

test('generated recovery restores only policy and immutable transaction objects', () => {
  const { journal } = preparedJournal()
  const intent = {
    provider: 'r2',
    key: 'biyan/updater/releases/v0.6.652/latest.json',
    sha256: sha('d'),
    contentType: 'application/json',
    cacheControl: 'public, max-age=31536000, immutable',
    createdByTransaction: true,
    verified: false,
  }
  let committing = advanceJournal(journal, {
    state: 'committing',
    checkpoint: 'before-create-r2-manifest',
    immutableEntry: intent,
    updatedAt: '2026-08-11T00:01:00.000Z',
  })
  committing = advanceJournal(committing, {
    state: 'committing',
    checkpoint: 'verified-create-r2-manifest',
    immutableEntry: { ...intent, verified: true },
    updatedAt: '2026-08-11T00:02:00.000Z',
  })
  const commands = recoveryCommands(committing)
  assert.match(commands, /schema-3 Router promotion journal/)
  assert.match(commands, /classify-policy-rollback/)
  assert.match(commands, /policy_key='biyan\/updater\/stable\/policy\.json'/)
  assert.match(commands, /router-policy-restored/)
  assert.match(commands, /validate-frozen-legacy/)
  assert.match(commands, /legacy_key="mita\/latest\.json"/)

  const legacyMutation = commands.split('\n').filter(
    (line) =>
      /mita\/latest\.json/.test(line) &&
      /put-object|delete-object|RefreshObjectCaches|restore|purge/i.test(line)
  )
  assert.deepEqual(legacyMutation, [])
  assert.doesNotMatch(commands, /legacy-pause-transaction/)
  assert.throws(
    () => recoveryCommands(journal),
    /committing or rollback-required/
  )
})

test('snapshot verification, metadata, ETag, and policy rollback stay strict', () => {
  const { fixture, journal } = preparedJournal()
  const snapshot = journal.snapshots[0]
  assert.equal(
    verifySnapshotReadback({
      snapshot,
      bytes: fixture.beforePolicyBytes,
      metadata: metadata(),
    }).sha256,
    snapshot.bytesSha256
  )
  assert.throws(
    () =>
      verifySnapshotReadback({
        snapshot,
        bytes: Buffer.from('drift'),
        metadata: metadata(),
      }),
    /bytes do not match/
  )
  assert.deepEqual(backupMetadataPlan(metadata()), {
    contentType: 'application/json',
    cacheControl: 'no-store',
  })
  assert.equal(
    extractR2Etag({ ETag: '"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"' }),
    '"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"'
  )
  assert.deepEqual(
    classifyPolicyRollback({
      policyExisted: true,
      originalBytes: fixture.beforePolicyBytes,
      nextBytes: fixture.nextPolicyBytes,
      liveState: 'exists',
      liveBytes: fixture.nextPolicyBytes,
    }),
    { action: 'restore', reason: 'proposed-policy-is-live' }
  )
})

test('remote probes and public byte polling fail closed', async () => {
  assert.deepEqual(
    classifyRemoteProbe({
      provider: 'r2',
      key: 'missing',
      exitCode: 1,
      stderr: 'NoSuchKey 404',
    }),
    { provider: 'r2', key: 'missing', state: 'absent' }
  )
  assert.throws(
    () =>
      classifyRemoteProbe({
        provider: 'r2',
        key: 'unknown',
        exitCode: 1,
        stderr: 'timeout',
      }),
    /must not be treated as absent/
  )
  const expected = Buffer.from('frozen')
  let calls = 0
  const evidence = await pollPublicBytes({
    url: 'https://updates.mita.so/mita/latest.json',
    expectedBytes: expected,
    timeoutMs: 10,
    intervalMs: 1,
    now: () => calls,
    sleep: async () => {},
    fetchImpl: async () => {
      calls += 1
      const body = calls === 1 ? Buffer.from('stale') : expected
      return new Response(body, { status: 200 })
    },
  })
  assert.equal(evidence.sha256, digest(expected))
  assert.equal(calls, 2)
})

test('production runners keep legacy handoff read-only and pause only Router policy', () => {
  const promotion = fs.readFileSync(
    path.join(repoRoot, 'scripts/updater/run-promotion-transaction.sh'),
    'utf8'
  )
  const pause = fs.readFileSync(
    path.join(repoRoot, 'scripts/updater/run-router-pause-transaction.sh'),
    'utf8'
  )
  assert.match(promotion, /validate-frozen-legacy/)
  assert.match(promotion, /test "\$current_legacy_version" = "\$next_legacy_version"/)
  assert.match(promotion, /snapshots \| length' "\$terminal_journal"\)" = 1/)
  assert.doesNotMatch(promotion, /LEGACY_(?:ALIYUN|R2)_(?:KEY|URL)/)
  assert.doesNotMatch(promotion, /legacy-pause-transaction/)
  for (const line of promotion.split('\n')) {
    if (!/legacy_(?:aliyun|r2)_key/.test(line)) continue
    assert.doesNotMatch(
      line,
      /put-object|delete-object|RefreshObjectCaches|--ObjectPath/
    )
  }

  assert.match(pause, /--if-match "\$policy_before_etag"/)
  assert.match(pause, /classify-policy-rollback/)
  assert.match(pause, /validate-router-probe/)
  assert.doesNotMatch(pause, /ALIYUN|OSS|mita\/latest|legacy/i)
  assert.equal(
    fs.existsSync(
      path.join(repoRoot, 'scripts/updater/run-pause-transaction.sh')
    ),
    false
  )
  for (const script of [
    'scripts/updater/run-promotion-transaction.sh',
    'scripts/updater/run-router-pause-transaction.sh',
  ]) {
    const result = spawnSync('bash', ['-n', path.join(repoRoot, script)], {
      encoding: 'utf8',
    })
    assert.equal(result.status, 0, result.stderr)
  }
  assert.equal(OPEN_TRANSACTION_KEY, 'biyan/updater/transactions/open.json')
})
