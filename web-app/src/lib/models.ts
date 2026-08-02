import { providerModels as models } from '@/constants/models'
import { isBiyuanProvider } from '@/constants/biyuan'
import { ModelCapabilities } from '@/types/models'

const REASONING_CAPABILITY = 'reasoning'

const IMAGE_GENERATION_ENDPOINTS = new Set([
  'image-generation',
  'image-generations',
  'images-generation',
  'images-generations',
  'images/generations',
  'text-to-image',
])

const IMAGE_EDIT_ENDPOINTS = new Set([
  'image-edit',
  'image-edits',
  'image-editing',
  'images-edit',
  'images-edits',
  'images/edits',
  'image-to-image',
])

const VIDEO_GENERATION_ENDPOINTS = new Set([
  'video-generation',
  'video-generations',
  'videos-generation',
  'videos-generations',
  'videos/generations',
  'text-to-video',
  'image-to-video',
])

const AUDIO_GENERATION_ENDPOINTS = new Set([
  'audio-generation',
  'audio-generations',
  'text-to-audio',
  'text-to-speech',
  'tts',
])

const AUDIO_TRANSCRIPTION_ENDPOINTS = new Set([
  'audio-transcription',
  'transcription',
  'speech-to-text',
  'stt',
])

const uniqueCapabilities = (capabilities: Array<string | undefined>) =>
  capabilities.filter(
    (capability, index, arr): capability is string =>
      Boolean(capability) && arr.indexOf(capability) === index
  )

const includesModelId = (modelIds: string[], modelId: string) => {
  const normalized = modelId.toLowerCase()
  return modelIds.some((id) => id.toLowerCase() === normalized)
}

const normalizeEndpointType = (endpointType: string) =>
  endpointType
    .trim()
    .toLowerCase()
    .replace(/^\/?v1\//, '')
    .replaceAll('_', '-')

export const inferModelCapabilitiesFromEndpointTypes = (
  endpointTypes?: readonly string[] | null
): string[] => {
  if (!Array.isArray(endpointTypes)) return []

  const normalizedEndpointTypes = endpointTypes.map(normalizeEndpointType)
  const supportsImageGeneration = normalizedEndpointTypes.some((endpointType) =>
    IMAGE_GENERATION_ENDPOINTS.has(endpointType)
  )
  const supportsImageEditing = normalizedEndpointTypes.some((endpointType) =>
    IMAGE_EDIT_ENDPOINTS.has(endpointType)
  )
  const supportsVideoGeneration = normalizedEndpointTypes.some((endpointType) =>
    VIDEO_GENERATION_ENDPOINTS.has(endpointType)
  )
  const supportsAudioGeneration = normalizedEndpointTypes.some((endpointType) =>
    AUDIO_GENERATION_ENDPOINTS.has(endpointType)
  )
  const supportsAudioTranscription = normalizedEndpointTypes.some(
    (endpointType) => AUDIO_TRANSCRIPTION_ENDPOINTS.has(endpointType)
  )

  return uniqueCapabilities([
    supportsImageGeneration ? ModelCapabilities.IMAGE_GENERATION : undefined,
    supportsImageGeneration ? ModelCapabilities.TEXT_TO_IMAGE : undefined,
    supportsImageEditing ? ModelCapabilities.IMAGE_TO_IMAGE : undefined,
    supportsVideoGeneration ? ModelCapabilities.VIDEO_GENERATION : undefined,
    supportsAudioGeneration ? ModelCapabilities.AUDIO_GENERATION : undefined,
    supportsAudioGeneration ? ModelCapabilities.TEXT_TO_AUDIO : undefined,
    supportsAudioTranscription ? ModelCapabilities.AUDIO_TO_TEXT : undefined,
  ])
}

const isInferredOpenAIChatModel = (modelId: string): boolean => {
  const normalized = modelId.toLowerCase()
  return /^gpt-(?:4o|4\.1|4\.5|5)(?:[-.\w]*)?$/.test(normalized)
}

export const isJingxingImageGenerationModel = (modelId?: string): boolean => {
  if (!modelId) return false
  const normalized = modelId.toLowerCase()

  return [
    /^gpt-image(?:-|$)/,
    /^mai-image(?:-|$)/,
    /^gemini-\d+(?:\.\d+)?-(?:flash|pro)-image(?:-preview)?$/,
    /(?:^|[-_.])seedream(?:[-_.]|$)/,
  ].some((pattern) => pattern.test(normalized))
}

export const isJingxingVideoGenerationModel = (modelId?: string): boolean => {
  if (!modelId) return false
  const normalized = modelId.toLowerCase()

  return [
    /(?:^|[-_.])seedance(?:[-_.]|$)/,
    /(?:^|[-_.])seedane(?:[-_.]|$)/,
    /(?:^|[-_.])sora(?:[-_.]|$)/,
    /(?:^|[-_.])veo(?:[-_.]|$)/,
  ].some((pattern) => pattern.test(normalized))
}

export const isJingxingAudioTranscriptionModel = (
  modelId?: string
): boolean => {
  if (!modelId) return false
  const normalized = modelId.toLowerCase()

  return [
    /(?:^|[-_.])asr(?:[-_.]|$)/,
    /(?:^|[-_.])transcribe(?:[-_.]|$)/,
    /(?:^|[-_.])transcription(?:[-_.]|$)/,
    /^whisper(?:-|$)/,
  ].some((pattern) => pattern.test(normalized))
}

export const isJingxingNativeWebSearchModel = (modelId?: string): boolean => {
  if (
    !modelId ||
    isJingxingImageGenerationModel(modelId) ||
    isJingxingVideoGenerationModel(modelId) ||
    isJingxingAudioTranscriptionModel(modelId)
  ) {
    return false
  }
  const normalized = modelId.toLowerCase()

  return (
    /^gpt-(?:4o|4\.1|5(?:[-.\w]*))/.test(normalized) ||
    normalized.startsWith('grok-') ||
    normalized.startsWith('claude-') ||
    normalized.startsWith('anthropic.claude-') ||
    [
      'gemini-3.5-flash',
      'gemini-3.1-pro-preview',
      'gemini-3-flash-preview',
    ].includes(normalized)
  )
}

export const inferJingxingModelCapabilities = (modelId: string): string[] => {
  const normalized = modelId.toLowerCase()

  if (isJingxingImageGenerationModel(normalized)) {
    return uniqueCapabilities([
      ModelCapabilities.IMAGE_GENERATION,
      ModelCapabilities.TEXT_TO_IMAGE,
      ModelCapabilities.IMAGE_TO_IMAGE,
    ])
  }

  if (isJingxingVideoGenerationModel(normalized)) {
    return [ModelCapabilities.VIDEO_GENERATION]
  }

  if (isJingxingAudioTranscriptionModel(normalized)) {
    return [ModelCapabilities.AUDIO_TO_TEXT]
  }

  const capabilities: string[] = [ModelCapabilities.COMPLETION]
  const isClaude = normalized.startsWith('claude-')
  const isGemini = normalized.startsWith('gemini-')
  const isGpt = /^gpt-(?:4o|4\.1|5(?:[-.\w]*))/.test(normalized)
  const isCodex = normalized.includes('codex')
  const isGrok = normalized.startsWith('grok-')

  if (isClaude || isGemini || isGpt || isGrok) {
    capabilities.push(ModelCapabilities.TOOLS)
  }

  if (isClaude || isGemini || (isGpt && !isCodex)) {
    capabilities.push(ModelCapabilities.VISION)
  }

  const isExplicitNonReasoning = normalized.includes('non-reasoning')
  if (
    !isExplicitNonReasoning &&
    (normalized.includes('reasoning') ||
      normalized.includes('multi-agent') ||
      isCodex)
  ) {
    capabilities.push(REASONING_CAPABILITY)
  }

  if (isJingxingNativeWebSearchModel(normalized)) {
    capabilities.push(ModelCapabilities.WEB_SEARCH)
  }

  return uniqueCapabilities(capabilities)
}

export const normalizeModelCapabilitiesForProvider = (
  providerName: string,
  model: {
    id?: string
    model?: string
    capabilities?: string[]
    _userConfiguredCapabilities?: boolean
    supported_endpoint_types?: string[]
    supportedEndpointTypes?: string[]
    endpoint_types?: string[]
    endpoints?: string[]
  },
  baseUrl?: string
): string[] | undefined => {
  if (model._userConfiguredCapabilities === true) {
    return model.capabilities
  }

  const modelId = model.id || model.model
  if (!modelId) {
    return model.capabilities
  }

  const endpointCapabilities = inferModelCapabilitiesFromEndpointTypes(
    model.supported_endpoint_types ||
      model.supportedEndpointTypes ||
      model.endpoint_types ||
      model.endpoints
  )
  let capabilities = model.capabilities

  if (isBiyuanProvider(providerName, baseUrl)) {
    capabilities = inferJingxingModelCapabilities(modelId)
  } else if (providerName === 'openai') {
    capabilities = uniqueCapabilities([
      ...getModelCapabilities(providerName, modelId),
      ...(model.capabilities || []),
    ])
  }

  return endpointCapabilities.length > 0
    ? uniqueCapabilities([...(capabilities || []), ...endpointCapabilities])
    : capabilities
}

export const defaultModel = (provider?: string) => {
  if (!provider || !Object.keys(models).includes(provider)) {
    return models.openai.models[0]
  }
  const providerModels =
    models[provider as unknown as keyof typeof models].models
  return Array.isArray(providerModels)
    ? (providerModels as unknown as string[])[0]
    : models.openai.models[0]
}

/**
 * Determines model capabilities based on provider configuration from token.js
 * @param providerName - The provider name (e.g., 'openai', 'anthropic', 'openrouter')
 * @param modelId - The model ID to check capabilities for
 * @returns Array of model capabilities
 */
export const getModelCapabilities = (
  providerName: string,
  modelId: string,
  baseUrl?: string
): string[] => {
  if (isBiyuanProvider(providerName, baseUrl)) {
    return inferJingxingModelCapabilities(modelId)
  }

  const providerConfig = models[providerName as unknown as keyof typeof models]

  const supportsToolCalls = Array.isArray(
    providerConfig?.supportsToolCalls as unknown
  )
    ? (providerConfig.supportsToolCalls as unknown as string[])
    : []

  const supportsImages = Array.isArray(
    providerConfig?.supportsImages as unknown
  )
    ? (providerConfig.supportsImages as unknown as string[])
    : []

  const inferredOpenAIChatModel =
    providerName === 'openai' && isInferredOpenAIChatModel(modelId)

  return [
    ModelCapabilities.COMPLETION,
    includesModelId(supportsToolCalls, modelId) || inferredOpenAIChatModel
      ? ModelCapabilities.TOOLS
      : undefined,
    includesModelId(supportsImages, modelId) || inferredOpenAIChatModel
      ? ModelCapabilities.VISION
      : undefined,
  ].filter(Boolean) as string[]
}

/**
 * Extract a model description from README.md content.
 * @returns
 */
export const extractDescription = (text?: string) => {
  if (!text) return text
  const normalizedText = removeYamlFrontMatter(text)
  const overviewPattern = /(?:##\s*Overview\s*\n)([\s\S]*?)(?=\n\s*##|$)/
  const matches = normalizedText?.match(overviewPattern)
  let extractedText =
    matches && matches[1]
      ? matches[1].trim()
      : normalizedText?.slice(0, 500).trim()

  // Remove image markdown syntax ![alt text](image-url)
  extractedText = extractedText?.replace(/!\[.*?\]\(.*?\)/g, '')

  // Remove <img> HTML tags
  extractedText = extractedText?.replace(/<img[^>]*>/g, '')

  return extractedText
}
/**
 * Remove YAML (HF metadata) front matter from content
 * @param content
 * @returns
 */
export const removeYamlFrontMatter = (content: string): string => {
  return content.replace(/^---\n([\s\S]*?)\n---\n/, '')
}

/**
 * Extract model name from repo path, e.g. example-org/tinyllama -> tinyllama
 * @param modelId
 * @returns
 */
export const extractModelName = (model?: string) => {
  return model?.split('/')[1] ?? model
}

/**
 * Extract a repository path from a Hugging Face URL.
 * @param modelId
 * @returns
 */
export const extractModelRepo = (model?: string) => {
  return model?.replace('https://huggingface.co/', '')
}
