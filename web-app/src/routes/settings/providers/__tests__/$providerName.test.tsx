/* eslint-disable @typescript-eslint/no-explicit-any */
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  providerName: 'remote',
  provider: undefined as ModelProvider | undefined,
  updateProvider: vi.fn(),
  updateSettings: vi.fn(),
  fetchModelsFromProvider: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: any) => ({
    ...config,
    id: '/settings/providers/$providerName',
  }),
  useParams: () => ({ providerName: h.providerName }),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))

vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: () => ({
    getProviderByName: () => h.provider,
    updateProvider: h.updateProvider,
  }),
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    providers: () => ({
      updateSettings: h.updateSettings,
      fetchModelsFromProvider: h.fetchModelsFromProvider,
    }),
  }),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/containers/HeaderPage', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock('@/containers/SettingsMenu', () => ({ default: () => null }))
vi.mock('@/containers/Card', () => ({
  Card: ({ title, header, children }: any) => (
    <section>
      {title && <h2>{title}</h2>}
      {header}
      {children}
    </section>
  ),
  CardItem: ({ title, description, actions }: any) => (
    <div>
      <span>{title}</span>
      {description}
      {actions}
    </div>
  ),
}))
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, asChild: _asChild, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}))
vi.mock('@/components/ui/switch', () => ({
  Switch: ({
    checked,
    onCheckedChange,
    ...props
  }: {
    checked: boolean
    onCheckedChange?: (checked: boolean) => void
  }) => (
    <input
      type="checkbox"
      checked={checked}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
      {...props}
    />
  ),
}))
vi.mock('@/components/ui/textarea', () => ({
  Textarea: (props: any) => <textarea {...props} />,
}))
vi.mock('@/containers/RenderMarkdown', () => ({
  RenderMarkdown: ({ content }: { content?: string }) => <span>{content}</span>,
}))
vi.mock('@/containers/dynamicControllerSetting', () => ({
  DynamicControllerSetting: () => <span data-testid="remote-setting" />,
}))
vi.mock('@/components/ProviderBalanceCard', () => ({
  ProviderBalanceCard: () => null,
}))
vi.mock('@/components/ProviderQuotaActions', () => ({
  ProviderQuotaActions: () => null,
}))
vi.mock('@/containers/Capabilities', () => ({ default: () => null }))
vi.mock('@/containers/dialogs/AddModel', () => ({ DialogAddModel: () => null }))
vi.mock('@/containers/dialogs/DeleteModel', () => ({
  DialogDeleteModel: () => null,
}))
vi.mock('@/containers/dialogs/EditModel', () => ({ DialogEditModel: () => null }))
vi.mock('@/containers/dialogs/DeleteProvider', () => ({ default: () => null }))
vi.mock('@/containers/FavoriteModelAction', () => ({
  FavoriteModelAction: () => null,
}))

import { Route } from '../$providerName'

const renderRoute = () => {
  const Component = Route.component as React.ComponentType
  return render(<Component />)
}

describe('remote-only provider settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.providerName = 'remote'
    h.provider = {
      provider: 'remote',
      active: true,
      api_key: '',
      base_url: 'https://api.example.com/v1',
      models: [{ id: 'chat-1', name: 'Chat 1', capabilities: ['tools'] }],
      settings: [
        {
          key: 'base-url',
          title: 'Remote base URL',
          description: 'Remote endpoint',
          controller_type: 'input',
          controller_props: { value: 'https://api.example.com/v1' },
        },
        {
          key: 'n_gpu_layers',
          title: 'GPU layers',
          description: 'Retired runtime setting',
          controller_type: 'input',
          controller_props: { value: 0, type: 'number' },
        },
      ],
    } as ModelProvider
  })

  it('shows a retired explanation instead of loading a local provider', () => {
    h.providerName = 'llamacpp'
    h.provider = undefined

    renderRoute()

    expect(screen.getByText('Local runtime retired')).toBeVisible()
    expect(screen.getByText(/must select a configured remote provider/)).toBeVisible()
    expect(h.updateProvider).not.toHaveBeenCalled()
  })

  it('renders remote settings while filtering runtime-only controls', () => {
    const { container } = renderRoute()

    const enableSwitch = screen.getByRole('checkbox', {
      name: 'Enable Remote',
    })
    const enableLabel = screen.getByText('Enable')
    const baseUrlLabel = screen.getByText('Remote base URL')

    expect(container.firstElementChild).toHaveClass(
      'h-svh',
      'max-h-svh',
      'overflow-hidden'
    )
    expect(container.querySelector('.overflow-y-auto')).toHaveClass(
      'min-h-0',
      'flex-1'
    )
    expect(screen.getByText('Enable')).toBeVisible()
    expect(enableSwitch).toBeChecked()
    expect(baseUrlLabel).toBeVisible()
    expect(
      enableLabel.compareDocumentPosition(baseUrlLabel) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(screen.getByText('Remote endpoint')).toBeVisible()
    expect(screen.queryByText('GPU layers')).not.toBeInTheDocument()
    expect(screen.getByText('chat-1')).toBeVisible()
  })

  it('updates the provider from the labeled enable control', () => {
    renderRoute()

    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'Enable Remote',
      })
    )

    expect(h.updateProvider).toHaveBeenCalledWith('remote', {
      active: false,
    })
  })
})
