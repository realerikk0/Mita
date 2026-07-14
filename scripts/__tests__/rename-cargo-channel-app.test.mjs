import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import test from 'node:test'

const scriptPath = path.resolve('.github/scripts/rename-cargo-channel-app.mjs')
const makefile = fs.readFileSync('Makefile', 'utf8')
const workflowPaths = [
  '.github/workflows/template-tauri-build-macos.yml',
  '.github/workflows/template-tauri-build-macos-external.yml',
  '.github/workflows/template-tauri-build-windows-x64.yml',
  '.github/workflows/template-tauri-build-windows-x64-external.yml',
  '.github/workflows/template-tauri-build-linux-x64.yml',
  '.github/workflows/template-tauri-build-linux-x64-external.yml',
  '.github/workflows/template-tauri-build-linux-x64-flatpak.yml',
]

test('renames Cargo package default-run and only the main desktop bin for channel builds', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rename-cargo-channel-app-'))
  const cargoTomlPath = path.join(tempDir, 'Cargo.toml')

  fs.writeFileSync(
    cargoTomlPath,
    `[package]
name = "Biyan"
version = "0.6.631"
default-run = "Biyan"
autobins = false

[[bin]]
name = "Biyan"
path = "src/main.rs"

[[bin]]
name = "biyan-cli"
path = "src/bin/biyan-cli.rs"
`,
  )

  execFileSync(process.execPath, [scriptPath, cargoTomlPath, 'nightly'])

  const updated = fs.readFileSync(cargoTomlPath, 'utf8')
  assert.match(updated, /\[package\]\nname = "Biyan-nightly"/)
  assert.match(updated, /default-run = "Biyan-nightly"/)
  assert.match(updated, /\[\[bin\]\]\nname = "Biyan-nightly"\npath = "src\/main\.rs"/)
  assert.match(updated, /\[\[bin\]\]\nname = "biyan-cli"/)
})

test('channel build templates use the Cargo channel rename helper', () => {
  for (const workflowPath of workflowPaths) {
    const workflow = fs.readFileSync(workflowPath, 'utf8')
    assert.match(
      workflow,
      /node \.github\/scripts\/rename-cargo-channel-app\.mjs \.\/src-tauri\/Cargo\.toml "\$\{\{ inputs\.channel \}\}"/,
      `${workflowPath} should call rename-cargo-channel-app.mjs`,
    )
    assert.doesNotMatch(
      workflow,
      /ctoml \.\/src-tauri\/Cargo\.toml package\.default-run "Biyan-\$\{\{ inputs\.channel \}\}"/,
      `${workflowPath} should not leave default-run pointing at an absent bin`,
    )
  }
})

test('Cargo channel rename helper test runs from Makefile test target', () => {
  assert.match(
    makefile,
    /node --test \.\/scripts\/__tests__\/rename-cargo-channel-app\.test\.mjs/,
  )
})
