import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  hubForResume: undefined as unknown,
  providersForResume: [] as unknown[],
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({ videoGeneration: () => h.hubForResume }),
}))

vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: { getState: () => ({ providers: h.providersForResume }) },
}))

import { toast } from 'sonner'
import { SEEDANCE_MULTIMODAL_REFERENCE_CAPABILITIES } from '@/lib/seedance-video'
import type { VideoGenerationReference } from '@/services/video-generation/types'
import { useVideoGenerationStore } from '../video-generation-store'

const provider = {
  provider: 'biyuan',
  base_url: 'https://api.biyuan.ai/v1',
  models: [{ id: 'doubao-seedance-2-0' }],
} as unknown as ModelProvider

const model = { id: 'doubao-seedance-2-0' } as unknown as Model

const sourceAsset = {
  id: 'sb1',
  path: '/mock/image-assets/sb1/image.png',
  mimeType: 'image/png',
} as never

const directReferences = [
  {
    kind: 'image',
    role: 'first_frame',
    asset: {
      id: 'reference-image-1',
      path: '/mock/image-assets/reference-image-1/image.png',
      fileName: 'image.png',
      mimeType: 'image/png',
    },
  },
  {
    kind: 'video',
    role: 'reference',
    url: 'https://cdn.example.test/reference-video.mp4',
  },
  {
    kind: 'audio',
    role: 'soundtrack',
    asset: {
      id: 'reference-audio-1',
      path: '/mock/audio-assets/reference-audio-1/audio.mp3',
      fileName: 'audio.mp3',
      mimeType: 'audio/mpeg',
    },
  },
] satisfies VideoGenerationReference[]

function baseInput(key: string) {
  return {
    key,
    assetId: `asset-${key}`,
    provider,
    model,
    prompt: 'a gold robot',
    ratio: '16:9' as const,
    resolution: '720p' as const,
    duration: 6,
    fps: 24,
    generateAudio: false,
    sourceAsset,
    sourceAssetIds: [key],
  }
}

function makeHub(overrides: Record<string, unknown> = {}) {
  return {
    generateVideo: vi.fn().mockResolvedValue({
      id: 'video-task-1',
      status: 'queued',
      progress: 0,
    }),
    pollVideoTask: vi.fn().mockResolvedValue({
      id: 'video-task-1',
      status: 'succeeded',
      progress: 100,
      videoUrl: 'https://cdn.example.test/video.mp4',
      usage: { total_tokens: 15000 },
    }),
    saveVideoAsset: vi
      .fn()
      .mockImplementation((request: Record<string, unknown>) =>
        Promise.resolve({
          ...request,
          createdAt: '2026-06-17T00:00:00Z',
          path: '/mock/video-assets/asset-sb1/video.mp4',
          fileName: 'video.mp4',
        })
      ),
    ...overrides,
  }
}

describe('useVideoGenerationStore', () => {
  beforeEach(() => {
    useVideoGenerationStore.getState().reset()
    h.hubForResume = undefined
    h.providersForResume = []
    vi.clearAllMocks()
  })

  afterEach(() => {
    useVideoGenerationStore.getState().reset()
  })

  it('submits, polls, saves and clears the persisted task on success', async () => {
    const hub = makeHub()
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')

    useVideoGenerationStore.getState().start(baseInput('sb1'), hub as never)

    await vi.waitFor(() =>
      expect(
        useVideoGenerationStore.getState().runtime['sb1']?.status
      ).toBe('succeeded')
    )

    expect(hub.generateVideo).toHaveBeenCalledTimes(1)
    expect(hub.generateVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceAsset,
        references: [
          expect.objectContaining({
            kind: 'image',
            role: 'reference',
            asset: expect.objectContaining({ id: 'sb1' }),
          }),
        ],
      })
    )
    expect(hub.pollVideoTask).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'video-task-1' })
    )
    expect(hub.saveVideoAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'asset-sb1',
        provider: 'biyuan',
        model: 'doubao-seedance-2-0',
        videoUrl: 'https://cdn.example.test/video.mp4',
        usage: { total_tokens: 15000 },
        status: 'succeeded',
        assetKind: 'storyboard',
        sourceAssetIds: ['sb1'],
        references: [
          expect.objectContaining({
            kind: 'image',
            asset: expect.objectContaining({ id: 'sb1' }),
          }),
        ],
      })
    )

    const runtime = useVideoGenerationStore.getState().runtime['sb1']
    expect(runtime?.asset?.path).toBe('/mock/video-assets/asset-sb1/video.mp4')
    // Persisted task is cleared once the asset is saved (idempotent resume).
    expect(useVideoGenerationStore.getState().tasks['sb1']).toBeUndefined()
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'biyan-media-history-updated' })
    )
  })

  it('supports direct generation with mixed references and no source asset', async () => {
    const hub = makeHub()

    useVideoGenerationStore.getState().start(
      {
        key: 'direct-1',
        assetId: 'asset-direct-1',
        provider,
        model,
        prompt: 'a cinematic paper boat',
        ratio: '16:9',
        resolution: '720p',
        duration: 6,
        fps: 24,
        generateAudio: true,
        references: directReferences,
        seedanceReferenceCapabilities:
          SEEDANCE_MULTIMODAL_REFERENCE_CAPABILITIES,
        assetKind: 'generated',
      },
      hub as never
    )

    await vi.waitFor(() =>
      expect(
        useVideoGenerationStore.getState().runtime['direct-1']?.status
      ).toBe('succeeded')
    )

    expect(hub.generateVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        generateAudio: true,
        references: directReferences,
        seedanceReferenceCapabilities:
          SEEDANCE_MULTIMODAL_REFERENCE_CAPABILITIES,
        sourceAsset: undefined,
      })
    )
    expect(hub.saveVideoAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'asset-direct-1',
        assetKind: 'generated',
        references: directReferences,
        sourceAssetIds: ['reference-image-1', 'reference-audio-1'],
      })
    )
  })

  it('fails and toasts when the task finishes without a video URL', async () => {
    const hub = makeHub({
      generateVideo: vi
        .fn()
        .mockResolvedValue({ id: 'video-task-1', status: 'succeeded' }),
    })

    useVideoGenerationStore.getState().start(baseInput('sb1'), hub as never)

    await vi.waitFor(() =>
      expect(
        useVideoGenerationStore.getState().runtime['sb1']?.status
      ).toBe('failed')
    )

    expect(hub.pollVideoTask).not.toHaveBeenCalled()
    expect(hub.saveVideoAsset).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith(
      'Video generation finished without a playable video URL'
    )
    expect(useVideoGenerationStore.getState().tasks['sb1']).toBeUndefined()
  })

  it('surfaces the provider failure detail when polling ends in failed', async () => {
    const hub = makeHub({
      pollVideoTask: vi.fn().mockResolvedValue({
        id: 'video-task-1',
        status: 'failed',
        progress: 100,
        error: '输出视频可能包含敏感内容，请调整提示词后重试',
      }),
    })

    useVideoGenerationStore.getState().start(baseInput('sb1'), hub as never)

    await vi.waitFor(() =>
      expect(
        useVideoGenerationStore.getState().runtime['sb1']?.status
      ).toBe('failed')
    )

    expect(useVideoGenerationStore.getState().runtime['sb1']?.error).toBe(
      '输出视频可能包含敏感内容，请调整提示词后重试'
    )
    expect(toast.error).toHaveBeenCalledWith(
      '输出视频可能包含敏感内容，请调整提示词后重试'
    )
    expect(hub.saveVideoAsset).not.toHaveBeenCalled()
  })

  it('resumes a persisted task after a restart without re-submitting', async () => {
    const hub = makeHub()
    h.hubForResume = hub
    h.providersForResume = [provider]

    // Simulate state rehydrated from localStorage after an app restart:
    // a persisted task with no live runner.
    useVideoGenerationStore.setState({
      tasks: {
        sb2: {
          key: 'sb2',
          assetId: 'asset-sb2',
          taskId: 'video-task-9',
          providerName: 'biyuan',
          modelId: 'doubao-seedance-2-0',
          prompt: 'a gold robot',
          ratio: '16:9',
          resolution: '720p',
          duration: 6,
          fps: 24,
          sourceAssetIds: ['sb2'],
          startedAt: Date.now() - 60_000,
          estimateMs: 540_000,
        },
      },
      runtime: {},
    })

    useVideoGenerationStore.getState().resumeAll()

    await vi.waitFor(() =>
      expect(
        useVideoGenerationStore.getState().runtime['sb2']?.status
      ).toBe('succeeded')
    )

    // Resume must NOT create a new provider task — only poll the existing one.
    expect(hub.generateVideo).not.toHaveBeenCalled()
    expect(hub.pollVideoTask).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'video-task-9' })
    )
    expect(hub.saveVideoAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'asset-sb2',
        sourceAssetIds: ['sb2'],
        assetKind: 'storyboard',
      })
    )
    expect(useVideoGenerationStore.getState().tasks['sb2']).toBeUndefined()
  })

  it('resumes a generated task with its references and asset kind', async () => {
    const hub = makeHub()
    h.hubForResume = hub
    h.providersForResume = [provider]

    useVideoGenerationStore.setState({
      tasks: {
        direct: {
          key: 'direct',
          assetId: 'asset-direct',
          taskId: 'video-task-direct',
          providerName: 'biyuan',
          modelId: 'doubao-seedance-2-0',
          prompt: 'a cinematic paper boat',
          ratio: '16:9',
          resolution: '720p',
          duration: 6,
          fps: 24,
          sourceAssetIds: ['reference-image-1', 'reference-audio-1'],
          references: directReferences,
          assetKind: 'generated',
          startedAt: Date.now() - 60_000,
          estimateMs: 540_000,
        },
      },
      runtime: {},
    })

    useVideoGenerationStore.getState().resumeAll()

    await vi.waitFor(() =>
      expect(
        useVideoGenerationStore.getState().runtime.direct?.status
      ).toBe('succeeded')
    )

    expect(hub.generateVideo).not.toHaveBeenCalled()
    expect(hub.saveVideoAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'asset-direct',
        sourceAssetIds: ['reference-image-1', 'reference-audio-1'],
        references: directReferences,
        assetKind: 'generated',
      })
    )
  })

  it('surfaces a failed runtime when a persisted task model is unavailable', () => {
    const hub = makeHub()
    h.hubForResume = hub
    h.providersForResume = [{ ...provider, models: [] }]

    useVideoGenerationStore.setState({
      tasks: {
        'direct-video:missing-model': {
          key: 'direct-video:missing-model',
          assetId: 'asset-missing-model',
          taskId: 'video-task-missing-model',
          providerName: 'biyuan',
          modelId: 'removed-seedance-model',
          prompt: 'a quiet mountain lake',
          ratio: '16:9',
          resolution: '720p',
          duration: 6,
          fps: 24,
          sourceAssetIds: [],
          assetKind: 'generated',
          startedAt: Date.now() - 60_000,
          estimateMs: 540_000,
        },
      },
      runtime: {},
    })

    useVideoGenerationStore.getState().resumeAll()

    expect(
      useVideoGenerationStore.getState().runtime[
        'direct-video:missing-model'
      ]
    ).toEqual(
      expect.objectContaining({
        status: 'failed',
        assetId: 'asset-missing-model',
        assetKind: 'generated',
        error: expect.stringContaining('Video model unavailable'),
      })
    )
    expect(
      useVideoGenerationStore.getState().tasks[
        'direct-video:missing-model'
      ]
    ).toBeDefined()
    expect(hub.pollVideoTask).not.toHaveBeenCalled()
  })

  it('drops persisted tasks older than the signed-URL lifetime on resume', async () => {
    const hub = makeHub()
    h.hubForResume = hub
    h.providersForResume = [provider]

    useVideoGenerationStore.setState({
      tasks: {
        stale: {
          key: 'stale',
          assetId: 'asset-stale',
          taskId: 'video-task-old',
          providerName: 'biyuan',
          modelId: 'doubao-seedance-2-0',
          prompt: 'old',
          ratio: '16:9',
          resolution: '720p',
          duration: 6,
          fps: 24,
          sourceAssetIds: ['stale'],
          startedAt: Date.now() - 25 * 60 * 60 * 1000,
          estimateMs: 540_000,
        },
      },
      runtime: {},
    })

    useVideoGenerationStore.getState().resumeAll()

    await vi.waitFor(() =>
      expect(useVideoGenerationStore.getState().tasks['stale']).toBeUndefined()
    )
    expect(hub.pollVideoTask).not.toHaveBeenCalled()
  })

  it('does not let a superseded run clobber the run that replaced it', async () => {
    let resolvePollA: (value: unknown) => void = () => {}
    const pollA = new Promise((resolve) => {
      resolvePollA = resolve
    })
    const hub = {
      generateVideo: vi
        .fn()
        .mockResolvedValueOnce({ id: 'task-A', status: 'queued' })
        .mockResolvedValueOnce({ id: 'task-B', status: 'queued' }),
      pollVideoTask: vi
        .fn()
        .mockReturnValueOnce(pollA) // run A's poll hangs until we resolve it
        .mockResolvedValueOnce({
          id: 'task-B',
          status: 'succeeded',
          videoUrl: 'https://cdn.example.test/B.mp4',
          usage: {},
        }),
      saveVideoAsset: vi
        .fn()
        .mockImplementation((request: Record<string, unknown>) =>
          Promise.resolve({
            ...request,
            createdAt: '2026-06-17T00:00:00Z',
            path: `/mock/video-assets/${request.id}/video.mp4`,
            fileName: 'video.mp4',
          })
        ),
    }

    // Run A starts and begins (hanging) poll.
    useVideoGenerationStore.getState().start(baseInput('sb1'), hub as never)
    await vi.waitFor(() =>
      expect(hub.pollVideoTask).toHaveBeenCalledTimes(1)
    )

    // Run B supersedes A for the same key (start() aborts A's controller).
    useVideoGenerationStore
      .getState()
      .start({ ...baseInput('sb1'), assetId: 'asset-B' }, hub as never)
    await vi.waitFor(() =>
      expect(
        useVideoGenerationStore.getState().runtime['sb1']?.asset?.path
      ).toBe('/mock/video-assets/asset-B/video.mp4')
    )

    // A's poll finally resolves succeeded — its finishTask must NOT overwrite B.
    resolvePollA({
      id: 'task-A',
      status: 'succeeded',
      videoUrl: 'https://cdn.example.test/A.mp4',
      usage: {},
    })
    await vi.waitFor(() =>
      expect(hub.saveVideoAsset).toHaveBeenCalledTimes(2)
    )
    await Promise.resolve()

    expect(
      useVideoGenerationStore.getState().runtime['sb1']?.asset?.path
    ).toBe('/mock/video-assets/asset-B/video.mp4')
  })

  it('does not orphan a persisted task when a superseded run resolves late', async () => {
    let resolveGenA: (value: unknown) => void = () => {}
    const genA = new Promise((resolve) => {
      resolveGenA = resolve
    })
    const hub = {
      generateVideo: vi
        .fn()
        .mockReturnValueOnce(genA) // run A's generateVideo hangs
        .mockResolvedValueOnce({ id: 'task-B', status: 'queued' }),
      pollVideoTask: vi.fn().mockResolvedValue({
        id: 'task-B',
        status: 'succeeded',
        videoUrl: 'https://cdn.example.test/B.mp4',
        usage: {},
      }),
      saveVideoAsset: vi
        .fn()
        .mockImplementation((request: Record<string, unknown>) =>
          Promise.resolve({
            ...request,
            createdAt: '2026-06-17T00:00:00Z',
            path: `/mock/video-assets/${request.id}/video.mp4`,
            fileName: 'video.mp4',
          })
        ),
    }

    // Run A starts; its generateVideo hangs (nothing persisted yet).
    useVideoGenerationStore.getState().start(baseInput('sb1'), hub as never)
    await vi.waitFor(() =>
      expect(hub.generateVideo).toHaveBeenCalledTimes(1)
    )

    // Run B supersedes A (start aborts A's controller) and completes.
    useVideoGenerationStore
      .getState()
      .start({ ...baseInput('sb1'), assetId: 'asset-B' }, hub as never)
    await vi.waitFor(() =>
      expect(
        useVideoGenerationStore.getState().runtime['sb1']?.status
      ).toBe('succeeded')
    )
    expect(useVideoGenerationStore.getState().tasks['sb1']).toBeUndefined()

    // A's generateVideo resolves late (its fetch raced the abort and won) — it
    // must NOT re-persist an orphaned task that resumeAll would later resume.
    resolveGenA({ id: 'task-A', status: 'queued' })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(useVideoGenerationStore.getState().tasks['sb1']).toBeUndefined()
  })
})
