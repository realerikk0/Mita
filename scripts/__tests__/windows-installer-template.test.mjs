import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const template = fs.readFileSync('src-tauri/tauri.bundle.windows.nsis.template', 'utf8')

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
  assert.match(template, /DeleteRegKey HKLM "\$\{LEGACY_UNINSTKEY\}"/)
  assert.match(template, /DeleteRegKey HKLM "\$\{LEGACY_MANUPRODUCTKEY\}"/)
})

test('Windows NSIS installer migrates legacy Mita shortcuts to Biyan shortcuts', () => {
  assert.match(template, /\$\{LEGACY_PRODUCTNAME\}\.lnk/)
  assert.match(template, /CreateShortcut "\$SMPROGRAMS\\\$\{PRODUCTNAME\}\.lnk"/)
  assert.match(template, /CreateShortcut "\$DESKTOP\\\$\{PRODUCTNAME\}\.lnk"/)
})

test('Windows NSIS installer detects legacy Mita installs without registry state', () => {
  assert.match(template, /Function DetectLegacyInstallLocation/)
  assert.match(template, /ReadRegStr \$LegacyInstallDir HKLM "\$\{LEGACY_MANUPRODUCTKEY\}" ""/)
  assert.match(template, /\$LOCALAPPDATA\\Programs\\\$\{LEGACY_PRODUCTNAME\}/)
  assert.match(template, /FileExists.*\$LegacyInstallDir\\\$\{MAINBINARYNAME\}\.exe/s)
  assert.match(template, /Call DetectLegacyInstallLocation[\s\S]*StrCpy \$INSTDIR \$LegacyInstallDir/)
})

test('Windows NSIS installer removes stale legacy Mita entry points', () => {
  assert.match(template, /Function RemoveLegacyMitaShortcuts/)
  assert.match(template, /Delete "\$DESKTOP\\\$\{LEGACY_PRODUCTNAME\}\.lnk"/)
  assert.match(template, /Delete "\$SMPROGRAMS\\\$\{LEGACY_PRODUCTNAME\}\.lnk"/)
  assert.match(template, /User Pinned\\TaskBar\\\$\{LEGACY_PRODUCTNAME\}\.lnk/)
  assert.match(template, /User Pinned\\StartMenu\\\$\{LEGACY_PRODUCTNAME\}\.lnk/)
})

test('Windows NSIS installer removes separate legacy Mita install folder after Biyan install', () => {
  assert.match(template, /Function CleanupLegacyMitaInstall/)
  assert.match(template, /Call RemoveLegacyMitaShortcuts/)
  assert.match(template, /DeleteRegKey HKCU "\$\{LEGACY_UNINSTKEY\}"/)
  assert.match(template, /RMDir \/r \/REBOOTOK "\$LegacyInstallDir\\resources"/)
  assert.match(template, /RMDir \/REBOOTOK "\$LegacyInstallDir"/)
})
