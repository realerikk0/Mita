import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import {
  notifyProviderBalanceMayHaveChanged,
  useProviderBalance,
} from '../useProviderBalance'
import type { ProviderBalanceStatus } from '@/services/providers/types'

const fetchProviderBalance = vi.fn()
const serviceHubMock = {
  providers: () => ({
    fetchProviderBalance,
  }),
}

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => serviceHubMock,
}))

const balanceFor = (provider: string): ProviderBalanceStatus => ({
  state: 'supported',
  provider,
  unit: 'usd',
  currency: 'USD',
  fetchedAt: 1781260326,
  accountBalance: {
    available: provider === 'provider-b' ? 20 : 10,
  },
})

const providerFor = (provider: string) =>
  ({
    provider,
    base_url: `https://${provider}.example.com/v1`,
    api_key: `sk-${provider}`,
    active: true,
    models: [],
    settings: [],
  }) as unknown as ModelProvider

function storageKeys() {
  return Array.from({ length: localStorage.length }, (_, index) =>
    localStorage.key(index)
  ).filter((key): key is string => Boolean(key))
}

function hashString(value: string) {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash).toString(36)
}

function storageKeyForProvider(provider: ModelProvider) {
  const settingsFingerprint = provider.settings
    ?.filter((setting) =>
      [
        'api-key',
        'management-key',
        'xai-management-key',
        'team-id',
        'xai-team-id',
        'admin-api-key',
        'anthropic-admin-api-key',
      ].includes(setting.key)
    )
    .map((setting) => `${setting.key}:${setting.controller_props.value ?? ''}`)
    .join('|') ?? ''

  return [
    'mita-provider-balance-cache:',
    provider.provider,
    '|',
    provider.base_url ?? '',
    '|',
    hashString(
      [
        provider.api_key ?? '',
        ...(provider.api_key_fallbacks ?? []),
        settingsFingerprint,
      ].join('|')
    ),
  ].join('')
}

function storedBalanceEntry(
  balance: ProviderBalanceStatus,
  timestamp = Date.now()
) {
  return JSON.stringify({
    balance,
    timestamp,
  })
}

describe('useProviderBalance', () => {
  beforeEach(() => {
    fetchProviderBalance.mockReset()
    notifyProviderBalanceMayHaveChanged()
    localStorage.clear()
  })

  it('ignores stale responses after the selected provider changes', async () => {
    let resolveA!: (value: ProviderBalanceStatus) => void
    let resolveB!: (value: ProviderBalanceStatus) => void
    fetchProviderBalance
      .mockReturnValueOnce(new Promise((resolve) => { resolveA = resolve }))
      .mockReturnValueOnce(new Promise((resolve) => { resolveB = resolve }))

    const { result, rerender } = renderHook(
      ({ provider }) => useProviderBalance(provider),
      { initialProps: { provider: providerFor('provider-a') } }
    )
    await act(async () => {
      await Promise.resolve()
    })

    await waitFor(() => expect(fetchProviderBalance).toHaveBeenCalledTimes(1))

    await act(async () => {
      rerender({ provider: providerFor('provider-b') })
      await Promise.resolve()
    })
    await waitFor(() => expect(fetchProviderBalance).toHaveBeenCalledTimes(2))

    await act(async () => {
      resolveB(balanceFor('provider-b'))
      await Promise.resolve()
    })
    await waitFor(() =>
      expect(result.current.balance?.provider).toBe('provider-b')
    )

    await act(async () => {
      resolveA(balanceFor('provider-a'))
      await Promise.resolve()
    })
    expect(result.current.balance?.provider).toBe('provider-b')
  })

  it('reuses an in-flight request for matching provider credentials', async () => {
    let resolveBalance!: (value: ProviderBalanceStatus) => void
    fetchProviderBalance.mockReturnValue(
      new Promise((resolve) => { resolveBalance = resolve })
    )
    const provider = providerFor('provider-a')

    const first = renderHook(() => useProviderBalance(provider))
    const second = renderHook(() => useProviderBalance(provider))
    await act(async () => {
      await Promise.resolve()
    })

    await waitFor(() => expect(fetchProviderBalance).toHaveBeenCalledTimes(1))

    await act(async () => {
      resolveBalance(balanceFor('provider-a'))
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(first.result.current.balance?.provider).toBe('provider-a')
      expect(second.result.current.balance?.provider).toBe('provider-a')
    })
  })

  it('persists successful balances locally and clears them on provider changes', async () => {
    fetchProviderBalance.mockResolvedValue(balanceFor('provider-a'))
    const provider = providerFor('provider-a')

    const { result, unmount } = renderHook(() => useProviderBalance(provider))

    await waitFor(() =>
      expect(result.current.balance?.state).toBe('supported')
    )
    expect(fetchProviderBalance).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      expect(
        storageKeys().some((key) =>
          key.startsWith('mita-provider-balance-cache:provider-a|')
        )
      ).toBe(true)
    })

    unmount()
    act(() => {
      notifyProviderBalanceMayHaveChanged('provider-a')
    })

    expect(
      storageKeys().some((key) =>
        key.startsWith('mita-provider-balance-cache:provider-a|')
      )
    ).toBe(false)
  })

  it('uses the client write time for fresh in-memory cache checks', async () => {
    fetchProviderBalance.mockResolvedValue(balanceFor('provider-a'))
    const provider = providerFor('provider-a')

    const first = renderHook(() => useProviderBalance(provider))

    await waitFor(() =>
      expect(first.result.current.balance?.state).toBe('supported')
    )
    first.unmount()

    const second = renderHook(() => useProviderBalance(provider))

    await waitFor(() =>
      expect(second.result.current.balance?.state).toBe('supported')
    )
    expect(fetchProviderBalance).toHaveBeenCalledTimes(1)
  })

  it('does not persist raw balance payloads to local storage', async () => {
    fetchProviderBalance.mockResolvedValue({
      ...balanceFor('provider-a'),
      raw: {
        account: 'full upstream payload',
      },
    })
    const provider = providerFor('provider-a')

    const { result } = renderHook(() => useProviderBalance(provider))

    await waitFor(() =>
      expect(result.current.balance?.state).toBe('supported')
    )

    const cacheKey = storageKeys().find((key) =>
      key.startsWith('mita-provider-balance-cache:provider-a|')
    )
    expect(cacheKey).toBeDefined()
    const cached = JSON.parse(localStorage.getItem(cacheKey!) ?? '{}')
    expect(cached.balance.raw).toBeUndefined()
  })

  it('migrates old stored balances with raw payloads on read', async () => {
    const provider = providerFor('provider-a')
    const cacheKey = storageKeyForProvider(provider)
    localStorage.setItem(
      cacheKey,
      storedBalanceEntry({
        ...balanceFor('provider-a'),
        raw: {
          account: 'old upstream payload',
        },
      })
    )

    const { result } = renderHook(() => useProviderBalance(provider))

    await waitFor(() =>
      expect(result.current.balance?.state).toBe('supported')
    )
    expect(fetchProviderBalance).not.toHaveBeenCalled()
    expect(result.current.balance).not.toHaveProperty('raw')
    const cached = JSON.parse(localStorage.getItem(cacheKey) ?? '{}')
    expect(cached.balance.raw).toBeUndefined()
  })

  it('ignores and removes stored balances older than the max storage age', async () => {
    const provider = providerFor('provider-a')
    const cacheKey = storageKeyForProvider(provider)
    localStorage.setItem(
      cacheKey,
      storedBalanceEntry(
        balanceFor('provider-a'),
        Date.now() - 24 * 60 * 60 * 1000 - 1
      )
    )
    fetchProviderBalance.mockResolvedValue({
      state: 'unsupported',
      provider: 'provider-a',
      reason: 'No balance endpoint.',
    })

    const { result } = renderHook(() => useProviderBalance(provider))

    await waitFor(() =>
      expect(result.current.balance?.state).toBe('unsupported')
    )
    expect(fetchProviderBalance).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(cacheKey)).toBeNull()
  })

  it('prunes old provider balance storage entries and invalid entries', async () => {
    const now = Date.now()
    for (let index = 0; index < 21; index += 1) {
      localStorage.setItem(
        `mita-provider-balance-cache:seed-${index}|url|hash`,
        storedBalanceEntry(balanceFor(`seed-${index}`), now - 10_000 + index)
      )
    }
    const invalidKey = 'mita-provider-balance-cache:invalid|url|hash'
    localStorage.setItem(invalidKey, '{bad json')
    fetchProviderBalance.mockResolvedValue(balanceFor('provider-a'))
    const provider = providerFor('provider-a')

    const { result } = renderHook(() => useProviderBalance(provider))

    await waitFor(() =>
      expect(result.current.balance?.state).toBe('supported')
    )
    const cacheKeys = storageKeys().filter((key) =>
      key.startsWith('mita-provider-balance-cache:')
    )
    expect(cacheKeys).toHaveLength(20)
    expect(cacheKeys).toContain(storageKeyForProvider(provider))
    expect(localStorage.getItem('mita-provider-balance-cache:seed-0|url|hash'))
      .toBeNull()
    expect(localStorage.getItem(invalidKey)).toBeNull()
  })

  it('only clears the selected provider balance storage prefix', () => {
    const providerAKey = 'mita-provider-balance-cache:provider-a|hash'
    const providerABKey = 'mita-provider-balance-cache:provider-ab|hash'
    const cached = storedBalanceEntry(balanceFor('provider-a'))
    localStorage.setItem(providerAKey, cached)
    localStorage.setItem(providerABKey, cached)

    act(() => {
      notifyProviderBalanceMayHaveChanged('provider-a')
    })

    expect(localStorage.getItem(providerAKey)).toBeNull()
    expect(localStorage.getItem(providerABKey)).toBe(cached)
  })

  it('shows cached balances while a forced refresh is rate limited', async () => {
    fetchProviderBalance
      .mockResolvedValueOnce(balanceFor('provider-a'))
      .mockResolvedValueOnce({
        state: 'error',
        provider: 'provider-a',
        status: 429,
        retryable: true,
        message: 'Balance lookup is rate limited.',
      })
    const provider = providerFor('provider-a')

    const { result } = renderHook(() => useProviderBalance(provider))

    await waitFor(() =>
      expect(result.current.balance?.state).toBe('supported')
    )

    await act(async () => {
      result.current.refetch()
      await Promise.resolve()
    })

    await waitFor(() => expect(fetchProviderBalance).toHaveBeenCalledTimes(2))
    expect(result.current.balance).toMatchObject(balanceFor('provider-a'))
    expect(result.current.error).toBe('Balance lookup is rate limited.')
  })
})
