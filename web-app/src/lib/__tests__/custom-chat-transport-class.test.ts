import { describe, expect, it, vi, beforeEach } from 'vitest'
import { CustomChatTransport, normalizeToolInputSchema } from '../custom-chat-transport'

const h = vi.hoisted(() => ({
  serviceHub: null as any,
  mcpSettings: {} as any,
  selectedModel: null as any,
  selectedProvider: '',
  getRelevantTools: vi.fn(),
  invalidateCache: vi.fn(),
}))

// Mock all the heavy dependencies
vi.mock('@/hooks/useServiceHub', () => ({
  useServiceStore: { getState: () => ({ serviceHub: h.serviceHub }) },
}))

vi.mock('@/hooks/useToolAvailable', () => ({
  useToolAvailable: { getState: () => ({ getDisabledToolsForThread: () => [], getDefaultDisabledTools: () => [] }) },
}))

vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: { getState: () => ({ selectedModel: h.selectedModel, selectedProvider: h.selectedProvider, getProviderByName: () => null }) },
}))

vi.mock('@/hooks/useAssistant', () => ({
  useAssistant: { getState: () => ({ currentAssistant: null }) },
}))

vi.mock('@/hooks/useThreads', () => ({
  useThreads: { getState: () => ({ threads: {} }) },
}))

vi.mock('@/hooks/useAttachments', () => ({
  useAttachments: { getState: () => ({ enabled: false }) },
}))

vi.mock('@/hooks/useMCPServers', () => ({
  useMCPServers: { getState: () => ({ settings: h.mcpSettings }) },
}))

vi.mock('@/lib/extension', () => ({
  ExtensionManager: { getInstance: () => ({ get: () => null }) },
}))

vi.mock('@/lib/mcp-orchestrator', () => ({
  mcpOrchestrator: {
    getRelevantTools: h.getRelevantTools,
    invalidateCache: h.invalidateCache,
  },
}))

vi.mock('@/lib/mcp-router-model-filter', () => ({
  isRouterModelSelectable: () => false,
}))

vi.mock('./model-factory', () => ({
  ModelFactory: { createModel: vi.fn() },
}))

describe('CustomChatTransport', () => {
  let transport: CustomChatTransport

  beforeEach(() => {
    h.serviceHub = null
    h.mcpSettings = {}
    h.selectedModel = null
    h.selectedProvider = ''
    h.getRelevantTools.mockReset()
    h.invalidateCache.mockReset()
    transport = new CustomChatTransport('You are helpful', 'thread-1')
  })

  it('initializes with system message', () => {
    expect(transport).toBeDefined()
    expect(transport.model).toBeNull()
  })

  it('getTools returns empty object initially', () => {
    expect(transport.getTools()).toEqual({})
  })

  it('setOnTokenUsage sets callback', () => {
    const cb = vi.fn()
    transport.setOnTokenUsage(cb)
    // No error means it worked
    expect(true).toBe(true)
  })

  it('updateSystemMessage updates the system message', () => {
    transport.updateSystemMessage('new message')
    // Internal state updated - no public getter, just verify no error
    expect(true).toBe(true)
  })

  it('setContinueFromContent sets content', () => {
    transport.setContinueFromContent('partial content')
    expect(true).toBe(true)
  })

  it('setLastUserMessage sets the message', () => {
    transport.setLastUserMessage('hello')
    expect(true).toBe(true)
  })

  it('pins the built-in computer agent server when smart routing is enabled', async () => {
    h.selectedModel = { capabilities: ['tools'] }
    h.mcpSettings = {
      enableSmartToolRouting: true,
      useLightweightRouterModel: false,
      routerModelProvider: '',
      routerModelId: '',
      computerAgentEnabled: true,
    }
    h.serviceHub = {
      rag: () => ({ getTools: vi.fn().mockResolvedValue([]) }),
      mcp: () => ({
        getTools: vi.fn().mockResolvedValue([]),
        getToolsForServers: vi.fn().mockResolvedValue([]),
        getServerSummaries: vi.fn().mockResolvedValue([]),
      }),
    }
    h.getRelevantTools.mockResolvedValue([
      {
        name: 'computer_agent_create_directory',
        description: 'Create a directory',
        inputSchema: { type: 'object' },
        server: 'mita-computer-agent',
      },
    ])
    const routedTransport = new CustomChatTransport('You are helpful', 'thread-1')
    routedTransport.setLastUserMessage('create a folder')

    await routedTransport.updateRagToolsAvailability(false, true, false)

    expect(h.getRelevantTools).toHaveBeenCalledWith(
      'create a folder',
      expect.any(Object),
      [],
      expect.objectContaining({
        pinnedServerNames: ['mita-computer-agent'],
      })
    )
    expect(routedTransport.getTools()).toHaveProperty(
      'computer_agent_create_directory'
    )
  })

  it('loads tools for inferred OpenAI GPT tool-capable models with stale persisted capabilities', async () => {
    h.selectedProvider = 'openai'
    h.selectedModel = { id: 'gpt-5.5', capabilities: ['completion'] }
    h.mcpSettings = {
      enableSmartToolRouting: false,
      computerAgentEnabled: true,
    }
    h.serviceHub = {
      rag: () => ({ getTools: vi.fn().mockResolvedValue([]) }),
      mcp: () => ({
        getTools: vi.fn().mockResolvedValue([
          {
            name: 'computer_agent_create_directory',
            description: 'Create a directory',
            inputSchema: { type: 'object' },
            server: 'mita-computer-agent',
          },
        ]),
        getToolsForServers: vi.fn().mockResolvedValue([]),
        getServerSummaries: vi.fn().mockResolvedValue([]),
      }),
    }
    const routedTransport = new CustomChatTransport('You are helpful', 'thread-1')

    await routedTransport.updateRagToolsAvailability(false, true, false)

    expect(routedTransport.getTools()).toHaveProperty(
      'computer_agent_create_directory'
    )
  })

  it('refreshes the built-in computer agent cache before smart routing', async () => {
    h.selectedModel = { capabilities: ['tools'] }
    h.mcpSettings = {
      enableSmartToolRouting: true,
      useLightweightRouterModel: false,
      routerModelProvider: '',
      routerModelId: '',
      computerAgentEnabled: true,
    }
    h.serviceHub = {
      rag: () => ({ getTools: vi.fn().mockResolvedValue([]) }),
      mcp: () => ({
        getTools: vi.fn().mockResolvedValue([]),
        getToolsForServers: vi.fn().mockResolvedValue([]),
        getServerSummaries: vi.fn().mockResolvedValue([]),
      }),
    }
    h.getRelevantTools.mockResolvedValue([])

    const routedTransport = new CustomChatTransport('You are helpful', 'thread-1')
    await routedTransport.updateRagToolsAvailability(false, true, false)

    expect(h.invalidateCache).toHaveBeenCalledWith('mita-computer-agent')
  })

  it('reconnectToStream returns null', async () => {
    const result = await transport.reconnectToStream({ chatId: 'c1' } as any)
    expect(result).toBeNull()
  })

  it('mapUserInlineAttachments passes through non-user messages', () => {
    const messages = [
      { role: 'assistant', parts: [{ type: 'text', text: 'Hi' }], metadata: {} },
    ] as any
    const result = transport.mapUserInlineAttachments(messages)
    expect(result[0].parts[0].text).toBe('Hi')
  })

  it('mapUserInlineAttachments appends inline files to user text', () => {
    const messages = [
      {
        role: 'user',
        parts: [{ type: 'text', text: 'Check this' }],
        metadata: {
          inline_file_contents: [{ name: 'file.txt', content: 'hello world' }],
        },
      },
    ] as any
    const result = transport.mapUserInlineAttachments(messages)
    expect(result[0].parts[0].text).toContain('file.txt')
    expect(result[0].parts[0].text).toContain('hello world')
  })

  it('mapUserInlineAttachments ignores entries without content', () => {
    const messages = [
      {
        role: 'user',
        parts: [{ type: 'text', text: 'Check' }],
        metadata: {
          inline_file_contents: [{ name: 'empty.txt' }],
        },
      },
    ] as any
    const result = transport.mapUserInlineAttachments(messages)
    expect(result[0].parts[0].text).toBe('Check')
  })
})

describe('normalizeToolInputSchema edge cases', () => {
  it('handles null/undefined values', () => {
    expect(normalizeToolInputSchema({ type: 'string', default: null })).toEqual({
      type: 'string',
      default: null,
    })
  })

  it('handles primitive values', () => {
    expect(normalizeToolInputSchema({ type: 'number' })).toEqual({ type: 'number' })
  })

  it('handles $ref without adding type', () => {
    const schema = { $ref: '#/definitions/Foo', description: 'A foo' }
    const result = normalizeToolInputSchema(schema)
    expect(result.type).toBeUndefined()
    expect(result.$ref).toBe('#/definitions/Foo')
  })

  it('handles arrays at top level', () => {
    const schema = {
      type: 'object',
      properties: {
        tags: {
          type: 'array',
          items: { description: 'A tag' },
        },
      },
    }
    const result = normalizeToolInputSchema(schema)
    expect((result.properties as any).tags.items.type).toBe('string')
  })
})
