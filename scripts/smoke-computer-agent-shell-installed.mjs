import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'
import { chromium } from 'playwright'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')

const PROVIDER_NAME = 'biyan-smoke-compatible'
const MODEL_ID = 'gpt-4o'
const SMOKE_MARKER = 'BIYAN_SHELL_SMOKE'
const SMOKE_FILE = 'allowed-root-smoke.txt'
const SMOKE_COMMAND = `echo ${SMOKE_MARKER}>${SMOKE_FILE} && type ${SMOKE_FILE}`

function log(message) {
  console.log(`[computer-smoke] ${message}`)
}

function fail(message) {
  throw new Error(message)
}

function parseArgs(argv) {
  const options = {
    app: '',
    installer: '',
    installerKind: '',
    installDir: '',
    keepInstall: false,
    dryRun: false,
    allowRunningBiyan: false,
    msiScope: 'per-user',
    timeoutMs: 180_000,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const readValue = () => {
      const value = argv[i + 1]
      if (!value || value.startsWith('--')) {
        fail(`${arg} requires a value`)
      }
      i += 1
      return value
    }

    switch (arg) {
      case '--app':
        options.app = readValue()
        break
      case '--installer':
        options.installer = readValue()
        break
      case '--installer-kind':
        options.installerKind = readValue()
        if (!['nsis', 'msi'].includes(options.installerKind)) {
          fail('--installer-kind must be "nsis" or "msi"')
        }
        break
      case '--nsis':
        options.installerKind = 'nsis'
        break
      case '--msi':
        options.installerKind = 'msi'
        break
      case '--install-dir':
        options.installDir = readValue()
        break
      case '--msi-scope':
        options.msiScope = readValue()
        if (!['per-user', 'all-users'].includes(options.msiScope)) {
          fail('--msi-scope must be "per-user" or "all-users"')
        }
        break
      case '--keep-install':
        options.keepInstall = true
        break
      case '--dry-run':
        options.dryRun = true
        break
      case '--allow-running-biyan':
        options.allowRunningBiyan = true
        break
      case '--timeout-ms':
        options.timeoutMs = Number(readValue())
        if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
          fail('--timeout-ms must be a positive number')
        }
        break
      case '--help':
      case '-h':
        printHelp()
        process.exit(0)
        break
      default:
        fail(`Unknown argument: ${arg}`)
    }
  }

  return options
}

function printHelp() {
  console.log(`Usage:
  yarn smoke:computer-agent-shell:win32 [options]

Options:
  --installer <path>       NSIS .exe or MSI installer to install. Defaults to newest NSIS setup unless --msi is set.
  --installer-kind <kind>  Installer kind: nsis or msi. Inferred from --installer extension when omitted.
  --nsis                  Use the newest NSIS setup installer.
  --msi                   Use the newest MSI installer.
  --app <path>             Existing installed Biyan.exe. Skips installer step.
  --install-dir <path>     Temporary install directory for NSIS/MSI.
  --msi-scope <scope>      MSI install scope: per-user or all-users. Default: per-user.
  --keep-install           Leave the temporary install directory in place.
  --dry-run                Validate inputs and runner discovery without launching chat.
  --allow-running-biyan    Do not fail if another Biyan.exe is already running.
  --timeout-ms <number>    End-to-end timeout. Default: 180000.
`)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    ...options,
  })
  if (result.status !== 0) {
    const stderr = result.stderr?.trim()
    const stdout = result.stdout?.trim()
    fail(
      `${command} ${args.join(' ')} failed with code ${result.status ?? 'unknown'}${
        stderr ? `\n${stderr}` : stdout ? `\n${stdout}` : ''
      }`
    )
  }
  return result.stdout ?? ''
}

function powershell(script, options = {}) {
  return run(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
    options
  )
}

function powershellJson(script) {
  const output = powershell(script)
  return output.trim() ? JSON.parse(output) : null
}

function newestFile(candidates) {
  return candidates
    .filter((file) => existsSync(file))
    .map((file) => ({ file, mtime: statSync(file).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0]?.file
}

function findDefaultInstaller(kind = 'nsis') {
  const bundleDir = join(repoRoot, 'src-tauri', 'target', 'release', 'bundle', kind)
  const filter = kind === 'msi' ? '*.msi' : '*setup*.exe'
  const listing = powershellJson(`
    $dir = ${JSON.stringify(bundleDir)}
    if (!(Test-Path -LiteralPath $dir)) {
      @() | ConvertTo-Json
      exit 0
    }
    Get-ChildItem -LiteralPath $dir -File -Filter ${JSON.stringify(filter)} |
      Select-Object -ExpandProperty FullName |
      ConvertTo-Json
  `)

  const files = Array.isArray(listing) ? listing : listing ? [listing] : []
  return newestFile(files)
}

function inferInstallerKind(installer, explicitKind) {
  if (explicitKind) return explicitKind
  const lower = installer.toLowerCase()
  if (lower.endsWith('.msi')) return 'msi'
  if (lower.endsWith('.exe')) return 'nsis'
  fail(`Could not infer installer kind from extension: ${installer}`)
}

function ensureWindows() {
  if (process.platform !== 'win32') {
    fail('This smoke test is Windows-only because it validates the Windows Computer Agent runner.')
  }
}

function ensureNoRunningBiyan(options) {
  if (options.allowRunningBiyan) return
  const processes = powershellJson(`
    @(Get-Process -Name Biyan -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty Id) |
      ConvertTo-Json
  `)
  const ids = Array.isArray(processes) ? processes : processes ? [processes] : []
  if (ids.length > 0) {
    fail(
      `Biyan.exe is already running (${ids.join(', ')}). Close it first or pass --allow-running-biyan.`
    )
  }
}

function isAdministrator() {
  const output = powershell(`
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { 'true' } else { 'false' }
  `)
  return output.trim() === 'true'
}

function createTempRoot() {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, '')
    .slice(0, 14)
  const root = join(process.env.TEMP ?? process.cwd(), `BiyanComputerSmoke-${stamp}-${process.pid}`)
  mkdirSync(root, { recursive: true })
  return root
}

function snapshotInstallArtifacts() {
  return powershellJson(`
    $ErrorActionPreference = 'Stop'
    $shell = New-Object -ComObject WScript.Shell
    $key = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Biyan'
    $appKey = 'HKCU:\\Software\\Jingxing\\Biyan'
    $registry = $null
    if (Test-Path -LiteralPath $key) {
      $item = Get-ItemProperty -LiteralPath $key
      $registry = @{}
      foreach ($property in $item.PSObject.Properties) {
        if ($property.Name -notlike 'PS*') {
          $registry[$property.Name] = $property.Value
        }
      }
    }
    $appRegistry = $null
    $appRegistryDefaultValue = $null
    if (Test-Path -LiteralPath $appKey) {
      $item = Get-ItemProperty -LiteralPath $appKey
      $appRegistry = @{}
      foreach ($property in $item.PSObject.Properties) {
        if ($property.Name -notlike 'PS*') {
          $appRegistry[$property.Name] = $property.Value
        }
      }
      $defaultValue = (Get-Item -LiteralPath $appKey).GetValue('')
      if ($null -ne $defaultValue) {
        $appRegistryDefaultValue = $defaultValue
      }
    }

    $shortcutPaths = @(
      (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Biyan.lnk'),
      (Join-Path ([Environment]::GetFolderPath('CommonDesktopDirectory')) 'Biyan.lnk'),
      (Join-Path ([Environment]::GetFolderPath('Programs')) 'Biyan.lnk'),
      (Join-Path ([Environment]::GetFolderPath('CommonPrograms')) 'Biyan.lnk')
    ) | Select-Object -Unique

    $shortcuts = @()
    foreach ($path in $shortcutPaths) {
      if (Test-Path -LiteralPath $path) {
        $shortcut = $shell.CreateShortcut($path)
        $shortcuts += [pscustomobject]@{
          Path = $path
          Exists = $true
          TargetPath = $shortcut.TargetPath
          Arguments = $shortcut.Arguments
          WorkingDirectory = $shortcut.WorkingDirectory
          IconLocation = $shortcut.IconLocation
          Description = $shortcut.Description
        }
      } else {
        $shortcuts += [pscustomobject]@{
          Path = $path
          Exists = $false
          TargetPath = ''
          Arguments = ''
          WorkingDirectory = ''
          IconLocation = ''
          Description = ''
        }
      }
    }

    [pscustomobject]@{
      RegistryExists = ($null -ne $registry)
      RegistryProperties = $registry
      AppRegistryExists = ($null -ne $appRegistry)
      AppRegistryProperties = $appRegistry
      AppRegistryDefaultValue = $appRegistryDefaultValue
      Shortcuts = $shortcuts
    } | ConvertTo-Json -Depth 8
  `)
}

function clearInstallArtifactsForTemporaryInstall() {
  powershell(`
    $paths = @(
      'HKCU:\\Software\\Jingxing\\Biyan',
      'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Biyan'
    )
    foreach ($path in $paths) {
      if (Test-Path -LiteralPath $path) {
        Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction Stop
      }
    }
  `)
}

function restoreInstallArtifacts(snapshot, tempRoot) {
  if (!snapshot) return

  const snapshotPath = join(tempRoot, 'install-artifacts-snapshot.json')
  writeFileSync(snapshotPath, JSON.stringify(snapshot), 'utf8')

  powershell(`
    $ErrorActionPreference = 'Stop'
    $snapshot = Get-Content -LiteralPath ${JSON.stringify(snapshotPath)} -Raw | ConvertFrom-Json
    $key = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Biyan'
    $appKey = 'HKCU:\\Software\\Jingxing\\Biyan'

    if ($snapshot.RegistryExists) {
      Remove-Item -LiteralPath $key -Recurse -Force -ErrorAction SilentlyContinue
      New-Item -Path $key -Force | Out-Null
      foreach ($property in $snapshot.RegistryProperties.PSObject.Properties) {
        $value = $property.Value
        if ($null -eq $value) { continue }
        if ($value -is [int] -or $value -is [long]) {
          New-ItemProperty -LiteralPath $key -Name $property.Name -Value ([int]$value) -PropertyType DWord -Force | Out-Null
        } else {
          New-ItemProperty -LiteralPath $key -Name $property.Name -Value ([string]$value) -PropertyType String -Force | Out-Null
        }
      }
    } else {
      Remove-Item -LiteralPath $key -Recurse -Force -ErrorAction SilentlyContinue
    }

    if ($snapshot.AppRegistryExists) {
      Remove-Item -LiteralPath $appKey -Recurse -Force -ErrorAction SilentlyContinue
      New-Item -Path $appKey -Force | Out-Null
      if (($snapshot.PSObject.Properties.Name -contains 'AppRegistryDefaultValue') -and $null -ne $snapshot.AppRegistryDefaultValue) {
        Set-Item -LiteralPath $appKey -Value ([string]$snapshot.AppRegistryDefaultValue)
      }
      foreach ($property in $snapshot.AppRegistryProperties.PSObject.Properties) {
        $value = $property.Value
        if ($null -eq $value) { continue }
        $name = [string]$property.Name
        if ($name.Length -eq 0) {
          continue
        } elseif ($value -is [int] -or $value -is [long]) {
          New-ItemProperty -LiteralPath $appKey -Name $name -Value ([int]$value) -PropertyType DWord -Force | Out-Null
        } else {
          New-ItemProperty -LiteralPath $appKey -Name $name -Value ([string]$value) -PropertyType String -Force | Out-Null
        }
      }
    } else {
      Remove-Item -LiteralPath $appKey -Recurse -Force -ErrorAction SilentlyContinue
    }

    $shell = New-Object -ComObject WScript.Shell
    foreach ($item in $snapshot.Shortcuts) {
      if ($item.Exists) {
        $parent = Split-Path -Parent $item.Path
        New-Item -ItemType Directory -Force -Path $parent | Out-Null
        $shortcut = $shell.CreateShortcut($item.Path)
        $shortcut.TargetPath = [string]$item.TargetPath
        $shortcut.Arguments = [string]$item.Arguments
        $shortcut.WorkingDirectory = [string]$item.WorkingDirectory
        $shortcut.IconLocation = [string]$item.IconLocation
        $shortcut.Description = [string]$item.Description
        $shortcut.Save()
      } elseif (Test-Path -LiteralPath $item.Path) {
        Remove-Item -LiteralPath $item.Path -Force -ErrorAction SilentlyContinue
      }
    }
  `)
}

function findInstalledBiyanFromRegistry() {
  const installDirs = powershellJson(`
    $paths = @(
      'HKCU:\\Software\\Jingxing\\Biyan',
      'HKLM:\\Software\\Jingxing\\Biyan'
    )
    $dirs = @()
    foreach ($path in $paths) {
      if (Test-Path -LiteralPath $path) {
        $item = Get-ItemProperty -LiteralPath $path
        if ($item.InstallDir) { $dirs += [string]$item.InstallDir }
        $default = (Get-Item -LiteralPath $path).GetValue('')
        if ($default) { $dirs += [string]$default }
      }
    }
    $dirs | Select-Object -Unique | ConvertTo-Json
  `)

  const dirs = Array.isArray(installDirs) ? installDirs : installDirs ? [installDirs] : []
  return dirs
    .map((dir) => join(dir, 'Biyan.exe'))
    .find((candidate) => existsSync(candidate))
}

function installNsis(installer, installDir) {
  if (!installer.toLowerCase().endsWith('.exe')) {
    fail('NSIS installer must be a .exe file.')
  }

  mkdirSync(installDir, { recursive: true })
  log(`Installing ${installer} to ${installDir}`)
  run(installer, ['/S', `/D=${installDir}`], { cwd: dirname(installer) })

  const appPath = join(installDir, 'Biyan.exe')
  if (!existsSync(appPath)) {
    fail(`Installer completed but Biyan.exe was not found at ${appPath}`)
  }
  return appPath
}

function installMsi(installer, installDir, scope, tempRoot) {
  if (!installer.toLowerCase().endsWith('.msi')) {
    fail('MSI installer must be a .msi file.')
  }
  if (scope === 'all-users' && !isAdministrator()) {
    fail('MSI all-users smoke requires an elevated shell. Use --msi-scope per-user for non-admin smoke.')
  }

  mkdirSync(installDir, { recursive: true })
  const logPath = join(tempRoot, `msi-install-${scope}.log`)
  const properties = scope === 'all-users'
    ? ['ALLUSERS=2', 'MSIINSTALLPERUSER=']
    : ['ALLUSERS=2', 'MSIINSTALLPERUSER=1']

  log(`Installing ${installer} to ${installDir} with MSI scope ${scope}`)
  run('msiexec.exe', [
    '/i',
    installer,
    '/qn',
    '/norestart',
    '/L*v',
    logPath,
    `INSTALLDIR=${installDir}`,
    ...properties,
  ])

  const appPath = join(installDir, 'Biyan.exe')
  if (existsSync(appPath)) return appPath

  const registryAppPath = findInstalledBiyanFromRegistry()
  if (registryAppPath) return registryAppPath

  fail(`MSI completed but Biyan.exe was not found at ${appPath}. MSI log: ${logPath}`)
}

function uninstallMsi(installer, tempRoot) {
  const logPath = join(tempRoot, 'msi-uninstall.log')
  log(`Uninstalling MSI package ${installer}`)
  const result = spawnSync('msiexec.exe', ['/x', installer, '/qn', '/norestart', '/L*v', logPath], {
    cwd: repoRoot,
    encoding: 'utf8',
  })

  if (result.status === 0 || result.status === 1605) {
    return
  }

  log(
    `MSI uninstall returned ${result.status ?? 'unknown'}; log: ${logPath}${
      result.stderr?.trim() ? `\n${result.stderr.trim()}` : ''
    }`
  )
}

function runnerCandidatesForApp(appPath) {
  const appDir = dirname(appPath)
  return [
    join(appDir, 'resources', 'computer-agent-runner', 'biyan-computer-agent-runner.exe'),
    join(appDir, 'biyan-computer-agent-runner.exe'),
  ]
}

function verifyRunner(appPath) {
  const runner = runnerCandidatesForApp(appPath).find((candidate) => existsSync(candidate))
  if (!runner) {
    fail(`Packaged runner was not found near ${appPath}`)
  }

  const stdout = run(runner, ['self-test'])
  const payload = JSON.parse(stdout)
  if (payload.status !== 'ready') {
    fail(`Runner self-test did not report ready: ${stdout}`)
  }

  log(`Runner self-test ready: ${runner}`)
  return runner
}

function snapshotAppConfig() {
  const appData = process.env.APPDATA
  if (!appData) fail('APPDATA is not set')

  const appSupport = join(appData, 'Biyan')
  const settingsPath = join(appSupport, 'settings.json')
  return {
    appSupport,
    settingsPath,
    existed: existsSync(settingsPath),
    content: existsSync(settingsPath) ? readFileSync(settingsPath, 'utf8') : '',
  }
}

function configureIsolatedBiyanData(snapshot, dataDir, allowedRoot) {
  mkdirSync(snapshot.appSupport, { recursive: true })
  mkdirSync(dataDir, { recursive: true })
  mkdirSync(allowedRoot, { recursive: true })
  writeFileSync(
    snapshot.settingsPath,
    JSON.stringify({ data_folder: dataDir }),
    'utf8'
  )

  const mcpConfig = {
    mcpServers: {},
    mcpSettings: {
      toolCallTimeoutSeconds: 30,
      baseRestartDelayMs: 1000,
      maxRestartDelayMs: 30000,
      backoffMultiplier: 2,
      enableSmartToolRouting: false,
      useLightweightRouterModel: false,
      routerModelProvider: '',
      routerModelId: '',
      computerAgentEnabled: true,
      computerAgentAllowedRoots: [allowedRoot],
      computerAgentShellEnabled: true,
    },
  }

  writeFileSync(
    join(dataDir, 'mcp_config.json'),
    JSON.stringify(mcpConfig, null, 2),
    'utf8'
  )
}

function restoreAppConfig(snapshot) {
  if (!snapshot) return
  if (snapshot.existed) {
    writeFileSync(snapshot.settingsPath, snapshot.content, 'utf8')
  } else if (existsSync(snapshot.settingsPath)) {
    rmSync(snapshot.settingsPath, { force: true })
  }
}

function removePathBestEffort(target) {
  if (!target || !existsSync(target)) return

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      rmSync(target, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 500,
      })
      return
    } catch {
      // Try again below, then fall back to PowerShell.
    }
  }

  try {
    powershell(`
      Remove-Item -LiteralPath ${JSON.stringify(target)} -Recurse -Force -ErrorAction Stop
    `)
  } catch (error) {
    log(`Could not remove ${target}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function listen(server, host = '127.0.0.1') {
  return new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, host, () => {
      server.off('error', rejectListen)
      resolveListen(server.address().port)
    })
  })
}

async function createMockOpenAiServer(allowedRoot) {
  const requests = []

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')

      if (req.method === 'GET' && url.pathname === '/v1/models') {
        sendJson(res, {
          object: 'list',
          data: [{ id: MODEL_ID, object: 'model', created: 0, owned_by: 'biyan-smoke' }],
        })
        return
      }

      if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
        const body = JSON.parse(await readRequest(req))
        requests.push(body)

        const hasToolResult = Array.isArray(body.messages)
          && body.messages.some((message) => message.role === 'tool')

        if (!hasToolResult && Array.isArray(body.tools)) {
          const hasComputerShell = body.tools.some(
            (tool) => tool?.function?.name === 'computer_agent_run_shell'
          )
          if (!hasComputerShell) {
            sendJson(res, {
              error: {
                message: 'computer_agent_run_shell was not present in the chat tool list',
              },
            }, 500)
            return
          }

          sendToolCallStream(res, allowedRoot)
          return
        }

        sendTextStream(res, 'Shell smoke completed via installed runner.')
        return
      }

      sendJson(res, { error: { message: `Unhandled mock endpoint ${req.method} ${url.pathname}` } }, 404)
    } catch (error) {
      sendJson(res, { error: { message: error instanceof Error ? error.message : String(error) } }, 500)
    }
  })

  const port = await listen(server)
  return {
    port,
    requests,
    close: () => new Promise((resolveClose) => server.close(resolveClose)),
  }
}

function readRequest(req) {
  return new Promise((resolveRead, rejectRead) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => resolveRead(body))
    req.on('error', rejectRead)
  })
}

function sendJson(res, payload, statusCode = 200) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(payload))
}

function sendSse(res, chunks) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })

  for (const chunk of chunks) {
    res.write(`data: ${JSON.stringify(chunk)}\n\n`)
  }
  res.end('data: [DONE]\n\n')
}

function baseChunk() {
  return {
    id: 'chatcmpl-biyan-computer-agent-smoke',
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: MODEL_ID,
  }
}

function sendToolCallStream(res, allowedRoot) {
  const args = JSON.stringify({
    command: SMOKE_COMMAND,
    cwd: allowedRoot,
    timeoutSeconds: 5,
    maxOutputBytes: 4096,
  })

  sendSse(res, [
    {
      ...baseChunk(),
      choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
    },
    {
      ...baseChunk(),
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_biyan_computer_agent_smoke',
                type: 'function',
                function: { name: 'computer_agent_run_shell', arguments: '' },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    },
    {
      ...baseChunk(),
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                function: { arguments: args },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    },
    {
      ...baseChunk(),
      choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
    },
  ])
}

function sendTextStream(res, text) {
  const chunks = [
    {
      ...baseChunk(),
      choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
    },
  ]

  for (const word of text.split(/(\s+)/).filter(Boolean)) {
    chunks.push({
      ...baseChunk(),
      choices: [{ index: 0, delta: { content: word }, finish_reason: null }],
    })
  }

  chunks.push({
    ...baseChunk(),
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
  })

  sendSse(res, chunks)
}

async function getFreePort() {
  const server = createServer()
  const port = await listen(server)
  await new Promise((resolveClose) => server.close(resolveClose))
  return port
}

async function waitForCdp(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  const endpoint = `http://127.0.0.1:${port}/json/version`
  while (Date.now() < deadline) {
    try {
      const response = await fetch(endpoint)
      if (response.ok) return endpoint.replace('/json/version', '')
    } catch {
      // keep polling
    }
    await delay(500)
  }
  fail(`Timed out waiting for WebView2 remote debugging on ${endpoint}`)
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}

function launchApp(appPath, tempRoot, cdpPort) {
  const webviewUserData = join(tempRoot, 'webview2')
  mkdirSync(webviewUserData, { recursive: true })

  const env = {
    ...process.env,
    WEBVIEW2_USER_DATA_FOLDER: webviewUserData,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: [
      `--remote-debugging-port=${cdpPort}`,
      '--remote-allow-origins=*',
      `--user-data-dir=${webviewUserData}`,
    ].join(' '),
  }

  log(`Launching installed app with CDP port ${cdpPort}`)
  const child = spawn(appPath, [], {
    cwd: dirname(appPath),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const output = []
  const collect = (stream, prefix) => {
    stream.setEncoding('utf8')
    stream.on('data', (chunk) => {
      output.push(`${prefix}${chunk}`)
      if (output.join('').length > 32_768) output.shift()
    })
  }
  collect(child.stdout, 'stdout: ')
  collect(child.stderr, 'stderr: ')

  return { child, output }
}

async function stopApp(appProcess) {
  if (!appProcess?.child || appProcess.child.exitCode !== null) return

  const pid = appProcess.child.pid
  if (pid) {
    spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      encoding: 'utf8',
      stdio: 'ignore',
    })
  } else {
    appProcess.child.kill()
  }

  await Promise.race([
    new Promise((resolveExit) => appProcess.child.once('exit', resolveExit)),
    delay(5_000),
  ])
}

async function configureBrowserStorage(page, mockBaseUrl) {
  const smokeModel = {
    id: MODEL_ID,
    model: MODEL_ID,
    name: MODEL_ID,
    displayName: MODEL_ID,
    provider: PROVIDER_NAME,
    capabilities: ['tools'],
    settings: {},
  }

  const smokeProvider = {
    active: true,
    api_key: 'biyan-smoke-key',
    base_url: mockBaseUrl,
    provider: PROVIDER_NAME,
    settings: [],
    models: [smokeModel],
  }

  const payload = {
    providerName: PROVIDER_NAME,
    modelId: MODEL_ID,
    modelProviderState: {
      state: {
        providers: [smokeProvider],
        selectedProvider: PROVIDER_NAME,
        selectedModel: smokeModel,
        deletedModels: [],
      },
      version: 15,
    },
    lastUsedModel: {
      provider: PROVIDER_NAME,
      model: MODEL_ID,
    },
  }

  const install = (data) => {
    localStorage.setItem('model-provider', JSON.stringify(data.modelProviderState))
    localStorage.setItem('last-used-model', JSON.stringify(data.lastUsedModel))
    localStorage.setItem('tool-approval', JSON.stringify({
      state: { approvedTools: {}, allowAllMCPPermissions: true },
      version: 0,
    }))
    localStorage.setItem('setup-completed', 'true')
  }

  await page.addInitScript(install, payload)
  await page.evaluate(install, payload)
  await page.reload({ waitUntil: 'domcontentloaded' })
}

async function getFirstPage(browser) {
  const deadline = Date.now() + 60_000
  const seenUrls = new Set()
  while (Date.now() < deadline) {
    for (const context of browser.contexts()) {
      const pages = context.pages()
      for (const page of pages) {
        if (page.isClosed()) continue
        seenUrls.add(page.url())
        const canUseStorage = await page.evaluate(() => {
          try {
            localStorage.setItem('__biyan_smoke_probe', '1')
            localStorage.removeItem('__biyan_smoke_probe')
            return true
          } catch {
            return false
          }
        }).catch(() => false)
        if (canUseStorage) {
          return page
        }
      }
    }
    await delay(250)
  }
  fail(`No app WebView page with localStorage was exposed over CDP. Saw: ${[...seenUrls].join(', ') || '(none)'}`)
}

async function runChatSmoke(appPath, tempRoot, dataDir, allowedRoot, timeoutMs) {
  const mock = await createMockOpenAiServer(allowedRoot)
  const cdpPort = await getFreePort()
  const appProcess = launchApp(appPath, tempRoot, cdpPort)
  let browser

  try {
    const cdpEndpoint = await waitForCdp(cdpPort, 60_000)
    browser = await chromium.connectOverCDP(cdpEndpoint)
    const page = await getFirstPage(browser)

    await configureBrowserStorage(page, `http://127.0.0.1:${mock.port}/v1`)

    await page.locator('[data-testid="chat-input"]').waitFor({
      state: 'visible',
      timeout: 60_000,
    })

    await page.locator('[data-testid="chat-input"]').fill(
      'Run the installed Computer Agent shell smoke test. Create allowed-root-smoke.txt in the configured allowed root and read it back.'
    )
    await page.locator('[data-test-id="send-message-button"]').click()

    await page.waitForURL(/\/threads\//, { timeout: 60_000 })
    const threadId = new URL(page.url()).pathname.split('/').filter(Boolean).pop()
    if (!threadId) fail(`Could not extract thread id from URL: ${page.url()}`)

    const dialog = page.locator('[role="dialog"]').filter({ hasText: 'computer_agent_run_shell' })
    await dialog.waitFor({ state: 'visible', timeout: timeoutMs })

    const dialogText = await dialog.innerText()
    const escapedAllowedRoot = JSON.stringify(allowedRoot).slice(1, -1)
    for (const expected of ['computer_agent_run_shell', SMOKE_COMMAND]) {
      if (!dialogText.includes(expected)) {
        fail(`Approval dialog did not include ${JSON.stringify(expected)}.\n${dialogText}`)
      }
    }
    if (!dialogText.includes(allowedRoot) && !dialogText.includes(escapedAllowedRoot)) {
      fail(`Approval dialog did not include allowed root cwd ${JSON.stringify(allowedRoot)}.\n${dialogText}`)
    }
    if (/Allow in thread|Always Allow|在线程中允许|始终允许/.test(dialogText)) {
      fail('Computer Agent approval dialog exposed a remembered-permission button.')
    }

    await dialog.getByRole('button', { name: /Allow Once|允许本次/i }).click()

    await page.getByText('Shell smoke completed via installed runner.').waitFor({
      state: 'visible',
      timeout: timeoutMs,
    })

    const workspaceSmokePath = join(dataDir, 'agent-workspaces', threadId, SMOKE_FILE)
    const smokePath = join(allowedRoot, SMOKE_FILE)
    const deadline = Date.now() + 20_000
    while (!existsSync(smokePath) && Date.now() < deadline) {
      await delay(250)
    }
    if (!existsSync(smokePath)) {
      fail(`Shell smoke did not create expected allowed-root file: ${smokePath}`)
    }
    if (existsSync(workspaceSmokePath)) {
      fail(`Shell smoke wrote to workspace instead of allowed root: ${workspaceSmokePath}`)
    }

    const content = readFileSync(smokePath, 'utf8').trim()
    if (content !== SMOKE_MARKER) {
      fail(`Unexpected ${SMOKE_FILE} content: ${JSON.stringify(content)}`)
    }

    if (mock.requests.length < 2) {
      fail(`Expected at least 2 model requests, saw ${mock.requests.length}`)
    }

    log(`Smoke wrote ${smokePath}`)
  } finally {
    await browser?.close().catch(() => {})
    await stopApp(appProcess)
    await mock.close()
  }
}

async function main() {
  ensureWindows()
  const options = parseArgs(process.argv.slice(2))
  ensureNoRunningBiyan(options)

  const tempRoot = createTempRoot()
  const installSnapshot = snapshotInstallArtifacts()
  if (!options.app) {
    clearInstallArtifactsForTemporaryInstall()
  }
  const appConfigSnapshot = snapshotAppConfig()
  let appPath = options.app ? resolve(options.app) : ''
  let installDir = options.installDir ? resolve(options.installDir) : join(tempRoot, 'install')
  let msiInstallerForCleanup = ''
  const dataDir = join(tempRoot, 'profile', 'data')
  const allowedRoot = join(tempRoot, 'allowed-root')
  let caughtError

  try {
    if (appPath) {
      if (!existsSync(appPath)) fail(`--app path does not exist: ${appPath}`)
      installDir = dirname(appPath)
    } else {
      const defaultInstallerKind = options.installerKind || 'nsis'
      const installer = options.installer
        ? resolve(options.installer)
        : findDefaultInstaller(defaultInstallerKind)
      if (!installer) {
        fail(`No default ${defaultInstallerKind.toUpperCase()} installer found. Build with yarn build:tauri:win32 or pass --installer.`)
      }
      if (!existsSync(installer)) fail(`Installer does not exist: ${installer}`)
      const installerKind = inferInstallerKind(installer, options.installerKind)
      if (installerKind === 'msi') {
        msiInstallerForCleanup = installer
        appPath = installMsi(installer, installDir, options.msiScope, tempRoot)
      } else {
        appPath = installNsis(installer, installDir)
      }
    }

    verifyRunner(appPath)
    configureIsolatedBiyanData(appConfigSnapshot, dataDir, allowedRoot)

    if (options.dryRun) {
      log('Dry run completed after installer, runner, and isolated data configuration checks.')
    } else {
      await runChatSmoke(appPath, tempRoot, dataDir, allowedRoot, options.timeoutMs)
      log('Installed Computer Agent shell smoke passed.')
    }
  } catch (error) {
    caughtError = error
  }

  try {
    restoreAppConfig(appConfigSnapshot)
  } catch (error) {
    log(`Could not restore Biyan app config: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (!options.keepInstall && msiInstallerForCleanup) {
    try {
      uninstallMsi(msiInstallerForCleanup, tempRoot)
    } catch (error) {
      log(`Could not uninstall MSI package: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  try {
    restoreInstallArtifacts(installSnapshot, tempRoot)
  } catch (error) {
    log(`Could not restore installer artifacts: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (!options.keepInstall && !options.app && existsSync(installDir)) {
    removePathBestEffort(installDir)
  }

  if (!options.keepInstall && existsSync(tempRoot)) {
    removePathBestEffort(tempRoot)
  } else if (existsSync(tempRoot)) {
    log(`Kept smoke artifacts at ${tempRoot}`)
  }

  if (caughtError) {
    throw caughtError
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error)
  process.exit(1)
})
