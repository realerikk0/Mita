import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useWebSearch } from '../useWebSearch'

describe('useWebSearch', () => {
  it('defaults new users to automatic web search', () => {
    expect(useWebSearch.getInitialState()).toMatchObject({
      enabled: true,
      mode: 'auto',
    })
  })

  it('keeps enabled and mode synchronized', () => {
    useWebSearch.setState({ enabled: true, mode: 'auto' })

    const { result } = renderHook(() => useWebSearch())

    act(() => {
      result.current.setEnabled(false)
    })

    expect(result.current.enabled).toBe(false)
    expect(result.current.mode).toBe('off')

    act(() => {
      result.current.setEnabled(true)
    })

    expect(result.current.enabled).toBe(true)
    expect(result.current.mode).toBe('auto')
  })
})
