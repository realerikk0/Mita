import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import crossSpawn from 'cross-spawn'

const CORE_ARCHIVE_SPEC = '../../core/package.tgz'
const EXPECTED_WORKSPACES = [
  'assistant-extension',
  'conversational-extension',
  'download-extension',
]

const DEFAULT_REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
)

function expectedCoreKey(workspace) {
  const locator = encodeURIComponent(
    `@biyan/${workspace}@workspace:${workspace}`
  )
  return `@biyan/core@file:${CORE_ARCHIVE_SPEC}::locator=${locator}`
}

const EXPECTED_CORE_KEYS = EXPECTED_WORKSPACES.map(expectedCoreKey)

function fail(message) {
  throw new Error(`Unsafe extensions lockfile update: ${message}`)
}

function inspectCoreLock(lockfile) {
  const lines = lockfile.replaceAll('\r\n', '\n').split('\n')
  const coreKeyLines = lines
    .filter((line) => line.startsWith('"@biyan/core@'))
    .map((line) => (line.endsWith(':') ? line.slice(1, -2) : line))

  if (
    coreKeyLines.length !== EXPECTED_CORE_KEYS.length ||
    [...coreKeyLines].sort().join('\n') !==
      [...EXPECTED_CORE_KEYS].sort().join('\n')
  ) {
    fail(
      `expected only ${EXPECTED_CORE_KEYS.length} reviewed @biyan/core file locators`
    )
  }

  const records = []
  const normalizedLines = [...lines]

  for (const key of EXPECTED_CORE_KEYS) {
    const keyLine = `"${key}":`
    const start = lines.indexOf(keyLine)
    if (start === -1) fail(`missing locator ${key}`)

    let end = lines.length
    for (let index = start + 1; index < lines.length; index += 1) {
      if (/^\S.*:$/.test(lines[index])) {
        end = index
        break
      }
    }

    const locator = key.slice(key.indexOf('::locator=') + '::locator='.length)
    const resolutionPrefix =
      `  resolution: "@biyan/core@file:${CORE_ARCHIVE_SPEC}` +
      `#${CORE_ARCHIVE_SPEC}::hash=`
    const resolutionSuffix = `&locator=${locator}"`
    const resolutionRecords = []
    const checksumIndexes = []

    for (let index = start + 1; index < end; index += 1) {
      const line = lines[index]
      if (
        line.startsWith(resolutionPrefix) &&
        line.endsWith(resolutionSuffix)
      ) {
        const hash = line.slice(
          resolutionPrefix.length,
          line.length - resolutionSuffix.length
        )
        if (/^[0-9a-f]{6}$/.test(hash)) {
          resolutionRecords.push({ hash, index })
        }
      }
      if (/^  checksum: \S+$/.test(line)) checksumIndexes.push(index)
    }

    if (resolutionRecords.length !== 1) {
      fail(`locator ${key} must contain exactly one reviewed resolution`)
    }
    if (checksumIndexes.length !== 1) {
      fail(`locator ${key} must contain exactly one checksum`)
    }

    const [{ hash, index: resolutionIndex }] = resolutionRecords
    const checksumIndex = checksumIndexes[0]
    const checksum = lines[checksumIndex].slice('  checksum: '.length)

    normalizedLines[resolutionIndex] =
      `${resolutionPrefix}<reviewed-core-archive>${resolutionSuffix}`
    normalizedLines[checksumIndex] =
      '  checksum: <reviewed-core-package-checksum>'

    records.push({ checksum, hash, key })
  }

  return {
    normalized: normalizedLines.join('\n'),
    records,
  }
}

export function validateCoreLockTransition(originalLock, updatedLock, archiveHash) {
  const original = inspectCoreLock(originalLock)
  const updated = inspectCoreLock(updatedLock)

  if (original.normalized !== updated.normalized) {
    fail('a dependency outside the three reviewed @biyan/core records changed')
  }

  const originalHashes = new Set(original.records.map(({ hash }) => hash))
  const updatedHashes = new Set(updated.records.map(({ hash }) => hash))
  const originalChecksums = new Set(
    original.records.map(({ checksum }) => checksum)
  )
  const updatedChecksums = new Set(
    updated.records.map(({ checksum }) => checksum)
  )

  if (originalHashes.size !== 1 || updatedHashes.size !== 1) {
    fail('all three @biyan/core records must use one archive hash')
  }
  if (originalChecksums.size !== 1 || updatedChecksums.size !== 1) {
    fail('all three @biyan/core records must use one package checksum')
  }

  const updatedHash = updated.records[0].hash
  if (updatedHash !== archiveHash) {
    fail(
      `temporary locator hash ${updatedHash} does not match core/package.tgz ${archiveHash}`
    )
  }

  const hashChanges = updated.records.filter(
    ({ hash }, index) => hash !== original.records[index].hash
  ).length
  const checksumChanges = updated.records.filter(
    ({ checksum }, index) => checksum !== original.records[index].checksum
  ).length

  if (![0, EXPECTED_CORE_KEYS.length].includes(hashChanges)) {
    fail('the core archive hash must change for either zero or all three locators')
  }
  if (![0, EXPECTED_CORE_KEYS.length].includes(checksumChanges)) {
    fail('the core checksum must change for either zero or all three locators')
  }
  if (checksumChanges > 0 && hashChanges === 0) {
    fail('a core checksum cannot change without its archive hash changing')
  }

  return {
    archiveHash,
    checksumChanges,
    hashChanges,
  }
}

export function buildYarnInvocation(platform, args, environment = process.env) {
  if (!args.every((arg) => /^[A-Za-z0-9_./:=+-]+$/.test(arg))) {
    throw new Error('Refusing to pass an unsafe Yarn argument')
  }

  const yarnExecutable = environment.npm_execpath
  if (!yarnExecutable) {
    throw new Error('Run the extension installer through the repository Yarn')
  }
  if (/[\0\r\n"]/.test(yarnExecutable)) {
    throw new Error('Refusing an unsafe npm_execpath')
  }
  if (platform === 'win32' && /[%!^<>&|]/.test(yarnExecutable)) {
    throw new Error('Refusing Windows command metacharacters in npm_execpath')
  }

  return { command: yarnExecutable, args }
}

export function buildYarnEnvironment(environment, immutable) {
  return {
    ...environment,
    YARN_ENABLE_IMMUTABLE_INSTALLS: immutable ? 'true' : 'false',
  }
}

function executeYarn(args, { cwd, immutable }) {
  const invocation = buildYarnInvocation(process.platform, args)
  const result = crossSpawn.sync(invocation.command, invocation.args, {
    cwd,
    env: buildYarnEnvironment(process.env, immutable),
    stdio: 'inherit',
  })

  if (result.error) throw result.error
  if (result.status !== 0) {
    const detail = result.signal ? `signal ${result.signal}` : `status ${result.status}`
    throw new Error(`Yarn ${args.join(' ')} failed with ${detail}`)
  }
}

function verifyWorkspaceManifests(extensionsRoot) {
  for (const workspace of EXPECTED_WORKSPACES) {
    const manifestPath = path.join(extensionsRoot, workspace, 'package.json')
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    if (manifest.dependencies?.['@biyan/core'] !== CORE_ARCHIVE_SPEC) {
      fail(`${workspace} must depend on exactly ${CORE_ARCHIVE_SPEC}`)
    }
  }
}

export function installExtensions({
  repoRoot = DEFAULT_REPO_ROOT,
  execute = executeYarn,
  handleSignals = true,
} = {}) {
  const extensionsRoot = path.join(repoRoot, 'extensions')
  const lockPath = path.join(extensionsRoot, 'yarn.lock')
  const archivePath = path.join(repoRoot, 'core', 'package.tgz')

  verifyWorkspaceManifests(extensionsRoot)

  const originalLock = fs.readFileSync(lockPath, 'utf8')
  const archiveHash = crypto
    .createHash('sha512')
    .update(fs.readFileSync(archivePath))
    .digest('hex')
    .slice(0, 6)
  let restored = false

  const restoreLock = () => {
    if (restored) return
    fs.writeFileSync(lockPath, originalLock)
    restored = true
  }

  const signalHandlers = new Map()
  if (handleSignals) {
    for (const [signal, exitCode] of [
      ['SIGINT', 130],
      ['SIGTERM', 143],
    ]) {
      const handler = () => {
        try {
          restoreLock()
        } finally {
          process.exit(exitCode)
        }
      }
      signalHandlers.set(signal, handler)
      process.once(signal, handler)
    }
  }

  try {
    execute(['install', '--mode=update-lockfile'], {
      cwd: extensionsRoot,
      immutable: false,
    })
    const temporaryLock = fs.readFileSync(lockPath, 'utf8')
    const report = validateCoreLockTransition(
      originalLock,
      temporaryLock,
      archiveHash
    )

    execute(['install', '--immutable'], {
      cwd: extensionsRoot,
      immutable: true,
    })
    if (fs.readFileSync(lockPath, 'utf8') !== temporaryLock) {
      fail('the final immutable install changed the validated temporary lock')
    }

    return report
  } finally {
    restoreLock()
    for (const [signal, handler] of signalHandlers) {
      process.removeListener(signal, handler)
    }
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const report = installExtensions()
    console.log(
      `Extensions installed with immutable third-party lock; core hash changes=${report.hashChanges}, checksum changes=${report.checksumChanges}`
    )
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
