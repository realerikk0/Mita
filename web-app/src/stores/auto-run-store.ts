import { create } from 'zustand'
import {
  DEFAULT_BIYAN_AUTO_RUN,
  type BiyanAutoRunMetadata,
} from '@/types/biyan-agent'

type AutoRunStoreState = {
  runs: Record<string, BiyanAutoRunMetadata>
  getRun: (threadId: string) => BiyanAutoRunMetadata
  setRun: (threadId: string, run: BiyanAutoRunMetadata) => void
  patchRun: (
    threadId: string,
    patch: Partial<BiyanAutoRunMetadata>
  ) => BiyanAutoRunMetadata
  clearRun: (threadId: string) => void
}

export const useAutoRunStore = create<AutoRunStoreState>((set, get) => ({
  runs: {},
  getRun: (threadId) => get().runs[threadId] ?? DEFAULT_BIYAN_AUTO_RUN,
  setRun: (threadId, run) => {
    set((state) => ({
      runs: {
        ...state.runs,
        [threadId]: run,
      },
    }))
  },
  patchRun: (threadId, patch) => {
    const nextRun = {
      ...get().getRun(threadId),
      ...patch,
      updatedAt: new Date().toISOString(),
    }
    get().setRun(threadId, nextRun)
    return nextRun
  },
  clearRun: (threadId) => {
    set((state) => {
      if (!state.runs[threadId]) return state
      const nextRuns = { ...state.runs }
      delete nextRuns[threadId]
      return { runs: nextRuns }
    })
  },
}))
