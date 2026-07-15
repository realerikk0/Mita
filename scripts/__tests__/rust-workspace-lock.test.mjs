import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const repoRoot = path.resolve(import.meta.dirname, '../..')
const workspaceRoot = path.join(repoRoot, 'src-tauri')
const makefile = fs.readFileSync(path.join(repoRoot, 'Makefile'), 'utf8')
const testResourceScript = fs.readFileSync(
  path.join(repoRoot, 'scripts/prepare-tauri-test-resources.sh'),
  'utf8'
)
const manifestPaths = [
  'src-tauri/Cargo.toml',
  'src-tauri/plugins/tauri-plugin-hardware/Cargo.toml',
  'src-tauri/plugins/tauri-plugin-document-parser/Cargo.toml',
  'src-tauri/utils/Cargo.toml',
]

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
        path.join(repoRoot, manifestPath),
      ],
      { encoding: 'utf8' }
    )
  )
}

test('root and standalone Rust test manifests share the root workspace lock', () => {
  const expectedManifests = new Set(
    manifestPaths.map((manifestPath) =>
      fs.realpathSync(path.join(repoRoot, manifestPath))
    )
  )

  for (const manifestPath of manifestPaths) {
    const metadata = cargoMetadata(manifestPath)
    assert.equal(
      fs.realpathSync(metadata.workspace_root),
      fs.realpathSync(workspaceRoot)
    )
    assert.deepEqual(
      new Set(
        metadata.packages.map((pkg) => fs.realpathSync(pkg.manifest_path))
      ),
      expectedManifests
    )
  }

  assert.ok(fs.existsSync(path.join(workspaceRoot, 'Cargo.lock')))
  for (const nestedLock of [
    'src-tauri/plugins/tauri-plugin-hardware/Cargo.lock',
    'src-tauri/plugins/tauri-plugin-document-parser/Cargo.lock',
    'src-tauri/utils/Cargo.lock',
  ]) {
    assert.equal(
      fs.existsSync(path.join(repoRoot, nestedLock)),
      false,
      nestedLock
    )
  }
})

test('every Rust test command is locked and the workspace lock test is gated', () => {
  for (const manifestPath of manifestPaths) {
    const command = makefile
      .split('\n')
      .find(
        (line) =>
          line.includes('cargo test') &&
          line.includes(`--manifest-path ${manifestPath}`)
      )
    assert.ok(command, `missing cargo test command for ${manifestPath}`)
    assert.match(command, /\bcargo test\s+--locked\b/)
  }
  assert.match(
    makefile,
    /node --test \.\/scripts\/__tests__\/rust-workspace-lock\.test\.mjs/
  )
})

test('clean Rust test resources include both legal files', () => {
  assert.match(testResourceScript, /ensure_file "\$RESOURCE_DIR\/LICENSE"/)
  assert.match(testResourceScript, /ensure_file "\$RESOURCE_DIR\/NOTICE"/)
})
