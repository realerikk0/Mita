import { copyFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const isDev = process.argv.includes('--dev')
const cliOnly = process.argv.includes('--cli-only')
const makeTarget = isDev ? 'build-cli-dev' : 'build-cli'

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    ...options,
  })

  if (result.error) {
    console.error(result.error.message)
    process.exit(1)
  }

  if (result.status !== 0) {
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

run('cargo', cargoArgs)

const profile = isDev ? 'debug' : 'release'
const source = join(root, 'src-tauri', 'target', profile, cliBinaryName)
const destinationDir = join(root, 'src-tauri', 'resources', 'bin')
const destination = join(destinationDir, cliBinaryName)

mkdirSync(destinationDir, { recursive: true })
copyFileSync(source, destination)

console.log(`Prepared Mita CLI: ${destination}`)
