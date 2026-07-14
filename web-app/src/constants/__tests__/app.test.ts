import { describe, expect, it } from 'vitest'
import {
  DEFAULT_APP_NAME,
  SIMPLIFIED_CHINESE_APP_NAME,
  getLocalizedAppName,
} from '../app'

describe('getLocalizedAppName', () => {
  it('uses the Chinese app name for Simplified Chinese', () => {
    expect(getLocalizedAppName('zh-CN')).toBe(SIMPLIFIED_CHINESE_APP_NAME)
    expect(getLocalizedAppName('zh-CN')).toBe('彼岩')
  })

  it('keeps the default app name for other languages', () => {
    expect(getLocalizedAppName('en')).toBe(DEFAULT_APP_NAME)
    expect(getLocalizedAppName('zh-TW')).toBe(DEFAULT_APP_NAME)
  })
})
