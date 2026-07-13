import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { getImageModels } from '@/lib/image-generation'
import { useModelProvider } from '../useModelProvider'

// Mock getServiceHub
vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: vi.fn(() => ({
    path: () => ({
      sep: () => '/',
    }),
  })),
}))

// Mock the localStorage key constants
vi.mock('@/constants/localStorage', () => ({
  localStorageKey: {
    modelProvider: 'model-provider',
  },
}))

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn(() => null),
}
Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
  writable: true,
})

describe('useModelProvider - displayName functionality', () => {
  beforeEach(() => {
    // Reset the mock implementations instead of clearing them
    localStorageMock.getItem.mockReturnValue(null)
    localStorageMock.setItem.mockClear()
    localStorageMock.removeItem.mockClear()
    localStorageMock.clear.mockClear()

    // Reset Zustand store to default state
    act(() => {
      useModelProvider.setState({
        providers: [],
        selectedProvider: 'llamacpp',
        selectedModel: null,
        deletedModels: [],
      })
    })
  })

  it('should handle models without displayName property', () => {
    const { result } = renderHook(() => useModelProvider())

    const provider = {
      provider: 'llamacpp',
      active: true,
      models: [
        {
          id: 'test-model.gguf',
          capabilities: ['completion'],
        },
      ],
      settings: [],
    } as any

    // First add the provider, then update it (since updateProvider only updates existing providers)
    act(() => {
      result.current.addProvider(provider)
    })

    const updatedProvider = result.current.getProviderByName('llamacpp')
    expect(updatedProvider?.models[0].displayName).toBeUndefined()
    expect(updatedProvider?.models[0].id).toBe('test-model.gguf')
  })

  it('should preserve displayName when merging providers in setProviders', () => {
    const { result } = renderHook(() => useModelProvider())

    // First, set up initial state with displayName via direct state manipulation
    // This simulates the scenario where a user has already customized a display name
    act(() => {
      useModelProvider.setState({
        providers: [
          {
            provider: 'llamacpp',
            active: true,
            models: [
              {
                id: 'test-model.gguf',
                displayName: 'My Custom Model',
                capabilities: ['completion'],
              },
            ],
            settings: [],
          },
        ] as any,
        selectedProvider: 'llamacpp',
        selectedModel: null,
        deletedModels: [],
      })
    })

    // Now simulate setProviders with fresh data (like from server refresh)
    const freshProviders = [
      {
        provider: 'llamacpp',
        active: true,
        persist: true,
        models: [
          {
            id: 'test-model.gguf',
            capabilities: ['completion'],
            // Note: no displayName in fresh data
          },
        ],
        settings: [],
      },
    ] as any

    act(() => {
      result.current.setProviders(freshProviders)
    })

    // The displayName should be preserved from existing state
    const provider = result.current.getProviderByName('llamacpp')
    expect(provider?.models[0].displayName).toBe('My Custom Model')
  })

  it('should preserve user-configured capabilities when merging setProviders refresh', () => {
    const { result } = renderHook(() => useModelProvider())

    act(() => {
      useModelProvider.setState({
        providers: [
          {
            provider: 'llamacpp',
            active: true,
            models: [
              {
                id: 'test-model.gguf',
                capabilities: ['completion'],
                _userConfiguredCapabilities: true,
              },
            ],
            settings: [],
          },
        ] as any,
        selectedProvider: 'llamacpp',
        selectedModel: null,
        deletedModels: [],
      })
    })

    const freshProviders = [
      {
        provider: 'llamacpp',
        active: true,
        persist: true,
        models: [
          {
            id: 'test-model.gguf',
            capabilities: ['completion', 'vision', 'tools'],
          },
        ],
        settings: [],
      },
    ] as any

    act(() => {
      result.current.setProviders(freshProviders)
    })

    const provider = result.current.getProviderByName('llamacpp')
    expect(provider?.models[0].capabilities).toEqual(['completion'])
    expect(
      (provider?.models[0] as { _userConfiguredCapabilities?: boolean })
        ._userConfiguredCapabilities
    ).toBe(true)
  })

  it('should provide basic functionality without breaking existing behavior', () => {
    const { result } = renderHook(() => useModelProvider())

    // Test that basic provider operations work
    expect(result.current.providers).toEqual([])
    expect(result.current.selectedProvider).toBe('llamacpp')
    expect(result.current.selectedModel).toBeNull()

    // Test addProvider functionality
    const provider = {
      provider: 'openai',
      active: true,
      models: [],
      settings: [],
    } as any

    act(() => {
      result.current.addProvider(provider)
    })

    expect(result.current.providers).toHaveLength(1)
    expect(result.current.getProviderByName('openai')).toBeDefined()
  })

  it('should handle provider operations with models that have displayName', () => {
    const { result } = renderHook(() => useModelProvider())

    // Test that we can at least get and set providers with displayName models
    const providerWithDisplayName = {
      provider: 'llamacpp',
      active: true,
      models: [
        {
          id: 'test-model.gguf',
          displayName: 'Custom Model Name',
          capabilities: ['completion'],
        },
      ],
      settings: [],
    } as any

    // Set the state directly (simulating what would happen in real usage)
    act(() => {
      useModelProvider.setState({
        providers: [providerWithDisplayName],
        selectedProvider: 'llamacpp',
        selectedModel: null,
        deletedModels: [],
      })
    })

    const provider = result.current.getProviderByName('llamacpp')
    expect(provider?.models[0].displayName).toBe('Custom Model Name')
    expect(provider?.models[0].id).toBe('test-model.gguf')
  })
})

describe('useModelProvider migrations', () => {
  it('repairs persisted Biyuan image capabilities without changing provider identity or credentials', () => {
    const persistApi = (useModelProvider as any).persist
    const migrate = persistApi?.getOptions().migrate as
      | ((state: unknown, version: number) => any)
      | undefined
    const settings = [
      {
        key: 'base-url',
        controller_props: { value: 'https://api.biyuan.ai/v1' },
      },
    ]
    const modelSettings = { quality: { controller_props: { value: 'high' } } }
    const persistedState = {
      providers: [
        {
          provider: 'biyuan',
          active: true,
          api_key: 'sk-primary',
          api_key_fallbacks: ['sk-fallback'],
          base_url: 'https://api.biyuan.ai/v1',
          settings,
          models: [
            {
              id: 'gpt-image-2',
              capabilities: ['completion'],
              settings: modelSettings,
            },
          ],
        },
      ],
      selectedProvider: 'biyuan',
      selectedModel: {
        id: 'gpt-image-2',
        capabilities: ['completion'],
        settings: modelSettings,
      },
      deletedModels: [],
    }

    const migratedState = migrate!(persistedState, 15)
    const provider = migratedState.providers[0]

    expect(provider.provider).toBe('biyuan')
    expect(provider.api_key).toBe('sk-primary')
    expect(provider.api_key_fallbacks).toEqual(['sk-fallback'])
    expect(provider.settings).toBe(settings)
    expect(provider.models[0].settings).toBe(modelSettings)
    expect(provider.models[0].capabilities).toEqual(
      expect.arrayContaining(['image_generation', 'text_to_image'])
    )
    expect(migratedState.selectedProvider).toBe('biyuan')
    expect(migratedState.selectedModel).toEqual(
      expect.objectContaining({
        id: 'gpt-image-2',
        capabilities: expect.arrayContaining([
          'image_generation',
          'text_to_image',
        ]),
      })
    )
  })

  it('repairs persisted Biyuan-hosted openai-compatible models only', () => {
    const persistApi = (useModelProvider as any).persist
    const migrate = persistApi?.getOptions().migrate as
      | ((state: unknown, version: number) => any)
      | undefined
    const persistedState = {
      providers: [
        {
          provider: 'openai-compatible',
          base_url: 'https://api.biyuan.ai/v1',
          settings: [],
          models: [{ id: 'gpt-image-2', capabilities: ['completion'] }],
        },
        {
          provider: 'third-party',
          base_url: 'https://api.example.com/v1',
          settings: [],
          models: [{ id: 'gpt-image-2', capabilities: ['completion'] }],
        },
      ],
      selectedProvider: 'third-party',
      selectedModel: null,
      deletedModels: [],
    }

    const migratedState = migrate!(persistedState, 15)

    expect(migratedState.providers[0].models[0].capabilities).toEqual(
      expect.arrayContaining(['image_generation', 'text_to_image'])
    )
    expect(migratedState.providers[1].models[0].capabilities).toEqual([
      'completion',
    ])
  })

  it('migrates flash_attn setting to dropdown with default value', () => {
    const persistApi = (useModelProvider as any).persist
    const migrate = persistApi?.getOptions().migrate as
      | ((state: unknown, version: number) => any)
      | undefined

    expect(migrate).toBeDefined()

    const persistedState = {
      providers: [
        {
          provider: 'llamacpp',
          models: [],
          settings: [
            {
              key: 'flash_attn',
              controller_type: 'toggle',
              controller_props: {
                value: 'ON',
              },
            },
          ],
        },
      ],
      selectedProvider: 'llamacpp',
      selectedModel: null,
      deletedModels: [],
    }

    const migratedState = migrate!(persistedState, 5)
    const flashAttnSetting = migratedState.providers[0].settings.find(
      (setting: any) => setting.key === 'flash_attn'
    )

    expect(flashAttnSetting.controller_type).toBe('dropdown')
    expect(flashAttnSetting.controller_props.value).toBe('auto')
    expect(flashAttnSetting.controller_props.options).toEqual([
      { name: 'Auto', value: 'auto' },
      { name: 'On', value: 'on' },
      { name: 'Off', value: 'off' },
    ])
  })

  it('migrates Mistral provider base URL to add /v1 suffix', () => {
    const persistApi = (useModelProvider as any).persist
    const migrate = persistApi?.getOptions().migrate as
      | ((state: unknown, version: number) => any)
      | undefined

    expect(migrate).toBeDefined()

    const persistedState = {
      providers: [
        {
          provider: 'mistral',
          models: [],
          base_url: 'https://api.mistral.ai',
          settings: [
            {
              key: 'base-url',
              controller_props: {
                value: 'https://api.mistral.ai',
                placeholder: 'https://api.mistral.ai',
              },
            },
          ],
        },
      ],
      selectedProvider: 'mistral',
      selectedModel: null,
      deletedModels: [],
    }

    const migratedState = migrate!(persistedState, 8)
    const mistralProvider = migratedState.providers[0]
    const baseUrlSetting = mistralProvider.settings.find(
      (setting: any) => setting.key === 'base-url'
    )

    expect(mistralProvider.base_url).toBe('https://api.mistral.ai/v1')
    expect(baseUrlSetting.controller_props.value).toBe('https://api.mistral.ai/v1')
    expect(baseUrlSetting.controller_props.placeholder).toBe('https://api.mistral.ai/v1')
  })

  it('does not migrate Mistral provider base URL if already has /v1', () => {
    const persistApi = (useModelProvider as any).persist
    const migrate = persistApi?.getOptions().migrate as
      | ((state: unknown, version: number) => any)
      | undefined

    expect(migrate).toBeDefined()

    const persistedState = {
      providers: [
        {
          provider: 'mistral',
          models: [],
          base_url: 'https://api.mistral.ai/v1',
          settings: [
            {
              key: 'base-url',
              controller_props: {
                value: 'https://api.mistral.ai/v1',
                placeholder: 'https://api.mistral.ai/v1',
              },
            },
          ],
        },
      ],
      selectedProvider: 'mistral',
      selectedModel: null,
      deletedModels: [],
    }

    const migratedState = migrate!(persistedState, 8)
    const mistralProvider = migratedState.providers[0]
    const baseUrlSetting = mistralProvider.settings.find(
      (setting: any) => setting.key === 'base-url'
    )

    expect(mistralProvider.base_url).toBe('https://api.mistral.ai/v1')
    expect(baseUrlSetting.controller_props.value).toBe('https://api.mistral.ai/v1')
    expect(baseUrlSetting.controller_props.placeholder).toBe('https://api.mistral.ai/v1')
  })

  it('does not affect other providers during Mistral migration', () => {
    const persistApi = (useModelProvider as any).persist
    const migrate = persistApi?.getOptions().migrate as
      | ((state: unknown, version: number) => any)
      | undefined

    expect(migrate).toBeDefined()

    const persistedState = {
      providers: [
        {
          provider: 'mistral',
          models: [],
          base_url: 'https://api.mistral.ai',
          settings: [],
        },
        {
          provider: 'openai',
          models: [],
          base_url: 'https://api.openai.com/v1',
          settings: [],
        },
      ],
      selectedProvider: 'mistral',
      selectedModel: null,
      deletedModels: [],
    }

    const migratedState = migrate!(persistedState, 8)

    expect(migratedState.providers[0].base_url).toBe('https://api.mistral.ai/v1')
    expect(migratedState.providers[1].base_url).toBe('https://api.openai.com/v1')
  })
})

describe('useModelProvider Biyuan restoration', () => {
  beforeEach(() => {
    localStorageMock.getItem.mockReturnValue('true')
    act(() => {
      useModelProvider.setState({
        providers: [],
        selectedProvider: 'jingxing',
        selectedModel: null,
        deletedModels: [],
      })
    })
  })

  it('repairs retained persisted Biyuan providers on every setProviders call', () => {
    const modelSettings = { quality: { controller_props: { value: 'high' } } }
    act(() => {
      useModelProvider.setState({
        providers: [
          {
            provider: 'biyuan',
            active: true,
            api_key: 'sk-primary',
            api_key_fallbacks: ['sk-fallback'],
            base_url: 'https://api.biyuan.ai/v1',
            settings: [],
            models: [
              {
                id: 'gpt-image-2',
                capabilities: ['completion'],
                settings: modelSettings,
              },
            ],
          },
        ] as any,
        selectedProvider: 'biyuan',
        selectedModel: {
          id: 'gpt-image-2',
          capabilities: ['completion'],
          settings: modelSettings,
        } as any,
        deletedModels: [],
      })
    })

    act(() => {
      useModelProvider.getState().setProviders([])
    })

    const state = useModelProvider.getState()
    const provider = state.providers[0]
    expect(provider.provider).toBe('biyuan')
    expect(provider.api_key).toBe('sk-primary')
    expect(provider.api_key_fallbacks).toEqual(['sk-fallback'])
    expect(provider.models[0].settings).toBe(modelSettings)
    expect(provider.models[0].capabilities).toEqual(
      expect.arrayContaining(['image_generation', 'text_to_image'])
    )
    expect(getImageModels([provider])).toHaveLength(1)
    expect(state.selectedProvider).toBe('biyuan')
    expect(state.selectedModel).toEqual(
      expect.objectContaining({
        id: 'gpt-image-2',
        capabilities: expect.arrayContaining([
          'image_generation',
          'text_to_image',
        ]),
      })
    )
  })

  it('repairs Biyuan-hosted openai-compatible models without changing third-party models', () => {
    act(() => {
      useModelProvider.setState({
        providers: [
          {
            provider: 'openai-compatible',
            active: true,
            base_url: 'https://api.biyuan.ai/v1',
            settings: [],
            models: [{ id: 'gpt-image-2', capabilities: ['completion'] }],
          },
          {
            provider: 'third-party',
            active: true,
            base_url: 'https://api.example.com/v1',
            settings: [],
            models: [{ id: 'gpt-image-2', capabilities: ['completion'] }],
          },
        ] as any,
        selectedProvider: 'third-party',
        selectedModel: null,
        deletedModels: [],
      })
    })

    act(() => {
      useModelProvider.getState().setProviders([])
    })

    const providers = useModelProvider.getState().providers
    expect(providers[0].models[0].capabilities).toEqual(
      expect.arrayContaining(['image_generation', 'text_to_image'])
    )
    expect(providers[1].models[0].capabilities).toEqual(['completion'])
  })
})
