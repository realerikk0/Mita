/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute, useSearch } from '@tanstack/react-router'
import ChatInput from '@/containers/ChatInput'
import HeaderPage from '@/containers/HeaderPage'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useTools } from '@/hooks/useTools'
import { cn } from '@/lib/utils'

import { useModelProvider } from '@/hooks/useModelProvider'
import SetupScreen from '@/containers/SetupScreen'
import { route } from '@/constants/routes'
import { providerHasRemoteApiKeys } from '@/lib/provider-api-keys'
import { isVisibleModelProvider } from '@/constants/visible-model-providers'
import {
  getNewChatGreetingText,
  useNewChatGreeting,
} from '@/hooks/useNewChatGreeting'

type ThreadModel = {
  id: string
  provider: string
}

type SearchParams = {
  threadModel?: ThreadModel
}
import { useEffect } from 'react'
import { useThreads } from '@/hooks/useThreads'
import DropdownModelProvider from '@/containers/DropdownModelProvider'

export const Route = createFileRoute(route.home as any)({
  component: Index,
  validateSearch: (search: Record<string, unknown>): SearchParams => {
    const result: SearchParams = {
      threadModel: search.threadModel as ThreadModel | undefined,
    }

    return result
  },
})

function Index() {
  const { t, i18n } = useTranslation()
  const { providers } = useModelProvider()
  const search = useSearch({ from: route.home as any })
  const threadModel = search.threadModel
  const { setCurrentThreadId } = useThreads()
  const greetingIndex = useNewChatGreeting((state) => state.greetingIndex)
  useTools()

  const hasValidProviders = providers.some(
    (provider) =>
      isVisibleModelProvider(provider.provider) &&
      providerHasRemoteApiKeys(provider)
  )

  useEffect(() => {
    setCurrentThreadId(undefined)
  }, [setCurrentThreadId])

  const newChatGreeting = getNewChatGreetingText(
    i18n,
    t('chat:description'),
    greetingIndex
  )

  if (!hasValidProviders) {
    return <SetupScreen />
  }

  return (
    <div className="flex h-full flex-col justify-center">
      <HeaderPage>
        <div className="flex items-center gap-2 w-full">
          <DropdownModelProvider
            model={threadModel}
            useLastUsedModel
            restrictToVisibleProviders
          />
        </div>
      </HeaderPage>
      <div
        className={cn(
          'h-full overflow-y-auto inline-flex flex-col gap-2 justify-center px-3'
        )}
      >
        <div className={cn('mx-auto w-full md:w-4/5 xl:w-4/6 -mt-20')}>
          <div className={cn('text-center mb-4')}>
            <h1 className={cn('text-2xl mt-2 font-studio font-medium')}>
              {newChatGreeting}
            </h1>
          </div>
          <div className="flex-1 shrink-0">
            <ChatInput
              showSpeedToken={false}
              model={threadModel}
              initialMessage={true}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
