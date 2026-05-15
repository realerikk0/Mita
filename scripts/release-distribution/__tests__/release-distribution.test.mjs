import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { collectReleaseAssets } from '../collect-release-assets.mjs'
import {
  buildFeishuCard,
  buildFeishuPayload,
  createFeishuSign,
} from '../send-feishu-card.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const uploadScript = path.resolve(here, '../upload-baidu.sh')

function sampleRelease() {
  return {
    tagName: 'v1.2.3',
    name: 'Mita v1.2.3',
    url: 'https://github.com/realerikk0/Mita/releases/tag/v1.2.3',
    publishedAt: '2026-05-15T08:00:00Z',
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
