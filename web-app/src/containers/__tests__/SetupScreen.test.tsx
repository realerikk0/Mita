import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
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
      base_url: 'https://api.biyuan.ai/v1',
      models: [],
      settings: [
        {
          key: 'api-key',
          controller_props: { value: '' },
        },
        {
          key: 'base-url',
          controller_props: { value: 'https://api.biyuan.ai/v1' },
        },
      ],
    },
    {
      provider: 'openai',
      active: true,
      api_key: '',
      base_url: 'https://api.openai.com/v1',
      models: [],
      settings: [
        {
          key: 'api-key',
          controller_props: { value: '' },
        },
        {
          key: 'base-url',
          controller_props: { value: 'https://api.openai.com/v1' },
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

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: any) =>
    open ? <div data-testid="dialog-root">{children}</div> : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
}))

vi.mock('@/components/ui/textarea', () => ({
  Textarea: (props: any) => <textarea {...props} />,
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

  it('renders the Biyan provider setup form with Biyuan selected by default', () => {
    render(<SetupScreen />)
    expect(screen.getByText('彼岩')).toBeInTheDocument()
    expect(
      screen.getByText('安安静静地完成主人交代的工作')
    ).toBeInTheDocument()
    expect(screen.getByText('Model Provider')).toBeInTheDocument()
    expect(screen.getByText('导入')).toBeInTheDocument()
    expect(screen.getByText('彼源 AI API Key')).toBeInTheDocument()
    expect(screen.getByText('Connect 彼源 AI')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /没有彼源 AI 账号？前往注册并充值/i })
    ).toHaveAttribute('href', 'https://api.biyuan.ai/console')
  })

  it('renders the header page component', () => {
    render(<SetupScreen />)
    expect(screen.getByTestId('header-page')).toBeInTheDocument()
  })

  it('shows an error when connecting without a token', () => {
    render(<SetupScreen />)
    fireEvent.click(screen.getByText('Connect 彼源 AI'))
    expect(hoisted.toastMock.error).toHaveBeenCalledWith(
      'Add your 彼源 AI API key first'
    )
  })

  it('imports provider config into the cold start form', async () => {
    render(<SetupScreen />)

    fireEvent.click(screen.getByText('导入'))
    fireEvent.change(screen.getByPlaceholderText('粘贴 AI Provider 配置 JSON'), {
      target: {
        value: JSON.stringify({
          _type: 'ai_provider_connection',
          version: 1,
          provider: 'openai-compatible',
          apiKey: 'sk-imported',
          baseUrl: 'https://api.example.com/v1///',
          headers: {
            Authorization: 'Bearer should-not-apply',
            'X-Custom': 'custom-value',
          },
        }),
      },
    })
    fireEvent.click(
      within(screen.getByTestId('dialog-root')).getByText('导入')
    )

    expect(hoisted.toastMock.success).toHaveBeenCalledWith('配置已导入')
    expect(screen.getByPlaceholderText('sk-...')).toHaveValue('sk-imported')
    expect(screen.getByDisplayValue('https://api.example.com/v1')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Connect 彼源 AI'))
    await waitFor(() =>
      expect(hoisted.fetchModelsFromProviderMock).toHaveBeenCalledWith(
        expect.objectContaining({
          api_key: 'sk-imported',
          base_url: 'https://api.example.com/v1',
          custom_header: [
            {
              header: 'X-Custom',
              value: 'custom-value',
            },
          ],
        })
      )
    )
  })

  it('shows a generic error when cold start import config is invalid', () => {
    render(<SetupScreen />)

    fireEvent.click(screen.getByText('导入'))
    fireEvent.change(screen.getByPlaceholderText('粘贴 AI Provider 配置 JSON'), {
      target: { value: '{bad' },
    })
    fireEvent.click(
      within(screen.getByTestId('dialog-root')).getByText('导入')
    )

    expect(hoisted.toastMock.error).toHaveBeenCalledWith(
      '配置格式不正确',
      expect.objectContaining({ description: '配置格式不正确' })
    )
  })

  it('loads models, adds the Biyuan provider, selects the first model, and navigates home', async () => {
    render(<SetupScreen />)
    fireEvent.change(screen.getByPlaceholderText('sk-...'), {
      target: { value: 'sk-test' },
    })
    fireEvent.click(screen.getByText('Connect 彼源 AI'))

    await waitFor(() =>
      expect(hoisted.fetchModelsFromProviderMock).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'jingxing',
          api_key: 'sk-test',
          base_url: 'https://api.biyuan.ai/v1',
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
    expect(hoisted.toastMock.success).toHaveBeenCalledWith('彼源 AI is ready', {
      description: '2 models loaded',
    })
    expect(hoisted.navigateMock).toHaveBeenCalledWith({ to: '/' })
  })

  it('allows selecting and connecting a non-Biyuan provider', async () => {
    render(<SetupScreen />)
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'openai' },
    })
    expect(
      screen.queryByRole('link', { name: /没有彼源 AI 账号？前往注册并充值/i })
    ).not.toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('sk-...'), {
      target: { value: 'sk-openai' },
    })
    fireEvent.click(screen.getByText('Connect OpenAI'))

    await waitFor(() =>
      expect(hoisted.fetchModelsFromProviderMock).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'openai',
          api_key: 'sk-openai',
          base_url: 'https://api.openai.com/v1',
        })
      )
    )
    expect(hoisted.providersMock.addProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'openai',
        models: expect.arrayContaining([
          expect.objectContaining({
            id: 'gpt-4.1-mini',
            provider: 'openai',
          }),
        ]),
      })
    )
    expect(hoisted.providersMock.selectModelProvider).toHaveBeenCalledWith(
      'openai',
      'gpt-4.1-mini'
    )
    expect(hoisted.toastMock.success).toHaveBeenCalledWith('OpenAI is ready', {
      description: '2 models loaded',
    })
  })

  it('updates an existing Biyuan provider', async () => {
    hoisted.providersMock.getProviderByName.mockReturnValue({
      provider: 'jingxing',
      active: true,
      api_key: '',
      base_url: 'https://api.biyuan.ai/v1',
      models: [],
      settings: [
        { key: 'api-key', controller_props: { value: '' } },
        {
          key: 'base-url',
          controller_props: { value: 'https://api.biyuan.ai/v1' },
        },
      ],
    })

    render(<SetupScreen />)
    fireEvent.change(screen.getByPlaceholderText('sk-...'), {
      target: { value: 'sk-existing' },
    })
    fireEvent.click(screen.getByText('Connect 彼源 AI'))

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
    fireEvent.click(screen.getByText('Connect 彼源 AI'))

    await waitFor(() =>
      expect(hoisted.toastMock.error).toHaveBeenCalledWith(
        'Failed to connect 彼源 AI',
        { description: 'Unauthorized' }
      )
    )
  })
})
