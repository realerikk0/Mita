import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { useThreads } from '@/hooks/useThreads'
import { useMessages } from '@/hooks/useMessages'
import { useThreadManagement } from '@/hooks/useThreadManagement'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useEffect, useRef } from 'react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { memo, useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { RenameThreadDialog, DeleteThreadDialog } from '@/containers/dialogs'
import { cn } from '@/lib/utils'
import { ThreadMessage } from '@biyan/core'
import { ThreadProjectMenuItems } from '@/containers/ThreadProjectMenuItems'
import type { ThreadFolder } from '@/services/projects/types'
import { isLegacyIntroThreadTitle } from '@/legacy_migrations/thread-title'

const INTRO_THREAD_TITLE = 'What is Biyan?'

const ThreadItem = memo(
  ({
    thread,
    isMobile,
    currentProjectId,
    folders,
    getFolderById,
  }: {
    thread: Thread
    isMobile: boolean
    currentProjectId?: string
    folders: ThreadFolder[]
    getFolderById: (id: string) => ThreadFolder | undefined
  }) => {
    const deleteThread = useThreads((state) => state.deleteThread)
    const renameThread = useThreads((state) => state.renameThread)
    const { t } = useTranslation()
    const [renameOpen, setRenameOpen] = useState(false)
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)

    const serviceHub = useServiceHub()
    const getMessages = useMessages((state) => state.getMessages)
    const setMessages = useMessages((state) => state.setMessages)

    // Use a ref to track if messages have been loaded
    const messagesLoadedRef = useRef(false)
    // Track current messages for comparison
    const messagesLengthRef = useRef(0)

    // Get messages reactively via ref tracking (to avoid infinite re-renders)
    const [messages, setLocalMessages] = useState<ThreadMessage[]>(() =>
      getMessages(thread.id)
    )

    // Fetch messages if not loaded yet
    useEffect(() => {
      const currentMessages = getMessages(thread.id)

      // Initial load: no messages yet, fetch them
      if (currentMessages.length === 0 && !messagesLoadedRef.current) {
        messagesLoadedRef.current = true
        serviceHub
          .messages()
          .fetchMessages(thread.id)
          .then((fetchedMessages) => {
            if (fetchedMessages) {
              setMessages(thread.id, fetchedMessages)
              setLocalMessages(fetchedMessages)
              messagesLengthRef.current = fetchedMessages.length
            }
          })
          .catch(() => {
            messagesLoadedRef.current = false
          })
        return
      }

      // Only update local state if messages length changed (prevents re-renders during streaming)
      if (currentMessages.length !== messagesLengthRef.current) {
        setLocalMessages(currentMessages)
        messagesLengthRef.current = currentMessages.length
      }
    }, [thread.id, serviceHub, getMessages, setMessages])

    const lastUserMessageText = useMemo(() => {
      const userMessages = messages.filter((m) => m.role === 'user')
      const lastUserMessage = userMessages[userMessages.length - 1]
      if (!lastUserMessage) return undefined
      const textContent = lastUserMessage.content?.find((c) => c.type === 'text')
      return textContent?.text?.value
    }, [messages])

    const displayTitle = isLegacyIntroThreadTitle(thread.title)
      ? INTRO_THREAD_TITLE
      : thread.title
    const isProtectedIntroThread =
      !localStorage.getItem('setup-completed') &&
      (
        isLegacyIntroThreadTitle(thread.title) ||
        thread.title === INTRO_THREAD_TITLE
      )

    const plainTitleForRename = useMemo(() => {
      return (displayTitle || '').replace(/<span[^>]*>|<\/span>/g, '')
    }, [displayTitle])

    return (
      <SidebarMenuItem>
        {currentProjectId ?
          <Link to="/threads/$threadId" params={{ threadId: thread.id }} className="bg-card dark:bg-secondary/20 mb-2 px-4 py-4 border hover:dark:bg-secondary/30 rounded-lg block max-w-full overflow-hidden">
              <span className="block truncate" title={displayTitle || t('common:newThread')}>{displayTitle || t('common:newThread')}</span>
              {currentProjectId && lastUserMessageText && (
                <div className="text-muted-foreground text-xs mt-1 line-clamp-1 pr-10">
                  {lastUserMessageText}
                </div>
              )}
          </Link>
          :
          <SidebarMenuButton asChild>
            <Link to="/threads/$threadId" params={{ threadId: thread.id }}>
              <span className="block truncate" title={displayTitle || t('common:newThread')}>{displayTitle || t('common:newThread')}</span>
            </Link>
          </SidebarMenuButton>
        }
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuAction
              showOnHover
              className={cn("hover:bg-sidebar-foreground/8", currentProjectId && 'mt-4 mr-2')}
            >
              <MoreHorizontal />
              <span className="sr-only">More</span>
            </SidebarMenuAction>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-48"
            side={isMobile ? 'bottom' : 'right'}
            align={isMobile ? 'end' : 'start'}
          >
            <DropdownMenuItem onSelect={() => setRenameOpen(true)}>
              <Pencil className="size-4" />
              <span>{t('common:rename')}</span>
            </DropdownMenuItem>
            <ThreadProjectMenuItems
              thread={thread}
              folders={folders}
              getFolderById={getFolderById}
              currentProjectId={currentProjectId}
            />
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={isProtectedIntroThread}
              onSelect={() => {
                if (!isProtectedIntroThread) {
                  setDeleteConfirmOpen(true)
                }
              }}
            >
              <Trash2 className="size-4" />
              <span>{t('common:delete')}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <RenameThreadDialog
          thread={thread}
          plainTitleForRename={plainTitleForRename}
          onRename={renameThread}
          open={renameOpen}
          onOpenChange={setRenameOpen}
          withoutTrigger
        />
        
        <DeleteThreadDialog
          thread={thread}
          onDelete={deleteThread}
          open={deleteConfirmOpen}
          onOpenChange={setDeleteConfirmOpen}
          withoutTrigger
        />
      </SidebarMenuItem>
    )
  }
)

type ThreadListProps = {
  threads: Thread[]
  currentProjectId?: string
}

function ThreadList({ threads, currentProjectId }: ThreadListProps) {
  const { isMobile } = useSidebar()
  const { folders, getFolderById } = useThreadManagement()

  const sortedThreads = useMemo(() => {
    return [...threads].sort((a, b) => {
      return (b.updated || 0) - (a.updated || 0)
    })
  }, [threads])

  return (
    <>
      {sortedThreads.map((thread) => (
        <ThreadItem
          key={thread.id}
          thread={thread}
          isMobile={isMobile}
          currentProjectId={currentProjectId}
          folders={folders}
          getFolderById={getFolderById}
        />
      ))}
    </>
  )
}

export default memo(ThreadList)
