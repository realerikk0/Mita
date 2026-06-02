import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute, useParams, useSearch } from '@tanstack/react-router'
import { cn } from '@/lib/utils'

import HeaderPage from '@/containers/HeaderPage'
import { ProviderQuotaActions } from '@/components/ProviderQuotaActions'
import { useThreads } from '@/hooks/useThreads'
import ChatInput from '@/containers/ChatInput'
import { AutoRunPanel } from '@/containers/AutoRunPanel'
import { useShallow } from 'zustand/react/shallow'
import { MessageItem } from '@/containers/MessageItem'

import { useMessages } from '@/hooks/useMessages'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useTools } from '@/hooks/useTools'
import { useAppState } from '@/hooks/useAppState'
import { SESSION_STORAGE_PREFIX } from '@/constants/chat'
import { useChat } from '@/hooks/use-chat'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useAssistant } from '@/hooks/useAssistant'
import { renderInstructions } from '@/lib/instructionTemplate'
import { ensureMitaIdentityGuard } from '@/lib/mita-prompt'
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import {
  generateId,
  lastAssistantMessageIsCompleteWithToolCalls,
  type ChatStatus,
} from 'ai'
import type { UIMessage } from '@ai-sdk/react'
import { useChatSessions } from '@/stores/chat-session-store'
import {
  convertThreadMessagesToUIMessages,
  convertThreadMessageToUIMessage,
  extractContentPartsFromUIMessage,
} from '@/lib/messages'
import {
  extractPseudoToolTranscripts,
  isPseudoToolTranscriptExecutable,
} from '@/lib/pseudo-tool-transcript'
import { newAssistantThreadContent, newUserThreadContent } from '@/lib/completion'
import {
  ThreadMessage,
  MessageStatus,
  ChatCompletionRole,
  ContentType,
} from '@janhq/core'
import { createImageAttachment } from '@/types/attachment'
import {
  useChatAttachments,
  NEW_THREAD_ATTACHMENT_KEY,
} from '@/hooks/useChatAttachments'
import { processAttachmentsForSend } from '@/lib/attachmentProcessing'
import { useAttachments } from '@/hooks/useAttachments'
import { PromptProgress } from '@/components/PromptProgress'
import { useToolAvailable } from '@/hooks/useToolAvailable'
import { useMCPServers } from '@/hooks/useMCPServers'
import { OUT_OF_CONTEXT_SIZE } from '@/utils/error'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { IconAlertCircle, IconRefresh } from '@tabler/icons-react'
import { useToolApproval } from '@/hooks/useToolApproval'
import DropdownModelProvider from '@/containers/DropdownModelProvider'
import { ExtensionTypeEnum, VectorDBExtension } from '@janhq/core'
import { ExtensionManager } from '@/lib/extension'
import { Shimmer } from '@/components/ai-elements/shimmer'
import { useAgentMode } from '@/hooks/useAgentMode'
import { useAutoRunStore } from '@/stores/auto-run-store'
import { useMessageQueue } from '@/stores/message-queue-store'
import { useWebSearch } from '@/hooks/useWebSearch'
import { generateThreadTitle } from '@/lib/thread-title-summarizer'
import { ModelFactory } from '@/lib/model-factory'
import { providerQuotaErrorFromUnknown } from '@/lib/provider-quota-error'
import {
  DEFAULT_COMPACT_RECENT_TOKEN_LIMIT,
  compactThreadMessages,
  normalizeAutoCompactThreshold,
  shouldAutoCompactThread,
  type MitaCompactTrigger,
} from '@/lib/compact-thread'
import { useAutoScroll } from '@/hooks/useAutoScroll'
import { toast } from 'sonner'
import {
  DEFAULT_MITA_AGENTS,
  DEFAULT_MITA_AUTO_RUN,
  type MitaAutoRunMetadata,
  type MitaMessageMetadata,
} from '@/types/mita-agent'
import { MitaTeamsWorkspace } from '@/containers/MitaTeamsWorkspace'
import {
  MITA_TEAMS_ORCHESTRATOR_ROLE_ID,
  normalizeMitaTeamsConfig,
  renderMitaTeamsSystemInstructions,
  type MitaTeamsConfig,
} from '@/types/mita-teams'
import { trackMitaEvent } from '@/lib/analytics'
import {
  answerMitaTeamsChoice,
  withMitaTeamsRuntime,
} from '@/lib/mita-teams-memory'
import {
  runMitaTeamsPrivateRoleChat,
  runMitaTeamsRuntime,
} from '@/lib/mita-teams-runtime'

const CHAT_STATUS = {
  STREAMING: 'streaming',
  SUBMITTED: 'submitted',
} as const

// Title summarization constants
const MAX_TITLE_SUMMARIZATION_ATTEMPTS = 3
const TITLE_SUMMARIZATION_MIN_LENGTH = 50
export const MAX_MCP_TOOL_FOLLOW_UP_ROUNDS = 5

function numericParam(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function booleanParam(value: unknown, defaultValue: boolean): boolean {
  if (value === undefined || value === null) return defaultValue
  return value === true || value === 'true'
}

function messageLengthBucket(text: string) {
  const length = text.trim().length
  if (length === 0) return 'attachments_only'
  if (length <= 80) return 'short'
  if (length <= 500) return 'medium'
  if (length <= 2_000) return 'long'
  return 'very_long'
}

function getConfiguredMaxContextTokens(
  parameters: Record<string, unknown>,
  model?: Model | null
): number {
  const explicit = numericParam(parameters.max_context_tokens)
  if (explicit) return explicit

  const settings = model?.settings as
    | Record<string, { controller_props?: { value?: unknown } }>
    | undefined
  const modelContext = numericParam(settings?.ctx_len?.controller_props?.value)
  return modelContext ?? 0
}

const createAutoRunPrompt = (round: number, maxRounds: number) =>
  `继续执行主人交代的任务，给出下一步结果；当前为第 ${round} / ${maxRounds} 轮。保持安静、直接、可执行。`

function messageHasToolCallPart(message: UIMessage): boolean {
  const parts = Array.isArray(message.parts) ? message.parts : []

  return parts.some((part) => {
    if (!part || typeof part !== 'object') return false
    const type = (part as { type?: string }).type
    return typeof type === 'string' && type.startsWith('tool-')
  })
}

export function countToolCallAssistantRoundsSinceLastUser(
  messages: UIMessage[]
): number {
  let rounds = 0

  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message.role === 'user') break
    if (message.role === 'assistant' && messageHasToolCallPart(message)) {
      rounds++
    }
  }

  return rounds
}

export function isWithinMcpToolFollowUpLimit(
  messages: UIMessage[],
  maxRounds = MAX_MCP_TOOL_FOLLOW_UP_ROUNDS
): boolean {
  return countToolCallAssistantRoundsSinceLastUser(messages) < maxRounds
}

const COMPUTER_AGENT_TOOL_PREFIX = 'computer_agent_'
const LEGACY_COMPUTER_TOOL_PREFIX = 'computer_'
const COMPUTER_AGENT_THREAD_APPROVAL_TOOL = '__mita_computer_agent_thread__'
const COMPUTER_THREAD_ID_ARG = '_mitaThreadId'

function isComputerAgentToolName(toolName: string) {
  return (
    toolName.startsWith(COMPUTER_AGENT_TOOL_PREFIX) ||
    toolName.startsWith(LEGACY_COMPUTER_TOOL_PREFIX)
  )
}

type PendingToolCall = {
  toolCallId: string
  toolName: string
  input: unknown
}

function getExecutablePseudoToolCalls(
  message: UIMessage,
  options: {
    ragToolNames: Set<string>
    mcpToolNames: Set<string>
  }
): PendingToolCall[] {
  if (message.role !== 'assistant') return []

  const calls: PendingToolCall[] = []
  const parts = Array.isArray(message.parts) ? message.parts : []

  for (const [partIndex, part] of parts.entries()) {
    if (part.type !== 'text') continue
    const text = (part as { type: 'text'; text?: string }).text
    if (!text) continue

    for (const [callIndex, transcript] of extractPseudoToolTranscripts(
      text
    ).entries()) {
      if (!isPseudoToolTranscriptExecutable(transcript)) continue
      const toolName = transcript.toolName
      const toolIsAvailable =
        options.ragToolNames.has(toolName) ||
        options.mcpToolNames.has(toolName) ||
        isComputerAgentToolName(toolName)
      if (!toolIsAvailable) continue

      calls.push({
        toolCallId: `pseudo-${message.id}-${partIndex}-${callIndex}`,
        toolName,
        input: transcript.input,
      })
    }
  }

  return calls
}

function asToolInput(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function computerAgentApprovalDetails(
  toolName: string,
  input: Record<string, unknown>
) {
  const affectedPaths = [
    stringValue(input.path),
    stringValue(input.directory),
    stringValue(input.cwd),
    stringValue(input.from),
    stringValue(input.to),
  ].filter(Boolean) as string[]

  const runsShell =
    toolName === 'computer_agent_run_shell' || toolName === 'computer_run_shell'
  const trashesPath =
    toolName === 'computer_agent_trash_path' || toolName === 'computer_trash_path'
  const opensPath =
    toolName === 'computer_agent_open_path' || toolName === 'computer_open_path'

  const commandPreview = runsShell ? stringValue(input.command) : undefined

  const riskSummary =
    runsShell
      ? 'Runs a local shell command in Mita sandbox limits.'
      : trashesPath
        ? 'Moves a local file or folder to the system trash.'
        : opensPath
          ? 'Opens a local path with the operating system.'
          : 'Reads or modifies files inside Mita Computer Agent roots.'

  return {
    alwaysConfirm: true,
    riskSummary,
    affectedPaths,
    commandPreview,
  }
}

function computerAgentApprovalOptions(
  approvalPolicy: 'alwaysAsk' | 'oncePerThread' | 'never',
  toolName: string,
  input: Record<string, unknown>
) {
  const details = computerAgentApprovalDetails(toolName, input)

  if (approvalPolicy === 'never') {
    return null
  }

  if (approvalPolicy === 'oncePerThread') {
    return {
      options: {
        ...details,
        alwaysConfirm: false,
        bypassGlobalAutoApproval: true,
      },
      rememberThreadApproval: true,
    }
  }

  return {
    options: details,
    rememberThreadApproval: false,
  }
}

type ThreadModel = {
  id: string
  provider: string
}

type SearchParams = {
  threadModel?: ThreadModel
}

// as route.threadsDetail
export const Route = createFileRoute('/threads/$threadId')({
  component: ThreadDetail,
  validateSearch: (search: Record<string, unknown>): SearchParams => {
    return {
      threadModel: search.threadModel as ThreadModel | undefined,
    }
  },
})

function ThreadDetail() {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const { threadId } = useParams({ from: Route.id })
  const search = useSearch({ from: Route.id })
  const searchThreadModel = search.threadModel
  const setCurrentThreadId = useThreads((state) => state.setCurrentThreadId)
  const updateThread = useThreads((state) => state.updateThread)
  const setMessages = useMessages((state) => state.setMessages)
  const addMessage = useMessages((state) => state.addMessage)
  const updateMessage = useMessages((state) => state.updateMessage)
  const deleteMessage = useMessages((state) => state.deleteMessage)
  const currentThread = useRef<string | undefined>(undefined)

  useTools()

  // Get attachments for this thread
  const attachmentsKey = threadId ?? NEW_THREAD_ATTACHMENT_KEY
  const getAttachments = useChatAttachments((state) => state.getAttachments)
  const clearAttachmentsForThread = useChatAttachments(
    (state) => state.clearAttachments
  )

  // Session data for tool call tracking
  const getSessionData = useChatSessions((state) => state.getSessionData)
  const sessionData = getSessionData(threadId)

  // AbortController for cancelling tool calls
  const toolCallAbortController = useRef<AbortController | null>(null)

  // Title auto-summarization state
  const titleAbortRef = useRef<AbortController | null>(null)
  const titleAttemptsRef = useRef(0)
  const pendingAutoRunResponseMetaRef = useRef<{
    mita: MitaMessageMetadata
  } | null>(null)
  const autoRunSendingRef = useRef(false)

  // Check if we should follow up with tool calls (respects abort signal)
  const followUpMessage = useCallback(
    ({ messages }: { messages: UIMessage[] }) => {
      if (
        !toolCallAbortController.current ||
        toolCallAbortController.current?.signal.aborted
      ) {
        return false
      }
      if (!lastAssistantMessageIsCompleteWithToolCalls({ messages })) {
        return false
      }
      return isWithinMcpToolFollowUpLimit(messages)
    },
    []
  )

  // Subscribe directly to the thread data to ensure updates when model changes
  const thread = useThreads(useShallow((state) => state.threads[threadId]))
  const autoRun =
    useAutoRunStore((state) => state.runs[threadId]) ??
    DEFAULT_MITA_AUTO_RUN

  // Get model and provider for useChat
  const selectedModel = useModelProvider((state) => state.selectedModel)
  const selectedProvider = useModelProvider((state) => state.selectedProvider)
  const getProviderByName = useModelProvider((state) => state.getProviderByName)
  const selectModelProvider = useModelProvider(
    (state) => state.selectModelProvider
  )
  const computerAgentEnabled = useMCPServers(
    (state) => state.settings.computerAgentEnabled
  )
  const computerAgentShellEnabled = useMCPServers(
    (state) => state.settings.computerAgentShellEnabled
  )
  const computerAgentApprovalPolicy = useMCPServers(
    (state) => state.settings.computerAgentApprovalPolicy
  )
  const computerAgentSandboxAccess = useMCPServers(
    (state) => state.settings.computerAgentSandboxAccess
  )
  const threadRef = useRef(thread)
  const projectId = threadRef.current?.metadata?.project?.id
  const threadModel = useMemo(
    () => searchThreadModel ?? thread?.model,
    [searchThreadModel, thread]
  )
  const mitaTeamsConfig = useMemo(
    () => normalizeMitaTeamsConfig(thread?.metadata?.mitaTeams, threadModel),
    [thread?.metadata?.mitaTeams, threadModel]
  )
  const activeMitaChatRole = useMemo(() => {
    if (!mitaTeamsConfig) return undefined
    if (mitaTeamsConfig.workspaceView === 'role-chat') {
      return mitaTeamsConfig.roles.find(
        (role) => role.id === mitaTeamsConfig.activeRoleId
      )
    }
    return (
      mitaTeamsConfig.roles.find(
        (role) => role.id === MITA_TEAMS_ORCHESTRATOR_ROLE_ID
      ) ??
      mitaTeamsConfig.roles[0]
    )
  }, [mitaTeamsConfig])
  const activeMitaThreadModel = useMemo(() => {
    if (!activeMitaChatRole?.provider || !activeMitaChatRole.modelId) {
      return undefined
    }
    const provider = getProviderByName(activeMitaChatRole.provider)
    const model = provider?.models.find(
      (item) => item.id === activeMitaChatRole.modelId
    )

    return {
      ...(model ?? {}),
      id: activeMitaChatRole.modelId,
      provider: activeMitaChatRole.provider,
    } as ThreadModel
  }, [activeMitaChatRole, getProviderByName])
  const effectiveThreadModel = mitaTeamsConfig
    ? (activeMitaThreadModel ?? threadModel)
    : threadModel
  const [isEditingMitaTeamsTitle, setIsEditingMitaTeamsTitle] = useState(false)
  const [mitaTeamsTitleDraft, setMitaTeamsTitleDraft] = useState(
    thread?.title || 'Mita Teams'
  )

  useEffect(() => {
    if (!isEditingMitaTeamsTitle) {
      setMitaTeamsTitleDraft(thread?.title || 'Mita Teams')
    }
  }, [isEditingMitaTeamsTitle, thread?.title])

  const commitMitaTeamsTitle = useCallback(() => {
    const nextTitle = mitaTeamsTitleDraft.trim() || 'Mita Teams'
    if (nextTitle !== thread?.title) {
      updateThread(threadId, { title: nextTitle })
    }
    setIsEditingMitaTeamsTitle(false)
  }, [mitaTeamsTitleDraft, thread?.title, threadId, updateThread])

  // Always include the Mita identity guard so model-native Jan/Menlo
  // personas do not leak when a thread has no assigned assistant.
  const threadAssistant = thread?.assistants?.[0]
  const systemMessage = renderInstructions(
    `${ensureMitaIdentityGuard(threadAssistant?.instructions)}

Tool result communication:
- Treat tool cards as raw call records only; do not rely on them as the user-facing explanation.
- After one or more tool calls complete, write a short assistant-body summary before continuing.
- Summarize the result in readable prose or bullets. For failures, state the error briefly and say what you will try next.
- Use the structured tool-calling channel only. Never write pseudo tool transcripts such as <tool_call>, <tool_response>, or web_search({...}) in normal assistant text.
- If the structured tool channel is unavailable, say that you cannot use that tool right now instead of simulating a tool call or result.
- If Mita converts a pseudo tool transcript into a real tool call, summarize only the real tool output that Mita provides.${
      mitaTeamsConfig
        ? `\n\n${renderMitaTeamsSystemInstructions(mitaTeamsConfig)}`
        : ''
    }${
      computerAgentEnabled
        ? `\n\nComputer Agent guidance:
- Prefer structured computer tools for file and folder work.
- If the user asks to create a file without a path, omit the directory so Mita uses the private thread workspace.
- Do not invent absolute paths. Ask for a folder or use the thread workspace when the user gives no path.
- The current Computer Agent sandbox access is ${computerAgentSandboxAccess === 'readOnly' ? 'read-only' : 'read-write'}.${
            computerAgentApprovalPolicy === 'never'
              ? '\n- The user has disabled Computer Agent approval prompts, so keep tool arguments especially precise and minimal.'
              : '\n- Computer Agent actions may require user approval, so keep tool arguments precise and minimal.'
          }${
            computerAgentShellEnabled
              ? '\n- Use computer_agent_run_shell only when structured computer tools are insufficient.'
              : ''
          }`
        : ''
    }`
  )

  useEffect(() => {
    threadRef.current = thread
  }, [thread])

  useEffect(() => {
    const metadata = thread?.metadata as
      | (Record<string, unknown> & {
          mitaAutoRun?: MitaAutoRunMetadata
          silenceAutoRun?: MitaAutoRunMetadata
        })
      | undefined
    const storedAutoRun = metadata?.mitaAutoRun ?? metadata?.silenceAutoRun
    if (!storedAutoRun) return

    useAutoRunStore.getState().setRun(threadId, {
      ...DEFAULT_MITA_AUTO_RUN,
      ...storedAutoRun,
    })
  }, [
    threadId,
    thread?.metadata?.mitaAutoRun,
    thread?.metadata?.silenceAutoRun,
  ])

  const persistAutoRunState = useCallback(
    (patch: Partial<MitaAutoRunMetadata>) => {
      const nextRun = useAutoRunStore.getState().patchRun(threadId, patch)
      const currentThread =
        useThreads.getState().threads[threadId] ?? threadRef.current

      useThreads.getState().updateThread(threadId, {
        metadata: {
          mitaAutoRun: nextRun,
          mitaAgents:
            currentThread?.metadata?.mitaAgents ??
            currentThread?.metadata?.silenceAgents ??
            DEFAULT_MITA_AGENTS,
        },
      })

      return nextRun
    },
    [threadId]
  )

  // Holds the partial assistant message while the model reloads after a
  // context-limit hit, so the user sees it instead of a blank gap.
  const [pendingContinueMessage, setPendingContinueMessage] =
    useState<UIMessage | null>(null)
  const [autoIncreaseAttempts, setAutoIncreaseAttempts] = useState(0)
  const MAX_AUTO_INCREASE_ATTEMPTS = 3
  const isAutoIncreasingContext =
    autoIncreaseAttempts > 0 &&
    autoIncreaseAttempts < MAX_AUTO_INCREASE_ATTEMPTS
  const [contextLimitError, setContextLimitError] = useState<Error | null>(null)
  const [processingEmbeddings, setProcessingEmbeddings] = useState(false)
  const rawChatStatusRef = useRef<ChatStatus>('ready')
  const [settledChatStatus, setSettledChatStatus] =
    useState<ChatStatus | null>(null)
  const mitaTeamsAbortRef = useRef<AbortController | null>(null)
  const mitaTeamsAnsweredChoiceIdsRef = useRef<Set<string>>(new Set())
  const [isMitaTeamsRuntimeBusy, setIsMitaTeamsRuntimeBusy] = useState(false)
  const resetSettledChatStatus = useCallback(() => {
    setSettledChatStatus(null)
    rawChatStatusRef.current = CHAT_STATUS.SUBMITTED
  }, [])
  const markChatReadyAfterFinish = useCallback(
    (finishReason?: string, isAbort?: boolean, isError?: boolean) => {
      if (isAbort || isError || finishReason === 'length') return

      queueMicrotask(() => {
        const rawStatus = rawChatStatusRef.current
        if (
          rawStatus === CHAT_STATUS.SUBMITTED ||
          rawStatus === CHAT_STATUS.STREAMING
        ) {
          const updateSessionStatus = useChatSessions.getState().updateStatus
          if (typeof updateSessionStatus === 'function') {
            updateSessionStatus(threadId, 'ready')
          }
          setSettledChatStatus('ready')
        }
      })
    },
    [threadId]
  )

  const summarizeThreadTitleFromText = useCallback(
    (titleText: string, options: { forceGenerate?: boolean } = {}) => {
      const currentThread =
        useThreads.getState().threads[threadId] ?? threadRef.current
      if (
        !currentThread ||
        currentThread.metadata?.titleSummarized ||
        titleAttemptsRef.current >= MAX_TITLE_SUMMARIZATION_ATTEMPTS
      ) {
        return
      }

      const trimmedTitleText = titleText.trim()
      if (!trimmedTitleText) return

      if (
        !options.forceGenerate &&
        trimmedTitleText.length < TITLE_SUMMARIZATION_MIN_LENGTH
      ) {
        useThreads.getState().updateThread(threadId, {
          metadata: {
            ...currentThread.metadata,
            titleSummarized: true,
          },
        })
        return
      }

      titleAbortRef.current?.abort()
      const controller = new AbortController()
      titleAbortRef.current = controller
      titleAttemptsRef.current++
      const originalTitle = currentThread.title

      generateThreadTitle(trimmedTitleText, controller.signal).then((title) => {
        if (!title || controller.signal.aborted) return
        const latestThread =
          useThreads.getState().threads[threadId] ?? threadRef.current
        if (!latestThread || latestThread.title !== originalTitle) return

        useThreads.getState().updateThread(threadId, {
          title,
          metadata: {
            ...latestThread.metadata,
            titleSummarized: true,
          },
        })
        titleAbortRef.current = null
      })
    },
    [threadId]
  )

  // Refs so onFinish (captured in closure) always calls the latest callbacks
  const handleContextSizeIncreaseRef = useRef<(() => void) | null>(null)
  const setContinueFromContentRef = useRef<((content: string) => void) | null>(
    null
  )

  // Use the AI SDK chat hook
  const {
    messages: chatMessages,
    status,
    error,
    sendMessage,
    regenerate,
    setMessages: setChatMessages,
    stop,
    addToolOutput,
    updateRagToolsAvailability,
    setContinueFromContent,
  } = useChat({
    sessionId: threadId,
    sessionTitle: thread?.title,
    systemMessage,
    experimental_throttle: 50,
    onFinish: ({ message, isAbort, isError }) => {
      const structuredToolCalls = [...sessionData.tools] as PendingToolCall[]
      const ragToolNames = useAppState.getState().ragToolNames
      const mcpToolNames = useAppState.getState().mcpToolNames
      const pseudoToolCalls =
        !isAbort && structuredToolCalls.length === 0
          ? getExecutablePseudoToolCalls(message, {
              ragToolNames,
              mcpToolNames,
            })
          : []

      if (pseudoToolCalls.length > 0) {
        message = {
          ...message,
          parts: [
            ...(message.parts ?? []),
            ...pseudoToolCalls.map((toolCall) => ({
              type: `tool-${toolCall.toolName}` as `tool-${string}`,
              toolCallId: toolCall.toolCallId,
              input: toolCall.input,
              state: 'input-available' as const,
            })),
          ],
        }
        setChatMessages((prev) =>
          prev.map((item) => (item.id === message.id ? message : item))
        )
      }

      const msgMeta = message.metadata as Record<string, unknown> | undefined
      const finishReason = msgMeta?.finishReason as string | undefined
      markChatReadyAfterFinish(finishReason, isAbort, isError)

      // Context limit hit: send partial content as prefill so the model continues
      // from where it stopped. The stream wrapper injects it as the first text-delta
      // of the new message, so the user sees the partial text immediately.
      if (!isAbort && finishReason === 'length') {
        const selectedModelState = useModelProvider.getState().selectedModel
        const usage = msgMeta?.usage as
          | { inputTokens?: number; outputTokens?: number }
          | undefined
        const totalTokens =
          (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0)
        const ctxLen =
          (selectedModelState?.settings?.ctx_len?.controller_props
            ?.value as number) ?? 32768
        const isContextLimit = totalTokens >= ctxLen * 0.9

        if (isContextLimit) {
          const autoIncrease =
            selectedModelState?.settings?.auto_increase_ctx_len
              ?.controller_props?.value ?? true
          if (autoIncrease) {
            const partialText = message.parts
              .filter((p) => p.type === 'text')
              .map((p) => (p as { type: 'text'; text: string }).text)
              .join('')
            if (partialText) {
              setContinueFromContentRef.current?.(partialText)
              // Keep the partial message visible while the model reloads
              setPendingContinueMessage(message)
            }
            handleContextSizeIncreaseRef.current?.()
          } else {
            setContextLimitError(new Error(OUT_OF_CONTEXT_SIZE))
          }
        }
        return
      }

      if (!isAbort && message.parts.length) setPendingContinueMessage(null)

      // Persist assistant message to backend (skip if aborted).
      // For continuations, message.parts already contains partial + new content
      // because the stream wrapper prepended the partial text as the first delta.
      if (!isAbort && message.role === 'assistant') {
        const contentParts = extractContentPartsFromUIMessage(message)

        if (contentParts.length > 0) {
          const messageMetadata = (message.metadata || {}) as Record<
            string,
            unknown
          >
          if (pendingAutoRunResponseMetaRef.current) {
            messageMetadata.mita =
              pendingAutoRunResponseMetaRef.current.mita
            pendingAutoRunResponseMetaRef.current = null
          }

          const assistantMessage: ThreadMessage = {
            type: 'text',
            role: ChatCompletionRole.Assistant,
            content: contentParts,
            id: message.id,
            object: 'thread.message',
            thread_id: threadId,
            status: MessageStatus.Ready,
            created_at: Date.now(),
            completed_at: Date.now(),
            metadata: messageMetadata,
          }

          // Check if message with this ID already exists (onFinish can be called multiple times)
          const existingMessages = useMessages.getState().getMessages(threadId)
          const existingMessage = existingMessages.find(
            (m) => m.id === message.id
          )

          if (existingMessage) {
            updateMessage(assistantMessage)
          } else {
            addMessage(assistantMessage)
          }
        }
      }

      // Create a new AbortController for tool calls
      toolCallAbortController.current = new AbortController()
      const signal = toolCallAbortController.current.signal

      const toolCallsToProcess = [...structuredToolCalls, ...pseudoToolCalls]

      // Process tool calls sequentially, requesting approval for each if needed
      ;(async () => {
        for (const toolCall of toolCallsToProcess) {
          // Check if already aborted before starting
          if (signal.aborted) {
            break
          }

          try {
            const toolName = toolCall.toolName
            const toolInput = asToolInput(toolCall.input)
            const isComputerAgentTool = isComputerAgentToolName(toolName)
            const toolKind = ragToolNames.has(toolName)
              ? 'rag'
              : isComputerAgentTool
                ? 'computer'
                : mcpToolNames.has(toolName)
                  ? 'mcp'
                  : 'unknown'
            const toolStartedAt = performance.now()
            const computerApproval = isComputerAgentTool
              ? computerAgentApprovalOptions(
                  computerAgentApprovalPolicy,
                  toolName,
                  toolInput
                )
              : undefined
            const hasComputerThreadApproval =
              isComputerAgentTool &&
              computerApproval?.rememberThreadApproval === true &&
              useToolApproval
                .getState()
                .isToolApproved(threadId, COMPUTER_AGENT_THREAD_APPROVAL_TOOL)

            // Built-in RAG tools are internal and should not require approval.
            const approved = ragToolNames.has(toolName)
              ? true
              : isComputerAgentTool && computerApproval === null
                ? true
                : hasComputerThreadApproval
                  ? true
                : await useToolApproval
                    .getState()
                    .showApprovalModal(
                      toolName,
                      threadId,
                      toolInput,
                      computerApproval?.options
                    )

            if (
              approved &&
              computerApproval?.rememberThreadApproval === true
            ) {
              useToolApproval
                .getState()
                .approveToolForThread(
                  threadId,
                  COMPUTER_AGENT_THREAD_APPROVAL_TOOL
                )
            }

            if (!approved) {
              // User denied the tool call
              trackMitaEvent('mcp_tool_invoked', {
                tool_name: toolName,
                tool_kind: toolKind,
                status: 'denied',
                duration_ms: Math.round(performance.now() - toolStartedAt),
              })
              addToolOutput({
                state: 'output-error',
                tool: toolCall.toolName,
                toolCallId: toolCall.toolCallId,
                errorText: 'Tool execution denied by user',
              })
              continue
            }

            let result

            // Route to the appropriate service based on tool name
            if (ragToolNames.has(toolName)) {
              result = await serviceHub.rag().callTool({
                toolName,
                arguments: toolInput,
                threadId,
                projectId: projectId,
                scope: projectId ? 'project' : 'thread',
              })
            } else if (isComputerAgentTool || mcpToolNames.has(toolName)) {
              result = await serviceHub.mcp().callTool({
                toolName,
                arguments: isComputerAgentTool
                  ? { ...toolInput, [COMPUTER_THREAD_ID_ARG]: threadId }
                  : toolInput,
              })
            } else {
              // Tool not found in either service
              result = {
                error: `Tool '${toolName}' not found in any service`,
              }
            }

            if (result.error) {
              trackMitaEvent('mcp_tool_invoked', {
                tool_name: toolName,
                tool_kind: toolKind,
                status: 'failed',
                duration_ms: Math.round(performance.now() - toolStartedAt),
              })
              addToolOutput({
                state: 'output-error',
                tool: toolCall.toolName,
                toolCallId: toolCall.toolCallId,
                errorText: `Error: ${result.error}`,
              })
            } else {
              trackMitaEvent('mcp_tool_invoked', {
                tool_name: toolName,
                tool_kind: toolKind,
                status: 'succeeded',
                duration_ms: Math.round(performance.now() - toolStartedAt),
              })
              addToolOutput({
                tool: toolCall.toolName,
                toolCallId: toolCall.toolCallId,
                output: result.content,
              })
            }
          } catch (error) {
            // Ignore abort errors
            if ((error as Error).name !== 'AbortError') {
              console.error('Tool call error:', error)
              trackMitaEvent('mcp_tool_invoked', {
                tool_name: toolCall.toolName,
                tool_kind: isComputerAgentToolName(toolCall.toolName)
                  ? 'computer'
                  : 'mcp',
                status: 'failed',
              })
              addToolOutput({
                state: 'output-error',
                tool: toolCall.toolName,
                toolCallId: toolCall.toolCallId,
                errorText: `Error: ${JSON.stringify(error)}`,
              })
            }
          }
        }

        // Clear tools after processing all
        sessionData.tools = []
        toolCallAbortController.current = null
      })().catch((error) => {
        // Ignore abort errors
        if (error.name !== 'AbortError') {
          console.error('Tool call error:', error)
        }
        sessionData.tools = []
        toolCallAbortController.current = null
      })

      // Auto-summarize thread title after the first assistant response.
      // The thread title is the user's first message (set in ChatInput on creation),
      // so we use it directly as the summarization input.
      // Skipped if already summarized, manually renamed, or max attempts reached.
      console.log('[ThreadTitle] onFinish fired, isAbort:', isAbort)
      if (!isAbort) {
        const currentThread = useThreads.getState().threads[threadId]
        console.log('[ThreadTitle] thread:', !!currentThread, 'titleSummarized:', currentThread?.metadata?.titleSummarized, 'attempts:', titleAttemptsRef.current)
        if (
          currentThread &&
          !currentThread.metadata?.titleSummarized &&
          titleAttemptsRef.current < MAX_TITLE_SUMMARIZATION_ATTEMPTS
        ) {
          const titleText = currentThread.title
          console.log('[ThreadTitle] titleText length:', titleText?.length, 'threshold:', TITLE_SUMMARIZATION_MIN_LENGTH)
          summarizeThreadTitleFromText(titleText)
        }
      }
    },
    onToolCall: ({ toolCall }) => {
      sessionData.tools.push(toolCall)
    },
    sendAutomaticallyWhen: followUpMessage,
  })

  useEffect(() => {
    rawChatStatusRef.current = status
    if (status === 'ready' || status === 'error') {
      setSettledChatStatus(null)
    }
  }, [status])

  const effectiveStatus = isMitaTeamsRuntimeBusy
    ? CHAT_STATUS.SUBMITTED
    : (settledChatStatus ?? status)

  const persistMitaTeamsConfig = useCallback(
    (nextConfig: MitaTeamsConfig) => {
      updateThread(threadId, {
        metadata: {
          mitaTeams: nextConfig,
        },
      })
    },
    [threadId, updateThread]
  )

  const appendThreadMessageToChat = useCallback(
    (message: ThreadMessage) => {
      const uiMessage = convertThreadMessageToUIMessage(message)
      setChatMessages((prev) =>
        prev.some((item) => item.id === uiMessage.id)
          ? prev
          : [...prev, uiMessage]
      )
    },
    [setChatMessages]
  )

  const appendMitaTeamsAssistantMessage = useCallback(
    (
      content: string,
      config: MitaTeamsConfig,
      status: 'completed' | 'waiting-for-user' | 'stopped' | 'failed'
    ) => {
      const timestamp = Date.now()
      const assistantMessage = {
        ...newAssistantThreadContent(threadId, content, {
          mitaTeams: {
            runId: config.runtime.run?.id,
            status,
            projectMemoryVersion: config.runtime.projectMemory.version,
          },
        }),
        created_at: timestamp,
        completed_at: timestamp,
      }

      addMessage(assistantMessage)
      appendThreadMessageToChat(assistantMessage)
    },
    [addMessage, appendThreadMessageToChat, threadId]
  )

  const startMitaTeamsRuntime = useCallback(
    async (config: MitaTeamsConfig, userText: string) => {
      mitaTeamsAbortRef.current?.abort()
      const controller = new AbortController()
      mitaTeamsAbortRef.current = controller
      rawChatStatusRef.current = CHAT_STATUS.SUBMITTED
      setSettledChatStatus(CHAT_STATUS.SUBMITTED)
      setIsMitaTeamsRuntimeBusy(true)

      try {
        const result = await runMitaTeamsRuntime({
          config,
          userText,
          threadTitle: threadRef.current?.title,
          abortSignal: controller.signal,
          onConfigChange: persistMitaTeamsConfig,
        })

        persistMitaTeamsConfig(result.config)
        if (result.finalResponse) {
          appendMitaTeamsAssistantMessage(
            result.finalResponse,
            result.config,
            result.status
          )
          summarizeThreadTitleFromText(`${userText}\n\n${result.finalResponse}`, {
            forceGenerate: true,
          })
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Mita Teams failed'
        toast.error(message)
      } finally {
        if (mitaTeamsAbortRef.current === controller) {
          mitaTeamsAbortRef.current = null
          setIsMitaTeamsRuntimeBusy(false)
          const updateSessionStatus = useChatSessions.getState().updateStatus
          if (typeof updateSessionStatus === 'function') {
            updateSessionStatus(threadId, 'ready')
          }
          setSettledChatStatus('ready')
        }
      }
    },
    [
      appendMitaTeamsAssistantMessage,
      persistMitaTeamsConfig,
      summarizeThreadTitleFromText,
      threadId,
    ]
  )

  const startMitaTeamsPrivateRoleChat = useCallback(
    async (
      config: MitaTeamsConfig,
      roleId: string,
      userText: string
    ) => {
      mitaTeamsAbortRef.current?.abort()
      const controller = new AbortController()
      mitaTeamsAbortRef.current = controller
      rawChatStatusRef.current = CHAT_STATUS.SUBMITTED
      setSettledChatStatus(CHAT_STATUS.SUBMITTED)
      setIsMitaTeamsRuntimeBusy(true)

      try {
        const result = await runMitaTeamsPrivateRoleChat({
          config,
          roleId,
          userText,
          abortSignal: controller.signal,
          onConfigChange: persistMitaTeamsConfig,
        })

        persistMitaTeamsConfig(result.config)
        if (result.status === 'failed' && result.finalResponse) {
          toast.error(result.finalResponse)
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Mita Teams role chat failed'
        toast.error(message)
      } finally {
        if (mitaTeamsAbortRef.current === controller) {
          mitaTeamsAbortRef.current = null
          setIsMitaTeamsRuntimeBusy(false)
          const updateSessionStatus = useChatSessions.getState().updateStatus
          if (typeof updateSessionStatus === 'function') {
            updateSessionStatus(threadId, 'ready')
          }
          setSettledChatStatus('ready')
        }
      }
    },
    [persistMitaTeamsConfig, threadId]
  )

  const createCompactionModel = useCallback(async () => {
    const modelId = useModelProvider.getState().selectedModel?.id
    const providerId = useModelProvider.getState().selectedProvider
    const provider = useModelProvider.getState().getProviderByName(providerId)
    if (!modelId || !provider) {
      throw new Error('Select a model before compacting context.')
    }

    const inferenceParams =
      useAssistant.getState().currentAssistant?.parameters ?? {}
    return ModelFactory.createModel(modelId, provider, inferenceParams)
  }, [])

  const persistCompactionResult = useCallback(
    (result: Awaited<ReturnType<typeof compactThreadMessages>>) => {
      if (!result.compacted || !result.summaryMessage) return

      for (const archivedMessage of result.archivedMessages) {
        updateMessage(archivedMessage)
      }
      addMessage(result.summaryMessage)
      setMessages(threadId, result.messages)
      setChatMessages(convertThreadMessagesToUIMessages(result.messages))
    },
    [addMessage, setChatMessages, setMessages, threadId, updateMessage]
  )

  const runThreadCompaction = useCallback(
    async ({
      trigger,
      customInstructions,
      maxRecentTokens,
    }: {
      trigger: MitaCompactTrigger
      customInstructions?: string
      maxRecentTokens?: number
    }) => {
      const sourceMessages = useMessages.getState().getMessages(threadId)
      if (sourceMessages.length === 0) return false

      const model = await createCompactionModel()
      const result = await compactThreadMessages({
        threadId,
        messages: sourceMessages,
        model,
        trigger,
        customInstructions,
        maxRecentTokens,
      })

      if (!result.compacted) return false
      persistCompactionResult(result)
      return true
    },
    [createCompactionModel, persistCompactionResult, threadId]
  )

  const maybeAutoCompactBeforeSend = useCallback(
    async (incomingText: string) => {
      const assistantParameters =
        useAssistant.getState().currentAssistant?.parameters ?? {}
      if (!booleanParam(assistantParameters.auto_compact, true)) return false

      const selectedModelState = useModelProvider.getState().selectedModel
      const maxContextTokens = getConfiguredMaxContextTokens(
        assistantParameters,
        selectedModelState
      )
      if (maxContextTokens <= 0) return false

      const threshold = normalizeAutoCompactThreshold(
        assistantParameters.auto_compact_threshold
      )
      const sourceMessages = useMessages.getState().getMessages(threadId)
      const check = shouldAutoCompactThread({
        messages: sourceMessages,
        incomingText,
        systemPrompt: systemMessage,
        maxContextTokens,
        threshold,
      })
      if (!check.shouldCompact) return false

      const maxRecentTokens = Math.min(
        DEFAULT_COMPACT_RECENT_TOKEN_LIMIT,
        Math.max(1_024, Math.floor(maxContextTokens * 0.35))
      )

      try {
        const compacted = await runThreadCompaction({
          trigger: 'auto',
          maxRecentTokens,
        })
        if (compacted) {
          console.debug(
            `[compact] Auto compacted thread ${threadId} at ${check.tokenEstimate}/${check.tokenLimit} estimated tokens`
          )
          trackMitaEvent('context_compacted', {
            provider_id: selectedProvider,
            model_id: selectedModel?.id,
            source: 'auto',
            status: 'succeeded',
          })
        }
        return compacted
      } catch (error) {
        console.warn('Auto compact failed; falling back to request-level trimming.', error)
        return false
      }
    },
    [runThreadCompaction, selectedModel?.id, selectedProvider, systemMessage, threadId]
  )

  const handleManualCompact = useCallback(
    async (customInstructions?: string) => {
      try {
        const compacted = await runThreadCompaction({
          trigger: 'manual',
          customInstructions,
        })
        if (compacted) {
          trackMitaEvent('context_compacted', {
            provider_id: selectedProvider,
            model_id: selectedModel?.id,
            source: 'manual',
            status: 'succeeded',
          })
          toast.success('Context compacted')
        } else {
          trackMitaEvent('context_compacted', {
            provider_id: selectedProvider,
            model_id: selectedModel?.id,
            source: 'manual',
            status: 'skipped',
          })
          toast.info('Not enough context to compact yet')
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to compact context'
        toast.error(message)
      }
    },
    [runThreadCompaction, selectedModel?.id, selectedProvider]
  )

  // Get disabled tools for this thread to trigger re-render when they change
  const disabledTools = useToolAvailable((state) =>
    state.getDisabledToolsForThread(threadId)
  )

  // Update RAG tools availability when documents, model, or tool availability changes
  useEffect(() => {
    const checkDocumentsAvailability = async () => {
      const hasThreadDocuments = Boolean(thread?.metadata?.hasDocuments)
      let hasProjectDocuments = false

      // Check if thread belongs to a project and if that project has files
      const projectId = thread?.metadata?.project?.id
      if (projectId) {
        try {
          const ext = ExtensionManager.getInstance().get<VectorDBExtension>(
            ExtensionTypeEnum.VectorDB
          )
          if (ext?.listAttachmentsForProject) {
            const projectFiles = await ext.listAttachmentsForProject(projectId)
            hasProjectDocuments = projectFiles.length > 0
          }
        } catch (error) {
          console.warn('Failed to check project files:', error)
        }
      }

      const hasDocuments = hasThreadDocuments || hasProjectDocuments
      const ragFeatureAvailable = Boolean(useAttachments.getState().enabled)
      const modelSupportsTools =
        selectedModel?.capabilities?.includes('tools') ?? false

      updateRagToolsAvailability(
        hasDocuments,
        modelSupportsTools,
        ragFeatureAvailable
      )
    }

    checkDocumentsAvailability()
  }, [
    thread?.metadata?.hasDocuments,
    thread?.metadata?.project?.id,
    selectedModel?.capabilities,
    updateRagToolsAvailability,
    disabledTools, // Re-run when tools are enabled/disabled
  ])

  // Auto-scroll the reasoning container during streaming, pausing when the user scrolls up
  const {
    containerRef: reasoningContainerRef,
    isAtBottom: isReasoningAtBottom,
    handleScroll: handleReasoningScroll,
    scrollToBottom: scrollReasoningToBottom,
    forceScrollToBottom: forceScrollReasoningToBottom,
    reset: resetReasoningScroll,
  } = useAutoScroll()

  useEffect(() => {
    if (status === 'streaming') {
      resetReasoningScroll()
    }
  }, [status, resetReasoningScroll])

  useEffect(() => {
    if (status === 'streaming') {
      scrollReasoningToBottom()
    }
  }, [status, chatMessages, scrollReasoningToBottom])

  useEffect(() => {
    setCurrentThreadId(threadId)
    trackMitaEvent('chat_selected', {
      has_documents: Boolean(thread?.metadata?.hasDocuments),
    })
    // Reset title summarization state for the new thread
    titleAbortRef.current?.abort()
    titleAbortRef.current = null
    titleAttemptsRef.current = 0
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId])

  // Load messages on first mount
  useEffect(() => {
    // Skip if chat already has messages (e.g., returning to a streaming conversation)
    const existingSession = useChatSessions.getState().sessions[threadId]
    if (
      existingSession?.chat.messages.length > 0 ||
      existingSession?.isStreaming ||
      currentThread.current === threadId
    ) {
      return
    }

    serviceHub
      .messages()
      .fetchMessages(threadId)
      .then((fetchedMessages) => {
        if (fetchedMessages && fetchedMessages.length > 0) {
          const currentLocalMessages = useMessages
            .getState()
            .getMessages(threadId)

          let messagesToSet = fetchedMessages

          // Merge with local-only messages if needed
          if (currentLocalMessages && currentLocalMessages.length > 0) {
            const fetchedIds = new Set(fetchedMessages.map((m) => m.id))
            const localOnlyMessages = currentLocalMessages.filter(
              (m) => !fetchedIds.has(m.id)
            )

            if (localOnlyMessages.length > 0) {
              messagesToSet = [...fetchedMessages, ...localOnlyMessages].sort(
                (a, b) => (a.created_at || 0) - (b.created_at || 0)
              )
            }
          }

          // Update the legacy store
          setMessages(threadId, messagesToSet)

          // Convert and set messages for AI SDK chat
          const uiMessages = convertThreadMessagesToUIMessages(messagesToSet)
          setChatMessages(uiMessages)
          currentThread.current = threadId
        }
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, serviceHub])

  useEffect(() => {
    return () => {
      titleAbortRef.current?.abort()
      setCurrentThreadId(undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Consolidated function to process and send a message
  const processAndSendMessage = useCallback(
    async (
      text: string,
      files?: Array<{ type: string; mediaType: string; url: string }>
    ) => {
      resetSettledChatStatus()
      // Cancel any in-flight title summarization so it doesn't compete with this request
      titleAbortRef.current?.abort()
      titleAbortRef.current = null

      // Get all attachments from the store (includes both images and documents)
      const allAttachments = getAttachments(attachmentsKey)

      // Convert image files to attachments for persistence
      const imageAttachments = files?.map((file) => {
        const base64 = file.url.split(',')[1] || ''
        return createImageAttachment({
          name: `image-${Date.now()}`,
          mimeType: file.mediaType,
          dataUrl: file.url,
          base64,
          size: Math.ceil((base64.length * 3) / 4), // Estimate size from base64
        })
      })

      // Combine image attachments with document attachments from the store
      const combinedAttachments = [
        ...(imageAttachments || []),
        ...allAttachments.filter((a) => a.type === 'document'),
      ]

      const messageId = generateId()
      const hasDocuments = combinedAttachments.some(
        (a) => a.type === 'document' && !a.processed
      )
      const hasEmbeddingDocuments = combinedAttachments.some(
        (a) =>
          a.type === 'document' &&
          !a.processed &&
          a.parseMode !== 'inline'
      )

      // When there are unprocessed documents (e.g. first-message flow),
      // show the user message in the conversation immediately so the UI
      // doesn't hang while embeddings are generated.
      if (hasDocuments) {
        const previewMessage = newUserThreadContent(
          threadId,
          text,
          combinedAttachments,
          messageId
        )
        const previewUI =
          convertThreadMessagesToUIMessages([previewMessage])
        setChatMessages((prev) => [...prev, ...previewUI])
      }

      // Clear attachment chips from the input - they are now either
      // about to be sent or visible in the preview message above.
      clearAttachmentsForThread(attachmentsKey)

      // Process attachments (ingest images, parse/index documents)
      let processedAttachments = combinedAttachments
      const projectId = thread?.metadata?.project?.id
      const providerForSend =
        activeMitaChatRole?.provider && activeMitaChatRole.modelId
          ? activeMitaChatRole.provider
          : selectedProvider
      if (activeMitaChatRole?.provider && activeMitaChatRole.modelId) {
        selectModelProvider(activeMitaChatRole.provider, activeMitaChatRole.modelId)
      }
      if (combinedAttachments.length > 0) {
        if (hasEmbeddingDocuments) setProcessingEmbeddings(true)
        try {
          const parsePreference = useAttachments.getState().parseMode
          const result = await processAttachmentsForSend({
            attachments: combinedAttachments,
            threadId,
            projectId,
            serviceHub,
            selectedProvider: providerForSend,
            parsePreference,
          })
          processedAttachments = result.processedAttachments

          // Update thread metadata if documents were embedded
          if (result.hasEmbeddedDocuments) {
            const toolApproval = useToolApproval.getState()
            const ragTools = useAppState.getState().ragToolNames
            for (const toolName of ragTools) {
              toolApproval.approveToolForThread(threadId, toolName)
            }
            useThreads.getState().updateThread(threadId, {
              metadata: { hasDocuments: true },
            })
          }
        } catch (error) {
          console.error('Failed to process attachments:', error)
          trackMitaEvent('attachment_processing_failed', {
            provider_id: selectedProvider,
            model_id: selectedModel?.id,
            attachment_count: combinedAttachments.length,
            image_count: combinedAttachments.filter((a) => a.type === 'image')
              .length,
            document_count: combinedAttachments.filter(
              (a) => a.type === 'document'
            ).length,
            error_kind: 'processing',
          })
          // Remove the preview message on failure
          if (hasDocuments) {
            setChatMessages((prev) =>
              prev.filter((m) => m.id !== messageId)
            )
          }
          return
        } finally {
          setProcessingEmbeddings(false)
        }
      }

      // Remove the preview before sendMessage adds the real user message
      // with the same id - this prevents duplicates.
      if (hasDocuments) {
        setChatMessages((prev) => prev.filter((m) => m.id !== messageId))
      }

      // Persist the final message to backend
      const userMessage = newUserThreadContent(
        threadId,
        text,
        processedAttachments,
        messageId
      )
      const messageText = userMessage.content[0].text?.value ?? text

      if (
        mitaTeamsConfig?.workspaceView === 'role-chat' &&
        activeMitaChatRole
      ) {
        trackMitaEvent('message_sent', {
          provider_id: selectedProvider,
          model_id: selectedModel?.id,
          model_capabilities: selectedModel?.capabilities ?? [],
          has_attachments: processedAttachments.length > 0,
          attachment_count: processedAttachments.length,
          image_count: processedAttachments.filter((a) => a.type === 'image')
            .length,
          document_count: processedAttachments.filter(
            (a) => a.type === 'document'
          ).length,
          message_length_bucket: messageLengthBucket(messageText),
          source: 'mita_teams_role_chat',
          web_search_enabled: useWebSearch.getState().enabled,
        })
        void startMitaTeamsPrivateRoleChat(
          mitaTeamsConfig,
          activeMitaChatRole.id,
          messageText
        )
        return
      }

      await maybeAutoCompactBeforeSend(messageText)

      addMessage(userMessage)
      trackMitaEvent('message_sent', {
        provider_id: selectedProvider,
        model_id: selectedModel?.id,
        model_capabilities: selectedModel?.capabilities ?? [],
        has_attachments: processedAttachments.length > 0,
        attachment_count: processedAttachments.length,
        image_count: processedAttachments.filter((a) => a.type === 'image')
          .length,
        document_count: processedAttachments.filter(
          (a) => a.type === 'document'
        ).length,
        message_length_bucket: messageLengthBucket(messageText),
        source: 'composer',
        web_search_enabled: useWebSearch.getState().enabled,
      })

      if (mitaTeamsConfig) {
        appendThreadMessageToChat(userMessage)
        void startMitaTeamsRuntime(mitaTeamsConfig, messageText)
        return
      }

      // Build parts for AI SDK (only images are sent as file parts)
      const parts: Array<
        | { type: 'text'; text: string }
        | { type: 'file'; mediaType: string; url: string }
      > = [
        {
          type: 'text',
          text: userMessage.content[0].text?.value ?? text,
        },
      ]

      if (files) {
        files.forEach((file) => {
          parts.push({
            type: 'file',
            mediaType: file.mediaType,
            url: file.url,
          })
        })
      }

      sendMessage({
        parts,
        id: messageId,
        metadata: { ...userMessage.metadata, createdAt: new Date() },
      })
    },
    [
      sendMessage,
      threadId,
      thread,
      addMessage,
      getAttachments,
      attachmentsKey,
      setChatMessages,
      clearAttachmentsForThread,
      serviceHub,
      selectedModel,
      selectedProvider,
      activeMitaChatRole,
      selectModelProvider,
      maybeAutoCompactBeforeSend,
      resetSettledChatStatus,
      mitaTeamsConfig,
      appendThreadMessageToChat,
      startMitaTeamsRuntime,
      startMitaTeamsPrivateRoleChat,
    ]
  )

  // Sends a text-only queued message, bypassing attachment processing entirely.
  // This prevents stale or new attachments from leaking into auto-sent queue items.
  const sendQueuedMessage = useCallback(
    async (text: string, metadata?: Record<string, unknown>) => {
      resetSettledChatStatus()
      const messageId = generateId()
      const userMessage = newUserThreadContent(
        threadId,
        text,
        [],
        messageId,
        metadata
      )

      await maybeAutoCompactBeforeSend(
        userMessage.content[0].text?.value ?? text
      )

      addMessage(userMessage)
      trackMitaEvent('message_sent', {
        provider_id: selectedProvider,
        model_id: selectedModel?.id,
        has_attachments: false,
        attachment_count: 0,
        message_length_bucket: messageLengthBucket(text),
        source: metadata?.mita ? 'auto_run' : 'queue',
        web_search_enabled: useWebSearch.getState().enabled,
      })

      if (metadata?.mita) {
        pendingAutoRunResponseMetaRef.current = {
          mita: metadata.mita as MitaMessageMetadata,
        }
      }

      sendMessage({
        parts: [{ type: 'text', text }],
        id: messageId,
        metadata: userMessage.metadata,
      })
    },
    [
      sendMessage,
      threadId,
      addMessage,
      maybeAutoCompactBeforeSend,
      resetSettledChatStatus,
      selectedModel,
      selectedProvider,
    ]
  )

  const handleAutoRunStart = useCallback(
    (maxRounds: number) => {
      const now = new Date().toISOString()
      trackMitaEvent('auto_run_started', {
        max_rounds: maxRounds,
        provider_id: selectedProvider,
        model_id: selectedModel?.id,
      })
      persistAutoRunState({
        enabled: true,
        status: 'running',
        maxRounds,
        currentRound: 0,
        runId: generateId(),
        startedAt: now,
        updatedAt: now,
        lastError: undefined,
      })
    },
    [persistAutoRunState, selectedModel?.id, selectedProvider]
  )

  const handleAutoRunPause = useCallback(() => {
    persistAutoRunState({ status: 'paused', enabled: true })
  }, [persistAutoRunState])

  const handleAutoRunResume = useCallback(() => {
    persistAutoRunState({ status: 'running', enabled: true })
  }, [persistAutoRunState])

  const handleAutoRunStop = useCallback(() => {
    persistAutoRunState({ status: 'stopped', enabled: false })
  }, [persistAutoRunState])

  // Check for and send initial message from sessionStorage
  const initialMessageSentRef = useRef(false)

  useEffect(() => {
    // Prevent duplicate sends
    if (initialMessageSentRef.current) return

    const initialMessageKey = `${SESSION_STORAGE_PREFIX.INITIAL_MESSAGE}${threadId}`

    const storedMessage = sessionStorage.getItem(initialMessageKey)

    if (storedMessage) {
      // Mark as sent immediately to prevent duplicate sends
      sessionStorage.removeItem(initialMessageKey)
      initialMessageSentRef.current = true

      // Process message asynchronously
      ;(async () => {
        try {
          const message = JSON.parse(storedMessage) as {
            text: string
            files?: Array<{ type: string; mediaType: string; url: string }>
          }

          await processAndSendMessage(message.text, message.files)
        } catch (error) {
          console.error('Failed to parse initial message:', error)
        }
      })()
    }
  }, [threadId, processAndSendMessage])

  // Handle submit from ChatInput
  const handleSubmit = useCallback(
    async (
      text: string,
      files?: Array<{ type: string; mediaType: string; url: string }>
    ) => {
      await processAndSendMessage(text, files)
    },
    [processAndSendMessage]
  )

  const handleStop = useCallback(() => {
    resetSettledChatStatus()
    trackMitaEvent('generation_cancelled', {
      provider_id: selectedProvider,
      model_id: selectedModel?.id,
      source: mitaTeamsAbortRef.current ? 'mita_teams_stop' : 'chat_stop',
    })
    if (mitaTeamsAbortRef.current) {
      mitaTeamsAbortRef.current.abort()
      mitaTeamsAbortRef.current = null
      setIsMitaTeamsRuntimeBusy(false)
      setSettledChatStatus('ready')
      return
    }
    stop()
  }, [resetSettledChatStatus, selectedModel?.id, selectedProvider, stop])

  const handleMitaTeamsChoiceSelect = useCallback(
    (optionId: string) => {
      const choice = mitaTeamsConfig?.runtime.userChoiceRequest
      const answeredChoiceKey = choice ? `${threadId}:${choice.id}` : undefined
      if (
        !mitaTeamsConfig ||
        !choice ||
        choice.status !== 'pending' ||
        isMitaTeamsRuntimeBusy ||
        !answeredChoiceKey ||
        mitaTeamsAnsweredChoiceIdsRef.current.has(answeredChoiceKey)
      ) {
        return
      }

      const option = choice.options.find((item) => item.id === optionId)
      if (!option) return
      mitaTeamsAnsweredChoiceIdsRef.current.add(answeredChoiceKey)
      const nextRuntime = answerMitaTeamsChoice(
        mitaTeamsConfig.runtime,
        optionId
      )
      const nextConfig = withMitaTeamsRuntime(mitaTeamsConfig, nextRuntime)
      const userText = [
        `选择：${option?.label ?? optionId}`,
        option?.description,
      ]
        .filter(Boolean)
        .join('\n')
      const userMessage = newUserThreadContent(
        threadId,
        userText,
        [],
        generateId(),
        {
          mitaTeams: {
            choiceRequestId: choice.id,
            selectedOptionId: optionId,
          },
        }
      )

      persistMitaTeamsConfig(nextConfig)
      addMessage(userMessage)
      appendThreadMessageToChat(userMessage)
      void startMitaTeamsRuntime(nextConfig, userText)
    },
    [
      addMessage,
      appendThreadMessageToChat,
      isMitaTeamsRuntimeBusy,
      mitaTeamsConfig,
      persistMitaTeamsConfig,
      startMitaTeamsRuntime,
      threadId,
    ]
  )

  // Handle regenerate from any message (user or assistant)
  // - For user messages: keeps the user message, deletes all after, regenerates assistant response
  // - For assistant messages: finds the closest preceding user message, deletes from there
  const handleRegenerate = useCallback((messageId?: string) => {
    resetSettledChatStatus()
    trackMitaEvent('message_regenerated', {
      provider_id: selectedProvider,
      model_id: selectedModel?.id,
      source: messageId ? 'message_action' : 'latest',
    })
    // Cancel any in-flight title summarization before regenerating
    titleAbortRef.current?.abort()
    titleAbortRef.current = null

    const currentLocalMessages = useMessages.getState().getMessages(threadId)

    // If regenerating from a specific message, delete all messages after it
    if (messageId) {
      // Find the message in the current chat messages
      const messageIndex = currentLocalMessages.findIndex(
        (m) => m.id === messageId
      )

      if (messageIndex !== -1) {
        const selectedMessage = currentLocalMessages[messageIndex]

        // If it's an assistant message, find the closest preceding user message
        let deleteFromIndex = messageIndex
        if (selectedMessage.role === 'assistant') {
          // Look backwards to find the closest user message
          for (let i = messageIndex - 1; i >= 0; i--) {
            if (currentLocalMessages[i].role === 'user') {
              deleteFromIndex = i
              break
            }
          }
        }

        // Get all messages after the delete point
        const messagesToDelete = currentLocalMessages.slice(deleteFromIndex + 1)

        // Delete from backend storage
        if (messagesToDelete.length > 0) {
          messagesToDelete.forEach((msg) => {
            deleteMessage(threadId, msg.id)
          })
        }
      }
    }

    // Call the AI SDK regenerate function - it will handle truncating the UI messages
    // and generating a new response from the selected message
    regenerate(messageId ? { messageId } : undefined)
  }, [
    threadId,
    deleteMessage,
    regenerate,
    resetSettledChatStatus,
    selectedModel?.id,
    selectedProvider,
  ])

  // Handle edit message - updates the message and regenerates from it
  const handleEditMessage = useCallback(
    (messageId: string, newText: string) => {
      const currentLocalMessages = useMessages.getState().getMessages(threadId)
      const messageIndex = currentLocalMessages.findIndex(
        (m) => m.id === messageId
      )

      if (messageIndex === -1) return

      const originalMessage = currentLocalMessages[messageIndex]
      trackMitaEvent('message_edited', {
        provider_id: selectedProvider,
        model_id: selectedModel?.id,
        message_length_bucket: messageLengthBucket(newText),
      })

      // Update the message content
      const updatedMessage = {
        ...originalMessage,
        content: [
          {
            type: ContentType.Text,
            text: { value: newText, annotations: [] },
          },
        ],
      }
      updateMessage(updatedMessage)

      // Update chat messages for UI
      const updatedChatMessages = chatMessages.map((msg) => {
        if (msg.id === messageId) {
          return {
            ...msg,
            parts: [{ type: 'text' as const, text: newText }],
          }
        }
        return msg
      })
      setChatMessages(updatedChatMessages)

      // Only regenerate if the edited message is from the user
      if (updatedMessage.role === 'assistant') return

      // Delete all messages after this one and regenerate
      const messagesToDelete = currentLocalMessages.slice(messageIndex + 1)
      messagesToDelete.forEach((msg) => {
        deleteMessage(threadId, msg.id)
      })

      // Regenerate from the edited message
      regenerate({ messageId })
    },
    [
      threadId,
      updateMessage,
      deleteMessage,
      chatMessages,
      setChatMessages,
      regenerate,
      selectedModel?.id,
      selectedProvider,
    ]
  )

  // Handle delete message
  const handleDeleteMessage = useCallback(
    (messageId: string) => {
      deleteMessage(threadId, messageId)

      // Update chat messages for UI
      const updatedChatMessages = chatMessages.filter(
        (msg) => msg.id !== messageId
      )
      setChatMessages(updatedChatMessages)
    },
    [threadId, deleteMessage, chatMessages, setChatMessages]
  )

  // Handler for increasing context size
  const handleContextSizeIncrease = useCallback(async () => {
    if (!selectedModel) return

    const updateProvider = useModelProvider.getState().updateProvider
    const provider = getProviderByName(selectedProvider)
    if (!provider) return

    const modelIndex = provider.models.findIndex(
      (m) => m.id === selectedModel.id
    )
    if (modelIndex === -1) return

    const model = provider.models[modelIndex]

    // Increase context length in steps: <8192 -> 8192 -> 32768 -> x1.5
    const currentCtxLen =
      (model.settings?.ctx_len?.controller_props?.value as number) ?? 8192
    const maxCtxLen =
      (model.settings?.ctx_len?.controller_props?.max as number) || 131072

    let newCtxLen: number
    if (currentCtxLen < 8192) {
      newCtxLen = 8192
    } else if (currentCtxLen < 32768) {
      newCtxLen = 32768
    } else {
      newCtxLen = Math.round(currentCtxLen * 1.5)
    }

    newCtxLen = Math.min(newCtxLen, maxCtxLen)
    if (newCtxLen <= currentCtxLen) {
      setContextLimitError(new Error(OUT_OF_CONTEXT_SIZE))
      return
    }

    const updatedModel = {
      ...model,
      settings: {
        ...model.settings,
        ctx_len: {
          ...(model.settings?.ctx_len ?? {}),
          controller_props: {
            ...(model.settings?.ctx_len?.controller_props ?? {}),
            value: newCtxLen,
          },
        },
      },
    }

    const updatedModels = [...provider.models]
    updatedModels[modelIndex] = updatedModel as Model

    updateProvider(provider.provider, {
      models: updatedModels,
    })

    await serviceHub.models().stopModel(selectedModel.id)

    setTimeout(() => {
      handleRegenerate()
    }, 1000)
  }, [
    selectedModel,
    selectedProvider,
    getProviderByName,
    serviceHub,
    handleRegenerate,
  ])

  // Keep refs in sync so onFinish always calls the latest versions
  handleContextSizeIncreaseRef.current = handleContextSizeIncrease
  setContinueFromContentRef.current = setContinueFromContent

  // Skip auto-context-increase in agent mode
  const agentModeActive = useAgentMode((s) => s.agentThreads[threadId] === true)
  useEffect(() => {
    if (!error || agentModeActive) return
    if (autoIncreaseAttempts >= MAX_AUTO_INCREASE_ATTEMPTS) return
    const autoIncrease =
      selectedModel?.settings?.auto_increase_ctx_len?.controller_props?.value ??
      true
    if (!autoIncrease) return
    const isContextError =
      (error.message?.toLowerCase().includes('context') &&
        (error.message?.toLowerCase().includes('size') ||
          error.message?.toLowerCase().includes('length') ||
          error.message?.toLowerCase().includes('limit'))) ||
      error.message === OUT_OF_CONTEXT_SIZE
    if (isContextError) {
      setAutoIncreaseAttempts((prev) => prev + 1)
      handleContextSizeIncrease()
    }
  }, [error]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (status === 'streaming' || status === 'submitted') {
      setContextLimitError(null)
    }
    if (status === 'streaming' && autoIncreaseAttempts > 0) {
      setAutoIncreaseAttempts(0)
    }
    if (status === 'error' && pendingContinueMessage) {
      setPendingContinueMessage(null)
    }
  }, [status]) // eslint-disable-line react-hooks/exhaustive-deps

  // Message queue: auto-send the next queued message when the stream finishes.
  // No reactive subscription to the queue here - ChatInput owns the UI.
  // We only read the store imperatively when status transitions to 'ready'.
  const processingQueueRef = useRef(false)

  useEffect(() => {
    if (effectiveStatus !== 'ready' || processingQueueRef.current) return
    if (sessionData.tools.length > 0) return
    if (useAutoRunStore.getState().getRun(threadId).status === 'running') {
      return
    }

    const next = useMessageQueue.getState().dequeue(threadId)
    if (!next) return

    processingQueueRef.current = true
    sendQueuedMessage(next.text)
      .catch((err) => {
        console.error('Failed to send queued message:', err)
      })
      .finally(() => {
        processingQueueRef.current = false
      })
  }, [effectiveStatus, threadId, sendQueuedMessage, sessionData.tools.length])

  useEffect(() => {
    if (mitaTeamsConfig) return
    if (effectiveStatus !== 'ready' || autoRunSendingRef.current) return
    if (sessionData.tools.length > 0) return
    const queueState = useMessageQueue.getState()
    const queuedCount =
      typeof queueState.getQueue === 'function'
        ? queueState.getQueue(threadId).length
        : 0
    if (queuedCount > 0) return

    const run = useAutoRunStore.getState().getRun(threadId)
    if (run.status !== 'running') return

    if (run.currentRound >= run.maxRounds) {
      trackMitaEvent('auto_run_completed', {
        current_round: run.currentRound,
        max_rounds: run.maxRounds,
        status: 'completed',
      })
      persistAutoRunState({ status: 'completed', enabled: false })
      return
    }

    const round = run.currentRound + 1
    const runId = run.runId ?? generateId()
    autoRunSendingRef.current = true

    persistAutoRunState({
      currentRound: round,
      runId,
      status: 'running',
      enabled: true,
    })

    sendQueuedMessage(createAutoRunPrompt(round, run.maxRounds), {
      mita: {
        runId,
        round,
        mode: 'single-thread',
      } satisfies MitaMessageMetadata,
    })
      .catch((error) => {
        persistAutoRunState({
          status: 'error',
          enabled: false,
          lastError:
            error instanceof Error ? error.message : 'Auto run failed',
        })
      })
      .finally(() => {
        autoRunSendingRef.current = false
      })
  }, [
    autoRun.currentRound,
    autoRun.maxRounds,
    autoRun.status,
    mitaTeamsConfig,
    persistAutoRunState,
    sendQueuedMessage,
    sessionData.tools.length,
    effectiveStatus,
    threadId,
  ])

  // If streaming errors out, discard any queued messages so they don't sit there stuck
  useEffect(() => {
    if (status === 'error') {
      useMessageQueue.getState().clearQueue(threadId)
    }
  }, [status, threadId])

  // Clear the queue when navigating away from this thread
  useEffect(() => {
    return () => {
      useMessageQueue.getState().clearQueue(threadId)
    }
  }, [threadId])

  const autoRunBlockedReason = useMemo(() => {
    if (!threadModel) {
      return t('chat:autoRun.blocked.noModel')
    }
    if (
      effectiveStatus === CHAT_STATUS.SUBMITTED ||
      effectiveStatus === CHAT_STATUS.STREAMING
    ) {
      return t('chat:autoRun.blocked.chatBusy')
    }
    if (sessionData.tools.length > 0) {
      return t('chat:autoRun.blocked.toolsBusy')
    }

    const queueState = useMessageQueue.getState()
    const queuedCount =
      typeof queueState.getQueue === 'function'
        ? queueState.getQueue(threadId).length
        : 0
    if (queuedCount > 0) {
      return t('chat:autoRun.blocked.queueBusy')
    }

    return undefined
  }, [effectiveStatus, sessionData.tools.length, t, threadId, threadModel])
  const activeError = error ?? contextLimitError
  const quotaError = providerQuotaErrorFromUnknown(activeError)
  const activeErrorMessage = quotaError?.message ?? activeError?.message

  const messageItems = (
    <>
      {chatMessages.map((message, index) => {
        const isLastMessage = index === chatMessages.length - 1
        const isFirstMessage = index === 0
        return (
          <MessageItem
            key={message.id}
            message={message}
            isFirstMessage={isFirstMessage}
            isLastMessage={isLastMessage}
            status={effectiveStatus}
            reasoningContainerRef={reasoningContainerRef}
            isReasoningAtBottom={isReasoningAtBottom}
            onReasoningScroll={handleReasoningScroll}
            onReasoningScrollToBottom={forceScrollReasoningToBottom}
            onRegenerate={handleRegenerate}
            onEdit={handleEditMessage}
            onDelete={handleDeleteMessage}
            isAnimating={!pendingContinueMessage}
            hideActions={!!pendingContinueMessage}
          />
        )
      })}
      {pendingContinueMessage && effectiveStatus === 'submitted' && (
        <MessageItem
          key={`continue-placeholder-${pendingContinueMessage.id}`}
          message={pendingContinueMessage}
          isFirstMessage={false}
          isLastMessage={true}
          status={effectiveStatus}
          reasoningContainerRef={reasoningContainerRef}
          isReasoningAtBottom={isReasoningAtBottom}
          onReasoningScroll={handleReasoningScroll}
          onReasoningScrollToBottom={forceScrollReasoningToBottom}
          onRegenerate={handleRegenerate}
          onEdit={handleEditMessage}
          onDelete={handleDeleteMessage}
          hideActions
          isAnimating={false}
        />
      )}
      {processingEmbeddings && (
        <div className="flex flex-row items-center gap-2">
          <Shimmer duration={1}>Processing embeddings...</Shimmer>
        </div>
      )}
      {(!mitaTeamsConfig &&
        (effectiveStatus === CHAT_STATUS.SUBMITTED ||
        isAutoIncreasingContext) && (
          <div className="flex flex-row items-center gap-2">
            {(pendingContinueMessage || isAutoIncreasingContext) && (
              <Shimmer duration={1}>Growing the Mind...</Shimmer>
            )}
            {effectiveStatus === CHAT_STATUS.SUBMITTED && <PromptProgress />}
          </div>
        ))}
      {activeError && !isAutoIncreasingContext && (
        <div className="px-4 py-3 mx-4 my-2 rounded-lg border border-destructive/10 bg-destructive/10">
          <div className="flex items-start gap-3">
            <IconAlertCircle className="size-5 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-destructive mb-1">
                {quotaError
                  ? t('common:providerQuota.title')
                  : 'Error generating response'}
              </p>
              <div className="table table-fixed w-full">
                <span
                  className="text-sm text-muted-foreground table-cell align-middle"
                  style={{ wordWrap: 'break-word' }}
                >
                  {activeErrorMessage}
                </span>
              </div>
              {quotaError ? (
                <ProviderQuotaActions error={quotaError} className="mt-3" />
              ) : (activeError?.message?.toLowerCase().includes('context') &&
                  (activeError?.message?.toLowerCase().includes('size') ||
                    activeError?.message?.toLowerCase().includes('length') ||
                    activeError?.message?.toLowerCase().includes('limit'))) ||
                activeError?.message === OUT_OF_CONTEXT_SIZE ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={handleContextSizeIncrease}
                >
                  <IconAlertCircle className="size-4 mr-2" />
                  Increase Context Size
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => handleRegenerate()}
                >
                  <IconRefresh className="size-4 mr-2" />
                  Regenerate
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )

  const inputArea = (
    <>
      {!mitaTeamsConfig && (
        <AutoRunPanel
          threadId={threadId}
          disabled={Boolean(autoRunBlockedReason)}
          blockedReason={autoRunBlockedReason}
          onStart={handleAutoRunStart}
          onPause={handleAutoRunPause}
          onResume={handleAutoRunResume}
          onStop={handleAutoRunStop}
        />
      )}
      <ChatInput
        model={effectiveThreadModel}
        onSubmit={handleSubmit}
        onCompact={handleManualCompact}
        onStop={handleStop}
        chatStatus={effectiveStatus}
      />
    </>
  )

  return (
    <div className="flex flex-col h-[calc(100dvh-(env(safe-area-inset-bottom)+env(safe-area-inset-top)))]">
      <HeaderPage>
        {mitaTeamsConfig ? (
          <div className="relative z-30 flex w-full items-center pr-2">
            {isEditingMitaTeamsTitle ? (
              <Input
                autoFocus
                value={mitaTeamsTitleDraft}
                className="h-8 max-w-72 rounded-full bg-background text-sm font-medium"
                onChange={(event) =>
                  setMitaTeamsTitleDraft(event.target.value)
                }
                onBlur={commitMitaTeamsTitle}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.currentTarget.blur()
                  }
                  if (event.key === 'Escape') {
                    setMitaTeamsTitleDraft(thread?.title || 'Mita Teams')
                    setIsEditingMitaTeamsTitle(false)
                  }
                }}
              />
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 max-w-72 justify-start rounded-full px-3 text-sm font-medium"
                onClick={() => setIsEditingMitaTeamsTitle(true)}
                title={t('mita-teams:editActivityTitle')}
              >
                <span className="truncate">{thread?.title || 'Mita Teams'}</span>
              </Button>
            )}
          </div>
        ) : (
          <div className="flex items-center w-full pr-2">
            <DropdownModelProvider model={threadModel} />
          </div>
        )}
      </HeaderPage>
      {mitaTeamsConfig ? (
        <MitaTeamsWorkspace
          thread={thread}
          config={mitaTeamsConfig}
          messages={chatMessages}
          messageItems={messageItems}
          inputArea={inputArea}
          isRuntimeBusy={isMitaTeamsRuntimeBusy}
          onChoiceSelect={handleMitaTeamsChoiceSelect}
          onConfigChange={persistMitaTeamsConfig}
        />
      ) : (
        <div className="flex flex-1 flex-col h-full overflow-hidden">
          {/* Messages Area */}
          <div className="flex-1 relative">
            <Conversation className="absolute inset-0 text-start">
              <ConversationContent
                className={cn('mx-auto w-full md:w-4/5 xl:w-4/6')}
              >
                {messageItems}
              </ConversationContent>
              <ConversationScrollButton />
            </Conversation>
          </div>

          {/* Chat Input - Fixed at bottom */}
          <div className="py-4 mx-auto w-full md:w-4/5 xl:w-4/6">
            {inputArea}
          </div>
        </div>
      )}
    </div>
  )
}
