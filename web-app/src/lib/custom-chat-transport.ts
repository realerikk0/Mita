import { type UIMessage } from '@ai-sdk/react'
import {
  convertToModelMessages,
  streamText,
  type ChatRequestOptions,
  type ChatTransport,
  type LanguageModel,
  type ModelMessage,
  type UIMessageChunk,
  type Tool,
  type LanguageModelUsage,
  jsonSchema,
} from 'ai'
import { useServiceStore } from '@/hooks/useServiceHub'
import { useToolAvailable } from '@/hooks/useToolAvailable'
import { ModelFactory } from './model-factory'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useAssistant } from '@/hooks/useAssistant'
import { useThreads } from '@/hooks/useThreads'
import { useAttachments } from '@/hooks/useAttachments'
import { useMCPServers } from '@/hooks/useMCPServers'
import { ExtensionManager } from '@/lib/extension'
import {
  ExtensionTypeEnum,
  VectorDBExtension,
  type MCPTool,
} from '@janhq/core'
import {
  trimMessages,
  compactMessages,
  estimateTokens,
  totalMessageChars,
  type ContextManagerConfig,
} from './context-manager'
import { useTokenCalibration } from '@/stores/token-calibration-store'
import { isArchivedCompactMessage } from './compact-thread'
import { mcpOrchestrator } from '@/lib/mcp-orchestrator'
import { isRouterModelSelectable } from '@/lib/mcp-router-model-filter'
import { isBrowserMCPServerName } from '@/constants/mcp'
import { isBiyuanProvider } from '@/constants/biyuan'
import { useWebSearch } from '@/hooks/useWebSearch'
import {
  canUseJingxingNativeWebSearch,
  protectedJingxingMaxOutputTokens,
  streamJingxingNativeWebSearch,
  streamJingxingResponsesChat,
} from '@/lib/jingxing-responses-web-search'
import { getToolAwareSystemMessage } from '@/lib/mita-prompt'
import {
  encodeProviderQuotaError,
  providerQuotaErrorFromUnknown,
} from '@/lib/provider-quota-error'
import { trackMitaEvent } from '@/lib/analytics'
import { normalizeModelCapabilitiesForProvider } from '@/lib/models'
import {
  blockSearchDecision,
  decideChatSearch,
  searchDecisionMetadata,
  webSearchModeFromEnabled,
} from '@/lib/search-decision'
import { modelRequiresResponsesEndpoint } from '@/lib/provider-models'

const COMPUTER_AGENT_SERVER_NAME = 'mita-computer-agent'

export type TokenUsageCallback = (
  usage: LanguageModelUsage,
  messageId: string
) => void
export type StreamingTokenSpeedCallback = (
  tokenCount: number,
  elapsedMs: number
) => void
export type OnFinishCallback = (params: {
  message: UIMessage
  isAbort?: boolean
}) => void
export type OnToolCallCallback = (params: {
  toolCall: { toolCallId: string; toolName: string; input: unknown }
}) => void
export type ServiceHub = {
  rag(): {
    getTools(): Promise<
      Array<{ name: string; description: string; inputSchema: unknown }>
    >
  }
  mcp(): {
    getTools(): Promise<MCPTool[]>
    /** TauriMCPService only */
    getToolsForServers?(serverNames: string[]): Promise<MCPTool[]>
    /** TauriMCPService only */
    getServerSummaries?(): Promise<
      Array<{ name: string; capabilities: string[]; description: string }>
    >
  }
}

export const JINGXING_REMOTE_MIN_OUTPUT_TOKENS = 4096
export const JINGXING_GEMINI_3_5_FLASH_MIN_OUTPUT_TOKENS =
  JINGXING_REMOTE_MIN_OUTPUT_TOKENS

export function getProtectedMaxOutputTokens(
  modelId: string | undefined,
  configuredMaxOutputTokens: number | undefined
): number | undefined {
  if (!modelId) {
    return configuredMaxOutputTokens
  }

  return protectedJingxingMaxOutputTokens(configuredMaxOutputTokens)
}

function normalizeToolInputSchemaValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeToolInputSchemaValue)
  }

  if (!value || typeof value !== 'object') {
    return value
  }

  const normalized = Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, childValue]) => [
      key,
      normalizeToolInputSchemaValue(childValue),
    ])
  )

  const hasDescription = Object.prototype.hasOwnProperty.call(normalized, 'description')
  const hasType = Object.prototype.hasOwnProperty.call(normalized, 'type')
  const hasNestedSchemaKeywords =
    Object.prototype.hasOwnProperty.call(normalized, 'properties') ||
    Object.prototype.hasOwnProperty.call(normalized, 'items') ||
    Object.prototype.hasOwnProperty.call(normalized, 'anyOf') ||
    Object.prototype.hasOwnProperty.call(normalized, 'oneOf') ||
    Object.prototype.hasOwnProperty.call(normalized, 'allOf') ||
    Object.prototype.hasOwnProperty.call(normalized, '$ref')

  if (normalized.type === 'object' && !Object.prototype.hasOwnProperty.call(normalized, 'properties')) {
    normalized.properties = {}
  }

  if (hasDescription && !hasType && !hasNestedSchemaKeywords) {
    normalized.type = 'string'
  }

  return normalized
}

type ToolInputSchema = Record<string, unknown>

// Keep this behavior aligned with `normalize_openai_tool_parameters_schema` in Rust.
export function normalizeToolInputSchema(
  schema: ToolInputSchema
): ToolInputSchema {
  return normalizeToolInputSchemaValue(schema) as ToolInputSchema
}

/** Text from the most recent user message (for MCP server routing). */
function extractLatestUserText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'user') continue
    const parts = Array.isArray(m.parts) ? m.parts : []
    const chunks: string[] = []
    for (const p of parts) {
      if (p.type === 'text' && typeof (p as { text?: string }).text === 'string') {
        const t = (p as { text: string }).text.trim()
        if (t) chunks.push(t)
      }
    }
    if (chunks.length > 0) return chunks.join('\n')
  }
  return ''
}

/**
 * Wraps a UIMessageChunk stream so that when the first `text-start` chunk
 * arrives, a `text-delta` carrying `prefixText` is immediately injected into
 * the same text block. This makes the new message show the partial content
 * right away while continuation tokens stream in after it.
 */
function prependTextDeltaToUIStream(
  stream: ReadableStream<UIMessageChunk>,
  prefixText: string
): ReadableStream<UIMessageChunk> {
  const reader = stream.getReader()
  let prefixEmitted = false
  return new ReadableStream<UIMessageChunk>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (done) {
          controller.close()
          return
        }
        controller.enqueue(value)
        if (!prefixEmitted && (value as { type: string }).type === 'text-start') {
          prefixEmitted = true
          const id = (value as { type: 'text-start'; id: string }).id
          controller.enqueue({ type: 'text-delta', id, delta: prefixText } as UIMessageChunk)
        }
      } catch (error) {
        controller.error(error)
      }
    },
    cancel() {
      reader.cancel()
    },
  })
}

export class CustomChatTransport implements ChatTransport<UIMessage> {
  public model: LanguageModel | null = null
  private routerModel: LanguageModel | null = null
  private routerModelKey = ''
  private tools: Record<string, Tool> = {}
  private onTokenUsage?: TokenUsageCallback
  private hasDocuments = false
  private modelSupportsTools = false
  private ragFeatureAvailable = false
  private systemMessage?: string
  private serviceHub: ServiceHub | null
  private threadId?: string
  private continueFromContent: string | null = null
  /** Latest user message text — used by the MCP orchestrator for tool routing. */
  private lastUserMessage = ''

  constructor(systemMessage?: string, threadId?: string) {
    this.systemMessage = systemMessage
    this.threadId = threadId
    this.serviceHub = useServiceStore.getState().serviceHub
    // Tools will be loaded when updateRagToolsAvailability is called with model capabilities
  }

  private currentModelSupportsTools(): boolean {
    const { selectedModel, selectedProvider } = useModelProvider.getState()
    if (!selectedModel) {
      return this.modelSupportsTools
    }

    const capabilities =
      normalizeModelCapabilitiesForProvider(selectedProvider || '', selectedModel) ??
      selectedModel.capabilities

    return capabilities?.includes('tools') ?? this.modelSupportsTools
  }

  setLastUserMessage(message: string): void {
    this.lastUserMessage = message
  }

  updateSystemMessage(systemMessage: string | undefined) {
    this.systemMessage = systemMessage
  }

  setOnTokenUsage(callback: TokenUsageCallback | undefined) {
    this.onTokenUsage = callback
  }

  /**
   * Update RAG tools availability based on thread metadata and model capabilities
   * @param hasDocuments - Whether the thread has documents attached
   * @param modelSupportsTools - Whether the current model supports tool calling
   * @param ragFeatureAvailable - Whether RAG features are available on the platform
   */
  async updateRagToolsAvailability(
    hasDocuments: boolean,
    modelSupportsTools: boolean,
    ragFeatureAvailable: boolean
  ) {
    this.hasDocuments = hasDocuments
    this.modelSupportsTools = modelSupportsTools
    this.ragFeatureAvailable = ragFeatureAvailable

    // Update tools based on current state
    await this.refreshTools()
  }

  /**
   * Refresh tools based on current state
   * Reloads both RAG and MCP tools and merges them
   * Filters out disabled tools based on thread settings
   * @private
   */
  async refreshTools(abortSignal?: AbortSignal) {
    if (!this.serviceHub) {
      this.tools = {}
      return
    }

    const toolsRecord: Record<string, Tool> = {}

    // Get disabled tools for this thread
    const getDisabledToolsForThread =
      useToolAvailable.getState().getDisabledToolsForThread
    const disabledToolKeys = this.threadId
      ? getDisabledToolsForThread(this.threadId)
      : useToolAvailable.getState().getDefaultDisabledTools()
    // Helper to check if a tool is disabled
    const isToolDisabled = (serverName: string, toolName: string): boolean => {
      const toolKey = `${serverName}::${toolName}`
      return disabledToolKeys.includes(toolKey)
    }

    const modelSupportsTools = this.currentModelSupportsTools()

    // Only load tools if model supports them
    if (modelSupportsTools) {
      let hasDocuments = this.hasDocuments
      let ragFeatureAvailable = this.ragFeatureAvailable

      if (!hasDocuments && this.threadId) {
        const thread = useThreads.getState().threads[this.threadId]
        const hasThreadDocuments = Boolean(thread?.metadata?.hasDocuments)

        const projectId = thread?.metadata?.project?.id
        if (projectId) {
          try {
            const ext = ExtensionManager.getInstance().get<VectorDBExtension>(
              ExtensionTypeEnum.VectorDB
            )
            if (ext?.listAttachmentsForProject) {
              const projectFiles = await ext.listAttachmentsForProject(projectId)
              hasDocuments = hasThreadDocuments || projectFiles.length > 0
            }
          } catch (error) {
            console.warn('Failed to check project files:', error)
            hasDocuments = hasThreadDocuments
          }
        } else {
          hasDocuments = hasThreadDocuments
        }
      }

      if (!ragFeatureAvailable) {
        ragFeatureAvailable = Boolean(useAttachments.getState().enabled)
      }

      // Load RAG tools if documents are available
      if (hasDocuments && ragFeatureAvailable) {
        try {
          const ragTools = await this.serviceHub.rag().getTools()
          if (Array.isArray(ragTools) && ragTools.length > 0) {
            // Convert RAG tools to AI SDK format, filtering out disabled tools
            ragTools.forEach((tool) => {
              // RAG tools use MCPTool interface with server field
              const serverName =
                (tool as { server?: string }).server || 'unknown'
              if (!isToolDisabled(serverName, tool.name)) {
                toolsRecord[tool.name] = {
                  description: tool.description,
                  inputSchema: jsonSchema(
                    normalizeToolInputSchema(tool.inputSchema as Record<string, unknown>)
                  ),
                } as Tool
              }
            })
          }
        } catch (error) {
          console.warn('Failed to load RAG tools:', error)
        }
      }

      // Load MCP tools — route through the orchestrator when available so only
      // relevant servers are queried instead of all of them.
      try {
        const mcpService = this.serviceHub.mcp()
        let mcpTools: MCPTool[]
        const mcpSettings = useMCPServers.getState().settings
        mcpOrchestrator.invalidateCache(COMPUTER_AGENT_SERVER_NAME)
        const routingEnabled = mcpSettings.enableSmartToolRouting

        if (
          routingEnabled &&
          mcpService.getToolsForServers &&
          mcpService.getServerSummaries
        ) {
          const routerModel =
            mcpSettings.useLightweightRouterModel &&
            mcpSettings.routerModelProvider.trim() &&
            mcpSettings.routerModelId.trim()
              ? (await this.resolveRouterModel(mcpSettings)) ?? this.model
              : this.model
          mcpTools = await mcpOrchestrator.getRelevantTools(
            this.lastUserMessage,
            {
              getTools: () => mcpService.getTools(),
              getToolsForServers: (names) =>
                mcpService.getToolsForServers!(names),
              getServerSummaries: () => mcpService.getServerSummaries!(),
            },
            disabledToolKeys,
            {
              routerModel,
              abortSignal,
              onRoutingTelemetry: (info) => {
                trackMitaEvent('mcp_routing_completed', {
                  connected_server_count: info.connectedServerCount,
                  fallback_reason: info.fallbackReason,
                  llm_accepted: info.llmAccepted,
                  llm_invoked: info.llmInvoked,
                  pick_source: info.pickSource ?? 'bypassed',
                  routing_ran: info.routingRan,
                  selected_server_count: info.selectedServerCount,
                  total_latency_ms: info.totalLatencyMs,
                })
              },
              pinnedServerNames: mcpSettings.computerAgentEnabled
                ? [COMPUTER_AGENT_SERVER_NAME]
                : [],
            }
          )
        } else {
          mcpTools = await mcpService.getTools()
        }

        if (Array.isArray(mcpTools) && mcpTools.length > 0) {
          // MCP tools added after RAG tools, so they take precedence on name conflicts
          mcpTools.forEach((tool) => {
            const serverName = tool.server || 'unknown'
            if (isBrowserMCPServerName(serverName) && !useWebSearch.getState().enabled) {
              return
            }
            if (!isToolDisabled(serverName, tool.name)) {
              toolsRecord[tool.name] = {
                description: tool.description,
                inputSchema: jsonSchema(
                  normalizeToolInputSchema(tool.inputSchema as Record<string, unknown>)
                ),
              } as Tool
            }
          })
        }
      } catch (error) {
        console.warn('Failed to load MCP tools:', error)
      }
    }

    this.tools = toolsRecord
  }

  private async resolveRouterModel(settings: {
    useLightweightRouterModel: boolean
    routerModelProvider: string
    routerModelId: string
  }): Promise<LanguageModel | null> {
    if (!settings.useLightweightRouterModel) return null
    const providerName = settings.routerModelProvider.trim()
    const modelId = settings.routerModelId.trim()
    if (!providerName || !modelId) return null

    const key = `${providerName}::${modelId}`
    if (this.routerModel && this.routerModelKey === key) {
      return this.routerModel
    }

    const provider = useModelProvider.getState().getProviderByName(providerName)
    if (!provider) {
      console.warn(
        `[MCP] Router model provider '${providerName}' not found; using chat model for routing.`
      )
      return null
    }

    const catalogModel = provider.models.find((m) => m.id === modelId)
    if (!catalogModel || !isRouterModelSelectable(provider, catalogModel)) {
      console.warn(
        `[MCP] Router model '${key}' is not allowed for routing (use a lightweight model with API access); using chat model for routing.`
      )
      return null
    }

    try {
      const model = await ModelFactory.createModel(modelId, provider, {})
      this.routerModel = model
      this.routerModelKey = key
      return model
    } catch (error) {
      console.warn(
        `[MCP] Failed to create router model '${key}'; using chat model for routing.`,
        error
      )
      this.routerModel = null
      this.routerModelKey = ''
      return null
    }
  }

  /**
   * Get current tools
   */
  getTools(): Record<string, Tool> {
    return this.tools
  }

  /**
   * Set partial assistant content to send as a prefill on the next request,
   * so the model continues generation from where it left off.
   */
  setContinueFromContent(content: string) {
    this.continueFromContent = content
  }

  async sendMessages(
    options: {
      chatId: string
      messages: UIMessage[]
      abortSignal: AbortSignal | undefined
    } & {
      trigger: 'submit-message' | 'regenerate-message'
      messageId: string | undefined
    } & ChatRequestOptions
  ): Promise<ReadableStream<UIMessageChunk>> {
    // Capture the effective provider name early so the Anthropic serial
    // tool-use repair later uses the same value that was used to create the
    // model, even if the user switches provider mid-request.
    const modelId = useModelProvider.getState().selectedModel?.id
    const providerId = useModelProvider.getState().selectedProvider
    const effectiveProviderName = providerId
    const provider = useModelProvider.getState().getProviderByName(providerId)
    if (!this.serviceHub || !modelId || !provider) {
      throw new Error('ServiceHub not initialized or model/provider missing.')
    }
    let effectiveProvider = provider

    this.lastUserMessage = extractLatestUserText(options.messages)

    try {
      const updatedProvider = useModelProvider
        .getState()
        .getProviderByName(providerId)
      effectiveProvider = updatedProvider ?? provider

      const currentAssistant = useAssistant.getState().currentAssistant
      const inferenceParams = currentAssistant?.parameters

      // Create the model before refreshing tools so the MCP orchestrator can run
      // structured LLM routing when many servers are connected.
      this.model = await ModelFactory.createModel(
        modelId,
        effectiveProvider,
        inferenceParams ?? {}
      )
    } catch (error) {
      console.error('Failed to create model:', error)
      throw new Error(
        `Failed to create model: ${error instanceof Error ? error.message : JSON.stringify(error)}`
      )
    }

    await this.refreshTools(options.abortSignal)

    // Fix for Anthropic serial tool-use (error 400): when an assistant message
    // contains tool parts interleaved with text parts (serial tool calls),
    // split it into separate messages so convertToModelMessages produces the
    // tool_use / tool_result pairing that the Claude API requires.
    // See: https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use#parallel-tool-use
    const messagesToConvert = (() => {
      if (effectiveProviderName !== 'anthropic') {
        return options.messages
      }
      return options.messages.flatMap((message) => {
        if (message.role !== 'assistant') return [message]

        const parts = Array.isArray(message.parts) ? message.parts : []
        if (parts.length === 0) return [message]

        const isToolPart = (p: (typeof parts)[number]) =>
          p.type.startsWith('tool-')

        const waves: (typeof parts)[] = []
        let currentWave: typeof parts = []
        let seenToolParts = false

        for (const part of parts) {
          if (isToolPart(part)) {
            seenToolParts = true
            currentWave.push(part)
          } else if (!isToolPart(part) && seenToolParts) {
            // Any non-tool part (text, reasoning, file, etc.) after tool parts
            // marks the start of a new wave
            waves.push(currentWave)
            currentWave = [part]
            seenToolParts = false
          } else {
            currentWave.push(part)
          }
        }
        if (currentWave.length > 0) waves.push(currentWave)

        // No serial tool calls detected — return original message unchanged
        if (waves.length <= 1) return [message]

        return waves.map((waveParts, i) => ({
          ...message,
          id: `${message.id}_w${i}`,
          parts: waveParts,
        }))
      })
    })()

    const inferenceParams = useAssistant.getState().currentAssistant?.parameters ?? {}
    const compactVisibleMessages = messagesToConvert.filter(
      (message) => !isArchivedCompactMessage(message)
    )

    const selectedModel = useModelProvider.getState().selectedModel

    const configuredMaxOutputTokens: number | undefined = (() => {
      const raw = inferenceParams.max_output_tokens ?? inferenceParams.max_tokens
      if (raw === undefined || raw === null) return undefined
      const n = typeof raw === 'number' ? raw : Number(raw)
      return isNaN(n) ? undefined : n
    })()
    const isBiyuanFamilyProvider = isBiyuanProvider(
      providerId,
      effectiveProvider.base_url
    )
    const maxOutputTokens = getProtectedMaxOutputTokens(
      isBiyuanFamilyProvider ? modelId : undefined,
      configuredMaxOutputTokens
    )

    const maxContextTokens = (() => {
      const raw = inferenceParams.max_context_tokens
      return typeof raw === 'number' ? raw : (Number(raw) || 0)
    })()
    const autoCompact =
      inferenceParams.auto_compact === true ||
      inferenceParams.auto_compact === 'true'

    // Per-model calibrated chars-per-token (falls back to the default prior for
    // unknown / not-yet-observed / non-usage-reporting models).
    const charsPerToken =
      useTokenCalibration.getState().getCharsPerToken(modelId)

    // Auto-trim or auto-compact conversation history when max_context_tokens is configured
    let effectiveMessages = compactVisibleMessages
    if (maxContextTokens > 0) {
      const contextConfig: ContextManagerConfig = {
        maxContextTokens,
        maxOutputTokens: maxOutputTokens ?? 2048,
        autoCompact: !!autoCompact,
      }

      const systemPromptTokens = this.systemMessage
        ? estimateTokens(this.systemMessage, charsPerToken) + 4
        : 0

      if (autoCompact && this.model) {
        const compactResult = await compactMessages(
          compactVisibleMessages,
          contextConfig,
          this.model,
          systemPromptTokens,
          charsPerToken
        )
        effectiveMessages = compactResult.messages
        if (compactResult.trimmedCount > 0) {
          console.debug(
            `[context-manager] Compacted ${compactResult.trimmedCount} messages` +
              (compactResult.compactedSummary ? ' with summary' : ' (trim fallback)')
          )
        }
      } else {
        const trimResult = trimMessages(
          compactVisibleMessages,
          contextConfig,
          systemPromptTokens,
          charsPerToken
        )
        effectiveMessages = trimResult.messages
        if (trimResult.trimmedCount > 0) {
          console.debug(
            `[context-manager] Trimmed ${trimResult.trimmedCount} oldest messages to fit context budget`
          )
        }
      }
    }

    // Baseline for calibration: characters we are about to send (system prompt
    // + post-trim messages). Compared against the provider's real input-token
    // count at finish to refine this model's chars-per-token estimate.
    const calibrationInputChars =
      (this.systemMessage?.length ?? 0) + totalMessageChars(effectiveMessages)

    const mappedMessages = this.mapUserInlineAttachments(effectiveMessages)
    const hasTools = Object.keys(this.tools).length > 0
    const modelSupportsTools = this.currentModelSupportsTools()
    const shouldEnableTools = hasTools && modelSupportsTools
    const responsesChatEnabled =
      isBiyuanFamilyProvider &&
      modelRequiresResponsesEndpoint(modelId, selectedModel)
    const streamTextToolsEnabled = shouldEnableTools && !responsesChatEnabled
    const webSearchState = useWebSearch.getState()
    const searchMode = webSearchModeFromEnabled(
      webSearchState.enabled,
      webSearchState.mode
    )
    const searchDecision = decideChatSearch({
      mode: searchMode,
      latestUserText: this.lastUserMessage,
    })
    const canUseNativeWebSearch =
      searchDecision.enabled &&
      canUseJingxingNativeWebSearch({
        providerName: providerId,
        baseUrl: effectiveProvider.base_url,
        modelId,
        messages: mappedMessages,
      })
    const effectiveSearchDecision =
      searchDecision.enabled && !canUseNativeWebSearch
        ? blockSearchDecision(
            searchDecision,
            'Native web search is unavailable for this model or message shape.'
          )
        : searchDecision
    const nativeWebSearchEnabled =
      effectiveSearchDecision.enabled && canUseNativeWebSearch
    const systemMessage = getToolAwareSystemMessage(this.systemMessage ?? '', {
      structuredToolsEnabled: streamTextToolsEnabled,
      nativeWebSearchEnabled,
      searchDecision: effectiveSearchDecision,
    })
    const webSearchMetadata = searchDecisionMetadata(effectiveSearchDecision, {
      transport: nativeWebSearchEnabled ? 'jingxing_native' : 'none',
      sourceCount: 0,
    })

    trackMitaEvent('assistant_response_started', {
      provider_id: providerId,
      model_id: modelId,
      model_capabilities: selectedModel?.capabilities ?? [],
      message_count: mappedMessages.length,
      tools_enabled: streamTextToolsEnabled,
      tool_count: Object.keys(this.tools).length,
      ...webSearchMetadata,
      transport: responsesChatEnabled
        ? 'jingxing_responses_chat'
        : 'desktop_custom_chat_transport',
    })

    if (nativeWebSearchEnabled) {
      return streamJingxingNativeWebSearch({
        modelId,
        provider: effectiveProvider,
        messages: mappedMessages,
        system: systemMessage,
        searchDecision: effectiveSearchDecision,
        maxOutputTokens,
        abortSignal: options.abortSignal,
        onTokenUsage: this.onTokenUsage,
      })
    }

    if (responsesChatEnabled) {
      return streamJingxingResponsesChat({
        modelId,
        provider: effectiveProvider,
        messages: mappedMessages,
        system: systemMessage,
        maxOutputTokens,
        abortSignal: options.abortSignal,
        onTokenUsage: this.onTokenUsage,
      })
    }

    const baseMessages = convertToModelMessages(mappedMessages)

    // If continuing a truncated response, append the partial assistant content as a
    // prefill so the model resumes from where it left off rather than regenerating.
    const continueContent = this.continueFromContent
    this.continueFromContent = null
    const modelMessages = continueContent
      ? [...baseMessages, { role: 'assistant' as const, content: continueContent }]
      : baseMessages

    // Prompt caching (Anthropic only): pass the (now byte-stable) system prompt
    // as a cached system message so its tokens are written once and re-read on
    // subsequent turns. A no-op for other providers / local models, which keep
    // the plain `system` string. cacheControl is ignored by openai-compatible.
    const isAnthropic = effectiveProviderName === 'anthropic'
    const cachedSystemMessage: ModelMessage | null =
      isAnthropic && systemMessage
        ? {
            role: 'system',
            content: systemMessage,
            providerOptions: {
              anthropic: { cacheControl: { type: 'ephemeral' } },
            },
          }
        : null
    const streamMessages: ModelMessage[] = cachedSystemMessage
      ? [cachedSystemMessage, ...modelMessages]
      : modelMessages

    // Include tools only if we have tools loaded AND model supports them

    // Track stream timing and token count for token speed calculation
    let streamStartTime: number | undefined

    const result = streamText({
      model: this.model,
      messages: streamMessages,
      abortSignal: options.abortSignal,
      tools: streamTextToolsEnabled ? this.tools : undefined,
      toolChoice: streamTextToolsEnabled ? 'auto' : undefined,
      // Anthropic carries the system prompt as a cached message above; everyone
      // else passes it as the plain system string.
      ...(cachedSystemMessage ? {} : { system: systemMessage }),
      ...(maxOutputTokens !== undefined ? { maxTokens: maxOutputTokens } : {}),
      // Per-step observability. Tool execution lives in the route (not in
      // streamText), so this fires roughly once per request; it gives a
      // step-boundary record of usage / tool calls / finish reason that the
      // loop previously lacked. Cross-round aggregation happens in the route.
      onStepFinish: (step) => {
        trackMitaEvent('assistant_step_completed', {
          provider_id: providerId,
          model_id: modelId,
          finish_reason: step.finishReason,
          tool_calls: step.toolCalls?.length ?? 0,
          input_tokens: step.usage?.inputTokens,
          output_tokens: step.usage?.outputTokens,
        })
      },
    })

    let tokensPerSecond = 0

    const uiStream = result.toUIMessageStream({
      messageMetadata: ({ part }) => {
        // Track stream start time on start
        if (part.type === 'start' && !streamStartTime) {
          streamStartTime = Date.now()
        }

        if (part.type === 'finish-step') {
          tokensPerSecond =
            (part.providerMetadata?.providerMetadata
              ?.tokensPerSecond as number) || 0
        }

        // Add usage and token speed to metadata on finish
        if (part.type === 'finish') {
          const finishPart = part as {
            type: 'finish'
            totalUsage: LanguageModelUsage
            finishReason: string
          }
          const usage = finishPart.totalUsage
          const durationMs = streamStartTime ? Date.now() - streamStartTime : 0
          const durationSec = durationMs / 1000

          // Use provider's outputTokens, or llama.cpp completionTokens, or fall back to text delta count
          const outputTokens = usage?.outputTokens ?? 0
          const inputTokens = usage?.inputTokens

          // Use llama.cpp's tokens per second if available, otherwise calculate from duration
          let tokenSpeed: number
          if (durationSec > 0 && outputTokens > 0) {
            tokenSpeed =
              tokensPerSecond > 0 ? tokensPerSecond : outputTokens / durationSec
          } else {
            tokenSpeed = 0
          }

          trackMitaEvent('assistant_response_completed', {
            provider_id: providerId,
            model_id: modelId,
            finish_reason: finishPart.finishReason,
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            total_tokens:
              usage?.totalTokens ?? (inputTokens ?? 0) + outputTokens,
            duration_ms: durationMs,
            token_speed: Math.round(tokenSpeed * 10) / 10,
          })
          trackMitaEvent('token_usage_recorded', {
            provider_id: providerId,
            model_id: modelId,
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            total_tokens:
              usage?.totalTokens ?? (inputTokens ?? 0) + outputTokens,
            // Cache-read tokens (prompt caching); undefined when not cached.
            cached_input_tokens: usage?.cachedInputTokens,
          })
          // Feed the real input-token count back into the per-model chars-per-token
          // estimate so future trimming/compaction decisions get more accurate.
          if (typeof inputTokens === 'number' && inputTokens > 0) {
            useTokenCalibration
              .getState()
              .recordSample(modelId, calibrationInputChars, inputTokens)
          }
          trackMitaEvent('stream_latency_recorded', {
            provider_id: providerId,
            model_id: modelId,
            duration_ms: durationMs,
          })

          return {
            finishReason: finishPart.finishReason,
            usage: {
              inputTokens: inputTokens,
              outputTokens: outputTokens,
              totalTokens:
                usage?.totalTokens ?? (inputTokens ?? 0) + outputTokens,
            },
            tokenSpeed: {
              tokenSpeed: Math.round(tokenSpeed * 10) / 10, // Round to 1 decimal
              tokenCount: outputTokens,
              durationMs,
            },
          }
        }

        return undefined
      },
      onError: (error) => {
        const quotaError = providerQuotaErrorFromUnknown(error)
        trackMitaEvent('assistant_response_failed', {
          provider_id: providerId,
          model_id: modelId,
          error_kind: quotaError ? 'quota' : 'stream',
          has_tools: streamTextToolsEnabled,
        })
        if (quotaError) {
          trackMitaEvent('quota_error_shown', {
            provider_id: providerId,
            model_id: modelId,
          })
          return encodeProviderQuotaError(quotaError)
        }

        trackMitaEvent('network_error_shown', {
          provider_id: providerId,
          model_id: modelId,
        })
        const errorMessage = error == null
          ? 'Unknown error'
          : typeof error === 'string'
            ? error
            : error instanceof Error
              ? error.message
              : JSON.stringify(error)

        return errorMessage
      },
      onFinish: ({ responseMessage }) => {
        // Call the token usage callback with usage data when stream completes
        if (responseMessage) {
          const metadata = responseMessage.metadata as
            | Record<string, unknown>
            | undefined
          const usage = metadata?.usage as LanguageModelUsage | undefined
          if (usage) {
            this.onTokenUsage?.(usage, responseMessage.id)
          }
        }
      },
    })

    // When continuing a truncated response, inject the partial content as the
    // very first text-delta so the new message immediately shows it and the
    // user sees a seamless continuation rather than an empty box.
    const finalStream = continueContent
      ? prependTextDeltaToUIStream(uiStream, continueContent)
      : uiStream

    return finalStream
  }

  async reconnectToStream(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _options: {
      chatId: string
    } & ChatRequestOptions
  ): Promise<ReadableStream<UIMessageChunk> | null> {
    // This function normally handles reconnecting to a stream on the backend, e.g. /api/chat
    // Since this project has no backend, we can't reconnect to a stream, so this is intentionally no-op.
    return null
  }

  /**
   *  Map user messages to include inline attachments in the message parts
   * @param messages
   * @returns
   */
  mapUserInlineAttachments(messages: UIMessage[]): UIMessage[] {
    return messages.map((message) => {
      if (message.role === 'user') {
        const metadata = message.metadata as
          | {
              inline_file_contents?: Array<{ name?: string; content?: string }>
            }
          | undefined
        const inlineFileContents = Array.isArray(metadata?.inline_file_contents)
          ? metadata.inline_file_contents.filter((f) => f?.content)
          : []
        // Tool messages have content as array of ToolResultPart
        if (inlineFileContents.length > 0) {
          const buildInlineText = (base: string) => {
            if (!inlineFileContents.length) return base
            const formatted = inlineFileContents
              .map((f) => `File: ${f.name || 'attachment'}\n${f.content ?? ''}`)
              .join('\n\n')
            return base ? `${base}\n\n${formatted}` : formatted
          }

          if (message.parts.length > 0) {
            const parts = message.parts.map((part) => {
              if (part.type === 'text') {
                return {
                  type: 'text' as const,
                  text: buildInlineText(part.text ?? ''),
                }
              }
              return part
            })
            message.parts = parts
          }
        }
      }

      return message
    })
  }
}
