import type { ImageAssetRecord } from '@/services/image-generation/types'
import type { ImageRatio } from '@/lib/image-generation'
import type { SeedanceReferenceCapabilities } from '@/lib/seedance-video'
import type { ProjectAssignment } from '@/services/projects/types'

export type VideoGenerationStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'

export type VideoResolution = '480p' | '720p' | '1080p' | '4K'

export type VideoRatio = ImageRatio | 'adaptive'

export type VideoAssetKind = 'generated' | 'storyboard'

export type VideoReferenceKind = 'image' | 'video' | 'audio'

export type VideoReferenceRole =
  | 'reference'
  | 'first_frame'
  | 'last_frame'
  | 'style'
  | 'soundtrack'

/**
 * The serialisable subset shared by image, video and future audio assets.
 * Keeping references structural lets callers reuse existing asset records
 * without coupling video generation to a specific asset library.
 */
export type VideoReferenceAsset = {
  id: string
  path: string
  fileName?: string
  mimeType: string
}

export type VideoGenerationReference = {
  kind: VideoReferenceKind
  role?: VideoReferenceRole
  url?: string
  asset?: VideoReferenceAsset
}

export type VideoGenerationTask = {
  id: string
  status: VideoGenerationStatus
  progress: number
  videoUrl?: string
  lastFrameUrl?: string
  usage?: unknown
  raw?: unknown
}

export type GenerateVideoRequest = {
  provider: ModelProvider
  model: Model
  prompt: string
  ratio: VideoRatio
  duration: number
  resolution: VideoResolution
  fps: number
  generateAudio?: boolean
  references?: VideoGenerationReference[]
  seedanceReferenceCapabilities?: SeedanceReferenceCapabilities
  /**
   * Legacy single-image input used by the storyboard flow. New callers should
   * use `references`; this remains available while that flow is migrated.
   */
  sourceAsset?: ImageAssetRecord
  signal?: AbortSignal
}

export type PollVideoTaskRequest = {
  provider: ModelProvider
  model: Model
  taskId: string
  signal?: AbortSignal
}

export type VideoAssetRecord = {
  id: string
  prompt: string
  provider: string
  model: string
  ratio: VideoRatio
  resolution: VideoResolution
  duration: number
  fps: number
  sourceAssetIds: string[]
  references?: VideoGenerationReference[]
  createdAt: string
  usage?: unknown
  status: VideoGenerationStatus
  path: string
  fileName: string
  mimeType: string
  assetKind?: VideoAssetKind
  project?: ProjectAssignment
}

export type SaveVideoAssetRequest = Omit<
  VideoAssetRecord,
  'createdAt' | 'path' | 'fileName'
> & {
  b64Json?: string
  videoUrl?: string
  extension?: string
  createdAt?: string
}

export interface VideoGenerationService {
  generateVideo(request: GenerateVideoRequest): Promise<VideoGenerationTask>
  pollVideoTask(request: PollVideoTaskRequest): Promise<VideoGenerationTask>
  saveVideoAsset(request: SaveVideoAssetRequest): Promise<VideoAssetRecord>
  listVideoAssets(): Promise<VideoAssetRecord[]>
  deleteVideoAsset(assetId: string): Promise<void>
  updateVideoAssetProject(
    assetId: string,
    project?: ProjectAssignment
  ): Promise<VideoAssetRecord>
}
