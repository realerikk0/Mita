import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  CHECKPOINT_FILES,
  REVIEWED_CONTROL_PLANE_DRIFT,
  parseNameStatus,
  parseReleaseTargetArgs,
  validateReleaseDrift,
  verifyReleaseTarget,
} from '../verify-release-target.mjs'

const exactA = 'a'.repeat(40)
const exactMain = 'b'.repeat(40)
const releaseTag = 'v0.6.643'
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

function createReleaseFixture(t) {
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
      writeFixtureFile(harnessRoot, relativePath, `parent:${relativePath}\n`)
    }
    writeFixtureFile(
      harnessRoot,
      '.github/workflows/desktop-release.yml',
      'tag-control\n'
    )
    writeFixtureFile(harnessRoot, 'src-tauri/src/main.rs', 'product-source\n')
    writeFixtureFile(
      harnessRoot,
      'scripts/ci/qualification-impact.mjs',
      `process.stdout.write(JSON.stringify({
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
const expected = ${JSON.stringify(SOURCE_CHECKPOINT_CONTENTS)}
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
  'product-source\\n'
) {
  throw new Error('product source changed in the composed policy view')
}
`
    )
    const parentCommit = commitFixture(harnessRoot, 'parent')

    for (const [relativePath, contents] of Object.entries(
      SOURCE_CHECKPOINT_CONTENTS
    )) {
      writeFixtureFile(harnessRoot, relativePath, contents)
    }
    const sourceCommit = commitFixture(harnessRoot, 'source checkpoint')

    for (const [relativePath, contents] of Object.entries(
      MAIN_CHECKPOINT_CONTENTS
    )) {
      writeFixtureFile(harnessRoot, relativePath, contents)
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
      releaseTag,
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

test('the control-plane drift policy is an exact path allowlist', () => {
  assert.deepEqual(
    [...REVIEWED_CONTROL_PLANE_DRIFT],
    [
      ['.github/workflows/biyan-exact-sha-qualification.yml', 'M'],
      ['.github/workflows/biyan-linter-and-test.yml', 'M'],
      ['.github/workflows/deploy-updater-router.yml', 'M'],
      ['.github/workflows/desktop-release-draft-repair.yml', 'A'],
      ['.github/workflows/desktop-release-recovery.yml', 'A'],
      ['.github/workflows/desktop-release.yml', 'M'],
      ['.github/workflows/promote-desktop-update.yml', 'M'],
      ['.github/workflows/release-distribution.yml', 'M'],
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
      ['scripts/updater/__tests__/promotion-transaction.test.mjs', 'M'],
      ['scripts/updater/__tests__/updater.test.mjs', 'M'],
      [
        'scripts/updater/__tests__/verify-updater-asset-signature.test.mjs',
        'A',
      ],
      ['scripts/updater/legacy-a-transition-policy.json', 'M'],
      ['scripts/updater/promotion-transaction.mjs', 'M'],
      ['scripts/updater/run-promotion-transaction.sh', 'M'],
      ['scripts/updater/verify-candidate.mjs', 'M'],
      ['scripts/updater/verify-updater-asset-signature.mjs', 'A'],
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

test('release target composes source checkpoints with protected controls', (t) => {
  const fixture = createReleaseFixture(t)
  const result = verifyReleaseTarget(fixture)

  assert.equal(result.parentCommit, fixture.parentCommit)
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
    /release checkpoint must have exactly one parent/
  )
})
