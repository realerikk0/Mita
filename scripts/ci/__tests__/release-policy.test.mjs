import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import {
  validateBundledLegalResources,
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

test('bridge release trains lock version, phase, schema, and Cargo.lock together', () => {
  for (const [version, migrationPhase, dataSchema] of [
    ['0.6.634', 'A', 1],
    ['0.6.635', 'B', 2],
    ['0.6.636', 'C', 3],
    ['0.6.637', 'A', 1],
    ['0.6.638', 'B', 2],
    ['0.6.639', 'C', 3],
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
      version: '0.6.637',
      migrationPhase: 'B',
      dataSchema: 2,
      cargoLockVersion: '0.6.637',
    }).some((failure) => failure.includes('must attest A/1'))
  )
  assert.ok(
    validateReleaseIdentity({
      version: '0.6.639',
      migrationPhase: 'C',
      dataSchema: 3,
      cargoLockVersion: '0.6.638',
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

  const withoutRunner = makefile.replaceAll(
    'cargo build --release --features computer-agent-runner --bin biyan-computer-agent-runner',
    'echo skipped-computer-agent-runner'
  )
  assert.ok(
    validateLinuxReleaseBuild(
      withoutRunner,
      packageJson,
      buildCliScript,
      linuxTauriConfig
    ).some((failure) => failure.includes('must compile the release'))
  )

  const echoedRunner = makefile.replace(
    '\tcd src-tauri && cargo build --release --features computer-agent-runner --bin biyan-computer-agent-runner\n',
    '\techo cd src-tauri && cargo build --release --features computer-agent-runner --bin biyan-computer-agent-runner\n'
  )
  assert.ok(
    validateLinuxReleaseBuild(
      echoedRunner,
      packageJson,
      buildCliScript,
      linuxTauriConfig
    ).some((failure) => failure.includes('must compile the release'))
  )

  const commentedRunner = makefile.replace(
    '\tcd src-tauri && cargo build --release --features computer-agent-runner --bin biyan-computer-agent-runner\n',
    '\t# cd src-tauri && cargo build --release --features computer-agent-runner --bin biyan-computer-agent-runner\n'
  )
  assert.ok(
    validateLinuxReleaseBuild(
      commentedRunner,
      packageJson,
      buildCliScript,
      linuxTauriConfig
    ).some((failure) => failure.includes('must compile the release'))
  )

  const cliInstall =
    '\tinstall -m755 src-tauri/target/release/biyan-cli src-tauri/resources/bin/biyan-cli\n'
  const runnerBuild =
    '\tcd src-tauri && cargo build --release --features computer-agent-runner --bin biyan-computer-agent-runner\n'
  const cliInstalledTooLate = makefile.replace(
    `${cliInstall}${runnerBuild}`,
    `${runnerBuild}${cliInstall}`
  )
  assert.ok(
    validateLinuxReleaseBuild(
      cliInstalledTooLate,
      packageJson,
      buildCliScript,
      linuxTauriConfig
    ).some((failure) => failure.includes('before compiling'))
  )

  const nonExecutableCli = makefile.replace(
    cliInstall,
    '\tcp src-tauri/target/release/biyan-cli src-tauri/resources/bin/biyan-cli\n'
  )
  assert.ok(
    validateLinuxReleaseBuild(
      nonExecutableCli,
      packageJson,
      buildCliScript,
      linuxTauriConfig
    ).some((failure) => failure.includes('executable biyan-cli'))
  )

  const nonExecutableRunner = makefile.replace(
    '\tinstall -m755 src-tauri/target/release/biyan-computer-agent-runner src-tauri/resources/computer-agent-runner/biyan-computer-agent-runner\n',
    '\tinstall -m644 src-tauri/target/release/biyan-computer-agent-runner src-tauri/resources/computer-agent-runner/biyan-computer-agent-runner\n'
  )
  assert.ok(
    validateLinuxReleaseBuild(
      nonExecutableRunner,
      packageJson,
      buildCliScript,
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
      makefile,
      packageJson,
      buildCliScript,
      withoutBundledRunner
    ).some((failure) => failure.includes('Linux bundle must include'))
  )

  const withoutBuildCliDelegate = structuredClone(packageJson)
  withoutBuildCliDelegate.scripts['build:cli'] = 'echo skipped-all-cli-builds'
  assert.ok(
    validateLinuxReleaseBuild(
      makefile,
      withoutBuildCliDelegate,
      buildCliScript,
      linuxTauriConfig
    ).some((failure) => failure.includes('must delegate the release build'))
  )

  const withoutMakeDelegate = buildCliScript.replace(
    "  run('make', [makeTarget])",
    "  run('echo', ['skipped-make'])"
  )
  assert.ok(
    validateLinuxReleaseBuild(
      makefile,
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
      makefile,
      withoutCliPreparation,
      buildCliScript,
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
  build-linux:
    needs: [preflight, quality-gate]
    environment: release-distribution
`

test('candidate workflow gates every platform build on exact-tag tests', () => {
  assert.deepEqual(validateCandidateWorkflow(candidateWorkflow), [])

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
