#!/usr/bin/env node

import fs from 'node:fs'

const [cargoTomlPath, channel] = process.argv.slice(2)

if (!cargoTomlPath || !channel) {
  console.error('Usage: rename-cargo-channel-app.mjs <Cargo.toml> <channel>')
  process.exit(1)
}

if (!/^[A-Za-z0-9._-]+$/.test(channel)) {
  console.error(`Invalid channel: ${channel}`)
  process.exit(1)
}

const appName = `Biyan-${channel}`
const source = fs.readFileSync(cargoTomlPath, 'utf8')
const lines = source.split('\n')

let section = ''
let binIndex = 0
let packageNameUpdated = false
let defaultRunUpdated = false
let mainBinUpdated = false

for (let index = 0; index < lines.length; index += 1) {
  const trimmed = lines[index].trim()

  if (trimmed === '[package]') {
    section = 'package'
    continue
  }

  if (trimmed === '[[bin]]') {
    section = 'bin'
    binIndex += 1
    continue
  }

  if (trimmed.startsWith('[')) {
    section = 'other'
  }

  if (section === 'package' && /^\s*name\s*=/.test(lines[index])) {
    lines[index] = lines[index].replace(/"[^"]+"/, `"${appName}"`)
    packageNameUpdated = true
    continue
  }

  if (section === 'package' && /^\s*default-run\s*=/.test(lines[index])) {
    lines[index] = lines[index].replace(/"[^"]+"/, `"${appName}"`)
    defaultRunUpdated = true
    continue
  }

  if (section === 'bin' && binIndex === 1 && /^\s*name\s*=/.test(lines[index])) {
    lines[index] = lines[index].replace(/"[^"]+"/, `"${appName}"`)
    mainBinUpdated = true
  }
}

const missingUpdates = [
  ['package.name', packageNameUpdated],
  ['package.default-run', defaultRunUpdated],
  ['first [[bin]].name', mainBinUpdated],
]
  .filter(([, updated]) => !updated)
  .map(([name]) => name)

if (missingUpdates.length > 0) {
  console.error(`Could not update ${missingUpdates.join(', ')} in ${cargoTomlPath}`)
  process.exit(1)
}

fs.writeFileSync(cargoTomlPath, lines.join('\n'))
