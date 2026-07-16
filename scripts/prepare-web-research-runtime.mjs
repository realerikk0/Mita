import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const EXPECTED_FFMPEG_REVISION_OVERRIDES = Object.freeze({
  'mac12': '1010',
  'mac12-arm64': '1010',
})

export const EXPECTED_PLAYWRIGHT_RUNTIME = Object.freeze({
  version: '1.59.1',
  chromiumHeadlessShellRevision: '1217',
  ffmpegRevision: '1011',
  ffmpegRevisionOverrides: EXPECTED_FFMPEG_REVISION_OVERRIDES,
})

const MACOS_RUNTIME_PLATFORMS = Object.freeze([
  {
    architecture: 'arm64',
    browserDirectory: 'chrome-headless-shell-mac-arm64',
    hostPlatform: 'mac15-arm64',
  },
  {
    architecture: 'x86_64',
    browserDirectory: 'chrome-headless-shell-mac-x64',
    hostPlatform: 'mac15',
  },
])

const MACOS_FFMPEG_OVERRIDE_PLATFORMS = Object.freeze([
  {
    architecture: 'arm64',
    hostPlatform: 'mac12-arm64',
  },
  {
    architecture: 'x86_64',
    hostPlatform: 'mac12',
  },
])

const RUNTIME_PACKAGES = ['playwright', 'playwright-core']

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`Unable to read ${label} at ${path}: ${error.message}`)
  }
}

function findBrowser(browsers, name) {
  const browser = browsers.find((entry) => entry.name === name)
  if (!browser || typeof browser.revision !== 'string') {
    throw new Error(`Playwright browsers.json is missing the ${name} revision`)
  }
  return browser
}

export function loadPlaywrightRuntimeMetadata(root) {
  const playwrightPackagePath = resolve(
    root,
    'node_modules/playwright/package.json'
  )
  const playwrightCorePath = resolve(root, 'node_modules/playwright-core')
  const playwrightCorePackagePath = resolve(playwrightCorePath, 'package.json')
  const browsersJsonPath = resolve(playwrightCorePath, 'browsers.json')

  if (
    !existsSync(playwrightPackagePath) ||
    !existsSync(playwrightCorePackagePath)
  ) {
    throw new Error(
      'Missing Playwright packages. Run yarn install before preparing Web Research runtime.'
    )
  }

  const playwrightPackage = readJson(
    playwrightPackagePath,
    'playwright package metadata'
  )
  const playwrightCorePackage = readJson(
    playwrightCorePackagePath,
    'playwright-core package metadata'
  )
  const browsersJson = readJson(
    browsersJsonPath,
    'playwright-core browsers metadata'
  )

  if (!Array.isArray(browsersJson.browsers)) {
    throw new Error(
      `Playwright browsers.json at ${browsersJsonPath} has no browsers list`
    )
  }

  const chromiumHeadlessShell = findBrowser(
    browsersJson.browsers,
    'chromium-headless-shell'
  )
  const ffmpeg = findBrowser(browsersJson.browsers, 'ffmpeg')

  return {
    playwrightVersion: playwrightPackage.version,
    playwrightCoreVersion: playwrightCorePackage.version,
    chromiumHeadlessShellRevision: chromiumHeadlessShell.revision,
    ffmpegRevision: ffmpeg.revision,
    ffmpegRevisionOverrides: { ...(ffmpeg.revisionOverrides ?? {}) },
    cliPath: resolve(root, 'node_modules/playwright/cli.js'),
  }
}

export function verifyPlaywrightRuntimeMetadata(metadata) {
  const expected = EXPECTED_PLAYWRIGHT_RUNTIME
  const checks = [
    ['playwright version', metadata.playwrightVersion, expected.version],
    [
      'playwright-core version',
      metadata.playwrightCoreVersion,
      expected.version,
    ],
    [
      'chromium-headless-shell revision',
      metadata.chromiumHeadlessShellRevision,
      expected.chromiumHeadlessShellRevision,
    ],
    ['ffmpeg revision', metadata.ffmpegRevision, expected.ffmpegRevision],
  ]

  for (const [label, actual, wanted] of checks) {
    if (actual !== wanted) {
      throw new Error(
        `Unsupported ${label}: expected ${wanted}, received ${String(actual)}`
      )
    }
  }

  const actualOverrideKeys = Object.keys(
    metadata.ffmpegRevisionOverrides ?? {}
  ).sort()
  const expectedOverrideKeys = Object.keys(
    expected.ffmpegRevisionOverrides
  ).sort()
  if (actualOverrideKeys.join('\0') !== expectedOverrideKeys.join('\0')) {
    throw new Error(
      `Unsupported ffmpeg revision override platforms: expected [${expectedOverrideKeys.join(', ')}], received [${actualOverrideKeys.join(', ')}]`
    )
  }

  for (const hostPlatform of expectedOverrideKeys) {
    const actualRevision = metadata.ffmpegRevisionOverrides[hostPlatform]
    const expectedRevision = expected.ffmpegRevisionOverrides[hostPlatform]
    if (actualRevision !== expectedRevision) {
      throw new Error(
        `Unsupported ffmpeg revision override for ${hostPlatform}: expected ${expectedRevision}, received ${String(actualRevision)}`
      )
    }
  }

  if (!existsSync(metadata.cliPath)) {
    throw new Error(`Missing Playwright CLI at ${metadata.cliPath}`)
  }
}

export function runCommand(command, args, options = {}) {
  const captureOutput = options.captureOutput === true
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    stdio: captureOutput ? 'pipe' : 'inherit',
  })

  if (result.error) {
    throw new Error(`Failed to run ${command}: ${result.error.message}`)
  }
  if (result.signal) {
    throw new Error(`Command ${command} terminated by signal ${result.signal}`)
  }
  if (result.status !== 0) {
    const stderr = captureOutput ? result.stderr.trim() : ''
    throw new Error(
      `Command ${command} exited with status ${String(result.status)}${stderr ? `: ${stderr}` : ''}`
    )
  }

  return captureOutput ? result.stdout.trim() : ''
}

function requirePath(path, label) {
  if (!existsSync(path)) {
    throw new Error(`Missing ${label}: ${path}`)
  }
}

function ffmpegOverrideRevisionDirectory(metadata, hostPlatform) {
  const revision = metadata.ffmpegRevisionOverrides[hostPlatform]
  return `ffmpeg_${hostPlatform.replaceAll('-', '_')}_special-${revision}`
}

function readMachOArchitectures(path, commandRunner) {
  const output = commandRunner('lipo', ['-archs', path], {
    captureOutput: true,
  })
  return new Set(String(output).match(/\b(?:arm64|x86_64)\b/g) ?? [])
}

function requireExactArchitectures(path, expected, label, commandRunner) {
  const actual = readMachOArchitectures(path, commandRunner)
  const hasExactArchitectures =
    actual.size === expected.length &&
    expected.every((architecture) => actual.has(architecture))

  if (!hasExactArchitectures) {
    throw new Error(
      `${label} has architectures [${[...actual].join(', ')}], expected [${expected.join(', ')}]`
    )
  }
}

function removeLinksAndRejectAbsoluteSymlinks(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.name === '.links') {
      rmSync(path, { recursive: true, force: true })
      continue
    }

    const status = lstatSync(path)
    if (status.isSymbolicLink()) {
      const target = readlinkSync(path)
      if (isAbsolute(target)) {
        throw new Error(
          `Bundled Playwright runtime contains an absolute symlink: ${path} -> ${target}`
        )
      }
      continue
    }

    if (status.isDirectory()) {
      removeLinksAndRejectAbsoluteSymlinks(path)
    }
  }
}

function replaceDirectory(source, destination) {
  const backup = `${destination}.previous-${process.pid}`
  rmSync(backup, { recursive: true, force: true })

  if (existsSync(destination)) {
    renameSync(destination, backup)
  }

  try {
    renameSync(source, destination)
    rmSync(backup, { recursive: true, force: true })
  } catch (error) {
    rmSync(destination, { recursive: true, force: true })
    if (existsSync(backup)) {
      renameSync(backup, destination)
    }
    throw error
  }
}

export function prepareUniversalMacOSBrowserRuntime({
  root,
  metadata,
  commandRunner = runCommand,
  environment = process.env,
  log = console.log,
}) {
  const resourcesDirectory = resolve(root, 'src-tauri/resources')
  const destination = resolve(resourcesDirectory, 'ms-playwright')
  mkdirSync(resourcesDirectory, { recursive: true })

  const stagingRoot = mkdtempSync(
    resolve(resourcesDirectory, '.ms-playwright-staging-')
  )
  const mergedRuntime = resolve(stagingRoot, 'merged')
  const browserRevisionDirectory = `chromium_headless_shell-${metadata.chromiumHeadlessShellRevision}`
  const ffmpegRevisionDirectory = `ffmpeg-${metadata.ffmpegRevision}`

  try {
    const browserInstallations = MACOS_RUNTIME_PLATFORMS.map((platform) => {
      const browsersPath = resolve(stagingRoot, platform.hostPlatform)
      mkdirSync(browsersPath, { recursive: true })

      log(
        `Installing Playwright ${metadata.playwrightVersion} for ${platform.hostPlatform}`
      )
      commandRunner(
        process.execPath,
        [metadata.cliPath, 'install', '--only-shell', 'chromium'],
        {
          cwd: root,
          env: {
            ...environment,
            PLAYWRIGHT_BROWSERS_PATH: browsersPath,
            PLAYWRIGHT_HOST_PLATFORM_OVERRIDE: platform.hostPlatform,
          },
        }
      )

      const browserSource = resolve(
        browsersPath,
        browserRevisionDirectory,
        platform.browserDirectory
      )
      const browserExecutable = resolve(browserSource, 'chrome-headless-shell')
      const ffmpegExecutable = resolve(
        browsersPath,
        ffmpegRevisionDirectory,
        'ffmpeg-mac'
      )
      requirePath(
        browserExecutable,
        `${platform.hostPlatform} Chromium headless shell`
      )
      requirePath(ffmpegExecutable, `${platform.hostPlatform} ffmpeg`)
      requireExactArchitectures(
        browserExecutable,
        [platform.architecture],
        `${platform.hostPlatform} Chromium headless shell`,
        commandRunner
      )
      requireExactArchitectures(
        ffmpegExecutable,
        [platform.architecture],
        `${platform.hostPlatform} ffmpeg`,
        commandRunner
      )

      return { ...platform, browserSource, ffmpegExecutable }
    })

    const ffmpegOverrideInstallations = MACOS_FFMPEG_OVERRIDE_PLATFORMS.map(
      (platform) => {
        const browsersPath = resolve(stagingRoot, platform.hostPlatform)
        mkdirSync(browsersPath, { recursive: true })

        log(
          `Installing Playwright ffmpeg ${metadata.ffmpegRevisionOverrides[platform.hostPlatform]} for ${platform.hostPlatform}`
        )
        commandRunner(
          process.execPath,
          [metadata.cliPath, 'install', 'ffmpeg'],
          {
            cwd: root,
            env: {
              ...environment,
              PLAYWRIGHT_BROWSERS_PATH: browsersPath,
              PLAYWRIGHT_HOST_PLATFORM_OVERRIDE: platform.hostPlatform,
            },
          }
        )

        const revisionDirectory = ffmpegOverrideRevisionDirectory(
          metadata,
          platform.hostPlatform
        )
        const ffmpegExecutable = resolve(
          browsersPath,
          revisionDirectory,
          'ffmpeg-mac'
        )
        requirePath(
          ffmpegExecutable,
          `${platform.hostPlatform} override ffmpeg`
        )
        requireExactArchitectures(
          ffmpegExecutable,
          [platform.architecture],
          `${platform.hostPlatform} override ffmpeg`,
          commandRunner
        )

        return { ...platform, ffmpegExecutable, revisionDirectory }
      }
    )

    const mergedBrowserDirectory = resolve(
      mergedRuntime,
      browserRevisionDirectory
    )
    const mergedFfmpegDirectory = resolve(
      mergedRuntime,
      ffmpegRevisionDirectory
    )
    mkdirSync(mergedBrowserDirectory, { recursive: true })
    mkdirSync(mergedFfmpegDirectory, { recursive: true })

    for (const installation of browserInstallations) {
      cpSync(
        installation.browserSource,
        resolve(mergedBrowserDirectory, installation.browserDirectory),
        { recursive: true, dereference: false }
      )
    }

    const universalFfmpeg = resolve(mergedFfmpegDirectory, 'ffmpeg-mac')
    commandRunner(
      'lipo',
      [
        '-create',
        browserInstallations[0].ffmpegExecutable,
        browserInstallations[1].ffmpegExecutable,
        '-output',
        universalFfmpeg,
      ],
      {}
    )
    chmodSync(universalFfmpeg, 0o755)
    requireExactArchitectures(
      universalFfmpeg,
      ['arm64', 'x86_64'],
      'universal Playwright ffmpeg',
      commandRunner
    )

    const overrideFfmpegDestinations = ffmpegOverrideInstallations.map(
      (installation) => {
        const directory = resolve(mergedRuntime, installation.revisionDirectory)
        mkdirSync(directory, { recursive: true })
        return resolve(directory, 'ffmpeg-mac')
      }
    )
    commandRunner(
      'lipo',
      [
        '-create',
        ffmpegOverrideInstallations[0].ffmpegExecutable,
        ffmpegOverrideInstallations[1].ffmpegExecutable,
        '-output',
        overrideFfmpegDestinations[0],
      ],
      {}
    )
    chmodSync(overrideFfmpegDestinations[0], 0o755)
    requireExactArchitectures(
      overrideFfmpegDestinations[0],
      ['arm64', 'x86_64'],
      'mac12-arm64 universal Playwright ffmpeg',
      commandRunner
    )
    cpSync(overrideFfmpegDestinations[0], overrideFfmpegDestinations[1])
    chmodSync(overrideFfmpegDestinations[1], 0o755)
    requireExactArchitectures(
      overrideFfmpegDestinations[1],
      ['arm64', 'x86_64'],
      'mac12 universal Playwright ffmpeg',
      commandRunner
    )

    writeFileSync(resolve(mergedBrowserDirectory, 'INSTALLATION_COMPLETE'), '')
    writeFileSync(resolve(mergedFfmpegDirectory, 'INSTALLATION_COMPLETE'), '')
    for (const installation of ffmpegOverrideInstallations) {
      writeFileSync(
        resolve(
          mergedRuntime,
          installation.revisionDirectory,
          'INSTALLATION_COMPLETE'
        ),
        ''
      )
    }
    // Preserve the tracked placeholder byte-for-byte so preparation does not
    // leave an otherwise clean source checkout dirty.
    writeFileSync(resolve(mergedRuntime, '.gitkeep'), '\n')
    removeLinksAndRejectAbsoluteSymlinks(mergedRuntime)

    replaceDirectory(mergedRuntime, destination)
    log(`Prepared universal Playwright browser runtime at ${destination}`)
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true })
  }
}

export function prepareHostBrowserRuntime({
  root,
  metadata,
  commandRunner = runCommand,
  environment = process.env,
  log = console.log,
}) {
  const resourcesDirectory = resolve(root, 'src-tauri/resources')
  const destination = resolve(resourcesDirectory, 'ms-playwright')
  mkdirSync(resourcesDirectory, { recursive: true })
  const stagingRoot = mkdtempSync(
    resolve(resourcesDirectory, '.ms-playwright-staging-')
  )
  const stagedRuntime = resolve(stagingRoot, 'runtime')
  mkdirSync(stagedRuntime, { recursive: true })

  try {
    const hostEnvironment = {
      ...environment,
      PLAYWRIGHT_BROWSERS_PATH: stagedRuntime,
    }
    delete hostEnvironment.PLAYWRIGHT_HOST_PLATFORM_OVERRIDE

    log(
      `Installing Playwright ${metadata.playwrightVersion} for the host platform`
    )
    commandRunner(
      process.execPath,
      [metadata.cliPath, 'install', '--only-shell', 'chromium'],
      {
        cwd: root,
        env: hostEnvironment,
      }
    )
    removeLinksAndRejectAbsoluteSymlinks(stagedRuntime)
    writeFileSync(resolve(stagedRuntime, '.gitkeep'), '\n')
    replaceDirectory(stagedRuntime, destination)
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true })
  }
}

function copyRuntimePackages(root, log) {
  const resourceNodeModules = resolve(root, 'src-tauri/resources/node_modules')
  mkdirSync(resourceNodeModules, { recursive: true })

  for (const packageName of RUNTIME_PACKAGES) {
    const source = resolve(root, 'node_modules', packageName)
    const destination = resolve(resourceNodeModules, packageName)

    if (!existsSync(source)) {
      throw new Error(
        `Missing ${packageName}. Run yarn install before preparing Web Research runtime.`
      )
    }

    rmSync(destination, { recursive: true, force: true })
    cpSync(source, destination, {
      recursive: true,
      dereference: false,
    })
    log(`Copied ${packageName} to ${destination}`)
  }

  writeFileSync(resolve(resourceNodeModules, '.gitkeep'), '')
}

export function prepareWebResearchRuntime({
  root = process.cwd(),
  platform = process.platform,
  commandRunner = runCommand,
  environment = process.env,
  log = console.log,
} = {}) {
  const metadata = loadPlaywrightRuntimeMetadata(root)
  verifyPlaywrightRuntimeMetadata(metadata)

  if (platform === 'darwin') {
    prepareUniversalMacOSBrowserRuntime({
      root,
      metadata,
      commandRunner,
      environment,
      log,
    })
  } else {
    prepareHostBrowserRuntime({
      root,
      metadata,
      commandRunner,
      environment,
      log,
    })
  }

  copyRuntimePackages(root, log)
  return metadata
}

const isMainModule =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMainModule) {
  prepareWebResearchRuntime()
}
