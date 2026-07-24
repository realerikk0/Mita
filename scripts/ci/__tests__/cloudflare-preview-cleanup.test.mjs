import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import {
  assertCleanupConfiguration,
  expiredPreviewIds,
} from '../cleanup-cloudflare-pages-previews.mjs'

const validConfiguration = {
  accountId: 'account',
  apiToken: 'token',
  project: 'biyan-docs',
  expirationDays: 3,
}

function normalizeLineEndings(source) {
  return source.replace(/\r\n?/g, '\n')
}

function trustedCleanupWorkflowFailures(workflow) {
  const failures = []
  if ((workflow.match(/uses: actions\/checkout@v4/g) ?? []).length !== 1) {
    failures.push('cleanup must have exactly one trusted checkout')
  }
  if (
    !/^    if: github\.event_name == 'schedule' \|\| github\.ref == 'refs\/heads\/mita-main'$/m.test(
      workflow
    )
  ) {
    failures.push('manual cleanup must fail closed outside mita-main')
  }
  if (
    !/git ls-remote --exit-code "\$remote_url" refs\/heads\/mita-main/.test(
      workflow
    )
  ) {
    failures.push('cleanup must resolve live origin/mita-main')
  }
  if (
    !/ref: \$\{\{ steps\.trusted-main\.outputs\.sha \}\}/.test(workflow) ||
    !/path: trusted-control/.test(workflow) ||
    !/persist-credentials: false/.test(workflow)
  ) {
    failures.push('cleanup must checkout the exact trusted main control')
  }
  if (
    !/git -C trusted-control ls-remote --exit-code[\s\S]*origin refs\/heads\/mita-main/.test(
      workflow
    ) ||
    !/if \[ "\$live_sha" != "\$EXPECTED_TRUSTED_SHA" \]; then/.test(workflow)
  ) {
    failures.push('cleanup must revalidate live main before mutation')
  }
  if (
    !/node trusted-control\/scripts\/ci\/cleanup-cloudflare-pages-previews\.mjs/.test(
      workflow
    ) ||
    /(?:^|\s)node scripts\/ci\/cleanup-cloudflare-pages-previews\.mjs/.test(
      workflow
    )
  ) {
    failures.push('cleanup may only execute the trusted main script')
  }
  return failures
}

test('cleanup configuration only permits the canonical Biyan Docs project', () => {
  assert.doesNotThrow(() => assertCleanupConfiguration(validConfiguration))
  for (const project of ['nitro', 'docs', 'jan-docs', '', undefined]) {
    assert.throws(
      () => assertCleanupConfiguration({ ...validConfiguration, project }),
      /must be exactly biyan-docs/
    )
  }
  assert.throws(
    () =>
      assertCleanupConfiguration({
        ...validConfiguration,
        apiToken: '',
      }),
    /CLOUDFLARE_API_TOKEN is required/
  )
})

test('cleanup selects only expired previews and never production', () => {
  const cutoff = new Date('2026-07-21T00:00:00Z')
  assert.deepEqual(
    expiredPreviewIds(
      [
        {
          id: 'expired-preview',
          environment: 'preview',
          created_on: '2026-07-20T23:59:59Z',
        },
        {
          id: 'current-preview',
          environment: 'preview',
          created_on: '2026-07-21T00:00:00Z',
        },
        {
          id: 'production',
          environment: 'production',
          created_on: '2020-01-01T00:00:00Z',
        },
      ],
      cutoff
    ),
    ['expired-preview']
  )
})

test('cleanup rejects malformed Cloudflare deployment data', () => {
  assert.throws(
    () => expiredPreviewIds(null, new Date()),
    /result must be an array/
  )
  assert.throws(
    () =>
      expiredPreviewIds(
        [{ id: 'preview', environment: 'preview', created_on: 'invalid' }],
        new Date()
      ),
    /invalid created_on/
  )
  assert.throws(
    () =>
      expiredPreviewIds(
        [{ id: 'mystery', environment: 'unknown', created_on: new Date() }],
        new Date()
      ),
    /malformed preview deployment/
  )
})

test('scheduled workflow is single-project and executes only live trusted main control', () => {
  const workflow = normalizeLineEndings(
    fs.readFileSync(
      '.github/workflows/clean-cloudflare-page-preview-url-and-r2.yml',
      'utf8'
    )
  )
  assert.match(workflow, /CLOUDFLARE_PAGES_PROJECT: biyan-docs/)
  for (const lineEnding of ['\n', '\r\n']) {
    assert.deepEqual(
      trustedCleanupWorkflowFailures(workflow.replaceAll('\n', lineEnding)),
      []
    )
  }
  assert.doesNotMatch(workflow, /matrix:\s*[\s\S]*project:/)
  assert.doesNotMatch(workflow, /jannekem|project:\s*\[(?:"nitro"|"docs")/)
})

test('workflow policy rejects trigger-ref code and stale or untrusted cleanup control', () => {
  const workflow = normalizeLineEndings(
    fs.readFileSync(
      '.github/workflows/clean-cloudflare-page-preview-url-and-r2.yml',
      'utf8'
    )
  )
  const regressions = [
    workflow.replace(
      "    if: github.event_name == 'schedule' || github.ref == 'refs/heads/mita-main'\n",
      ''
    ),
    workflow.replace(
      'ref: ${{ steps.trusted-main.outputs.sha }}',
      'ref: ${{ github.sha }}'
    ),
    workflow.replace(
      '      - name: Checkout the exact trusted cleanup control',
      '      - uses: actions/checkout@v4\n\n      - name: Checkout the exact trusted cleanup control'
    ),
    workflow.replace(
      'node trusted-control/scripts/ci/cleanup-cloudflare-pages-previews.mjs',
      'node scripts/ci/cleanup-cloudflare-pages-previews.mjs'
    ),
    workflow.replace(
      'if [ "$live_sha" != "$EXPECTED_TRUSTED_SHA" ]; then',
      'if false; then'
    ),
  ]
  for (const regression of regressions) {
    assert.notEqual(
      regression,
      workflow,
      'regression fixture must change workflow'
    )
    assert.notDeepEqual(trustedCleanupWorkflowFailures(regression), [])
  }
})
