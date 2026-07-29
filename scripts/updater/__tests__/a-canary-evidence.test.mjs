import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  aggregateACanaryEvidence,
  buildPlatformResult,
  loadACanaryPolicy,
  validateACanaryPolicy,
  validateMigrationReport,
} from '../a-canary-evidence.mjs'

const testDir = path.dirname(fileURLToPath(import.meta.url))
const script = path.resolve(testDir, '..', 'a-canary-evidence.mjs')
const policyFile = path.resolve(testDir, '..', 'a-canary-policy.json')
const policy = loadACanaryPolicy(policyFile)
const harnessSha256 = 'a'.repeat(64)
const repositoryId = 1225341166

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function migrationReport(platform) {
  const currentToA = {
    scenario: 'current-to-a',
    platform,
    snapshot: 'current',
    installSequence: ['current', 'a'],
    expectedPhase: 'a',
    status: 'passed',
    durationSeconds: 15.5,
  }
  const freshA = {
    scenario: 'fresh-a',
    platform,
    snapshot: 'fresh',
    installSequence: ['a'],
    expectedPhase: 'a',
    status: 'passed',
    durationSeconds: 12.25,
  }
  return {
    schema: 1,
    platform,
    scenarios: [platform === 'linux' ? 'fresh-a' : 'current-to-a'],
    status: 'passed',
    matrix: [platform === 'linux' ? freshA : currentToA],
  }
}

function runReceipt({
  id,
  headSha,
  startedAt,
  status = 'completed',
  conclusion = 'success',
  harness = harnessSha256,
}) {
  return {
    harnessSha256: harness,
    id,
    name: 'Biyan A Canary',
    path: '.github/workflows/biyan-a-canary.yml',
    event: 'workflow_dispatch',
    status,
    conclusion,
    head_branch: 'mita-main',
    head_sha: headSha,
    run_attempt: 1,
    created_at: startedAt,
    run_started_at: startedAt,
    updated_at: startedAt,
    repository: { id: repositoryId, full_name: 'realerikk0/Mita' },
    head_repository: { id: repositoryId, full_name: 'realerikk0/Mita' },
  }
}

function artifactReceipt({ point, platform, run, createdAt, digestSeed }) {
  return {
    id: Number(`${point === 'start' ? 1 : 2}${platform === 'windows' ? 1 : platform === 'macos' ? 2 : 3}`),
    name: `a-canary-${point}-${platform}-${run.id}-${run.run_attempt}`,
    size_in_bytes: 1024,
    expired: false,
    digest: `sha256:${sha256(digestSeed)}`,
    created_at: createdAt,
    updated_at: createdAt,
    workflow_run: {
      id: run.id,
      repository_id: repositoryId,
      head_repository_id: repositoryId,
      head_branch: 'mita-main',
      head_sha: run.head_sha,
    },
  }
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

function canaryInputManifest(platform, snapshotSha256) {
  const scenario = platform === 'linux' ? 'fresh-a' : 'current-to-a'
  const snapshot = platform === 'linux' ? 'fresh' : 'current'
  return {
    schema: 1,
    sanitized: true,
    platform,
    scenario,
    installers: {},
    snapshots: {
      [snapshot]: {
        archive: `snapshots/${snapshot}.zip`,
        sha256: snapshotSha256,
        restore_to: '/safe/test/profile',
      },
    },
    expectations: { a: ['/safe/test/profile/migration-state.json'] },
  }
}

function makeAggregateFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'biyan-a-canary-'))
  const inputDir = path.join(root, 'input')
  fs.mkdirSync(inputDir)
  const startReceipt = runReceipt({
    id: 1001,
    headSha: 'b'.repeat(40),
    startedAt: '2026-07-19T23:50:00Z',
  })
  const finishReceipt = runReceipt({
    id: 2002,
    headSha: 'c'.repeat(40),
    startedAt: '2026-07-22T00:00:00Z',
    status: 'in_progress',
    conclusion: null,
  })
  const artifactTimes = {
    start: {
      windows: '2026-07-20T00:00:00Z',
      macos: '2026-07-20T00:00:01Z',
      linux: '2026-07-20T00:00:02Z',
    },
    finish: {
      windows: '2026-07-22T00:00:03Z',
      macos: '2026-07-22T00:00:04Z',
      linux: '2026-07-22T00:00:05Z',
    },
  }
  for (const point of ['start', 'finish']) {
    const receipt = point === 'start' ? startReceipt : finishReceipt
    for (const platform of ['windows', 'macos', 'linux']) {
      const report = migrationReport(platform)
      const reportFile = path.join(
        inputDir,
        `${point}-${platform}-migration.json`,
      )
      writeJson(reportFile, report)
      const snapshotFile = path.join(
        inputDir,
        `${point}-${platform}-snapshot.zip`,
      )
      fs.writeFileSync(snapshotFile, `${point}-${platform}-snapshot`)
      const manifestFile = path.join(
        inputDir,
        `${point}-${platform}-manifest.json`,
      )
      writeJson(
        manifestFile,
        canaryInputManifest(
          platform,
          sha256(fs.readFileSync(snapshotFile)),
        ),
      )
      const result = buildPlatformResult({
        policy,
        platform,
        migrationReport: report,
        migrationReportSha256: sha256(fs.readFileSync(reportFile)),
        inputManifestSha256: sha256(fs.readFileSync(manifestFile)),
        snapshotSha256: sha256(fs.readFileSync(snapshotFile)),
        runId: receipt.id,
        runAttempt: receipt.run_attempt,
        harnessSha256,
        startedAt:
          point === 'start' ? '2026-07-19T23:59:40Z' : '2026-07-22T00:00:01Z',
        completedAt:
          point === 'start' ? '2026-07-19T23:59:55Z' : '2026-07-22T00:00:02Z',
      })
      writeJson(path.join(inputDir, `${point}-${platform}.json`), result)
      writeJson(
        path.join(inputDir, `${point}-${platform}-artifact.json`),
        artifactReceipt({
          point,
          platform,
          run: receipt,
          createdAt: artifactTimes[point][platform],
          digestSeed: `${point}-${platform}`,
        }),
      )
    }
  }
  const startReceiptFile = path.join(root, 'start-receipt.json')
  const finishReceiptFile = path.join(root, 'finish-receipt.json')
  writeJson(startReceiptFile, startReceipt)
  writeJson(finishReceiptFile, finishReceipt)
  return {
    root,
    inputDir,
    startReceipt,
    finishReceipt,
    startReceiptFile,
    finishReceiptFile,
    startedAt: artifactTimes.start.linux,
    completedAt: artifactTimes.finish.linux,
  }
}

test('policy pins the exact current/A assets and explicit Linux compatibility exception', () => {
  assert.equal(policy.workflow.minimumHours, 48)
  assert.deepEqual(policy.workflow.harnessPaths, [
    '.github/workflows/biyan-a-canary.yml',
    'scripts/updater/a-canary-policy.json',
    'scripts/updater/a-canary-evidence.mjs',
    'scripts/updater/prepare-a-canary-inputs.py',
    'autoqa/migration_runner.py',
  ])
  assert.equal(policy.current.version, '0.6.633')
  assert.equal(
    policy.current.manifestSha256,
    '142abddf03744562195404d0dd9ae92f53d8f74d20b2cef19b2db60aeb8ec350',
  )
  assert.equal(policy.candidate.tag, 'v0.6.643')
  assert.equal(
    policy.candidate.sourceCommit,
    '38e6d9290a8b9b0f152ff2a7eefb550e6ead7df5',
  )
  assert.equal(
    policy.platforms.windows.currentAsset.sha256,
    'd7369543669a0f9ebd1b5503556cd177d3dcf2e74f7660e0625221d5c33c8c4a',
  )
  assert.equal(
    policy.platforms.windows.candidateAsset.sha256,
    'a25d32b43028b90c4ed7ffd8c835106a925bcc72684dbd2b689d5e371fb123ee',
  )
  assert.equal(
    policy.platforms.macos.currentAsset.sha256,
    'ca6997370e64b7455acc247438f736ddc89b2f8708a417082190a14498a29511',
  )
  assert.equal(
    policy.platforms.macos.candidateAsset.sha256,
    'c9abe462da067b15c9764a395f6b2b356e624cb714a5029cdcf165eb62c53268',
  )
  assert.deepEqual(policy.platforms.linux.compatibilityException, {
    code: 'no-production-current-linux-artifact',
    currentVersion: '0.6.633',
    currentManifestSha256:
      '142abddf03744562195404d0dd9ae92f53d8f74d20b2cef19b2db60aeb8ec350',
  })
  assert.equal(
    policy.platforms.linux.candidateAsset.sha256,
    '803568bd4c04ba5f3cd7144b000f0d27ad8f4c63a7af9084a5762b679d047fe3',
  )

  const changed = structuredClone(policy)
  changed.candidate.manifestSha256 = 'f'.repeat(64)
  assert.throws(() => validateACanaryPolicy(changed), /approved policy/)
})

test('migration reports must contain only the exact per-platform A scenario', () => {
  for (const platform of ['windows', 'macos', 'linux']) {
    validateMigrationReport(migrationReport(platform), platform, policy)
  }
  const fullMatrix = migrationReport('windows')
  fullMatrix.matrix.push(structuredClone(fullMatrix.matrix[0]))
  assert.throws(
    () => validateMigrationReport(fullMatrix, 'windows', policy),
    /exactly one A canary scenario/,
  )
  const wrongLinux = migrationReport('linux')
  wrongLinux.matrix[0].scenario = 'current-to-a'
  assert.throws(
    () => validateMigrationReport(wrongLinux, 'linux', policy),
    /approved policy/,
  )
  const injectedHealth = migrationReport('windows')
  injectedHealth.p0Incidents = 0
  assert.throws(
    () => validateMigrationReport(injectedHealth, 'windows', policy),
    /keys must be exactly/,
  )
})

test('platform-result CLI emits canonical policy-bound evidence', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'biyan-a-canary-platform-'))
  const reportFile = path.join(root, 'migration.json')
  const snapshotFile = path.join(root, 'snapshot.zip')
  const manifestFile = path.join(root, 'manifest.json')
  const output = path.join(root, 'result.json')
  writeJson(reportFile, migrationReport('linux'))
  fs.writeFileSync(snapshotFile, 'snapshot')
  writeJson(
    manifestFile,
    canaryInputManifest('linux', sha256(fs.readFileSync(snapshotFile))),
  )
  const result = spawnSync(
    process.execPath,
    [
      script,
      'platform-result',
      '--policy',
      policyFile,
      '--platform',
      'linux',
      '--migration-report',
      reportFile,
      '--input-manifest',
      manifestFile,
      '--snapshot',
      snapshotFile,
      '--run-id',
      '1234',
      '--run-attempt',
      '2',
      '--harness-sha256',
      harnessSha256,
      '--started-at',
      '2026-07-20T00:00:00Z',
      '--completed-at',
      '2026-07-20T00:00:10Z',
      '--output',
      output,
    ],
    { encoding: 'utf8' },
  )
  assert.equal(result.status, 0, result.stderr)
  const evidence = JSON.parse(fs.readFileSync(output, 'utf8'))
  assert.equal(evidence.scenario, 'fresh-a')
  assert.equal(evidence.runId, 1234)
  assert.equal(evidence.runAttempt, 2)
  assert.equal(evidence.sourceCommit, policy.candidate.sourceCommit)
  assert.equal(evidence.assets.currentAsset, undefined)
  assert.deepEqual(
    evidence.assets.compatibilityException,
    policy.platforms.linux.compatibilityException,
  )
  assert.equal(evidence.migrationReportSha256, sha256(fs.readFileSync(reportFile)))
  assert.equal(evidence.inputManifestSha256, sha256(fs.readFileSync(manifestFile)))
  assert.equal(evidence.snapshotSha256, sha256(fs.readFileSync(snapshotFile)))
  assert.equal(fs.readFileSync(output, 'utf8').endsWith('\n'), true)
})

test('aggregate produces canonical smoke/health solely from six passed server-bound attempts', () => {
  const fixture = makeAggregateFixture()
  const evidence = aggregateACanaryEvidence({
    policy,
    inputDir: fixture.inputDir,
    startReceipt: fixture.startReceipt,
    finishReceipt: fixture.finishReceipt,
    startedAt: fixture.startedAt,
    completedAt: fixture.completedAt,
    startRunId: fixture.startReceipt.id,
    finishRunId: fixture.finishReceipt.id,
  })
  assert.equal(evidence.smoke.status, 'passed')
  assert.equal(evidence.smoke.candidateTag, 'v0.6.643')
  assert.equal(evidence.smoke.canaryStartedAt, '2026-07-20T00:00:02.000Z')
  assert.equal(evidence.smoke.completedAt, '2026-07-22T00:00:05.000Z')
  assert.equal(evidence.smoke.observationScope, 'github-native-two-point-canary')
  assert.equal(evidence.smoke.sampleSize, 6)
  assert.equal(evidence.smoke.attempts, 6)
  assert.deepEqual(evidence.smoke.platforms, ['windows', 'macos', 'linux'])
  assert.deepEqual(evidence.smoke.scenarios, ['current-to-a', 'fresh-a'])
  assert.equal(evidence.health.status, 'healthy')
  assert.equal(evidence.health.p0Incidents, 0)
  assert.equal(evidence.health.p1Incidents, 0)
  assert.equal(evidence.health.dataLossIncidents, 0)
  assert.equal(evidence.health.migrationFailureRate, 0)
  assert.equal(evidence.health.observedAt, '2026-07-22T00:00:05.000Z')
})

test('aggregate CLI writes both promotion evidence files and their digests', () => {
  const fixture = makeAggregateFixture()
  const outputDir = path.join(fixture.root, 'output')
  const result = spawnSync(
    process.execPath,
    [
      script,
      'aggregate',
      '--policy',
      policyFile,
      '--input-dir',
      fixture.inputDir,
      '--start-receipt',
      fixture.startReceiptFile,
      '--finish-receipt',
      fixture.finishReceiptFile,
      '--started-at',
      fixture.startedAt,
      '--completed-at',
      fixture.completedAt,
      '--start-run-id',
      String(fixture.startReceipt.id),
      '--finish-run-id',
      String(fixture.finishReceipt.id),
      '--output-dir',
      outputDir,
    ],
    { encoding: 'utf8' },
  )
  assert.equal(result.status, 0, result.stderr)
  const summary = JSON.parse(result.stdout)
  const smoke = JSON.parse(fs.readFileSync(path.join(outputDir, 'upgrade-smoke.json'), 'utf8'))
  const health = JSON.parse(fs.readFileSync(path.join(outputDir, 'rollout-health.json'), 'utf8'))
  assert.equal(summary.smoke.sha256, sha256(fs.readFileSync(summary.smoke.file)))
  assert.equal(summary.health.sha256, sha256(fs.readFileSync(summary.health.file)))
  assert.equal(smoke.type, 'upgrade-smoke')
  assert.equal(health.type, 'rollout-health')
})

test('aggregate rejects an observation shorter than 48 artifact-anchored hours', () => {
  const fixture = makeAggregateFixture()
  for (const platform of ['windows', 'macos', 'linux']) {
    const file = path.join(fixture.inputDir, `start-${platform}-artifact.json`)
    const receipt = JSON.parse(fs.readFileSync(file, 'utf8'))
    receipt.created_at = platform === 'linux'
      ? '2026-07-20T00:00:12Z'
      : `2026-07-20T00:00:1${platform === 'windows' ? '0' : '1'}Z`
    receipt.updated_at = receipt.created_at
    writeJson(file, receipt)
  }
  assert.throws(
    () =>
      aggregateACanaryEvidence({
        policy,
        inputDir: fixture.inputDir,
        startReceipt: fixture.startReceipt,
        finishReceipt: fixture.finishReceipt,
        startedAt: '2026-07-20T00:00:12Z',
        completedAt: fixture.completedAt,
        startRunId: fixture.startReceipt.id,
        finishRunId: fixture.finishReceipt.id,
      }),
    /at least 48 hours/,
  )
})

test('aggregate rejects mismatched harnesses, workflow identity, and candidate source', () => {
  {
    const fixture = makeAggregateFixture()
    fixture.finishReceipt.harnessSha256 = 'b'.repeat(64)
    assert.throws(
      () =>
        aggregateACanaryEvidence({
          policy,
          inputDir: fixture.inputDir,
          startReceipt: fixture.startReceipt,
          finishReceipt: fixture.finishReceipt,
          startedAt: fixture.startedAt,
          completedAt: fixture.completedAt,
          startRunId: fixture.startReceipt.id,
          finishRunId: fixture.finishReceipt.id,
        }),
      /harness SHA-256 values must match/,
    )
  }
  {
    const fixture = makeAggregateFixture()
    fixture.startReceipt.path = '.github/workflows/evil.yml'
    assert.throws(
      () =>
        aggregateACanaryEvidence({
          policy,
          inputDir: fixture.inputDir,
          startReceipt: fixture.startReceipt,
          finishReceipt: fixture.finishReceipt,
          startedAt: fixture.startedAt,
          completedAt: fixture.completedAt,
          startRunId: fixture.startReceipt.id,
          finishRunId: fixture.finishReceipt.id,
        }),
      /exact A canary workflow/,
    )
  }
  {
    const fixture = makeAggregateFixture()
    const resultFile = path.join(fixture.inputDir, 'finish-windows.json')
    const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'))
    result.sourceCommit = 'f'.repeat(40)
    writeJson(resultFile, result)
    assert.throws(
      () =>
        aggregateACanaryEvidence({
          policy,
          inputDir: fixture.inputDir,
          startReceipt: fixture.startReceipt,
          finishReceipt: fixture.finishReceipt,
          startedAt: fixture.startedAt,
          completedAt: fixture.completedAt,
          startRunId: fixture.startReceipt.id,
          finishRunId: fixture.finishReceipt.id,
        }),
      /windows.sourceCommit does not match/,
    )
  }
})

test('aggregate allows unrelated main changes but binds every artifact to its exact run', () => {
  const fixture = makeAggregateFixture()
  assert.notEqual(fixture.startReceipt.head_sha, fixture.finishReceipt.head_sha)
  aggregateACanaryEvidence({
    policy,
    inputDir: fixture.inputDir,
    startReceipt: fixture.startReceipt,
    finishReceipt: fixture.finishReceipt,
    startedAt: fixture.startedAt,
    completedAt: fixture.completedAt,
    startRunId: fixture.startReceipt.id,
    finishRunId: fixture.finishReceipt.id,
  })

  const artifactFile = path.join(fixture.inputDir, 'finish-linux-artifact.json')
  const artifact = JSON.parse(fs.readFileSync(artifactFile, 'utf8'))
  artifact.workflow_run.head_sha = fixture.startReceipt.head_sha
  writeJson(artifactFile, artifact)
  assert.throws(
    () =>
      aggregateACanaryEvidence({
        policy,
        inputDir: fixture.inputDir,
        startReceipt: fixture.startReceipt,
        finishReceipt: fixture.finishReceipt,
        startedAt: fixture.startedAt,
        completedAt: fixture.completedAt,
        startRunId: fixture.startReceipt.id,
        finishRunId: fixture.finishReceipt.id,
      }),
    /not bound to the exact GitHub workflow run/,
  )
})

test('aggregate rejects invalid artifact digests, hand-entered health counters, and time claims', () => {
  {
    const fixture = makeAggregateFixture()
    const artifactFile = path.join(fixture.inputDir, 'start-macos-artifact.json')
    const artifact = JSON.parse(fs.readFileSync(artifactFile, 'utf8'))
    artifact.digest = 'sha256:not-a-digest'
    writeJson(artifactFile, artifact)
    assert.throws(
      () =>
        aggregateACanaryEvidence({
          policy,
          inputDir: fixture.inputDir,
          startReceipt: fixture.startReceipt,
          finishReceipt: fixture.finishReceipt,
          startedAt: fixture.startedAt,
          completedAt: fixture.completedAt,
          startRunId: fixture.startReceipt.id,
          finishRunId: fixture.finishReceipt.id,
        }),
      /artifact digest/,
    )
  }
  {
    const fixture = makeAggregateFixture()
    fs.appendFileSync(
      path.join(fixture.inputDir, 'finish-macos-migration.json'),
      ' ',
    )
    assert.throws(
      () =>
        aggregateACanaryEvidence({
          policy,
          inputDir: fixture.inputDir,
          startReceipt: fixture.startReceipt,
          finishReceipt: fixture.finishReceipt,
          startedAt: fixture.startedAt,
          completedAt: fixture.completedAt,
          startRunId: fixture.startReceipt.id,
          finishRunId: fixture.finishReceipt.id,
        }),
      /raw migration report SHA-256 does not match/,
    )
  }
  {
    const fixture = makeAggregateFixture()
    const resultFile = path.join(fixture.inputDir, 'start-windows.json')
    const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'))
    result.p0Incidents = 0
    result.migrationFailureRate = 0
    writeJson(resultFile, result)
    assert.throws(
      () =>
        aggregateACanaryEvidence({
          policy,
          inputDir: fixture.inputDir,
          startReceipt: fixture.startReceipt,
          finishReceipt: fixture.finishReceipt,
          startedAt: fixture.startedAt,
          completedAt: fixture.completedAt,
          startRunId: fixture.startReceipt.id,
          finishRunId: fixture.finishReceipt.id,
        }),
      /platform result keys must be exactly/,
    )
  }
  {
    const fixture = makeAggregateFixture()
    assert.throws(
      () =>
        aggregateACanaryEvidence({
          policy,
          inputDir: fixture.inputDir,
          startReceipt: fixture.startReceipt,
          finishReceipt: fixture.finishReceipt,
          startedAt: '2026-07-20T00:00:01Z',
          completedAt: fixture.completedAt,
          startRunId: fixture.startReceipt.id,
          finishRunId: fixture.finishReceipt.id,
        }),
      /started-at must exactly equal/,
    )
  }
})
