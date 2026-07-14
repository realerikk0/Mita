import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Only mock fileStorage - don't mock zustand/middleware so real persist runs and coverage is tracked
vi.mock('@/lib/fileStorage', () => ({
  fileStorage: {
    getItem: vi.fn().mockReturnValue(null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
}))

import { useLocalApiServer } from '../useLocalApiServer'

describe('useLocalApiServer - coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const store = useLocalApiServer.getState()
    store.setEnableServerToolExecution(false)
  })

  it('should toggle server tool execution', () => {
    const { result } = renderHook(() => useLocalApiServer())

    expect(result.current.enableServerToolExecution).toBe(false)

    act(() => {
      result.current.setEnableServerToolExecution(true)
    })

    expect(result.current.enableServerToolExecution).toBe(true)
  })

  it('drops retired automatic-start and local-model session fields', async () => {
    const migrate = useLocalApiServer.persist.getOptions().migrate
    expect(migrate).toBeTypeOf('function')

    const migrated = await migrate!(
      {
        enableOnStartup: true,
        defaultModelLocalApiServer: { model: 'legacy.gguf' },
        lastServerModels: [{ model: 'legacy.gguf' }],
        serverPort: 1337,
      },
      3
    )

    expect(migrated).toEqual({ serverPort: 1337 })
  })
})
