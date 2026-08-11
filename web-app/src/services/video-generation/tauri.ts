import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { fetch as fetchTauri } from '@tauri-apps/plugin-http'
import { videoDebugError, videoDebugLog } from '@/lib/video-generation-debug'
import { DefaultVideoGenerationService } from './default'
import {
  isVideoTransportFailure,
  normalizeVideoError,
  RecoverableVideoPollingError,
} from './retry-error'
import type {
  SaveVideoAssetRequest,
  UploadedVideoReferenceMedia,
  UploadVideoReferenceMediaRequest,
  VideoAssetRecord,
} from './types'
import type { ProjectAssignment } from '@/services/projects/types'

function mediaUploadErrorFromUnknown(error: unknown) {
  if (error instanceof Error) return error
  if (!error || typeof error !== 'object') {
    return new Error('Unable to upload Biyuan reference media')
  }

  const payload = error as Record<string, unknown>
  const message =
    typeof payload.message === 'string' && payload.message.trim()
      ? payload.message
      : 'Unable to upload Biyuan reference media'
  const uploadError = new Error(message) as Error &
    Record<string, unknown>
  uploadError.name = 'MediaUploadError'
  for (const field of [
    'code',
    'status',
    'retryAfterSeconds',
    'requestId',
    'outcomeUnknown',
  ]) {
    if (payload[field] !== undefined) uploadError[field] = payload[field]
  }
  return uploadError
}

const VIDEO_DOWNLOAD_HTTP_RESPONSE_ERROR =
  /^Unable to download generated video \(\d{3}(?: [^)]+)?\)(?::|$)/i

function videoAssetDownloadError(error: unknown) {
  const normalized = normalizeVideoError(error)
  // The native command includes the HTTP status before a provider/CDN error
  // body. Never let phrases inside that body (for example, "timed out") turn a
  // terminal 4xx response into a transport retry.
  if (
    !VIDEO_DOWNLOAD_HTTP_RESPONSE_ERROR.test(normalized.message) &&
    isVideoTransportFailure(error)
  ) {
    return new RecoverableVideoPollingError(normalized.message, {
      cause: normalized,
      reason: 'network',
    })
  }

  return error
}

export class TauriVideoGenerationService extends DefaultVideoGenerationService {
  protected fetch(): typeof globalThis.fetch {
    return fetchTauri as typeof globalThis.fetch
  }

  protected fileSrc(path: string): string {
    return convertFileSrc(path)
  }

  protected async uploadLocalReference(
    request: UploadVideoReferenceMediaRequest
  ): Promise<UploadedVideoReferenceMedia> {
    try {
      return await invoke<UploadedVideoReferenceMedia>(
        'upload_video_reference_media',
        { request }
      )
    } catch (error) {
      throw mediaUploadErrorFromUnknown(error)
    }
  }

  async saveVideoAsset(
    request: SaveVideoAssetRequest
  ): Promise<VideoAssetRecord> {
    videoDebugLog('save:start', {
      id: request.id,
      provider: request.provider,
      model: request.model,
      videoUrl: request.videoUrl,
      hasB64Json: Boolean(request.b64Json),
      sourceAssetIds: request.sourceAssetIds,
      mimeType: request.mimeType,
    })

    let asset: SaveVideoAssetRequest
    try {
      if (!request.b64Json && request.videoUrl) {
        const saved = await invoke<VideoAssetRecord>('save_video_asset_from_url', {
          asset: request,
        })
        videoDebugLog('save:remote-success', {
          id: saved.id,
          path: saved.path,
          fileName: saved.fileName,
          mimeType: saved.mimeType,
          sourceAssetIds: saved.sourceAssetIds,
        })
        return saved
      }

      asset = request
    } catch (error) {
      videoDebugError('save:remote-failed', error, {
        id: request.id,
        videoUrl: request.videoUrl,
      })
      throw videoAssetDownloadError(error)
    }

    try {
      const saved = await invoke<VideoAssetRecord>('save_video_asset', { asset })
      videoDebugLog('save:success', {
        id: saved.id,
        path: saved.path,
        fileName: saved.fileName,
        mimeType: saved.mimeType,
        sourceAssetIds: saved.sourceAssetIds,
      })
      return saved
    } catch (error) {
      videoDebugError('save:invoke-failed', error, {
        id: request.id,
        videoUrl: request.videoUrl,
        mimeType: asset.mimeType,
      })
      throw error
    }
  }

  async listVideoAssets(): Promise<VideoAssetRecord[]> {
    return invoke<VideoAssetRecord[]>('list_video_assets')
  }

  async deleteVideoAsset(assetId: string): Promise<void> {
    return invoke('delete_video_asset', { assetId })
  }

  async updateVideoAssetProject(
    assetId: string,
    project?: ProjectAssignment
  ): Promise<VideoAssetRecord> {
    return invoke<VideoAssetRecord>('update_video_asset_project', {
      assetId,
      project: project ?? null,
    })
  }
}
