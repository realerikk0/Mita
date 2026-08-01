import {
  ChevronRight,
  FolderEditIcon,
  FolderIcon,
  FolderOpenIcon,
  ImagePlus,
  MessageCircle,
  MoreHorizontal,
  Trash2,
  UsersRound,
  Video,
  type LucideIcon,
} from "lucide-react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { useThreadManagement } from "@/hooks/useThreadManagement"
import { Link, useNavigate, useRouterState } from "@tanstack/react-router"


import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useTranslation } from '@/i18n/react-i18next-compat'
import type { ThreadFolder } from "@/services/projects/types"
import AddProjectDialog from "@/containers/dialogs/AddProjectDialog"
import { DeleteProjectDialog } from "@/containers/dialogs/DeleteProjectDialog"
import { useThreads } from "@/hooks/useThreads"
import { useServiceHub } from "@/hooks/useServiceHub"
import { useImageGenerationStore } from "@/stores/image-generation-store"
import type { ImageAssetRecord } from "@/services/image-generation/types"
import type { VideoAssetRecord } from "@/services/video-generation/types"
import { route } from "@/constants/routes"
import { cn } from "@/lib/utils"
import { ThreadProjectMenuItems } from "@/containers/ThreadProjectMenuItems"
import { MediaProjectMenuItems } from "@/containers/MediaProjectMenuItems"
import { isBiyanTeamsThread } from '@/types/biyan-teams'
import { useProjectDialog } from '@/hooks/useProjectDialog'

type ProjectChildEntry =
  | {
      id: string
      kind: 'chat' | 'team'
      thread: Thread
      title: string
      updatedAt: number
      icon: LucideIcon
      to: '/threads/$threadId'
      params: { threadId: string }
    }
  | {
      id: string
      kind: 'media'
      mediaType: 'image' | 'video'
      asset: ImageAssetRecord | VideoAssetRecord
      title: string
      updatedAt: number
      icon: LucideIcon
      to: '/images'
      search: {
        media?: 'image' | 'storyboard'
        assetId?: string
        videoId?: string
      }
    }

function timestampFromIso(value?: string) {
  if (!value) return 0
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : 0
}

function mediaTitle(
  asset: Pick<ImageAssetRecord | VideoAssetRecord, 'prompt'>,
  fallback: string
) {
  const firstLine = asset.prompt?.split('\n').find((line) => line.trim())
  return firstLine?.trim() || fallback
}

function searchParamValue(search: unknown, key: string) {
  if (!search) return undefined
  if (typeof search === 'string') {
    return new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
      .get(key) ?? undefined
  }
  if (search instanceof URLSearchParams) {
    return search.get(key) ?? undefined
  }
  if (typeof search !== 'object') return undefined

  const value = (search as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

function childEntryIsActive(
  entry: ProjectChildEntry,
  pathname: string,
  search: unknown
) {
  if (entry.kind !== 'media') {
    return pathname === `/threads/${entry.id}`
  }

  if (pathname !== route.images) return false
  if (entry.mediaType === 'image') {
    return searchParamValue(search, 'assetId') === entry.id
  }
  return searchParamValue(search, 'videoId') === entry.id
}

function ProjectChildLink({
  entry,
  active,
}: {
  entry: ProjectChildEntry
  active: boolean
}) {
  const Icon = entry.icon
  const content = (
    <>
      <Icon className="size-3.5 shrink-0 text-foreground/65" />
      <span className="min-w-0 flex-1 truncate" title={entry.title}>
        {entry.title}
      </span>
    </>
  )

  const className = cn(
    'flex h-7 min-w-0 items-center gap-2 rounded-md py-1 pl-7 pr-7 text-xs text-muted-foreground hover:bg-sidebar-foreground/8 hover:text-foreground',
    active && 'bg-sidebar-accent text-sidebar-accent-foreground'
  )

  return entry.kind === 'media' ? (
    <Link to={entry.to} search={entry.search} className={className}>
      {content}
    </Link>
  ) : (
    <Link to={entry.to} params={entry.params} className={className}>
      {content}
    </Link>
  )
}

function ProjectChildItem({
  entry,
  active,
  currentProjectId,
  folders,
  getFolderById,
  onMediaUpdated,
}: {
  entry: ProjectChildEntry
  active: boolean
  currentProjectId: string
  folders: ThreadFolder[]
  getFolderById: (id: string) => ThreadFolder | undefined
  onMediaUpdated: (asset: ImageAssetRecord | VideoAssetRecord) => void
}) {
  return (
    <div className="group/project-child relative">
      <ProjectChildLink entry={entry} active={active} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="absolute right-1 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground opacity-0 hover:bg-sidebar-foreground/8 group-hover/project-child:opacity-100"
          >
            <MoreHorizontal className="size-3.5" />
            <span className="sr-only">More</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-44" side="right" align="start">
          {entry.kind === 'media' ? (
            <MediaProjectMenuItems
              asset={entry.asset}
              mediaType={entry.mediaType}
              folders={folders}
              getFolderById={getFolderById}
              currentProjectId={currentProjectId}
              onAssetUpdated={onMediaUpdated}
            />
          ) : (
            <ThreadProjectMenuItems
              thread={entry.thread}
              folders={folders}
              getFolderById={getFolderById}
              currentProjectId={currentProjectId}
            />
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function EmptyProjectChildren({ children }: { children: ReactNode }) {
  return (
    <div className="px-7 py-1 text-xs text-muted-foreground/70">
      {children}
    </div>
  )
}

function ProjectItem({
  item,
  isMobile,
  onEdit,
  onDelete,
  entries,
  open,
  onToggleOpen,
  folders,
  getFolderById,
  pathname,
  search,
  onMediaUpdated,
}: {
  item: ThreadFolder
  isMobile: boolean
  onEdit: (project: ThreadFolder) => void
  onDelete: (project: ThreadFolder) => void
  entries: ProjectChildEntry[]
  open: boolean
  onToggleOpen: (projectId: string) => void
  folders: ThreadFolder[]
  getFolderById: (id: string) => ThreadFolder | undefined
  pathname: string
  search: unknown
  onMediaUpdated: (asset: ImageAssetRecord | VideoAssetRecord) => void
}) {

  const navigate = useNavigate()
  const { t } = useTranslation()
  const isActive = pathname === `/project/${item.id}`

  return (
    <SidebarMenuItem>
      <div className="flex items-center gap-1 pr-6">
        <SidebarMenuButton
          asChild
          isActive={isActive}
          className="min-w-0 flex-1 pr-2! group-has-data-[sidebar=menu-action]/menu-item:pr-2!"
        >
          <Link
            to="/project/$projectId"
            params={{ projectId: item.id }}
          >
            <FolderIcon className="shrink-0 text-foreground/70" size={16} />
            <span className="truncate">{item.name}</span>
          </Link>
        </SidebarMenuButton>
        <button
          type="button"
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-sidebar-foreground/8 hover:text-foreground group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100",
            (open || isActive) && "opacity-100"
          )}
          onClick={() => onToggleOpen(item.id)}
          aria-expanded={open}
        >
          <ChevronRight
            className={cn('size-3.5 transition-transform', open && 'rotate-90')}
          />
          <span className="sr-only">{open ? t('common:projects.collapseProject') : t('common:projects.expandProject')}</span>
        </button>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction showOnHover className="hover:bg-sidebar-foreground/8">
            <MoreHorizontal />
            <span className="sr-only">More</span>
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="w-48"
          side={isMobile ? "bottom" : "right"}
          align={isMobile ? "end" : "start"}
        >
          <DropdownMenuItem onSelect={() => {
            navigate({ to: '/project/$projectId', params: { projectId: item.id } })
          }}>
            <FolderOpenIcon className="text-muted-foreground" />
            <span>View Project</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onEdit(item)}>
            <FolderEditIcon className="text-muted-foreground" />
            <span>Edit Project</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => onDelete(item)}>
            <Trash2 />
            <span>Delete Project</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {open && (
        <div className="mt-1 space-y-0.5">
          {entries.length === 0 ? (
            <EmptyProjectChildren>{t('common:noThreadsYet')}</EmptyProjectChildren>
          ) : (
            entries.map((entry) => (
              <ProjectChildItem
                key={`${entry.kind}-${entry.id}`}
                entry={entry}
                active={childEntryIsActive(entry, pathname, search)}
                currentProjectId={item.id}
                folders={folders}
                getFolderById={getFolderById}
                onMediaUpdated={onMediaUpdated}
              />
            ))
          )}
        </div>
      )}
    </SidebarMenuItem>
  )
}

export function NavProjects() {
  const { t } = useTranslation()
  const { isMobile } = useSidebar()
  const navigate = useNavigate()
  const serviceHub = useServiceHub()
  const { folders, addFolder, updateFolder, getFolderById } =
    useThreadManagement()
  const threads = useThreads((state) => state.threads)
  const imageAssets = useImageGenerationStore((state) => state.assets)
  const setImageAssets = useImageGenerationStore((state) => state.setAssets)
  const upsertImageAsset = useImageGenerationStore((state) => state.upsertAsset)
  const location = useRouterState({
    select: (state) => state.location,
  })

  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [selectedProject, setSelectedProject] = useState<ThreadFolder | null>(null)
  const [openProjects, setOpenProjects] = useState<Record<string, boolean>>({})
  const [videoAssets, setVideoAssets] = useState<VideoAssetRecord[]>([])
  const createDialogOpen = useProjectDialog((state) => state.open)
  const setCreateDialogOpen = useProjectDialog((state) => state.setOpen)

  useEffect(() => {
    const activeProjectId = location.pathname.match(/^\/project\/([^/]+)/)?.[1]
    if (!activeProjectId) return
    setOpenProjects((current) =>
      current[activeProjectId] ? current : { ...current, [activeProjectId]: true }
    )
  }, [location.pathname])

  useEffect(() => {
    let mounted = true

    const refreshMediaAssets = () => {
      void serviceHub
        .imageGeneration()
        .listAssets()
        .then((assets) => {
          if (mounted) setImageAssets(assets)
        })
        .catch((error) => {
          console.error('Failed to load project image history:', error)
        })

      void serviceHub
        .videoGeneration()
        .listVideoAssets()
        .then((assets) => {
          if (mounted) setVideoAssets(assets)
        })
        .catch((error) => {
          console.error('Failed to load project video history:', error)
        })
    }

    refreshMediaAssets()
    window.addEventListener('biyan-media-history-updated', refreshMediaAssets)
    return () => {
      mounted = false
      window.removeEventListener(
        'biyan-media-history-updated',
        refreshMediaAssets
      )
    }
  }, [serviceHub, setImageAssets])

  const entriesByProjectId = useMemo(() => {
    const result = new Map<string, ProjectChildEntry[]>()
    folders.forEach((folder) => result.set(folder.id, []))

    Object.values(threads).forEach((thread) => {
      const projectId = thread.metadata?.project?.id
      const entries = projectId ? result.get(projectId) : undefined
      if (!entries) return

      const team = isBiyanTeamsThread(thread)
      entries.push({
        id: thread.id,
        kind: team ? 'team' : 'chat',
        thread,
        title: thread.title || t('common:newThread'),
        updatedAt: (thread.updated || 0) * 1000,
        icon: team ? UsersRound : MessageCircle,
        to: '/threads/$threadId',
        params: { threadId: thread.id },
      })
    })

    imageAssets.forEach((asset) => {
      if (asset.assetKind === 'reference') return
      const projectId = asset.project?.id
      const entries = projectId ? result.get(projectId) : undefined
      if (!entries) return

      entries.push({
        id: asset.id,
        kind: 'media',
        mediaType: 'image',
        asset,
        title: mediaTitle(asset, t('common:newMedia')),
        updatedAt: timestampFromIso(asset.createdAt),
        icon: ImagePlus,
        to: route.images as '/images',
        search: {
          media: 'image',
          assetId: asset.id,
        },
      })
    })

    videoAssets.forEach((asset) => {
      const projectId = asset.project?.id
      const entries = projectId ? result.get(projectId) : undefined
      if (!entries) return

      entries.push({
        id: asset.id,
        kind: 'media',
        mediaType: 'video',
        asset,
        title: mediaTitle(asset, t('common:imageGeneration.mode.storyboardVideo')),
        updatedAt: timestampFromIso(asset.createdAt),
        icon: Video,
        to: route.images as '/images',
        search: {
          media: 'storyboard',
          videoId: asset.id,
        },
      })
    })

    result.forEach((entries) => {
      entries.sort((a, b) => b.updatedAt - a.updatedAt)
    })

    return result
  }, [folders, imageAssets, t, threads, videoAssets])

  const handleEdit = (project: ThreadFolder) => {
    setSelectedProject(project)
    setEditDialogOpen(true)
  }

  const handleCreate = async (name: string, assistantId?: string) => {
    const project = await addFolder(name, assistantId)
    setCreateDialogOpen(false)
    navigate({
      to: '/project/$projectId',
      params: { projectId: project.id },
    })
  }

  const handleDelete = (project: ThreadFolder) => {
    setSelectedProject(project)
    setDeleteDialogOpen(true)
  }

  const handleSaveEdit = async (name: string, assistantId?: string) => {
    if (selectedProject) {
      await updateFolder(selectedProject.id, name, assistantId)
      setEditDialogOpen(false)
      setSelectedProject(null)
    }
  }

  const toggleProjectOpen = (projectId: string) => {
    setOpenProjects((current) => ({
      ...current,
      [projectId]: !current[projectId],
    }))
  }

  const updateMediaAsset = (asset: ImageAssetRecord | VideoAssetRecord) => {
    if ('resolution' in asset) {
      setVideoAssets((current) =>
        current.map((item) => item.id === asset.id ? asset : item)
      )
      return
    }

    upsertImageAsset(asset)
  }

  return (
    <>
      {folders.length > 0 && (
        <SidebarMenu>
          {folders.map((item) => (
            <ProjectItem
              key={item.id}
              item={item}
              isMobile={isMobile}
              onEdit={handleEdit}
              onDelete={handleDelete}
              entries={entriesByProjectId.get(item.id) ?? []}
              open={Boolean(openProjects[item.id])}
              onToggleOpen={toggleProjectOpen}
              folders={folders}
              getFolderById={getFolderById}
              pathname={location.pathname}
              search={location.search}
              onMediaUpdated={updateMediaAsset}
            />
          ))}
        </SidebarMenu>
      )}

      <AddProjectDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        editingKey={null}
        onSave={handleCreate}
      />

      <AddProjectDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        editingKey={selectedProject?.id ?? null}
        initialData={selectedProject ?? undefined}
        onSave={handleSaveEdit}
      />

      <DeleteProjectDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        projectId={selectedProject?.id}
        projectName={selectedProject?.name}
      />
    </>
  )
}
