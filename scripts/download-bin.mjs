import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream, promises as fs } from 'node:fs'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import tar from 'tar'
import unzipper from 'unzipper'

const execFileAsync = promisify(execFile)
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const defaultProjectRoot = path.resolve(scriptDir, '..')
const defaultManifestPath = path.join(scriptDir, 'runtime-assets.json')
const supportedAssetKeys = [
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-x64',
  'win32-x64',
]
const archiveCacheTasks = new Map()
const retryableNetworkErrorCodes = new Set([
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETDOWN',
  'ENETUNREACH',
  'EPIPE',
  'ETIMEDOUT',
  'ERR_STREAM_PREMATURE_CLOSE',
])

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
}

export function validateRuntimeManifest(manifest) {
  requireObject(manifest, 'runtime asset manifest')
  if (manifest.schemaVersion !== 1) {
    throw new Error(
      `Unsupported runtime asset manifest schema: ${manifest.schemaVersion}`
    )
  }
  requireObject(manifest.tools, 'runtime asset manifest tools')

  for (const toolName of ['bun', 'uv']) {
    const tool = manifest.tools[toolName]
    requireObject(tool, `${toolName} manifest`)
    if (!/^\d+\.\d+\.\d+$/.test(tool.version)) {
      throw new Error(`${toolName} version must be an exact semantic version`)
    }
    if (!/^[\w.-]+\/[\w.-]+$/.test(tool.repository)) {
      throw new Error(`${toolName} repository is invalid`)
    }
    if (!tool.releaseTag || /latest/i.test(tool.releaseTag)) {
      throw new Error(`${toolName} release tag must be pinned`)
    }
    if (!tool.releaseTag.includes(tool.version)) {
      throw new Error(
        `${toolName} release tag must include version ${tool.version}`
      )
    }
    requireObject(tool.assets, `${toolName} assets`)

    for (const assetKey of supportedAssetKeys) {
      const asset = tool.assets[assetKey]
      requireObject(asset, `${toolName} ${assetKey} asset`)
      if (!asset.archive || path.basename(asset.archive) !== asset.archive) {
        throw new Error(`${toolName} ${assetKey} archive name is invalid`)
      }
      if (!['zip', 'tar.gz'].includes(asset.format)) {
        throw new Error(`${toolName} ${assetKey} archive format is unsupported`)
      }
      if (!asset.binaryPath || path.isAbsolute(asset.binaryPath)) {
        throw new Error(`${toolName} ${assetKey} binary path is invalid`)
      }
      if (asset.binaryPath.split(/[\\/]/).some((segment) => segment === '..')) {
        throw new Error(
          `${toolName} ${assetKey} binary path escapes its archive`
        )
      }
      if (!asset.target) {
        throw new Error(`${toolName} ${assetKey} target is required`)
      }
      if (!/^[a-f0-9]{64}$/.test(asset.sha256)) {
        throw new Error(`${toolName} ${assetKey} SHA-256 is invalid`)
      }
      if (/\/latest(?:\/|$)/i.test(asset.url)) {
        throw new Error(
          `${toolName} ${assetKey} must not use a latest-release URL`
        )
      }

      const expectedUrl = `https://github.com/${tool.repository}/releases/download/${tool.releaseTag}/${asset.archive}`
      if (asset.url !== expectedUrl) {
        throw new Error(
          `${toolName} ${assetKey} URL must match the pinned official release`
        )
      }
      if (assetKey.startsWith('darwin-') && !asset.lipoArch) {
        throw new Error(`${toolName} ${assetKey} lipo architecture is required`)
      }
    }
  }

  return manifest
}

export async function loadRuntimeManifest(manifestPath = defaultManifestPath) {
  const contents = await fs.readFile(manifestPath, 'utf8')
  return validateRuntimeManifest(JSON.parse(contents))
}

function normalizeHostArch(platform, arch) {
  if (platform === 'win32') {
    // Preserve the previous Windows behavior until native arm64 sidecars are shipped.
    return 'x64'
  }
  if (arch === 'x64' || arch === 'arm64') {
    return arch
  }
  throw new Error(`Unsupported architecture for ${platform}: ${arch}`)
}

export function buildRuntimePlan(manifest, platform, arch) {
  validateRuntimeManifest(manifest)
  if (!['darwin', 'linux', 'win32'].includes(platform)) {
    throw new Error(`Unsupported platform: ${platform}`)
  }

  const assetKeys =
    platform === 'darwin'
      ? ['darwin-arm64', 'darwin-x64']
      : [`${platform}-${normalizeHostArch(platform, arch)}`]

  return {
    platform,
    arch,
    tools: Object.entries(manifest.tools).map(([name, tool]) => {
      const extension = platform === 'win32' ? '.exe' : ''
      return {
        name,
        version: tool.version,
        defaultOutputName: `${name}${extension}`,
        universalOutputName:
          platform === 'darwin' ? `${name}-universal-apple-darwin` : null,
        assets: assetKeys.map((assetKey) => {
          const asset = tool.assets[assetKey]
          return {
            ...asset,
            key: assetKey,
            outputName: `${name}-${asset.target}${extension}`,
          }
        }),
      }
    }),
  }
}

export async function sha256File(filePath) {
  const hash = createHash('sha256')
  await pipeline(createReadStream(filePath), hash)
  return hash.digest('hex')
}

export async function assertFileSha256(filePath, expectedSha256) {
  const actualSha256 = await sha256File(filePath)
  if (actualSha256 !== expectedSha256) {
    throw new Error(
      `SHA-256 mismatch for ${filePath}: expected ${expectedSha256}, got ${actualSha256}`
    )
  }
}

export async function downloadUrlToFile(
  url,
  destination,
  { httpsGet = https.get, maxRedirects = 5 } = {}
) {
  async function request(currentUrl, redirectsRemaining) {
    await new Promise((resolve, reject) => {
      const requestHandle = httpsGet(currentUrl, (response) => {
        const statusCode = response.statusCode ?? 0
        const location = response.headers?.location

        if (statusCode >= 300 && statusCode < 400 && location) {
          response.resume()
          if (redirectsRemaining === 0) {
            reject(new Error(`Too many redirects while downloading ${url}`))
            return
          }
          let redirectUrl
          try {
            redirectUrl = new URL(location, currentUrl).toString()
          } catch (error) {
            reject(
              new Error(`Invalid redirect URL while downloading ${url}`, {
                cause: error,
              })
            )
            return
          }
          request(redirectUrl, redirectsRemaining - 1).then(resolve, reject)
          return
        }

        if (statusCode !== 200) {
          response.resume()
          const error = new Error(
            `Failed to download ${currentUrl} (HTTP ${statusCode})`
          )
          error.statusCode = statusCode
          reject(error)
          return
        }

        pipeline(
          response,
          createWriteStream(destination, { flags: 'wx' })
        ).then(resolve, reject)
      })
      requestHandle.on('error', reject)
    })
  }

  await request(url, maxRedirects)
}

function isRetryableDownloadError(error) {
  if (retryableNetworkErrorCodes.has(error?.code)) return true
  const statusCode = Number(error?.statusCode)
  return (
    statusCode === 408 ||
    statusCode === 425 ||
    statusCode === 429 ||
    (statusCode >= 500 && statusCode <= 599)
  )
}

async function downloadWithRetry(
  asset,
  partialPath,
  { downloadFile, maxDownloadAttempts, retryDelay, removePartial = fs.rm }
) {
  for (let attempt = 1; attempt <= maxDownloadAttempts; attempt += 1) {
    try {
      await downloadFile(asset.url, partialPath)
      return
    } catch (error) {
      await removePartial(partialPath, { force: true })
      if (attempt === maxDownloadAttempts || !isRetryableDownloadError(error)) {
        throw error
      }
      const delayMs = 500 * 2 ** (attempt - 1)
      console.warn(
        `Transient download failure for ${asset.archive} (attempt ${attempt}/${maxDownloadAttempts}): ${error.message}. Retrying in ${delayMs}ms.`
      )
      await retryDelay(delayMs)
    }
  }
}

async function populateCachedArchive(
  asset,
  cacheDir,
  {
    downloadFile = downloadUrlToFile,
    maxDownloadAttempts = 3,
    retryDelay = (delayMs) =>
      new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs)),
    uniqueId = randomUUID,
  } = {}
) {
  const cachePath = path.join(cacheDir, asset.archive)

  try {
    await fs.access(cachePath)
    await assertFileSha256(cachePath, asset.sha256)
    return cachePath
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error
    }
  }

  const partialPath = `${cachePath}.${process.pid}.${uniqueId()}.part`
  try {
    console.log(`Downloading ${asset.url}`)
    await downloadWithRetry(asset, partialPath, {
      downloadFile,
      maxDownloadAttempts,
      retryDelay,
    })
    await assertFileSha256(partialPath, asset.sha256)
    try {
      await fs.rename(partialPath, cachePath)
    } catch (error) {
      if (!['EEXIST', 'EPERM', 'EACCES'].includes(error.code)) {
        throw error
      }
      // Another process may have won the same atomic cache write on Windows.
      // Accept it only after verifying it is byte-for-byte the pinned asset.
      await assertFileSha256(cachePath, asset.sha256)
    }
    await assertFileSha256(cachePath, asset.sha256)
    return cachePath
  } finally {
    await fs.rm(partialPath, { force: true })
  }
}

export async function ensureCachedArchive(
  asset,
  cacheDir,
  {
    downloadFile = downloadUrlToFile,
    maxDownloadAttempts = 3,
    retryDelay,
    uniqueId = randomUUID,
  } = {}
) {
  await fs.mkdir(cacheDir, { recursive: true })
  const cachePath = path.resolve(cacheDir, asset.archive)
  const cacheTaskKey = `${cachePath}\0${asset.sha256}`
  let cacheTask = archiveCacheTasks.get(cacheTaskKey)
  if (!cacheTask) {
    cacheTask = populateCachedArchive(asset, cacheDir, {
      downloadFile,
      maxDownloadAttempts,
      retryDelay,
      uniqueId,
    })
    archiveCacheTasks.set(cacheTaskKey, cacheTask)
  }

  try {
    return await cacheTask
  } finally {
    if (archiveCacheTasks.get(cacheTaskKey) === cacheTask) {
      archiveCacheTasks.delete(cacheTaskKey)
    }
  }
}

export async function extractArchive(archivePath, targetDir, format) {
  await fs.rm(targetDir, { recursive: true, force: true })
  await fs.mkdir(targetDir, { recursive: true })

  if (format === 'zip') {
    await createReadStream(archivePath)
      .pipe(unzipper.Extract({ path: targetDir }))
      .promise()
    return
  }
  if (format === 'tar.gz') {
    await tar.x({ file: archivePath, cwd: targetDir })
    return
  }
  throw new Error(`Unsupported archive format: ${format}`)
}

async function replaceFileAtomically(sourcePath, destinationPath) {
  try {
    await fs.rename(sourcePath, destinationPath)
  } catch (error) {
    if (!['EEXIST', 'EPERM'].includes(error.code)) {
      throw error
    }
    await fs.rm(destinationPath, { force: true })
    await fs.rename(sourcePath, destinationPath)
  }
}

export async function installExecutable(
  sourcePath,
  destinationPath,
  { uniqueId = randomUUID } = {}
) {
  const sourceStat = await fs.stat(sourcePath)
  if (!sourceStat.isFile()) {
    throw new Error(`Runtime binary is not a file: ${sourcePath}`)
  }

  await fs.mkdir(path.dirname(destinationPath), { recursive: true })
  const temporaryPath = `${destinationPath}.${process.pid}.${uniqueId()}.tmp`
  try {
    await fs.copyFile(sourcePath, temporaryPath)
    await fs.chmod(temporaryPath, 0o755)
    await replaceFileAtomically(temporaryPath, destinationPath)
  } finally {
    await fs.rm(temporaryPath, { force: true })
  }
}

async function runCommand(command, args) {
  return execFileAsync(command, args, { encoding: 'utf8' })
}

function parseLipoArchitectures(stdout) {
  return new Set(stdout.trim().split(/\s+/).filter(Boolean))
}

export async function assertDarwinArchitectures(
  binaryPath,
  expectedArchitectures,
  { execute = runCommand } = {}
) {
  const { stdout } = await execute('lipo', ['-archs', binaryPath])
  const actual = parseLipoArchitectures(stdout)
  const expected = new Set(expectedArchitectures)
  if (
    actual.size !== expected.size ||
    [...expected].some((architecture) => !actual.has(architecture))
  ) {
    throw new Error(
      `Unexpected architectures for ${binaryPath}: expected ${[
        ...expected,
      ].join(', ')}, got ${[...actual].join(', ') || '(none)'}`
    )
  }
}

export async function mergeDarwinUniversal(
  thinBinaryPaths,
  destinationPath,
  { execute = runCommand, uniqueId = randomUUID } = {}
) {
  const temporaryPath = `${destinationPath}.${process.pid}.${uniqueId()}.tmp`
  try {
    await execute('lipo', [
      '-create',
      ...thinBinaryPaths,
      '-output',
      temporaryPath,
    ])
    await fs.chmod(temporaryPath, 0o755)
    await assertDarwinArchitectures(temporaryPath, ['arm64', 'x86_64'], {
      execute,
    })
    await replaceFileAtomically(temporaryPath, destinationPath)
  } finally {
    await fs.rm(temporaryPath, { force: true })
  }
}

export async function provisionRuntimeAssets(
  plan,
  {
    projectRoot = defaultProjectRoot,
    cacheRoot = path.join(projectRoot, 'scripts/dist/runtime-cache'),
    extractionRoot = path.join(projectRoot, 'scripts/dist/runtime-extract'),
    binDir = path.join(projectRoot, 'src-tauri/resources/bin'),
    ensureArchive = ensureCachedArchive,
    downloadFile = downloadUrlToFile,
    extract = extractArchive,
    install = installExecutable,
    assertArchitectures = assertDarwinArchitectures,
    mergeUniversal = mergeDarwinUniversal,
    remove = fs.rm,
    uniqueId = randomUUID,
  } = {}
) {
  await fs.mkdir(binDir, { recursive: true })
  await fs.mkdir(extractionRoot, { recursive: true })

  for (const tool of plan.tools) {
    const thinBinaryPaths = []
    for (const asset of tool.assets) {
      const cacheDir = path.join(cacheRoot, tool.name, tool.version)
      const archivePath = await ensureArchive(asset, cacheDir, {
        downloadFile,
        uniqueId,
      })
      const extractionDir = path.join(
        extractionRoot,
        `${tool.name}-${asset.key}-${uniqueId()}`
      )

      try {
        await extract(archivePath, extractionDir, asset.format)
        const extractedBinaryPath = path.join(extractionDir, asset.binaryPath)
        const installedBinaryPath = path.join(binDir, asset.outputName)
        await install(extractedBinaryPath, installedBinaryPath, { uniqueId })
        if (plan.platform === 'darwin') {
          await assertArchitectures(installedBinaryPath, [asset.lipoArch])
        }
        thinBinaryPaths.push(installedBinaryPath)
      } finally {
        await remove(extractionDir, { recursive: true, force: true })
      }
    }

    const defaultOutputPath = path.join(binDir, tool.defaultOutputName)
    if (plan.platform === 'darwin') {
      const universalOutputPath = path.join(binDir, tool.universalOutputName)
      await mergeUniversal(thinBinaryPaths, universalOutputPath)
      await assertArchitectures(universalOutputPath, ['arm64', 'x86_64'])
      await install(universalOutputPath, defaultOutputPath, { uniqueId })
      await assertArchitectures(defaultOutputPath, ['arm64', 'x86_64'])
    } else {
      await install(thinBinaryPaths[0], defaultOutputPath, { uniqueId })
    }
  }
}

export async function main({
  platform = os.platform(),
  arch = os.arch(),
  projectRoot = defaultProjectRoot,
  manifestPath = defaultManifestPath,
} = {}) {
  if (process.env.SKIP_BINARIES) {
    console.log('Skipping binaries download.')
    return
  }

  const manifest = await loadRuntimeManifest(manifestPath)
  const plan = buildRuntimePlan(manifest, platform, arch)
  console.log(
    `Preparing pinned runtime assets for ${platform}/${arch}: ${plan.tools
      .map((tool) => `${tool.name}@${tool.version}`)
      .join(', ')}`
  )
  await provisionRuntimeAssets(plan, { projectRoot })
  console.log('Runtime assets are ready.')
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error('Runtime asset preparation failed:', error)
    process.exitCode = 1
  })
}
