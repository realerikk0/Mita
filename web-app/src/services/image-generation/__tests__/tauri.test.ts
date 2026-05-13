import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
  invoke: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}))

import { invoke } from '@tauri-apps/api/core'
import { TauriImageGenerationService } from '../tauri'

describe('TauriImageGenerationService', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset()
  })

  it('imports a local image asset through Tauri', async () => {
    const record = {
      id: 'local-ref-1',
      prompt: 'logo-v1',
      mode: 'edit',
      provider: 'local',
      model: 'reference-image',
      ratio: '1:1',
      size: 'original',
      quality: 'source',
      sourceAssetIds: [],
      createdAt: '2026-05-11T00:00:00Z',
      status: 'succeeded',
      path: '/mock/mita/image-assets/local-ref-1/image.png',
      fileName: 'image.png',
      mimeType: 'image/png',
      assetKind: 'reference',
    }
    vi.mocked(invoke).mockResolvedValue(record)

    const service = new TauriImageGenerationService()
    const result = await service.importAsset({
      id: 'local-ref-1',
      sourcePath: '/Users/eric/Desktop/logo-v1.png',
      prompt: 'logo-v1',
    })

    expect(invoke).toHaveBeenCalledWith('import_image_asset', {
      asset: {
        id: 'local-ref-1',
        sourcePath: '/Users/eric/Desktop/logo-v1.png',
        prompt: 'logo-v1',
      },
    })
    expect(result).toBe(record)
  })
})
