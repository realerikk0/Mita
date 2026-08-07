import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  SEEDANCE_MULTIMODAL_REFERENCE_CAPABILITIES,
  SeedanceValidationError,
} from '@/lib/seedance-video'
import { ModelCapabilities } from '@/types/models'
import { DefaultVideoGenerationService } from '../default'
import type {
  UploadedVideoReferenceMedia,
  UploadVideoReferenceMediaRequest,
} from '../types'

const provider = {
  provider: 'jingxing',
  base_url: 'https://api.jingxing.uk/v1',
  api_key: 'test-key',
  custom_header: [{ header: 'x-custom', value: 'yes' }],
  models: [],
  settings: [],
} as unknown as ModelProvider

const model = {
  id: 'seedance-2.0',
  capabilities: [ModelCapabilities.VIDEO_GENERATION],
} as Model

class UploadingVideoGenerationService extends DefaultVideoGenerationService {
  readonly upload = vi.fn<
    (
      request: UploadVideoReferenceMediaRequest
    ) => Promise<UploadedVideoReferenceMedia>
  >()

  protected uploadLocalReference(
    request: UploadVideoReferenceMediaRequest
  ): Promise<UploadedVideoReferenceMedia> {
    return this.upload(request)
  }
}

function upstreamCapacityResponse() {
  return new Response(
    JSON.stringify({
      error: {
        code: 'upstream_task_rate_limited',
        message: '当前分组上游负载已饱和，请稍后再试',
      },
    }),
    { status: 429, headers: { 'content-type': 'application/json' } }
  )
}

describe('DefaultVideoGenerationService', () => {
  afterEach(() => {
    localStorage.removeItem('biyan.videoGeneration.debug')
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('creates video tasks through the provider video endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'video-task-1',
          task_id: 'video-task-1',
          object: 'video',
          status: 'queued',
          progress: 0,
        }),
        { status: 202, headers: { 'content-type': 'application/json' } }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const service = new DefaultVideoGenerationService()
    const task = await service.generateVideo({
      provider,
      model,
      prompt: 'A gold robot walks through a neon city.',
      ratio: '16:9',
      duration: 8,
      resolution: '1080p',
      fps: 30,
      generateAudio: true,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.jingxing.uk/v1/video/generations'
    )
    const init = fetchMock.mock.calls[0][1] as RequestInit & {
      headers: Record<string, string>
      body: string
    }
    expect(init.headers.Authorization).toBe('Bearer test-key')
    expect(init.headers['x-custom']).toBe('yes')
    expect(JSON.parse(init.body)).toMatchObject({
      model: 'seedance-2.0',
      prompt: 'A gold robot walks through a neon city.',
      ratio: '16:9',
      duration: 8,
      resolution: '1080p',
      framespersecond: 30,
      generate_audio: true,
      watermark: false,
    })
    expect(JSON.parse(init.body)).not.toHaveProperty('content')
    expect(task).toMatchObject({
      id: 'video-task-1',
      status: 'queued',
      progress: 0,
    })
  })

  it('serializes the documented lowercase 4k API value', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          task_id: 'video-task-4k',
          status: 'queued',
        }),
        { status: 202, headers: { 'content-type': 'application/json' } }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const service = new DefaultVideoGenerationService()
    await service.generateVideo({
      provider,
      model,
      prompt: 'A detailed wide establishing shot.',
      ratio: '16:9',
      duration: 5,
      resolution: '4K',
      fps: 24,
      generateAudio: true,
    })

    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(JSON.parse(String(init.body))).toMatchObject({
      resolution: '4k',
      size: '3840x2160',
      metadata: {
        resolution: '4k',
      },
    })
  })

  it('retries explicit upstream capacity responses without rotating API keys', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(upstreamCapacityResponse())
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            task_id: 'video-task-after-capacity',
            status: 'queued',
          }),
          { status: 202, headers: { 'content-type': 'application/json' } }
        )
      )
    vi.stubGlobal('fetch', fetchMock)

    const service = new DefaultVideoGenerationService({
      requestRetryDelaysMs: [0],
    })
    const task = await service.generateVideo({
      provider: {
        ...provider,
        api_key_fallbacks: ['fallback-key'],
      } as unknown as ModelProvider,
      model,
      prompt: 'Retry only when the provider confirms capacity saturation.',
      ratio: '16:9',
      duration: 8,
      resolution: '1080p',
      fps: 24,
    })

    expect(task.id).toBe('video-task-after-capacity')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const authorizationHeaders = fetchMock.mock.calls.map(
      ([, init]) =>
        (init as RequestInit & { headers: Record<string, string> }).headers
          .Authorization
    )
    expect(authorizationHeaders).toEqual(['Bearer test-key', 'Bearer test-key'])
  })

  it('reports exhausted upstream capacity separately from API configuration', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(upstreamCapacityResponse())
      .mockResolvedValueOnce(upstreamCapacityResponse())
    vi.stubGlobal('fetch', fetchMock)

    const service = new DefaultVideoGenerationService({
      requestRetryDelaysMs: [0],
    })
    const promise = service.generateVideo({
      provider: {
        ...provider,
        api_key_fallbacks: ['fallback-key'],
      } as unknown as ModelProvider,
      model,
      prompt: 'A capacity-limited request.',
      ratio: '16:9',
      duration: 8,
      resolution: '1080p',
      fps: 24,
    })

    await expect(promise).rejects.toMatchObject({
      name: 'UpstreamCapacityError',
      code: 'upstream_task_rate_limited',
      message: '上游视频生成服务当前负载已饱和，请稍后重试。',
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not replay an ambiguous failed video creation POST', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetchMock)

    const service = new DefaultVideoGenerationService({
      requestRetryDelaysMs: [0, 0],
    })
    const promise = service.generateVideo({
      provider,
      model,
      prompt: 'Do not risk creating this task twice.',
      ratio: '16:9',
      duration: 8,
      resolution: '1080p',
      fps: 24,
    })

    await expect(promise).rejects.toThrow('Failed to fetch')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('still rotates API keys after authentication failures', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { message: 'Invalid API key' } }),
          { status: 401, headers: { 'content-type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            task_id: 'video-task-fallback-key',
            status: 'queued',
          }),
          { status: 202, headers: { 'content-type': 'application/json' } }
        )
      )
    vi.stubGlobal('fetch', fetchMock)

    const service = new DefaultVideoGenerationService()
    const task = await service.generateVideo({
      provider: {
        ...provider,
        api_key_fallbacks: ['fallback-key'],
      } as unknown as ModelProvider,
      model,
      prompt: 'Use the fallback key.',
      ratio: '16:9',
      duration: 8,
      resolution: '1080p',
      fps: 24,
    })

    expect(task.id).toBe('video-task-fallback-key')
    const authorizationHeaders = fetchMock.mock.calls.map(
      ([, init]) =>
        (init as RequestInit & { headers: Record<string, string> }).headers
          .Authorization
    )
    expect(authorizationHeaders).toEqual([
      'Bearer test-key',
      'Bearer fallback-key',
    ])
  })

  it('uploads Biyuan storyboard sources and submits media tickets', async () => {
    const storyboardPath =
      '/mock/mita/image-assets/storyboard-1/image.png'
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'video-task-1',
          task_id: 'video-task-1',
          object: 'video',
          status: 'queued',
          progress: 0,
        }),
        { status: 202, headers: { 'content-type': 'application/json' } }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const service = new UploadingVideoGenerationService()
    service.upload.mockResolvedValue({
      id: 'media-storyboard-1',
      kind: 'image',
      mimeType: 'image/png',
      sizeBytes: 3,
      expiresAt: '2026-09-03T00:00:00Z',
    })
    await service.generateVideo({
      provider: {
        ...provider,
        provider: 'openai-compatible',
        base_url: 'https://api.biyuan.ai/v1',
      } as unknown as ModelProvider,
      model,
      prompt: 'A gold robot walks through a neon city.',
      ratio: '16:9',
      duration: 8,
      resolution: '1080p',
      fps: 24,
      generateAudio: false,
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

    expect(service.upload).toHaveBeenCalledWith({
      endpoint: 'https://api.biyuan.ai/v1/media',
      apiKey: 'test-key',
      customHeaders: { 'x-custom': 'yes' },
      reference: {
        kind: 'image',
        asset: expect.objectContaining({
          id: 'storyboard-1',
          path: storyboardPath,
          mimeType: 'image/png',
        }),
      },
    })
    const init = fetchMock.mock.calls[0][1] as RequestInit & { body: string }
    const body = JSON.parse(init.body)

    expect(body).toMatchObject({
      model: 'seedance-2.0',
      prompt: 'A gold robot walks through a neon city.',
      media: [
        {
          id: 'media-storyboard-1',
          role: 'reference_image',
        },
      ],
      size: '1920x1080',
      metadata: {
        ratio: '16:9',
        resolution: '1080p',
        generate_audio: false,
        watermark: false,
      },
    })
    expect(body).not.toHaveProperty('image')
    expect(body).not.toHaveProperty('content')
    expect(body.metadata).not.toHaveProperty('content')
    expect(JSON.stringify(body)).not.toContain(storyboardPath)
  })

  it('pins the fallback API key after the first successful media upload', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          task_id: 'video-task-pinned-key',
          status: 'queued',
        }),
        { status: 202, headers: { 'content-type': 'application/json' } }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const service = new UploadingVideoGenerationService()
    service.upload
      .mockRejectedValueOnce({
        code: 'authentication_failed',
        status: 401,
        message: 'Invalid API key',
      })
      .mockResolvedValueOnce({
        id: 'media-image',
        kind: 'image',
        mimeType: 'image/png',
        sizeBytes: 128,
        expiresAt: '2026-09-03T00:00:00Z',
      })
      .mockResolvedValueOnce({
        id: 'media-video',
        kind: 'video',
        mimeType: 'video/mp4',
        sizeBytes: 1024,
        expiresAt: '2026-09-03T00:00:00Z',
      })

    await service.generateVideo({
      provider: {
        ...provider,
        api_key_fallbacks: ['fallback-key'],
        custom_header: [
          ...(provider.custom_header ?? []),
          { header: 'authorization', value: 'Bearer wrong-user' },
          { header: 'X-API-Key', value: 'wrong-user' },
        ],
      } as unknown as ModelProvider,
      model,
      prompt: 'Keep these references in order.',
      ratio: '16:9',
      duration: 8,
      resolution: '1080p',
      fps: 24,
      references: [
        {
          kind: 'image',
          asset: {
            id: 'local-image',
            path: '/references/image.png',
            fileName: 'image.png',
            mimeType: 'image/png',
          },
        },
        {
          kind: 'video',
          durationSeconds: 5,
          asset: {
            id: 'local-video',
            path: '/references/video.mp4',
            fileName: 'video.mp4',
            mimeType: 'video/mp4',
          },
        },
      ],
    })

    expect(service.upload.mock.calls.map(([request]) => request.apiKey)).toEqual([
      'test-key',
      'fallback-key',
      'fallback-key',
    ])
    const generationInit = fetchMock.mock.calls[0][1] as RequestInit & {
      headers: Record<string, string>
      body: string
    }
    expect(generationInit.headers.Authorization).toBe('Bearer fallback-key')
    expect(generationInit.headers['x-api-key']).toBe('fallback-key')
    expect(JSON.stringify(generationInit.headers)).not.toContain('wrong-user')
    expect(JSON.parse(generationInit.body).media).toEqual([
      { id: 'media-image', role: 'reference_image' },
      { id: 'media-video', role: 'reference_video' },
    ])
  })

  it('does not rotate keys after a media upload has succeeded', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const service = new UploadingVideoGenerationService()
    service.upload
      .mockResolvedValueOnce({
        id: 'media-image',
        kind: 'image',
        mimeType: 'image/png',
        sizeBytes: 128,
        expiresAt: '2026-09-03T00:00:00Z',
      })
      .mockRejectedValueOnce({
        code: 'authentication_failed',
        status: 401,
        message: 'Pinned key rejected',
      })

    const promise = service.generateVideo({
      provider: {
        ...provider,
        api_key_fallbacks: ['fallback-key'],
      } as unknown as ModelProvider,
      model,
      prompt: 'Do not cross user boundaries.',
      ratio: '16:9',
      duration: 8,
      resolution: '1080p',
      fps: 24,
      references: [
        {
          kind: 'image',
          asset: {
            id: 'local-image',
            path: '/references/image.png',
            mimeType: 'image/png',
          },
        },
        {
          kind: 'video',
          durationSeconds: 5,
          asset: {
            id: 'local-video',
            path: '/references/video.mp4',
            mimeType: 'video/mp4',
          },
        },
      ],
    })

    await expect(promise).rejects.toMatchObject({ status: 401 })
    expect(service.upload.mock.calls.map(([request]) => request.apiKey)).toEqual([
      'test-key',
      'test-key',
    ])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps the uploaded media key pinned for the generation request', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { message: 'Pinned key rejected' } }),
        { status: 401, headers: { 'content-type': 'application/json' } }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const service = new UploadingVideoGenerationService()
    service.upload.mockResolvedValueOnce({
      id: 'media-image',
      kind: 'image',
      mimeType: 'image/png',
      sizeBytes: 128,
      expiresAt: '2026-09-03T00:00:00Z',
    })
    const promise = service.generateVideo({
      provider: {
        ...provider,
        api_key_fallbacks: ['fallback-key'],
      } as unknown as ModelProvider,
      model,
      prompt: 'Keep the generation key pinned.',
      ratio: '16:9',
      duration: 8,
      resolution: '1080p',
      fps: 24,
      references: [
        {
          kind: 'image',
          asset: {
            id: 'local-image',
            path: '/references/image.png',
            mimeType: 'image/png',
          },
        },
      ],
    })

    await expect(promise).rejects.toThrow('Pinned key rejected')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const init = fetchMock.mock.calls[0][1] as RequestInit & {
      headers: Record<string, string>
    }
    expect(init.headers.Authorization).toBe('Bearer test-key')
  })

  it.each([413, 429, 503])(
    'does not retry or rotate a rejected media upload with status %s',
    async (status) => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      const service = new UploadingVideoGenerationService()
      service.upload.mockRejectedValueOnce({
        code: 'upload_failed',
        status,
        message: 'Upload rejected',
      })

      const promise = service.generateVideo({
        provider: {
          ...provider,
          api_key_fallbacks: ['fallback-key'],
        } as unknown as ModelProvider,
        model,
        prompt: 'One local reference.',
        ratio: '16:9',
        duration: 8,
        resolution: '1080p',
        fps: 24,
        references: [
          {
            kind: 'image',
            asset: {
              id: 'local-image',
              path: '/references/image.png',
              mimeType: 'image/png',
            },
          },
        ],
      })

      await expect(promise).rejects.toMatchObject({ status })
      expect(service.upload).toHaveBeenCalledTimes(1)
      expect(fetchMock).not.toHaveBeenCalled()
    }
  )

  it('rejects mixed local and remote Biyuan references before I/O', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const service = new UploadingVideoGenerationService()

    const promise = service.generateVideo({
      provider,
      model,
      prompt: 'Mixed reference transports.',
      ratio: '16:9',
      duration: 8,
      resolution: '1080p',
      fps: 24,
      references: [
        {
          kind: 'image',
          asset: {
            id: 'local-image',
            path: '/references/image.png',
            mimeType: 'image/png',
          },
        },
        {
          kind: 'video',
          url: 'https://assets.example.test/video.mp4',
        },
      ],
    })

    await expect(promise).rejects.toMatchObject({
      code: 'mixed_reference_sources_not_supported',
    })
    expect(service.upload).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects local media with an unknown duration before upload', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const service = new UploadingVideoGenerationService()

    const promise = service.generateVideo({
      provider,
      model,
      prompt: 'Validate this local clip.',
      ratio: '16:9',
      duration: 8,
      resolution: '1080p',
      fps: 24,
      references: [
        {
          kind: 'video',
          asset: {
            id: 'local-video',
            path: '/references/video.mp4',
            mimeType: 'video/mp4',
          },
        },
      ],
    })

    await expect(promise).rejects.toMatchObject({
      code: 'invalid_reference_duration',
    })
    expect(service.upload).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects local media duration totals before upload', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const service = new UploadingVideoGenerationService()

    const promise = service.generateVideo({
      provider,
      model,
      prompt: 'Validate these local clips.',
      ratio: '16:9',
      duration: 8,
      resolution: '1080p',
      fps: 24,
      references: [
        {
          kind: 'video',
          durationSeconds: 8,
          asset: {
            id: 'local-video-a',
            path: '/references/video-a.mp4',
            mimeType: 'video/mp4',
          },
        },
        {
          kind: 'video',
          durationSeconds: 8,
          asset: {
            id: 'local-video-b',
            path: '/references/video-b.mp4',
            mimeType: 'video/mp4',
          },
        },
      ],
    })

    await expect(promise).rejects.toMatchObject({
      code: 'reference_duration_total_exceeded',
    })
    expect(service.upload).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('serializes multimodal references only with an explicit capability', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          task_id: 'video-task-multimodal',
          status: 'queued',
        }),
        { status: 202, headers: { 'content-type': 'application/json' } }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const service = new DefaultVideoGenerationService()
    await service.generateVideo({
      provider: {
        ...provider,
        provider: 'openai-compatible',
        base_url: 'https://api.example.test/v1',
      } as unknown as ModelProvider,
      model,
      prompt: 'Use all references in their supplied order.',
      ratio: '16:9',
      duration: 8,
      resolution: '1080p',
      fps: 24,
      generateAudio: true,
      references: [
        { kind: 'image', url: 'https://assets.example.test/image.png' },
        { kind: 'video', url: 'https://assets.example.test/video.mp4' },
        { kind: 'audio', url: 'https://assets.example.test/audio.mp3' },
      ],
      seedanceReferenceCapabilities: SEEDANCE_MULTIMODAL_REFERENCE_CAPABILITIES,
    })

    const init = fetchMock.mock.calls[0][1] as RequestInit & { body: string }
    const body = JSON.parse(init.body)
    expect(body).not.toHaveProperty('image')
    expect(body.content).toEqual([
      {
        type: 'text',
        text: 'Use all references in their supplied order.',
      },
      {
        type: 'image_url',
        role: 'reference_image',
        image_url: { url: 'https://assets.example.test/image.png' },
      },
      {
        type: 'video_url',
        role: 'reference_video',
        video_url: { url: 'https://assets.example.test/video.mp4' },
      },
      {
        type: 'audio_url',
        role: 'reference_audio',
        audio_url: { url: 'https://assets.example.test/audio.mp3' },
      },
    ])
  })

  it('serializes Biyuan video and audio references by default', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          task_id: 'video-task-biyuan-multimodal',
          status: 'queued',
        }),
        { status: 202, headers: { 'content-type': 'application/json' } }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const service = new DefaultVideoGenerationService()
    await service.generateVideo({
      provider: {
        ...provider,
        provider: 'openai-compatible',
        base_url: 'https://api.biyuan.ai/v1',
      } as unknown as ModelProvider,
      model,
      prompt: 'Animate this clip.',
      ratio: '16:9',
      duration: 8,
      resolution: '1080p',
      fps: 24,
      references: [
        { kind: 'video', url: 'https://assets.example.test/video.mp4' },
        { kind: 'audio', url: 'https://assets.example.test/audio.mp3' },
      ],
    })

    const init = fetchMock.mock.calls[0][1] as RequestInit & { body: string }
    const body = JSON.parse(init.body)
    expect(body).not.toHaveProperty('content')
    expect(body).not.toHaveProperty('media')
    expect(body.metadata.content).toEqual([
      {
        type: 'video_url',
        role: 'reference_video',
        video_url: { url: 'https://assets.example.test/video.mp4' },
      },
      {
        type: 'audio_url',
        role: 'reference_audio',
        audio_url: { url: 'https://assets.example.test/audio.mp3' },
      },
    ])
  })

  it('keeps unverified Seedance-compatible providers on legacy references', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const service = new DefaultVideoGenerationService()
    const promise = service.generateVideo({
      provider: {
        ...provider,
        provider: 'openai-compatible',
        base_url: 'https://api.example.test/v1',
      } as unknown as ModelProvider,
      model,
      prompt: 'Animate this clip.',
      ratio: '16:9',
      duration: 8,
      resolution: '1080p',
      fps: 24,
      references: [
        { kind: 'video', url: 'https://assets.example.test/video.mp4' },
      ],
    })

    await expect(promise).rejects.toMatchObject<
      Partial<SeedanceValidationError>
    >({
      code: 'too_many_videos',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not put prompts, base64 data, or full request bodies in debug logs', async () => {
    localStorage.setItem('biyan.videoGeneration.debug', '1')
    const consoleSpy = vi
      .spyOn(console, 'info')
      .mockImplementation(() => undefined)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ task_id: 'video-task-debug', status: 'queued' }),
          { status: 202, headers: { 'content-type': 'application/json' } }
        )
      )
    vi.stubGlobal('fetch', fetchMock)

    const service = new DefaultVideoGenerationService()
    await service.generateVideo({
      provider,
      model,
      prompt: 'private-prompt-that-must-not-be-logged',
      ratio: '16:9',
      duration: 8,
      resolution: '1080p',
      fps: 24,
      references: [
        {
          kind: 'image',
          url: 'data:image/png;base64,PRIVATEBASE64PAYLOAD',
        },
      ],
      seedanceReferenceCapabilities: SEEDANCE_MULTIMODAL_REFERENCE_CAPABILITIES,
    })

    const output = JSON.stringify(consoleSpy.mock.calls)
    expect(output).not.toContain('private-prompt-that-must-not-be-logged')
    expect(output).not.toContain('PRIVATEBASE64PAYLOAD')
    expect(output).not.toContain('"body"')
    expect(output).toContain('requestShape')
  })

  it.each([
    [
      'provider name',
      {
        ...provider,
        provider: 'biyuan',
        base_url: 'https://proxy.example.test/v1',
      },
    ],
    [
      'Biyuan API host',
      {
        ...provider,
        provider: 'openai-compatible',
        base_url: 'https://api.biyuan.ai/v1',
      },
    ],
  ])(
    'uses Biyuan-compatible video params for %s',
    async (_, providerConfig) => {
      const fetchMock = vi.fn().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'video-task-1',
            task_id: 'video-task-1',
            status: 'queued',
          }),
          { status: 202, headers: { 'content-type': 'application/json' } }
        )
      )
      vi.stubGlobal('fetch', fetchMock)

      const service = new DefaultVideoGenerationService()
      await service.generateVideo({
        provider: providerConfig as unknown as ModelProvider,
        model,
        prompt: 'A gold robot walks through a neon city.',
        ratio: '16:9',
        duration: 8,
        resolution: '1080p',
        fps: 24,
        generateAudio: false,
      })

      const init = fetchMock.mock.calls[0][1] as RequestInit & { body: string }
      expect(JSON.parse(init.body)).toMatchObject({
        size: '1920x1080',
        metadata: {
          ratio: '16:9',
          resolution: '1080p',
          framespersecond: 24,
        },
      })
    }
  )

  it.each([
    ['480p', '9:16', '480x864'],
    ['720p', '4:3', '1112x834'],
    ['1080p', '21:9', '2206x946'],
    ['4K', '3:4', '2494x3326'],
  ] as const)(
    'serializes the published %s %s output size',
    async (resolution, ratio, size) => {
      const fetchMock = vi.fn().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            task_id: `video-task-${resolution}-${ratio}`,
            status: 'queued',
          }),
          { status: 202, headers: { 'content-type': 'application/json' } }
        )
      )
      vi.stubGlobal('fetch', fetchMock)

      const service = new DefaultVideoGenerationService()
      await service.generateVideo({
        provider,
        model,
        prompt: 'A video using a published Seedance output size.',
        ratio,
        duration: 8,
        resolution,
        fps: 24,
      })

      const init = fetchMock.mock.calls[0][1] as RequestInit & {
        body: string
      }
      expect(JSON.parse(init.body)).toMatchObject({
        resolution: resolution === '4K' ? '4k' : resolution,
        size,
      })
    }
  )

  it.each([
    ['ordinary provider', 'openai-compatible', 'https://api.example.test/v1'],
    [
      'lookalike provider name',
      'third-party-biyuan-proxy',
      'https://api.example.test/v1',
    ],
    [
      'lookalike hostname',
      'openai-compatible',
      'https://api.biyuan.ai.example.com/v1',
    ],
  ])(
    'does not add Biyuan-compatible video params for %s',
    async (_, providerId, baseUrl) => {
      const fetchMock = vi.fn().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'video-task-1',
            task_id: 'video-task-1',
            status: 'queued',
          }),
          { status: 202, headers: { 'content-type': 'application/json' } }
        )
      )
      vi.stubGlobal('fetch', fetchMock)

      const service = new DefaultVideoGenerationService()
      await service.generateVideo({
        provider: {
          ...provider,
          provider: providerId,
          base_url: baseUrl,
        } as unknown as ModelProvider,
        model,
        prompt: 'A gold robot walks through a neon city.',
        ratio: '16:9',
        duration: 8,
        resolution: '1080p',
        fps: 24,
        generateAudio: false,
      })

      const init = fetchMock.mock.calls[0][1] as RequestInit & { body: string }
      const body = JSON.parse(init.body)
      expect(body).not.toHaveProperty('size')
      expect(body).not.toHaveProperty('metadata')
    }
  )

  it('polls wrapped Seedance-style responses and extracts the video URL', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: 'success',
          data: {
            task_id: 'video-task-1',
            status: 'SUCCESS',
            progress: '100%',
            data: {
              model: 'doubao-seedance-2-0-260128',
              status: 'succeeded',
              content: {
                video_url: 'https://cdn.example.test/video.mp4',
                last_frame_url: 'https://cdn.example.test/last-frame.png',
              },
              usage: { total_tokens: 15000 },
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const service = new DefaultVideoGenerationService({
      pollIntervalMs: 0,
      timeoutMs: 1000,
    })
    const task = await service.pollVideoTask({
      provider,
      model,
      taskId: 'video-task-1',
    })

    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.jingxing.uk/v1/video/generations/video-task-1?show_raw=true&show_usage=true'
    )
    expect(task).toMatchObject({
      id: 'video-task-1',
      status: 'succeeded',
      progress: 100,
      videoUrl: 'https://cdn.example.test/video.mp4',
      lastFrameUrl: 'https://cdn.example.test/last-frame.png',
      usage: { total_tokens: 15000 },
    })
  })

  it('extracts the provider failure detail from failed poll responses', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          task_id: 'video-task-9',
          status: 'failed',
          progress: 100,
          error: {
            code: 'video_generation_failed',
            message:
              'Your request content[1] may be related to copyright restrictions',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const service = new DefaultVideoGenerationService({
      pollIntervalMs: 0,
      timeoutMs: 1000,
    })
    const task = await service.pollVideoTask({
      provider,
      model,
      taskId: 'video-task-9',
    })

    expect(task.status).toBe('failed')
    expect(task.error).toBe(
      'Your request content[1] may be related to copyright restrictions'
    )
  })

  it('unwraps double-encoded JSON failure messages from failed tasks', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          task_id: 'video-task-10',
          status: 'failed',
          error: {
            code: 'video_generation_failed',
            message: JSON.stringify({
              code: 'OutputVideoSensitiveContentDetected',
              message: '输出视频可能包含敏感内容，请调整提示词后重试',
            }),
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const service = new DefaultVideoGenerationService({
      pollIntervalMs: 0,
      timeoutMs: 1000,
    })
    const task = await service.pollVideoTask({
      provider,
      model,
      taskId: 'video-task-10',
    })

    expect(task.status).toBe('failed')
    expect(task.error).toBe('输出视频可能包含敏感内容，请调整提示词后重试')
  })

  it('unwraps upstream errors nested as error.error inside the JSON string', async () => {
    // Exact shape reported by Biyuan: error.message is a JSON string whose
    // payload nests the real detail one level deeper under "error".
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'task_Ub5F0IuCIvibPPmjDEN6NUlSHCPKCv1m',
          task_id: 'task_Ub5F0IuCIvibPPmjDEN6NUlSHCPKCv1m',
          object: 'video',
          model: 'doubao-seedance-2-0-260128',
          status: 'failed',
          progress: 100,
          created_at: 1786099370,
          completed_at: 1786099385,
          error: {
            message: JSON.stringify({
              error: {
                code: '***.PrivacyInformation',
                message:
                  "The request failed because the input image 'content[0]' may contain real person. Request id: 021786099371407817b06a784e756ea4b86a97afa590e06d8fdbd",
                param: 'content[0]',
                type: 'BadRequest',
              },
            }),
            code: 'video_generation_failed',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const service = new DefaultVideoGenerationService({
      pollIntervalMs: 0,
      timeoutMs: 1000,
    })
    const task = await service.pollVideoTask({
      provider,
      model,
      taskId: 'task_Ub5F0IuCIvibPPmjDEN6NUlSHCPKCv1m',
    })

    expect(task.status).toBe('failed')
    expect(task.error).toBe(
      "The request failed because the input image 'content[0]' may contain real person. Request id: 021786099371407817b06a784e756ea4b86a97afa590e06d8fdbd"
    )
  })

  it('re-polls once when a failed task has no error detail yet', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ task_id: 'video-task-12', status: 'failed' }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            task_id: 'video-task-12',
            status: 'failed',
            error: {
              code: 'video_generation_failed',
              message: 'The input image may contain real person',
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
    vi.stubGlobal('fetch', fetchMock)

    const service = new DefaultVideoGenerationService({
      pollIntervalMs: 0,
      timeoutMs: 1000,
    })
    const task = await service.pollVideoTask({
      provider,
      model,
      taskId: 'video-task-12',
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(task.status).toBe('failed')
    expect(task.error).toBe('The input image may contain real person')
  })

  it('falls back to the error code when a failed task has no message', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          task_id: 'video-task-11',
          status: 'failed',
          error: { code: 'video_generation_failed' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const service = new DefaultVideoGenerationService({
      pollIntervalMs: 0,
      timeoutMs: 1000,
    })
    const task = await service.pollVideoTask({
      provider,
      model,
      taskId: 'video-task-11',
    })

    expect(task.status).toBe('failed')
    expect(task.error).toBe('video_generation_failed')
  })

  it('keeps polling running tasks until a terminal result arrives', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'video-task-1',
            task_id: 'video-task-1',
            object: 'video',
            status: 'running',
            progress: 42,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'video-task-1',
            task_id: 'video-task-1',
            object: 'video',
            status: 'completed',
            progress: 100,
            metadata: {
              url: 'https://cdn.example.test/video.mp4',
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
    vi.stubGlobal('fetch', fetchMock)

    const service = new DefaultVideoGenerationService({
      pollIntervalMs: 0,
      timeoutMs: 1000,
    })
    const task = await service.pollVideoTask({
      provider,
      model,
      taskId: 'video-task-1',
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(task).toMatchObject({
      status: 'succeeded',
      videoUrl: 'https://cdn.example.test/video.mp4',
    })
  })

  it('retries recoverable polling network failures with a bounded budget', async () => {
    const connectionReset = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('read ECONNRESET'), {
        code: 'ECONNRESET',
      }),
    })
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(connectionReset)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            task_id: 'video-task-after-network-retry',
            status: 'completed',
            metadata: {
              url: 'https://cdn.example.test/recovered-video.mp4',
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
    vi.stubGlobal('fetch', fetchMock)

    const service = new DefaultVideoGenerationService({
      pollIntervalMs: 0,
      timeoutMs: 1000,
      requestRetryDelaysMs: [0, 0],
    })
    const task = await service.pollVideoTask({
      provider,
      model,
      taskId: 'video-task-after-network-retry',
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(task).toMatchObject({
      id: 'video-task-after-network-retry',
      status: 'succeeded',
      videoUrl: 'https://cdn.example.test/recovered-video.mp4',
    })
  })

  it('stops retrying polling network failures after the configured budget', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetchMock)

    const service = new DefaultVideoGenerationService({
      pollIntervalMs: 0,
      timeoutMs: 1000,
      requestRetryDelaysMs: [0, 0],
    })
    const promise = service.pollVideoTask({
      provider,
      model,
      taskId: 'video-task-network-down',
    })

    await expect(promise).rejects.toThrow('Failed to fetch')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('extracts gateway result_url videos from completed tasks', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: 'success',
          data: {
            task_id: 'video-task-2',
            status: 'completed',
            progress: 100,
            result_url: 'https://cdn.example.test/gateway-video.mp4',
            usage: { total_tokens: 18000 },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const service = new DefaultVideoGenerationService({
      pollIntervalMs: 0,
      timeoutMs: 1000,
    })
    const task = await service.pollVideoTask({
      provider,
      model,
      taskId: 'video-task-2',
    })

    expect(task).toMatchObject({
      id: 'video-task-2',
      status: 'succeeded',
      progress: 100,
      videoUrl: 'https://cdn.example.test/gateway-video.mp4',
      usage: { total_tokens: 18000 },
    })
  })

  it('prefers explicit video URLs over generic content URLs', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: 'success',
          data: {
            task_id: 'video-task-3',
            status: 'completed',
            progress: 100,
            content: {
              url: 'https://cdn.example.test/thumbnail.jpg',
            },
            video_url: 'https://cdn.example.test/video.mp4',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const service = new DefaultVideoGenerationService({
      pollIntervalMs: 0,
      timeoutMs: 1000,
    })
    const task = await service.pollVideoTask({
      provider,
      model,
      taskId: 'video-task-3',
    })

    expect(task).toMatchObject({
      id: 'video-task-3',
      status: 'succeeded',
      videoUrl: 'https://cdn.example.test/video.mp4',
    })
  })

  it('keeps the gateway task id when poll responses include internal ids', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: 'success',
          data: {
            id: 331,
            task_id: 'task_NwzHF8LSrlf45wYjxEy7fsl4hNY9H0Gi',
            status: 'SUCCESS',
            progress: '100%',
            data: {
              id: 'cgt-20260616174259-bnnbb',
              status: 'succeeded',
              result_url: 'https://cdn.example.test/biyuan-video.mp4',
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const service = new DefaultVideoGenerationService({
      pollIntervalMs: 0,
      timeoutMs: 1000,
    })
    const task = await service.pollVideoTask({
      provider,
      model,
      taskId: 'task_NwzHF8LSrlf45wYjxEy7fsl4hNY9H0Gi',
    })

    expect(task).toMatchObject({
      id: 'task_NwzHF8LSrlf45wYjxEy7fsl4hNY9H0Gi',
      status: 'succeeded',
      progress: 100,
      videoUrl: 'https://cdn.example.test/biyuan-video.mp4',
    })
  })

  it('treats wrapped gateway IN_PROGRESS status as authoritative', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 'success',
            data: {
              id: 347,
              task_id: 'task_qecdOVrdcrHojeJvDcEpjmifGiykse5K',
              status: 'IN_PROGRESS',
              progress: '50%',
              data: {
                id: 'cgt-20260617185000-biyuan',
                status: 'succeeded',
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 'success',
            data: {
              id: 347,
              task_id: 'task_qecdOVrdcrHojeJvDcEpjmifGiykse5K',
              status: 'SUCCESS',
              progress: '100%',
              data: {
                id: 'cgt-20260617185000-biyuan',
                status: 'succeeded',
                result_url: 'https://cdn.example.test/biyuan-video.mp4',
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
    vi.stubGlobal('fetch', fetchMock)

    const service = new DefaultVideoGenerationService({
      pollIntervalMs: 0,
      timeoutMs: 1000,
    })
    const task = await service.pollVideoTask({
      provider,
      model,
      taskId: 'task_qecdOVrdcrHojeJvDcEpjmifGiykse5K',
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(task).toMatchObject({
      id: 'task_qecdOVrdcrHojeJvDcEpjmifGiykse5K',
      status: 'succeeded',
      progress: 100,
      videoUrl: 'https://cdn.example.test/biyuan-video.mp4',
    })
  })
})
