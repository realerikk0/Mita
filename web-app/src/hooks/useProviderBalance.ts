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
const BALANCE_STORAGE_PREFIX = 'mita-provider-balance-cache:'
const balanceCache = new Map<string, ProviderBalanceCacheEntry>()
const balanceRequests = new Map<string, Promise<ProviderBalanceStatus>>()

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

function providerBalanceStorageKey(cacheKey: string) {
  return `${BALANCE_STORAGE_PREFIX}${cacheKey}`
}

function isCacheEntry(value: unknown): value is ProviderBalanceCacheEntry {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.timestamp === 'number' &&
    Number.isFinite(record.timestamp) &&
    Boolean(record.balance) &&
    typeof record.balance === 'object'
  )
}

function readProviderBalanceCache(cacheKey: string) {
  const memoryEntry = balanceCache.get(cacheKey)
  if (memoryEntry) return memoryEntry
  if (!cacheKey || typeof window === 'undefined') return undefined

  try {
    const serialized = window.localStorage.getItem(
      providerBalanceStorageKey(cacheKey)
    )
    if (!serialized) return undefined
    const parsed = JSON.parse(serialized)
    if (!isCacheEntry(parsed)) return undefined
    balanceCache.set(cacheKey, parsed)
    return parsed
  } catch {
    return undefined
  }
}

function cacheTimestampFromBalance(balance: ProviderBalanceStatus) {
  if (
    balance.state === 'supported' &&
    Number.isFinite(balance.fetchedAt) &&
    balance.fetchedAt > 0
  ) {
    return balance.fetchedAt * 1000
  }
  return Date.now()
}

function writeProviderBalanceCache(
  cacheKey: string,
  entry: ProviderBalanceCacheEntry
) {
  balanceCache.set(cacheKey, entry)
  if (!cacheKey || typeof window === 'undefined') return

  try {
    window.localStorage.setItem(
      providerBalanceStorageKey(cacheKey),
      JSON.stringify(entry)
    )
  } catch {
    // Best-effort cache only; balance lookup should not fail because storage is full.
  }
}

function clearProviderBalanceStorage(providerName?: string) {
  if (typeof window === 'undefined') return

  try {
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index)
      if (!key?.startsWith(BALANCE_STORAGE_PREFIX)) continue
      if (
        providerName &&
        !key.startsWith(`${BALANCE_STORAGE_PREFIX}${providerName}|`)
      ) {
        continue
      }
      window.localStorage.removeItem(key)
    }
  } catch {
    // Ignore storage cleanup failures; in-memory cache is still cleared below.
  }
}

export function notifyProviderBalanceMayHaveChanged(providerName?: string) {
  if (providerName) {
    for (const key of balanceCache.keys()) {
      if (key.startsWith(`${providerName}|`)) {
        balanceCache.delete(key)
      }
    }
    for (const key of balanceRequests.keys()) {
      if (key.startsWith(`${providerName}|`)) {
        balanceRequests.delete(key)
      }
    }
  } else {
    balanceCache.clear()
    balanceRequests.clear()
  }
  clearProviderBalanceStorage(providerName)

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
      const requestId = ++requestIdRef.current

      if (!provider || !enabled) {
        setBalance(null)
        setError(null)
        setLoading(false)
        return
      }

      const cached = readProviderBalanceCache(cacheKey)
      if (!force && cached && Date.now() - cached.timestamp < BALANCE_CACHE_DURATION) {
        setBalance(cached.balance)
        setError(null)
        setLoading(false)
        return
      }

      if (cached) {
        setBalance(cached.balance)
      }
      setLoading(true)
      setError(null)

      try {
        let request = balanceRequests.get(cacheKey)
        if (!request) {
          request = serviceHub.providers().fetchProviderBalance(provider)
          balanceRequests.set(cacheKey, request)
          const cleanup = () => {
            if (balanceRequests.get(cacheKey) === request) {
              balanceRequests.delete(cacheKey)
            }
          }
          request.then(cleanup, cleanup)
        }

        const result = await request
        if (requestId !== requestIdRef.current) return

        if (result.state === 'error' && result.retryable && cached) {
          setBalance(cached.balance)
          setError(result.message)
          return
        }

        setBalance(result)
        if (result.state === 'supported') {
          writeProviderBalanceCache(cacheKey, {
            balance: result,
            timestamp: cacheTimestampFromBalance(result),
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
