import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGeneralSetting } from '../useGeneralSetting'

vi.mock('@/constants/localStorage', () => ({
  localStorageKey: { settingGeneral: 'general-settings' },
}))

vi.mock('zustand/middleware', () => ({
  persist: (initializer: unknown) => initializer,
  createJSONStorage: () => ({
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  }),
}))

describe('useGeneralSetting', () => {
  beforeEach(() => {
    useGeneralSetting.setState({
      currentLanguage: 'en',
      spellCheckChatInput: true,
    })
  })

  it('starts with the remote-only general settings', () => {
    const { result } = renderHook(() => useGeneralSetting())

    expect(result.current.currentLanguage).toBe('en')
    expect(result.current.spellCheckChatInput).toBe(true)
    expect(result.current).not.toHaveProperty('huggingfaceToken')
    expect(result.current).not.toHaveProperty('tokenCounterCompact')
  })

  it('changes language', () => {
    const { result } = renderHook(() => useGeneralSetting())

    act(() => result.current.setCurrentLanguage('id'))
    expect(result.current.currentLanguage).toBe('id')

    act(() => result.current.setCurrentLanguage('vn'))
    expect(result.current.currentLanguage).toBe('vn')
  })

  it('changes spell-check behavior', () => {
    const { result } = renderHook(() => useGeneralSetting())

    act(() => result.current.setSpellCheckChatInput(false))
    expect(result.current.spellCheckChatInput).toBe(false)

    act(() => result.current.setSpellCheckChatInput(true))
    expect(result.current.spellCheckChatInput).toBe(true)
  })

  it('shares updates across hook instances', () => {
    const { result: first } = renderHook(() => useGeneralSetting())
    const { result: second } = renderHook(() => useGeneralSetting())

    act(() => {
      first.current.setCurrentLanguage('vn')
      first.current.setSpellCheckChatInput(false)
    })

    expect(second.current.currentLanguage).toBe('vn')
    expect(second.current.spellCheckChatInput).toBe(false)
  })
})
