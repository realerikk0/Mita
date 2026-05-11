import { copyFileSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

if (process.platform !== 'win32') {
  console.log('Skipping Windows Computer Use runner build on non-Windows host.')
  process.exit(0)
}

const release = process.argv.includes('--release')
const profile = release ? 'release' : 'debug'
const root = process.cwd()
const manifestPath = join(root, 'src-tauri', 'Cargo.toml')
const cargoArgs = [
  'build',
  '--manifest-path',
  manifestPath,
  '--features',
  'computer-runner',
  '--bin',
  'mita-computer-runner',
]

if (release) {
  cargoArgs.push('--release')
}

const result = spawnSync('cargo', cargoArgs, {
  cwd: root,
  stdio: 'inherit',
})

if (result.status !== 0) {
  process.exit(result.status ?? 1)
}

const source = join(
  root,
  'src-tauri',
  'target',
  profile,
  'mita-computer-runner.exe'
)
const destinationDir = join(root, 'src-tauri', 'resources', 'computer-runner')
const destination = join(destinationDir, 'mita-computer-runner.exe')

statSync(source)
mkdirSync(destinationDir, { recursive: true })
copyFileSync(source, destination)

console.log(`Prepared Windows Computer Use runner: ${destination}`)
