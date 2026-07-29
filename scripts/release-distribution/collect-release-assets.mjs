#!/usr/bin/env node
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { validateActiveReleaseIdentity } from '../ci/release-policy-contracts.mjs'
import {
  decodeUpdaterPublicKey,
  verifyUpdaterSignature,
} from '../updater/minisign-policy.mjs'
import { validateReleaseNotesProductPolicy } from './build-release-notes.mjs'

const RELEASE_TRAIN_POLICY = JSON.parse(
  fs.readFileSync(
    new URL('../ci/release-train-policy.json', import.meta.url),
    'utf8'
  )
)

const REQUIRED_ASSETS = [
  {
    key: 'macosDmg',
    label: 'macOS DMG',
    extension: '.dmg',
    name: (version) => `Biyan_${version}_universal.dmg`,
  },
  {
    key: 'windowsExe',
    label: 'Windows EXE',
    extension: '.exe',
    name: (version) => `Biyan_${version}_x64-setup.exe`,
  },
  {
    key: 'windowsMsi',
    label: 'Windows MSI',
    extension: '.msi',
    name: (version) => `Biyan_${version}_x64_en-US.msi`,
  },
  {
    key: 'linuxAppImage',
    label: 'Linux AppImage',
    extension: '.AppImage',
    name: (version) => `Biyan_${version}_amd64.AppImage`,
  },
  {
    key: 'linuxDeb',
    label: 'Linux DEB',
    extension: '.deb',
    name: (version) => `Biyan_${version}_amd64.deb`,
  },
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
    asset.browser_download_url ??
    asset.browserDownloadUrl ??
    asset.downloadUrl ??
    asset.url
  if (!asset.name || !downloadUrl) {
    throw new Error(
      `Release asset is missing name or download URL: ${JSON.stringify(asset)}`
    )
  }

  const size = Number(asset.size)
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new Error(`Release asset has an invalid size: ${asset.name}`)
  }

  return {
    name: asset.name,
    downloadUrl,
    size,
    digest: asset.digest ?? null,
    contentType: asset.content_type ?? asset.contentType ?? null,
  }
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function readRequiredJson(file, label) {
  if (!file || !fs.existsSync(file)) {
    throw new Error(`${label} is missing: ${file ?? 'unspecified'}`)
  }
  try {
    return readJson(file)
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`)
  }
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value ?? {}).sort()
  const wanted = [...expected].sort()
  if (actual.join('\0') !== wanted.join('\0')) {
    throw new Error(
      `${label} set mismatch: expected ${wanted.join(', ')}, found ${actual.join(', ') || 'none'}`
    )
  }
}

function assertDownloadedAsset(asset, assetsDir) {
  const assetPath = path.join(assetsDir, asset.name)
  if (!fs.existsSync(assetPath) || !fs.statSync(assetPath).isFile()) {
    throw new Error(`Downloaded asset is missing: ${assetPath}`)
  }
  if (fs.statSync(assetPath).size !== asset.size) {
    throw new Error(
      `Downloaded asset size mismatch for ${asset.name}: expected ${asset.size}, found ${fs.statSync(assetPath).size}`
    )
  }
  const digest = /^sha256:([0-9a-f]{64})$/.exec(asset.digest ?? '')
  if (!digest) {
    throw new Error(
      `Release asset is missing a GitHub SHA-256 digest: ${asset.name}`
    )
  }
  if (sha256(assetPath) !== digest[1]) {
    throw new Error(`Downloaded asset digest mismatch: ${asset.name}`)
  }
  return assetPath
}

function assertGitHubAssetUrl(asset, tagName) {
  let parsed
  try {
    parsed = new URL(asset.downloadUrl)
  } catch {
    throw new Error(`Release asset has an invalid download URL: ${asset.name}`)
  }
  const expectedPath = `/realerikk0/Mita/releases/download/${tagName}/${asset.name}`
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== 'github.com' ||
    decodeURIComponent(parsed.pathname) !== expectedPath ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(
      `Release asset URL must be the canonical GitHub release URL for ${asset.name}`
    )
  }
}

function parseChecksums(file) {
  const entries = new Map()
  const lines = fs
    .readFileSync(file, 'utf8')
    .replace(/\r\n?/g, '\n')
    .split('\n')
  for (const [index, line] of lines.entries()) {
    if (!line) continue
    const match = /^([0-9a-f]{64}) [ *]([^/\\]+)$/.exec(line)
    if (!match) {
      throw new Error(`Invalid SHA256SUMS line ${index + 1}: ${line}`)
    }
    const [, hash, name] = match
    if (entries.has(name)) {
      throw new Error(`Duplicate SHA256SUMS entry: ${name}`)
    }
    entries.set(name, hash)
  }
  return entries
}

function candidateReleaseFileNames(version) {
  const macosDmg = `Biyan_${version}_universal.dmg`
  const windowsExe = `Biyan_${version}_x64-setup.exe`
  const windowsMsi = `Biyan_${version}_x64_en-US.msi`
  const linuxAppImage = `Biyan_${version}_amd64.AppImage`
  const linuxDeb = `Biyan_${version}_amd64.deb`
  return [
    'Biyan.app.tar.gz',
    'Biyan.app.tar.gz.sig',
    macosDmg,
    windowsExe,
    `${windowsExe}.sig`,
    windowsMsi,
    linuxAppImage,
    `${linuxAppImage}.sig`,
    linuxDeb,
    'candidate.json',
    'candidate.json.sig',
    'latest.json',
    'SHA256SUMS',
  ]
}

function assertExactReleaseAssetNames(assets, version) {
  const expected = candidateReleaseFileNames(version)
  const expectedSet = new Set(expected)
  const counts = new Map()
  for (const { name } of assets) {
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  const missing = expected.filter((name) => !counts.has(name))
  const extra = [...counts.keys()]
    .filter((name) => !expectedSet.has(name))
    .sort()
  const duplicate = [...counts]
    .filter(([, count]) => count !== 1)
    .map(([name, count]) => `${name} (${count})`)
    .sort()
  if (missing.length || extra.length || duplicate.length) {
    throw new Error(
      [
        'Release asset name set mismatch',
        `expected exactly ${expected.length} reviewed files`,
        `missing: ${missing.join(', ') || 'none'}`,
        `extra: ${extra.join(', ') || 'none'}`,
        `duplicate: ${duplicate.join(', ') || 'none'}`,
      ].join('; ')
    )
  }
}

function assertHttpsAssetUrl(url, objectKey, label) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`${label} has an invalid URL: ${url}`)
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname) {
    throw new Error(`${label} must use HTTPS: ${url}`)
  }
  if (!decodeURIComponent(parsed.pathname).endsWith(`/${objectKey}`)) {
    throw new Error(
      `${label} URL does not match objectKey ${objectKey}: ${url}`
    )
  }
}

export function validateCandidateProvenance(
  candidateDir,
  {
    tagName,
    version,
    expectedSourceCommit,
    releaseMetadata,
    tauriConfig,
    cargoLock,
    releasePublishedAt,
    trainPolicy = RELEASE_TRAIN_POLICY,
  } = {}
) {
  if (!candidateDir || !fs.existsSync(candidateDir)) {
    throw new Error(
      `Candidate directory is missing: ${candidateDir ?? 'unspecified'}`
    )
  }
  if (!/^[0-9a-f]{40}$/.test(expectedSourceCommit ?? '')) {
    throw new Error(
      `Expected source commit is invalid: ${expectedSourceCommit}`
    )
  }
  if (releaseMetadata?.schema !== 1) {
    throw new Error('Tagged biyan-release.json must use schema 1')
  }
  const expectedSchema = { A: 1, B: 2, C: 3 }[releaseMetadata?.migrationPhase]
  if (!expectedSchema || releaseMetadata.dataSchema !== expectedSchema) {
    throw new Error(
      `Tagged release phase/schema is invalid: ${releaseMetadata?.migrationPhase}/${releaseMetadata?.dataSchema}`
    )
  }
  if (tauriConfig?.version !== version) {
    throw new Error(
      `Tagged Tauri version ${tauriConfig?.version ?? 'missing'} does not match release ${version}`
    )
  }
  const cargoLockVersion = String(cargoLock ?? '').match(
    /^name\s*=\s*"Biyan"\s*\nversion\s*=\s*"([^"]+)"/m
  )?.[1]
  const identityFailures = validateActiveReleaseIdentity({
    version,
    migrationPhase: releaseMetadata.migrationPhase,
    dataSchema: releaseMetadata.dataSchema,
    cargoLockVersion,
    trainPolicy,
  })
  if (identityFailures.length) {
    throw new Error(
      `Tagged release identity is invalid: ${identityFailures.join('; ')}`
    )
  }
  const terminalRelease = trainPolicy.activeTerminalRelease
  if (terminalRelease !== null && terminalRelease !== undefined) {
    if (
      tagName !== terminalRelease.tag ||
      expectedSourceCommit !== terminalRelease.sourceCommit
    ) {
      throw new Error(
        `Candidate ${tagName}/${expectedSourceCommit} does not match the active terminal release ${terminalRelease.tag}/${terminalRelease.sourceCommit}`
      )
    }
  }
  const updaterPublicKey = decodeUpdaterPublicKey(
    tauriConfig?.plugins?.updater?.pubkey
  )

  const candidatePath = path.join(candidateDir, 'candidate.json')
  const candidateSignaturePath = path.join(candidateDir, 'candidate.json.sig')
  const manifestPath = path.join(candidateDir, 'latest.json')
  const checksumsPath = path.join(candidateDir, 'SHA256SUMS')
  const candidate = readRequiredJson(candidatePath, 'candidate.json')
  const manifest = readRequiredJson(manifestPath, 'latest.json')
  if (
    !fs.existsSync(candidateSignaturePath) ||
    !fs.statSync(candidateSignaturePath).isFile()
  ) {
    throw new Error('candidate.json.sig is missing')
  }
  verifyUpdaterSignature(
    candidatePath,
    fs.readFileSync(candidateSignaturePath, 'utf8').trim(),
    updaterPublicKey,
    'candidate.json provenance'
  )

  if (candidate.schema !== 1) {
    throw new Error(`Candidate schema must be 1, found ${candidate.schema}`)
  }
  if (candidate.tag !== tagName || candidate.tag !== `v${candidate.version}`) {
    throw new Error(
      `Candidate tag/version mismatch: ${candidate.tag}/${candidate.version}`
    )
  }
  if (candidate.version !== version) {
    throw new Error(
      `Candidate version ${candidate.version} does not match release ${version}`
    )
  }
  if (candidate.sourceCommit !== expectedSourceCommit) {
    throw new Error(
      `Candidate source commit ${candidate.sourceCommit} does not match tag commit ${expectedSourceCommit}`
    )
  }
  if (
    candidate.migrationPhase !== releaseMetadata.migrationPhase ||
    candidate.dataSchema !== releaseMetadata.dataSchema
  ) {
    throw new Error(
      `Candidate phase/schema ${candidate.migrationPhase}/${candidate.dataSchema} does not match tagged metadata ${releaseMetadata.migrationPhase}/${releaseMetadata.dataSchema}`
    )
  }
  if (
    candidate.manifestFile !== 'latest.json' ||
    candidate.manifestKey !== `biyan/updater/releases/v${version}/latest.json`
  ) {
    throw new Error(
      'Candidate manifest path is not the immutable Biyan version path'
    )
  }
  if (
    !/^[0-9a-f]{64}$/.test(candidate.manifestSha256 ?? '') ||
    sha256(manifestPath) !== candidate.manifestSha256
  ) {
    throw new Error('Candidate manifest hash mismatch')
  }
  if (
    manifest.version !== version ||
    manifest.sourceCommit !== expectedSourceCommit ||
    manifest.migrationPhase !== releaseMetadata.migrationPhase ||
    manifest.dataSchema !== releaseMetadata.dataSchema ||
    manifest.pub_date !== candidate.publishedAt
  ) {
    throw new Error(
      'Updater manifest release attestation does not match candidate'
    )
  }
  if (
    !Number.isFinite(Date.parse(candidate.publishedAt ?? '')) ||
    !Number.isFinite(Date.parse(releasePublishedAt ?? '')) ||
    Date.parse(candidate.publishedAt) > Date.parse(releasePublishedAt)
  ) {
    throw new Error(
      'Candidate/release publication timestamps are invalid or out of order'
    )
  }

  const expectedCandidateAssets = new Map([
    [
      'darwin-universal',
      {
        file: 'Biyan.app.tar.gz',
        signatureFile: 'Biyan.app.tar.gz.sig',
      },
    ],
    [
      'windows-x86_64',
      {
        file: `Biyan_${version}_x64-setup.exe`,
        signatureFile: `Biyan_${version}_x64-setup.exe.sig`,
      },
    ],
    [
      'linux-x86_64',
      {
        file: `Biyan_${version}_amd64.AppImage`,
        signatureFile: `Biyan_${version}_amd64.AppImage.sig`,
      },
    ],
  ])
  if (
    !Array.isArray(candidate.assets) ||
    candidate.assets.length !== expectedCandidateAssets.size
  ) {
    throw new Error(
      'Candidate platform set is incomplete or contains duplicates'
    )
  }
  const candidateAssetsByPlatform = new Map()
  for (const asset of candidate.assets) {
    if (candidateAssetsByPlatform.has(asset.platform)) {
      throw new Error(`Duplicate candidate platform: ${asset.platform}`)
    }
    candidateAssetsByPlatform.set(asset.platform, asset)
  }
  assertExactKeys(
    Object.fromEntries(candidateAssetsByPlatform),
    expectedCandidateAssets.keys(),
    'Candidate platform'
  )

  for (const [platform, expected] of expectedCandidateAssets) {
    const asset = candidateAssetsByPlatform.get(platform)
    if (
      asset.file !== expected.file ||
      asset.signatureFile !== expected.signatureFile
    ) {
      throw new Error(
        `Unexpected ${platform} updater files: ${asset.file}/${asset.signatureFile}`
      )
    }
    const expectedObjectKey = `biyan/updater/releases/v${version}/${asset.file}`
    if (asset.objectKey !== expectedObjectKey) {
      throw new Error(
        `${platform} updater objectKey is not immutable: ${asset.objectKey}`
      )
    }
    assertHttpsAssetUrl(
      asset.url,
      expectedObjectKey,
      `${platform} updater asset`
    )

    const assetPath = path.join(candidateDir, asset.file)
    const signaturePath = path.join(candidateDir, asset.signatureFile)
    for (const file of [assetPath, signaturePath]) {
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
        throw new Error(`Candidate file is missing: ${file}`)
      }
    }
    const signature = fs.readFileSync(signaturePath, 'utf8').trim()
    if (!signature) {
      throw new Error(`Updater signature is empty: ${asset.signatureFile}`)
    }
    if (sha256(assetPath) !== asset.sha256) {
      throw new Error(`Candidate asset hash mismatch: ${asset.file}`)
    }
    if (sha256(signaturePath) !== asset.signatureSha256) {
      throw new Error(
        `Candidate signature hash mismatch: ${asset.signatureFile}`
      )
    }
    verifyUpdaterSignature(
      assetPath,
      signature,
      updaterPublicKey,
      `${platform} ${asset.file}`
    )
  }

  const expectedManifestPlatforms = {
    'darwin-aarch64': 'darwin-universal',
    'darwin-x86_64': 'darwin-universal',
    'windows-x86_64': 'windows-x86_64',
    'linux-x86_64': 'linux-x86_64',
  }
  assertExactKeys(
    manifest.platforms,
    Object.keys(expectedManifestPlatforms),
    'Updater manifest platform'
  )
  for (const [platform, candidatePlatform] of Object.entries(
    expectedManifestPlatforms
  )) {
    const manifestAsset = manifest.platforms[platform]
    const candidateAsset = candidateAssetsByPlatform.get(candidatePlatform)
    const signature = fs
      .readFileSync(
        path.join(candidateDir, candidateAsset.signatureFile),
        'utf8'
      )
      .trim()
    if (
      manifestAsset?.url !== candidateAsset.url ||
      manifestAsset?.signature !== signature
    ) {
      throw new Error(
        `Updater manifest platform does not match candidate: ${platform}`
      )
    }
  }

  const expectedDistributionAssets = new Map(
    REQUIRED_ASSETS.map((asset) => [asset.key, asset.name(version)])
  )
  assertExactKeys(
    candidate.distributionAssets,
    expectedDistributionAssets.keys(),
    'Candidate distribution asset'
  )
  for (const [key, expectedFile] of expectedDistributionAssets) {
    const asset = candidate.distributionAssets[key]
    assertExactKeys(asset, ['file', 'sha256'], `${key} distribution metadata`)
    if (asset?.file !== expectedFile) {
      throw new Error(
        `Unexpected ${key} distribution filename: ${asset?.file ?? 'missing'}`
      )
    }
    const assetPath = path.join(candidateDir, asset.file)
    if (
      !/^[0-9a-f]{64}$/.test(asset.sha256 ?? '') ||
      !fs.existsSync(assetPath) ||
      !fs.statSync(assetPath).isFile() ||
      sha256(assetPath) !== asset.sha256
    ) {
      throw new Error(
        `Candidate distribution asset hash mismatch: ${asset.file}`
      )
    }
  }

  const checksumEntries = parseChecksums(checksumsPath)
  const expectedChecksummedFiles = candidateReleaseFileNames(version).filter(
    (name) => name !== 'SHA256SUMS'
  )
  assertExactKeys(
    Object.fromEntries(checksumEntries),
    expectedChecksummedFiles,
    'SHA256SUMS file'
  )
  for (const [name, expectedHash] of checksumEntries) {
    const file = path.join(candidateDir, name)
    if (!fs.existsSync(file) || sha256(file) !== expectedHash) {
      throw new Error(`SHA256SUMS mismatch: ${name}`)
    }
  }

  return {
    schema: candidate.schema,
    sourceCommit: candidate.sourceCommit,
    migrationPhase: candidate.migrationPhase,
    dataSchema: candidate.dataSchema,
    candidateManifestSha256: candidate.manifestSha256,
  }
}

export function collectReleaseAssets(release, options = {}) {
  const tagName = release.tagName ?? release.tag_name ?? process.env.RELEASE_TAG
  const releaseUrl = release.url ?? release.html_url ?? release.htmlUrl
  const assets = (release.assets ?? []).map(normalizeAsset)

  const tagMatch = /^v(\d+\.\d+\.\d+)$/.exec(tagName ?? '')
  if (!tagMatch) {
    throw new Error(
      `Release tagName must be a stable vMAJOR.MINOR.PATCH tag: ${tagName}`
    )
  }
  const version = tagMatch[1]
  if (!releaseUrl) {
    throw new Error('Release URL is required')
  }
  if (
    releaseUrl !== `https://github.com/realerikk0/Mita/releases/tag/${tagName}`
  ) {
    throw new Error(
      'Release URL does not match the canonical repository and tag'
    )
  }
  if ((release.isDraft ?? release.draft) !== false) {
    throw new Error('Release must be published and non-draft')
  }
  if ((release.isPrerelease ?? release.prerelease) !== false) {
    throw new Error('Release must not be a prerelease')
  }
  if (
    !Number.isFinite(
      Date.parse(release.publishedAt ?? release.published_at ?? '')
    )
  ) {
    throw new Error('Release publishedAt is required and must be valid')
  }
  if ((release.name ?? '') !== `Biyan ${tagName}`) {
    throw new Error(`Release name must be exactly "Biyan ${tagName}"`)
  }
  validateReleaseNotesProductPolicy(release.body ?? release.description ?? '')

  const selected = {}
  for (const assetType of REQUIRED_ASSETS) {
    const expectedName = assetType.name(version)
    const matches = assets.filter((asset) =>
      asset.name.endsWith(assetType.extension)
    )

    if (matches.length !== 1 || matches[0].name !== expectedName) {
      const names = matches.map((asset) => asset.name).join(', ') || 'none'
      throw new Error(
        `Expected exactly one ${assetType.label} asset named ${expectedName}, found ${matches.length}: ${names}`
      )
    }

    selected[assetType.key] = matches[0]
    assertGitHubAssetUrl(matches[0], tagName)
  }

  if (options.assetsDir) {
    assertExactReleaseAssetNames(assets, version)
    for (const name of candidateReleaseFileNames(version)) {
      const matchingAssets = assets.filter((asset) => asset.name === name)
      if (matchingAssets.length !== 1) {
        throw new Error(
          `Expected exactly one release asset named ${name}, found ${matchingAssets.length}`
        )
      }
      assertGitHubAssetUrl(matchingAssets[0], tagName)
      assertDownloadedAsset(matchingAssets[0], options.assetsDir)
    }
  }

  let provenance = null
  if (options.candidateDir) {
    provenance = validateCandidateProvenance(options.candidateDir, {
      tagName,
      version,
      expectedSourceCommit: options.expectedSourceCommit,
      releaseMetadata: options.releaseMetadata,
      tauriConfig: options.tauriConfig,
      cargoLock: options.cargoLock,
      releasePublishedAt: release.publishedAt ?? release.published_at,
      trainPolicy: options.trainPolicy,
    })
  }

  return {
    tagName,
    version,
    name: release.name,
    url: releaseUrl,
    publishedAt: release.publishedAt ?? release.published_at ?? null,
    body: release.body ?? release.description ?? '',
    provenance,
    assets: selected,
    allAssets: assets,
  }
}

export function writeGitHubOutputs(
  manifest,
  outputFile = process.env.GITHUB_OUTPUT
) {
  if (!outputFile) return

  const lines = [
    `tag=${manifest.tagName}`,
    `release_url=${manifest.url}`,
    `macos_url=${manifest.assets.macosDmg.downloadUrl}`,
    `windows_exe_url=${manifest.assets.windowsExe.downloadUrl}`,
    `windows_msi_url=${manifest.assets.windowsMsi.downloadUrl}`,
    `linux_appimage_url=${manifest.assets.linuxAppImage.downloadUrl}`,
    `linux_deb_url=${manifest.assets.linuxDeb.downloadUrl}`,
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
  for (const required of [
    'assets-dir',
    'candidate-dir',
    'expected-source-commit',
    'tag-release-json',
    'tag-tauri-config',
    'tag-cargo-lock',
  ]) {
    if (!args[required]) {
      throw new Error(`--${required} is required`)
    }
  }

  const manifest = collectReleaseAssets(readJson(releaseJson), {
    assetsDir: args['assets-dir'],
    candidateDir: args['candidate-dir'],
    expectedSourceCommit: args['expected-source-commit'],
    releaseMetadata: readRequiredJson(
      args['tag-release-json'],
      'tagged biyan-release.json'
    ),
    tauriConfig: readRequiredJson(
      args['tag-tauri-config'],
      'tagged tauri.conf.json'
    ),
    cargoLock: fs.readFileSync(args['tag-cargo-lock'], 'utf8'),
  })

  writeManifest(manifest, output)
  writeGitHubOutputs(manifest)
  console.log(`Collected release assets for ${manifest.tagName}`)
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
