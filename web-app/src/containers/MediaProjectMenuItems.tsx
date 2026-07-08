import { Folder, FolderInput, X } from 'lucide-react'
import { useMemo } from 'react'
import { toast } from 'sonner'

import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useTranslation } from '@/i18n/react-i18next-compat'
import type { ImageAssetRecord } from '@/services/image-generation/types'
import type { ProjectAssignment, ThreadFolder } from '@/services/projects/types'
import type { VideoAssetRecord } from '@/services/video-generation/types'

type MediaAssetRecord = ImageAssetRecord | VideoAssetRecord

type MediaProjectMenuItemsProps = {
  asset: MediaAssetRecord
  mediaType: 'image' | 'video'
  folders: ThreadFolder[]
  getFolderById: (id: string) => ThreadFolder | undefined
  onAssetUpdated: (asset: MediaAssetRecord) => void
  currentProjectId?: string
}

export function MediaProjectMenuItems({
  asset,
  mediaType,
  folders,
  getFolderById,
  onAssetUpdated,
  currentProjectId,
}: MediaProjectMenuItemsProps) {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const currentAssetProjectId = asset.project?.id

  const availableProjects = useMemo(() => {
    return folders
      .filter((folder) => {
        if (folder.id === currentProjectId) return false
        if (folder.id === currentAssetProjectId) return false
        return true
      })
      .sort((a, b) => b.updated_at - a.updated_at)
  }, [folders, currentProjectId, currentAssetProjectId])

  const persistProject = async (project?: ProjectAssignment) => {
    try {
      const updated =
        mediaType === 'image'
          ? await serviceHub.imageGeneration().updateAssetProject(asset.id, project)
          : await serviceHub
              .videoGeneration()
              .updateVideoAssetProject(asset.id, project)

      onAssetUpdated(updated)
      window.dispatchEvent(new Event('mita-media-history-updated'))
      toast.success(
        project
          ? t('common:toast.threadAssignedToProject.description', {
              projectName: project.name,
            })
          : t('common:toast.threadRemovedFromProject.description', {
              projectName:
                asset.project?.name ?? t('common:projects.title'),
            })
      )
    } catch (error) {
      console.error('Failed to update media project:', error)
      toast.error(t('common:error'))
    }
  }

  const moveToProject = (projectId: string) => {
    const project = getFolderById(projectId)
    if (!project) return

    void persistProject({
      id: project.id,
      name: project.name,
      updated_at: project.updated_at,
    })
  }

  return (
    <>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="gap-2">
          <FolderInput className="size-4" />
          <span>{t('common:projects.addToProject')}</span>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="max-h-60 min-w-44 overflow-y-auto">
          {availableProjects.length === 0 ? (
            <DropdownMenuItem disabled>
              <span className="text-muted-foreground">
                {t('common:projects.noProjectsAvailable')}
              </span>
            </DropdownMenuItem>
          ) : (
            availableProjects.map((project) => (
              <DropdownMenuItem
                key={project.id}
                onSelect={() => moveToProject(project.id)}
              >
                <Folder className="size-4" />
                <span className="max-w-[200px] truncate">{project.name}</span>
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuSubContent>
      </DropdownMenuSub>

      {asset.project && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void persistProject(undefined)}>
            <X className="size-4" />
            <span>{t('common:projects.removeFromProject')}</span>
          </DropdownMenuItem>
        </>
      )}
    </>
  )
}
