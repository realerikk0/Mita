import type { ImageAssetRecord } from '@/services/image-generation/types'
import type { ImageRatio } from '@/lib/image-generation'
import type { ProjectAssignment } from '@/services/projects/types'

export type VideoGenerationStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'

export type VideoResolution = '720p' | '1080p' | '4K'

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
  ratio: ImageRatio
  duration: number
  resolution: VideoResolution
  fps: number
  generateAudio?: boolean
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
  ratio: ImageRatio
  resolution: VideoResolution
  duration: number
  fps: number
  sourceAssetIds: string[]
  createdAt: string
  usage?: unknown
  status: VideoGenerationStatus
  path: string
  fileName: string
  mimeType: string
  assetKind?: 'generated' | 'storyboard'
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
