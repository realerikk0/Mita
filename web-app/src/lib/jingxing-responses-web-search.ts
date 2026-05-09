import {
  createUIMessageStream,
  generateId,
  type FinishReason,
  type LanguageModelUsage,
  type UIMessage,
  type UIMessageChunk,
} from 'ai'
import { fetch as httpFetch } from '@tauri-apps/plugin-http'
import { isPlatformTauri } from '@/lib/platform/utils'
import { providerRemoteApiKeyChain } from '@/lib/provider-api-keys'
import { isJingxingNativeWebSearchModel } from '@/lib/models'

type ResponseStreamEvent = {
  type?: string
  delta?: string
  item?: {
    id?: string
    type?: string
  }
  output_index?: number
  content_index?: number
  annotation?: {
    type?: string
    url?: string
    title?: string
  }
  response?: {
    status?: string
    usage?: {
      input_tokens?: number
      output_tokens?: number
      total_tokens?: number
    }
  }
  error?: {
    message?: string
  }
}
type ResponsesUsage = NonNullable<ResponseStreamEvent['response']>['usage']

type JingxingResponsesWebSearchOptions = {
  modelId: string
  provider: ProviderObject
  messages: UIMessage[]
  system?: string
  maxOutputTokens?: number
  abortSignal?: AbortSignal
  onTokenUsage?: (usage: LanguageModelUsage, messageId: string) => void
}

const JSON_HEADERS = {
  'Content-Type': 'application/json',
}

function getRuntimeFetch(): typeof globalThis.fetch {
  const maybeWindow = globalThis as typeof globalThis & {
    __TAURI__?: unknown
    __TAURI_INTERNALS__?: unknown
  }
  const hasTauriRuntime =
    typeof maybeWindow.__TAURI__ !== 'undefined' ||
    typeof maybeWindow.__TAURI_INTERNALS__ !== 'undefined'

  return isPlatformTauri() && hasTauriRuntime
    ? (httpFetch as typeof globalThis.fetch)
    : globalThis.fetch
}

function textFromPart(part: unknown): string {
  if (!part || typeof part !== 'object') return ''
  const typed = part as Record<string, unknown>
  if (typed.type === 'text' && typeof typed.text === 'string') {
    return typed.text
  }
  return ''
}

function hasUnsupportedParts(message: UIMessage): boolean {
  const parts = Array.isArray(message.parts) ? message.parts : []
  return parts.some((part) => {
    if (!part || typeof part !== 'object') return false
    const type = (part as { type?: string }).type

    if (type === 'text' || type === 'reasoning') return false

    // Native Responses web search emits source parts on assistant messages.
    // They are display metadata, not model input, so they should not force the
    // next turn to fall back to /chat/completions.
    if (
      message.role === 'assistant' &&
      (type === 'source-url' || type === 'source-document')
    ) {
      return false
    }

    return true
  })
}

function messagesToResponsesInput(messages: UIMessage[]) {
  return messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => {
      const content = (message.parts ?? [])
        .map(textFromPart)
        .filter(Boolean)
        .join('\n')
        .trim()

      return {
        role: message.role as 'user' | 'assistant',
        content,
      }
    })
    .filter((message) => message.content.length > 0)
}

function webSearchToolForModel(modelId: string): Record<string, unknown> {
  const normalized = modelId.toLowerCase()
  if (normalized.startsWith('grok-')) {
    return { type: 'web_search' }
  }
  return {
    type: 'web_search',
    search_context_size: 'low',
  }
}

function responseUsageToLanguageModelUsage(
  usage?: ResponsesUsage
): LanguageModelUsage {
  const inputTokens = usage?.input_tokens ?? 0
  const outputTokens = usage?.output_tokens ?? 0
  return {
    inputTokens,
    outputTokens,
    totalTokens: usage?.total_tokens ?? inputTokens + outputTokens,
  }
}

function finishReasonFromStatus(status?: string): FinishReason {
  return status === 'incomplete' ? 'length' : 'stop'
}

async function readResponsesSse(
  response: Response,
  onEvent: (event: ResponseStreamEvent) => void
) {
  if (!response.body) {
    const body = await response.text()
    if (body) {
      onEvent(JSON.parse(body) as ResponseStreamEvent)
    }
    return
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''

    for (const frame of frames) {
      const dataLines = frame
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())

      if (!dataLines.length) continue
      const data = dataLines.join('\n')
      if (!data || data === '[DONE]') continue
      onEvent(JSON.parse(data) as ResponseStreamEvent)
    }
  }
}

async function fetchResponsesWithKeyRotation(
  provider: ProviderObject,
  body: Record<string, unknown>,
  abortSignal?: AbortSignal
) {
  const keys = providerRemoteApiKeyChain(provider)
  if (keys.length === 0) {
    throw new Error('Jingxing API key is required for native web search.')
  }

  const runtimeFetch = getRuntimeFetch()
  const endpoint = `${provider.base_url || 'https://api.jingxing.uk/v1'}/responses`

  for (let i = 0; i < keys.length; i++) {
    const response = await runtimeFetch(endpoint, {
      method: 'POST',
      headers: {
        ...JSON_HEADERS,
        Authorization: `Bearer ${keys[i]}`,
      },
      body: JSON.stringify(body),
      signal: abortSignal,
    })

    if ([401, 403, 429].includes(response.status) && i < keys.length - 1) {
      response.body?.cancel().catch(() => {})
      continue
    }

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(errorText || `Jingxing web search failed with ${response.status}`)
    }

    return response
  }

  throw new Error('Jingxing API key rotation exhausted.')
}

export function canUseJingxingNativeWebSearch(options: {
  providerName?: string
  modelId?: string
  messages: UIMessage[]
}) {
  return (
    options.providerName === 'jingxing' &&
    isJingxingNativeWebSearchModel(options.modelId) &&
    !options.messages.some(hasUnsupportedParts)
  )
}

export function streamJingxingResponsesWebSearch(
  options: JingxingResponsesWebSearchOptions
): ReadableStream<UIMessageChunk> {
  const responseMessageId = generateId()
  const textId = generateId()
  const emittedSources = new Set<string>()

  return createUIMessageStream<UIMessage>({
    execute: async ({ writer }) => {
      writer.write({ type: 'start', messageId: responseMessageId })
      writer.write({ type: 'text-start', id: textId })

      let usage: LanguageModelUsage | undefined
      let finishReason: FinishReason = 'stop'

      const maxOutputTokens =
        options.modelId.toLowerCase().startsWith('gpt-5.4-pro') &&
        (!options.maxOutputTokens || options.maxOutputTokens < 1024)
          ? 1024
          : options.maxOutputTokens

      const body: Record<string, unknown> = {
        model: options.modelId,
        input: messagesToResponsesInput(options.messages),
        tools: [webSearchToolForModel(options.modelId)],
        stream: true,
      }

      if (options.system) {
        body.instructions = options.system
      }
      if (maxOutputTokens !== undefined) {
        body.max_output_tokens = maxOutputTokens
      }
      if (options.modelId.toLowerCase().startsWith('gpt-')) {
        body.tool_choice = 'required'
      }
      if (options.modelId.toLowerCase().startsWith('gpt-5.4-pro')) {
        body.reasoning = { effort: 'medium' }
      }

      const response = await fetchResponsesWithKeyRotation(
        options.provider,
        body,
        options.abortSignal
      )

      await readResponsesSse(response, (event) => {
        if (event.type === 'response.output_text.delta' && event.delta) {
          writer.write({ type: 'text-delta', id: textId, delta: event.delta })
          return
        }

        if (event.type === 'response.output_text.annotation.added') {
          const url = event.annotation?.url
          if (url && !emittedSources.has(url)) {
            emittedSources.add(url)
            writer.write({
              type: 'source-url',
              sourceId: `web-${emittedSources.size}`,
              url,
              title: event.annotation?.title,
            })
          }
          return
        }

        if (event.type === 'response.completed') {
          usage = responseUsageToLanguageModelUsage(event.response?.usage)
          finishReason = finishReasonFromStatus(event.response?.status)
        }

        if (event.type === 'error') {
          throw new Error(event.error?.message || 'Jingxing web search failed.')
        }
      })

      writer.write({ type: 'text-end', id: textId })
      writer.write({
        type: 'finish',
        finishReason,
        messageMetadata: usage
          ? {
              usage,
              tokenSpeed: {
                tokenSpeed: 0,
                tokenCount: usage.outputTokens,
                durationMs: 0,
              },
            }
          : undefined,
      })

      if (usage) {
        options.onTokenUsage?.(usage, responseMessageId)
      }
    },
    onError: (error) =>
      error instanceof Error ? error.message : JSON.stringify(error),
  })
}
