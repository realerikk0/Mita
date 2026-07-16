#!/usr/bin/env node

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    if (!key?.startsWith('--') || argv[index + 1] === undefined) {
      throw new Error(`Unexpected argument: ${key}`)
    }
    args[key.slice(2)] = argv[index + 1]
  }
  return args
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function verify(file, expectedDigest, type) {
  if (!/^[0-9a-f]{64}$/i.test(expectedDigest ?? '')) {
    throw new Error(`Invalid expected ${type} evidence digest`)
  }
  const actual = sha256(file)
  if (actual !== expectedDigest.toLowerCase()) {
    throw new Error(`${type} evidence digest mismatch: expected ${expectedDigest}, got ${actual}`)
  }
  const evidence = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (evidence.schema !== 1 || evidence.type !== type) {
    throw new Error(`Unsupported ${type} evidence document`)
  }
  return { ...evidence, sha256: actual }
}

try {
  const args = parseArgs(process.argv.slice(2))
  const output = path.resolve(args['output-dir'])
  fs.mkdirSync(output, { recursive: true })
  const smoke = verify(path.resolve(args.smoke), args['smoke-sha256'], 'upgrade-smoke')
  const health = verify(path.resolve(args.health), args['health-sha256'], 'rollout-health')
  fs.writeFileSync(path.join(output, 'verified-smoke.json'), `${JSON.stringify(smoke, null, 2)}\n`)
  fs.writeFileSync(path.join(output, 'verified-health.json'), `${JSON.stringify(health, null, 2)}\n`)
  console.log('Verified promotion smoke and health evidence digests')
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
