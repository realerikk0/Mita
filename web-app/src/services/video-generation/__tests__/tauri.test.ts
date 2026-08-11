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
import {
  isRecoverableVideoPollingError,
  RecoverableVideoPollingError,
} from '../retry-error'
import { TauriVideoGenerationService } from '../tauri'

function remoteSaveRequest() {
  return {
    id: 'video-asset-transport-test',
    prompt: 'gold robot',
    provider: 'jingxing',
    model: 'seedance-2.0',
    ratio: '16:9' as const,
    resolution: '1080p' as const,
    duration: 8,
    fps: 30,
    sourceAssetIds: ['storyboard-1'],
    status: 'succeeded' as const,
    mimeType: 'video/mp4',
    videoUrl: 'https://cdn.example.test/video.mp4',
  }
}

describe('TauriVideoGenerationService', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset()
    vi.mocked(fetchTauri).mockReset()
    vi.unstubAllGlobals()
  })

  it('streams local storyboard sources through the native media upload', async () => {
    const legacyWebviewUrl =
      'asset:///mock/mita/image-assets/storyboard-1/image.png'
    vi.mocked(invoke).mockResolvedValue({
      id: 'media-storyboard-1',
      kind: 'image',
      mimeType: 'image/png',
      sizeBytes: 3,
      expiresAt: '2026-09-03T00:00:00Z',
    })
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

    expect(invoke).toHaveBeenCalledWith('upload_video_reference_media', {
      request: {
        endpoint: 'https://api.jingxing.uk/v1/media',
        apiKey: 'test-key',
        customHeaders: {},
        reference: {
          kind: 'image',
          asset: expect.objectContaining({
            id: 'storyboard-1',
            path: expect.stringContaining('storyboard-1/image.png'),
            fileName: 'image.png',
            mimeType: 'image/png',
          }),
        },
      },
    })
    expect(fetchTauri).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetchTauri).mock.calls[0][0]).toBe(
      'https://api.jingxing.uk/v1/video/generations'
    )
    const init = vi.mocked(fetchTauri).mock.calls[0][1] as RequestInit & {
      body: string
    }
    const body = JSON.parse(init.body)
    expect(body).toMatchObject({
      prompt: 'A gold robot walks through a neon city.',
      media: [
        {
          id: 'media-storyboard-1',
          role: 'reference_image',
        },
      ],
    })
    expect(body).not.toHaveProperty('image')
    expect(body).not.toHaveProperty('content')
    expect(body.metadata).not.toHaveProperty('content')
    expect(JSON.stringify(body)).not.toContain(legacyWebviewUrl)
  })

  it('surfaces structured native upload failures without creating a task', async () => {
    vi.mocked(invoke).mockRejectedValue({
      code: 'rate_limited',
      status: 429,
      message: 'Biyuan media upload is rate limited',
      retryAfterSeconds: 30,
      outcomeUnknown: false,
    })

    const service = new TauriVideoGenerationService()
    const promise = service.generateVideo({
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
      references: [
        {
          kind: 'image',
          asset: {
            id: 'reference-1',
            path: '/references/image.png',
            mimeType: 'image/png',
          },
        },
      ],
    })

    await expect(promise).rejects.toMatchObject({
      name: 'MediaUploadError',
      message: 'Biyuan media upload is rate limited',
      status: 429,
      retryAfterSeconds: 30,
    })
    expect(fetchTauri).not.toHaveBeenCalled()
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

  it('marks native remote-save transport rejections as recoverable', async () => {
    const nativeError =
      'Unable to download generated video: error sending request for url (https://cdn.example.test/video.mp4)'
    vi.mocked(invoke).mockRejectedValue(nativeError)

    const service = new TauriVideoGenerationService()
    const error = await service
      .saveVideoAsset(remoteSaveRequest())
      .catch((caught) => caught)

    expect(error).toBeInstanceOf(RecoverableVideoPollingError)
    expect(error).toMatchObject({
      reason: 'network',
      message: nativeError,
    })
    expect(isRecoverableVideoPollingError(error)).toBe(true)
  })

  it('does not classify native HTTP response bodies as save transport failures', async () => {
    const nativeError =
      'Unable to download generated video (404 Not Found): Upstream generation timed out'
    vi.mocked(invoke).mockRejectedValue(nativeError)

    const service = new TauriVideoGenerationService()
    const error = await service
      .saveVideoAsset(remoteSaveRequest())
      .catch((caught) => caught)

    expect(error).toBe(nativeError)
    expect(isRecoverableVideoPollingError(error)).toBe(false)
  })
})
