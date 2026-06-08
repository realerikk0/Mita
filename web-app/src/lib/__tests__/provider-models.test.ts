import { describe, expect, it } from 'vitest'

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
})
