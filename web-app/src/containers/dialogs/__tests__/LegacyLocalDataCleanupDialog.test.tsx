import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  toastSuccess: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: h.invoke,
}))

vi.mock('sonner', () => ({
  toast: {
    success: h.toastSuccess,
  },
}))

import { LegacyLocalDataCleanupDialog } from '../LegacyLocalDataCleanupDialog'

describe('LegacyLocalDataCleanupDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.invoke.mockImplementation((command: string) => {
      if (command === 'inspect_legacy_local_data') {
        return Promise.resolve({
          entries: [
            {
              path: '/Users/test/Library/Application Support/Jan/models',
              bytes: 1024,
            },
          ],
          totalBytes: 1024,
          confirmationToken: 'review-token-123',
        })
      }
      if (command === 'cleanup_legacy_local_data') {
        return Promise.resolve(1024)
      }
      return Promise.reject(new Error(`Unexpected command: ${command}`))
    })
  })

  it('inspects first and only cleans after a second explicit confirmation', async () => {
    const user = userEvent.setup()
    render(<LegacyLocalDataCleanupDialog />)

    await user.click(
      screen.getByRole('button', { name: 'Inspect legacy local data' })
    )

    expect(await screen.findByText(/Application Support\/Jan\/models/)).toBeVisible()
    expect(screen.getAllByText('1 KB')).toHaveLength(2)
    expect(h.invoke).toHaveBeenCalledTimes(1)
    expect(h.invoke).toHaveBeenCalledWith('inspect_legacy_local_data')

    await user.click(screen.getByRole('button', { name: 'Review deletion' }))

    expect(h.invoke).toHaveBeenCalledTimes(1)
    expect(screen.getByText('This is the final confirmation.')).toBeVisible()

    await user.click(
      screen.getByRole('button', { name: 'Delete reviewed data' })
    )

    await waitFor(() => {
      expect(h.invoke).toHaveBeenCalledWith('cleanup_legacy_local_data', {
        confirmationToken: 'review-token-123',
      })
    })
    expect(h.toastSuccess).toHaveBeenCalledTimes(1)
  })
})
