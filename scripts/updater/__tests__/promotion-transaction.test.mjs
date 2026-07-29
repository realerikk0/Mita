import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  OPEN_TRANSACTION_KEY,
  advanceJournal,
  backupMetadataPlan,
  classifyPolicyRollback,
  classifyRemoteProbe,
  createJournal,
  extractR2Etag,
  pollPublicBytes,
  recoveryCommands,
  terminalPromotionRecoveryPlan,
  validateApprovedATransition,
  validateHealthEvidenceUrl,
  validateJournal,
  verifySnapshotReadback,
} from '../promotion-transaction.mjs'

const sha = (character) => character.repeat(64)
const sourceCommit = 'a'.repeat(40)
const repoRoot = path.resolve(import.meta.dirname, '../../..')

function readText(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n')
}

function pathForBash(nativePath) {
  if (process.platform !== 'win32') return nativePath
  const converted = spawnSync(
    'bash',
    ['-c', 'cygpath -u "$1"', 'bash', nativePath],
    { encoding: 'utf8' }
  )
  assert.equal(
    converted.status,
    0,
    `could not convert Windows path for Git Bash: ${converted.stderr}`
  )
  const result = converted.stdout.trim()
  assert.ok(result.startsWith('/') && !result.includes('\\'))
  return result
}

function spawnBashWithPathPrefix(pathPrefix, args, options) {
  return spawnSync(
    'bash',
    [
      '-c',
      'export PATH="$1:$PATH"; shift; exec bash "$@"',
      'bash',
      pathForBash(pathPrefix),
      ...args,
    ],
    options
  )
}

function shellFunction(source, name) {
  const start = source.indexOf(`${name}() {`)
  const end = source.indexOf('\n}\n', start)
  assert.ok(start >= 0 && end > start, `missing shell function ${name}`)
  return source.slice(start, end + 3)
}

function snapshot(provider, key, existed = true) {
  return existed
    ? {
        provider,
        key,
        existed: true,
        bytesSha256: sha(provider === 'r2' ? 'a' : 'b'),
        metadata: {
          cacheControl: 'no-store',
          contentType: 'application/json',
          custom: {},
        },
        acl: provider === 'oss' ? { acl: 'default' } : null,
        backupKey: `biyan/updater/transactions/123-1/backups/${provider}.json`,
      }
    : {
        provider,
        key,
        existed: false,
        bytesSha256: null,
        metadata: null,
        acl: null,
        backupKey: null,
      }
}

function journal() {
  return createJournal({
    runId: '123',
    runAttempt: '1',
    targetTag: 'v0.6.643',
    targetVersion: '0.6.643',
    sourceCommit,
    nextPolicyBytes: Buffer.from('{"currentVersion":"0.6.643"}\n'),
    createdAt: '2026-07-24T00:00:00.000Z',
    snapshots: [
      snapshot('r2', 'biyan/updater/stable/policy.json'),
      snapshot('oss', 'mita/latest.json'),
      snapshot('r2', 'mita/latest.json'),
    ],
  })
}

function terminalFixture(
  state = 'committed',
  { policyAbsent = false, unchangedTransition = false } = {}
) {
  const transactionId = '910-1'
  const targetVersion = '0.6.643'
  const beforeVersion = '0.6.642'
  const legacyVersion = policyAbsent ? beforeVersion : '0.6.641'
  const targetManifest = Buffer.from('{"version":"0.6.643"}\n')
  const legacyManifest = Buffer.from('{"version":"0.6.641"}\n')
  const targetManifestSha256 = createHash('sha256')
    .update(targetManifest)
    .digest('hex')
  const legacyManifestSha256 = createHash('sha256')
    .update(legacyManifest)
    .digest('hex')
  const smokeSha256 = sha('c')
  const healthSha256 = sha('d')
  let beforePolicy = {
    schema: 1,
    channel: 'stable',
    currentVersion: beforeVersion,
    paused: false,
    legacyBridgeVersion: legacyVersion,
    releases: {
      [legacyVersion]: {
        phase: 'A',
        effectivePhase: 'A',
        tag: `v${legacyVersion}`,
        manifestKey:
          `biyan/updater/releases/v${legacyVersion}/latest.json`,
        manifestSha256: legacyManifestSha256,
      },
      [beforeVersion]: {
        phase: 'A',
        effectivePhase: 'A',
        tag: `v${beforeVersion}`,
        manifestKey:
          `biyan/updater/releases/v${beforeVersion}/latest.json`,
        manifestSha256: sha('e'),
      },
    },
    transitions: {},
    completedPhases: ['A'],
  }
  let nextPolicy = structuredClone(beforePolicy)
  nextPolicy.currentVersion = targetVersion
  nextPolicy.releases[targetVersion] = {
    phase: 'B',
    effectivePhase: 'B',
    tag: `v${targetVersion}`,
    manifestKey:
      `biyan/updater/releases/v${targetVersion}/latest.json`,
    manifestSha256: targetManifestSha256,
    smokeEvidenceSha256: smokeSha256,
    healthEvidenceSha256: healthSha256,
  }
  nextPolicy.transitions[beforeVersion] = {
    to: targetVersion,
    phase: 'B',
    rollout: 5,
    manifestKey:
      `biyan/updater/releases/v${targetVersion}/latest.json`,
  }
  if (policyAbsent) {
    beforePolicy = null
    nextPolicy = {
      schema: 1,
      channel: 'stable',
      currentVersion: targetVersion,
      paused: false,
      legacyBridgeVersion: targetVersion,
      legacyPauseFallback: {
        version: beforeVersion,
        manifestSha256: legacyManifestSha256,
        transactionId: 'pause-900-1',
        backups: {
          oss: 'biyan/updater/legacy-pause/pause-900-1/legacy-oss.json',
          r2: 'biyan/updater/legacy-pause/pause-900-1/legacy-r2.json',
        },
      },
      releases: {
        [targetVersion]: {
          phase: 'A',
          effectivePhase: 'A',
          tag: `v${targetVersion}`,
          manifestKey:
            `biyan/updater/releases/v${targetVersion}/latest.json`,
          manifestSha256: targetManifestSha256,
          smokeEvidenceSha256: smokeSha256,
          healthEvidenceSha256: healthSha256,
        },
      },
      transitions: {},
      completedPhases: ['A'],
    }
  } else if (unchangedTransition) {
    beforePolicy.currentVersion = targetVersion
    beforePolicy.releases[targetVersion] =
      structuredClone(nextPolicy.releases[targetVersion])
    beforePolicy.transitions[beforeVersion] =
      structuredClone(nextPolicy.transitions[beforeVersion])
    nextPolicy = structuredClone(beforePolicy)
    nextPolicy.releases[targetVersion].lastPromotedAt =
      '2026-07-28T00:00:00.000Z'
  }
  const beforePolicyBytes = beforePolicy
    ? Buffer.from(`${JSON.stringify(beforePolicy, null, 2)}\n`)
    : null
  const nextPolicyBytes = Buffer.from(
    `${JSON.stringify(nextPolicy, null, 2)}\n`
  )
  const metadata = (cacheControl) => ({
    ContentType: 'application/json',
    CacheControl: cacheControl,
  })
  const backupPrefix =
    `biyan/updater/transactions/${transactionId}/backups`
  let terminalJournal = createJournal({
    runId: '910',
    runAttempt: '1',
    targetTag: `v${targetVersion}`,
    targetVersion,
    sourceCommit,
    nextPolicyBytes,
    createdAt: '2026-07-28T00:00:00.000Z',
    snapshots: [
      {
        provider: 'r2',
        key: 'biyan/updater/stable/policy.json',
        existed: !policyAbsent,
        bytesSha256: beforePolicyBytes
          ? createHash('sha256').update(beforePolicyBytes).digest('hex')
          : null,
        metadata: beforePolicyBytes ? metadata('no-store') : null,
        acl: null,
        backupKey: beforePolicyBytes
          ? `${backupPrefix}/policy.json`
          : null,
      },
      {
        provider: 'oss',
        key: 'mita/latest.json',
        existed: true,
        bytesSha256: legacyManifestSha256,
        metadata: metadata('public, max-age=60, must-revalidate'),
        acl: { acl: 'default' },
        backupKey: `${backupPrefix}/legacy-oss.json`,
      },
      {
        provider: 'r2',
        key: 'mita/latest.json',
        existed: true,
        bytesSha256: legacyManifestSha256,
        metadata: metadata('public, max-age=60, must-revalidate'),
        acl: null,
        backupKey: `${backupPrefix}/legacy-r2.json`,
      },
    ],
  })
  if (state === 'committed') {
    terminalJournal = advanceJournal(terminalJournal, {
      state: 'committing',
      checkpoint: 'before-policy-write',
      updatedAt: '2026-07-28T00:01:00.000Z',
    })
    terminalJournal = advanceJournal(terminalJournal, {
      state: 'committed',
      checkpoint: 'policy-and-origins-verified',
      updatedAt: '2026-07-28T00:02:00.000Z',
    })
  } else {
    terminalJournal = advanceJournal(terminalJournal, {
      state: 'rollback-required',
      checkpoint: 'rollback-started',
      updatedAt: '2026-07-28T00:01:00.000Z',
    })
    terminalJournal = advanceJournal(terminalJournal, {
      state: 'rolled-back',
      checkpoint: 'rollback-verified',
      updatedAt: '2026-07-28T00:02:00.000Z',
    })
  }
  return {
    beforeVersion,
    targetVersion,
    legacyVersion,
    beforePolicy,
    beforePolicyBytes,
    nextPolicy,
    nextPolicyBytes,
    targetManifest,
    legacyManifest,
    candidate: {
      tag: `v${targetVersion}`,
      version: targetVersion,
      sourceCommit,
      manifestKey:
        `biyan/updater/releases/v${targetVersion}/latest.json`,
      manifestSha256: targetManifestSha256,
    },
    smokeEvidence: { sha256: smokeSha256 },
    healthEvidence: { sha256: healthSha256 },
    request: {
      phase: policyAbsent ? 'A' : 'B',
      fromVersion: beforeVersion,
      expectedCurrent:
        unchangedTransition ? targetVersion : beforeVersion,
      rollout: policyAbsent ? '100' : '5',
    },
    journal: terminalJournal,
  }
}

function runTerminalRedispatch({
  state,
  liveDrift = false,
  dryRun = false,
  nonterminal = false,
  unknownOpenProbe = false,
  policyAbsent = false,
  unchangedTransition = false,
  differentDispatch = false,
}) {
  const fixture = terminalFixture(state, {
    policyAbsent,
    unchangedTransition,
  })
  if (nonterminal) {
    fixture.journal.state = 'committing'
    fixture.journal.recovery.required = true
  }
  const dispatchManifest = differentDispatch
    ? Buffer.from('{"version":"0.6.644"}\n')
    : fixture.targetManifest
  const dispatchCandidate = differentDispatch
    ? {
        tag: 'v0.6.644',
        version: '0.6.644',
        sourceCommit: 'f'.repeat(40),
        manifestKey:
          'biyan/updater/releases/v0.6.644/latest.json',
        manifestSha256: createHash('sha256')
          .update(dispatchManifest)
          .digest('hex'),
      }
    : fixture.candidate
  const dispatchSmokeEvidence = differentDispatch
    ? { sha256: sha('1') }
    : fixture.smokeEvidence
  const dispatchHealthEvidence = differentDispatch
    ? { sha256: sha('2') }
    : fixture.healthEvidence
  const dispatchRequest = differentDispatch
    ? {
        phase: 'C',
        fromVersion: fixture.targetVersion,
        expectedCurrent: fixture.targetVersion,
        rollout: '5',
      }
    : fixture.request
  const temp = fs.mkdtempSync(
    path.join(os.tmpdir(), 'biyan-terminal-redispatch-')
  )
  try {
    fs.mkdirSync(path.join(temp, 'scripts'))
    fs.cpSync(
      path.join(repoRoot, 'scripts/updater'),
      path.join(temp, 'scripts/updater'),
      { recursive: true }
    )
    fs.mkdirSync(path.join(temp, 'dist/candidate'), { recursive: true })
    fs.mkdirSync(path.join(temp, 'dist/state'), { recursive: true })
    fs.writeFileSync(
      path.join(temp, 'dist/candidate/candidate.json'),
      `${JSON.stringify(dispatchCandidate, null, 2)}\n`
    )
    fs.writeFileSync(
      path.join(temp, 'dist/candidate/latest.json'),
      dispatchManifest
    )
    fs.writeFileSync(
      path.join(temp, 'dist/state/verified-smoke.json'),
      `${JSON.stringify(dispatchSmokeEvidence)}\n`
    )
    fs.writeFileSync(
      path.join(temp, 'dist/state/verified-health.json'),
      `${JSON.stringify(dispatchHealthEvidence)}\n`
    )

    const store = path.join(temp, 'cloud')
    const metadata = (bytes, cacheControl) => ({
      ContentType: 'application/json',
      CacheControl: cacheControl,
      ETag: `"${createHash('sha256').update(bytes).digest('hex')}"`,
    })
    const put = (
      provider,
      key,
      bytes,
      cacheControl,
      acl = null
    ) => {
      const file = path.join(store, provider, ...key.split('/'))
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, bytes)
      fs.writeFileSync(
        `${file}.metadata.json`,
        `${JSON.stringify(metadata(bytes, cacheControl))}\n`
      )
      if (provider === 'oss') {
        fs.writeFileSync(
          `${file}.acl.json`,
          `${JSON.stringify(acl ?? { acl: 'default' })}\n`
        )
      }
    }
    const journalBytes = Buffer.from(
      `${JSON.stringify(fixture.journal, null, 2)}\n`
    )
    const sequence = String(fixture.journal.sequence).padStart(4, '0')
    const transactionPrefix =
      `biyan/updater/transactions/${fixture.journal.transactionId}`
    for (const provider of ['r2', 'oss']) {
      put(
        provider,
        `${transactionPrefix}/journal-${sequence}.json`,
        journalBytes,
        'no-store'
      )
      put(
        provider,
        fixture.journal.nextPolicy.key,
        fixture.nextPolicyBytes,
        'no-store'
      )
    }
    const survivor = state === 'committed' ? 'oss' : 'r2'
    put(
      survivor,
      OPEN_TRANSACTION_KEY,
      journalBytes,
      'no-store'
    )
    if (fixture.beforePolicyBytes) {
      put(
        'r2',
        `${transactionPrefix}/backups/policy.json`,
        fixture.beforePolicyBytes,
        'no-store'
      )
    }
    put(
      'oss',
      `${transactionPrefix}/backups/legacy-oss.json`,
      fixture.legacyManifest,
      'public, max-age=60, must-revalidate'
    )
    put(
      'r2',
      `${transactionPrefix}/backups/legacy-r2.json`,
      fixture.legacyManifest,
      'public, max-age=60, must-revalidate'
    )
    for (const provider of ['r2', 'oss']) {
      put(
        provider,
        fixture.candidate.manifestKey,
        fixture.targetManifest,
        'public, max-age=31536000, immutable'
      )
      put(
        provider,
        fixture.nextPolicy.releases[
          fixture.nextPolicy.legacyBridgeVersion
        ].manifestKey,
        policyAbsent
          ? fixture.targetManifest
          : fixture.legacyManifest,
        'public, max-age=31536000, immutable'
      )
    }
    const livePolicy =
      state === 'committed' && !liveDrift
        ? fixture.nextPolicyBytes
        : fixture.beforePolicyBytes
    if (livePolicy) {
      put(
        'r2',
        'biyan/updater/stable/policy.json',
        livePolicy,
        'no-store'
      )
    }
    const liveLegacy =
      state === 'committed' && policyAbsent
        ? fixture.targetManifest
        : fixture.legacyManifest
    put(
      'oss',
      'mita/latest.json',
      liveLegacy,
      'public, max-age=60, must-revalidate'
    )
    put(
      'r2',
      'mita/latest.json',
      liveLegacy,
      'public, max-age=60, must-revalidate'
    )

    const fakeBin = path.join(temp, 'bin')
    fs.mkdirSync(fakeBin)
    const cloudCli = path.join(temp, 'fake-cloud-cli.mjs')
    fs.writeFileSync(
      cloudCli,
      `#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
const [tool, ...args] = process.argv.slice(2)
const root = process.env.FAKE_CLOUD_STORE
const provider = tool === 'aws' ? 'r2' : 'oss'
const value = (flag) => args[args.indexOf(flag) + 1]
const object = (key) => path.join(root, provider, ...key.split('/'))
const exists = (key) => fs.existsSync(object(key))
const metadata = (key) => fs.readFileSync(object(key) + '.metadata.json')
const notFound = (key) => {
  process.stderr.write('404 NoSuchKey ' + provider + ' ' + key + '\\n')
  process.exit(44)
}
if (tool === 'aws') {
  if (args.includes('--generate-cli-skeleton')) {
    process.stdout.write(JSON.stringify({IfMatch:'',IfNoneMatch:''}) + '\\n')
  } else if (args[0] === 's3api' && args[1] === 'head-object') {
    const key = value('--key')
    if (process.env.FAKE_UNKNOWN_OPEN === 'r2'
      && key === process.env.FAKE_OPEN_KEY) {
      process.stderr.write('AccessDenied\\n')
      process.exit(45)
    }
    if (!exists(key)) notFound(key)
    process.stdout.write(metadata(key))
  } else if (args[0] === 's3api' && args[1] === 'get-object') {
    const key = value('--key')
    if (!exists(key)) notFound(key)
    fs.copyFileSync(object(key), args.at(-1))
    process.stdout.write(metadata(key))
  } else if (args[0] === 's3api' && args[1] === 'delete-object') {
    const key = value('--key')
    if (exists(key)) {
      fs.rmSync(object(key))
      fs.rmSync(object(key) + '.metadata.json', {force:true})
      fs.appendFileSync(process.env.FAKE_MUTATIONS, 'r2-delete ' + key + '\\n')
    }
    process.stdout.write('{}\\n')
  } else if (args[0] === 's3' && args[1] === 'cp') {
    const key = args[2].replace(/^s3:\\/\\/[^/]+\\//, '')
    if (!exists(key)) notFound(key)
    fs.copyFileSync(object(key), args[3])
  } else {
    process.stderr.write('unsupported aws: ' + args.join(' ') + '\\n')
    process.exit(64)
  }
} else if (tool === 'ossutil') {
  if (args[0] === 'api' && args[1] === 'head-object') {
    const key = value('--key')
    if (!exists(key)) notFound(key)
    process.stdout.write(metadata(key))
  } else if (args[0] === 'cp') {
    const key = args[1].replace(/^oss:\\/\\/[^/]+\\//, '')
    if (!exists(key)) notFound(key)
    fs.copyFileSync(object(key), args[2])
  } else if (args[0] === 'api' && args[1] === 'get-object-acl') {
    const key = value('--key')
    if (!exists(key)) notFound(key)
    process.stdout.write(fs.readFileSync(object(key) + '.acl.json'))
  } else if (args[0] === 'api' && args[1] === 'delete-object') {
    const key = value('--key')
    if (exists(key)) {
      fs.rmSync(object(key))
      fs.rmSync(object(key) + '.metadata.json', {force:true})
      fs.rmSync(object(key) + '.acl.json', {force:true})
      fs.appendFileSync(process.env.FAKE_MUTATIONS, 'oss-delete ' + key + '\\n')
    }
    process.stdout.write('{}\\n')
  } else {
    process.stderr.write('unsupported ossutil: ' + args.join(' ') + '\\n')
    process.exit(65)
  }
}
`
    )
    const commandWrapper = (tool) => `#!/usr/bin/env bash
exec "$REAL_NODE" "$FAKE_CLOUD_CLI" ${tool} "$@"
`
    for (const tool of ['aws', 'ossutil']) {
      const command = path.join(fakeBin, tool)
      fs.writeFileSync(command, commandWrapper(tool))
      fs.chmodSync(command, 0o755)
    }
    const nodeWrapper = path.join(fakeBin, 'node')
    fs.writeFileSync(
      nodeWrapper,
      `#!/usr/bin/env bash
if [[ "$1" == scripts/updater/promotion-transaction.mjs && "$2" == poll-url ]]; then
  output=
  expected=
  while (($#)); do
    case "$1" in
      --output) output="$2"; shift 2 ;;
      --expected) expected="$2"; shift 2 ;;
      *) shift ;;
    esac
  done
  test -s "$expected"
  mkdir -p "$(dirname "$output")"
  printf '%s\\n' '{"status":200,"verified":true}' >"$output"
  exit 0
fi
exec "$REAL_NODE" "$@"
`
    )
    fs.chmodSync(nodeWrapper, 0o755)
    const curl = path.join(fakeBin, 'curl')
    fs.writeFileSync(
      curl,
      `#!/usr/bin/env bash
set -euo pipefail
headers=
output=
while (($#)); do
  case "$1" in
    --dump-header) headers="$2"; shift 2 ;;
    --output|-o) output="$2"; shift 2 ;;
    *) shift ;;
  esac
done
printf 'HTTP/2 %s\\r\\n' "$FAKE_ROUTER_STATUS" >"$headers"
if [[ -n "$FAKE_ROUTER_STATE" ]]; then
  printf 'x-biyan-updater-state: %s\\r\\n' "$FAKE_ROUTER_STATE" >>"$headers"
fi
printf '\\r\\n' >>"$headers"
if [[ "$FAKE_ROUTER_STATUS" == 200 ]]; then
  printf '{"version":"%s"}\\n' "$FAKE_ROUTER_TARGET" >"$output"
else
  : >"$output"
fi
printf '%s' "$FAKE_ROUTER_STATUS"
`
    )
    fs.chmodSync(curl, 0o755)

    const mutations = path.join(temp, 'mutations.log')
    const result = spawnBashWithPathPrefix(
      fakeBin,
      [
        'scripts/updater/run-promotion-transaction.sh',
        '--recover-terminal-only',
      ],
      {
        cwd: temp,
        encoding: 'utf8',
        env: {
          ...process.env,
          REAL_NODE: pathForBash(process.execPath),
          FAKE_CLOUD_CLI: cloudCli,
          FAKE_CLOUD_STORE: store,
          FAKE_MUTATIONS: mutations,
          FAKE_ROUTER_STATUS:
            !policyAbsent &&
            (state === 'committed' || unchangedTransition)
              ? '200'
              : '204',
          FAKE_ROUTER_STATE:
            !policyAbsent &&
            (state === 'committed' || unchangedTransition)
              ? ''
              : policyAbsent && state !== 'committed'
                ? 'policy-unavailable'
                : 'no-transition',
          FAKE_ROUTER_TARGET: fixture.targetVersion,
          FAKE_UNKNOWN_OPEN: unknownOpenProbe ? 'r2' : '',
          FAKE_OPEN_KEY: OPEN_TRANSACTION_KEY,
          CLOUDFLARE_R2_ACCOUNT_ID: 'test-account',
          CLOUDFLARE_R2_BUCKET: 'test-r2',
          ALIYUN_OSS_BUCKET: 'test-oss',
          ALIYUN_OSS_ENDPOINT: 'oss.example.invalid',
          ALIYUN_REGION: 'test-region',
          POLICY_KEY: 'biyan/updater/stable/policy.json',
          LEGACY_ALIYUN_KEY: 'mita/latest.json',
          LEGACY_R2_KEY: 'mita/latest.json',
          LEGACY_ALIYUN_URL: 'https://aliyun.example.invalid/latest.json',
          LEGACY_R2_URL: 'https://r2.example.invalid/latest.json',
          OPEN_TRANSACTION_KEY,
          PHASE: dispatchRequest.phase,
          FROM_VERSION: dispatchRequest.fromVersion,
          EXPECTED_CURRENT: dispatchRequest.expectedCurrent,
          ROLLOUT: dispatchRequest.rollout,
          DRY_RUN: dryRun ? 'true' : 'false',
          BIYAN_SIGNING_KEY: 'test-signing-key',
          ROLLOUT_SALT: 'test-rollout-salt',
          DYNAMIC_UPDATER_BASE_URL:
            'https://router.example.invalid/biyan/v1/stable',
          GITHUB_RUN_ID: '999',
          GITHUB_RUN_ATTEMPT: '1',
        },
      }
    )
    const survivorPath = path.join(
      store,
      survivor,
      ...OPEN_TRANSACTION_KEY.split('/')
    )
    return {
      fixture,
      result,
      survivorExists: fs.existsSync(survivorPath),
      mutations: fs.existsSync(mutations)
        ? fs.readFileSync(mutations, 'utf8')
        : '',
      recovery: fs.existsSync(
        path.join(temp, 'dist/state/terminal-promotion-recovery.json')
      )
        ? JSON.parse(
            fs.readFileSync(
              path.join(
                temp,
                'dist/state/terminal-promotion-recovery.json'
              ),
              'utf8'
            )
          )
        : null,
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
}

test('test harness normalizes checkout text and fake-bin paths for Bash', () => {
  const temp = fs.mkdtempSync(
    path.join(os.tmpdir(), 'biyan-test-portability-')
  )
  try {
    const sourceFile = path.join(temp, 'runner.sh')
    fs.writeFileSync(
      sourceFile,
      'portable_probe() {\r\n  printf portable\r\n}\r\n'
    )
    const source = readText(sourceFile)
    assert.doesNotMatch(source, /\r/)
    assert.match(shellFunction(source, 'portable_probe'), /\n}\n$/)

    const fakeBin = path.join(temp, 'fake-bin')
    fs.mkdirSync(fakeBin)
    const probe = path.join(fakeBin, 'portable-probe')
    fs.writeFileSync(
      probe,
      '#!/usr/bin/env bash\nprintf fake-bin-hit\n'
    )
    fs.chmodSync(probe, 0o755)

    const bashPath = pathForBash(fakeBin)
    assert.ok(bashPath.startsWith('/'))
    assert.doesNotMatch(bashPath, /\\/)
    const result = spawnBashWithPathPrefix(
      fakeBin,
      ['-c', 'portable-probe'],
      { encoding: 'utf8', env: { ...process.env } }
    )
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, 'fake-bin-hit')
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
})

test('journal schema binds the exact content-addressed next policy', () => {
  const prepared = journal()
  assert.equal(prepared.schema, 2)
  assert.deepEqual(prepared.nextPolicy, {
    key: 'biyan/updater/transactions/123-1/next-policy.json',
    sha256: createHash('sha256')
      .update(Buffer.from('{"currentVersion":"0.6.643"}\n'))
      .digest('hex'),
  })

  for (const mutate of [
    (value) => {
      value.schema = 1
    },
    (value) => {
      delete value.nextPolicy
    },
    (value) => {
      value.nextPolicy.key =
        'biyan/updater/transactions/another-run/next-policy.json'
    },
    (value) => {
      value.nextPolicy.sha256 = sha('f').slice(1)
    },
    (value) => {
      value.nextPolicy.extra = true
    },
  ]) {
    const candidate = structuredClone(prepared)
    mutate(candidate)
    assert.throws(() => validateJournal(candidate))
  }
})

test('terminal promotion recovery binds exact state and same-request intent', () => {
  const committed = terminalFixture('committed')
  const args = {
    journal: committed.journal,
    nextPolicyBytes: committed.nextPolicyBytes,
    beforePolicyBytes: committed.beforePolicyBytes,
    candidate: committed.candidate,
    phase: 'B',
    fromVersion: committed.beforeVersion,
    expectedCurrent: committed.beforeVersion,
    rollout: '5',
    smokeEvidence: committed.smokeEvidence,
    healthEvidence: committed.healthEvidence,
  }
  const plan = terminalPromotionRecoveryPlan(args)
  assert.equal(plan.terminalState, 'committed')
  assert.equal(plan.sameRequest, true)
  assert.deepEqual(plan.router, {
    currentVersion: committed.beforeVersion,
    targetVersion: committed.targetVersion,
    rollout: 5,
    expectedStatus: 200,
    expectedState: null,
  })
  assert.equal(
    terminalPromotionRecoveryPlan({
      ...args,
      rollout: '25',
    }).sameRequest,
    false
  )
  const differentCandidatePlan = terminalPromotionRecoveryPlan({
    ...args,
    candidate: {
      tag: 'v0.6.644',
      version: '0.6.644',
      sourceCommit: 'f'.repeat(40),
      manifestKey:
        'biyan/updater/releases/v0.6.644/latest.json',
      manifestSha256: sha('f'),
    },
    phase: 'C',
    fromVersion: committed.targetVersion,
    expectedCurrent: committed.targetVersion,
  })
  assert.equal(differentCandidatePlan.sameRequest, false)
  assert.deepEqual(differentCandidatePlan.router, plan.router)

  const rolledBack = terminalFixture('rolled-back')
  const rolledBackPlan = terminalPromotionRecoveryPlan({
    ...args,
    journal: rolledBack.journal,
  })
  assert.equal(rolledBackPlan.terminalState, 'rolled-back')
  assert.equal(rolledBackPlan.sameRequest, false)
  assert.deepEqual(rolledBackPlan.router, {
    currentVersion: rolledBack.beforeVersion,
    targetVersion: rolledBack.beforeVersion,
    rollout: 0,
    expectedStatus: 204,
    expectedState: 'no-transition',
  })

  const unchanged = terminalFixture('committed', {
    unchangedTransition: true,
  })
  const unchangedPlan = terminalPromotionRecoveryPlan({
    journal: unchanged.journal,
    nextPolicyBytes: unchanged.nextPolicyBytes,
    beforePolicyBytes: unchanged.beforePolicyBytes,
    candidate: unchanged.candidate,
    phase: unchanged.request.phase,
    fromVersion: unchanged.request.fromVersion,
    expectedCurrent: unchanged.request.expectedCurrent,
    rollout: unchanged.request.rollout,
    smokeEvidence: unchanged.smokeEvidence,
    healthEvidence: unchanged.healthEvidence,
  })
  assert.equal(unchangedPlan.sameRequest, true)
  assert.deepEqual(unchangedPlan.router, {
    currentVersion: unchanged.beforeVersion,
    targetVersion: unchanged.targetVersion,
    rollout: 5,
    expectedStatus: 200,
    expectedState: null,
  })
})

test('terminal promotion recovery rejects nonterminal and cross-transaction evidence', () => {
  const fixture = terminalFixture('committed')
  const args = {
    journal: fixture.journal,
    nextPolicyBytes: fixture.nextPolicyBytes,
    beforePolicyBytes: fixture.beforePolicyBytes,
    candidate: fixture.candidate,
    phase: 'B',
    fromVersion: fixture.beforeVersion,
    expectedCurrent: fixture.beforeVersion,
    rollout: '5',
    smokeEvidence: fixture.smokeEvidence,
    healthEvidence: fixture.healthEvidence,
  }
  const nonterminal = structuredClone(fixture.journal)
  nonterminal.state = 'committing'
  nonterminal.recovery.required = true
  assert.throws(
    () => terminalPromotionRecoveryPlan({ ...args, journal: nonterminal }),
    /committed or rolled-back/
  )
  const wrongBackup = structuredClone(fixture.journal)
  wrongBackup.snapshots[1].backupKey =
    'biyan/updater/transactions/909-1/backups/legacy-oss.json'
  assert.throws(
    () => terminalPromotionRecoveryPlan({ ...args, journal: wrongBackup }),
    /do not match the journal transaction/
  )
  assert.throws(
    () =>
      terminalPromotionRecoveryPlan({
        ...args,
        nextPolicyBytes: Buffer.from('{"drift":true}\n'),
      }),
    /does not match its journal/
  )
})

test('terminal survivor re-dispatch cleans committed and rolled-back journals', () => {
  const committed = runTerminalRedispatch({ state: 'committed' })
  assert.equal(
    committed.result.status,
    0,
    committed.result.stderr || committed.result.stdout
  )
  assert.equal(committed.survivorExists, false)
  assert.match(committed.mutations, /^oss-delete /m)
  assert.deepEqual(committed.recovery, {
    schema: 1,
    status: 'cleaned-terminal-promotion',
    terminalState: 'committed',
    transactionId: '910-1',
    sameRequest: true,
  })

  const rolledBack = runTerminalRedispatch({ state: 'rolled-back' })
  assert.equal(
    rolledBack.result.status,
    0,
    rolledBack.result.stderr || rolledBack.result.stdout
  )
  assert.equal(rolledBack.survivorExists, false)
  assert.match(rolledBack.mutations, /^r2-delete /m)
  assert.deepEqual(rolledBack.recovery, {
    schema: 1,
    status: 'cleaned-terminal-promotion',
    terminalState: 'rolled-back',
    transactionId: '910-1',
    sameRequest: false,
  })

  for (const state of ['committed', 'rolled-back']) {
    const absentPolicy = runTerminalRedispatch({
      state,
      policyAbsent: true,
    })
    assert.equal(
      absentPolicy.result.status,
      0,
      absentPolicy.result.stderr || absentPolicy.result.stdout
    )
    assert.equal(absentPolicy.survivorExists, false)
    assert.equal(
      absentPolicy.recovery.sameRequest,
      state === 'committed'
    )
    assert.equal(absentPolicy.recovery.terminalState, state)
  }

  const unchanged = runTerminalRedispatch({
    state: 'committed',
    unchangedTransition: true,
  })
  assert.equal(
    unchanged.result.status,
    0,
    unchanged.result.stderr || unchanged.result.stdout
  )
  assert.equal(unchanged.survivorExists, false)
  assert.equal(unchanged.recovery.sameRequest, true)

  const differentDispatch = runTerminalRedispatch({
    state: 'committed',
    differentDispatch: true,
  })
  assert.equal(
    differentDispatch.result.status,
    0,
    differentDispatch.result.stderr || differentDispatch.result.stdout
  )
  assert.equal(differentDispatch.survivorExists, false)
  assert.equal(differentDispatch.recovery.sameRequest, false)
})

test('terminal survivor re-dispatch leaves the lock untouched on drift or dry-run', () => {
  const drift = runTerminalRedispatch({
    state: 'committed',
    liveDrift: true,
  })
  assert.notEqual(drift.result.status, 0)
  assert.equal(drift.survivorExists, true)
  assert.equal(drift.mutations, '')

  const dryRun = runTerminalRedispatch({
    state: 'rolled-back',
    dryRun: true,
  })
  assert.notEqual(dryRun.result.status, 0)
  assert.equal(dryRun.survivorExists, true)
  assert.equal(dryRun.mutations, '')
  assert.match(
    dryRun.result.stderr,
    /Dry-run verified a terminal journal but will not delete it/
  )

  const nonterminal = runTerminalRedispatch({
    state: 'committed',
    nonterminal: true,
  })
  assert.notEqual(nonterminal.result.status, 0)
  assert.equal(nonterminal.survivorExists, true)
  assert.equal(nonterminal.mutations, '')
  assert.match(nonterminal.result.stderr, /journal is not terminal/)

  const unknown = runTerminalRedispatch({
    state: 'committed',
    unknownOpenProbe: true,
  })
  assert.notEqual(unknown.result.status, 0)
  assert.equal(unknown.survivorExists, true)
  assert.equal(unknown.mutations, '')
})

test('remote probes distinguish exact absence from permission and network errors', () => {
  assert.equal(
    classifyRemoteProbe({
      provider: 'r2',
      key: 'missing',
      exitCode: 1,
      stderr: 'An error occurred (404) when calling HeadObject: Not Found',
    }).state,
    'absent'
  )
  assert.equal(
    classifyRemoteProbe({
      provider: 'oss',
      key: 'missing',
      exitCode: 1,
      stderr: 'NoSuchKey StatusCode=404',
    }).state,
    'absent'
  )
  for (const detail of [
    'AccessDenied 403',
    'Request timeout',
    'TLS certificate failure',
    'InternalError 500',
    'NoSuchKey 404 followed by network timeout',
  ]) {
    assert.throws(
      () =>
        classifyRemoteProbe({
          provider: 'r2',
          key: 'state',
          exitCode: 1,
          stderr: detail,
        }),
      /must not be treated as absent/
    )
  }
})

test('health evidence URL is content-addressed on the exact trusted origin', () => {
  const digest = sha('d')
  const expected =
    `https://static.mitapp.cn/biyan/updater/evidence/${digest}/rollout-health.json`
  assert.equal(validateHealthEvidenceUrl(expected, digest), expected)
  for (const unsafe of [
    `https://evil.example/biyan/updater/evidence/${digest}/rollout-health.json`,
    `https://static.mitapp.cn.evil.example/biyan/updater/evidence/${digest}/rollout-health.json`,
    `https://static.mitapp.cn/biyan/updater/evidence/${sha('e')}/rollout-health.json`,
    `${expected}?redirect=https://evil.example`,
  ]) {
    assert.throws(
      () => validateHealthEvidenceUrl(unsafe, digest),
      /must be exactly/
    )
  }
})

test('R2 ETag and recovery bytes metadata ACL readback are strict', () => {
  assert.equal(extractR2Etag({ ETag: '"0123456789abcdef0123456789abcdef"' }),
    '"0123456789abcdef0123456789abcdef"')
  assert.throws(() => extractR2Etag({ ETag: 'weak' }), /strict quoted ETag/)

  const bytes = Buffer.from('legacy')
  const restorable = {
    ...snapshot('oss', 'mita/latest.json'),
    bytesSha256: createHash('sha256').update(bytes).digest('hex'),
    metadata: {
      CacheControl: 'public, max-age=60, must-revalidate',
      ContentType: 'application/json',
      Metadata: { owner: 'release' },
      StorageClass: 'Standard',
    },
    acl: { acl: 'public-read' },
  }
  assert.equal(
    verifySnapshotReadback({
      snapshot: restorable,
      bytes,
      metadata: {
        cacheControl: 'public, max-age=60, must-revalidate',
        contentType: 'application/json',
        metadata: { owner: 'release' },
        storageClass: 'Standard',
      },
      acl: { objectAcl: 'public-read' },
    }).acl,
    'public-read'
  )
  assert.throws(
    () =>
      verifySnapshotReadback({
        snapshot: restorable,
        bytes,
        metadata: {
          cacheControl: 'no-store',
          contentType: 'application/json',
          metadata: { owner: 'release' },
          storageClass: 'Standard',
        },
        acl: { objectAcl: 'public-read' },
      }),
    /metadata does not match/
  )
})

test('snapshot backup metadata is exactly reproducible or rejected', () => {
  assert.deepEqual(
    backupMetadataPlan({
      CacheControl: 'public, max-age=60, must-revalidate',
      ContentType: 'application/json',
      Metadata: {},
      StorageClass: 'STANDARD',
    }),
    {
      contentType: 'application/json',
      cacheControl: 'public, max-age=60, must-revalidate',
    }
  )

  for (const metadata of [
    {
      CacheControl: 'no-store',
      ContentType: 'application/json',
      ContentEncoding: 'gzip',
    },
    {
      CacheControl: 'no-store',
      ContentType: 'application/json',
      Metadata: { owner: 'release' },
    },
    {
      CacheControl: 'no-store',
      ContentType: 'application/json',
      StorageClass: 'GLACIER',
    },
  ]) {
    assert.throws(
      () => backupMetadataPlan(metadata),
      /unsupported backup fields/
    )
  }
})

test('policy rollback classifies a successful PUT even when ETag parsing fails', () => {
  const original = Buffer.from('original-policy')
  const proposed = Buffer.from('proposed-policy')
  assert.deepEqual(
    classifyPolicyRollback({
      policyExisted: true,
      originalBytes: original,
      nextBytes: proposed,
      liveState: 'exists',
      liveBytes: proposed,
    }),
    { action: 'restore', reason: 'proposed-policy-is-live' }
  )
  assert.deepEqual(
    classifyPolicyRollback({
      policyExisted: true,
      originalBytes: original,
      nextBytes: proposed,
      liveState: 'exists',
      liveBytes: original,
    }),
    { action: 'no-change', reason: 'original-policy-is-live' }
  )
  assert.throws(
    () =>
      classifyPolicyRollback({
        policyExisted: true,
        originalBytes: original,
        nextBytes: proposed,
        liveState: 'exists',
        liveBytes: Buffer.from('unknown-writer'),
      }),
    /neither original nor proposed/
  )
  assert.throws(
    () =>
      classifyPolicyRollback({
        policyExisted: true,
        originalBytes: original,
        nextBytes: proposed,
        liveState: 'absent',
      }),
    /original policy disappeared/
  )
})

test('initial A requires an exact reviewed approved-next manifest hash', () => {
  const manifestBytes = Buffer.from('{"version":"0.6.643"}\n')
  const digest = createHash('sha256').update(manifestBytes).digest('hex')
  const policy = {
    schema: 1,
    state: 'pre-a',
    current: { version: '0.6.633', manifestSha256: sha('c') },
    approvedNext: {
      version: '0.6.643',
      manifestSha256: digest,
      requiredPlatforms: [
        'darwin-aarch64',
        'darwin-x86_64',
        'windows-x86_64',
        'linux-x86_64',
      ],
    },
  }
  const candidate = {
    version: '0.6.643',
    migrationPhase: 'A',
    dataSchema: 1,
    manifestSha256: digest,
  }
  assert.equal(
    validateApprovedATransition({
      policy,
      candidate,
      manifestBytes,
      currentPolicy: { legacyBridgeVersion: null },
      nextPolicy: { legacyBridgeVersion: '0.6.643' },
    }).manifestSha256,
    digest
  )
  assert.throws(
    () =>
      validateApprovedATransition({
        policy: {
          ...policy,
          approvedNext: { ...policy.approvedNext, manifestSha256: sha('d') },
        },
        candidate,
        manifestBytes,
        currentPolicy: { legacyBridgeVersion: null },
        nextPolicy: { legacyBridgeVersion: '0.6.643' },
      }),
    /not explicitly approved/
  )
  assert.throws(
    () =>
      validateApprovedATransition({
        policy: { ...policy, approvedNext: null },
        candidate,
        manifestBytes,
        currentPolicy: { legacyBridgeVersion: null },
        nextPolicy: { legacyBridgeVersion: '0.6.643' },
      }),
    /approvedNext must be an object/
  )
})

test('tracked initial A approval pins the accepted v0.6.643 manifest exactly', () => {
  const policy = JSON.parse(
    readText(
      path.join(repoRoot, 'scripts/updater/legacy-a-transition-policy.json')
    )
  )
  assert.deepEqual(policy.approvedNext, {
    version: '0.6.643',
    manifestSha256:
      'a0ad7721c74aa6ec7817bb1b9626dbad05226e7871f21cebb4976921d100c9fa',
    requiredPlatforms: [
      'darwin-aarch64',
      'darwin-x86_64',
      'windows-x86_64',
      'linux-x86_64',
    ],
  })
})

test('journal validates restorable bytes, metadata, ACL, and immutable ledger', () => {
  const prepared = journal()
  assert.equal(validateJournal(prepared).state, 'prepared')
  const committing = advanceJournal(prepared, {
    state: 'committing',
    checkpoint: 'before-policy-write',
    immutableEntry: {
      provider: 'oss',
      key: 'biyan/updater/releases/v0.6.643/Biyan.app.tar.gz',
      sha256: sha('e'),
      contentType: 'application/octet-stream',
      cacheControl: 'public, max-age=31536000, immutable',
      createdByTransaction: true,
      verified: true,
    },
    updatedAt: '2026-07-24T00:01:00.000Z',
  })
  assert.equal(committing.state, 'committing')
  assert.equal(committing.recovery.required, true)
  for (const mutate of [
    (entry) => {
      delete entry.contentType
    },
    (entry) => {
      entry.contentType = 'application/x-unreviewed'
    },
    (entry) => {
      entry.cacheControl = 'no-store'
    },
  ]) {
    const candidate = structuredClone(committing)
    mutate(candidate.immutableLedger[0])
    assert.throws(
      () => validateJournal(candidate),
      /immutable ledger|exact fields/
    )
  }
  assert.throws(
    () =>
      validateJournal({
        ...committing,
        snapshots: [
          {
            ...committing.snapshots[1],
            acl: null,
          },
        ],
      }),
    /ACL evidence is not restorable/
  )
  assert.throws(
    () =>
      advanceJournal(committing, {
        state: 'prepared',
        checkpoint: 'rewind',
        updatedAt: '2026-07-24T00:02:00.000Z',
      }),
    /Invalid promotion journal transition/
  )
})

test('recovery commands are derived from durable snapshots and created-object ledger', () => {
  const ossCommitting = advanceJournal(journal(), {
    state: 'committing',
    checkpoint: 'legacy-write-intent',
    immutableEntry: {
      provider: 'oss',
      key: 'biyan/updater/releases/v0.6.643/Biyan.app.tar.gz',
      sha256: sha('e'),
      contentType: 'application/octet-stream',
      cacheControl: 'public, max-age=31536000, immutable',
      createdByTransaction: true,
      verified: true,
    },
    updatedAt: '2026-07-24T00:01:00.000Z',
  })
  const committing = advanceJournal(ossCommitting, {
    state: 'committing',
    checkpoint: 'manifest-r2-write-intent',
    immutableEntry: {
      provider: 'r2',
      key: 'biyan/updater/releases/v0.6.643/latest.json',
      sha256: sha('d'),
      contentType: 'application/json',
      cacheControl: 'public, max-age=31536000, immutable',
      createdByTransaction: true,
      verified: true,
    },
    updatedAt: '2026-07-24T00:02:00.000Z',
  })
  const commands = recoveryCommands(committing)
  const mutationBoundary = commands.indexOf(
    '# RECOVERY MUTATIONS BEGIN: every mutable object is now classified.'
  )
  assert.ok(mutationBoundary > 0)
  const classification = commands.slice(0, mutationBoundary)
  const mutations = commands.slice(mutationBoundary)

  assert.match(classification, /set -euo pipefail/)
  assert.match(
    classification,
    /put-object --generate-cli-skeleton input[\s\S]*delete-object --generate-cli-skeleton input[\s\S]*IfMatch[\s\S]*IfNoneMatch/
  )
  const nextPolicyR2 = classification.indexOf(
    'recovery-readback/next-policy-r2.json'
  )
  const nextPolicyOss = classification.indexOf(
    'recovery-readback/next-policy-oss.json'
  )
  const nextPolicyHash = classification.indexOf(
    '= "$next_policy_sha256"'
  )
  const nextPolicyUse = classification.indexOf(
    'NEXT_POLICY=recovery-readback/next-policy-r2.json'
  )
  assert.ok(
    nextPolicyR2 >= 0
      && nextPolicyOss > nextPolicyR2
      && nextPolicyHash > nextPolicyOss
      && nextPolicyUse > nextPolicyHash
  )
  assert.match(classification, new RegExp(committing.nextPolicy.sha256))
  assert.doesNotMatch(classification, /NEXT_POLICY="\$\{NEXT_POLICY:-/)
  assert.match(classification, /validate-journal/)
  assert.match(classification, /verify-snapshot-readback/)
  assert.ok(
    (classification.match(/verify-snapshot-readback/g) ?? []).length >= 3,
    'every existing snapshot backup must be verified before recovery mutation'
  )
  assert.match(classification, /classify-policy-rollback/)
  assert.match(
    classification,
    /classify-rollback --object-kind legacy-oss/
  )
  assert.match(
    classification,
    /classify-rollback --object-kind legacy-r2/
  )
  assert.match(
    classification,
    /cmp "\$JOURNAL" recovery-readback\/live\/open-r2\.json/
  )
  const noLockProof = classification.slice(
    classification.indexOf('if [[ "$open_lock_present" != true ]]')
  )
  assert.match(noLockProof, /no-lock-final-policy/)
  assert.match(noLockProof, /no-lock-final-legacy-oss/)
  assert.match(noLockProof, /no-lock-final-legacy-r2/)
  assert.match(noLockProof, /no-lock-final-ledger-/)
  const finalOriginProof = noLockProof.indexOf(
    'no-lock-final-legacy-r2-verified.json'
  )
  const finalLedgerProof = noLockProof.lastIndexOf(
    'no-lock-final-ledger-'
  )
  const finalLockProof = noLockProof.indexOf('no-lock-final-r2')
  const locklessExit = noLockProof.indexOf('exit 0')
  assert.ok(
    finalOriginProof >= 0
      && finalOriginProof < finalLedgerProof
      && finalLedgerProof < finalLockProof
      && finalLockProof < locklessExit,
    'lockless completion must close origins, ledger, then locks immediately before exit'
  )
  assert.doesNotMatch(
    noLockProof,
    /\b(?:put-object|delete-object|RefreshObjectCaches|purge_cache)\b/
  )
  const classificationWithoutSkeleton = classification
    .split('\n')
    .filter((line) => !line.includes('--generate-cli-skeleton input'))
    .join('\n')
  assert.doesNotMatch(
    classificationWithoutSkeleton,
    /\b(?:s3api|api) (?:put-object|delete-object)\b/
  )

  const firstLegacyWrite = Math.min(
    ...[
      mutations.indexOf(
        'ossutil api put-object --bucket "$ALIYUN_OSS_BUCKET" --key \'mita/latest.json\''
      ),
      mutations.indexOf(
        'aws s3api put-object --bucket "$CLOUDFLARE_R2_BUCKET" --key \'mita/latest.json\''
      ),
    ].filter((index) => index >= 0)
  )
  const boundaryProbe = mutations.indexOf('boundary-open-r2')
  const splitRepair = mutations.indexOf(
    '# Repair a current split lock create-only'
  )
  assert.ok(
    boundaryProbe >= 0
      && boundaryProbe < splitRepair
      && splitRepair < firstLegacyWrite
      && mutations.indexOf('legacy-oss-prewrite.json') < firstLegacyWrite
      && mutations.indexOf('legacy-r2-prewrite.json') < firstLegacyWrite,
    'locks must be re-probed/repaired and both legacy origins re-read before restore'
  )
  assert.match(
    mutations.slice(boundaryProbe, firstLegacyWrite),
    /boundary-open-r2[\s\S]*boundary-open-oss[\s\S]*Both transaction locks disappeared[\s\S]*--if-none-match '\*'[\s\S]*--forbid-overwrite true/
  )
  const legacyVerified = mutations.indexOf(
    '# Verify both legacy origins before the policy is restored.'
  )
  const legacyCachesConverged = mutations.indexOf(
    'recovery-readback/legacy-r2-cdn.json'
  )
  const policyRestore = mutations.indexOf(
    '# Restore the policy last, after legacy origins and caches converge.'
  )
  assert.ok(
    firstLegacyWrite >= 0
      && firstLegacyWrite < legacyVerified
      && legacyVerified < legacyCachesConverged
      && legacyCachesConverged < policyRestore
  )
  assert.match(
    mutations,
    /decisions\/policy\.json[\s\S]*--if-match "\$policy_etag"/
  )
  assert.match(
    mutations,
    /decisions\/legacy-oss\.json[\s\S]*legacy-oss-prewrite\.json[\s\S]*\bcmp\b[\s\S]*ossutil api put-object/
  )
  assert.match(
    mutations,
    /decisions\/legacy-r2\.json[\s\S]*--if-match "\$legacy_r2_etag"/
  )
  assert.match(
    mutations,
    /predelete-oss-[0-9]+[\s\S]*sha256sum[\s\S]*metadata-plan/
  )
  assert.match(
    mutations,
    /predelete-r2-[0-9]+[\s\S]*sha256sum[\s\S]*metadata-plan/
  )
  const cleanupClassify = mutations.indexOf(
    '# Reclassify every cleanup object before the first cleanup deletion.'
  )
  const cleanupDelete = mutations.indexOf(
    '# Delete cleanup objects only after every predelete classification.'
  )
  assert.ok(cleanupClassify >= 0 && cleanupClassify < cleanupDelete)
  assert.doesNotMatch(
    mutations.slice(cleanupClassify, cleanupDelete),
    /\bdelete-object\b/
  )
  assert.match(
    mutations.slice(cleanupDelete),
    /predelete-r2-[0-9]+-metadata\.json[\s\S]*--if-match "\$ledger_etag"/
  )
  assert.match(
    mutations,
    /open-r2-predelete\.json[\s\S]*open-oss-predelete\.json[\s\S]*cmp "\$JOURNAL"[\s\S]*transactionId[\s\S]*--if-match "\$open_etag"/
  )
  assert.match(commands, /RefreshObjectCaches/)
  assert.match(commands, /cloudflare-cache-purge/)
  assert.match(commands, /poll-url[\s\S]*legacy-aliyun-cdn/)
  assert.match(commands, /poll-url[\s\S]*legacy-r2-cdn/)
  assert.doesNotMatch(commands, /copy-object/)
  assert.doesNotMatch(commands, /\bgh release edit\b|--draft/)
  assert.match(commands, new RegExp(OPEN_TRANSACTION_KEY.replaceAll('/', '\\/')))
  assert.ok(commands.startsWith('#!/usr/bin/env bash\n'))
  assert.equal(spawnSync('bash', ['-n'], { input: commands }).status, 0)
})

test('generated recovery rejects terminal journals instead of rolling them back', () => {
  const committing = advanceJournal(journal(), {
    state: 'committing',
    checkpoint: 'before-policy-write',
    updatedAt: '2026-07-24T00:01:00.000Z',
  })
  const committed = advanceJournal(committing, {
    state: 'committed',
    checkpoint: 'policy-and-origins-verified',
    updatedAt: '2026-07-24T00:02:00.000Z',
  })
  const rollbackRequired = advanceJournal(journal(), {
    state: 'rollback-required',
    checkpoint: 'rollback-started',
    updatedAt: '2026-07-24T00:01:00.000Z',
  })
  const rolledBack = advanceJournal(rollbackRequired, {
    state: 'rolled-back',
    checkpoint: 'rollback-verified',
    updatedAt: '2026-07-24T00:02:00.000Z',
  })
  for (const terminal of [committed, rolledBack]) {
    assert.throws(
      () => recoveryCommands(terminal),
      /require a committing or rollback-required journal/
    )
  }
})

test('recovery leaves the already-published GitHub release immutable', () => {
  const committing = advanceJournal(journal(), {
    state: 'committing',
    checkpoint: 'before-policy-write',
    updatedAt: '2026-07-24T00:01:00.000Z',
  })
  const commands = recoveryCommands(committing)
  assert.doesNotMatch(commands, /\bgh release edit\b|--draft/)
  assert.match(commands, /verify-snapshot-readback/)
  assert.match(commands, /poll-url/)
})

test('recovery never deletes an immutable object before transaction readback verified it', () => {
  const unverified = advanceJournal(journal(), {
    state: 'committing',
    checkpoint: 'immutable-create-intent',
    immutableEntry: {
      provider: 'oss',
      key: 'biyan/updater/releases/v0.6.643/unverified.tar.gz',
      sha256: sha('f'),
      contentType: 'application/octet-stream',
      cacheControl: 'public, max-age=31536000, immutable',
      createdByTransaction: true,
      verified: false,
    },
    updatedAt: '2026-07-24T00:01:00.000Z',
  })
  assert.doesNotMatch(recoveryCommands(unverified), /unverified\.tar\.gz/)
})

test('CDN polling waits through stale success and accepts only exact bytes', async () => {
  const expected = Buffer.from('new')
  let clock = 0
  let attempts = 0
  const result = await pollPublicBytes({
    url: 'https://static.mitapp.cn/mita/latest.json',
    expectedBytes: expected,
    timeoutMs: 1000,
    intervalMs: 100,
    now: () => clock,
    sleep: async (milliseconds) => {
      clock += milliseconds
    },
    fetchImpl: async () => {
      attempts += 1
      return new Response(attempts < 3 ? 'old' : expected, { status: 200 })
    },
  })
  assert.equal(result.status, 200)
  assert.equal(attempts, 3)
})

test('CDN polling fails closed after bounded stale or transport responses', async () => {
  let clock = 0
  await assert.rejects(
    () =>
      pollPublicBytes({
        url: 'https://updates.mita.so/mita/latest.json',
        expectedBytes: Buffer.from('new'),
        timeoutMs: 200,
        intervalMs: 100,
        now: () => clock,
        sleep: async (milliseconds) => {
          clock += milliseconds
        },
        fetchImpl: async () => new Response('old', { status: 200 }),
      }),
    /CDN did not converge/
  )
})

test('transaction runners behaviorally fail closed without AWS conditional inputs', () => {
  const runnerNames = [
    'run-promotion-transaction.sh',
    'run-pause-transaction.sh',
  ]
  const executeCapabilityBlock = (block, putSkeleton, deleteSkeleton) => {
    const harness = `
aws() {
  case "$*" in
    *"s3api put-object"*) printf '%s\\n' "$PUT_SKELETON" ;;
    *"s3api delete-object"*) printf '%s\\n' "$DELETE_SKELETON" ;;
    *) return 64 ;;
  esac
}
${block}
`
    return spawnSync('bash', ['-c', harness], {
      env: {
        ...process.env,
        PUT_SKELETON: JSON.stringify({
          IfMatch: '',
          IfNoneMatch: '',
        }),
        DELETE_SKELETON: JSON.stringify({ IfMatch: '' }),
        ...(putSkeleton === undefined
          ? {}
          : { PUT_SKELETON: JSON.stringify(putSkeleton) }),
        ...(deleteSkeleton === undefined
          ? {}
          : { DELETE_SKELETON: JSON.stringify(deleteSkeleton) }),
      },
      encoding: 'utf8',
    })
  }

  for (const runnerName of runnerNames) {
    const source = readText(
      path.join(repoRoot, 'scripts/updater', runnerName)
    )
    const functionStart = source.indexOf(
      'assert_aws_conditional_capabilities() {'
    )
    const callLine = '\nassert_aws_conditional_capabilities\n'
    const callStart = source.indexOf(callLine, functionStart)
    const block = source.slice(
      functionStart,
      callStart + callLine.length
    )
    const firstCloudMutation = Math.min(
      ...[
        source.indexOf('aws s3api put-object --bucket', callStart),
        source.indexOf('aws s3api delete-object --bucket', callStart),
        source.indexOf('ossutil api put-object --bucket', callStart),
        source.indexOf('ossutil api delete-object --bucket', callStart),
      ].filter((index) => index >= 0)
    )
    assert.ok(
      functionStart >= 0
        && callStart > functionStart
        && callStart < firstCloudMutation,
      `${runnerName} must preflight capabilities before any cloud mutation`
    )
    assert.match(block, /put-object --generate-cli-skeleton input/)
    assert.match(block, /delete-object --generate-cli-skeleton input/)
    assert.equal(executeCapabilityBlock(block).status, 0)
    for (const [putSkeleton, deleteSkeleton] of [
      [{ IfNoneMatch: '' }, { IfMatch: '' }],
      [{ IfMatch: '' }, { IfMatch: '' }],
      [{ IfMatch: '', IfNoneMatch: '' }, {}],
    ]) {
      assert.notEqual(
        executeCapabilityBlock(block, putSkeleton, deleteSkeleton).status,
        0,
        `${runnerName} must reject a missing conditional input`
      )
    }
  }
})

test('probe helpers preserve caller errexit mode', () => {
  for (const runnerName of [
    'run-promotion-transaction.sh',
    'run-pause-transaction.sh',
  ]) {
    const source = readText(
      path.join(repoRoot, 'scripts/updater', runnerName)
    )
    const probe = shellFunction(source, 'probe_r2')
    const base = `
mkdir -p dist/state/probes dist/pause/probes
probe_dir=dist/pause/probes
CLOUDFLARE_R2_BUCKET=test
r2_endpoint=https://example.invalid
aws() { return 44; }
${probe}
`
    const permissive = spawnSync(
      'bash',
      ['-c', `${base}
node() { return 0; }
set +e
probe_r2 key name
case "$-" in *e*) exit 90 ;; esac
false
echo reached
`],
      { encoding: 'utf8' }
    )
    assert.equal(permissive.status, 0, permissive.stderr)
    assert.match(permissive.stdout, /reached/)

    const strict = spawnSync(
      'bash',
      ['-c', `${base}
node() { return 45; }
set -e
probe_r2 key name
echo unreachable
`],
      { encoding: 'utf8' }
    )
    assert.notEqual(strict.status, 0)
    assert.doesNotMatch(strict.stdout, /unreachable/)
  }
})

test('open-journal cleanup resumes when R2 is absent and OSS remains', () => {
  for (const runnerName of [
    'run-promotion-transaction.sh',
    'run-pause-transaction.sh',
  ]) {
    const source = readText(
      path.join(repoRoot, 'scripts/updater', runnerName)
    )
    const cleanup = shellFunction(source, 'delete_open_journal')
    const result = spawnSync(
      'bash',
      ['-c', `
set -euo pipefail
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cd "$tmp"
mkdir -p dist/state/probes dist/pause/probes
state_dir=dist/pause
probe_dir=dist/pause/probes
journal="$PWD/journal.json"
printf '%s\\n' '{"transactionId":"123-1"}' >"$journal"
transaction_id=123-1
OPEN_TRANSACTION_KEY=biyan/updater/transactions/open.json
CLOUDFLARE_R2_BUCKET=test
ALIYUN_OSS_BUCKET=test
ALIYUN_REGION=test
r2_endpoint=https://r2.invalid
oss_endpoint=https://oss.invalid
oss_exists=true
probe_r2() {
  local name="$2"
  printf '%s\\n' '{"state":"absent"}' >"\${probe_dir}/\${name}.json"
  mkdir -p dist/state/probes
  cp "\${probe_dir}/\${name}.json" "dist/state/probes/\${name}.json"
}
probe_oss() {
  local name="$2" state=absent
  if [[ "$oss_exists" == true ]]; then state=exists; fi
  printf '{"state":"%s"}\\n' "$state" >"\${probe_dir}/\${name}.json"
  mkdir -p dist/state/probes
  cp "\${probe_dir}/\${name}.json" "dist/state/probes/\${name}.json"
}
download_r2() { echo unexpected-r2 >&2; return 91; }
download_oss() { cp "$journal" "$2"; }
aws() { echo unexpected-aws >&2; return 92; }
ossutil() {
  if [[ "$1" == cp ]]; then
    cp "$journal" "$3"
  elif [[ "$1 $2" == "api head-object" ]]; then
    printf '%s\\n' '{"ContentType":"application/json","CacheControl":"no-store"}'
  elif [[ "$1 $2" == "api delete-object" ]]; then
    oss_exists=false
    printf '%s\\n' delete >>"$tmp/oss-deletes.log"
  else
    return 93
  fi
}
node() {
  local output=
  while (($#)); do
    if [[ "$1" == --output ]]; then output="$2"; shift 2; else shift; fi
  done
  test -n "$output"
  mkdir -p "$(dirname "$output")"
  printf '%s\\n' '{"contentType":"application/json","cacheControl":"no-store"}' >"$output"
}
${cleanup}
delete_open_journal
test "$(wc -l <"$tmp/oss-deletes.log" | tr -d ' ')" = 1
`],
      { encoding: 'utf8' }
    )
    assert.equal(
      result.status,
      0,
      `${runnerName}: ${result.stderr || result.stdout}`
    )
  }
})

test('generated ledger cleanup skips an absent subset and deletes nothing on unknown', () => {
  const automaticRunner = readText(
    path.join(repoRoot, 'scripts/updater/run-promotion-transaction.sh')
  )
  const automaticClassifier = shellFunction(
    automaticRunner,
    'classify_ledger_object'
  )
  assert.match(
    automaticClassifier,
    /printf '%s\\n' "\$state"[\s\S]*if \[\[ "\$state" == absent \]\]; then return 0; fi[\s\S]*test "\$state" = exists/
  )
  const automaticCleanup = automaticRunner.slice(
    automaticRunner.indexOf(
      '# Reclassify every ledger object immediately before cleanup.'
    ),
    automaticRunner.indexOf(
      'node scripts/updater/promotion-transaction.mjs advance-journal',
      automaticRunner.indexOf(
        '# Reclassify every ledger object immediately before cleanup.'
      )
    )
  )
  assert.match(automaticCleanup, /initial_ledger_state/)
  assert.match(automaticCleanup, /predelete_ledger_state/)
  assert.match(automaticCleanup, /if \[\[ "\$ledger_state" == absent \]\]; then continue; fi/)
  assert.match(automaticCleanup, /--if-match "\$ledger_etag"/)
  assert.match(automaticCleanup, /ledger-deleted-\$\{ledger_index\}/)

  const ledgerBytes = Buffer.from('transaction-created-ledger-object\n')
  const ledgerSha = createHash('sha256').update(ledgerBytes).digest('hex')
  const ossLedger = {
    provider: 'oss',
    key: 'biyan/updater/releases/v0.6.643/ledger-object',
    sha256: ledgerSha,
    contentType: 'application/octet-stream',
    cacheControl: 'public, max-age=31536000, immutable',
    createdByTransaction: true,
    verified: true,
  }
  const r2Ledger = {
    ...ossLedger,
    provider: 'r2',
    key: 'biyan/updater/releases/v0.6.643/already-deleted',
  }
  let withLedger = advanceJournal(journal(), {
    state: 'committing',
    checkpoint: 'verified-oss-ledger',
    immutableEntry: ossLedger,
    updatedAt: '2026-07-24T00:01:00.000Z',
  })
  withLedger = advanceJournal(withLedger, {
    state: 'committing',
    checkpoint: 'verified-r2-ledger',
    immutableEntry: r2Ledger,
    updatedAt: '2026-07-24T00:02:00.000Z',
  })
  const commands = recoveryCommands(withLedger)
  const cleanup = commands.slice(
    commands.indexOf(
      '# Reclassify every cleanup object before the first cleanup deletion.'
    ),
    commands.indexOf(
      '# Delete each still-present matching lock; an absent side is already done.'
    )
  )
  assert.match(cleanup, /predelete-r2-0-state/)
  assert.match(cleanup, /predelete-oss-1-state/)
  assert.match(cleanup, /Reject absent-to-exists resurrection/)

  const run = (r2State) =>
    spawnSync(
      'bash',
      ['-c', `
set -euo pipefail
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cd "$tmp"
mkdir -p recovery-readback/ledger
printf '%s\\n' exists >recovery-readback/ledger/0-state
printf '%s\\n' absent >recovery-readback/ledger/1-state
printf '%s' "$LEDGER_BYTES" >"$tmp/oss-object"
CLOUDFLARE_R2_BUCKET=test
ALIYUN_OSS_BUCKET=test
ALIYUN_REGION=test
r2_endpoint=https://r2.invalid
oss_endpoint=https://oss.invalid
probe_r2_recovery() {
  printf '{"state":"%s"}\\n' "$R2_STATE" >"recovery-readback/$2.json"
}
probe_oss_recovery() {
  local state=absent
  if [[ -f "$tmp/oss-object" ]]; then state=exists; fi
  printf '{"state":"%s"}\\n' "$state" >"recovery-readback/$2.json"
}
aws() { echo unexpected-aws >>"$tmp/mutations.log"; return 91; }
ossutil() {
  if [[ "$1" == cp ]]; then
    cp "$tmp/oss-object" "$3"
  elif [[ "$1 $2" == "api head-object" ]]; then
    printf '%s\\n' '{"ContentType":"application/octet-stream"}'
  elif [[ "$1 $2" == "api delete-object" ]]; then
    rm "$tmp/oss-object"
    printf '%s\\n' oss-delete >>"$tmp/mutations.log"
  else
    return 92
  fi
}
node() {
  local output=
  while (($#)); do
    if [[ "$1" == --output ]]; then output="$2"; shift 2; else shift; fi
  done
  test -n "$output"
  printf '%s\\n' \
    '{"contentType":"application/octet-stream","cacheControl":"public, max-age=31536000, immutable"}' \
    >"$output"
}
${cleanup}
cat "$tmp/mutations.log"
`],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          LEDGER_BYTES: ledgerBytes.toString(),
          R2_STATE: r2State,
        },
      }
    )

  const partial = run('absent')
  assert.equal(partial.status, 0, partial.stderr)
  assert.equal(partial.stdout.trim(), 'oss-delete')

  const unknown = run('unknown')
  assert.notEqual(unknown.status, 0)
  assert.doesNotMatch(unknown.stdout + unknown.stderr, /oss-delete/)
})

test('promotion journal artifacts are create-only, read back, and CAS-deleted', () => {
  const runner = readText(
    path.join(repoRoot, 'scripts/updater/run-promotion-transaction.sh')
  )
  const persist = runner.slice(
    runner.indexOf('persist_journal() {'),
    runner.indexOf('publish_transaction_next_policy() {')
  )
  assert.match(persist, /put_r2_json "\$journal" "\$history_key" false/)
  assert.match(persist, /put_oss_json "\$journal" "\$history_key" false/)
  assert.match(
    persist,
    /journal-r2-history-\$\{sequence\}\.json[\s\S]*journal-oss-history-\$\{sequence\}\.json[\s\S]*cmp "\$journal"/
  )
  const createJournal = runner.indexOf(
    'promotion-transaction.mjs create-journal'
  )
  const publishNextPolicy = runner.indexOf(
    '\npublish_transaction_next_policy\n',
    createJournal
  )
  const persistPrepared = runner.indexOf('\npersist_journal\n', publishNextPolicy)
  assert.ok(
    createJournal >= 0
      && createJournal < publishNextPolicy
      && publishNextPolicy < persistPrepared
  )
  assert.match(
    runner.slice(createJournal, publishNextPolicy),
    /--next-policy dist\/state\/next-policy\.json/
  )

  const nextPolicy = runner.slice(
    runner.indexOf('publish_transaction_next_policy() {'),
    runner.indexOf('advance_journal() {')
  )
  assert.match(nextPolicy, /put_r2_json dist\/state\/next-policy\.json "\$key" false/)
  assert.match(nextPolicy, /--forbid-overwrite true/)
  assert.match(
    nextPolicy,
    /next-policy-r2-readback\.json[\s\S]*next-policy-oss-readback\.json[\s\S]*cmp dist\/state\/next-policy\.json[\s\S]*sha256sum/
  )
  assert.match(nextPolicy, /contentType == "application\/json"/)
  assert.match(nextPolicy, /cacheControl == "no-store"/)

  for (const runnerName of [
    'run-promotion-transaction.sh',
    'run-pause-transaction.sh',
  ]) {
    const source = readText(
      path.join(repoRoot, 'scripts/updater', runnerName)
    )
    const deleteFunction = source.slice(
      source.indexOf('delete_open_journal() {'),
      source.indexOf('\n}\n', source.indexOf('delete_open_journal() {')) + 3
    )
    assert.match(deleteFunction, /open-journal-r2-predelete/)
    assert.match(deleteFunction, /open-journal-oss-predelete/)
    assert.match(deleteFunction, /cmp "\$journal"/)
    assert.match(deleteFunction, /\.transactionId/)
    assert.match(deleteFunction, /--if-match "\$open_journal_etag"/)
    const expectedCalls = 3
    assert.equal(
      source.match(/^\s*delete_open_journal(?: \|\| rollback_failed=1)?$/gm)
        ?.length,
      expectedCalls,
      `${runnerName} must reach idempotent lock cleanup from every terminal path`
    )
  }
})

test('mutable snapshots are backed up create-only and fully read back before writes', () => {
  const runner = readText(
    path.join(repoRoot, 'scripts/updater/run-promotion-transaction.sh')
  )
  const r2Start = runner.indexOf('publish_snapshot_backup_r2()')
  const ossStart = runner.indexOf('publish_snapshot_backup_oss()')
  const executionStart = runner.indexOf(
    'node scripts/updater/promotion-transaction.mjs create-journal'
  )
  const writeFlags = runner.indexOf('policy_write_attempted=false')
  assert.ok(
    r2Start >= 0
      && r2Start < ossStart
      && ossStart < executionStart
      && executionStart < writeFlags
  )

  const r2Backup = runner.slice(r2Start, ossStart)
  assert.match(r2Backup, /--if-none-match '\*'/)
  assert.match(r2Backup, /s3api get-object/)
  assert.match(r2Backup, /verify-snapshot-readback/)
  assert.doesNotMatch(r2Backup, /\bs3 cp\b|copy-object/)

  const ossBackup = runner.slice(ossStart, executionStart)
  assert.match(ossBackup, /--forbid-overwrite true/)
  assert.match(ossBackup, /ossutil cp/)
  assert.match(ossBackup, /head-object/)
  assert.match(ossBackup, /get-object-acl/)
  assert.match(ossBackup, /verify-snapshot-readback/)
  assert.doesNotMatch(ossBackup, /copy-object/)

  const backupCalls = runner.slice(executionStart, writeFlags)
  assert.match(
    backupCalls,
    /publish_snapshot_backup_r2 0[\s\S]*publish_snapshot_backup_oss 1[\s\S]*publish_snapshot_backup_r2 2/
  )
  assert.match(backupCalls, /backup-metadata-plan/)
})

test('legacy forward CAS and rollback preserve a classify-before-write boundary', () => {
  const runner = readText(
    path.join(repoRoot, 'scripts/updater/run-promotion-transaction.sh')
  )

  const forwardStart = runner.indexOf(
    '# Re-read each mutable legacy object immediately before its write.'
  )
  const ossClassify = runner.indexOf(
    'classify-cas \\\n      --object-kind legacy-oss',
    forwardStart
  )
  const ossAttempt = runner.indexOf(
    'legacy_oss_write_attempted=true',
    ossClassify
  )
  const ossWrite = runner.indexOf(
    'ossutil api put-object --bucket "$ALIYUN_OSS_BUCKET"',
    ossAttempt
  )
  const ossReadback = runner.indexOf(
    'dist/state/forward-legacy-oss-readback.json',
    ossWrite
  )
  assert.ok(
    forwardStart >= 0
      && forwardStart < ossClassify
      && ossClassify < ossAttempt
      && ossAttempt < ossWrite
      && ossWrite < ossReadback
  )

  const r2Classify = runner.indexOf(
    'classify-cas \\\n      --object-kind legacy-r2',
    ossReadback
  )
  const r2Attempt = runner.indexOf(
    'legacy_r2_write_attempted=true',
    r2Classify
  )
  const r2Write = runner.indexOf(
    'aws s3api put-object --bucket "$CLOUDFLARE_R2_BUCKET"',
    r2Attempt
  )
  const r2Readback = runner.indexOf(
    'dist/state/forward-legacy-r2-readback.json',
    r2Write
  )
  assert.ok(
    ossReadback < r2Classify
      && r2Classify < r2Attempt
      && r2Attempt < r2Write
      && r2Write < r2Readback
  )
  assert.match(
    runner.slice(r2Write, r2Readback),
    /--if-match "\$forward_legacy_r2_etag"/
  )

  const rollbackStart = runner.indexOf('rollback() {')
  const rollbackEnd = runner.indexOf('trap rollback ERR INT TERM', rollbackStart)
  const rollback = runner.slice(rollbackStart, rollbackEnd)
  const phaseTwo = rollback.indexOf(
    '# Phase 2 may mutate only after every classification succeeded.'
  )
  for (const marker of [
    'classify-policy-rollback',
    'classify-rollback --object-kind legacy-oss',
    'classify-rollback --object-kind legacy-r2',
  ]) {
    const classification = rollback.indexOf(marker)
    assert.ok(
      classification >= 0 && classification < phaseTwo,
      `${marker} must complete before the rollback restore phase`
    )
  }
  assert.match(
    rollback.slice(phaseTwo),
    /if \[\[ "\$rollback_failed" -eq 0[\s\S]*--if-match "\$live_policy_etag"/
  )
  assert.match(
    rollback.slice(phaseTwo),
    /--if-match "\$rollback_legacy_r2_etag"/
  )
  assert.ok(
    rollback.indexOf('classify_ledger_object classified') < phaseTwo,
    'every cleanup object must be classified before rollback mutations'
  )
  const phaseTwoSource = rollback.slice(phaseTwo)
  const firstLegacyRestore = Math.min(
    phaseTwoSource.indexOf(
      '--body file://dist/state/snapshots/legacy-oss.json'
    ),
    phaseTwoSource.indexOf(
      '--body dist/state/snapshots/legacy-r2.json'
    )
  )
  assert.ok(
    phaseTwoSource.indexOf('rollback-legacy-oss-prewrite.json')
        < firstLegacyRestore
      && phaseTwoSource.indexOf('rollback-legacy-r2-prewrite.json')
        < firstLegacyRestore,
    'both legacy objects must be re-read before the first restore'
  )
  const legacyVerification = phaseTwoSource.indexOf(
    'rollback-legacy-r2-verified.json'
  )
  const legacyCacheConvergence = phaseTwoSource.indexOf(
    'rollback-legacy-r2-cdn.json'
  )
  const policyPrewrite = phaseTwoSource.indexOf(
    'rollback-policy-prewrite.json'
  )
  assert.ok(
    firstLegacyRestore >= 0
      && firstLegacyRestore < legacyVerification
      && legacyVerification < legacyCacheConvergence
      && legacyCacheConvergence < policyPrewrite,
    'legacy restore and cache acceptance must finish before policy restore'
  )
  const predeleteClassify = phaseTwoSource.indexOf(
    'classify_ledger_object predelete'
  )
  const cleanupDeleteLoop = phaseTwoSource.indexOf(
    'ledger_provider="$(jq -er',
    predeleteClassify
  )
  assert.ok(
    predeleteClassify >= 0 && predeleteClassify < cleanupDeleteLoop
  )
  assert.doesNotMatch(
    phaseTwoSource.slice(predeleteClassify, cleanupDeleteLoop),
    /\bdelete-object\b/
  )
  assert.match(
    phaseTwoSource.slice(cleanupDeleteLoop),
    /--if-match "\$ledger_etag"/
  )
})

test('pause runner proves Router state before mutation and after pause', () => {
  const runner = readText(
    path.join(repoRoot, 'scripts/updater/run-pause-transaction.sh')
  )
  const preProbe = runner.indexOf('probe_router_state before')
  const preState = runner.indexOf(
    'before-router-probe.state")" = "no-transition"',
    preProbe
  )
  const createJournal = runner.indexOf(
    'legacy-pause-transaction.mjs create-journal',
    preState
  )
  const firstWrite = runner.indexOf('policy_write_attempted=true', createJournal)
  const postProbe = runner.indexOf('probe_router_state after', firstWrite)
  const postProof = runner.indexOf(
    'legacy-pause-transaction.mjs validate-router-probe',
    postProbe
  )
  assert.ok(
    preProbe >= 0
      && preProbe < preState
      && preState < createJournal
      && createJournal < firstWrite
      && firstWrite < postProbe
      && postProbe < postProof
  )
  assert.match(
    runner.slice(postProof, runner.indexOf('validate-readback', postProof)),
    /--before-status[\s\S]*--before-state[\s\S]*--after-status[\s\S]*--after-state/
  )
  const r2Backup = runner.slice(
    runner.indexOf('publish_immutable_r2()'),
    runner.indexOf('publish_immutable_oss()')
  )
  const ossBackup = runner.slice(
    runner.indexOf('publish_immutable_oss()'),
    runner.indexOf('persist_journal()')
  )
  assert.match(r2Backup, /--if-none-match '\*'/)
  assert.match(r2Backup, /backup-metadata-plan/)
  assert.match(r2Backup, /cmp "\$file"/)
  assert.match(ossBackup, /--forbid-overwrite true/)
  assert.match(ossBackup, /--object-acl private/)
  assert.match(ossBackup, /head-object/)
  assert.match(ossBackup, /get-object-acl/)
  assert.match(ossBackup, /backup-metadata-plan/)
  assert.match(ossBackup, /cmp "\$file"/)

  const rollback = runner.slice(
    runner.indexOf('rollback() {'),
    runner.indexOf('trap rollback ERR INT TERM')
  )
  const classificationEnd = rollback.indexOf(
    'if [[ "$rollback_failed" -eq 0 \\\n    && "$legacy_r2_write_attempted"'
  )
  for (const marker of [
    'r2_classification_ok=true',
    'oss_classification_ok=true',
    'policy_classification_ok=true',
  ]) {
    const index = rollback.indexOf(marker)
    assert.ok(index >= 0 && index < classificationEnd)
  }
  assert.match(
    rollback.slice(classificationEnd),
    /rollback-prewrite-legacy-r2[\s\S]*--if-match "\$rollback_legacy_r2_etag"/
  )
  assert.match(
    rollback.slice(classificationEnd),
    /rollback-prewrite-legacy-oss[\s\S]*cmp "\$\{state_dir\}\/rollback-live-legacy-oss\.json"/
  )
  const restorePhase = rollback.slice(classificationEnd)
  const firstLegacyRestore = Math.min(
    restorePhase.indexOf(
      '--body "file://${state_dir}/legacy-a-oss.json"'
    ),
    restorePhase.indexOf('--body "${state_dir}/legacy-a-r2.json"')
  )
  assert.ok(
    restorePhase.indexOf('rollback-prewrite-legacy-r2.json')
        < firstLegacyRestore
      && restorePhase.indexOf('rollback-prewrite-legacy-oss.json')
        < firstLegacyRestore
  )
  const legacyVerified = restorePhase.indexOf(
    'rollback-verified-legacy-r2.json'
  )
  const legacyCacheConverged = restorePhase.indexOf(
    'poll_legacy_bytes "${state_dir}/legacy-a-oss.json" rollback'
  )
  const policyPrewrite = restorePhase.indexOf(
    'fetch_policy_for_cas rollback-prewrite'
  )
  assert.ok(
    firstLegacyRestore >= 0
      && firstLegacyRestore < legacyVerified
      && legacyVerified < legacyCacheConverged
      && legacyCacheConverged < policyPrewrite,
    'pause rollback must accept legacy before restoring policy'
  )
})

test('promotion workflows carry the fail-closed transaction controls', () => {
  const promotion = readText(
    path.join(repoRoot, '.github/workflows/promote-desktop-update.yml')
  )
  const runner = readText(
    path.join(repoRoot, 'scripts/updater/run-promotion-transaction.sh')
  )
  const pauseRunner = readText(
    path.join(repoRoot, 'scripts/updater/run-pause-transaction.sh')
  )
  const promotionControl = `${promotion}\n${runner}`
  assert.match(promotion, /^  actions: read$/m)
  assert.match(promotion, /^  contents: read$/m)
  assert.match(promotion, /group: biyan-stable-updater-promotion/)
  assert.match(promotion, /aliyun-cli-linux-3\.3\.22-amd64\.tgz/)
  assert.match(promotion, /ossutil-2\.3\.0-linux-amd64\.zip/)
  assert.doesNotMatch(
    promotionControl,
    /\baliyun\s+--profile\s+\S+\s+oss\b/
  )
  assert.match(
    promotionControl,
    new RegExp(OPEN_TRANSACTION_KEY.replaceAll('/', '\\/'))
  )
  assert.match(promotionControl, /promotion-transaction\.mjs classify-probe/)
  assert.match(promotionControl, /promotion-transaction\.mjs poll-url/)
  assert.match(promotion, /inputs\.dry_run != true/)
  assert.match(promotion, /dry-run remote preflight/i)
  const liveMainGuard = promotion.indexOf(
    '- name: Revalidate exact live main before release secrets'
  )
  const remotePreflight = promotion.indexOf(
    '- name: Dry-run remote preflight and unfinished transaction gate'
  )
  const firstReleaseSecret = promotion.indexOf('secrets.')
  assert.ok(
    liveMainGuard >= 0 &&
      liveMainGuard < remotePreflight &&
      remotePreflight < firstReleaseSecret,
    'fresh live-main proof must run before release secrets and lock cleanup'
  )
  const guard = promotion.slice(liveMainGuard, remotePreflight)
  assert.doesNotMatch(guard, /secrets\./)
  assert.match(guard, /test "\$GITHUB_REF" = "refs\/heads\/mita-main"/)
  assert.match(
    guard,
    /git fetch --force --no-tags origin[\s\S]*refs\/heads\/mita-main:refs\/remotes\/origin\/mita-main/
  )
  assert.match(guard, /test "\$GITHUB_SHA" = "\$\(git rev-parse HEAD\)"/)
  assert.match(
    guard,
    /test "\$GITHUB_SHA" = \\\n\s+"\$\(git rev-parse refs\/remotes\/origin\/mita-main\)"/
  )
  assert.match(
    promotion,
    /id: remote_preflight[\s\S]*run-promotion-transaction\.sh[\s\S]*--recover-terminal-only[\s\S]*committed_same_request/
  )
  assert.match(
    promotion,
    /Build logical CAS proposal\n\s+if: steps\.remote_preflight\.outputs\.committed_same_request != 'true'/
  )
  assert.match(
    promotion,
    /Publish with rollback protection[\s\S]*inputs\.dry_run != true &&[\s\S]*committed_same_request != 'true'/
  )
  assert.match(promotion, /timeout-minutes: 90/)
  assert.match(promotion, /"Biyan A Canary"/)
  assert.match(promotion, /"Biyan Upgrade Smoke"/)
  assert.match(promotion, /github-native-two-point-canary/)
  assert.match(promotion, /\.workflow\.finishRunId == \$run/)
  assert.match(
    promotion,
    /legacy-manifest-policy\.mjs[\s\S]*--aliyun dist\/state\/pre-a-legacy-oss\.json[\s\S]*--r2 dist\/state\/pre-a-legacy-r2\.json[\s\S]*--evidence dist\/state\/pre-a-legacy-evidence\.json/
  )
  assert.match(
    promotion,
    /test "\$\(jq -r \.isDraft dist\/release\.json\)" = "false"/
  )
  assert.doesNotMatch(promotionControl, /\bgh release edit\b|--draft/)
  assert.match(
    runner,
    /select\(\.createdByTransaction and \.verified\)/
  )
  assert.match(runner, /rollback-legacy-aliyun-cdn\.json/)
  assert.match(runner, /rollback-legacy-r2-cdn\.json/)
  assert.match(runner, /--if-match "\$policy_original_etag"/)
  assert.match(runner, /--if-none-match '\*'/)
  const attempted = runner.indexOf('policy_write_attempted=true')
  const parseEtag = runner.indexOf(
    'policy_written_etag="$(node scripts/updater/promotion-transaction.mjs',
    attempted
  )
  assert.ok(attempted >= 0 && attempted < parseEtag)
  assert.match(runner, /classify-policy-rollback/)
  assert.match(runner, /validate-fallback-bytes/)
  assert.match(runner, /validate-resume/)
  assert.match(runner, /legacy_publish_source=dist\/state\/resume-active-a\.json/)
  const legacyOriginsVerified = runner.indexOf(
    'advance_journal committing legacy-origins-verified-before-policy'
  )
  const beforePolicyWrite = runner.indexOf(
    'advance_journal committing before-policy-write'
  )
  assert.ok(
    legacyOriginsVerified >= 0
      && legacyOriginsVerified < beforePolicyWrite
      && beforePolicyWrite < attempted,
    'legacy origins must pass public byte readback before the policy can be unpaused'
  )
  assert.match(
    promotion,
    /Publish with rollback protection[\s\S]*git fetch --force --no-tags origin[\s\S]*refs\/remotes\/origin\/mita-main[\s\S]*run-promotion-transaction\.sh/
  )
  for (const writer of [
    'updater-health-gate.yml',
    'updater-kill-switch.yml',
  ]) {
    const source = readText(
      path.join(repoRoot, '.github/workflows', writer)
    )
    assert.match(source, new RegExp(OPEN_TRANSACTION_KEY.replaceAll('/', '\\/')))
    assert.match(source, /ref: mita-main/)
    assert.match(source, /refs\/remotes\/origin\/mita-main/)
    assert.match(source, /ossutil-2\.3\.0-linux-amd64\.zip/)
    assert.match(source, /run-pause-transaction\.sh/)
    assert.match(source, /environment: release-distribution/)
  }
  assert.match(pauseRunner, /promotion-transaction\.mjs classify-probe/)
  assert.match(pauseRunner, /--provider r2/)
  assert.match(pauseRunner, /--provider oss/)
  assert.match(pauseRunner, /legacy-pause-transaction\.mjs validate-live/)
  assert.match(pauseRunner, /legacy-pause-transaction\.mjs create-journal/)
  assert.match(pauseRunner, /classify_object cas policy/)
  assert.match(pauseRunner, /classify_object cas legacy-oss/)
  assert.match(pauseRunner, /classify_object cas legacy-r2/)
  assert.match(pauseRunner, /classify_object rollback policy/)
  assert.match(pauseRunner, /--if-match "\$policy_etag"/)
  assert.match(pauseRunner, /--if-match "\$legacy_r2_etag"/)
  assert.match(pauseRunner, /legacy-a-oss-acl/)
  assert.match(pauseRunner, /validate-readback/)
  assert.match(pauseRunner, /purge_legacy_caches/)
  const health = readText(
    path.join(repoRoot, '.github/workflows/updater-health-gate.yml')
  )
  assert.match(health, /validate-health-evidence-url/)
})

test('updater workflows expose production secrets only to required read or mutation steps', () => {
  const workflow = (name) =>
    readText(path.join(repoRoot, '.github/workflows', name))
  const jobEnvironment = (source) => {
    const match = source.match(
      /\n    environment: release-distribution\n    env:\n([\s\S]*?)\n    steps:/
    )
    assert.ok(match, 'release-distribution job environment must be explicit')
    return match[1]
  }
  const count = (source, pattern) => source.match(pattern)?.length ?? 0

  const promotion = workflow('promote-desktop-update.yml')
  const health = workflow('updater-health-gate.yml')
  const kill = workflow('updater-kill-switch.yml')
  for (const source of [promotion, health, kill]) {
    assert.doesNotMatch(jobEnvironment(source), /secrets\./)
  }

  assert.equal(
    count(promotion, /secrets\.CLOUDFLARE_API_TOKEN/g),
    1,
    'Cloudflare cache mutation token must exist only on publish'
  )
  assert.equal(
    count(promotion, /secrets\.BIYAN_SIGNING_KEY/g),
    2,
    'signing key is exposed only to terminal readback and publish'
  )
  assert.equal(
    count(promotion, /secrets\.BIYAN_UPDATER_ROLLOUT_SALT/g),
    2,
    'rollout salt is exposed only to terminal readback and publish'
  )
  assert.doesNotMatch(
    health.slice(
      health.indexOf('- name: Evaluate fail-closed health thresholds'),
      health.indexOf(
        '- name: Pause Router and legacy origins when a threshold is breached'
      )
    ),
    /secrets\./
  )
  assert.equal(count(health, /secrets\.BIYAN_SIGNING_KEY/g), 1)
  assert.doesNotMatch(
    kill.slice(
      kill.indexOf('- name: Check out trusted policy writer'),
      kill.indexOf('- name: Apply fail-closed dual-cloud pause transaction')
    ),
    /secrets\./
  )
  assert.equal(count(kill, /secrets\.BIYAN_SIGNING_KEY/g), 1)
})
