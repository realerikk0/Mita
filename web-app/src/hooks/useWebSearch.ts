import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'

type WebSearchState = {
  enabled: boolean
  setEnabled: (enabled: boolean) => void
  toggle: () => void
}

export const useWebSearch = create<WebSearchState>()(
  persist(
    (set, get) => ({
      enabled: false,
      setEnabled: (enabled) => set({ enabled }),
      toggle: () => set({ enabled: !get().enabled }),
    }),
    {
      name: localStorageKey.webSearch,
      storage: createJSONStorage(() => localStorage),
    }
  )
)
