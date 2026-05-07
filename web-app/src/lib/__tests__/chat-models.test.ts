import { describe, expect, it } from 'vitest'
import { isChatModelSelectable } from '../chat-models'

describe('isChatModelSelectable', () => {
  it('hides image generation models from chat selection', () => {
    expect(isChatModelSelectable('gpt-image-1.5')).toBe(false)
    expect(isChatModelSelectable('gpt-image-2')).toBe(false)
    expect(isChatModelSelectable('gemini-2.5-flash-image')).toBe(false)
    expect(isChatModelSelectable('gemini-3-pro-image-preview')).toBe(false)
    expect(isChatModelSelectable('gemini-3.1-flash-image-preview')).toBe(false)
  })

  it('keeps regular chat models selectable', () => {
    expect(isChatModelSelectable('gpt-5.4-mini')).toBe(true)
    expect(isChatModelSelectable('gemini-3-flash-preview')).toBe(true)
    expect(isChatModelSelectable('claude-opus-4-7')).toBe(true)
  })
})
