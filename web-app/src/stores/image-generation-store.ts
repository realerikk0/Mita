import { create } from 'zustand'

import type {
  ImageGenerationMode,
  ImageQualityPreset,
  ImageRatio,
} from '@/lib/image-generation'
import type { ImageGenerationRequestErrorDetails } from '@/lib/image-generation-errors'
import type { ProviderQuotaErrorDetails } from '@/lib/provider-quota-error'
import type {
  ImageAssetRecord,
  ImageGenerationStatus,
} from '@/services/image-generation/types'

export type ImageTask = {
  id: string
  batchId: string
  createdAt: string
  prompt: string
  mode: ImageGenerationMode
  providerName: string
  modelId: string
  ratio: ImageRatio
  qualityPreset: ImageQualityPreset
  status: ImageGenerationStatus
  sourceAssetIds: string[]
  message?: string
  quotaError?: ProviderQuotaErrorDetails
  requestError?: ImageGenerationRequestErrorDetails
  retryAvailableAt?: number
  asset?: ImageAssetRecord
}

export type ImageTaskGroup = {
  id: string
  createdAt: string
  prompt: string
  mode: ImageGenerationMode
  providerName: string
  modelId: string
  ratio: ImageRatio
  qualityPreset: ImageQualityPreset
  sourceAssetIds: string[]
  tasks: ImageTask[]
}

type ImageGenerationStoreState = {
  assets: ImageAssetRecord[]
  tasks: ImageTask[]
  setAssets: (assets: ImageAssetRecord[]) => void
  addTasks: (tasks: ImageTask[]) => void
  updateTask: (id: string, patch: Partial<ImageTask>) => void
  upsertAsset: (asset: ImageAssetRecord) => void
  upsertAssets: (assets: ImageAssetRecord[]) => void
  removeAsset: (assetId: string) => void
  registerTaskController: (taskId: string, controller: AbortController) => void
  releaseTaskController: (taskId: string) => void
  cancelTask: (taskId: string, message: string) => void
  isTaskCancelled: (taskId: string) => boolean
  clearTaskCancellation: (taskId: string) => void
  reset: () => void
}

const controllers = new Map<string, AbortController>()
const cancelledTasks = new Set<string>()

export const useImageGenerationStore = create<ImageGenerationStoreState>(
  (set) => ({
    assets: [],
    tasks: [],
    setAssets: (assets) => set({ assets }),
    addTasks: (tasks) =>
      set((state) => ({ tasks: [...tasks, ...state.tasks] })),
    updateTask: (id, patch) =>
      set((state) => ({
        tasks: state.tasks.map((task) =>
          task.id === id ? { ...task, ...patch } : task
        ),
      })),
    upsertAsset: (asset) =>
      set((state) => ({
        assets: [
          asset,
          ...state.assets.filter((item) => item.id !== asset.id),
        ],
      })),
    upsertAssets: (assets) => {
      if (assets.length === 0) return
      const assetIds = new Set(assets.map((asset) => asset.id))
      set((state) => ({
        assets: [
          ...assets,
          ...state.assets.filter((item) => !assetIds.has(item.id)),
        ],
      }))
    },
    removeAsset: (assetId) =>
      set((state) => ({
        assets: state.assets.filter((item) => item.id !== assetId),
      })),
    registerTaskController: (taskId, controller) => {
      controllers.set(taskId, controller)
    },
    releaseTaskController: (taskId) => {
      controllers.delete(taskId)
    },
    cancelTask: (taskId, message) => {
      cancelledTasks.add(taskId)
      controllers.get(taskId)?.abort()
      set((state) => ({
        tasks: state.tasks.map((task) =>
          task.id === taskId
            ? {
                ...task,
                status: 'failed',
                message,
                quotaError: undefined,
                requestError: undefined,
                retryAvailableAt: undefined,
              }
            : task
        ),
      }))
    },
    isTaskCancelled: (taskId) => cancelledTasks.has(taskId),
    clearTaskCancellation: (taskId) => {
      cancelledTasks.delete(taskId)
    },
    reset: () => {
      controllers.forEach((controller) => controller.abort())
      controllers.clear()
      cancelledTasks.clear()
      set({ assets: [], tasks: [] })
    },
  })
)
