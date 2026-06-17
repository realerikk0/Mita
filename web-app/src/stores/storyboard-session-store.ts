import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import type { MediaMode, StoryboardSession } from '@/routes/images'

type StoryboardSessionStoreState = {
  /** The last storyboard editing session, restored on mount and app restart. */
  session: StoryboardSession | null
  /** The last media studio mode, so returning lands where the user left off. */
  mediaMode: MediaMode | null
  save: (session: StoryboardSession) => void
  setMediaMode: (mode: MediaMode) => void
  clear: () => void
}

export const useStoryboardSessionStore = create<StoryboardSessionStoreState>()(
  persist(
    (set) => ({
      session: null,
      mediaMode: null,
      save: (session) => set({ session }),
      setMediaMode: (mediaMode) => set({ mediaMode }),
      clear: () => set({ session: null, mediaMode: null }),
    }),
    {
      name: 'mita-storyboard-session',
      storage: createJSONStorage(() => localStorage),
    }
  )
)
