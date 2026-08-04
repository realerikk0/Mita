import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  validateLegacyBridgePolicy,
  validateLegacyManifest,
  validatePromotionLegacyBridge,
  verifyLegacyManifestPair,
} from '../legacy-manifest-policy.mjs'

const endpoints = {
  aliyun: 'https://static.mitapp.cn/mita/latest.json',
  r2: 'https://updates.mita.so/mita/latest.json',
}
const repoRoot = path.resolve(import.meta.dirname, '../../..')
const legacyTrainPolicy = {
  schema: 1,
  activeTrain: 'legacy-test-train',
  trains: [
    {
      id: 'legacy-test-train',
      status: 'active',
      releases: {
        A: { version: '0.6.643', dataSchema: 1 },
        B: { version: '0.6.644', dataSchema: 2 },
        C: { version: '0.6.645', dataSchema: 3 },
      },
    },
  ],
}

function manifest({
  version = '0.6.633',
  prefix = `/mita/stable/v${version}`,
  includeLinux = false,
} = {}) {
  const platforms = {
    'darwin-aarch64': {
      signature: 'mac-signature',
      url: `https://static.mitapp.cn${prefix}/Biyan.app.tar.gz`,
    },
    'darwin-x86_64': {
      signature: 'mac-signature',
      url: `https://static.mitapp.cn${prefix}/Biyan.app.tar.gz`,
    },
    'windows-x86_64': {
      signature: 'windows-signature',
      url: `https://static.mitapp.cn${prefix}/Biyan_${version}_x64-setup.exe`,
    },
  }
  if (includeLinux) {
    platforms['linux-x86_64'] = {
      signature: 'linux-signature',
      url: `https://static.mitapp.cn${prefix}/Biyan_${version}_amd64.AppImage`,
    }
  }
  return { version, platforms }
}

function bytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`)
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function promotionCandidate(version, migrationPhase, dataSchema) {
  const publishedAt = '2026-07-24T00:00:00.000Z'
  const sourceCommit = '0123456789abcdef0123456789abcdef01234567'
  const tag = `v${version}`
  const manifestKey = `biyan/updater/releases/${tag}/latest.json`
  const latest = manifest({
    version,
    prefix: `/biyan/updater/releases/v${version}`,
    includeLinux: true,
  })
  const candidateManifestBytes = bytes({
    version,
    sourceCommit,
    migrationPhase,
    dataSchema,
    notes: '',
    pub_date: publishedAt,
    platforms: latest.platforms,
  })
  return {
    candidate: {
      version,
      tag,
      sourceCommit,
      migrationPhase,
      dataSchema,
      publishedAt,
      manifestKey,
      manifestSha256: sha256(candidateManifestBytes),
    },
    candidateManifestBytes,
  }
}

const preAManifest = manifest()
const preAPolicy = {
  schema: 1,
  state: 'pre-a',
  expectedVersion: '0.6.633',
  expectedManifestSha256: sha256(bytes(preAManifest)),
  requiredPlatforms: [
    'darwin-aarch64',
    'darwin-x86_64',
    'windows-x86_64',
  ],
  manifestUrls: endpoints,
}

test('pre-a accepts the exact live version, platform set, and Biyan assets', () => {
  const current = preAManifest
  assert.equal(validateLegacyManifest(current, preAPolicy), current)
  const evidence = verifyLegacyManifestPair({
    policy: preAPolicy,
    aliyunBytes: bytes(current),
    r2Bytes: bytes(current),
    verifiedAt: '2026-07-24T00:00:00.000Z',
  })
  assert.equal(evidence.status, 'passed')
  assert.equal(evidence.expectedVersion, '0.6.633')
  assert.equal(evidence.aliyunSha256, evidence.r2Sha256)
})

test('platform set is exact and rejects both extra and missing platforms', () => {
  assert.throws(
    () => validateLegacyManifest(manifest({ includeLinux: true }), preAPolicy),
    /platform set must be exactly/,
  )
  const missing = manifest()
  delete missing.platforms['darwin-x86_64']
  assert.throws(
    () => validateLegacyManifest(missing, preAPolicy),
    /platform set must be exactly/,
  )
})

test('manifest version must match the tracked policy exactly', () => {
  assert.throws(
    () => validateLegacyManifest(manifest({ version: '0.6.634' }), preAPolicy),
    /version must be exactly 0\.6\.633/,
  )
})

test('artifact URLs reject HTTP and retired asset names', () => {
  const insecure = manifest()
  insecure.platforms['windows-x86_64'].url = insecure.platforms['windows-x86_64'].url
    .replace('https://', 'http://')
  assert.throws(() => validateLegacyManifest(insecure, preAPolicy), /HTTPS URL/)

  const retired = manifest()
  retired.platforms['windows-x86_64'].url =
    'https://static.mitapp.cn/mita/stable/v0.6.633/Jan_0.6.633_x64-setup.exe'
  assert.throws(() => validateLegacyManifest(retired, preAPolicy), /retired artifact name/)
})

test('every required platform must have a nonempty signature', () => {
  const unsigned = manifest()
  unsigned.platforms['darwin-aarch64'].signature = '   '
  assert.throws(() => validateLegacyManifest(unsigned, preAPolicy), /signature must be nonempty/)
})

test('legacy entrypoint manifests must be byte-identical', () => {
  const current = manifest()
  const alternate = { ...current, notes: 'different bytes' }
  assert.throws(
    () => verifyLegacyManifestPair({
      policy: preAPolicy,
      aliyunBytes: bytes(current),
      r2Bytes: bytes(alternate),
    }),
    /byte-identical/,
  )
})

test('byte-identical manifests must also match the reviewed candidate hash', () => {
  const semanticallyValidButUnreviewed = bytes({
    ...preAManifest,
    notes: 'unreviewed bytes',
  })
  assert.throws(
    () =>
      verifyLegacyManifestPair({
        policy: preAPolicy,
        aliyunBytes: semanticallyValidButUnreviewed,
        r2Bytes: semanticallyValidButUnreviewed,
      }),
    /SHA-256 must be exactly/
  )
})

test('policy rejects unknown states and a-pinned without the exact four platforms', () => {
  assert.throws(
    () => validateLegacyBridgePolicy({ ...preAPolicy, state: 'transitioning' }),
    /state must be pre-a, a-pinned, or direct-c-pinned/,
  )
  assert.throws(
    () => validateLegacyBridgePolicy({
      ...preAPolicy,
      state: 'a-pinned',
      expectedVersion: '0.6.643',
    }),
    /a-pinned requiredPlatforms must be exactly/,
  )
})

test('a-pinned accepts only active train A and requires Linux plus immutable Biyan URLs', () => {
  const pinned = manifest({
    version: '0.6.643',
    prefix: '/biyan/updater/releases/v0.6.643',
    includeLinux: true,
  })
  const policy = {
    ...preAPolicy,
    state: 'a-pinned',
    expectedVersion: '0.6.643',
    expectedManifestSha256: sha256(bytes(pinned)),
    requiredPlatforms: [
      'darwin-aarch64',
      'darwin-x86_64',
      'windows-x86_64',
      'linux-x86_64',
    ],
  }
  assert.equal(
    validateLegacyManifest(pinned, policy, {
      trainPolicy: legacyTrainPolicy,
    }),
    pinned,
  )
  assert.equal(
    verifyLegacyManifestPair({
      policy,
      aliyunBytes: bytes(pinned),
      r2Bytes: bytes(pinned),
      trainPolicy: legacyTrainPolicy,
    }).expectedManifestSha256,
    policy.expectedManifestSha256
  )
  assert.throws(
    () =>
      validateLegacyBridgePolicy(
        {
          ...policy,
          expectedVersion: '0.6.644',
        },
        { trainPolicy: legacyTrainPolicy },
      ),
    /active train A version 0\.6\.643/,
  )
})

test('promotion policy mechanically preserves the active A legacy bridge', () => {
  const {
    candidate: candidateA,
    candidateManifestBytes: candidateAManifestBytes,
  } = promotionCandidate('0.6.643', 'A', 1)
  const activeAManifestSha256 = candidateA.manifestSha256
  const pinnedPolicy = {
    ...preAPolicy,
    state: 'a-pinned',
    expectedVersion: '0.6.643',
    expectedManifestSha256: activeAManifestSha256,
    requiredPlatforms: [
      'darwin-aarch64',
      'darwin-x86_64',
      'windows-x86_64',
      'linux-x86_64',
    ],
  }
  const nextA = {
    legacyBridgeVersion: '0.6.643',
    releases: {
      '0.6.643': { effectivePhase: 'A' },
    },
  }
  assert.deepEqual(
    validatePromotionLegacyBridge({
      candidate: candidateA,
      candidateManifestBytes: candidateAManifestBytes,
      currentPolicy: { legacyBridgeVersion: null },
      nextPolicy: nextA,
      trackedPolicy: preAPolicy,
      trainPolicy: legacyTrainPolicy,
    }),
    {
      activeAVersion: '0.6.643',
      effectivePhase: 'A',
      trackedState: 'pre-a',
    },
  )

  const {
    candidate: candidateB,
    candidateManifestBytes: candidateBManifestBytes,
  } = promotionCandidate('0.6.644', 'B', 2)
  const nextB = {
    legacyBridgeVersion: '0.6.643',
    releases: {
      '0.6.644': { effectivePhase: 'B' },
    },
  }
  assert.equal(
    validatePromotionLegacyBridge({
      candidate: candidateB,
      candidateManifestBytes: candidateBManifestBytes,
      currentPolicy: { legacyBridgeVersion: '0.6.643' },
      nextPolicy: nextB,
      trackedPolicy: pinnedPolicy,
      trainPolicy: legacyTrainPolicy,
    }).activeAVersion,
    '0.6.643',
  )
  assert.throws(
    () =>
      validatePromotionLegacyBridge({
        candidate: candidateB,
        candidateManifestBytes: candidateBManifestBytes,
        currentPolicy: { legacyBridgeVersion: '0.6.643' },
        nextPolicy: { ...nextB, legacyBridgeVersion: '0.6.644' },
        trackedPolicy: pinnedPolicy,
        trainPolicy: legacyTrainPolicy,
      }),
    /must remain active train A 0\.6\.643/,
  )
  const {
    candidate: undeclaredCandidate,
    candidateManifestBytes: undeclaredManifestBytes,
  } = promotionCandidate('0.6.646', 'A', 1)
  assert.throws(
    () =>
      validatePromotionLegacyBridge({
        candidate: undeclaredCandidate,
        candidateManifestBytes: undeclaredManifestBytes,
        currentPolicy: { legacyBridgeVersion: '0.6.643' },
        nextPolicy: {
          legacyBridgeVersion: '0.6.646',
          releases: { '0.6.646': { effectivePhase: 'A' } },
        },
        trackedPolicy: pinnedPolicy,
        trainPolicy: legacyTrainPolicy,
      }),
    /must be the active train A release/,
  )
  assert.throws(
    () =>
      validatePromotionLegacyBridge({
        candidate: candidateB,
        candidateManifestBytes: candidateBManifestBytes,
        currentPolicy: { legacyBridgeVersion: '0.6.643' },
        nextPolicy: nextB,
        trackedPolicy: preAPolicy,
        trainPolicy: legacyTrainPolicy,
      }),
    /requires tracked a-pinned policy 0\.6\.643/,
  )

  const hostileManifest = JSON.parse(candidateAManifestBytes.toString('utf8'))
  hostileManifest.platforms['windows-x86_64'].url =
    'https://evil.invalid/biyan/updater/releases/v0.6.643/Biyan_0.6.643_x64-setup.exe'
  const hostileBytes = bytes(hostileManifest)
  assert.throws(
    () =>
      validatePromotionLegacyBridge({
        candidate: {
          ...candidateA,
          manifestSha256: sha256(hostileBytes),
        },
        candidateManifestBytes: hostileBytes,
        currentPolicy: { legacyBridgeVersion: null },
        nextPolicy: nextA,
        trackedPolicy: preAPolicy,
        trainPolicy: legacyTrainPolicy,
      }),
    /URL must be exactly https:\/\/static\.mitapp\.cn/
  )

  assert.throws(
    () =>
      validatePromotionLegacyBridge({
        candidate: candidateA,
        candidateManifestBytes: Buffer.from(
          candidateAManifestBytes.toString('utf8').replace(
            '"notes": ""',
            '"notes": "tampered"'
          )
        ),
        currentPolicy: { legacyBridgeVersion: null },
        nextPolicy: nextA,
        trackedPolicy: preAPolicy,
        trainPolicy: legacyTrainPolicy,
      }),
    /latest\.json SHA-256 does not match/
  )
})

test('deployed DIRECT_C accepts only the exact rolling terminal RECOVERY patch', () => {
  const directPolicy = JSON.parse(
    fs.readFileSync(
      path.join(repoRoot, 'scripts/updater/direct-c-transition-policy.json'),
      'utf8',
    ),
  )
  const trackedPolicy = JSON.parse(
    fs.readFileSync(
      path.join(repoRoot, 'scripts/updater/legacy-bridge-policy.json'),
      'utf8',
    ),
  )
  const previous = {
    ...directPolicy.approvedNext,
    status: 'published-superseded',
  }
  delete previous.manifestKey
  delete previous.manifestSha256
  delete previous.requiredPlatforms
  const {
    candidate,
    candidateManifestBytes,
  } = promotionCandidate('0.6.650', 'C', 3)
  const trainPolicy = {
    supersededTerminalReleases: [
      {
        tag: 'v0.6.646',
        version: '0.6.646',
        migrationPhase: 'C',
        dataSchema: 3,
        sourceCommit: 'a'.repeat(40),
        status: 'blocked-before-publication',
      },
      {
        tag: 'v0.6.647',
        version: '0.6.647',
        migrationPhase: 'C',
        dataSchema: 3,
        sourceCommit: 'b'.repeat(40),
        status: 'blocked-before-publication',
      },
      {
        tag: 'v0.6.648',
        version: '0.6.648',
        migrationPhase: 'C',
        dataSchema: 3,
        sourceCommit: 'c'.repeat(40),
        status: 'blocked-before-publication',
      },
      previous,
    ],
    activeTerminalRelease: {
      tag: candidate.tag,
      version: candidate.version,
      migrationPhase: candidate.migrationPhase,
      dataSchema: candidate.dataSchema,
      sourceCommit: candidate.sourceCommit,
    },
  }
  const currentPolicy = {
    schema: 1,
    channel: 'stable',
    deploymentMode: 'direct-c',
    currentVersion: previous.version,
    legacyBridgeVersion: previous.version,
    releases: {
      [previous.version]: {
        phase: 'DIRECT_C',
        effectivePhase: 'C',
        tag: previous.tag,
        sourceCommit: previous.sourceCommit,
        dataSchema: previous.dataSchema,
        manifestKey: directPolicy.approvedNext.manifestKey,
        manifestSha256: directPolicy.approvedNext.manifestSha256,
      },
    },
    transitions: {},
  }
  const nextPolicy = {
    ...structuredClone(currentPolicy),
    currentVersion: candidate.version,
    legacyBridgeVersion: candidate.version,
    releases: {
      ...structuredClone(currentPolicy.releases),
      [candidate.version]: {
        phase: 'RECOVERY',
        effectivePhase: 'C',
        tag: candidate.tag,
        manifestKey: candidate.manifestKey,
        manifestSha256: candidate.manifestSha256,
      },
    },
    transitions: {
      [previous.version]: {
        to: candidate.version,
        phase: 'RECOVERY',
        rollout: 100,
        manifestKey: candidate.manifestKey,
      },
    },
  }

  const validate = (overrides = {}) =>
    validatePromotionLegacyBridge({
      candidate,
      candidateManifestBytes,
      currentPolicy,
      nextPolicy,
      trackedPolicy,
      directTransitionPolicy: directPolicy,
      trainPolicy,
      ...overrides,
    })

  assert.deepEqual(validate(), {
    activeAVersion: '0.6.650',
    effectivePhase: 'C',
    trackedState: 'direct-c-recovery',
  })

  const wrongSourcePolicy = structuredClone(trainPolicy)
  wrongSourcePolicy.activeTerminalRelease.sourceCommit = 'f'.repeat(40)
  assert.throws(
    () => validate({ trainPolicy: wrongSourcePolicy }),
    /candidate must match the exact active terminal release/,
  )

  const skippedPolicy = structuredClone(trainPolicy)
  skippedPolicy.activeTerminalRelease.version = '0.6.651'
  skippedPolicy.activeTerminalRelease.tag = 'v0.6.651'
  assert.throws(
    () => validate({ trainPolicy: skippedPolicy }),
    /next exact C\/3 patch/,
  )

  assert.throws(
    () =>
      validate({
        nextPolicy: {
          ...structuredClone(nextPolicy),
          transitions: {
            [previous.version]: {
              ...nextPolicy.transitions[previous.version],
              rollout: 25,
            },
          },
        },
      }),
    /atomically publish/,
  )

  assert.throws(
    () =>
      validate({
        currentPolicy: {
          ...structuredClone(currentPolicy),
          legacyBridgeVersion: '0.6.648',
        },
      }),
    /current policy must match the latest published C terminal/,
  )

  const driftedHistory = structuredClone(trainPolicy)
  driftedHistory.supersededTerminalReleases.at(-1).sourceCommit =
    'e'.repeat(40)
  assert.throws(
    () => validate({ trainPolicy: driftedHistory }),
    /exact published v0\.6\.649 baseline/,
  )
})

test('promotion workflow is main-pinned and invokes the tracked legacy gate', () => {
  const workflow = fs.readFileSync(
    path.join(repoRoot, '.github/workflows/promote-desktop-update.yml'),
    'utf8',
  ).replace(/\r\n?/g, '\n')
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/mita-main'/)
  assert.match(
    workflow,
    /ref: mita-main\n\s+fetch-depth: 0\n\s+persist-credentials: false/,
  )
  assert.match(
    workflow,
    /git merge-base --is-ancestor \\\s*\n\s*"\$\(jq -r \.sourceCommit dist\/candidate\/candidate\.json\)" \\\s*\n\s*refs\/remotes\/origin\/mita-main/,
  )
  assert.match(
    workflow,
    /legacy-manifest-policy\.mjs validate-promotion \\\s*\n\s*--candidate dist\/candidate\/candidate\.json \\\s*\n\s*--manifest dist\/candidate\/latest\.json \\\s*\n\s*--current-policy dist\/state\/current-policy\.json \\\s*\n\s*--next-policy dist\/state\/next-policy\.json/,
  )
})
