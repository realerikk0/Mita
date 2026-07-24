import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  LEGACY_CANDIDATE_PATTERN,
  inspectDocsArchiveInventory,
  legacyMatchDigest,
  validateDocsAssetBoundary,
  validateLegacyCompatibilityAllowlist,
  validateLegacyCompatibilityRepository,
  validatePackagingCompatibilityContracts,
  validateTauriCliAppImageContract,
} from '../legacy-compatibility-policy.mjs'

const repoRoot = path.resolve(import.meta.dirname, '../../..')

function writeFixture(files) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'biyan-legacy-compatibility-')
  )
  for (const [relativePath, value] of Object.entries(files)) {
    const absolute = path.join(root, relativePath)
    fs.mkdirSync(path.dirname(absolute), { recursive: true })
    fs.writeFileSync(absolute, value)
  }
  return root
}

function findMatches(source, patternSource, relativePath) {
  const expression = new RegExp(patternSource, 'gimu')
  const matches = []
  let match
  while ((match = expression.exec(source)) !== null) {
    const lineStart = source.lastIndexOf('\n', match.index - 1) + 1
    const lineEndCandidate = source.indexOf('\n', match.index + match[0].length)
    const lineEnd = lineEndCandidate === -1 ? source.length : lineEndCandidate
    matches.push({
      context: source.slice(lineStart, lineEnd).trim(),
      end: match.index + match[0].length,
      match: match[0],
      path: relativePath,
      start: match.index,
    })
  }
  return matches
}

function makeRule(
  files,
  {
    id,
    path: exactPath,
    pathRegex,
    pattern = LEGACY_CANDIDATE_PATTERN,
    reason = 'Exact reviewed compatibility fixture retained by policy.',
    scope = 'content',
  }
) {
  const selector = exactPath
    ? (relativePath) => relativePath === exactPath
    : (relativePath) => new RegExp(pathRegex, 'u').test(relativePath)
  const matches = []
  for (const [relativePath, value] of Object.entries(files)) {
    if (!selector(relativePath)) continue
    const source =
      scope === 'path'
        ? relativePath
        : Buffer.isBuffer(value)
          ? value.toString('utf8')
          : value
    matches.push(...findMatches(source, pattern, relativePath))
  }
  return {
    expectedMatches: matches.length,
    id,
    matchesSha256: legacyMatchDigest(matches),
    ...(exactPath ? { path: exactPath } : { pathRegex }),
    pattern,
    reason,
    scope,
  }
}

function archiveInventory(files, canonicalTextPaths = []) {
  const root = writeFixture(files)
  try {
    return inspectDocsArchiveInventory(
      root,
      Object.keys(files),
      'docs/unpublished-upstream-history/assets/',
      canonicalTextPaths
    )
  } finally {
    fs.rmSync(root, { force: true, recursive: true })
  }
}

function allowlist(
  rules = [],
  excludedTrackedFiles = [],
  files = {},
  canonicalTextPaths = []
) {
  const archive = archiveInventory(files, canonicalTextPaths)
  return {
    archivedDocsAssets: {
      canonicalTextPaths,
      expectedFiles: archive.count,
      inventorySha256: archive.sha256,
      prefix: 'docs/unpublished-upstream-history/assets/',
      reason:
        'Unpublished historical media is retained outside every documentation build input.',
    },
    excludedTrackedFiles,
    rules,
    schema: 2,
  }
}

function validateFixture(files, rules = [], excludedTrackedFiles = []) {
  const root = writeFixture(files)
  try {
    return validateLegacyCompatibilityRepository(root, {
      allowlist: allowlist(rules, excludedTrackedFiles, files),
      trackedFiles: Object.keys(files),
      validatePackaging: false,
    })
  } finally {
    fs.rmSync(root, { force: true, recursive: true })
  }
}

test('active source, config, locale, public metadata and asset paths fail closed', () => {
  const fixtures = [
    {
      path: 'src-tauri/plugins/tauri-plugin-hardware/src/vendor/vulkan.rs',
      value: 'let app = "Jan GPU Detection";',
    },
    {
      path: 'web-app/vite.config.ts',
      value:
        'define: { MODEL_CATALOG_URL: "https://raw.githubusercontent.com/janhq/model-catalog/main/catalog.json" }',
    },
    {
      path: '.devcontainer/devcontainer.json',
      value: '{"name":"Jan"}',
    },
    {
      path: 'web-app/src/locales/en.json',
      value: '{"productName":"Mita"}',
    },
    {
      path: 'web-app/public/manifest.json',
      value: '{"productName":"Silence"}',
    },
    {
      path: 'src-tauri/tauri.conf.json',
      value: '{"productName":"Jan"}',
    },
    {
      path: 'src/runtime.ts',
      value: `export const name = "${['Cort', 'ex'].join('')} Engine"`,
    },
    {
      path: 'docs/src/assets/logo-jan.png',
      value: Buffer.from([0, 1, 2, 3]),
    },
  ]
  for (const fixture of fixtures) {
    const failures = validateFixture({ [fixture.path]: fixture.value }, [])
    assert.ok(
      failures.some((failure) =>
        failure.includes(
          fixture.path.endsWith('.png')
            ? 'unallowlisted legacy path identifier'
            : 'unallowlisted legacy content identifier'
        )
      ),
      `${fixture.path}: ${failures.join('\n')}`
    )
  }
})

test('allowlist rejects broad, unused and count-drifted exceptions', () => {
  const broad = {
    expectedMatches: 1,
    id: 'too-wide',
    matchesSha256: '0'.repeat(64),
    pathRegex: '^.*$',
    pattern: LEGACY_CANDIDATE_PATTERN,
    reason: 'This intentionally broad test rule must be rejected.',
    scope: 'content',
  }
  assert.ok(
    validateLegacyCompatibilityAllowlist(allowlist([broad])).some((failure) =>
      failure.includes('pathRegex is too broad')
    )
  )

  const unused = {
    expectedMatches: 1,
    id: 'unused-rule',
    matchesSha256: '0'.repeat(64),
    path: 'src/legacy.ts',
    pattern: 'Jan',
    reason: 'This intentionally unused test rule must fail closed.',
    scope: 'content',
  }
  const unusedFailures = validateFixture(
    { 'src/legacy.ts': 'export const product = "Biyan"' },
    [unused]
  )
  assert.ok(
    unusedFailures.some((failure) =>
      failure.includes('expected 1 matches but found 0')
    )
  )

  const original = { 'src/migration.ts': 'const oldName = "Jan"\n' }
  const reviewed = makeRule(original, {
    id: 'reviewed-migration',
    path: 'src/migration.ts',
  })
  const driftFailures = validateFixture(
    {
      'src/migration.ts':
        'const oldName = "Jan"\nconst otherOldName = "Silence"\n',
    },
    [reviewed]
  )
  assert.ok(
    driftFailures.some((failure) =>
      failure.includes('expected 1 matches but found 2')
    )
  )
  assert.ok(
    driftFailures.some((failure) => failure.includes('match digest changed'))
  )
})

test('exact stable identities, migrations and legal provenance are allowlisted', () => {
  const files = {
    'LICENSE': 'Biyan is derived from Jan.\n',
    'NOTICE': 'Jan upstream notice.\nJan contributors.\n',
    'flatpak/uk.jingxing.Mita.yml': 'id: uk.jingxing.Mita\ncommand: Biyan\n',
    'src-tauri/gen/android/app/src/main/assets/resources/NOTICE':
      'Jan upstream notice.\nJan contributors.\n',
    'src-tauri/src/core/legacy_migrations.rs':
      'const OLD: &[&str] = &["Jan", "Mita", "Silence"];\n',
    'src-tauri/tauri.conf.json':
      '{"identifier":"uk.jingxing.mita","schemes":["biyan","mita"],"endpoint":"https://updates.mita.so/biyan","legacyCdn":"https://static.mitapp.cn"}\n',
  }
  const rules = [
    makeRule(files, {
      id: 'legal-jan-provenance',
      path: 'LICENSE',
      pattern: 'Jan',
    }),
    makeRule(files, {
      id: 'legal-notice-provenance',
      pathRegex:
        '^(?:NOTICE|src-tauri/gen/android/app/src/main/assets/resources/NOTICE)$',
      pattern: 'Jan',
    }),
    makeRule(files, {
      id: 'flatpak-stable-id-content',
      path: 'flatpak/uk.jingxing.Mita.yml',
      pattern: String.raw`uk\.jingxing\.Mita`,
      reason: 'Published Flatpak identity must remain stable for upgrades.',
    }),
    makeRule(files, {
      id: 'flatpak-stable-id-path',
      path: 'flatpak/uk.jingxing.Mita.yml',
      pattern: String.raw`uk\.jingxing\.Mita`,
      reason: 'Published Flatpak filename must remain stable for upgrades.',
      scope: 'path',
    }),
    makeRule(files, {
      id: 'migration-identities',
      path: 'src-tauri/src/core/legacy_migrations.rs',
    }),
    makeRule(files, {
      id: 'tauri-bundle-id',
      path: 'src-tauri/tauri.conf.json',
      pattern: String.raw`uk\.jingxing\.mita`,
      reason: 'Published Tauri bundle identifier remains upgrade compatible.',
    }),
    makeRule(files, {
      id: 'tauri-mita-scheme',
      path: 'src-tauri/tauri.conf.json',
      pattern: String.raw`"mita"`,
      reason: 'Legacy provider-import scheme remains an ingress only.',
    }),
    makeRule(files, {
      id: 'tauri-updater-host',
      path: 'src-tauri/tauri.conf.json',
      pattern: String.raw`updates\.mita\.so`,
      reason: 'Published updater host remains the stable distribution origin.',
    }),
    makeRule(files, {
      id: 'tauri-legacy-cdn-host',
      path: 'src-tauri/tauri.conf.json',
      pattern: String.raw`static\.mitapp\.cn`,
      reason: 'Published legacy CDN host remains an upgrade bridge only.',
    }),
  ]
  assert.deepEqual(validateFixture(files, rules), [])

  const malicious = {
    ...files,
    'src-tauri/tauri.conf.json': `${files['src-tauri/tauri.conf.json']}productName = "Jan"\n`,
  }
  const failures = validateFixture(malicious, rules)
  assert.ok(
    failures.some((failure) =>
      failure.includes('unallowlisted legacy content identifier')
    )
  )

  const driftedAndroidNotice = {
    ...files,
    'src-tauri/gen/android/app/src/main/assets/resources/NOTICE':
      `${files.NOTICE}Jan unexpected attribution drift.\n`,
  }
  const noticeFailures = validateFixture(driftedAndroidNotice, rules)
  assert.ok(
    noticeFailures.some((failure) =>
      failure.includes('expected 4 matches but found 5')
    )
  )
  assert.ok(
    noticeFailures.some((failure) => failure.includes('match digest changed'))
  )
})

function packagingFixture() {
  const files = {
    'docs/package.json': JSON.stringify({
      name: 'biyan-docs',
      packageManager: 'yarn@1.22.22',
      scripts: {
        build: 'next build',
      },
    }),
    'docs/yarn.lock': '# yarn lockfile v1\n',
    'LICENSE': 'license\n',
    'NOTICE': 'notice\n',
    'package.json': JSON.stringify({
      devDependencies: { '@tauri-apps/cli': '2.11.4' },
      name: 'biyan-app',
      scripts: {
        'build:icon':
          'tauri icon ./src-tauri/app-icon.png --output ./src-tauri/icons',
      },
    }),
    'scripts/install-extensions.mjs': `const EXPECTED_WORKSPACES = [
  'assistant-extension',
  'conversational-extension',
  'download-extension',
]`,
    'src-tauri/Cargo.toml': `[features]
default = [
  "tauri/wry",
  "tauri/x11",
  "tauri/protocol-asset",
  "tauri/macos-private-api",
  "tauri/tray-icon",
  "tauri/test",
  "tauri/custom-protocol",
  "desktop",
]
hardware = ["dep:tauri-plugin-hardware"]
desktop = ["deep-link", "hardware"]

[dependencies]
tauri-plugin-hardware = { path = "./plugins/tauri-plugin-hardware", optional = true }
`,
    'src-tauri/gen/android/app/src/main/assets/resources/LICENSE': 'license\n',
    'src-tauri/gen/android/app/src/main/assets/resources/NOTICE': 'notice\n',
    'src-tauri/app-icon.png': fs.readFileSync(
      path.join(repoRoot, 'src-tauri/app-icon.png')
    ),
    'src-tauri/icons/icon.png': fs.readFileSync(
      path.join(repoRoot, 'src-tauri/icons/icon.png')
    ),
    'src-tauri/src/lib.rs': `builder = builder.plugin(tauri_plugin_single_instance::init(handler));
let mut app_builder = builder
  .plugin(tauri_plugin_os::init())
  .plugin(tauri_plugin_opener::init())
  .plugin(tauri_plugin_http::init())
  .plugin(tauri_plugin_store::Builder::new().build())
  .plugin(tauri_plugin_shell::init())
  .plugin(tauri_plugin_document_parser::init());
app_builder = app_builder.plugin(tauri_plugin_deep_link::init());
#[cfg(not(any(target_os = "android", target_os = "ios")))]
{
    app_builder = app_builder.plugin(tauri_plugin_hardware::init());
}
app.handle().plugin(tauri_plugin_log::Builder::default().build());
app.handle().plugin(tauri_plugin_updater::Builder::new().build());
`,
    'yarn.lock': tauriCliLock('2.11.4'),
  }
  for (const workflowPath of [
    '.github/workflows/template-tauri-build-linux-x64-external.yml',
    '.github/workflows/template-tauri-build-linux-x64.yml',
    '.github/workflows/template-tauri-build-macos-external.yml',
    '.github/workflows/template-tauri-build-macos.yml',
    '.github/workflows/template-tauri-build-windows-x64-external.yml',
    '.github/workflows/template-tauri-build-windows-x64.yml',
  ]) {
    files[workflowPath] =
      'cp .github/scripts/icon-${{ inputs.channel }}.png src-tauri/app-icon.png\n'
  }
  for (const [directory, name, version] of [
    ['assistant-extension', '@biyan/assistant-extension', '1.0.2'],
    ['conversational-extension', '@biyan/conversational-extension', '1.0.0'],
    ['download-extension', '@biyan/download-extension', '1.0.0'],
  ]) {
    files[`extensions/${directory}/package.json`] = JSON.stringify({
      dependencies: { '@biyan/core': '../../core/package.tgz' },
      name,
      private: true,
      version,
      scripts: {
        'build:publish':
          'yarn build && npm pack && cpx *.tgz ../../pre-install',
      },
    })
  }
  return files
}

function tauriCliLock(version) {
  const platformPackages = [
    '@tauri-apps/cli-darwin-arm64',
    '@tauri-apps/cli-darwin-x64',
    '@tauri-apps/cli-linux-arm-gnueabihf',
    '@tauri-apps/cli-linux-arm64-gnu',
    '@tauri-apps/cli-linux-arm64-musl',
    '@tauri-apps/cli-linux-riscv64-gnu',
    '@tauri-apps/cli-linux-x64-gnu',
    '@tauri-apps/cli-linux-x64-musl',
    '@tauri-apps/cli-win32-arm64-msvc',
    '@tauri-apps/cli-win32-ia32-msvc',
    '@tauri-apps/cli-win32-x64-msvc',
  ]
  const platformRecords = platformPackages
    .map(
      (name) => `"${name}@npm:${version}":
  version: ${version}
  resolution: "${name}@npm:${version}"
`
    )
    .join('\n')
  const platformDependencies = platformPackages
    .map((name) => `    "${name}": "npm:${version}"`)
    .join('\n')
  return `${platformRecords}
"@tauri-apps/cli@npm:${version}":
  version: ${version}
  resolution: "@tauri-apps/cli@npm:${version}"
  dependencies:
${platformDependencies}

"biyan-app@workspace:.":
  version: 0.0.0-use.local
  resolution: "biyan-app@workspace:."
  dependencies:
    "@tauri-apps/cli": "npm:${version}"
`
}

test('Tauri CLI AppImage symlink fix is exact, current, and lock-consistent', () => {
  const exact = {
    devDependencies: { '@tauri-apps/cli': '2.11.4' },
    name: 'biyan-app',
  }
  assert.deepEqual(
    validateTauriCliAppImageContract(exact, tauriCliLock('2.11.4')),
    []
  )

  const downgraded = {
    ...exact,
    devDependencies: { '@tauri-apps/cli': '2.11.3' },
  }
  assert.ok(
    validateTauriCliAppImageContract(downgraded, tauriCliLock('2.11.3')).some(
      (failure) => failure.includes('at least 2.11.4')
    )
  )

  const ranged = {
    ...exact,
    devDependencies: { '@tauri-apps/cli': '^2.11.4' },
  }
  assert.ok(
    validateTauriCliAppImageContract(ranged, tauriCliLock('2.11.4')).some(
      (failure) => failure.includes('unscoped exact semantic version')
    )
  )

  assert.ok(
    validateTauriCliAppImageContract(exact, tauriCliLock('2.11.3')).some(
      (failure) => failure.includes('root workspace must lock')
    )
  )

  const mismatchedPlatform = tauriCliLock('2.11.4').replace(
    'resolution: "@tauri-apps/cli-linux-x64-gnu@npm:2.11.4"',
    'resolution: "@tauri-apps/cli-linux-x64-gnu@npm:2.8.4"'
  )
  assert.ok(
    validateTauriCliAppImageContract(exact, mismatchedPlatform).some(
      (failure) =>
        failure.includes(
          'Yarn lock @tauri-apps/cli-linux-x64-gnu record must resolve version 2.11.4'
        )
    )
  )
})

test('default desktop plugin and exactly three Biyan preinstall packages are locked', () => {
  const files = packagingFixture()
  const root = writeFixture(files)
  try {
    assert.deepEqual(validatePackagingCompatibilityContracts(root), [])

    fs.writeFileSync(
      path.join(root, 'src-tauri/Cargo.toml'),
      files['src-tauri/Cargo.toml'].replace(
        'desktop = ["deep-link", "hardware"]',
        'desktop = ["deep-link", "hardware", "unexpected-plugin"]'
      )
    )
    assert.ok(
      validatePackagingCompatibilityContracts(root).some((failure) =>
        failure.includes('desktop Cargo features must be exactly')
      )
    )
    fs.writeFileSync(
      path.join(root, 'src-tauri/Cargo.toml'),
      files['src-tauri/Cargo.toml']
    )

    fs.writeFileSync(
      path.join(root, 'src-tauri/Cargo.toml'),
      files['src-tauri/Cargo.toml'].replace(
        '  "desktop",',
        '  "desktop",\n  "unexpected",'
      )
    )
    assert.ok(
      validatePackagingCompatibilityContracts(root).some((failure) =>
        failure.includes('default Cargo features must be exactly')
      )
    )
    fs.writeFileSync(
      path.join(root, 'src-tauri/Cargo.toml'),
      files['src-tauri/Cargo.toml']
    )

    fs.writeFileSync(
      path.join(root, 'src-tauri/src/lib.rs'),
      `${files['src-tauri/src/lib.rs']}
app_builder = app_builder.plugin(tauri_plugin_unreviewed::init());
`
    )
    assert.ok(
      validatePackagingCompatibilityContracts(root).some((failure) =>
        failure.includes('Tauri plugin registrations must be exactly')
      )
    )
    fs.writeFileSync(
      path.join(root, 'src-tauri/src/lib.rs'),
      files['src-tauri/src/lib.rs']
    )

    const extraManifest = path.join(
      root,
      'extensions/retired-extension/package.json'
    )
    fs.mkdirSync(path.dirname(extraManifest), { recursive: true })
    fs.writeFileSync(
      extraManifest,
      '{"name":"@biyan/retired-extension","private":true}'
    )
    assert.ok(
      validatePackagingCompatibilityContracts(root).some((failure) =>
        failure.includes('preinstall extension directories must be exactly')
      )
    )
    fs.rmSync(path.dirname(extraManifest), { recursive: true })

    const assistantManifestPath = path.join(
      root,
      'extensions/assistant-extension/package.json'
    )
    fs.writeFileSync(
      assistantManifestPath,
      files['extensions/assistant-extension/package.json'].replace(
        '"version":"1.0.2"',
        '"version":"9.9.9"'
      )
    )
    assert.ok(
      validatePackagingCompatibilityContracts(root).some((failure) =>
        failure.includes(
          '@biyan/assistant-extension version must remain exactly 1.0.2'
        )
      )
    )
    fs.writeFileSync(
      assistantManifestPath,
      files['extensions/assistant-extension/package.json']
    )

    fs.writeFileSync(
      path.join(
        root,
        'src-tauri/gen/android/app/src/main/assets/resources/NOTICE'
      ),
      'drift\n'
    )
    assert.ok(
      validatePackagingCompatibilityContracts(root).some((failure) =>
        failure.includes('Android generated NOTICE must equal the root file')
      )
    )
  } finally {
    fs.rmSync(root, { force: true, recursive: true })
  }
})

test('retired docs route generator and alternate locks stay absent', () => {
  const files = packagingFixture()
  const root = writeFixture(files)
  try {
    assert.deepEqual(validatePackagingCompatibilityContracts(root), [])

    fs.writeFileSync(
      path.join(root, 'docs/package.json'),
      JSON.stringify({
        name: 'biyan-docs',
        packageManager: 'yarn@1.22.22',
        scripts: {
          'create:blogpost': 'plop create-blogpost',
        },
        dependencies: {
          'plop-helper-date': '^1.0.0',
        },
      })
    )
    const generatorFailures = validatePackagingCompatibilityContracts(root)
    assert.ok(
      generatorFailures.some((failure) =>
        failure.includes('must not recreate a retired publication route')
      )
    )
    assert.ok(
      generatorFailures.some((failure) =>
        failure.includes('retired generator package plop-helper-date')
      )
    )

    fs.writeFileSync(
      path.join(root, 'docs/package.json'),
      files['docs/package.json']
    )
    fs.writeFileSync(path.join(root, 'docs/plopfile.js'), 'module.exports = {}')
    assert.ok(
      validatePackagingCompatibilityContracts(root).some((failure) =>
        failure.includes(
          'docs/plopfile.js must stay absent from the canonical docs build'
        )
      )
    )
  } finally {
    fs.rmSync(root, { force: true, recursive: true })
  }
})

test('icon generation keeps its canonical source outside generated output', () => {
  const files = packagingFixture()
  const root = writeFixture(files)
  try {
    assert.deepEqual(validatePackagingCompatibilityContracts(root), [])

    const packageJson = JSON.parse(files['package.json'])
    packageJson.scripts['build:icon'] = 'tauri icon ./src-tauri/icons/icon.png'
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify(packageJson)
    )
    assert.ok(
      validatePackagingCompatibilityContracts(root).some((failure) =>
        failure.includes(
          'build:icon must use the canonical source outside generated output'
        )
      )
    )
    fs.writeFileSync(path.join(root, 'package.json'), files['package.json'])

    const canonicalPath = path.join(root, 'src-tauri/app-icon.png')
    const driftedCanonical = Buffer.from(files['src-tauri/app-icon.png'])
    driftedCanonical[driftedCanonical.length - 1] ^= 1
    fs.writeFileSync(canonicalPath, driftedCanonical)
    assert.ok(
      validatePackagingCompatibilityContracts(root).some((failure) =>
        failure.includes('canonical icon source digest changed')
      )
    )
    fs.writeFileSync(canonicalPath, files['src-tauri/app-icon.png'])

    const workflowPath = '.github/workflows/template-tauri-build-macos.yml'
    fs.writeFileSync(
      path.join(root, workflowPath),
      'cp .github/scripts/icon-${{ inputs.channel }}.png src-tauri/icons/icon.png\n'
    )
    const workflowFailures = validatePackagingCompatibilityContracts(root)
    assert.ok(
      workflowFailures.some((failure) =>
        failure.includes('must override the canonical icon source exactly once')
      )
    )
    assert.ok(
      workflowFailures.some((failure) =>
        failure.includes(
          'must not write a channel source into generated icon output'
        )
      )
    )
  } finally {
    fs.rmSync(root, { force: true, recursive: true })
  }
})

test('active docs media requires a resolvable source reference', () => {
  const files = {
    'docs/src/pages/guide.mdx':
      'import Diagram from "./assets/diagram.png"\n\n<Diagram />\n',
    'docs/src/pages/assets/diagram.png': Buffer.from([1, 2, 3]),
  }
  assert.deepEqual(validateFixture(files), [])

  const failures = validateFixture({
    ...files,
    'docs/src/pages/orphan.png': Buffer.from([4, 5, 6]),
  })
  assert.ok(
    failures.some((failure) =>
      failure.includes(
        'active docs asset must have an explicit source reference: docs/src/pages/orphan.png'
      )
    )
  )
})

test('archived docs media inventory canonicalizes only allowlisted text line endings', () => {
  const canonicalSvgPath =
    'docs/unpublished-upstream-history/assets/docs-src/old.svg'
  const byteExactSvgPath =
    'docs/unpublished-upstream-history/assets/docs-src/raw.svg'
  const files = {
    'docs/unpublished-upstream-history/assets/docs-src/old.png': Buffer.from([
      1, 2, 3,
    ]),
    [canonicalSvgPath]: '<svg>\n<path />\n</svg>\n',
    [byteExactSvgPath]: '<svg>\n<text>raw</text>\n</svg>\n',
  }
  const reviewed = allowlist([], [], files, [canonicalSvgPath])
  const root = writeFixture(files)
  try {
    assert.deepEqual(
      validateDocsAssetBoundary({
        allowlist: reviewed,
        contents: new Map(),
        repoRoot: root,
        trackedFiles: Object.keys(files),
      }),
      []
    )
    fs.writeFileSync(
      path.join(root, canonicalSvgPath),
      '<svg>\r\n<changed />\r\n</svg>\r\n'
    )
    assert.ok(
      validateDocsAssetBoundary({
        allowlist: reviewed,
        contents: new Map(),
        repoRoot: root,
        trackedFiles: Object.keys(files),
      }).some((failure) =>
        failure.includes('archived docs asset inventory digest changed')
      )
    )
    fs.writeFileSync(
      path.join(root, canonicalSvgPath),
      '<svg>\r\n<path />\r\n</svg>\r\n'
    )
    assert.deepEqual(
      validateDocsAssetBoundary({
        allowlist: reviewed,
        contents: new Map(),
        repoRoot: root,
        trackedFiles: Object.keys(files),
      }),
      []
    )
    fs.writeFileSync(
      path.join(root, canonicalSvgPath),
      '<svg>\r<path />\r</svg>\r'
    )
    assert.deepEqual(
      validateDocsAssetBoundary({
        allowlist: reviewed,
        contents: new Map(),
        repoRoot: root,
        trackedFiles: Object.keys(files),
      }),
      []
    )
    fs.writeFileSync(
      path.join(root, byteExactSvgPath),
      '<svg>\r\n<text>raw</text>\r\n</svg>\r\n'
    )
    assert.ok(
      validateDocsAssetBoundary({
        allowlist: reviewed,
        contents: new Map(),
        repoRoot: root,
        trackedFiles: Object.keys(files),
      }).some((failure) =>
        failure.includes('archived docs asset inventory digest changed')
      )
    )
    fs.writeFileSync(
      path.join(root, byteExactSvgPath),
      '<svg>\n<text>raw</text>\n</svg>\n'
    )
    fs.writeFileSync(
      path.join(
        root,
        'docs/unpublished-upstream-history/assets/docs-src/old.png'
      ),
      Buffer.from([3, 2, 1])
    )
    assert.ok(
      validateDocsAssetBoundary({
        allowlist: reviewed,
        contents: new Map(),
        repoRoot: root,
        trackedFiles: Object.keys(files),
      }).some((failure) =>
        failure.includes('archived docs asset inventory digest changed')
      )
    )
    fs.writeFileSync(
      path.join(
        root,
        'docs/unpublished-upstream-history/assets/docs-src/old.png'
      ),
      Buffer.from([1, 13, 10, 3])
    )
    assert.ok(
      validateDocsAssetBoundary({
        allowlist: reviewed,
        contents: new Map(),
        repoRoot: root,
        trackedFiles: Object.keys(files),
      }).some((failure) =>
        failure.includes('archived docs asset inventory digest changed')
      )
    )
  } finally {
    fs.rmSync(root, { force: true, recursive: true })
  }

  const expandedFiles = {
    ...files,
    'docs/unpublished-upstream-history/assets/docs-src/extra.png': Buffer.from([
      4, 5, 6,
    ]),
  }
  const expandedRoot = writeFixture(expandedFiles)
  try {
    assert.ok(
      validateDocsAssetBoundary({
        allowlist: reviewed,
        contents: new Map(),
        repoRoot: expandedRoot,
        trackedFiles: Object.keys(expandedFiles),
      }).some((failure) =>
        failure.includes(
          'archived docs asset inventory expected 3 files but found 4'
        )
      )
    )
  } finally {
    fs.rmSync(expandedRoot, { force: true, recursive: true })
  }
})

test('archived docs canonical text path allowlist rejects broadening and stale entries', () => {
  const reviewed = allowlist()
  reviewed.archivedDocsAssets.canonicalTextPaths = [
    'docs/unpublished-upstream-history/assets/exact.svg',
    'docs/unpublished-upstream-history/assets/exact.svg',
    'outside/archive.svg',
  ]
  const failures = validateLegacyCompatibilityAllowlist(reviewed)
  assert.ok(
    failures.some((failure) =>
      failure.includes(
        'duplicate archived docs canonical text path docs/unpublished-upstream-history/assets/exact.svg'
      )
    )
  )
  assert.ok(
    failures.some((failure) =>
      failure.includes(
        'archived docs canonical text path must be normalized and inside'
      )
    )
  )

  const root = writeFixture({})
  try {
    assert.ok(
      inspectDocsArchiveInventory(
        root,
        [],
        'docs/unpublished-upstream-history/assets/',
        ['docs/unpublished-upstream-history/assets/missing.svg']
      ).failures.some((failure) =>
        failure.includes('archived docs canonical text path is not tracked')
      )
    )
  } finally {
    fs.rmSync(root, { force: true, recursive: true })
  }
})

test('digest allowlist schema requires explicit cross-platform byte semantics', () => {
  const legacySchema = allowlist()
  legacySchema.schema = 1
  assert.ok(
    validateLegacyCompatibilityAllowlist(legacySchema).some((failure) =>
      failure.includes('legacy compatibility allowlist schema must be 2')
    )
  )

  const missingMode = allowlist([], [
    {
      id: 'missing-digest-mode',
      path: 'src/generated.ts',
      reason: 'This exact fixture intentionally omits its digest byte semantics.',
      sha256: '0'.repeat(64),
    },
  ])
  assert.ok(
    validateLegacyCompatibilityAllowlist(missingMode).some((failure) =>
      failure.includes('must declare byte-exact or text-lf digestMode')
    )
  )
})

test('generated and vendored exclusions explicitly lock text or binary digests', () => {
  const files = { 'src/generated.ts': 'export const value = "Biyan"\n' }
  const digest = crypto
    .createHash('sha256')
    .update(files['src/generated.ts'])
    .digest('hex')
  const exclusion = {
    digestMode: 'text-lf',
    id: 'generated-fixture',
    path: 'src/generated.ts',
    reason: 'Generated fixture is reviewed and locked by exact digest.',
    sha256: digest,
  }
  assert.deepEqual(validateFixture(files, [], [exclusion]), [])
  assert.deepEqual(
    validateFixture(
      { 'src/generated.ts': 'export const value = "Biyan"\r\n' },
      [],
      [exclusion]
    ),
    []
  )
  assert.deepEqual(
    validateFixture(
      { 'src/generated.ts': 'export const value = "Biyan"\r' },
      [],
      [exclusion]
    ),
    []
  )
  const failures = validateFixture(
    { 'src/generated.ts': 'export const value = "changed"\n' },
    [],
    [exclusion]
  )
  assert.ok(
    failures.some((failure) => failure.includes('excluded file digest changed'))
  )
  assert.ok(
    validateFixture(
      { 'src/generated.ts': Buffer.from([0xff, 0xfe, 0xfd]) },
      [],
      [exclusion]
    ).some((failure) =>
      failure.includes('text-lf digest input must be valid UTF-8 text')
    )
  )
  assert.ok(
    validateFixture(
      { 'src/generated.ts': Buffer.from([0x41, 0, 0x42]) },
      [],
      [exclusion]
    ).some((failure) =>
      failure.includes('text-lf digest input must be valid UTF-8 text')
    )
  )

  const binaryFiles = {
    'src/vendored.ico': Buffer.from([1, 13, 10, 2]),
  }
  const binaryExclusion = {
    digestMode: 'byte-exact',
    id: 'binary-fixture',
    path: 'src/vendored.ico',
    reason: 'Vendored binary fixture is reviewed and locked byte for byte.',
    sha256: crypto
      .createHash('sha256')
      .update(binaryFiles['src/vendored.ico'])
      .digest('hex'),
  }
  assert.deepEqual(validateFixture(binaryFiles, [], [binaryExclusion]), [])
  assert.ok(
    validateFixture(
      { 'src/vendored.ico': Buffer.from([1, 10, 2]) },
      [],
      [binaryExclusion]
    ).some((failure) => failure.includes('excluded file digest changed'))
  )
})

test('repository legacy compatibility policy is internally consistent', () => {
  assert.deepEqual(validateLegacyCompatibilityRepository(repoRoot), [])
})
