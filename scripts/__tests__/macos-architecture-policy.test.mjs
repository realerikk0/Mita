import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  assertMacOSArchitectures,
  expectedMacOSArchitectures,
  isMachOFile,
} from '../macos-architecture-policy.mjs'

const cases = [
  ['bin/bun', ['arm64', 'x86_64']],
  ['bin/bun-universal-apple-darwin', ['arm64', 'x86_64']],
  ['bin/bun-aarch64-apple-darwin', ['arm64']],
  ['bin/bun-x86_64-apple-darwin', ['x86_64']],
  ['bin/uv', ['arm64', 'x86_64']],
  ['bin/biyan-cli', ['arm64', 'x86_64']],
  ['computer-agent-runner/biyan-computer-agent-runner', ['arm64', 'x86_64']],
  [
    'ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-mac-arm64/chrome-headless-shell',
    ['arm64'],
  ],
  [
    'ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-mac-x64/chrome-headless-shell',
    ['x86_64'],
  ],
  ['ms-playwright/ffmpeg-1011/ffmpeg-mac', ['arm64', 'x86_64']],
  ['native/new-addon.node', ['arm64', 'x86_64']],
]

test('macOS runtime architecture policy classifies universal and thin binaries', () => {
  for (const [filePath, expected] of cases) {
    assert.deepEqual(expectedMacOSArchitectures(filePath), expected, filePath)
    assert.doesNotThrow(() =>
      assertMacOSArchitectures(filePath, [...expected].reverse())
    )
  }
})

test('macOS runtime architecture policy rejects mislabeled binaries', () => {
  assert.throws(
    () => assertMacOSArchitectures('bin/bun-universal-apple-darwin', ['arm64']),
    /expected \[arm64, x86_64\]/
  )
  assert.throws(
    () =>
      assertMacOSArchitectures(
        'ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-mac-x64/chrome-headless-shell',
        ['arm64']
      ),
    /expected \[x86_64\]/
  )
})

test('macOS runtime architecture policy defaults unknown Mach-O paths to universal', () => {
  assert.deepEqual(expectedMacOSArchitectures('native/new-helper'), [
    'arm64',
    'x86_64',
  ])
  assert.throws(
    () => assertMacOSArchitectures('native/new-helper', ['arm64']),
    /expected \[arm64, x86_64\]/
  )
})

test('Mach-O detection includes unknown native files without executable bits', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'biyan-mach-o-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const nativeFile = path.join(directory, 'unknown-native-payload.so')
  const textFile = path.join(directory, 'plain-text')

  fs.writeFileSync(nativeFile, Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0, 0]))
  fs.chmodSync(nativeFile, 0o644)
  fs.writeFileSync(textFile, 'not native')

  assert.equal(isMachOFile(nativeFile), true)
  assert.equal(isMachOFile(textFile), false)
})

test('macOS bundle minimum version matches the bundled browser runtime', () => {
  const config = JSON.parse(
    fs.readFileSync('src-tauri/tauri.macos.conf.json', 'utf8')
  )
  assert.equal(config.bundle.macOS.minimumSystemVersion, '12.0')
})
