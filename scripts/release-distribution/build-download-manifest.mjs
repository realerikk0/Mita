#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CANONICAL_DOWNLOAD_ORIGIN = 'https://static.mitapp.cn'

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
    downloadUrl:
      asset.downloadUrl ?? asset.url ?? asset.browser_download_url ?? null,
    size: asset.size ?? null,
    digest: asset.digest ?? null,
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
    digest: asset.digest ?? null,
  }
}

export function buildDownloadManifest(release, options = {}) {
  const tagName = release.tagName ?? release.tag_name
  const releaseUrl = release.url ?? release.html_url ?? release.htmlUrl ?? null

  const tagMatch = /^v(\d+\.\d+\.\d+)$/.exec(tagName ?? '')
  if (!tagMatch) {
    throw new Error(
      `Release manifest has an invalid stable tagName: ${tagName}`
    )
  }
  const version = tagMatch[1]

  const assets = release.assets ?? {}
  const cdnBaseUrl = options.cdnBaseUrl ?? null
  const downloadVersionRoot =
    options.downloadVersionRoot ??
    (cdnBaseUrl ? `biyan/download/releases/${tagName}` : null)
  if (cdnBaseUrl) {
    let parsedCdn
    try {
      parsedCdn = new URL(cdnBaseUrl)
    } catch {
      throw new Error(`CDN base URL is invalid: ${cdnBaseUrl}`)
    }
    if (
      parsedCdn.origin !== CANONICAL_DOWNLOAD_ORIGIN ||
      parsedCdn.username ||
      parsedCdn.password ||
      parsedCdn.pathname !== '/' ||
      parsedCdn.search ||
      parsedCdn.hash ||
      String(cdnBaseUrl) !== CANONICAL_DOWNLOAD_ORIGIN
    ) {
      throw new Error(
        `CDN base URL must be exactly ${CANONICAL_DOWNLOAD_ORIGIN}: ${cdnBaseUrl}`
      )
    }
    if (downloadVersionRoot !== `biyan/download/releases/${tagName}`) {
      throw new Error(
        `Download version root must be biyan/download/releases/${tagName}`
      )
    }
    if (
      options.downloadPageUrl !==
      `${String(cdnBaseUrl).replace(/\/+$/, '')}/biyan/download`
    ) {
      throw new Error(
        'Download page URL must use the canonical biyan/download root'
      )
    }
    for (const key of [
      'macosDmg',
      'windowsExe',
      'windowsMsi',
      'linuxAppImage',
      'linuxDeb',
    ]) {
      if (
        !assets[key]?.name ||
        !assets[key]?.downloadUrl ||
        !/^sha256:[0-9a-f]{64}$/.test(assets[key]?.digest ?? '')
      ) {
        throw new Error(`CDN download manifest is missing ${key}`)
      }
    }
    const expectedSchema = { A: 1, B: 2, C: 3 }[
      release.provenance?.migrationPhase
    ]
    if (
      release.provenance?.schema !== 1 ||
      !/^[0-9a-f]{40}$/.test(release.provenance?.sourceCommit ?? '') ||
      release.provenance?.dataSchema !== expectedSchema ||
      !/^[0-9a-f]{64}$/.test(release.provenance?.candidateManifestSha256 ?? '')
    ) {
      throw new Error(
        'CDN download manifest requires verified candidate provenance'
      )
    }
  }
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
        linuxAppImage: buildCdnAsset(assets.linuxAppImage, {
          cdnBaseUrl,
          downloadVersionRoot,
        }),
        linuxDeb: buildCdnAsset(assets.linuxDeb, {
          cdnBaseUrl,
          downloadVersionRoot,
        }),
      }
    : undefined
  const primaryDownload = cdnBaseUrl
    ? {
        type: 'aliyun-cdn',
        url:
          options.downloadPageUrl ??
          platforms?.windows?.url ??
          platforms?.macos?.url ??
          releaseUrl,
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
    version,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    publishedAt: release.publishedAt ?? release.published_at ?? null,
    releaseUrl,
    downloadPageUrl: options.downloadPageUrl ?? null,
    primaryDownload,
    platforms,
    provenance: release.provenance ?? null,
    github: {
      macosDmg: normalizeAsset(assets.macosDmg),
      windowsExe: normalizeAsset(assets.windowsExe),
      windowsMsi: normalizeAsset(assets.windowsMsi),
      linuxAppImage: normalizeAsset(assets.linuxAppImage),
      linuxDeb: normalizeAsset(assets.linuxDeb),
    },
  }
}

export function buildDownloadPage(manifest) {
  const macosUrl = manifest.platforms?.macos?.url
  const windowsUrl = manifest.platforms?.windows?.url
  const linuxAppImageUrl = manifest.platforms?.linuxAppImage?.url
  const linuxDebUrl = manifest.platforms?.linuxDeb?.url
  const fallbackPlatformUrl =
    windowsUrl ?? macosUrl ?? linuxAppImageUrl ?? linuxDebUrl
  const downloadUrl = fallbackPlatformUrl ?? manifest.primaryDownload?.url
  const password = manifest.primaryDownload?.password ?? ''
  const escapedUrl = escapeHtml(downloadUrl)
  const escapedMacosUrl = escapeHtml(macosUrl)
  const escapedWindowsUrl = escapeHtml(windowsUrl)
  const escapedPassword = escapeHtml(password)
  const jsonUrl = JSON.stringify(downloadUrl)
  const jsonMacosUrl = JSON.stringify(macosUrl)
  const jsonWindowsUrl = JSON.stringify(windowsUrl)
  const jsonLinuxUrl = JSON.stringify(linuxAppImageUrl ?? linuxDebUrl)
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
    ${linuxAppImageUrl ? `${macosUrl || windowsUrl ? ' · ' : ''}<a href="${escapeHtml(linuxAppImageUrl)}" rel="noopener noreferrer">Download AppImage</a>` : ''}
    ${linuxDebUrl ? `${macosUrl || windowsUrl || linuxAppImageUrl ? ' · ' : ''}<a href="${escapeHtml(linuxDebUrl)}" rel="noopener noreferrer">Download DEB</a>` : ''}
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
    const linuxUrl = ${jsonLinuxUrl};
    const fallbackUrl = ${jsonUrl};
    const platformUrl = /Macintosh|Mac OS X/i.test(navigator.userAgent)
      ? macosUrl
      : /Windows/i.test(navigator.userAgent)
        ? windowsUrl
        : /Linux|X11/i.test(navigator.userAgent)
          ? linuxUrl
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
  const manifestOutput =
    args['manifest-output'] ?? 'dist/biyan-download-manifest.json'
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

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
