import assert from 'node:assert/strict'
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
  validateCandidateWorkflow,
  validateCiControlOwnership,
  validateCiWorkflow,
  validateDocsArchiveConfig,
  validateFlatpakMetadata,
  validateLinuxReleaseBuild,
  validateMacOSCandidateVerifier,
  validateQualificationWorkflow,
  validateActiveReleaseIdentity,
  validateReleaseIdentity,
  validateReleaseTrainPolicy,
  validateReleaseEnvironmentWorkflows,
  validateWindowsCandidateVerifier,
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

const runtimeOnly = { checkProduct: false, checkRuntime: true }

test('candidate content policy tests have no external runtime dependency', () => {
  const source = fs.readFileSync(
    'scripts/ci/__tests__/candidate-content-policy.test.mjs',
    'utf8'
  )
  const specifiers = [
    ...source.matchAll(
      /^import(?:\s+(?:[\s\S]*?)\s+from)?\s*['"]([^'"]+)['"]\s*$/gm
    ),
  ].map((match) => match[1])
  assert.ok(specifiers.length > 0)
  assert.deepEqual(
    specifiers.filter(
      (specifier) =>
        !specifier.startsWith('node:') &&
        specifier !== '../candidate-content-policy.mjs'
    ),
    []
  )
})

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
    'storageScriptSource.js',
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

test('candidate path traversal requires contained, relative, live bundle symlinks', (t) => {
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

  fs.writeFileSync(path.join(root, 'Biyan.png'), '')
  fs.symlinkSync('Biyan.png', path.join(root, '.DirIcon'))
  assert.doesNotThrow(() => assertSafeCandidatePaths(root, runtimeOnly))

  fs.symlinkSync('/relocated/workspace/Biyan.png', path.join(root, 'absolute'))
  assert.throws(
    () => assertSafeCandidatePaths(root, runtimeOnly),
    /symlink target must be relative/
  )
  fs.rmSync(path.join(root, 'absolute'))

  fs.symlinkSync('../outside', path.join(root, 'escaping'))
  assert.throws(
    () => assertSafeCandidatePaths(root, runtimeOnly),
    /symlink escapes the bundle/
  )
  fs.rmSync(path.join(root, 'escaping'))

  fs.symlinkSync('missing', path.join(root, 'dangling'))
  assert.throws(
    () => assertSafeCandidatePaths(root, runtimeOnly),
    /symlink target does not exist/
  )
  fs.rmSync(path.join(root, 'dangling'))

  fs.symlinkSync(
    'rag-extension',
    path.join(root, 'runtime-link')
  )
  assert.throws(
    () => assertSafeCandidatePaths(root, runtimeOnly),
    /Retired local runtime found in candidate path/
  )
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
    ['0.6.643', 'A', 1],
    ['0.6.644', 'B', 2],
    ['0.6.645', 'C', 3],
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
  assert.ok(
    validateReleaseIdentity({
      version: '0.6.646',
      migrationPhase: 'A',
      dataSchema: 1,
      cargoLockVersion: '0.6.646',
    }).some((failure) => failure.includes('is not declared'))
  )
})

test('formal release identity accepts only the active train checkpoint', () => {
  assert.deepEqual(
    validateActiveReleaseIdentity({
      version: '0.6.643',
      migrationPhase: 'A',
      dataSchema: 1,
      cargoLockVersion: '0.6.643',
    }),
    []
  )
  for (const [version, migrationPhase, dataSchema] of [
    ['0.6.640', 'A', 1],
    ['0.6.641', 'B', 2],
    ['0.6.642', 'C', 3],
  ]) {
    assert.ok(
      validateActiveReleaseIdentity({
        version,
        migrationPhase,
        dataSchema,
        cargoLockVersion: version,
      }).some((failure) => failure.includes('not the declared active train'))
    )
  }
})

test('release train policy is unique, contiguous, and fail-closed', () => {
  const policy = JSON.parse(
    fs.readFileSync('scripts/ci/release-train-policy.json', 'utf8')
  )
  assert.deepEqual(validateReleaseTrainPolicy(policy), [])

  const twoActive = structuredClone(policy)
  twoActive.trains[0].status = 'active'
  assert.ok(
    validateReleaseTrainPolicy(twoActive).some((failure) =>
      failure.includes('exactly one matching active train')
    )
  )

  const phaseGap = structuredClone(policy)
  phaseGap.trains.at(-1).releases.B.version = '0.6.650'
  assert.ok(
    validateReleaseTrainPolicy(phaseGap).some((failure) =>
      failure.includes('versions must be contiguous')
    )
  )

  const missingPhase = structuredClone(policy)
  delete missingPhase.trains.at(-1).releases.C
  assert.ok(
    validateReleaseTrainPolicy(missingPhase).some((failure) =>
      failure.includes('exactly A, B, C')
    )
  )

  const downgradedActive = structuredClone(policy)
  downgradedActive.trains.at(-1).releases.A.version = '0.6.100'
  downgradedActive.trains.at(-1).releases.B.version = '0.6.101'
  downgradedActive.trains.at(-1).releases.C.version = '0.6.102'
  assert.ok(
    validateReleaseTrainPolicy(downgradedActive).some((failure) =>
      failure.includes('must start immediately after the previous C version')
    )
  )

  const reordered = structuredClone(policy)
  ;[reordered.trains[1], reordered.trains[2]] = [
    reordered.trains[2],
    reordered.trains[1],
  ]
  assert.ok(
    validateReleaseTrainPolicy(reordered).some((failure) =>
      failure.includes('must start immediately after the previous C version')
    )
  )

  const unknownStatus = structuredClone(policy)
  unknownStatus.trains[0].status = 'anything'
  assert.ok(
    validateReleaseTrainPolicy(unknownStatus).some((failure) =>
      failure.includes('unsupported status anything')
    )
  )

  const activeNotLast = structuredClone(policy)
  ;[activeNotLast.trains[2], activeNotLast.trains[3]] = [
    activeNotLast.trains[3],
    activeNotLast.trains[2],
  ]
  assert.ok(
    validateReleaseTrainPolicy(activeNotLast).some((failure) =>
      failure.includes('active release train must be the final history entry')
    )
  )

  const extraField = structuredClone(policy)
  extraField.trains.at(-1).releases.A.alias = 'latest'
  assert.ok(
    validateReleaseTrainPolicy(extraField).some((failure) =>
      failure.includes('keys must be exactly dataSchema, version')
    )
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

const candidateWorkflow = `permissions:
  contents: read
jobs:
  preflight:
    steps:
      - uses: actions/checkout@v4
        with:
          ref: mita-main
          path: harness
          persist-credentials: false
      - uses: actions/checkout@v4
        with:
          ref: v0.6.643
          path: target
          persist-credentials: false
      - run: |
          checkout_head="$(git -C harness rev-parse HEAD)"
          live_main="$(git -C harness rev-parse refs/remotes/origin/mita-main)"
          if [ "$checkout_head" != "$live_main" ]; then exit 1; fi
          echo "trusted_main_commit=$live_main"
      - run: git -C harness merge-base --is-ancestor "$source_commit" refs/remotes/origin/mita-main
      - run: node harness/scripts/ci/verify-release-policy.mjs --repo-root target --require-active
      - working-directory: harness
        run: node --test scripts/ci/__tests__/release-policy.test.mjs
  quality-gate:
    needs: preflight
    steps:
      - run: make test
      - run: node --test scripts/updater/__tests__/updater.test.mjs
  build-macos:
    needs: [preflight, quality-gate]
    environment: release-distribution
    steps:
      - run: git ls-remote --exit-code origin refs/heads/mita-main && echo needs.preflight.outputs.trusted_main_commit
      - run: make verify-macos-candidate APP=Biyan.app DMG=Biyan.dmg VERSION=0.6.636
      - uses: actions/upload-artifact@v4
  build-windows:
    needs:
      - preflight
      - quality-gate
    environment: release-distribution
    steps:
      - run: git ls-remote --exit-code origin refs/heads/mita-main && echo needs.preflight.outputs.trusted_main_commit
      - run: node scripts/ci/candidate-path-policy.mjs --root src-tauri/target/release/bundle
      - uses: actions/upload-artifact@v4
  build-linux:
    needs: [preflight, quality-gate]
    environment: release-distribution
    steps:
      - run: git ls-remote --exit-code origin refs/heads/mita-main && echo needs.preflight.outputs.trusted_main_commit
      - run: node scripts/ci/candidate-path-policy.mjs --root src-tauri/target/release/bundle
      - uses: actions/upload-artifact@v4
  package-candidate:
    needs: [preflight, build-macos, build-windows, build-linux]
    environment: release-distribution
    steps:
      - run: git ls-remote --exit-code origin refs/heads/mita-main && echo needs.preflight.outputs.trusted_main_commit
      - run: yarn tauri signer sign dist/updater-candidate/candidate.json
      - run: sha256sum Biyan* candidate.json candidate.json.sig latest.json > SHA256SUMS
      - uses: actions/upload-artifact@v4
  draft-release:
    permissions:
      contents: write
    steps:
      - run: git ls-remote --exit-code origin refs/heads/mita-main && echo needs.preflight.outputs.trusted_main_commit
      - uses: softprops/action-gh-release@v2
`

test('candidate workflow gates every platform build on exact-tag tests', () => {
  assert.deepEqual(validateCandidateWorkflow(candidateWorkflow), [])

  const topLevelWrite = candidateWorkflow.replace(
    'permissions:\n  contents: read',
    'permissions:\n  contents: write'
  )
  assert.ok(
    validateCandidateWorkflow(topLevelWrite).some((failure) =>
      failure.includes('top-level permissions')
    )
  )

  const persistedCheckout = candidateWorkflow.replace(
    'persist-credentials: false',
    'persist-credentials: true'
  )
  assert.ok(
    validateCandidateWorkflow(persistedCheckout).some((failure) =>
      failure.includes('persisted credentials')
    )
  )

  const untrustedHarness = candidateWorkflow.replace(
    'ref: mita-main',
    'ref: v0.6.643'
  )
  assert.ok(
    validateCandidateWorkflow(untrustedHarness).some((failure) =>
      failure.includes('protected mita-main harness')
    )
  )

  const withoutAncestorProof = candidateWorkflow.replace(
    'git -C harness merge-base --is-ancestor',
    'echo no-ancestor-proof'
  )

  const withoutExactHarnessHead = candidateWorkflow.replace(
    'checkout_head="$(git -C harness rev-parse HEAD)"',
    'checkout_head="$source_commit"'
  )
  assert.ok(
    validateCandidateWorkflow(withoutExactHarnessHead).some((failure) =>
      failure.includes('trusted harness HEAD')
    )
  )

  const withoutMutationRevalidation = candidateWorkflow.replaceAll(
    'git ls-remote --exit-code origin refs/heads/mita-main',
    'echo stale-main'
  )
  assert.ok(
    validateCandidateWorkflow(withoutMutationRevalidation).some((failure) =>
      failure.includes('before external mutation')
    )
  )

  const lateMutationRevalidation = candidateWorkflow.replace(
    '      - run: git ls-remote --exit-code origin refs/heads/mita-main && echo needs.preflight.outputs.trusted_main_commit\n      - run: make verify-macos-candidate APP=Biyan.app DMG=Biyan.dmg VERSION=0.6.636\n      - uses: actions/upload-artifact@v4',
    '      - run: make verify-macos-candidate APP=Biyan.app DMG=Biyan.dmg VERSION=0.6.636\n      - uses: actions/upload-artifact@v4\n      - run: git ls-remote --exit-code origin refs/heads/mita-main && echo needs.preflight.outputs.trusted_main_commit'
  )
  assert.ok(
    validateCandidateWorkflow(lateMutationRevalidation).some((failure) =>
      failure.includes('build-macos must revalidate')
    )
  )
  assert.ok(
    validateCandidateWorkflow(withoutAncestorProof).some((failure) =>
      failure.includes('ancestor of live mita-main')
    )
  )

  const withoutActiveTrainGate = candidateWorkflow.replace(
    '--require-active',
    '--ignored-active'
  )
  assert.ok(
    validateCandidateWorkflow(withoutActiveTrainGate).some((failure) =>
      failure.includes('active-train release policy')
    )
  )

  const withoutUpdaterContracts = candidateWorkflow.replace(
    'node --test scripts/updater/__tests__/updater.test.mjs',
    'echo skipped'
  )
  assert.ok(
    validateCandidateWorkflow(withoutUpdaterContracts).some((failure) =>
      failure.includes('updater contract tests')
    )
  )

  const unsignedProvenance = candidateWorkflow.replace(
    'yarn tauri signer sign dist/updater-candidate/candidate.json',
    'echo unsigned'
  )
  assert.ok(
    validateCandidateWorkflow(unsignedProvenance).some((failure) =>
      failure.includes('sign candidate.json')
    )
  )

  const unprotectedProvenanceKey = candidateWorkflow.replace(
    `  package-candidate:
    needs: [preflight, build-macos, build-windows, build-linux]
    environment: release-distribution`,
    `  package-candidate:
    needs: [preflight, build-macos, build-windows, build-linux]`
  )
  assert.ok(
    validateCandidateWorkflow(unprotectedProvenanceKey).some((failure) =>
      failure.includes('provenance signing key')
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

  const withoutRetiredRuntimeScanner = candidateWorkflow.replace(
    'node scripts/ci/candidate-path-policy.mjs --root src-tauri/target/release/bundle',
    'echo skipped-retired-runtime-scan'
  )
  assert.ok(
    validateCandidateWorkflow(withoutRetiredRuntimeScanner).some((failure) =>
      failure.includes('token-aware candidate path policy')
    )
  )

  const runtimeOnlyScanner = candidateWorkflow.replace(
    'node scripts/ci/candidate-path-policy.mjs --root src-tauri/target/release/bundle',
    'node scripts/ci/candidate-path-policy.mjs --root src-tauri/target/release/bundle --runtime-only'
  )
  assert.ok(
    validateCandidateWorkflow(runtimeOnlyScanner).some((failure) =>
      failure.includes('product and runtime names')
    )
  )

  const broadRuntimeGrep = candidateWorkflow.replace(
    '      - run: node scripts/ci/candidate-path-policy.mjs --root src-tauri/target/release/bundle',
    `      - run: node scripts/ci/candidate-path-policy.mjs --root src-tauri/target/release/bundle
      - run: find bundle -type f | grep -Ei '(llama|mlx|foundation|rag|vector)'`
  )
  assert.ok(
    validateCandidateWorkflow(broadRuntimeGrep).some((failure) =>
      failure.includes('broad retired-runtime verifier')
    )
  )

  const broadRuntimePowerShellMatch = candidateWorkflow.replace(
    '      - run: node scripts/ci/candidate-path-policy.mjs --root src-tauri/target/release/bundle',
    `      - run: node scripts/ci/candidate-path-policy.mjs --root src-tauri/target/release/bundle
      - run: |
          if ($path -match '(?i)(llama|mlx|foundation|rag|vector)') {
            throw "retired runtime"
          }`
  )
  assert.ok(
    validateCandidateWorkflow(broadRuntimePowerShellMatch).some((failure) =>
      failure.includes('broad retired-runtime verifier')
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

test('PR CI uses a trusted impact classifier and gates each affected axis', () => {
  const syntheticWorkflow = `permissions:
  contents: read
jobs:
  ci-scope:
    outputs:
      quick: \${{ steps.scope.outputs.quick }}
      test_linux: \${{ steps.scope.outputs.test_linux }}
      test_windows: \${{ steps.scope.outputs.test_windows }}
      test_macos: \${{ steps.scope.outputs.test_macos }}
      full: \${{ steps.scope.outputs.full }}
      docs: \${{ steps.scope.outputs.docs }}
      checkpoint: \${{ steps.scope.outputs.checkpoint }}
      policy: \${{ steps.scope.outputs.policy }}
      updater: \${{ steps.scope.outputs.updater }}
      artifact_replay: \${{ steps.scope.outputs.artifact_replay }}
    steps:
      - id: scope
        run: |
          set -euo pipefail

          emit_bootstrap_full() {
            local plan
            local plan_sha
            plan='{"classification":"bootstrap-full","reason":"trusted classifier is not available on the base commit"}'
            plan_sha="$(printf '%s' "$plan" | sha256sum | awk '{print $1}')"
            {
              echo 'classification=bootstrap-full'
              echo 'blocked=false'
              echo 'docs=true'
              echo 'checkpoint=false'
              echo 'focused=true'
              echo 'quick=true'
              echo 'policy=true'
              echo 'updater=true'
              echo 'artifact_replay=false'
              echo 'test_macos=true'
              echo 'test_windows=true'
              echo 'test_linux=true'
              echo 'build_macos=true'
              echo 'build_windows=true'
              echo 'build_linux=true'
              echo 'full=true'
              echo "plan_sha256=$plan_sha"
              echo "classification_json=$plan"
            } >> "$GITHUB_OUTPUT"
          }

          event='\${{ github.event_name }}'
          if [ "$event" = 'pull_request' ]; then
            policy_sha='\${{ github.event.pull_request.base.sha }}'
            target_sha='\${{ github.event.pull_request.head.sha }}'
            base_sha="$(git merge-base "$policy_sha" "$target_sha" || true)"
          elif [ "$event" = 'push' ]; then
            policy_sha='\${{ github.event.before }}'
            target_sha='\${{ github.sha }}'
            base_sha="$policy_sha"
          else
            emit_bootstrap_full
            exit 0
          fi

          if [[ ! "$policy_sha" =~ ^[0-9a-f]{40}$ ]] ||
             [[ ! "$target_sha" =~ ^[0-9a-f]{40}$ ]] ||
             [[ ! "$base_sha" =~ ^[0-9a-f]{40}$ ]] ||
             [[ "$policy_sha" =~ ^0{40}$ ]]; then
            emit_bootstrap_full
            exit 0
          fi

          classifier="$RUNNER_TEMP/qualification-impact.mjs"
          if ! git show "\${policy_sha}:scripts/ci/qualification-impact.mjs" > "$classifier"; then
            emit_bootstrap_full
            exit 0
          fi

          node "$classifier" classify \\
            --repo "$GITHUB_WORKSPACE" \\
            --base "$base_sha" \\
            --target "$target_sha" \\
            --format github-output >> "$GITHUB_OUTPUT"
      - name: Validate CI scope outputs
        env:
          CLASSIFICATION: \${{ steps.scope.outputs.classification }}
          BLOCKED: \${{ steps.scope.outputs.blocked }}
          DOCS: \${{ steps.scope.outputs.docs }}
          CHECKPOINT: \${{ steps.scope.outputs.checkpoint }}
          FOCUSED: \${{ steps.scope.outputs.focused }}
          QUICK: \${{ steps.scope.outputs.quick }}
          POLICY: \${{ steps.scope.outputs.policy }}
          UPDATER: \${{ steps.scope.outputs.updater }}
          ARTIFACT_REPLAY: \${{ steps.scope.outputs.artifact_replay }}
          TEST_MACOS: \${{ steps.scope.outputs.test_macos }}
          TEST_WINDOWS: \${{ steps.scope.outputs.test_windows }}
          TEST_LINUX: \${{ steps.scope.outputs.test_linux }}
          BUILD_MACOS: \${{ steps.scope.outputs.build_macos }}
          BUILD_WINDOWS: \${{ steps.scope.outputs.build_windows }}
          BUILD_LINUX: \${{ steps.scope.outputs.build_linux }}
          FULL: \${{ steps.scope.outputs.full }}
          PLAN_SHA256: \${{ steps.scope.outputs.plan_sha256 }}
          CLASSIFICATION_JSON: \${{ steps.scope.outputs.classification_json }}
        run: |
          for entry in "docs=$DOCS" "checkpoint=$CHECKPOINT" "focused=$FOCUSED" "quick=$QUICK" "policy=$POLICY" "updater=$UPDATER" "artifact_replay=$ARTIFACT_REPLAY" "test_macos=$TEST_MACOS" "test_windows=$TEST_WINDOWS" "test_linux=$TEST_LINUX" "build_macos=$BUILD_MACOS" "build_windows=$BUILD_WINDOWS" "build_linux=$BUILD_LINUX" "full=$FULL"; do
            value="\${entry#*=}"
            if [ "$value" != "true" ] && [ "$value" != "false" ]; then exit 1; fi
          done
          if [ "$BLOCKED" != "false" ]; then exit 1; fi
          if [[ ! "$PLAN_SHA256" =~ ^[0-9a-f]{64}$ ]]; then exit 1; fi
          node - "$CLASSIFICATION_JSON" "$PLAN_SHA256" "$CLASSIFICATION" <<'NODE'
          const [raw, planSha256, classification] = process.argv.slice(2)
          const plan = JSON.parse(raw)
          if (plan.classification !== classification) throw new Error('identity')
          if (plan.planSha256 !== undefined && plan.planSha256 !== planSha256) throw new Error('hash')
          NODE
  quick-pr-check:
    needs: ci-scope
    if: needs.ci-scope.outputs.quick == 'true'
  release-safety:
    steps:
      - run: node scripts/ci/verify-release-policy.mjs
      - run: node --test scripts/ci/__tests__/candidate-content-policy.test.mjs
      - run: node --test scripts/ci/__tests__/release-policy.test.mjs
      - run: node --test scripts/ci/__tests__/qualification-impact.test.mjs
      - run: node --test scripts/ci/__tests__/verify-qualification-artifacts.test.mjs
      - run: node --test scripts/updater/__tests__/updater.test.mjs
      - run: node --test scripts/release-distribution/__tests__/release-distribution.test.mjs
  base_branch_cov:
    needs: ci-scope
    if: needs.ci-scope.outputs.full == 'true'
  base_branch_rust_cov:
    needs: ci-scope
    if: needs.ci-scope.outputs.full == 'true'
  test-on-macos:
    needs: ci-scope
    if: needs.ci-scope.outputs.test_macos == 'true'
  test-on-windows:
    needs: ci-scope
    if: needs.ci-scope.outputs.test_windows == 'true'
  test-on-windows-pr:
    needs: ci-scope
    if: needs.ci-scope.outputs.test_windows == 'true'
    runs-on: windows-2022
    timeout-minutes: 90
    steps:
      - name: Build focused unsigned Windows candidate
        if: needs.ci-scope.outputs.build_windows == 'true'
        shell: pwsh
        run: |
          $releaseMetadata = Get-Content biyan-release.json -Raw |
            ConvertFrom-Json
          $env:BIYAN_DATA_SCHEMA = [string]$releaseMetadata.dataSchema
          make build
      - name: Verify focused unsigned Windows candidate
        if: needs.ci-scope.outputs.build_windows == 'true'
        shell: pwsh
        run: |
          & ./scripts/ci/verify-windows-candidate.ps1 -Exe $exe -Msi $msi -Version $version
          node ./scripts/ci/candidate-path-policy.mjs --root $bundle
  test-on-ubuntu:
    needs: ci-scope
    if: needs.ci-scope.outputs.test_linux == 'true'
  coverage-check:
    needs: [ci-scope, base_branch_cov, base_branch_rust_cov]
    if: needs.ci-scope.outputs.full == 'true'
    steps:
      - run: yarn test:coverage
  pr-ci-gate:
    needs: [ci-scope, quick-pr-check, release-safety, test-on-macos, test-on-windows-pr, test-on-ubuntu, coverage-check]
    env:
      QUICK: \${{ needs.ci-scope.outputs.quick }}
      TEST_MACOS: \${{ needs.ci-scope.outputs.test_macos }}
      TEST_WINDOWS: \${{ needs.ci-scope.outputs.test_windows }}
      TEST_LINUX: \${{ needs.ci-scope.outputs.test_linux }}
      FULL: \${{ needs.ci-scope.outputs.full }}
    steps:
      - run: |
          if [ "$QUICK" = true ]; then
            require_success "Fast PR check" "$FAST_RESULT"
          fi
          if [ "$TEST_MACOS" = true ]; then
            require_success "test-on-macos" "$MACOS_RESULT"
          fi
          if [ "$TEST_LINUX" = true ]; then
            require_success "test-on-ubuntu" "$UBUNTU_RESULT"
          fi
          if [ "$TEST_WINDOWS" = true ]; then
            require_success "test-on-windows-pr" "$WINDOWS_PR_RESULT"
          fi
          if [ "$FULL" = true ]; then
            require_success "coverage-check" "$COVERAGE_RESULT"
          fi
`
  const productionWorkflow = fs
    .readFileSync('.github/workflows/biyan-linter-and-test.yml', 'utf8')
    .replace(/\r\n?/g, '\n')
  const productionCiScope = productionWorkflow.match(
    /^  ci-scope:\s*$[\s\S]*?(?=^  [A-Za-z0-9_-]+:\s*$)/m
  )?.[0]
  assert.ok(productionCiScope)
  const workflow = [
    'name: Biyan CI contract fixture',
    'on: pull_request',
    'concurrency: biyan-ci-contract-fixture',
    syntheticWorkflow.replace(
      /^  ci-scope:\s*$[\s\S]*?(?=^  quick-pr-check:\s*$)/m,
      productionCiScope
    ),
  ].join('\n')
  assert.deepEqual(validateCiWorkflow(workflow), [])
  assert.deepEqual(
    validateCiWorkflow(withLineEndings(workflow, '\r\n')),
    []
  )
  assert.deepEqual(
    validateCiWorkflow(
      workflow.replace('\n  quick-pr-check:', '\n\n\n  quick-pr-check:')
    ),
    []
  )
  assert.ok(
    validateCiWorkflow(
      workflow.replace(
        '          set -euo pipefail',
        '          # Even comment-only job edits require a reviewed allowlist update.\n          set -euo pipefail'
      )
    ).some((failure) => failure.includes('execution-envelope allowlist'))
  )
  for (const envelopeMutation of [
    workflow.replace(
      '    runs-on: ubuntu-24.04',
      '    runs-on: ubuntu-24.04\n    env:\n      BASH_ENV: ./unreviewed.sh'
    ),
    workflow.replace(
      '        shell: bash\n        run: |\n          set -euo pipefail',
      '        shell: bash\n        env:\n          NODE_OPTIONS: --require=./unreviewed.cjs\n        run: |\n          set -euo pipefail'
    ),
    workflow.replace(
      '      - name: Detect changed files',
      '      - name: Unreviewed environment setup\n        run: echo ./bin >> "$GITHUB_PATH"\n\n      - name: Detect changed files'
    ),
    workflow.replace(
      '        shell: bash\n        run: |\n          set -euo pipefail',
      '        shell: ./unreviewed-shell {0}\n        run: |\n          set -euo pipefail'
    ),
    workflow.replace(
      '        shell: bash\n        run: |\n          set -euo pipefail',
      '        shell: bash\n        continue-on-error: true\n        run: |\n          set -euo pipefail'
    ),
    workflow.replace(
      '        shell: bash\n        run: |\n          set -euo pipefail',
      '        shell: bash\n        run: >\n          set -euo pipefail'
    ),
    workflow.replace('uses: actions/checkout@v4', 'uses: ./unreviewed-action'),
    workflow.replace('          NODE\n', '          NODE   \n'),
  ]) {
    assert.ok(
      validateCiWorkflow(envelopeMutation).some((failure) =>
        failure.includes('execution-envelope allowlist')
      )
    )
  }
  for (const inheritedMutation of [
    workflow.replace(
      'permissions:\n  contents: read',
      'permissions:\n  contents: read\nenv:\n  BASH_ENV: ./unreviewed.sh'
    ),
    workflow.replace(
      'permissions:\n  contents: read',
      'permissions:\n  contents: read\ndefaults:\n  run:\n    shell: ./unreviewed-shell {0}'
    ),
  ]) {
    assert.ok(
      validateCiWorkflow(inheritedMutation).some((failure) =>
        failure.includes('alter trusted job execution')
      )
    )
  }
  for (const permissionMutation of [
    workflow.replace(
      'permissions:\n  contents: read',
      'permissions:\n  contents: read\n  "actions": write'
    ),
    workflow.replace(
      'permissions:\n  contents: read',
      'permissions:\n  contents: read\n  ? actions\n  : write'
    ),
    workflow.replace(
      'permissions:\n  contents: read',
      'permissions:\n  contents: read\n  <<: { actions: write }'
    ),
  ]) {
    assert.ok(
      validateCiWorkflow(permissionMutation).some((failure) =>
        failure.includes('top-level permissions must be contents: read only')
      )
    )
  }
  for (const jobPermissionMutation of [
    productionWorkflow.replace(
      '    permissions:\n      contents: read',
      '    permissions:\n      contents: read\n      "actions": write'
    ),
    productionWorkflow.replace(
      '    permissions:\n      contents: read',
      '    "permissions": { contents: read, actions: write }'
    ),
  ]) {
    assert.ok(
      validateCiWorkflow(jobPermissionMutation).some(
        (failure) =>
          failure.includes('job permissions must be exactly contents: read') ||
          failure.includes('canonical unquoted field keys')
      )
    )
  }
  for (const noncanonicalTopLevel of [
    workflow.replace(
      'permissions:\n',
      '"\\u0065nv": { BASH_ENV: ./unreviewed.sh }\npermissions:\n'
    ),
    workflow.replace(
      'permissions:\n',
      '!!str env: { BASH_ENV: ./unreviewed.sh }\npermissions:\n'
    ),
    workflow.replace(
      'permissions:\n',
      '? env\n:\n  BASH_ENV: ./unreviewed.sh\npermissions:\n'
    ),
    workflow.replace(
      'permissions:\n',
      'x-unreviewed: &unreviewed { env: { BASH_ENV: ./unreviewed.sh } }\npermissions:\n'
    ),
  ]) {
    assert.ok(
      validateCiWorkflow(noncanonicalTopLevel).some((failure) =>
        failure.includes('canonical top-level key allowlist')
      )
    )
  }
  for (const duplicateControl of [
    workflow.replace(
      'permissions:\n  contents: read',
      'permissions:\n  contents: read\npermissions:\n  contents: write'
    ),
    workflow.replace(
      'jobs:\n',
      'jobs:\n  placeholder:\n    runs-on: ubuntu-latest\njobs:\n'
    ),
    workflow.replace(
      '\n  quick-pr-check:',
      '\n  ci-scope:\n    uses: ./unreviewed.yml\n\n  quick-pr-check:'
    ),
  ]) {
    assert.ok(
      validateCiWorkflow(duplicateControl).some((failure) =>
        failure.includes('exactly one')
      )
    )
  }
  for (const noncanonicalJobKey of [
    workflow.replace(
      '\n  quick-pr-check:',
      '\n  "ci\\u002dscope": { uses: ./unreviewed.yml }\n\n  quick-pr-check:'
    ),
    workflow.replace(
      '\n  quick-pr-check:',
      '\n  !!str ci-scope: { uses: ./unreviewed.yml }\n\n  quick-pr-check:'
    ),
    workflow.replace(
      '\n  quick-pr-check:',
      '\n  ? ci-scope\n  : { uses: ./unreviewed.yml }\n\n  quick-pr-check:'
    ),
  ]) {
    assert.ok(
      validateCiWorkflow(noncanonicalJobKey).some((failure) =>
        failure.includes('canonical unquoted job keys')
      )
    )
  }
  assert.ok(
    validateCiWorkflow(
      workflow.replace(
        '\n  quick-pr-check:',
        '\n  unreviewed-gate:\n    runs-on: ubuntu-latest\n\n  quick-pr-check:'
      )
    ).some((failure) => failure.includes('reviewed job-key allowlist'))
  )

  assert.ok(
    validateCiWorkflow(
      workflow.replace(
        'needs: [ci-scope, quick-pr-check, release-safety, test-on-macos, test-on-windows-pr, test-on-ubuntu, coverage-check]',
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
    'require_success "coverage-check" "$COVERAGE_RESULT"',
    'echo require_success "coverage-check" "$COVERAGE_RESULT"'
  )
  assert.ok(
    validateCiWorkflow(unenforcedCoverage).some((failure) =>
      failure.includes('must enforce coverage-check')
    )
  )

  for (const unsafeScope of [
    workflow.replace(
      'base_sha="$(git merge-base "$policy_sha" "$target_sha" || true)"',
      'base_sha="$(git merge-base "$policy_sha" "$target_sha")"'
    ),
    workflow.replace(
      '          base_sha="$(git merge-base "$policy_sha" "$target_sha" || true)"',
      [
        '          # base_sha="$(git merge-base "$policy_sha" "$target_sha" || true)"',
        '          base_sha="$(git merge-base "$policy_sha" "$target_sha")"',
      ].join('\n')
    ),
    workflow.replace(
      'git show "\${policy_sha}:scripts/ci/qualification-impact.mjs"',
      'echo git show "\${policy_sha}:scripts/ci/qualification-impact.mjs"'
    ),
    workflow.replace(
      'node "$classifier" classify',
      'echo node "$classifier" classify'
    ),
    workflow.replace(
      'node "$classifier" classify',
      '# node "$classifier" classify'
    ),
    workflow.replace(
      ':scripts/ci/qualification-impact.mjs',
      ':scripts/ci/qualification-impact-mutated.mjs'
    ),
    workflow.replace(
      '          node "$classifier" classify \\\n',
      [
        '          git show "\${target_sha}:scripts/ci/qualification-impact.mjs" > "$classifier"',
        '          node "$classifier" classify \\',
        '',
      ].join('\n')
    ),
    workflow.replace(
      '            --format github-output >> "$GITHUB_OUTPUT"\n',
      [
        '            --format github-output >> "$GITHUB_OUTPUT"',
        '          node scripts/ci/qualification-impact.mjs classify --repo . --base "$base_sha" --target "$target_sha" --format github-output >> "$GITHUB_OUTPUT"',
        '',
      ].join('\n')
    ),
    workflow.replace(
      '            base_sha="$(git merge-base "$policy_sha" "$target_sha" || true)"',
      [
        '            base_sha="$(git merge-base "$policy_sha" "$target_sha" || true)"',
        '            exit 0',
      ].join('\n')
    ),
    workflow.replace(
      "            target_sha='${{ github.event.pull_request.head.sha }}'",
      [
        "            target_sha='${{ github.event.pull_request.head.sha }}'",
        '            policy_sha="$target_sha"',
      ].join('\n')
    ),
    workflow.replace(
      "          event='${{ github.event_name }}'",
      ['          node() { :; }', "          event='${{ github.event_name }}'"].join(
        '\n'
      )
    ),
    workflow.replace(
      "          event='${{ github.event_name }}'",
      ['          exit 0', "          event='${{ github.event_name }}'"].join(
        '\n'
      )
    ),
    workflow.replace(
      '            base_sha="$(git merge-base "$policy_sha" "$target_sha" || true)"',
      [
        '            base_sha="$(git merge-base "$policy_sha" "$target_sha" || true)"',
        '            command node scripts/ci/qualification-impact.mjs classify --repo . --base "$policy_sha" --target "$target_sha" --format github-output >> "$GITHUB_OUTPUT"',
        '            exit 0',
      ].join('\n')
    ),
  ]) {
    assert.ok(
      validateCiWorkflow(unsafeScope).some((failure) =>
        failure.includes('trusted')
      )
    )
  }

  const missingInvalidIdentityFallback = workflow.replace(
    '            emit_bootstrap_full\n            exit 0\n          fi\n\n          classifier=',
    '            exit 1\n          fi\n\n          classifier='
  )
  assert.ok(
    validateCiWorkflow(missingInvalidIdentityFallback).some((failure) =>
      failure.includes('invalid commit identity')
    )
  )
  for (const [needle, replacement] of [
    ['! "$policy_sha" =~ ^[0-9a-f]{40}$', '! "$other_sha" =~ ^[0-9a-f]{40}$'],
    ['! "$target_sha" =~ ^[0-9a-f]{40}$', '! "$other_sha" =~ ^[0-9a-f]{40}$'],
    ['! "$base_sha" =~ ^[0-9a-f]{40}$', '! "$other_sha" =~ ^[0-9a-f]{40}$'],
    ['"$policy_sha" =~ ^0{40}$', '"$policy_sha" =~ ^0+$'],
  ]) {
    const missingExactIdentityCheck = workflow.replace(needle, replacement)
    assert.ok(
      validateCiWorkflow(missingExactIdentityCheck).some((failure) =>
        failure.includes('invalid commit identity')
      ),
      needle
    )
  }
  for (const invalidFallbackMutation of [
    workflow.replace(
      '            emit_bootstrap_full\n            exit 0\n          fi\n\n          classifier=',
      '            exit 0\n            emit_bootstrap_full\n          fi\n\n          classifier='
    ),
    workflow.replace(
      '            emit_bootstrap_full\n            exit 0\n          fi\n\n          classifier=',
      '            exit 0\n            emit_bootstrap_full\n            exit 0\n          fi\n\n          classifier='
    ),
    workflow.replace(
      '            emit_bootstrap_full\n            exit 0\n          fi\n\n          classifier=',
      '            false\n            emit_bootstrap_full\n            exit 0\n          fi\n\n          classifier='
    ),
    workflow.replace(
      '          if [[ ! "$policy_sha" =~ ^[0-9a-f]{40}$ ]] ||',
      '          if [[ ! "$policy_sha" =~ ^[0-9a-f]{40}$ ]] &&'
    ),
    workflow.replace(
      '          if [[ ! "$policy_sha" =~ ^[0-9a-f]{40}$ ]] ||',
      '          exit 0\n          if [[ ! "$policy_sha" =~ ^[0-9a-f]{40}$ ]] ||'
    ),
    workflow.replace(
      '          fi\n\n          classifier="$RUNNER_TEMP/qualification-impact.mjs"',
      '          fi\n\n          false\n          classifier="$RUNNER_TEMP/qualification-impact.mjs"'
    ),
    workflow.replace(
      '             [[ ! "$base_sha" =~ ^[0-9a-f]{40}$ ]] ||',
      '             # [[ ! "$base_sha" =~ ^[0-9a-f]{40}$ ]] ||'
    ),
  ]) {
    assert.ok(
      validateCiWorkflow(invalidFallbackMutation).some((failure) =>
        failure.includes('invalid commit identity')
      )
    )
  }

  const missingAxis = workflow.replace(
    '      test_macos: \${{ steps.scope.outputs.test_macos }}\n',
    ''
  )
  assert.ok(
    validateCiWorkflow(missingAxis).some((failure) =>
      failure.includes('test_macos impact axis')
    )
  )

  const hiddenWindowsBuildAxis = workflow.replace(
    '      build_windows: \${{ steps.scope.outputs.build_windows }}\n',
    ''
  )
  assert.ok(
    validateCiWorkflow(hiddenWindowsBuildAxis).some((failure) =>
      failure.includes('expose build_windows')
    )
  )

  const incompleteFallback = workflow.replace(
    "              echo 'test_macos=true'\n",
    ''
  )

  const missingBooleanValidation = workflow.replace(
    '"test_macos=$TEST_MACOS" ',
    ''
  )
  assert.ok(
    validateCiWorkflow(missingBooleanValidation).some((failure) =>
      failure.includes('validate test_macos')
    )
  )

  const missingJsonAuthentication = workflow.replace(
    'const plan = JSON.parse(raw)',
    'const plan = { classification }'
  )
  assert.ok(
    validateCiWorkflow(missingJsonAuthentication).some((failure) =>
      failure.includes('classification JSON')
    )
  )
  assert.ok(
    validateCiWorkflow(incompleteFallback).some((failure) =>
      failure.includes('fail closed to full axes')
    )
  )

  const platformForcedFull = workflow.replace(
    "if: needs.ci-scope.outputs.test_macos == 'true'",
    "if: needs.ci-scope.outputs.full == 'true'"
  )
  assert.ok(
    validateCiWorkflow(platformForcedFull).some((failure) =>
      failure.includes('test-on-macos must be gated')
    )
  )

  for (const [index, focusedWindowsMutation] of [
    workflow.replace('    timeout-minutes: 90', '    timeout-minutes: 45'),
    workflow.replace(
      "        if: needs.ci-scope.outputs.build_windows == 'true'",
      "        if: needs.ci-scope.outputs.build_windows == 'false'"
    ),
    workflow.replace('          make build', '          Write-Output make build'),
    workflow.replace(
      '          $env:BIYAN_DATA_SCHEMA = [string]$releaseMetadata.dataSchema',
      '          Write-Output $env:BIYAN_DATA_SCHEMA = [string]$releaseMetadata.dataSchema'
    ),
    workflow.replace(
      '      - name: Build focused unsigned Windows candidate\n',
      '      - name: Build focused unsigned Windows candidate\n        continue-on-error: true\n'
    ),
    workflow.replace(
      '          & ./scripts/ci/verify-windows-candidate.ps1',
      '          Write-Output ./scripts/ci/verify-windows-candidate.ps1'
    ),
    workflow.replace(
      '          & ./scripts/ci/verify-windows-candidate.ps1 -Exe $exe -Msi $msi -Version $version',
      "          $fakeVerifier = 'verify-windows-candidate.ps1 -Exe $exe -Msi $msi -Version $version'"
    ),
    workflow.replace(
      '          node ./scripts/ci/candidate-path-policy.mjs --root $bundle',
      '          Write-Output ./scripts/ci/candidate-path-policy.mjs --root $bundle'
    ),
    workflow.replace(
      '          node ./scripts/ci/candidate-path-policy.mjs --root $bundle',
      "          $fakePolicy = 'candidate-path-policy.mjs --root $bundle'"
    ),
  ].entries()) {
    assert.ok(
      validateCiWorkflow(focusedWindowsMutation).some((failure) =>
        failure.includes('focused unsigned candidate')
      ),
      `focused Windows mutation ${index} must fail closed`
    )
  }

  for (const command of [
    'node --test scripts/ci/__tests__/qualification-impact.test.mjs',
    'node --test scripts/ci/__tests__/verify-qualification-artifacts.test.mjs',
    'node --test scripts/release-distribution/__tests__/release-distribution.test.mjs',
  ]) {
    const echoedContract = workflow.replace(command, `echo ${command}`)
    assert.ok(
      validateCiWorkflow(echoedContract).some((failure) =>
        failure.includes(`does not run: ${command}`)
      )
    )
    const commentedContract = workflow.replace(command, `# ${command}`)
    assert.ok(
      validateCiWorkflow(commentedContract).some((failure) =>
        failure.includes(`does not run: ${command}`)
      )
    )
  }
})

test('PR CI is read-only and CI control paths require owner review', () => {
  const workflow = fs.readFileSync(
    '.github/workflows/biyan-linter-and-test.yml',
    'utf8'
  ).replace(/\r\n?/g, '\n')
  assert.deepEqual(validateCiWorkflow(workflow), [])
  assert.ok(
    validateCiWorkflow(
      workflow.replace('permissions:\n  contents: read', 'permissions:\n  contents: write')
    ).some((failure) => failure.includes('contents: read only'))
  )
  assert.ok(
    validateCiWorkflow(
      workflow.replace('persist-credentials: false', 'persist-credentials: true')
    ).some((failure) => failure.includes('credential persistence'))
  )
  assert.ok(
    validateCiWorkflow(
      workflow.replace(
        '    permissions:\n      contents: read',
        '    permissions:\n      contents: read\n      pull-requests: write'
      )
    ).some((failure) => failure.includes('write permissions'))
  )

  const codeowners = fs.readFileSync('.github/CODEOWNERS', 'utf8')
  assert.deepEqual(validateCiControlOwnership(codeowners), [])
  for (const owner of ['@realerikk0', '@twokar']) {
    assert.ok(
      validateCiControlOwnership(
        codeowners.replace(`/.github/ @realerikk0 @twokar`, `/.github/ ${owner}`)
      ).some(
        (failure) => failure.includes('/.github/') && !failure.endsWith(owner)
      )
    )
  }
})

test('protected Windows verifier authenticates native EXE and MSI identity', () => {
  const verifier = fs.readFileSync(
    'scripts/ci/verify-windows-candidate.ps1',
    'utf8'
  ).replace(/\r\n?/g, '\n')
  assert.deepEqual(validateWindowsCandidateVerifier(verifier), [])
  for (const [index, mutation] of [
    verifier.replaceAll('0x8664', '0x014C'),
    verifier.replace("'Biyan.exe'", "'Other.exe'"),
    verifier.replace('OpenDatabase', 'OpenData'),
    verifier.replace("'/a'", "'/i'"),
    verifier.replace(
      'TARGETDIR=`"$msiExtractRoot`"',
      'INSTALLDIR=`"$msiExtractRoot`"'
    ),
    verifier.replace('$msiExitCode -ne 0', '$msiExitCode -eq 0'),
    verifier.replace('    -Wait `\n', ''),
    verifier.replace('    -PassThru\n', ''),
    verifier.replace(
      '  $msiProcess = Start-Process `',
      '  Write-Output Start-Process `'
    ),
    verifier
      .replace(
        '  $msiProcess = Start-Process `',
        '  $msiExitCode = $msiProcess.ExitCode\n  $msiProcess = Start-Process `'
      )
      .replace(
        '  $msiExitCode = $msiProcess.ExitCode\n  $msiProcess.Dispose()',
        '  $msiProcess.Dispose()'
      ),
    verifier.replace(
      '  $msiProcess = Start-Process `',
      '  $msiProcess = Start-Process `\n' +
        '  $msiProcess = Write-Output decoy\n' +
        '  $decoy = Start-Process `'
    ),
    verifier.replace(
      '  $msiExitCode = $msiProcess.ExitCode',
      '  $msiExitCode = $LASTEXITCODE'
    ),
    verifier.replace(
      '  $msiProcess = Start-Process `',
      '  & $msiExec @msiArguments\n  $msiProcess = Start-Process `'
    ),
    verifier.replace(
      'catch {\n  Write-MsiLogTail -Path $msiLogPath\n  throw\n}',
      'catch {\n  throw\n}'
    ),
    verifier.replace(
      '  $msiExitCode = $msiProcess.ExitCode\n  $msiProcess.Dispose()\n',
      '  $msiProcess.Dispose()\n'
    ),
    verifier.replace(
      '-LiteralPath $msiExtractRoot `\n    -Recurse',
      '-LiteralPath $msiExtractRoot `'
    ),
    verifier.replace(
      '-LiteralPath $msiLogPath `\n    -Force',
      '-LiteralPath $msiLogPath `'
    ),
    verifier.replace(
      'try {\n  $msiExec =',
      "try {\n  & $sevenZip `\n    'x' `\n    $msiPath\n  $msiExec ="
    ),
    verifier.replace("'ProductVersion'", "'OtherVersion'"),
    verifier.replace('SummaryInformation(0)', 'SummaryInformation(1)'),
    verifier.replace('(?i:x64|Intel64)', '(?i:Intel)'),
  ].entries()) {
    assert.notDeepEqual(
      validateWindowsCandidateVerifier(mutation),
      [],
      `Windows verifier mutation ${index} must fail closed`
    )
  }
})

test('protected macOS verifier authenticates the mounted DMG app bytes', () => {
  const verifier = fs.readFileSync('scripts/verify-macos-candidate.mjs', 'utf8')
  assert.deepEqual(validateMacOSCandidateVerifier(verifier), [])
  for (const mutation of [
    verifier.replace("runCommand('hdiutil', ['verify'", "runCommand('echo', ['verify'"),
    verifier.replace("'attach',", "'inspect',"),
    verifier.replace('bundleSnapshot(mountedApp)', 'bundleSnapshot(appPath)'),
    verifier.replace("runCommand('hdiutil', ['detach'", "runCommand('echo', ['detach'"),
  ]) {
    assert.notDeepEqual(validateMacOSCandidateVerifier(mutation), [])
  }
})

const qualificationWorkflow = `name: Exact SHA qualification
on:
  workflow_dispatch:
    inputs:
      target_ref:
        required: true
      target_sha:
        required: true
      base_sha:
        required: true
      bootstrap_full:
        required: true
permissions:
  contents: read
  actions: read
jobs:
  preflight:
    if: github.ref == 'refs/heads/mita-main'
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.sha }}
          path: harness
      - uses: actions/checkout@v4
        with:
          ref: \${{ inputs.target_sha }}
          path: target
      - run: |
          TARGET="\${{ inputs.target_sha }}"
          BASE="\${{ inputs.base_sha }}"
          [[ "$TARGET" =~ ^[0-9a-f]{40}$ ]]
          [[ "$BASE" =~ ^[0-9a-f]{40}$ ]]
          test "$(git -C target rev-parse HEAD)" = "$TARGET"
          git -C harness merge-base --is-ancestor "$BASE" "$TARGET"
          if [ "\${{ inputs.bootstrap_full }}" = true ]; then
            bootstrap_full=--force-full
          fi
          node harness/scripts/ci/qualification-impact.mjs classify --repo harness --base "$BASE" --target "$TARGET" $bootstrap_full --format github-output
      - working-directory: harness
        run: node --test scripts/ci/__tests__/qualification-impact.test.mjs scripts/ci/__tests__/release-policy.test.mjs scripts/ci/__tests__/verify-qualification-artifacts.test.mjs
      - if: steps.classification.outputs.policy == 'true'
        working-directory: target
        run: |
          node scripts/ci/verify-release-policy.mjs
          node --test scripts/ci/__tests__/release-policy.test.mjs
      - if: steps.classification.outputs.updater == 'true'
        working-directory: target
        run: node --test scripts/updater/__tests__/updater.test.mjs
      - working-directory: target
        run: |
          test_file="scripts/release-distribution/__tests__/release-distribution.test.mjs"
          node --test "$test_file"
  docs-build:
    runs-on: ubuntu-24.04
    needs: preflight
  artifact-replay:
    runs-on: ubuntu-24.04
    needs: preflight
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ needs.preflight.outputs.workflow_sha }}
          path: harness
      - uses: actions/download-artifact@v4
        with:
          repository: \${{ github.repository }}
          run-id: \${{ needs.preflight.outputs.replay_run_id }}
          name: qualification-manifest-\${{ needs.preflight.outputs.replay_run_id }}
      - run: node harness/scripts/ci/verify-qualification-artifacts.mjs verify --root replay --manifest replay/manifest.json --manifest-sha256 "$MANIFEST_SHA" --target-sha "$BASE" --base-sha "$REPLAY_BASE" --run-id "$REPLAY_RUN"
  native-linux:
    runs-on: ubuntu-24.04
    needs: [preflight, artifact-replay]
    if: needs.preflight.outputs.test_linux == 'true' || needs.preflight.outputs.build_linux == 'true'
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ needs.preflight.outputs.workflow_sha }}
          path: harness
      - uses: jlumbroso/free-disk-space@54081f138730dfa15788a46383842cd2f914a1be
        with:
          tool-cache: false
          android: true
          dotnet: true
          haskell: true
          large-packages: true
          docker-images: true
          swap-storage: true
      - shell: bash
        run: |
          available_kib="$(df -Pk / | awk 'NR == 2 { print $4 }')"
          if ! [[ "$available_kib" =~ ^[0-9]+$ ]]; then
            exit 1
          fi
          minimum_kib=$((40 * 1024 * 1024))
          if [ "$available_kib" -lt "$minimum_kib" ]; then
            exit 1
          fi
      - working-directory: target
        run: node ../harness/scripts/ci/candidate-path-policy.mjs --root "$bundle"
  native-windows:
    runs-on: windows-2022
    needs: [preflight, artifact-replay]
    if: needs.preflight.outputs.test_windows == 'true' || needs.preflight.outputs.build_windows == 'true'
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ needs.preflight.outputs.workflow_sha }}
          path: harness
      - run: |
          & ./harness/scripts/ci/verify-windows-candidate.ps1 -Exe "$EXE" -Msi "$MSI" -Version "$VERSION"
          node ./harness/scripts/ci/candidate-path-policy.mjs --root $bundle
  native-macos:
    runs-on: macos-15-intel
    needs: [preflight, artifact-replay]
    if: needs.preflight.outputs.test_macos == 'true' || needs.preflight.outputs.build_macos == 'true'
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ needs.preflight.outputs.workflow_sha }}
          path: harness
      - run: |
          node harness/scripts/verify-macos-candidate.mjs \
            --repo-root target \
            --app target/src-tauri/target/release/bundle/macos/Biyan.app \
            --dmg target/src-tauri/target/release/bundle/dmg/Biyan_0.6.640_universal.dmg \
            --version "$VERSION" \
            --signature ad-hoc
  aggregate-artifacts:
    runs-on: ubuntu-24.04
    needs: [preflight, native-linux, native-windows, native-macos]
  qualification-gate:
    if: \${{ always() }}
    runs-on: ubuntu-24.04
    needs: [preflight, docs-build, artifact-replay, native-linux, native-windows, native-macos, aggregate-artifacts]
    steps:
      - run: |
          require_result() { test "$2" = success; }
          require_result preflight "$PREFLIGHT_RESULT"
          expect_result docs-build "$DOCS_REQUIRED" "$DOCS_RESULT"
          expect_result artifact-replay "$REPLAY_REQUIRED" "$REPLAY_RESULT"
          expect_result native-linux "$LINUX_REQUIRED" "$LINUX_RESULT"
          expect_result native-windows "$WINDOWS_REQUIRED" "$WINDOWS_RESULT"
          expect_result native-macos "$MACOS_REQUIRED" "$MACOS_RESULT"
          expect_result aggregate-artifacts "$AGGREGATE_REQUIRED" "$AGGREGATE_RESULT"
`

test('exact-SHA qualification keeps the harness trusted and has no production authority', () => {
  assert.deepEqual(validateQualificationWorkflow(qualificationWorkflow), [])

  for (const [index, mutation] of [
    qualificationWorkflow.replace('  workflow_dispatch:', '  push:'),
    qualificationWorkflow.replace(
      '  workflow_dispatch:',
      '  workflow_dispatch:\n  push: {}'
    ),
    qualificationWorkflow.replace(
      'refs/heads/mita-main',
      'refs/heads/release/test'
    ),
    qualificationWorkflow.replace('  contents: read', '  contents: write'),
    qualificationWorkflow.replace(
      '  actions: read',
      '  actions: read\n  id-token: read'
    ),
    qualificationWorkflow.replace(
      'runs-on: windows-2022',
      'runs-on: windows-latest'
    ),
    qualificationWorkflow.replace(
      'runs-on: macos-15-intel',
      'runs-on: macos-latest'
    ),
    qualificationWorkflow.replace(
      'ref: \${{ github.sha }}',
      'ref: \${{ inputs.target_sha }}'
    ),
    qualificationWorkflow.replace(
      'ref: \${{ inputs.target_sha }}',
      'ref: \${{ inputs.base_sha }}'
    ),
    qualificationWorkflow.replace(
      'test "$(git -C target rev-parse HEAD)" = "$TARGET"',
      'echo test "$(git -C target rev-parse HEAD)" = "$TARGET"'
    ),
    qualificationWorkflow.replace(
      'git -C harness merge-base --is-ancestor',
      'echo git -C harness merge-base --is-ancestor'
    ),
    qualificationWorkflow.replace(
      'node harness/scripts/ci/qualification-impact.mjs classify',
      'echo node harness/scripts/ci/qualification-impact.mjs classify'
    ),
    qualificationWorkflow.replace(
      'node harness/scripts/ci/qualification-impact.mjs classify',
      '# node harness/scripts/ci/qualification-impact.mjs classify'
    ),
    qualificationWorkflow.replace(
      'if [ "\${{ inputs.bootstrap_full }}" = true ]; then',
      'if true; then'
    ),
    qualificationWorkflow.replace('$bootstrap_full --format', '--format'),
    qualificationWorkflow.replace(
      'node harness/scripts/ci/verify-qualification-artifacts.mjs verify',
      'echo node harness/scripts/ci/verify-qualification-artifacts.mjs verify'
    ),
    qualificationWorkflow.replace(
      'node harness/scripts/ci/verify-qualification-artifacts.mjs verify',
      '# node harness/scripts/ci/verify-qualification-artifacts.mjs verify'
    ),
    qualificationWorkflow.replace(
      '--manifest-sha256 "$MANIFEST_SHA"',
      '--manifest-sha "$MANIFEST_SHA"'
    ),
    qualificationWorkflow.replace(
      'needs: [preflight, artifact-replay]',
      'needs: artifact-replay'
    ),
    qualificationWorkflow.replace(
      'repository: \${{ github.repository }}',
      'repository: attacker/fork'
    ),
    qualificationWorkflow.replace(
      'name: qualification-manifest-\${{ needs.preflight.outputs.replay_run_id }}',
      'pattern: qualification-*'
    ),
    qualificationWorkflow.replace(
      'ref: \${{ needs.preflight.outputs.workflow_sha }}',
      'ref: \${{ needs.preflight.outputs.target_sha }}'
    ),
    qualificationWorkflow.replace(
      "needs.preflight.outputs.build_macos == 'true'",
      "needs.preflight.outputs.test_macos == 'true'"
    ),
    qualificationWorkflow.replace(
      'node harness/scripts/verify-macos-candidate.mjs',
      'echo node harness/scripts/verify-macos-candidate.mjs'
    ),
    qualificationWorkflow.replace(
      'node ../harness/scripts/ci/candidate-path-policy.mjs --root "$bundle"',
      'echo skipped-linux-retired-runtime-scan'
    ),
    qualificationWorkflow.replace(
      'node ./harness/scripts/ci/candidate-path-policy.mjs --root $bundle',
      'Write-Output skipped-windows-retired-runtime-scan'
    ),
    qualificationWorkflow.replace(
      'jlumbroso/free-disk-space@54081f138730dfa15788a46383842cd2f914a1be',
      'jlumbroso/free-disk-space@v1.3.1'
    ),
    qualificationWorkflow.replace(
      '      - uses: jlumbroso/free-disk-space',
      '      - if: ${{ false }}\n        uses: jlumbroso/free-disk-space'
    ),
    qualificationWorkflow.replace('tool-cache: false', 'tool-cache: true'),
    qualificationWorkflow.replace(
      '        with:\n          tool-cache: false',
      '        env:\n          tool-cache: false'
    ),
    qualificationWorkflow.replace(
      'available_kib="$(df -Pk / | awk \'NR == 2 { print $4 }\')"',
      'available_kib=999999999'
    ),
    qualificationWorkflow.replace(
      '      - shell: bash\n        run: |\n          available_kib=',
      '      - continue-on-error: true\n        shell: bash\n        run: |\n          available_kib='
    ),
    qualificationWorkflow.replace(
      '      - shell: bash\n        run: |\n          available_kib=',
      '      - continue-on-error: ${{ true }}\n        shell: bash\n        run: |\n          available_kib='
    ),
    qualificationWorkflow.replace(
      '      - shell: bash\n        run: |\n          available_kib=',
      '      - if: ${{ false }}\n        shell: bash\n        run: |\n          available_kib='
    ),
    qualificationWorkflow.replace(
      '      - shell: bash\n        run: |\n          available_kib=',
      '      - run: |\n          available_kib='
    ),
    qualificationWorkflow.replace(
      'minimum_kib=$((40 * 1024 * 1024))',
      'minimum_kib=$((4 * 1024 * 1024))'
    ),
    qualificationWorkflow.replace(
      'if [ "$available_kib" -lt "$minimum_kib" ]; then\n            exit 1',
      'if [ "$available_kib" -lt "$minimum_kib" ]; then\n            echo ignored'
    ),
    qualificationWorkflow.replace(
      'node ../harness/scripts/ci/candidate-path-policy.mjs --root "$bundle"',
      'node ../harness/scripts/ci/candidate-path-policy.mjs --root "$bundle" --runtime-only'
    ),
    qualificationWorkflow.replace(
      'node ./harness/scripts/ci/candidate-path-policy.mjs --root $bundle',
      'node ./harness/scripts/ci/candidate-path-policy.mjs --root $bundle --runtime-only'
    ),
    qualificationWorkflow.replace(
      'node ../harness/scripts/ci/candidate-path-policy.mjs --root "$bundle"',
      `node ../harness/scripts/ci/candidate-path-policy.mjs --root "$bundle"
          find bundle -type f | grep -Ei '(llama|mlx|foundation|rag|vector)'`
    ),
    qualificationWorkflow.replace(
      'node ./harness/scripts/ci/candidate-path-policy.mjs --root $bundle',
      `node ./harness/scripts/ci/candidate-path-policy.mjs --root $bundle
          if ($path -match '(?i)(llama|mlx|foundation|rag|vector)') {
            throw "retired runtime"
          }`
    ),
    qualificationWorkflow.replace(
      '& ./harness/scripts/ci/verify-windows-candidate.ps1',
      'Write-Output ./harness/scripts/ci/verify-windows-candidate.ps1'
    ),
    qualificationWorkflow.replace(
      'if: \${{ always() }}',
      'if: \${{ success() }}'
    ),
    qualificationWorkflow.replace(
      'require_result preflight',
      'echo require_result preflight'
    ),
    qualificationWorkflow.replace(
      'expect_result native-macos',
      'echo expect_result native-macos'
    ),
    qualificationWorkflow.replace(
      'permissions:\n',
      'environment: production\npermissions:\n'
    ),
    qualificationWorkflow.replace(
      'permissions:\n',
      'secrets: inherit\npermissions:\n'
    ),
    `${qualificationWorkflow}\n  deploy:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: gh release create v1\n`,
    `${qualificationWorkflow}\n  upload:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: curl -T artifact https://example.com/upload\n`,
    `${qualificationWorkflow}\n  upload:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: curl --data-binary @artifact https://example.com/upload\n`,
  ].entries()) {
    assert.notDeepEqual(
      validateQualificationWorkflow(mutation),
      [],
      `qualification mutation ${index} must fail`
    )
  }
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
