function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

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

const CANDIDATE_PATH_POLICY =
  'node scripts/ci/candidate-path-policy.mjs --root'
const LEGACY_BROAD_CANDIDATE_GREP =
  /grep\s+-Ei[^\n]*(?:llama|mlx|foundation|rag|vector)/i

function hasStandaloneCommand(source, command) {
  const normalizedSource = source.replace(/\r\n?/g, '\n')
  return new RegExp(
    `(?:^|\\n)[ \\t]*(?:(?:-\\s*)?run:\\s*)?${escapeRegExp(command)}[ \\t]*(?:\\n|$)`
  ).test(normalizedSource)
}

function validateCandidatePathPolicyJob(block, label, candidateRoot) {
  const failures = []
  const normalizedBlock = block.replace(/\r\n?/g, '\n')
  const command = `${CANDIDATE_PATH_POLICY} ${candidateRoot} --runtime-only`
  if (!hasStandaloneCommand(normalizedBlock, command)) {
    failures.push(`${label} must run the token-aware candidate path policy`)
  }
  if (LEGACY_BROAD_CANDIDATE_GREP.test(normalizedBlock)) {
    failures.push(`${label} must not use the broad retired-runtime grep`)
  }
  return failures
}

export function validateReleaseIdentity({
  version,
  migrationPhase,
  dataSchema,
  cargoLockVersion,
}) {
  const failures = []
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

  const bridgeTrain = {
    '0.6.634': { migrationPhase: 'A', dataSchema: 1 },
    '0.6.635': { migrationPhase: 'B', dataSchema: 2 },
    '0.6.636': { migrationPhase: 'C', dataSchema: 3 },
    '0.6.637': { migrationPhase: 'A', dataSchema: 1 },
    '0.6.638': { migrationPhase: 'B', dataSchema: 2 },
    '0.6.639': { migrationPhase: 'C', dataSchema: 3 },
    '0.6.640': { migrationPhase: 'A', dataSchema: 1 },
    '0.6.641': { migrationPhase: 'B', dataSchema: 2 },
    '0.6.642': { migrationPhase: 'C', dataSchema: 3 },
  }[version]
  if (
    bridgeTrain &&
    (migrationPhase !== bridgeTrain.migrationPhase ||
      dataSchema !== bridgeTrain.dataSchema)
  ) {
    failures.push(
      `bridge release ${version} must attest ${bridgeTrain.migrationPhase}/${bridgeTrain.dataSchema}`
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
  source = source.replace(/\r\n?/g, '\n')
  const failures = []
  const preflight = jobBlock(source, 'preflight')
  const qualityGate = jobBlock(source, 'quality-gate')

  if (!preflight) {
    failures.push('desktop release is missing the immutable preflight job')
  } else {
    if (!preflight.includes('node scripts/ci/verify-release-policy.mjs')) {
      failures.push(
        'desktop release preflight does not run the release policy scan'
      )
    }
    if (
      !preflight.includes(
        'node --test scripts/ci/__tests__/release-policy.test.mjs'
      )
    ) {
      failures.push(
        'desktop release preflight does not test release policy contracts'
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
    if (
      buildJob === 'build-macos' &&
      !block.includes('make verify-macos-candidate')
    ) {
      failures.push(
        'build-macos must verify the signed app and DMG candidate contents'
      )
    }
    if (buildJob === 'build-windows' || buildJob === 'build-linux') {
      failures.push(
        ...validateCandidatePathPolicyJob(
          block,
          buildJob,
          'src-tauri/target/release/bundle'
        )
      )
    }
  }

  return failures
}

export function validateCandidatePathPolicyWorkflows(workflows) {
  const failures = []
  for (const [workflow, { candidateRoot, jobName, source }] of Object.entries(
    workflows
  )) {
    const block = jobBlock(source.replace(/\r\n?/g, '\n'), jobName)
    if (!block) {
      failures.push(`${workflow} is missing the ${jobName} job`)
      continue
    }
    failures.push(
      ...validateCandidatePathPolicyJob(block, workflow, candidateRoot)
    )
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
  const ciScope = jobBlock(source, 'ci-scope')
  const releaseSafety = jobBlock(source, 'release-safety')
  const coverageCheck = jobBlock(source, 'coverage-check')
  const prGate = jobBlock(source, 'pr-ci-gate')

  if (!ciScope) {
    failures.push('Biyan CI is missing the ci-scope job')
  } else if (
    /printf[^\n]*\|\s*grep[^\n]*(?:-[A-Za-z]*q[A-Za-z]*|--quiet)/.test(ciScope)
  ) {
    failures.push(
      'Biyan CI scope detection must not use a short-circuiting printf | grep -q pipeline under pipefail'
    )
  }

  if (!releaseSafety) {
    failures.push('Biyan CI is missing the release-safety job')
  } else {
    for (const command of [
      'node scripts/ci/verify-release-policy.mjs',
      'node --test scripts/ci/__tests__/release-policy.test.mjs',
      'node --test scripts/updater/__tests__/updater.test.mjs',
    ]) {
      if (!releaseSafety.includes(command)) {
        failures.push(`Biyan CI release-safety job does not run: ${command}`)
      }
    }
  }

  if (
    !prGate ||
    !jobNeeds(prGate, 'ci-scope') ||
    !jobNeeds(prGate, 'release-safety') ||
    !jobNeeds(prGate, 'coverage-check')
  ) {
    failures.push(
      'PR CI Gate must require ci-scope, release-safety, and coverage-check results'
    )
  }

  if (!coverageCheck) {
    failures.push('Biyan CI is missing the coverage-check job')
  } else if (/^    continue-on-error:\s*true\s*$/m.test(coverageCheck)) {
    failures.push('coverage-check must not be advisory at the job level')
  }

  if (
    prGate &&
    !prGate.includes('require_success "coverage-check" "$COVERAGE_RESULT"')
  ) {
    failures.push('PR CI Gate must enforce coverage-check for full CI')
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
