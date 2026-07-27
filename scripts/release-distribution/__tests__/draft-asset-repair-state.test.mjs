import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  classifyDraftAssetRepairState,
  validateDraftAssetRepairPlan,
} from '../draft-asset-repair-state.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const cli = path.resolve(here, '..', 'draft-asset-repair-state.mjs')
const sha = (digit) => `sha256:${digit.repeat(64)}`
const RELEASE_BODY_SHA256 =
  'd87e2105473786d9b0277ed05eb466c8cd5e14e28b89c13ffd10b3d3ca801c52'
const RELEASE_BODY = [
  '## 问题修复',
  '',
  '- classify reviewed renames deterministically',
  '- fail closed before release builds',
  '- boundary-match retired runtime paths',
  '- remove pre-Corepack native Yarn cache',
  '',
  '## 优化调整',
  '',
  '- Close Biyan release source and distribution audit',
  '',
  '## 维护更新',
  '',
  '- fail closed on curl harness drift',
  '- make recovery curl harness shell-native',
  '- prove digest normalization boundary',
  '- use platform PATH delimiter',
  '- canonicalize allowlisted text digests',
  '- normalize release workflow fixtures',
  '- invoke Tauri icon CLI portably',
  '- lock trusted scope envelope',
  '- close trusted scope mutation gaps',
  '- enforce ordered bootstrap guard',
  '- require exact bootstrap identities',
  '- lock bootstrap fallback behavior',
  '- 另有 2 项同类更新，详见完整变更。',
  '',
  '## 完整变更',
  '',
  'https://github.com/realerikk0/Mita/compare/v0.6.637...v0.6.643',
  '',
].join('\n')

function createPlan() {
  return {
    schema: 2,
    repository: 'realerikk0/Mita',
    workflowSha: '7fd6bce103dc80d5f8bfd98abb7a5a093c51fc5f',
    release: {
      id: 360025177,
      tag: 'v0.6.643',
      targetCommit: '38e6d9290a8b9b0f152ff2a7eefb550e6ead7df5',
      name: 'Biyan v0.6.643',
      bodySha256: RELEASE_BODY_SHA256,
      createdAt: '2026-01-02T03:04:05Z',
      author: {
        id: 123456,
        login: 'fixture-release[bot]',
        type: 'Bot',
      },
      draft: true,
      prerelease: false,
      publishedAt: '2026-07-27T07:05:00Z',
    },
    preserve: [
      {
        id: 10,
        name: 'Biyan_0.6.643_amd64.AppImage',
        size: 257321464,
        digest: sha('a'),
      },
      {
        id: 11,
        name: 'Biyan_0.6.643_universal.dmg',
        size: 226784118,
        digest: sha('b'),
      },
      ...Array.from({ length: 6 }, (_, index) => ({
        id: 12 + index,
        name: `preserved-${index}.bin`,
        size: 300 + index,
        digest: sha(['d', 'e', 'f', 'a', 'b', 'c'][index]),
      })),
    ],
    replacements: [
      'Biyan_0.6.643_amd64.AppImage.sig',
      'candidate.json',
      'candidate.json.sig',
      'latest.json',
      'SHA256SUMS',
    ].map((name, index) => ({
      name,
      old: {
        id: 20 + index,
        size: 100 + index,
        digest: sha(String(index + 1)),
      },
      new: {
        size: 200 + index,
        digest: sha(['6', '7', '8', '9', 'c'][index]),
      },
      stagingName: `.repair-v0.6.643-${index}-staged`,
      backupName: `.repair-v0.6.643-${index}-backup`,
    })),
  }
}

function asset(id, name, size, digest) {
  return { id, name, size, digest, state: 'uploaded' }
}

function starterAsset(id, name) {
  return { id, name, size: 0, digest: null, state: 'starter' }
}

function assetsForState(entry, state, index) {
  const old = asset(entry.old.id, entry.name, entry.old.size, entry.old.digest)
  const staged = asset(
    100 + index,
    entry.stagingName,
    entry.new.size,
    entry.new.digest
  )
  const backup = { ...old, name: entry.backupName }
  const canonical = { ...staged, name: entry.name }
  if (state === 'initial') return [old]
  if (state === 'staged') return [old, staged]
  if (state === 'backup') return [staged, backup]
  if (state === 'swapped') return [canonical, backup]
  if (state === 'committed') return [canonical]
  throw new Error(`unsupported fixture state ${state}`)
}

function createRelease(plan, states) {
  const api = `https://api.github.com/repos/${plan.repository}/releases/${plan.release.id}`
  return {
    id: plan.release.id,
    url: api,
    assets_url: `${api}/assets`,
    tag_name: plan.release.tag,
    target_commitish: plan.release.targetCommit,
    name: plan.release.name,
    body: RELEASE_BODY,
    created_at: plan.release.createdAt,
    author: { ...plan.release.author },
    draft: true,
    prerelease: false,
    published_at: plan.release.publishedAt,
    immutable: false,
    assets: [
      ...plan.preserve.map((entry) =>
        asset(entry.id, entry.name, entry.size, entry.digest)
      ),
      ...plan.replacements.flatMap((entry, index) =>
        assetsForState(entry, states[index], index)
      ),
    ],
  }
}

function classify(states) {
  const plan = createPlan()
  return classifyDraftAssetRepairState(plan, createRelease(plan, states))
}

test('classifies every complete repair phase and emits the exact next mutation', () => {
  const expectations = [
    {
      state: 'initial',
      action: 'stage',
      idKey: null,
      from: null,
      to: 'stagingName',
    },
    {
      state: 'staged',
      action: 'rename-old-to-backup',
      idKey: 'canonical',
      from: 'name',
      to: 'backupName',
    },
    {
      state: 'backup',
      action: 'rename-stage-to-canonical',
      idKey: 'staging',
      from: 'stagingName',
      to: 'name',
    },
    {
      state: 'swapped',
      action: 'delete-backup',
      idKey: 'backup',
      from: 'backupName',
      to: null,
    },
    {
      state: 'committed',
      action: 'none',
      idKey: null,
      from: null,
      to: null,
    },
  ]

  for (const expected of expectations) {
    const result = classify(Array(5).fill(expected.state))
    const plan = createPlan()
    const first = result.replacements[0]
    assert.equal(result.state, expected.state)
    assert.equal(result.phase, expected.state)
    assert.equal(result.inProgress, false)
    assert.deepEqual(
      result.replacements.map(({ state }) => state),
      Array(5).fill(expected.state)
    )
    assert.equal(result.next.action, expected.action)
    assert.equal(
      result.next.replacement,
      expected.state === 'committed' ? null : plan.replacements[0].name
    )
    assert.equal(
      result.next.assetId,
      expected.idKey ? first.assetIds[expected.idKey] : null
    )
    assert.equal(first.canonicalId, first.assetIds.canonical)
    assert.equal(first.stagingId, first.assetIds.staging)
    assert.equal(first.backupId, first.assetIds.backup)
    assert.equal(
      result.next.fromName,
      expected.from ? plan.replacements[0][expected.from] : null
    )
    assert.equal(
      result.next.toName,
      expected.to ? plan.replacements[0][expected.to] : null
    )
  }
})

test('accepts an interrupted advanced prefix at every phase boundary', () => {
  const states = ['initial', 'staged', 'backup', 'swapped']
  for (let rank = 0; rank < states.length; rank += 1) {
    const current = states[rank]
    const advanced = states[rank + 1] ?? 'committed'
    const result = classify([advanced, advanced, current, current, current])
    assert.equal(result.phase, current)
    assert.equal(result.inProgress, true)
    assert.equal(result.next.replacement, createPlan().replacements[2].name)
  }
})

test('deletes only the exact current next starter staging asset', () => {
  const plan = createPlan()
  for (let index = 0; index < plan.replacements.length; index += 1) {
    const states = plan.replacements.map((_, candidate) =>
      candidate < index ? 'staged' : 'initial'
    )
    const release = createRelease(plan, states)
    const entry = plan.replacements[index]
    release.assets.push(starterAsset(200 + index, entry.stagingName))

    const result = classifyDraftAssetRepairState(plan, release)
    assert.equal(result.schema, 2)
    assert.equal(result.phase, 'initial')
    assert.equal(result.next.action, 'delete-starter-stage')
    assert.equal(result.next.replacement, entry.name)
    assert.equal(result.next.assetId, 200 + index)
    assert.equal(result.next.fromName, entry.stagingName)
    assert.equal(result.next.toName, null)
    assert.equal(result.replacements[index].starterId, 200 + index)
    assert.equal(result.replacements[index].stagingId, null)
    assert.equal(result.replacements[index].assetIds.starter, 200 + index)
  }
})

test('fails closed for every non-current or malformed starter asset', () => {
  const plan = createPlan()

  const nonCurrent = createRelease(plan, Array(5).fill('initial'))
  nonCurrent.assets.push(starterAsset(200, plan.replacements[1].stagingName))
  assert.throws(
    () => classifyDraftAssetRepairState(plan, nonCurrent),
    /only the exact current next staging asset/
  )

  const multiple = createRelease(plan, Array(5).fill('initial'))
  multiple.assets.push(starterAsset(200, plan.replacements[0].stagingName))
  multiple.assets.push(starterAsset(201, plan.replacements[1].stagingName))
  assert.throws(
    () => classifyDraftAssetRepairState(plan, multiple),
    /only the exact current next staging asset/
  )

  const unknown = createRelease(plan, Array(5).fill('initial'))
  unknown.assets.push(starterAsset(200, 'unplanned-starter'))
  assert.throws(
    () => classifyDraftAssetRepairState(plan, unknown),
    /unknown release asset/
  )

  const preserved = createRelease(plan, Array(5).fill('initial'))
  Object.assign(preserved.assets[0], {
    size: 0,
    digest: null,
    state: 'starter',
  })
  assert.throws(
    () => classifyDraftAssetRepairState(plan, preserved),
    /preserved asset .* does not match plan/
  )

  const wrongNamespace = createRelease(plan, Array(5).fill('initial'))
  wrongNamespace.assets.push(starterAsset(200, plan.replacements[0].backupName))
  assert.throws(
    () => classifyDraftAssetRepairState(plan, wrongNamespace),
    /unsafe asset state/
  )

  const nonEmpty = createRelease(plan, Array(5).fill('initial'))
  nonEmpty.assets.push({
    ...starterAsset(200, plan.replacements[0].stagingName),
    size: 1,
  })
  assert.throws(
    () => classifyDraftAssetRepairState(plan, nonEmpty),
    /release\.assets\[\d+\]\.size must be 0/
  )

  const digested = createRelease(plan, Array(5).fill('initial'))
  digested.assets.push({
    ...starterAsset(200, plan.replacements[0].stagingName),
    digest: sha('f'),
  })
  assert.throws(
    () => classifyDraftAssetRepairState(plan, digested),
    /release\.assets\[\d+\]\.digest must be null/
  )
})

test('rejects non-monotonic and cross-phase mixed states', () => {
  assert.throws(
    () => classify(['staged', 'initial', 'staged', 'initial', 'initial']),
    /not a monotonic plan-order prefix/
  )
  assert.throws(
    () => classify(['backup', 'initial', 'initial', 'initial', 'initial']),
    /cross more than one repair phase/
  )
  assert.throws(
    () => classify(['committed', 'swapped', 'backup', 'backup', 'backup']),
    /cross more than one repair phase/
  )
})

test('rejects every unsafe per-item asset combination', () => {
  const plan = createPlan()
  const release = createRelease(plan, Array(5).fill('initial'))
  const target = plan.replacements[0]
  release.assets.push(
    asset(100, target.stagingName, target.new.size, target.new.digest)
  )
  release.assets.push(
    asset(
      target.old.id + 1000,
      target.backupName,
      target.old.size,
      target.old.digest
    )
  )
  assert.throws(
    () => classifyDraftAssetRepairState(plan, release),
    /unsafe asset state/
  )

  const missing = createRelease(plan, Array(5).fill('initial'))
  missing.assets = missing.assets.filter(({ name }) => name !== target.name)
  assert.throws(
    () => classifyDraftAssetRepairState(plan, missing),
    /unsafe asset state/
  )
})

test('requires exact preserved assets and rejects unknown or duplicate assets', () => {
  const plan = createPlan()
  const tampered = createRelease(plan, Array(5).fill('initial'))
  tampered.assets[0].digest = sha('f')
  assert.throws(
    () => classifyDraftAssetRepairState(plan, tampered),
    /preserved asset .* does not match plan/
  )

  const unknown = createRelease(plan, Array(5).fill('initial'))
  unknown.assets.push(asset(999, 'surprise.txt', 1, sha('f')))
  assert.throws(
    () => classifyDraftAssetRepairState(plan, unknown),
    /unknown release asset/
  )

  const duplicateName = createRelease(plan, Array(5).fill('initial'))
  duplicateName.assets.push({ ...duplicateName.assets[0], id: 998 })
  assert.throws(
    () => classifyDraftAssetRepairState(plan, duplicateName),
    /asset name .* is duplicated/
  )

  const duplicateId = createRelease(plan, Array(5).fill('initial'))
  duplicateId.assets.push({
    ...duplicateId.assets[0],
    id: duplicateId.assets[1].id,
    name: 'other-known-name',
  })
  assert.throws(
    () => classifyDraftAssetRepairState(plan, duplicateId),
    /asset ID .* is duplicated/
  )
})

test('rejects a new asset that reuses any reserved historical ID', () => {
  const plan = createPlan()
  const release = createRelease(plan, Array(5).fill('committed'))
  const first = release.assets.find(
    ({ name }) => name === plan.replacements[0].name
  )
  first.id = plan.replacements[0].old.id
  assert.throws(
    () => classifyDraftAssetRepairState(plan, release),
    /reuses reserved asset ID/
  )
})

test('pins the complete mutable Draft release identity', () => {
  const mutations = [
    ['id', 360025178, /release.id/],
    ['tag_name', 'v0.6.644', /release.tag_name/],
    ['target_commitish', 'f'.repeat(40), /release.target_commitish/],
    ['name', 'Unexpected release', /release.name/],
    ['body', `${RELEASE_BODY}tampered`, /release.bodySha256/],
    ['body', null, /release.body must be a string/],
    ['created_at', '2026-01-02T03:04:06Z', /release.created_at/],
    ['draft', false, /release.draft/],
    ['prerelease', true, /release.prerelease/],
    ['published_at', '2026-07-27T07:05:01Z', /release.published_at/],
    ['immutable', true, /release.immutable/],
    [
      'url',
      'https://api.github.com/repos/other/repo/releases/360025177',
      /release.url/,
    ],
  ]
  for (const [field, value, message] of mutations) {
    const plan = createPlan()
    const release = createRelease(plan, Array(5).fill('initial'))
    release[field] = value
    assert.throws(() => classifyDraftAssetRepairState(plan, release), message)
  }

  for (const [field, value, message] of [
    ['id', 123457, /release.author.id/],
    ['login', 'different-release[bot]', /release.author.login/],
    ['type', 'User', /release.author.type/],
  ]) {
    const plan = createPlan()
    const release = createRelease(plan, Array(5).fill('initial'))
    release.author[field] = value
    assert.throws(() => classifyDraftAssetRepairState(plan, release), message)
  }

  const missingAuthor = createRelease(createPlan(), Array(5).fill('initial'))
  missingAuthor.author = null
  assert.throws(
    () => classifyDraftAssetRepairState(createPlan(), missingAuthor),
    /release.author must be an object/
  )
})

test('validates the exact plan schema and all name/ID namespaces', () => {
  const valid = createPlan()
  assert.deepEqual(validateDraftAssetRepairPlan(valid), valid)

  const oldSchema = createPlan()
  oldSchema.schema = 1
  assert.throws(
    () => validateDraftAssetRepairPlan(oldSchema),
    /plan.schema must be 2/
  )

  const extra = createPlan()
  extra.allowOverwrite = true
  assert.throws(
    () => validateDraftAssetRepairPlan(extra),
    /plan has unexpected fields/
  )

  const tooFew = createPlan()
  tooFew.replacements.pop()
  assert.throws(
    () => validateDraftAssetRepairPlan(tooFew),
    /exactly five entries/
  )

  const tooFewPreserved = createPlan()
  tooFewPreserved.preserve.pop()
  assert.throws(
    () => validateDraftAssetRepairPlan(tooFewPreserved),
    /exactly eight entries/
  )

  const duplicateName = createPlan()
  duplicateName.replacements[1].stagingName =
    duplicateName.replacements[0].backupName
  assert.throws(
    () => validateDraftAssetRepairPlan(duplicateName),
    /stagingName is duplicated/
  )

  const duplicateId = createPlan()
  duplicateId.replacements[0].old.id = duplicateId.preserve[0].id
  assert.throws(
    () => validateDraftAssetRepairPlan(duplicateId),
    /old.id is duplicated/
  )

  const ambiguousIdentity = createPlan()
  ambiguousIdentity.replacements[0].new.digest =
    ambiguousIdentity.replacements[0].old.digest
  assert.throws(
    () => validateDraftAssetRepairPlan(ambiguousIdentity),
    /must have different digests/
  )

  for (const [mutate, message] of [
    [
      (plan) => {
        plan.release.name = 'Other release'
      },
      /plan.release.name/,
    ],
    [
      (plan) => {
        plan.release.bodySha256 = 'f'.repeat(64)
      },
      /plan.release.bodySha256/,
    ],
    [
      (plan) => {
        plan.release.createdAt = 'not-a-timestamp'
      },
      /plan.release.createdAt/,
    ],
    [
      (plan) => {
        plan.release.author.id = 0
      },
      /plan.release.author.id/,
    ],
    [
      (plan) => {
        plan.release.author.login = 'not a login'
      },
      /plan.release.author.login/,
    ],
    [
      (plan) => {
        plan.release.author.type = 'Organization'
      },
      /plan.release.author.type/,
    ],
    [
      (plan) => {
        plan.release.author.extra = true
      },
      /plan.release.author has unexpected fields/,
    ],
  ]) {
    const plan = createPlan()
    mutate(plan)
    assert.throws(() => validateDraftAssetRepairPlan(plan), message)
  }
})

test('CLI writes a create-only state file and mirrors it to stdout', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-asset-repair-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const plan = createPlan()
  const release = createRelease(plan, [
    'staged',
    'staged',
    'initial',
    'initial',
    'initial',
  ])
  const planFile = path.join(root, 'plan.json')
  const releaseFile = path.join(root, 'release.json')
  const outputFile = path.join(root, 'nested', 'state.json')
  fs.writeFileSync(planFile, JSON.stringify(plan))
  fs.writeFileSync(releaseFile, JSON.stringify(release))

  const result = spawnSync(
    process.execPath,
    [cli, '--plan', planFile, '--release', releaseFile, '--output', outputFile],
    { encoding: 'utf8' }
  )
  assert.equal(result.status, 0, result.stderr)
  const stdout = JSON.parse(result.stdout)
  assert.deepEqual(JSON.parse(fs.readFileSync(outputFile, 'utf8')), stdout)
  assert.equal(stdout.phase, 'initial')
  assert.equal(stdout.next.replacement, plan.replacements[2].name)
  assert.equal(fs.statSync(outputFile).mode & 0o777, 0o600)

  const retry = spawnSync(
    process.execPath,
    [cli, '--plan', planFile, '--release', releaseFile, '--output', outputFile],
    { encoding: 'utf8' }
  )
  assert.notEqual(retry.status, 0)
  assert.match(retry.stderr, /EEXIST/)
})

test('CLI rejects missing, duplicate, and unexpected arguments', () => {
  for (const args of [[], ['--plan', 'a', '--plan', 'b'], ['--unknown', 'a']]) {
    const result = spawnSync(process.execPath, [cli, ...args], {
      encoding: 'utf8',
    })
    assert.notEqual(result.status, 0)
    assert.match(
      result.stderr,
      /Missing argument|Duplicate argument|Unexpected argument/
    )
  }
})

test(
  'CLI resolves a symlinked entrypoint and still fails closed',
  { skip: process.platform === 'win32' },
  (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-repair-link-'))
    t.after(() => fs.rmSync(root, { recursive: true, force: true }))
    const link = path.join(root, 'draft-repair-state')
    fs.symlinkSync(cli, link)
    const result = spawnSync(process.execPath, [link], { encoding: 'utf8' })
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stderr, /Missing argument: --plan/)
  }
)
