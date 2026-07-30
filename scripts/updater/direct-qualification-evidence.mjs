#!/usr/bin/env node

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

const POLICY_FILE = fileURLToPath(
  new URL('./direct-qualification-policy.json', import.meta.url),
)
const REPOSITORY = 'realerikk0/Mita'
const LIVE_BRANCH = 'mita-main'
const PLATFORMS = ['windows', 'macos', 'linux']
const WORKFLOW = Object.freeze({
  name: 'Biyan Direct Qualification',
  path: '.github/workflows/biyan-direct-qualification.yml',
  harnessPaths: [
    '.github/workflows/biyan-direct-qualification.yml',
    'scripts/updater/direct-qualification-policy.json',
    'scripts/updater/direct-qualification-evidence.mjs',
    'scripts/updater/prepare-direct-qualification-inputs.py',
    'autoqa/migration_runner.py',
  ],
})
const CANDIDATE_STATIC = Object.freeze({
  version: '0.6.649',
  tag: 'v0.6.649',
  sourceCommit: 'cc7bd75e40da7e32ea93433ed7311fb7ddbab379',
  migrationPhase: 'C',
  dataSchema: 3,
  manifestKey: 'biyan/updater/releases/v0.6.649/latest.json',
  assets: {
    windows: { name: 'Biyan_0.6.649_x64-setup.exe' },
    macos: { name: 'Biyan_0.6.649_universal.dmg' },
    linux: { name: 'Biyan_0.6.649_amd64.AppImage' },
  },
})
const SOURCES = Object.freeze({
  '0.6.608': {
    tag: 'v0.6.608',
    tagObject: '0fa87ae02cf01228a3b4ab4793c2e3d50a2a0934',
    sourceCommit: 'eed142e1f1f8a8362342fcbcd7aae8d26474c584',
    qualificationMode: 'manual-installer',
    manifestKey: null,
    manifestSha256: null,
    updater: {
      endpoint: 'https://updates.jingxing.uk/mita/latest.json',
      publicKeyId: '2E4130EB1A35AD44',
      publicKeySha256:
        'ce2d3ecb334d0d71a109f41b04d7411129f0394a6efc5d9e83fb27e1bba0d4ad',
      liveDiscovery: 'unavailable-no-dns',
    },
    assets: {
      windows: {
        name: 'Mita_0.6.608_x64-setup.exe',
        sha256: '9437603a37338f38284f34f117f2816ca79a0df1487c86145d1e52d3205e8668',
      },
      macos: {
        name: 'Mita_0.6.608_universal.dmg',
        sha256: '35101b75167b9b6024ff144677d003d5a8439acdf88e766ec6f34ddf7c50817e',
      },
    },
  },
  '0.6.611': {
    tag: 'v0.6.611',
    tagObject: '2177b466965000e02062f7c143994269aee89f72',
    sourceCommit: '373361a20f6f075c62e7a51ec62ff00113ca7c8a',
    qualificationMode: 'automatic-updater',
    manifestKey: null,
    manifestSha256: null,
    updater: {
      endpoint: 'https://updates.mita.so/mita/latest.json',
      publicKeyId: '9195390A4D7B61AC',
      publicKeySha256:
        'e6724b51ed70b233c7a2f2c2f713211cb8493446d774d7185d0b3e689cfd3ec1',
      liveDiscovery: 'legacy-manifest-0.6.633',
    },
    assets: {
      windows: {
        name: 'Mita_0.6.611_x64-setup.exe',
        sha256: 'e04e040363365c42af7df6974b47ac05ecb73ab3607bd6c4aca6cf98769e0023',
      },
      macos: {
        name: 'Mita_0.6.611_universal.dmg',
        sha256: '85d7a695a8cc0e39cb8ac69ae64601aca17cc3117dcb0711cfda2950164227ea',
      },
    },
  },
  '0.6.633': {
    tag: 'v0.6.633',
    sourceCommit: '97d5f734b472f0b65e141614f047e405f1ba1c0b',
    manifestKey: 'mita/latest.json',
    manifestSha256:
      '142abddf03744562195404d0dd9ae92f53d8f74d20b2cef19b2db60aeb8ec350',
    assets: {
      windows: {
        name: 'Biyan_0.6.633_x64-setup.exe',
        sha256: 'd7369543669a0f9ebd1b5503556cd177d3dcf2e74f7660e0625221d5c33c8c4a',
      },
      macos: {
        name: 'Biyan_0.6.633_universal.dmg',
        sha256: 'ca6997370e64b7455acc247438f736ddc89b2f8708a417082190a14498a29511',
      },
    },
  },
  '0.6.643': {
    tag: 'v0.6.643',
    sourceCommit: '38e6d9290a8b9b0f152ff2a7eefb550e6ead7df5',
    manifestKey: 'biyan/updater/releases/v0.6.643/latest.json',
    manifestSha256:
      'a0ad7721c74aa6ec7817bb1b9626dbad05226e7871f21cebb4976921d100c9fa',
    assets: {
      windows: {
        name: 'Biyan_0.6.643_x64-setup.exe',
        sha256: 'a25d32b43028b90c4ed7ffd8c835106a925bcc72684dbd2b689d5e371fb123ee',
      },
      macos: {
        name: 'Biyan_0.6.643_universal.dmg',
        sha256: 'c9abe462da067b15c9764a395f6b2b356e624cb714a5029cdcf165eb62c53268',
      },
      linux: {
        name: 'Biyan_0.6.643_amd64.AppImage',
        sha256: '803568bd4c04ba5f3cd7144b000f0d27ad8f4c63a7af9084a5762b679d047fe3',
      },
    },
  },
  '0.6.644': {
    tag: 'v0.6.644',
    sourceCommit: 'd58f4e9141ee9dfc985171d13c993103dd763b01',
    manifestKey: 'biyan/updater/releases/v0.6.644/latest.json',
    manifestSha256:
      'a12610090f3cf49d767a00ac4a0f2125c2f64f66baeb03096c862ac25c744cdb',
    assets: {
      windows: {
        name: 'Biyan_0.6.644_x64-setup.exe',
        sha256: 'be0262ec8e13bb68793eda30fb1709e681d9da94f81899284a315a456f46bdc3',
      },
      macos: {
        name: 'Biyan_0.6.644_universal.dmg',
        sha256: '070a25a347fd9d3c86bb428182aed5a85b377bc2a5e532138486a40a21904900',
      },
      linux: {
        name: 'Biyan_0.6.644_amd64.AppImage',
        sha256: 'f137d301f868fff4de49b957db6abde221766d4147621fa6078fec2108c825e6',
      },
    },
  },
  '0.6.645': {
    tag: 'v0.6.645',
    sourceCommit: 'a79c715a61057d7b78b440d90e3419dfc7e55d12',
    manifestKey: 'biyan/updater/releases/v0.6.645/latest.json',
    manifestSha256:
      '83c65a2d55615ceb98617ae0025c45f55273c27450fd79cc60da3ff9e66ceeab',
    assets: {
      windows: {
        name: 'Biyan_0.6.645_x64-setup.exe',
        sha256: '22d648fda908eef73925eff71261c2cf05a543b71e3b6157625f1de4b2e087a2',
      },
      macos: {
        name: 'Biyan_0.6.645_universal.dmg',
        sha256: '60a5a424b477eea5e0ac40bed4509e309bd248b264921796b33f9f71c60b9a47',
      },
      linux: {
        name: 'Biyan_0.6.645_amd64.AppImage',
        sha256: '422934cb6bfc0b8a319897b96e5dbdcf831b30232c474febd85ac12cd48e0ef6',
      },
    },
  },
})
const LANES = Object.freeze([
  ...['0.6.608', '0.6.611'].flatMap((sourceVersion) => {
    const scenario =
      sourceVersion === '0.6.608'
        ? 'legacy-manual-to-c'
        : 'legacy-auto-to-c'
    return ['windows', 'macos'].map((platform) => ({
      id: `${scenario}-${platform}`,
      platform,
      runner: platform === 'windows' ? 'windows-2022' : 'macos-15-intel',
      scenario,
      sourceVersion,
      sourceRole: 'current',
      snapshot: 'current',
    }))
  }),
  {
    id: 'current-to-c-windows',
    platform: 'windows',
    runner: 'windows-2022',
    scenario: 'current-to-c',
    sourceVersion: '0.6.633',
    sourceRole: 'current',
    snapshot: 'current',
  },
  {
    id: 'current-to-c-macos',
    platform: 'macos',
    runner: 'macos-15-intel',
    scenario: 'current-to-c',
    sourceVersion: '0.6.633',
    sourceRole: 'current',
    snapshot: 'current',
  },
  {
    id: 'fresh-c-linux',
    platform: 'linux',
    runner: 'ubuntu-24.04',
    scenario: 'fresh-c',
    sourceVersion: null,
    sourceRole: null,
    snapshot: 'fresh',
  },
  ...['0.6.643', '0.6.644', '0.6.645'].flatMap((sourceVersion, index) => {
    const phase = ['a', 'b', 'c'][index]
    return PLATFORMS.map((platform) => ({
      id: `${phase}-to-c-${platform}`,
      platform,
      runner: {
        windows: 'windows-2022',
        macos: 'macos-15-intel',
        linux: 'ubuntu-24.04',
      }[platform],
      scenario: `${phase}-to-c`,
      sourceVersion,
      sourceRole: phase === 'c' ? 'current' : phase,
      snapshot: phase === 'c' ? 'current' : phase,
    }))
  }),
])
const BIYAN_CONFIG_ROOTS = Object.freeze({
  windows: '%APPDATA%/Biyan',
  macos: '$HOME/Library/Application Support/Biyan',
  linux: '$HOME/.local/share/Biyan',
})
const LEGACY_DATA_ROOTS = Object.freeze({
  windows: '%APPDATA%/Mita/data',
  macos: '$HOME/Library/Application Support/Mita/data',
  linux: '$HOME/.local/share/Mita/data',
})
const BIYAN_DATA_ROOTS = Object.freeze(
  Object.fromEntries(
    Object.entries(BIYAN_CONFIG_ROOTS).map(([platform, root]) => [
      platform,
      `${root}/data`,
    ]),
  ),
)
const MARKER_PATH = 'agent-workspaces/direct-qualification-preserved.txt'
const CURRENT_WINDOWS_SOURCE_READINESS = Object.freeze({
  phase: 'current',
  version: '0.6.633',
  settings: '%APPDATA%/Mita/settings.json',
  dataRoot: '%APPDATA%/Biyan/data',
  store: '%APPDATA%/Biyan/data/store.json',
  mcpConfig: '%APPDATA%/Biyan/data/mcp_config.json',
  marker:
    '%APPDATA%/Biyan/data/agent-workspaces/direct-qualification-preserved.txt',
  requiredStore: Object.freeze({
    version: '0.6.633',
    mcp_version: 5,
    windows_biyan_migrated: true,
  }),
})

function fail(message) {
  throw new Error(message)
}

function requireObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object`)
  }
  return value
}

function requireExactKeys(value, expected, label) {
  const actual = Object.keys(requireObject(value, label)).sort()
  const wanted = [...expected].sort()
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(`${label} keys must be exactly: ${wanted.join(', ')}`)
  }
}

function requireSha256(value, label) {
  if (!/^[0-9a-f]{64}$/.test(value ?? '')) {
    fail(`${label} must be 64 lowercase hexadecimal characters`)
  }
  return value
}

function requireCommit(value, label) {
  if (!/^[0-9a-f]{40}$/.test(value ?? '')) {
    fail(`${label} must be a full lowercase commit SHA`)
  }
  return value
}

function requirePositiveInteger(value, label) {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(number) || number <= 0) {
    fail(`${label} must be a positive integer`)
  }
  return number
}

function timestamp(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    fail(`${label} must be an ISO-8601 timestamp`)
  }
  const milliseconds = Date.parse(value)
  if (!Number.isFinite(milliseconds)) fail(`${label} must be an ISO-8601 timestamp`)
  return milliseconds
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    )
  }
  return value
}

function canonicalJson(value) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`
}

function sameJson(actual, expected, label) {
  if (!isDeepStrictEqual(actual, expected)) fail(`${label} does not match the reviewed contract`)
}

function sha256Bytes(value) {
  return createHash('sha256').update(value).digest('hex')
}

function readRegularFile(file, label) {
  const stat = fs.lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0) {
    fail(`${label} must be a non-empty regular file`)
  }
  return fs.readFileSync(file)
}

function readJson(file, label) {
  try {
    return JSON.parse(readRegularFile(file, label).toString('utf8'))
  } catch (error) {
    fail(`${label} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function sha256File(file) {
  return sha256Bytes(readRegularFile(file, `SHA-256 input ${file}`))
}

function writeCanonical(file, value) {
  const resolved = path.resolve(file)
  if (fs.existsSync(resolved) && fs.lstatSync(resolved).isSymbolicLink()) {
    fail(`Refusing to replace symbolic link: ${resolved}`)
  }
  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  const temporary = `${resolved}.tmp-${process.pid}`
  fs.writeFileSync(temporary, canonicalJson(value), { flag: 'wx', mode: 0o600 })
  fs.renameSync(temporary, resolved)
}

function validateCandidate(candidate, state, requirePinned) {
  requireExactKeys(
    candidate,
    [
      'version',
      'tag',
      'sourceCommit',
      'migrationPhase',
      'dataSchema',
      'manifestKey',
      'manifestSha256',
      'assets',
    ],
    'policy.candidate',
  )
  for (const key of [
    'version',
    'tag',
    'sourceCommit',
    'migrationPhase',
    'dataSchema',
    'manifestKey',
  ]) {
    sameJson(candidate[key], CANDIDATE_STATIC[key], `policy.candidate.${key}`)
  }
  requireCommit(candidate.sourceCommit, 'policy.candidate.sourceCommit')
  requireExactKeys(candidate.assets, PLATFORMS, 'policy.candidate.assets')
  for (const platform of PLATFORMS) {
    requireExactKeys(
      candidate.assets[platform],
      ['name', 'sha256'],
      `policy.candidate.assets.${platform}`,
    )
    sameJson(
      candidate.assets[platform].name,
      CANDIDATE_STATIC.assets[platform].name,
      `policy.candidate.assets.${platform}.name`,
    )
  }
  const pins = [
    candidate.manifestSha256,
    ...PLATFORMS.map((platform) => candidate.assets[platform].sha256),
  ]
  const nullPins = pins.filter((value) => value === null).length
  if (state === 'awaiting-candidate-pin') {
    if (nullPins !== pins.length) {
      fail('awaiting direct qualification policy may not contain partial release hashes')
    }
    if (requirePinned) {
      fail('direct qualification requires policy.state=candidate-pinned')
    }
    return false
  }
  if (state !== 'candidate-pinned') {
    fail('direct qualification policy state is unsupported')
  }
  if (nullPins !== 0) fail('direct qualification candidate pin is partial')
  requireSha256(candidate.manifestSha256, 'policy.candidate.manifestSha256')
  for (const platform of PLATFORMS) {
    requireSha256(
      candidate.assets[platform].sha256,
      `policy.candidate.assets.${platform}.sha256`,
    )
  }
  return true
}

export function validateDirectQualificationPolicy(
  policy,
  { requirePinned = false } = {},
) {
  requireExactKeys(
    policy,
    ['schema', 'state', 'deploymentMode', 'workflow', 'candidate', 'sources', 'lanes'],
    'direct qualification policy',
  )
  if (
    policy.schema !== 1
    || !['awaiting-candidate-pin', 'candidate-pinned'].includes(policy.state)
    || policy.deploymentMode !== 'direct-c'
  ) {
    fail('direct qualification policy identity is invalid')
  }
  sameJson(policy.workflow, WORKFLOW, 'policy.workflow')
  sameJson(policy.sources, SOURCES, 'policy.sources')
  sameJson(policy.lanes, LANES, 'policy.lanes')
  validateCandidate(policy.candidate, policy.state, requirePinned)
  return policy
}

export function loadDirectQualificationPolicy(
  file = POLICY_FILE,
  options = {},
) {
  return validateDirectQualificationPolicy(
    readJson(path.resolve(file), 'direct qualification policy'),
    options,
  )
}

function laneById(policy, laneId) {
  const matches = policy.lanes.filter((lane) => lane.id === laneId)
  if (matches.length !== 1) fail(`qualification lane must exist exactly once: ${laneId}`)
  return matches[0]
}

function workflowMatrixLane(lane) {
  return {
    lane: lane.id,
    platform: lane.platform,
    runner: lane.runner,
    scenario: lane.scenario,
    source_version: lane.sourceVersion ?? '',
    source_role: lane.sourceRole ?? '',
    snapshot: lane.snapshot,
  }
}

export function resolveDirectQualificationScope(policy, focusedLane) {
  validateDirectQualificationPolicy(policy, { requirePinned: true })
  const focusedLanes = [
    'current-to-c-windows',
    'legacy-manual-to-c-windows',
    'legacy-auto-to-c-windows',
  ]
  if (!['full', ...focusedLanes].includes(focusedLane)) {
    fail(
      'focused qualification lane must be exactly full, current-to-c-windows, legacy-manual-to-c-windows, or legacy-auto-to-c-windows',
    )
  }
  const lanes =
    focusedLane === 'full'
      ? policy.lanes
      : [laneById(policy, focusedLane)]
  return {
    qualificationMatrix: {
      include: lanes.map(workflowMatrixLane),
    },
    fullMode: focusedLane === 'full',
  }
}

function expectedInstallSequence(lane) {
  if (lane.scenario === 'fresh-c') return ['c']
  return [lane.sourceRole, 'c']
}

function qualificationMode(policy, lane) {
  if (lane.scenario === 'fresh-c') return 'fresh-install'
  return policy.sources[lane.sourceVersion]?.qualificationMode ?? 'automatic-updater'
}

function validateMigrationReport(report, lane) {
  requireExactKeys(
    report,
    ['schema', 'platform', 'scenarios', 'status', 'matrix'],
    `${lane.id} migration report`,
  )
  if (
    report.schema !== 1
    || report.platform !== lane.platform
    || report.status !== 'passed'
  ) {
    fail(`${lane.id} migration report identity/status is invalid`)
  }
  sameJson(report.scenarios, [lane.scenario], `${lane.id} migration scenarios`)
  if (!Array.isArray(report.matrix) || report.matrix.length !== 1) {
    fail(`${lane.id} migration report must contain exactly one result`)
  }
  const result = report.matrix[0]
  requireExactKeys(
    result,
    [
      'scenario',
      'platform',
      'snapshot',
      'installSequence',
      'expectedPhase',
      'status',
      'durationSeconds',
    ],
    `${lane.id} migration result`,
  )
  if (
    result.scenario !== lane.scenario
    || result.platform !== lane.platform
    || result.snapshot !== lane.snapshot
    || result.expectedPhase !== 'c'
    || result.status !== 'passed'
  ) {
    fail(`${lane.id} migration result does not match its approved lane`)
  }
  sameJson(
    result.installSequence,
    expectedInstallSequence(lane),
    `${lane.id} install sequence`,
  )
  if (
    typeof result.durationSeconds !== 'number'
    || !Number.isFinite(result.durationSeconds)
    || result.durationSeconds < 0
  ) {
    fail(`${lane.id} durationSeconds must be non-negative and finite`)
  }
}

function expectedInstallerDigests(policy, lane) {
  const expected = {
    c: { sha256: policy.candidate.assets[lane.platform].sha256 },
  }
  if (lane.sourceVersion !== null) {
    expected[lane.sourceRole] = {
      sha256: policy.sources[lane.sourceVersion].assets[lane.platform].sha256,
    }
  }
  return expected
}

function expectedRestoreRoot(lane) {
  return ['0.6.608', '0.6.611'].includes(lane.sourceVersion)
    ? LEGACY_DATA_ROOTS[lane.platform]
    : BIYAN_DATA_ROOTS[lane.platform]
}

function expectedPhaseExpectations(lane) {
  const values = [
    `${BIYAN_CONFIG_ROOTS[lane.platform]}/migration-state.json`,
    ...(lane.scenario === 'fresh-c'
      ? []
      : [`${BIYAN_DATA_ROOTS[lane.platform]}/${MARKER_PATH}`]),
  ]
  const phases = [
    ...(['a', 'b'].includes(lane.sourceRole) ? [lane.sourceRole] : []),
    'c',
  ]
  return Object.fromEntries(phases.map((phase) => [phase, values]))
}

function expectedSourceReadiness(lane) {
  return lane.id === 'current-to-c-windows'
    ? CURRENT_WINDOWS_SOURCE_READINESS
    : null
}

function validateInputManifest(manifest, snapshotSha256, policy, lane) {
  requireExactKeys(
    manifest,
    [
      'schema',
      'sanitized',
      'platform',
      'scenario',
      'qualificationMode',
      'lane',
      'installers',
      'snapshots',
      'expectations',
      'sourceReadiness',
    ],
    `${lane.id} input manifest`,
  )
  if (
    manifest.schema !== 1
    || manifest.sanitized !== true
    || manifest.platform !== lane.platform
    || manifest.scenario !== lane.scenario
    || manifest.qualificationMode !== qualificationMode(policy, lane)
    || manifest.lane !== lane.id
  ) {
    fail(`${lane.id} input manifest identity is invalid`)
  }
  sameJson(
    manifest.installers,
    expectedInstallerDigests(policy, lane),
    `${lane.id} installer digests`,
  )
  requireExactKeys(manifest.snapshots, [lane.snapshot], `${lane.id} snapshots`)
  const snapshot = manifest.snapshots[lane.snapshot]
  requireExactKeys(
    snapshot,
    ['archive', 'sha256', 'restore_to'],
    `${lane.id} snapshot`,
  )
  if (
    snapshot.archive !== `snapshots/${lane.snapshot}.zip`
    || snapshot.sha256 !== snapshotSha256
    || snapshot.restore_to !== expectedRestoreRoot(lane)
  ) {
    fail(`${lane.id} snapshot binding is invalid`)
  }
  sameJson(
    manifest.expectations,
    expectedPhaseExpectations(lane),
    `${lane.id} expectations`,
  )
  sameJson(
    manifest.sourceReadiness,
    expectedSourceReadiness(lane),
    `${lane.id} sourceReadiness`,
  )
}

export function buildDirectQualificationLaneResult({
  policy,
  laneId,
  migrationReport,
  migrationReportSha256,
  inputManifest,
  inputManifestSha256,
  snapshotSha256,
  runId,
  runAttempt,
  harnessSha256,
  startedAt,
  completedAt,
}) {
  validateDirectQualificationPolicy(policy, { requirePinned: true })
  const lane = laneById(policy, laneId)
  validateMigrationReport(migrationReport, lane)
  validateInputManifest(inputManifest, snapshotSha256, policy, lane)
  requireSha256(migrationReportSha256, `${lane.id} migration report SHA-256`)
  requireSha256(inputManifestSha256, `${lane.id} input manifest SHA-256`)
  requireSha256(snapshotSha256, `${lane.id} snapshot SHA-256`)
  requireSha256(harnessSha256, `${lane.id} harness SHA-256`)
  const start = timestamp(startedAt, `${lane.id} startedAt`)
  const complete = timestamp(completedAt, `${lane.id} completedAt`)
  if (complete < start) fail(`${lane.id} completedAt precedes startedAt`)

  return {
    schema: 1,
    type: 'biyan-direct-qualification-lane',
    lane: lane.id,
    platform: lane.platform,
    runner: lane.runner,
    scenario: lane.scenario,
    qualificationMode: qualificationMode(policy, lane),
    sourceVersion: lane.sourceVersion,
    sourceRole: lane.sourceRole,
    status: 'passed',
    candidateTag: policy.candidate.tag,
    candidateVersion: policy.candidate.version,
    sourceCommit: policy.candidate.sourceCommit,
    candidateManifestSha256: policy.candidate.manifestSha256,
    runId: requirePositiveInteger(runId, `${lane.id} run ID`),
    runAttempt: requirePositiveInteger(runAttempt, `${lane.id} run attempt`),
    harnessSha256,
    startedAt: new Date(start).toISOString(),
    completedAt: new Date(complete).toISOString(),
    migrationReportSha256,
    inputManifestSha256,
    snapshotSha256,
  }
}

export function buildFocusedDiagnosticSummary({
  policy,
  laneId,
  runId,
  runAttempt,
  qualificationOutcome,
}) {
  validateDirectQualificationPolicy(policy, { requirePinned: true })
  const lane = laneById(policy, laneId)
  if (
    ![
      'current-to-c-windows',
      'legacy-manual-to-c-windows',
      'legacy-auto-to-c-windows',
    ].includes(lane.id)
  ) {
    fail(
      'focused diagnostic summary is restricted to current-to-c-windows, legacy-manual-to-c-windows, or legacy-auto-to-c-windows',
    )
  }
  if (
    !['success', 'failure', 'cancelled', 'skipped'].includes(
      qualificationOutcome,
    )
  ) {
    fail('focused diagnostic qualification outcome is unsupported')
  }
  return {
    schema: 1,
    type: 'biyan-direct-qualification-focused-diagnostic',
    lane: lane.id,
    platform: lane.platform,
    scenario: lane.scenario,
    sourceVersion: lane.sourceVersion,
    candidateTag: policy.candidate.tag,
    candidateVersion: policy.candidate.version,
    sourceCommit: policy.candidate.sourceCommit,
    runId: requirePositiveInteger(runId, 'focused diagnostic run ID'),
    runAttempt: requirePositiveInteger(
      runAttempt,
      'focused diagnostic run attempt',
    ),
    qualificationOutcome,
    promotionEligible: false,
  }
}

function validateRunReceipt(receipt, policy) {
  requireExactKeys(receipt, ['harnessSha256', 'run'], 'qualification run receipt')
  const harnessSha256 = requireSha256(
    receipt.harnessSha256,
    'qualification run harness SHA-256',
  )
  const run = requireObject(receipt.run, 'qualification GitHub run')
  if (
    run.name !== policy.workflow.name
    || run.path !== policy.workflow.path
    || run.event !== 'workflow_dispatch'
    || run.head_branch !== LIVE_BRANCH
  ) {
    fail('qualification receipt is not from the exact direct qualification workflow')
  }
  const runId = requirePositiveInteger(run.id, 'qualification GitHub run ID')
  const runAttempt = requirePositiveInteger(
    run.run_attempt,
    'qualification GitHub run attempt',
  )
  requireCommit(run.head_sha, 'qualification GitHub run head SHA')
  if (
    run.repository?.full_name !== REPOSITORY
    || run.head_repository?.full_name !== REPOSITORY
    || run.repository?.id !== run.head_repository?.id
  ) {
    fail('qualification run must use the canonical repository head')
  }
  requirePositiveInteger(run.repository?.id, 'qualification repository ID')
  const live = run.status === 'in_progress' && run.conclusion == null
  const replay = run.status === 'completed' && run.conclusion === 'success'
  if (!live && !replay) fail('qualification run must be live or completed successfully')
  return {
    harnessSha256,
    run,
    runId,
    runAttempt,
    runStartedAt: timestamp(run.run_started_at, 'qualification run_started_at'),
  }
}

function validateLaneResult(result, policy, lane, runReceipt) {
  requireExactKeys(
    result,
    [
      'schema',
      'type',
      'lane',
      'platform',
      'runner',
      'scenario',
      'qualificationMode',
      'sourceVersion',
      'sourceRole',
      'status',
      'candidateTag',
      'candidateVersion',
      'sourceCommit',
      'candidateManifestSha256',
      'runId',
      'runAttempt',
      'harnessSha256',
      'startedAt',
      'completedAt',
      'migrationReportSha256',
      'inputManifestSha256',
      'snapshotSha256',
    ],
    `${lane.id} lane result`,
  )
  const expected = {
    schema: 1,
    type: 'biyan-direct-qualification-lane',
    lane: lane.id,
    platform: lane.platform,
    runner: lane.runner,
    scenario: lane.scenario,
    qualificationMode: qualificationMode(policy, lane),
    sourceVersion: lane.sourceVersion,
    sourceRole: lane.sourceRole,
    status: 'passed',
    candidateTag: policy.candidate.tag,
    candidateVersion: policy.candidate.version,
    sourceCommit: policy.candidate.sourceCommit,
    candidateManifestSha256: policy.candidate.manifestSha256,
    runId: runReceipt.runId,
    runAttempt: runReceipt.runAttempt,
    harnessSha256: runReceipt.harnessSha256,
  }
  for (const [key, value] of Object.entries(expected)) {
    sameJson(result[key], value, `${lane.id}.${key}`)
  }
  for (const key of [
    'migrationReportSha256',
    'inputManifestSha256',
    'snapshotSha256',
  ]) {
    requireSha256(result[key], `${lane.id}.${key}`)
  }
  const started = timestamp(result.startedAt, `${lane.id}.startedAt`)
  const completed = timestamp(result.completedAt, `${lane.id}.completedAt`)
  if (started < runReceipt.runStartedAt - 60_000 || completed < started) {
    fail(`${lane.id} result timing is invalid`)
  }
  return { started, completed }
}

function selectArtifact(artifacts, lane, runReceipt) {
  const name = `direct-qualification-${lane.id}-${runReceipt.runId}-${runReceipt.runAttempt}`
  const matches = artifacts.filter((artifact) => artifact.name === name)
  if (matches.length !== 1) fail(`${lane.id} must have exactly one GitHub artifact`)
  const artifact = matches[0]
  const digest = /^sha256:([0-9a-f]{64})$/.exec(artifact.digest ?? '')
  if (
    artifact.expired !== false
    || !Number.isSafeInteger(artifact.size_in_bytes)
    || artifact.size_in_bytes <= 0
    || !digest
  ) {
    fail(`${lane.id} GitHub artifact metadata is invalid`)
  }
  const workflowRun = requireObject(
    artifact.workflow_run,
    `${lane.id} artifact workflow_run`,
  )
  if (
    workflowRun.id !== runReceipt.runId
    || workflowRun.repository_id !== runReceipt.run.repository.id
    || workflowRun.head_repository_id !== runReceipt.run.repository.id
    || workflowRun.head_branch !== LIVE_BRANCH
    || workflowRun.head_sha !== runReceipt.run.head_sha
  ) {
    fail(`${lane.id} artifact is not bound to the exact qualification run`)
  }
  const createdAt = timestamp(artifact.created_at, `${lane.id} artifact created_at`)
  return {
    id: requirePositiveInteger(artifact.id, `${lane.id} artifact ID`),
    name,
    sha256: digest[1],
    createdAt,
  }
}

function aggregateFile(inputDir, lane, suffix) {
  const root = `${path.resolve(inputDir)}${path.sep}`
  const file = path.resolve(inputDir, `${lane.id}${suffix}`)
  if (!file.startsWith(root)) fail(`${lane.id} aggregate path escaped input-dir`)
  return file
}

export function aggregateDirectQualificationEvidence({
  policy,
  inputDir,
  runReceipt,
  artifactsResponse,
}) {
  validateDirectQualificationPolicy(policy, { requirePinned: true })
  const receipt = validateRunReceipt(runReceipt, policy)
  const artifacts = artifactsResponse?.artifacts
  if (!Array.isArray(artifacts)) fail('GitHub artifacts response must contain an artifacts array')
  const results = []
  const artifactDigests = {}
  let completedAt = 0

  for (const lane of policy.lanes) {
    const resultFile = aggregateFile(inputDir, lane, '.json')
    const migrationFile = aggregateFile(inputDir, lane, '-migration.json')
    const manifestFile = aggregateFile(inputDir, lane, '-manifest.json')
    const snapshotFile = aggregateFile(inputDir, lane, '-snapshot.zip')
    const result = readJson(resultFile, `${lane.id} lane result`)
    const timing = validateLaneResult(result, policy, lane, receipt)
    if (sha256File(migrationFile) !== result.migrationReportSha256) {
      fail(`${lane.id} raw migration report SHA-256 mismatch`)
    }
    const migrationReport = readJson(migrationFile, `${lane.id} migration report`)
    validateMigrationReport(migrationReport, lane)
    if (sha256File(manifestFile) !== result.inputManifestSha256) {
      fail(`${lane.id} raw input manifest SHA-256 mismatch`)
    }
    if (sha256File(snapshotFile) !== result.snapshotSha256) {
      fail(`${lane.id} raw snapshot SHA-256 mismatch`)
    }
    validateInputManifest(
      readJson(manifestFile, `${lane.id} input manifest`),
      result.snapshotSha256,
      policy,
      lane,
    )
    const artifact = selectArtifact(artifacts, lane, receipt)
    if (timing.completed > artifact.createdAt + 60_000) {
      fail(`${lane.id} result completed after its artifact was created`)
    }
    completedAt = Math.max(completedAt, artifact.createdAt)
    artifactDigests[lane.id] = {
      id: artifact.id,
      name: artifact.name,
      sha256: artifact.sha256,
    }
    results.push({
      lane: lane.id,
      platform: lane.platform,
      scenario: lane.scenario,
      qualificationMode: qualificationMode(policy, lane),
      sourceVersion: lane.sourceVersion,
      status: 'passed',
      runId: receipt.runId,
      runAttempt: receipt.runAttempt,
      migrationReportSha256: result.migrationReportSha256,
      inputManifestSha256: result.inputManifestSha256,
      snapshotSha256: result.snapshotSha256,
      artifactSha256: artifact.sha256,
    })
  }

  if (results.length !== 16 || results.some((result) => result.status !== 'passed')) {
    fail('direct qualification requires exactly 16 passed lanes')
  }
  const qualificationMatrixSha256 = sha256Bytes(
    Buffer.from(canonicalJson(policy.lanes)),
  )
  const common = {
    candidateTag: policy.candidate.tag,
    sourceCommit: policy.candidate.sourceCommit,
    candidateManifestSha256: policy.candidate.manifestSha256,
    observationScope: 'github-native-direct-qualification',
    deploymentMode: 'direct-c',
    sampleSize: 16,
    attempts: 16,
    passedAttempts: 16,
    failedAttempts: 0,
    harnessSha256: receipt.harnessSha256,
    qualificationMatrixSha256,
  }
  const completedAtIso = new Date(completedAt).toISOString()
  const smoke = {
    schema: 1,
    type: 'upgrade-smoke',
    status: 'passed',
    ...common,
    currentVersion: '0.6.633',
    automaticUpgradeFloor: '0.6.611',
    manualCompatibilityFloor: '0.6.608',
    candidateVersion: policy.candidate.version,
    platforms: [...PLATFORMS],
    scenarios: [
      'legacy-manual-to-c',
      'legacy-auto-to-c',
      'current-to-c',
      'fresh-c',
      'a-to-c',
      'b-to-c',
      'c-to-c',
    ],
    sourceVersions: [
      '0.6.608',
      '0.6.611',
      '0.6.633',
      '0.6.643',
      '0.6.644',
      '0.6.645',
    ],
    completedAt: completedAtIso,
    workflow: {
      name: policy.workflow.name,
      path: policy.workflow.path,
      runId: receipt.runId,
      runAttempt: receipt.runAttempt,
      headSha: receipt.run.head_sha,
    },
    artifactDigests,
    results,
  }
  const health = {
    schema: 1,
    type: 'rollout-health',
    status: 'healthy',
    ...common,
    p0Incidents: 0,
    p1Incidents: 0,
    dataLossIncidents: 0,
    migrationFailureRate: 0,
    observedAt: completedAtIso,
  }
  return { smoke, health }
}

function parseOptions(values, allowed, required) {
  if (values.length % 2 !== 0) fail(`Missing value for ${values.at(-1)}`)
  const options = {}
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index]
    if (!flag?.startsWith('--')) fail(`Unexpected argument: ${flag}`)
    const key = flag.slice(2)
    if (!allowed.includes(key)) fail(`Unsupported option: ${flag}`)
    if (options[key] !== undefined) fail(`Duplicate option: ${flag}`)
    options[key] = values[index + 1]
  }
  for (const key of required) {
    if (options[key] === undefined || options[key] === '') {
      fail(`Missing required option: --${key}`)
    }
  }
  return options
}

function laneResultCommand(values) {
  const required = [
    'policy',
    'lane',
    'migration-report',
    'input-manifest',
    'snapshot',
    'run-id',
    'run-attempt',
    'harness-sha256',
    'started-at',
    'completed-at',
    'output',
  ]
  const options = parseOptions(values, required, required)
  const migrationFile = path.resolve(options['migration-report'])
  const manifestFile = path.resolve(options['input-manifest'])
  const snapshotFile = path.resolve(options.snapshot)
  const result = buildDirectQualificationLaneResult({
    policy: loadDirectQualificationPolicy(options.policy, { requirePinned: true }),
    laneId: options.lane,
    migrationReport: readJson(migrationFile, 'migration report'),
    migrationReportSha256: sha256File(migrationFile),
    inputManifest: readJson(manifestFile, 'input manifest'),
    inputManifestSha256: sha256File(manifestFile),
    snapshotSha256: sha256File(snapshotFile),
    runId: options['run-id'],
    runAttempt: options['run-attempt'],
    harnessSha256: options['harness-sha256'],
    startedAt: options['started-at'],
    completedAt: options['completed-at'],
  })
  writeCanonical(options.output, result)
  process.stdout.write(`${JSON.stringify({
    output: path.resolve(options.output),
    sha256: sha256File(path.resolve(options.output)),
  })}\n`)
}

function aggregateCommand(values) {
  const required = [
    'policy',
    'input-dir',
    'run-receipt',
    'artifacts',
    'output-dir',
  ]
  const options = parseOptions(values, required, required)
  const outputDir = path.resolve(options['output-dir'])
  const evidence = aggregateDirectQualificationEvidence({
    policy: loadDirectQualificationPolicy(options.policy, { requirePinned: true }),
    inputDir: path.resolve(options['input-dir']),
    runReceipt: readJson(path.resolve(options['run-receipt']), 'run receipt'),
    artifactsResponse: readJson(path.resolve(options.artifacts), 'artifacts response'),
  })
  const smokeFile = path.join(outputDir, 'upgrade-smoke.json')
  const healthFile = path.join(outputDir, 'rollout-health.json')
  writeCanonical(smokeFile, evidence.smoke)
  writeCanonical(healthFile, evidence.health)
  process.stdout.write(`${JSON.stringify({
    smoke: { file: smokeFile, sha256: sha256File(smokeFile) },
    health: { file: healthFile, sha256: sha256File(healthFile) },
  })}\n`)
}

function qualificationScopeCommand(values) {
  const options = parseOptions(
    values,
    ['policy', 'focused-lane'],
    ['policy', 'focused-lane'],
  )
  const scope = resolveDirectQualificationScope(
    loadDirectQualificationPolicy(options.policy, { requirePinned: true }),
    options['focused-lane'],
  )
  process.stdout.write(
    `qualification_matrix=${JSON.stringify(scope.qualificationMatrix)}\n`,
  )
  process.stdout.write(`full_mode=${scope.fullMode ? 'true' : 'false'}\n`)
}

function diagnosticSummaryCommand(values) {
  const required = [
    'policy',
    'lane',
    'run-id',
    'run-attempt',
    'qualification-outcome',
    'output',
  ]
  const options = parseOptions(values, required, required)
  const summary = buildFocusedDiagnosticSummary({
    policy: loadDirectQualificationPolicy(options.policy, {
      requirePinned: true,
    }),
    laneId: options.lane,
    runId: options['run-id'],
    runAttempt: options['run-attempt'],
    qualificationOutcome: options['qualification-outcome'],
  })
  writeCanonical(options.output, summary)
  process.stdout.write(
    `${JSON.stringify({
      lane: summary.lane,
      qualificationOutcome: summary.qualificationOutcome,
      promotionEligible: summary.promotionEligible,
    })}\n`,
  )
}

function main(argv) {
  const [command, ...values] = argv
  if (command === 'validate-policy') {
    const options = parseOptions(values, ['policy'], ['policy'])
    loadDirectQualificationPolicy(options.policy, { requirePinned: true })
    return
  }
  if (command === 'qualification-scope') {
    return qualificationScopeCommand(values)
  }
  if (command === 'diagnostic-summary') {
    return diagnosticSummaryCommand(values)
  }
  if (command === 'lane-result') return laneResultCommand(values)
  if (command === 'aggregate') return aggregateCommand(values)
  fail(
    'Usage: direct-qualification-evidence.mjs <validate-policy|qualification-scope|diagnostic-summary|lane-result|aggregate> [options]',
  )
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
