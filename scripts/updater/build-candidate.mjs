#!/usr/bin/env node

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (!key.startsWith('--')) throw new Error(`Unexpected argument: ${key}`)
    args[key.slice(2)] = argv[index + 1]
    index += 1
  }
  return args
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function findExactlyOne(root, matcher, description) {
  const matches = []
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(absolute)
      else if (matcher(entry.name, absolute)) matches.push(absolute)
    }
  }
  visit(root)
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${description}, found ${matches.length}: ${matches.join(', ')}`)
  }
  return matches[0]
}

function assertBiyanArtifactName(file) {
  const name = path.basename(file)
  if (/\b(?:jan|mita)(?:[-_.]|$)/i.test(name)) {
    throw new Error(`Release artifact still uses a retired product name: ${name}`)
  }
}

export function buildCandidate({
  version,
  tag = `v${version}`,
  artifactsDir,
  outputDir,
  assetBaseUrl,
  publishedAt,
  sourceCommit,
  migrationPhase,
  dataSchema,
}) {
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version ?? '')) {
    throw new Error(`Invalid version: ${version}`)
  }
  if (tag !== `v${version}`) throw new Error(`Tag ${tag} does not match version ${version}`)
  if (!/^[0-9a-f]{40}$/i.test(sourceCommit ?? '')) throw new Error(`Invalid source commit: ${sourceCommit}`)
  if (!['A', 'B', 'C'].includes(migrationPhase)) {
    throw new Error(`Invalid migration phase: ${migrationPhase}`)
  }
  const expectedDataSchema = { A: 1, B: 2, C: 3 }[migrationPhase]
  if (Number(dataSchema) !== expectedDataSchema) {
    throw new Error(`Migration phase ${migrationPhase} requires data schema ${expectedDataSchema}`)
  }
  if (!fs.statSync(artifactsDir).isDirectory()) throw new Error(`Not a directory: ${artifactsDir}`)

  const macArchive = findExactlyOne(
    artifactsDir,
    (name) => name === 'Biyan.app.tar.gz',
    'Biyan.app.tar.gz',
  )
  const windowsInstaller = findExactlyOne(
    artifactsDir,
    (name) => name === `Biyan_${version}_x64-setup.exe`,
    `Biyan_${version}_x64-setup.exe`,
  )
  const linuxAppImage = findExactlyOne(
    artifactsDir,
    (name) => name === `Biyan_${version}_amd64.AppImage`,
    `Biyan_${version}_amd64.AppImage`,
  )
  const inputs = [
    macArchive, `${macArchive}.sig`, windowsInstaller, `${windowsInstaller}.sig`,
    linuxAppImage, `${linuxAppImage}.sig`,
  ]
  for (const file of inputs) {
    if (!fs.existsSync(file)) throw new Error(`Missing updater artifact: ${file}`)
    assertBiyanArtifactName(file)
  }

  fs.mkdirSync(outputDir, { recursive: true })
  for (const file of inputs) fs.copyFileSync(file, path.join(outputDir, path.basename(file)))

  const base = assetBaseUrl.replace(/\/$/, '')
  const objectPrefix = `biyan/updater/releases/v${version}`
  const macName = path.basename(macArchive)
  const windowsName = path.basename(windowsInstaller)
  const linuxName = path.basename(linuxAppImage)
  const manifest = {
    version,
    sourceCommit: sourceCommit.toLowerCase(),
    migrationPhase,
    dataSchema: Number(dataSchema),
    notes: '',
    pub_date: new Date(publishedAt).toISOString(),
    platforms: {
      'darwin-aarch64': {
        signature: fs.readFileSync(`${macArchive}.sig`, 'utf8').trim(),
        url: `${base}/${objectPrefix}/${macName}`,
      },
      'darwin-x86_64': {
        signature: fs.readFileSync(`${macArchive}.sig`, 'utf8').trim(),
        url: `${base}/${objectPrefix}/${macName}`,
      },
      'windows-x86_64': {
        signature: fs.readFileSync(`${windowsInstaller}.sig`, 'utf8').trim(),
        url: `${base}/${objectPrefix}/${windowsName}`,
      },
      'linux-x86_64': {
        signature: fs.readFileSync(`${linuxAppImage}.sig`, 'utf8').trim(),
        url: `${base}/${objectPrefix}/${linuxName}`,
      },
    },
  }
  const manifestBytes = `${JSON.stringify(manifest, null, 2)}\n`
  const manifestPath = path.join(outputDir, 'latest.json')
  fs.writeFileSync(manifestPath, manifestBytes)

  const asset = (platform, file, signatureFile) => ({
    platform,
    file: path.basename(file),
    signatureFile: path.basename(signatureFile),
    sha256: sha256(file),
    signatureSha256: sha256(signatureFile),
    objectKey: `${objectPrefix}/${path.basename(file)}`,
    url: `${base}/${objectPrefix}/${path.basename(file)}`,
  })
  const candidate = {
    schema: 1,
    tag,
    version,
    sourceCommit: sourceCommit.toLowerCase(),
    migrationPhase,
    dataSchema: Number(dataSchema),
    publishedAt: manifest.pub_date,
    manifestFile: 'latest.json',
    manifestKey: `${objectPrefix}/latest.json`,
    manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
    assets: [
      asset('darwin-universal', macArchive, `${macArchive}.sig`),
      asset('windows-x86_64', windowsInstaller, `${windowsInstaller}.sig`),
      asset('linux-x86_64', linuxAppImage, `${linuxAppImage}.sig`),
    ],
  }
  fs.writeFileSync(path.join(outputDir, 'candidate.json'), `${JSON.stringify(candidate, null, 2)}\n`)
  return candidate
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const args = parseArgs(process.argv.slice(2))
    const candidate = buildCandidate({
      version: args.version,
      tag: args.tag,
      artifactsDir: path.resolve(args['artifacts-dir']),
      outputDir: path.resolve(args['output-dir']),
      assetBaseUrl: args['asset-base-url'],
      publishedAt: args['published-at'],
      sourceCommit: args['source-commit'],
      migrationPhase: args['migration-phase'],
      dataSchema: args['data-schema'],
    })
    console.log(`Built immutable updater candidate ${candidate.tag}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
