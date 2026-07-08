import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
  invoke: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}))

import { invoke } from '@tauri-apps/api/core'
import { fetch as fetchTauri } from '@tauri-apps/plugin-http'
import { ModelCapabilities } from '@/types/models'
import { TauriVideoGenerationService } from '../tauri'

describe('TauriVideoGenerationService', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset()
    vi.mocked(fetchTauri).mockReset()
    vi.unstubAllGlobals()
  })

  it('reads local storyboard sources through the webview fetch', async () => {
    const webviewFetch = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      })
    )
    vi.stubGlobal('fetch', webviewFetch)
    vi.mocked(fetchTauri).mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'video-task-1',
          task_id: 'video-task-1',
          status: 'queued',
          progress: 0,
        }),
        { status: 202, headers: { 'content-type': 'application/json' } }
      )
    )

    const service = new TauriVideoGenerationService()
    await service.generateVideo({
      provider: {
        provider: 'jingxing',
        base_url: 'https://api.jingxing.uk/v1',
        api_key: 'test-key',
        models: [],
        settings: [],
      } as unknown as ModelProvider,
      model: {
        id: 'seedance-2.0',
        capabilities: [ModelCapabilities.VIDEO_GENERATION],
      } as Model,
      prompt: 'A gold robot walks through a neon city.',
      ratio: '16:9',
      duration: 8,
      resolution: '1080p',
      fps: 30,
      sourceAsset: {
        id: 'storyboard-1',
        prompt: 'storyboard',
        mode: 'generate',
        provider: 'jingxing',
        model: 'gpt-image-2',
        ratio: '16:9',
        size: '1920x1080',
        quality: 'hd',
        sourceAssetIds: [],
        createdAt: '2026-06-04T00:00:00Z',
        status: 'succeeded',
        path: '/mock/mita/image-assets/storyboard-1/image.png',
        fileName: 'image.png',
        mimeType: 'image/png',
      },
    })

    expect(webviewFetch).toHaveBeenCalledWith(
      'asset:///mock/mita/image-assets/storyboard-1/image.png'
    )
    expect(fetchTauri).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetchTauri).mock.calls[0][0]).toBe(
      'https://api.jingxing.uk/v1/video/generations'
    )
    const init = vi.mocked(fetchTauri).mock.calls[0][1] as RequestInit & {
      body: string
    }
    expect(JSON.parse(init.body)).toMatchObject({
      prompt: 'A gold robot walks through a neon city.',
    })
    expect(JSON.parse(init.body).content).toEqual([
      { type: 'text', text: 'A gold robot walks through a neon city.' },
      {
        type: 'image_url',
        image_url: {
          url: 'data:image/png;base64,AQID',
        },
      },
    ])
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

  it('saves remote video URLs through Tauri without JS header parsing', async () => {
    const record = {
      id: 'video-asset-2',
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
      path: '/mock/mita/video-assets/video-asset-2/video.mp4',
      fileName: 'video.mp4',
      mimeType: 'video/mp4',
    }
    vi.mocked(invoke).mockResolvedValue(record)

    const service = new TauriVideoGenerationService()
    const result = await service.saveVideoAsset({
      id: 'video-asset-2',
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
      videoUrl:
        'https://ark-acg-cn-beijing.tos-cn-beijing.volces.com/video.mp4?X-Tos-Signature=test',
    })

    expect(fetchTauri).not.toHaveBeenCalled()
    expect(invoke).toHaveBeenCalledWith('save_video_asset_from_url', {
      asset: {
        id: 'video-asset-2',
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
        videoUrl:
          'https://ark-acg-cn-beijing.tos-cn-beijing.volces.com/video.mp4?X-Tos-Signature=test',
      },
    })
    expect(result).toBe(record)
  })
})
