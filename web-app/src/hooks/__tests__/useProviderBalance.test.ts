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
