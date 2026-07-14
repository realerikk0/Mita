import { describe, expect, it } from 'vitest'
import {
  getVisibleModelProviders,
  isVisibleModelProvider,
  VISIBLE_MODEL_PROVIDER_ORDER,
} from '../visible-model-providers'

describe('visible model providers', () => {
  it('keeps only the supported providers in the requested order', () => {
    const providers = [
      { provider: 'gemini' },
      { provider: 'mistral' },
      { provider: 'deepseek' },
      { provider: 'jingxing' },
      { provider: 'anthropic' },
      { provider: 'xai' },
      { provider: 'openrouter' },
      { provider: 'azure' },
      { provider: 'openai' },
      { provider: 'llamacpp' },
    ]

    expect(
      getVisibleModelProviders(providers).map((provider) => provider.provider)
    ).toEqual(VISIBLE_MODEL_PROVIDER_ORDER)
  })

  it('matches provider names case-insensitively', () => {
    expect(isVisibleModelProvider('OpenAI')).toBe(true)
    expect(isVisibleModelProvider('mistral')).toBe(false)
  })

  it('does not mutate the source provider list', () => {
    const providers = [{ provider: 'gemini' }, { provider: 'openai' }]

    getVisibleModelProviders(providers)

    expect(providers.map((provider) => provider.provider)).toEqual([
      'gemini',
      'openai',
    ])
  })
})
