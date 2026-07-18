#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

import {
  validateBundledLegalResources,
  validateCandidateWorkflow,
  validateCiWorkflow,
  validateDocsArchiveConfig,
  validateFlatpakMetadata,
  validateLinuxReleaseBuild,
  validateReleaseIdentity,
  validateReleaseEnvironmentWorkflows,
} from './release-policy-contracts.mjs'

const repoRoot = path.resolve(import.meta.dirname, '../..')
const artifactRootIndex = process.argv.indexOf('--artifact-root')
const artifactRoot =
  artifactRootIndex >= 0
    ? path.resolve(process.argv[artifactRootIndex + 1])
    : null
const failures = []

function fail(message) {
  failures.push(message)
}

function read(relative) {
  return fs.readFileSync(path.join(repoRoot, relative), 'utf8')
}

const releaseMetadata = JSON.parse(read('biyan-release.json'))
if (releaseMetadata.schema !== 1) {
  fail('biyan-release.json has an unsupported metadata schema')
}
const tauriConfig = JSON.parse(read('src-tauri/tauri.conf.json'))
const cargoPackage = read('src-tauri/Cargo.toml').match(
  /^version\s*=\s*"([^"]+)"/m
)?.[1]
const cargoLockPackage = read('src-tauri/Cargo.lock').match(
  /^name\s*=\s*"Biyan"\s*\nversion\s*=\s*"([^"]+)"/m
)?.[1]
if (!cargoPackage || cargoPackage !== tauriConfig.version) {
  fail(
    `Cargo package version ${cargoPackage ?? 'missing'} does not match ${tauriConfig.version}`
  )
}
for (const message of validateReleaseIdentity({
  version: tauriConfig.version,
  migrationPhase: releaseMetadata.migrationPhase,
  dataSchema: releaseMetadata.dataSchema,
  cargoLockVersion: cargoLockPackage,
})) {
  fail(message)
}
for (const message of validateLinuxReleaseBuild(
  read('Makefile'),
  JSON.parse(read('package.json')),
  read('scripts/build-cli.mjs')
)) {
  fail(message)
}

const bundleConfigs = {
  'src-tauri/tauri.conf.json': tauriConfig,
}
for (const relative of [
  'src-tauri/tauri.macos.conf.json',
  'src-tauri/tauri.windows.conf.json',
  'src-tauri/tauri.linux.conf.json',
  'src-tauri/tauri.android.conf.json',
  'src-tauri/tauri.ios.conf.json',
]) {
  bundleConfigs[relative] = JSON.parse(read(relative))
}
for (const message of validateBundledLegalResources(bundleConfigs))
  fail(message)

function walk(root, callback) {
  if (!fs.existsSync(root)) return
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (
      entry.isDirectory() &&
      ['node_modules', 'target', '.next', '.git', '.yarn'].includes(entry.name)
    )
      continue
    const absolute = path.join(root, entry.name)
    if (entry.isDirectory()) walk(absolute, callback)
    else callback(absolute)
  }
}

if (
  fs.existsSync(path.join(repoRoot, '.github/workflows/publish-npm-core.yml'))
) {
  fail(
    'public npm workflow still exists: .github/workflows/publish-npm-core.yml'
  )
}

const workflowRoot = path.join(repoRoot, '.github/workflows')
walk(workflowRoot, (file) => {
  if (!/\.ya?ml$/.test(file)) return
  const source = fs.readFileSync(file, 'utf8')
  if (/\b(?:npm publish|yarn npm publish|npm publish)\b/.test(source)) {
    fail(
      `public npm publish command is forbidden: ${path.relative(repoRoot, file)}`
    )
  }
})

for (const relative of [
  '.github/workflows/desktop-release.yml',
  '.github/workflows/template-tauri-build-macos.yml',
  '.github/workflows/template-tauri-build-windows-x64.yml',
  '.github/workflows/template-tauri-build-linux-x64.yml',
  '.github/workflows/template-tauri-build-linux-x64-flatpak.yml',
]) {
  const source = read(relative)
  if (/\b(?:JAN|MITA)_SIGNING_KEY\b/.test(source)) {
    fail(`formal build still accepts a retired signing key: ${relative}`)
  }
  if (!/\bBIYAN_SIGNING_KEY\b/.test(source)) {
    fail(`formal build does not require BIYAN_SIGNING_KEY: ${relative}`)
  }
}
const desktopRelease = read('.github/workflows/desktop-release.yml')
if (
  !desktopRelease.includes(
    'BIYAN_DATA_SCHEMA: ${{ needs.preflight.outputs.data_schema }}'
  )
) {
  fail(
    'desktop release does not compile the attested Biyan data schema into candidates'
  )
}
for (const message of validateCandidateWorkflow(desktopRelease)) fail(message)

const releaseEnvironmentWorkflows = {
  '.github/workflows/release-distribution.yml': {
    jobName: 'distribute',
    source: read('.github/workflows/release-distribution.yml'),
  },
  '.github/workflows/deploy-updater-router.yml': {
    jobName: 'deploy',
    source: read('.github/workflows/deploy-updater-router.yml'),
  },
  '.github/workflows/biyan-upgrade-smoke.yml': {
    jobName: 'attest',
    source: read('.github/workflows/biyan-upgrade-smoke.yml'),
  },
  '.github/workflows/promote-desktop-update.yml': {
    jobName: 'promote',
    source: read('.github/workflows/promote-desktop-update.yml'),
  },
  '.github/workflows/updater-health-gate.yml': {
    jobName: 'evaluate',
    source: read('.github/workflows/updater-health-gate.yml'),
  },
  '.github/workflows/updater-kill-switch.yml': {
    jobName: 'update',
    source: read('.github/workflows/updater-kill-switch.yml'),
  },
  '.github/workflows/template-tauri-build-macos.yml': {
    jobName: 'build-macos',
    source: read('.github/workflows/template-tauri-build-macos.yml'),
  },
  '.github/workflows/template-tauri-build-windows-x64.yml': {
    jobName: 'build-windows-x64',
    source: read('.github/workflows/template-tauri-build-windows-x64.yml'),
  },
  '.github/workflows/template-tauri-build-linux-x64.yml': {
    jobName: 'build-linux-x64',
    source: read('.github/workflows/template-tauri-build-linux-x64.yml'),
  },
  '.github/workflows/template-tauri-build-linux-x64-flatpak.yml': {
    jobName: 'build-linux-x64',
    source: read('.github/workflows/template-tauri-build-linux-x64-flatpak.yml'),
  },
}
for (const message of validateReleaseEnvironmentWorkflows(
  releaseEnvironmentWorkflows
)) {
  fail(message)
}

const biyanCi = read('.github/workflows/biyan-linter-and-test.yml')
for (const message of validateCiWorkflow(biyanCi)) fail(message)

const docsTsconfig = JSON.parse(read('docs/tsconfig.json'))
for (const message of validateDocsArchiveConfig(docsTsconfig)) fail(message)

const flatpakManifest = read('flatpak/uk.jingxing.Mita.yml')
const flatpakMetainfo = read('flatpak/uk.jingxing.Mita.metainfo.xml')
for (const message of validateFlatpakMetadata(flatpakManifest, flatpakMetainfo))
  fail(message)

const packageManifests = new Set([path.join(repoRoot, 'package.json')])
for (const root of ['core', 'web-app', 'extensions', 'src-tauri/plugins']) {
  walk(path.join(repoRoot, root), (file) => {
    if (path.basename(file) === 'package.json') packageManifests.add(file)
  })
}
for (const manifest of packageManifests) {
  const packageJson = JSON.parse(fs.readFileSync(manifest, 'utf8'))
  if (packageJson.private !== true)
    fail(`${path.relative(repoRoot, manifest)} must be private`)
}

const retiredActivePatterns = [
  /github\.com\/janhq\/llama\.cpp/i,
  /catalog\.jan\.ai/i,
  /apps(?:-nightly)?\.jan\.ai/i,
  /\bjan-app\b/i,
  /@janhq\//i,
  /\bjan-utils\b/i,
  /(?:llamacpp|mlx|foundation-models|rag|vector-db)-extension/i,
]
const isAllowlistedLegacyPath = (relative) =>
  /(?:^|[/\\])(?:__tests__|tests?|fixtures|legacy_migrations)(?:[/\\]|\.)/.test(
    relative
  ) || /(?:^|[/\\])(?:LICENSE|NOTICE)(?:\.[^/\\]+)?$/.test(relative)
for (const relativeRoot of [
  'src-tauri/src',
  'src-tauri/plugins',
  'web-app/src',
  'core',
  'extensions',
]) {
  walk(path.join(repoRoot, relativeRoot), (file) => {
    const relative = path.relative(repoRoot, file)
    if (isAllowlistedLegacyPath(relative)) return
    if (!/\.(?:rs|ts|tsx|js|mjs|json|toml)$/.test(file)) return
    const source = fs.readFileSync(file, 'utf8')
    for (const pattern of retiredActivePatterns) {
      if (pattern.test(source))
        fail(
          `retired Jan identifier or network endpoint found in active source: ${relative}`
        )
    }
  })
}

for (const relative of [
  'package.json',
  'core/package.json',
  'web-app/package.json',
  'extensions/package.json',
  'src-tauri/Cargo.toml',
  'src-tauri/utils/Cargo.toml',
  'yarn.lock',
  'src-tauri/Cargo.lock',
  'src-tauri/plugins/yarn.lock',
]) {
  const absolute = path.join(repoRoot, relative)
  if (!fs.existsSync(absolute)) continue
  const source = fs.readFileSync(absolute, 'utf8')
  for (const pattern of retiredActivePatterns.slice(3)) {
    if (pattern.test(source))
      fail(
        `retired Jan package/extension identifier found in manifest or lockfile: ${relative}`
      )
  }
}

for (const manifest of packageManifests) {
  const relative = path.relative(repoRoot, manifest)
  const source = fs.readFileSync(manifest, 'utf8')
  for (const pattern of retiredActivePatterns.slice(3)) {
    if (pattern.test(source))
      fail(
        `retired Jan package/extension identifier found in package manifest: ${relative}`
      )
  }
}

for (const relative of [
  'src-tauri/static/openapi.json',
  'docs/public/openapi/biyan.json',
]) {
  const absolute = path.join(repoRoot, relative)
  if (!fs.existsSync(absolute)) continue
  const spec = JSON.parse(fs.readFileSync(absolute, 'utf8'))
  if (spec.info?.title !== 'Biyan API Server Endpoints') {
    fail(`Swagger title is not Biyan-branded: ${relative}`)
  }
}

if (tauriConfig.productName !== 'Biyan')
  fail('stable Tauri productName must be Biyan')
for (const relative of [
  'src-tauri/tauri.linux.conf.json',
  'src-tauri/tauri.macos.conf.json',
  'src-tauri/tauri.windows.conf.json',
]) {
  const source = read(relative)
  if (!/resources\/bin\/biyan-cli/.test(source))
    fail(`${relative} must package the biyan CLI`)
  if (/resources\/bin\/(?:jan|mita)(?:-cli)?/i.test(source)) {
    fail(`${relative} still packages a retired CLI`)
  }
}
const windowsWorkflow = read(
  '.github/workflows/template-tauri-build-windows-x64.yml'
)
if (
  !/Biyan_\$\{\{ inputs\.new_version \}\}_x64-setup\.exe/.test(windowsWorkflow)
) {
  fail('Windows build template does not enforce the Biyan installer name')
}
if (
  !/biyan-windows-x64-\$\{\{ inputs\.new_version \}\}-(?:nsis|msi)/.test(
    windowsWorkflow
  )
) {
  fail('Windows build artifact is not Biyan-branded')
}

function binaryContains(file, needles) {
  const descriptor = fs.openSync(file, 'r')
  const buffer = Buffer.alloc(1024 * 1024 + 256)
  let carry = Buffer.alloc(0)
  try {
    let position = 0
    while (true) {
      const bytesRead = fs.readSync(
        descriptor,
        buffer,
        256,
        1024 * 1024,
        position
      )
      if (bytesRead === 0) return null
      const chunk = Buffer.concat([
        carry,
        buffer.subarray(256, 256 + bytesRead),
      ])
        .toString('latin1')
        .toLowerCase()
      const match = needles.find((needle) => chunk.includes(needle))
      if (match) return match
      carry = Buffer.from(chunk.slice(-256), 'latin1')
      position += bytesRead
    }
  } finally {
    fs.closeSync(descriptor)
  }
}

if (artifactRoot) {
  if (!fs.existsSync(artifactRoot))
    fail(`artifact root does not exist: ${artifactRoot}`)
  walk(artifactRoot, (file) => {
    const name = path.basename(file)
    if (/\b(?:jan|mita)(?:[-_.]|$)/i.test(name)) {
      fail(
        `release artifact uses a retired product name: ${path.relative(artifactRoot, file)}`
      )
    }
    if (
      /\.(?:tgz|zip|exe|msi|dmg|AppImage|deb|rpm)$/i.test(name) &&
      /(?:llama|mlx|foundation|rag|vector)/i.test(name)
    ) {
      fail(
        `release artifact exposes a retired local runtime: ${path.relative(artifactRoot, file)}`
      )
    }
    const retiredPayload = binaryContains(file, [
      'github.com/janhq/llama.cpp',
      'catalog.jan.ai',
      'apps.jan.ai',
      'apps-nightly.jan.ai',
      '@janhq/',
      'jan-utils',
      'llamacpp-extension',
      'rag-extension',
      'vector-db-extension',
      'foundation-models-extension',
      'mlx-extension',
    ])
    if (retiredPayload) {
      fail(
        `release artifact contains retired payload "${retiredPayload}": ${path.relative(artifactRoot, file)}`
      )
    }
  })
}

if (failures.length > 0) {
  for (const message of failures) console.error(`- ${message}`)
  process.exit(1)
}
console.log('Release safety policy verified')
