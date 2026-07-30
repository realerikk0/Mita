import assert from 'node:assert/strict'
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign as signCryptoMessage,
} from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  buildReleaseNotes,
  validateReleaseNotesProductPolicy,
} from '../build-release-notes.mjs'
import {
  collectReleaseAssets,
  validateCandidateProvenance,
} from '../collect-release-assets.mjs'
import {
  buildDownloadManifest,
  buildDownloadPage,
} from '../build-download-manifest.mjs'
import {
  buildBoundedPublicReadbackCommand,
  buildPublicationPlan,
  createAliyunAdapter,
  executePublicationTransaction,
  parseAliyunObjectMetadata,
  PublicationTransactionError,
} from '../publish-download-transaction.mjs'
import {
  extractPosterHighlights,
  generateReleasePoster,
  validateJingxingBaseUrl,
} from '../generate-release-poster.mjs'
import {
  buildFeishuCard,
  buildFeishuAppMessagePayload,
  buildFeishuPayload,
  buildFeishuReleasePayloads,
  createFeishuSign,
  postFeishuAppMessage,
  resolvePosterImageKey,
} from '../send-feishu-card.mjs'
import { buildCandidate } from '../../updater/build-candidate.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const posterScript = path.resolve(here, '../generate-release-poster.mjs')
const feishuScript = path.resolve(here, '../send-feishu-card.mjs')
const workflowPath = path.resolve(
  here,
  '../../../.github/workflows/release-distribution.yml'
)
const transactionScriptPath = path.resolve(
  here,
  '../publish-download-transaction.mjs'
)
const sourceCommit = '0123456789abcdef0123456789abcdef01234567'
const sampleDigest = `sha256:${'a'.repeat(64)}`
const verifiedProvenance = {
  schema: 1,
  sourceCommit,
  migrationPhase: 'A',
  dataSchema: 1,
  candidateManifestSha256:
    'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
}

function releaseTrainPolicy(terminalSourceCommit = null) {
  const policy = JSON.parse(
    fs.readFileSync(
      new URL('../../ci/release-train-policy.json', import.meta.url),
      'utf8'
    )
  )
  policy.activeTerminalRelease =
    terminalSourceCommit === null
      ? null
      : {
          tag: 'v0.6.649',
          version: '0.6.649',
          migrationPhase: 'C',
          dataSchema: 3,
          sourceCommit: terminalSourceCommit,
        }
  if (terminalSourceCommit === null) {
    policy.supersededTerminalReleases = []
    policy.activeTrain = 'closure-20260724'
    policy.trains.at(-1).status = 'active'
  }
  return policy
}

function sampleRelease() {
  return {
    tagName: 'v1.2.3',
    name: 'Biyan v1.2.3',
    url: 'https://github.com/realerikk0/Mita/releases/tag/v1.2.3',
    publishedAt: '2026-05-15T08:00:00Z',
    isDraft: false,
    isPrerelease: false,
    body: [
      '## Changes',
      '',
      '## 🚀 Features',
      '- Added visible desktop updater @eric (#123)',
      '- Added manual update checks',
      '',
      '## 🐛 Fixes',
      '- Fixed updater CDN manifest parsing @eric (#124)',
    ].join('\n'),
    assets: [
      {
        name: 'Biyan_1.2.3_universal.dmg',
        url: 'https://github.com/realerikk0/Mita/releases/download/v1.2.3/Biyan_1.2.3_universal.dmg',
        size: 123,
        digest: sampleDigest,
      },
      {
        name: 'Biyan_1.2.3_x64-setup.exe',
        url: 'https://github.com/realerikk0/Mita/releases/download/v1.2.3/Biyan_1.2.3_x64-setup.exe',
        size: 456,
        digest: sampleDigest,
      },
      {
        name: 'Biyan_1.2.3_x64_en-US.msi',
        url: 'https://github.com/realerikk0/Mita/releases/download/v1.2.3/Biyan_1.2.3_x64_en-US.msi',
        size: 789,
        digest: sampleDigest,
      },
      {
        name: 'Biyan_1.2.3_amd64.AppImage',
        url: 'https://github.com/realerikk0/Mita/releases/download/v1.2.3/Biyan_1.2.3_amd64.AppImage',
        size: 987,
        digest: sampleDigest,
      },
      {
        name: 'Biyan_1.2.3_amd64.deb',
        url: 'https://github.com/realerikk0/Mita/releases/download/v1.2.3/Biyan_1.2.3_amd64.deb',
        size: 654,
        digest: sampleDigest,
      },
    ],
  }
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function transactionMetadata(cacheControl, contentType, overrides = {}) {
  return {
    cacheControl,
    contentType,
    contentEncoding: null,
    contentDisposition: null,
    expires: null,
    acl: 'default',
    storageClass: 'Standard',
    customMetadata: {},
    ...overrides,
  }
}

function transactionFixture(
  t,
  {
    activeJournal = false,
    failJournalAfterFirstLive = false,
    failClearActiveOnce = false,
    failLiveKey = null,
    failRemoveKey = null,
    failRollbackKey = null,
    failStagingKey = null,
    immutableConflict = false,
    publicReadbackClockStepMs = 0,
    publicReadbackTimeoutMs = null,
    stalePublicReads = 0,
  } = {}
) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'biyan-distribution-transaction-')
  )
  t.after(() => fs.rmSync(root, { force: true, recursive: true }))
  const file = (name, contents) => {
    const target = path.join(root, name)
    fs.writeFileSync(target, contents)
    return target
  }
  const stores = {
    aliyun: new Map([
      [
        'immutable/object',
        Buffer.from(immutableConflict ? 'wrong' : 'immutable'),
      ],
      ['live/a', Buffer.from('old-a')],
    ]),
    r2: new Map([['live/b', Buffer.from('old-b')]]),
  }
  const metadataStores = {
    aliyun: new Map([
      [
        'immutable/object',
        transactionMetadata(
          'public, max-age=31536000, immutable',
          'application/octet-stream',
          { acl: 'private' }
        ),
      ],
      [
        'live/a',
        transactionMetadata('old-cache-a', 'old/type-a', {
          acl: 'private',
        }),
      ],
    ]),
    r2: new Map([
      [
        'live/b',
        transactionMetadata('old-cache-b', 'old/type-b', {
          customMetadata: { source: 'legacy' },
        }),
      ],
    ]),
  }
  if (activeJournal) {
    stores.aliyun.set(
      'transactions/active.json',
      Buffer.from('{"schema":1,"status":"committing"}')
    )
    metadataStores.aliyun.set(
      'transactions/active.json',
      transactionMetadata('private, no-store', 'application/json', {
        acl: 'private',
      })
    )
  }
  const publicStores = {
    aliyun: new Map([['live/a', Buffer.from('old-a')]]),
    r2: new Map([['live/b', Buffer.from('old-b')]]),
  }
  const staleReadsRemaining = { aliyun: 0, r2: 0 }
  const publicReadbackClock = { aliyun: 0, r2: 0 }
  const calls = {
    download: [],
    downloadPublic: [],
    purge: [],
    readMetadata: [],
    remove: [],
    upload: [],
    waitForPublicReadback: 0,
  }
  const journalSnapshots = []
  let journalFailureInjected = false
  const faults = { failClearActiveOnce, failLiveKey, failRemoveKey }
  const cloneMetadata = (metadata) => ({
    ...metadata,
    customMetadata: { ...(metadata.customMetadata ?? {}) },
  })
  const adapter = (provider) => ({
    publicReadbackAttempts: Math.max(1, stalePublicReads + 2),
    publicReadbackTimeoutMs,
    publicReadbackNow() {
      return publicReadbackClock[provider]
    },
    async waitForPublicReadback() {
      calls.waitForPublicReadback += 1
      publicReadbackClock[provider] += publicReadbackClockStepMs
    },
    async download(entry, destination) {
      calls.download.push({ provider, key: entry.key })
      const bytes = stores[provider].get(entry.key)
      if (!bytes) return false
      fs.mkdirSync(path.dirname(destination), { recursive: true })
      fs.writeFileSync(destination, bytes)
      return true
    },
    async upload(
      entry,
      source,
      metadata = {
        cacheControl: entry.cacheControl,
        contentType: entry.contentType,
        contentEncoding: entry.contentEncoding ?? null,
        contentDisposition: entry.contentDisposition ?? null,
        expires: entry.expires ?? null,
        acl: entry.acl ?? 'default',
        storageClass: entry.storageClass ?? 'Standard',
        customMetadata: entry.customMetadata ?? {},
      }
    ) {
      const bytes = fs.readFileSync(source)
      const uploadCall = {
        provider,
        key: entry.key,
        bytes: bytes.toString(),
        metadata: cloneMetadata(metadata),
      }
      calls.upload.push(uploadCall)
      if (entry.key === failStagingKey) {
        throw new Error(`injected staging failure for ${entry.key}`)
      }
      if (
        entry.key === faults.failLiveKey &&
        bytes.toString().startsWith('new-')
      ) {
        throw new Error(`injected commit failure for ${entry.key}`)
      }
      if (
        entry.key === failRollbackKey &&
        bytes.toString().startsWith('old-')
      ) {
        throw new Error(`injected rollback failure for ${entry.key}`)
      }
      let journalSnapshot = null
      if (
        entry.key === 'transactions/active.json' ||
        entry.key.startsWith('transactions/test/journal/')
      ) {
        journalSnapshot = JSON.parse(bytes.toString())
        journalSnapshots.push({
          key: entry.key,
          document: journalSnapshot,
        })
      }
      if (
        failJournalAfterFirstLive &&
        !journalFailureInjected &&
        entry.key === 'transactions/active.json' &&
        journalSnapshot?.evidence?.status === 'committing' &&
        journalSnapshot.evidence.mutable?.[0]?.committed === true &&
        journalSnapshot.evidence.mutable?.[1]?.committed === false
      ) {
        journalFailureInjected = true
        throw new Error('injected runner loss after first live write')
      }
      stores[provider].set(entry.key, bytes)
      metadataStores[provider].set(entry.key, cloneMetadata(metadata))
    },
    async remove(entry) {
      calls.remove.push({ provider, key: entry.key })
      if (
        entry.key === 'transactions/active.json' &&
        faults.failClearActiveOnce
      ) {
        faults.failClearActiveOnce = false
        throw new Error('injected active journal clear failure')
      }
      if (entry.key === faults.failRemoveKey) {
        throw new Error(`injected cleanup failure for ${entry.key}`)
      }
      stores[provider].delete(entry.key)
      metadataStores[provider].delete(entry.key)
    },
    async purge(entries) {
      calls.purge.push({
        provider,
        keys: entries.map(({ key }) => key),
      })
      staleReadsRemaining[provider] = stalePublicReads
    },
    async readMetadata(entry) {
      calls.readMetadata.push({ provider, key: entry.key })
      const metadata = metadataStores[provider].get(entry.key)
      if (!metadata) throw new Error(`missing metadata ${entry.key}`)
      return cloneMetadata(metadata)
    },
    async downloadPublic(entry, destination) {
      calls.downloadPublic.push({ provider, key: entry.key })
      let bytes
      if (staleReadsRemaining[provider] > 0) {
        staleReadsRemaining[provider] -= 1
        bytes = publicStores[provider].get(entry.key)
      } else {
        bytes = stores[provider].get(entry.key)
        if (bytes) publicStores[provider].set(entry.key, Buffer.from(bytes))
      }
      if (!bytes) throw new Error(`missing public object ${entry.key}`)
      fs.mkdirSync(path.dirname(destination), { recursive: true })
      fs.writeFileSync(destination, bytes)
    },
  })
  const plan = {
    schema: 1,
    transactionId: 'test-transaction',
    tag: 'v0.6.643',
    recoveryCommand(entry, prestateFile) {
      return `${entry.provider}-restore ${JSON.stringify(entry.recoveryKey)} ${JSON.stringify(prestateFile)} ${JSON.stringify(entry.key)}`
    },
    recoveryPurgeCommand(provider, entries) {
      return `${provider}-purge ${entries.map(({ key }) => key).join(',')}`
    },
    recoveryReadbackCommand(entry, prestateFile, expectedSha256) {
      return `${entry.provider}-readback ${JSON.stringify(prestateFile)} ${expectedSha256}`
    },
    recoveryPublicReadbackCommand(entry, expectedSha256) {
      return `${entry.provider}-cdn-readback ${JSON.stringify(entry.publicUrl)} ${expectedSha256}`
    },
    recoveryCleanupTemporaryCommand(entry) {
      return `${entry.provider}-cleanup ${JSON.stringify(entry.stagingKey)} ${JSON.stringify(entry.recoveryKey)}`
    },
    recoveryClearActiveCommand(journal) {
      return `aliyun-clear-active ${JSON.stringify(journal.activeKey)}`
    },
    journal: {
      provider: 'aliyun',
      activeKey: 'transactions/active.json',
      immutableRoot: 'transactions/test/journal',
    },
    immutable: [
      {
        id: 'immutable',
        provider: 'aliyun',
        key: 'immutable/object',
        file: file('immutable', 'immutable'),
        cacheControl: 'public, max-age=31536000, immutable',
        contentType: 'application/octet-stream',
        acl: 'private',
        storageClass: 'Standard',
      },
    ],
    mutable: [
      {
        id: 'live-a',
        provider: 'aliyun',
        key: 'live/a',
        stagingKey: 'staging/a',
        recoveryKey: 'recovery/a',
        file: file('new-a', 'new-a'),
        publicUrl: 'https://static.mitapp.cn/live/a',
        cacheControl: 'new-cache-a',
        contentType: 'new/type-a',
        acl: 'private',
        storageClass: 'Standard',
      },
      {
        id: 'live-b',
        provider: 'r2',
        key: 'live/b',
        stagingKey: 'staging/b',
        recoveryKey: 'recovery/b',
        file: file('new-b', 'new-b'),
        publicUrl: 'https://static.mitapp.cn/live/b',
        cacheControl: 'new-cache-b',
        contentType: 'new/type-b',
        acl: 'default',
        storageClass: 'Standard',
      },
    ],
  }
  return {
    adapters: {
      aliyun: adapter('aliyun'),
      r2: adapter('r2'),
    },
    evidenceFile: path.join(root, 'evidence.json'),
    calls,
    faults,
    journalSnapshots,
    metadataStores,
    plan,
    recoveryFile: path.join(root, 'recovery.json'),
    root,
    stores,
  }
}

function seedActiveJournal(fixture, document) {
  fixture.stores.aliyun.set(
    fixture.plan.journal.activeKey,
    Buffer.from(`${JSON.stringify(document, null, 2)}\n`)
  )
  fixture.metadataStores.aliyun.set(
    fixture.plan.journal.activeKey,
    transactionMetadata('private, no-store', 'application/json', {
      acl: 'private',
    })
  )
}

function seedTerminalTemporaryObjects(fixture, document) {
  for (const recorded of document.evidence.mutable) {
    for (const key of [recorded.stagingKey, recorded.recoveryKey]) {
      fixture.stores[recorded.provider].set(key, Buffer.from(`orphan-${key}`))
      fixture.metadataStores[recorded.provider].set(
        key,
        transactionMetadata('private, no-store', 'application/octet-stream')
      )
    }
  }
}

function signingFixture() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const publicDer = publicKey.export({ format: 'der', type: 'spki' })
  const rawPublicKey = publicDer.subarray(publicDer.length - 32)
  const keyId = randomBytes(8)
  const publicPayload = Buffer.concat([
    Buffer.from('Ed', 'ascii'),
    keyId,
    rawPublicKey,
  ])
  const publicText = [
    'untrusted comment: minisign public key: 9195390A4D7B61AC',
    publicPayload.toString('base64'),
    '',
  ].join('\n')

  return {
    pubkey: Buffer.from(publicText, 'utf8').toString('base64'),
    sign(file, name) {
      const prehash = createHash('blake2b512')
        .update(fs.readFileSync(file))
        .digest()
      const signature = signCryptoMessage(null, prehash, privateKey)
      const trustedComment = `timestamp:1770000000\tfile:${name}\tprehashed`
      const globalSignature = signCryptoMessage(
        null,
        Buffer.concat([signature, Buffer.from(trustedComment, 'utf8')]),
        privateKey
      )
      const signaturePayload = Buffer.concat([
        Buffer.from('ED', 'ascii'),
        keyId,
        signature,
      ])
      const signatureText = [
        'untrusted comment: signature from minisign secret key',
        signaturePayload.toString('base64'),
        `trusted comment: ${trustedComment}`,
        globalSignature.toString('base64'),
        '',
      ].join('\n')
      return Buffer.from(signatureText, 'utf8').toString('base64')
    },
  }
}

function candidateFixture({
  version = '0.6.643',
  migrationPhase = 'A',
  dataSchema = 1,
} = {}) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'biyan-distribution-candidate-')
  )
  const inputs = path.join(root, 'inputs')
  const candidateDir = path.join(root, 'candidate')
  const signing = signingFixture()
  fs.mkdirSync(inputs, { recursive: true })
  for (const [name, contents] of [
    ['Biyan.app.tar.gz', 'mac-app'],
    [`Biyan_${version}_universal.dmg`, 'mac-dmg'],
    [`Biyan_${version}_x64-setup.exe`, 'windows-installer'],
    [`Biyan_${version}_x64_en-US.msi`, 'windows-msi'],
    [`Biyan_${version}_amd64.AppImage`, 'linux-appimage'],
    [`Biyan_${version}_amd64.deb`, 'linux-deb'],
  ]) {
    fs.writeFileSync(path.join(inputs, name), contents)
  }
  for (const name of [
    'Biyan.app.tar.gz',
    `Biyan_${version}_x64-setup.exe`,
    `Biyan_${version}_amd64.AppImage`,
  ]) {
    fs.writeFileSync(
      path.join(inputs, `${name}.sig`),
      signing.sign(path.join(inputs, name), name)
    )
  }
  buildCandidate({
    version,
    tag: `v${version}`,
    artifactsDir: inputs,
    outputDir: candidateDir,
    assetBaseUrl: 'https://static.mitapp.cn',
    publishedAt: '2026-05-15T07:00:00Z',
    sourceCommit,
    migrationPhase,
    dataSchema,
  })
  const candidatePath = path.join(candidateDir, 'candidate.json')
  fs.writeFileSync(
    path.join(candidateDir, 'candidate.json.sig'),
    signing.sign(candidatePath, 'candidate.json')
  )
  const checksummed = [
    'Biyan.app.tar.gz',
    'Biyan.app.tar.gz.sig',
    `Biyan_${version}_universal.dmg`,
    `Biyan_${version}_x64-setup.exe`,
    `Biyan_${version}_x64-setup.exe.sig`,
    `Biyan_${version}_x64_en-US.msi`,
    `Biyan_${version}_amd64.AppImage`,
    `Biyan_${version}_amd64.AppImage.sig`,
    `Biyan_${version}_amd64.deb`,
    'candidate.json',
    'candidate.json.sig',
    'latest.json',
  ]
  fs.writeFileSync(
    path.join(candidateDir, 'SHA256SUMS'),
    `${checksummed
      .map((name) => `${sha256(path.join(candidateDir, name))}  ${name}`)
      .join('\n')}\n`
  )

  const release = sampleRelease()
  release.tagName = `v${version}`
  release.name = `Biyan v${version}`
  release.url = `https://github.com/realerikk0/Mita/releases/tag/v${version}`
  release.assets = fs.readdirSync(candidateDir).map((name) => ({
    name,
    url: `https://github.com/realerikk0/Mita/releases/download/v${version}/${name}`,
    size: fs.statSync(path.join(candidateDir, name)).size,
    digest: `sha256:${sha256(path.join(candidateDir, name))}`,
  }))
  return {
    root,
    candidateDir,
    release,
    signing,
    options: {
      assetsDir: candidateDir,
      candidateDir,
      expectedSourceCommit: sourceCommit,
      releaseMetadata: {
        schema: 1,
        migrationPhase,
        dataSchema,
      },
      tauriConfig: {
        version,
        plugins: { updater: { pubkey: signing.pubkey } },
      },
      cargoLock: `[[package]]\nname = "Biyan"\nversion = "${version}"\n`,
      trainPolicy: releaseTrainPolicy(),
    },
  }
}

function refreshCandidateMetadata(candidateDir, signing) {
  const candidatePath = path.join(candidateDir, 'candidate.json')
  const manifestPath = path.join(candidateDir, 'latest.json')
  const candidate = JSON.parse(fs.readFileSync(candidatePath, 'utf8'))
  for (const asset of candidate.assets) {
    asset.sha256 = sha256(path.join(candidateDir, asset.file))
    asset.signatureSha256 = sha256(path.join(candidateDir, asset.signatureFile))
  }
  for (const asset of Object.values(candidate.distributionAssets)) {
    asset.sha256 = sha256(path.join(candidateDir, asset.file))
  }
  candidate.manifestSha256 = sha256(manifestPath)
  fs.writeFileSync(candidatePath, `${JSON.stringify(candidate, null, 2)}\n`)
  fs.writeFileSync(
    path.join(candidateDir, 'candidate.json.sig'),
    signing.sign(candidatePath, 'candidate.json')
  )
  const checksummed = [
    'Biyan.app.tar.gz',
    'Biyan.app.tar.gz.sig',
    `Biyan_${candidate.version}_universal.dmg`,
    `Biyan_${candidate.version}_x64-setup.exe`,
    `Biyan_${candidate.version}_x64-setup.exe.sig`,
    `Biyan_${candidate.version}_x64_en-US.msi`,
    `Biyan_${candidate.version}_amd64.AppImage`,
    `Biyan_${candidate.version}_amd64.AppImage.sig`,
    `Biyan_${candidate.version}_amd64.deb`,
    'candidate.json',
    'candidate.json.sig',
    'latest.json',
  ]
  fs.writeFileSync(
    path.join(candidateDir, 'SHA256SUMS'),
    `${checksummed
      .map((name) => `${sha256(path.join(candidateDir, name))}  ${name}`)
      .join('\n')}\n`
  )
}

function provenanceOptions(fixture) {
  return {
    tagName: fixture.release.tagName,
    version: fixture.release.tagName.slice(1),
    expectedSourceCommit: fixture.options.expectedSourceCommit,
    releaseMetadata: fixture.options.releaseMetadata,
    tauriConfig: fixture.options.tauriConfig,
    cargoLock: fixture.options.cargoLock,
    releasePublishedAt: fixture.release.publishedAt,
    trainPolicy: fixture.options.trainPolicy,
  }
}

test('collectReleaseAssets requires exact macOS, Windows, and Linux package names', () => {
  const manifest = collectReleaseAssets(sampleRelease())

  assert.equal(manifest.tagName, 'v1.2.3')
  assert.match(manifest.body, /Added visible desktop updater/)
  assert.equal(manifest.assets.macosDmg.name, 'Biyan_1.2.3_universal.dmg')
  assert.equal(manifest.assets.windowsExe.name, 'Biyan_1.2.3_x64-setup.exe')
  assert.equal(manifest.assets.windowsMsi.name, 'Biyan_1.2.3_x64_en-US.msi')
  assert.equal(manifest.assets.linuxAppImage.name, 'Biyan_1.2.3_amd64.AppImage')
  assert.equal(manifest.assets.linuxDeb.name, 'Biyan_1.2.3_amd64.deb')
})

test('publication transaction commits only after cross-provider staging and strict readback', async (t) => {
  const fixture = transactionFixture(t)
  const evidence = await executePublicationTransaction(fixture.plan, {
    adapters: fixture.adapters,
    workspace: path.join(fixture.root, 'work'),
    evidenceFile: fixture.evidenceFile,
    recoveryFile: fixture.recoveryFile,
  })
  assert.equal(evidence.status, 'committed')
  assert.equal(fixture.stores.aliyun.get('live/a').toString(), 'new-a')
  assert.equal(fixture.stores.r2.get('live/b').toString(), 'new-b')
  assert.equal(
    JSON.parse(fs.readFileSync(fixture.evidenceFile, 'utf8')).status,
    'committed'
  )
  assert.deepEqual(
    JSON.parse(fs.readFileSync(fixture.recoveryFile, 'utf8')).commands,
    []
  )
  assert.equal(fixture.stores.aliyun.has('transactions/active.json'), false)
  const preparedCheckpoint = fixture.journalSnapshots.find(
    ({ key, document }) =>
      key.startsWith('transactions/test/journal/') &&
      document.evidence.status === 'prepared'
  )
  assert.ok(preparedCheckpoint)
  assert.deepEqual(
    preparedCheckpoint.document.recovery.commands.map(({ phase }) => phase),
    [
      'restore',
      'restore',
      'purge',
      'purge',
      'readback',
      'readback',
      'cdn-readback',
      'cdn-readback',
      'cleanup-temporary',
      'cleanup-temporary',
      'clear-active',
    ]
  )
  assert.ok(
    fixture.journalSnapshots.some(
      ({ key, document }) =>
        key.startsWith('transactions/test/journal/') &&
        document.evidence.status === 'committed'
    )
  )
  const terminalCheckpoint = fixture.journalSnapshots.find(
    ({ key, document }) =>
      key.startsWith('transactions/test/journal/') &&
      document.evidence.status === 'committed'
  )
  assert.ok(terminalCheckpoint)
  assert.equal(terminalCheckpoint.document.evidence.activeJournalCleared, false)
  assert.deepEqual(
    terminalCheckpoint.document.recovery.commands.map(({ phase }) => phase),
    [
      'finalize-origin',
      'finalize-origin',
      'finalize-cdn',
      'finalize-cdn',
      'cleanup-temporary',
      'cleanup-temporary',
      'clear-active',
    ]
  )
  for (const temporaryKey of [
    'staging/a',
    'staging/b',
    'recovery/a',
    'recovery/b',
  ]) {
    const provider = temporaryKey.endsWith('/a') ? 'aliyun' : 'r2'
    assert.equal(fixture.stores[provider].has(temporaryKey), false)
  }
  const removalOrder = fixture.calls.remove.map(({ key }) => key)
  const activeRemoval = removalOrder.indexOf('transactions/active.json')
  assert.ok(activeRemoval > 0)
  for (const temporaryKey of [
    'staging/a',
    'staging/b',
    'recovery/a',
    'recovery/b',
  ]) {
    assert.ok(removalOrder.indexOf(temporaryKey) < activeRemoval)
  }
})

test('publication transaction rolls every provider back when a live write fails', async (t) => {
  const fixture = transactionFixture(t, { failLiveKey: 'live/b' })
  await assert.rejects(
    () =>
      executePublicationTransaction(fixture.plan, {
        adapters: fixture.adapters,
        workspace: path.join(fixture.root, 'work'),
        evidenceFile: fixture.evidenceFile,
        recoveryFile: fixture.recoveryFile,
      }),
    (error) => {
      assert.ok(error instanceof PublicationTransactionError)
      assert.equal(error.evidence.status, 'rolled-back')
      return true
    }
  )
  assert.equal(fixture.stores.aliyun.get('live/a').toString(), 'old-a')
  assert.equal(fixture.stores.r2.get('live/b').toString(), 'old-b')
  assert.deepEqual(
    fixture.metadataStores.aliyun.get('live/a'),
    transactionMetadata('old-cache-a', 'old/type-a', { acl: 'private' })
  )
  assert.deepEqual(
    fixture.metadataStores.r2.get('live/b'),
    transactionMetadata('old-cache-b', 'old/type-b', {
      customMetadata: { source: 'legacy' },
    })
  )
  assert.equal(
    JSON.parse(fs.readFileSync(fixture.evidenceFile, 'utf8')).status,
    'rolled-back'
  )
  assert.equal(fixture.stores.aliyun.has('transactions/active.json'), false)
  const terminalCheckpoint = fixture.journalSnapshots.find(
    ({ key, document }) =>
      key.startsWith('transactions/test/journal/') &&
      document.evidence.status === 'rolled-back'
  )
  assert.ok(terminalCheckpoint)
  assert.deepEqual(
    terminalCheckpoint.document.recovery.commands.map(({ phase }) => phase),
    [
      'finalize-origin',
      'finalize-origin',
      'finalize-cdn',
      'finalize-cdn',
      'cleanup-temporary',
      'cleanup-temporary',
      'clear-active',
    ]
  )
  const removalOrder = fixture.calls.remove.map(({ key }) => key)
  const activeRemoval = removalOrder.indexOf('transactions/active.json')
  assert.ok(activeRemoval > 0)
  for (const temporaryKey of [
    'staging/a',
    'staging/b',
    'recovery/a',
    'recovery/b',
  ]) {
    assert.ok(removalOrder.indexOf(temporaryKey) < activeRemoval)
  }
})

test('next run safely finalizes committed and rolled-back terminal journals', async (t) => {
  for (const terminalStatus of ['committed', 'rolled-back']) {
    const fixture = transactionFixture(t, {
      failLiveKey: terminalStatus === 'rolled-back' ? 'live/b' : null,
    })
    if (terminalStatus === 'committed') {
      await executePublicationTransaction(fixture.plan, {
        adapters: fixture.adapters,
        workspace: path.join(fixture.root, 'first-work'),
        evidenceFile: path.join(fixture.root, 'first-evidence.json'),
        recoveryFile: path.join(fixture.root, 'first-recovery.json'),
      })
    } else {
      await assert.rejects(() =>
        executePublicationTransaction(fixture.plan, {
          adapters: fixture.adapters,
          workspace: path.join(fixture.root, 'first-work'),
          evidenceFile: path.join(fixture.root, 'first-evidence.json'),
          recoveryFile: path.join(fixture.root, 'first-recovery.json'),
        })
      )
      fixture.faults.failLiveKey = null
    }
    const terminalCheckpoint = fixture.journalSnapshots.find(
      ({ key, document }) =>
        key.startsWith('transactions/test/journal/') &&
        document.evidence.status === terminalStatus
    )
    assert.ok(terminalCheckpoint, terminalStatus)
    seedActiveJournal(fixture, terminalCheckpoint.document)
    seedTerminalTemporaryObjects(fixture, terminalCheckpoint.document)
    fixture.plan.transactionId = `retry-${terminalStatus}`
    fixture.plan.journal.immutableRoot = `transactions/retry-${terminalStatus}/journal`
    const removeCallsBeforeDryRun = fixture.calls.remove.length
    await assert.rejects(
      () =>
        executePublicationTransaction(fixture.plan, {
          adapters: fixture.adapters,
          workspace: path.join(
            fixture.root,
            `retry-${terminalStatus}-dry-work`
          ),
          evidenceFile: path.join(
            fixture.root,
            `retry-${terminalStatus}-dry-evidence.json`
          ),
          recoveryFile: path.join(
            fixture.root,
            `retry-${terminalStatus}-dry-recovery.json`
          ),
          dryRun: true,
        }),
      /requires a non-dry-run finalization/
    )
    assert.equal(fixture.calls.remove.length, removeCallsBeforeDryRun)
    assert.equal(fixture.stores.aliyun.has('transactions/active.json'), true)

    const removeCallsBeforeFinalize = fixture.calls.remove.length
    const evidence = await executePublicationTransaction(fixture.plan, {
      adapters: fixture.adapters,
      workspace: path.join(fixture.root, `retry-${terminalStatus}-work`),
      evidenceFile: path.join(fixture.root, `retry-${terminalStatus}-evidence.json`),
      recoveryFile: path.join(fixture.root, `retry-${terminalStatus}-recovery.json`),
    })

    assert.equal(evidence.status, 'committed')
    assert.equal(
      evidence.recoveredTerminalJournal.status,
      terminalStatus
    )
    assert.equal(fixture.stores.aliyun.has('transactions/active.json'), false)
    const finalizeRemovalOrder = fixture.calls.remove
      .slice(removeCallsBeforeFinalize)
      .map(({ key }) => key)
    const firstActiveRemoval = finalizeRemovalOrder.indexOf(
      'transactions/active.json'
    )
    assert.ok(firstActiveRemoval > 0)
    for (const temporaryKey of [
      'staging/a',
      'staging/b',
      'recovery/a',
      'recovery/b',
    ]) {
      assert.ok(finalizeRemovalOrder.indexOf(temporaryKey) < firstActiveRemoval)
    }
  }
})

test('publication transaction fails closed with executable recovery evidence when rollback is incomplete', async (t) => {
  const fixture = transactionFixture(t, {
    failLiveKey: 'live/b',
    failRollbackKey: 'live/a',
  })
  await assert.rejects(
    () =>
      executePublicationTransaction(fixture.plan, {
        adapters: fixture.adapters,
        workspace: path.join(fixture.root, 'work'),
        evidenceFile: fixture.evidenceFile,
        recoveryFile: fixture.recoveryFile,
      }),
    (error) => {
      assert.ok(error instanceof PublicationTransactionError)
      assert.equal(error.evidence.status, 'manual-recovery')
      assert.ok(error.evidence.rollbackErrors.length > 0)
      return true
    }
  )
  const recovery = JSON.parse(fs.readFileSync(fixture.recoveryFile, 'utf8'))
  assert.equal(recovery.status, 'manual-recovery')
  assert.deepEqual(
    recovery.commands.map(({ phase }) => phase),
    [
      'restore',
      'restore',
      'purge',
      'purge',
      'readback',
      'readback',
      'cdn-readback',
      'cdn-readback',
      'cleanup-temporary',
      'cleanup-temporary',
      'clear-active',
    ]
  )
  assert.ok(recovery.commands.every(({ command }) => command.length > 0))
  assert.equal(recovery.prestate.length, 2)
  assert.ok(
    recovery.prestate.every(
      ({ prestateFile, expectedSha256, expectedMetadata }) =>
        /^[^/]+\/prestate\/[^/]+$/.test(prestateFile) &&
        !path.isAbsolute(prestateFile) &&
        /^[0-9a-f]{64}$/.test(expectedSha256) &&
        expectedMetadata.cacheControl &&
        expectedMetadata.contentType &&
        expectedMetadata.acl
    )
  )
  assert.equal(fixture.stores.aliyun.has('recovery/a'), true)
  assert.equal(fixture.stores.r2.has('recovery/b'), true)
  assert.equal(fixture.stores.aliyun.has('staging/a'), false)
  assert.equal(fixture.stores.r2.has('staging/b'), false)
  assert.equal(fixture.stores.aliyun.has('transactions/active.json'), true)
})

test('publication transaction never touches live keys when immutable preflight conflicts', async (t) => {
  const fixture = transactionFixture(t, { immutableConflict: true })
  await assert.rejects(
    () =>
      executePublicationTransaction(fixture.plan, {
        adapters: fixture.adapters,
        workspace: path.join(fixture.root, 'work'),
        evidenceFile: fixture.evidenceFile,
        recoveryFile: fixture.recoveryFile,
      }),
    (error) => {
      assert.ok(error instanceof PublicationTransactionError)
      assert.equal(error.evidence.status, 'preflight-failed')
      return true
    }
  )
  assert.equal(fixture.stores.aliyun.get('live/a').toString(), 'old-a')
  assert.equal(fixture.stores.r2.get('live/b').toString(), 'old-b')
  assert.equal(
    fixture.calls.upload.some(({ key }) => ['live/a', 'live/b'].includes(key)),
    false
  )
})

test('publication transaction rejects an incomplete active remote journal before mutation', async (t) => {
  const fixture = transactionFixture(t, { activeJournal: true })
  await assert.rejects(
    () =>
      executePublicationTransaction(fixture.plan, {
        adapters: fixture.adapters,
        workspace: path.join(fixture.root, 'work'),
        evidenceFile: fixture.evidenceFile,
        recoveryFile: fixture.recoveryFile,
      }),
    (error) => {
      assert.ok(error instanceof PublicationTransactionError)
      assert.equal(error.evidence.status, 'preflight-failed')
      assert.match(error.message, /Incomplete remote transaction journal/)
      return true
    }
  )
  assert.equal(fixture.calls.upload.length, 0)
  assert.equal(fixture.calls.remove.length, 0)
  assert.equal(fixture.calls.purge.length, 0)
})

test('publication transaction dry-run performs a remote read-only preflight', async (t) => {
  const fixture = transactionFixture(t)
  const evidence = await executePublicationTransaction(fixture.plan, {
    adapters: fixture.adapters,
    workspace: path.join(fixture.root, 'work'),
    evidenceFile: fixture.evidenceFile,
    recoveryFile: fixture.recoveryFile,
    dryRun: true,
  })

  assert.equal(evidence.status, 'dry-run-remote-preflight')
  assert.equal(fixture.calls.upload.length, 0)
  assert.equal(fixture.calls.remove.length, 0)
  assert.equal(fixture.calls.purge.length, 0)
  assert.ok(fixture.calls.download.length >= 4)
  assert.equal(fixture.calls.downloadPublic.length, 2)
  assert.equal(fixture.stores.aliyun.get('live/a').toString(), 'old-a')
  assert.equal(fixture.stores.r2.get('live/b').toString(), 'old-b')
})

test('publication transaction removes partial staging and recovery objects after preflight failure', async (t) => {
  const fixture = transactionFixture(t, { failStagingKey: 'staging/b' })
  await assert.rejects(
    () =>
      executePublicationTransaction(fixture.plan, {
        adapters: fixture.adapters,
        workspace: path.join(fixture.root, 'work'),
        evidenceFile: fixture.evidenceFile,
        recoveryFile: fixture.recoveryFile,
      }),
    (error) => {
      assert.ok(error instanceof PublicationTransactionError)
      assert.equal(error.evidence.status, 'preflight-failed')
      return true
    }
  )
  for (const temporaryKey of [
    'staging/a',
    'staging/b',
    'recovery/a',
    'recovery/b',
  ]) {
    assert.equal(
      fixture.stores.aliyun.has(temporaryKey) ||
        fixture.stores.r2.has(temporaryKey),
      false,
      temporaryKey
    )
  }
  assert.equal(fixture.stores.aliyun.get('live/a').toString(), 'old-a')
  assert.equal(fixture.stores.r2.get('live/b').toString(), 'old-b')
})

test('publication transaction polls stale CDN bytes until bounded convergence', async (t) => {
  const fixture = transactionFixture(t, { stalePublicReads: 2 })
  const evidence = await executePublicationTransaction(fixture.plan, {
    adapters: fixture.adapters,
    workspace: path.join(fixture.root, 'work'),
    evidenceFile: fixture.evidenceFile,
    recoveryFile: fixture.recoveryFile,
  })

  assert.equal(evidence.status, 'committed')
  assert.equal(fixture.calls.downloadPublic.length, 6)
  assert.equal(fixture.calls.waitForPublicReadback, 4)
})

test('executable recovery CDN poll converges or fails at its exact deadline', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'biyan-recovery-cdn-'))
  t.after(() => fs.rmSync(root, { force: true, recursive: true }))
  const counter = path.join(root, 'counter')
  const good = path.join(root, 'good')
  fs.writeFileSync(good, 'expected-public-bytes')
  const expected = sha256(good)
  const publicUrl = 'https://static.mitapp.cn/biyan/download/latest.json'
  const environment = {
    ...process.env,
    RECOVERY_COUNTER: 'counter',
    RECOVERY_GOOD_FILE: 'good',
  }
  const withFakeCurl = (command) => {
    assert.equal(
      command.split('\n').filter((line) => line.startsWith('if curl ')).length,
      1
    )
    assert.equal(command.match(/\bcurl\b/gu)?.length, 1)
    return `curl() {
  output=""
  while [ "$#" -gt 0 ]; do
    if [ "$1" = "--output" ]; then
      output="$2"
      shift 2
    else
      shift
    fi
  done
  count=0
  if [ -f "$RECOVERY_COUNTER" ]; then count="$(cat "$RECOVERY_COUNTER")"; fi
  count="$((count + 1))"
  printf '%s\\n' "$count" > "$RECOVERY_COUNTER"
  if [ "$count" -ge "$RECOVERY_GOOD_AFTER" ]; then
    cp "$RECOVERY_GOOD_FILE" "$output"
  else
    printf 'stale' > "$output"
  fi
}
${command}`
  }
  const productionCommand = buildBoundedPublicReadbackCommand(
    publicUrl,
    expected
  )
  assert.match(productionCommand, /\+ 600/)
  assert.match(productionCommand, /sleep 10/)
  assert.match(productionCommand, /Cache-Control: no-cache/)

  const converging = spawnSync(
    'bash',
    [
      '-c',
      withFakeCurl(
        buildBoundedPublicReadbackCommand(publicUrl, expected, {
          timeoutSeconds: 5,
          pollSeconds: 0.01,
        })
      ),
    ],
    {
      cwd: root,
      encoding: 'utf8',
      env: { ...environment, RECOVERY_GOOD_AFTER: '3' },
    }
  )
  assert.equal(converging.status, 0, converging.stderr)
  assert.ok(Number(fs.readFileSync(counter, 'utf8')) >= 3)

  fs.rmSync(counter, { force: true })
  const timedOut = spawnSync(
    'bash',
    [
      '-c',
      withFakeCurl(
        buildBoundedPublicReadbackCommand(publicUrl, expected, {
          timeoutSeconds: 1,
          pollSeconds: 0.05,
        })
      ),
    ],
    {
      cwd: root,
      encoding: 'utf8',
      env: { ...environment, RECOVERY_GOOD_AFTER: '999999' },
    }
  )
  assert.notEqual(timedOut.status, 0)
  assert.match(timedOut.stderr, /CDN did not converge/)
})

test('publication transaction fails closed when CDN convergence exceeds its deadline', async (t) => {
  const fixture = transactionFixture(t, {
    stalePublicReads: 100,
    publicReadbackTimeoutMs: 10,
    publicReadbackClockStepMs: 6,
  })
  await assert.rejects(
    () =>
      executePublicationTransaction(fixture.plan, {
        adapters: fixture.adapters,
        workspace: path.join(fixture.root, 'work'),
        evidenceFile: fixture.evidenceFile,
        recoveryFile: fixture.recoveryFile,
      }),
    (error) => {
      assert.ok(error instanceof PublicationTransactionError)
      assert.equal(error.evidence.status, 'rolled-back')
      assert.match(error.message, /Strict public readback failed/)
      return true
    }
  )
  assert.equal(fixture.calls.downloadPublic.length, 4)
  assert.equal(fixture.calls.waitForPublicReadback, 2)
  assert.equal(fixture.stores.aliyun.get('live/a').toString(), 'old-a')
  assert.equal(fixture.stores.r2.get('live/b').toString(), 'old-b')
})

test('publication transaction fails closed when temporary object deletion cannot be verified', async (t) => {
  const fixture = transactionFixture(t, { failRemoveKey: 'staging/a' })
  await assert.rejects(
    () =>
      executePublicationTransaction(fixture.plan, {
        adapters: fixture.adapters,
        workspace: path.join(fixture.root, 'work'),
        evidenceFile: fixture.evidenceFile,
        recoveryFile: fixture.recoveryFile,
      }),
    (error) => {
      assert.ok(error instanceof PublicationTransactionError)
      assert.equal(error.evidence.status, 'cleanup-failed')
      assert.match(error.evidence.cleanupErrors.join('\n'), /staging\/a/)
      return true
    }
  )
  assert.equal(fixture.stores.aliyun.has('staging/a'), true)
  assert.equal(fixture.stores.aliyun.has('transactions/active.json'), true)
  const cleanupCheckpoint = JSON.parse(
    fixture.stores.aliyun.get('transactions/active.json').toString()
  )
  assert.equal(cleanupCheckpoint.evidence.status, 'cleanup-failed')
  assert.equal(cleanupCheckpoint.evidence.terminalState, 'committed')
  assert.deepEqual(
    cleanupCheckpoint.recovery.commands.slice(-3).map(({ phase }) => phase),
    ['cleanup-temporary', 'cleanup-temporary', 'clear-active']
  )

  fixture.faults.failRemoveKey = null
  fixture.plan.transactionId = 'cleanup-retry'
  fixture.plan.journal.immutableRoot = 'transactions/cleanup-retry/journal'
  const retry = await executePublicationTransaction(fixture.plan, {
    adapters: fixture.adapters,
    workspace: path.join(fixture.root, 'retry-work'),
    evidenceFile: path.join(fixture.root, 'retry-evidence.json'),
    recoveryFile: path.join(fixture.root, 'retry-recovery.json'),
  })
  assert.equal(retry.recoveredTerminalJournal.status, 'cleanup-failed')
  assert.equal(retry.recoveredTerminalJournal.terminalState, 'committed')
  assert.equal(fixture.stores.aliyun.has('staging/a'), false)
  assert.equal(fixture.stores.aliyun.has('transactions/active.json'), false)
})

test('active clear failure keeps a recoverable terminal journal after cleanup', async (t) => {
  const fixture = transactionFixture(t, { failClearActiveOnce: true })
  await assert.rejects(
    () =>
      executePublicationTransaction(fixture.plan, {
        adapters: fixture.adapters,
        workspace: path.join(fixture.root, 'work'),
        evidenceFile: fixture.evidenceFile,
        recoveryFile: fixture.recoveryFile,
      }),
    (error) => {
      assert.ok(error instanceof PublicationTransactionError)
      assert.equal(error.evidence.status, 'finalization-failed')
      assert.equal(error.evidence.terminalState, 'committed')
      return true
    }
  )
  for (const key of ['staging/a', 'staging/b', 'recovery/a', 'recovery/b']) {
    assert.equal(
      fixture.stores.aliyun.has(key) || fixture.stores.r2.has(key),
      false
    )
  }
  assert.equal(fixture.stores.aliyun.has('transactions/active.json'), true)
  const checkpoint = JSON.parse(
    fixture.stores.aliyun.get('transactions/active.json').toString()
  )
  assert.equal(checkpoint.evidence.status, 'finalization-failed')

  fixture.plan.transactionId = 'clear-retry'
  fixture.plan.journal.immutableRoot = 'transactions/clear-retry/journal'
  const retry = await executePublicationTransaction(fixture.plan, {
    adapters: fixture.adapters,
    workspace: path.join(fixture.root, 'retry-work'),
    evidenceFile: path.join(fixture.root, 'retry-evidence.json'),
    recoveryFile: path.join(fixture.root, 'retry-recovery.json'),
  })
  assert.equal(retry.recoveredTerminalJournal.status, 'finalization-failed')
  assert.equal(fixture.stores.aliyun.has('transactions/active.json'), false)
})

test('publication transaction persists a runner-loss recovery checkpoint after each live write', async (t) => {
  const fixture = transactionFixture(t, {
    failJournalAfterFirstLive: true,
  })
  await assert.rejects(
    () =>
      executePublicationTransaction(fixture.plan, {
        adapters: fixture.adapters,
        workspace: path.join(fixture.root, 'work'),
        evidenceFile: fixture.evidenceFile,
        recoveryFile: fixture.recoveryFile,
      }),
    (error) => {
      assert.ok(error instanceof PublicationTransactionError)
      assert.equal(error.evidence.status, 'rolled-back')
      return true
    }
  )
  const checkpoint = fixture.journalSnapshots.find(
    ({ key, document }) =>
      key.startsWith('transactions/test/journal/') &&
      document.evidence.status === 'committing' &&
      document.evidence.mutable?.[0]?.committed === true &&
      document.evidence.mutable?.[1]?.committed === false
  )
  assert.ok(checkpoint)
  assert.deepEqual(
    checkpoint.document.recovery.commands.map(({ phase }) => phase),
    [
      'restore',
      'restore',
      'purge',
      'purge',
      'readback',
      'readback',
      'cdn-readback',
      'cdn-readback',
      'cleanup-temporary',
      'cleanup-temporary',
      'clear-active',
    ]
  )
  assert.deepEqual(
    checkpoint.document.evidence.mutable.map(({ recoveryKey }) => recoveryKey),
    ['recovery/a', 'recovery/b']
  )
  assert.equal(fixture.stores.aliyun.get('live/a').toString(), 'old-a')
  assert.equal(fixture.stores.r2.get('live/b').toString(), 'old-b')
})

test('publication transaction rejects public URLs outside the canonical CDN origin', async (t) => {
  for (const [index, publicUrl] of [
    'http://static.mitapp.cn/biyan/download/latest.json',
    'https://evil.invalid/biyan/download/latest.json',
    'https://static.mitapp.cn:8443/biyan/download/latest.json',
    'https://STATIC.mitapp.cn/biyan/download/latest.json',
    'https://static.mitapp.cn/biyan/download/latest.json?preview=1',
    'https://static.mitapp.cn/biyan/download/latest.json#preview',
  ].entries()) {
    const fixture = transactionFixture(t)
    fixture.plan.transactionId = `invalid-origin-${index}`
    fixture.plan.mutable[0].publicUrl = publicUrl
    await assert.rejects(
      () =>
        executePublicationTransaction(fixture.plan, {
          adapters: fixture.adapters,
          workspace: path.join(fixture.root, `work-${index}`),
          evidenceFile: path.join(fixture.root, `evidence-${index}.json`),
          recoveryFile: path.join(fixture.root, `recovery-${index}.json`),
        }),
      (error) => {
        assert.ok(error instanceof PublicationTransactionError)
        assert.equal(error.evidence.status, 'preflight-failed')
        assert.match(error.message, /https:\/\/static\.mitapp\.cn/)
        return true
      }
    )
    assert.equal(fixture.calls.upload.length, 0)
  }
})

test('Aliyun OSS metadata parser preserves exact headers, ACL, storage class, and custom metadata', () => {
  const metadata = parseAliyunObjectMetadata(
    [
      'Object metadata:',
      JSON.stringify({
        Object: {
          ACL: 'private',
          StorageClass: 'Standard',
          Metadata: {
            'Cache-Control': 'public, max-age=60, must-revalidate',
            'Content-Type': 'application/json',
            'Content-Encoding': 'gzip',
            'Content-Disposition': 'inline',
            'Expires': 'Wed, 29 Jul 2026 08:00:00 GMT',
            'x-oss-meta-owner': 'biyan',
            'x-oss-meta-release': 'v0.6.643',
          },
        },
      }),
    ].join('\n'),
    { id: 'manifest', key: 'biyan/download/latest.json' }
  )

  assert.deepEqual(
    metadata,
    transactionMetadata(
      'public, max-age=60, must-revalidate',
      'application/json',
      {
        contentEncoding: 'gzip',
        contentDisposition: 'inline',
        expires: 'Wed, 29 Jul 2026 08:00:00 GMT',
        acl: 'private',
        customMetadata: {
          owner: 'biyan',
          release: 'v0.6.643',
        },
      }
    )
  )
  assert.throws(
    () =>
      parseAliyunObjectMetadata('not-json', {
        id: 'manifest',
        key: 'biyan/download/latest.json',
      }),
    /not JSON/
  )
})

test('Aliyun adapter uses only pinned ossutil command shapes for object operations', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'biyan-ossutil-contract-'))
  t.after(() => fs.rmSync(root, { force: true, recursive: true }))
  const source = path.join(root, 'source')
  const destination = path.join(root, 'destination')
  fs.writeFileSync(source, 'payload')
  const calls = []
  const expectedMetadata = transactionMetadata(
    'public, max-age=60, must-revalidate',
    'application/json',
    {
      acl: 'private',
      customMetadata: { owner: 'biyan' },
    }
  )
  const runCommand = (command, args, label, options = {}) => {
    calls.push({ command, args, label, options })
    if (
      command === 'ossutil' &&
      args[0] === 'cp' &&
      args[1].startsWith('oss://')
    ) {
      fs.writeFileSync(args[2], 'payload')
    }
    return {
      found: true,
      output: JSON.stringify({
        ACL: 'private',
        StorageClass: 'Standard',
        Metadata: {
          'Cache-Control': expectedMetadata.cacheControl,
          'Content-Type': expectedMetadata.contentType,
          'x-oss-meta-owner': 'biyan',
        },
      }),
    }
  }
  const adapter = createAliyunAdapter(
    {
      bucket: 'mita-static',
      endpoint: 'https://oss-cn-hangzhou.aliyuncs.com',
    },
    {
      runCommand,
      publicReadbackAttempts: 1,
      publicReadbackDelayMs: 0,
      publicReadbackTimeoutMs: 1,
    }
  )
  const entry = {
    id: 'manifest',
    key: 'biyan/download/latest.json',
    publicUrl: 'https://static.mitapp.cn/biyan/download/latest.json',
    ...expectedMetadata,
  }

  assert.equal(await adapter.download(entry, destination), true)
  await adapter.upload(entry, source, expectedMetadata)
  assert.deepEqual(await adapter.readMetadata(entry), expectedMetadata)
  await adapter.remove(entry)
  await adapter.purge([entry])

  const objectCalls = calls.filter(({ label }) =>
    /^(download|upload|read metadata|remove) /.test(label)
  )
  assert.equal(objectCalls.length, 4)
  assert.ok(
    objectCalls.every(
      ({ command }) => command === 'ossutil'
    )
  )
  assert.ok(
    calls.every(
      ({ command, args }) =>
        command !== 'aliyun' || !args.some((arg) => arg === 'oss')
    )
  )
  const upload = calls.find(({ label }) => label.startsWith('upload '))
  assert.ok(upload.args.includes('--acl'))
  assert.ok(upload.args.includes('private'))
  assert.ok(upload.args.includes('--metadata'))
  assert.ok(upload.args.includes('owner=biyan'))
  for (const transfer of calls.filter(
    ({ label }) =>
      label.startsWith('download ') || label.startsWith('upload ')
  )) {
    assert.equal(transfer.options.timeoutMs, 900_000)
  }
  for (const probe of calls.filter(
    ({ label }) =>
      label.startsWith('read metadata ') || label.startsWith('remove ')
  )) {
    assert.equal(probe.options.timeoutMs, 120_000)
  }
  assert.deepEqual(
    calls
      .find(({ label }) => label === 'purge Aliyun CDN objects')
      .args.slice(0, 4),
    ['--profile', 'release', 'cdn', 'RefreshObjectCaches']
  )
  assert.throws(
    () =>
      createAliyunAdapter({
        bucket: 'mita-static',
        endpoint: 'https://evil.invalid',
      }),
    /requires mita-static at https:\/\/oss-cn-hangzhou\.aliyuncs\.com/
  )
  assert.throws(
    () =>
      createAliyunAdapter({
        bucket: 'attacker-bucket',
        endpoint: 'https://oss-cn-hangzhou.aliyuncs.com',
      }),
    /requires mita-static/
  )
})

test('collectReleaseAssets fails when a required asset is missing', () => {
  const release = sampleRelease()
  release.assets = release.assets.filter(
    (asset) => !asset.name.endsWith('.msi')
  )

  assert.throws(
    () => collectReleaseAssets(release),
    /Expected exactly one Windows MSI asset/
  )
})

test('collectReleaseAssets rejects ambiguous or noncanonical package names', () => {
  const wrongName = sampleRelease()
  wrongName.assets.find((asset) => asset.name.endsWith('.dmg')).name =
    'Biyan-1.2.3.dmg'
  assert.throws(
    () => collectReleaseAssets(wrongName),
    /Biyan_1\.2\.3_universal\.dmg/
  )

  const duplicate = sampleRelease()
  duplicate.assets.push({
    name: 'Biyan_1.2.3_arm64.dmg',
    url: 'https://example.invalid/Biyan_1.2.3_arm64.dmg',
    size: 1,
  })
  assert.throws(() => collectReleaseAssets(duplicate), /found 2/)
})

test('collectReleaseAssets rejects draft, prerelease, and mismatched release identity', () => {
  for (const [mutate, pattern] of [
    [(release) => (release.isDraft = true), /non-draft/],
    [(release) => (release.isPrerelease = true), /must not be a prerelease/],
    [
      (release) => (release.name = 'Mita v1.2.3'),
      /Release name must be exactly/,
    ],
    [(release) => (release.tagName = 'nightly'), /stable vMAJOR\.MINOR\.PATCH/],
    [(release) => (release.publishedAt = null), /publishedAt/],
    [
      (release) =>
        (release.url = 'https://github.com/example/fork/releases/tag/v1.2.3'),
      /canonical repository and tag/,
    ],
    [
      (release) =>
        (release.assets[0].url =
          'https://example.invalid/Biyan_1.2.3_universal.dmg'),
      /canonical GitHub release URL/,
    ],
  ]) {
    const release = sampleRelease()
    mutate(release)
    assert.throws(() => collectReleaseAssets(release), pattern)
  }
})

test('collectReleaseAssets validates the complete candidate provenance before distribution', () => {
  const fixture = candidateFixture()
  const manifest = collectReleaseAssets(fixture.release, fixture.options)

  assert.equal(manifest.provenance.schema, 1)
  assert.equal(manifest.provenance.sourceCommit, sourceCommit)
  assert.equal(manifest.provenance.migrationPhase, 'A')
  assert.equal(manifest.provenance.dataSchema, 1)
  assert.match(manifest.provenance.candidateManifestSha256, /^[0-9a-f]{64}$/)
  assert.equal(manifest.version, '0.6.643')
})

test('collectReleaseAssets requires the exact 13-file GitHub Release asset set', () => {
  for (const [label, mutate] of [
    [
      'extra',
      (fixture) =>
        fixture.release.assets.push({
          name: 'Jan_legacy_payload.zip',
          url: `${fixture.release.url.replace('/tag/', '/download/')}/Jan_legacy_payload.zip`,
          size: 1,
          digest: `sha256:${'a'.repeat(64)}`,
        }),
    ],
    [
      'missing',
      (fixture) => {
        fixture.release.assets = fixture.release.assets.filter(
          ({ name }) => name !== 'candidate.json.sig'
        )
      },
    ],
    [
      'duplicate',
      (fixture) => {
        fixture.release.assets.push(
          structuredClone(
            fixture.release.assets.find(({ name }) => name === 'candidate.json')
          )
        )
      },
    ],
    [
      'retired name',
      (fixture) => {
        const asset = fixture.release.assets.find(
          ({ name }) => name === 'candidate.json.sig'
        )
        asset.name = 'Jan_candidate.json.sig'
        asset.url = asset.url.replace(
          '/candidate.json.sig',
          '/Jan_candidate.json.sig'
        )
      },
    ],
  ]) {
    const fixture = candidateFixture()
    mutate(fixture)
    assert.throws(
      () => collectReleaseAssets(fixture.release, fixture.options),
      /Release asset name set mismatch; expected exactly 13 reviewed files/,
      label
    )
  }
})

test('candidate provenance preserves the historical active A/B/C identities before terminal pinning', () => {
  for (const [version, migrationPhase, dataSchema] of [
    ['0.6.643', 'A', 1],
    ['0.6.644', 'B', 2],
    ['0.6.645', 'C', 3],
  ]) {
    const fixture = candidateFixture({ version, migrationPhase, dataSchema })
    const result = validateCandidateProvenance(
      fixture.candidateDir,
      provenanceOptions(fixture)
    )
    assert.equal(result.migrationPhase, migrationPhase)
    assert.equal(result.dataSchema, dataSchema)
  }

  const superseded = candidateFixture({ version: '0.6.640' })
  assert.throws(
    () =>
      validateCandidateProvenance(
        superseded.candidateDir,
        provenanceOptions(superseded)
      ),
    /not the declared active train closure-20260724 release/
  )
})

test('candidate provenance switches fail-closed to exact v0.6.649 terminal tag and source', () => {
  const fixture = candidateFixture({
    version: '0.6.649',
    migrationPhase: 'C',
    dataSchema: 3,
  })
  fixture.options.trainPolicy = releaseTrainPolicy(sourceCommit)
  const result = validateCandidateProvenance(
    fixture.candidateDir,
    provenanceOptions(fixture)
  )
  assert.equal(result.sourceCommit, sourceCommit)
  assert.equal(result.migrationPhase, 'C')
  assert.equal(result.dataSchema, 3)
  assert.equal(
    collectReleaseAssets(fixture.release, fixture.options).provenance
      .sourceCommit,
    sourceCommit
  )

  const wrongPin = candidateFixture({
    version: '0.6.649',
    migrationPhase: 'C',
    dataSchema: 3,
  })
  wrongPin.options.trainPolicy = releaseTrainPolicy('f'.repeat(40))
  assert.throws(
    () =>
      validateCandidateProvenance(
        wrongPin.candidateDir,
        provenanceOptions(wrongPin)
      ),
    /does not match the active terminal release/
  )

  const oldC = candidateFixture({
    version: '0.6.645',
    migrationPhase: 'C',
    dataSchema: 3,
  })
  oldC.options.trainPolicy = releaseTrainPolicy(sourceCommit)
  assert.throws(
    () =>
      validateCandidateProvenance(
        oldC.candidateDir,
        provenanceOptions(oldC)
      ),
    /not the declared active terminal release/
  )
})

test('collectReleaseAssets rejects missing or mismatched GitHub asset digests', () => {
  const missing = candidateFixture()
  delete missing.release.assets.find(
    (asset) => asset.name === 'Biyan_0.6.643_universal.dmg'
  ).digest
  assert.throws(
    () => collectReleaseAssets(missing.release, missing.options),
    /missing a GitHub SHA-256 digest/
  )

  const mismatched = candidateFixture()
  const dmg = path.join(mismatched.candidateDir, 'Biyan_0.6.643_universal.dmg')
  fs.writeFileSync(dmg, 'bad-dmg')
  assert.throws(
    () => collectReleaseAssets(mismatched.release, mismatched.options),
    /Downloaded asset digest mismatch/
  )
})

test('candidate provenance rejects source, phase/schema, version, and timestamp drift', () => {
  const mutations = [
    {
      label: 'source commit',
      mutate: ({ options }) => {
        options.expectedSourceCommit =
          '1123456789abcdef0123456789abcdef01234567'
      },
      pattern: /source commit/,
    },
    {
      label: 'phase/schema',
      mutate: ({ options }) => {
        options.releaseMetadata = {
          schema: 1,
          migrationPhase: 'B',
          dataSchema: 2,
        }
      },
      pattern: /Tagged release identity is invalid/,
    },
    {
      label: 'Tauri version',
      mutate: ({ options }) => {
        options.tauriConfig = {
          ...options.tauriConfig,
          version: '0.6.644',
        }
      },
      pattern: /Tagged Tauri version/,
    },
    {
      label: 'Cargo.lock version',
      mutate: ({ options }) => {
        options.cargoLock = '[[package]]\nname = "Biyan"\nversion = "0.6.644"\n'
      },
      pattern:
        /Cargo\.lock version 0\.6\.644 does not match product version 0\.6\.643/,
    },
    {
      label: 'publication timestamp',
      mutate: ({ release }) => {
        release.publishedAt = '2026-05-15T06:00:00Z'
      },
      pattern: /timestamps are invalid or out of order/,
    },
  ]

  for (const { label, mutate, pattern } of mutations) {
    const fixture = candidateFixture()
    mutate(fixture)
    assert.throws(
      () =>
        validateCandidateProvenance(
          fixture.candidateDir,
          provenanceOptions(fixture)
        ),
      pattern,
      label
    )
  }
})

test('candidate provenance rejects corrupt assets, signatures, manifests, and checksum sets', () => {
  const mutations = [
    {
      label: 'asset',
      mutate: (dir) =>
        fs.appendFileSync(
          path.join(dir, 'Biyan_0.6.643_x64-setup.exe'),
          'corrupt'
        ),
      pattern: /Candidate asset hash mismatch/,
    },
    {
      label: 'DMG distribution asset',
      mutate: (dir) =>
        fs.appendFileSync(
          path.join(dir, 'Biyan_0.6.643_universal.dmg'),
          'corrupt'
        ),
      pattern: /Candidate distribution asset hash mismatch/,
    },
    {
      label: 'MSI distribution asset',
      mutate: (dir) =>
        fs.appendFileSync(
          path.join(dir, 'Biyan_0.6.643_x64_en-US.msi'),
          'corrupt'
        ),
      pattern: /Candidate distribution asset hash mismatch/,
    },
    {
      label: 'DEB distribution asset',
      mutate: (dir) =>
        fs.appendFileSync(path.join(dir, 'Biyan_0.6.643_amd64.deb'), 'corrupt'),
      pattern: /Candidate distribution asset hash mismatch/,
    },
    {
      label: 'unsigned candidate metadata replacement',
      mutate: (dir) => fs.appendFileSync(path.join(dir, 'candidate.json'), ' '),
      pattern: /candidate\.json provenance updater signature does not verify/,
    },
    {
      label: 'empty signature',
      mutate: (dir) =>
        fs.writeFileSync(
          path.join(dir, 'Biyan_0.6.643_amd64.AppImage.sig'),
          ''
        ),
      pattern: /Updater signature is empty/,
    },
    {
      label: 'manifest',
      mutate: (dir) => fs.appendFileSync(path.join(dir, 'latest.json'), ' '),
      pattern: /Candidate manifest hash mismatch/,
    },
    {
      label: 'checksum mismatch',
      mutate: (dir) => {
        const file = path.join(dir, 'SHA256SUMS')
        fs.writeFileSync(
          file,
          fs.readFileSync(file, 'utf8').replace(/^[0-9a-f]{64}/, '0'.repeat(64))
        )
      },
      pattern: /SHA256SUMS mismatch/,
    },
    {
      label: 'checksum extra',
      mutate: (dir) =>
        fs.appendFileSync(
          path.join(dir, 'SHA256SUMS'),
          `${'0'.repeat(64)}  unexpected.bin\n`
        ),
      pattern: /SHA256SUMS file set mismatch/,
    },
  ]

  for (const { label, mutate, pattern } of mutations) {
    const fixture = candidateFixture()
    mutate(fixture.candidateDir)
    assert.throws(
      () =>
        validateCandidateProvenance(
          fixture.candidateDir,
          provenanceOptions(fixture)
        ),
      pattern,
      label
    )
  }
})

test('candidate provenance cryptographically verifies tagged updater signatures', () => {
  const wrongKey = candidateFixture()
  wrongKey.options.tauriConfig.plugins.updater.pubkey = signingFixture().pubkey
  assert.throws(
    () =>
      validateCandidateProvenance(
        wrongKey.candidateDir,
        provenanceOptions(wrongKey)
      ),
    /updater signature uses the wrong key/
  )

  const tampered = candidateFixture()
  fs.appendFileSync(
    path.join(tampered.candidateDir, 'Biyan_0.6.643_x64-setup.exe'),
    'tampered-after-signing'
  )
  refreshCandidateMetadata(tampered.candidateDir, tampered.signing)
  assert.throws(
    () =>
      validateCandidateProvenance(
        tampered.candidateDir,
        provenanceOptions(tampered)
      ),
    /updater signature does not verify/
  )

  const forged = candidateFixture()
  const signaturePath = path.join(
    forged.candidateDir,
    'Biyan_0.6.643_amd64.AppImage.sig'
  )
  const signatureLines = Buffer.from(
    fs.readFileSync(signaturePath, 'utf8').trim(),
    'base64'
  )
    .toString('utf8')
    .trimEnd()
    .split('\n')
  const signaturePayload = Buffer.from(signatureLines[1], 'base64')
  signaturePayload[10] ^= 0x01
  signatureLines[1] = signaturePayload.toString('base64')
  const forgedSignature = Buffer.from(
    `${signatureLines.join('\n')}\n`,
    'utf8'
  ).toString('base64')
  fs.writeFileSync(signaturePath, forgedSignature)
  const manifestPath = path.join(forged.candidateDir, 'latest.json')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  manifest.platforms['linux-x86_64'].signature = forgedSignature
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  refreshCandidateMetadata(forged.candidateDir, forged.signing)
  assert.throws(
    () =>
      validateCandidateProvenance(
        forged.candidateDir,
        provenanceOptions(forged)
      ),
    /updater signature does not verify/
  )
})

test('buildReleaseNotes groups commits into release sections', () => {
  const notes = buildReleaseNotes({
    tagName: 'v1.2.3',
    previousTag: 'v1.2.2',
    repoUrl: 'https://github.com/realerikk0/Mita',
    commitSubjects: [
      'feat: add visible desktop updater',
      'fix(updater): repair CDN manifest parsing',
      'perf: improve release asset validation',
      'ci: update release distribution workflow',
    ],
  })

  assert.match(notes, /## 新增功能\n\n- add visible desktop updater/)
  assert.match(notes, /## 问题修复\n\n- repair CDN manifest parsing/)
  assert.match(notes, /## 优化调整\n\n- improve release asset validation/)
  assert.match(notes, /## 维护更新\n\n- update release distribution workflow/)
  assert.match(
    notes,
    /https:\/\/github\.com\/realerikk0\/Mita\/compare\/v1\.2\.2\.\.\.v1\.2\.3/
  )
})

test('release notes fail closed on retired product prose except explicit compatibility items', () => {
  assert.throws(
    () =>
      buildReleaseNotes({
        tagName: 'v1.2.3',
        commitSubjects: ['fix: repair Jan data import'],
      }),
    /without a compat: prefix/
  )
  const notes = buildReleaseNotes({
    tagName: 'v1.2.3',
    previousTag: 'v1.2.2',
    repoUrl: 'https://github.com/realerikk0/Mita',
    commitSubjects: [
      'compat(migration): preserve Jan and Mita legacy data upgrades',
    ],
  })
  assert.match(notes, /- \[兼容\] preserve Jan and Mita legacy data upgrades/)
  assert.equal(validateReleaseNotesProductPolicy(notes), true)
  assert.throws(
    () =>
      validateReleaseNotesProductPolicy('## 修复\n\n- Improve Mita startup\n'),
    /outside an explicit - \[兼容\] item/
  )
})

test('buildFeishuCard includes fixed release and download fields', () => {
  const manifest = collectReleaseAssets(sampleRelease())
  const card = buildFeishuCard(
    manifest,
    {
      downloadPageUrl: 'https://static.mitapp.cn/biyan/download',
    },
    {
      runUrl: 'https://github.com/realerikk0/Mita/actions/runs/1',
    }
  )

  const body = JSON.stringify(card)
  assert.match(body, /Biyan v1\.2\.3 发布完成/)
  assert.match(body, /Biyan_1\.2\.3_universal\.dmg/)
  assert.match(body, /Biyan_1\.2\.3_x64-setup\.exe/)
  assert.match(body, /Biyan_1\.2\.3_x64_en-US\.msi/)
  assert.match(body, /https:\/\/static\.mitapp\.cn\/biyan\/download/)
  assert.match(body, /Added visible desktop updater/)
  assert.match(body, /Fixed updater CDN manifest parsing/)
  assert.match(body, /打开 GitHub Release/)
  assert.match(body, /打开 CDN 下载/)
})

test('buildDownloadManifest exposes GitHub fallback metadata without CDN options', () => {
  const manifest = buildDownloadManifest(
    collectReleaseAssets(sampleRelease()),
    { generatedAt: '2026-05-15T09:00:00.000Z' }
  )

  assert.equal(manifest.schemaVersion, 1)
  assert.equal(manifest.product, 'Biyan')
  assert.equal(manifest.tagName, 'v1.2.3')
  assert.equal(manifest.version, '1.2.3')
  assert.equal(manifest.generatedAt, '2026-05-15T09:00:00.000Z')
  assert.equal(manifest.primaryDownload.type, 'github-release')
  assert.equal(
    manifest.primaryDownload.url,
    'https://github.com/realerikk0/Mita/releases/tag/v1.2.3'
  )
  assert.equal(manifest.primaryDownload.password, null)
  assert.equal(manifest.github.macosDmg.name, 'Biyan_1.2.3_universal.dmg')
  assert.equal(manifest.github.windowsExe.name, 'Biyan_1.2.3_x64-setup.exe')
})

test('buildDownloadManifest exposes Aliyun CDN platform URLs', () => {
  const release = collectReleaseAssets(sampleRelease())
  release.provenance = verifiedProvenance
  const manifest = buildDownloadManifest(release, {
    generatedAt: '2026-05-15T09:00:00.000Z',
    cdnBaseUrl: 'https://static.mitapp.cn',
    downloadVersionRoot: 'biyan/download/releases/v1.2.3',
    downloadPageUrl: 'https://static.mitapp.cn/biyan/download',
  })

  assert.equal(manifest.schemaVersion, 2)
  assert.equal(
    manifest.downloadPageUrl,
    'https://static.mitapp.cn/biyan/download'
  )
  assert.equal(manifest.primaryDownload.type, 'aliyun-cdn')
  assert.equal(
    manifest.primaryDownload.url,
    'https://static.mitapp.cn/biyan/download'
  )
  assert.deepEqual(manifest.provenance, verifiedProvenance)
  assert.equal(
    manifest.platforms.macos.url,
    'https://static.mitapp.cn/biyan/download/releases/v1.2.3/Biyan_1.2.3_universal.dmg'
  )
  assert.equal(
    manifest.platforms.windows.url,
    'https://static.mitapp.cn/biyan/download/releases/v1.2.3/Biyan_1.2.3_x64-setup.exe'
  )
  assert.equal(
    manifest.platforms.windowsMsi.url,
    'https://static.mitapp.cn/biyan/download/releases/v1.2.3/Biyan_1.2.3_x64_en-US.msi'
  )
  assert.equal(
    manifest.platforms.linuxAppImage.url,
    'https://static.mitapp.cn/biyan/download/releases/v1.2.3/Biyan_1.2.3_amd64.AppImage'
  )
  assert.equal(
    manifest.platforms.linuxDeb.url,
    'https://static.mitapp.cn/biyan/download/releases/v1.2.3/Biyan_1.2.3_amd64.deb'
  )
  assert.equal(manifest.platforms.linuxDeb.digest, sampleDigest)
  assert.equal(manifest.github.macosDmg.digest, sampleDigest)
})

test('buildDownloadManifest rejects legacy roots, incomplete assets, and unverified provenance', () => {
  const release = collectReleaseAssets(sampleRelease())
  release.provenance = verifiedProvenance
  const options = {
    cdnBaseUrl: 'https://static.mitapp.cn',
    downloadVersionRoot: 'biyan/download/releases/v1.2.3',
    downloadPageUrl: 'https://static.mitapp.cn/biyan/download',
  }

  assert.throws(
    () =>
      buildDownloadManifest(release, {
        ...options,
        downloadVersionRoot: 'mita/download/releases/v1.2.3',
      }),
    /must be biyan\/download/
  )
  assert.throws(
    () =>
      buildDownloadManifest(release, {
        ...options,
        downloadPageUrl: 'https://static.mitapp.cn/mita/download',
      }),
    /canonical biyan\/download root/
  )
  assert.throws(
    () => buildDownloadManifest({ ...release, provenance: null }, options),
    /requires verified candidate provenance/
  )
  const incomplete = structuredClone(release)
  delete incomplete.assets.linuxDeb
  assert.throws(
    () => buildDownloadManifest(incomplete, options),
    /missing linuxDeb/
  )
  for (const cdnBaseUrl of [
    'http://static.mitapp.cn',
    'https://evil.invalid',
    'https://static.mitapp.cn/path',
    'https://static.mitapp.cn?preview=1',
    'https://static.mitapp.cn#preview',
    'https://static.mitapp.cn/',
  ]) {
    assert.throws(
      () =>
        buildDownloadManifest(release, {
          ...options,
          cdnBaseUrl,
        }),
      /must be exactly https:\/\/static\.mitapp\.cn/
    )
  }
})

test('buildDownloadPage redirects to GitHub fallback without extraction code', () => {
  const page = buildDownloadPage({
    primaryDownload: {
      type: 'github-release',
      url: 'https://github.com/realerikk0/Mita/releases/tag/v1.2.3',
      password: null,
    },
  })

  assert.match(page, /Open GitHub Release/)
  assert.match(
    page,
    /https:\/\/github\.com\/realerikk0\/Mita\/releases\/tag\/v1\.2\.3/
  )
  assert.doesNotMatch(page, /Extraction code/)
})

test('buildDownloadPage redirects platform users to Aliyun CDN assets', () => {
  const page = buildDownloadPage({
    platforms: {
      macos: {
        url: 'https://static.mitapp.cn/biyan/download/releases/v1.2.3/Biyan_1.2.3_universal.dmg',
      },
      windows: {
        url: 'https://static.mitapp.cn/biyan/download/releases/v1.2.3/Biyan_1.2.3_x64-setup.exe',
      },
      linuxAppImage: {
        url: 'https://static.mitapp.cn/biyan/download/releases/v1.2.3/Biyan_1.2.3_amd64.AppImage',
      },
      linuxDeb: {
        url: 'https://static.mitapp.cn/biyan/download/releases/v1.2.3/Biyan_1.2.3_amd64.deb',
      },
    },
  })

  assert.match(page, /Download for macOS/)
  assert.match(page, /Download for Windows/)
  assert.match(page, /Download AppImage/)
  assert.match(page, /Download DEB/)
  assert.match(page, /Macintosh\|Mac OS X/)
  assert.match(page, /Linux\|X11/)
  assert.match(
    page,
    /https:\/\/static\.mitapp\.cn\/biyan\/download\/releases\/v1\.2\.3\/Biyan_1\.2\.3_x64-setup\.exe/
  )
  assert.doesNotMatch(page, /http-equiv="refresh"/)
})

test('release-distribution workflow gates every external mutation on protected provenance', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8').replace(/\r\n?/g, '\n')
  const transactionScript = fs
    .readFileSync(transactionScriptPath, 'utf8')
    .replace(/\r\n?/g, '\n')
  const validationIndex = workflow.indexOf(
    '- name: Validate release identity, assets, checksums, signatures, and provenance'
  )
  const evidenceIndex = workflow.indexOf(
    '- name: Initialize distribution transaction evidence'
  )
  assert.ok(validationIndex > 0)
  assert.ok(evidenceIndex > 0 && evidenceIndex < validationIndex)
  const jobTimeoutMinutes = Number(
    /timeout-minutes:\s*(\d+)/.exec(workflow)?.[1]
  )
  const transferTimeoutMs = Number(
    /OSS_TRANSFER_TIMEOUT_MS = ([0-9_]+)/.exec(transactionScript)?.[1].replaceAll(
      '_',
      ''
    )
  )
  const publicReadbackTimeoutMs = Number(
    /publicReadbackTimeoutMs = ([0-9_]+)/.exec(
      transactionScript
    )?.[1].replaceAll('_', '')
  )
  const formalLargeTransferCount = 7
  const staticWorstCaseMinutes =
    Math.ceil(
      (formalLargeTransferCount * transferTimeoutMs +
        2 * publicReadbackTimeoutMs) /
        60_000
    ) + 30
  assert.ok(jobTimeoutMinutes >= 180)
  assert.ok(
    jobTimeoutMinutes >= staticWorstCaseMinutes,
    `${jobTimeoutMinutes}m must cover ${formalLargeTransferCount} bounded transfers, commit/rollback CDN convergence, and 30m control overhead (${staticWorstCaseMinutes}m)`
  )

  assert.match(
    workflow,
    /concurrency:\n\s+group: release-distribution-live-keys\n\s+cancel-in-progress: false/
  )
  assert.doesNotMatch(
    workflow,
    /group: release-distribution-live-keys.*\$\{\{/,
    'all runs that can touch shared live keys must use one constant lock'
  )
  assert.match(
    workflow,
    /ref: mita-main\n\s+fetch-depth: 0\n\s+persist-credentials: false/
  )
  assert.match(
    workflow,
    /git merge-base --is-ancestor "\$tag_commit" origin\/mita-main/
  )
  assert.match(
    workflow,
    /checkout_head="\$\(git rev-parse HEAD\)"[\s\S]*live_main="\$\(git rev-parse origin\/mita-main\)"[\s\S]*\[ "\$checkout_head" != "\$live_main" \]/
  )
  assert.ok(
    (
      workflow.match(
        /git ls-remote --exit-code origin refs\/heads\/mita-main/g
      ) ?? []
    ).length >= 3
  )
  assert.match(workflow, /git show "\$\{TAG\}:biyan-release\.json"/)
  assert.match(workflow, /git show "\$\{TAG\}:src-tauri\/tauri\.conf\.json"/)
  assert.match(workflow, /git show "\$\{TAG\}:src-tauri\/Cargo\.lock"/)
  assert.match(
    workflow,
    /--json tagName,name,url,publishedAt,body,isDraft,isPrerelease,assets/
  )
  assert.match(workflow, /confirm="\$INPUT_CONFIRM"/)
  assert.match(workflow, /\[ "\$confirm" != "DISTRIBUTE" \]/)
  assert.match(workflow, /--candidate-dir dist\/release-assets/)
  assert.match(workflow, /--tag-cargo-lock dist\/tag-Cargo\.lock/)
  assert.match(
    workflow,
    /--expected-source-commit "\$\{\{ steps\.provenance\.outputs\.source_commit \}\}"/
  )
  assert.match(workflow, /node scripts\/updater\/verify-candidate\.mjs/)
  assert.match(workflow, /sha256sum --check SHA256SUMS/)

  for (const exactName of [
    'Biyan_${VERSION}_universal.dmg',
    'Biyan_${VERSION}_x64-setup.exe',
    'Biyan_${VERSION}_x64-setup.exe.sig',
    'Biyan_${VERSION}_x64_en-US.msi',
    'Biyan_${VERSION}_amd64.AppImage',
    'Biyan_${VERSION}_amd64.AppImage.sig',
    'Biyan_${VERSION}_amd64.deb',
    'Biyan.app.tar.gz',
    'Biyan.app.tar.gz.sig',
    'candidate.json',
    'candidate.json.sig',
    'latest.json',
    'SHA256SUMS',
  ]) {
    assert.ok(workflow.includes(`"${exactName}"`), exactName)
  }

  for (const mutationMarker of [
    '- name: Generate release poster',
    '- name: Install exact Alibaba Cloud clients',
    '- name: Execute recoverable download publication transaction',
    '- name: Send Feishu release messages',
    'uses: actions/upload-artifact@v4',
  ]) {
    assert.ok(
      workflow.indexOf(mutationMarker) > validationIndex,
      `${mutationMarker} must follow provenance validation`
    )
  }
  for (const [guard, mutation] of [
    [
      '- name: Revalidate protected harness before poster API mutation',
      '- name: Generate release poster',
    ],
    [
      '- name: Revalidate protected harness before OSS mutation',
      '- name: Execute recoverable download publication transaction',
    ],
    [
      '- name: Revalidate protected harness before Feishu mutation',
      '- name: Send Feishu release messages',
    ],
  ]) {
    assert.ok(
      workflow.indexOf(guard) > validationIndex &&
        workflow.indexOf(guard) < workflow.indexOf(mutation),
      `${guard} must immediately precede ${mutation}`
    )
  }
  assert.match(
    workflow,
    /BIYAN_DOWNLOAD_VERSION_ROOT:.*'biyan\/download\/releases'/
  )
  assert.match(
    workflow,
    /LEGACY_DOWNLOAD_MANIFEST_KEY:.*'mita\/download\/latest\.json'/
  )
  assert.match(workflow, /LEGACY_DOWNLOAD_PAGE_KEY:.*'mita\/download'/)
  assert.match(
    workflow,
    /if \[ "\$cdn_base" != "https:\/\/static\.mitapp\.cn" \]/
  )
  assert.match(
    workflow,
    /https:\/\/aliyuncli\.alicdn\.com\/aliyun-cli-linux-3\.3\.22-amd64\.tgz/
  )
  assert.match(
    workflow,
    /41a67dfd2f44c00eb628d9f91fa7c4807222de54ebe44fac3477fb9c70b3b0bc/
  )
  assert.match(
    workflow,
    /https:\/\/gosspublic\.alicdn\.com\/ossutil\/v2\/2\.3\.0\/ossutil-2\.3\.0-linux-amd64\.zip/
  )
  assert.match(
    workflow,
    /3ae4d9fc85a7a6e9f5654d1599766f1a3a42a3692870887b5ae9338d582ef65a/
  )
  assert.doesNotMatch(workflow, /install\.sh/)
  assert.match(workflow, /JINGXING_BASE_URL: https:\/\/api\.jingxing\.io\/v1/)
  assert.doesNotMatch(workflow, /vars\.JINGXING_BASE_URL/)
  assert.match(workflow, /ALIYUN_OSS_BUCKET: mita-static/)
  assert.match(
    workflow,
    /ALIYUN_OSS_ENDPOINT: https:\/\/oss-cn-hangzhou\.aliyuncs\.com/
  )
  assert.match(
    workflow,
    /node scripts\/release-distribution\/publish-download-transaction\.mjs/
  )
  const transactionStepStart = workflow.indexOf(
    '- name: Execute recoverable download publication transaction'
  )
  const transactionStepEnd = workflow.indexOf(
    '- name: Revalidate protected harness before Feishu mutation',
    transactionStepStart
  )
  assert.ok(
    transactionStepStart > validationIndex &&
      transactionStepEnd > transactionStepStart
  )
  const transactionStep = workflow.slice(
    transactionStepStart,
    transactionStepEnd
  )
  const assetDirectoryContract =
    /args=\(\n\s+--release-json dist\/release-assets\.json\n\s+--assets-dir dist\/release-assets\n\s+--payload-dir dist\/biyan-download/
  assert.match(transactionStep, assetDirectoryContract)
  assert.doesNotMatch(
    transactionStep.replace(
      '\n            --assets-dir dist/release-assets',
      ''
    ),
    assetDirectoryContract
  )
  assert.match(
    workflow,
    /--evidence dist\/distribution-transaction\/state\.json/
  )
  assert.match(
    workflow,
    /--recovery dist\/distribution-transaction\/recovery\.json/
  )
  assert.doesNotMatch(
    workflow,
    /\baliyun\s+(?:--profile\s+\S+\s+)?oss\s+(?:cp|stat|rm)\b/,
    'the workflow must not bypass the recoverable transaction'
  )
  assert.doesNotMatch(
    transactionScript,
    /\baliyun\s+(?:--profile\s+\S+\s+)?oss\s+(?:cp|stat|rm)\b/,
    'the transaction must use ossutil 2.0 object commands'
  )
  assert.doesNotMatch(
    transactionScript,
    /\baliyun\s+(?:--profile\s+\S+\s+)?ossutil\b/,
    'object operations must use the checksum-pinned standalone ossutil binary'
  )
  assert.match(
    transactionScript,
    /evidence\.status =\s*rollbackErrors\.length === 0 \? 'rolled-back' : 'manual-recovery'/
  )
  assert.match(transactionScript, /rollbackReadbackDirectory,\s*'prestateFile'/)
  assert.match(
    transactionScript,
    /activeKey: 'biyan\/download\/transactions\/active\.json'/
  )
  assert.match(transactionScript, /await persistRemoteJournal\(\)/)
  assert.match(transactionScript, /publicReadbackAttempts = 60/)
  assert.match(transactionScript, /publicReadbackDelayMs = 6000/)
  assert.match(transactionScript, /publicReadbackTimeoutMs = 330_000/)
  assert.match(transactionScript, /'dry-run-remote-preflight'/)
  assert.match(transactionScript, /'cleanup-failed'/)
  assert.match(transactionScript, /timeoutSeconds = 600/)
  assert.match(transactionScript, /phase: 'clear-active'/)
  assert.match(transactionScript, /OSS_TRANSFER_TIMEOUT_MS = 900_000/)
  assert.match(workflow, /--connect-timeout 10/)
  assert.match(workflow, /--max-time 180/)
  assert.match(
    workflow,
    /- name: Require transaction evidence\n\s+if: always\(\)/
  )
  assert.match(
    workflow,
    /- name: Upload distribution metadata\n\s+if: always\(\)/
  )
  assert.match(workflow, /if-no-files-found: error/)
  assert.match(workflow, /dist\/distribution-transaction\/\*\*/)
})

test('publication plan resolves installers from the explicit release asset directory and fails before remote access when they are absent', async (t) => {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'biyan-release-asset-directory-')
  )
  const metadataDirectory = path.join(dir, 'metadata')
  const assetsDirectory = path.join(dir, 'release-assets')
  const payloadDirectory = path.join(dir, 'payload')
  fs.mkdirSync(metadataDirectory)
  fs.mkdirSync(assetsDirectory)
  fs.mkdirSync(payloadDirectory)

  const releasePath = path.join(metadataDirectory, 'release-assets.json')
  fs.writeFileSync(
    releasePath,
    `${JSON.stringify(collectReleaseAssets(sampleRelease()), null, 2)}\n`
  )

  const savedEnvironment = {
    ALIYUN_OSS_BUCKET: process.env.ALIYUN_OSS_BUCKET,
    ALIYUN_OSS_ENDPOINT: process.env.ALIYUN_OSS_ENDPOINT,
    UPDATES_CDN_BASE_URL: process.env.UPDATES_CDN_BASE_URL,
  }
  Object.assign(process.env, {
    ALIYUN_OSS_BUCKET: 'mita-static',
    ALIYUN_OSS_ENDPOINT: 'https://oss-cn-hangzhou.aliyuncs.com',
    UPDATES_CDN_BASE_URL: 'https://static.mitapp.cn',
  })
  t.after(() => {
    for (const [name, value] of Object.entries(savedEnvironment)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })

  const plan = buildPublicationPlan({
    '--release-json': releasePath,
    '--assets-dir': assetsDirectory,
    '--payload-dir': payloadDirectory,
    '--tag': 'v1.2.3',
  })
  const expectedNames = [
    'Biyan_1.2.3_universal.dmg',
    'Biyan_1.2.3_x64-setup.exe',
    'Biyan_1.2.3_x64_en-US.msi',
    'Biyan_1.2.3_amd64.AppImage',
    'Biyan_1.2.3_amd64.deb',
  ]

  assert.deepEqual(
    plan.immutable.slice(0, expectedNames.length).map(({ file }) => file),
    expectedNames.map((name) => path.join(assetsDirectory, name))
  )
  assert.ok(
    plan.immutable
      .slice(0, expectedNames.length)
      .every(({ file }) => path.dirname(file) === assetsDirectory)
  )
  assert.notEqual(metadataDirectory, assetsDirectory)

  let remoteCalls = 0
  const noRemoteAdapter = Object.fromEntries(
    [
      'download',
      'upload',
      'remove',
      'purge',
      'downloadPublic',
      'readMetadata',
    ].map((name) => [
      name,
      async () => {
        remoteCalls += 1
        throw new Error(`unexpected remote ${name}`)
      },
    ])
  )
  const evidenceFile = path.join(dir, 'evidence.json')
  const recoveryFile = path.join(dir, 'recovery.json')

  await assert.rejects(
    () =>
      executePublicationTransaction(plan, {
        adapters: { aliyun: noRemoteAdapter },
        workspace: path.join(dir, 'transaction-work'),
        evidenceFile,
        recoveryFile,
      }),
    (error) =>
      error instanceof PublicationTransactionError &&
      error.evidence.status === 'preflight-failed' &&
      /immutable macos-dmg source file is missing/.test(error.message)
  )
  assert.equal(remoteCalls, 0)
  assert.deepEqual(
    JSON.parse(fs.readFileSync(evidenceFile, 'utf8')).immutable,
    []
  )
  assert.deepEqual(
    JSON.parse(fs.readFileSync(evidenceFile, 'utf8')).mutable,
    []
  )
})

test('publication transaction CLI requires an explicit release asset directory', () => {
  const result = spawnSync(
    process.execPath,
    [
      transactionScriptPath,
      '--release-json',
      'release-assets.json',
      '--payload-dir',
      'payload',
      '--tag',
      'v1.2.3',
      '--evidence',
      'evidence.json',
      '--recovery',
      'recovery.json',
    ],
    { encoding: 'utf8' }
  )

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Missing required argument: --assets-dir/)
})

test('buildFeishuReleasePayloads keeps card image-free and appends poster messages', () => {
  const manifest = collectReleaseAssets(sampleRelease())
  const card = buildFeishuCard(manifest, {
    downloadPageUrl: 'https://static.mitapp.cn/biyan/download',
  })

  assert.notEqual(card.elements[0].tag, 'img')
  assert.doesNotMatch(JSON.stringify(card), /img_v3_abc/)

  const payloads = buildFeishuReleasePayloads(card, {
    chatId: 'oc_release_chat',
    posterImageKey: 'img_v3_abc',
  })

  assert.equal(payloads.length, 3)
  assert.equal(payloads[0].msg_type, 'interactive')
  assert.equal(payloads[1].msg_type, 'text')
  assert.deepEqual(JSON.parse(payloads[1].content), { text: '宣传图：' })
  assert.equal(payloads[2].msg_type, 'image')
  assert.deepEqual(JSON.parse(payloads[2].content), { image_key: 'img_v3_abc' })
})

test('buildFeishuPayload signs custom bot payload when secret is provided', () => {
  const card = { config: {}, elements: [] }
  const payload = buildFeishuPayload(card, {
    secret: 'secret-value',
    timestamp: '1760000000',
  })

  assert.equal(payload.msg_type, 'interactive')
  assert.equal(payload.timestamp, '1760000000')
  assert.equal(payload.sign, createFeishuSign('1760000000', 'secret-value'))
})

test('buildFeishuAppMessagePayload targets a chat_id interactive card', () => {
  const card = { config: {}, elements: [{ tag: 'div' }] }
  const payload = buildFeishuAppMessagePayload(card, {
    chatId: 'oc_release_chat',
  })

  assert.equal(payload.receive_id, 'oc_release_chat')
  assert.equal(payload.msg_type, 'interactive')
  assert.deepEqual(JSON.parse(payload.content), card)
})

test('postFeishuAppMessage sends interactive card through app bot API', async () => {
  const calls = []
  const fetchMock = async (url, init = {}) => {
    calls.push({ url, init })
    return new Response(
      JSON.stringify({
        code: 0,
        data: { message_id: 'om_release' },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )
  }
  const card = { config: {}, elements: [{ tag: 'div' }] }

  await postFeishuAppMessage('oc_release_chat', card, 'tenant-token', fetchMock)

  assert.equal(
    calls[0].url,
    'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id'
  )
  assert.equal(calls[0].init.headers.authorization, 'Bearer tenant-token')
  const body = JSON.parse(calls[0].init.body)
  assert.equal(body.receive_id, 'oc_release_chat')
  assert.equal(body.msg_type, 'interactive')
  assert.deepEqual(JSON.parse(body.content), card)
})

test('send-feishu-card dry run renders app bot card, label, and poster payloads', () => {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'mita-feishu-card-app-dry-run-')
  )
  const releasePath = path.join(dir, 'release-assets.json')
  const posterPath = path.join(dir, 'release-poster.png')
  const posterJsonPath = path.join(dir, 'release-poster.json')
  const outputPath = path.join(dir, 'feishu-card.json')

  fs.writeFileSync(
    releasePath,
    `${JSON.stringify(collectReleaseAssets(sampleRelease()), null, 2)}\n`
  )
  fs.writeFileSync(posterPath, Buffer.from([1, 2, 3]))
  fs.writeFileSync(
    posterJsonPath,
    `${JSON.stringify(
      {
        status: 'generated',
        outputPath: posterPath,
        feishuUploadStatus: 'uploaded',
        feishuImageKey: 'img_v3_dry_run',
      },
      null,
      2
    )}\n`
  )

  const result = spawnSync(
    process.execPath,
    [
      feishuScript,
      '--release-json',
      releasePath,
      '--poster-json',
      posterJsonPath,
      '--download-page-url',
      'https://static.mitapp.cn/biyan/download',
      '--output',
      outputPath,
      '--dry-run',
    ],
    {
      env: {
        ...process.env,
        FEISHU_RELEASE_CHAT_ID: 'oc_release_chat',
        FEISHU_APP_ID: '',
        FEISHU_APP_SECRET: '',
      },
      encoding: 'utf8',
    }
  )

  assert.equal(result.status, 0, result.stderr)
  const payloads = JSON.parse(fs.readFileSync(outputPath, 'utf8'))
  assert.equal(payloads.length, 3)
  assert.equal(payloads[0].receive_id, 'oc_release_chat')
  assert.equal(payloads[0].msg_type, 'interactive')
  assert.match(payloads[0].content, /Biyan v1\.2\.3 发布完成/)
  assert.match(
    payloads[0].content,
    /https:\/\/static\.mitapp\.cn\/biyan\/download/
  )
  assert.doesNotMatch(payloads[0].content, /img_v3_dry_run/)
  assert.doesNotMatch(payloads[0].content, /百度/)
  assert.equal(payloads[1].msg_type, 'text')
  assert.deepEqual(JSON.parse(payloads[1].content), { text: '宣传图：' })
  assert.equal(payloads[2].msg_type, 'image')
  assert.deepEqual(JSON.parse(payloads[2].content), {
    image_key: 'img_v3_dry_run',
  })
})

test('extractPosterHighlights separates release features and fixes', () => {
  const manifest = collectReleaseAssets(sampleRelease())
  const highlights = extractPosterHighlights(manifest)

  assert.deepEqual(highlights.features, [
    'Added visible desktop updater',
    'Added manual update checks',
  ])
  assert.deepEqual(highlights.fixes, ['Fixed updater CDN manifest parsing'])
})

test('extractPosterHighlights fills update block from improvement sections', () => {
  const highlights = extractPosterHighlights({
    body: ['## 优化调整', '- 优化发布包校验逻辑', '- 改进飞书通知摘要'].join(
      '\n'
    ),
  })

  assert.deepEqual(highlights.features, [
    '优化发布包校验逻辑',
    '改进飞书通知摘要',
  ])
  assert.deepEqual(highlights.fixes, [])
})

test('generateReleasePoster writes image from Jingxing async task content', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mita-release-poster-'))
  const output = path.join(dir, 'poster.png')
  const manifest = collectReleaseAssets(sampleRelease())
  const calls = []
  const fetchMock = async (url, init = {}) => {
    calls.push({ url, init })

    if (String(url).endsWith('/images/generations/async')) {
      return new Response(
        JSON.stringify({
          object: 'image.task',
          id: 'task_123',
          status: 'pending',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }

    if (String(url).endsWith('/images/tasks/task_123')) {
      return new Response(
        JSON.stringify({
          object: 'image.task',
          id: 'task_123',
          status: 'succeeded',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }

    if (String(url).endsWith('/images/tasks/task_123/content/0')) {
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      })
    }

    throw new Error(`Unexpected fetch: ${url}`)
  }

  const result = await generateReleasePoster(manifest, {
    apiKey: 'jk-test',
    baseUrl: 'https://api.jingxing.io/v1',
    output,
    fetchImpl: fetchMock,
    pollIntervalMs: 1,
    timeoutMs: 1000,
  })

  assert.equal(result.status, 'generated')
  assert.equal(result.outputPath, output)
  assert.equal(result.mimeType, 'image/png')
  assert.equal(fs.readFileSync(output).length, 3)
  assert.equal(
    calls[0].url,
    'https://api.jingxing.io/v1/images/generations/async'
  )
  assert.equal(calls[1].url, 'https://api.jingxing.io/v1/images/tasks/task_123')
  assert.equal(
    calls[2].url,
    'https://api.jingxing.io/v1/images/tasks/task_123/content/0'
  )

  const body = JSON.parse(calls[0].init.body)
  assert.equal(body.model, 'gpt-image-2')
  assert.equal(body.size, '1024x1536')
  assert.equal(body.quality, 'medium')
  assert.match(body.prompt, /彼岩桌面版新版本来啦/)
  assert.match(body.prompt, /Added visible desktop updater/)
})

test('Jingxing API key is never sent outside the exact production base URL', async () => {
  for (const baseUrl of [
    'http://api.jingxing.io/v1',
    'https://evil.invalid/v1',
    'https://api.jingxing.io/v1/',
    'https://api.jingxing.io/v2',
    'https://api.jingxing.io/v1?proxy=1',
  ]) {
    assert.throws(
      () => validateJingxingBaseUrl(baseUrl),
      /must be exactly https:\/\/api\.jingxing\.io\/v1/
    )
    let called = false
    await assert.rejects(
      () =>
        generateReleasePoster(collectReleaseAssets(sampleRelease()), {
          apiKey: 'must-not-leak',
          baseUrl,
          output: '/tmp/must-not-exist.png',
          fetchImpl: async () => {
            called = true
            throw new Error('unexpected network call')
          },
          pollIntervalMs: 1,
          timeoutMs: 1,
        }),
      /must be exactly https:\/\/api\.jingxing\.io\/v1/
    )
    assert.equal(called, false)
  }
})

test('generate-release-poster CLI degrades when Jingxing key is missing', () => {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'mita-release-poster-missing-key-')
  )
  const manifestPath = path.join(dir, 'release-assets.json')
  const metadataPath = path.join(dir, 'release-poster.json')
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify(collectReleaseAssets(sampleRelease()), null, 2)}\n`
  )

  const result = spawnSync(
    process.execPath,
    [
      posterScript,
      '--release-json',
      manifestPath,
      '--output',
      path.join(dir, 'poster.png'),
      '--metadata',
      metadataPath,
    ],
    {
      env: {
        ...process.env,
        JINGXING_API_KEY: '',
      },
      encoding: 'utf8',
    }
  )

  assert.equal(result.status, 0, result.stderr)
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
  assert.equal(metadata.status, 'failed')
  assert.match(metadata.reason, /JINGXING_API_KEY/)
})

test('generate-release-poster CLI fails closed on a noncanonical Jingxing base URL', () => {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'biyan-release-poster-endpoint-')
  )
  const manifestPath = path.join(dir, 'release-assets.json')
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify(collectReleaseAssets(sampleRelease()), null, 2)}\n`
  )
  const result = spawnSync(
    process.execPath,
    [posterScript, '--release-json', manifestPath],
    {
      env: {
        ...process.env,
        JINGXING_API_KEY: 'must-not-leak',
        JINGXING_BASE_URL: 'https://evil.invalid/v1',
      },
      encoding: 'utf8',
    }
  )
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /must be exactly https:\/\/api\.jingxing\.io\/v1/)
})

test('resolvePosterImageKey uploads generated poster to Feishu', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mita-feishu-poster-'))
  const posterPath = path.join(dir, 'poster.png')
  const posterJson = path.join(dir, 'release-poster.json')
  fs.writeFileSync(posterPath, Buffer.from([1, 2, 3]))
  fs.writeFileSync(
    posterJson,
    `${JSON.stringify({ status: 'generated', outputPath: posterPath }, null, 2)}\n`
  )

  const calls = []
  const fetchMock = async (url, init = {}) => {
    calls.push({ url, init })
    if (String(url).includes('/auth/v3/tenant_access_token/internal')) {
      return new Response(
        JSON.stringify({
          code: 0,
          tenant_access_token: 'tenant-token',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }

    if (String(url).includes('/im/v1/images')) {
      return new Response(
        JSON.stringify({
          code: 0,
          data: { image_key: 'img_v3_abc' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }

    throw new Error(`Unexpected fetch: ${url}`)
  }

  const imageKey = await resolvePosterImageKey({
    posterJson,
    appId: 'cli_xxx',
    appSecret: 'secret',
    fetchImpl: fetchMock,
  })

  assert.equal(imageKey, 'img_v3_abc')
  assert.equal(
    calls[0].url,
    'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal'
  )
  assert.equal(calls[1].url, 'https://open.feishu.cn/open-apis/im/v1/images')
  assert.equal(calls[1].init.headers.authorization, 'Bearer tenant-token')

  const metadata = JSON.parse(fs.readFileSync(posterJson, 'utf8'))
  assert.equal(metadata.feishuUploadStatus, 'uploaded')
  assert.equal(metadata.feishuImageKey, 'img_v3_abc')
})
