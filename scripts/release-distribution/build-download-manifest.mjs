#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) {
      args[key] = true
    } else {
      args[key] = next
      i += 1
    }
  }
  return args
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function ensureDirectory(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function baiduUrlWithPassword(url, password) {
  if (!url || !password) return url
  try {
    const parsed = new URL(url)
    if (!parsed.searchParams.has('pwd')) {
      parsed.searchParams.set('pwd', password)
    }
    return parsed.toString()
  } catch (_) {
    const separator = String(url).includes('?') ? '&' : '?'
    return `${url}${separator}pwd=${encodeURIComponent(password)}`
  }
}

function normalizeAsset(asset) {
  if (!asset) return null
  return {
    name: asset.name,
    downloadUrl: asset.downloadUrl ?? asset.url ?? asset.browser_download_url ?? null,
    size: asset.size ?? null,
  }
}

export function buildDownloadManifest(release, baiduShare, options = {}) {
  const tagName = release.tagName ?? release.tag_name
  const baiduUrl = baiduShare.url
  const baiduShareBlocked = Boolean(baiduShare.shareBlocked)
  const baiduPassword = baiduShareBlocked ? null : baiduShare.password || 'mita'
  const releaseUrl = release.url ?? release.html_url ?? release.htmlUrl ?? null

  if (!tagName) {
    throw new Error('Release manifest is missing tagName')
  }
  if (!baiduUrl) {
    throw new Error('Baidu share metadata is missing url')
  }

  const baidu = {
    url: baiduShareBlocked ? null : baiduUrl,
    urlWithPassword: baiduShareBlocked ? null : baiduUrlWithPassword(baiduUrl, baiduPassword),
    password: baiduPassword,
    remotePath: baiduShare.remotePath ?? null,
    shareBlocked: baiduShareBlocked,
    fallbackType: baiduShare.fallbackType ?? null,
    fallbackReason: baiduShare.fallbackReason ?? null,
    fallbackUrl: baiduShareBlocked ? baiduUrl : null,
  }

  const assets = release.assets ?? {}
  const primaryDownload = baiduShareBlocked
    ? {
        type: 'github-release',
        url: releaseUrl ?? baiduUrl,
        password: null,
        reason: baidu.fallbackReason,
      }
    : {
        type: 'baidu-netdisk',
        url: baidu.urlWithPassword,
        password: baidu.password,
      }

  return {
    schemaVersion: 1,
    product: 'Mita',
    channel: 'stable',
    tagName,
    version: String(tagName).replace(/^v/, ''),
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    publishedAt: release.publishedAt ?? release.published_at ?? null,
    releaseUrl,
    primaryDownload,
    baidu,
    github: {
      macosDmg: normalizeAsset(assets.macosDmg),
      windowsExe: normalizeAsset(assets.windowsExe),
      windowsMsi: normalizeAsset(assets.windowsMsi),
    },
  }
}

export function buildDownloadPage(manifest) {
  const downloadUrl = manifest.primaryDownload?.url ?? manifest.baidu?.url
  const password = manifest.primaryDownload?.password ?? manifest.baidu?.password ?? ''
  const isBaidu = manifest.primaryDownload?.type === 'baidu-netdisk'
  const escapedUrl = escapeHtml(downloadUrl)
  const escapedPassword = escapeHtml(password)
  const jsonUrl = JSON.stringify(downloadUrl)
  const downloadLabel = isBaidu ? 'Baidu Netdisk' : 'GitHub Release'
  const passwordMarkup = password
    ? `<p>Extraction code: <code>${escapedPassword}</code></p>`
    : ''

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="0; url=${escapedUrl}">
  <title>Mita Download</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 40px; line-height: 1.6; color: #111827; }
    a { color: #2563eb; }
    code { border-radius: 6px; background: #f3f4f6; padding: 2px 6px; }
  </style>
</head>
<body>
  <p>Opening ${downloadLabel} download...</p>
  <p><a href="${escapedUrl}" rel="noopener noreferrer">Open ${downloadLabel}</a></p>
  ${passwordMarkup}
  <script>
    window.location.replace(${jsonUrl});
  </script>
</body>
</html>
`
}

export function writeDownloadManifest(manifest, outputFile) {
  ensureDirectory(outputFile)
  fs.writeFileSync(outputFile, `${JSON.stringify(manifest, null, 2)}\n`)
}

export function writeDownloadPage(page, outputFile) {
  ensureDirectory(outputFile)
  fs.writeFileSync(outputFile, page)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const releaseJson = args['release-json']
  const baiduJson = args['baidu-json']
  const manifestOutput = args['manifest-output'] ?? 'dist/mita-download-manifest.json'
  const pageOutput = args['page-output'] ?? 'dist/mita-download.html'

  if (!releaseJson) throw new Error('--release-json is required')
  if (!baiduJson) throw new Error('--baidu-json is required')

  const manifest = buildDownloadManifest(readJson(releaseJson), readJson(baiduJson))
  writeDownloadManifest(manifest, manifestOutput)
  writeDownloadPage(buildDownloadPage(manifest), pageOutput)

  console.log(`Wrote Mita download manifest to ${manifestOutput}`)
  console.log(`Wrote Mita download page to ${pageOutput}`)
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
