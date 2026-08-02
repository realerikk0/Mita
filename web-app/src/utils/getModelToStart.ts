import { localStorageKey } from '@/constants/localStorage'
import type { ModelInfo } from '@biyan/core'
import {
  configuredChatModels,
  isConfiguredModelProvider,
  type RemoteModelProvider,
} from '@/lib/configured-model-providers'

const isRemoteUsableProvider = (
  provider?: ModelProvider
): provider is RemoteModelProvider =>
  Boolean(provider && isConfiguredModelProvider(provider))

const resolveConfiguredChatModel = (
  provider: ModelProvider | undefined,
  modelId: string
): { model: string; provider: ModelProvider } | null => {
  if (!isRemoteUsableProvider(provider)) return null

  const model = configuredChatModels(provider).find(
    (candidate) => candidate.id === modelId
  )
  return model ? { model: model.id, provider } : null
}

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
    const resolved = resolveConfiguredChatModel(
      getProviderByName(lastUsedModel.provider),
      lastUsedModel.model
    )
    if (resolved) return resolved
  }

  // Use selected model if available
  if (selectedModel && selectedProvider) {
    const resolved = resolveConfiguredChatModel(
      getProviderByName(selectedProvider),
      selectedModel.id
    )
    if (resolved) return resolved
  }

  for (const provider of providers) {
    if (!isRemoteUsableProvider(provider)) continue
    const firstModel = configuredChatModels(provider)[0]
    if (firstModel) return { model: firstModel.id, provider }
  }

  return null
}
