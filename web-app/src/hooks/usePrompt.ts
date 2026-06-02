import { create } from 'zustand'

const MAX_HISTORY_SIZE = 100
const DEFAULT_PROMPT_KEY = '__default__'

const normalizePromptKey = (key?: string) =>
  key && key.trim() ? key : DEFAULT_PROMPT_KEY

const setPromptForKey = (
  promptsByKey: Record<string, string>,
  key: string,
  value: string
) => {
  const next = { ...promptsByKey }
  if (value) {
    next[key] = value
  } else {
    delete next[key]
  }
  return next
}

type PromptStoreState = {
  prompt: string
  promptsByKey: Record<string, string>
  activePromptKey: string
  setActivePromptKey: (key?: string) => void
  setPrompt: (value: string) => void
  resetPrompt: () => void

  // Prompt history for up/down arrow navigation
  promptHistory: string[]
  historyIndex: number
  draftPrompt: string
  addToHistory: (value: string) => void
  navigateHistory: (direction: 'up' | 'down') => void
  resetHistoryNavigation: () => void
}

export const usePrompt = create<PromptStoreState>((set, get) => ({
  prompt: '',
  promptsByKey: {},
  activePromptKey: DEFAULT_PROMPT_KEY,
  setActivePromptKey: (key) => {
    const activePromptKey = normalizePromptKey(key)
    set((state) => ({
      activePromptKey,
      prompt: state.promptsByKey[activePromptKey] ?? '',
      historyIndex: -1,
      draftPrompt: '',
    }))
  },
  setPrompt: (value) => {
    set((state) => ({
      prompt: value,
      promptsByKey: setPromptForKey(
        state.promptsByKey,
        state.activePromptKey,
        value
      ),
    }))
    // Reset history navigation when user types manually
    if (get().historyIndex !== -1) {
      set({ historyIndex: -1 })
    }
  },
  resetPrompt: () =>
    set((state) => ({
      prompt: '',
      promptsByKey: setPromptForKey(
        state.promptsByKey,
        state.activePromptKey,
        ''
      ),
    })),

  // History state
  promptHistory: [],
  historyIndex: -1,
  draftPrompt: '',

  addToHistory: (value) => {
    const trimmed = value.trim()
    if (!trimmed) return
    const { promptHistory } = get()
    // Avoid consecutive duplicates
    if (promptHistory.length > 0 && promptHistory[0] === trimmed) return
    set({
      promptHistory: [trimmed, ...promptHistory].slice(0, MAX_HISTORY_SIZE),
      historyIndex: -1,
    })
  },

  navigateHistory: (direction) => {
    const { promptHistory, historyIndex, prompt, draftPrompt } = get()
    if (promptHistory.length === 0) return

    if (direction === 'up') {
      const nextIndex = historyIndex + 1
      if (nextIndex >= promptHistory.length) return
      // Save current input as draft when first entering history
      const newDraft = historyIndex === -1 ? prompt : draftPrompt
      set({
        historyIndex: nextIndex,
        draftPrompt: newDraft,
        prompt: promptHistory[nextIndex],
        promptsByKey: setPromptForKey(
          get().promptsByKey,
          get().activePromptKey,
          promptHistory[nextIndex]
        ),
      })
    } else {
      // direction === 'down'
      if (historyIndex <= -1) return
      const nextIndex = historyIndex - 1
      if (nextIndex === -1) {
        // Restore draft
        set({
          historyIndex: -1,
          prompt: draftPrompt,
          promptsByKey: setPromptForKey(
            get().promptsByKey,
            get().activePromptKey,
            draftPrompt
          ),
        })
      } else {
        set({
          historyIndex: nextIndex,
          prompt: promptHistory[nextIndex],
          promptsByKey: setPromptForKey(
            get().promptsByKey,
            get().activePromptKey,
            promptHistory[nextIndex]
          ),
        })
      }
    }
  },

  resetHistoryNavigation: () => set({ historyIndex: -1, draftPrompt: '' }),
}))
