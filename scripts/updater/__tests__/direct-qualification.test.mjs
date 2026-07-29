import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  aggregateDirectQualificationEvidence,
  buildDirectQualificationLaneResult,
  loadDirectQualificationPolicy,
  validateDirectQualificationPolicy,
} from '../direct-qualification-evidence.mjs'

const testDir = path.dirname(fileURLToPath(import.meta.url))
const updaterDir = path.resolve(testDir, '..')
const repositoryRoot = path.resolve(updaterDir, '..', '..')
const script = path.join(updaterDir, 'direct-qualification-evidence.mjs')
const policyFile = path.join(updaterDir, 'direct-qualification-policy.json')
const workflowFile = path.join(
  repositoryRoot,
  '.github',
  'workflows',
  'biyan-direct-qualification.yml',
)
const promotionWorkflowFile = path.join(
  repositoryRoot,
  '.github',
  'workflows',
  'promote-desktop-update.yml',
)
const trackedPolicy = loadDirectQualificationPolicy(policyFile)
const harnessSha256 = 'a'.repeat(64)
const repositoryId = 1225341166

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function pinnedPolicy() {
  const policy = clone(trackedPolicy)
  policy.state = 'candidate-pinned'
  policy.candidate.manifestSha256 = 'b'.repeat(64)
  for (const [index, platform] of ['windows', 'macos', 'linux'].entries()) {
    policy.candidate.assets[platform].sha256 = String(index + 1).repeat(64)
  }
  return validateDirectQualificationPolicy(policy, { requirePinned: true })
}

function migrationReport(lane) {
  const installSequence =
    lane.scenario === 'fresh-c' ? ['c'] : [lane.sourceRole, 'c']
  return {
    schema: 1,
    platform: lane.platform,
    scenarios: [lane.scenario],
    status: 'passed',
    matrix: [
      {
        scenario: lane.scenario,
        platform: lane.platform,
        snapshot: lane.snapshot,
        installSequence,
        expectedPhase: 'c',
        status: 'passed',
        durationSeconds: 12.5,
      },
    ],
  }
}

function inputManifest(policy, lane, snapshotSha256) {
  const installers = {
    c: { sha256: policy.candidate.assets[lane.platform].sha256 },
  }
  if (lane.sourceVersion !== null) {
    installers[lane.sourceRole] = {
      sha256: policy.sources[lane.sourceVersion].assets[lane.platform].sha256,
    }
  }
  const configRoots = {
    windows: '%APPDATA%/Biyan',
    macos: '$HOME/Library/Application Support/Biyan',
    linux: '$HOME/.local/share/Biyan',
  }
  const legacyDataRoots = {
    windows: '%APPDATA%/Mita/data',
    macos: '$HOME/Library/Application Support/Mita/data',
    linux: '$HOME/.local/share/Mita/data',
  }
  const biyanDataRoot = `${configRoots[lane.platform]}/data`
  const restoreRoot = ['0.6.608', '0.6.611', '0.6.633'].includes(
    lane.sourceVersion,
  )
    ? legacyDataRoots[lane.platform]
    : biyanDataRoot
  const qualificationMode =
    lane.scenario === 'fresh-c'
      ? 'fresh-install'
      : policy.sources[lane.sourceVersion]?.qualificationMode ??
        'automatic-updater'
  return {
    schema: 1,
    sanitized: true,
    platform: lane.platform,
    scenario: lane.scenario,
    qualificationMode,
    lane: lane.id,
    installers,
    snapshots: {
      [lane.snapshot]: {
        archive: `snapshots/${lane.snapshot}.zip`,
        sha256: snapshotSha256,
        restore_to: restoreRoot,
      },
    },
    expectations: Object.fromEntries(
      [
        ...(['a', 'b'].includes(lane.sourceRole) ? [lane.sourceRole] : []),
        'c',
      ].map((phase) => [
        phase,
        [
          `${configRoots[lane.platform]}/migration-state.json`,
          ...(lane.scenario === 'fresh-c'
            ? []
            : [
                `${biyanDataRoot}/agent-workspaces/direct-qualification-preserved.txt`,
              ]),
        ],
      ]),
    ),
  }
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

function runReceipt() {
  return {
    harnessSha256,
    run: {
      id: 777,
      name: 'Biyan Direct Qualification',
      path: '.github/workflows/biyan-direct-qualification.yml',
      event: 'workflow_dispatch',
      status: 'in_progress',
      conclusion: null,
      head_branch: 'mita-main',
      head_sha: 'c'.repeat(40),
      run_attempt: 1,
      run_started_at: '2026-07-29T00:00:00Z',
      repository: { id: repositoryId, full_name: 'realerikk0/Mita' },
      head_repository: { id: repositoryId, full_name: 'realerikk0/Mita' },
    },
  }
}

function artifactReceipt(lane, index) {
  return {
    id: 1000 + index,
    name: `direct-qualification-${lane.id}-777-1`,
    size_in_bytes: 4096,
    expired: false,
    digest: `sha256:${sha256(`artifact-${lane.id}`)}`,
    created_at: '2026-07-29T00:02:00Z',
    workflow_run: {
      id: 777,
      repository_id: repositoryId,
      head_repository_id: repositoryId,
      head_branch: 'mita-main',
      head_sha: 'c'.repeat(40),
    },
  }
}

function aggregateFixture() {
  const policy = pinnedPolicy()
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'biyan-direct-qualification-'))
  const artifacts = []
  for (const [index, lane] of policy.lanes.entries()) {
    const report = migrationReport(lane)
    const reportFile = path.join(root, `${lane.id}-migration.json`)
    writeJson(reportFile, report)
    const snapshotFile = path.join(root, `${lane.id}-snapshot.zip`)
    fs.writeFileSync(snapshotFile, `sanitized-${lane.id}`)
    const manifest = inputManifest(
      policy,
      lane,
      sha256(fs.readFileSync(snapshotFile)),
    )
    const manifestFile = path.join(root, `${lane.id}-manifest.json`)
    writeJson(manifestFile, manifest)
    const result = buildDirectQualificationLaneResult({
      policy,
      laneId: lane.id,
      migrationReport: report,
      migrationReportSha256: sha256(fs.readFileSync(reportFile)),
      inputManifest: manifest,
      inputManifestSha256: sha256(fs.readFileSync(manifestFile)),
      snapshotSha256: sha256(fs.readFileSync(snapshotFile)),
      runId: 777,
      runAttempt: 1,
      harnessSha256,
      startedAt: '2026-07-29T00:00:10Z',
      completedAt: '2026-07-29T00:01:00Z',
    })
    writeJson(path.join(root, `${lane.id}.json`), result)
    artifacts.push(artifactReceipt(lane, index))
  }
  return { root, policy, artifacts }
}

test('repository policy pins the reviewed candidate while an awaiting policy remains fail-closed', () => {
  assert.equal(trackedPolicy.state, 'candidate-pinned')
  assert.doesNotThrow(() =>
    validateDirectQualificationPolicy(trackedPolicy, { requirePinned: true }),
  )
  const result = spawnSync(
    process.execPath,
    [script, 'validate-policy', '--policy', policyFile],
    { encoding: 'utf8' },
  )
  assert.equal(result.status, 0, result.stderr)

  const awaiting = clone(trackedPolicy)
  awaiting.state = 'awaiting-candidate-pin'
  awaiting.candidate.manifestSha256 = null
  for (const platform of ['windows', 'macos', 'linux']) {
    awaiting.candidate.assets[platform].sha256 = null
  }
  assert.throws(
    () => validateDirectQualificationPolicy(awaiting, { requirePinned: true }),
    /policy\.state=candidate-pinned/,
  )
})

test('candidate pin must be complete and bound to the exact product source commit', () => {
  const partial = clone(trackedPolicy)
  partial.state = 'awaiting-candidate-pin'
  partial.candidate.manifestSha256 = 'd'.repeat(64)
  for (const platform of ['windows', 'macos', 'linux']) {
    partial.candidate.assets[platform].sha256 = null
  }
  assert.throws(
    () => validateDirectQualificationPolicy(partial),
    /may not contain partial release hashes/,
  )

  const policy = pinnedPolicy()
  assert.equal(
    policy.candidate.sourceCommit,
    '581ebf6b19ef407a9645d0b318792f1012f8f75b',
  )
  policy.candidate.sourceCommit = 'e'.repeat(40)
  assert.throws(
    () => validateDirectQualificationPolicy(policy, { requirePinned: true }),
    /reviewed contract/,
  )
})

test('aggregation requires exactly the reviewed 16 GitHub-native lanes', () => {
  const fixture = aggregateFixture()
  const evidence = aggregateDirectQualificationEvidence({
    policy: fixture.policy,
    inputDir: fixture.root,
    runReceipt: runReceipt(),
    artifactsResponse: { artifacts: fixture.artifacts },
  })
  assert.equal(evidence.smoke.status, 'passed')
  assert.equal(evidence.smoke.deploymentMode, 'direct-c')
  assert.equal(evidence.smoke.sampleSize, 16)
  assert.equal(evidence.smoke.results.length, 16)
  assert.equal(evidence.smoke.automaticUpgradeFloor, '0.6.611')
  assert.equal(evidence.smoke.manualCompatibilityFloor, '0.6.608')
  assert.deepEqual(
    evidence.smoke.results.map((result) => result.lane),
    fixture.policy.lanes.map((lane) => lane.id),
  )
  assert.equal(evidence.health.status, 'healthy')
  assert.equal(evidence.health.failedAttempts, 0)

  assert.throws(
    () =>
      aggregateDirectQualificationEvidence({
        policy: fixture.policy,
        inputDir: fixture.root,
        runReceipt: runReceipt(),
        artifactsResponse: { artifacts: fixture.artifacts.slice(1) },
      }),
    /exactly one GitHub artifact/,
  )
})

test('A and B lanes require source-aware data roots and both phase expectations', () => {
  const policy = pinnedPolicy()
  for (const phase of ['a', 'b']) {
    const lane = policy.lanes.find(
      (entry) => entry.id === `${phase}-to-c-windows`,
    )
    const snapshotSha256 = 'd'.repeat(64)
    const manifest = inputManifest(policy, lane, snapshotSha256)
    assert.equal(manifest.snapshots[phase].restore_to, '%APPDATA%/Biyan/data')
    assert.deepEqual(Object.keys(manifest.expectations), [phase, 'c'])

    const build = () =>
      buildDirectQualificationLaneResult({
        policy,
        laneId: lane.id,
        migrationReport: migrationReport(lane),
        migrationReportSha256: 'e'.repeat(64),
        inputManifest: manifest,
        inputManifestSha256: 'f'.repeat(64),
        snapshotSha256,
        runId: 777,
        runAttempt: 1,
        harnessSha256,
        startedAt: '2026-07-29T00:00:00Z',
        completedAt: '2026-07-29T00:01:00Z',
      })
    assert.doesNotThrow(build)
    delete manifest.expectations[phase]
    assert.throws(build, /expectations/)
  }
})

test('workflow confines Draft read authority to one read-only command envelope', () => {
  const source = fs.readFileSync(workflowFile, 'utf8')
  assert.match(
    source,
    /^permissions:\n  actions: read\n  contents: read$/m,
  )
  const writeGrants = source.match(/^\s{6}contents: write$/gm) ?? []
  assert.equal(writeGrants.length, 1)
  const stageStart = source.indexOf('\n  stage-candidate:\n')
  const qualificationStart = source.indexOf('\n  qualification:\n')
  assert.ok(stageStart >= 0 && qualificationStart > stageStart)
  const stage = source.slice(stageStart, qualificationStart)
  assert.match(stage, /\n    permissions:\n      actions: read\n      contents: write\n/)
  assert.doesNotMatch(stage, /\n    environment:/)
  assert.match(stage, /persist-credentials: false/)
  assert.match(stage, /\bgh api\b/)
  assert.match(stage, /--paginate/)
  assert.match(stage, /--slurp/)
  assert.match(stage, /releases\?per_page=100/)
  assert.equal(
    [...stage.matchAll(/\(\$matches \| length\) == 1/g)].length,
    2,
  )
  assert.match(stage, /releases\/\$\{release_id\}/)
  assert.match(stage, /\.id == \$release_id/)
  assert.match(stage, /\.tag_name == \$tag/)
  assert.match(stage, /\.target_commitish == \$commit/)
  assert.match(stage, /\.draft == true/)
  assert.match(stage, /\.prerelease == false/)
  assert.match(stage, /\.published_at == null/)
  assert.match(stage, /Accept: application\/octet-stream/)
  assert.match(stage, /releases\/assets\/\$\{asset_id\}/)
  assert.match(stage, /Candidate asset bytes do not match REST metadata/)
  assert.doesNotMatch(stage, /releases\/tags\//)
  assert.doesNotMatch(stage, /\bgh release download\b/)
  assert.doesNotMatch(
    stage,
    /\bgh\s+(release\s+(create|edit|delete|upload)|api\s+--method|api\s+-X)\b/,
  )
  const remainder = `${source.slice(0, stageStart)}${source.slice(qualificationStart)}`
  assert.doesNotMatch(remainder, /^\s{6}contents: write$/m)
  assert.doesNotMatch(source, /release-distribution/)
})

test('live promotion exposes only DIRECT_C and RECOVERY and requires exact 16 of 16', () => {
  const source = fs.readFileSync(promotionWorkflowFile, 'utf8')
  assert.match(source, /options: \[DIRECT_C, RECOVERY\]/)
  assert.doesNotMatch(source, /options: \[A, B, C, RECOVERY\]/)
  assert.doesNotMatch(source, /"Biyan A Canary"/)
  assert.match(source, /"Biyan Direct Qualification"/)
  assert.match(source, /github-native-direct-qualification/)
  assert.match(source, /\.sampleSize == 16/)
  assert.match(source, /\(\.results \| length\) == 16/)
  assert.match(source, /\.failedAttempts == 0/)
  assert.match(
    source,
    /node scripts\/updater\/direct-qualification-evidence\.mjs validate-policy/,
  )
})
