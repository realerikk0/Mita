#!/usr/bin/env node

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

import {
  createDirectCInitialPolicy,
  DIRECT_C_ROUTER_SOURCES,
  loadDirectCTransitionPolicy,
  validateApprovedDirectCTransition,
} from './direct-c-transition-policy.mjs'

export const OPEN_TRANSACTION_KEY =
  'biyan/updater/transactions/open.json'
export const TRANSACTION_PREFIX = 'biyan/updater/transactions'
export const TRUSTED_HEALTH_EVIDENCE_ORIGIN = 'https://static.mitapp.cn'
export const STABLE_POLICY_KEY = 'biyan/updater/stable/policy.json'
export const FROZEN_LEGACY_MANIFEST_KEY = 'mita/latest.json'
export const JOURNAL_STATES = Object.freeze([
  'prepared',
  'committing',
  'rollback-required',
  'rolled-back',
  'committed',
])

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const RUN_ID_PATTERN = /^[1-9][0-9]*$/

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  )
}

function assertPlainObject(value, description) {
  if (!isPlainObject(value)) throw new Error(`${description} must be an object`)
}

function assertExactKeys(value, expected, description) {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    throw new Error(
      `${description} keys must be exactly ${wanted.join(', ')}; found ${
        actual.join(', ') || '(none)'
      }`
    )
  }
}

function readJson(file, description = file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(
      `${description} is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}

function readJsonBytes(file, description = file) {
  const bytes = fs.readFileSync(file)
  try {
    return { bytes, value: JSON.parse(bytes.toString('utf8')) }
  } catch (error) {
    throw new Error(
      `${description} is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function parseJsonBuffer(bytes, description) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
    throw new Error(`${description} bytes must be nonempty`)
  }
  try {
    const value = JSON.parse(bytes.toString('utf8'))
    assertPlainObject(value, description)
    return value
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`${description} is not valid JSON`)
    }
    throw error
  }
}

/**
 * Prove that a promotion leaves the final legacy handoff byte-for-byte frozen.
 * These two endpoints are read-only retirement invariants: promotion, pause,
 * and recovery code may verify them but must never rewrite them.
 */
export function validateFrozenLegacyInvariant({
  currentPolicyBytes,
  nextPolicyBytes,
  ossLegacyBytes,
  r2LegacyBytes,
}) {
  const currentPolicy = parseJsonBuffer(
    currentPolicyBytes,
    'Current updater policy'
  )
  const nextPolicy = parseJsonBuffer(nextPolicyBytes, 'Next updater policy')
  if (
    currentPolicy.schema !== 1 ||
    currentPolicy.channel !== 'stable' ||
    nextPolicy.schema !== 1 ||
    nextPolicy.channel !== 'stable'
  ) {
    throw new Error('Frozen legacy invariant requires stable schema-1 policies')
  }
  const version = currentPolicy.legacyBridgeVersion
  assertVersion(version, 'Frozen legacy bridge version')
  if (nextPolicy.legacyBridgeVersion !== version) {
    throw new Error('Next policy must preserve the frozen legacy bridge version')
  }
  const currentRelease = currentPolicy.releases?.[version]
  const nextRelease = nextPolicy.releases?.[version]
  if (!isPlainObject(currentRelease) || !isPlainObject(nextRelease)) {
    throw new Error('Frozen legacy release must remain present in both policies')
  }
  const expectedManifestKey =
    `biyan/updater/releases/v${version}/latest.json`
  if (currentRelease.manifestKey !== expectedManifestKey) {
    throw new Error('Frozen legacy release manifestKey is not canonical')
  }
  assertSha256(
    currentRelease.manifestSha256,
    'Frozen legacy manifestSha256'
  )
  if (
    nextRelease.manifestSha256 !== currentRelease.manifestSha256 ||
    nextRelease.manifestKey !== currentRelease.manifestKey
  ) {
    throw new Error('Next policy must preserve the frozen legacy release identity')
  }
  if (
    !Buffer.isBuffer(ossLegacyBytes) ||
    !Buffer.isBuffer(r2LegacyBytes) ||
    !ossLegacyBytes.equals(r2LegacyBytes)
  ) {
    throw new Error('Frozen OSS and R2 legacy manifests must be byte-identical')
  }
  const manifestSha256 = sha256Bytes(ossLegacyBytes)
  if (manifestSha256 !== currentRelease.manifestSha256) {
    throw new Error('Frozen legacy endpoint bytes do not match policy digest')
  }
  const manifest = parseJsonBuffer(ossLegacyBytes, 'Frozen legacy manifest')
  if (manifest.version !== version) {
    throw new Error(`Frozen legacy manifest version must be exactly ${version}`)
  }
  return {
    schema: 1,
    kind: 'frozen-legacy-handoff',
    version,
    manifestKey: currentRelease.manifestKey,
    manifestSha256,
  }
}

export function validateHealthEvidenceUrl(value, expectedSha256) {
  assertSha256(expectedSha256, 'Health evidence SHA-256')
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('Health evidence URL must be a valid URL')
  }
  const expectedPath =
    `/biyan/updater/evidence/${expectedSha256}/rollout-health.json`
  if (
    url.origin !== TRUSTED_HEALTH_EVIDENCE_ORIGIN ||
    url.pathname !== expectedPath ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      `Health evidence URL must be exactly ${TRUSTED_HEALTH_EVIDENCE_ORIGIN}${expectedPath}`
    )
  }
  return url.href
}

export function extractR2Etag(metadata) {
  assertPlainObject(metadata, 'R2 object metadata')
  const etag = metadata.ETag ?? metadata.etag
  if (
    typeof etag !== 'string' ||
    !/^"[0-9a-f]{32,64}(?:-[1-9][0-9]*)?"$/i.test(etag)
  ) {
    throw new Error('R2 object metadata has no strict quoted ETag')
  }
  return etag
}

export function classifyPolicyRollback({
  policyExisted,
  originalBytes = null,
  nextBytes,
  liveState,
  liveBytes = null,
}) {
  if (typeof policyExisted !== 'boolean') {
    throw new Error('Policy rollback requires an exact original existence state')
  }
  if (!Buffer.isBuffer(nextBytes) || nextBytes.length === 0) {
    throw new Error('Policy rollback requires nonempty proposed policy bytes')
  }
  if (liveState === 'absent') {
    if (policyExisted) {
      throw new Error(
        'Policy rollback is ambiguous: the original policy disappeared'
      )
    }
    return { action: 'no-change', reason: 'policy-remains-absent' }
  }
  if (liveState !== 'exists' || !Buffer.isBuffer(liveBytes)) {
    throw new Error('Policy rollback live state is not classifiable')
  }
  if (liveBytes.equals(nextBytes)) {
    return { action: 'restore', reason: 'proposed-policy-is-live' }
  }
  if (
    policyExisted &&
    Buffer.isBuffer(originalBytes) &&
    liveBytes.equals(originalBytes)
  ) {
    return { action: 'no-change', reason: 'original-policy-is-live' }
  }
  throw new Error(
    'Policy rollback is ambiguous: live bytes match neither original nor proposed policy'
  )
}

function normalizedMetadata(value) {
  assertPlainObject(value, 'Object metadata')
  const scalars = new Map()
  const customMetadata = {}
  const rootFields = new Map([
    ['cachecontrol', 'cachecontrol'],
    ['contenttype', 'contenttype'],
    ['contentencoding', 'contentencoding'],
    ['contentdisposition', 'contentdisposition'],
    ['contentlanguage', 'contentlanguage'],
    ['expires', 'expires'],
    ['storageclass', 'storageclass'],
  ])
  const headerFields = new Map([
    ['cache-control', 'cachecontrol'],
    ['content-type', 'contenttype'],
    ['content-encoding', 'contentencoding'],
    ['content-disposition', 'contentdisposition'],
    ['content-language', 'contentlanguage'],
    ['expires', 'expires'],
    ['x-amz-storage-class', 'storageclass'],
    ['x-oss-object-type', 'objecttype'],
    ['x-oss-storage-class', 'storageclass'],
  ])
  const ignoredRootFields = new Set([
    'acceptranges',
    'checksumcrc64nvme',
    'contentlength',
    'etag',
    'lastmodified',
  ])
  const ignoredHeaderFields = new Set([
    'accept-ranges',
    'connection',
    'content-length',
    'content-md5',
    'date',
    'etag',
    'last-modified',
    'server',
    'vary',
    'x-oss-hash-crc64ecma',
    'x-oss-request-id',
    'x-oss-server-time',
  ])
  const customContainers = new Set([
    'metadata',
    'custom',
    'custommetadata',
  ])
  const scalarValue = (child, description, arrayValue = false) => {
    const candidate = arrayValue
      ? typeof child === 'string'
        ? child
        : Array.isArray(child) && child.length === 1
          ? child[0]
          : undefined
      : child
    if (typeof candidate !== 'string' || candidate.length === 0) {
      throw new Error(
        arrayValue
          ? `${description} must be a nonempty string or one-element nonempty string array`
          : `${description} must be a nonempty string`
      )
    }
    return candidate
  }
  const recordScalar = (name, child, description, arrayValue = false) => {
    const candidate = scalarValue(child, description, arrayValue)
    const existing = scalars.get(name)
    if (existing !== undefined && existing !== candidate) {
      throw new Error(`Object metadata has conflicting ${name} values`)
    }
    scalars.set(name, candidate)
  }
  const recordCustom = (key, child, arrayValue = false) => {
    const name = key
      .replace(/^x-(?:amz|oss)-meta-/i, '')
      .toLowerCase()
    if (!name) throw new Error('Object custom metadata has an empty key')
    const candidate = scalarValue(
      child,
      `Object custom metadata ${name}`,
      arrayValue
    )
    const existing = customMetadata[name]
    if (existing !== undefined && existing !== candidate) {
      throw new Error(`Object metadata has conflicting custom ${name} values`)
    }
    customMetadata[name] = candidate
  }
  const visitHeader = (header) => {
    assertPlainObject(header, 'Object metadata Header')
    for (const [key, child] of Object.entries(header)) {
      const lower = key.toLowerCase()
      const field = headerFields.get(lower)
      if (field) {
        recordScalar(field, child, `Object metadata Header.${key}`, true)
        continue
      }
      if (/^x-(?:amz|oss)-meta-/i.test(key)) {
        recordCustom(key, child, true)
        continue
      }
      if (ignoredHeaderFields.has(lower)) continue
      throw new Error(`Object metadata Header has unsupported field ${key}`)
    }
  }
  for (const [key, child] of Object.entries(value)) {
    const lower = key.toLowerCase()
    const field = rootFields.get(lower)
    if (field) {
      recordScalar(field, child, `Object metadata ${key}`)
      continue
    }
    if (/^x-(?:amz|oss)-meta-/i.test(key)) {
      recordCustom(key, child)
      continue
    }
    if (customContainers.has(lower)) {
      assertPlainObject(child, `Object metadata ${key}`)
      for (const [customKey, customValue] of Object.entries(child)) {
        recordCustom(customKey, customValue)
      }
      continue
    }
    if (key === 'Header') {
      visitHeader(child)
      continue
    }
    if (ignoredRootFields.has(lower)) continue
    throw new Error(`Object metadata has unsupported field ${key}`)
  }
  const required = (name) => {
    const found = scalars.get(name)
    if (!found) throw new Error(`Object metadata is missing ${name}`)
    return found
  }
  const optional = (name) => scalars.get(name) ?? null
  return {
    cacheControl: required('cachecontrol'),
    contentType: required('contenttype'),
    contentEncoding: optional('contentencoding'),
    contentDisposition: optional('contentdisposition'),
    contentLanguage: optional('contentlanguage'),
    expires: optional('expires'),
    objectType: optional('objecttype'),
    storageClass: optional('storageclass'),
    customMetadata: Object.fromEntries(
      Object.entries(customMetadata).sort(([left], [right]) =>
        left.localeCompare(right)
      )
    ),
  }
}

export function backupMetadataPlan(value) {
  const metadata = normalizedMetadata(value)
  if (
    metadata.contentEncoding !== null ||
    metadata.contentDisposition !== null ||
    metadata.contentLanguage !== null ||
    metadata.expires !== null ||
    ![null, 'Normal'].includes(metadata.objectType) ||
    Object.keys(metadata.customMetadata).length !== 0 ||
    ![null, 'STANDARD', 'Standard'].includes(metadata.storageClass)
  ) {
    throw new Error(
      'Mutable updater object metadata contains unsupported backup fields'
    )
  }
  return {
    contentType: metadata.contentType,
    cacheControl: metadata.cacheControl,
  }
}

const RESTORABLE_OSS_ACLS = new Set(['default', 'private', 'public-read'])

export function extractOssAcl(value) {
  assertPlainObject(value, 'OSS ACL metadata')
  const accessControlList = value.AccessControlList
  if (
    accessControlList !== undefined &&
    !isPlainObject(accessControlList)
  ) {
    throw new Error('OSS ACL metadata AccessControlList must be an object')
  }
  const values = [
    value.acl,
    value.Acl,
    value.objectAcl,
    value.ObjectAcl,
    accessControlList?.Grant,
  ].filter((candidate) => candidate !== undefined)
  if (values.some((candidate) => typeof candidate !== 'string')) {
    throw new Error('OSS ACL metadata contains a non-string approved ACL field')
  }
  const unique = [...new Set(values)]
  if (unique.length !== 1) {
    throw new Error('OSS ACL metadata has no unambiguous ACL')
  }
  const [acl] = unique
  if (!RESTORABLE_OSS_ACLS.has(acl)) {
    throw new Error(`OSS ACL metadata is not safely restorable: ${acl}`)
  }
  return acl
}

export function verifySnapshotReadback({
  snapshot,
  bytes,
  metadata,
  acl = null,
}) {
  validateObjectSnapshot(snapshot, 'Recovery snapshot')
  if (!snapshot.existed) {
    throw new Error('Absent recovery snapshots require an absence probe')
  }
  if (sha256Bytes(bytes) !== snapshot.bytesSha256) {
    throw new Error('Recovery snapshot bytes do not match')
  }
  const expectedMetadata = normalizedMetadata(snapshot.metadata)
  const actualMetadata = normalizedMetadata(metadata)
  if (JSON.stringify(actualMetadata) !== JSON.stringify(expectedMetadata)) {
    throw new Error('Recovery snapshot metadata does not match')
  }
  if (
    snapshot.provider === 'oss' &&
    extractOssAcl(acl) !== extractOssAcl(snapshot.acl)
  ) {
    throw new Error('Recovery snapshot ACL does not match')
  }
  return {
    provider: snapshot.provider,
    key: snapshot.key,
    sha256: snapshot.bytesSha256,
    metadata: actualMetadata,
    acl: snapshot.provider === 'oss' ? extractOssAcl(acl) : null,
  }
}

function assertSha256(value, description) {
  if (!SHA256_PATTERN.test(value ?? '')) {
    throw new Error(`${description} must be a lowercase SHA-256`)
  }
}

function assertVersion(value, description) {
  if (!VERSION_PATTERN.test(value ?? '')) {
    throw new Error(`${description} must be an explicit stable version`)
  }
}

function assertRunIdentity(runId, runAttempt) {
  if (!RUN_ID_PATTERN.test(String(runId ?? ''))) {
    throw new Error('Transaction runId must be a positive GitHub run ID')
  }
  if (!RUN_ID_PATTERN.test(String(runAttempt ?? ''))) {
    throw new Error('Transaction runAttempt must be a positive GitHub run attempt')
  }
}

export function classifyRemoteProbe({
  provider,
  key,
  exitCode,
  stdout = '',
  stderr = '',
}) {
  if (!['r2', 'oss'].includes(provider)) {
    throw new Error(`Unsupported remote probe provider: ${provider}`)
  }
  if (exitCode === 0) {
    return { provider, key, state: 'exists' }
  }
  const detail = `${stdout}\n${stderr}`
  const exactNotFound =
    provider === 'r2'
      ? /(?:\b404\b|NoSuchKey|Not Found)/i.test(detail)
      : /(?:\b404\b|NoSuchKey|SymlinkTargetNotExist|Not Found)/i.test(detail)
  const permissionOrTransportFailure =
    /(?:AccessDenied|Forbidden|InvalidAccessKey|SignatureDoesNotMatch|Unauthorized|timeout|timed out|connection|network|TLS|certificate|\b5\d{2}\b)/i.test(
      detail
    )
  if (exactNotFound && !permissionOrTransportFailure) {
    return { provider, key, state: 'absent' }
  }
  throw new Error(
    `${provider.toUpperCase()} probe for ${key} failed and must not be treated as absent`
  )
}

export function validateApprovedATransition({
  policy,
  candidate,
  manifestBytes,
  currentPolicy,
  nextPolicy,
}) {
  assertPlainObject(policy, 'Approved A transition policy')
  assertExactKeys(
    policy,
    ['schema', 'state', 'current', 'approvedNext'],
    'Approved A transition policy'
  )
  if (policy.schema !== 1 || policy.state !== 'pre-a') {
    throw new Error('Approved A transition policy must be schema 1 in pre-a state')
  }
  assertPlainObject(policy.current, 'Approved A transition current')
  assertExactKeys(
    policy.current,
    ['version', 'manifestSha256'],
    'Approved A transition current'
  )
  assertVersion(policy.current.version, 'Approved A current version')
  assertSha256(
    policy.current.manifestSha256,
    'Approved A current manifestSha256'
  )
  assertPlainObject(policy.approvedNext, 'Approved A transition approvedNext')
  assertExactKeys(
    policy.approvedNext,
    ['version', 'manifestSha256', 'requiredPlatforms'],
    'Approved A transition approvedNext'
  )
  assertVersion(policy.approvedNext.version, 'Approved A next version')
  assertSha256(
    policy.approvedNext.manifestSha256,
    'Approved A next manifestSha256'
  )
  const expectedPlatforms = [
    'darwin-aarch64',
    'darwin-x86_64',
    'windows-x86_64',
    'linux-x86_64',
  ]
  if (
    !Array.isArray(policy.approvedNext.requiredPlatforms) ||
    policy.approvedNext.requiredPlatforms.join('\0') !==
      expectedPlatforms.join('\0')
  ) {
    throw new Error(
      `Approved A requiredPlatforms must be exactly ${expectedPlatforms.join(', ')}`
    )
  }
  if (
    candidate?.migrationPhase !== 'A' ||
    candidate?.dataSchema !== 1 ||
    candidate?.version !== policy.approvedNext.version
  ) {
    throw new Error('Initial A candidate does not match the approved next A identity')
  }
  const manifestSha256 = sha256Bytes(manifestBytes)
  if (
    candidate.manifestSha256 !== manifestSha256 ||
    policy.approvedNext.manifestSha256 !== manifestSha256
  ) {
    throw new Error('Initial A candidate manifest hash is not explicitly approved')
  }
  if (
    (currentPolicy?.legacyBridgeVersion ?? null) !== null ||
    nextPolicy?.legacyBridgeVersion !== candidate.version
  ) {
    throw new Error('Approved A transition requires null -> exact A legacy bridge')
  }
  return {
    version: candidate.version,
    manifestSha256,
    requiredPlatforms: [...expectedPlatforms],
  }
}

function validateObjectSnapshot(snapshot, description) {
  assertPlainObject(snapshot, description)
  assertExactKeys(
    snapshot,
    [
      'provider',
      'key',
      'existed',
      'bytesSha256',
      'metadata',
      'acl',
      'backupKey',
    ],
    description
  )
  if (!['r2', 'oss'].includes(snapshot.provider)) {
    throw new Error(`${description} has an unsupported provider`)
  }
  if (
    typeof snapshot.key !== 'string' ||
    !snapshot.key ||
    snapshot.key.startsWith('/') ||
    snapshot.key.includes('..')
  ) {
    throw new Error(`${description} has an unsafe object key`)
  }
  if (typeof snapshot.existed !== 'boolean') {
    throw new Error(`${description} existed must be boolean`)
  }
  if (snapshot.existed) {
    assertSha256(snapshot.bytesSha256, `${description} bytesSha256`)
    assertPlainObject(snapshot.metadata, `${description} metadata`)
    backupMetadataPlan(snapshot.metadata)
    if (snapshot.provider === 'oss') {
      if (!isPlainObject(snapshot.acl)) {
        throw new Error(`${description} OSS ACL evidence is not restorable`)
      }
      extractOssAcl(snapshot.acl)
    } else if (snapshot.acl !== null) {
      throw new Error(`${description} R2 ACL must be null`)
    }
    if (
      typeof snapshot.backupKey !== 'string' ||
      !snapshot.backupKey.startsWith(`${TRANSACTION_PREFIX}/`)
    ) {
      throw new Error(`${description} backupKey must be transaction-scoped`)
    }
  } else if (
    snapshot.bytesSha256 !== null ||
    snapshot.metadata !== null ||
    snapshot.acl !== null ||
    snapshot.backupKey !== null
  ) {
    throw new Error(`${description} absent snapshot must contain only null state`)
  }
}

export function createJournal({
  runId,
  runAttempt,
  targetTag,
  targetVersion,
  sourceCommit,
  nextPolicyBytes,
  snapshots,
  createdAt,
}) {
  assertRunIdentity(runId, runAttempt)
  if (!/^v\d+\.\d+\.\d+$/.test(targetTag ?? '')) {
    throw new Error('Transaction targetTag must be an explicit stable tag')
  }
  assertVersion(targetVersion, 'Transaction targetVersion')
  if (targetTag !== `v${targetVersion}`) {
    throw new Error('Transaction target tag/version mismatch')
  }
  if (!/^[0-9a-f]{40}$/.test(sourceCommit ?? '')) {
    throw new Error('Transaction sourceCommit must be a lowercase commit SHA')
  }
  if (!Buffer.isBuffer(nextPolicyBytes) || nextPolicyBytes.length === 0) {
    throw new Error('Transaction next policy bytes must be nonempty')
  }
  if (
    !Array.isArray(snapshots) ||
    snapshots.length !== 1 ||
    snapshots[0]?.provider !== 'r2' ||
    snapshots[0]?.key !== STABLE_POLICY_KEY ||
    snapshots[0]?.existed !== true
  ) {
    throw new Error('Router promotion must snapshot only the mutable policy')
  }
  snapshots.forEach((snapshot, index) =>
    validateObjectSnapshot(snapshot, `Transaction snapshot ${index}`)
  )
  const timestamp = new Date(createdAt)
  if (
    Number.isNaN(timestamp.valueOf()) ||
    timestamp.toISOString() !== createdAt
  ) {
    throw new Error('Transaction createdAt must be canonical ISO-8601')
  }
  const transactionId = `${runId}-${runAttempt}`
  if (
    snapshots[0].backupKey !==
      `${TRANSACTION_PREFIX}/${transactionId}/backups/policy.json`
  ) {
    throw new Error('Router promotion policy backup key is not transaction-bound')
  }
  return {
    schema: 3,
    kind: 'router-promotion',
    transactionId,
    runId: String(runId),
    runAttempt: String(runAttempt),
    state: 'prepared',
    targetTag,
    targetVersion,
    sourceCommit,
    nextPolicy: {
      key: `${TRANSACTION_PREFIX}/${transactionId}/next-policy.json`,
      sha256: sha256Bytes(nextPolicyBytes),
    },
    createdAt,
    updatedAt: createdAt,
    sequence: 0,
    snapshots,
    immutableLedger: [],
    checkpoints: [],
    recovery: {
      required: false,
      commandsArtifact: `updater-promotion-${targetTag}-${runId}`,
    },
  }
}

export function validateJournal(journal) {
  assertPlainObject(journal, 'Promotion transaction journal')
  assertExactKeys(
    journal,
    [
      'schema',
      'kind',
      'transactionId',
      'runId',
      'runAttempt',
      'state',
      'targetTag',
      'targetVersion',
      'sourceCommit',
      'nextPolicy',
      'createdAt',
      'updatedAt',
      'sequence',
      'snapshots',
      'immutableLedger',
      'checkpoints',
      'recovery',
    ],
    'Promotion transaction journal'
  )
  if (
    journal.schema !== 3 ||
    journal.kind !== 'router-promotion' ||
    !JOURNAL_STATES.includes(journal.state)
  ) {
    throw new Error('Router promotion journal schema/kind/state is invalid')
  }
  assertRunIdentity(journal.runId, journal.runAttempt)
  if (journal.transactionId !== `${journal.runId}-${journal.runAttempt}`) {
    throw new Error('Promotion transaction journal identity mismatch')
  }
  if (
    journal.snapshots?.[0]?.backupKey !==
      `${TRANSACTION_PREFIX}/${journal.transactionId}/backups/policy.json`
  ) {
    throw new Error('Router promotion policy backup key is not transaction-bound')
  }
  if (
    journal.targetTag !== `v${journal.targetVersion}` ||
    !/^[0-9a-f]{40}$/.test(journal.sourceCommit ?? '')
  ) {
    throw new Error('Promotion transaction target identity is invalid')
  }
  assertPlainObject(journal.nextPolicy, 'Promotion transaction next policy')
  assertExactKeys(
    journal.nextPolicy,
    ['key', 'sha256'],
    'Promotion transaction next policy'
  )
  const expectedNextPolicyKey =
    `${TRANSACTION_PREFIX}/${journal.transactionId}/next-policy.json`
  if (journal.nextPolicy.key !== expectedNextPolicyKey) {
    throw new Error(
      `Promotion transaction next policy key must be ${expectedNextPolicyKey}`
    )
  }
  assertSha256(
    journal.nextPolicy.sha256,
    'Promotion transaction next policy sha256'
  )
  if (!Number.isInteger(journal.sequence) || journal.sequence < 0) {
    throw new Error('Promotion transaction sequence must be nonnegative')
  }
  if (
    !Array.isArray(journal.snapshots) ||
    journal.snapshots.length !== 1 ||
    journal.snapshots[0]?.provider !== 'r2' ||
    journal.snapshots[0]?.key !== STABLE_POLICY_KEY ||
    journal.snapshots[0]?.existed !== true
  ) {
    throw new Error('Router promotion journal must snapshot only the policy')
  }
  journal.snapshots.forEach((snapshot, index) =>
    validateObjectSnapshot(snapshot, `Transaction snapshot ${index}`)
  )
  if (!Array.isArray(journal.immutableLedger)) {
    throw new Error('Promotion immutable ledger must be an array')
  }
  const immutableReleasePrefix =
    `biyan/updater/releases/v${journal.targetVersion}/`
  for (const [index, entry] of journal.immutableLedger.entries()) {
    assertPlainObject(entry, `Promotion immutable ledger ${index}`)
    assertExactKeys(
      entry,
      [
        'provider',
        'key',
        'sha256',
        'contentType',
        'cacheControl',
        'createdByTransaction',
        'verified',
      ],
      `Promotion immutable ledger ${index}`
    )
    if (!['r2', 'oss'].includes(entry.provider)) {
      throw new Error(`Promotion immutable ledger ${index} provider is invalid`)
    }
    if (entry.key === FROZEN_LEGACY_MANIFEST_KEY) {
      throw new Error(
        `Promotion immutable ledger ${index} may never target the frozen legacy manifest`
      )
    }
    const immutableFile =
      typeof entry.key === 'string' && entry.key.startsWith(immutableReleasePrefix)
        ? entry.key.slice(immutableReleasePrefix.length)
        : ''
    if (
      !immutableFile ||
      immutableFile.includes('/') ||
      immutableFile.includes('..') ||
      !/^[0-9A-Za-z][0-9A-Za-z._+-]*$/.test(immutableFile)
    ) {
      throw new Error(
        `Promotion immutable ledger ${index} key must be one canonical file under ${immutableReleasePrefix}`
      )
    }
    assertSha256(entry.sha256, `Promotion immutable ledger ${index} sha256`)
    if (
      !['application/octet-stream', 'text/plain', 'application/json'].includes(
        entry.contentType
      ) ||
      entry.cacheControl !== 'public, max-age=31536000, immutable'
    ) {
      throw new Error(
        `Promotion immutable ledger ${index} metadata is invalid`
      )
    }
    if (
      typeof entry.createdByTransaction !== 'boolean' ||
      typeof entry.verified !== 'boolean'
    ) {
      throw new Error(`Promotion immutable ledger ${index} flags are invalid`)
    }
  }
  if (!Array.isArray(journal.checkpoints)) {
    throw new Error('Promotion transaction checkpoints must be an array')
  }
  assertPlainObject(journal.recovery, 'Promotion transaction recovery')
  assertExactKeys(
    journal.recovery,
    ['required', 'commandsArtifact'],
    'Promotion transaction recovery'
  )
  if (
    typeof journal.recovery.required !== 'boolean' ||
    typeof journal.recovery.commandsArtifact !== 'string' ||
    !journal.recovery.commandsArtifact
  ) {
    throw new Error('Promotion transaction recovery metadata is invalid')
  }
  return journal
}

export function advanceJournal(
  journalInput,
  { state, checkpoint, immutableEntry, updatedAt }
) {
  const journal = structuredClone(validateJournal(journalInput))
  if (!JOURNAL_STATES.includes(state)) {
    throw new Error(`Invalid promotion journal state: ${state}`)
  }
  const allowed = {
    prepared: new Set(['prepared', 'committing', 'rollback-required']),
    committing: new Set(['committing', 'rollback-required', 'committed']),
    'rollback-required': new Set(['rollback-required', 'rolled-back']),
    'rolled-back': new Set(['rolled-back']),
    committed: new Set(['committed']),
  }
  if (!allowed[journal.state].has(state)) {
    throw new Error(`Invalid promotion journal transition ${journal.state} -> ${state}`)
  }
  if (typeof checkpoint !== 'string' || !checkpoint.trim()) {
    throw new Error('Promotion journal checkpoint is required')
  }
  if (immutableEntry) {
    const probe = structuredClone(journal)
    probe.immutableLedger.push(immutableEntry)
    validateJournal(probe)
    journal.immutableLedger.push(immutableEntry)
  }
  const timestamp = new Date(updatedAt)
  if (
    Number.isNaN(timestamp.valueOf()) ||
    timestamp.toISOString() !== updatedAt ||
    Date.parse(updatedAt) < Date.parse(journal.updatedAt)
  ) {
    throw new Error('Promotion journal updatedAt must be monotonic ISO-8601')
  }
  journal.state = state
  journal.updatedAt = updatedAt
  journal.sequence += 1
  journal.checkpoints.push({
    sequence: journal.sequence,
    name: checkpoint,
    at: updatedAt,
  })
  journal.recovery.required = ['committing', 'rollback-required'].includes(state)
  return validateJournal(journal)
}

// A promotion may be interrupted after the immutable history write but before
// both mutable open-lock replicas are updated.  This recognises only the
// exact, one-step journal transition produced by advanceJournal; every other
// divergence remains an operator-visible, fail-closed error.
export function resolveSplitNonterminalJournal({ r2Open, ossOpen }) {
  const copies = [
    { provider: 'r2', journal: validateJournal(r2Open) },
    { provider: 'oss', journal: validateJournal(ossOpen) },
  ]
  if (copies[0].journal.transactionId !== copies[1].journal.transactionId) {
    throw new Error('Split promotion locks do not share a transaction identity')
  }
  if (copies[0].journal.sequence === copies[1].journal.sequence) {
    throw new Error('Split promotion locks must have different sequences')
  }
  const [previous, canonical] = [...copies].sort(
    (left, right) => left.journal.sequence - right.journal.sequence
  )
  if (canonical.journal.sequence !== previous.journal.sequence + 1) {
    throw new Error('Split promotion locks must differ by exactly one sequence')
  }
  if (
    !canonical.journal.recovery.required ||
    !['committing', 'rollback-required'].includes(canonical.journal.state)
  ) {
    throw new Error('Split promotion lock successor must require nonterminal recovery')
  }
  if (
    canonical.journal.checkpoints.length !==
      previous.journal.checkpoints.length + 1 ||
    canonical.journal.immutableLedger.length <
      previous.journal.immutableLedger.length ||
    canonical.journal.immutableLedger.length >
      previous.journal.immutableLedger.length + 1
  ) {
    throw new Error('Split promotion lock successor has an unsafe journal delta')
  }
  const checkpoint = canonical.journal.checkpoints.at(-1)
  if (!checkpoint || checkpoint.sequence !== canonical.journal.sequence) {
    throw new Error('Split promotion lock successor has no exact checkpoint')
  }
  const immutableEntry =
    canonical.journal.immutableLedger.length ===
    previous.journal.immutableLedger.length + 1
      ? canonical.journal.immutableLedger.at(-1)
      : undefined
  const reconstructed = advanceJournal(previous.journal, {
    state: canonical.journal.state,
    checkpoint: checkpoint.name,
    immutableEntry,
    updatedAt: canonical.journal.updatedAt,
  })
  if (!isDeepStrictEqual(reconstructed, canonical.journal)) {
    throw new Error(
      'Split promotion lock successor is not an exact immutable journal transition'
    )
  }
  return {
    transactionId: canonical.journal.transactionId,
    previousProvider: previous.provider,
    canonicalProvider: canonical.provider,
    previous: previous.journal,
    canonical: canonical.journal,
  }
}

export function resolveUnifiedNonterminalJournal({ r2Open, ossOpen }) {
  const r2 = validateJournal(r2Open)
  const oss = validateJournal(ossOpen)
  if (!isDeepStrictEqual(r2, oss)) {
    throw new Error('Unified promotion locks must be exactly equal')
  }
  if (
    !r2.recovery.required ||
    !['committing', 'rollback-required'].includes(r2.state)
  ) {
    throw new Error('Unified promotion lock must require nonterminal recovery')
  }
  return {
    transactionId: r2.transactionId,
    canonicalProvider: 'both',
    canonical: r2,
  }
}

function terminalRouterExpectation(policy, currentVersion) {
  assertVersion(currentVersion, 'Terminal Router probe current version')
  if (policy === null) {
    return {
      currentVersion,
      targetVersion: currentVersion,
      rollout: 0,
      expectedStatus: 204,
      expectedState: 'policy-unavailable',
    }
  }
  assertPlainObject(policy, 'Terminal Router policy')
  if (policy.paused === true) {
    return {
      currentVersion,
      targetVersion: currentVersion,
      rollout: 0,
      expectedStatus: 204,
      expectedState: 'paused',
    }
  }
  const transition = policy.transitions?.[currentVersion]
  if (transition === undefined) {
    return {
      currentVersion,
      targetVersion: currentVersion,
      rollout: 0,
      expectedStatus: 204,
      expectedState: 'no-transition',
    }
  }
  assertPlainObject(transition, 'Terminal Router transition')
  if (
    !Number.isInteger(transition.rollout) ||
    transition.rollout < 0 ||
    transition.rollout > 100
  ) {
    throw new Error('Terminal Router transition rollout is invalid')
  }
  assertVersion(transition.to, 'Terminal Router transition target')
  if (transition.rollout === 0) {
    return {
      currentVersion,
      targetVersion: transition.to,
      rollout: 0,
      expectedStatus: 204,
      expectedState: 'phase-closed',
    }
  }
  return {
    currentVersion,
    targetVersion: transition.to,
    rollout: transition.rollout,
    expectedStatus: 200,
    expectedState: null,
  }
}

export function terminalPromotionRecoveryPlan({
  journal: journalInput,
  nextPolicyBytes,
  beforePolicyBytes,
  candidate,
  phase,
  fromVersion,
  expectedCurrent,
  rollout,
  smokeEvidence,
  healthEvidence,
  directTransitionPolicy,
}) {
  const journal = validateJournal(journalInput)
  if (
    !['committed', 'rolled-back'].includes(journal.state) ||
    journal.recovery.required
  ) {
    throw new Error(
      'Terminal promotion recovery requires committed or rolled-back state'
    )
  }
  if (!Buffer.isBuffer(nextPolicyBytes) || nextPolicyBytes.length === 0) {
    throw new Error('Terminal promotion next-policy bytes are required')
  }
  if (sha256Bytes(nextPolicyBytes) !== journal.nextPolicy.sha256) {
    throw new Error('Terminal promotion next policy does not match its journal')
  }
  let nextPolicy
  try {
    nextPolicy = JSON.parse(nextPolicyBytes.toString('utf8'))
  } catch {
    throw new Error('Terminal promotion next policy is not valid JSON')
  }
  assertPlainObject(nextPolicy, 'Terminal promotion next policy')

  const snapshotMatches = (provider, key) =>
    journal.snapshots
      .map((snapshot, index) => ({ snapshot, index }))
      .filter(
        ({ snapshot }) =>
          snapshot.provider === provider && snapshot.key === key
      )
  const policyMatches = snapshotMatches('r2', STABLE_POLICY_KEY)
  if (journal.snapshots.length !== 1 || policyMatches.length !== 1) {
    throw new Error(
      'Terminal Router promotion journal must contain only the policy snapshot'
    )
  }
  const { snapshot: policySnapshot, index: policySnapshotIndex } =
    policyMatches[0]
  const backupPrefix =
    `${TRANSACTION_PREFIX}/${journal.transactionId}/backups`
  if (
    policySnapshot.backupKey !==
      (policySnapshot.existed ? `${backupPrefix}/policy.json` : null)
  ) {
    throw new Error(
      'Terminal promotion snapshot backups do not match the journal transaction'
    )
  }

  let beforePolicy = null
  if (policySnapshot.existed) {
    if (
      !Buffer.isBuffer(beforePolicyBytes) ||
      sha256Bytes(beforePolicyBytes) !== policySnapshot.bytesSha256
    ) {
      throw new Error(
        'Terminal promotion before-policy bytes do not match the snapshot'
      )
    }
    try {
      beforePolicy = JSON.parse(beforePolicyBytes.toString('utf8'))
    } catch {
      throw new Error('Terminal promotion before policy is not valid JSON')
    }
    assertPlainObject(beforePolicy, 'Terminal promotion before policy')
  } else if (beforePolicyBytes !== null) {
    throw new Error(
      'Terminal promotion absent policy snapshot cannot have before bytes'
    )
  }

  const targetRelease = nextPolicy.releases?.[journal.targetVersion]
  if (
    nextPolicy.schema !== 1 ||
    nextPolicy.channel !== 'stable' ||
    nextPolicy.paused !== false ||
    nextPolicy.currentVersion !== journal.targetVersion ||
    !isPlainObject(targetRelease) ||
    targetRelease.tag !== journal.targetTag ||
    typeof targetRelease.manifestKey !== 'string' ||
    !targetRelease.manifestKey
  ) {
    throw new Error('Terminal promotion next policy target is invalid')
  }
  assertSha256(
    targetRelease.manifestSha256,
    'Terminal promotion target manifestSha256'
  )
  if (!['A', 'B', 'C', 'DIRECT_C', 'RECOVERY'].includes(targetRelease.phase)) {
    throw new Error('Terminal promotion target phase is invalid')
  }
  assertSha256(
    targetRelease.smokeEvidenceSha256,
    'Terminal promotion target smokeEvidenceSha256'
  )
  assertSha256(
    targetRelease.healthEvidenceSha256,
    'Terminal promotion target healthEvidenceSha256'
  )
  const legacyBridgeVersion = nextPolicy.legacyBridgeVersion
  assertVersion(
    legacyBridgeVersion,
    'Terminal promotion legacy bridge version'
  )
  const legacyRelease = nextPolicy.releases?.[legacyBridgeVersion]
  if (
    !isPlainObject(legacyRelease) ||
    typeof legacyRelease.manifestKey !== 'string'
  ) {
    throw new Error('Terminal promotion legacy bridge release is missing')
  }
  assertSha256(
    legacyRelease.manifestSha256,
    'Terminal promotion legacy manifestSha256'
  )
  if (
    beforePolicy?.legacyBridgeVersion != null &&
    (
      beforePolicy.legacyBridgeVersion !== legacyBridgeVersion ||
      beforePolicy.releases?.[legacyBridgeVersion]?.manifestKey !==
        legacyRelease.manifestKey ||
      beforePolicy.releases?.[legacyBridgeVersion]?.manifestSha256 !==
        legacyRelease.manifestSha256
    )
  ) {
    throw new Error(
      'Terminal promotion must preserve the frozen legacy release identity'
    )
  }

  const beforeCurrentVersion =
    beforePolicy?.currentVersion ??
    nextPolicy.legacyPauseFallback?.version
  assertVersion(
    beforeCurrentVersion,
    'Terminal promotion before current version'
  )
  const beforeTransitions = beforePolicy?.transitions ?? {}
  const nextTransitions = nextPolicy.transitions ?? {}
  if (
    !isPlainObject(beforeTransitions) ||
    !isPlainObject(nextTransitions)
  ) {
    throw new Error('Terminal promotion transitions must be objects')
  }
  const changedTransitionKeys = [
    ...new Set([
      ...Object.keys(beforeTransitions),
      ...Object.keys(nextTransitions),
    ]),
  ].filter(
    (key) =>
      !isDeepStrictEqual(beforeTransitions[key], nextTransitions[key])
  )
  const directSourceVersions = Object.keys(DIRECT_C_ROUTER_SOURCES).sort()
  const terminalInitialDirectC =
    targetRelease.phase === 'DIRECT_C'
    && targetRelease.effectivePhase === 'C'
    && nextPolicy.deploymentMode === 'direct-c'
    && nextPolicy.legacyBridgeVersion === journal.targetVersion
    && beforeCurrentVersion === '0.6.633'
    && !beforePolicy?.completedPhases?.includes('C')
    && isDeepStrictEqual(nextPolicy.completedPhases, ['C'])
    && isDeepStrictEqual([...changedTransitionKeys].sort(), directSourceVersions)
    && isDeepStrictEqual(Object.keys(nextTransitions).sort(), directSourceVersions)
    && directSourceVersions.every((sourceVersion) => {
      const transition = nextTransitions[sourceVersion]
      return (
        isPlainObject(transition)
        && transition.to === journal.targetVersion
        && transition.phase === 'DIRECT_C'
        && transition.rollout === 100
        && transition.manifestKey === targetRelease.manifestKey
      )
    })
  if (changedTransitionKeys.length > 1 && !terminalInitialDirectC) {
    throw new Error(
      'Terminal promotion changed more than one Router transition'
    )
  }
  if (terminalInitialDirectC) {
    validateApprovedDirectCTransition({
      policy:
        directTransitionPolicy
        ?? loadDirectCTransitionPolicy(undefined, {
          requireApprovedNext: true,
        }),
      candidate,
      currentPolicy: beforePolicy ?? createDirectCInitialPolicy(),
      nextPolicy,
    })
  }
  const terminalInitialA =
    changedTransitionKeys.length === 0 &&
    targetRelease.phase === 'A' &&
    nextPolicy.legacyBridgeVersion === journal.targetVersion &&
    !beforePolicy?.completedPhases?.includes('A') &&
    nextPolicy.completedPhases?.includes('A') &&
    !isPlainObject(nextTransitions[beforeCurrentVersion])
  const matchingUnchangedTransitions = Object.entries(nextTransitions)
    .filter(
      ([, transition]) =>
        isPlainObject(transition) &&
        transition.to === journal.targetVersion &&
        transition.phase === targetRelease.phase &&
        transition.manifestKey === targetRelease.manifestKey
    )
  let terminalFromVersion
  let terminalRollout
  if (terminalInitialDirectC) {
    terminalFromVersion = beforeCurrentVersion
    terminalRollout = 100
  } else if (changedTransitionKeys.length === 1) {
    terminalFromVersion = changedTransitionKeys[0]
    const transition = nextTransitions[terminalFromVersion]
    if (
      !isPlainObject(transition) ||
      transition.to !== journal.targetVersion ||
      transition.phase !== targetRelease.phase ||
      transition.manifestKey !== targetRelease.manifestKey ||
      !Number.isInteger(transition.rollout) ||
      transition.rollout < 0 ||
      transition.rollout > 100
    ) {
      throw new Error(
        'Terminal promotion changed transition does not match its target'
      )
    }
    terminalRollout = transition.rollout
  } else if (terminalInitialA) {
    terminalFromVersion = beforeCurrentVersion
    terminalRollout = 100
  } else if (matchingUnchangedTransitions.length === 1) {
    terminalFromVersion = matchingUnchangedTransitions[0][0]
    const transition = matchingUnchangedTransitions[0][1]
    if (
      !Number.isInteger(transition.rollout) ||
      transition.rollout < 0 ||
      transition.rollout > 100
    ) {
      throw new Error(
        'Terminal promotion unchanged transition rollout is invalid'
      )
    }
    terminalRollout = transition.rollout
  } else {
    throw new Error(
      'Terminal promotion request cannot be derived from its policies'
    )
  }
  assertVersion(
    terminalFromVersion,
    'Terminal promotion source version'
  )
  const terminalPolicy =
    journal.state === 'committed' ? nextPolicy : beforePolicy
  const router = terminalRouterExpectation(
    terminalPolicy,
    terminalFromVersion
  )
  const directRouters = terminalInitialDirectC
    ? [
        terminalFromVersion,
        ...directSourceVersions,
        journal.targetVersion,
      ].map((sourceVersion) =>
        terminalRouterExpectation(terminalPolicy, sourceVersion)
      )
    : [router]

  const requestedRollout = Number(rollout)
  const candidateMatches =
    isPlainObject(candidate) &&
    candidate.tag === journal.targetTag &&
    candidate.version === journal.targetVersion &&
    candidate.sourceCommit === journal.sourceCommit &&
    candidate.manifestKey === targetRelease.manifestKey &&
    candidate.manifestSha256 === targetRelease.manifestSha256
  const sameRequest =
    journal.state === 'committed' &&
    candidateMatches &&
    expectedCurrent === beforeCurrentVersion &&
    fromVersion === terminalFromVersion &&
    targetRelease.phase === phase &&
    requestedRollout === terminalRollout &&
    smokeEvidence?.sha256 === targetRelease.smokeEvidenceSha256 &&
    healthEvidence?.sha256 === targetRelease.healthEvidenceSha256

  return {
    schema: 1,
    kind: 'router-promotion-terminal-recovery',
    terminalState: journal.state,
    transactionId: journal.transactionId,
    policySnapshotIndex,
    beforePolicyExisted: policySnapshot.existed,
    beforeCurrentVersion,
    terminalRequest: {
      phase: targetRelease.phase,
      fromVersion: terminalFromVersion,
      expectedCurrent: beforeCurrentVersion,
      rollout: terminalRollout,
    },
    frozenLegacy: {
      version: legacyBridgeVersion,
      key: legacyRelease.manifestKey,
      sha256: legacyRelease.manifestSha256,
    },
    router,
    ...(terminalInitialDirectC ? { routers: directRouters } : {}),
    sameRequest,
  }
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\"'\"'`)}'`
}

export function recoveryCommands(journalInput) {
  const journal = validateJournal(journalInput)
  if (
    !journal.recovery.required ||
    !['committing', 'rollback-required'].includes(journal.state)
  ) {
    throw new Error(
      'Recovery commands require a committing or rollback-required journal'
    )
  }
  const [policy] = journal.snapshots
  if (
    journal.snapshots.length !== 1 ||
    policy.provider !== 'r2' ||
    policy.key !== STABLE_POLICY_KEY ||
    !policy.existed
  ) {
    throw new Error('Router recovery requires one existing policy snapshot')
  }
  const sameImmutableObject = (left, right) =>
    left.provider === right.provider &&
    left.key === right.key &&
    left.sha256 === right.sha256 &&
    left.contentType === right.contentType &&
    left.cacheControl === right.cacheControl &&
    left.createdByTransaction === right.createdByTransaction
  const cleanupLedger = journal.immutableLedger.filter(
    (item) => item.createdByTransaction && item.verified
  )
  const cleanupKeys = new Set()
  for (const entry of cleanupLedger) {
    const identity = `${entry.provider}\0${entry.key}`
    if (cleanupKeys.has(identity)) {
      throw new Error(
        `Recovery journal contains duplicate verified immutable object ${entry.provider}:${entry.key}`
      )
    }
    cleanupKeys.add(identity)
  }
  const unverifiedLedger = journal.immutableLedger.filter(
    (item, index, entries) =>
      item.createdByTransaction &&
      !item.verified &&
      !entries.slice(index + 1).some(
        (later) =>
          later.createdByTransaction &&
          later.verified &&
          sameImmutableObject(item, later)
      )
  )
  const q = shellQuote
  const policyIndex = 0
  const lines = [
    '#!/usr/bin/env bash',
    '# Generated from a schema-3 Router promotion journal.',
    '# Frozen legacy manifests are verified read-only and are never recovery targets.',
    'set -euo pipefail',
    ': "${CLOUDFLARE_R2_ACCOUNT_ID:?}"',
    ': "${CLOUDFLARE_R2_BUCKET:?}"',
    ': "${ALIYUN_OSS_BUCKET:?}"',
    ': "${ALIYUN_OSS_ENDPOINT:?}"',
    ': "${ALIYUN_REGION:?}"',
    'JOURNAL="${JOURNAL:-promotion-journal.json}"',
    'test -s "$JOURNAL"',
    'node scripts/updater/promotion-transaction.mjs validate-journal --journal "$JOURNAL"',
    'r2_endpoint="https://${CLOUDFLARE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com"',
    'oss_endpoint="${ALIYUN_OSS_ENDPOINT#https://}"',
    'oss_endpoint="https://${oss_endpoint#http://}"',
    'put_skeleton="$(aws s3api put-object --generate-cli-skeleton input)"',
    'delete_skeleton="$(aws s3api delete-object --generate-cli-skeleton input)"',
    'jq -e \'has("IfMatch") and has("IfNoneMatch")\' <<<"$put_skeleton" >/dev/null',
    'jq -e \'has("IfMatch")\' <<<"$delete_skeleton" >/dev/null',
    'unset put_skeleton delete_skeleton',
    `transaction_id=${q(journal.transactionId)}`,
    `policy_key=${q(policy.key)}`,
    `policy_backup_key=${q(policy.backupKey)}`,
    `next_policy_key=${q(journal.nextPolicy.key)}`,
    `next_policy_sha256=${q(journal.nextPolicy.sha256)}`,
    `policy_sha256=${q(policy.bytesSha256)}`,
    'legacy_key="mita/latest.json"',
    'mkdir -p recovery-readback/{backups,live,ledger,probes}',
    'probe_r2_recovery() {',
    '  local key="$1" name="$2" rc',
    '  if aws s3api head-object --bucket "$CLOUDFLARE_R2_BUCKET" --key "$key" --endpoint-url "$r2_endpoint" >"recovery-readback/probes/${name}.stdout" 2>"recovery-readback/probes/${name}.stderr"; then rc=0; else rc=$?; fi',
    '  node scripts/updater/promotion-transaction.mjs classify-probe --provider r2 --key "$key" --exit-code "$rc" --stdout "recovery-readback/probes/${name}.stdout" --stderr "recovery-readback/probes/${name}.stderr" --output "recovery-readback/probes/${name}.json"',
    '}',
    'probe_oss_recovery() {',
    '  local key="$1" name="$2" rc',
    '  if ossutil api head-object --bucket "$ALIYUN_OSS_BUCKET" --key "$key" --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" --output-format json --quiet >"recovery-readback/probes/${name}.stdout" 2>"recovery-readback/probes/${name}.stderr"; then rc=0; else rc=$?; fi',
    '  node scripts/updater/promotion-transaction.mjs classify-probe --provider oss --key "$key" --exit-code "$rc" --stdout "recovery-readback/probes/${name}.stdout" --stderr "recovery-readback/probes/${name}.stderr" --output "recovery-readback/probes/${name}.json"',
    '}',
    'verify_recovery_json_metadata() {',
    '  local metadata="$1" plan="$2"',
    '  node scripts/updater/promotion-transaction.mjs backup-metadata-plan --metadata "$metadata" --output "$plan"',
    '  jq -e \'.contentType == "application/json" and .cacheControl == "no-store"\' "$plan" >/dev/null',
    '}',
    'persist_recovery_journal() {',
    '  local next="$1" previous="$2" sequence history_key open_etag r2_state oss_state',
    '  sequence="$(jq -er .sequence "$next")"',
    '  history_key="biyan/updater/transactions/${transaction_id}/journal-$(printf \'%04d\' "$sequence").json"',
    '  probe_r2_recovery "$history_key" history-r2-before',
    '  probe_oss_recovery "$history_key" history-oss-before',
    '  r2_state="$(jq -er .state recovery-readback/probes/history-r2-before.json)"',
    '  oss_state="$(jq -er .state recovery-readback/probes/history-oss-before.json)"',
    '  if [[ "$r2_state" == exists ]]; then',
    '    aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" --key "$history_key" --endpoint-url "$r2_endpoint" recovery-readback/live/history-r2-before.json >recovery-readback/live/history-r2-before-metadata.json',
    '    cmp "$next" recovery-readback/live/history-r2-before.json',
    '    verify_recovery_json_metadata recovery-readback/live/history-r2-before-metadata.json recovery-readback/live/history-r2-before-plan.json',
    '  else',
    '    test "$r2_state" = absent',
    '  fi',
    '  if [[ "$oss_state" == exists ]]; then',
    '    ossutil cp "oss://${ALIYUN_OSS_BUCKET}/${history_key}" recovery-readback/live/history-oss-before.json --force --endpoint "$oss_endpoint" --region "$ALIYUN_REGION"',
    '    ossutil api head-object --bucket "$ALIYUN_OSS_BUCKET" --key "$history_key" --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" --output-format json --quiet >recovery-readback/live/history-oss-before-metadata.json',
    '    cmp "$next" recovery-readback/live/history-oss-before.json',
    '    verify_recovery_json_metadata recovery-readback/live/history-oss-before-metadata.json recovery-readback/live/history-oss-before-plan.json',
    '  else',
    '    test "$oss_state" = absent',
    '  fi',
    '  if [[ "$r2_state" == absent ]]; then',
    '    aws s3api put-object --bucket "$CLOUDFLARE_R2_BUCKET" --key "$history_key" --body "$next" --content-type application/json --cache-control no-store --if-none-match \'*\' --endpoint-url "$r2_endpoint" >/dev/null',
    '  fi',
    '  if [[ "$oss_state" == absent ]]; then',
    '    ossutil api put-object --bucket "$ALIYUN_OSS_BUCKET" --key "$history_key" --body "file://${next}" --content-type application/json --cache-control no-store --object-acl default --forbid-overwrite true --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" --output-format json --quiet >/dev/null',
    '  fi',
    '  aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" --key "$history_key" --endpoint-url "$r2_endpoint" recovery-readback/live/history-r2-persisted.json >recovery-readback/live/history-r2-persisted-metadata.json',
    '  ossutil cp "oss://${ALIYUN_OSS_BUCKET}/${history_key}" recovery-readback/live/history-oss-persisted.json --force --endpoint "$oss_endpoint" --region "$ALIYUN_REGION"',
    '  ossutil api head-object --bucket "$ALIYUN_OSS_BUCKET" --key "$history_key" --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" --output-format json --quiet >recovery-readback/live/history-oss-persisted-metadata.json',
    '  cmp "$next" recovery-readback/live/history-r2-persisted.json',
    '  cmp "$next" recovery-readback/live/history-oss-persisted.json',
    '  verify_recovery_json_metadata recovery-readback/live/history-r2-persisted-metadata.json recovery-readback/live/history-r2-persisted-plan.json',
    '  verify_recovery_json_metadata recovery-readback/live/history-oss-persisted-metadata.json recovery-readback/live/history-oss-persisted-plan.json',
    `  aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" --key ${q(OPEN_TRANSACTION_KEY)} --endpoint-url "$r2_endpoint" recovery-readback/live/open-r2-boundary.json >recovery-readback/live/open-r2-boundary-metadata.json`,
    `  ossutil cp "oss://\${ALIYUN_OSS_BUCKET}/${OPEN_TRANSACTION_KEY}" recovery-readback/live/open-oss-boundary.json --force --endpoint "$oss_endpoint" --region "$ALIYUN_REGION"`,
    '  cmp "$previous" recovery-readback/live/open-r2-boundary.json',
    '  cmp "$previous" recovery-readback/live/open-oss-boundary.json',
    '  open_etag="$(node scripts/updater/promotion-transaction.mjs extract-r2-etag --metadata recovery-readback/live/open-r2-boundary-metadata.json)"',
    `  aws s3api put-object --bucket "$CLOUDFLARE_R2_BUCKET" --key ${q(OPEN_TRANSACTION_KEY)} --body "$next" --content-type application/json --cache-control no-store --if-match "$open_etag" --endpoint-url "$r2_endpoint" >/dev/null`,
    `  ossutil cp "oss://\${ALIYUN_OSS_BUCKET}/${OPEN_TRANSACTION_KEY}" recovery-readback/live/open-oss-immediate.json --force --endpoint "$oss_endpoint" --region "$ALIYUN_REGION"`,
    '  cmp "$previous" recovery-readback/live/open-oss-immediate.json',
    `  ossutil api put-object --bucket "$ALIYUN_OSS_BUCKET" --key ${q(OPEN_TRANSACTION_KEY)} --body "file://\${next}" --content-type application/json --cache-control no-store --object-acl default --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" --output-format json --quiet >/dev/null`,
    `  aws s3 cp "s3://\${CLOUDFLARE_R2_BUCKET}/${OPEN_TRANSACTION_KEY}" recovery-readback/live/open-r2-persisted.json --endpoint-url "$r2_endpoint"`,
    `  ossutil cp "oss://\${ALIYUN_OSS_BUCKET}/${OPEN_TRANSACTION_KEY}" recovery-readback/live/open-oss-persisted.json --force --endpoint "$oss_endpoint" --region "$ALIYUN_REGION"`,
    '  cmp "$next" recovery-readback/live/open-r2-persisted.json',
    '  cmp "$next" recovery-readback/live/open-oss-persisted.json',
    '}',
    '# Load the content-addressed next policy and the only mutable snapshot.',
    'aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" --key "$next_policy_key" --endpoint-url "$r2_endpoint" recovery-readback/next-policy-r2.json >recovery-readback/next-policy-r2-metadata.json',
    'ossutil cp "oss://${ALIYUN_OSS_BUCKET}/${next_policy_key}" recovery-readback/next-policy-oss.json --force --endpoint "$oss_endpoint" --region "$ALIYUN_REGION"',
    'cmp recovery-readback/next-policy-r2.json recovery-readback/next-policy-oss.json',
    'test "$(sha256sum recovery-readback/next-policy-r2.json | cut -d\' \' -f1)" = "$next_policy_sha256"',
    'aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" --key "$policy_backup_key" --endpoint-url "$r2_endpoint" recovery-readback/backups/policy.json >recovery-readback/backups/policy-metadata.json',
    'test "$(sha256sum recovery-readback/backups/policy.json | cut -d\' \' -f1)" = "$policy_sha256"',
    `node scripts/updater/promotion-transaction.mjs verify-snapshot-readback --journal "$JOURNAL" --index ${q(policyIndex)} --bytes recovery-readback/backups/policy.json --metadata recovery-readback/backups/policy-metadata.json --output recovery-readback/backups/policy-verified.json`,
    '# Prove the final handoff remains frozen before any recovery mutation.',
    'ossutil cp "oss://${ALIYUN_OSS_BUCKET}/${legacy_key}" recovery-readback/frozen-legacy-oss.json --force --endpoint "$oss_endpoint" --region "$ALIYUN_REGION"',
    'aws s3 cp "s3://${CLOUDFLARE_R2_BUCKET}/${legacy_key}" recovery-readback/frozen-legacy-r2.json --endpoint-url "$r2_endpoint"',
    'node scripts/updater/promotion-transaction.mjs validate-frozen-legacy --current-policy recovery-readback/backups/policy.json --next-policy recovery-readback/next-policy-r2.json --oss-legacy recovery-readback/frozen-legacy-oss.json --r2-legacy recovery-readback/frozen-legacy-r2.json --output recovery-readback/frozen-legacy-invariant.json',
    '# Both open-lock replicas must still match this exact journal.',
    `probe_r2_recovery ${q(OPEN_TRANSACTION_KEY)} open-r2`,
    `probe_oss_recovery ${q(OPEN_TRANSACTION_KEY)} open-oss`,
    'jq -e \'.state == "exists"\' recovery-readback/probes/open-r2.json >/dev/null',
    'jq -e \'.state == "exists"\' recovery-readback/probes/open-oss.json >/dev/null',
    `aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" --key ${q(OPEN_TRANSACTION_KEY)} --endpoint-url "$r2_endpoint" recovery-readback/live/open-r2.json >recovery-readback/live/open-r2-metadata.json`,
    `ossutil cp "oss://\${ALIYUN_OSS_BUCKET}/${OPEN_TRANSACTION_KEY}" recovery-readback/live/open-oss.json --force --endpoint "$oss_endpoint" --region "$ALIYUN_REGION"`,
    'cmp "$JOURNAL" recovery-readback/live/open-r2.json',
    'cmp "$JOURNAL" recovery-readback/live/open-oss.json',
    '# Classify policy and every immutable create before mutation.',
    'probe_r2_recovery "$policy_key" live-policy',
    'test "$(jq -er .state recovery-readback/probes/live-policy.json)" = exists',
    'aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" --key "$policy_key" --endpoint-url "$r2_endpoint" recovery-readback/live/policy.json >recovery-readback/live/policy-metadata.json',
    'node scripts/updater/promotion-transaction.mjs classify-policy-rollback --policy-existed true --original recovery-readback/backups/policy.json --next recovery-readback/next-policy-r2.json --live-state exists --live recovery-readback/live/policy.json --output recovery-readback/policy-decision.json',
  ]
  for (const [index, entry] of unverifiedLedger.entries()) {
    lines.push(
      `probe_${entry.provider}_recovery ${q(entry.key)} unverified-${index}`,
      `jq -e '.state == "absent"' recovery-readback/probes/unverified-${index}.json >/dev/null`
    )
  }
  for (const [index, entry] of cleanupLedger.entries()) {
    const name = `ledger-${index}`
    lines.push(
      `probe_${entry.provider}_recovery ${q(entry.key)} ${q(name)}`,
      `ledger_state="$(jq -er .state recovery-readback/probes/${name}.json)"`,
      `printf '%s\\n' "$ledger_state" >recovery-readback/ledger/${index}-state`,
      'if [[ "$ledger_state" == exists ]]; then'
    )
    if (entry.provider === 'r2') {
      lines.push(
        `  aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" --key ${q(entry.key)} --endpoint-url "$r2_endpoint" recovery-readback/ledger/${index} >recovery-readback/ledger/${index}-metadata.json`
      )
    } else {
      lines.push(
        `  ossutil cp "oss://\${ALIYUN_OSS_BUCKET}/${entry.key}" recovery-readback/ledger/${index} --force --endpoint "$oss_endpoint" --region "$ALIYUN_REGION"`,
        `  ossutil api head-object --bucket "$ALIYUN_OSS_BUCKET" --key ${q(entry.key)} --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" --output-format json --quiet >recovery-readback/ledger/${index}-metadata.json`
      )
    }
    lines.push(
      `  test "$(sha256sum recovery-readback/ledger/${index} | cut -d' ' -f1)" = ${q(entry.sha256)}`,
      `  node scripts/updater/promotion-transaction.mjs backup-metadata-plan --metadata recovery-readback/ledger/${index}-metadata.json --output recovery-readback/ledger/${index}-metadata-plan.json`,
      `  jq -e --arg type ${q(entry.contentType)} --arg cache ${q(entry.cacheControl)} '.contentType == $type and .cacheControl == $cache' recovery-readback/ledger/${index}-metadata-plan.json >/dev/null`,
      'else',
      '  test "$ledger_state" = absent',
      'fi'
    )
  }
  lines.push(
    '# RECOVERY MUTATIONS BEGIN: mark the durable journal first.',
    'cp "$JOURNAL" recovery-readback/journal-before-recovery.json',
    'node scripts/updater/promotion-transaction.mjs advance-journal --journal "$JOURNAL" --state rollback-required --checkpoint operator-recovery-started --updated-at "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" --output recovery-readback/journal-rollback-required.json',
    'persist_recovery_journal recovery-readback/journal-rollback-required.json recovery-readback/journal-before-recovery.json',
    'cp recovery-readback/journal-rollback-required.json "$JOURNAL"',
    '# Restore the exact prior Router policy with content CAS.',
    'if [[ "$(jq -er .action recovery-readback/policy-decision.json)" == restore ]]; then',
    '  aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" --key "$policy_key" --endpoint-url "$r2_endpoint" recovery-readback/live/policy-prewrite.json >recovery-readback/live/policy-prewrite-metadata.json',
    '  cmp recovery-readback/live/policy.json recovery-readback/live/policy-prewrite.json',
    '  policy_etag="$(node scripts/updater/promotion-transaction.mjs extract-r2-etag --metadata recovery-readback/live/policy-prewrite-metadata.json)"',
    '  aws s3api put-object --bucket "$CLOUDFLARE_R2_BUCKET" --key "$policy_key" --body recovery-readback/backups/policy.json --content-type application/json --cache-control no-store --if-match "$policy_etag" --endpoint-url "$r2_endpoint" >/dev/null',
    'fi',
    'aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" --key "$policy_key" --endpoint-url "$r2_endpoint" recovery-readback/policy-restored.json >recovery-readback/policy-restored-metadata.json',
    'cmp recovery-readback/backups/policy.json recovery-readback/policy-restored.json',
    `node scripts/updater/promotion-transaction.mjs verify-snapshot-readback --journal "$JOURNAL" --index ${q(policyIndex)} --bytes recovery-readback/policy-restored.json --metadata recovery-readback/policy-restored-metadata.json --output recovery-readback/policy-restored-verified.json`,
    '# Delete only immutable objects proven to have been created by this transaction.'
  )
  for (const [index, entry] of [...cleanupLedger].reverse().entries()) {
    const originalIndex = cleanupLedger.indexOf(entry)
    lines.push(
      `probe_${entry.provider}_recovery ${q(entry.key)} predelete-${index}`,
      `initial_ledger_state="$(cat recovery-readback/ledger/${originalIndex}-state)"`,
      `predelete_ledger_state="$(jq -er .state recovery-readback/probes/predelete-${index}.json)"`,
      'if [[ "$initial_ledger_state" == absent ]]; then',
      '  test "$predelete_ledger_state" = absent',
      'else',
      '  test "$initial_ledger_state" = exists',
      '  if [[ "$predelete_ledger_state" == exists ]]; then'
    )
    if (entry.provider === 'r2') {
      lines.push(
        `    aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" --key ${q(entry.key)} --endpoint-url "$r2_endpoint" recovery-readback/ledger/predelete-${index} >recovery-readback/ledger/predelete-${index}-metadata.json`,
        `    test "$(sha256sum recovery-readback/ledger/predelete-${index} | cut -d' ' -f1)" = ${q(entry.sha256)}`,
        `    node scripts/updater/promotion-transaction.mjs backup-metadata-plan --metadata recovery-readback/ledger/predelete-${index}-metadata.json --output recovery-readback/ledger/predelete-${index}-metadata-plan.json`,
        `    jq -e --arg type ${q(entry.contentType)} --arg cache ${q(entry.cacheControl)} '.contentType == $type and .cacheControl == $cache' recovery-readback/ledger/predelete-${index}-metadata-plan.json >/dev/null`,
        `    ledger_etag="$(node scripts/updater/promotion-transaction.mjs extract-r2-etag --metadata recovery-readback/ledger/predelete-${index}-metadata.json)"`,
        `    aws s3api delete-object --bucket "$CLOUDFLARE_R2_BUCKET" --key ${q(entry.key)} --if-match "$ledger_etag" --endpoint-url "$r2_endpoint" >/dev/null`
      )
    } else {
      lines.push(
        `    ossutil cp "oss://\${ALIYUN_OSS_BUCKET}/${entry.key}" recovery-readback/ledger/predelete-${index} --force --endpoint "$oss_endpoint" --region "$ALIYUN_REGION"`,
        `    test "$(sha256sum recovery-readback/ledger/predelete-${index} | cut -d' ' -f1)" = ${q(entry.sha256)}`,
        `    ossutil api head-object --bucket "$ALIYUN_OSS_BUCKET" --key ${q(entry.key)} --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" --output-format json --quiet >recovery-readback/ledger/predelete-${index}-metadata.json`,
        `    node scripts/updater/promotion-transaction.mjs backup-metadata-plan --metadata recovery-readback/ledger/predelete-${index}-metadata.json --output recovery-readback/ledger/predelete-${index}-metadata-plan.json`,
        `    jq -e --arg type ${q(entry.contentType)} --arg cache ${q(entry.cacheControl)} '.contentType == $type and .cacheControl == $cache' recovery-readback/ledger/predelete-${index}-metadata-plan.json >/dev/null`,
        `    ossutil api delete-object --bucket "$ALIYUN_OSS_BUCKET" --key ${q(entry.key)} --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" --output-format json --quiet >/dev/null`
      )
    }
    lines.push(
      '  else',
      '    test "$predelete_ledger_state" = absent',
      '  fi',
      'fi',
      `probe_${entry.provider}_recovery ${q(entry.key)} ${q(`deleted-${index}`)}`,
      `jq -e '.state == "absent"' recovery-readback/probes/deleted-${index}.json >/dev/null`
    )
  }
  lines.push(
    '# The frozen handoff must still match after all allowed mutations.',
    'ossutil cp "oss://${ALIYUN_OSS_BUCKET}/${legacy_key}" recovery-readback/frozen-legacy-oss-final.json --force --endpoint "$oss_endpoint" --region "$ALIYUN_REGION"',
    'aws s3 cp "s3://${CLOUDFLARE_R2_BUCKET}/${legacy_key}" recovery-readback/frozen-legacy-r2-final.json --endpoint-url "$r2_endpoint"',
    'node scripts/updater/promotion-transaction.mjs validate-frozen-legacy --current-policy recovery-readback/policy-restored.json --next-policy recovery-readback/next-policy-r2.json --oss-legacy recovery-readback/frozen-legacy-oss-final.json --r2-legacy recovery-readback/frozen-legacy-r2-final.json --output recovery-readback/frozen-legacy-final.json',
    'cp "$JOURNAL" recovery-readback/journal-before-terminal.json',
    'node scripts/updater/promotion-transaction.mjs advance-journal --journal "$JOURNAL" --state rolled-back --checkpoint router-policy-restored --updated-at "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" --output recovery-readback/journal-rolled-back.json',
    'persist_recovery_journal recovery-readback/journal-rolled-back.json recovery-readback/journal-before-terminal.json',
    'cp recovery-readback/journal-rolled-back.json "$JOURNAL"',
    '# Leave terminal lock cleanup to the standard terminal-recovery path.',
    'echo "Router promotion recovered; terminal journal is ready for verified cleanup."'
  )
  return `${lines.join('\n')}\n`
}

export async function pollPublicBytes({
  url,
  expectedBytes,
  timeoutMs = 10 * 60 * 1000,
  intervalMs = 10 * 1000,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  sleep = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
}) {
  if (
    typeof url !== 'string' ||
    !url.startsWith('https://') ||
    typeof fetchImpl !== 'function'
  ) {
    throw new Error('CDN poll requires an explicit HTTPS URL')
  }
  const expected = Buffer.from(expectedBytes)
  const expectedSha256 = sha256Bytes(expected)
  const deadline = now() + timeoutMs
  let last = 'no response'
  do {
    try {
      const response = await fetchImpl(url, {
        redirect: 'error',
        headers: {
          'cache-control': 'no-cache',
          pragma: 'no-cache',
        },
      })
      const bytes = Buffer.from(await response.arrayBuffer())
      const actualSha256 = sha256Bytes(bytes)
      last = `HTTP ${response.status}, sha256 ${actualSha256}`
      if (response.status === 200 && bytes.equals(expected)) {
        return {
          url,
          status: 200,
          sha256: expectedSha256,
          verifiedAt: new Date(now()).toISOString(),
        }
      }
    } catch (error) {
      last = error instanceof Error ? error.message : String(error)
    }
    if (now() >= deadline) break
    await sleep(intervalMs)
  } while (now() <= deadline)
  throw new Error(
    `CDN did not converge to ${expectedSha256} within ${timeoutMs}ms: ${last}`
  )
}

function parseArgs(argv) {
  const [command, ...rest] = argv
  const args = {}
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index]
    const value = rest[index + 1]
    if (!flag?.startsWith('--') || value === undefined) {
      throw new Error(`Unexpected or incomplete argument: ${flag ?? '(missing)'}`)
    }
    if (args[flag]) throw new Error(`Duplicate argument: ${flag}`)
    args[flag] = value
  }
  return { command, args }
}

async function runCli() {
  const { command, args } = parseArgs(process.argv.slice(2))
  if (command === 'classify-probe') {
    const result = classifyRemoteProbe({
      provider: args['--provider'],
      key: args['--key'],
      exitCode: Number(args['--exit-code']),
      stdout: args['--stdout']
        ? fs.readFileSync(path.resolve(args['--stdout']), 'utf8')
        : '',
      stderr: args['--stderr']
        ? fs.readFileSync(path.resolve(args['--stderr']), 'utf8')
        : '',
    })
    fs.writeFileSync(
      path.resolve(args['--output']),
      `${JSON.stringify(result, null, 2)}\n`
    )
    return
  }
  if (command === 'validate-approved-a') {
    const result = validateApprovedATransition({
      policy: readJson(path.resolve(args['--policy'])),
      candidate: readJson(path.resolve(args['--candidate'])),
      manifestBytes: fs.readFileSync(path.resolve(args['--manifest'])),
      currentPolicy: readJson(path.resolve(args['--current-policy'])),
      nextPolicy: readJson(path.resolve(args['--next-policy'])),
    })
    if (args['--output']) {
      fs.writeFileSync(
        path.resolve(args['--output']),
        `${JSON.stringify(result, null, 2)}\n`
      )
    }
    return
  }
  if (command === 'validate-health-evidence-url') {
    const url = validateHealthEvidenceUrl(
      args['--url'],
      args['--sha256']
    )
    if (args['--output']) {
      fs.writeFileSync(
        path.resolve(args['--output']),
        `${JSON.stringify({ url }, null, 2)}\n`
      )
    }
    return
  }
  if (command === 'validate-frozen-legacy') {
    const result = validateFrozenLegacyInvariant({
      currentPolicyBytes: fs.readFileSync(
        path.resolve(args['--current-policy'])
      ),
      nextPolicyBytes: fs.readFileSync(path.resolve(args['--next-policy'])),
      ossLegacyBytes: fs.readFileSync(path.resolve(args['--oss-legacy'])),
      r2LegacyBytes: fs.readFileSync(path.resolve(args['--r2-legacy'])),
    })
    if (args['--output']) {
      fs.writeFileSync(
        path.resolve(args['--output']),
        `${JSON.stringify(result, null, 2)}\n`
      )
    }
    return
  }
  if (command === 'extract-r2-etag') {
    process.stdout.write(
      `${extractR2Etag(readJson(path.resolve(args['--metadata'])))}\n`
    )
    return
  }
  if (command === 'extract-oss-acl') {
    const input = readJson(path.resolve(args['--acl']))
    let acl = input
    if (args['--snapshot-index'] !== undefined) {
      const journal = validateJournal(input)
      const index = Number(args['--snapshot-index'])
      if (
        !Number.isInteger(index) ||
        !journal.snapshots[index] ||
        journal.snapshots[index].provider !== 'oss'
      ) {
        throw new Error('OSS ACL snapshot index is invalid')
      }
      acl = journal.snapshots[index].acl
    }
    process.stdout.write(`${extractOssAcl(acl)}\n`)
    return
  }
  if (command === 'backup-metadata-plan') {
    const result = backupMetadataPlan(
      readJson(path.resolve(args['--metadata']))
    )
    fs.writeFileSync(
      path.resolve(args['--output']),
      `${JSON.stringify(result, null, 2)}\n`
    )
    return
  }
  if (command === 'classify-policy-rollback') {
    const policyExisted =
      args['--policy-existed'] === 'true'
        ? true
        : args['--policy-existed'] === 'false'
          ? false
          : null
    const liveState = args['--live-state']
    const result = classifyPolicyRollback({
      policyExisted,
      originalBytes: args['--original']
        ? fs.readFileSync(path.resolve(args['--original']))
        : null,
      nextBytes: fs.readFileSync(path.resolve(args['--next'])),
      liveState,
      liveBytes:
        liveState === 'exists' && args['--live']
          ? fs.readFileSync(path.resolve(args['--live']))
          : null,
    })
    fs.writeFileSync(
      path.resolve(args['--output']),
      `${JSON.stringify(result, null, 2)}\n`
    )
    return
  }
  if (command === 'verify-snapshot-readback') {
    const journal = validateJournal(
      readJson(path.resolve(args['--journal']))
    )
    const index = Number(args['--index'])
    if (!Number.isInteger(index) || !journal.snapshots[index]) {
      throw new Error('Recovery snapshot index is invalid')
    }
    const snapshot = journal.snapshots[index]
    const result = verifySnapshotReadback({
      snapshot,
      bytes: fs.readFileSync(path.resolve(args['--bytes'])),
      metadata: readJson(path.resolve(args['--metadata'])),
      acl: args['--acl']
        ? readJson(path.resolve(args['--acl']))
        : null,
    })
    if (args['--output']) {
      fs.writeFileSync(
        path.resolve(args['--output']),
        `${JSON.stringify(result, null, 2)}\n`
      )
    }
    return
  }
  if (command === 'verify-snapshot-acl') {
    const journal = validateJournal(
      readJson(path.resolve(args['--journal']))
    )
    const index = Number(args['--index'])
    const snapshot = journal.snapshots[index]
    if (
      !Number.isInteger(index) ||
      !snapshot ||
      snapshot.provider !== 'oss' ||
      !snapshot.existed ||
      extractOssAcl(
        readJson(path.resolve(args['--acl']))
      ) !== extractOssAcl(snapshot.acl)
    ) {
      throw new Error('Live OSS ACL does not match the terminal snapshot')
    }
    return
  }
  if (command === 'validate-journal') {
    validateJournal(readJson(path.resolve(args['--journal'])))
    return
  }
  if (command === 'create-journal') {
    const journal = createJournal({
      runId: args['--run-id'],
      runAttempt: args['--run-attempt'],
      targetTag: args['--target-tag'],
      targetVersion: args['--target-version'],
      sourceCommit: args['--source-commit'],
      nextPolicyBytes: fs.readFileSync(
        path.resolve(args['--next-policy'])
      ),
      createdAt: args['--created-at'],
      snapshots: readJson(path.resolve(args['--snapshots'])),
    })
    fs.writeFileSync(
      path.resolve(args['--output']),
      `${JSON.stringify(journal, null, 2)}\n`
    )
    return
  }
  if (command === 'advance-journal') {
    const immutableEntry = args['--immutable-entry']
      ? readJson(path.resolve(args['--immutable-entry']))
      : undefined
    const journal = advanceJournal(readJson(path.resolve(args['--journal'])), {
      state: args['--state'],
      checkpoint: args['--checkpoint'],
      immutableEntry,
      updatedAt: args['--updated-at'],
    })
    fs.writeFileSync(
      path.resolve(args['--output']),
      `${JSON.stringify(journal, null, 2)}\n`
    )
    return
  }
  if (command === 'terminal-recovery-plan') {
    const beforePolicyAbsent = args['--before-policy-absent'] === 'true'
    if (
      beforePolicyAbsent === Boolean(args['--before-policy']) ||
      (args['--before-policy-absent'] !== undefined &&
        args['--before-policy-absent'] !== 'true')
    ) {
      throw new Error(
        'Terminal recovery requires exactly one before-policy source'
      )
    }
    const result = terminalPromotionRecoveryPlan({
      journal: readJson(path.resolve(args['--journal'])),
      nextPolicyBytes: fs.readFileSync(path.resolve(args['--next-policy'])),
      beforePolicyBytes: beforePolicyAbsent
        ? null
        : fs.readFileSync(path.resolve(args['--before-policy'])),
      candidate: readJson(path.resolve(args['--candidate'])),
      phase: args['--phase'],
      fromVersion: args['--from-version'],
      expectedCurrent: args['--expected-current'],
      rollout: args['--rollout'],
      smokeEvidence: readJson(path.resolve(args['--smoke-evidence'])),
      healthEvidence: readJson(path.resolve(args['--health-evidence'])),
    })
    fs.writeFileSync(
      path.resolve(args['--output']),
      `${JSON.stringify(result, null, 2)}\n`
    )
    return
  }
  if (command === 'recovery-commands') {
    fs.writeFileSync(
      path.resolve(args['--output']),
      recoveryCommands(readJson(path.resolve(args['--journal'])))
    )
    return
  }
  if (command === 'resolve-split-nonterminal-journal') {
    const r2Open = readJsonBytes(
      path.resolve(args['--r2-open']),
      'R2 open promotion journal'
    )
    const ossOpen = readJsonBytes(
      path.resolve(args['--oss-open']),
      'OSS open promotion journal'
    )
    const histories = [
      [
        'R2 history for the R2 open journal',
        args['--r2-open-history-r2'],
        r2Open.bytes,
      ],
      [
        'OSS history for the R2 open journal',
        args['--r2-open-history-oss'],
        r2Open.bytes,
      ],
      [
        'R2 history for the OSS open journal',
        args['--oss-open-history-r2'],
        ossOpen.bytes,
      ],
      [
        'OSS history for the OSS open journal',
        args['--oss-open-history-oss'],
        ossOpen.bytes,
      ],
    ]
    for (const [description, file, expected] of histories) {
      if (typeof file !== 'string' || !file) {
        throw new Error(`${description} path is required`)
      }
      const actual = fs.readFileSync(path.resolve(file))
      if (!actual.equals(expected)) {
        throw new Error(`${description} does not exactly match its open journal`)
      }
    }
    const unified = r2Open.bytes.equals(ossOpen.bytes)
    const resolved = unified
      ? resolveUnifiedNonterminalJournal({
          r2Open: r2Open.value,
          ossOpen: ossOpen.value,
        })
      : resolveSplitNonterminalJournal({
          r2Open: r2Open.value,
          ossOpen: ossOpen.value,
        })
    const canonicalBytes = unified
      ? r2Open.bytes
      : resolved.canonicalProvider === 'r2'
        ? r2Open.bytes
        : ossOpen.bytes
    const previousBytes = unified
      ? canonicalBytes
      : resolved.previousProvider === 'r2'
        ? r2Open.bytes
        : ossOpen.bytes
    fs.writeFileSync(path.resolve(args['--canonical-output']), canonicalBytes)
    fs.writeFileSync(path.resolve(args['--previous-output']), previousBytes)
    fs.writeFileSync(
      path.resolve(args['--output']),
      `${JSON.stringify(
        unified
          ? {
              schema: 1,
              status: 'validated-unified-nonterminal',
              transactionId: resolved.transactionId,
              canonical: {
                provider: resolved.canonicalProvider,
                sequence: resolved.canonical.sequence,
                state: resolved.canonical.state,
              },
            }
          : {
              schema: 1,
              status: 'validated-split-nonterminal',
              transactionId: resolved.transactionId,
              previous: {
                provider: resolved.previousProvider,
                sequence: resolved.previous.sequence,
                state: resolved.previous.state,
              },
              canonical: {
                provider: resolved.canonicalProvider,
                sequence: resolved.canonical.sequence,
                state: resolved.canonical.state,
              },
            },
        null,
        2
      )}\n`
    )
    return
  }
  if (command === 'poll-url') {
    const evidence = await pollPublicBytes({
      url: args['--url'],
      expectedBytes: fs.readFileSync(path.resolve(args['--expected'])),
      timeoutMs: Number(args['--timeout-seconds'] ?? 600) * 1000,
      intervalMs: Number(args['--interval-seconds'] ?? 10) * 1000,
    })
    fs.writeFileSync(
      path.resolve(args['--output']),
      `${JSON.stringify(evidence, null, 2)}\n`
    )
    return
  }
  throw new Error(`Unknown promotion transaction command: ${command}`)
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? '')) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
