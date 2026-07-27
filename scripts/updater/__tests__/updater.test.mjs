import assert from 'node:assert/strict'
import { createHmac, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { buildCandidate } from '../build-candidate.mjs'
import { validateCanonicalUpdaterCandidateMetadata } from '../candidate-url-policy.mjs'
import { evaluateRolloutHealth } from '../evaluate-rollout-health.mjs'
import { initialPolicy, preparePromotion } from '../prepare-promotion.mjs'
import { handleRequest } from '../worker.mjs'

const signingKey = 'test-biyan-signing-key'
const sourceCommit = '0123456789abcdef0123456789abcdef01234567'
const smokeScenarios = {
  A: ['current-to-a'],
  B: ['a-to-b', 'current-to-b'],
  C: ['current-to-a-to-b-to-c', 'current-to-c', 'a-to-c', 'b-to-c', 'fresh-c'],
  RECOVERY: ['source-to-recovery'],
}

function promote(options, evidenceOverrides = {}) {
  const migrationPhase = options.candidate.migrationPhase
    ?? (options.phase === 'RECOVERY' ? 'C' : options.phase)
  const candidate = {
    sourceCommit,
    migrationPhase,
    dataSchema: { A: 1, B: 2, C: 3 }[migrationPhase],
    ...options.candidate,
  }
  const smokeEvidence = {
    status: 'passed',
    candidateTag: candidate.tag,
    sourceCommit: candidate.sourceCommit,
    platforms: ['windows', 'macos', 'linux'],
    scenarios: smokeScenarios[options.phase],
    canaryStartedAt: new Date(Date.parse(options.promotedAt) - 48 * 60 * 60 * 1000).toISOString(),
    completedAt: options.promotedAt,
    sha256: 'a'.repeat(64),
    ...evidenceOverrides.smoke,
  }
  const healthEvidence = {
    status: 'healthy',
    p0Incidents: 0,
    p1Incidents: 0,
    dataLossIncidents: 0,
    migrationFailureRate: 0,
    observedAt: options.promotedAt,
    sha256: 'b'.repeat(64),
    ...evidenceOverrides.health,
  }
  return preparePromotion({ ...options, candidate, smokeEvidence, healthEvidence })
}

function signedRequest(pathname, currentVersion = '0.6.634', session = 'stable-install-id-1234') {
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const nonce = randomBytes(32).toString('hex')
  const token = createHmac('sha256', signingKey)
    .update(`${session}:${timestamp}:${nonce}`)
    .digest('hex')
  return new Request(`https://updates.mita.so${pathname}`, {
    headers: {
      'X-Client-Session': session,
      'X-Request-Token': token,
      'X-Request-Time': timestamp,
      'X-Request-Id': nonce,
      'X-Client-Version': currentVersion,
    },
  })
}

function bucket(entries) {
  return {
    async get(key) {
      if (!(key in entries)) return null
      return { async json() { return structuredClone(entries[key]) } }
    },
  }
}

test('candidate builder emits Biyan-only immutable assets and canonical manifest', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'biyan-updater-'))
  const source = path.join(root, 'source')
  const output = path.join(root, 'output')
  fs.mkdirSync(source)
  fs.writeFileSync(path.join(source, 'Biyan.app.tar.gz'), 'mac')
  fs.writeFileSync(path.join(source, 'Biyan.app.tar.gz.sig'), 'mac-signature')
  fs.writeFileSync(path.join(source, 'Biyan_0.6.637_x64-setup.exe'), 'windows')
  fs.writeFileSync(path.join(source, 'Biyan_0.6.637_x64-setup.exe.sig'), 'windows-signature')
  fs.writeFileSync(path.join(source, 'Biyan_0.6.637_amd64.AppImage'), 'linux')
  fs.writeFileSync(path.join(source, 'Biyan_0.6.637_amd64.AppImage.sig'), 'linux-signature')
  fs.writeFileSync(path.join(source, 'Biyan_0.6.637_universal.dmg'), 'mac-dmg')
  fs.writeFileSync(path.join(source, 'Biyan_0.6.637_x64_en-US.msi'), 'windows-msi')
  fs.writeFileSync(path.join(source, 'Biyan_0.6.637_amd64.deb'), 'linux-deb')

  const candidate = buildCandidate({
    version: '0.6.637',
    artifactsDir: source,
    outputDir: output,
    assetBaseUrl: 'https://static.mitapp.cn',
    publishedAt: '2026-07-14T00:00:00Z',
    sourceCommit: '0123456789abcdef0123456789abcdef01234567',
    migrationPhase: 'A',
    dataSchema: 1,
  })
  assert.equal(candidate.manifestKey, 'biyan/updater/releases/v0.6.637/latest.json')
  assert.equal(candidate.sourceCommit, sourceCommit)
  assert.equal(candidate.dataSchema, 1)
  assert.deepEqual(
    Object.keys(candidate.distributionAssets).sort(),
    ['linuxAppImage', 'linuxDeb', 'macosDmg', 'windowsExe', 'windowsMsi'],
  )
  assert.match(fs.readFileSync(path.join(output, 'latest.json'), 'utf8'), /Biyan_0\.6\.637/)

  const wrongAssetOrigin = structuredClone(candidate)
  wrongAssetOrigin.assets[0].url =
    'https://evil.invalid/biyan/updater/releases/v0.6.637/Biyan.app.tar.gz'
  assert.throws(
    () => validateCanonicalUpdaterCandidateMetadata(wrongAssetOrigin),
    /URL must be exactly https:\/\/static\.mitapp\.cn/
  )
  const extraMetadata = structuredClone(candidate)
  extraMetadata.channel = 'unreviewed'
  assert.throws(
    () => validateCanonicalUpdaterCandidateMetadata(extraMetadata),
    /Updater candidate keys must be exactly/
  )

  for (const invalidBaseUrl of [
    'http://static.mitapp.cn',
    'https://evil.invalid',
    'https://static.mitapp.cn/biyan',
    'https://static.mitapp.cn?channel=stable',
    'https://static.mitapp.cn#stable',
  ]) {
    assert.throws(
      () =>
        buildCandidate({
          version: '0.6.637',
          artifactsDir: source,
          outputDir: path.join(
            root,
            `invalid-origin-${Buffer.from(invalidBaseUrl).toString('hex')}`
          ),
          assetBaseUrl: invalidBaseUrl,
          publishedAt: '2026-07-14T00:00:00Z',
          sourceCommit,
          migrationPhase: 'A',
          dataSchema: 1,
        }),
      /Updater asset base URL must be exactly https:\/\/static\.mitapp\.cn/
    )
  }

  fs.rmSync(path.join(source, 'Biyan_0.6.637_x64_en-US.msi'))
  assert.throws(
    () =>
      buildCandidate({
        version: '0.6.637',
        artifactsDir: source,
        outputDir: path.join(root, 'missing-msi-output'),
        assetBaseUrl: 'https://static.mitapp.cn',
        publishedAt: '2026-07-14T00:00:00Z',
        sourceCommit,
        migrationPhase: 'A',
        dataSchema: 1,
      }),
    /Expected exactly one Biyan_0\.6\.637_x64_en-US\.msi, found 0/,
  )
})

test('promotion is forward-only, phase-gated, and supports rollout increases', () => {
  const candidateA = {
    tag: 'v0.6.634', version: '0.6.634', manifestKey: 'a/latest.json', manifestSha256: 'a',
  }
  const policyA = promote({
    candidate: candidateA,
    currentPolicy: initialPolicy(),
    phase: 'A',
    fromVersion: '0.6.633',
    expectedCurrent: '0.6.633',
    rollout: 100,
    promotedAt: '2026-07-14T00:00:00Z',
  })
  assert.equal(policyA.legacyBridgeVersion, '0.6.634')
  assert.deepEqual(policyA.completedPhases, ['A'])
  assert.equal(policyA.transitions['0.6.633'], undefined)
  const candidateAPatch = {
    tag: 'v0.6.635', version: '0.6.635', manifestKey: 'a1/latest.json', manifestSha256: 'a1',
  }
  const policyAPatch = promote({
    candidate: candidateAPatch,
    currentPolicy: policyA,
    phase: 'A',
    fromVersion: '0.6.634',
    expectedCurrent: '0.6.634',
    rollout: 100,
    promotedAt: '2026-07-15T00:00:00Z',
  })
  assert.equal(policyAPatch.legacyBridgeVersion, '0.6.635')
  assert.equal(policyAPatch.transitions['0.6.634'].to, '0.6.635')
  const candidateB = {
    tag: 'v0.6.636', version: '0.6.636', manifestKey: 'b/latest.json', manifestSha256: 'b',
  }
  const policyB = promote({
    candidate: candidateB,
    currentPolicy: policyAPatch,
    phase: 'B',
    fromVersion: '0.6.635',
    expectedCurrent: '0.6.635',
    rollout: 5,
    promotedAt: '2026-07-22T00:00:00Z',
  })
  assert.equal(policyB.transitions['0.6.635'].rollout, 5)
  assert.equal(policyB.completedPhases.includes('B'), false)
  assert.throws(() => promote({
    candidate: candidateB,
    currentPolicy: policyB,
    phase: 'B',
    fromVersion: '0.6.635',
    expectedCurrent: '0.6.636',
    rollout: 100,
    promotedAt: '2026-07-22T01:00:00Z',
  }), /0 -> 5 -> 25 -> 100/)
  assert.throws(() => promote({
    candidate: candidateA,
    currentPolicy: policyB,
    phase: 'A',
    fromVersion: '0.6.636',
    expectedCurrent: '0.6.636',
    rollout: 100,
    promotedAt: '2026-07-22T00:00:00Z',
  }), /Forward-only/)
})

test('promotion enforces observation windows, stable cycles, and health limits', () => {
  const candidateA = {
    tag: 'v0.6.634', version: '0.6.634', manifestKey: 'a/latest.json', manifestSha256: 'a',
  }
  assert.throws(() => promote({
    candidate: candidateA,
    currentPolicy: initialPolicy(),
    phase: 'A',
    fromVersion: '0.6.633',
    expectedCurrent: '0.6.633',
    rollout: 100,
    promotedAt: '2026-07-14T00:00:00Z',
  }, { smoke: { canaryStartedAt: '2026-07-12T00:00:01Z' } }), /at least 48 hours/)
  const policyA = promote({
    candidate: candidateA,
    currentPolicy: initialPolicy(),
    phase: 'A',
    fromVersion: '0.6.633',
    expectedCurrent: '0.6.633',
    rollout: 100,
    promotedAt: '2026-07-14T00:00:00Z',
  })
  const candidateB = {
    tag: 'v0.6.635', version: '0.6.635', manifestKey: 'b/latest.json', manifestSha256: 'b',
  }
  assert.throws(() => promote({
    candidate: candidateB,
    currentPolicy: policyA,
    phase: 'B',
    fromVersion: '0.6.634',
    expectedCurrent: '0.6.634',
    rollout: 5,
    promotedAt: '2026-07-20T23:59:59Z',
  }), /at least 7 days/)

  const policyB5 = promote({
    candidate: candidateB,
    currentPolicy: policyA,
    phase: 'B',
    fromVersion: '0.6.634',
    expectedCurrent: '0.6.634',
    rollout: 5,
    promotedAt: '2026-07-21T00:00:00Z',
  })
  assert.throws(() => promote({
    candidate: candidateB,
    currentPolicy: policyB5,
    phase: 'B',
    fromVersion: '0.6.634',
    expectedCurrent: '0.6.635',
    rollout: 25,
    promotedAt: '2026-07-22T23:59:59Z',
  }), /at least 48 hours/)
  assert.throws(() => promote({
    candidate: candidateB,
    currentPolicy: policyB5,
    phase: 'B',
    fromVersion: '0.6.634',
    expectedCurrent: '0.6.635',
    rollout: 25,
    promotedAt: '2026-07-23T00:00:00Z',
  }, { health: { p1Incidents: 1, status: 'unhealthy' } }), /healthy rollout report/)

  const cReady = structuredClone(policyB5)
  cReady.completedPhases = ['A', 'B']
  cReady.currentVersion = '0.6.635'
  cReady.phaseMilestones.B = { fullAt: '2026-07-25T00:00:00Z', version: '0.6.635' }
  cReady.stableCyclesAfterB = [
    { version: '0.6.636', fullAt: '2026-08-05T00:00:00Z' },
    { version: '0.6.637', fullAt: '2026-08-15T00:00:00Z' },
  ]
  cReady.releases['0.6.635'].effectivePhase = 'B'
  const candidateC = {
    tag: 'v0.6.638', version: '0.6.638', manifestKey: 'c/latest.json', manifestSha256: 'c',
  }
  assert.throws(() => promote({
    candidate: candidateC,
    currentPolicy: cReady,
    phase: 'C',
    fromVersion: '0.6.635',
    expectedCurrent: '0.6.635',
    rollout: 5,
    promotedAt: '2026-08-23T23:59:59Z',
  }), /at least 30 days/)
  const withoutCycles = structuredClone(cReady)
  withoutCycles.stableCyclesAfterB = cReady.stableCyclesAfterB.slice(0, 1)
  assert.throws(() => promote({
    candidate: candidateC,
    currentPolicy: withoutCycles,
    phase: 'C',
    fromVersion: '0.6.635',
    expectedCurrent: '0.6.635',
    rollout: 5,
    promotedAt: '2026-08-24T00:00:00Z',
  }), /two completed stable release cycles/)
  assert.equal(promote({
    candidate: candidateC,
    currentPolicy: cReady,
    phase: 'C',
    fromVersion: '0.6.635',
    expectedCurrent: '0.6.635',
    rollout: 5,
    promotedAt: '2026-08-24T00:00:00Z',
  }).transitions['0.6.635'].to, '0.6.638')
})

test('recovery stays forward-only and preserves the source migration schema', () => {
  const policyA = promote({
    candidate: {
      tag: 'v0.6.634', version: '0.6.634', manifestKey: 'a/latest.json', manifestSha256: 'a',
    },
    currentPolicy: initialPolicy(),
    phase: 'A',
    fromVersion: '0.6.633',
    expectedCurrent: '0.6.633',
    rollout: 100,
    promotedAt: '2026-07-14T00:00:00Z',
  })
  const recovery = {
    tag: 'v0.6.635', version: '0.6.635', manifestKey: 'recovery/latest.json',
    manifestSha256: 'recovery', migrationPhase: 'A', dataSchema: 1,
  }
  const recovered = promote({
    candidate: recovery,
    currentPolicy: policyA,
    phase: 'RECOVERY',
    fromVersion: '0.6.634',
    expectedCurrent: '0.6.634',
    rollout: 100,
    promotedAt: '2026-07-15T00:00:00Z',
  })
  assert.equal(recovered.transitions['0.6.634'].to, '0.6.635')
  assert.equal(recovered.releases['0.6.635'].effectivePhase, 'A')
  assert.equal(recovered.legacyBridgeVersion, '0.6.635')
  assert.throws(() => promote({
    candidate: { ...recovery, migrationPhase: 'C', dataSchema: 3 },
    currentPolicy: policyA,
    phase: 'RECOVERY',
    fromVersion: '0.6.634',
    expectedCurrent: '0.6.634',
    rollout: 100,
    promotedAt: '2026-07-15T00:00:00Z',
  }), /preserve the source migration phase/)
})

test('worker returns 204 when paused and a flat signed manifest when active', async () => {
  const manifestKey = 'biyan/updater/releases/v0.6.635/latest.json'
  const policy = {
    schema: 1,
    channel: 'stable',
    paused: true,
    releases: {
      '0.6.634': { phase: 'A' },
      '0.6.635': { phase: 'B' },
    },
    transitions: {
      '0.6.634': { to: '0.6.635', phase: 'B', rollout: 100, manifestKey },
    },
  }
  const manifest = {
    version: '0.6.635',
    notes: 'B',
    pub_date: '2026-07-21T00:00:00Z',
    platforms: {
      'windows-x86_64': { url: 'https://static.mitapp.cn/Biyan.exe', signature: 'signed' },
    },
  }
  const env = {
    BIYAN_SIGNING_KEY: signingKey,
    ROLLOUT_SALT: 'test-salt',
    UPDATER_BUCKET: bucket({
      'biyan/updater/stable/policy.json': policy,
      [manifestKey]: manifest,
    }),
  }
  let response = await handleRequest(
    signedRequest('/biyan/v1/stable/windows/x86_64/0.6.634'),
    env,
  )
  assert.equal(response.status, 204)

  policy.paused = false
  response = await handleRequest(
    signedRequest('/biyan/v1/stable/windows/x86_64/0.6.634'),
    env,
  )
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    version: '0.6.635',
    notes: 'B',
    pub_date: '2026-07-21T00:00:00Z',
    url: 'https://static.mitapp.cn/Biyan.exe',
    signature: 'signed',
  })
})

test('worker rejects unsigned requests', async () => {
  const response = await handleRequest(
    new Request('https://updates.mita.so/biyan/v1/stable/windows/x86_64/0.6.634'),
    { BIYAN_SIGNING_KEY: signingKey, UPDATER_BUCKET: bucket({}) },
  )
  assert.equal(response.status, 401)
})

test('worker never admits a pre-A client through the dynamic route', async () => {
  const manifestKey = 'biyan/updater/releases/v0.6.634/latest.json'
  const response = await handleRequest(
    signedRequest('/biyan/v1/stable/windows/x86_64/0.6.633', '0.6.633'),
    {
      BIYAN_SIGNING_KEY: signingKey,
      ROLLOUT_SALT: 'test-salt',
      UPDATER_BUCKET: bucket({
        'biyan/updater/stable/policy.json': {
          schema: 1,
          channel: 'stable',
          paused: false,
          releases: { '0.6.634': { phase: 'A' } },
          transitions: {
            '0.6.633': { to: '0.6.634', phase: 'A', rollout: 100, manifestKey },
          },
        },
      }),
    },
  )
  assert.equal(response.status, 204)
})

test('router deployment keeps the rendered config beside its worker entrypoint', () => {
  const repoRoot = path.resolve(import.meta.dirname, '../../..')
  const workflow = fs.readFileSync(
    path.join(repoRoot, '.github/workflows/deploy-updater-router.yml'),
    'utf8',
  )
  assert.match(
    workflow,
    /WRANGLER_CONFIG: scripts\/updater\/wrangler\.generated\.toml/,
  )
  assert.match(workflow, /node-version: "22"/)
  assert.match(
    workflow,
    /test -f "\$\(dirname "\$WRANGLER_CONFIG"\)\/worker\.mjs"/,
  )
  assert.equal(
    workflow.match(/--config "\$WRANGLER_CONFIG"/g)?.length,
    5,
  )
  assert.doesNotMatch(workflow, /\/tmp\/wrangler\.toml/)
})

test('router deployment fails closed unless unsigned and signed pre-A probes pass', () => {
  const repoRoot = path.resolve(import.meta.dirname, '../../..')
  const workflow = fs.readFileSync(
    path.join(repoRoot, '.github/workflows/deploy-updater-router.yml'),
    'utf8',
  )
  assert.match(
    workflow,
    /ENDPOINT="https:\/\/updates\.mita\.so\/biyan\/v1\/stable\/windows\/x86_64\/0\.6\.633"/,
  )
  assert.equal(workflow.match(/for attempt in \$\(seq 1 24\)/g)?.length, 2)
  assert.match(workflow, /test "\$unsigned_status" = "401"/)
  assert.match(workflow, /\. == \{"error":"unauthorized"\}/)
  assert.match(workflow, /node scripts\/updater\/sign-request\.mjs/)
  assert.match(workflow, /--current-version 0\.6\.633/)
  assert.match(workflow, /--target-version 0\.6\.643/)
  assert.match(workflow, /--rollout 0/)
  assert.doesNotMatch(workflow, /--salt/)
  assert.match(workflow, /umask 077/)
  assert.match(
    workflow,
    /SIGNED_HEADERS="\$\{RUNNER_TEMP:\?\}\/biyan-updater-signed-headers-\$\{GITHUB_RUN_ID\}\.json"/,
  )
  assert.match(
    workflow,
    /UNSIGNED_BODY="\$\{RUNNER_TEMP:\?\}\/biyan-updater-unsigned-body-\$\{GITHUB_RUN_ID\}\.json"/,
  )
  assert.match(
    workflow,
    /SIGNED_BODY="\$\{RUNNER_TEMP:\?\}\/biyan-updater-signed-body-\$\{GITHUB_RUN_ID\}"/,
  )
  assert.match(
    workflow,
    /signed_status="000"[\s\S]*for attempt in \$\(seq 1 24\); do[\s\S]*node scripts\/updater\/sign-request\.mjs[\s\S]*curl --silent/,
  )
  assert.match(
    workflow,
    /\(keys \| sort\) == \[[\s\S]*"X-Client-Session"[\s\S]*"X-Request-Token"[\s\S]*\]\s+and \.\["X-Client-Version"\] == "0\.6\.633"/,
  )
  assert.match(workflow, /test "\$signed_status" = "204"/)
  assert.match(workflow, /test ! -s "\$SIGNED_BODY"/)
  assert.match(
    workflow,
    /schema: \$schema,[\s\S]*sourceCommit: \$sourceCommit,[\s\S]*unsignedStatus: \$unsignedStatus,[\s\S]*signedPreAStatus: \$signedPreAStatus/,
  )

  const uploadStep = workflow.match(
    /      - name: Upload router deployment evidence[\s\S]*$/,
  )?.[0]
  assert.ok(uploadStep)
  assert.match(uploadStep, /if: inputs\.dry_run != true && success\(\)/)
  assert.match(
    uploadStep,
    /path: dist\/router-verification\/evidence\.json/,
  )
  assert.match(uploadStep, /if-no-files-found: error/)
  assert.match(
    uploadStep,
    /name: updater-router-deployment-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/,
  )
  assert.doesNotMatch(uploadStep, /signed-headers\.json/)
  assert.doesNotMatch(uploadStep, /unsigned-body|signed-body/)
})

test('health gate pauses on P0/P1, data loss, or migration failures above 0.5%', () => {
  const healthy = {
    status: 'healthy', p0Incidents: 0, p1Incidents: 0, dataLossIncidents: 0,
    migrationFailureRate: 0.005,
  }
  assert.equal(evaluateRolloutHealth(healthy).pause, false)
  for (const unsafe of [
    { ...healthy, p0Incidents: 1 },
    { ...healthy, p1Incidents: 1 },
    { ...healthy, dataLossIncidents: 1 },
    { ...healthy, migrationFailureRate: 0.00501 },
  ]) assert.equal(evaluateRolloutHealth(unsafe).pause, true)
})
