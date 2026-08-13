import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUseBlocker } = vi.hoisted(() => ({
  mockUseBlocker: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useBlocker: mockUseBlocker,
}))

import { useNovelExitGuard } from '@/hooks/useNovelExitGuard'

describe('useNovelExitGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function setup({
    flush = vi.fn().mockResolvedValue(undefined),
    hasPendingWrites = vi.fn(() => true),
  } = {}) {
    const unlisten = vi.fn()
    const registerCloseGuard = vi.fn().mockResolvedValue(unlisten)
    const onFailure = vi.fn()
    const rendered = renderHook(() =>
      useNovelExitGuard({
        windowService: { registerCloseGuard },
        flush,
        hasPendingWrites,
        onFailure,
      })
    )
    return {
      ...rendered,
      flush,
      unlisten,
      registerCloseGuard,
      hasPendingWrites,
      onFailure,
    }
  }

  it('flushes before navigation and allows it only after persistence succeeds', async () => {
    const { flush, onFailure } = setup()
    const options = mockUseBlocker.mock.calls[0]?.[0]

    await expect(
      options.shouldBlockFn({
        current: { pathname: '/novels/a/one' },
        next: { pathname: '/settings' },
      })
    ).resolves.toBe(false)

    expect(flush).toHaveBeenCalledOnce()
    expect(onFailure).not.toHaveBeenCalled()
    expect(options.enableBeforeUnload()).toBe(true)
  })

  it('blocks navigation when durable persistence fails', async () => {
    const error = new Error('disk full')
    const flush = vi.fn().mockRejectedValue(error)
    const { onFailure } = setup({ flush })
    const options = mockUseBlocker.mock.calls[0]?.[0]

    await expect(
      options.shouldBlockFn({
        current: { pathname: '/novels/a/one' },
        next: { pathname: '/' },
      })
    ).resolves.toBe(true)
    expect(onFailure).toHaveBeenCalledWith(error, '离开网文模式')
  })

  it('does not flush a same-path history update', async () => {
    const { flush } = setup()
    const options = mockUseBlocker.mock.calls[0]?.[0]

    await expect(
      options.shouldBlockFn({
        current: { pathname: '/novels/a/one' },
        next: { pathname: '/novels/a/one' },
      })
    ).resolves.toBe(false)
    expect(flush).not.toHaveBeenCalled()
  })

  it('allows a clean route transition without flushing', async () => {
    const hasPendingWrites = vi.fn(() => false)
    const { flush } = setup({ hasPendingWrites })
    const options = mockUseBlocker.mock.calls[0]?.[0]

    await expect(
      options.shouldBlockFn({
        current: { pathname: '/novels/a/one' },
        next: { pathname: '/settings' },
      })
    ).resolves.toBe(false)

    expect(hasPendingWrites).toHaveBeenCalledOnce()
    expect(flush).not.toHaveBeenCalled()
    expect(options.enableBeforeUnload()).toBe(false)
  })

  it('lets native close proceed only after a successful flush', async () => {
    const { registerCloseGuard, flush, unmount, unlisten } = setup()
    await waitFor(() => expect(registerCloseGuard).toHaveBeenCalledOnce())
    const closeGuard = registerCloseGuard.mock.calls[0]?.[0]

    await expect(closeGuard()).resolves.toBe(true)
    expect(flush).toHaveBeenCalledOnce()

    act(() => unmount())
    expect(unlisten).toHaveBeenCalledOnce()
  })

  it('keeps the native window open when the flush fails', async () => {
    const error = new Error('revision conflict')
    const flush = vi.fn().mockRejectedValue(error)
    const { registerCloseGuard, onFailure } = setup({ flush })
    await waitFor(() => expect(registerCloseGuard).toHaveBeenCalledOnce())
    const closeGuard = registerCloseGuard.mock.calls[0]?.[0]

    await expect(closeGuard()).resolves.toBe(false)
    expect(onFailure).toHaveBeenCalledWith(error, '关闭窗口')
  })

  it('allows a clean native close without flushing', async () => {
    const hasPendingWrites = vi.fn(() => false)
    const { registerCloseGuard, flush } = setup({ hasPendingWrites })
    await waitFor(() => expect(registerCloseGuard).toHaveBeenCalledOnce())
    const closeGuard = registerCloseGuard.mock.calls[0]?.[0]

    await expect(closeGuard()).resolves.toBe(true)
    expect(hasPendingWrites).toHaveBeenCalledOnce()
    expect(flush).not.toHaveBeenCalled()
  })
})
