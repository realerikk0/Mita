import { describe, expect, it } from 'vitest'
import { isChatModelSelectable } from '../chat-models'

describe('isChatModelSelectable', () => {
  it('hides image generation models from chat selection', () => {
    expect(isChatModelSelectable('dall-e-3')).toBe(false)
    expect(isChatModelSelectable('flux-pro')).toBe(false)
    expect(isChatModelSelectable('gpt-image-1.5')).toBe(false)
    expect(isChatModelSelectable('gpt-image-2')).toBe(false)
    expect(isChatModelSelectable('gemini-2.5-flash-image')).toBe(false)
    expect(isChatModelSelectable('gemini-3-pro-image-preview')).toBe(false)
    expect(isChatModelSelectable('gemini-3.1-flash-image-preview')).toBe(false)
    expect(isChatModelSelectable('imagen-4.0-generate-preview-06-06')).toBe(false)
    expect(isChatModelSelectable('midjourney-v7')).toBe(false)
    expect(isChatModelSelectable('seedream-4.0')).toBe(false)
    expect(isChatModelSelectable('stable-diffusion-xl')).toBe(false)
  })

  it('hides video generation models from chat selection', () => {
    expect(isChatModelSelectable('gen4_turbo')).toBe(false)
    expect(isChatModelSelectable('kling-2.1')).toBe(false)
    expect(isChatModelSelectable('minimax-video-01')).toBe(false)
    expect(isChatModelSelectable('pika-2.2')).toBe(false)
    expect(isChatModelSelectable('sora-2-pro')).toBe(false)
    expect(isChatModelSelectable('veo-3.1-fast-generate-001')).toBe(false)
    expect(isChatModelSelectable('wan-2.2')).toBe(false)
  })

  it('hides transcription and speech recognition models from chat selection', () => {
    expect(isChatModelSelectable('bigmodel-asr')).toBe(false)
    expect(isChatModelSelectable('doubao-seed-asr-2.0')).toBe(false)
    expect(isChatModelSelectable('gpt-4o-transcribe')).toBe(false)
    expect(isChatModelSelectable('las_asr_pro')).toBe(false)
    expect(isChatModelSelectable('openspeech')).toBe(false)
    expect(isChatModelSelectable('speech-to-text-v1')).toBe(false)
    expect(isChatModelSelectable('whisper-1')).toBe(false)
  })

  it('keeps regular chat models selectable', () => {
    expect(isChatModelSelectable('doubao-pro-32k')).toBe(true)
    expect(isChatModelSelectable('gpt-4o')).toBe(true)
    expect(isChatModelSelectable('gpt-5.4-mini')).toBe(true)
    expect(isChatModelSelectable('gemini-3-flash-preview')).toBe(true)
    expect(isChatModelSelectable('claude-opus-4-7')).toBe(true)
  })
})
