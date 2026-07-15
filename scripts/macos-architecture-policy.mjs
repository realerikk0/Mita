import { closeSync, openSync, readSync } from 'node:fs'
import { basename } from 'node:path'

const UNIVERSAL = ['arm64', 'x86_64']
const ARM64 = ['arm64']
const X86_64 = ['x86_64']
const MACH_O_MAGICS = new Set([
  0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca, 0xfeedface, 0xcefaedfe,
  0xfeedfacf, 0xcffaedfe,
])

function normalizePath(filePath) {
  return `/${filePath.replaceAll('\\', '/').replace(/^\/+/, '')}`
}

function normalizeArchitectures(architectures) {
  return [...new Set(architectures)].sort()
}

export function isMachOFile(filePath) {
  const descriptor = openSync(filePath, 'r')
  const header = Buffer.allocUnsafe(4)
  try {
    return readSync(descriptor, header, 0, header.length, 0) === header.length
      ? MACH_O_MAGICS.has(header.readUInt32BE(0))
      : false
  } finally {
    closeSync(descriptor)
  }
}

export function expectedMacOSArchitectures(filePath) {
  const normalized = normalizePath(filePath)
  const name = basename(normalized)

  if (
    normalized.includes('/chrome-headless-shell-mac-arm64/') ||
    /\/(?:bun|uv)-aarch64-apple-darwin$/.test(normalized)
  ) {
    return ARM64
  }

  if (
    normalized.includes('/chrome-headless-shell-mac-x64/') ||
    /\/(?:bun|uv)-x86_64-apple-darwin$/.test(normalized)
  ) {
    return X86_64
  }

  if (
    (normalized.includes('/ms-playwright/') && name === 'ffmpeg-mac') ||
    /\/(?:bun|uv)(?:-universal-apple-darwin)?$/.test(normalized) ||
    name === 'biyan-cli' ||
    name === 'biyan-computer-agent-runner'
  ) {
    return UNIVERSAL
  }

  // This policy is only evaluated after the signer has identified a Mach-O.
  // Unknown native code must therefore be universal unless it matches one of
  // the explicit architecture-specific runtime directories above.
  return UNIVERSAL
}

export function assertMacOSArchitectures(filePath, architectures) {
  const expected = expectedMacOSArchitectures(filePath)
  const actual = normalizeArchitectures(architectures)
  const wanted = normalizeArchitectures(expected)
  if (actual.join(' ') !== wanted.join(' ')) {
    throw new Error(
      `${filePath} has architectures [${actual.join(', ')}], expected [${wanted.join(', ')}]`
    )
  }
}
