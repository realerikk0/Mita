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

function normalizeAsset(asset) {
  if (!asset) return null
  return {
    name: asset.name,
    downloadUrl: asset.downloadUrl ?? asset.url ?? asset.browser_download_url ?? null,
    size: asset.size ?? null,
  }
}

function trimSlashes(value) {
  return String(value ?? '').replace(/^\/+|\/+$/g, '')
}

function joinUrl(baseUrl, ...parts) {
  const base = String(baseUrl ?? '').replace(/\/+$/g, '')
  const path = parts
    .flatMap((part) => trimSlashes(part).split('/'))
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/')
  return path ? `${base}/${path}` : base
}

function buildCdnAsset(asset, options = {}) {
  if (!asset || !options.cdnBaseUrl || !options.downloadVersionRoot) {
    return null
  }

  return {
    name: asset.name,
    url: joinUrl(options.cdnBaseUrl, options.downloadVersionRoot, asset.name),
    size: asset.size ?? null,
  }
}

export function buildDownloadManifest(release, options = {}) {
  const tagName = release.tagName ?? release.tag_name
  const releaseUrl = release.url ?? release.html_url ?? release.htmlUrl ?? null

  if (!tagName) {
    throw new Error('Release manifest is missing tagName')
  }

  const assets = release.assets ?? {}
  const cdnBaseUrl = options.cdnBaseUrl ?? null
  const downloadVersionRoot =
    options.downloadVersionRoot ?? (cdnBaseUrl ? `mita/download/releases/${tagName}` : null)
  const platforms = cdnBaseUrl
    ? {
        macos: buildCdnAsset(assets.macosDmg, {
          cdnBaseUrl,
          downloadVersionRoot,
        }),
        windows: buildCdnAsset(assets.windowsExe, {
          cdnBaseUrl,
          downloadVersionRoot,
        }),
        windowsMsi: buildCdnAsset(assets.windowsMsi, {
          cdnBaseUrl,
          downloadVersionRoot,
        }),
      }
    : undefined
  const primaryDownload = cdnBaseUrl
    ? {
        type: 'aliyun-cdn',
        url: options.downloadPageUrl ?? platforms?.windows?.url ?? platforms?.macos?.url ?? releaseUrl,
        password: null,
      }
    : {
        type: 'github-release',
        url: releaseUrl,
        password: null,
      }

  return {
    schemaVersion: cdnBaseUrl ? 2 : 1,
    product: 'Biyan',
    channel: 'stable',
    tagName,
    version: String(tagName).replace(/^v/, ''),
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    publishedAt: release.publishedAt ?? release.published_at ?? null,
    releaseUrl,
    downloadPageUrl: options.downloadPageUrl ?? null,
    primaryDownload,
    platforms,
    github: {
      macosDmg: normalizeAsset(assets.macosDmg),
      windowsExe: normalizeAsset(assets.windowsExe),
      windowsMsi: normalizeAsset(assets.windowsMsi),
    },
  }
}

export function buildDownloadPage(manifest) {
  const macosUrl = manifest.platforms?.macos?.url
  const windowsUrl = manifest.platforms?.windows?.url
  const fallbackPlatformUrl = windowsUrl ?? macosUrl
  const downloadUrl = fallbackPlatformUrl ?? manifest.primaryDownload?.url
  const password = manifest.primaryDownload?.password ?? ''
  const escapedUrl = escapeHtml(downloadUrl)
  const escapedMacosUrl = escapeHtml(macosUrl)
  const escapedWindowsUrl = escapeHtml(windowsUrl)
  const escapedPassword = escapeHtml(password)
  const jsonUrl = JSON.stringify(downloadUrl)
  const jsonMacosUrl = JSON.stringify(macosUrl)
  const jsonWindowsUrl = JSON.stringify(windowsUrl)
  const hasPlatformRouting = Boolean(manifest.platforms)
  const downloadLabel = hasPlatformRouting ? 'Biyan' : 'GitHub Release'
  const metaRefresh = hasPlatformRouting
    ? ''
    : `  <meta http-equiv="refresh" content="0; url=${escapedUrl}">\n`
  const passwordMarkup = password
    ? `<p>Extraction code: <code>${escapedPassword}</code></p>`
    : ''
  const platformButtons = hasPlatformRouting
    ? `<p>
    ${macosUrl ? `<a href="${escapedMacosUrl}" rel="noopener noreferrer">Download for macOS</a>` : ''}
    ${windowsUrl ? `${macosUrl ? ' · ' : ''}<a href="${escapedWindowsUrl}" rel="noopener noreferrer">Download for Windows</a>` : ''}
  </p>`
    : ''

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
${metaRefresh}  <title>Biyan Download</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 40px; line-height: 1.6; color: #111827; }
    a { color: #2563eb; }
    code { border-radius: 6px; background: #f3f4f6; padding: 2px 6px; }
  </style>
</head>
<body>
  <p>Opening ${downloadLabel} download...</p>
  <p><a href="${escapedUrl}" rel="noopener noreferrer">Open ${downloadLabel}</a></p>
  ${platformButtons}
  ${passwordMarkup}
  <script>
    const macosUrl = ${jsonMacosUrl};
    const windowsUrl = ${jsonWindowsUrl};
    const fallbackUrl = ${jsonUrl};
    const platformUrl = /Macintosh|Mac OS X/i.test(navigator.userAgent)
      ? macosUrl
      : /Windows/i.test(navigator.userAgent)
        ? windowsUrl
        : fallbackUrl;
    window.location.replace(platformUrl || fallbackUrl);
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
  const manifestOutput = args['manifest-output'] ?? 'dist/biyan-download-manifest.json'
  const pageOutput = args['page-output'] ?? 'dist/biyan-download.html'
  const cdnBaseUrl = args['cdn-base-url']
  const downloadVersionRoot = args['download-version-root']
  const downloadPageUrl = args['download-page-url']

  if (!releaseJson) throw new Error('--release-json is required')

  const manifest = buildDownloadManifest(readJson(releaseJson), {
    cdnBaseUrl,
    downloadVersionRoot,
    downloadPageUrl,
  })
  writeDownloadManifest(manifest, manifestOutput)
  writeDownloadPage(buildDownloadPage(manifest), pageOutput)

  console.log(`Wrote Biyan download manifest to ${manifestOutput}`)
  console.log(`Wrote Biyan download page to ${pageOutput}`)
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
