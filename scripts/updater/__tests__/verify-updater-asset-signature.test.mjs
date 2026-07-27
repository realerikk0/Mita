import assert from 'node:assert/strict'
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign as signCryptoMessage,
} from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { buildCandidate } from '../build-candidate.mjs'
import { verifyCandidate } from '../verify-candidate.mjs'

const cli = fileURLToPath(
  new URL('../verify-updater-asset-signature.mjs', import.meta.url)
)
const candidateCli = fileURLToPath(
  new URL('../verify-candidate.mjs', import.meta.url)
)
const version = '0.6.637'
const sourceCommit = '0123456789abcdef0123456789abcdef01234567'

function signingFixture() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const publicDer = publicKey.export({ format: 'der', type: 'spki' })
  const keyId = randomBytes(8)
  const publicPayload = Buffer.concat([
    Buffer.from('Ed', 'ascii'),
    keyId,
    publicDer.subarray(publicDer.length - 32),
  ])
  const publicText = [
    'untrusted comment: minisign public key: updater test key',
    publicPayload.toString('base64'),
    '',
  ].join('\n')

  return {
    pubkey: Buffer.from(publicText, 'utf8').toString('base64'),
    sign(file, name) {
      const prehash = createHash('blake2b512')
        .update(fs.readFileSync(file))
        .digest()
      const signature = signCryptoMessage(null, prehash, privateKey)
      const trustedComment = `timestamp:1770000000\tfile:${name}\tprehashed`
      const globalSignature = signCryptoMessage(
        null,
        Buffer.concat([signature, Buffer.from(trustedComment, 'utf8')]),
        privateKey
      )
      const signaturePayload = Buffer.concat([
        Buffer.from('ED', 'ascii'),
        keyId,
        signature,
      ])
      const signatureText = [
        'untrusted comment: signature from minisign secret key',
        signaturePayload.toString('base64'),
        `trusted comment: ${trustedComment}`,
        globalSignature.toString('base64'),
        '',
      ].join('\n')
      return Buffer.from(signatureText, 'utf8').toString('base64')
    },
  }
}

function candidateFixture(
  t,
  {
    candidateVersion = version,
    migrationPhase = 'A',
    dataSchema = 1,
    invalidPlatform = null,
  } = {}
) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'biyan-updater-signature-')
  )
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const inputs = path.join(root, 'inputs')
  const output = path.join(root, 'candidate')
  const signing = signingFixture()
  fs.mkdirSync(inputs, { recursive: true })
  const assets = new Map([
    ['darwin-universal', 'Biyan.app.tar.gz'],
    ['windows-x86_64', `Biyan_${candidateVersion}_x64-setup.exe`],
    ['linux-x86_64', `Biyan_${candidateVersion}_amd64.AppImage`],
  ])
  for (const [name, contents] of [
    ['Biyan.app.tar.gz', 'mac-app'],
    [`Biyan_${candidateVersion}_universal.dmg`, 'mac-dmg'],
    [`Biyan_${candidateVersion}_x64-setup.exe`, 'windows-installer'],
    [`Biyan_${candidateVersion}_x64_en-US.msi`, 'windows-msi'],
    [`Biyan_${candidateVersion}_amd64.AppImage`, 'linux-appimage'],
    [`Biyan_${candidateVersion}_amd64.deb`, 'linux-deb'],
  ]) {
    fs.writeFileSync(path.join(inputs, name), contents)
  }
  const wrongBytes = path.join(inputs, 'wrong-updater-asset')
  fs.writeFileSync(wrongBytes, 'different updater bytes')
  for (const [platform, name] of assets) {
    const asset = path.join(inputs, name)
    fs.writeFileSync(
      `${asset}.sig`,
      signing.sign(platform === invalidPlatform ? wrongBytes : asset, name)
    )
  }
  buildCandidate({
    version: candidateVersion,
    tag: `v${candidateVersion}`,
    artifactsDir: inputs,
    outputDir: output,
    assetBaseUrl: 'https://static.mitapp.cn',
    publishedAt: '2026-07-14T00:00:00Z',
    sourceCommit,
    migrationPhase,
    dataSchema,
  })
  const candidate = path.join(output, 'candidate.json')
  fs.writeFileSync(
    path.join(output, 'candidate.json.sig'),
    signing.sign(candidate, 'candidate.json')
  )
  return { output, pubkey: signing.pubkey }
}

function runCli(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
  })
}

test('updater verifier CLI entrypoints fail closed directly', () => {
  for (const [name, target, expected] of [
    ['asset-verifier', cli, /Missing required argument: --asset/],
    ['candidate-verifier', candidateCli, /Usage: verify-candidate\.mjs/],
  ]) {
    const result = spawnSync(process.execPath, [target], { encoding: 'utf8' })
    assert.equal(
      result.status,
      1,
      `${name}\n${result.stdout}\n${result.stderr}`
    )
    assert.match(result.stderr, expected)
  }
})

test(
  'updater verifier CLI entrypoints fail closed through symlinks',
  { skip: process.platform === 'win32' },
  (t) => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), 'biyan-updater-verifier-symlink-')
    )
    t.after(() => fs.rmSync(root, { recursive: true, force: true }))
    for (const [name, target, expected] of [
      ['asset-verifier', cli, /Missing required argument: --asset/],
      ['candidate-verifier', candidateCli, /Usage: verify-candidate\.mjs/],
    ]) {
      const link = path.join(root, name)
      fs.symlinkSync(target, link)
      const result = spawnSync(process.execPath, [link], { encoding: 'utf8' })
      assert.equal(
        result.status,
        1,
        `${name}\n${result.stdout}\n${result.stderr}`
      )
      assert.match(result.stderr, expected)
    }
  }
)

test('updater asset signature CLI verifies exact bytes and fails closed', (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'biyan-updater-signature-cli-')
  )
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const signing = signingFixture()
  const asset = path.join(root, 'Biyan.fixture')
  const signature = `${asset}.sig`
  fs.writeFileSync(asset, 'trusted updater bytes')
  fs.writeFileSync(signature, signing.sign(asset, path.basename(asset)))

  const valid = runCli([
    '--asset',
    asset,
    '--signature',
    signature,
    '--public-key',
    signing.pubkey,
    '--label',
    'fixture-platform Biyan.fixture',
  ])
  assert.equal(valid.status, 0, valid.stderr)
  assert.match(
    valid.stdout,
    /Verified updater asset signature: fixture-platform Biyan\.fixture/
  )

  fs.writeFileSync(asset, 'tampered updater bytes')
  const tampered = runCli([
    '--asset',
    asset,
    '--signature',
    signature,
    '--public-key',
    signing.pubkey,
  ])
  assert.equal(tampered.status, 1)
  assert.match(
    tampered.stderr,
    /Biyan\.fixture updater signature does not verify/
  )

  const duplicate = runCli([
    '--asset',
    asset,
    '--asset',
    asset,
    '--signature',
    signature,
    '--public-key',
    signing.pubkey,
  ])
  assert.equal(duplicate.status, 1)
  assert.match(duplicate.stderr, /Duplicate argument: --asset/)
})

test('candidate verifier cryptographically checks every updater platform', async (t) => {
  const valid = candidateFixture(t)
  assert.equal(
    verifyCandidate({
      directory: valid.output,
      expectedTag: `v${version}`,
      encodedPublicKey: valid.pubkey,
    }).tag,
    `v${version}`
  )

  for (const [platform, expected] of [
    [
      'darwin-universal',
      /darwin-universal Biyan\.app\.tar\.gz updater signature does not verify/,
    ],
    [
      'windows-x86_64',
      /windows-x86_64 Biyan_0\.6\.637_x64-setup\.exe updater signature does not verify/,
    ],
    [
      'linux-x86_64',
      /linux-x86_64 Biyan_0\.6\.637_amd64\.AppImage updater signature does not verify/,
    ],
  ]) {
    await t.test(platform, (subtest) => {
      const invalid = candidateFixture(subtest, { invalidPlatform: platform })
      assert.throws(
        () =>
          verifyCandidate({
            directory: invalid.output,
            expectedTag: `v${version}`,
            encodedPublicKey: invalid.pubkey,
          }),
        expected
      )
    })
  }
})

test('candidate verifier accepts the exact A/B/C migration train tuples', async (t) => {
  for (const [candidateVersion, migrationPhase, dataSchema] of [
    ['0.6.643', 'A', 1],
    ['0.6.644', 'B', 2],
    ['0.6.645', 'C', 3],
  ]) {
    await t.test(`${migrationPhase}/${candidateVersion}`, (subtest) => {
      const fixture = candidateFixture(subtest, {
        candidateVersion,
        migrationPhase,
        dataSchema,
      })
      const verified = verifyCandidate({
        directory: fixture.output,
        expectedTag: `v${candidateVersion}`,
        encodedPublicKey: fixture.pubkey,
      })
      assert.equal(verified.tag, `v${candidateVersion}`)
      assert.equal(verified.version, candidateVersion)
      assert.equal(verified.migrationPhase, migrationPhase)
      assert.equal(verified.dataSchema, dataSchema)
    })
  }
})
