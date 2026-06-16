import { describe, it, expect, beforeEach } from 'vitest'
import { useTokenCalibration } from '../token-calibration-store'
import { DEFAULT_CHARS_PER_TOKEN } from '@/lib/context-manager'

const store = () => useTokenCalibration.getState()

describe('token-calibration-store', () => {
  beforeEach(() => {
    useTokenCalibration.setState({ factors: {} })
  })

  it('returns the default prior for unknown / missing models', () => {
    expect(store().getCharsPerToken('never-seen')).toBe(DEFAULT_CHARS_PER_TOKEN)
    expect(store().getCharsPerToken(undefined)).toBe(DEFAULT_CHARS_PER_TOKEN)
    expect(store().getCharsPerToken(null)).toBe(DEFAULT_CHARS_PER_TOKEN)
  })

  it('moves the estimate toward an observed ratio via EMA', () => {
    // ratio 4.0; EMA: 0.3*4 + 0.7*3.5 = 3.65
    store().recordSample('m1', 400, 100)
    expect(store().getCharsPerToken('m1')).toBeCloseTo(3.65, 5)
  })

  it('ignores tiny requests below the token floor', () => {
    store().recordSample('m1', 100, 40) // 40 < MIN_TOKENS_FOR_SAMPLE
    expect(store().getCharsPerToken('m1')).toBe(DEFAULT_CHARS_PER_TOKEN)
  })

  it('ignores non-finite or non-positive inputs', () => {
    store().recordSample('m1', 0, 100)
    store().recordSample('m1', NaN, 100)
    store().recordSample('m1', 400, Infinity)
    expect(store().getCharsPerToken('m1')).toBe(DEFAULT_CHARS_PER_TOKEN)
  })

  it('clamps absurd ratios into a sane band', () => {
    // ratio 100 → clamped to 10; EMA: 0.3*10 + 0.7*3.5 = 5.45
    store().recordSample('hi', 10_000, 100)
    expect(store().getCharsPerToken('hi')).toBeCloseTo(5.45, 5)
    // ratio 0.5 → clamped to 1.5; EMA: 0.3*1.5 + 0.7*3.5 = 2.9
    store().recordSample('lo', 100, 200)
    expect(store().getCharsPerToken('lo')).toBeCloseTo(2.9, 5)
  })

  it('keeps per-model factors independent', () => {
    store().recordSample('a', 450, 100) // ratio 4.5
    expect(store().getCharsPerToken('b')).toBe(DEFAULT_CHARS_PER_TOKEN)
    expect(store().getCharsPerToken('a')).not.toBe(DEFAULT_CHARS_PER_TOKEN)
  })

  it('converges toward a steady observed ratio', () => {
    for (let i = 0; i < 30; i++) store().recordSample('c', 450, 100) // ratio 4.5
    expect(store().getCharsPerToken('c')).toBeCloseTo(4.5, 1)
  })

  it('resets one model or all models', () => {
    store().recordSample('a', 450, 100)
    store().recordSample('b', 450, 100)
    store().reset('a')
    expect(store().getCharsPerToken('a')).toBe(DEFAULT_CHARS_PER_TOKEN)
    expect(store().getCharsPerToken('b')).not.toBe(DEFAULT_CHARS_PER_TOKEN)
    store().reset()
    expect(store().getCharsPerToken('b')).toBe(DEFAULT_CHARS_PER_TOKEN)
  })
})
