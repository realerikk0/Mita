import { vi } from 'vitest'

export const loadLlamaModel = vi.fn()
export const readGgufMetadata = vi.fn()
export const getModelSize = vi.fn()
export const isModelSupported = vi.fn()
export const unloadLlamaModel = vi.fn()
export const mapOldBackendToNew = vi.fn()
export const findLatestVersionForBackend = vi.fn()
export const prioritizeBackends = vi.fn()
export const checkBackendForUpdates = vi.fn()
export const removeOldBackendVersions = vi.fn()
export const shouldMigrateBackend = vi.fn()
export const handleSettingUpdate = vi.fn()

export function normalizeLlamacppConfig(config: Record<string, unknown>) {
  const parallel = config.parallel
  return {
    ...config,
    parallel:
      parallel === undefined || parallel === null || parallel === ''
        ? 1
        : Number(parallel),
  }
}

export type LlamacppConfig = Record<string, unknown>
export type DownloadItem = Record<string, unknown>
export type ModelConfig = Record<string, unknown>
export type EmbeddingResponse = Record<string, unknown>
export type DeviceList = Record<string, unknown>
export type SystemMemory = Record<string, unknown>
