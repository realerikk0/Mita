import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const HELPER = path.resolve(
  'scripts/ci/run-untrusted-qualification-verifier.sh'
)

function mode(file) {
  return fs.statSync(file).mode & 0o777
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function writeExecutable(file, contents) {
  fs.writeFileSync(file, contents)
  fs.chmodSync(file, 0o755)
}

function fixture() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'biyan-untrusted-verifier-test-')
  )
  const bin = path.join(root, 'bin')
  const sudoLog = path.join(root, 'sudo.log')
  const getfaclLog = path.join(root, 'getfacl.log')
  const setfaclLog = path.join(root, 'setfacl.log')
  fs.mkdirSync(bin)
  writeExecutable(
    path.join(bin, 'sudo'),
    `#!/usr/bin/env bash
set -euo pipefail
printf '%q ' "$@" >> "$FAKE_SUDO_LOG"
printf '\\n' >> "$FAKE_SUDO_LOG"
if [[ "\${1:-}" == "chown" ]]; then
  exit 0
fi
if [[ "\${1:-}" == "rm" ]]; then
  exec /bin/rm "\${@:2}"
fi
if [[ "\${1:-}" == "setfacl" ]]; then
  exec "$@"
fi
if [[ "\${1:-}" == "chmod" ]]; then
  exec "$@"
fi
if [[ "\${1:-}" == "-u" && "\${2:-}" == "nobody" ]]; then
  shift 2
  exec "$@"
fi
echo "unexpected fake sudo invocation: $*" >&2
exit 97
`
  )
  writeExecutable(
    path.join(bin, 'getfacl'),
    `#!/usr/bin/env bash
set -euo pipefail
printf '%q ' "$@" >> "$FAKE_GETFACL_LOG"
printf '\\n' >> "$FAKE_GETFACL_LOG"
for target in "\${@:2}"; do
  printf '# file: %s\\n# owner: runner\\n# group: runner\\nuser::rwx\\ngroup::r-x\\nother::r-x\\n\\n' "$target"
done
`
  )
  writeExecutable(
    path.join(bin, 'setfacl'),
    `#!/usr/bin/env bash
set -euo pipefail
printf '%q ' "$@" >> "$FAKE_SETFACL_LOG"
printf '\\n' >> "$FAKE_SETFACL_LOG"
`
  )
  return {
    root,
    bin,
    sudoLog,
    getfaclLog,
    setfaclLog,
    env: {
      ...process.env,
      FAKE_SUDO_LOG: sudoLog,
      FAKE_GETFACL_LOG: getfaclLog,
      FAKE_SETFACL_LOG: setfaclLog,
      PATH: `${bin}:${process.env.PATH}`,
      SHOULD_NOT_REACH_VERIFIER: 'secret',
    },
  }
}

function run(helperFixture, verifier, args = [], readRoot = null) {
  const helperArgs = readRoot
    ? [HELPER, '--read-root', readRoot, verifier, ...args]
    : [HELPER, verifier, ...args]
  return childProcess.spawnSync('bash', helperArgs, {
    cwd: path.resolve('.'),
    encoding: 'utf8',
    env: helperFixture.env,
  })
}

test('declares the fail-closed copy and unprivileged execution contract', () => {
  const source = fs.readFileSync(HELPER, 'utf8')
  assert.match(source, /\[\[ -L "\$source_input" \]\]/)
  assert.match(source, /\[\[ ! -f "\$source_input" \]\]/)
  assert.match(source, /copied_sha256.*source_sha256/s)
  assert.match(source, /chmod 0444 "\$sandbox_verifier"/)
  assert.match(source, /chmod 0555 "\$sandbox_exec" "\$sandbox_root"/)
  assert.match(source, /sudo chown nobody "\$sandbox_home"/)
  assert.match(source, /sudo -u nobody test -r "\$sandbox_verifier"/)
  assert.match(
    source,
    /getfacl --absolute-names --recursive "\$read_root" >"\$acl_backup"\n  getfacl --absolute-names "\$\{ancestor_paths\[@\]\}" >>"\$acl_backup"/
  )
  assert.match(source, /sudo setfacl -m u:nobody:--x "\$ancestor"/)
  assert.match(
    source,
    /sudo setfacl --recursive -m u:nobody:rX "\$read_root"/
  )
  assert.match(source, /sudo setfacl --restore="\$acl_backup"/)
  assert.match(source, /find "\$read_root" -user nobody -print -quit/)
  assert.doesNotMatch(source, /chmod -R [^\n]*"\$read_root"/)
  assert.match(
    source,
    /sudo -u nobody env -i PATH="\$PATH" HOME="\$sandbox_home" \\\n  node "\$sandbox_verifier" "\$@"/
  )
  assert.match(source, /trap cleanup EXIT/)
  assert.doesNotMatch(source, /chmod\b[^\n]*(?:target|source_verifier)/)
})

test('runs only the copied read-only verifier with scrubbed environment', () => {
  const helperFixture = fixture()
  const verifier = path.join(helperFixture.root, 'target-verifier.mjs')
  const output = path.join(helperFixture.root, 'result.json')
  fs.writeFileSync(
    verifier,
    `#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const [output, original, ...forwarded] = process.argv.slice(2)
const copied = process.argv[1]
const homeProbe = path.join(process.env.HOME, 'probe')
fs.writeFileSync(homeProbe, 'writable only inside isolated HOME')
const digest = (file) =>
  crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
fs.writeFileSync(
  output,
  JSON.stringify({
    copied,
    original,
    forwarded,
    copiedSha256: digest(copied),
    originalSha256: digest(original),
    copiedMode: (${mode.toString()})(copied),
    execMode: (${mode.toString()})(path.dirname(copied)),
    rootMode: (${mode.toString()})(path.dirname(path.dirname(copied))),
    home: process.env.HOME,
    homeMode: (${mode.toString()})(process.env.HOME),
    homeProbeExists: fs.existsSync(homeProbe),
    leaked: process.env.SHOULD_NOT_REACH_VERIFIER ?? null,
    environmentKeys: Object.keys(process.env).sort(),
  })
)
`
  )

  const result = run(helperFixture, verifier, [
    output,
    verifier,
    'alpha',
    'two words',
  ])
  assert.equal(result.status, 0, result.stderr)

  const evidence = JSON.parse(fs.readFileSync(output, 'utf8'))
  assert.notEqual(evidence.copied, verifier)
  assert.equal(evidence.original, verifier)
  assert.deepEqual(evidence.forwarded, ['alpha', 'two words'])
  assert.equal(evidence.copiedSha256, sha256(verifier))
  assert.equal(evidence.originalSha256, sha256(verifier))
  assert.equal(evidence.copiedMode, 0o444)
  assert.equal(evidence.execMode, 0o555)
  assert.equal(evidence.rootMode, 0o555)
  assert.equal(evidence.homeMode, 0o700)
  assert.equal(evidence.homeProbeExists, true)
  assert.equal(evidence.leaked, null)
  assert.deepEqual(
    evidence.environmentKeys.filter((key) => key !== '__CF_USER_TEXT_ENCODING'),
    ['HOME', 'PATH']
  )
  assert.equal(fs.existsSync(evidence.copied), false)
  assert.equal(fs.existsSync(evidence.home), false)

  const sudoLog = fs.readFileSync(helperFixture.sudoLog, 'utf8')
  assert.match(sudoLog, /^chown nobody /m)
  assert.match(sudoLog, /^-u nobody test -r /m)
  assert.match(sudoLog, /^-u nobody env -i PATH=/m)
  assert.match(sudoLog, /^rm -rf /m)
})

test('makes a read root visible without opening workspace ancestors globally', () => {
  const helperFixture = fixture()
  const verifier = path.join(helperFixture.root, 'target-verifier.mjs')
  const output = path.join(helperFixture.root, 'read-root-result.json')
  const workspace = path.join(helperFixture.root, 'workspace', 'checkout')
  const readRoot = path.join(workspace, 'qualification-output')
  const artifact = path.join(readRoot, 'linux', 'Biyan.AppImage')
  fs.mkdirSync(path.dirname(artifact), { recursive: true })
  fs.writeFileSync(artifact, 'candidate')
  fs.chmodSync(readRoot, 0o710)
  fs.chmodSync(artifact, 0o640)
  const originalRootMode = mode(readRoot)
  const originalArtifactMode = mode(artifact)
  fs.writeFileSync(
    verifier,
    `#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const [output, readRoot, artifact] = process.argv.slice(2)
fs.writeFileSync(
  output,
  JSON.stringify({
    rootMode: fs.statSync(readRoot).mode & 0o777,
    artifactMode: fs.statSync(artifact).mode & 0o777,
    artifact: fs.readFileSync(artifact, 'utf8'),
    canTraverse: fs.accessSync(readRoot, fs.constants.R_OK | fs.constants.X_OK) ??
      true,
    copiedRoot: path.dirname(path.dirname(process.argv[1])),
  })
)
`
  )

  const result = run(
    helperFixture,
    verifier,
    [output, readRoot, artifact],
    readRoot
  )
  assert.equal(result.status, 0, result.stderr)

  const evidence = JSON.parse(fs.readFileSync(output, 'utf8'))
  assert.equal(evidence.artifact, 'candidate')
  assert.equal(evidence.canTraverse, true)
  assert.match(evidence.copiedRoot, /^\/(?:private\/)?tmp\//)
  assert.equal(mode(readRoot), originalRootMode)
  assert.equal(mode(artifact), originalArtifactMode)

  const parent = fs.realpathSync(path.dirname(readRoot))
  const getfaclLog = fs.readFileSync(helperFixture.getfaclLog, 'utf8')
  assert.match(getfaclLog, /--absolute-names/)
  assert.match(getfaclLog, /--recursive/)
  assert.match(getfaclLog, new RegExp(parent.replaceAll('/', '\\/')))

  const setfaclLog = fs.readFileSync(helperFixture.setfaclLog, 'utf8')
  assert.match(setfaclLog, /-m u:nobody:--x/)
  assert.match(setfaclLog, /--recursive -m u:nobody:rX/)
  assert.match(setfaclLog, /--restore=/)

  const sudoLog = fs.readFileSync(helperFixture.sudoLog, 'utf8')
  assert.match(sudoLog, /^-u nobody test -r .*qualification-output/m)
  assert.match(sudoLog, /^-u nobody test -x .*qualification-output/m)
})

test('rejects a symbolic-link verifier before invoking sudo', () => {
  const helperFixture = fixture()
  const verifier = path.join(helperFixture.root, 'verifier.mjs')
  const link = path.join(helperFixture.root, 'verifier-link.mjs')
  fs.writeFileSync(verifier, 'process.exit(0)\n')
  fs.symlinkSync(verifier, link)

  const result = run(helperFixture, link)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /must not be a symbolic link/)
  assert.equal(fs.existsSync(helperFixture.sudoLog), false)
})

test('detects a copied verifier hash mismatch and cleans the sandbox', () => {
  const helperFixture = fixture()
  const verifier = path.join(helperFixture.root, 'verifier.mjs')
  fs.writeFileSync(verifier, 'process.exit(0)\n')
  writeExecutable(
    path.join(helperFixture.bin, 'cp'),
    `#!/usr/bin/env bash
set -euo pipefail
/bin/cp "$@"
printf '\\n// changed copy\\n' >> "\${@: -1}"
`
  )

  const result = run(helperFixture, verifier)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Copied qualification verifier SHA-256 mismatch/)

  const sudoLog = fs.readFileSync(helperFixture.sudoLog, 'utf8')
  assert.doesNotMatch(sudoLog, /^-u nobody /m)
  assert.match(sudoLog, /^rm -rf /m)
  const sandboxPath = sudoLog
    .split('\n')
    .find((line) => line.startsWith('rm -rf '))
    ?.slice('rm -rf '.length)
    .trim()
  assert.ok(sandboxPath)
  assert.equal(fs.existsSync(sandboxPath), false)
})
