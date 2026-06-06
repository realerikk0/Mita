import { ModelCapabilities } from '@/types/models'

export const IMAGE_RATIOS = [
  '21:9',
  '9:16',
  '4:3',
  '3:2',
  '1:1',
  '2:3',
  '3:4',
  '16:9',
] as const

export type ImageRatio = (typeof IMAGE_RATIOS)[number]
export type ImageQualityPreset = 'sd' | 'hd'
export type ImageGenerationMode = 'generate' | 'edit' | 'variation'

const GPT_IMAGE_SIZE_BY_RATIO: Record<ImageRatio, string> = {
  '21:9': '1536x1024',
  '9:16': '1024x1536',
  '4:3': '1536x1024',
  '3:2': '1536x1024',
  '1:1': '1024x1024',
  '2:3': '1024x1536',
  '3:4': '1024x1536',
  '16:9': '1536x1024',
}

const LEGACY_SIZE_BY_RATIO: Record<ImageRatio, string> = {
  '21:9': '1536x1024',
  '9:16': '1024x1536',
  '4:3': '1536x1024',
  '3:2': '1536x1024',
  '1:1': '1024x1024',
  '2:3': '1024x1536',
  '3:4': '1024x1536',
  '16:9': '1536x1024',
}

const JINGXING_LEGACY_EDIT_SIZE_BY_RATIO: Record<ImageRatio, string> = {
  '21:9': '1792x1024',
  '9:16': '1024x1792',
  '4:3': '1792x1024',
  '3:2': '1792x1024',
  '1:1': '1024x1024',
  '2:3': '1024x1792',
  '3:4': '1024x1792',
  '16:9': '1792x1024',
}

export function isImageGenerationModel(
  model?: Pick<Model, 'capabilities'> | null
) {
  const capabilities = model?.capabilities ?? []
  return (
    capabilities.includes(ModelCapabilities.IMAGE_GENERATION) ||
    capabilities.includes(ModelCapabilities.TEXT_TO_IMAGE)
  )
}

export function isImageEditModel(model?: Pick<Model, 'capabilities'> | null) {
  return (
    model?.capabilities?.includes(ModelCapabilities.IMAGE_TO_IMAGE) ?? false
  )
}

function imageModelSortKey(provider: ModelProvider, model: Pick<Model, 'id'>) {
  if (provider.provider !== 'jingxing') return 100

  const id = model.id.toLowerCase()
  if (id === 'gpt-image-1.5') return 0
  if (id === 'gpt-image-2') return 1
  if (id.startsWith('gpt-image-')) return 2
  if (id.startsWith('mai-image-')) return 3
  if (id.startsWith('gemini-')) return 4
  if (id.includes('imagen')) return 5
  if (id.includes('qwen-image')) return 6
  return 10
}

export function getImageModels(providers: ModelProvider[]) {
  return providers.flatMap((provider) =>
    provider.models
      .filter(isImageGenerationModel)
      .map((model, index) => ({
        provider,
        model,
        index,
        sortKey: imageModelSortKey(provider, model),
      }))
      .sort((a, b) => a.sortKey - b.sortKey || a.index - b.index)
      .map(({ provider, model }) => ({ provider, model }))
  )
}

export function isGptImageModel(modelId?: string) {
  return modelId?.toLowerCase().startsWith('gpt-image-') ?? false
}

export function imageSizeForRatio(ratio: ImageRatio, modelId?: string) {
  return isGptImageModel(modelId)
    ? GPT_IMAGE_SIZE_BY_RATIO[ratio]
    : LEGACY_SIZE_BY_RATIO[ratio]
}

export function isJingxingImageProvider(providerId?: string, baseUrl?: string) {
  const normalizedProvider = providerId?.toLowerCase() ?? ''
  const normalizedBaseUrl = baseUrl?.toLowerCase() ?? ''
  return (
    normalizedProvider === 'jingxing' ||
    normalizedBaseUrl.includes('api.jingxing.uk') ||
    normalizedBaseUrl.includes('api.jingxing.io') ||
    normalizedBaseUrl.includes('jingxing.io')
  )
}

export function usesJingxingCompatibleImageEditParams(
  modelId?: string,
  providerId?: string,
  baseUrl?: string
) {
  return (
    isGptImageModel(modelId) && isJingxingImageProvider(providerId, baseUrl)
  )
}

export function usesJingxingLegacyImageEditSize(
  modelId?: string,
  providerId?: string,
  baseUrl?: string
) {
  return (
    modelId?.toLowerCase() === 'gpt-image-1.5' &&
    isJingxingImageProvider(providerId, baseUrl)
  )
}

export function imageEditSizeForRatio(
  ratio: ImageRatio,
  modelId?: string,
  providerId?: string,
  baseUrl?: string
) {
  return usesJingxingLegacyImageEditSize(modelId, providerId, baseUrl)
    ? JINGXING_LEGACY_EDIT_SIZE_BY_RATIO[ratio]
    : imageSizeForRatio(ratio, modelId)
}

export function apiQualityForPreset(
  preset: ImageQualityPreset,
  modelId?: string
) {
  const normalized = modelId?.toLowerCase() ?? ''
  const legacyQuality = normalized.startsWith('dall-e-')

  if (legacyQuality) {
    return preset === 'hd' ? 'hd' : 'standard'
  }

  return preset === 'hd' ? 'high' : 'medium'
}

export function legacyApiQualityForPreset(preset: ImageQualityPreset) {
  return preset === 'hd' ? 'hd' : 'standard'
}

export function apiQualityForImageEditPreset(
  preset: ImageQualityPreset,
  modelId?: string,
  providerId?: string,
  baseUrl?: string
) {
  if (usesJingxingCompatibleImageEditParams(modelId, providerId, baseUrl)) {
    // Jingxing gpt-image edits are synchronous today; high/auto often exceed the gateway timeout.
    return 'medium'
  }

  return apiQualityForPreset(preset, modelId)
}

export function imageFileExtension(mimeType?: string) {
  if (mimeType?.includes('jpeg') || mimeType?.includes('jpg')) return 'jpg'
  if (mimeType?.includes('webp')) return 'webp'
  return 'png'
}

export function parseDataUrl(dataUrl: string) {
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(dataUrl.trim())
  if (!match) {
    return { mimeType: 'image/png', b64Json: dataUrl }
  }

  return {
    mimeType: match[1] || 'image/png',
    b64Json: match[2] || '',
  }
}

export async function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}
