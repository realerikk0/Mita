import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { collectReleaseAssets } from '../collect-release-assets.mjs'
import {
  extractPosterHighlights,
  generateReleasePoster,
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

const here = path.dirname(fileURLToPath(import.meta.url))
const uploadScript = path.resolve(here, '../upload-baidu.sh')
const posterScript = path.resolve(here, '../generate-release-poster.mjs')
const feishuScript = path.resolve(here, '../send-feishu-card.mjs')

function sampleRelease() {
  return {
    tagName: 'v1.2.3',
    name: 'Mita v1.2.3',
    url: 'https://github.com/realerikk0/Mita/releases/tag/v1.2.3',
    publishedAt: '2026-05-15T08:00:00Z',
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
        name: 'Mita_1.2.3_universal.dmg',
        url: 'https://github.com/realerikk0/Mita/releases/download/v1.2.3/Mita_1.2.3_universal.dmg',
        size: 123,
      },
      {
        name: 'Mita_1.2.3_x64-setup.exe',
        url: 'https://github.com/realerikk0/Mita/releases/download/v1.2.3/Mita_1.2.3_x64-setup.exe',
        size: 456,
      },
      {
        name: 'Mita_1.2.3_x64_en-US.msi',
        url: 'https://github.com/realerikk0/Mita/releases/download/v1.2.3/Mita_1.2.3_x64_en-US.msi',
        size: 789,
      },
    ],
  }
}

test('collectReleaseAssets requires one dmg, one exe, and one msi', () => {
  const manifest = collectReleaseAssets(sampleRelease())

  assert.equal(manifest.tagName, 'v1.2.3')
  assert.match(manifest.body, /Added visible desktop updater/)
  assert.equal(manifest.assets.macosDmg.name, 'Mita_1.2.3_universal.dmg')
  assert.equal(manifest.assets.windowsExe.name, 'Mita_1.2.3_x64-setup.exe')
  assert.equal(manifest.assets.windowsMsi.name, 'Mita_1.2.3_x64_en-US.msi')
})

test('collectReleaseAssets fails when a required asset is missing', () => {
  const release = sampleRelease()
  release.assets = release.assets.filter((asset) => !asset.name.endsWith('.msi'))

  assert.throws(
    () => collectReleaseAssets(release),
    /Expected exactly one Windows MSI asset/,
  )
})

test('buildFeishuCard includes fixed release and download fields', () => {
  const manifest = collectReleaseAssets(sampleRelease())
  const card = buildFeishuCard(
    manifest,
    {
      url: 'https://pan.baidu.com/s/example',
      password: 'mita',
      remotePath: '/Mita/releases/v1.2.3',
    },
    {
      runUrl: 'https://github.com/realerikk0/Mita/actions/runs/1',
    },
  )

  const body = JSON.stringify(card)
  assert.match(body, /Mita v1\.2\.3 发布完成/)
  assert.match(body, /Mita_1\.2\.3_universal\.dmg/)
  assert.match(body, /Mita_1\.2\.3_x64-setup\.exe/)
  assert.match(body, /Mita_1\.2\.3_x64_en-US\.msi/)
  assert.match(body, /https:\/\/pan\.baidu\.com\/s\/example/)
  assert.match(body, /打开 GitHub Release/)
  assert.match(body, /打开百度网盘/)
})

test('buildFeishuReleasePayloads keeps card image-free and appends poster messages', () => {
  const manifest = collectReleaseAssets(sampleRelease())
  const card = buildFeishuCard(
    manifest,
    {
      url: 'https://pan.baidu.com/s/example',
      password: 'mita',
    },
  )

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
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }
  const card = { config: {}, elements: [{ tag: 'div' }] }

  await postFeishuAppMessage('oc_release_chat', card, 'tenant-token', fetchMock)

  assert.equal(
    calls[0].url,
    'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id',
  )
  assert.equal(calls[0].init.headers.authorization, 'Bearer tenant-token')
  const body = JSON.parse(calls[0].init.body)
  assert.equal(body.receive_id, 'oc_release_chat')
  assert.equal(body.msg_type, 'interactive')
  assert.deepEqual(JSON.parse(body.content), card)
})

test('send-feishu-card dry run renders app bot card, label, and poster payloads', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mita-feishu-card-app-dry-run-'))
  const releasePath = path.join(dir, 'release-assets.json')
  const baiduPath = path.join(dir, 'baidu-share.json')
  const posterPath = path.join(dir, 'release-poster.png')
  const posterJsonPath = path.join(dir, 'release-poster.json')
  const outputPath = path.join(dir, 'feishu-card.json')

  fs.writeFileSync(
    releasePath,
    `${JSON.stringify(collectReleaseAssets(sampleRelease()), null, 2)}\n`,
  )
  fs.writeFileSync(
    baiduPath,
    `${JSON.stringify({ url: 'https://pan.baidu.com/s/example', password: 'mita' }, null, 2)}\n`,
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
      2,
    )}\n`,
  )

  const result = spawnSync(
    process.execPath,
    [
      feishuScript,
      '--release-json',
      releasePath,
      '--baidu-json',
      baiduPath,
      '--poster-json',
      posterJsonPath,
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
    },
  )

  assert.equal(result.status, 0, result.stderr)
  const payloads = JSON.parse(fs.readFileSync(outputPath, 'utf8'))
  assert.equal(payloads.length, 3)
  assert.equal(payloads[0].receive_id, 'oc_release_chat')
  assert.equal(payloads[0].msg_type, 'interactive')
  assert.match(payloads[0].content, /Mita v1\.2\.3 发布完成/)
  assert.doesNotMatch(payloads[0].content, /img_v3_dry_run/)
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
  assert.deepEqual(highlights.fixes, [
    'Fixed updater CDN manifest parsing',
  ])
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
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }

    if (String(url).endsWith('/images/tasks/task_123')) {
      return new Response(
        JSON.stringify({
          object: 'image.task',
          id: 'task_123',
          status: 'succeeded',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
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
  assert.equal(calls[0].url, 'https://api.jingxing.io/v1/images/generations/async')
  assert.equal(calls[1].url, 'https://api.jingxing.io/v1/images/tasks/task_123')
  assert.equal(calls[2].url, 'https://api.jingxing.io/v1/images/tasks/task_123/content/0')

  const body = JSON.parse(calls[0].init.body)
  assert.equal(body.model, 'gpt-image-2')
  assert.equal(body.size, '1024x1536')
  assert.equal(body.quality, 'medium')
  assert.match(body.prompt, /Mita 桌面版新版本来啦/)
  assert.match(body.prompt, /Added visible desktop updater/)
})

test('generate-release-poster CLI degrades when Jingxing key is missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mita-release-poster-missing-key-'))
  const manifestPath = path.join(dir, 'release-assets.json')
  const metadataPath = path.join(dir, 'release-poster.json')
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify(collectReleaseAssets(sampleRelease()), null, 2)}\n`,
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
    },
  )

  assert.equal(result.status, 0, result.stderr)
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
  assert.equal(metadata.status, 'failed')
  assert.match(metadata.reason, /JINGXING_API_KEY/)
})

test('resolvePosterImageKey uploads generated poster to Feishu', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mita-feishu-poster-'))
  const posterPath = path.join(dir, 'poster.png')
  const posterJson = path.join(dir, 'release-poster.json')
  fs.writeFileSync(posterPath, Buffer.from([1, 2, 3]))
  fs.writeFileSync(
    posterJson,
    `${JSON.stringify({ status: 'generated', outputPath: posterPath }, null, 2)}\n`,
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
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }

    if (String(url).includes('/im/v1/images')) {
      return new Response(
        JSON.stringify({
          code: 0,
          data: { image_key: 'img_v3_abc' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
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
  assert.equal(calls[0].url, 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal')
  assert.equal(calls[1].url, 'https://open.feishu.cn/open-apis/im/v1/images')
  assert.equal(calls[1].init.headers.authorization, 'Bearer tenant-token')

  const metadata = JSON.parse(fs.readFileSync(posterJson, 'utf8'))
  assert.equal(metadata.feishuUploadStatus, 'uploaded')
  assert.equal(metadata.feishuImageKey, 'img_v3_abc')
})

test('upload-baidu dry run writes a placeholder share file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mita-release-distribution-'))
  const assetsDir = path.join(dir, 'assets')
  fs.mkdirSync(assetsDir)

  const manifest = collectReleaseAssets(sampleRelease())
  for (const asset of Object.values(manifest.assets)) {
    fs.writeFileSync(path.join(assetsDir, asset.name), 'fixture')
  }

  const manifestPath = path.join(dir, 'release-assets.json')
  const sharePath = path.join(dir, 'baidu-share.json')
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  const result = spawnSync('bash', [uploadScript], {
    env: {
      ...process.env,
      DRY_RUN: 'true',
      RELEASE_ASSETS_JSON: manifestPath,
      RELEASE_ASSETS_DIR: assetsDir,
      BAIDU_SHARE_JSON: sharePath,
      BAIDU_SHARE_PASSWORD: 'mita',
    },
    encoding: 'utf8',
  })

  assert.equal(result.status, 0, result.stderr)
  const share = JSON.parse(fs.readFileSync(sharePath, 'utf8'))
  assert.equal(share.dryRun, true)
  assert.equal(share.remotePath, '/Mita/releases/v1.2.3')
  assert.equal(share.password, 'mita')
})
