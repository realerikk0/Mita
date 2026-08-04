#!/usr/bin/env node

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  validateCanonicalUpdaterCandidateMetadata,
  validateCanonicalUpdaterManifest,
} from './candidate-url-policy.mjs'
import {
  decodeUpdaterPublicKey,
  verifyUpdaterSignature,
} from './minisign-policy.mjs'

const REPOSITORY = 'realerikk0/Mita'
const LIVE_BRANCH = 'mita-main'
const SCENARIO = 'source-to-recovery'
const CONTRACT_TYPE = 'biyan-recovery-qualification-contract'
const WORKFLOW = {
  name: 'Biyan Upgrade Smoke',
  path: '.github/workflows/biyan-upgrade-smoke.yml',
}
const PLATFORMS = ['windows', 'macos', 'linux']
const RUNNERS = {
  windows: 'windows-2022',
  macos: 'macos-15-intel',
  linux: 'ubuntu-24.04',
}
const HARNESS_PATHS = [
  '.github/workflows/biyan-upgrade-smoke.yml',
  'autoqa/migration_runner.py',
  'scripts/updater/prepare-recovery-qualification-inputs.py',
  'scripts/updater/recovery-qualification-evidence.mjs',
].sort()
const BIYAN_CONFIG_ROOTS = {
  windows: '%APPDATA%/Biyan',
  macos: '$HOME/Library/Application Support/Biyan',
  linux: '$HOME/.local/share/Biyan',
}
const BIYAN_DATA_ROOTS = Object.fromEntries(
  Object.entries(BIYAN_CONFIG_ROOTS).map(([platform, root]) => [
    platform,
    `${root}/data`,
  ]),
)
const MARKER_PATH =
  'agent-workspaces/recovery-qualification-preserved.txt'

function fail(message) {
  throw new Error(message)
}

function requireObject(value, label) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    fail(`${label} must be an object`)
  }
  return value
}

function requireExactKeys(value, expected, label) {
  requireObject(value, label)
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    fail(
      `${label} keys must be exactly ${wanted.join(', ')}; found ${
        actual.join(', ') || '(none)'
      }`,
    )
  }
}

function requireSha256(value, label) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    fail(`${label} must be a lowercase SHA-256`)
  }
  return value
}

function requireCommit(value, label) {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/.test(value)) {
    fail(`${label} must be a lowercase commit SHA`)
  }
  return value
}

function requirePositiveInteger(value, label) {
  const parsed =
    typeof value === 'string' && /^[1-9][0-9]*$/.test(value)
      ? Number(value)
      : value
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    fail(`${label} must be a positive integer`)
  }
  return parsed
}

function timestamp(value, label) {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN
  const normalized = Number.isFinite(parsed)
    ? new Date(parsed).toISOString()
    : ''
  const githubSeconds =
    normalized.endsWith('.000Z') ? normalized.replace('.000Z', 'Z') : ''
  if (
    typeof value !== 'string' ||
    !value ||
    !Number.isFinite(parsed) ||
    (value !== normalized && value !== githubSeconds)
  ) {
    fail(`${label} must be canonical ISO-8601`)
  }
  return parsed
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
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

function contractDigest(contract) {
  return sha256Bytes(Buffer.from(canonicalJson(contract)))
}

function sameJson(actual, expected, label) {
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    fail(`${label} does not match the reviewed recovery contract`)
  }
}

function sha256Bytes(value) {
  return createHash('sha256').update(value).digest('hex')
}

function readRegularFile(file, label) {
  let metadata
  try {
    metadata = fs.lstatSync(file)
  } catch {
    fail(`${label} is missing`)
  }
  if (
    metadata.isSymbolicLink() ||
    !metadata.isFile() ||
    metadata.size === 0
  ) {
    fail(`${label} must be a non-empty regular file`)
  }
  return fs.readFileSync(file)
}

function readJson(file, label) {
  try {
    return JSON.parse(readRegularFile(file, label).toString('utf8'))
  } catch (error) {
    fail(
      `${label} is invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
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
  fs.writeFileSync(temporary, canonicalJson(value), {
    flag: 'wx',
    mode: 0o600,
  })
  fs.renameSync(temporary, resolved)
}

function semverParts(value, label) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value ?? '')
  if (!match) fail(`${label} must be a stable semantic version`)
  return match.slice(1).map(Number)
}

function compareSemver(left, right) {
  const a = semverParts(left, 'left version')
  const b = semverParts(right, 'right version')
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1
  }
  return 0
}

function expectedAssetName(platform, version) {
  if (platform === 'windows') {
    return `Biyan_${version}_x64-setup.exe`
  }
  if (platform === 'macos') return `Biyan_${version}_universal.dmg`
  if (platform === 'linux') return `Biyan_${version}_amd64.AppImage`
  fail(`Unsupported recovery platform: ${platform}`)
}

function expectedLanes() {
  return PLATFORMS.map((platform) => ({
    id: `${SCENARIO}-${platform}`,
    platform,
    runner: RUNNERS[platform],
    scenario: SCENARIO,
    sourceRole: 'current',
    snapshot: 'current',
  }))
}

function validateDistributionAssets(candidate, label) {
  const assets = requireObject(
    candidate.distributionAssets,
    `${label}.distributionAssets`,
  )
  const expected = {
    macosDmg: `Biyan_${candidate.version}_universal.dmg`,
    windowsExe: `Biyan_${candidate.version}_x64-setup.exe`,
    windowsMsi: `Biyan_${candidate.version}_x64_en-US.msi`,
    linuxAppImage: `Biyan_${candidate.version}_amd64.AppImage`,
    linuxDeb: `Biyan_${candidate.version}_amd64.deb`,
  }
  requireExactKeys(assets, Object.keys(expected), `${label}.distributionAssets`)
  for (const [key, name] of Object.entries(expected)) {
    const asset = requireObject(assets[key], `${label}.distributionAssets.${key}`)
    requireExactKeys(
      asset,
      ['file', 'sha256'],
      `${label}.distributionAssets.${key}`,
    )
    if (asset.file !== name) {
      fail(`${label}.distributionAssets.${key}.file is not canonical`)
    }
    requireSha256(asset.sha256, `${label}.distributionAssets.${key}.sha256`)
  }
  return {
    windows: {
      name: assets.windowsExe.file,
      sha256: assets.windowsExe.sha256,
    },
    macos: {
      name: assets.macosDmg.file,
      sha256: assets.macosDmg.sha256,
    },
    linux: {
      name: assets.linuxAppImage.file,
      sha256: assets.linuxAppImage.sha256,
    },
  }
}

function validateReleaseIdentity(value, label) {
  requireExactKeys(
    value,
    [
      'tag',
      'version',
      'sourceCommit',
      'migrationPhase',
      'dataSchema',
      'manifestSha256',
      'assets',
    ],
    label,
  )
  semverParts(value.version, `${label}.version`)
  if (
    value.tag !== `v${value.version}` ||
    value.migrationPhase !== 'C' ||
    value.dataSchema !== 3
  ) {
    fail(`${label} must be an exact terminal C/schema-3 release`)
  }
  requireCommit(value.sourceCommit, `${label}.sourceCommit`)
  requireSha256(value.manifestSha256, `${label}.manifestSha256`)
  requireExactKeys(value.assets, PLATFORMS, `${label}.assets`)
  for (const platform of PLATFORMS) {
    const asset = value.assets[platform]
    requireExactKeys(asset, ['name', 'sha256'], `${label}.assets.${platform}`)
    if (asset.name !== expectedAssetName(platform, value.version)) {
      fail(`${label}.assets.${platform}.name is not canonical`)
    }
    requireSha256(asset.sha256, `${label}.assets.${platform}.sha256`)
  }
  return value
}

function validateWorkflow(value) {
  requireExactKeys(
    value,
    [
      'name',
      'path',
      'headSha',
      'harnessPaths',
      'harnessSha256',
      'runId',
      'runAttempt',
    ],
    'contract.workflow',
  )
  if (value.name !== WORKFLOW.name || value.path !== WORKFLOW.path) {
    fail('contract.workflow identity is invalid')
  }
  requireCommit(value.headSha, 'contract.workflow.headSha')
  requireSha256(value.harnessSha256, 'contract.workflow.harnessSha256')
  requirePositiveInteger(value.runId, 'contract.workflow.runId')
  requirePositiveInteger(value.runAttempt, 'contract.workflow.runAttempt')
  sameJson(
    value.harnessPaths,
    HARNESS_PATHS,
    'contract.workflow.harnessPaths',
  )
  return value
}

export function validateRecoveryContract(contract) {
  requireExactKeys(
    contract,
    [
      'schema',
      'type',
      'deploymentMode',
      'scenario',
      'source',
      'candidate',
      'workflow',
      'lanes',
    ],
    'recovery qualification contract',
  )
  if (
    contract.schema !== 1 ||
    contract.type !== CONTRACT_TYPE ||
    contract.deploymentMode !== 'recovery' ||
    contract.scenario !== SCENARIO
  ) {
    fail('recovery qualification contract identity is invalid')
  }
  validateReleaseIdentity(contract.source, 'contract.source')
  validateReleaseIdentity(contract.candidate, 'contract.candidate')
  if (
    compareSemver(contract.candidate.version, contract.source.version) <= 0
  ) {
    fail('recovery candidate must be newer than its source')
  }
  if (contract.candidate.sourceCommit === contract.source.sourceCommit) {
    fail('recovery candidate must use a new source commit')
  }
  validateWorkflow(contract.workflow)
  sameJson(contract.lanes, expectedLanes(), 'contract.lanes')
  return contract
}

function trainReleaseIdentity(value, label, requireStatus) {
  const expected = [
    'tag',
    'version',
    'migrationPhase',
    'dataSchema',
    'sourceCommit',
    ...(requireStatus ? ['status'] : []),
  ]
  requireExactKeys(value, expected, label)
  const identity = {
    tag: value.tag,
    version: value.version,
    sourceCommit: value.sourceCommit,
    migrationPhase: value.migrationPhase,
    dataSchema: value.dataSchema,
  }
  semverParts(identity.version, `${label}.version`)
  if (
    identity.tag !== `v${identity.version}` ||
    identity.migrationPhase !== 'C' ||
    identity.dataSchema !== 3
  ) {
    fail(`${label} must be an exact terminal C/schema-3 release`)
  }
  requireCommit(identity.sourceCommit, `${label}.sourceCommit`)
  if (requireStatus && value.status !== 'published-superseded') {
    fail(`${label}.status must be published-superseded`)
  }
  return identity
}

function validateTrainPolicy(policy) {
  requireObject(policy, 'release train policy')
  if (
    policy.schema !== 4 ||
    policy.activeTrain !== null ||
    !Array.isArray(policy.supersededTerminalReleases)
  ) {
    fail('release train policy is not a closed schema-4 terminal policy')
  }
  const published = policy.supersededTerminalReleases.filter(
    (release) => release?.status === 'published-superseded',
  )
  if (published.length === 0) {
    fail('release train policy has no published-superseded source')
  }
  const source = trainReleaseIdentity(
    published.at(-1),
    'release train published source',
    true,
  )
  const candidate = trainReleaseIdentity(
    requireObject(
      policy.activeTerminalRelease,
      'release train active terminal release',
    ),
    'release train active terminal release',
    false,
  )
  if (compareSemver(candidate.version, source.version) <= 0) {
    fail('release train active terminal must be newer than the published source')
  }
  return { source, candidate }
}

function verifyReleaseMetadata({
  candidateFile,
  signatureFile,
  manifestFile,
  encodedPublicKey,
  label,
}) {
  const publicKey = decodeUpdaterPublicKey(encodedPublicKey)
  const encodedSignature = readRegularFile(
    signatureFile,
    `${label} candidate signature`,
  )
    .toString('utf8')
    .trim()
  verifyUpdaterSignature(
    candidateFile,
    encodedSignature,
    publicKey,
    `${label} candidate provenance`,
  )
  const candidate = readJson(candidateFile, `${label} candidate metadata`)
  validateCanonicalUpdaterCandidateMetadata(candidate)
  const manifestSha256 = sha256File(manifestFile)
  if (manifestSha256 !== candidate.manifestSha256) {
    fail(`${label} updater manifest SHA-256 does not match signed metadata`)
  }
  validateCanonicalUpdaterManifest(
    readJson(manifestFile, `${label} updater manifest`),
    candidate,
  )
  return {
    tag: candidate.tag,
    version: candidate.version,
    sourceCommit: candidate.sourceCommit,
    migrationPhase: candidate.migrationPhase,
    dataSchema: candidate.dataSchema,
    manifestSha256,
    assets: validateDistributionAssets(candidate, label),
  }
}

function sameTrainIdentity(release, train, label) {
  const actual = {
    tag: release.tag,
    version: release.version,
    sourceCommit: release.sourceCommit,
    migrationPhase: release.migrationPhase,
    dataSchema: release.dataSchema,
  }
  sameJson(actual, train, label)
}

export function buildRecoveryContract({
  trainPolicy,
  source,
  candidate,
  headSha,
  harnessSha256,
  runId,
  runAttempt,
}) {
  const train = validateTrainPolicy(trainPolicy)
  validateReleaseIdentity(source, 'source release')
  validateReleaseIdentity(candidate, 'candidate release')
  sameTrainIdentity(
    source,
    train.source,
    'source release versus published train source',
  )
  sameTrainIdentity(
    candidate,
    train.candidate,
    'candidate release versus active train terminal',
  )
  const contract = {
    schema: 1,
    type: CONTRACT_TYPE,
    deploymentMode: 'recovery',
    scenario: SCENARIO,
    source: structuredClone(source),
    candidate: structuredClone(candidate),
    workflow: {
      ...WORKFLOW,
      headSha: requireCommit(headSha, 'workflow head SHA'),
      harnessPaths: [...HARNESS_PATHS],
      harnessSha256: requireSha256(
        harnessSha256,
        'workflow harness SHA-256',
      ),
      runId: requirePositiveInteger(runId, 'workflow run ID'),
      runAttempt: requirePositiveInteger(
        runAttempt,
        'workflow run attempt',
      ),
    },
    lanes: expectedLanes(),
  }
  return validateRecoveryContract(contract)
}

function laneForPlatform(contract, platform) {
  if (!PLATFORMS.includes(platform)) {
    fail(`Unsupported recovery platform: ${platform}`)
  }
  const matches = contract.lanes.filter((lane) => lane.platform === platform)
  if (matches.length !== 1) {
    fail(`Recovery platform must have exactly one lane: ${platform}`)
  }
  return matches[0]
}

function validateInstaller(file, asset, label) {
  if (path.basename(file) !== asset.name) {
    fail(`${label} filename does not match the recovery contract`)
  }
  const digest = sha256File(file)
  if (digest !== asset.sha256) {
    fail(`${label} SHA-256 does not match the recovery contract`)
  }
  return digest
}

function validateMigrationReport(report, lane) {
  requireExactKeys(
    report,
    ['schema', 'platform', 'scenarios', 'status', 'matrix'],
    `${lane.id} migration report`,
  )
  if (
    report.schema !== 1 ||
    report.platform !== lane.platform ||
    report.status !== 'passed'
  ) {
    fail(`${lane.id} migration report identity/status is invalid`)
  }
  sameJson(report.scenarios, [SCENARIO], `${lane.id} migration scenarios`)
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
    result.scenario !== SCENARIO ||
    result.platform !== lane.platform ||
    result.snapshot !== 'current' ||
    result.expectedPhase !== 'c' ||
    result.status !== 'passed'
  ) {
    fail(`${lane.id} migration result does not match its recovery lane`)
  }
  sameJson(
    result.installSequence,
    ['current', 'c'],
    `${lane.id} install sequence`,
  )
  if (
    typeof result.durationSeconds !== 'number' ||
    !Number.isFinite(result.durationSeconds) ||
    result.durationSeconds < 0
  ) {
    fail(`${lane.id} durationSeconds must be non-negative and finite`)
  }
}

function expectedInputManifest(contract, platform, snapshotSha256) {
  return {
    schema: 1,
    sanitized: true,
    platform,
    scenario: SCENARIO,
    qualificationMode: 'automatic-updater',
    lane: `${SCENARIO}-${platform}`,
    installers: {
      current: {
        sha256: contract.source.assets[platform].sha256,
      },
      c: {
        sha256: contract.candidate.assets[platform].sha256,
      },
    },
    snapshots: {
      current: {
        archive: 'snapshots/current.zip',
        sha256: snapshotSha256,
        restore_to: BIYAN_DATA_ROOTS[platform],
      },
    },
    expectations: {
      c: [
        `${BIYAN_CONFIG_ROOTS[platform]}/migration-state.json`,
        `${BIYAN_DATA_ROOTS[platform]}/${MARKER_PATH}`,
      ],
    },
    sourceReadiness: null,
  }
}

function validateInputManifest(
  manifest,
  snapshotSha256,
  contract,
  platform,
) {
  sameJson(
    manifest,
    expectedInputManifest(contract, platform, snapshotSha256),
    `${SCENARIO}-${platform} input manifest`,
  )
}

export function buildRecoveryLaneResult({
  contract,
  platform,
  migrationReport,
  migrationReportSha256,
  inputManifest,
  inputManifestSha256,
  snapshotSha256,
  sourceInstallerSha256,
  candidateInstallerSha256,
  runId,
  runAttempt,
  headSha,
  harnessSha256,
  startedAt,
  completedAt,
}) {
  validateRecoveryContract(contract)
  const lane = laneForPlatform(contract, platform)
  validateMigrationReport(migrationReport, lane)
  validateInputManifest(inputManifest, snapshotSha256, contract, platform)
  requireSha256(migrationReportSha256, `${lane.id} migration report SHA-256`)
  requireSha256(inputManifestSha256, `${lane.id} input manifest SHA-256`)
  requireSha256(snapshotSha256, `${lane.id} snapshot SHA-256`)
  if (
    sourceInstallerSha256 !== contract.source.assets[platform].sha256 ||
    candidateInstallerSha256 !== contract.candidate.assets[platform].sha256
  ) {
    fail(`${lane.id} installer digests do not match the recovery contract`)
  }
  const exactRunId = requirePositiveInteger(runId, `${lane.id} run ID`)
  const exactRunAttempt = requirePositiveInteger(
    runAttempt,
    `${lane.id} run attempt`,
  )
  const exactHead = requireCommit(headSha, `${lane.id} head SHA`)
  const exactHarness = requireSha256(
    harnessSha256,
    `${lane.id} harness SHA-256`,
  )
  if (
    exactRunId !== contract.workflow.runId ||
    exactRunAttempt !== contract.workflow.runAttempt ||
    exactHead !== contract.workflow.headSha ||
    exactHarness !== contract.workflow.harnessSha256
  ) {
    fail(`${lane.id} execution identity does not match the recovery contract`)
  }
  const start = timestamp(startedAt, `${lane.id} startedAt`)
  const complete = timestamp(completedAt, `${lane.id} completedAt`)
  if (complete < start) fail(`${lane.id} completedAt precedes startedAt`)
  return {
    schema: 1,
    type: 'biyan-recovery-qualification-lane',
    lane: lane.id,
    platform,
    runner: lane.runner,
    scenario: SCENARIO,
    qualificationMode: 'automatic-updater',
    status: 'passed',
    sourceTag: contract.source.tag,
    sourceVersion: contract.source.version,
    sourceReleaseCommit: contract.source.sourceCommit,
    sourceManifestSha256: contract.source.manifestSha256,
    candidateTag: contract.candidate.tag,
    candidateVersion: contract.candidate.version,
    sourceCommit: contract.candidate.sourceCommit,
    candidateManifestSha256: contract.candidate.manifestSha256,
    runId: exactRunId,
    runAttempt: exactRunAttempt,
    headSha: exactHead,
    harnessSha256: exactHarness,
    contractSha256: contractDigest(contract),
    startedAt: new Date(start).toISOString(),
    completedAt: new Date(complete).toISOString(),
    migrationReportSha256,
    inputManifestSha256,
    snapshotSha256,
    sourceInstallerSha256,
    candidateInstallerSha256,
  }
}

function validateRunReceipt(receipt, contract) {
  requireExactKeys(receipt, ['harnessSha256', 'run'], 'recovery run receipt')
  if (receipt.harnessSha256 !== contract.workflow.harnessSha256) {
    fail('recovery run receipt harness SHA-256 does not match the contract')
  }
  const run = requireObject(receipt.run, 'recovery GitHub run')
  if (
    run.name !== WORKFLOW.name ||
    run.path !== WORKFLOW.path ||
    run.event !== 'workflow_dispatch' ||
    run.head_branch !== LIVE_BRANCH
  ) {
    fail('recovery receipt is not from the exact upgrade smoke workflow')
  }
  const runId = requirePositiveInteger(run.id, 'recovery GitHub run ID')
  const runAttempt = requirePositiveInteger(
    run.run_attempt,
    'recovery GitHub run attempt',
  )
  requireCommit(run.head_sha, 'recovery GitHub run head SHA')
  if (
    runId !== contract.workflow.runId ||
    runAttempt !== contract.workflow.runAttempt ||
    run.head_sha !== contract.workflow.headSha
  ) {
    fail('recovery GitHub run does not match the contract execution identity')
  }
  if (
    run.repository?.full_name !== REPOSITORY ||
    run.head_repository?.full_name !== REPOSITORY ||
    run.repository?.id !== run.head_repository?.id
  ) {
    fail('recovery run must use the canonical repository head')
  }
  requirePositiveInteger(run.repository?.id, 'recovery repository ID')
  const live = run.status === 'in_progress' && run.conclusion == null
  const replay = run.status === 'completed' && run.conclusion === 'success'
  if (!live && !replay) {
    fail('recovery run must be live or completed successfully')
  }
  return {
    run,
    runId,
    runAttempt,
    runStartedAt: timestamp(run.run_started_at, 'recovery run_started_at'),
  }
}

function validateLaneResult(result, contract, lane, receipt) {
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
      'status',
      'sourceTag',
      'sourceVersion',
      'sourceReleaseCommit',
      'sourceManifestSha256',
      'candidateTag',
      'candidateVersion',
      'sourceCommit',
      'candidateManifestSha256',
      'runId',
      'runAttempt',
      'headSha',
      'harnessSha256',
      'contractSha256',
      'startedAt',
      'completedAt',
      'migrationReportSha256',
      'inputManifestSha256',
      'snapshotSha256',
      'sourceInstallerSha256',
      'candidateInstallerSha256',
    ],
    `${lane.id} lane result`,
  )
  const expected = {
    schema: 1,
    type: 'biyan-recovery-qualification-lane',
    lane: lane.id,
    platform: lane.platform,
    runner: lane.runner,
    scenario: SCENARIO,
    qualificationMode: 'automatic-updater',
    status: 'passed',
    sourceTag: contract.source.tag,
    sourceVersion: contract.source.version,
    sourceReleaseCommit: contract.source.sourceCommit,
    sourceManifestSha256: contract.source.manifestSha256,
    candidateTag: contract.candidate.tag,
    candidateVersion: contract.candidate.version,
    sourceCommit: contract.candidate.sourceCommit,
    candidateManifestSha256: contract.candidate.manifestSha256,
    runId: receipt.runId,
    runAttempt: receipt.runAttempt,
    headSha: contract.workflow.headSha,
    harnessSha256: contract.workflow.harnessSha256,
    contractSha256: contractDigest(contract),
    sourceInstallerSha256: contract.source.assets[lane.platform].sha256,
    candidateInstallerSha256:
      contract.candidate.assets[lane.platform].sha256,
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
  if (started < receipt.runStartedAt - 60_000 || completed < started) {
    fail(`${lane.id} result timing is invalid`)
  }
  return { started, completed }
}

function expectedArtifactName(platform, receipt) {
  return `recovery-qualification-${platform}-${receipt.runId}-${receipt.runAttempt}`
}

function selectArtifacts(artifacts, contract, receipt) {
  if (!Array.isArray(artifacts)) {
    fail('GitHub artifacts response must contain an artifacts array')
  }
  const expectedNames = PLATFORMS.map((platform) =>
    expectedArtifactName(platform, receipt),
  ).sort()
  const currentAttemptSuffix = `-${receipt.runId}-${receipt.runAttempt}`
  const relevant = artifacts.filter((artifact) =>
    String(artifact?.name ?? '').startsWith('recovery-qualification-') &&
    String(artifact?.name ?? '').endsWith(currentAttemptSuffix),
  )
  const actualNames = relevant.map((artifact) => artifact.name).sort()
  sameJson(actualNames, expectedNames, 'recovery GitHub artifact names')
  const selected = Object.fromEntries(
    PLATFORMS.map((platform) => {
      const name = expectedArtifactName(platform, receipt)
      const matches = relevant.filter((artifact) => artifact.name === name)
      if (matches.length !== 1) {
        fail(`${platform} must have exactly one recovery artifact`)
      }
      const artifact = matches[0]
      const digest = /^sha256:([0-9a-f]{64})$/.exec(artifact.digest ?? '')
      if (
        artifact.expired !== false ||
        !Number.isSafeInteger(artifact.size_in_bytes) ||
        artifact.size_in_bytes <= 0 ||
        !digest
      ) {
        fail(`${platform} recovery artifact metadata is invalid`)
      }
      const workflowRun = requireObject(
        artifact.workflow_run,
        `${platform} recovery artifact workflow_run`,
      )
      if (
        workflowRun.id !== receipt.runId ||
        workflowRun.repository_id !== receipt.run.repository.id ||
        workflowRun.head_repository_id !== receipt.run.repository.id ||
        workflowRun.head_branch !== LIVE_BRANCH ||
        workflowRun.head_sha !== contract.workflow.headSha
      ) {
        fail(`${platform} artifact is not bound to the exact recovery run`)
      }
      return [
        platform,
        {
          id: requirePositiveInteger(
            artifact.id,
            `${platform} recovery artifact ID`,
          ),
          name,
          sha256: digest[1],
          createdAt: timestamp(
            artifact.created_at,
            `${platform} recovery artifact created_at`,
          ),
        },
      ]
    }),
  )
  const artifactIds = Object.values(selected).map((artifact) => artifact.id)
  if (new Set(artifactIds).size !== PLATFORMS.length) {
    fail('recovery artifacts must use three distinct GitHub artifact IDs')
  }
  return selected
}

function aggregateFile(inputDir, lane, suffix) {
  const root = `${path.resolve(inputDir)}${path.sep}`
  const file = path.resolve(inputDir, `${lane.id}${suffix}`)
  if (!file.startsWith(root)) {
    fail(`${lane.id} aggregate path escaped input-dir`)
  }
  return file
}

export function aggregateRecoveryQualificationEvidence({
  contract,
  inputDir,
  runReceipt,
  artifactsResponse,
}) {
  validateRecoveryContract(contract)
  const receipt = validateRunReceipt(runReceipt, contract)
  const artifacts = selectArtifacts(
    artifactsResponse?.artifacts,
    contract,
    receipt,
  )
  const results = []
  const artifactDigests = {}
  let completedAt = 0

  for (const lane of contract.lanes) {
    const resultFile = aggregateFile(inputDir, lane, '.json')
    const migrationFile = aggregateFile(inputDir, lane, '-migration.json')
    const manifestFile = aggregateFile(inputDir, lane, '-manifest.json')
    const snapshotFile = aggregateFile(inputDir, lane, '-snapshot.zip')
    const result = readJson(resultFile, `${lane.id} lane result`)
    const timing = validateLaneResult(result, contract, lane, receipt)
    if (sha256File(migrationFile) !== result.migrationReportSha256) {
      fail(`${lane.id} raw migration report SHA-256 mismatch`)
    }
    validateMigrationReport(
      readJson(migrationFile, `${lane.id} migration report`),
      lane,
    )
    if (sha256File(manifestFile) !== result.inputManifestSha256) {
      fail(`${lane.id} raw input manifest SHA-256 mismatch`)
    }
    if (sha256File(snapshotFile) !== result.snapshotSha256) {
      fail(`${lane.id} raw snapshot SHA-256 mismatch`)
    }
    validateInputManifest(
      readJson(manifestFile, `${lane.id} input manifest`),
      result.snapshotSha256,
      contract,
      lane.platform,
    )
    const artifact = artifacts[lane.platform]
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
      runner: lane.runner,
      scenario: SCENARIO,
      qualificationMode: 'automatic-updater',
      sourceVersion: contract.source.version,
      candidateVersion: contract.candidate.version,
      status: 'passed',
      runId: receipt.runId,
      runAttempt: receipt.runAttempt,
      migrationReportSha256: result.migrationReportSha256,
      inputManifestSha256: result.inputManifestSha256,
      snapshotSha256: result.snapshotSha256,
      sourceInstallerSha256: result.sourceInstallerSha256,
      candidateInstallerSha256: result.candidateInstallerSha256,
      artifactSha256: artifact.sha256,
    })
  }
  if (results.length !== 3 || results.some((result) => result.status !== 'passed')) {
    fail('recovery qualification requires exactly three passed lanes')
  }
  const qualificationMatrixSha256 = sha256Bytes(
    Buffer.from(canonicalJson(contract.lanes)),
  )
  const common = {
    candidateTag: contract.candidate.tag,
    candidateVersion: contract.candidate.version,
    sourceCommit: contract.candidate.sourceCommit,
    candidateManifestSha256: contract.candidate.manifestSha256,
    sourceTag: contract.source.tag,
    sourceVersion: contract.source.version,
    sourceReleaseCommit: contract.source.sourceCommit,
    sourceManifestSha256: contract.source.manifestSha256,
    observationScope: 'github-native-recovery-qualification',
    deploymentMode: 'recovery',
    sampleSize: 3,
    attempts: 3,
    passedAttempts: 3,
    failedAttempts: 0,
    harnessSha256: contract.workflow.harnessSha256,
    contractSha256: contractDigest(contract),
    qualificationMatrixSha256,
    platforms: [...PLATFORMS],
    scenarios: [SCENARIO],
  }
  const completedAtIso = new Date(completedAt).toISOString()
  const smoke = {
    schema: 1,
    type: 'upgrade-smoke',
    status: 'passed',
    ...common,
    sourceVersions: [contract.source.version],
    completedAt: completedAtIso,
    workflow: {
      name: WORKFLOW.name,
      path: WORKFLOW.path,
      runId: receipt.runId,
      runAttempt: receipt.runAttempt,
      headSha: contract.workflow.headSha,
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

function contractCommand(values) {
  const required = [
    'train-policy',
    'source-candidate',
    'source-candidate-signature',
    'source-manifest',
    'source-public-key',
    'candidate-candidate',
    'candidate-candidate-signature',
    'candidate-manifest',
    'candidate-public-key',
    'run-id',
    'run-attempt',
    'head-sha',
    'harness-sha256',
    'output',
  ]
  const options = parseOptions(values, required, required)
  const source = verifyReleaseMetadata({
    candidateFile: path.resolve(options['source-candidate']),
    signatureFile: path.resolve(options['source-candidate-signature']),
    manifestFile: path.resolve(options['source-manifest']),
    encodedPublicKey: options['source-public-key'],
    label: 'source',
  })
  const candidate = verifyReleaseMetadata({
    candidateFile: path.resolve(options['candidate-candidate']),
    signatureFile: path.resolve(options['candidate-candidate-signature']),
    manifestFile: path.resolve(options['candidate-manifest']),
    encodedPublicKey: options['candidate-public-key'],
    label: 'candidate',
  })
  const contract = buildRecoveryContract({
    trainPolicy: readJson(
      path.resolve(options['train-policy']),
      'release train policy',
    ),
    source,
    candidate,
    headSha: options['head-sha'],
    harnessSha256: options['harness-sha256'],
    runId: options['run-id'],
    runAttempt: options['run-attempt'],
  })
  writeCanonical(options.output, contract)
  process.stdout.write(
    `${JSON.stringify({
      output: path.resolve(options.output),
      sha256: sha256File(path.resolve(options.output)),
      sourceTag: contract.source.tag,
      candidateTag: contract.candidate.tag,
    })}\n`,
  )
}

function laneResultCommand(values) {
  const required = [
    'contract',
    'platform',
    'migration-report',
    'input-manifest',
    'snapshot',
    'source-installer',
    'candidate-installer',
    'run-id',
    'run-attempt',
    'head-sha',
    'harness-sha256',
    'started-at',
    'completed-at',
    'output',
  ]
  const options = parseOptions(values, required, required)
  const contract = validateRecoveryContract(
    readJson(path.resolve(options.contract), 'recovery contract'),
  )
  const platform = options.platform
  const migrationFile = path.resolve(options['migration-report'])
  const manifestFile = path.resolve(options['input-manifest'])
  const snapshotFile = path.resolve(options.snapshot)
  const result = buildRecoveryLaneResult({
    contract,
    platform,
    migrationReport: readJson(migrationFile, 'migration report'),
    migrationReportSha256: sha256File(migrationFile),
    inputManifest: readJson(manifestFile, 'input manifest'),
    inputManifestSha256: sha256File(manifestFile),
    snapshotSha256: sha256File(snapshotFile),
    sourceInstallerSha256: validateInstaller(
      path.resolve(options['source-installer']),
      contract.source.assets[platform] ?? {},
      `${platform} source installer`,
    ),
    candidateInstallerSha256: validateInstaller(
      path.resolve(options['candidate-installer']),
      contract.candidate.assets[platform] ?? {},
      `${platform} candidate installer`,
    ),
    runId: options['run-id'],
    runAttempt: options['run-attempt'],
    headSha: options['head-sha'],
    harnessSha256: options['harness-sha256'],
    startedAt: options['started-at'],
    completedAt: options['completed-at'],
  })
  writeCanonical(options.output, result)
  process.stdout.write(
    `${JSON.stringify({
      output: path.resolve(options.output),
      sha256: sha256File(path.resolve(options.output)),
    })}\n`,
  )
}

function aggregateCommand(values) {
  const required = [
    'contract',
    'input-dir',
    'run-receipt',
    'artifacts',
    'output-dir',
  ]
  const options = parseOptions(values, required, required)
  const evidence = aggregateRecoveryQualificationEvidence({
    contract: validateRecoveryContract(
      readJson(path.resolve(options.contract), 'recovery contract'),
    ),
    inputDir: path.resolve(options['input-dir']),
    runReceipt: readJson(
      path.resolve(options['run-receipt']),
      'recovery run receipt',
    ),
    artifactsResponse: readJson(
      path.resolve(options.artifacts),
      'recovery artifacts response',
    ),
  })
  const outputDir = path.resolve(options['output-dir'])
  const smokeFile = path.join(outputDir, 'upgrade-smoke.json')
  const healthFile = path.join(outputDir, 'rollout-health.json')
  writeCanonical(smokeFile, evidence.smoke)
  writeCanonical(healthFile, evidence.health)
  process.stdout.write(
    `${JSON.stringify({
      smoke: { file: smokeFile, sha256: sha256File(smokeFile) },
      health: { file: healthFile, sha256: sha256File(healthFile) },
    })}\n`,
  )
}

function main(argv) {
  const [command, ...values] = argv
  if (command === 'contract') return contractCommand(values)
  if (command === 'lane-result') return laneResultCommand(values)
  if (command === 'aggregate') return aggregateCommand(values)
  fail(
    'Usage: recovery-qualification-evidence.mjs <contract|lane-result|aggregate> [options]',
  )
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
