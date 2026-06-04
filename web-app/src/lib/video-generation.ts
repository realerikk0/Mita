import { ModelCapabilities } from '@/types/models'

export function isVideoGenerationModel(
  model?: Pick<Model, 'id' | 'capabilities'> | null
) {
  const capabilities = model?.capabilities ?? []
  if (capabilities.includes(ModelCapabilities.VIDEO_GENERATION)) return true

  const id = model?.id?.toLowerCase() ?? ''
  return id.includes('seedance') || id.includes('sd2.0') || id.includes('video')
}

export function getVideoModels(providers: ModelProvider[]) {
  return providers.flatMap((provider) =>
    provider.models
      .filter(isVideoGenerationModel)
      .map((model, index) => ({ provider, model, index }))
      .sort((a, b) => videoModelSortKey(a.model) - videoModelSortKey(b.model) || a.index - b.index)
      .map(({ provider, model }) => ({ provider, model }))
  )
}

function videoModelSortKey(model: Pick<Model, 'id'>) {
  const id = model.id.toLowerCase()
  if (id.includes('seedance-2.0') || id.includes('sd2.0')) return 0
  if (id.includes('seedance')) return 1
  return 10
}

export function videoFileExtension(mimeType?: string) {
  if (mimeType?.includes('quicktime')) return 'mov'
  if (mimeType?.includes('webm')) return 'webm'
  return 'mp4'
}
