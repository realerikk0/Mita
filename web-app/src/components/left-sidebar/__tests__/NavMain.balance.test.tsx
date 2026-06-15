import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { NavMain } from '../NavMain'
import { useProviderBalance } from '@/hooks/useProviderBalance'

const mockNavigate = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useNavigate: () => mockNavigate,
  useRouterState: ({ select }: { select: (state: any) => string }) =>
    select({ location: { pathname: '/threads/thread-1' } }),
}))

vi.mock('@/components/ui/sidebar', () => ({
  SidebarMenu: ({ children }: { children: React.ReactNode }) => <ul>{children}</ul>,
  SidebarMenuItem: ({ children }: { children: React.ReactNode }) => <li>{children}</li>,
  SidebarMenuButton: ({
    children,
    asChild,
    onClick,
  }: {
    children: React.ReactNode
    asChild?: boolean
    onClick?: () => void
  }) =>
    asChild ? (
      <>{children}</>
    ) : (
      <button type="button" onClick={onClick}>
        {children}
      </button>
    ),
}))

vi.mock('@/components/ui/kbd', () => ({
  Kbd: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  KbdGroup: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'common:providerBalance.badgeLabel': '余额',
        'common:providerBalance.quotaPoints': '额度点',
      }
      return translations[key] ?? key
    },
  }),
}))

vi.mock('@/containers/PlatformMetaKey', () => ({
  PlatformMetaKey: () => <span>⌘</span>,
}))

vi.mock('@/components/animated-icon/search', () => ({
  SearchIcon: () => <span data-testid="search-icon" />,
}))
vi.mock('@/components/animated-icon/folder-plus', () => ({
  FolderPlusIcon: () => <span data-testid="folder-icon" />,
}))
vi.mock('@/components/animated-icon/message-circle', () => ({
  MessageCircleIcon: () => <span data-testid="message-icon" />,
}))
vi.mock('@/components/animated-icon/settings', () => ({
  SettingsIcon: () => <span data-testid="settings-icon" />,
}))
vi.mock('../../animated-icon/blocks', () => ({
  BlocksIcon: () => <span data-testid="blocks-icon" />,
}))
vi.mock('@/components/animated-icon/bot', () => ({
  BotIcon: () => <span data-testid="bot-icon" />,
}))

vi.mock('@/containers/dialogs/AddProjectDialog', () => ({
  default: () => null,
}))
vi.mock('@/containers/dialogs/SearchDialog', () => ({
  SearchDialog: () => null,
}))

vi.mock('@/hooks/useThreadManagement', () => ({
  useThreadManagement: () => ({ addFolder: vi.fn() }),
}))
vi.mock('@/hooks/useSearchDialog', () => ({
  useSearchDialog: () => ({ open: false, setOpen: vi.fn() }),
}))
vi.mock('@/hooks/useProjectDialog', () => ({
  useProjectDialog: () => ({ open: false, setOpen: vi.fn() }),
}))
vi.mock('@/lib/new-chat', () => ({
  startNewAgentChat: vi.fn(),
  startNewChat: vi.fn(),
  startNewMitaTeams: vi.fn(),
}))
vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: () => ({
    selectedProvider: 'jingxing',
    getProviderByName: () => ({
      provider: 'jingxing',
      active: true,
      api_key: 'test-key',
      models: [],
    }),
  }),
}))
vi.mock('@/hooks/useProviderBalance', () => ({
  useProviderBalance: vi.fn(),
}))

describe('NavMain provider balance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useProviderBalance).mockReturnValue({
      balance: {
        state: 'supported',
        provider: 'jingxing',
        unit: 'quota',
        fetchedAt: 1781260326,
        accountBalance: { available: 38563951 },
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    })
  })

  it('shows the current provider balance on the settings nav item', () => {
    render(<NavMain />)

    const settingsLink = screen.getByRole('link', {
      name: /common:settings/,
    })
    expect(settingsLink).toHaveTextContent('余额 38,563,951 额度点')
  })
})
