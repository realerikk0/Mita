import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  BIYAN_DOWNLOAD_ALIAS_BOOTSTRAP_ALLOWLIST,
  BIYAN_DOWNLOAD_ALIAS_BOOTSTRAP_ALLOWLIST_SHA256,
  BiyanDownloadAliasBootstrapError,
  executeBiyanDownloadAliasBootstrap,
  loadBootstrapAllowlist,
  validateBootstrapAllowlist,
  validateBootstrapIdentity,
} from '../bootstrap-biyan-download-aliases.mjs'
import {
  createAliyunAdapter,
  parseAliyunBucketVersioning,
} from '../publish-download-transaction.mjs'

const manifestBytes = Buffer.from(
  'ewogICJzY2hlbWFWZXJzaW9uIjogMiwKICAicHJvZHVjdCI6ICJCaXlhbiIsCiAgImNoYW5uZWwiOiAic3RhYmxlIiwKICAidGFnTmFtZSI6ICJ2MC42LjYzMyIsCiAgInZlcnNpb24iOiAiMC42LjYzMyIsCiAgImdlbmVyYXRlZEF0IjogIjIwMjYtMDctMTBUMDU6NDE6NDYuODE0WiIsCiAgInB1Ymxpc2hlZEF0IjogIjIwMjYtMDctMTBUMDU6NDA6NTVaIiwKICAicmVsZWFzZVVybCI6ICJodHRwczovL2dpdGh1Yi5jb20vcmVhbGVyaWtrMC9NaXRhL3JlbGVhc2VzL3RhZy92MC42LjYzMyIsCiAgImRvd25sb2FkUGFnZVVybCI6ICJodHRwczovL3N0YXRpYy5taXRhcHAuY24vbWl0YS9kb3dubG9hZCIsCiAgInByaW1hcnlEb3dubG9hZCI6IHsKICAgICJ0eXBlIjogImFsaXl1bi1jZG4iLAogICAgInVybCI6ICJodHRwczovL3N0YXRpYy5taXRhcHAuY24vbWl0YS9kb3dubG9hZCIsCiAgICAicGFzc3dvcmQiOiBudWxsCiAgfSwKICAicGxhdGZvcm1zIjogewogICAgIm1hY29zIjogewogICAgICAibmFtZSI6ICJCaXlhbl8wLjYuNjMzX3VuaXZlcnNhbC5kbWciLAogICAgICAidXJsIjogImh0dHBzOi8vc3RhdGljLm1pdGFwcC5jbi9taXRhL2Rvd25sb2FkL3JlbGVhc2VzL3YwLjYuNjMzL0JpeWFuXzAuNi42MzNfdW5pdmVyc2FsLmRtZyIsCiAgICAgICJzaXplIjogMjI2Nzg0MTE4CiAgICB9LAogICAgIndpbmRvd3MiOiB7CiAgICAgICJuYW1lIjogIkJpeWFuXzAuNi42MzNfeDY0LXNldHVwLmV4ZSIsCiAgICAgICJ1cmwiOiAiaHR0cHM6Ly9zdGF0aWMubWl0YXBwLmNuL21pdGEvZG93bmxvYWQvcmVsZWFzZXMvdjAuNi42MzMvQml5YW5fMC42LjYzM194NjQtc2V0dXAuZXhlIiwKICAgICAgInNpemUiOiAxODczNDQ1NjUKICAgIH0sCiAgICAid2luZG93c01zaSI6IHsKICAgICAgIm5hbWUiOiAiQml5YW5fMC42LjYzM194NjRfZW4tVVMubXNpIiwKICAgICAgInVybCI6ICJodHRwczovL3N0YXRpYy5taXRhcHAuY24vbWl0YS9kb3dubG9hZC9yZWxlYXNlcy92MC42LjYzMy9CaXlhbl8wLjYuNjMzX3g2NF9lbi1VUy5tc2kiLAogICAgICAic2l6ZSI6IDI0OTQ0ODA5MQogICAgfQogIH0sCiAgImdpdGh1YiI6IHsKICAgICJtYWNvc0RtZyI6IHsKICAgICAgIm5hbWUiOiAiQml5YW5fMC42LjYzM191bml2ZXJzYWwuZG1nIiwKICAgICAgImRvd25sb2FkVXJsIjogImh0dHBzOi8vZ2l0aHViLmNvbS9yZWFsZXJpa2swL01pdGEvcmVsZWFzZXMvZG93bmxvYWQvdjAuNi42MzMvQml5YW5fMC42LjYzM191bml2ZXJzYWwuZG1nIiwKICAgICAgInNpemUiOiAyMjY3ODQxMTgKICAgIH0sCiAgICAid2luZG93c0V4ZSI6IHsKICAgICAgIm5hbWUiOiAiQml5YW5fMC42LjYzM194NjQtc2V0dXAuZXhlIiwKICAgICAgImRvd25sb2FkVXJsIjogImh0dHBzOi8vZ2l0aHViLmNvbS9yZWFsZXJpa2swL01pdGEvcmVsZWFzZXMvZG93bmxvYWQvdjAuNi42MzMvQml5YW5fMC42LjYzM194NjQtc2V0dXAuZXhlIiwKICAgICAgInNpemUiOiAxODczNDQ1NjUKICAgIH0sCiAgICAid2luZG93c01zaSI6IHsKICAgICAgIm5hbWUiOiAiQml5YW5fMC42LjYzM194NjRfZW4tVVMubXNpIiwKICAgICAgImRvd25sb2FkVXJsIjogImh0dHBzOi8vZ2l0aHViLmNvbS9yZWFsZXJpa2swL01pdGEvcmVsZWFzZXMvZG93bmxvYWQvdjAuNi42MzMvQml5YW5fMC42LjYzM194NjRfZW4tVVMubXNpIiwKICAgICAgInNpemUiOiAyNDk0NDgwOTEKICAgIH0KICB9Cn0K',
  'base64'
)
const pageBytes = Buffer.from(
  'PCFkb2N0eXBlIGh0bWw+CjxodG1sIGxhbmc9InpoLUNOIj4KPGhlYWQ+CiAgPG1ldGEgY2hhcnNldD0idXRmLTgiPgogIDxtZXRhIG5hbWU9InZpZXdwb3J0IiBjb250ZW50PSJ3aWR0aD1kZXZpY2Utd2lkdGgsIGluaXRpYWwtc2NhbGU9MSI+CiAgPHRpdGxlPkJpeWFuIERvd25sb2FkPC90aXRsZT4KICA8c3R5bGU+CiAgICBib2R5IHsgZm9udC1mYW1pbHk6IC1hcHBsZS1zeXN0ZW0sIEJsaW5rTWFjU3lzdGVtRm9udCwgIlNlZ29lIFVJIiwgc2Fucy1zZXJpZjsgbWFyZ2luOiA0MHB4OyBsaW5lLWhlaWdodDogMS42OyBjb2xvcjogIzExMTgyNzsgfQogICAgYSB7IGNvbG9yOiAjMjU2M2ViOyB9CiAgICBjb2RlIHsgYm9yZGVyLXJhZGl1czogNnB4OyBiYWNrZ3JvdW5kOiAjZjNmNGY2OyBwYWRkaW5nOiAycHggNnB4OyB9CiAgPC9zdHlsZT4KPC9oZWFkPgo8Ym9keT4KICA8cD5PcGVuaW5nIEJpeWFuIGRvd25sb2FkLi4uPC9wPgogIDxwPjxhIGhyZWY9Imh0dHBzOi8vc3RhdGljLm1pdGFwcC5jbi9taXRhL2Rvd25sb2FkL3JlbGVhc2VzL3YwLjYuNjMzL0JpeWFuXzAuNi42MzNfeDY0LXNldHVwLmV4ZSIgcmVsPSJub29wZW5lciBub3JlZmVycmVyIj5PcGVuIEJpeWFuPC9hPjwvcD4KICA8cD4KICAgIDxhIGhyZWY9Imh0dHBzOi8vc3RhdGljLm1pdGFwcC5jbi9taXRhL2Rvd25sb2FkL3JlbGVhc2VzL3YwLjYuNjMzL0JpeWFuXzAuNi42MzNfdW5pdmVyc2FsLmRtZyIgcmVsPSJub29wZW5lciBub3JlZmVycmVyIj5Eb3dubG9hZCBmb3IgbWFjT1M8L2E+CiAgICAgwrcgPGEgaHJlZj0iaHR0cHM6Ly9zdGF0aWMubWl0YXBwLmNuL21pdGEvZG93bmxvYWQvcmVsZWFzZXMvdjAuNi42MzMvQml5YW5fMC42LjYzM194NjQtc2V0dXAuZXhlIiByZWw9Im5vb3BlbmVyIG5vcmVmZXJyZXIiPkRvd25sb2FkIGZvciBXaW5kb3dzPC9hPgogIDwvcD4KICAKICA8c2NyaXB0PgogICAgY29uc3QgbWFjb3NVcmwgPSAiaHR0cHM6Ly9zdGF0aWMubWl0YXBwLmNuL21pdGEvZG93bmxvYWQvcmVsZWFzZXMvdjAuNi42MzMvQml5YW5fMC42LjYzM191bml2ZXJzYWwuZG1nIjsKICAgIGNvbnN0IHdpbmRvd3NVcmwgPSAiaHR0cHM6Ly9zdGF0aWMubWl0YXBwLmNuL21pdGEvZG93bmxvYWQvcmVsZWFzZXMvdjAuNi42MzMvQml5YW5fMC42LjYzM194NjQtc2V0dXAuZXhlIjsKICAgIGNvbnN0IGZhbGxiYWNrVXJsID0gImh0dHBzOi8vc3RhdGljLm1pdGFwcC5jbi9taXRhL2Rvd25sb2FkL3JlbGVhc2VzL3YwLjYuNjMzL0JpeWFuXzAuNi42MzNfeDY0LXNldHVwLmV4ZSI7CiAgICBjb25zdCBwbGF0Zm9ybVVybCA9IC9NYWNpbnRvc2h8TWFjIE9TIFgvaS50ZXN0KG5hdmlnYXRvci51c2VyQWdlbnQpCiAgICAgID8gbWFjb3NVcmwKICAgICAgOiAvV2luZG93cy9pLnRlc3QobmF2aWdhdG9yLnVzZXJBZ2VudCkKICAgICAgICA/IHdpbmRvd3NVcmwKICAgICAgICA6IGZhbGxiYWNrVXJsOwogICAgd2luZG93LmxvY2F0aW9uLnJlcGxhY2UocGxhdGZvcm1VcmwgfHwgZmFsbGJhY2tVcmwpOwogIDwvc2NyaXB0Pgo8L2JvZHk+CjwvaHRtbD4K',
  'base64'
)

const identity = {
  tagName: 'v0.6.643',
  sourceCommit: '38e6d9290a8b9b0f152ff2a7eefb550e6ead7df5',
  migrationPhase: 'A',
  dataSchema: 1,
}

function clone(value) {
  return structuredClone(value)
}

function fixtureBytes(id) {
  return id === 'manifest' ? manifestBytes : pageBytes
}

function publicHeaders(metadata) {
  return {
    cacheControl: metadata.cacheControl,
    contentType: metadata.contentType,
  }
}

function createFixture(t) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'biyan-download-alias-bootstrap-')
  )
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const loaded = loadBootstrapAllowlist()
  const allowlist = loaded.document
  const objects = new Map()
  const publicObjects = new Map()
  const calls = {
    download: [],
    publicReadback: [],
    metadata: [],
    uploadIfAbsent: [],
    remove: [],
    purge: [],
    conditionalSafety: 0,
  }
  const failures = {
    uploadKeys: new Set(),
    ambiguousExactUploadKeys: new Set(),
    versioningAfterAmbiguousUpload: null,
    removeKeys: new Set(),
    publicKeys: new Set(),
    purge: false,
    suppressPurgePropagation: false,
    versioningStatus: null,
    afterUpload: null,
  }
  const setObject = (key, bytes, metadata) => {
    objects.set(key, {
      bytes: Buffer.from(bytes),
      metadata: clone(metadata),
    })
  }
  const setPublic = (url, bytes, headers) => {
    publicObjects.set(url, {
      bytes: Buffer.from(bytes),
      headers: clone(headers),
    })
  }
  for (const entry of allowlist.entries) {
    const bytes = fixtureBytes(entry.id)
    setObject(entry.source.key, bytes, entry.source.metadata)
    setPublic(
      entry.source.publicUrl,
      bytes,
      publicHeaders(entry.source.metadata)
    )
  }

  const adapter = {
    publicReadbackAttempts: 2,
    publicReadbackTimeoutMs: 10_000,
    async waitForPublicReadback() {},
    async assertConditionalWriteSafety() {
      calls.conditionalSafety += 1
      if (failures.versioningStatus) {
        throw new Error(
          `Conditional OSS writes are unsafe while bucket versioning is ${failures.versioningStatus}`
        )
      }
      return { status: 'Unversioned' }
    },
    async download(entry, destination) {
      calls.download.push(entry.key)
      const object = objects.get(entry.key)
      if (!object) return false
      fs.mkdirSync(path.dirname(destination), { recursive: true })
      fs.writeFileSync(destination, object.bytes)
      return true
    },
    async downloadPublicOptional(entry, destination) {
      calls.publicReadback.push(entry.publicUrl)
      if (failures.publicKeys.has(entry.publicUrl)) {
        throw new Error(`public readback failed for ${entry.publicUrl}`)
      }
      const object = publicObjects.get(entry.publicUrl)
      if (!object) {
        return {
          exists: false,
          status: 404,
          effectiveUrl: entry.publicUrl,
          headers: null,
        }
      }
      fs.mkdirSync(path.dirname(destination), { recursive: true })
      fs.writeFileSync(destination, object.bytes)
      return {
        exists: true,
        status: 200,
        effectiveUrl: entry.publicUrl,
        headers: clone(object.headers),
      }
    },
    async readMetadata(entry) {
      calls.metadata.push(entry.key)
      const object = objects.get(entry.key)
      if (!object) throw new Error(`missing metadata for ${entry.key}`)
      return clone(object.metadata)
    },
    async uploadIfAbsent(entry, source, metadata) {
      await this.assertConditionalWriteSafety()
      calls.uploadIfAbsent.push(entry.key)
      if (failures.uploadKeys.has(entry.key)) {
        throw new Error(`injected conditional upload failure for ${entry.key}`)
      }
      if (objects.has(entry.key)) {
        throw new Error(`forbid-overwrite rejected ${entry.key}`)
      }
      setObject(entry.key, fs.readFileSync(source), metadata)
      if (failures.ambiguousExactUploadKeys.has(entry.key)) {
        failures.versioningStatus =
          failures.versioningAfterAmbiguousUpload
        throw new Error(`ambiguous conditional upload result for ${entry.key}`)
      }
      await failures.afterUpload?.(entry, {
        allowlist,
        objects,
        publicObjects,
        setObject,
        setPublic,
      })
    },
    async remove(entry) {
      calls.remove.push(entry.key)
      if (failures.removeKeys.has(entry.key)) {
        throw new Error(`injected remove failure for ${entry.key}`)
      }
      objects.delete(entry.key)
    },
    async purge(entries) {
      calls.purge.push(entries.map(({ key }) => key))
      if (failures.purge) throw new Error('injected purge failure')
      if (failures.suppressPurgePropagation) return
      for (const targetEntry of entries) {
        const item = allowlist.entries.find(
          ({ target }) => target.key === targetEntry.key
        )
        const object = objects.get(targetEntry.key)
        if (item && object) {
          setPublic(
            item.target.publicUrl,
            object.bytes,
            publicHeaders(item.target.metadata)
          )
        }
      }
    },
  }
  const seedTarget = (
    id,
    {
      bytes = fixtureBytes(id),
      metadata,
      publicBytes = bytes,
      publicMetadata,
      publish = true,
    } = {}
  ) => {
    const entry = allowlist.entries.find((candidate) => candidate.id === id)
    setObject(entry.target.key, bytes, metadata ?? entry.target.metadata)
    if (publish) {
      setPublic(
        entry.target.publicUrl,
        publicBytes,
        publicHeaders(publicMetadata ?? entry.target.metadata)
      )
    }
  }
  const seedStaging = (
    id,
    {
      bytes = fixtureBytes(id),
      metadata,
    } = {}
  ) => {
    const entry = allowlist.entries.find((candidate) => candidate.id === id)
    setObject(entry.staging.key, bytes, metadata ?? entry.staging.metadata)
  }
  return {
    root,
    loaded,
    allowlist,
    adapter,
    objects,
    publicObjects,
    calls,
    failures,
    setObject,
    setPublic,
    seedTarget,
    seedStaging,
    evidenceFile: path.join(root, 'evidence', 'state.json'),
    workspace: path.join(root, 'work'),
  }
}

async function executeFixture(fixture, { dryRun = false } = {}) {
  return executeBiyanDownloadAliasBootstrap(
    {
      allowlist: fixture.allowlist,
      allowlistSha256: fixture.loaded.sha256,
      identity,
    },
    {
      adapter: fixture.adapter,
      workspace: fixture.workspace,
      evidenceFile: fixture.evidenceFile,
      dryRun,
    }
  )
}

function assertTargetExact(fixture, id) {
  const entry = fixture.allowlist.entries.find(
    (candidate) => candidate.id === id
  )
  assert.deepEqual(
    fixture.objects.get(entry.target.key),
    {
      bytes: fixtureBytes(id),
      metadata: clone(entry.target.metadata),
    }
  )
  assert.deepEqual(
    fixture.publicObjects.get(entry.target.publicUrl),
    {
      bytes: fixtureBytes(id),
      headers: publicHeaders(entry.target.metadata),
    }
  )
}

function assertStagingAbsent(fixture) {
  for (const entry of fixture.allowlist.entries) {
    assert.equal(fixture.objects.has(entry.staging.key), false)
  }
}

test('pinned bootstrap allowlist has exact approved source bytes and identity', () => {
  const loaded = loadBootstrapAllowlist()
  assert.equal(
    loaded.file,
    path.resolve(BIYAN_DOWNLOAD_ALIAS_BOOTSTRAP_ALLOWLIST)
  )
  assert.equal(
    loaded.sha256,
    BIYAN_DOWNLOAD_ALIAS_BOOTSTRAP_ALLOWLIST_SHA256
  )
  assert.equal(manifestBytes.length, 1722)
  assert.equal(pageBytes.length, 1542)
  assert.equal(
    createHash('sha256').update(manifestBytes).digest('hex'),
    loaded.document.entries[0].source.sha256
  )
  assert.equal(
    createHash('sha256').update(pageBytes).digest('hex'),
    loaded.document.entries[1].source.sha256
  )
  assert.doesNotThrow(() =>
    validateBootstrapIdentity(identity, loaded.document.release)
  )
  assert.throws(
    () =>
      validateBootstrapIdentity(
        { ...identity, sourceCommit: '0'.repeat(40) },
        loaded.document.release
      ),
    /exact v0\.6\.643\/A13/
  )
})

test('dry-run validates all missing targets without any remote mutation', async (t) => {
  const fixture = createFixture(t)
  const evidence = await executeFixture(fixture, { dryRun: true })
  assert.equal(evidence.status, 'dry-run-ready')
  assert.equal(evidence.dryRun, true)
  assert.deepEqual(
    evidence.targets.map(({ preflightState }) => preflightState),
    ['absent', 'absent']
  )
  assert.equal(fixture.calls.uploadIfAbsent.length, 0)
  assert.equal(fixture.calls.remove.length, 0)
  assert.equal(fixture.calls.purge.length, 0)
  assert.equal(evidence.cleanup.attempted, false)
  assert.equal(
    fs.readFileSync(fixture.evidenceFile, 'utf8').includes('ACCESS_KEY'),
    false
  )
})

test('dry-run also accepts exact and partial-exact states without mutation', async (t) => {
  for (const state of ['exact', 'partial-exact']) {
    await t.test(state, async (t) => {
      const fixture = createFixture(t)
      fixture.seedTarget('manifest')
      if (state === 'exact') fixture.seedTarget('page')
      const evidence = await executeFixture(fixture, { dryRun: true })
      assert.equal(evidence.status, 'dry-run-ready')
      assert.deepEqual(
        evidence.targets.map(({ preflightState }) => preflightState),
        state === 'exact' ? ['exact', 'exact'] : ['exact', 'absent']
      )
      assert.equal(fixture.calls.uploadIfAbsent.length, 0)
      assert.equal(fixture.calls.remove.length, 0)
      assert.equal(fixture.calls.purge.length, 0)
    })
  }
})

test('all-missing bootstrap commits exact aliases, purges, reads back, and cleans staging', async (t) => {
  const fixture = createFixture(t)
  const evidence = await executeFixture(fixture)
  assert.equal(evidence.status, 'committed')
  assert.equal(evidence.commitCasVerified, true)
  assert.deepEqual(fixture.calls.uploadIfAbsent, [
    fixture.allowlist.entries[0].staging.key,
    fixture.allowlist.entries[1].staging.key,
    fixture.allowlist.entries[0].target.key,
    fixture.allowlist.entries[1].target.key,
  ])
  assert.equal(fixture.calls.purge.length, 1)
  assert.deepEqual(fixture.calls.purge[0], [
    'biyan/download/latest.json',
    'biyan/download',
  ])
  assertTargetExact(fixture, 'manifest')
  assertTargetExact(fixture, 'page')
  assertStagingAbsent(fixture)
  assert.equal(evidence.cleanup.completed, true)
  assert.ok(fixture.calls.conditionalSafety >= 6)
})

test('already exact aliases are idempotent with no upload, purge, or delete', async (t) => {
  const fixture = createFixture(t)
  fixture.seedTarget('manifest')
  fixture.seedTarget('page')
  const evidence = await executeFixture(fixture)
  assert.equal(evidence.status, 'committed')
  assert.equal(fixture.calls.uploadIfAbsent.length, 0)
  assert.equal(fixture.calls.purge.length, 0)
  assert.equal(fixture.calls.remove.length, 0)
  assertTargetExact(fixture, 'manifest')
  assertTargetExact(fixture, 'page')
})

test('partial exact state only forward-completes the absent target', async (t) => {
  const fixture = createFixture(t)
  fixture.seedTarget('manifest')
  const evidence = await executeFixture(fixture)
  assert.equal(evidence.status, 'committed')
  assert.deepEqual(fixture.calls.uploadIfAbsent, [
    fixture.allowlist.entries[1].staging.key,
    fixture.allowlist.entries[1].target.key,
  ])
  assertTargetExact(fixture, 'manifest')
  assertTargetExact(fixture, 'page')
  assertStagingAbsent(fixture)
})

test('exact origin with stale public bytes is recovered only by purge and readback', async (t) => {
  const fixture = createFixture(t)
  fixture.seedTarget('manifest', { publicBytes: Buffer.from('stale') })
  fixture.seedTarget('page')
  const evidence = await executeFixture(fixture)
  assert.equal(evidence.status, 'committed')
  assert.equal(fixture.calls.uploadIfAbsent.length, 0)
  assert.equal(fixture.calls.purge.length, 1)
  assertTargetExact(fixture, 'manifest')
})

test('interrupted live upload leaves only exact partial state and reruns forward', async (t) => {
  const fixture = createFixture(t)
  const page = fixture.allowlist.entries[1]
  fixture.failures.uploadKeys.add(page.target.key)
  await assert.rejects(
    executeFixture(fixture),
    (error) =>
      error instanceof BiyanDownloadAliasBootstrapError &&
      /injected conditional upload failure/.test(error.message)
  )
  const manifest = fixture.allowlist.entries[0]
  assert.deepEqual(fixture.objects.get(manifest.target.key), {
    bytes: manifestBytes,
    metadata: clone(manifest.target.metadata),
  })
  assert.equal(
    fixture.publicObjects.has(manifest.target.publicUrl),
    false
  )
  assert.equal(fixture.objects.has(page.target.key), false)
  assertStagingAbsent(fixture)

  fixture.failures.uploadKeys.clear()
  fixture.calls.uploadIfAbsent.length = 0
  const evidence = await executeFixture(fixture)
  assert.equal(evidence.status, 'committed')
  assert.deepEqual(fixture.calls.uploadIfAbsent, [
    page.staging.key,
    page.target.key,
  ])
  assertTargetExact(fixture, 'page')
})

test('ambiguous conditional live write only accepts exact concurrent state while CAS remains safe', async (t) => {
  await t.test('Unversioned exact readback forward-completes', async (t) => {
    const fixture = createFixture(t)
    const manifest = fixture.allowlist.entries[0]
    fixture.failures.ambiguousExactUploadKeys.add(manifest.target.key)
    const evidence = await executeFixture(fixture)
    assert.equal(evidence.status, 'committed')
    const manifestEvidence = evidence.targets.find(
      ({ id }) => id === 'manifest'
    )
    assert.equal(manifestEvidence.wrote, false)
    assert.equal(manifestEvidence.concurrentExact, true)
    assertTargetExact(fixture, 'manifest')
    assertTargetExact(fixture, 'page')
  })

  for (const status of ['Enabled', 'Suspended']) {
    await t.test(`${status} safety recheck fails closed`, async (t) => {
      const fixture = createFixture(t)
      const [manifest, page] = fixture.allowlist.entries
      fixture.failures.ambiguousExactUploadKeys.add(manifest.target.key)
      fixture.failures.versioningAfterAmbiguousUpload = status
      await assert.rejects(
        executeFixture(fixture),
        /ambiguous conditional upload result/
      )
      assert.deepEqual(
        fixture.objects.get(manifest.target.key),
        {
          bytes: manifestBytes,
          metadata: clone(manifest.target.metadata),
        }
      )
      assert.equal(fixture.objects.has(page.target.key), false)
      assert.equal(
        fixture.calls.uploadIfAbsent.includes(page.target.key),
        false
      )
      assertStagingAbsent(fixture)
    })
  }
})

test('staging upload failure creates no live target and cleans any exact staging', async (t) => {
  const fixture = createFixture(t)
  const manifest = fixture.allowlist.entries[0]
  fixture.failures.uploadKeys.add(manifest.staging.key)
  await assert.rejects(executeFixture(fixture), /staging/)
  for (const entry of fixture.allowlist.entries) {
    assert.equal(fixture.objects.has(entry.target.key), false)
  }
  assertStagingAbsent(fixture)
  assert.equal(fixture.calls.purge.length, 0)
})

test('commit CAS catches a source mutation after staging and makes no live write', async (t) => {
  const fixture = createFixture(t)
  const page = fixture.allowlist.entries[1]
  const manifest = fixture.allowlist.entries[0]
  fixture.failures.afterUpload = async (entry) => {
    if (entry.key === page.staging.key) {
      fixture.setObject(
        manifest.source.key,
        Buffer.from('mutated'),
        manifest.source.metadata
      )
    }
  }
  await assert.rejects(executeFixture(fixture), /source origin/)
  for (const entry of fixture.allowlist.entries) {
    assert.equal(fixture.objects.has(entry.target.key), false)
  }
  assertStagingAbsent(fixture)
})

test('conflicting target bytes or metadata are never overwritten', async (t) => {
  await t.test('bytes conflict', async (t) => {
    const fixture = createFixture(t)
    fixture.seedTarget('manifest', { bytes: Buffer.from('conflict') })
    await assert.rejects(executeFixture(fixture), /refusing to overwrite/)
    assert.equal(fixture.calls.uploadIfAbsent.length, 0)
    assert.equal(
      fixture.objects.get('biyan/download/latest.json').bytes.toString(),
      'conflict'
    )
  })
  await t.test('metadata conflict', async (t) => {
    const fixture = createFixture(t)
    const metadata = clone(
      fixture.allowlist.entries[0].target.metadata
    )
    metadata.cacheControl = 'no-store'
    fixture.seedTarget('manifest', { metadata })
    await assert.rejects(executeFixture(fixture), /different metadata/)
    assert.equal(fixture.calls.uploadIfAbsent.length, 0)
  })
})

test('missing source, source public mismatch, and public header drift fail closed', async (t) => {
  await t.test('source missing', async (t) => {
    const fixture = createFixture(t)
    fixture.objects.delete('mita/download/latest.json')
    await assert.rejects(executeFixture(fixture), /source origin/)
    assert.equal(fixture.calls.uploadIfAbsent.length, 0)
  })
  await t.test('source public mismatch', async (t) => {
    const fixture = createFixture(t)
    const source = fixture.allowlist.entries[0].source
    fixture.setPublic(
      source.publicUrl,
      Buffer.from('different'),
      publicHeaders(source.metadata)
    )
    await assert.rejects(executeFixture(fixture), /source public/)
    assert.equal(fixture.calls.uploadIfAbsent.length, 0)
  })
  await t.test('source public header drift', async (t) => {
    const fixture = createFixture(t)
    const source = fixture.allowlist.entries[0].source
    fixture.setPublic(source.publicUrl, manifestBytes, {
      cacheControl: 'no-store',
      contentType: source.metadata.contentType,
    })
    await assert.rejects(executeFixture(fixture), /response headers differ/)
    assert.equal(fixture.calls.uploadIfAbsent.length, 0)
  })
})

test('origin-absent target with a public ghost fails closed', async (t) => {
  const fixture = createFixture(t)
  const target = fixture.allowlist.entries[0].target
  fixture.setPublic(
    target.publicUrl,
    manifestBytes,
    publicHeaders(target.metadata)
  )
  await assert.rejects(executeFixture(fixture), /unexpectedly exists publicly/)
  assert.equal(fixture.calls.uploadIfAbsent.length, 0)
})

test('conflicting fixed staging object is preserved and blocks bootstrap', async (t) => {
  const fixture = createFixture(t)
  fixture.seedStaging('manifest', { bytes: Buffer.from('conflict') })
  await assert.rejects(executeFixture(fixture), /staging object has conflicting/)
  assert.equal(fixture.calls.uploadIfAbsent.length, 0)
  assert.equal(fixture.calls.remove.length, 0)
  assert.equal(
    fixture.objects
      .get(fixture.allowlist.entries[0].staging.key)
      .bytes.toString(),
    'conflict'
  )
})

test('purge or live public failure leaves exact forward-recoverable targets and no staging', async (t) => {
  await t.test('purge failure', async (t) => {
    const fixture = createFixture(t)
    fixture.failures.purge = true
    await assert.rejects(executeFixture(fixture), /purge failure/)
    assertStagingAbsent(fixture)
    for (const entry of fixture.allowlist.entries) {
      assert.deepEqual(
        fixture.objects.get(entry.target.key).bytes,
        fixtureBytes(entry.id)
      )
    }
    fixture.failures.purge = false
    const evidence = await executeFixture(fixture)
    assert.equal(evidence.status, 'committed')
  })
  await t.test('public readback failure', async (t) => {
    const fixture = createFixture(t)
    fixture.failures.suppressPurgePropagation = true
    await assert.rejects(executeFixture(fixture), /did not converge/)
    assertStagingAbsent(fixture)
    fixture.failures.suppressPurgePropagation = false
    const evidence = await executeFixture(fixture)
    assert.equal(evidence.status, 'committed')
  })
  await t.test('public header drift', async (t) => {
    const fixture = createFixture(t)
    fixture.failures.suppressPurgePropagation = true
    const target = fixture.allowlist.entries[0].target
    fixture.seedTarget('manifest', {
      publicMetadata: {
        ...target.metadata,
        cacheControl: 'no-store',
      },
    })
    fixture.seedTarget('page')
    await assert.rejects(executeFixture(fixture), /did not converge/)
    assertStagingAbsent(fixture)
  })
})

test('cleanup failure is explicit and a rerun cleans the fixed staging object', async (t) => {
  const fixture = createFixture(t)
  const manifestStaging = fixture.allowlist.entries[0].staging.key
  fixture.failures.removeKeys.add(manifestStaging)
  await assert.rejects(
    executeFixture(fixture),
    (error) =>
      error instanceof BiyanDownloadAliasBootstrapError &&
      error.evidence.status === 'cleanup-failed'
  )
  assert.equal(fixture.objects.has(manifestStaging), true)
  fixture.failures.removeKeys.clear()
  const evidence = await executeFixture(fixture)
  assert.equal(evidence.status, 'committed')
  assertStagingAbsent(fixture)
})

test('versioned or suspended OSS bucket fails before every remote write', async (t) => {
  for (const status of ['Enabled', 'Suspended']) {
    await t.test(status, async (t) => {
      const fixture = createFixture(t)
      fixture.failures.versioningStatus = status
      await assert.rejects(executeFixture(fixture), /versioning is/)
      assert.equal(fixture.calls.uploadIfAbsent.length, 0)
      assert.equal(fixture.calls.remove.length, 0)
      assert.equal(fixture.calls.purge.length, 0)
    })
  }
})

test('an active release-distribution journal blocks dry-run and real execution with zero writes', async (t) => {
  for (const dryRun of [true, false]) {
    await t.test(dryRun ? 'dry-run' : 'real', async (t) => {
      const fixture = createFixture(t)
      fixture.setObject(
        fixture.allowlist.activeJournalKey,
        Buffer.from('content is intentionally irrelevant'),
        fixture.allowlist.entries[0].staging.metadata
      )
      await assert.rejects(
        executeFixture(fixture, { dryRun }),
        /Active release-distribution journal blocks bootstrap/
      )
      const evidence = JSON.parse(
        fs.readFileSync(fixture.evidenceFile, 'utf8')
      )
      assert.equal(evidence.activeJournal.key, fixture.allowlist.activeJournalKey)
      assert.equal(evidence.activeJournal.checks.at(-1).absent, false)
      assert.equal(fixture.calls.uploadIfAbsent.length, 0)
      assert.equal(fixture.calls.remove.length, 0)
      assert.equal(fixture.calls.purge.length, 0)
    })
  }
})

test('allowlist mutation and stable updater key substitution are rejected', (t) => {
  const fixture = createFixture(t)
  const mutatedFile = path.join(fixture.root, 'mutated-allowlist.json')
  const mutated = clone(fixture.allowlist)
  mutated.entries[0].target.key = 'mita/latest.json'
  fs.writeFileSync(mutatedFile, `${JSON.stringify(mutated, null, 2)}\n`)
  assert.throws(
    () => loadBootstrapAllowlist(mutatedFile),
    /allowlist SHA-256 mismatch/
  )
  assert.throws(
    () => validateBootstrapAllowlist(mutated),
    /Stable updater key is forbidden/
  )
})

test('Aliyun conditional adapter pins PutObject CAS, storage class, versioning, and public headers', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aliyun-bootstrap-adapter-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const source = path.join(root, 'source')
  fs.writeFileSync(source, 'bytes')
  const commands = []
  const url = 'https://static.mitapp.cn/biyan/download/latest.json'
  const adapter = createAliyunAdapter(
    {
      bucket: 'mita-static',
      endpoint: 'https://oss-cn-hangzhou.aliyuncs.com',
      region: 'cn-hangzhou',
    },
    {
      runCommand(command, args, label) {
        commands.push({ command, args, label })
        if (label === 'read OSS bucket versioning') {
          return {
            found: true,
            output: '{"VersioningConfiguration":{}}',
          }
        }
        if (label.startsWith('conditional upload ')) {
          return { found: true, output: '{}' }
        }
        if (label.startsWith('probe public URL ')) {
          const destination = args[args.indexOf('--output') + 1]
          const headers = args[args.indexOf('--dump-header') + 1]
          fs.writeFileSync(destination, 'bytes')
          fs.writeFileSync(
            headers,
            'HTTP/2 200\r\ncache-control: public, max-age=60, must-revalidate\r\ncontent-type: application/json\r\n\r\n'
          )
          return {
            found: true,
            output: `__BIYAN_PUBLIC_READBACK__200\n${url}`,
          }
        }
        throw new Error(`unexpected command ${command} ${args.join(' ')}`)
      },
      publicReadbackAttempts: 1,
      publicReadbackDelayMs: 0,
      publicReadbackTimeoutMs: 1,
    }
  )
  const entry = {
    id: 'manifest',
    key: 'biyan/download/latest.json',
    publicUrl: url,
  }
  const metadata = {
    cacheControl: 'public, max-age=60, must-revalidate',
    contentType: 'application/json',
    contentEncoding: null,
    contentDisposition: null,
    expires: null,
    acl: 'default',
    storageClass: 'Standard',
    customMetadata: {},
  }
  await adapter.uploadIfAbsent(entry, source, metadata)
  const put = commands.find(({ label }) =>
    label.startsWith('conditional upload ')
  )
  assert.deepEqual(put.args.slice(0, 2), ['api', 'put-object'])
  assert.deepEqual(
    put.args.slice(
      put.args.indexOf('--forbid-overwrite'),
      put.args.indexOf('--forbid-overwrite') + 2
    ),
    ['--forbid-overwrite', 'true']
  )
  assert.deepEqual(
    put.args.slice(
      put.args.indexOf('--storage-class'),
      put.args.indexOf('--storage-class') + 2
    ),
    ['--storage-class', 'Standard']
  )
  assert.equal(put.args.includes('--force'), false)
  assert.ok(
    commands.find(({ args }) => args[1] === 'get-bucket-versioning')
  )
  const publicResult = await adapter.downloadPublicOptional(
    entry,
    path.join(root, 'public')
  )
  assert.deepEqual(publicResult, {
    exists: true,
    status: 200,
    effectiveUrl: url,
    headers: {
      cacheControl: 'public, max-age=60, must-revalidate',
      contentType: 'application/json',
    },
  })
  assert.deepEqual(parseAliyunBucketVersioning('{}'), {
    status: 'Unversioned',
  })
  assert.throws(
    () =>
      parseAliyunBucketVersioning(
        '{"VersioningConfiguration":{"Status":"Enabled"}}'
      ),
    /versioning is Enabled/
  )
  assert.throws(
    () =>
      parseAliyunBucketVersioning(
        '{"VersioningConfiguration":{"Status":"Suspended"}}'
      ),
    /versioning is Suspended/
  )
})
