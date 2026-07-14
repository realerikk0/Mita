import { localStorageKey } from '@/constants/localStorage'
import type { ModelInfo } from '@biyan/core'
import {
  isConfiguredModelProvider,
  type RemoteModelProvider,
} from '@/lib/configured-model-providers'

const isRemoteUsableProvider = (
  provider?: ModelProvider
): provider is RemoteModelProvider =>
  Boolean(provider && isConfiguredModelProvider(provider))

export const getLastUsedModel = (): {
  provider: string
  model: string
} | null => {
  try {
    const stored = localStorage.getItem(localStorageKey.lastUsedModel)
    return stored ? JSON.parse(stored) : null
  } catch (error) {
    console.debug('Failed to get last used model from localStorage:', error)
    return null
  }
}

// Resolve a configured remote model. This never starts a local runtime.
export const getModelToStart = (params: {
  selectedModel?: ModelInfo | null
  selectedProvider?: string | null
  getProviderByName: (name: string) => ModelProvider | undefined
  providers?: ModelProvider[]
}): { model: string; provider: ModelProvider } | null => {
  const { selectedModel, selectedProvider, getProviderByName, providers = [] } =
    params

  // Use last used model if available
  const lastUsedModel = getLastUsedModel()
  if (lastUsedModel) {
    const provider = getProviderByName(lastUsedModel.provider)
    if (
      isRemoteUsableProvider(provider) &&
      provider.models.some((model) => model.id === lastUsedModel.model)
    ) {
      return { model: lastUsedModel.model, provider }
    }
  }

  // Use selected model if available
  if (selectedModel && selectedProvider) {
    const provider = getProviderByName(selectedProvider)
    if (
      isRemoteUsableProvider(provider) &&
      provider.models.some((model) => model.id === selectedModel.id)
    ) {
      return { model: selectedModel.id, provider }
    }
  }

  const firstProvider = providers.find(
    (provider) => isRemoteUsableProvider(provider) && provider.models.length > 0
  )
  if (firstProvider) return { model: firstProvider.models[0].id, provider: firstProvider }

  return null
}
