import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  classifyChangedFiles,
  verifyCheckpoint,
} from '../qualification-impact.mjs'

const SCRIPT_PATH = fileURLToPath(
  new URL('../qualification-impact.mjs', import.meta.url)
)
const CHECKPOINT_FILES = [
  'biyan-release.json',
  'src-tauri/Cargo.lock',
  'src-tauri/Cargo.toml',
  'src-tauri/tauri.conf.json',
]

function git(repo, args, { input } = {}) {
  const result = spawnSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    input,
    maxBuffer: 8 * 1024 * 1024,
  })
  assert.equal(
    result.status,
    0,
    `git ${args.join(' ')} failed: ${result.stderr || result.stdout}`
  )
  return result.stdout.trim()
}

function createRepo(t) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'biyan-impact-'))
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }))
  git(repo, ['init', '--quiet'])
  git(repo, ['config', 'user.name', 'Biyan CI Test'])
  git(repo, ['config', 'user.email', 'ci-test@example.invalid'])
  return repo
}

function writeFile(repo, relativePath, source, mode) {
  const absolutePath = path.join(repo, relativePath)
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
  fs.writeFileSync(absolutePath, source)
  if (mode !== undefined) fs.chmodSync(absolutePath, mode)
}

function commitAll(repo, message) {
  git(repo, ['add', '-A'])
  git(repo, ['commit', '--quiet', '-m', message])
  return git(repo, ['rev-parse', 'HEAD'])
}

function runCli(args) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  })
}

function runJson(args) {
  const result = runCli([...args, '--format', 'json'])
  return { ...result, json: JSON.parse(result.stdout) }
}

function writeCheckpoint(
  repo,
  {
    version,
    phase,
    dataSchema = { A: 1, B: 2, C: 3 }[phase],
    tauriMarker = 'stable',
    cargoMarker = 'stable',
    lockMarker = 'stable',
    cargoVersion = version,
    lockVersion = version,
  }
) {
  writeFile(
    repo,
    'biyan-release.json',
    `${JSON.stringify({ schema: 1, migrationPhase: phase, dataSchema }, null, 2)}\n`
  )
  writeFile(
    repo,
    'src-tauri/tauri.conf.json',
    `${JSON.stringify(
      {
        $schema: 'https://schema.tauri.app/config/2',
        productName: 'Biyan',
        version,
        identifier: 'uk.jingxing.mita',
        build: { marker: tauriMarker },
      },
      null,
      2
    )}\n`
  )
  writeFile(
    repo,
    'src-tauri/Cargo.toml',
    [
      '[package]',
      'name = "Biyan"',
      `version = "${cargoVersion}"`,
      `description = "${cargoMarker}"`,
      '',
      '[dependencies]',
      'serde = "1"',
      '',
    ].join('\n')
  )
  writeFile(
    repo,
    'src-tauri/Cargo.lock',
    [
      '# generated',
      'version = 3',
      '',
      '[[package]]',
      'name = "Biyan"',
      `version = "${lockVersion}"`,
      'dependencies = [',
      ' "serde",',
      ']',
      '',
      '[[package]]',
      'name = "serde"',
      'version = "1.0.0"',
      `checksum = "${lockMarker}"`,
      '',
    ].join('\n')
  )
}

function makeCheckpointPair(t, targetOverrides = {}) {
  const repo = createRepo(t)
  writeCheckpoint(repo, { version: '0.6.640', phase: 'A' })
  const base = commitAll(repo, 'checkpoint A')
  writeCheckpoint(repo, {
    version: '0.6.641',
    phase: 'B',
    ...targetOverrides,
  })
  const target = commitAll(repo, 'checkpoint B')
  return { repo, base, target }
}

test('docs-only paths normalize deterministically and do no build work', () => {
  const result = classifyChangedFiles([
    './docs//guide.mdx',
    'README.md',
    '.github\\ISSUE_TEMPLATE\\bug.yml',
    'README.md',
  ])
  assert.equal(result.classification, 'docs-only')
  assert.deepEqual(result.changedFiles, [
    '.github/ISSUE_TEMPLATE/bug.yml',
    'README.md',
    'docs/guide.mdx',
  ])
  assert.equal(result.flags.docs, true)
  assert.equal(result.flags.focused, false)
  assert.equal(result.flags.quick, false)
  assert.equal(result.flags.full, false)
  assert.match(result.planSha256, /^[0-9a-f]{64}$/)
})

test('checkpoint-only requires the exact four-file set', () => {
  const checkpoint = classifyChangedFiles([...CHECKPOINT_FILES].reverse())
  assert.equal(checkpoint.classification, 'checkpoint-only')
  assert.equal(checkpoint.flags.checkpoint, true)
  assert.equal(checkpoint.flags.focused, true)
  assert.equal(checkpoint.flags.policy, true)
  assert.equal(checkpoint.flags.updater, true)
  assert.equal(checkpoint.flags.quick, false)
  assert.equal(checkpoint.flags.nativeTests, false)

  const subset = classifyChangedFiles(CHECKPOINT_FILES.slice(1))
  assert.notEqual(subset.classification, 'checkpoint-only')
  assert.equal(subset.flags.checkpoint, false)
  assert.equal(subset.flags.nativeTests, true)
  assert.equal(subset.flags.buildMacos, true)
})

test('direct JS/TS test-only changes run focused checks without native cold builds', () => {
  const result = classifyChangedFiles([
    'web-app/src/chat.test.tsx',
    'scripts/__tests__/release-policy.test.mjs',
  ])
  assert.equal(result.classification, 'test-only')
  assert.equal(result.flags.focused, true)
  assert.equal(result.flags.quick, true)
  assert.equal(result.flags.nativeTests, false)
  assert.equal(result.flags.testLinux, false)
  assert.equal(result.flags.buildLinux, false)
  assert.equal(result.flags.full, false)
})

test('non-direct tests and fixtures conservatively add native tests without builds', () => {
  for (const file of [
    'src-tauri/tests/migration.rs',
    'tests/test_migration.py',
    'tests/fixtures/migration.json',
    'tests/__fixtures__/migration.test.ts',
    'tests/not-directly-addressable.mjs',
  ]) {
    const result = classifyChangedFiles([file])
    assert.equal(result.classification, 'test-only')
    assert.equal(result.flags.focused, true)
    assert.equal(result.flags.nativeTests, true)
    assert.equal(result.flags.testLinux, true)
    assert.equal(result.flags.buildLinux, false)
    assert.equal(result.flags.buildMacos, false)
    assert.equal(result.flags.buildWindows, false)
    assert.equal(result.flags.full, false)
    if (file.endsWith('.rs')) {
      assert.equal(result.flags.testMacos, true)
      assert.equal(result.flags.testWindows, true)
    } else {
      assert.equal(result.flags.testMacos, false)
      assert.equal(result.flags.testWindows, false)
    }
  }
})

test('deleted directly addressable tests add Linux native tests and do not claim quick coverage', () => {
  const file = 'web-app/src/chat.test.tsx'
  const result = classifyChangedFiles([file], { deletedPaths: [file] })
  assert.equal(result.classification, 'test-only')
  assert.equal(result.flags.quick, false)
  assert.equal(result.flags.nativeTests, true)
  assert.equal(result.flags.testLinux, true)
  assert.equal(result.flags.buildLinux, false)
  assert.throws(
    () => classifyChangedFiles([file], { deletedPaths: ['tests/other.test.ts'] }),
    /subset/
  )
})

test('policy/verifier and updater/distribution changes replay artifacts without builds', () => {
  const policy = classifyChangedFiles(['scripts/ci/verify-release-policy.mjs'])
  assert.equal(policy.classification, 'policy/verifier-only')
  assert.equal(policy.flags.focused, true)
  assert.equal(policy.flags.policy, true)
  assert.equal(policy.flags.artifactReplay, true)
  assert.equal(policy.flags.quick, false)
  assert.equal(policy.flags.nativeTests, false)

  const updater = classifyChangedFiles([
    'scripts/updater/verify-candidate.mjs',
    'scripts/release-distribution/build-download-manifest.mjs',
  ])
  assert.equal(updater.classification, 'updater/distribution-only')
  assert.equal(updater.flags.focused, true)
  assert.equal(updater.flags.policy, true)
  assert.equal(updater.flags.updater, true)
  assert.equal(updater.flags.artifactReplay, true)
  assert.equal(updater.flags.quick, false)
  assert.equal(updater.flags.buildWindows, false)
})

test('platform packaging changes select only affected native test and build axes', () => {
  const macos = classifyChangedFiles(['src-tauri/tauri.macos.conf.json'])
  assert.equal(macos.classification, 'platform-packaging')
  assert.equal(macos.flags.nativeTests, true)
  assert.equal(macos.flags.testMacos, true)
  assert.equal(macos.flags.buildMacos, true)
  assert.equal(macos.flags.testWindows, false)
  assert.equal(macos.flags.buildWindows, false)
  assert.equal(macos.flags.quick, false)

  const windowsLinux = classifyChangedFiles([
    'src-tauri/windows/installer.wxs',
    'flatpak/uk.jingxing.mita.yml',
  ])
  assert.equal(windowsLinux.flags.testMacos, false)
  assert.equal(windowsLinux.flags.testWindows, true)
  assert.equal(windowsLinux.flags.testLinux, true)
  assert.equal(windowsLinux.flags.buildWindows, true)
  assert.equal(windowsLinux.flags.buildLinux, true)
  assert.equal(windowsLinux.flags.full, false)
})

test('candidate verifier changes rebuild only their affected native platform', () => {
  for (const [file, selected, skipped] of [
    ['scripts/verify-macos-candidate.mjs', 'Macos', ['Windows', 'Linux']],
    ['scripts/macos-architecture-policy.mjs', 'Macos', ['Windows', 'Linux']],
    [
      'scripts/ci/verify-windows-candidate.ps1',
      'Windows',
      ['Macos', 'Linux'],
    ],
  ]) {
    const result = classifyChangedFiles([file])
    assert.equal(result.classification, 'platform-packaging')
    assert.equal(result.flags[`test${selected}`], true)
    assert.equal(result.flags[`build${selected}`], true)
    assert.equal(result.flags.artifactReplay, false)
    for (const platform of skipped) {
      assert.equal(result.flags[`test${platform}`], false)
      assert.equal(result.flags[`build${platform}`], false)
    }
  }
})

test('runtime and dependency changes select quick, updater, full gate, and all native axes', () => {
  const result = classifyChangedFiles(['web-app/src/main.tsx', 'yarn.lock'])
  assert.equal(result.classification, 'runtime/dependency')
  assert.equal(result.flags.focused, true)
  assert.equal(result.flags.policy, true)
  assert.equal(result.flags.updater, true)
  assert.equal(result.flags.artifactReplay, false)
  assert.equal(result.flags.quick, true)
  assert.equal(result.flags.nativeTests, true)
  for (const platform of ['Macos', 'Windows', 'Linux']) {
    assert.equal(result.flags[`test${platform}`], true)
    assert.equal(result.flags[`build${platform}`], true)
  }
  assert.equal(result.flags.full, true)
})

test('bundled legal and resource inputs cannot be downgraded to docs-only', () => {
  for (const file of [
    'LICENSE',
    'NOTICE',
    'pre-install/README.md',
    'src-tauri/resources/NOTICE.md',
  ]) {
    const result = classifyChangedFiles([file])
    assert.equal(result.classification, 'runtime/dependency')
    assert.equal(result.categories.docsOnly, false)
    assert.equal(result.flags.artifactReplay, false)
    assert.equal(result.flags.full, true)
    for (const platform of ['Macos', 'Windows', 'Linux']) {
      assert.equal(result.flags[`test${platform}`], true)
      assert.equal(result.flags[`build${platform}`], true)
    }
  }
})

test('runtime mixed with verifier changes rebuilds instead of replaying artifacts', () => {
  const result = classifyChangedFiles([
    'web-app/src/main.tsx',
    'scripts/ci/verify-release-policy.mjs',
  ])
  assert.equal(result.classification, 'mixed')
  assert.equal(result.flags.full, true)
  assert.equal(result.flags.artifactReplay, false)
  assert.equal(result.flags.buildMacos, true)
  assert.equal(result.flags.buildWindows, true)
  assert.equal(result.flags.buildLinux, true)
})

test('tests or fixtures nested inside runtime source remain runtime/full', () => {
  for (const file of [
    'src-tauri/src/foo/tests/bar.rs',
    'core/src/provider/fixtures/response.json',
  ]) {
    const result = classifyChangedFiles([file])
    assert.equal(result.classification, 'runtime/dependency')
    assert.equal(result.flags.quick, true)
    assert.equal(result.flags.updater, true)
    assert.equal(result.flags.nativeTests, true)
    assert.equal(result.flags.full, true)
    for (const platform of ['Macos', 'Windows', 'Linux']) {
      assert.equal(result.flags[`test${platform}`], true)
      assert.equal(result.flags[`build${platform}`], true)
    }
  }
})

test('ordinary workflow-only changes are control-plane focused policy, not full', () => {
  const result = classifyChangedFiles(['.github/workflows/nightly.yml'])
  assert.equal(result.classification, 'control-plane')
  assert.equal(result.categories.controlPlane, true)
  assert.equal(result.flags.focused, true)
  assert.equal(result.flags.policy, true)
  assert.equal(result.flags.quick, false)
  assert.equal(result.flags.full, false)
})

test('platform template workflows select only their native platform axes', () => {
  for (const [name, platform] of [
    ['template-tauri-build-macos-external.yml', 'Macos'],
    ['template-tauri-build-windows-x64.yml', 'Windows'],
    ['template-tauri-build-linux-x64-flatpak.yml', 'Linux'],
  ]) {
    const result = classifyChangedFiles([`.github/workflows/${name}`])
    assert.equal(result.classification, 'platform-packaging')
    assert.equal(result.flags.nativeTests, true)
    assert.equal(result.flags[`test${platform}`], true)
    assert.equal(result.flags[`build${platform}`], true)
    assert.equal(result.flags.quick, false)
    assert.equal(result.flags.full, false)
    for (const other of ['Macos', 'Windows', 'Linux'].filter(
      (candidate) => candidate !== platform
    )) {
      assert.equal(result.flags[`test${other}`], false)
      assert.equal(result.flags[`build${other}`], false)
    }
  }
})

test('protected qualification workflows fail closed to a fresh three-platform build', () => {
  for (const name of [
    'desktop-release.yml',
    'biyan-exact-sha-qualification.yml',
    'biyan-linter-and-test.yml',
  ]) {
    const result = classifyChangedFiles([`.github/workflows/${name}`])
    assert.equal(result.classification, 'formal-release-control')
    assert.equal(result.categories.controlPlane, true)
    assert.equal(result.flags.full, true)
    assert.equal(result.flags.quick, true)
    assert.equal(result.flags.nativeTests, true)
    assert.equal(result.flags.checkpoint, false)
    assert.equal(result.flags.artifactReplay, false)
    for (const platform of ['Macos', 'Windows', 'Linux']) {
      assert.equal(result.flags[`test${platform}`], true)
      assert.equal(result.flags[`build${platform}`], true)
    }
  }
})

test('distribution and updater workflows replay artifacts without desktop builds', () => {
  for (const name of [
    'release-distribution.yml',
    'promote-desktop-update.yml',
    'updater-health-gate.yml',
  ]) {
    const result = classifyChangedFiles([`.github/workflows/${name}`])
    assert.equal(result.classification, 'updater/distribution-only')
    assert.equal(result.flags.focused, true)
    assert.equal(result.flags.policy, true)
    assert.equal(result.flags.updater, true)
    assert.equal(result.flags.artifactReplay, true)
    assert.equal(result.flags.quick, false)
    assert.equal(result.flags.nativeTests, false)
    assert.equal(result.flags.full, false)
  }
})

test('docs workflow runs docs and policy gates without desktop work', () => {
  const result = classifyChangedFiles(['.github/workflows/biyan-docs.yml'])
  assert.equal(result.classification, 'docs-control')
  assert.equal(result.flags.docs, true)
  assert.equal(result.flags.focused, true)
  assert.equal(result.flags.policy, true)
  assert.equal(result.flags.quick, false)
  assert.equal(result.flags.nativeTests, false)
  assert.equal(result.flags.buildMacos, false)
  assert.equal(result.flags.full, false)
})

test('classifier self-modification and unknown paths select safe full rebuild flags', () => {
  for (const files of [
    ['scripts/ci/qualification-impact.mjs'],
    ['unclassified-root-config.xyz'],
  ]) {
    const result = classifyChangedFiles(files)
    assert.equal(result.flags.full, true)
    assert.equal(result.flags.checkpoint, false)
    assert.equal(result.flags.artifactReplay, false)
    for (const key of [
      'docs',
      'focused',
      'policy',
      'updater',
      'quick',
      'nativeTests',
      'testMacos',
      'testWindows',
      'testLinux',
      'buildMacos',
      'buildWindows',
      'buildLinux',
      'full',
    ]) {
      assert.equal(result.flags[key], true)
    }
  }
})

test('force-full is deterministic and mixed scopes take the higher-risk union', () => {
  const mixed = classifyChangedFiles(['docs/guide.md', 'web-app/src/a.test.ts'])
  assert.equal(mixed.classification, 'mixed')
  assert.equal(mixed.flags.docs, true)
  assert.equal(mixed.flags.focused, true)
  assert.equal(mixed.flags.quick, true)
  assert.equal(mixed.flags.full, false)

  const first = classifyChangedFiles(['docs/guide.md'], { forceFull: true })
  const second = classifyChangedFiles(['./docs//guide.md'], { forceFull: true })
  assert.equal(first.planSha256, second.planSha256)
  assert.equal(first.flags.full, true)
  assert.equal(first.flags.checkpoint, false)
  assert.equal(first.flags.artifactReplay, false)
  assert.equal(first.flags.quick, true)
  assert.equal(first.flags.nativeTests, true)
})

test('require-replay applies to every non-bootstrap plan and conflicts with force-full', () => {
  for (const files of [
    ['docs/guide.md'],
    ['web-app/src/a.test.ts'],
    ['scripts/ci/verify-release-policy.mjs'],
    ['src-tauri/tauri.macos.conf.json'],
    ['web-app/src/main.tsx'],
    ['.github/workflows/nightly.yml'],
    ['unclassified-root-config.xyz'],
    CHECKPOINT_FILES,
  ]) {
    const result = classifyChangedFiles(files, { requireReplay: true })
    assert.equal(result.blocked, false)
    assert.equal(result.flags.artifactReplay, true)
  }
  assert.throws(
    () =>
      classifyChangedFiles(['docs/guide.md'], {
        forceFull: true,
        requireReplay: true,
      }),
    /mutually exclusive/
  )
})

test('empty diffs block and unsafe paths are rejected before classification', () => {
  const empty = classifyChangedFiles([])
  assert.equal(empty.classification, 'empty')
  assert.equal(empty.blocked, true)
  assert.equal(empty.flags.full, false)

  for (const unsafe of [
    '/etc/passwd',
    'C:\\Windows\\system.ini',
    './C:\\Windows\\system.ini',
    './/server/share',
    '../secret',
    'docs/../src/main.ts',
    'docs/bad\nname.md',
    '',
  ]) {
    assert.throws(() => classifyChangedFiles([unsafe]), /forbidden|control|empty/)
  }
})

test('verifyCheckpoint accepts a semantic four-file version/phase transition', (t) => {
  const { repo, base, target } = makeCheckpointPair(t)
  const result = verifyCheckpoint({ repo, base, target })
  assert.equal(result.valid, true)
  assert.equal(result.baseVersion, '0.6.640')
  assert.equal(result.targetVersion, '0.6.641')
  assert.equal(result.targetMigrationPhase, 'B')
  assert.equal(result.targetDataSchema, 2)
  assert.deepEqual(result.changedFiles, CHECKPOINT_FILES)

  const cli = runJson([
    'verify-checkpoint',
    '--repo',
    repo,
    '--base',
    base,
    '--target',
    target,
  ])
  assert.equal(cli.status, 0)
  assert.equal(cli.json.valid, true)
  assert.equal(cli.json.planSha256, result.planSha256)
})

test('verifyCheckpoint accepts a forward C-to-A train transition', (t) => {
  const repo = createRepo(t)
  writeCheckpoint(repo, { version: '0.6.639', phase: 'C' })
  const base = commitAll(repo, 'checkpoint C')
  writeCheckpoint(repo, { version: '0.6.640', phase: 'A' })
  const target = commitAll(repo, 'next train checkpoint A')

  const result = verifyCheckpoint({ repo, base, target })
  assert.equal(result.valid, true)
  assert.equal(result.baseMigrationPhase, 'C')
  assert.equal(result.targetMigrationPhase, 'A')
  assert.equal(result.baseVersion, '0.6.639')
  assert.equal(result.targetVersion, '0.6.640')
})

test('checkpoint verifier rejects equal, lower, and build-metadata-only versions', async (t) => {
  for (const [baseVersion, targetVersion, errorPattern] of [
    ['0.6.642', '0.6.640', /strictly higher version/],
    ['0.6.640', '0.6.640', /exactly the four checkpoint files/],
    ['0.6.640+base', '0.6.640+target', /strictly higher version/],
    ['0.6.640', '0.6.640-rc.1', /strictly higher version/],
  ]) {
    await t.test(`${baseVersion}->${targetVersion}`, (subtest) => {
      const repo = createRepo(subtest)
      writeCheckpoint(repo, { version: baseVersion, phase: 'C' })
      const base = commitAll(repo, 'checkpoint C')
      writeCheckpoint(repo, { version: targetVersion, phase: 'A' })
      const target = commitAll(repo, 'checkpoint A')
      assert.throws(
        () => verifyCheckpoint({ repo, base, target }),
        errorPattern
      )
    })
  }
})

test('checkpoint verifier rejects phase skips and reverse transitions', async (t) => {
  for (const [basePhase, targetPhase] of [
    ['A', 'C'],
    ['B', 'A'],
    ['C', 'B'],
  ]) {
    await t.test(`${basePhase}->${targetPhase}`, (subtest) => {
      const repo = createRepo(subtest)
      writeCheckpoint(repo, { version: '0.6.640', phase: basePhase })
      const base = commitAll(repo, `checkpoint ${basePhase}`)
      writeCheckpoint(repo, { version: '0.6.641', phase: targetPhase })
      const target = commitAll(repo, `checkpoint ${targetPhase}`)
      assert.throws(
        () => verifyCheckpoint({ repo, base, target }),
        /must transition C->A, A->B, or B->C/
      )
    })
  }
})

test('classify CLI semantically verifies checkpoint candidates', (t) => {
  const { repo, base, target } = makeCheckpointPair(t)
  const result = runJson([
    'classify',
    '--repo',
    repo,
    '--base',
    base,
    '--target',
    target,
  ])
  assert.equal(result.status, 0)
  assert.equal(result.json.classification, 'checkpoint-only')
  assert.equal(result.json.flags.checkpoint, true)
  assert.equal(result.json.checkpointVerification.valid, true)
  assert.match(result.json.planSha256, /^[0-9a-f]{64}$/)

  const github = runCli([
    'classify',
    '--repo',
    repo,
    '--base',
    base,
    '--target',
    target,
    '--format',
    'github-output',
  ])
  assert.equal(github.status, 0)
  assert.match(github.stdout, /^classification=checkpoint-only$/m)
  assert.match(github.stdout, /^checkpoint=true$/m)
  assert.match(github.stdout, /^quick=false$/m)
  assert.match(github.stdout, /^test_macos=false$/m)
  assert.match(github.stdout, /^build_linux=false$/m)
  assert.match(github.stdout, /^plan_sha256=[0-9a-f]{64}$/m)
})

test('checkpoint verifier rejects semantic changes hidden behind the four paths', async (t) => {
  const cases = [
    ['invalid phase/schema', { dataSchema: 3 }, /schema\/phase\/dataSchema/],
    ['tauri non-version edit', { tauriMarker: 'tampered' }, /tauri\.conf\.json changed/],
    ['Cargo.toml non-version edit', { cargoMarker: 'tampered' }, /Cargo\.toml changed/],
    ['Cargo.lock non-version edit', { lockMarker: 'tampered' }, /Cargo\.lock changed/],
    ['inconsistent versions', { cargoVersion: '0.6.999' }, /version fields disagree/],
  ]

  for (const [name, overrides, pattern] of cases) {
    await t.test(name, (subtest) => {
      const { repo, base, target } = makeCheckpointPair(subtest, overrides)
      assert.throws(() => verifyCheckpoint({ repo, base, target }), pattern)
      const cli = runJson([
        'classify',
        '--repo',
        repo,
        '--base',
        base,
        '--target',
        target,
      ])
      assert.equal(cli.status, 1)
      assert.equal(cli.json.classification, 'blocked')
      assert.equal(cli.json.blocked, true)
      assert.equal(cli.json.flags.full, true)
    })
  }
})

test('CLI classifies exact commits with stable JSON and github-output plans', (t) => {
  const repo = createRepo(t)
  writeFile(repo, 'README.md', '# base\n')
  const base = commitAll(repo, 'base')
  writeFile(repo, 'docs/guide.md', '# guide\n')
  const target = commitAll(repo, 'docs')

  const first = runJson([
    'classify',
    '--repo',
    repo,
    '--base',
    base,
    '--target',
    target,
  ])
  const second = runJson([
    'classify',
    '--repo',
    repo,
    '--base',
    base,
    '--target',
    target,
  ])
  assert.equal(first.status, 0)
  assert.equal(first.json.classification, 'docs-only')
  assert.equal(first.json.flags.docs, true)
  assert.equal(first.json.planSha256, second.json.planSha256)

  const github = runCli([
    'classify',
    '--repo',
    repo,
    '--base',
    base,
    '--target',
    target,
    '--format',
    'github-output',
  ])
  assert.equal(github.status, 0)
  assert.match(github.stdout, /^docs=true$/m)
  assert.match(github.stdout, /^quick=false$/m)
  assert.match(github.stdout, /^classification_json=\{/m)

  const replay = runJson([
    'classify',
    '--repo',
    repo,
    '--base',
    base,
    '--target',
    target,
    '--require-replay',
  ])
  assert.equal(replay.status, 0)
  assert.equal(replay.json.flags.artifactReplay, true)

  const bootstrap = runJson([
    'classify',
    '--repo',
    repo,
    '--base',
    base,
    '--target',
    target,
    '--force-full',
  ])
  assert.equal(bootstrap.status, 0)
  assert.equal(bootstrap.json.flags.full, true)
  assert.equal(bootstrap.json.flags.artifactReplay, false)
})

test('CLI deletion metadata prevents deleted JS/TS tests from producing zero tests', (t) => {
  const repo = createRepo(t)
  writeFile(repo, 'web-app/src/chat.test.tsx', 'export const covered = true\n')
  const base = commitAll(repo, 'base test')
  fs.rmSync(path.join(repo, 'web-app/src/chat.test.tsx'))
  const target = commitAll(repo, 'delete test')

  const result = runJson([
    'classify',
    '--repo',
    repo,
    '--base',
    base,
    '--target',
    target,
  ])
  assert.equal(result.status, 0)
  assert.equal(result.json.classification, 'test-only')
  assert.equal(result.json.flags.quick, false)
  assert.equal(result.json.flags.testLinux, true)
  assert.equal(result.json.flags.buildLinux, false)
})

test('CLI blocks empty, non-ancestor, rename, mode, symlink, and control-path diffs', async (t) => {
  await t.test('empty diff', (subtest) => {
    const repo = createRepo(subtest)
    writeFile(repo, 'README.md', '# base\n')
    const commit = commitAll(repo, 'base')
    const result = runJson([
      'classify',
      '--repo',
      repo,
      '--base',
      commit,
      '--target',
      commit,
    ])
    assert.equal(result.status, 1)
    assert.equal(result.json.blocked, true)
    assert.match(result.json.reasons[0], /empty diff/)
  })

  await t.test('non-ancestor', (subtest) => {
    const repo = createRepo(subtest)
    writeFile(repo, 'base.txt', 'base\n')
    const base = commitAll(repo, 'base')
    git(repo, ['checkout', '--quiet', '--orphan', 'side'])
    git(repo, ['rm', '--quiet', '-rf', '.'])
    writeFile(repo, 'side.txt', 'side\n')
    const target = commitAll(repo, 'side')
    const result = runJson([
      'classify',
      '--repo',
      repo,
      '--base',
      base,
      '--target',
      target,
    ])
    assert.equal(result.status, 1)
    assert.match(result.json.reasons[0], /not an ancestor/)
  })

  await t.test('rename', (subtest) => {
    const repo = createRepo(subtest)
    writeFile(repo, 'scripts/old.mjs', 'export const value = 1\n')
    const base = commitAll(repo, 'base')
    git(repo, ['mv', 'scripts/old.mjs', 'scripts/new.mjs'])
    const target = commitAll(repo, 'rename')
    const result = runJson([
      'classify',
      '--repo',
      repo,
      '--base',
      base,
      '--target',
      target,
    ])
    assert.equal(result.status, 1)
    assert.match(result.json.reasons[0], /rename\/copy\/type/)
  })

  await t.test('executable mode change', (subtest) => {
    const repo = createRepo(subtest)
    writeFile(repo, 'scripts/run.sh', '#!/bin/sh\n', 0o644)
    const base = commitAll(repo, 'base')
    fs.chmodSync(path.join(repo, 'scripts/run.sh'), 0o755)
    const target = commitAll(repo, 'mode')
    const result = runJson([
      'classify',
      '--repo',
      repo,
      '--base',
      base,
      '--target',
      target,
    ])
    assert.equal(result.status, 1)
    assert.match(result.json.reasons[0], /mode-changing/)
  })

  await t.test('symlink', (subtest) => {
    const repo = createRepo(subtest)
    writeFile(repo, 'README.md', '# base\n')
    const base = commitAll(repo, 'base')
    fs.symlinkSync('README.md', path.join(repo, 'docs-link'))
    const target = commitAll(repo, 'symlink')
    const result = runJson([
      'classify',
      '--repo',
      repo,
      '--base',
      base,
      '--target',
      target,
    ])
    assert.equal(result.status, 1)
    assert.match(result.json.reasons[0], /symlink|special file mode/)
  })

  await t.test('control character path', (subtest) => {
    const repo = createRepo(subtest)
    writeFile(repo, 'README.md', '# base\n')
    const base = commitAll(repo, 'base')
    writeFile(repo, 'docs/bad\nname.md', '# bad\n')
    const target = commitAll(repo, 'control path')
    const result = runJson([
      'classify',
      '--repo',
      repo,
      '--base',
      base,
      '--target',
      target,
    ])
    assert.equal(result.status, 1)
    assert.match(result.json.reasons[0], /control character/)
  })
})

test('CLI rejects abbreviated commits, malformed options, and invalid force-full use', (t) => {
  const repo = createRepo(t)
  writeFile(repo, 'README.md', '# base\n')
  const base = commitAll(repo, 'base')
  writeFile(repo, 'docs/guide.md', '# guide\n')
  const target = commitAll(repo, 'target')

  const abbreviated = runJson([
    'classify',
    '--repo',
    repo,
    '--base',
    base.slice(0, 12),
    '--target',
    target,
  ])
  assert.equal(abbreviated.status, 1)
  assert.match(abbreviated.json.reasons[0], /exact 40-hex/)

  const malformed = runCli(['classify', '--repo', repo, '--bogus'])
  assert.equal(malformed.status, 1)
  assert.equal(JSON.parse(malformed.stdout).classification, 'blocked')

  const invalidForce = runJson([
    'verify-checkpoint',
    '--repo',
    repo,
    '--base',
    base,
    '--target',
    target,
    '--force-full',
  ])
  assert.equal(invalidForce.status, 1)
  assert.match(invalidForce.json.reasons[0], /only valid for classify/)

  const conflictingModes = runJson([
    'classify',
    '--repo',
    repo,
    '--base',
    base,
    '--target',
    target,
    '--force-full',
    '--require-replay',
  ])
  assert.equal(conflictingModes.status, 1)
  assert.match(conflictingModes.json.reasons[0], /mutually exclusive/)
})

test('verify-checkpoint github output reports checkpoint_valid=false on failure', (t) => {
  const { repo, base, target } = makeCheckpointPair(t, {
    cargoMarker: 'tampered',
  })
  const result = runCli([
    'verify-checkpoint',
    '--repo',
    repo,
    '--base',
    base,
    '--target',
    target,
    '--format',
    'github-output',
  ])
  assert.equal(result.status, 1)
  assert.match(result.stdout, /^checkpoint_valid=false$/m)
  assert.match(result.stdout, /^plan_sha256=[0-9a-f]{64}$/m)
  assert.match(result.stdout, /^verification_json=\{"valid":false,/m)
})
