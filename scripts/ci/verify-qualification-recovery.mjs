#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const WORKFLOW_PATH =
  '.github/workflows/biyan-exact-sha-qualification.yml'
const SOURCE_BRANCH = 'mita-main'
const COMMIT = /^[0-9a-fA-F]{40}$/
const DIGEST = /^sha256:[0-9a-f]{64}$/
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/
const MAX_JSON_BYTES = 16 * 1024 * 1024

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
const AGGREGATE_STEP_CONCLUSIONS = new Map([
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
])

const PLATFORMS = ['linux', 'windows', 'macos']

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

function normalizeRunId(value, label = 'source run ID') {
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

function requireExact(value, expected, label) {
  if (value !== expected) {
    fail(`${label} must be ${JSON.stringify(expected)}`)
  }
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

function validateRun({ run, sourceRunId, repository }) {
  const source = record(run, 'source run')
  requireExact(source.id, sourceRunId.numeric, 'source run.id')
  requireExact(source.event, 'workflow_dispatch', 'source run.event')
  requireExact(source.head_branch, SOURCE_BRANCH, 'source run.head_branch')
  requireExact(source.path, WORKFLOW_PATH, 'source run.path')
  requireExact(source.status, 'completed', 'source run.status')
  requireExact(source.conclusion, 'failure', 'source run.conclusion')
  requireExact(source.run_attempt, 1, 'source run.run_attempt')

  const sourceHeadSha = normalizeCommit(source.head_sha, 'source run.head_sha')
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
  const headRepositoryId = positiveInteger(
    sourceHeadRepository.id,
    'source run.head_repository.id'
  )
  requireExact(
    headRepositoryId,
    repositoryId,
    'source run.head_repository.id'
  )

  return { sourceHeadSha, repositoryId, headRepositoryId }
}

function validateAggregateSteps(aggregate) {
  if (!Array.isArray(aggregate.steps)) {
    fail(`${AGGREGATE_JOB} steps must be an array`)
  }
  const stepsByName = new Map()
  const stepNumbers = new Set()
  for (const item of aggregate.steps) {
    const step = record(item, `${AGGREGATE_JOB} step`)
    if (typeof step.name !== 'string' || step.name.length === 0) {
      fail(`${AGGREGATE_JOB} step name must be a non-empty string`)
    }
    if (stepsByName.has(step.name)) {
      fail(`${AGGREGATE_JOB} has duplicate step ${JSON.stringify(step.name)}`)
    }
    const number = positiveInteger(
      step.number,
      `${AGGREGATE_JOB} step ${JSON.stringify(step.name)} number`
    )
    if (stepNumbers.has(number)) {
      fail(`${AGGREGATE_JOB} has duplicate step number ${number}`)
    }
    stepNumbers.add(number)
    stepsByName.set(step.name, step)
  }

  for (const [name, conclusion] of AGGREGATE_STEP_CONCLUSIONS) {
    const step = stepsByName.get(name)
    if (!step) {
      fail(`${AGGREGATE_JOB} is missing required step ${JSON.stringify(name)}`)
    }
    requireExact(
      step.status,
      'completed',
      `${AGGREGATE_JOB} step ${JSON.stringify(name)} status`
    )
    requireExact(
      step.conclusion,
      conclusion,
      `${AGGREGATE_JOB} step ${JSON.stringify(name)} conclusion`
    )
  }
}

function validateJobs(payload) {
  const jobs = collection(payload, 'jobs', 'jobs')
  if (jobs.length !== JOB_CONCLUSIONS.size) {
    fail(`jobs response must contain exactly ${JOB_CONCLUSIONS.size} jobs`)
  }

  const jobsByName = new Map()
  const jobIds = new Set()
  for (const item of jobs) {
    const job = record(item, 'source job')
    if (typeof job.name !== 'string' || job.name.length === 0) {
      fail('source job name must be a non-empty string')
    }
    if (!JOB_CONCLUSIONS.has(job.name)) {
      fail(`unexpected source job ${JSON.stringify(job.name)}`)
    }
    if (jobsByName.has(job.name)) {
      fail(`duplicate source job ${JSON.stringify(job.name)}`)
    }
    const id = positiveInteger(job.id, `source job ${JSON.stringify(job.name)} id`)
    if (jobIds.has(id)) fail(`duplicate source job id ${id}`)
    jobIds.add(id)
    requireExact(
      job.status,
      'completed',
      `source job ${JSON.stringify(job.name)} status`
    )
    requireExact(
      job.run_attempt,
      1,
      `source job ${JSON.stringify(job.name)} run_attempt`
    )
    requireExact(
      job.conclusion,
      JOB_CONCLUSIONS.get(job.name),
      `source job ${JSON.stringify(job.name)} conclusion`
    )
    jobsByName.set(job.name, job)
  }

  for (const name of JOB_CONCLUSIONS.keys()) {
    if (!jobsByName.has(name)) {
      fail(`missing source job ${JSON.stringify(name)}`)
    }
  }
  validateAggregateSteps(jobsByName.get(AGGREGATE_JOB))
}

function validTimestamp(value, label) {
  if (typeof value !== 'string' || !TIMESTAMP.test(value)) {
    fail(`${label} must be an ISO-8601 UTC timestamp`)
  }
  if (!Number.isFinite(Date.parse(value))) {
    fail(`${label} must be a valid timestamp`)
  }
  return value
}

function validateArtifacts({
  payload,
  sourceRunId,
  sourceHeadSha,
  repositoryId,
  headRepositoryId,
}) {
  const artifacts = collection(payload, 'artifacts', 'artifacts')
  if (artifacts.length !== PLATFORMS.length) {
    fail(`artifacts response must contain exactly ${PLATFORMS.length} artifacts`)
  }

  const artifactsByName = new Map()
  const artifactIds = new Set()
  for (const item of artifacts) {
    const artifact = record(item, 'source artifact')
    if (typeof artifact.name !== 'string' || artifact.name.length === 0) {
      fail('source artifact name must be a non-empty string')
    }
    if (artifactsByName.has(artifact.name)) {
      fail(`duplicate source artifact ${JSON.stringify(artifact.name)}`)
    }
    const id = positiveInteger(
      artifact.id,
      `source artifact ${JSON.stringify(artifact.name)} id`
    )
    if (artifactIds.has(id)) fail(`duplicate source artifact id ${id}`)
    artifactIds.add(id)
    positiveInteger(
      artifact.size_in_bytes,
      `source artifact ${JSON.stringify(artifact.name)} size_in_bytes`
    )
    if (!DIGEST.test(String(artifact.digest ?? ''))) {
      fail(
        `source artifact ${JSON.stringify(artifact.name)} digest must be sha256:<64 lowercase hex>`
      )
    }
    requireExact(
      artifact.expired,
      false,
      `source artifact ${JSON.stringify(artifact.name)} expired`
    )
    validTimestamp(
      artifact.expires_at,
      `source artifact ${JSON.stringify(artifact.name)} expires_at`
    )

    const workflowRun = record(
      artifact.workflow_run,
      `source artifact ${JSON.stringify(artifact.name)} workflow_run`
    )
    requireExact(
      workflowRun.id,
      sourceRunId.numeric,
      `source artifact ${JSON.stringify(artifact.name)} workflow_run.id`
    )
    requireExact(
      workflowRun.head_branch,
      SOURCE_BRANCH,
      `source artifact ${JSON.stringify(artifact.name)} workflow_run.head_branch`
    )
    requireExact(
      normalizeCommit(
        workflowRun.head_sha,
        `source artifact ${JSON.stringify(artifact.name)} workflow_run.head_sha`
      ),
      sourceHeadSha,
      `source artifact ${JSON.stringify(artifact.name)} workflow_run.head_sha`
    )
    requireExact(
      workflowRun.repository_id,
      repositoryId,
      `source artifact ${JSON.stringify(artifact.name)} workflow_run.repository_id`
    )
    requireExact(
      workflowRun.head_repository_id,
      headRepositoryId,
      `source artifact ${JSON.stringify(artifact.name)} workflow_run.head_repository_id`
    )
    artifactsByName.set(artifact.name, artifact)
  }

  return PLATFORMS.map((platform) => {
    const name = `qualification-build-${platform}-${sourceRunId.normalized}`
    const artifact = artifactsByName.get(name)
    if (!artifact) fail(`missing exact source artifact ${JSON.stringify(name)}`)
    return {
      id: artifact.id,
      name,
      bytes: artifact.size_in_bytes,
      digest: artifact.digest,
      expiresAt: artifact.expires_at,
    }
  })
}

export function validateQualificationRecoveryMetadata({
  run,
  jobs,
  artifacts,
  sourceRunId,
  repository,
  targetSha,
  baseSha,
}) {
  const normalizedRunId = normalizeRunId(sourceRunId)
  const normalizedRepository = normalizeRepository(repository)
  const normalizedTarget = normalizeCommit(targetSha, 'target SHA')
  const normalizedBase = normalizeCommit(baseSha, 'base SHA')
  const runIdentity = validateRun({
    run,
    sourceRunId: normalizedRunId,
    repository: normalizedRepository,
  })
  validateJobs(jobs)
  const artifactSummary = validateArtifacts({
    payload: artifacts,
    sourceRunId: normalizedRunId,
    ...runIdentity,
  })

  return {
    sourceRunId: normalizedRunId.normalized,
    sourceHeadSha: runIdentity.sourceHeadSha,
    repository: normalizedRepository,
    targetSha: normalizedTarget,
    baseSha: normalizedBase,
    artifacts: artifactSummary,
  }
}

function readJson(file, label) {
  const absolute = path.resolve(file)
  const stat = fs.lstatSync(absolute, { throwIfNoEntry: false })
  if (!stat?.isFile() || stat.isSymbolicLink()) {
    fail(`${label} JSON must be a regular non-symlink file: ${absolute}`)
  }
  if (stat.size <= 0 || stat.size > MAX_JSON_BYTES) {
    fail(`${label} JSON size is outside the allowed range: ${stat.size}`)
  }
  try {
    return JSON.parse(fs.readFileSync(absolute, 'utf8'))
  } catch (error) {
    fail(
      `${label} JSON is invalid: ${error instanceof Error ? error.message : error}`
    )
  }
}

function parseOptions(argv) {
  const allowed = new Set([
    'run',
    'jobs',
    'artifacts',
    'source-run-id',
    'repository',
    'target-sha',
    'base-sha',
    'output',
    'github-output',
  ])
  const options = {}
  for (let index = 0; index < argv.length; index += 2) {
    const token = argv[index]
    const value = argv[index + 1]
    if (!token?.startsWith('--') || value === undefined) {
      fail(`invalid argument list near ${token ?? '<end>'}`)
    }
    const key = token.slice(2)
    if (!allowed.has(key)) fail(`unknown option --${key}`)
    if (Object.hasOwn(options, key)) fail(`duplicate option --${key}`)
    options[key] = value
  }
  for (const key of [
    'run',
    'jobs',
    'artifacts',
    'source-run-id',
    'repository',
    'target-sha',
    'base-sha',
  ]) {
    if (!options[key]) fail(`missing required option --${key}`)
  }
  return options
}

function assertDistinctOutputs(options) {
  const inputs = new Set(
    ['run', 'jobs', 'artifacts'].map((key) => path.resolve(options[key]))
  )
  for (const key of ['output', 'github-output']) {
    if (options[key] && inputs.has(path.resolve(options[key]))) {
      fail(`--${key} must not overwrite an input JSON file`)
    }
  }
  if (
    options.output &&
    options['github-output'] &&
    path.resolve(options.output) === path.resolve(options['github-output'])
  ) {
    fail('--output and --github-output must be different files')
  }
}

function writeOutput(file, contents, { append = false } = {}) {
  const absolute = path.resolve(file)
  fs.mkdirSync(path.dirname(absolute), { recursive: true })
  if (append) fs.appendFileSync(absolute, contents)
  else fs.writeFileSync(absolute, contents, { mode: 0o600 })
}

export function runCli(argv) {
  const options = parseOptions(argv)
  assertDistinctOutputs(options)
  const summary = validateQualificationRecoveryMetadata({
    run: readJson(options.run, 'run'),
    jobs: readJson(options.jobs, 'jobs'),
    artifacts: readJson(options.artifacts, 'artifacts'),
    sourceRunId: options['source-run-id'],
    repository: options.repository,
    targetSha: options['target-sha'],
    baseSha: options['base-sha'],
  })
  const compact = JSON.stringify(summary)
  if (options.output) writeOutput(options.output, `${compact}\n`)
  if (options['github-output']) {
    writeOutput(
      options['github-output'],
      [
        `source_run_id=${summary.sourceRunId}`,
        `source_head_sha=${summary.sourceHeadSha}`,
        `repository=${summary.repository}`,
        `target_sha=${summary.targetSha}`,
        `base_sha=${summary.baseSha}`,
        `artifacts_json=${JSON.stringify(summary.artifacts)}`,
        `summary_json=${compact}`,
        '',
      ].join('\n'),
      { append: true }
    )
  }
  process.stdout.write(`${compact}\n`)
  return summary
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))

if (isMain) {
  try {
    runCli(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
