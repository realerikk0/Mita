#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  assertMacOSArchitectures,
  isMachOFile,
} from './macos-architecture-policy.mjs'

export const EXPECTED_PREINSTALL_PACKAGES = [
  'biyan-assistant-extension-1.0.2.tgz',
  'biyan-conversational-extension-1.0.0.tgz',
  'biyan-download-extension-1.0.0.tgz',
]

const EXPECTED_BUNDLE_ID = 'uk.jingxing.mita'
const EXPECTED_PRODUCT_NAME = 'Biyan'
const EXPECTED_MINIMUM_SYSTEM_VERSION = '12.0'
const EXPECTED_SIGNING_AUTHORITY =
  'Developer ID Application: LILYN DYNAMICS (7NZP53ZJ4D)'
const EXPECTED_TEAM_ID = '7NZP53ZJ4D'
const RETIRED_PRODUCT_PATH =
  /(?:^|[-_.@\s])(?:jan(?:hq)?|mita|silence)(?=$|[-_.\s])/i
const RETIRED_RUNTIME_PATH =
  /(?:^|[-_.\s])(?:llama(?:[-_.]?cpp)?|mlx|foundation[-_.]?models?|rag|vector[-_.]?db|local[-_.]?models?)(?=$|[-_.\s])/i

function assertSemver(version) {
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version ?? '')) {
    throw new Error(`Invalid candidate version: ${version ?? 'missing'}`)
  }
}

function assertDirectory(directory, description) {
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    throw new Error(`${description} is not a directory: ${directory}`)
  }
}

function assertFile(file, description) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw new Error(`${description} is not a file: ${file}`)
  }
}

function walkBundle(root) {
  const entries = []
  const visit = (directory) => {
    for (const entry of fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = path.join(directory, entry.name)
      entries.push({ absolute, entry })
      if (entry.isDirectory()) visit(absolute)
    }
  }
  visit(root)
  return entries
}

function assertSafeBundlePaths(appPath, entries) {
  for (const { absolute } of entries) {
    const relative = path.relative(appPath, absolute)
    for (const component of relative.split(path.sep)) {
      if (RETIRED_PRODUCT_PATH.test(component)) {
        throw new Error(
          `Retired product name found in candidate path: ${relative}`
        )
      }
      if (RETIRED_RUNTIME_PATH.test(component)) {
        throw new Error(
          `Retired local runtime found in candidate path: ${relative}`
        )
      }
    }
  }
}

function assertIdenticalFile(candidateFile, sourceFile, label) {
  assertFile(candidateFile, `Bundled ${label}`)
  assertFile(sourceFile, `Repository ${label}`)
  if (!fs.readFileSync(candidateFile).equals(fs.readFileSync(sourceFile))) {
    throw new Error(`Bundled ${label} does not byte-match ${sourceFile}`)
  }
}

function assertPreinstallPackages(preinstallDirectory) {
  assertDirectory(preinstallDirectory, 'Bundled pre-install directory')
  const entries = fs
    .readdirSync(preinstallDirectory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
  const invalidEntry = entries.find((entry) => !entry.isFile())
  if (invalidEntry) {
    throw new Error(`Unexpected non-file in pre-install: ${invalidEntry.name}`)
  }
  const actual = entries.map((entry) => entry.name)
  const expected = [...EXPECTED_PREINSTALL_PACKAGES].sort()
  if (actual.join('\n') !== expected.join('\n')) {
    throw new Error(
      `Bundled pre-install packages differ; expected [${expected.join(', ')}], found [${actual.join(', ')}]`
    )
  }
}

function defaultRunCommand(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `${command} exited with status ${String(result.status)}: ${String(result.stderr).trim()}`
    )
  }
  return `${result.stdout ?? ''}${result.stderr ?? ''}`
}

function sha256File(file) {
  const hash = crypto.createHash('sha256')
  const descriptor = fs.openSync(file, 'r')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  try {
    for (;;) {
      const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null)
      if (bytesRead === 0) break
      hash.update(buffer.subarray(0, bytesRead))
    }
  } finally {
    fs.closeSync(descriptor)
  }
  return hash.digest('hex')
}

function bundleSnapshot(appPath) {
  const root = path.resolve(appPath)
  return walkBundle(root).map(({ absolute, entry }) => {
    const relative = path.relative(root, absolute).split(path.sep).join('/')
    const stat = fs.lstatSync(absolute)
    if (entry.isDirectory()) return { path: relative, type: 'directory' }
    if (entry.isFile()) {
      return {
        path: relative,
        type: 'file',
        size: stat.size,
        executable: (stat.mode & 0o111) !== 0,
        sha256: sha256File(absolute),
      }
    }
    if (entry.isSymbolicLink()) {
      const target = fs.readlinkSync(absolute)
      const resolvedTarget = path.resolve(path.dirname(absolute), target)
      if (
        resolvedTarget !== root &&
        !resolvedTarget.startsWith(`${root}${path.sep}`)
      ) {
        throw new Error(`Bundle symlink escapes the app: ${relative} -> ${target}`)
      }
      return { path: relative, type: 'symlink', target }
    }
    throw new Error(`Unsupported bundle entry: ${relative}`)
  })
}

function assertDmgContainsIdenticalApp(appPath, dmgPath, runCommand) {
  const mountPoint = fs.mkdtempSync(path.join(os.tmpdir(), 'biyan-dmg-'))
  let attached = false
  try {
    runCommand('hdiutil', [
      'attach',
      '-readonly',
      '-nobrowse',
      '-noautoopen',
      '-mountpoint',
      mountPoint,
      dmgPath,
    ])
    attached = true
    const mountedApp = path.join(mountPoint, `${EXPECTED_PRODUCT_NAME}.app`)
    const mountedStat = fs.lstatSync(mountedApp, { throwIfNoEntry: false })
    if (!mountedStat?.isDirectory() || mountedStat.isSymbolicLink()) {
      throw new Error(
        `DMG does not contain a regular ${EXPECTED_PRODUCT_NAME}.app`
      )
    }
    const sourceSnapshot = bundleSnapshot(appPath)
    const mountedSnapshot = bundleSnapshot(mountedApp)
    if (JSON.stringify(sourceSnapshot) !== JSON.stringify(mountedSnapshot)) {
      const length = Math.max(sourceSnapshot.length, mountedSnapshot.length)
      let mismatch = 'unknown entry'
      for (let index = 0; index < length; index += 1) {
        if (
          JSON.stringify(sourceSnapshot[index] ?? null) !==
          JSON.stringify(mountedSnapshot[index] ?? null)
        ) {
          mismatch =
            sourceSnapshot[index]?.path ?? mountedSnapshot[index]?.path ?? mismatch
          break
        }
      }
      throw new Error(`DMG Biyan.app differs from accepted app at: ${mismatch}`)
    }
  } finally {
    if (attached) runCommand('hdiutil', ['detach', mountPoint])
    fs.rmSync(mountPoint, { force: true, recursive: true })
  }
}

function readInfoPlist(infoPlist, runCommand) {
  const source = runCommand('plutil', [
    '-convert',
    'json',
    '-o',
    '-',
    infoPlist,
  ])
  try {
    return JSON.parse(source)
  } catch (error) {
    throw new Error(`Could not parse ${infoPlist}: ${error.message}`)
  }
}

function assertInfoPlist(plist, version) {
  const expected = {
    CFBundleDisplayName: EXPECTED_PRODUCT_NAME,
    CFBundleExecutable: EXPECTED_PRODUCT_NAME,
    CFBundleIdentifier: EXPECTED_BUNDLE_ID,
    CFBundleName: EXPECTED_PRODUCT_NAME,
    CFBundleShortVersionString: version,
    CFBundleVersion: version,
    LSMinimumSystemVersion: EXPECTED_MINIMUM_SYSTEM_VERSION,
  }
  for (const [key, value] of Object.entries(expected)) {
    if (String(plist[key] ?? '') !== value) {
      throw new Error(
        `Info.plist ${key} is ${JSON.stringify(plist[key] ?? null)}, expected ${JSON.stringify(value)}`
      )
    }
  }
}

function inspectMachOArchitectures(appPath, entries, runCommand) {
  const machOFiles = entries
    .filter(({ entry }) => entry.isFile())
    .map(({ absolute }) => absolute)
    .filter(isMachOFile)
  if (machOFiles.length === 0) {
    throw new Error(`No Mach-O files found in candidate app: ${appPath}`)
  }

  for (const file of machOFiles) {
    const architectures = runCommand('lipo', ['-archs', file])
      .trim()
      .split(/\s+/)
      .filter(Boolean)
    assertMacOSArchitectures(path.relative(appPath, file), architectures)
  }
  return machOFiles
}

export function parseMacOSCandidateArgs(argv) {
  const options = {}
  const supported = new Set(['app', 'dmg', 'repo-root', 'version', 'signature'])
  for (let index = 0; index < argv.length; index += 2) {
    const argument = argv[index]
    const value = argv[index + 1]
    if (!argument?.startsWith('--') || !supported.has(argument.slice(2))) {
      throw new Error(`Unexpected argument: ${argument ?? 'missing'}`)
    }
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${argument}`)
    }
    const name = argument.slice(2)
    if (options[name]) throw new Error(`Duplicate argument: ${argument}`)
    options[name] = value
  }

  for (const required of ['app', 'dmg', 'version']) {
    if (!options[required])
      throw new Error(`Missing required argument: --${required}`)
  }
  if (
    options.signature !== undefined &&
    options.signature !== 'production' &&
    options.signature !== 'ad-hoc'
  ) {
    throw new Error(`Unsupported signature mode: ${options.signature}`)
  }
  return options
}

export function verifyMacOSCandidate(
  {
    appPath,
    dmgPath,
    version,
    repoRoot,
    signatureMode = 'production',
  },
  { runCommand = defaultRunCommand } = {}
) {
  assertSemver(version)
  const resolvedApp = path.resolve(appPath)
  const resolvedDmg = path.resolve(dmgPath)
  const resolvedRepo = path.resolve(
    repoRoot ?? path.join(import.meta.dirname, '..')
  )

  assertDirectory(resolvedApp, 'Candidate app')
  assertFile(resolvedDmg, 'Candidate DMG')
  assertDirectory(resolvedRepo, 'Repository root')
  if (path.basename(resolvedApp) !== `${EXPECTED_PRODUCT_NAME}.app`) {
    throw new Error(`Candidate app must be named ${EXPECTED_PRODUCT_NAME}.app`)
  }
  const expectedDmgName = `${EXPECTED_PRODUCT_NAME}_${version}_universal.dmg`
  if (path.basename(resolvedDmg) !== expectedDmgName) {
    throw new Error(`Candidate DMG must be named ${expectedDmgName}`)
  }

  const contents = path.join(resolvedApp, 'Contents')
  const resources = path.join(contents, 'Resources', 'resources')
  const infoPlist = path.join(contents, 'Info.plist')
  const executable = path.join(contents, 'MacOS', EXPECTED_PRODUCT_NAME)
  assertFile(infoPlist, 'Candidate Info.plist')
  assertFile(executable, 'Candidate executable')
  if (!isMachOFile(executable)) {
    throw new Error(`Candidate executable is not a Mach-O file: ${executable}`)
  }
  assertInfoPlist(readInfoPlist(infoPlist, runCommand), version)

  assertIdenticalFile(
    path.join(resources, 'LICENSE'),
    path.join(resolvedRepo, 'LICENSE'),
    'LICENSE'
  )
  assertIdenticalFile(
    path.join(resources, 'NOTICE'),
    path.join(resolvedRepo, 'NOTICE'),
    'NOTICE'
  )
  assertPreinstallPackages(path.join(resources, 'pre-install'))

  const entries = walkBundle(resolvedApp)
  assertSafeBundlePaths(resolvedApp, entries)
  const machOFiles = inspectMachOArchitectures(resolvedApp, entries, runCommand)

  runCommand('codesign', [
    '--verify',
    '--deep',
    '--strict',
    '--verbose=2',
    resolvedApp,
  ])
  const signature = runCommand('codesign', [
    '--display',
    '--verbose=4',
    resolvedApp,
  ])
  if (signatureMode === 'production') {
    if (!signature.includes(`Authority=${EXPECTED_SIGNING_AUTHORITY}`)) {
      throw new Error(
        `Candidate app is not signed by ${EXPECTED_SIGNING_AUTHORITY}`
      )
    }
    if (!signature.includes(`TeamIdentifier=${EXPECTED_TEAM_ID}`)) {
      throw new Error(`Candidate app is not signed by team ${EXPECTED_TEAM_ID}`)
    }
  } else if (signatureMode === 'ad-hoc') {
    if (!signature.includes('Signature=adhoc')) {
      throw new Error('Qualification app is not ad-hoc signed')
    }
    if (
      signature.includes('Authority=') ||
      /TeamIdentifier=(?!not set)/.test(signature)
    ) {
      throw new Error(
        'Ad-hoc qualification app unexpectedly carries a signing identity'
      )
    }
  } else {
    throw new Error(`Unsupported signature mode: ${signatureMode}`)
  }
  runCommand('hdiutil', ['verify', resolvedDmg])
  assertDmgContainsIdenticalApp(resolvedApp, resolvedDmg, runCommand)

  return {
    appPath: resolvedApp,
    dmgPath: resolvedDmg,
    machOCount: machOFiles.length,
    preinstallPackages: [...EXPECTED_PREINSTALL_PACKAGES],
    version,
  }
}

function usage() {
  return `Usage: node scripts/verify-macos-candidate.mjs --app <Biyan.app> --dmg <Biyan_VERSION_universal.dmg> --version <version> [--repo-root <repository>] [--signature <production|ad-hoc>]`
}

function main() {
  if (process.platform !== 'darwin') {
    throw new Error('macOS candidate verification requires a macOS host')
  }
  const args = parseMacOSCandidateArgs(process.argv.slice(2))
  const result = verifyMacOSCandidate({
    appPath: args.app,
    dmgPath: args.dmg,
    repoRoot: args['repo-root'],
    version: args.version,
    signatureMode: args.signature ?? 'production',
  })
  console.log(
    `macOS candidate verified: ${result.version}, ${result.machOCount} Mach-O file(s), ${result.preinstallPackages.length} pre-install package(s)`
  )
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    console.error(usage())
    process.exitCode = 1
  }
}
