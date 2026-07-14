import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { ProviderObject } from '@biyan/core'
import { ModelFactory } from '../model-factory'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}))

vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: vi.fn(() => ({
    languageModel: vi.fn(() => ({ type: 'openai-compatible' })),
  })),
  OpenAICompatibleChatLanguageModel: vi.fn(),
  MetadataExtractor: vi.fn(),
}))

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => vi.fn(() => ({ type: 'anthropic' }))),
}))

vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: vi.fn(() => vi.fn(() => ({ type: 'google' }))),
}))

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => vi.fn(() => ({ type: 'openai' }))),
}))

vi.mock('@ai-sdk/xai', () => ({
  createXai: vi.fn(() => vi.fn(() => ({ type: 'xai' }))),
}))

vi.mock('ai', () => ({
  wrapLanguageModel: vi.fn(({ model }) => model),
  extractReasoningMiddleware: vi.fn(() => ({})),
}))

const mockedCreateGoogleGenerativeAI = vi.mocked(createGoogleGenerativeAI)
const mockedCreateOpenAICompatible = vi.mocked(createOpenAICompatible)

describe('ModelFactory Gemini regression', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.clearAllMocks()
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('{}'))
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('routes Gemini OpenAI endpoint providers through the Google SDK path', async () => {
    const provider: ProviderObject = {
      provider: 'gemini',
      api_key: 'test-api-key',
      base_url: 'https://generativelanguage.googleapis.com/v1beta/openai',
      models: [],
      settings: [],
      active: true,
    }

    const model = await ModelFactory.createModel('gemini-2.5-flash', provider)

    expect(model).toEqual({ type: 'google' })
    expect(mockedCreateGoogleGenerativeAI).toHaveBeenCalledWith({
      apiKey: 'test-api-key',
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
      headers: undefined,
      fetch: expect.any(Function),
    })
    expect(mockedCreateOpenAICompatible).not.toHaveBeenCalled()
  })

  it('keeps non-Gemini providers on the OpenAI-compatible path', async () => {
    const provider: ProviderObject = {
      provider: 'groq',
      api_key: 'test-api-key',
      base_url: 'https://api.groq.com/openai/v1',
      models: [],
      settings: [],
      active: true,
    }

    const model = await ModelFactory.createModel('llama-3', provider)

    expect(model).toEqual({ type: 'openai-compatible' })
    expect(mockedCreateOpenAICompatible).toHaveBeenCalledTimes(1)
    expect(mockedCreateGoogleGenerativeAI).not.toHaveBeenCalled()
  })

  it('omits non-default sampling parameters for Claude Opus 4.8 on OpenAI-compatible providers', async () => {
    const provider: ProviderObject = {
      provider: 'jingxing',
      api_key: 'test-api-key',
      base_url: 'https://api.jingxing.io/v1',
      models: [],
      settings: [],
      active: true,
    }

    await ModelFactory.createModel('claude-opus-4-8', provider, {
      temperature: 0.7,
      top_p: 0.95,
      top_k: 2,
      frequency_penalty: 0.7,
      presence_penalty: 0.7,
      repeat_penalty: 1.1,
      max_output_tokens: 2048,
    })

    const config = mockedCreateOpenAICompatible.mock.calls.at(-1)?.[0] as
      | { fetch?: typeof fetch }
      | undefined
    expect(config?.fetch).toEqual(expect.any(Function))

    await config!.fetch!('https://api.jingxing.io/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model: 'claude-opus-4-8',
        messages: [],
      }),
    })

    const body = JSON.parse(
      vi.mocked(globalThis.fetch).mock.calls.at(-1)?.[1]?.body as string
    )
    expect(body).toMatchObject({
      model: 'claude-opus-4-8',
      messages: [],
      max_tokens: 2048,
    })
    expect(body).not.toHaveProperty('temperature')
    expect(body).not.toHaveProperty('top_p')
    expect(body).not.toHaveProperty('top_k')
    expect(body).not.toHaveProperty('frequency_penalty')
    expect(body).not.toHaveProperty('presence_penalty')
    expect(body).not.toHaveProperty('repeat_penalty')
  })
})
