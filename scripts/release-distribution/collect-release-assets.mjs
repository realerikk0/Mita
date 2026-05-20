#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REQUIRED_ASSETS = [
  { key: 'macosDmg', label: 'macOS DMG', extension: '.dmg' },
  { key: 'windowsExe', label: 'Windows EXE', extension: '.exe' },
  { key: 'windowsMsi', label: 'Windows MSI', extension: '.msi' },
]

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`)
    }

    const key = arg.slice(2)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`)
    }

    args[key] = value
    index += 1
  }
  return args
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function ensureDirectory(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
}

function normalizeAsset(asset) {
  const downloadUrl =
    asset.browser_download_url ?? asset.browserDownloadUrl ?? asset.downloadUrl ?? asset.url
  if (!asset.name || !downloadUrl) {
    throw new Error(`Release asset is missing name or download URL: ${JSON.stringify(asset)}`)
  }

  return {
    name: asset.name,
    downloadUrl,
    size: asset.size ?? null,
    contentType: asset.content_type ?? asset.contentType ?? null,
  }
}

export function collectReleaseAssets(release, options = {}) {
  const tagName = release.tagName ?? release.tag_name ?? process.env.RELEASE_TAG
  const releaseUrl = release.url ?? release.html_url ?? release.htmlUrl
  const assets = (release.assets ?? []).map(normalizeAsset)

  if (!tagName) {
    throw new Error('Release tagName is required')
  }
  if (!releaseUrl) {
    throw new Error('Release URL is required')
  }

  const selected = {}
  for (const assetType of REQUIRED_ASSETS) {
    const matches = assets.filter((asset) =>
      asset.name.toLowerCase().endsWith(assetType.extension),
    )

    if (matches.length !== 1) {
      const names = matches.map((asset) => asset.name).join(', ') || 'none'
      throw new Error(
        `Expected exactly one ${assetType.label} asset (${assetType.extension}), found ${matches.length}: ${names}`,
      )
    }

    selected[assetType.key] = matches[0]
  }

  if (options.assetsDir) {
    for (const asset of Object.values(selected)) {
      const assetPath = path.join(options.assetsDir, asset.name)
      if (!fs.existsSync(assetPath)) {
        throw new Error(`Downloaded asset is missing: ${assetPath}`)
      }
    }
  }

  return {
    tagName,
    name: release.name ?? tagName,
    url: releaseUrl,
    publishedAt: release.publishedAt ?? release.published_at ?? null,
    body: release.body ?? release.description ?? '',
    assets: selected,
    allAssets: assets,
  }
}

export function writeGitHubOutputs(manifest, outputFile = process.env.GITHUB_OUTPUT) {
  if (!outputFile) return

  const lines = [
    `tag=${manifest.tagName}`,
    `release_url=${manifest.url}`,
    `macos_url=${manifest.assets.macosDmg.downloadUrl}`,
    `windows_exe_url=${manifest.assets.windowsExe.downloadUrl}`,
    `windows_msi_url=${manifest.assets.windowsMsi.downloadUrl}`,
  ]
  fs.appendFileSync(outputFile, `${lines.join('\n')}\n`)
}

export function writeManifest(manifest, outputFile) {
  ensureDirectory(outputFile)
  fs.writeFileSync(outputFile, `${JSON.stringify(manifest, null, 2)}\n`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const releaseJson = args['release-json']
  const output = args.output ?? 'dist/release-assets.json'

  if (!releaseJson) {
    throw new Error('--release-json is required')
  }

  const manifest = collectReleaseAssets(readJson(releaseJson), {
    assetsDir: args['assets-dir'],
  })

  writeManifest(manifest, output)
  writeGitHubOutputs(manifest)
  console.log(`Collected release assets for ${manifest.tagName}`)
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
