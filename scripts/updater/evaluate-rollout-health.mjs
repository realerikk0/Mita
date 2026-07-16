#!/usr/bin/env node

import { createHash } from 'node:crypto'
import fs from 'node:fs'

export function evaluateRolloutHealth(evidence) {
  const reasons = []
  if (evidence.status !== 'healthy') reasons.push(`status=${evidence.status ?? 'missing'}`)
  if ((evidence.p0Incidents ?? 0) > 0) reasons.push(`p0Incidents=${evidence.p0Incidents}`)
  if ((evidence.p1Incidents ?? 0) > 0) reasons.push(`p1Incidents=${evidence.p1Incidents}`)
  if ((evidence.dataLossIncidents ?? 0) > 0) reasons.push(`dataLossIncidents=${evidence.dataLossIncidents}`)
  if (typeof evidence.migrationFailureRate !== 'number' || evidence.migrationFailureRate > 0.005) {
    reasons.push(`migrationFailureRate=${evidence.migrationFailureRate ?? 'missing'}`)
  }
  return { pause: reasons.length > 0, reasons }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const [input, expectedSha256, output] = process.argv.slice(2)
    if (!input || !/^[0-9a-f]{64}$/i.test(expectedSha256 ?? '') || !output) {
      throw new Error('Usage: evaluate-rollout-health.mjs <input> <sha256> <output>')
    }
    const bytes = fs.readFileSync(input)
    const actual = createHash('sha256').update(bytes).digest('hex')
    if (actual !== expectedSha256.toLowerCase()) throw new Error('Rollout health digest mismatch')
    const evidence = JSON.parse(bytes.toString('utf8'))
    if (evidence.schema !== 1 || evidence.type !== 'rollout-health') {
      throw new Error('Unsupported rollout health evidence')
    }
    fs.writeFileSync(output, `${JSON.stringify(evaluateRolloutHealth(evidence), null, 2)}\n`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
