import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const repoRoot = path.resolve(import.meta.dirname, '../..')
const canonicalPath = path.join(repoRoot, 'src-tauri/app-icon.png')
const generatedPath = path.join(repoRoot, 'src-tauri/icons/icon.png')
const expectedCanonicalSha256 =
  'ffc0e22c3a708d66f6c6dc6921c5bd92881f6efe115fb0b06e06aa92c855a94c'
const expectedGeneratedSha256 =
  '480eff84ef26276d6f9d96fe9fdb94df399dc626e8546f412e946292af87fb7a'

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function trackedIconDiff() {
  return childProcess.execFileSync(
    'git',
    [
      '-C',
      repoRoot,
      'diff',
      '--raw',
      'HEAD',
      '--',
      'src-tauri/app-icon.png',
      'src-tauri/icons/icon.png',
    ],
    { encoding: 'utf8' }
  )
}

function buildIcon() {
  const command = process.platform === 'win32' ? 'corepack.cmd' : 'corepack'
  childProcess.execFileSync(command, ['yarn', 'build:icon'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 120_000,
  })
}

test(
  'build:icon is idempotent and never rewrites its canonical source',
  { timeout: 300_000 },
  () => {
    const canonicalBefore = fs.readFileSync(canonicalPath)
    const generatedBefore = fs.readFileSync(generatedPath)
    const diffBefore = trackedIconDiff()
    try {
      assert.equal(sha256(canonicalBefore), expectedCanonicalSha256)
      assert.equal(sha256(generatedBefore), expectedGeneratedSha256)

      buildIcon()
      const diffAfterFirst = trackedIconDiff()
      assert.equal(
        sha256(fs.readFileSync(canonicalPath)),
        expectedCanonicalSha256
      )
      assert.equal(
        sha256(fs.readFileSync(generatedPath)),
        expectedGeneratedSha256
      )
      assert.equal(diffAfterFirst, diffBefore)

      buildIcon()
      assert.equal(
        sha256(fs.readFileSync(canonicalPath)),
        expectedCanonicalSha256
      )
      assert.equal(
        sha256(fs.readFileSync(generatedPath)),
        expectedGeneratedSha256
      )
      assert.equal(trackedIconDiff(), diffAfterFirst)
    } finally {
      if (!fs.readFileSync(canonicalPath).equals(canonicalBefore)) {
        fs.writeFileSync(canonicalPath, canonicalBefore)
      }
      if (!fs.readFileSync(generatedPath).equals(generatedBefore)) {
        fs.writeFileSync(generatedPath, generatedBefore)
      }
    }
  }
)
