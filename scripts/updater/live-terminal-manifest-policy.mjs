#!/usr/bin/env node

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { validateCanonicalUpdaterManifest } from './candidate-url-policy.mjs'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const releaseTrainPolicyPath = path.join(
  scriptDirectory,
  '../ci/release-train-policy.json',
)
const releaseTrainPolicy = JSON.parse(
  fs.readFileSync(releaseTrainPolicyPath, 'utf8'),
)

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
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

function allowedLiveTerminals(trainPolicy) {
  const history = trainPolicy?.supersededTerminalReleases
  const previous = Array.isArray(history)
    ? history.filter((entry) => entry?.status === 'published-superseded').at(-1)
    : undefined
  const active = trainPolicy?.activeTerminalRelease
  const allowed = [previous, active].filter(Boolean)
  if (allowed.length === 0) {
    throw new Error('Release train policy has no published or active terminal release')
  }
  for (const terminal of allowed) {
    if (
      !isPlainObject(terminal)
      || terminal.tag !== `v${terminal.version}`
      || terminal.migrationPhase !== 'C'
      || terminal.dataSchema !== 3
      || !/^[0-9a-f]{40}$/.test(terminal.sourceCommit ?? '')
    ) {
      throw new Error('Release train policy contains an invalid live terminal release')
    }
  }
  return allowed
}

export function verifyLiveTerminalManifestPair({
  aliyunBytes,
  r2Bytes,
  githubManifestBytes,
  githubRelease,
  trainPolicy = releaseTrainPolicy,
  verifiedAt = new Date().toISOString(),
}) {
  const aliyun = Buffer.from(aliyunBytes ?? '')
  const r2 = Buffer.from(r2Bytes ?? '')
  const githubManifest = Buffer.from(githubManifestBytes ?? '')
  if (aliyun.length === 0 || r2.length === 0 || githubManifest.length === 0) {
    throw new Error('Aliyun, R2, and GitHub updater manifests are required')
  }
  if (!aliyun.equals(r2)) {
    throw new Error('Live Aliyun and R2 updater manifests must be byte-identical')
  }
  if (!aliyun.equals(githubManifest)) {
    throw new Error('Live updater manifests must match the published GitHub manifest')
  }

  const manifest = parseJson(aliyun, 'Live updater manifest')
  const terminal = allowedLiveTerminals(trainPolicy).find(
    (entry) => entry.version === manifest.version,
  )
  if (!terminal) {
    throw new Error(
      `Live updater version ${manifest.version ?? '(missing)'} is not the latest published or active terminal release`,
    )
  }
  validateCanonicalUpdaterManifest(manifest, terminal)

  if (
    !isPlainObject(githubRelease)
    || githubRelease.tag_name !== terminal.tag
    || githubRelease.target_commitish !== terminal.sourceCommit
    || githubRelease.draft !== false
    || githubRelease.prerelease !== false
    || typeof githubRelease.published_at !== 'string'
    || githubRelease.published_at.length === 0
  ) {
    throw new Error('GitHub release does not match the exact published terminal identity')
  }
  const assets = Array.isArray(githubRelease.assets) ? githubRelease.assets : []
  const matches = assets.filter((asset) => asset?.name === 'latest.json')
  if (matches.length !== 1) {
    throw new Error('GitHub release must contain exactly one latest.json asset')
  }
  const asset = matches[0]
  const manifestSha256 = sha256(githubManifest)
  if (
    asset.state !== 'uploaded'
    || asset.size !== githubManifest.length
    || asset.digest !== `sha256:${manifestSha256}`
  ) {
    throw new Error('GitHub latest.json asset size or digest does not match its bytes')
  }

  return {
    schema: 1,
    status: 'passed',
    verifiedAt,
    version: terminal.version,
    tag: terminal.tag,
    sourceCommit: terminal.sourceCommit,
    manifestSha256,
    aliyunSha256: manifestSha256,
    r2Sha256: manifestSha256,
    githubSha256: manifestSha256,
  }
}

function parseArgs(argv) {
  const accepted = new Set([
    '--aliyun',
    '--r2',
    '--github-release',
    '--github-manifest',
    '--evidence',
  ])
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (!accepted.has(flag) || !value || value.startsWith('--')) {
      throw new Error(`Unexpected or incomplete argument: ${flag}`)
    }
    if (args[flag]) throw new Error(`Duplicate argument: ${flag}`)
    args[flag] = value
    index += 1
  }
  for (const required of accepted) {
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
    const args = parseArgs(process.argv.slice(2))
    evidenceFile = path.resolve(args['--evidence'])
    const evidence = verifyLiveTerminalManifestPair({
      aliyunBytes: fs.readFileSync(path.resolve(args['--aliyun'])),
      r2Bytes: fs.readFileSync(path.resolve(args['--r2'])),
      githubManifestBytes: fs.readFileSync(
        path.resolve(args['--github-manifest']),
      ),
      githubRelease: parseJson(
        fs.readFileSync(path.resolve(args['--github-release'])),
        'GitHub release',
      ),
    })
    writeEvidence(evidenceFile, evidence)
    console.log(
      `Verified live terminal ${evidence.tag} across Aliyun, R2, and GitHub`,
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

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? '')) {
  runCli()
}
