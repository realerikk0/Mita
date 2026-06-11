import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import type { SearchMode } from '@/lib/search-decision'

type WebSearchState = {
  enabled: boolean
  mode: SearchMode
  setEnabled: (enabled: boolean) => void
  setMode: (mode: SearchMode) => void
  toggle: () => void
}

export const useWebSearch = create<WebSearchState>()(
  persist(
    (set, get) => ({
      enabled: true,
      mode: 'auto',
      setEnabled: (enabled) =>
        set({
          enabled,
          mode: enabled ? 'auto' : 'off',
        }),
      setMode: (mode) =>
        set({
          mode,
          enabled: mode !== 'off',
        }),
      toggle: () => {
        const enabled = !get().enabled
        set({
          enabled,
          mode: enabled ? 'auto' : 'off',
        })
      },
    }),
    {
      name: localStorageKey.webSearch,
      storage: createJSONStorage(() => localStorage),
    }
  )
)
