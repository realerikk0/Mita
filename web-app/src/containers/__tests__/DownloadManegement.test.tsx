import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  updateState: {
    isDownloading: false,
    downloadProgress: 0,
    downloadedBytes: 0,
    totalBytes: 0,
  },
}))

vi.mock('@/hooks/useAppUpdater', () => ({
  useAppUpdater: () => ({ updateState: h.updateState }),
}))

import { DownloadManagement } from '../DownloadManegement'

describe('DownloadManagement', () => {
  beforeEach(() => {
    h.updateState = {
      isDownloading: false,
      downloadProgress: 0,
      downloadedBytes: 0,
      totalBytes: 0,
    }
  })

  it('stays hidden when no application update is downloading', () => {
    const { container } = render(<DownloadManagement />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows only immutable application-update progress', async () => {
    h.updateState = {
      isDownloading: true,
      downloadProgress: 0.5,
      downloadedBytes: 1024,
      totalBytes: 2048,
    }
    const user = userEvent.setup()

    render(<DownloadManagement />)
    await user.click(
      screen.getByRole('button', { name: 'Application update download' })
    )

    expect(screen.getByText('Application update')).toBeVisible()
    expect(screen.getByText('50%')).toBeVisible()
    expect(screen.getByText('1 KB / 2 KB')).toBeVisible()
  })
})
