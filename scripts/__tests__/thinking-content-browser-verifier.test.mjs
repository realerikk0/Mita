import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const script = fs.readFileSync('scripts/verify-thinking-content-demo.mjs', 'utf8')

test('thinking content browser verifier records readiness timeout and failures', () => {
  assert.match(script, /THINKING_CONTENT_READY_TIMEOUT_MS/)
  assert.match(script, /process\.platform === 'win32' \? 180000 : 30000/)
  assert.match(script, /readyTimeoutMs: READY_TIMEOUT_MS/)
  assert.match(script, /function gotoDemo/)
  assert.match(script, /waitUntil: 'commit'/)
  assert.match(script, /function captureScreenshot/)
  assert.match(script, /timeout: READY_TIMEOUT_MS/)
  assert.match(script, /writeFailureDiagnostics/)
  assert.match(script, /thinking-content-\$\{safeLabel\}-failure\.json/)
  assert.match(script, /thinking-content-\$\{safeLabel\}-failure\.png/)
  assert.match(script, /page\.on\('console'/)
  assert.match(script, /page\.on\('pageerror'/)
})
