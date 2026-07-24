export const CANONICAL_UPDATER_ASSET_BASE_URL =
  'https://static.mitapp.cn'

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/
const SOURCE_COMMIT_PATTERN = /^[0-9a-f]{40}$/

function assertPlainObject(value, description) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new Error(`${description} must be an object`)
  }
}

function assertExactKeys(value, expected, description) {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    throw new Error(
      `${description} keys must be exactly ${wanted.join(', ')}; found ${
        actual.join(', ') || '(none)'
      }`
    )
  }
}

function assertVersion(version) {
  if (typeof version !== 'string' || !VERSION_PATTERN.test(version)) {
    throw new Error(`Invalid updater version: ${version ?? 'missing'}`)
  }
}

export function assertCanonicalUpdaterAssetBaseUrl(value) {
  if (value !== CANONICAL_UPDATER_ASSET_BASE_URL) {
    throw new Error(
      `Updater asset base URL must be exactly ${CANONICAL_UPDATER_ASSET_BASE_URL}`
    )
  }
  return value
}

export function expectedUpdaterArtifactName(platform, version) {
  assertVersion(version)
  if (platform === 'darwin-aarch64' || platform === 'darwin-x86_64') {
    return 'Biyan.app.tar.gz'
  }
  if (platform === 'windows-x86_64') {
    return `Biyan_${version}_x64-setup.exe`
  }
  if (platform === 'linux-x86_64') {
    return `Biyan_${version}_amd64.AppImage`
  }
  throw new Error(`Unsupported updater platform: ${platform}`)
}

export function canonicalUpdaterObjectKey(version, file) {
  assertVersion(version)
  if (
    typeof file !== 'string' ||
    !file ||
    file !== file.trim() ||
    file.includes('/') ||
    file.includes('\\') ||
    file === '.' ||
    file === '..'
  ) {
    throw new Error(`Invalid updater artifact filename: ${file ?? 'missing'}`)
  }
  return `biyan/updater/releases/v${version}/${file}`
}

export function canonicalUpdaterAssetUrl(version, file) {
  return `${CANONICAL_UPDATER_ASSET_BASE_URL}/${canonicalUpdaterObjectKey(
    version,
    file
  )}`
}

export function validateCanonicalUpdaterAsset({
  version,
  file,
  objectKey,
  url,
  description = 'Updater asset',
}) {
  const expectedKey = canonicalUpdaterObjectKey(version, file)
  const expectedUrl = canonicalUpdaterAssetUrl(version, file)
  if (objectKey !== expectedKey) {
    throw new Error(
      `${description} object key must be exactly ${expectedKey}; found ${objectKey}`
    )
  }
  if (url !== expectedUrl) {
    throw new Error(
      `${description} URL must be exactly ${expectedUrl}; found ${url}`
    )
  }
  return { objectKey: expectedKey, url: expectedUrl }
}

export function validateCanonicalUpdaterCandidateMetadata(candidate) {
  assertPlainObject(candidate, 'Updater candidate')
  assertExactKeys(
    candidate,
    [
      'schema',
      'tag',
      'version',
      'sourceCommit',
      'migrationPhase',
      'dataSchema',
      'publishedAt',
      'manifestFile',
      'manifestKey',
      'manifestSha256',
      'assets',
      'distributionAssets',
    ],
    'Updater candidate'
  )
  assertVersion(candidate.version)
  if (candidate.schema !== 1 || candidate.tag !== `v${candidate.version}`) {
    throw new Error('Updater candidate schema/tag/version is invalid')
  }
  if (
    typeof candidate.sourceCommit !== 'string' ||
    !SOURCE_COMMIT_PATTERN.test(candidate.sourceCommit)
  ) {
    throw new Error('Updater candidate sourceCommit must be a lowercase commit SHA')
  }
  const expectedSchema = { A: 1, B: 2, C: 3 }[candidate.migrationPhase]
  if (!expectedSchema || candidate.dataSchema !== expectedSchema) {
    throw new Error('Updater candidate migration phase/schema is invalid')
  }
  if (
    typeof candidate.publishedAt !== 'string' ||
    new Date(candidate.publishedAt).toISOString() !== candidate.publishedAt
  ) {
    throw new Error('Updater candidate publishedAt must be canonical ISO-8601')
  }
  if (
    candidate.manifestFile !== 'latest.json' ||
    candidate.manifestKey !==
      canonicalUpdaterObjectKey(candidate.version, 'latest.json')
  ) {
    throw new Error('Updater candidate manifest path must be canonical')
  }
  if (!/^[0-9a-f]{64}$/.test(candidate.manifestSha256 ?? '')) {
    throw new Error('Updater candidate manifest SHA-256 is invalid')
  }

  const expectedAssets = new Map([
    ['darwin-universal', 'Biyan.app.tar.gz'],
    [
      'windows-x86_64',
      `Biyan_${candidate.version}_x64-setup.exe`,
    ],
    ['linux-x86_64', `Biyan_${candidate.version}_amd64.AppImage`],
  ])
  if (
    !Array.isArray(candidate.assets) ||
    candidate.assets.length !== expectedAssets.size
  ) {
    throw new Error('Updater candidate asset set is incomplete')
  }
  const seen = new Set()
  for (const asset of candidate.assets) {
    assertPlainObject(asset, 'Updater candidate asset')
    assertExactKeys(
      asset,
      [
        'platform',
        'file',
        'signatureFile',
        'sha256',
        'signatureSha256',
        'objectKey',
        'url',
      ],
      'Updater candidate asset'
    )
    if (
      seen.has(asset.platform) ||
      expectedAssets.get(asset.platform) !== asset.file
    ) {
      throw new Error(
        `Unexpected updater candidate asset identity: ${asset.platform}/${asset.file}`
      )
    }
    seen.add(asset.platform)
    if (asset.signatureFile !== `${asset.file}.sig`) {
      throw new Error(
        `Updater candidate ${asset.platform} signature filename is invalid`
      )
    }
    if (
      !/^[0-9a-f]{64}$/.test(asset.sha256 ?? '') ||
      !/^[0-9a-f]{64}$/.test(asset.signatureSha256 ?? '')
    ) {
      throw new Error(
        `Updater candidate ${asset.platform} asset hashes are invalid`
      )
    }
    validateCanonicalUpdaterAsset({
      version: candidate.version,
      file: asset.file,
      objectKey: asset.objectKey,
      url: asset.url,
      description: `${asset.platform} updater asset`,
    })
  }
  return candidate
}

export function validateCanonicalUpdaterManifest(manifest, candidate) {
  assertPlainObject(manifest, 'Updater manifest')
  assertPlainObject(candidate, 'Updater candidate')
  assertExactKeys(
    manifest,
    [
      'version',
      'sourceCommit',
      'migrationPhase',
      'dataSchema',
      'notes',
      'pub_date',
      'platforms',
    ],
    'Updater manifest'
  )
  assertVersion(candidate.version)
  if (
    manifest.version !== candidate.version ||
    manifest.sourceCommit !== candidate.sourceCommit ||
    manifest.migrationPhase !== candidate.migrationPhase ||
    manifest.dataSchema !== candidate.dataSchema
  ) {
    throw new Error('Updater manifest release attestation does not match candidate')
  }
  if (
    typeof manifest.sourceCommit !== 'string' ||
    !SOURCE_COMMIT_PATTERN.test(manifest.sourceCommit)
  ) {
    throw new Error('Updater manifest sourceCommit must be a lowercase commit SHA')
  }
  if (manifest.notes !== '') {
    throw new Error('Updater manifest notes must remain an explicit empty string')
  }
  if (
    typeof manifest.pub_date !== 'string' ||
    new Date(manifest.pub_date).toISOString() !== manifest.pub_date
  ) {
    throw new Error('Updater manifest pub_date must be canonical ISO-8601')
  }
  if (
    candidate.publishedAt !== undefined &&
    manifest.pub_date !== candidate.publishedAt
  ) {
    throw new Error('Updater manifest pub_date does not match candidate')
  }

  assertPlainObject(manifest.platforms, 'Updater manifest platforms')
  const platforms = [
    'darwin-aarch64',
    'darwin-x86_64',
    'windows-x86_64',
    'linux-x86_64',
  ]
  assertExactKeys(manifest.platforms, platforms, 'Updater manifest platforms')
  for (const platform of platforms) {
    const entry = manifest.platforms[platform]
    assertPlainObject(entry, `Updater manifest platform ${platform}`)
    assertExactKeys(
      entry,
      ['signature', 'url'],
      `Updater manifest platform ${platform}`
    )
    if (
      typeof entry.signature !== 'string' ||
      entry.signature.trim() !== entry.signature ||
      entry.signature.length === 0
    ) {
      throw new Error(
        `Updater manifest platform ${platform} signature must be nonempty and trimmed`
      )
    }
    const file = expectedUpdaterArtifactName(platform, candidate.version)
    const expectedUrl = canonicalUpdaterAssetUrl(candidate.version, file)
    if (entry.url !== expectedUrl) {
      throw new Error(
        `Updater manifest platform ${platform} URL must be exactly ${expectedUrl}; found ${entry.url}`
      )
    }
  }
  return manifest
}
