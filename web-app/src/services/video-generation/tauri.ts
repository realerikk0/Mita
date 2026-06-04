import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { fetch as fetchTauri } from '@tauri-apps/plugin-http'
import { arrayBufferToBase64 } from '@/lib/image-generation'
import { videoFileExtension } from '@/lib/video-generation'
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
    const asset =
      request.b64Json || !request.videoUrl
        ? request
        : {
            ...request,
            ...(await this.videoPayloadFromUrl(request.videoUrl)),
          }

    return invoke<VideoAssetRecord>('save_video_asset', { asset })
  }

  async listVideoAssets(): Promise<VideoAssetRecord[]> {
    return invoke<VideoAssetRecord[]>('list_video_assets')
  }

  async deleteVideoAsset(assetId: string): Promise<void> {
    return invoke('delete_video_asset', { assetId })
  }

  private async videoPayloadFromUrl(videoUrl: string) {
    const response = await this.fetch()(videoUrl)
    if (!response.ok) throw new Error('Unable to download generated video')
    const mimeType = response.headers.get('content-type')?.split(';')[0] || 'video/mp4'
    return {
      mimeType,
      extension: videoFileExtension(mimeType),
      b64Json: await arrayBufferToBase64(await response.arrayBuffer()),
    }
  }
}
