import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock all external dependencies before imports
vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}))

vi.mock('@/constants/providers', () => ({
  predefinedProviders: [
    {
      provider: 'openai',
      active: false,
      base_url: 'https://api.openai.com/v1',
      models: [{ id: 'gpt-4', name: 'GPT-4' }],
    },
  ],
}))

vi.mock('@/constants/models', () => ({
  providerModels: {
    openai: {
      models: ['gpt-4', 'gpt-3.5-turbo'],
    },
  },
}))

vi.mock('@janhq/core', () => ({
  EngineManager: {
    instance: vi.fn(),
  },
  SettingComponentProps: {},
}))

vi.mock('@/types/models', () => ({
  ModelCapabilities: {
    TOOLS: 'tools',
    EMBEDDINGS: 'embeddings',
  },
}))

vi.mock('@/lib/predefined', () => ({
  modelSettings: {
    temperature: {
      key: 'temperature',
      controller_props: { value: 0.7 },
    },
    ctx_len: {
      key: 'ctx_len',
      controller_props: { value: 4096 },
    },
  },
}))

vi.mock('@/lib/extension', () => ({
  ExtensionManager: {
    getInstance: vi.fn(),
  },
}))

vi.mock('@/lib/models', () => ({
  getModelCapabilities: vi.fn().mockReturnValue([]),
}))

vi.mock('@/lib/provider-api-keys', () => ({
  providerRemoteApiKeyChain: vi.fn().mockReturnValue([]),
}))

import { fetch as fetchTauri } from '@tauri-apps/plugin-http'
import { EngineManager } from '@janhq/core'
import { ExtensionManager } from '@/lib/extension'
import { providerRemoteApiKeyChain } from '@/lib/provider-api-keys'
import { getModelCapabilities } from '@/lib/models'
import { ProviderQuotaError } from '@/lib/provider-quota-error'
import { TauriProvidersService } from '../tauri'

describe('TauriProvidersService', () => {
  let svc: TauriProvidersService

  beforeEach(() => {
    vi.clearAllMocks()
    svc = new TauriProvidersService()
  })

  describe('fetch', () => {
    it('returns Tauri fetch', () => {
      expect(svc.fetch()).toBe(fetchTauri)
    })
  })

  describe('getProviders', () => {
    it('passes each builtin provider base URL into capability inference', async () => {
      vi.mocked(EngineManager.instance).mockReturnValue({
        engines: new Map(),
      } as any)

      await svc.getProviders()

      expect(getModelCapabilities).toHaveBeenCalledWith(
        'openai',
        'gpt-4',
        'https://api.openai.com/v1'
      )
      expect(getModelCapabilities).toHaveBeenCalledWith(
        'openai',
        'gpt-3.5-turbo',
        'https://api.openai.com/v1'
      )
    })

    it('returns builtin + runtime providers on success', async () => {
      const mockEngine = {
        list: vi.fn().mockResolvedValue([
          { id: 'local-model', name: 'Local', description: 'desc' },
        ]),
        getSettings: vi.fn().mockResolvedValue([]),
        isToolSupported: vi.fn().mockResolvedValue(false),
        inferenceUrl: 'http://localhost:1337/chat/completions',
      }
      vi.mocked(EngineManager.instance).mockReturnValue({
        engines: new Map([['llama.cpp', mockEngine]]),
      } as any)

      const result = await svc.getProviders()
      expect(result.length).toBeGreaterThan(0)
      // Runtime provider first, then builtins
      const llama = result.find((p: any) => p.provider === 'llama.cpp')
      expect(llama).toBeDefined()
      expect(llama!.models).toHaveLength(1)
    })

    it('skips hidden providers (foundation-models)', async () => {
      const hiddenEngine = { list: vi.fn(), getSettings: vi.fn() }
      vi.mocked(EngineManager.instance).mockReturnValue({
        engines: new Map([['foundation-models', hiddenEngine]]),
      } as any)

      const result = await svc.getProviders()
      expect(hiddenEngine.list).not.toHaveBeenCalled()
      // Only builtins
      expect(result.every((p: any) => p.provider !== 'foundation-models')).toBe(true)
    })

    it('adds TOOLS capability when isToolSupported returns true', async () => {
      const mockEngine = {
        list: vi.fn().mockResolvedValue([{ id: 'm1', name: 'M1', description: '' }]),
        getSettings: vi.fn().mockResolvedValue([]),
        isToolSupported: vi.fn().mockResolvedValue(true),
        inferenceUrl: 'http://localhost:1337/chat/completions',
      }
      vi.mocked(EngineManager.instance).mockReturnValue({
        engines: new Map([['test-engine', mockEngine]]),
      } as any)

      const result = await svc.getProviders()
      const provider = result.find((p: any) => p.provider === 'test-engine')
      expect(provider!.models[0].capabilities).toContain('tools')
    })

    it('adds EMBEDDINGS capability for embedding models', async () => {
      const mockEngine = {
        list: vi.fn().mockResolvedValue([{ id: 'emb', name: 'Emb', description: '', embedding: true }]),
        getSettings: vi.fn().mockResolvedValue([]),
        isToolSupported: vi.fn().mockResolvedValue(false),
        inferenceUrl: 'http://localhost:1337/chat/completions',
      }
      vi.mocked(EngineManager.instance).mockReturnValue({
        engines: new Map([['emb-engine', mockEngine]]),
      } as any)

      const result = await svc.getProviders()
      const provider = result.find((p: any) => p.provider === 'emb-engine')
      expect(provider!.models[0].capabilities).toContain('embeddings')
    })

    it('warns but continues when isToolSupported throws', async () => {
      const mockEngine = {
        list: vi.fn().mockResolvedValue([{ id: 'm1', name: 'M1', description: '' }]),
        getSettings: vi.fn().mockResolvedValue([]),
        isToolSupported: vi.fn().mockRejectedValue(new Error('fail')),
        inferenceUrl: 'http://localhost:1337/chat/completions',
      }
      vi.mocked(EngineManager.instance).mockReturnValue({
        engines: new Map([['test-engine', mockEngine]]),
      } as any)

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const result = await svc.getProviders()
      expect(result.find((p: any) => p.provider === 'test-engine')).toBeDefined()
      expect(warnSpy).toHaveBeenCalled()
      warnSpy.mockRestore()
    })

    it('returns empty array on top-level error', async () => {
      vi.mocked(EngineManager.instance).mockImplementation(() => {
        throw new Error('boom')
      })
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const result = await svc.getProviders()
      expect(result).toEqual([])
      errSpy.mockRestore()
    })

    it('maps engine settings correctly', async () => {
      const mockEngine = {
        list: vi.fn().mockResolvedValue([]),
        getSettings: vi.fn().mockResolvedValue([
          { key: 'api_key', title: 'API Key', description: 'Key', controllerType: 'input', controllerProps: {} },
        ]),
        inferenceUrl: 'http://localhost:1337/chat/completions',
      }
      vi.mocked(EngineManager.instance).mockReturnValue({
        engines: new Map([['test', mockEngine]]),
      } as any)

      const result = await svc.getProviders()
      const provider = result.find((p: any) => p.provider === 'test')
      expect(provider!.settings).toEqual([
        { key: 'api_key', title: 'API Key', description: 'Key', controller_type: 'input', controller_props: {} },
      ])
    })
  })

  describe('fetchModelsFromProvider', () => {
    const baseProvider = {
      provider: 'test-provider',
      base_url: 'https://api.test.com/v1',
      active: false,
    } as any

    it('throws if no base_url', async () => {
      await expect(svc.fetchModelsFromProvider({ ...baseProvider, base_url: '' }))
        .rejects.toThrow('Provider must have base_url configured')
    })

    it('returns model ids from data.data format', async () => {
      vi.mocked(fetchTauri).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ data: [{ id: 'model-1' }, { id: 'model-2' }] }),
      } as any)

      const result = await svc.fetchModelsFromProvider(baseProvider)
      expect(result).toEqual(['model-1', 'model-2'])
    })

    it('preserves provider model endpoint metadata from data.data format', async () => {
      vi.mocked(fetchTauri).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          data: [
            {
              id: 'gpt-5.4-pro',
              supported_endpoint_types: ['openai-response'],
            },
            {
              id: 'gpt-4o-transcribe',
              supported_endpoint_types: ['audio-transcription'],
            },
          ],
        }),
      } as any)

      const result = await svc.fetchModelsFromProvider(baseProvider)
      expect(result).toEqual([
        {
          id: 'gpt-5.4-pro',
          supported_endpoint_types: ['openai-response'],
        },
        {
          id: 'gpt-4o-transcribe',
          supported_endpoint_types: ['audio-transcription'],
        },
      ])
    })

    it('returns model ids from array format', async () => {
      vi.mocked(fetchTauri).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]),
      } as any)

      const result = await svc.fetchModelsFromProvider(baseProvider)
      expect(result).toEqual(['a', 'b'])
    })

    it('returns model ids from data.models format', async () => {
      vi.mocked(fetchTauri).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ models: ['m1', 'm2'] }),
      } as any)

      const result = await svc.fetchModelsFromProvider(baseProvider)
      expect(result).toEqual(['m1', 'm2'])
    })

    it('returns empty for unexpected format', async () => {
      vi.mocked(fetchTauri).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ unexpected: true }),
      } as any)

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const result = await svc.fetchModelsFromProvider(baseProvider)
      expect(result).toEqual([])
      warnSpy.mockRestore()
    })

    it('throws structured error on 401', async () => {
      vi.mocked(fetchTauri).mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      } as any)

      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      await expect(svc.fetchModelsFromProvider(baseProvider))
        .rejects.toThrow('Authentication failed')
      errSpy.mockRestore()
    })

    it('throws structured error on 403', async () => {
      vi.mocked(fetchTauri).mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
      } as any)

      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      await expect(svc.fetchModelsFromProvider(baseProvider))
        .rejects.toThrow('Access forbidden')
      errSpy.mockRestore()
    })

    it('throws quota error on quota exhaustion and does not try fallback keys', async () => {
      vi.mocked(providerRemoteApiKeyChain).mockReturnValueOnce([
        'primary-key',
        'fallback-key',
      ])
      vi.mocked(fetchTauri).mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message: '该令牌额度已用尽',
              code: 'pre_consume_token_quota_failed',
              metadata: {
                quota_error: true,
                recharge_url: 'https://api.jingxing.uk/console/topup',
                token_url: 'https://api.jingxing.uk/console/token',
              },
            },
          }),
          { status: 403 }
        ) as any
      )

      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      await expect(svc.fetchModelsFromProvider(baseProvider))
        .rejects.toBeInstanceOf(ProviderQuotaError)
      expect(fetchTauri).toHaveBeenCalledTimes(1)
      errSpy.mockRestore()
    })

    it('throws structured error on 404', async () => {
      vi.mocked(fetchTauri).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      } as any)

      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      await expect(svc.fetchModelsFromProvider(baseProvider))
        .rejects.toThrow('Models endpoint not found')
      errSpy.mockRestore()
    })

    it('throws generic error on other status codes', async () => {
      vi.mocked(fetchTauri).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Server Error',
      } as any)

      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      await expect(svc.fetchModelsFromProvider(baseProvider))
        .rejects.toThrow('Failed to fetch models from')
      errSpy.mockRestore()
    })

    it('throws connection error on fetch failure', async () => {
      vi.mocked(fetchTauri).mockRejectedValueOnce(new Error('fetch failed'))

      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      await expect(svc.fetchModelsFromProvider(baseProvider))
        .rejects.toThrow('Cannot connect to')
      errSpy.mockRestore()
    })

    it('throws certificate error on TLS verification failure', async () => {
      vi.mocked(fetchTauri).mockRejectedValueOnce(
        new Error('invalid peer certificate: UnknownIssuer')
      )

      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      await expect(svc.fetchModelsFromProvider(baseProvider))
        .rejects.toThrow('TLS certificate verification failed')
      errSpy.mockRestore()
    })

    it('throws generic fallback for non-fetch errors', async () => {
      vi.mocked(fetchTauri).mockRejectedValueOnce(new Error('something else'))

      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      await expect(svc.fetchModelsFromProvider(baseProvider))
        .rejects.toThrow('Unexpected error')
      errSpy.mockRestore()
    })

    it('adds Origin header for localhost URLs', async () => {
      const localProvider = { ...baseProvider, base_url: 'http://localhost:1234' }
      vi.mocked(fetchTauri).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ data: [] }),
      } as any)

      await svc.fetchModelsFromProvider(localProvider)
      expect(fetchTauri).toHaveBeenCalledWith(
        'http://localhost:1234/models',
        expect.objectContaining({
          headers: expect.objectContaining({ Origin: 'tauri://localhost' }),
        })
      )
    })

    it('adds auth headers when api key is available', async () => {
      vi.mocked(providerRemoteApiKeyChain).mockReturnValue(['sk-test'])
      vi.mocked(fetchTauri).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ data: [] }),
      } as any)

      await svc.fetchModelsFromProvider(baseProvider)
      expect(fetchTauri).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-api-key': 'sk-test',
            Authorization: 'Bearer sk-test',
          }),
        })
      )
    })

    it('retries with next key on 401 and succeeds', async () => {
      vi.mocked(providerRemoteApiKeyChain).mockReturnValue(['bad-key', 'good-key'])
      vi.mocked(fetchTauri)
        .mockResolvedValueOnce({ ok: false, status: 401, statusText: 'Unauth' } as any)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({ data: [{ id: 'x' }] }),
        } as any)

      const result = await svc.fetchModelsFromProvider(baseProvider)
      expect(result).toEqual(['x'])
      expect(fetchTauri).toHaveBeenCalledTimes(2)
    })

    it('applies custom headers from provider', async () => {
      const customProvider = {
        ...baseProvider,
        custom_header: [{ header: 'X-Custom', value: 'val' }],
      }
      vi.mocked(fetchTauri).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ data: [] }),
      } as any)

      await svc.fetchModelsFromProvider(customProvider)
      expect(fetchTauri).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({ 'X-Custom': 'val' }),
        })
      )
    })
  })

  describe('fetchProviderBalance', () => {
    const biyuanProvider = {
      provider: 'jingxing',
      base_url: 'https://api.biyuan.ai/v1',
      active: true,
    } as any

    it('recognizes a compatible provider on the legacy jingxing.io root host', async () => {
      vi.mocked(providerRemoteApiKeyChain).mockReturnValue([])

      const result = await svc.fetchProviderBalance({
        provider: 'openai-compatible',
        base_url: 'https://jingxing.io/v1',
        active: true,
      } as any)

      expect(result).toMatchObject({
        state: 'needs_extra_auth',
        provider: 'openai-compatible',
        reason: 'Enter a Biyuan API key to query account balance.',
      })
    })

    it('uses Biyuan account.total_available as the real account balance', async () => {
      vi.mocked(providerRemoteApiKeyChain).mockReturnValue(['sk-test'])
      vi.mocked(fetchTauri)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            object: 'credit_summary',
            provider: 'biyuan',
            unit: 'quota',
            total_granted: 0,
            total_used: 0,
            total_available: 0,
            unlimited_quota: true,
            token_status: 1,
            fetched_at: 1781260326,
            account: {
              total_granted: 106955572,
              total_used: 68391621,
              total_available: 38563951,
            },
            links: {
              topup: 'https://api.biyuan.ai/console/topup',
            },
          }),
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            success: true,
            message: '',
            data: {
              quota_per_unit: 500000,
              quota_display_type: 'USD',
              usd_exchange_rate: 7,
            },
          }),
        } as any)

      const result = await svc.fetchProviderBalance(biyuanProvider)

      expect(fetchTauri).toHaveBeenNthCalledWith(
        1,
        'https://api.biyuan.ai/v1/balance',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer sk-test',
          }),
        })
      )
      expect(fetchTauri).toHaveBeenNthCalledWith(
        2,
        'https://biyuan.ai/api/status',
        expect.objectContaining({
          method: 'GET',
        })
      )
      const statusHeaders = (
        vi.mocked(fetchTauri).mock.calls[1]?.[1] as any
      ).headers
      expect(statusHeaders).toMatchObject({
        'Content-Type': 'application/json',
      })
      expect(statusHeaders).not.toHaveProperty('Authorization')
      expect(statusHeaders).not.toHaveProperty('x-api-key')
      expect(result).toMatchObject({
        state: 'supported',
        provider: 'jingxing',
        unit: 'quota',
        accountBalance: {
          available: 38563951,
          used: 68391621,
          total: 106955572,
        },
        moneyBalance: {
          available: 77.127902,
          used: 136.783242,
          total: 213.911144,
          currency: 'USD',
        },
        tokenLimit: {
          unlimited: true,
          status: 1,
        },
      })
      if (result.state === 'supported') {
        expect(result).not.toHaveProperty('converted')
        expect(result.tokenLimit).not.toHaveProperty('available')
        expect(result.links?.topup).toBe('https://api.biyuan.ai/console/topup')
      }
    })

    it('derives the Biyuan balance endpoint from custom base_url', async () => {
      vi.mocked(providerRemoteApiKeyChain).mockReturnValue(['sk-test'])
      vi.mocked(fetchTauri)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            unit: 'quota',
            unlimited_quota: true,
            token_status: 1,
            fetched_at: 1781260326,
            account: {
              total_available: 500000,
            },
          }),
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            success: true,
            message: '',
            data: {
              quota_per_unit: 500000,
              quota_display_type: 'USD',
            },
          }),
        } as any)

      const result = await svc.fetchProviderBalance({
        ...biyuanProvider,
        base_url: 'https://proxy.example.com/openai/v1',
      })

      expect(fetchTauri).toHaveBeenNthCalledWith(
        1,
        'https://proxy.example.com/openai/v1/balance',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer sk-test',
          }),
        })
      )
      expect(fetchTauri).toHaveBeenNthCalledWith(
        2,
        'https://proxy.example.com/openai/api/status',
        expect.any(Object)
      )
      expect(result).toMatchObject({
        state: 'supported',
        accountBalance: {
          available: 500000,
        },
        moneyBalance: {
          available: 1,
          currency: 'USD',
        },
      })
    })

    it('falls back to the default Biyuan balance endpoint when base_url is empty', async () => {
      vi.mocked(providerRemoteApiKeyChain).mockReturnValue(['sk-test'])
      vi.mocked(fetchTauri)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            unit: 'quota',
            fetched_at: 1781260326,
            account: {
              total_available: 500000,
            },
          }),
        } as any)
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: 'Not Found',
        } as any)

      await svc.fetchProviderBalance({
        ...biyuanProvider,
        base_url: '',
      })

      expect(fetchTauri).toHaveBeenNthCalledWith(
        1,
        'https://api.biyuan.ai/v1/balance',
        expect.any(Object)
      )
    })

    it('appends /v1/balance for Biyuan custom base_url values without /v1', async () => {
      vi.mocked(providerRemoteApiKeyChain).mockReturnValue(['sk-test'])
      vi.mocked(fetchTauri)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            unit: 'quota',
            fetched_at: 1781260326,
            account: {
              total_available: 500000,
            },
          }),
        } as any)
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: 'Not Found',
        } as any)

      await svc.fetchProviderBalance({
        ...biyuanProvider,
        base_url: 'https://proxy.example.com/openai',
      })

      expect(fetchTauri).toHaveBeenNthCalledWith(
        1,
        'https://proxy.example.com/openai/v1/balance',
        expect.any(Object)
      )
    })

    it('retries Biyuan server errors before returning balance', async () => {
      vi.useFakeTimers()
      try {
        vi.mocked(providerRemoteApiKeyChain).mockReturnValue(['sk-test'])
        vi.mocked(fetchTauri)
          .mockResolvedValueOnce({
            ok: false,
            status: 502,
            statusText: 'Bad Gateway',
          } as any)
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: vi.fn().mockResolvedValue({
              unit: 'quota',
              unlimited_quota: true,
              token_status: 1,
              fetched_at: 1781260326,
              account: {
                total_granted: 500000,
                total_used: 0,
                total_available: 500000,
              },
            }),
          } as any)
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: vi.fn().mockResolvedValue({
              success: true,
              message: '',
              data: {
                quota_per_unit: 500000,
                quota_display_type: 'USD',
              },
            }),
          } as any)

        const resultPromise = svc.fetchProviderBalance(biyuanProvider)
        await vi.advanceTimersByTimeAsync(300)
        const result = await resultPromise

        expect(fetchTauri).toHaveBeenCalledTimes(3)
        expect(result).toMatchObject({
          state: 'supported',
          moneyBalance: {
            available: 1,
            currency: 'USD',
          },
        })
      } finally {
        vi.useRealTimers()
      }
    })

    it('returns a retryable error after exhausting Biyuan server error retries', async () => {
      vi.useFakeTimers()
      try {
        vi.mocked(providerRemoteApiKeyChain).mockReturnValue(['sk-test'])
        vi.mocked(fetchTauri)
          .mockResolvedValueOnce({
            ok: false,
            status: 502,
            statusText: 'Bad Gateway',
          } as any)
          .mockResolvedValueOnce({
            ok: false,
            status: 503,
            statusText: 'Service Unavailable',
          } as any)
          .mockResolvedValueOnce({
            ok: false,
            status: 500,
            statusText: 'Internal Server Error',
          } as any)

        const resultPromise = svc.fetchProviderBalance(biyuanProvider)
        await vi.advanceTimersByTimeAsync(300)
        await vi.advanceTimersByTimeAsync(600)
        const result = await resultPromise

        expect(fetchTauri).toHaveBeenCalledTimes(3)
        expect(result).toMatchObject({
          state: 'error',
          provider: 'jingxing',
          status: 500,
          retryable: true,
        })
        if (result.state === 'error') {
          expect(result.message).toContain(
            'Balance lookup failed after retrying server errors'
          )
        }
      } finally {
        vi.useRealTimers()
      }
    })

    it.each([
      [
        401,
        'Unauthorized',
        'API key is missing or invalid. Please re-enter the key.',
        undefined,
      ],
      [
        403,
        'Forbidden',
        'The account is forbidden. Please contact the provider.',
        undefined,
      ],
      [429, 'Too Many Requests', 'Balance lookup is rate limited.', true],
    ])(
      'maps Biyuan balance endpoint HTTP %s errors',
      async (status, statusText, message, retryable) => {
        vi.mocked(providerRemoteApiKeyChain).mockReturnValue(['sk-test'])
        vi.mocked(fetchTauri).mockResolvedValueOnce({
          ok: false,
          status,
          statusText,
        } as any)

        const result = await svc.fetchProviderBalance(biyuanProvider)

        expect(result).toMatchObject({
          state: 'error',
          provider: 'jingxing',
          status,
          message,
          ...(retryable === undefined ? {} : { retryable }),
        })
        if (retryable === undefined) {
          expect(result).not.toHaveProperty('retryable')
        }
      }
    )

    it('does not promote Biyuan token limit fields to account balance when account is missing', async () => {
      vi.mocked(providerRemoteApiKeyChain).mockReturnValue(['sk-test'])
      vi.mocked(fetchTauri).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          unit: 'quota',
          total_granted: 1905390,
          total_used: 17293693,
          total_available: -15388303,
          unlimited_quota: true,
          token_status: 1,
          fetched_at: 1781258144,
        }),
      } as any)

      const result = await svc.fetchProviderBalance(biyuanProvider)

      expect(result).toMatchObject({
        state: 'supported',
        tokenLimit: {
          unlimited: true,
          status: 1,
        },
      })
      if (result.state === 'supported') {
        expect(result.accountBalance).toBeUndefined()
        expect(result.tokenLimit).not.toHaveProperty('available')
        expect(result.tokenLimit).not.toHaveProperty('used')
        expect(result.tokenLimit).not.toHaveProperty('total')
        expect(result).not.toHaveProperty('converted')
      }
    })

    it('uses /v1/balance exactly once for api.biyuan.ai root base_url and converts CNY from status', async () => {
      vi.mocked(providerRemoteApiKeyChain).mockReturnValue(['sk-test'])
      vi.mocked(fetchTauri)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            unit: 'quota',
            token_status: 1,
            fetched_at: 1781260326,
            account: {
              total_available: 250000,
            },
          }),
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            success: true,
            message: '',
            data: {
              quota_per_unit: 500000,
              quota_display_type: 'CNY',
              usd_exchange_rate: 7,
            },
          }),
        } as any)

      const result = await svc.fetchProviderBalance({
        ...biyuanProvider,
        base_url: 'https://api.biyuan.ai',
      })

      expect(fetchTauri).toHaveBeenNthCalledWith(
        1,
        'https://api.biyuan.ai/v1/balance',
        expect.any(Object)
      )
      expect(fetchTauri).toHaveBeenNthCalledWith(
        2,
        'https://biyuan.ai/api/status',
        expect.any(Object)
      )
      expect(fetchTauri).not.toHaveBeenCalledWith(
        'https://api.biyuan.ai/v1/v1/balance',
        expect.any(Object)
      )
      expect(result).toMatchObject({
        state: 'supported',
        moneyBalance: {
          available: 3.5,
          currency: 'CNY',
        },
      })
    })

    it('falls back to raw quota when Biyuan status settings are invalid', async () => {
      vi.mocked(providerRemoteApiKeyChain).mockReturnValue(['sk-test'])
      vi.mocked(fetchTauri)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            unit: 'quota',
            fetched_at: 1781260326,
            account: {
              total_available: 250000,
            },
          }),
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            success: true,
            message: '',
            data: {
              quota_per_unit: 0,
              quota_display_type: 'USD',
            },
          }),
        } as any)

      const result = await svc.fetchProviderBalance(biyuanProvider)

      expect(result).toMatchObject({
        state: 'supported',
        accountBalance: {
          available: 250000,
        },
      })
      if (result.state === 'supported') {
        expect(result.moneyBalance).toBeUndefined()
      }
    })

    it('falls back to raw quota when the Biyuan API status host returns the API-only stub', async () => {
      vi.mocked(providerRemoteApiKeyChain).mockReturnValue(['sk-test'])
      vi.mocked(fetchTauri)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            unit: 'quota',
            fetched_at: 1781260326,
            account: {
              total_available: 250000,
            },
          }),
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            service: 'Biyuan AI API',
            message: 'This endpoint is for API access only.',
          }),
        } as any)

      const result = await svc.fetchProviderBalance(biyuanProvider)

      expect(result).toMatchObject({
        state: 'supported',
        accountBalance: {
          available: 250000,
        },
      })
      if (result.state === 'supported') {
        expect(result.moneyBalance).toBeUndefined()
      }
    })

    it('falls back to raw quota when Biyuan status returns HTTP 200 with non-JSON content', async () => {
      vi.mocked(providerRemoteApiKeyChain).mockReturnValue(['sk-test'])
      vi.mocked(fetchTauri)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            unit: 'quota',
            fetched_at: 1781260326,
            account: {
              total_available: 250000,
            },
          }),
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: vi.fn().mockRejectedValue(new Error('not json')),
        } as any)

      const result = await svc.fetchProviderBalance(biyuanProvider)

      expect(result).toMatchObject({
        state: 'supported',
        accountBalance: {
          available: 250000,
        },
      })
      if (result.state === 'supported') {
        expect(result.moneyBalance).toBeUndefined()
      }
    })

    it('parses active Biyuan subscriptions, rolling windows, reset times, features, and token_status', async () => {
      vi.mocked(providerRemoteApiKeyChain).mockReturnValue(['sk-test'])
      vi.mocked(fetchTauri)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            unit: 'quota',
            total_granted: 100000,
            total_used: 25000,
            total_available: 75000,
            unlimited_quota: false,
            token_status: 4,
            fetched_at: 1781260326,
            account: {
              total_available: 100000,
            },
            subscription: {
              active: true,
              billing_preference: 'subscription_first',
              subscriptions: [
                null,
                {
                  usage: {
                    weekly_window: {
                      limit: 1,
                      available: 1,
                    },
                  },
                },
                {
                  plan: {
                    title: 'Biyuan Pro',
                    plan_code: 'biyuan_pro',
                  },
                  subscription: {
                    start_time: 1783209600,
                    end_time: 1785801600,
                    status: 'active',
                  },
                  usage: {
                    amount_total: 1000000,
                    amount_used: 100000,
                    amount_available: 900000,
                    weekly_window: {
                      limit: 700000,
                      used: 140000,
                      available: 560000,
                      reset_at: 1783814400,
                    },
                    five_hour_window: {
                      limit: 100000,
                      used: 75000,
                      available: 25000,
                      reset_at: 1783227600,
                    },
                    entitlements: {
                      features: ['text', 'image', 'audio_transcription'],
                    },
                  },
                },
                {
                  plan: {
                    title: 'Biyuan Team',
                    plan_code: 'biyuan_team',
                  },
                  subscription: {
                    status: 'active',
                  },
                  usage: {
                    weekly_window: {
                      limit: 100,
                      available: 50,
                    },
                    five_hour_window: {
                      limit: 100,
                      available: 10,
                    },
                    entitlements: {
                      features: ['all'],
                    },
                  },
                },
              ],
            },
          }),
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            success: true,
            message: '',
            data: {
              quota_per_unit: 500000,
              quota_display_type: 'USD',
            },
          }),
        } as any)

      const result = await svc.fetchProviderBalance(biyuanProvider)

      expect(result).toMatchObject({
        state: 'supported',
        tokenLimit: {
          available: 75000,
          used: 25000,
          total: 100000,
          unlimited: false,
          status: 4,
        },
        subscription: {
          active: true,
          billingPreference: 'subscription_first',
        },
      })
      if (result.state === 'supported') {
        expect(result.subscription?.subscriptions).toHaveLength(2)
        expect(result.subscription?.subscriptions[0]).toMatchObject({
          title: 'Biyuan Pro',
          planCode: 'biyuan_pro',
          startTime: 1783209600,
          endTime: 1785801600,
          status: 'active',
          weeklyWindow: {
            limit: 700000,
            used: 140000,
            available: 560000,
            resetAt: 1783814400,
            availablePercent: 0.8,
          },
          fiveHourWindow: {
            limit: 100000,
            used: 75000,
            available: 25000,
            resetAt: 1783227600,
            availablePercent: 0.25,
          },
          features: ['text', 'image', 'audio_transcription'],
        })
        expect(result.subscription?.subscriptions[1]?.features).toEqual(['all'])
      }
    })

    it('preserves mixed subscription statuses but skips malformed subscription entries', async () => {
      vi.mocked(providerRemoteApiKeyChain).mockReturnValue(['sk-test'])
      vi.mocked(fetchTauri)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            unit: 'quota',
            fetched_at: 1781260326,
            account: {
              total_available: 100000,
            },
            subscription: {
              active: true,
              billing_preference: 'subscription_first',
              subscriptions: [
                null,
                {
                  plan: {
                    title: 'Expired Pro',
                    plan_code: 'expired_pro',
                  },
                  subscription: {
                    status: 'expired',
                  },
                  usage: {
                    weekly_window: {
                      limit: 100,
                      available: 0,
                    },
                    five_hour_window: {
                      limit: 100,
                      available: 0,
                    },
                  },
                },
                {
                  plan: {
                    title: 'Active Pro',
                    plan_code: 'active_pro',
                  },
                  subscription: {
                    status: 'active',
                  },
                  usage: {
                    weekly_window: {
                      limit: 100,
                      available: 80,
                    },
                    five_hour_window: {
                      limit: 100,
                      available: 50,
                    },
                  },
                },
                {
                  usage: {
                    weekly_window: {
                      limit: 100,
                      available: 100,
                    },
                  },
                },
              ],
            },
          }),
        } as any)
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: 'Not Found',
        } as any)

      const result = await svc.fetchProviderBalance(biyuanProvider)

      expect(result).toMatchObject({
        state: 'supported',
        subscription: {
          active: true,
          billingPreference: 'subscription_first',
        },
      })
      if (result.state === 'supported') {
        expect(result.subscription?.subscriptions).toHaveLength(2)
        expect(result.subscription?.subscriptions.map((plan) => plan.title)).toEqual([
          'Expired Pro',
          'Active Pro',
        ])
      }
    })

    it('uses provider error body messages for non-auth Biyuan failures', async () => {
      vi.mocked(providerRemoteApiKeyChain).mockReturnValue(['sk-test'])
      vi.mocked(fetchTauri).mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: vi.fn().mockResolvedValue({
          error: {
            message: 'custom balance error',
            type: 'invalid_request_error',
          },
        }),
      } as any)

      const result = await svc.fetchProviderBalance(biyuanProvider)

      expect(result).toMatchObject({
        state: 'error',
        provider: 'jingxing',
        status: 400,
        message: 'custom balance error',
      })
    })

    it.each([404, 405])(
      'falls back to legacy Biyuan token usage only when /v1/balance returns %s',
      async (status) => {
        vi.mocked(providerRemoteApiKeyChain).mockReturnValue(['sk-test'])
        vi.mocked(fetchTauri)
          .mockResolvedValueOnce({
            ok: false,
            status,
            statusText: status === 404 ? 'Not Found' : 'Method Not Allowed',
          } as any)
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: vi.fn().mockResolvedValue({
              success: true,
              data: {
                total_granted: 1000,
                total_used: '321.5',
                total_available: '678.5',
                unlimited_quota: false,
              },
            }),
          } as any)

        const result = await svc.fetchProviderBalance({
          ...biyuanProvider,
          base_url: 'https://api.jingxing.uk/v1',
        })

        expect(fetchTauri).toHaveBeenNthCalledWith(
          1,
          'https://api.jingxing.uk/v1/balance',
          expect.any(Object)
        )
        expect(fetchTauri).toHaveBeenNthCalledWith(
          2,
          'https://api.jingxing.uk/api/usage/token/',
          expect.any(Object)
        )
        expect(result).toMatchObject({
          state: 'supported',
          provider: 'jingxing',
          tokenLimit: {
            available: 678.5,
            used: 321.5,
            total: 1000,
            unlimited: false,
          },
          subscription: {
            active: false,
            subscriptions: [],
            unavailable: true,
          },
        })
      }
    )

    it('returns an error when legacy Biyuan token usage fallback also fails', async () => {
      vi.mocked(providerRemoteApiKeyChain).mockReturnValue(['sk-test'])
      vi.mocked(fetchTauri)
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: 'Not Found',
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            success: false,
            message: 'legacy disabled',
          }),
        } as any)

      const result = await svc.fetchProviderBalance(biyuanProvider)

      expect(result).toMatchObject({
        state: 'error',
        provider: 'jingxing',
        message: 'legacy disabled',
      })
    })

    it('preserves custom proxy path prefixes for legacy Biyuan fallback', async () => {
      vi.mocked(providerRemoteApiKeyChain).mockReturnValue(['sk-test'])
      vi.mocked(fetchTauri)
        .mockResolvedValueOnce({
          ok: false,
          status: 405,
          statusText: 'Method Not Allowed',
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            success: true,
            data: {
              total_available: 500000,
            },
          }),
        } as any)

      await svc.fetchProviderBalance({
        ...biyuanProvider,
        base_url: 'https://proxy.example.com/openai/v1',
      })

      expect(fetchTauri).toHaveBeenNthCalledWith(
        2,
        'https://proxy.example.com/openai/api/usage/token/',
        expect.any(Object)
      )
    })

    it('returns OpenRouter credit balance from credits endpoint', async () => {
      vi.mocked(providerRemoteApiKeyChain).mockReturnValue(['or-key'])
      vi.mocked(fetchTauri).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          data: {
            total_credits: 50,
            total_usage: 12.5,
          },
        }),
      } as any)

      const result = await svc.fetchProviderBalance({
        provider: 'openrouter',
        base_url: 'https://openrouter.ai/api/v1',
        active: true,
      } as any)

      expect(fetchTauri).toHaveBeenCalledWith(
        'https://openrouter.ai/api/v1/credits',
        expect.any(Object)
      )
      expect(result).toMatchObject({
        state: 'supported',
        provider: 'openrouter',
        unit: 'usd',
        accountBalance: {
          available: 37.5,
          used: 12.5,
          total: 50,
        },
      })
    })

    it('does not expose negative OpenRouter credit balance as available balance', async () => {
      vi.mocked(providerRemoteApiKeyChain).mockReturnValue(['or-key'])
      vi.mocked(fetchTauri).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          data: {
            total_credits: 10,
            total_usage: 13.2,
          },
        }),
      } as any)

      const result = await svc.fetchProviderBalance({
        provider: 'openrouter',
        base_url: 'https://openrouter.ai/api/v1',
        active: true,
      } as any)

      expect(result).toMatchObject({
        state: 'supported',
        provider: 'openrouter',
        accountBalance: {
          available: 0,
          used: 13.2,
          total: 10,
        },
        notice: {
          code: 'openrouter_overdrawn',
          tone: 'warning',
          amount: 3.2,
          currency: 'USD',
        },
      })
    })

    it('returns DeepSeek CNY balance from user balance endpoint', async () => {
      vi.mocked(providerRemoteApiKeyChain).mockReturnValue(['deepseek-key'])
      vi.mocked(fetchTauri).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          is_available: true,
          balance_infos: [
            {
              currency: 'CNY',
              total_balance: '88.25',
              topped_up_balance: '80.00',
              granted_balance: '8.25',
            },
          ],
        }),
      } as any)

      const result = await svc.fetchProviderBalance({
        provider: 'deepseek',
        base_url: 'https://api.deepseek.com/v1',
        active: true,
      } as any)

      expect(fetchTauri).toHaveBeenCalledWith(
        'https://api.deepseek.com/user/balance',
        expect.any(Object)
      )
      expect(result).toMatchObject({
        state: 'supported',
        provider: 'deepseek',
        unit: 'currency',
        currency: 'CNY',
        accountBalance: {
          available: 88.25,
          total: 88.25,
        },
      })
    })

    it('marks DeepSeek balance as unavailable when the account is disabled', async () => {
      vi.mocked(providerRemoteApiKeyChain).mockReturnValue(['deepseek-key'])
      vi.mocked(fetchTauri).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          is_available: false,
          balance_infos: [
            {
              currency: 'CNY',
              total_balance: '88.25',
            },
          ],
        }),
      } as any)

      const result = await svc.fetchProviderBalance({
        provider: 'deepseek',
        base_url: 'https://api.deepseek.com/v1',
        active: true,
      } as any)

      expect(result).toMatchObject({
        state: 'supported',
        provider: 'deepseek',
        accountBalance: {
          available: 88.25,
          total: 88.25,
        },
        notice: {
          code: 'deepseek_unavailable',
          tone: 'warning',
          hideBadge: true,
        },
      })
    })

    it('does not call xAI management API until management key and team id are configured', async () => {
      const result = await svc.fetchProviderBalance({
        provider: 'xai',
        base_url: 'https://api.x.ai/v1',
        active: true,
        settings: [],
      } as any)

      expect(fetchTauri).not.toHaveBeenCalled()
      expect(result).toMatchObject({
        state: 'needs_extra_auth',
        provider: 'xai',
        required: ['management key', 'team id'],
      })
    })

    it('returns unsupported status for providers without automatic balance APIs', async () => {
      const result = await svc.fetchProviderBalance({
        provider: 'mistral',
        base_url: 'https://api.mistral.ai/v1',
        active: true,
      } as any)

      expect(fetchTauri).not.toHaveBeenCalled()
      expect(result).toMatchObject({
        state: 'unsupported',
        provider: 'mistral',
      })
    })
  })

  describe('updateSettings', () => {
    it('delegates to engine updateSettings', async () => {
      const mockUpdate = vi.fn()
      vi.mocked(ExtensionManager.getInstance).mockReturnValue({
        getEngine: vi.fn().mockReturnValue({ updateSettings: mockUpdate }),
      } as any)

      await svc.updateSettings('test', [
        { key: 'k', controller_type: 'input', controller_props: { value: 'v' } } as any,
      ])

      expect(mockUpdate).toHaveBeenCalledWith([
        expect.objectContaining({
          key: 'k',
          controllerType: 'input',
          controllerProps: { value: 'v' },
        }),
      ])
    })

    it('defaults value to empty string when undefined', async () => {
      const mockUpdate = vi.fn()
      vi.mocked(ExtensionManager.getInstance).mockReturnValue({
        getEngine: vi.fn().mockReturnValue({ updateSettings: mockUpdate }),
      } as any)

      await svc.updateSettings('test', [
        { key: 'k', controller_type: 'input', controller_props: {} } as any,
      ])

      expect(mockUpdate).toHaveBeenCalledWith([
        expect.objectContaining({
          controllerProps: { value: '' },
        }),
      ])
    })

    it('rethrows on error', async () => {
      vi.mocked(ExtensionManager.getInstance).mockReturnValue({
        getEngine: vi.fn().mockReturnValue({
          updateSettings: vi.fn().mockRejectedValue(new Error('fail')),
        }),
      } as any)

      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      await expect(svc.updateSettings('test', [])).rejects.toThrow('fail')
      errSpy.mockRestore()
    })
  })
})
