#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CANONICAL_DOWNLOAD_ORIGIN = 'https://static.mitapp.cn'
const CANONICAL_OSS_BUCKET = 'mita-static'
const CANONICAL_OSS_ENDPOINT = 'https://oss-cn-hangzhou.aliyuncs.com'
const CANONICAL_OSS_REGION = 'cn-hangzhou'
const OSS_PROBE_TIMEOUT_MS = 120_000
const OSS_TRANSFER_TIMEOUT_MS = 900_000

function sha256(file) {
  const hash = createHash('sha256')
  const descriptor = fs.openSync(file, 'r')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  try {
    for (;;) {
      const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null)
      if (bytesRead === 0) break
      hash.update(buffer.subarray(0, bytesRead))
    }
  } finally {
    fs.closeSync(descriptor)
  }
  return hash.digest('hex')
}

function filesEqual(left, right) {
  return (
    fs.statSync(left).size === fs.statSync(right).size &&
    sha256(left) === sha256(right)
  )
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

function safeId(value) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(value ?? '')) {
    throw new Error(`Invalid transaction entry id: ${value}`)
  }
  return value
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

function objectMetadata(entry) {
  const metadata = {
    cacheControl: entry.cacheControl,
    contentType: entry.contentType,
    contentEncoding: entry.contentEncoding ?? null,
    contentDisposition: entry.contentDisposition ?? null,
    expires: entry.expires ?? null,
    acl: entry.acl ?? 'default',
    storageClass: entry.storageClass ?? 'Standard',
    customMetadata: entry.customMetadata ?? {},
  }
  for (const [name, value] of Object.entries({
    cacheControl: metadata.cacheControl,
    contentType: metadata.contentType,
    acl: metadata.acl,
    storageClass: metadata.storageClass,
  })) {
    if (
      typeof value !== 'string' ||
      value.length === 0 ||
      value.length > 256 ||
      /[\r\n]/.test(value)
    ) {
      throw new Error(`${entry.id} has invalid ${name} metadata`)
    }
  }
  for (const [name, value] of Object.entries({
    contentEncoding: metadata.contentEncoding,
    contentDisposition: metadata.contentDisposition,
    expires: metadata.expires,
  })) {
    if (
      value !== null &&
      (typeof value !== 'string' ||
        value.length === 0 ||
        value.length > 1024 ||
        /[\r\n]/.test(value))
    ) {
      throw new Error(`${entry.id} has invalid ${name} metadata`)
    }
  }
  if (
    !['default', 'private', 'public-read', 'public-read-write'].includes(
      metadata.acl
    ) ||
    !['Standard', 'IA', 'Archive', 'ColdArchive', 'DeepColdArchive'].includes(
      metadata.storageClass
    ) ||
    !metadata.customMetadata ||
    typeof metadata.customMetadata !== 'object' ||
    Array.isArray(metadata.customMetadata)
  ) {
    throw new Error(`${entry.id} has unsupported OSS metadata`)
  }
  metadata.customMetadata = Object.fromEntries(
    Object.entries(metadata.customMetadata)
      .map(([name, value]) => {
        if (
          !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name) ||
          typeof value !== 'string' ||
          value.length > 256 ||
          /[\r\n]/.test(value)
        ) {
          throw new Error(`${entry.id} has invalid custom metadata`)
        }
        return [name, value]
      })
      .sort(([left], [right]) => left.localeCompare(right))
  )
  return metadata
}

function metadataEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function validateEntry(entry, kind, adapters) {
  if (
    !entry ||
    typeof entry !== 'object' ||
    Array.isArray(entry) ||
    !adapters[entry.provider]
  ) {
    throw new Error(`${kind} entry has an unsupported provider`)
  }
  safeId(entry.id)
  if (!isSafeObjectKey(entry.key)) {
    throw new Error(`${kind} ${entry.id} has an unsafe object key`)
  }
  if (
    !entry.file ||
    !fs.statSync(entry.file, { throwIfNoEntry: false })?.isFile()
  ) {
    throw new Error(`${kind} ${entry.id} source file is missing: ${entry.file}`)
  }
  objectMetadata(entry)
  if (kind === 'mutable') {
    if (
      !isSafeObjectKey(entry.stagingKey) ||
      !isSafeObjectKey(entry.recoveryKey) ||
      entry.stagingKey === entry.key ||
      entry.recoveryKey === entry.key ||
      entry.recoveryKey === entry.stagingKey
    ) {
      throw new Error(
        `mutable ${entry.id} requires distinct safe staging and recovery keys`
      )
    }
    let publicUrl
    try {
      publicUrl = new URL(entry.publicUrl)
    } catch {
      throw new Error(`mutable ${entry.id} has an invalid publicUrl`)
    }
    if (
      !String(entry.publicUrl).startsWith(`${CANONICAL_DOWNLOAD_ORIGIN}/`) ||
      publicUrl.origin !== CANONICAL_DOWNLOAD_ORIGIN ||
      publicUrl.search ||
      publicUrl.hash
    ) {
      throw new Error(
        `mutable ${entry.id} publicUrl must use ${CANONICAL_DOWNLOAD_ORIGIN}`
      )
    }
    if (publicUrl.username || publicUrl.password) {
      throw new Error(
        `mutable ${entry.id} publicUrl must not contain credentials`
      )
    }
  }
}

function validatePlan(plan, adapters) {
  if (
    plan?.schema !== 1 ||
    !/^v\d+\.\d+\.\d+$/.test(plan.tag ?? '') ||
    !/^[A-Za-z0-9._-]+$/.test(plan.transactionId ?? '')
  ) {
    throw new Error('Invalid publication transaction identity')
  }
  if (!Array.isArray(plan.immutable) || !Array.isArray(plan.mutable)) {
    throw new Error('Publication transaction entries must be arrays')
  }
  if (
    typeof plan.recoveryCommand !== 'function' ||
    typeof plan.recoveryPurgeCommand !== 'function' ||
    typeof plan.recoveryReadbackCommand !== 'function' ||
    typeof plan.recoveryPublicReadbackCommand !== 'function' ||
    typeof plan.recoveryCleanupTemporaryCommand !== 'function' ||
    typeof plan.recoveryClearActiveCommand !== 'function'
  ) {
    throw new Error(
      'Publication transaction must provide restore, purge, origin/CDN readback, verified cleanup, and finalization recovery commands'
    )
  }
  if (plan.mutable.length === 0) {
    throw new Error('Publication transaction must declare mutable live keys')
  }
  if (
    !plan.journal ||
    !adapters[plan.journal.provider] ||
    !isSafeObjectKey(plan.journal.activeKey) ||
    !isSafeObjectKey(plan.journal.immutableRoot)
  ) {
    throw new Error('Publication transaction requires a safe remote journal')
  }
  const providers = new Set([
    plan.journal.provider,
    ...plan.immutable.map(({ provider }) => provider),
    ...plan.mutable.map(({ provider }) => provider),
  ])
  for (const provider of providers) {
    for (const method of [
      'download',
      'upload',
      'remove',
      'purge',
      'downloadPublic',
      'readMetadata',
    ]) {
      if (typeof adapters[provider]?.[method] !== 'function') {
        throw new Error(`${provider} adapter is missing ${method}`)
      }
    }
  }
  const identities = new Set()
  for (const [kind, entries] of [
    ['immutable', plan.immutable],
    ['mutable', plan.mutable],
  ]) {
    for (const entry of entries) {
      validateEntry(entry, kind, adapters)
      const identity = `${entry.provider}\0${entry.key}`
      if (identities.has(identity)) {
        throw new Error(
          `Duplicate publication object: ${entry.provider}/${entry.key}`
        )
      }
      identities.add(identity)
      if (kind === 'mutable') {
        for (const temporaryKey of [entry.stagingKey, entry.recoveryKey]) {
          const temporaryIdentity = `${entry.provider}\0${temporaryKey}`
          if (identities.has(temporaryIdentity)) {
            throw new Error(
              `Duplicate publication object: ${entry.provider}/${temporaryKey}`
            )
          }
          identities.add(temporaryIdentity)
        }
      }
    }
  }
  for (const journalKey of [
    plan.journal.activeKey,
    plan.journal.immutableRoot,
  ]) {
    const identity = `${plan.journal.provider}\0${journalKey}`
    if (identities.has(identity)) {
      throw new Error(
        `Remote journal collides with publication object: ${journalKey}`
      )
    }
    identities.add(identity)
  }
  const mutableIds = plan.mutable.map(({ id }) => id)
  if (new Set(mutableIds).size !== mutableIds.length) {
    throw new Error('Mutable transaction entry ids must be unique')
  }
}

function transactionEvidence(plan, status, extra = {}) {
  return {
    schema: 1,
    transactionId: plan?.transactionId ?? null,
    tag: plan?.tag ?? null,
    status,
    updatedAt: new Date().toISOString(),
    activeJournalCleared: false,
    immutable: [],
    mutable: [],
    warnings: [],
    ...extra,
  }
}

function groupByProvider(entries) {
  const groups = {}
  for (const entry of entries) {
    ;(groups[entry.provider] ??= []).push(entry)
  }
  return groups
}

function artifactRelativePath(root, target) {
  const relative = path.relative(root, target)
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Recovery file is outside the evidence artifact: ${target}`)
  }
  return relative.split(path.sep).join('/')
}

function recoveryPlan(
  plan,
  evidence,
  prestateDirectory,
  recoveryRootDirectory
) {
  const restoreRequired = new Set([
    'prepared',
    'committing',
    'rollback-in-progress',
    'manual-recovery',
  ]).has(evidence.status)
  const terminalState = new Set(['committed', 'rolled-back']).has(
    evidence.status
  )
    ? evidence.status
    : new Set(['cleanup-failed', 'finalization-failed']).has(evidence.status)
      ? evidence.terminalState
      : null
  const terminalFinalizeRequired =
    new Set(['committed', 'rolled-back']).has(terminalState) &&
    evidence.activeJournalCleared !== true
  const evidenceById = new Map(
    (evidence.mutable ?? []).map((entry) => [entry.id, entry])
  )
  const recoverableEntries = restoreRequired
    ? plan.mutable.map((entry) => {
        const recorded = evidenceById.get(entry.id)
        let prestateMetadata
        try {
          prestateMetadata = objectMetadata({
            id: entry.id,
            ...recorded?.prestateMetadata,
          })
        } catch {
          throw new Error(`Recovery pre-state is incomplete for ${entry.id}`)
        }
        if (!/^[0-9a-f]{64}$/.test(recorded?.prestateSha256 ?? '')) {
          throw new Error(`Recovery pre-state is incomplete for ${entry.id}`)
        }
        const absolutePrestateFile = path.join(prestateDirectory, entry.id)
        const prestateFile = artifactRelativePath(
          recoveryRootDirectory,
          absolutePrestateFile
        )
        return {
          entry,
          prestateFile,
          prestateSha256: recorded.prestateSha256,
          prestateMetadata,
        }
      })
    : []
  const terminalEntries = terminalFinalizeRequired
    ? plan.mutable.map((entry) => {
        const recorded = evidenceById.get(entry.id)
        const committed = terminalState === 'committed'
        const expectedSha256 = committed
          ? recorded?.targetSha256
          : recorded?.prestateSha256
        const expectedMetadata = committed
          ? recorded?.targetMetadata
          : recorded?.prestateMetadata
        if (!/^[0-9a-f]{64}$/.test(expectedSha256 ?? '')) {
          throw new Error(`Terminal recovery state is incomplete for ${entry.id}`)
        }
        let exactMetadata
        try {
          exactMetadata = objectMetadata({
            id: entry.id,
            ...expectedMetadata,
          })
        } catch {
          throw new Error(`Terminal recovery metadata is incomplete for ${entry.id}`)
        }
        return {
          entry,
          expectedSha256,
          expectedMetadata: exactMetadata,
        }
      })
    : []
  const commands = restoreRequired
    ? [
        ...recoverableEntries.map(
          ({ entry, prestateFile, prestateMetadata }) => ({
            phase: 'restore',
            id: entry.id,
            provider: entry.provider,
            key: entry.key,
            command: plan.recoveryCommand(
              entry,
              prestateFile,
              prestateMetadata
            ),
          })
        ),
        ...Object.entries(groupByProvider(plan.mutable)).map(
          ([provider, entries]) => ({
            phase: 'purge',
            provider,
            command: plan.recoveryPurgeCommand(provider, entries),
          })
        ),
        ...recoverableEntries.map(
          ({ entry, prestateFile, prestateSha256, prestateMetadata }) => ({
            phase: 'readback',
            id: entry.id,
            provider: entry.provider,
            key: entry.key,
            command: plan.recoveryReadbackCommand(
              entry,
              prestateFile,
              prestateSha256,
              prestateMetadata
            ),
          })
        ),
        ...recoverableEntries.map(
          ({ entry, prestateSha256 }) => ({
            phase: 'cdn-readback',
            id: entry.id,
            provider: entry.provider,
            key: entry.key,
            command: plan.recoveryPublicReadbackCommand(
              entry,
              prestateSha256
            ),
          })
        ),
        ...recoverableEntries.map(({ entry }) => ({
          phase: 'cleanup-temporary',
          id: entry.id,
          provider: entry.provider,
          key: entry.key,
          command: plan.recoveryCleanupTemporaryCommand(entry),
        })),
        {
          phase: 'clear-active',
          provider: plan.journal.provider,
          key: plan.journal.activeKey,
          command: plan.recoveryClearActiveCommand(plan.journal),
        },
      ]
    : terminalFinalizeRequired
      ? [
          ...terminalEntries.map(
            ({ entry, expectedSha256, expectedMetadata }) => ({
              phase: 'finalize-origin',
              id: entry.id,
              provider: entry.provider,
              key: entry.key,
              command: plan.recoveryReadbackCommand(
                entry,
                null,
                expectedSha256,
                expectedMetadata
              ),
            })
          ),
          ...terminalEntries.map(({ entry, expectedSha256 }) => ({
            phase: 'finalize-cdn',
            id: entry.id,
            provider: entry.provider,
            key: entry.key,
            command: plan.recoveryPublicReadbackCommand(entry, expectedSha256),
          })),
          ...terminalEntries.map(({ entry }) => ({
            phase: 'cleanup-temporary',
            id: entry.id,
            provider: entry.provider,
            key: entry.key,
            command: plan.recoveryCleanupTemporaryCommand(entry),
          })),
          {
            phase: 'clear-active',
            provider: plan.journal.provider,
            key: plan.journal.activeKey,
            command: plan.recoveryClearActiveCommand(plan.journal),
          },
        ]
    : []
  return {
    schema: 1,
    transactionId: plan.transactionId,
    tag: plan.tag,
    status: evidence.status,
    instructions:
      restoreRequired || terminalFinalizeRequired
        ? 'Download the evidence artifact, change into the directory containing recovery.json, then run every command in order. Never clear the active journal until every origin and CDN readback succeeds.'
        : 'No manual recovery is required.',
    commands,
    prestate: recoverableEntries.map(
      ({ entry, prestateFile, prestateSha256, prestateMetadata }) => ({
        id: entry.id,
        provider: entry.provider,
        key: entry.key,
        prestateFile,
        expectedSha256: prestateSha256,
        expectedMetadata: prestateMetadata,
      })
    ),
  }
}

async function verifyEntries(
  entries,
  adapters,
  directory,
  sourceField = 'file'
) {
  for (const entry of entries) {
    const destination = path.join(directory, entry.id)
    ensureDirectory(destination)
    const exists = await adapters[entry.provider].download(entry, destination)
    if (!exists || !filesEqual(entry[sourceField], destination)) {
      throw new Error(
        `Strict readback failed for ${entry.provider}:${entry.key}`
      )
    }
  }
}

async function verifyPublic(entries, adapters, directory, expectedFiles) {
  for (const entry of entries) {
    const adapter = adapters[entry.provider]
    const expected = expectedFiles.get(entry.id)
    if (!expected) {
      throw new Error(`Missing expected public readback for ${entry.id}`)
    }
    const attempts = adapter.publicReadbackAttempts ?? 1
    const timeoutMs = adapter.publicReadbackTimeoutMs ?? 0
    const now = () => adapter.publicReadbackNow?.() ?? Date.now()
    const deadline = timeoutMs > 0 ? now() + timeoutMs : null
    let lastError = null
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      if (attempt > 1 && deadline !== null && now() >= deadline) break
      const destination = path.join(directory, `${entry.id}-${attempt}`)
      ensureDirectory(destination)
      try {
        await adapter.downloadPublic(entry, destination)
        if (filesEqual(expected, destination)) {
          lastError = null
          break
        }
        lastError = new Error(`stale bytes on attempt ${attempt}/${attempts}`)
      } catch (error) {
        lastError = error
      }
      if (attempt < attempts) {
        await (adapter.waitForPublicReadback?.() ??
          new Promise((resolve) => setTimeout(resolve, 1000)))
      }
    }
    if (lastError) {
      throw new Error(
        `Strict public readback failed for ${entry.publicUrl}: ${
          lastError instanceof Error ? lastError.message : String(lastError)
        }`
      )
    }
  }
}

async function verifyMetadata(entries, adapters, expectedMetadata) {
  for (const entry of entries) {
    const actual = await adapters[entry.provider].readMetadata(entry)
    const expected = expectedMetadata.get(entry.id)
    if (!expected || !metadataEqual(actual, expected)) {
      throw new Error(
        `Strict metadata readback failed for ${entry.provider}:${entry.key}`
      )
    }
  }
}

async function cleanupTemporaryObjects(
  plan,
  adapters,
  evidence,
  { retainRecovery = false, readbackDirectory } = {}
) {
  const errors = []
  for (const entry of plan.mutable) {
    const keys = [entry.stagingKey]
    if (!retainRecovery) keys.push(entry.recoveryKey)
    for (const key of keys) {
      try {
        const temporary = {
          ...entry,
          key,
        }
        await adapters[entry.provider].remove(temporary)
        const destination = path.join(
          readbackDirectory ?? os.tmpdir(),
          `${entry.id}-${createHash('sha256').update(key).digest('hex')}`
        )
        const stillExists = await adapters[entry.provider].download(
          temporary,
          destination
        )
        if (stillExists) {
          throw new Error('strict deletion readback still found the object')
        }
      } catch (error) {
        const message = `temporary object cleanup failed for ${entry.provider}:${key}: ${
          error instanceof Error ? error.message : String(error)
        }`
        evidence.warnings.push(message)
        errors.push(message)
      }
    }
  }
  return errors
}

function journalEntry(plan, id, key, file, immutable) {
  return {
    id,
    provider: plan.journal.provider,
    key,
    file,
    cacheControl: immutable
      ? 'private, max-age=31536000, immutable'
      : 'private, no-store',
    contentType: 'application/json',
    acl: 'private',
    storageClass: 'Standard',
  }
}

async function strictUpload(entry, adapters, readbackDirectory, metadata) {
  const adapter = adapters[entry.provider]
  await adapter.upload(entry, entry.file, metadata ?? objectMetadata(entry))
  const readback = path.join(readbackDirectory, entry.id)
  const exists = await adapter.download(entry, readback)
  if (!exists || !filesEqual(entry.file, readback)) {
    throw new Error(
      `Strict upload readback failed for ${entry.provider}:${entry.key}`
    )
  }
  await verifyMetadata(
    [entry],
    adapters,
    new Map([[entry.id, metadata ?? objectMetadata(entry)]])
  )
}

export class PublicationTransactionError extends Error {
  constructor(message, evidence, recovery) {
    super(message)
    this.name = 'PublicationTransactionError'
    this.evidence = evidence
    this.recovery = recovery
  }
}

export async function executePublicationTransaction(
  plan,
  { adapters, workspace, evidenceFile, recoveryFile, dryRun = false }
) {
  const prestateDirectory = path.join(workspace, 'prestate')
  const stagingReadbackDirectory = path.join(workspace, 'staging-readback')
  const immutableReadbackDirectory = path.join(workspace, 'immutable-readback')
  const commitReadbackDirectory = path.join(workspace, 'commit-readback')
  const publicReadbackDirectory = path.join(workspace, 'public-readback')
  const rollbackReadbackDirectory = path.join(workspace, 'rollback-readback')
  const rollbackPublicDirectory = path.join(workspace, 'rollback-public')
  const cleanupReadbackDirectory = path.join(workspace, 'cleanup-readback')
  const recoveryObjectReadbackDirectory = path.join(
    workspace,
    'recovery-object-readback'
  )
  const journalDirectory = path.join(workspace, 'journal')
  const journalReadbackDirectory = path.join(workspace, 'journal-readback')
  const activeJournalReadback = path.join(workspace, 'active-journal')
  const terminalRecoveryDirectory = path.join(workspace, 'terminal-recovery')
  const dryRunReadbackDirectory = path.join(workspace, 'dry-run-readback')
  const recoveryRootDirectory = path.dirname(recoveryFile)
  fs.mkdirSync(workspace, { recursive: true })

  let evidence = transactionEvidence(plan, 'validating')
  let recovery = recoveryPlan(
    plan,
    evidence,
    prestateDirectory,
    recoveryRootDirectory
  )
  let remoteJournalSequence = 0
  let remoteJournalAttempted = false
  const persist = () => {
    writeJson(recoveryFile, recovery)
    writeJson(evidenceFile, evidence)
  }
  const inspectActiveJournal = async () => {
    const entry = journalEntry(
      plan,
      'active-journal',
      plan.journal.activeKey,
      activeJournalReadback,
      false
    )
    const exists = await adapters[entry.provider].download(
      entry,
      activeJournalReadback
    )
    if (!exists) return null
    await verifyMetadata(
      [entry],
      adapters,
      new Map([[entry.id, objectMetadata(entry)]])
    )
    let document
    try {
      document = JSON.parse(fs.readFileSync(activeJournalReadback, 'utf8'))
    } catch {
      throw new Error(
        `Incomplete remote transaction journal blocks publication: ${entry.key}`
      )
    }
    return { document, entry }
  }
  const finalizeTerminalActiveJournal = async ({ document, entry }) => {
    const previous = document?.evidence
    const terminalState = new Set(['committed', 'rolled-back']).has(
      previous?.status
    )
      ? previous.status
      : new Set(['cleanup-failed', 'finalization-failed']).has(
            previous?.status
          )
        ? previous.terminalState
        : null
    if (
      document?.schema !== 1 ||
      !new Set(['committed', 'rolled-back']).has(terminalState) ||
      previous?.activeJournalCleared === true ||
      !Array.isArray(previous?.mutable)
    ) {
      throw new Error(
        `Incomplete remote transaction journal blocks publication: ${entry.key}`
      )
    }
    if (dryRun) {
      throw new Error(
        `Terminal remote transaction journal requires a non-dry-run finalization: ${entry.key}`
      )
    }
    const previousById = new Map(
      previous.mutable.map((recorded) => [recorded.id, recorded])
    )
    if (
      previousById.size !== plan.mutable.length ||
      previous.mutable.length !== plan.mutable.length
    ) {
      throw new Error(
        `Terminal remote transaction journal does not match live publication keys: ${entry.key}`
      )
    }
    const expectedFiles = new Map()
    const expectedMetadata = new Map()
    const previousTemporaryEntries = []
    for (const current of plan.mutable) {
      const recorded = previousById.get(current.id)
      if (
        recorded?.provider !== current.provider ||
        recorded?.key !== current.key
      ) {
        throw new Error(
          `Terminal remote transaction journal does not match ${current.id}`
        )
      }
      const previousTemporaryEntry = {
        ...current,
        stagingKey: recorded.stagingKey,
        recoveryKey: recorded.recoveryKey,
      }
      validateEntry(previousTemporaryEntry, 'mutable', adapters)
      previousTemporaryEntries.push(previousTemporaryEntry)
      const committed = terminalState === 'committed'
      const expectedSha256 = committed
        ? recorded.targetSha256
        : recorded.prestateSha256
      const metadata = committed
        ? recorded.targetMetadata
        : recorded.prestateMetadata
      if (!/^[0-9a-f]{64}$/.test(expectedSha256 ?? '')) {
        throw new Error(
          `Terminal remote transaction journal has no digest for ${current.id}`
        )
      }
      const exactMetadata = objectMetadata({
        id: current.id,
        ...metadata,
      })
      const destination = path.join(terminalRecoveryDirectory, current.id)
      ensureDirectory(destination)
      const found = await adapters[current.provider].download(
        current,
        destination
      )
      if (!found || sha256(destination) !== expectedSha256) {
        throw new Error(
          `Terminal origin readback failed for ${current.provider}:${current.key}`
        )
      }
      expectedFiles.set(current.id, destination)
      expectedMetadata.set(current.id, exactMetadata)
    }
    await verifyMetadata(plan.mutable, adapters, expectedMetadata)
    await verifyPublic(
      plan.mutable,
      adapters,
      path.join(terminalRecoveryDirectory, 'public'),
      expectedFiles
    )
    const cleanupErrors = await cleanupTemporaryObjects(
      { ...plan, mutable: previousTemporaryEntries },
      adapters,
      evidence,
      {
        readbackDirectory: path.join(terminalRecoveryDirectory, 'cleanup'),
      }
    )
    if (cleanupErrors.length > 0) {
      throw new Error(
        `Terminal temporary object cleanup failed: ${cleanupErrors.join('; ')}`
      )
    }
    await clearActiveJournal()
    evidence.recoveredTerminalJournal = {
      transactionId: previous.transactionId ?? null,
      tag: previous.tag ?? null,
      status: previous.status,
      terminalState,
      finalizedAt: new Date().toISOString(),
    }
  }
  const persistRemoteJournal = async () => {
    remoteJournalAttempted = true
    remoteJournalSequence += 1
    const sequence = String(remoteJournalSequence).padStart(4, '0')
    const status = String(evidence.status).replace(/[^a-z0-9-]/gi, '-')
    const immutableKey = `${plan.journal.immutableRoot}/${sequence}-${status}.json`
    const snapshotFile = path.join(
      journalDirectory,
      `${sequence}-${status}.json`
    )
    evidence.remoteJournal = {
      provider: plan.journal.provider,
      activeKey: plan.journal.activeKey,
      immutableKey,
      sequence: remoteJournalSequence,
    }
    persist()
    writeJson(snapshotFile, {
      schema: 1,
      evidence,
      recovery,
    })
    const immutable = journalEntry(
      plan,
      `journal-${sequence}`,
      immutableKey,
      snapshotFile,
      true
    )
    const active = journalEntry(
      plan,
      'journal-active',
      plan.journal.activeKey,
      snapshotFile,
      false
    )
    const existing = path.join(
      journalReadbackDirectory,
      `${immutable.id}-before`
    )
    const existed = await adapters[immutable.provider].download(
      immutable,
      existing
    )
    if (existed && !filesEqual(snapshotFile, existing)) {
      throw new Error(
        `Remote journal checkpoint already exists: ${immutable.key}`
      )
    }
    if (existed) {
      await verifyMetadata(
        [immutable],
        adapters,
        new Map([[immutable.id, objectMetadata(immutable)]])
      )
    } else {
      await strictUpload(
        immutable,
        adapters,
        journalReadbackDirectory,
        objectMetadata(immutable)
      )
    }
    await strictUpload(
      active,
      adapters,
      journalReadbackDirectory,
      objectMetadata(active)
    )
  }
  const clearActiveJournal = async () => {
    const active = journalEntry(
      plan,
      'journal-active',
      plan.journal.activeKey,
      activeJournalReadback,
      false
    )
    await adapters[active.provider].remove(active)
    const stillExists = await adapters[active.provider].download(
      active,
      activeJournalReadback
    )
    if (stillExists) {
      throw new Error(`Remote active journal was not cleared: ${active.key}`)
    }
  }
  persist()
  try {
    validatePlan(plan, adapters)
  } catch (error) {
    evidence.status = 'preflight-failed'
    evidence.error = error instanceof Error ? error.message : String(error)
    evidence.updatedAt = new Date().toISOString()
    recovery = recoveryPlan(
      plan,
      evidence,
      prestateDirectory,
      recoveryRootDirectory
    )
    persist()
    throw new PublicationTransactionError(evidence.error, evidence, recovery)
  }
  try {
    const active = await inspectActiveJournal()
    if (active) await finalizeTerminalActiveJournal(active)
  } catch (error) {
    evidence.status = 'preflight-failed'
    evidence.error = error instanceof Error ? error.message : String(error)
    evidence.updatedAt = new Date().toISOString()
    recovery = recoveryPlan(
      plan,
      evidence,
      prestateDirectory,
      recoveryRootDirectory
    )
    persist()
    throw new PublicationTransactionError(evidence.error, evidence, recovery)
  }
  if (dryRun) {
    try {
      for (const entry of plan.immutable) {
        const destination = path.join(dryRunReadbackDirectory, entry.id)
        const exists = await adapters[entry.provider].download(
          entry,
          destination
        )
        if (exists && !filesEqual(entry.file, destination)) {
          throw new Error(
            `Immutable object conflicts during dry-run: ${entry.provider}:${entry.key}`
          )
        }
        if (exists) {
          await verifyMetadata(
            [entry],
            adapters,
            new Map([[entry.id, objectMetadata(entry)]])
          )
        }
        evidence.immutable.push({
          id: entry.id,
          provider: entry.provider,
          key: entry.key,
          sha256: sha256(entry.file),
          preexisting: exists,
        })
      }
      for (const entry of plan.mutable) {
        const destination = path.join(dryRunReadbackDirectory, entry.id)
        const exists = await adapters[entry.provider].download(
          entry,
          destination
        )
        if (!exists) {
          throw new Error(
            `Mutable live object is missing during dry-run: ${entry.provider}:${entry.key}`
          )
        }
        const currentMetadata =
          await adapters[entry.provider].readMetadata(entry)
        const publicDestination = path.join(
          dryRunReadbackDirectory,
          `${entry.id}-public`
        )
        await adapters[entry.provider].downloadPublic(entry, publicDestination)
        if (!filesEqual(destination, publicDestination)) {
          throw new Error(
            `Public live object differs from origin during dry-run: ${entry.publicUrl}`
          )
        }
        evidence.mutable.push({
          id: entry.id,
          provider: entry.provider,
          key: entry.key,
          currentSha256: sha256(destination),
          currentMetadata,
        })
      }
      evidence.status = 'dry-run-remote-preflight'
      evidence.updatedAt = new Date().toISOString()
      recovery = recoveryPlan(
        plan,
        evidence,
        prestateDirectory,
        recoveryRootDirectory
      )
      persist()
      return evidence
    } catch (error) {
      evidence.status = 'preflight-failed'
      evidence.error = error instanceof Error ? error.message : String(error)
      evidence.updatedAt = new Date().toISOString()
      recovery = recoveryPlan(
        plan,
        evidence,
        prestateDirectory,
        recoveryRootDirectory
      )
      persist()
      throw new PublicationTransactionError(evidence.error, evidence, recovery)
    }
  }
  evidence.status = 'preflight'
  evidence.updatedAt = new Date().toISOString()
  persist()

  try {
    const missingImmutable = []
    for (const entry of plan.immutable) {
      const adapter = adapters[entry.provider]
      const existing = path.join(
        immutableReadbackDirectory,
        `${entry.id}-before`
      )
      ensureDirectory(existing)
      const existed = await adapter.download(entry, existing)
      if (existed && !filesEqual(entry.file, existing)) {
        throw new Error(
          `Immutable object already exists with different bytes: ${entry.provider}:${entry.key}`
        )
      }
      if (existed) {
        await verifyMetadata(
          [entry],
          adapters,
          new Map([[entry.id, objectMetadata(entry)]])
        )
      } else {
        missingImmutable.push(entry)
      }
      evidence.immutable.push({
        id: entry.id,
        provider: entry.provider,
        key: entry.key,
        sha256: sha256(entry.file),
        preexisting: existed,
      })
    }

    for (const entry of plan.mutable) {
      const adapter = adapters[entry.provider]
      const staged = { ...entry, key: entry.stagingKey }
      await adapter.upload(staged, entry.file)
      const stagedReadback = path.join(stagingReadbackDirectory, entry.id)
      const stagedFound = await adapter.download(staged, stagedReadback)
      if (!stagedFound || !filesEqual(entry.file, stagedReadback)) {
        throw new Error(
          `Staging readback failed: ${entry.provider}:${entry.stagingKey}`
        )
      }
      await verifyMetadata(
        [staged],
        adapters,
        new Map([[staged.id, objectMetadata(staged)]])
      )

      const prestateFile = path.join(prestateDirectory, entry.id)
      const existed = await adapter.download(entry, prestateFile)
      if (!existed) {
        throw new Error(
          `Mutable live object has no restorable pre-state: ${entry.provider}:${entry.key}`
        )
      }
      const prestateMetadata = await adapter.readMetadata(entry)
      objectMetadata({ id: entry.id, ...prestateMetadata })
      const recoveryEntry = {
        ...entry,
        key: entry.recoveryKey,
        file: prestateFile,
        ...prestateMetadata,
      }
      await strictUpload(
        recoveryEntry,
        adapters,
        recoveryObjectReadbackDirectory,
        prestateMetadata
      )
      evidence.mutable.push({
        id: entry.id,
        provider: entry.provider,
        key: entry.key,
        stagingKey: entry.stagingKey,
        recoveryKey: entry.recoveryKey,
        targetSha256: sha256(entry.file),
        prestateSha256: sha256(prestateFile),
        targetMetadata: objectMetadata(entry),
        prestateMetadata,
        committed: false,
        rolledBack: false,
      })
    }
    for (const entry of missingImmutable) {
      await strictUpload(
        entry,
        adapters,
        immutableReadbackDirectory,
        objectMetadata(entry)
      )
    }
    evidence.status = 'prepared'
    evidence.updatedAt = new Date().toISOString()
    recovery = recoveryPlan(
      plan,
      evidence,
      prestateDirectory,
      recoveryRootDirectory
    )
    persist()
    await persistRemoteJournal()
  } catch (error) {
    evidence.status = remoteJournalAttempted
      ? 'manual-recovery'
      : 'preflight-failed'
    evidence.error = error instanceof Error ? error.message : String(error)
    evidence.updatedAt = new Date().toISOString()
    recovery = recoveryPlan(
      plan,
      evidence,
      prestateDirectory,
      recoveryRootDirectory
    )
    persist()
    const cleanupErrors = await cleanupTemporaryObjects(
      plan,
      adapters,
      evidence,
      {
        retainRecovery: remoteJournalAttempted,
        readbackDirectory: cleanupReadbackDirectory,
      }
    )
    if (cleanupErrors.length > 0) evidence.cleanupErrors = cleanupErrors
    evidence.updatedAt = new Date().toISOString()
    persist()
    throw new PublicationTransactionError(evidence.error, evidence, recovery)
  }

  try {
    evidence.status = 'committing'
    evidence.updatedAt = new Date().toISOString()
    recovery = recoveryPlan(
      plan,
      evidence,
      prestateDirectory,
      recoveryRootDirectory
    )
    persist()
    await persistRemoteJournal()
    for (const entry of plan.mutable) {
      await adapters[entry.provider].upload(entry, entry.file)
      evidence.mutable.find(({ id }) => id === entry.id).committed = true
      persist()
      await persistRemoteJournal()
    }
    for (const [provider, entries] of Object.entries(
      groupByProvider(plan.mutable)
    )) {
      await adapters[provider].purge(entries)
    }
    await verifyEntries(plan.mutable, adapters, commitReadbackDirectory)
    await verifyMetadata(
      plan.mutable,
      adapters,
      new Map(plan.mutable.map((entry) => [entry.id, objectMetadata(entry)]))
    )
    await verifyPublic(
      plan.mutable,
      adapters,
      publicReadbackDirectory,
      new Map(plan.mutable.map(({ id, file }) => [id, file]))
    )
    evidence.status = 'committed'
    evidence.updatedAt = new Date().toISOString()
    recovery = recoveryPlan(
      plan,
      evidence,
      prestateDirectory,
      recoveryRootDirectory
    )
    persist()
    await persistRemoteJournal()
  } catch (commitError) {
    const rollbackErrors = []
    evidence.status = 'rollback-in-progress'
    evidence.error =
      commitError instanceof Error ? commitError.message : String(commitError)
    evidence.updatedAt = new Date().toISOString()
    recovery = recoveryPlan(
      plan,
      evidence,
      prestateDirectory,
      recoveryRootDirectory
    )
    persist()
    try {
      await persistRemoteJournal()
    } catch (error) {
      rollbackErrors.push(
        `rollback journal: ${error instanceof Error ? error.message : String(error)}`
      )
    }
    for (const entry of plan.mutable) {
      const prestateFile = path.join(prestateDirectory, entry.id)
      const recorded = evidence.mutable.find(({ id }) => id === entry.id)
      try {
        await adapters[entry.provider].upload(
          entry,
          prestateFile,
          recorded.prestateMetadata
        )
        recorded.rolledBack = true
        persist()
        try {
          await persistRemoteJournal()
        } catch (error) {
          rollbackErrors.push(
            `rollback journal after ${entry.id}: ${
              error instanceof Error ? error.message : String(error)
            }`
          )
        }
      } catch (error) {
        rollbackErrors.push(
          `${entry.provider}:${entry.key}: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
    for (const [provider, entries] of Object.entries(
      groupByProvider(plan.mutable)
    )) {
      try {
        await adapters[provider].purge(entries)
      } catch (error) {
        rollbackErrors.push(
          `${provider} purge: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
    try {
      await verifyEntries(
        plan.mutable.map((entry) => ({
          ...entry,
          prestateFile: path.join(prestateDirectory, entry.id),
        })),
        adapters,
        rollbackReadbackDirectory,
        'prestateFile'
      )
      await verifyMetadata(
        plan.mutable,
        adapters,
        new Map(
          evidence.mutable.map(({ id, prestateMetadata }) => [
            id,
            prestateMetadata,
          ])
        )
      )
      await verifyPublic(
        plan.mutable,
        adapters,
        rollbackPublicDirectory,
        new Map(
          plan.mutable.map(({ id }) => [id, path.join(prestateDirectory, id)])
        )
      )
    } catch (error) {
      rollbackErrors.push(
        `strict rollback readback: ${error instanceof Error ? error.message : String(error)}`
      )
    }
    evidence.status =
      rollbackErrors.length === 0 ? 'rolled-back' : 'manual-recovery'
    evidence.error =
      commitError instanceof Error ? commitError.message : String(commitError)
    evidence.rollbackErrors = rollbackErrors
    evidence.updatedAt = new Date().toISOString()
    recovery = recoveryPlan(
      plan,
      evidence,
      prestateDirectory,
      recoveryRootDirectory
    )
    persist()
    let finalJournalPersisted = false
    try {
      await persistRemoteJournal()
      finalJournalPersisted = true
    } catch (error) {
      rollbackErrors.push(
        `final rollback journal: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
      evidence.status = 'manual-recovery'
      evidence.rollbackErrors = rollbackErrors
      evidence.updatedAt = new Date().toISOString()
      recovery = recoveryPlan(
        plan,
        evidence,
        prestateDirectory,
        recoveryRootDirectory
      )
      persist()
    }
    const cleanupErrors = await cleanupTemporaryObjects(
      plan,
      adapters,
      evidence,
      {
        retainRecovery: evidence.status === 'manual-recovery',
        readbackDirectory: cleanupReadbackDirectory,
      }
    )
    if (cleanupErrors.length > 0) {
      evidence.cleanupErrors = cleanupErrors
      if (evidence.status === 'rolled-back') {
        evidence.terminalState = 'rolled-back'
        evidence.status = 'cleanup-failed'
      }
      recovery = recoveryPlan(
        plan,
        evidence,
        prestateDirectory,
        recoveryRootDirectory
      )
      persist()
      if (evidence.status === 'cleanup-failed') {
        try {
          await persistRemoteJournal()
        } catch (journalError) {
          evidence.warnings.push(
            `cleanup failure journal failed: ${
              journalError instanceof Error
                ? journalError.message
                : String(journalError)
            }`
          )
        }
      }
    } else if (evidence.status === 'rolled-back' && finalJournalPersisted) {
      try {
        await clearActiveJournal()
        evidence.activeJournalCleared = true
        evidence.updatedAt = new Date().toISOString()
        recovery = recoveryPlan(
          plan,
          evidence,
          prestateDirectory,
          recoveryRootDirectory
        )
        persist()
      } catch (error) {
        evidence.status = 'finalization-failed'
        evidence.terminalState = 'rolled-back'
        evidence.finalizationErrors = [
          `clear active journal: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ]
        evidence.updatedAt = new Date().toISOString()
        recovery = recoveryPlan(
          plan,
          evidence,
          prestateDirectory,
          recoveryRootDirectory
        )
        persist()
        try {
          await persistRemoteJournal()
        } catch (journalError) {
          evidence.warnings.push(
            `finalization failure journal failed: ${
              journalError instanceof Error
                ? journalError.message
                : String(journalError)
            }`
          )
        }
      }
    }
    evidence.updatedAt = new Date().toISOString()
    persist()
    throw new PublicationTransactionError(evidence.error, evidence, recovery)
  }
  const cleanupErrors = await cleanupTemporaryObjects(
    plan,
    adapters,
    evidence,
    { readbackDirectory: cleanupReadbackDirectory }
  )
  if (cleanupErrors.length > 0) {
    evidence.status = 'cleanup-failed'
    evidence.terminalState = 'committed'
    evidence.error = 'Temporary publication objects could not be removed'
    evidence.cleanupErrors = cleanupErrors
    evidence.updatedAt = new Date().toISOString()
    recovery = recoveryPlan(
      plan,
      evidence,
      prestateDirectory,
      recoveryRootDirectory
    )
    persist()
    try {
      await persistRemoteJournal()
    } catch (journalError) {
      evidence.warnings.push(
        `cleanup failure journal failed: ${
          journalError instanceof Error
            ? journalError.message
            : String(journalError)
        }`
      )
      persist()
    }
    throw new PublicationTransactionError(evidence.error, evidence, recovery)
  }
  try {
    await clearActiveJournal()
    evidence.activeJournalCleared = true
  } catch (error) {
    evidence.status = 'finalization-failed'
    evidence.terminalState = 'committed'
    evidence.error = 'Active publication journal could not be cleared'
    evidence.finalizationErrors = [
      error instanceof Error ? error.message : String(error),
    ]
    evidence.updatedAt = new Date().toISOString()
    recovery = recoveryPlan(
      plan,
      evidence,
      prestateDirectory,
      recoveryRootDirectory
    )
    persist()
    try {
      await persistRemoteJournal()
    } catch (journalError) {
      evidence.warnings.push(
        `finalization failure journal failed: ${
          journalError instanceof Error
            ? journalError.message
            : String(journalError)
        }`
      )
      persist()
    }
    throw new PublicationTransactionError(evidence.error, evidence, recovery)
  }
  recovery = recoveryPlan(
    plan,
    evidence,
    prestateDirectory,
    recoveryRootDirectory
  )
  evidence.updatedAt = new Date().toISOString()
  persist()
  return evidence
}

function run(
  command,
  args,
  label,
  { allowNotFound = false, timeoutMs = OSS_PROBE_TIMEOUT_MS } = {}
) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error(`${label} has an invalid subprocess timeout`)
  }
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: timeoutMs,
    killSignal: 'SIGTERM',
  })
  if (result.error) throw result.error
  if (result.signal) {
    throw new Error(`${label} was terminated by ${result.signal}`)
  }
  if (result.status === 0) return { found: true, output: result.stdout }
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim()
  if (
    allowNotFound &&
    /(?:NoSuchKey|Status(?:Code)?:?\s*404|HTTP status:\s*404|does not exist)/i.test(
      output
    )
  ) {
    return { found: false, output }
  }
  throw new Error(`${label} failed (${result.status}): ${output}`)
}

export function parseAliyunObjectMetadata(output, entry) {
  const start = output.indexOf('{')
  const end = output.lastIndexOf('}')
  if (start < 0 || end <= start) {
    throw new Error(`OSS metadata response is not JSON for ${entry.key}`)
  }
  let document
  try {
    document = JSON.parse(output.slice(start, end + 1))
  } catch {
    throw new Error(`OSS metadata response is malformed for ${entry.key}`)
  }
  const scalars = new Map()
  const customMetadata = {}
  const visit = (value, parentKey = '') => {
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '')
      if (
        parentKey === 'metadata' &&
        (typeof child === 'string' || typeof child === 'number') &&
        ![
          'cachecontrol',
          'contenttype',
          'contentencoding',
          'contentdisposition',
          'expires',
          'acl',
          'storageclass',
        ].includes(normalized)
      ) {
        customMetadata[key.replace(/^x-oss-meta-/i, '')] = String(child)
      }
      if (typeof child === 'string' || typeof child === 'number') {
        if (!scalars.has(normalized)) scalars.set(normalized, String(child))
      } else {
        visit(child, normalized)
      }
    }
  }
  visit(document)
  const optional = (name) => scalars.get(name) || null
  return objectMetadata({
    id: entry.id,
    cacheControl: scalars.get('cachecontrol'),
    contentType: scalars.get('contenttype'),
    contentEncoding: optional('contentencoding'),
    contentDisposition: optional('contentdisposition'),
    expires: optional('expires'),
    acl: scalars.get('acl'),
    storageClass: scalars.get('storageclass'),
    customMetadata,
  })
}

export function createAliyunAdapter(
  {
    bucket,
    endpoint,
    profile = 'release',
    region = CANONICAL_OSS_REGION,
  },
  {
    runCommand = run,
    publicReadbackAttempts = 60,
    publicReadbackDelayMs = 6000,
    publicReadbackTimeoutMs = 330_000,
  } = {}
) {
  if (
    bucket !== CANONICAL_OSS_BUCKET ||
    endpoint !== CANONICAL_OSS_ENDPOINT ||
    region !== CANONICAL_OSS_REGION
  ) {
    throw new Error(
      `Aliyun OSS adapter requires ${CANONICAL_OSS_BUCKET} at ${CANONICAL_OSS_ENDPOINT} in ${CANONICAL_OSS_REGION}`
    )
  }
  if (
    typeof runCommand !== 'function' ||
    !Number.isSafeInteger(publicReadbackAttempts) ||
    publicReadbackAttempts < 1 ||
    !Number.isSafeInteger(publicReadbackDelayMs) ||
    publicReadbackDelayMs < 0 ||
    !Number.isSafeInteger(publicReadbackTimeoutMs) ||
    publicReadbackTimeoutMs < 1
  ) {
    throw new Error('Aliyun OSS adapter test hooks are invalid')
  }
  const objectUrl = (entry) => `oss://${bucket}/${entry.key}`
  const ossutilFlags = ['--endpoint', endpoint]
  const assertConditionalWriteSafety = async () => {
    const result = runCommand(
      'ossutil',
      [
        'api',
        'get-bucket-versioning',
        '--bucket',
        bucket,
        '--endpoint',
        endpoint,
        '--region',
        region,
        '--output-format',
        'json',
      ],
      'read OSS bucket versioning',
      { timeoutMs: OSS_PROBE_TIMEOUT_MS }
    )
    return parseAliyunBucketVersioning(result.output)
  }
  return {
    publicReadbackAttempts,
    publicReadbackTimeoutMs,
    waitForPublicReadback() {
      return new Promise((resolve) =>
        setTimeout(resolve, publicReadbackDelayMs)
      )
    },
    async download(entry, destination) {
      ensureDirectory(destination)
      const result = runCommand(
        'ossutil',
        [
          'cp',
          objectUrl(entry),
          destination,
          '--force',
          '--no-progress',
          ...ossutilFlags,
        ],
        `download ${entry.key}`,
        { allowNotFound: true, timeoutMs: OSS_TRANSFER_TIMEOUT_MS }
      )
      return result.found
    },
    async upload(entry, source, metadata = objectMetadata(entry)) {
      const exactMetadata = objectMetadata({ id: entry.id, ...metadata })
      const args = [
        'cp',
        source,
        objectUrl(entry),
        '--force',
        '--no-progress',
        ...ossutilFlags,
        '--acl',
        exactMetadata.acl,
        '--storage-class',
        exactMetadata.storageClass,
        '--cache-control',
        exactMetadata.cacheControl,
        '--content-type',
        exactMetadata.contentType,
      ]
      for (const [flag, value] of [
        ['--content-encoding', exactMetadata.contentEncoding],
        ['--content-disposition', exactMetadata.contentDisposition],
        ['--expires', exactMetadata.expires],
      ]) {
        if (value) args.push(flag, value)
      }
      for (const [name, value] of Object.entries(
        exactMetadata.customMetadata
      )) {
        args.push('--metadata', `${name}=${value}`)
      }
      runCommand('ossutil', args, `upload ${entry.key}`, {
        timeoutMs: OSS_TRANSFER_TIMEOUT_MS,
      })
    },
    async uploadIfAbsent(
      entry,
      source,
      metadata = objectMetadata(entry)
    ) {
      const exactMetadata = objectMetadata({ id: entry.id, ...metadata })
      if (
        exactMetadata.contentEncoding !== null ||
        exactMetadata.contentDisposition !== null ||
        exactMetadata.expires !== null ||
        Object.keys(exactMetadata.customMetadata).length !== 0
      ) {
        throw new Error(
          `conditional upload metadata is unsupported for ${entry.key}`
        )
      }
      await assertConditionalWriteSafety()
      runCommand(
        'ossutil',
        [
          'api',
          'put-object',
          '--bucket',
          bucket,
          '--key',
          entry.key,
          '--body',
          `file://${source}`,
          '--content-type',
          exactMetadata.contentType,
          '--cache-control',
          exactMetadata.cacheControl,
          '--object-acl',
          exactMetadata.acl,
          '--storage-class',
          exactMetadata.storageClass,
          '--forbid-overwrite',
          'true',
          '--endpoint',
          endpoint,
          '--region',
          region,
          '--output-format',
          'json',
        ],
        `conditional upload ${entry.key}`,
        { timeoutMs: OSS_TRANSFER_TIMEOUT_MS }
      )
    },
    assertConditionalWriteSafety,
    async readMetadata(entry) {
      const result = runCommand(
        'ossutil',
        [
          'stat',
          objectUrl(entry),
          ...ossutilFlags,
          '--output-format',
          'json',
        ],
        `read metadata ${entry.key}`,
        { timeoutMs: OSS_PROBE_TIMEOUT_MS }
      )
      return parseAliyunObjectMetadata(result.output, entry)
    },
    async remove(entry) {
      runCommand(
        'ossutil',
        ['rm', objectUrl(entry), '--force', ...ossutilFlags],
        `remove ${entry.key}`,
        { allowNotFound: true, timeoutMs: OSS_PROBE_TIMEOUT_MS }
      )
    },
    async purge(entries) {
      runCommand(
        'aliyun',
        [
          '--profile',
          profile,
          'cdn',
          'RefreshObjectCaches',
          '--ObjectPath',
          entries.map(({ publicUrl }) => publicUrl).join('\n'),
          '--ObjectType',
          'File',
        ],
        'purge Aliyun CDN objects',
        { timeoutMs: OSS_PROBE_TIMEOUT_MS }
      )
    },
    async downloadPublic(entry, destination) {
      runCommand(
        'curl',
        [
          '--fail',
          '--silent',
          '--show-error',
          '--location',
          '--connect-timeout',
          '5',
          '--max-time',
          '15',
          '--header',
          'Cache-Control: no-cache',
          '--output',
          destination,
          entry.publicUrl,
        ],
        `read public URL ${entry.publicUrl}`
      )
    },
    async downloadPublicOptional(entry, destination) {
      ensureDirectory(destination)
      const marker = '__BIYAN_PUBLIC_READBACK__'
      const headerFile = `${destination}.headers`
      fs.rmSync(headerFile, { force: true })
      const result = runCommand(
        'curl',
        [
          '--silent',
          '--show-error',
          '--location',
          '--connect-timeout',
          '5',
          '--max-time',
          '15',
          '--header',
          'Cache-Control: no-cache',
          '--output',
          destination,
          '--dump-header',
          headerFile,
          '--write-out',
          `${marker}%{http_code}\\n%{url_effective}`,
          entry.publicUrl,
        ],
        `probe public URL ${entry.publicUrl}`
      )
      const markerIndex = result.output.lastIndexOf(marker)
      if (markerIndex < 0) {
        throw new Error(
          `Public URL probe returned no status for ${entry.publicUrl}`
        )
      }
      const [status, effectiveUrl] = result.output
        .slice(markerIndex + marker.length)
        .trim()
        .split(/\r?\n/, 2)
      if (effectiveUrl !== entry.publicUrl) {
        throw new Error(
          `Public URL redirected unexpectedly: ${entry.publicUrl} -> ${effectiveUrl}`
        )
      }
      if (status === '404') {
        fs.rmSync(destination, { force: true })
        fs.rmSync(headerFile, { force: true })
        return {
          exists: false,
          status: 404,
          effectiveUrl,
          headers: null,
        }
      }
      if (status !== '200') {
        throw new Error(
          `Public URL returned HTTP ${status || 'unknown'}: ${entry.publicUrl}`
        )
      }
      let headerText
      try {
        headerText = fs.readFileSync(headerFile, 'utf8')
      } finally {
        fs.rmSync(headerFile, { force: true })
      }
      const blocks = headerText
        .split(/\r?\n\r?\n/)
        .map((block) => block.trim())
        .filter((block) => /^HTTP\/\S+\s+\d{3}\b/i.test(block))
      const finalBlock = blocks.at(-1)
      if (!finalBlock) {
        throw new Error(
          `Public URL probe returned no response headers for ${entry.publicUrl}`
        )
      }
      const headers = {}
      for (const line of finalBlock.split(/\r?\n/).slice(1)) {
        const separator = line.indexOf(':')
        if (separator < 1) continue
        const name = line.slice(0, separator).trim().toLowerCase()
        const value = line.slice(separator + 1).trim()
        if (headers[name] !== undefined) {
          throw new Error(
            `Public URL returned duplicate ${name} headers: ${entry.publicUrl}`
          )
        }
        headers[name] = value
      }
      return {
        exists: true,
        status: 200,
        effectiveUrl,
        headers: {
          cacheControl: headers['cache-control'] ?? null,
          contentType: headers['content-type'] ?? null,
        },
      }
    },
  }
}

export function parseAliyunBucketVersioning(output) {
  const start = output.indexOf('{')
  const end = output.lastIndexOf('}')
  if (start < 0 || end < start) {
    throw new Error('OSS bucket versioning response is not JSON')
  }
  let document
  try {
    document = JSON.parse(output.slice(start, end + 1))
  } catch {
    throw new Error('OSS bucket versioning response is malformed')
  }
  const statuses = []
  const visit = (value) => {
    if (!value || typeof value !== 'object') return
    for (const [name, child] of Object.entries(value)) {
      if (
        name.toLowerCase() === 'status' &&
        typeof child === 'string' &&
        child.trim()
      ) {
        statuses.push(child.trim())
      }
      visit(child)
    }
  }
  visit(document)
  if (statuses.length > 1) {
    throw new Error('OSS bucket versioning response has multiple statuses')
  }
  if (statuses.length === 1) {
    throw new Error(
      `Conditional OSS writes are unsafe while bucket versioning is ${statuses[0]}`
    )
  }
  return {
    status: 'Unversioned',
  }
}

function parseArgs(argv) {
  const result = { dryRun: false }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--dry-run') {
      if (result.dryRun) throw new Error('Duplicate argument: --dry-run')
      result.dryRun = true
      continue
    }
    if (
      ![
        '--release-json',
        '--payload-dir',
        '--tag',
        '--evidence',
        '--recovery',
      ].includes(argument)
    ) {
      throw new Error(`Unexpected argument: ${argument}`)
    }
    const value = argv[index + 1]
    if (!value || value.startsWith('--') || result[argument]) {
      throw new Error(`Missing or duplicate value for ${argument}`)
    }
    result[argument] = value
    index += 1
  }
  for (const required of [
    '--release-json',
    '--payload-dir',
    '--tag',
    '--evidence',
    '--recovery',
  ]) {
    if (!result[required])
      throw new Error(`Missing required argument: ${required}`)
  }
  return result
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`
}

export function buildBoundedPublicReadbackCommand(
  publicUrl,
  expectedSha256,
  { timeoutSeconds = 600, pollSeconds = 10 } = {}
) {
  let url
  try {
    url = new URL(publicUrl)
  } catch {
    throw new Error('Recovery public readback URL is invalid')
  }
  if (
    !String(publicUrl).startsWith(`${CANONICAL_DOWNLOAD_ORIGIN}/`) ||
    url.origin !== CANONICAL_DOWNLOAD_ORIGIN ||
    url.search ||
    url.hash ||
    !/^[0-9a-f]{64}$/.test(expectedSha256 ?? '') ||
    !Number.isSafeInteger(timeoutSeconds) ||
    timeoutSeconds < 1 ||
    timeoutSeconds > 600 ||
    typeof pollSeconds !== 'number' ||
    !Number.isFinite(pollSeconds) ||
    pollSeconds <= 0 ||
    pollSeconds > 60
  ) {
    throw new Error('Recovery public readback contract is invalid')
  }
  return [
    'tmp="$(mktemp)"',
    `expected=${shellQuote(expectedSha256)}`,
    `url=${shellQuote(publicUrl)}`,
    `deadline="$(( $(date +%s) + ${timeoutSeconds} ))"`,
    'trap \'rm -f "$tmp"\' EXIT',
    'while :; do',
    'if curl --fail --silent --show-error --location --connect-timeout 5 --max-time 15 --header \'Cache-Control: no-cache\' --output "$tmp" "$url"; then',
    'actual="$(sha256sum "$tmp" | cut -d\' \' -f1)"',
    'if [ "$actual" = "$expected" ]; then exit 0; fi',
    'fi',
    'if [ "$(date +%s)" -ge "$deadline" ]; then echo "CDN did not converge to $expected within the bounded recovery window: $url" >&2; exit 1; fi',
    `sleep ${pollSeconds}`,
    'done',
  ].join('\n')
}

const recoveryMetadataVerifier = String.raw`
const fs = require('node:fs')
const output = fs.readFileSync(process.argv[1], 'utf8')
const expected = JSON.parse(Buffer.from(process.argv[2], 'base64').toString('utf8'))
const start = output.indexOf('{')
const end = output.lastIndexOf('}')
if (start < 0 || end <= start) throw new Error('OSS metadata response is not JSON')
const document = JSON.parse(output.slice(start, end + 1))
const scalars = new Map()
const customMetadata = {}
function visit(value, parentKey = '') {
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (
      parentKey === 'metadata' &&
      (typeof child === 'string' || typeof child === 'number') &&
      ![
        'cachecontrol',
        'contenttype',
        'contentencoding',
        'contentdisposition',
        'expires',
        'acl',
        'storageclass',
      ].includes(normalized)
    ) {
      customMetadata[key.replace(/^x-oss-meta-/i, '')] = String(child)
    }
    if (typeof child === 'string' || typeof child === 'number') {
      if (!scalars.has(normalized)) scalars.set(normalized, String(child))
    } else {
      visit(child, normalized)
    }
  }
}
visit(document)
const optional = (name) => scalars.get(name) || null
const actual = {
  cacheControl: scalars.get('cachecontrol'),
  contentType: scalars.get('contenttype'),
  contentEncoding: optional('contentencoding'),
  contentDisposition: optional('contentdisposition'),
  expires: optional('expires'),
  acl: scalars.get('acl'),
  storageClass: scalars.get('storageclass'),
  customMetadata: Object.fromEntries(
    Object.entries(customMetadata).sort(([left], [right]) => left.localeCompare(right))
  ),
}
if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  throw new Error(
    'OSS metadata mismatch: expected ' +
      JSON.stringify(expected) +
      ', received ' +
      JSON.stringify(actual)
  )
}
`.trim()

function httpsOrigin(value, label, { allowBareHost = false } = {}) {
  const source = String(value ?? '').trim()
  const candidate =
    allowBareHost && !source.includes('://') ? `https://${source}` : source
  let url
  try {
    url = new URL(candidate)
  } catch {
    throw new Error(`${label} must be an HTTPS origin`)
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${label} must be an HTTPS origin`)
  }
  return url.origin
}

function buildPlan(args) {
  const release = JSON.parse(
    fs.readFileSync(path.resolve(args['--release-json']), 'utf8')
  )
  const tag = args['--tag']
  if (release.tagName !== tag) {
    throw new Error(
      `Release ${release.tagName} does not match transaction ${tag}`
    )
  }
  const payloadDirectory = path.resolve(args['--payload-dir'])
  const bucket = process.env.ALIYUN_OSS_BUCKET
  if (bucket !== CANONICAL_OSS_BUCKET) {
    throw new Error(
      `ALIYUN_OSS_BUCKET must be exactly ${CANONICAL_OSS_BUCKET}`
    )
  }
  const endpoint = String(process.env.ALIYUN_OSS_ENDPOINT ?? '')
  if (endpoint !== CANONICAL_OSS_ENDPOINT) {
    throw new Error(
      `ALIYUN_OSS_ENDPOINT must be exactly ${CANONICAL_OSS_ENDPOINT}`
    )
  }
  const configuredCdnBase = String(process.env.UPDATES_CDN_BASE_URL ?? '')
  if (configuredCdnBase !== CANONICAL_DOWNLOAD_ORIGIN) {
    throw new Error(
      `UPDATES_CDN_BASE_URL must be exactly ${CANONICAL_DOWNLOAD_ORIGIN}`
    )
  }
  const cdnBase = httpsOrigin(configuredCdnBase, 'UPDATES_CDN_BASE_URL')
  const versionRoot = `biyan/download/releases/${tag}`
  const transactionId = `${process.env.GITHUB_RUN_ID ?? 'local'}-${
    process.env.GITHUB_RUN_ATTEMPT ?? '1'
  }-${tag.slice(1)}`
  const immutable = [
    [
      'macos-dmg',
      release.assets?.macosDmg?.name,
      'application/x-apple-diskimage',
    ],
    [
      'windows-exe',
      release.assets?.windowsExe?.name,
      'application/octet-stream',
    ],
    [
      'windows-msi',
      release.assets?.windowsMsi?.name,
      'application/octet-stream',
    ],
    [
      'linux-appimage',
      release.assets?.linuxAppImage?.name,
      'application/vnd.appimage',
    ],
    [
      'linux-deb',
      release.assets?.linuxDeb?.name,
      'application/vnd.debian.binary-package',
    ],
  ].map(([id, name, contentType]) => ({
    id,
    provider: 'aliyun',
    key: `${versionRoot}/${name}`,
    file: path.join(path.dirname(path.resolve(args['--release-json'])), name),
    cacheControl: 'public, max-age=31536000, immutable',
    contentType,
  }))
  immutable.push(
    {
      id: 'version-manifest',
      provider: 'aliyun',
      key: `${versionRoot}/download.json`,
      file: path.join(payloadDirectory, 'latest.json'),
      cacheControl: 'public, max-age=31536000, immutable',
      contentType: 'application/json',
    },
    {
      id: 'version-page',
      provider: 'aliyun',
      key: `${versionRoot}/index.html`,
      file: path.join(payloadDirectory, 'index.html'),
      cacheControl: 'public, max-age=31536000, immutable',
      contentType: 'text/html; charset=utf-8',
    }
  )
  const mutableSources = [
    [
      'biyan-manifest',
      'biyan/download/latest.json',
      'latest.json',
      'application/json',
    ],
    ['biyan-page', 'biyan/download', 'index.html', 'text/html; charset=utf-8'],
    [
      'legacy-manifest',
      'mita/download/latest.json',
      'latest.json',
      'application/json',
    ],
    ['legacy-page', 'mita/download', 'index.html', 'text/html; charset=utf-8'],
  ]
  const transactionRoot = `biyan/download/transactions/${transactionId}`
  const stagingRoot = `${transactionRoot}/staging`
  const recoveryRoot = `${transactionRoot}/prestate`
  const mutable = mutableSources.map(([id, key, file, contentType]) => ({
    id,
    provider: 'aliyun',
    key,
    stagingKey: `${stagingRoot}/${id}`,
    recoveryKey: `${recoveryRoot}/${id}`,
    file: path.join(payloadDirectory, file),
    publicUrl: `${cdnBase}/${key}`,
    cacheControl: 'public, max-age=60, must-revalidate',
    contentType,
  }))
  return {
    schema: 1,
    transactionId,
    tag,
    immutable,
    mutable,
    journal: {
      provider: 'aliyun',
      activeKey: 'biyan/download/transactions/active.json',
      immutableRoot: `${transactionRoot}/journal`,
    },
    recoveryCommand(entry, _prestateFile, metadata) {
      const args = [
        'ossutil cp',
        shellQuote(`oss://${bucket}/${entry.recoveryKey}`),
        shellQuote(`oss://${bucket}/${entry.key}`),
        '--force --no-progress --copy-props none',
        `--endpoint ${shellQuote(endpoint)}`,
        `--acl ${shellQuote(metadata.acl)}`,
        `--storage-class ${shellQuote(metadata.storageClass)}`,
        `--cache-control ${shellQuote(metadata.cacheControl)}`,
        `--content-type ${shellQuote(metadata.contentType)}`,
      ]
      for (const [flag, value] of [
        ['--content-encoding', metadata.contentEncoding],
        ['--content-disposition', metadata.contentDisposition],
        ['--expires', metadata.expires],
      ]) {
        if (value) args.push(`${flag} ${shellQuote(value)}`)
      }
      for (const [name, value] of Object.entries(metadata.customMetadata)) {
        args.push(`--metadata ${shellQuote(`${name}=${value}`)}`)
      }
      return args.join(' ')
    },
    recoveryPurgeCommand(provider, entries) {
      if (provider !== 'aliyun') {
        throw new Error(`Unsupported recovery purge provider: ${provider}`)
      }
      return `aliyun --profile release cdn RefreshObjectCaches --ObjectPath ${shellQuote(entries.map(({ publicUrl }) => publicUrl).join('\n'))} --ObjectType File`
    },
    recoveryReadbackCommand(entry, _prestateFile, prestateSha256, metadata) {
      const object = shellQuote(`oss://${bucket}/${entry.key}`)
      const endpointArgument = shellQuote(endpoint)
      const expected = shellQuote(prestateSha256)
      const expectedMetadata = shellQuote(
        Buffer.from(JSON.stringify(metadata), 'utf8').toString('base64')
      )
      return `tmp="$(mktemp)" && metadata_file="$(mktemp)" && trap 'rm -f "$tmp" "$metadata_file"' EXIT && ossutil cp ${object} "$tmp" --endpoint ${endpointArgument} --force --no-progress && printf '%s  %s\\n' ${expected} "$tmp" | sha256sum --check - && ossutil stat ${object} --endpoint ${endpointArgument} --output-format json > "$metadata_file" && node -e ${shellQuote(recoveryMetadataVerifier)} "$metadata_file" ${expectedMetadata}`
    },
    recoveryPublicReadbackCommand(entry, expectedSha256) {
      return buildBoundedPublicReadbackCommand(
        entry.publicUrl,
        expectedSha256
      )
    },
    recoveryCleanupTemporaryCommand(entry) {
      const objects = [entry.stagingKey, entry.recoveryKey]
        .map((key) => shellQuote(`oss://${bucket}/${key}`))
        .join(' ')
      const endpointArgument = shellQuote(endpoint)
      return `probe="$(mktemp)" && trap 'rm -f "$probe"' EXIT && for object in ${objects}; do ossutil rm "$object" --endpoint ${endpointArgument} --force || exit 1; if ossutil stat "$object" --endpoint ${endpointArgument} --output-format json > "$probe" 2>&1; then echo "Temporary publication object still exists: $object" >&2; exit 1; fi; grep -Eiq 'NoSuchKey|Status(Code)?:?[[:space:]]*404|HTTP status:[[:space:]]*404|does not exist' "$probe" || exit 1; done`
    },
    recoveryClearActiveCommand(journal) {
      const object = shellQuote(`oss://${bucket}/${journal.activeKey}`)
      const endpointArgument = shellQuote(endpoint)
      return `probe="$(mktemp)" && trap 'rm -f "$probe"' EXIT && ossutil rm ${object} --endpoint ${endpointArgument} --force && if ossutil stat ${object} --endpoint ${endpointArgument} --output-format json > "$probe" 2>&1; then echo "Active transaction journal still exists" >&2; exit 1; fi && grep -Eiq 'NoSuchKey|Status(Code)?:?[[:space:]]*404|HTTP status:[[:space:]]*404|does not exist' "$probe"`
    },
    adapterConfig: { bucket, endpoint },
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const plan = buildPlan(args)
  const evidenceFile = path.resolve(args['--evidence'])
  const recoveryFile = path.resolve(args['--recovery'])
  const workspace = path.join(path.dirname(evidenceFile), 'transaction-work')
  const adapters = {
    aliyun: createAliyunAdapter(plan.adapterConfig),
  }
  try {
    const evidence = await executePublicationTransaction(plan, {
      adapters,
      workspace,
      evidenceFile,
      recoveryFile,
      dryRun: args.dryRun,
    })
    console.log(
      `Release distribution transaction ${plan.transactionId}: ${evidence.status}`
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
