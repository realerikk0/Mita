import { render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useImageGenerationStore } from '@/stores/image-generation-store'
import { NavChats } from '../NavChats'

const h = vi.hoisted(() => ({
  threads: [] as Thread[],
  imageAssets: [] as any[],
  videoAssets: [] as any[],
  deleteAllThreads: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, params, search }: any) => {
    const resolvedPath =
      to === '/threads/$threadId' && params?.threadId
        ? `/threads/${params.threadId}`
        : to
    const query = search
      ? `?${new URLSearchParams(search).toString()}`
      : ''
    return <a href={`${resolvedPath}${query}`}>{children}</a>
  },
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'common:history': 'History',
        'common:newMedia': 'New Media',
        'common:newThread': 'New Thread',
        'common:imageGeneration.mode.storyboardVideo': 'Storyboard video',
      })[key] ?? key,
  }),
}))

vi.mock('@/hooks/useThreads', () => ({
  useThreads: (selector: any) =>
    selector({
      getFilteredThreads: () => h.threads,
      threads: Object.fromEntries(h.threads.map((thread) => [thread.id, thread])),
      deleteAllThreads: h.deleteAllThreads,
    }),
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    imageGeneration: () => ({
      listAssets: vi.fn().mockResolvedValue(h.imageAssets),
    }),
    videoGeneration: () => ({
      listVideoAssets: vi.fn().mockResolvedValue(h.videoAssets),
    }),
  }),
}))

vi.mock('@/components/ui/sidebar', () => ({
  SidebarGroup: ({ children }: any) => <section>{children}</section>,
  SidebarGroupAction: ({ children }: any) => <button>{children}</button>,
  SidebarGroupLabel: ({ children }: any) => <h2>{children}</h2>,
  SidebarMenu: ({ children }: any) => <ul>{children}</ul>,
  SidebarMenuButton: ({ children }: any) => <li>{children}</li>,
  SidebarMenuItem: ({ children }: any) => <>{children}</>,
}))

vi.mock('@/components/ui/dropdown-menu', () => {
  const Passthrough = ({ children }: any) => <>{children}</>
  return {
    DropdownMenu: Passthrough,
    DropdownMenuContent: Passthrough,
    DropdownMenuTrigger: Passthrough,
  }
})

vi.mock('@/containers/dialogs/DeleteAllThreadsDialog', () => ({
  DeleteAllThreadsDialog: () => null,
}))

const makeThread = (overrides: Partial<Thread>): Thread =>
  ({
    id: 'thread-1',
    title: 'Thread',
    updated: Date.parse('2026-06-01T00:00:00Z') / 1000,
    metadata: {},
    ...overrides,
  }) as Thread

describe('NavChats history stream', () => {
  beforeEach(() => {
    h.threads = []
    h.imageAssets = []
    h.videoAssets = []
    h.deleteAllThreads.mockClear()
    useImageGenerationStore.getState().reset()
  })

  it('mixes chats, generated media, and Mita Teams in updated order', async () => {
    h.threads = [
      makeThread({
        id: 'chat-1',
        title: 'Single chat',
        updated: Date.parse('2026-06-01T00:00:00Z') / 1000,
      }),
      makeThread({
        id: 'team-1',
        title: 'Launch group',
        updated: Date.parse('2026-06-04T00:00:00Z') / 1000,
        metadata: { mitaTeams: { enabled: true } },
      }),
    ]
    h.imageAssets = [
      {
        id: 'image-1',
        prompt: 'generated image',
        createdAt: '2026-06-02T00:00:00Z',
        assetKind: 'generated',
      },
    ]
    h.videoAssets = [
      {
        id: 'video-1',
        prompt: 'storyboard video',
        createdAt: '2026-06-03T00:00:00Z',
      },
    ]

    render(<NavChats />)

    await screen.findByText('generated image')
    const links = screen.getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual([
      'Launch group',
      'storyboard video',
      'generated image',
      'Single chat',
    ])
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/threads/team-1',
      '/images?media=storyboard&videoId=video-1',
      '/images?media=image&assetId=image-1',
      '/threads/chat-1',
    ])
    await waitFor(() => {
      const iconShapes = links.map(
        (link) => link.querySelector('svg')?.innerHTML
      )
      expect(new Set(iconShapes).size).toBeGreaterThanOrEqual(3)
    })
  })

  it('keeps reference images out of the sidebar history', async () => {
    h.imageAssets = [
      {
        id: 'reference-1',
        prompt: 'reference image',
        createdAt: '2026-06-02T00:00:00Z',
        assetKind: 'reference',
      },
      {
        id: 'image-1',
        prompt: 'generated image',
        createdAt: '2026-06-03T00:00:00Z',
        assetKind: 'generated',
      },
    ]

    render(<NavChats />)

    expect(await screen.findByText('generated image')).toBeInTheDocument()
    expect(screen.queryByText('reference image')).not.toBeInTheDocument()
  })
})
