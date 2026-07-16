import type { StateStorage } from 'zustand/middleware'

const LEGACY_STORAGE_KEYS = {
  storyboardSession: 'mita-storyboard-session',
  theme: 'jan-theme',
  videoGenerationDebug: 'mita.videoGeneration.debug',
  videoGenerationTasks: 'mita-video-generation-tasks',
  webSearch: 'mita-web-search',
} as const

function browserStorage(): Storage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

/**
 * Copy a legacy localStorage value to its canonical Biyan key on first read.
 * The old key is deliberately left untouched: migration sources remain
 * read-only and Biyan performs all subsequent writes through the new key.
 */
export function readCanonicalStorageValue(
  canonicalKey: string,
  legacyKeys: readonly string[]
): string | null {
  const storage = browserStorage()
  if (!storage) return null

  try {
    const canonicalValue = storage.getItem(canonicalKey)
    if (canonicalValue !== null) return canonicalValue

    for (const legacyKey of legacyKeys) {
      const legacyValue = storage.getItem(legacyKey)
      if (legacyValue === null) continue

      try {
        storage.setItem(canonicalKey, legacyValue)
      } catch {
        // Loading the read-only source is still safe if the copy is blocked.
      }
      return legacyValue
    }
  } catch {
    return null
  }

  return null
}

export function createLegacyFallbackStateStorage(
  legacyKeys: readonly string[]
): StateStorage {
  return {
    getItem: (canonicalKey) =>
      readCanonicalStorageValue(canonicalKey, legacyKeys),
    setItem: (canonicalKey, value) => {
      browserStorage()?.setItem(canonicalKey, value)
    },
    removeItem: (canonicalKey) => {
      browserStorage()?.removeItem(canonicalKey)
    },
  }
}

export const legacyStorage = {
  storyboardSession: [LEGACY_STORAGE_KEYS.storyboardSession] as const,
  theme: [LEGACY_STORAGE_KEYS.theme] as const,
  videoGenerationDebug: [LEGACY_STORAGE_KEYS.videoGenerationDebug] as const,
  videoGenerationTasks: [LEGACY_STORAGE_KEYS.videoGenerationTasks] as const,
  webSearch: [LEGACY_STORAGE_KEYS.webSearch] as const,
}
