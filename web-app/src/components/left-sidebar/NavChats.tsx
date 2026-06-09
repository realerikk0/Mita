import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  ImagePlus,
  MessageCircle,
  MoreHorizontal,
  UsersRound,
  Video,
  type LucideIcon,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useThreads } from "@/hooks/useThreads"
import { DeleteAllThreadsDialog } from "@/containers/dialogs/DeleteAllThreadsDialog"
import { useServiceHub } from "@/hooks/useServiceHub"
import { useImageGenerationStore } from "@/stores/image-generation-store"
import type { ImageAssetRecord } from "@/services/image-generation/types"
import type { VideoAssetRecord } from "@/services/video-generation/types"
import { Link } from "@tanstack/react-router"
import { route } from "@/constants/routes"

type HistoryEntry =
  | {
      id: string
      kind: 'chat' | 'team'
      title: string
      updatedAt: number
      icon: LucideIcon
      to: '/threads/$threadId'
      params: { threadId: string }
    }
  | {
      id: string
      kind: 'media'
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

function isMitaTeamsThread(thread: Thread) {
  return Boolean(thread.metadata?.mitaTeams)
}

function mediaTitle(
  asset: Pick<ImageAssetRecord | VideoAssetRecord, 'prompt'>,
  fallback: string
) {
  const firstLine = asset.prompt?.split('\n').find((line) => line.trim())
  return firstLine?.trim() || fallback
}

function HistoryItem({ entry }: { entry: HistoryEntry }) {
  const Icon = entry.icon
  const content = (
    <>
      <Icon className="size-4 shrink-0 text-foreground/70" />
      <span className="min-w-0 flex-1 truncate" title={entry.title}>
        {entry.title}
      </span>
    </>
  )

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild>
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
    </SidebarMenuItem>
  )
}

export function NavChats() {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const getFilteredThreads = useThreads((state) => state.getFilteredThreads)
  const threads = useThreads((state) => state.threads)
  const deleteAllThreads = useThreads((state) => state.deleteAllThreads)
  const imageAssets = useImageGenerationStore((state) => state.assets)
  const setImageAssets = useImageGenerationStore((state) => state.setAssets)
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

  const historyEntries = useMemo<HistoryEntry[]>(() => {
    const threadEntries: HistoryEntry[] = threadsWithoutProject.map((thread) => {
      const team = isMitaTeamsThread(thread)
      return {
        id: thread.id,
        kind: team ? 'team' : 'chat',
        title: thread.title || t('common:newThread'),
        updatedAt: (thread.updated || 0) * 1000,
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
      (a, b) => b.updatedAt - a.updatedAt
    )
  }, [imageAssets, threadsWithoutProject, t, videoAssets])

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
        {historyEntries.map((entry) => (
          <HistoryItem key={`${entry.kind}-${entry.id}`} entry={entry} />
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}
