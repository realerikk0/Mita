import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { EXPECTED_PREINSTALL_PACKAGE_IDENTITIES } from '../ci/candidate-content-policy.mjs'

const template = fs.readFileSync('src-tauri/tauri.bundle.windows.nsis.template', 'utf8')
const windowsBuildWorkflow = fs.readFileSync(
  '.github/workflows/template-tauri-build-windows-x64.yml',
  'utf8',
)
const desktopReleaseWorkflow = fs.readFileSync(
  '.github/workflows/desktop-release.yml',
  'utf8',
)
const prCiWorkflow = fs.readFileSync(
  '.github/workflows/biyan-linter-and-test.yml',
  'utf8',
)
const releaseVersionSource = fs.readFileSync('scripts/release-version.mjs', 'utf8')
const windowsConfig = JSON.parse(
  fs.readFileSync('src-tauri/tauri.windows.conf.json', 'utf8'),
)
const makefile = fs.readFileSync('Makefile', 'utf8')
const libSource = fs.readFileSync('src-tauri/src/lib.rs', 'utf8')
const setupSource = fs.readFileSync('src-tauri/src/core/setup.rs', 'utf8')

function functionBody(name) {
  const match = template.match(
    new RegExp(
      `^Function[ \\t]+${escapeRegex(name)}[ \\t]*\\r?\\n([\\s\\S]*?)^FunctionEnd[ \\t]*\\r?$`,
      'm',
    ),
  )
  assert.ok(match, `expected ${name} function to exist`)
  return match[1]
}

function sectionBody(name) {
  const match = template.match(
    new RegExp(
      `^Section[ \\t]+${escapeRegex(name)}[ \\t]*\\r?\\n([\\s\\S]*?)^SectionEnd[ \\t]*\\r?$`,
      'm',
    ),
  )
  assert.ok(match, `expected ${name} section to exist`)
  return match[1]
}

test('Windows NSIS installer keeps legacy Mita update migration hooks', () => {
  assert.match(template, /!define LEGACY_PRODUCTNAME "Mita"/)
  assert.match(
    template,
    /!define LEGACY_UNINSTKEY "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\\$\{LEGACY_PRODUCTNAME\}"/,
  )
  assert.match(template, /!define LEGACY_MANUPRODUCTKEY "\$\{MANUKEY\}\\\$\{LEGACY_PRODUCTNAME\}"/)
  assert.match(template, /ReadRegStr \$LegacyInstallDir SHCTX "\$\{LEGACY_MANUPRODUCTKEY\}" ""/)
  assert.match(template, /ReadRegStr \$R1 SHCTX "\$PreviousUninstKey" "UninstallString"/)
  assert.match(template, /ReadRegStr \$R0 SHCTX "\$PreviousUninstKey" "DisplayVersion"/)
  assert.match(template, /DeleteRegKey HKCU "\$\{LEGACY_UNINSTKEY\}"/)
  assert.match(template, /DeleteRegKey HKCU "\$\{LEGACY_MANUPRODUCTKEY\}"/)
  assert.doesNotMatch(template, /ReadRegStr [^\n]+ HKLM "\$\{LEGACY_MANUPRODUCTKEY\}" ""/)
  assert.doesNotMatch(template, /DeleteRegKey HKLM "\$\{LEGACY_UNINSTKEY\}"/)
  assert.doesNotMatch(template, /DeleteRegKey HKLM "\$\{LEGACY_MANUPRODUCTKEY\}"/)
  assert.doesNotMatch(template, /LegacyInstallDetected/)
})

test('Windows NSIS installer migrates legacy Mita shortcuts to Biyan shortcuts', () => {
  assert.match(template, /\$\{LEGACY_PRODUCTNAME\}\.lnk/)
  assert.match(template, /CreateShortcut "\$SMPROGRAMS\\\$\{PRODUCTNAME\}\.lnk"/)
  assert.match(template, /CreateShortcut "\$DESKTOP\\\$\{PRODUCTNAME\}\.lnk"/)
  assert.match(functionBody('CreateOrUpdateStartMenuShortcut'), /\$LegacyShortcutFound = 1/)
  assert.match(functionBody('CreateOrUpdateDesktopShortcut'), /\$LegacyShortcutFound = 1/)
  assert.doesNotMatch(functionBody('CreateOrUpdateStartMenuShortcut'), /\$LegacyInstallDetected = 1/)
  assert.doesNotMatch(functionBody('CreateOrUpdateDesktopShortcut'), /\$LegacyInstallDetected = 1/)
})

test('Windows NSIS installer detects legacy Mita installs without registry state', () => {
  const detectLegacyInstallLocation = functionBody('DetectLegacyInstallLocation')

  assert.doesNotMatch(
    detectLegacyInstallLocation,
    /ReadRegStr \$LegacyInstallDir HKLM "\$\{LEGACY_MANUPRODUCTKEY\}" ""/,
  )
  assert.match(detectLegacyInstallLocation, /\$LOCALAPPDATA\\Programs\\\$\{LEGACY_PRODUCTNAME\}/)
  assert.match(
    detectLegacyInstallLocation,
    /FileExists.*\$LegacyInstallDir\\\$\{MAINBINARYNAME\}\.exe/s,
  )
  assert.match(
    detectLegacyInstallLocation,
    /FileExists.*\$LegacyInstallDir\\\$\{LEGACY_PRODUCTNAME\}\.exe/s,
  )
  assert.match(
    detectLegacyInstallLocation,
    /FileExists.*\$LegacyInstallDir\\\$\{LEGACY_MAINBINARYNAME\}\.exe/s,
  )
  assert.doesNotMatch(functionBody('RestorePreviousInstallLocation'), /\$\{LEGACY_MANUPRODUCTKEY\}/)
  assert.doesNotMatch(
    functionBody('RestorePreviousInstallLocation'),
    /StrCpy \$INSTDIR \$LegacyInstallDir/,
  )
})

test('Windows NSIS installer migrates legacy Mita install directories to Biyan', () => {
  const restorePreviousInstallLocation = functionBody('RestorePreviousInstallLocation')

  assert.match(restorePreviousInstallLocation, /ReadRegStr \$4 SHCTX "\$\{MANUPRODUCTKEY\}" ""/)
  assert.match(restorePreviousInstallLocation, /Call DetectLegacyInstallLocation/)
  assert.match(restorePreviousInstallLocation, /\$\{StrCase\} \$R8 \$4 "L"/)
  assert.match(restorePreviousInstallLocation, /\$\{StrCase\} \$R9 \$LegacyInstallDir "L"/)
  assert.match(restorePreviousInstallLocation, /\$\{If\} \$R8 == \$R9[\s\S]*?Return/)
  assert.match(restorePreviousInstallLocation, /StrCpy \$INSTDIR \$4/)

  const compareIndex = restorePreviousInstallLocation.indexOf('${StrCase} $R8 $4 "L"')
  const restoreIndex = restorePreviousInstallLocation.indexOf('StrCpy $INSTDIR $4')
  assert.ok(compareIndex < restoreIndex, 'legacy path comparison should run before restoring $4')
})

test('Windows NSIS installer removes stale legacy Mita entry points', () => {
  const removeLegacyMitaShortcuts = functionBody('RemoveLegacyMitaShortcuts')

  assert.match(removeLegacyMitaShortcuts, /Delete "\$DESKTOP\\\$\{LEGACY_PRODUCTNAME\}\.lnk"/)
  assert.match(removeLegacyMitaShortcuts, /Delete "\$SMPROGRAMS\\\$\{LEGACY_PRODUCTNAME\}\.lnk"/)
  assert.match(removeLegacyMitaShortcuts, /User Pinned\\TaskBar\\\$\{LEGACY_PRODUCTNAME\}\.lnk/)
  assert.match(removeLegacyMitaShortcuts, /User Pinned\\StartMenu\\\$\{LEGACY_PRODUCTNAME\}\.lnk/)
})

test('Windows NSIS installer leaves legacy install directory deletion to runtime self-heal', () => {
  const cleanupLegacyMitaInstall = functionBody('CleanupLegacyMitaInstall')

  assert.match(cleanupLegacyMitaInstall, /Call RemoveLegacyMitaShortcuts/)
  assert.match(cleanupLegacyMitaInstall, /DeleteRegKey HKCU "\$\{LEGACY_UNINSTKEY\}"/)
  assert.doesNotMatch(cleanupLegacyMitaInstall, /\$LegacyInstallDir != "\$INSTDIR"/)
  assert.doesNotMatch(cleanupLegacyMitaInstall, /RMDir .*"\$LegacyInstallDir/)
  assert.doesNotMatch(cleanupLegacyMitaInstall, /Delete "\$LegacyInstallDir/)
})

test('Windows NSIS installer cleans retired product resources before copying an upgrade', () => {
  const install = sectionBody('Install')
  const appRunningCheck = install.indexOf('!insertmacro CheckIfAppIsRunning')
  const ownershipCheck = install.indexOf('Call DetectOwnedBiyanInstallLocation')
  const ownershipGate = install.indexOf('${If} $OwnedExistingInstall = 1')
  const legacyAppCheck = install.indexOf(
    '!insertmacro CheckIfAppIsRunning "${LEGACY_PRODUCTNAME}.exe"',
  )
  const legacyCliCheck = install.indexOf(
    '!insertmacro CheckIfAppIsRunning "${LEGACY_MAINBINARYNAME}-cli.exe"',
  )
  const legacyRunnerCheck = install.indexOf(
    '!insertmacro CheckIfAppIsRunning "${LEGACY_MAINBINARYNAME}-computer-agent-runner.exe"',
  )
  const cleanup = install.indexOf('Call RemoveRetiredBiyanInstallResources')
  const unownedReject = install.indexOf('Call RejectUnownedRetiredBiyanResources')
  const mainCopy = install.indexOf('File "${MAINBINARYSRCPATH}"')
  const resourceCopy = install.indexOf('{{#each resources}}')
  const verify = install.indexOf('Call VerifyInstalledBiyanResources')
  const binaryCopy = install.indexOf('{{#each binaries}}')

  for (const index of [
    appRunningCheck,
    ownershipCheck,
    ownershipGate,
    legacyAppCheck,
    legacyCliCheck,
    legacyRunnerCheck,
    cleanup,
    unownedReject,
    mainCopy,
    resourceCopy,
    verify,
    binaryCopy,
  ]) {
    assert.notEqual(index, -1)
  }
  assert.ok(appRunningCheck < ownershipCheck)
  assert.ok(ownershipCheck < ownershipGate)
  assert.ok(ownershipGate < legacyAppCheck)
  assert.ok(legacyAppCheck < legacyCliCheck)
  assert.ok(legacyCliCheck < legacyRunnerCheck)
  assert.ok(legacyRunnerCheck < cleanup)
  assert.ok(cleanup < unownedReject)
  assert.ok(cleanup < mainCopy)
  assert.ok(mainCopy < resourceCopy)
  assert.ok(resourceCopy < binaryCopy)
  assert.ok(binaryCopy < verify)
  assert.match(
    install,
    /\$\{If\} \$OwnedExistingInstall = 1[\s\S]*?!insertmacro CheckIfAppIsRunning "\$\{LEGACY_PRODUCTNAME\}\.exe"[\s\S]*?!insertmacro CheckIfAppIsRunning "\$\{LEGACY_MAINBINARYNAME\}-cli\.exe"[\s\S]*?!insertmacro CheckIfAppIsRunning "\$\{LEGACY_MAINBINARYNAME\}-computer-agent-runner\.exe"[\s\S]*?Call RemoveRetiredBiyanInstallResources\s+\$\{Else\}\s+Call RejectUnownedRetiredBiyanResources\s+\$\{EndIf\}/,
  )

  const cleanupBody = functionBody('RemoveRetiredBiyanInstallResources')
  assert.match(cleanupBody, /RMDir \/r "\$INSTDIR\\resources\\pre-install"/)
  assert.match(cleanupBody, /RMDir \/r "\$INSTDIR\\resources\\embedding-models"/)
  assert.doesNotMatch(cleanupBody, /\/REBOOTOK/)
  assert.doesNotMatch(cleanupBody, /\$(?:APPDATA|LOCALAPPDATA|PROFILE)/)
  assert.doesNotMatch(cleanupBody, /RMDir \/r "\$INSTDIR(?:\\resources)?"/)

  const retiredFiles = [
    '$INSTDIR\\${LEGACY_MAINBINARYNAME}-cli.exe',
    '$INSTDIR\\${LEGACY_MAINBINARYNAME}-computer-agent-runner.exe',
    '$INSTDIR\\resources\\bin\\${LEGACY_MAINBINARYNAME}.exe',
    '$INSTDIR\\resources\\bin\\${LEGACY_MAINBINARYNAME}-cli.exe',
    '$INSTDIR\\resources\\bin\\${LEGACY_MAINBINARYNAME}-web-research-mcp.mjs',
    '$INSTDIR\\resources\\computer-agent-runner\\${LEGACY_MAINBINARYNAME}-computer-agent-runner.exe',
  ]
  for (const retiredFile of retiredFiles) {
    assert.match(cleanupBody, new RegExp(`Delete "${escapeRegex(retiredFile)}"`))
    assert.match(
      cleanupBody,
      new RegExp(
        `Delete "${escapeRegex(retiredFile)}"[\\s\\S]*?FileExists.*${escapeRegex(retiredFile)}`,
      ),
    )
  }
  assert.ok(
    cleanupBody.match(/Abort "Biyan /g)?.length >= retiredFiles.length + 4,
    'every reviewed cleanup class must fail closed',
  )
})

test('Windows NSIS installer never cleans an unowned fresh or custom install directory', () => {
  const detectOwnership = functionBody('DetectOwnedBiyanInstallLocation')
  assert.match(detectOwnership, /StrCpy \$OwnedExistingInstall 0/)
  assert.match(detectOwnership, /ReadRegStr \$R4 SHCTX "\$\{MANUPRODUCTKEY\}" ""/)
  assert.match(
    detectOwnership,
    /ReadRegStr \$R4 SHCTX "\$\{LEGACY_MANUPRODUCTKEY\}" ""/,
  )
  assert.match(
    detectOwnership,
    /ReadRegStr \$R4 HKCU "\$\{LEGACY_MANUPRODUCTKEY\}" ""/,
  )
  assert.match(detectOwnership, /\$\{StrCase\} \$R8 \$INSTDIR "L"/)
  assert.match(detectOwnership, /\$\{StrCase\} \$R9 \$R4 "L"/)
  assert.match(
    detectOwnership,
    /\$\{If\} \$R8 == \$R9[\s\S]*?StrCpy \$OwnedExistingInstall 1/,
  )
  assert.doesNotMatch(detectOwnership, /FileExists/)

  const rejectUnowned = functionBody('RejectUnownedRetiredBiyanResources')
  assert.match(rejectUnowned, /\$INSTDIR\\resources\\pre-install\\\*\.\*/)
  assert.match(rejectUnowned, /\$INSTDIR\\resources\\embedding-models\\\*\.\*/)
  assert.match(rejectUnowned, /Installation was cancelled without deleting/)
  assert.doesNotMatch(rejectUnowned, /\b(?:Delete|RMDir)\b/)
  assert.doesNotMatch(rejectUnowned, /\$(?:APPDATA|LOCALAPPDATA|PROFILE)/)
})

test('Windows NSIS installer accepts exactly the three reviewed Biyan extension archives', () => {
  const verify = functionBody('VerifyInstalledBiyanResources')
  const expectedArchives = EXPECTED_PREINSTALL_PACKAGE_IDENTITIES.map(
    ({ file }) => file,
  )

  for (const archive of expectedArchives) {
    const archiveDefine = template.match(
      new RegExp(`!define (BIYAN_[A-Z_]+) "${escapeRegex(archive)}"`),
    )
    assert.ok(archiveDefine, `expected an NSIS define for ${archive}`)
    assert.match(
      verify,
      new RegExp(`StrCmp \\$R1 "\\$\\{${archiveDefine[1]}\\}"`),
    )
  }
  assert.match(verify, /FindFirst \$R0 \$R1 "\$INSTDIR\\resources\\pre-install\\\*\.\*"/)
  assert.match(verify, /FindNext \$R0 \$R1/)
  assert.match(verify, /FindClose \$R0/)
  const inspectEntry = verify.indexOf(
    '${GetFileAttributes} "$INSTDIR\\resources\\pre-install\\$R1" "DIRECTORY" $R3',
  )
  const compareAllowed = verify.indexOf(
    'StrCmp $R1 "${BIYAN_ASSISTANT_EXTENSION_ARCHIVE}"',
  )
  assert.notEqual(inspectEntry, -1)
  assert.notEqual(compareAllowed, -1)
  assert.ok(inspectEntry < compareAllowed)
  assert.match(verify, /IntCmp \$R3 0 biyan_extension_inventory_compare/)
  assert.match(verify, /Abort "Biyan found an unreviewed extension directory/)
  assert.match(
    verify,
    new RegExp(
      `IntCmp \\$R2 ${expectedArchives.length} biyan_extension_inventory_valid biyan_extension_inventory_invalid biyan_extension_inventory_invalid`,
    ),
  )
  assert.match(verify, /Abort "Biyan found an unreviewed extension package/)
  assert.match(verify, /Abort "Biyan extension package inventory is incomplete/)
})

test('Windows runtime keeps retired Jan extension IDs outside the compatibility allowlist', () => {
  const allowlist = setupSource.match(
    /const ALLOWED_BUNDLED_EXTENSION_IDS: &\[&str\] = &\[([\s\S]*?)\];/,
  )
  assert.ok(allowlist)
  assert.deepEqual([...allowlist[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]), [
    '@biyan/assistant-extension',
    '@biyan/conversational-extension',
    '@biyan/download-extension',
  ])

  const retiredExtensionIds = [
    '@janhq/assistant-extension',
    '@janhq/conversational-extension',
    '@janhq/download-extension',
    '@janhq/llamacpp-extension',
    '@janhq/rag-extension',
    '@janhq/vector-db-extension',
  ]
  for (const id of retiredExtensionIds) {
    assert.doesNotMatch(setupSource, new RegExp(escapeRegex(id)))
  }
})

test('Windows stable build template publishes Biyan installer artifacts', () => {
  assert.match(windowsBuildWorkflow, /s\/biyan_productname\/Biyan\/g/)
  assert.match(windowsBuildWorkflow, /s\/biyan_mainbinaryname\/Biyan\/g/)
  assert.match(windowsBuildWorkflow, /FILE_NAME=Biyan_\$\{\{ inputs\.new_version \}\}_x64-setup\.exe/)
  assert.match(windowsBuildWorkflow, /WIN_SIG=\$\(cat Biyan_\$\{\{ inputs\.new_version \}\}_x64-setup\.exe\.sig\)/)
  assert.match(windowsBuildWorkflow, /MSI_FILE="Biyan_\$\{\{ inputs\.new_version \}\}_x64_en-US\.msi"/)
  assert.doesNotMatch(windowsBuildWorkflow, /FILE_NAME=Mita_\$\{\{ inputs\.new_version \}\}_x64-setup\.exe/)
})

test('production Windows builds cannot silently drop the reviewed NSIS template', () => {
  assert.equal(
    windowsConfig.bundle.windows.nsis.template,
    'tauri.bundle.windows.nsis.template',
  )
  assert.match(
    releaseVersionSource,
    /json\.bundle\.windows\.nsis\.template = 'tauri\.bundle\.windows\.nsis\.template'/,
  )
  assert.doesNotMatch(
    releaseVersionSource,
    /delete json\.bundle\.windows\.nsis\.template/,
  )

  const windowsBuild = desktopReleaseWorkflow.slice(
    desktopReleaseWorkflow.indexOf('  build-windows:'),
    desktopReleaseWorkflow.indexOf('  build-linux:'),
  )
  const stamp = windowsBuild.indexOf(
    'node scripts/release-version.mjs stamp "$VERSION" --windows',
  )
  const build = windowsBuild.indexOf('run: make build')
  assert.notEqual(stamp, -1)
  assert.notEqual(build, -1)
  assert.ok(stamp < build, 'Windows template binding must happen before make build')
})

test('focused PR Windows builds disable updater artifacts after stamping', () => {
  const buildStep = prCiWorkflow.slice(
    prCiWorkflow.indexOf(
      '      - name: Build focused unsigned Windows candidate',
    ),
    prCiWorkflow.indexOf(
      '      - name: Verify focused unsigned Windows candidate',
    ),
  )
  const stamp = buildStep.indexOf(
    '& node scripts/release-version.mjs stamp $version --windows',
  )
  const disableUpdaterArtifacts = buildStep.indexOf(
    '$tauriConfig.bundle.createUpdaterArtifacts = $false',
  )
  const readback = buildStep.indexOf(
    'if ($unsignedConfig.bundle.createUpdaterArtifacts -ne $false) {',
  )
  const build = buildStep.indexOf('make build')

  assert.notEqual(stamp, -1)
  assert.notEqual(disableUpdaterArtifacts, -1)
  assert.notEqual(readback, -1)
  assert.notEqual(build, -1)
  assert.ok(stamp < disableUpdaterArtifacts)
  assert.ok(disableUpdaterArtifacts < readback)
  assert.ok(readback < build)
})

test('reusable stable Windows builds verify the rendered NSIS contract without breaking non-stable channels', () => {
  const verifyStep = windowsBuildWorkflow.slice(
    windowsBuildWorkflow.indexOf('      - name: Verify extracted Windows candidate'),
    windowsBuildWorkflow.indexOf('      - name: Upload NSIS Installer Artifact'),
  )
  const stableGate = verifyStep.indexOf(
    "if ('${{ inputs.channel }}' -eq 'stable') {",
  )
  const renderedScript = verifyStep.indexOf(
    "'src-tauri/target/release/nsis/x64/installer.nsi'",
  )
  const invocation = verifyStep.indexOf(
    '& ./scripts/ci/verify-windows-candidate.ps1 @verifier',
  )

  assert.notEqual(stableGate, -1)
  assert.notEqual(renderedScript, -1)
  assert.notEqual(invocation, -1)
  assert.ok(stableGate < renderedScript && renderedScript < invocation)
})

test('passive and silent Windows installs launch Biyan only with an explicit /R flag', () => {
  const onInstallSuccess = functionBody('.onInstSuccess')
  const restartOption = onInstallSuccess.indexOf(
    '${GetOptions} $CMDLINE "/R" $R0',
  )
  const restartGate = onInstallSuccess.indexOf('${IfNot} ${Errors}')
  const run = onInstallSuccess.indexOf(
    'nsis_tauri_utils::RunAsUser "$INSTDIR\\${MAINBINARYNAME}.exe" "$R0"',
  )

  assert.notEqual(restartOption, -1)
  assert.notEqual(restartGate, -1)
  assert.notEqual(run, -1)
  assert.ok(restartOption < restartGate && restartGate < run)
  assert.doesNotMatch(onInstallSuccess, /;\s*\$\{GetOptions\} \$CMDLINE "\/R"/)
})

test('Windows NSIS installer rejects normal application downgrades', () => {
  assert.match(template, /!define ALLOWDOWNGRADES "false"/)
})

test('Windows NSIS installer template tests run from Makefile test target', () => {
  assert.match(
    makefile,
    /node --test \.\/scripts\/__tests__\/windows-installer-template\.test\.mjs/,
  )
  assert.doesNotMatch(makefile, /node --test \.\/scripts\/__tests__\/\*\.test\.mjs/)
})

test('Windows startup self-heal marks migration only after success', () => {
  const spawnIndex = libSource.indexOf('tauri::async_runtime::spawn_blocking')
  const runIndex = libSource.indexOf('core::windows_migration::run_biyan_windows_migration()')
  const markerIndex = libSource.search(
    /store\s*\.set\(\s*WINDOWS_BIYAN_MIGRATED_KEY/,
  )

  assert.notEqual(spawnIndex, -1)
  assert.notEqual(runIndex, -1)
  assert.notEqual(markerIndex, -1)
  assert.ok(spawnIndex < runIndex, 'migration should run inside spawn_blocking')
  assert.ok(runIndex < markerIndex, 'migration marker should be written after migration succeeds')
})

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
