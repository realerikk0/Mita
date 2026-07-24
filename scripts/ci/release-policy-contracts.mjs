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

const TRUSTED_CI_SCOPE_COMMAND_ALLOWLIST = new Set([
  // Reviewed active-command sequence for the fail-closed ci-scope detector.
  'e0867c3b7586d4844629574802faf1a99bbe73e5c9d62dad5c90bc38800933c2',
])

const TRUSTED_CI_SCOPE_JOB_ALLOWLIST = new Set([
  // Exact ci-scope job envelope; line endings and trailing blank lines are compatible.
  '965743af788bb834a1b0d29d01033b9edfdb7d0939065ae97f3f70069306fa71',
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

function actionStepBlocks(source, action) {
  const normalized = source.replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')
  const escaped = escapeRegExp(action)
  const blocks = []
  for (let index = 0; index < lines.length; index += 1) {
    const match = new RegExp(
      `^(\\s*)(-\\s*)?uses:\\s*${escaped}\\s*$`
    ).exec(lines[index])
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
  exactKeys(policy, ['schema', 'activeTrain', 'trains'], 'release train policy')
  if (policy?.schema !== 1) {
    failures.push('release train policy must use schema 1')
  }
  if (!Array.isArray(policy?.trains) || policy.trains.length === 0) {
    failures.push('release train policy must declare at least one train')
    return failures
  }

  const active = policy.trains.filter((train) => train?.status === 'active')
  if (
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
    if (
      (train.status === 'active') !==
      (trainIndex === policy.trains.length - 1)
    ) {
      failures.push('the active release train must be the final history entry')
    }
    if (ids.has(train.id)) {
      failures.push(`duplicate release train id: ${train.id}`)
    }
    ids.add(train.id)

    const releases = train.releases
    if (
      !releases ||
      Object.keys(releases).sort().join(',') !== 'A,B,C'
    ) {
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

  const bridgeTrain = trainPolicy?.trains
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
    (migrationPhase !== bridgeTrain.migrationPhase ||
      dataSchema !== bridgeTrain.dataSchema)
  ) {
    failures.push(
      `bridge release ${version} in ${bridgeTrain.trainId} must attest ${bridgeTrain.migrationPhase}/${bridgeTrain.dataSchema}`
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
  const activeTrain = trainPolicy?.trains?.find(
    (train) =>
      train.id === trainPolicy.activeTrain && train.status === 'active'
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

export function validateCandidateWorkflow(source) {
  const failures = []
  const preflight = jobBlock(source, 'preflight')
  const qualityGate = jobBlock(source, 'quality-gate')
  const packageCandidate = jobBlock(source, 'package-candidate')
  const draftRelease = jobBlock(source, 'draft-release')
  const permissions = topLevelBlock(source, 'permissions')
  const checkoutSteps = actionStepBlocks(source, 'actions/checkout@v4')

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
    !/^    permissions:\s*\n      contents:\s*write\s*$/m.test(draftRelease)
  ) {
    failures.push(
      'only the draft release job may request contents: write permission'
    )
  }
  if (!packageCandidate) {
    failures.push('desktop release is missing the immutable package job')
  } else {
    if (
      !/^    environment:\s*release-distribution\s*$/m.test(packageCandidate)
    ) {
      failures.push(
        'package-candidate must protect the provenance signing key with release-distribution'
      )
    }
    if (
      !packageCandidate.includes('yarn tauri signer sign') ||
      !packageCandidate.includes('dist/updater-candidate/candidate.json') ||
      !packageCandidate.includes('candidate.json.sig') ||
      !packageCandidate.includes('SHA256SUMS')
    ) {
      failures.push(
        'package-candidate must sign candidate.json and checksum the detached provenance signature'
      )
    }
  }

  if (!preflight) {
    failures.push('desktop release is missing the immutable preflight job')
  } else {
    if (
      !checkoutSteps.some(
        (step) =>
          /^\s*ref:\s*mita-main\s*$/m.test(step) &&
          /^\s*path:\s*harness\s*$/m.test(step)
      ) ||
      !checkoutSteps.some((step) => /^\s*path:\s*target\s*$/m.test(step))
    ) {
      failures.push(
        'desktop release preflight must separate the protected mita-main harness from the exact target checkout'
      )
    }
    if (
      !preflight.includes(
        'git -C harness merge-base --is-ancestor'
      ) ||
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
      !preflight.includes('[ "$checkout_head" != "$live_main" ]') ||
      !preflight.includes('echo "trusted_main_commit=$live_main"')
    ) {
      failures.push(
        'desktop release trusted harness HEAD must equal freshly fetched live origin/mita-main'
      )
    }
    if (
      !preflight.includes(
        'node harness/scripts/ci/verify-release-policy.mjs'
      ) ||
      !preflight.includes('--repo-root target') ||
      !preflight.includes('--require-active')
    ) {
      failures.push(
        'desktop release preflight does not run the protected active-train release policy against the target'
      )
    }
    if (
      !preflight.includes(
        'node --test scripts/ci/__tests__/release-policy.test.mjs'
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
    const liveMainProbe =
      'git ls-remote --exit-code origin refs/heads/mita-main'
    const firstLiveMainProbe = block.indexOf(liveMainProbe)
    const lastLiveMainProbe = block.lastIndexOf(liveMainProbe)
    const artifactUpload = block.indexOf('uses: actions/upload-artifact@v4')
    if (
      firstLiveMainProbe < 0 ||
      !block.includes('needs.preflight.outputs.trusted_main_commit') ||
      (artifactUpload >= 0 &&
        (lastLiveMainProbe < firstLiveMainProbe ||
          lastLiveMainProbe > artifactUpload))
    ) {
      failures.push(
        `${buildJob} must revalidate unchanged live mita-main before external mutation`
      )
    }
    if (
      buildJob === 'build-macos' &&
      !block.includes('make verify-macos-candidate')
    ) {
      failures.push(
        'build-macos must verify the signed app and DMG candidate contents'
      )
    }
    if (['build-windows', 'build-linux'].includes(buildJob)) {
      const candidatePolicy = findRunInvocation(
        block,
        /^node\s+scripts\/ci\/candidate-path-policy\.mjs(?:\s|$)/
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
      } else if (
        /--runtime-only/.test(candidatePolicy.commands.join('\n'))
      ) {
        failures.push(
          `${buildJob} candidate path policy must check product and runtime names`
        )
      }
      if (LEGACY_BROAD_CANDIDATE_VERIFIER.test(block)) {
        failures.push(
          `${buildJob} must not use a broad retired-runtime verifier`
        )
      }
    }
  }

  for (const [jobName, block] of [
    ['package-candidate', packageCandidate],
    ['draft-release', draftRelease],
  ]) {
    const liveMainProbe =
      'git ls-remote --exit-code origin refs/heads/mita-main'
    const probeIndex = block?.lastIndexOf(liveMainProbe) ?? -1
    const mutationIndex =
      jobName === 'package-candidate'
        ? (block?.indexOf('uses: actions/upload-artifact@v4') ?? -1)
        : (block?.indexOf('uses: softprops/action-gh-release@v2') ?? -1)
    if (
      block &&
      (probeIndex < 0 ||
        mutationIndex < 0 ||
        probeIndex > mutationIndex ||
        !block.includes('needs.preflight.outputs.trusted_main_commit'))
    ) {
      failures.push(
        `${jobName} must revalidate unchanged live mita-main before external mutation`
      )
    }
  }

  return failures
}

export function validateReleaseEnvironmentWorkflows(workflows) {
  const failures = []
  for (const [workflow, { jobName, source }] of Object.entries(workflows)) {
    const block = jobBlock(source, jobName)
    if (!block) {
      failures.push(`${workflow} is missing the ${jobName} job`)
      continue
    }
    if (!/^    environment:\s*release-distribution\s*$/m.test(block)) {
      failures.push(
        `${workflow} ${jobName} must use the release-distribution environment`
      )
    }
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
      (key) => canonicalTopLevelKeys.filter((candidate) => candidate === key).length !== 1
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
    failures.push('Biyan CI must define exactly one top-level permissions block')
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
    failures.push(
      'Biyan CI jobs must use canonical unquoted job keys'
    )
  }
  if (
    canonicalJobKeys.length !== TRUSTED_CI_JOB_KEY_ALLOWLIST.size ||
    canonicalJobKeys.some(
      (key) => !TRUSTED_CI_JOB_KEY_ALLOWLIST.has(key)
    )
  ) {
    failures.push(
      'Biyan CI jobs must match the reviewed job-key allowlist'
    )
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
      failures.push(
        'Biyan CI job permissions must be exactly contents: read'
      )
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
    normalizedYamlEnvelope(permissions) !==
    'permissions:\n  contents: read\n'
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
    ...normalizedSource.matchAll(
      /^  (?:ci-scope|["']ci-scope["'])\s*:/gm
    ),
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
        failures.push(`Biyan CI scope must validate ${axis} as a boolean output`)
      }
    }
    if (
      !scopeValidation ||
      !/^\s+BLOCKED:\s*\$\{\{\s*steps\.scope\.outputs\.blocked\s*\}\}\s*$/m.test(
        ciScope
      ) ||
      !/\[\s*["']?\$BLOCKED["']?\s*!=\s*["']false["']\s*\]/.test(
        validationText
      )
    ) {
      failures.push('Biyan CI scope must reject missing or blocked classifier output')
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
    for (const command of [
      'node scripts/ci/verify-release-policy.mjs',
      'node --test scripts/ci/__tests__/candidate-content-policy.test.mjs',
      'node --test scripts/ci/__tests__/release-policy.test.mjs',
      'node --test scripts/ci/__tests__/qualification-impact.test.mjs',
      'node --test scripts/ci/__tests__/verify-qualification-artifacts.test.mjs',
      'node --test scripts/updater/__tests__/updater.test.mjs',
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
        failures.push(`CI control path ${pattern} must require review from ${owner}`)
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
    [/ReadUInt32\(\)[\s\S]*0x00004550/, 'must validate the PE header signature'],
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
  ]) {
    if (!pattern.test(active)) {
      failures.push(`Windows candidate verifier ${message}`)
    }
  }
  return failures
}

export function validateMacOSCandidateVerifier(source) {
  const active = uncommentedSource(source)
  const failures = []
  for (const [pattern, message] of [
    [/runCommand\(["']hdiutil["'],\s*\[["']verify["']/, 'must verify the DMG container'],
    [/["']attach["'][\s\S]*["']-readonly["'][\s\S]*["']-mountpoint["']/, 'must mount the DMG read-only'],
    [/bundleSnapshot\(appPath\)/, 'must snapshot the accepted app'],
    [/bundleSnapshot\(mountedApp\)/, 'must snapshot the DMG app'],
    [/sha256File\(/, 'must hash bundle files'],
    [/sourceSnapshot[\s\S]*mountedSnapshot/, 'must compare source and DMG app snapshots'],
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
    const booleanBootstrap = /^      bootstrap_full:\s*$/m.test(trigger)
    const modeBootstrap =
      /^      mode:\s*$/m.test(trigger) &&
      /^          - bootstrap-full\s*$/m.test(trigger)
    if (!booleanBootstrap && !modeBootstrap) {
      failures.push(
        'exact-SHA qualification must expose an explicit bootstrap-full mode'
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
    const forceUpgradeIsConditional =
      (classifierText.match(/--force-full/g) ?? []).length === 1 &&
      /if\s+\[[^\n]*(?:bootstrap_full|bootstrap-full)[^\n]*\];\s*then\n[\s\S]*?--force-full[\s\S]*?\nfi/.test(
        classifierText
      )
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
      ].every((pattern) => pattern.test(trustedContractText)) ||
      (!explicitlyTrustedPaths && !trustedWorkingDirectory)
    ) {
      failures.push(
        'qualification focused preflight must test trusted classifier, release policy, and artifact verifier contracts'
      )
    }
    for (const [command, condition] of [
      ['node scripts/ci/verify-release-policy.mjs', 'policy'],
      ['node --test scripts/ci/__tests__/release-policy.test.mjs', 'policy'],
      ['node --test scripts/updater/__tests__/updater.test.mjs', 'updater'],
    ]) {
      if (
        !hasRunInvocation(
          preflight,
          new RegExp(`^${escapeRegExp(command)}(?:\\s|$)`)
        ) ||
        !new RegExp(`steps\\.classification\\.outputs\\.${condition}`).test(
          activePreflight
        )
      ) {
        failures.push(
          `qualification focused preflight does not run: ${command}`
        )
      }
    }
    if (
      !/scripts\/release-distribution\/__tests__\/release-distribution\.test\.mjs/.test(
        activePreflight
      ) ||
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
    ['artifact-replay', artifactReplay],
    ['aggregate-artifacts', aggregate],
    ['qualification-gate', gate],
  ]) {
    if (!block) failures.push(`exact-SHA qualification is missing ${jobName}`)
    else if (!/^    runs-on:\s*['"]?ubuntu-24\.04['"]?\s*$/m.test(block)) {
      failures.push(`${jobName} must use ubuntu-24.04`)
    }
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
      failures.push(`${jobName} must checkout the protected qualification harness`)
    }
  }
  if (linux) {
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
      failures.push(
        `${jobName} must not use a broad retired-runtime verifier`
      )
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
        /^node\s+harness\/scripts\/ci\/verify-qualification-artifacts\.mjs\s+verify\b/,
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
  }

  if (gate) {
    if (!/^    if:\s*(?:\$\{\{\s*)?always\(\)(?:\s*\}\})?\s*$/m.test(gate)) {
      failures.push('qualification gate must run with always()')
    }
    for (const dependency of [
      'preflight',
      'docs-build',
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
