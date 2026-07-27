#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  decodeUpdaterPublicKey,
  verifyUpdaterSignature,
} from './minisign-policy.mjs'

const USAGE =
  'Usage: verify-updater-asset-signature.mjs --asset <file> --signature <file> --public-key <base64> [--label <label>]'

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

function requireRegularFile(file, label) {
  if (typeof file !== 'string' || file.length === 0) {
    throw new Error(`${label} path is required`)
  }
  const absolute = path.resolve(file)
  let stats
  try {
    stats = fs.lstatSync(absolute)
  } catch {
    throw new Error(`${label} is missing: ${absolute}`)
  }
  if (!stats.isFile()) {
    throw new Error(`${label} must be a regular file: ${absolute}`)
  }
  return absolute
}

function verificationLabel(value, assetFile) {
  const label = value ?? path.basename(assetFile)
  if (
    typeof label !== 'string' ||
    label.length === 0 ||
    label.length > 256 ||
    /[\r\n]/.test(label)
  ) {
    throw new Error('Updater asset label is invalid')
  }
  return label
}

export function verifyUpdaterAssetSignature({
  assetFile,
  signatureFile,
  publicKey,
  label,
}) {
  const asset = requireRegularFile(assetFile, 'Updater asset')
  const signature = requireRegularFile(signatureFile, 'Updater signature')
  if (asset === signature) {
    throw new Error('Updater asset and signature must be different files')
  }
  if (
    !publicKey ||
    !Buffer.isBuffer(publicKey.keyId) ||
    publicKey.keyId.length !== 8 ||
    !publicKey.key
  ) {
    throw new Error('Decoded updater public key is required')
  }
  const exactLabel = verificationLabel(label, asset)
  const encodedSignature = fs.readFileSync(signature, 'utf8').trim()
  if (!encodedSignature) {
    throw new Error(`${exactLabel} updater signature is empty`)
  }
  verifyUpdaterSignature(asset, encodedSignature, publicKey, exactLabel)
  return {
    asset,
    signature,
    label: exactLabel,
  }
}

function parseArgs(argv) {
  const allowed = new Set(['--asset', '--signature', '--public-key', '--label'])
  const parsed = {}
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!allowed.has(key)) {
      throw new Error(`Unexpected argument: ${key ?? 'missing'}`)
    }
    if (Object.hasOwn(parsed, key)) {
      throw new Error(`Duplicate argument: ${key}`)
    }
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for ${key}`)
    }
    parsed[key] = value
  }
  for (const required of ['--asset', '--signature', '--public-key']) {
    if (!Object.hasOwn(parsed, required)) {
      throw new Error(`Missing required argument: ${required}`)
    }
  }
  return parsed
}

export function runUpdaterAssetSignatureCli(argv) {
  const args = parseArgs(argv)
  const result = verifyUpdaterAssetSignature({
    assetFile: args['--asset'],
    signatureFile: args['--signature'],
    publicKey: decodeUpdaterPublicKey(args['--public-key']),
    label: args['--label'],
  })
  return `Verified updater asset signature: ${result.label}`
}

if (isDirectExecution()) {
  try {
    console.log(runUpdaterAssetSignatureCli(process.argv.slice(2)))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    console.error(USAGE)
    process.exitCode = 1
  }
}
