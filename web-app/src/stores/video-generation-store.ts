import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { toast } from 'sonner'

import { getServiceHub } from '@/hooks/useServiceHub'
import { useModelProvider } from '@/hooks/useModelProvider'
import {
  createLegacyFallbackStateStorage,
  legacyStorage,
} from '@/legacy_migrations/storage'
import { videoDebugError, videoDebugLog } from '@/lib/video-generation-debug'
import { videoFileExtension } from '@/lib/video-generation'
import type { SeedanceReferenceCapabilities } from '@/lib/seedance-video'
import type { ImageAssetRecord } from '@/services/image-generation/types'
import type {
  VideoAssetKind,
  VideoAssetRecord,
  VideoGenerationReference,
  VideoGenerationService,
  VideoGenerationStatus,
  VideoRatio,
  VideoResolution,
} from '@/services/video-generation/types'

/**
 * Seedance / Biyuan report no real progress (a fixed `50%` while running), so we
 * approximate the bar from elapsed time. Two real runs of a 6s/720p clip took
 * ~8-9 minutes, i.e. roughly 90 seconds of render per second of video.
 */
const RENDER_MS_PER_VIDEO_SECOND = 90_000
const MIN_ESTIMATE_MS = 60_000
/** Drop persisted tasks older than the provider's signed-URL lifetime (24h). */
const MAX_RESUMABLE_AGE_MS = 24 * 60 * 60 * 1000

const VIDEO_GENERATION_FAILED = 'Video generation failed'
const VIDEO_GENERATION_NO_URL =
  'Video generation finished without a playable video URL'
const VIDEO_PROVIDER_UNAVAILABLE =
  'Video provider unavailable — reconnect it to resume, or generate again'
const VIDEO_MODEL_UNAVAILABLE =
  'Video model unavailable — refresh the provider to resume, or generate again'

type VideoHub = Pick<
  VideoGenerationService,
  'generateVideo' | 'pollVideoTask' | 'saveVideoAsset'
>

/** Minimal, serialisable info needed to resume a task after an app restart. */
export type PersistedVideoTask = {
  /** One in-flight video per storyboard image — keyed by its asset id. */
  key: string
  /** Pre-generated id for the saved asset so resume stays idempotent. */
  assetId: string
  taskId: string
  providerName: string
  modelId: string
  prompt: string
  ratio: VideoRatio
  resolution: VideoResolution
  duration: number
  fps: number
  sourceAssetIds: string[]
  references?: VideoGenerationReference[]
  assetKind?: VideoAssetKind
  startedAt: number
  estimateMs: number
}

/** Live, in-memory state surfaced to the UI (never persisted). */
export type VideoRuntime = {
  status: VideoGenerationStatus
  assetId?: string
  assetKind?: VideoAssetKind
  startedAt?: number
  estimateMs?: number
  asset?: VideoAssetRecord
  error?: string
}

export type StartVideoTaskInput = {
  key: string
  assetId: string
  provider: ModelProvider
  model: Model
  prompt: string
  ratio: VideoRatio
  resolution: VideoResolution
  duration: number
  fps: number
  generateAudio: boolean
  /** Legacy single-image input retained for the storyboard flow. */
  sourceAsset?: ImageAssetRecord
  sourceAssetIds?: string[]
  references?: VideoGenerationReference[]
  seedanceReferenceCapabilities?: SeedanceReferenceCapabilities
  assetKind?: VideoAssetKind
}

type VideoGenerationStoreState = {
  /** Resumable in-flight tasks (persisted to localStorage). */
  tasks: Record<string, PersistedVideoTask>
  /** Live status/progress/asset per task key (in-memory only). */
  runtime: Record<string, VideoRuntime>
  start: (input: StartVideoTaskInput, hub: VideoHub) => void
  cancel: (key: string) => void
  /** Re-attach poll loops for tasks persisted before an app restart. */
  resumeAll: () => void
  reset: () => void
}

const runners = new Map<string, AbortController>()

function estimateMsFor(durationSeconds: number) {
  return Math.max(MIN_ESTIMATE_MS, durationSeconds * RENDER_MS_PER_VIDEO_SECOND)
}

function legacyReferenceFor(
  sourceAsset?: ImageAssetRecord
): VideoGenerationReference[] {
  if (!sourceAsset) return []

  return [
    {
      kind: 'image',
      role: 'reference',
      asset: {
        id: sourceAsset.id,
        path: sourceAsset.path,
        fileName: sourceAsset.fileName,
        mimeType: sourceAsset.mimeType,
      },
    },
  ]
}

function referencesForInput(
  input: StartVideoTaskInput
): VideoGenerationReference[] {
  return input.references?.length
    ? input.references
    : legacyReferenceFor(input.sourceAsset)
}

function sourceAssetIdsForInput(
  input: StartVideoTaskInput,
  references: VideoGenerationReference[]
) {
  const ids = new Set(input.sourceAssetIds ?? [])
  if (input.sourceAsset?.id) ids.add(input.sourceAsset.id)
  for (const reference of references) {
    if (reference.asset?.id) ids.add(reference.asset.id)
  }
  return [...ids]
}

function assetKindForInput(input: StartVideoTaskInput): VideoAssetKind {
  // Before direct video generation existed, every task with sourceAsset was a
  // storyboard task. Preserve that default while new callers opt into generated.
  return input.assetKind ?? (input.sourceAsset ? 'storyboard' : 'generated')
}

function assetKindForPersistedTask(task: PersistedVideoTask): VideoAssetKind {
  // Old localStorage records predate assetKind and were all storyboard videos.
  return task.assetKind ??
    (task.sourceAssetIds?.length ? 'storyboard' : 'generated')
}

function setRuntime(key: string, patch: Partial<VideoRuntime>) {
  useVideoGenerationStore.setState((state) => ({
    runtime: {
      ...state.runtime,
      [key]: { ...state.runtime[key], ...patch } as VideoRuntime,
    },
  }))
}

function setPersisted(key: string, task: PersistedVideoTask) {
  useVideoGenerationStore.setState((state) => ({
    tasks: { ...state.tasks, [key]: task },
  }))
}

function removePersisted(key: string) {
  useVideoGenerationStore.setState((state) => {
    if (!(key in state.tasks)) return {}
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [key]: _, ...rest } = state.tasks
    return { tasks: rest }
  })
}

function clearRuntime(key: string) {
  useVideoGenerationStore.setState((state) => {
    if (!(key in state.runtime)) return {}
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [key]: _, ...rest } = state.runtime
    return { runtime: rest }
  })
}

/** True once this run has been aborted or replaced by a newer run for the key. */
function isSuperseded(key: string, controller: AbortController) {
  return controller.signal.aborted || runners.get(key) !== controller
}

/**
 * Poll the provider until the task reaches a terminal state, then download and
 * persist the asset. Shared by the initial `start` and post-restart `resumeAll`.
 */
async function finishTask(
  key: string,
  provider: ModelProvider,
  model: Model,
  hub: VideoHub,
  controller: AbortController,
  initialTask?: { status: VideoGenerationStatus; videoUrl?: string; usage?: unknown }
) {
  try {
    const persisted = useVideoGenerationStore.getState().tasks[key]
    if (!persisted) return
    videoDebugLog('store:finish:start', {
      key,
      taskId: persisted.taskId,
      assetId: persisted.assetId,
      provider: persisted.providerName,
      model: persisted.modelId,
      sourceAssetIds: persisted.sourceAssetIds,
      hasInitialTask: Boolean(initialTask),
      initialTask,
    })

    const finalTask =
      initialTask && initialTask.status === 'succeeded'
        ? initialTask
        : await hub.pollVideoTask({
            provider,
            model,
            taskId: persisted.taskId,
            signal: controller.signal,
          })
    videoDebugLog('store:finish:final-task', {
      key,
      taskId: persisted.taskId,
      finalTask,
    })

    if (finalTask.status !== 'succeeded') {
      throw new Error(VIDEO_GENERATION_FAILED)
    }
    if (!finalTask.videoUrl) {
      videoDebugLog('store:finish:no-video-url', {
        key,
        taskId: persisted.taskId,
        finalTask,
      })
      throw new Error(VIDEO_GENERATION_NO_URL)
    }

    const saved = await hub.saveVideoAsset({
      id: persisted.assetId,
      prompt: persisted.prompt,
      provider: persisted.providerName,
      model: persisted.modelId,
      ratio: persisted.ratio,
      resolution: persisted.resolution,
      duration: persisted.duration,
      fps: persisted.fps,
      sourceAssetIds: persisted.sourceAssetIds,
      references: persisted.references,
      usage: finalTask.usage,
      status: 'succeeded',
      mimeType: 'video/mp4',
      videoUrl: finalTask.videoUrl,
      extension: videoFileExtension('video/mp4'),
      assetKind: assetKindForPersistedTask(persisted),
    })

    // saveVideoAsset is an un-abortable download; a regenerate/reset may have
    // superseded this run while it was in flight — don't clobber the newer run.
    if (isSuperseded(key, controller)) return
    videoDebugLog('store:finish:saved', {
      key,
      taskId: persisted.taskId,
      saved,
    })
    setRuntime(key, { status: 'succeeded', asset: saved, error: undefined })
    removePersisted(key)
    window.dispatchEvent(new Event('biyan-media-history-updated'))
  } catch (error) {
    // Aborted/superseded runs (cancel()/reset()/regenerate) already cleaned up
    // and may have started a newer run for this key — don't touch state.
    if (isSuperseded(key, controller)) return
    videoDebugError('store:finish:failed', error, { key })
    console.error('Video generation failed:', error)
    const message = error instanceof Error ? error.message : VIDEO_GENERATION_FAILED
    setRuntime(key, { status: 'failed', error: message })
    toast.error(message)
    removePersisted(key)
  } finally {
    // Only release the slot if a newer run hasn't already claimed this key.
    if (runners.get(key) === controller) runners.delete(key)
  }
}

export const useVideoGenerationStore = create<VideoGenerationStoreState>()(
  persist(
    (set, get) => ({
      tasks: {},
      runtime: {},

      start: (input, hub) => {
        // Abort any earlier attempt for this storyboard before restarting.
        get().cancel(input.key)
        const references = referencesForInput(input)
        const sourceAssetIds = sourceAssetIdsForInput(input, references)
        const assetKind = assetKindForInput(input)
        videoDebugLog('store:start', {
          key: input.key,
          assetId: input.assetId,
          provider: input.provider.provider,
          baseUrl: input.provider.base_url,
          model: input.model.id,
          ratio: input.ratio,
          resolution: input.resolution,
          duration: input.duration,
          fps: input.fps,
          generateAudio: input.generateAudio,
          sourceAsset: input.sourceAsset
            ? {
                id: input.sourceAsset.id,
                path: input.sourceAsset.path,
                mimeType: input.sourceAsset.mimeType,
                fileName: input.sourceAsset.fileName,
              }
            : undefined,
          references: references.map((reference) => ({
            kind: reference.kind,
            role: reference.role,
            assetId: reference.asset?.id,
            hasUrl: Boolean(reference.url),
          })),
          sourceAssetIds,
          assetKind,
        })

        const startedAt = Date.now()
        const estimateMs = estimateMsFor(input.duration)
        setRuntime(input.key, {
          status: 'running',
          assetId: input.assetId,
          assetKind,
          startedAt,
          estimateMs,
          asset: undefined,
          error: undefined,
        })

        const controller = new AbortController()
        runners.set(input.key, controller)

        void (async () => {
          let initialTask
          try {
            initialTask = await hub.generateVideo({
              provider: input.provider,
              model: input.model,
              prompt: input.prompt,
              ratio: input.ratio,
              duration: input.duration,
              resolution: input.resolution,
              fps: input.fps,
              generateAudio: input.generateAudio,
              references,
              seedanceReferenceCapabilities:
                input.seedanceReferenceCapabilities,
              sourceAsset: input.sourceAsset,
              signal: controller.signal,
            })
          } catch (error) {
            if (!controller.signal.aborted) {
              videoDebugError('store:generate:failed', error, {
                key: input.key,
                provider: input.provider.provider,
                model: input.model.id,
              })
              console.error('Video generation failed:', error)
              const message =
                error instanceof Error ? error.message : VIDEO_GENERATION_FAILED
              setRuntime(input.key, { status: 'failed', error: message })
              toast.error(message)
            }
            if (runners.get(input.key) === controller) {
              runners.delete(input.key)
            }
            return
          }

          // A regenerate/reset may have superseded this run while generateVideo
          // was in flight — its fetch can resolve even after abort. Bail before
          // persisting so we don't orphan the newer run's descriptor.
          if (isSuperseded(input.key, controller)) return
          videoDebugLog('store:generate:task-created', {
            key: input.key,
            initialTask,
          })

          // Persist now that we have a provider task id to resume from.
          setPersisted(input.key, {
            key: input.key,
            assetId: input.assetId,
            taskId: initialTask.id,
            providerName: input.provider.provider,
            modelId: input.model.id,
            prompt: input.prompt,
            ratio: input.ratio,
            resolution: input.resolution,
            duration: input.duration,
            fps: input.fps,
            sourceAssetIds,
            references,
            assetKind,
            startedAt,
            estimateMs,
          })

          await finishTask(
            input.key,
            input.provider,
            input.model,
            hub,
            controller,
            initialTask
          )
        })()
      },

      cancel: (key) => {
        runners.get(key)?.abort()
        runners.delete(key)
        removePersisted(key)
        clearRuntime(key)
      },

      resumeAll: () => {
        const tasks = get().tasks
        const keys = Object.keys(tasks)
        if (keys.length === 0) return

        const providers = useModelProvider.getState().providers
        const hub = getServiceHub().videoGeneration()
        const now = Date.now()

        for (const key of keys) {
          if (runners.has(key)) continue
          const persisted = tasks[key]!

          if (now - persisted.startedAt > MAX_RESUMABLE_AGE_MS) {
            removePersisted(key)
            continue
          }

          const provider = providers.find(
            (item) => item.provider === persisted.providerName
          )
          const model = provider?.models.find(
            (item) => (item.id ?? item.model) === persisted.modelId
          )
          if (!provider) {
            // Provider was removed/disconnected. Surface a recoverable failed
            // state (instead of a permanent fake 'running' with Generate
            // disabled) but keep the task so it resumes if the provider returns.
            setRuntime(key, {
              status: 'failed',
              assetId: persisted.assetId,
              assetKind: assetKindForPersistedTask(persisted),
              startedAt: persisted.startedAt,
              estimateMs: persisted.estimateMs,
              error: VIDEO_PROVIDER_UNAVAILABLE,
            })
            continue
          }
          if (!model) {
            // Keep the descriptor so a later provider refresh can resume it,
            // while surfacing a terminal UI state instead of fake progress.
            setRuntime(key, {
              status: 'failed',
              assetId: persisted.assetId,
              assetKind: assetKindForPersistedTask(persisted),
              startedAt: persisted.startedAt,
              estimateMs: persisted.estimateMs,
              error: VIDEO_MODEL_UNAVAILABLE,
            })
            continue
          }

          setRuntime(key, {
            status: 'running',
            assetId: persisted.assetId,
            assetKind: assetKindForPersistedTask(persisted),
            startedAt: persisted.startedAt,
            estimateMs: persisted.estimateMs,
            asset: undefined,
            error: undefined,
          })

          const controller = new AbortController()
          runners.set(key, controller)
          void finishTask(key, provider, model as Model, hub, controller)
        }
      },

      reset: () => {
        runners.forEach((controller) => controller.abort())
        runners.clear()
        set({ tasks: {}, runtime: {} })
      },
    }),
    {
      name: 'biyan-video-generation-tasks',
      storage: createJSONStorage(() =>
        createLegacyFallbackStateStorage(legacyStorage.videoGenerationTasks)
      ),
      // Only the resumable task descriptors are durable; runtime is rebuilt.
      partialize: (state) => ({ tasks: state.tasks }),
    }
  )
)
