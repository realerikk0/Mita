import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  DIRECT_C_CANONICAL_UPDATER_PLATFORMS,
  DIRECT_C_CURRENT,
  DIRECT_C_ROUTER_SOURCES,
  DIRECT_C_TARGET_SOURCE_COMMIT,
  loadDirectCTransitionPolicy,
  validateApprovedDirectCTransition,
  validateDirectCTransitionPolicy,
} from '../direct-c-transition-policy.mjs'
import {
  classifyLegacyPauseRollback,
  createLegacyPauseJournal,
  validateLegacyResumeInputs,
  validateLivePauseInputs,
} from '../legacy-pause-transaction.mjs'
import {
  validateLegacyBridgePolicy,
  validateLegacyManifest,
  validatePromotionLegacyBridge,
  verifyLegacyManifestPair,
} from '../legacy-manifest-policy.mjs'
import { preparePromotion } from '../prepare-promotion.mjs'
import {
  createJournal,
  terminalPromotionRecoveryPlan,
} from '../promotion-transaction.mjs'
import { handleRequest } from '../worker.mjs'

const repoRoot = path.resolve(import.meta.dirname, '../../..')
const signingKey = 'direct-c-test-signing-key'
const promotedAt = '2026-07-29T00:00:00.000Z'

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`)
}

function legacy633Bytes() {
  return Buffer.from(
    fs.readFileSync(
      path.join(
        repoRoot,
        'scripts/updater/__tests__/fixtures/v0.6.633-latest.json',
      ),
      'utf8',
    ).replace(/\r\n?/g, '\n'),
  )
}

function initialPolicy() {
  return {
    schema: 1,
    channel: 'stable',
    currentVersion: DIRECT_C_CURRENT.version,
    legacyBridgeVersion: null,
    paused: false,
    completedPhases: [],
    releases: {},
    transitions: {},
    phaseMilestones: {},
    stableCyclesAfterB: [],
  }
}

function canonicalManifest() {
  const version = '0.6.647'
  const prefix =
    `https://static.mitapp.cn/biyan/updater/releases/v${version}`
  return {
    version,
    sourceCommit: DIRECT_C_TARGET_SOURCE_COMMIT,
    migrationPhase: 'C',
    dataSchema: 3,
    notes: '',
    pub_date: promotedAt,
    platforms: {
      'darwin-aarch64': {
        signature: 'mac-arm-signature',
        url: `${prefix}/Biyan.app.tar.gz`,
      },
      'darwin-x86_64': {
        signature: 'mac-intel-signature',
        url: `${prefix}/Biyan.app.tar.gz`,
      },
      'windows-x86_64': {
        signature: 'windows-signature',
        url: `${prefix}/Biyan_${version}_x64-setup.exe`,
      },
      'linux-x86_64': {
        signature: 'linux-signature',
        url: `${prefix}/Biyan_${version}_amd64.AppImage`,
      },
    },
  }
}

function directFixture() {
  const manifest = canonicalManifest()
  const manifestBytes = jsonBytes(manifest)
  const candidate = {
    version: manifest.version,
    tag: `v${manifest.version}`,
    sourceCommit: manifest.sourceCommit,
    migrationPhase: manifest.migrationPhase,
    dataSchema: manifest.dataSchema,
    publishedAt: manifest.pub_date,
    manifestKey:
      `biyan/updater/releases/v${manifest.version}/latest.json`,
    manifestSha256: sha256(manifestBytes),
  }
  const directTransitionPolicy = loadDirectCTransitionPolicy()
  directTransitionPolicy.approvedNext = {
    ...candidate,
    requiredPlatforms: [...DIRECT_C_CANONICAL_UPDATER_PLATFORMS],
  }
  delete directTransitionPolicy.approvedNext.publishedAt
  const smokeEvidence = {
    status: 'passed',
    candidateTag: candidate.tag,
    sourceCommit: candidate.sourceCommit,
    platforms: ['windows', 'macos', 'linux'],
    scenarios: [
      'legacy-manual-to-c',
      'legacy-auto-to-c',
      'current-to-c',
      'a-to-c',
      'b-to-c',
      'c-to-c',
      'fresh-c',
    ],
    completedAt: promotedAt,
    sha256: 'a'.repeat(64),
  }
  const healthEvidence = {
    status: 'healthy',
    p0Incidents: 0,
    p1Incidents: 0,
    dataLossIncidents: 0,
    migrationFailureRate: 0,
    observedAt: promotedAt,
    sha256: 'b'.repeat(64),
  }
  const legacyPauseFallback = {
    version: DIRECT_C_CURRENT.version,
    manifestSha256: DIRECT_C_CURRENT.manifestSha256,
    transactionId: '777-1',
    backups: {
      oss:
        'biyan/updater/transactions/777-1/backups/legacy-oss.json',
      r2:
        'biyan/updater/transactions/777-1/backups/legacy-r2.json',
    },
  }
  const currentPolicy = initialPolicy()
  const nextPolicy = preparePromotion({
    candidate,
    currentPolicy,
    phase: 'DIRECT_C',
    fromVersion: DIRECT_C_CURRENT.version,
    expectedCurrent: DIRECT_C_CURRENT.version,
    rollout: 100,
    promotedAt,
    smokeEvidence,
    healthEvidence,
    legacyPauseFallback,
    directTransitionPolicy,
  })
  return {
    candidate,
    currentPolicy,
    directTransitionPolicy,
    healthEvidence,
    legacyPauseFallback,
    manifest,
    manifestBytes,
    nextPolicy,
    smokeEvidence,
  }
}

function bucket(objects) {
  return {
    async get(key) {
      const value = objects[key]
      if (value === undefined) return null
      return { async json() { return structuredClone(value) } }
    },
  }
}

function signedRequest(version) {
  const session = `direct-c-session-${version}`
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const nonce = 'c'.repeat(64)
  const token = createHmac('sha256', signingKey)
    .update(`${session}:${timestamp}:${nonce}`)
    .digest('hex')
  return new Request(
    `https://updates.mita.so/biyan/v1/stable/windows/x86_64/${version}`,
    {
      headers: {
        'X-Client-Session': session,
        'X-Request-Token': token,
        'X-Request-Time': timestamp,
        'X-Request-Id': nonce,
        'X-Client-Version': version,
      },
    },
  )
}

function snapshot({
  provider,
  key,
  bytes,
  backupName,
  transactionId = '778-1',
  existed = true,
}) {
  if (!existed) {
    return {
      provider,
      key,
      existed: false,
      bytesSha256: null,
      metadata: null,
      acl: null,
      backupKey: null,
    }
  }
  return {
    provider,
    key,
    existed: true,
    bytesSha256: sha256(bytes),
    metadata: {
      cacheControl: 'no-store',
      contentType: 'application/json',
    },
    acl: provider === 'oss' ? { acl: 'public-read' } : null,
    backupKey:
      `biyan/updater/transactions/${transactionId}/backups/${backupName}.json`,
  }
}

test('tracked DIRECT_C policy pins the accepted candidate and every reviewed source', () => {
  const tracked = loadDirectCTransitionPolicy()
  const qualification = JSON.parse(
    fs.readFileSync(
      path.join(
        repoRoot,
        'scripts/updater/direct-qualification-policy.json',
      ),
      'utf8',
    ),
  )
  assert.deepEqual(tracked.approvedNext, {
    version: qualification.candidate.version,
    tag: qualification.candidate.tag,
    sourceCommit: qualification.candidate.sourceCommit,
    migrationPhase: qualification.candidate.migrationPhase,
    dataSchema: qualification.candidate.dataSchema,
    manifestKey: qualification.candidate.manifestKey,
    manifestSha256: qualification.candidate.manifestSha256,
    requiredPlatforms: DIRECT_C_CANONICAL_UPDATER_PLATFORMS,
  })
  assert.equal(qualification.state, 'candidate-pinned')
  assert.deepEqual(tracked.current, DIRECT_C_CURRENT)
  assert.deepEqual(tracked.routerSources, DIRECT_C_ROUTER_SOURCES)
  assert.equal(
    qualification.candidate.sourceCommit,
    DIRECT_C_TARGET_SOURCE_COMMIT,
  )
  for (const [version, source] of Object.entries(DIRECT_C_ROUTER_SOURCES)) {
    assert.deepEqual(
      {
        tag: qualification.sources[version].tag,
        sourceCommit: qualification.sources[version].sourceCommit,
        manifestKey: qualification.sources[version].manifestKey,
        manifestSha256:
          qualification.sources[version].manifestSha256,
      },
      {
        tag: source.tag,
        sourceCommit: source.sourceCommit,
        manifestKey: source.manifestKey,
        manifestSha256: source.manifestSha256,
      },
    )
  }
  assert.doesNotThrow(() =>
    validateDirectCTransitionPolicy(tracked, {
      requireApprovedNext: true,
    }),
  )

  const awaiting = structuredClone(tracked)
  awaiting.approvedNext = null
  assert.throws(() =>
    validateDirectCTransitionPolicy(awaiting, {
      requireApprovedNext: true,
    }),
    /approvedNext is still fail-closed/,
  )

  const approved = directFixture().directTransitionPolicy
  assert.deepEqual(
    approved.approvedNext.requiredPlatforms,
    DIRECT_C_CANONICAL_UPDATER_PLATFORMS,
  )
  for (const mutate of [
    (value) => {
      value.approvedNext.sourceCommit = 'f'.repeat(40)
    },
    (value) => {
      value.approvedNext.requiredPlatforms.pop()
    },
    (value) => {
      value.routerSources['0.6.644'].manifestSha256 = 'f'.repeat(64)
    },
  ]) {
    const drifted = structuredClone(approved)
    mutate(drifted)
    assert.throws(
      () => validateDirectCTransitionPolicy(drifted, {
        requireApprovedNext: true,
      }),
      /DIRECT_C/,
    )
  }
})

test('DIRECT_C prepares one exact 100% policy for legacy and three Router sources', () => {
  const fixture = directFixture()
  const { nextPolicy, candidate } = fixture
  assert.equal(nextPolicy.deploymentMode, 'direct-c')
  assert.equal(nextPolicy.currentVersion, candidate.version)
  assert.equal(nextPolicy.legacyBridgeVersion, candidate.version)
  assert.deepEqual(nextPolicy.completedPhases, ['C'])
  assert.deepEqual(
    Object.keys(nextPolicy.transitions).sort(),
    ['0.6.643', '0.6.644', '0.6.645'],
  )
  for (const transition of Object.values(nextPolicy.transitions)) {
    assert.equal(transition.to, candidate.version)
    assert.equal(transition.phase, 'DIRECT_C')
    assert.equal(transition.rollout, 100)
    assert.equal(transition.manifestKey, candidate.manifestKey)
    assert.deepEqual(transition.rolloutHistory, [
      { percentage: 100, at: promotedAt },
    ])
  }
  assert.deepEqual(
    validateApprovedDirectCTransition({
      policy: fixture.directTransitionPolicy,
      candidate,
      currentPolicy: fixture.currentPolicy,
      nextPolicy,
    }),
    {
      currentVersion: '0.6.633',
      targetVersion: '0.6.647',
      routerSources: ['0.6.643', '0.6.644', '0.6.645'],
    },
  )
})

test('DIRECT_C rejects partial rollout, missing qualification, and policy drift', () => {
  const fixture = directFixture()
  const base = {
    candidate: fixture.candidate,
    currentPolicy: fixture.currentPolicy,
    phase: 'DIRECT_C',
    fromVersion: '0.6.633',
    expectedCurrent: '0.6.633',
    rollout: 100,
    promotedAt,
    smokeEvidence: fixture.smokeEvidence,
    healthEvidence: fixture.healthEvidence,
    legacyPauseFallback: fixture.legacyPauseFallback,
    directTransitionPolicy: fixture.directTransitionPolicy,
  }
  assert.throws(
    () => preparePromotion({ ...base, rollout: 25 }),
    /atomically publish at 100%/,
  )
  assert.throws(
    () =>
      preparePromotion({
        ...base,
        smokeEvidence: {
          ...base.smokeEvidence,
          scenarios: base.smokeEvidence.scenarios.filter(
            (scenario) => scenario !== 'c-to-c',
          ),
        },
      }),
    /missing scenario: c-to-c/,
  )
  const drifted = structuredClone(fixture.nextPolicy)
  drifted.transitions['0.6.644'].rollout = 25
  assert.throws(
    () =>
      validateApprovedDirectCTransition({
        policy: fixture.directTransitionPolicy,
        candidate: fixture.candidate,
        currentPolicy: fixture.currentPolicy,
        nextPolicy: drifted,
      }),
    /does not target approvedNext at 100%/,
  )
})

test('legacy bridge validation, pause, and resume accept DIRECT_C C lineage', () => {
  const fixture = directFixture()
  const trackedLegacyPolicy = JSON.parse(
    fs.readFileSync(
      path.join(repoRoot, 'scripts/updater/legacy-bridge-policy.json'),
      'utf8',
    ),
  )
  assert.deepEqual(
    validatePromotionLegacyBridge({
      candidate: fixture.candidate,
      candidateManifestBytes: fixture.manifestBytes,
      currentPolicy: fixture.currentPolicy,
      nextPolicy: fixture.nextPolicy,
      trackedPolicy: trackedLegacyPolicy,
      directTransitionPolicy: fixture.directTransitionPolicy,
    }),
    {
      activeAVersion: '0.6.647',
      effectivePhase: 'C',
      trackedState: 'pre-direct-c',
    },
  )

  const live = validateLivePauseInputs({
    policyBytes: jsonBytes(fixture.nextPolicy),
    expectedCurrentVersion: '0.6.647',
    ossLegacyBytes: fixture.manifestBytes,
    r2LegacyBytes: fixture.manifestBytes,
  })
  assert.equal(live.activeAVersion, '0.6.647')
  assert.equal(live.activeAManifestSha256, fixture.candidate.manifestSha256)

  const fallbackBytes = legacy633Bytes()
  assert.equal(sha256(fallbackBytes), DIRECT_C_CURRENT.manifestSha256)
  const resumed = validateLegacyResumeInputs({
    policyBytes: jsonBytes({ ...fixture.nextPolicy, paused: true }),
    expectedCurrentVersion: '0.6.647',
    ossLegacyBytes: fallbackBytes,
    r2LegacyBytes: fallbackBytes,
    activeABytes: fixture.manifestBytes,
  })
  assert.equal(resumed.activeAVersion, '0.6.647')
  assert.equal(resumed.fallback.version, '0.6.633')

  const policyBeforeBytes = jsonBytes(fixture.nextPolicy)
  const proposedPausedPolicyBytes = jsonBytes({
    ...fixture.nextPolicy,
    paused: true,
    updatedAt: '2026-07-29T00:00:01.000Z',
  })
  const pauseJournal = createLegacyPauseJournal({
    transactionId: '880-1',
    createdAt: promotedAt,
    expectedCurrentVersion: '0.6.647',
    policyBeforeBytes,
    ossLegacyBeforeBytes: fixture.manifestBytes,
    r2LegacyBeforeBytes: fixture.manifestBytes,
    ossLegacyAclBytes: jsonBytes({ acl: 'public-read' }),
    proposedPausedPolicyBytes,
    ossFallbackBytes: fallbackBytes,
    r2FallbackBytes: fallbackBytes,
  })
  assert.equal(pauseJournal.legacySnapshots.oss.version, '0.6.647')
  assert.deepEqual(
    classifyLegacyPauseRollback({
      objectKind: 'policy',
      liveState: 'exists',
      liveBytes: proposedPausedPolicyBytes,
      beforeBytes: policyBeforeBytes,
      pausedBytes: proposedPausedPolicyBytes,
    }),
    { action: 'restore', reason: 'paused-bytes-are-live' },
  )
})

test('post-promotion legacy monitoring pins only the exact DIRECT_C target', () => {
  const fixture = directFixture()
  const preA = JSON.parse(
    fs.readFileSync(
      path.join(repoRoot, 'scripts/updater/legacy-bridge-policy.json'),
      'utf8',
    ),
  )
  const pinned = {
    ...preA,
    state: 'direct-c-pinned',
    expectedVersion: fixture.candidate.version,
    expectedManifestSha256: fixture.candidate.manifestSha256,
    requiredPlatforms: [...DIRECT_C_CANONICAL_UPDATER_PLATFORMS],
  }
  assert.equal(
    validateLegacyBridgePolicy(pinned, {
      directTransitionPolicy: fixture.directTransitionPolicy,
    }).state,
    'direct-c-pinned',
  )
  assert.equal(
    validateLegacyManifest(fixture.manifest, pinned, {
      directTransitionPolicy: fixture.directTransitionPolicy,
    }),
    fixture.manifest,
  )
  assert.equal(
    verifyLegacyManifestPair({
      policy: pinned,
      aliyunBytes: fixture.manifestBytes,
      r2Bytes: fixture.manifestBytes,
      directTransitionPolicy: fixture.directTransitionPolicy,
    }).expectedVersion,
    '0.6.647',
  )
  assert.throws(
    () =>
      validateLegacyBridgePolicy(
        {
          ...pinned,
          expectedVersion: '0.6.633',
          expectedManifestSha256: DIRECT_C_CURRENT.manifestSha256,
        },
        { directTransitionPolicy: fixture.directTransitionPolicy },
      ),
    /exact approved DIRECT_C target/,
  )
})

test('Router admits only exact A/B/C sources and keeps legacy current out of dynamic routing', async () => {
  const fixture = directFixture()
  const env = {
    BIYAN_SIGNING_KEY: signingKey,
    ROLLOUT_SALT: 'direct-c-rollout-salt',
    UPDATER_BUCKET: bucket({
      'biyan/updater/stable/policy.json': fixture.nextPolicy,
      [fixture.candidate.manifestKey]: fixture.manifest,
    }),
  }
  for (const version of ['0.6.643', '0.6.644', '0.6.645']) {
    const response = await handleRequest(signedRequest(version), env)
    assert.equal(response.status, 200)
    assert.equal((await response.json()).version, '0.6.647')
  }
  for (const version of ['0.6.633', '0.6.646', '0.6.647']) {
    const response = await handleRequest(signedRequest(version), env)
    assert.equal(response.status, 204)
    assert.equal(
      response.headers.get('x-biyan-updater-state'),
      'no-transition',
    )
  }

  const drifted = structuredClone(fixture.nextPolicy)
  drifted.transitions['0.6.644'].phase = 'C'
  env.UPDATER_BUCKET = bucket({
    'biyan/updater/stable/policy.json': drifted,
    [fixture.candidate.manifestKey]: fixture.manifest,
  })
  const response = await handleRequest(signedRequest('0.6.644'), env)
  assert.equal(response.status, 204)
  assert.equal(
    response.headers.get('x-biyan-updater-state'),
    'invalid-transition',
  )
})

test('terminal recovery derives all five DIRECT_C Router probes atomically', () => {
  const fixture = directFixture()
  const beforePolicyBytes = jsonBytes(fixture.currentPolicy)
  const nextPolicyBytes = jsonBytes(fixture.nextPolicy)
  const fallbackBytes = legacy633Bytes()
  const journal = createJournal({
    runId: '778',
    runAttempt: '1',
    targetTag: fixture.candidate.tag,
    targetVersion: fixture.candidate.version,
    sourceCommit: fixture.candidate.sourceCommit,
    nextPolicyBytes,
    createdAt: promotedAt,
    snapshots: [
      snapshot({
        provider: 'r2',
        key: 'biyan/updater/stable/policy.json',
        bytes: beforePolicyBytes,
        backupName: 'policy',
      }),
      snapshot({
        provider: 'oss',
        key: 'mita/latest.json',
        bytes: fallbackBytes,
        backupName: 'legacy-oss',
      }),
      snapshot({
        provider: 'r2',
        key: 'mita/latest.json',
        bytes: fallbackBytes,
        backupName: 'legacy-r2',
      }),
    ],
  })
  journal.state = 'committed'
  const plan = terminalPromotionRecoveryPlan({
    journal,
    nextPolicyBytes,
    beforePolicyBytes,
    candidate: fixture.candidate,
    phase: 'DIRECT_C',
    fromVersion: '0.6.633',
    expectedCurrent: '0.6.633',
    rollout: '100',
    smokeEvidence: fixture.smokeEvidence,
    healthEvidence: fixture.healthEvidence,
    directTransitionPolicy: fixture.directTransitionPolicy,
  })
  assert.equal(plan.sameRequest, true)
  assert.deepEqual(
    plan.routers.map((probe) => [
      probe.currentVersion,
      probe.expectedStatus,
      probe.targetVersion,
    ]),
    [
      ['0.6.633', 204, '0.6.633'],
      ['0.6.643', 200, '0.6.647'],
      ['0.6.644', 200, '0.6.647'],
      ['0.6.645', 200, '0.6.647'],
      ['0.6.647', 204, '0.6.647'],
    ],
  )

  const absentPolicyJournal = createJournal({
    runId: '779',
    runAttempt: '1',
    targetTag: fixture.candidate.tag,
    targetVersion: fixture.candidate.version,
    sourceCommit: fixture.candidate.sourceCommit,
    nextPolicyBytes,
    createdAt: promotedAt,
    snapshots: [
      snapshot({
        provider: 'r2',
        key: 'biyan/updater/stable/policy.json',
        existed: false,
      }),
      snapshot({
        provider: 'oss',
        key: 'mita/latest.json',
        bytes: fallbackBytes,
        backupName: 'legacy-oss',
        transactionId: '779-1',
      }),
      snapshot({
        provider: 'r2',
        key: 'mita/latest.json',
        bytes: fallbackBytes,
        backupName: 'legacy-r2',
        transactionId: '779-1',
      }),
    ],
  })
  absentPolicyJournal.state = 'committed'
  assert.equal(
    terminalPromotionRecoveryPlan({
      journal: absentPolicyJournal,
      nextPolicyBytes,
      beforePolicyBytes: null,
      candidate: fixture.candidate,
      phase: 'DIRECT_C',
      fromVersion: '0.6.633',
      expectedCurrent: '0.6.633',
      rollout: '100',
      smokeEvidence: fixture.smokeEvidence,
      healthEvidence: fixture.healthEvidence,
      directTransitionPolicy: fixture.directTransitionPolicy,
    }).sameRequest,
    true,
  )
})

test('promotion transaction writes both legacy origins before policy and probes every DIRECT_C source', () => {
  const runner = fs.readFileSync(
    path.join(repoRoot, 'scripts/updater/run-promotion-transaction.sh'),
    'utf8',
  ).replace(/\r\n?/g, '\n')
  const legacyWrite = runner.indexOf(
    'advance_journal committing before-legacy-dual-write',
  )
  const policyWrite = runner.indexOf(
    'advance_journal committing before-policy-write',
  )
  const routerProbe = runner.indexOf('probe_index=0')
  assert.ok(legacyWrite >= 0)
  assert.ok(policyWrite > legacyWrite)
  assert.ok(routerProbe > policyWrite)
  assert.match(
    runner,
    /current_legacy_version" != "\$next_legacy_version"[\s\S]+update_legacy=true/,
  )
  assert.match(
    runner,
    /if \[\[ "\$PHASE" == DIRECT_C \]\]; then[\s\S]+\.transitions \| keys/,
  )
  assert.match(
    runner,
    /test "\$probe_state" = "no-transition"/,
  )
  assert.match(
    runner,
    /if \[\[ "\$next_legacy_version" == "\$current_legacy_version" \]\]; then[\s\S]+legacy_publish_source=dist\/state\/resume-active-a\.json/,
  )
})
