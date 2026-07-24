import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CHECKPOINT_FILES = Object.freeze([
  'biyan-release.json',
  'src-tauri/Cargo.lock',
  'src-tauri/Cargo.toml',
  'src-tauri/tauri.conf.json',
])

const FLAG_KEYS = Object.freeze([
  'docs',
  'checkpoint',
  'focused',
  'policy',
  'updater',
  'artifactReplay',
  'quick',
  'nativeTests',
  'testMacos',
  'testWindows',
  'testLinux',
  'buildMacos',
  'buildWindows',
  'buildLinux',
  'full',
])

const GITHUB_FLAG_NAMES = Object.freeze({
  docs: 'docs',
  checkpoint: 'checkpoint',
  focused: 'focused',
  policy: 'policy',
  updater: 'updater',
  artifactReplay: 'artifact_replay',
  quick: 'quick',
  nativeTests: 'native_tests',
  testMacos: 'test_macos',
  testWindows: 'test_windows',
  testLinux: 'test_linux',
  buildMacos: 'build_macos',
  buildWindows: 'build_windows',
  buildLinux: 'build_linux',
  full: 'full',
})

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/
const SHA_PATTERN = /^[0-9a-fA-F]{40}$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const SELF_PATH = 'scripts/ci/qualification-impact.mjs'
const ALLOWED_CHECKPOINT_TRANSITIONS = new Set(['C->A', 'A->B', 'B->C'])
const UPDATER_WORKFLOW_NAMES = new Set([
  'biyan-upgrade-smoke.yml',
  'deploy-updater-router.yml',
  'promote-desktop-update.yml',
  'release-distribution.yml',
  'sync-legacy-updater.yml',
  'updater-health-gate.yml',
  'updater-kill-switch.yml',
])
const FULL_QUALIFICATION_WORKFLOW_NAMES = new Set([
  'desktop-release.yml',
])

function emptyFlags(value = false) {
  return Object.fromEntries(FLAG_KEYS.map((key) => [key, value]))
}

function fullQualificationFlags() {
  const flags = emptyFlags(true)
  // A full rebuild supersedes retained-artifact replay. Checkpoint stays false
  // until the repository-backed semantic verifier proves the exact four files.
  flags.artifactReplay = false
  flags.checkpoint = false
  return flags
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }
  const entries = Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(',')}}`
}

function withPlanSha256(plan) {
  const planSha256 = createHash('sha256')
    .update(stableStringify(plan))
    .digest('hex')
  return { ...plan, planSha256 }
}

function compareSemverPrecedence(left, right) {
  const parse = (version) => {
    const withoutBuild = version.split('+', 1)[0]
    const separator = withoutBuild.indexOf('-')
    const core = separator === -1 ? withoutBuild : withoutBuild.slice(0, separator)
    const prerelease =
      separator === -1 ? null : withoutBuild.slice(separator + 1).split('.')
    return {
      core: core.split('.').map((part) => BigInt(part)),
      prerelease,
    }
  }
  const leftVersion = parse(left)
  const rightVersion = parse(right)

  for (let index = 0; index < 3; index += 1) {
    if (leftVersion.core[index] < rightVersion.core[index]) return -1
    if (leftVersion.core[index] > rightVersion.core[index]) return 1
  }
  if (leftVersion.prerelease === null && rightVersion.prerelease === null) return 0
  if (leftVersion.prerelease === null) return 1
  if (rightVersion.prerelease === null) return -1

  const length = Math.max(
    leftVersion.prerelease.length,
    rightVersion.prerelease.length
  )
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftVersion.prerelease[index]
    const rightPart = rightVersion.prerelease[index]
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    if (leftPart === rightPart) continue
    const leftNumeric = /^\d+$/.test(leftPart)
    const rightNumeric = /^\d+$/.test(rightPart)
    if (leftNumeric && rightNumeric) {
      return BigInt(leftPart) < BigInt(rightPart) ? -1 : 1
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
    return leftPart < rightPart ? -1 : 1
  }
  return 0
}

function finalizeClassificationPlan(plan, { requireReplay = false } = {}) {
  const flags = { ...plan.flags }
  const reasons = [...plan.reasons]
  if (requireReplay && !plan.blocked) {
    flags.artifactReplay = true
    reasons.push('retained artifact replay required for exact-SHA auto qualification')
  }
  return withPlanSha256({ ...plan, flags, reasons })
}

function normalizeRepoPath(input) {
  if (typeof input !== 'string' || input.length === 0) {
    throw new TypeError('changed paths must be non-empty strings')
  }
  if (CONTROL_CHARACTER_PATTERN.test(input)) {
    throw new TypeError(`changed path contains a control character: ${JSON.stringify(input)}`)
  }

  const slashed = input.replaceAll('\\', '/')
  const withoutLeadingDots = slashed.replace(/^(?:\.\/)+/, '')
  if (
    slashed.startsWith('/') ||
    slashed.startsWith('//') ||
    withoutLeadingDots.startsWith('/') ||
    /^[A-Za-z]:\//.test(withoutLeadingDots)
  ) {
    throw new TypeError(`absolute changed path is forbidden: ${JSON.stringify(input)}`)
  }

  const rawSegments = slashed.split('/')
  if (rawSegments.includes('..')) {
    throw new TypeError(`parent traversal is forbidden: ${JSON.stringify(input)}`)
  }
  const normalized = rawSegments
    .filter((segment) => segment !== '' && segment !== '.')
    .join('/')
  if (!normalized) {
    throw new TypeError(`changed path resolves to an empty path: ${JSON.stringify(input)}`)
  }
  return normalized
}

function isDocsPath(file) {
  const basename = file.split('/').at(-1)
  return (
    file.startsWith('docs/') ||
    file.startsWith('.github/ISSUE_TEMPLATE/') ||
    /\.mdx?$/i.test(file) ||
    /^(?:README|LICENSE|NOTICE|CHANGELOG)(?:\.[^/]*)?$/i.test(basename) ||
    file === '.gitignore'
  )
}

function isBundledRuntimeInput(file) {
  return (
    file === 'LICENSE' ||
    file === 'NOTICE' ||
    file.startsWith('pre-install/') ||
    file.startsWith('src-tauri/resources/')
  )
}

function isTestPath(file) {
  if (
    /^(?:core\/src|web-app\/src|src-tauri\/src|extensions\/[^/]+\/src)\//.test(
      file
    ) &&
    /\/(?:tests?|fixtures)\//.test(file)
  ) {
    return false
  }
  return (
    /^(?:tests?|autoqa\/tests|src-tauri\/tests|scripts\/__tests__)(?:\/|$)/.test(
      file
    ) ||
    /^(?:core|web-app)\/(?:src\/)?__tests__(?:\/|$)/.test(file) ||
    /(?:^|\/)[^/]+\.(?:test|spec)\.[^/]+$/.test(file) ||
    /(?:^|\/)test_[^/]+\.(?:py|rs|js|mjs|cjs|ts|tsx)$/.test(file) ||
    /(?:^|\/)[^/]+_test\.rs$/.test(file)
  )
}

function isDirectFocusedJavaScriptOrTypeScriptTest(file) {
  return /(?:^|\/)[^/]+\.(?:test|spec)\.(?:js|cjs|mjs|ts|tsx)$/.test(file)
}

function isFixturePath(file) {
  return /(?:^|\/)(?:__)?fixtures?(?:__)?(?:\/|$)/i.test(file)
}

function isRustTest(file) {
  return /(?:^|\/)(?:test_[^/]+|[^/]+_test)\.rs$/.test(file) ||
    /^(?:src-tauri\/tests|tests)\/.*\.rs$/.test(file)
}

function isPolicyVerifierPath(file) {
  return (
    file.startsWith('scripts/ci/') ||
    /^scripts\/(?:verify-|macos-architecture-policy\.mjs$)/.test(file) ||
    /^scripts\/__tests__\/(?:verify-|macos-architecture-policy\.)/.test(file)
  )
}

function isUpdaterDistributionPath(file) {
  return (
    file.startsWith('scripts/updater/') ||
    file.startsWith('scripts/release-distribution/')
  )
}

function candidateVerifierImpact(file) {
  if (
    file === 'scripts/verify-macos-candidate.mjs' ||
    file === 'scripts/macos-architecture-policy.mjs'
  ) {
    return {
      kind: 'platform',
      platforms: { macos: true, windows: false, linux: false },
    }
  }
  if (file === 'scripts/ci/verify-windows-candidate.ps1') {
    return {
      kind: 'platform',
      platforms: { macos: false, windows: true, linux: false },
    }
  }
  return null
}

function workflowImpact(file) {
  if (!file.startsWith('.github/workflows/')) return null
  const name = file.slice('.github/workflows/'.length)
  if (FULL_QUALIFICATION_WORKFLOW_NAMES.has(name)) {
    return { kind: 'formal-release' }
  }
  if (name === 'biyan-docs.yml') return { kind: 'docs-control' }
  if (UPDATER_WORKFLOW_NAMES.has(name)) return { kind: 'updater' }
  const platform =
    /^template-tauri-build-(macos|windows|linux)(?:[-.])/.exec(name)?.[1]
  if (platform) {
    return {
      kind: 'platform',
      platforms: {
        macos: platform === 'macos',
        windows: platform === 'windows',
        linux: platform === 'linux',
      },
    }
  }
  return { kind: 'control' }
}

function platformPackaging(file) {
  const macos =
    file === 'src-tauri/tauri.macos.conf.json' ||
    /^src-tauri\/(?:entitlements|Info)\.plist$/.test(file) ||
    /(?:^|\/)(?:macos|darwin)(?:\/|[-_.])/i.test(file) ||
    /\.icns$/i.test(file)
  const windows =
    file === 'src-tauri/tauri.windows.conf.json' ||
    file.startsWith('src-tauri/windows/') ||
    /(?:^|\/)(?:windows|win32)(?:\/|[-_.])/i.test(file) ||
    /\.(?:ico|nsi|wxs|wixproj|ps1)$/i.test(file)
  const linux =
    file === 'src-tauri/tauri.linux.conf.json' ||
    file.startsWith('flatpak/') ||
    /(?:^|\/)(?:linux|appimage|flatpak)(?:\/|[-_.])/i.test(file) ||
    /^src-tauri\/build-utils\/(?:buildAppImage|linuxdeploy|shim-linuxdeploy)/.test(
      file
    ) ||
    /\.(?:deb|rpm|appimage)$/i.test(file)
  return { macos, windows, linux }
}

function isRuntimeDependencyPath(file) {
  return (
    /^(?:core|extensions|joi|pre-install|web|web-app)\//.test(file) ||
    /^src-tauri\/(?:capabilities|gen|icons|plugins|resources|src|static|utils)\//.test(
      file
    ) ||
    file === 'src-tauri/build.rs' ||
    file === 'src-tauri/tauri.conf.json' ||
    /(?:^|\/)Cargo\.(?:toml|lock)$/.test(file) ||
    /(?:^|\/)(?:package\.json|yarn\.lock|package-lock\.json|pnpm-lock\.yaml)$/.test(
      file
    ) ||
    /^(?:Makefile|rust-toolchain(?:\.toml)?|tsconfig[^/]*\.json|vite\.config\.[^/]+)$/.test(
      file
    ) ||
    file.startsWith('scripts/')
  )
}

function isControlPlanePath(file) {
  return (
    file.startsWith('.github/workflows/') ||
    file.startsWith('.github/actions/') ||
    file.startsWith('.github/scripts/') ||
    file === '.github/CODEOWNERS' ||
    file === '.github/dependabot.yml'
  )
}

function exactCheckpointSet(files) {
  return (
    files.length === CHECKPOINT_FILES.length &&
    CHECKPOINT_FILES.every((file, index) => file === files[index])
  )
}

/**
 * Classify normalized repository-relative paths without touching the file system.
 * CLI checkpoint candidates receive an additional semantic verification below.
 */
export function classifyChangedFiles(
  paths,
  { forceFull = false, requireReplay = false, deletedPaths = [] } = {}
) {
  if (!Array.isArray(paths)) {
    throw new TypeError('paths must be an array')
  }
  if (!Array.isArray(deletedPaths)) {
    throw new TypeError('deletedPaths must be an array')
  }
  if (forceFull && requireReplay) {
    throw new TypeError('forceFull and requireReplay are mutually exclusive')
  }

  const changedFiles = [...new Set(paths.map(normalizeRepoPath))].sort()
  const deletedFiles = new Set(deletedPaths.map(normalizeRepoPath))
  if ([...deletedFiles].some((file) => !changedFiles.includes(file))) {
    throw new TypeError('deletedPaths must be a subset of changed paths')
  }
  const categories = {
    empty: changedFiles.length === 0,
    docsOnly: false,
    checkpointOnly: false,
    testOnly: false,
    policyVerifierOnly: false,
    updaterDistributionOnly: false,
    platformPackaging: { macos: false, windows: false, linux: false },
    runtimeDependency: false,
    controlPlane: false,
    unknown: false,
  }

  if (changedFiles.length === 0) {
    return finalizeClassificationPlan({
      classification: 'empty',
      changedFiles,
      categories,
      flags: emptyFlags(),
      blocked: true,
      reasons: ['empty diff is not a qualification target'],
    }, { requireReplay })
  }

  const checkpointOnly = exactCheckpointSet(changedFiles)
  categories.checkpointOnly = checkpointOnly
  if (checkpointOnly && !forceFull) {
    const flags = emptyFlags()
    flags.checkpoint = true
    flags.focused = true
    flags.policy = true
    flags.updater = true
    return finalizeClassificationPlan({
      classification: 'checkpoint-only',
      changedFiles,
      categories,
      flags,
      blocked: false,
      reasons: ['exact four-file checkpoint candidate; semantic verification required'],
    }, { requireReplay })
  }

  const kinds = changedFiles.map((file) => {
    if (file === SELF_PATH) return { file, kind: 'self' }
    // These paths feed the desktop bundles even when their basename looks like
    // documentation. Keep this check ahead of isDocsPath so legal/resource
    // mutations can never carry forward stale native packages.
    if (isBundledRuntimeInput(file)) return { file, kind: 'runtime' }
    if (isDocsPath(file)) return { file, kind: 'docs' }
    const candidateVerifier = candidateVerifierImpact(file)
    if (candidateVerifier) return { file, ...candidateVerifier }
    if (isPolicyVerifierPath(file)) return { file, kind: 'policy' }
    if (isUpdaterDistributionPath(file)) return { file, kind: 'updater' }
    const workflow = workflowImpact(file)
    if (workflow) return { file, ...workflow }
    if (isControlPlanePath(file)) return { file, kind: 'control' }
    if (isTestPath(file)) return { file, kind: 'test' }
    const platforms = platformPackaging(file)
    if (platforms.macos || platforms.windows || platforms.linux) {
      return { file, kind: 'platform', platforms }
    }
    if (isRuntimeDependencyPath(file)) return { file, kind: 'runtime' }
    return { file, kind: 'unknown' }
  })

  const everyKind = (kind) => kinds.every((entry) => entry.kind === kind)
  categories.docsOnly = everyKind('docs')
  categories.testOnly = everyKind('test')
  categories.policyVerifierOnly = everyKind('policy')
  categories.updaterDistributionOnly = everyKind('updater')
  categories.runtimeDependency = kinds.some((entry) => entry.kind === 'runtime')
  categories.controlPlane = kinds.some((entry) =>
    ['control', 'docs-control', 'formal-release'].includes(entry.kind)
  )
  categories.unknown = kinds.some((entry) => entry.kind === 'unknown')
  for (const entry of kinds.filter((item) => item.kind === 'platform')) {
    for (const platform of ['macos', 'windows', 'linux']) {
      categories.platformPackaging[platform] ||= entry.platforms[platform]
    }
  }

  const selfModified = kinds.some((entry) => entry.kind === 'self')
  const formalRelease = kinds.some((entry) => entry.kind === 'formal-release')
  const full = Boolean(
    forceFull || selfModified || formalRelease || categories.unknown
  )
  const flags = full ? fullQualificationFlags() : emptyFlags()
  const reasons = []

  if (forceFull) reasons.push('full qualification explicitly requested')
  if (selfModified) reasons.push('impact classifier changed; fail closed to full')
  if (formalRelease) {
    reasons.push('protected full-qualification workflow changed')
  }
  if (categories.unknown) {
    const unknownFiles = kinds
      .filter((entry) => entry.kind === 'unknown')
      .map((entry) => entry.file)
    reasons.push(`unknown impact path(s): ${unknownFiles.join(', ')}`)
  }

  if (!full) {
    const hasKind = (kind) => kinds.some((entry) => entry.kind === kind)
    if (hasKind('docs')) flags.docs = true
    if (hasKind('docs-control')) {
      flags.docs = true
      flags.focused = true
      flags.policy = true
    }
    if (hasKind('test')) {
      flags.focused = true
      const testEntries = kinds.filter((entry) => entry.kind === 'test')
      flags.quick = testEntries.some(
        (entry) =>
          isDirectFocusedJavaScriptOrTypeScriptTest(entry.file) &&
          !deletedFiles.has(entry.file) &&
          !isFixturePath(entry.file)
      )
      if (
        testEntries.some(
          (entry) =>
            deletedFiles.has(entry.file) ||
            isFixturePath(entry.file) ||
            !isDirectFocusedJavaScriptOrTypeScriptTest(entry.file)
        )
      ) {
        flags.nativeTests = true
        if (testEntries.some((entry) => isRustTest(entry.file))) {
          flags.testMacos = true
          flags.testWindows = true
          flags.testLinux = true
          reasons.push(
            'Rust test change requires native tests on macOS, Windows, and Linux'
          )
        } else {
          flags.testLinux = true
          reasons.push(
            'non-direct, fixture, or deleted test change requires Linux native tests'
          )
        }
      }
    }
    if (hasKind('policy')) {
      flags.focused = true
      flags.policy = true
      flags.artifactReplay = true
    }
    if (hasKind('updater')) {
      flags.focused = true
      flags.policy = true
      flags.updater = true
      flags.artifactReplay = true
    }
    if (hasKind('control')) {
      flags.focused = true
      flags.policy = true
    }
    if (categories.runtimeDependency) {
      flags.focused = true
      flags.policy = true
      flags.updater = true
      flags.artifactReplay = false
      flags.quick = true
      flags.nativeTests = true
      flags.testMacos = true
      flags.testWindows = true
      flags.testLinux = true
      flags.buildMacos = true
      flags.buildWindows = true
      flags.buildLinux = true
      flags.full = true
    }
    for (const platform of ['Macos', 'Windows', 'Linux']) {
      const key = platform.toLowerCase()
      if (categories.platformPackaging[key]) {
        flags.focused = true
        flags.policy = true
        flags.nativeTests = true
        flags[`test${platform}`] = true
        flags[`build${platform}`] = true
      }
    }
  }

  let classification = 'mixed'
  if (full) {
    if (forceFull) classification = 'full'
    else if (selfModified) classification = 'self-change'
    else if (formalRelease) classification = 'formal-release-control'
    else classification = 'unknown'
  }
  else if (categories.docsOnly) classification = 'docs-only'
  else if (categories.testOnly) classification = 'test-only'
  else if (categories.policyVerifierOnly) classification = 'policy/verifier-only'
  else if (categories.updaterDistributionOnly) classification = 'updater/distribution-only'
  else if (kinds.every((entry) => entry.kind === 'platform')) {
    classification = 'platform-packaging'
  } else if (everyKind('runtime')) classification = 'runtime/dependency'
  else if (everyKind('docs-control')) classification = 'docs-control'
  else if (everyKind('control')) classification = 'control-plane'

  if (reasons.length === 0) reasons.push(`classified as ${classification}`)
  return finalizeClassificationPlan({
    classification,
    changedFiles,
    categories,
    flags,
    blocked: false,
    reasons,
  }, { requireReplay })
}

function runGit(repo, args, { allowStatus = [] } = {}) {
  const result = spawnSync('git', ['-C', repo, ...args], {
    encoding: 'buffer',
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  })
  if (result.error) throw result.error
  if (result.status !== 0 && !allowStatus.includes(result.status)) {
    const stderr = result.stderr?.toString('utf8').trim()
    throw new Error(`git ${args[0]} failed (${result.status})${stderr ? `: ${stderr}` : ''}`)
  }
  return result
}

function validateCommit(repo, sha, label) {
  if (!SHA_PATTERN.test(sha ?? '')) {
    throw new TypeError(`${label} must be an exact 40-hex commit`)
  }
  const resolved = runGit(repo, ['rev-parse', '--verify', `${sha}^{commit}`])
    .stdout.toString('utf8')
    .trim()
  if (resolved.toLowerCase() !== sha.toLowerCase()) {
    throw new Error(`${label} did not resolve to the requested exact commit`)
  }
  return resolved.toLowerCase()
}

function validateAncestry(repo, base, target) {
  const result = runGit(repo, ['merge-base', '--is-ancestor', base, target], {
    allowStatus: [1],
  })
  if (result.status === 1) throw new Error('base is not an ancestor of target')
}

function splitNul(buffer) {
  const tokens = buffer.toString('utf8').split('\0')
  if (tokens.at(-1) === '') tokens.pop()
  return tokens
}

function inspectRawDiff(repo, base, target) {
  const tokens = splitNul(
    runGit(repo, [
      'diff',
      '--raw',
      '-z',
      '--no-abbrev',
      // Normalize renames/copies to exact deletion + addition records. Git's
      // similarity heuristics vary by content and version; both paths must be
      // classified deterministically instead.
      '--no-renames',
      base,
      target,
      '--',
    ]).stdout
  )
  const entries = []
  for (let index = 0; index < tokens.length; ) {
    const header = tokens[index++]
    const match = /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40}) ([0-9a-f]{40}) ([A-Z][0-9]*)$/.exec(
      header
    )
    if (!match) throw new Error(`unsupported raw diff record: ${JSON.stringify(header)}`)
    const [, oldMode, newMode, oldObject, newObject, status] = match
    const pathCount = /^[RC]/.test(status) ? 2 : 1
    const paths = tokens.slice(index, index + pathCount).map(normalizeRepoPath)
    if (paths.length !== pathCount) throw new Error('truncated raw diff record')
    index += pathCount

    if (!/^[AMD]$/.test(status)) {
      throw new Error(`rename/copy/type/merge status is forbidden: ${status}`)
    }
    const permittedModes = new Set(['000000', '100644', '100755'])
    if (!permittedModes.has(oldMode) || !permittedModes.has(newMode)) {
      throw new Error(
        `symlink, submodule, or special file mode is forbidden: ${oldMode}->${newMode}`
      )
    }
    if (status === 'M' && oldMode !== newMode) {
      throw new Error(`mode-changing modification is forbidden: ${oldMode}->${newMode}`)
    }
    if (
      (status === 'A' && (oldMode !== '000000' || newMode === '000000')) ||
      (status === 'D' && (oldMode === '000000' || newMode !== '000000')) ||
      (status === 'M' && (oldMode === '000000' || newMode === '000000'))
    ) {
      throw new Error(`inconsistent raw diff modes for ${status}`)
    }
    entries.push({ oldMode, newMode, oldObject, newObject, status, paths })
  }
  return entries
}

function changedFilesFromGit(repo, base, target) {
  const rawEntries = inspectRawDiff(repo, base, target)
  if (rawEntries.length === 0) throw new Error('empty diff is not a qualification target')
  const files = splitNul(
    runGit(repo, [
      'diff',
      '--name-only',
      '-z',
      '--no-renames',
      base,
      target,
      '--',
    ]).stdout
  ).map(normalizeRepoPath)
  if (files.length === 0) throw new Error('empty name-only diff is not a qualification target')

  const rawPaths = new Set(rawEntries.flatMap((entry) => entry.paths))
  const namedPaths = new Set(files)
  if (
    rawPaths.size !== namedPaths.size ||
    [...rawPaths].some((file) => !namedPaths.has(file))
  ) {
    throw new Error('raw and name-only diff path sets disagree')
  }
  return { files, rawEntries }
}

function showFile(repo, commit, file) {
  const result = runGit(repo, ['show', `${commit}:${file}`])
  const source = result.stdout.toString('utf8')
  if (source.includes('\uFFFD')) throw new Error(`${file} is not valid UTF-8 text`)
  return source
}

function parseReleaseAttestation(source, label) {
  let value
  try {
    value = JSON.parse(source)
  } catch (error) {
    throw new Error(`${label} biyan-release.json is invalid JSON: ${error.message}`)
  }
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new Error(`${label} biyan-release.json must be an object`)
  }
  const keys = Object.keys(value).sort()
  if (keys.join('\0') !== ['dataSchema', 'migrationPhase', 'schema'].join('\0')) {
    throw new Error(`${label} biyan-release.json has unexpected fields`)
  }
  const expectedDataSchema = { A: 1, B: 2, C: 3 }[value.migrationPhase]
  if (value.schema !== 1 || value.dataSchema !== expectedDataSchema) {
    throw new Error(`${label} release attestation schema/phase/dataSchema is invalid`)
  }
  return value
}

function parseTauriVersion(source, label) {
  let value
  try {
    value = JSON.parse(source)
  } catch (error) {
    throw new Error(`${label} tauri.conf.json is invalid JSON: ${error.message}`)
  }
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new Error(`${label} tauri.conf.json must be an object`)
  }
  if (!VERSION_PATTERN.test(value.version ?? '')) {
    throw new Error(`${label} tauri.conf.json has an invalid version`)
  }
  const version = value.version
  return { version, comparable: { ...value, version: '<checkpoint-version>' } }
}

function replaceTopLevelPackageVersion(source, label) {
  const sectionPattern = /^\[package\][ \t]*(?:\r?\n|$)/gm
  const sectionMatches = [...source.matchAll(sectionPattern)]
  if (sectionMatches.length !== 1) {
    throw new Error(`${label} Cargo.toml must contain exactly one top-level [package] section`)
  }
  const start = sectionMatches[0].index + sectionMatches[0][0].length
  const nextSection = /^\[/gm
  nextSection.lastIndex = start
  const next = nextSection.exec(source)
  const end = next?.index ?? source.length
  const section = source.slice(start, end)
  const versionPattern = /^(version[ \t]*=[ \t]*")([^"]+)("[ \t]*(?:#.*)?)(\r?)$/gm
  const matches = [...section.matchAll(versionPattern)]
  if (matches.length !== 1 || !VERSION_PATTERN.test(matches[0][2])) {
    throw new Error(`${label} Cargo.toml [package] must contain one valid string version`)
  }
  const match = matches[0]
  const absoluteStart = start + match.index + match[1].length
  const absoluteEnd = absoluteStart + match[2].length
  return {
    version: match[2],
    comparable: `${source.slice(0, absoluteStart)}<checkpoint-version>${source.slice(absoluteEnd)}`,
  }
}

function replaceBiyanLockVersion(source, label) {
  const starts = [...source.matchAll(/^\[\[package\]\][ \t]*(?:\r?\n|$)/gm)]
  const blocks = starts.map((match, index) => ({
    start: match.index,
    end: starts[index + 1]?.index ?? source.length,
  }))
  const candidates = blocks.filter(({ start, end }) => {
    const block = source.slice(start, end)
    return /^name[ \t]*=[ \t]*"Biyan"[ \t]*(?:\r?)$/m.test(block)
  })
  if (candidates.length !== 1) {
    throw new Error(`${label} Cargo.lock must contain exactly one Biyan package`)
  }
  const { start, end } = candidates[0]
  const block = source.slice(start, end)
  const versionPattern = /^(version[ \t]*=[ \t]*")([^"]+)("[ \t]*)(\r?)$/gm
  const matches = [...block.matchAll(versionPattern)]
  if (matches.length !== 1 || !VERSION_PATTERN.test(matches[0][2])) {
    throw new Error(`${label} Cargo.lock Biyan package must contain one valid version`)
  }
  const match = matches[0]
  const absoluteStart = start + match.index + match[1].length
  const absoluteEnd = absoluteStart + match[2].length
  return {
    version: match[2],
    comparable: `${source.slice(0, absoluteStart)}<checkpoint-version>${source.slice(absoluteEnd)}`,
  }
}

function deepEqualJson(left, right) {
  return stableStringify(left) === stableStringify(right)
}

export function verifyCheckpoint({ repo, base, target }) {
  const repository = path.resolve(repo)
  const baseCommit = validateCommit(repository, base, 'base')
  const targetCommit = validateCommit(repository, target, 'target')
  validateAncestry(repository, baseCommit, targetCommit)
  const { files, rawEntries } = changedFilesFromGit(
    repository,
    baseCommit,
    targetCommit
  )
  const normalizedFiles = [...new Set(files)].sort()
  if (!exactCheckpointSet(normalizedFiles)) {
    throw new Error('checkpoint transition must modify exactly the four checkpoint files')
  }
  if (
    rawEntries.length !== CHECKPOINT_FILES.length ||
    rawEntries.some(
      (entry) =>
        entry.status !== 'M' ||
        entry.oldMode !== '100644' ||
        entry.newMode !== '100644'
    )
  ) {
    throw new Error('checkpoint files must be regular 100644 modifications')
  }

  const baseRelease = parseReleaseAttestation(
    showFile(repository, baseCommit, 'biyan-release.json'),
    'base'
  )
  const targetRelease = parseReleaseAttestation(
    showFile(repository, targetCommit, 'biyan-release.json'),
    'target'
  )
  const phaseTransition =
    `${baseRelease.migrationPhase}->${targetRelease.migrationPhase}`
  if (!ALLOWED_CHECKPOINT_TRANSITIONS.has(phaseTransition)) {
    throw new Error(
      'checkpoint migration phase must transition C->A, A->B, or B->C'
    )
  }
  const baseTauri = parseTauriVersion(
    showFile(repository, baseCommit, 'src-tauri/tauri.conf.json'),
    'base'
  )
  const targetTauri = parseTauriVersion(
    showFile(repository, targetCommit, 'src-tauri/tauri.conf.json'),
    'target'
  )
  if (!deepEqualJson(baseTauri.comparable, targetTauri.comparable)) {
    throw new Error('tauri.conf.json changed outside the top-level version')
  }

  const baseCargo = replaceTopLevelPackageVersion(
    showFile(repository, baseCommit, 'src-tauri/Cargo.toml'),
    'base'
  )
  const targetCargo = replaceTopLevelPackageVersion(
    showFile(repository, targetCommit, 'src-tauri/Cargo.toml'),
    'target'
  )
  if (baseCargo.comparable !== targetCargo.comparable) {
    throw new Error('Cargo.toml changed outside the top-level [package] version')
  }

  const baseLock = replaceBiyanLockVersion(
    showFile(repository, baseCommit, 'src-tauri/Cargo.lock'),
    'base'
  )
  const targetLock = replaceBiyanLockVersion(
    showFile(repository, targetCommit, 'src-tauri/Cargo.lock'),
    'target'
  )
  if (baseLock.comparable !== targetLock.comparable) {
    throw new Error('Cargo.lock changed outside the Biyan package version')
  }

  const baseVersions = [baseTauri.version, baseCargo.version, baseLock.version]
  const targetVersions = [targetTauri.version, targetCargo.version, targetLock.version]
  if (!baseVersions.every((version) => version === baseVersions[0])) {
    throw new Error('base checkpoint version fields disagree')
  }
  if (!targetVersions.every((version) => version === targetVersions[0])) {
    throw new Error('target checkpoint version fields disagree')
  }
  if (compareSemverPrecedence(targetVersions[0], baseVersions[0]) <= 0) {
    throw new Error('checkpoint transition must advance to a strictly higher version')
  }

  return withPlanSha256({
    valid: true,
    base: baseCommit,
    target: targetCommit,
    changedFiles: normalizedFiles,
    baseVersion: baseVersions[0],
    targetVersion: targetVersions[0],
    baseMigrationPhase: baseRelease.migrationPhase,
    targetMigrationPhase: targetRelease.migrationPhase,
    baseDataSchema: baseRelease.dataSchema,
    targetDataSchema: targetRelease.dataSchema,
  })
}

function parseCliArgs(argv) {
  const [command, ...rest] = argv
  if (!['classify', 'verify-checkpoint'].includes(command)) {
    throw new TypeError('expected classify or verify-checkpoint command')
  }
  const values = {
    command,
    format: 'json',
    forceFull: false,
    requireReplay: false,
  }
  const seen = new Set()
  for (let index = 0; index < rest.length; index += 1) {
    const option = rest[index]
    if (option === '--force-full' || option === '--require-replay') {
      if (command !== 'classify') {
        throw new TypeError(`${option} is only valid for classify`)
      }
      if (seen.has(option)) throw new TypeError(`duplicate option: ${option}`)
      seen.add(option)
      if (option === '--force-full') values.forceFull = true
      else values.requireReplay = true
      continue
    }
    if (!['--repo', '--base', '--target', '--format'].includes(option)) {
      throw new TypeError(`unknown option: ${option}`)
    }
    if (seen.has(option)) throw new TypeError(`duplicate option: ${option}`)
    seen.add(option)
    const value = rest[++index]
    if (value === undefined || value.startsWith('--')) {
      throw new TypeError(`missing value for ${option}`)
    }
    values[option.slice(2)] = value
  }
  for (const required of ['repo', 'base', 'target']) {
    if (!values[required]) throw new TypeError(`--${required} is required`)
  }
  if (values.forceFull && values.requireReplay) {
    throw new TypeError('--force-full and --require-replay are mutually exclusive')
  }
  if (!['json', 'github-output'].includes(values.format)) {
    throw new TypeError('--format must be json or github-output')
  }
  return values
}

function blockedClassification(message) {
  return withPlanSha256({
    classification: 'blocked',
    changedFiles: [],
    categories: {
      empty: false,
      docsOnly: false,
      checkpointOnly: false,
      testOnly: false,
      policyVerifierOnly: false,
      updaterDistributionOnly: false,
      platformPackaging: { macos: false, windows: false, linux: false },
      runtimeDependency: false,
      controlPlane: false,
      unknown: true,
    },
    flags: fullQualificationFlags(),
    blocked: true,
    reasons: [message],
  })
}

function blockedVerification(message, { base, target } = {}) {
  return withPlanSha256({
    valid: false,
    base: SHA_PATTERN.test(base ?? '') ? base.toLowerCase() : null,
    target: SHA_PATTERN.test(target ?? '') ? target.toLowerCase() : null,
    errors: [message],
  })
}

function githubOutput(result, { verification = false } = {}) {
  if (verification) {
    return [
      `checkpoint_valid=${result.valid ? 'true' : 'false'}`,
      `plan_sha256=${result.planSha256}`,
      `target_version=${result.targetVersion ?? ''}`,
      `migration_phase=${result.targetMigrationPhase ?? ''}`,
      `data_schema=${result.targetDataSchema ?? ''}`,
      `verification_json=${JSON.stringify(result)}`,
    ].join('\n')
  }
  return [
    `classification=${result.classification}`,
    `blocked=${result.blocked ? 'true' : 'false'}`,
    `plan_sha256=${result.planSha256}`,
    ...FLAG_KEYS.map(
      (key) => `${GITHUB_FLAG_NAMES[key]}=${result.flags[key] ? 'true' : 'false'}`
    ),
    `changed_files_json=${JSON.stringify(result.changedFiles)}`,
    `classification_json=${JSON.stringify(result)}`,
  ].join('\n')
}

function writeResult(result, format, options) {
  const output =
    format === 'github-output'
      ? githubOutput(result, options)
      : JSON.stringify(result, null, 2)
  process.stdout.write(`${output}\n`)
}

function runCli(argv) {
  let parsed
  try {
    parsed = parseCliArgs(argv)
  } catch (error) {
    const result = blockedClassification(error.message)
    writeResult(result, 'json')
    process.exitCode = 1
    return
  }

  try {
    if (parsed.command === 'verify-checkpoint') {
      const verification = verifyCheckpoint(parsed)
      writeResult(verification, parsed.format, { verification: true })
      return
    }

    const repository = path.resolve(parsed.repo)
    const base = validateCommit(repository, parsed.base, 'base')
    const target = validateCommit(repository, parsed.target, 'target')
    validateAncestry(repository, base, target)
    const { files, rawEntries } = changedFilesFromGit(repository, base, target)
    const deletedPaths = rawEntries
      .filter((entry) => entry.status === 'D')
      .flatMap((entry) => entry.paths)
    let result = classifyChangedFiles(files, {
      forceFull: parsed.forceFull,
      requireReplay: parsed.requireReplay,
      deletedPaths,
    })
    if (result.categories.checkpointOnly) {
      const checkpointVerification = verifyCheckpoint({ repo: repository, base, target })
      result.flags.checkpoint = true
      result = withPlanSha256({
        ...result,
        planSha256: undefined,
        checkpointVerification,
      })
    }
    writeResult(result, parsed.format)
  } catch (error) {
    if (parsed.command === 'verify-checkpoint') {
      const result = blockedVerification(error.message, parsed)
      writeResult(result, parsed.format, { verification: true })
    } else {
      const result = blockedClassification(error.message)
      writeResult(result, parsed.format)
    }
    process.exitCode = 1
  }
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
if (isMain) runCli(process.argv.slice(2))
