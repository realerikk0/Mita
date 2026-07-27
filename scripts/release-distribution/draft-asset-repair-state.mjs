#!/usr/bin/env node

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const COMMIT = /^[0-9a-f]{40}$/
const DIGEST = /^sha256:[0-9a-f]{64}$/
const HEX_DIGEST = /^[0-9a-f]{64}$/
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\[bot\])?$/
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const TAG = /^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/
const RELEASE_NAME = 'Biyan v0.6.643'
const RELEASE_BODY_SHA256 =
  'd87e2105473786d9b0277ed05eb466c8cd5e14e28b89c13ffd10b3d3ca801c52'
const MAX_JSON_BYTES = 16 * 1024 * 1024
const ITEM_STATES = Object.freeze([
  'initial',
  'staged',
  'backup',
  'swapped',
  'committed',
])
const NEXT_ACTIONS = Object.freeze([
  'stage',
  'rename-old-to-backup',
  'rename-stage-to-canonical',
  'delete-backup',
  'none',
])

function fail(message) {
  throw new Error(message)
}

function record(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object`)
  }
  return value
}

function exactKeys(value, expected, label) {
  const object = record(value, label)
  const actualKeys = Object.keys(object).sort()
  const expectedKeys = [...expected].sort()
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    fail(`${label} has unexpected fields`)
  }
  return object
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail(`${label} must be a positive safe integer`)
  }
  return value
}

function positiveSize(value, label) {
  return positiveInteger(value, label)
}

function digest(value, label) {
  if (typeof value !== 'string' || !DIGEST.test(value)) {
    fail(`${label} must be a lowercase sha256 digest`)
  }
  return value
}

function assetName(value, label) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 255 ||
    value === '.' ||
    value === '..' ||
    /[\u0000-\u001f\u007f/\\]/.test(value)
  ) {
    fail(`${label} must be a safe GitHub release asset name`)
  }
  return value
}

function timestamp(value, label) {
  if (
    typeof value !== 'string' ||
    !TIMESTAMP.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    fail(`${label} must be a valid ISO-8601 UTC timestamp`)
  }
  return value
}

function authorIdentity(value, label) {
  const author = exactKeys(value, ['id', 'login', 'type'], label)
  const id = positiveInteger(author.id, `${label}.id`)
  if (typeof author.login !== 'string' || !LOGIN.test(author.login)) {
    fail(`${label}.login must be a canonical GitHub user or bot login`)
  }
  if (author.type !== 'User' && author.type !== 'Bot') {
    fail(`${label}.type must be "User" or "Bot"`)
  }
  return {
    id,
    login: author.login,
    type: author.type,
  }
}

function requireExact(actual, expected, label) {
  if (actual !== expected) {
    fail(`${label} must be ${JSON.stringify(expected)}`)
  }
}

function validatePlannedAssetIdentity(value, label, includeId) {
  const expectedKeys = includeId ? ['id', 'size', 'digest'] : ['size', 'digest']
  const identity = exactKeys(value, expectedKeys, label)
  const normalized = {
    size: positiveSize(identity.size, `${label}.size`),
    digest: digest(identity.digest, `${label}.digest`),
  }
  if (includeId) {
    normalized.id = positiveInteger(identity.id, `${label}.id`)
  }
  return normalized
}

export function validateDraftAssetRepairPlan(value) {
  const plan = exactKeys(
    value,
    [
      'schema',
      'repository',
      'workflowSha',
      'release',
      'preserve',
      'replacements',
    ],
    'plan'
  )
  requireExact(plan.schema, 2, 'plan.schema')
  if (
    typeof plan.repository !== 'string' ||
    !REPOSITORY.test(plan.repository)
  ) {
    fail('plan.repository must use the OWNER/REPO format')
  }
  if (typeof plan.workflowSha !== 'string' || !COMMIT.test(plan.workflowSha)) {
    fail('plan.workflowSha must be a lowercase 40-character commit')
  }

  const release = exactKeys(
    plan.release,
    [
      'id',
      'tag',
      'targetCommit',
      'name',
      'bodySha256',
      'createdAt',
      'author',
      'draft',
      'prerelease',
      'publishedAt',
    ],
    'plan.release'
  )
  positiveInteger(release.id, 'plan.release.id')
  if (typeof release.tag !== 'string' || !TAG.test(release.tag)) {
    fail('plan.release.tag must be a canonical stable release tag')
  }
  if (
    typeof release.targetCommit !== 'string' ||
    !COMMIT.test(release.targetCommit)
  ) {
    fail('plan.release.targetCommit must be a lowercase 40-character commit')
  }
  requireExact(release.name, RELEASE_NAME, 'plan.release.name')
  if (
    typeof release.bodySha256 !== 'string' ||
    !HEX_DIGEST.test(release.bodySha256)
  ) {
    fail('plan.release.bodySha256 must be a lowercase sha256 digest')
  }
  requireExact(
    release.bodySha256,
    RELEASE_BODY_SHA256,
    'plan.release.bodySha256'
  )
  timestamp(release.createdAt, 'plan.release.createdAt')
  const author = authorIdentity(release.author, 'plan.release.author')
  requireExact(release.draft, true, 'plan.release.draft')
  requireExact(release.prerelease, false, 'plan.release.prerelease')
  timestamp(release.publishedAt, 'plan.release.publishedAt')

  if (!Array.isArray(plan.preserve) || plan.preserve.length !== 8) {
    fail('plan.preserve must contain exactly eight entries')
  }
  if (!Array.isArray(plan.replacements) || plan.replacements.length !== 5) {
    fail('plan.replacements must contain exactly five entries')
  }

  const reservedNames = new Set()
  const reservedIds = new Set()
  const preserve = plan.preserve.map((value, index) => {
    const label = `plan.preserve[${index}]`
    const entry = exactKeys(value, ['id', 'name', 'size', 'digest'], label)
    const normalized = {
      id: positiveInteger(entry.id, `${label}.id`),
      name: assetName(entry.name, `${label}.name`),
      size: positiveSize(entry.size, `${label}.size`),
      digest: digest(entry.digest, `${label}.digest`),
    }
    if (reservedIds.has(normalized.id)) {
      fail(`${label}.id is duplicated`)
    }
    if (reservedNames.has(normalized.name)) {
      fail(`${label}.name is duplicated`)
    }
    reservedIds.add(normalized.id)
    reservedNames.add(normalized.name)
    return normalized
  })

  const replacements = plan.replacements.map((value, index) => {
    const label = `plan.replacements[${index}]`
    const entry = exactKeys(
      value,
      ['name', 'old', 'new', 'stagingName', 'backupName'],
      label
    )
    const normalized = {
      name: assetName(entry.name, `${label}.name`),
      old: validatePlannedAssetIdentity(entry.old, `${label}.old`, true),
      new: validatePlannedAssetIdentity(entry.new, `${label}.new`, false),
      stagingName: assetName(entry.stagingName, `${label}.stagingName`),
      backupName: assetName(entry.backupName, `${label}.backupName`),
    }
    if (normalized.old.digest === normalized.new.digest) {
      fail(`${label}.old and .new must have different digests`)
    }
    if (reservedIds.has(normalized.old.id)) {
      fail(`${label}.old.id is duplicated`)
    }
    reservedIds.add(normalized.old.id)
    for (const [kind, name] of [
      ['name', normalized.name],
      ['stagingName', normalized.stagingName],
      ['backupName', normalized.backupName],
    ]) {
      if (reservedNames.has(name)) {
        fail(`${label}.${kind} is duplicated`)
      }
      reservedNames.add(name)
    }
    return normalized
  })

  return {
    schema: 2,
    repository: plan.repository,
    workflowSha: plan.workflowSha,
    release: {
      id: release.id,
      tag: release.tag,
      targetCommit: release.targetCommit,
      name: RELEASE_NAME,
      bodySha256: RELEASE_BODY_SHA256,
      createdAt: release.createdAt,
      author,
      draft: true,
      prerelease: false,
      publishedAt: release.publishedAt,
    },
    preserve,
    replacements,
  }
}

function validateLiveAsset(value, index) {
  const label = `release.assets[${index}]`
  const asset = record(value, label)
  const id = positiveInteger(asset.id, `${label}.id`)
  const name = assetName(asset.name, `${label}.name`)
  if (asset.state === 'starter') {
    requireExact(asset.size, 0, `${label}.size`)
    requireExact(asset.digest, null, `${label}.digest`)
    return {
      id,
      name,
      size: 0,
      digest: null,
      state: 'starter',
    }
  }
  requireExact(asset.state, 'uploaded', `${label}.state`)
  return {
    id,
    name,
    size: positiveSize(asset.size, `${label}.size`),
    digest: digest(asset.digest, `${label}.digest`),
    state: 'uploaded',
  }
}

function validateLiveRelease(value, plan) {
  const release = record(value, 'release')
  requireExact(release.id, plan.release.id, 'release.id')
  requireExact(release.tag_name, plan.release.tag, 'release.tag_name')
  requireExact(
    release.target_commitish,
    plan.release.targetCommit,
    'release.target_commitish'
  )
  requireExact(release.name, plan.release.name, 'release.name')
  if (typeof release.body !== 'string') {
    fail('release.body must be a string')
  }
  const bodySha256 = createHash('sha256').update(release.body).digest('hex')
  requireExact(bodySha256, plan.release.bodySha256, 'release.bodySha256')
  requireExact(release.created_at, plan.release.createdAt, 'release.created_at')
  const author = record(release.author, 'release.author')
  requireExact(author.id, plan.release.author.id, 'release.author.id')
  requireExact(author.login, plan.release.author.login, 'release.author.login')
  requireExact(author.type, plan.release.author.type, 'release.author.type')
  requireExact(release.draft, plan.release.draft, 'release.draft')
  requireExact(
    release.prerelease,
    plan.release.prerelease,
    'release.prerelease'
  )
  requireExact(
    release.published_at,
    plan.release.publishedAt,
    'release.published_at'
  )
  requireExact(release.immutable, false, 'release.immutable')

  const releaseApi = `https://api.github.com/repos/${plan.repository}/releases/${plan.release.id}`
  requireExact(release.url, releaseApi, 'release.url')
  requireExact(release.assets_url, `${releaseApi}/assets`, 'release.assets_url')
  if (!Array.isArray(release.assets)) {
    fail('release.assets must be an array')
  }

  const assets = release.assets.map(validateLiveAsset)
  const ids = new Set()
  const names = new Set()
  for (const asset of assets) {
    if (ids.has(asset.id)) {
      fail(`release asset ID ${asset.id} is duplicated`)
    }
    if (names.has(asset.name)) {
      fail(`release asset name ${JSON.stringify(asset.name)} is duplicated`)
    }
    ids.add(asset.id)
    names.add(asset.name)
  }
  return assets
}

function sameIdentity(asset, expected, expectedId) {
  return (
    asset !== undefined &&
    asset.state === 'uploaded' &&
    (expectedId === undefined || asset.id === expectedId) &&
    asset.size === expected.size &&
    asset.digest === expected.digest
  )
}

function itemOutput(entry, state, canonical, staged, backup) {
  const uploadedStaged = staged?.state === 'uploaded' ? staged : undefined
  const starter = staged?.state === 'starter' ? staged : undefined
  return {
    name: entry.name,
    state,
    canonicalId: canonical?.id ?? null,
    stagingId: uploadedStaged?.id ?? null,
    starterId: starter?.id ?? null,
    backupId: backup?.id ?? null,
    assetIds: {
      canonical: canonical?.id ?? null,
      staging: uploadedStaged?.id ?? null,
      starter: starter?.id ?? null,
      backup: backup?.id ?? null,
    },
  }
}

function classifyReplacement(entry, byName, reservedIds) {
  const canonical = byName.get(entry.name)
  const staged = byName.get(entry.stagingName)
  const backup = byName.get(entry.backupName)
  const canonicalOld = sameIdentity(canonical, entry.old, entry.old.id)
  const canonicalNew = sameIdentity(canonical, entry.new)
  const stagedNew = sameIdentity(staged, entry.new)
  const stagedStarter = staged?.state === 'starter'
  const backupOld = sameIdentity(backup, entry.old, entry.old.id)

  for (const asset of [canonicalNew && canonical, stagedNew && staged]) {
    if (asset && reservedIds.has(asset.id)) {
      fail(
        `replacement ${JSON.stringify(entry.name)} reuses reserved asset ID ${asset.id}`
      )
    }
  }

  if (canonicalOld && !staged && !backup) {
    return itemOutput(entry, 'initial', canonical, staged, backup)
  }
  if (canonicalOld && stagedStarter && !backup) {
    return itemOutput(entry, 'initial', canonical, staged, backup)
  }
  if (canonicalOld && stagedNew && !backup) {
    return itemOutput(entry, 'staged', canonical, staged, backup)
  }
  if (!canonical && stagedNew && backupOld) {
    return itemOutput(entry, 'backup', canonical, staged, backup)
  }
  if (canonicalNew && !staged && backupOld) {
    return itemOutput(entry, 'swapped', canonical, staged, backup)
  }
  if (canonicalNew && !staged && !backup) {
    return itemOutput(entry, 'committed', canonical, staged, backup)
  }

  fail(`replacement ${JSON.stringify(entry.name)} has an unsafe asset state`)
}

function nextMutation(plan, replacements, phaseIndex) {
  const starterIndexes = replacements.flatMap((replacement, index) =>
    replacement.starterId === null ? [] : [index]
  )
  if (starterIndexes.length > 0) {
    const currentIndex = replacements.findIndex(
      ({ state }) => state === 'initial'
    )
    if (
      phaseIndex !== 0 ||
      starterIndexes.length !== 1 ||
      starterIndexes[0] !== currentIndex
    ) {
      fail(
        'only the exact current next staging asset may remain in starter state'
      )
    }
    const index = starterIndexes[0]
    const entry = plan.replacements[index]
    const classified = replacements[index]
    return {
      action: 'delete-starter-stage',
      replacement: entry.name,
      assetId: classified.starterId,
      fromName: entry.stagingName,
      toName: null,
    }
  }
  if (phaseIndex === ITEM_STATES.length - 1) {
    return {
      action: NEXT_ACTIONS[phaseIndex],
      replacement: null,
      assetId: null,
      fromName: null,
      toName: null,
    }
  }
  const currentState = ITEM_STATES[phaseIndex]
  const index = replacements.findIndex(({ state }) => state === currentState)
  if (index < 0) {
    fail(`repair phase ${currentState} has no resumable replacement`)
  }
  const entry = plan.replacements[index]
  const classified = replacements[index]
  if (phaseIndex === 0) {
    return {
      action: NEXT_ACTIONS[phaseIndex],
      replacement: entry.name,
      assetId: null,
      fromName: null,
      toName: entry.stagingName,
    }
  }
  if (phaseIndex === 1) {
    return {
      action: NEXT_ACTIONS[phaseIndex],
      replacement: entry.name,
      assetId: classified.assetIds.canonical,
      fromName: entry.name,
      toName: entry.backupName,
    }
  }
  if (phaseIndex === 2) {
    return {
      action: NEXT_ACTIONS[phaseIndex],
      replacement: entry.name,
      assetId: classified.assetIds.staging,
      fromName: entry.stagingName,
      toName: entry.name,
    }
  }
  return {
    action: NEXT_ACTIONS[phaseIndex],
    replacement: entry.name,
    assetId: classified.assetIds.backup,
    fromName: entry.backupName,
    toName: null,
  }
}

export function classifyDraftAssetRepairState(planValue, releaseValue) {
  const plan = validateDraftAssetRepairPlan(planValue)
  const assets = validateLiveRelease(releaseValue, plan)
  const byName = new Map(assets.map((asset) => [asset.name, asset]))
  const allowedNames = new Set(plan.preserve.map(({ name }) => name))
  for (const entry of plan.replacements) {
    allowedNames.add(entry.name)
    allowedNames.add(entry.stagingName)
    allowedNames.add(entry.backupName)
  }
  for (const asset of assets) {
    if (!allowedNames.has(asset.name)) {
      fail(`unknown release asset ${JSON.stringify(asset.name)}`)
    }
  }

  for (const expected of plan.preserve) {
    const actual = byName.get(expected.name)
    if (
      !sameIdentity(actual, expected, expected.id) ||
      actual?.name !== expected.name
    ) {
      fail(
        `preserved asset ${JSON.stringify(expected.name)} does not match plan`
      )
    }
  }

  const reservedIds = new Set([
    ...plan.preserve.map(({ id }) => id),
    ...plan.replacements.map(({ old }) => old.id),
  ])
  const replacements = plan.replacements.map((entry) =>
    classifyReplacement(entry, byName, reservedIds)
  )
  const ranks = replacements.map(({ state }) => ITEM_STATES.indexOf(state))
  for (let index = 1; index < ranks.length; index += 1) {
    if (ranks[index - 1] < ranks[index]) {
      fail('replacement states are not a monotonic plan-order prefix')
    }
  }
  const minimum = Math.min(...ranks)
  const maximum = Math.max(...ranks)
  if (maximum - minimum > 1) {
    fail('replacement states cross more than one repair phase')
  }

  return {
    schema: 2,
    repository: plan.repository,
    workflowSha: plan.workflowSha,
    release: { ...plan.release },
    state: ITEM_STATES[minimum],
    phase: ITEM_STATES[minimum],
    inProgress: minimum !== maximum,
    preservedAssets: plan.preserve.map(({ id, name }) => ({ id, name })),
    replacements,
    next: nextMutation(plan, replacements, minimum),
  }
}

function parseArgs(argv) {
  const supported = new Set(['--plan', '--release', '--output'])
  const values = new Map()
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (!supported.has(argument)) {
      fail(`Unexpected argument: ${argument ?? 'missing'}`)
    }
    if (values.has(argument)) {
      fail(`Duplicate argument: ${argument}`)
    }
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) {
      fail(`Missing value for ${argument}`)
    }
    values.set(argument, value)
    index += 1
  }
  for (const argument of supported) {
    if (!values.has(argument)) {
      fail(`Missing argument: ${argument}`)
    }
  }
  return Object.fromEntries(
    [...values].map(([key, value]) => [key.slice(2), value])
  )
}

function readJson(relativePath, label) {
  const absolute = path.resolve(relativePath)
  const stats = fs.statSync(absolute)
  if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_JSON_BYTES) {
    fail(
      `${label} must be a non-empty JSON file no larger than ${MAX_JSON_BYTES} bytes`
    )
  }
  return JSON.parse(fs.readFileSync(absolute, 'utf8'))
}

function main(argv) {
  const options = parseArgs(argv)
  const result = classifyDraftAssetRepairState(
    readJson(options.plan, 'repair plan'),
    readJson(options.release, 'live release')
  )
  const output = path.resolve(options.output)
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

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

if (isDirectExecution()) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    )
    process.exitCode = 1
  }
}
