import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const repoRoot = path.resolve(import.meta.dirname, '../..')
const releaseVersionScript = path.join(
  repoRoot,
  'scripts',
  'release-version.mjs'
)
const makefile = fs.readFileSync(path.join(repoRoot, 'Makefile'), 'utf8')
const rustPluginManifests = [
  'src-tauri/plugins/tauri-plugin-hardware/Cargo.toml',
  'src-tauri/plugins/tauri-plugin-document-parser/Cargo.toml',
]

function writeFixture(root, relative, value) {
  const target = path.join(root, relative)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(
    target,
    typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`
  )
}

function cargoMetadata(manifestPath) {
  return JSON.parse(
    execFileSync(
      process.env.CARGO ?? 'cargo',
      [
        'metadata',
        '--locked',
        '--no-deps',
        '--format-version',
        '1',
        '--manifest-path',
        manifestPath,
      ],
      { encoding: 'utf8' }
    )
  )
}

test('release stamp updates product and JS versions without changing Rust plugin crates', (t) => {
  const fixtureRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'biyan-release-stamp-')
  )
  t.after(() => fs.rmSync(fixtureRoot, { force: true, recursive: true }))

  writeFixture(fixtureRoot, 'src-tauri/tauri.conf.json', {
    productName: 'Biyan',
    version: '0.6.636',
    bundle: {},
  })
  writeFixture(
    fixtureRoot,
    'src-tauri/Cargo.toml',
    `[package]
name = "Biyan"
version = "0.6.636"
edition = "2021"

[workspace]
members = [
  ".",
  "plugins/tauri-plugin-hardware",
  "plugins/tauri-plugin-document-parser",
]
resolver = "2"
`
  )
  writeFixture(
    fixtureRoot,
    rustPluginManifests[0],
    `[package]\nname = "tauri-plugin-hardware"\nversion = "0.6.599"\nedition = "2021"\n`
  )
  writeFixture(
    fixtureRoot,
    rustPluginManifests[1],
    `[package]\nname = "tauri-plugin-document-parser"\nversion = "0.1.0"\nedition = "2021"\n`
  )
  for (const relative of [
    'src-tauri/src/lib.rs',
    'src-tauri/plugins/tauri-plugin-hardware/src/lib.rs',
    'src-tauri/plugins/tauri-plugin-document-parser/src/lib.rs',
  ]) {
    writeFixture(fixtureRoot, relative, '')
  }
  writeFixture(fixtureRoot, 'web-app/package.json', {
    name: '@biyan/web-app',
    version: '0.0.0',
  })
  writeFixture(
    fixtureRoot,
    'src-tauri/plugins/tauri-plugin-hardware/package.json',
    {
      name: '@biyan/tauri-plugin-hardware',
      version: '0.6.6',
    }
  )
  writeFixture(
    fixtureRoot,
    'src-tauri/plugins/tauri-plugin-document-parser/package.json',
    {
      name: '@biyan/tauri-plugin-document-parser',
      version: '0.1.0',
    }
  )

  const fixtureManifest = path.join(fixtureRoot, 'src-tauri', 'Cargo.toml')
  execFileSync(process.env.CARGO ?? 'cargo', [
    'generate-lockfile',
    '--offline',
    '--manifest-path',
    fixtureManifest,
  ])
  const pluginCargoBefore = rustPluginManifests.map((relative) =>
    fs.readFileSync(path.join(fixtureRoot, relative), 'utf8')
  )

  execFileSync(process.execPath, [releaseVersionScript, 'stamp', '0.6.637'], {
    cwd: fixtureRoot,
    stdio: 'pipe',
  })

  const tauriConfig = JSON.parse(
    fs.readFileSync(
      path.join(fixtureRoot, 'src-tauri', 'tauri.conf.json'),
      'utf8'
    )
  )
  assert.equal(tauriConfig.version, '0.6.637')
  assert.equal(tauriConfig.bundle.createUpdaterArtifacts, true)
  assert.match(
    fs.readFileSync(fixtureManifest, 'utf8'),
    /^version = "0\.6\.637"$/m
  )
  assert.match(
    fs.readFileSync(path.join(fixtureRoot, 'src-tauri', 'Cargo.lock'), 'utf8'),
    /name = "Biyan"\nversion = "0\.6\.637"/
  )

  for (const relative of [
    'web-app/package.json',
    'src-tauri/plugins/tauri-plugin-hardware/package.json',
    'src-tauri/plugins/tauri-plugin-document-parser/package.json',
  ]) {
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(fixtureRoot, relative), 'utf8'))
        .version,
      '0.6.637'
    )
  }
  for (const [index, relative] of rustPluginManifests.entries()) {
    assert.equal(
      fs.readFileSync(path.join(fixtureRoot, relative), 'utf8'),
      pluginCargoBefore[index]
    )
  }

  const versions = Object.fromEntries(
    cargoMetadata(fixtureManifest).packages.map(({ name, version }) => [
      name,
      version,
    ])
  )
  assert.deepEqual(versions, {
    'Biyan': '0.6.637',
    'tauri-plugin-document-parser': '0.1.0',
    'tauri-plugin-hardware': '0.6.599',
  })
})

test('release stamp source never targets Rust plugin manifests', () => {
  const source = fs.readFileSync(releaseVersionScript, 'utf8')
  for (const manifest of rustPluginManifests) {
    assert.equal(source.includes(manifest), false, manifest)
  }
})

test('the real Rust workspace remains locked and the regression runs in make test', () => {
  const metadata = cargoMetadata(path.join(repoRoot, 'src-tauri', 'Cargo.toml'))
  assert.equal(
    path.resolve(metadata.workspace_root),
    path.join(repoRoot, 'src-tauri')
  )
  assert.match(
    makefile,
    /node --test \.\/scripts\/__tests__\/release-version-stamp\.test\.mjs/
  )
})
