#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

import {
  DIRECT_C_CANONICAL_UPDATER_PLATFORMS,
  DIRECT_C_CURRENT,
  DIRECT_C_REQUIRED_PLATFORMS,
  DIRECT_C_REQUIRED_SCENARIOS,
  DIRECT_C_ROUTER_SOURCES,
  DIRECT_C_TARGET_SOURCE_COMMIT,
} from './direct-c-contract.mjs'

export {
  DIRECT_C_CANONICAL_UPDATER_PLATFORMS,
  DIRECT_C_CURRENT,
  DIRECT_C_REQUIRED_PLATFORMS,
  DIRECT_C_REQUIRED_SCENARIOS,
  DIRECT_C_ROUTER_SOURCES,
  DIRECT_C_TARGET_SOURCE_COMMIT,
} from './direct-c-contract.mjs'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
export const DIRECT_C_POLICY_FILE = path.join(
  scriptDirectory,
  'direct-c-transition-policy.json',
)

export function createDirectCInitialPolicy() {
  return {
    schema: 1,
    channel: 'stable',
    currentVersion: DIRECT_C_CURRENT.version,
    legacyBridgeVersion: null,
    paused: false,
    completedPhases: [],
    releases: {},
    transitions: {},
    phaseMilestones: {},
    stableCyclesAfterB: [],
  }
}

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
}

function requireObject(value, description) {
  if (!isPlainObject(value)) throw new Error(`${description} must be an object`)
  return value
}

function exactKeys(value, expected, description) {
  requireObject(value, description)
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (
    actual.length !== wanted.length
    || actual.some((key, index) => key !== wanted[index])
  ) {
    throw new Error(
      `${description} keys must be exactly ${wanted.join(', ')}; found ${actual.join(', ') || '(none)'}`,
    )
  }
}

function exactJson(actual, expected, description) {
  if (!isDeepStrictEqual(actual, expected)) {
    throw new Error(`${description} does not match the reviewed DIRECT_C policy`)
  }
}

function requireSha256(value, description) {
  if (!/^[0-9a-f]{64}$/.test(value ?? '')) {
    throw new Error(`${description} must be a lowercase SHA-256`)
  }
}

function requireCommit(value, description) {
  if (!/^[0-9a-f]{40}$/.test(value ?? '')) {
    throw new Error(`${description} must be a lowercase full commit SHA`)
  }
}

function requireCanonicalTimestamp(value, description) {
  const parsed = new Date(value)
  if (
    typeof value !== 'string'
    || Number.isNaN(parsed.valueOf())
    || parsed.toISOString() !== value
  ) {
    throw new Error(`${description} must be canonical ISO-8601`)
  }
}

function requireExactStringSet(actual, expected, description) {
  if (!Array.isArray(actual) || actual.some((value) => typeof value !== 'string')) {
    throw new Error(`${description} must be an array of strings`)
  }
  const unique = [...new Set(actual)]
  if (
    unique.length !== actual.length
    || JSON.stringify(unique) !== JSON.stringify(expected)
  ) {
    throw new Error(`${description} must be exactly ${expected.join(', ')}`)
  }
}

function validateApprovedNext(value) {
  exactKeys(
    value,
    [
      'version',
      'tag',
      'sourceCommit',
      'migrationPhase',
      'dataSchema',
      'manifestKey',
      'manifestSha256',
      'requiredPlatforms',
    ],
    'DIRECT_C approvedNext',
  )
  if (value.version !== '0.6.647' || value.tag !== 'v0.6.647') {
    throw new Error('DIRECT_C approvedNext must be exact version v0.6.647')
  }
  if (value.migrationPhase !== 'C' || value.dataSchema !== 3) {
    throw new Error('DIRECT_C approvedNext must attest migration phase C/data schema 3')
  }
  if (value.manifestKey !== 'biyan/updater/releases/v0.6.647/latest.json') {
    throw new Error('DIRECT_C approvedNext manifestKey is not canonical')
  }
  requireCommit(value.sourceCommit, 'DIRECT_C approvedNext sourceCommit')
  if (value.sourceCommit !== DIRECT_C_TARGET_SOURCE_COMMIT) {
    throw new Error(
      `DIRECT_C approvedNext sourceCommit must be exact ${DIRECT_C_TARGET_SOURCE_COMMIT}`,
    )
  }
  requireSha256(value.manifestSha256, 'DIRECT_C approvedNext manifestSha256')
  requireExactStringSet(
    value.requiredPlatforms,
    DIRECT_C_CANONICAL_UPDATER_PLATFORMS,
    'DIRECT_C approvedNext requiredPlatforms',
  )
  return structuredClone(value)
}

export function validateDirectCTransitionPolicy(
  value,
  { requireApprovedNext = false } = {},
) {
  exactKeys(
    value,
    [
      'schema',
      'state',
      'deploymentMode',
      'current',
      'routerSources',
      'approvedNext',
      'requiredPlatforms',
      'requiredScenarios',
    ],
    'DIRECT_C transition policy',
  )
  if (
    value.schema !== 1
    || value.state !== 'pre-direct-c'
    || value.deploymentMode !== 'direct-c'
  ) {
    throw new Error('DIRECT_C transition policy schema/state/mode is invalid')
  }
  exactJson(value.current, DIRECT_C_CURRENT, 'DIRECT_C current')
  exactJson(value.routerSources, DIRECT_C_ROUTER_SOURCES, 'DIRECT_C routerSources')
  requireExactStringSet(
    value.requiredPlatforms,
    DIRECT_C_REQUIRED_PLATFORMS,
    'DIRECT_C requiredPlatforms',
  )
  requireExactStringSet(
    value.requiredScenarios,
    DIRECT_C_REQUIRED_SCENARIOS,
    'DIRECT_C requiredScenarios',
  )
  if (value.approvedNext === null) {
    if (requireApprovedNext) {
      throw new Error('DIRECT_C approvedNext is still fail-closed')
    }
  } else {
    validateApprovedNext(value.approvedNext)
  }
  return structuredClone(value)
}

export function loadDirectCTransitionPolicy(
  file = DIRECT_C_POLICY_FILE,
  options = {},
) {
  return validateDirectCTransitionPolicy(
    JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')),
    options,
  )
}

export function validateApprovedDirectCTransition({
  policy,
  candidate,
  currentPolicy,
  nextPolicy,
}) {
  const tracked = validateDirectCTransitionPolicy(policy, {
    requireApprovedNext: true,
  })
  const approved = tracked.approvedNext
  const candidateIdentity = {
    version: candidate?.version,
    tag: candidate?.tag,
    sourceCommit: candidate?.sourceCommit,
    migrationPhase: candidate?.migrationPhase,
    dataSchema: candidate?.dataSchema,
    manifestKey: candidate?.manifestKey,
    manifestSha256: candidate?.manifestSha256,
  }
  exactJson(
    candidateIdentity,
    {
      version: approved.version,
      tag: approved.tag,
      sourceCommit: approved.sourceCommit,
      migrationPhase: approved.migrationPhase,
      dataSchema: approved.dataSchema,
      manifestKey: approved.manifestKey,
      manifestSha256: approved.manifestSha256,
    },
    'DIRECT_C candidate',
  )

  exactKeys(
    currentPolicy,
    Object.keys(createDirectCInitialPolicy()),
    'DIRECT_C current policy',
  )
  if (
    currentPolicy?.schema !== 1
    || currentPolicy?.channel !== 'stable'
    || currentPolicy.currentVersion !== tracked.current.version
    || (currentPolicy.legacyBridgeVersion ?? null) !== null
    || currentPolicy.paused !== false
    || currentPolicy.deploymentMode !== undefined
    || (currentPolicy.completedPhases?.length ?? 0) !== 0
    || Object.keys(currentPolicy.releases ?? {}).length !== 0
    || Object.keys(currentPolicy.transitions ?? {}).length !== 0
    || Object.keys(currentPolicy.phaseMilestones ?? {}).length !== 0
    || (currentPolicy.stableCyclesAfterB?.length ?? 0) !== 0
  ) {
    throw new Error('DIRECT_C requires the exact untouched pre-promotion policy')
  }

  exactKeys(
    nextPolicy,
    [
      'schema',
      'channel',
      'deploymentMode',
      'currentVersion',
      'legacyBridgeVersion',
      'legacyPauseFallback',
      'paused',
      'completedPhases',
      'releases',
      'transitions',
      'phaseMilestones',
      'stableCyclesAfterB',
    ],
    'DIRECT_C next policy',
  )
  if (
    nextPolicy?.schema !== 1
    || nextPolicy?.channel !== 'stable'
    || nextPolicy.deploymentMode !== 'direct-c'
    || nextPolicy.currentVersion !== approved.version
    || nextPolicy.legacyBridgeVersion !== approved.version
    || nextPolicy.paused !== false
  ) {
    throw new Error('DIRECT_C next policy identity is invalid')
  }
  exactKeys(
    nextPolicy.legacyPauseFallback,
    ['version', 'manifestSha256', 'transactionId', 'backups'],
    'DIRECT_C legacy pause fallback',
  )
  exactKeys(
    nextPolicy.legacyPauseFallback.backups,
    ['oss', 'r2'],
    'DIRECT_C legacy pause fallback backups',
  )
  const fallbackTransactionId =
    nextPolicy.legacyPauseFallback.transactionId
  if (
    nextPolicy.legacyPauseFallback.version !== tracked.current.version
    || nextPolicy.legacyPauseFallback.manifestSha256
      !== tracked.current.manifestSha256
    || !/^[1-9][0-9]*-[1-9][0-9]*$/.test(fallbackTransactionId ?? '')
    || nextPolicy.legacyPauseFallback.backups.oss
      !== `biyan/updater/transactions/${fallbackTransactionId}/backups/legacy-oss.json`
    || nextPolicy.legacyPauseFallback.backups.r2
      !== `biyan/updater/transactions/${fallbackTransactionId}/backups/legacy-r2.json`
  ) {
    throw new Error('DIRECT_C legacy pause fallback is not the exact immutable current backup')
  }

  const expectedReleaseVersions = [
    ...Object.keys(tracked.routerSources),
    approved.version,
  ].sort()
  const actualReleaseVersions = Object.keys(nextPolicy.releases ?? {}).sort()
  if (JSON.stringify(actualReleaseVersions) !== JSON.stringify(expectedReleaseVersions)) {
    throw new Error('DIRECT_C next policy release set is not exact')
  }

  for (const [version, source] of Object.entries(tracked.routerSources)) {
    const release = nextPolicy.releases[version]
    const expectedRelease = {
      phase: source.migrationPhase,
      effectivePhase: source.migrationPhase,
      tag: source.tag,
      sourceCommit: source.sourceCommit,
      dataSchema: source.dataSchema,
      manifestKey: source.manifestKey,
      manifestSha256: source.manifestSha256,
    }
    exactJson(release, expectedRelease, `DIRECT_C source release ${version}`)
    const transition = nextPolicy.transitions?.[version]
    exactKeys(
      transition,
      [
        'to',
        'phase',
        'rollout',
        'manifestKey',
        'rolloutChangedAt',
        'rolloutHistory',
      ],
      `DIRECT_C transition ${version}`,
    )
    if (
      transition.to !== approved.version
      || transition.phase !== 'DIRECT_C'
      || transition.rollout !== 100
      || transition.manifestKey !== approved.manifestKey
    ) {
      throw new Error(`DIRECT_C transition ${version} does not target approvedNext at 100%`)
    }
    requireCanonicalTimestamp(
      transition.rolloutChangedAt,
      `DIRECT_C transition ${version} rolloutChangedAt`,
    )
    exactJson(
      transition.rolloutHistory,
      [{ percentage: 100, at: transition.rolloutChangedAt }],
      `DIRECT_C transition ${version} rolloutHistory`,
    )
  }
  if (Object.keys(nextPolicy.transitions ?? {}).length !== 3) {
    throw new Error('DIRECT_C next policy must contain exactly three Router transitions')
  }
  const target = nextPolicy.releases[approved.version]
  exactKeys(
    target,
    [
      'phase',
      'effectivePhase',
      'tag',
      'sourceCommit',
      'dataSchema',
      'manifestKey',
      'manifestSha256',
      'promotedAt',
      'lastPromotedAt',
      'smokeEvidenceSha256',
      'healthEvidenceSha256',
    ],
    'DIRECT_C target release',
  )
  if (
    target?.phase !== 'DIRECT_C'
    || target?.effectivePhase !== 'C'
    || target?.tag !== approved.tag
    || target?.sourceCommit !== approved.sourceCommit
    || target?.dataSchema !== 3
    || target?.manifestKey !== approved.manifestKey
    || target?.manifestSha256 !== approved.manifestSha256
  ) {
    throw new Error('DIRECT_C target release does not match approvedNext')
  }
  requireCanonicalTimestamp(target.promotedAt, 'DIRECT_C target promotedAt')
  if (target.lastPromotedAt !== target.promotedAt) {
    throw new Error('DIRECT_C target timestamps must be identical')
  }
  requireSha256(
    target.smokeEvidenceSha256,
    'DIRECT_C target smokeEvidenceSha256',
  )
  requireSha256(
    target.healthEvidenceSha256,
    'DIRECT_C target healthEvidenceSha256',
  )
  if (
    JSON.stringify(nextPolicy.completedPhases) !== JSON.stringify(['C'])
    || !isDeepStrictEqual(nextPolicy.phaseMilestones, {
      C: {
        fullAt: target.promotedAt,
        version: approved.version,
      },
    })
    || !isDeepStrictEqual(nextPolicy.stableCyclesAfterB, [])
  ) {
    throw new Error('DIRECT_C completion milestone is invalid')
  }
  return {
    currentVersion: tracked.current.version,
    targetVersion: approved.version,
    routerSources: Object.keys(tracked.routerSources),
  }
}
