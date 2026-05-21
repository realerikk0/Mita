import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

if (!['win32', 'darwin'].includes(process.platform)) {
  console.log('Skipping Computer Agent runner build on this host.')
  process.exit(0)
}

const release = process.argv.includes('--release')
const useDarwinUniversal = process.argv.includes('--universal-darwin')
const profile = release ? 'release' : 'debug'
const root = process.cwd()
const manifestPath = join(root, 'src-tauri', 'Cargo.toml')
const runnerName =
  process.platform === 'win32'
    ? 'mita-computer-agent-runner.exe'
    : 'mita-computer-agent-runner'
const universalSource = join(
  root,
  'src-tauri',
  'target',
  'universal-apple-darwin',
  'release',
  runnerName,
)
const cargoName = process.platform === 'win32' ? 'cargo.exe' : 'cargo'
const cargoPath = process.env.CARGO || (() => {
  const homeCargo = join(process.env.HOME ?? '', '.cargo', 'bin', cargoName)
  return existsSync(homeCargo) ? homeCargo : 'cargo'
})()
const cargoArgs = [
  'build',
  '--manifest-path',
  manifestPath,
  '--features',
  'computer-agent-runner',
  '--bin',
  'mita-computer-agent-runner',
]

if (release) {
  cargoArgs.push('--release')
}

const shouldUseDarwinUniversal =
  process.platform === 'darwin' && release && useDarwinUniversal

if (!shouldUseDarwinUniversal) {
  const result = spawnSync(cargoPath, cargoArgs, {
    cwd: root,
    stdio: 'inherit',
  })

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
} else if (!existsSync(universalSource)) {
  console.error(
    `Expected universal macOS Computer Agent runner at ${universalSource}; run yarn build:cli first.`,
  )
  process.exit(1)
}

const source = shouldUseDarwinUniversal
  ? universalSource
  : join(root, 'src-tauri', 'target', profile, runnerName)
const destinationDir = join(root, 'src-tauri', 'resources', 'computer-agent-runner')
const destination = join(destinationDir, runnerName)

statSync(source)
mkdirSync(destinationDir, { recursive: true })
copyFileSync(source, destination)

console.log(`Prepared Computer Agent runner: ${destination}`)
