/**
 * Model Factory
 *
 * This factory provides a unified interface for creating language models from various providers.
 * It handles the complexity of initializing different AI SDK providers with their specific
 * configurations and returns a standard LanguageModel interface.
 *
 * Supported Providers are remote APIs only:
 * - anthropic: Claude models via Anthropic API (@ai-sdk/anthropic v2.0)
 * - google/gemini: Gemini models via Google Generative AI API (@ai-sdk/google v2.0)
 * - openai: OpenAI models via OpenAI API (@ai-sdk/openai)
 * - OpenAI-compatible: Azure, Groq, Together, Fireworks, DeepSeek, Mistral, Cohere, etc.
 *
 * Usage:
 * ```typescript
 * const model = await ModelFactory.createModel(modelId, provider, parameters)
 * ```
 *
 * The factory automatically:
 * - Handles provider-specific authentication and headers
 * - Configures custom headers for each provider
 * - Returns a unified LanguageModel interface compatible with Vercel AI SDK
 */

/**
 * Inference parameters for customizing model behavior
 */
export interface ModelParameters {
  temperature?: number
  top_k?: number
  top_p?: number
  repeat_penalty?: number
  max_output_tokens?: number
  max_context_tokens?: number
  auto_compact?: boolean
  auto_compact_threshold?: number
  presence_penalty?: number
  frequency_penalty?: number
  stop_sequences?: string[]
}

import {
  extractReasoningMiddleware,
  wrapLanguageModel,
  type LanguageModel,
} from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import {
  createOpenAICompatible,
} from '@ai-sdk/openai-compatible'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createXai } from '@ai-sdk/xai'
import { fetch as httpFetch } from '@tauri-apps/plugin-http'
import { isPlatformTauri } from '@/lib/platform/utils'
import { providerRemoteApiKeyChain } from '@/lib/provider-api-keys'
import { parseProviderErrorResponse } from '@/lib/provider-quota-error'
import {
  isRemoteProviderEndpoint,
  RETIRED_LOCAL_PROVIDER_IDS,
} from '@/lib/configured-model-providers'

/**
 * Keys from inference parameters that are client-side only and must not
 * be forwarded in the HTTP body to remote APIs.
 */
const CLIENT_SIDE_PARAM_KEYS: ReadonlySet<string> = new Set([
  'ctx_len',
  'max_context_tokens',
  'auto_compact',
  'auto_compact_threshold',
])

const REMOTE_UNSUPPORTED_PARAM_KEYS: ReadonlySet<string> = new Set([
  'top_k',
  'repeat_penalty',
  'n_gpu_layers',
  'n_batch',
  'batch_size',
  'ubatch_size',
  'threads',
  'n_threads',
  'n_threads_batch',
  'flash_attn',
  'use_mmap',
  'use_mlock',
  'no_kv_offload',
  'cpu_moe',
  'n_cpu_moe',
  'override_tensor_buffer_t',
  'offload_mmproj',
  'cont_batching',
  'chat_template',
  'cache_type_k',
  'cache_type_v',
])

function isClaudeModel(modelId: string): boolean {
  const lowerModelId = modelId.toLowerCase()
  return (
    lowerModelId.startsWith('claude-') ||
    lowerModelId.startsWith('anthropic.claude-')
  )
}

function isClaudeOpus47OrLaterModel(modelId: string): boolean {
  const lowerModelId = modelId.toLowerCase()
  return /^(?:anthropic\.)?claude-opus-4-(?:[7-9]|\d{2,})(?:$|[-_.])/.test(
    lowerModelId
  )
}

function normalizeInferenceParameters(
  parameters: Record<string, unknown>,
  options: {
    modelId?: string
  } = {}
): Record<string, unknown> {
  const { modelId } = options
  const normalised: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(parameters)) {
    if (CLIENT_SIDE_PARAM_KEYS.has(key)) continue
    if (REMOTE_UNSUPPORTED_PARAM_KEYS.has(key)) continue

    const targetKey = key === 'max_output_tokens' ? 'max_tokens' : key
    normalised[targetKey] = value
  }

  if (modelId && isClaudeModel(modelId)) {
    delete normalised.frequency_penalty
    delete normalised.presence_penalty
    delete normalised.repeat_penalty

    if (isClaudeOpus47OrLaterModel(modelId)) {
      delete normalised.temperature
      delete normalised.top_p
      delete normalised.top_k
    } else if (
      normalised.temperature !== undefined &&
      normalised.top_p !== undefined
    ) {
      delete normalised.top_p
    }
  }

  return normalised
}

/**
 * Create a custom fetch function that injects additional parameters into the
 * request body, normalising key names for OpenAI-compatible APIs:
 * - `max_output_tokens` is remapped to `max_tokens`
 * - client-side-only keys (e.g. `ctx_len`) are stripped
 * - local/remote-incompatible sampling keys are stripped for remote providers
 */
function createCustomFetch(
  baseFetch: typeof globalThis.fetch,
  parameters: Record<string, unknown>,
  modelId?: string
): typeof globalThis.fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (init?.method === 'POST' || !init?.method) {
      const body = init?.body ? JSON.parse(init.body as string) : {}

      const normalised = normalizeInferenceParameters(parameters, { modelId })

      init = { ...init, body: JSON.stringify({ ...body, ...normalised }) }
    }

    return baseFetch(input, init)
  }
}

type ApiKeyHeaderMode = 'authorization-bearer' | 'x-api-key'

/** Retries with the next key when the upstream returns 401, 403, or 429. */
function createApiKeyRotatingFetch(
  baseFetch: typeof globalThis.fetch,
  apiKeys: string[],
  parameters: Record<string, unknown>,
  headerMode: ApiKeyHeaderMode,
  modelId?: string,
  providerName?: string
): typeof globalThis.fetch {
  const inner = createCustomFetch(baseFetch, parameters, modelId)
  if (apiKeys.length <= 1) {
    return inner
  }
  return async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    for (let i = 0; i < apiKeys.length; i++) {
      const key = apiKeys[i]!
      const nextHeaders = new Headers(init?.headers as HeadersInit | undefined)
      if (headerMode === 'authorization-bearer') {
        nextHeaders.set('Authorization', `Bearer ${key}`)
      } else {
        nextHeaders.set('x-api-key', key)
      }
      const res = await inner(input, { ...init, headers: nextHeaders })
      const quotaError = await parseProviderErrorResponse(res, providerName)
      if (quotaError) throw quotaError
      if ([401, 403, 429].includes(res.status) && i < apiKeys.length - 1) {
        res.body?.cancel().catch(() => {})
        continue
      }
      return res
    }
    throw new Error('API key rotation exhausted')
  }
}

function createProviderErrorAwareFetch(
  baseFetch: typeof globalThis.fetch,
  parameters: Record<string, unknown>,
  modelId?: string,
  providerName?: string
): typeof globalThis.fetch {
  const inner = createCustomFetch(baseFetch, parameters, modelId)
  return async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    const res = await inner(input, init)
    const quotaError = await parseProviderErrorResponse(res, providerName)
    if (quotaError) throw quotaError
    return res
  }
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

/**
 * Map of model keywords to their respective reasoning tags.
 * Used for models that use tags other than the default 'think'.
 */
const REASONING_TAG_MAP: Record<string, string> = {
  gemma: 'thought',
}

/**
 * The default tag used for reasoning extraction if no specific override is found.
 */
const DEFAULT_REASONING_TAG = 'think'

/**
 * Determines the reasoning tag name based on the model ID.
 * Defaults to 'think' if no specific override is found in the map.
 */
function getReasoningTagName(modelId: string): string {
  const lowerId = modelId.toLowerCase()
  for (const [keyword, tag] of Object.entries(REASONING_TAG_MAP)) {
    if (lowerId.includes(keyword)) {
      return tag
    }
  }
  return DEFAULT_REASONING_TAG
}

/**
 * Factory for creating language models based on provider type.
 * Supports native AI SDK providers (Anthropic, Google) and OpenAI-compatible providers.
 */
export class ModelFactory {
  /**
   * Create a language model instance based on the provider configuration
   */
  static async createModel(
    modelId: string,
    provider: ProviderObject,
    parameters: Record<string, unknown> = {}
  ): Promise<LanguageModel> {
    const providerName = provider.provider.toLowerCase()

    if (
      RETIRED_LOCAL_PROVIDER_IDS.has(providerName) ||
      !isRemoteProviderEndpoint(provider)
    ) {
      throw Object.assign(
        new Error(
          'Local model runtimes have been retired. Select a configured remote provider to continue.'
        ),
        { code: 'LOCAL_RUNTIME_REMOVED' }
      )
    }

    switch (providerName) {
      case 'anthropic':
        return this.createAnthropicModel(modelId, provider, parameters)

      case 'openai':
        return this.createOpenAIModel(modelId, provider, parameters)
      case 'google':
      case 'gemini':
        return this.createGoogleModel(modelId, provider, parameters)
      case 'azure':
      case 'groq':
      case 'together':
      case 'fireworks':
      case 'deepseek':
      case 'mistral':
      case 'cohere':
      case 'perplexity':
      case 'moonshot':
      case 'minimax':
        return this.createOpenAICompatibleModel(modelId, provider, parameters)

      case 'xai':
        return this.createXaiModel(modelId, provider, parameters)

      default:
        return this.createOpenAICompatibleModel(modelId, provider, parameters)
    }
  }

  /**
   * Create an Anthropic model using the official AI SDK
   */
  private static createAnthropicModel(
    modelId: string,
    provider: ProviderObject,
    parameters: Record<string, unknown> = {}
  ): LanguageModel {
    const headers: Record<string, string> = {}

    // Add custom headers if specified (e.g., anthropic-version)
    if (provider.custom_header) {
      provider.custom_header.forEach((customHeader) => {
        headers[customHeader.header] = customHeader.value
      })
    }

    const keyChain = providerRemoteApiKeyChain(provider)
    const fetchImpl =
      keyChain.length > 1
        ? createApiKeyRotatingFetch(
            getRuntimeFetch(),
            keyChain,
            parameters,
            'x-api-key',
            modelId,
            provider.provider
          )
        : createProviderErrorAwareFetch(
            getRuntimeFetch(),
            parameters,
            modelId,
            provider.provider
          )

    const anthropic = createAnthropic({
      apiKey: keyChain[0] ?? provider.api_key ?? '',
      baseURL: provider.base_url,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      fetch: fetchImpl,
    })

    return anthropic(modelId)
  }

  /**
   * Create a Google/Gemini model using the official AI SDK
   */
  private static createGoogleModel(
    modelId: string,
    provider: ProviderObject,
    parameters: Record<string, unknown> = {}
  ): LanguageModel {
    const headers: Record<string, string> = {}

    // Add custom headers if specified
    if (provider.custom_header) {
      provider.custom_header.forEach((customHeader) => {
        headers[customHeader.header] = customHeader.value
      })
    }

    const keyChain = providerRemoteApiKeyChain(provider)
    const fetchImpl =
      keyChain.length > 1
        ? createApiKeyRotatingFetch(
            getRuntimeFetch(),
            keyChain,
            parameters,
            'x-api-key',
            modelId,
            provider.provider
          )
        : createProviderErrorAwareFetch(
            getRuntimeFetch(),
            parameters,
            modelId,
            provider.provider
          )

    const google = createGoogleGenerativeAI({
      apiKey: keyChain[0] ?? provider.api_key ?? '',
      baseURL: provider.base_url,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      fetch: fetchImpl,
    })

    return google(modelId)
  }

  /**
   * Create an OpenAI model using the official AI SDK
   */
  private static createOpenAIModel(
    modelId: string,
    provider: ProviderObject,
    parameters: Record<string, unknown> = {}
  ): LanguageModel {
    const headers: Record<string, string> = {}

    // Add custom headers if specified
    if (provider.custom_header) {
      provider.custom_header.forEach((customHeader) => {
        headers[customHeader.header] = customHeader.value
      })
    }

    const keyChain = providerRemoteApiKeyChain(provider)
    const fetchImpl =
      keyChain.length > 1
        ? createApiKeyRotatingFetch(
            getRuntimeFetch(),
            keyChain,
            parameters,
            'authorization-bearer',
            modelId,
            provider.provider
          )
        : createProviderErrorAwareFetch(
            getRuntimeFetch(),
            parameters,
            modelId,
            provider.provider
          )

    const openai = createOpenAI({
      apiKey: keyChain[0] ?? provider.api_key ?? '',
      baseURL: provider.base_url,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      fetch: fetchImpl,
    })

    return openai(modelId)
  }

  /**
   * Create an XAI (Grok) model using the official AI SDK
   */
  private static createXaiModel(
    modelId: string,
    provider: ProviderObject,
    parameters: Record<string, unknown> = {}
  ): LanguageModel {
    const headers: Record<string, string> = {}

    // Add custom headers if specified
    if (provider.custom_header) {
      provider.custom_header.forEach((customHeader) => {
        headers[customHeader.header] = customHeader.value
      })
    }

    const keyChain = providerRemoteApiKeyChain(provider)
    const fetchImpl =
      keyChain.length > 1
        ? createApiKeyRotatingFetch(
            getRuntimeFetch(),
            keyChain,
            parameters,
            'authorization-bearer',
            modelId,
            provider.provider
          )
        : createProviderErrorAwareFetch(
            getRuntimeFetch(),
            parameters,
            modelId,
            provider.provider
          )

    const xai = createXai({
      apiKey: keyChain[0] ?? provider.api_key ?? '',
      baseURL: provider.base_url,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      fetch: fetchImpl,
    })

    return xai(modelId)
  }

  /**
   * Create an OpenAI-compatible model for providers that support the OpenAI API format
   */
  private static createOpenAICompatibleModel(
    modelId: string,
    provider: ProviderObject,
    parameters: Record<string, unknown> = {}
  ): LanguageModel {
    const headers: Record<string, string> = {}

    // Add custom headers if specified
    if (provider.custom_header) {
      provider.custom_header.forEach((customHeader) => {
        headers[customHeader.header] = customHeader.value
      })
    }

    const keyChain = providerRemoteApiKeyChain(provider)
    if (keyChain.length === 1) {
      headers['Authorization'] = `Bearer ${keyChain[0]}`
    }

    const fetchImpl =
      keyChain.length > 1
        ? createApiKeyRotatingFetch(
            getRuntimeFetch(),
            keyChain,
            parameters,
            'authorization-bearer',
            modelId,
            provider.provider
          )
        : createProviderErrorAwareFetch(
            getRuntimeFetch(),
            parameters,
            modelId,
            provider.provider
          )

    const openAICompatible = createOpenAICompatible({
      name: provider.provider,
      baseURL: provider.base_url || 'https://api.openai.com/v1',
      headers,
      includeUsage: true,
      fetch: fetchImpl,
    })

    const model = openAICompatible.languageModel(modelId)

    return wrapLanguageModel({
      model,
      middleware: extractReasoningMiddleware({
        tagName: getReasoningTagName(modelId),
        separator: '\n',
      }),
    })
  }
}
