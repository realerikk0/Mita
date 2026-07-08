import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { fetch as fetchTauri } from '@tauri-apps/plugin-http'
import { DefaultImageGenerationService } from './default'
import type {
  ImageAssetRecord,
  ImportImageAssetRequest,
  SaveImageAssetRequest,
} from './types'
import type { ProjectAssignment } from '@/services/projects/types'

export class TauriImageGenerationService extends DefaultImageGenerationService {
  protected fetch(): typeof globalThis.fetch {
    return fetchTauri as typeof globalThis.fetch
  }

  protected fileSrc(path: string): string {
    return convertFileSrc(path)
  }

  async saveAsset(request: SaveImageAssetRequest): Promise<ImageAssetRecord> {
    return invoke<ImageAssetRecord>('save_image_asset', { asset: request })
  }

  async importAsset(
    request: ImportImageAssetRequest
  ): Promise<ImageAssetRecord> {
    return invoke<ImageAssetRecord>('import_image_asset', { asset: request })
  }

  async listAssets(): Promise<ImageAssetRecord[]> {
    return invoke<ImageAssetRecord[]>('list_image_assets')
  }

  async deleteAsset(assetId: string): Promise<void> {
    return invoke('delete_image_asset', { assetId })
  }

  async updateAssetProject(
    assetId: string,
    project?: ProjectAssignment
  ): Promise<ImageAssetRecord> {
    return invoke<ImageAssetRecord>('update_image_asset_project', {
      assetId,
      project: project ?? null,
    })
  }
}
