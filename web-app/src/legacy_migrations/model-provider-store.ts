/**
 * Versioned provider-state migration boundary.
 *
 * The persisted provider store remains co-located with its cumulative migration
 * chain so retired provider identifiers never leak back into normal modules.
 */
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { getServiceHub } from '@/hooks/useServiceHub'
import { normalizeModelCapabilitiesForProvider } from '@/lib/models'
import { modelSettings } from '@/lib/predefined'
import { isBiyuanProvider } from '@/constants/biyuan'
import { RETIRED_LOCAL_PROVIDER_IDS } from '@/legacy_migrations/retired-providers'

type ModelProviderState = {
  providers: ModelProvider[]
  selectedProvider: string
  selectedModel: Model | null
  deletedModels: string[]
  getModelBy: (modelId: string) => Model | undefined
  setProviders: (providers: ModelProvider[]) => void
  getProviderByName: (providerName: string) => ModelProvider | undefined
  updateProvider: (providerName: string, data: Partial<ModelProvider>) => void
  selectModelProvider: (
    providerName: string,
    modelName: string
  ) => Model | undefined
  addProvider: (provider: ModelProvider) => void
  deleteProvider: (providerName: string) => void
  deleteModel: (modelId: string) => void
}

type ModelWithCapabilityPreference = Model & {
  _userConfiguredCapabilities?: boolean
}

const providerBaseUrl = (provider: ModelProvider) => {
  if (provider.base_url?.trim()) return provider.base_url

  const settingValue = provider.settings?.find(
    (setting) => setting.key === 'base-url'
  )?.controller_props?.value
  return typeof settingValue === 'string' ? settingValue : undefined
}

const normalizeProviderModel = (
  provider: ModelProvider,
  model: ModelWithCapabilityPreference
): ModelWithCapabilityPreference => {
  const normalizedCapabilities = normalizeModelCapabilitiesForProvider(
    provider.provider,
    model,
    providerBaseUrl(provider)
  )

  return {
    ...model,
    ...(normalizedCapabilities
      ? { capabilities: normalizedCapabilities }
      : {}),
  }
}

const normalizeProviderModels = (provider: ModelProvider): ModelProvider => ({
  ...provider,
  models: (provider.models || []).map((model) =>
    normalizeProviderModel(provider, model as ModelWithCapabilityPreference)
  ),
})

const isLocalProviderUrl = (baseUrl?: string) => {
  const value = baseUrl?.trim()
  if (!value) return true
  try {
    const url = new URL(
      /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `http://${value}`
    )
    return ['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'].includes(
      url.hostname.toLowerCase()
    )
  } catch {
    return true
  }
}

const remoteImportId = (providers: ModelProvider[]) => {
  if (!providers.some((provider) => provider.provider === 'openai-compatible')) {
    return 'openai-compatible'
  }
  let suffix = 1
  while (
    providers.some(
      (provider) => provider.provider === `openai-compatible-import-${suffix}`
    )
  ) {
    suffix += 1
  }
  return `openai-compatible-import-${suffix}`
}

export function migrateLegacyProviderState(state: ModelProviderState) {
  if (!Array.isArray(state.providers)) return state

  const originalSelectedProvider = state.selectedProvider
  const migrated: ModelProvider[] = []
  let selectedProvider = originalSelectedProvider
  // Preserve every already-valid provider before assigning IDs to retired Jan
  // entries. Persisted array order is not stable across historical releases;
  // without this two-pass reservation a Jan import could steal
  // `openai-compatible` and cause the genuine provider's URL/settings/headers
  // to be destructively merged into it.
  const orderedProviders = [
    ...state.providers.filter(
      (provider) => !RETIRED_LOCAL_PROVIDER_IDS.has(provider.provider)
    ),
    ...state.providers.filter((provider) =>
      RETIRED_LOCAL_PROVIDER_IDS.has(provider.provider)
    ),
  ]

  for (const provider of orderedProviders) {
    if (!RETIRED_LOCAL_PROVIDER_IDS.has(provider.provider)) {
      const duplicate = migrated.find(
        (item) => item.provider === provider.provider
      )
      if (duplicate) {
        duplicate.models = [
          ...(provider.models || []),
          ...duplicate.models.filter(
            (model) => !(provider.models || []).some((item) => item.id === model.id)
          ),
        ]
        duplicate.api_key ||= provider.api_key
      } else {
        migrated.push(provider)
      }
      continue
    }

    const baseUrl = providerBaseUrl(provider)
    if (provider.provider === 'jan' && isBiyuanProvider('jan', baseUrl)) {
      const canonicalId = 'jingxing'
      const existing = migrated.find((item) => item.provider === canonicalId)
      if (existing) {
        existing.models = [
          ...existing.models,
          ...(provider.models || []).filter(
            (model) => !existing.models.some((item) => item.id === model.id)
          ),
        ]
        existing.api_key ||= provider.api_key
      } else {
        migrated.push({ ...provider, provider: canonicalId })
      }
      if (originalSelectedProvider === provider.provider) {
        selectedProvider = canonicalId
      }
      continue
    }

    if (provider.provider === 'jan' && !isLocalProviderUrl(baseUrl)) {
      const compatibleId = remoteImportId(migrated)
      migrated.push({ ...provider, provider: compatibleId })
      if (originalSelectedProvider === provider.provider) {
        selectedProvider = compatibleId
      }
      continue
    }

    const retired = migrated.find(
      (item) => item.provider === 'retired-local-runtime'
    )
    if (retired) {
      retired.models = [
        ...retired.models,
        ...(provider.models || []).filter(
          (model) => !retired.models.some((item) => item.id === model.id)
        ),
      ]
    } else {
      migrated.push({
        ...provider,
        provider: 'retired-local-runtime',
        active: false,
      })
    }
    if (originalSelectedProvider === provider.provider) {
      selectedProvider = ''
    }
  }

  const selectedProviderConfig = migrated.find(
    (provider) => provider.provider === selectedProvider
  )
  return {
    ...state,
    providers: migrated,
    selectedProvider,
    selectedModel:
      selectedProviderConfig?.active && selectedProvider !== 'retired-local-runtime'
        ? state.selectedModel
        : null,
  }
}

export const useModelProvider = create<ModelProviderState>()(
  persist(
    (set, get) => ({
      providers: [],
      selectedProvider: 'jingxing',
      selectedModel: null,
      deletedModels: [],
      getModelBy: (modelId: string) => {
        const provider = get().providers.find(
          (provider) => provider.provider === get().selectedProvider
        )
        if (!provider) return undefined
        return provider.models.find((model) => model.id === modelId)
      },
      setProviders: (providers) =>
        set((state) => {
          const existingProviders = state.providers
            // Filter out legacy llama.cpp provider for migration
            // Can remove after a couple of releases
            .filter((e) => e.provider !== 'llama.cpp')
            .map((provider) => {
              return normalizeProviderModels({
                ...provider,
                models: provider.models.filter(
                  (e) =>
                    ('id' in e || 'model' in e) &&
                    typeof (e.id ?? e.model) === 'string'
                ),
              })
            })

          let legacyModels: Model[] | undefined = []
          /// Cortex Migration
          if (
            localStorage.getItem('cortex_model_settings_migrated') !== 'true'
          ) {
            legacyModels = state.providers.find(
              (e) => e.provider === 'llama.cpp'
            )?.models
            localStorage.setItem('cortex_model_settings_migrated', 'true')
          }
          // Ensure deletedModels is always an array
          const currentDeletedModels = Array.isArray(state.deletedModels)
            ? state.deletedModels
            : []

          const updatedProviders = providers.map((provider) => {
            const existingProvider = existingProviders.find(
              (x) => x.provider === provider.provider
            )
            const effectiveBaseUrl =
              existingProvider?.base_url || provider.base_url
            const models = (existingProvider?.models || []).filter(
              (e) =>
                ('id' in e || 'model' in e) &&
                typeof (e.id ?? e.model) === 'string'
            )
            const mergedModels = [
              ...(provider?.models ?? []).filter(
                (e) =>
                  ('id' in e || 'model' in e) &&
                  typeof (e.id ?? e.model) === 'string' &&
                  !models.some((m) => m.id === e.id) &&
                  !currentDeletedModels.includes(e.id)
              ),
              ...models,
            ].map((model) => {
              const normalizedCapabilities = normalizeModelCapabilitiesForProvider(
                provider.provider,
                model as Model,
                effectiveBaseUrl
              )
              return {
                ...model,
                ...(normalizedCapabilities
                  ? { capabilities: normalizedCapabilities }
                  : {}),
              }
            })
            const updatedModels = provider.models?.map((model) => {
              const settings =
                (legacyModels && legacyModels?.length > 0
                  ? legacyModels
                  : models
                ).find(
                  (m) =>
                    m.id
                      .split(':')
                      .slice(0, 2)
                      .join(getServiceHub().path().sep()) === model.id
                )?.settings || model.settings
              const existingModel = models.find((m) => m.id === model.id)
              const userConfiguredCapabilities =
                (
                  existingModel as Model & {
                    _userConfiguredCapabilities?: boolean
                  }
                )?._userConfiguredCapabilities === true

              const normalizedModelCapabilities =
                normalizeModelCapabilitiesForProvider(
                  provider.provider,
                  {
                    ...model,
                    _userConfiguredCapabilities: userConfiguredCapabilities,
                  },
                  effectiveBaseUrl
                )

              // When the user set tools/vision in Edit Model, honor that list on every
              // refresh from the engine; otherwise fresh engine data would re-add defaults.
              const mergedCapabilities = userConfiguredCapabilities
                ? [...(existingModel?.capabilities || [])]
                : isBiyuanProvider(provider.provider, effectiveBaseUrl) &&
                    normalizedModelCapabilities
                  ? normalizedModelCapabilities
                  : [
                      ...(model.capabilities || []),
                      ...(existingModel?.capabilities || []).filter(
                        (cap) => !(model.capabilities || []).includes(cap)
                      ),
                    ]
              return {
                ...model,
                settings: settings,
                capabilities:
                  mergedCapabilities.length > 0 ? mergedCapabilities : undefined,
                displayName: existingModel?.displayName || model.displayName,
                ...(userConfiguredCapabilities
                  ? { _userConfiguredCapabilities: true as const }
                  : {}),
              }
            })

            return {
              ...provider,
              models: provider.persist ? updatedModels : mergedModels,
              settings: provider.settings.map((setting) => {
                const existingSetting = provider.persist
                  ? undefined
                  : existingProvider?.settings?.find(
                      (x) => x.key === setting.key
                    )
                return {
                  ...setting,
                  controller_props: {
                    ...setting.controller_props,
                    ...(existingSetting?.controller_props || {}),
                  },
                }
              }),
              api_key: existingProvider?.api_key || provider.api_key,
              api_key_fallbacks:
                existingProvider?.api_key_fallbacks ??
                provider.api_key_fallbacks,
              base_url: existingProvider?.base_url || provider.base_url,
              custom_header:
                existingProvider?.custom_header ?? provider.custom_header,
              active: existingProvider ? existingProvider?.active : true,
            }
          })
          const nextProviders = [
            ...updatedProviders,
            ...existingProviders.filter(
              (e) => !updatedProviders.some((p) => p.provider === e.provider)
            ),
          ]
          const selectedProvider = nextProviders.find(
            (provider) => provider.provider === state.selectedProvider
          )
          const selectedModel =
            state.selectedModel &&
            selectedProvider?.active &&
            selectedProvider.provider !== 'retired-local-runtime'
              ? selectedProvider.models.find(
                  (model) => model.id === state.selectedModel?.id
                ) ?? null
              : null

          return {
            providers: nextProviders,
            selectedModel,
            selectedProvider: selectedModel ? state.selectedProvider : '',
          }
        }),
      updateProvider: (providerName, data) => {
        set((state) => ({
          providers: state.providers.map((provider) => {
            if (provider.provider === providerName) {
              return {
                ...provider,
                ...data,
              }
            }
            return provider
          }),
        }))
      },
      getProviderByName: (providerName: string) => {
        const provider = get().providers.find(
          (provider) => provider.provider === providerName
        )

        return provider
      },
      selectModelProvider: (providerName: string, modelName: string) => {
        // Find the model object
        const provider = get().providers.find(
          (provider) => provider.provider === providerName
        )

        let modelObject: Model | undefined = undefined

        if (provider && provider.models) {
          modelObject = provider.models.find((model) => model.id === modelName)
        }

        // Update state with provider name and model object
        set({
          selectedProvider: providerName,
          selectedModel: modelObject || null,
        })

        return modelObject
      },
      deleteModel: (modelId: string) => {
        set((state) => {
          // Ensure deletedModels is always an array
          const currentDeletedModels = Array.isArray(state.deletedModels)
            ? state.deletedModels
            : []

          return {
            providers: state.providers.map((provider) => {
              const models = provider.models.filter(
                (model) => model.id !== modelId
              )
              return {
                ...provider,
                models,
              }
            }),
            deletedModels: [...currentDeletedModels, modelId],
          }
        })
      },
      addProvider: (provider: ModelProvider) => {
        set((state) => ({
          providers: [...state.providers, provider],
        }))
      },
      deleteProvider: (providerName: string) => {
        set((state) => ({
          providers: state.providers.filter(
            (provider) => provider.provider !== providerName
          ),
        }))
      },
    }),
    {
      name: localStorageKey.modelProvider,
      storage: createJSONStorage(() => localStorage),
      migrate: (persistedState: unknown, version: number) => {
        const state = persistedState as ModelProviderState & {
          providers: Array<
            ModelProvider & {
              models: Array<
                Model & {
                  settings?: Record<string, unknown> & {
                    chatTemplate?: string
                    chat_template?: string
                  }
                }
              >
            }
          >
        }

        if (version <= 1 && state?.providers) {
          state.providers.forEach((provider) => {
            // Update cont_batching description for llamacpp provider
            if (provider.provider === 'llamacpp' && provider.settings) {
              const contBatchingSetting = provider.settings.find(
                (s) => s.key === 'cont_batching'
              )
              if (contBatchingSetting) {
                contBatchingSetting.description =
                  'Enable continuous batching (a.k.a dynamic batching) for concurrent requests.'
              }
            }

            // Migrate model settings
            if (provider.models && provider.provider === 'llamacpp') {
              provider.models.forEach((model) => {
                if (!model.settings) model.settings = {}

                // Migrate chatTemplate key to chat_template
                if (model.settings.chatTemplate) {
                  model.settings.chat_template = model.settings.chatTemplate
                  delete model.settings.chatTemplate
                }

                // Add missing settings with defaults
                if (!model.settings.chat_template) {
                  model.settings.chat_template = {
                    ...modelSettings.chatTemplate,
                    controller_props: {
                      ...modelSettings.chatTemplate.controller_props,
                    },
                  }
                }

                if (!model.settings.override_tensor_buffer_t) {
                  model.settings.override_tensor_buffer_t = {
                    ...modelSettings.override_tensor_buffer_t,
                    controller_props: {
                      ...modelSettings.override_tensor_buffer_t
                        .controller_props,
                    },
                  }
                }

                if (!model.settings.no_kv_offload) {
                  model.settings.no_kv_offload = {
                    ...modelSettings.no_kv_offload,
                    controller_props: {
                      ...modelSettings.no_kv_offload.controller_props,
                    },
                  }
                }
              })
            }
          })
        }

        if (version <= 2 && state?.providers) {
          state.providers.forEach((provider) => {
            // Update cont_batching description for llamacpp provider
            if (provider.provider === 'llamacpp' && provider.settings) {
              const contBatchingSetting = provider.settings.find(
                (s) => s.key === 'cont_batching'
              )
              if (contBatchingSetting) {
                contBatchingSetting.description =
                  'Enable continuous batching (a.k.a dynamic batching) for concurrent requests.'
              }
            }

            // Migrate model settings
            if (provider.models && provider.provider === 'llamacpp') {
              provider.models.forEach((model) => {
                if (!model.settings) model.settings = {}

                if (!model.settings.batch_size) {
                  model.settings.batch_size = {
                    ...modelSettings.batch_size,
                    controller_props: {
                      ...modelSettings.batch_size.controller_props,
                    },
                  }
                }
              })
            }
          })
        }

        if (version <= 3 && state?.providers) {
          state.providers.forEach((provider) => {
            // Migrate Anthropic provider base URL and add custom headers
            if (provider.provider === 'anthropic') {
              if (provider.base_url === 'https://api.anthropic.com') {
                provider.base_url = 'https://api.anthropic.com/v1'
              }

              // Update base-url in settings
              if (provider.settings) {
                const baseUrlSetting = provider.settings.find(
                  (s) => s.key === 'base-url'
                )
                if (
                  baseUrlSetting?.controller_props?.value ===
                  'https://api.anthropic.com'
                ) {
                  baseUrlSetting.controller_props.value =
                    'https://api.anthropic.com/v1'
                }
                if (
                  baseUrlSetting?.controller_props?.placeholder ===
                  'https://api.anthropic.com'
                ) {
                  baseUrlSetting.controller_props.placeholder =
                    'https://api.anthropic.com/v1'
                }
              }

              if (!provider.custom_header) {
                provider.custom_header = [
                  {
                    header: 'anthropic-version',
                    value: '2023-06-01',
                  },
                  {
                    header: 'anthropic-dangerous-direct-browser-access',
                    value: 'true',
                  },
                ]
              }
            }

            if (provider.provider === 'cohere') {
              if (
                provider.base_url === 'https://api.cohere.ai/compatibility/v1'
              ) {
                provider.base_url = 'https://api.cohere.ai/v1'
              }

              // Update base-url in settings
              if (provider.settings) {
                const baseUrlSetting = provider.settings.find(
                  (s) => s.key === 'base-url'
                )
                if (
                  baseUrlSetting?.controller_props?.value ===
                  'https://api.cohere.ai/compatibility/v1'
                ) {
                  baseUrlSetting.controller_props.value =
                    'https://api.cohere.ai/v1'
                }
                if (
                  baseUrlSetting?.controller_props?.placeholder ===
                  'https://api.cohere.ai/compatibility/v1'
                ) {
                  baseUrlSetting.controller_props.placeholder =
                    'https://api.cohere.ai/v1'
                }
              }
            }
          })
        }

        if (version <= 4 && state?.providers) {
          state.providers.forEach((provider) => {
            // Migrate model settings
            if (provider.models && provider.provider === 'llamacpp') {
              provider.models.forEach((model) => {
                if (!model.settings) model.settings = {}

                if (!model.settings.cpu_moe) {
                  model.settings.cpu_moe = {
                    ...modelSettings.cpu_moe,
                    controller_props: {
                      ...modelSettings.cpu_moe.controller_props,
                    },
                  }
                }

                if (!model.settings.n_cpu_moe) {
                  model.settings.n_cpu_moe = {
                    ...modelSettings.n_cpu_moe,
                    controller_props: {
                      ...modelSettings.n_cpu_moe.controller_props,
                    },
                  }
                }
              })
            }
          })
        }
        if (version <= 5 && state?.providers) {
          state.providers.forEach((provider) => {
            // Migrate flash_attn setting to dropdown for llamacpp provider
            if (provider.provider === 'llamacpp' && provider.settings) {
              const flashAttentionSetting = provider.settings.find(
                (s) => s.key === 'flash_attn'
              )
              if (flashAttentionSetting) {
                flashAttentionSetting.controller_type = 'dropdown'
                flashAttentionSetting.controller_props = {
                  ...flashAttentionSetting.controller_props,
                  options: [
                    { name: 'Auto', value: 'auto' },
                    { name: 'On', value: 'on' },
                    { name: 'Off', value: 'off' },
                  ],
                  value: 'auto',
                }
              }
            }
          })
        }
        if (version <= 7 && state?.providers) {
          // Remove 'proactive' capability from all models as it's now managed in MCP settings
          state.providers.forEach((provider) => {
            if (provider.models) {
              provider.models.forEach((model) => {
                if (model.capabilities) {
                  model.capabilities = model.capabilities.filter(
                    (cap) => cap !== 'proactive'
                  )
                }
              })
            }
          })
        }
        if (version <= 8 && state?.providers) {
          state.providers.forEach((provider) => {
            // Migrate Mistral provider base URL to add /v1
            if (provider.provider === 'mistral') {
              if (provider.base_url === 'https://api.mistral.ai') {
                provider.base_url = 'https://api.mistral.ai/v1'
              }

              // Update base-url in settings
              if (provider.settings) {
                const baseUrlSetting = provider.settings.find(
                  (s) => s.key === 'base-url'
                )
                if (
                  baseUrlSetting?.controller_props?.value ===
                  'https://api.mistral.ai'
                ) {
                  baseUrlSetting.controller_props.value =
                    'https://api.mistral.ai/v1'
                }
                if (
                  baseUrlSetting?.controller_props?.placeholder ===
                  'https://api.mistral.ai'
                ) {
                  baseUrlSetting.controller_props.placeholder =
                    'https://api.mistral.ai/v1'
                }
              }
            }
          })
        }

        if (version <= 9 && state?.providers) {
          state.providers = state.providers.filter(
            (provider) => provider.provider !== 'cohere'
          )
        }

        if (version <= 10 && state?.providers) {
          state.providers.forEach((provider) => {
            if (provider.models && provider.provider === 'llamacpp') {
              provider.models.forEach((model) => {
                if (!model.settings) model.settings = {}

                if (!model.settings.auto_increase_ctx_len) {
                  model.settings.auto_increase_ctx_len = {
                    ...modelSettings.auto_increase_ctx_len,
                    controller_props: {
                      ...modelSettings.auto_increase_ctx_len.controller_props,
                    },
                  }
                }
              })
            }
          })
        }

        if (version <= 11 && state?.providers) {
          state.providers.forEach((provider) => {
            if (provider.provider !== 'llamacpp') return

            // Reasoning moved from extension-level to per-model settings —
            // strip any stale entry from the provider settings panel.
            if (provider.settings) {
              provider.settings = provider.settings.filter(
                (s) => s.key !== 'reasoning'
              )
            }

            if (provider.models) {
              provider.models.forEach((model) => {
                if (!model.settings) model.settings = {}

                if (!model.settings.reasoning) {
                  model.settings.reasoning = {
                    ...modelSettings.reasoning,
                    controller_props: {
                      ...modelSettings.reasoning.controller_props,
                    },
                  }
                }
              })
            }
          })
        }

        if (version <= 12 && state?.providers) {
          // Reset ctx_len from the prior 8192 default to '' so llama.cpp picks
          // (auto-fit when enabled, model default otherwise). Preserve any
          // user-customised value.
          state.providers.forEach((provider) => {
            if (provider.provider !== 'llamacpp' || !provider.models) return
            provider.models.forEach((model) => {
              const ctx = model.settings?.ctx_len as
                | { controller_props?: { value?: unknown } }
                | undefined
              if (ctx?.controller_props?.value === 8192) {
                ctx.controller_props.value = ''
              }
            })
          })
        }
        if (version <= 14 && state?.providers) {
          state.providers.forEach((provider) => {
            if (provider.provider !== 'jingxing' || !provider.models) return

            provider.models.forEach((model) => {
              const normalizedCapabilities = normalizeModelCapabilitiesForProvider(
                provider.provider,
                model as Model & { _userConfiguredCapabilities?: boolean }
              )
              if (normalizedCapabilities) {
                model.capabilities = normalizedCapabilities
              }
            })
          })
        }
        if (version <= 15 && state?.providers) {
          state.providers.forEach((provider) => {
            if (
              !isBiyuanProvider(provider.provider, providerBaseUrl(provider)) ||
              !provider.models
            ) {
              return
            }

            provider.models = provider.models.map((model) =>
              normalizeProviderModel(
                provider,
                model as ModelWithCapabilityPreference
              )
            )
          })

          if (state.selectedModel) {
            const selectedProvider = state.providers.find(
              (provider) => provider.provider === state.selectedProvider
            )
            const restoredSelectedModel = selectedProvider?.models.find(
              (model) => model.id === state.selectedModel?.id
            )
            if (restoredSelectedModel) {
              state.selectedModel = restoredSelectedModel
            }
          }
        }
        if (version <= 16 && state?.providers) {
          return migrateLegacyProviderState(state)
        }
        return state
      },
      version: 17,
    }
  )
)
