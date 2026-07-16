import { predefinedProviders } from '@/constants/providers'
import { isModelChatSelectable } from '@/lib/provider-models'
import { providerHasRemoteApiKeys } from '@/lib/provider-api-keys'
export { RETIRED_LOCAL_PROVIDER_IDS } from '@/legacy_migrations/retired-providers'
import { RETIRED_LOCAL_PROVIDER_IDS } from '@/legacy_migrations/retired-providers'

export type RemoteModelProvider = ModelProvider & { base_url: string }

const LOOPBACK_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '[::1]',
])

export function isRemoteProviderEndpoint(
  provider: ModelProvider
): provider is RemoteModelProvider {
  if (RETIRED_LOCAL_PROVIDER_IDS.has(provider.provider.toLowerCase())) {
    return false
  }
  const baseUrl = provider.base_url?.trim()
  if (!baseUrl) return false
  try {
    const url = new URL(baseUrl)
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      !LOOPBACK_HOSTS.has(url.hostname.toLowerCase())
    )
  } catch {
    return false
  }
}

export function isConfiguredModelProvider(
  provider: ModelProvider
): provider is RemoteModelProvider {
  if (!provider.active) return false
  if (!isRemoteProviderEndpoint(provider)) return false

  const selectableModels = provider.models.filter(isModelChatSelectable)
  if (selectableModels.length === 0) return false

  const isPredefinedProvider = predefinedProviders.some(
    (item) => item.provider === provider.provider
  )
  if (!isPredefinedProvider) return true

  return (
    providerHasRemoteApiKeys(provider)
  )
}

export function configuredChatModels(provider: ModelProvider): Model[] {
  if (!isConfiguredModelProvider(provider)) return []

  return provider.models.filter(isModelChatSelectable)
}
