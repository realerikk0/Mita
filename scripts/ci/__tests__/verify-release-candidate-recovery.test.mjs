import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { validateReleaseCandidateRecoveryMetadata } from '../verify-release-candidate-recovery.mjs'

const SOURCE_RUN_ID = '30195339449'
const CURRENT_RUN_ID = '30199999999'
const SOURCE_HEAD = '6182782748f9133b6c4c5d19508293a1c49a1246'
const REPOSITORY = 'realerikk0/Mita'
const REPOSITORY_ID = 1225341166
const VERSION = '0.6.643'
const ARTIFACTS = Object.freeze({
  macos: Object.freeze({
    name: 'biyan-macos-universal-0.6.643',
    id: 8630480285,
    sizeInBytes: 665940900,
    digest:
      'sha256:a8ca936e8809f714f31d472a8b05e33a8302cf5c59e239dd5735fcf62a007d6a',
  }),
  windows: Object.freeze({
    name: 'biyan-windows-x64-0.6.643',
    id: 8630357925,
    sizeInBytes: 348824717,
    digest:
      'sha256:cb6dac53ef4220e7f17f53721dc3130af5a506566e7fa255528cad2a72748cb2',
  }),
  linux: Object.freeze({
    name: 'biyan-linux-x64-0.6.643',
    id: 8630273267,
    sizeInBytes: 455419029,
    digest:
      'sha256:294741b64be0b682ad04d25716ed8b367196e46982965b921d6d5e95a9948f72',
  }),
})

const jobDefinitions = [
  [
    'Validate immutable release source',
    'success',
    [
      ['Set up job', 'success'],
      ['Checkout protected release harness', 'success'],
      ['Checkout exact release target', 'success'],
      ['Setup Node', 'success'],
      ['Resolve immutable release metadata', 'success'],
      ['Verify exact tag with protected release policy', 'success'],
      ['Test protected release policy contracts', 'success'],
      ['Post Setup Node', 'success'],
      ['Post Checkout exact release target', 'success'],
      ['Post Checkout protected release harness', 'success'],
      ['Complete job', 'success'],
    ],
  ],
  [
    'Run candidate lint and test suites',
    'success',
    [
      ['Set up job', 'success'],
      ['Checkout tag', 'success'],
      ['Setup Node', 'success'],
      ['Configure Yarn', 'success'],
      ['Install Rust and Tauri system dependencies', 'success'],
      ['Run lint, TypeScript tests, and Rust tests', 'success'],
      ['Test updater candidate, promotion, and routing contracts', 'success'],
      ['Post Setup Node', 'success'],
      ['Post Checkout tag', 'success'],
      ['Complete job', 'success'],
    ],
  ],
  [
    'Build signed Linux candidate',
    'success',
    [
      ['Set up job', 'success'],
      ['Checkout tag', 'success'],
      ['Setup Node', 'success'],
      ['Configure Yarn', 'success'],
      ['Install Tauri system dependencies', 'success'],
      ['Stamp release version', 'success'],
      ['Require Biyan signing material', 'success'],
      [
        'Revalidate protected main before Linux build mutation',
        'success',
      ],
      ['Build app', 'success'],
      ['Checkout protected candidate verifier', 'success'],
      ['Verify Biyan artifacts', 'success'],
      [
        'Revalidate protected main before Linux artifact mutation',
        'success',
      ],
      ['Upload Linux candidate', 'success'],
      ['Post Checkout protected candidate verifier', 'success'],
      ['Post Setup Node', 'success'],
      ['Post Checkout tag', 'success'],
      ['Complete job', 'success'],
    ],
  ],
  [
    'Build signed macOS candidate',
    'success',
    [
      ['Set up job', 'success'],
      ['Checkout tag', 'success'],
      ['Setup Node', 'success'],
      ['Configure Yarn', 'success'],
      ['Setup Rust targets', 'success'],
      ['Stamp release version', 'success'],
      ['Require Biyan signing material', 'success'],
      ['Import Developer ID certificate', 'success'],
      [
        'Revalidate protected main before macOS build mutation',
        'success',
      ],
      ['Build app', 'success'],
      ['Checkout protected candidate verifier', 'success'],
      ['Verify macOS candidate', 'success'],
      ['Notarize and verify DMGs', 'success'],
      [
        'Revalidate protected main before macOS artifact mutation',
        'success',
      ],
      ['Upload macOS candidate', 'success'],
      ['Post Checkout protected candidate verifier', 'success'],
      ['Post Setup Node', 'success'],
      ['Post Checkout tag', 'success'],
      ['Complete job', 'success'],
    ],
  ],
  [
    'Build signed Windows candidate',
    'success',
    [
      ['Set up job', 'success'],
      ['Checkout tag', 'success'],
      ['Setup Node', 'success'],
      ['Configure Yarn', 'success'],
      ['Setup Rust and GNU make', 'success'],
      ['Stamp release version', 'success'],
      ['Require Biyan signing material', 'success'],
      [
        'Revalidate protected main before Windows build mutation',
        'success',
      ],
      ['Build app', 'success'],
      ['Checkout protected candidate verifier', 'success'],
      ['Verify Biyan artifacts', 'success'],
      ['Verify extracted Windows candidate', 'success'],
      [
        'Revalidate protected main before Windows artifact mutation',
        'success',
      ],
      ['Upload Windows candidate', 'success'],
      ['Post Checkout protected candidate verifier', 'success'],
      ['Post Setup Node', 'success'],
      ['Post Checkout tag', 'success'],
      ['Complete job', 'success'],
    ],
  ],
  [
    'Package immutable updater candidate',
    'failure',
    [
      ['Set up job', 'success'],
      ['Checkout protected release harness', 'success'],
      ['Setup Node', 'success'],
      ['Install locked Tauri signer', 'failure'],
      ['Download signed candidates', 'skipped'],
      ['Build canonical candidate manifest', 'skipped'],
      [
        'Revalidate protected main before updater artifact mutation',
        'skipped',
      ],
      ['Upload updater candidate', 'skipped'],
      ['Post Setup Node', 'skipped'],
      ['Post Checkout protected release harness', 'success'],
      ['Complete job', 'success'],
    ],
  ],
  [
    'Create draft release without promoting stable',
    'skipped',
    [],
  ],
]

function sourceJob([name, conclusion, steps], index) {
  return {
    id: 89775755349 + index,
    name,
    status: 'completed',
    conclusion,
    head_sha: SOURCE_HEAD,
    workflow_name: 'Desktop Release Candidate',
    steps: steps.map(([stepName, stepConclusion], stepIndex) => ({
      number: stepIndex + 1,
      name: stepName,
      status: 'completed',
      conclusion: stepConclusion,
    })),
  }
}

function sourceArtifact(name, id, digest, sizeInBytes, createdAt) {
  return {
    id,
    name,
    size_in_bytes: sizeInBytes,
    expired: false,
    digest,
    created_at: createdAt,
    updated_at: createdAt,
    workflow_run: {
      id: Number(SOURCE_RUN_ID),
      repository_id: REPOSITORY_ID,
      head_repository_id: REPOSITORY_ID,
      head_branch: 'mita-main',
      head_sha: SOURCE_HEAD,
    },
  }
}

function fixture() {
  return {
    run: {
      id: Number(SOURCE_RUN_ID),
      workflow_id: 273753259,
      name: 'Desktop Release Candidate',
      path: '.github/workflows/desktop-release.yml',
      event: 'workflow_dispatch',
      head_branch: 'mita-main',
      head_sha: SOURCE_HEAD,
      status: 'completed',
      conclusion: 'failure',
      run_attempt: 1,
      created_at: '2026-07-26T08:50:15Z',
      updated_at: '2026-07-26T09:52:58Z',
      repository: {
        id: REPOSITORY_ID,
        full_name: REPOSITORY,
      },
      head_repository: {
        id: REPOSITORY_ID,
        full_name: REPOSITORY,
      },
    },
    jobs: {
      total_count: jobDefinitions.length,
      jobs: jobDefinitions.map(sourceJob),
    },
    artifacts: {
      total_count: 3,
      artifacts: [
        sourceArtifact(
          ARTIFACTS.macos.name,
          ARTIFACTS.macos.id,
          ARTIFACTS.macos.digest,
          ARTIFACTS.macos.sizeInBytes,
          '2026-07-26T09:51:27Z'
        ),
        sourceArtifact(
          ARTIFACTS.windows.name,
          ARTIFACTS.windows.id,
          ARTIFACTS.windows.digest,
          ARTIFACTS.windows.sizeInBytes,
          '2026-07-26T09:38:17Z'
        ),
        sourceArtifact(
          ARTIFACTS.linux.name,
          ARTIFACTS.linux.id,
          ARTIFACTS.linux.digest,
          ARTIFACTS.linux.sizeInBytes,
          '2026-07-26T09:28:23Z'
        ),
      ],
    },
  }
}

function validate(input = fixture(), overrides = {}) {
  return validateReleaseCandidateRecoveryMetadata({
    ...input,
    sourceRunId: SOURCE_RUN_ID,
    currentRunId: CURRENT_RUN_ID,
    repository: REPOSITORY,
    version: VERSION,
    ...overrides,
  })
}

test('accepts only the exact failed package run with three verified build artifacts', () => {
  const summary = validate()
  assert.equal(summary.schema, 1)
  assert.equal(summary.sourceRunId, SOURCE_RUN_ID)
  assert.equal(summary.sourceHeadSha, SOURCE_HEAD)
  assert.equal(summary.currentRunId, CURRENT_RUN_ID)
  assert.equal(summary.repository, REPOSITORY)
  assert.equal(summary.version, VERSION)
  assert.deepEqual(
    summary.artifacts.map((artifact) => artifact.name),
    [
      `biyan-linux-x64-${VERSION}`,
      `biyan-macos-universal-${VERSION}`,
      `biyan-windows-x64-${VERSION}`,
    ]
  )
})

test('rejects unsafe run IDs, repository names, and versions', () => {
  for (const [label, overrides] of [
    ['zero source run', { sourceRunId: '0' }],
    ['leading-zero source run', { sourceRunId: '01' }],
    ['future source run', { sourceRunId: CURRENT_RUN_ID }],
    ['unsafe current run', { currentRunId: '9007199254740992' }],
    ['bad repository', { repository: '../Mita' }],
    ['prefixed version', { version: 'v0.6.643' }],
    ['leading-zero version', { version: '0.06.643' }],
    ['prerelease version', { version: '0.6.643-rc.1' }],
  ]) {
    assert.throws(() => validate(fixture(), overrides), undefined, label)
  }
})

test('rejects every consistently replaced protected source identity', () => {
  {
    const source = fixture()
    const replacement = '30195339448'
    source.run.id = Number(replacement)
    for (const artifact of source.artifacts.artifacts) {
      artifact.workflow_run.id = Number(replacement)
    }
    assert.throws(
      () => validate(source, { sourceRunId: replacement }),
      /source run ID/
    )
  }

  {
    const source = fixture()
    const replacement = 'f'.repeat(40)
    source.run.head_sha = replacement
    for (const job of source.jobs.jobs) job.head_sha = replacement
    for (const artifact of source.artifacts.artifacts) {
      artifact.workflow_run.head_sha = replacement
    }
    assert.throws(() => validate(source), /source run\.head_sha/)
  }

  {
    const source = fixture()
    const replacementRepository = 'attacker/Mita'
    source.run.repository.full_name = replacementRepository
    source.run.head_repository.full_name = replacementRepository
    assert.throws(
      () => validate(source, { repository: replacementRepository }),
      /repository/
    )
  }

  {
    const source = fixture()
    const replacementRepositoryId = 1225341167
    source.run.repository.id = replacementRepositoryId
    source.run.head_repository.id = replacementRepositoryId
    for (const artifact of source.artifacts.artifacts) {
      artifact.workflow_run.repository_id = replacementRepositoryId
      artifact.workflow_run.head_repository_id = replacementRepositoryId
    }
    assert.throws(() => validate(source), /source run\.repository\.id/)
  }

  {
    const source = fixture()
    const replacement = '0.6.644'
    for (const artifact of source.artifacts.artifacts) {
      artifact.name = artifact.name.replace(VERSION, replacement)
    }
    assert.throws(
      () => validate(source, { version: replacement }),
      /version/
    )
  }
})

test('rejects every exact artifact constant replacement', () => {
  for (let index = 0; index < 3; index += 1) {
    for (const [label, mutate] of [
      ['name', (artifact) => (artifact.name = `${artifact.name}-repacked`)],
      ['ID', (artifact) => (artifact.id += 1000)],
      [
        'size',
        (artifact) => (artifact.size_in_bytes += 1024),
      ],
      [
        'digest',
        (artifact) =>
          (artifact.digest = `sha256:${String(index + 1).repeat(64)}`),
      ],
    ]) {
      const source = fixture()
      mutate(source.artifacts.artifacts[index])
      assert.throws(
        () => validate(source),
        undefined,
        `${source.artifacts.artifacts[index].name} ${label}`
      )
    }
  }
})

test('rejects a fully self-consistent replacement recovery set', () => {
  const source = fixture()
  const replacementRunId = '30195339448'
  const replacementHead = 'e'.repeat(40)
  const replacementRepository = 'attacker/Mita'
  const replacementRepositoryId = 1225341167
  const replacementVersion = '0.6.644'

  source.run.id = Number(replacementRunId)
  source.run.head_sha = replacementHead
  source.run.repository = {
    id: replacementRepositoryId,
    full_name: replacementRepository,
  }
  source.run.head_repository = {
    id: replacementRepositoryId,
    full_name: replacementRepository,
  }
  for (const job of source.jobs.jobs) job.head_sha = replacementHead
  for (const [index, artifact] of source.artifacts.artifacts.entries()) {
    artifact.name = artifact.name.replace(VERSION, replacementVersion)
    artifact.id += 1000
    artifact.size_in_bytes += 1024
    artifact.digest = `sha256:${String(index + 4).repeat(64)}`
    artifact.workflow_run = {
      id: Number(replacementRunId),
      repository_id: replacementRepositoryId,
      head_repository_id: replacementRepositoryId,
      head_branch: 'mita-main',
      head_sha: replacementHead,
    }
  }

  assert.throws(
    () =>
      validate(source, {
        sourceRunId: replacementRunId,
        repository: replacementRepository,
        version: replacementVersion,
      })
  )
})

test('rejects every source run identity and terminal-state mutation', () => {
  const mutations = [
    ['ID', (source) => (source.run.id += 1)],
    ['workflow ID', (source) => (source.run.workflow_id += 1)],
    ['workflow name', (source) => (source.run.name = 'Other')],
    ['workflow path', (source) => (source.run.path = 'other.yml')],
    ['event', (source) => (source.run.event = 'push')],
    ['branch', (source) => (source.run.head_branch = 'main')],
    ['head SHA', (source) => (source.run.head_sha = 'f'.repeat(40))],
    ['status', (source) => (source.run.status = 'in_progress')],
    ['conclusion', (source) => (source.run.conclusion = 'success')],
    ['attempt', (source) => (source.run.run_attempt = 2)],
    [
      'repository',
      (source) => (source.run.repository.full_name = 'attacker/fork'),
    ],
    [
      'head repository',
      (source) => (source.run.head_repository.full_name = 'attacker/fork'),
    ],
    [
      'repository ID',
      (source) => (source.run.head_repository.id += 1),
    ],
    [
      'timestamps',
      (source) =>
        ([source.run.created_at, source.run.updated_at] = [
          source.run.updated_at,
          source.run.created_at,
        ]),
    ],
  ]
  for (const [label, mutate] of mutations) {
    const source = fixture()
    mutate(source)
    assert.throws(() => validate(source), undefined, label)
  }
})

test('rejects missing, duplicate, renamed, or differently concluded jobs', () => {
  for (const [label, mutate] of [
    ['missing job', (source) => source.jobs.jobs.pop()],
    [
      'duplicate job',
      (source) => (source.jobs.jobs[1].name = source.jobs.jobs[0].name),
    ],
    ['unknown job', (source) => (source.jobs.jobs[0].name = 'Unknown')],
    ['job ID', (source) => (source.jobs.jobs[1].id = source.jobs.jobs[0].id)],
    [
      'job workflow',
      (source) => (source.jobs.jobs[0].workflow_name = 'Other'),
    ],
    ['job head', (source) => (source.jobs.jobs[0].head_sha = 'f'.repeat(40))],
    ['job status', (source) => (source.jobs.jobs[0].status = 'queued')],
    ['job conclusion', (source) => (source.jobs.jobs[0].conclusion = 'failure')],
  ]) {
    const source = fixture()
    mutate(source)
    assert.throws(() => validate(source), undefined, label)
  }
})

test('rejects every source step mutation and any extra step', () => {
  for (const [jobIndex, definition] of jobDefinitions.entries()) {
    const [, , expectedSteps] = definition
    for (let stepIndex = 0; stepIndex < expectedSteps.length; stepIndex += 1) {
      for (const [label, mutate] of [
        ['name', (step) => (step.name = `${step.name} forged`)],
        ['status', (step) => (step.status = 'in_progress')],
        [
          'conclusion',
          (step) =>
            (step.conclusion =
              step.conclusion === 'success' ? 'failure' : 'success'),
        ],
        ['number', (step) => (step.number = 0)],
      ]) {
        const source = fixture()
        mutate(source.jobs.jobs[jobIndex].steps[stepIndex])
        assert.throws(
          () => validate(source),
          undefined,
          `${definition[0]} ${expectedSteps[stepIndex][0]} ${label}`
        )
      }
    }
    const withExtra = fixture()
    withExtra.jobs.jobs[jobIndex].steps.push({
      number: 999,
      name: 'Untrusted extra step',
      status: 'completed',
      conclusion: 'success',
    })
    assert.throws(
      () => validate(withExtra),
      undefined,
      `${definition[0]} extra step`
    )
  }
})

test('rejects every source artifact identity, digest, and provenance mutation', () => {
  for (const [label, mutate] of [
    ['missing artifact', (source) => source.artifacts.artifacts.pop()],
    [
      'duplicate artifact name',
      (source) =>
        (source.artifacts.artifacts[1].name =
          source.artifacts.artifacts[0].name),
    ],
    [
      'wrong version',
      (source) =>
        (source.artifacts.artifacts[0].name =
          'biyan-macos-universal-0.6.644'),
    ],
    ['duplicate ID', (source) => (source.artifacts.artifacts[1].id = source.artifacts.artifacts[0].id)],
    ['expired', (source) => (source.artifacts.artifacts[0].expired = true)],
    ['small', (source) => (source.artifacts.artifacts[0].size_in_bytes = 1)],
    ['digest', (source) => (source.artifacts.artifacts[0].digest = 'sha256:no')],
    [
      'duplicate digest',
      (source) =>
        (source.artifacts.artifacts[1].digest =
          source.artifacts.artifacts[0].digest),
    ],
    [
      'workflow run',
      (source) => (source.artifacts.artifacts[0].workflow_run.id += 1),
    ],
    [
      'workflow head',
      (source) =>
        (source.artifacts.artifacts[0].workflow_run.head_sha =
          'f'.repeat(40)),
    ],
    [
      'workflow repository',
      (source) =>
        (source.artifacts.artifacts[0].workflow_run.repository_id += 1),
    ],
    [
      'artifact timestamp',
      (source) =>
        (source.artifacts.artifacts[0].updated_at =
          '2026-07-27T09:51:27Z'),
    ],
  ]) {
    const source = fixture()
    mutate(source)
    assert.throws(() => validate(source), undefined, label)
  }
})

test('CLI writes a new private summary file and rejects overwrites', () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'biyan-release-recovery-')
  )
  const source = fixture()
  const files = {
    run: path.join(root, 'run.json'),
    jobs: path.join(root, 'jobs.json'),
    artifacts: path.join(root, 'artifacts.json'),
  }
  for (const [name, file] of Object.entries(files)) {
    fs.writeFileSync(file, JSON.stringify(source[name]))
  }
  const output = path.join(root, 'summary.json')
  const entry = new URL(
    '../verify-release-candidate-recovery.mjs',
    import.meta.url
  )
  const args = [
    entry.pathname,
    '--run',
    files.run,
    '--jobs',
    files.jobs,
    '--artifacts',
    files.artifacts,
    '--source-run-id',
    SOURCE_RUN_ID,
    '--current-run-id',
    CURRENT_RUN_ID,
    '--repository',
    REPOSITORY,
    '--version',
    VERSION,
    '--output',
    output,
  ]
  const first = spawnSync(process.execPath, args, {
    encoding: 'utf8',
  })
  assert.equal(first.status, 0, first.stderr)
  const summary = JSON.parse(fs.readFileSync(output, 'utf8'))
  assert.equal(summary.sourceRunId, SOURCE_RUN_ID)
  assert.equal(fs.statSync(output).mode & 0o777, 0o600)

  const second = spawnSync(process.execPath, args, {
    encoding: 'utf8',
  })
  assert.notEqual(second.status, 0)
  assert.match(second.stderr, /EEXIST/)
})
