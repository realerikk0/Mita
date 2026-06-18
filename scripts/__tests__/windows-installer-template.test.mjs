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
  assert.match(template, /DeleteRegKey SHCTX "\$\{LEGACY_UNINSTKEY\}"/)
  assert.match(template, /DeleteRegKey SHCTX "\$\{LEGACY_MANUPRODUCTKEY\}"/)
})

test('Windows NSIS installer migrates legacy Mita shortcuts to Biyan shortcuts', () => {
  assert.match(template, /\$\{LEGACY_PRODUCTNAME\}\.lnk/)
  assert.match(template, /CreateShortcut "\$SMPROGRAMS\\\$\{PRODUCTNAME\}\.lnk"/)
  assert.match(template, /CreateShortcut "\$DESKTOP\\\$\{PRODUCTNAME\}\.lnk"/)
})
