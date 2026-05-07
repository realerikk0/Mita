import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey, CACHE_EXPIRY_MS } from '@/constants/localStorage'
import { getServiceHub } from '@/hooks/useServiceHub'
import type { CatalogModel } from '@/services/models/types'

type LatestSilenceModelState = {
  model: CatalogModel | null
  lastFetchedAt: number | null
  loading: boolean
  error: boolean
  fetchLatestSilenceModel: (force?: boolean) => Promise<void>
}

export const useLatestSilenceModel = create<LatestSilenceModelState>()(
  persist(
    (set, get) => ({
      model: null,
      lastFetchedAt: null,
      loading: false,
      error: false,
      fetchLatestSilenceModel: async (force = false) => {
        const { lastFetchedAt, loading } = get()

        if (loading) return

        if (
          !force &&
          lastFetchedAt &&
          Date.now() - lastFetchedAt < CACHE_EXPIRY_MS
        ) {
          return
        }

        set({ loading: true, error: false })

        try {
          const result = await getServiceHub()
            .models()
            .fetchLatestSilenceModel()

          if (result) {
            set({
              model: result,
              lastFetchedAt: Date.now(),
              loading: false,
            })
          } else {
            set({ error: true, loading: false })
          }
        } catch {
          set({ error: true, loading: false })
        }
      },
    }),
    {
      name: localStorageKey.latestSilenceModel,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        model: state.model,
        lastFetchedAt: state.lastFetchedAt,
      }),
    }
  )
)
