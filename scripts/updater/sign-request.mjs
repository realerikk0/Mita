#!/usr/bin/env node

import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import fs from 'node:fs'

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 2) args[argv[index].slice(2)] = argv[index + 1]
  return args
}

function bucketFor(id, targetVersion, salt) {
  const digest = createHash('sha256').update(`${salt}:${id}:${targetVersion}`).digest()
  return digest.readUInt32BE(0) % 10000
}

const args = parseArgs(process.argv.slice(2))
const key = process.env.BIYAN_SIGNING_KEY
if (!key) throw new Error('BIYAN_SIGNING_KEY is required')
const rollout = Number(args.rollout ?? 100)
let session = randomUUID()
while (rollout > 0 && rollout < 100 && bucketFor(session, args['target-version'], args.salt) >= rollout * 100) {
  session = randomUUID()
}
const timestamp = Math.floor(Date.now() / 1000).toString()
const nonce = randomBytes(32).toString('hex')
const token = createHmac('sha256', key).update(`${session}:${timestamp}:${nonce}`).digest('hex')
const headers = {
  'X-Client-Session': session,
  'X-Request-Token': token,
  'X-Request-Time': timestamp,
  'X-Request-Id': nonce,
  'X-Client-Version': args['current-version'],
}
fs.writeFileSync(args.output, `${JSON.stringify(headers, null, 2)}\n`)
