import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  assertSafeCandidatePaths,
  findCandidatePathViolation,
} from '../candidate-path-policy.mjs'
import {
  validateBundledLegalResources,
  validateCandidatePathPolicyWorkflows,
  validateCandidateWorkflow,
  validateCiWorkflow,
  validateDocsArchiveConfig,
  validateFlatpakMetadata,
  validateLinuxReleaseBuild,
  validateReleaseIdentity,
  validateReleaseEnvironmentWorkflows,
} from '../release-policy-contracts.mjs'

const platformConfigPaths = [
  'src-tauri/tauri.conf.json',
  'src-tauri/tauri.macos.conf.json',
  'src-tauri/tauri.windows.conf.json',
  'src-tauri/tauri.linux.conf.json',
  'src-tauri/tauri.android.conf.json',
  'src-tauri/tauri.ios.conf.json',
]

const normalizeLineEndings = (source) => source.replace(/\r\n?/g, '\n')
const withLineEndings = (source, lineEnding) =>
  normalizeLineEndings(source).replaceAll('\n', lineEnding)

const repoRoot = path.resolve(import.meta.dirname, '../../..')
const runtimeOnly = { checkProduct: false, checkRuntime: true }

test('candidate path policy allows Playwright vocabulary but rejects retired tokens', () => {
  for (const name of [
    'playwright-test-coverage.prompt.md',
    'crCoverage.js',
    'crDragDrop.js',
    'userAgent.js',
    'storage-state.md',
    'webstorage.js',
    'storage.js',
    'coverage.js',
    'snapshotStorage.js',
  ]) {
    assert.equal(
      findCandidatePathViolation(`resources/ms-playwright/${name}`, runtimeOnly),
      null,
      name
    )
  }

  for (const name of [
    'llamacpp-extension.dylib',
    'llama.cpp',
    'mlx-extension.tgz',
    'foundation-models-extension',
    'rag-extension',
    'vector-db-extension',
    'local-models',
    'rag+extension.tgz',
    'rag@extension.tgz',
    '(rag)-extension.tgz',
    'llama+cpp-extension.tgz',
    'foundation+models-extension',
    'vector(db)-extension',
    'local~models',
  ]) {
    assert.equal(
      findCandidatePathViolation(`resources/native/${name}`, runtimeOnly)?.kind,
      'runtime',
      name
    )
  }

  assert.equal(
    findCandidatePathViolation(
      'Contents/Resources/rag-extension/index.js',
      runtimeOnly
    )?.kind,
    'runtime'
  )
  assert.equal(
    findCandidatePathViolation(
      'Contents\\Resources\\rag-extension\\index.js',
      runtimeOnly
    )?.kind,
    'runtime'
  )
  for (const candidatePath of [
    'resources/vector/db/extension',
    'resources/foundation/models/extension',
    'resources/local/models',
    'resources\\vector\\db\\extension',
    'resources\\foundation\\models\\extension',
    'resources\\local\\models',
  ]) {
    assert.equal(
      findCandidatePathViolation(candidatePath, runtimeOnly)?.kind,
      'runtime',
      candidatePath
    )
  }
  assert.equal(
    findCandidatePathViolation('Contents/Resources/Mita-helper.js')?.kind,
    'product'
  )
  for (const name of [
    'mita+helper.dmg',
    'silence(helper).dmg',
    '(jan)-runtime.zip',
  ]) {
    assert.equal(
      findCandidatePathViolation(`artifacts/${name}`)?.kind,
      'product',
      name
    )
  }

  for (const name of [
    'vectorize.js',
    'foundationless.js',
    'localmodelsafe.js',
    'mitapp-helper.js',
    'silenced-helper.js',
  ]) {
    assert.equal(findCandidatePathViolation(`resources/${name}`), null, name)
  }
})

test('candidate path traversal fails closed without following bundle symlinks', (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'biyan-path-policy-'))
  t.after(() => fs.rmSync(parent, { force: true, recursive: true }))
  const root = path.join(parent, 'candidate')
  fs.mkdirSync(root)
  fs.writeFileSync(path.join(root, 'coverage.js'), '')
  assert.doesNotThrow(() => assertSafeCandidatePaths(root, runtimeOnly))

  assert.throws(
    () => assertSafeCandidatePaths(path.join(parent, 'missing'), runtimeOnly),
    /root does not exist/
  )

  const rootLink = path.join(parent, 'candidate-link')
  fs.symlinkSync(root, rootLink, 'dir')
  assert.throws(
    () => assertSafeCandidatePaths(rootLink, runtimeOnly),
    /root must not be a symbolic link/
  )

  fs.symlinkSync(
    '/relocated/workspace/Biyan.png',
    path.join(root, '.DirIcon')
  )
  assert.doesNotThrow(() => assertSafeCandidatePaths(root, runtimeOnly))

  fs.symlinkSync(
    '/relocated/workspace/rag-extension',
    path.join(root, 'runtime-link')
  )
  assert.throws(
    () => assertSafeCandidatePaths(root, runtimeOnly),
    /Retired local runtime found in candidate path/
  )
})

test('release policy verifier applies the shared token-aware artifact policy', (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'biyan-artifact-policy-')
  )
  t.after(() => fs.rmSync(root, { force: true, recursive: true }))
  for (const name of ['crCoverage.js', 'crDragDrop.js', 'snapshotStorage.js']) {
    fs.writeFileSync(path.join(root, name), '')
  }

  const runVerifier = () =>
    spawnSync(
      process.execPath,
      ['scripts/ci/verify-release-policy.mjs', '--artifact-root', root],
      { cwd: repoRoot, encoding: 'utf8' }
    )
  const allowed = runVerifier()
  assert.equal(allowed.status, 0, allowed.stderr)

  fs.writeFileSync(path.join(root, 'rag-extension.tgz'), '')
  const retired = runVerifier()
  assert.equal(retired.status, 1, retired.stdout)
  assert.match(retired.stderr, /Retired local runtime found in candidate path/)
})

test('bridge release trains lock version, phase, schema, and Cargo.lock together', () => {
  for (const [version, migrationPhase, dataSchema] of [
    ['0.6.634', 'A', 1],
    ['0.6.635', 'B', 2],
    ['0.6.636', 'C', 3],
    ['0.6.637', 'A', 1],
    ['0.6.638', 'B', 2],
    ['0.6.639', 'C', 3],
    ['0.6.640', 'A', 1],
    ['0.6.641', 'B', 2],
    ['0.6.642', 'C', 3],
  ]) {
    assert.deepEqual(
      validateReleaseIdentity({
        version,
        migrationPhase,
        dataSchema,
        cargoLockVersion: version,
      }),
      []
    )
  }

  assert.ok(
    validateReleaseIdentity({
      version: '0.6.640',
      migrationPhase: 'B',
      dataSchema: 2,
      cargoLockVersion: '0.6.640',
    }).some((failure) => failure.includes('must attest A/1'))
  )
  assert.ok(
    validateReleaseIdentity({
      version: '0.6.642',
      migrationPhase: 'C',
      dataSchema: 3,
      cargoLockVersion: '0.6.641',
    }).some((failure) => failure.includes('Cargo.lock version'))
  )
})

test('Linux release build prepares every binary required by Tauri bundling', () => {
  const makefile = fs.readFileSync('Makefile', 'utf8')
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'))
  const buildCliScript = fs.readFileSync('scripts/build-cli.mjs', 'utf8')
  const linuxTauriConfig = JSON.parse(
    fs.readFileSync('src-tauri/tauri.linux.conf.json', 'utf8')
  )
  assert.deepEqual(
    validateLinuxReleaseBuild(
      makefile,
      packageJson,
      buildCliScript,
      linuxTauriConfig
    ),
    []
  )

  const lfMakefile = withLineEndings(makefile, '\n')
  const lfBuildCliScript = withLineEndings(buildCliScript, '\n')
  const crlfMakefile = withLineEndings(lfMakefile, '\r\n')
  const crlfBuildCliScript = withLineEndings(lfBuildCliScript, '\r\n')
  assert.deepEqual(
    validateLinuxReleaseBuild(
      crlfMakefile,
      packageJson,
      crlfBuildCliScript,
      linuxTauriConfig
    ),
    []
  )

  assert.deepEqual(
    validateLinuxReleaseBuild(
      withLineEndings(lfMakefile, '\r'),
      packageJson,
      withLineEndings(lfBuildCliScript, '\r'),
      linuxTauriConfig
    ),
    []
  )

  const crlfWithoutRunner = crlfMakefile.replaceAll(
    'cargo build --release --features computer-agent-runner --bin biyan-computer-agent-runner',
    'echo skipped-computer-agent-runner'
  )
  assert.ok(
    validateLinuxReleaseBuild(
      crlfWithoutRunner,
      packageJson,
      crlfBuildCliScript,
      linuxTauriConfig
    ).some((failure) => failure.includes('must compile the release'))
  )

  const crlfWithoutMakeDelegate = crlfBuildCliScript.replace(
    "  run('make', [makeTarget])",
    "  run('echo', ['skipped-make'])"
  )
  assert.ok(
    validateLinuxReleaseBuild(
      crlfMakefile,
      packageJson,
      crlfWithoutMakeDelegate,
      linuxTauriConfig
    ).some((failure) => failure.includes('must run the Makefile'))
  )

  const withoutRunner = lfMakefile.replaceAll(
    'cargo build --release --features computer-agent-runner --bin biyan-computer-agent-runner',
    'echo skipped-computer-agent-runner'
  )
  assert.ok(
    validateLinuxReleaseBuild(
      withoutRunner,
      packageJson,
      lfBuildCliScript,
      linuxTauriConfig
    ).some((failure) => failure.includes('must compile the release'))
  )

  const echoedRunner = lfMakefile.replace(
    '\tcd src-tauri && cargo build --release --features computer-agent-runner --bin biyan-computer-agent-runner\n',
    '\techo cd src-tauri && cargo build --release --features computer-agent-runner --bin biyan-computer-agent-runner\n'
  )
  assert.ok(
    validateLinuxReleaseBuild(
      echoedRunner,
      packageJson,
      lfBuildCliScript,
      linuxTauriConfig
    ).some((failure) => failure.includes('must compile the release'))
  )

  const commentedRunner = lfMakefile.replace(
    '\tcd src-tauri && cargo build --release --features computer-agent-runner --bin biyan-computer-agent-runner\n',
    '\t# cd src-tauri && cargo build --release --features computer-agent-runner --bin biyan-computer-agent-runner\n'
  )
  assert.ok(
    validateLinuxReleaseBuild(
      commentedRunner,
      packageJson,
      lfBuildCliScript,
      linuxTauriConfig
    ).some((failure) => failure.includes('must compile the release'))
  )

  const cliInstall =
    '\tinstall -m755 src-tauri/target/release/biyan-cli src-tauri/resources/bin/biyan-cli\n'
  const runnerBuild =
    '\tcd src-tauri && cargo build --release --features computer-agent-runner --bin biyan-computer-agent-runner\n'
  const cliInstalledTooLate = lfMakefile.replace(
    `${cliInstall}${runnerBuild}`,
    `${runnerBuild}${cliInstall}`
  )
  assert.ok(
    validateLinuxReleaseBuild(
      cliInstalledTooLate,
      packageJson,
      lfBuildCliScript,
      linuxTauriConfig
    ).some((failure) => failure.includes('before compiling'))
  )

  const nonExecutableCli = lfMakefile.replace(
    cliInstall,
    '\tcp src-tauri/target/release/biyan-cli src-tauri/resources/bin/biyan-cli\n'
  )
  assert.ok(
    validateLinuxReleaseBuild(
      nonExecutableCli,
      packageJson,
      lfBuildCliScript,
      linuxTauriConfig
    ).some((failure) => failure.includes('executable biyan-cli'))
  )

  const nonExecutableRunner = lfMakefile.replace(
    '\tinstall -m755 src-tauri/target/release/biyan-computer-agent-runner src-tauri/resources/computer-agent-runner/biyan-computer-agent-runner\n',
    '\tinstall -m644 src-tauri/target/release/biyan-computer-agent-runner src-tauri/resources/computer-agent-runner/biyan-computer-agent-runner\n'
  )
  assert.ok(
    validateLinuxReleaseBuild(
      nonExecutableRunner,
      packageJson,
      lfBuildCliScript,
      linuxTauriConfig
    ).some((failure) => failure.includes('install the executable'))
  )

  const withoutBundledRunner = structuredClone(linuxTauriConfig)
  withoutBundledRunner.bundle.resources =
    withoutBundledRunner.bundle.resources.filter(
      (resource) => resource !== 'resources/computer-agent-runner/**/*'
    )
  assert.ok(
    validateLinuxReleaseBuild(
      lfMakefile,
      packageJson,
      lfBuildCliScript,
      withoutBundledRunner
    ).some((failure) => failure.includes('Linux bundle must include'))
  )

  const withoutBuildCliDelegate = structuredClone(packageJson)
  withoutBuildCliDelegate.scripts['build:cli'] = 'echo skipped-all-cli-builds'
  assert.ok(
    validateLinuxReleaseBuild(
      lfMakefile,
      withoutBuildCliDelegate,
      lfBuildCliScript,
      linuxTauriConfig
    ).some((failure) => failure.includes('must delegate the release build'))
  )

  const withoutMakeDelegate = lfBuildCliScript.replace(
    "  run('make', [makeTarget])",
    "  run('echo', ['skipped-make'])"
  )
  assert.ok(
    validateLinuxReleaseBuild(
      lfMakefile,
      packageJson,
      withoutMakeDelegate,
      linuxTauriConfig
    ).some((failure) => failure.includes('must run the Makefile'))
  )

  const withoutCliPreparation = structuredClone(packageJson)
  withoutCliPreparation.scripts['build:tauri:linux'] =
    withoutCliPreparation.scripts['build:tauri:linux'].replace(
      'yarn build:cli && ',
      ''
    )
  assert.ok(
    validateLinuxReleaseBuild(
      lfMakefile,
      withoutCliPreparation,
      lfBuildCliScript,
      linuxTauriConfig
    ).some((failure) => failure.includes('before yarn tauri build'))
  )
})

test('every platform bundle includes LICENSE and NOTICE', () => {
  const platformConfigs = Object.fromEntries(
    platformConfigPaths.map((configPath) => [
      configPath,
      JSON.parse(fs.readFileSync(configPath, 'utf8')),
    ])
  )
  assert.deepEqual(validateBundledLegalResources(platformConfigs), [])

  const withoutNotice = structuredClone(platformConfigs)
  const macosConfigPath = 'src-tauri/tauri.macos.conf.json'
  withoutNotice[macosConfigPath].bundle.resources = withoutNotice[
    macosConfigPath
  ].bundle.resources.filter((resource) => resource !== 'resources/NOTICE')
  assert.ok(
    validateBundledLegalResources(withoutNotice).some((failure) =>
      failure.includes('resources/NOTICE')
    )
  )

  const withoutBaseLicense = structuredClone(platformConfigs)
  delete withoutBaseLicense['src-tauri/tauri.conf.json'].bundle.resources[
    'resources/LICENSE'
  ]
  assert.ok(
    validateBundledLegalResources(withoutBaseLicense).some((failure) =>
      failure.includes('resources/LICENSE')
    )
  )
})

const candidateWorkflow = `jobs:
  preflight:
    steps:
      - run: node scripts/ci/verify-release-policy.mjs
      - run: node --test scripts/ci/__tests__/release-policy.test.mjs
  quality-gate:
    needs: preflight
    steps:
      - run: make test
      - run: node --test scripts/updater/__tests__/updater.test.mjs
  build-macos:
    needs: [preflight, quality-gate]
    environment: release-distribution
    steps:
      - run: make verify-macos-candidate APP=Biyan.app DMG=Biyan.dmg VERSION=0.6.636
  build-windows:
    needs:
      - preflight
      - quality-gate
    environment: release-distribution
    steps:
      - run: node scripts/ci/candidate-path-policy.mjs --root src-tauri/target/release/bundle --runtime-only
  build-linux:
    needs: [preflight, quality-gate]
    environment: release-distribution
    steps:
      - run: node scripts/ci/candidate-path-policy.mjs --root src-tauri/target/release/bundle --runtime-only
`

test('candidate workflow gates every platform build on exact-tag tests', () => {
  for (const lineEnding of ['\n', '\r\n', '\r']) {
    assert.deepEqual(
      validateCandidateWorkflow(withLineEndings(candidateWorkflow, lineEnding)),
      [],
      JSON.stringify(lineEnding)
    )
  }

  const withoutUpdaterContracts = candidateWorkflow.replace(
    'node --test scripts/updater/__tests__/updater.test.mjs',
    'echo skipped'
  )
  assert.ok(
    validateCandidateWorkflow(withoutUpdaterContracts).some((failure) =>
      failure.includes('updater contract tests')
    )
  )

  const withoutMacCandidateVerification = candidateWorkflow.replace(
    'make verify-macos-candidate',
    'echo skipped-candidate-verification'
  )
  assert.ok(
    validateCandidateWorkflow(withoutMacCandidateVerification).some((failure) =>
      failure.includes('signed app and DMG')
    )
  )

  const withoutWindowsPathPolicy = candidateWorkflow.replace(
    '      - run: node scripts/ci/candidate-path-policy.mjs --root src-tauri/target/release/bundle --runtime-only\n',
    ''
  )
  assert.ok(
    validateCandidateWorkflow(withoutWindowsPathPolicy).some(
      (failure) =>
        failure.includes('build-windows') &&
        failure.includes('token-aware candidate path policy')
    )
  )

  const broadRuntimeGrep = candidateWorkflow.replace(
    '      - run: node scripts/ci/candidate-path-policy.mjs --root src-tauri/target/release/bundle --runtime-only',
    `      - run: node scripts/ci/candidate-path-policy.mjs --root src-tauri/target/release/bundle --runtime-only
      - run: find bundle -type f | grep -Ei '(llama|mlx|foundation|rag|vector)'`
  )
  assert.ok(
    validateCandidateWorkflow(broadRuntimeGrep).some((failure) =>
      failure.includes('broad retired-runtime grep')
    )
  )

  const safeUnrelatedGrep = candidateWorkflow.replace(
    '      - run: node scripts/ci/candidate-path-policy.mjs --root src-tauri/target/release/bundle --runtime-only',
    `      - run: grep -Ei 'foo' harmless.txt
      - run: node scripts/ci/candidate-path-policy.mjs --root src-tauri/target/release/bundle --runtime-only
      - run: echo vector`
  )
  for (const lineEnding of ['\n', '\r\n', '\r']) {
    assert.deepEqual(
      validateCandidateWorkflow(
        withLineEndings(safeUnrelatedGrep, lineEnding)
      ),
      [],
      `safe grep ${JSON.stringify(lineEnding)}`
    )
  }

  const ungatedWindows = candidateWorkflow.replace(
    `  build-windows:
    needs:
      - preflight
      - quality-gate`,
    `  build-windows:
    needs: preflight`
  )
  assert.ok(
    validateCandidateWorkflow(ungatedWindows).some((failure) =>
      failure.includes('build-windows')
    )
  )

  const splitReleaseBuildEnvironment = candidateWorkflow.replace(
    'environment: release-distribution',
    'environment: release-build'
  )
  assert.ok(
    validateCandidateWorkflow(splitReleaseBuildEnvironment).some((failure) =>
      failure.includes('release-distribution environment')
    )
  )
})

test('macOS build templates fail closed without the token-aware path policy', () => {
  const command =
    'node scripts/ci/candidate-path-policy.mjs --root "$app_root" --runtime-only'
  const workflows = {
    '.github/workflows/template-tauri-build-macos.yml': {
      candidateRoot: '"$app_root"',
      jobName: 'build-macos',
      source: fs.readFileSync(
        '.github/workflows/template-tauri-build-macos.yml',
        'utf8'
      ),
    },
    '.github/workflows/template-tauri-build-macos-external.yml': {
      candidateRoot: '"$app_root"',
      jobName: 'build-macos-external',
      source: fs.readFileSync(
        '.github/workflows/template-tauri-build-macos-external.yml',
        'utf8'
      ),
    },
  }
  assert.deepEqual(validateCandidatePathPolicyWorkflows(workflows), [])
  for (const lineEnding of ['\n', '\r\n', '\r']) {
    const withPlatformLineEndings = structuredClone(workflows)
    for (const workflow of Object.values(withPlatformLineEndings)) {
      workflow.source = withLineEndings(workflow.source, lineEnding)
    }
    assert.deepEqual(
      validateCandidatePathPolicyWorkflows(withPlatformLineEndings),
      [],
      JSON.stringify(lineEnding)
    )
  }

  for (const workflow of Object.keys(workflows)) {
    const withoutPolicy = structuredClone(workflows)
    withoutPolicy[workflow].source = withoutPolicy[workflow].source.replace(
      command,
      'echo skipped-candidate-path-policy'
    )
    assert.ok(
      validateCandidatePathPolicyWorkflows(withoutPolicy).some(
        (failure) =>
          failure.includes(workflow) &&
          failure.includes('token-aware candidate path policy')
      )
    )
  }
})

test('formal build, release, and updater jobs share the release-distribution environment', () => {
  const workflows = {
    '.github/workflows/release-distribution.yml': {
      jobName: 'distribute',
      source: fs.readFileSync(
        '.github/workflows/release-distribution.yml',
        'utf8'
      ),
    },
    '.github/workflows/deploy-updater-router.yml': {
      jobName: 'deploy',
      source: fs.readFileSync(
        '.github/workflows/deploy-updater-router.yml',
        'utf8'
      ),
    },
    '.github/workflows/biyan-upgrade-smoke.yml': {
      jobName: 'attest',
      source: fs.readFileSync(
        '.github/workflows/biyan-upgrade-smoke.yml',
        'utf8'
      ),
    },
    '.github/workflows/promote-desktop-update.yml': {
      jobName: 'promote',
      source: fs.readFileSync(
        '.github/workflows/promote-desktop-update.yml',
        'utf8'
      ),
    },
    '.github/workflows/updater-health-gate.yml': {
      jobName: 'evaluate',
      source: fs.readFileSync(
        '.github/workflows/updater-health-gate.yml',
        'utf8'
      ),
    },
    '.github/workflows/updater-kill-switch.yml': {
      jobName: 'update',
      source: fs.readFileSync(
        '.github/workflows/updater-kill-switch.yml',
        'utf8'
      ),
    },
    '.github/workflows/template-tauri-build-macos.yml': {
      jobName: 'build-macos',
      source: fs.readFileSync(
        '.github/workflows/template-tauri-build-macos.yml',
        'utf8'
      ),
    },
    '.github/workflows/template-tauri-build-windows-x64.yml': {
      jobName: 'build-windows-x64',
      source: fs.readFileSync(
        '.github/workflows/template-tauri-build-windows-x64.yml',
        'utf8'
      ),
    },
    '.github/workflows/template-tauri-build-linux-x64.yml': {
      jobName: 'build-linux-x64',
      source: fs.readFileSync(
        '.github/workflows/template-tauri-build-linux-x64.yml',
        'utf8'
      ),
    },
    '.github/workflows/template-tauri-build-linux-x64-flatpak.yml': {
      jobName: 'build-linux-x64',
      source: fs.readFileSync(
        '.github/workflows/template-tauri-build-linux-x64-flatpak.yml',
        'utf8'
      ),
    },
  }
  assert.deepEqual(validateReleaseEnvironmentWorkflows(workflows), [])

  for (const invalidEnvironment of [
    'release-build',
    'updater-production',
    'updater-smoke-approval',
  ]) {
    for (const workflow of Object.keys(workflows)) {
      const splitEnvironment = structuredClone(workflows)
      splitEnvironment[workflow].source = splitEnvironment[
        workflow
      ].source.replace(
        'environment: release-distribution',
        `environment: ${invalidEnvironment}`
      )
      assert.ok(
        validateReleaseEnvironmentWorkflows(splitEnvironment).some(
          (failure) =>
            failure.includes(workflow) &&
            failure.includes('release-distribution environment')
        )
      )
    }
  }
})

test('Flatpak reusable build keeps caller-compatible read-only contents permission', () => {
  const source = fs.readFileSync(
    '.github/workflows/template-tauri-build-linux-x64-flatpak.yml',
    'utf8'
  )

  for (const lineEnding of ['\n', '\r\n', '\r']) {
    const normalizedSource = normalizeLineEndings(
      withLineEndings(source, lineEnding)
    )
    assert.match(
      normalizedSource,
      /^  build-linux-x64:\n(?:[\s\S]*?)^    permissions:\n      contents: read$/m
    )
    assert.doesNotMatch(
      normalizedSource,
      /^  build-linux-x64:\n(?:[\s\S]*?)^    permissions:\n      contents: write$/m
    )
  }
})

test('PR CI gate includes release policy and updater contracts', () => {
  const workflow = `jobs:
  ci-scope:
    steps:
      - run: grep -E '^src-tauri/' <<< "$changed_files" >/dev/null
  release-safety:
    steps:
      - run: node scripts/ci/verify-release-policy.mjs
      - run: node --test scripts/ci/__tests__/release-policy.test.mjs
      - run: node --test scripts/updater/__tests__/updater.test.mjs
  coverage-check:
    steps:
      - run: yarn test:coverage
  pr-ci-gate:
    needs: [ci-scope, release-safety, coverage-check]
    steps:
      - run: require_success "coverage-check" "$COVERAGE_RESULT"
`
  assert.deepEqual(validateCiWorkflow(workflow), [])
  assert.ok(
    validateCiWorkflow(
      workflow.replace(
        'needs: [ci-scope, release-safety, coverage-check]',
        'needs: []'
      )
    ).some((failure) => failure.includes('PR CI Gate'))
  )

  const advisoryCoverage = workflow.replace(
    '  coverage-check:\n',
    '  coverage-check:\n    continue-on-error: true\n'
  )
  assert.ok(
    validateCiWorkflow(advisoryCoverage).some((failure) =>
      failure.includes('must not be advisory')
    )
  )

  const unenforcedCoverage = workflow.replace(
    '      - run: require_success "coverage-check" "$COVERAGE_RESULT"\n',
    ''
  )
  assert.ok(
    validateCiWorkflow(unenforcedCoverage).some((failure) =>
      failure.includes('must enforce coverage-check')
    )
  )

  const unsafeScope = workflow.replace(
    `grep -E '^src-tauri/' <<< "$changed_files" >/dev/null`,
    `printf '%s\\n' "$changed_files" | grep -Eq '^src-tauri/'`
  )
  assert.ok(
    validateCiWorkflow(unsafeScope).some((failure) =>
      failure.includes('printf | grep -q')
    )
  )
})

test('docs archive is excluded from production typechecking', () => {
  const tsconfig = JSON.parse(fs.readFileSync('docs/tsconfig.json', 'utf8'))
  assert.deepEqual(validateDocsArchiveConfig(tsconfig), [])

  const withoutArchiveExclude = structuredClone(tsconfig)
  withoutArchiveExclude.exclude = withoutArchiveExclude.exclude.filter(
    (entry) => entry !== 'unpublished-upstream-history'
  )
  assert.ok(
    validateDocsArchiveConfig(withoutArchiveExclude).some((failure) =>
      failure.includes('unpublished-upstream-history')
    )
  )
})

test('Flatpak policy permits compatibility IDs but rejects retired product claims', () => {
  const manifest = `id: uk.jingxing.Mita
command: Biyan
url: https://updates.example/mita/flatpak/Biyan_0.6.636_amd64.deb
build-commands:
  - install -Dm755 usr/bin/Biyan /app/bin/Biyan
`
  const metainfo = `
    <component>
      <id>uk.jingxing.Mita</id>
      <name>Biyan</name>
      <description><p>Biyan requires cloud providers and does not bundle or run local AI models.</p></description>
      <launchable>uk.jingxing.Mita.desktop</launchable>
      <url>https://github.com/realerikk0/Mita</url>
    </component>
  `
  assert.deepEqual(validateFlatpakMetadata(manifest, metainfo), [])

  const retiredClaim = metainfo.replace(
    'Biyan requires cloud providers and does not bundle or run local AI models.',
    'Mita runs 100% offline with Llama.cpp.'
  )
  const failures = validateFlatpakMetadata(manifest, retiredClaim)
  assert.ok(
    failures.some((failure) => failure.includes('retired product name'))
  )
  assert.ok(
    failures.some((failure) =>
      failure.includes('offline or local-model behavior')
    )
  )
})
