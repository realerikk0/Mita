import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  OPEN_TRANSACTION_KEY,
  advanceJournal,
  classifyPolicyRollback,
  classifyRemoteProbe,
  createJournal,
  extractR2Etag,
  pollPublicBytes,
  recoveryCommands,
  validateApprovedATransition,
  validateHealthEvidenceUrl,
  validateJournal,
  verifySnapshotReadback,
} from '../promotion-transaction.mjs'

const sha = (character) => character.repeat(64)
const sourceCommit = 'a'.repeat(40)
const repoRoot = path.resolve(import.meta.dirname, '../../..')

function snapshot(provider, key, existed = true) {
  return existed
    ? {
        provider,
        key,
        existed: true,
        bytesSha256: sha(provider === 'r2' ? 'a' : 'b'),
        metadata: {
          cacheControl: 'no-store',
          contentType: 'application/json',
          custom: {},
        },
        acl: provider === 'oss' ? { acl: 'default' } : null,
        backupKey: `biyan/updater/transactions/123-1/backups/${provider}.json`,
      }
    : {
        provider,
        key,
        existed: false,
        bytesSha256: null,
        metadata: null,
        acl: null,
        backupKey: null,
      }
}

function journal() {
  return createJournal({
    runId: '123',
    runAttempt: '1',
    targetTag: 'v0.6.643',
    targetVersion: '0.6.643',
    sourceCommit,
    createdAt: '2026-07-24T00:00:00.000Z',
    snapshots: [
      snapshot('r2', 'biyan/updater/stable/policy.json'),
      snapshot('oss', 'mita/latest.json'),
      snapshot('r2', 'mita/latest.json'),
    ],
  })
}

test('remote probes distinguish exact absence from permission and network errors', () => {
  assert.equal(
    classifyRemoteProbe({
      provider: 'r2',
      key: 'missing',
      exitCode: 1,
      stderr: 'An error occurred (404) when calling HeadObject: Not Found',
    }).state,
    'absent'
  )
  assert.equal(
    classifyRemoteProbe({
      provider: 'oss',
      key: 'missing',
      exitCode: 1,
      stderr: 'NoSuchKey StatusCode=404',
    }).state,
    'absent'
  )
  for (const detail of [
    'AccessDenied 403',
    'Request timeout',
    'TLS certificate failure',
    'InternalError 500',
    'NoSuchKey 404 followed by network timeout',
  ]) {
    assert.throws(
      () =>
        classifyRemoteProbe({
          provider: 'r2',
          key: 'state',
          exitCode: 1,
          stderr: detail,
        }),
      /must not be treated as absent/
    )
  }
})

test('health evidence URL is content-addressed on the exact trusted origin', () => {
  const digest = sha('d')
  const expected =
    `https://static.mitapp.cn/biyan/updater/evidence/${digest}/rollout-health.json`
  assert.equal(validateHealthEvidenceUrl(expected, digest), expected)
  for (const unsafe of [
    `https://evil.example/biyan/updater/evidence/${digest}/rollout-health.json`,
    `https://static.mitapp.cn.evil.example/biyan/updater/evidence/${digest}/rollout-health.json`,
    `https://static.mitapp.cn/biyan/updater/evidence/${sha('e')}/rollout-health.json`,
    `${expected}?redirect=https://evil.example`,
  ]) {
    assert.throws(
      () => validateHealthEvidenceUrl(unsafe, digest),
      /must be exactly/
    )
  }
})

test('R2 ETag and recovery bytes metadata ACL readback are strict', () => {
  assert.equal(extractR2Etag({ ETag: '"0123456789abcdef0123456789abcdef"' }),
    '"0123456789abcdef0123456789abcdef"')
  assert.throws(() => extractR2Etag({ ETag: 'weak' }), /strict quoted ETag/)

  const bytes = Buffer.from('legacy')
  const restorable = {
    ...snapshot('oss', 'mita/latest.json'),
    bytesSha256: createHash('sha256').update(bytes).digest('hex'),
    metadata: {
      CacheControl: 'public, max-age=60, must-revalidate',
      ContentType: 'application/json',
      Metadata: { owner: 'release' },
      StorageClass: 'Standard',
    },
    acl: { acl: 'public-read' },
  }
  assert.equal(
    verifySnapshotReadback({
      snapshot: restorable,
      bytes,
      metadata: {
        cacheControl: 'public, max-age=60, must-revalidate',
        contentType: 'application/json',
        metadata: { owner: 'release' },
        storageClass: 'Standard',
      },
      acl: { objectAcl: 'public-read' },
    }).acl,
    'public-read'
  )
  assert.throws(
    () =>
      verifySnapshotReadback({
        snapshot: restorable,
        bytes,
        metadata: {
          cacheControl: 'no-store',
          contentType: 'application/json',
          metadata: { owner: 'release' },
          storageClass: 'Standard',
        },
        acl: { objectAcl: 'public-read' },
      }),
    /metadata does not match/
  )
})

test('policy rollback classifies a successful PUT even when ETag parsing fails', () => {
  const original = Buffer.from('original-policy')
  const proposed = Buffer.from('proposed-policy')
  assert.deepEqual(
    classifyPolicyRollback({
      policyExisted: true,
      originalBytes: original,
      nextBytes: proposed,
      liveState: 'exists',
      liveBytes: proposed,
    }),
    { action: 'restore', reason: 'proposed-policy-is-live' }
  )
  assert.deepEqual(
    classifyPolicyRollback({
      policyExisted: true,
      originalBytes: original,
      nextBytes: proposed,
      liveState: 'exists',
      liveBytes: original,
    }),
    { action: 'no-change', reason: 'original-policy-is-live' }
  )
  assert.throws(
    () =>
      classifyPolicyRollback({
        policyExisted: true,
        originalBytes: original,
        nextBytes: proposed,
        liveState: 'exists',
        liveBytes: Buffer.from('unknown-writer'),
      }),
    /neither original nor proposed/
  )
  assert.throws(
    () =>
      classifyPolicyRollback({
        policyExisted: true,
        originalBytes: original,
        nextBytes: proposed,
        liveState: 'absent',
      }),
    /original policy disappeared/
  )
})

test('initial A requires an exact reviewed approved-next manifest hash', () => {
  const manifestBytes = Buffer.from('{"version":"0.6.643"}\n')
  const digest = createHash('sha256').update(manifestBytes).digest('hex')
  const policy = {
    schema: 1,
    state: 'pre-a',
    current: { version: '0.6.633', manifestSha256: sha('c') },
    approvedNext: {
      version: '0.6.643',
      manifestSha256: digest,
      requiredPlatforms: [
        'darwin-aarch64',
        'darwin-x86_64',
        'windows-x86_64',
        'linux-x86_64',
      ],
    },
  }
  const candidate = {
    version: '0.6.643',
    migrationPhase: 'A',
    dataSchema: 1,
    manifestSha256: digest,
  }
  assert.equal(
    validateApprovedATransition({
      policy,
      candidate,
      manifestBytes,
      currentPolicy: { legacyBridgeVersion: null },
      nextPolicy: { legacyBridgeVersion: '0.6.643' },
    }).manifestSha256,
    digest
  )
  assert.throws(
    () =>
      validateApprovedATransition({
        policy: {
          ...policy,
          approvedNext: { ...policy.approvedNext, manifestSha256: sha('d') },
        },
        candidate,
        manifestBytes,
        currentPolicy: { legacyBridgeVersion: null },
        nextPolicy: { legacyBridgeVersion: '0.6.643' },
      }),
    /not explicitly approved/
  )
  assert.throws(
    () =>
      validateApprovedATransition({
        policy: { ...policy, approvedNext: null },
        candidate,
        manifestBytes,
        currentPolicy: { legacyBridgeVersion: null },
        nextPolicy: { legacyBridgeVersion: '0.6.643' },
      }),
    /approvedNext must be an object/
  )
})

test('tracked initial A approval pins the accepted v0.6.643 manifest exactly', () => {
  const policy = JSON.parse(
    fs.readFileSync(
      path.join(repoRoot, 'scripts/updater/legacy-a-transition-policy.json'),
      'utf8'
    )
  )
  assert.deepEqual(policy.approvedNext, {
    version: '0.6.643',
    manifestSha256:
      'a0ad7721c74aa6ec7817bb1b9626dbad05226e7871f21cebb4976921d100c9fa',
    requiredPlatforms: [
      'darwin-aarch64',
      'darwin-x86_64',
      'windows-x86_64',
      'linux-x86_64',
    ],
  })
})

test('journal validates restorable bytes, metadata, ACL, and immutable ledger', () => {
  const prepared = journal()
  assert.equal(validateJournal(prepared).state, 'prepared')
  const committing = advanceJournal(prepared, {
    state: 'committing',
    checkpoint: 'before-policy-write',
    immutableEntry: {
      provider: 'oss',
      key: 'biyan/updater/releases/v0.6.643/Biyan.app.tar.gz',
      sha256: sha('e'),
      createdByTransaction: true,
      verified: true,
    },
    updatedAt: '2026-07-24T00:01:00.000Z',
  })
  assert.equal(committing.state, 'committing')
  assert.equal(committing.recovery.required, true)
  assert.throws(
    () =>
      validateJournal({
        ...committing,
        snapshots: [
          {
            ...committing.snapshots[1],
            acl: null,
          },
        ],
      }),
    /ACL evidence is not restorable/
  )
  assert.throws(
    () =>
      advanceJournal(committing, {
        state: 'prepared',
        checkpoint: 'rewind',
        updatedAt: '2026-07-24T00:02:00.000Z',
      }),
    /Invalid promotion journal transition/
  )
})

test('recovery commands are derived from durable snapshots and created-object ledger', () => {
  const committing = advanceJournal(journal(), {
    state: 'committing',
    checkpoint: 'legacy-write-intent',
    immutableEntry: {
      provider: 'oss',
      key: 'biyan/updater/releases/v0.6.643/Biyan.app.tar.gz',
      sha256: sha('e'),
      createdByTransaction: true,
      verified: true,
    },
    updatedAt: '2026-07-24T00:01:00.000Z',
  })
  const commands = recoveryCommands(committing)
  assert.match(commands, /copy-object[\s\S]*mita\/latest\.json/)
  assert.match(commands, /delete-object[\s\S]*mita\/latest\.json/)
  assert.match(
    commands,
    /delete-object[\s\S]*biyan\/updater\/releases\/v0\.6\.643/
  )
  assert.match(commands, /put-object-acl/)
  assert.match(commands, /verify-snapshot-readback/)
  assert.match(commands, /RefreshObjectCaches/)
  assert.match(commands, /cloudflare-cache-purge/)
  assert.match(commands, /poll-url[\s\S]*legacy-aliyun-cdn/)
  assert.match(commands, /poll-url[\s\S]*legacy-r2-cdn/)
  assert.doesNotMatch(commands, /\bgh release edit\b|--draft/)
  assert.match(commands, new RegExp(OPEN_TRANSACTION_KEY.replaceAll('/', '\\/')))
})

test('recovery leaves the already-published GitHub release immutable', () => {
  const committing = advanceJournal(journal(), {
    state: 'committing',
    checkpoint: 'before-policy-write',
    updatedAt: '2026-07-24T00:01:00.000Z',
  })
  const commands = recoveryCommands(committing)
  assert.doesNotMatch(commands, /\bgh release edit\b|--draft/)
  assert.match(commands, /verify-snapshot-readback/)
  assert.match(commands, /poll-url/)
})

test('recovery never deletes an immutable object before transaction readback verified it', () => {
  const unverified = advanceJournal(journal(), {
    state: 'committing',
    checkpoint: 'immutable-create-intent',
    immutableEntry: {
      provider: 'oss',
      key: 'biyan/updater/releases/v0.6.643/unverified.tar.gz',
      sha256: sha('f'),
      createdByTransaction: true,
      verified: false,
    },
    updatedAt: '2026-07-24T00:01:00.000Z',
  })
  assert.doesNotMatch(recoveryCommands(unverified), /unverified\.tar\.gz/)
})

test('CDN polling waits through stale success and accepts only exact bytes', async () => {
  const expected = Buffer.from('new')
  let clock = 0
  let attempts = 0
  const result = await pollPublicBytes({
    url: 'https://static.mitapp.cn/mita/latest.json',
    expectedBytes: expected,
    timeoutMs: 1000,
    intervalMs: 100,
    now: () => clock,
    sleep: async (milliseconds) => {
      clock += milliseconds
    },
    fetchImpl: async () => {
      attempts += 1
      return new Response(attempts < 3 ? 'old' : expected, { status: 200 })
    },
  })
  assert.equal(result.status, 200)
  assert.equal(attempts, 3)
})

test('CDN polling fails closed after bounded stale or transport responses', async () => {
  let clock = 0
  await assert.rejects(
    () =>
      pollPublicBytes({
        url: 'https://updates.mita.so/mita/latest.json',
        expectedBytes: Buffer.from('new'),
        timeoutMs: 200,
        intervalMs: 100,
        now: () => clock,
        sleep: async (milliseconds) => {
          clock += milliseconds
        },
        fetchImpl: async () => new Response('old', { status: 200 }),
      }),
    /CDN did not converge/
  )
})

test('promotion workflows carry the fail-closed transaction controls', () => {
  const promotion = fs.readFileSync(
    path.join(repoRoot, '.github/workflows/promote-desktop-update.yml'),
    'utf8'
  )
  const runner = fs.readFileSync(
    path.join(repoRoot, 'scripts/updater/run-promotion-transaction.sh'),
    'utf8'
  )
  const promotionControl = `${promotion}\n${runner}`
  assert.match(promotion, /^  actions: read$/m)
  assert.match(promotion, /^  contents: read$/m)
  assert.match(promotion, /group: biyan-stable-updater-promotion/)
  assert.match(promotion, /aliyun-cli-linux-3\.3\.22-amd64\.tgz/)
  assert.match(promotion, /ossutil-2\.3\.0-linux-amd64\.zip/)
  assert.doesNotMatch(
    promotionControl,
    /\baliyun\s+--profile\s+\S+\s+oss\b/
  )
  assert.match(
    promotionControl,
    new RegExp(OPEN_TRANSACTION_KEY.replaceAll('/', '\\/'))
  )
  assert.match(promotionControl, /promotion-transaction\.mjs classify-probe/)
  assert.match(promotionControl, /promotion-transaction\.mjs poll-url/)
  assert.match(promotion, /inputs\.dry_run != true/)
  assert.match(promotion, /dry-run remote preflight/i)
  assert.match(promotion, /timeout-minutes: 90/)
  assert.match(
    promotion,
    /test "\$\(jq -r \.isDraft dist\/release\.json\)" = "false"/
  )
  assert.doesNotMatch(promotionControl, /\bgh release edit\b|--draft/)
  assert.match(
    runner,
    /select\(\.createdByTransaction and \.verified\)/
  )
  assert.match(runner, /rollback-legacy-aliyun-cdn\.json/)
  assert.match(runner, /rollback-legacy-r2-cdn\.json/)
  assert.match(runner, /--if-match "\$policy_original_etag"/)
  assert.match(runner, /--if-none-match '\*'/)
  const attempted = runner.indexOf('policy_write_attempted=true')
  const putReturned = runner.indexOf('policy_write_completed=true', attempted)
  const parseEtag = runner.indexOf(
    'policy_written_etag="$(node scripts/updater/promotion-transaction.mjs',
    putReturned
  )
  assert.ok(attempted >= 0 && attempted < putReturned && putReturned < parseEtag)
  assert.match(runner, /classify-policy-rollback/)
  assert.match(
    promotion,
    /Publish with rollback protection[\s\S]*git fetch --force --no-tags origin[\s\S]*refs\/remotes\/origin\/mita-main[\s\S]*run-promotion-transaction\.sh/
  )
  for (const writer of [
    'updater-health-gate.yml',
    'updater-kill-switch.yml',
  ]) {
    const source = fs.readFileSync(
      path.join(repoRoot, '.github/workflows', writer),
      'utf8'
    )
    assert.match(source, new RegExp(OPEN_TRANSACTION_KEY.replaceAll('/', '\\/')))
    assert.match(source, /promotion-transaction\.mjs classify-probe/)
    assert.match(source, /--provider r2/)
    assert.match(source, /--provider oss/)
    assert.match(source, /ref: mita-main/)
    assert.match(source, /refs\/remotes\/origin\/mita-main/)
    assert.match(source, /ossutil-2\.3\.0-linux-amd64\.zip/)
    assert.match(source, /--if-match "\$policy_etag"/)
    assert.match(source, /policy-verified-metadata\.json/)
  }
  const health = fs.readFileSync(
    path.join(repoRoot, '.github/workflows/updater-health-gate.yml'),
    'utf8'
  )
  assert.match(health, /validate-health-evidence-url/)
})
