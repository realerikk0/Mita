import { route } from '@/constants/routes'
import { TEMPORARY_CHAT_ID } from '@/constants/chat'
import { useAgentMode } from '@/hooks/useAgentMode'
import { refreshNewChatGreeting } from '@/hooks/useNewChatGreeting'

type NavigateHome = (options: { to: string }) => void | Promise<unknown>

export function startNewChat(navigate: NavigateHome) {
  useAgentMode.getState().removeThread(TEMPORARY_CHAT_ID)
  refreshNewChatGreeting()
  navigate({ to: route.home })
}

export function startNewAgentChat(navigate: NavigateHome) {
  useAgentMode.getState().setAgentMode(TEMPORARY_CHAT_ID, true)
  refreshNewChatGreeting()
  navigate({ to: route.home })
}
