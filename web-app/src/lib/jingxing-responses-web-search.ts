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
import {
  encodeProviderQuotaError,
  parseProviderErrorResponse,
  providerQuotaErrorFromUnknown,
} from '@/lib/provider-quota-error'

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

type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string
      }>
    }
    finishReason?: string
    groundingMetadata?: {
      groundingChunks?: Array<{
        web?: {
          uri?: string
          url?: string
          title?: string
        }
      }>
    }
  }>
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    totalTokenCount?: number
  }
}

type JingxingResponsesWebSearchOptions = {
  modelId: string
  provider: ProviderObject
  messages: UIMessage[]
  system?: string
  maxOutputTokens?: number
  abortSignal?: AbortSignal
  onTokenUsage?: (usage: LanguageModelUsage, messageId: string) => void
}

type JingxingNativeWebSearchRequest = {
  transport: 'responses' | 'gemini-generate-content'
  endpoint: string
  body: Record<string, unknown>
}

type GeminiNativeWebSearchOutput = {
  text: string
  sources: Array<{ url: string; title?: string }>
  usage?: LanguageModelUsage
  finishReason: FinishReason
}

const JSON_HEADERS = {
  'Content-Type': 'application/json',
}

export const JINGXING_WEB_SEARCH_OPTIONS = {
  search_context_size: 'low',
} as const

const JINGXING_GEMINI_NATIVE_WEB_SEARCH_MODELS = new Set([
  'gemini-3.5-flash',
  'gemini-3.1-pro-preview',
  'gemini-3-flash-preview',
])

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

function messagesToGeminiContents(messages: UIMessage[]) {
  return messages
    .filter(
      (message) => message.role === 'user' || message.role === 'assistant'
    )
    .map((message) => {
      const content = (message.parts ?? [])
        .map(textFromPart)
        .filter(Boolean)
        .join('\n')
        .trim()

      return {
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: content }],
      }
    })
    .filter((message) => message.parts[0].text.length > 0)
}

export function isJingxingGeminiNativeWebSearchModel(modelId?: string): boolean {
  return Boolean(
    modelId &&
      JINGXING_GEMINI_NATIVE_WEB_SEARCH_MODELS.has(modelId.toLowerCase())
  )
}

function isJingxingResponsesNativeWebSearchModel(modelId?: string): boolean {
  if (!modelId) return false
  const normalized = modelId.toLowerCase()
  return (
    !isJingxingGeminiNativeWebSearchModel(normalized) &&
    isJingxingNativeWebSearchModel(normalized)
  )
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '')
}

function responsesEndpointFromBaseUrl(baseUrl?: string): string {
  return `${trimTrailingSlashes(baseUrl || 'https://api.jingxing.uk/v1')}/responses`
}

export function geminiGenerateContentEndpointFromBaseUrl(
  baseUrl: string | undefined,
  modelId: string
): string {
  const rawBaseUrl = trimTrailingSlashes(baseUrl || 'https://api.jingxing.uk/v1')

  try {
    const url = new URL(rawBaseUrl)
    const path = trimTrailingSlashes(url.pathname || '')
    url.pathname = path.endsWith('/v1')
      ? `${path.slice(0, -3)}/v1beta`
      : path.endsWith('/v1beta')
        ? path
        : `${path}/v1beta`
    return `${trimTrailingSlashes(url.toString())}/models/${encodeURIComponent(
      modelId
    )}:generateContent`
  } catch {
    const base = rawBaseUrl.endsWith('/v1')
      ? `${rawBaseUrl.slice(0, -3)}/v1beta`
      : rawBaseUrl.endsWith('/v1beta')
        ? rawBaseUrl
        : `${rawBaseUrl}/v1beta`
    return `${base}/models/${encodeURIComponent(modelId)}:generateContent`
  }
}

function protectedResponsesMaxOutputTokens(
  modelId: string,
  maxOutputTokens?: number
): number | undefined {
  if (
    modelId.toLowerCase().startsWith('gpt-5.4-pro') &&
    (!maxOutputTokens || maxOutputTokens < 1024)
  ) {
    return 1024
  }
  return maxOutputTokens
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

function finishReasonFromGemini(reason?: string): FinishReason {
  const normalized = reason?.toUpperCase()
  if (normalized === 'MAX_TOKENS') return 'length'
  if (
    normalized === 'SAFETY' ||
    normalized === 'RECITATION' ||
    normalized === 'BLOCKLIST' ||
    normalized === 'PROHIBITED_CONTENT' ||
    normalized === 'SPII'
  ) {
    return 'content-filter'
  }
  return 'stop'
}

function geminiUsageToLanguageModelUsage(
  usage?: GeminiGenerateContentResponse['usageMetadata']
): LanguageModelUsage | undefined {
  if (!usage) return undefined
  const inputTokens = usage.promptTokenCount ?? 0
  const outputTokens = usage.candidatesTokenCount ?? 0
  return {
    inputTokens,
    outputTokens,
    totalTokens: usage.totalTokenCount ?? inputTokens + outputTokens,
  }
}

export function geminiGenerateContentResponseToOutput(
  value: GeminiGenerateContentResponse
): GeminiNativeWebSearchOutput {
  const candidate = value.candidates?.[0]
  const text =
    candidate?.content?.parts
      ?.map((part) => part.text)
      .filter((text): text is string => Boolean(text))
      .join('') ?? ''
  const sources =
    candidate?.groundingMetadata?.groundingChunks
      ?.flatMap((chunk) => {
        const url = chunk.web?.uri || chunk.web?.url
        if (!url) return []
        const title = chunk.web?.title
        return [title ? { url, title } : { url }]
      }) ?? []

  return {
    text,
    sources,
    usage: geminiUsageToLanguageModelUsage(value.usageMetadata),
    finishReason: finishReasonFromGemini(candidate?.finishReason),
  }
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

async function fetchJingxingNativeWebSearchWithKeyRotation(
  provider: ProviderObject,
  endpoint: string,
  body: Record<string, unknown>,
  abortSignal?: AbortSignal
) {
  const keys = providerRemoteApiKeyChain(provider)
  if (keys.length === 0) {
    throw new Error('Jingxing API key is required for native web search.')
  }

  const runtimeFetch = getRuntimeFetch()

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

    const quotaError = await parseProviderErrorResponse(
      response,
      provider.provider
    )
    if (quotaError) throw quotaError

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

export function buildJingxingNativeWebSearchRequest(options: {
  modelId: string
  baseUrl?: string
  messages: UIMessage[]
  system?: string
  maxOutputTokens?: number
}): JingxingNativeWebSearchRequest {
  if (isJingxingGeminiNativeWebSearchModel(options.modelId)) {
    const body: Record<string, unknown> = {
      contents: messagesToGeminiContents(options.messages),
      web_search_options: JINGXING_WEB_SEARCH_OPTIONS,
    }

    if (options.system) {
      body.systemInstruction = {
        parts: [{ text: options.system }],
      }
    }
    if (options.maxOutputTokens !== undefined) {
      body.generationConfig = {
        maxOutputTokens: options.maxOutputTokens,
      }
    }

    return {
      transport: 'gemini-generate-content',
      endpoint: geminiGenerateContentEndpointFromBaseUrl(
        options.baseUrl,
        options.modelId
      ),
      body,
    }
  }

  if (!isJingxingResponsesNativeWebSearchModel(options.modelId)) {
    throw new Error(
      `Model ${options.modelId} does not support Jingxing native web search.`
    )
  }

  const maxOutputTokens = protectedResponsesMaxOutputTokens(
    options.modelId,
    options.maxOutputTokens
  )

  const body: Record<string, unknown> = {
    model: options.modelId,
    input: messagesToResponsesInput(options.messages),
    stream: true,
    web_search_options: JINGXING_WEB_SEARCH_OPTIONS,
  }

  if (options.system) {
    body.instructions = options.system
  }
  if (maxOutputTokens !== undefined) {
    body.max_output_tokens = maxOutputTokens
  }
  if (options.modelId.toLowerCase().startsWith('gpt-5.4-pro')) {
    body.reasoning = { effort: 'medium' }
  }

  return {
    transport: 'responses',
    endpoint: responsesEndpointFromBaseUrl(options.baseUrl),
    body,
  }
}

export function streamJingxingNativeWebSearch(
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

      const request = buildJingxingNativeWebSearchRequest({
        modelId: options.modelId,
        baseUrl: options.provider.base_url,
        messages: options.messages,
        system: options.system,
        maxOutputTokens: options.maxOutputTokens,
      })

      const response = await fetchJingxingNativeWebSearchWithKeyRotation(
        options.provider,
        request.endpoint,
        request.body,
        options.abortSignal
      )

      if (request.transport === 'gemini-generate-content') {
        const output = geminiGenerateContentResponseToOutput(
          (await response.json()) as GeminiGenerateContentResponse
        )
        usage = output.usage
        finishReason = output.finishReason

        if (output.text) {
          writer.write({ type: 'text-delta', id: textId, delta: output.text })
        }

        output.sources.forEach((source) => {
          if (emittedSources.has(source.url)) return
          emittedSources.add(source.url)
          writer.write({
            type: 'source-url',
            sourceId: `web-${emittedSources.size}`,
            url: source.url,
            title: source.title,
          })
        })
      } else {
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
      }

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
    onError: (error) => {
      const quotaError = providerQuotaErrorFromUnknown(error)
      if (quotaError) return encodeProviderQuotaError(quotaError)
      return error instanceof Error ? error.message : JSON.stringify(error)
    },
  })
}

export const streamJingxingResponsesWebSearch = streamJingxingNativeWebSearch
