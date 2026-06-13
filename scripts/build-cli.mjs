import { copyFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const isDev = process.argv.includes('--dev')
const cliOnly = process.argv.includes('--cli-only')
const makeTarget = isDev ? 'build-cli-dev' : 'build-cli'

function run(command, args, options = {}) {
  const { attempts = 1, retryDelayMs = 0, ...spawnOptions } = options

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = spawnSync(command, args, {
      cwd: root,
      stdio: 'inherit',
      ...spawnOptions,
    })

    if (!result.error && result.status === 0) {
      return
    }

    if (attempt < attempts) {
      const reason = result.error?.message ?? `exit status ${result.status ?? 1}`
      console.warn(
        `${command} ${args.join(' ')} failed (${reason}); retrying ${attempt}/${attempts - 1}...`,
      )
      if (retryDelayMs > 0) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, retryDelayMs)
      }
      continue
    }

    if (result.error) {
      console.error(result.error.message)
      process.exit(1)
    }

    process.exit(result.status ?? 1)
  }
}

if (process.platform !== 'win32' && !cliOnly) {
  run('make', [makeTarget])
  process.exit(0)
}

const cliBinaryName = process.platform === 'win32' ? 'mita-cli.exe' : 'mita-cli'

const cargoArgs = [
  'build',
  '--manifest-path',
  join(root, 'src-tauri', 'Cargo.toml'),
  '--features',
  'cli',
  '--bin',
  'mita-cli',
]

if (!isDev) {
  cargoArgs.splice(1, 0, '--release')
}

run('cargo', cargoArgs, {
  attempts: process.env.CI ? 3 : 1,
  retryDelayMs: 10_000,
})

const profile = isDev ? 'debug' : 'release'
const source = join(root, 'src-tauri', 'target', profile, cliBinaryName)
const destinationDir = join(root, 'src-tauri', 'resources', 'bin')
const destination = join(destinationDir, cliBinaryName)

mkdirSync(destinationDir, { recursive: true })
copyFileSync(source, destination)

console.log(`Prepared Mita CLI: ${destination}`)
