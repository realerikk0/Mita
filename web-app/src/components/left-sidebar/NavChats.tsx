import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  ImagePlus,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Trash2,
  UsersRound,
  Video,
  type LucideIcon,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useThreads } from "@/hooks/useThreads"
import { DeleteAllThreadsDialog } from "@/containers/dialogs/DeleteAllThreadsDialog"
import { useServiceHub } from "@/hooks/useServiceHub"
import { useImageGenerationStore } from "@/stores/image-generation-store"
import type { ImageAssetRecord } from "@/services/image-generation/types"
import type { VideoAssetRecord } from "@/services/video-generation/types"
import { Link, useRouterState } from "@tanstack/react-router"
import { route } from "@/constants/routes"
import { DeleteThreadDialog, RenameThreadDialog } from "@/containers/dialogs"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

type HistoryEntry =
  | {
      id: string
      kind: 'chat' | 'team'
      thread: Thread
      title: string
      updatedAt: number
      pinnedAt: number
      icon: LucideIcon
      to: '/threads/$threadId'
      params: { threadId: string }
    }
  | {
      id: string
      kind: 'media'
      mediaType: 'image' | 'video'
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

type MediaHistoryEntry = Extract<HistoryEntry, { kind: 'media' }>

function timestampFromIso(value?: string) {
  if (!value) return 0
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : 0
}

function isMitaTeamsThread(thread: Thread) {
  return Boolean(thread.metadata?.mitaTeams)
}

function threadPinnedAt(thread: Thread) {
  const pinnedAt = thread.metadata?.pinned_at
  return typeof pinnedAt === 'number' && pinnedAt > 0 ? pinnedAt : 0
}

function mediaTitle(
  asset: Pick<ImageAssetRecord | VideoAssetRecord, 'prompt'>,
  fallback: string
) {
  const firstLine = asset.prompt?.split('\n').find((line) => line.trim())
  return firstLine?.trim() || fallback
}

function isThreadHistoryEntry(
  entry: HistoryEntry
): entry is Extract<HistoryEntry, { kind: 'chat' | 'team' }> {
  return entry.kind === 'chat' || entry.kind === 'team'
}

function isPinnedHistoryEntry(
  entry: HistoryEntry
): entry is Extract<HistoryEntry, { kind: 'chat' | 'team' }> {
  return isThreadHistoryEntry(entry) && entry.pinnedAt > 0
}

function sortHistoryEntries(a: HistoryEntry, b: HistoryEntry) {
  const aPinnedAt = isThreadHistoryEntry(a) ? a.pinnedAt : 0
  const bPinnedAt = isThreadHistoryEntry(b) ? b.pinnedAt : 0
  const aPinned = aPinnedAt > 0
  const bPinned = bPinnedAt > 0

  if (aPinned && bPinned) {
    return bPinnedAt - aPinnedAt || b.updatedAt - a.updatedAt
  }
  if (aPinned) return -1
  if (bPinned) return 1

  return b.updatedAt - a.updatedAt
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

function historyEntryIsActive(
  entry: HistoryEntry,
  pathname: string,
  search: unknown
) {
  if (isThreadHistoryEntry(entry)) {
    return pathname === `/threads/${entry.id}`
  }

  if (pathname !== route.images) return false
  if (entry.mediaType === 'image') {
    return searchParamValue(search, 'assetId') === entry.id
  }
  return searchParamValue(search, 'videoId') === entry.id
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <SidebarMenuItem>
      <div className="px-2 pb-1 pt-2 text-[11px] font-medium text-muted-foreground">
        {children}
      </div>
    </SidebarMenuItem>
  )
}

function HistoryItem({
  entry,
  active,
  onTogglePin,
  onRename,
  onDelete,
  onDeleteMedia,
}: {
  entry: HistoryEntry
  active: boolean
  onTogglePin: (threadId: string) => void
  onRename: (threadId: string, title: string) => void
  onDelete: (threadId: string) => void
  onDeleteMedia: (entry: MediaHistoryEntry) => void
}) {
  const { t } = useTranslation()
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [mediaDeleteOpen, setMediaDeleteOpen] = useState(false)
  const mediaDeleteButtonRef = useRef<HTMLButtonElement>(null)
  const Icon = entry.icon
  const isThreadEntry = isThreadHistoryEntry(entry)
  const isPinned = isPinnedHistoryEntry(entry)
  const mediaEntry = entry.kind === 'media' ? entry : null
  const confirmMediaDelete = () => {
    if (!mediaEntry) return
    void onDeleteMedia(mediaEntry)
    setMediaDeleteOpen(false)
  }
  const content = (
    <>
      <Icon className="size-4 shrink-0 text-foreground/70" />
      <span className="min-w-0 flex-1 truncate" title={entry.title}>
        {entry.title}
      </span>
      {isPinned && (
        <Pin className="size-3 shrink-0 text-muted-foreground" />
      )}
    </>
  )

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={active}
        className={cn(
          'pr-8 border border-transparent',
          active &&
            'border-sidebar-primary/45 bg-sidebar-accent text-sidebar-accent-foreground shadow-sm ring-1 ring-sidebar-primary/25'
        )}
      >
        {entry.kind === 'media' ? (
          <Link to={entry.to} search={entry.search}>
            {content}
          </Link>
        ) : (
          <Link to={entry.to} params={entry.params}>
            {content}
          </Link>
        )}
      </SidebarMenuButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction showOnHover className="hover:bg-sidebar-foreground/8">
            <MoreHorizontal />
            <span className="sr-only">More</span>
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-44" side="right" align="start">
          {isThreadEntry ? (
            <>
              <DropdownMenuItem onSelect={() => onTogglePin(entry.id)}>
                {isPinned ? (
                  <PinOff className="size-4" />
                ) : (
                  <Pin className="size-4" />
                )}
                <span>{isPinned ? t('common:unpin') : t('common:pinToTop')}</span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setRenameOpen(true)}>
                <Pencil className="size-4" />
                <span>{t('common:rename')}</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => setDeleteOpen(true)}
              >
                <Trash2 className="size-4" />
                <span>{t('common:delete')}</span>
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => setMediaDeleteOpen(true)}
            >
              <Trash2 className="size-4" />
              <span>{t('common:delete')}</span>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {isThreadEntry && (
        <>
          <RenameThreadDialog
            thread={entry.thread}
            plainTitleForRename={entry.title}
            onRename={onRename}
            open={renameOpen}
            onOpenChange={setRenameOpen}
            withoutTrigger
          />
          <DeleteThreadDialog
            thread={entry.thread}
            onDelete={onDelete}
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            withoutTrigger
          />
        </>
      )}
      {mediaEntry && (
        <Dialog open={mediaDeleteOpen} onOpenChange={setMediaDeleteOpen}>
          <DialogContent
            onOpenAutoFocus={(event) => {
              event.preventDefault()
              mediaDeleteButtonRef.current?.focus()
            }}
          >
            <DialogHeader>
              <DialogTitle>
                {mediaEntry.mediaType === 'video'
                  ? t('common:imageGeneration.deleteVideoTitle')
                  : t('common:imageGeneration.deleteImageTitle')}
              </DialogTitle>
              <DialogDescription>
                {t('common:imageGeneration.deleteMediaDescription')}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
              <DialogClose asChild>
                <Button variant="ghost" size="sm" className="w-full sm:w-auto">
                  {t('common:cancel')}
                </Button>
              </DialogClose>
              <Button
                ref={mediaDeleteButtonRef}
                variant="destructive"
                onClick={confirmMediaDelete}
                size="sm"
                className="w-full sm:w-auto"
                aria-label={`${t('common:delete')} ${mediaEntry.title}`}
              >
                {t('common:delete')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </SidebarMenuItem>
  )
}

export function NavChats() {
  const { t } = useTranslation()
  const location = useRouterState({
    select: (state) => state.location,
  })
  const serviceHub = useServiceHub()
  const getFilteredThreads = useThreads((state) => state.getFilteredThreads)
  const threads = useThreads((state) => state.threads)
  const deleteAllThreads = useThreads((state) => state.deleteAllThreads)
  const deleteThread = useThreads((state) => state.deleteThread)
  const renameThread = useThreads((state) => state.renameThread)
  const toggleThreadPinned = useThreads((state) => state.toggleThreadPinned)
  const imageAssets = useImageGenerationStore((state) => state.assets)
  const setImageAssets = useImageGenerationStore((state) => state.setAssets)
  const removeImageAsset = useImageGenerationStore((state) => state.removeAsset)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [videoAssets, setVideoAssets] = useState<VideoAssetRecord[]>([])

  const threadsWithoutProject = useMemo(() => {
    return getFilteredThreads('').filter((thread) => !thread.metadata?.project)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getFilteredThreads, threads])

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
          console.error('Failed to load sidebar image history:', error)
        })

      void serviceHub
        .videoGeneration()
        .listVideoAssets()
        .then((assets) => {
          if (mounted) setVideoAssets(assets)
        })
        .catch((error) => {
          console.error('Failed to load sidebar video history:', error)
        })
    }

    refreshMediaAssets()
    window.addEventListener('mita-media-history-updated', refreshMediaAssets)
    return () => {
      mounted = false
      window.removeEventListener(
        'mita-media-history-updated',
        refreshMediaAssets
      )
    }
  }, [serviceHub, setImageAssets])

  const deleteMediaEntry = async (entry: MediaHistoryEntry) => {
    try {
      if (entry.mediaType === 'image') {
        await serviceHub.imageGeneration().deleteAsset(entry.id)
        removeImageAsset(entry.id)
      } else {
        await serviceHub.videoGeneration().deleteVideoAsset(entry.id)
        setVideoAssets((current) =>
          current.filter((asset) => asset.id !== entry.id)
        )
      }
      window.dispatchEvent(new Event('mita-media-history-updated'))
    } catch (error) {
      console.error('Failed to delete media history entry:', error)
      toast.error(
        entry.mediaType === 'video'
          ? t('common:imageGeneration.toast.deleteVideoAssetFailed')
          : t('common:imageGeneration.toast.deleteAssetFailed')
      )
    }
  }

  const historyEntries = useMemo<HistoryEntry[]>(() => {
    const threadEntries: HistoryEntry[] = threadsWithoutProject.map((thread) => {
      const team = isMitaTeamsThread(thread)
      return {
        id: thread.id,
        kind: team ? 'team' : 'chat',
        thread,
        title: thread.title || t('common:newThread'),
        updatedAt: (thread.updated || 0) * 1000,
        pinnedAt: threadPinnedAt(thread),
        icon: team ? UsersRound : MessageCircle,
        to: '/threads/$threadId',
        params: { threadId: thread.id },
      }
    })

    const imageEntries: HistoryEntry[] = imageAssets
      .filter((asset) => asset.assetKind !== 'reference')
      .map((asset) => ({
        id: asset.id,
        kind: 'media',
        mediaType: 'image',
        title: mediaTitle(asset, t('common:newMedia')),
        updatedAt: timestampFromIso(asset.createdAt),
        icon: ImagePlus,
        to: route.images as '/images',
        search: {
          media: 'image',
          assetId: asset.id,
        },
      }))

    const videoEntries: HistoryEntry[] = videoAssets.map((asset) => ({
      id: asset.id,
      kind: 'media',
      mediaType: 'video',
      title: mediaTitle(asset, t('common:imageGeneration.mode.storyboardVideo')),
      updatedAt: timestampFromIso(asset.createdAt),
      icon: Video,
      to: route.images as '/images',
      search: {
        media: 'storyboard',
        videoId: asset.id,
      },
    }))

    return [...threadEntries, ...imageEntries, ...videoEntries].sort(
      sortHistoryEntries
    )
  }, [imageAssets, threadsWithoutProject, t, videoAssets])

  const pinnedEntries = useMemo(
    () => historyEntries.filter(isPinnedHistoryEntry),
    [historyEntries]
  )
  const recentEntries = useMemo(
    () => historyEntries.filter((entry) => !isPinnedHistoryEntry(entry)),
    [historyEntries]
  )

  if (historyEntries.length === 0) {
    return null
  }

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>{t('common:history')}</SidebarGroupLabel>
      {threadsWithoutProject.length > 1 &&
        <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
          <DropdownMenuTrigger asChild>
            <SidebarGroupAction className="hover:bg-sidebar-foreground/8">
              <MoreHorizontal className="text-muted-foreground" />
              <span className="sr-only">More</span>
            </SidebarGroupAction>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start">
            <DeleteAllThreadsDialog
              onDeleteAll={deleteAllThreads}
              onDropdownClose={() => setDropdownOpen(false)}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      }
      <SidebarMenu>
        {pinnedEntries.length > 0 && (
          <>
            <SectionLabel>{t('common:pinned')}</SectionLabel>
            {pinnedEntries.map((entry) => (
              <HistoryItem
                key={`${entry.kind}-${entry.id}`}
                entry={entry}
                active={historyEntryIsActive(
                  entry,
                  location.pathname,
                  location.search
                )}
                onTogglePin={toggleThreadPinned}
                onRename={renameThread}
                onDelete={deleteThread}
                onDeleteMedia={deleteMediaEntry}
              />
            ))}
            {recentEntries.length > 0 && (
              <SectionLabel>{t('common:recents')}</SectionLabel>
            )}
          </>
        )}
        {(pinnedEntries.length > 0 ? recentEntries : historyEntries).map((entry) => (
          <HistoryItem
            key={`${entry.kind}-${entry.id}`}
            entry={entry}
            active={historyEntryIsActive(
              entry,
              location.pathname,
              location.search
            )}
            onTogglePin={toggleThreadPinned}
            onRename={renameThread}
            onDelete={deleteThread}
            onDeleteMedia={deleteMediaEntry}
          />
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}
