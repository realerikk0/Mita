import { providerModels as models } from '@/constants/models'
import { ModelCapabilities } from '@/types/models'

const REASONING_CAPABILITY = 'reasoning'

const uniqueCapabilities = (capabilities: Array<string | undefined>) =>
  capabilities.filter(
    (capability, index, arr): capability is string =>
      Boolean(capability) && arr.indexOf(capability) === index
  )

const includesModelId = (modelIds: string[], modelId: string) => {
  const normalized = modelId.toLowerCase()
  return modelIds.some((id) => id.toLowerCase() === normalized)
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
  ].some((pattern) => pattern.test(normalized))
}

export const isJingxingNativeWebSearchModel = (modelId?: string): boolean => {
  if (!modelId || isJingxingImageGenerationModel(modelId)) return false
  const normalized = modelId.toLowerCase()

  return (
    /^gpt-(?:4o|4\.1|5(?:[-.\w]*))/.test(normalized) ||
    normalized.startsWith('grok-') ||
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
  }
): string[] | undefined => {
  if (model._userConfiguredCapabilities === true) {
    return model.capabilities
  }

  const modelId = model.id || model.model
  if (!modelId) {
    return model.capabilities
  }

  if (providerName === 'jingxing') {
    return inferJingxingModelCapabilities(modelId)
  }

  if (providerName === 'openai') {
    return uniqueCapabilities([
      ...getModelCapabilities(providerName, modelId),
      ...(model.capabilities || []),
    ])
  }

  return model.capabilities
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
  modelId: string
): string[] => {
  if (providerName === 'jingxing') {
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
 * This utility is to extract cortexso model description from README.md file
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
 * Extract model name from repo path, e.g. cortexso/tinyllama -> tinyllama
 * @param modelId
 * @returns
 */
export const extractModelName = (model?: string) => {
  return model?.split('/')[1] ?? model
}

/**
 * Extract model name from repo path, e.g. https://huggingface.co/cortexso/tinyllama -> cortexso/tinyllama
 * @param modelId
 * @returns
 */
export const extractModelRepo = (model?: string) => {
  return model?.replace('https://huggingface.co/', '')
}
