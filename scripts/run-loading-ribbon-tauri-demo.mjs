import { execFileSync, spawnSync } from 'node:child_process'
import process from 'node:process'

const CONFIG_PATH = 'scripts/loading-ribbon-tauri-demo.config.json'

function nativeDarwinArch() {
  try {
    return execFileSync('uname', ['-m'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return process.arch
  }
}

function defaultTarget() {
  if (process.env.LOADING_RIBBON_TAURI_TARGET) {
    return process.env.LOADING_RIBBON_TAURI_TARGET
  }

  if (process.platform !== 'darwin') {
    return undefined
  }

  const arch = nativeDarwinArch()
  if (arch === 'arm64') {
    return 'aarch64-apple-darwin'
  }

  if (arch === 'x86_64') {
    return 'x86_64-apple-darwin'
  }

  return undefined
}

const args = ['tauri', 'dev', '--no-watch', '--config', CONFIG_PATH]
const target = defaultTarget()

if (target) {
  args.splice(3, 0, '--target', target)
}

if (process.env.LOADING_RIBBON_TAURI_DRY_RUN === '1') {
  console.log(
    JSON.stringify(
      {
        args,
        command: 'yarn',
        configPath: CONFIG_PATH,
        target: target ?? null,
      },
      null,
      2
    )
  )
  process.exit(0)
}

const result = spawnSync('yarn', args, {
  shell: process.platform === 'win32',
  stdio: 'inherit',
})

if (result.error) {
  throw result.error
}

process.exitCode = result.status ?? 1
