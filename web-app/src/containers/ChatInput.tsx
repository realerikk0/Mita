import TextareaAutosize from 'react-textarea-autosize'
import { cn } from '@/lib/utils'
import { usePrompt } from '@/hooks/usePrompt'
import { useThreads } from '@/hooks/useThreads'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  memo,
} from 'react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu'
import { ArrowRight, PlusIcon, Repeat2 } from 'lucide-react'
import {
  IconPhoto,
  IconAtom,
  IconTool,
  IconPlayerStopFilled,
  IconX,
  IconPaperclip,
  IconLoader2,
  IconUser,
} from '@tabler/icons-react'
import { generateId } from 'ai'
import { useMessageQueue } from '@/stores/message-queue-store'
import { QueuedMessageChip } from '@/containers/QueuedMessageBubble'
import { BotIcon } from 'lucide-react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { readBiyanTeamsMetadata } from '@/types/biyan-teams'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { useModelProvider } from '@/hooks/useModelProvider'

import { useAppState } from '@/hooks/useAppState'
import { MovingBorder } from './MovingBorder'
import type { ChatStatus } from 'ai'
import { useRouter } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import {
  TEMPORARY_CHAT_ID,
  TEMPORARY_CHAT_QUERY_ID,
  SESSION_STORAGE_PREFIX,
} from '@/constants/chat'
import { defaultModel } from '@/lib/models'
import { useAssistant } from '@/hooks/useAssistant'
import DropdownToolsAvailable from '@/containers/DropdownToolsAvailable'
import { AvatarEmoji } from '@/containers/AvatarEmoji'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useTools } from '@/hooks/useTools'
import { useShallow } from 'zustand/react/shallow'
import { McpExtensionToolLoader } from './McpExtensionToolLoader'
import {
  ExtensionTypeEnum,
  MCPExtension,
  fs,
} from '@biyan/core'
import { ExtensionManager } from '@/lib/extension'
import { useAttachments } from '@/hooks/useAttachments'
import { toast } from 'sonner'
import { isPlatformTauri } from '@/lib/platform/utils'
import { supportsNativeFileInput } from '@/lib/attachmentProcessing'
import {
  NEW_THREAD_ATTACHMENT_KEY,
  useChatAttachments,
} from '@/hooks/useChatAttachments'

import {
  Attachment,
  createImageAttachment,
  createDocumentAttachment,
} from '@/types/attachment'
import { isBrowserMCPServerName } from '@/constants/mcp'
import { useAgentMode } from '@/hooks/useAgentMode'
import { AssistantsMenu } from '@/components/AssistantsMenu'
import { parseCompactCommand } from '@/lib/compact-thread'
import { isModelChatSelectable } from '@/lib/provider-models'

type ChatInputProps = {
  className?: string
  showSpeedToken?: boolean
  model?: ThreadModel
  initialMessage?: boolean
  projectId?: string
  onSubmit?: (
    text: string,
    files?: Array<{ type: string; mediaType: string; url: string }>
  ) => void
  onCompact?: (instructions?: string) => Promise<void>
  onStop?: () => void
  chatStatus?: ChatStatus
  showAutoRunToggle?: boolean
  autoRunPanelVisible?: boolean
  onToggleAutoRunPanel?: () => void
}

type DocumentFileInput = {
  path?: string
  name?: string
  size?: number
  file?: File
}

type DroppedFileWithPath = File & {
  path?: string
}

const droppedFileKey = (file: File) =>
  `${file.name}:${file.size}`

const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })

const ChatInput = memo(function ChatInput({
  className,
  initialMessage,
  projectId,
  onSubmit,
  onCompact,
  onStop,
  chatStatus,
  showAutoRunToggle,
  autoRunPanelVisible = true,
  onToggleAutoRunPanel,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [isFocused, setIsFocused] = useState(false)
  const [rows, setRows] = useState(1)
  const serviceHub = useServiceHub()
  const abortControllers = useAppState((state) => state.abortControllers)
  const tools = useAppState((state) => state.tools)
  const cancelToolCall = useAppState((state) => state.cancelToolCall)
  const currentThreadId = useThreads((state) => state.currentThreadId)
  const promptKey = useMemo(
    () =>
      currentThreadId ??
      (projectId ? `project:${projectId}` : TEMPORARY_CHAT_ID),
    [currentThreadId, projectId]
  )
  const setActivePromptKey = usePrompt((state) => state.setActivePromptKey)
  useLayoutEffect(() => {
    setActivePromptKey(promptKey)
  }, [promptKey, setActivePromptKey])
  const prompt = usePrompt((state) => state.prompt)
  const setPrompt = usePrompt((state) => state.setPrompt)
  const addToHistory = usePrompt((state) => state.addToHistory)
  const navigateHistory = usePrompt((state) => state.navigateHistory)
  const currentThread = useThreads((state) => state.getCurrentThread())
  const isBiyanTeamsThread =
    (
      readBiyanTeamsMetadata(currentThread?.metadata) as
        | { enabled?: boolean }
        | undefined
    )?.enabled === true
  const updateCurrentThreadAssistant = useThreads(
    (state) => state.updateCurrentThreadAssistant
  )
  const { t } = useTranslation()
  const spellCheckChatInput = useGeneralSetting(
    (state) => state.spellCheckChatInput
  )
  useTools()
  const router = useRouter()
  const createThread = useThreads((state) => state.createThread)
  const { 
    loading,
    currentAssistant,
    setCurrentAssistant,
    assistants
  } = useAssistant()

  // Agent mode
  // Use TEMPORARY_CHAT_ID as fallback key on the home screen (same pattern as attachments)
  const agentModeKey = currentThreadId ?? TEMPORARY_CHAT_ID
  const isAgentMode = useAgentMode((state) =>
    state.agentThreads[agentModeKey] === true
  )
  // When projectId is present, treat as normal chat (disable agent mode UI)
  const effectiveAgentMode = isAgentMode && !projectId
  const toggleAgentMode = useAgentMode((state) => state.toggleAgentMode)

  const handleAgentToggle = useCallback(() => {
    toggleAgentMode(agentModeKey)
  }, [agentModeKey, toggleAgentMode])

  const maxRows = 10

  useEffect(() => {
    const nextRows = (prompt.match(/\n/g) || []).length + 1
    setRows(Math.min(nextRows, maxRows))
  }, [maxRows, prompt])

  const selectedModel = useModelProvider((state) => state.selectedModel)
  const selectedProvider = useModelProvider((state) => state.selectedProvider)
  const [message, setMessage] = useState('')
  const [dropdownToolsAvailable, setDropdownToolsAvailable] = useState(false)
  const [tooltipShown, setTooltipShown] = useState<
    'tools' | 'assistants' | false
  >(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [supportsVision, setSupportsVision] = useState(false)
  const wasPointerDown = useRef(false)
  const [selectedAssistantId, setSelectedAssistantId] = useState<
    string | undefined
  >(loading ? undefined : currentAssistant?.id || '')

  useEffect(() => {
    setSelectedAssistantId(currentAssistant?.id || '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

  const avatar = currentThread
    ? assistants.find((a) => a.id === currentThread?.assistants?.[0]?.id)
        ?.avatar ||
      currentThread?.assistants?.[0]?.avatar ||
      ''
    : assistants.find((a) => a.id === selectedAssistantId)?.avatar || ''

  const assistantCount = assistants?.length || 0

  // No auto-selection: let the user explicitly pick an assistant

  const attachmentsEnabled = useAttachments((s) => s.enabled)
  const maxFileSizeMB = useAttachments((s) => s.maxFileSizeMB)

  // Derived: any document currently processing (ingestion in progress)
  const attachmentsKey = currentThreadId ?? NEW_THREAD_ATTACHMENT_KEY
  const attachments = useChatAttachments(
    useCallback(
      (state) => state.getAttachments(attachmentsKey),
      [attachmentsKey]
    )
  )
  const setAttachmentsForThread = useChatAttachments(
    (state) => state.setAttachments
  )
  const clearAttachmentsForThread = useChatAttachments(
    (state) => state.clearAttachments
  )
  const transferAttachments = useChatAttachments(
    (state) => state.transferAttachments
  )

  const ingestingDocs = attachments.some(
    (a) => a.type === 'document' && a.processing
  )
  const ingestingAny = attachments.some((a) => a.processing)
  const modelSupportsTools =
    selectedModel?.capabilities?.includes('tools') === true
  const canAttachDocumentFiles = true
  const canDropFiles = supportsVision || attachmentsEnabled

  // Queued messages for this thread (shown as chips in the input area)
  const queuedMessages = useMessageQueue(
    useShallow((s) => s.getQueue(currentThreadId ?? ''))
  )
  const queueLength = queuedMessages.length

  const removeQueuedMessage = useCallback(
    (id: string) => {
      useMessageQueue.getState().removeMessage(currentThreadId ?? '', id)
    },
    [currentThreadId]
  )

  const lastTransferredThreadId = useRef<string | null>(null)

  useEffect(() => {
    if (
      currentThreadId &&
      lastTransferredThreadId.current !== currentThreadId
    ) {
      transferAttachments(NEW_THREAD_ATTACHMENT_KEY, currentThreadId)
      lastTransferredThreadId.current = currentThreadId
    }
  }, [currentThreadId, transferAttachments])

  // Follow the selected remote model's declared vision capability.
  useEffect(() => {
    setSupportsVision(
      Boolean(selectedModel?.id && selectedModel.capabilities?.includes('vision'))
    )
  }, [selectedModel?.id, selectedModel?.capabilities])

  // Check if there are active MCP servers
  const hasActiveMCPServers =
    tools.filter((tool) => !isBrowserMCPServerName(tool.server)).length > 0

  // Get MCP extension and its custom component
  const extensionManager = ExtensionManager.getInstance()
  const mcpExtension = extensionManager.get<MCPExtension>(ExtensionTypeEnum.MCP)
  const MCPToolComponent = mcpExtension?.getToolComponent?.()

  const handleSendMessage = async (prompt: string) => {
    const compactCommand = parseCompactCommand(prompt)
    if (compactCommand.isCompact) {
      if (!onCompact) {
        toast.info('Open a conversation before compacting context')
        return
      }
      if (isStreaming) {
        toast.info('Please wait for the current response to finish before compacting')
        return
      }
      if (ingestingAny) {
        toast.info('Please wait for attachments to finish processing')
        return
      }
      setMessage('')
      addToHistory(prompt)
      await onCompact(compactCommand.instructions)
      setPrompt('')
      clearAttachmentsForThread(attachmentsKey)
      return
    }

    if (!selectedModel) {
      setMessage('Please select a model to start chatting.')
      return
    }
    if (!isModelChatSelectable(selectedModel)) {
      setMessage(
        'Please select a text generation model to start chatting.'
      )
      return
    }
    if (!prompt.trim()) {
      return
    }
    if (ingestingAny) {
      toast.info('Please wait for attachments to finish processing')
      return
    }

    setMessage('')
    addToHistory(prompt)

    // Use onSubmit prop if available (AI SDK), otherwise create thread and navigate
    if (onSubmit) {
      // When the model is still streaming, queue the message for later
      if (isStreaming && currentThreadId) {
        useMessageQueue.getState().enqueue(currentThreadId, {
          id: generateId(),
          text: prompt,
          createdAt: Date.now(),
        })
        setPrompt('')
        return
      }

      const assistant = currentThread?.assistants?.[0]
      setCurrentAssistant(assistant)
      // Build file parts for AI SDK
      const files = attachments
        .filter((att) => att.type === 'image' && att.dataUrl)
        .map((att) => ({
          type: 'file',
          mediaType: att.mimeType ?? 'image/jpeg',
          url: att.dataUrl!,
        }))

      onSubmit(prompt, files.length > 0 ? files : undefined)
      setPrompt('')
      clearAttachmentsForThread(attachmentsKey)
    } else {
      // No onSubmit provided - create a new thread and navigate to it
      // Store the initial message in sessionStorage for the thread page to read
      const isTemporaryChat = window.location.search.includes(
        `${TEMPORARY_CHAT_QUERY_ID}=true`
      )

      // Build message payload with attachments
      const files = attachments
        .filter((att) => att.type === 'image' && att.dataUrl)
        .map((att) => ({
          type: 'file',
          mediaType: att.mimeType ?? 'image/jpeg',
          url: att.dataUrl!,
        }))

      const messagePayload = {
        text: prompt,
        files: files.length > 0 ? files : [],
      }

      if (isTemporaryChat) {
        // For temporary chat, store message and navigate to temporary thread
        sessionStorage.setItem(
          `${SESSION_STORAGE_PREFIX.INITIAL_MESSAGE}${TEMPORARY_CHAT_ID}`,
          JSON.stringify(messagePayload)
        )
        clearAttachmentsForThread(TEMPORARY_CHAT_ID)
        if (attachments.length > 0) {
          transferAttachments(NEW_THREAD_ATTACHMENT_KEY, TEMPORARY_CHAT_ID)
        }
        // Transfer agent mode from home screen to temporary thread
        if (isAgentMode && agentModeKey !== TEMPORARY_CHAT_ID) {
          useAgentMode.getState().setAgentMode(TEMPORARY_CHAT_ID, true)
          useAgentMode.getState().removeThread(agentModeKey)
        }
        setPrompt('')
        router.navigate({
          to: route.threadsDetail,
          params: { threadId: TEMPORARY_CHAT_ID },
        })
      } else {
        // Get project metadata and assistant if projectId is provided
        let projectMetadata:
          | { id: string; name: string; updated_at: number }
          | undefined
        let projectAssistantId: string | undefined

        if (projectId) {
          try {
            const project = await serviceHub
              .projects()
              .getProjectById(projectId)
            if (project) {
              projectMetadata = {
                id: project.id,
                name: project.name,
                updated_at: project.updated_at,
              }
              projectAssistantId = project.assistantId
            }
          } catch (e) {
            console.warn('Failed to fetch project metadata:', e)
          }
        }

        // Only use assistant when chatting via project with an assigned assistant
        // When no projectId, use the selected assistant from dropdown (if any)
        const assistant = projectAssistantId
          ? assistants.find((a) => a.id === projectAssistantId)
          : assistants.find((a) => a.id === selectedAssistantId)

        setCurrentAssistant(assistant)

        const newThread = await createThread(
          {
            id: selectedModel?.id ?? defaultModel(selectedProvider),
            provider: selectedProvider,
          },
          prompt, // Use prompt as thread title
          assistant,
          projectMetadata
        )

        // Transfer agent mode from home screen to the new thread
        if (isAgentMode) {
          useAgentMode.getState().setAgentMode(newThread.id, true)
          useAgentMode.getState().removeThread(agentModeKey)
        }

        // Store the initial message for the new thread
        sessionStorage.setItem(
          `${SESSION_STORAGE_PREFIX.INITIAL_MESSAGE}${newThread.id}`,
          JSON.stringify(messagePayload)
        )

        setPrompt('')
        router.navigate({
          to: route.threadsDetail,
          params: { threadId: newThread.id },
        })
      }

      // Don't clear attachments here — document attachments stored under
      // NEW_THREAD_ATTACHMENT_KEY need to survive until the thread detail
      // page transfers and processes them.  The thread detail page's
      // processAndSendMessage already calls clearAttachmentsForThread after
      // processing is complete.
    }
  }

  useEffect(() => {
    const handleFocusIn = () => {
      if (document.activeElement === textareaRef.current) {
        setIsFocused(true)
      }
    }

    const handleFocusOut = () => {
      if (document.activeElement !== textareaRef.current) {
        setIsFocused(false)
      }
    }

    document.addEventListener('focusin', handleFocusIn)
    document.addEventListener('focusout', handleFocusOut)

    return () => {
      document.removeEventListener('focusin', handleFocusIn)
      document.removeEventListener('focusout', handleFocusOut)
    }
  }, [])

  // Focus when component mounts
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [])

  useEffect(() => {
    if (tooltipShown && dropdownToolsAvailable) {
      setTooltipShown(false)
    }
  }, [dropdownToolsAvailable, tooltipShown])

  // Focus when thread changes
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [currentThreadId])

  // Focus when streaming content finishes
  useEffect(() => {
    if (chatStatus !== 'submitted' && textareaRef.current) {
      // Small delay to ensure UI has updated
      setTimeout(() => {
        textareaRef.current?.focus()
      }, 10)
    }
  }, [chatStatus])

  const stopStreaming = useCallback(
    (threadId: string) => {
      // Use onStop prop if available (AI SDK), otherwise use legacy abort
      if (onStop) {
        onStop()
      } else {
        abortControllers[threadId]?.abort()
      }
      cancelToolCall?.()
    },
    [abortControllers, cancelToolCall, onStop]
  )

  const fileInputRef = useRef<HTMLInputElement>(null)

  const attachDocumentFiles = useCallback(
    async (files: DocumentFileInput[]) => {
      if (!files.length) return

      const preparedAttachments: Attachment[] = []
      const supportsNativeFiles = supportsNativeFileInput(
        selectedModel?.capabilities
      )
      const maxFileSizeBytes = maxFileSizeMB * 1024 * 1024

      for (const file of files) {
        const name =
          file.name ??
          file.path?.split(/[\\/]/).pop() ??
          'document'
        const fileType = name.split('.').pop()?.toLowerCase()
        let size: number | undefined =
          typeof file.size === 'number' ? file.size : file.file?.size
        if (size === undefined && file.path) {
          try {
            const stat = await fs.fileStat(file.path)
            size = stat?.size ? Number(stat.size) : undefined
          } catch (e) {
            console.warn('Failed to read file size for', file.path, e)
          }
        }

        if (typeof size === 'number' && size > maxFileSizeBytes) {
          toast.error('File too large', {
            description: `${name} exceeds the ${maxFileSizeMB}MB limit`,
          })
          continue
        }

        let nativeFile = file.file
        if (supportsNativeFiles && !nativeFile && file.path) {
          try {
            const response = await fetch(
              serviceHub.core().convertFileSrc(file.path)
            )
            if (!response.ok) {
              throw new Error(`Unable to read file (${response.status})`)
            }
            const blob = await response.blob()
            if (blob.size > maxFileSizeBytes) {
              throw new Error(`${name} exceeds the ${maxFileSizeMB}MB limit`)
            }
            nativeFile = new File([blob], name, {
              type: blob.type || getFileTypeFromExtension(name),
            })
          } catch (error) {
            console.warn(`Native file input unavailable for ${name}`, error)
          }
        }

        const nativeDataUrl =
          supportsNativeFiles && nativeFile
            ? await fileToDataUrl(nativeFile)
            : undefined
        const nativeMediaType = nativeFile
          ? nativeFile.type || getFileTypeFromExtension(name)
          : undefined
        const textOnlyBrowserFile =
          !file.path &&
          nativeFile &&
          (nativeFile.type.startsWith('text/') ||
            [
              'txt', 'md', 'csv', 'json', 'jsonc', 'yaml', 'yml', 'toml',
              'xml', 'html', 'htm', 'js', 'ts', 'tsx', 'jsx', 'py', 'rs',
              'go', 'java', 'kt', 'swift', 'c', 'cpp', 'h', 'hpp', 'sql',
              'sh', 'zsh', 'css', 'scss', 'log', 'diff', 'patch',
            ].includes(fileType ?? ''))
        let inlineContent: string | undefined
        if (!supportsNativeFiles && textOnlyBrowserFile && nativeFile) {
          inlineContent = await nativeFile.text()
        }

        preparedAttachments.push(
          createDocumentAttachment({
            name,
            path: file.path,
            fileType,
            size,
            nativeDataUrl,
            nativeMediaType,
            inlineContent,
          })
        )
      }

      let duplicates: string[] = []
      let newDocAttachments: Attachment[] = []

      setAttachmentsForThread(attachmentsKey, (currentAttachments) => {
        const existingKeys = new Set(
          currentAttachments
            .filter((a) => a.type === 'document')
            .map((a) => a.path ?? `${a.name}:${a.size ?? 0}`)
        )

        duplicates = []
        newDocAttachments = []

        for (const att of preparedAttachments) {
          const key = att.path ?? `${att.name}:${att.size ?? 0}`
          if (existingKeys.has(key)) {
            duplicates.push(att.name)
            continue
          }
          newDocAttachments.push(att)
        }

        return newDocAttachments.length > 0
          ? [...currentAttachments, ...newDocAttachments]
          : currentAttachments
      })

      if (duplicates.length > 0) {
        toast.warning('Files already attached', {
          description: `${duplicates.join(', ')} ${duplicates.length === 1 ? 'is' : 'are'} already in the list`,
        })
      }

    },
    [
      attachmentsKey,
      maxFileSizeMB,
      selectedModel?.capabilities,
      serviceHub,
      setAttachmentsForThread,
    ]
  )

  const handleAttachDocsIngest = async () => {
    try {
      if (!attachmentsEnabled) {
        toast.info('Attachments are disabled in Settings')
        return
      }
      const selection = await serviceHub.dialog().open({
        multiple: true,
        filters: [
          {
            name: 'Documents & Code',
            extensions: [
              // Documents
              'pdf',
              'docx',
              'txt',
              'md',
              'csv',
              'xlsx',
              'xls',
              'ods',
              'pptx',
              'html',
              'htm',
              // JavaScript / TypeScript
              'js',
              'mjs',
              'cjs',
              'ts',
              'mts',
              'cts',
              'jsx',
              'tsx',
              // Python
              'py',
              'pyw',
              'pyi',
              // C / C++
              'c',
              'h',
              'cpp',
              'cc',
              'cxx',
              'hpp',
              'hh',
              // Systems languages
              'rs',
              'go',
              'swift',
              'zig',
              // JVM languages
              'java',
              'kt',
              'kts',
              'scala',
              'groovy',
              // Scripting languages
              'rb',
              'php',
              'lua',
              'pl',
              'r',
              'jl',
              // .NET
              'cs',
              'fs',
              'vb',
              'xaml',
              'csproj',
              'sln',
              // CUDA
              'cu',
              'cuh',
              // Shaders
              'hlsl',
              'glsl',
              'cg',
              'shader',
              // Shell
              'sh',
              'bash',
              'zsh',
              'fish',
              'ps1',
              'bat',
              'cmd',
              'vbs',
              // More languages
              'asm',
              's',
              'm',
              'mm',
              'pas',
              'pp',
              'erl',
              'hrl',
              'ex',
              'exs',
              'clj',
              'cljs',
              'hs',
              'lhs',
              'ml',
              'mli',
              'f',
              'f90',
              // Web
              'css',
              'scss',
              'sass',
              'less',
              'vue',
              'svelte',
              'astro',
              'php',
              'asp',
              'aspx',
              'jsp',
              // Data / config formats
              'json',
              'jsonc',
              'yaml',
              'yml',
              'toml',
              'xml',
              'ini',
              'cfg',
              'conf',
              'env',
              'properties',
              'dockerfile',
              'makefile',
              'cmake',
              'lock',
              // Query / markup
              'sql',
              'graphql',
              'gql',
              'tex',
              'rst',
              'adoc',
              'textile',
              // Misc text
              'log',
              'diff',
              'patch',
              'gitignore',
            ],
          },
          {
            name: 'All Files',
            extensions: ['*'],
          },
        ],
      })
      if (!selection) return
      const paths = Array.isArray(selection) ? selection : [selection]
      if (!paths.length) return

      await attachDocumentFiles(paths.map((path) => ({ path })))
    } catch (e) {
      console.error('Failed to attach documents:', e)
      const desc = e instanceof Error ? e.message : JSON.stringify(e)
      toast.error('Failed to attach documents', { description: desc })
    }
  }

  const handleRemoveAttachment = async (indexToRemove: number) => {
    setAttachmentsForThread(attachmentsKey, (prev) =>
      prev.filter((_, index) => index !== indexToRemove)
    )
  }

  const getFileTypeFromExtension = (fileName: string): string => {
    const extension = fileName.toLowerCase().split('.').pop()
    switch (extension) {
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg'
      case 'png':
        return 'image/png'
      default:
        return ''
    }
  }

  const isImageDropFile = (file: File): boolean => {
    const detectedType = file.type || getFileTypeFromExtension(file.name)
    return detectedType.startsWith('image/')
  }

  const getDroppedDocumentPath = (file: File): string | undefined => {
    const droppedFile = file as DroppedFileWithPath
    return droppedFile.path && droppedFile.path.trim().length > 0
      ? droppedFile.path
      : undefined
  }

  const getDroppedItemPathMap = (
    items: DataTransferItemList | undefined
  ): Map<string, string> => {
    const paths = new Map<string, string>()
    if (!items) return paths

    for (const item of Array.from(items)) {
      if (item.kind !== 'file') continue
      const file = item.getAsFile()
      const path = file ? getDroppedDocumentPath(file) : undefined
      if (file && path) {
        paths.set(droppedFileKey(file), path)
      }
    }

    return paths
  }

  const formatBytes = (bytes?: number): string => {
    if (!bytes || bytes <= 0) return ''
    const units = ['B', 'KB', 'MB', 'GB']
    let i = 0
    let val = bytes
    while (val >= 1024 && i < units.length - 1) {
      val /= 1024
      i++
    }
    return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
  }

  const hashBase64 = async (base64: string): Promise<string> => {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const hashBuffer = await crypto.subtle.digest('SHA-256', bytes)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  }

  const processImageFiles = useCallback(async (files: File[]) => {
    const maxSize = 10 * 1024 * 1024 // 10MB in bytes
    const oversizedFiles: string[] = []
    const invalidTypeFiles: string[] = []

    const allowedTypes = ['image/jpg', 'image/jpeg', 'image/png']
    const validFiles: File[] = []

    // First pass: validate file size and type (no duplicate check yet)
    Array.from(files).forEach((file) => {
      // Check file size
      if (file.size > maxSize) {
        oversizedFiles.push(file.name)
        return
      }

      // Get file type - use extension as fallback if MIME type is incorrect
      const detectedType = file.type || getFileTypeFromExtension(file.name)
      const actualType = getFileTypeFromExtension(file.name) || detectedType

      // Check file type - images only
      if (!allowedTypes.includes(actualType)) {
        invalidTypeFiles.push(file.name)
        return
      }

      validFiles.push(file)
    })

    // Process valid files into attachments
    const preparedFiles: Attachment[] = []
    for (const file of validFiles) {
      const detectedType = file.type || getFileTypeFromExtension(file.name)
      const actualType = getFileTypeFromExtension(file.name) || detectedType

      const reader = new FileReader()
      await new Promise<void>((resolve) => {
        reader.onload = () => {
          const result = reader.result
          if (typeof result === 'string') {
            const base64String = result.split(',')[1]
            const att = createImageAttachment({
              name: file.name,
              size: file.size,
              mimeType: actualType,
              base64: base64String,
              dataUrl: result,
            })
            preparedFiles.push(att)
          }
          resolve()
        }
        reader.readAsDataURL(file)
      })
    }

    // Compute content hashes for deduplication (allows different images with same filename)
    for (const att of preparedFiles) {
      if (att.base64) {
        att.contentHash = await hashBase64(att.base64)
      }
    }

    const duplicates: string[] = []
    const newFiles: Attachment[] = []

    const currentAttachments = useChatAttachments.getState().getAttachments(
      attachmentsKey
    )

    const existingImageHashes = new Set<string>()
    const existingImageNames = new Set<string>()
    for (const a of currentAttachments) {
      if (a.type !== 'image') continue
      if (a.contentHash) {
        existingImageHashes.add(a.contentHash)
      } else if (a.base64) {
        existingImageHashes.add(await hashBase64(a.base64))
      } else {
        existingImageNames.add(a.name)
      }
    }

    const seenHashesInBatch = new Set<string>()
    for (const att of preparedFiles) {
      const hash = att.contentHash
      const isDuplicateByContent =
        hash &&
        (existingImageHashes.has(hash) || seenHashesInBatch.has(hash))
      const isDuplicateByName =
        existingImageNames.has(att.name)
      if (isDuplicateByContent || isDuplicateByName) {
        duplicates.push(att.name)
        continue
      }
      if (hash) {
        seenHashesInBatch.add(hash)
      }
      newFiles.push(att)
    }

    setAttachmentsForThread(attachmentsKey, (prev) =>
      newFiles.length > 0 ? [...prev, ...newFiles] : prev
    )

    // Display validation errors
    if (duplicates.length > 0) {
      toast.warning('Some images already attached', {
        description: `${duplicates.join(', ')} ${duplicates.length === 1 ? 'is' : 'are'} already in the list`,
      })
    }

    const errors: string[] = []
    if (oversizedFiles.length > 0) {
      errors.push(
        `File${oversizedFiles.length > 1 ? 's' : ''} too large (max 10MB): ${oversizedFiles.join(', ')}`
      )
    }

    if (invalidTypeFiles.length > 0) {
      errors.push(
        `Invalid file type${invalidTypeFiles.length > 1 ? 's' : ''} (only JPEG, JPG, PNG allowed): ${invalidTypeFiles.join(', ')}`
      )
    }

    if (errors.length > 0) {
      setMessage(errors.join(' | '))
      // Reset file input to allow re-uploading
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    } else {
      setMessage('')
    }
  }, [attachmentsKey, setAttachmentsForThread])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files

    if (files && files.length > 0) {
      void processImageFiles(Array.from(files))

      // Reset the file input value to allow re-uploading the same file
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }

    if (textareaRef.current) {
      textareaRef.current.focus()
    }
  }

  // Open the image picker dialog (extracted for reuse)
  const openImagePicker = useCallback(async () => {
    if (isPlatformTauri()) {
      try {
        const selected = await serviceHub.dialog().open({
          multiple: true,
          filters: [
            {
              name: 'Images',
              extensions: ['jpg', 'jpeg', 'png'],
            },
          ],
        })

        if (selected) {
          const paths = Array.isArray(selected) ? selected : [selected]
          const files: File[] = []

          for (const path of paths) {
            try {
              // Use Tauri's convertFileSrc to create a valid URL for the file
              const { convertFileSrc } = await import('@tauri-apps/api/core')
              const fileUrl = convertFileSrc(path)

              // Fetch the file as blob
              const response = await fetch(fileUrl)
              if (!response.ok) {
                throw new Error(`Failed to fetch file: ${response.statusText}`)
              }

              const blob = await response.blob()
              const fileName =
                path.split(/[\\/]/).filter(Boolean).pop() || 'image'
              const ext = fileName.toLowerCase().split('.').pop()
              const mimeType =
                ext === 'png'
                  ? 'image/png'
                  : ext === 'jpg' || ext === 'jpeg'
                    ? 'image/jpeg'
                    : 'image/jpeg'

              const file = new File([blob], fileName, { type: mimeType })
              files.push(file)
            } catch (error) {
              console.error('Failed to read file:', error)
              toast.error('Failed to read file', {
                description:
                  error instanceof Error ? error.message : String(error),
              })
            }
          }

          if (files.length > 0) {
            await processImageFiles(files)
          }
        }
      } catch (error) {
        console.error('Failed to open file dialog:', error)
      }

      if (textareaRef.current) {
        textareaRef.current.focus()
      }
    } else {
      // Fallback to input click for web
      fileInputRef.current?.click()
    }
  }, [serviceHub, processImageFiles])

  const notifyModelLacksVision = useCallback(() => {
    toast.info(t('common:toast.modelNoVision.title'), {
      id: 'model-no-vision',
      description: t('common:toast.modelNoVision.description'),
      action: {
        label: t('common:toast.modelNoVision.action'),
        onClick: () =>
          router.navigate({
            to: route.settings.providers,
            params: { providerName: selectedProvider || 'jingxing' },
          }),
      },
    })
  }, [t, router, selectedProvider])

  const handleImagePickerClick = async () => {
    if (supportsVision) {
      await openImagePicker()
      return
    }
    notifyModelLacksVision()
  }

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (canDropFiles) {
      setIsDragOver(true)
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // Only set dragOver to false if we're leaving the drop zone entirely
    // In Tauri, relatedTarget can be null, so we need to handle that case
    const relatedTarget = e.relatedTarget as Node | null
    if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
      setIsDragOver(false)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // Ensure drag state is maintained during drag over
    if (canDropFiles) {
      setIsDragOver(true)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)

    if (!canDropFiles) {
      return
    }

    // Check if dataTransfer exists (it might not in some Tauri scenarios)
    if (!e.dataTransfer) {
      console.warn('No dataTransfer available in drop event')
      return
    }

    const files = e.dataTransfer.files
    if (files && files.length > 0) {
      const droppedFiles = Array.from(files)
      const droppedItemPaths = getDroppedItemPathMap(e.dataTransfer.items)
      const imageFiles = droppedFiles.filter(isImageDropFile)
      const documentFiles = droppedFiles.filter((file) => !isImageDropFile(file))

      void (async () => {
        if (imageFiles.length > 0) {
          if (supportsVision) {
            await processImageFiles(imageFiles)
          } else {
            notifyModelLacksVision()
          }
        }

        if (documentFiles.length > 0) {
          if (!attachmentsEnabled) {
            toast.info('Attachments are disabled in Settings')
            return
          }
          const documentInputs: DocumentFileInput[] = []
          for (const file of documentFiles) {
            const path =
              getDroppedDocumentPath(file) ??
              droppedItemPaths.get(droppedFileKey(file))
            documentInputs.push({
              path,
              name: file.name,
              size: file.size,
              file,
            })
          }

          if (documentInputs.length > 0) {
            setMessage('')
            await attachDocumentFiles(documentInputs)
          }
        }
      })()
    }
  }

  const handlePaste = async (e: React.ClipboardEvent) => {
    const clipboardItems = Array.from(e.clipboardData?.items ?? [])
    const imageItems = clipboardItems.filter((item) =>
      item.type.startsWith('image/')
    )

    // Only process images when the selected provider declares vision support.
    if (supportsVision) {
      let hasProcessedImage = false

      // Try clipboardData.items first (traditional method)
      if (imageItems.length > 0) {
        e.preventDefault()

        const files: File[] = []
        let processedCount = 0

        imageItems.forEach((item) => {
          const file = item.getAsFile()
          if (file) {
            files.push(file)
          }
          processedCount++

          // When all items are processed, handle the valid files
          if (processedCount === imageItems.length) {
            if (files.length > 0) {
              const syntheticEvent = {
                target: {
                  files: files,
                },
              } as unknown as React.ChangeEvent<HTMLInputElement>

              handleFileChange(syntheticEvent)
              hasProcessedImage = true
            }
          }
        })

        // If we found image items but couldn't get files, fall through to modern API
        if (processedCount === imageItems.length && !hasProcessedImage) {
          // Continue to modern clipboard API fallback below
        } else {
          return // Successfully processed with traditional method
        }
      }

      // Modern Clipboard API fallback (for Linux, images copied from web, etc.)
      if (
        navigator.clipboard &&
        'read' in navigator.clipboard &&
        !hasProcessedImage
      ) {
        try {
          const clipboardContents = await navigator.clipboard.read()
          const files: File[] = []

          for (const item of clipboardContents) {
            const imageTypes = item.types.filter((type) =>
              type.startsWith('image/')
            )

            for (const type of imageTypes) {
              try {
                const blob = await item.getType(type)
                // Convert blob to File with better naming
                const extension = type.split('/')[1] || 'png'
                const file = new File(
                  [blob],
                  `pasted-image-${Date.now()}.${extension}`,
                  { type }
                )
                files.push(file)
              } catch (error) {
                console.error('Error reading clipboard item:', error)
              }
            }
          }

          if (files.length > 0) {
            e.preventDefault()
            const syntheticEvent = {
              target: {
                files: files,
              },
            } as unknown as React.ChangeEvent<HTMLInputElement>

            handleFileChange(syntheticEvent)
            return
          }
        } catch (error) {
          console.error('Clipboard API access failed:', error)
        }
      }

      // If we reach here, no image was found - allow normal text pasting to continue
      console.log(
        'No image data found in clipboard, allowing normal text paste'
      )
    } else if (
      imageItems.length > 0 &&
      !clipboardItems.some((item) => item.type === 'text/plain')
    ) {
      // Match the picker and drop paths for image-intent pastes (screenshots,
      // copied images carry no text/plain flavor). Pastes that also carry text
      // (e.g. Excel cells ship an image rendition) fall through so the text
      // pastes without a nag. Images visible only to the async Clipboard API
      // are knowingly missed here — probing navigator.clipboard.read() on
      // every paste isn't worth the permission prompts. No preventDefault, so
      // normal text pasting always continues.
      notifyModelLacksVision()
    }
  }

  const isStreaming = chatStatus === 'submitted' || chatStatus === 'streaming'

  return (
    <div className="relative">
      <div className="relative">
        <div
          className={cn(
            'relative overflow-hidden p-0.5 rounded-3xl'
          )}
        >
          {isStreaming && (
            <div className="absolute inset-0">
              <MovingBorder rx="10%" ry="10%">
                <div
                  className={cn(
                    'h-100 w-100 bg-[radial-gradient(var(--app-primary),transparent_60%)]'
                  )}
                />
              </MovingBorder>
            </div>
          )}

          <div
            className={cn(
              'relative z-20 px-0 pb-10 border rounded-3xl border-input bg-white dark:bg-input/30',
              isFocused && 'ring-1 ring-ring/50',
              isDragOver && 'ring-2 ring-ring/50 border-primary'
            )}
            data-drop-zone={canDropFiles ? 'true' : undefined}
            onDragEnter={canDropFiles ? handleDragEnter : undefined}
            onDragLeave={canDropFiles ? handleDragLeave : undefined}
            onDragOver={canDropFiles ? handleDragOver : undefined}
            onDrop={canDropFiles ? handleDrop : undefined}
          >
            {attachments.length > 0 && (
              <div className="flex flex-col gap-2 p-2 pb-0">
                <div className="flex gap-3 items-center">
                  {attachments
                    .map((att, idx) => ({ att, idx }))
                    .map(({ att, idx }) => {
                      const isImage = att.type === 'image'
                      const ext = att.fileType || att.mimeType?.split('/')[1]
                      return (
                        <div
                          key={`${att.type}-${idx}-${att.name}`}
                          className="relative"
                        >
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div
                                className={cn(
                                  'relative border rounded-xl size-14 overflow-hidden',
                                  'flex items-center justify-center'
                                )}
                              >
                                {/* Inner content by state */}
                                {isImage && att.dataUrl ? (
                                  <img
                                    className="object-cover w-full h-full"
                                    src={att.dataUrl}
                                    alt={`${att.name}`}
                                  />
                                ) : (
                                  <div className="flex flex-col items-center justify-center text-muted-foreground">
                                    <IconPaperclip size={18} />
                                    {ext && (
                                      <span className="text-[10px] leading-none mt-0.5 uppercase opacity-70">
                                        .{ext}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                            </TooltipTrigger>
                            <TooltipContent>
                              <div className="text-xs">
                                <div
                                  className="font-medium truncate max-w-52"
                                  title={att.name}
                                >
                                  {att.name}
                                </div>
                                <div className="opacity-70">
                                  {isImage
                                    ? att.mimeType || 'image'
                                    : ext
                                      ? `.${ext}`
                                      : 'document'}
                                  {att.size
                                    ? ` · ${formatBytes(att.size)}`
                                    : ''}
                                </div>
                              </div>
                            </TooltipContent>
                          </Tooltip>

                          {/* Remove button disabled while processing - outside overflow-hidden container */}
                          {!att.processing && (
                            <div
                              className="absolute -top-1 -right-2.5 bg-destructive size-5 flex rounded-full items-center justify-center cursor-pointer"
                              onClick={() => handleRemoveAttachment(idx)}
                            >
                              <IconX
                                className="text-neutral-200"
                                size={14}
                              />
                            </div>
                          )}
                        </div>
                      )
                    })}
                </div>
              </div>
            )}
            {queuedMessages.length > 0 && (
              <div className="flex flex-col gap-1 px-3 pt-2 pb-0">
                {queuedMessages.map((msg) => (
                  <QueuedMessageChip
                    key={msg.id}
                    message={msg}
                    onEdit={(queued) => {
                      // Put the text back in the input for editing, remove from queue
                      setPrompt(queued.text)
                      removeQueuedMessage(queued.id)
                      textareaRef.current?.focus()
                    }}
                    onRemove={removeQueuedMessage}
                  />
                ))}
              </div>
            )}
            <TextareaAutosize
              dir="auto"
              ref={textareaRef}
              minRows={2}
              rows={1}
              maxRows={10}
              value={prompt}
              data-testid={'chat-input'}
              onChange={(e) => {
                setPrompt(e.target.value)
                // Count the number of newlines to estimate rows
                const newRows = (e.target.value.match(/\n/g) || []).length + 1
                setRows(Math.min(newRows, maxRows))
              }}
              onKeyDown={(e) => {
                // e.keyCode 229 is for IME input with Safari
                const isComposing =
                  e.nativeEvent.isComposing || e.keyCode === 229
                if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
                  e.preventDefault()
                  // Submit prompt when Enter is pressed without Shift and prompt is not empty.
                  // If streaming, handleSendMessage will queue the message automatically.
                  if (prompt.trim() && !ingestingAny) {
                    handleSendMessage(prompt)
                  }
                  // When Shift+Enter is pressed, a new line is added (default behavior)
                }
                // Navigate prompt history with Up/Down arrow keys
                if (e.key === 'ArrowUp' && !isComposing) {
                  const textarea = e.currentTarget
                  const cursorAtStart =
                    textarea.selectionStart === 0 &&
                    textarea.selectionEnd === 0
                  if (cursorAtStart || !prompt) {
                    e.preventDefault()
                    navigateHistory('up')
                  }
                }
                if (e.key === 'ArrowDown' && !isComposing) {
                  const textarea = e.currentTarget
                  const cursorAtEnd =
                    textarea.selectionStart === prompt.length &&
                    textarea.selectionEnd === prompt.length
                  if (cursorAtEnd) {
                    e.preventDefault()
                    navigateHistory('down')
                  }
                }
              }}
              onPaste={handlePaste}
              placeholder={
                isBiyanTeamsThread
                  ? t('common:placeholder.biyanTeamsChatInput')
                  : t('common:placeholder.chatInput')
              }
              autoFocus
              spellCheck={spellCheckChatInput}
              data-gramm={spellCheckChatInput}
              data-gramm_editor={spellCheckChatInput}
              data-gramm_grammarly={spellCheckChatInput}
              className={cn(
                'bg-transparent pt-4 w-full shrink-0 border-none resize-none outline-0 px-4',
                rows < maxRows && 'scrollbar-hide',
                className
              )}
            />
          </div>
        </div>

        <div className="absolute z-20 bg-transparent bottom-0 w-full p-2 ">
          <div className="flex justify-between items-center w-full">
            <div className="px-1 flex items-center gap-1 flex-1 min-w-0">
              <div
                className={cn(
                  'px-1 flex items-center w-full gap-1',
                  isStreaming && 'opacity-50 pointer-events-none'
                )}
              >
                {/* Dropdown for attachments — hidden in agent mode */}
                {!effectiveAgentMode && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="secondary" size="icon-sm" className='rounded-full mr-2 mb-1'>
                      <PlusIcon size={18} className="text-muted-foreground" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {/* Vision image attachment - requires a vision-capable model */}
                    <DropdownMenuItem onClick={handleImagePickerClick}>
                      <IconPhoto size={18} className="text-muted-foreground" />
                      <span>{t('common:chatInputActions.addImages')}</span>
                      <input
                        type="file"
                        ref={fileInputRef}
                        className="hidden"
                        multiple
                        onChange={handleFileChange}
                      />
                    </DropdownMenuItem>
                    {/* Remote-native or fully parsed document attachments. */}
                    <DropdownMenuItem
                      onClick={handleAttachDocsIngest}
                      disabled={!canAttachDocumentFiles}
                    >
                      {ingestingDocs ? (
                        <IconLoader2
                          size={18}
                          className="text-muted-foreground animate-spin"
                        />
                      ) : (
                        <IconPaperclip
                          size={18}
                          className="text-muted-foreground"
                        />
                      )}
                      <span>
                        {ingestingDocs
                          ? 'Processing files…'
                          : t('common:chatInputActions.addDocumentsOrFiles')}
                      </span>
                    </DropdownMenuItem>
                    {/* Use Assistant - only show when no projectId */}
                    {!projectId && assistantCount < 2 && (
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>
                          <IconUser size={18} className="text-muted-foreground" />
                          <span>{t('common:chatInputActions.useAssistant')}</span>
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="max-h-64 overflow-y-auto">
                          <AssistantsMenu
                            selectedAssistant={selectedAssistantId}
                            setSelectedAssistant={setSelectedAssistantId}
                            currentThread={currentThread}
                            updateCurrentThreadAssistant={
                              updateCurrentThreadAssistant
                            }
                            assistants={assistants}
                          />
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                {!projectId && assistantCount >= 2 && (
                  <DropdownMenu>
                    <Tooltip
                      open={tooltipShown === 'assistants'}
                      onOpenChange={(newValue) =>
                        setTooltipShown(newValue ? 'assistants' : false)
                      }
                    >
                      <TooltipTrigger asChild>
                        <DropdownMenuTrigger
                          asChild
                          onPointerDown={() => {
                            wasPointerDown.current = true
                          }}
                          onKeyDown={() => {
                            wasPointerDown.current = false
                          }}
                        >
                          <Button
                            variant="secondary"
                            size="icon-sm"
                            className="rounded-full mr-2 mb-1"
                          >
                            {avatar && (
                              <AvatarEmoji
                                avatar={avatar}
                                imageClassName="w-4 h-4 object-contain"
                                textClassName="text-xs relative inline-block"
                              />
                            )}
                            {!avatar && (
                              <IconUser
                                size={18}
                                className="text-muted-foreground"
                              />
                            )}
                          </Button>
                        </DropdownMenuTrigger>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>{t('assistants')}</p>
                      </TooltipContent>
                    </Tooltip>
                    <DropdownMenuContent
                      onCloseAutoFocus={(event) => {
                        if (wasPointerDown.current) {
                          event.preventDefault()
                        }
                      }}
                      align="start"
                    >
                      <AssistantsMenu
                        selectedAssistant={selectedAssistantId}
                        setSelectedAssistant={setSelectedAssistantId}
                        currentThread={currentThread}
                        updateCurrentThreadAssistant={
                          updateCurrentThreadAssistant
                        }
                        assistants={assistants}
                      />
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}

                {!effectiveAgentMode &&
                  modelSupportsTools &&
                  hasActiveMCPServers &&
                  (MCPToolComponent ? (
                    // Use custom MCP component
                    <McpExtensionToolLoader
                      tools={tools}
                      hasActiveMCPServers={hasActiveMCPServers}
                      selectedModelHasTools={modelSupportsTools}
                      initialMessage={initialMessage}
                      MCPToolComponent={MCPToolComponent}
                    />
                  ) : (
                    // Use default tools dropdown
                    <Tooltip
                      open={tooltipShown === 'tools'}
                      onOpenChange={(newValue) =>
                        newValue
                          ? setTooltipShown('tools')
                          : setTooltipShown(false)
                      }
                    >
                      <TooltipTrigger
                        asChild
                        disabled={dropdownToolsAvailable}
                      >
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={(e) => {
                            setDropdownToolsAvailable(false)
                            e.stopPropagation()
                          }}
                        >
                          <DropdownToolsAvailable
                            initialMessage={initialMessage}
                            onOpenChange={(isOpen) => {
                              setDropdownToolsAvailable(isOpen)
                              if (isOpen) {
                                setTooltipShown(false)
                              }
                            }}
                          >
                            {() => {
                              return (
                                <div
                                  className={cn(
                                    'p-1 flex items-center justify-center rounded-sm transition-all duration-200 ease-in-out gap-1 cursor-pointer',
                                  )}
                                >
                                  <IconTool
                                    size={18}
                                    className={cn(
                                      'text-muted-foreground',
                                    )}
                                  />
                                </div>
                              )
                            }}
                          </DropdownToolsAvailable>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>{t('tools')}</p>
                      </TooltipContent>
                    </Tooltip>
                  ))}

                {/* Agent mode toggle hidden — kept as dead code for future use */}
                {false && !projectId && isAgentMode && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant={isAgentMode ? "default" : "ghost"}
                        size="icon-xs"
                        onClick={currentThreadId ? handleAgentToggle : undefined}
                        className={cn(
                          isAgentMode && 'text-primary bg-primary/10 hover:bg-primary/10 items-center',
                          !currentThreadId && 'cursor-default pointer-events-none'
                        )}
                      >
                        <BotIcon
                          className={cn(
                            'text-muted-foreground -mt-0.5',
                            isAgentMode && 'text-primary'
                          )}
                        />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>
                        {isAgentMode
                          ? 'Agent mode active'
                          : 'Enable agent mode'}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                )}

                {showAutoRunToggle && onToggleAutoRunPanel && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={
                          autoRunPanelVisible
                            ? t('chat:autoRun.hidePanel')
                            : t('chat:autoRun.showPanel')
                        }
                        aria-pressed={autoRunPanelVisible}
                        className={cn(autoRunPanelVisible && 'text-primary')}
                        onClick={onToggleAutoRunPanel}
                      >
                        <Repeat2
                          size={18}
                          className={cn(
                            'text-muted-foreground',
                            autoRunPanelVisible && 'text-primary'
                          )}
                        />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>
                        {autoRunPanelVisible
                          ? t('chat:autoRun.hidePanel')
                          : t('chat:autoRun.showPanel')}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                )}

                {!effectiveAgentMode && selectedModel?.capabilities?.includes('reasoning') && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon-xs">
                        <IconAtom
                          size={18}
                          className="text-muted-foreground"
                        />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{t('reasoning')}</p>
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {isStreaming ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="destructive"
                      size="icon-sm"
                      className="rounded-full mr-1 mb-1"
                      onClick={() => {
                        if (!currentThreadId) return
                        const queue = useMessageQueue.getState().getQueue(currentThreadId)
                        if (queue.length > 0) {
                          useMessageQueue.getState().clearQueue(currentThreadId)
                        } else {
                          stopStreaming(currentThreadId)
                        }
                      }}
                    >
                      <IconPlayerStopFilled />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{queueLength > 0 ? `Clear ${queueLength} queued message(s)` : 'Stop generating'}</p>
                  </TooltipContent>
                </Tooltip>
              ) : (
                <Button
                  variant="default"
                  size="icon-sm"
                  disabled={!prompt.trim() || ingestingAny}
                  data-test-id="send-message-button"
                  onClick={() => handleSendMessage(prompt)}
                  className="rounded-full mr-1 mb-1"
                >
                  <ArrowRight className="text-primary-fg" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {message && (
        <div className="-mt-0.5 mx-2 pb-2 px-3 pt-1.5 rounded-b-lg text-xs text-destructive transition-all duration-200 ease-in-out">
          <div className="flex items-center gap-1 justify-between">
            {message}
            <IconX
              className="size-3 text-muted-foreground cursor-pointer"
              onClick={() => {
                setMessage('')
                // Reset file input to allow re-uploading the same file
                if (fileInputRef.current) {
                  fileInputRef.current.value = ''
                }
              }}
            />
          </div>
        </div>
      )}

    </div>
  )
})

export default ChatInput
