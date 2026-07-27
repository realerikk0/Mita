#!/usr/bin/env node

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  decodeUpdaterPublicKey,
  verifyUpdaterSignature,
} from './minisign-policy.mjs'
import {
  validateCanonicalUpdaterAsset,
  validateCanonicalUpdaterCandidateMetadata,
  validateCanonicalUpdaterManifest,
} from './candidate-url-policy.mjs'
import { verifyUpdaterAssetSignature } from './verify-updater-asset-signature.mjs'

const USAGE = 'Usage: verify-candidate.mjs <candidate-directory> <expected-tag>'

function isDirectExecution() {
  if (!process.argv[1]) return false
  try {
    return (
      fs.realpathSync(process.argv[1]) ===
      fs.realpathSync(fileURLToPath(import.meta.url))
    )
  } catch {
    return false
  }
}

export function verifyCandidate({ directory, expectedTag, encodedPublicKey }) {
  if (typeof directory !== 'string' || directory.length === 0) {
    throw new Error('Candidate directory is required')
  }
  if (typeof expectedTag !== 'string' || expectedTag.length === 0) {
    throw new Error('Expected candidate tag is required')
  }
  const root = path.resolve(directory)
  const candidatePath = path.join(root, 'candidate.json')
  const candidateSignaturePath = path.join(root, 'candidate.json.sig')
  if (
    !fs.existsSync(candidateSignaturePath) ||
    !fs.statSync(candidateSignaturePath).isFile()
  ) {
    throw new Error('candidate.json.sig is missing')
  }
  const publicKey = decodeUpdaterPublicKey(encodedPublicKey)
  verifyUpdaterSignature(
    candidatePath,
    fs.readFileSync(candidateSignaturePath, 'utf8').trim(),
    publicKey,
    'candidate.json provenance'
  )
  const candidate = JSON.parse(fs.readFileSync(candidatePath, 'utf8'))
  validateCanonicalUpdaterCandidateMetadata(candidate)
  if (
    candidate.schema !== 1 ||
    candidate.tag !== expectedTag ||
    candidate.tag !== `v${candidate.version}`
  ) {
    throw new Error(`Invalid updater candidate identity: ${candidate.tag}`)
  }
  if (!/^[0-9a-f]{40}$/.test(candidate.sourceCommit ?? '')) {
    throw new Error(
      `Invalid candidate source commit: ${candidate.sourceCommit}`
    )
  }
  const expectedDataSchema = { A: 1, B: 2, C: 3 }[candidate.migrationPhase]
  if (!expectedDataSchema || candidate.dataSchema !== expectedDataSchema) {
    throw new Error(
      `Invalid candidate migration phase/schema: ${candidate.migrationPhase}/${candidate.dataSchema}`
    )
  }
  const hash = (file) =>
    createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  const manifest = path.join(root, 'latest.json')
  if (hash(manifest) !== candidate.manifestSha256) {
    throw new Error('Candidate manifest hash mismatch')
  }
  const manifestJson = JSON.parse(fs.readFileSync(manifest, 'utf8'))
  validateCanonicalUpdaterManifest(manifestJson, candidate)
  const expectedAssets = new Map([
    ['darwin-universal', `Biyan.app.tar.gz`],
    ['windows-x86_64', `Biyan_${candidate.version}_x64-setup.exe`],
    ['linux-x86_64', `Biyan_${candidate.version}_amd64.AppImage`],
  ])
  if (candidate.assets.length !== expectedAssets.size) {
    throw new Error('Candidate platform set is incomplete')
  }
  for (const asset of candidate.assets) {
    if (expectedAssets.get(asset.platform) !== asset.file) {
      throw new Error(
        `Unexpected ${asset.platform} updater filename: ${asset.file}`
      )
    }
    if (asset.signatureFile !== `${asset.file}.sig`) {
      throw new Error(
        `Unexpected ${asset.platform} signature filename: ${asset.signatureFile}`
      )
    }
    const file = path.join(root, asset.file)
    const signature = path.join(root, asset.signatureFile)
    if (hash(file) !== asset.sha256) {
      throw new Error(`Asset hash mismatch: ${asset.file}`)
    }
    if (hash(signature) !== asset.signatureSha256) {
      throw new Error(`Signature hash mismatch: ${asset.signatureFile}`)
    }
    verifyUpdaterAssetSignature({
      assetFile: file,
      signatureFile: signature,
      publicKey,
      label: `${asset.platform} ${asset.file}`,
    })
    validateCanonicalUpdaterAsset({
      version: candidate.version,
      file: asset.file,
      objectKey: asset.objectKey,
      url: asset.url,
      description: `${asset.platform} updater asset`,
    })
  }
  const platformAssets = new Map(
    candidate.assets.map((asset) => [asset.platform, asset])
  )
  for (const [platform, assetName] of [
    ['darwin-aarch64', 'darwin-universal'],
    ['darwin-x86_64', 'darwin-universal'],
    ['windows-x86_64', 'windows-x86_64'],
    ['linux-x86_64', 'linux-x86_64'],
  ]) {
    const manifestPlatform = manifestJson.platforms?.[platform]
    const asset = platformAssets.get(assetName)
    const signature = asset
      ? fs.readFileSync(path.join(root, asset.signatureFile), 'utf8').trim()
      : null
    if (
      manifestPlatform?.signature !== signature ||
      manifestPlatform.url !== asset?.url
    ) {
      throw new Error(
        `Manifest platform does not match candidate asset: ${platform}`
      )
    }
  }
  const expectedDistributionAssets = {
    macosDmg: `Biyan_${candidate.version}_universal.dmg`,
    windowsExe: `Biyan_${candidate.version}_x64-setup.exe`,
    windowsMsi: `Biyan_${candidate.version}_x64_en-US.msi`,
    linuxAppImage: `Biyan_${candidate.version}_amd64.AppImage`,
    linuxDeb: `Biyan_${candidate.version}_amd64.deb`,
  }
  const actualDistributionKeys = Object.keys(
    candidate.distributionAssets ?? {}
  ).sort()
  const expectedDistributionKeys = Object.keys(
    expectedDistributionAssets
  ).sort()
  if (
    actualDistributionKeys.join('\0') !== expectedDistributionKeys.join('\0')
  ) {
    throw new Error(
      'Candidate distribution asset set is incomplete or contains unexpected entries'
    )
  }
  for (const [key, expectedFile] of Object.entries(
    expectedDistributionAssets
  )) {
    const asset = candidate.distributionAssets[key]
    if (
      Object.keys(asset ?? {})
        .sort()
        .join('\0') !== ['file', 'sha256'].join('\0')
    ) {
      throw new Error(`Unexpected ${key} distribution metadata keys`)
    }
    if (asset?.file !== expectedFile) {
      throw new Error(`Unexpected ${key} distribution filename: ${asset?.file}`)
    }
    const file = path.join(root, asset.file)
    if (
      !/^[0-9a-f]{64}$/.test(asset.sha256 ?? '') ||
      hash(file) !== asset.sha256
    ) {
      throw new Error(`Distribution asset hash mismatch: ${asset.file}`)
    }
  }
  return candidate
}

if (isDirectExecution()) {
  try {
    const directory = process.argv[2]
    const expectedTag = process.argv[3]
    if (!directory || !expectedTag || process.argv.length !== 4) {
      throw new Error(USAGE)
    }
    const tauriConfig = JSON.parse(
      fs.readFileSync(
        new URL('../../src-tauri/tauri.conf.json', import.meta.url),
        'utf8'
      )
    )
    const candidate = verifyCandidate({
      directory,
      expectedTag,
      encodedPublicKey: tauriConfig?.plugins?.updater?.pubkey,
    })
    console.log(`Verified immutable updater candidate ${candidate.tag}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
