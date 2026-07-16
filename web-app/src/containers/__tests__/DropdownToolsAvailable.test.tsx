import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import DropdownToolsAvailable from '../DropdownToolsAvailable'
import { useAppState } from '@/hooks/useAppState'
import { useThreads } from '@/hooks/useThreads'
import { useToolAvailable } from '@/hooks/useToolAvailable'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/components/ui/dropdrawer', () => ({
  DropDrawer: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropDrawerTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  DropDrawerContent: ({
    children,
    onClick,
  }: {
    children: React.ReactNode
    onClick?: React.MouseEventHandler<HTMLDivElement>
  }) => <div onClick={onClick}>{children}</div>,
  DropDrawerItem: ({
    children,
    disabled,
    icon,
    onClick,
    onSelect,
  }: {
    children: React.ReactNode
    disabled?: boolean
    icon?: React.ReactNode
    onClick?: React.MouseEventHandler<HTMLDivElement>
    onSelect?: (event: Event) => void
  }) => (
    <div
      aria-disabled={disabled}
      role="button"
      tabIndex={disabled ? -1 : 0}
      onClick={(event) => {
        if (disabled) return
        onClick?.(event)
        onSelect?.(event.nativeEvent)
      }}
    >
      {children}
      {icon}
    </div>
  ),
  DropDrawerSub: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropDrawerSubTrigger: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropDrawerSubContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropDrawerLabel: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropDrawerSeparator: () => <hr />,
  DropDrawerGroup: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))

const computerAgentTools = [
  {
    server: 'biyan-computer-agent',
    name: 'computer_agent_read_text_file',
    description: 'Read a UTF-8 text file',
    inputSchema: {},
  },
  {
    server: 'biyan-computer-agent',
    name: 'computer_agent_create_directory',
    description: 'Create a directory',
    inputSchema: {},
  },
]

describe('DropdownToolsAvailable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAppState.setState({ tools: computerAgentTools })
    useThreads.setState({
      currentThreadId: undefined,
      threads: {},
    })
    useToolAvailable.setState({
      disabledTools: {},
      defaultDisabledTools: computerAgentTools.map(
        (tool) => `${tool.server}::${tool.name}`
      ),
      defaultsInitialized: true,
    })
  })

  it('enables all tools in a server when the All Tools row is clicked for a new chat', async () => {
    const user = userEvent.setup()

    render(
      <DropdownToolsAvailable initialMessage>
        {(_isOpen, toolsCount) => (
          <button type="button">Tools {toolsCount}</button>
        )}
      </DropdownToolsAvailable>
    )

    expect(screen.getByRole('button', { name: 'Tools 0' })).toBeInTheDocument()

    await user.click(screen.getByText('All Tools'))

    expect(useToolAvailable.getState().defaultDisabledTools).toEqual([])
    expect(screen.getByRole('button', { name: 'Tools 2' })).toBeInTheDocument()
  })
})
