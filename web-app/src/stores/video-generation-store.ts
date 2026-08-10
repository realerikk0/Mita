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
import {
  isRecoverableVideoPollingError,
  normalizeVideoError,
} from '@/services/video-generation/retry-error'
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
const RECOVERY_BACKOFF_MS = [5_000, 10_000, 20_000, 30_000] as const

const VIDEO_GENERATION_FAILED = 'Video generation failed'
const VIDEO_GENERATION_NO_URL =
  'Video generation finished without a playable video URL'
const VIDEO_PROVIDER_UNAVAILABLE =
  'Video provider unavailable — reconnect it to resume, or generate again'
const VIDEO_MODEL_UNAVAILABLE =
  'Video model unavailable — refresh the provider to resume, or generate again'
const VIDEO_TASK_EXPIRED = 'Video task expired — generate it again'

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
  /** Transport health for an already-created provider task. */
  connectionState?: 'connected' | 'reconnecting'
  /** Epoch milliseconds for the next attempt while reconnecting. */
  retryAt?: number
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
  /** Resume polling one existing provider task without submitting a new one. */
  resume: (key: string) => void
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

function waitForRetry(signal: AbortSignal, delayMs: number) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }

    const timeout = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, delayMs)
    const onAbort = () => {
      window.clearTimeout(timeout)
      resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
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
  initialTask?: {
    status: VideoGenerationStatus
    videoUrl?: string
    error?: string
    usage?: unknown
  }
) {
  let completedTask =
    initialTask &&
    (initialTask.status === 'succeeded' || initialTask.status === 'failed')
      ? initialTask
      : undefined
  let recoveryAttempt = 0

  try {
    while (!isSuperseded(key, controller)) {
      const persisted = useVideoGenerationStore.getState().tasks[key]
      if (!persisted) return
      if (Date.now() - persisted.startedAt > MAX_RESUMABLE_AGE_MS) {
        setRuntime(key, {
          status: 'failed',
          connectionState: 'connected',
          retryAt: undefined,
          assetId: persisted.assetId,
          assetKind: assetKindForPersistedTask(persisted),
          startedAt: persisted.startedAt,
          estimateMs: persisted.estimateMs,
          error: VIDEO_TASK_EXPIRED,
        })
        removePersisted(key)
        return
      }
      videoDebugLog('store:finish:start', {
        key,
        taskId: persisted.taskId,
        assetId: persisted.assetId,
        provider: persisted.providerName,
        model: persisted.modelId,
        sourceAssetIds: persisted.sourceAssetIds,
        hasInitialTask: Boolean(initialTask),
        initialTask,
        recoveryAttempt,
      })

      try {
        if (!completedTask) {
          const finalTask = await hub.pollVideoTask({
            provider,
            model,
            taskId: persisted.taskId,
            signal: controller.signal,
          })
          // Some transports can resolve after AbortSignal cancellation. Never
          // let an older poll mutate or download over the replacement task.
          if (isSuperseded(key, controller)) return
          videoDebugLog('store:finish:final-task', {
            key,
            taskId: persisted.taskId,
            finalTask,
          })
          completedTask = finalTask
          recoveryAttempt = 0
        }

        if (completedTask.status === 'failed') {
          const message = completedTask.error || VIDEO_GENERATION_FAILED
          videoDebugError('store:finish:provider-failed', new Error(message), {
            key,
            taskId: persisted.taskId,
          })
          setRuntime(key, {
            status: 'failed',
            connectionState: 'connected',
            retryAt: undefined,
            error: message,
          })
          toast.error(message)
          removePersisted(key)
          return
        }
        if (completedTask.status !== 'succeeded') {
          throw new Error(completedTask.error || VIDEO_GENERATION_FAILED)
        }
        if (!completedTask.videoUrl) {
          videoDebugLog('store:finish:no-video-url', {
            key,
            taskId: persisted.taskId,
            finalTask: completedTask,
          })
          throw new Error(VIDEO_GENERATION_NO_URL)
        }
        setRuntime(key, {
          status: 'running',
          connectionState: 'connected',
          retryAt: undefined,
          error: undefined,
        })

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
          usage: completedTask.usage,
          status: 'succeeded',
          mimeType: 'video/mp4',
          videoUrl: completedTask.videoUrl!,
          extension: videoFileExtension('video/mp4'),
          assetKind: assetKindForPersistedTask(persisted),
        })

        // saveVideoAsset is an un-abortable download; a regenerate/reset may
        // have superseded this run while it was in flight.
        if (isSuperseded(key, controller)) return
        videoDebugLog('store:finish:saved', {
          key,
          taskId: persisted.taskId,
          saved,
        })
        setRuntime(key, {
          status: 'succeeded',
          connectionState: 'connected',
          retryAt: undefined,
          asset: saved,
          error: undefined,
        })
        removePersisted(key)
        window.dispatchEvent(new Event('biyan-media-history-updated'))
        return
      } catch (error) {
        // Aborted/superseded runs (cancel()/reset()/regenerate) already cleaned
        // up and may have started a newer run for this key.
        if (isSuperseded(key, controller)) return

        const normalized = normalizeVideoError(error)
        if (isRecoverableVideoPollingError(normalized)) {
          const delayMs =
            RECOVERY_BACKOFF_MS[
              Math.min(recoveryAttempt, RECOVERY_BACKOFF_MS.length - 1)
            ]!
          const retryAt = Date.now() + delayMs
          videoDebugError('store:finish:reconnecting', normalized, {
            key,
            taskId: persisted.taskId,
            retryAt,
            recoveryAttempt,
          })
          setRuntime(key, {
            status: 'running',
            connectionState: 'reconnecting',
            retryAt,
            error: undefined,
          })
          recoveryAttempt += 1
          await waitForRetry(controller.signal, delayMs)
          if (isSuperseded(key, controller)) return
          setRuntime(key, {
            status: 'running',
            connectionState: 'connected',
            retryAt: undefined,
            error: undefined,
          })
          continue
        }

        videoDebugError('store:finish:failed', normalized, { key })
        console.error('Video generation failed:', normalized)
        setRuntime(key, {
          status: 'failed',
          connectionState: 'connected',
          retryAt: undefined,
          error: normalized.message || VIDEO_GENERATION_FAILED,
        })
        toast.error(normalized.message || VIDEO_GENERATION_FAILED)
        return
      }
    }
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
          connectionState: 'connected',
          retryAt: undefined,
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
              const normalized = normalizeVideoError(error)
              videoDebugError('store:generate:failed', normalized, {
                key: input.key,
                provider: input.provider.provider,
                model: input.model.id,
              })
              console.error('Video generation failed:', normalized)
              const message = normalized.message || VIDEO_GENERATION_FAILED
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

      resume: (key) => {
        if (runners.has(key)) return
        const persisted = get().tasks[key]
        if (!persisted) return

        if (Date.now() - persisted.startedAt > MAX_RESUMABLE_AGE_MS) {
          setRuntime(key, {
            status: 'failed',
            connectionState: 'connected',
            retryAt: undefined,
            assetId: persisted.assetId,
            assetKind: assetKindForPersistedTask(persisted),
            startedAt: persisted.startedAt,
            estimateMs: persisted.estimateMs,
            error: VIDEO_TASK_EXPIRED,
          })
          removePersisted(key)
          return
        }

        const providers = useModelProvider.getState().providers
        const provider = providers.find(
          (item) => item.provider === persisted.providerName
        )
        const model = provider?.models.find(
          (item) => (item.id ?? item.model) === persisted.modelId
        )
        if (!provider) {
          // Keep the descriptor so a later provider refresh can resume it.
          setRuntime(key, {
            status: 'failed',
            connectionState: 'connected',
            retryAt: undefined,
            assetId: persisted.assetId,
            assetKind: assetKindForPersistedTask(persisted),
            startedAt: persisted.startedAt,
            estimateMs: persisted.estimateMs,
            error: VIDEO_PROVIDER_UNAVAILABLE,
          })
          return
        }
        if (!model) {
          // Keep the descriptor so a later provider refresh can resume it.
          setRuntime(key, {
            status: 'failed',
            connectionState: 'connected',
            retryAt: undefined,
            assetId: persisted.assetId,
            assetKind: assetKindForPersistedTask(persisted),
            startedAt: persisted.startedAt,
            estimateMs: persisted.estimateMs,
            error: VIDEO_MODEL_UNAVAILABLE,
          })
          return
        }

        setRuntime(key, {
          status: 'running',
          connectionState: 'connected',
          retryAt: undefined,
          assetId: persisted.assetId,
          assetKind: assetKindForPersistedTask(persisted),
          startedAt: persisted.startedAt,
          estimateMs: persisted.estimateMs,
          asset: undefined,
          error: undefined,
        })

        const controller = new AbortController()
        runners.set(key, controller)
        const hub = getServiceHub().videoGeneration()
        void finishTask(key, provider, model as Model, hub, controller)
      },

      resumeAll: () => {
        for (const key of Object.keys(get().tasks)) get().resume(key)
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
