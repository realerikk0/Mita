/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import React from 'react'
import { ProviderQuotaError } from '@/lib/provider-quota-error'

// -----------------------------------------------------------------------------
// Hoisted shared state + mocks (needed because vi.mock factory runs first)
// -----------------------------------------------------------------------------
const h = vi.hoisted(() => {
  const mockSendMessage = vi.fn()
  const mockRegenerate = vi.fn()
  const mockStop = vi.fn()
  const mockAddToolOutput = vi.fn()
  const mockSetChatMessages = vi.fn()
  const mockUpdateRag = vi.fn()
  const mockSetContinueFromContent = vi.fn()
  const openExternalUrl = vi.fn()
  const useChatArgs: any[] = []

  const chatState: { messages: any[]; status: string; error: Error | null } = {
    messages: [],
    status: 'ready',
    error: null,
  }

  const threadsState: any = {
    threads: {
      'thread-1': {
        id: 'thread-1',
        title: 'My Thread',
        metadata: {},
        assistants: [],
        model: { id: 'gpt-x', provider: 'openai' },
      },
    },
    setCurrentThreadId: vi.fn(),
    updateThread: vi.fn(),
  }
  const useThreadsMock: any = (selector: any) => selector(threadsState)
  useThreadsMock.getState = () => threadsState

  const messagesState: any = {
    setMessages: vi.fn(),
    addMessage: vi.fn(),
    updateMessage: vi.fn(),
    deleteMessage: vi.fn(),
    getMessages: vi.fn(() => []),
  }
  const useMessagesMock: any = (selector: any) => selector(messagesState)
  useMessagesMock.getState = () => messagesState

  const appStateState = {
    ragToolNames: new Set<string>(),
    mcpToolNames: new Set<string>(),
  }
  const useAppStateMock: any = (selector: any) => selector(appStateState)
  useAppStateMock.getState = () => appStateState

  const modelProviderState: any = {
    selectedModel: {
      id: 'gpt-x',
      capabilities: ['tools'],
      settings: {
        ctx_len: { controller_props: { value: 4096, max: 131072 } },
        auto_increase_ctx_len: { controller_props: { value: true } },
      },
    },
    selectedProvider: 'openai',
    getProviderByName: vi.fn((name: string) => ({
      provider: name,
      models: [
        {
          id: 'gpt-x',
          settings: {
            ctx_len: { controller_props: { value: 4096, max: 131072 } },
          },
        },
      ],
    })),
    updateProvider: vi.fn(),
  }
  const useModelProviderMock: any = (selector: any) => selector(modelProviderState)
  useModelProviderMock.getState = () => modelProviderState

  const chatSessionsState: any = {
    sessions: {},
    getSessionData: vi.fn(() => ({ tools: [] })),
  }
  const useChatSessionsMock: any = (selector: any) => selector(chatSessionsState)
  useChatSessionsMock.getState = () => chatSessionsState

  const attachmentsState: any = {
    getAttachments: vi.fn(() => []),
    clearAttachments: vi.fn(),
  }
  const useChatAttachmentsMock: any = (selector: any) => selector(attachmentsState)
  useChatAttachmentsMock.getState = () => attachmentsState

  const useAttachmentsState: any = { enabled: true, parseMode: 'auto' }
  const useAttachmentsMock: any = (selector: any) => selector(useAttachmentsState)
  useAttachmentsMock.getState = () => useAttachmentsState

  const toolAvailableState: any = {
    getDisabledToolsForThread: vi.fn(() => []),
  }
  const useToolAvailableMock: any = (selector: any) => selector(toolAvailableState)
  useToolAvailableMock.getState = () => toolAvailableState

  const mcpServersState: any = {
    settings: {
      computerAgentEnabled: false,
      computerAgentShellEnabled: false,
      computerAgentApprovalPolicy: 'alwaysAsk',
      computerAgentSandboxAccess: 'readWrite',
    },
  }
  const useMCPServersMock: any = (selector: any) => selector(mcpServersState)
  useMCPServersMock.getState = () => mcpServersState

  const toolApprovalState: any = {
    showApprovalModal: vi.fn().mockResolvedValue(true),
    approveToolForThread: vi.fn(),
    isToolApproved: vi.fn(() => false),
  }
  const useToolApprovalMock: any = (selector: any) => selector(toolApprovalState)
  useToolApprovalMock.getState = () => toolApprovalState

  const agentModeState: any = { agentThreads: {} }
  const useAgentModeMock: any = (selector: any) => selector(agentModeState)
  useAgentModeMock.getState = () => agentModeState

  const messageQueueState: any = {
    dequeue: vi.fn(() => null),
    clearQueue: vi.fn(),
  }
  const useMessageQueueMock: any = (_selector: any) => undefined
  useMessageQueueMock.getState = () => messageQueueState

  return {
    mockSendMessage,
    mockRegenerate,
    mockStop,
    mockAddToolOutput,
    mockSetChatMessages,
    mockUpdateRag,
    mockSetContinueFromContent,
    openExternalUrl,
    useChatArgs,
    chatState,
    threadsState,
    useThreadsMock,
    messagesState,
    useMessagesMock,
    appStateState,
    useAppStateMock,
    modelProviderState,
    useModelProviderMock,
    chatSessionsState,
    useChatSessionsMock,
    attachmentsState,
    useChatAttachmentsMock,
    useAttachmentsState,
    useAttachmentsMock,
    toolAvailableState,
    useToolAvailableMock,
    mcpServersState,
    useMCPServersMock,
    toolApprovalState,
    useToolApprovalMock,
    agentModeState,
    useAgentModeMock,
    messageQueueState,
    useMessageQueueMock,
  }
})

// -----------------------------------------------------------------------------
// Module mocks
// -----------------------------------------------------------------------------

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: any) => ({ ...config, id: '/threads/$threadId' }),
  useParams: () => ({ threadId: 'thread-1' }),
  useSearch: () => ({ threadModel: undefined }),
}))

vi.mock('@/containers/HeaderPage', () => ({
  default: ({ children }: any) => <div data-testid="header-page">{children}</div>,
}))

vi.mock('@/containers/DropdownModelProvider', () => ({
  default: ({ model }: any) => (
    <div data-testid="model-dropdown">{model ? model.id : 'no-model'}</div>
  ),
}))

vi.mock('@/containers/ChatInput', () => ({
  default: ({ onSubmit, onStop, chatStatus }: any) => (
    <div data-testid="chat-input">
      <span data-testid="chat-status">{chatStatus}</span>
      <button
        data-testid="chat-send"
        onClick={() => onSubmit('hello world', undefined)}
      >
        send
      </button>
      <button data-testid="chat-stop" onClick={() => onStop()}>
        stop
      </button>
    </div>
  ),
}))

vi.mock('@/containers/MessageItem', () => ({
  MessageItem: ({ message, onRegenerate, onEdit, onDelete }: any) => (
    <div data-testid={`message-${message.id}`} data-role={message.role}>
      <span>{message.id}</span>
      <button
        data-testid={`regen-${message.id}`}
        onClick={() => onRegenerate(message.id)}
      >
        regen
      </button>
      <button
        data-testid={`edit-${message.id}`}
        onClick={() => onEdit(message.id, 'edited text')}
      >
        edit
      </button>
      <button
        data-testid={`del-${message.id}`}
        onClick={() => onDelete(message.id)}
      >
        del
      </button>
    </div>
  ),
}))

vi.mock('@/components/ai-elements/conversation', () => ({
  Conversation: ({ children }: any) => <div>{children}</div>,
  ConversationContent: ({ children }: any) => <div>{children}</div>,
  ConversationScrollButton: () => <div data-testid="scroll-btn" />,
}))

vi.mock('@/components/ai-elements/shimmer', () => ({
  Shimmer: ({ children }: any) => <div data-testid="shimmer">{children}</div>,
}))

vi.mock('@/components/PromptProgress', () => ({
  PromptProgress: () => <div data-testid="prompt-progress" />,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}))

vi.mock('@tabler/icons-react', () => ({
  IconAlertCircle: () => <span />,
  IconRefresh: () => <span />,
}))

vi.mock('@/lib/utils', () => ({
  cn: (...classes: any[]) => classes.filter(Boolean).join(' '),
}))

vi.mock('@/lib/instructionTemplate', () => ({
  renderInstructions: (i: string) => `rendered:${i}`,
}))

vi.mock('@/lib/extension', () => ({
  ExtensionManager: {
    getInstance: () => ({
      get: () => ({
        listAttachmentsForProject: vi.fn().mockResolvedValue([]),
      }),
    }),
  },
}))

vi.mock('@/lib/messages', () => ({
  convertThreadMessagesToUIMessages: (msgs: any[]) =>
    msgs.map((m) => ({
      id: m.id,
      role: m.role,
      parts: [{ type: 'text', text: m.content?.[0]?.text?.value ?? '' }],
    })),
  extractContentPartsFromUIMessage: (msg: any) =>
    msg.parts
      .filter((p: any) => p.type === 'text')
      .map((p: any) => ({ type: 'text', text: { value: p.text, annotations: [] } })),
}))

vi.mock('@/lib/completion', () => ({
  newUserThreadContent: (threadId: string, text: string, _a: any, id: string) => ({
    id,
    thread_id: threadId,
    role: 'user',
    content: [{ type: 'text', text: { value: text, annotations: [] } }],
    metadata: {},
  }),
}))

vi.mock('@/lib/attachmentProcessing', () => ({
  processAttachmentsForSend: vi
    .fn()
    .mockResolvedValue({ processedAttachments: [], hasEmbeddedDocuments: false }),
}))

vi.mock('@/lib/thread-title-summarizer', () => ({
  generateThreadTitle: vi.fn().mockResolvedValue('Short title'),
}))

vi.mock('@/types/attachment', () => ({
  createImageAttachment: (x: any) => ({ type: 'image', ...x }),
}))

vi.mock('ai', () => ({
  generateId: () => 'gen-id',
  lastAssistantMessageIsCompleteWithToolCalls: () => false,
}))

vi.mock('zustand/react/shallow', () => ({
  useShallow: (fn: any) => fn,
}))

vi.mock('@/hooks/use-chat', () => ({
  useChat: (args: any) => {
    h.useChatArgs.push(args)
    return {
      messages: h.chatState.messages,
      status: h.chatState.status,
      error: h.chatState.error,
      sendMessage: h.mockSendMessage,
      regenerate: h.mockRegenerate,
      setMessages: h.mockSetChatMessages,
      stop: h.mockStop,
      addToolOutput: h.mockAddToolOutput,
      updateRagToolsAvailability: h.mockUpdateRag,
      setContinueFromContent: h.mockSetContinueFromContent,
    }
  },
}))

vi.mock('@/hooks/useThreads', () => ({ useThreads: h.useThreadsMock }))
vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    rag: () => ({ callTool: vi.fn() }),
    mcp: () => ({ callTool: vi.fn() }),
    models: () => ({ stopModel: vi.fn().mockResolvedValue(undefined) }),
    messages: () => ({
      fetchMessages: vi.fn((threadId: string) =>
        Promise.resolve(h.messagesState.getMessages(threadId))
      ),
    }),
    opener: () => ({ openExternalUrl: h.openExternalUrl }),
  }),
}))
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const template =
        ({
        'common:providerQuota.title': 'Provider quota exhausted',
        'common:providerQuota.recharge': 'Recharge',
        'common:providerQuota.manageTokens': 'Manage tokens',
        'common:providerQuota.linksUnavailable': 'No links available',
        'chat:autoRun.label': '自动对话',
        'chat:autoRun.rounds': '轮数',
        'chat:autoRun.start': '开始',
        'chat:autoRun.pause': '暂停',
        'chat:autoRun.resume': '继续',
        'chat:autoRun.stop': '停止',
        'chat:autoRun.completed': '已完成',
        'chat:autoRun.error': '出错',
        'chat:autoRun.blocked.noModel': '请选择模型后再开始自动对话',
        'chat:autoRun.blocked.chatBusy': '等待当前回复结束',
        'chat:autoRun.blocked.toolsBusy': '等待工具调用结束',
        'chat:autoRun.blocked.queueBusy': '等待当前队列消息发送完成',
        'chat:autoRun.status.running': '第 {{current}} / {{max}} 轮运行中',
        'chat:autoRun.status.paused': '已暂停：{{current}} / {{max}}',
        'chat:autoRun.status.stopped': '已停止：{{current}} / {{max}}',
        'chat:autoRun.status.completedWithProgress':
          '已完成：{{current}} / {{max}}',
      })[key] ?? key

      return template.replace(/\{\{(\w+)\}\}/g, (_match, variable) =>
        options?.[variable] !== undefined
          ? String(options[variable])
          : `{{${variable}}}`
      )
    },
  }),
}))
vi.mock('@/hooks/useMessages', () => ({ useMessages: h.useMessagesMock }))
vi.mock('@/hooks/useTools', () => ({ useTools: vi.fn() }))
vi.mock('@/hooks/useAppState', () => ({ useAppState: h.useAppStateMock }))
vi.mock('@/hooks/useModelProvider', () => ({ useModelProvider: h.useModelProviderMock }))
vi.mock('@/stores/chat-session-store', () => ({ useChatSessions: h.useChatSessionsMock }))
vi.mock('@/hooks/useChatAttachments', () => ({
  useChatAttachments: h.useChatAttachmentsMock,
  NEW_THREAD_ATTACHMENT_KEY: '__new-thread__',
}))
vi.mock('@/hooks/useAttachments', () => ({ useAttachments: h.useAttachmentsMock }))
vi.mock('@/hooks/useToolAvailable', () => ({ useToolAvailable: h.useToolAvailableMock }))
vi.mock('@/hooks/useMCPServers', () => ({ useMCPServers: h.useMCPServersMock }))
vi.mock('@/hooks/useToolApproval', () => ({ useToolApproval: h.useToolApprovalMock }))
vi.mock('@/hooks/useAgentMode', () => ({ useAgentMode: h.useAgentModeMock }))
vi.mock('@/stores/message-queue-store', () => ({ useMessageQueue: h.useMessageQueueMock }))

vi.mock('@/hooks/useAutoScroll', () => ({
  useAutoScroll: () => ({
    containerRef: { current: null },
    isAtBottom: true,
    handleScroll: vi.fn(),
    scrollToBottom: vi.fn(),
    forceScrollToBottom: vi.fn(),
    reset: vi.fn(),
  }),
}))

vi.mock('@janhq/core', () => ({
  MessageStatus: { Ready: 'ready' },
  ChatCompletionRole: { Assistant: 'assistant', User: 'user' },
  ContentType: { Text: 'text' },
  ExtensionTypeEnum: { VectorDB: 'vectorDB' },
  VectorDBExtension: class {},
}))

vi.mock('@/constants/chat', () => ({
  SESSION_STORAGE_PREFIX: { INITIAL_MESSAGE: 'initial-message-' },
}))

vi.mock('@/utils/error', () => ({
  OUT_OF_CONTEXT_SIZE: 'OUT_OF_CONTEXT_SIZE',
}))

// -----------------------------------------------------------------------------
// Import component AFTER mocks
// -----------------------------------------------------------------------------
import {
  MAX_MCP_TOOL_FOLLOW_UP_ROUNDS,
  Route,
  countToolCallAssistantRoundsSinceLastUser,
  isWithinMcpToolFollowUpLimit,
} from '../$threadId'
import { useAutoRunStore } from '@/stores/auto-run-store'
import { DEFAULT_MITA_AUTO_RUN } from '@/types/mita-agent'

const renderComponent = () => {
  const Component = Route.component as React.ComponentType
  return render(<Component />)
}

describe('ThreadDetail route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.chatState.messages = []
    h.chatState.status = 'ready'
    h.chatState.error = null
    h.threadsState.threads['thread-1'] = {
      id: 'thread-1',
      title: 'My Thread',
      metadata: {},
      assistants: [],
      model: { id: 'gpt-x', provider: 'openai' },
    }
    h.threadsState.setCurrentThreadId = vi.fn()
    h.threadsState.updateThread = vi.fn()
    h.messagesState.getMessages = vi.fn(() => [
      {
        id: 'u1',
        role: 'user',
        content: [{ type: 'text', text: { value: 'hi', annotations: [] } }],
      },
      {
        id: 'a1',
        role: 'assistant',
        content: [{ type: 'text', text: { value: 'hello', annotations: [] } }],
      },
    ])
    h.messagesState.addMessage = vi.fn()
    h.messagesState.updateMessage = vi.fn()
    h.messagesState.deleteMessage = vi.fn()
    h.messagesState.setMessages = vi.fn()
    h.chatSessionsState.getSessionData = vi.fn(() => ({ tools: [] }))
    h.messageQueueState.dequeue = vi.fn(() => null)
    h.messageQueueState.clearQueue = vi.fn()
    h.agentModeState.agentThreads = {}
    h.openExternalUrl.mockResolvedValue(undefined)
    h.useChatArgs.length = 0
    useAutoRunStore.setState({ runs: {} })
    sessionStorage.clear()
  })

  it('validateSearch returns threadModel from search params', () => {
    const searchModel = { id: 'm1', provider: 'p1' }
    const result = (Route as any).validateSearch({ threadModel: searchModel })
    expect(result.threadModel).toEqual(searchModel)
  })

  it('validateSearch handles missing threadModel', () => {
    const result = (Route as any).validateSearch({})
    expect(result.threadModel).toBeUndefined()
  })

  it('limits automatic tool follow-up rounds per user message', () => {
    const toolRound = (id: string) => ({
      id,
      role: 'assistant',
      parts: [
        {
          type: 'tool-web_search',
          toolCallId: id,
          state: 'output-available',
          output: 'ok',
        },
      ],
    })
    const messages = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'search' }] },
      ...Array.from({ length: MAX_MCP_TOOL_FOLLOW_UP_ROUNDS - 1 }, (_, i) =>
        toolRound(`a${i + 1}`)
      ),
    ] as any[]

    expect(countToolCallAssistantRoundsSinceLastUser(messages)).toBe(4)
    expect(isWithinMcpToolFollowUpLimit(messages)).toBe(true)

    const cappedMessages = [...messages, toolRound('a5')] as any[]
    expect(countToolCallAssistantRoundsSinceLastUser(cappedMessages)).toBe(5)
    expect(isWithinMcpToolFollowUpLimit(cappedMessages)).toBe(false)

    expect(
      countToolCallAssistantRoundsSinceLastUser([
        ...cappedMessages,
        { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'again' }] },
      ] as any[])
    ).toBe(0)
  })

  it('renders header, model dropdown, and chat input', () => {
    renderComponent()
    expect(screen.getByTestId('header-page')).toBeInTheDocument()
    expect(screen.getByTestId('model-dropdown')).toHaveTextContent('gpt-x')
    expect(screen.getByTestId('chat-input')).toBeInTheDocument()
    expect(screen.getByTestId('chat-status')).toHaveTextContent('ready')
  })

  it('injects Mita identity prompt even when thread has no assistant', () => {
    renderComponent()

    expect(h.useChatArgs.at(-1)?.systemMessage).toContain(
      'rendered:You are Mita'
    )
    expect(h.useChatArgs.at(-1)?.systemMessage).toContain(
      'Never say that you are Jan'
    )
    expect(h.useChatArgs.at(-1)?.systemMessage).toContain(
      'your agent identity is Mita'
    )
  })

  it('prepends Mita identity guard to custom assistant instructions', () => {
    h.threadsState.threads['thread-1'].assistants = [
      { id: 'custom', name: 'Custom', instructions: 'Use a concise tone.' },
    ]

    renderComponent()

    expect(h.useChatArgs.at(-1)?.systemMessage).toContain(
      'rendered:You are Mita'
    )
    expect(h.useChatArgs.at(-1)?.systemMessage).toContain(
      'Never say that you are Jan'
    )
    expect(h.useChatArgs.at(-1)?.systemMessage).toContain(
      'your agent identity is Mita'
    )
    expect(h.useChatArgs.at(-1)?.systemMessage).toContain('Use a concise tone.')
  })

  it('sets current thread id on mount and resets on unmount', () => {
    const { unmount } = renderComponent()
    expect(h.threadsState.setCurrentThreadId).toHaveBeenCalledWith('thread-1')
    unmount()
    expect(h.threadsState.setCurrentThreadId).toHaveBeenLastCalledWith(undefined)
  })

  it('renders messages passed through useChat', () => {
    h.chatState.messages = [
      { id: 'm-a', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      { id: 'm-b', role: 'assistant', parts: [{ type: 'text', text: 'yo' }] },
    ]
    renderComponent()
    expect(screen.getByTestId('message-m-a')).toBeInTheDocument()
    expect(screen.getByTestId('message-m-b')).toBeInTheDocument()
  })

  it('submits user text via ChatInput -> sendMessage', async () => {
    renderComponent()
    await act(async () => {
      screen.getByTestId('chat-send').click()
    })
    await waitFor(() => {
      expect(h.mockSendMessage).toHaveBeenCalled()
    })
    expect(h.messagesState.addMessage).toHaveBeenCalled()
  })

  it('invokes stop when ChatInput calls onStop', () => {
    renderComponent()
    screen.getByTestId('chat-stop').click()
    expect(h.mockStop).toHaveBeenCalled()
  })

  it('regenerate from a user message calls regenerate with its id', () => {
    h.chatState.messages = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'hello' }] },
    ]
    renderComponent()
    screen.getByTestId('regen-u1').click()
    expect(h.mockRegenerate).toHaveBeenCalledWith({ messageId: 'u1' })
  })

  it('regenerate from an assistant message deletes msgs after preceding user', () => {
    h.chatState.messages = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'hello' }] },
    ]
    renderComponent()
    screen.getByTestId('regen-a1').click()
    expect(h.messagesState.deleteMessage).toHaveBeenCalledWith('thread-1', 'a1')
    expect(h.mockRegenerate).toHaveBeenCalledWith({ messageId: 'a1' })
  })

  it('edit on a user message updates and regenerates', () => {
    h.chatState.messages = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'hello' }] },
    ]
    renderComponent()
    screen.getByTestId('edit-u1').click()
    expect(h.messagesState.updateMessage).toHaveBeenCalled()
    expect(h.mockSetChatMessages).toHaveBeenCalled()
    expect(h.messagesState.deleteMessage).toHaveBeenCalledWith('thread-1', 'a1')
    expect(h.mockRegenerate).toHaveBeenCalledWith({ messageId: 'u1' })
  })

  it('edit on an assistant message updates without regenerating', () => {
    h.chatState.messages = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'hello' }] },
    ]
    renderComponent()
    screen.getByTestId('edit-a1').click()
    expect(h.messagesState.updateMessage).toHaveBeenCalled()
    expect(h.mockRegenerate).not.toHaveBeenCalled()
  })

  it('delete removes message from store and chat list', () => {
    h.chatState.messages = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
    ]
    renderComponent()
    screen.getByTestId('del-u1').click()
    expect(h.messagesState.deleteMessage).toHaveBeenCalledWith('thread-1', 'u1')
    expect(h.mockSetChatMessages).toHaveBeenCalled()
  })

  it('shows PromptProgress while status is submitted', () => {
    h.chatState.status = 'submitted'
    renderComponent()
    expect(screen.getByTestId('prompt-progress')).toBeInTheDocument()
  })

  it('falls back to ready after onFinish when the SDK status remains streaming', async () => {
    h.chatState.status = 'streaming'
    renderComponent()
    expect(screen.getByTestId('chat-status')).toHaveTextContent('streaming')

    await act(async () => {
      h.useChatArgs.at(-1).onFinish({
        message: {
          id: 'assistant-1',
          role: 'assistant',
          parts: [{ type: 'text', text: 'done' }],
          metadata: {},
        },
        messages: [],
        isAbort: false,
        isDisconnect: false,
        isError: false,
      })
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.getByTestId('chat-status')).toHaveTextContent('ready')
    })
  })

  it('shows why auto-run start is blocked while a reply is active', () => {
    h.chatState.status = 'streaming'
    renderComponent()

    expect(screen.getByText('等待当前回复结束')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /开始/ })).toBeDisabled()
  })

  it('starts auto-run from the panel and persists running metadata', () => {
    renderComponent()

    act(() => {
      screen.getByRole('button', { name: /开始/ }).click()
    })

    expect(h.threadsState.updateThread).toHaveBeenCalledWith(
      'thread-1',
      expect.objectContaining({
        metadata: expect.objectContaining({
          mitaAutoRun: expect.objectContaining({
            status: 'running',
            enabled: true,
            maxRounds: 3,
            currentRound: 0,
          }),
        }),
      })
    )
  })

  it('pauses a running auto-run and persists the paused state', () => {
    useAutoRunStore.getState().setRun('thread-1', {
      ...DEFAULT_MITA_AUTO_RUN,
      status: 'running',
      enabled: true,
      maxRounds: 3,
      currentRound: 1,
    })

    renderComponent()
    act(() => {
      screen.getByRole('button', { name: /暂停/ }).click()
    })

    expect(h.threadsState.updateThread).toHaveBeenCalledWith(
      'thread-1',
      expect.objectContaining({
        metadata: expect.objectContaining({
          mitaAutoRun: expect.objectContaining({
            status: 'paused',
            enabled: true,
          }),
        }),
      })
    )
  })

  it('resumes a paused auto-run and persists the running state', () => {
    useAutoRunStore.getState().setRun('thread-1', {
      ...DEFAULT_MITA_AUTO_RUN,
      status: 'paused',
      enabled: true,
      maxRounds: 3,
      currentRound: 1,
    })

    renderComponent()
    act(() => {
      screen.getByRole('button', { name: /继续/ }).click()
    })

    expect(h.threadsState.updateThread).toHaveBeenCalledWith(
      'thread-1',
      expect.objectContaining({
        metadata: expect.objectContaining({
          mitaAutoRun: expect.objectContaining({
            status: 'running',
            enabled: true,
          }),
        }),
      })
    )
  })

  it('stops a running auto-run and persists the stopped state', () => {
    useAutoRunStore.getState().setRun('thread-1', {
      ...DEFAULT_MITA_AUTO_RUN,
      status: 'running',
      enabled: true,
      maxRounds: 3,
      currentRound: 1,
    })

    renderComponent()
    act(() => {
      screen.getByRole('button', { name: /停止/ }).click()
    })

    expect(h.threadsState.updateThread).toHaveBeenCalledWith(
      'thread-1',
      expect.objectContaining({
        metadata: expect.objectContaining({
          mitaAutoRun: expect.objectContaining({
            status: 'stopped',
            enabled: false,
          }),
        }),
      })
    )
  })

  it('shows error banner with Regenerate button for generic errors', () => {
    h.chatState.error = new Error('something broke')
    renderComponent()
    expect(screen.getByText('Error generating response')).toBeInTheDocument()
    expect(screen.getByText('something broke')).toBeInTheDocument()
    expect(screen.getByText('Regenerate')).toBeInTheDocument()
  })

  it('shows provider quota actions instead of regenerate for quota errors', () => {
    h.chatState.error = new ProviderQuotaError({
      message: '璇ヤ护鐗岄搴﹀凡鐢ㄥ敖',
      status: 403,
      code: 'pre_consume_token_quota_failed',
      rechargeUrl: 'https://api.jingxing.uk/console/topup',
      tokenUrl: 'https://api.jingxing.uk/console/token',
      metadata: { quota_error: true },
    })
    renderComponent()

    expect(screen.getByText('Provider quota exhausted')).toBeInTheDocument()
    expect(screen.getByText('璇ヤ护鐗岄搴﹀凡鐢ㄥ敖')).toBeInTheDocument()
    expect(screen.queryByText('Regenerate')).not.toBeInTheDocument()
    screen.getByText('Recharge').click()
    expect(h.openExternalUrl).toHaveBeenCalledWith(
      'https://api.jingxing.uk/console/topup'
    )
    expect(screen.getByText('Manage tokens')).toBeInTheDocument()
  })

  it('shows Increase Context Size button on context-length errors (agent mode)', () => {
    // Agent mode bypasses auto-increase effect so the UI stays on the error.
    h.agentModeState.agentThreads = { 'thread-1': true }
    h.chatState.error = new Error('context length limit exceeded')
    renderComponent()
    expect(screen.getByText('Increase Context Size')).toBeInTheDocument()
  })

  it('clicking Regenerate in error banner triggers regenerate()', () => {
    h.chatState.error = new Error('something broke')
    renderComponent()
    screen.getByText('Regenerate').click()
    expect(h.mockRegenerate).toHaveBeenCalled()
  })

  it('processes an initial message from sessionStorage on mount', async () => {
    sessionStorage.setItem(
      'initial-message-thread-1',
      JSON.stringify({ text: 'hello from storage' })
    )
    renderComponent()
    await waitFor(() => {
      expect(h.mockSendMessage).toHaveBeenCalled()
    })
    expect(sessionStorage.getItem('initial-message-thread-1')).toBeNull()
  })

  it('clears queue on unmount', () => {
    const { unmount } = renderComponent()
    unmount()
    expect(h.messageQueueState.clearQueue).toHaveBeenCalledWith('thread-1')
  })

  it('updates RAG tool availability based on thread/model capabilities', async () => {
    renderComponent()
    await waitFor(() => {
      expect(h.mockUpdateRag).toHaveBeenCalled()
    })
    const args = h.mockUpdateRag.mock.calls[0]
    expect(args[1]).toBe(true) // modelSupportsTools
    expect(args[2]).toBe(true) // ragFeatureAvailable
  })
})
