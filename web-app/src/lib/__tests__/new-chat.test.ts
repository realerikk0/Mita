import { beforeEach, describe, expect, it, vi } from 'vitest'
import { route } from '@/constants/routes'
import { TEMPORARY_CHAT_ID } from '@/constants/chat'
import { startNewAgentChat, startNewChat } from '../new-chat'
import { refreshNewChatGreeting } from '@/hooks/useNewChatGreeting'
import { useAgentMode } from '@/hooks/useAgentMode'
import { usePrompt } from '@/hooks/usePrompt'

vi.mock('@/hooks/useNewChatGreeting', () => ({
  refreshNewChatGreeting: vi.fn(),
}))

vi.mock('@/hooks/useAgentMode', () => ({
  useAgentMode: {
    getState: vi.fn(),
  },
}))

vi.mock('@/hooks/usePrompt', () => ({
  usePrompt: {
    getState: vi.fn(),
  },
}))

describe('new chat helpers', () => {
  const navigate = vi.fn()
  const removeThread = vi.fn()
  const setAgentMode = vi.fn()
  const setActivePromptKey = vi.fn()
  const resetPrompt = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useAgentMode.getState).mockReturnValue({
      removeThread,
      setAgentMode,
    } as unknown as ReturnType<typeof useAgentMode.getState>)
    vi.mocked(usePrompt.getState).mockReturnValue({
      setActivePromptKey,
      resetPrompt,
    } as unknown as ReturnType<typeof usePrompt.getState>)
  })

  it('refreshes the greeting before starting a normal new chat', () => {
    startNewChat(navigate)

    expect(removeThread).toHaveBeenCalledWith(TEMPORARY_CHAT_ID)
    expect(setActivePromptKey).toHaveBeenCalledWith(TEMPORARY_CHAT_ID)
    expect(resetPrompt).toHaveBeenCalled()
    expect(refreshNewChatGreeting).toHaveBeenCalled()
    expect(navigate).toHaveBeenCalledWith({ to: route.home })
  })

  it('refreshes the greeting before starting a new agent chat', () => {
    startNewAgentChat(navigate)

    expect(setAgentMode).toHaveBeenCalledWith(TEMPORARY_CHAT_ID, true)
    expect(setActivePromptKey).toHaveBeenCalledWith(TEMPORARY_CHAT_ID)
    expect(resetPrompt).toHaveBeenCalled()
    expect(refreshNewChatGreeting).toHaveBeenCalled()
    expect(navigate).toHaveBeenCalledWith({ to: route.home })
  })
})
