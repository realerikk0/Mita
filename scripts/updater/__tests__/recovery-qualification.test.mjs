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
import {
  aggregateRecoveryQualificationEvidence,
  buildRecoveryContract,
  buildRecoveryLaneResult,
  validateRecoveryContract,
} from '../recovery-qualification-evidence.mjs'

const cli = fileURLToPath(
  new URL('../recovery-qualification-evidence.mjs', import.meta.url),
)
const workflowPath = '.github/workflows/biyan-upgrade-smoke.yml'
const headSha = 'e'.repeat(40)
const harnessSha256 = 'f'.repeat(64)
const runId = 456
const runAttempt = 2
const repositoryId = 987
const startedAt = '2026-08-04T00:00:00.000Z'

function sha256Bytes(value) {
  return createHash('sha256').update(value).digest('hex')
}

function sha256File(file) {
  return sha256Bytes(fs.readFileSync(file))
}

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
    'untrusted comment: minisign public key: recovery test key',
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
        privateKey,
      )
      const payload = Buffer.concat([
        Buffer.from('ED', 'ascii'),
        keyId,
        signature,
      ])
      const text = [
        'untrusted comment: signature from minisign secret key',
        payload.toString('base64'),
        `trusted comment: ${trustedComment}`,
        globalSignature.toString('base64'),
        '',
      ].join('\n')
      return Buffer.from(text, 'utf8').toString('base64')
    },
  }
}

function candidateFixture(t, version, sourceCommit) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), `biyan-recovery-candidate-${version}-`),
  )
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const inputs = path.join(root, 'inputs')
  const output = path.join(root, 'candidate')
  const signing = signingFixture()
  fs.mkdirSync(inputs, { recursive: true })
  const assets = new Map([
    ['darwin-universal', 'Biyan.app.tar.gz'],
    ['windows-x86_64', `Biyan_${version}_x64-setup.exe`],
    ['linux-x86_64', `Biyan_${version}_amd64.AppImage`],
  ])
  for (const [name, contents] of [
    ['Biyan.app.tar.gz', `mac-app-${version}`],
    [`Biyan_${version}_universal.dmg`, `mac-dmg-${version}`],
    [`Biyan_${version}_x64-setup.exe`, `windows-${version}`],
    [`Biyan_${version}_x64_en-US.msi`, `windows-msi-${version}`],
    [`Biyan_${version}_amd64.AppImage`, `linux-${version}`],
    [`Biyan_${version}_amd64.deb`, `linux-deb-${version}`],
  ]) {
    fs.writeFileSync(path.join(inputs, name), contents)
  }
  for (const [platform, name] of assets) {
    const asset = path.join(inputs, name)
    fs.writeFileSync(`${asset}.sig`, signing.sign(asset, `${platform}/${name}`))
  }
  const candidate = buildCandidate({
    version,
    tag: `v${version}`,
    artifactsDir: inputs,
    outputDir: output,
    assetBaseUrl: 'https://static.mitapp.cn',
    publishedAt: '2026-08-04T00:00:00.000Z',
    sourceCommit,
    migrationPhase: 'C',
    dataSchema: 3,
  })
  const candidateFile = path.join(output, 'candidate.json')
  const signatureFile = path.join(output, 'candidate.json.sig')
  fs.writeFileSync(
    signatureFile,
    signing.sign(candidateFile, 'candidate.json'),
  )
  return {
    output,
    candidate,
    candidateFile,
    signatureFile,
    manifestFile: path.join(output, 'latest.json'),
    pubkey: signing.pubkey,
  }
}

function trainPolicy(sourceCommit, candidateCommit) {
  return {
    schema: 4,
    activeTrain: null,
    supersededTerminalReleases: [
      {
        tag: 'v0.6.649',
        version: '0.6.649',
        migrationPhase: 'C',
        dataSchema: 3,
        sourceCommit,
        status: 'published-superseded',
      },
    ],
    activeTerminalRelease: {
      tag: 'v0.6.650',
      version: '0.6.650',
      migrationPhase: 'C',
      dataSchema: 3,
      sourceCommit: candidateCommit,
    },
    trains: [],
  }
}

function normalizedRelease(version, sourceCommit, seed) {
  return {
    tag: `v${version}`,
    version,
    sourceCommit,
    migrationPhase: 'C',
    dataSchema: 3,
    manifestSha256: seed.repeat(64),
    assets: {
      windows: {
        name: `Biyan_${version}_x64-setup.exe`,
        sha256: '1'.repeat(64),
      },
      macos: {
        name: `Biyan_${version}_universal.dmg`,
        sha256: '2'.repeat(64),
      },
      linux: {
        name: `Biyan_${version}_amd64.AppImage`,
        sha256: '3'.repeat(64),
      },
    },
  }
}

function fixtureContract() {
  const source = normalizedRelease('0.6.649', 'a'.repeat(40), 'b')
  const candidate = normalizedRelease('0.6.650', 'c'.repeat(40), 'd')
  return buildRecoveryContract({
    trainPolicy: trainPolicy(source.sourceCommit, candidate.sourceCommit),
    source,
    candidate,
    headSha,
    harnessSha256,
    runId,
    runAttempt,
  })
}

function inputManifest(contract, platform, snapshotSha256) {
  const configRoots = {
    windows: '%APPDATA%/Biyan',
    macos: '$HOME/Library/Application Support/Biyan',
    linux: '$HOME/.local/share/Biyan',
  }
  const dataRoot = `${configRoots[platform]}/data`
  return {
    schema: 1,
    sanitized: true,
    platform,
    scenario: 'source-to-recovery',
    qualificationMode: 'automatic-updater',
    lane: `source-to-recovery-${platform}`,
    installers: {
      current: {
        sha256: contract.source.assets[platform].sha256,
      },
      c: {
        sha256: contract.candidate.assets[platform].sha256,
      },
    },
    snapshots: {
      current: {
        archive: 'snapshots/current.zip',
        sha256: snapshotSha256,
        restore_to: dataRoot,
      },
    },
    expectations: {
      c: [
        `${configRoots[platform]}/migration-state.json`,
        `${dataRoot}/agent-workspaces/recovery-qualification-preserved.txt`,
      ],
    },
    sourceReadiness: null,
  }
}

function migrationReport(platform) {
  return {
    schema: 1,
    platform,
    scenarios: ['source-to-recovery'],
    status: 'passed',
    matrix: [
      {
        scenario: 'source-to-recovery',
        platform,
        snapshot: 'current',
        installSequence: ['current', 'c'],
        expectedPhase: 'c',
        status: 'passed',
        durationSeconds: 12.5,
      },
    ],
  }
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

function runReceipt() {
  return {
    harnessSha256,
    run: {
      id: runId,
      run_attempt: runAttempt,
      name: 'Biyan Upgrade Smoke',
      path: workflowPath,
      event: 'workflow_dispatch',
      head_branch: 'mita-main',
      head_sha: headSha,
      repository: {
        id: repositoryId,
        full_name: 'realerikk0/Mita',
      },
      head_repository: {
        id: repositoryId,
        full_name: 'realerikk0/Mita',
      },
      status: 'in_progress',
      conclusion: null,
      run_started_at: startedAt,
    },
  }
}

function artifact(platform, index) {
  return {
    id: 1000 + index,
    name: `recovery-qualification-${platform}-${runId}-${runAttempt}`,
    digest: `sha256:${String(index + 4).repeat(64)}`,
    expired: false,
    size_in_bytes: 4096,
    created_at: `2026-08-04T00:0${index + 2}:00.000Z`,
    workflow_run: {
      id: runId,
      repository_id: repositoryId,
      head_repository_id: repositoryId,
      head_branch: 'mita-main',
      head_sha: headSha,
    },
  }
}

test('contract CLI verifies independently signed source and candidate metadata', (t) => {
  const source = candidateFixture(t, '0.6.649', 'a'.repeat(40))
  const candidate = candidateFixture(t, '0.6.650', 'c'.repeat(40))
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'biyan-recovery-contract-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const policy = path.join(root, 'policy.json')
  const output = path.join(root, 'contract.json')
  writeJson(policy, trainPolicy('a'.repeat(40), 'c'.repeat(40)))
  const args = [
    'contract',
    '--train-policy',
    policy,
    '--source-candidate',
    source.candidateFile,
    '--source-candidate-signature',
    source.signatureFile,
    '--source-manifest',
    source.manifestFile,
    '--source-public-key',
    source.pubkey,
    '--candidate-candidate',
    candidate.candidateFile,
    '--candidate-candidate-signature',
    candidate.signatureFile,
    '--candidate-manifest',
    candidate.manifestFile,
    '--candidate-public-key',
    candidate.pubkey,
    '--run-id',
    String(runId),
    '--run-attempt',
    String(runAttempt),
    '--head-sha',
    headSha,
    '--harness-sha256',
    harnessSha256,
    '--output',
    output,
  ]
  const result = spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  const contract = JSON.parse(fs.readFileSync(output, 'utf8'))
  assert.equal(contract.source.tag, 'v0.6.649')
  assert.equal(contract.candidate.tag, 'v0.6.650')
  assert.equal(contract.workflow.runId, runId)
  assert.deepEqual(
    contract.lanes.map(({ platform, runner }) => ({ platform, runner })),
    [
      { platform: 'windows', runner: 'windows-2022' },
      { platform: 'macos', runner: 'macos-15-intel' },
      { platform: 'linux', runner: 'ubuntu-24.04' },
    ],
  )

  const wrongKey = [...args]
  wrongKey[wrongKey.indexOf('--candidate-public-key') + 1] = source.pubkey
  const rejected = spawnSync(process.execPath, [cli, ...wrongKey], {
    encoding: 'utf8',
  })
  assert.equal(rejected.status, 1)
  assert.match(rejected.stderr, /wrong key/)
})

test('contract rejects train drift, non-forward versions, and harness drift', () => {
  const contract = fixtureContract()
  assert.equal(validateRecoveryContract(contract), contract)

  const wrongHead = structuredClone(contract)
  wrongHead.workflow.headSha = 'not-a-commit'
  assert.throws(
    () => validateRecoveryContract(wrongHead),
    /lowercase commit SHA/,
  )

  const wrongHarness = structuredClone(contract)
  wrongHarness.workflow.harnessPaths.pop()
  assert.throws(
    () => validateRecoveryContract(wrongHarness),
    /harnessPaths/,
  )

  const nonForward = structuredClone(contract)
  nonForward.candidate.version = nonForward.source.version
  nonForward.candidate.tag = nonForward.source.tag
  for (const platform of ['windows', 'macos', 'linux']) {
    nonForward.candidate.assets[platform].name =
      nonForward.source.assets[platform].name
  }
  assert.throws(
    () => validateRecoveryContract(nonForward),
    /must be newer/,
  )

  const source = normalizedRelease('0.6.649', 'a'.repeat(40), 'b')
  const candidate = normalizedRelease('0.6.650', 'c'.repeat(40), 'd')
  const policy = trainPolicy(source.sourceCommit, '9'.repeat(40))
  assert.throws(
    () =>
      buildRecoveryContract({
        trainPolicy: policy,
        source,
        candidate,
        headSha,
        harnessSha256,
        runId,
        runAttempt,
      }),
    /active train terminal/,
  )
})

test('recovery source rolls forward from release policy beyond v0.6.649', () => {
  const source = normalizedRelease('0.6.650', '5'.repeat(40), '6')
  const candidate = normalizedRelease('0.6.651', '7'.repeat(40), '8')
  const policy = {
    schema: 4,
    activeTrain: null,
    supersededTerminalReleases: [
      {
        tag: 'v0.6.649',
        version: '0.6.649',
        migrationPhase: 'C',
        dataSchema: 3,
        sourceCommit: 'a'.repeat(40),
        status: 'published-superseded',
      },
      {
        tag: source.tag,
        version: source.version,
        migrationPhase: source.migrationPhase,
        dataSchema: source.dataSchema,
        sourceCommit: source.sourceCommit,
        status: 'published-superseded',
      },
    ],
    activeTerminalRelease: {
      tag: candidate.tag,
      version: candidate.version,
      migrationPhase: candidate.migrationPhase,
      dataSchema: candidate.dataSchema,
      sourceCommit: candidate.sourceCommit,
    },
    trains: [],
  }
  const contract = buildRecoveryContract({
    trainPolicy: policy,
    source,
    candidate,
    headSha,
    harnessSha256,
    runId,
    runAttempt,
  })
  assert.equal(contract.source.tag, 'v0.6.650')
  assert.equal(contract.candidate.tag, 'v0.6.651')
})

test('three exact lane artifacts aggregate into promotion evidence', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'biyan-recovery-aggregate-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const contract = fixtureContract()
  for (const [index, platform] of ['windows', 'macos', 'linux'].entries()) {
    const lane = `source-to-recovery-${platform}`
    const migrationFile = path.join(root, `${lane}-migration.json`)
    const manifestFile = path.join(root, `${lane}-manifest.json`)
    const snapshotFile = path.join(root, `${lane}-snapshot.zip`)
    fs.writeFileSync(snapshotFile, `snapshot-${platform}`)
    const snapshotSha256 = sha256File(snapshotFile)
    writeJson(migrationFile, migrationReport(platform))
    writeJson(
      manifestFile,
      inputManifest(contract, platform, snapshotSha256),
    )
    const result = buildRecoveryLaneResult({
      contract,
      platform,
      migrationReport: JSON.parse(fs.readFileSync(migrationFile, 'utf8')),
      migrationReportSha256: sha256File(migrationFile),
      inputManifest: JSON.parse(fs.readFileSync(manifestFile, 'utf8')),
      inputManifestSha256: sha256File(manifestFile),
      snapshotSha256,
      sourceInstallerSha256: contract.source.assets[platform].sha256,
      candidateInstallerSha256: contract.candidate.assets[platform].sha256,
      runId,
      runAttempt,
      headSha,
      harnessSha256,
      startedAt: `2026-08-04T00:0${index}:10.000Z`,
      completedAt: `2026-08-04T00:0${index + 1}:00.000Z`,
    })
    writeJson(path.join(root, `${lane}.json`), result)
  }
  const artifactsResponse = {
    artifacts: ['windows', 'macos', 'linux'].map(artifact),
  }
  const evidence = aggregateRecoveryQualificationEvidence({
    contract,
    inputDir: root,
    runReceipt: runReceipt(),
    artifactsResponse,
  })
  assert.equal(evidence.smoke.status, 'passed')
  assert.deepEqual(evidence.smoke.platforms, ['windows', 'macos', 'linux'])
  assert.deepEqual(evidence.smoke.scenarios, ['source-to-recovery'])
  assert.equal(evidence.smoke.sourceVersion, '0.6.649')
  assert.equal(evidence.smoke.candidateVersion, '0.6.650')
  assert.equal(evidence.smoke.sampleSize, 3)
  assert.equal(evidence.smoke.results.length, 3)
  assert.equal(evidence.health.status, 'healthy')
  assert.deepEqual(evidence.health.platforms, ['windows', 'macos', 'linux'])
  assert.deepEqual(evidence.health.scenarios, ['source-to-recovery'])
  assert.equal(evidence.health.migrationFailureRate, 0)
  assert.equal(evidence.health.p0Incidents, 0)

  const duplicate = structuredClone(artifactsResponse)
  duplicate.artifacts.push(structuredClone(duplicate.artifacts[0]))
  assert.throws(
    () =>
      aggregateRecoveryQualificationEvidence({
        contract,
        inputDir: root,
        runReceipt: runReceipt(),
        artifactsResponse: duplicate,
      }),
    /artifact names|exactly one/,
  )

  const reusedId = structuredClone(artifactsResponse)
  reusedId.artifacts[1].id = reusedId.artifacts[0].id
  assert.throws(
    () =>
      aggregateRecoveryQualificationEvidence({
        contract,
        inputDir: root,
        runReceipt: runReceipt(),
        artifactsResponse: reusedId,
      }),
    /distinct GitHub artifact IDs/,
  )

  const oldAttempt = structuredClone(artifactsResponse)
  oldAttempt.artifacts.push({
    ...structuredClone(oldAttempt.artifacts[0]),
    id: 9999,
    name: `recovery-qualification-windows-${runId}-1`,
  })
  assert.equal(
    aggregateRecoveryQualificationEvidence({
      contract,
      inputDir: root,
      runReceipt: runReceipt(),
      artifactsResponse: oldAttempt,
    }).smoke.status,
    'passed',
  )

  const currentAttemptExtra = structuredClone(artifactsResponse)
  currentAttemptExtra.artifacts.push({
    ...structuredClone(currentAttemptExtra.artifacts[0]),
    id: 9998,
    name: `recovery-qualification-diagnostics-${runId}-${runAttempt}`,
  })
  assert.throws(
    () =>
      aggregateRecoveryQualificationEvidence({
        contract,
        inputDir: root,
        runReceipt: runReceipt(),
        artifactsResponse: currentAttemptExtra,
      }),
    /artifact names/,
  )

  const crossRun = structuredClone(artifactsResponse)
  crossRun.artifacts[0].workflow_run.id += 1
  assert.throws(
    () =>
      aggregateRecoveryQualificationEvidence({
        contract,
        inputDir: root,
        runReceipt: runReceipt(),
        artifactsResponse: crossRun,
      }),
    /exact recovery run/,
  )
})

test('lane result fails closed on input and execution identity drift', () => {
  const contract = fixtureContract()
  const platform = 'windows'
  const snapshotSha256 = '4'.repeat(64)
  const manifest = inputManifest(contract, platform, snapshotSha256)
  const report = migrationReport(platform)
  const base = {
    contract,
    platform,
    migrationReport: report,
    migrationReportSha256: '5'.repeat(64),
    inputManifest: manifest,
    inputManifestSha256: '6'.repeat(64),
    snapshotSha256,
    sourceInstallerSha256: contract.source.assets[platform].sha256,
    candidateInstallerSha256: contract.candidate.assets[platform].sha256,
    runId,
    runAttempt,
    headSha,
    harnessSha256,
    startedAt: '2026-08-04T00:00:10.000Z',
    completedAt: '2026-08-04T00:01:00.000Z',
  }
  assert.equal(buildRecoveryLaneResult(base).status, 'passed')
  assert.throws(
    () =>
      buildRecoveryLaneResult({
        ...base,
        candidateInstallerSha256: '9'.repeat(64),
      }),
    /installer digests/,
  )
  assert.throws(
    () => buildRecoveryLaneResult({ ...base, runAttempt: 3 }),
    /execution identity/,
  )
  const wrongReport = structuredClone(report)
  wrongReport.matrix[0].installSequence = ['c']
  assert.throws(
    () => buildRecoveryLaneResult({ ...base, migrationReport: wrongReport }),
    /install sequence/,
  )
})

test('CLI entrypoint fails closed without a complete command', () => {
  const result = spawnSync(process.execPath, [cli, 'lane-result'], {
    encoding: 'utf8',
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Missing required option/)
})
