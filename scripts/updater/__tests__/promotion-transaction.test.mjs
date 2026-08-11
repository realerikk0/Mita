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
  extractOssAcl,
  extractR2Etag,
  pollPublicBytes,
  recoveryCommands,
  resolveSplitNonterminalJournal,
  resolveUnifiedNonterminalJournal,
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
  const backupName =
    provider === 'r2' && key === 'biyan/updater/stable/policy.json'
      ? 'policy'
      : provider
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
        backupKey: `biyan/updater/transactions/123-1/backups/${backupName}.json`,
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
          `${JSON.stringify(
            acl ?? {
              AccessControlList: { Grant: 'default' },
              Owner: { DisplayName: 'test-owner', ID: 'test-owner' },
            }
          )}\n`
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
const writeOssJson = (bytes) => {
  process.stdout.write(bytes)
  if (!args.includes('--quiet')) {
    process.stdout.write('\\n0.123456(s) elapsed\\n')
  }
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
    writeOssJson(metadata(key))
  } else if (args[0] === 'cp') {
    const key = args[1].replace(/^oss:\\/\\/[^/]+\\//, '')
    if (!exists(key)) notFound(key)
    fs.copyFileSync(object(key), args[2])
  } else if (args[0] === 'api' && args[1] === 'get-object-acl') {
    const key = value('--key')
    if (!exists(key)) notFound(key)
    writeOssJson(fs.readFileSync(object(key) + '.acl.json'))
  } else if (args[0] === 'api' && args[1] === 'delete-object') {
    const key = value('--key')
    if (exists(key)) {
      fs.rmSync(object(key))
      fs.rmSync(object(key) + '.metadata.json', {force:true})
      fs.rmSync(object(key) + '.acl.json', {force:true})
      fs.appendFileSync(process.env.FAKE_MUTATIONS, 'oss-delete ' + key + '\\n')
    }
    writeOssJson('{}\\n')
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
  assert.equal(prepared.schema, 3)
  assert.equal(prepared.kind, 'router-promotion')
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
  wrongBackup.snapshots[0].backupKey =
    'biyan/updater/transactions/909-1/backups/policy.json'
  assert.throws(
    () => terminalPromotionRecoveryPlan({ ...args, journal: wrongBackup }),
    /not transaction-bound/
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
  assert.equal(
    classifyRemoteProbe({
      provider: 'oss',
      key: 'missing',
      exitCode: 1,
      stderr: [
        'Error: operation error HeadObject: Error returned by Service.',
        'Http Status Code: 404.',
        'Error Code: NoSuchKey.',
        'Request Id: 6A6AFD28FF8AE533309A16AA.',
        'Message: The specified key does not exist.',
      ].join('\n'),
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
      Header: {
        'Cache-Control': ['public, max-age=60, must-revalidate'],
        'Content-Type': ['application/json'],
        'X-Oss-Storage-Class': ['Standard'],
      },
    },
    acl: { acl: 'public-read' },
  }
  assert.equal(
    verifySnapshotReadback({
      snapshot: restorable,
      bytes,
      metadata: {
        Header: {
          'Cache-Control': ['public, max-age=60, must-revalidate'],
          'Content-Type': ['application/json'],
          'X-Oss-Storage-Class': ['Standard'],
        },
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
          Header: {
            'Cache-Control': ['no-store'],
            'Content-Type': ['application/json'],
            'X-Oss-Storage-Class': ['Standard'],
          },
        },
        acl: { objectAcl: 'public-read' },
      }),
    /metadata does not match/
  )
})


test('OSS ACL extraction matches pinned ossutil output and rejects schema drift', () => {
  const productionAcl = {
    AccessControlList: { Grant: 'default' },
    Owner: {
      DisplayName: 'test-owner',
      ID: 'test-owner',
    },
  }
  assert.equal(extractOssAcl(productionAcl), 'default')
  for (const legacy of [
    { acl: 'private' },
    { Acl: 'private' },
    { objectAcl: 'public-read' },
    { ObjectAcl: 'public-read' },
  ]) {
    assert.equal(extractOssAcl(legacy), Object.values(legacy)[0])
  }
  assert.equal(
    extractOssAcl({
      acl: 'default',
      AccessControlList: { Grant: 'default' },
    }),
    'default'
  )
  assert.throws(
    () =>
      extractOssAcl({
        acl: 'default',
        AccessControlList: { Grant: 'private' },
      }),
    /no unambiguous ACL/
  )
  assert.throws(
    () => extractOssAcl({ AccessControlList: { Grant: 'public-read-write' } }),
    /not safely restorable/
  )
  assert.throws(
    () => extractOssAcl({ AccessControlList: { grant: 'default' } }),
    /no unambiguous ACL/
  )
  assert.throws(
    () => extractOssAcl({ AccessControlList: { Grant: 1 } }),
    /non-string approved ACL field/
  )

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'biyan-oss-acl-'))
  try {
    const aclFile = path.join(temp, 'acl.json')
    fs.writeFileSync(
      aclFile,
      JSON.stringify(productionAcl, null, 2) + '\n'
    )
    const result = spawnSync(
      process.execPath,
      [
        path.join(repoRoot, 'scripts/updater/promotion-transaction.mjs'),
        'extract-oss-acl',
        '--acl',
        aclFile,
      ],
      { encoding: 'utf8' }
    )
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, 'default\n')
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
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
  assert.deepEqual(
    backupMetadataPlan({
      Header: {
        'Cache-Control': ['no-store'],
        'Content-Type': ['application/json'],
        'Content-Length': ['3468'],
        'X-Oss-Object-Type': ['Normal'],
        'X-Oss-Storage-Class': ['Standard'],
      },
    }),
    {
      contentType: 'application/json',
      cacheControl: 'no-store',
    }
  )
  assert.deepEqual(
    backupMetadataPlan({
      AcceptRanges: 'bytes',
      LastModified: '2026-07-30T08:41:28+00:00',
      ContentLength: 3468,
      ETag: '"089604107bc233cdf586d4afd8684f8e"',
      ChecksumCRC64NVME: 'pH9V8sO2EOo=',
      CacheControl: 'no-store',
      ContentType: 'application/json',
      Metadata: {},
    }),
    {
      contentType: 'application/json',
      cacheControl: 'no-store',
    }
  )
  assert.deepEqual(
    backupMetadataPlan({
      CacheControl: 'no-store',
      ContentType: 'application/json',
      Header: {
        'Cache-Control': ['no-store'],
        'Content-Type': ['application/json'],
      },
    }),
    {
      contentType: 'application/json',
      cacheControl: 'no-store',
    }
  )
  assert.deepEqual(
    backupMetadataPlan({
      Header: {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json',
      },
    }),
    {
      contentType: 'application/json',
      cacheControl: 'no-store',
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
    {
      Header: {
        'Cache-Control': ['no-store'],
        'Content-Type': ['application/json'],
        'X-Oss-Meta-Owner': ['release'],
      },
    },
    {
      Header: {
        'Cache-Control': ['no-store'],
        'Content-Type': ['application/json'],
        'x-oss-storage-class': ['Archive'],
      },
    },
    {
      Header: {
        'Cache-Control': ['no-store'],
        'Content-Type': ['application/json'],
        'X-Oss-Object-Type': ['Appendable'],
      },
    },
    {
      Header: {
        'Cache-Control': ['no-store'],
        'Content-Type': ['application/json'],
        'X-Amz-Meta-Owner': ['release'],
      },
    },
    {
      CacheControl: 'no-store',
      ContentType: 'application/json',
      'X-Oss-Meta-Owner': 'release',
    },
    {
      CacheControl: 'no-store',
      ContentType: 'application/json',
      METADATA: { owner: 'release' },
    },
  ]) {
    assert.throws(
      () => backupMetadataPlan(metadata),
      /unsupported backup fields/
    )
  }

  for (const metadata of [
    {
      Header: {
        'Cache-Control': [],
        'Content-Type': ['application/json'],
      },
    },
    {
      Header: {
        'Cache-Control': ['no-store', 'public, max-age=60'],
        'Content-Type': ['application/json'],
      },
    },
    {
      Header: {
        'Cache-Control': [['no-store']],
        'Content-Type': ['application/json'],
      },
    },
    {
      Header: {
        'Cache-Control': [true],
        'Content-Type': ['application/json'],
      },
    },
    {
      Header: {
        'Cache-Control': [''],
        'Content-Type': ['application/json'],
      },
    },
  ]) {
    assert.throws(
      () => backupMetadataPlan(metadata),
      /nonempty string or one-element nonempty string array/
    )
  }

  assert.throws(
    () =>
      backupMetadataPlan({
        CacheControl: 'public, max-age=60',
        ContentType: 'application/json',
        Header: {
          'Cache-Control': ['no-store'],
          'Content-Type': ['application/json'],
        },
      }),
    /conflicting cachecontrol values/
  )

  for (const metadata of [
    {
      Header: {
        Cache___Control: ['no-store'],
        'Content-Type': ['application/json'],
      },
    },
    {
      'Cache-Control': ['no-store'],
      'Content-Type': ['application/json'],
    },
    {
      Header: {
        Header: {
          'Cache-Control': ['no-store'],
          'Content-Type': ['application/json'],
        },
      },
    },
  ]) {
    assert.throws(
      () => backupMetadataPlan(metadata),
      /unsupported/
    )
  }

  assert.throws(
    () =>
      backupMetadataPlan({
        CacheControl: 123,
        ContentType: 'application/json',
      }),
    /must be a nonempty string/
  )

  for (const metadata of [
    {
      Header: {
        'Cache-Control': ['no-store'],
        'Content-Type': ['application/json'],
        'X-Oss-Website-Redirect-Location': ['/legacy'],
      },
    },
    {
      Header: {
        'Cache-Control': ['no-store'],
        'Content-Type': ['application/json'],
        'X-Oss-Server-Side-Encryption': ['AES256'],
      },
    },
    {
      Header: {
        'Cache-Control': ['no-store'],
        'Content-Type': ['application/json'],
        'X-Oss-Object-Lock-Retain-Until-Date': [
          '2026-08-01T00:00:00Z',
        ],
      },
    },
    {
      CacheControl: 'no-store',
      ContentType: 'application/json',
      WebsiteRedirectLocation: '/legacy',
    },
    {
      CacheControl: 'no-store',
      ContentType: 'application/json',
      ServerSideEncryption: 'AES256',
    },
    {
      CacheControl: 'no-store',
      ContentType: 'application/json',
      'Content-Encodingg': 'gzip',
    },
    {
      CacheControl: 'no-store',
      ContentType: 'application/json',
      UserMetadata: {},
    },
  ]) {
    assert.throws(
      () => backupMetadataPlan(metadata),
      /unsupported field/
    )
  }
})

test('metadata CLI accepts the pinned ossutil 2.3.0 Header envelope', () => {
  const temp = fs.mkdtempSync(
    path.join(os.tmpdir(), 'biyan-oss-metadata-')
  )
  try {
    const metadataFile = path.join(temp, 'metadata.json')
    const outputFile = path.join(temp, 'plan.json')
    fs.writeFileSync(
      metadataFile,
      `${JSON.stringify({
        Header: {
          'Accept-Ranges': ['bytes'],
          'Cache-Control': ['no-store'],
          Connection: ['keep-alive'],
          'Content-Length': ['3468'],
          'Content-Md5': ['CJYEEHvCM831htSv2GhPjg=='],
          'Content-Type': ['application/json'],
          Date: ['Thu, 30 Jul 2026 08:41:33 GMT'],
          Etag: ['"089604107BC233CDF586D4AFD8684F8E"'],
          'Last-Modified': ['Thu, 30 Jul 2026 08:41:29 GMT'],
          Server: ['AliyunOSS'],
          Vary: ['Accept-Encoding'],
          'X-Oss-Hash-Crc64ecma': ['10175078662113262299'],
          'X-Oss-Object-Type': ['Normal'],
          'X-Oss-Request-Id': ['6A6B0E3DF9028F363769D727'],
          'X-Oss-Server-Time': ['57'],
          'X-Oss-Storage-Class': ['Standard'],
        },
      }, null, 2)}\n`
    )
    const result = spawnSync(
      process.execPath,
      [
        path.join(repoRoot, 'scripts/updater/promotion-transaction.mjs'),
        'backup-metadata-plan',
        '--metadata',
        metadataFile,
        '--output',
        outputFile,
      ],
      { encoding: 'utf8' }
    )
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(fs.readFileSync(outputFile, 'utf8')), {
      contentType: 'application/json',
      cacheControl: 'no-store',
    })
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
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


test('journal validates policy backup metadata and immutable ledger', () => {
  const prepared = journal()
  assert.equal(validateJournal(prepared).state, 'prepared')
  const unsafeSnapshots = structuredClone(prepared.snapshots)
  unsafeSnapshots[0].metadata = {
    Header: {
      'Cache-Control': ['no-store'],
      'Content-Type': ['application/json'],
      'X-Amz-Meta-Owner': ['release'],
    },
  }
  assert.throws(
    () =>
      createJournal({
        runId: '123',
        runAttempt: '1',
        targetTag: 'v0.6.643',
        targetVersion: '0.6.643',
        sourceCommit,
        nextPolicyBytes: Buffer.from('{"currentVersion":"0.6.643"}\n'),
        createdAt: '2026-07-24T00:00:00.000Z',
        snapshots: unsafeSnapshots,
      }),
    /unsupported backup fields/
  )
  assert.throws(
    () =>
      createJournal({
        runId: '123',
        runAttempt: '1',
        targetTag: 'v0.6.643',
        targetVersion: '0.6.643',
        sourceCommit,
        nextPolicyBytes: Buffer.from('{"currentVersion":"0.6.643"}\n'),
        createdAt: '2026-07-24T00:00:00.000Z',
        snapshots: [
          ...prepared.snapshots,
          snapshot('oss', 'mita/latest.json'),
        ],
      }),
    /snapshot only the mutable policy/
  )

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
      advanceJournal(committing, {
        state: 'prepared',
        checkpoint: 'rewind',
        updatedAt: '2026-07-24T00:02:00.000Z',
      }),
    /Invalid promotion journal transition/
  )
})

test('split nonterminal recovery accepts only one exact journal successor', () => {
  const prepared = journal()
  const committing = advanceJournal(prepared, {
    state: 'committing',
    checkpoint: 'before-immutable-write',
    immutableEntry: {
      provider: 'oss',
      key: 'biyan/updater/releases/v0.6.643/Biyan.app.tar.gz',
      sha256: sha('f'),
      contentType: 'application/octet-stream',
      cacheControl: 'public, max-age=31536000, immutable',
      createdByTransaction: true,
      verified: false,
    },
    updatedAt: '2026-07-24T00:01:00.000Z',
  })
  const resolved = resolveSplitNonterminalJournal({
    r2Open: committing,
    ossOpen: prepared,
  })
  assert.equal(resolved.transactionId, '123-1')
  assert.equal(resolved.previousProvider, 'oss')
  assert.equal(resolved.canonicalProvider, 'r2')
  assert.deepEqual(resolved.previous, prepared)
  assert.deepEqual(resolved.canonical, committing)

  assert.throws(
    () =>
      resolveSplitNonterminalJournal({
        r2Open: committing,
        ossOpen: structuredClone(committing),
      }),
    /different sequences/
  )
  const unsafe = structuredClone(committing)
  unsafe.sequence += 1
  assert.throws(
    () => resolveSplitNonterminalJournal({ r2Open: unsafe, ossOpen: prepared }),
    /differ by exactly one sequence/
  )
  const other = createJournal({
    runId: '124',
    runAttempt: '1',
    targetTag: 'v0.6.643',
    targetVersion: '0.6.643',
    sourceCommit,
    nextPolicyBytes: Buffer.from('{"currentVersion":"0.6.643"}\n'),
    createdAt: '2026-07-24T00:00:00.000Z',
    snapshots: [
      {
        ...prepared.snapshots[0],
        backupKey:
          'biyan/updater/transactions/124-1/backups/policy.json',
      },
    ],
  })
  assert.throws(
    () => resolveSplitNonterminalJournal({ r2Open: committing, ossOpen: other }),
    /do not share a transaction identity/
  )
})

test('unified nonterminal recovery accepts only an exact recoverable journal', () => {
  const committing = advanceJournal(journal(), {
    state: 'committing',
    checkpoint: 'before-immutable-write',
    updatedAt: '2026-07-24T00:01:00.000Z',
  })
  const resolved = resolveUnifiedNonterminalJournal({
    r2Open: committing,
    ossOpen: structuredClone(committing),
  })
  assert.equal(resolved.transactionId, '123-1')
  assert.equal(resolved.canonicalProvider, 'both')
  assert.deepEqual(resolved.canonical, committing)

  const drift = structuredClone(committing)
  drift.checkpoints.at(-1).name = 'drift'
  assert.throws(
    () =>
      resolveUnifiedNonterminalJournal({
        r2Open: committing,
        ossOpen: drift,
      }),
    /must be exactly equal/
  )
  const terminal = advanceJournal(committing, {
    state: 'committed',
    checkpoint: 'done',
    updatedAt: '2026-07-24T00:02:00.000Z',
  })
  assert.throws(
    () =>
      resolveUnifiedNonterminalJournal({
        r2Open: terminal,
        ossOpen: structuredClone(terminal),
      }),
    /must require nonterminal recovery/
  )
})

test('split nonterminal resolver requires both clouds to retain exact history bytes', () => {
  const prepared = journal()
  const committing = advanceJournal(prepared, {
    state: 'committing',
    checkpoint: 'before-immutable-write',
    updatedAt: '2026-07-24T00:01:00.000Z',
  })
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'updater-split-history-'))
  const write = (name, value) => {
    const file = path.join(temp, name)
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
    return file
  }
  const paths = {
    r2Open: write('open-r2.json', committing),
    ossOpen: write('open-oss.json', prepared),
    r2OpenHistoryR2: write('history-r2-r2.json', committing),
    r2OpenHistoryOss: write('history-r2-oss.json', committing),
    ossOpenHistoryR2: write('history-oss-r2.json', prepared),
    ossOpenHistoryOss: write('history-oss-oss.json', prepared),
    canonical: path.join(temp, 'canonical.json'),
    previous: path.join(temp, 'previous.json'),
    output: path.join(temp, 'plan.json'),
  }
  const args = () => [
    'scripts/updater/promotion-transaction.mjs',
    'resolve-split-nonterminal-journal',
    '--r2-open',
    paths.r2Open,
    '--oss-open',
    paths.ossOpen,
    '--r2-open-history-r2',
    paths.r2OpenHistoryR2,
    '--r2-open-history-oss',
    paths.r2OpenHistoryOss,
    '--oss-open-history-r2',
    paths.ossOpenHistoryR2,
    '--oss-open-history-oss',
    paths.ossOpenHistoryOss,
    '--canonical-output',
    paths.canonical,
    '--previous-output',
    paths.previous,
    '--output',
    paths.output,
  ]
  try {
    const resolved = spawnSync(process.execPath, args(), {
      cwd: repoRoot,
      encoding: 'utf8',
    })
    assert.equal(resolved.status, 0, resolved.stderr)
    assert.deepEqual(JSON.parse(fs.readFileSync(paths.canonical, 'utf8')), committing)
    assert.deepEqual(JSON.parse(fs.readFileSync(paths.previous, 'utf8')), prepared)
    assert.deepEqual(JSON.parse(fs.readFileSync(paths.output, 'utf8')), {
      schema: 1,
      status: 'validated-split-nonterminal',
      transactionId: '123-1',
      previous: { provider: 'oss', sequence: 0, state: 'prepared' },
      canonical: { provider: 'r2', sequence: 1, state: 'committing' },
    })

    for (const file of [
      paths.r2Open,
      paths.ossOpen,
      paths.r2OpenHistoryR2,
      paths.r2OpenHistoryOss,
      paths.ossOpenHistoryR2,
      paths.ossOpenHistoryOss,
    ]) {
      fs.writeFileSync(file, `${JSON.stringify(committing, null, 2)}\n`)
    }
    const unified = spawnSync(process.execPath, args(), {
      cwd: repoRoot,
      encoding: 'utf8',
    })
    assert.equal(unified.status, 0, unified.stderr)
    assert.deepEqual(JSON.parse(fs.readFileSync(paths.output, 'utf8')), {
      schema: 1,
      status: 'validated-unified-nonterminal',
      transactionId: '123-1',
      canonical: { provider: 'both', sequence: 1, state: 'committing' },
    })
    assert.deepEqual(JSON.parse(fs.readFileSync(paths.canonical, 'utf8')), committing)
    assert.deepEqual(JSON.parse(fs.readFileSync(paths.previous, 'utf8')), committing)

    fs.writeFileSync(paths.r2OpenHistoryOss, '{"drift":true}\n')
    const drift = spawnSync(process.execPath, args(), {
      cwd: repoRoot,
      encoding: 'utf8',
    })
    assert.notEqual(drift.status, 0)
    assert.match(drift.stderr, /does not exactly match its open journal/)
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
})


test('recovery commands restore policy and clean only verified immutable objects', () => {
  let committing = advanceJournal(journal(), {
    state: 'committing',
    checkpoint: 'verified-oss-ledger',
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
  committing = advanceJournal(committing, {
    state: 'committing',
    checkpoint: 'verified-r2-ledger',
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
    '# RECOVERY MUTATIONS BEGIN: mark the durable journal first.'
  )
  assert.ok(mutationBoundary > 0)
  const classification = commands.slice(0, mutationBoundary)
  const mutations = commands.slice(mutationBoundary)

  assert.match(classification, /set -euo pipefail/)
  assert.match(classification, /validate-journal/)
  assert.match(classification, /verify-snapshot-readback/)
  assert.match(classification, /validate-frozen-legacy/)
  assert.match(classification, /classify-policy-rollback/)
  assert.match(classification, /ledger-0/)
  assert.match(classification, /ledger-1/)
  assert.match(
    classification,
    /cmp "\$JOURNAL" recovery-readback\/live\/open-r2\.json/
  )
  assert.match(
    mutations,
    /--body recovery-readback\/backups\/policy\.json[\s\S]*--if-match "\$policy_etag"/
  )
  assert.match(mutations, /delete-object --bucket "\$ALIYUN_OSS_BUCKET"/)
  assert.match(mutations, /delete-object --bucket "\$CLOUDFLARE_R2_BUCKET"/)
  assert.match(mutations, /validate-frozen-legacy/)
  assert.match(mutations, /router-policy-restored/)
  assert.match(mutations, /persist_recovery_journal/)
  for (const line of commands.split('\n')) {
    if (!/mita\/latest\.json|legacy_key/.test(line)) continue
    assert.doesNotMatch(
      line,
      /put-object|delete-object|RefreshObjectCaches|purge/
    )
  }
  assert.doesNotMatch(commands, /\bgh release edit\b|--draft/)
  assert.doesNotMatch(commands, /RefreshObjectCaches|poll-url/)
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


test('recovery leaves the published release and frozen handoff immutable', () => {
  const committing = advanceJournal(journal(), {
    state: 'committing',
    checkpoint: 'before-policy-write',
    updatedAt: '2026-07-24T00:01:00.000Z',
  })
  const commands = recoveryCommands(committing)
  assert.doesNotMatch(commands, /\bgh release edit\b|--draft/)
  assert.match(commands, /verify-snapshot-readback/)
  assert.match(commands, /validate-frozen-legacy/)
  assert.doesNotMatch(commands, /RefreshObjectCaches|poll-url/)
})


test('recovery fails closed when an unverified immutable create intent exists', () => {
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
  const commands = recoveryCommands(unverified)
  const unverifiedProbe = commands.indexOf(
    "probe_oss_recovery 'biyan/updater/releases/v0.6.643/unverified.tar.gz' unverified-0"
  )
  const absentProof = commands.indexOf(
    'recovery-readback/probes/unverified-0.json',
    unverifiedProbe
  )
  const mutationBoundary = commands.indexOf(
    '# RECOVERY MUTATIONS BEGIN: mark the durable journal first.'
  )
  assert.ok(
    unverifiedProbe >= 0
      && unverifiedProbe < absentProof
      && absentProof < mutationBoundary
  )
  assert.match(
    commands.slice(unverifiedProbe, mutationBoundary),
    /\.state == "absent"/
  )
  assert.doesNotMatch(
    commands.slice(unverifiedProbe, mutationBoundary),
    /delete-object/
  )
})


test('recovery pairs an immutable create intent only with a later exact verification', () => {
  const intent = {
    provider: 'oss',
    key: 'biyan/updater/releases/v0.6.643/paired.tar.gz',
    sha256: sha('f'),
    contentType: 'application/octet-stream',
    cacheControl: 'public, max-age=31536000, immutable',
    createdByTransaction: true,
    verified: false,
  }
  const withIntent = advanceJournal(journal(), {
    state: 'committing',
    checkpoint: 'immutable-create-intent',
    immutableEntry: intent,
    updatedAt: '2026-07-24T00:01:00.000Z',
  })
  const withExactVerification = advanceJournal(withIntent, {
    state: 'rollback-required',
    checkpoint: 'immutable-create-verified',
    immutableEntry: { ...intent, verified: true },
    updatedAt: '2026-07-24T00:02:00.000Z',
  })
  const exactCommands = recoveryCommands(withExactVerification)
  assert.match(exactCommands, /probe_oss_recovery[\s\S]*'ledger-0'/)
  assert.doesNotMatch(exactCommands, /unverified-0/)

  const withMismatchedVerification = advanceJournal(withIntent, {
    state: 'rollback-required',
    checkpoint: 'immutable-create-mismatched',
    immutableEntry: {
      ...intent,
      sha256: sha('e'),
      verified: true,
    },
    updatedAt: '2026-07-24T00:02:00.000Z',
  })
  const mismatchedCommands = recoveryCommands(withMismatchedVerification)
  assert.match(mismatchedCommands, /unverified-0/)
  assert.match(mismatchedCommands, /'ledger-0'/)
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


test('transaction runners preflight the exact AWS conditional inputs they use', () => {
  const promotion = readText(
    path.join(repoRoot, 'scripts/updater/run-promotion-transaction.sh')
  )
  const functionStart = promotion.indexOf(
    'assert_aws_conditional_capabilities() {'
  )
  const callLine = '\nassert_aws_conditional_capabilities\n'
  const callStart = promotion.indexOf(callLine, functionStart)
  const block = promotion.slice(
    functionStart,
    callStart + callLine.length
  )
  const firstMutation = promotion.indexOf(
    'aws s3api put-object --bucket',
    callStart
  )
  assert.ok(
    functionStart >= 0
      && callStart > functionStart
      && callStart < firstMutation
  )
  assert.match(block, /put-object --generate-cli-skeleton input/)
  assert.match(block, /delete-object --generate-cli-skeleton input/)
  assert.match(block, /IfMatch[\s\S]*IfNoneMatch/)

  const pause = readText(
    path.join(repoRoot, 'scripts/updater/run-router-pause-transaction.sh')
  )
  const pausePreflight = pause.indexOf(
    'put_skeleton="$(aws s3api put-object --generate-cli-skeleton input)"'
  )
  const pauseWrite = pause.indexOf('policy_write_attempted=true')
  assert.ok(pausePreflight >= 0 && pausePreflight < pauseWrite)
  assert.match(
    pause.slice(pausePreflight, pauseWrite),
    /has\("IfMatch"\)/
  )
  assert.doesNotMatch(
    pause.slice(pausePreflight, pauseWrite),
    /delete-object --generate-cli-skeleton/
  )
})


test('probe helpers preserve caller errexit mode', () => {
  for (const runnerName of [
    'run-promotion-transaction.sh',
    'run-router-pause-transaction.sh',
  ]) {
    const source = readText(
      path.join(repoRoot, 'scripts/updater', runnerName)
    )
    const probe = shellFunction(source, 'probe_r2')
    assert.match(probe, /if aws s3api head-object/)
    assert.match(probe, /then[\s\S]*rc=0[\s\S]*else[\s\S]*rc=\$\?/)
    assert.match(probe, /promotion-transaction\.mjs classify-probe/)
    assert.doesNotMatch(probe, /set [+-]e/)
  }
})


test('promotion open-journal cleanup supports a single surviving replica', () => {
  const source = readText(
    path.join(repoRoot, 'scripts/updater/run-promotion-transaction.sh')
  )
  const cleanup = shellFunction(source, 'delete_open_journal')
  assert.match(cleanup, /open-journal-r2-predelete/)
  assert.match(cleanup, /open-journal-oss-predelete/)
  assert.match(cleanup, /r2_delete_needed=false/)
  assert.match(cleanup, /oss_delete_needed=false/)
  assert.match(cleanup, /if \[\[ "\$r2_delete_needed" == true \]\]/)
  assert.match(cleanup, /if \[\[ "\$oss_delete_needed" == true \]\]/)
  assert.match(cleanup, /cmp "\$journal"/)
  assert.match(cleanup, /--if-match "\$open_journal_etag"/)
})


test('generated ledger cleanup targets only verified immutable entries', () => {
  const ledgerBytes = Buffer.from('transaction-created-ledger-object\n')
  const ledgerSha = createHash('sha256').update(ledgerBytes).digest('hex')
  let withLedger = advanceJournal(journal(), {
    state: 'committing',
    checkpoint: 'verified-oss-ledger',
    immutableEntry: {
      provider: 'oss',
      key: 'biyan/updater/releases/v0.6.643/ledger-object',
      sha256: ledgerSha,
      contentType: 'application/octet-stream',
      cacheControl: 'public, max-age=31536000, immutable',
      createdByTransaction: true,
      verified: true,
    },
    updatedAt: '2026-07-24T00:01:00.000Z',
  })
  withLedger = advanceJournal(withLedger, {
    state: 'committing',
    checkpoint: 'verified-r2-ledger',
    immutableEntry: {
      provider: 'r2',
      key: 'biyan/updater/releases/v0.6.643/already-deleted',
      sha256: ledgerSha,
      contentType: 'application/octet-stream',
      cacheControl: 'public, max-age=31536000, immutable',
      createdByTransaction: true,
      verified: true,
    },
    updatedAt: '2026-07-24T00:02:00.000Z',
  })
  const commands = recoveryCommands(withLedger)
  const boundary = commands.indexOf(
    '# RECOVERY MUTATIONS BEGIN: mark the durable journal first.'
  )
  assert.ok(boundary > 0)
  assert.match(commands.slice(0, boundary), /ledger-0/)
  assert.match(commands.slice(0, boundary), /ledger-1/)
  assert.match(
    commands.slice(0, boundary),
    /ledger_state[\s\S]*if \[\[ "\$ledger_state" == exists \]\][\s\S]*test "\$ledger_state" = absent/
  )
  assert.match(
    commands.slice(boundary),
    /initial_ledger_state[\s\S]*predelete_ledger_state[\s\S]*test "\$predelete_ledger_state" = absent/
  )
  assert.match(commands.slice(boundary), /deleted-0/)
  assert.match(commands.slice(boundary), /deleted-1/)
  assert.match(commands.slice(boundary), /--if-match "\$ledger_etag"/)
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

  const deleteFunction = shellFunction(runner, 'delete_open_journal')
  assert.match(deleteFunction, /open-journal-r2-predelete/)
  assert.match(deleteFunction, /open-journal-oss-predelete/)
  assert.match(deleteFunction, /cmp "\$journal"/)
  assert.match(deleteFunction, /\.transactionId/)
  assert.match(deleteFunction, /--if-match "\$open_journal_etag"/)
  assert.equal(
    runner.match(/^\s*delete_open_journal(?: \|\| rollback_failed=1)?$/gm)
      ?.length,
    3
  )
})


test('mutable OSS journals omit the overwrite guard while immutable journals keep it', () => {
  const runner = readText(
    path.join(repoRoot, 'scripts/updater/run-promotion-transaction.sh')
  )
  const putOssJson = shellFunction(runner, 'put_oss_json')
  assert.match(putOssJson, /overwrite="\$\{3:-true\}"/)
  assert.match(
    putOssJson,
    /if \[\[ "\$overwrite" != true \]\]; then args\+\=\(--forbid-overwrite true\)/
  )
  assert.doesNotMatch(
    putOssJson.slice(
      0,
      putOssJson.indexOf('if [[ "$overwrite" != true ]]')
    ),
    /--forbid-overwrite/
  )
})


test('the only mutable snapshot is a create-only verified policy backup', () => {
  const runner = readText(
    path.join(repoRoot, 'scripts/updater/run-promotion-transaction.sh')
  )
  const r2Start = runner.indexOf('publish_snapshot_backup_r2()')
  const executionStart = runner.indexOf(
    'node scripts/updater/promotion-transaction.mjs create-journal'
  )
  const writeFlags = runner.indexOf('policy_write_attempted=false')
  assert.ok(
    r2Start >= 0
      && r2Start < executionStart
      && executionStart < writeFlags
  )
  const r2Backup = runner.slice(
    r2Start,
    runner.indexOf('publish_snapshot_backup_oss()', r2Start)
  )
  assert.match(r2Backup, /--if-none-match '\*'/)
  assert.match(r2Backup, /s3api get-object/)
  assert.match(r2Backup, /verify-snapshot-readback/)

  const backupCalls = runner.slice(executionStart, writeFlags)
  assert.match(backupCalls, /publish_snapshot_backup_r2 0/)
  assert.doesNotMatch(backupCalls, /publish_snapshot_backup_oss/)
  assert.doesNotMatch(backupCalls, /publish_snapshot_backup_r2 [12]/)
  assert.match(backupCalls, /backup-metadata-plan/)
})


test('legacy handoff is read-only across promotion and rollback', () => {
  const runner = readText(
    path.join(repoRoot, 'scripts/updater/run-promotion-transaction.sh')
  )
  const firstInvariant = runner.indexOf('validate-frozen-legacy')
  const policyWrite = runner.indexOf(
    'advance_journal committing before-policy-write'
  )
  const finalInvariant = runner.lastIndexOf('validate-frozen-legacy')
  assert.ok(
    firstInvariant >= 0
      && firstInvariant < policyWrite
      && policyWrite < finalInvariant
  )
  assert.doesNotMatch(runner, /legacy_(?:oss|r2)_write_attempted/)
  assert.doesNotMatch(runner, /before-legacy-dual-write/)
  assert.doesNotMatch(runner, /RefreshObjectCaches|purge_legacy/)
  for (const line of runner.split('\n')) {
    if (!/legacy_(?:aliyun|r2)_key/.test(line)) continue
    assert.doesNotMatch(line, /put-object|delete-object/)
  }
})


test('Router-only pause proves state before mutation and after pause', () => {
  const runner = readText(
    path.join(repoRoot, 'scripts/updater/run-router-pause-transaction.sh')
  )
  const openLock = runner.indexOf(
    'probe_r2 "$OPEN_TRANSACTION_KEY" open-transaction'
  )
  const preProbe = runner.indexOf('probe_router before')
  const transitionProof = runner.indexOf(
    'router-pause-transaction.mjs validate-policy'
  )
  const firstWrite = runner.indexOf('policy_write_attempted=true')
  const postProbe = runner.indexOf('probe_router after')
  const postProof = runner.indexOf(
    'router-pause-transaction.mjs validate-router-probe',
    postProbe
  )
  assert.ok(
    openLock >= 0
      && openLock < preProbe
      && preProbe < transitionProof
      && transitionProof < firstWrite
      && firstWrite < postProbe
      && postProbe < postProof
  )
  assert.match(
    runner.slice(firstWrite, postProbe),
    /--if-match "\$policy_before_etag"/
  )
  const failureHandler = runner.slice(
    runner.indexOf('fail_closed() {'),
    runner.indexOf('trap fail_closed ERR INT TERM')
  )
  assert.match(failureHandler, /fetch_policy failure-observed/)
  assert.match(failureHandler, /status=paused-unverified/)
  assert.match(failureHandler, /automaticResumeAttempted:false/)
  assert.doesNotMatch(failureHandler, /classify-policy-rollback/)
  assert.doesNotMatch(
    failureHandler,
    /--body "\$\{state_dir\}\/before-policy\.json"/
  )
  assert.doesNotMatch(failureHandler, /probe_router rollback/)
  assert.doesNotMatch(runner, /ALIYUN|OSS|mita\/latest|legacy/i)
})


test('promotion core carries fail-closed Router transaction controls', () => {
  const preparePromotionSource = readText(
    path.join(repoRoot, 'scripts/updater/prepare-promotion.mjs')
  )
  const runner = readText(
    path.join(repoRoot, 'scripts/updater/run-promotion-transaction.sh')
  )
  const pauseRunner = readText(
    path.join(repoRoot, 'scripts/updater/run-router-pause-transaction.sh')
  )
  const promotionTransaction = readText(
    path.join(repoRoot, 'scripts/updater/promotion-transaction.mjs')
  )

  assert.match(
    preparePromotionSource,
    /currentPolicy\.legacyBridgeVersion != null[\s\S]*next\.legacyBridgeVersion = currentPolicy\.legacyBridgeVersion/
  )
  assert.match(runner, /: "\$\{OPEN_TRANSACTION_KEY:\?\}"/)
  assert.match(runner, /promotion-transaction\.mjs classify-probe/)
  assert.match(runner, /validate-frozen-legacy/)
  assert.match(runner, /--if-match "\$policy_original_etag"/)
  assert.match(runner, /--if-none-match '\*'/)
  assert.match(runner, /classify-policy-rollback/)
  assert.doesNotMatch(runner, /legacy-pause-transaction/)
  assert.doesNotMatch(runner, /RefreshObjectCaches|purge_legacy/)
  assert.match(
    promotionTransaction,
    /schema: 3,[\s\S]*kind: 'router-promotion'/
  )
  assert.match(
    promotionTransaction,
    /Router promotion must snapshot only the mutable policy/
  )
  assert.match(pauseRunner, /promotion-transaction\.mjs classify-probe/)
  assert.match(pauseRunner, /router-pause-transaction\.mjs prepare/)
  assert.match(pauseRunner, /--if-match "\$policy_before_etag"/)
  assert.doesNotMatch(pauseRunner, /ALIYUN|OSS|mita\/latest|legacy/i)
})

test('every machine-readable ossutil API call suppresses the human elapsed trailer', () => {
  const roots = [
    path.join(repoRoot, '.github/workflows'),
    path.join(repoRoot, 'scripts/updater'),
  ]
  const discovered = []
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__') visit(absolute)
        continue
      }
      if (!/\.(?:mjs|sh|ya?ml)$/.test(entry.name)) continue
      const source = readText(absolute)
      if (source.includes('ossutil api')) {
        // Keep the checked-in policy envelope platform-neutral: Windows emits
        // backslashes here, while the allowlist intentionally uses Git paths.
        discovered.push(path.relative(repoRoot, absolute).split(path.sep).join('/'))
      }
    }
  }
  for (const root of roots) visit(root)
  assert.deepEqual(discovered.sort(), [
    '.github/workflows/biyan-a-canary.yml',
    '.github/workflows/promote-desktop-update.yml',
    'scripts/updater/promotion-transaction.mjs',
    'scripts/updater/run-promotion-transaction.sh',
  ])

  let commandCount = 0
  for (const relative of discovered) {
    const lines = readText(path.join(repoRoot, relative)).split('\n')
    for (let index = 0; index < lines.length; index += 1) {
      if (!lines[index].includes('ossutil api')) continue
      commandCount += 1
      let command = lines[index]
      while (lines[index].trimEnd().endsWith('\\')) {
        index += 1
        command += `\n${lines[index]}`
      }
      assert.match(command, /--output-format json/, relative)
      assert.match(command, /--quiet/, relative)
    }
  }
  // The retired legacy writer removes its OSS mutation/probe envelope. Keep
  // the remaining promotion-journal command count locked so no machine-readable
  // OSS invocation can bypass JSON/quiet unnoticed.
  assert.equal(commandCount, 32)
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
  const stepRange = (source, startName, endName) => {
    const start = source.indexOf(`- name: ${startName}`)
    const end = source.indexOf(`- name: ${endName}`, start)
    assert.ok(start >= 0, `missing workflow step: ${startName}`)
    assert.ok(end > start, `missing workflow step after ${startName}: ${endName}`)
    return source.slice(start, end)
  }

  const promotion = workflow('promote-desktop-update.yml')
  const recovery = workflow('recover-split-updater-transaction.yml')
  const health = workflow('updater-health-gate.yml')
  const kill = workflow('updater-kill-switch.yml')
  for (const source of [promotion, health, kill]) {
    assert.doesNotMatch(jobEnvironment(source), /secrets\./)
  }

  for (const source of [promotion, recovery, health, kill]) {
    assert.equal(
      count(source, /secrets\.CLOUDFLARE_API_TOKEN/g),
      0,
      'updater transactions must converge by exact polling without a broad Cloudflare cache token'
    )
    assert.equal(count(source, /secrets\.CLOUDFLARE_ZONE_ID/g), 0)
  }
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
    stepRange(
      health,
      'Evaluate fail-closed health thresholds',
      'Pause Router policy when a threshold is breached'
    ),
    /secrets\./
  )
  assert.equal(count(health, /secrets\.BIYAN_SIGNING_KEY/g), 1)
  assert.doesNotMatch(
    stepRange(
      kill,
      'Check out trusted policy writer',
      'Apply fail-closed Router policy pause transaction'
    ),
    /secrets\./
  )
  assert.equal(count(kill, /secrets\.BIYAN_SIGNING_KEY/g), 1)
})
