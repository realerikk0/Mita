#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  validateActiveTerminalReleaseBinding,
  validateReleaseTrainPolicy,
} from './release-policy-contracts.mjs'

export const CHECKPOINT_FILES = Object.freeze([
  'biyan-release.json',
  'src-tauri/Cargo.lock',
  'src-tauri/Cargo.toml',
  'src-tauri/tauri.conf.json',
])

export const REVIEWED_CONTROL_PLANE_DRIFT = Object.freeze(
  new Map([
    ['.github/workflows/biyan-a-canary.yml', 'A'],
    ['.github/workflows/biyan-exact-sha-qualification.yml', 'M'],
    ['.github/workflows/biyan-linter-and-test.yml', 'M'],
    ['.github/workflows/deploy-updater-router.yml', 'M'],
    ['.github/workflows/desktop-release-draft-repair.yml', 'A'],
    ['.github/workflows/desktop-release-recovery.yml', 'A'],
    ['.github/workflows/desktop-release.yml', 'M'],
    ['.github/workflows/promote-desktop-update.yml', 'M'],
    ['.github/workflows/release-distribution.yml', 'M'],
    ['.github/workflows/updater-health-gate.yml', 'M'],
    ['.github/workflows/updater-kill-switch.yml', 'M'],
    ['DEVELOPMENT_PLAN.md', 'M'],
    ['autoqa/migration_runner.py', 'M'],
    ['autoqa/tests/test_migration_runner.py', 'M'],
    ['docs/release-distribution.md', 'M'],
    ['scripts/ci/__tests__/candidate-content-policy.test.mjs', 'M'],
    ['scripts/ci/__tests__/extract-release-candidate-recovery.test.py', 'A'],
    ['scripts/ci/__tests__/qualification-impact.test.mjs', 'M'],
    ['scripts/ci/__tests__/release-policy.test.mjs', 'M'],
    ['scripts/ci/__tests__/run-untrusted-qualification-verifier.test.mjs', 'A'],
    ['scripts/ci/__tests__/verify-qualification-recovery.test.mjs', 'A'],
    ['scripts/ci/__tests__/verify-release-candidate-recovery.test.mjs', 'A'],
    ['scripts/ci/__tests__/verify-release-target.test.mjs', 'A'],
    ['scripts/ci/extract-release-candidate-recovery.py', 'A'],
    ['scripts/ci/legacy-compatibility-allowlist.json', 'M'],
    ['scripts/ci/qualification-impact.mjs', 'M'],
    ['scripts/ci/release-policy-contracts.mjs', 'M'],
    ['scripts/ci/run-untrusted-qualification-verifier.sh', 'A'],
    ['scripts/ci/verify-qualification-recovery.mjs', 'A'],
    ['scripts/ci/verify-release-candidate-recovery.mjs', 'A'],
    ['scripts/ci/verify-release-policy.mjs', 'M'],
    ['scripts/ci/verify-release-target.mjs', 'A'],
    ['scripts/ci/verify-windows-candidate.ps1', 'M'],
    [
      'scripts/release-distribution/__tests__/bootstrap-biyan-download-aliases.test.mjs',
      'A',
    ],
    [
      'scripts/release-distribution/__tests__/draft-asset-repair-state.test.mjs',
      'A',
    ],
    ['scripts/release-distribution/__tests__/release-distribution.test.mjs', 'M'],
    [
      'scripts/release-distribution/biyan-download-alias-bootstrap-allowlist.json',
      'A',
    ],
    ['scripts/release-distribution/bootstrap-biyan-download-aliases.mjs', 'A'],
    ['scripts/release-distribution/draft-asset-repair-state.mjs', 'A'],
    ['scripts/release-distribution/publish-download-transaction.mjs', 'M'],
    ['scripts/updater/__tests__/a-canary-evidence.test.mjs', 'A'],
    ['scripts/updater/__tests__/legacy-pause-transaction.test.mjs', 'A'],
    ['scripts/updater/__tests__/promotion-transaction.test.mjs', 'M'],
    ['scripts/updater/__tests__/test_prepare_a_canary_inputs.py', 'A'],
    ['scripts/updater/__tests__/updater.test.mjs', 'M'],
    ['scripts/updater/__tests__/verify-updater-asset-signature.test.mjs', 'A'],
    ['scripts/updater/a-canary-evidence.mjs', 'A'],
    ['scripts/updater/a-canary-policy.json', 'A'],
    ['scripts/updater/legacy-a-transition-policy.json', 'M'],
    ['scripts/updater/legacy-pause-transaction.mjs', 'A'],
    ['scripts/updater/prepare-a-canary-inputs.py', 'A'],
    ['scripts/updater/prepare-promotion.mjs', 'M'],
    ['scripts/updater/promotion-transaction.mjs', 'M'],
    ['scripts/updater/run-pause-transaction.sh', 'A'],
    ['scripts/updater/run-promotion-transaction.sh', 'M'],
    ['scripts/updater/verify-candidate.mjs', 'M'],
    ['scripts/updater/verify-updater-asset-signature.mjs', 'A'],
    ['scripts/updater/worker.mjs', 'M'],
  ])
)

export const TERMINAL_CONTROL_PLANE_DRIFT = Object.freeze(
  new Map([
    ['.github/workflows/biyan-a-canary.yml', 'M'],
    ['.github/workflows/biyan-direct-qualification.yml', 'A'],
    ['.github/workflows/desktop-release-draft-repair.yml', 'M'],
    ['.github/workflows/desktop-release.yml', 'M'],
    ['.github/workflows/promote-desktop-update.yml', 'M'],
    ['.github/workflows/release-distribution.yml', 'M'],
    ['DEVELOPMENT_PLAN.md', 'M'],
    ['autoqa/migration_runner.py', 'M'],
    ['autoqa/tests/test_migration_runner.py', 'M'],
    ['docs/README.md', 'M'],
    ['docs/release-distribution.md', 'M'],
    ['docs/src/pages/docs/desktop/data-folder.mdx', 'M'],
    ['scripts/ci/__tests__/qualification-impact.test.mjs', 'M'],
    ['scripts/ci/__tests__/release-policy.test.mjs', 'M'],
    ['scripts/ci/__tests__/verify-release-target.test.mjs', 'M'],
    ['scripts/ci/legacy-compatibility-allowlist.json', 'M'],
    ['scripts/ci/release-policy-contracts.mjs', 'M'],
    ['scripts/ci/release-train-policy.json', 'M'],
    ['scripts/ci/verify-release-policy.mjs', 'M'],
    ['scripts/ci/verify-release-target.mjs', 'M'],
    ['scripts/release-distribution/__tests__/release-distribution.test.mjs', 'M'],
    ['scripts/release-distribution/collect-release-assets.mjs', 'M'],
    ['scripts/updater/__tests__/direct-c-transition-policy.test.mjs', 'A'],
    ['scripts/updater/__tests__/direct-qualification.test.mjs', 'A'],
    ['scripts/updater/__tests__/fixtures/v0.6.633-latest.json', 'A'],
    ['scripts/updater/__tests__/legacy-manifest-policy.test.mjs', 'M'],
    ['scripts/updater/__tests__/promotion-transaction.test.mjs', 'M'],
    ['scripts/updater/__tests__/test_prepare_direct_qualification_inputs.py', 'A'],
    ['scripts/updater/__tests__/updater.test.mjs', 'M'],
    ['scripts/updater/direct-c-contract.mjs', 'A'],
    ['scripts/updater/direct-c-transition-policy.json', 'A'],
    ['scripts/updater/direct-c-transition-policy.mjs', 'A'],
    ['scripts/updater/direct-qualification-evidence.mjs', 'A'],
    ['scripts/updater/direct-qualification-policy.json', 'A'],
    ['scripts/updater/legacy-manifest-policy.mjs', 'M'],
    ['scripts/updater/legacy-pause-transaction.mjs', 'M'],
    ['scripts/updater/prepare-direct-qualification-inputs.py', 'A'],
    ['scripts/updater/prepare-promotion.mjs', 'M'],
    ['scripts/updater/promotion-transaction.mjs', 'M'],
    ['scripts/updater/run-promotion-transaction.sh', 'M'],
    ['scripts/updater/worker.mjs', 'M'],
  ])
)

const EXACT_COMMIT = /^[0-9a-f]{40}$/
const SEMVER_NUMBER = '(?:0|[1-9][0-9]*)'
const SEMVER_PRERELEASE_IDENTIFIER =
  '(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)'
const EXACT_RELEASE_TAG = new RegExp(
  `^v${SEMVER_NUMBER}\\.${SEMVER_NUMBER}\\.${SEMVER_NUMBER}` +
    `(?:-${SEMVER_PRERELEASE_IDENTIFIER}(?:\\.${SEMVER_PRERELEASE_IDENTIFIER})*)?` +
    '(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$'
)
const REGULAR_MODES = new Set(['100644', '100755'])
const CONTROL_PLANE_ROOTS = Object.freeze([
  '.github/workflows/',
  'docs/',
  'scripts/ci/',
  'scripts/release-distribution/',
  'scripts/updater/',
])
const EXACT_CONTROL_PLANE_PATHS = new Set([
  'DEVELOPMENT_PLAN.md',
  'autoqa/migration_runner.py',
  'autoqa/tests/test_migration_runner.py',
])

function isExactControlPlanePath(relativePath) {
  if (
    typeof relativePath !== 'string' ||
    relativePath.length === 0 ||
    relativePath.includes('\\')
  ) {
    return false
  }
  const segments = relativePath.split('/')
  if (
    segments.some(
      (segment) => segment.length === 0 || segment === '.' || segment === '..'
    )
  ) {
    return false
  }
  return (
    EXACT_CONTROL_PLANE_PATHS.has(relativePath) ||
    CONTROL_PLANE_ROOTS.some(
      (root) =>
        relativePath.startsWith(root) && relativePath.length > root.length
    )
  )
}

for (const [label, allowlist] of [
  ['reviewed release', REVIEWED_CONTROL_PLANE_DRIFT],
  ['terminal release', TERMINAL_CONTROL_PLANE_DRIFT],
]) {
  for (const [relativePath, status] of allowlist) {
    if (!isExactControlPlanePath(relativePath)) {
      throw new Error(
        `${label} drift escaped the control-plane path domain: ${relativePath}`
      )
    }
    if (!/^[AM]$/.test(status)) {
      throw new Error(
        `${label} drift has unsupported status ${status}: ${relativePath}`
      )
    }
  }
}

export function parseReleaseTargetArgs(argv) {
  const values = new Map()
  const supported = new Set([
    '--harness-root',
    '--release-tag',
    '--target-root',
    '--source-commit',
    '--trusted-main',
  ])

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (!supported.has(argument)) {
      throw new Error(`Unexpected argument: ${argument ?? 'missing'}`)
    }
    if (values.has(argument)) {
      throw new Error(`Duplicate argument: ${argument}`)
    }
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${argument}`)
    }
    values.set(argument, value)
    index += 1
  }

  for (const argument of supported) {
    if (!values.has(argument)) {
      throw new Error(`Missing required argument: ${argument}`)
    }
  }

  const sourceCommit = values.get('--source-commit')
  const trustedMain = values.get('--trusted-main')
  const releaseTag = values.get('--release-tag')
  if (!EXACT_COMMIT.test(sourceCommit)) {
    throw new Error('source commit must be an exact 40-hex commit')
  }
  if (!EXACT_COMMIT.test(trustedMain)) {
    throw new Error('trusted main must be an exact 40-hex commit')
  }
  if (!EXACT_RELEASE_TAG.test(releaseTag)) {
    throw new Error('release tag must be an exact v-prefixed semantic version')
  }

  return {
    harnessRoot: path.resolve(values.get('--harness-root')),
    releaseTag,
    sourceCommit,
    targetRoot: path.resolve(values.get('--target-root')),
    trustedMain,
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: options.encoding ?? 'utf8',
    input: options.input,
    maxBuffer: 64 * 1024 * 1024,
    stdio: options.stdio,
  })
  if (result.error) throw result.error
  if (result.status !== 0 && !options.allowFailure) {
    const stderr = String(result.stderr ?? '').trim()
    const stdout = String(result.stdout ?? '').trim()
    throw new Error(
      `${command} ${args.join(' ')} failed with status ${String(result.status)}${
        stderr || stdout ? `: ${stderr || stdout}` : ''
      }`
    )
  }
  return result
}

function git(repoRoot, args, options = {}) {
  return run('git', ['-C', repoRoot, ...args], options)
}

function exactHead(repoRoot) {
  return git(repoRoot, ['rev-parse', 'HEAD']).stdout.trim()
}

function requireClean(repoRoot, label) {
  const status = git(repoRoot, ['status', '--porcelain=v1', '-z'], {
    encoding: 'buffer',
  }).stdout
  if (status.length !== 0) {
    throw new Error(`${label} checkout must be clean`)
  }
}

export function parseNameStatus(buffer) {
  const fields = buffer
    .toString('utf8')
    .split('\0')
    .filter((field) => field.length > 0)
  const entries = []

  for (let index = 0; index < fields.length; ) {
    const status = fields[index++]
    const pathBefore = fields[index++]
    if (!status || !pathBefore) {
      throw new Error('Malformed NUL-delimited git diff')
    }
    if (/^[RC]/.test(status)) {
      const pathAfter = fields[index++]
      if (!pathAfter) throw new Error('Malformed rename or copy diff')
      entries.push({ path: pathBefore, pathAfter, status })
      continue
    }
    entries.push({ path: pathBefore, status })
  }
  return entries
}

function treeMode(repoRoot, commit, relativePath) {
  const output = git(repoRoot, [
    'ls-tree',
    '-z',
    commit,
    '--',
    relativePath,
  ]).stdout
  if (!output) return null
  const match = /^([0-9]{6}) (blob|commit) [0-9a-f]{40}\t/.exec(output)
  if (!match) throw new Error(`Malformed tree entry for ${relativePath}`)
  return { mode: match[1], type: match[2] }
}

export function validateReleaseDrift(entries) {
  const failures = []
  const checkpointFiles = new Set(CHECKPOINT_FILES)

  for (const entry of entries) {
    if (/^[RC]/.test(entry.status)) {
      failures.push(
        `release source drift must not rename or copy paths: ${entry.path}`
      )
      continue
    }
    if (!/^[AMD]$/.test(entry.status)) {
      failures.push(
        `release source drift has unsupported status ${entry.status}: ${entry.path}`
      )
      continue
    }

    if (checkpointFiles.has(entry.path)) {
      if (
        entry.status !== 'M' ||
        entry.oldMode !== '100644' ||
        entry.newMode !== '100644'
      ) {
        failures.push(
          `checkpoint drift must be a regular-file modification: ${entry.path}`
        )
      }
      continue
    }

    const expectedStatus = REVIEWED_CONTROL_PLANE_DRIFT.get(entry.path)
    if (!expectedStatus) {
      failures.push(`unreviewed release source drift: ${entry.path}`)
      continue
    }
    if (!isExactControlPlanePath(entry.path)) {
      failures.push(
        `reviewed release drift escaped the control-plane path domain: ${entry.path}`
      )
      continue
    }
    if (entry.status !== expectedStatus) {
      failures.push(
        `reviewed control-plane drift status changed for ${entry.path}: expected ${expectedStatus}, found ${entry.status}`
      )
    }

    const oldMode = entry.oldMode
    const newMode = entry.newMode
    if (
      (oldMode && !REGULAR_MODES.has(oldMode)) ||
      (newMode && !REGULAR_MODES.has(newMode))
    ) {
      failures.push(`control-plane drift must use regular files: ${entry.path}`)
      continue
    }
    if (
      (entry.status === 'M' && (!oldMode || oldMode !== newMode)) ||
      (entry.status === 'A' && (oldMode !== null || !newMode)) ||
      (entry.status === 'D' && (!oldMode || newMode !== null))
    ) {
      failures.push(`control-plane file mode drift is invalid: ${entry.path}`)
    }
  }

  return failures
}

export function validateTerminalReleaseDrift(entries) {
  const failures = []
  const checkpointFiles = new Set(CHECKPOINT_FILES)

  for (const entry of entries) {
    if (/^[RC]/.test(entry.status)) {
      failures.push(
        `terminal release drift must not rename or copy paths: ${entry.path}`
      )
      continue
    }
    if (!/^[AMD]$/.test(entry.status)) {
      failures.push(
        `terminal release drift has unsupported status ${entry.status}: ${entry.path}`
      )
      continue
    }
    if (checkpointFiles.has(entry.path)) {
      failures.push(
        `terminal control-plane commit must not modify source identity: ${entry.path}`
      )
      continue
    }

    const expectedStatus = TERMINAL_CONTROL_PLANE_DRIFT.get(entry.path)
    if (!expectedStatus) {
      failures.push(`unreviewed terminal release drift: ${entry.path}`)
      continue
    }
    if (!isExactControlPlanePath(entry.path)) {
      failures.push(
        `terminal release drift escaped the control-plane path domain: ${entry.path}`
      )
      continue
    }
    if (entry.status !== expectedStatus) {
      failures.push(
        `terminal control-plane drift status changed for ${entry.path}: expected ${expectedStatus}, found ${entry.status}`
      )
    }

    const oldMode = entry.oldMode
    const newMode = entry.newMode
    if (
      (oldMode && !REGULAR_MODES.has(oldMode)) ||
      (newMode && !REGULAR_MODES.has(newMode))
    ) {
      failures.push(
        `terminal control-plane drift must use regular files: ${entry.path}`
      )
      continue
    }
    if (
      (entry.status === 'M' && (!oldMode || oldMode !== newMode)) ||
      (entry.status === 'A' && (oldMode !== null || !newMode)) ||
      (entry.status === 'D' && (!oldMode || newMode !== null))
    ) {
      failures.push(
        `terminal control-plane file mode drift is invalid: ${entry.path}`
      )
    }
  }

  return failures
}

function verifyCheckpoint({
  harnessRoot,
  parentCommit,
  releaseVersion,
  sourceCommit,
}) {
  const verifier = path.join(harnessRoot, 'scripts/ci/qualification-impact.mjs')
  const result = run(process.execPath, [
    verifier,
    'verify-checkpoint',
    '--repo',
    harnessRoot,
    '--base',
    parentCommit,
    '--target',
    sourceCommit,
    '--format',
    'json',
  ])
  const evidence = JSON.parse(result.stdout)
  if (
    evidence.valid !== true ||
    JSON.stringify(evidence.changedFiles) !== JSON.stringify(CHECKPOINT_FILES)
  ) {
    throw new Error(
      `release tag is not an exact four-file checkpoint: ${result.stdout.trim()}`
    )
  }
  if (evidence.targetVersion !== releaseVersion) {
    throw new Error(
      `release tag version ${releaseVersion} does not match checkpoint target version ${String(evidence.targetVersion ?? 'missing')}`
    )
  }
  return evidence
}

function verifyPolicyView({
  harnessRoot,
  sourceCommit,
  targetRoot,
  trustedMain,
}) {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'biyan-release-policy-')
  )
  const policyView = path.join(temporaryRoot, 'view')
  let worktreeAdded = false

  try {
    git(harnessRoot, ['worktree', 'add', '--detach', policyView, trustedMain])
    worktreeAdded = true

    for (const relativePath of CHECKPOINT_FILES) {
      const source = path.join(targetRoot, relativePath)
      const destination = path.join(policyView, relativePath)
      const sourceStat = fs.lstatSync(source)
      if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
        throw new Error(
          `checkpoint source must be a regular file: ${relativePath}`
        )
      }
      fs.copyFileSync(source, destination)
      fs.chmodSync(destination, 0o644)
    }

    const policy = run(
      process.execPath,
      [
        path.join(harnessRoot, 'scripts/ci/verify-release-policy.mjs'),
        '--repo-root',
        policyView,
        '--require-active',
      ],
      { stdio: 'inherit' }
    )
    if (policy.status !== 0) {
      throw new Error('protected release policy rejected the exact-tag view')
    }
  } finally {
    if (worktreeAdded) {
      git(harnessRoot, ['worktree', 'remove', '--force', policyView], {
        allowFailure: true,
      })
    }
    fs.rmSync(temporaryRoot, { force: true, recursive: true })
  }

  return { sourceCommit, trustedMain }
}

function readProtectedTrainPolicy(harnessRoot) {
  const policyPath = path.join(
    harnessRoot,
    'scripts/ci/release-train-policy.json'
  )
  let policy
  try {
    policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'))
  } catch (error) {
    throw new Error(
      `protected release train policy is unreadable: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  const failures = validateReleaseTrainPolicy(policy)
  if (failures.length > 0) {
    throw new Error(
      `protected release train policy is invalid: ${failures.join('; ')}`
    )
  }
  return policy
}

function readTaggedReleaseMetadata(targetRoot) {
  const metadataPath = path.join(targetRoot, 'biyan-release.json')
  let metadata
  try {
    metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
  } catch (error) {
    throw new Error(
      `tagged release metadata is unreadable: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  if (
    metadata?.schema !== 1 ||
    !['A', 'B', 'C'].includes(metadata?.migrationPhase) ||
    !Number.isSafeInteger(metadata?.dataSchema)
  ) {
    throw new Error('tagged release metadata is invalid')
  }
  return metadata
}

export function verifyReleaseTarget(options) {
  const { harnessRoot, releaseTag, sourceCommit, targetRoot, trustedMain } =
    options
  if (!EXACT_RELEASE_TAG.test(releaseTag)) {
    throw new Error('release tag must be an exact v-prefixed semantic version')
  }
  const releaseVersion = releaseTag.slice(1)

  if (harnessRoot === targetRoot) {
    throw new Error('harness and target checkouts must be separate')
  }
  if (exactHead(harnessRoot) !== trustedMain) {
    throw new Error('protected harness HEAD does not match trusted main')
  }
  if (exactHead(targetRoot) !== sourceCommit) {
    throw new Error('release target HEAD does not match source commit')
  }
  requireClean(harnessRoot, 'protected harness')
  requireClean(targetRoot, 'release target')

  git(harnessRoot, ['cat-file', '-e', `${sourceCommit}^{commit}`])
  git(harnessRoot, ['cat-file', '-e', `${trustedMain}^{commit}`])
  git(harnessRoot, ['merge-base', '--is-ancestor', sourceCommit, trustedMain])

  const parentLine = git(harnessRoot, [
    'rev-list',
    '--parents',
    '-n',
    '1',
    sourceCommit,
  ]).stdout.trim()
  const parents = parentLine.split(/\s+/)
  if (parents.length !== 2 || parents[0] !== sourceCommit) {
    throw new Error('release source must have exactly one parent')
  }
  const parentCommit = parents[1]
  const trainPolicy = readProtectedTrainPolicy(harnessRoot)
  const terminalRelease = trainPolicy.activeTerminalRelease
  let checkpoint = null
  let releaseKind

  if (terminalRelease !== null) {
    const releaseMetadata = readTaggedReleaseMetadata(targetRoot)
    const terminalFailures = validateActiveTerminalReleaseBinding({
      releaseTag,
      version: releaseVersion,
      migrationPhase: releaseMetadata.migrationPhase,
      dataSchema: releaseMetadata.dataSchema,
      sourceCommit,
      trainPolicy,
    })
    if (terminalFailures.length > 0) {
      throw new Error(
        `terminal release binding is invalid: ${terminalFailures.join('; ')}`
      )
    }
    releaseKind = 'terminal'
  } else {
    checkpoint = verifyCheckpoint({
      harnessRoot,
      parentCommit,
      releaseVersion,
      sourceCommit,
    })
    releaseKind = 'bridge-checkpoint'
  }

  const entries = parseNameStatus(
    git(
      harnessRoot,
      [
        'diff',
        '--name-status',
        '-z',
        '--find-renames',
        sourceCommit,
        trustedMain,
      ],
      { encoding: 'buffer' }
    ).stdout
  ).map((entry) => ({
    ...entry,
    newMode: treeMode(harnessRoot, trustedMain, entry.path)?.mode ?? null,
    oldMode: treeMode(harnessRoot, sourceCommit, entry.path)?.mode ?? null,
  }))

  const driftFailures =
    releaseKind === 'terminal'
      ? validateTerminalReleaseDrift(entries)
      : validateReleaseDrift(entries)
  if (driftFailures.length > 0) {
    throw new Error(driftFailures.join('\n'))
  }

  verifyPolicyView({
    harnessRoot,
    sourceCommit,
    targetRoot,
    trustedMain,
  })

  return {
    checkpoint,
    controlPlaneDrift: entries
      .filter((entry) => !CHECKPOINT_FILES.includes(entry.path))
      .map(({ path: relativePath, status }) => ({
        path: relativePath,
        status,
      })),
    parentCommit,
    releaseKind,
    releaseTag,
    releaseVersion,
    sourceCommit,
    trustedMain,
  }
}

function usage() {
  return [
    'Usage: node scripts/ci/verify-release-target.mjs',
    '  --harness-root <protected-main-checkout>',
    '  --release-tag <exact-v-prefixed-version>',
    '  --target-root <exact-tag-checkout>',
    '  --source-commit <40-hex>',
    '  --trusted-main <40-hex>',
  ].join(' \\\n')
}

function main() {
  const result = verifyReleaseTarget(
    parseReleaseTargetArgs(process.argv.slice(2))
  )
  console.log(
    JSON.stringify(
      {
        status: 'verified',
        ...result,
      },
      null,
      2
    )
  )
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    console.error(usage())
    process.exitCode = 1
  }
}
