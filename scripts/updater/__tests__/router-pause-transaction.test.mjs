import assert from 'node:assert/strict'
import test from 'node:test'

import {
  prepareRouterPause,
  validateRouterPausePolicy,
  validateRouterPauseProbe,
  validateRouterPauseReadback,
} from '../router-pause-transaction.mjs'

const policy = () => ({
  schema: 1,
  channel: 'stable',
  currentVersion: '0.6.651',
  legacyBridgeVersion: '0.6.651',
  paused: false,
  releases: {
    '0.6.651': {
      manifestKey: 'biyan/updater/releases/v0.6.651/latest.json',
      manifestSha256: 'a'.repeat(64),
    },
  },
  transitions: {},
})

test('Router pause changes only paused and updatedAt', () => {
  const before = policy()
  const result = prepareRouterPause({
    currentPolicy: before,
    expectedCurrent: '0.6.651',
    pausedAt: '2026-08-11T00:00:00.000Z',
  })
  assert.equal(result.action, 'write')
  assert.equal(result.policy.paused, true)
  assert.equal(result.policy.legacyBridgeVersion, '0.6.651')
  assert.deepEqual(
    validateRouterPausePolicy({
      beforePolicy: before,
      pausedPolicy: result.policy,
      expectedCurrent: '0.6.651',
    }),
    {
      schema: 1,
      kind: 'router-pause-policy',
      currentVersion: '0.6.651',
    }
  )

  const drifted = structuredClone(result.policy)
  drifted.legacyBridgeVersion = '0.6.652'
  assert.throws(
    () =>
      validateRouterPausePolicy({
        beforePolicy: before,
        pausedPolicy: drifted,
        expectedCurrent: '0.6.651',
      }),
    /only paused and updatedAt/
  )
})

test('Router pause is idempotent and current-version bound', () => {
  const paused = { ...policy(), paused: true }
  assert.equal(
    prepareRouterPause({
      currentPolicy: paused,
      expectedCurrent: '0.6.651',
      pausedAt: '2026-08-11T00:00:00.000Z',
    }).action,
    'no-change'
  )
  assert.throws(
    () =>
      prepareRouterPause({
        currentPolicy: paused,
        expectedCurrent: '0.6.650',
        pausedAt: '2026-08-11T00:00:00.000Z',
      }),
    /CAS expected current/
  )
})

test('Router pause readback and signed probes require exact paused state', () => {
  const bytes = Buffer.from(
    `${JSON.stringify({ ...policy(), paused: true })}\n`
  )
  assert.equal(
    validateRouterPauseReadback({
      expectedPolicyBytes: bytes,
      actualPolicyBytes: bytes,
    }).kind,
    'router-pause-readback'
  )
  assert.throws(
    () =>
      validateRouterPauseReadback({
        expectedPolicyBytes: bytes,
        actualPolicyBytes: Buffer.from('{}\n'),
      }),
    /must match/
  )
  assert.equal(
    validateRouterPauseProbe({
      beforeStatus: 204,
      beforeState: 'no-transition',
      afterStatus: 204,
      afterState: 'paused',
    }).kind,
    'router-pause-proof'
  )
  assert.throws(
    () =>
      validateRouterPauseProbe({
        beforeStatus: 204,
        beforeState: 'no-transition',
        afterStatus: 200,
        afterState: '',
      }),
    /post-pause probe/
  )
})
