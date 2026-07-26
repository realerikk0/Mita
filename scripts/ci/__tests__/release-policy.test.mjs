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
  validateCandidateRecoveryWorkflow,
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

const candidateReleasePin = `      - env:
          EXPECTED_MAIN: \${{ needs.preflight.outputs.trusted_main_commit }}
          EXPECTED_SOURCE: \${{ needs.preflight.outputs.source_commit }}
          RELEASE_TAG: \${{ needs.preflight.outputs.tag }}
        run: |
          live_main="$(git ls-remote --exit-code origin refs/heads/mita-main | awk 'NF == 2 { print $1 }')"
          tag_refs="$(git ls-remote --exit-code origin \\
            "refs/tags/$RELEASE_TAG" "refs/tags/$RELEASE_TAG^{}")"
          live_tag="$(printf '%s\\n' "$tag_refs" | awk -v tag="refs/tags/$RELEASE_TAG" '
            $2 == tag { direct = $1 }
            $2 == tag "^{}" { peeled = $1 }
            END { print (peeled != "" ? peeled : direct) }
          ')"
          if [[ ! "$live_main" =~ ^[0-9a-f]{40}$ ]] || [ "$live_main" != "$EXPECTED_MAIN" ]; then exit 1; fi
          if [[ ! "$live_tag" =~ ^[0-9a-f]{40}$ ]] || [ "$live_tag" != "$EXPECTED_SOURCE" ]; then exit 1; fi
`

const candidateWorkflow = `permissions:
  contents: read
concurrency:
  group: desktop-candidate-\${{ github.event.inputs.version || github.ref_name }}
  cancel-in-progress: false
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
      - id: release
        env:
          EVENT_NAME: \${{ github.event_name }}
          WORKFLOW_REF: \${{ github.ref }}
        run: |
          if [ "$EVENT_NAME" = "workflow_dispatch" ] && [ "$WORKFLOW_REF" != "refs/heads/mita-main" ]; then exit 1; fi
          checkout_head="$(git -C harness rev-parse HEAD)"
          live_main="$(git -C harness rev-parse refs/remotes/origin/mita-main)"
          if [ "$checkout_head" != "$live_main" ]; then exit 1; fi
          echo "trusted_main_commit=$live_main"
      - run: git -C harness merge-base --is-ancestor "$source_commit" refs/remotes/origin/mita-main
      - env:
          RELEASE_TAG: \${{ steps.release.outputs.tag }}
          SOURCE_COMMIT: \${{ steps.release.outputs.source_commit }}
          TRUSTED_MAIN: \${{ steps.release.outputs.trusted_main_commit }}
        run: |
          node harness/scripts/ci/verify-release-target.mjs \
            --harness-root harness \
            --release-tag "$RELEASE_TAG" \
            --target-root target \
            --source-commit "$SOURCE_COMMIT" \
            --trusted-main "$TRUSTED_MAIN"
      - working-directory: harness
        run: |
          node --test scripts/ci/__tests__/release-policy.test.mjs
          node --test scripts/ci/__tests__/verify-release-target.test.mjs
  quality-gate:
    needs: preflight
    steps:
      - run: make test
      - run: node --test scripts/updater/__tests__/updater.test.mjs
  build-macos:
    needs: [preflight, quality-gate]
    environment: release-distribution
    steps:
${candidateReleasePin}
      - run: make build
      - uses: actions/checkout@v4
        with:
          ref: \${{ needs.preflight.outputs.trusted_main_commit }}
          path: harness
          persist-credentials: false
      - run: node harness/scripts/verify-macos-candidate.mjs --repo-root . --app Biyan.app --dmg Biyan.dmg --version 0.6.643 --signature production
${candidateReleasePin}
      - run: xcrun notarytool submit Biyan.dmg
${candidateReleasePin}
      - uses: actions/upload-artifact@v4
  build-windows:
    needs:
      - preflight
      - quality-gate
    environment: release-distribution
    steps:
${candidateReleasePin}
      - run: make build
      - uses: actions/checkout@v4
        with:
          ref: \${{ needs.preflight.outputs.trusted_main_commit }}
          path: harness
          persist-credentials: false
      - run: |
          node harness/scripts/ci/candidate-path-policy.mjs --root src-tauri/target/release/bundle
          & ./harness/scripts/ci/verify-windows-candidate.ps1 -Exe Biyan.exe -Msi Biyan.msi -Version 0.6.643
${candidateReleasePin}
      - uses: actions/upload-artifact@v4
  build-linux:
    needs: [preflight, quality-gate]
    environment: release-distribution
    steps:
${candidateReleasePin}
      - run: make build
      - uses: actions/checkout@v4
        with:
          ref: \${{ needs.preflight.outputs.trusted_main_commit }}
          path: harness
          persist-credentials: false
      - run: |
          node harness/scripts/ci/candidate-path-policy.mjs --root src-tauri/target/release/bundle
          node harness/scripts/ci/candidate-content-policy.mjs --root src-tauri/target/release/bundle
${candidateReleasePin}
      - uses: actions/upload-artifact@v4
  package-candidate:
    needs: [preflight, build-macos, build-windows, build-linux]
    environment: release-distribution
    permissions:
      actions: read
      contents: read
    outputs:
      updater_artifact_id: \${{ steps.updater.outputs.artifact-id }}
      updater_artifact_digest: \${{ steps.updater-metadata.outputs.artifact_digest }}
      updater_artifact_size: \${{ steps.updater-metadata.outputs.artifact_size }}
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ needs.preflight.outputs.trusted_main_commit }}
          persist-credentials: false
      - name: Install locked Tauri signer
        run: |
          corepack enable
          corepack prepare yarn@4.5.3 --activate
          yarn install --immutable --mode=skip-build
      - name: Download signed candidates
        uses: actions/download-artifact@v4
        with:
          path: dist/builds
      - name: Build canonical candidate manifest
        run: node scripts/updater/build-candidate.mjs
      - name: Sign canonical candidate manifest
        env:
          TAURI_SIGNING_PRIVATE_KEY: \${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: \${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        run: |
          yarn tauri signer sign \\
            --private-key "$TAURI_SIGNING_PRIVATE_KEY" \\
            --password "$TAURI_SIGNING_PRIVATE_KEY_PASSWORD" \\
            dist/updater-candidate/candidate.json
      - name: Verify signed candidate and write hashes
        env:
          TAG: \${{ needs.preflight.outputs.tag }}
        run: |
          node scripts/updater/verify-candidate.mjs \\
            dist/updater-candidate \\
            "$TAG"
          sha256sum Biyan* candidate.json candidate.json.sig latest.json > SHA256SUMS
${candidateReleasePin}
      - name: Upload updater candidate
        id: updater
        uses: actions/upload-artifact@v4
      - name: Authenticate uploaded updater artifact
        id: updater-metadata
        env:
          ACTION_ARTIFACT_DIGEST: \${{ steps.updater.outputs.artifact-digest }}
          ARTIFACT_ID: \${{ steps.updater.outputs.artifact-id }}
        run: |
          [[ "$ACTION_ARTIFACT_DIGEST" =~ ^[0-9a-f]{64}$ ]]
          artifact_digest="sha256:$ACTION_ARTIFACT_DIGEST"
          jq -e '
            .digest == $digest
            and .workflow_run.id == $run_id
            and .workflow_run.head_sha == $head
          ' updater-artifact.json
          echo "artifact_digest=$artifact_digest" >>"$GITHUB_OUTPUT"
          echo "artifact_size=$artifact_size" >>"$GITHUB_OUTPUT"
  draft-release:
    needs: [preflight, build-macos, build-windows, build-linux, package-candidate]
    permissions:
      actions: read
      contents: write
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ needs.preflight.outputs.trusted_main_commit }}
          persist-credentials: false
      - name: Download exact updater archive by authenticated ID
        env:
          ARTIFACT_ID: \${{ needs.package-candidate.outputs.updater_artifact_id }}
          ARTIFACT_DIGEST: \${{ needs.package-candidate.outputs.updater_artifact_digest }}
          ARTIFACT_SIZE: \${{ needs.package-candidate.outputs.updater_artifact_size }}
        run: |
          gh api "repos/$GITHUB_REPOSITORY/actions/artifacts/$ARTIFACT_ID/zip"
          test "$(stat -c '%s' updater.zip)" = "$ARTIFACT_SIZE"
          if [ "$actual_digest" != "$ARTIFACT_DIGEST" ]; then exit 1; fi
      - name: Extract exact updater candidate
        run: |
          python3 scripts/ci/extract-release-candidate-recovery.py \\
            --updater-archive dist/recovered-updater/updater.zip \\
            --output-dir "dist/biyan-updater-candidate-$VERSION" \\
            --version "$VERSION"
      - name: Require a fresh draft release slot
        run: |
          gh api \\
            --paginate \\
            --slurp \\
            "repos/$GITHUB_REPOSITORY/releases?per_page=100" \\
            >"$RUNNER_TEMP/existing-release-pages.json"
          jq -e '[.[][] | select(.tag_name == $tag)] | length == 0' existing-release-pages.json
${candidateReleasePin}
      - name: Atomically create an empty Draft
        run: |
          jq -n '{
            tag_name: $tag,
            target_commitish: $target,
            name: $name,
            draft: true,
            prerelease: false
          }' >"$RUNNER_TEMP/create-draft-request.json"
          gh api \\
            --method POST \\
            "repos/$GITHUB_REPOSITORY/releases" \\
            --input "$RUNNER_TEMP/create-draft-request.json" \\
            >"$RUNNER_TEMP/created-draft.json"
          jq -e '
            .published_at == null
            and (.assets | length == 0)
            and (.html_url | test("/releases/tag/untagged-[0-9a-f]{20}$"))
          ' "$RUNNER_TEMP/created-draft.json"
          release_id="$(
            jq -er '.id | select(type == "number" and . > 0)' \\
              "$RUNNER_TEMP/created-draft.json"
          )"
          jq -e '[.[][] | select(.tag_name == $tag) | .id] == [$release_id]' releases.json
      - name: Upload exact assets only to the newly created Draft ID
        run: |
          release_id="$(
            jq -er '.id | select(type == "number" and . > 0)' \\
              "$RUNNER_TEMP/created-draft.json"
          )"
          curl \\
            --fail-with-body \\
            --silent \\
            --show-error \\
            --request POST \\
            --header "Accept: application/vnd.github+json" \\
            --header "Authorization: Bearer $GH_TOKEN" \\
            --header "Content-Type: application/octet-stream" \\
            --header "X-GitHub-Api-Version: 2022-11-28" \\
            --data-binary "@$file" \\
            "https://uploads.github.com/repos/$GITHUB_REPOSITORY/releases/$release_id/assets?name=$encoded_name" \\
            >"$RUNNER_TEMP/uploaded-asset-$index.json"
          jq -e '
            .name == $name
            and .state == "uploaded"
            and .size == $size
            and .digest == $digest
            and (.browser_download_url ==
              $draft_slug + "/" + $name)
          ' uploaded.json
          printf '%s\\n' \\
            "Biyan_\${VERSION}_universal.dmg" \\
            "Biyan.app.tar.gz" \\
            "Biyan.app.tar.gz.sig" \\
            "Biyan_\${VERSION}_x64-setup.exe" \\
            "Biyan_\${VERSION}_x64-setup.exe.sig" \\
            "Biyan_\${VERSION}_x64_en-US.msi" \\
            "Biyan_\${VERSION}_amd64.AppImage" \\
            "Biyan_\${VERSION}_amd64.AppImage.sig" \\
            "Biyan_\${VERSION}_amd64.deb" \\
            "candidate.json" \\
            "candidate.json.sig" \\
            "latest.json" \\
            "SHA256SUMS"
      - name: Verify exact draft release
        env:
          EXPECTED_MAIN: \${{ needs.preflight.outputs.trusted_main_commit }}
          EXPECTED_SOURCE: \${{ needs.preflight.outputs.source_commit }}
          RELEASE_TAG: \${{ needs.preflight.outputs.tag }}
        run: |
          live_main="$(git ls-remote --exit-code origin refs/heads/mita-main | awk 'NF == 2 { print $1 }')"
          tag_refs="$(git ls-remote --exit-code origin \\
            "refs/tags/$RELEASE_TAG" "refs/tags/$RELEASE_TAG^{}")"
          live_tag="$(printf '%s\\n' "$tag_refs" | awk -v tag="refs/tags/$RELEASE_TAG" '
            $2 == tag { direct = $1 }
            $2 == tag "^{}" { peeled = $1 }
            END { print (peeled != "" ? peeled : direct) }
          ')"
          if [[ ! "$live_main" =~ ^[0-9a-f]{40}$ ]] || [ "$live_main" != "$EXPECTED_MAIN" ]; then exit 1; fi
          if [[ ! "$live_tag" =~ ^[0-9a-f]{40}$ ]] || [ "$live_tag" != "$EXPECTED_SOURCE" ]; then exit 1; fi
          release_id="$(
            jq -er '.id | select(type == "number" and . > 0)' \\
              "$RUNNER_TEMP/created-draft.json"
          )"
          gh api "repos/$GITHUB_REPOSITORY/releases/$release_id"
          jq -e '
            .id == $release_id
            and .tag_name == $tag
            and .draft == true
            and .prerelease == false
            and .published_at == null
            and (([.assets[] | { name, size, digest }]) == $expected)
            and ("/releases/download/" + $draft_slug + "/")
          '
          gh api \\
            --paginate \\
            --slurp \\
            "repos/$GITHUB_REPOSITORY/releases?per_page=100" \\
            >"$RUNNER_TEMP/final-release-pages.json"
          jq -e '[.[][] | select(.tag_name == $tag) | .id] == [$release_id]' releases.json
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

  const splitCandidateConcurrency = candidateWorkflow.replace(
    'github.event.inputs.version || github.ref_name',
    'github.event.inputs.version || github.ref'
  )
  assert.ok(
    validateCandidateWorkflow(splitCandidateConcurrency).some((failure) =>
      failure.includes('serialize tag-push and manual runs')
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

  const firstArtifactUpload = candidateWorkflow.indexOf(
    '      - uses: actions/upload-artifact@v4'
  )
  const finalMacPin = candidateWorkflow.lastIndexOf(
    '      - env:',
    firstArtifactUpload
  )
  const lateMutationRevalidation =
    candidateWorkflow.slice(0, finalMacPin) +
    candidateWorkflow.slice(firstArtifactUpload)
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

  const withoutProtectedComposition = candidateWorkflow.replace(
    '--trusted-main "$TRUSTED_MAIN"',
    '--ignored-trusted-main "$TRUSTED_MAIN"'
  )
  assert.ok(
    validateCandidateWorkflow(withoutProtectedComposition).some((failure) =>
      failure.includes('compose the protected control plane')
    )
  )

  const withoutProtectedCompositionEnv = candidateWorkflow.replace(
    'SOURCE_COMMIT: ${{ steps.release.outputs.source_commit }}',
    'SOURCE_COMMIT: untrusted'
  )
  assert.ok(
    validateCandidateWorkflow(withoutProtectedCompositionEnv).some((failure) =>
      failure.includes('compose the protected control plane')
    )
  )

  const withoutReleaseTagBinding = candidateWorkflow.replace(
    '--release-tag "$RELEASE_TAG"',
    '--release-tag "v9.9.9"'
  )
  assert.ok(
    validateCandidateWorkflow(withoutReleaseTagBinding).some((failure) =>
      failure.includes('compose the protected control plane')
    )
  )

  const unsafeManualRef = candidateWorkflow.replace(
    '[ "$WORKFLOW_REF" != "refs/heads/mita-main" ]',
    '[ "$WORKFLOW_REF" != "refs/heads/release-work" ]'
  )
  assert.ok(
    validateCandidateWorkflow(unsafeManualRef).some((failure) =>
      failure.includes('workflow from protected mita-main')
    )
  )

  const advisoryManualRef = candidateWorkflow.replace(
    'then exit 1; fi',
    'then :; fi'
  )
  assert.ok(
    validateCandidateWorkflow(advisoryManualRef).some((failure) =>
      failure.includes('workflow from protected mita-main')
    )
  )

  const withoutReleaseTargetTests = candidateWorkflow.replace(
    'node --test scripts/ci/__tests__/verify-release-target.test.mjs',
    'echo skipped-release-target-tests'
  )
  assert.ok(
    validateCandidateWorkflow(withoutReleaseTargetTests).some((failure) =>
      failure.includes('protected release policy contracts')
    )
  )

  const withoutExactTagPin = candidateWorkflow.replaceAll(
    '"refs/tags/$RELEASE_TAG^{}"',
    '"refs/tags/$RELEASE_TAG-unpinned"'
  )
  assert.ok(
    validateCandidateWorkflow(withoutExactTagPin).some((failure) =>
      failure.includes('exact tag')
    )
  )

  const forgedLiveTag = candidateWorkflow.replaceAll(
    /          tag_refs="\$\(git ls-remote --exit-code origin \\\n[\s\S]*?\n          '\)"\n/g,
    '          live_tag="$EXPECTED_SOURCE"\n'
  )
  assert.ok(
    validateCandidateWorkflow(forgedLiveTag).some((failure) =>
      failure.includes('exact tag')
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
    'yarn tauri signer sign',
    'echo unsigned'
  )
  assert.ok(
    validateCandidateWorkflow(unsignedProvenance).some((failure) =>
      failure.includes('active signer step')
    )
  )

  const pluralSkipBuildMode = candidateWorkflow.replace(
    '--mode=skip-build',
    '--mode=skip-builds'
  )
  assert.ok(
    validateCandidateWorkflow(pluralSkipBuildMode).some((failure) =>
      failure.includes('immutable skip-build mode')
    )
  )

  const unlockedSignerInstall = candidateWorkflow.replace(
    'yarn install --immutable --mode=skip-build',
    'yarn install'
  )
  assert.ok(
    validateCandidateWorkflow(unlockedSignerInstall).some((failure) =>
      failure.includes('locked Yarn 4.5.3')
    )
  )

  const crossRunCandidateDownload = candidateWorkflow.replace(
    '          path: dist/builds',
    '          path: dist/builds\n          run-id: 123'
  )
  assert.ok(
    validateCandidateWorkflow(crossRunCandidateDownload).some((failure) =>
      failure.includes('current-run signed artifacts')
    )
  )

  const packageWithoutWindows = candidateWorkflow.replace(
    'needs: [preflight, build-macos, build-windows, build-linux]',
    'needs: [preflight, build-macos, build-linux]'
  )
  assert.ok(
    validateCandidateWorkflow(packageWithoutWindows).some((failure) =>
      failure.includes('all three signed builds')
    )
  )

  const literalSigningSecret = candidateWorkflow.replace(
    'TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}',
    'TAURI_SIGNING_PRIVATE_KEY: literal'
  )
  assert.ok(
    validateCandidateWorkflow(literalSigningSecret).some((failure) =>
      failure.includes('both protected Tauri signing secrets')
    )
  )

  const draftWithoutPackage = candidateWorkflow.replace(
    'needs: [preflight, build-macos, build-windows, build-linux, package-candidate]',
    'needs: [preflight, build-macos, build-windows, build-linux]'
  )
  assert.ok(
    validateCandidateWorkflow(draftWithoutPackage).some((failure) =>
      failure.includes('immutable packaging')
    )
  )

  const withoutPinnedCandidateVerification = candidateWorkflow.replace(
    'node scripts/updater/verify-candidate.mjs',
    'echo skipped-pinned-candidate-verification'
  )
  assert.ok(
    validateCandidateWorkflow(withoutPinnedCandidateVerification).some(
      (failure) => failure.includes('pinned updater key')
    )
  )

  for (const stepName of [
    'Install locked Tauri signer',
    'Require a fresh draft release slot',
    'Verify exact draft release',
  ]) {
    for (const bypass of [
      '        continue-on-error: true\n',
      '        "continue-on-error": true\n',
      '        if: ${{ true }}\n',
      '        "if": ${{ true }}\n',
    ]) {
      const advisory = candidateWorkflow.replace(
        `      - name: ${stepName}\n`,
        `      - name: ${stepName}\n${bypass}`
      )
      assert.ok(
        validateCandidateWorkflow(advisory).some((failure) =>
          failure.includes('unconditional')
        ),
        `${stepName} must reject ${bypass.trim()}`
      )
    }
  }
  const advisoryPin = candidateWorkflow.replace(
    '      - env:\n          EXPECTED_MAIN:',
    '      - continue-on-error: true\n        env:\n          EXPECTED_MAIN:'
  )
  assert.ok(
    validateCandidateWorkflow(advisoryPin).some((failure) =>
      failure.includes('unconditional')
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
    'node harness/scripts/verify-macos-candidate.mjs',
    'echo skipped-candidate-verification'
  )
  assert.ok(
    validateCandidateWorkflow(withoutMacCandidateVerification).some((failure) =>
      failure.includes('signed app and DMG')
    )
  )

  const tagWindowsVerifier = candidateWorkflow.replace(
    './harness/scripts/ci/verify-windows-candidate.ps1',
    './scripts/ci/verify-windows-candidate.ps1'
  )
  assert.ok(
    validateCandidateWorkflow(tagWindowsVerifier).some((failure) =>
      failure.includes('protected Windows candidate verifier')
    )
  )

  const packageStart = candidateWorkflow.indexOf('  package-candidate:\n')
  const packageEnd = candidateWorkflow.indexOf(
    '\n  draft-release:\n',
    packageStart
  )
  assert.notEqual(packageStart, -1)
  assert.notEqual(packageEnd, -1)
  const packageBlock = candidateWorkflow.slice(packageStart, packageEnd)
  assert.ok(
    packageBlock.includes(
      'ref: ${{ needs.preflight.outputs.trusted_main_commit }}'
    )
  )
  const tagReleaseTooling =
    candidateWorkflow.slice(0, packageStart) +
    packageBlock.replace(
      'ref: ${{ needs.preflight.outputs.trusted_main_commit }}',
      'ref: v0.6.643'
    ) +
    candidateWorkflow.slice(packageEnd)
  assert.ok(
    validateCandidateWorkflow(tagReleaseTooling).some((failure) =>
      failure.includes('release tooling from the protected harness')
    )
  )

  const reusedDraftSlot = candidateWorkflow.replace(
    '[.[][] | select(.tag_name == $tag)] | length == 0',
    '[.[][] | select(.tag_name == $tag)] | length > 0'
  )
  assert.ok(
    validateCandidateWorkflow(reusedDraftSlot).some((failure) =>
      failure.includes('enumerate all releases')
    )
  )

  const freshSlotStart = candidateWorkflow.indexOf(
    '      - name: Require a fresh draft release slot'
  )
  const freshSlotEnd = candidateWorkflow.indexOf(
    candidateReleasePin,
    freshSlotStart
  )
  const freshSlotBlock = candidateWorkflow.slice(
    freshSlotStart,
    freshSlotEnd
  )
  const withoutFreshSlot =
    candidateWorkflow.slice(0, freshSlotStart) +
    candidateWorkflow.slice(freshSlotEnd)
  const verifyDraftIndex = withoutFreshSlot.indexOf(
    '      - name: Verify exact draft release'
  )
  const lateFreshSlot =
    withoutFreshSlot.slice(0, verifyDraftIndex) +
    freshSlotBlock +
    withoutFreshSlot.slice(verifyDraftIndex)
  assert.ok(
    validateCandidateWorkflow(lateFreshSlot).some((failure) =>
      failure.includes('enumerate all releases')
    )
  )

  const branchTargetedDraft = candidateWorkflow.replace(
    'target_commitish: $target',
    'target_commitish: mita-main'
  )
  assert.ok(
    validateCandidateWorkflow(branchTargetedDraft).some((failure) =>
      failure.includes('enumerate all releases')
    )
  )

  const withoutReleaseTag = candidateWorkflow.replace(
    '            tag_name: $tag,\n',
    ''
  )
  assert.ok(
    validateCandidateWorkflow(withoutReleaseTag).some((failure) =>
      failure.includes('enumerate all releases')
    )
  )

  const incompleteDraftAssets = candidateWorkflow.replace(
    '            "candidate.json.sig" \\\n',
    ''
  )
  assert.ok(
    validateCandidateWorkflow(incompleteDraftAssets).some((failure) =>
      failure.includes('byte-bind exactly 13')
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
    'node harness/scripts/ci/candidate-path-policy.mjs --root src-tauri/target/release/bundle',
    'echo skipped-retired-runtime-scan'
  )
  assert.ok(
    validateCandidateWorkflow(withoutRetiredRuntimeScanner).some((failure) =>
      failure.includes('token-aware candidate path policy')
    )
  )

  const runtimeOnlyScanner = candidateWorkflow.replace(
    'node harness/scripts/ci/candidate-path-policy.mjs --root src-tauri/target/release/bundle',
    'node harness/scripts/ci/candidate-path-policy.mjs --root src-tauri/target/release/bundle --runtime-only'
  )
  assert.ok(
    validateCandidateWorkflow(runtimeOnlyScanner).some((failure) =>
      failure.includes('product and runtime names')
    )
  )

  const broadRuntimeGrep = candidateWorkflow.replace(
    '          node harness/scripts/ci/candidate-path-policy.mjs --root src-tauri/target/release/bundle',
    `          node harness/scripts/ci/candidate-path-policy.mjs --root src-tauri/target/release/bundle
      - run: find bundle -type f | grep -Ei '(llama|mlx|foundation|rag|vector)'`
  )
  assert.ok(
    validateCandidateWorkflow(broadRuntimeGrep).some((failure) =>
      failure.includes('broad retired-runtime verifier')
    )
  )

  const broadRuntimePowerShellMatch = candidateWorkflow.replace(
    '          node harness/scripts/ci/candidate-path-policy.mjs --root src-tauri/target/release/bundle',
    `          node harness/scripts/ci/candidate-path-policy.mjs --root src-tauri/target/release/bundle
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

test('candidate Draft mutations match reviewed execution envelopes', () => {
  const workflow = fs.readFileSync(
    '.github/workflows/desktop-release.yml',
    'utf8'
  ).replace(/\r\n?/g, '\n')
  assert.deepEqual(
    validateCandidateWorkflow(workflow, {
      requireReviewedEnvelope: true,
    }),
    []
  )

  const replaceInNamedStep = (source, stepName, needle, replacement) => {
    const marker = `      - name: ${stepName}\n`
    const start = source.indexOf(marker)
    assert.notEqual(start, -1, stepName)
    const next = source.indexOf('\n      - name: ', start + marker.length)
    const end = next < 0 ? source.length : next
    const step = source.slice(start, end)
    assert.ok(step.includes(needle), `${stepName} mutation needle`)
    return (
      source.slice(0, start) +
      step.replace(needle, replacement) +
      source.slice(end)
    )
  }

  const postSequence = [
    '          gh api \\',
    '            --method POST \\',
    '            "repos/$GITHUB_REPOSITORY/releases" \\',
    '            --input "$RUNNER_TEMP/create-draft-request.json" \\',
    '            >"$RUNNER_TEMP/created-draft.json"',
  ].join('\n')
  const postDecoy = [
    "          : <<'POLICY_DECOY'",
    postSequence,
    '          POLICY_DECOY',
    '          gh api \\',
    '            --method PATCH \\',
    '            "repos/$GITHUB_REPOSITORY/releases" \\',
    '            --input "$RUNNER_TEMP/create-draft-request.json" \\',
    '            >"$RUNNER_TEMP/created-draft.json"',
  ].join('\n')
  const patchedCreate = replaceInNamedStep(
    workflow,
    'Atomically create an empty Draft',
    postSequence,
    postDecoy
  )
  assert.ok(
    validateCandidateWorkflow(patchedCreate, {
      requireReviewedEnvelope: true,
    }).some((failure) =>
      failure.includes('whole-workflow execution-envelope allowlist')
    )
  )

  const exactDigest = [
    '                .name == $name',
    '                and .state == "uploaded"',
    '                and .size == $size',
    '                and .digest == $digest',
    '                and (.browser_download_url ==',
  ].join('\n')
  const broadDigest = exactDigest.replace(
    'and .digest == $digest',
    'and (.digest | test("^sha256:"))'
  )
  const weakenedDigest = replaceInNamedStep(
    workflow,
    'Upload exact assets only to the newly created Draft ID',
    exactDigest,
    broadDigest
  )
  const digestDecoy = replaceInNamedStep(
    weakenedDigest,
    'Upload exact assets only to the newly created Draft ID',
    '            jq -e \\',
    [
      "            : <<'POLICY_DECOY'",
      exactDigest,
      '            POLICY_DECOY',
      '            jq -e \\',
    ].join('\n')
  )
  assert.ok(
    validateCandidateWorkflow(digestDecoy, {
      requireReviewedEnvelope: true,
    }).some((failure) =>
      failure.includes('whole-workflow execution-envelope allowlist')
    )
  )

  const extraDraftMutation = workflow.replace(
    '      - name: Verify exact draft release\n',
    `      - name: Unauthorized publish mutation
        run: gh api --method PATCH "repos/$GITHUB_REPOSITORY/releases/123" -f draft=false
      - name: Verify exact draft release
`
  )
  assert.ok(
    validateCandidateWorkflow(extraDraftMutation, {
      requireReviewedEnvelope: true,
    }).some((failure) =>
      failure.includes('whole-workflow execution-envelope allowlist')
    )
  )

  const renamedWithMutation = extraDraftMutation.replace(
    'name: Desktop Release Candidate',
    'name: Desktop Release Candidate Evil'
  )
  assert.ok(
    validateCandidateWorkflow(renamedWithMutation, {
      requireReviewedEnvelope: true,
    }).some((failure) =>
      failure.includes('exact reviewed workflow name')
    )
  )

  const extraSecretJob = `${workflow}
  unauthorized-secret-job:
    permissions:
      contents: read
    environment: release-distribution
    steps:
      - env:
          TAURI_SIGNING_PRIVATE_KEY: \${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
        run: printf '%s' "$TAURI_SIGNING_PRIVATE_KEY"
`
  assert.ok(
    validateCandidateWorkflow(extraSecretJob, {
      requireReviewedEnvelope: true,
    }).some((failure) =>
      failure.includes('reviewed ordered job allowlist')
    )
  )

  const packageWrite = workflow.replace(
    '  package-candidate:\n',
    `  package-candidate:
    permissions:
      contents: write
`
  )
  assert.ok(
    validateCandidateWorkflow(packageWrite, {
      requireReviewedEnvelope: true,
    }).some((failure) =>
      failure.includes('only draft-release may request write permissions')
    )
  )
})

test('candidate recovery authenticates exact artifacts and only resumes package to Draft', () => {
  const workflow = fs.readFileSync(
    '.github/workflows/desktop-release-recovery.yml',
    'utf8'
  ).replace(/\r\n?/g, '\n')
  assert.deepEqual(validateCandidateRecoveryWorkflow(workflow), [])
  const replaceInNamedStep = (source, stepName, needle, replacement) => {
    const marker = `      - name: ${stepName}\n`
    const start = source.indexOf(marker)
    assert.notEqual(start, -1, stepName)
    const next = source.indexOf('\n      - name: ', start + marker.length)
    const end = next < 0 ? source.length : next
    const step = source.slice(start, end)
    assert.ok(step.includes(needle), `${stepName} mutation needle`)
    return (
      source.slice(0, start) +
      step.replace(needle, replacement) +
      source.slice(end)
    )
  }

  for (const [label, mutated, expected] of [
    [
      'top-level write',
      workflow.replace('actions: read', 'actions: write'),
      'top-level permissions',
    ],
    [
      'different concurrency',
      workflow.replace(
        'group: desktop-candidate-${{ inputs.version }}',
        'group: recovery-${{ github.run_id }}'
      ),
      'concurrency lock',
    ],
    [
      'unprotected manual ref',
      workflow.replace(
        '[ "$WORKFLOW_REF" != "refs/heads/mita-main" ]',
        '[ "$WORKFLOW_REF" != "refs/heads/recovery" ]'
      ),
      'live protected main',
    ],
    [
      'different accepted source run',
      workflow.replace(
        '[ "$SOURCE_RUN_ID" != "30195339449" ]',
        '[ "$SOURCE_RUN_ID" != "30195339450" ]'
      ),
      'live protected main',
    ],
    [
      'forged source endpoint',
      workflow.replace(
        'actions/runs/$SOURCE_RUN_ID/artifacts?per_page=100',
        'actions/runs/1/artifacts?per_page=100'
      ),
      'run, job, and artifact metadata',
    ],
    [
      'advisory recovery verifier',
      workflow.replace(
        'node harness/scripts/ci/verify-release-candidate-recovery.mjs',
        'echo skipped recovery verifier'
      ),
      'authenticate exact source topology',
    ],
    [
      'forged source ancestry',
      workflow.replace(
        'git -C harness merge-base --is-ancestor "$source_head" "$TRUSTED_MAIN"',
        'echo assumed ancestor'
      ),
      'authenticate exact source topology',
    ],
    [
      'allow product drift',
      workflow.replace(
        '"scripts/ci/verify-release-target.mjs"',
        '"src-tauri/src/main.rs"'
      ),
      'authenticate exact source topology',
    ],
    [
      'plural Yarn mode',
      workflow.replace('--mode=skip-build', '--mode=skip-builds'),
      'immutable skip-build mode',
    ],
    [
      'artifact download by name',
      workflow.replace(
        'actions/artifacts/$artifact_id/zip',
        'actions/artifacts/by-name/zip'
      ),
      'exact artifact IDs',
    ],
    [
      'advisory digest',
      workflow.replace(
        'if [ "$actual_digest" != "$artifact_digest" ]; then',
        'if false; then'
      ),
      'digest mismatch',
    ],
    [
      'replace safe extractor',
      workflow.replace(
        'python3 scripts/ci/extract-release-candidate-recovery.py',
        'python3 -c "pass"'
      ),
      'safely extract',
    ],
    [
      'unbind extractor version',
      workflow.replace(
        '--output-dir dist/builds \\\n            --version "$VERSION"',
        '--output-dir dist/builds \\\n            --version 0.0.0'
      ),
      'exactly nine',
    ],
    [
      'skip pinned candidate verification',
      workflow.replace(
        'node scripts/updater/verify-candidate.mjs',
        'echo skipped pinned verification'
      ),
      'pinned updater key',
    ],
    [
      'drop updater artifact identity output',
      workflow.replace(
        'updater_artifact_digest: ${{ steps.updater-metadata.outputs.artifact_digest }}',
        'updater_artifact_digest: forged'
      ),
      'authenticated updater artifact identity',
    ],
    [
      'treat raw upload digest as REST digest',
      workflow.replace(
        'artifact_digest="sha256:$ACTION_ARTIFACT_DIGEST"',
        'artifact_digest="$ACTION_ARTIFACT_DIGEST"'
      ),
      'authenticate the exact updater artifact',
    ],
    [
      'make updater ZIP digest advisory',
      workflow.replace(
        'if [ "$actual_digest" != "$ARTIFACT_DIGEST" ]; then',
        'if false; then'
      ),
      'exact ID, size, and digest',
    ],
    [
      'replace updater safe extractor',
      workflow.replace(
        'python3 scripts/ci/extract-release-candidate-recovery.py \\\n            --updater-archive',
        'python3 -c "pass" \\\n            --updater-archive'
      ),
      'exact 13-file extraction',
    ],
    [
      'non-atomic Draft update',
      workflow.replace('--method POST', '--method PATCH'),
      'atomically POST',
    ],
    [
      'echo-decoy non-atomic Draft update',
      workflow.replace(
        `          gh api \\
            --method POST \\
            "repos/$GITHUB_REPOSITORY/releases" \\`,
        `          echo "--method POST" >/dev/null
          gh api \\
            --method PATCH \\
            "repos/$GITHUB_REPOSITORY/releases" \\`
      ),
      'atomically POST',
    ],
    [
      'allow upload digest drift',
      workflow.replace(
        '                and .digest == $digest\n                and (.browser_download_url ==',
        '                and (.digest | test("^sha256:"))\n                and (.browser_download_url =='
      ),
      'byte-bound assets',
    ],
    [
      'split environment',
      workflow.replace(
        'environment: release-distribution',
        'environment: release-build'
      ),
      'release-distribution',
    ],
    [
      'drop draft package dependency',
      workflow.replace(
        'needs: [preflight, package-candidate]',
        'needs: preflight'
      ),
      'authenticated packaging',
    ],
    [
      'allow published release',
      workflow.replace('.published_at == null', 'true'),
      'atomically POST',
    ],
  ]) {
    assert.ok(
      validateCandidateRecoveryWorkflow(mutated).some((failure) =>
        failure.includes(expected)
      ),
      label
    )
  }

  const releaseIdResolver = `          release_id="$(
            jq -er '.id | select(type == "number" and . > 0)' \\
              "$RUNNER_TEMP/created-draft.json"
          )"`
  const forgedReleaseId = '          release_id="123456"'
  const forgedUploadReleaseId = replaceInNamedStep(
    workflow,
    'Upload exact assets only to the newly created Draft ID',
    releaseIdResolver,
    forgedReleaseId
  )
  assert.ok(
    validateCandidateRecoveryWorkflow(forgedUploadReleaseId).some(
      (failure) => failure.includes('byte-bound assets')
    )
  )
  const forgedBothReleaseIds = replaceInNamedStep(
    forgedUploadReleaseId,
    'Verify exact recovered draft release',
    releaseIdResolver,
    forgedReleaseId
  )
  assert.ok(
    validateCandidateRecoveryWorkflow(forgedBothReleaseIds).some(
      (failure) => failure.includes('byte-bound assets')
    )
  )

  const exactDigest = [
    '                .name == $name',
    '                and .state == "uploaded"',
    '                and .size == $size',
    '                and .digest == $digest',
    '                and (.browser_download_url ==',
  ].join('\n')
  const broadDigest = exactDigest.replace(
    'and .digest == $digest',
    'and (.digest | test("^sha256:"))'
  )
  const weakenedDigest = replaceInNamedStep(
    workflow,
    'Upload exact assets only to the newly created Draft ID',
    exactDigest,
    broadDigest
  )
  const digestDecoy = replaceInNamedStep(
    weakenedDigest,
    'Upload exact assets only to the newly created Draft ID',
    '            jq -e \\',
    [
      "            : <<'POLICY_DECOY'",
      exactDigest,
      '            POLICY_DECOY',
      '            jq -e \\',
    ].join('\n')
  )
  assert.ok(
    validateCandidateRecoveryWorkflow(digestDecoy).some((failure) =>
      failure.includes('whole-workflow execution-envelope allowlist')
    )
  )

  const postSequence = [
    '          gh api \\',
    '            --method POST \\',
    '            "repos/$GITHUB_REPOSITORY/releases" \\',
    '            --input "$RUNNER_TEMP/create-draft-request.json" \\',
    '            >"$RUNNER_TEMP/created-draft.json"',
  ].join('\n')
  const patchedCreate = replaceInNamedStep(
    workflow,
    'Atomically create an empty recovered Draft',
    postSequence,
    [
      "          : <<'POLICY_DECOY'",
      postSequence,
      '          POLICY_DECOY',
      '          gh api \\',
      '            --method PATCH \\',
      '            "repos/$GITHUB_REPOSITORY/releases" \\',
      '            --input "$RUNNER_TEMP/create-draft-request.json" \\',
      '            >"$RUNNER_TEMP/created-draft.json"',
    ].join('\n')
  )
  assert.ok(
    validateCandidateRecoveryWorkflow(patchedCreate).some((failure) =>
      failure.includes('whole-workflow execution-envelope allowlist')
    )
  )

  const extraDraftMutation = workflow.replace(
    '      - name: Verify exact recovered draft release\n',
    `      - name: Unauthorized publish mutation
        run: gh api --method PATCH "repos/$GITHUB_REPOSITORY/releases/123" -f draft=false
      - name: Verify exact recovered draft release
`
  )
  assert.ok(
    validateCandidateRecoveryWorkflow(extraDraftMutation).some((failure) =>
      failure.includes('whole-workflow execution-envelope allowlist')
    )
  )

  const extraSecretJob = `${workflow}
  unauthorized-secret-job:
    permissions:
      contents: read
    environment: release-distribution
    steps:
      - env:
          TAURI_SIGNING_PRIVATE_KEY: \${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
        run: printf '%s' "$TAURI_SIGNING_PRIVATE_KEY"
`
  assert.ok(
    validateCandidateRecoveryWorkflow(extraSecretJob).some((failure) =>
      failure.includes('reviewed ordered job allowlist')
    )
  )

  const packageWrite = workflow.replace(
    '  package-candidate:\n',
    `  package-candidate:
    permissions:
      contents: write
`
  )
  assert.ok(
    validateCandidateRecoveryWorkflow(packageWrite).some((failure) =>
      failure.includes('only draft-release may request write permissions')
    )
  )

  for (const stepName of [
    'Install locked Tauri signer',
    'Require a fresh draft release slot',
    'Revalidate protected main before draft release mutation',
    'Atomically create an empty recovered Draft',
    'Upload exact assets only to the newly created Draft ID',
    'Verify exact recovered draft release',
  ]) {
    for (const bypass of [
      '        continue-on-error: true\n',
      '        "continue-on-error": true\n',
      '        if: ${{ true }}\n',
      '        "if": ${{ true }}\n',
    ]) {
      const advisory = workflow.replace(
        `      - name: ${stepName}\n`,
        `      - name: ${stepName}\n${bypass}`
      )
      assert.ok(
        validateCandidateRecoveryWorkflow(advisory).some((failure) =>
          failure.includes('unconditional')
        ),
        `${stepName} must reject ${bypass.trim()}`
      )
    }
  }
})

test(
  'desktop release tag resolvers execute and peel annotated tags',
  { skip: process.platform === 'win32' },
  () => {
    const workflow = fs.readFileSync(
      '.github/workflows/desktop-release.yml',
      'utf8'
    )
    const resolverPattern =
      /live_tag="\$\(printf '%s\\n' "\$tag_refs" \| awk -v tag="refs\/tags\/\$RELEASE_TAG" '\n([\s\S]*?)\n\s+'\)"/g
    const resolvers = [...workflow.matchAll(resolverPattern)].map(
      (match) => match[1]
    )
    assert.equal(resolvers.length, 10)

    const tag = 'refs/tags/v0.6.643'
    const direct = 'a'.repeat(40)
    const peeled = 'b'.repeat(40)
    for (const resolver of resolvers) {
      const run = (input) =>
        spawnSync('awk', ['-v', `tag=${tag}`, resolver], {
          encoding: 'utf8',
          input,
        })
      const lightweight = run(`${direct}\t${tag}\n`)
      assert.ifError(lightweight.error)
      assert.equal(lightweight.status, 0, lightweight.stderr)
      assert.equal(lightweight.stdout.trim(), direct)

      const annotated = run(
        `${direct}\t${tag}\n${peeled}\t${tag}^{}\n`
      )
      assert.ifError(annotated.error)
      assert.equal(annotated.status, 0, annotated.stderr)
      assert.equal(annotated.stdout.trim(), peeled)
    }
  }
)

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
    runs-on: ubuntu-24.04
    steps:
      - name: Exercise locked candidate signer install
        run: |
          set -euo pipefail
          corepack enable
          corepack prepare yarn@4.5.3 --activate
          yarn install --immutable --mode=skip-build
          signer_probe="$RUNNER_TEMP/tauri-signer-probe"
          install -d -m 700 "$signer_probe"
          printf 'biyan signer preflight\\n' >"$signer_probe/payload.txt"
          yarn tauri signer generate \\
            --ci \\
            --password preflight-only \\
            --write-keys "$signer_probe/test.key"
          TAURI_SIGNING_PRIVATE_KEY_PATH="$signer_probe/test.key" \\
            TAURI_SIGNING_PRIVATE_KEY_PASSWORD=preflight-only \\
            yarn tauri signer sign "$signer_probe/payload.txt"
          test -s "$signer_probe/payload.txt.sig"
      - run: node scripts/ci/verify-release-policy.mjs
      - run: node --test scripts/ci/__tests__/candidate-content-policy.test.mjs
      - run: node --test scripts/ci/__tests__/release-policy.test.mjs
      - run: node --test scripts/ci/__tests__/verify-release-target.test.mjs
      - run: node --test scripts/ci/__tests__/qualification-impact.test.mjs
      - run: node --test scripts/ci/__tests__/run-untrusted-qualification-verifier.test.mjs
      - run: node --test scripts/ci/__tests__/verify-qualification-artifacts.test.mjs
      - run: node --test scripts/ci/__tests__/verify-qualification-recovery.test.mjs
      - run: python3 scripts/ci/__tests__/extract-release-candidate-recovery.test.py
      - run: node --test scripts/ci/__tests__/verify-release-candidate-recovery.test.mjs
      - run: node --test scripts/updater/__tests__/updater.test.mjs
      - run: node --test scripts/release-distribution/__tests__/release-distribution.test.mjs
      - name: Exercise unprivileged qualification verifier boundary
        shell: bash
        run: |
          set -euo pipefail
          probe_root="$GITHUB_WORKSPACE/qualification-helper-smoke"
          verifier="$RUNNER_TEMP/qualification-helper-smoke.mjs"
          mkdir -p "$probe_root"
          printf 'sandbox-readable\\n' > "$probe_root/marker.txt"
          printf 'process.exit(0)\\n' > "$verifier"
          scripts/ci/run-untrusted-qualification-verifier.sh \\
            --read-root "$probe_root" "$verifier" "$probe_root/marker.txt"
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
        'node --test scripts/ci/__tests__/verify-release-target.test.mjs',
        'echo skipped-release-target-tests'
      )
    ).some((failure) =>
      failure.includes(
        'Biyan CI release-safety job does not run: node --test scripts/ci/__tests__/verify-release-target.test.mjs'
      )
    )
  )
  for (const command of [
    'python3 scripts/ci/__tests__/extract-release-candidate-recovery.test.py',
    'node --test scripts/ci/__tests__/verify-release-candidate-recovery.test.mjs',
  ]) {
    assert.ok(
      validateCiWorkflow(
        workflow.replace(command, 'echo skipped-recovery-test')
      ).some((failure) =>
        failure.includes(`release-safety job does not run: ${command}`)
      )
    )
  }
  for (const signerMutation of [
    workflow.replace(
      'Exercise locked candidate signer install',
      'Removed candidate signer smoke'
    ),
    workflow.replace(
      'yarn tauri signer generate',
      'echo skipped signer generate'
    ),
    workflow.replace(
      'yarn tauri signer sign "$signer_probe/payload.txt"',
      'echo skipped signer sign'
    ),
    workflow.replace(
      '      - name: Exercise locked candidate signer install\n',
      '      - name: Exercise locked candidate signer install\n        continue-on-error: true\n'
    ),
  ]) {
    assert.ok(
      validateCiWorkflow(signerMutation).some((failure) =>
        failure.includes('real temporary signer')
      )
    )
  }
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
    'node --test scripts/ci/__tests__/run-untrusted-qualification-verifier.test.mjs',
    'node --test scripts/ci/__tests__/verify-qualification-artifacts.test.mjs',
    'node --test scripts/ci/__tests__/verify-qualification-recovery.test.mjs',
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
  for (const [index, helperMutation] of [
    workflow.replace(
      '          scripts/ci/run-untrusted-qualification-verifier.sh \\\n',
      '          echo scripts/ci/run-untrusted-qualification-verifier.sh \\\n'
    ),
    workflow.replace(
      '      - name: Exercise unprivileged qualification verifier boundary\n        shell: bash',
      '      - name: Exercise unprivileged qualification verifier boundary\n        continue-on-error: true\n        shell: bash'
    ),
    workflow.replace(
      '  release-safety:\n    runs-on: ubuntu-24.04',
      '  release-safety:\n    continue-on-error: true\n    runs-on: ubuntu-24.04'
    ),
    workflow.replace(
      '--read-root "$probe_root" "$verifier" "$probe_root/marker.txt"',
      '--read-root "$probe_root" "$verifier"'
    ),
    workflow.replace(
      '  release-safety:\n    runs-on: ubuntu-24.04',
      '  release-safety:\n    runs-on: macos-15-intel'
    ),
  ].entries()) {
    assert.ok(
      validateCiWorkflow(helperMutation).some(
        (failure) =>
          failure.includes('untrusted verifier helper') ||
          failure.includes('release-safety must use ubuntu')
      ),
      `release-safety helper mutation ${index} must fail closed`
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
      mode:
        required: true
        type: choice
        options:
          - auto
          - bootstrap-full
          - aggregate-recovery
      recovery_run_id:
        required: false
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
          if [ "\${{ inputs.mode }}" = bootstrap-full ] || [ "\${{ inputs.mode }}" = aggregate-recovery ]; then
            bootstrap_full=--force-full
          fi
          node harness/scripts/ci/qualification-impact.mjs classify --repo harness --base "$BASE" --target "$TARGET" $bootstrap_full --format github-output
      - working-directory: harness
        run: node --test scripts/ci/__tests__/qualification-impact.test.mjs scripts/ci/__tests__/release-policy.test.mjs scripts/ci/__tests__/verify-qualification-artifacts.test.mjs scripts/ci/__tests__/verify-qualification-recovery.test.mjs
      - name: Prove exact target verifier sandbox before native jobs
        run: |
          probe_root="$GITHUB_WORKSPACE/qualification-verifier-probe"
          verifier="target/scripts/ci/verify-qualification-artifacts.mjs"
          harness/scripts/ci/run-untrusted-qualification-verifier.sh \
            --read-root "$probe_root" "$verifier" "\${verify_args[@]}"
          harness/scripts/ci/run-untrusted-qualification-verifier.sh \
            --read-root "$probe_root" "$verifier" \
            verify-platforms --root "$probe_root"
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
    if: needs.preflight.outputs.docs == 'true' && needs.preflight.outputs.mode != 'aggregate-recovery'
  recovery-auth:
    needs: preflight
    if: needs.preflight.outputs.mode == 'aggregate-recovery'
    runs-on: ubuntu-24.04
    outputs:
      source_head_sha: \${{ steps.verify.outputs.source_head_sha }}
      summary_json: \${{ steps.verify.outputs.summary_json }}
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ needs.preflight.outputs.workflow_sha }}
          fetch-depth: 0
          path: harness
      - uses: actions/github-script@v7
        with:
          github-token: \${{ github.token }}
          script: |
            const runId = Number(process.env.RECOVERY_RUN_ID)
            await github.rest.actions.getWorkflowRun({
              owner: context.repo.owner,
              repo: context.repo.repo,
              run_id: runId,
            })
            await github.rest.actions.listJobsForWorkflowRun({
              owner: context.repo.owner,
              repo: context.repo.repo,
              run_id: runId,
            })
            await github.rest.actions.listWorkflowRunArtifacts({
              owner: context.repo.owner,
              repo: context.repo.repo,
              run_id: runId,
            })
      - id: verify
        run: |
          node harness/scripts/ci/verify-qualification-recovery.mjs \
            --run recovery-metadata/run.json \
            --jobs recovery-metadata/jobs.json \
            --artifacts recovery-metadata/artifacts.json \
            --source-run-id "$RECOVERY_RUN_ID" \
            --repository "$GITHUB_REPOSITORY" \
            --target-sha "$TARGET_SHA" \
            --base-sha "$BASE_SHA" \
            --output recovery-metadata/recovery-summary.json \
            --github-output "$GITHUB_OUTPUT"
          source_head_sha="$(jq -er '.sourceHeadSha | select(test("^[0-9a-f]{40}$"))' recovery-metadata/recovery-summary.json)"
          git -C harness cat-file -e "\${source_head_sha}^{commit}"
          git -C harness merge-base --is-ancestor "$source_head_sha" \${{ needs.preflight.outputs.workflow_sha }}
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
      - run: |
          artifact_root=replay
          node harness/scripts/ci/verify-qualification-artifacts.mjs verify --root "$artifact_root" --manifest replay/manifest.json --manifest-sha256 "$MANIFEST_SHA" --target-sha "$BASE" --base-sha "$REPLAY_BASE" --run-id "$REPLAY_RUN"
          verify_args=(verify --root "$artifact_root")
          harness/scripts/ci/run-untrusted-qualification-verifier.sh \
            --read-root "$artifact_root" \
            target/scripts/ci/verify-qualification-artifacts.mjs "\${verify_args[@]}"
          harness/scripts/ci/run-untrusted-qualification-verifier.sh \
            --read-root "$artifact_root" \
            target/scripts/ci/verify-qualification-artifacts.mjs \
            verify-platforms --root "$artifact_root"
          node harness/scripts/ci/verify-qualification-artifacts.mjs "\${verify_args[@]}"
          node harness/scripts/ci/verify-qualification-artifacts.mjs verify-platforms --root "$artifact_root"
  native-linux:
    runs-on: ubuntu-24.04
    needs: [preflight, artifact-replay]
    if: needs.preflight.outputs.mode != 'aggregate-recovery' && (needs.preflight.outputs.test_linux == 'true' || needs.preflight.outputs.build_linux == 'true')
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
    if: needs.preflight.outputs.mode != 'aggregate-recovery' && (needs.preflight.outputs.test_windows == 'true' || needs.preflight.outputs.build_windows == 'true')
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
    if: needs.preflight.outputs.mode != 'aggregate-recovery' && (needs.preflight.outputs.test_macos == 'true' || needs.preflight.outputs.build_macos == 'true')
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
    needs: [preflight, recovery-auth, native-linux, native-windows, native-macos]
    if: needs.recovery-auth.result == 'success' || needs.preflight.outputs.mode != 'aggregate-recovery'
    steps:
      - if: needs.preflight.outputs.mode == 'aggregate-recovery'
        uses: actions/download-artifact@v4
        with:
          github-token: \${{ github.token }}
          repository: \${{ github.repository }}
          run-id: \${{ needs.preflight.outputs.recovery_run_id }}
          name: qualification-build-linux-\${{ needs.preflight.outputs.recovery_run_id }}
          path: qualification-current/linux
      - if: needs.preflight.outputs.mode == 'aggregate-recovery'
        uses: actions/download-artifact@v4
        with:
          github-token: \${{ github.token }}
          repository: \${{ github.repository }}
          run-id: \${{ needs.preflight.outputs.recovery_run_id }}
          name: qualification-build-windows-\${{ needs.preflight.outputs.recovery_run_id }}
          path: qualification-current/windows
      - if: needs.preflight.outputs.mode == 'aggregate-recovery'
        uses: actions/download-artifact@v4
        with:
          github-token: \${{ github.token }}
          repository: \${{ github.repository }}
          run-id: \${{ needs.preflight.outputs.recovery_run_id }}
          name: qualification-build-macos-\${{ needs.preflight.outputs.recovery_run_id }}
          path: qualification-current/macos
      - env:
          RECOVERY_MODE: \${{ needs.preflight.outputs.mode == 'aggregate-recovery' }}
          RECOVERY_SUMMARY_JSON: \${{ needs.recovery-auth.outputs.summary_json }}
        run: |
          printf '%s' "$RECOVERY_SUMMARY_JSON" | jq -e \
            '.sourceRunId == $recovery_run_id
             and .targetSha == $target_sha
             and .baseSha == $base_sha
             and (.artifacts | length == 3)'
          printf '%s' "$RECOVERY_SUMMARY_JSON" > qualification-evidence/run-\${{ github.run_id }}-aggregate-recovery.json
      - run: |
          verify_args=(verify --root qualification-output)
          node harness/scripts/ci/verify-qualification-artifacts.mjs \
            "\${verify_args[@]}"
          harness/scripts/ci/run-untrusted-qualification-verifier.sh \
            --read-root qualification-output \
            target/scripts/ci/verify-qualification-artifacts.mjs \
            "\${verify_args[@]}"
          harness/scripts/ci/run-untrusted-qualification-verifier.sh \
            --read-root qualification-output \
            target/scripts/ci/verify-qualification-artifacts.mjs \
            verify-platforms --root qualification-output
          node harness/scripts/ci/verify-qualification-artifacts.mjs \
            "\${verify_args[@]}"
          node harness/scripts/ci/verify-qualification-artifacts.mjs \
            verify-platforms --root qualification-output
  qualification-gate:
    if: \${{ always() }}
    runs-on: ubuntu-24.04
    needs: [preflight, docs-build, recovery-auth, artifact-replay, native-linux, native-windows, native-macos, aggregate-artifacts]
    steps:
      - env:
          MODE: \${{ needs.preflight.outputs.mode }}
          RECOVERY_RESULT: \${{ needs.recovery-auth.result }}
        run: |
          require_result() { test "$2" = success; }
          require_result preflight "$PREFLIGHT_RESULT"
          recovery_required=false
          if [ "$MODE" = "aggregate-recovery" ]; then
            recovery_required=true
          fi
          expect_result docs-build "$DOCS_REQUIRED" "$DOCS_RESULT"
          expect_result recovery-auth "$recovery_required" "$RECOVERY_RESULT"
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
      'if [ "\${{ inputs.mode }}" = bootstrap-full ] || [ "\${{ inputs.mode }}" = aggregate-recovery ]; then',
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

  for (const [name, mutation] of [
    [
      'delete aggregate-recovery mode',
      qualificationWorkflow.replace('          - aggregate-recovery\n', ''),
    ],
    [
      'delete recovery run input',
      qualificationWorkflow.replace(
        '      recovery_run_id:\n        required: false\n',
        ''
      ),
    ],
    [
      'delete recovery auth job',
      qualificationWorkflow.replace(
        /\n  recovery-auth:[\s\S]*?(?=\n  artifact-replay:)/,
        ''
      ),
    ],
    [
      'run recovery auth outside recovery mode',
      qualificationWorkflow.replace(
        "    if: needs.preflight.outputs.mode == 'aggregate-recovery'\n    runs-on: ubuntu-24.04\n    outputs:",
        '    if: always()\n    runs-on: ubuntu-24.04\n    outputs:'
      ),
    ],
    [
      'fetch recovery metadata from another repository',
      qualificationWorkflow.replace(
        '              repo: context.repo.repo,\n              run_id: runId,',
        "              repo: 'attacker/fork',\n              run_id: runId,"
      ),
    ],
    [
      'echo recovery validator',
      qualificationWorkflow.replace(
        '          node harness/scripts/ci/verify-qualification-recovery.mjs',
        '          echo node harness/scripts/ci/verify-qualification-recovery.mjs'
      ),
    ],
    [
      'bypass source jobs',
      qualificationWorkflow.replace(
        '--jobs recovery-metadata/jobs.json',
        '--jobs /dev/null'
      ),
    ],
    [
      'skip source-head ancestry proof',
      qualificationWorkflow.replace(
        '          git -C harness merge-base --is-ancestor "$source_head_sha" \${{ needs.preflight.outputs.workflow_sha }}',
        '          echo git -C harness merge-base --is-ancestor "$source_head_sha" \${{ needs.preflight.outputs.workflow_sha }}'
      ),
    ],
    [
      'remove preflight sandbox helper',
      qualificationWorkflow.replace(
        '          harness/scripts/ci/run-untrusted-qualification-verifier.sh',
        '          echo harness/scripts/ci/run-untrusted-qualification-verifier.sh'
      ),
    ],
    [
      'run target verifier directly',
      qualificationWorkflow.replace(
        '          harness/scripts/ci/run-untrusted-qualification-verifier.sh',
        '          node target/scripts/ci/verify-qualification-artifacts.mjs'
      ),
    ],
    [
      'remove replay sandbox helper',
      qualificationWorkflow.replace(
        /harness\/scripts\/ci\/run-untrusted-qualification-verifier\.sh(?=\s+--read-root "\$artifact_root")/,
        'echo $&'
      ),
    ],
    [
      'remove aggregate sandbox helper',
      qualificationWorkflow.replace(
        /harness\/scripts\/ci\/run-untrusted-qualification-verifier\.sh(?=\s+--read-root qualification-output)/,
        'echo $&'
      ),
    ],
    [
      'use wide recovery artifact pattern',
      qualificationWorkflow.replace(
        '          name: qualification-build-linux-\${{ needs.preflight.outputs.recovery_run_id }}',
        '          pattern: qualification-build-*'
      ),
    ],
    [
      'use current run for recovery artifact',
      qualificationWorkflow.replace(
        '          run-id: \${{ needs.preflight.outputs.recovery_run_id }}',
        '          run-id: \${{ github.run_id }}'
      ),
    ],
    [
      'drop recovery artifact token',
      qualificationWorkflow.replace(
        '          github-token: \${{ github.token }}',
        '          github-token: missing'
      ),
    ],
    [
      'let docs run during recovery',
      qualificationWorkflow.replace(
        "    if: needs.preflight.outputs.docs == 'true' && needs.preflight.outputs.mode != 'aggregate-recovery'",
        "    if: needs.preflight.outputs.docs == 'true'"
      ),
    ],
    [
      'let Linux native run during recovery',
      qualificationWorkflow.replace(
        "    if: needs.preflight.outputs.mode != 'aggregate-recovery' && (needs.preflight.outputs.test_linux == 'true' || needs.preflight.outputs.build_linux == 'true')",
        "    if: needs.preflight.outputs.test_linux == 'true' || needs.preflight.outputs.build_linux == 'true'"
      ),
    ],
    [
      'drop aggregate recovery dependency',
      qualificationWorkflow.replace(
        '    needs: [preflight, recovery-auth, native-linux, native-windows, native-macos]',
        '    needs: [preflight, native-linux, native-windows, native-macos]'
      ),
    ],
    [
      'drop authenticated recovery summary',
      qualificationWorkflow.replace(
        '          RECOVERY_SUMMARY_JSON: \${{ needs.recovery-auth.outputs.summary_json }}',
        '          RECOVERY_SUMMARY_JSON: untrusted'
      ),
    ],
    [
      'drop protected verification after aggregate target verifier',
      qualificationWorkflow.replace(
        '          node harness/scripts/ci/verify-qualification-artifacts.mjs             verify-platforms --root qualification-output\n  qualification-gate:',
        '          echo protected aggregate verification removed\n  qualification-gate:'
      ),
    ],
    [
      'drop gate recovery dependency',
      qualificationWorkflow.replace(
        '    needs: [preflight, docs-build, recovery-auth, artifact-replay, native-linux, native-windows, native-macos, aggregate-artifacts]',
        '    needs: [preflight, docs-build, artifact-replay, native-linux, native-windows, native-macos, aggregate-artifacts]'
      ),
    ],
    [
      'echo gate recovery result',
      qualificationWorkflow.replace(
        '          expect_result recovery-auth "$recovery_required" "$RECOVERY_RESULT"',
        '          echo expect_result recovery-auth "$recovery_required" "$RECOVERY_RESULT"'
      ),
    ],
    [
      'drop trusted recovery contract test',
      qualificationWorkflow.replace(
        ' scripts/ci/__tests__/verify-qualification-recovery.test.mjs',
        ''
      ),
    ],
  ]) {
    assert.notEqual(
      mutation,
      qualificationWorkflow,
      `${name} fixture mutation must apply`
    )
    assert.notDeepEqual(
      validateQualificationWorkflow(mutation),
      [],
      `${name} must fail closed`
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
