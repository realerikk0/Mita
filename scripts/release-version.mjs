#!/usr/bin/env node
import fs from 'node:fs'

const PRODUCT_VERSION_FILES = [
  {
    file: 'src-tauri/tauri.conf.json',
    kind: 'json',
    read: (json) => json.version,
    write: (json, version) => {
      json.version = version
    },
  },
  {
    file: 'src-tauri/Cargo.toml',
    kind: 'cargo',
  },
]

const BUILD_STAMP_JSON_FILES = [
  'web-app/package.json',
  'src-tauri/plugins/tauri-plugin-hardware/package.json',
  'src-tauri/plugins/tauri-plugin-document-parser/package.json',
]

const BUILD_STAMP_CARGO_FILES = [
  'src-tauri/plugins/tauri-plugin-hardware/Cargo.toml',
  'src-tauri/plugins/tauri-plugin-document-parser/Cargo.toml',
]

function usage() {
  console.error(`Usage:
  node scripts/release-version.mjs bump <version>
  node scripts/release-version.mjs check <version>
  node scripts/release-version.mjs stamp <version> [--windows]

Examples:
  yarn release:version 0.6.617
  yarn release:check-version v0.6.617`)
}

function normalizeVersion(raw) {
  const value = String(raw ?? '').trim()
  const version = value.startsWith('v') ? value.slice(1) : value

  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid release version "${value}". Expected semver like 0.6.617 or v0.6.617.`)
  }

  return version
}

function resolveVersion(args) {
  const positional = args.find((arg) => !arg.startsWith('--'))
  return normalizeVersion(positional ?? process.env.VERSION ?? process.env.RELEASE_VERSION ?? process.env.GITHUB_REF_NAME)
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

function readCargoVersion(file) {
  const source = fs.readFileSync(file, 'utf8')
  const match = source.match(/^version\s*=\s*"([^"]+)"/m)
  if (!match) {
    throw new Error(`Could not find package version in ${file}`)
  }
  return match[1]
}

function writeCargoVersion(file, version) {
  if (!fs.existsSync(file)) return
  const source = fs.readFileSync(file, 'utf8')
  if (!/^version\s*=\s*"[^"]+"/m.test(source)) {
    throw new Error(`Could not find package version in ${file}`)
  }
  const next = source.replace(/^version\s*=\s*"[^"]+"/m, `version = "${version}"`)
  fs.writeFileSync(file, next)
}

function readProductVersion(entry) {
  if (entry.kind === 'json') {
    return entry.read(readJson(entry.file))
  }
  return readCargoVersion(entry.file)
}

function writeProductVersion(entry, version) {
  if (entry.kind === 'json') {
    const json = readJson(entry.file)
    entry.write(json, version)
    const source = fs.readFileSync(entry.file, 'utf8')
    if (!/^(\s*"version"\s*:\s*)"[^"]+"/m.test(source)) {
      throw new Error(`Could not update JSON version in ${entry.file}`)
    }
    const next = source.replace(/^(\s*"version"\s*:\s*)"[^"]+"/m, `$1"${version}"`)
    fs.writeFileSync(entry.file, next)
    return
  }

  writeCargoVersion(entry.file, version)
}

function bump(version) {
  for (const entry of PRODUCT_VERSION_FILES) {
    writeProductVersion(entry, version)
  }
  console.log(`Updated product version files to ${version}`)
}

function check(version) {
  const mismatches = PRODUCT_VERSION_FILES.flatMap((entry) => {
    const actual = readProductVersion(entry)
    return actual === version ? [] : [{ file: entry.file, actual }]
  })

  if (mismatches.length > 0) {
    const details = mismatches.map(({ file, actual }) => `- ${file}: ${actual}`).join('\n')
    throw new Error(
      `Release version mismatch. Expected ${version}, found:\n${details}\n\nRun: yarn release:version ${version}, commit it, then push tag v${version}.`
    )
  }

  console.log(`Release version ${version} matches product version files`)
}

function writeJsonVersion(file, version) {
  if (!fs.existsSync(file)) return
  const json = readJson(file)
  json.version = version
  writeJson(file, json)
}

function windowsVersionInfo(appVersion) {
  const [base] = appVersion.split('+')
  const [numericBase, suffix = '0'] = base.split('-', 2)
  const suffixNumber = suffix.match(/\d+$/)?.[0] ?? '0'
  return {
    fileVersion: numericBase,
    productVersion: `${numericBase}.${suffixNumber}`,
  }
}

function stamp(version, options) {
  bump(version)

  const tauriConfig = readJson('src-tauri/tauri.conf.json')
  tauriConfig.bundle ??= {}
  tauriConfig.bundle.createUpdaterArtifacts = true
  writeJson('src-tauri/tauri.conf.json', tauriConfig)

  for (const file of BUILD_STAMP_JSON_FILES) {
    writeJsonVersion(file, version)
  }

  for (const file of BUILD_STAMP_CARGO_FILES) {
    writeCargoVersion(file, version)
  }

  if (options.windows) {
    stampWindowsBuildFiles(version)
  }

  console.log(`Stamped release build version ${version}`)
}

function stampWindowsBuildFiles(version) {
  const windowsConfigPath = 'src-tauri/tauri.windows.conf.json'
  if (fs.existsSync(windowsConfigPath)) {
    const json = readJson(windowsConfigPath)
    json.bundle ??= {}
    json.bundle.windows ??= {}
    delete json.bundle.windows.signCommand
    if (json.bundle.windows.nsis) {
      delete json.bundle.windows.nsis.template
    }
    writeJson(windowsConfigPath, json)
  }

  const templatePath = 'src-tauri/tauri.bundle.windows.nsis.template'
  if (fs.existsSync(templatePath)) {
    const { fileVersion, productVersion } = windowsVersionInfo(version)
    const next = fs
      .readFileSync(templatePath, 'utf8')
      .replaceAll('biyan_productname', 'Biyan')
      .replaceAll('biyan_mainbinaryname', 'Biyan')
      .replaceAll('biyan_version', fileVersion)
      .replaceAll('biyan_build', productVersion)
      .replace(/^!define UNINSTALLERSIGNCOMMAND .*$/m, '!define UNINSTALLERSIGNCOMMAND ""')
    fs.writeFileSync(templatePath, next)
  }
}

try {
  const [command, ...args] = process.argv.slice(2)
  if (!['bump', 'check', 'stamp'].includes(command)) {
    usage()
    process.exit(1)
  }

  const version = resolveVersion(args)

  if (command === 'bump') {
    bump(version)
  } else if (command === 'check') {
    check(version)
  } else if (command === 'stamp') {
    stamp(version, { windows: args.includes('--windows') })
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
