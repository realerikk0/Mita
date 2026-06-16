import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  updateState: {
    remindMeLater: false,
    isUpdateAvailable: true,
    isUpdateReadyToInstall: false,
    isDownloading: false,
    isInstalling: false,
    downloadProgress: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    updateInfo: {
      version: '1.2.3',
      body: 'Primary update notes',
    },
  },
  downloadUpdate: vi.fn(),
  installDownloadedUpdate: vi.fn(),
  setRemindMeLater: vi.fn(),
  release: {
    body: 'Fallback GitHub notes',
  },
  fetchLatestRelease: vi.fn(),
  isDev: false,
}))

vi.mock('@/hooks/useAppUpdater', () => ({
  useAppUpdater: () => ({
    updateState: h.updateState,
    downloadUpdate: h.downloadUpdate,
    installDownloadedUpdate: h.installDownloadedUpdate,
    setRemindMeLater: h.setRemindMeLater,
  }),
}))

vi.mock('@/hooks/useReleaseNotes', () => ({
  useReleaseNotes: () => ({
    release: h.release,
    fetchLatestRelease: h.fetchLatestRelease,
  }),
}))

vi.mock('@/lib/utils', async () => {
  const actual = await vi.importActual<typeof import('@/lib/utils')>('@/lib/utils')
  return {
    ...actual,
    isDev: () => h.isDev,
  }
})

vi.mock('@/lib/version', () => ({
  isBeta: false,
  isNightly: false,
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('../../RenderMarkdown', () => ({
  RenderMarkdown: ({ content }: { content?: string }) => (
    <div data-testid="markdown">{content}</div>
  ),
}))

import DialogAppUpdater from '../AppUpdater'

describe('DialogAppUpdater', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.isDev = false
    h.release = {
      body: 'Fallback GitHub notes',
    }
    h.updateState = {
      remindMeLater: false,
      isUpdateAvailable: true,
      isUpdateReadyToInstall: false,
      isDownloading: false,
      isInstalling: false,
      downloadProgress: 0,
      downloadedBytes: 0,
      totalBytes: 0,
      updateInfo: {
        version: '1.2.3',
        body: 'Primary update notes',
      },
    }
  })

  it('prefers update info body over GitHub release notes', () => {
    render(<DialogAppUpdater />)

    fireEvent.click(screen.getByRole('button', { name: 'updater:showReleaseNotes' }))

    expect(screen.getByTestId('markdown')).toHaveTextContent('Primary update notes')
    expect(screen.queryByText('Fallback GitHub notes')).not.toBeInTheDocument()
  })

  it('falls back to GitHub release notes when update info body is empty', () => {
    h.updateState.updateInfo.body = ''

    render(<DialogAppUpdater />)

    fireEvent.click(screen.getByRole('button', { name: 'updater:showReleaseNotes' }))

    expect(screen.getByTestId('markdown')).toHaveTextContent('Fallback GitHub notes')
  })

  it('renders left-to-right progress fill inside the update button while downloading', () => {
    h.updateState.isDownloading = true
    h.updateState.downloadProgress = 0.42
    h.updateState.downloadedBytes = 420
    h.updateState.totalBytes = 1000

    render(<DialogAppUpdater />)

    const button = screen.getByRole('button', { name: 'updater:downloading 42%' })
    const fill = screen.getByTestId('app-update-button-fill')
    const label = screen.getByTestId('app-update-button-label')

    expect(button).toBeDisabled()
    expect(screen.getByTestId('app-update-progress-button')).toBe(button)
    expect(fill).toHaveClass('bg-primary')
    expect(fill).toHaveStyle({ width: '42%' })
    expect(label.getAttribute('style')).toContain(
      'var(--primary-foreground) 0 42%'
    )
    expect(label.getAttribute('style')).toContain(
      'var(--foreground) 42% 100%'
    )
    expect(
      screen.queryByTestId('app-update-button-fill-label')
    ).not.toBeInTheDocument()
    expect(screen.queryByTestId('app-update-progress-ring')).not.toBeInTheDocument()
    expect(
      screen.queryByTestId('app-update-progress-meter')
    ).not.toBeInTheDocument()
    expect(
      screen.queryByTestId('app-update-progress-details')
    ).not.toBeInTheDocument()
  })

  it('keeps the update button fill empty until a total download size is known', () => {
    h.updateState.isDownloading = true
    h.updateState.downloadProgress = 0
    h.updateState.downloadedBytes = 420
    h.updateState.totalBytes = 0

    render(<DialogAppUpdater />)

    expect(screen.getByTestId('app-update-button-fill')).toHaveStyle({
      width: '0%',
    })
    expect(screen.getByTestId('app-update-button-label').getAttribute('style')).toContain(
      'var(--primary-foreground) 0 0%'
    )
    expect(
      screen.getByRole('button', { name: 'updater:downloading' })
    ).toBeDisabled()
    expect(
      screen.queryByTestId('app-update-progress-meter')
    ).not.toBeInTheDocument()
  })
})
