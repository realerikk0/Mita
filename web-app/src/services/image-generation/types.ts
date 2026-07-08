import type {
  ImageGenerationMode,
  ImageQualityPreset,
  ImageRatio,
} from '@/lib/image-generation'
import type { ProjectAssignment } from '@/services/projects/types'

export type ImageGenerationStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'

export type ImageAssetRecord = {
  id: string
  prompt: string
  mode: ImageGenerationMode
  provider: string
  model: string
  ratio: ImageRatio
  size: string
  quality: string
  sourceAssetIds: string[]
  createdAt: string
  usage?: unknown
  revisedPrompt?: string
  status: ImageGenerationStatus
  path: string
  fileName: string
  mimeType: string
  assetKind?: 'generated' | 'reference' | 'storyboard'
  project?: ProjectAssignment
}

export type SaveImageAssetRequest = Omit<
  ImageAssetRecord,
  'createdAt' | 'path' | 'fileName'
> & {
  b64Json: string
  extension?: string
  createdAt?: string
}

export type ImportImageAssetRequest = {
  id: string
  sourcePath: string
  prompt?: string
  createdAt?: string
}

export type ImageGenerationRequest = {
  provider: ModelProvider
  model: Model
  prompt: string
  ratio: ImageRatio
  qualityPreset: ImageQualityPreset
  count: number
  mode: ImageGenerationMode
  sourceAssets?: ImageAssetRecord[]
  signal?: AbortSignal
}

export type ImageApiImage = {
  b64Json: string
  mimeType: string
  revisedPrompt?: string
  usage?: unknown
}

export interface ImageGenerationService {
  generateImages(request: ImageGenerationRequest): Promise<ImageApiImage[]>
  saveAsset(request: SaveImageAssetRequest): Promise<ImageAssetRecord>
  importAsset(request: ImportImageAssetRequest): Promise<ImageAssetRecord>
  listAssets(): Promise<ImageAssetRecord[]>
  deleteAsset(assetId: string): Promise<void>
  updateAssetProject(
    assetId: string,
    project?: ProjectAssignment
  ): Promise<ImageAssetRecord>
}
