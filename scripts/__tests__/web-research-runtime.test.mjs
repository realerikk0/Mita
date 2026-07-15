import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  EXPECTED_PLAYWRIGHT_RUNTIME,
  loadPlaywrightRuntimeMetadata,
  prepareWebResearchRuntime,
  runCommand,
  verifyPlaywrightRuntimeMetadata,
} from '../prepare-web-research-runtime.mjs'

const actualPlaywrightCoreRegistry = path.resolve(
  'node_modules/playwright-core/lib/server/registry/index.js'
)

function registryExecutableFor(
  browserDestination,
  hostPlatform,
  executableName
) {
  const code = `
    const fs = require('node:fs')
    const { registry } = require(${JSON.stringify(actualPlaywrightCoreRegistry)})
    const executablePath = registry.findExecutable(${JSON.stringify(executableName)}).executablePath()
    process.stdout.write(JSON.stringify({ executablePath, exists: fs.existsSync(executablePath) }))
  `
  return JSON.parse(
    execFileSync(process.execPath, ['-e', code], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PLAYWRIGHT_BROWSERS_PATH: browserDestination,
        PLAYWRIGHT_HOST_PLATFORM_OVERRIDE: hostPlatform,
      },
    })
  )
}
const webResearchSidecar = path.resolve(
  'src-tauri/resources/bin/biyan-web-research-mcp.mjs'
)

function createFixture(t, metadata = {}) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'biyan-web-research-runtime-')
  )
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))

  const version = metadata.version ?? EXPECTED_PLAYWRIGHT_RUNTIME.version
  const shellRevision =
    metadata.shellRevision ??
    EXPECTED_PLAYWRIGHT_RUNTIME.chromiumHeadlessShellRevision
  const ffmpegRevision =
    metadata.ffmpegRevision ?? EXPECTED_PLAYWRIGHT_RUNTIME.ffmpegRevision
  const ffmpegRevisionOverrides =
    metadata.ffmpegRevisionOverrides ??
    EXPECTED_PLAYWRIGHT_RUNTIME.ffmpegRevisionOverrides
  const playwrightDirectory = path.resolve(root, 'node_modules/playwright')
  const playwrightCoreDirectory = path.resolve(
    root,
    'node_modules/playwright-core'
  )

  fs.mkdirSync(playwrightDirectory, { recursive: true })
  fs.mkdirSync(playwrightCoreDirectory, { recursive: true })
  fs.writeFileSync(
    path.resolve(playwrightDirectory, 'package.json'),
    JSON.stringify({ name: 'playwright', version })
  )
  fs.writeFileSync(path.resolve(playwrightDirectory, 'cli.js'), '')
  fs.writeFileSync(
    path.resolve(playwrightCoreDirectory, 'package.json'),
    JSON.stringify({ name: 'playwright-core', version })
  )
  fs.writeFileSync(
    path.resolve(playwrightCoreDirectory, 'browsers.json'),
    JSON.stringify({
      browsers: [
        { name: 'chromium-headless-shell', revision: shellRevision },
        {
          name: 'ffmpeg',
          revision: ffmpegRevision,
          revisionOverrides: ffmpegRevisionOverrides,
        },
      ],
    })
  )
  fs.writeFileSync(path.resolve(playwrightCoreDirectory, 'fixture.js'), '')

  const browserDestination = path.resolve(
    root,
    'src-tauri/resources/ms-playwright'
  )
  fs.mkdirSync(browserDestination, { recursive: true })
  fs.writeFileSync(
    path.resolve(browserDestination, 'previous-runtime'),
    'keep-on-failure'
  )

  return {
    root,
    browserDestination,
    shellRevision,
    ffmpegRevision,
    ffmpegRevisionOverrides,
  }
}

function createFakeCommandRunner({ failPlatform, invalidArchitecture } = {}) {
  const calls = []

  function commandRunner(command, args, options = {}) {
    calls.push({ command, args: [...args], options })

    if (args.includes('install')) {
      const platform = options.env.PLAYWRIGHT_HOST_PLATFORM_OVERRIDE
      if (platform === failPlatform) {
        throw new Error(`simulated ${platform} install failure`)
      }

      const browsersPath = options.env.PLAYWRIGHT_BROWSERS_PATH
      const isArm64 = platform.endsWith('-arm64')
      const architecture =
        invalidArchitecture === platform
          ? 'x86_64'
          : isArm64
            ? 'arm64'
            : 'x86_64'
      const installsOnlyFfmpeg = args.at(-1) === 'ffmpeg'

      if (installsOnlyFfmpeg) {
        const revision =
          EXPECTED_PLAYWRIGHT_RUNTIME.ffmpegRevisionOverrides[platform]
        const ffmpegDirectory = path.resolve(
          browsersPath,
          `ffmpeg_${platform.replaceAll('-', '_')}_special-${revision}`
        )
        fs.mkdirSync(ffmpegDirectory, { recursive: true })
        fs.writeFileSync(
          path.resolve(ffmpegDirectory, 'ffmpeg-mac'),
          architecture
        )
      } else {
        const browserPlatformDirectory = isArm64
          ? 'chrome-headless-shell-mac-arm64'
          : 'chrome-headless-shell-mac-x64'
        const browserDirectory = path.resolve(
          browsersPath,
          `chromium_headless_shell-${EXPECTED_PLAYWRIGHT_RUNTIME.chromiumHeadlessShellRevision}`,
          browserPlatformDirectory
        )
        const ffmpegDirectory = path.resolve(
          browsersPath,
          `ffmpeg-${EXPECTED_PLAYWRIGHT_RUNTIME.ffmpegRevision}`
        )

        fs.mkdirSync(browserDirectory, { recursive: true })
        fs.mkdirSync(ffmpegDirectory, { recursive: true })
        fs.writeFileSync(
          path.resolve(browserDirectory, 'chrome-headless-shell'),
          architecture
        )
        fs.writeFileSync(
          path.resolve(ffmpegDirectory, 'ffmpeg-mac'),
          architecture
        )
        fs.mkdirSync(path.resolve(browserDirectory, '.links'), {
          recursive: true,
        })
        fs.writeFileSync(
          path.resolve(browserDirectory, '.links/source'),
          '/absolute/build/path'
        )
      }
      return ''
    }

    if (command === 'lipo' && args[0] === '-create') {
      const outputIndex = args.indexOf('-output')
      assert.notEqual(outputIndex, -1)
      fs.writeFileSync(args[outputIndex + 1], 'arm64 x86_64')
      return ''
    }

    if (command === 'lipo' && args[0] === '-archs') {
      return fs.readFileSync(args[1], 'utf8')
    }

    throw new Error(`Unexpected command: ${command} ${args.join(' ')}`)
  }

  return { calls, commandRunner }
}

test('repository pins the reviewed Playwright version and browser revisions', () => {
  const metadata = loadPlaywrightRuntimeMetadata(process.cwd())
  assert.doesNotThrow(() => verifyPlaywrightRuntimeMetadata(metadata))
  assert.deepEqual(
    {
      version: metadata.playwrightVersion,
      chromiumHeadlessShellRevision: metadata.chromiumHeadlessShellRevision,
      ffmpegRevision: metadata.ffmpegRevision,
      ffmpegRevisionOverrides: metadata.ffmpegRevisionOverrides,
    },
    EXPECTED_PLAYWRIGHT_RUNTIME
  )
})

test('Darwin preparation installs isolated arm64 and x64 runtimes and merges ffmpeg', (t) => {
  const fixture = createFixture(t)
  const { calls, commandRunner } = createFakeCommandRunner()

  prepareWebResearchRuntime({
    root: fixture.root,
    platform: 'darwin',
    commandRunner,
    environment: { FIXTURE_ENVIRONMENT: 'yes' },
    log: () => {},
  })

  const installCalls = calls.filter((call) => call.args.includes('install'))
  assert.equal(installCalls.length, 4)
  assert.deepEqual(
    installCalls.map(
      (call) => call.options.env.PLAYWRIGHT_HOST_PLATFORM_OVERRIDE
    ),
    ['mac15-arm64', 'mac15', 'mac12-arm64', 'mac12']
  )
  assert.deepEqual(
    installCalls.map((call) => call.args.slice(1)),
    [
      ['install', '--only-shell', 'chromium'],
      ['install', '--only-shell', 'chromium'],
      ['install', 'ffmpeg'],
      ['install', 'ffmpeg'],
    ]
  )

  const stagingPaths = installCalls.map(
    (call) => call.options.env.PLAYWRIGHT_BROWSERS_PATH
  )
  assert.equal(new Set(stagingPaths).size, 4)
  assert.ok(
    stagingPaths.every(
      (stagingPath) => stagingPath !== fixture.browserDestination
    )
  )
  assert.ok(stagingPaths.every((stagingPath) => !fs.existsSync(stagingPath)))

  const browserRevisionDirectory = path.resolve(
    fixture.browserDestination,
    `chromium_headless_shell-${fixture.shellRevision}`
  )
  const arm64Executable = path.resolve(
    browserRevisionDirectory,
    'chrome-headless-shell-mac-arm64/chrome-headless-shell'
  )
  const x64Executable = path.resolve(
    browserRevisionDirectory,
    'chrome-headless-shell-mac-x64/chrome-headless-shell'
  )
  const ffmpegExecutable = path.resolve(
    fixture.browserDestination,
    `ffmpeg-${fixture.ffmpegRevision}/ffmpeg-mac`
  )
  const ffmpegOverrideExecutables = [
    path.resolve(
      fixture.browserDestination,
      `ffmpeg_mac12_arm64_special-${fixture.ffmpegRevisionOverrides['mac12-arm64']}`,
      'ffmpeg-mac'
    ),
    path.resolve(
      fixture.browserDestination,
      `ffmpeg_mac12_special-${fixture.ffmpegRevisionOverrides.mac12}`,
      'ffmpeg-mac'
    ),
  ]
  assert.equal(fs.readFileSync(arm64Executable, 'utf8'), 'arm64')
  assert.equal(fs.readFileSync(x64Executable, 'utf8'), 'x86_64')
  assert.equal(fs.readFileSync(ffmpegExecutable, 'utf8'), 'arm64 x86_64')
  for (const overrideExecutable of ffmpegOverrideExecutables) {
    assert.equal(fs.readFileSync(overrideExecutable, 'utf8'), 'arm64 x86_64')
    assert.equal(
      fs.existsSync(
        path.resolve(path.dirname(overrideExecutable), 'INSTALLATION_COMPLETE')
      ),
      true
    )
  }
  assert.equal(
    fs.existsSync(
      path.resolve(
        browserRevisionDirectory,
        'chrome-headless-shell-mac-arm64/.links'
      )
    ),
    false
  )
  assert.equal(
    fs.existsSync(
      path.resolve(
        browserRevisionDirectory,
        'chrome-headless-shell-mac-x64/.links'
      )
    ),
    false
  )
  assert.equal(
    fs.existsSync(path.resolve(fixture.browserDestination, 'previous-runtime')),
    false
  )

  const lipoCreateCalls = calls.filter(
    (call) => call.command === 'lipo' && call.args[0] === '-create'
  )
  assert.equal(lipoCreateCalls.length, 2)
  assert.match(lipoCreateCalls[0].args[1], /mac15-arm64/)
  assert.match(lipoCreateCalls[0].args[2], /mac15/)
  assert.match(lipoCreateCalls[1].args[1], /mac12-arm64/)
  assert.match(lipoCreateCalls[1].args[2], /mac12/)
})

test('Playwright selects the matching bundled headless executable for each mac architecture', (t) => {
  const fixture = createFixture(t)
  const { commandRunner } = createFakeCommandRunner()
  prepareWebResearchRuntime({
    root: fixture.root,
    platform: 'darwin',
    commandRunner,
    log: () => {},
  })

  const arm64Executable = registryExecutableFor(
    fixture.browserDestination,
    'mac15-arm64',
    'chromium-headless-shell'
  )
  const x64Executable = registryExecutableFor(
    fixture.browserDestination,
    'mac15',
    'chromium-headless-shell'
  )

  assert.equal(arm64Executable.exists, true)
  assert.equal(
    arm64Executable.executablePath,
    path.resolve(
      fixture.browserDestination,
      `chromium_headless_shell-${fixture.shellRevision}`,
      'chrome-headless-shell-mac-arm64',
      'chrome-headless-shell'
    )
  )
  assert.equal(x64Executable.exists, true)
  assert.equal(
    x64Executable.executablePath,
    path.resolve(
      fixture.browserDestination,
      `chromium_headless_shell-${fixture.shellRevision}`,
      'chrome-headless-shell-mac-x64',
      'chrome-headless-shell'
    )
  )
})

test('Playwright resolves existing universal ffmpeg files for both mac12 overrides', (t) => {
  const fixture = createFixture(t)
  const { commandRunner } = createFakeCommandRunner()
  prepareWebResearchRuntime({
    root: fixture.root,
    platform: 'darwin',
    commandRunner,
    log: () => {},
  })

  const cases = [
    {
      hostPlatform: 'mac12-arm64',
      revisionDirectory: `ffmpeg_mac12_arm64_special-${fixture.ffmpegRevisionOverrides['mac12-arm64']}`,
    },
    {
      hostPlatform: 'mac12',
      revisionDirectory: `ffmpeg_mac12_special-${fixture.ffmpegRevisionOverrides.mac12}`,
    },
  ]

  for (const testCase of cases) {
    const result = registryExecutableFor(
      fixture.browserDestination,
      testCase.hostPlatform,
      'ffmpeg'
    )
    const expectedPath = path.resolve(
      fixture.browserDestination,
      testCase.revisionDirectory,
      'ffmpeg-mac'
    )
    assert.equal(result.executablePath, expectedPath)
    assert.equal(result.exists, true)
    assert.equal(fs.readFileSync(expectedPath, 'utf8'), 'arm64 x86_64')
  }
})

test('non-Darwin preparation installs once for the host without an architecture override', (t) => {
  const fixture = createFixture(t)
  const calls = []
  prepareWebResearchRuntime({
    root: fixture.root,
    platform: 'linux',
    commandRunner: (command, args, options) => {
      calls.push({ command, args, options })
      const linksDirectory = path.resolve(
        options.env.PLAYWRIGHT_BROWSERS_PATH,
        '.links'
      )
      fs.mkdirSync(linksDirectory, { recursive: true })
      fs.writeFileSync(
        path.resolve(linksDirectory, 'source'),
        '/absolute/build/path'
      )
      return ''
    },
    environment: { PLAYWRIGHT_HOST_PLATFORM_OVERRIDE: 'mac15-arm64' },
    log: () => {},
  })

  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].args.slice(1), [
    'install',
    '--only-shell',
    'chromium',
  ])
  assert.equal(
    path.basename(calls[0].options.env.PLAYWRIGHT_BROWSERS_PATH),
    'runtime'
  )
  assert.notEqual(
    calls[0].options.env.PLAYWRIGHT_BROWSERS_PATH,
    fixture.browserDestination
  )
  assert.equal(
    fs.existsSync(calls[0].options.env.PLAYWRIGHT_BROWSERS_PATH),
    false
  )
  assert.equal(
    Object.hasOwn(calls[0].options.env, 'PLAYWRIGHT_HOST_PLATFORM_OVERRIDE'),
    false
  )
  assert.equal(
    fs.existsSync(path.resolve(fixture.browserDestination, '.links')),
    false
  )
  assert.equal(
    fs.existsSync(path.resolve(fixture.browserDestination, 'previous-runtime')),
    false
  )
  assert.equal(
    fs.existsSync(
      path.resolve(
        fixture.root,
        'src-tauri/resources/node_modules/playwright/cli.js'
      )
    ),
    true
  )
})

test('non-Darwin install failure preserves the previous runtime and cleans staging', (t) => {
  const fixture = createFixture(t)

  assert.throws(
    () =>
      prepareWebResearchRuntime({
        root: fixture.root,
        platform: 'win32',
        commandRunner: (_command, _args, options) => {
          fs.writeFileSync(
            path.resolve(
              options.env.PLAYWRIGHT_BROWSERS_PATH,
              'partial-download'
            ),
            'partial'
          )
          throw new Error('simulated interrupted download')
        },
        log: () => {},
      }),
    /simulated interrupted download/
  )

  assert.equal(
    fs.readFileSync(
      path.resolve(fixture.browserDestination, 'previous-runtime'),
      'utf8'
    ),
    'keep-on-failure'
  )
  assert.deepEqual(
    fs
      .readdirSync(path.resolve(fixture.root, 'src-tauri/resources'))
      .filter((entry) => entry.startsWith('.ms-playwright-staging-')),
    []
  )
})

test('metadata mismatches fail closed before installing browsers', (t) => {
  const fixture = createFixture(t, { version: '1.60.0' })
  let commandCount = 0

  assert.throws(
    () =>
      prepareWebResearchRuntime({
        root: fixture.root,
        platform: 'darwin',
        commandRunner: () => {
          commandCount += 1
        },
        log: () => {},
      }),
    /Unsupported playwright version: expected 1\.59\.1, received 1\.60\.0/
  )
  assert.equal(commandCount, 0)
  assert.equal(
    fs.readFileSync(
      path.resolve(fixture.browserDestination, 'previous-runtime'),
      'utf8'
    ),
    'keep-on-failure'
  )
})

test('ffmpeg override mismatches fail closed before installing browsers', (t) => {
  const fixture = createFixture(t, {
    ffmpegRevisionOverrides: {
      'mac12': '1009',
      'mac12-arm64': '1010',
    },
  })
  let commandCount = 0

  assert.throws(
    () =>
      prepareWebResearchRuntime({
        root: fixture.root,
        platform: 'darwin',
        commandRunner: () => {
          commandCount += 1
        },
        log: () => {},
      }),
    /Unsupported ffmpeg revision override for mac12: expected 1010, received 1009/
  )
  assert.equal(commandCount, 0)
  assert.equal(
    fs.readFileSync(
      path.resolve(fixture.browserDestination, 'previous-runtime'),
      'utf8'
    ),
    'keep-on-failure'
  )
})

test('mac12 ffmpeg architecture validation leaves the previous runtime intact', (t) => {
  const fixture = createFixture(t)
  const { commandRunner } = createFakeCommandRunner({
    invalidArchitecture: 'mac12-arm64',
  })

  assert.throws(
    () =>
      prepareWebResearchRuntime({
        root: fixture.root,
        platform: 'darwin',
        commandRunner,
        log: () => {},
      }),
    /mac12-arm64 override ffmpeg has architectures \[x86_64\], expected \[arm64\]/
  )
  assert.equal(
    fs.readFileSync(
      path.resolve(fixture.browserDestination, 'previous-runtime'),
      'utf8'
    ),
    'keep-on-failure'
  )
  assert.equal(
    fs
      .readdirSync(path.resolve(fixture.root, 'src-tauri/resources'))
      .some((entry) => entry.startsWith('.ms-playwright-staging-')),
    false
  )
})

test('command execution reports non-zero exits', () => {
  assert.throws(
    () =>
      runCommand(
        process.execPath,
        ['-e', 'process.stderr.write("nope"); process.exit(7)'],
        {
          captureOutput: true,
        }
      ),
    /exited with status 7: nope/
  )
})

test('bundled headless-only runtime rejects headed browser mode explicitly', () => {
  const request = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'open_url',
      arguments: { url: 'https://example.com', render: true },
    },
  })
  const output = execFileSync(process.execPath, [webResearchSidecar], {
    encoding: 'utf8',
    env: { ...process.env, BIYAN_WEB_RESEARCH_HEADLESS: 'false' },
    input: `${request}\n`,
  })
  const response = JSON.parse(output.trim())
  assert.equal(response.result.isError, true)
  assert.match(
    response.result.content[0].text,
    /BIYAN_WEB_RESEARCH_HEADLESS=false is not supported/
  )
})
