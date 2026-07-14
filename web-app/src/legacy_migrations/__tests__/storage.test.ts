import { beforeEach, describe, expect, it } from 'vitest'

import {
  createLegacyFallbackStateStorage,
  readCanonicalStorageValue,
} from '../storage'

describe('legacy storage migration', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('copies the first legacy value without modifying the source key', () => {
    localStorage.setItem('legacy-b', 'legacy-value')

    expect(
      readCanonicalStorageValue('biyan-value', ['legacy-a', 'legacy-b'])
    ).toBe('legacy-value')
    expect(localStorage.getItem('biyan-value')).toBe('legacy-value')
    expect(localStorage.getItem('legacy-b')).toBe('legacy-value')
  })

  it('is idempotent and always prefers an existing canonical value', () => {
    localStorage.setItem('biyan-value', 'canonical-value')
    localStorage.setItem('legacy-value', 'stale-value')

    expect(readCanonicalStorageValue('biyan-value', ['legacy-value'])).toBe(
      'canonical-value'
    )
    expect(localStorage.getItem('legacy-value')).toBe('stale-value')
  })

  it('writes and removes only the canonical key after fallback migration', () => {
    localStorage.setItem('legacy-value', 'legacy-value')
    const storage = createLegacyFallbackStateStorage(['legacy-value'])

    expect(storage.getItem('biyan-value')).toBe('legacy-value')
    storage.setItem('biyan-value', 'new-value')
    expect(localStorage.getItem('biyan-value')).toBe('new-value')
    expect(localStorage.getItem('legacy-value')).toBe('legacy-value')

    storage.removeItem('biyan-value')
    expect(localStorage.getItem('biyan-value')).toBeNull()
    expect(localStorage.getItem('legacy-value')).toBe('legacy-value')
  })
})
