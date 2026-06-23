import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const script = fs.readFileSync('scripts/verify-thinking-content-windows.ps1', 'utf8')

test('thinking content Windows verifier writes a complete evidence package', () => {
  assert.match(
    script,
    /\$VerificationLog\s*=\s*Join-Path \$OutputDir "thinking-content-windows-verification\.log"/,
  )
  assert.match(script, /Start-Transcript -Path \$VerificationLog -Force/)
  assert.match(script, /Stop-Transcript/)
  assert.match(script, /\$TauriWarmupSeconds\s*=\s*600/)
  assert.match(script, /\$env:THINKING_CONTENT_OUTPUT_DIR\s*=\s*\$OutputDir/)
  assert.match(script, /\$env:THINKING_CONTENT_READY_TIMEOUT_MS\s*=\s*"180000"/)
  assert.match(script, /thinking-content-vite-stdout\.log/)
  assert.match(script, /thinking-content-vite-stderr\.log/)
  assert.match(script, /thinking-content-tauri-stdout\.log/)
  assert.match(script, /thinking-content-tauri-stderr\.log/)
  assert.match(script, /RedirectStandardOutput \$WebStdoutLog/)
  assert.match(script, /RedirectStandardError \$WebStderrLog/)
  assert.match(script, /RedirectStandardOutput \$TauriStdoutLog/)
  assert.match(script, /RedirectStandardError \$TauriStderrLog/)
  assert.match(script, /yarn workspace @janhq\/core build/)
  assert.match(script, /@janhq\/core build failed/)
  assert.match(script, /function Stop-RepoPortOwner/)
  assert.match(script, /Get-NetTCPConnection -LocalPort \$Port -State Listen/)
  assert.match(script, /Port \$Port is already in use by unrelated process/)
  assert.match(script, /Stop-RepoPortOwner -Port 1420/)
  assert.match(script, /function Import-VisualStudioDevEnvironment/)
  assert.match(script, /vswhere\.exe/)
  assert.match(script, /vcvars64\.bat/)
  assert.match(script, /Using MSVC linker/)
  assert.match(script, /Preparing Windows Tauri icon assets/)
  assert.match(script, /yarn build:icon/)
  assert.match(script, /yarn build:icon failed/)
  assert.match(script, /thinking-content-demo-desktop\.png/)
  assert.match(script, /thinking-content-demo-mobile\.png/)
  assert.match(script, /thinking-content-tauri-windows\.png/)
  assert.match(script, /Evidence package/)
  assert.match(script, /Write-FileTail/)
})

test('thinking content Windows verifier avoids ambiguous PowerShell variable references', () => {
  const ambiguousReferences = script
    .split(/\r?\n/)
    .filter((line) => !line.includes('$env:'))
    .filter((line) => /\$[A-Za-z_][A-Za-z0-9_]*:/.test(line))

  assert.deepEqual(ambiguousReferences, [])
})

test('thinking content Windows verifier foregrounds the Tauri window before capture', () => {
  assert.match(script, /Add-Type[\s\S]*SetForegroundWindow/)
  assert.match(script, /function Wait-ForTauriWindow/)
  assert.match(script, /Biyan/)
  assert.match(script, /Mita/)
  assert.match(
    script,
    /Wait-ForTauriWindow -TimeoutSeconds \$TauriWarmupSeconds -TauriProcess \$tauriProcess/,
  )
  assert.match(script, /Tauri dev exited before screenshot capture/)
  assert.match(script, /SetForegroundWindow/)
  assert.match(script, /Save-DesktopScreenshot -Path \$TauriScreenshot/)
})
