#!/usr/bin/env node

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  )
}

function requirePolicy(policy, description) {
  if (
    !isPlainObject(policy) ||
    policy.schema !== 1 ||
    policy.channel !== 'stable' ||
    !VERSION_PATTERN.test(policy.currentVersion ?? '') ||
    typeof policy.paused !== 'boolean'
  ) {
    throw new Error(`${description} must be a stable schema-1 updater policy`)
  }
  return policy
}

function canonicalTimestamp(value, description) {
  const timestamp = new Date(value)
  if (Number.isNaN(timestamp.valueOf()) || timestamp.toISOString() !== value) {
    throw new Error(`${description} must be canonical ISO-8601`)
  }
  return value
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function policyWithoutPauseState(policy) {
  const copy = structuredClone(policy)
  delete copy.paused
  delete copy.updatedAt
  return copy
}

export function prepareRouterPause({
  currentPolicy,
  expectedCurrent,
  pausedAt,
}) {
  const current = requirePolicy(currentPolicy, 'Current updater policy')
  if (current.currentVersion !== expectedCurrent) {
    throw new Error(
      `Router pause CAS expected current ${expectedCurrent}, got ${current.currentVersion}`
    )
  }
  canonicalTimestamp(pausedAt, 'Router pause time')
  if (current.paused) {
    return {
      action: 'no-change',
      reason: 'router-already-paused',
      policy: structuredClone(current),
    }
  }
  const policy = structuredClone(current)
  policy.paused = true
  policy.updatedAt = pausedAt
  return {
    action: 'write',
    reason: 'active-router-policy',
    policy,
  }
}

export function validateRouterPausePolicy({
  beforePolicy,
  pausedPolicy,
  expectedCurrent,
}) {
  const before = requirePolicy(beforePolicy, 'Pre-pause updater policy')
  const paused = requirePolicy(pausedPolicy, 'Paused updater policy')
  if (
    before.currentVersion !== expectedCurrent ||
    paused.currentVersion !== expectedCurrent
  ) {
    throw new Error('Router pause policy current version is not the CAS target')
  }
  if (before.paused !== false || paused.paused !== true) {
    throw new Error('Router pause policy must change paused false -> true')
  }
  canonicalTimestamp(paused.updatedAt, 'Paused updater policy updatedAt')
  if (
    !isDeepStrictEqual(
      policyWithoutPauseState(before),
      policyWithoutPauseState(paused)
    )
  ) {
    throw new Error('Router pause may change only paused and updatedAt')
  }
  return {
    schema: 1,
    kind: 'router-pause-policy',
    currentVersion: expectedCurrent,
  }
}

export function validateRouterPauseReadback({
  expectedPolicyBytes,
  actualPolicyBytes,
}) {
  if (
    !Buffer.isBuffer(expectedPolicyBytes) ||
    !Buffer.isBuffer(actualPolicyBytes) ||
    !expectedPolicyBytes.equals(actualPolicyBytes)
  ) {
    throw new Error('Router pause readback must match proposed policy bytes')
  }
  let policy
  try {
    policy = JSON.parse(actualPolicyBytes.toString('utf8'))
  } catch {
    throw new Error('Router pause readback is not valid JSON')
  }
  requirePolicy(policy, 'Router pause readback')
  if (!policy.paused) throw new Error('Router pause readback is not paused')
  return {
    schema: 1,
    kind: 'router-pause-readback',
    currentVersion: policy.currentVersion,
    sha256: sha256(actualPolicyBytes),
  }
}

export function validateRouterPauseProbe({
  beforeStatus,
  beforeState,
  afterStatus,
  afterState,
}) {
  const beforeIsReady =
    beforeStatus === 204 && ['no-transition', 'paused'].includes(beforeState)
  if (!beforeIsReady) {
    throw new Error(
      'Router pre-pause probe must be authenticated 204/no-transition or already paused'
    )
  }
  if (afterStatus !== 204 || afterState !== 'paused') {
    throw new Error('Router post-pause probe must be authenticated 204/paused')
  }
  return {
    schema: 1,
    kind: 'router-pause-proof',
    before: { status: beforeStatus, state: beforeState },
    after: { status: afterStatus, state: afterState },
  }
}

function parseArgs(argv) {
  const [command, ...rest] = argv
  const args = {}
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index]
    const value = rest[index + 1]
    if (!flag?.startsWith('--') || value === undefined || args[flag]) {
      throw new Error(`Unexpected or incomplete argument: ${flag ?? '(missing)'}`)
    }
    args[flag] = value
  }
  return { command, args }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'))
}

function writeJson(file, value) {
  fs.writeFileSync(path.resolve(file), `${JSON.stringify(value, null, 2)}\n`)
}

function runCli() {
  const { command, args } = parseArgs(process.argv.slice(2))
  if (command === 'prepare') {
    const result = prepareRouterPause({
      currentPolicy: readJson(args['--policy']),
      expectedCurrent: args['--expected-current'],
      pausedAt: args['--paused-at'],
    })
    writeJson(args['--output-policy'], result.policy)
    writeJson(args['--output'], {
      schema: 1,
      kind: 'router-pause-plan',
      action: result.action,
      reason: result.reason,
      currentVersion: result.policy.currentVersion,
    })
    return
  }
  if (command === 'validate-policy') {
    const result = validateRouterPausePolicy({
      beforePolicy: readJson(args['--before-policy']),
      pausedPolicy: readJson(args['--paused-policy']),
      expectedCurrent: args['--expected-current'],
    })
    if (args['--output']) writeJson(args['--output'], result)
    return
  }
  if (command === 'validate-readback') {
    const result = validateRouterPauseReadback({
      expectedPolicyBytes: fs.readFileSync(path.resolve(args['--expected'])),
      actualPolicyBytes: fs.readFileSync(path.resolve(args['--actual'])),
    })
    if (args['--output']) writeJson(args['--output'], result)
    return
  }
  if (command === 'validate-router-probe') {
    const result = validateRouterPauseProbe({
      beforeStatus: Number(args['--before-status']),
      beforeState: args['--before-state'],
      afterStatus: Number(args['--after-status']),
      afterState: args['--after-state'],
    })
    if (args['--output']) writeJson(args['--output'], result)
    return
  }
  throw new Error(`Unknown Router pause command: ${command}`)
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? '')) {
  try {
    runCli()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
