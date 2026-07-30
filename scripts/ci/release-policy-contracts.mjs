import { createHash } from 'node:crypto'
import fs from 'node:fs'

const releaseTrainPolicy = JSON.parse(
  fs.readFileSync(
    new URL('./release-train-policy.json', import.meta.url),
    'utf8'
  )
)

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const LEGACY_BROAD_CANDIDATE_VERIFIER =
  /(?:grep\s+-Ei|-match\s+)[^\n]*(?:llama|mlx|foundation|rag|vector)/i
const YAML_CONTINUE_ON_ERROR =
  /^\s*(?:-\s*)?(?:"continue-on-error"|'continue-on-error'|continue-on-error)\s*:/m
const YAML_IF = /^\s*(?:-\s*)?(?:"if"|'if'|if)\s*:/m

const TRUSTED_CI_SCOPE_COMMAND_ALLOWLIST = new Set([
  // Reviewed active-command sequence for the fail-closed ci-scope detector.
  'e0867c3b7586d4844629574802faf1a99bbe73e5c9d62dad5c90bc38800933c2',
])

const TRUSTED_CI_SCOPE_JOB_ALLOWLIST = new Set([
  // Exact ci-scope job envelope with all native build axes exposed downstream.
  'b6dd841bdaa14442a7528630f2cc52d3b8071468b13173b22e8b88f4c4163977',
])

const TRUSTED_CI_JOB_KEY_ALLOWLIST = new Set([
  'ci-scope',
  'quick-pr-check',
  'release-safety',
  'base_branch_cov',
  'base_branch_rust_cov',
  'test-on-macos',
  'test-on-windows',
  'test-on-windows-pr',
  'test-on-ubuntu',
  'coverage-check',
  'pr-ci-gate',
])

const TRUSTED_CANDIDATE_JOB_ORDER = [
  'tag-cut',
  'preflight',
  'quality-gate',
  'build-macos',
  'build-windows',
  'build-linux',
  'package-candidate',
  'draft-release',
]

const TRUSTED_RECOVERY_JOB_ORDER = [
  'preflight',
  'package-candidate',
  'draft-release',
]

const TRUSTED_CANDIDATE_WORKFLOW_ALLOWLIST = new Set([
  'fb78647a448ce6865fd83142b2a7aafbb20b0b4d2af69fc4624e428b211c2502',
])

const TRUSTED_RECOVERY_WORKFLOW_ALLOWLIST = new Set([
  'adcea2c0c3548852f411ac578f8432cf127fd42e6cb46512de9a47823b12c251',
])

const TRUSTED_DRAFT_REPAIR_WORKFLOW_SHA256 =
  '9cdecb3d08ce892ef9d09eb9fe2458c83ee0f32751b4c9607fb87d048d6e4ac1'

const TRUSTED_DRAFT_REPAIR_STATE_HELPER_SHA256 =
  '70c7ebc91c2227e818b4843425ca234ef6a53b39bd3e9231cfd9fc3d5fc212f2'

const TRUSTED_BIYAN_DOWNLOAD_ALIAS_BOOTSTRAP_JOB_SHA256 =
  'da3f0b7869f3b7e0229af9775a9d4f0bb52c3845a9910d21139bd472d70640fb'

const TRUSTED_RELEASE_DISTRIBUTION_WORKFLOW_SHA256 =
  'c780b58de80c07962f42c43fc658b74b2f7c2734df01fd356cefb80f5480ca76'

const TRUSTED_DIRECT_QUALIFICATION_WORKFLOW_SHA256 =
  'e617339f5ccefeaa227a1c2941a0f252f1cdbd7c951978b96628f4b1e89927a0'

export const TRUSTED_SENSITIVE_UPDATER_WORKFLOW_CONTRACTS = Object.freeze({
  '.github/workflows/biyan-a-canary.yml': Object.freeze({
    exactJobNames: Object.freeze(['preflight', 'platform-canary', 'aggregate']),
    expectedEnvelopeSha256:
      '541f97b65e015d883af4cc19a21eccefedf6e728353fdba023c21906b47293ce',
    expectedPermissions: Object.freeze({
      actions: 'read',
      contents: 'read',
    }),
  }),
  '.github/workflows/promote-desktop-update.yml': Object.freeze({
    exactJobNames: Object.freeze(['promote']),
    expectedEnvelopeSha256:
      '584ecd2d3f56e90dc60d4f6fe528130ace34d41d07ec64c668b6b4f079decfa1',
    expectedPermissions: Object.freeze({
      actions: 'read',
      contents: 'read',
    }),
  }),
  '.github/workflows/recover-split-updater-transaction.yml': Object.freeze({
    exactJobNames: Object.freeze(['recover']),
    expectedEnvelopeSha256:
      '7d023a3b43fc09e03b2fd4e8339165c5206969fc208f1b18a27e5125770fbd77',
    expectedPermissions: Object.freeze({
      contents: 'read',
    }),
  }),
  '.github/workflows/updater-health-gate.yml': Object.freeze({
    exactJobNames: Object.freeze(['evaluate']),
    expectedEnvelopeSha256:
      '52776bab68800f360b65896006238fa0c71278bc91e626cd1c14d64c538585da',
    expectedPermissions: Object.freeze({
      contents: 'read',
    }),
  }),
  '.github/workflows/updater-kill-switch.yml': Object.freeze({
    exactJobNames: Object.freeze(['update']),
    expectedEnvelopeSha256:
      '5460b3edf242cb2591eba8a3cc583c12db2a723e6d637b4642cfc0dfd3044537',
    expectedPermissions: Object.freeze({
      contents: 'read',
    }),
  }),
})

const UPDATER_CONTRACT_TEST_COMMANDS = Object.freeze([
  'node --test scripts/updater/__tests__/a-canary-evidence.test.mjs',
  'node --test scripts/updater/__tests__/legacy-manifest-policy.test.mjs',
  'node --test scripts/updater/__tests__/legacy-pause-transaction.test.mjs',
  'node --test scripts/updater/__tests__/promotion-transaction.test.mjs',
  'node --test scripts/updater/__tests__/updater.test.mjs',
])

const UPDATER_PYTHON_CONTRACT_TESTS = Object.freeze([
  'autoqa/tests/test_migration_runner.py',
  'scripts/updater/__tests__/test_prepare_a_canary_inputs.py',
])

function jobBlock(source, jobName) {
  const header = new RegExp(`^  ${escapeRegExp(jobName)}:\\s*$`, 'm')
  const match = header.exec(source)
  if (!match) return null

  const start = match.index
  const remainder = source.slice(start + match[0].length)
  const nextJob = /^  [A-Za-z0-9_-]+:\s*$/m.exec(remainder)
  return source.slice(
    start,
    nextJob ? start + match[0].length + nextJob.index : source.length
  )
}

function jobNeeds(block, dependency) {
  if (!block) return false
  const needs =
    /^    needs:\s*(?:\[[^\n]*\]|[^\n]*)(?:\n(?:      - [^\n]+\n?)*)?/m.exec(
      block
    )?.[0]
  if (!needs) return false
  return new RegExp(
    `(?:^|[\\s,[{-])${escapeRegExp(dependency)}(?:$|[\\s,\\]}])`
  ).test(needs)
}

function topLevelBlock(source, key) {
  const normalized = source.replace(/\r\n?/g, '\n')
  const header = new RegExp(`^${escapeRegExp(key)}:\\s*(?:#.*)?$`, 'm')
  const match = header.exec(normalized)
  if (!match) return null

  const start = match.index
  const remainder = normalized.slice(start + match[0].length)
  const nextKey = /^[A-Za-z0-9_-]+:\s*(?:[^\n]*)?$/m.exec(remainder)
  return normalized.slice(
    start,
    nextKey ? start + match[0].length + nextKey.index : normalized.length
  )
}

function uncommentedSource(source) {
  return source
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n')
}

function normalizedYamlEnvelope(source) {
  if (typeof source !== 'string') return ''
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  while (lines.length > 0 && /^\s*$/.test(lines.at(-1))) lines.pop()
  return `${lines.join('\n')}\n`
}

function runBlocks(block) {
  if (!block) return []
  const lines = block.replace(/\r\n?/g, '\n').split('\n')
  const blocks = []

  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(\s*)(?:-\s*)?run:\s*(.*)$/.exec(lines[index])
    if (!match) continue

    const indentation = match[1].length
    const inline = match[2].trim()
    const commands = []
    if (inline && !/^[|>][-+]?\s*$/.test(inline)) commands.push(inline)

    if (/^[|>][-+]?\s*$/.test(inline)) {
      for (index += 1; index < lines.length; index += 1) {
        const line = lines[index]
        if (line.trim() && line.match(/^\s*/)[0].length <= indentation) {
          index -= 1
          break
        }
        const command = line.trim()
        if (command && !command.startsWith('#')) commands.push(command)
      }
    }
    blocks.push(commands)
  }
  return blocks
}

function hasRunInvocation(block, invocation, required = []) {
  return runBlocks(block).some((commands) => {
    const executable = commands.some(
      (command) =>
        !/^(?:echo|printf|Write-(?:Host|Output))\b/i.test(command) &&
        invocation.test(command)
    )
    if (!executable) return false
    const text = commands.join('\n')
    return required.every((pattern) => pattern.test(text))
  })
}

function hasCommandSequence(block, expected) {
  return runBlocks(block).some((commands) => {
    for (
      let index = 0;
      index <= commands.length - expected.length;
      index += 1
    ) {
      if (
        expected.every(
          (command, offset) => commands[index + offset] === command
        )
      ) {
        return true
      }
    }
    return false
  })
}

function findRunInvocation(block, invocation) {
  for (const commands of runBlocks(block)) {
    const command = commands.find(
      (candidate) =>
        !/^(?:echo|printf|Write-(?:Host|Output))\b/i.test(candidate) &&
        invocation.test(candidate)
    )
    if (command) return { command, commands }
  }
  return null
}

function validateUpdaterContractTestStep(block, label) {
  const failures = []
  if (!block) {
    return [`${label} is missing the updater contract test step`]
  }
  for (const command of UPDATER_CONTRACT_TEST_COMMANDS) {
    if (
      !hasRunInvocation(
        block,
        new RegExp(`^${escapeRegExp(command)}$`)
      )
    ) {
      failures.push(`${label} does not run: ${command}`)
    }
  }
  if (
    !hasCommandSequence(block, [
      'python3 -m unittest \\',
      `${UPDATER_PYTHON_CONTRACT_TESTS[0]} \\`,
      UPDATER_PYTHON_CONTRACT_TESTS[1],
    ])
  ) {
    failures.push(
      `${label} does not run the exact Python updater contract tests: ${UPDATER_PYTHON_CONTRACT_TESTS.join(
        ', '
      )}`
    )
  }
  return failures
}

function actionStepBlocks(source, action) {
  const normalized = source.replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')
  const escaped = escapeRegExp(action)
  const blocks = []
  for (let index = 0; index < lines.length; index += 1) {
    const match = new RegExp(`^(\\s*)(-\\s*)?uses:\\s*${escaped}\\s*$`).exec(
      lines[index]
    )
    if (!match) continue
    const stepIndent = match[2]
      ? match[1].length
      : Math.max(0, match[1].length - 2)
    let end = index + 1
    for (; end < lines.length; end += 1) {
      if (
        lines[end].trim() &&
        new RegExp(`^\\s{${stepIndent}}-\\s+`).test(lines[end])
      ) {
        break
      }
    }
    blocks.push(lines.slice(index, end).join('\n'))
  }
  return blocks
}

function workflowStepBlocks(source) {
  const normalized = source.replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')
  const stepsHeaderIndex = lines.findIndex((line) =>
    /^(\s*)steps:\s*$/.test(line)
  )
  if (stepsHeaderIndex < 0) return []

  const headerIndent = /^(\s*)/.exec(lines[stepsHeaderIndex])?.[1].length ?? 0
  const stepIndent = headerIndent + 2
  const stepStart = new RegExp(`^\\s{${stepIndent}}-\\s+`)
  const blocks = []
  let index = stepsHeaderIndex + 1

  while (index < lines.length) {
    if (
      lines[index].trim() &&
      (lines[index].match(/^\s*/)?.[0].length ?? 0) <= headerIndent
    ) {
      break
    }
    if (!stepStart.test(lines[index])) {
      index += 1
      continue
    }
    const start = index
    index += 1
    while (index < lines.length && !stepStart.test(lines[index])) {
      if (
        lines[index].trim() &&
        (lines[index].match(/^\s*/)?.[0].length ?? 0) <= headerIndent
      ) {
        break
      }
      index += 1
    }
    blocks.push(lines.slice(start, index).join('\n'))
  }
  return blocks
}

function workflowJobKeys(source) {
  const jobs = topLevelBlock(source, 'jobs')
  if (!jobs) return []
  return [...jobs.matchAll(/^  ([A-Za-z0-9_-]+):\s*$/gm)].map(
    (match) => match[1]
  )
}

function jobPermissionBlocks(job) {
  if (!job) return []
  const lines = job.replace(/\r\n?/g, '\n').split('\n')
  const blocks = []
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^    permissions:\s*/.test(lines[index])) continue
    const block = [lines[index]]
    for (index += 1; index < lines.length; index += 1) {
      if (
        lines[index].trim() &&
        (lines[index].match(/^\s*/)?.[0].length ?? 0) <= 4
      ) {
        index -= 1
        break
      }
      block.push(lines[index])
    }
    blocks.push(block.join('\n'))
  }
  return blocks
}

function validateReleaseWorkflowControlPlane(
  source,
  expectedJobOrder,
  trustedWorkflowHashes,
  workflowLabel,
  {
    requireReviewedEnvelope = false,
    writePermissionJobs = new Set(['draft-release']),
  } = {}
) {
  const failures = []
  const jobKeys = workflowJobKeys(source)
  if (
    jobKeys.length !== expectedJobOrder.length ||
    jobKeys.some((jobName, index) => jobName !== expectedJobOrder[index])
  ) {
    failures.push(
      `${workflowLabel} jobs must match the reviewed ordered job allowlist`
    )
  }

  for (const jobName of jobKeys) {
    if (
      !writePermissionJobs.has(jobName) &&
      jobPermissionBlocks(jobBlock(source, jobName)).some((permissions) =>
        /\bwrite(?:-all)?\b/.test(permissions)
      )
    ) {
      failures.push(
        `${workflowLabel} only ${[...writePermissionJobs].join(
          ' and '
        )} may request write permissions`
      )
    }
  }

  if (requireReviewedEnvelope) {
    const sha256 = createHash('sha256')
      .update(normalizedYamlEnvelope(source))
      .digest('hex')
    if (!trustedWorkflowHashes.has(sha256)) {
      failures.push(
        `${workflowLabel} must match the reviewed whole-workflow execution-envelope allowlist (got ${sha256})`
      )
    }
  }

  return failures
}

const LIVE_MAIN_RELEASE_PROBE =
  'git ls-remote --exit-code origin refs/heads/mita-main'
const LIVE_TAG_RELEASE_PROBE = '"refs/tags/$RELEASE_TAG^{}"'
const LIVE_MAIN_RELEASE_RESOLVER = `live_main="$(${LIVE_MAIN_RELEASE_PROBE} | awk 'NF == 2 { print $1 }')"`
const LIVE_TAG_RELEASE_RESOLVER = [
  'tag_refs="$(git ls-remote --exit-code origin',
  `"refs/tags/$RELEASE_TAG" ${LIVE_TAG_RELEASE_PROBE})"`,
  `live_tag="$(printf '%s\\n' "$tag_refs" | awk -v tag="refs/tags/$RELEASE_TAG" '`,
  '$2 == tag { direct = $1 }',
  '$2 == tag "^{}" { peeled = $1 }',
  'END { print (peeled != "" ? peeled : direct) }',
]

function stepPinsReleaseSource(step, beforeNeedle = null) {
  if (!step) return false
  const boundary =
    beforeNeedle === null ? step.length : step.indexOf(beforeNeedle)
  if (boundary < 0) return false
  const guarded = step.slice(0, boundary)
  return (
    guarded.includes(
      'EXPECTED_MAIN: ${{ needs.preflight.outputs.trusted_main_commit }}'
    ) &&
    guarded.includes(
      'EXPECTED_SOURCE: ${{ needs.preflight.outputs.source_commit }}'
    ) &&
    guarded.includes('RELEASE_TAG: ${{ needs.preflight.outputs.tag }}') &&
    guarded.includes(LIVE_MAIN_RELEASE_RESOLVER) &&
    LIVE_TAG_RELEASE_RESOLVER.every((needle) => guarded.includes(needle)) &&
    guarded.includes('[[ ! "$live_main" =~ ^[0-9a-f]{40}$ ]]') &&
    guarded.includes('[[ ! "$live_tag" =~ ^[0-9a-f]{40}$ ]]') &&
    guarded.includes('[ "$live_main" != "$EXPECTED_MAIN" ]') &&
    guarded.includes('[ "$live_tag" != "$EXPECTED_SOURCE" ]') &&
    (guarded.match(/\bexit 1\b/g) ?? []).length >= 2
  )
}

function jobPinsReleaseSourceBefore(
  block,
  mutationNeedle,
  { afterNeedle = null } = {}
) {
  const steps = workflowStepBlocks(block)
  const mutationStep = steps.findIndex((step) => step.includes(mutationNeedle))
  if (mutationStep < 0) return false
  const afterStep =
    afterNeedle === null
      ? -1
      : steps.findIndex((step) => step.includes(afterNeedle))
  if (afterNeedle !== null && afterStep < 0) return false

  for (let index = mutationStep; index > afterStep; index -= 1) {
    if (
      index === mutationStep
        ? stepPinsReleaseSource(steps[index], mutationNeedle)
        : stepPinsReleaseSource(steps[index])
    ) {
      return true
    }
  }
  return false
}

function stepLoadsCreatedDraftId(step) {
  const commands = runBlocks(step).flat()
  const assignmentIndex = commands.indexOf('release_id="$(')
  const selectorIndex = commands.indexOf(
    'jq -er \'.id | select(type == "number" and . > 0)\' \\'
  )
  const sourceIndex = commands.indexOf('"$RUNNER_TEMP/created-draft.json"')
  const closeIndex = commands.indexOf(')"')
  return (
    commands.filter((command) => /^release_id=/.test(command)).length === 1 &&
    assignmentIndex >= 0 &&
    selectorIndex === assignmentIndex + 1 &&
    sourceIndex === selectorIndex + 1 &&
    closeIndex === sourceIndex + 1
  )
}

function stepWaitsForCreatedDraftReadback(step) {
  if (!step) return false
  return (
    step.includes('draft_visible=0') &&
    step.includes('for attempt in {1..15}; do') &&
    hasCommandSequence(step, [
      'if ! gh api \\',
      '--paginate \\',
      '--slurp \\',
      '"repos/$GITHUB_REPOSITORY/releases?per_page=100" \\',
      '>"$RUNNER_TEMP/post-create-release-pages.json"; then',
    ]) &&
    step.includes('Unable to enumerate the newly created Draft') &&
    step.includes('matching_ids="$(') &&
    step.includes('[.[][] | select(.tag_name == $tag) | .id]') &&
    step.includes('[ "$matching_ids" = "[$release_id]" ]') &&
    step.includes('draft_visible=1') &&
    step.includes('[ "$matching_ids" != "[]" ]') &&
    step.includes('Draft readback returned a conflicting release ID') &&
    step.includes('if [ "$attempt" -lt 15 ]; then') &&
    (step.match(/\bsleep 2\b/g) ?? []).length === 1 &&
    step.includes('if [ "$draft_visible" -ne 1 ]; then') &&
    step.includes('Newly created Draft did not become visible') &&
    (step.match(/\bexit 1\b/g) ?? []).length >= 3
  )
}

function jobUsesScopeFlag(block, flag) {
  if (!block) return false
  const names = Array.isArray(flag) ? flag : [flag]
  return names.some((name) =>
    new RegExp(
      `needs\\.ci-scope\\.outputs\\.${escapeRegExp(name)}\\s*==\\s*['\"]true['\"]`
    ).test(uncommentedSource(block))
  )
}

export function validateReleaseTrainPolicy(policy) {
  const failures = []
  const exactKeys = (value, expected, description) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      failures.push(`${description} must be an object`)
      return
    }
    const actual = Object.keys(value).sort()
    const wanted = [...expected].sort()
    if (
      actual.length !== wanted.length ||
      actual.some((key, index) => key !== wanted[index])
    ) {
      failures.push(
        `${description} keys must be exactly ${wanted.join(', ')}; found ${
          actual.join(', ') || '(none)'
        }`
      )
    }
  }
  exactKeys(
    policy,
    [
      'schema',
      'activeTrain',
      'supersededTerminalReleases',
      'activeTerminalRelease',
      'trains',
    ],
    'release train policy'
  )
  if (policy?.schema !== 3) {
    failures.push('release train policy must use schema 3')
  }
  if (!Array.isArray(policy?.trains) || policy.trains.length === 0) {
    failures.push('release train policy must declare at least one train')
    return failures
  }

  const terminal = policy.activeTerminalRelease
  const terminalMode = terminal !== null && terminal !== undefined
  const supersededTerminals = policy.supersededTerminalReleases
  if (!Array.isArray(supersededTerminals)) {
    failures.push('release train policy must declare superseded terminal releases')
  } else if (
    (terminalMode && supersededTerminals.length !== 3) ||
    (!terminalMode && supersededTerminals.length !== 0)
  ) {
    failures.push(
      'release train policy must preserve exactly three superseded terminals only in terminal mode'
    )
  }
  const active = policy.trains.filter((train) => train?.status === 'active')
  if (terminalMode) {
    if (active.length !== 0 || policy.activeTrain !== null) {
      failures.push(
        'terminal release policy must retire every active train and set activeTrain to null'
      )
    }
  } else if (
    active.length !== 1 ||
    typeof policy.activeTrain !== 'string' ||
    active[0]?.id !== policy.activeTrain
  ) {
    failures.push(
      'release train policy must name exactly one matching active train'
    )
  }

  const ids = new Set()
  const versions = new Set()
  const allowedStatuses = new Set([
    'failed-preserved',
    'accepted-pretag-superseded',
    'active',
    'superseded-by-terminal',
  ])
  let previousC = null
  for (const [trainIndex, train] of policy.trains.entries()) {
    if (!train || typeof train.id !== 'string' || !train.id) {
      failures.push('every release train must have a non-empty id')
      continue
    }
    exactKeys(train, ['id', 'status', 'releases'], `release train ${train.id}`)
    if (!allowedStatuses.has(train.status)) {
      failures.push(
        `release train ${train.id} has unsupported status ${train.status}`
      )
    }
    const isFinalTrain = trainIndex === policy.trains.length - 1
    if (terminalMode) {
      if (
        (train.status === 'superseded-by-terminal') !== isFinalTrain
      ) {
        failures.push(
          'terminal release policy must mark only the final history train superseded-by-terminal'
        )
      }
    } else if ((train.status === 'active') !== isFinalTrain) {
      failures.push('the active release train must be the final history entry')
    }
    if (ids.has(train.id)) {
      failures.push(`duplicate release train id: ${train.id}`)
    }
    ids.add(train.id)

    const releases = train.releases
    if (!releases || Object.keys(releases).sort().join(',') !== 'A,B,C') {
      failures.push(`release train ${train.id} must contain exactly A, B, C`)
      continue
    }

    const parsedVersions = []
    for (const [phase, expectedSchema] of [
      ['A', 1],
      ['B', 2],
      ['C', 3],
    ]) {
      const release = releases[phase]
      exactKeys(
        release,
        ['version', 'dataSchema'],
        `release train ${train.id} ${phase}`
      )
      const match =
        typeof release?.version === 'string'
          ? /^(\d+)\.(\d+)\.(\d+)$/.exec(release.version)
          : null
      if (!match || release.dataSchema !== expectedSchema) {
        failures.push(
          `release train ${train.id} has invalid ${phase} version/schema`
        )
        continue
      }
      if (versions.has(release.version)) {
        failures.push(`duplicate release version: ${release.version}`)
      }
      versions.add(release.version)
      parsedVersions.push(match.slice(1).map(Number))
    }

    if (
      parsedVersions.length === 3 &&
      (parsedVersions.some(
        ([major, minor]) =>
          major !== parsedVersions[0][0] || minor !== parsedVersions[0][1]
      ) ||
        parsedVersions[1][2] !== parsedVersions[0][2] + 1 ||
        parsedVersions[2][2] !== parsedVersions[1][2] + 1)
    ) {
      failures.push(
        `release train ${train.id} versions must be contiguous in A -> B -> C order`
      )
    }
    if (parsedVersions.length === 3) {
      const [activeA, , activeC] = parsedVersions
      if (
        previousC &&
        (activeA[0] !== previousC[0] ||
          activeA[1] !== previousC[1] ||
          activeA[2] !== previousC[2] + 1)
      ) {
        failures.push(
          `release train ${train.id} must start immediately after the previous C version`
        )
      }
      previousC = activeC
    }
  }

  const expectedSupersededTerminals = [
    {
      tag: 'v0.6.646',
      version: '0.6.646',
      migrationPhase: 'C',
      dataSchema: 3,
      sourceCommit: '581ebf6b19ef407a9645d0b318792f1012f8f75b',
      status: 'blocked-before-publication',
    },
    {
      tag: 'v0.6.647',
      version: '0.6.647',
      migrationPhase: 'C',
      dataSchema: 3,
      sourceCommit: 'ef963bc606366220db4589352afb25aa7d1785bf',
      status: 'blocked-before-publication',
    },
    {
      tag: 'v0.6.648',
      version: '0.6.648',
      migrationPhase: 'C',
      dataSchema: 3,
      sourceCommit: '33e8c5b03278b2b91318a553eb3b699b19c6ad1e',
      status: 'blocked-before-publication',
    },
  ]
  const preservedTerminalVersions = []
  if (Array.isArray(supersededTerminals)) {
    for (const [index, preserved] of supersededTerminals.entries()) {
      const expected = expectedSupersededTerminals[index]
      exactKeys(
        preserved,
        [
          'tag',
          'version',
          'migrationPhase',
          'dataSchema',
          'sourceCommit',
          'status',
        ],
        `superseded terminal release ${index}`
      )
      if (
        !expected ||
        preserved?.tag !== expected.tag ||
        preserved?.version !== expected.version ||
        preserved?.migrationPhase !== expected.migrationPhase ||
        preserved?.dataSchema !== expected.dataSchema ||
        preserved?.sourceCommit !== expected.sourceCommit ||
        preserved?.status !== expected.status ||
        preserved?.tag !== `v${preserved?.version}`
      ) {
        failures.push(
          'superseded terminal history must exactly preserve blocked v0.6.646, v0.6.647, and v0.6.648 C/3 releases'
        )
      }
      if (versions.has(preserved?.version)) {
        failures.push(`duplicate release version: ${preserved.version}`)
      }
      versions.add(preserved?.version)
      const match =
        typeof preserved?.version === 'string'
          ? /^(\d+)\.(\d+)\.(\d+)$/.exec(preserved.version)
          : null
      if (match) preservedTerminalVersions.push(match.slice(1).map(Number))
    }
  }

  const firstPreservedTerminalVersion = preservedTerminalVersions[0]
  if (
    terminalMode &&
    previousC &&
    (!firstPreservedTerminalVersion ||
      previousC[0] !== firstPreservedTerminalVersion[0] ||
      previousC[1] !== firstPreservedTerminalVersion[1] ||
      previousC[2] + 1 !== firstPreservedTerminalVersion[2])
  ) {
    failures.push(
      'superseded terminal v0.6.646 must immediately follow the final preserved train C 0.6.645'
    )
  }
  for (let index = 1; index < preservedTerminalVersions.length; index += 1) {
    const previous = preservedTerminalVersions[index - 1]
    const current = preservedTerminalVersions[index]
    if (
      current[0] !== previous[0] ||
      current[1] !== previous[1] ||
      current[2] !== previous[2] + 1
    ) {
      failures.push('superseded terminal releases must be contiguous')
    }
  }

  if (terminal !== null && terminal !== undefined) {
    exactKeys(
      terminal,
      [
        'tag',
        'version',
        'migrationPhase',
        'dataSchema',
        'sourceCommit',
      ],
      'active terminal release'
    )
    if (
      terminal?.tag !== 'v0.6.649' ||
      terminal?.version !== '0.6.649' ||
      terminal?.migrationPhase !== 'C' ||
      terminal?.dataSchema !== 3 ||
      terminal?.tag !== `v${terminal?.version}` ||
      !/^[0-9a-f]{40}$/.test(terminal?.sourceCommit ?? '')
    ) {
      failures.push(
        'active terminal release must exactly bind v0.6.649/C/3 to one lowercase 40-hex source commit'
      )
    }
    if (versions.has(terminal?.version)) {
      failures.push(`duplicate release version: ${terminal.version}`)
    }
    const lastPreservedTerminalVersion = preservedTerminalVersions.at(-1)
    if (
      lastPreservedTerminalVersion &&
      (lastPreservedTerminalVersion[0] !== 0 ||
        lastPreservedTerminalVersion[1] !== 6 ||
        lastPreservedTerminalVersion[2] !== 648 ||
        terminal?.version !== '0.6.649')
    ) {
      failures.push(
        'active terminal release v0.6.649 must immediately follow superseded terminal v0.6.648'
      )
    }
  }
  return failures
}

export function validateReleaseIdentity({
  version,
  migrationPhase,
  dataSchema,
  cargoLockVersion,
  trainPolicy = releaseTrainPolicy,
}) {
  const failures = validateReleaseTrainPolicy(trainPolicy)
  const expectedSchema = { A: 1, B: 2, C: 3 }[migrationPhase]
  if (!expectedSchema || dataSchema !== expectedSchema) {
    failures.push(
      `invalid migration phase/data schema pairing: ${migrationPhase}/${dataSchema}`
    )
  }
  if (cargoLockVersion !== version) {
    failures.push(
      `Cargo.lock version ${cargoLockVersion} does not match product version ${version}`
    )
  }

  const terminalRelease =
    trainPolicy?.activeTerminalRelease?.version === version
      ? {
          ...trainPolicy.activeTerminalRelease,
          trainId: 'activeTerminalRelease',
        }
      : null
  const bridgeTrain = terminalRelease ?? trainPolicy?.trains
    ?.flatMap((train) =>
      Object.entries(train.releases ?? {}).map(([phase, release]) => ({
        ...release,
        migrationPhase: phase,
        trainId: train.id,
      }))
    )
    .find((release) => release.version === version)
  if (!bridgeTrain) {
    failures.push(
      `release ${version} is not declared in release-train-policy.json`
    )
    return failures
  }
  if (
    migrationPhase !== bridgeTrain.migrationPhase ||
    dataSchema !== bridgeTrain.dataSchema
  ) {
    failures.push(
      `release ${version} in ${bridgeTrain.trainId} must attest ${bridgeTrain.migrationPhase}/${bridgeTrain.dataSchema}`
    )
  }
  return failures
}

export function validateActiveReleaseIdentity({
  version,
  migrationPhase,
  dataSchema,
  cargoLockVersion,
  trainPolicy = releaseTrainPolicy,
}) {
  const failures = validateReleaseIdentity({
    version,
    migrationPhase,
    dataSchema,
    cargoLockVersion,
    trainPolicy,
  })
  const terminalRelease = trainPolicy?.activeTerminalRelease
  if (terminalRelease !== null && terminalRelease !== undefined) {
    if (
      terminalRelease.version !== version ||
      terminalRelease.migrationPhase !== migrationPhase ||
      terminalRelease.dataSchema !== dataSchema
    ) {
      failures.push(
        `release ${version} ${migrationPhase}/${dataSchema} is not the declared active terminal release ${terminalRelease.version}/${terminalRelease.migrationPhase}/${terminalRelease.dataSchema}`
      )
    }
    return failures
  }
  const activeTrain = trainPolicy?.trains?.find(
    (train) => train.id === trainPolicy.activeTrain && train.status === 'active'
  )
  const activeRelease = activeTrain?.releases?.[migrationPhase]
  if (
    !activeRelease ||
    activeRelease.version !== version ||
    activeRelease.dataSchema !== dataSchema
  ) {
    failures.push(
      `release ${version} ${migrationPhase}/${dataSchema} is not the declared active train ${trainPolicy?.activeTrain ?? 'missing'} release`
    )
  }
  return failures
}

export function validateActiveTerminalReleaseBinding({
  releaseTag,
  version,
  migrationPhase,
  dataSchema,
  sourceCommit,
  trainPolicy = releaseTrainPolicy,
}) {
  const failures = validateReleaseTrainPolicy(trainPolicy)
  const terminal = trainPolicy?.activeTerminalRelease
  if (terminal === null || terminal === undefined) {
    failures.push('release policy has no active terminal release binding')
    return failures
  }
  if (
    terminal.tag !== releaseTag ||
    terminal.version !== version ||
    terminal.migrationPhase !== migrationPhase ||
    terminal.dataSchema !== dataSchema ||
    terminal.sourceCommit !== sourceCommit
  ) {
    failures.push(
      `release ${releaseTag}/${sourceCommit}/${migrationPhase}/${dataSchema} does not match the active terminal release binding`
    )
  }
  return failures
}

export function validateLinuxReleaseBuild(
  makefile,
  packageJson,
  buildCliScript,
  linuxTauriConfig
) {
  const failures = []
  const normalizedMakefile = makefile.replace(/\r\n?/g, '\n')
  const normalizedBuildCliScript =
    typeof buildCliScript === 'string'
      ? buildCliScript.replace(/\r\n?/g, '\n')
      : buildCliScript
  const buildCli = normalizedMakefile.match(
    /^build-cli:\s*$([\s\S]*?)(?=^[A-Za-z0-9_.-]+:\s*(?:.*)?$)/m
  )?.[1]
  const linuxBranch = buildCli?.match(
    /^else ifeq \(\$\(DETECTED_OS\),Linux\)\s*$([\s\S]*?)(?=^else(?:\s|$)|^endif\s*$)/m
  )?.[1]
  const linuxRecipes = linuxBranch?.split('\n') ?? []
  const recipeIndex = (recipe) => linuxRecipes.indexOf(`\t${recipe}`)
  const cliBuildIndex = recipeIndex(
    'cd src-tauri && cargo build --release --features cli --bin biyan-cli'
  )
  const cliDirectoryIndex = recipeIndex(
    "$(call MKDIR,'src-tauri/resources/bin')"
  )
  const cliInstallIndex = recipeIndex(
    'install -m755 src-tauri/target/release/biyan-cli src-tauri/resources/bin/biyan-cli'
  )
  const runnerBuildIndex = recipeIndex(
    'cd src-tauri && cargo build --release --features computer-agent-runner --bin biyan-computer-agent-runner'
  )
  const runnerDirectoryIndex = recipeIndex(
    "$(call MKDIR,'src-tauri/resources/computer-agent-runner')"
  )
  const runnerInstallIndex = recipeIndex(
    'install -m755 src-tauri/target/release/biyan-computer-agent-runner src-tauri/resources/computer-agent-runner/biyan-computer-agent-runner'
  )

  if (runnerBuildIndex < 0) {
    failures.push(
      'Linux build-cli must compile the release biyan-computer-agent-runner before Tauri bundling'
    )
  }
  if (
    cliBuildIndex < 0 ||
    cliDirectoryIndex <= cliBuildIndex ||
    cliInstallIndex <= cliDirectoryIndex ||
    (runnerBuildIndex >= 0 && cliInstallIndex >= runnerBuildIndex)
  ) {
    failures.push(
      'Linux build-cli must install an executable biyan-cli before compiling the computer-agent runner'
    )
  }
  if (
    runnerBuildIndex < 0 ||
    runnerDirectoryIndex <= runnerBuildIndex ||
    runnerInstallIndex <= runnerDirectoryIndex
  ) {
    failures.push(
      'Linux build-cli must install the executable biyan-computer-agent-runner after compiling it'
    )
  }

  const linuxResources = linuxTauriConfig?.bundle?.resources
  if (
    !Array.isArray(linuxResources) ||
    !linuxResources.includes('resources/computer-agent-runner/**/*')
  ) {
    failures.push(
      'Linux bundle must include resources/computer-agent-runner/**/*'
    )
  }

  if (
    packageJson?.scripts?.['build:cli'] !==
    'node ./scripts/build-cli.mjs --release'
  ) {
    failures.push(
      'build:cli must delegate the release build to scripts/build-cli.mjs'
    )
  }
  if (
    typeof normalizedBuildCliScript !== 'string' ||
    !/^const makeTarget = isDev \? 'build-cli-dev' : 'build-cli'$/m.test(
      normalizedBuildCliScript
    ) ||
    !/^if \(process\.platform !== 'win32' && !cliOnly\) \{\n  run\('make', \[makeTarget\]\)\n  process\.exit\(0\)\n\}$/m.test(
      normalizedBuildCliScript
    )
  ) {
    failures.push(
      'scripts/build-cli.mjs must run the Makefile build-cli target on Linux'
    )
  }

  const linuxScript = packageJson?.scripts?.['build:tauri:linux']
  const buildCliIndex =
    typeof linuxScript === 'string' ? linuxScript.indexOf('yarn build:cli') : -1
  const tauriBuildIndex =
    typeof linuxScript === 'string'
      ? linuxScript.indexOf('yarn tauri build')
      : -1
  if (
    buildCliIndex < 0 ||
    tauriBuildIndex < 0 ||
    buildCliIndex > tauriBuildIndex
  ) {
    failures.push(
      'build:tauri:linux must run yarn build:cli before yarn tauri build'
    )
  }

  return failures
}

export function validateBundledLegalResources(platformConfigs) {
  const failures = []
  for (const [platform, config] of Object.entries(platformConfigs)) {
    const resources = config?.bundle?.resources
    const bundledPaths = Array.isArray(resources)
      ? resources
      : resources && typeof resources === 'object'
        ? Object.keys(resources)
        : null
    if (!bundledPaths) {
      failures.push(`${platform} bundle resources must be an array or object`)
      continue
    }
    for (const legalFile of ['resources/LICENSE', 'resources/NOTICE']) {
      if (!bundledPaths.includes(legalFile)) {
        failures.push(`${platform} bundle must include ${legalFile}`)
      }
    }
  }
  return failures
}

export function validateDocsArchiveConfig(tsconfig) {
  const failures = []
  if (
    !Array.isArray(tsconfig?.exclude) ||
    !tsconfig.exclude.includes('unpublished-upstream-history')
  ) {
    failures.push(
      'docs tsconfig must exclude unpublished-upstream-history from production typechecking'
    )
  }
  return failures
}

export function validateCandidateWorkflow(
  source,
  { requireReviewedEnvelope = false } = {}
) {
  const failures = []
  const activeSource = uncommentedSource(source)
  const on = topLevelBlock(activeSource, 'on')
  const tagCut = jobBlock(activeSource, 'tag-cut')
  const preflight = jobBlock(activeSource, 'preflight')
  const qualityGate = jobBlock(activeSource, 'quality-gate')
  const packageCandidate = jobBlock(activeSource, 'package-candidate')
  const draftRelease = jobBlock(activeSource, 'draft-release')
  const permissions = topLevelBlock(activeSource, 'permissions')
  const concurrency = topLevelBlock(activeSource, 'concurrency')
  const checkoutSteps = actionStepBlocks(activeSource, 'actions/checkout@v4')
  const diagnosticBestEffort = 'jq . "$tag_json" >&2 || true'
  const diagnosticBestEffortCount =
    activeSource.split(diagnosticBestEffort).length - 1
  const bypassCheckedSource = activeSource.replace(diagnosticBestEffort, '')

  const triggerKeys = on
    ? [...on.matchAll(/^  ([A-Za-z0-9_-]+):\s*$/gm)].map((match) => match[1])
    : []
  if (
    triggerKeys.length !== 1 ||
    triggerKeys[0] !== 'workflow_dispatch' ||
    !on.includes('version:') ||
    !/^\s{8}required:\s*true\s*$/m.test(on) ||
    !/^\s{8}type:\s*string\s*$/m.test(on) ||
    /\b(?:push|pull_request|release|schedule):/.test(on) ||
    /github\.(?:ref_name|event\.inputs)/.test(activeSource)
  ) {
    failures.push(
      'desktop release must be workflow_dispatch-only with one required exact version input'
    )
  }

  if (
    requireReviewedEnvelope &&
    !/^name:\s*Desktop Release Candidate\s*$/m.test(activeSource)
  ) {
    failures.push('desktop release must keep the exact reviewed workflow name')
  }

  if (
    YAML_CONTINUE_ON_ERROR.test(activeSource) ||
    YAML_IF.test(activeSource) ||
    diagnosticBestEffortCount > 1 ||
    /\|\|\s*true\b/.test(bypassCheckedSource)
  ) {
    failures.push(
      'desktop release jobs and steps must be unconditional and must not use advisory bypasses'
    )
  }

  if (
    !concurrency ||
    normalizedYamlEnvelope(concurrency) !==
      'concurrency:\n  group: desktop-candidate-${{ inputs.version }}\n  cancel-in-progress: false\n' ||
    /\|\||github\.ref_name|github\.event\.inputs/.test(concurrency)
  ) {
    failures.push(
      'desktop release must serialize only the exact manually requested candidate tag without a ref fallback'
    )
  }
  if (
    !permissions ||
    !/^  contents:\s*read\s*$/m.test(permissions) ||
    /\bwrite\b/.test(permissions)
  ) {
    failures.push(
      'desktop release top-level permissions must be contents: read only'
    )
  }
  if (
    checkoutSteps.some(
      (step) => !/^\s*persist-credentials:\s*false\s*$/m.test(step)
    )
  ) {
    failures.push(
      'desktop release checkouts must disable persisted credentials'
    )
  }
  if (
    !draftRelease ||
    !/^    permissions:\s*\n      actions:\s*read\s*\n      contents:\s*write\s*$/m.test(
      draftRelease
    )
  ) {
    failures.push(
      'only the draft release job may request actions: read plus contents: write permission'
    )
  }
  if (!tagCut) {
    failures.push('desktop release is missing the protected exact tag-cut job')
  } else {
    const tagCutPermissions = jobPermissionBlocks(tagCut)
    const tagCutUses = tagCut.match(/^\s*(?:-\s*)?uses:\s*.+$/gm) ?? []
    const tokenReferences = tagCut.match(/\$\{\{\s*github\.token\s*\}\}/g) ?? []
    if (
      !/^    environment:\s*release-distribution\s*$/m.test(tagCut) ||
      tagCutPermissions.length !== 1 ||
      normalizedYamlEnvelope(tagCutPermissions[0]) !==
        '    permissions:\n      contents: write\n'
    ) {
      failures.push(
        'tag-cut must be the exact contents: write release-distribution permission domain'
      )
    }
    if (
      tagCutUses.length !== 0 ||
      /\$\{\{\s*secrets\./.test(tagCut) ||
      /\b(?:TAURI_SIGNING_PRIVATE_KEY|BIYAN_SIGNING_KEY)\b/.test(tagCut) ||
      tokenReferences.length !== 1 ||
      !tagCut.includes('GH_TOKEN: ${{ github.token }}')
    ) {
      failures.push(
        'tag-cut must use no action, checkout, or secret and only the current github.token'
      )
    }
    if (
      !tagCut.includes(
        'contents/scripts/ci/release-train-policy.json?ref=$live_main'
      ) ||
      !tagCut.includes("--jq '.content'") ||
      !tagCut.includes('| base64 --decode') ||
      !tagCut.includes('.schema == 3') ||
      !tagCut.includes('.activeTrain == null') ||
      !/\(\[\.trains\[\]\s*\|\s*select\(\.status == "active"\)\]\s*\|\s*length\)\s*== 0/.test(
        tagCut
      ) ||
      !/\(\[\.trains\[\]\s*\|\s*select\(\.status == "superseded-by-terminal"\)\]\s*\|\s*length\)\s*== 1/.test(
        tagCut
      ) ||
      !tagCut.includes(
        '.trains[-1].status == "superseded-by-terminal"'
      ) ||
      !tagCut.includes(
        '(.supersededTerminalReleases | length) == 3'
      ) ||
      !tagCut.includes(
        '.supersededTerminalReleases[0].tag == "v0.6.646"'
      ) ||
      !tagCut.includes(
        '.supersededTerminalReleases[0].sourceCommit == "581ebf6b19ef407a9645d0b318792f1012f8f75b"'
      ) ||
      !tagCut.includes(
        '.supersededTerminalReleases[0].status == "blocked-before-publication"'
      ) ||
      !tagCut.includes(
        '.supersededTerminalReleases[1].tag == "v0.6.647"'
      ) ||
      !tagCut.includes(
        '.supersededTerminalReleases[1].sourceCommit == "ef963bc606366220db4589352afb25aa7d1785bf"'
      ) ||
      !tagCut.includes(
        '.supersededTerminalReleases[1].status == "blocked-before-publication"'
      ) ||
      !tagCut.includes(
        '.supersededTerminalReleases[2].tag == "v0.6.648"'
      ) ||
      !tagCut.includes(
        '.supersededTerminalReleases[2].sourceCommit == "33e8c5b03278b2b91318a553eb3b699b19c6ad1e"'
      ) ||
      !tagCut.includes(
        '.supersededTerminalReleases[2].status == "blocked-before-publication"'
      ) ||
      !tagCut.includes('.activeTerminalRelease.tag == $tag') ||
      !tagCut.includes('.activeTerminalRelease.tag == "v0.6.649"') ||
      !tagCut.includes('.activeTerminalRelease.version == "0.6.649"') ||
      !tagCut.includes('.activeTerminalRelease.migrationPhase == "C"') ||
      !tagCut.includes('.activeTerminalRelease.dataSchema == 3') ||
      !tagCut.includes('test("^[0-9a-f]{40}$")') ||
      !tagCut.includes(
        `jq -er '.activeTerminalRelease.sourceCommit' "$policy_json"`
      ) ||
      !tagCut.includes(
        'echo "Release tag is not the exact active terminal policy binding: $RELEASE_TAG"'
      ) ||
      /\bv0\.6\.(?:643|644|645)\b/.test(tagCut)
    ) {
      failures.push(
        'tag-cut must preserve blocked v0.6.646, v0.6.647, and v0.6.648 releases and resolve only the exact v0.6.649/C/3 terminal source binding from protected live-main policy'
      )
    }
    if (
      !tagCut.includes('RELEASE_TAG: ${{ inputs.version }}') ||
      !tagCut.includes('WORKFLOW_REF: ${{ github.ref }}') ||
      !tagCut.includes('WORKFLOW_SHA: ${{ github.sha }}') ||
      !tagCut.includes(
        `if [ "$WORKFLOW_REF" != "refs/heads/mita-main" ]; then
            echo "Candidate dispatch must use protected mita-main" >&2
            exit 1
          fi`
      ) ||
      !tagCut.includes(
        '"repos/$GITHUB_REPOSITORY/branches/mita-main" --jq \'.commit.sha\''
      ) ||
      !tagCut.includes('[ "$WORKFLOW_SHA" != "$live_main" ]') ||
      !tagCut.includes(
        '"repos/$GITHUB_REPOSITORY/commits/$source_commit" --jq \'.sha\''
      ) ||
      !tagCut.includes(
        '"repos/$GITHUB_REPOSITORY/compare/$source_commit...$live_main"'
      ) ||
      !tagCut.includes('.base_commit.sha == $source') ||
      !tagCut.includes('.merge_base_commit.sha == $source') ||
      !tagCut.includes(
        '.status == (if $source == $main then "identical" else "ahead" end)'
      ) ||
      !tagCut.includes('and .behind_by == 0')
    ) {
      failures.push(
        'tag-cut must bind the dispatch SHA to live mita-main and prove the exact terminal source is its ancestor'
      )
    }
    if (
      !tagCut.includes(
        'tag_endpoint="$GITHUB_API_URL/repos/$GITHUB_REPOSITORY/git/ref/tags/$RELEASE_TAG"'
      ) ||
      !tagCut.includes('case "$status" in') ||
      !tagCut.includes('            200)') ||
      !tagCut.includes('            404)') ||
      !tagCut.includes('            *)') ||
      !tagCut.includes('.object.type == "commit"') ||
      !tagCut.includes('.object.sha == $source') ||
      !tagCut.includes('"repos/$GITHUB_REPOSITORY/git/refs"') ||
      !tagCut.includes('{ref: $ref, sha: $sha}') ||
      !tagCut.includes('status="$(read_tag)"') ||
      !tagCut.includes('[ "$status" != "200" ]')
    ) {
      failures.push(
        'tag-cut must fail closed across exact existing, absent-and-create, and unexpected REST tag states with final readback'
      )
    }
  }
  if (!packageCandidate) {
    failures.push('desktop release is missing the immutable package job')
  } else {
    const packageSteps = workflowStepBlocks(packageCandidate)
    const installSigner = packageSteps.find((step) =>
      step.includes('name: Install locked Tauri signer')
    )
    const buildManifest = packageSteps.find((step) =>
      step.includes('name: Build canonical candidate manifest')
    )
    const signManifest = packageSteps.find((step) =>
      step.includes('name: Sign canonical candidate manifest')
    )
    const verifyManifest = packageSteps.find((step) =>
      step.includes('name: Verify signed candidate and write hashes')
    )
    const updaterUpload = packageSteps.find((step) =>
      step.includes('uses: actions/upload-artifact@v4')
    )
    const updaterMetadata = packageSteps.find((step) =>
      step.includes('name: Authenticate uploaded updater artifact')
    )
    const downloadCandidates = actionStepBlocks(
      packageCandidate,
      'actions/download-artifact@v4'
    ).find((step) => /^\s*path:\s*dist\/builds\s*$/m.test(step))
    if (
      !/^    environment:\s*release-distribution\s*$/m.test(packageCandidate)
    ) {
      failures.push(
        'package-candidate must protect the provenance signing key with release-distribution'
      )
    }
    if (
      !/^    permissions:\s*\n      actions:\s*read\s*\n      contents:\s*read\s*$/m.test(
        packageCandidate
      )
    ) {
      failures.push(
        'package-candidate must request only actions: read and contents: read'
      )
    }
    if (
      !jobNeeds(packageCandidate, 'preflight') ||
      !jobNeeds(packageCandidate, 'build-macos') ||
      !jobNeeds(packageCandidate, 'build-windows') ||
      !jobNeeds(packageCandidate, 'build-linux') ||
      !packageCandidate.includes(
        'updater_artifact_id: ${{ steps.updater.outputs.artifact-id }}'
      ) ||
      !packageCandidate.includes(
        'updater_artifact_digest: ${{ steps.updater-metadata.outputs.artifact_digest }}'
      ) ||
      !packageCandidate.includes(
        'updater_artifact_size: ${{ steps.updater-metadata.outputs.artifact_size }}'
      )
    ) {
      failures.push(
        'package-candidate must depend on all three signed builds and export authenticated updater artifact identity'
      )
    }
    if (
      !installSigner ||
      !hasRunInvocation(installSigner, /^corepack\s+enable$/) ||
      !hasRunInvocation(
        installSigner,
        /^corepack\s+prepare\s+yarn@4\.5\.3\s+--activate$/
      ) ||
      !hasRunInvocation(
        installSigner,
        /^yarn\s+install\s+--immutable\s+--mode=skip-build$/
      ) ||
      installSigner.includes('--mode=skip-builds') ||
      packageCandidate.indexOf('name: Install locked Tauri signer') >
        packageCandidate.indexOf('yarn tauri signer sign')
    ) {
      failures.push(
        'package-candidate must install the locked Yarn 4.5.3 signer dependencies with immutable skip-build mode before signing'
      )
    }
    if (
      !downloadCandidates ||
      /^\s*(?:run-id|repository|github-token):/m.test(downloadCandidates)
    ) {
      failures.push(
        'package-candidate must download all three current-run signed artifacts into dist/builds'
      )
    }
    if (
      !signManifest ||
      !signManifest.includes(
        'TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}'
      ) ||
      !signManifest.includes(
        'TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}'
      ) ||
      !hasRunInvocation(
        signManifest,
        /^yarn\s+tauri\s+signer\s+sign(?:\s|\\|$)/,
        [
          /--private-key\s+"\$TAURI_SIGNING_PRIVATE_KEY"/,
          /--password\s+"\$TAURI_SIGNING_PRIVATE_KEY_PASSWORD"/,
          /dist\/updater-candidate\/candidate\.json/,
        ]
      ) ||
      !buildManifest ||
      buildManifest.includes('TAURI_SIGNING_PRIVATE_KEY') ||
      !verifyManifest ||
      verifyManifest.includes('TAURI_SIGNING_PRIVATE_KEY')
    ) {
      failures.push(
        'package-candidate must expose both protected Tauri signing secrets only to the active signer step'
      )
    }
    if (
      !verifyManifest ||
      !hasRunInvocation(
        verifyManifest,
        /^node\s+scripts\/updater\/verify-candidate\.mjs(?:\s|\\|$)/,
        [/dist\/updater-candidate/, /"\$TAG"/]
      ) ||
      !hasRunInvocation(verifyManifest, /^sha256sum(?:\s|\\|$)/) ||
      !verifyManifest.includes('candidate.json.sig') ||
      !verifyManifest.includes('SHA256SUMS') ||
      packageSteps.indexOf(signManifest) >= packageSteps.indexOf(verifyManifest)
    ) {
      failures.push(
        'package-candidate must verify candidate.json with the pinned updater key before checksumming the detached signature'
      )
    }
    if (
      !updaterUpload ||
      !/^\s*id:\s*updater\s*$/m.test(updaterUpload) ||
      !updaterMetadata ||
      !updaterMetadata.includes(
        'ACTION_ARTIFACT_DIGEST: ${{ steps.updater.outputs.artifact-digest }}'
      ) ||
      !updaterMetadata.includes(
        'ARTIFACT_ID: ${{ steps.updater.outputs.artifact-id }}'
      ) ||
      !updaterMetadata.includes(
        '[[ "$ACTION_ARTIFACT_DIGEST" =~ ^[0-9a-f]{64}$ ]]'
      ) ||
      !updaterMetadata.includes(
        'artifact_digest="sha256:$ACTION_ARTIFACT_DIGEST"'
      ) ||
      !updaterMetadata.includes('.workflow_run.id == $run_id') ||
      !updaterMetadata.includes('.workflow_run.head_sha == $head') ||
      !updaterMetadata.includes('.digest == $digest') ||
      !updaterMetadata.includes(
        'echo "artifact_digest=$artifact_digest" >>"$GITHUB_OUTPUT"'
      ) ||
      !updaterMetadata.includes(
        'echo "artifact_size=$artifact_size" >>"$GITHUB_OUTPUT"'
      )
    ) {
      failures.push(
        'package-candidate must authenticate the updater artifact raw digest, REST identity, size, run, and head'
      )
    }
  }

  if (!preflight) {
    failures.push('desktop release is missing the immutable preflight job')
  } else {
    const preflightSteps = workflowStepBlocks(preflight)
    const resolverStep = preflightSteps.find((step) =>
      /^\s*(?:-\s*)?id:\s*release\s*$/m.test(step)
    )
    const targetPolicyStep = preflightSteps.find((step) =>
      step.includes('node harness/scripts/ci/verify-release-target.mjs')
    )
    if (
      !jobNeeds(preflight, 'tag-cut') ||
      !checkoutSteps.some(
        (step) =>
          step.includes(
            'ref: ${{ needs.tag-cut.outputs.trusted_main_commit }}'
          ) && /^\s*path:\s*harness\s*$/m.test(step)
      ) ||
      !checkoutSteps.some(
        (step) =>
          step.includes('ref: ${{ needs.tag-cut.outputs.tag }}') &&
          /^\s*path:\s*target\s*$/m.test(step)
      )
    ) {
      failures.push(
        'desktop release preflight must depend on tag-cut and separate its exact protected-main harness from its exact target checkout'
      )
    }
    if (
      !preflight.includes('git -C harness merge-base --is-ancestor') ||
      !preflight.includes('refs/remotes/origin/mita-main')
    ) {
      failures.push(
        'desktop release preflight must prove the tag commit is an ancestor of live mita-main'
      )
    }
    if (
      !preflight.includes('checkout_head="$(git -C harness rev-parse HEAD)"') ||
      !preflight.includes(
        'live_main="$(git -C harness rev-parse refs/remotes/origin/mita-main)"'
      ) ||
      !preflight.includes('[ "$checkout_head" != "$EXPECTED_MAIN" ]') ||
      !preflight.includes('[ "$live_main" != "$EXPECTED_MAIN" ]') ||
      !preflight.includes('echo "trusted_main_commit=$live_main"')
    ) {
      failures.push(
        'desktop release trusted harness HEAD must equal freshly fetched live origin/mita-main'
      )
    }
    if (
      !targetPolicyStep ||
      !targetPolicyStep.includes(
        'SOURCE_COMMIT: ${{ steps.release.outputs.source_commit }}'
      ) ||
      !targetPolicyStep.includes(
        'TRUSTED_MAIN: ${{ steps.release.outputs.trusted_main_commit }}'
      ) ||
      !targetPolicyStep.includes(
        'RELEASE_TAG: ${{ steps.release.outputs.tag }}'
      ) ||
      !targetPolicyStep.includes('--harness-root harness') ||
      !targetPolicyStep.includes('--release-tag "$RELEASE_TAG"') ||
      !targetPolicyStep.includes('--target-root target') ||
      !targetPolicyStep.includes('--source-commit "$SOURCE_COMMIT"') ||
      !targetPolicyStep.includes('--trusted-main "$TRUSTED_MAIN"')
    ) {
      failures.push(
        'desktop release preflight must compose the protected control plane with the exact-tag checkpoint'
      )
    }
    if (
      !resolverStep ||
      !resolverStep.includes('RELEASE_TAG: ${{ needs.tag-cut.outputs.tag }}') ||
      !resolverStep.includes(
        'EXPECTED_SOURCE: ${{ needs.tag-cut.outputs.source_commit }}'
      ) ||
      !resolverStep.includes(
        'EXPECTED_MAIN: ${{ needs.tag-cut.outputs.trusted_main_commit }}'
      ) ||
      !resolverStep.includes('test "$source_commit" = "$EXPECTED_SOURCE"') ||
      !resolverStep.includes(
        'test "$source_commit" = "$(git -C target rev-parse HEAD)"'
      )
    ) {
      failures.push(
        'candidate preflight must consume only the exact tag-cut source, tag, and protected-main outputs'
      )
    }
    if (
      !preflight.includes(
        'node --test scripts/ci/__tests__/release-policy.test.mjs'
      ) ||
      !preflight.includes(
        'node --test scripts/ci/__tests__/verify-release-target.test.mjs'
      ) ||
      !preflight.includes('working-directory: harness')
    ) {
      failures.push(
        'desktop release preflight does not test protected release policy contracts'
      )
    }
  }

  if (!qualityGate) {
    failures.push('desktop release is missing the candidate quality gate')
  } else {
    if (!jobNeeds(qualityGate, 'preflight')) {
      failures.push('candidate quality gate must depend on immutable preflight')
    }
    if (!/(?:^|\n)\s*(?:-\s*)?run:\s*make test\s*(?:\n|$)/.test(qualityGate)) {
      failures.push('candidate quality gate must run the full make test suite')
    }
    if (
      !qualityGate.includes(
        'node --test scripts/updater/__tests__/updater.test.mjs'
      )
    ) {
      failures.push(
        'candidate quality gate does not run updater contract tests'
      )
    }
  }

  for (const buildJob of ['build-macos', 'build-windows', 'build-linux']) {
    const block = jobBlock(source, buildJob)
    if (!block) {
      failures.push(`desktop release is missing ${buildJob}`)
      continue
    }
    if (!/^    environment:\s*release-distribution\s*$/m.test(block)) {
      failures.push(`${buildJob} must use the release-distribution environment`)
    }
    if (!jobNeeds(block, 'preflight') || !jobNeeds(block, 'quality-gate')) {
      failures.push(`${buildJob} must depend on preflight and quality-gate`)
    }
    const protectedHarnessCheckout = actionStepBlocks(
      block,
      'actions/checkout@v4'
    ).find(
      (step) =>
        step.includes(
          'ref: ${{ needs.preflight.outputs.trusted_main_commit }}'
        ) && /^\s*path:\s*harness\s*$/m.test(step)
    )
    const buildIndex = block.indexOf('run: make build')
    const harnessIndex = block.indexOf(
      'ref: ${{ needs.preflight.outputs.trusted_main_commit }}'
    )
    const verifierNeedle =
      buildJob === 'build-macos'
        ? 'node harness/scripts/verify-macos-candidate.mjs'
        : buildJob === 'build-windows'
          ? './harness/scripts/ci/verify-windows-candidate.ps1'
          : 'node harness/scripts/ci/candidate-content-policy.mjs'
    const verifierIndex = block.indexOf(verifierNeedle)
    if (
      !protectedHarnessCheckout ||
      buildIndex < 0 ||
      harnessIndex <= buildIndex ||
      verifierIndex <= harnessIndex
    ) {
      failures.push(
        `${buildJob} must build the exact tag before checking out and running the protected candidate verifier`
      )
    }
    if (
      !jobPinsReleaseSourceBefore(block, 'run: make build') ||
      !jobPinsReleaseSourceBefore(block, 'uses: actions/upload-artifact@v4', {
        afterNeedle:
          buildJob === 'build-macos'
            ? 'xcrun notarytool submit'
            : verifierNeedle,
      })
    ) {
      failures.push(
        `${buildJob} must revalidate unchanged live main and exact tag before build and artifact mutation`
      )
    }
    if (
      buildJob === 'build-macos' &&
      !jobPinsReleaseSourceBefore(block, 'xcrun notarytool submit', {
        afterNeedle: verifierNeedle,
      })
    ) {
      failures.push(
        'build-macos must revalidate unchanged live main and exact tag before notarization'
      )
    }
    if (
      buildJob === 'build-macos' &&
      (!block.includes('node harness/scripts/verify-macos-candidate.mjs') ||
        !block.includes('--repo-root .') ||
        !block.includes('--signature production'))
    ) {
      failures.push(
        'build-macos must verify the signed app and DMG candidate contents'
      )
    }
    if (['build-windows', 'build-linux'].includes(buildJob)) {
      const candidatePolicy = findRunInvocation(
        block,
        /^node\s+harness\/scripts\/ci\/candidate-path-policy\.mjs(?:\s|$)/
      )
      if (
        !candidatePolicy ||
        !/--root\s+src-tauri\/target\/release\/bundle/.test(
          candidatePolicy.commands.join('\n')
        )
      ) {
        failures.push(
          `${buildJob} must run the token-aware candidate path policy`
        )
      } else if (/--runtime-only/.test(candidatePolicy.commands.join('\n'))) {
        failures.push(
          `${buildJob} candidate path policy must check product and runtime names`
        )
      }
      if (LEGACY_BROAD_CANDIDATE_VERIFIER.test(block)) {
        failures.push(
          `${buildJob} must not use a broad retired-runtime verifier`
        )
      }
      if (
        buildJob === 'build-windows' &&
        !block.includes('./harness/scripts/ci/verify-windows-candidate.ps1')
      ) {
        failures.push(
          'build-windows must use the protected Windows candidate verifier'
        )
      }
      if (
        buildJob === 'build-linux' &&
        !block.includes('node harness/scripts/ci/candidate-content-policy.mjs')
      ) {
        failures.push(
          'build-linux must use the protected candidate content policy'
        )
      }
      if (buildJob === 'build-linux') {
        const steps = workflowStepBlocks(block)
        const finalSigner = steps.find((step) =>
          step.includes('name: Re-sign final Linux AppImage')
        )
        const finalVerifier = steps.find((step) =>
          step.includes(
            'node harness/scripts/updater/verify-updater-asset-signature.mjs'
          )
        )
        const upload = steps.find((step) =>
          step.includes('uses: actions/upload-artifact@v4')
        )
        if (
          !finalSigner ||
          !finalSigner.includes(
            'VERSION: ${{ needs.preflight.outputs.version }}'
          ) ||
          !finalSigner.includes(
            'TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}'
          ) ||
          !finalSigner.includes(
            'TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}'
          ) ||
          !finalSigner.includes(
            'appimage="src-tauri/target/release/bundle/appimage/Biyan_${VERSION}_amd64.AppImage"'
          ) ||
          !hasRunInvocation(finalSigner, /^test\s+-f\s+"\$appimage"$/) ||
          !hasRunInvocation(finalSigner, /^rm\s+-f\s+"\$appimage\.sig"$/) ||
          !hasRunInvocation(
            finalSigner,
            /^yarn\s+tauri\s+signer\s+sign(?:\s|\\|$)/,
            [
              /--private-key\s+"\$TAURI_SIGNING_PRIVATE_KEY"/,
              /--password\s+"\$TAURI_SIGNING_PRIVATE_KEY_PASSWORD"/,
              /"\$appimage"/,
            ]
          ) ||
          !hasRunInvocation(finalSigner, /^test\s+-s\s+"\$appimage\.sig"$/) ||
          !finalVerifier ||
          !finalVerifier.includes(
            'jq -er \'.plugins.updater.pubkey | select(type == "string" and length > 0)\''
          ) ||
          !hasRunInvocation(
            finalVerifier,
            /^node\s+harness\/scripts\/updater\/verify-updater-asset-signature\.mjs(?:\s|\\|$)/,
            [
              /--asset\s+"src-tauri\/target\/release\/bundle\/appimage\/Biyan_\$\{VERSION\}_amd64\.AppImage"/,
              /--signature\s+"src-tauri\/target\/release\/bundle\/appimage\/Biyan_\$\{VERSION\}_amd64\.AppImage\.sig"/,
              /--public-key\s+"\$public_key"/,
              /--label\s+linux-x86_64/,
            ]
          ) ||
          steps.indexOf(finalSigner) <=
            steps.findIndex((step) => step.includes('run: make build')) ||
          steps.indexOf(finalVerifier) <= steps.indexOf(finalSigner) ||
          !upload ||
          steps.indexOf(upload) <= steps.indexOf(finalVerifier)
        ) {
          failures.push(
            'build-linux must delete the stale signature, re-sign the final canonical AppImage, and cryptographically verify it with the protected updater key before upload'
          )
        }
      }
    }
  }

  for (const [jobName, block] of [
    ['package-candidate', packageCandidate],
    ['draft-release', draftRelease],
  ]) {
    const protectedCheckout = actionStepBlocks(
      block,
      'actions/checkout@v4'
    ).some((step) =>
      step.includes('ref: ${{ needs.preflight.outputs.trusted_main_commit }}')
    )
    if (block && !protectedCheckout) {
      failures.push(
        `${jobName} must use release tooling from the protected harness`
      )
    }
    if (
      block &&
      !(jobName === 'package-candidate'
        ? jobPinsReleaseSourceBefore(
            block,
            'uses: actions/upload-artifact@v4',
            { afterNeedle: 'SHA256SUMS' }
          )
        : jobPinsReleaseSourceBefore(
            block,
            'name: Atomically create an empty Draft'
          ))
    ) {
      failures.push(
        `${jobName} must revalidate unchanged live main and exact tag before external mutation`
      )
    }
  }

  if (draftRelease) {
    if (
      !jobNeeds(draftRelease, 'preflight') ||
      !jobNeeds(draftRelease, 'build-macos') ||
      !jobNeeds(draftRelease, 'build-windows') ||
      !jobNeeds(draftRelease, 'build-linux') ||
      !jobNeeds(draftRelease, 'package-candidate')
    ) {
      failures.push(
        'draft-release must depend on preflight, all signed platform builds, and immutable packaging'
      )
    }
    const draftSteps = workflowStepBlocks(draftRelease)
    const updaterDownload = draftSteps.find((step) =>
      step.includes('name: Download exact updater archive by authenticated ID')
    )
    const updaterExtract = draftSteps.find((step) =>
      step.includes('name: Extract exact updater candidate')
    )
    const freshSlotIndex = draftSteps.findIndex((step) =>
      step.includes('Require a fresh draft release slot')
    )
    const freshSlot = freshSlotIndex >= 0 ? draftSteps[freshSlotIndex] : ''
    const createDraftIndex = draftSteps.findIndex((step) =>
      step.includes('name: Atomically create an empty Draft')
    )
    const createDraft =
      createDraftIndex >= 0 ? draftSteps[createDraftIndex] : ''
    const uploadAssetsIndex = draftSteps.findIndex((step) =>
      step.includes(
        'name: Upload exact assets only to the newly created Draft ID'
      )
    )
    const uploadAssets =
      uploadAssetsIndex >= 0 ? draftSteps[uploadAssetsIndex] : ''
    const exactDraftIndex = draftSteps.findIndex((step) =>
      step.includes('Verify exact draft release')
    )
    const exactDraft = exactDraftIndex >= 0 ? draftSteps[exactDraftIndex] : ''
    const expectedAssets = [
      'Biyan_${VERSION}_universal.dmg',
      'Biyan.app.tar.gz',
      'Biyan.app.tar.gz.sig',
      'Biyan_${VERSION}_x64-setup.exe',
      'Biyan_${VERSION}_x64-setup.exe.sig',
      'Biyan_${VERSION}_x64_en-US.msi',
      'Biyan_${VERSION}_amd64.AppImage',
      'Biyan_${VERSION}_amd64.AppImage.sig',
      'Biyan_${VERSION}_amd64.deb',
      'candidate.json',
      'candidate.json.sig',
      'latest.json',
      'SHA256SUMS',
    ]

    if (
      actionStepBlocks(draftRelease, 'actions/download-artifact@v4').length !==
        0 ||
      !updaterDownload ||
      !updaterDownload.includes(
        'ARTIFACT_ID: ${{ needs.package-candidate.outputs.updater_artifact_id }}'
      ) ||
      !updaterDownload.includes(
        'ARTIFACT_DIGEST: ${{ needs.package-candidate.outputs.updater_artifact_digest }}'
      ) ||
      !updaterDownload.includes(
        'ARTIFACT_SIZE: ${{ needs.package-candidate.outputs.updater_artifact_size }}'
      ) ||
      !updaterDownload.includes(
        'if [ "$actual_digest" != "$ARTIFACT_DIGEST" ]'
      ) ||
      !updaterExtract ||
      !hasRunInvocation(
        updaterExtract,
        /^python3\s+scripts\/ci\/extract-release-candidate-recovery\.py(?:\s|\\|$)/,
        [
          /--updater-archive\s+dist\/recovered-updater\/updater\.zip/,
          /--output-dir\s+"dist\/biyan-updater-candidate-\$VERSION"/,
          /--version\s+"\$VERSION"/,
        ]
      )
    ) {
      failures.push(
        'draft-release must authenticate and exactly extract the current-run updater artifact'
      )
    }
    if (
      !freshSlot ||
      !hasCommandSequence(freshSlot, [
        'gh api \\',
        '--paginate \\',
        '--slurp \\',
        '"repos/$GITHUB_REPOSITORY/releases?per_page=100" \\',
        '>"$RUNNER_TEMP/existing-release-pages.json"',
      ]) ||
      !freshSlot.includes(
        '[.[][] | select(.tag_name == $tag)] | length == 0'
      ) ||
      freshSlotIndex >= createDraftIndex ||
      createDraftIndex < 0 ||
      uploadAssetsIndex <= createDraftIndex ||
      exactDraftIndex <= uploadAssetsIndex ||
      draftRelease.includes('softprops/action-gh-release') ||
      !hasCommandSequence(createDraft, [
        'gh api \\',
        '--method POST \\',
        '"repos/$GITHUB_REPOSITORY/releases" \\',
        '--input "$RUNNER_TEMP/create-draft-request.json" \\',
        '>"$RUNNER_TEMP/created-draft.json"',
      ]) ||
      !createDraft.includes('tag_name: $tag') ||
      !createDraft.includes('target_commitish: $target') ||
      !createDraft.includes('name: $name') ||
      !createDraft.includes('draft: true') ||
      !createDraft.includes('prerelease: false') ||
      !createDraft.includes('.published_at == null') ||
      !createDraft.includes('and (.assets | length == 0)') ||
      !createDraft.includes('/releases/tag/untagged-[0-9a-f]{20}$') ||
      !stepLoadsCreatedDraftId(createDraft) ||
      !stepWaitsForCreatedDraftReadback(createDraft)
    ) {
      failures.push(
        'draft-release must enumerate all releases, pin source, and atomically create one empty Draft ID'
      )
    }
    if (
      !stepLoadsCreatedDraftId(uploadAssets) ||
      !hasCommandSequence(uploadAssets, [
        'curl \\',
        '--fail-with-body \\',
        '--silent \\',
        '--show-error \\',
        '--request POST \\',
        '--header "Accept: application/vnd.github+json" \\',
        '--header "Authorization: Bearer $GH_TOKEN" \\',
        '--header "Content-Type: application/octet-stream" \\',
        '--header "X-GitHub-Api-Version: 2022-11-28" \\',
        '--data-binary "@$file" \\',
        '"https://uploads.github.com/repos/$GITHUB_REPOSITORY/releases/$release_id/assets?name=$encoded_name" \\',
        '>"$RUNNER_TEMP/uploaded-asset-$index.json"',
      ]) ||
      !/\.name == \$name\s*\n\s*and \.state == "uploaded"\s*\n\s*and \.size == \$size\s*\n\s*and \.digest == \$digest\s*\n\s*and \(\.browser_download_url ==/.test(
        uploadAssets
      ) ||
      expectedAssets.some((asset) => !uploadAssets.includes(asset)) ||
      !stepLoadsCreatedDraftId(exactDraft) ||
      !stepPinsReleaseSource(exactDraft, 'gh api') ||
      !exactDraft.includes(
        'gh api "repos/$GITHUB_REPOSITORY/releases/$release_id"'
      ) ||
      !exactDraft.includes('.id == $release_id') ||
      !exactDraft.includes('.tag_name == $tag') ||
      !exactDraft.includes('.draft == true') ||
      !exactDraft.includes('.prerelease == false') ||
      !exactDraft.includes('.published_at == null') ||
      !exactDraft.includes('{ name, size, digest }') ||
      !exactDraft.includes('"/releases/download/" + $draft_slug + "/"') ||
      !exactDraft.includes(
        '[.[][] | select(.tag_name == $tag) | .id] == [$release_id]'
      )
    ) {
      failures.push(
        'draft-release must byte-bind exactly 13 assets to the new ID and verify the same unique unpublished Draft'
      )
    }
  }

  failures.push(
    ...validateReleaseWorkflowControlPlane(
      activeSource,
      TRUSTED_CANDIDATE_JOB_ORDER,
      TRUSTED_CANDIDATE_WORKFLOW_ALLOWLIST,
      'desktop release',
      {
        requireReviewedEnvelope:
          requireReviewedEnvelope ||
          /^name:\s*Desktop Release Candidate\s*$/m.test(activeSource),
        writePermissionJobs: new Set(['tag-cut', 'draft-release']),
      }
    )
  )

  return failures
}

export function validateCandidateRecoveryWorkflow(source) {
  const failures = []
  const activeSource = uncommentedSource(source)
  const permissions = topLevelBlock(activeSource, 'permissions')
  const concurrency = topLevelBlock(activeSource, 'concurrency')
  const preflight = jobBlock(activeSource, 'preflight')
  const packageCandidate = jobBlock(activeSource, 'package-candidate')
  const draftRelease = jobBlock(activeSource, 'draft-release')
  const checkoutSteps = actionStepBlocks(activeSource, 'actions/checkout@v4')

  if (
    !activeSource.includes('name: Desktop Release Candidate Recovery') ||
    !activeSource.includes('workflow_dispatch:') ||
    !activeSource.includes('source_run_id:') ||
    /push:\s*(?:\n|$)/m.test(topLevelBlock(activeSource, 'on') ?? '')
  ) {
    failures.push(
      'candidate recovery must be manual-only and require version plus source_run_id'
    )
  }
  if (
    YAML_CONTINUE_ON_ERROR.test(activeSource) ||
    YAML_IF.test(activeSource) ||
    /\|\|\s*true\b/.test(activeSource)
  ) {
    failures.push(
      'candidate recovery jobs and steps must be unconditional and must not use advisory bypasses'
    )
  }
  if (
    !permissions ||
    !/^  actions:\s*read\s*$/m.test(permissions) ||
    !/^  contents:\s*read\s*$/m.test(permissions) ||
    /\bwrite\b/.test(permissions)
  ) {
    failures.push(
      'candidate recovery top-level permissions must be actions: read and contents: read only'
    )
  }
  if (
    !concurrency ||
    !concurrency.includes('group: desktop-candidate-${{ inputs.version }}') ||
    !concurrency.includes('cancel-in-progress: false')
  ) {
    failures.push(
      'candidate recovery must share the exact-tag desktop candidate concurrency lock'
    )
  }
  if (
    checkoutSteps.some(
      (step) => !/^\s*persist-credentials:\s*false\s*$/m.test(step)
    )
  ) {
    failures.push(
      'candidate recovery checkouts must disable persisted credentials'
    )
  }

  if (!preflight) {
    failures.push('candidate recovery is missing its authenticated preflight')
  } else {
    const steps = workflowStepBlocks(preflight)
    const resolver = steps.find((step) =>
      step.includes('name: Resolve immutable recovery metadata')
    )
    const targetPolicy = steps.find((step) =>
      step.includes('node harness/scripts/ci/verify-release-target.mjs')
    )
    const metadataFetch = steps.find((step) =>
      step.includes('name: Fetch exact source run metadata')
    )
    const recoveryAuth = steps.find((step) =>
      step.includes(
        'node harness/scripts/ci/verify-release-candidate-recovery.mjs'
      )
    )
    const contractTests = steps.find((step) =>
      step.includes('name: Test protected recovery policy contracts')
    )
    const freshSlot = steps.find((step) =>
      step.includes('name: Require an unused release slot')
    )

    if (
      !checkoutSteps.some(
        (step) =>
          /^\s*ref:\s*mita-main\s*$/m.test(step) &&
          /^\s*path:\s*harness\s*$/m.test(step)
      ) ||
      !checkoutSteps.some(
        (step) =>
          step.includes('ref: ${{ inputs.version }}') &&
          /^\s*path:\s*target\s*$/m.test(step)
      )
    ) {
      failures.push(
        'candidate recovery must separate the protected main harness from the exact tag target'
      )
    }
    if (
      !resolver ||
      !resolver.includes('WORKFLOW_REF: ${{ github.ref }}') ||
      !resolver.includes('[ "$WORKFLOW_REF" != "refs/heads/mita-main" ]') ||
      !resolver.includes('[[ ! "$SOURCE_RUN_ID" =~ ^[1-9][0-9]*$ ]]') ||
      !resolver.includes('[ "$SOURCE_RUN_ID" != "30195339449" ]') ||
      !resolver.includes(
        '[[ ! "$RELEASE_TAG" =~ ^v(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$ ]]'
      ) ||
      !resolver.includes('git -C harness merge-base --is-ancestor') ||
      !resolver.includes('checkout_head') ||
      !resolver.includes('live_main')
    ) {
      failures.push(
        'candidate recovery must bind canonical inputs to the live protected main and exact tag'
      )
    }
    if (
      !targetPolicy ||
      !targetPolicy.includes('--harness-root harness') ||
      !targetPolicy.includes('--release-tag "$RELEASE_TAG"') ||
      !targetPolicy.includes('--target-root target') ||
      !targetPolicy.includes('--source-commit "$SOURCE_COMMIT"') ||
      !targetPolicy.includes('--trusted-main "$TRUSTED_MAIN"')
    ) {
      failures.push(
        'candidate recovery must compose the protected control plane with the exact release checkpoint'
      )
    }
    if (
      !metadataFetch ||
      !metadataFetch.includes('GH_TOKEN: ${{ github.token }}') ||
      !metadataFetch.includes('actions/runs/$SOURCE_RUN_ID"') ||
      !metadataFetch.includes(
        'actions/runs/$SOURCE_RUN_ID/jobs?per_page=100'
      ) ||
      !metadataFetch.includes(
        'actions/runs/$SOURCE_RUN_ID/artifacts?per_page=100'
      )
    ) {
      failures.push(
        'candidate recovery must fetch run, job, and artifact metadata from the current repository'
      )
    }
    if (
      !recoveryAuth ||
      !recoveryAuth.includes(
        '--run "$RUNNER_TEMP/recovery-metadata/run.json"'
      ) ||
      !recoveryAuth.includes(
        '--jobs "$RUNNER_TEMP/recovery-metadata/jobs.json"'
      ) ||
      !recoveryAuth.includes(
        '--artifacts "$RUNNER_TEMP/recovery-metadata/artifacts.json"'
      ) ||
      !recoveryAuth.includes('--source-run-id "$SOURCE_RUN_ID"') ||
      !recoveryAuth.includes('--current-run-id "$CURRENT_RUN_ID"') ||
      !recoveryAuth.includes('--repository "$GITHUB_REPOSITORY"') ||
      !recoveryAuth.includes('--version "$VERSION"') ||
      !recoveryAuth.includes(
        'git -C harness merge-base --is-ancestor "$source_head" "$TRUSTED_MAIN"'
      ) ||
      !recoveryAuth.includes('git -C harness diff') ||
      !recoveryAuth.includes('--name-status') ||
      !recoveryAuth.includes('--no-renames') ||
      !recoveryAuth.includes(
        '"$source_head" \\\n            "$TRUSTED_MAIN"'
      ) ||
      !recoveryAuth.includes('expected-control-drift.txt') ||
      !recoveryAuth.includes('actual-control-drift.txt') ||
      !recoveryAuth.includes('diff -u') ||
      ![
        '.github/workflows/biyan-linter-and-test.yml',
        '.github/workflows/desktop-release-recovery.yml',
        '.github/workflows/desktop-release.yml',
        'scripts/ci/__tests__/extract-release-candidate-recovery.test.py',
        'scripts/ci/__tests__/release-policy.test.mjs',
        'scripts/ci/__tests__/verify-release-candidate-recovery.test.mjs',
        'scripts/ci/__tests__/verify-release-target.test.mjs',
        'scripts/ci/extract-release-candidate-recovery.py',
        'scripts/ci/legacy-compatibility-allowlist.json',
        'scripts/ci/release-policy-contracts.mjs',
        'scripts/ci/verify-release-candidate-recovery.mjs',
        'scripts/ci/verify-release-policy.mjs',
        'scripts/ci/verify-release-target.mjs',
      ].every((relativePath) => recoveryAuth.includes(relativePath)) ||
      !recoveryAuth.includes('source_run_id=$SOURCE_RUN_ID') ||
      !recoveryAuth.includes('source_run_head=$source_head') ||
      !recoveryAuth.includes('echo "${platform}_artifact_id=$id"') ||
      !recoveryAuth.includes('echo "${platform}_artifact_digest=$digest"') ||
      !recoveryAuth.includes('echo "${platform}_artifact_size=$size"') ||
      !['linux', 'macos', 'windows'].every((platform) =>
        recoveryAuth.includes(`emit_artifact \\\n            ${platform} \\`)
      )
    ) {
      failures.push(
        'candidate recovery must authenticate exact source topology, ancestry, artifact IDs, sizes, and digests'
      )
    }
    if (
      !contractTests ||
      !contractTests.includes(
        'node --test scripts/ci/__tests__/release-policy.test.mjs'
      ) ||
      !contractTests.includes(
        'node --test scripts/ci/__tests__/verify-release-target.test.mjs'
      ) ||
      !contractTests.includes(
        'python3 scripts/ci/__tests__/extract-release-candidate-recovery.test.py'
      ) ||
      !contractTests.includes(
        'node --test scripts/ci/__tests__/verify-release-candidate-recovery.test.mjs'
      ) ||
      !contractTests.includes('working-directory: harness')
    ) {
      failures.push(
        'candidate recovery preflight must execute all protected recovery policy tests'
      )
    }
    if (
      !freshSlot ||
      !hasCommandSequence(freshSlot, [
        'gh api \\',
        '--paginate \\',
        '--slurp \\',
        '"repos/$GITHUB_REPOSITORY/releases?per_page=100" \\',
        '>"$RUNNER_TEMP/existing-release-pages.json"',
      ]) ||
      !freshSlot.includes('[.[][] | select(.tag_name == $tag)] | length == 0')
    ) {
      failures.push(
        'candidate recovery preflight must enumerate published and Draft releases and prove the tag is unused'
      )
    }
  }

  if (!packageCandidate) {
    failures.push('candidate recovery is missing immutable packaging')
  } else {
    const steps = workflowStepBlocks(packageCandidate)
    const installSigner = steps.find((step) =>
      step.includes('name: Install locked Tauri signer')
    )
    const archiveDownload = steps.find((step) =>
      step.includes(
        'name: Download exact artifact archives by authenticated ID'
      )
    )
    const safeExtract = steps.find((step) =>
      step.includes(
        'name: Extract only the exact recovered candidate inventory'
      )
    )
    const buildManifest = steps.find((step) =>
      step.includes('name: Build canonical candidate manifest')
    )
    const signManifest = steps.find((step) =>
      step.includes('name: Sign canonical candidate manifest')
    )
    const verifyManifest = steps.find((step) =>
      step.includes('name: Verify signed candidate and write hashes')
    )
    const updaterUpload = steps.find((step) =>
      step.includes('uses: actions/upload-artifact@v4')
    )
    const updaterMetadata = steps.find((step) =>
      step.includes('name: Authenticate uploaded updater artifact')
    )
    if (
      !jobNeeds(packageCandidate, 'preflight') ||
      !/^    environment:\s*release-distribution\s*$/m.test(packageCandidate) ||
      !packageCandidate.includes(
        'updater_artifact_id: ${{ steps.updater.outputs.artifact-id }}'
      ) ||
      !packageCandidate.includes(
        'updater_artifact_digest: ${{ steps.updater-metadata.outputs.artifact_digest }}'
      ) ||
      !packageCandidate.includes(
        'updater_artifact_size: ${{ steps.updater-metadata.outputs.artifact_size }}'
      )
    ) {
      failures.push(
        'candidate recovery packaging must depend on preflight, use release-distribution, and export authenticated updater artifact identity'
      )
    }
    if (
      !actionStepBlocks(packageCandidate, 'actions/checkout@v4').some((step) =>
        step.includes('ref: ${{ needs.preflight.outputs.trusted_main_commit }}')
      )
    ) {
      failures.push(
        'candidate recovery packaging must use tooling from the protected main'
      )
    }
    if (
      !installSigner ||
      !hasRunInvocation(installSigner, /^corepack\s+enable$/) ||
      !hasRunInvocation(
        installSigner,
        /^corepack\s+prepare\s+yarn@4\.5\.3\s+--activate$/
      ) ||
      !hasRunInvocation(
        installSigner,
        /^yarn\s+install\s+--immutable\s+--mode=skip-build$/
      ) ||
      installSigner.includes('--mode=skip-builds')
    ) {
      failures.push(
        'candidate recovery must install locked Yarn 4.5.3 dependencies with immutable skip-build mode'
      )
    }
    if (
      actionStepBlocks(packageCandidate, 'actions/download-artifact@v4')
        .length !== 0 ||
      !archiveDownload ||
      !archiveDownload.includes('GH_TOKEN: ${{ github.token }}') ||
      !archiveDownload.includes('actions/artifacts/$artifact_id/zip') ||
      !hasRunInvocation(archiveDownload, /^gh\s+api(?:\s|\\|$)/) ||
      !hasRunInvocation(archiveDownload, /^test\s+"\$\(stat\s+-c/) ||
      !hasRunInvocation(
        archiveDownload,
        /^actual_digest="sha256:\$\(sha256sum/
      ) ||
      !archiveDownload.includes(
        'if [ "$actual_digest" != "$artifact_digest" ]'
      ) ||
      !['LINUX', 'MACOS', 'WINDOWS'].every(
        (platform) =>
          archiveDownload.includes(`${platform}_ARTIFACT_ID:`) &&
          archiveDownload.includes(`${platform}_ARTIFACT_DIGEST:`) &&
          archiveDownload.includes(`${platform}_ARTIFACT_SIZE:`)
      )
    ) {
      failures.push(
        'candidate recovery must download exact artifact IDs and fail closed on archive size or digest mismatch'
      )
    }
    if (
      !safeExtract ||
      !hasRunInvocation(
        safeExtract,
        /^python3\s+scripts\/ci\/extract-release-candidate-recovery\.py(?:\s|\\|$)/,
        [
          /--archives-dir\s+dist\/recovery-archives/,
          /--output-dir\s+dist\/builds/,
          /--version\s+"\$VERSION"/,
        ]
      ) ||
      !safeExtract.includes('set -euo pipefail')
    ) {
      failures.push(
        'candidate recovery must whitelist and safely extract exactly nine non-empty regular candidate files'
      )
    }
    if (
      !signManifest ||
      !signManifest.includes(
        'TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}'
      ) ||
      !signManifest.includes(
        'TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}'
      ) ||
      !hasRunInvocation(
        signManifest,
        /^yarn\s+tauri\s+signer\s+sign(?:\s|\\|$)/,
        [
          /--private-key\s+"\$TAURI_SIGNING_PRIVATE_KEY"/,
          /--password\s+"\$TAURI_SIGNING_PRIVATE_KEY_PASSWORD"/,
          /dist\/updater-candidate\/candidate\.json/,
        ]
      ) ||
      !buildManifest ||
      buildManifest.includes('TAURI_SIGNING_PRIVATE_KEY') ||
      !verifyManifest ||
      verifyManifest.includes('TAURI_SIGNING_PRIVATE_KEY') ||
      !hasRunInvocation(
        verifyManifest,
        /^node\s+scripts\/updater\/verify-candidate\.mjs(?:\s|\\|$)/,
        [/dist\/updater-candidate/, /"\$TAG"/]
      ) ||
      !hasRunInvocation(verifyManifest, /^sha256sum(?:\s|\\|$)/) ||
      !verifyManifest.includes('candidate.json.sig') ||
      !verifyManifest.includes('SHA256SUMS') ||
      steps.indexOf(signManifest) >= steps.indexOf(verifyManifest)
    ) {
      failures.push(
        'candidate recovery packaging must expose protected secrets only to signing, then verify signed provenance with the pinned updater key'
      )
    }
    if (
      !jobPinsReleaseSourceBefore(
        packageCandidate,
        'uses: actions/upload-artifact@v4',
        { afterNeedle: 'SHA256SUMS' }
      ) ||
      !packageCandidate.includes(
        'name: biyan-updater-candidate-${{ needs.preflight.outputs.version }}'
      ) ||
      !updaterUpload ||
      !/^\s*id:\s*updater\s*$/m.test(updaterUpload) ||
      !updaterMetadata ||
      !updaterMetadata.includes(
        'ARTIFACT_ID: ${{ steps.updater.outputs.artifact-id }}'
      ) ||
      !updaterMetadata.includes(
        'ACTION_ARTIFACT_DIGEST: ${{ steps.updater.outputs.artifact-digest }}'
      ) ||
      !updaterMetadata.includes(
        '[[ "$ACTION_ARTIFACT_DIGEST" =~ ^[0-9a-f]{64}$ ]]'
      ) ||
      !updaterMetadata.includes(
        'artifact_digest="sha256:$ACTION_ARTIFACT_DIGEST"'
      ) ||
      !hasRunInvocation(updaterMetadata, /^gh\s+api(?:\s|\\|$)/, [
        /actions\/artifacts\/\$ARTIFACT_ID/,
      ]) ||
      !updaterMetadata.includes('.workflow_run.id == $run_id') ||
      !updaterMetadata.includes('.workflow_run.head_sha == $head') ||
      !updaterMetadata.includes('.digest == $digest') ||
      !updaterMetadata.includes(
        'echo "artifact_digest=$artifact_digest" >>"$GITHUB_OUTPUT"'
      ) ||
      !updaterMetadata.includes(
        'echo "artifact_size=$artifact_size" >>"$GITHUB_OUTPUT"'
      )
    ) {
      failures.push(
        'candidate recovery must pin main and tag, upload once, and authenticate the exact updater artifact ID, size, digest, run, and head'
      )
    }
  }

  if (!draftRelease) {
    failures.push('candidate recovery is missing draft creation')
  } else {
    const steps = workflowStepBlocks(draftRelease)
    const updaterDownload = steps.find((step) =>
      step.includes('name: Download exact updater archive by authenticated ID')
    )
    const updaterExtract = steps.find((step) =>
      step.includes('name: Extract exact recovered updater candidate')
    )
    const freshSlotIndex = steps.findIndex((step) =>
      step.includes('name: Require a fresh draft release slot')
    )
    const freshSlot = freshSlotIndex >= 0 ? steps[freshSlotIndex] : ''
    const createDraftIndex = steps.findIndex((step) =>
      step.includes('name: Atomically create an empty recovered Draft')
    )
    const createDraft = createDraftIndex >= 0 ? steps[createDraftIndex] : ''
    const uploadAssetsIndex = steps.findIndex((step) =>
      step.includes(
        'name: Upload exact assets only to the newly created Draft ID'
      )
    )
    const uploadAssets = uploadAssetsIndex >= 0 ? steps[uploadAssetsIndex] : ''
    const verifyDraftIndex = steps.findIndex((step) =>
      step.includes('name: Verify exact recovered draft release')
    )
    const verifyDraft = verifyDraftIndex >= 0 ? steps[verifyDraftIndex] : ''
    if (
      !jobNeeds(draftRelease, 'preflight') ||
      !jobNeeds(draftRelease, 'package-candidate') ||
      !/^    permissions:\s*\n      actions:\s*read\s*\n      contents:\s*write\s*$/m.test(
        draftRelease
      )
    ) {
      failures.push(
        'candidate recovery draft must depend on authenticated packaging and alone request actions: read plus contents: write'
      )
    }
    if (
      !actionStepBlocks(draftRelease, 'actions/checkout@v4').some((step) =>
        step.includes('ref: ${{ needs.preflight.outputs.trusted_main_commit }}')
      ) ||
      actionStepBlocks(draftRelease, 'actions/download-artifact@v4').length !==
        0 ||
      !updaterDownload ||
      !updaterDownload.includes(
        'ARTIFACT_ID: ${{ needs.package-candidate.outputs.updater_artifact_id }}'
      ) ||
      !updaterDownload.includes(
        'ARTIFACT_DIGEST: ${{ needs.package-candidate.outputs.updater_artifact_digest }}'
      ) ||
      !updaterDownload.includes(
        'ARTIFACT_SIZE: ${{ needs.package-candidate.outputs.updater_artifact_size }}'
      ) ||
      !hasRunInvocation(updaterDownload, /^gh\s+api(?:\s|\\|$)/, [
        /actions\/artifacts\/\$ARTIFACT_ID\/zip/,
      ]) ||
      !hasRunInvocation(updaterDownload, /^test\s+"\$\(stat\s+-c/) ||
      !updaterDownload.includes(
        'if [ "$actual_digest" != "$ARTIFACT_DIGEST" ]'
      ) ||
      !updaterExtract ||
      !hasRunInvocation(
        updaterExtract,
        /^python3\s+scripts\/ci\/extract-release-candidate-recovery\.py(?:\s|\\|$)/,
        [
          /--updater-archive\s+dist\/recovered-updater\/updater\.zip/,
          /--output-dir\s+"dist\/biyan-updater-candidate-\$VERSION"/,
          /--version\s+"\$VERSION"/,
        ]
      )
    ) {
      failures.push(
        'candidate recovery draft must authenticate the current-run updater ZIP by exact ID, size, and digest before exact 13-file extraction'
      )
    }
    if (
      freshSlotIndex < 0 ||
      !hasCommandSequence(freshSlot, [
        'gh api \\',
        '--paginate \\',
        '--slurp \\',
        '"repos/$GITHUB_REPOSITORY/releases?per_page=100" \\',
        '>"$RUNNER_TEMP/existing-release-pages.json"',
      ]) ||
      !freshSlot.includes(
        '[.[][] | select(.tag_name == $tag)] | length == 0'
      ) ||
      createDraftIndex < 0 ||
      uploadAssetsIndex < 0 ||
      verifyDraftIndex < 0 ||
      freshSlotIndex >= createDraftIndex ||
      createDraftIndex >= uploadAssetsIndex ||
      uploadAssetsIndex >= verifyDraftIndex ||
      !jobPinsReleaseSourceBefore(
        draftRelease,
        'name: Atomically create an empty recovered Draft'
      ) ||
      draftRelease.includes('softprops/action-gh-release') ||
      !createDraft.includes(
        'EXPECTED_SOURCE: ${{ needs.preflight.outputs.source_commit }}'
      ) ||
      !hasCommandSequence(createDraft, [
        'gh api \\',
        '--method POST \\',
        '"repos/$GITHUB_REPOSITORY/releases" \\',
        '--input "$RUNNER_TEMP/create-draft-request.json" \\',
        '>"$RUNNER_TEMP/created-draft.json"',
      ]) ||
      !createDraft.includes('target_commitish: $target') ||
      !createDraft.includes('draft: true') ||
      !createDraft.includes('prerelease: false') ||
      !createDraft.includes('.published_at == null') ||
      !createDraft.includes('and (.assets | length == 0)') ||
      !createDraft.includes('/releases/tag/untagged-[0-9a-f]{20}$') ||
      !stepLoadsCreatedDraftId(createDraft) ||
      !stepWaitsForCreatedDraftReadback(createDraft)
    ) {
      failures.push(
        'candidate recovery must pin main and tag, atomically POST a new empty Draft, and bind every later mutation to its returned ID'
      )
    }
    const expectedAssets = [
      'Biyan_${VERSION}_universal.dmg',
      'Biyan.app.tar.gz',
      'Biyan.app.tar.gz.sig',
      'Biyan_${VERSION}_x64-setup.exe',
      'Biyan_${VERSION}_x64-setup.exe.sig',
      'Biyan_${VERSION}_x64_en-US.msi',
      'Biyan_${VERSION}_amd64.AppImage',
      'Biyan_${VERSION}_amd64.AppImage.sig',
      'Biyan_${VERSION}_amd64.deb',
      'candidate.json',
      'candidate.json.sig',
      'latest.json',
      'SHA256SUMS',
    ]
    if (
      !uploadAssets ||
      !stepLoadsCreatedDraftId(uploadAssets) ||
      !hasCommandSequence(uploadAssets, [
        'curl \\',
        '--fail-with-body \\',
        '--silent \\',
        '--show-error \\',
        '--request POST \\',
        '--header "Accept: application/vnd.github+json" \\',
        '--header "Authorization: Bearer $GH_TOKEN" \\',
        '--header "Content-Type: application/octet-stream" \\',
        '--header "X-GitHub-Api-Version: 2022-11-28" \\',
        '--data-binary "@$file" \\',
        '"https://uploads.github.com/repos/$GITHUB_REPOSITORY/releases/$release_id/assets?name=$encoded_name" \\',
        '>"$RUNNER_TEMP/uploaded-asset-$index.json"',
      ]) ||
      !/\.name == \$name\s*\n\s*and \.state == "uploaded"\s*\n\s*and \.size == \$size\s*\n\s*and \.digest == \$digest\s*\n\s*and \(\.browser_download_url ==/.test(
        uploadAssets
      ) ||
      !uploadAssets.includes('$draft_slug + "/" + $name') ||
      expectedAssets.some((asset) => !uploadAssets.includes(asset)) ||
      !stepLoadsCreatedDraftId(verifyDraft) ||
      !stepPinsReleaseSource(verifyDraft, 'gh api') ||
      !verifyDraft.includes(
        'gh api "repos/$GITHUB_REPOSITORY/releases/$release_id"'
      ) ||
      !verifyDraft.includes('.id == $release_id') ||
      !verifyDraft.includes('.name == ("Biyan " + $tag)') ||
      !verifyDraft.includes('.tag_name == $tag') ||
      !verifyDraft.includes('.draft == true') ||
      !verifyDraft.includes('.prerelease == false') ||
      !verifyDraft.includes('.published_at == null') ||
      !verifyDraft.includes('{ name, size, digest }') ||
      !verifyDraft.includes('"/releases/download/" + $draft_slug + "/"') ||
      !verifyDraft.includes('.state == "uploaded"') ||
      !verifyDraft.includes('.size > 0') ||
      !verifyDraft.includes('^sha256:[0-9a-f]{64}$') ||
      !hasCommandSequence(verifyDraft, [
        'gh api \\',
        '--paginate \\',
        '--slurp \\',
        '"repos/$GITHUB_REPOSITORY/releases?per_page=100" \\',
        '>"$RUNNER_TEMP/final-release-pages.json"',
      ]) ||
      !verifyDraft.includes(
        '[.[][] | select(.tag_name == $tag) | .id] == [$release_id]'
      )
    ) {
      failures.push(
        'candidate recovery must upload exactly 13 byte-bound assets to the new Draft ID and verify that same unpublished Draft by ID and tag'
      )
    }
  }

  failures.push(
    ...validateReleaseWorkflowControlPlane(
      activeSource,
      TRUSTED_RECOVERY_JOB_ORDER,
      TRUSTED_RECOVERY_WORKFLOW_ALLOWLIST,
      'candidate recovery',
      { requireReviewedEnvelope: true }
    )
  )

  return failures
}

export function validateDraftAssetRepairWorkflow(source, stateHelperSource) {
  const failures = []
  const active = uncommentedSource(source)
  const workflowSha256 = createHash('sha256')
    .update(normalizedYamlEnvelope(source))
    .digest('hex')
  const helperSha256 = createHash('sha256')
    .update(normalizedYamlEnvelope(stateHelperSource))
    .digest('hex')
  if (workflowSha256 !== TRUSTED_DRAFT_REPAIR_WORKFLOW_SHA256) {
    failures.push(
      `Draft asset repair must match the reviewed whole-workflow execution envelope (got ${workflowSha256})`
    )
  }
  if (
    helperSha256 !== TRUSTED_DRAFT_REPAIR_STATE_HELPER_SHA256 ||
    (active.match(new RegExp(TRUSTED_DRAFT_REPAIR_STATE_HELPER_SHA256, 'g'))
      ?.length ?? 0) !== 2
  ) {
    failures.push(
      'Draft asset repair must pin the reviewed fail-closed state helper in every permission domain'
    )
  }

  const jobs = workflowJobKeys(active)
  const expectedJobs = [
    'snapshot',
    'prepare-sign',
    'commit-resume',
    'final-verify',
  ]
  if (
    jobs.length !== expectedJobs.length ||
    jobs.some((job, index) => job !== expectedJobs[index])
  ) {
    failures.push(
      'Draft asset repair jobs must match the reviewed ordered permission-domain allowlist'
    )
  }
  const snapshot = jobBlock(active, 'snapshot')
  const prepare = jobBlock(active, 'prepare-sign')
  const commit = jobBlock(active, 'commit-resume')
  const finalVerify = jobBlock(active, 'final-verify')
  const namedStep = (block, name) =>
    workflowStepBlocks(block).find((step) => step.includes(`name: ${name}`)) ??
    ''
  const snapshotAuthority = namedStep(
    snapshot,
    'Resolve exact one-time repair authority'
  )
  const snapshotArtifactMetadata = namedStep(
    snapshot,
    'Authenticate old Draft snapshot artifact'
  )
  const preparedArtifactMetadata = namedStep(
    prepare,
    'Authenticate prepared repair artifact'
  )
  const prepareHarnessCheckout = namedStep(
    prepare,
    'Checkout protected repair harness'
  )
  const snapshotArtifactDownload = namedStep(
    prepare,
    'Download exact authenticated old Draft snapshot'
  )
  const repairAuthority = namedStep(
    commit,
    'Resolve exact prepared repair artifact authority'
  )
  const repairDownload = namedStep(
    commit,
    'Download exact authenticated repair bundle'
  )
  const repairBundlePin = namedStep(
    commit,
    'Safely extract and pin the exact repair bundle'
  )
  const mutation = namedStep(
    commit,
    'Execute fail-closed forward-only repair state machine'
  )
  const committedReadback = namedStep(
    commit,
    'Read back exact committed Draft without repository code'
  )
  const finalArtifactMetadata = namedStep(
    commit,
    'Authenticate final Draft readback artifact'
  )
  const finalArtifactDownload = namedStep(
    finalVerify,
    'Download exact authenticated final Draft readback'
  )
  const finalHarnessCheckout = namedStep(
    finalVerify,
    'Checkout protected postflight harness'
  )
  const finalPostflight = namedStep(
    finalVerify,
    'Validate frozen final Draft state and asset bytes'
  )
  const finalAcceptance = namedStep(
    finalVerify,
    'Run complete updater and release acceptance'
  )
  const permissions = topLevelBlock(active, 'permissions')
  const concurrency = topLevelBlock(active, 'concurrency')
  if (
    !/^name:\s*Desktop Release Draft Asset Repair\s*$/m.test(active) ||
    !active.includes('workflow_dispatch:') ||
    !active.includes('confirm:') ||
    /(?:^|\n)\s+(?:push|release):\s*(?:\n|$)/m.test(
      topLevelBlock(active, 'on') ?? ''
    )
  ) {
    failures.push(
      'Draft asset repair must be an exact-confirmation manual-only workflow'
    )
  }
  if (
    !permissions ||
    normalizedYamlEnvelope(permissions) !==
      'permissions:\n  actions: read\n  contents: read\n'
  ) {
    failures.push(
      'Draft asset repair top-level permissions must be actions: read and contents: read only'
    )
  }
  if (
    !concurrency ||
    !concurrency.includes('group: release-distribution-live-keys') ||
    !concurrency.includes('cancel-in-progress: false')
  ) {
    failures.push(
      'Draft asset repair must serialize against live release distribution'
    )
  }

  const expectedJobPermissions = new Map([
    [
      'snapshot',
      '    permissions:\n      actions: read\n      contents: write\n',
    ],
    [
      'prepare-sign',
      '    permissions:\n      actions: read\n      contents: read\n',
    ],
    [
      'commit-resume',
      '    permissions:\n      actions: read\n      contents: write\n',
    ],
    [
      'final-verify',
      '    permissions:\n      actions: read\n      contents: read\n',
    ],
  ])
  for (const [jobName, expected] of expectedJobPermissions) {
    const block = jobBlock(active, jobName)
    const jobPermissions = jobPermissionBlocks(block)
    if (
      !block ||
      (jobName === 'final-verify'
        ? /^    environment:\s*/m.test(block)
        : !/^    environment:\s*release-distribution\s*$/m.test(block)) ||
      jobPermissions.length !== 1 ||
      normalizedYamlEnvelope(jobPermissions[0]) !== expected
    ) {
      failures.push(
        `Draft asset repair ${jobName} must retain its exact release-distribution permission domain`
      )
    }
  }
  if (
    !snapshot?.includes(
      'current_workflow_sha: ${{ steps.authority.outputs.current_workflow_sha }}'
    ) ||
    !prepare?.includes(
      'prepared_head: ${{ steps.repair-metadata.outputs.prepared_head }}'
    ) ||
    !prepare.includes(
      'repair_run_attempt: ${{ steps.repair-metadata.outputs.run_attempt }}'
    ) ||
    !commit?.includes(
      'current_workflow_sha: ${{ steps.repair-authority.outputs.current_workflow_sha }}'
    ) ||
    !commit.includes(
      'prepared_head: ${{ steps.repair-authority.outputs.prepared_head }}'
    ) ||
    !snapshotAuthority.includes(
      'echo "current_workflow_sha=$WORKFLOW_SHA" >>"$GITHUB_OUTPUT"'
    ) ||
    !prepareHarnessCheckout.includes(
      'ref: ${{ needs.snapshot.outputs.current_workflow_sha }}'
    ) ||
    !snapshotArtifactDownload.includes(
      'EXPECTED_HEAD: ${{ needs.snapshot.outputs.current_workflow_sha }}'
    ) ||
    !mutation.includes(
      'EXPECTED_MAIN: ${{ steps.repair-authority.outputs.current_workflow_sha }}'
    ) ||
    !committedReadback.includes(
      'EXPECTED_MAIN: ${{ steps.repair-authority.outputs.current_workflow_sha }}'
    ) ||
    !finalHarnessCheckout.includes(
      'ref: ${{ needs.commit-resume.outputs.current_workflow_sha }}'
    ) ||
    !finalPostflight.includes(
      'EXPECTED_MAIN: ${{ needs.commit-resume.outputs.current_workflow_sha }}'
    )
  ) {
    failures.push(
      'Draft asset repair must keep current workflow authority separate from authenticated prepared-head provenance'
    )
  }

  const protectedControlSteps = [
    [
      snapshotAuthority,
      '"$WORKFLOW_SHA" \\\n            "$live_main" \\\n            "snapshot-execution-live"',
    ],
    [
      repairAuthority,
      '"$WORKFLOW_SHA" \\\n            "$live_main" \\\n            "commit-execution-live"',
    ],
    [
      mutation,
      '"$EXPECTED_MAIN" \\\n              "$live_main" \\\n              "mutation-execution-live"',
    ],
    [
      committedReadback,
      '"$EXPECTED_MAIN" \\\n            "$live_main" \\\n            "readback-execution-live"',
    ],
    [
      finalPostflight,
      '"$EXPECTED_MAIN" \\\n            "$live_main" \\\n            "postflight-execution-live"',
    ],
  ]
  const hasProtectedControlProof = (step, invocation) => {
    const functionStart = step.indexOf('verify_ancestor_and_control_blobs()')
    const functionEnd =
      functionStart < 0 ? -1 : step.indexOf('\n          }\n', functionStart)
    const proof =
      functionEnd < 0
        ? ''
        : step.slice(functionStart, functionEnd + '\n          }\n'.length)
    return (
      proof.includes('"repos/$GITHUB_REPOSITORY/compare/$base...$head"') &&
      (proof.match(/^\s+jq -e \\\s*$/gm)?.length ?? 0) === 1 &&
      proof.includes(`' "$compare_json" >/dev/null`) &&
      proof.includes('.base_commit.sha == $base') &&
      proof.includes('.merge_base_commit.sha == $base') &&
      proof.includes('.behind_by == 0') &&
      proof.includes('$base == $head') &&
      proof.includes('.status == "identical"') &&
      proof.includes('.ahead_by == 0') &&
      proof.includes('.total_commits == 0') &&
      proof.includes('$base != $head') &&
      proof.includes('.status == "ahead"') &&
      proof.includes('.ahead_by > 0') &&
      proof.includes('.total_commits == .ahead_by') &&
      proof.includes('.commits[-1].sha == $head') &&
      (proof.match(/for control_key in workflow helper; do/g)?.length ?? 0) ===
        1 &&
      proof.includes(
        'path=".github/workflows/desktop-release-draft-repair.yml"'
      ) &&
      proof.includes(
        'path="scripts/release-distribution/draft-asset-repair-state.mjs"'
      ) &&
      proof.includes('"repos/$GITHUB_REPOSITORY/contents/$path?ref=$base"') &&
      proof.includes('"repos/$GITHUB_REPOSITORY/contents/$path?ref=$head"') &&
      (proof.match(/select\(\.type == "file" and \.path == \$path\)/g)
        ?.length ?? 0) === 2 &&
      (proof.match(/^\s+jq -er \\\s*$/gm)?.length ?? 0) === 2 &&
      (proof.match(/and test\("\^\[0-9a-f\]\{40\}\$"\)/g)?.length ?? 0) === 2 &&
      (proof.includes('test "$base_blob" = "$head_blob"') ||
        (proof.includes('if [ "$base_blob" != "$head_blob" ]; then') &&
          proof.includes(
            'echo "Protected control file drifted across $label: $path" >&2'
          ) &&
          proof.includes('exit 1'))) &&
      step.includes(invocation)
    )
  }
  if (
    protectedControlSteps.some(
      ([step, invocation]) => !hasProtectedControlProof(step, invocation)
    )
  ) {
    failures.push(
      'Draft asset repair must revalidate live-main ancestry and exact workflow/helper Git blobs before every authority, mutation, readback, and postflight boundary'
    )
  }
  const enforcedArtifactPredicates = [
    [snapshotArtifactMetadata, 1],
    [snapshotArtifactDownload, 1],
    [preparedArtifactMetadata, 1],
    [repairAuthority, 3],
    [repairDownload, 1],
    [finalArtifactMetadata, 1],
    [finalArtifactDownload, 1],
    [repairBundlePin, 1],
    [committedReadback, 2],
    [finalPostflight, 2],
  ]
  if (
    enforcedArtifactPredicates.some(
      ([step, expected]) =>
        (step.match(/^\s+jq -e(?:\s|$)/gm)?.length ?? 0) !== expected
    )
  ) {
    failures.push(
      'Draft asset repair must enforce every run, artifact, ancestry, byte-binding, plan, and state jq predicate'
    )
  }

  const pinnedCheckout =
    'actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683'
  const checkouts = actionStepBlocks(active, `${pinnedCheckout} # v4.2.2`)
  const allUses = active.match(/^\s*(?:-\s*)?uses:\s*([^\s#]+)/gm) ?? []
  const approvedPinnedActions =
    /^\s*(?:-\s*)?uses:\s*(?:actions\/checkout@11bd71901bbe5b1630ceea73d27597364c9af683|actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020|actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02)(?:\s|#|$)/
  if (
    checkouts.length !== 4 ||
    checkouts.some(
      (step) => !/^\s*persist-credentials:\s*false\s*$/m.test(step)
    ) ||
    allUses.length !== 11 ||
    allUses.some((line) => !approvedPinnedActions.test(line)) ||
    (commit?.match(/^\s*(?:-\s*)?uses:\s*.+$/gm) ?? []).length !== 2 ||
    (commit?.match(new RegExp(escapeRegExp(pinnedCheckout), 'g')) ?? [])
      .length !== 0
  ) {
    failures.push(
      'Draft asset repair actions must be exact SHA-pinned, checkouts read-only, and mutation must not checkout repository code'
    )
  }
  const signingSecretPattern =
    /\$\{\{\s*secrets\.TAURI_SIGNING_PRIVATE_KEY(?:_PASSWORD)?\s*\}\}/g
  const signingSecrets = active.match(signingSecretPattern) ?? []
  if (
    signingSecrets.length !== 4 ||
    !prepare ||
    (prepare.match(signingSecretPattern) ?? []).length !== 4 ||
    [snapshot, commit, finalVerify].some(
      (block) => (block?.match(signingSecretPattern) ?? []).length > 0
    ) ||
    /\bBIYAN_SIGNING_KEY\b/.test(active) ||
    /\$\{\{\s*secrets\.(?!TAURI_SIGNING_PRIVATE_KEY(?:_PASSWORD)?\b)/.test(
      active
    )
  ) {
    failures.push(
      'Draft asset repair must isolate only the two Tauri signing secrets inside prepare-sign'
    )
  }
  const alwaysConditions = active.match(
    /^\s*if:\s*\$\{\{\s*always\(\)\s*\}\}\s*$/gm
  )
  const allConditions = active.match(/^\s*if:\s*/gm)
  if (
    YAML_CONTINUE_ON_ERROR.test(active) ||
    /\|\|\s*true\b/.test(active) ||
    (alwaysConditions?.length ?? 0) !== 2 ||
    (allConditions?.length ?? 0) !== 5 ||
    !snapshot?.includes(
      "if: ${{ false && inputs.prepared_run_id == '' && inputs.prepared_run_attempt == '' }}"
    ) ||
    !commit?.includes('false &&\n        always() &&') ||
    !commit?.includes('always() &&') ||
    !commit.includes("inputs.prepared_run_id == '' &&") ||
    !commit.includes("inputs.prepared_run_attempt == '' &&") ||
    !commit.includes("needs.snapshot.result == 'success' &&") ||
    !commit.includes("needs.prepare-sign.result == 'success'") ||
    !commit.includes("inputs.prepared_run_id != '' ||") ||
    !commit.includes("inputs.prepared_run_attempt != ''") ||
    !finalVerify?.includes("needs.commit-resume.result == 'success'") ||
    !finalVerify.includes(
      "needs.commit-resume.outputs.final_state == 'committed'"
    )
  ) {
    failures.push(
      'Retired Draft asset repair must stay permanently disabled while preserving the exact fail-closed prepare, resume, committed-postflight, and two always-run evidence conditions'
    )
  }

  const requiredExactStrings = [
    'REPAIR_V0643_LINUX_UPDATER_SIGNATURE',
    '360025177',
    'v0.6.643',
    '38e6d9290a8b9b0f152ff2a7eefb550e6ead7df5',
    '2026-07-27T07:05:00Z',
    '2026-07-24T11:53:21.000Z',
    '2026-07-24T11:53:21Z',
    'Biyan v0.6.643',
    'github-actions[bot]',
    'd87e2105473786d9b0277ed05eb466c8cd5e14e28b89c13ffd10b3d3ca801c52',
    '1f5e60a7ed4107bcb11cf4dc0b7876ec97bad51cb6705678dc1fd15f192d917e',
    '803568bd4c04ba5f3cd7144b000f0d27ad8f4c63a7af9084a5762b679d047fe3',
    'Biyan_0.6.643_amd64.AppImage.sig',
    'candidate.json',
    'candidate.json.sig',
    'latest.json',
    'SHA256SUMS',
  ]
  if (requiredExactStrings.some((value) => !active.includes(value))) {
    failures.push(
      'Draft asset repair must retain the exact release, source, snapshot, AppImage, and five-file allowlist'
    )
  }
  if (
    !snapshot?.includes('name: Snapshot exact mutable Draft') ||
    !snapshot.includes('contents: write') ||
    !snapshot.includes('releases/360025177') ||
    !snapshot.includes('releases/assets/$id') ||
    !snapshot.includes('compression-level: 0') ||
    !snapshot.includes('.author.login == "github-actions[bot]"') ||
    !snapshot.includes('and .created_at == "2026-07-24T11:53:21Z"') ||
    !snapshot.includes(
      '"d87e2105473786d9b0277ed05eb466c8cd5e14e28b89c13ffd10b3d3ca801c52"'
    ) ||
    !snapshot.includes(
      'name: biyan-v0.6.643-draft-snapshot-360025177-attempt-${{ github.run_attempt }}'
    ) ||
    !prepare?.includes('name: Re-sign exact retained Linux AppImage') ||
    !prepare.includes('rm -f "$signature"') ||
    !prepare.includes('yarn tauri signer sign') ||
    !prepare.includes('name: Sign corrected candidate provenance') ||
    !prepare.includes('node harness/scripts/updater/verify-candidate.mjs') ||
    !prepare.includes(
      'node harness/scripts/release-distribution/collect-release-assets.mjs'
    ) ||
    !prepare.includes('schema: 2') ||
    !prepare.includes(
      'WORKFLOW_SHA: ${{ needs.snapshot.outputs.current_workflow_sha }}'
    ) ||
    !prepare.includes('workflowSha: process.env.WORKFLOW_SHA') ||
    !prepare.includes(
      'name: biyan-v0.6.643-draft-repair-360025177-attempt-${{ github.run_attempt }}'
    ) ||
    /\b(?:make|yarn)\s+build\b/.test(prepare)
  ) {
    failures.push(
      'Draft asset repair must snapshot exact old bytes and only re-sign/rebuild derivative metadata without rebuilding native packages'
    )
  }
  if (
    /(?:--method|-X)\s+(?:POST|PUT|PATCH|DELETE)\b/i.test(snapshot) ||
    /\bgh\s+release\s+(?:create|delete|edit|upload)\b/i.test(snapshot) ||
    /uploads\.github\.com/i.test(snapshot) ||
    /\bmutation\s*\{/i.test(snapshot)
  ) {
    failures.push(
      'Draft asset repair snapshot must remain free of release mutation authority'
    )
  }
  if (
    !commit?.includes('node "$helper"') ||
    !commit.includes('env -u GH_TOKEN') ||
    !commit.includes('rename-old-to-backup|rename-stage-to-canonical') ||
    !commit.includes('delete-starter-stage|delete-backup)') ||
    !commit.includes('releases/assets/$asset_id') ||
    !commit.includes('assets?name=$encoded_name') ||
    !commit.includes('for iteration in $(seq 0 80)') ||
    !commit.includes('for read_attempt in $(seq 1 5)') ||
    !commit.includes('sleep $((read_attempt * 2))') ||
    !commit.includes('sleep 2') ||
    !commit.includes('final_state=committed') ||
    /--clobber\b/.test(commit)
  ) {
    failures.push(
      'Draft asset repair must use the reviewed stage-all, rename, backup, delete, and forward-resume state machine'
    )
  }
  const pinnedUpload =
    'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2'
  const uploadSteps = actionStepBlocks(active, pinnedUpload)
  const expectedAttemptScopedArtifacts = [
    'biyan-v0.6.643-draft-snapshot-360025177-attempt-${{ github.run_attempt }}',
    'biyan-v0.6.643-draft-repair-360025177-attempt-${{ github.run_attempt }}',
    'biyan-v0.6.643-draft-repair-final-snapshot-attempt-${{ github.run_attempt }}',
    'biyan-v0.6.643-draft-repair-mutation-evidence-attempt-${{ github.run_attempt }}',
    'biyan-v0.6.643-draft-repair-postflight-evidence-attempt-${{ github.run_attempt }}',
  ]
  if (
    uploadSteps.length !== expectedAttemptScopedArtifacts.length ||
    expectedAttemptScopedArtifacts.some(
      (name) =>
        uploadSteps.filter((step) => step.includes(`name: ${name}`)).length !==
        1
    )
  ) {
    failures.push(
      'Draft asset repair must SHA-pin and run-attempt-scope every immutable snapshot, repair, and evidence artifact'
    )
  }
  if (
    !snapshotArtifactMetadata.includes(
      'CURRENT_SHA: ${{ steps.authority.outputs.current_workflow_sha }}'
    ) ||
    !snapshotArtifactMetadata.includes(
      '--arg name "biyan-v0.6.643-draft-snapshot-360025177-attempt-$CURRENT_RUN_ATTEMPT"'
    ) ||
    !snapshotArtifactMetadata.includes('.id == $artifact_id') ||
    !snapshotArtifactMetadata.includes('.name == $name') ||
    !snapshotArtifactMetadata.includes('.expired == false') ||
    !snapshotArtifactMetadata.includes('.size_in_bytes > 0') ||
    !snapshotArtifactMetadata.includes('.digest == $digest') ||
    !snapshotArtifactMetadata.includes('.workflow_run.id == $run_id') ||
    !snapshotArtifactMetadata.includes('.workflow_run.head_sha == $head') ||
    !snapshotArtifactDownload.includes('.id == $artifact_id') ||
    !snapshotArtifactDownload.includes('.expired == false') ||
    !snapshotArtifactDownload.includes('.size_in_bytes > 0') ||
    !snapshotArtifactDownload.includes('.digest == $digest') ||
    !snapshotArtifactDownload.includes('.workflow_run.id == $run_id') ||
    !snapshotArtifactDownload.includes('.workflow_run.head_sha == $head') ||
    !snapshotArtifactDownload.includes(
      'test "$(stat -c \'%s\' "$archive")" = "$ARTIFACT_SIZE"'
    ) ||
    !snapshotArtifactDownload.includes(
      'test "sha256:$(sha256sum "$archive" | awk \'{ print $1 }\')" ='
    ) ||
    !preparedArtifactMetadata.includes(
      'CURRENT_SHA: ${{ needs.snapshot.outputs.current_workflow_sha }}'
    ) ||
    !preparedArtifactMetadata.includes(
      '--arg name "biyan-v0.6.643-draft-repair-360025177-attempt-$CURRENT_RUN_ATTEMPT"'
    ) ||
    !preparedArtifactMetadata.includes('.id == $artifact_id') ||
    !preparedArtifactMetadata.includes('.name == $name') ||
    !preparedArtifactMetadata.includes('.expired == false') ||
    !preparedArtifactMetadata.includes('.size_in_bytes > 0') ||
    !preparedArtifactMetadata.includes('.digest == $digest') ||
    !preparedArtifactMetadata.includes('.workflow_run.id == $run_id') ||
    !preparedArtifactMetadata.includes('.workflow_run.head_sha == $head')
  ) {
    failures.push(
      'Draft asset repair snapshot and prepared artifacts must bind exact current run, attempt, and workflow SHA metadata'
    )
  }
  if (
    !prepare?.includes(
      'repair_run_attempt: ${{ steps.repair-metadata.outputs.run_attempt }}'
    ) ||
    !prepare.includes(
      'prepared_head: ${{ steps.repair-metadata.outputs.prepared_head }}'
    ) ||
    !prepare.includes('echo "prepared_head=$CURRENT_SHA"') ||
    !prepare.includes('echo "run_attempt=$CURRENT_RUN_ATTEMPT"') ||
    !commit?.includes(
      'CURRENT_PREPARED_HEAD: ${{ needs.prepare-sign.outputs.prepared_head }}'
    ) ||
    !commit?.includes(
      'CURRENT_PREPARED_RUN_ATTEMPT: ${{ needs.prepare-sign.outputs.repair_run_attempt }}'
    ) ||
    !commit.includes('prepared_run_id="$CURRENT_RUN_ID"') ||
    !commit.includes('prepared_run_attempt="$CURRENT_PREPARED_RUN_ATTEMPT"') ||
    !commit.includes(
      '[[ ! "$CURRENT_PREPARED_RUN_ATTEMPT" =~ ^[1-9][0-9]*$ ]]'
    ) ||
    !commit.includes(
      '[ "$CURRENT_PREPARED_RUN_ATTEMPT" -gt "$CURRENT_RUN_ATTEMPT" ]'
    ) ||
    !commit.includes('[[ ! "$CURRENT_PREPARED_HEAD" =~ ^[0-9a-f]{40}$ ]]') ||
    !commit.includes('[ "$CURRENT_PREPARED_HEAD" != "$WORKFLOW_SHA" ]') ||
    !commit.includes('[[ "$INPUT_PREPARED_RUN_ID" =~ ^[1-9][0-9]*$ ]]') ||
    !commit.includes('[[ "$INPUT_PREPARED_RUN_ATTEMPT" =~ ^[1-9][0-9]*$ ]]') ||
    !commit.includes('[ "$INPUT_PREPARED_RUN_ID" != "$CURRENT_RUN_ID" ]') ||
    !commit.includes('test "$prepared_head" = "$CURRENT_PREPARED_HEAD"') ||
    !commit.includes('test "$prepared_head" = "$WORKFLOW_SHA"') ||
    !commit.includes(
      'Prepared run ID and attempt must be an exact external pair'
    )
  ) {
    failures.push(
      'Draft asset repair must retain the exact successful same-run preparation attempt and require an explicit external run-attempt pair for resume'
    )
  }
  if (
    !repairAuthority.includes(
      '"repos/$GITHUB_REPOSITORY/actions/runs/$prepared_run_id"'
    ) ||
    !repairAuthority.includes('.id == $run_id') ||
    !repairAuthority.includes('.repository.full_name == "realerikk0/Mita"') ||
    !repairAuthority.includes(
      '.head_repository.full_name == "realerikk0/Mita"'
    ) ||
    !repairAuthority.includes('.event == "workflow_dispatch"') ||
    !repairAuthority.includes('.head_branch == "mita-main"') ||
    !repairAuthority.includes('and (.head_sha | test("^[0-9a-f]{40}$"))') ||
    !repairAuthority.includes(
      '.path ==\n                ".github/workflows/desktop-release-draft-repair.yml"'
    ) ||
    !repairAuthority.includes(
      '.name == "Desktop Release Draft Asset Repair"'
    ) ||
    !repairAuthority.includes('.run_attempt >= $attempt') ||
    !repairAuthority.includes('($current and .status == "in_progress")') ||
    !repairAuthority.includes(
      '(($current | not) and .status == "completed")'
    ) ||
    !repairAuthority.includes(
      '\'.head_sha | select(test("^[0-9a-f]{40}$"))\''
    ) ||
    !repairAuthority.includes(
      '"$prepared_head" \\\n              "$WORKFLOW_SHA" \\\n              "prepared-execution"'
    ) ||
    !repairAuthority.includes(
      'artifact_name="biyan-v0.6.643-draft-repair-360025177-attempt-$prepared_run_attempt"'
    ) ||
    !repairAuthority.includes('for lookup_attempt in $(seq 1 8)') ||
    !repairAuthority.includes(
      '"repos/$GITHUB_REPOSITORY/actions/runs/$prepared_run_id/artifacts?per_page=100"'
    ) ||
    !repairAuthority.includes(
      '[.artifacts[] | select(.name == $name)] | length'
    ) ||
    !repairAuthority.includes('if [ "$count" = 1 ]; then') ||
    !repairAuthority.includes('.workflow_run.id == $run_id') ||
    !repairAuthority.includes('.workflow_run.head_sha == $head') ||
    !repairAuthority.includes(
      'and (.digest | test("^sha256:[0-9a-f]{64}$"))'
    ) ||
    !repairAuthority.includes('echo "current_workflow_sha=$WORKFLOW_SHA"') ||
    !repairAuthority.includes('echo "prepared_head=$prepared_head"') ||
    !repairAuthority.includes('echo "prepared_run_id=$prepared_run_id"') ||
    !repairAuthority.includes(
      'echo "prepared_run_attempt=$prepared_run_attempt"'
    ) ||
    !repairDownload.includes(
      'EXPECTED_HEAD: ${{ steps.repair-authority.outputs.prepared_head }}'
    ) ||
    !repairDownload.includes(
      'EXPECTED_RUN: ${{ steps.repair-authority.outputs.prepared_run_id }}'
    ) ||
    !repairDownload.includes('.id == $artifact_id') ||
    !repairDownload.includes('.name == $name') ||
    !repairDownload.includes('.expired == false') ||
    !repairDownload.includes('.size_in_bytes > 0') ||
    !repairDownload.includes('.digest == $digest') ||
    !repairDownload.includes('.workflow_run.id == $run_id') ||
    !repairDownload.includes('.workflow_run.head_sha == $head') ||
    !repairDownload.includes(
      'test "$(stat -c \'%s\' "$archive")" = "$ARTIFACT_SIZE"'
    ) ||
    !repairDownload.includes(
      'test "sha256:$(sha256sum "$archive" | awk \'{ print $1 }\')" ='
    )
  ) {
    failures.push(
      'Draft asset repair cross-run resume must authenticate exact run-attempt provenance, prepared-head ancestry, unique artifact identity, and archive bytes'
    )
  }
  if (
    !repairBundlePin.includes(
      '--arg head "${{ steps.repair-authority.outputs.prepared_head }}"'
    ) ||
    !repairBundlePin.includes('.schema == 2') ||
    !repairBundlePin.includes('.workflowSha == $head') ||
    !repairBundlePin.includes(
      "' dist/repair-bundle/repair-plan.json >/dev/null"
    ) ||
    !hasCommandSequence(committedReadback, [
      'cp \\',
      'dist/repair-bundle/repair-plan.json \\',
      'dist/final-snapshot/metadata/repair-plan.json',
    ]) ||
    !finalPostflight.includes(
      '--arg head "${{ needs.commit-resume.outputs.prepared_head }}"'
    ) ||
    !finalPostflight.includes('.schema == 2') ||
    !finalPostflight.includes('.workflowSha == $head') ||
    !hasCommandSequence(finalPostflight, [
      'node harness/scripts/release-distribution/draft-asset-repair-state.mjs \\',
      '--plan dist/final/metadata/repair-plan.json \\',
      '--release dist/final/metadata/final-release.json \\',
      '--output dist/final/reclassified-state.json \\',
      '>/dev/null',
      'cmp \\',
      'dist/final/metadata/final-state.json \\',
      'dist/final/reclassified-state.json',
    ])
  ) {
    failures.push(
      'Draft asset repair plan and final state must remain bound to the authenticated prepared head'
    )
  }
  if (
    !commit?.includes(
      'final_artifact_id: ${{ steps.final-upload.outputs.artifact-id }}'
    ) ||
    !commit.includes(
      'final_artifact_digest: ${{ steps.final-metadata.outputs.artifact_digest }}'
    ) ||
    !commit.includes(
      'final_artifact_name: ${{ steps.final-metadata.outputs.artifact_name }}'
    ) ||
    !commit.includes(
      'final_artifact_size: ${{ steps.final-metadata.outputs.artifact_size }}'
    ) ||
    !commit.includes('dist/final-snapshot/metadata/final-release.json') ||
    !commit.includes('dist/final-snapshot/metadata/final-state.json') ||
    !commit.includes(
      'find dist/final-snapshot/assets -maxdepth 1 -type f | wc -l'
    ) ||
    !commit.includes(')" -eq 13') ||
    !commit.includes(
      'name: biyan-v0.6.643-draft-repair-final-snapshot-attempt-${{ github.run_attempt }}'
    ) ||
    !finalArtifactMetadata.includes(
      'ACTION_ARTIFACT_DIGEST: ${{ steps.final-upload.outputs.artifact-digest }}'
    ) ||
    !finalArtifactMetadata.includes(
      'CURRENT_SHA: ${{ steps.repair-authority.outputs.current_workflow_sha }}'
    ) ||
    !finalArtifactMetadata.includes(
      '--arg name "biyan-v0.6.643-draft-repair-final-snapshot-attempt-$CURRENT_RUN_ATTEMPT"'
    ) ||
    !finalArtifactMetadata.includes('.id == $artifact_id') ||
    !finalArtifactMetadata.includes('.name == $name') ||
    !finalArtifactMetadata.includes('.expired == false') ||
    !finalArtifactMetadata.includes('.size_in_bytes > 0') ||
    !finalArtifactMetadata.includes('.digest == $digest') ||
    !finalArtifactMetadata.includes('.workflow_run.id == $run_id') ||
    !finalArtifactMetadata.includes('.workflow_run.head_sha == $head')
  ) {
    failures.push(
      'Draft asset repair mutation domain must byte-bind all 13 committed assets into an authenticated immutable final snapshot'
    )
  }
  if (
    !finalArtifactDownload.includes(
      'EXPECTED_HEAD: ${{ needs.commit-resume.outputs.current_workflow_sha }}'
    ) ||
    !finalArtifactDownload.includes('EXPECTED_RUN: ${{ github.run_id }}') ||
    !finalArtifactDownload.includes('.id == $artifact_id') ||
    !finalArtifactDownload.includes('.name == $name') ||
    !finalArtifactDownload.includes('.expired == false') ||
    !finalArtifactDownload.includes('.size_in_bytes > 0') ||
    !finalArtifactDownload.includes('.digest == $digest') ||
    !finalArtifactDownload.includes('.workflow_run.id == $run_id') ||
    !finalArtifactDownload.includes('.workflow_run.head_sha == $head') ||
    !finalArtifactDownload.includes(
      'test "$(stat -c \'%s\' "$archive")" = "$ARTIFACT_SIZE"'
    ) ||
    !finalArtifactDownload.includes(
      'test "sha256:$(sha256sum "$archive" | awk \'{ print $1 }\')" ='
    ) ||
    !finalAcceptance.includes(
      'node harness/scripts/updater/verify-candidate.mjs'
    ) ||
    !finalAcceptance.includes('sha256sum --check SHA256SUMS') ||
    !finalAcceptance.includes(
      'node harness/scripts/release-distribution/collect-release-assets.mjs'
    ) ||
    !finalAcceptance.includes('printf \'%s\\n\' "verified-draft-only"')
  ) {
    failures.push(
      'Draft asset repair final verifier must authenticate the immutable current-run snapshot and run complete signatures, checksum, and release acceptance'
    )
  }
  if (
    !finalVerify?.includes(
      'name: Verify exact repaired Draft from read-only snapshot'
    ) ||
    !jobNeeds(finalVerify, 'commit-resume') ||
    !finalVerify.includes('state == "committed"') ||
    !finalVerify.includes(
      'ARTIFACT_DIGEST: ${{ needs.commit-resume.outputs.final_artifact_digest }}'
    ) ||
    !finalVerify.includes(
      'ARTIFACT_ID: ${{ needs.commit-resume.outputs.final_artifact_id }}'
    ) ||
    !finalVerify.includes(
      'ARTIFACT_NAME: ${{ needs.commit-resume.outputs.final_artifact_name }}'
    ) ||
    !finalVerify.includes(
      'ARTIFACT_SIZE: ${{ needs.commit-resume.outputs.final_artifact_size }}'
    ) ||
    !finalVerify.includes(
      'EXPECTED_HEAD: ${{ needs.commit-resume.outputs.current_workflow_sha }}'
    ) ||
    !finalVerify.includes('EXPECTED_RUN: ${{ github.run_id }}') ||
    !finalVerify.includes(
      '[[ "$ARTIFACT_NAME" =~ ^biyan-v0\\.6\\.643-draft-repair-final-snapshot-attempt-[1-9][0-9]*$ ]]'
    ) ||
    !finalVerify.includes('.id == $artifact_id') ||
    !finalVerify.includes('.name == $name') ||
    !finalVerify.includes('.size_in_bytes > 0') ||
    !finalVerify.includes('.digest == $digest') ||
    !finalVerify.includes('.workflow_run.id == $run_id') ||
    !finalVerify.includes('.workflow_run.head_sha == $head') ||
    !finalVerify.includes(
      'test "$(stat -c \'%s\' "$archive")" = "$ARTIFACT_SIZE"'
    ) ||
    !finalVerify.includes(
      'test "sha256:$(sha256sum "$archive" | awk \'{ print $1 }\')" ='
    ) ||
    !finalVerify.includes(
      'if found != expected:\n              raise ValueError("final snapshot inventory is incomplete")'
    ) ||
    !finalVerify.includes(
      'node harness/scripts/updater/verify-candidate.mjs'
    ) ||
    !finalVerify.includes('sha256sum --check SHA256SUMS') ||
    !finalVerify.includes(
      'node harness/scripts/release-distribution/collect-release-assets.mjs'
    ) ||
    !finalVerify.includes('verified-draft-only') ||
    finalVerify.includes(
      'gh api "repos/$GITHUB_REPOSITORY/releases/360025177"'
    ) ||
    finalVerify.includes('"repos/$GITHUB_REPOSITORY/releases/assets/$id"')
  ) {
    failures.push(
      'Draft asset repair must finish with complete byte, signature, checksum, provenance, and still-Draft verification'
    )
  }
  if (
    /\bgh\s+release\b/.test(active) ||
    /\bdraft\s*=\s*false\b/.test(active) ||
    /\b(?:ossutil|wrangler|feishu|promote-desktop-update|deploy-updater-router)\b/i.test(
      active
    ) ||
    /\b(?:git\s+push|gh\s+api[^\n]*\/git\/refs)\b/.test(active)
  ) {
    failures.push(
      'Draft asset repair must not publish, retag, distribute, notify, promote, or mutate updater storage'
    )
  }

  return failures
}

export function validateReleaseEnvironmentWorkflows(workflows) {
  const failures = []
  for (const [
    workflow,
    {
      exactJobNames,
      expectedEnvelopeSha256,
      expectedPermissions,
      jobName,
      jobNames,
      source,
    },
  ] of Object.entries(workflows)) {
    if (expectedEnvelopeSha256) {
      const actualEnvelopeSha256 = createHash('sha256')
        .update(normalizedYamlEnvelope(source))
        .digest('hex')
      if (actualEnvelopeSha256 !== expectedEnvelopeSha256) {
        failures.push(
          `${workflow} must match the reviewed whole-workflow execution envelope (got ${actualEnvelopeSha256})`
        )
      }
    }
    if (expectedPermissions) {
      const expected = `permissions:\n${Object.entries(expectedPermissions)
        .map(([permission, access]) => `  ${permission}: ${access}`)
        .join('\n')}\n`
      const actual = normalizedYamlEnvelope(
        topLevelBlock(uncommentedSource(source), 'permissions')
      )
      if (actual !== expected) {
        failures.push(
          `${workflow} must retain its exact top-level permission domain`
        )
      }
    }
    if (exactJobNames) {
      const actualJobNames = workflowJobKeys(uncommentedSource(source))
      if (
        actualJobNames.length !== exactJobNames.length ||
        actualJobNames.some(
          (actualJobName, index) => actualJobName !== exactJobNames[index]
        )
      ) {
        failures.push(
          `${workflow} jobs must match the reviewed ordered job allowlist`
        )
      }
    }
    const requiredJobs =
      exactJobNames ?? (Array.isArray(jobNames) ? jobNames : [jobName])
    for (const requiredJob of requiredJobs) {
      const block = jobBlock(source, requiredJob)
      if (!block) {
        failures.push(`${workflow} is missing the ${requiredJob} job`)
        continue
      }
      if (!/^    environment:\s*release-distribution\s*$/m.test(block)) {
        failures.push(
          `${workflow} ${requiredJob} must use the release-distribution environment`
        )
      }
    }
    if (workflow === '.github/workflows/biyan-a-canary.yml') {
      for (const retiredJob of ['preflight', 'platform-canary', 'aggregate']) {
        const block = jobBlock(source, retiredJob)
        const retiredGates =
          block?.match(
            /^    if:\s*\$\{\{\s*false && inputs\.mode != ''\s*\}\}\s*$/gm
          ) ?? []
        if (retiredGates.length !== 1) {
          failures.push(
            `${workflow} ${retiredJob} must remain permanently disabled as retired evidence`
          )
        }
      }
    }
    if (workflow === '.github/workflows/promote-desktop-update.yml') {
      const active = uncommentedSource(source)
      const trigger = topLevelBlock(active, 'on')
      const triggerKeys = trigger
        ? [
            ...trigger.matchAll(/^  ([A-Za-z0-9_-]+):\s*$/gm),
          ].map((match) => match[1])
        : []
      if (
        triggerKeys.length !== 1 ||
        triggerKeys[0] !== 'workflow_dispatch' ||
        !/^      phase:\s*$/m.test(trigger ?? '') ||
        !/^        options:\s*\[DIRECT_C, RECOVERY\]\s*$/m.test(
          trigger ?? ''
        )
      ) {
        failures.push(
          `${workflow} must expose only the reviewed manual DIRECT_C and RECOVERY promotion modes`
        )
      }
      if (
        !active.includes('"Biyan Direct Qualification"') ||
        !active.includes(
          'scripts/updater/direct-qualification-evidence.mjs validate-policy'
        ) ||
        !active.includes(
          '--policy scripts/updater/direct-qualification-policy.json'
        ) ||
        !active.includes('.deploymentMode == "direct-c"') ||
        !active.includes('.sampleSize == 16') ||
        !active.includes(
          'node scripts/updater/prepare-promotion.mjs "${prepare_args[@]}"'
        ) ||
        !active.includes('--phase "$PHASE"') ||
        active.includes('"Biyan A Canary"') ||
        active.includes('validate-approved-a') ||
        active.includes('legacy-a-transition-policy.json')
      ) {
        failures.push(
          `${workflow} must bind DIRECT_C to exact direct qualification evidence and the fail-closed one-shot promotion contract`
        )
      }
    }
  }
  return failures
}

export function validateDirectQualificationWorkflow(source) {
  const failures = []
  const active = uncommentedSource(source)
  const envelopeSha256 = createHash('sha256')
    .update(normalizedYamlEnvelope(source))
    .digest('hex')
  if (envelopeSha256 !== TRUSTED_DIRECT_QUALIFICATION_WORKFLOW_SHA256) {
    failures.push(
      `direct qualification must match the reviewed whole-workflow execution envelope (got ${envelopeSha256})`
    )
  }

  const jobs = workflowJobKeys(active)
  const expectedJobs = [
    'preflight',
    'stage-candidate',
    'qualification',
    'aggregate',
  ]
  if (
    jobs.length !== expectedJobs.length ||
    jobs.some((job, index) => job !== expectedJobs[index])
  ) {
    failures.push(
      'direct qualification jobs must match the reviewed ordered read-only job allowlist'
    )
  }
  if (
    !/^name:\s*Biyan Direct Qualification\s*$/m.test(active) ||
    normalizedYamlEnvelope(topLevelBlock(active, 'on')) !==
      'on:\n  workflow_dispatch:\n    inputs:\n      focused_lane:\n        description: Qualification scope\n        required: true\n        default: full\n        type: choice\n        options:\n          - full\n          - current-to-c-windows\n          - legacy-manual-to-c-windows\n' ||
    normalizedYamlEnvelope(topLevelBlock(active, 'permissions')) !==
      'permissions:\n  actions: read\n  contents: read\n' ||
    normalizedYamlEnvelope(topLevelBlock(active, 'concurrency')) !==
      'concurrency:\n  group: biyan-direct-qualification\n  cancel-in-progress: false\n'
  ) {
    failures.push(
      'direct qualification must remain exact manual-only read-only serialized evidence'
    )
  }
  const stage = jobBlock(active, 'stage-candidate')
  const stagePermissions = jobPermissionBlocks(stage)
  if (
    stagePermissions.length !== 1 ||
    normalizedYamlEnvelope(stagePermissions[0]) !==
      '    permissions:\n      actions: read\n      contents: write\n' ||
    expectedJobs
      .filter((job) => job !== 'stage-candidate')
      .some((job) => jobPermissionBlocks(jobBlock(active, job)).length !== 0)
  ) {
    failures.push(
      'only direct qualification Draft staging may request exact actions: read plus contents: write'
    )
  }
  const preflight = jobBlock(active, 'preflight')
  const qualification = jobBlock(active, 'qualification')
  const aggregate = jobBlock(active, 'aggregate')
  if (
    !preflight?.includes(
      'qualification_matrix: ${{ steps.resolve_scope.outputs.qualification_matrix }}'
    ) ||
    !preflight?.includes(
      'full_mode: ${{ steps.resolve_scope.outputs.full_mode }}'
    ) ||
    !preflight?.includes(
      'Bind dispatch to live protected main before trusted scripts'
    ) ||
    !preflight?.includes('qualification-scope') ||
    !preflight?.includes('--focused-lane "$FOCUSED_LANE"') ||
    !qualification?.includes(
      'matrix: ${{ fromJSON(needs.preflight.outputs.qualification_matrix) }}'
    ) ||
    !qualification?.includes('\n            diagnostic-summary `') ||
    !qualification?.includes(
      'name: direct-qualification-diagnostic-summary-${{ github.run_id }}-${{ github.run_attempt }}'
    ) ||
    !aggregate?.includes('always()') ||
    !aggregate?.includes('!cancelled()') ||
    !aggregate?.includes("needs.preflight.outputs.full_mode == 'true'") ||
    !aggregate?.includes("needs.qualification.result == 'success'") ||
    !aggregate?.includes("needs.qualification.result == 'failure'") ||
    !aggregate?.includes(
      "needs.qualification.result == 'success'\n            && steps.aggregate_evidence.outcome == 'success'"
    )
  ) {
    failures.push(
      'direct qualification must preserve the policy-derived full 16 or focused current/manual Windows 1 scope and non-promotable diagnostics'
    )
  }
  if (
    (active.match(/--startup-seconds(?:',)?\s+'?10'?/g) ?? []).length !== 2 ||
    (active.match(/--migration-timeout-seconds(?:',)?\s+'?90'?/g) ?? [])
      .length !== 2
  ) {
    failures.push(
      'direct qualification must retain the exact 10-second startup and 90-second migration readiness bounds on both runner shells'
    )
  }
  if (
    /^\s+environment:\s*/m.test(active) ||
    /\$\{\{\s*secrets\./.test(active) ||
    /\b(?:ossutil|wrangler|feishu)\b/i.test(active) ||
    /\bgh\s+release\s+(?:create|delete|edit|upload)\b/.test(active) ||
    /\bgh\s+api\b[^\n]*(?:--method|-X)\s+(?:POST|PATCH|PUT|DELETE)\b/i.test(
      active
    ) ||
    /uploads\.github\.com/.test(active)
  ) {
    failures.push(
      'direct qualification must have no environment, secret, release mutation, or production writer'
    )
  }
  for (const step of actionStepBlocks(active, 'actions/checkout@v4')) {
    if (!step.includes('persist-credentials: false')) {
      failures.push(
        'direct qualification checkouts must disable persisted credentials'
      )
    }
  }
  return failures
}

export function validateBiyanDownloadAliasBootstrapWorkflow(source) {
  const failures = []
  const active = uncommentedSource(source)
  const workflowEnvelopeSha256 = createHash('sha256')
    .update(normalizedYamlEnvelope(source))
    .digest('hex')
  if (workflowEnvelopeSha256 !== TRUSTED_RELEASE_DISTRIBUTION_WORKFLOW_SHA256) {
    failures.push(
      `release distribution must match the reviewed whole-workflow execution envelope (got ${workflowEnvelopeSha256})`
    )
  }
  const bootstrap = jobBlock(active, 'bootstrap-biyan-download-aliases')
  const distribute = jobBlock(active, 'distribute')
  const permissions = topLevelBlock(active, 'permissions')
  const topLevelPermissionsCount = [
    ...active.matchAll(/^permissions:\s*(?:#.*)?$/gm),
  ].length

  if (
    topLevelPermissionsCount !== 1 ||
    normalizedYamlEnvelope(permissions) !== 'permissions:\n  contents: read\n'
  ) {
    failures.push(
      'release distribution top-level permissions must be exactly contents: read'
    )
  }
  if (
    !/concurrency:\n  group:\s*release-distribution-live-keys\n  cancel-in-progress:\s*false/m.test(
      active
    )
  ) {
    failures.push(
      'release distribution and one-time bootstrap must share the constant live-key lock'
    )
  }
  if (
    !/^\s{6}operation:\s*$/m.test(active) ||
    !/^\s{10}- bootstrap-biyan-download-aliases\s*$/m.test(active) ||
    !/^\s{6}bootstrap_confirm:\s*$/m.test(active)
  ) {
    failures.push(
      'release distribution manual inputs must explicitly select and confirm the allowlisted bootstrap operation'
    )
  }
  if (
    !distribute ||
    !/^    if:\s*github\.event_name == 'release' \|\| inputs\.operation == 'distribute'\s*$/m.test(
      distribute
    )
  ) {
    failures.push(
      'normal distribution must handle release publication and only the distribute manual operation'
    )
  }
  if (!bootstrap) {
    failures.push(
      'release distribution is missing the bootstrap-biyan-download-aliases job'
    )
    return failures
  }
  const bootstrapEnvelopeSha256 = createHash('sha256')
    .update(normalizedYamlEnvelope(bootstrap))
    .digest('hex')
  if (
    bootstrapEnvelopeSha256 !==
    TRUSTED_BIYAN_DOWNLOAD_ALIAS_BOOTSTRAP_JOB_SHA256
  ) {
    failures.push(
      `the Biyan alias bootstrap job must match the reviewed whole-job execution envelope (got ${bootstrapEnvelopeSha256})`
    )
  }

  if (
    !/^    if:\s*>-\n      false &&\n      github\.event_name == 'workflow_dispatch' &&\n      inputs\.operation == 'bootstrap-biyan-download-aliases'\s*$/m.test(
      bootstrap
    ) ||
    !/^    environment:\s*release-distribution\s*$/m.test(bootstrap) ||
    !/^    timeout-minutes:\s*45\s*$/m.test(bootstrap)
  ) {
    failures.push(
      'the historical Biyan alias bootstrap must remain permanently disabled in the bounded release-distribution environment job'
    )
  }
  const bootstrapPermissions = jobPermissionBlocks(bootstrap)
  if (
    bootstrapPermissions.length !== 1 ||
    normalizedYamlEnvelope(bootstrapPermissions[0]) !==
      '    permissions:\n      contents: read\n'
  ) {
    failures.push(
      'the Biyan alias bootstrap must use only contents: read GitHub authority'
    )
  }
  if (
    !bootstrap.includes('ref: mita-main') ||
    !bootstrap.includes('fetch-depth: 0') ||
    !bootstrap.includes('persist-credentials: false') ||
    !bootstrap.includes('WORKFLOW_REF: ${{ github.ref }}') ||
    !bootstrap.includes('[ "$WORKFLOW_REF" != "refs/heads/mita-main" ]')
  ) {
    failures.push(
      'the Biyan alias bootstrap must check out and revalidate protected live mita-main without persisted credentials'
    )
  }
  const bootstrapSteps = workflowStepBlocks(bootstrap)
  const namedBootstrapSteps = (name) =>
    bootstrapSteps.filter(
      (step) => step.split('\n')[0].trim() === `- name: ${name}`
    )
  const requestSteps = namedBootstrapSteps(
    'Resolve exact one-time bootstrap request'
  )
  const provenanceSteps = namedBootstrapSteps(
    'Verify protected harness, tag, and checkpoint'
  )
  const revalidationSteps = namedBootstrapSteps(
    'Revalidate protected harness before OSS access'
  )
  if (
    requestSteps.length !== 1 ||
    !requestSteps[0].includes('WORKFLOW_SHA: ${{ github.sha }}') ||
    !requestSteps[0].includes('[[ ! "$WORKFLOW_SHA" =~ ^[0-9a-f]{40}$ ]]') ||
    !requestSteps[0].includes('echo "workflow_sha=$WORKFLOW_SHA"')
  ) {
    failures.push(
      'the Biyan alias bootstrap must freeze and validate the full workflow dispatch SHA'
    )
  }
  if (
    provenanceSteps.length !== 1 ||
    !provenanceSteps[0].includes(
      'WORKFLOW_SHA: ${{ steps.bootstrap.outputs.workflow_sha }}'
    ) ||
    !/^\s*if \[ "\$checkout_head" != "\$WORKFLOW_SHA" \] \|\| \[ "\$WORKFLOW_SHA" != "\$live_main" \]; then\n\s+echo\b[^\n]*>&2\n\s+exit 1\n\s+fi\s*$/m.test(
      provenanceSteps[0]
    )
  ) {
    failures.push(
      'the Biyan alias bootstrap must require checkout HEAD, dispatch SHA, and live main to remain identical'
    )
  }
  if (revalidationSteps.length !== 1) {
    failures.push(
      'the Biyan alias bootstrap must have one exact protected-harness revalidation immediately before OSS access'
    )
  }
  for (const exact of [
    '[ "$INPUT_TAG" != "v0.6.643" ]',
    'source_commit=38e6d9290a8b9b0f152ff2a7eefb550e6ead7df5',
    'migration_phase=A',
    'data_schema=1',
    '[ "$INPUT_CONFIRM" != "BOOTSTRAP_BIYAN_ALIASES_V0633" ]',
    'git merge-base --is-ancestor "$tag_commit" origin/mita-main',
  ]) {
    if (!bootstrap.includes(exact)) {
      failures.push(
        `the Biyan alias bootstrap is missing exact reviewed identity contract: ${exact}`
      )
    }
  }
  if (
    !bootstrap.includes(
      'https://aliyuncli.alicdn.com/aliyun-cli-linux-3.3.22-amd64.tgz'
    ) ||
    !bootstrap.includes(
      '41a67dfd2f44c00eb628d9f91fa7c4807222de54ebe44fac3477fb9c70b3b0bc'
    ) ||
    !bootstrap.includes(
      'https://gosspublic.alicdn.com/ossutil/v2/2.3.0/ossutil-2.3.0-linux-amd64.zip'
    ) ||
    !bootstrap.includes(
      '3ae4d9fc85a7a6e9f5654d1599766f1a3a42a3692870887b5ae9338d582ef65a'
    )
  ) {
    failures.push(
      'the Biyan alias bootstrap must install only the checksum-pinned Aliyun clients'
    )
  }
  const revalidationIndex = bootstrap.indexOf(
    '- name: Revalidate protected harness before OSS access'
  )
  const executionIndex = bootstrap.indexOf(
    '- name: Execute allowlisted Biyan alias bootstrap'
  )
  if (
    revalidationIndex < 0 ||
    executionIndex <= revalidationIndex ||
    !bootstrap.includes(
      'node scripts/release-distribution/bootstrap-biyan-download-aliases.mjs'
    ) ||
    !bootstrap.includes(
      '--evidence dist/biyan-download-alias-bootstrap/state.json'
    ) ||
    !bootstrap.includes('args+=(--dry-run)')
  ) {
    failures.push(
      'the Biyan alias bootstrap must revalidate protected state before the exact dry-run-aware allowlisted script'
    )
  }
  for (const exact of [
    'ALIYUN_OSS_BUCKET: mita-static',
    'ALIYUN_OSS_ENDPOINT: https://oss-cn-hangzhou.aliyuncs.com',
    'OSS_REGION: cn-hangzhou',
    'UPDATES_CDN_BASE_URL: https://static.mitapp.cn',
  ]) {
    if (!bootstrap.includes(exact)) {
      failures.push(
        `the Biyan alias bootstrap is missing canonical storage authority: ${exact}`
      )
    }
  }
  if (
    !/- name: Require bootstrap evidence\n\s+if:\s*always\(\)/.test(
      bootstrap
    ) ||
    !/- name: Upload bootstrap evidence\n\s+if:\s*always\(\)/.test(bootstrap) ||
    !bootstrap.includes('if-no-files-found: error') ||
    !bootstrap.includes('dist/biyan-download-alias-bootstrap/**')
  ) {
    failures.push(
      'the Biyan alias bootstrap must always validate and upload its evidence'
    )
  }
  if (
    /\b(?:BIYAN_SIGNING_KEY|R2_ACCESS_KEY|CLOUDFLARE_API_TOKEN)\b/.test(
      bootstrap
    ) ||
    /\b(?:mita\/latest\.json|biyan\/updater\/|promote-desktop-update|deploy-updater-router)\b/.test(
      bootstrap
    ) ||
    /\$\{\{\s*(?:github\.token|secrets\.GITHUB_TOKEN)\s*\}\}/.test(bootstrap) ||
    /\b(?:GH_TOKEN|GITHUB_TOKEN)\s*:/.test(bootstrap) ||
    /\bgh\s+(?:api|release)\b/.test(bootstrap) ||
    /\bapi\.github\.com\b/.test(bootstrap) ||
    /\breleases\/[0-9]+\b/.test(bootstrap)
  ) {
    failures.push(
      'the Biyan alias bootstrap must remain independent of Draft/GitHub API authority and must not gain signing, updater, router, or R2 authority'
    )
  }
  return failures
}

export function validateCiWorkflow(source) {
  const failures = []
  const normalizedSource = source.replace(/\r\n?/g, '\n')
  const allowedTopLevelKeys = new Set([
    'name',
    'on',
    'concurrency',
    'permissions',
    'jobs',
  ])
  const topLevelLines = normalizedSource
    .split('\n')
    .filter((line) => line && !/^[\t #]/.test(line))
  const canonicalTopLevelKeys = topLevelLines.map(
    (line) => /^([a-z][a-z0-9_-]*):(?:[ \t].*)?$/.exec(line)?.[1] ?? null
  )
  if (
    canonicalTopLevelKeys.some(
      (key) => key === null || !allowedTopLevelKeys.has(key)
    ) ||
    [...allowedTopLevelKeys].some(
      (key) =>
        canonicalTopLevelKeys.filter((candidate) => candidate === key)
          .length !== 1
    )
  ) {
    failures.push(
      'Biyan CI must use the exact canonical top-level key allowlist: name, on, concurrency, permissions, jobs'
    )
  }
  const permissions = topLevelBlock(source, 'permissions')
  const jobsBlock = topLevelBlock(source, 'jobs')
  const active = uncommentedSource(source)
  const topLevelKeyCount = (key) =>
    [
      ...normalizedSource.matchAll(
        new RegExp(
          `^(?:${escapeRegExp(key)}|["']${escapeRegExp(key)}["'])\\s*:`,
          'gm'
        )
      ),
    ].length
  if (topLevelKeyCount('permissions') !== 1) {
    failures.push(
      'Biyan CI must define exactly one top-level permissions block'
    )
  }
  if (topLevelKeyCount('jobs') !== 1) {
    failures.push('Biyan CI must define exactly one top-level jobs block')
  }
  const jobKeyLines =
    jobsBlock
      ?.replace(/\r\n?/g, '\n')
      .split('\n')
      .filter((line) => /^  \S/.test(line) && !/^  #/.test(line)) ?? []
  const canonicalJobKeys = jobKeyLines.map(
    (line) => /^  ([A-Za-z0-9_-]+):\s*(?:#.*)?$/.exec(line)?.[1] ?? null
  )
  if (canonicalJobKeys.some((key) => key === null)) {
    failures.push('Biyan CI jobs must use canonical unquoted job keys')
  }
  if (
    canonicalJobKeys.length !== TRUSTED_CI_JOB_KEY_ALLOWLIST.size ||
    canonicalJobKeys.some((key) => !TRUSTED_CI_JOB_KEY_ALLOWLIST.has(key))
  ) {
    failures.push('Biyan CI jobs must match the reviewed job-key allowlist')
  }
  const jobsLines = jobsBlock?.replace(/\r\n?/g, '\n').split('\n') ?? []
  const noncanonicalJobField = jobsLines.find(
    (line) =>
      /^    \S/.test(line) &&
      !/^    #/.test(line) &&
      !/^    [A-Za-z0-9_-]+:(?:\s.*)?$/.test(line)
  )
  if (noncanonicalJobField) {
    failures.push('Biyan CI jobs must use canonical unquoted field keys')
  }
  for (let index = 0; index < jobsLines.length; index += 1) {
    if (!/^    permissions:/.test(jobsLines[index])) continue
    const block = [jobsLines[index]]
    for (index += 1; index < jobsLines.length; index += 1) {
      if (jobsLines[index].trim() && !/^ {6,}/.test(jobsLines[index])) {
        index -= 1
        break
      }
      block.push(jobsLines[index])
    }
    if (
      normalizedYamlEnvelope(block.join('\n')) !==
      '    permissions:\n      contents: read\n'
    ) {
      failures.push('Biyan CI job permissions must be exactly contents: read')
    }
  }
  for (const inheritedControl of ['env', 'defaults']) {
    if (topLevelKeyCount(inheritedControl) !== 0) {
      failures.push(
        `Biyan CI must not define top-level ${inheritedControl} that can alter trusted job execution`
      )
    }
  }
  if (
    normalizedYamlEnvelope(permissions) !== 'permissions:\n  contents: read\n'
  ) {
    failures.push('Biyan CI top-level permissions must be contents: read only')
  }
  if (/^\s{4,}[A-Za-z0-9_-]+:\s*write\s*$/m.test(active)) {
    failures.push('Biyan CI jobs must not grant write permissions')
  }
  const checkoutSteps = actionStepBlocks(source, 'actions/checkout@v4')
  if (
    checkoutSteps.some(
      (step) => !/^\s*persist-credentials:\s*false\s*$/m.test(step)
    )
  ) {
    failures.push('Biyan CI checkout steps must disable credential persistence')
  }
  const ciScope = jobBlock(source, 'ci-scope')
  const ciScopeDefinitions = [
    ...normalizedSource.matchAll(/^  (?:ci-scope|["']ci-scope["'])\s*:/gm),
  ].length
  if (ciScopeDefinitions !== 1) {
    failures.push('Biyan CI must define exactly one ci-scope job')
  }
  const quickPrCheck = jobBlock(source, 'quick-pr-check')
  const releaseSafety = jobBlock(source, 'release-safety')
  const baseBranchCoverage = jobBlock(source, 'base_branch_cov')
  const baseBranchRustCoverage = jobBlock(source, 'base_branch_rust_cov')
  const macos = jobBlock(source, 'test-on-macos')
  const windowsPush = jobBlock(source, 'test-on-windows')
  const windowsPr = jobBlock(source, 'test-on-windows-pr')
  const linux = jobBlock(source, 'test-on-ubuntu')
  const coverageCheck = jobBlock(source, 'coverage-check')
  const prGate = jobBlock(source, 'pr-ci-gate')

  if (!ciScope) {
    failures.push('Biyan CI is missing the ci-scope job')
  } else {
    const ciScopeJobSha256 = createHash('sha256')
      .update(normalizedYamlEnvelope(ciScope))
      .digest('hex')
    if (!TRUSTED_CI_SCOPE_JOB_ALLOWLIST.has(ciScopeJobSha256)) {
      failures.push(
        `Biyan trusted CI scope job must match the reviewed execution-envelope allowlist (got ${ciScopeJobSha256})`
      )
    }
    const activeCiScope = uncommentedSource(ciScope)
    if (
      /printf[^\n]*\|\s*grep[^\n]*(?:-[A-Za-z]*q[A-Za-z]*|--quiet)/.test(
        ciScope
      )
    ) {
      failures.push(
        'Biyan CI scope detection must not use a short-circuiting printf | grep -q pipeline under pipefail'
      )
    }

    for (const [axis, outputNames] of [
      ['quick', ['quick', 'run_checks']],
      ['test_linux', ['test_linux']],
      ['test_windows', ['test_windows']],
      ['test_macos', ['test_macos']],
      ['full', ['full', 'full_ci']],
      ['docs', ['docs']],
      ['checkpoint', ['checkpoint']],
      ['policy', ['policy']],
      ['updater', ['updater']],
      ['artifact_replay', ['artifact_replay']],
    ]) {
      if (
        !outputNames.some((outputName) =>
          new RegExp(
            `^      ${outputName}:\\s*\\$\\{\\{\\s*steps\\.[A-Za-z0-9_-]+\\.outputs\\.${axis}\\s*\\}\\}\\s*$`,
            'm'
          ).test(ciScope)
        )
      ) {
        failures.push(`Biyan CI scope must expose the ${axis} impact axis`)
      }
    }

    const classifierRunBlocks = runBlocks(activeCiScope).filter((commands) =>
      commands.some(
        (command) =>
          /qualification-impact\.mjs/.test(command) ||
          /^node\s+.*\sclassify(?:\s|\\|$)/.test(command)
      )
    )
    const classifierCommands =
      classifierRunBlocks.length === 1 ? classifierRunBlocks[0] : []
    const classifierCommandSha256 = createHash('sha256')
      .update(classifierCommands.join('\n'))
      .digest('hex')
    if (!TRUSTED_CI_SCOPE_COMMAND_ALLOWLIST.has(classifierCommandSha256)) {
      failures.push(
        'Biyan trusted CI scope active commands must match the reviewed fail-closed allowlist'
      )
    }
    const expectedClassifierAssignment =
      'classifier="$RUNNER_TEMP/qualification-impact.mjs"'
    const expectedClassifierLoad =
      'if ! git show "${policy_sha}:scripts/ci/qualification-impact.mjs" > "$classifier"; then'
    const classifierLoads = classifierCommands.filter(
      (command) =>
        /\bgit show\b/.test(command) &&
        /qualification-impact\.mjs/.test(command)
    )
    if (
      classifierRunBlocks.length !== 1 ||
      classifierLoads.length !== 1 ||
      classifierLoads[0] !== expectedClassifierLoad
    ) {
      failures.push(
        'Biyan CI scope must load the trusted qualification-impact classifier from the base commit with git show'
      )
    }

    const expectedMergeBase =
      'base_sha="$(git merge-base "$policy_sha" "$target_sha" || true)"'
    const mergeBaseAssignments = classifierCommands.filter((command) =>
      /^base_sha="\$\(git merge-base\b/.test(command)
    )
    if (
      mergeBaseAssignments.length !== 1 ||
      mergeBaseAssignments[0] !== expectedMergeBase
    ) {
      failures.push(
        'Biyan trusted CI scope must fail closed instead of aborting when merge-base is unavailable'
      )
    }

    const expectedIdentityGuard = [
      'if [[ ! "$policy_sha" =~ ^[0-9a-f]{40}$ ]] ||',
      '[[ ! "$target_sha" =~ ^[0-9a-f]{40}$ ]] ||',
      '[[ ! "$base_sha" =~ ^[0-9a-f]{40}$ ]] ||',
      '[[ "$policy_sha" =~ ^0{40}$ ]]; then',
      'emit_bootstrap_full',
      'exit 0',
      'fi',
    ]
    const identityGuardStarts = classifierCommands
      .map((command, index) =>
        /^if \[\[ ! "\$policy_sha" =~/.test(command) ? index : -1
      )
      .filter((index) => index >= 0)
    const identityGuardStart = identityGuardStarts[0] ?? -1
    const mergeBaseIndex = classifierCommands.indexOf(expectedMergeBase)
    const identityGuardPredecessor =
      classifierCommands[identityGuardStart - 1] ?? ''
    const classifierTransactionStart =
      identityGuardStart + expectedIdentityGuard.length
    const exactIdentityGuard =
      identityGuardStarts.length === 1 &&
      expectedIdentityGuard.every(
        (command, offset) =>
          classifierCommands[identityGuardStart + offset] === command
      ) &&
      mergeBaseIndex >= 0 &&
      identityGuardStart > mergeBaseIndex &&
      [expectedMergeBase, 'fi'].includes(identityGuardPredecessor) &&
      classifierCommands[classifierTransactionStart] ===
        expectedClassifierAssignment
    if (!exactIdentityGuard) {
      failures.push(
        'Biyan trusted CI scope must route invalid commit identity to bootstrap-full and exit successfully'
      )
    }

    const expectedClassifierTransaction = [
      expectedClassifierAssignment,
      expectedClassifierLoad,
      'emit_bootstrap_full',
      'exit 0',
      'fi',
      'node "$classifier" classify \\',
      '--repo "$GITHUB_WORKSPACE" \\',
      '--base "$base_sha" \\',
      '--target "$target_sha" \\',
      '--format github-output >> "$GITHUB_OUTPUT"',
    ]
    const classifierExecutions = classifierCommands.filter((command) =>
      /^node\s+.*\sclassify(?:\s|\\|$)/.test(command)
    )
    const exactClassifierTransaction =
      classifierExecutions.length === 1 &&
      classifierCommands.length ===
        classifierTransactionStart + expectedClassifierTransaction.length &&
      expectedClassifierTransaction.every(
        (command, offset) =>
          classifierCommands[classifierTransactionStart + offset] === command
      )
    if (!exactClassifierTransaction) {
      failures.push(
        'Biyan CI scope must execute the trusted base classifier with exact base and target inputs'
      )
    }

    const scopeCommands = runBlocks(ciScope).flat()
    const scopeCommandText = scopeCommands.join('\n')
    const explicitFullFallback = [
      'quick',
      'test_macos',
      'test_windows',
      'test_linux',
      'full',
    ].every((flag) =>
      new RegExp(`echo\\s+["']${flag}=true["']`).test(scopeCommandText)
    )
    const loopFullFallback =
      /for\s+flag\s+in[^\n]*\bquick\b[^\n]*\btest_linux\b[^\n]*\btest_windows\b[^\n]*\btest_macos\b[^\n]*\bfull\b[^\n]*;\s*do/.test(
        scopeCommandText
      ) && /echo\s+["']\$\{flag\}=true["']/.test(scopeCommandText)
    if (!explicitFullFallback && !loopFullFallback) {
      failures.push(
        'Biyan CI scope must fail closed to full axes when the base classifier is unavailable or self-modified'
      )
    }

    const scopeValidation = findRunInvocation(
      ciScope,
      /^node\s+-\s+["']?\$CLASSIFICATION_JSON["']?\s+/
    )
    const validationText = scopeValidation?.commands.join('\n') ?? ''
    for (const [axis, variable] of [
      ['docs', 'DOCS'],
      ['checkpoint', 'CHECKPOINT'],
      ['focused', 'FOCUSED'],
      ['quick', 'QUICK'],
      ['policy', 'POLICY'],
      ['updater', 'UPDATER'],
      ['artifact_replay', 'ARTIFACT_REPLAY'],
      ['test_macos', 'TEST_MACOS'],
      ['test_windows', 'TEST_WINDOWS'],
      ['test_linux', 'TEST_LINUX'],
      ['build_macos', 'BUILD_MACOS'],
      ['build_windows', 'BUILD_WINDOWS'],
      ['build_linux', 'BUILD_LINUX'],
      ['full', 'FULL'],
    ]) {
      const mapsOutput = new RegExp(
        `^\\s+${variable}:\\s*\\$\\{\\{\\s*steps\\.scope\\.outputs\\.${axis}\\s*\\}\\}\\s*$`,
        'm'
      ).test(ciScope)
      const validatesBoolean = new RegExp(
        `["']${axis}=\\$${variable}["']`
      ).test(validationText)
      if (!mapsOutput || !validatesBoolean) {
        failures.push(
          `Biyan CI scope must validate ${axis} as a boolean output`
        )
      }
    }
    for (const axis of ['build_macos', 'build_windows', 'build_linux']) {
      if (
        !new RegExp(
          `^      ${axis}:\\s*\\$\\{\\{\\s*steps\\.scope\\.outputs\\.${axis}\\s*\\}\\}\\s*$`,
          'm'
        ).test(ciScope)
      ) {
        failures.push(
          `Biyan CI scope must expose ${axis} to affected native jobs`
        )
      }
    }
    if (
      !scopeValidation ||
      !/^\s+BLOCKED:\s*\$\{\{\s*steps\.scope\.outputs\.blocked\s*\}\}\s*$/m.test(
        ciScope
      ) ||
      !/\[\s*["']?\$BLOCKED["']?\s*!=\s*["']false["']\s*\]/.test(validationText)
    ) {
      failures.push(
        'Biyan CI scope must reject missing or blocked classifier output'
      )
    }
    if (
      !/^\s+PLAN_SHA256:\s*\$\{\{\s*steps\.scope\.outputs\.plan_sha256\s*\}\}\s*$/m.test(
        ciScope
      ) ||
      !/\^\[0-9a-f\]\{64\}\$/.test(validationText)
    ) {
      failures.push('Biyan CI scope must validate the classifier plan SHA-256')
    }
    if (
      !/^\s+CLASSIFICATION:\s*\$\{\{\s*steps\.scope\.outputs\.classification\s*\}\}\s*$/m.test(
        ciScope
      ) ||
      !/^\s+CLASSIFICATION_JSON:\s*\$\{\{\s*steps\.scope\.outputs\.classification_json\s*\}\}\s*$/m.test(
        ciScope
      ) ||
      !/JSON\.parse\(/.test(validationText) ||
      !/plan\.classification\s*!==\s*classification/.test(validationText) ||
      !/plan\.planSha256\s*!==\s*planSha256/.test(validationText)
    ) {
      failures.push(
        'Biyan CI scope must parse and authenticate classification JSON identity'
      )
    }
  }

  if (!releaseSafety) {
    failures.push('Biyan CI is missing the release-safety job')
  } else {
    if (!/^    runs-on:\s*['"]?ubuntu-24\.04['"]?\s*$/m.test(releaseSafety)) {
      failures.push('Biyan CI release-safety must use ubuntu-24.04')
    }
    for (const command of [
      'node scripts/ci/verify-release-policy.mjs',
      'node --test scripts/ci/__tests__/candidate-content-policy.test.mjs',
      'node --test scripts/ci/__tests__/release-policy.test.mjs',
      'node --test scripts/ci/__tests__/verify-release-target.test.mjs',
      'node --test scripts/ci/__tests__/qualification-impact.test.mjs',
      'node --test scripts/ci/__tests__/run-untrusted-qualification-verifier.test.mjs',
      'node --test scripts/ci/__tests__/verify-qualification-artifacts.test.mjs',
      'node --test scripts/ci/__tests__/verify-qualification-recovery.test.mjs',
      'python3 scripts/ci/__tests__/extract-release-candidate-recovery.test.py',
      'node --test scripts/ci/__tests__/verify-release-candidate-recovery.test.mjs',
      'node --test scripts/release-distribution/__tests__/bootstrap-biyan-download-aliases.test.mjs',
      'node --test scripts/release-distribution/__tests__/release-distribution.test.mjs',
    ]) {
      if (
        !hasRunInvocation(
          releaseSafety,
          new RegExp(`^${escapeRegExp(command)}(?:\\s|$)`)
        )
      ) {
        failures.push(`Biyan CI release-safety job does not run: ${command}`)
      }
    }
    const updaterContractStep = workflowStepBlocks(releaseSafety).find((step) =>
      step.includes(
        'name: Test updater candidate, promotion, and routing contracts'
      )
    )
    failures.push(
      ...validateUpdaterContractTestStep(
        updaterContractStep,
        'Biyan CI release-safety job'
      )
    )
    const signerSmoke = workflowStepBlocks(releaseSafety).find((step) =>
      step.includes('name: Exercise locked candidate signer install')
    )
    if (
      !signerSmoke ||
      !hasRunInvocation(signerSmoke, /^set\s+-euo\s+pipefail$/) ||
      !hasRunInvocation(signerSmoke, /^corepack\s+enable$/) ||
      !hasRunInvocation(
        signerSmoke,
        /^corepack\s+prepare\s+yarn@4\.5\.3\s+--activate$/
      ) ||
      !hasRunInvocation(
        signerSmoke,
        /^yarn\s+install\s+--immutable\s+--mode=skip-build$/
      ) ||
      !hasRunInvocation(
        signerSmoke,
        /^yarn\s+tauri\s+signer\s+generate(?:\s|\\|$)/,
        [
          /--ci/,
          /--password\s+preflight-only/,
          /--write-keys\s+"\$signer_probe\/test\.key"/,
        ]
      ) ||
      !hasRunInvocation(signerSmoke, /^yarn\s+tauri\s+signer\s+sign(?:\s|$)/, [
        /"\$signer_probe\/payload\.txt"/,
      ]) ||
      !hasRunInvocation(
        signerSmoke,
        /^test\s+-s\s+"\$signer_probe\/payload\.txt\.sig"$/
      ) ||
      signerSmoke.includes('secrets.') ||
      signerSmoke.includes('--mode=skip-builds') ||
      YAML_CONTINUE_ON_ERROR.test(signerSmoke) ||
      /\|\|\s*true\b/.test(signerSmoke)
    ) {
      failures.push(
        'Biyan CI release-safety must exercise a real temporary signer generate/sign transaction with locked Yarn and no advisory bypass'
      )
    }
    const helperSmoke = workflowStepBlocks(releaseSafety).find((step) =>
      hasRunInvocation(
        step,
        /^scripts\/ci\/run-untrusted-qualification-verifier\.sh(?:\s|$)/
      )
    )
    const helperSmokeCommands = helperSmoke
      ? runBlocks(helperSmoke).flat().join('\n')
      : ''
    if (
      !helperSmoke ||
      !/^\s*(?:-\s*)?shell:\s*bash\s*$/m.test(helperSmoke) ||
      /^    continue-on-error:\s*/m.test(releaseSafety) ||
      YAML_IF.test(releaseSafety) ||
      YAML_CONTINUE_ON_ERROR.test(helperSmoke) ||
      !hasRunInvocation(helperSmoke, /^set\s+-euo\s+pipefail$/) ||
      !/^scripts\/ci\/run-untrusted-qualification-verifier\.sh\s+\\\n--read-root\s+["']?\$probe_root["']?\s+["']?\$verifier["']?\s+["']?\$probe_root\/marker\.txt["']?$/m.test(
        helperSmokeCommands
      )
    ) {
      failures.push(
        'Biyan CI release-safety must exercise the untrusted verifier helper on ubuntu without advisory bypass'
      )
    }
  }

  for (const [jobName, block, flag] of [
    ['quick-pr-check', quickPrCheck, ['quick', 'run_checks']],
    ['base_branch_cov', baseBranchCoverage, ['full', 'full_ci']],
    ['base_branch_rust_cov', baseBranchRustCoverage, ['full', 'full_ci']],
    ['test-on-macos', macos, 'test_macos'],
    ['test-on-windows', windowsPush, 'test_windows'],
    ['test-on-windows-pr', windowsPr, 'test_windows'],
    ['test-on-ubuntu', linux, 'test_linux'],
    ['coverage-check', coverageCheck, ['full', 'full_ci']],
  ]) {
    if (!block) {
      failures.push(`Biyan CI is missing the ${jobName} job`)
    } else if (!jobUsesScopeFlag(block, flag)) {
      failures.push(`${jobName} must be gated by the ${flag} impact axis`)
    }
  }

  if (windowsPr) {
    const windowsPrSteps = workflowStepBlocks(windowsPr)
    const buildStep = windowsPrSteps.find((step) =>
      /^\s*-\s+name:\s*Build focused unsigned Windows candidate\s*$/m.test(step)
    )
    const verifyStep = windowsPrSteps.find((step) =>
      /^\s*-\s+name:\s*Verify focused unsigned Windows candidate\s*$/m.test(
        step
      )
    )
    const buildCondition =
      /^\s*if:\s*needs\.ci-scope\.outputs\.build_windows\s*==\s*'true'\s*$/m
    const unsignedSignerReference =
      /\$\{\{\s*secrets\.|\b(?:BIYAN_SIGNING_KEY|TAURI_SIGNING_PRIVATE_KEY(?:_PATH|_PASSWORD)?)\b/
    const buildSchemaSequence =
      /^\s*\$releaseMetadata\s*=\s*Get-Content\s+biyan-release\.json\s+-Raw\s*\|\s*\n\s*ConvertFrom-Json\s*\n\s*\$env:BIYAN_DATA_SCHEMA\s*=\s*\[string\]\$releaseMetadata\.dataSchema\s*\n\s*\$version\s*=\s*\(\s*\n\s*Get-Content\s+src-tauri\/tauri\.conf\.json\s+-Raw\s*\|\s*\n\s*ConvertFrom-Json\s*\n\s*\)\.version\s*\n\s*&\s+node\s+scripts\/release-version\.mjs\s+stamp\s+\$version\s+--windows\s*\n\s*if\s*\(\$LASTEXITCODE\s+-ne\s+0\)\s*\{\s*\n\s*throw\s+'Windows release stamp failed'\s*\n\s*\}\s*\n\s*\$tauriConfigPath\s*=\s*'src-tauri\/tauri\.conf\.json'\s*\n\s*\$tauriConfig\s*=\s*Get-Content\s+\$tauriConfigPath\s+-Raw\s*\|\s*\n\s*ConvertFrom-Json\s*\n\s*\$tauriConfig\.bundle\.createUpdaterArtifacts\s*=\s*\$false\s*\n\s*\$tauriConfig\s*\|\s*ConvertTo-Json\s+-Depth\s+100\s*\|\s*\n\s*Set-Content\s+\$tauriConfigPath\s+-Encoding\s+utf8NoBOM\s*\n\s*\$unsignedConfig\s*=\s*Get-Content\s+\$tauriConfigPath\s+-Raw\s*\|\s*\n\s*ConvertFrom-Json\s*\n\s*if\s*\(\$unsignedConfig\.bundle\.createUpdaterArtifacts\s+-ne\s+\$false\)\s*\{\s*\n\s*throw\s+'Focused PR candidate must disable updater artifacts'\s*\n\s*\}\s*\n\s*make build\s*$/m
    if (
      !/^\s*timeout-minutes:\s*90\s*$/m.test(windowsPr) ||
      !buildStep ||
      !buildCondition.test(buildStep) ||
      unsignedSignerReference.test(uncommentedSource(buildStep)) ||
      /^\s*continue-on-error:\s*/m.test(buildStep) ||
      !hasRunInvocation(buildStep, /^make build$/) ||
      !buildSchemaSequence.test(uncommentedSource(buildStep)) ||
      !verifyStep ||
      !buildCondition.test(verifyStep) ||
      /^\s*continue-on-error:\s*/m.test(verifyStep) ||
      !hasRunInvocation(
        verifyStep,
        /^&\s+\.\/scripts\/ci\/verify-windows-candidate\.ps1(?:\s|$)/,
        [
          /-Exe\s+\$exe/,
          /-Msi\s+\$msi/,
          /-Version\s+\$version/,
          /-GeneratedNsis\s+'src-tauri\/target\/release\/nsis\/x64\/installer\.nsi'/,
        ]
      ) ||
      !hasRunInvocation(
        verifyStep,
        /^node\s+\.\/scripts\/ci\/candidate-path-policy\.mjs(?:\s|$)/,
        [/--root\s+\$bundle/]
      )
    ) {
      failures.push(
        'test-on-windows-pr must run the focused unsigned candidate build and verifier when build_windows is true'
      )
    }
  }

  if (
    !prGate ||
    !jobNeeds(prGate, 'ci-scope') ||
    !jobNeeds(prGate, 'release-safety') ||
    !jobNeeds(prGate, 'quick-pr-check') ||
    !jobNeeds(prGate, 'test-on-macos') ||
    !jobNeeds(prGate, 'test-on-windows-pr') ||
    !jobNeeds(prGate, 'test-on-ubuntu') ||
    !jobNeeds(prGate, 'coverage-check')
  ) {
    failures.push(
      'PR CI Gate must receive scope, safety, quick, platform, and coverage results'
    )
  }

  if (!coverageCheck) {
    failures.push('Biyan CI is missing the coverage-check job')
  } else if (/^    continue-on-error:\s*true\s*$/m.test(coverageCheck)) {
    failures.push('coverage-check must not be advisory at the job level')
  }

  if (prGate) {
    for (const [flags, job, result] of [
      [['quick', 'run_checks'], 'Fast PR check', 'FAST_RESULT'],
      [['test_macos'], 'test-on-macos', 'MACOS_RESULT'],
      [['test_linux'], 'test-on-ubuntu', 'UBUNTU_RESULT'],
      [['test_windows'], 'test-on-windows-pr', 'WINDOWS_PR_RESULT'],
      [['full', 'full_ci'], 'coverage-check', 'COVERAGE_RESULT'],
    ]) {
      const consumesFlag = flags.some((flag) =>
        prGate.includes(`needs.ci-scope.outputs.${flag}`)
      )
      const quickNoOpGate =
        flags.includes('quick') &&
        quickPrCheck &&
        quickPrCheck.includes('needs.ci-scope.outputs.run_checks')
      if (!consumesFlag && !quickNoOpGate) {
        failures.push(`PR CI Gate must consume the ${flags[0]} impact axis`)
      }
      if (
        !hasRunInvocation(
          prGate,
          new RegExp(
            `^require_success\\s+["']${escapeRegExp(job)}["']\\s+["']\\$${escapeRegExp(result)}["'](?:\\s|$)`
          )
        )
      ) {
        failures.push(`PR CI Gate must enforce ${job} when ${flags[0]}=true`)
      }
    }
  }

  return failures
}

export function validateCiControlOwnership(source) {
  const failures = []
  const ownersByPattern = new Map()
  for (const rawLine of source.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.replace(/\s+#.*$/, '').trim()
    if (!line || line.startsWith('#')) continue
    const [pattern, ...owners] = line.split(/\s+/)
    ownersByPattern.set(pattern, owners)
  }
  for (const pattern of [
    '/.github/',
    '/scripts/ci/',
    '/scripts/release-distribution/',
    '/scripts/updater/',
    '/scripts/macos-architecture-policy.mjs',
    '/scripts/sign-macos-binaries.mjs',
    '/scripts/verify-macos-candidate.mjs',
    '/.yarn/',
    '/.yarnrc.yml',
    '/Makefile',
    '/package.json',
    '/yarn.lock',
  ]) {
    const owners = ownersByPattern.get(pattern) ?? []
    for (const owner of ['@realerikk0', '@twokar']) {
      if (!owners.includes(owner)) {
        failures.push(
          `CI control path ${pattern} must require review from ${owner}`
        )
      }
    }
  }
  return failures
}

export function validateWindowsCandidateVerifier(source) {
  const active = uncommentedSource(source)
  const failures = []
  for (const [pattern, message] of [
    [/ReadUInt16\(\)[\s\S]*0x5A4D/, 'must validate the DOS PE signature'],
    [
      /ReadUInt32\(\)[\s\S]*0x00004550/,
      'must validate the PE header signature',
    ],
    [/0x8664/, 'must require an AMD64 application payload'],
    [/Get-Command\s+7z/, 'must extract and inspect the NSIS payload'],
    [/["']Biyan\.exe["']/, 'must locate the packaged Biyan executable'],
    [/FileVersionInfo/, 'must verify packaged executable version metadata'],
    [/OpenDatabase/, 'must open the MSI database'],
    [/["']ProductName["']/, 'must verify MSI ProductName'],
    [/["']ProductVersion["']/, 'must verify MSI ProductVersion'],
    [/SummaryInformation\(0\)/, 'must read the MSI summary information'],
    [/Property\(7\)/, 'must read the MSI Template Summary'],
    [/x64\|Intel64/, 'must require an x64 MSI Template Summary'],
    [/\[string\]\$GeneratedNsis/, 'must accept the rendered NSIS script'],
    [
      /\$PSBoundParameters\.ContainsKey\(['"]GeneratedNsis['"]\)[\s\S]*Test-GeneratedNsisContract/,
      'must verify the rendered NSIS script when supplied',
    ],
    [
      /Function DetectOwnedBiyanInstallLocation[\s\S]*Function RejectUnownedRetiredBiyanResources[\s\S]*Function RemoveRetiredBiyanInstallResources[\s\S]*Function VerifyInstalledBiyanResources/,
      'must require every reviewed NSIS cleanup function',
    ],
    [
      /Call DetectOwnedBiyanInstallLocation[\s\S]*Call RemoveRetiredBiyanInstallResources[\s\S]*Call RejectUnownedRetiredBiyanResources[\s\S]*Call VerifyInstalledBiyanResources/,
      'must require the reviewed NSIS Install section order',
    ],
    [
      /\$\{GetOptions\}\s+\$CMDLINE\s+["']\/R["']\s+\$R0/,
      'must require explicit restart authorization in the rendered NSIS script',
    ],
  ]) {
    if (!pattern.test(active)) {
      failures.push(`Windows candidate verifier ${message}`)
    }
  }

  const msiAdminBlock =
    /\$msiExtractRoot\s*=[\s\S]*?(?=^\$windowsInstaller\s*=)/m.exec(
      active
    )?.[0] ?? ''
  const msiAdminExecution =
    /^\s*\$msiExec\s*=\s*\(Get-Command\s+msiexec\.exe\s+-ErrorAction\s+Stop\)\.Source\s*\n\s*\$msiArguments\s*=\s*@\(\s*\n\s*["']\/a["'],\s*\n\s*["']?`["']\$msiPath`["']{2},\s*\n\s*["']\/qn["'],\s*\n\s*["']\/norestart["'],\s*\n\s*["']TARGETDIR=`["']\$msiExtractRoot`["']["'],\s*\n\s*["']\/L\*V["'],\s*\n\s*["']?`["']\$msiLogPath`["']{2}\s*\n\s*\)\s*\n\s*\$msiProcess\s*=\s*Start-Process\s+`\s*\n\s*-FilePath\s+\$msiExec\s+`\s*\n\s*-ArgumentList\s+\$msiArguments\s+`\s*\n\s*-Wait\s+`\s*\n\s*-PassThru\s*\n\s*\$msiExitCode\s*=\s*\$msiProcess\.ExitCode\s*\n\s*\$msiProcess\.Dispose\(\)\s*\n\s*if\s*\(\$msiExitCode\s+-ne\s+0\)\s*\{/m
  if (
    !msiAdminExecution.test(msiAdminBlock) ||
    (msiAdminBlock.match(/\$msiExec\s*=/g)?.length ?? 0) !== 1 ||
    (msiAdminBlock.match(/\$msiArguments\s*=/g)?.length ?? 0) !== 1 ||
    (msiAdminBlock.match(/\bStart-Process\b/g)?.length ?? 0) !== 1 ||
    (msiAdminBlock.match(/\$msiProcess\s*=/g)?.length ?? 0) !== 1 ||
    (msiAdminBlock.match(/\$msiExitCode\s*=/g)?.length ?? 0) !== 1
  ) {
    failures.push(
      'Windows candidate verifier must synchronously execute and capture Windows Installer administrative extraction in order'
    )
  }
  if (
    !/\$msiExitCode\s*=\s*\$msiProcess\.ExitCode[\s\S]*?if\s*\(\$msiExitCode\s+-ne\s+0\)\s*\{[\s\S]*?throw\s+["'][^"']*exit\s+\$msiExitCode[^"']*["']/.test(
      msiAdminBlock
    )
  ) {
    failures.push(
      'Windows candidate verifier must fail closed when Windows Installer cannot create the administrative image'
    )
  }
  if (
    /(^|\n)\s*&\s+\$msiExec\b/.test(msiAdminBlock) ||
    /\$LASTEXITCODE/.test(msiAdminBlock)
  ) {
    failures.push(
      'Windows candidate verifier must not background msiexec or reuse LASTEXITCODE'
    )
  }
  if (
    !/catch\s*\{[\s\S]*?Write-MsiLogTail\s+-Path\s+\$msiLogPath[\s\S]*?throw[\s\S]*?\}\s*finally\s*\{/.test(
      msiAdminBlock
    )
  ) {
    failures.push(
      'Windows candidate verifier must emit the MSI log before cleanup on every failure'
    )
  }
  if (
    !/Test-ExtractedBiyanApp[\s\S]*?-Root\s+\$msiExtractRoot/.test(
      msiAdminBlock
    ) ||
    !/Invoke-ExtractedCandidatePolicies\s+-Root\s+\$msiExtractRoot\s+-Label\s+["']MSI["']/.test(
      msiAdminBlock
    )
  ) {
    failures.push(
      'Windows candidate verifier must inspect the MSI administrative image'
    )
  }
  if (
    !/finally\s*\{[\s\S]*?Remove-Item[\s\S]*?-LiteralPath\s+\$msiExtractRoot[\s\S]*?-Recurse[\s\S]*?Remove-Item[\s\S]*?-LiteralPath\s+\$msiLogPath[\s\S]*?-Force/.test(
      msiAdminBlock
    )
  ) {
    failures.push(
      'Windows candidate verifier must clean the MSI administrative image and log'
    )
  }
  if (/\$sevenZip[\s\S]*?\$msiPath/.test(msiAdminBlock)) {
    failures.push(
      'Windows candidate verifier must not treat the MSI database as a flat 7-Zip payload'
    )
  }
  return failures
}

export function validateMacOSCandidateVerifier(source) {
  const active = uncommentedSource(source)
  const failures = []
  for (const [pattern, message] of [
    [
      /runCommand\(["']hdiutil["'],\s*\[["']verify["']/,
      'must verify the DMG container',
    ],
    [
      /["']attach["'][\s\S]*["']-readonly["'][\s\S]*["']-mountpoint["']/,
      'must mount the DMG read-only',
    ],
    [/bundleSnapshot\(appPath\)/, 'must snapshot the accepted app'],
    [/bundleSnapshot\(mountedApp\)/, 'must snapshot the DMG app'],
    [/sha256File\(/, 'must hash bundle files'],
    [
      /sourceSnapshot[\s\S]*mountedSnapshot/,
      'must compare source and DMG app snapshots',
    ],
    [/runCommand\(["']hdiutil["'],\s*\[["']detach["']/, 'must detach the DMG'],
  ]) {
    if (!pattern.test(active)) {
      failures.push(`macOS candidate verifier ${message}`)
    }
  }
  return failures
}

export function validateQualificationWorkflow(source) {
  const failures = []
  const trigger = topLevelBlock(source, 'on')
  const permissions = topLevelBlock(source, 'permissions')
  const active = uncommentedSource(source)

  if (!trigger) {
    failures.push('exact-SHA qualification must declare workflow_dispatch')
  } else {
    const events = [...trigger.matchAll(/^  ([A-Za-z0-9_-]+):[^\n]*$/gm)].map(
      (match) => match[1]
    )
    if (events.length !== 1 || events[0] !== 'workflow_dispatch') {
      failures.push('exact-SHA qualification must be workflow_dispatch-only')
    }
    for (const input of ['target_sha', 'base_sha']) {
      if (!new RegExp(`^      ${input}:\\s*$`, 'm').test(trigger)) {
        failures.push(`exact-SHA qualification is missing ${input} input`)
      }
    }
    const modeInput = /^      mode:\s*$/m.test(trigger)
    const modeBootstrap = /^          - bootstrap-full\s*$/m.test(trigger)
    const modeRecovery = /^          - aggregate-recovery\s*$/m.test(trigger)
    if (!modeInput || !modeBootstrap) {
      failures.push(
        'exact-SHA qualification must expose an explicit bootstrap-full mode'
      )
    }
    if (
      !modeInput ||
      !modeRecovery ||
      !/^      recovery_run_id:\s*$/m.test(trigger)
    ) {
      failures.push(
        'exact-SHA qualification must expose aggregate-recovery with a recovery_run_id input'
      )
    }
  }

  if (
    !permissions ||
    !/^  contents:\s*read\s*$/m.test(permissions) ||
    !/^  actions:\s*read\s*$/m.test(permissions) ||
    /^  (?!contents:|actions:)[A-Za-z0-9_-]+:/m.test(permissions)
  ) {
    failures.push(
      'exact-SHA qualification permissions must be limited to contents: read and actions: read'
    )
  }
  if (
    /^\s*permissions:\s*write-all\s*$/m.test(active) ||
    /^\s+\w[\w-]*:\s*write\s*$/m.test(active)
  ) {
    failures.push('exact-SHA qualification must not have write permissions')
  }

  const preflight = jobBlock(source, 'preflight')
  const docsBuild = jobBlock(source, 'docs-build')
  const recoveryAuth = jobBlock(source, 'recovery-auth')
  const artifactReplay = jobBlock(source, 'artifact-replay')
  const linux = jobBlock(source, 'native-linux')
  const windows = jobBlock(source, 'native-windows')
  const macos = jobBlock(source, 'native-macos')
  const aggregate = jobBlock(source, 'aggregate-artifacts')
  const gate = jobBlock(source, 'qualification-gate')

  if (!preflight) {
    failures.push('exact-SHA qualification is missing preflight')
  } else {
    if (!/^    runs-on:\s*['"]?ubuntu-24\.04['"]?\s*$/m.test(preflight)) {
      failures.push('qualification preflight must use ubuntu-24.04')
    }
    const activePreflight = uncommentedSource(preflight)
    const jobLevelMainGuard =
      /^    if:\s*.*github\.ref\s*==\s*['"]refs\/heads\/mita-main['"]/m.test(
        activePreflight
      )
    const executableMainGuard =
      /DISPATCH_REF:\s*\$\{\{\s*github\.ref\s*\}\}/.test(activePreflight) &&
      hasRunInvocation(
        preflight,
        /^if\s+\[\s+["']?\$DISPATCH_REF["']?\s+!=\s+["']refs\/heads\/mita-main["']\s+\];\s*then$/
      ) &&
      /rev-parse\s+refs\/remotes\/origin\/mita-main/.test(activePreflight) &&
      /\$WORKFLOW_SHA["']?\s+!=\s+["']?\$LIVE_MAIN/.test(activePreflight)
    if (!jobLevelMainGuard && !executableMainGuard) {
      failures.push(
        'qualification preflight must refuse dispatches outside protected mita-main'
      )
    }
    for (const identity of [
      /^\s*ref:\s*\$\{\{\s*github\.sha\s*\}\}\s*$/m,
      /^\s*path:\s*harness\s*$/m,
      /^\s*path:\s*target\s*$/m,
    ]) {
      if (!identity.test(uncommentedSource(preflight))) {
        failures.push(
          'qualification preflight must keep a trusted harness checkout and a separate exact target checkout'
        )
        break
      }
    }
    if (
      !/^\s*ref:\s*\$\{\{\s*(?:inputs\.target_sha|steps\.[A-Za-z0-9_-]+\.outputs\.target_sha)\s*\}\}\s*$/m.test(
        activePreflight
      ) ||
      !hasRunInvocation(
        preflight,
        /^test\s+["']?\$\(git\s+-C\s+target\s+rev-parse\s+HEAD\)["']?\s*=\s*["']?\$(?:TARGET|TARGET_SHA)["']?$/
      )
    ) {
      failures.push(
        'qualification preflight must checkout and verify the exact target SHA separately'
      )
    }
    if (!/\^\[0-9(?:a-f|A-Fa-f)\]\{40\}\$/.test(preflight)) {
      failures.push('qualification preflight must require exact 40-hex SHAs')
    }
    if (
      !hasRunInvocation(
        preflight,
        /^(?:if\s+!\s+)?git\s+(?:-C\s+\S+\s+)?merge-base\s+--is-ancestor\b/
      )
    ) {
      failures.push(
        'qualification preflight must prove base_sha is an ancestor of target_sha'
      )
    }
    const classifierInvocation = findRunInvocation(
      preflight,
      /^node\s+harness\/scripts\/ci\/qualification-impact\.mjs(?:\s+classify\b|\s+\\?$)/
    )
    const classifierCommands = classifierInvocation?.commands ?? []
    const classifierText = classifierCommands.join('\n')
    const forceUpgradeIsInvoked =
      classifierInvocation &&
      (/(?:--force-full|\$(?:bootstrap_full|force_full))/.test(
        classifierInvocation.command
      ) ||
        classifierCommands.some((command) =>
          /^["']?\$\{(?:args|classifier_args)\[@\]\}["']?\s*\\?$/.test(command)
        ))
    const forceUpgradeBlock =
      /if\s+\[[\s\S]*?\];\s*then\n[\s\S]*?--force-full[\s\S]*?\nfi/.exec(
        classifierText
      )?.[0] ?? ''
    const forceUpgradeIsConditional =
      (classifierText.match(/--force-full/g) ?? []).length === 1 &&
      /bootstrap_full|bootstrap-full/.test(forceUpgradeBlock) &&
      /aggregate-recovery/.test(forceUpgradeBlock)
    if (
      !classifierInvocation ||
      ![
        /\bclassify\b/,
        /--repo\s+harness/,
        /--base\s+[^\n]+/,
        /--target\s+[^\n]+/,
        /--format\s+github-output/,
        /(?:bootstrap_full|bootstrap-full)/,
        /--force-full/,
      ].every((pattern) => pattern.test(classifierText)) ||
      !forceUpgradeIsInvoked ||
      !forceUpgradeIsConditional
    ) {
      failures.push(
        'qualification preflight must run the trusted classifier with exact identity and bootstrap-full as an upgrade only'
      )
    }

    const trustedContractTests = findRunInvocation(
      preflight,
      /^node\s+--test(?:\s|$)/
    )
    const trustedContractText = trustedContractTests?.commands.join('\n') ?? ''
    const explicitlyTrustedPaths = /harness\/scripts\/ci\/__tests__/.test(
      trustedContractText
    )
    const trustedWorkingDirectory =
      /^\s*(?:-\s*)?working-directory:\s*harness\s*$/m.test(activePreflight)
    if (
      !trustedContractTests ||
      ![
        /(?:harness\/)?scripts\/ci\/__tests__\/qualification-impact\.test\.mjs/,
        /(?:harness\/)?scripts\/ci\/__tests__\/release-policy\.test\.mjs/,
        /(?:harness\/)?scripts\/ci\/__tests__\/verify-qualification-artifacts\.test\.mjs/,
        /(?:harness\/)?scripts\/ci\/__tests__\/verify-qualification-recovery\.test\.mjs/,
      ].every((pattern) => pattern.test(trustedContractText)) ||
      (!explicitlyTrustedPaths && !trustedWorkingDirectory)
    ) {
      failures.push(
        'qualification focused preflight must test trusted classifier, release policy, artifact verifier, and recovery verifier contracts'
      )
    }
    const sandboxProbe = runBlocks(preflight).find((commands) =>
      commands.some((command) =>
        /^harness\/scripts\/ci\/run-untrusted-qualification-verifier\.sh(?:\s|$)/.test(
          command
        )
      )
    )
    const sandboxProbeText = sandboxProbe?.join('\n') ?? ''
    const sandboxHelperCalls =
      sandboxProbe?.filter((command) =>
        /^harness\/scripts\/ci\/run-untrusted-qualification-verifier\.sh(?:\s|$)/.test(
          command
        )
      ).length ?? 0
    if (
      sandboxHelperCalls !== 2 ||
      !/--read-root\s+["']?\$probe_root["']?\s+["']?\$verifier["']?/.test(
        sandboxProbeText
      ) ||
      !/verify-platforms\s+--root\s+["']?\$probe_root["']?/.test(
        sandboxProbeText
      )
    ) {
      failures.push(
        'qualification preflight must probe both exact-target verifier modes through the protected sandbox helper'
      )
    }
    const releasePolicyStep = workflowStepBlocks(activePreflight).find(
      (step) =>
        /^\s*(?:-\s*)?name:\s*Run release policy contracts\s*$/m.test(step)
    )
    if (
      !releasePolicyStep ||
      !/^\s*working-directory:\s*harness\s*$/m.test(releasePolicyStep) ||
      !/^\s*if:\s*steps\.classification\.outputs\.policy\s*==\s*['"]true['"]\s*$/m.test(
        releasePolicyStep
      ) ||
      !releasePolicyStep.includes(
        'VERSION: ${{ steps.metadata.outputs.version }}'
      ) ||
      !releasePolicyStep.includes(
        'TARGET_SHA: ${{ steps.source.outputs.target_sha }}'
      ) ||
      !releasePolicyStep.includes(
        'WORKFLOW_SHA: ${{ steps.source.outputs.workflow_sha }}'
      ) ||
      !hasRunInvocation(
        releasePolicyStep,
        /^node\s+scripts\/ci\/verify-release-target\.mjs(?:\s|\\|$)/,
        [
          /--harness-root\s+\.\s*\\/,
          /--release-tag\s+"v\$VERSION"\s*\\/,
          /--target-root\s+\.\.\/target\s*\\/,
          /--source-commit\s+"\$TARGET_SHA"\s*\\/,
          /--trusted-main\s+"\$WORKFLOW_SHA"(?:\s|$)/,
        ]
      ) ||
      !hasRunInvocation(releasePolicyStep, /^node\s+--test(?:\s|\\|$)/, [
        /scripts\/ci\/__tests__\/release-policy\.test\.mjs(?:\s|\\|$)/,
        /scripts\/ci\/__tests__\/verify-release-target\.test\.mjs(?:\s|\\|$)/,
      ])
    ) {
      failures.push(
        'qualification release policy contracts must compose the exact target with the protected harness'
      )
    }
    const updaterContractStep = workflowStepBlocks(activePreflight).find(
      (step) =>
        /^\s*(?:-\s*)?if:\s*steps\.classification\.outputs\.updater\s*==\s*['"]true['"]\s*$/m.test(
          step
        )
    )
    failures.push(
      ...validateUpdaterContractTestStep(
        updaterContractStep,
        'qualification focused preflight'
      )
    )
    if (
      ![
        /scripts\/release-distribution\/__tests__\/bootstrap-biyan-download-aliases\.test\.mjs/,
        /scripts\/release-distribution\/__tests__\/release-distribution\.test\.mjs/,
      ].every((pattern) => pattern.test(activePreflight)) ||
      !hasRunInvocation(
        preflight,
        /^node\s+--test\s+["']?\$test_file["']?(?:\s|$)/
      )
    ) {
      failures.push(
        'qualification focused preflight must run release-distribution contracts when present'
      )
    }
  }

  for (const [jobName, block] of [
    ['docs-build', docsBuild],
    ['recovery-auth', recoveryAuth],
    ['artifact-replay', artifactReplay],
    ['aggregate-artifacts', aggregate],
    ['qualification-gate', gate],
  ]) {
    if (!block) failures.push(`exact-SHA qualification is missing ${jobName}`)
    else if (!/^    runs-on:\s*['"]?ubuntu-24\.04['"]?\s*$/m.test(block)) {
      failures.push(`${jobName} must use ubuntu-24.04`)
    }
  }

  if (recoveryAuth) {
    const activeRecoveryAuth = uncommentedSource(recoveryAuth)
    if (
      !jobNeeds(recoveryAuth, 'preflight') ||
      !/^    if:\s*needs\.preflight\.outputs\.mode\s*==\s*['"]aggregate-recovery['"]\s*$/m.test(
        activeRecoveryAuth
      )
    ) {
      failures.push(
        'recovery-auth must run only for aggregate-recovery after preflight'
      )
    }
    const protectedCheckout = actionStepBlocks(
      recoveryAuth,
      'actions/checkout@v4'
    ).some(
      (step) =>
        /^\s*ref:\s*\$\{\{\s*needs\.preflight\.outputs\.workflow_sha\s*\}\}\s*$/m.test(
          step
        ) &&
        /^\s*path:\s*harness\s*$/m.test(step) &&
        /^\s*fetch-depth:\s*0\s*$/m.test(step)
    )
    if (!protectedCheckout) {
      failures.push(
        'recovery-auth must checkout the protected recovery verifier with full history'
      )
    }
    const metadataStep = actionStepBlocks(
      recoveryAuth,
      'actions/github-script@v7'
    )[0]
    const metadataSource = metadataStep ? uncommentedSource(metadataStep) : ''
    const sameRepositoryOwnerCount =
      metadataSource.match(/\bowner:\s*context\.repo\.owner\b/g)?.length ?? 0
    const sameRepositoryRepoCount =
      metadataSource.match(/\brepo:\s*context\.repo\.repo\b/g)?.length ?? 0
    const sourceRunIdCount =
      metadataSource.match(/\brun_id:\s*runId\b/g)?.length ?? 0
    if (
      !metadataStep ||
      !/github-token:\s*\$\{\{\s*github\.token\s*\}\}/.test(metadataSource) ||
      !/github\.rest\.actions\.getWorkflowRun\s*\(/.test(metadataSource) ||
      !/github\.rest\.actions\.listJobsForWorkflowRun\b/.test(metadataSource) ||
      !/github\.rest\.actions\.listWorkflowRunArtifacts\b/.test(
        metadataSource
      ) ||
      sameRepositoryOwnerCount !== 3 ||
      sameRepositoryRepoCount !== 3 ||
      sourceRunIdCount !== 3
    ) {
      failures.push(
        'recovery-auth must fetch run, job, and artifact metadata explicitly from the current repository'
      )
    }
    if (
      !hasRunInvocation(
        recoveryAuth,
        /^node\s+harness\/scripts\/ci\/verify-qualification-recovery\.mjs(?:\s|$)/,
        [
          /--run\s+recovery-metadata\/run\.json/,
          /--jobs\s+recovery-metadata\/jobs\.json/,
          /--artifacts\s+recovery-metadata\/artifacts\.json/,
          /--source-run-id\s+["']?\$RECOVERY_RUN_ID["']?/,
          /--repository\s+["']?\$GITHUB_REPOSITORY["']?/,
          /--target-sha\s+["']?\$TARGET_SHA["']?/,
          /--base-sha\s+["']?\$BASE_SHA["']?/,
          /--output\s+recovery-metadata\/recovery-summary\.json/,
          /--github-output\s+["']?\$GITHUB_OUTPUT["']?/,
        ]
      )
    ) {
      failures.push(
        'recovery-auth must run the protected recovery validator over source run, jobs, and artifacts'
      )
    }
    if (
      !/\.sourceHeadSha[\s\S]*\^\[0-9a-f\]\{40\}\$/.test(activeRecoveryAuth) ||
      !hasRunInvocation(
        recoveryAuth,
        /^git\s+-C\s+harness\s+cat-file\s+-e\s+["']?\$\{source_head_sha\}\^\{commit\}["']?$/
      ) ||
      !hasRunInvocation(
        recoveryAuth,
        /^git\s+-C\s+harness\s+merge-base\s+--is-ancestor\b/,
        [
          /["']?\$source_head_sha["']?/,
          /\$\{\{\s*needs\.preflight\.outputs\.workflow_sha\s*\}\}/,
        ]
      )
    ) {
      failures.push(
        'recovery-auth must prove the authenticated source head is an ancestor of the protected workflow SHA'
      )
    }
  }

  if (
    docsBuild &&
    !/needs\.preflight\.outputs\.mode\s*!=\s*['"]aggregate-recovery['"]/.test(
      uncommentedSource(docsBuild)
    )
  ) {
    failures.push('docs-build must be skipped during aggregate-recovery')
  }

  for (const [jobName, block, runner, flag] of [
    ['native-linux', linux, 'ubuntu-24.04', 'test_linux'],
    ['native-windows', windows, 'windows-2022', 'test_windows'],
    ['native-macos', macos, 'macos-15-intel', 'test_macos'],
  ]) {
    if (!block) {
      failures.push(`exact-SHA qualification is missing ${jobName}`)
      continue
    }
    if (
      !new RegExp(
        `^    runs-on:\\s*['\"]?${escapeRegExp(runner)}['\"]?\\s*$`,
        'm'
      ).test(block)
    ) {
      failures.push(`${jobName} must use ${runner}`)
    }
    if (!jobNeeds(block, 'preflight') || !jobNeeds(block, 'artifact-replay')) {
      failures.push(
        `${jobName} must wait for focused preflight and artifact replay`
      )
    }
    const buildFlag = flag.replace('test_', 'build_')
    if (
      !new RegExp(`needs\\.preflight\\.outputs\\.${flag}`).test(block) ||
      !new RegExp(`needs\\.preflight\\.outputs\\.${buildFlag}`).test(block)
    ) {
      failures.push(
        `${jobName} must use the ${flag} and ${buildFlag} qualification axes`
      )
    }
    if (
      !/needs\.preflight\.outputs\.mode\s*!=\s*['"]aggregate-recovery['"]/.test(
        uncommentedSource(block)
      )
    ) {
      failures.push(`${jobName} must be skipped during aggregate-recovery`)
    }
  }

  for (const [jobName, block] of [
    ['native-linux', linux],
    ['native-windows', windows],
    ['native-macos', macos],
  ]) {
    const protectedCheckout = actionStepBlocks(
      block ?? '',
      'actions/checkout@v4'
    ).some(
      (step) =>
        /^\s*ref:\s*\$\{\{\s*needs\.preflight\.outputs\.workflow_sha\s*\}\}\s*$/m.test(
          step
        ) && /^\s*path:\s*harness\s*$/m.test(step)
    )
    if (!protectedCheckout) {
      failures.push(
        `${jobName} must checkout the protected qualification harness`
      )
    }
  }
  if (linux) {
    const activeLinux = uncommentedSource(linux)
    const linuxSteps = workflowStepBlocks(activeLinux)
    const freeDiskAction = linuxSteps.find(
      (step) =>
        /uses:\s*jlumbroso\/free-disk-space@54081f138730dfa15788a46383842cd2f914a1be/.test(
          step
        ) &&
        /^\s*with:\s*$/m.test(step) &&
        !/^\s*(?:-\s*)?if:\s*/m.test(step) &&
        !/^\s*(?:-\s*)?continue-on-error:\s*/m.test(step) &&
        [
          /tool-cache:\s*false/,
          /android:\s*true/,
          /dotnet:\s*true/,
          /haskell:\s*true/,
          /large-packages:\s*true/,
          /docker-images:\s*true/,
          /swap-storage:\s*true/,
        ].every((pattern) => pattern.test(step))
    )
    if (!freeDiskAction) {
      failures.push(
        'native-linux must reclaim runner image space with the pinned protected action'
      )
    }
    const diskBudgetStep = linuxSteps.find((step) =>
      /available_kib=["']\$\(df -Pk \/ \| awk ['"]NR == 2 \{ print \$4 \}['"]\)["']/.test(
        step
      )
    )
    const diskBudgetCommands = diskBudgetStep
      ? runBlocks(diskBudgetStep)[0]
      : null
    const diskBudget = diskBudgetCommands?.join('\n') ?? ''
    const validatesMeasurement =
      /if ! \[\[ "\$available_kib" =~ \^\[0-9\]\+\$ \]\]; then\n(?:(?!fi(?:\n|$))[^\n]*\n)*?exit 1\nfi/.test(
        diskBudget
      )
    const rejectsLowDisk =
      /minimum_kib=\$\(\(40 \* 1024 \* 1024\)\)\nif \[ "\$available_kib" -lt "\$minimum_kib" \]; then\n(?:(?!fi(?:\n|$))[^\n]*\n)*?exit 1\nfi/.test(
        diskBudget
      )
    if (
      !diskBudgetStep ||
      !/^\s*(?:-\s*)?shell:\s*bash\s*$/m.test(diskBudgetStep) ||
      /^\s*(?:-\s*)?if:\s*/m.test(diskBudgetStep) ||
      /^\s*(?:-\s*)?continue-on-error:\s*/m.test(diskBudgetStep) ||
      !diskBudgetCommands ||
      !validatesMeasurement ||
      !rejectsLowDisk
    ) {
      failures.push(
        'native-linux must fail closed below the 40 GiB pre-test disk budget'
      )
    }
    const candidatePolicy = findRunInvocation(
      linux,
      /^node\s+\.\.\/harness\/scripts\/ci\/candidate-path-policy\.mjs(?:\s|$)/
    )
    if (
      !candidatePolicy ||
      !/--root\s+["']?\$bundle["']?/.test(candidatePolicy.commands.join('\n'))
    ) {
      failures.push(
        'native-linux must run the protected token-aware candidate path policy'
      )
    } else if (/--runtime-only/.test(candidatePolicy.commands.join('\n'))) {
      failures.push(
        'native-linux candidate path policy must check product and runtime names'
      )
    }
  }
  if (windows) {
    const candidatePolicy = findRunInvocation(
      windows,
      /^node\s+(?:\.\/)?harness\/scripts\/ci\/candidate-path-policy\.mjs(?:\s|$)/
    )
    if (
      !candidatePolicy ||
      !/--root\s+\$bundle/.test(candidatePolicy.commands.join('\n'))
    ) {
      failures.push(
        'native-windows must run the protected token-aware candidate path policy'
      )
    } else if (/--runtime-only/.test(candidatePolicy.commands.join('\n'))) {
      failures.push(
        'native-windows candidate path policy must check product and runtime names'
      )
    }
  }
  for (const [jobName, block] of [
    ['native-linux', linux],
    ['native-windows', windows],
  ]) {
    if (block && LEGACY_BROAD_CANDIDATE_VERIFIER.test(block)) {
      failures.push(`${jobName} must not use a broad retired-runtime verifier`)
    }
  }
  if (
    macos &&
    !hasRunInvocation(
      macos,
      /^node\s+harness\/scripts\/verify-macos-candidate\.mjs\b/,
      [
        /--repo-root\s+target(?:\s|$)/,
        /target\/src-tauri/,
        /--app\s+[^\n]+/,
        /--dmg\s+[^\n]+/,
        /--version\s+[^\n]+/,
        /--signature\s+ad-hoc/,
      ]
    )
  ) {
    failures.push(
      'native-macos must accept the candidate with the protected harness verifier'
    )
  }
  if (
    windows &&
    !hasRunInvocation(
      windows,
      /^&\s+(?:\.\/)?harness\/scripts\/ci\/verify-windows-candidate\.ps1\b/,
      [/-Exe\s+[^\n]+/, /-Msi\s+[^\n]+/, /-Version\s+[^\n]+/]
    )
  ) {
    failures.push(
      'native-windows must accept EXE and MSI packages with the protected harness verifier'
    )
  }

  if (artifactReplay) {
    if (
      !/uses:\s*actions\/download-artifact@v4/.test(artifactReplay) ||
      !/repository:\s*\$\{\{\s*github\.repository\s*\}\}/.test(
        artifactReplay
      ) ||
      !/run-id:\s*\$\{\{\s*needs\.preflight\.outputs\.replay_run_id\s*\}\}/.test(
        artifactReplay
      ) ||
      !/name:\s*qualification-manifest-\$\{\{\s*needs\.preflight\.outputs\.replay_run_id\s*\}\}/.test(
        artifactReplay
      ) ||
      /^\s*pattern:\s*/m.test(artifactReplay)
    ) {
      failures.push('artifact replay must download a retained GitHub artifact')
    }
    if (
      !/^\s*ref:\s*\$\{\{\s*needs\.preflight\.outputs\.workflow_sha\s*\}\}\s*$/m.test(
        artifactReplay
      ) ||
      !/^\s*path:\s*harness\s*$/m.test(artifactReplay)
    ) {
      failures.push('artifact replay must use the protected harness verifier')
    }
    if (
      !hasRunInvocation(
        artifactReplay,
        /^node\s+harness\/scripts\/ci\/verify-qualification-artifacts\.mjs\s+verify(?:\s|\\|$)/,
        [
          /--manifest\s+[^\n]+/,
          /--manifest-sha256\s+[^\n]+/,
          /--target-sha\s+[^\n]+/,
          /--base-sha\s+[^\n]+/,
          /--run-id\s+[^\n]+/,
        ]
      )
    ) {
      failures.push(
        'artifact replay must strictly verify digest, target, base, and source run identity'
      )
    }
    const replaySandbox = runBlocks(artifactReplay).find((commands) =>
      commands.some((command) =>
        /^harness\/scripts\/ci\/run-untrusted-qualification-verifier\.sh(?:\s|$)/.test(
          command
        )
      )
    )
    const replaySandboxText = replaySandbox?.join('\n') ?? ''
    const replaySandboxCalls =
      replaySandbox?.filter((command) =>
        /^harness\/scripts\/ci\/run-untrusted-qualification-verifier\.sh(?:\s|$)/.test(
          command
        )
      ).length ?? 0
    const replayLastHelper = replaySandboxText.lastIndexOf(
      'harness/scripts/ci/run-untrusted-qualification-verifier.sh'
    )
    const replayBeforeHelper =
      replayLastHelper >= 0 ? replaySandboxText.slice(0, replayLastHelper) : ''
    const replayAfterHelper =
      replayLastHelper >= 0 ? replaySandboxText.slice(replayLastHelper) : ''
    const replayLastHelperCommand = replaySandbox
      ? replaySandbox.findLastIndex((command) =>
          /^harness\/scripts\/ci\/run-untrusted-qualification-verifier\.sh(?:\s|$)/.test(
            command
          )
        )
      : -1
    const replayProtectedAfter =
      replayLastHelperCommand >= 0
        ? replaySandbox
            .slice(replayLastHelperCommand + 1)
            .filter((command) =>
              /^node\s+harness\/scripts\/ci\/verify-qualification-artifacts\.mjs(?:\s|$)/.test(
                command
              )
            )
        : []
    if (
      replaySandboxCalls !== 2 ||
      !/--read-root\s+["']?\$artifact_root["']?[\s\S]*target\/scripts\/ci\/verify-qualification-artifacts\.mjs/.test(
        replaySandboxText
      ) ||
      !/verify-platforms\s+--root\s+["']?\$artifact_root["']?/.test(
        replaySandboxText
      ) ||
      !/node\s+harness\/scripts\/ci\/verify-qualification-artifacts\.mjs\s+verify(?:\s|\\|$)/.test(
        replayBeforeHelper
      ) ||
      replayProtectedAfter.length < 2 ||
      !/\$\{verify_args\[@\]\}/.test(replayAfterHelper) ||
      !/verify-platforms\s+--root\s+["']?\$artifact_root["']?/.test(
        replayAfterHelper
      )
    ) {
      failures.push(
        'artifact replay must sandbox both exact-target verifier modes between protected verification passes'
      )
    }
  }

  if (aggregate) {
    const activeAggregate = uncommentedSource(aggregate)
    if (
      !jobNeeds(aggregate, 'recovery-auth') ||
      !/needs\.recovery-auth\.result\s*==\s*['"]success['"]/.test(
        activeAggregate
      )
    ) {
      failures.push(
        'aggregate-artifacts must depend on successful recovery-auth in aggregate-recovery mode'
      )
    }

    const recoveryDownloads = workflowStepBlocks(activeAggregate).filter(
      (step) =>
        /uses:\s*actions\/download-artifact@v4/.test(step) &&
        /^\s*(?:-\s*)?if:\s*needs\.preflight\.outputs\.mode\s*==\s*['"]aggregate-recovery['"]\s*$/m.test(
          step
        )
    )
    for (const platform of ['linux', 'windows', 'macos']) {
      const expectedName = new RegExp(
        `^\\s*name:\\s*qualification-build-${platform}-\\$\\{\\{\\s*needs\\.preflight\\.outputs\\.recovery_run_id\\s*\\}\\}\\s*$`,
        'm'
      )
      const expectedPath = new RegExp(
        `^\\s*path:\\s*qualification-current/${platform}\\s*$`,
        'm'
      )
      const downloads = recoveryDownloads.filter((step) =>
        expectedName.test(step)
      )
      if (
        downloads.length !== 1 ||
        !/^\s*(?:-\s*)?if:\s*needs\.preflight\.outputs\.mode\s*==\s*['"]aggregate-recovery['"]\s*$/m.test(
          downloads[0] ?? ''
        ) ||
        !/github-token:\s*\$\{\{\s*github\.token\s*\}\}/.test(
          downloads[0] ?? ''
        ) ||
        !/repository:\s*\$\{\{\s*github\.repository\s*\}\}/.test(
          downloads[0] ?? ''
        ) ||
        !/run-id:\s*\$\{\{\s*needs\.preflight\.outputs\.recovery_run_id\s*\}\}/.test(
          downloads[0] ?? ''
        ) ||
        !expectedPath.test(downloads[0] ?? '') ||
        /^\s*pattern:\s*/m.test(downloads[0] ?? '')
      ) {
        failures.push(
          `aggregate recovery must download the exact authenticated ${platform} artifact by source run ID`
        )
      }
    }
    if (
      recoveryDownloads.length !== 3 ||
      recoveryDownloads.some((step) => /^\s*pattern:\s*/m.test(step))
    ) {
      failures.push(
        'aggregate recovery must use exactly three named source artifacts and never a pattern'
      )
    }

    if (
      !/RECOVERY_SUMMARY_JSON:\s*\$\{\{\s*needs\.recovery-auth\.outputs\.summary_json\s*\}\}/.test(
        activeAggregate
      ) ||
      !/RECOVERY_MODE:\s*\$\{\{\s*needs\.preflight\.outputs\.mode\s*==\s*['"]aggregate-recovery['"]\s*\}\}/.test(
        activeAggregate
      ) ||
      !/\.sourceRunId\s*==\s*\$recovery_run_id/.test(activeAggregate) ||
      !/\.targetSha\s*==\s*\$target_sha/.test(activeAggregate) ||
      !/\.baseSha\s*==\s*\$base_sha/.test(activeAggregate) ||
      !/\.artifacts\s*\|\s*length\s*==\s*3/.test(activeAggregate) ||
      !/qualification-evidence\/run-\$\{\{\s*github\.run_id\s*\}\}-aggregate-recovery\.json/.test(
        activeAggregate
      )
    ) {
      failures.push(
        'aggregate recovery must validate and embed the authenticated recovery summary'
      )
    }

    const aggregateSandbox = runBlocks(aggregate).find((commands) =>
      commands.some((command) =>
        /^harness\/scripts\/ci\/run-untrusted-qualification-verifier\.sh(?:\s|$)/.test(
          command
        )
      )
    )
    const aggregateSandboxText = aggregateSandbox?.join('\n') ?? ''
    const aggregateHelperCalls =
      aggregateSandbox?.filter((command) =>
        /^harness\/scripts\/ci\/run-untrusted-qualification-verifier\.sh(?:\s|$)/.test(
          command
        )
      ).length ?? 0
    const aggregateFirstHelper = aggregateSandboxText.indexOf(
      'harness/scripts/ci/run-untrusted-qualification-verifier.sh'
    )
    const aggregateLastHelper = aggregateSandboxText.lastIndexOf(
      'harness/scripts/ci/run-untrusted-qualification-verifier.sh'
    )
    const aggregateBeforeHelper =
      aggregateFirstHelper >= 0
        ? aggregateSandboxText.slice(0, aggregateFirstHelper)
        : ''
    const aggregateAfterHelper =
      aggregateLastHelper >= 0
        ? aggregateSandboxText.slice(aggregateLastHelper)
        : ''
    const aggregateFirstHelperCommand = aggregateSandbox
      ? aggregateSandbox.findIndex((command) =>
          /^harness\/scripts\/ci\/run-untrusted-qualification-verifier\.sh(?:\s|$)/.test(
            command
          )
        )
      : -1
    const aggregateLastHelperCommand = aggregateSandbox
      ? aggregateSandbox.findLastIndex((command) =>
          /^harness\/scripts\/ci\/run-untrusted-qualification-verifier\.sh(?:\s|$)/.test(
            command
          )
        )
      : -1
    const aggregateProtectedBefore =
      aggregateFirstHelperCommand >= 0
        ? aggregateSandbox
            .slice(0, aggregateFirstHelperCommand)
            .some((command) =>
              /^node\s+harness\/scripts\/ci\/verify-qualification-artifacts\.mjs(?:\s|$)/.test(
                command
              )
            )
        : false
    const aggregateProtectedAfter =
      aggregateLastHelperCommand >= 0
        ? aggregateSandbox
            .slice(aggregateLastHelperCommand + 1)
            .filter((command) =>
              /^node\s+harness\/scripts\/ci\/verify-qualification-artifacts\.mjs(?:\s|$)/.test(
                command
              )
            )
        : []
    if (
      aggregateHelperCalls !== 2 ||
      !/--read-root\s+qualification-output[\s\S]*target\/scripts\/ci\/verify-qualification-artifacts\.mjs/.test(
        aggregateSandboxText
      ) ||
      !/verify-platforms\s+--root\s+qualification-output/.test(
        aggregateSandboxText
      ) ||
      !aggregateProtectedBefore ||
      !/\$\{verify_args\[@\]\}/.test(aggregateBeforeHelper) ||
      aggregateProtectedAfter.length < 2 ||
      !/\$\{verify_args\[@\]\}/.test(aggregateAfterHelper) ||
      !/verify-platforms\s+--root\s+qualification-output/.test(
        aggregateAfterHelper
      )
    ) {
      failures.push(
        'aggregate-artifacts must sandbox both target verifier modes between protected verification passes'
      )
    }
  }

  if (gate) {
    if (!/^    if:\s*(?:\$\{\{\s*)?always\(\)(?:\s*\}\})?\s*$/m.test(gate)) {
      failures.push('qualification gate must run with always()')
    }
    for (const dependency of [
      'preflight',
      'docs-build',
      'recovery-auth',
      'artifact-replay',
      'native-linux',
      'native-windows',
      'native-macos',
      'aggregate-artifacts',
    ]) {
      if (!jobNeeds(gate, dependency)) {
        failures.push(`qualification gate must receive ${dependency} result`)
      }
    }
    if (
      !hasRunInvocation(
        gate,
        /^(?:if\s+\[\s+["']?\$PREFLIGHT_RESULT["']?\s+!=\s+["']success["']\s+\];\s*then|(?:require_|check_|expect_)[A-Za-z0-9_-]+\s+["']?preflight["']?(?:\s|$))/
      )
    ) {
      failures.push('qualification gate must fail closed on preflight result')
    }
    for (const plannedJob of [
      'docs-build',
      'recovery-auth',
      'artifact-replay',
      'native-linux',
      'native-windows',
      'native-macos',
      'aggregate-artifacts',
    ]) {
      if (
        !hasRunInvocation(
          gate,
          new RegExp(
            `^(?:require_|check_|expect_)[A-Za-z0-9_-]+\\s+["']?${escapeRegExp(plannedJob)}["']?(?:\\s|$)`
          )
        )
      ) {
        failures.push(
          `qualification gate must fail closed on ${plannedJob} result`
        )
      }
    }
    if (
      !hasRunInvocation(
        gate,
        /^(?:require_|check_|expect_)[A-Za-z0-9_-]+\s+[^({]/
      )
    ) {
      failures.push(
        'qualification gate must fail closed on required job results'
      )
    }
    if (
      !/RECOVERY_RESULT:\s*\$\{\{\s*needs\.recovery-auth\.result\s*\}\}/.test(
        uncommentedSource(gate)
      ) ||
      !/if\s+\[\s+["']?\$MODE["']?\s+=\s+["']aggregate-recovery["']\s+\];\s*then[\s\S]*?recovery_required=true/.test(
        uncommentedSource(gate)
      )
    ) {
      failures.push(
        'qualification gate must require recovery-auth only for aggregate-recovery'
      )
    }
  }

  if (
    hasRunInvocation(
      source,
      /^(?:(?:&|command)\s+)?node\s+target\/scripts\/ci\/verify-qualification-artifacts\.mjs(?:\s|$)/
    )
  ) {
    failures.push(
      'exact target qualification verifier must never run directly outside the protected sandbox helper'
    )
  }

  if (/^\s*environment:\s*/m.test(active)) {
    failures.push('exact-SHA qualification must not use an environment')
  }
  if (/\$\{\{\s*secrets\.|^\s*secrets:\s*(?:inherit|\S+)/m.test(active)) {
    failures.push('exact-SHA qualification must not consume secrets')
  }
  if (
    /(?:softprops\/action-gh-release|\bgh\s+release\b|\b(?:npm|cargo)\s+publish\b|\byarn\s+npm\s+publish\b|\bgit\s+push\b|\bdocker\s+push\b|\b(?:aws\s+s3|gsutil\s+cp|az\s+storage|rclone|scp)\b|\bcurl\b[^\n]*(?:--upload-file|-T\b|-X\s*(?:POST|PUT)|--data(?:-binary)?\b|--form\b)|\bwget\b[^\n]*--post|Invoke-(?:WebRequest|RestMethod)[^\n]*-Method\s+(?:Post|Put)|promote-desktop-update|deploy-updater)/i.test(
      active
    )
  ) {
    failures.push(
      'exact-SHA qualification must not publish, deploy, or upload outside GitHub Actions artifacts'
    )
  }

  return failures
}

function productFacingMetainfo(metainfo) {
  return metainfo
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(
      /<(?:id|icon|launchable|url|image)\b[^>]*>[\s\S]*?<\/(?:id|icon|launchable|url|image)>/gi,
      ''
    )
    .replace(/<[^>]+>/g, ' ')
}

export function validateFlatpakMetadata(manifest, metainfo) {
  const failures = []

  if (!/^id: uk\.jingxing\.Mita$/m.test(manifest)) {
    failures.push('Flatpak must retain the published uk.jingxing.Mita app ID')
  }
  if (
    !/^command: Biyan$/m.test(manifest) ||
    !/usr\/bin\/Biyan \/app\/bin\/Biyan/.test(manifest)
  ) {
    failures.push('Flatpak runtime entry points must use Biyan')
  }
  if (
    !/flatpak\/Biyan_[^/\s]*\.deb/.test(manifest) ||
    /flatpak\/Mita_[^/\s]*\.deb/i.test(manifest)
  ) {
    failures.push('Flatpak source artifact must be Biyan-branded')
  }
  if (
    /--device=all|extensions\/cuda|OpenCL\/vendors|name:\s*(?:volk|vulkan-headers|vulkan-tools|shaderc)\b/i.test(
      manifest
    )
  ) {
    failures.push(
      'Flatpak still requests or bundles retired local model GPU compute support'
    )
  }

  if (!/<name>Biyan<\/name>/i.test(metainfo)) {
    failures.push('Flatpak product name must be Biyan')
  }
  if (!/does\s+not bundle or run local AI models/i.test(metainfo)) {
    failures.push(
      'Flatpak metadata must state the remote-only local-model boundary'
    )
  }
  if (/\b(?:Mita|Jan|Silence)\b/i.test(productFacingMetainfo(metainfo))) {
    failures.push(
      'Flatpak product-facing metadata exposes a retired product name'
    )
  }
  if (
    /Private offline|100% offline|Local AI models:|offline by default|localhost:1337|Llama\.cpp|Mita Hub|Native MLX/i.test(
      metainfo
    )
  ) {
    failures.push(
      'Flatpak metadata advertises retired offline or local-model behavior'
    )
  }

  return failures
}
