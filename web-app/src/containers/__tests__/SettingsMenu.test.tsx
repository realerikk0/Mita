import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import SettingsMenu from '../SettingsMenu'
import { useNavigate, useMatches } from '@tanstack/react-router'
import { useModelProvider } from '@/hooks/useModelProvider'

// Mock global platform constants - simulate desktop (Tauri) environment
Object.defineProperty(global, 'IS_IOS', { value: false, writable: true })
Object.defineProperty(global, 'IS_ANDROID', { value: false, writable: true })
Object.defineProperty(global, 'IS_WEB_APP', { value: false, writable: true })

// Mock dependencies
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, className }: any) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
  useMatches: vi.fn(),
  useNavigate: vi.fn(),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'common:providerBalance.current': '当前',
      }
      return translations[key] ?? key
    },
  }),
}))

vi.mock('@/hooks/useGeneralSetting', () => ({
  useGeneralSetting: vi.fn(() => ({})),
}))

vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: vi.fn(() => ({
    providers: [
      {
        provider: 'openai',
        active: true,
        models: [],
      },
      {
        provider: 'llama.cpp',
        active: true,
        models: [],
      },
    ],
    addProvider: vi.fn(),
  })),
}))

vi.mock('@/containers/dialogs', () => ({
  AddProviderDialog: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}))

vi.mock('@/lib/utils', () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
  getProviderTitle: (provider: string) => provider,
}))

vi.mock('@/containers/ProvidersAvatar', () => ({
  default: ({ provider }: { provider: any }) => (
    <div data-testid={`provider-avatar-${provider.provider}`}>
      {provider.provider}
    </div>
  ),
}))

describe('SettingsMenu', () => {
  const mockNavigate = vi.fn()
  const mockMatches = [
    {
      routeId: '/settings/general',
      params: {},
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()

    vi.mocked(useNavigate).mockReturnValue(mockNavigate)
    vi.mocked(useMatches).mockReturnValue(mockMatches)
    vi.mocked(useModelProvider).mockReturnValue({
      providers: [
        { provider: 'openai', active: true, models: [] },
        { provider: 'llama.cpp', active: true, models: [] },
      ],
      addProvider: vi.fn(),
    })
  })

  it('renders all menu items', () => {
    render(<SettingsMenu />)

    expect(screen.getByText('common:general')).toBeInTheDocument()
    expect(screen.getByText('common:appearance')).toBeInTheDocument()
    expect(screen.getByText('common:privacy')).toBeInTheDocument()
  })

  it('renders core settings links', () => {
    render(<SettingsMenu />)
    expect(screen.getByText('common:keyboardShortcuts')).toBeInTheDocument()
    expect(screen.getByText('common:assistants')).toBeInTheDocument()
    expect(screen.getByText('common:privacy')).toBeInTheDocument()
    expect(
      screen.queryByText('common:local_api_server')
    ).not.toBeInTheDocument()
  })

  it('renders integrations links', () => {
    render(<SettingsMenu />)
    expect(screen.getByText('common:computerAgent')).toBeInTheDocument()
    expect(screen.getByText('common:connectors')).toBeInTheDocument()
    expect(screen.queryByText('common:claude_code')).not.toBeInTheDocument()
  })

  it('hides providers outside the supported provider list', () => {
    render(<SettingsMenu />)

    expect(screen.getByTestId('provider-avatar-openai')).toBeInTheDocument()
    expect(
      screen.queryByTestId('provider-avatar-llama.cpp')
    ).not.toBeInTheDocument()
  })

  it('shows expanded providers by default', () => {
    render(<SettingsMenu />)

    // Providers ARE expanded by default (expandedProviders starts as true)
    expect(screen.getByTestId('provider-avatar-openai')).toBeInTheDocument()
  })

  it('collapses disabled providers section when toggle is clicked', async () => {
    vi.mocked(useModelProvider).mockReturnValue({
      providers: [
        { provider: 'openai', active: true, models: [] },
        { provider: 'anthropic', active: false, models: [] },
      ],
      addProvider: vi.fn(),
    })

    const user = userEvent.setup()
    render(<SettingsMenu />)

    // Disabled section is expanded by default — anthropic is visible
    expect(screen.getByTestId('provider-avatar-anthropic')).toBeInTheDocument()

    // Click the toggle to collapse the disabled section
    const toggleButton = screen.getByText('common:hiddenProviders')
    await user.click(toggleButton)

    // After collapsing, anthropic should be hidden
    expect(
      screen.queryByTestId('provider-avatar-anthropic')
    ).not.toBeInTheDocument()
  })

  it('auto-expands providers when on provider route', () => {
    vi.mocked(useMatches).mockReturnValue([
      {
        routeId: '/settings/providers/$providerName',
        params: { providerName: 'openai' },
      },
    ])

    render(<SettingsMenu />)

    expect(screen.getByTestId('provider-avatar-openai')).toBeInTheDocument()
  })

  it('highlights active provider in submenu', () => {
    vi.mocked(useMatches).mockReturnValue([
      {
        routeId: '/settings/providers/$providerName',
        params: { providerName: 'openai' },
      },
    ])

    render(<SettingsMenu />)

    const openaiProvider = screen
      .getByTestId('provider-avatar-openai')
      .closest('div')
    expect(openaiProvider).toBeInTheDocument()
  })

  it('marks the currently selected chat provider in the provider list', () => {
    vi.mocked(useModelProvider).mockReturnValue({
      providers: [
        { provider: 'openai', active: true, models: [] },
        { provider: 'jingxing', active: true, models: [] },
      ],
      selectedProvider: 'jingxing',
      addProvider: vi.fn(),
    })

    render(<SettingsMenu />)

    const jingxingProvider = screen
      .getByTestId('provider-avatar-jingxing')
      .closest('div[class*="cursor-pointer"]')
    expect(jingxingProvider).toHaveTextContent('当前')
  })

  it('navigates to provider when provider is clicked', async () => {
    const user = userEvent.setup()
    render(<SettingsMenu />)

    // Providers are expanded by default, click directly on a provider
    const openaiProvider = screen
      .getByTestId('provider-avatar-openai')
      .closest('div[class*="cursor-pointer"]')
    await user.click(openaiProvider!)

    expect(mockNavigate).toHaveBeenCalled()
  })

  it('orders supported providers according to the shared display order', () => {
    vi.mocked(useModelProvider).mockReturnValue({
      providers: [
        { provider: 'gemini', active: true, models: [] },
        { provider: 'anthropic', active: true, models: [] },
        { provider: 'jingxing', active: true, models: [] },
        { provider: 'openai', active: true, models: [] },
      ],
      addProvider: vi.fn(),
    })

    render(<SettingsMenu />)

    const providerNames = screen
      .getAllByTestId(/^provider-avatar-/)
      .map((provider) => provider.textContent)

    expect(providerNames).toEqual(['jingxing', 'openai', 'anthropic', 'gemini'])
  })

  it('shows inactive providers in disabled section', () => {
    vi.mocked(useModelProvider).mockReturnValue({
      providers: [
        { provider: 'openai', active: true, models: [] },
        { provider: 'anthropic', active: false, models: [] },
      ],
      addProvider: vi.fn(),
    })

    render(<SettingsMenu />)

    // Active provider shown normally
    expect(screen.getByTestId('provider-avatar-openai')).toBeInTheDocument()
    // Inactive provider shown in the disabled section (expanded by default)
    expect(screen.getByTestId('provider-avatar-anthropic')).toBeInTheDocument()
    // Disabled section label is shown
    expect(screen.getByText('common:hiddenProviders')).toBeInTheDocument()
  })
})
