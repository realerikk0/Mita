import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}))

import { invoke } from '@tauri-apps/api/core'
import { TauriVideoGenerationService } from '../tauri'

describe('TauriVideoGenerationService', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset()
  })

  it('saves video assets through Tauri', async () => {
    const record = {
      id: 'video-asset-1',
      prompt: 'gold robot',
      provider: 'jingxing',
      model: 'seedance-2.0',
      ratio: '16:9',
      resolution: '1080p',
      duration: 8,
      fps: 30,
      sourceAssetIds: ['storyboard-1'],
      createdAt: '2026-06-04T00:00:00Z',
      status: 'succeeded',
      path: '/mock/mita/video-assets/video-asset-1/video.mp4',
      fileName: 'video.mp4',
      mimeType: 'video/mp4',
    }
    vi.mocked(invoke).mockResolvedValue(record)

    const service = new TauriVideoGenerationService()
    const result = await service.saveVideoAsset({
      id: 'video-asset-1',
      prompt: 'gold robot',
      provider: 'jingxing',
      model: 'seedance-2.0',
      ratio: '16:9',
      resolution: '1080p',
      duration: 8,
      fps: 30,
      sourceAssetIds: ['storyboard-1'],
      status: 'succeeded',
      mimeType: 'video/mp4',
      b64Json: 'AAAA',
    })

    expect(invoke).toHaveBeenCalledWith('save_video_asset', {
      asset: {
        id: 'video-asset-1',
        prompt: 'gold robot',
        provider: 'jingxing',
        model: 'seedance-2.0',
        ratio: '16:9',
        resolution: '1080p',
        duration: 8,
        fps: 30,
        sourceAssetIds: ['storyboard-1'],
        status: 'succeeded',
        mimeType: 'video/mp4',
        b64Json: 'AAAA',
      },
    })
    expect(result).toBe(record)
  })
})
