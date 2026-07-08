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
import { useThreads } from '@/hooks/useThreads'
import { useTranslation } from '@/i18n/react-i18next-compat'
import type { ThreadFolder } from '@/services/projects/types'

type ThreadProjectMenuItemsProps = {
  thread: Thread
  folders: ThreadFolder[]
  getFolderById: (id: string) => ThreadFolder | undefined
  currentProjectId?: string
}

export function ThreadProjectMenuItems({
  thread,
  folders,
  getFolderById,
  currentProjectId,
}: ThreadProjectMenuItemsProps) {
  const { t } = useTranslation()
  const updateThread = useThreads((state) => state.updateThread)
  const currentThreadProjectId = thread.metadata?.project?.id

  const availableProjects = useMemo(() => {
    return folders
      .filter((folder) => {
        if (folder.id === currentProjectId) return false
        if (folder.id === currentThreadProjectId) return false
        return true
      })
      .sort((a, b) => b.updated_at - a.updated_at)
  }, [folders, currentProjectId, currentThreadProjectId])

  const moveToProject = (projectId: string) => {
    const project = getFolderById(projectId)
    if (!project) return

    updateThread(thread.id, {
      metadata: {
        ...thread.metadata,
        project: {
          id: project.id,
          name: project.name,
          updated_at: project.updated_at,
        },
      },
    })

    toast.success(
      t('common:toast.threadAssignedToProject.description', {
        projectName: project.name,
      })
    )
  }

  const removeFromProject = () => {
    const projectName = currentThreadProjectId
      ? getFolderById(currentThreadProjectId)?.name
      : undefined

    updateThread(thread.id, {
      metadata: {
        ...thread.metadata,
        project: undefined,
      },
    })

    toast.success(
      t('common:toast.threadRemovedFromProject.description', {
        projectName:
          projectName ?? thread.metadata?.project?.name ?? t('common:projects.title'),
      })
    )
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

      {thread.metadata?.project && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={removeFromProject}>
            <X className="size-4" />
            <span>{t('common:projects.removeFromProject')}</span>
          </DropdownMenuItem>
        </>
      )}
    </>
  )
}
