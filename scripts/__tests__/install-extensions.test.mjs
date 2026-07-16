import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  buildYarnEnvironment,
  buildYarnInvocation,
  installExtensions,
  validateCoreLockTransition,
} from '../install-extensions.mjs'

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
)
const reviewedLock = fs.readFileSync(
  path.join(repoRoot, 'extensions', 'yarn.lock'),
  'utf8'
)
const reviewedHash = reviewedLock.match(
  /core\/package\.tgz::hash=([0-9a-f]{6})/
)[1]
const reviewedChecksum = reviewedLock.match(
  /"@biyan\/core@file:[\s\S]*?^  checksum: (\S+)$/m
)[1]

function replaceExactly(source, from, to, count) {
  const occurrences = source.split(from).length - 1
  assert.equal(occurrences, count)
  return source.replaceAll(from, to)
}

function lockForHash(hash, checksum = reviewedChecksum) {
  return replaceExactly(
    replaceExactly(
      reviewedLock,
      `::hash=${reviewedHash}&`,
      `::hash=${hash}&`,
      3
    ),
    `  checksum: ${reviewedChecksum}`,
    `  checksum: ${checksum}`,
    3
  )
}

test('accepts only the three derived core archive records', () => {
  const updated = lockForHash('5022ff')
  assert.deepEqual(
    validateCoreLockTransition(reviewedLock, updated, '5022ff'),
    { archiveHash: '5022ff', checksumChanges: 0, hashChanges: 3 }
  )
})

test('accepts a derived core checksum change for all three records', () => {
  const checksum = `10c0/${'a'.repeat(128)}`
  const updated = lockForHash('802fac', checksum)
  assert.deepEqual(
    validateCoreLockTransition(reviewedLock, updated, '802fac'),
    { archiveHash: '802fac', checksumChanges: 3, hashChanges: 3 }
  )
})

test('rejects third-party, workspace, partial, and archive-mismatch changes', () => {
  assert.throws(
    () =>
      validateCoreLockTransition(
        reviewedLock,
        `${lockForHash('5022ff')}# unexpected\n`,
        '5022ff'
      ),
    /outside the three reviewed/
  )
  assert.throws(
    () =>
      validateCoreLockTransition(
        reviewedLock,
        lockForHash('5022ff').replace(
          '"@biyan/core": ../../core/package.tgz',
          '"@biyan/core": portal:../../core'
        ),
        '5022ff'
      ),
    /outside the three reviewed/
  )
  assert.throws(
    () =>
      validateCoreLockTransition(
        reviewedLock,
        reviewedLock.replace(
          `::hash=${reviewedHash}&`,
          '::hash=5022ff&'
        ),
        '5022ff'
      ),
    /one archive hash|zero or all three/
  )
  assert.throws(
    () =>
      validateCoreLockTransition(
        reviewedLock,
        lockForHash('5022ff'),
        '802fac'
      ),
    /does not match/
  )
})

test('uses repository Yarn through cross-spawn and rejects unsafe command input', () => {
  assert.deepEqual(
    buildYarnInvocation('linux', ['install', '--immutable'], {
      npm_execpath: '/tmp/corepack/yarn',
    }),
    {
      command: '/tmp/corepack/yarn',
      args: ['install', '--immutable'],
    }
  )
  assert.deepEqual(
    buildYarnInvocation('win32', ['install', '--mode=update-lockfile'], {
      npm_execpath: 'C:\\Program Files (x86)\\corepack cache\\yarn.cmd',
    }),
    {
      command: 'C:\\Program Files (x86)\\corepack cache\\yarn.cmd',
      args: ['install', '--mode=update-lockfile'],
    }
  )
  assert.throws(
    () => buildYarnInvocation('linux', ['install'], {}),
    /through the repository Yarn/
  )
  for (const metacharacter of ['%EVIL%', '!', '^', '<', '>', '&', '|']) {
    assert.throws(
      () =>
        buildYarnInvocation('win32', ['install'], {
          npm_execpath: `C:\\corepack${metacharacter}cache\\yarn.cmd`,
        }),
      /Windows command metacharacters/
    )
  }
  for (const unsafe of ['install&whoami', 'install|whoami', 'install^whoami']) {
    assert.throws(
      () => buildYarnInvocation('win32', [unsafe], { npm_execpath: 'yarn.cmd' }),
      /unsafe Yarn argument/
    )
  }
})

test('preserves hardened mode while scoping immutable mode', () => {
  assert.deepEqual(
    buildYarnEnvironment(
      {
        KEEP: 'yes',
        YARN_ENABLE_HARDENED_MODE: 'true',
        YARN_ENABLE_IMMUTABLE_INSTALLS: 'stale',
      },
      false
    ),
    {
      KEEP: 'yes',
      YARN_ENABLE_HARDENED_MODE: 'true',
      YARN_ENABLE_IMMUTABLE_INSTALLS: 'false',
    }
  )
})

test('restores the committed lock when the immutable install fails', (t) => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'biyan-lock-wrapper-'))
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }))

  fs.mkdirSync(path.join(fixture, 'core'), { recursive: true })
  fs.mkdirSync(path.join(fixture, 'extensions'), { recursive: true })
  const archive = Buffer.from('platform-specific core archive')
  fs.writeFileSync(path.join(fixture, 'core', 'package.tgz'), archive)
  fs.writeFileSync(path.join(fixture, 'extensions', 'yarn.lock'), reviewedLock)
  for (const workspace of [
    'assistant-extension',
    'conversational-extension',
    'download-extension',
  ]) {
    const workspaceRoot = path.join(fixture, 'extensions', workspace)
    fs.mkdirSync(workspaceRoot, { recursive: true })
    fs.writeFileSync(
      path.join(workspaceRoot, 'package.json'),
      JSON.stringify({ dependencies: { '@biyan/core': '../../core/package.tgz' } })
    )
  }

  const archiveHash = crypto
    .createHash('sha512')
    .update(archive)
    .digest('hex')
    .slice(0, 6)
  const calls = []

  assert.throws(
    () =>
      installExtensions({
        repoRoot: fixture,
        handleSignals: false,
        execute(args, options) {
          calls.push({ args, options })
          if (args.includes('--mode=update-lockfile')) {
            fs.writeFileSync(
              path.join(fixture, 'extensions', 'yarn.lock'),
              lockForHash(archiveHash)
            )
          } else {
            throw new Error('synthetic immutable failure')
          }
        },
      }),
    /synthetic immutable failure/
  )
  assert.equal(
    fs.readFileSync(path.join(fixture, 'extensions', 'yarn.lock'), 'utf8'),
    reviewedLock
  )
  assert.deepEqual(
    calls.map(({ args }) => args),
    [
      ['install', '--mode=update-lockfile'],
      ['install', '--immutable'],
    ]
  )
  assert.equal(calls[0].options.immutable, false)
  assert.equal(calls[1].options.immutable, true)
})
