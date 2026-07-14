import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useAssistant, defaultAssistant } from '../useAssistant'

const mockCreateAssistant = vi.fn().mockResolvedValue(undefined)
const mockDeleteAssistant = vi.fn().mockResolvedValue(undefined)

vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({
    assistants: () => ({
      createAssistant: mockCreateAssistant,
      deleteAssistant: mockDeleteAssistant,
    }),
  }),
}))

vi.mock('@/constants/localStorage', () => ({
  localStorageKey: {
    lastUsedAssistant: 'last-used-assistant',
    defaultAssistantId: 'default-assistant-id',
    threadManagement: 'thread-management',
  },
}))

describe('useAssistant - coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    act(() => {
      useAssistant.setState({
        assistants: [defaultAssistant],
        currentAssistant: defaultAssistant,
        defaultAssistantId: '',
        loading: true,
      })
    })
  })

  it('should set null assistants and just set loading false', () => {
    const { result } = renderHook(() => useAssistant())

    act(() => {
      result.current.setAssistants(null)
    })

    expect(result.current.loading).toBe(false)
  })

  it('setAssistants should use last used assistant from localStorage', () => {
    localStorage.setItem('last-used-assistant', 'a2')
    const { result } = renderHook(() => useAssistant())

    const assistants = [
      { ...defaultAssistant },
      {
        id: 'a2',
        name: 'A2',
        avatar: '',
        description: '',
        instructions: '',
        created_at: 1,
        parameters: {},
      },
    ]

    act(() => {
      result.current.setAssistants(assistants as any)
    })

    expect(result.current.currentAssistant?.id).toBe('a2')
  })

  it('setAssistants should use default assistant ID from localStorage', () => {
    localStorage.setItem('default-assistant-id', 'a2')
    const { result } = renderHook(() => useAssistant())

    const assistants = [
      { ...defaultAssistant },
      {
        id: 'a2',
        name: 'A2',
        avatar: '',
        description: '',
        instructions: '',
        created_at: 1,
        parameters: {},
      },
    ]

    act(() => {
      result.current.setAssistants(assistants as any)
    })

    expect(result.current.currentAssistant?.id).toBe('a2')
    expect(result.current.defaultAssistantId).toBe('a2')
  })

  it('normalizes a retired default assistant ID in persisted selection', () => {
    localStorage.setItem('last-used-assistant', 'mita')
    const { result } = renderHook(() => useAssistant())

    act(() => {
      result.current.setAssistants([defaultAssistant] as any, {
        mita: 'biyan',
      })
    })

    expect(result.current.currentAssistant?.id).toBe('biyan')
    expect(localStorage.getItem('last-used-assistant')).toBe('biyan')
  })

  it('consumes the Rust-first stock map for Project, last-used and default selections', () => {
    localStorage.setItem('last-used-assistant', 'mita')
    localStorage.setItem('default-assistant-id', 'mita')
    localStorage.setItem(
      'thread-management',
      JSON.stringify({
        state: {
          folders: [
            {
              id: 'project-1',
              name: 'Project',
              updated_at: 1,
              assistantId: 'mita',
            },
          ],
        },
        version: 0,
      })
    )
    const { result } = renderHook(() => useAssistant())

    act(() => {
      result.current.setAssistants([defaultAssistant] as any, {
        mita: 'biyan',
      })
    })

    const stored = JSON.parse(localStorage.getItem('thread-management')!)
    expect(stored.state.folders[0].assistantId).toBe('biyan')
    expect(localStorage.getItem('last-used-assistant')).toBe('biyan')
    expect(localStorage.getItem('default-assistant-id')).toBe('biyan')
    expect(result.current.currentAssistant?.id).toBe('biyan')
  })

  it('preserves a Rust-imported custom assistant in every persisted selection', () => {
    const imported = {
      ...defaultAssistant,
      id: 'legacy-import-jan-0123456789ab',
      name: 'My custom assistant',
      instructions: 'Keep my custom workflow.',
    }
    localStorage.setItem('last-used-assistant', 'jan')
    localStorage.setItem('default-assistant-id', 'jan')
    localStorage.setItem(
      'thread-management',
      JSON.stringify({
        state: {
          folders: [
            {
              id: 'project-1',
              name: 'Project',
              updated_at: 1,
              assistantId: 'jan',
            },
          ],
        },
        version: 0,
      })
    )
    const { result } = renderHook(() => useAssistant())

    act(() => {
      result.current.setAssistants([defaultAssistant, imported] as any, {
        jan: imported.id,
      })
    })

    const stored = JSON.parse(localStorage.getItem('thread-management')!)
    expect(stored.state.folders[0].assistantId).toBe(imported.id)
    expect(localStorage.getItem('last-used-assistant')).toBe(imported.id)
    expect(localStorage.getItem('default-assistant-id')).toBe(imported.id)
    expect(result.current.currentAssistant?.id).toBe(imported.id)
  })

  it('normalizes a Project selection when the legacy assistant is proven stock', () => {
    localStorage.setItem(
      'thread-management',
      JSON.stringify({
        state: {
          folders: [
            {
              id: 'project-1',
              name: 'Project',
              updated_at: 1,
              assistantId: 'mita',
            },
          ],
        },
        version: 0,
      })
    )
    const { result } = renderHook(() => useAssistant())

    act(() => {
      result.current.setAssistants([
        {
          ...defaultAssistant,
          id: 'mita',
          name: 'Mita',
          instructions: 'You are Mita',
        },
      ] as any)
    })

    const stored = JSON.parse(localStorage.getItem('thread-management')!)
    expect(stored.state.folders[0].assistantId).toBe('biyan')
  })

  it('uses an unambiguous Rust imported ID for a custom Project assistant', () => {
    localStorage.setItem(
      'thread-management',
      JSON.stringify({
        state: {
          folders: [
            {
              id: 'project-1',
              name: 'Project',
              updated_at: 1,
              assistantId: 'jan',
            },
          ],
        },
        version: 0,
      })
    )
    const { result } = renderHook(() => useAssistant())

    act(() => {
      result.current.setAssistants([
        defaultAssistant,
        {
          ...defaultAssistant,
          id: 'legacy-import-jan-0123456789ab',
          name: 'Custom Assistant',
          instructions: 'Keep the user custom instructions.',
        },
      ] as any)
    })

    const stored = JSON.parse(localStorage.getItem('thread-management')!)
    expect(stored.state.folders[0].assistantId).toBe(
      'legacy-import-jan-0123456789ab'
    )
  })

  it('clears an unresolved legacy Project assistant instead of guessing biyan', () => {
    localStorage.setItem(
      'thread-management',
      JSON.stringify({
        state: {
          folders: [
            {
              id: 'project-1',
              name: 'Project',
              updated_at: 1,
              assistantId: 'silence',
            },
          ],
        },
        version: 0,
      })
    )
    const { result } = renderHook(() => useAssistant())

    act(() => {
      result.current.setAssistants([defaultAssistant] as any)
    })

    const stored = JSON.parse(localStorage.getItem('thread-management')!)
    expect(stored.state.folders[0]).not.toHaveProperty('assistantId')
  })

  it('setAssistants should fallback to default when last used ID not found', () => {
    localStorage.setItem('last-used-assistant', 'nonexistent')
    const { result } = renderHook(() => useAssistant())

    act(() => {
      result.current.setAssistants([defaultAssistant] as any)
    })

    expect(result.current.currentAssistant?.id).toBe('biyan')
  })

  it('setAssistants handles empty string last used ID', () => {
    localStorage.setItem('last-used-assistant', '')
    const { result } = renderHook(() => useAssistant())

    act(() => {
      result.current.setAssistants([defaultAssistant] as any)
    })

    // When lastUsedId is '', it returns '' which means no assistant selected
    expect(result.current.currentAssistant).toBeUndefined()
  })

  it('should delete current assistant and fallback to default', () => {
    const { result } = renderHook(() => useAssistant())

    const a2 = {
      id: 'a2',
      name: 'A2',
      avatar: '',
      description: '',
      instructions: '',
      created_at: 1,
      parameters: {},
    }
    act(() => {
      result.current.addAssistant(a2 as any)
      result.current.setCurrentAssistant(a2 as any)
    })

    act(() => {
      result.current.deleteAssistant('a2')
    })

    expect(result.current.currentAssistant?.id).toBe('biyan')
  })

  it('should delete the default assistant and reset', () => {
    const { result } = renderHook(() => useAssistant())

    act(() => {
      result.current.setDefaultAssistant('biyan')
    })

    act(() => {
      result.current.deleteAssistant('biyan')
    })

    // defaultAssistantId should reset
    expect(
      result.current.assistants.find((a) => a.id === 'biyan')
    ).toBeUndefined()
  })

  it('setCurrentAssistant should not change if defaultAssistantId matches', () => {
    const { result } = renderHook(() => useAssistant())

    act(() => {
      useAssistant.setState({ defaultAssistantId: 'biyan' })
    })

    const a2 = { id: 'a2', name: 'A2' } as any
    act(() => {
      result.current.setCurrentAssistant(a2)
    })

    // Should not change because current is the default
    expect(result.current.currentAssistant?.id).toBe('biyan')
  })

  it('setCurrentAssistant with saveToStorage false', () => {
    const { result } = renderHook(() => useAssistant())
    const setItemSpy = vi.spyOn(localStorage, 'setItem')

    const a2 = { id: 'a2', name: 'A2' } as any
    act(() => {
      result.current.setCurrentAssistant(a2, false)
    })

    expect(result.current.currentAssistant).toEqual(a2)
    // Should NOT save to localStorage
    expect(setItemSpy).not.toHaveBeenCalledWith('last-used-assistant', 'a2')
  })

  it('setCurrentAssistant does nothing if same assistant', () => {
    const { result } = renderHook(() => useAssistant())

    act(() => {
      result.current.setCurrentAssistant(defaultAssistant as any)
    })

    // Should be the same - no change
    expect(result.current.currentAssistant?.id).toBe('biyan')
  })

  it('setDefaultAssistant should set and persist', () => {
    const { result } = renderHook(() => useAssistant())

    act(() => {
      result.current.setDefaultAssistant('biyan')
    })

    expect(result.current.defaultAssistantId).toBe('biyan')
    expect(result.current.currentAssistant?.id).toBe('biyan')
  })

  it('setDefaultAssistant with non-existent ID', () => {
    const { result } = renderHook(() => useAssistant())

    act(() => {
      result.current.setDefaultAssistant('nonexistent')
    })

    expect(result.current.defaultAssistantId).toBe('nonexistent')
  })

  it('setDefaultAssistant with empty string removes default', () => {
    const { result } = renderHook(() => useAssistant())

    act(() => {
      result.current.setDefaultAssistant('')
    })

    expect(result.current.defaultAssistantId).toBe('')
  })

  it('updateAssistant should not change currentAssistant when different assistant updated', () => {
    const { result } = renderHook(() => useAssistant())

    const a2 = {
      id: 'a2',
      name: 'A2',
      avatar: '',
      description: '',
      instructions: '',
      created_at: 1,
      parameters: {},
    }
    act(() => {
      result.current.addAssistant(a2 as any)
    })

    act(() => {
      result.current.updateAssistant({ ...a2, name: 'Updated A2' } as any)
    })

    // currentAssistant should still point at the legacy default id
    expect(result.current.currentAssistant?.id).toBe('biyan')
  })
})
