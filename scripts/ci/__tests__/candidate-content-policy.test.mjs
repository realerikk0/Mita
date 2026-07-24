import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import zlib from 'node:zlib'

import {
  CANDIDATE_CONTENT_LIMITS,
  EXPECTED_PREINSTALL_PACKAGE_IDENTITIES,
  FORBIDDEN_CANDIDATE_FINGERPRINTS,
  scanCandidateArchive,
  scanCandidateTree,
} from '../candidate-content-policy.mjs'

const repoRoot = path.resolve(import.meta.dirname, '../../..')

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'biyan-content-policy-'))
  t.after(() => fs.rmSync(root, { force: true, recursive: true }))
  return root
}

function writeFile(file, contents = '') {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, contents)
}

function encodeUtf16be(value) {
  const bytes = Buffer.from(value, 'utf16le')
  for (let index = 0; index < bytes.length; index += 2) {
    const byte = bytes[index]
    bytes[index] = bytes[index + 1]
    bytes[index + 1] = byte
  }
  return bytes
}

function octal(value, width) {
  return `${value.toString(8).padStart(width - 1, '0')}\0`
}

function tarMember(name, contents, type = '0') {
  const payload = Buffer.isBuffer(contents) ? contents : Buffer.from(contents)
  const header = Buffer.alloc(512)
  header.write(name, 0, 100, 'utf8')
  header.write(octal(0o644, 8), 100, 8, 'ascii')
  header.write(octal(0, 8), 108, 8, 'ascii')
  header.write(octal(0, 8), 116, 8, 'ascii')
  header.write(octal(payload.length, 12), 124, 12, 'ascii')
  header.write(octal(0, 12), 136, 12, 'ascii')
  header.fill(0x20, 148, 156)
  header.write(type, 156, 1, 'ascii')
  header.write('ustar\0', 257, 6, 'ascii')
  header.write('00', 263, 2, 'ascii')
  let checksum = 0
  for (const byte of header) checksum += byte
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii')
  const padding = Buffer.alloc((512 - (payload.length % 512)) % 512)
  return Buffer.concat([header, payload, padding])
}

function regularTarMember(name, contents) {
  if (Buffer.byteLength(name) <= 100) return tarMember(name, contents)
  return Buffer.concat([
    tarMember('././@LongLink', Buffer.from(`${name}\0`), 'L'),
    tarMember('package/.biyan-long-path', contents),
  ])
}

function writePackageArchive(
  root,
  archiveName,
  {
    files = {},
    manifest = {
      name: '@biyan/test-extension',
      private: true,
      version: '1.0.0',
    },
  } = {}
) {
  const archive = path.join(root, archiveName)
  const members = [
    regularTarMember(
      'package/package.json',
      `${JSON.stringify(manifest)}\n`
    ),
    ...Object.entries(files)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([relative, contents]) =>
        regularTarMember(`package/${relative}`, contents)
      ),
    Buffer.alloc(1024),
  ]
  fs.writeFileSync(archive, zlib.gzipSync(Buffer.concat(members)))
  return archive
}

function writeExpectedPackages(root) {
  for (const entry of EXPECTED_PREINSTALL_PACKAGE_IDENTITIES) {
    writePackageArchive(root, entry.file, {
      manifest: {
        name: entry.name,
        private: true,
        version: entry.version,
      },
    })
  }
}

function maliciousArchive(
  root,
  { name, type = '0', size = 0, linkname = '', contents = Buffer.alloc(0) }
) {
  const header = Buffer.alloc(512)
  header.write(name, 0, 100, 'utf8')
  header.write(octal(0o644, 8), 100, 8, 'ascii')
  header.write(octal(0, 8), 108, 8, 'ascii')
  header.write(octal(0, 8), 116, 8, 'ascii')
  header.write(octal(size, 12), 124, 12, 'ascii')
  header.write(octal(0, 12), 136, 12, 'ascii')
  header.fill(0x20, 148, 156)
  header.write(type, 156, 1, 'ascii')
  header.write(linkname, 157, 100, 'utf8')
  header.write('ustar\0', 257, 6, 'ascii')
  header.write('00', 263, 2, 'ascii')
  let checksum = 0
  for (const byte of header) checksum += byte
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii')
  const padding = Buffer.alloc((512 - (contents.length % 512)) % 512)
  const archive = Buffer.concat([
    header,
    contents,
    padding,
    Buffer.alloc(1024),
  ])
  const file = path.join(root, `malicious-${Math.random()}.tgz`)
  fs.writeFileSync(file, zlib.gzipSync(archive))
  return file
}

test('accepts a clean extracted candidate and private @biyan package', (t) => {
  const root = fixture(t)
  writeFile(path.join(root, 'bin', 'Biyan'), Buffer.from([0, 1, 2, 3]))
  writeExpectedPackages(root)
  writePackageArchive(root, EXPECTED_PREINSTALL_PACKAGE_IDENTITIES[0].file, {
    files: {
      'dist/index.js': 'export const product = "Biyan"\n',
      [`dist/${'long-safe-name-'.repeat(10)}.js`]: 'export {}\n',
    },
    manifest: {
      name: EXPECTED_PREINSTALL_PACKAGE_IDENTITIES[0].name,
      private: true,
      version: EXPECTED_PREINSTALL_PACKAGE_IDENTITIES[0].version,
    },
  })
  const result = scanCandidateTree(root)
  assert.equal(result.archives, 3)
  assert.ok(result.entries >= 5)
})

test('requires exactly the three declared default package archives and identities', (t) => {
  const root = fixture(t)
  writeExpectedPackages(root)
  assert.doesNotThrow(() => scanCandidateTree(root))

  fs.rmSync(path.join(root, EXPECTED_PREINSTALL_PACKAGE_IDENTITIES[0].file))
  assert.throws(
    () => scanCandidateTree(root),
    /bundled package inventory must be exactly/
  )

  writePackageArchive(root, EXPECTED_PREINSTALL_PACKAGE_IDENTITIES[0].file, {
    manifest: {
      name: '@biyan/unexpected-extension',
      private: true,
      version: EXPECTED_PREINSTALL_PACKAGE_IDENTITIES[0].version,
    },
  })
  assert.throws(
    () => scanCandidateTree(root),
    /bundled package inventory must be exactly/
  )

  writePackageArchive(root, 'biyan-extra-extension-1.0.0.tgz', {
    manifest: {
      name: '@biyan/extra-extension',
      private: true,
      version: '1.0.0',
    },
  })
  assert.throws(
    () => scanCandidateTree(root),
    /bundled package inventory must be exactly/
  )
})

test('rejects every exact fingerprint in ASCII/UTF-8, UTF-16LE, and UTF-16BE', async (t) => {
  for (const [encoding, encode] of [
    ['ASCII/UTF-8', (value) => Buffer.from(value, 'utf8')],
    ['UTF-16LE', (value) => Buffer.from(value, 'utf16le')],
    ['UTF-16BE', encodeUtf16be],
  ]) {
    await t.test(encoding, () => {
      for (const [index, fingerprint] of FORBIDDEN_CANDIDATE_FINGERPRINTS.entries()) {
        const root = fs.mkdtempSync(
          path.join(os.tmpdir(), `biyan-content-${encoding.replaceAll('/', '-')}-`)
        )
        try {
          writeFile(path.join(root, `${index}.bin`), encode(fingerprint))
          assert.throws(
            () => scanCandidateTree(root),
            new RegExp(fingerprint.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          )
        } finally {
          fs.rmSync(root, { force: true, recursive: true })
        }
      }
    })
  }
})

test('detects a fingerprint split across streaming read boundaries', (t) => {
  const root = fixture(t)
  const fingerprint = Buffer.from('Jan GPU Detection')
  writeFile(
    path.join(root, 'large.bin'),
    Buffer.concat([
      Buffer.alloc(1024 * 1024 - 4, 0x41),
      fingerprint,
      Buffer.from('tail'),
    ])
  )
  assert.throws(() => scanCandidateTree(root), /Jan GPU Detection/)
})

test('scans nested .tgz paths and contents without allowing hidden payloads', (t) => {
  const root = fixture(t)
  const inner = writePackageArchive(root, 'inner.tgz', {
    files: { 'dist/index.js': 'const name = "Jan GPU Detection"\n' },
  })
  const outer = writePackageArchive(root, 'outer.tgz', {
    files: { 'vendor/inner.tgz': fs.readFileSync(inner) },
  })
  fs.rmSync(inner)
  assert.throws(() => scanCandidateArchive(outer), /Jan GPU Detection/)

  const pathRoot = fixture(t)
  const pathArchive = writePackageArchive(pathRoot, 'path.tgz', {
    files: { 'dist/latest_jan_model.json': '{}' },
  })
  assert.throws(() => scanCandidateArchive(pathArchive), /latest_jan_model/)
})

test('locks each default package filename, name, and manifest version', (t) => {
  const root = fixture(t)
  writeExpectedPackages(root)
  const expected = EXPECTED_PREINSTALL_PACKAGE_IDENTITIES[0]
  writePackageArchive(root, expected.file, {
    manifest: {
      name: expected.name,
      private: true,
      version: '9.9.9',
    },
  })
  assert.throws(
    () => scanCandidateTree(root),
    /bundled package inventory must be exactly/
  )
})

test('requires exactly one versioned private @biyan package manifest in every .tgz', (t) => {
  const root = fixture(t)
  const wrongScope = writePackageArchive(root, 'wrong-scope.tgz', {
    manifest: { name: '@janhq/example', private: true, version: '1.0.0' },
  })
  assert.throws(() => scanCandidateArchive(wrongScope), /scoped @biyan/)

  const publicPackage = writePackageArchive(root, 'public.tgz', {
    manifest: { name: '@biyan/example', private: false, version: '1.0.0' },
  })
  assert.throws(() => scanCandidateArchive(publicPackage), /private=true/)

  const unversionedPackage = writePackageArchive(root, 'unversioned.tgz', {
    manifest: { name: '@biyan/example', private: true },
  })
  assert.throws(
    () => scanCandidateArchive(unversionedPackage),
    /must declare a semantic version/
  )
})

test('rejects absolute, traversal, link, and special tar members', async (t) => {
  const root = fixture(t)
  const cases = [
    ['absolute', { name: '/absolute', type: '0' }, /unsafe archive path/],
    ['traversal', { name: '../escape', type: '0' }, /unsafe archive path/],
    [
      'symlink',
      { name: 'package/link', type: '2', linkname: 'target' },
      /forbidden symbolic link/,
    ],
    [
      'hardlink',
      { name: 'package/link', type: '1', linkname: 'target' },
      /forbidden hard link/,
    ],
    ['fifo', { name: 'package/fifo', type: '6' }, /forbidden FIFO/],
  ]
  for (const [name, options, expected] of cases) {
    await t.test(name, () => {
      const archive = maliciousArchive(root, options)
      assert.throws(() => scanCandidateArchive(archive), expected)
    })
  }
})

test('rejects declared archive bombs before materializing their payload', (t) => {
  const root = fixture(t)
  const archive = maliciousArchive(root, {
    name: 'package/huge.bin',
    size: CANDIDATE_CONTENT_LIMITS.tarEntryBytes + 1,
  })
  assert.throws(() => scanCandidateArchive(archive), /member exceeds size limit/)
})

test(
  'rejects special filesystem entries in recursively scanned trees',
  { skip: process.platform === 'win32' },
  (t) => {
    const root = fixture(t)
    const fifo = path.join(root, 'unexpected.fifo')
    const result = spawnSync('mkfifo', [fifo])
    assert.equal(result.status, 0)
    assert.throws(() => scanCandidateTree(root), /unsupported filesystem entry/)
  }
)

test('allows contained symlinks but rejects dangling, absolute, and escaping symlinks', (t) => {
  const root = fixture(t)
  writeFile(path.join(root, 'resources', 'real.txt'), 'Biyan')
  writeExpectedPackages(root)
  fs.symlinkSync('real.txt', path.join(root, 'resources', 'alias.txt'))
  assert.doesNotThrow(() => scanCandidateTree(root))
  fs.symlinkSync('missing.txt', path.join(root, 'resources', 'dangling.txt'))
  assert.throws(() => scanCandidateTree(root), /symlink target does not exist/)
  fs.rmSync(path.join(root, 'resources', 'dangling.txt'))
  fs.symlinkSync(
    path.join(root, 'resources', 'real.txt'),
    path.join(root, 'absolute.txt')
  )
  assert.throws(() => scanCandidateTree(root), /symlink target must be relative/)
  fs.rmSync(path.join(root, 'absolute.txt'))
  fs.symlinkSync(
    '../../outside.txt',
    path.join(root, 'escaping.txt')
  )
  assert.throws(() => scanCandidateTree(root), /symlink escapes candidate root/)
})

test('protected harness scanner runs without target or harness dependencies', (t) => {
  const root = fixture(t)
  const harness = path.join(root, 'harness')
  const candidate = path.join(root, 'candidate')
  fs.mkdirSync(harness)
  writeFile(path.join(candidate, 'Biyan'), 'current product')
  writeExpectedPackages(candidate)
  fs.copyFileSync(
    path.join(repoRoot, 'scripts/ci/candidate-content-policy.mjs'),
    path.join(harness, 'candidate-content-policy.mjs')
  )
  const result = spawnSync(
    process.execPath,
    [path.join(harness, 'candidate-content-policy.mjs'), '--root', candidate],
    { cwd: root, encoding: 'utf8' }
  )
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Candidate content policy verified/)
})

test('full tests and native candidate workflows keep the content gate wired', () => {
  const makefile = fs.readFileSync(path.join(repoRoot, 'Makefile'), 'utf8')
  const contentPolicy = fs.readFileSync(
    path.join(repoRoot, 'scripts/ci/candidate-content-policy.mjs'),
    'utf8'
  )
  const windowsVerifier = fs.readFileSync(
    path.join(repoRoot, 'scripts/ci/verify-windows-candidate.ps1'),
    'utf8'
  )
  const prCi = fs.readFileSync(
    path.join(repoRoot, '.github/workflows/biyan-linter-and-test.yml'),
    'utf8'
  )
  const desktopRelease = fs.readFileSync(
    path.join(repoRoot, '.github/workflows/desktop-release.yml'),
    'utf8'
  )
  const exactQualification = fs.readFileSync(
    path.join(repoRoot, '.github/workflows/biyan-exact-sha-qualification.yml'),
    'utf8'
  )
  const macosTemplate = fs.readFileSync(
    path.join(repoRoot, '.github/workflows/template-tauri-build-macos.yml'),
    'utf8'
  )
  const windowsTemplate = fs.readFileSync(
    path.join(repoRoot, '.github/workflows/template-tauri-build-windows-x64.yml'),
    'utf8'
  )
  const linuxTemplate = fs.readFileSync(
    path.join(repoRoot, '.github/workflows/template-tauri-build-linux-x64.yml'),
    'utf8'
  )

  assert.match(
    makefile,
    /node --test \.\/scripts\/ci\/__tests__\/candidate-content-policy\.test\.mjs/
  )
  assert.doesNotMatch(contentPolicy, /from ['"]tar['"]/)
  assert.match(windowsVerifier, /candidate-path-policy\.mjs'/)
  assert.match(windowsVerifier, /candidate-content-policy\.mjs'/)
  assert.match(windowsVerifier, /"biyan-msi-admin-\{0\}"/)
  assert.match(
    windowsVerifier,
    /Get-Command msiexec\.exe[\s\S]*'\/a'[\s\S]*TARGETDIR=`"\$msiExtractRoot`"/
  )
  assert.match(
    windowsVerifier,
    /Start-Process[\s\S]*-Wait[\s\S]*-PassThru[\s\S]*\$msiProcess\.ExitCode/
  )
  assert.doesNotMatch(windowsVerifier, /(^|\n)\s*&\s+\$msiExec\b/)
  assert.doesNotMatch(
    windowsVerifier,
    /\$msiExitCode\s*=\s*\$LASTEXITCODE/
  )
  assert.doesNotMatch(windowsVerifier, /& \$sevenZip[^\n]*\$msiPath/)
  assert.equal(
    windowsVerifier.match(/Invoke-ExtractedCandidatePolicies -Root/g)?.length,
    2
  )
  assert.equal(
    windowsVerifier.match(/Test-ExtractedBiyanApp `/g)?.length,
    2
  )
  assert.match(desktopRelease, /verify-windows-candidate\.ps1/)
  assert.match(
    prCi,
    /Build focused unsigned Windows candidate[\s\S]*needs\.ci-scope\.outputs\.build_windows == 'true'[\s\S]*make build/
  )
  assert.match(
    prCi,
    /Verify focused unsigned Windows candidate[\s\S]*verify-windows-candidate\.ps1[\s\S]*candidate-path-policy\.mjs --root \$bundle/
  )
  assert.match(
    desktopRelease,
    /candidate-content-policy\.mjs \\\s*\n\s*--root "\$extract_root\/squashfs-root"/
  )
  assert.match(desktopRelease, /dpkg-deb --extract "\$deb" "\$deb_root"/)
  assert.match(
    desktopRelease,
    /candidate-content-policy\.mjs \\\s*\n\s*--root "\$deb_root"/
  )
  assert.match(
    desktopRelease,
    /candidate-path-policy\.mjs \\\s*\n\s*--root "\$extract_root\/squashfs-root"/
  )
  assert.match(
    desktopRelease,
    /candidate-path-policy\.mjs \\\s*\n\s*--root "\$deb_root"/
  )
  assert.match(
    exactQualification,
    /harness\/scripts\/ci\/candidate-content-policy\.mjs \\\s*\n\s*--root "\$extract_root\/squashfs-root"/
  )
  assert.match(exactQualification, /dpkg-deb --extract "\$deb" "\$deb_root"/)
  assert.match(
    exactQualification,
    /harness\/scripts\/ci\/candidate-content-policy\.mjs \\\s*\n\s*--root "\$deb_root"/
  )
  assert.match(
    exactQualification,
    /jlumbroso\/free-disk-space@54081f138730dfa15788a46383842cd2f914a1be/
  )
  assert.match(
    exactQualification,
    /minimum_kib=\$\(\(40 \* 1024 \* 1024\)\)/
  )
  assert.match(
    exactQualification,
    /harness\/scripts\/ci\/candidate-path-policy\.mjs \\\s*\n\s*--root "\$extract_root\/squashfs-root"/
  )
  assert.match(
    exactQualification,
    /harness\/scripts\/ci\/candidate-path-policy\.mjs \\\s*\n\s*--root "\$deb_root"/
  )
  assert.doesNotMatch(desktopRelease, /--runtime-only/)
  assert.doesNotMatch(exactQualification, /--runtime-only/)
  assert.match(
    macosTemplate,
    /candidate-content-policy\.mjs --root "\$\{apps\[0\]\}"/
  )
  assert.match(windowsTemplate, /verify-windows-candidate\.ps1/)
  assert.match(linuxTemplate, /dpkg-deb --extract "\$deb" "\$deb_root"/)
  assert.match(
    linuxTemplate,
    /candidate-content-policy\.mjs --root "\$root"/
  )
})
