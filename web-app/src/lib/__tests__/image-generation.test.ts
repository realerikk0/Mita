import { describe, expect, it } from 'vitest'

import {
  apiQualityForPreset,
  getImageModels,
  imageSizeForRatio,
  isImageGenerationModel,
} from '@/lib/image-generation'
import { ModelCapabilities } from '@/types/models'

describe('image generation helpers', () => {
  it('filters image generation models by capability', () => {
    expect(
      isImageGenerationModel({
        capabilities: [ModelCapabilities.IMAGE_GENERATION],
      } as Model)
    ).toBe(true)
    expect(
      isImageGenerationModel({
        capabilities: [ModelCapabilities.COMPLETION],
      } as Model)
    ).toBe(false)
  })

  it('returns provider/model pairs for image-capable models', () => {
    const providers = [
      {
        provider: 'jingxing',
        models: [
          {
            id: 'gemini-2.5-flash-image',
            capabilities: [ModelCapabilities.IMAGE_GENERATION],
          },
          { id: 'gpt-image-1.5', capabilities: [ModelCapabilities.IMAGE_GENERATION] },
          { id: 'gpt-image-2', capabilities: [ModelCapabilities.IMAGE_GENERATION] },
          { id: 'gpt-5.4', capabilities: [ModelCapabilities.COMPLETION] },
        ],
      },
    ] as ModelProvider[]

    expect(getImageModels(providers)).toHaveLength(3)
    expect(getImageModels(providers)[0].model.id).toBe('gpt-image-1.5')
    expect(getImageModels(providers).map(({ model }) => model.id)).toContain(
      'gemini-2.5-flash-image'
    )
  })

  it('maps ratios to exact sizes for gpt-image-2 and fallback sizes otherwise', () => {
    expect(imageSizeForRatio('9:16', 'gpt-image-2')).toBe('1024x1820')
    expect(imageSizeForRatio('9:16', 'gpt-image-1')).toBe('1024x1536')
    expect(imageSizeForRatio('16:9', 'custom-image-model')).toBe('1536x1024')
  })

  it('maps SD/HD to modern and legacy API quality values', () => {
    expect(apiQualityForPreset('sd', 'gpt-image-2')).toBe('medium')
    expect(apiQualityForPreset('hd', 'gpt-image-2')).toBe('high')
    expect(apiQualityForPreset('sd', 'dall-e-3')).toBe('standard')
    expect(apiQualityForPreset('hd', 'dall-e-3')).toBe('hd')
  })
})
