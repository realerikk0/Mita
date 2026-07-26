#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const WORKFLOW_ID = 273753259
const WORKFLOW_NAME = 'Desktop Release Candidate'
const WORKFLOW_PATH = '.github/workflows/desktop-release.yml'
const SOURCE_BRANCH = 'mita-main'
const APPROVED_SOURCE = Object.freeze({
  runId: '30195339449',
  headSha: '6182782748f9133b6c4c5d19508293a1c49a1246',
  repository: 'realerikk0/Mita',
  repositoryId: 1225341166,
  version: '0.6.643',
})
const APPROVED_ARTIFACTS = Object.freeze({
  'biyan-linux-x64-0.6.643': Object.freeze({
    id: 8630273267,
    sizeInBytes: 455419029,
    digest:
      'sha256:294741b64be0b682ad04d25716ed8b367196e46982965b921d6d5e95a9948f72',
  }),
  'biyan-macos-universal-0.6.643': Object.freeze({
    id: 8630480285,
    sizeInBytes: 665940900,
    digest:
      'sha256:a8ca936e8809f714f31d472a8b05e33a8302cf5c59e239dd5735fcf62a007d6a',
  }),
  'biyan-windows-x64-0.6.643': Object.freeze({
    id: 8630357925,
    sizeInBytes: 348824717,
    digest:
      'sha256:cb6dac53ef4220e7f17f53721dc3130af5a506566e7fa255528cad2a72748cb2',
  }),
})
const COMMIT = /^[0-9a-fA-F]{40}$/
const DIGEST = /^sha256:[0-9a-f]{64}$/
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const VERSION =
  /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/
const TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/
const MAX_JSON_BYTES = 16 * 1024 * 1024

const JOBS = new Map([
  [
    'Validate immutable release source',
    {
      conclusion: 'success',
      steps: [
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
    },
  ],
  [
    'Run candidate lint and test suites',
    {
      conclusion: 'success',
      steps: [
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
    },
  ],
  [
    'Build signed Linux candidate',
    {
      conclusion: 'success',
      steps: [
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
    },
  ],
  [
    'Build signed macOS candidate',
    {
      conclusion: 'success',
      steps: [
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
    },
  ],
  [
    'Build signed Windows candidate',
    {
      conclusion: 'success',
      steps: [
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
    },
  ],
  [
    'Package immutable updater candidate',
    {
      conclusion: 'failure',
      steps: [
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
    },
  ],
  [
    'Create draft release without promoting stable',
    {
      conclusion: 'skipped',
      steps: [],
    },
  ],
])

function fail(message) {
  throw new Error(message)
}

function record(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object`)
  }
  return value
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail(`${label} must be a positive safe integer`)
  }
  return value
}

function normalizeRunId(value, label) {
  const normalized = String(value ?? '')
  if (!/^[1-9][0-9]*$/.test(normalized)) {
    fail(`${label} must be a positive integer`)
  }
  const numeric = Number(normalized)
  positiveInteger(numeric, label)
  return { normalized, numeric }
}

function normalizeCommit(value, label) {
  const normalized = String(value ?? '')
  if (!COMMIT.test(normalized)) {
    fail(`${label} must be exactly 40 hexadecimal characters`)
  }
  return normalized.toLowerCase()
}

function normalizeRepository(value) {
  const normalized = String(value ?? '')
  if (!REPOSITORY.test(normalized)) {
    fail('repository must use the OWNER/REPO format')
  }
  return normalized
}

function normalizeVersion(value) {
  const normalized = String(value ?? '')
  if (!VERSION.test(normalized)) {
    fail('version must be a canonical stable semantic version')
  }
  return normalized
}

function requireExact(value, expected, label) {
  if (value !== expected) {
    fail(`${label} must be ${JSON.stringify(expected)}`)
  }
}

function timestamp(value, label) {
  if (typeof value !== 'string' || !TIMESTAMP.test(value)) {
    fail(`${label} must be an ISO-8601 UTC timestamp`)
  }
  const milliseconds = Date.parse(value)
  if (!Number.isFinite(milliseconds)) {
    fail(`${label} must be a valid timestamp`)
  }
  return milliseconds
}

function collection(payload, key, label) {
  const container = record(payload, `${label} response`)
  if (!Array.isArray(container[key])) {
    fail(`${label} response.${key} must be an array`)
  }
  if (
    !Number.isSafeInteger(container.total_count) ||
    container.total_count < 0 ||
    container.total_count !== container[key].length
  ) {
    fail(`${label} response total_count does not match ${key}.length`)
  }
  return container[key]
}

function validateRun({
  run,
  sourceRunId,
  currentRunId,
  repository,
}) {
  const source = record(run, 'source run')
  requireExact(source.id, sourceRunId.numeric, 'source run.id')
  requireExact(source.workflow_id, WORKFLOW_ID, 'source run.workflow_id')
  requireExact(source.name, WORKFLOW_NAME, 'source run.name')
  requireExact(source.path, WORKFLOW_PATH, 'source run.path')
  requireExact(source.event, 'workflow_dispatch', 'source run.event')
  requireExact(source.head_branch, SOURCE_BRANCH, 'source run.head_branch')
  requireExact(source.status, 'completed', 'source run.status')
  requireExact(source.conclusion, 'failure', 'source run.conclusion')
  requireExact(source.run_attempt, 1, 'source run.run_attempt')
  if (sourceRunId.numeric >= currentRunId.numeric) {
    fail('source run ID must precede the recovery run ID')
  }

  const sourceHeadSha = normalizeCommit(source.head_sha, 'source run.head_sha')
  requireExact(
    sourceHeadSha,
    APPROVED_SOURCE.headSha,
    'source run.head_sha'
  )
  const sourceRepository = record(source.repository, 'source run.repository')
  const sourceHeadRepository = record(
    source.head_repository,
    'source run.head_repository'
  )
  requireExact(
    sourceRepository.full_name,
    repository,
    'source run.repository.full_name'
  )
  requireExact(
    sourceHeadRepository.full_name,
    repository,
    'source run.head_repository.full_name'
  )
  const repositoryId = positiveInteger(
    sourceRepository.id,
    'source run.repository.id'
  )
  requireExact(
    repositoryId,
    APPROVED_SOURCE.repositoryId,
    'source run.repository.id'
  )
  requireExact(
    positiveInteger(
      sourceHeadRepository.id,
      'source run.head_repository.id'
    ),
    repositoryId,
    'source run.head_repository.id'
  )

  const createdAt = timestamp(source.created_at, 'source run.created_at')
  const updatedAt = timestamp(source.updated_at, 'source run.updated_at')
  if (createdAt > updatedAt) {
    fail('source run.created_at must not follow source run.updated_at')
  }

  return {
    sourceHeadSha,
    repositoryId,
    createdAt,
    updatedAt,
  }
}

function validateJobSteps(job, expectedSteps) {
  if (!Array.isArray(job.steps)) {
    fail(`source job ${JSON.stringify(job.name)} steps must be an array`)
  }
  if (job.steps.length !== expectedSteps.length) {
    fail(
      `source job ${JSON.stringify(job.name)} must have exactly ${expectedSteps.length} steps`
    )
  }

  const names = new Set()
  const numbers = new Set()
  for (let index = 0; index < expectedSteps.length; index += 1) {
    const step = record(
      job.steps[index],
      `source job ${JSON.stringify(job.name)} step ${index + 1}`
    )
    const [expectedName, expectedConclusion] = expectedSteps[index]
    requireExact(
      step.name,
      expectedName,
      `source job ${JSON.stringify(job.name)} step ${index + 1} name`
    )
    requireExact(
      step.status,
      'completed',
      `source job ${JSON.stringify(job.name)} step ${JSON.stringify(expectedName)} status`
    )
    requireExact(
      step.conclusion,
      expectedConclusion,
      `source job ${JSON.stringify(job.name)} step ${JSON.stringify(expectedName)} conclusion`
    )
    const number = positiveInteger(
      step.number,
      `source job ${JSON.stringify(job.name)} step ${JSON.stringify(expectedName)} number`
    )
    if (names.has(step.name) || numbers.has(number)) {
      fail(`source job ${JSON.stringify(job.name)} has duplicate steps`)
    }
    names.add(step.name)
    numbers.add(number)
  }
}

function validateJobs({ jobs, sourceHeadSha }) {
  const sourceJobs = collection(jobs, 'jobs', 'source jobs')
  if (sourceJobs.length !== JOBS.size) {
    fail(`source jobs must contain exactly ${JOBS.size} jobs`)
  }

  const names = new Set()
  const ids = new Set()
  const summary = {}
  for (const value of sourceJobs) {
    const job = record(value, 'source job')
    if (typeof job.name !== 'string' || !JOBS.has(job.name)) {
      fail(`unexpected source job ${JSON.stringify(job.name)}`)
    }
    if (names.has(job.name)) {
      fail(`duplicate source job ${JSON.stringify(job.name)}`)
    }
    const id = positiveInteger(job.id, `source job ${job.name} id`)
    if (ids.has(id)) {
      fail(`duplicate source job ID ${id}`)
    }
    names.add(job.name)
    ids.add(id)

    const expected = JOBS.get(job.name)
    requireExact(job.status, 'completed', `source job ${job.name} status`)
    requireExact(
      job.conclusion,
      expected.conclusion,
      `source job ${job.name} conclusion`
    )
    requireExact(
      job.workflow_name,
      WORKFLOW_NAME,
      `source job ${job.name} workflow_name`
    )
    requireExact(
      normalizeCommit(job.head_sha, `source job ${job.name} head_sha`),
      sourceHeadSha,
      `source job ${job.name} head_sha`
    )
    validateJobSteps(job, expected.steps)
    summary[job.name] = { id, conclusion: job.conclusion }
  }

  for (const name of JOBS.keys()) {
    if (!names.has(name)) fail(`missing source job ${JSON.stringify(name)}`)
  }
  return summary
}

function validateArtifacts({
  artifacts,
  sourceRunId,
  sourceHeadSha,
  repositoryId,
  version,
  createdAt,
  updatedAt,
}) {
  const sourceArtifacts = collection(
    artifacts,
    'artifacts',
    'source artifacts'
  )
  requireExact(version, APPROVED_SOURCE.version, 'source artifact version')
  const expectedNames = Object.keys(APPROVED_ARTIFACTS)
  if (sourceArtifacts.length !== expectedNames.length) {
    fail(`source artifacts must contain exactly ${expectedNames.length} items`)
  }

  const names = new Set()
  const ids = new Set()
  const digests = new Set()
  const summary = []
  for (const value of sourceArtifacts) {
    const artifact = record(value, 'source artifact')
    if (
      typeof artifact.name !== 'string' ||
      !expectedNames.includes(artifact.name)
    ) {
      fail(`unexpected source artifact ${JSON.stringify(artifact.name)}`)
    }
    if (names.has(artifact.name)) {
      fail(`duplicate source artifact ${JSON.stringify(artifact.name)}`)
    }
    names.add(artifact.name)
    const expectedArtifact = APPROVED_ARTIFACTS[artifact.name]

    const id = positiveInteger(
      artifact.id,
      `source artifact ${artifact.name} id`
    )
    requireExact(
      id,
      expectedArtifact.id,
      `source artifact ${artifact.name} id`
    )
    if (ids.has(id)) fail(`duplicate source artifact ID ${id}`)
    ids.add(id)

    requireExact(
      artifact.expired,
      false,
      `source artifact ${artifact.name} expired`
    )
    const sizeInBytes = positiveInteger(
      artifact.size_in_bytes,
      `source artifact ${artifact.name} size_in_bytes`
    )
    requireExact(
      sizeInBytes,
      expectedArtifact.sizeInBytes,
      `source artifact ${artifact.name} size_in_bytes`
    )
    if (typeof artifact.digest !== 'string' || !DIGEST.test(artifact.digest)) {
      fail(`source artifact ${artifact.name} digest must be sha256`)
    }
    requireExact(
      artifact.digest,
      expectedArtifact.digest,
      `source artifact ${artifact.name} digest`
    )
    if (digests.has(artifact.digest)) {
      fail(`duplicate source artifact digest ${artifact.digest}`)
    }
    digests.add(artifact.digest)

    const artifactCreatedAt = timestamp(
      artifact.created_at,
      `source artifact ${artifact.name} created_at`
    )
    const artifactUpdatedAt = timestamp(
      artifact.updated_at,
      `source artifact ${artifact.name} updated_at`
    )
    if (
      artifactCreatedAt < createdAt ||
      artifactCreatedAt > artifactUpdatedAt ||
      artifactUpdatedAt > updatedAt
    ) {
      fail(`source artifact ${artifact.name} timestamps escape the source run`)
    }

    const workflowRun = record(
      artifact.workflow_run,
      `source artifact ${artifact.name} workflow_run`
    )
    requireExact(
      workflowRun.id,
      sourceRunId.numeric,
      `source artifact ${artifact.name} workflow_run.id`
    )
    requireExact(
      workflowRun.head_branch,
      SOURCE_BRANCH,
      `source artifact ${artifact.name} workflow_run.head_branch`
    )
    requireExact(
      normalizeCommit(
        workflowRun.head_sha,
        `source artifact ${artifact.name} workflow_run.head_sha`
      ),
      sourceHeadSha,
      `source artifact ${artifact.name} workflow_run.head_sha`
    )
    requireExact(
      workflowRun.repository_id,
      repositoryId,
      `source artifact ${artifact.name} workflow_run.repository_id`
    )
    requireExact(
      workflowRun.head_repository_id,
      repositoryId,
      `source artifact ${artifact.name} workflow_run.head_repository_id`
    )
    summary.push({
      id,
      name: artifact.name,
      sizeInBytes,
      digest: artifact.digest,
    })
  }

  for (const name of expectedNames) {
    if (!names.has(name)) {
      fail(`missing source artifact ${JSON.stringify(name)}`)
    }
  }
  return summary.sort((left, right) => left.name.localeCompare(right.name))
}

export function validateReleaseCandidateRecoveryMetadata({
  run,
  jobs,
  artifacts,
  sourceRunId,
  currentRunId,
  repository,
  version,
}) {
  const normalizedSourceRunId = normalizeRunId(
    sourceRunId,
    'source run ID'
  )
  const normalizedCurrentRunId = normalizeRunId(
    currentRunId,
    'current run ID'
  )
  const normalizedRepository = normalizeRepository(repository)
  const normalizedVersion = normalizeVersion(version)
  requireExact(
    normalizedSourceRunId.normalized,
    APPROVED_SOURCE.runId,
    'source run ID'
  )
  requireExact(
    normalizedRepository,
    APPROVED_SOURCE.repository,
    'repository'
  )
  requireExact(
    normalizedVersion,
    APPROVED_SOURCE.version,
    'version'
  )
  const runIdentity = validateRun({
    run,
    sourceRunId: normalizedSourceRunId,
    currentRunId: normalizedCurrentRunId,
    repository: normalizedRepository,
  })
  const jobSummary = validateJobs({
    jobs,
    sourceHeadSha: runIdentity.sourceHeadSha,
  })
  const artifactSummary = validateArtifacts({
    artifacts,
    sourceRunId: normalizedSourceRunId,
    sourceHeadSha: runIdentity.sourceHeadSha,
    repositoryId: runIdentity.repositoryId,
    version: normalizedVersion,
    createdAt: runIdentity.createdAt,
    updatedAt: runIdentity.updatedAt,
  })

  return {
    schema: 1,
    sourceRunId: normalizedSourceRunId.normalized,
    sourceHeadSha: runIdentity.sourceHeadSha,
    currentRunId: normalizedCurrentRunId.normalized,
    repository: normalizedRepository,
    repositoryId: runIdentity.repositoryId,
    workflowId: WORKFLOW_ID,
    workflowPath: WORKFLOW_PATH,
    version: normalizedVersion,
    jobs: jobSummary,
    artifacts: artifactSummary,
  }
}

function parseArgs(argv) {
  const supported = new Set([
    '--run',
    '--jobs',
    '--artifacts',
    '--source-run-id',
    '--current-run-id',
    '--repository',
    '--version',
    '--output',
  ])
  const values = new Map()
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (!supported.has(argument)) {
      fail(`Unexpected argument: ${argument ?? 'missing'}`)
    }
    if (values.has(argument)) fail(`Duplicate argument: ${argument}`)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) {
      fail(`Missing value for ${argument}`)
    }
    values.set(argument, value)
    index += 1
  }
  for (const argument of supported) {
    if (!values.has(argument)) fail(`Missing argument: ${argument}`)
  }
  return Object.fromEntries(
    [...values].map(([key, value]) => [key.slice(2), value])
  )
}

function readJson(relativePath, label) {
  const absolute = path.resolve(relativePath)
  const stats = fs.statSync(absolute)
  if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_JSON_BYTES) {
    fail(`${label} must be a non-empty JSON file no larger than ${MAX_JSON_BYTES} bytes`)
  }
  return JSON.parse(fs.readFileSync(absolute, 'utf8'))
}

function main(argv) {
  const options = parseArgs(argv)
  const summary = validateReleaseCandidateRecoveryMetadata({
    run: readJson(options.run, 'source run metadata'),
    jobs: readJson(options.jobs, 'source job metadata'),
    artifacts: readJson(options.artifacts, 'source artifact metadata'),
    sourceRunId: options['source-run-id'],
    currentRunId: options['current-run-id'],
    repository: options.repository,
    version: options.version,
  })
  const output = path.resolve(options.output)
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, `${JSON.stringify(summary, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  })
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
}

if (process.argv[1]) {
  const entry = path.resolve(process.argv[1])
  if (entry === fileURLToPath(import.meta.url)) {
    try {
      main(process.argv.slice(2))
    } catch (error) {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`
      )
      process.exitCode = 1
    }
  }
}
