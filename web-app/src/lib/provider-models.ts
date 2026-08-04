import { isChatModelSelectable } from '@/lib/chat-models'
import {
  getModelCapabilities,
  normalizeModelCapabilitiesForProvider,
} from '@/lib/models'
import { ModelCapabilities } from '@/types/models'

type ProviderModelMetadata = Partial<Model> & {
  id?: string
  model?: string
  supported_endpoint_types?: string[]
  supportedEndpointTypes?: string[]
  endpoint_types?: string[]
  endpoints?: string[]
  _userConfiguredCapabilities?: boolean
}

export type ProviderModelDescriptor = string | ProviderModelMetadata

const JINGXING_GEMINI_NATIVE_WEB_SEARCH_MODELS = new Set([
  'gemini-3.5-flash',
  'gemini-3.1-pro-preview',
  'gemini-3-flash-preview',
])

const RESPONSE_ONLY_MODEL_PATTERNS = [
  /^gpt-5\.4-pro(?:$|[-_.])/,
  /^gpt-5\.3-codex(?:$|[-_.])/,
]

const AUDIO_TRANSCRIPTION_ENDPOINTS = new Set([
  'audio-transcription',
  'transcription',
  'speech-to-text',
  'stt',
])

const CHAT_COMPLETIONS_ENDPOINTS = new Set([
  'openai',
  'openai-chat',
  'chat-completions',
  'chat_completions',
])

const RESPONSES_ENDPOINTS = new Set([
  'openai-response',
  'openai-responses',
  'responses',
])

const NON_CHAT_MODEL_CAPABILITIES = new Set<string>([
  ModelCapabilities.IMAGE_GENERATION,
  ModelCapabilities.VIDEO_GENERATION,
  ModelCapabilities.AUDIO_GENERATION,
  ModelCapabilities.TEXT_TO_IMAGE,
  ModelCapabilities.IMAGE_TO_IMAGE,
  ModelCapabilities.TEXT_TO_AUDIO,
  ModelCapabilities.AUDIO_TO_TEXT,
])

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

export function modelIdFromDescriptor(
  descriptor: ProviderModelDescriptor
): string {
  if (typeof descriptor === 'string') return descriptor.trim()
  return (descriptor.id || descriptor.model || '').trim()
}

export function providerModelDescriptorHasMetadata(
  descriptor: ProviderModelDescriptor
): boolean {
  if (typeof descriptor === 'string') return false
  return Object.entries(descriptor).some(
    ([key, value]) =>
      key !== 'id' &&
      key !== 'model' &&
      value !== undefined &&
      value !== null
  )
}

export function supportedEndpointTypesFromModel(
  model?: Partial<Model> | null
): string[] {
  if (!model) return []
  const raw =
    model.supported_endpoint_types ||
    model.supportedEndpointTypes ||
    ((model as { endpoint_types?: string[] }).endpoint_types) ||
    ((model as { endpoints?: string[] }).endpoints) ||
    []
  if (!Array.isArray(raw)) return []
  return uniqueStrings(raw.map((value) => String(value).toLowerCase()))
}

export function isTranscriptionModel(model: Partial<Model>): boolean {
  const endpointTypes = supportedEndpointTypesFromModel(model)
  if (endpointTypes.some((type) => AUDIO_TRANSCRIPTION_ENDPOINTS.has(type))) {
    return true
  }

  const normalized = model.id?.trim().toLowerCase()
  if (!normalized) return false

  return (
    normalized === 'whisper-1' ||
    normalized.endsWith('-transcribe') ||
    normalized.includes('transcribe')
  )
}

export function isModelChatSelectable(model: Partial<Model>): boolean {
  if (!model.id || model.embedding || !isChatModelSelectable(model.id)) {
    return false
  }
  if (isTranscriptionModel(model)) return false
  if (
    model.capabilities?.some((capability) =>
      NON_CHAT_MODEL_CAPABILITIES.has(capability)
    )
  ) {
    return false
  }

  const endpointTypes = supportedEndpointTypesFromModel(model)
  if (endpointTypes.length === 0) return true

  const supportsChatCompletions = endpointTypes.some((type) =>
    CHAT_COMPLETIONS_ENDPOINTS.has(type)
  )
  const supportsResponses = endpointTypes.some((type) =>
    RESPONSES_ENDPOINTS.has(type)
  )
  const supportsGeminiNative =
    endpointTypes.includes('gemini') &&
    JINGXING_GEMINI_NATIVE_WEB_SEARCH_MODELS.has(model.id.toLowerCase())

  return supportsChatCompletions || supportsResponses || supportsGeminiNative
}

export function modelRequiresResponsesEndpoint(
  modelId?: string,
  model?: Partial<Model> | null
): boolean {
  const normalized = (modelId || model?.id || '').trim().toLowerCase()
  if (RESPONSE_ONLY_MODEL_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true
  }

  const endpointTypes = supportedEndpointTypesFromModel(model)
  if (endpointTypes.length === 0) return false

  const supportsResponses = endpointTypes.some((type) =>
    RESPONSES_ENDPOINTS.has(type)
  )
  const supportsChatCompletions = endpointTypes.some((type) =>
    CHAT_COMPLETIONS_ENDPOINTS.has(type)
  )

  return supportsResponses && !supportsChatCompletions
}

export function modelDescriptorToModel(
  providerName: string,
  descriptor: ProviderModelDescriptor,
  baseUrl?: string
): Model | null {
  const id = modelIdFromDescriptor(descriptor)
  if (!id) return null

  const raw: ProviderModelMetadata =
    typeof descriptor === 'string' ? { id } : { ...descriptor, id }
  const supportedEndpointTypes = supportedEndpointTypesFromModel(raw)
  const capabilities =
    normalizeModelCapabilitiesForProvider(
      providerName,
      {
        id,
        model: raw.model,
        capabilities: raw.capabilities,
        _userConfiguredCapabilities: raw._userConfiguredCapabilities === true,
        supported_endpoint_types: supportedEndpointTypes,
      },
      baseUrl
    ) ?? getModelCapabilities(providerName, id, baseUrl)

  return {
    ...raw,
    id,
    model: raw.model || id,
    name: raw.name || id,
    displayName: raw.displayName || raw.name || id,
    provider: providerName,
    capabilities,
    version: raw.version ?? '1.0',
    ...(supportedEndpointTypes.length > 0
      ? {
          supported_endpoint_types: supportedEndpointTypes,
          supportedEndpointTypes,
        }
      : {}),
  } as Model
}

export function modelDescriptorsToModels(
  providerName: string,
  descriptors: ProviderModelDescriptor[],
  baseUrl?: string
): Model[] {
  const seen = new Set<string>()
  const models: Model[] = []

  for (const descriptor of descriptors) {
    const model = modelDescriptorToModel(providerName, descriptor, baseUrl)
    if (!model || seen.has(model.id)) continue
    seen.add(model.id)
    models.push(model)
  }

  return models
}
