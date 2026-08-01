import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useImageGenerationStore } from '@/stores/image-generation-store'
import { NavChats } from '../NavChats'

const h = vi.hoisted(() => ({
  threads: [] as Thread[],
  imageAssets: [] as any[],
  videoAssets: [] as any[],
  deleteAllThreads: vi.fn(),
  deleteThread: vi.fn(),
  deleteAsset: vi.fn(),
  deleteVideoAsset: vi.fn(),
  updateAssetProject: vi.fn(),
  updateVideoAssetProject: vi.fn(),
  renameThread: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  toggleThreadPinned: vi.fn(),
  updateThread: vi.fn(),
  folders: [] as any[],
  location: {
    pathname: '/threads/thread-1',
    search: {},
  } as { pathname: string; search: Record<string, string> },
  setProjectDialogOpen: vi.fn(),
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
  useRouterState: ({ select }: { select: (state: any) => any }) =>
    select({ location: h.location }),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'common:projects.new': 'New Project',
        'common:pinned': 'Pinned',
        'common:pinToTop': 'Pin to top',
        'common:unpin': 'Unpin',
        'common:newMedia': 'New Media',
        'common:newThread': 'New Thread',
        'common:imageGeneration.mode.storyboardVideo': 'Storyboard video',
        'common:imageGeneration.toast.deleteAssetFailed':
          'Failed to delete image asset',
        'common:imageGeneration.toast.deleteVideoAssetFailed':
          'Failed to delete video asset',
        'common:imageGeneration.deleteImageTitle': 'Delete image?',
        'common:imageGeneration.deleteVideoTitle': 'Delete video?',
        'common:imageGeneration.deleteMediaDescription':
          'This will permanently delete this generated media file from disk. This action cannot be undone.',
        'common:recents': 'Recents',
        'common:rename': 'Rename',
        'common:delete': 'Delete',
        'common:projects.addToProject': 'Add to project',
        'common:projects.noProjectsAvailable': 'No projects available',
        'common:projects.removeFromProject': 'Remove from project',
        'common:projects.title': 'Projects',
        'common:toast.threadAssignedToProject.description':
          'Thread assigned to project',
        'common:toast.threadRemovedFromProject.description':
          'Thread removed from project',
      })[key] ?? key,
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    error: h.toastError,
    success: h.toastSuccess,
  },
}))

vi.mock('@/hooks/useThreads', () => ({
  useThreads: (selector: any) =>
    selector({
      getFilteredThreads: () => h.threads,
      threads: Object.fromEntries(h.threads.map((thread) => [thread.id, thread])),
      deleteAllThreads: h.deleteAllThreads,
      deleteThread: h.deleteThread,
      renameThread: h.renameThread,
      toggleThreadPinned: h.toggleThreadPinned,
      updateThread: h.updateThread,
    }),
}))

vi.mock('@/hooks/useThreadManagement', () => ({
  useThreadManagement: () => ({
    folders: h.folders,
    getFolderById: (id: string) =>
      h.folders.find((folder) => folder.id === id),
  }),
}))

vi.mock('@/hooks/useProjectDialog', () => ({
  useProjectDialog: (selector: any) =>
    selector({ open: false, setOpen: h.setProjectDialogOpen }),
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    imageGeneration: () => ({
      listAssets: vi.fn().mockResolvedValue(h.imageAssets),
      deleteAsset: h.deleteAsset,
      updateAssetProject: h.updateAssetProject,
    }),
    videoGeneration: () => ({
      listVideoAssets: vi.fn().mockResolvedValue(h.videoAssets),
      deleteVideoAsset: h.deleteVideoAsset,
      updateVideoAssetProject: h.updateVideoAssetProject,
    }),
  }),
}))

vi.mock('@/components/ui/sidebar', () => ({
  SidebarGroup: ({ children }: any) => <section>{children}</section>,
  SidebarGroupAction: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
  SidebarGroupLabel: ({ children }: any) => <h2>{children}</h2>,
  SidebarMenu: ({ children }: any) => <ul>{children}</ul>,
  SidebarMenuAction: ({ children }: any) => <button>{children}</button>,
  SidebarMenuButton: ({ children, className, isActive }: any) => (
    <li className={className} data-active={isActive ? 'true' : 'false'}>
      {children}
    </li>
  ),
  SidebarMenuItem: ({ children }: any) => <>{children}</>,
}))

vi.mock('@/components/ui/dropdown-menu', () => {
  const Passthrough = ({ children }: any) => <>{children}</>
  return {
    DropdownMenu: Passthrough,
    DropdownMenuContent: Passthrough,
    DropdownMenuItem: ({ children, disabled, onSelect }: any) => (
      <button disabled={disabled} onClick={onSelect}>
        {children}
      </button>
    ),
    DropdownMenuSeparator: () => null,
    DropdownMenuSub: Passthrough,
    DropdownMenuSubContent: Passthrough,
    DropdownMenuSubTrigger: ({ children }: any) => <button>{children}</button>,
    DropdownMenuTrigger: Passthrough,
  }
})

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: any) => (open ? <div>{children}</div> : null),
  DialogClose: ({ children }: any) => <>{children}</>,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogFooter: ({ children }: any) => (
    <footer data-testid="media-delete-dialog-footer">{children}</footer>
  ),
  DialogHeader: ({ children }: any) => (
    <header data-testid="media-delete-dialog-header">{children}</header>
  ),
  DialogTitle: ({ children }: any) => <h3>{children}</h3>,
}))

vi.mock('@/containers/dialogs/DeleteAllThreadsDialog', () => ({
  DeleteAllThreadsDialog: () => null,
}))

vi.mock('@/containers/dialogs', () => ({
  DeleteThreadDialog: () => null,
  RenameThreadDialog: () => null,
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
    h.deleteThread.mockClear()
    h.deleteAsset.mockReset()
    h.deleteAsset.mockResolvedValue(undefined)
    h.deleteVideoAsset.mockReset()
    h.deleteVideoAsset.mockResolvedValue(undefined)
    h.updateAssetProject.mockReset()
    h.updateVideoAssetProject.mockReset()
    h.renameThread.mockClear()
    h.toastError.mockClear()
    h.toastSuccess.mockClear()
    h.toggleThreadPinned.mockClear()
    h.updateThread.mockClear()
    h.setProjectDialogOpen.mockClear()
    h.folders = []
    h.location = {
      pathname: '/threads/thread-1',
      search: {},
    }
    useImageGenerationStore.getState().reset()
  })

  it('shows projects as the section title and opens New Project from the plus button when empty', async () => {
    render(<NavChats projects={<div data-testid="project-list" />} />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Projects' })).toBeVisible()
      expect(screen.getByTestId('project-list')).toBeVisible()
    })

    fireEvent.click(screen.getByRole('button', { name: 'New Project' }))

    await waitFor(() => {
      expect(h.setProjectDialogOpen).toHaveBeenCalledWith(true)
    })
  })

  it('mixes chats, generated media, and Biyan Teams in updated order', async () => {
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
        metadata: { biyanTeams: { enabled: true } },
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

  it('marks the currently opened media history entry as selected', async () => {
    h.location = {
      pathname: '/images',
      search: { media: 'image', assetId: 'image-active' },
    }
    h.imageAssets = [
      {
        id: 'image-active',
        prompt: 'selected generated image',
        createdAt: '2026-06-06T00:00:00Z',
        assetKind: 'generated',
      },
      {
        id: 'image-other',
        prompt: 'other generated image',
        createdAt: '2026-06-05T00:00:00Z',
        assetKind: 'generated',
      },
    ]

    render(<NavChats />)

    const activeRow = (await screen.findByText('selected generated image'))
      .closest('li')
    const inactiveRow = screen.getByText('other generated image').closest('li')
    expect(activeRow).toHaveAttribute('data-active', 'true')
    expect(activeRow?.className).toContain('border-sidebar-primary/45')
    expect(inactiveRow).toHaveAttribute('data-active', 'false')
  })

  it('keeps pinned chats above recent history and toggles pin state from the row menu', async () => {
    h.threads = [
      makeThread({
        id: 'chat-recent',
        title: 'Recent chat',
        updated: Date.parse('2026-06-05T00:00:00Z') / 1000,
      }),
      makeThread({
        id: 'chat-pinned',
        title: 'Pinned chat',
        updated: Date.parse('2026-06-01T00:00:00Z') / 1000,
        metadata: { pinned_at: Date.parse('2026-06-02T00:00:00Z') },
      }),
    ]
    h.imageAssets = [
      {
        id: 'image-newer',
        prompt: 'newer image',
        createdAt: '2026-06-06T00:00:00Z',
        assetKind: 'generated',
      },
    ]

    render(<NavChats />)

    await screen.findByText('Pinned chat')
    const links = screen.getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual([
      'Pinned chat',
      'newer image',
      'Recent chat',
    ])
    expect(screen.getByText('Pinned')).toBeInTheDocument()
    expect(screen.getByText('Recents')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Unpin/i }))
    expect(h.toggleThreadPinned).toHaveBeenCalledWith('chat-pinned')
  })

  it('only offers pinning actions for chat history entries', async () => {
    h.imageAssets = [
      {
        id: 'image-only',
        prompt: 'image only',
        createdAt: '2026-06-06T00:00:00Z',
        assetKind: 'generated',
      },
    ]

    render(<NavChats />)

    expect(await screen.findByText('image only')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Pin to top/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Unpin/i })).not.toBeInTheDocument()
  })

  it('moves a chat history entry into a project from the row menu', async () => {
    h.threads = [
      makeThread({
        id: 'chat-move',
        title: 'Move me',
      }),
    ]
    h.folders = [
      {
        id: 'project-1',
        name: 'Client Work',
        updated_at: Date.parse('2026-06-06T00:00:00Z'),
      },
    ]

    render(<NavChats />)

    expect(await screen.findByText('Move me')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Client Work/i }))

    expect(h.updateThread).toHaveBeenCalledWith('chat-move', {
      metadata: {
        project: {
          id: 'project-1',
          name: 'Client Work',
          updated_at: Date.parse('2026-06-06T00:00:00Z'),
        },
      },
    })
    expect(h.toastSuccess).toHaveBeenCalledWith('Thread assigned to project')
  })

  it('moves a generated image history entry into a project and hides it from general history', async () => {
    const project = {
      id: 'project-1',
      name: 'Client Work',
      updated_at: Date.parse('2026-06-06T00:00:00Z'),
    }
    h.folders = [project]
    h.imageAssets = [
      {
        id: 'image-move',
        prompt: 'move this image',
        createdAt: '2026-06-06T00:00:00Z',
        assetKind: 'generated',
      },
    ]
    h.updateAssetProject.mockImplementation(async (_assetId, nextProject) => {
      h.imageAssets = [
        {
          ...h.imageAssets[0],
          project: nextProject,
        },
      ]
      return h.imageAssets[0]
    })

    render(<NavChats />)

    expect(await screen.findByText('move this image')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Client Work/i }))

    await waitFor(() => {
      expect(h.updateAssetProject).toHaveBeenCalledWith('image-move', project)
    })
    await waitFor(() => {
      expect(screen.queryByText('move this image')).not.toBeInTheDocument()
    })
    expect(h.toastSuccess).toHaveBeenCalledWith('Thread assigned to project')
  })

  it('deletes generated image history entries from the sidebar row menu', async () => {
    h.imageAssets = [
      {
        id: 'image-delete',
        prompt: 'delete this image',
        createdAt: '2026-06-06T00:00:00Z',
        assetKind: 'generated',
      },
    ]
    h.deleteAsset.mockImplementation(async () => {
      h.imageAssets = []
    })

    render(<NavChats />)

    expect(await screen.findByText('delete this image')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Delete/i }))

    expect(h.deleteAsset).not.toHaveBeenCalled()
    expect(screen.getByText('Delete image?')).toBeInTheDocument()
    expect(screen.getByTestId('media-delete-dialog-footer').parentElement).not.toBe(
      screen.getByTestId('media-delete-dialog-header')
    )

    fireEvent.click(screen.getByRole('button', { name: 'Delete delete this image' }))

    await waitFor(() => {
      expect(h.deleteAsset).toHaveBeenCalledWith('image-delete')
    })
    await waitFor(() => {
      expect(screen.queryByText('delete this image')).not.toBeInTheDocument()
    })
  })

  it('deletes generated video history entries from the sidebar row menu', async () => {
    h.videoAssets = [
      {
        id: 'video-delete',
        prompt: 'delete this video',
        createdAt: '2026-06-06T00:00:00Z',
      },
    ]
    h.deleteVideoAsset.mockImplementation(async () => {
      h.videoAssets = []
    })

    render(<NavChats />)

    expect(await screen.findByText('delete this video')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Delete/i }))

    expect(h.deleteVideoAsset).not.toHaveBeenCalled()
    expect(screen.getByText('Delete video?')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Delete delete this video' }))

    await waitFor(() => {
      expect(h.deleteVideoAsset).toHaveBeenCalledWith('video-delete')
    })
    await waitFor(() => {
      expect(screen.queryByText('delete this video')).not.toBeInTheDocument()
    })
  })

  it('shows video-specific copy when deleting a video history entry fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.videoAssets = [
      {
        id: 'video-fail',
        prompt: 'video delete fails',
        createdAt: '2026-06-06T00:00:00Z',
      },
    ]
    h.deleteVideoAsset.mockRejectedValue(new Error('nope'))

    try {
      render(<NavChats />)

      expect(await screen.findByText('video delete fails')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: /Delete/i }))

      expect(h.deleteVideoAsset).not.toHaveBeenCalled()

      fireEvent.click(
        screen.getByRole('button', { name: 'Delete video delete fails' })
      )

      await waitFor(() => {
        expect(h.deleteVideoAsset).toHaveBeenCalledWith('video-fail')
      })
      expect(h.toastError).toHaveBeenCalledWith('Failed to delete video asset')
    } finally {
      consoleError.mockRestore()
    }
  })
})
