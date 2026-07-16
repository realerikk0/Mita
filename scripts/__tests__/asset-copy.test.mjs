import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const repoRoot = path.resolve(import.meta.dirname, '../..')
const packageJson = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')
)
const makefile = fs.readFileSync(path.join(repoRoot, 'Makefile'), 'utf8')
const extensionInstaller = fs.readFileSync(
  path.join(repoRoot, 'scripts', 'install-extensions.mjs'),
  'utf8'
)
const desktopReleaseWorkflow = fs.readFileSync(
  path.join(repoRoot, '.github/workflows/desktop-release.yml'),
  'utf8'
)

for (const scriptName of ['copy:assets:tauri', 'copy:assets:mobile']) {
  test(`${scriptName} replaces extension archives and copies both legal files`, (t) => {
    const fixtureRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'biyan-asset-copy-')
    )
    t.after(() => fs.rmSync(fixtureRoot, { force: true, recursive: true }))

    fs.mkdirSync(path.join(fixtureRoot, 'pre-install'), { recursive: true })
    fs.writeFileSync(
      path.join(fixtureRoot, 'pre-install', 'extension.tgz'),
      'extension'
    )
    fs.writeFileSync(path.join(fixtureRoot, 'LICENSE'), 'license')
    fs.writeFileSync(path.join(fixtureRoot, 'NOTICE'), 'notice')
    const stalePreinstall = path.join(
      fixtureRoot,
      'src-tauri',
      'resources',
      'pre-install'
    )
    fs.mkdirSync(stalePreinstall, { recursive: true })
    fs.writeFileSync(path.join(stalePreinstall, '.gitkeep'), '')
    fs.writeFileSync(path.join(stalePreinstall, 'stale.tgz'), 'stale')

    execSync(packageJson.scripts[scriptName], {
      cwd: fixtureRoot,
      env: {
        ...process.env,
        PATH: `${path.join(repoRoot, 'node_modules', '.bin')}${path.delimiter}${process.env.PATH ?? ''}`,
      },
      stdio: 'pipe',
    })

    assert.equal(
      fs.readFileSync(
        path.join(
          fixtureRoot,
          'src-tauri',
          'resources',
          'pre-install',
          'extension.tgz'
        ),
        'utf8'
      ),
      'extension'
    )
    assert.deepEqual(fs.readdirSync(stalePreinstall), ['extension.tgz'])
    assert.equal(
      fs.readFileSync(
        path.join(fixtureRoot, 'src-tauri', 'resources', 'LICENSE'),
        'utf8'
      ),
      'license'
    )
    assert.equal(
      fs.readFileSync(
        path.join(fixtureRoot, 'src-tauri', 'resources', 'NOTICE'),
        'utf8'
      ),
      'notice'
    )
  })
}

test('asset copy regression test runs from Makefile test target', () => {
  assert.match(
    makefile,
    /node --test \.\/scripts\/__tests__\/asset-copy\.test\.mjs/
  )
})

test('extension builds pack a clean current core and preserve immutable dependency installation', () => {
  assert.match(
    packageJson.scripts['build:core'],
    /yarn prebuild && yarn build && yarn pack/
  )
  assert.match(packageJson.scripts['build:extensions'], /yarn build:core/)
  assert.match(
    packageJson.scripts['build:extensions'],
    /yarn install:extensions/
  )
  assert.equal(
    packageJson.scripts['install:extensions'],
    'node ./scripts/install-extensions.mjs'
  )
  assert.equal(packageJson.devDependencies['cross-spawn'], '^7.0.6')
  assert.match(extensionInstaller, /\['install', '--mode=update-lockfile'\]/)
  assert.match(extensionInstaller, /\['install', '--immutable'\]/)
  assert.match(extensionInstaller, /validateCoreLockTransition/)
  assert.match(extensionInstaller, /finally\s*{\s*restoreLock\(\)/)
  assert.match(
    packageJson.scripts['build:tauri:plugin:api'],
    /cd src-tauri\/plugins && yarn install --immutable/
  )
  assert.match(makefile, /install-and-build:[\s\S]*?yarn install --immutable/)
  assert.match(
    desktopReleaseWorkflow,
    /YARN_ENABLE_IMMUTABLE_INSTALLS:\s*"true"/
  )
  assert.doesNotMatch(
    desktopReleaseWorkflow,
    /(?:YARN_ENABLE_IMMUTABLE_INSTALLS|enableImmutableInstalls)[^\n]*false/
  )
})

test('clean removes generated Tauri resources without deleting tracked resources', () => {
  assert.match(makefile, /git clean -fdX -- src-tauri\/resources/)
  assert.match(makefile, /git clean -fdx -- .*node_modules/)
  assert.doesNotMatch(
    makefile,
    /Remove-Item -Recurse -Force \.\/src-tauri\/resources/
  )
  assert.doesNotMatch(makefile, /rm -rfv? \.\/src-tauri\/resources/)
})
