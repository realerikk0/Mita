#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'

export const FORBIDDEN_CANDIDATE_FINGERPRINTS = [
  'Jan GPU Detection',
  'janhq/model-catalog',
  'model_catalog_v2.json',
  'latest_jan_model.json',
  'MODEL_CATALOG_URL',
  'LATEST_MITA_MODEL_URL',
  'llama_model_path',
]

export const CANDIDATE_CONTENT_LIMITS = Object.freeze({
  directoryEntries: 250_000,
  directoryBytes: 4 * 1024 * 1024 * 1024,
  fileBytes: 1024 * 1024 * 1024,
  tarEntries: 100_000,
  tarBytes: 256 * 1024 * 1024,
  tarEntryBytes: 128 * 1024 * 1024,
  tarArchiveBytes: 128 * 1024 * 1024,
  tarMetadataBytes: 1024 * 1024,
  nestedTarDepth: 4,
  packageJsonBytes: 1024 * 1024,
})

export const EXPECTED_PREINSTALL_PACKAGE_IDENTITIES = Object.freeze([
  Object.freeze({
    file: 'biyan-assistant-extension-1.0.2.tgz',
    name: '@biyan/assistant-extension',
    version: '1.0.2',
  }),
  Object.freeze({
    file: 'biyan-conversational-extension-1.0.0.tgz',
    name: '@biyan/conversational-extension',
    version: '1.0.0',
  }),
  Object.freeze({
    file: 'biyan-download-extension-1.0.0.tgz',
    name: '@biyan/download-extension',
    version: '1.0.0',
  }),
])

const TAR_SUFFIX = /\.t(?:ar\.)?gz$/i
const WINDOWS_ABSOLUTE_PATH = /^[A-Za-z]:[\\/]/
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true })

function utf16be(value) {
  const buffer = Buffer.from(value, 'utf16le')
  for (let index = 0; index < buffer.length; index += 2) {
    const byte = buffer[index]
    buffer[index] = buffer[index + 1]
    buffer[index + 1] = byte
  }
  return buffer
}

const ENCODED_FINGERPRINTS = FORBIDDEN_CANDIDATE_FINGERPRINTS.flatMap(
  (fingerprint) => [
    {
      encoding: 'ASCII/UTF-8',
      fingerprint,
      bytes: Buffer.from(fingerprint, 'utf8'),
    },
    {
      encoding: 'UTF-16LE',
      fingerprint,
      bytes: Buffer.from(fingerprint, 'utf16le'),
    },
    {
      encoding: 'UTF-16BE',
      fingerprint,
      bytes: utf16be(fingerprint),
    },
  ]
)
const MAX_FINGERPRINT_BYTES = Math.max(
  ...ENCODED_FINGERPRINTS.map(({ bytes }) => bytes.length)
)

function policyError(message) {
  return new Error(`Candidate content policy violation: ${message}`)
}

function createFingerprintScanner(label) {
  let tail = Buffer.alloc(0)
  return {
    write(chunk) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      const window =
        tail.length === 0 ? bytes : Buffer.concat([tail, bytes], tail.length + bytes.length)
      for (const candidate of ENCODED_FINGERPRINTS) {
        if (window.indexOf(candidate.bytes) >= 0) {
          throw policyError(
            `${label} contains forbidden ${candidate.encoding} fingerprint ${JSON.stringify(candidate.fingerprint)}`
          )
        }
      }
      const keep = Math.min(MAX_FINGERPRINT_BYTES - 1, window.length)
      tail = keep === 0 ? Buffer.alloc(0) : window.subarray(window.length - keep)
    },
  }
}

function scanTextValue(value, label) {
  createFingerprintScanner(label).write(Buffer.from(value, 'utf8'))
}

function normalizeArchivePath(value) {
  return String(value).replaceAll('\\', '/')
}

function assertSafeArchivePath(value, archiveLabel) {
  const normalized = normalizeArchivePath(value)
  if (
    normalized.length === 0 ||
    normalized.includes('\0') ||
    normalized.startsWith('/') ||
    WINDOWS_ABSOLUTE_PATH.test(normalized) ||
    normalized.split('/').some((component) => component === '..')
  ) {
    throw policyError(
      `${archiveLabel} contains unsafe archive path ${JSON.stringify(value)}`
    )
  }
  scanTextValue(normalized, `${archiveLabel} member path ${normalized}`)
  return normalized.replace(/\/+$/, '')
}

function assertNpmPackageManifest(buffer, archiveLabel) {
  let manifest
  try {
    manifest = JSON.parse(UTF8_DECODER.decode(buffer))
  } catch (error) {
    throw policyError(
      `${archiveLabel} has an invalid package/package.json: ${error.message}`
    )
  }
  if (
    typeof manifest.name !== 'string' ||
    !/^@biyan\/[a-z0-9][a-z0-9._-]*$/.test(manifest.name)
  ) {
    throw policyError(
      `${archiveLabel} package name must be a scoped @biyan/* identifier`
    )
  }
  if (manifest.private !== true) {
    throw policyError(`${archiveLabel} package.json must set private=true`)
  }
  if (
    typeof manifest.version !== 'string' ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(
      manifest.version
    )
  ) {
    throw policyError(
      `${archiveLabel} package.json must declare a semantic version`
    )
  }
  return { name: manifest.name, version: manifest.version }
}

function decodeTarString(buffer, label) {
  const end = buffer.indexOf(0)
  const value = buffer.subarray(0, end < 0 ? buffer.length : end)
  try {
    return UTF8_DECODER.decode(value)
  } catch (error) {
    throw policyError(`${label} is not valid UTF-8: ${error.message}`)
  }
}

function parseTarNumber(buffer, label) {
  if ((buffer[0] & 0x80) !== 0) {
    throw policyError(`${label} uses unsupported base-256 numeric encoding`)
  }
  const value = buffer.toString('ascii').replace(/\0.*$/s, '').trim()
  if (!/^[0-7]+$/.test(value)) {
    throw policyError(`${label} is not a valid octal number`)
  }
  const parsed = Number.parseInt(value, 8)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw policyError(`${label} is outside the safe integer range`)
  }
  return parsed
}

function assertTarChecksum(header, archiveLabel, offset) {
  const expected = parseTarNumber(
    header.subarray(148, 156),
    `${archiveLabel} header checksum at offset ${offset}`
  )
  let actual = 0
  for (let index = 0; index < header.length; index += 1) {
    actual += index >= 148 && index < 156 ? 0x20 : header[index]
  }
  if (actual !== expected) {
    throw policyError(
      `${archiveLabel} has an invalid tar checksum at offset ${offset}`
    )
  }
}

function parsePaxRecords(buffer, archiveLabel) {
  const records = new Map()
  let offset = 0
  while (offset < buffer.length) {
    const space = buffer.indexOf(0x20, offset)
    if (space < 0) {
      throw policyError(`${archiveLabel} has malformed PAX record length`)
    }
    const lengthText = buffer.subarray(offset, space).toString('ascii')
    if (!/^[1-9][0-9]*$/.test(lengthText)) {
      throw policyError(`${archiveLabel} has invalid PAX record length`)
    }
    const length = Number.parseInt(lengthText, 10)
    const end = offset + length
    if (
      !Number.isSafeInteger(length) ||
      end > buffer.length ||
      buffer[end - 1] !== 0x0a
    ) {
      throw policyError(`${archiveLabel} has truncated PAX metadata`)
    }
    const record = decodeTarString(
      buffer.subarray(space + 1, end - 1),
      `${archiveLabel} PAX record`
    )
    const equals = record.indexOf('=')
    if (equals <= 0) {
      throw policyError(`${archiveLabel} has malformed PAX key/value metadata`)
    }
    records.set(record.slice(0, equals), record.slice(equals + 1))
    offset = end
  }
  return records
}

function tarTypeName(type) {
  return (
    {
      '1': 'hard link',
      '2': 'symbolic link',
      '3': 'character device',
      '4': 'block device',
      '6': 'FIFO',
      '7': 'contiguous file',
      K: 'GNU long link',
    }[type] ?? `type ${JSON.stringify(type)}`
  )
}

function readCompressedArchive(source, archiveLabel) {
  if (
    Buffer.isBuffer(source)
      ? source.length > CANDIDATE_CONTENT_LIMITS.tarArchiveBytes
      : fs.statSync(source).size > CANDIDATE_CONTENT_LIMITS.tarArchiveBytes
  ) {
    throw policyError(`${archiveLabel} exceeds compressed archive size limit`)
  }
  const compressed = Buffer.isBuffer(source) ? source : fs.readFileSync(source)
  try {
    return zlib.gunzipSync(compressed, {
      maxOutputLength: CANDIDATE_CONTENT_LIMITS.tarBytes,
    })
  } catch (error) {
    throw policyError(
      `${archiveLabel} is not a bounded valid gzip archive: ${error.message}`
    )
  }
}

function scanTarArchive(source, archiveLabel, depth) {
  if (depth > CANDIDATE_CONTENT_LIMITS.nestedTarDepth) {
    throw policyError(
      `${archiveLabel} exceeds nested .tgz depth ${CANDIDATE_CONTENT_LIMITS.nestedTarDepth}`
    )
  }
  const archive = readCompressedArchive(source, archiveLabel)
  let entryCount = 0
  let totalBytes = 0
  let offset = 0
  let sawEnd = false
  let pendingLongPath = null
  let pendingPax = null
  const manifests = []
  const nestedArchives = []

  while (offset + 512 <= archive.length) {
    const headerOffset = offset
    const header = archive.subarray(offset, offset + 512)
    offset += 512
    if (header.every((byte) => byte === 0)) {
      if (
        offset + 512 > archive.length ||
        !archive.subarray(offset, offset + 512).every((byte) => byte === 0)
      ) {
        throw policyError(`${archiveLabel} has only one tar end marker`)
      }
      offset += 512
      if (!archive.subarray(offset).every((byte) => byte === 0)) {
        throw policyError(`${archiveLabel} has nonzero data after tar end`)
      }
      sawEnd = true
      break
    }

    assertTarChecksum(header, archiveLabel, headerOffset)
    entryCount += 1
    if (entryCount > CANDIDATE_CONTENT_LIMITS.tarEntries) {
      throw policyError(`${archiveLabel} exceeds archive entry limit`)
    }
    const size = parseTarNumber(
      header.subarray(124, 136),
      `${archiveLabel} member size at offset ${headerOffset}`
    )
    if (size > CANDIDATE_CONTENT_LIMITS.tarEntryBytes) {
      throw policyError(`${archiveLabel} member exceeds size limit`)
    }
    const paddedSize = Math.ceil(size / 512) * 512
    if (offset + paddedSize > archive.length) {
      throw policyError(`${archiveLabel} has a truncated tar member`)
    }
    const content = archive.subarray(offset, offset + size)
    offset += paddedSize

    const name = decodeTarString(
      header.subarray(0, 100),
      `${archiveLabel} member name`
    )
    const prefix = decodeTarString(
      header.subarray(345, 500),
      `${archiveLabel} member prefix`
    )
    const headerPath = prefix ? `${prefix}/${name}` : name
    assertSafeArchivePath(headerPath, archiveLabel)
    const type = header[156] === 0 ? '0' : String.fromCharCode(header[156])

    if (type === 'x' || type === 'g') {
      if (size > CANDIDATE_CONTENT_LIMITS.tarMetadataBytes) {
        throw policyError(`${archiveLabel} PAX metadata exceeds size limit`)
      }
      const records = parsePaxRecords(content, archiveLabel)
      if (records.has('linkpath')) {
        throw policyError(`${archiveLabel} PAX metadata overrides linkpath`)
      }
      if (type === 'g') {
        if (records.has('path') || records.has('size')) {
          throw policyError(
            `${archiveLabel} global PAX path or size is forbidden`
          )
        }
      } else {
        pendingPax = records
      }
      continue
    }
    if (type === 'L') {
      if (size > CANDIDATE_CONTENT_LIMITS.tarMetadataBytes) {
        throw policyError(`${archiveLabel} GNU long path exceeds size limit`)
      }
      pendingLongPath = decodeTarString(
        content,
        `${archiveLabel} GNU long path`
      ).replace(/\n$/, '')
      continue
    }

    const memberPath = assertSafeArchivePath(
      pendingPax?.get('path') ?? pendingLongPath ?? headerPath,
      archiveLabel
    )
    if (pendingPax?.has('size')) {
      const paxSize = pendingPax.get('size')
      if (!/^(?:0|[1-9][0-9]*)$/.test(paxSize) || Number(paxSize) !== size) {
        throw policyError(`${archiveLabel} PAX size differs from tar header`)
      }
    }
    pendingLongPath = null
    pendingPax = null
    if (type === '5') {
      if (size !== 0) {
        throw policyError(
          `${archiveLabel} directory member has nonzero size: ${memberPath}`
        )
      }
      continue
    }
    if (type !== '0') {
      throw policyError(
        `${archiveLabel} contains forbidden ${tarTypeName(type)} member: ${memberPath}`
      )
    }

    totalBytes += size
    if (totalBytes > CANDIDATE_CONTENT_LIMITS.tarBytes) {
      throw policyError(`${archiveLabel} exceeds uncompressed archive limit`)
    }
    const scanner = createFingerprintScanner(
      `${archiveLabel} member ${memberPath}`
    )
    for (
      let contentOffset = 0;
      contentOffset < content.length;
      contentOffset += 1024 * 1024
    ) {
      scanner.write(content.subarray(contentOffset, contentOffset + 1024 * 1024))
    }
    if (memberPath === 'package/package.json') {
      if (size > CANDIDATE_CONTENT_LIMITS.packageJsonBytes) {
        throw policyError(`${archiveLabel} package.json exceeds size limit`)
      }
      manifests.push(content)
    }
    if (TAR_SUFFIX.test(memberPath)) {
      if (size > CANDIDATE_CONTENT_LIMITS.tarArchiveBytes) {
        throw policyError(`${archiveLabel} nested archive exceeds size limit`)
      }
      nestedArchives.push({
        buffer: content,
        label: `${archiveLabel}!/${memberPath}`,
      })
    }
  }

  if (!sawEnd || offset > archive.length) {
    throw policyError(`${archiveLabel} has no complete tar end marker`)
  }
  if (pendingLongPath !== null || pendingPax !== null) {
    throw policyError(`${archiveLabel} ends with unapplied path metadata`)
  }
  if (manifests.length !== 1) {
    throw policyError(
      `${archiveLabel} must contain exactly one package/package.json`
    )
  }
  const packageIdentity = assertNpmPackageManifest(manifests[0], archiveLabel)
  const packages = [{ archive: archiveLabel, ...packageIdentity }]
  for (const nested of nestedArchives) {
    packages.push(
      ...scanTarArchive(nested.buffer, nested.label, depth + 1).packages
    )
  }

  return { entries: entryCount, packages, uncompressedBytes: totalBytes }
}

function assertContainedSymlink(root, absolute, relative) {
  const target = fs.readlinkSync(absolute)
  scanTextValue(target, `symlink target ${relative}`)
  if (path.isAbsolute(target) || WINDOWS_ABSOLUTE_PATH.test(target)) {
    throw policyError(`symlink target must be relative: ${relative} -> ${target}`)
  }
  const resolved = path.resolve(path.dirname(absolute), target)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw policyError(`symlink escapes candidate root: ${relative} -> ${target}`)
  }
  if (!fs.existsSync(resolved)) {
    throw policyError(`symlink target does not exist: ${relative} -> ${target}`)
  }
}

function assertExpectedPreinstallPackages(packages) {
  const actual = packages
    .map(({ archive, name, version }) => ({
      file: path.basename(String(archive).split('!/')[0]),
      name,
      version,
    }))
    .sort((left, right) =>
      `${left.file}\0${left.name}\0${left.version}`.localeCompare(
        `${right.file}\0${right.name}\0${right.version}`
      )
    )
  const expected = EXPECTED_PREINSTALL_PACKAGE_IDENTITIES.map((entry) => ({
    file: entry.file,
    name: entry.name,
    version: entry.version,
  })).sort((left, right) =>
    `${left.file}\0${left.name}\0${left.version}`.localeCompare(
      `${right.file}\0${right.name}\0${right.version}`
    )
  )
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw policyError(
      `bundled package inventory must be exactly ${JSON.stringify(expected)}, found ${JSON.stringify(actual)}`
    )
  }
}

export function scanCandidateArchive(archivePath) {
  const resolved = path.resolve(archivePath)
  const stat = fs.lstatSync(resolved)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw policyError(`candidate archive is not a regular file: ${resolved}`)
  }
  return scanTarArchive(resolved, resolved, 1)
}

export function scanCandidateTree(rootDirectory) {
  const root = path.resolve(rootDirectory)
  const rootStat = fs.lstatSync(root, { throwIfNoEntry: false })
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) {
    throw policyError(`candidate root is not a regular directory: ${root}`)
  }

  let entries = 0
  let bytes = 0
  let archives = 0
  const packages = []
  const visit = (directory) => {
    const children = fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))
    for (const child of children) {
      entries += 1
      if (entries > CANDIDATE_CONTENT_LIMITS.directoryEntries) {
        throw policyError('candidate tree exceeds directory entry limit')
      }
      const absolute = path.join(directory, child.name)
      const relative = path.relative(root, absolute).split(path.sep).join('/')
      scanTextValue(relative, `candidate path ${relative}`)
      const stat = fs.lstatSync(absolute)
      if (stat.isDirectory()) {
        visit(absolute)
        continue
      }
      if (stat.isSymbolicLink()) {
        assertContainedSymlink(root, absolute, relative)
        continue
      }
      if (!stat.isFile()) {
        throw policyError(`unsupported filesystem entry: ${relative}`)
      }
      if (stat.size > CANDIDATE_CONTENT_LIMITS.fileBytes) {
        throw policyError(`candidate file exceeds size limit: ${relative}`)
      }
      bytes += stat.size
      if (bytes > CANDIDATE_CONTENT_LIMITS.directoryBytes) {
        throw policyError('candidate tree exceeds total byte limit')
      }
      if (TAR_SUFFIX.test(relative)) {
        packages.push(...scanTarArchive(absolute, relative, 1).packages)
        archives += 1
        continue
      }

      const scanner = createFingerprintScanner(`candidate file ${relative}`)
      const descriptor = fs.openSync(absolute, 'r')
      const buffer = Buffer.allocUnsafe(1024 * 1024)
      try {
        for (;;) {
          const bytesRead = fs.readSync(
            descriptor,
            buffer,
            0,
            buffer.length,
            null
          )
          if (bytesRead === 0) break
          scanner.write(buffer.subarray(0, bytesRead))
        }
      } finally {
        fs.closeSync(descriptor)
      }
    }
  }
  visit(root)
  assertExpectedPreinstallPackages(packages)
  return { archives, bytes, entries, root }
}

function parseArgs(argv) {
  if (argv.length !== 2 || argv[0] !== '--root' || !argv[1]) {
    throw new Error(
      'Usage: node scripts/ci/candidate-content-policy.mjs --root <extracted-candidate-directory>'
    )
  }
  return argv[1]
}

function main() {
  const result = scanCandidateTree(parseArgs(process.argv.slice(2)))
  console.log(
    `Candidate content policy verified ${result.entries} entries and ${result.archives} nested package archive(s) under ${result.root}`
  )
}

if (
  process.argv[1] &&
  fs.realpathSync(path.resolve(process.argv[1])) ===
    fs.realpathSync(fileURLToPath(import.meta.url))
) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
