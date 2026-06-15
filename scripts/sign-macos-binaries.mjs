#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  readdirSync,
  statSync,
} from 'node:fs'
import { basename, extname, join, relative } from 'node:path'

const EXPECTED_IDENTITY = 'Developer ID Application: LILYN DYNAMICS (7NZP53ZJ4D)'
const root = process.cwd()
const resourcesRoot = join(root, 'src-tauri', 'resources')
const entitlements = join(root, 'src-tauri', 'Entitlements.plist')
const dryRun = process.argv.includes('--dry-run')

if (process.platform !== 'darwin') {
  console.log('Skipping macOS binary signing on non-macOS host.')
  process.exit(0)
}

const identity = process.env.APPLE_SIGNING_IDENTITY || EXPECTED_IDENTITY

if (identity !== EXPECTED_IDENTITY) {
  console.error(`Unexpected macOS signing identity: ${identity}`)
  console.error(`Expected: ${EXPECTED_IDENTITY}`)
  process.exit(1)
}

if (!existsSync(resourcesRoot)) {
  console.log(`No resources directory found at ${resourcesRoot}; nothing to sign.`)
  process.exit(0)
}

if (!existsSync(entitlements)) {
  console.error(`Missing entitlements file: ${entitlements}`)
  process.exit(1)
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
  })
}

function assertIdentityAvailable() {
  if (dryRun) return

  const identities = run('security', ['find-identity', '-v', '-p', 'codesigning'])
  if (!identities.includes(`"${identity}"`)) {
    console.error(`Developer ID identity not found in keychain: ${identity}`)
    process.exit(1)
  }
}

function walkFiles(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)

    if (stat.isDirectory()) {
      walkFiles(fullPath, files)
    } else if (stat.isFile()) {
      files.push(fullPath)
    }
  }

  return files
}

function walkCodeDirectories(dir, directories = []) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)

    if (!stat.isDirectory()) continue

    if (/\.(app|bundle|framework)$/i.test(entry)) {
      directories.push(fullPath)
    }

    walkCodeDirectories(fullPath, directories)
  }

  return directories
}

function isExecutable(stat) {
  return (stat.mode & 0o111) !== 0
}

function isLikelyBinaryCandidate(filePath) {
  const name = basename(filePath)
  const ext = extname(filePath)
  const stat = statSync(filePath)

  return (
    isExecutable(stat) ||
    ext === '.dylib' ||
    ext === '.node' ||
    [
      'bun',
      'uv',
      'mita-cli',
      'mlx-server',
      'mita-computer-agent-runner',
      'chrome-headless-shell',
      'ffmpeg-mac',
    ].includes(name)
  )
}

function fileDescription(filePath) {
  return run('file', ['-b', filePath]).trim()
}

function isMachO(filePath) {
  return fileDescription(filePath).includes('Mach-O')
}

function shouldUseEntitlements(filePath) {
  const ext = extname(filePath)
  const description = fileDescription(filePath)

  if (ext === '.dylib' || ext === '.node') return false
  if (description.includes('dynamically linked shared library')) return false
  if (description.includes('bundle')) return false

  return isExecutable(statSync(filePath))
}

function isSignableCodeDirectory(directory) {
  return (
    existsSync(join(directory, 'Contents', 'Info.plist')) ||
    existsSync(join(directory, 'Resources', 'Info.plist')) ||
    existsSync(join(directory, 'Versions', 'Current', 'Resources', 'Info.plist'))
  )
}

function signPath(filePath, { entitle = false, deep = false } = {}) {
  const label = relative(root, filePath)
  const args = ['--force', '--options', 'runtime', '--timestamp', '--sign', identity]

  if (entitle) {
    args.push('--entitlements', entitlements)
  }

  if (deep) {
    args.push('--deep')
  }

  args.push(filePath)

  if (dryRun) {
    console.log(`[dry-run] codesign ${args.map((arg) => JSON.stringify(arg)).join(' ')}`)
    return
  }

  console.log(`Signing ${label}`)
  run('codesign', args, { stdio: 'inherit' })
  run('codesign', ['--verify', '--strict', '--verbose=1', filePath], {
    stdio: 'inherit',
  })
}

assertIdentityAvailable()

const machOFiles = walkFiles(resourcesRoot)
  .filter(isLikelyBinaryCandidate)
  .filter(isMachO)
  .sort((a, b) => a.localeCompare(b))

const codeDirectories = walkCodeDirectories(resourcesRoot).sort(
  (a, b) => b.length - a.length,
).filter(isSignableCodeDirectory)

if (machOFiles.length === 0 && !dryRun) {
  console.error(`No Mach-O files found under ${resourcesRoot}`)
  process.exit(1)
}

for (const filePath of machOFiles) {
  signPath(filePath, { entitle: shouldUseEntitlements(filePath) })
}

for (const directory of codeDirectories) {
  signPath(directory, { deep: true })
}

console.log(
  `macOS binary signing complete: ${machOFiles.length} Mach-O file(s), ${codeDirectories.length} code director${codeDirectories.length === 1 ? 'y' : 'ies'}.`,
)
