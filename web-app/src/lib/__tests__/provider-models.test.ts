import { describe, expect, it } from 'vitest'
import { ModelCapabilities } from '@/types/models'
import { getImageModels } from '@/lib/image-generation'

import {
  isModelChatSelectable,
  modelDescriptorToModel,
  modelRequiresResponsesEndpoint,
} from '../provider-models'

describe('provider model descriptors', () => {
  it('preserves supported endpoint metadata on fetched models', () => {
    const model = modelDescriptorToModel('jingxing', {
      id: 'gpt-5.4-pro',
      supported_endpoint_types: ['openai-response'],
    })

    expect(model).toMatchObject({
      id: 'gpt-5.4-pro',
      model: 'gpt-5.4-pro',
      supported_endpoint_types: ['openai-response'],
      supportedEndpointTypes: ['openai-response'],
    })
  })

  it('uses endpoint metadata and model names to hide non-chat models', () => {
    expect(
      isModelChatSelectable({
        id: 'gpt-5.4-pro',
        supported_endpoint_types: ['openai-response'],
      } as Model)
    ).toBe(true)
    expect(
      isModelChatSelectable({
        id: 'gpt-4o-transcribe',
        supported_endpoint_types: ['audio-transcription'],
      } as Model)
    ).toBe(false)
    expect(isModelChatSelectable({ id: 'whisper-1' } as Model)).toBe(false)
    expect(isModelChatSelectable({ id: 'gpt-image-2' } as Model)).toBe(false)
    expect(isModelChatSelectable({ id: 'seedance-1-pro' } as Model)).toBe(false)
    expect(isModelChatSelectable({ id: 'seedream-4.0' } as Model)).toBe(false)
    expect(isModelChatSelectable({ id: 'sora-2-pro' } as Model)).toBe(false)
    expect(isModelChatSelectable({ id: 'veo-3.1-generate-preview' } as Model)).toBe(false)
    expect(isModelChatSelectable({ id: 'doubao-seed-asr-2.0' } as Model)).toBe(false)
  })

  it('detects response-only chat models from metadata and Jingxing policy', () => {
    expect(
      modelRequiresResponsesEndpoint('gpt-5.4-pro', {
        id: 'gpt-5.4-pro',
      } as Model)
    ).toBe(true)
    expect(
      modelRequiresResponsesEndpoint('custom-response-only', {
        id: 'custom-response-only',
        supported_endpoint_types: ['openai-response'],
      } as Model)
    ).toBe(true)
    expect(
      modelRequiresResponsesEndpoint('gpt-5.4', {
        id: 'gpt-5.4',
        supported_endpoint_types: ['openai'],
      } as Model)
    ).toBe(false)
  })

  it('maps Biyuan image-generation endpoint metadata to image capabilities', () => {
    const model = modelDescriptorToModel('biyuan', {
      id: 'gpt-image-2',
      supported_endpoint_types: ['image-generation'],
    })

    expect(model?.capabilities).toEqual([
      ModelCapabilities.IMAGE_GENERATION,
      ModelCapabilities.TEXT_TO_IMAGE,
      ModelCapabilities.IMAGE_TO_IMAGE,
    ])

    expect(
      getImageModels([
        {
          provider: 'biyuan',
          base_url: 'https://api.biyuan.ai/v1',
          models: [model!],
        } as ModelProvider,
      ])
    ).toHaveLength(1)
  })

  it('keeps Jingxing image capability inference aligned with Biyuan', () => {
    const descriptor = {
      id: 'gpt-image-2',
      supported_endpoint_types: ['image-generation'],
    }

    expect(
      modelDescriptorToModel('jingxing', descriptor)?.capabilities
    ).toEqual(modelDescriptorToModel('biyuan', descriptor)?.capabilities)
  })

  it('uses endpoint metadata for unknown image and editing model names', () => {
    const model = modelDescriptorToModel('biyuan', {
      id: 'custom-media-model',
      supported_endpoint_types: ['image-generation', 'image-edit'],
    })

    expect(model?.capabilities).toEqual(
      expect.arrayContaining([
        ModelCapabilities.IMAGE_GENERATION,
        ModelCapabilities.TEXT_TO_IMAGE,
        ModelCapabilities.IMAGE_TO_IMAGE,
      ])
    )
  })

  it('recognizes a Biyuan-hosted compatible provider without misclassifying others', () => {
    const descriptor = {
      id: 'gpt-image-2',
    }

    expect(
      modelDescriptorToModel(
        'openai-compatible',
        descriptor,
        'https://api.biyuan.ai/v1'
      )?.capabilities
    ).toEqual([
      ModelCapabilities.IMAGE_GENERATION,
      ModelCapabilities.TEXT_TO_IMAGE,
      ModelCapabilities.IMAGE_TO_IMAGE,
    ])
    expect(
      modelDescriptorToModel(
        'openai-compatible',
        descriptor,
        'https://api.example.test/v1'
      )?.capabilities
    ).toEqual([ModelCapabilities.COMPLETION])
  })

  it('does not classify Biyuan chat models as image models', () => {
    for (const id of ['gpt-4o', 'gpt-5.4']) {
      const model = modelDescriptorToModel('biyuan', {
        id,
        supported_endpoint_types: ['openai'],
      })

      expect(model?.capabilities).not.toContain(
        ModelCapabilities.IMAGE_GENERATION
      )
      expect(model?.capabilities).not.toContain(ModelCapabilities.TEXT_TO_IMAGE)
      expect(model?.capabilities).not.toContain(
        ModelCapabilities.IMAGE_TO_IMAGE
      )
    }
  })

  it('preserves explicitly user-configured capabilities over endpoint metadata', () => {
    const model = modelDescriptorToModel('biyuan', {
      id: 'gpt-image-2',
      capabilities: [ModelCapabilities.COMPLETION],
      _userConfiguredCapabilities: true,
      supported_endpoint_types: ['image-generation'],
    })

    expect(model?.capabilities).toEqual([ModelCapabilities.COMPLETION])
  })
})
