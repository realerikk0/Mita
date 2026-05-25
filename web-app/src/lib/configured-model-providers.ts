import { predefinedProviders } from '@/constants/providers'
import { isChatModelSelectable } from '@/lib/chat-models'
import { providerHasRemoteApiKeys } from '@/lib/provider-api-keys'

export function isConfiguredModelProvider(provider: ModelProvider): boolean {
  if (!provider.active) return false
  if (provider.provider === 'foundation-models') return false

  const selectableModels = provider.models.filter(
    (model) => !model.embedding && isChatModelSelectable(model.id)
  )
  if (selectableModels.length === 0) return false

  const isPredefinedProvider = predefinedProviders.some(
    (item) => item.provider === provider.provider
  )
  if (!isPredefinedProvider) return true

  return (
    providerHasRemoteApiKeys(provider) ||
    provider.provider === 'llamacpp' ||
    provider.provider === 'jan' ||
    provider.provider === 'mlx'
  )
}

export function configuredChatModels(provider: ModelProvider): Model[] {
  if (!isConfiguredModelProvider(provider)) return []

  return provider.models.filter(
    (model) => !model.embedding && isChatModelSelectable(model.id)
  )
}
