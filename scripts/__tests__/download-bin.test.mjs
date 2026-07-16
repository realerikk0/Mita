import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  buildRuntimePlan,
  downloadUrlToFile,
  ensureCachedArchive,
  loadRuntimeManifest,
  provisionRuntimeAssets,
  validateRuntimeManifest,
} from '../download-bin.mjs'

const scriptsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
)
const manifestPath = path.join(scriptsDir, 'runtime-assets.json')

async function temporaryDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'download-bin-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  return directory
}

test('runtime manifest pins official Bun and uv versions and macOS hashes', async () => {
  const manifest = await loadRuntimeManifest(manifestPath)

  assert.equal(manifest.tools.bun.version, '1.3.14')
  assert.equal(manifest.tools.uv.version, '0.11.28')
  assert.deepEqual(
    {
      bunArm64: manifest.tools.bun.assets['darwin-arm64'].sha256,
      bunX64: manifest.tools.bun.assets['darwin-x64'].sha256,
      uvArm64: manifest.tools.uv.assets['darwin-arm64'].sha256,
      uvX64: manifest.tools.uv.assets['darwin-x64'].sha256,
    },
    {
      bunArm64:
        'd8b96221828ad6f97ac7ac0ab7e95872341af763001e8803e8267652c2652620',
      bunX64:
        '4183df3374623e5bab315c547cfa0974533cd457d86b73b639f7a87974cd6633',
      uvArm64:
        '33540eb7c883ab857eff79bd5ac2aa31fe27b595abecb4a9c003a2c998447232',
      uvX64: '2ad79983127ffca7d77b77ce6a24278d7e4f7b817a1acf72fea5f8124b4aac5e',
    }
  )

  for (const tool of Object.values(manifest.tools)) {
    for (const asset of Object.values(tool.assets)) {
      assert.doesNotMatch(asset.url, /\/latest(?:\/|$)/i)
    }
  }
})

test('runtime manifest rejects latest-release URLs', async () => {
  const manifest = structuredClone(await loadRuntimeManifest(manifestPath))
  manifest.tools.bun.assets['darwin-arm64'].url =
    'https://github.com/oven-sh/bun/releases/latest/download/bun-darwin-aarch64.zip'

  assert.throws(
    () => validateRuntimeManifest(manifest),
    /must not use a latest-release URL/
  )
})

test('darwin plan always contains arm64 and x64 thin assets plus universal outputs', async () => {
  const manifest = await loadRuntimeManifest(manifestPath)
  const plan = buildRuntimePlan(manifest, 'darwin', 'arm64')

  for (const tool of plan.tools) {
    assert.deepEqual(
      tool.assets.map(({ key }) => key),
      ['darwin-arm64', 'darwin-x64']
    )
    assert.deepEqual(
      tool.assets.map(({ lipoArch }) => lipoArch),
      ['arm64', 'x86_64']
    )
    assert.deepEqual(
      tool.assets.map(({ outputName }) => outputName),
      [`${tool.name}-aarch64-apple-darwin`, `${tool.name}-x86_64-apple-darwin`]
    )
    assert.equal(
      tool.universalOutputName,
      `${tool.name}-universal-apple-darwin`
    )
    assert.equal(tool.defaultOutputName, tool.name)
  }
})

test('linux and Windows plans keep pinned host-specific sidecar names', async () => {
  const manifest = await loadRuntimeManifest(manifestPath)
  const linuxPlan = buildRuntimePlan(manifest, 'linux', 'arm64')
  const windowsPlan = buildRuntimePlan(manifest, 'win32', 'arm64')

  assert.deepEqual(
    linuxPlan.tools.map((tool) => tool.assets[0].outputName),
    ['bun-aarch64-unknown-linux-gnu', 'uv-aarch64-unknown-linux-gnu']
  )
  assert.deepEqual(
    windowsPlan.tools.map((tool) => tool.assets[0].outputName),
    ['bun-x86_64-pc-windows-msvc.exe', 'uv-x86_64-pc-windows-msvc.exe']
  )
  assert.deepEqual(
    windowsPlan.tools.map((tool) => tool.defaultOutputName),
    ['bun.exe', 'uv.exe']
  )
  assert.equal(
    manifest.tools.uv.assets['win32-x64'].binaryPath,
    'uv.exe',
    'the official uv Windows archive is flat'
  )
  assert.ok(
    [...linuxPlan.tools, ...windowsPlan.tools].every((tool) =>
      tool.assets.every((asset) => !asset.url.includes('/latest/'))
    )
  )
})

test('Windows uv provisioning consumes the official flat uv.exe archive layout', async (t) => {
  const projectRoot = await temporaryDirectory(t)
  const manifest = await loadRuntimeManifest(manifestPath)
  const plan = buildRuntimePlan(manifest, 'win32', 'x64')
  plan.tools = [plan.tools.find((tool) => tool.name === 'uv')]
  const uvAsset = plan.tools[0].assets[0]

  assert.deepEqual(
    {
      archive: uvAsset.archive,
      binaryPath: uvAsset.binaryPath,
      format: uvAsset.format,
      target: uvAsset.target,
    },
    {
      archive: 'uv-x86_64-pc-windows-msvc.zip',
      binaryPath: 'uv.exe',
      format: 'zip',
      target: 'x86_64-pc-windows-msvc',
    }
  )

  await provisionRuntimeAssets(plan, {
    projectRoot,
    ensureArchive: async () => uvAsset.archive,
    extract: async (_archive, extractionDir) => {
      await fs.mkdir(extractionDir, { recursive: true })
      await fs.writeFile(path.join(extractionDir, 'uv.exe'), 'windows-uv')
    },
  })

  const binDir = path.join(projectRoot, 'src-tauri/resources/bin')
  assert.equal(
    await fs.readFile(
      path.join(binDir, 'uv-x86_64-pc-windows-msvc.exe'),
      'utf8'
    ),
    'windows-uv'
  )
  assert.equal(
    await fs.readFile(path.join(binDir, 'uv.exe'), 'utf8'),
    'windows-uv'
  )
})

test('cache rejects a downloaded archive with a mismatched hash and leaves no partial file', async (t) => {
  const cacheDir = await temporaryDirectory(t)
  const expectedSha256 = createHash('sha256').update('expected').digest('hex')
  const asset = {
    archive: 'runtime.zip',
    url: 'https://example.invalid/runtime.zip',
    sha256: expectedSha256,
  }

  await assert.rejects(
    ensureCachedArchive(asset, cacheDir, {
      uniqueId: () => 'test',
      downloadFile: async (_url, destination) => {
        await fs.writeFile(destination, 'tampered')
      },
    }),
    /SHA-256 mismatch/
  )

  assert.deepEqual(await fs.readdir(cacheDir), [])
})

test('concurrent cache misses for the same pinned asset share one download', async (t) => {
  const cacheDir = await temporaryDirectory(t)
  const contents = Buffer.from('verified-runtime')
  const asset = {
    archive: 'runtime.zip',
    url: 'https://example.invalid/runtime.zip',
    sha256: createHash('sha256').update(contents).digest('hex'),
  }
  let downloads = 0
  let nextUniqueId = 0
  const options = {
    uniqueId: () => `test-${nextUniqueId++}`,
    downloadFile: async (_url, destination) => {
      downloads += 1
      await new Promise((resolve) => setImmediate(resolve))
      await fs.writeFile(destination, contents)
    },
  }

  const cachePaths = await Promise.all([
    ensureCachedArchive(asset, cacheDir, options),
    ensureCachedArchive(asset, cacheDir, options),
    ensureCachedArchive(asset, cacheDir, options),
  ])

  assert.equal(downloads, 1)
  assert.equal(new Set(cachePaths).size, 1)
  assert.deepEqual(await fs.readFile(cachePaths[0]), contents)
  assert.deepEqual(await fs.readdir(cacheDir), ['runtime.zip'])

  assert.equal(
    await ensureCachedArchive(asset, cacheDir, options),
    cachePaths[0]
  )
  assert.equal(downloads, 1)
})

test('transient network failures retry with a clean partial file', async (t) => {
  const cacheDir = await temporaryDirectory(t)
  const contents = Buffer.from('verified-after-retry')
  const asset = {
    archive: 'runtime.zip',
    url: 'https://example.invalid/runtime.zip',
    sha256: createHash('sha256').update(contents).digest('hex'),
  }
  let attempts = 0
  const delays = []

  const cachePath = await ensureCachedArchive(asset, cacheDir, {
    uniqueId: () => 'transient-network',
    retryDelay: async (delayMs) => delays.push(delayMs),
    downloadFile: async (_url, destination) => {
      attempts += 1
      if (attempts < 3) {
        await fs.writeFile(destination, `partial-${attempts}`)
        const error = new Error('simulated reset')
        error.code = 'ECONNRESET'
        throw error
      }
      await assert.rejects(fs.access(destination), { code: 'ENOENT' })
      await fs.writeFile(destination, contents)
    },
  })

  assert.equal(attempts, 3)
  assert.deepEqual(delays, [500, 1000])
  assert.deepEqual(await fs.readFile(cachePath), contents)
  assert.deepEqual(await fs.readdir(cacheDir), ['runtime.zip'])
})

test('malformed redirect rejects through the cache task and cleans its partial file', async (t) => {
  const cacheDir = await temporaryDirectory(t)
  const asset = {
    archive: 'runtime.zip',
    url: 'https://example.invalid/runtime.zip',
    sha256: createHash('sha256').update('unused').digest('hex'),
  }
  const httpsGet = (_url, onResponse) => {
    const request = new EventEmitter()
    queueMicrotask(() => {
      const response = new PassThrough()
      response.statusCode = 302
      response.headers = { location: 'https://[invalid' }
      onResponse(response)
      response.end()
    })
    return request
  }

  await assert.rejects(
    ensureCachedArchive(asset, cacheDir, {
      uniqueId: () => 'malformed-redirect',
      downloadFile: (url, destination) =>
        downloadUrlToFile(url, destination, { httpsGet }),
    }),
    /Invalid redirect URL/
  )
  assert.deepEqual(await fs.readdir(cacheDir), [])
})

test('darwin provisioning awaits every thin binary before creating and installing universal output', async (t) => {
  const projectRoot = await temporaryDirectory(t)
  const manifest = await loadRuntimeManifest(manifestPath)
  const plan = buildRuntimePlan(manifest, 'darwin', 'arm64')
  plan.tools = [plan.tools[0]]
  const tool = plan.tools[0]
  const assetByKey = new Map(tool.assets.map((asset) => [asset.key, asset]))
  const events = []

  await provisionRuntimeAssets(plan, {
    projectRoot,
    ensureArchive: async (asset) => {
      events.push(`download:${asset.key}`)
      await new Promise((resolve) => setImmediate(resolve))
      return asset.key
    },
    extract: async (assetKey, extractionDir) => {
      const asset = assetByKey.get(assetKey)
      const binaryPath = path.join(extractionDir, asset.binaryPath)
      await fs.mkdir(path.dirname(binaryPath), { recursive: true })
      await fs.writeFile(binaryPath, assetKey)
      events.push(`extract:${assetKey}`)
    },
    assertArchitectures: async (binaryPath, architectures) => {
      assert.equal((await fs.stat(binaryPath)).isFile(), true)
      await new Promise((resolve) => setImmediate(resolve))
      events.push(
        `verify:${path.basename(binaryPath)}:${architectures.join('+')}`
      )
    },
    mergeUniversal: async (thinBinaryPaths, destinationPath) => {
      const contents = await Promise.all(
        thinBinaryPaths.map((binaryPath) => fs.readFile(binaryPath, 'utf8'))
      )
      await new Promise((resolve) => setImmediate(resolve))
      await fs.writeFile(destinationPath, contents.join('+'))
      events.push(`merge:${path.basename(destinationPath)}`)
    },
  })

  const binDir = path.join(projectRoot, 'src-tauri/resources/bin')
  const universalContents = await fs.readFile(
    path.join(binDir, 'bun-universal-apple-darwin'),
    'utf8'
  )
  assert.equal(universalContents, 'darwin-arm64+darwin-x64')
  assert.equal(
    await fs.readFile(path.join(binDir, 'bun'), 'utf8'),
    universalContents
  )
  assert.ok(
    events.indexOf('merge:bun-universal-apple-darwin') >
      events.indexOf('verify:bun-x86_64-apple-darwin:x86_64')
  )
  assert.equal(events.at(-1), 'verify:bun:arm64+x86_64')
})

test('darwin provisioning fails closed before lipo when either architecture fails', async (t) => {
  const projectRoot = await temporaryDirectory(t)
  const manifest = await loadRuntimeManifest(manifestPath)
  const plan = buildRuntimePlan(manifest, 'darwin', 'arm64')
  plan.tools = [plan.tools[0]]
  let mergeCalled = false

  await assert.rejects(
    provisionRuntimeAssets(plan, {
      projectRoot,
      ensureArchive: async (asset) => {
        if (asset.key === 'darwin-x64') {
          throw new Error('x64 download failed')
        }
        return asset.key
      },
      extract: async (_archive, extractionDir) => {
        const asset = plan.tools[0].assets[0]
        const binaryPath = path.join(extractionDir, asset.binaryPath)
        await fs.mkdir(path.dirname(binaryPath), { recursive: true })
        await fs.writeFile(binaryPath, 'arm64')
      },
      assertArchitectures: async () => {},
      mergeUniversal: async () => {
        mergeCalled = true
      },
    }),
    /x64 download failed/
  )

  assert.equal(mergeCalled, false)
  await assert.rejects(
    fs.access(
      path.join(
        projectRoot,
        'src-tauri/resources/bin/bun-universal-apple-darwin'
      )
    ),
    { code: 'ENOENT' }
  )
  await assert.rejects(
    fs.access(path.join(projectRoot, 'src-tauri/resources/bin/bun')),
    { code: 'ENOENT' }
  )
})
