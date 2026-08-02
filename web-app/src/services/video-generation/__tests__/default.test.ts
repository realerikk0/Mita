import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  SEEDANCE_MULTIMODAL_REFERENCE_CAPABILITIES,
  SeedanceValidationError,
} from '@/lib/seedance-video'
import { ModelCapabilities } from '@/types/models'
import { DefaultVideoGenerationService } from '../default'

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
      content: [
        {
          type: 'text',
          text: 'A gold robot walks through a neon city.',
        },
      ],
      ratio: '16:9',
      duration: 8,
      resolution: '1080p',
      framespersecond: 30,
      generate_audio: true,
      watermark: false,
    })
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

  it('serializes Biyuan storyboard sources through multimodal content', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        })
      )
      .mockResolvedValueOnce(
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

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/mock/mita/image-assets/storyboard-1/image.png'
    )
    const init = fetchMock.mock.calls[1][1] as RequestInit & { body: string }
    const body = JSON.parse(init.body)
    const imageUrl = 'data:image/png;base64,AQID'

    expect(body).toMatchObject({
      model: 'seedance-2.0',
      prompt: 'A gold robot walks through a neon city.',
      size: '1920x1080',
      metadata: {
        ratio: '16:9',
        resolution: '1080p',
        generate_audio: false,
        watermark: false,
      },
    })
    expect(body).not.toHaveProperty('image')
    expect(body.content).toEqual([
      { type: 'text', text: 'A gold robot walks through a neon city.' },
      {
        type: 'image_url',
        image_url: { url: imageUrl },
      },
    ])
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
      provider,
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
        image_url: { url: 'https://assets.example.test/image.png' },
      },
      {
        type: 'video_url',
        video_url: { url: 'https://assets.example.test/video.mp4' },
      },
      {
        type: 'audio_url',
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
    expect(JSON.parse(init.body).content).toEqual([
      { type: 'text', text: 'Animate this clip.' },
      {
        type: 'video_url',
        video_url: { url: 'https://assets.example.test/video.mp4' },
      },
      {
        type: 'audio_url',
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
