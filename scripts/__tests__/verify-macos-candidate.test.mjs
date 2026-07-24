import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import tar from 'tar'

import { EXPECTED_PREINSTALL_PACKAGE_IDENTITIES } from '../ci/candidate-content-policy.mjs'
import {
  EXPECTED_PREINSTALL_PACKAGES,
  parseMacOSCandidateArgs,
  verifyMacOSCandidate,
} from '../verify-macos-candidate.mjs'

const repoRoot = path.resolve(import.meta.dirname, '../..')
const packageJson = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')
)
const makefile = fs.readFileSync(path.join(repoRoot, 'Makefile'), 'utf8')
const version = '0.6.636'

function writeFile(file, content = '') {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

function writeMachO(file) {
  writeFile(file, Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0, 0, 0, 0]))
}

function writePackageArchive(root, archive, packageName, packageVersion) {
  const archiveVersion = path
    .basename(archive)
    .match(/-(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\.tgz$/u)?.[1]
  assert.equal(archiveVersion, packageVersion)
  const source = path.join(root, `pack-${packageName.split('/').at(-1)}`)
  writeFile(
    path.join(source, 'package', 'package.json'),
    JSON.stringify({
      name: packageName,
      private: true,
      version: packageVersion,
    })
  )
  writeFile(path.join(source, 'package', 'dist', 'index.js'), 'export {}\n')
  fs.mkdirSync(path.dirname(archive), { recursive: true })
  tar.c(
    {
      cwd: source,
      file: archive,
      gzip: true,
      portable: true,
      sync: true,
    },
    ['package']
  )
}

function createFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'biyan-macos-candidate-'))
  t.after(() => fs.rmSync(root, { force: true, recursive: true }))

  const sourceRoot = path.join(root, 'repo')
  const appPath = path.join(root, 'Biyan.app')
  const dmgPath = path.join(root, `Biyan_${version}_universal.dmg`)
  const resources = path.join(appPath, 'Contents', 'Resources', 'resources')
  writeFile(path.join(sourceRoot, 'LICENSE'), Buffer.from('license\0bytes'))
  writeFile(path.join(sourceRoot, 'NOTICE'), Buffer.from('notice\nbytes'))
  writeFile(path.join(resources, 'LICENSE'), Buffer.from('license\0bytes'))
  writeFile(path.join(resources, 'NOTICE'), Buffer.from('notice\nbytes'))
  for (const {
    file: archive,
    name: packageName,
    version: packageVersion,
  } of EXPECTED_PREINSTALL_PACKAGE_IDENTITIES) {
    writePackageArchive(
      root,
      path.join(resources, 'pre-install', archive),
      packageName,
      packageVersion
    )
  }
  writeFile(path.join(appPath, 'Contents', 'Info.plist'), 'fixture plist')
  writeMachO(path.join(appPath, 'Contents', 'MacOS', 'Biyan'))
  writeMachO(path.join(resources, 'native', 'addon.node'))
  writeMachO(
    path.join(
      resources,
      'ms-playwright',
      'chromium_headless_shell-1217',
      'chrome-headless-shell-mac-arm64',
      'chrome-headless-shell'
    )
  )
  writeMachO(
    path.join(
      resources,
      'ms-playwright',
      'chromium_headless_shell-1217',
      'chrome-headless-shell-mac-x64',
      'chrome-headless-shell'
    )
  )
  writeMachO(path.join(resources, 'ms-playwright', 'ffmpeg-1011', 'ffmpeg-mac'))
  writeFile(
    path.join(resources, 'opaque.bin'),
    Buffer.from('Mita and llamacpp-extension strings are not path payloads')
  )
  writeFile(path.join(resources, 'drag-helper.js'), 'export default true')
  writeFile(dmgPath, 'fixture dmg')

  return { appPath, dmgPath, resources, sourceRoot }
}

function createRunner(appPath, overrides = {}) {
  const calls = []
  const plist = {
    CFBundleDisplayName: 'Biyan',
    CFBundleExecutable: 'Biyan',
    CFBundleIdentifier: 'uk.jingxing.mita',
    CFBundleName: 'Biyan',
    CFBundleShortVersionString: version,
    CFBundleVersion: version,
    LSMinimumSystemVersion: '12.0',
    CFBundleURLTypes: [
      {
        CFBundleURLName: 'uk.jingxing.mita',
        CFBundleURLSchemes: ['biyan', 'mita'],
      },
    ],
    ...overrides.plist,
  }
  const runCommand = (command, args) => {
    calls.push([command, args])
    if (command === 'hdiutil' && args[0] === 'attach') {
      const mountPoint = args[args.indexOf('-mountpoint') + 1]
      const mountedApp = path.join(mountPoint, 'Biyan.app')
      fs.cpSync(appPath, mountedApp, { recursive: true })
      overrides.mutateMountedApp?.(mountedApp)
      return ''
    }
    if (command === 'plutil') return JSON.stringify(plist)
    if (command === 'lipo') {
      const relative = path.relative(appPath, args.at(-1))
      if (overrides.architectures?.[relative]) {
        return overrides.architectures[relative].join(' ')
      }
      if (relative.includes('chrome-headless-shell-mac-arm64')) return 'arm64'
      if (relative.includes('chrome-headless-shell-mac-x64')) return 'x86_64'
      return 'x86_64 arm64'
    }
    if (command === 'codesign' && args.includes('--display')) {
      return [
        'Authority=Developer ID Application: LILYN DYNAMICS (7NZP53ZJ4D)',
        'TeamIdentifier=7NZP53ZJ4D',
      ].join('\n')
    }
    return ''
  }
  return { calls, runCommand }
}

function verifyFixture(fixture, runner) {
  return verifyMacOSCandidate(
    {
      appPath: fixture.appPath,
      dmgPath: fixture.dmgPath,
      repoRoot: fixture.sourceRoot,
      version,
    },
    { runCommand: runner.runCommand }
  )
}

test('verifies a signed universal app and DMG using injectable macOS commands', (t) => {
  const fixture = createFixture(t)
  const runner = createRunner(fixture.appPath)
  const result = verifyFixture(fixture, runner)

  assert.equal(result.machOCount, 5)
  assert.deepEqual(result.preinstallPackages, EXPECTED_PREINSTALL_PACKAGES)
  assert.ok(
    runner.calls.some(
      ([command, args]) =>
        command === 'codesign' &&
        args.join(' ') ===
          `--verify --deep --strict --verbose=2 ${fixture.appPath}`
    )
  )
  assert.ok(
    runner.calls.some(
      ([command, args]) =>
        command === 'codesign' &&
        args.join(' ') === `--display --verbose=4 ${fixture.appPath}`
    )
  )
  assert.ok(
    runner.calls.some(
      ([command, args]) =>
        command === 'hdiutil' && args.join(' ') === `verify ${fixture.dmgPath}`
    )
  )
  assert.ok(
    runner.calls.some(
      ([command, args]) =>
        command === 'hdiutil' &&
        args[0] === 'attach' &&
        args.at(-1) === fixture.dmgPath
    )
  )
  assert.ok(
    runner.calls.some(
      ([command, args]) => command === 'hdiutil' && args[0] === 'detach'
    )
  )
})

test('rejects a DMG whose Biyan.app differs from the accepted app', (t) => {
  const fixture = createFixture(t)
  const runner = createRunner(fixture.appPath, {
    mutateMountedApp(mountedApp) {
      fs.appendFileSync(
        path.join(mountedApp, 'Contents', 'Resources', 'resources', 'NOTICE'),
        'tampered'
      )
    },
  })
  assert.throws(() => verifyFixture(fixture, runner), /DMG Biyan\.app differs/)
})

test('rejects legal-file drift and unexpected pre-install packages', (t) => {
  const legalFixture = createFixture(t)
  fs.appendFileSync(path.join(legalFixture.resources, 'NOTICE'), 'drift')
  assert.throws(
    () => verifyFixture(legalFixture, createRunner(legalFixture.appPath)),
    /NOTICE does not byte-match/
  )

  const packageFixture = createFixture(t)
  writeFile(
    path.join(packageFixture.resources, 'pre-install', 'unexpected.tgz'),
    'unexpected'
  )
  assert.throws(
    () => verifyFixture(packageFixture, createRunner(packageFixture.appPath)),
    /pre-install packages differ/
  )
})

test('rejects retired payload paths without scanning arbitrary binary contents', (t) => {
  const runtimeFixture = createFixture(t)
  writeFile(
    path.join(runtimeFixture.resources, 'native', 'llamacpp-extension.dylib'),
    'not a Mach-O'
  )
  assert.throws(
    () => verifyFixture(runtimeFixture, createRunner(runtimeFixture.appPath)),
    /Retired local runtime/
  )

  const productFixture = createFixture(t)
  writeFile(path.join(productFixture.resources, 'Mita-helper.js'), 'retired')
  assert.throws(
    () => verifyFixture(productFixture, createRunner(productFixture.appPath)),
    /Retired product name/
  )
})

test('rejects wrong Info.plist identity and thin unknown Mach-O files', (t) => {
  const identityFixture = createFixture(t)
  assert.throws(
    () =>
      verifyFixture(
        identityFixture,
        createRunner(identityFixture.appPath, {
          plist: { CFBundleIdentifier: 'com.example.wrong' },
        })
      ),
    /CFBundleIdentifier/
  )

  const architectureFixture = createFixture(t)
  const mainExecutable = path.join('Contents', 'MacOS', 'Biyan')
  assert.throws(
    () =>
      verifyFixture(
        architectureFixture,
        createRunner(architectureFixture.appPath, {
          architectures: { [mainExecutable]: ['arm64'] },
        })
      ),
    /expected \[arm64, x86_64\]/
  )
})

test('rejects Info.plist URL scheme additions, removals, and reorderings', (t) => {
  for (const schemes of [
    ['biyan'],
    ['biyan', 'mita', 'jan'],
    ['mita', 'biyan'],
  ]) {
    const fixture = createFixture(t)
    assert.throws(
      () =>
        verifyFixture(
          fixture,
          createRunner(fixture.appPath, {
            plist: {
              CFBundleURLTypes: [{ CFBundleURLSchemes: schemes }],
            },
          })
        ),
      /URL schemes/
    )
  }

  const extraTypeFixture = createFixture(t)
  assert.throws(
    () =>
      verifyFixture(
        extraTypeFixture,
        createRunner(extraTypeFixture.appPath, {
          plist: {
            CFBundleURLTypes: [
              { CFBundleURLSchemes: ['biyan', 'mita'] },
              { CFBundleURLSchemes: [] },
            ],
          },
        })
      ),
    /URL schemes/
  )
})

test('rejects forbidden fingerprints in app files and nested pre-install packages', (t) => {
  const fileFixture = createFixture(t)
  writeFile(
    path.join(fileFixture.resources, 'unexpected.txt'),
    'Jan GPU Detection'
  )
  assert.throws(
    () => verifyFixture(fileFixture, createRunner(fileFixture.appPath)),
    /Jan GPU Detection/
  )

  const packageFixture = createFixture(t)
  const archive = path.join(
    packageFixture.resources,
    'pre-install',
    EXPECTED_PREINSTALL_PACKAGES[0]
  )
  writePackageArchive(
    packageFixture.sourceRoot,
    archive,
    EXPECTED_PREINSTALL_PACKAGE_IDENTITIES[0].name,
    EXPECTED_PREINSTALL_PACKAGE_IDENTITIES[0].version
  )
  const source = path.join(
    packageFixture.sourceRoot,
    'pack-assistant-extension',
    'package',
    'dist',
    'index.js'
  )
  writeFile(source, 'const catalog = "latest_jan_model.json"\n')
  tar.c(
    {
      cwd: path.join(packageFixture.sourceRoot, 'pack-assistant-extension'),
      file: archive,
      gzip: true,
      portable: true,
      sync: true,
    },
    ['package']
  )
  assert.throws(
    () => verifyFixture(packageFixture, createRunner(packageFixture.appPath)),
    /latest_jan_model/
  )
})

test('rejects an app signed by the wrong Developer ID team', (t) => {
  const fixture = createFixture(t)
  const runner = createRunner(fixture.appPath)
  const originalRunCommand = runner.runCommand
  runner.runCommand = (command, args) => {
    const result = originalRunCommand(command, args)
    if (command === 'codesign' && args.includes('--display')) {
      return 'Authority=Apple Development: Example\nTeamIdentifier=WRONGTEAM'
    }
    return result
  }

  assert.throws(
    () => verifyFixture(fixture, runner),
    /not signed by Developer ID/
  )
})

test('accepts explicit ad-hoc qualification signatures without weakening production', (t) => {
  const fixture = createFixture(t)
  const runner = createRunner(fixture.appPath)
  const originalRunCommand = runner.runCommand
  runner.runCommand = (command, args) => {
    const result = originalRunCommand(command, args)
    if (command === 'codesign' && args.includes('--display')) {
      return 'Signature=adhoc\nTeamIdentifier=not set'
    }
    return result
  }

  assert.doesNotThrow(() =>
    verifyMacOSCandidate(
      {
        appPath: fixture.appPath,
        dmgPath: fixture.dmgPath,
        repoRoot: fixture.sourceRoot,
        version,
        signatureMode: 'ad-hoc',
      },
      { runCommand: runner.runCommand }
    )
  )
  assert.throws(
    () => verifyFixture(fixture, runner),
    /not signed by Developer ID/
  )
})

test('CLI arguments and build wiring require explicit candidate paths', () => {
  assert.deepEqual(
    parseMacOSCandidateArgs([
      '--app',
      '/tmp/Biyan.app',
      '--dmg',
      `/tmp/Biyan_${version}_universal.dmg`,
      '--version',
      version,
      '--signature',
      'ad-hoc',
    ]),
    {
      app: '/tmp/Biyan.app',
      dmg: `/tmp/Biyan_${version}_universal.dmg`,
      version,
      signature: 'ad-hoc',
    }
  )
  assert.throws(
    () =>
      parseMacOSCandidateArgs([
        '--app',
        '/tmp/Biyan.app',
        '--dmg',
        `/tmp/Biyan_${version}_universal.dmg`,
        '--version',
        version,
        '--signature',
        'unknown',
      ]),
    /Unsupported signature mode/
  )
  assert.throws(
    () => parseMacOSCandidateArgs(['--app', '/tmp/Biyan.app']),
    /Missing required argument/
  )
  assert.equal(
    packageJson.scripts['verify:macos-candidate'],
    'node ./scripts/verify-macos-candidate.mjs'
  )
  assert.match(
    makefile,
    /node --test \.\/scripts\/__tests__\/verify-macos-candidate\.test\.mjs/
  )
  assert.match(
    makefile,
    /verify-macos-candidate:[\s\S]*?yarn verify:macos-candidate --app "\$\(APP\)" --dmg "\$\(DMG\)" --version "\$\(VERSION\)"/
  )
  const makeTestBody = makefile.match(
    /^test:[\s\S]*?(?=^# Build Biyan CLI)/m
  )?.[0]
  assert.doesNotMatch(makeTestBody, /yarn verify:macos-candidate/)
})
