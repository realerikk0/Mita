#!/usr/bin/env node

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const directory = path.resolve(process.argv[2] ?? '')
const expectedTag = process.argv[3]
if (!directory || !expectedTag) {
  console.error('Usage: verify-candidate.mjs <candidate-directory> <expected-tag>')
  process.exit(1)
}
const candidate = JSON.parse(fs.readFileSync(path.join(directory, 'candidate.json'), 'utf8'))
if (candidate.schema !== 1 || candidate.tag !== expectedTag || candidate.tag !== `v${candidate.version}`) {
  throw new Error(`Invalid updater candidate identity: ${candidate.tag}`)
}
if (!/^[0-9a-f]{40}$/.test(candidate.sourceCommit ?? '')) {
  throw new Error(`Invalid candidate source commit: ${candidate.sourceCommit}`)
}
const expectedDataSchema = { A: 1, B: 2, C: 3 }[candidate.migrationPhase]
if (!expectedDataSchema || candidate.dataSchema !== expectedDataSchema) {
  throw new Error(`Invalid candidate migration phase/schema: ${candidate.migrationPhase}/${candidate.dataSchema}`)
}
const hash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const manifest = path.join(directory, candidate.manifestFile)
if (hash(manifest) !== candidate.manifestSha256) throw new Error('Candidate manifest hash mismatch')
const manifestJson = JSON.parse(fs.readFileSync(manifest, 'utf8'))
if (manifestJson.version !== candidate.version) throw new Error('Manifest version mismatch')
if (manifestJson.sourceCommit !== candidate.sourceCommit
  || manifestJson.migrationPhase !== candidate.migrationPhase
  || manifestJson.dataSchema !== candidate.dataSchema) {
  throw new Error('Manifest release attestation does not match candidate')
}
const expectedAssets = new Map([
  ['darwin-universal', `Biyan.app.tar.gz`],
  ['windows-x86_64', `Biyan_${candidate.version}_x64-setup.exe`],
  ['linux-x86_64', `Biyan_${candidate.version}_amd64.AppImage`],
])
if (candidate.assets.length !== expectedAssets.size) throw new Error('Candidate platform set is incomplete')
for (const asset of candidate.assets) {
  if (expectedAssets.get(asset.platform) !== asset.file) {
    throw new Error(`Unexpected ${asset.platform} updater filename: ${asset.file}`)
  }
  const file = path.join(directory, asset.file)
  const signature = path.join(directory, asset.signatureFile)
  if (hash(file) !== asset.sha256) throw new Error(`Asset hash mismatch: ${asset.file}`)
  if (hash(signature) !== asset.signatureSha256) {
    throw new Error(`Signature hash mismatch: ${asset.signatureFile}`)
  }
  if (!asset.objectKey.startsWith(`biyan/updater/releases/v${candidate.version}/`)) {
    throw new Error(`Asset is not immutable/versioned: ${asset.objectKey}`)
  }
}
const platformAssets = new Map(candidate.assets.map((asset) => [asset.platform, asset]))
for (const [platform, assetName] of [
  ['darwin-aarch64', 'darwin-universal'],
  ['darwin-x86_64', 'darwin-universal'],
  ['windows-x86_64', 'windows-x86_64'],
  ['linux-x86_64', 'linux-x86_64'],
]) {
  const manifestPlatform = manifestJson.platforms?.[platform]
  const asset = platformAssets.get(assetName)
  if (!manifestPlatform?.signature || manifestPlatform.url !== asset?.url) {
    throw new Error(`Manifest platform does not match candidate asset: ${platform}`)
  }
}
console.log(`Verified immutable updater candidate ${candidate.tag}`)
