import assert from 'node:assert/strict'
import test from 'node:test'

import {
  validateCandidateWorkflow,
  validateCiWorkflow,
  validateFlatpakMetadata,
} from '../release-policy-contracts.mjs'

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
  build-windows:
    needs:
      - preflight
      - quality-gate
  build-linux:
    needs: [preflight, quality-gate]
`

test('candidate workflow gates every platform build on exact-tag tests', () => {
  assert.deepEqual(validateCandidateWorkflow(candidateWorkflow), [])

  const withoutUpdaterContracts = candidateWorkflow.replace(
    'node --test scripts/updater/__tests__/updater.test.mjs',
    'echo skipped',
  )
  assert.ok(
    validateCandidateWorkflow(withoutUpdaterContracts).some((failure) => failure.includes('updater contract tests')),
  )

  const ungatedWindows = candidateWorkflow.replace(
    `  build-windows:
    needs:
      - preflight
      - quality-gate`,
    `  build-windows:
    needs: preflight`,
  )
  assert.ok(
    validateCandidateWorkflow(ungatedWindows).some((failure) => failure.includes('build-windows')),
  )
})

test('PR CI gate includes release policy and updater contracts', () => {
  const workflow = `jobs:
  release-safety:
    steps:
      - run: node scripts/ci/verify-release-policy.mjs
      - run: node --test scripts/ci/__tests__/release-policy.test.mjs
      - run: node --test scripts/updater/__tests__/updater.test.mjs
  pr-ci-gate:
    needs: [release-safety]
`
  assert.deepEqual(validateCiWorkflow(workflow), [])
  assert.ok(
    validateCiWorkflow(workflow.replace('needs: [release-safety]', 'needs: []'))
      .some((failure) => failure.includes('PR CI Gate')),
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
    'Mita runs 100% offline with Llama.cpp.',
  )
  const failures = validateFlatpakMetadata(manifest, retiredClaim)
  assert.ok(failures.some((failure) => failure.includes('retired product name')))
  assert.ok(failures.some((failure) => failure.includes('offline or local-model behavior')))
})
