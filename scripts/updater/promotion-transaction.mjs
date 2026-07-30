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
  if (!Array.isArray(snapshots) || snapshots.length === 0) {
    throw new Error('Transaction must snapshot every mutable object')
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
  return {
    schema: 2,
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
  if (journal.schema !== 2 || !JOURNAL_STATES.includes(journal.state)) {
    throw new Error('Promotion transaction journal schema/state is invalid')
  }
  assertRunIdentity(journal.runId, journal.runAttempt)
  if (journal.transactionId !== `${journal.runId}-${journal.runAttempt}`) {
    throw new Error('Promotion transaction journal identity mismatch')
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
  if (!Array.isArray(journal.snapshots) || journal.snapshots.length === 0) {
    throw new Error('Promotion transaction snapshots are missing')
  }
  journal.snapshots.forEach((snapshot, index) =>
    validateObjectSnapshot(snapshot, `Transaction snapshot ${index}`)
  )
  if (!Array.isArray(journal.immutableLedger)) {
    throw new Error('Promotion immutable ledger must be an array')
  }
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
  const policyMatches = snapshotMatches(
    'r2',
    'biyan/updater/stable/policy.json'
  )
  const legacyOssMatches = snapshotMatches('oss', 'mita/latest.json')
  const legacyR2Matches = snapshotMatches('r2', 'mita/latest.json')
  if (
    journal.snapshots.length !== 3 ||
    policyMatches.length !== 1 ||
    legacyOssMatches.length !== 1 ||
    legacyR2Matches.length !== 1 ||
    !legacyOssMatches[0].snapshot.existed ||
    !legacyR2Matches[0].snapshot.existed
  ) {
    throw new Error(
      'Terminal promotion journal must contain exact policy and legacy snapshots'
    )
  }
  const { snapshot: policySnapshot, index: policySnapshotIndex } =
    policyMatches[0]
  const {
    snapshot: legacyOssSnapshot,
    index: legacyOssSnapshotIndex,
  } = legacyOssMatches[0]
  const {
    snapshot: legacyR2Snapshot,
    index: legacyR2SnapshotIndex,
  } = legacyR2Matches[0]
  const backupPrefix =
    `${TRANSACTION_PREFIX}/${journal.transactionId}/backups`
  if (
    policySnapshot.backupKey !==
      (policySnapshot.existed ? `${backupPrefix}/policy.json` : null) ||
    legacyOssSnapshot.backupKey !==
      `${backupPrefix}/legacy-oss.json` ||
    legacyR2Snapshot.backupKey !==
      `${backupPrefix}/legacy-r2.json`
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
    terminalState: journal.state,
    transactionId: journal.transactionId,
    policySnapshotIndex,
    legacyOssSnapshotIndex,
    legacyR2SnapshotIndex,
    beforePolicyExisted: policySnapshot.existed,
    beforeCurrentVersion,
    terminalRequest: {
      phase: targetRelease.phase,
      fromVersion: terminalFromVersion,
      expectedCurrent: beforeCurrentVersion,
      rollout: terminalRollout,
    },
    legacyTarget: {
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
  const findSnapshot = (provider, key) =>
    journal.snapshots
      .map((snapshot, index) => ({ snapshot, index }))
      .filter(
        ({ snapshot }) =>
          snapshot.provider === provider && snapshot.key === key
      )
  const policyMatches = findSnapshot(
    'r2',
    'biyan/updater/stable/policy.json'
  )
  const legacyOssMatches = findSnapshot('oss', 'mita/latest.json')
  const legacyR2Matches = findSnapshot('r2', 'mita/latest.json')
  if (
    journal.snapshots.length !== 3 ||
    policyMatches.length !== 1 ||
    legacyOssMatches.length !== 1 ||
    legacyR2Matches.length !== 1 ||
    !legacyOssMatches[0].snapshot.existed ||
    !legacyR2Matches[0].snapshot.existed
  ) {
    throw new Error(
      'Recovery journal must contain exactly policy and dual legacy snapshots'
    )
  }
  const { snapshot: policy, index: policyIndex } = policyMatches[0]
  const { snapshot: legacyOss, index: legacyOssIndex } =
    legacyOssMatches[0]
  const { snapshot: legacyR2, index: legacyR2Index } =
    legacyR2Matches[0]
  const q = shellQuote
  const terminalHistoryKey =
    `${TRANSACTION_PREFIX}/${journal.transactionId}/journal-` +
    `${String(journal.sequence).padStart(4, '0')}.json`
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
    const objectKey = `${entry.provider}\0${entry.key}`
    if (cleanupKeys.has(objectKey)) {
      throw new Error(
        `Recovery journal contains duplicate verified immutable object ${entry.provider}:${entry.key}`
      )
    }
    cleanupKeys.add(objectKey)
  }
  const unverifiedLedger = journal.immutableLedger.filter(
    (item, index, entries) =>
      item.createdByTransaction &&
      !item.verified &&
      !entries
        .slice(index + 1)
        .some(
          (later) =>
            later.createdByTransaction &&
            later.verified &&
            sameImmutableObject(item, later)
        )
  )
  const lines = [
    '#!/usr/bin/env bash',
    '# Generated from the durable promotion journal; run only in release-distribution recovery.',
    '# Classification is intentionally complete before RECOVERY MUTATIONS BEGIN.',
    'set -euo pipefail',
    ': "${CLOUDFLARE_R2_ACCOUNT_ID:?}"',
    ': "${CLOUDFLARE_R2_BUCKET:?}"',
    ': "${ALIYUN_OSS_BUCKET:?}"',
    ': "${ALIYUN_OSS_ENDPOINT:?}"',
    ': "${ALIYUN_REGION:?}"',
    ': "${LEGACY_ALIYUN_URL:?}"',
    ': "${LEGACY_R2_URL:?}"',
    'JOURNAL="${JOURNAL:-promotion-journal.json}"',
    'test -s "$JOURNAL"',
    'node scripts/updater/promotion-transaction.mjs validate-journal --journal "$JOURNAL"',
    'r2_endpoint="https://${CLOUDFLARE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com"',
    'oss_endpoint="${ALIYUN_OSS_ENDPOINT#https://}"',
    'oss_endpoint="https://${oss_endpoint#http://}"',
    '# Fail closed before network access if this AWS CLI lacks required CAS inputs.',
    'put_skeleton="$(aws s3api put-object --generate-cli-skeleton input)"',
    'delete_skeleton="$(aws s3api delete-object --generate-cli-skeleton input)"',
    'jq -e \'has("IfMatch") and has("IfNoneMatch")\' <<<"$put_skeleton" >/dev/null || exit 1',
    'jq -e \'has("IfMatch")\' <<<"$delete_skeleton" >/dev/null || exit 1',
    'unset put_skeleton delete_skeleton',
    `transaction_id=${q(journal.transactionId)}`,
    `policy_existed=${q(policy.existed)}`,
    'mkdir -p recovery-readback/{backups,live,decisions,plans,ledger}',
    'probe_r2_recovery() {',
    '  local key="$1" name="$2" rc',
    '  if aws s3api head-object --bucket "$CLOUDFLARE_R2_BUCKET" --key "$key" --endpoint-url "$r2_endpoint" >"recovery-readback/${name}.stdout" 2>"recovery-readback/${name}.stderr"; then',
    '    rc=0',
    '  else',
    '    rc=$?',
    '  fi',
    '  node scripts/updater/promotion-transaction.mjs classify-probe --provider r2 --key "$key" --exit-code "$rc" --stdout "recovery-readback/${name}.stdout" --stderr "recovery-readback/${name}.stderr" --output "recovery-readback/${name}.json"',
    '}',
    'probe_oss_recovery() {',
    '  local key="$1" name="$2" rc',
    '  if ossutil api head-object --bucket "$ALIYUN_OSS_BUCKET" --key "$key" --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" --output-format json --quiet >"recovery-readback/${name}.stdout" 2>"recovery-readback/${name}.stderr"; then',
    '    rc=0',
    '  else',
    '    rc=$?',
    '  fi',
    '  node scripts/updater/promotion-transaction.mjs classify-probe --provider oss --key "$key" --exit-code "$rc" --stdout "recovery-readback/${name}.stdout" --stderr "recovery-readback/${name}.stderr" --output "recovery-readback/${name}.json"',
    '}',
    '# Recover the exact content-addressed next policy from both clouds.',
    `next_policy_key=${q(journal.nextPolicy.key)}`,
    `next_policy_sha256=${q(journal.nextPolicy.sha256)}`,
    'aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" --key "$next_policy_key" --endpoint-url "$r2_endpoint" recovery-readback/next-policy-r2.json > recovery-readback/next-policy-r2-metadata.json',
    'ossutil cp "oss://${ALIYUN_OSS_BUCKET}/${next_policy_key}" recovery-readback/next-policy-oss.json --force --endpoint "$oss_endpoint" --region "$ALIYUN_REGION"',
    'ossutil api head-object --bucket "$ALIYUN_OSS_BUCKET" --key "$next_policy_key" --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" --output-format json --quiet > recovery-readback/next-policy-oss-metadata.json',
    'cmp recovery-readback/next-policy-r2.json recovery-readback/next-policy-oss.json',
    'test "$(sha256sum recovery-readback/next-policy-r2.json | cut -d\' \' -f1)" = "$next_policy_sha256"',
    'node scripts/updater/promotion-transaction.mjs backup-metadata-plan --metadata recovery-readback/next-policy-r2-metadata.json --output recovery-readback/plans/next-policy-r2.json',
    'node scripts/updater/promotion-transaction.mjs backup-metadata-plan --metadata recovery-readback/next-policy-oss-metadata.json --output recovery-readback/plans/next-policy-oss.json',
    'jq -e \'.contentType == "application/json" and .cacheControl == "no-store"\' recovery-readback/plans/next-policy-r2.json >/dev/null',
    'jq -e \'.contentType == "application/json" and .cacheControl == "no-store"\' recovery-readback/plans/next-policy-oss.json >/dev/null',
    'NEXT_POLICY=recovery-readback/next-policy-r2.json',
    '# Verify every immutable backup before inspecting or mutating live state.',
  ]

  for (const [index, snapshot] of journal.snapshots.entries()) {
    if (!snapshot.existed) continue
    if (snapshot.provider === 'r2') {
      lines.push(
        `aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" --key ${q(snapshot.backupKey)} --endpoint-url "$r2_endpoint" "recovery-readback/backups/${index}" > "recovery-readback/backups/${index}-metadata.json"`,
        `node scripts/updater/promotion-transaction.mjs verify-snapshot-readback --journal "$JOURNAL" --index ${q(index)} --bytes "recovery-readback/backups/${index}" --metadata "recovery-readback/backups/${index}-metadata.json" --output "recovery-readback/backups/${index}-verified.json"`
      )
    } else {
      lines.push(
        `ossutil cp "oss://\${ALIYUN_OSS_BUCKET}/${snapshot.backupKey}" "recovery-readback/backups/${index}" --force --endpoint "$oss_endpoint" --region "$ALIYUN_REGION"`,
        `ossutil api head-object --bucket "$ALIYUN_OSS_BUCKET" --key ${q(snapshot.backupKey)} --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" --output-format json --quiet > "recovery-readback/backups/${index}-metadata.json"`,
        `ossutil api get-object-acl --bucket "$ALIYUN_OSS_BUCKET" --key ${q(snapshot.backupKey)} --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" --output-format json --quiet > "recovery-readback/backups/${index}-acl.json"`,
        `node scripts/updater/promotion-transaction.mjs verify-snapshot-readback --journal "$JOURNAL" --index ${q(index)} --bytes "recovery-readback/backups/${index}" --metadata "recovery-readback/backups/${index}-metadata.json" --acl "recovery-readback/backups/${index}-acl.json" --output "recovery-readback/backups/${index}-verified.json"`
      )
    }
    lines.push(
      `node scripts/updater/promotion-transaction.mjs backup-metadata-plan --metadata "recovery-readback/backups/${index}-metadata.json" --output "recovery-readback/plans/${index}.json"`
    )
  }

  lines.push(
    '# Bind recovery to every still-present copy of the transaction lock.',
    `probe_r2_recovery ${q(OPEN_TRANSACTION_KEY)} initial-open-r2`,
    `probe_oss_recovery ${q(OPEN_TRANSACTION_KEY)} initial-open-oss`,
    'open_r2_state="$(jq -er .state recovery-readback/initial-open-r2.json)"',
    'open_oss_state="$(jq -er .state recovery-readback/initial-open-oss.json)"',
    'open_lock_present=false',
    'if [[ "$open_r2_state" == exists ]]; then',
    `  aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" --key ${q(OPEN_TRANSACTION_KEY)} --endpoint-url "$r2_endpoint" recovery-readback/live/open-r2.json > recovery-readback/live/open-r2-metadata.json`,
    '  cmp "$JOURNAL" recovery-readback/live/open-r2.json',
    '  test "$(jq -er .transactionId recovery-readback/live/open-r2.json)" = "$transaction_id"',
    '  node scripts/updater/promotion-transaction.mjs backup-metadata-plan --metadata recovery-readback/live/open-r2-metadata.json --output recovery-readback/plans/open-r2.json',
    '  jq -e \'.contentType == "application/json" and .cacheControl == "no-store"\' recovery-readback/plans/open-r2.json >/dev/null',
    '  open_lock_present=true',
    'else',
    '  test "$open_r2_state" = absent',
    'fi',
    'if [[ "$open_oss_state" == exists ]]; then',
    `  ossutil cp "oss://\${ALIYUN_OSS_BUCKET}/${OPEN_TRANSACTION_KEY}" recovery-readback/live/open-oss.json --force --endpoint "$oss_endpoint" --region "$ALIYUN_REGION"`,
    `  ossutil api head-object --bucket "$ALIYUN_OSS_BUCKET" --key ${q(OPEN_TRANSACTION_KEY)} --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" --output-format json --quiet > recovery-readback/live/open-oss-metadata.json`,
    '  cmp "$JOURNAL" recovery-readback/live/open-oss.json',
    '  test "$(jq -er .transactionId recovery-readback/live/open-oss.json)" = "$transaction_id"',
    '  node scripts/updater/promotion-transaction.mjs backup-metadata-plan --metadata recovery-readback/live/open-oss-metadata.json --output recovery-readback/plans/open-oss.json',
    '  jq -e \'.contentType == "application/json" and .cacheControl == "no-store"\' recovery-readback/plans/open-oss.json >/dev/null',
    '  open_lock_present=true',
    'else',
    '  test "$open_oss_state" = absent',
    'fi',
    '# Classify policy.',
    `probe_r2_recovery ${q(policy.key)} live-policy-probe`,
    'policy_live_state="$(jq -er .state recovery-readback/live-policy-probe.json)"'
  )
  if (policy.existed) {
    lines.push('test "$policy_live_state" = exists')
  }
  lines.push(
    'policy_classify_args=(classify-policy-rollback',
    `  --policy-existed ${q(policy.existed)}`,
    '  --next "$NEXT_POLICY"',
    '  --live-state "$policy_live_state"',
    '  --output recovery-readback/decisions/policy.json)',
    'if [[ "$policy_live_state" == exists ]]; then',
    `  aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" --key ${q(policy.key)} --endpoint-url "$r2_endpoint" recovery-readback/live/policy.json > recovery-readback/live/policy-metadata.json`,
    '  policy_classify_args+=(--live recovery-readback/live/policy.json)',
    'fi'
  )
  if (policy.existed) {
    lines.push(
      `policy_classify_args+=(--original "recovery-readback/backups/${policyIndex}")`
    )
  }
  lines.push(
    'node scripts/updater/promotion-transaction.mjs "${policy_classify_args[@]}"',
    '# Classify both legacy origins against the exact next-policy A bridge.',
    'legacy_target_key="$(jq -er \'.legacyBridgeVersion as $version | .releases[$version].manifestKey\' "$NEXT_POLICY")"',
    'legacy_target_sha256="$(jq -er \'.legacyBridgeVersion as $version | .releases[$version].manifestSha256\' "$NEXT_POLICY")"',
    'probe_oss_recovery "$legacy_target_key" legacy-target-oss-probe',
    'probe_r2_recovery "$legacy_target_key" legacy-target-r2-probe',
    'legacy_target_oss_state="$(jq -er .state recovery-readback/legacy-target-oss-probe.json)"',
    'legacy_target_r2_state="$(jq -er .state recovery-readback/legacy-target-r2-probe.json)"',
    `ossutil cp "oss://\${ALIYUN_OSS_BUCKET}/${legacyOss.key}" recovery-readback/live/legacy-oss.json --force --endpoint "$oss_endpoint" --region "$ALIYUN_REGION"`,
    `aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" --key ${q(legacyR2.key)} --endpoint-url "$r2_endpoint" recovery-readback/live/legacy-r2.json > recovery-readback/live/legacy-r2-metadata.json`,
    'if [[ "$legacy_target_oss_state" == exists && "$legacy_target_r2_state" == exists ]]; then',
    '  ossutil cp "oss://${ALIYUN_OSS_BUCKET}/${legacy_target_key}" recovery-readback/live/legacy-target-oss.json --force --endpoint "$oss_endpoint" --region "$ALIYUN_REGION"',
    '  aws s3 cp "s3://${CLOUDFLARE_R2_BUCKET}/${legacy_target_key}" recovery-readback/live/legacy-target-r2.json --endpoint-url "$r2_endpoint"',
    '  cmp recovery-readback/live/legacy-target-oss.json recovery-readback/live/legacy-target-r2.json',
    '  test "$(sha256sum recovery-readback/live/legacy-target-oss.json | cut -d\' \' -f1)" = "$legacy_target_sha256"',
    `  if cmp -s "recovery-readback/backups/${legacyOssIndex}" recovery-readback/live/legacy-target-oss.json; then`,
    `  cmp "recovery-readback/backups/${legacyOssIndex}" recovery-readback/live/legacy-oss.json`,
    '    jq -n \'{action:"no-change",reason:"target-already-equals-snapshot"}\' > recovery-readback/decisions/legacy-oss.json',
    '  else',
    `    node scripts/updater/legacy-pause-transaction.mjs classify-rollback --object-kind legacy-oss --live-state exists --live recovery-readback/live/legacy-oss.json --before "recovery-readback/backups/${legacyOssIndex}" --paused recovery-readback/live/legacy-target-oss.json --output recovery-readback/decisions/legacy-oss.json`,
    '  fi',
    `  if cmp -s "recovery-readback/backups/${legacyR2Index}" recovery-readback/live/legacy-target-r2.json; then`,
    `  cmp "recovery-readback/backups/${legacyR2Index}" recovery-readback/live/legacy-r2.json`,
    '    jq -n \'{action:"no-change",reason:"target-already-equals-snapshot"}\' > recovery-readback/decisions/legacy-r2.json',
    '  else',
    `    node scripts/updater/legacy-pause-transaction.mjs classify-rollback --object-kind legacy-r2 --live-state exists --live recovery-readback/live/legacy-r2.json --before "recovery-readback/backups/${legacyR2Index}" --paused recovery-readback/live/legacy-target-r2.json --output recovery-readback/decisions/legacy-r2.json`,
    '  fi',
    'elif [[ "$legacy_target_oss_state" == absent && "$legacy_target_r2_state" == absent ]]; then',
    `  test ${q(cleanupLedger.length)} -eq 0`,
    '  # A pre-create failure may omit the target manifest only when every',
    '  # unverified create intent is still absent and live legacy state is the',
    '  # exact durable snapshot. Any partial target or mutable drift is unsafe.'
  )
  for (const [index, entry] of unverifiedLedger.entries()) {
    const probeName = `missing-target-unverified-${index}-${entry.provider}`
    lines.push(
      `  probe_${entry.provider}_recovery ${q(entry.key)} ${q(probeName)}`,
      `  jq -e '.state == "absent"' recovery-readback/${probeName}.json >/dev/null`
    )
  }
  lines.push(
    `  ossutil api head-object --bucket "$ALIYUN_OSS_BUCKET" --key ${q(legacyOss.key)} --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" --output-format json --quiet > recovery-readback/live/legacy-oss-metadata.json`,
    `  ossutil api get-object-acl --bucket "$ALIYUN_OSS_BUCKET" --key ${q(legacyOss.key)} --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" --output-format json --quiet > recovery-readback/live/legacy-oss-acl.json`,
    `  node scripts/updater/promotion-transaction.mjs verify-snapshot-readback --journal "$JOURNAL" --index ${q(legacyOssIndex)} --bytes recovery-readback/live/legacy-oss.json --metadata recovery-readback/live/legacy-oss-metadata.json --acl recovery-readback/live/legacy-oss-acl.json --output recovery-readback/missing-target-legacy-oss-verified.json`,
    `  node scripts/updater/promotion-transaction.mjs verify-snapshot-readback --journal "$JOURNAL" --index ${q(legacyR2Index)} --bytes recovery-readback/live/legacy-r2.json --metadata recovery-readback/live/legacy-r2-metadata.json --output recovery-readback/missing-target-legacy-r2-verified.json`,
    '  jq -n \'{action:"no-change",reason:"target-never-created-live-equals-snapshot"}\' > recovery-readback/decisions/legacy-oss.json',
    '  jq -n \'{action:"no-change",reason:"target-never-created-live-equals-snapshot"}\' > recovery-readback/decisions/legacy-r2.json',
    'else',
    '  echo "Legacy target manifest presence differs across recovery stores" >&2',
    '  exit 1',
    'fi',
    '# Classify every immutable object before any deletion or restore.',
    'ledger_cleanup_pending=false'
  )

  for (const [index, entry] of cleanupLedger.entries()) {
    const probeName = `initial-ledger-${index}-${entry.provider}`
    if (entry.provider === 'r2') {
      lines.push(
        `probe_r2_recovery ${q(entry.key)} ${q(probeName)}`,
        `ledger_state="$(jq -er .state recovery-readback/${probeName}.json)"`,
        `printf '%s\\n' "$ledger_state" > "recovery-readback/ledger/${index}-state"`,
        'if [[ "$ledger_state" == exists ]]; then',
        `  aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" --key ${q(entry.key)} --endpoint-url "$r2_endpoint" "recovery-readback/ledger/${index}" > "recovery-readback/ledger/${index}-metadata.json"`
      )
    } else {
      lines.push(
        `probe_oss_recovery ${q(entry.key)} ${q(probeName)}`,
        `ledger_state="$(jq -er .state recovery-readback/${probeName}.json)"`,
        `printf '%s\\n' "$ledger_state" > "recovery-readback/ledger/${index}-state"`,
        'if [[ "$ledger_state" == exists ]]; then',
        `  ossutil cp "oss://\${ALIYUN_OSS_BUCKET}/${entry.key}" "recovery-readback/ledger/${index}" --force --endpoint "$oss_endpoint" --region "$ALIYUN_REGION"`,
        `  ossutil api head-object --bucket "$ALIYUN_OSS_BUCKET" --key ${q(entry.key)} --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" --output-format json --quiet > "recovery-readback/ledger/${index}-metadata.json"`
      )
    }
    lines.push(
      `  test "$(sha256sum "recovery-readback/ledger/${index}" | cut -d' ' -f1)" = ${q(entry.sha256)}`,
      `  node scripts/updater/promotion-transaction.mjs backup-metadata-plan --metadata "recovery-readback/ledger/${index}-metadata.json" --output "recovery-readback/ledger/${index}-metadata-plan.json"`,
      `  jq -e --arg contentType ${q(entry.contentType)} --arg cacheControl ${q(entry.cacheControl)} '.contentType == $contentType and .cacheControl == $cacheControl' "recovery-readback/ledger/${index}-metadata-plan.json" >/dev/null`,
      '  ledger_cleanup_pending=true',
      'else',
      '  test "$ledger_state" = absent',
      'fi'
    )
  }

  lines.push(
    'recovery_mutation_needed=false',
    'if [[ "$(jq -r .action recovery-readback/decisions/policy.json)" == restore ]]; then recovery_mutation_needed=true; fi',
    'if [[ "$(jq -r .action recovery-readback/decisions/legacy-oss.json)" == restore ]]; then recovery_mutation_needed=true; fi',
    'if [[ "$(jq -r .action recovery-readback/decisions/legacy-r2.json)" == restore ]]; then recovery_mutation_needed=true; fi',
    'if [[ "$ledger_cleanup_pending" == true ]]; then recovery_mutation_needed=true; fi',
    'if [[ "$open_lock_present" != true ]]; then',
    '  if [[ "$recovery_mutation_needed" == true ]]; then',
    '    echo "Both transaction locks are absent while recovery mutations remain; refusing unlocked recovery." >&2',
    '    exit 1',
    '  fi',
    '  test "$(jq -r .action recovery-readback/decisions/policy.json)" = no-change',
    '  test "$(jq -r .action recovery-readback/decisions/legacy-oss.json)" = no-change',
    '  test "$(jq -r .action recovery-readback/decisions/legacy-r2.json)" = no-change',
    '  # Prove exact mutable bytes, metadata, and ACL without a recovery lock.',
    '  if [[ "$policy_existed" == true ]]; then',
    `    node scripts/updater/promotion-transaction.mjs verify-snapshot-readback --journal "$JOURNAL" --index ${q(policyIndex)} --bytes recovery-readback/live/policy.json --metadata recovery-readback/live/policy-metadata.json --output recovery-readback/no-lock-policy-verified.json`,
    '  else',
    `    probe_r2_recovery ${q(policy.key)} no-lock-policy-absent`,
    '    jq -e \'.state == "absent"\' recovery-readback/no-lock-policy-absent.json >/dev/null',
    '  fi',
    `  ossutil api head-object --bucket "$ALIYUN_OSS_BUCKET" --key ${q(legacyOss.key)} --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" --output-format json --quiet > recovery-readback/live/legacy-oss-metadata.json`,
    `  ossutil api get-object-acl --bucket "$ALIYUN_OSS_BUCKET" --key ${q(legacyOss.key)} --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" --output-format json --quiet > recovery-readback/live/legacy-oss-acl.json`,
    `  node scripts/updater/promotion-transaction.mjs verify-snapshot-readback --journal "$JOURNAL" --index ${q(legacyOssIndex)} --bytes recovery-readback/live/legacy-oss.json --metadata recovery-readback/live/legacy-oss-metadata.json --acl recovery-readback/live/legacy-oss-acl.json --output recovery-readback/no-lock-legacy-oss-verified.json`,
    `  node scripts/updater/promotion-transaction.mjs verify-snapshot-readback --journal "$JOURNAL" --index ${q(legacyR2Index)} --bytes recovery-readback/live/legacy-r2.json --metadata recovery-readback/live/legacy-r2-metadata.json --output recovery-readback/no-lock-legacy-r2-verified.json`,
    '  # Anchor the local journal to its exact immutable dual-cloud history.',
    `  terminal_history_key=${q(terminalHistoryKey)}`,
    '  aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" --key "$terminal_history_key" --endpoint-url "$r2_endpoint" recovery-readback/no-lock-history-r2.json > recovery-readback/no-lock-history-r2-metadata.json',
    '  ossutil cp "oss://${ALIYUN_OSS_BUCKET}/${terminal_history_key}" recovery-readback/no-lock-history-oss.json --force --endpoint "$oss_endpoint" --region "$ALIYUN_REGION"',
    '  ossutil api head-object --bucket "$ALIYUN_OSS_BUCKET" --key "$terminal_history_key" --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" --output-format json --quiet > recovery-readback/no-lock-history-oss-metadata.json',
    '  cmp "$JOURNAL" recovery-readback/no-lock-history-r2.json',
    '  cmp "$JOURNAL" recovery-readback/no-lock-history-oss.json',
    '  node scripts/updater/promotion-transaction.mjs backup-metadata-plan --metadata recovery-readback/no-lock-history-r2-metadata.json --output recovery-readback/plans/no-lock-history-r2.json',
    '  node scripts/updater/promotion-transaction.mjs backup-metadata-plan --metadata recovery-readback/no-lock-history-oss-metadata.json --output recovery-readback/plans/no-lock-history-oss.json',
    '  jq -e \'.contentType == "application/json" and .cacheControl == "no-store"\' recovery-readback/plans/no-lock-history-r2.json >/dev/null',
    '  jq -e \'.contentType == "application/json" and .cacheControl == "no-store"\' recovery-readback/plans/no-lock-history-oss.json >/dev/null',
    '  # A lock-free rerun may only confirm already-complete public state.',
    `  node scripts/updater/promotion-transaction.mjs poll-url --url "$LEGACY_ALIYUN_URL" --expected "recovery-readback/backups/${legacyOssIndex}" --timeout-seconds 600 --interval-seconds 10 --output recovery-readback/no-lock-legacy-aliyun-cdn.json`,
    `  node scripts/updater/promotion-transaction.mjs poll-url --url "$LEGACY_R2_URL" --expected "recovery-readback/backups/${legacyR2Index}" --timeout-seconds 600 --interval-seconds 10 --output recovery-readback/no-lock-legacy-r2-cdn.json`,
    '  # Close the read-only proof with fresh origin reads after CDN polling.',
    '  if [[ "$policy_existed" == true ]]; then',
    `    aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" --key ${q(policy.key)} --endpoint-url "$r2_endpoint" recovery-readback/no-lock-final-policy.json > recovery-readback/no-lock-final-policy-metadata.json`,
    `    node scripts/updater/promotion-transaction.mjs verify-snapshot-readback --journal "$JOURNAL" --index ${q(policyIndex)} --bytes recovery-readback/no-lock-final-policy.json --metadata recovery-readback/no-lock-final-policy-metadata.json --output recovery-readback/no-lock-final-policy-verified.json`,
    '  else',
    `    probe_r2_recovery ${q(policy.key)} no-lock-final-policy-absent`,
    '    jq -e \'.state == "absent"\' recovery-readback/no-lock-final-policy-absent.json >/dev/null',
    '  fi',
    `  ossutil cp "oss://\${ALIYUN_OSS_BUCKET}/${legacyOss.key}" recovery-readback/no-lock-final-legacy-oss.json --force --endpoint "$oss_endpoint" --region "$ALIYUN_REGION"`,
    `  ossutil api head-object --bucket "$ALIYUN_OSS_BUCKET" --key ${q(legacyOss.key)} --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" --output-format json --quiet > recovery-readback/no-lock-final-legacy-oss-metadata.json`,
    `  ossutil api get-object-acl --bucket "$ALIYUN_OSS_BUCKET" --key ${q(legacyOss.key)} --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" --output-format json --quiet > recovery-readback/no-lock-final-legacy-oss-acl.json`,
    `  node scripts/updater/promotion-transaction.mjs verify-snapshot-readback --journal "$JOURNAL" --index ${q(legacyOssIndex)} --bytes recovery-readback/no-lock-final-legacy-oss.json --metadata recovery-readback/no-lock-final-legacy-oss-metadata.json --acl recovery-readback/no-lock-final-legacy-oss-acl.json --output recovery-readback/no-lock-final-legacy-oss-verified.json`,
    `  aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" --key ${q(legacyR2.key)} --endpoint-url "$r2_endpoint" recovery-readback/no-lock-final-legacy-r2.json > recovery-readback/no-lock-final-legacy-r2-metadata.json`,
    `  node scripts/updater/promotion-transaction.mjs verify-snapshot-readback --journal "$JOURNAL" --index ${q(legacyR2Index)} --bytes recovery-readback/no-lock-final-legacy-r2.json --metadata recovery-readback/no-lock-final-legacy-r2-metadata.json --output recovery-readback/no-lock-final-legacy-r2-verified.json`
  )
  for (const [index, entry] of cleanupLedger.entries()) {
    const finalProbeName =
      `no-lock-final-ledger-${index}-${entry.provider}`
    lines.push(
      `  probe_${entry.provider}_recovery ${q(entry.key)} ${q(finalProbeName)}`,
      `  jq -e '.state == "absent"' recovery-readback/${finalProbeName}.json >/dev/null`
    )
  }
  lines.push(
    `  probe_r2_recovery ${q(OPEN_TRANSACTION_KEY)} no-lock-final-r2`,
    `  probe_oss_recovery ${q(OPEN_TRANSACTION_KEY)} no-lock-final-oss`,
    '  jq -e \'.state == "absent"\' recovery-readback/no-lock-final-r2.json >/dev/null',
    '  jq -e \'.state == "absent"\' recovery-readback/no-lock-final-oss.json >/dev/null',
    '  echo "Recovery already complete; both transaction locks and every ledger object are absent."',
    '  exit 0',
    'fi',
    '# RECOVERY MUTATIONS BEGIN: every mutable object is now classified.',
    '# Re-probe both locks at the mutation boundary; initial state is stale now.',
    `probe_r2_recovery ${q(OPEN_TRANSACTION_KEY)} boundary-open-r2`,
    `probe_oss_recovery ${q(OPEN_TRANSACTION_KEY)} boundary-open-oss`,
    'open_r2_state="$(jq -er .state recovery-readback/boundary-open-r2.json)"',
    'open_oss_state="$(jq -er .state recovery-readback/boundary-open-oss.json)"',
    'if [[ "$open_r2_state" == exists ]]; then',
    `  aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" --key ${q(OPEN_TRANSACTION_KEY)} --endpoint-url "$r2_endpoint" recovery-readback/live/open-r2-boundary.json > recovery-readback/live/open-r2-boundary-metadata.json`,
    '  cmp "$JOURNAL" recovery-readback/live/open-r2-boundary.json',
    '  test "$(jq -er .transactionId recovery-readback/live/open-r2-boundary.json)" = "$transaction_id"',
    '  node scripts/updater/promotion-transaction.mjs backup-metadata-plan --metadata recovery-readback/live/open-r2-boundary-metadata.json --output recovery-readback/plans/open-r2-boundary.json',
    '  jq -e \'.contentType == "application/json" and .cacheControl == "no-store"\' recovery-readback/plans/open-r2-boundary.json >/dev/null',
    'else',
    '  test "$open_r2_state" = absent',
    'fi',
    'if [[ "$open_oss_state" == exists ]]; then',
    `  ossutil cp "oss://\${ALIYUN_OSS_BUCKET}/${OPEN_TRANSACTION_KEY}" recovery-readback/live/open-oss-boundary.json --force --endpoint "$oss_endpoint" --region "$ALIYUN_REGION"`,
    `  ossutil api head-object --bucket "$ALIYUN_OSS_BUCKET" --key ${q(OPEN_TRANSACTION_KEY)} --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" --output-format json --quiet > recovery-readback/live/open-oss-boundary-metadata.json`,
    '  cmp "$JOURNAL" recovery-readback/live/open-oss-boundary.json',
    '  test "$(jq -er .transactionId recovery-readback/live/open-oss-boundary.json)" = "$transaction_id"',
    '  node scripts/updater/promotion-transaction.mjs backup-metadata-plan --metadata recovery-readback/live/open-oss-boundary-metadata.json --output recovery-readback/plans/open-oss-boundary.json',
    '  jq -e \'.contentType == "application/json" and .cacheControl == "no-store"\' recovery-readback/plans/open-oss-boundary.json >/dev/null',
    'else',
    '  test "$open_oss_state" = absent',
    'fi',
    'if [[ "$open_r2_state" == absent && "$open_oss_state" == absent ]]; then',
    '  echo "Both transaction locks disappeared before the mutation boundary; rerun for lock-free verification." >&2',
    '  exit 1',
    'fi',
    'if [[ "$recovery_mutation_needed" == true ]]; then',
    '  # Repair a current split lock create-only before product/cleanup mutation.',
    '  if [[ "$open_r2_state" == absent ]]; then',
    `    aws s3api put-object --bucket "$CLOUDFLARE_R2_BUCKET" --key ${q(OPEN_TRANSACTION_KEY)} --body "$JOURNAL" --content-type application/json --cache-control no-store --if-none-match '*' --endpoint-url "$r2_endpoint" >/dev/null`,
    '  fi',
    '  if [[ "$open_oss_state" == absent ]]; then',
    `    ossutil api put-object --bucket "$ALIYUN_OSS_BUCKET" --key ${q(OPEN_TRANSACTION_KEY)} --body "file://$JOURNAL" --content-type application/json --cache-control no-store --object-acl default --forbid-overwrite true --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" --output-format json --quiet >/dev/null`,
    '  fi',
    `  aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" --key ${q(OPEN_TRANSACTION_KEY)} --endpoint-url "$r2_endpoint" recovery-readback/live/open-r2-repaired.json > recovery-readback/live/open-r2-repaired-metadata.json`,
    `  ossutil cp "oss://\${ALIYUN_OSS_BUCKET}/${OPEN_TRANSACTION_KEY}" recovery-readback/live/open-oss-repaired.json --force --endpoint "$oss_endpoint" --region "$ALIYUN_REGION"`,
    `  ossutil api head-object --bucket "$ALIYUN_OSS_BUCKET" --key ${q(OPEN_TRANSACTION_KEY)} --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" --output-format json --quiet > recovery-readback/live/open-oss-repaired-metadata.json`,
    '  cmp "$JOURNAL" recovery-readback/live/open-r2-repaired.json',
    '  cmp "$JOURNAL" recovery-readback/live/open-oss-repaired.json',
    '  test "$(jq -er .transactionId recovery-readback/live/open-r2-repaired.json)" = "$transaction_id"',
    '  test "$(jq -er .transactionId recovery-readback/live/open-oss-repaired.json)" = "$transaction_id"',
    '  node scripts/updater/promotion-transaction.mjs backup-metadata-plan --metadata recovery-readback/live/open-r2-repaired-metadata.json --output recovery-readback/plans/open-r2-repaired.json',
    '  node scripts/updater/promotion-transaction.mjs backup-metadata-plan --metadata recovery-readback/live/open-oss-repaired-metadata.json --output recovery-readback/plans/open-oss-repaired.json',
    '  jq -e \'.contentType == "application/json" and .cacheControl == "no-store"\' recovery-readback/plans/open-r2-repaired.json >/dev/null',
    '  jq -e \'.contentType == "application/json" and .cacheControl == "no-store"\' recovery-readback/plans/open-oss-repaired.json >/dev/null',
    'fi',
    'legacy_restored=false',
    'legacy_oss_restore_needed=false',
    'legacy_r2_restore_needed=false',
    '# Re-read both legacy origins before the first recovery write.',
    'if [[ "$(jq -r .action recovery-readback/decisions/legacy-oss.json)" == restore ]]; then',
    `  ossutil cp "oss://\${ALIYUN_OSS_BUCKET}/${legacyOss.key}" recovery-readback/live/legacy-oss-prewrite.json --force --endpoint "$oss_endpoint" --region "$ALIYUN_REGION"`,
    '  cmp recovery-readback/live/legacy-oss.json recovery-readback/live/legacy-oss-prewrite.json',
    `  legacy_oss_acl="$(node scripts/updater/promotion-transaction.mjs extract-oss-acl --acl "$JOURNAL" --snapshot-index ${q(legacyOssIndex)})"`,
    '  case "$legacy_oss_acl" in default|private|public-read) ;; *) echo "Unsafe ACL in journal" >&2; exit 1;; esac',
    '  legacy_oss_restore_needed=true',
    'fi',
    'if [[ "$(jq -r .action recovery-readback/decisions/legacy-r2.json)" == restore ]]; then',
    `  aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" --key ${q(legacyR2.key)} --endpoint-url "$r2_endpoint" recovery-readback/live/legacy-r2-prewrite.json > recovery-readback/live/legacy-r2-prewrite-metadata.json`,
    '  cmp recovery-readback/live/legacy-r2.json recovery-readback/live/legacy-r2-prewrite.json',
    '  legacy_r2_etag="$(node scripts/updater/promotion-transaction.mjs extract-r2-etag --metadata recovery-readback/live/legacy-r2-prewrite-metadata.json)"',
    '  legacy_r2_restore_needed=true',
    'fi',
    'if [[ "$legacy_oss_restore_needed" == true ]]; then',
    `  ossutil api put-object --bucket "$ALIYUN_OSS_BUCKET" --key ${q(legacyOss.key)} --body "file://recovery-readback/backups/${legacyOssIndex}" --content-type "$(jq -er .contentType recovery-readback/plans/${legacyOssIndex}.json)" --cache-control "$(jq -er .cacheControl recovery-readback/plans/${legacyOssIndex}.json)" --object-acl "$legacy_oss_acl" --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" --output-format json --quiet >/dev/null`,
    '  legacy_restored=true',
    'fi',
    'if [[ "$legacy_r2_restore_needed" == true ]]; then',
    `  aws s3api put-object --bucket "$CLOUDFLARE_R2_BUCKET" --key ${q(legacyR2.key)} --body "recovery-readback/backups/${legacyR2Index}" --content-type "$(jq -er .contentType recovery-readback/plans/${legacyR2Index}.json)" --cache-control "$(jq -er .cacheControl recovery-readback/plans/${legacyR2Index}.json)" --if-match "$legacy_r2_etag" --endpoint-url "$r2_endpoint" >/dev/null`,
    '  legacy_restored=true',
    'fi',
    '# Verify both legacy origins before the policy is restored.',
    `ossutil cp "oss://\${ALIYUN_OSS_BUCKET}/${legacyOss.key}" "recovery-readback/oss-${legacyOssIndex}" --force --endpoint "$oss_endpoint" --region "$ALIYUN_REGION"`,
    `ossutil api head-object --bucket "$ALIYUN_OSS_BUCKET" --key ${q(legacyOss.key)} --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" --output-format json --quiet > "recovery-readback/oss-${legacyOssIndex}-metadata.json"`,
    `ossutil api get-object-acl --bucket "$ALIYUN_OSS_BUCKET" --key ${q(legacyOss.key)} --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" --output-format json --quiet > "recovery-readback/oss-${legacyOssIndex}-acl.json"`,
    `node scripts/updater/promotion-transaction.mjs verify-snapshot-readback --journal "$JOURNAL" --index ${q(legacyOssIndex)} --bytes "recovery-readback/oss-${legacyOssIndex}" --metadata "recovery-readback/oss-${legacyOssIndex}-metadata.json" --acl "recovery-readback/oss-${legacyOssIndex}-acl.json" --output "recovery-readback/oss-${legacyOssIndex}-verified.json"`,
    `aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" --key ${q(legacyR2.key)} --endpoint-url "$r2_endpoint" "recovery-readback/r2-${legacyR2Index}" > "recovery-readback/r2-${legacyR2Index}-metadata.json"`,
    `node scripts/updater/promotion-transaction.mjs verify-snapshot-readback --journal "$JOURNAL" --index ${q(legacyR2Index)} --bytes "recovery-readback/r2-${legacyR2Index}" --metadata "recovery-readback/r2-${legacyR2Index}-metadata.json" --output "recovery-readback/r2-${legacyR2Index}-verified.json"`,
    'if [[ "$legacy_restored" == true ]]; then',
    '  aliyun cdn RefreshObjectCaches --region "$ALIYUN_REGION" --ObjectPath "$LEGACY_ALIYUN_URL" --ObjectType File > recovery-readback/aliyun-cache-purge.json',
    '  jq -e \'.RefreshTaskId or .RequestId\' recovery-readback/aliyun-cache-purge.json >/dev/null',
    `  node scripts/updater/promotion-transaction.mjs poll-url --url "$LEGACY_ALIYUN_URL" --expected "recovery-readback/backups/${legacyOssIndex}" --timeout-seconds 600 --interval-seconds 10 --output recovery-readback/legacy-aliyun-cdn.json`,
    `  node scripts/updater/promotion-transaction.mjs poll-url --url "$LEGACY_R2_URL" --expected "recovery-readback/backups/${legacyR2Index}" --timeout-seconds 600 --interval-seconds 10 --output recovery-readback/legacy-r2-cdn.json`,
    'fi',
    '# Restore the policy last, after legacy origins and caches converge.',
    'if [[ "$(jq -r .action recovery-readback/decisions/policy.json)" == restore ]]; then'
  )

  if (policy.existed) {
    lines.push(
      `  aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" --key ${q(policy.key)} --endpoint-url "$r2_endpoint" recovery-readback/live/policy-prewrite.json > recovery-readback/live/policy-prewrite-metadata.json`,
      '  cmp recovery-readback/live/policy.json recovery-readback/live/policy-prewrite.json',
      '  policy_etag="$(node scripts/updater/promotion-transaction.mjs extract-r2-etag --metadata recovery-readback/live/policy-prewrite-metadata.json)"',
      `  aws s3api put-object --bucket "$CLOUDFLARE_R2_BUCKET" --key ${q(policy.key)} --body "recovery-readback/backups/${policyIndex}" --content-type "$(jq -er .contentType recovery-readback/plans/${policyIndex}.json)" --cache-control "$(jq -er .cacheControl recovery-readback/plans/${policyIndex}.json)" --if-match "$policy_etag" --endpoint-url "$r2_endpoint" >/dev/null`
    )
  } else {
    lines.push(
      `  aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" --key ${q(policy.key)} --endpoint-url "$r2_endpoint" recovery-readback/live/policy-predelete.json > recovery-readback/live/policy-predelete-metadata.json`,
      '  cmp recovery-readback/live/policy.json recovery-readback/live/policy-predelete.json',
      '  policy_etag="$(node scripts/updater/promotion-transaction.mjs extract-r2-etag --metadata recovery-readback/live/policy-predelete-metadata.json)"',
      `  aws s3api delete-object --bucket "$CLOUDFLARE_R2_BUCKET" --key ${q(policy.key)} --if-match "$policy_etag" --endpoint-url "$r2_endpoint" >/dev/null`
    )
  }
  lines.push('fi', '# Verify the policy after its final restore.')
  if (policy.existed) {
    lines.push(
      `aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" --key ${q(policy.key)} --endpoint-url "$r2_endpoint" "recovery-readback/r2-${policyIndex}" > "recovery-readback/r2-${policyIndex}-metadata.json"`,
      `node scripts/updater/promotion-transaction.mjs verify-snapshot-readback --journal "$JOURNAL" --index ${q(policyIndex)} --bytes "recovery-readback/r2-${policyIndex}" --metadata "recovery-readback/r2-${policyIndex}-metadata.json" --output "recovery-readback/r2-${policyIndex}-verified.json"`
    )
  } else {
    lines.push(
      `probe_r2_recovery ${q(policy.key)} "verify-absent-${policyIndex}"`,
      `jq -e '.state == "absent"' "recovery-readback/verify-absent-${policyIndex}.json" >/dev/null`
    )
  }

  lines.push(
    '# Reclassify every cleanup object before the first cleanup deletion.'
  )
  for (const [index, entry] of unverifiedLedger.entries()) {
    const probeName = `unverified-ledger-${index}-${entry.provider}`
    lines.push(
      `# An unverified create intent is ambiguous: it must still be absent.`,
      `probe_${entry.provider}_recovery ${q(entry.key)} ${q(probeName)}`,
      `jq -e '.state == "absent"' recovery-readback/${probeName}.json >/dev/null`
    )
  }
  const reverseCleanupLedger = [...cleanupLedger].reverse()
  for (const [index, entry] of reverseCleanupLedger.entries()) {
    const probeName = `predelete-ledger-${index}-${entry.provider}`
    if (entry.provider === 'r2') {
      lines.push(
        `probe_r2_recovery ${q(entry.key)} ${q(probeName)}`,
        `ledger_state="$(jq -er .state recovery-readback/${probeName}.json)"`,
        `printf '%s\\n' "$ledger_state" > "recovery-readback/ledger/predelete-r2-${index}-state"`,
        'if [[ "$ledger_state" == exists ]]; then',
        `  aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" --key ${q(entry.key)} --endpoint-url "$r2_endpoint" "recovery-readback/ledger/predelete-r2-${index}" > "recovery-readback/ledger/predelete-r2-${index}-metadata.json"`,
        `  test "$(sha256sum "recovery-readback/ledger/predelete-r2-${index}" | cut -d' ' -f1)" = ${q(entry.sha256)}`,
        `  node scripts/updater/promotion-transaction.mjs backup-metadata-plan --metadata "recovery-readback/ledger/predelete-r2-${index}-metadata.json" --output "recovery-readback/ledger/predelete-r2-${index}-metadata-plan.json"`,
        `  jq -e --arg contentType ${q(entry.contentType)} --arg cacheControl ${q(entry.cacheControl)} '.contentType == $contentType and .cacheControl == $cacheControl' "recovery-readback/ledger/predelete-r2-${index}-metadata-plan.json" >/dev/null`,
        'else',
        '  test "$ledger_state" = absent',
        'fi'
      )
    } else {
      lines.push(
        `probe_oss_recovery ${q(entry.key)} ${q(probeName)}`,
        `ledger_state="$(jq -er .state recovery-readback/${probeName}.json)"`,
        `printf '%s\\n' "$ledger_state" > "recovery-readback/ledger/predelete-oss-${index}-state"`,
        'if [[ "$ledger_state" == exists ]]; then',
        `  ossutil cp "oss://\${ALIYUN_OSS_BUCKET}/${entry.key}" "recovery-readback/ledger/predelete-oss-${index}" --force --endpoint "$oss_endpoint" --region "$ALIYUN_REGION"`,
        `  test "$(sha256sum "recovery-readback/ledger/predelete-oss-${index}" | cut -d' ' -f1)" = ${q(entry.sha256)}`,
        `  ossutil api head-object --bucket "$ALIYUN_OSS_BUCKET" --key ${q(entry.key)} --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" --output-format json --quiet > "recovery-readback/ledger/predelete-oss-${index}-metadata.json"`,
        `  node scripts/updater/promotion-transaction.mjs backup-metadata-plan --metadata "recovery-readback/ledger/predelete-oss-${index}-metadata.json" --output "recovery-readback/ledger/predelete-oss-${index}-metadata-plan.json"`,
        `  jq -e --arg contentType ${q(entry.contentType)} --arg cacheControl ${q(entry.cacheControl)} '.contentType == $contentType and .cacheControl == $cacheControl' "recovery-readback/ledger/predelete-oss-${index}-metadata-plan.json" >/dev/null`,
        'else',
        '  test "$ledger_state" = absent',
        'fi'
      )
    }
  }
  lines.push(
    '# Reject absent-to-exists resurrection before the first cleanup delete.'
  )
  for (const [index, entry] of reverseCleanupLedger.entries()) {
    const initialIndex = cleanupLedger.indexOf(entry)
    const predeleteState =
      `recovery-readback/ledger/predelete-${entry.provider}-${index}-state`
    lines.push(
      `initial_ledger_state="$(cat "recovery-readback/ledger/${initialIndex}-state")"`,
      `predelete_ledger_state="$(cat "${predeleteState}")"`,
      'if [[ "$initial_ledger_state" == absent ]]; then',
      '  test "$predelete_ledger_state" = absent',
      'else',
      '  test "$initial_ledger_state" = exists',
      '  case "$predelete_ledger_state" in exists|absent) ;; *) exit 1 ;; esac',
      'fi'
    )
  }
  lines.push('# Delete cleanup objects only after every predelete classification.')
  for (const [index, entry] of reverseCleanupLedger.entries()) {
    if (entry.provider === 'r2') {
      lines.push(
        `if [[ "$(cat "recovery-readback/ledger/predelete-r2-${index}-state")" == exists ]]; then`,
        `  ledger_etag="$(node scripts/updater/promotion-transaction.mjs extract-r2-etag --metadata "recovery-readback/ledger/predelete-r2-${index}-metadata.json")"`,
        `  aws s3api delete-object --bucket "$CLOUDFLARE_R2_BUCKET" --key ${q(entry.key)} --if-match "$ledger_etag" --endpoint-url "$r2_endpoint" >/dev/null`,
        'else',
        `  test "$(cat "recovery-readback/ledger/predelete-r2-${index}-state")" = absent`,
        'fi'
      )
    } else {
      lines.push(
        `if [[ "$(cat "recovery-readback/ledger/predelete-oss-${index}-state")" == exists ]]; then`,
        `  ossutil api delete-object --bucket "$ALIYUN_OSS_BUCKET" --key ${q(entry.key)} --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" --output-format json --quiet >/dev/null`,
        'else',
        `  test "$(cat "recovery-readback/ledger/predelete-oss-${index}-state")" = absent`,
        'fi'
      )
    }
  }
  lines.push(
    '# Every cleanup object must now be absent before either lock can close.'
  )
  for (const [index, entry] of reverseCleanupLedger.entries()) {
    const probeName = `deleted-ledger-${index}-${entry.provider}`
    if (entry.provider === 'r2') {
      lines.push(
        `probe_r2_recovery ${q(entry.key)} ${q(probeName)}`,
        `jq -e '.state == "absent"' recovery-readback/${probeName}.json >/dev/null`
      )
    } else {
      lines.push(
        `probe_oss_recovery ${q(entry.key)} ${q(probeName)}`,
        `jq -e '.state == "absent"' recovery-readback/${probeName}.json >/dev/null`
      )
    }
  }
  lines.push(
    '# Delete each still-present matching lock; an absent side is already done.',
    `probe_r2_recovery ${q(OPEN_TRANSACTION_KEY)} final-open-r2`,
    `probe_oss_recovery ${q(OPEN_TRANSACTION_KEY)} final-open-oss`,
    'open_r2_state="$(jq -er .state recovery-readback/final-open-r2.json)"',
    'open_oss_state="$(jq -er .state recovery-readback/final-open-oss.json)"',
    'open_r2_delete_needed=false',
    'open_oss_delete_needed=false',
    'if [[ "$open_r2_state" == exists ]]; then',
    `  aws s3api get-object --bucket "$CLOUDFLARE_R2_BUCKET" --key ${q(OPEN_TRANSACTION_KEY)} --endpoint-url "$r2_endpoint" recovery-readback/live/open-r2-predelete.json > recovery-readback/live/open-r2-predelete-metadata.json`,
    '  cmp "$JOURNAL" recovery-readback/live/open-r2-predelete.json',
    '  test "$(jq -er .transactionId recovery-readback/live/open-r2-predelete.json)" = "$transaction_id"',
    '  node scripts/updater/promotion-transaction.mjs backup-metadata-plan --metadata recovery-readback/live/open-r2-predelete-metadata.json --output recovery-readback/plans/open-r2-predelete.json',
    '  jq -e \'.contentType == "application/json" and .cacheControl == "no-store"\' recovery-readback/plans/open-r2-predelete.json >/dev/null',
    '  open_etag="$(node scripts/updater/promotion-transaction.mjs extract-r2-etag --metadata recovery-readback/live/open-r2-predelete-metadata.json)"',
    '  open_r2_delete_needed=true',
    'else',
    '  test "$open_r2_state" = absent',
    'fi',
    'if [[ "$open_oss_state" == exists ]]; then',
    `  ossutil cp "oss://\${ALIYUN_OSS_BUCKET}/${OPEN_TRANSACTION_KEY}" recovery-readback/live/open-oss-predelete.json --force --endpoint "$oss_endpoint" --region "$ALIYUN_REGION"`,
    `  ossutil api head-object --bucket "$ALIYUN_OSS_BUCKET" --key ${q(OPEN_TRANSACTION_KEY)} --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" --output-format json --quiet > recovery-readback/live/open-oss-predelete-metadata.json`,
    '  cmp "$JOURNAL" recovery-readback/live/open-oss-predelete.json',
    '  test "$(jq -er .transactionId recovery-readback/live/open-oss-predelete.json)" = "$transaction_id"',
    '  node scripts/updater/promotion-transaction.mjs backup-metadata-plan --metadata recovery-readback/live/open-oss-predelete-metadata.json --output recovery-readback/plans/open-oss-predelete.json',
    '  jq -e \'.contentType == "application/json" and .cacheControl == "no-store"\' recovery-readback/plans/open-oss-predelete.json >/dev/null',
    '  open_oss_delete_needed=true',
    'else',
    '  test "$open_oss_state" = absent',
    'fi',
    'if [[ "$open_r2_delete_needed" == true ]]; then',
    `  aws s3api delete-object --bucket "$CLOUDFLARE_R2_BUCKET" --key ${q(OPEN_TRANSACTION_KEY)} --if-match "$open_etag" --endpoint-url "$r2_endpoint" >/dev/null`,
    'fi',
    'if [[ "$open_oss_delete_needed" == true ]]; then',
    `  probe_oss_recovery ${q(OPEN_TRANSACTION_KEY)} final-open-oss-immediate`,
    '  open_oss_state="$(jq -er .state recovery-readback/final-open-oss-immediate.json)"',
    '  if [[ "$open_oss_state" == exists ]]; then',
    `    ossutil cp "oss://\${ALIYUN_OSS_BUCKET}/${OPEN_TRANSACTION_KEY}" recovery-readback/live/open-oss-immediate.json --force --endpoint "$oss_endpoint" --region "$ALIYUN_REGION"`,
    `    ossutil api head-object --bucket "$ALIYUN_OSS_BUCKET" --key ${q(OPEN_TRANSACTION_KEY)} --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" --output-format json --quiet > recovery-readback/live/open-oss-immediate-metadata.json`,
    '    cmp "$JOURNAL" recovery-readback/live/open-oss-immediate.json',
    '    test "$(jq -er .transactionId recovery-readback/live/open-oss-immediate.json)" = "$transaction_id"',
    '    node scripts/updater/promotion-transaction.mjs backup-metadata-plan --metadata recovery-readback/live/open-oss-immediate-metadata.json --output recovery-readback/plans/open-oss-immediate.json',
    '    jq -e \'.contentType == "application/json" and .cacheControl == "no-store"\' recovery-readback/plans/open-oss-immediate.json >/dev/null',
    `    ossutil api delete-object --bucket "$ALIYUN_OSS_BUCKET" --key ${q(OPEN_TRANSACTION_KEY)} --endpoint "$oss_endpoint" --region "$ALIYUN_REGION" --output-format json --quiet >/dev/null`,
    '  else',
    '    test "$open_oss_state" = absent',
    '  fi',
    'fi',
    `probe_r2_recovery ${q(OPEN_TRANSACTION_KEY)} final-open-r2-absent`,
    `probe_oss_recovery ${q(OPEN_TRANSACTION_KEY)} final-open-oss-absent`,
    'jq -e \'.state == "absent"\' recovery-readback/final-open-r2-absent.json >/dev/null',
    'jq -e \'.state == "absent"\' recovery-readback/final-open-oss-absent.json >/dev/null'
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
