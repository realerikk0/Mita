import { route } from '@/constants/routes'
import { TEMPORARY_CHAT_ID } from '@/constants/chat'
import { useAgentMode } from '@/hooks/useAgentMode'
import { refreshNewChatGreeting } from '@/hooks/useNewChatGreeting'
import { useModelProvider } from '@/hooks/useModelProvider'
import { usePrompt } from '@/hooks/usePrompt'
import { useThreads } from '@/hooks/useThreads'
import { defaultModel } from '@/lib/models'
import { createDefaultMitaTeamsConfig } from '@/types/mita-teams'

type NavigateHome = (options: { to: string }) => void | Promise<unknown>
type NavigateThread = (options: {
  to: string
  params?: Record<string, string>
}) => void | Promise<unknown>

function clearNewChatPrompt() {
  const promptState = usePrompt.getState()
  promptState.setActivePromptKey(TEMPORARY_CHAT_ID)
  promptState.resetPrompt()
}

export function startNewChat(navigate: NavigateHome) {
  useAgentMode.getState().removeThread(TEMPORARY_CHAT_ID)
  clearNewChatPrompt()
  refreshNewChatGreeting()
  navigate({ to: route.home })
}

export function startNewAgentChat(navigate: NavigateHome) {
  useAgentMode.getState().setAgentMode(TEMPORARY_CHAT_ID, true)
  clearNewChatPrompt()
  refreshNewChatGreeting()
  navigate({ to: route.home })
}

export async function startNewMitaTeams(navigate: NavigateThread) {
  useAgentMode.getState().removeThread(TEMPORARY_CHAT_ID)

  const modelState = useModelProvider.getState()
  const model = {
    id: modelState.selectedModel?.id ?? defaultModel(modelState.selectedProvider),
    provider: modelState.selectedProvider,
  }

  const thread = await useThreads
    .getState()
    .createThread(model, 'Biyan Teams')

  useThreads.getState().updateThread(thread.id, {
    metadata: {
      mitaTeams: createDefaultMitaTeamsConfig(model),
    },
  })

  navigate({
    to: route.threadsDetail,
    params: { threadId: thread.id },
  })
}
