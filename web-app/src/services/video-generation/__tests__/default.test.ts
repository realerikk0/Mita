import { afterEach, describe, expect, it, vi } from 'vitest'

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

describe('DefaultVideoGenerationService', () => {
  afterEach(() => {
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
})
