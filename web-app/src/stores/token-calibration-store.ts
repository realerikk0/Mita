import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { DEFAULT_CHARS_PER_TOKEN } from '@/lib/context-manager'

// Smoothing for the running chars-per-token estimate. 0.3 reacts within a few
// turns without overreacting to a single noisy sample.
const EMA_ALPHA = 0.3
// Ignore tiny requests — their chars/token ratio is dominated by fixed
// formatting overhead and is not representative.
const MIN_TOKENS_FOR_SAMPLE = 50
// Clamp samples to a sane band so a bad usage number can't poison the estimate.
const MIN_CHARS_PER_TOKEN = 1.5
const MAX_CHARS_PER_TOKEN = 10

interface TokenCalibrationState {
  /** modelId -> calibrated chars-per-token (EMA of observed samples). */
  factors: Record<string, number>
  /**
   * Calibrated chars-per-token for a model, or the default prior when the model
   * has no samples yet (cold start) or is unknown.
   */
  getCharsPerToken: (modelId?: string | null) => number
  /**
   * Fold a real observation (input characters we sent, actual input tokens the
   * provider reported) into the per-model EMA.
   */
  recordSample: (
    modelId: string | null | undefined,
    inputChars: number,
    actualInputTokens: number
  ) => void
  /** For a single model, or all when no id is given. */
  reset: (modelId?: string) => void
}

export const useTokenCalibration = create<TokenCalibrationState>()(
  persist(
    (set, get) => ({
      factors: {},

      getCharsPerToken: (modelId) => {
        if (!modelId) return DEFAULT_CHARS_PER_TOKEN
        return get().factors[modelId] ?? DEFAULT_CHARS_PER_TOKEN
      },

      recordSample: (modelId, inputChars, actualInputTokens) => {
        if (!modelId) return
        if (
          !Number.isFinite(inputChars) ||
          !Number.isFinite(actualInputTokens) ||
          inputChars <= 0 ||
          actualInputTokens < MIN_TOKENS_FOR_SAMPLE
        ) {
          return
        }

        const sample = Math.min(
          MAX_CHARS_PER_TOKEN,
          Math.max(MIN_CHARS_PER_TOKEN, inputChars / actualInputTokens)
        )

        set((state) => {
          const prev = state.factors[modelId] ?? DEFAULT_CHARS_PER_TOKEN
          const next = EMA_ALPHA * sample + (1 - EMA_ALPHA) * prev
          return { factors: { ...state.factors, [modelId]: next } }
        })
      },

      reset: (modelId) => {
        if (!modelId) {
          set({ factors: {} })
          return
        }
        set((state) => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { [modelId]: _removed, ...rest } = state.factors
          return { factors: rest }
        })
      },
    }),
    {
      name: localStorageKey.tokenCalibration,
      storage: createJSONStorage(() => localStorage),
    }
  )
)
