import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { validateQualificationRecoveryMetadata } from '../verify-qualification-recovery.mjs'

const SOURCE_RUN_ID = '30109722285'
const SOURCE_RUN_NUMBER = Number(SOURCE_RUN_ID)
const REPOSITORY = 'realerikk0/Mita'
const REPOSITORY_ID = 1225341166
const SOURCE_HEAD = '1'.repeat(40)
const TARGET = '2'.repeat(40)
const BASE = '3'.repeat(40)

const JOB_CONCLUSIONS = new Map([
  ['Trusted impact and focused preflight', 'success'],
  ['Build documentation without publishing', 'success'],
  ['Native Linux x86_64 qualification', 'success'],
  ['Native Windows AMD64 qualification', 'success'],
  ['Native macOS Intel qualification', 'success'],
  ['Verify retained qualification artifacts', 'skipped'],
  ['Hash qualification build artifacts', 'failure'],
  ['Exact-SHA qualification gate', 'failure'],
])

const AGGREGATE_JOB = 'Hash qualification build artifacts'
const AGGREGATE_STEPS = [
  ['Checkout protected artifact manifest tool', 'success'],
  ['Checkout exact target verifier separately', 'success'],
  ['Set up trusted Node runtime', 'success'],
  ['Download authenticated replay base', 'skipped'],
  ["Download this run's Linux evidence", 'success'],
  ["Download this run's Windows evidence", 'success'],
  ["Download this run's macOS evidence", 'success'],
  ['Compose complete chain-forward artifact set', 'success'],
  ['Create immutable qualification artifact manifest', 'failure'],
  ['Upload hash-pinned aggregate qualification artifact', 'skipped'],
]

const ARTIFACTS = {
  linux: {
    id: 8603933722,
    bytes: 452481560,
    digest: `sha256:${'a'.repeat(64)}`,
    expiresAt: '2026-08-23T17:12:28Z',
  },
  windows: {
    id: 8604127912,
    bytes: 348957290,
    digest: `sha256:${'b'.repeat(64)}`,
    expiresAt: '2026-08-23T17:20:18Z',
  },
  macos: {
    id: 8605204166,
    bytes: 660427540,
    digest: `sha256:${'c'.repeat(64)}`,
    expiresAt: '2026-08-23T18:02:50Z',
  },
}

function fixture() {
  const aggregateSteps = AGGREGATE_STEPS.map(
    ([name, conclusion], index) => ({
      number: index + 1,
      name,
      status: 'completed',
      conclusion,
    })
  )
  const jobs = [...JOB_CONCLUSIONS].map(
    ([name, conclusion], index) => ({
      id: 89535000000 + index,
      name,
      status: 'completed',
      conclusion,
      run_attempt: 1,
      ...(name === AGGREGATE_JOB ? { steps: aggregateSteps } : {}),
    })
  )
  const artifacts = ['macos', 'windows', 'linux'].map((platform) => ({
    id: ARTIFACTS[platform].id,
    name: `qualification-build-${platform}-${SOURCE_RUN_ID}`,
    size_in_bytes: ARTIFACTS[platform].bytes,
    digest: ARTIFACTS[platform].digest,
    expired: false,
    expires_at: ARTIFACTS[platform].expiresAt,
    workflow_run: {
      id: SOURCE_RUN_NUMBER,
      repository_id: REPOSITORY_ID,
      head_repository_id: REPOSITORY_ID,
      head_branch: 'mita-main',
      head_sha: SOURCE_HEAD,
    },
  }))
  return {
    run: {
      id: SOURCE_RUN_NUMBER,
      event: 'workflow_dispatch',
      head_branch: 'mita-main',
      head_sha: SOURCE_HEAD,
      path: '.github/workflows/biyan-exact-sha-qualification.yml',
      status: 'completed',
      conclusion: 'failure',
      run_attempt: 1,
      repository: {
        id: REPOSITORY_ID,
        full_name: REPOSITORY,
      },
      head_repository: {
        id: REPOSITORY_ID,
        full_name: REPOSITORY,
      },
    },
    jobs: { total_count: jobs.length, jobs },
    artifacts: { total_count: artifacts.length, artifacts },
  }
}

function validate(source = fixture(), overrides = {}) {
  return validateQualificationRecoveryMetadata({
    ...source,
    sourceRunId: SOURCE_RUN_ID,
    repository: REPOSITORY,
    targetSha: TARGET,
    baseSha: BASE,
    ...overrides,
  })
}

function mutation(source, mutate) {
  const cloned = structuredClone(source)
  mutate(cloned)
  return cloned
}

function aggregateJob(source) {
  return source.jobs.jobs.find((job) => job.name === AGGREGATE_JOB)
}

function aggregateStep(source, name) {
  return aggregateJob(source).steps.find((step) => step.name === name)
}

test('accepts only the exact failed bootstrap shape and emits a compact summary', () => {
  const summary = validate()
  assert.deepEqual(summary, {
    sourceRunId: SOURCE_RUN_ID,
    sourceHeadSha: SOURCE_HEAD,
    repository: REPOSITORY,
    targetSha: TARGET,
    baseSha: BASE,
    artifacts: ['linux', 'windows', 'macos'].map((platform) => ({
      id: ARTIFACTS[platform].id,
      name: `qualification-build-${platform}-${SOURCE_RUN_ID}`,
      bytes: ARTIFACTS[platform].bytes,
      digest: ARTIFACTS[platform].digest,
      expiresAt: ARTIFACTS[platform].expiresAt,
    })),
  })
  assert.equal(JSON.stringify(summary).includes('\n'), false)
})

test('rejects invalid expected recovery identities', () => {
  for (const [label, overrides] of [
    ['zero run ID', { sourceRunId: '0' }],
    ['leading-zero run ID', { sourceRunId: '01' }],
    ['fractional run ID', { sourceRunId: '1.5' }],
    ['unsafe run ID', { sourceRunId: '9007199254740992' }],
    ['malformed repository', { repository: 'realerikk0' }],
    ['wrong repository', { repository: 'attacker/Mita' }],
    ['short target SHA', { targetSha: '2'.repeat(39) }],
    ['non-hex base SHA', { baseSha: 'z'.repeat(40) }],
  ]) {
    assert.throws(() => validate(fixture(), overrides), undefined, label)
  }
})

test('rejects every source run identity and terminal-state mutation', () => {
  for (const [label, mutate] of [
    ['run ID', (source) => (source.run.id += 1)],
    ['event', (source) => (source.run.event = 'push')],
    ['branch', (source) => (source.run.head_branch = 'main')],
    ['workflow path', (source) => (source.run.path = '.github/workflows/other.yml')],
    ['status', (source) => (source.run.status = 'in_progress')],
    ['conclusion', (source) => (source.run.conclusion = 'success')],
    ['attempt', (source) => (source.run.run_attempt = 2)],
    ['head SHA', (source) => (source.run.head_sha = 'short')],
    [
      'repository name',
      (source) => (source.run.repository.full_name = 'attacker/Mita'),
    ],
    [
      'head repository name',
      (source) => (source.run.head_repository.full_name = 'attacker/Mita'),
    ],
    ['repository ID', (source) => (source.run.repository.id = 0)],
    [
      'head repository ID',
      (source) => (source.run.head_repository.id += 1),
    ],
  ]) {
    assert.throws(
      () => validate(mutation(fixture(), mutate)),
      undefined,
      label
    )
  }
})

test('requires exactly one of every expected source job and no other job', () => {
  for (const [label, mutate] of [
    [
      'jobs count mismatch',
      (source) => {
        source.jobs.total_count += 1
      },
    ],
    [
      'missing job',
      (source) => {
        source.jobs.jobs.pop()
        source.jobs.total_count -= 1
      },
    ],
    [
      'unexpected job',
      (source) => {
        source.jobs.jobs[0].name = 'Attacker-controlled job'
      },
    ],
    [
      'duplicate name',
      (source) => {
        source.jobs.jobs[1].name = source.jobs.jobs[0].name
      },
    ],
    [
      'duplicate ID',
      (source) => {
        source.jobs.jobs[1].id = source.jobs.jobs[0].id
      },
    ],
    [
      'non-terminal job',
      (source) => {
        source.jobs.jobs[0].status = 'in_progress'
      },
    ],
    [
      'rerun job',
      (source) => {
        source.jobs.jobs[0].run_attempt = 2
      },
    ],
  ]) {
    assert.throws(
      () => validate(mutation(fixture(), mutate)),
      undefined,
      label
    )
  }

  for (const [name, expected] of JOB_CONCLUSIONS) {
    const source = fixture()
    const job = source.jobs.jobs.find((item) => item.name === name)
    job.conclusion = expected === 'success' ? 'failure' : 'success'
    assert.throws(() => validate(source), undefined, `wrong outcome for ${name}`)
  }
})

test('pins the aggregate failure to successful downloads and composition', () => {
  for (const [name, expected] of AGGREGATE_STEPS) {
    const source = fixture()
    aggregateStep(source, name).conclusion =
      expected === 'success' ? 'failure' : 'success'
    assert.throws(() => validate(source), undefined, `wrong outcome for ${name}`)
  }

  for (const [label, mutate] of [
    [
      'missing required step',
      (source) => {
        aggregateJob(source).steps = aggregateJob(source).steps.slice(1)
      },
    ],
    [
      'duplicate step name',
      (source) => {
        aggregateJob(source).steps[1].name = aggregateJob(source).steps[0].name
      },
    ],
    [
      'duplicate step number',
      (source) => {
        aggregateJob(source).steps[1].number =
          aggregateJob(source).steps[0].number
      },
    ],
    [
      'required step pending',
      (source) => {
        aggregateJob(source).steps[0].status = 'in_progress'
      },
    ],
  ]) {
    assert.throws(
      () => validate(mutation(fixture(), mutate)),
      undefined,
      label
    )
  }
})

test('requires exactly three immutable, live, hash-addressed artifacts', () => {
  for (const [label, mutate] of [
    [
      'artifact count mismatch',
      (source) => {
        source.artifacts.total_count += 1
      },
    ],
    [
      'missing artifact',
      (source) => {
        source.artifacts.artifacts.pop()
        source.artifacts.total_count -= 1
      },
    ],
    [
      'wrong exact name',
      (source) => {
        source.artifacts.artifacts[0].name = 'qualification-build-macos-other'
      },
    ],
    [
      'duplicate name',
      (source) => {
        source.artifacts.artifacts[1].name =
          source.artifacts.artifacts[0].name
      },
    ],
    [
      'zero ID',
      (source) => {
        source.artifacts.artifacts[0].id = 0
      },
    ],
    [
      'duplicate ID',
      (source) => {
        source.artifacts.artifacts[1].id =
          source.artifacts.artifacts[0].id
      },
    ],
    [
      'zero size',
      (source) => {
        source.artifacts.artifacts[0].size_in_bytes = 0
      },
    ],
    [
      'fractional size',
      (source) => {
        source.artifacts.artifacts[0].size_in_bytes = 1.5
      },
    ],
    [
      'wrong digest algorithm',
      (source) => {
        source.artifacts.artifacts[0].digest = `sha512:${'a'.repeat(64)}`
      },
    ],
    [
      'uppercase digest',
      (source) => {
        source.artifacts.artifacts[0].digest =
          `sha256:${'A'.repeat(64)}`
      },
    ],
    [
      'expired artifact',
      (source) => {
        source.artifacts.artifacts[0].expired = true
      },
    ],
    [
      'invalid expiry',
      (source) => {
        source.artifacts.artifacts[0].expires_at = 'not-a-date'
      },
    ],
    [
      'date-only expiry',
      (source) => {
        source.artifacts.artifacts[0].expires_at = '2026-08-23'
      },
    ],
  ]) {
    assert.throws(
      () => validate(mutation(fixture(), mutate)),
      undefined,
      label
    )
  }
})

test('binds every artifact to the exact source workflow identity', () => {
  for (const [label, mutate] of [
    [
      'workflow run ID',
      (source) => {
        source.artifacts.artifacts[0].workflow_run.id += 1
      },
    ],
    [
      'workflow branch',
      (source) => {
        source.artifacts.artifacts[0].workflow_run.head_branch = 'main'
      },
    ],
    [
      'workflow head',
      (source) => {
        source.artifacts.artifacts[0].workflow_run.head_sha = '4'.repeat(40)
      },
    ],
    [
      'workflow repository ID',
      (source) => {
        source.artifacts.artifacts[0].workflow_run.repository_id += 1
      },
    ],
    [
      'workflow head repository ID',
      (source) => {
        source.artifacts.artifacts[0].workflow_run.head_repository_id += 1
      },
    ],
    [
      'missing workflow identity',
      (source) => {
        delete source.artifacts.artifacts[0].workflow_run
      },
    ],
  ]) {
    assert.throws(
      () => validate(mutation(fixture(), mutate)),
      undefined,
      label
    )
  }
})

test('CLI writes compact JSON and append-only GitHub outputs', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'biyan-recovery-cli-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const source = fixture()
  const runFile = path.join(root, 'run.json')
  const jobsFile = path.join(root, 'jobs.json')
  const artifactsFile = path.join(root, 'artifacts.json')
  const outputFile = path.join(root, 'out', 'summary.json')
  const githubOutput = path.join(root, 'github-output.txt')
  fs.writeFileSync(runFile, JSON.stringify(source.run))
  fs.writeFileSync(jobsFile, JSON.stringify(source.jobs))
  fs.writeFileSync(artifactsFile, JSON.stringify(source.artifacts))
  fs.writeFileSync(githubOutput, 'existing=value\n')

  const script = fileURLToPath(
    new URL('../verify-qualification-recovery.mjs', import.meta.url)
  )
  const result = childProcess.spawnSync(
    process.execPath,
    [
      script,
      '--run',
      runFile,
      '--jobs',
      jobsFile,
      '--artifacts',
      artifactsFile,
      '--source-run-id',
      SOURCE_RUN_ID,
      '--repository',
      REPOSITORY,
      '--target-sha',
      TARGET.toUpperCase(),
      '--base-sha',
      BASE.toUpperCase(),
      '--output',
      outputFile,
      '--github-output',
      githubOutput,
    ],
    { encoding: 'utf8' }
  )
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stderr, '')

  const stdout = result.stdout.trimEnd()
  assert.equal(stdout.includes('\n'), false)
  const summary = JSON.parse(stdout)
  assert.deepEqual(JSON.parse(fs.readFileSync(outputFile, 'utf8')), summary)
  assert.equal(summary.targetSha, TARGET)
  assert.equal(summary.baseSha, BASE)

  const githubLines = fs.readFileSync(githubOutput, 'utf8').trimEnd().split('\n')
  assert.equal(githubLines[0], 'existing=value')
  assert.ok(githubLines.includes(`source_head_sha=${SOURCE_HEAD}`))
  const summaryLine = githubLines.find((line) => line.startsWith('summary_json='))
  assert.deepEqual(JSON.parse(summaryLine.slice('summary_json='.length)), summary)
})

test('CLI rejects malformed input, duplicate options, and input clobbering', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'biyan-recovery-bad-cli-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const source = fixture()
  const runFile = path.join(root, 'run.json')
  const malformedRunFile = path.join(root, 'malformed-run.json')
  const jobsFile = path.join(root, 'jobs.json')
  const artifactsFile = path.join(root, 'artifacts.json')
  fs.writeFileSync(runFile, JSON.stringify(source.run))
  fs.writeFileSync(malformedRunFile, '{')
  fs.writeFileSync(jobsFile, JSON.stringify(source.jobs))
  fs.writeFileSync(artifactsFile, JSON.stringify(source.artifacts))

  const script = fileURLToPath(
    new URL('../verify-qualification-recovery.mjs', import.meta.url)
  )
  const baseArgs = [
    script,
    '--run',
    runFile,
    '--jobs',
    jobsFile,
    '--artifacts',
    artifactsFile,
    '--source-run-id',
    SOURCE_RUN_ID,
    '--repository',
    REPOSITORY,
    '--target-sha',
    TARGET,
    '--base-sha',
    BASE,
  ]
  for (const [label, args] of [
    [
      'malformed JSON',
      baseArgs.map((value) => (value === runFile ? malformedRunFile : value)),
    ],
    ['duplicate option', [...baseArgs, '--repository', REPOSITORY]],
    ['unknown option', [...baseArgs, '--unknown', 'value']],
    ['input clobber', [...baseArgs, '--output', runFile]],
  ]) {
    const result = childProcess.spawnSync(process.execPath, args, {
      encoding: 'utf8',
    })
    assert.notEqual(result.status, 0, label)
    assert.equal(result.stdout, '', label)
  }
})
