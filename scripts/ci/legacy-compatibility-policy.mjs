import childProcess from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const LEGACY_CANDIDATE_PATTERN = String.raw`(?:static\.mitapp\.cn|catalog\.jan\.ai|apps(?:-nightly)?\.jan\.ai|janhq|latest[_-]jan[_-]model|model[-_]catalog|(?<![a-z0-9])cort[e]x(?:so)?(?![a-z0-9])|(?<![a-z0-9])(?:jan|mita|silence)(?![a-z0-9]))`

const DEFAULT_REPO_ROOT = path.resolve(import.meta.dirname, '../..')
const DEFAULT_ALLOWLIST_PATH = 'scripts/ci/legacy-compatibility-allowlist.json'
const POLICY_DATA_PATH = DEFAULT_ALLOWLIST_PATH
const ARCHIVE_PREFIX = 'docs/unpublished-upstream-history/'
const DOCS_ARCHIVE_ASSET_PREFIX = 'docs/unpublished-upstream-history/assets/'
const DOCS_SOURCE_PREFIX = 'docs/src/'
const DOCS_MEDIA_PATH = /\.(?:avif|gif|ico|jpe?g|png|svg|webp)$/i
const EXPECTED_EXTENSION_PACKAGES = new Map([
  [
    'assistant-extension',
    { name: '@biyan/assistant-extension', version: '1.0.2' },
  ],
  [
    'conversational-extension',
    { name: '@biyan/conversational-extension', version: '1.0.0' },
  ],
  ['download-extension', { name: '@biyan/download-extension', version: '1.0.0' }],
])
const EXPECTED_DEFAULT_CARGO_FEATURES = [
  'tauri/wry',
  'tauri/x11',
  'tauri/protocol-asset',
  'tauri/macos-private-api',
  'tauri/tray-icon',
  'tauri/test',
  'tauri/custom-protocol',
  'desktop',
]
const EXPECTED_DESKTOP_CARGO_FEATURES = ['deep-link', 'hardware']
const EXPECTED_TAURI_PLUGIN_REGISTRATIONS = [
  'tauri_plugin_deep_link',
  'tauri_plugin_document_parser',
  'tauri_plugin_hardware',
  'tauri_plugin_http',
  'tauri_plugin_log',
  'tauri_plugin_opener',
  'tauri_plugin_os',
  'tauri_plugin_shell',
  'tauri_plugin_single_instance',
  'tauri_plugin_store',
  'tauri_plugin_updater',
]
const TAURI_CLI_PLATFORM_PACKAGES = [
  '@tauri-apps/cli-darwin-arm64',
  '@tauri-apps/cli-darwin-x64',
  '@tauri-apps/cli-linux-arm-gnueabihf',
  '@tauri-apps/cli-linux-arm64-gnu',
  '@tauri-apps/cli-linux-arm64-musl',
  '@tauri-apps/cli-linux-riscv64-gnu',
  '@tauri-apps/cli-linux-x64-gnu',
  '@tauri-apps/cli-linux-x64-musl',
  '@tauri-apps/cli-win32-arm64-msvc',
  '@tauri-apps/cli-win32-ia32-msvc',
  '@tauri-apps/cli-win32-x64-msvc',
]
const CANONICAL_ICON_PATH = 'src-tauri/app-icon.png'
const CANONICAL_ICON_SHA256 =
  'ffc0e22c3a708d66f6c6dc6921c5bd92881f6efe115fb0b06e06aa92c855a94c'
const GENERATED_ICON_PATH = 'src-tauri/icons/icon.png'
const GENERATED_ICON_SHA256 =
  '480eff84ef26276d6f9d96fe9fdb94df399dc626e8546f412e946292af87fb7a'
const ICON_OVERRIDE_WORKFLOWS = [
  '.github/workflows/template-tauri-build-linux-x64-external.yml',
  '.github/workflows/template-tauri-build-linux-x64.yml',
  '.github/workflows/template-tauri-build-macos-external.yml',
  '.github/workflows/template-tauri-build-macos.yml',
  '.github/workflows/template-tauri-build-windows-x64-external.yml',
  '.github/workflows/template-tauri-build-windows-x64.yml',
]

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function normalizePath(value) {
  return value.split(path.sep).join('/')
}

function pattern(source) {
  return new RegExp(source, 'gimu')
}

function findPatternMatches(source, patternSource, relativePath) {
  const matches = []
  const expression = pattern(patternSource)
  let match
  while ((match = expression.exec(source)) !== null) {
    if (match[0].length === 0) {
      throw new Error(`zero-width compatibility pattern for ${relativePath}`)
    }
    const lineStart = source.lastIndexOf('\n', match.index - 1) + 1
    const lineEndCandidate = source.indexOf('\n', match.index + match[0].length)
    const lineEnd = lineEndCandidate === -1 ? source.length : lineEndCandidate
    matches.push({
      context: source.slice(lineStart, lineEnd).trim(),
      end: match.index + match[0].length,
      match: match[0],
      path: relativePath,
      start: match.index,
    })
  }
  return matches
}

export function legacyMatchDigest(matches) {
  const records = matches
    .map(
      ({ context, match, path: relativePath }) =>
        `${relativePath}\0${match}\0${context}`
    )
    .sort()
  return sha256(records.join('\n'))
}

export function inspectDocsArchiveInventory(
  repoRoot,
  trackedFiles,
  prefix = DOCS_ARCHIVE_ASSET_PREFIX
) {
  const records = []
  const failures = []
  const paths = [...new Set(trackedFiles.map(normalizePath))]
    .filter((relativePath) => relativePath.startsWith(prefix))
    .sort()
  for (const relativePath of paths) {
    const absolute = path.join(repoRoot, relativePath)
    const stat = fs.lstatSync(absolute, { throwIfNoEntry: false })
    if (!stat) {
      failures.push(`archived docs asset is missing: ${relativePath}`)
      continue
    }
    if (!stat.isFile() || stat.isSymbolicLink()) {
      failures.push(
        `archived docs asset must be a regular file: ${relativePath}`
      )
      continue
    }
    records.push(`${relativePath}\0${sha256(fs.readFileSync(absolute))}`)
  }
  return {
    count: paths.length,
    failures,
    sha256: sha256(records.join('\n')),
  }
}

function docsAssetReferences(source, relativePath) {
  const references = []
  const patterns = [
    /(?:from\s*|import\s*\(\s*|import\s*|require\(\s*|src\s*=\s*|href\s*=\s*)["']([^"'?#]+\.(?:avif|gif|ico|jpe?g|png|svg|webp))(?:[?#][^"']*)?["']/gimu,
    /!\[[^\]]*\]\(\s*<?([^)>\s?#]+\.(?:avif|gif|ico|jpe?g|png|svg|webp))(?:[?#][^)>\s]*)?>?(?:\s+["'][^"']*["'])?\s*\)/gimu,
    /url\(\s*["']?([^"')?#]+\.(?:avif|gif|ico|jpe?g|png|svg|webp))(?:[?#][^"')]*)?["']?\s*\)/gimu,
  ]
  for (const expression of patterns) {
    for (const match of source.matchAll(expression)) {
      const value = normalizePath(match[1])
      let resolved
      if (value.startsWith('@/')) {
        resolved = `${DOCS_SOURCE_PREFIX}${value.slice(2)}`
      } else if (value.startsWith('docs/src/')) {
        resolved = value
      } else if (value.startsWith('./') || value.startsWith('../')) {
        resolved = path.posix.normalize(
          path.posix.join(path.posix.dirname(relativePath), value)
        )
      }
      if (resolved?.startsWith(DOCS_SOURCE_PREFIX)) references.push(resolved)
    }
  }
  return references
}

export function validateDocsAssetBoundary({
  allowlist,
  contents,
  repoRoot,
  trackedFiles,
}) {
  const failures = []
  const archive = inspectDocsArchiveInventory(
    repoRoot,
    trackedFiles,
    allowlist.archivedDocsAssets.prefix
  )
  failures.push(...archive.failures)
  if (archive.count !== allowlist.archivedDocsAssets.expectedFiles) {
    failures.push(
      `archived docs asset inventory expected ${allowlist.archivedDocsAssets.expectedFiles} files but found ${archive.count}`
    )
  }
  if (archive.sha256 !== allowlist.archivedDocsAssets.inventorySha256) {
    failures.push(
      `archived docs asset inventory digest changed: expected ${allowlist.archivedDocsAssets.inventorySha256}, found ${archive.sha256}`
    )
  }

  const referenced = new Set()
  for (const [relativePath, source] of contents) {
    if (!relativePath.startsWith('docs/') || DOCS_MEDIA_PATH.test(relativePath))
      continue
    for (const reference of docsAssetReferences(source, relativePath)) {
      referenced.add(reference)
    }
  }
  for (const relativePath of trackedFiles) {
    if (
      relativePath.startsWith(DOCS_SOURCE_PREFIX) &&
      DOCS_MEDIA_PATH.test(relativePath) &&
      !referenced.has(relativePath)
    ) {
      failures.push(
        `active docs asset must have an explicit source reference: ${relativePath}`
      )
    }
  }
  return failures
}

function isUtf8Text(buffer) {
  if (buffer.includes(0)) return false
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    return true
  } catch {
    return false
  }
}

function readTrackedFiles(repoRoot) {
  const tracked = childProcess
    .execFileSync(
      'git',
      [
        '-C',
        repoRoot,
        'ls-files',
        '--cached',
        '--others',
        '--exclude-standard',
        '-z',
      ],
      { encoding: 'utf8' }
    )
    .split('\0')
    .filter(Boolean)
    .map(normalizePath)
  for (const policyPath of [
    'scripts/ci/legacy-compatibility-policy.mjs',
    'scripts/ci/__tests__/legacy-compatibility-policy.test.mjs',
    'scripts/updater/legacy-bridge-policy.json',
    'scripts/updater/legacy-manifest-policy.mjs',
    'scripts/updater/__tests__/legacy-manifest-policy.test.mjs',
    'scripts/ci/candidate-content-policy.mjs',
    'scripts/ci/__tests__/candidate-content-policy.test.mjs',
    'scripts/ci/cleanup-cloudflare-pages-previews.mjs',
    'scripts/ci/__tests__/cloudflare-preview-cleanup.test.mjs',
    'scripts/ci/release-train-policy.json',
  ]) {
    if (fs.existsSync(path.join(repoRoot, policyPath))) tracked.push(policyPath)
  }
  return [...new Set(tracked)].sort()
}

function selectorForRule(rule) {
  if (rule.path) return (relativePath) => relativePath === rule.path
  const expression = new RegExp(rule.pathRegex, 'u')
  return (relativePath) => expression.test(relativePath)
}

function ruleSchemaFailures(rule, index) {
  const failures = []
  const label = rule?.id || `rule[${index}]`
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
    return [`${label} must be an object`]
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(rule.id || ''))
    failures.push(`${label} has an invalid id`)
  if (!['content', 'path'].includes(rule.scope))
    failures.push(`${label} must declare content or path scope`)
  if (Boolean(rule.path) === Boolean(rule.pathRegex))
    failures.push(`${label} must declare exactly one of path or pathRegex`)
  if (
    rule.path &&
    (typeof rule.path !== 'string' ||
      path.isAbsolute(rule.path) ||
      normalizePath(rule.path) !== rule.path)
  ) {
    failures.push(`${label} has an invalid exact path`)
  }
  if (rule.pathRegex) {
    const finiteExactAlternation =
      /^\^\(\?:[A-Za-z0-9_./@|\\-]+\)\$$/.test(rule.pathRegex) &&
      !rule.pathRegex.includes('.*') &&
      !rule.pathRegex.includes('.+')
    const lockedArchiveInventory =
      rule.pathRegex === '^docs/unpublished-upstream-history/.*$'
    if (
      typeof rule.pathRegex !== 'string' ||
      !rule.pathRegex.startsWith('^') ||
      !rule.pathRegex.endsWith('$')
    ) {
      failures.push(`${label} pathRegex must be fully anchored`)
    }
    if (!finiteExactAlternation && !lockedArchiveInventory)
      failures.push(`${label} pathRegex is too broad`)
    try {
      new RegExp(rule.pathRegex, 'u')
    } catch {
      failures.push(`${label} pathRegex is invalid`)
    }
  }
  if (typeof rule.pattern !== 'string' || rule.pattern.length === 0) {
    failures.push(`${label} must declare an exact non-empty pattern`)
  } else {
    try {
      const expression = pattern(rule.pattern)
      if (expression.test(''))
        failures.push(`${label} pattern may match empty text`)
    } catch {
      failures.push(`${label} pattern is invalid`)
    }
  }
  if (
    !Number.isSafeInteger(rule.expectedMatches) ||
    rule.expectedMatches <= 0
  ) {
    failures.push(`${label} expectedMatches must be a positive integer`)
  }
  if (!/^[a-f0-9]{64}$/.test(rule.matchesSha256 || ''))
    failures.push(`${label} must hash-lock its expected matches`)
  if (typeof rule.reason !== 'string' || rule.reason.trim().length < 20)
    failures.push(`${label} must document a specific compatibility reason`)
  for (const key of Object.keys(rule)) {
    if (
      ![
        'expectedMatches',
        'id',
        'matchesSha256',
        'path',
        'pathRegex',
        'pattern',
        'reason',
        'scope',
      ].includes(key)
    ) {
      failures.push(`${label} contains unknown field ${key}`)
    }
  }
  return failures
}

export function validateLegacyCompatibilityAllowlist(allowlist) {
  const failures = []
  if (!allowlist || typeof allowlist !== 'object' || Array.isArray(allowlist)) {
    return ['legacy compatibility allowlist must be an object']
  }
  if (allowlist.schema !== 1)
    failures.push('legacy compatibility allowlist schema must be 1')
  if (!Array.isArray(allowlist.excludedTrackedFiles))
    failures.push('legacy compatibility allowlist exclusions must be an array')
  if (!Array.isArray(allowlist.rules))
    failures.push('legacy compatibility allowlist rules must be an array')
  const archivedDocsAssets = allowlist.archivedDocsAssets
  if (
    !archivedDocsAssets ||
    typeof archivedDocsAssets !== 'object' ||
    Array.isArray(archivedDocsAssets)
  ) {
    failures.push('archived docs asset inventory must be an object')
  } else {
    if (archivedDocsAssets.prefix !== DOCS_ARCHIVE_ASSET_PREFIX) {
      failures.push(
        `archived docs asset prefix must be ${DOCS_ARCHIVE_ASSET_PREFIX}`
      )
    }
    if (
      !Number.isSafeInteger(archivedDocsAssets.expectedFiles) ||
      archivedDocsAssets.expectedFiles < 0
    ) {
      failures.push(
        'archived docs asset expectedFiles must be a non-negative integer'
      )
    }
    if (!/^[a-f0-9]{64}$/.test(archivedDocsAssets.inventorySha256 || '')) {
      failures.push('archived docs asset inventory must provide a SHA-256')
    }
    if (
      typeof archivedDocsAssets.reason !== 'string' ||
      archivedDocsAssets.reason.trim().length < 20
    ) {
      failures.push(
        'archived docs asset inventory must document its compatibility reason'
      )
    }
    for (const key of Object.keys(archivedDocsAssets)) {
      if (
        !['expectedFiles', 'inventorySha256', 'prefix', 'reason'].includes(key)
      )
        failures.push(`archived docs asset inventory has unknown field ${key}`)
    }
  }

  const exclusionIds = new Set()
  const exclusionPaths = new Set()
  for (const [index, entry] of (
    allowlist.excludedTrackedFiles || []
  ).entries()) {
    const label = entry?.id || `excludedTrackedFiles[${index}]`
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      failures.push(`${label} must be an object`)
      continue
    }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(entry.id || ''))
      failures.push(`${label} has an invalid id`)
    if (
      typeof entry.path !== 'string' ||
      path.isAbsolute(entry.path) ||
      normalizePath(entry.path) !== entry.path
    ) {
      failures.push(`${label} has an invalid exact path`)
    }
    if (!/^[a-f0-9]{64}$/.test(entry.sha256 || ''))
      failures.push(`${label} must provide a SHA-256`)
    if (typeof entry.reason !== 'string' || entry.reason.trim().length < 20)
      failures.push(`${label} must document why the file is excluded`)
    if (exclusionIds.has(entry.id))
      failures.push(`duplicate exclusion id ${entry.id}`)
    if (exclusionPaths.has(entry.path))
      failures.push(`duplicate excluded path ${entry.path}`)
    exclusionIds.add(entry.id)
    exclusionPaths.add(entry.path)
    for (const key of Object.keys(entry)) {
      if (!['id', 'path', 'reason', 'sha256'].includes(key))
        failures.push(`${label} contains unknown field ${key}`)
    }
  }

  const ruleIds = new Set()
  for (const [index, rule] of (allowlist.rules || []).entries()) {
    failures.push(...ruleSchemaFailures(rule, index))
    if (ruleIds.has(rule?.id)) failures.push(`duplicate rule id ${rule.id}`)
    ruleIds.add(rule?.id)
  }
  for (const key of Object.keys(allowlist)) {
    if (
      ![
        'archivedDocsAssets',
        'excludedTrackedFiles',
        'rules',
        'schema',
      ].includes(key)
    )
      failures.push(`legacy compatibility allowlist has unknown field ${key}`)
  }
  return failures
}

function loadAllowlist(repoRoot) {
  return JSON.parse(
    fs.readFileSync(path.join(repoRoot, DEFAULT_ALLOWLIST_PATH), 'utf8')
  )
}

function collectCandidateMatches(source, relativePath) {
  return findPatternMatches(source, LEGACY_CANDIDATE_PATTERN, relativePath)
}

function overlap(left, right) {
  return left.start < right.end && right.start < left.end
}

function validateScannedMatches({ allowlist, contents, scope, trackedFiles }) {
  const failures = []
  const candidates = []
  for (const relativePath of trackedFiles) {
    const source = scope === 'path' ? relativePath : contents.get(relativePath)
    if (source === undefined) continue
    candidates.push(...collectCandidateMatches(source, relativePath))
  }
  const coverage = new Map(candidates.map((candidate) => [candidate, []]))

  for (const rule of allowlist.rules.filter((entry) => entry.scope === scope)) {
    const select = selectorForRule(rule)
    const matches = []
    for (const relativePath of trackedFiles.filter(select)) {
      const source =
        scope === 'path' ? relativePath : contents.get(relativePath)
      if (source === undefined) continue
      matches.push(...findPatternMatches(source, rule.pattern, relativePath))
    }
    if (matches.length !== rule.expectedMatches) {
      failures.push(
        `${rule.id} expected ${rule.expectedMatches} matches but found ${matches.length}`
      )
    }
    const digest = legacyMatchDigest(matches)
    if (digest !== rule.matchesSha256) {
      failures.push(
        `${rule.id} match digest changed: expected ${rule.matchesSha256}, found ${digest}`
      )
    }

    let coveredByRule = 0
    for (const candidate of candidates) {
      if (
        matches.some(
          (match) => match.path === candidate.path && overlap(match, candidate)
        )
      ) {
        coverage.get(candidate).push(rule.id)
        coveredByRule += 1
      }
    }
    if (matches.length > 0 && coveredByRule === 0) {
      failures.push(
        `${rule.id} is stale: it does not cover a retired identifier`
      )
    }
  }

  for (const [candidate, ruleIds] of coverage) {
    const detail = `${candidate.path}: ${JSON.stringify(candidate.match)}`
    if (ruleIds.length === 0)
      failures.push(`unallowlisted legacy ${scope} identifier at ${detail}`)
    else if (ruleIds.length > 1)
      failures.push(
        `legacy ${scope} identifier has overlapping allowlist rules ${ruleIds.join(', ')} at ${detail}`
      )
  }
  return failures
}

function parseFeatureList(cargoToml, name) {
  const features = cargoToml.match(
    /^\[features\]\s*$([\s\S]*?)(?=^\[[^\]]+\]\s*$)/m
  )?.[1]
  if (!features) return null
  const value = features.match(
    new RegExp(`^${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`, 'm')
  )?.[1]
  return value
    ? [...value.matchAll(/"([^"]+)"/g)].map((match) => match[1])
    : null
}

function parseExpectedWorkspaces(installerSource) {
  const value = installerSource.match(
    /const EXPECTED_WORKSPACES = \[([\s\S]*?)\]/
  )?.[1]
  return value
    ? [...value.matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1])
    : null
}

function compareSemver(left, right) {
  const leftParts = left.split('.').map(Number)
  const rightParts = right.split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index])
      return leftParts[index] - rightParts[index]
  }
  return 0
}

function yamlRecord(lockfile, key) {
  const keyLine = `"${key}":`
  const lines = lockfile.replaceAll('\r\n', '\n').split('\n')
  const start = lines.indexOf(keyLine)
  if (start === -1) return null
  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^\S.*:$/.test(lines[index])) {
      end = index
      break
    }
  }
  return lines.slice(start, end).join('\n')
}

export function validateTauriCliAppImageContract(packageJson, yarnLock) {
  const failures = []
  const cliVersion = packageJson.devDependencies?.['@tauri-apps/cli']
  const otherDeclarations = [
    packageJson.dependencies?.['@tauri-apps/cli'],
    packageJson.optionalDependencies?.['@tauri-apps/cli'],
    packageJson.peerDependencies?.['@tauri-apps/cli'],
  ].filter((value) => value !== undefined)
  if (typeof cliVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(cliVersion)) {
    failures.push(
      '@tauri-apps/cli must use an unscoped exact semantic version in devDependencies'
    )
    return failures
  }
  if (otherDeclarations.length > 0)
    failures.push('@tauri-apps/cli must be declared only in devDependencies')
  if (compareSemver(cliVersion, '2.11.4') < 0) {
    failures.push(
      '@tauri-apps/cli must be at least 2.11.4 to prevent absolute AppImage .DirIcon symlinks'
    )
  }

  const packageName = packageJson.name
  if (typeof packageName !== 'string' || packageName.length === 0) {
    failures.push('root package must have a name for its Yarn workspace lock')
    return failures
  }
  const workspace = yamlRecord(yarnLock, `${packageName}@workspace:.`)
  if (!workspace) {
    failures.push(
      `Yarn lock is missing root workspace ${packageName}@workspace:.`
    )
  } else {
    const lockedDependency = [
      ...workspace.matchAll(/^\s{4}"@tauri-apps\/cli": "npm:([^"]+)"$/gm),
    ]
    if (
      lockedDependency.length !== 1 ||
      lockedDependency[0][1] !== cliVersion
    ) {
      failures.push(
        `root workspace must lock @tauri-apps/cli to npm:${cliVersion}`
      )
    }
  }

  const cliRecord = yamlRecord(yarnLock, `@tauri-apps/cli@npm:${cliVersion}`)
  if (!cliRecord) {
    failures.push(
      `Yarn lock is missing exact @tauri-apps/cli@npm:${cliVersion} resolution`
    )
  } else {
    if (
      !new RegExp(
        `^  version: ${cliVersion.replaceAll('.', '\\.')}$`,
        'm'
      ).test(cliRecord)
    ) {
      failures.push(`Yarn CLI record version must be ${cliVersion}`)
    }
    if (
      !new RegExp(
        `^  resolution: "@tauri-apps/cli@npm:${cliVersion.replaceAll('.', '\\.')}"$`,
        'm'
      ).test(cliRecord)
    ) {
      failures.push(
        `Yarn CLI record resolution must be @tauri-apps/cli@npm:${cliVersion}`
      )
    }
    for (const packageName of TAURI_CLI_PLATFORM_PACKAGES) {
      const escapedName = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const declaration = [
        ...cliRecord.matchAll(
          new RegExp(`^    "${escapedName}": "npm:([^"]+)"$`, 'gm')
        ),
      ]
      if (declaration.length !== 1 || declaration[0][1] !== cliVersion) {
        failures.push(
          `Yarn CLI record must depend on ${packageName} at npm:${cliVersion}`
        )
      }
    }
  }
  const cliDescriptors = [
    ...yarnLock.matchAll(/^"@tauri-apps\/cli@npm:([^"]+)":$/gm),
  ].map((match) => match[1])
  if (cliDescriptors.length !== 1 || cliDescriptors[0] !== cliVersion) {
    failures.push(
      `Yarn lock must contain exactly one exact CLI descriptor for ${cliVersion}`
    )
  }
  for (const packageName of TAURI_CLI_PLATFORM_PACKAGES) {
    const escapedName = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const descriptors = [
      ...yarnLock.matchAll(new RegExp(`^"${escapedName}@npm:([^"]+)":$`, 'gm')),
    ].map((match) => match[1])
    if (descriptors.length !== 1 || descriptors[0] !== cliVersion) {
      failures.push(
        `Yarn lock must contain exactly one ${packageName}@npm:${cliVersion} descriptor`
      )
      continue
    }
    const record = yamlRecord(yarnLock, `${packageName}@npm:${cliVersion}`)
    if (
      !record ||
      !new RegExp(
        `^  version: ${cliVersion.replaceAll('.', '\\.')}$`,
        'm'
      ).test(record) ||
      !new RegExp(
        `^  resolution: "${escapedName}@npm:${cliVersion.replaceAll('.', '\\.')}"$`,
        'm'
      ).test(record)
    ) {
      failures.push(
        `Yarn lock ${packageName} record must resolve version ${cliVersion}`
      )
    }
  }
  return failures
}

export function validatePackagingCompatibilityContracts(repoRoot) {
  const failures = []
  const read = (relativePath) =>
    fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')

  const rootPackage = JSON.parse(read('package.json'))
  failures.push(
    ...validateTauriCliAppImageContract(rootPackage, read('yarn.lock'))
  )

  const expectedIconCommand =
    'tauri icon ./src-tauri/app-icon.png --output ./src-tauri/icons'
  if (rootPackage.scripts?.['build:icon'] !== expectedIconCommand) {
    failures.push(
      `build:icon must use the canonical source outside generated output: ${expectedIconCommand}`
    )
  }
  for (const [relativePath, expectedDigest, label] of [
    [CANONICAL_ICON_PATH, CANONICAL_ICON_SHA256, 'canonical icon source'],
    [GENERATED_ICON_PATH, GENERATED_ICON_SHA256, 'generated default icon'],
  ]) {
    const absolutePath = path.join(repoRoot, relativePath)
    const stat = fs.lstatSync(absolutePath, { throwIfNoEntry: false })
    if (!stat || !stat.isFile() || stat.isSymbolicLink()) {
      failures.push(`${label} must remain a regular file: ${relativePath}`)
      continue
    }
    const actualDigest = sha256(fs.readFileSync(absolutePath))
    if (actualDigest !== expectedDigest) {
      failures.push(
        `${label} digest changed: expected ${expectedDigest}, found ${actualDigest}`
      )
    }
  }
  if (path.dirname(CANONICAL_ICON_PATH) === path.dirname(GENERATED_ICON_PATH)) {
    failures.push('canonical icon source must be outside generated icon output')
  }
  const expectedOverride =
    'cp .github/scripts/icon-${{ inputs.channel }}.png src-tauri/app-icon.png'
  for (const workflowPath of ICON_OVERRIDE_WORKFLOWS) {
    const workflow = read(workflowPath)
    const overrideCount = workflow.split(expectedOverride).length - 1
    if (overrideCount !== 1) {
      failures.push(
        `${workflowPath} must override the canonical icon source exactly once`
      )
    }
    if (
      workflow.includes(
        'cp .github/scripts/icon-${{ inputs.channel }}.png src-tauri/icons/icon.png'
      )
    ) {
      failures.push(
        `${workflowPath} must not write a channel source into generated icon output`
      )
    }
  }

  const docsPackagePath = path.join(repoRoot, 'docs/package.json')
  const docsYarnLockPath = path.join(repoRoot, 'docs/yarn.lock')
  if (!fs.existsSync(docsPackagePath)) {
    failures.push('docs/package.json must remain tracked')
  } else {
    const docsPackage = JSON.parse(fs.readFileSync(docsPackagePath, 'utf8'))
    if (docsPackage.packageManager !== 'yarn@1.22.22') {
      failures.push('docs package manager must remain exactly yarn@1.22.22')
    }
    for (const [scriptName, command] of Object.entries(
      docsPackage.scripts || {}
    )) {
      if (
        scriptName === 'create:blogpost' ||
        /\bplop\b|src[\\/]pages[\\/](?:blog|changelog|handbook|post|privacy)(?:[\\/]|$)/iu.test(
          String(command)
        )
      ) {
        failures.push(
          `docs script ${scriptName} must not recreate a retired publication route`
        )
      }
    }
    for (const dependencyGroup of [
      'dependencies',
      'devDependencies',
      'optionalDependencies',
      'peerDependencies',
    ]) {
      for (const packageName of Object.keys(
        docsPackage[dependencyGroup] || {}
      )) {
        if (['node-plop', 'plop', 'plop-helper-date'].includes(packageName)) {
          failures.push(
            `docs ${dependencyGroup} must not include retired generator package ${packageName}`
          )
        }
      }
    }
  }
  if (!fs.existsSync(docsYarnLockPath)) {
    failures.push('docs/yarn.lock must remain the canonical docs lock')
  } else if (
    /^"?(?:node-plop|plop|plop-helper-date)@/mu.test(
      fs.readFileSync(docsYarnLockPath, 'utf8')
    )
  ) {
    failures.push(
      'docs/yarn.lock must not retain retired publication generator packages'
    )
  }
  for (const retiredPath of [
    'docs/bun.lock',
    'docs/bun.lockb',
    'docs/plopfile.js',
  ]) {
    if (fs.existsSync(path.join(repoRoot, retiredPath))) {
      failures.push(
        `${retiredPath} must stay absent from the canonical docs build`
      )
    }
  }

  const cargoToml = read('src-tauri/Cargo.toml')
  const defaultFeatures = parseFeatureList(cargoToml, 'default')
  const desktopFeatures = parseFeatureList(cargoToml, 'desktop')
  const hardwareFeatures = parseFeatureList(cargoToml, 'hardware')
  if (
    !defaultFeatures ||
    [...defaultFeatures].sort().join('\n') !==
      [...EXPECTED_DEFAULT_CARGO_FEATURES].sort().join('\n')
  ) {
    failures.push(
      `default Cargo features must be exactly ${EXPECTED_DEFAULT_CARGO_FEATURES.join(', ')}`
    )
  }
  if (
    !desktopFeatures ||
    [...desktopFeatures].sort().join('\n') !==
      [...EXPECTED_DESKTOP_CARGO_FEATURES].sort().join('\n')
  ) {
    failures.push(
      `desktop Cargo features must be exactly ${EXPECTED_DESKTOP_CARGO_FEATURES.join(', ')}`
    )
  }
  if (
    !hardwareFeatures ||
    hardwareFeatures.length !== 1 ||
    hardwareFeatures[0] !== 'dep:tauri-plugin-hardware'
  ) {
    failures.push(
      'hardware Cargo feature must resolve only dep:tauri-plugin-hardware'
    )
  }
  if (
    !/^tauri-plugin-hardware\s*=\s*\{[^}\n]*path\s*=\s*"\.\/plugins\/tauri-plugin-hardware"[^}\n]*optional\s*=\s*true[^}\n]*\}\s*$/m.test(
      cargoToml
    )
  ) {
    failures.push('hardware plugin dependency must remain local and optional')
  }

  const libSource = read('src-tauri/src/lib.rs')
  const pluginCalls = [...libSource.matchAll(/\.plugin\s*\(/g)]
  const pluginRegistrations = [
    ...libSource.matchAll(
      /\.plugin\s*\(\s*(tauri_plugin_[a-z0-9_]+)::/g
    ),
  ]
    .map((match) => match[1])
    .sort()
  if (
    pluginCalls.length !== EXPECTED_TAURI_PLUGIN_REGISTRATIONS.length ||
    pluginRegistrations.join('\n') !==
      [...EXPECTED_TAURI_PLUGIN_REGISTRATIONS].sort().join('\n')
  ) {
    failures.push(
      `Tauri plugin registrations must be exactly ${EXPECTED_TAURI_PLUGIN_REGISTRATIONS.join(', ')}`
    )
  }
  const registration =
    /#\[cfg\(not\(any\(target_os = "android", target_os = "ios"\)\)\)\]\s*\{\s*app_builder = app_builder\.plugin\(tauri_plugin_hardware::init\(\)\);\s*\}/g
  if ([...libSource.matchAll(registration)].length !== 1) {
    failures.push(
      'desktop lib.rs must register tauri-plugin-hardware exactly once'
    )
  }

  const extensionsRoot = path.join(repoRoot, 'extensions')
  const packageDirectories = fs
    .readdirSync(extensionsRoot, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        fs.existsSync(path.join(extensionsRoot, entry.name, 'package.json'))
    )
    .map((entry) => entry.name)
    .sort()
  const expectedDirectories = [...EXPECTED_EXTENSION_PACKAGES.keys()].sort()
  if (packageDirectories.join('\n') !== expectedDirectories.join('\n')) {
    failures.push(
      `preinstall extension directories must be exactly ${expectedDirectories.join(', ')}`
    )
  }
  for (const [directory, expectedPackage] of EXPECTED_EXTENSION_PACKAGES) {
    const manifestPath = path.join(extensionsRoot, directory, 'package.json')
    if (!fs.existsSync(manifestPath)) continue
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    if (manifest.name !== expectedPackage.name)
      failures.push(`${directory} package name must be ${expectedPackage.name}`)
    if (manifest.version !== expectedPackage.version) {
      failures.push(
        `${expectedPackage.name} version must remain exactly ${expectedPackage.version}`
      )
    }
    if (manifest.private !== true)
      failures.push(`${expectedPackage.name} must remain private`)
    if (manifest.dependencies?.['@biyan/core'] !== '../../core/package.tgz') {
      failures.push(
        `${expectedPackage.name} must use the reviewed Biyan core archive`
      )
    }
    if (
      !/\bnpm pack\b/.test(manifest.scripts?.['build:publish'] || '') ||
      !/\.\.\/\.\.\/pre-install/.test(manifest.scripts?.['build:publish'] || '')
    ) {
      failures.push(`${expectedPackage.name} must pack into pre-install`)
    }
  }
  const installerWorkspaces = parseExpectedWorkspaces(
    read('scripts/install-extensions.mjs')
  )
  if (
    !installerWorkspaces ||
    [...installerWorkspaces].sort().join('\n') !==
      expectedDirectories.join('\n')
  ) {
    failures.push(
      'extension installer must enumerate exactly the three reviewed Biyan packages'
    )
  }

  for (const legalName of ['LICENSE', 'NOTICE']) {
    const rootLegal = fs.readFileSync(path.join(repoRoot, legalName))
    const androidLegal = fs.readFileSync(
      path.join(
        repoRoot,
        'src-tauri/gen/android/app/src/main/assets/resources',
        legalName
      )
    )
    if (!rootLegal.equals(androidLegal))
      failures.push(`Android generated ${legalName} must equal the root file`)
  }
  return failures
}

export function validateLegacyCompatibilityRepository(
  repoRoot = DEFAULT_REPO_ROOT,
  {
    allowlist = loadAllowlist(repoRoot),
    trackedFiles = readTrackedFiles(repoRoot),
    validatePackaging = true,
  } = {}
) {
  const failures = validateLegacyCompatibilityAllowlist(allowlist)
  if (failures.length > 0) return failures

  const tracked = [...new Set(trackedFiles.map(normalizePath))].sort()
  const trackedSet = new Set(tracked)
  const excluded = new Set()
  for (const entry of allowlist.excludedTrackedFiles) {
    excluded.add(entry.path)
    if (!trackedSet.has(entry.path)) {
      failures.push(
        `${entry.id} excluded file is no longer tracked: ${entry.path}`
      )
      continue
    }
    const absolute = path.join(repoRoot, entry.path)
    if (!fs.existsSync(absolute)) {
      failures.push(`${entry.id} excluded file is missing: ${entry.path}`)
      continue
    }
    const actual = sha256(fs.readFileSync(absolute))
    if (actual !== entry.sha256) {
      failures.push(
        `${entry.id} excluded file digest changed: expected ${entry.sha256}, found ${actual}`
      )
    }
  }

  const contents = new Map()
  for (const relativePath of tracked) {
    if (
      relativePath === POLICY_DATA_PATH ||
      relativePath.startsWith(ARCHIVE_PREFIX) ||
      excluded.has(relativePath)
    ) {
      continue
    }
    const absolute = path.join(repoRoot, relativePath)
    if (!fs.existsSync(absolute)) {
      failures.push(`tracked compatibility input is missing: ${relativePath}`)
      continue
    }
    const buffer = fs.readFileSync(absolute)
    if (isUtf8Text(buffer)) contents.set(relativePath, buffer.toString('utf8'))
  }

  failures.push(
    ...validateScannedMatches({
      allowlist,
      contents,
      scope: 'content',
      trackedFiles: tracked,
    }),
    ...validateScannedMatches({
      allowlist,
      contents,
      scope: 'path',
      trackedFiles: tracked,
    })
  )
  failures.push(
    ...validateDocsAssetBoundary({
      allowlist,
      contents,
      repoRoot,
      trackedFiles: tracked,
    })
  )
  if (validatePackaging)
    failures.push(...validatePackagingCompatibilityContracts(repoRoot))
  return failures
}
