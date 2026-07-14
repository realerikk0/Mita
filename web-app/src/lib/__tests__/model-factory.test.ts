import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  languageModel: vi.fn((id: string) => ({ id })),
  createOpenAICompatible: vi.fn(),
  wrapLanguageModel: vi.fn(({ model }) => model),
}))

vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: h.createOpenAICompatible,
}))
vi.mock('ai', () => ({
  extractReasoningMiddleware: vi.fn(() => ({})),
  wrapLanguageModel: h.wrapLanguageModel,
}))
vi.mock('@ai-sdk/openai', () => ({ createOpenAI: vi.fn() }))
vi.mock('@ai-sdk/anthropic', () => ({ createAnthropic: vi.fn() }))
vi.mock('@ai-sdk/google', () => ({ createGoogleGenerativeAI: vi.fn() }))
vi.mock('@ai-sdk/xai', () => ({ createXai: vi.fn() }))
vi.mock('@/lib/platform/utils', () => ({ isPlatformTauri: () => false }))

import { ModelFactory } from '../model-factory'

const provider = (name: string, baseUrl: string): ProviderObject =>
  ({
    provider: name,
    active: true,
    api_key: 'key',
    base_url: baseUrl,
    models: [],
    settings: [],
  }) as ProviderObject

describe('ModelFactory remote-only boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.createOpenAICompatible.mockReturnValue({ languageModel: h.languageModel })
  })

  it('creates a configured remote OpenAI-compatible model', async () => {
    await expect(
      ModelFactory.createModel(
        'remote-chat',
        provider('custom', 'https://api.example.com/v1')
      )
    ).resolves.toEqual({ id: 'remote-chat' })
    expect(h.createOpenAICompatible).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: 'https://api.example.com/v1' })
    )
  })

  it.each([
    ['llamacpp', 'https://api.example.com/v1'],
    ['mlx', 'https://api.example.com/v1'],
    ['custom', 'http://127.0.0.1:1337/v1'],
  ])('rejects retired or loopback provider %s', async (name, baseUrl) => {
    await expect(
      ModelFactory.createModel('local', provider(name, baseUrl))
    ).rejects.toMatchObject({ code: 'LOCAL_RUNTIME_REMOVED' })
    expect(h.createOpenAICompatible).not.toHaveBeenCalled()
  })
})
