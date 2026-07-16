import type { PropsWithChildren } from 'react'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  currentLanguage: 'en',
}))

vi.mock('../NavChats', () => ({
  NavChats: () => <div data-testid="nav-chats" />,
}))

vi.mock('../NavMain', () => ({
  NavMain: () => <div data-testid="nav-main" />,
}))

vi.mock('../NavProjects', () => ({
  NavProjects: () => <div data-testid="nav-projects" />,
}))

vi.mock('@/components/ui/sidebar', () => ({
  Sidebar: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SidebarContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SidebarHeader: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SidebarTrigger: () => <button type="button">Toggle sidebar</button>,
  SidebarRail: () => null,
}))

vi.mock('@/hooks/useGeneralSetting', () => ({
  useGeneralSetting: (
    selector: (state: { currentLanguage: string }) => unknown
  ) => selector({ currentLanguage: h.currentLanguage }),
}))

import { LeftSidebar } from '..'

describe('LeftSidebar app name', () => {
  beforeEach(() => {
    h.currentLanguage = 'en'
  })

  it('shows the Chinese app name in Simplified Chinese', () => {
    h.currentLanguage = 'zh-CN'
    render(<LeftSidebar />)

    expect(screen.getByText('彼岩')).toBeInTheDocument()
    expect(screen.queryByText('Biyan')).not.toBeInTheDocument()
  })

  it('keeps the default app name for other languages', () => {
    render(<LeftSidebar />)

    expect(screen.getByText('Biyan')).toBeInTheDocument()
  })
})
