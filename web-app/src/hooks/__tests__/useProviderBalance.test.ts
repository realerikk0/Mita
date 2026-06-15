import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import {
  notifyProviderBalanceMayHaveChanged,
  useProviderBalance,
} from '../useProviderBalance'
import type { ProviderBalanceStatus } from '@/services/providers/types'

const fetchProviderBalance = vi.fn()

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    providers: () => ({
      fetchProviderBalance,
    }),
  }),
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

describe('useProviderBalance', () => {
  beforeEach(() => {
    fetchProviderBalance.mockReset()
    notifyProviderBalanceMayHaveChanged()
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
})
