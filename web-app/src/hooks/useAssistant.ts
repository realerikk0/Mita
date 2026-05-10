import { getServiceHub } from '@/hooks/useServiceHub'
import { Assistant as CoreAssistant } from '@janhq/core'
import { create } from 'zustand'
import { localStorageKey } from '@/constants/localStorage'
import {
  DEFAULT_ASSISTANT_ID,
  LEGACY_DEFAULT_ASSISTANT_IDS,
  MITA_ASSISTANT_DESCRIPTION,
  MITA_ASSISTANT_INSTRUCTIONS,
  ensureMitaIdentityGuard,
  hasLegacyAssistantBranding,
} from '@/lib/mita-prompt'

interface AssistantState {
  assistants: Assistant[]
  currentAssistant: Assistant | undefined
  loading: boolean
  defaultAssistantId: string
  addAssistant: (assistant: Assistant) => void
  updateAssistant: (assistant: Assistant) => void
  deleteAssistant: (id: string) => void
  setCurrentAssistant: (
    assistant: Assistant | undefined,
    saveToStorage?: boolean
  ) => void
  setDefaultAssistant: (id: string) => void
  setAssistants: (assistants: Assistant[] | null) => void
}

const setLastUsedAssistantId = (assistantId: string) => {
  try {
    localStorage.setItem(localStorageKey.lastUsedAssistant, assistantId)
  } catch (error) {
    console.debug('Failed to set last used assistant in localStorage:', error)
  }
}

export const defaultAssistant: Assistant = {
  id: DEFAULT_ASSISTANT_ID,
  name: 'Mita',
  created_at: 1747029866.542,
  parameters: {
    temperature: 0.7,
    top_k: 20,
    top_p: 0.8,
    repeat_penalty: 1.12,
    auto_compact: true,
    auto_compact_threshold: 0.85,
  },
  avatar: '👋',
  description: MITA_ASSISTANT_DESCRIPTION,
  instructions: MITA_ASSISTANT_INSTRUCTIONS,
}

const isLegacyDefaultAssistantId = (id?: string) =>
  !!id && LEGACY_DEFAULT_ASSISTANT_IDS.includes(id)

const normalizeDefaultAssistantBranding = (assistant: Assistant): Assistant => {
  const assistantId = assistant.id?.toString()
  const isDefaultAssistant =
    assistantId === DEFAULT_ASSISTANT_ID ||
    isLegacyDefaultAssistantId(assistantId)
  if (!isDefaultAssistant) return assistant

  const hasLegacyBranding = hasLegacyAssistantBranding(assistant)
  const nextInstructions = hasLegacyBranding
    ? defaultAssistant.instructions
    : ensureMitaIdentityGuard(assistant.instructions)
  const nextName = hasLegacyBranding || !assistant.name
    ? defaultAssistant.name
    : assistant.name
  const nextDescription = hasLegacyBranding || !assistant.description
    ? defaultAssistant.description
    : assistant.description

  if (
    assistant.name === nextName &&
    assistant.description === nextDescription &&
    assistant.instructions === nextInstructions
  ) {
    return assistant
  }

  return {
    ...assistant,
    id: DEFAULT_ASSISTANT_ID,
    name: nextName,
    description: nextDescription,
    instructions: nextInstructions,
  }
}

const dedupeDefaultAssistant = (assistants: Assistant[]): Assistant[] => {
  const result: Assistant[] = []
  let defaultIndex = -1

  for (const assistant of assistants) {
    if (assistant.id === DEFAULT_ASSISTANT_ID) {
      if (defaultIndex === -1) {
        defaultIndex = result.length
        result.push(assistant)
      } else {
        result[defaultIndex] = assistant
      }
      continue
    }
    result.push(assistant)
  }

  if (defaultIndex === -1 && result.length === 0) {
    result.unshift(defaultAssistant)
  }

  return result
}

const getLastUsedAssistantId = (assistants: Assistant[]): string => {
  let lastUsedId
  try {
    lastUsedId = localStorage.getItem(localStorageKey.lastUsedAssistant)
  } catch (error) {
    console.debug('Failed to get last used assistant from localStorage:', error)
  }

  if (isLegacyDefaultAssistantId(lastUsedId ?? undefined)) {
    return defaultAssistant.id
  }

  if (lastUsedId) {
    const lastUsedAssistant = assistants.find((a) => a.id === lastUsedId)
    if (lastUsedAssistant) {
      return lastUsedId
    }
  }

  if (lastUsedId === '') return ''

  return defaultAssistant.id
}

const getDefaultAssistantId = (): string | null => {
  let defaultAssistantId: string | null = null

  try {
    defaultAssistantId = localStorage.getItem(localStorageKey.defaultAssistantId)
  } catch (error) {
    console.debug('Failed to get last used assistant from localStorage:', error)
  }

  return isLegacyDefaultAssistantId(defaultAssistantId ?? undefined)
    ? defaultAssistant.id
    : defaultAssistantId
}

const setDefaultAssistantId = (assistantId: string) => {
  try {
    if (!assistantId) {
      localStorage.removeItem(localStorageKey.defaultAssistantId)
    }
    else {
      localStorage.setItem(localStorageKey.defaultAssistantId, assistantId)
    }
  } catch (error) {
    console.debug('Failed to set default assistant in localStorage:', error)
  }
}

// Platform-aware initial state
const getInitialAssistantState = () => {
  return {
    assistants: [defaultAssistant],
    currentAssistant: defaultAssistant,
    defaultAssistantId: '',
    loading: true,
  }
}

export const useAssistant = create<AssistantState>((set, get) => ({
  ...getInitialAssistantState(),
  addAssistant: (assistant) => {
    set({ assistants: [...get().assistants, assistant] })
    getServiceHub()
      .assistants()
      .createAssistant(assistant as unknown as CoreAssistant)
      .catch((error) => {
        console.error('Failed to create assistant:', error)
      })
  },
  updateAssistant: (assistant) => {
    const state = get()
    set({
      assistants: state.assistants.map((a) =>
        a.id === assistant.id ? assistant : a
      ),
      // Update currentAssistant if it's the same assistant being updated
      currentAssistant:
        state.currentAssistant?.id === assistant.id
          ? assistant
          : state.currentAssistant,
    })
    // Create assistant already cover update logic
    getServiceHub()
      .assistants()
      .createAssistant(assistant as unknown as CoreAssistant)
      .catch((error) => {
        console.error('Failed to update assistant:', error)
      })
  },
  deleteAssistant: (id) => {
    const state = get()
    getServiceHub()
      .assistants()
      .deleteAssistant(
        state.assistants.find((e) => e.id === id) as unknown as CoreAssistant
      )
      .catch((error) => {
        console.error('Failed to delete assistant:', error)
      })

    // Check if we're deleting the current or default assistant
    const wasCurrentAssistant = state.currentAssistant?.id === id
    const wasDefaultAssistant = state.defaultAssistantId === id

    set({ assistants: state.assistants.filter((a) => a.id !== id) })

    // If the deleted assistant was current, fallback to default and update localStorage
    if (wasCurrentAssistant) {
      set({ currentAssistant: state.assistants.find(a => a.id === defaultAssistant.id) })
      setLastUsedAssistantId(defaultAssistant.id)
    }

    // If the deleted assistant was the default, reset to the built-in default
    if (wasDefaultAssistant) {
      setDefaultAssistantId(defaultAssistant.id)
    }
  },
  setDefaultAssistant: (id) => {
    const newAssistant = get().assistants?.find(a => a.id === id)
    if (newAssistant) {
      set({ defaultAssistantId: id, currentAssistant: newAssistant })
      setLastUsedAssistantId(id)
    }
    else {
      set({ defaultAssistantId: id })
    }
    setDefaultAssistantId(id)
  },
  setCurrentAssistant: (assistant, saveToStorage = true) => {
    const currentAssistant = get().currentAssistant
    const defaultAssistantId = get().defaultAssistantId
    if (defaultAssistantId && currentAssistant?.id === defaultAssistantId) return
    if (currentAssistant !== assistant) {
      set({ currentAssistant: assistant })
      if (saveToStorage) {
        setLastUsedAssistantId(assistant?.id || '')
      }
    }
  },
  setAssistants: (assistants) => {
    if (assistants) {
      const normalizedAssistants = dedupeDefaultAssistant(
        assistants.map((a) =>
          normalizeDefaultAssistantBranding({
            ...a,
            id: a.id?.toString(), // new String("id") !== "id"
          })
        )
      )
      const lastUsedId = getLastUsedAssistantId(normalizedAssistants)
      const lastUsedAssist = normalizedAssistants.find((a) => a.id === lastUsedId)
      const defaultAssistantId = getDefaultAssistantId() || ''
      const defaultAssistant = normalizedAssistants.find((a) => a.id === defaultAssistantId)
      set({
        assistants: normalizedAssistants,
        currentAssistant: defaultAssistant || lastUsedAssist,
        defaultAssistantId,
        loading: false
      })
    } else {
      set({ loading: false })
    }
  },
}))
