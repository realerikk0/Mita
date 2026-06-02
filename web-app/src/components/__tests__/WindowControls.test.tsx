import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom'

const h = vi.hoisted(() => {
  const state: {
    maximized: boolean
    resizedHandler?: () => void
  } = {
    maximized: false,
  }

  const unlisten = vi.fn()
  const appWindow = {
    minimize: vi.fn().mockResolvedValue(undefined),
    toggleMaximize: vi.fn(async () => {
      state.maximized = !state.maximized
    }),
    close: vi.fn().mockResolvedValue(undefined),
    isMaximized: vi.fn(() => Promise.resolve(state.maximized)),
    onResized: vi.fn(async (handler: () => void) => {
      state.resizedHandler = handler
      return unlisten
    }),
  }

  return {
    appWindow,
    state,
    unlisten,
  }
})

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: () => h.appWindow,
}))

import { WindowControls } from '../WindowControls'

describe('WindowControls', () => {
  beforeEach(() => {
    h.state.maximized = false
    h.state.resizedHandler = undefined
  })

  it('shows the restore action after maximizing the window', async () => {
    const user = userEvent.setup()
    render(<WindowControls />)

    await user.click(screen.getByRole('button', { name: 'Maximize' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument()
    })
  })

  it('syncs the icon when native window resize changes maximized state', async () => {
    render(<WindowControls />)

    await waitFor(() => {
      expect(h.appWindow.onResized).toHaveBeenCalled()
    })

    act(() => {
      h.state.maximized = true
      h.state.resizedHandler?.()
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument()
    })
  })
})
