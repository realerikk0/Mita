import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const template = fs.readFileSync('src-tauri/tauri.bundle.windows.nsis.template', 'utf8')
const makefile = fs.readFileSync('Makefile', 'utf8')
const libSource = fs.readFileSync('src-tauri/src/lib.rs', 'utf8')

function functionBody(name) {
  const match = template.match(new RegExp(`Function ${name}([\\s\\S]*?)FunctionEnd`))
  assert.ok(match, `expected ${name} function to exist`)
  return match[1]
}

test('Windows NSIS installer keeps legacy Mita update migration hooks', () => {
  assert.match(template, /!define LEGACY_PRODUCTNAME "Mita"/)
  assert.match(
    template,
    /!define LEGACY_UNINSTKEY "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\\$\{LEGACY_PRODUCTNAME\}"/,
  )
  assert.match(template, /!define LEGACY_MANUPRODUCTKEY "\$\{MANUKEY\}\\\$\{LEGACY_PRODUCTNAME\}"/)
  assert.match(template, /ReadRegStr \$4 SHCTX "\$\{LEGACY_MANUPRODUCTKEY\}" ""/)
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
  assert.match(functionBody('RestorePreviousInstallLocation'), /StrCpy \$INSTDIR \$LegacyInstallDir/)
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
  const markerIndex = libSource.indexOf('store.set(WINDOWS_BIYAN_MIGRATED_KEY')

  assert.notEqual(spawnIndex, -1)
  assert.notEqual(runIndex, -1)
  assert.notEqual(markerIndex, -1)
  assert.ok(spawnIndex < runIndex, 'migration should run inside spawn_blocking')
  assert.ok(runIndex < markerIndex, 'migration marker should be written after migration succeeds')
})
