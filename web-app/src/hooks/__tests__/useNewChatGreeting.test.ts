import { describe, expect, it } from 'vitest'
import {
  getNewChatGreetingText,
  getRandomGreetingIndex,
} from '../useNewChatGreeting'

describe('getRandomGreetingIndex', () => {
  it('returns an index inside the available range', () => {
    for (let value = 0; value < 1; value += 0.05) {
      const index = getRandomGreetingIndex(20, undefined, () => value)
      expect(index).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThan(20)
    }
  })

  it('does not repeat the previous index when there are multiple variants', () => {
    const previousIndex = 3

    for (const value of [0, 0.1, 0.5, 0.9, 0.999]) {
      expect(getRandomGreetingIndex(20, previousIndex, () => value)).not.toBe(
        previousIndex
      )
    }
  })

  it('allows returning zero when only one variant exists', () => {
    expect(getRandomGreetingIndex(1, 0, () => 0.9)).toBe(0)
  })
})

describe('getNewChatGreetingText', () => {
  it('returns the selected translated greeting variant', () => {
    expect(
      getNewChatGreetingText(
        {
          language: 'zh-CN',
          fallbackLng: 'en',
          resources: {
            'zh-CN': {
              chat: {
                descriptionVariants: ['第一句', '第二句'],
              },
            },
          },
        },
        '默认标题',
        1
      )
    ).toBe('第二句')
  })

  it('falls back to chat description when variants are missing', () => {
    expect(
      getNewChatGreetingText(
        {
          language: 'en',
          fallbackLng: 'en',
          resources: {
            en: {
              chat: {
                description: 'What would you like me to do?',
              },
            },
          },
        },
        'What would you like me to do?',
        0
      )
    ).toBe('What would you like me to do?')
  })
})
