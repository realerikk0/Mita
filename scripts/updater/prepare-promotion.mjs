#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const REQUIRED_SMOKE_SCENARIOS = {
  A: ['current-to-a'],
  B: ['a-to-b', 'current-to-b'],
  C: ['current-to-a-to-b-to-c', 'current-to-c', 'a-to-c', 'b-to-c', 'fresh-c'],
  RECOVERY: ['source-to-recovery'],
}
const REQUIRED_SMOKE_PLATFORMS = ['windows', 'macos', 'linux']

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith('--')) throw new Error(`Unexpected argument: ${argv[index]}`)
    args[argv[index].slice(2)] = argv[index + 1]
  }
  return args
}

function semverParts(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value ?? '')
  if (!match) throw new Error(`Invalid semantic version: ${value}`)
  return {
    core: match.slice(1, 4).map(Number),
    prerelease: match[4]?.split('.') ?? [],
  }
}

function compareSemver(left, right) {
  const a = semverParts(left)
  const b = semverParts(right)
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] < b.core[index] ? -1 : 1
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    if (a.prerelease.length === b.prerelease.length) return 0
    return a.prerelease.length === 0 ? 1 : -1
  }
  const length = Math.max(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const leftPart = a.prerelease[index]
    const rightPart = b.prerelease[index]
    if (leftPart === undefined || rightPart === undefined) return leftPart === undefined ? -1 : 1
    if (leftPart === rightPart) continue
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null
    if (leftNumber !== null && rightNumber !== null) return leftNumber < rightNumber ? -1 : 1
    if (leftNumber !== null || rightNumber !== null) return leftNumber !== null ? -1 : 1
    return leftPart < rightPart ? -1 : 1
  }
  return 0
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function initialPolicy() {
  return {
    schema: 1,
    channel: 'stable',
    currentVersion: '0.6.633',
    legacyBridgeVersion: null,
    paused: false,
    completedPhases: [],
    releases: {},
    transitions: {},
    phaseMilestones: {},
    stableCyclesAfterB: [],
  }
}

function parseDate(value, label) {
  const milliseconds = Date.parse(value ?? '')
  if (!Number.isFinite(milliseconds)) throw new Error(`Invalid ${label}: ${value}`)
  return milliseconds
}

function requirePromotionEvidence({ candidate, phase, promotedAt, smokeEvidence, healthEvidence }) {
  const now = parseDate(promotedAt, 'promotion time')
  if (smokeEvidence?.status !== 'passed' || smokeEvidence.candidateTag !== candidate.tag) {
    throw new Error('A passing upgrade smoke report for this exact candidate is required')
  }
  if (candidate.sourceCommit && smokeEvidence.sourceCommit !== candidate.sourceCommit) {
    throw new Error('Upgrade smoke source commit does not match the candidate')
  }
  if (!/^[0-9a-f]{64}$/i.test(smokeEvidence.sha256 ?? '')) {
    throw new Error('Upgrade smoke evidence digest is required')
  }
  for (const platform of REQUIRED_SMOKE_PLATFORMS) {
    if (!smokeEvidence.platforms?.includes(platform)) {
      throw new Error(`Upgrade smoke is missing platform: ${platform}`)
    }
  }
  for (const scenario of REQUIRED_SMOKE_SCENARIOS[phase]) {
    if (!smokeEvidence.scenarios?.includes(scenario)) {
      throw new Error(`Upgrade smoke is missing scenario: ${scenario}`)
    }
  }
  const smokeTime = parseDate(smokeEvidence.completedAt, 'smoke completion time')
  if (smokeTime > now || now - smokeTime > 14 * DAY_MS) {
    throw new Error('Upgrade smoke evidence must be no more than 14 days old')
  }
  if (phase === 'A') {
    const canaryStartedAt = parseDate(smokeEvidence.canaryStartedAt, 'A canary start time')
    if (canaryStartedAt > smokeTime || smokeTime - canaryStartedAt < 48 * HOUR_MS) {
      throw new Error('Phase A requires at least 48 hours of internal/manual canary evidence')
    }
  }

  if (healthEvidence?.status !== 'healthy' || !/^[0-9a-f]{64}$/i.test(healthEvidence.sha256 ?? '')) {
    throw new Error('A healthy rollout report with a verified digest is required')
  }
  const counters = ['p0Incidents', 'p1Incidents', 'dataLossIncidents']
  for (const counter of counters) {
    if (!Number.isInteger(healthEvidence[counter]) || healthEvidence[counter] !== 0) {
      throw new Error(`Health gate requires ${counter}=0`)
    }
  }
  if (typeof healthEvidence.migrationFailureRate !== 'number'
    || healthEvidence.migrationFailureRate < 0
    || healthEvidence.migrationFailureRate > 0.005) {
    throw new Error('Migration failure rate exceeds the 0.5% rollout limit')
  }
  const observedAt = parseDate(healthEvidence.observedAt, 'health observation time')
  if (observedAt > now || now - observedAt > 6 * HOUR_MS) {
    throw new Error('Rollout health evidence must be no more than 6 hours old')
  }
}

function requireElapsed(now, since, minimum, message) {
  if (!since || now - parseDate(since, 'policy milestone') < minimum) throw new Error(message)
}

export function preparePromotion({
  candidate,
  currentPolicy,
  phase,
  fromVersion,
  expectedCurrent,
  rollout,
  promotedAt,
  smokeEvidence,
  healthEvidence,
}) {
  if (!['A', 'B', 'C', 'RECOVERY'].includes(phase)) throw new Error(`Invalid phase: ${phase}`)
  const expectedSchema = { A: 1, B: 2, C: 3 }[candidate.migrationPhase]
  if (!expectedSchema || candidate.dataSchema !== expectedSchema) {
    throw new Error('Candidate migration phase/data schema attestation is invalid')
  }
  if (phase !== 'RECOVERY' && candidate.migrationPhase !== phase) {
    throw new Error(`Candidate migration phase ${candidate.migrationPhase} does not match promotion phase ${phase}`)
  }
  const percentage = Number(rollout)
  if (![0, 5, 25, 100].includes(percentage)) {
    throw new Error('Rollout must be one of 0, 5, 25, or 100')
  }
  if (currentPolicy.schema !== 1 || currentPolicy.channel !== 'stable') {
    throw new Error('Unsupported stable updater policy')
  }
  if (currentPolicy.currentVersion !== expectedCurrent) {
    throw new Error(`CAS failed: expected current ${expectedCurrent}, got ${currentPolicy.currentVersion}`)
  }
  requirePromotionEvidence({ candidate, phase, promotedAt, smokeEvidence, healthEvidence })
  const promotionTime = parseDate(promotedAt, 'promotion time')

  const targetVersion = candidate.version
  const comparison = compareSemver(targetVersion, currentPolicy.currentVersion)
  const existingTransition = currentPolicy.transitions?.[fromVersion]
  const rolloutOnly = comparison === 0
    && existingTransition?.to === targetVersion
    && existingTransition?.phase === phase
  if (comparison < 0 || (comparison === 0 && !rolloutOnly)) {
    throw new Error(`Forward-only policy rejected ${currentPolicy.currentVersion} -> ${targetVersion}`)
  }
  if (!rolloutOnly && fromVersion !== currentPolicy.currentVersion) {
    throw new Error(`New promotion must start at current ${currentPolicy.currentVersion}, got ${fromVersion}`)
  }
  if (compareSemver(targetVersion, fromVersion) <= 0) {
    throw new Error(`Transition must move forward: ${fromVersion} -> ${targetVersion}`)
  }

  const completed = new Set(currentPolicy.completedPhases ?? [])
  const firstPhaseA = phase === 'A' && !completed.has('A')
  if (phase === 'B' && !completed.has('A')) throw new Error('Phase B requires a completed A promotion')
  if (phase === 'C' && !completed.has('B')) throw new Error('Phase C requires a completed B promotion')
  if (phase === 'A' && (completed.has('B') || completed.has('C'))) {
    throw new Error('Phase A bridge cannot be republished after phase B has started')
  }
  if (phase === 'A' && percentage !== 100) {
    throw new Error('Phase A legacy bridge must be promoted at 100% after manual canary')
  }
  if (!rolloutOnly && ['B', 'C'].includes(phase) && ![0, 5].includes(percentage)) {
    throw new Error(`Phase ${phase} must start at 0% or 5%`)
  }
  if (rolloutOnly) {
    const allowedNext = new Map([
      [0, new Set([0, 5])],
      [5, new Set([5, 25])],
      [25, new Set([25, 100])],
      [100, new Set([100])],
    ])
    if (!allowedNext.get(existingTransition.rollout)?.has(percentage)) {
      throw new Error(`Rollout must advance 0 -> 5 -> 25 -> 100; got ${existingTransition.rollout} -> ${percentage}`)
    }
    if (percentage > existingTransition.rollout && existingTransition.rollout >= 5) {
      requireElapsed(
        promotionTime,
        existingTransition.rolloutChangedAt,
        48 * HOUR_MS,
        `Rollout ${existingTransition.rollout}% must remain stable for at least 48 hours`,
      )
    }
  }

  const milestones = currentPolicy.phaseMilestones ?? {}
  if (!rolloutOnly && phase === 'B') {
    requireElapsed(
      promotionTime,
      milestones.A?.fullAt,
      7 * DAY_MS,
      'Phase A must be at 100% for at least 7 days before phase B',
    )
  }
  if (!rolloutOnly && phase === 'C') {
    requireElapsed(
      promotionTime,
      milestones.B?.fullAt,
      30 * DAY_MS,
      'Phase B must be at 100% for at least 30 days before phase C',
    )
    if ((currentPolicy.stableCyclesAfterB ?? []).length < 2) {
      throw new Error('Phase C requires two completed stable release cycles after phase B')
    }
  }

  const next = structuredClone(currentPolicy)
  next.currentVersion = targetVersion
  next.paused = false
  next.completedPhases = [...completed]
  next.releases ??= {}
  next.transitions ??= {}
  next.phaseMilestones ??= {}
  next.stableCyclesAfterB ??= []
  const sourceRelease = currentPolicy.releases?.[fromVersion]
  if (phase === 'RECOVERY'
    && candidate.migrationPhase !== (sourceRelease?.effectivePhase ?? sourceRelease?.phase)) {
    throw new Error('Recovery candidate must preserve the source migration phase and data schema')
  }
  const effectivePhase = phase === 'RECOVERY'
    ? sourceRelease?.effectivePhase ?? sourceRelease?.phase
    : phase
  if (!effectivePhase || !['A', 'B', 'C'].includes(effectivePhase)) {
    throw new Error('Recovery release has no valid migration phase lineage')
  }
  const previousRelease = currentPolicy.releases?.[targetVersion]
  next.releases[targetVersion] = {
    phase,
    effectivePhase,
    tag: candidate.tag,
    manifestKey: candidate.manifestKey,
    manifestSha256: candidate.manifestSha256,
    promotedAt: previousRelease?.promotedAt ?? new Date(promotedAt).toISOString(),
    lastPromotedAt: new Date(promotedAt).toISOString(),
    smokeEvidenceSha256: smokeEvidence.sha256,
    healthEvidenceSha256: healthEvidence.sha256,
  }
  // Pre-A clients are permanently bridged by the two byte-identical legacy
  // manifests. They must never be admitted by the dynamic Biyan router.
  if (!firstPhaseA) {
    const rolloutChanged = !rolloutOnly || existingTransition.rollout !== percentage
    next.transitions[fromVersion] = {
      to: targetVersion,
      phase,
      rollout: percentage,
      manifestKey: candidate.manifestKey,
      rolloutChangedAt: rolloutChanged
        ? new Date(promotedAt).toISOString()
        : existingTransition.rolloutChangedAt,
      rolloutHistory: [
        ...(existingTransition?.rolloutHistory ?? []),
        ...(rolloutChanged ? [{ percentage, at: new Date(promotedAt).toISOString() }] : []),
      ],
    }
  }
  // The two legacy entrypoints always pin to the latest healthy A-lineage
  // bridge, including an A recovery patch. Pre-A clients must never be forced
  // through a known-bad A build before reaching its forward recovery.
  if (effectivePhase === 'A') next.legacyBridgeVersion = targetVersion
  if (percentage === 100) {
    const wasCompleted = completed.has(effectivePhase)
    completed.add(effectivePhase)
    next.completedPhases = [...completed]
    if (phase !== 'RECOVERY' || !wasCompleted) {
      next.phaseMilestones[effectivePhase] = {
        fullAt: new Date(promotedAt).toISOString(),
        version: targetVersion,
      }
    } else if (effectivePhase === 'B' && !next.stableCyclesAfterB.some((cycle) => cycle.version === targetVersion)) {
      next.stableCyclesAfterB.push({
        version: targetVersion,
        fullAt: new Date(promotedAt).toISOString(),
      })
    }
  }
  return next
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const args = parseArgs(process.argv.slice(2))
    const candidate = readJson(path.resolve(args.candidate))
    const policyPath = args.policy ? path.resolve(args.policy) : null
    const policy = policyPath && fs.existsSync(policyPath) ? readJson(policyPath) : initialPolicy()
    const next = preparePromotion({
      candidate,
      currentPolicy: policy,
      phase: args.phase,
      fromVersion: args['from-version'],
      expectedCurrent: args['expected-current'],
      rollout: args.rollout,
      promotedAt: args['promoted-at'],
      smokeEvidence: readJson(path.resolve(args['smoke-evidence'])),
      healthEvidence: readJson(path.resolve(args['health-evidence'])),
    })
    fs.writeFileSync(path.resolve(args.output), `${JSON.stringify(next, null, 2)}\n`)
    console.log(`Prepared ${args.phase} promotion to ${candidate.version} at ${args.rollout}%`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

export { initialPolicy }
