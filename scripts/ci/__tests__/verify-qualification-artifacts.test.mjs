import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  createQualificationArtifactManifest,
  normalizeArtifactPath,
  sha256File,
  verifyQualificationArtifactManifest,
  verifyQualificationPlatforms,
} from '../verify-qualification-artifacts.mjs'

const BASE = '1'.repeat(40)
const TARGET = '2'.repeat(40)
const WORKFLOW = '3'.repeat(40)
const SOURCE_MANIFEST = '4'.repeat(64)
const VERSION = '0.6.639'

function fixture(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'biyan-qualification-'))
  fs.mkdirSync(path.join(root, 'linux'), { recursive: true })
  fs.mkdirSync(path.join(root, 'windows'), { recursive: true })
  fs.writeFileSync(path.join(root, 'linux', 'Biyan.AppImage'), 'linux')
  fs.writeFileSync(path.join(root, 'windows', 'Biyan.exe'), 'windows')
  const manifest = path.join(root, 'manifest', 'qualification-artifacts.json')
  createQualificationArtifactManifest({
    root,
    output: manifest,
    targetSha: TARGET,
    baseSha: BASE,
    workflowSha: WORKFLOW,
    runId: '123',
    ...options,
  })
  return { root, manifest, manifestSha: sha256File(manifest) }
}

const PLATFORM_PACKAGES = {
  linux: [
    `Biyan_${VERSION}_amd64.AppImage`,
    `Biyan_${VERSION}_amd64.deb`,
  ],
  macos: [`Biyan_${VERSION}.app.tar.gz`, `Biyan_${VERSION}_universal.dmg`],
  windows: [
    `Biyan_${VERSION}_x64-setup.exe`,
    `Biyan_${VERSION}_x64_en-US.msi`,
  ],
}

const PLATFORM_ARCHITECTURES = {
  linux: 'x86_64',
  macos: 'x86_64',
  windows: 'AMD64',
}

function platformFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'biyan-platforms-'))
  for (const platform of ['linux', 'macos', 'windows']) {
    const packageRoot = path.join(root, 'packages', platform)
    fs.mkdirSync(packageRoot, { recursive: true })
    for (const name of PLATFORM_PACKAGES[platform]) {
      fs.writeFileSync(path.join(packageRoot, name), `${platform}:${name}`)
    }
    const provenance = {
      schema: 1,
      platform,
      architecture: PLATFORM_ARCHITECTURES[platform],
      runnerArch: 'X64',
      imageOS: `${platform}-image`,
      imageVersion: '20260721.1',
      node: 'v20.19.4',
      yarn: '1.22.22',
      rust: 'rustc 1.88.0',
      cargo: 'cargo 1.88.0',
      targetSha: TARGET,
      baseSha: BASE,
      version: VERSION,
      migrationPhase: 'C',
      dataSchema: 3,
      built: true,
    }
    fs.writeFileSync(
      path.join(root, `runner-provenance-${platform}.json`),
      `${JSON.stringify(provenance, null, 2)}\n`
    )
  }
  return root
}

function mutateProvenance(root, platform, mutate) {
  const file = path.join(root, `runner-provenance-${platform}.json`)
  const provenance = JSON.parse(fs.readFileSync(file, 'utf8'))
  mutate(provenance)
  fs.writeFileSync(file, `${JSON.stringify(provenance, null, 2)}\n`)
}

function verifyPlatforms(root, options = {}) {
  return verifyQualificationPlatforms({
    root,
    expectedTargetSha: TARGET,
    expectedBaseSha: BASE,
    ...options,
  })
}

test('creates and verifies an exact sorted artifact set', () => {
  const { root, manifest, manifestSha } = fixture()
  const parsed = verifyQualificationArtifactManifest({
    root,
    manifestPath: manifest,
    expectedManifestSha256: manifestSha,
    expectedTargetSha: TARGET,
    expectedBaseSha: BASE,
    expectedRunId: '123',
  })
  assert.deepEqual(
    parsed.files.map((entry) => entry.path),
    ['linux/Biyan.AppImage', 'windows/Biyan.exe']
  )
})

test('manifest creation globally sorts nested and sibling paths', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'biyan-artifact-order-'))
  fs.mkdirSync(path.join(root, 'a'), { recursive: true })
  fs.writeFileSync(path.join(root, 'a', 'z.txt'), 'nested')
  fs.writeFileSync(path.join(root, 'a.txt'), 'sibling')
  const manifest = path.join(root, 'manifest.json')
  const created = createQualificationArtifactManifest({
    root,
    output: manifest,
    targetSha: TARGET,
    baseSha: BASE,
    workflowSha: WORKFLOW,
    runId: '123',
  })
  assert.deepEqual(
    created.files.map((entry) => entry.path),
    ['a.txt', 'a/z.txt']
  )
  assert.doesNotThrow(() =>
    verifyQualificationArtifactManifest({
      root,
      manifestPath: manifest,
      expectedManifestSha256: sha256File(manifest),
      expectedTargetSha: TARGET,
      expectedBaseSha: BASE,
      expectedRunId: '123',
    })
  )
})

test('rejects changed, missing, and unlisted artifacts', () => {
  for (const mutate of [
    (root) => fs.appendFileSync(path.join(root, 'linux', 'Biyan.AppImage'), '!'),
    (root) => fs.rmSync(path.join(root, 'windows', 'Biyan.exe')),
    (root) => fs.writeFileSync(path.join(root, 'extra.txt'), 'extra'),
  ]) {
    const { root, manifest, manifestSha } = fixture()
    mutate(root)
    assert.throws(() =>
      verifyQualificationArtifactManifest({
        root,
        manifestPath: manifest,
        expectedManifestSha256: manifestSha,
        expectedTargetSha: TARGET,
        expectedBaseSha: BASE,
        expectedRunId: '123',
      })
    )
  }
})

test('pins manifest digest and exact source identity', () => {
  const { root, manifest, manifestSha } = fixture()
  const common = {
    root,
    manifestPath: manifest,
    expectedManifestSha256: manifestSha,
    expectedTargetSha: TARGET,
    expectedBaseSha: BASE,
    expectedRunId: '123',
  }
  assert.throws(() =>
    verifyQualificationArtifactManifest({
      ...common,
      expectedManifestSha256: '0'.repeat(64),
    })
  )
  assert.throws(() =>
    verifyQualificationArtifactManifest({
      ...common,
      expectedTargetSha: '4'.repeat(40),
    })
  )
  assert.throws(() =>
    verifyQualificationArtifactManifest({ ...common, expectedRunId: '124' })
  )
})

test('records and verifies an exact chained base evidence pair', () => {
  const { root, manifest, manifestSha } = fixture({
    sourceRunId: '122',
    sourceManifestSha256: SOURCE_MANIFEST,
  })
  const parsed = verifyQualificationArtifactManifest({
    root,
    manifestPath: manifest,
    expectedManifestSha256: manifestSha,
    expectedTargetSha: TARGET,
    expectedBaseSha: BASE,
    expectedRunId: '123',
    expectedSourceRunId: '122',
    expectedSourceManifestSha256: SOURCE_MANIFEST,
  })
  assert.equal(parsed.sourceRunId, '122')
  assert.equal(parsed.sourceManifestSha256, SOURCE_MANIFEST)
})

test('requires chained base evidence inputs and manifest fields all-or-none', () => {
  for (const options of [
    { sourceRunId: '122' },
    { sourceManifestSha256: SOURCE_MANIFEST },
  ]) {
    assert.throws(() => fixture(options), /must be provided together/)
  }

  const chained = fixture({
    sourceRunId: '122',
    sourceManifestSha256: SOURCE_MANIFEST,
  })
  const chainedCommon = {
    root: chained.root,
    manifestPath: chained.manifest,
    expectedManifestSha256: chained.manifestSha,
    expectedTargetSha: TARGET,
    expectedBaseSha: BASE,
    expectedRunId: '123',
  }
  assert.doesNotThrow(() => verifyQualificationArtifactManifest(chainedCommon))
  assert.throws(
    () =>
      verifyQualificationArtifactManifest({
        ...chainedCommon,
        expectedSourceRunId: '122',
      }),
    /must be provided together/
  )
  assert.throws(
    () =>
      verifyQualificationArtifactManifest({
        ...chainedCommon,
        expectedSourceRunId: '121',
        expectedSourceManifestSha256: SOURCE_MANIFEST,
      }),
    /source evidence mismatch/
  )

  const unchained = fixture()
  assert.throws(
    () =>
      verifyQualificationArtifactManifest({
        root: unchained.root,
        manifestPath: unchained.manifest,
        expectedManifestSha256: unchained.manifestSha,
        expectedTargetSha: TARGET,
        expectedBaseSha: BASE,
        expectedRunId: '123',
        expectedSourceRunId: '122',
        expectedSourceManifestSha256: SOURCE_MANIFEST,
      }),
    /source evidence is missing/
  )
})

test('verifies a second chained hop without repeating the first hop inputs', () => {
  const first = fixture({
    sourceRunId: '122',
    sourceManifestSha256: SOURCE_MANIFEST,
  })
  const parsed = verifyQualificationArtifactManifest({
    root: first.root,
    manifestPath: first.manifest,
    expectedManifestSha256: first.manifestSha,
    expectedTargetSha: TARGET,
    expectedBaseSha: BASE,
    expectedRunId: '123',
  })
  assert.equal(parsed.sourceRunId, '122')
  assert.equal(parsed.sourceManifestSha256, SOURCE_MANIFEST)
})

test('rejects a partial or invalid chained pair inside a pinned manifest', () => {
  for (const mutate of [
    (parsed) => {
      parsed.sourceRunId = '122'
    },
    (parsed) => {
      parsed.sourceRunId = '0'
      parsed.sourceManifestSha256 = SOURCE_MANIFEST
    },
    (parsed) => {
      parsed.sourceRunId = '122'
      parsed.sourceManifestSha256 = 'invalid'
    },
    (parsed) => {
      parsed.sourceRunId = null
      parsed.sourceManifestSha256 = null
    },
  ]) {
    const { root, manifest } = fixture()
    const parsed = JSON.parse(fs.readFileSync(manifest, 'utf8'))
    mutate(parsed)
    fs.writeFileSync(manifest, `${JSON.stringify(parsed, null, 2)}\n`)
    assert.throws(() =>
      verifyQualificationArtifactManifest({
        root,
        manifestPath: manifest,
        expectedManifestSha256: sha256File(manifest),
        expectedTargetSha: TARGET,
        expectedBaseSha: BASE,
        expectedRunId: '123',
        expectedSourceRunId: '122',
        expectedSourceManifestSha256: SOURCE_MANIFEST,
      })
    )
  }
})

test('rejects path traversal and non-portable paths', () => {
  for (const value of ['', '/tmp/file', '../file', 'a/../file', 'a\\file']) {
    assert.throws(() => normalizeArtifactPath(value))
  }
  assert.equal(normalizeArtifactPath('linux/Biyan.AppImage'), 'linux/Biyan.AppImage')
})

test('rejects malicious, duplicate, or unsorted manifest paths', () => {
  for (const mutate of [
    (parsed) => {
      parsed.files[0].path = '../escape'
    },
    (parsed) => {
      parsed.files[1].path = parsed.files[0].path
    },
    (parsed) => {
      parsed.files.reverse()
    },
  ]) {
    const { root, manifest } = fixture()
    const parsed = JSON.parse(fs.readFileSync(manifest, 'utf8'))
    mutate(parsed)
    fs.writeFileSync(manifest, `${JSON.stringify(parsed, null, 2)}\n`)
    assert.throws(() =>
      verifyQualificationArtifactManifest({
        root,
        manifestPath: manifest,
        expectedManifestSha256: sha256File(manifest),
        expectedTargetSha: TARGET,
        expectedBaseSha: BASE,
        expectedRunId: '123',
      })
    )
  }
})

test('rejects symlinks when the platform supports them', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'biyan-qualification-link-'))
  fs.writeFileSync(path.join(root, 'real'), 'artifact')
  try {
    fs.symlinkSync('real', path.join(root, 'alias'))
  } catch (error) {
    t.skip(`symlinks unavailable: ${error.code}`)
    return
  }
  assert.throws(() =>
    createQualificationArtifactManifest({
      root,
      output: path.join(root, 'manifest.json'),
      targetSha: TARGET,
      baseSha: BASE,
      workflowSha: WORKFLOW,
      runId: '123',
    })
  )
})

test('sha256File hashes bytes without loading the whole artifact', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'biyan-hash-'))
  const file = path.join(root, 'artifact')
  fs.writeFileSync(file, Buffer.from([0, 1, 2, 3, 255]))
  assert.equal(
    sha256File(file),
    crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  )
})

test('verifies complete native x86_64 provenance and exact package formats', () => {
  const root = platformFixture()
  const result = verifyPlatforms(root)
  assert.deepEqual(Object.keys(result), ['linux', 'macos', 'windows'])
  assert.deepEqual(
    result.macos.packages,
    [...PLATFORM_PACKAGES.macos].sort((a, b) => a.localeCompare(b))
  )
  assert.equal(result.windows.version, VERSION)
  assert.equal(result.linux.migrationPhase, 'C')

  assert.doesNotThrow(() =>
    verifyQualificationPlatforms({ root })
  )

  const script = path.resolve('scripts/ci/verify-qualification-artifacts.mjs')
  const cli = childProcess.spawnSync(
    process.execPath,
    [
      script,
      'verify-platforms',
      '--root',
      root,
      '--target-sha',
      TARGET,
      '--base-sha',
      BASE,
    ],
    { encoding: 'utf8' }
  )
  assert.equal(cli.status, 0, cli.stderr)
  assert.match(cli.stdout, /platform provenance and packages verified/)
})

test('requires expected target and base SHAs together when pinning a fresh build', () => {
  const root = platformFixture()
  assert.throws(
    () =>
      verifyQualificationPlatforms({
        root,
        expectedTargetSha: TARGET,
      }),
    /must be provided together/
  )
  assert.throws(
    () =>
      verifyPlatforms(root, { expectedTargetSha: '5'.repeat(40) }),
    /target SHA mismatch/
  )
})

test('rejects missing, malformed, and incomplete platform provenance', () => {
  for (const mutate of [
    (root) => fs.rmSync(path.join(root, 'runner-provenance-macos.json')),
    (root) =>
      fs.writeFileSync(path.join(root, 'runner-provenance-windows.json'), '{'),
    (root) => mutateProvenance(root, 'linux', (value) => (value.schema = 2)),
  ]) {
    const root = platformFixture()
    mutate(root)
    assert.throws(() => verifyPlatforms(root))
  }
})

test('rejects wrong native architecture, runner, build, and SHA provenance', () => {
  for (const [mutate, pattern] of [
    [(value) => (value.architecture = 'aarch64'), /architecture/],
    [(value) => (value.runnerArch = 'ARM64'), /runnerArch/],
    [(value) => (value.built = false), /built=true/],
    [(value) => (value.targetSha = 'bad'), /40-hex/],
    [(value) => (value.targetSha = '5'.repeat(40)), /target SHA mismatch/],
    [(value) => (value.baseSha = '6'.repeat(40)), /base SHA mismatch/],
  ]) {
    const root = platformFixture()
    mutateProvenance(root, 'windows', mutate)
    assert.throws(() => verifyPlatforms(root), pattern)
  }
})

test('rejects invalid version and migration phase/data schema provenance', () => {
  for (const [mutate, pattern] of [
    [(value) => (value.version = '0.6'), /SemVer/],
    [(value) => (value.migrationPhase = 'D'), /A, B, or C/],
    [(value) => (value.dataSchema = 2), /pairing is invalid/],
  ]) {
    const root = platformFixture()
    mutateProvenance(root, 'macos', mutate)
    assert.throws(() => verifyPlatforms(root), pattern)
  }
})

test('rejects empty image and toolchain provenance', () => {
  for (const field of ['imageOS', 'imageVersion', 'node', 'yarn', 'rust', 'cargo']) {
    const root = platformFixture()
    mutateProvenance(root, 'linux', (value) => (value[field] = '  '))
    assert.throws(() => verifyPlatforms(root), new RegExp(field))
  }
})

test('requires one coherent release identity across all platforms', () => {
  const root = platformFixture()
  mutateProvenance(root, 'windows', (value) => {
    value.version = '0.6.638'
    value.migrationPhase = 'B'
    value.dataSchema = 2
  })
  for (const oldName of PLATFORM_PACKAGES.windows) {
    fs.renameSync(
      path.join(root, 'packages', 'windows', oldName),
      path.join(root, 'packages', 'windows', oldName.replace(VERSION, '0.6.638'))
    )
  }
  assert.throws(() => verifyPlatforms(root), /release identities do not match/)
})

test('allows partial rebuild provenance origins while retaining one release identity', () => {
  const root = platformFixture()
  mutateProvenance(root, 'windows', (value) => {
    value.targetSha = '5'.repeat(40)
    value.baseSha = '4'.repeat(40)
  })
  assert.doesNotThrow(() => verifyQualificationPlatforms({ root }))
  assert.throws(() => verifyPlatforms(root), /target SHA mismatch/)
})

test('rejects missing, extra, empty, nested, and version-mismatched packages', () => {
  const mutations = [
    (root) =>
      fs.rmSync(
        path.join(root, 'packages', 'linux', PLATFORM_PACKAGES.linux[0])
      ),
    (root) =>
      fs.writeFileSync(path.join(root, 'packages', 'windows', 'extra.exe'), 'x'),
    (root) =>
      fs.writeFileSync(
        path.join(root, 'packages', 'macos', PLATFORM_PACKAGES.macos[0]),
        ''
      ),
    (root) =>
      fs.mkdirSync(path.join(root, 'packages', 'linux', 'nested')),
    (root) =>
      fs.renameSync(
        path.join(root, 'packages', 'windows', PLATFORM_PACKAGES.windows[0]),
        path.join(
          root,
          'packages',
          'windows',
          PLATFORM_PACKAGES.windows[0].replace(VERSION, '0.6.638')
        )
      ),
    (root) => fs.mkdirSync(path.join(root, 'packages', 'freebsd')),
  ]
  for (const mutate of mutations) {
    const root = platformFixture()
    mutate(root)
    assert.throws(() => verifyPlatforms(root))
  }
})

test('rejects symlink packages when the platform supports them', (t) => {
  const root = platformFixture()
  const packagePath = path.join(
    root,
    'packages',
    'linux',
    PLATFORM_PACKAGES.linux[0]
  )
  fs.rmSync(packagePath)
  try {
    fs.symlinkSync(PLATFORM_PACKAGES.linux[1], packagePath)
  } catch (error) {
    t.skip(`symlinks unavailable: ${error.code}`)
    return
  }
  assert.throws(() => verifyPlatforms(root), /flat regular file/)
})
