import { describe, expect, it } from 'vitest'

import {
  configuredChatModels,
  isConfiguredModelProvider,
} from '@/lib/configured-model-providers'

const provider = (
  data: Partial<ModelProvider> & Pick<ModelProvider, 'provider'>
): ModelProvider => ({
  active: true,
  provider: data.provider,
  base_url: 'https://provider.example.com/v1',
  settings: [],
  models: [{ id: 'gpt-5' }],
  ...data,
})

describe('configured model providers', () => {
  it('requires active predefined remote providers to have an API key', () => {
    expect(isConfiguredModelProvider(provider({ provider: 'openai' }))).toBe(
      false
    )
    expect(
      isConfiguredModelProvider(
        provider({ provider: 'openai', api_key: 'sk-test' })
      )
    ).toBe(true)
  })

  it('rejects retired local providers and keeps remote custom providers', () => {
    expect(
      isConfiguredModelProvider(provider({ provider: 'llamacpp' }))
    ).toBe(false)
    expect(isConfiguredModelProvider(provider({ provider: 'custom' }))).toBe(
      true
    )
  })

  it('filters inactive, embedding, and image-only models', () => {
    expect(
      configuredChatModels(
        provider({
          provider: 'openai',
          api_key: 'sk-test',
          models: [
            { id: 'gpt-5' },
            { id: 'text-embedding-3-large', embedding: true },
            { id: 'gpt-image-1' },
          ],
        })
      ).map((model) => model.id)
    ).toEqual(['gpt-5'])

    expect(
      configuredChatModels(
        provider({ provider: 'openai', api_key: 'sk-test', active: false })
      )
    ).toEqual([])
  })
})
