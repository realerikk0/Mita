#!/usr/bin/env node

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createAliyunAdapter } from './publish-download-transaction.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))

export const BIYAN_DOWNLOAD_ALIAS_BOOTSTRAP_ALLOWLIST = path.join(
  here,
  'biyan-download-alias-bootstrap-allowlist.json'
)
export const BIYAN_DOWNLOAD_ALIAS_BOOTSTRAP_ALLOWLIST_SHA256 =
  'e2a74f84223a08b9a4d10851a131c4fdfdc76d355f317d90198695b906010634'

const EXPECTED_RELEASE = {
  tagName: 'v0.6.643',
  version: '0.6.643',
  sourceCommit: '38e6d9290a8b9b0f152ff2a7eefb550e6ead7df5',
  migrationPhase: 'A',
  dataSchema: 1,
}
const EXPECTED_STORAGE = {
  provider: 'aliyun',
  bucket: 'mita-static',
  endpoint: 'https://oss-cn-hangzhou.aliyuncs.com',
  region: 'cn-hangzhou',
  cdnOrigin: 'https://static.mitapp.cn',
}
const EXPECTED_STAGING_ROOT =
  'biyan/download/bootstrap/v0.6.643-38e6d9290a8b9b0f152ff2a7eefb550e6ead7df5/staging'
const EXPECTED_ACTIVE_JOURNAL_KEY =
  'biyan/download/transactions/active.json'
const EXPECTED_FORBIDDEN_UPDATER_KEYS = [
  'mita/latest.json',
  'biyan/stable/latest.json',
  'biyan/updater/current.json',
]
const EXPECTED_ENTRIES = {
  manifest: {
    sourceKey: 'mita/download/latest.json',
    sourcePublicUrl:
      'https://static.mitapp.cn/mita/download/latest.json',
    targetKey: 'biyan/download/latest.json',
    targetPublicUrl:
      'https://static.mitapp.cn/biyan/download/latest.json',
    stagingKey: `${EXPECTED_STAGING_ROOT}/manifest`,
    size: 1722,
    sha256:
      'e06a40b5acfb7db05d2930a71d347006afc7ddd4f47a6b4071d4048df2d08c93',
    contentType: 'application/json',
  },
  page: {
    sourceKey: 'mita/download',
    sourcePublicUrl: 'https://static.mitapp.cn/mita/download',
    targetKey: 'biyan/download',
    targetPublicUrl: 'https://static.mitapp.cn/biyan/download',
    stagingKey: `${EXPECTED_STAGING_ROOT}/page`,
    size: 1542,
    sha256:
      '642e82b242fa9018bd05d5b0ad51248120a4f174e52bde560a0beb86769f2856',
    contentType: 'text/html; charset=utf-8',
  },
}
const METADATA_KEYS = [
  'cacheControl',
  'contentType',
  'contentEncoding',
  'contentDisposition',
  'expires',
  'acl',
  'storageClass',
  'customMetadata',
]

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function sha256File(file) {
  const hash = createHash('sha256')
  const descriptor = fs.openSync(file, 'r')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  try {
    for (;;) {
      const bytesRead = fs.readSync(
        descriptor,
        buffer,
        0,
        buffer.length,
        null
      )
      if (bytesRead === 0) break
      hash.update(buffer.subarray(0, bytesRead))
    }
  } finally {
    fs.closeSync(descriptor)
  }
  return hash.digest('hex')
}

function ensureDirectory(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
}

function writeJson(file, value) {
  ensureDirectory(file)
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      mode: 0o600,
    })
    fs.renameSync(temporary, file)
  } finally {
    fs.rmSync(temporary, { force: true })
  }
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} has unexpected fields`)
  }
}

function exactObject(value, expected, label) {
  exactKeys(value, Object.keys(expected), label)
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (value[key] !== expectedValue) {
      throw new Error(`${label}.${key} is not allowlisted`)
    }
  }
}

function isSafeObjectKey(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 1024 &&
    value
      .split('/')
      .every((segment) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment))
  )
}

function validatePublicUrl(publicUrl, key, label) {
  let parsed
  try {
    parsed = new URL(publicUrl)
  } catch {
    throw new Error(`${label} has an invalid public URL`)
  }
  if (
    parsed.origin !== EXPECTED_STORAGE.cdnOrigin ||
    parsed.pathname !== `/${key}` ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(`${label} public URL is not allowlisted`)
  }
}

function normalizeMetadata(metadata, label) {
  exactKeys(metadata, METADATA_KEYS, label)
  const normalized = {
    cacheControl: metadata.cacheControl,
    contentType: metadata.contentType,
    contentEncoding: metadata.contentEncoding,
    contentDisposition: metadata.contentDisposition,
    expires: metadata.expires,
    acl: metadata.acl,
    storageClass: metadata.storageClass,
    customMetadata: metadata.customMetadata,
  }
  for (const [name, value] of Object.entries({
    cacheControl: normalized.cacheControl,
    contentType: normalized.contentType,
    acl: normalized.acl,
    storageClass: normalized.storageClass,
  })) {
    if (
      typeof value !== 'string' ||
      value.length === 0 ||
      value.length > 256 ||
      /[\r\n]/.test(value)
    ) {
      throw new Error(`${label}.${name} is invalid`)
    }
  }
  for (const name of [
    'contentEncoding',
    'contentDisposition',
    'expires',
  ]) {
    const value = normalized[name]
    if (
      value !== null &&
      (typeof value !== 'string' ||
        value.length === 0 ||
        value.length > 1024 ||
        /[\r\n]/.test(value))
    ) {
      throw new Error(`${label}.${name} is invalid`)
    }
  }
  if (
    !['default', 'private'].includes(normalized.acl) ||
    normalized.storageClass !== 'Standard' ||
    !normalized.customMetadata ||
    typeof normalized.customMetadata !== 'object' ||
    Array.isArray(normalized.customMetadata)
  ) {
    throw new Error(`${label} has unsupported OSS metadata`)
  }
  normalized.customMetadata = Object.fromEntries(
    Object.entries(normalized.customMetadata)
      .map(([name, value]) => {
        if (
          !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name) ||
          typeof value !== 'string' ||
          value.length > 256 ||
          /[\r\n]/.test(value)
        ) {
          throw new Error(`${label} has invalid custom metadata`)
        }
        return [name, value]
      })
      .sort(([left], [right]) => left.localeCompare(right))
  )
  return normalized
}

function metadataEqual(left, right) {
  return (
    JSON.stringify(normalizeMetadata(left, 'actual metadata')) ===
    JSON.stringify(normalizeMetadata(right, 'expected metadata'))
  )
}

function expectedLiveMetadata(contentType) {
  return {
    cacheControl: 'public, max-age=60, must-revalidate',
    contentType,
    contentEncoding: null,
    contentDisposition: null,
    expires: null,
    acl: 'default',
    storageClass: 'Standard',
    customMetadata: {},
  }
}

function expectedStagingMetadata(contentType) {
  return {
    cacheControl: 'private, no-store',
    contentType,
    contentEncoding: null,
    contentDisposition: null,
    expires: null,
    acl: 'private',
    storageClass: 'Standard',
    customMetadata: {},
  }
}

function validateEntry(entry, expected) {
  exactKeys(entry, ['id', 'source', 'target', 'staging'], entry.id ?? 'entry')
  if (!EXPECTED_ENTRIES[entry.id] || EXPECTED_ENTRIES[entry.id] !== expected) {
    throw new Error(`Bootstrap entry id is not allowlisted: ${entry.id}`)
  }
  const sourceKeys =
    entry.id === 'manifest'
      ? [
          'key',
          'publicUrl',
          'size',
          'sha256',
          'metadata',
          'jsonIdentity',
        ]
      : ['key', 'publicUrl', 'size', 'sha256', 'metadata']
  exactKeys(entry.source, sourceKeys, `${entry.id}.source`)
  exactKeys(
    entry.target,
    ['key', 'publicUrl', 'metadata'],
    `${entry.id}.target`
  )
  exactKeys(entry.staging, ['key', 'metadata'], `${entry.id}.staging`)
  for (const [label, key] of [
    ['source', entry.source.key],
    ['target', entry.target.key],
    ['staging', entry.staging.key],
  ]) {
    if (!isSafeObjectKey(key)) {
      throw new Error(`${entry.id}.${label} has an unsafe object key`)
    }
  }
  for (const forbidden of EXPECTED_FORBIDDEN_UPDATER_KEYS) {
    if (
      [entry.source.key, entry.target.key, entry.staging.key].includes(
        forbidden
      )
    ) {
      throw new Error(`Stable updater key is forbidden: ${forbidden}`)
    }
  }
  if (
    entry.source.key !== expected.sourceKey ||
    entry.source.publicUrl !== expected.sourcePublicUrl ||
    entry.target.key !== expected.targetKey ||
    entry.target.publicUrl !== expected.targetPublicUrl ||
    entry.staging.key !== expected.stagingKey ||
    entry.source.size !== expected.size ||
    entry.source.sha256 !== expected.sha256
  ) {
    throw new Error(`${entry.id} object mapping is not allowlisted`)
  }
  validatePublicUrl(
    entry.source.publicUrl,
    entry.source.key,
    `${entry.id}.source`
  )
  validatePublicUrl(
    entry.target.publicUrl,
    entry.target.key,
    `${entry.id}.target`
  )
  const sourceMetadata = normalizeMetadata(
    entry.source.metadata,
    `${entry.id}.source.metadata`
  )
  const targetMetadata = normalizeMetadata(
    entry.target.metadata,
    `${entry.id}.target.metadata`
  )
  const stagingMetadata = normalizeMetadata(
    entry.staging.metadata,
    `${entry.id}.staging.metadata`
  )
  if (
    !metadataEqual(sourceMetadata, expectedLiveMetadata(expected.contentType)) ||
    !metadataEqual(targetMetadata, expectedLiveMetadata(expected.contentType)) ||
    !metadataEqual(
      stagingMetadata,
      expectedStagingMetadata(expected.contentType)
    )
  ) {
    throw new Error(`${entry.id} metadata is not allowlisted`)
  }
  if (entry.id === 'manifest') {
    exactObject(
      entry.source.jsonIdentity,
      {
        schemaVersion: 2,
        product: 'Biyan',
        channel: 'stable',
        tagName: 'v0.6.633',
        version: '0.6.633',
      },
      'manifest.source.jsonIdentity'
    )
  }
}

export function validateBootstrapAllowlist(document) {
  exactKeys(
    document,
    [
      'schema',
      'operation',
      'oneTime',
      'release',
      'storage',
      'stagingRoot',
      'activeJournalKey',
      'forbiddenStableUpdaterKeys',
      'entries',
    ],
    'bootstrap allowlist'
  )
  if (
    document.schema !== 1 ||
    document.operation !== 'biyan-download-alias-bootstrap' ||
    document.oneTime !== true
  ) {
    throw new Error('Bootstrap allowlist identity is invalid')
  }
  exactObject(document.release, EXPECTED_RELEASE, 'bootstrap release')
  exactObject(document.storage, EXPECTED_STORAGE, 'bootstrap storage')
  if (document.stagingRoot !== EXPECTED_STAGING_ROOT) {
    throw new Error('Bootstrap staging root is not allowlisted')
  }
  if (
    document.activeJournalKey !== EXPECTED_ACTIVE_JOURNAL_KEY ||
    !isSafeObjectKey(document.activeJournalKey)
  ) {
    throw new Error('Bootstrap active journal key is not allowlisted')
  }
  if (
    !Array.isArray(document.forbiddenStableUpdaterKeys) ||
    JSON.stringify(document.forbiddenStableUpdaterKeys) !==
      JSON.stringify(EXPECTED_FORBIDDEN_UPDATER_KEYS)
  ) {
    throw new Error('Stable updater key denylist is not allowlisted')
  }
  if (
    !Array.isArray(document.entries) ||
    document.entries.length !== 2 ||
    document.entries[0]?.id !== 'manifest' ||
    document.entries[1]?.id !== 'page'
  ) {
    throw new Error('Bootstrap object allowlist must contain manifest and page')
  }
  for (const entry of document.entries) {
    validateEntry(entry, EXPECTED_ENTRIES[entry.id])
  }
  const keys = document.entries.flatMap((entry) => [
    entry.source.key,
    entry.target.key,
    entry.staging.key,
  ])
  keys.push(document.activeJournalKey)
  if (new Set(keys).size !== keys.length) {
    throw new Error('Bootstrap object keys must be unique')
  }
  return document
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

export function loadBootstrapAllowlist(
  file = BIYAN_DOWNLOAD_ALIAS_BOOTSTRAP_ALLOWLIST
) {
  const resolved = path.resolve(file)
  const bytes = fs.readFileSync(resolved)
  const digest = sha256Bytes(bytes)
  if (digest !== BIYAN_DOWNLOAD_ALIAS_BOOTSTRAP_ALLOWLIST_SHA256) {
    throw new Error(
      `Bootstrap allowlist SHA-256 mismatch: expected ${BIYAN_DOWNLOAD_ALIAS_BOOTSTRAP_ALLOWLIST_SHA256}, received ${digest}`
    )
  }
  let document
  try {
    document = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new Error('Bootstrap allowlist is not valid JSON')
  }
  validateBootstrapAllowlist(document)
  return {
    file: resolved,
    sha256: digest,
    document: deepFreeze(document),
  }
}

export function validateBootstrapIdentity(identity, release = EXPECTED_RELEASE) {
  exactKeys(
    identity,
    ['tagName', 'sourceCommit', 'migrationPhase', 'dataSchema'],
    'bootstrap invocation'
  )
  if (
    identity.tagName !== release.tagName ||
    identity.sourceCommit !== release.sourceCommit ||
    identity.migrationPhase !== release.migrationPhase ||
    identity.dataSchema !== release.dataSchema
  ) {
    throw new Error(
      'Bootstrap invocation is not exact v0.6.643/A13/phase A/schema 1'
    )
  }
  return identity
}

function adapterEntry(id, provider, object) {
  return {
    id,
    provider,
    key: object.key,
    publicUrl: object.publicUrl,
  }
}

function freshDestination(directory, name) {
  const destination = path.join(directory, name)
  ensureDirectory(destination)
  fs.rmSync(destination, { force: true })
  return destination
}

async function probeOrigin(adapter, entry, directory, suffix) {
  const destination = freshDestination(directory, `${entry.id}-${suffix}`)
  const exists = await adapter.download(entry, destination)
  if (!exists) {
    fs.rmSync(destination, { force: true })
    return { exists: false, file: null, size: null, sha256: null }
  }
  return {
    exists: true,
    file: destination,
    size: fs.statSync(destination).size,
    sha256: sha256File(destination),
  }
}

async function probePublic(adapter, entry, directory, suffix) {
  const destination = freshDestination(directory, `${entry.id}-${suffix}`)
  const response = await adapter.downloadPublicOptional(entry, destination)
  if (
    !response ||
    typeof response !== 'object' ||
    typeof response.exists !== 'boolean'
  ) {
    throw new Error(`Public probe contract is invalid for ${entry.publicUrl}`)
  }
  if (!response.exists) {
    fs.rmSync(destination, { force: true })
    return {
      exists: false,
      file: null,
      size: null,
      sha256: null,
      headers: null,
    }
  }
  return {
    exists: true,
    file: destination,
    size: fs.statSync(destination).size,
    sha256: sha256File(destination),
    headers: response.headers,
  }
}

function verifyExpectedBytes(probe, expected, label) {
  if (
    !probe.exists ||
    probe.size !== expected.size ||
    probe.sha256 !== expected.sha256
  ) {
    throw new Error(
      `${label} bytes are not allowlisted: expected ${expected.size}/${expected.sha256}, received ${probe.exists ? `${probe.size}/${probe.sha256}` : 'missing'}`
    )
  }
}

function verifyPublicHeaders(probe, expectedMetadata, label) {
  const expected = {
    cacheControl: expectedMetadata.cacheControl,
    contentType: expectedMetadata.contentType,
  }
  if (
    !probe.exists ||
    !probe.headers ||
    JSON.stringify(probe.headers) !== JSON.stringify(expected)
  ) {
    throw new Error(
      `${label} response headers differ: expected ${JSON.stringify(expected)}, received ${JSON.stringify(probe.headers)}`
    )
  }
}

function verifyJsonIdentity(file, expected, label) {
  let document
  try {
    document = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    throw new Error(`${label} is not valid JSON`)
  }
  for (const [name, value] of Object.entries(expected)) {
    if (document[name] !== value) {
      throw new Error(`${label}.${name} is not allowlisted`)
    }
  }
}

async function verifySources(
  plan,
  adapter,
  workspace,
  phase,
  evidence
) {
  const results = new Map()
  for (const item of plan.entries) {
    const sourceEntry = adapterEntry(
      `source-${item.id}`,
      plan.storage.provider,
      item.source
    )
    const origin = await probeOrigin(
      adapter,
      sourceEntry,
      path.join(workspace, phase, 'source-origin'),
      'origin'
    )
    verifyExpectedBytes(origin, item.source, `${item.id} source origin`)
    const metadata = await adapter.readMetadata(sourceEntry)
    if (!metadataEqual(metadata, item.source.metadata)) {
      throw new Error(`${item.id} source origin metadata differs`)
    }
    const publicReadback = await probePublic(
      adapter,
      sourceEntry,
      path.join(workspace, phase, 'source-public'),
      'public'
    )
    verifyExpectedBytes(
      publicReadback,
      item.source,
      `${item.id} source public`
    )
    verifyPublicHeaders(
      publicReadback,
      item.source.metadata,
      `${item.id} source public`
    )
    if (origin.sha256 !== publicReadback.sha256) {
      throw new Error(`${item.id} source origin and public bytes differ`)
    }
    if (item.source.jsonIdentity) {
      verifyJsonIdentity(
        origin.file,
        item.source.jsonIdentity,
        `${item.id} source`
      )
    }
    results.set(item.id, { origin, publicReadback, metadata })
    if (phase === 'preflight') {
      evidence.sources.push({
        id: item.id,
        key: item.source.key,
        publicUrl: item.source.publicUrl,
        size: origin.size,
        sha256: origin.sha256,
        metadata,
        originPublicByteIdentical: true,
        publicHeaders: publicReadback.headers,
      })
    }
  }
  return results
}

async function probeTarget(
  plan,
  item,
  source,
  adapter,
  workspace,
  phase
) {
  const targetEntry = adapterEntry(
    `target-${item.id}`,
    plan.storage.provider,
    item.target
  )
  const origin = await probeOrigin(
    adapter,
    targetEntry,
    path.join(workspace, phase, 'target-origin'),
    'origin'
  )
  const publicReadback = await probePublic(
    adapter,
    targetEntry,
    path.join(workspace, phase, 'target-public'),
    'public'
  )
  if (!origin.exists) {
    if (publicReadback.exists) {
      throw new Error(
        `${item.id} target is absent at origin but unexpectedly exists publicly`
      )
    }
    return {
      state: 'absent',
      publicState: 'absent',
      origin,
      publicReadback,
      metadata: null,
    }
  }
  if (
    origin.size !== source.origin.size ||
    origin.sha256 !== source.origin.sha256
  ) {
    throw new Error(
      `${item.id} target conflict: refusing to overwrite different bytes`
    )
  }
  const metadata = await adapter.readMetadata(targetEntry)
  if (!metadataEqual(metadata, item.target.metadata)) {
    throw new Error(
      `${item.id} target conflict: refusing to overwrite different metadata`
    )
  }
  const publicState = !publicReadback.exists
    ? 'absent'
    : publicReadback.size === source.origin.size &&
          publicReadback.sha256 === source.origin.sha256 &&
          JSON.stringify(publicReadback.headers) ===
            JSON.stringify({
              cacheControl: item.target.metadata.cacheControl,
              contentType: item.target.metadata.contentType,
            })
      ? 'exact'
      : 'stale'
  return {
    state: 'exact',
    publicState,
    origin,
    publicReadback,
    metadata,
  }
}

async function probeStaging(
  plan,
  item,
  source,
  adapter,
  workspace,
  phase
) {
  const stagingEntry = adapterEntry(
    `staging-${item.id}`,
    plan.storage.provider,
    item.staging
  )
  const origin = await probeOrigin(
    adapter,
    stagingEntry,
    path.join(workspace, phase, 'staging-origin'),
    'origin'
  )
  if (!origin.exists) {
    return { state: 'absent', origin, metadata: null }
  }
  if (
    origin.size !== source.origin.size ||
    origin.sha256 !== source.origin.sha256
  ) {
    throw new Error(`${item.id} fixed staging object has conflicting bytes`)
  }
  const metadata = await adapter.readMetadata(stagingEntry)
  if (!metadataEqual(metadata, item.staging.metadata)) {
    throw new Error(`${item.id} fixed staging object has conflicting metadata`)
  }
  return { state: 'exact', origin, metadata }
}

async function assertActiveJournalAbsent(
  plan,
  adapter,
  workspace,
  phase,
  evidence
) {
  const entry = {
    id: 'active-journal',
    provider: plan.storage.provider,
    key: plan.activeJournalKey,
  }
  const readback = await probeOrigin(
    adapter,
    entry,
    path.join(workspace, phase, 'active-journal'),
    'origin'
  )
  if (readback.exists) {
    evidence.activeJournal.checks.push({
      phase,
      absent: false,
      size: readback.size,
      sha256: readback.sha256,
      checkedAt: new Date().toISOString(),
    })
    throw new Error(
      `Active release-distribution journal blocks bootstrap: ${plan.activeJournalKey}`
    )
  }
  evidence.activeJournal.checks.push({
    phase,
    absent: true,
    checkedAt: new Date().toISOString(),
  })
}

async function conditionalUploadOrAcceptExact(
  adapter,
  entry,
  sourceFile,
  metadata,
  verify
) {
  try {
    await adapter.uploadIfAbsent(entry, sourceFile, metadata)
    return 'uploaded'
  } catch (error) {
    try {
      const state = await verify()
      if (state.state === 'exact') {
        await adapter.assertConditionalWriteSafety()
        return 'concurrent-exact'
      }
    } catch {
      // Preserve the conditional-upload failure below.
    }
    throw error
  }
}

async function boundedTargetPublicReadback(
  plan,
  item,
  source,
  adapter,
  workspace
) {
  const entry = adapterEntry(
    `target-${item.id}`,
    plan.storage.provider,
    item.target
  )
  const attempts = adapter.publicReadbackAttempts ?? 1
  const timeoutMs = adapter.publicReadbackTimeoutMs ?? 0
  const now = () => adapter.publicReadbackNow?.() ?? Date.now()
  const deadline = timeoutMs > 0 ? now() + timeoutMs : null
  let lastError = null
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1 && deadline !== null && now() >= deadline) break
    try {
      const readback = await probePublic(
        adapter,
        entry,
        path.join(workspace, 'commit', 'target-public'),
        `attempt-${attempt}`
      )
      if (
        readback.exists &&
        readback.size === source.origin.size &&
        readback.sha256 === source.origin.sha256
      ) {
        verifyPublicHeaders(
          readback,
          item.target.metadata,
          `${item.id} target public`
        )
        return readback
      }
      lastError = new Error(
        readback.exists
          ? `stale bytes ${readback.sha256}`
          : 'public target is absent'
      )
    } catch (error) {
      lastError = error
    }
    if (attempt < attempts) {
      await (adapter.waitForPublicReadback?.() ??
        new Promise((resolve) => setTimeout(resolve, 1000)))
    }
  }
  throw new Error(
    `${item.id} target public readback did not converge: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  )
}

async function cleanupStaging(
  plan,
  trustedSources,
  adapter,
  workspace,
  evidence
) {
  const errors = []
  evidence.cleanup.attempted = true
  for (const item of plan.entries) {
    const source = trustedSources.get(item.id)
    if (!source) continue
    const stagingEntry = adapterEntry(
      `staging-${item.id}`,
      plan.storage.provider,
      item.staging
    )
    try {
      await assertActiveJournalAbsent(
        plan,
        adapter,
        workspace,
        `cleanup-${item.id}`,
        evidence
      )
      const state = await probeStaging(
        plan,
        item,
        source,
        adapter,
        workspace,
        'cleanup-before'
      )
      if (state.state === 'exact') {
        await adapter.remove(stagingEntry)
      }
      const after = await probeOrigin(
        adapter,
        stagingEntry,
        path.join(workspace, 'cleanup-after', 'staging-origin'),
        'origin'
      )
      if (after.exists) {
        throw new Error('strict cleanup readback still found staging object')
      }
      evidence.cleanup.entries.push({
        id: item.id,
        key: item.staging.key,
        removed: state.state === 'exact',
        absent: true,
      })
    } catch (error) {
      const message = `${item.id} staging cleanup failed: ${
        error instanceof Error ? error.message : String(error)
      }`
      errors.push(message)
      evidence.cleanup.entries.push({
        id: item.id,
        key: item.staging.key,
        removed: false,
        absent: false,
        error: message,
      })
    }
  }
  evidence.cleanup.completed = errors.length === 0
  evidence.cleanup.errors = errors
  return errors
}

function initialEvidence(plan, allowlistSha256, identity, dryRun) {
  return {
    schema: 1,
    operation: 'biyan-download-alias-bootstrap',
    status: 'validating',
    dryRun,
    identity: {
      tagName: identity.tagName,
      version: plan.release.version,
      sourceCommit: identity.sourceCommit,
      migrationPhase: identity.migrationPhase,
      dataSchema: identity.dataSchema,
    },
    allowlistSha256,
    storage: {
      provider: plan.storage.provider,
      bucket: plan.storage.bucket,
      endpoint: plan.storage.endpoint,
      region: plan.storage.region,
      cdnOrigin: plan.storage.cdnOrigin,
    },
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sources: [],
    targets: [],
    staging: [],
    purge: {
      attempted: false,
      completed: false,
      publicUrls: [],
    },
    cleanup: {
      attempted: false,
      completed: false,
      entries: [],
      errors: [],
    },
    activeJournal: {
      key: plan.activeJournalKey,
      checks: [],
    },
    recovery: {
      mode: 'idempotent-forward-only',
      required: false,
      instructions:
        'Re-run this exact allowlisted bootstrap. It never overwrites a conflicting live target and only forward-completes absent targets.',
    },
  }
}

export class BiyanDownloadAliasBootstrapError extends Error {
  constructor(message, evidence) {
    super(message)
    this.name = 'BiyanDownloadAliasBootstrapError'
    this.evidence = evidence
  }
}

export async function executeBiyanDownloadAliasBootstrap(
  {
    allowlist,
    allowlistSha256 = BIYAN_DOWNLOAD_ALIAS_BOOTSTRAP_ALLOWLIST_SHA256,
    identity,
  },
  { adapter, workspace, evidenceFile, dryRun = false }
) {
  validateBootstrapAllowlist(allowlist)
  if (
    allowlistSha256 !== BIYAN_DOWNLOAD_ALIAS_BOOTSTRAP_ALLOWLIST_SHA256
  ) {
    throw new Error('Bootstrap execution requires the pinned allowlist SHA-256')
  }
  validateBootstrapIdentity(identity, allowlist.release)
  for (const method of [
    'download',
    'downloadPublicOptional',
    'readMetadata',
    'uploadIfAbsent',
    'assertConditionalWriteSafety',
    'remove',
    'purge',
  ]) {
    if (typeof adapter?.[method] !== 'function') {
      throw new Error(`Bootstrap adapter is missing ${method}`)
    }
  }
  const plan = allowlist
  const resolvedWorkspace = path.resolve(workspace)
  const resolvedEvidenceFile = path.resolve(evidenceFile)
  fs.mkdirSync(resolvedWorkspace, { recursive: true })
  let evidence = initialEvidence(
    plan,
    allowlistSha256,
    identity,
    dryRun
  )
  const persist = () => {
    evidence.updatedAt = new Date().toISOString()
    writeJson(resolvedEvidenceFile, evidence)
  }
  persist()

  let trustedSources = new Map()
  let mutationStarted = false
  let primaryError = null
  try {
    evidence.status = 'preflight'
    persist()
    evidence.conditionalWriteSafety =
      await adapter.assertConditionalWriteSafety()
    evidence.conditionalWriteSafetyVerifiedAt = new Date().toISOString()
    await assertActiveJournalAbsent(
      plan,
      adapter,
      resolvedWorkspace,
      'preflight',
      evidence
    )
    persist()
    trustedSources = await verifySources(
      plan,
      adapter,
      resolvedWorkspace,
      'preflight',
      evidence
    )
    const targetStates = new Map()
    const stagingStates = new Map()
    for (const item of plan.entries) {
      const target = await probeTarget(
        plan,
        item,
        trustedSources.get(item.id),
        adapter,
        resolvedWorkspace,
        'preflight'
      )
      const staging = await probeStaging(
        plan,
        item,
        trustedSources.get(item.id),
        adapter,
        resolvedWorkspace,
        'preflight'
      )
      targetStates.set(item.id, target)
      stagingStates.set(item.id, staging)
      evidence.targets.push({
        id: item.id,
        key: item.target.key,
        publicUrl: item.target.publicUrl,
        preflightState: target.state,
        preflightPublicState: target.publicState,
        expectedSize: trustedSources.get(item.id).origin.size,
        expectedSha256: trustedSources.get(item.id).origin.sha256,
        wrote: false,
        concurrentExact: false,
        finalOriginVerified: false,
        finalPublicVerified: false,
      })
      evidence.staging.push({
        id: item.id,
        key: item.staging.key,
        preflightState: staging.state,
        wrote: false,
        verified: staging.state === 'exact',
      })
    }
    evidence.status = dryRun ? 'dry-run-ready' : 'staging'
    persist()
    if (dryRun) return evidence

    mutationStarted = true
    await assertActiveJournalAbsent(
      plan,
      adapter,
      resolvedWorkspace,
      'before-staging',
      evidence
    )
    persist()
    for (const item of plan.entries) {
      if (targetStates.get(item.id).state === 'exact') continue
      const source = trustedSources.get(item.id)
      const stagingEntry = adapterEntry(
        `staging-${item.id}`,
        plan.storage.provider,
        item.staging
      )
      if (stagingStates.get(item.id).state !== 'exact') {
        await assertActiveJournalAbsent(
          plan,
          adapter,
          resolvedWorkspace,
          `before-staging-${item.id}`,
          evidence
        )
        const result = await conditionalUploadOrAcceptExact(
          adapter,
          stagingEntry,
          source.origin.file,
          item.staging.metadata,
          () =>
            probeStaging(
              plan,
              item,
              source,
              adapter,
              resolvedWorkspace,
              'staging-race'
            )
        )
        evidence.staging.find(({ id }) => id === item.id).wrote =
          result === 'uploaded'
      }
      const verified = await probeStaging(
        plan,
        item,
        source,
        adapter,
        resolvedWorkspace,
        'staging-readback'
      )
      if (verified.state !== 'exact') {
        throw new Error(`${item.id} staging strict readback failed`)
      }
      evidence.staging.find(({ id }) => id === item.id).verified = true
      persist()
    }

    evidence.status = 'commit-cas'
    persist()
    trustedSources = await verifySources(
      plan,
      adapter,
      resolvedWorkspace,
      'commit-cas',
      evidence
    )
    const commitTargets = new Map()
    for (const item of plan.entries) {
      const source = trustedSources.get(item.id)
      const target = await probeTarget(
        plan,
        item,
        source,
        adapter,
        resolvedWorkspace,
        'commit-cas'
      )
      const staging = await probeStaging(
        plan,
        item,
        source,
        adapter,
        resolvedWorkspace,
        'commit-cas'
      )
      if (target.state === 'absent' && staging.state !== 'exact') {
        throw new Error(
          `${item.id} target remains absent but fixed staging is not exact`
        )
      }
      commitTargets.set(item.id, target)
    }
    evidence.commitCasVerified = true
    evidence.commitCasVerifiedAt = new Date().toISOString()
    evidence.conditionalWriteSafety =
      await adapter.assertConditionalWriteSafety()
    evidence.conditionalWriteSafetyVerifiedAt = new Date().toISOString()
    await assertActiveJournalAbsent(
      plan,
      adapter,
      resolvedWorkspace,
      'commit-cas',
      evidence
    )
    evidence.status = 'committing'
    persist()

    for (const item of plan.entries) {
      const source = trustedSources.get(item.id)
      const targetEvidence = evidence.targets.find(
        ({ id }) => id === item.id
      )
      const targetEntry = adapterEntry(
        `target-${item.id}`,
        plan.storage.provider,
        item.target
      )
      if (commitTargets.get(item.id).state === 'absent') {
        await assertActiveJournalAbsent(
          plan,
          adapter,
          resolvedWorkspace,
          `before-live-${item.id}`,
          evidence
        )
        const result = await conditionalUploadOrAcceptExact(
          adapter,
          targetEntry,
          source.origin.file,
          item.target.metadata,
          () =>
            probeTarget(
              plan,
              item,
              source,
              adapter,
              resolvedWorkspace,
              'live-race'
            )
        )
        targetEvidence.wrote = result === 'uploaded'
        targetEvidence.concurrentExact = result === 'concurrent-exact'
      }
      const strictTarget = await probeTarget(
        plan,
        item,
        source,
        adapter,
        resolvedWorkspace,
        'live-readback'
      )
      if (strictTarget.state !== 'exact') {
        throw new Error(`${item.id} live target strict readback failed`)
      }
      targetEvidence.finalOriginVerified = true
      persist()
    }

    const needsPurge = evidence.targets.some(
      (target) =>
        target.wrote ||
        target.concurrentExact ||
        target.preflightPublicState !== 'exact'
    )
    if (needsPurge) {
      const entries = plan.entries.map((item) =>
        adapterEntry(
          `target-${item.id}`,
          plan.storage.provider,
          item.target
        )
      )
      evidence.status = 'purging'
      evidence.purge.attempted = true
      evidence.purge.publicUrls = plan.entries.map(
        ({ target }) => target.publicUrl
      )
      await assertActiveJournalAbsent(
        plan,
        adapter,
        resolvedWorkspace,
        'before-purge',
        evidence
      )
      persist()
      await adapter.purge(entries)
      evidence.purge.completed = true
      persist()
    }

    evidence.status = 'public-readback'
    persist()
    for (const item of plan.entries) {
      const readback = await boundedTargetPublicReadback(
        plan,
        item,
        trustedSources.get(item.id),
        adapter,
        resolvedWorkspace
      )
      const targetEvidence = evidence.targets.find(
        ({ id }) => id === item.id
      )
      targetEvidence.finalPublicVerified = true
      targetEvidence.finalSize = readback.size
      targetEvidence.finalSha256 = readback.sha256
      persist()
    }
    evidence.status = 'committed-pending-cleanup'
    persist()
  } catch (error) {
    primaryError = error
  }

  let cleanupErrors = []
  if (mutationStarted) {
    cleanupErrors = await cleanupStaging(
      plan,
      trustedSources,
      adapter,
      resolvedWorkspace,
      evidence
    )
  }
  if (primaryError || cleanupErrors.length > 0) {
    evidence.status =
      cleanupErrors.length > 0 ? 'cleanup-failed' : 'failed'
    evidence.error =
      primaryError instanceof Error
        ? primaryError.message
        : primaryError
          ? String(primaryError)
          : 'Fixed staging objects could not be cleaned'
    evidence.recovery.required = true
    persist()
    throw new BiyanDownloadAliasBootstrapError(evidence.error, evidence)
  }
  evidence.status = 'committed'
  evidence.recovery.required = false
  evidence.completedAt = new Date().toISOString()
  persist()
  return evidence
}

function parseArgs(argv) {
  const result = { dryRun: false }
  const valued = new Set([
    '--tag',
    '--source-commit',
    '--migration-phase',
    '--data-schema',
    '--evidence',
  ])
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--dry-run') {
      if (result.dryRun) throw new Error('Duplicate argument: --dry-run')
      result.dryRun = true
      continue
    }
    if (!valued.has(argument)) {
      throw new Error(`Unexpected argument: ${argument}`)
    }
    const value = argv[index + 1]
    if (!value || value.startsWith('--') || result[argument]) {
      throw new Error(`Missing or duplicate value for ${argument}`)
    }
    result[argument] = value
    index += 1
  }
  for (const required of valued) {
    if (!result[required]) {
      throw new Error(`Missing required argument: ${required}`)
    }
  }
  if (!/^\d+$/.test(result['--data-schema'])) {
    throw new Error('--data-schema must be an integer')
  }
  return result
}

function validateEnvironment(storage) {
  const expected = {
    ALIYUN_OSS_BUCKET: storage.bucket,
    ALIYUN_OSS_ENDPOINT: storage.endpoint,
    OSS_REGION: storage.region,
    UPDATES_CDN_BASE_URL: storage.cdnOrigin,
  }
  for (const [name, value] of Object.entries(expected)) {
    if (process.env[name] !== value) {
      throw new Error(`${name} must be exactly ${value}`)
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const loaded = loadBootstrapAllowlist()
  validateEnvironment(loaded.document.storage)
  const identity = {
    tagName: args['--tag'],
    sourceCommit: args['--source-commit'],
    migrationPhase: args['--migration-phase'],
    dataSchema: Number(args['--data-schema']),
  }
  validateBootstrapIdentity(identity, loaded.document.release)
  const evidenceFile = path.resolve(args['--evidence'])
  const workspace = path.join(
    path.dirname(evidenceFile),
    'biyan-download-alias-bootstrap-work'
  )
  const adapter = createAliyunAdapter({
    bucket: loaded.document.storage.bucket,
    endpoint: loaded.document.storage.endpoint,
    region: loaded.document.storage.region,
    profile: 'release',
  })
  try {
    const evidence = await executeBiyanDownloadAliasBootstrap(
      {
        allowlist: loaded.document,
        allowlistSha256: loaded.sha256,
        identity,
      },
      {
        adapter,
        workspace,
        evidenceFile,
        dryRun: args.dryRun,
      }
    )
    console.log(
      `Biyan download alias bootstrap ${identity.tagName}: ${evidence.status}`
    )
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  await main()
}
