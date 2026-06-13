import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useServiceHub } from './useServiceHub'
import type { ProviderBalanceStatus } from '@/services/providers/types'

type ProviderBalanceCacheEntry = {
  balance: ProviderBalanceStatus
  timestamp: number
}

type UseProviderBalanceState = {
  balance: ProviderBalanceStatus | null
  loading: boolean
  error: string | null
  refetch: () => void
}

const BALANCE_CACHE_DURATION = 60 * 1000
const PROVIDER_BALANCE_REFRESH_EVENT = 'mita-provider-balance-refresh'
const balanceCache = new Map<string, ProviderBalanceCacheEntry>()

type ProviderBalanceRefreshEvent = CustomEvent<{ provider?: string }>

function hashString(value: string) {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash).toString(36)
}

function settingsFingerprint(provider?: ModelProvider) {
  if (!provider?.settings) return ''
  return provider.settings
    .filter((setting) =>
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
    .join('|')
}

function providerBalanceCacheKey(provider?: ModelProvider) {
  if (!provider) return ''
  return [
    provider.provider,
    provider.base_url ?? '',
    hashString(
      [
        provider.api_key ?? '',
        ...(provider.api_key_fallbacks ?? []),
        settingsFingerprint(provider),
      ].join('|')
    ),
  ].join('|')
}

export function notifyProviderBalanceMayHaveChanged(providerName?: string) {
  if (providerName) {
    for (const key of balanceCache.keys()) {
      if (key.startsWith(`${providerName}|`)) {
        balanceCache.delete(key)
      }
    }
  } else {
    balanceCache.clear()
  }

  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent(PROVIDER_BALANCE_REFRESH_EVENT, {
      detail: { provider: providerName },
    })
  )
}

export function useProviderBalance(
  provider?: ModelProvider,
  enabled = true
): UseProviderBalanceState {
  const serviceHub = useServiceHub()
  const cacheKey = useMemo(() => providerBalanceCacheKey(provider), [provider])
  const [balance, setBalance] = useState<ProviderBalanceStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef(0)

  const fetchBalance = useCallback(
    async (force = false) => {
      if (!provider || !enabled) {
        setBalance(null)
        setError(null)
        setLoading(false)
        return
      }

      const cached = balanceCache.get(cacheKey)
      if (!force && cached && Date.now() - cached.timestamp < BALANCE_CACHE_DURATION) {
        setBalance(cached.balance)
        setError(null)
        return
      }

      const requestId = ++requestIdRef.current
      setLoading(true)
      setError(null)

      try {
        const result = await serviceHub.providers().fetchProviderBalance(provider)
        if (requestId !== requestIdRef.current) return

        if (result.state === 'error' && result.retryable && cached) {
          setBalance(cached.balance)
          setError(result.message)
          return
        }

        setBalance(result)
        if (result.state === 'supported') {
          balanceCache.set(cacheKey, {
            balance: result,
            timestamp: Date.now(),
          })
        }
      } catch (err) {
        if (requestId !== requestIdRef.current) return
        const message = err instanceof Error ? err.message : 'Failed to fetch provider balance'
        if (cached) {
          setBalance(cached.balance)
        }
        setError(message)
      } finally {
        if (requestId === requestIdRef.current) setLoading(false)
      }
    },
    [cacheKey, enabled, provider, serviceHub]
  )

  useEffect(() => {
    fetchBalance(false)
  }, [fetchBalance])

  useEffect(() => {
    if (!provider || !enabled || typeof window === 'undefined') return

    const handleBalanceRefresh = (event: Event) => {
      const requestedProvider = (event as ProviderBalanceRefreshEvent).detail
        ?.provider
      if (requestedProvider && requestedProvider !== provider.provider) return
      void fetchBalance(true)
    }

    window.addEventListener(
      PROVIDER_BALANCE_REFRESH_EVENT,
      handleBalanceRefresh
    )
    return () => {
      window.removeEventListener(
        PROVIDER_BALANCE_REFRESH_EVENT,
        handleBalanceRefresh
      )
    }
  }, [enabled, fetchBalance, provider])

  return {
    balance,
    loading,
    error,
    refetch: () => fetchBalance(true),
  }
}
