#!/usr/bin/env node

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const SHA256 = /^[0-9a-f]{64}$/
const COMMIT = /^[0-9a-f]{40}$/
const SEMVER =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/

const PLATFORM_CONTRACTS = {
  linux: {
    architecture: 'x86_64',
    packages: (version) => [
      `Biyan_${version}_amd64.AppImage`,
      `Biyan_${version}_amd64.deb`,
    ],
  },
  macos: {
    architecture: 'x86_64',
    packages: (version) => [
      `Biyan_${version}.app.tar.gz`,
      `Biyan_${version}_universal.dmg`,
    ],
  },
  windows: {
    architecture: 'AMD64',
    packages: (version) => [
      `Biyan_${version}_x64-setup.exe`,
      `Biyan_${version}_x64_en-US.msi`,
    ],
  },
}

const PHASE_SCHEMAS = { A: 1, B: 2, C: 3 }

function fail(message) {
  throw new Error(message)
}

function normalizeCommit(value, label) {
  const normalized = String(value ?? '').toLowerCase()
  if (!COMMIT.test(normalized)) fail(`${label} must be an exact 40-hex commit`)
  return normalized
}

function normalizeSha256(value, label) {
  const normalized = String(value ?? '').toLowerCase()
  if (!SHA256.test(normalized)) {
    fail(`${label} must be exactly 64 lowercase hex characters`)
  }
  return normalized
}

function normalizeRunId(value, label) {
  const normalized = String(value ?? '')
  if (!/^[1-9][0-9]*$/.test(normalized)) {
    fail(`${label} must be a positive integer`)
  }
  return normalized
}

function optionalPair(first, second, firstLabel, secondLabel) {
  const hasFirst = first !== undefined && first !== null
  const hasSecond = second !== undefined && second !== null
  if (hasFirst !== hasSecond) {
    fail(`${firstLabel} and ${secondLabel} must be provided together`)
  }
  return hasFirst
}

function requireNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(`${label} must be a non-empty string`)
  }
  return value
}

export function normalizeArtifactPath(value) {
  if (typeof value !== 'string' || value.length === 0) {
    fail('artifact path must be a non-empty string')
  }
  if (value.includes('\\') || path.posix.isAbsolute(value)) {
    fail(`artifact path must be portable and relative: ${value}`)
  }
  const normalized = path.posix.normalize(value)
  if (
    normalized !== value ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../')
  ) {
    fail(`artifact path escapes or is not normalized: ${value}`)
  }
  return normalized
}

export function sha256File(file) {
  const hash = crypto.createHash('sha256')
  const descriptor = fs.openSync(file, 'r')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  try {
    for (;;) {
      const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null)
      if (bytesRead === 0) break
      hash.update(buffer.subarray(0, bytesRead))
    }
  } finally {
    fs.closeSync(descriptor)
  }
  return hash.digest('hex')
}

function regularFiles(root, excluded = new Set()) {
  const files = []
  function visit(directory) {
    for (const entry of fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name)
      const relative = normalizeArtifactPath(
        path.relative(root, absolute).split(path.sep).join('/')
      )
      if (excluded.has(relative)) continue
      if (entry.isSymbolicLink()) fail(`artifact symlink is forbidden: ${relative}`)
      if (entry.isDirectory()) visit(absolute)
      else if (entry.isFile()) files.push({ absolute, relative })
      else fail(`unsupported artifact entry: ${relative}`)
    }
  }
  visit(root)
  return files.sort((left, right) =>
    left.relative.localeCompare(right.relative)
  )
}

function manifestRelativePath(root, manifestPath) {
  const relative = path.relative(root, manifestPath).split(path.sep).join('/')
  if (relative.startsWith('../') || path.isAbsolute(relative)) return null
  return normalizeArtifactPath(relative)
}

export function createQualificationArtifactManifest({
  root,
  output,
  targetSha,
  baseSha,
  workflowSha,
  runId,
  sourceRunId,
  sourceManifestSha256,
}) {
  const absoluteRoot = path.resolve(root)
  const absoluteOutput = path.resolve(output)
  if (!fs.statSync(absoluteRoot, { throwIfNoEntry: false })?.isDirectory()) {
    fail(`artifact root is not a directory: ${absoluteRoot}`)
  }
  const excluded = new Set()
  const outputRelative = manifestRelativePath(absoluteRoot, absoluteOutput)
  if (outputRelative) excluded.add(outputRelative)
  const entries = regularFiles(absoluteRoot, excluded).map(
    ({ absolute, relative }) => ({
      path: relative,
      size: fs.statSync(absolute).size,
      sha256: sha256File(absolute),
    })
  )
  if (entries.length === 0) fail('qualification artifact set is empty')

  const manifest = {
    schema: 1,
    status: 'complete',
    targetSha: normalizeCommit(targetSha, 'target SHA'),
    baseSha: normalizeCommit(baseSha, 'base SHA'),
    workflowSha: normalizeCommit(workflowSha, 'workflow SHA'),
    runId: normalizeRunId(runId, 'run ID'),
    files: entries,
  }
  if (
    optionalPair(
      sourceRunId,
      sourceManifestSha256,
      'source run ID',
      'source manifest SHA-256'
    )
  ) {
    manifest.sourceRunId = normalizeRunId(sourceRunId, 'source run ID')
    manifest.sourceManifestSha256 = normalizeSha256(
      sourceManifestSha256,
      'source manifest SHA-256'
    )
  }
  fs.mkdirSync(path.dirname(absoluteOutput), { recursive: true })
  fs.writeFileSync(absoluteOutput, `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

export function verifyQualificationArtifactManifest({
  root,
  manifestPath,
  expectedManifestSha256,
  expectedTargetSha,
  expectedBaseSha,
  expectedRunId,
  expectedSourceRunId,
  expectedSourceManifestSha256,
}) {
  const absoluteRoot = path.resolve(root)
  const absoluteManifest = path.resolve(manifestPath)
  if (!fs.statSync(absoluteRoot, { throwIfNoEntry: false })?.isDirectory()) {
    fail(`artifact root is not a directory: ${absoluteRoot}`)
  }
  if (!fs.statSync(absoluteManifest, { throwIfNoEntry: false })?.isFile()) {
    fail(`artifact manifest is not a regular file: ${absoluteManifest}`)
  }
  const expectedManifest = normalizeSha256(
    expectedManifestSha256,
    'expected manifest SHA-256'
  )
  const actualManifest = sha256File(absoluteManifest)
  if (actualManifest !== expectedManifest) {
    fail(`artifact manifest SHA-256 mismatch: ${actualManifest}`)
  }

  const manifest = JSON.parse(fs.readFileSync(absoluteManifest, 'utf8'))
  if (manifest.schema !== 1 || manifest.status !== 'complete') {
    fail('unsupported or incomplete qualification artifact manifest')
  }
  if (
    manifest.targetSha !== normalizeCommit(expectedTargetSha, 'target SHA') ||
    manifest.baseSha !== normalizeCommit(expectedBaseSha, 'base SHA')
  ) {
    fail('qualification artifact source identity mismatch')
  }
  if (
    normalizeRunId(manifest.runId, 'artifact run ID') !==
    normalizeRunId(expectedRunId, 'expected run ID')
  ) {
    fail('qualification artifact run ID mismatch')
  }
  if (!COMMIT.test(manifest.workflowSha ?? '')) {
    fail('qualification artifact workflow SHA is invalid')
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    fail('qualification artifact manifest has no files')
  }

  const manifestHasSourceRunId = Object.hasOwn(manifest, 'sourceRunId')
  const manifestHasSourceManifest = Object.hasOwn(
    manifest,
    'sourceManifestSha256'
  )
  if (manifestHasSourceRunId !== manifestHasSourceManifest) {
    fail(
      'manifest source run ID and manifest source manifest SHA-256 must be provided together'
    )
  }
  const manifestHasSource = manifestHasSourceRunId
  const expectedHasSource = optionalPair(
    expectedSourceRunId,
    expectedSourceManifestSha256,
    'expected source run ID',
    'expected source manifest SHA-256'
  )
  if (manifestHasSource) {
    const manifestSourceRunId = normalizeRunId(
      manifest.sourceRunId,
      'manifest source run ID'
    )
    const manifestSourceSha = normalizeSha256(
      manifest.sourceManifestSha256,
      'manifest source manifest SHA-256'
    )
    if (expectedHasSource) {
      if (
        manifestSourceRunId !==
          normalizeRunId(expectedSourceRunId, 'expected source run ID') ||
        manifestSourceSha !==
          normalizeSha256(
            expectedSourceManifestSha256,
            'expected source manifest SHA-256'
          )
      ) {
        fail('qualification artifact source evidence mismatch')
      }
    }
  } else if (expectedHasSource) {
    fail('qualification artifact source evidence is missing')
  }

  const expectedPaths = new Set()
  let previous = null
  for (const entry of manifest.files) {
    const relative = normalizeArtifactPath(entry?.path)
    if (previous !== null && relative.localeCompare(previous) <= 0) {
      fail('qualification artifact paths must be unique and sorted')
    }
    previous = relative
    if (!Number.isSafeInteger(entry.size) || entry.size < 0) {
      fail(`invalid artifact size: ${relative}`)
    }
    if (!SHA256.test(entry.sha256 ?? '')) {
      fail(`invalid artifact SHA-256: ${relative}`)
    }
    const absolute = path.resolve(absoluteRoot, ...relative.split('/'))
    const rootPrefix = `${absoluteRoot}${path.sep}`
    if (!absolute.startsWith(rootPrefix)) fail(`artifact path escapes root: ${relative}`)
    const stat = fs.lstatSync(absolute, { throwIfNoEntry: false })
    if (!stat?.isFile() || stat.isSymbolicLink()) {
      fail(`artifact is missing or not a regular file: ${relative}`)
    }
    if (stat.size !== entry.size) fail(`artifact size mismatch: ${relative}`)
    if (sha256File(absolute) !== entry.sha256) {
      fail(`artifact SHA-256 mismatch: ${relative}`)
    }
    expectedPaths.add(relative)
  }

  const excluded = new Set()
  const manifestRelative = manifestRelativePath(absoluteRoot, absoluteManifest)
  if (manifestRelative) excluded.add(manifestRelative)
  const actualPaths = regularFiles(absoluteRoot, excluded).map(
    ({ relative }) => relative
  )
  for (const relative of actualPaths) {
    if (!expectedPaths.has(relative)) fail(`unlisted artifact file: ${relative}`)
  }
  if (actualPaths.length !== expectedPaths.size) {
    fail('qualification artifact set is incomplete')
  }
  return manifest
}

function readPlatformProvenance(root, platform, expectedTargetSha, expectedBaseSha) {
  const contract = PLATFORM_CONTRACTS[platform]
  const provenancePath = path.join(root, `runner-provenance-${platform}.json`)
  const provenanceStat = fs.lstatSync(provenancePath, { throwIfNoEntry: false })
  if (
    !provenanceStat?.isFile() ||
    provenanceStat.isSymbolicLink() ||
    provenanceStat.size === 0
  ) {
    fail(`${platform} provenance is missing, empty, or not a regular file`)
  }

  let provenance
  try {
    provenance = JSON.parse(fs.readFileSync(provenancePath, 'utf8'))
  } catch (error) {
    fail(`${platform} provenance is not valid JSON: ${error.message}`)
  }
  if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) {
    fail(`${platform} provenance must be a JSON object`)
  }
  if (provenance.schema !== 1) fail(`${platform} provenance schema must be 1`)
  if (provenance.platform !== platform) {
    fail(`${platform} provenance platform mismatch`)
  }
  if (provenance.architecture !== contract.architecture) {
    fail(`${platform} provenance architecture must be ${contract.architecture}`)
  }
  if (provenance.runnerArch !== 'X64') {
    fail(`${platform} provenance runnerArch must be X64`)
  }
  if (provenance.built !== true) {
    fail(`${platform} provenance must attest built=true`)
  }

  const targetSha = normalizeCommit(provenance.targetSha, `${platform} target SHA`)
  const baseSha = normalizeCommit(provenance.baseSha, `${platform} base SHA`)
  if (
    expectedTargetSha !== undefined &&
    expectedTargetSha !== null &&
    targetSha !== normalizeCommit(expectedTargetSha, 'expected target SHA')
  ) {
    fail(`${platform} provenance target SHA mismatch`)
  }
  if (
    expectedBaseSha !== undefined &&
    expectedBaseSha !== null &&
    baseSha !== normalizeCommit(expectedBaseSha, 'expected base SHA')
  ) {
    fail(`${platform} provenance base SHA mismatch`)
  }

  const version = requireNonEmptyString(
    provenance.version,
    `${platform} provenance version`
  )
  if (!SEMVER.test(version)) {
    fail(`${platform} provenance version must be valid SemVer`)
  }
  const migrationPhase = provenance.migrationPhase
  if (!Object.hasOwn(PHASE_SCHEMAS, migrationPhase)) {
    fail(`${platform} provenance migrationPhase must be A, B, or C`)
  }
  if (provenance.dataSchema !== PHASE_SCHEMAS[migrationPhase]) {
    fail(`${platform} provenance migrationPhase/dataSchema pairing is invalid`)
  }

  for (const field of ['imageOS', 'imageVersion', 'node', 'yarn', 'rust', 'cargo']) {
    requireNonEmptyString(provenance[field], `${platform} provenance ${field}`)
  }

  return { provenance, targetSha, baseSha, version, migrationPhase }
}

function verifyPlatformPackages(root, platform, version) {
  const packagesRoot = path.join(root, 'packages', platform)
  const rootStat = fs.lstatSync(packagesRoot, { throwIfNoEntry: false })
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) {
    fail(`${platform} package root is missing or not a regular directory`)
  }
  const entries = fs
    .readdirSync(packagesRoot, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
  const actual = []
  for (const entry of entries) {
    const packagePath = path.join(packagesRoot, entry.name)
    if (entry.isSymbolicLink() || !entry.isFile()) {
      fail(`${platform} package must be a flat regular file: ${entry.name}`)
    }
    const stat = fs.lstatSync(packagePath)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0) {
      fail(`${platform} package is empty or not a regular file: ${entry.name}`)
    }
    actual.push(entry.name)
  }
  const expected = PLATFORM_CONTRACTS[platform]
    .packages(version)
    .sort((a, b) => a.localeCompare(b))
  if (
    actual.length !== expected.length ||
    actual.some((name, index) => name !== expected[index])
  ) {
    fail(
      `${platform} package set mismatch: expected ${expected.join(', ')}, ` +
        `got ${actual.join(', ') || '<empty>'}`
    )
  }
  return actual
}

export function verifyQualificationPlatforms({
  root,
  expectedTargetSha,
  expectedBaseSha,
}) {
  const absoluteRoot = path.resolve(root)
  if (!fs.statSync(absoluteRoot, { throwIfNoEntry: false })?.isDirectory()) {
    fail(`artifact root is not a directory: ${absoluteRoot}`)
  }
  optionalPair(
    expectedTargetSha,
    expectedBaseSha,
    'expected target SHA',
    'expected base SHA'
  )

  const packagesRoot = path.join(absoluteRoot, 'packages')
  const packagesRootStat = fs.lstatSync(packagesRoot, { throwIfNoEntry: false })
  if (!packagesRootStat?.isDirectory() || packagesRootStat.isSymbolicLink()) {
    fail('qualification packages root is missing or not a regular directory')
  }
  const packagePlatforms = fs
    .readdirSync(packagesRoot, { withFileTypes: true })
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))
  const expectedPlatforms = Object.keys(PLATFORM_CONTRACTS).sort((a, b) =>
    a.localeCompare(b)
  )
  if (
    packagePlatforms.length !== expectedPlatforms.length ||
    packagePlatforms.some((name, index) => name !== expectedPlatforms[index])
  ) {
    fail('qualification package platforms must be exactly linux, macos, and windows')
  }

  const results = {}
  let sharedIdentity = null
  for (const platform of expectedPlatforms) {
    const identity = readPlatformProvenance(
      absoluteRoot,
      platform,
      expectedTargetSha,
      expectedBaseSha
    )
    const packages = verifyPlatformPackages(absoluteRoot, platform, identity.version)
    const comparable = JSON.stringify({
      version: identity.version,
      migrationPhase: identity.migrationPhase,
      dataSchema: identity.provenance.dataSchema,
    })
    if (sharedIdentity !== null && comparable !== sharedIdentity) {
      fail('platform provenance release identities do not match')
    }
    sharedIdentity = comparable
    results[platform] = { ...identity.provenance, packages }
  }
  return results
}

function parseArgs(argv) {
  const [command, ...rest] = argv
  const options = {}
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index]
    const value = rest[index + 1]
    if (!key?.startsWith('--') || value === undefined) {
      fail(`invalid argument list near ${key ?? '<end>'}`)
    }
    options[key.slice(2)] = value
  }
  return { command, options }
}

function main() {
  const { command, options } = parseArgs(process.argv.slice(2))
  if (command === 'create') {
    createQualificationArtifactManifest({
      root: options.root,
      output: options.output,
      targetSha: options['target-sha'],
      baseSha: options['base-sha'],
      workflowSha: options['workflow-sha'],
      runId: options['run-id'],
      sourceRunId: options['source-run-id'],
      sourceManifestSha256: options['source-manifest-sha256'],
    })
    console.log(`Created qualification artifact manifest: ${options.output}`)
    return
  }
  if (command === 'verify') {
    verifyQualificationArtifactManifest({
      root: options.root,
      manifestPath: options.manifest,
      expectedManifestSha256: options['manifest-sha256'],
      expectedTargetSha: options['target-sha'],
      expectedBaseSha: options['base-sha'],
      expectedRunId: options['run-id'],
      expectedSourceRunId: options['source-run-id'],
      expectedSourceManifestSha256: options['source-manifest-sha256'],
    })
    console.log('Qualification artifact manifest verified')
    return
  }
  if (command === 'verify-platforms') {
    verifyQualificationPlatforms({
      root: options.root,
      expectedTargetSha: options['target-sha'],
      expectedBaseSha: options['base-sha'],
    })
    console.log('Qualification platform provenance and packages verified')
    return
  }
  fail(
    'usage: verify-qualification-artifacts.mjs <create|verify|verify-platforms> [options]'
  )
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
