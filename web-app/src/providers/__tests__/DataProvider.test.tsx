import { fireEvent, render, screen, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getImageModels } from '@/lib/image-generation'

// Stub the build-time define used by DataProvider
;(globalThis as unknown as { UPDATE_CHECK_INTERVAL_MS: number }).UPDATE_CHECK_INTERVAL_MS = 60_000

// Hoisted shared mocks/state
const h = vi.hoisted(() => {
  return {
    setProviders: vi.fn(),
    getProviderByName: vi.fn(),
    updateProvider: vi.fn(),
    addProvider: vi.fn(),
    selectModelProvider: vi.fn(),
    providers: [] as Array<Record<string, unknown>>,
    checkForUpdate: vi.fn(),
    setServers: vi.fn(),
    setSettings: vi.fn(),
    setAssistants: vi.fn(),
    setThreads: vi.fn(),
    invoke: vi.fn().mockResolvedValue(undefined),
    isDev: vi.fn().mockReturnValue(false),
    providerHasRemoteApiKeys: vi.fn().mockReturnValue(true),
    providerRemoteApiKeyChain: vi.fn().mockReturnValue(['key-1']),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
    toastWarning: vi.fn(),
  }
})

// Zustand-style hook with getState support
vi.mock('@/hooks/useModelProvider', () => {
  const useModelProvider = vi.fn(() => ({
    setProviders: h.setProviders,
    getProviderByName: h.getProviderByName,
    updateProvider: h.updateProvider,
    addProvider: h.addProvider,
    selectModelProvider: h.selectModelProvider,
  })) as unknown as { (): unknown; getState: () => { providers: unknown[] } }
  useModelProvider.getState = () => ({
    providers: h.providers,
    getProviderByName: h.getProviderByName,
    updateProvider: h.updateProvider,
    addProvider: h.addProvider,
    selectModelProvider: h.selectModelProvider,
  })
  return { useModelProvider }
})

vi.mock('@/hooks/useAppUpdater', () => ({
  useAppUpdater: () => ({ checkForUpdate: h.checkForUpdate }),
}))

vi.mock('@/hooks/useMCPServers', () => ({
  useMCPServers: () => ({ setServers: h.setServers, setSettings: h.setSettings }),
  DEFAULT_MCP_SETTINGS: { foo: 'bar' },
}))

vi.mock('@/hooks/useAssistant', () => ({
  useAssistant: () => ({ setAssistants: h.setAssistants }),
}))

vi.mock('@/hooks/useThreads', () => ({
  useThreads: () => ({ setThreads: h.setThreads }),
}))

vi.mock('@/lib/utils', () => ({
  cn: (...classes: Array<string | false | null | undefined>) =>
    classes.filter(Boolean).join(' '),
  isDev: () => h.isDev(),
}))

vi.mock('@/lib/provider-api-keys', () => ({
  providerHasRemoteApiKeys: (p: unknown) => h.providerHasRemoteApiKeys(p),
  providerRemoteApiKeyChain: (p: unknown) => h.providerRemoteApiKeyChain(p),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => h.invoke(...args),
}))

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => h.toastSuccess(...args),
    error: (...args: unknown[]) => h.toastError(...args),
    warning: (...args: unknown[]) => h.toastWarning(...args),
  },
}))

vi.mock('@/types/events', () => ({
  SystemEvent: { DEEP_LINK: 'deep-link' },
}))

// Override serviceHub per-test needs. We extend the global setup's mock.
const hubState = vi.hoisted(() => ({
  unsubscribe: vi.fn(),
  deeplinkGetCurrent: vi.fn().mockResolvedValue(null),
  deeplinkOnOpenUrl: vi.fn().mockResolvedValue(undefined),
  eventsListen: vi.fn(),
  getProviders: vi.fn().mockResolvedValue([]),
  updateSettings: vi.fn().mockResolvedValue(undefined),
  fetchModelsFromProvider: vi.fn().mockResolvedValue([]),
  getMCPConfig: vi.fn().mockResolvedValue({ mcpServers: { a: 1 }, mcpSettings: { s: 1 } }),
  getAssistants: vi.fn().mockResolvedValue([]),
  fetchThreads: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/hooks/useServiceHub', () => {
  const hub = {
    providers: () => ({
      getProviders: hubState.getProviders,
      updateSettings: hubState.updateSettings,
      fetchModelsFromProvider: hubState.fetchModelsFromProvider,
    }),
    mcp: () => ({ getMCPConfig: hubState.getMCPConfig }),
    assistants: () => ({ getAssistants: hubState.getAssistants }),
    threads: () => ({ fetchThreads: hubState.fetchThreads }),
    deeplink: () => ({
      getCurrent: hubState.deeplinkGetCurrent,
      onOpenUrl: hubState.deeplinkOnOpenUrl,
    }),
    events: () => ({
      listen: (...args: unknown[]) => {
        hubState.eventsListen(...args)
        return Promise.resolve(hubState.unsubscribe)
      },
    }),
  }
  return {
    useServiceHub: () => hub,
    getServiceHub: () => hub,
    initializeServiceHubStore: vi.fn(),
    isServiceHubInitialized: () => true,
  }
})

// Import after mocks
import { DataProvider } from '../DataProvider'

const resetHubState = () => {
  hubState.getProviders.mockResolvedValue([])
  hubState.updateSettings.mockResolvedValue(undefined)
  hubState.fetchModelsFromProvider.mockResolvedValue([])
  hubState.getMCPConfig.mockResolvedValue({ mcpServers: { a: 1 }, mcpSettings: { s: 1 } })
  hubState.getAssistants.mockResolvedValue([])
  hubState.fetchThreads.mockResolvedValue([])
  hubState.deeplinkGetCurrent.mockResolvedValue(null)
}

describe('DataProvider', () => {
  beforeEach(() => {
    resetHubState()
    h.providers = []
    h.isDev.mockReturnValue(false)
    h.providerHasRemoteApiKeys.mockReturnValue(true)
    h.providerRemoteApiKeyChain.mockReturnValue(['key-1'])
    h.setProviders.mockImplementation((providers) => {
      h.providers = providers as Array<Record<string, unknown>>
    })
    h.invoke.mockResolvedValue(undefined)
    h.getProviderByName.mockReturnValue(undefined)
    h.updateProvider.mockClear()
    h.addProvider.mockClear()
    h.selectModelProvider.mockClear()
    h.toastSuccess.mockClear()
    h.toastError.mockClear()
    h.toastWarning.mockClear()
  })

  it('renders null (no DOM output)', () => {
    const { container } = render(<DataProvider />)
    expect(container.firstChild).toBeNull()
  })

  it('hydrates providers, mcp config, assistants, threads on mount', async () => {
    hubState.getProviders.mockResolvedValue([
      { provider: 'openai', active: true, models: [{ id: 'gpt' }], custom_header: [] },
    ])
    hubState.getAssistants.mockResolvedValue([{ id: 'a1' }])
    hubState.fetchThreads.mockResolvedValue([{ id: 't1' }])

    render(<DataProvider />)

    await waitFor(() => {
      expect(hubState.getProviders).toHaveBeenCalled()
      expect(hubState.getMCPConfig).toHaveBeenCalled()
      expect(hubState.getAssistants).toHaveBeenCalled()
      expect(hubState.fetchThreads).toHaveBeenCalled()
    })

    await waitFor(() => {
      expect(h.setProviders).toHaveBeenCalledWith([
        expect.objectContaining({ provider: 'openai' }),
      ])
      expect(h.setServers).toHaveBeenCalledWith({ a: 1 })
      expect(h.setSettings).toHaveBeenCalledWith({ s: 1 })
      expect(h.setAssistants).toHaveBeenCalledWith([{ id: 'a1' }])
      expect(h.setThreads).toHaveBeenCalledWith([{ id: 't1' }])
    })
  })

  it('refreshes configured remote provider models once on startup', async () => {
    hubState.getProviders.mockResolvedValue([
      {
        provider: 'jingxing',
        active: true,
        api_key: 'sk-test',
        base_url: 'https://api.example.com/v1',
        models: [{ id: 'gpt-old' }],
        custom_header: [],
        settings: [],
      },
    ])
    hubState.fetchModelsFromProvider.mockResolvedValue(['gpt-old', 'gpt-new'])

    render(<DataProvider />)

    await waitFor(() => {
      expect(hubState.fetchModelsFromProvider).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'jingxing' })
      )
    })

    await waitFor(() => {
      expect(h.setProviders).toHaveBeenCalledWith([
        expect.objectContaining({
          provider: 'jingxing',
          models: expect.arrayContaining([
            expect.objectContaining({ id: 'gpt-old' }),
            expect.objectContaining({ id: 'gpt-new' }),
          ]),
        }),
      ])
    })
  })

  it('passes DEFAULT_MCP_SETTINGS when mcp config lacks values', async () => {
    hubState.getMCPConfig.mockResolvedValue({})
    render(<DataProvider />)
    await waitFor(() => {
      expect(h.setServers).toHaveBeenCalledWith({})
      expect(h.setSettings).toHaveBeenCalledWith({ foo: 'bar' })
    })
  })

  it('sets assistants to null when service returns empty array', async () => {
    hubState.getAssistants.mockResolvedValue([])
    render(<DataProvider />)
    await waitFor(() => {
      expect(h.setAssistants).toHaveBeenCalledWith(null)
    })
  })

  it('handles assistants service rejection without crashing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    hubState.getAssistants.mockRejectedValue(new Error('boom'))
    render(<DataProvider />)
    await waitFor(() => {
      expect(warn).toHaveBeenCalledWith(
        'Failed to load assistants, keeping default:',
        expect.any(Error),
      )
    })
    warn.mockRestore()
  })

  it('subscribes to deep link system events and cleans up on unmount', async () => {
    const { unmount } = render(<DataProvider />)
    await waitFor(() => {
      expect(hubState.eventsListen).toHaveBeenCalledWith('deep-link', expect.any(Function))
    })
    // Let the listen().then(unsub => unsubscribe = unsub) resolve
    await act(async () => {
      await Promise.resolve()
    })
    unmount()
    expect(hubState.unsubscribe).toHaveBeenCalled()
  })

  it('registers remote providers with the backend for active providers', async () => {
    hubState.getProviders.mockResolvedValue([
      {
        provider: 'openai',
        active: true,
        models: [{ id: 'gpt-4' }],
        custom_header: [{ header: 'X', value: 'Y' }],
        base_url: 'https://api',
      },
      {
        provider: 'llamacpp',
        active: true,
        models: [],
        custom_header: [],
      },
    ])
    render(<DataProvider />)
    await waitFor(() => {
      expect(h.invoke).toHaveBeenCalledWith(
        'register_provider_config',
        expect.objectContaining({
          request: expect.objectContaining({
            provider: 'openai',
            api_key: 'key-1',
            models: ['gpt-4'],
          }),
        }),
      )
    })
    // llamacpp should be skipped
    const calls = h.invoke.mock.calls.filter(
      (c) => c[0] === 'register_provider_config' && (c[1] as { request: { provider: string } }).request.provider === 'llamacpp',
    )
    expect(calls.length).toBe(0)
  })

  it('skips registration when provider has no API key chain', async () => {
    h.providerRemoteApiKeyChain.mockReturnValue([])
    hubState.getProviders.mockResolvedValue([
      {
        provider: 'openai',
        active: true,
        base_url: 'https://api.openai.com/v1',
        models: [],
        custom_header: [],
      },
    ])
    render(<DataProvider />)
    await waitFor(() => {
      expect(h.providerRemoteApiKeyChain).toHaveBeenCalled()
    })
    const regCalls = h.invoke.mock.calls.filter((c) => c[0] === 'register_provider_config')
    expect(regCalls.length).toBe(0)
  })

  it('logs provider registration failures without throwing', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.invoke.mockRejectedValue(new Error('nope'))
    hubState.getProviders.mockResolvedValue([
      {
        provider: 'openai',
        active: true,
        base_url: 'https://api.openai.com/v1',
        models: [],
        custom_header: [],
      },
    ])
    render(<DataProvider />)
    await waitFor(() => {
      expect(err).toHaveBeenCalledWith(
        expect.stringContaining('Failed to register provider openai'),
        expect.any(Error),
      )
    })
    err.mockRestore()
  })

  it('skips update check when in dev mode', async () => {
    h.isDev.mockReturnValue(true)
    render(<DataProvider />)
    // Yield microtasks
    await act(async () => {
      await Promise.resolve()
    })
    expect(h.checkForUpdate).not.toHaveBeenCalled()
  })

  it('runs initial update check and schedules periodic checks outside dev', async () => {
    vi.useFakeTimers()
    h.isDev.mockReturnValue(false)
    render(<DataProvider />)
    expect(h.checkForUpdate).toHaveBeenCalledTimes(1)
    await act(async () => {
      vi.advanceTimersByTime(60_000)
    })
    expect(h.checkForUpdate).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('ignores retired local-model import deep links', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const deeplinkUrl = 'mita://host/action/owner/repo'
    hubState.deeplinkGetCurrent.mockResolvedValue([deeplinkUrl])
    render(<DataProvider />)
    await waitFor(() => {
      expect(info).toHaveBeenCalledWith(
        'Ignored unsupported deep link. Local model imports are retired.'
      )
    })
    info.mockRestore()
  })

  it('opens a confirmation dialog for provider import deep links', async () => {
    hubState.deeplinkGetCurrent.mockResolvedValue([
      'mita://provider/import?provider=jingxing&apiKey=sk-imported-1234&baseUrl=https%3A%2F%2Fapi.example.com%2Fv1%2F&defaultModel=gpt-5.1',
    ])

    render(<DataProvider />)

    expect(await screen.findByText('导入 AI 供应商配置')).toBeInTheDocument()
    expect(screen.getByText('https://api.example.com/v1')).toBeInTheDocument()
    expect(screen.getByText('sk-i***1234')).toBeInTheDocument()
  })

  it('imports provider settings after confirmation', async () => {
    hubState.deeplinkGetCurrent.mockResolvedValue([
      'mita://provider/import?provider=jingxing&apiKey=sk-imported-1234&baseUrl=https%3A%2F%2Fapi.example.com%2Fv1&defaultModel=gpt-5.1',
    ])
    hubState.fetchModelsFromProvider.mockResolvedValue(['gpt-5.1', 'claude-test'])

    render(<DataProvider />)

    fireEvent.click(await screen.findByText('确认导入'))

    await waitFor(() => {
      expect(hubState.updateSettings).toHaveBeenCalledWith(
        'jingxing',
        expect.arrayContaining([
          expect.objectContaining({
            key: 'api-key',
            controller_props: expect.objectContaining({
              value: 'sk-imported-1234',
            }),
          }),
          expect.objectContaining({
            key: 'base-url',
            controller_props: expect.objectContaining({
              value: 'https://api.example.com/v1',
            }),
          }),
        ])
      )
    })

    expect(h.addProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'jingxing',
        active: true,
        api_key: 'sk-imported-1234',
        base_url: 'https://api.example.com/v1',
        models: expect.arrayContaining([
          expect.objectContaining({ id: 'gpt-5.1' }),
          expect.objectContaining({ id: 'claude-test' }),
        ]),
      })
    )
    expect(h.selectModelProvider).toHaveBeenCalledWith('jingxing', 'gpt-5.1')
    expect(h.toastSuccess).toHaveBeenCalledWith('配置已导入', {
      description: undefined,
    })
  })

  it('imports a new biyuan deep link into canonical jingxing with an offline image model fallback', async () => {
    hubState.deeplinkGetCurrent.mockResolvedValue([
      'mita://provider/import?provider=biyuan&apiKey=sk-test-import&baseUrl=https%3A%2F%2Fapi.biyuan.ai%2Fv1&defaultModel=gpt-image-2',
    ])
    hubState.fetchModelsFromProvider.mockRejectedValue(
      new Error('403 selfhold forbidden')
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    render(<DataProvider />)
    fireEvent.click(await screen.findByText('确认导入'))

    await waitFor(() => {
      expect(h.addProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'jingxing',
          base_url: 'https://api.biyuan.ai/v1',
          models: [
            expect.objectContaining({
              id: 'gpt-image-2',
              capabilities: expect.arrayContaining([
                'image_generation',
                'text_to_image',
              ]),
            }),
          ],
        })
      )
    })
    expect(h.selectModelProvider).toHaveBeenCalledWith(
      'jingxing',
      'gpt-image-2'
    )
    const importedProvider = h.addProvider.mock.calls.at(-1)?.[0] as ModelProvider
    expect(getImageModels([importedProvider])).toHaveLength(1)
    expect(h.toastSuccess).toHaveBeenCalledWith('配置已导入', {
      description: '模型列表刷新失败，可稍后手动刷新。',
    })
    warn.mockRestore()
  })

  it('reuses an existing jingxing family provider for a biyuan deep link', async () => {
    const existingProvider = {
      provider: 'jingxing',
      active: true,
      api_key: 'sk-old',
      api_key_fallbacks: ['sk-fallback'],
      base_url: 'https://api.biyuan.ai/v1',
      models: [
        {
          id: 'gpt-image-2',
          capabilities: ['completion'],
          settings: { quality: { controller_props: { value: 'high' } } },
        },
      ],
      settings: [],
    }
    h.providers = [existingProvider]
    h.getProviderByName.mockImplementation((name) =>
      name === 'jingxing' ? existingProvider : undefined
    )
    hubState.deeplinkGetCurrent.mockResolvedValue([
      'mita://provider/import?provider=biyuan&apiKey=sk-new&baseUrl=https%3A%2F%2Fapi.biyuan.ai%2Fv1&defaultModel=gpt-image-2',
    ])
    hubState.fetchModelsFromProvider.mockRejectedValue(new Error('403'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    render(<DataProvider />)
    // Startup hydration is mocked independently, so restore the persisted store
    // snapshot immediately before confirming the pending import.
    await screen.findByText('确认导入')
    h.providers = [existingProvider]
    fireEvent.click(screen.getByText('确认导入'))

    await waitFor(() => {
      expect(h.updateProvider).toHaveBeenCalledWith(
        'jingxing',
        expect.objectContaining({
          provider: 'jingxing',
          api_key: 'sk-new',
          api_key_fallbacks: ['sk-fallback'],
          models: [
            expect.objectContaining({
              id: 'gpt-image-2',
              settings: existingProvider.models[0].settings,
              capabilities: expect.arrayContaining([
                'image_generation',
                'text_to_image',
              ]),
            }),
          ],
        })
      )
    })
    expect(h.addProvider).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('does not overwrite a third-party openai-compatible provider for a Biyuan-hosted import', async () => {
    const thirdPartyProvider = {
      provider: 'openai-compatible',
      active: true,
      api_key: 'sk-third-party',
      base_url: 'https://api.example.com/v1',
      models: [],
      settings: [],
    }
    h.providers = [thirdPartyProvider]
    h.getProviderByName.mockImplementation((name) =>
      name === 'openai-compatible' ? thirdPartyProvider : undefined
    )
    hubState.deeplinkGetCurrent.mockResolvedValue([
      'mita://provider/import?provider=openai-compatible&apiKey=sk-biyuan&baseUrl=https%3A%2F%2Fapi.biyuan.ai%2Fv1&defaultModel=gpt-image-2',
    ])
    hubState.fetchModelsFromProvider.mockResolvedValue([
      {
        id: 'gpt-image-2',
        supported_endpoint_types: ['image-generation'],
      },
    ])

    render(<DataProvider />)
    await screen.findByText('确认导入')
    h.providers = [thirdPartyProvider]
    fireEvent.click(screen.getByText('确认导入'))

    await waitFor(() => {
      expect(h.addProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'jingxing',
          base_url: 'https://api.biyuan.ai/v1',
        })
      )
    })
    expect(h.updateProvider).not.toHaveBeenCalled()
  })

  it('shows an error for invalid provider import deep links', async () => {
    hubState.deeplinkGetCurrent.mockResolvedValue([
      'mita://provider/import?provider=jingxing&baseUrl=https%3A%2F%2Fapi.example.com%2Fv1',
    ])

    render(<DataProvider />)

    await waitFor(() => {
      expect(h.toastError).toHaveBeenCalledWith('导入链接无效', {
        description: '缺少 API Key',
      })
    })
    expect(screen.queryByText('导入 AI 供应商配置')).not.toBeInTheDocument()
  })

  it('ignores deep links with insufficient path segments', async () => {
    hubState.deeplinkGetCurrent.mockResolvedValue(['mita://only'])
    render(<DataProvider />)
    await act(async () => {
      await Promise.resolve()
    })
  })

  it('ignores null deep link payload', async () => {
    hubState.deeplinkGetCurrent.mockResolvedValue(null)
    render(<DataProvider />)
    await act(async () => {
      await Promise.resolve()
    })
  })
})
