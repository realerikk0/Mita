#!/usr/bin/env node

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HOUR_MS = 60 * 60 * 1000
const REPOSITORY = 'realerikk0/Mita'
const LIVE_BRANCH = 'mita-main'
const POINTS = ['start', 'finish']
const PLATFORMS = ['windows', 'macos', 'linux']
const POLICY_FILE = fileURLToPath(new URL('./a-canary-policy.json', import.meta.url))
const WORKFLOW = {
  path: '.github/workflows/biyan-a-canary.yml',
  name: 'Biyan A Canary',
  minimumHours: 48,
  harnessPaths: [
    '.github/workflows/biyan-a-canary.yml',
    'scripts/updater/a-canary-policy.json',
    'scripts/updater/a-canary-evidence.mjs',
    'scripts/updater/prepare-a-canary-inputs.py',
    'autoqa/migration_runner.py',
  ],
}
const PINS = {
  current: {
    version: '0.6.633',
    tag: 'v0.6.633',
    sourceCommit: '97d5f734b472f0b65e141614f047e405f1ba1c0b',
    manifestSha256: '142abddf03744562195404d0dd9ae92f53d8f74d20b2cef19b2db60aeb8ec350',
  },
  candidate: {
    version: '0.6.643',
    tag: 'v0.6.643',
    sourceCommit: '38e6d9290a8b9b0f152ff2a7eefb550e6ead7df5',
    manifestSha256: 'a0ad7721c74aa6ec7817bb1b9626dbad05226e7871f21cebb4976921d100c9fa',
  },
  platforms: {
    windows: {
      scenario: 'current-to-a',
      currentAsset: {
        name: 'Biyan_0.6.633_x64-setup.exe',
        sha256: 'd7369543669a0f9ebd1b5503556cd177d3dcf2e74f7660e0625221d5c33c8c4a',
      },
      candidateAsset: {
        name: 'Biyan_0.6.643_x64-setup.exe',
        sha256: 'a25d32b43028b90c4ed7ffd8c835106a925bcc72684dbd2b689d5e371fb123ee',
      },
    },
    macos: {
      scenario: 'current-to-a',
      currentAsset: {
        name: 'Biyan_0.6.633_universal.dmg',
        sha256: 'ca6997370e64b7455acc247438f736ddc89b2f8708a417082190a14498a29511',
      },
      candidateAsset: {
        name: 'Biyan_0.6.643_universal.dmg',
        sha256: 'c9abe462da067b15c9764a395f6b2b356e624cb714a5029cdcf165eb62c53268',
      },
    },
    linux: {
      scenario: 'fresh-a',
      compatibilityException: {
        code: 'no-production-current-linux-artifact',
        currentVersion: '0.6.633',
        currentManifestSha256:
          '142abddf03744562195404d0dd9ae92f53d8f74d20b2cef19b2db60aeb8ec350',
      },
      candidateAsset: {
        name: 'Biyan_0.6.643_amd64.AppImage',
        sha256: '803568bd4c04ba5f3cd7144b000f0d27ad8f4c63a7af9084a5762b679d047fe3',
      },
    },
  },
}

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

function requireString(value, label) {
  if (typeof value !== 'string' || value.length === 0) fail(`${label} must be a non-empty string`)
  return value
}

function requireSha256(value, label) {
  if (!/^[0-9a-f]{64}$/.test(value ?? '')) fail(`${label} must be 64 lowercase hex characters`)
  return value
}

function requireCommit(value, label) {
  if (!/^[0-9a-f]{40}$/.test(value ?? '')) fail(`${label} must be a full lowercase commit SHA`)
  return value
}

function requirePositiveInteger(value, label) {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(number) || number <= 0) fail(`${label} must be a positive integer`)
  return number
}

function dateMilliseconds(value, label) {
  if (typeof value !== 'string' || value.length === 0) fail(`${label} must be an ISO-8601 timestamp`)
  const milliseconds = Date.parse(value)
  if (!Number.isFinite(milliseconds)) fail(`${label} must be an ISO-8601 timestamp`)
  return milliseconds
}

function canonicalDate(value, label) {
  return new Date(dateMilliseconds(value, label)).toISOString()
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

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function sha256File(file) {
  return sha256Bytes(readRegularFile(file, `SHA-256 input ${file}`))
}

function readRegularFile(file, label) {
  const stat = fs.lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0) {
    fail(`${label} must be a non-empty regular file`)
  }
  return fs.readFileSync(file)
}

function readJson(file, label) {
  const bytes = readRegularFile(file, label)
  try {
    return JSON.parse(bytes.toString('utf8'))
  } catch (error) {
    fail(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function sameJson(actual, expected, label) {
  if (canonicalJson(actual) !== canonicalJson(expected)) fail(`${label} does not match the approved policy`)
}

function validateAsset(asset, expected, label) {
  requireExactKeys(asset, ['name', 'sha256'], label)
  requireString(asset.name, `${label}.name`)
  requireSha256(asset.sha256, `${label}.sha256`)
  sameJson(asset, expected, label)
}

export function validateACanaryPolicy(policy) {
  requireExactKeys(policy, ['schema', 'workflow', 'current', 'candidate', 'platforms'], 'policy')
  if (policy.schema !== 1) fail('policy.schema must be 1')

  requireExactKeys(
    policy.workflow,
    ['path', 'name', 'minimumHours', 'harnessPaths'],
    'policy.workflow',
  )
  sameJson(policy.workflow, WORKFLOW, 'policy.workflow')

  for (const release of ['current', 'candidate']) {
    const value = policy[release]
    requireExactKeys(
      value,
      ['version', 'tag', 'sourceCommit', 'manifestSha256'],
      `policy.${release}`,
    )
    requireCommit(value.sourceCommit, `policy.${release}.sourceCommit`)
    requireSha256(value.manifestSha256, `policy.${release}.manifestSha256`)
    sameJson(value, PINS[release], `policy.${release}`)
  }

  requireExactKeys(policy.platforms, PLATFORMS, 'policy.platforms')
  for (const platform of PLATFORMS) {
    const value = policy.platforms[platform]
    const expected = PINS.platforms[platform]
    if (platform === 'linux') {
      requireExactKeys(
        value,
        ['scenario', 'compatibilityException', 'candidateAsset'],
        'policy.platforms.linux',
      )
      requireExactKeys(
        value.compatibilityException,
        ['code', 'currentVersion', 'currentManifestSha256'],
        'policy.platforms.linux.compatibilityException',
      )
      requireSha256(
        value.compatibilityException.currentManifestSha256,
        'policy.platforms.linux.compatibilityException.currentManifestSha256',
      )
      validateAsset(
        value.candidateAsset,
        expected.candidateAsset,
        'policy.platforms.linux.candidateAsset',
      )
    } else {
      requireExactKeys(
        value,
        ['scenario', 'currentAsset', 'candidateAsset'],
        `policy.platforms.${platform}`,
      )
      validateAsset(
        value.currentAsset,
        expected.currentAsset,
        `policy.platforms.${platform}.currentAsset`,
      )
      validateAsset(
        value.candidateAsset,
        expected.candidateAsset,
        `policy.platforms.${platform}.candidateAsset`,
      )
    }
    sameJson(value, expected, `policy.platforms.${platform}`)
  }
  return policy
}

export function loadACanaryPolicy(file = POLICY_FILE) {
  return validateACanaryPolicy(readJson(path.resolve(file), 'A canary policy'))
}

function expectedMigrationCase(platform, policy) {
  const scenario = policy.platforms[platform].scenario
  if (scenario === 'current-to-a') {
    return {
      scenario,
      platform,
      snapshot: 'current',
      installSequence: ['current', 'a'],
      expectedPhase: 'a',
      status: 'passed',
    }
  }
  return {
    scenario: 'fresh-a',
    platform,
    snapshot: 'fresh',
    installSequence: ['a'],
    expectedPhase: 'a',
    status: 'passed',
  }
}

export function validateMigrationReport(report, platform, policy) {
  if (!PLATFORMS.includes(platform)) fail(`Unsupported A canary platform: ${platform}`)
  requireExactKeys(
    report,
    ['schema', 'platform', 'scenarios', 'status', 'matrix'],
    'migration report',
  )
  if (report.schema !== 1) fail('migration report schema must be 1')
  if (report.platform !== platform) fail(`migration report platform must be ${platform}`)
  if (report.status !== 'passed') fail('migration report status must be passed')
  sameJson(
    report.scenarios,
    [policy.platforms[platform].scenario],
    'migration report scenarios',
  )
  if (!Array.isArray(report.matrix) || report.matrix.length !== 1) {
    fail('migration report must contain exactly one A canary scenario')
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
    'migration report result',
  )
  if (typeof result.durationSeconds !== 'number'
    || !Number.isFinite(result.durationSeconds)
    || result.durationSeconds < 0) {
    fail('migration report result durationSeconds must be a non-negative finite number')
  }
  const { durationSeconds: _durationSeconds, ...identity } = result
  sameJson(identity, expectedMigrationCase(platform, policy), 'migration report scenario')
  return report
}

function policyAssets(policy, platform) {
  const platformPolicy = policy.platforms[platform]
  if (platform === 'linux') {
    return {
      compatibilityException: platformPolicy.compatibilityException,
      candidateAsset: platformPolicy.candidateAsset,
    }
  }
  return {
    currentAsset: platformPolicy.currentAsset,
    candidateAsset: platformPolicy.candidateAsset,
  }
}

export function buildPlatformResult({
  policy,
  platform,
  migrationReport,
  migrationReportSha256,
  inputManifestSha256,
  snapshotSha256,
  runId,
  runAttempt,
  harnessSha256,
  startedAt,
  completedAt,
}) {
  validateACanaryPolicy(policy)
  validateMigrationReport(migrationReport, platform, policy)
  requireSha256(migrationReportSha256, 'migration report SHA-256')
  requireSha256(inputManifestSha256, 'input manifest SHA-256')
  requireSha256(snapshotSha256, 'snapshot SHA-256')
  const normalizedRunId = requirePositiveInteger(runId, 'run ID')
  const normalizedRunAttempt = requirePositiveInteger(runAttempt, 'run attempt')
  requireSha256(harnessSha256, 'harness SHA-256')
  const startMs = dateMilliseconds(startedAt, 'platform result startedAt')
  const completeMs = dateMilliseconds(completedAt, 'platform result completedAt')
  if (completeMs < startMs) fail('platform result completedAt must not precede startedAt')

  return {
    schema: 1,
    type: 'biyan-a-canary-platform-result',
    platform,
    scenario: policy.platforms[platform].scenario,
    status: 'passed',
    candidateTag: policy.candidate.tag,
    sourceCommit: policy.candidate.sourceCommit,
    currentVersion: policy.current.version,
    candidateVersion: policy.candidate.version,
    currentManifestSha256: policy.current.manifestSha256,
    candidateManifestSha256: policy.candidate.manifestSha256,
    harnessSha256,
    runId: normalizedRunId,
    runAttempt: normalizedRunAttempt,
    startedAt: new Date(startMs).toISOString(),
    completedAt: new Date(completeMs).toISOString(),
    migrationReportSha256,
    inputManifestSha256,
    snapshotSha256,
    assets: policyAssets(policy, platform),
  }
}

function validatePlatformResult(result, { policy, platform, run, harnessSha256 }) {
  requireExactKeys(
    result,
    [
      'schema',
      'type',
      'platform',
      'scenario',
      'status',
      'candidateTag',
      'sourceCommit',
      'currentVersion',
      'candidateVersion',
      'currentManifestSha256',
      'candidateManifestSha256',
      'harnessSha256',
      'runId',
      'runAttempt',
      'startedAt',
      'completedAt',
      'migrationReportSha256',
      'inputManifestSha256',
      'snapshotSha256',
      'assets',
    ],
    `${platform} platform result`,
  )
  if (result.schema !== 1 || result.type !== 'biyan-a-canary-platform-result') {
    fail(`${platform} platform result schema/type is unsupported`)
  }
  const expected = {
    platform,
    scenario: policy.platforms[platform].scenario,
    status: 'passed',
    candidateTag: policy.candidate.tag,
    sourceCommit: policy.candidate.sourceCommit,
    currentVersion: policy.current.version,
    candidateVersion: policy.candidate.version,
    currentManifestSha256: policy.current.manifestSha256,
    candidateManifestSha256: policy.candidate.manifestSha256,
    harnessSha256,
    runId: run.id,
    runAttempt: run.run_attempt,
    assets: policyAssets(policy, platform),
  }
  for (const [key, value] of Object.entries(expected)) sameJson(result[key], value, `${platform}.${key}`)
  requireSha256(result.migrationReportSha256, `${platform}.migrationReportSha256`)
  requireSha256(result.inputManifestSha256, `${platform}.inputManifestSha256`)
  requireSha256(result.snapshotSha256, `${platform}.snapshotSha256`)
  const started = dateMilliseconds(result.startedAt, `${platform}.startedAt`)
  const completed = dateMilliseconds(result.completedAt, `${platform}.completedAt`)
  if (completed < started) fail(`${platform} result completedAt precedes startedAt`)
  const runStarted = dateMilliseconds(run.run_started_at, 'GitHub run_started_at')
  if (started < runStarted - 60_000) fail(`${platform} result started before its GitHub workflow run`)
  return { started, completed }
}

function validateRunReceipt(receipt, { point, expectedRunId }) {
  requireObject(receipt, `${point} run receipt`)
  const harnessSha256 = requireSha256(
    receipt.harnessSha256,
    `${point} run receipt harnessSha256`,
  )
  const run = receipt.run === undefined ? receipt : receipt.run
  requireObject(run, `${point} GitHub run`)
  const runId = requirePositiveInteger(run.id, `${point} GitHub run ID`)
  if (runId !== expectedRunId) fail(`${point} GitHub run ID does not match the CLI run ID`)
  if (run.name !== WORKFLOW.name || run.path !== WORKFLOW.path) {
    fail(`${point} receipt is not from the exact A canary workflow`)
  }
  if (run.event !== 'workflow_dispatch') fail(`${point} A canary run must use workflow_dispatch`)
  if (run.head_branch !== LIVE_BRANCH) fail(`${point} A canary run must execute from ${LIVE_BRANCH}`)
  requireCommit(run.head_sha, `${point} GitHub run head_sha`)
  requirePositiveInteger(run.run_attempt, `${point} GitHub run attempt`)
  if (run.repository?.full_name !== REPOSITORY || run.head_repository?.full_name !== REPOSITORY) {
    fail(`${point} A canary run must belong to ${REPOSITORY}`)
  }
  const repositoryId = requirePositiveInteger(run.repository?.id, `${point} repository ID`)
  const headRepositoryId = requirePositiveInteger(
    run.head_repository?.id,
    `${point} head repository ID`,
  )
  if (repositoryId !== headRepositoryId) fail(`${point} A canary run may not use a fork head`)
  dateMilliseconds(run.created_at, `${point} run created_at`)
  dateMilliseconds(run.run_started_at, `${point} run run_started_at`)
  dateMilliseconds(run.updated_at, `${point} run updated_at`)
  if (point === 'start') {
    if (run.status !== 'completed' || run.conclusion !== 'success') {
      fail('start A canary run must be completed successfully')
    }
  } else {
    const live = run.status === 'in_progress' && run.conclusion == null
    const replay = run.status === 'completed' && run.conclusion === 'success'
    if (!live && !replay) fail('finish A canary run must be in progress or completed successfully')
  }
  return { run, harnessSha256, repositoryId }
}

function validateArtifactReceipt(receipt, { point, platform, runReceipt }) {
  requireObject(receipt, `${point} ${platform} artifact receipt`)
  const run = runReceipt.run
  const id = requirePositiveInteger(receipt.id, `${point} ${platform} artifact ID`)
  const expectedName = `a-canary-${point}-${platform}-${run.id}-${run.run_attempt}`
  if (receipt.name !== expectedName) {
    fail(`${point} ${platform} artifact name must be ${expectedName}`)
  }
  if (receipt.expired !== false) fail(`${point} ${platform} artifact must be unexpired`)
  requirePositiveInteger(receipt.size_in_bytes, `${point} ${platform} artifact size`)
  const digestMatch = /^sha256:([0-9a-f]{64})$/.exec(receipt.digest ?? '')
  if (!digestMatch) fail(`${point} ${platform} artifact digest must be sha256:<64 lowercase hex>`)
  const workflowRun = requireObject(
    receipt.workflow_run,
    `${point} ${platform} artifact workflow_run`,
  )
  if (workflowRun.id !== run.id
    || workflowRun.repository_id !== runReceipt.repositoryId
    || workflowRun.head_repository_id !== runReceipt.repositoryId
    || workflowRun.head_branch !== LIVE_BRANCH
    || workflowRun.head_sha !== run.head_sha) {
    fail(`${point} ${platform} artifact is not bound to the exact GitHub workflow run`)
  }
  const createdAtMs = dateMilliseconds(
    receipt.created_at,
    `${point} ${platform} artifact created_at`,
  )
  dateMilliseconds(receipt.updated_at, `${point} ${platform} artifact updated_at`)
  const runStarted = dateMilliseconds(run.run_started_at, `${point} run_started_at`)
  if (createdAtMs < runStarted) fail(`${point} ${platform} artifact predates its workflow run`)
  return {
    id,
    name: receipt.name,
    sha256: digestMatch[1],
    createdAt: new Date(createdAtMs).toISOString(),
    createdAtMs,
  }
}

function readAggregateInput(inputDir, point, platform, kind) {
  const suffix = kind === 'result' ? '.json' : '-artifact.json'
  const file = path.resolve(inputDir, `${point}-${platform}${suffix}`)
  const root = `${path.resolve(inputDir)}${path.sep}`
  if (!file.startsWith(root)) fail('A canary input path escaped input-dir')
  return readJson(file, `${point} ${platform} ${kind}`)
}

function aggregateInputFile(inputDir, point, platform, suffix) {
  const file = path.resolve(inputDir, `${point}-${platform}${suffix}`)
  const root = `${path.resolve(inputDir)}${path.sep}`
  if (!file.startsWith(root)) fail('A canary input path escaped input-dir')
  return file
}

export function aggregateACanaryEvidence({
  policy,
  inputDir,
  startReceipt,
  finishReceipt,
  startedAt,
  completedAt,
  startRunId,
  finishRunId,
}) {
  validateACanaryPolicy(policy)
  const startId = requirePositiveInteger(startRunId, 'start run ID')
  const finishId = requirePositiveInteger(finishRunId, 'finish run ID')
  if (startId === finishId) fail('start and finish run IDs must be different')
  const receipts = {
    start: validateRunReceipt(startReceipt, { point: 'start', expectedRunId: startId }),
    finish: validateRunReceipt(finishReceipt, { point: 'finish', expectedRunId: finishId }),
  }
  if (receipts.start.harnessSha256 !== receipts.finish.harnessSha256) {
    fail('start and finish harness SHA-256 values must match exactly')
  }
  const harnessSha256 = receipts.start.harnessSha256
  const attempts = []
  const artifactDigests = {}
  const artifactCreatedAt = {}

  for (const point of POINTS) {
    artifactDigests[point] = {}
    artifactCreatedAt[point] = {}
    for (const platform of PLATFORMS) {
      const result = readAggregateInput(inputDir, point, platform, 'result')
      const artifactReceipt = readAggregateInput(inputDir, point, platform, 'artifact')
      const migrationReportFile = aggregateInputFile(
        inputDir,
        point,
        platform,
        '-migration.json',
      )
      const inputManifestFile = aggregateInputFile(
        inputDir,
        point,
        platform,
        '-manifest.json',
      )
      const snapshotFile = aggregateInputFile(
        inputDir,
        point,
        platform,
        '-snapshot.zip',
      )
      const timing = validatePlatformResult(result, {
        policy,
        platform,
        run: receipts[point].run,
        harnessSha256,
      })
      if (sha256File(migrationReportFile) !== result.migrationReportSha256) {
        fail(`${point} ${platform} raw migration report SHA-256 does not match`)
      }
      validateMigrationReport(
        readJson(migrationReportFile, `${point} ${platform} migration report`),
        platform,
        policy,
      )
      if (sha256File(inputManifestFile) !== result.inputManifestSha256) {
        fail(`${point} ${platform} input manifest SHA-256 does not match`)
      }
      if (sha256File(snapshotFile) !== result.snapshotSha256) {
        fail(`${point} ${platform} snapshot SHA-256 does not match`)
      }
      const inputManifest = readJson(
        inputManifestFile,
        `${point} ${platform} input manifest`,
      )
      const snapshotName = policy.platforms[platform].scenario === 'fresh-a'
        ? 'fresh'
        : 'current'
      if (
        inputManifest.schema !== 1
        || inputManifest.sanitized !== true
        || inputManifest.platform !== platform
        || inputManifest.scenario !== policy.platforms[platform].scenario
        || Object.keys(inputManifest.snapshots ?? {}).length !== 1
        || inputManifest.snapshots?.[snapshotName]?.sha256 !== result.snapshotSha256
      ) {
        fail(`${point} ${platform} input manifest does not bind the exact sanitized scenario snapshot`)
      }
      const artifact = validateArtifactReceipt(artifactReceipt, {
        point,
        platform,
        runReceipt: receipts[point],
      })
      if (timing.completed > artifact.createdAtMs + 60_000) {
        fail(`${point} ${platform} result completed after its artifact was created`)
      }
      artifactDigests[point][platform] = {
        id: artifact.id,
        name: artifact.name,
        sha256: artifact.sha256,
      }
      artifactCreatedAt[point][platform] = artifact.createdAtMs
      attempts.push({
        point,
        platform,
        scenario: result.scenario,
        status: result.status,
        runId: result.runId,
        runAttempt: result.runAttempt,
        migrationReportSha256: result.migrationReportSha256,
        inputManifestSha256: result.inputManifestSha256,
        snapshotSha256: result.snapshotSha256,
        artifactSha256: artifact.sha256,
      })
    }
  }

  const startAnchorMs = Math.max(
    ...PLATFORMS.map((platform) => artifactCreatedAt.start[platform]),
  )
  const finishAnchorMs = Math.max(
    ...PLATFORMS.map((platform) => artifactCreatedAt.finish[platform]),
  )
  const cliStartMs = dateMilliseconds(startedAt, 'CLI started-at')
  const cliFinishMs = dateMilliseconds(completedAt, 'CLI completed-at')
  if (cliStartMs !== startAnchorMs) {
    fail('CLI started-at must exactly equal the latest start artifact created_at')
  }
  if (cliFinishMs !== finishAnchorMs) {
    fail('CLI completed-at must exactly equal the latest finish artifact created_at')
  }
  if (finishAnchorMs <= startAnchorMs) fail('finish evidence must be newer than start evidence')
  if (finishAnchorMs - startAnchorMs < policy.workflow.minimumHours * HOUR_MS) {
    fail(`A canary requires at least ${policy.workflow.minimumHours} hours of GitHub server evidence`)
  }

  const sampleSize = attempts.length
  const passedAttempts = attempts.filter((attempt) => attempt.status === 'passed').length
  const failedAttempts = sampleSize - passedAttempts
  if (sampleSize !== POINTS.length * PLATFORMS.length || failedAttempts !== 0) {
    fail('A canary requires all six start/finish platform attempts to pass')
  }
  const canaryStartedAt = new Date(startAnchorMs).toISOString()
  const evidenceCompletedAt = new Date(finishAnchorMs).toISOString()
  const shared = {
    candidateTag: policy.candidate.tag,
    sourceCommit: policy.candidate.sourceCommit,
    observationScope: 'github-native-two-point-canary',
    sampleSize,
    attempts: sampleSize,
    passedAttempts,
    failedAttempts,
    harnessSha256,
  }
  const smoke = {
    schema: 1,
    type: 'upgrade-smoke',
    status: 'passed',
    ...shared,
    currentVersion: policy.current.version,
    candidateVersion: policy.candidate.version,
    platforms: [...PLATFORMS],
    scenarios: [...new Set(PLATFORMS.map((platform) => policy.platforms[platform].scenario))],
    canaryStartedAt,
    completedAt: evidenceCompletedAt,
    workflow: {
      name: policy.workflow.name,
      path: policy.workflow.path,
      startRunId: startId,
      finishRunId: finishId,
      startHeadSha: receipts.start.run.head_sha,
      finishHeadSha: receipts.finish.run.head_sha,
    },
    artifactDigests,
    results: attempts,
  }
  const migrationFailureRate = failedAttempts / sampleSize
  const health = {
    schema: 1,
    type: 'rollout-health',
    status: 'healthy',
    ...shared,
    p0Incidents: failedAttempts === 0 ? 0 : 1,
    p1Incidents: failedAttempts === 0 ? 0 : 1,
    dataLossIncidents: failedAttempts === 0 ? 0 : 1,
    migrationFailureRate,
    observedAt: evidenceCompletedAt,
  }
  return { smoke, health }
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
    if (options[key] === undefined || options[key] === '') fail(`Missing required option: --${key}`)
  }
  return options
}

function platformResultCommand(values) {
  const required = [
    'policy',
    'platform',
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
  const policy = loadACanaryPolicy(options.policy)
  const migrationReportFile = path.resolve(options['migration-report'])
  const inputManifestFile = path.resolve(options['input-manifest'])
  const snapshotFile = path.resolve(options.snapshot)
  const migrationReport = readJson(migrationReportFile, 'migration report')
  const result = buildPlatformResult({
    policy,
    platform: options.platform,
    migrationReport,
    migrationReportSha256: sha256File(migrationReportFile),
    inputManifestSha256: sha256File(inputManifestFile),
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
    'start-receipt',
    'finish-receipt',
    'started-at',
    'completed-at',
    'start-run-id',
    'finish-run-id',
    'output-dir',
  ]
  const options = parseOptions(values, required, required)
  const outputDir = path.resolve(options['output-dir'])
  const evidence = aggregateACanaryEvidence({
    policy: loadACanaryPolicy(options.policy),
    inputDir: path.resolve(options['input-dir']),
    startReceipt: readJson(path.resolve(options['start-receipt']), 'start run receipt'),
    finishReceipt: readJson(path.resolve(options['finish-receipt']), 'finish run receipt'),
    startedAt: options['started-at'],
    completedAt: options['completed-at'],
    startRunId: options['start-run-id'],
    finishRunId: options['finish-run-id'],
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

function main(argv) {
  const [command, ...values] = argv
  if (command === 'platform-result') return platformResultCommand(values)
  if (command === 'aggregate') return aggregateCommand(values)
  fail(
    'Usage: a-canary-evidence.mjs <platform-result|aggregate> [options]',
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
