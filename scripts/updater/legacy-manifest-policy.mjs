#!/usr/bin/env node

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { validateCanonicalUpdaterManifest } from './candidate-url-policy.mjs'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const policyPath = path.join(scriptDirectory, 'legacy-bridge-policy.json')
const releaseTrainPolicyPath = path.join(
  scriptDirectory,
  '../ci/release-train-policy.json',
)
const releaseTrainPolicy = JSON.parse(
  fs.readFileSync(releaseTrainPolicyPath, 'utf8'),
)

const states = new Set(['pre-a', 'a-pinned'])
const preAPlatforms = [
  'darwin-aarch64',
  'darwin-x86_64',
  'windows-x86_64',
]
const aPinnedPlatforms = [...preAPlatforms, 'linux-x86_64']
const manifestUrls = {
  aliyun: 'https://static.mitapp.cn/mita/latest.json',
  r2: 'https://updates.mita.so/mita/latest.json',
}

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
}

function assertPlainObject(value, description) {
  if (!isPlainObject(value)) throw new Error(`${description} must be an object`)
}

function assertExactKeys(value, expectedKeys, description) {
  const actual = Object.keys(value).sort()
  const expected = [...expectedKeys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(
      `${description} keys must be exactly ${expected.join(', ')}; found ${actual.join(', ') || '(none)'}`,
    )
  }
}

function assertExactPlatformSet(actual, expected, description) {
  if (!Array.isArray(actual) || actual.some((value) => typeof value !== 'string')) {
    throw new Error(`${description} must be an array of platform names`)
  }
  const unique = [...new Set(actual)].sort()
  const wanted = [...expected].sort()
  if (
    unique.length !== actual.length
    || unique.length !== wanted.length
    || unique.some((platform, index) => platform !== wanted[index])
  ) {
    throw new Error(
      `${description} must be exactly ${wanted.join(', ')}; found ${unique.join(', ') || '(none)'}`,
    )
  }
}

function assertHttpsUrl(value, description) {
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${description} must be a valid URL`)
  }
  if (
    parsed.protocol !== 'https:'
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
  ) {
    throw new Error(`${description} must be a credential-free HTTPS URL without query or fragment`)
  }
  return parsed
}

function expectedArtifactName(platform, version) {
  if (platform === 'darwin-aarch64' || platform === 'darwin-x86_64') {
    return 'Biyan.app.tar.gz'
  }
  if (platform === 'windows-x86_64') return `Biyan_${version}_x64-setup.exe`
  if (platform === 'linux-x86_64') return `Biyan_${version}_amd64.AppImage`
  throw new Error(`Unsupported legacy updater platform: ${platform}`)
}

function expectedArtifactPath(policy, platform) {
  const prefix = policy.state === 'pre-a'
    ? `/mita/stable/v${policy.expectedVersion}`
    : `/biyan/updater/releases/v${policy.expectedVersion}`
  return `${prefix}/${expectedArtifactName(platform, policy.expectedVersion)}`
}

function parseJson(bytes, description) {
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8'))
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`${description} is not valid JSON: ${detail}`)
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function activeTrainReleases(trainPolicy = releaseTrainPolicy) {
  const active = trainPolicy?.trains?.find(
    (train) =>
      train.id === trainPolicy.activeTrain && train.status === 'active',
  )
  if (!active) {
    throw new Error(
      `Release train policy has no active train ${trainPolicy?.activeTrain ?? '(missing)'}`,
    )
  }
  return active.releases
}

export function validateLegacyBridgePolicy(
  value,
  { trainPolicy = releaseTrainPolicy } = {},
) {
  assertPlainObject(value, 'Legacy bridge policy')
  assertExactKeys(
    value,
    [
      'schema',
      'state',
      'expectedVersion',
      'expectedManifestSha256',
      'requiredPlatforms',
      'manifestUrls',
    ],
    'Legacy bridge policy',
  )
  if (value.schema !== 1) throw new Error(`Unsupported legacy bridge policy schema: ${value.schema}`)
  if (!states.has(value.state)) {
    throw new Error(`Legacy bridge policy state must be pre-a or a-pinned; found ${value.state}`)
  }
  if (
    typeof value.expectedVersion !== 'string'
    || !/^\d+\.\d+\.\d+$/.test(value.expectedVersion)
  ) {
    throw new Error('Legacy bridge expectedVersion must be an explicit stable semantic version')
  }
  if (!/^[0-9a-f]{64}$/.test(value.expectedManifestSha256 ?? '')) {
    throw new Error('Legacy bridge expectedManifestSha256 must be an explicit lowercase SHA-256')
  }

  const expectedPlatforms = value.state === 'pre-a' ? preAPlatforms : aPinnedPlatforms
  assertExactPlatformSet(value.requiredPlatforms, expectedPlatforms, `${value.state} requiredPlatforms`)
  if (value.state === 'pre-a' && value.expectedVersion !== '0.6.633') {
    throw new Error('pre-a must remain pinned to the current live version 0.6.633')
  }
  const activeA = activeTrainReleases(trainPolicy)?.A
  if (
    value.state === 'a-pinned'
    && (
      value.expectedVersion !== activeA?.version
      || activeA?.dataSchema !== 1
    )
  ) {
    throw new Error(
      `a-pinned must remain pinned to active train A version ${activeA?.version ?? '(missing)'}`,
    )
  }

  assertPlainObject(value.manifestUrls, 'manifestUrls')
  assertExactKeys(value.manifestUrls, Object.keys(manifestUrls), 'manifestUrls')
  for (const [name, expectedUrl] of Object.entries(manifestUrls)) {
    assertHttpsUrl(value.manifestUrls[name], `manifestUrls.${name}`)
    if (value.manifestUrls[name] !== expectedUrl) {
      throw new Error(`manifestUrls.${name} must remain ${expectedUrl}`)
    }
  }

  return {
    schema: value.schema,
    state: value.state,
    expectedVersion: value.expectedVersion,
    expectedManifestSha256: value.expectedManifestSha256,
    requiredPlatforms: [...value.requiredPlatforms],
    manifestUrls: { ...value.manifestUrls },
  }
}

export function validatePromotionLegacyBridge({
  candidate,
  candidateManifestBytes,
  currentPolicy,
  nextPolicy,
  trackedPolicy,
  trainPolicy = releaseTrainPolicy,
}) {
  const tracked = validateLegacyBridgePolicy(trackedPolicy, { trainPolicy })
  assertPlainObject(candidate, 'Promotion candidate')
  const manifestBytes = Buffer.from(candidateManifestBytes ?? '')
  if (manifestBytes.length === 0) {
    throw new Error('Promotion candidate latest.json bytes are required')
  }
  if (sha256(manifestBytes) !== candidate.manifestSha256) {
    throw new Error(
      'Promotion candidate latest.json SHA-256 does not match candidate'
    )
  }
  validateCanonicalUpdaterManifest(
    parseJson(manifestBytes, 'Promotion candidate latest.json'),
    candidate,
  )
  assertPlainObject(currentPolicy, 'Current promotion policy')
  assertPlainObject(nextPolicy, 'Next promotion policy')
  const release = nextPolicy.releases?.[candidate.version]
  assertPlainObject(release, 'Next promotion candidate release')
  const effectivePhase = release.effectivePhase
  if (!['A', 'B', 'C'].includes(effectivePhase)) {
    throw new Error(`Promotion effective phase must be A, B, or C; found ${effectivePhase}`)
  }
  const activeReleases = activeTrainReleases(trainPolicy)
  const expectedRelease = activeReleases?.[effectivePhase]
  if (
    candidate.version !== expectedRelease?.version
    || candidate.dataSchema !== expectedRelease?.dataSchema
    || candidate.migrationPhase !== effectivePhase
  ) {
    throw new Error(
      `Promotion candidate ${candidate.version}/${candidate.migrationPhase}/${candidate.dataSchema} `
      + `must be the active train ${effectivePhase} release `
      + `${expectedRelease?.version ?? '(missing)'}/${expectedRelease?.dataSchema ?? '(missing)'}`,
    )
  }

  const activeA = activeReleases.A
  if (nextPolicy.legacyBridgeVersion !== activeA.version) {
    throw new Error(
      `Next promotion policy legacyBridgeVersion must remain active train A ${activeA.version}`,
    )
  }
  const currentLegacy = currentPolicy.legacyBridgeVersion ?? null
  if (effectivePhase === 'A' && currentLegacy === null) {
    if (tracked.state !== 'pre-a') {
      throw new Error('Initial active A promotion requires the tracked pre-a legacy policy')
    }
  } else {
    if (
      tracked.state !== 'a-pinned'
      || tracked.expectedVersion !== activeA.version
    ) {
      throw new Error(
        `Promotion after initial A requires tracked a-pinned policy ${activeA.version}`,
      )
    }
    if (currentLegacy !== activeA.version) {
      throw new Error(
        `Current promotion policy legacyBridgeVersion must be active train A ${activeA.version}`,
      )
    }
  }
  if (
    effectivePhase === 'A'
    && tracked.state === 'a-pinned'
    && tracked.expectedManifestSha256 !== candidate.manifestSha256
  ) {
    throw new Error(
      'Tracked a-pinned manifest hash must match the active A candidate manifest',
    )
  }
  return {
    activeAVersion: activeA.version,
    effectivePhase,
    trackedState: tracked.state,
  }
}

export function validateLegacyManifest(value, policyInput) {
  const policy = validateLegacyBridgePolicy(policyInput)
  assertPlainObject(value, 'Legacy updater manifest')
  if (value.version !== policy.expectedVersion) {
    throw new Error(
      `Legacy updater manifest version must be exactly ${policy.expectedVersion}; found ${value.version}`,
    )
  }
  assertPlainObject(value.platforms, 'Legacy updater manifest platforms')
  assertExactPlatformSet(
    Object.keys(value.platforms),
    policy.requiredPlatforms,
    'Legacy updater manifest platform set',
  )

  for (const platform of policy.requiredPlatforms) {
    const entry = value.platforms[platform]
    assertPlainObject(entry, `Legacy updater manifest platform ${platform}`)
    if (typeof entry.signature !== 'string' || entry.signature.trim().length === 0) {
      throw new Error(`Legacy updater manifest ${platform} signature must be nonempty`)
    }
    if (typeof entry.url !== 'string') {
      throw new Error(`Legacy updater manifest ${platform} URL must be a string`)
    }
    const parsed = assertHttpsUrl(entry.url, `Legacy updater manifest ${platform} URL`)
    if (parsed.origin !== 'https://static.mitapp.cn') {
      throw new Error(`Legacy updater manifest ${platform} URL must use static.mitapp.cn`)
    }

    let artifactName
    try {
      artifactName = decodeURIComponent(path.posix.basename(parsed.pathname))
    } catch {
      throw new Error(`Legacy updater manifest ${platform} URL has invalid path encoding`)
    }
    if (/\b(?:jan|mita|silence)(?:[-_.]|$)/i.test(artifactName)) {
      throw new Error(
        `Legacy updater manifest ${platform} uses a retired artifact name: ${artifactName}`,
      )
    }
    const expectedName = expectedArtifactName(platform, policy.expectedVersion)
    if (artifactName !== expectedName || parsed.pathname !== expectedArtifactPath(policy, platform)) {
      throw new Error(
        `Legacy updater manifest ${platform} URL must reference the exact Biyan artifact `
        + `${expectedArtifactPath(policy, platform)}; found ${parsed.pathname}`,
      )
    }
  }

  return value
}

export function verifyLegacyManifestPair({
  policy: policyInput,
  aliyunBytes,
  r2Bytes,
  verifiedAt = new Date().toISOString(),
}) {
  const policy = validateLegacyBridgePolicy(policyInput)
  const aliyun = Buffer.from(aliyunBytes)
  const r2 = Buffer.from(r2Bytes)
  if (!aliyun.equals(r2)) {
    throw new Error('Legacy updater manifests must remain byte-identical')
  }
  const manifest = parseJson(aliyun, 'Legacy updater manifest')
  validateLegacyManifest(manifest, policy)
  const manifestSha256 = sha256(aliyun)
  if (manifestSha256 !== policy.expectedManifestSha256) {
    throw new Error(
      `Legacy updater manifest SHA-256 must be exactly ${policy.expectedManifestSha256}; found ${manifestSha256}`,
    )
  }
  return {
    schema: 1,
    status: 'passed',
    verifiedAt,
    state: policy.state,
    expectedVersion: policy.expectedVersion,
    expectedManifestSha256: policy.expectedManifestSha256,
    requiredPlatforms: [...policy.requiredPlatforms],
    manifestUrls: { ...policy.manifestUrls },
    aliyunSha256: manifestSha256,
    r2Sha256: manifestSha256,
  }
}

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (!['--aliyun', '--r2', '--evidence'].includes(flag) || !value || value.startsWith('--')) {
      throw new Error(`Unexpected or incomplete argument: ${flag}`)
    }
    if (args[flag]) throw new Error(`Duplicate argument: ${flag}`)
    args[flag] = value
    index += 1
  }
  for (const required of ['--aliyun', '--r2', '--evidence']) {
    if (!args[required]) throw new Error(`Missing required argument: ${required}`)
  }
  return args
}

function parsePromotionArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (
      ![
        '--candidate',
        '--manifest',
        '--current-policy',
        '--next-policy',
      ].includes(flag)
      || !value
      || value.startsWith('--')
    ) {
      throw new Error(`Unexpected or incomplete argument: ${flag}`)
    }
    if (args[flag]) throw new Error(`Duplicate argument: ${flag}`)
    args[flag] = value
    index += 1
  }
  for (const required of [
    '--candidate',
    '--manifest',
    '--current-policy',
    '--next-policy',
  ]) {
    if (!args[required]) throw new Error(`Missing required argument: ${required}`)
  }
  return args
}

function writeEvidence(file, evidence) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(evidence, null, 2)}\n`)
}

function runCli() {
  let evidenceFile
  try {
    const argv = process.argv.slice(2)
    if (argv[0] === 'validate-promotion') {
      const args = parsePromotionArgs(argv.slice(1))
      const currentPolicyFile = path.resolve(args['--current-policy'])
      const result = validatePromotionLegacyBridge({
        candidate: parseJson(
          fs.readFileSync(path.resolve(args['--candidate'])),
          'Promotion candidate',
        ),
        candidateManifestBytes: fs.readFileSync(
          path.resolve(args['--manifest'])
        ),
        currentPolicy: fs.existsSync(currentPolicyFile)
          ? parseJson(fs.readFileSync(currentPolicyFile), 'Current promotion policy')
          : { legacyBridgeVersion: null },
        nextPolicy: parseJson(
          fs.readFileSync(path.resolve(args['--next-policy'])),
          'Next promotion policy',
        ),
        trackedPolicy: parseJson(
          fs.readFileSync(policyPath),
          'Tracked legacy bridge policy',
        ),
      })
      console.log(
        `Verified ${result.effectivePhase} promotion against legacy ${result.trackedState} `
        + `at active A ${result.activeAVersion}`,
      )
      return
    }
    const args = parseArgs(argv)
    evidenceFile = path.resolve(args['--evidence'])
    const policy = parseJson(fs.readFileSync(policyPath), 'Tracked legacy bridge policy')
    const evidence = verifyLegacyManifestPair({
      policy,
      aliyunBytes: fs.readFileSync(path.resolve(args['--aliyun'])),
      r2Bytes: fs.readFileSync(path.resolve(args['--r2'])),
    })
    writeEvidence(evidenceFile, evidence)
    console.log(
      `Verified byte-identical legacy manifests at ${evidence.expectedVersion} `
      + `for ${evidence.requiredPlatforms.join(', ')}`,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (evidenceFile) {
      writeEvidence(evidenceFile, {
        schema: 1,
        status: 'failed',
        verifiedAt: new Date().toISOString(),
        error: message,
      })
    }
    console.error(message)
    process.exitCode = 1
  }
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? '')) runCli()
