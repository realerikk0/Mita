import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

// ---- Module mocks ----------------------------------------------------------

const hoisted = vi.hoisted(() => ({
  providersMock: {
    addProvider: vi.fn(),
    getProviderByName: vi.fn(() => undefined),
    selectModelProvider: vi.fn(),
    updateProvider: vi.fn(),
  },
  fetchModelsFromProviderMock: vi.fn(),
  navigateMock: vi.fn(),
  toastMock: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
  },
}))

vi.mock('sonner', () => ({ toast: hoisted.toastMock }))

vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: () => hoisted.providersMock,
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    providers: () => ({
      fetchModelsFromProvider: hoisted.fetchModelsFromProviderMock,
    }),
  }),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: any) => opts?.defaultValue ?? k,
  }),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => hoisted.navigateMock,
}))

vi.mock('@/constants/localStorage', () => ({
  localStorageKey: {
    setupCompleted: 'sc',
    lastUsedModel: 'lum',
  },
}))

vi.mock('@/constants/routes', () => ({
  route: { home: '/' },
}))

vi.mock('@/constants/providers', () => ({
  predefinedProviders: [
    {
      provider: 'jingxing',
      active: true,
      api_key: '',
      base_url: 'https://api.jingxing.uk/v1',
      models: [],
      settings: [
        {
          key: 'api-key',
          controller_props: { value: '' },
        },
        {
          key: 'base-url',
          controller_props: { value: 'https://api.jingxing.uk/v1' },
        },
      ],
    },
  ],
}))

vi.mock('@/containers/HeaderPage', () => ({
  default: () => <header data-testid="header-page" />,
}))
vi.mock('../HeaderPage', () => ({
  default: () => <header data-testid="header-page" />,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled, ...rest }: any) => (
    <button onClick={onClick} disabled={disabled} {...rest}>
      {children}
    </button>
  ),
}))

import SetupScreen from '../SetupScreen'

describe('SetupScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.providersMock.getProviderByName.mockReturnValue(undefined)
    hoisted.fetchModelsFromProviderMock.mockResolvedValue([
      'gpt-4.1-mini',
      'claude-sonnet-4',
    ])
    localStorage.clear()
  })

  it('renders the Silence Jingxing setup form', () => {
    render(<SetupScreen />)
    expect(screen.getByText('Silence')).toBeInTheDocument()
    expect(
      screen.getByText('安安静静地完成主人交代的工作')
    ).toBeInTheDocument()
    expect(screen.getByText('Jingxing API Token')).toBeInTheDocument()
    expect(screen.getByText('Connect Jingxing')).toBeInTheDocument()
  })

  it('renders the header page component', () => {
    render(<SetupScreen />)
    expect(screen.getByTestId('header-page')).toBeInTheDocument()
  })

  it('shows an error when connecting without a token', () => {
    render(<SetupScreen />)
    fireEvent.click(screen.getByText('Connect Jingxing'))
    expect(hoisted.toastMock.error).toHaveBeenCalledWith(
      'Add your Jingxing API token first'
    )
  })

  it('loads models, adds the Jingxing provider, selects the first model, and navigates home', async () => {
    render(<SetupScreen />)
    fireEvent.change(screen.getByPlaceholderText('sk-...'), {
      target: { value: 'sk-test' },
    })
    fireEvent.click(screen.getByText('Connect Jingxing'))

    await waitFor(() =>
      expect(hoisted.fetchModelsFromProviderMock).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'jingxing',
          api_key: 'sk-test',
          base_url: 'https://api.jingxing.uk/v1',
        })
      )
    )
    expect(hoisted.providersMock.addProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'jingxing',
        models: expect.arrayContaining([
          expect.objectContaining({
            id: 'gpt-4.1-mini',
            provider: 'jingxing',
          }),
        ]),
      })
    )
    expect(hoisted.providersMock.selectModelProvider).toHaveBeenCalledWith(
      'jingxing',
      'gpt-4.1-mini'
    )
    expect(hoisted.toastMock.success).toHaveBeenCalledWith('Jingxing is ready', {
      description: '2 models loaded',
    })
    expect(hoisted.navigateMock).toHaveBeenCalledWith({ to: '/' })
  })

  it('updates an existing Jingxing provider', async () => {
    hoisted.providersMock.getProviderByName.mockReturnValue({
      provider: 'jingxing',
      active: true,
      api_key: '',
      base_url: 'https://api.jingxing.uk/v1',
      models: [],
      settings: [
        { key: 'api-key', controller_props: { value: '' } },
        {
          key: 'base-url',
          controller_props: { value: 'https://api.jingxing.uk/v1' },
        },
      ],
    })

    render(<SetupScreen />)
    fireEvent.change(screen.getByPlaceholderText('sk-...'), {
      target: { value: 'sk-existing' },
    })
    fireEvent.click(screen.getByText('Connect Jingxing'))

    await waitFor(() =>
      expect(hoisted.providersMock.updateProvider).toHaveBeenCalledWith(
        'jingxing',
        expect.objectContaining({ api_key: 'sk-existing' })
      )
    )
    expect(hoisted.providersMock.addProvider).not.toHaveBeenCalled()
  })

  it('shows a clear error when model loading fails', async () => {
    hoisted.fetchModelsFromProviderMock.mockRejectedValueOnce(
      new Error('Unauthorized')
    )

    render(<SetupScreen />)
    fireEvent.change(screen.getByPlaceholderText('sk-...'), {
      target: { value: 'bad-token' },
    })
    fireEvent.click(screen.getByText('Connect Jingxing'))

    await waitFor(() =>
      expect(hoisted.toastMock.error).toHaveBeenCalledWith(
        'Failed to connect Jingxing',
        { description: 'Unauthorized' }
      )
    )
  })
})
