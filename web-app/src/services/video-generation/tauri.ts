import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { fetch as fetchTauri } from '@tauri-apps/plugin-http'
import { videoDebugError, videoDebugLog } from '@/lib/video-generation-debug'
import { DefaultVideoGenerationService } from './default'
import type {
  SaveVideoAssetRequest,
  VideoAssetRecord,
} from './types'

export class TauriVideoGenerationService extends DefaultVideoGenerationService {
  protected fetch(): typeof globalThis.fetch {
    return fetchTauri as typeof globalThis.fetch
  }

  protected fileSrc(path: string): string {
    return convertFileSrc(path)
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
      throw error
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
}
