import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  CHECKPOINT_FILES,
  REVIEWED_CONTROL_PLANE_DRIFT,
  TERMINAL_CONTROL_PLANE_DRIFT,
  parseNameStatus,
  parseReleaseTargetArgs,
  validateReleaseDrift,
  validateTerminalReleaseDrift,
  verifyReleaseTarget,
} from '../verify-release-target.mjs'

const exactA = 'a'.repeat(40)
const exactMain = 'b'.repeat(40)
const releaseTag = 'v0.6.643'
const TRACKED_TERMINAL = Object.freeze(
  JSON.parse(
    fs.readFileSync(
      new URL('../release-train-policy.json', import.meta.url),
      'utf8'
    )
  ).activeTerminalRelease
)
const terminalVersion = TRACKED_TERMINAL.version
const terminalTag = TRACKED_TERMINAL.tag
const nextTerminalVersion = terminalVersion.replace(
  /(\d+)$/,
  (patch) => String(Number(patch) + 1)
)
const SOURCE_CHECKPOINT_CONTENTS = Object.freeze({
  'biyan-release.json': '{"phase":"source"}\n',
  'src-tauri/Cargo.lock': 'source-lock\n',
  'src-tauri/Cargo.toml': 'source-cargo\n',
  'src-tauri/tauri.conf.json': '{"version":"source"}\n',
})
const MAIN_CHECKPOINT_CONTENTS = Object.freeze({
  'biyan-release.json': '{"phase":"protected-main"}\n',
  'src-tauri/Cargo.lock': 'protected-main-lock\n',
  'src-tauri/Cargo.toml': 'protected-main-cargo\n',
  'src-tauri/tauri.conf.json': '{"version":"protected-main"}\n',
})
const TERMINAL_SOURCE_CONTENTS = Object.freeze({
  'biyan-release.json':
    '{"schema":1,"migrationPhase":"C","dataSchema":3}\n',
  'src-tauri/Cargo.lock':
    `[[package]]\nname = "Biyan"\nversion = "${terminalVersion}"\n`,
  'src-tauri/Cargo.toml':
    `[package]\nname = "Biyan"\nversion = "${terminalVersion}"\n`,
  'src-tauri/tauri.conf.json':
    `{"version":"${terminalVersion}"}\n`,
})

function trainPolicy(sourceCommit = null) {
  const policy = JSON.parse(
    fs.readFileSync(
      new URL('../release-train-policy.json', import.meta.url),
      'utf8'
    )
  )
  policy.activeTerminalRelease =
    sourceCommit === null
      ? null
      : {
          ...policy.activeTerminalRelease,
          sourceCommit,
        }
  if (sourceCommit === null) {
    policy.supersededTerminalReleases = []
    policy.activeTrain = 'closure-20260724'
    policy.trains.at(-1).status = 'active'
  }
  return policy
}

function git(repoRoot, args) {
  return execFileSync('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function writeFixtureFile(repoRoot, relativePath, contents) {
  const absolute = path.join(repoRoot, relativePath)
  fs.mkdirSync(path.dirname(absolute), { recursive: true })
  fs.writeFileSync(absolute, contents)
}

function commitFixture(repoRoot, message, { allowEmpty = false } = {}) {
  git(repoRoot, ['add', '--all'])
  const args = ['commit', '--no-gpg-sign', '-m', message]
  if (allowEmpty) args.splice(1, 0, '--allow-empty')
  git(repoRoot, args)
  return git(repoRoot, ['rev-parse', 'HEAD'])
}

function createReleaseFixture(t, { terminal = false } = {}) {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'verify-release-target-test-')
  )
  const harnessRoot = path.join(temporaryRoot, 'harness')
  const targetRoot = path.join(temporaryRoot, 'target')

  try {
    fs.mkdirSync(harnessRoot)
    git(harnessRoot, ['init', '--initial-branch=main'])
    git(harnessRoot, ['config', 'user.name', 'Release Policy Test'])
    git(harnessRoot, ['config', 'user.email', 'release-policy@example.invalid'])
    git(harnessRoot, ['config', 'commit.gpgsign', 'false'])

    for (const relativePath of CHECKPOINT_FILES) {
      writeFixtureFile(
        harnessRoot,
        relativePath,
        terminal && relativePath === 'biyan-release.json'
          ? TERMINAL_SOURCE_CONTENTS[relativePath]
          : `parent:${relativePath}\n`
      )
    }
    writeFixtureFile(
      harnessRoot,
      '.github/workflows/desktop-release.yml',
      'tag-control\n'
    )
    writeFixtureFile(
      harnessRoot,
      'src-tauri/src/main.rs',
      terminal ? 'product-parent\n' : 'product-source\n'
    )
    writeFixtureFile(
      harnessRoot,
      'scripts/ci/release-train-policy.json',
      `${JSON.stringify(trainPolicy(), null, 2)}\n`
    )
    writeFixtureFile(
      harnessRoot,
      'scripts/ci/qualification-impact.mjs',
      terminal
        ? `throw new Error('terminal product source must not use checkpoint verification')\n`
        : `process.stdout.write(JSON.stringify({
  valid: true,
  changedFiles: ${JSON.stringify(CHECKPOINT_FILES)},
  targetVersion: '0.6.643'
}))
`
    )
    writeFixtureFile(
      harnessRoot,
      'scripts/ci/verify-release-policy.mjs',
      `import fs from 'node:fs'
import path from 'node:path'

const rootIndex = process.argv.indexOf('--repo-root')
if (rootIndex < 0 || !process.argv.includes('--require-active')) {
  throw new Error('protected policy arguments are missing')
}
const repoRoot = path.resolve(process.argv[rootIndex + 1])
const expected = ${JSON.stringify(
        terminal ? TERMINAL_SOURCE_CONTENTS : SOURCE_CHECKPOINT_CONTENTS
      )}
for (const [relativePath, contents] of Object.entries(expected)) {
  if (fs.readFileSync(path.join(repoRoot, relativePath), 'utf8') !== contents) {
    throw new Error(\`checkpoint was not composed from release source: \${relativePath}\`)
  }
}
if (
  fs.readFileSync(
    path.join(repoRoot, '.github/workflows/desktop-release.yml'),
    'utf8'
  ) !== 'protected-main-control\\n'
) {
  throw new Error('control plane was not composed from protected main')
}
if (
  fs.readFileSync(path.join(repoRoot, 'src-tauri/src/main.rs'), 'utf8') !==
  ${JSON.stringify(
    terminal ? 'terminal-product-source\n' : 'product-source\n'
  )}
) {
  throw new Error('product source changed in the composed policy view')
}
`
    )
    const parentCommit = commitFixture(harnessRoot, 'parent')

    for (const [relativePath, contents] of Object.entries(
      terminal ? TERMINAL_SOURCE_CONTENTS : SOURCE_CHECKPOINT_CONTENTS
    )) {
      writeFixtureFile(harnessRoot, relativePath, contents)
    }
    if (terminal) {
      writeFixtureFile(
        harnessRoot,
        'src-tauri/src/main.rs',
        'terminal-product-source\n'
      )
    }
    const sourceCommit = commitFixture(
      harnessRoot,
      terminal ? 'terminal product source' : 'source checkpoint'
    )

    if (terminal) {
      writeFixtureFile(
        harnessRoot,
        'scripts/ci/release-train-policy.json',
        `${JSON.stringify(trainPolicy(sourceCommit), null, 2)}\n`
      )
    } else {
      for (const [relativePath, contents] of Object.entries(
        MAIN_CHECKPOINT_CONTENTS
      )) {
        writeFixtureFile(harnessRoot, relativePath, contents)
      }
    }
    writeFixtureFile(
      harnessRoot,
      '.github/workflows/desktop-release.yml',
      'protected-main-control\n'
    )
    const trustedMain = commitFixture(harnessRoot, 'protected controls')
    git(harnessRoot, ['worktree', 'add', '--detach', targetRoot, sourceCommit])

    t.after(() => {
      try {
        git(harnessRoot, ['worktree', 'remove', '--force', targetRoot])
      } catch {
        // The temporary root removal below is the final cleanup fallback.
      }
      fs.rmSync(temporaryRoot, { force: true, recursive: true })
    })

    return {
      harnessRoot,
      parentCommit,
      releaseTag: terminal ? terminalTag : releaseTag,
      sourceCommit,
      targetRoot,
      trustedMain,
    }
  } catch (error) {
    fs.rmSync(temporaryRoot, { force: true, recursive: true })
    throw error
  }
}

test('release target arguments require two roots and exact commits', () => {
  assert.deepEqual(
    parseReleaseTargetArgs([
      '--harness-root',
      'harness',
      '--release-tag',
      releaseTag,
      '--target-root',
      'target',
      '--source-commit',
      exactA,
      '--trusted-main',
      exactMain,
    ]),
    {
      harnessRoot: path.resolve('harness'),
      releaseTag,
      sourceCommit: exactA,
      targetRoot: path.resolve('target'),
      trustedMain: exactMain,
    }
  )

  for (const args of [
    [],
    ['--harness-root', 'harness'],
    [
      '--harness-root',
      'harness',
      '--target-root',
      'target',
      '--source-commit',
      exactA,
      '--trusted-main',
      exactMain,
    ],
    [
      '--harness-root',
      'harness',
      '--harness-root',
      'other',
      '--release-tag',
      releaseTag,
      '--target-root',
      'target',
      '--source-commit',
      exactA,
      '--trusted-main',
      exactMain,
    ],
    [
      '--harness-root',
      'harness',
      '--release-tag',
      releaseTag,
      '--release-tag',
      releaseTag,
      '--target-root',
      'target',
      '--source-commit',
      exactA,
      '--trusted-main',
      exactMain,
    ],
    [
      '--harness-root',
      'harness',
      '--release-tag',
      releaseTag,
      '--target-root',
      'target',
      '--source-commit',
      'HEAD',
      '--trusted-main',
      exactMain,
    ],
    [
      '--harness-root',
      'harness',
      '--release-tag',
      'V0.6.643',
      '--target-root',
      'target',
      '--source-commit',
      exactA,
      '--trusted-main',
      exactMain,
    ],
    [
      '--harness-root',
      'harness',
      '--release-tag',
      'v00.6.643',
      '--target-root',
      'target',
      '--source-commit',
      exactA,
      '--trusted-main',
      exactMain,
    ],
    [
      '--harness-root',
      'harness',
      '--release-tag',
      releaseTag,
      '--target-root',
      'target',
      '--source-commit',
      exactA,
      '--trusted-main',
      exactMain,
      '--skip-product-policy',
      'true',
    ],
  ]) {
    assert.throws(() => parseReleaseTargetArgs(args))
  }
})

test('NUL-delimited diff parsing preserves status and rejects malformed data', () => {
  assert.deepEqual(
    parseNameStatus(
      Buffer.from(
        'M\0.github/workflows/desktop-release.yml\0A\0scripts/ci/verify-release-target.mjs\0'
      )
    ),
    [
      {
        path: '.github/workflows/desktop-release.yml',
        status: 'M',
      },
      {
        path: 'scripts/ci/verify-release-target.mjs',
        status: 'A',
      },
    ]
  )
  assert.deepEqual(parseNameStatus(Buffer.from('R100\0old.mjs\0new.mjs\0')), [
    {
      path: 'old.mjs',
      pathAfter: 'new.mjs',
      status: 'R100',
    },
  ])
  assert.throws(() => parseNameStatus(Buffer.from('M\0')))
  assert.throws(() => parseNameStatus(Buffer.from('R100\0old.mjs\0')))
})

test('release drift accepts only exact checkpoint and reviewed control files', () => {
  assert.deepEqual(
    validateReleaseDrift([
      {
        path: CHECKPOINT_FILES[0],
        status: 'M',
        oldMode: '100644',
        newMode: '100644',
      },
      {
        path: '.github/workflows/desktop-release.yml',
        status: 'M',
        oldMode: '100644',
        newMode: '100644',
      },
      {
        path: 'scripts/ci/verify-release-target.mjs',
        status: 'A',
        oldMode: null,
        newMode: '100644',
      },
      {
        path: 'scripts/ci/run-untrusted-qualification-verifier.sh',
        status: 'A',
        oldMode: null,
        newMode: '100755',
      },
    ]),
    []
  )

  assert.ok(
    validateReleaseDrift([
      {
        path: 'src-tauri/src/main.rs',
        status: 'M',
        oldMode: '100644',
        newMode: '100644',
      },
    ]).some((failure) => failure.includes('unreviewed release source drift'))
  )
  assert.ok(
    validateReleaseDrift([
      {
        path: '.github/workflows/old.yml',
        pathAfter: '.github/workflows/new.yml',
        status: 'R100',
        oldMode: '100644',
        newMode: '100644',
      },
    ]).some((failure) => failure.includes('rename or copy'))
  )
  assert.ok(
    validateReleaseDrift([
      {
        path: '.github/workflows/desktop-release.yml',
        status: 'M',
        oldMode: '100644',
        newMode: '100755',
      },
    ]).some((failure) => failure.includes('mode drift'))
  )
  assert.ok(
    validateReleaseDrift([
      {
        path: '.github/workflows/desktop-release.yml',
        status: 'M',
        oldMode: '100644',
        newMode: '120000',
      },
    ]).some((failure) => failure.includes('regular files'))
  )
  assert.ok(
    validateReleaseDrift([
      {
        path: 'scripts/ci/verify-release-target.mjs',
        status: 'M',
        oldMode: '100644',
        newMode: '100644',
      },
    ]).some((failure) => failure.includes('expected A, found M'))
  )
  assert.ok(
    validateReleaseDrift([
      {
        path: CHECKPOINT_FILES[0],
        status: 'D',
        oldMode: '100644',
        newMode: null,
      },
    ]).some((failure) => failure.includes('regular-file modification'))
  )
})

test('terminal drift accepts only the exact reviewed Q control-plane paths', () => {
  assert.deepEqual([...TERMINAL_CONTROL_PLANE_DRIFT], [
    ['.github/workflows/biyan-direct-qualification.yml', 'M'],
    ['.github/workflows/biyan-exact-sha-qualification.yml', 'M'],
    ['.github/workflows/biyan-linter-and-test.yml', 'M'],
    ['.github/workflows/biyan-upgrade-smoke.yml', 'M'],
    ['.github/workflows/desktop-release.yml', 'M'],
    ['.github/workflows/promote-desktop-update.yml', 'M'],
    ['.github/workflows/template-tauri-build-windows-x64.yml', 'M'],
    ['DEVELOPMENT_PLAN.md', 'M'],
    ['autoqa/migration_runner.py', 'M'],
    ['autoqa/tests/test_migration_runner.py', 'M'],
    ['docs/release-distribution.md', 'M'],
    ['docs/src/pages/docs/desktop/data-folder.mdx', 'M'],
    ['scripts/__tests__/windows-installer-template.test.mjs', 'M'],
    ['scripts/ci/__tests__/release-policy.test.mjs', 'M'],
    ['scripts/ci/__tests__/verify-release-target.test.mjs', 'M'],
    ['scripts/ci/legacy-compatibility-allowlist.json', 'M'],
    ['scripts/ci/release-policy-contracts.mjs', 'M'],
    ['scripts/ci/release-train-policy.json', 'M'],
    ['scripts/ci/verify-release-policy.mjs', 'M'],
    ['scripts/ci/verify-release-target.mjs', 'M'],
    ['scripts/ci/verify-windows-candidate.ps1', 'M'],
    ['scripts/release-distribution/__tests__/release-distribution.test.mjs', 'M'],
    ['scripts/updater/__tests__/direct-c-transition-policy.test.mjs', 'M'],
    ['scripts/updater/__tests__/direct-qualification.test.mjs', 'M'],
    ['scripts/updater/__tests__/legacy-manifest-policy.test.mjs', 'M'],
    ['scripts/updater/__tests__/recovery-qualification.test.mjs', 'A'],
    ['scripts/updater/__tests__/test_prepare_direct_qualification_inputs.py', 'M'],
    [
      'scripts/updater/__tests__/test_prepare_recovery_qualification_inputs.py',
      'A',
    ],
    ['scripts/updater/direct-c-contract.mjs', 'M'],
    ['scripts/updater/direct-c-transition-policy.json', 'M'],
    ['scripts/updater/direct-c-transition-policy.mjs', 'M'],
    ['scripts/updater/direct-qualification-evidence.mjs', 'M'],
    ['scripts/updater/direct-qualification-policy.json', 'M'],
    ['scripts/updater/legacy-manifest-policy.mjs', 'M'],
    ['scripts/updater/prepare-direct-qualification-inputs.py', 'M'],
    ['scripts/updater/prepare-recovery-qualification-inputs.py', 'A'],
    ['scripts/updater/recovery-qualification-evidence.mjs', 'A'],
    ['scripts/updater/worker.mjs', 'M'],
  ])

  const reviewed = [...TERMINAL_CONTROL_PLANE_DRIFT].map(
    ([relativePath, status]) => ({
      path: relativePath,
      status,
      oldMode: status === 'A' ? null : '100644',
      newMode: '100644',
    })
  )
  assert.deepEqual(validateTerminalReleaseDrift(reviewed), [])

  for (const [label, entry, pattern] of [
    [
      'product drift',
      {
        path: 'src-tauri/src/core/setup.rs',
        status: 'M',
        oldMode: '100644',
        newMode: '100644',
      },
      /unreviewed terminal release drift/,
    ],
    [
      'source identity drift',
      {
        path: 'src-tauri/tauri.conf.json',
        status: 'M',
        oldMode: '100644',
        newMode: '100644',
      },
      /must not modify source identity/,
    ],
    [
      'status drift',
      {
        path: 'scripts/updater/direct-c-transition-policy.json',
        status: 'A',
        oldMode: null,
        newMode: '100644',
      },
      /expected M, found A/,
    ],
    [
      'rename drift',
      {
        path: 'scripts/ci/release-train-policy.json',
        pathAfter: 'scripts/ci/release-policy.json',
        status: 'R100',
        oldMode: '100644',
        newMode: '100644',
      },
      /must not rename or copy/,
    ],
    [
      'mode drift',
      {
        path: 'scripts/ci/release-train-policy.json',
        status: 'M',
        oldMode: '100644',
        newMode: '120000',
      },
      /must use regular files/,
    ],
  ]) {
    assert.ok(
      validateTerminalReleaseDrift([entry]).some((failure) =>
        pattern.test(failure)
      ),
      label
    )
  }
})

test('the control-plane drift policy is an exact path allowlist', () => {
  assert.deepEqual(
    [...REVIEWED_CONTROL_PLANE_DRIFT],
    [
      ['.github/workflows/biyan-a-canary.yml', 'A'],
      ['.github/workflows/biyan-exact-sha-qualification.yml', 'M'],
      ['.github/workflows/biyan-linter-and-test.yml', 'M'],
      ['.github/workflows/deploy-updater-router.yml', 'M'],
      ['.github/workflows/desktop-release-draft-repair.yml', 'A'],
      ['.github/workflows/desktop-release-recovery.yml', 'A'],
      ['.github/workflows/desktop-release.yml', 'M'],
      ['.github/workflows/promote-desktop-update.yml', 'M'],
      ['.github/workflows/recover-split-updater-transaction.yml', 'A'],
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
      [
        'scripts/ci/__tests__/run-untrusted-qualification-verifier.test.mjs',
        'A',
      ],
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
      [
        'scripts/release-distribution/__tests__/release-distribution.test.mjs',
        'M',
      ],
      [
        'scripts/release-distribution/biyan-download-alias-bootstrap-allowlist.json',
        'A',
      ],
      [
        'scripts/release-distribution/bootstrap-biyan-download-aliases.mjs',
        'A',
      ],
      ['scripts/release-distribution/draft-asset-repair-state.mjs', 'A'],
      ['scripts/release-distribution/publish-download-transaction.mjs', 'M'],
      ['scripts/updater/__tests__/a-canary-evidence.test.mjs', 'A'],
      ['scripts/updater/__tests__/legacy-pause-transaction.test.mjs', 'A'],
      ['scripts/updater/__tests__/promotion-transaction.test.mjs', 'M'],
      ['scripts/updater/__tests__/test_prepare_a_canary_inputs.py', 'A'],
      ['scripts/updater/__tests__/updater.test.mjs', 'M'],
      [
        'scripts/updater/__tests__/verify-updater-asset-signature.test.mjs',
        'A',
      ],
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
    ]
  )
})

test('reviewed updater control-plane drift is status-bound and exact-path only', () => {
  const reviewedUpdaterDrift = [
    '.github/workflows/deploy-updater-router.yml',
    '.github/workflows/promote-desktop-update.yml',
    'scripts/release-distribution/__tests__/release-distribution.test.mjs',
    'scripts/updater/__tests__/promotion-transaction.test.mjs',
    'scripts/updater/__tests__/updater.test.mjs',
    'scripts/updater/legacy-a-transition-policy.json',
    'scripts/updater/promotion-transaction.mjs',
    'scripts/updater/run-promotion-transaction.sh',
  ]

  assert.deepEqual(
    validateReleaseDrift(
      reviewedUpdaterDrift.map((relativePath) => ({
        path: relativePath,
        status: 'M',
        oldMode: '100644',
        newMode: '100644',
      }))
    ),
    []
  )

  assert.ok(
    validateReleaseDrift([
      {
        path: 'scripts/updater/run-promotion-transaction.sh.bak',
        status: 'M',
        oldMode: '100644',
        newMode: '100644',
      },
    ]).some((failure) => failure.includes('unreviewed release source drift'))
  )
  assert.ok(
    validateReleaseDrift([
      {
        path: 'scripts/updater/promotion-transaction.mjs',
        status: 'A',
        oldMode: null,
        newMode: '100644',
      },
    ]).some((failure) => failure.includes('expected M, found A'))
  )
})

test('only the two reviewed AutoQA migration harness paths are control-plane drift', () => {
  assert.deepEqual(
    validateReleaseDrift(
      [
        'autoqa/migration_runner.py',
        'autoqa/tests/test_migration_runner.py',
      ].map((relativePath) => ({
        path: relativePath,
        status: 'M',
        oldMode: '100644',
        newMode: '100644',
      }))
    ),
    []
  )

  for (const relativePath of [
    'autoqa/checklist.md',
    'autoqa/tests/test_unreviewed.py',
    'autoqa/migration_runner.py.bak',
  ]) {
    assert.ok(
      validateReleaseDrift([
        {
          path: relativePath,
          status: 'M',
          oldMode: '100644',
          newMode: '100644',
        },
      ]).some((failure) =>
        failure.includes('unreviewed release source drift')
      ),
      relativePath
    )
  }
})

test('release target composes source checkpoints with protected controls', (t) => {
  const fixture = createReleaseFixture(t)
  const result = verifyReleaseTarget(fixture)

  assert.equal(result.parentCommit, fixture.parentCommit)
  assert.equal(result.releaseKind, 'bridge-checkpoint')
  assert.equal(result.releaseTag, releaseTag)
  assert.equal(result.releaseVersion, '0.6.643')
  assert.equal(result.sourceCommit, fixture.sourceCommit)
  assert.equal(result.trustedMain, fixture.trustedMain)
  assert.deepEqual(result.controlPlaneDrift, [
    {
      path: '.github/workflows/desktop-release.yml',
      status: 'M',
    },
  ])
})

test('terminal release target authenticates a full product source P through policy-only Q', (t) => {
  const fixture = createReleaseFixture(t, { terminal: true })
  const result = verifyReleaseTarget(fixture)

  assert.equal(result.parentCommit, fixture.parentCommit)
  assert.equal(result.releaseKind, 'terminal')
  assert.equal(result.releaseTag, terminalTag)
  assert.equal(result.releaseVersion, terminalVersion)
  assert.equal(result.sourceCommit, fixture.sourceCommit)
  assert.equal(result.trustedMain, fixture.trustedMain)
  assert.equal(result.checkpoint, null)
  assert.deepEqual(result.controlPlaneDrift, [
    {
      path: '.github/workflows/desktop-release.yml',
      status: 'M',
    },
    {
      path: 'scripts/ci/release-train-policy.json',
      status: 'M',
    },
  ])
})

test('terminal release target rejects a policy pin that does not exactly bind P', (t) => {
  const fixture = createReleaseFixture(t, { terminal: true })
  writeFixtureFile(
    fixture.harnessRoot,
    'scripts/ci/release-train-policy.json',
    `${JSON.stringify(trainPolicy('f'.repeat(40)), null, 2)}\n`
  )
  fixture.trustedMain = commitFixture(
    fixture.harnessRoot,
    'mismatched terminal pin'
  )

  assert.throws(
    () => verifyReleaseTarget(fixture),
    /terminal release binding is invalid/
  )
})

test('terminal release target rejects product or source identity drift after P', (t) => {
  const product = createReleaseFixture(t, { terminal: true })
  writeFixtureFile(
    product.harnessRoot,
    'src-tauri/src/main.rs',
    'unreviewed-post-source-change\n'
  )
  product.trustedMain = commitFixture(
    product.harnessRoot,
    'unreviewed product drift'
  )
  assert.throws(
    () => verifyReleaseTarget(product),
    /unreviewed terminal release drift: src-tauri\/src\/main\.rs/
  )

  const identity = createReleaseFixture(t, { terminal: true })
  writeFixtureFile(
    identity.harnessRoot,
    'src-tauri/tauri.conf.json',
    `{"version":"${nextTerminalVersion}"}\n`
  )
  identity.trustedMain = commitFixture(
    identity.harnessRoot,
    'unreviewed source identity drift'
  )
  assert.throws(
    () => verifyReleaseTarget(identity),
    /terminal control-plane commit must not modify source identity/
  )
})

test('release target rejects a tag version that aliases another checkpoint', (t) => {
  const fixture = createReleaseFixture(t)
  fixture.releaseTag = 'v0.6.644'

  assert.throws(
    () => verifyReleaseTarget(fixture),
    /release tag version 0\.6\.644 does not match checkpoint target version 0\.6\.643/
  )
})

test('release target rejects unreviewed product drift', (t) => {
  const fixture = createReleaseFixture(t)
  writeFixtureFile(
    fixture.harnessRoot,
    'src-tauri/src/main.rs',
    'unreviewed-product-drift\n'
  )
  fixture.trustedMain = commitFixture(
    fixture.harnessRoot,
    'unreviewed product drift'
  )

  assert.throws(
    () => verifyReleaseTarget(fixture),
    /unreviewed release source drift: src-tauri\/src\/main\.rs/
  )
})

test('release target rejects a dirty target checkout', (t) => {
  const fixture = createReleaseFixture(t)
  fs.appendFileSync(
    path.join(fixture.targetRoot, 'src-tauri/src/main.rs'),
    'dirty\n'
  )

  assert.throws(
    () => verifyReleaseTarget(fixture),
    /release target checkout must be clean/
  )
})

test('release target rejects a target checkout at the wrong HEAD', (t) => {
  const fixture = createReleaseFixture(t)
  git(fixture.targetRoot, ['checkout', '--detach', fixture.parentCommit])

  assert.throws(
    () => verifyReleaseTarget(fixture),
    /release target HEAD does not match source commit/
  )
})

test('release target rejects a merge commit as the release source', (t) => {
  const fixture = createReleaseFixture(t)
  git(fixture.harnessRoot, [
    'checkout',
    '-b',
    'merge-side',
    fixture.trustedMain,
  ])
  commitFixture(fixture.harnessRoot, 'merge side', { allowEmpty: true })
  git(fixture.harnessRoot, ['checkout', 'main'])
  commitFixture(fixture.harnessRoot, 'merge main', { allowEmpty: true })
  git(fixture.harnessRoot, [
    'merge',
    '--no-ff',
    '--no-gpg-sign',
    'merge-side',
    '-m',
    'merge source',
  ])
  fixture.sourceCommit = git(fixture.harnessRoot, ['rev-parse', 'HEAD'])
  fixture.trustedMain = commitFixture(
    fixture.harnessRoot,
    'trusted after merge',
    { allowEmpty: true }
  )
  git(fixture.targetRoot, ['checkout', '--detach', fixture.sourceCommit])

  assert.throws(
    () => verifyReleaseTarget(fixture),
    /release source must have exactly one parent/
  )
})
