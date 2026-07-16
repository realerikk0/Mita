import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Route as ProvidersRoute } from '../index'

const h = vi.hoisted(() => ({
  providers: [] as Array<{
    provider: string
    active: boolean
    models: Array<{ id: string }>
  }>,
  navigate: vi.fn(),
  updateProvider: vi.fn(),
}))

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
    header,
    children,
  }: {
    header?: React.ReactNode
    children: React.ReactNode
  }) => (
    <div data-testid="card">
      {header && <div data-testid="card-header">{header}</div>}
      {children}
    </div>
  ),
  CardItem: ({
    title,
    actions,
  }: {
    title?: React.ReactNode
    actions?: React.ReactNode
  }) => (
    <div data-testid="card-item">
      {title && <div data-testid="card-item-title">{title}</div>}
      {actions && <div data-testid="card-item-actions">{actions}</div>}
    </div>
  ),
}))

vi.mock('@/containers/ProvidersAvatar', () => ({
  default: ({ provider }: { provider: { provider: string } }) => (
    <div data-testid={`provider-avatar-${provider.provider}`} />
  ),
}))

vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: () => ({
    providers: h.providers,
    updateProvider: h.updateProvider,
  }),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/lib/utils', () => ({
  getProviderTitle: (provider: string) => provider,
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => config,
  useNavigate: () => h.navigate,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
  }: {
    children: React.ReactNode
    onClick?: () => void
  }) => (
    <button data-testid="settings-button" onClick={onClick}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/switch', () => ({
  Switch: ({
    checked,
    onCheckedChange,
  }: {
    checked: boolean
    onCheckedChange: (checked: boolean) => void
  }) => (
    <input
      data-testid="provider-switch"
      type="checkbox"
      checked={checked}
      onChange={(event) => onCheckedChange(event.target.checked)}
    />
  ),
}))

const makeProvider = (provider: string) => ({
  provider,
  active: true,
  models: [{ id: `${provider}-model` }],
})

const renderComponent = () => {
  const Component = ProvidersRoute.component as React.ComponentType
  return render(<Component />)
}

describe('Providers Settings Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.providers = [
      'gemini',
      'mistral',
      'xai',
      'deepseek',
      'openrouter',
      'anthropic',
      'azure',
      'openai',
      'jingxing',
    ].map(makeProvider)
  })

  it('renders the providers settings layout', () => {
    renderComponent()

    expect(screen.getByTestId('header-page')).toBeInTheDocument()
    expect(screen.getByTestId('settings-menu')).toBeInTheDocument()
    expect(screen.getByTestId('card')).toBeInTheDocument()
    expect(screen.getByText('common:modelProviders')).toBeInTheDocument()
  })

  it('shows only the eight supported providers in the requested order', () => {
    renderComponent()

    const providerNames = screen
      .getAllByTestId(/^provider-avatar-/)
      .map((avatar) => avatar.dataset.testid?.replace('provider-avatar-', ''))

    expect(providerNames).toEqual([
      'jingxing',
      'openai',
      'azure',
      'anthropic',
      'openrouter',
      'deepseek',
      'xai',
      'gemini',
    ])
    expect(
      screen.queryByTestId('provider-avatar-mistral')
    ).not.toBeInTheDocument()
    expect(screen.getAllByTestId('card-item')).toHaveLength(8)
  })

  it('does not render the custom provider creation control', () => {
    renderComponent()

    expect(screen.queryByText('provider:addProvider')).not.toBeInTheDocument()
  })

  it('opens the selected provider settings', () => {
    renderComponent()

    fireEvent.click(screen.getAllByTestId('settings-button')[0])

    expect(h.navigate).toHaveBeenCalledWith({
      to: '/settings/providers/$providerName',
      params: { providerName: 'jingxing' },
    })
  })

  it('updates a provider active state from its switch', () => {
    renderComponent()

    fireEvent.click(screen.getAllByTestId('provider-switch')[0])

    expect(h.updateProvider).toHaveBeenCalledWith(
      'jingxing',
      expect.objectContaining({ provider: 'jingxing', active: false })
    )
  })
})
