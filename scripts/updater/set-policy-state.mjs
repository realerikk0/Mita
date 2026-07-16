#!/usr/bin/env node

import fs from 'node:fs'

const [input, output, expectedCurrent, state] = process.argv.slice(2)
if (!input || !output || !expectedCurrent || !['paused', 'active'].includes(state)) {
  console.error('Usage: set-policy-state.mjs <input> <output> <expected-current> <paused|active>')
  process.exit(1)
}

const policy = JSON.parse(fs.readFileSync(input, 'utf8'))
if (policy.schema !== 1 || policy.channel !== 'stable') throw new Error('Unsupported updater policy')
if (policy.currentVersion !== expectedCurrent) {
  throw new Error(`CAS failed: expected current ${expectedCurrent}, got ${policy.currentVersion}`)
}
policy.paused = state === 'paused'
policy.updatedAt = new Date().toISOString()
fs.writeFileSync(output, `${JSON.stringify(policy, null, 2)}\n`)
