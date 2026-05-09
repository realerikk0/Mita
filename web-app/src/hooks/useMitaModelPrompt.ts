import { localStorageKey } from '@/constants/localStorage'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { useModelProvider } from './useModelProvider'
import { useDownloadStore } from './useDownloadStore'
import { useLatestMitaModel } from './useLatestMitaModel'
import { predefinedProviders } from '@/constants/providers'
import { providerHasRemoteApiKeys } from '@/lib/provider-api-keys'

export type MitaModelPromptDismissedState = {
  dismissedModelName: string | null
  setDismissedModelName: (modelName: string) => void
}

export const useMitaModelPromptDismissed =
  create<MitaModelPromptDismissedState>()(
    persist(
      (set) => ({
        dismissedModelName: null,
        setDismissedModelName: (modelName: string) =>
          set({ dismissedModelName: modelName }),
      }),
      {
        name: localStorageKey.mitaModelPromptDismissed,
        storage: createJSONStorage(() => localStorage),
        version: 1,
        migrate: (persistedState: unknown) => {
          const state = persistedState as Record<string, unknown>
          if ('dismissed' in state && !('dismissedModelName' in state)) {
            return { dismissedModelName: null }
          }
          return state as MitaModelPromptDismissedState
        },
      }
    )
  )

const MIN_VERSION = '0.7.6'

export const useMitaModelPrompt = () => {
  const { dismissedModelName, setDismissedModelName } =
    useMitaModelPromptDismissed()
  const { getProviderByName, providers } = useModelProvider()
  const { localDownloadingModels } = useDownloadStore()
  const latestModel = useLatestMitaModel((state) => state.model)

  const llamaProvider = getProviderByName('llamacpp')

  // Only show for versions >= MIN_VERSION
  const isTargetVersion = VERSION >= MIN_VERSION

  // Check if user would be on SetupScreen (no valid providers)
  const hasValidProviders = providers.some((provider) => {
    const isPredefinedProvider = predefinedProviders.some(
      (p) => p.provider === provider.provider
    )
    if (!isPredefinedProvider) {
      return provider.models.length > 0
    }
    return (
      providerHasRemoteApiKeys(provider) ||
      (provider.provider === 'llamacpp' && provider.models.length) ||
      (provider.provider === 'jan' && provider.models.length)
    )
  })
  const isOnSetupScreen = !hasValidProviders

  // Build set of known quant model IDs from the latest Mita model
  const latestModelQuantIds = new Set(
    latestModel?.quants?.map((q) => q.model_id.toLowerCase()) ?? []
  )

  // Check if any variant of the latest Mita model is downloaded
  const isMitaModelDownloaded =
    latestModelQuantIds.size > 0 &&
    (llamaProvider?.models.some(
      (m: { id: string }) => latestModelQuantIds.has(m.id.toLowerCase())
    ) ?? false)

  // Check if currently downloading any variant
  const isDownloading =
    latestModelQuantIds.size > 0 &&
    Array.from(localDownloadingModels).some(
      (id) => latestModelQuantIds.has(id.toLowerCase())
    )

  // Dismissed only applies to the current latest model
  const isDismissed =
    latestModel != null &&
    dismissedModelName === latestModel.model_name

  const showMitaModelPrompt =
    isTargetVersion &&
    !isOnSetupScreen &&
    !isDismissed &&
    latestModel != null &&
    !isMitaModelDownloaded &&
    !isDownloading

  return {
    showMitaModelPrompt,
    setDismissedModelName,
    isMitaModelDownloaded,
    isDownloading,
  }
}
