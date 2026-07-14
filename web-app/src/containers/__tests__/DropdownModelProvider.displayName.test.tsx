import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom'
import DropdownModelProvider from '../DropdownModelProvider'
import { getChatModelFamilySortRank } from '@/lib/chat-model-sort'
import { getModelDisplayName } from '@/lib/utils'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useFavoriteModel } from '@/hooks/useFavoriteModel'
import { useProviderBalance } from '@/hooks/useProviderBalance'

// Define basic types to avoid missing declarations
type ModelProvider = {
  provider: string
  active: boolean
  api_key?: string
  base_url?: string
  models: Array<{
    id: string
    displayName?: string
    capabilities: string[]
  }>
  settings: unknown[]
}

type Model = {
  id: string
  displayName?: string
  capabilities?: string[]
}

type MockHookReturn = {
  providers: ModelProvider[]
  selectedProvider: string
  selectedModel: Model
  getProviderByName: (name: string) => ModelProvider | undefined
  selectModelProvider: () => void
  getModelBy: (id: string) => Model | undefined
  updateProvider: () => void
}

// Mock the dependencies
vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: vi.fn(),
}))

vi.mock('@/hooks/useThreads', () => ({
  useThreads: vi.fn(() => ({
    updateCurrentThreadModel: vi.fn(),
  })),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: vi.fn(() => ({
    t: (key: string) => key,
  })),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: vi.fn(() => vi.fn()),
}))

vi.mock('@/hooks/useFavoriteModel', () => ({
  useFavoriteModel: vi.fn(() => ({
    favoriteModels: [],
  })),
}))

vi.mock('@/hooks/useProviderBalance', () => ({
  useProviderBalance: vi.fn(() => ({
    balance: null,
    loading: false,
    error: null,
    refetch: vi.fn(),
  })),
}))

vi.mock('@/lib/platform/const', () => ({
  PlatformFeatures: {
    WEB_AUTO_MODEL_SELECTION: false,
    MODEL_PROVIDER_SETTINGS: true,
    projects: true,
  },
}))

describe('DropdownModelProvider - Chat Model Sorting', () => {
  it('orders known providers as Claude, GPT, Gemini, and Grok', () => {
    const orderedProviders = ['anthropic', 'openai', 'gemini', 'xai']
    const shuffledProviders = ['xai', 'gemini', 'openai', 'anthropic']

    expect(
      shuffledProviders.sort(
        (a, b) => getChatModelFamilySortRank(a) - getChatModelFamilySortRank(b)
      )
    ).toEqual(orderedProviders)
  })

  it('orders mixed provider model ids as Claude, GPT, Gemini, and Grok', () => {
    const orderedModelIds = [
      'anthropic/claude-sonnet-4-5',
      'openai/gpt-5.4-mini',
      'google/gemini-3-flash-preview',
      'xai/grok-4-fast-reasoning',
    ]
    const shuffledModelIds = [
      'xai/grok-4-fast-reasoning',
      'google/gemini-3-flash-preview',
      'openai/gpt-5.4-mini',
      'anthropic/claude-sonnet-4-5',
    ]

    expect(
      shuffledModelIds.sort(
        (a, b) =>
          getChatModelFamilySortRank('jingxing', a) -
          getChatModelFamilySortRank('jingxing', b)
      )
    ).toEqual(orderedModelIds)
  })
})

// Mock UI components
vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="popover-trigger">{children}</div>
  ),
  PopoverContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="popover-content">{children}</div>
  ),
}))

vi.mock('../ProvidersAvatar', () => ({
  default: ({ provider }: { provider: any }) => (
    <div data-testid={`provider-avatar-${provider.provider}`} />
  ),
}))

vi.mock('../Capabilities', () => ({
  default: ({ capabilities }: { capabilities: string[] }) => (
    <div data-testid="capabilities">{capabilities.join(',')}</div>
  ),
}))

describe('DropdownModelProvider - Display Name Integration', () => {
  const mockProviders: ModelProvider[] = [
    {
      provider: 'remote-test',
      active: true,
      base_url: 'https://api.example.com/v1',
      models: [
        {
          id: 'model1.gguf',
          displayName: 'Custom Model 1',
          capabilities: ['completion'],
        },
        {
          id: 'model2-very-long-filename.gguf',
          displayName: 'Short Name',
          capabilities: ['completion'],
        },
        {
          id: 'model3.gguf',
          // No displayName - should fall back to ID
          capabilities: ['completion'],
        },
      ],
      settings: [],
    },
  ]

  const mockSelectedModel = {
    id: 'model1.gguf',
    displayName: 'Custom Model 1',
    capabilities: ['completion'],
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useProviderBalance).mockReturnValue({
      balance: null,
      loading: false,
      error: null,
      refetch: vi.fn(),
    })

    // Reset the mock for each test
    vi.mocked(useModelProvider).mockReturnValue({
      providers: mockProviders,
      selectedProvider: 'remote-test',
      selectedModel: mockSelectedModel,
      getProviderByName: vi.fn((name: string) =>
        mockProviders.find((p: ModelProvider) => p.provider === name)
      ),
      selectModelProvider: vi.fn(),
      getModelBy: vi.fn((id: string) =>
        mockProviders[0].models.find((m: Model) => m.id === id)
      ),
      updateProvider: vi.fn(),
    } as MockHookReturn)
  })

  afterEach(() => {
    cleanup()
  })

  it('should display custom model name in the trigger button', () => {
    render(<DropdownModelProvider />)

    // Should show the display name in both trigger and dropdown
    expect(screen.getAllByText('Custom Model 1')).toHaveLength(2) // One in trigger, one in dropdown
    // Model ID should not be visible as text (it's only in title attributes)
    expect(screen.queryByDisplayValue('model1.gguf')).not.toBeInTheDocument()
  })

  it('does not show provider balance in the model selector trigger', () => {
    vi.mocked(useProviderBalance).mockReturnValue({
      balance: {
        state: 'supported',
        provider: 'remote-test',
        unit: 'usd',
        fetchedAt: 1781260326,
        accountBalance: { available: 77.13 },
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    })

    render(<DropdownModelProvider />)

    expect(screen.getByTestId('popover-trigger')).not.toHaveTextContent('余额')
  })

  it('should fall back to model ID when no displayName is set', () => {
    vi.mocked(useModelProvider).mockReturnValue({
      providers: mockProviders,
      selectedProvider: 'remote-test',
      selectedModel: mockProviders[0].models[2], // model3 without displayName
      getProviderByName: vi.fn((name: string) =>
        mockProviders.find((p: ModelProvider) => p.provider === name)
      ),
      selectModelProvider: vi.fn(),
      getModelBy: vi.fn((id: string) =>
        mockProviders[0].models.find((m: Model) => m.id === id)
      ),
      updateProvider: vi.fn(),
    } as MockHookReturn)

    render(<DropdownModelProvider />)

    expect(screen.getAllByText('model3.gguf')).toHaveLength(2) // Trigger and dropdown
  })

  it('should show display names in the model list items', () => {
    render(<DropdownModelProvider />)

    // Check if the display names are shown in the options
    expect(screen.getAllByText('Custom Model 1')).toHaveLength(2) // Selected: Trigger + dropdown
    expect(screen.getByText('Short Name')).toBeInTheDocument() // Only in dropdown
    expect(screen.getByText('model3.gguf')).toBeInTheDocument() // Only in dropdown
  })

  it('should use getModelDisplayName utility correctly', () => {
    // Test the utility function directly with different model scenarios
    const modelWithDisplayName = {
      id: 'long-model-name.gguf',
      displayName: 'Short Name',
    } as Model

    const modelWithoutDisplayName = {
      id: 'model-without-display-name.gguf',
    } as Model

    const modelWithEmptyDisplayName = {
      id: 'model-with-empty.gguf',
      displayName: '',
    } as Model

    expect(getModelDisplayName(modelWithDisplayName)).toBe('Short Name')
    expect(getModelDisplayName(modelWithoutDisplayName)).toBe(
      'model-without-display-name.gguf'
    )
    expect(getModelDisplayName(modelWithEmptyDisplayName)).toBe(
      'model-with-empty.gguf'
    )
  })

  it('should maintain model ID for internal operations while showing display name', () => {
    const mockSelectModelProvider = vi.fn()

    vi.mocked(useModelProvider).mockReturnValue({
      providers: mockProviders,
      selectedProvider: 'remote-test',
      selectedModel: mockSelectedModel,
      getProviderByName: vi.fn((name: string) =>
        mockProviders.find((p: ModelProvider) => p.provider === name)
      ),
      selectModelProvider: mockSelectModelProvider,
      getModelBy: vi.fn((id: string) =>
        mockProviders[0].models.find((m: Model) => m.id === id)
      ),
      updateProvider: vi.fn(),
    } as MockHookReturn)

    render(<DropdownModelProvider />)

    // Verify that display name is shown in UI
    expect(screen.getAllByText('Custom Model 1')).toHaveLength(2) // Trigger + dropdown

    // The actual model ID should still be preserved for backend operations
    // This would be tested in the click handlers, but that requires more complex mocking
    expect(mockSelectedModel.id).toBe('model1.gguf')
  })

  it('should handle updating display model when selection changes', () => {
    // Set up mock for model2 selection
    vi.mocked(useModelProvider).mockReturnValue({
      providers: mockProviders,
      selectedProvider: 'remote-test',
      selectedModel: mockProviders[0].models[1], // model2 with displayName "Short Name"
      getProviderByName: vi.fn((name: string) =>
        mockProviders.find((p: ModelProvider) => p.provider === name)
      ),
      selectModelProvider: vi.fn(),
      getModelBy: vi.fn((id: string) =>
        mockProviders[0].models.find((m: Model) => m.id === id)
      ),
      updateProvider: vi.fn(),
    } as MockHookReturn)

    // Render with model2 selected
    render(<DropdownModelProvider />)

    // Check trigger shows Short Name
    expect(screen.getByRole('button')).toHaveTextContent('Short Name')
    // Short Name appears in dropdown (at least 1 occurrence)
    expect(screen.getAllByText('Short Name').length).toBeGreaterThanOrEqual(1)
    // Custom Model 1 is also in the dropdown
    expect(screen.getAllByText('Custom Model 1').length).toBeGreaterThanOrEqual(
      1
    )
  })

  it('should show original model provider avatars for Jingxing models', () => {
    const jingxingProviders: ModelProvider[] = [
      {
        provider: 'jingxing',
        active: true,
        api_key: 'test-token',
        base_url: 'https://api.example.com/v1',
        models: [
          {
            id: 'gpt-5.4',
            capabilities: ['completion'],
          },
        ],
        settings: [],
      },
    ]

    vi.mocked(useModelProvider).mockReturnValue({
      providers: jingxingProviders,
      selectedProvider: 'jingxing',
      selectedModel: jingxingProviders[0].models[0],
      getProviderByName: vi.fn((name: string) =>
        jingxingProviders.find((p: ModelProvider) => p.provider === name)
      ),
      selectModelProvider: vi.fn(),
      getModelBy: vi.fn((id: string) =>
        jingxingProviders[0].models.find((m: Model) => m.id === id)
      ),
      updateProvider: vi.fn(),
    } as MockHookReturn)

    render(<DropdownModelProvider />)

    expect(screen.getByTestId('provider-avatar-jingxing')).toBeInTheDocument()
    expect(screen.getAllByTestId('provider-avatar-openai')).toHaveLength(2)
  })

  it('should show original model provider avatars for favorite Jingxing models', () => {
    const jingxingProviders: ModelProvider[] = [
      {
        provider: 'jingxing',
        active: true,
        api_key: 'test-token',
        base_url: 'https://api.example.com/v1',
        models: [
          {
            id: 'gpt-5.4',
            capabilities: ['completion'],
          },
        ],
        settings: [],
      },
    ]

    vi.mocked(useFavoriteModel).mockReturnValue({
      favoriteModels: [{ id: 'gpt-5.4' }],
    } as ReturnType<typeof useFavoriteModel>)
    vi.mocked(useModelProvider).mockReturnValue({
      providers: jingxingProviders,
      selectedProvider: 'jingxing',
      selectedModel: jingxingProviders[0].models[0],
      getProviderByName: vi.fn((name: string) =>
        jingxingProviders.find((p: ModelProvider) => p.provider === name)
      ),
      selectModelProvider: vi.fn(),
      getModelBy: vi.fn((id: string) =>
        jingxingProviders[0].models.find((m: Model) => m.id === id)
      ),
      updateProvider: vi.fn(),
    } as MockHookReturn)

    render(<DropdownModelProvider />)

    expect(screen.getByTestId('provider-avatar-jingxing')).toBeInTheDocument()
    expect(screen.getAllByTestId('provider-avatar-openai')).toHaveLength(2)
  })

  it('shows only supported providers in the requested order for a new chat', () => {
    const providerNames = [
      'gemini',
      'mistral',
      'xai',
      'deepseek',
      'openrouter',
      'anthropic',
      'azure',
      'openai',
      'jingxing',
    ]
    const providers = providerNames.map((provider) => ({
      provider,
      active: true,
      api_key: 'test-token',
      base_url: `https://${provider}.example.com/v1`,
      models: [
        {
          id: `${provider}-chat-model`,
          capabilities: ['completion'],
        },
      ],
      settings: [],
    }))

    vi.mocked(useModelProvider).mockReturnValue({
      providers,
      selectedProvider: 'jingxing',
      selectedModel: providers.at(-1)!.models[0],
      getProviderByName: vi.fn((name: string) =>
        providers.find((provider) => provider.provider === name)
      ),
      selectModelProvider: vi.fn(),
      getModelBy: vi.fn((id: string) =>
        providers
          .flatMap((provider) => provider.models)
          .find((model) => model.id === id)
      ),
      updateProvider: vi.fn(),
    } as MockHookReturn)

    render(<DropdownModelProvider restrictToVisibleProviders />)

    const providerLabels = [
      'Biyuan AI',
      'OpenAI',
      'Azure',
      'Anthropic',
      'OpenRouter',
      'DeepSeek',
      'xAI',
      'Gemini',
    ].map((label) => screen.getByText(label))

    providerLabels.slice(0, -1).forEach((label, index) => {
      expect(
        label.compareDocumentPosition(providerLabels[index + 1]) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
    })
    expect(screen.queryByText('Mistral')).not.toBeInTheDocument()
    expect(screen.queryByText('mistral-chat-model')).not.toBeInTheDocument()
  })
})
