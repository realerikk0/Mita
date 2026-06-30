import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { Route as GeneralRoute } from '../general'

const webSearchMocks = vi.hoisted(() => ({
  setEnabled: vi.fn(),
  setActive: vi.fn().mockResolvedValue(true),
  state: {
    enabled: false,
    hasConfig: true,
    isActive: false,
    isLoading: false,
  },
}))

const serviceHubMocks = vi.hoisted(() => ({
  factoryReset: vi.fn(),
  getMitaDataFolder: vi.fn().mockResolvedValue('/test/data/folder'),
  getLogsDirectory: vi.fn().mockResolvedValue('/test/logs/folder'),
  clearLogs: vi.fn().mockResolvedValue(undefined),
  relocateMitaDataFolder: vi.fn(),
  stopAllModels: vi.fn(),
  dialogOpen: vi.fn().mockResolvedValue('/test/path'),
  emit: vi.fn(),
  openLogsWindow: vi.fn(),
  revealItemInDir: vi.fn().mockResolvedValue(undefined),
}))

// Mock all the dependencies
vi.mock('@/containers/SettingsMenu', () => ({
  default: () => <div data-testid="settings-menu">Settings Menu</div>,
}))

vi.mock('@/containers/HeaderPage', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="header-page">{children}</div>
  ),
}))

vi.mock('@/containers/Card', () => ({
  Card: ({
    title,
    children,
  }: {
    title?: string
    children: React.ReactNode
  }) => (
    <div data-testid="card" data-title={title}>
      {title && <div data-testid="card-title">{title}</div>}
      {children}
    </div>
  ),
  CardItem: ({
    title,
    description,
    actions,
    className,
  }: {
    title?: string
    description?: string
    actions?: React.ReactNode
    className?: string
  }) => (
    <div data-testid="card-item" data-title={title} className={className}>
      {title && <div data-testid="card-item-title">{title}</div>}
      {description && (
        <div data-testid="card-item-description">{description}</div>
      )}
      {actions && <div data-testid="card-item-actions">{actions}</div>}
    </div>
  ),
}))

vi.mock('@/containers/LanguageSwitcher', () => ({
  default: () => <div data-testid="language-switcher">Language Switcher</div>,
}))

vi.mock('@/containers/dialogs/ChangeDataFolderLocation', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="change-data-folder-dialog">{children}</div>
  ),
}))

vi.mock('@/hooks/useGeneralSetting', () => ({
  useGeneralSetting: () => ({
    spellCheckChatInput: true,
    setSpellCheckChatInput: vi.fn(),
    huggingfaceToken: 'test-token',
    setHuggingfaceToken: vi.fn(),
  }),
}))

vi.mock('@/hooks/useWebSearch', () => ({
  useWebSearch: (selector: any) =>
    selector({
      enabled: webSearchMocks.state.enabled,
      setEnabled: webSearchMocks.setEnabled,
      toggle: vi.fn(),
    }),
}))

vi.mock('@/hooks/useMitaWebResearch', () => ({
  useMitaWebResearch: () => ({
    hasConfig: webSearchMocks.state.hasConfig,
    isActive: webSearchMocks.state.isActive,
    isLoading: webSearchMocks.state.isLoading,
    setActive: webSearchMocks.setActive,
  }),
}))

// Create a controllable mock
const mockCheckForUpdate = vi.fn()

vi.mock('@/hooks/useAppUpdater', () => ({
  useAppUpdater: () => ({
    checkForUpdate: mockCheckForUpdate,
  }),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/components/ui/switch', () => ({
  Switch: ({
    checked,
    onCheckedChange,
    disabled,
  }: {
    checked: boolean
    onCheckedChange: (checked: boolean) => void
    disabled?: boolean
  }) => (
    <input
      data-testid="switch"
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onCheckedChange(e.target.checked)}
    />
  ),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    ...props
  }: {
    children: React.ReactNode
    onClick?: () => void
    disabled?: boolean
    [key: string]: any
  }) => (
    <button
      data-testid="button"
      onClick={onClick}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/input', () => ({
  Input: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
    placeholder?: string
  }) => (
    <input
      data-testid="input"
      value={value}
      onChange={onChange}
      placeholder={placeholder}
    />
  ),
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog">{children}</div>
  ),
  DialogClose: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-close">{children}</div>
  ),
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-content">{children}</div>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-description">{children}</div>
  ),
  DialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-footer">{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-header">{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-title">{children}</div>
  ),
  DialogTrigger: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-trigger">{children}</div>
  ),
}))

vi.mock('@/services/app/web', () => ({
  WebAppService: vi.fn().mockImplementation(() => ({
    factoryReset: vi.fn(),
    getMitaDataFolder: vi.fn().mockResolvedValue('/test/data/folder'),
    relocateMitaDataFolder: vi.fn(),
  })),
}))

vi.mock('@/services/models/default', () => ({
  DefaultModelsService: vi.fn().mockImplementation(() => ({
    stopAllModels: vi.fn(),
  })),
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    app: () => ({
      factoryReset: serviceHubMocks.factoryReset,
      getMitaDataFolder: serviceHubMocks.getMitaDataFolder,
      getLogsDirectory: serviceHubMocks.getLogsDirectory,
      clearLogs: serviceHubMocks.clearLogs,
      relocateMitaDataFolder: serviceHubMocks.relocateMitaDataFolder,
    }),
    models: () => ({
      stopAllModels: serviceHubMocks.stopAllModels,
    }),
    dialog: () => ({
      open: serviceHubMocks.dialogOpen,
    }),
    events: () => ({
      emit: serviceHubMocks.emit,
    }),
    window: () => ({
      openLogsWindow: serviceHubMocks.openLogsWindow,
    }),
    opener: () => ({
      revealItemInDir: serviceHubMocks.revealItemInDir,
    }),
    path: () => ({
      join: vi.fn().mockResolvedValue('/test/data/folder/logs'),
      sep: vi.fn().mockReturnValue('/'),
      dirname: vi.fn().mockResolvedValue('/test/data/folder'),
      basename: vi.fn().mockResolvedValue('logs'),
      extname: vi.fn().mockResolvedValue(''),
    }),
  }),
}))

vi.mock('@/lib/user-log', () => ({
  logUserAction: vi.fn(),
  logUserError: vi.fn(),
  logUserWarning: vi.fn(),
}))

// Add tests for rfd dialog
// vi.mock('@tauri-apps/plugin-dialog', () => ({
//   open: vi.fn(),
// }))

vi.mock('@tauri-apps/plugin-opener', () => ({
  revealItemInDir: vi.fn(),
}))

vi.mock('@tauri-apps/api/webviewWindow', () => {
  const MockWebviewWindow = vi
    .fn()
    .mockImplementation((label: string, options: any) => ({
      once: vi.fn(),
      setFocus: vi.fn(),
    }))
  MockWebviewWindow.getByLabel = vi.fn().mockReturnValue(null)

  return {
    WebviewWindow: MockWebviewWindow,
  }
})

vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}))

vi.mock('@/lib/utils', () => ({
  isDev: vi.fn().mockReturnValue(false),
}))

vi.mock('@/constants/routes', () => ({
  route: {
    settings: {
      general: '/settings/general',
    },
    appLogs: '/logs',
  },
}))

vi.mock('@/constants/windows', () => ({
  windowKey: {
    logsAppWindow: 'logs-app-window',
  },
}))

vi.mock('@/types/events', () => ({
  SystemEvent: {
    KILL_SIDECAR: 'kill-sidecar',
  },
}))


vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (path: string) => (config: any) => ({
    ...config,
    component: config.component,
  }),
}))

// Mock global variables
global.VERSION = '1.0.0'
global.IS_MACOS = false
global.IS_WINDOWS = true
global.AUTO_UPDATER_DISABLED = false
global.window = {
  ...global.window,
  core: {
    api: {
      relaunch: vi.fn(),
      getConnectedServers: vi.fn().mockResolvedValue([]),
    },
  },
}

// Mock navigator clipboard
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn(),
  },
})

describe('General Settings Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset the mock to return a promise that resolves immediately by default
    mockCheckForUpdate.mockResolvedValue(null)
    webSearchMocks.state.enabled = false
    webSearchMocks.state.hasConfig = true
    webSearchMocks.state.isActive = false
    webSearchMocks.state.isLoading = false
    webSearchMocks.setActive.mockResolvedValue(true)
    serviceHubMocks.getMitaDataFolder.mockResolvedValue('/test/data/folder')
    serviceHubMocks.getLogsDirectory.mockResolvedValue('/test/logs/folder')
    serviceHubMocks.clearLogs.mockResolvedValue(undefined)
  })

  it('should render the general settings page', async () => {
    const Component = GeneralRoute.component as React.ComponentType
    await act(async () => {
      render(<Component />)
    })

    expect(screen.getByTestId('header-page')).toBeInTheDocument()
    expect(screen.getByTestId('settings-menu')).toBeInTheDocument()
    expect(screen.getByText('common:settings')).toBeInTheDocument()
  })

  it('should render app version', async () => {
    const Component = GeneralRoute.component as React.ComponentType
    await act(async () => {
      render(<Component />)
    })

    expect(screen.getByText('v1.0.0')).toBeInTheDocument()
  })

  it('defines clear log strings under the general settings namespace', () => {
    const localesDir = path.resolve(process.cwd(), 'src/locales')
    const requiredKeys = [
      'clearLogs',
      'clearLogsTitle',
      'clearLogsDesc',
      'clearLogsSuccess',
      'clearLogsError',
    ]

    for (const locale of fs.readdirSync(localesDir)) {
      const settingsUrl = path.join(localesDir, locale, 'settings.json')
      if (!fs.existsSync(settingsUrl)) continue

      const settings = JSON.parse(fs.readFileSync(settingsUrl, 'utf8'))
      for (const key of requiredKeys) {
        expect(settings.general?.[key], `${locale} missing general.${key}`)
          .toBeTruthy()
      }
      expect(
        settings.general.clearLogsDesc,
        `${locale} missing 30-day retention copy`
      ).toContain('30')
    }
  })

  // TODO: This test is currently commented out due to missing implementation
  // it('should render language switcher', () => {
  //   const Component = GeneralRoute.component as React.ComponentType
  //   render(<Component />)

  //   expect(screen.getByTestId('language-switcher')).toBeInTheDocument()
  // })

  it('should render huggingface token input', async () => {
    const Component = GeneralRoute.component as React.ComponentType
    await act(async () => {
      render(<Component />)
    })

    const input = screen.getByTestId('input')
    expect(input).toBeInTheDocument()
    expect(input).toHaveValue('test-token')
  })

  it('should handle spell check toggle', async () => {
    const Component = GeneralRoute.component as React.ComponentType
    await act(async () => {
      render(<Component />)
    })

    const switches = screen.getAllByTestId('switch')
    expect(switches.length).toBeGreaterThan(0)

    // Test that switches are interactive
    await act(async () => {
      fireEvent.click(switches[0])
    })
    expect(switches[0]).toBeInTheDocument()
  })

  it('should move web search control into general settings', async () => {
    const Component = GeneralRoute.component as React.ComponentType
    await act(async () => {
      render(<Component />)
    })

    const webSearchTitle = screen.getByText('settings:others.webSearch')
    const cardItem = webSearchTitle.closest('[data-testid="card-item"]')
    const switchInput = cardItem?.querySelector('input[type="checkbox"]')

    expect(cardItem).toBeInTheDocument()
    expect(cardItem).toHaveTextContent(
      'settings:others.webSearchDescConfigured'
    )
    expect(switchInput).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(switchInput!)
    })

    expect(webSearchMocks.setEnabled).toHaveBeenCalledWith(true)
    expect(webSearchMocks.setActive).toHaveBeenCalledWith(true)
  })

  it('should handle huggingface token change', async () => {
    const Component = GeneralRoute.component as React.ComponentType
    await act(async () => {
      render(<Component />)
    })

    const input = screen.getByTestId('input')
    expect(input).toBeInTheDocument()

    // Test that input is interactive
    await act(async () => {
      fireEvent.change(input, { target: { value: 'new-token' } })
    })
    expect(input).toBeInTheDocument()
  })

  it('should handle check for updates', async () => {
    const Component = GeneralRoute.component as React.ComponentType
    await act(async () => {
      render(<Component />)
    })

    const buttons = screen.getAllByTestId('button')
    const checkUpdateButton = buttons.find((button) =>
      button.textContent?.includes('checkForUpdates')
    )

    expect(checkUpdateButton).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(checkUpdateButton!)
    })

    expect(mockCheckForUpdate).toHaveBeenCalledWith(true)
  })

  it('should handle data folder display', async () => {
    const Component = GeneralRoute.component as React.ComponentType
    await act(async () => {
      render(<Component />)
    })

    // Test that component renders without errors
    expect(screen.getByTestId('header-page')).toBeInTheDocument()
    expect(screen.getByTestId('settings-menu')).toBeInTheDocument()
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.getByText('/test/logs/folder')).toBeInTheDocument()
  })

  it('should handle copy to clipboard', async () => {
    const Component = GeneralRoute.component as React.ComponentType
    await act(async () => {
      render(<Component />)
    })

    // Test that component renders without errors
    expect(screen.getByTestId('header-page')).toBeInTheDocument()
    expect(screen.getByTestId('settings-menu')).toBeInTheDocument()
  })

  it('should handle factory reset dialog', async () => {
    const Component = GeneralRoute.component as React.ComponentType
    await act(async () => {
      render(<Component />)
    })

    expect(screen.getAllByTestId('dialog').length).toBeGreaterThan(0)
    expect(screen.getAllByTestId('dialog-trigger').length).toBeGreaterThan(0)
    expect(screen.getAllByTestId('dialog-content').length).toBeGreaterThan(0)
  })

  it('should render external links', async () => {
    const Component = GeneralRoute.component as React.ComponentType
    await act(async () => {
      render(<Component />)
    })

    // Check for external links
    const links = screen.getAllByRole('link')
    expect(links.length).toBeGreaterThan(0)
  })

  it('should handle logs window opening', async () => {
    const Component = GeneralRoute.component as React.ComponentType
    await act(async () => {
      render(<Component />)
    })

    const buttons = screen.getAllByTestId('button')
    const openLogsButton = buttons.find((button) =>
      button.textContent?.includes('openLogs')
    )

    if (openLogsButton) {
      expect(openLogsButton).toBeInTheDocument()
      // Test that button is interactive
      await act(async () => {
        fireEvent.click(openLogsButton)
      })
      expect(openLogsButton).toBeInTheDocument()
    }
  })

  it('should handle reveal logs folder', async () => {
    const Component = GeneralRoute.component as React.ComponentType
    await act(async () => {
      render(<Component />)
    })

    const buttons = screen.getAllByTestId('button')
    const revealLogsButton = buttons.find((button) =>
      button.textContent?.includes('showInFileExplorer')
    )

    if (revealLogsButton) {
      expect(revealLogsButton).toBeInTheDocument()
      // Test that button is interactive
      await act(async () => {
        fireEvent.click(revealLogsButton)
      })
      expect(revealLogsButton).toBeInTheDocument()
      expect(serviceHubMocks.revealItemInDir).toHaveBeenCalledWith(
        '/test/logs/folder'
      )
    }
  })

  it('should clear logs from the confirmation dialog', async () => {
    const Component = GeneralRoute.component as React.ComponentType
    await act(async () => {
      render(<Component />)
    })

    const buttons = screen.getAllByTestId('button')
    const clearLogsButtons = buttons.filter((button) =>
      button.textContent?.includes('clearLogs')
    )
    const clearLogsButton = clearLogsButtons.at(-1)

    expect(clearLogsButton).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(clearLogsButton!)
    })

    expect(serviceHubMocks.clearLogs).toHaveBeenCalled()
  })

  it('should show correct file explorer text for Windows', async () => {
    global.IS_WINDOWS = true
    global.IS_MACOS = false

    const Component = GeneralRoute.component as React.ComponentType
    await act(async () => {
      render(<Component />)
    })

    expect(
      screen.getByText('settings:general.showInFileExplorer')
    ).toBeInTheDocument()
  })

  it('should disable check for updates button when checking', async () => {
    // Create a promise that we can control
    let resolveUpdate: (value: any) => void
    const updatePromise = new Promise((resolve) => {
      resolveUpdate = resolve
    })
    mockCheckForUpdate.mockReturnValue(updatePromise)

    const Component = GeneralRoute.component as React.ComponentType
    await act(async () => {
      render(<Component />)
    })

    const buttons = screen.getAllByTestId('button')
    const checkUpdateButton = buttons.find((button) =>
      button.textContent?.includes('checkForUpdates')
    )

    expect(checkUpdateButton).toBeInTheDocument()

    // Click the button but don't await it yet
    act(() => {
      fireEvent.click(checkUpdateButton!)
    })

    // Now the button should be disabled while checking
    expect(checkUpdateButton).toBeDisabled()

    // Resolve the promise to finish the update check
    await act(async () => {
      resolveUpdate!(null)
      await updatePromise
    })

    // Button should be enabled again
    expect(checkUpdateButton).not.toBeDisabled()
  })
})
