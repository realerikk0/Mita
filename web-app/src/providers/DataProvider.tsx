import { useModelProvider } from '@/hooks/useModelProvider'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { openAIProviderSettings, predefinedProviders } from '@/constants/providers'
import { useAppUpdater } from '@/hooks/useAppUpdater'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useMCPServers, DEFAULT_MCP_SETTINGS } from '@/hooks/useMCPServers'
import { useAssistant } from '@/hooks/useAssistant'
import { useNavigate } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useThreads } from '@/hooks/useThreads'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'
import { useAppState } from '@/hooks/useAppState'
import { AppEvent, events } from '@janhq/core'
import { SystemEvent } from '@/types/events'
import { isDev } from '@/lib/utils'
import { invoke } from '@tauri-apps/api/core'
import { providerHasRemoteApiKeys, providerRemoteApiKeyChain } from '@/lib/provider-api-keys'
import {
  applyProviderConnectionToProvider,
  maskProviderConnectionApiKey,
  parseProviderConnectionDeepLink,
  type ParsedProviderConnection,
} from '@/lib/provider-connection-import'
import { getModelCapabilities } from '@/lib/models'
import cloneDeep from 'lodash/cloneDeep'
import { toast } from 'sonner'

type ProviderCustomHeader = {
  header: string
  value: string
}

type RegisterProviderRequest = {
  provider: string
  api_key?: string
  api_keys?: string[]
  base_url?: string
  custom_headers: ProviderCustomHeader[]
  models: string[]
}

async function registerRemoteProvider(provider: ModelProvider) {
  // Skip llamacpp - those are local models
  if (provider.provider === 'llamacpp') return

  const chain = providerRemoteApiKeyChain(provider)
  if (chain.length === 0) {
    console.log(`Provider ${provider.provider} has no API key, skipping registration`)
    return
  }

  const request: RegisterProviderRequest = {
    provider: provider.provider,
    api_key: chain[0],
    api_keys: chain.slice(1),
    base_url: provider.base_url,
    custom_headers: (provider.custom_header || []).map((h) => ({
      header: h.header,
      value: h.value,
    })),
    models: provider.models.map(e => e.id)
  }

  try {
    await invoke('register_provider_config', { request })
    console.log(`Registered remote provider: ${provider.provider}`)
  } catch (error) {
    console.error(`Failed to register provider ${provider.provider}:`, error)
  }
}

// Track which providers have been registered so we can unregister stale ones
let registeredProviderNames = new Set<string>()

const localModelProviderNames = new Set(['llamacpp', 'mlx'])

// Effect to sync remote providers when providers change
const syncRemoteProviders = () => {
  const providers = useModelProvider.getState().providers
  const currentActive = new Set<string>()

  providers.forEach((provider) => {
    if (
      provider.active &&
      provider.provider !== 'llamacpp' &&
      providerHasRemoteApiKeys(provider)
    ) {
      registerRemoteProvider(provider)
      currentActive.add(provider.provider)
    }
  })

  // Unregister providers that were previously registered but are now inactive/removed
  for (const name of registeredProviderNames) {
    if (!currentActive.has(name)) {
      invoke('unregister_provider_config', { provider: name }).catch(() => {})
    }
  }

  registeredProviderNames = currentActive
}

const createProviderForImportedConnection = (
  importedConnection: ParsedProviderConnection
): ModelProvider => {
  const predefinedProvider = predefinedProviders.find(
    (provider) => provider.provider === importedConnection.provider
  )

  if (predefinedProvider) {
    return cloneDeep(predefinedProvider) as ModelProvider
  }

  return {
    active: true,
    provider: importedConnection.provider,
    models: [],
    settings: cloneDeep(openAIProviderSettings) as ProviderSetting[],
    api_key: '',
    base_url: importedConnection.baseUrl,
  }
}

const withProviderModelIds = (
  provider: ModelProvider,
  modelIds: string[]
): ModelProvider => {
  const candidateModelIds = Array.from(
    new Set(modelIds.map((id) => id.trim()).filter(Boolean))
  )
  const existingIds = new Set(provider.models.map((model) => model.id))
  const modelsToAdd = candidateModelIds
    .filter((id) => !existingIds.has(id))
    .map(
      (id) =>
        ({
          id,
          model: id,
          name: id,
          displayName: id,
          capabilities: getModelCapabilities(provider.provider, id),
          version: '1.0',
        }) as Model
    )

  if (modelsToAdd.length === 0) return provider

  return {
    ...provider,
    models: [...provider.models, ...modelsToAdd],
  }
}

const withImportedModels = (
  provider: ModelProvider,
  importedConnection: ParsedProviderConnection,
  modelIds: string[]
): ModelProvider => {
  return withProviderModelIds(provider, [
    ...modelIds,
    importedConnection.defaultModel,
  ])
}

const canRefreshProviderModelsOnStartup = (provider: ModelProvider) =>
  provider.active &&
  !localModelProviderNames.has(provider.provider) &&
  Boolean(provider.base_url?.trim()) &&
  providerHasRemoteApiKeys(provider)

const isStartupNetworkAvailable = () =>
  typeof navigator === 'undefined' || navigator.onLine !== false

const sensitiveDeepLinkQueryParams = ['apiKey', 'api_key', 'key']

const redactDeepLinkForLog = (deeplink: string) => {
  try {
    const url = new URL(deeplink)
    sensitiveDeepLinkQueryParams.forEach((key) => {
      if (url.searchParams.has(key)) {
        url.searchParams.set(key, '***')
      }
    })
    return url.toString()
  } catch {
    return deeplink
  }
}

export function DataProvider() {
  const {
    addProvider,
    getProviderByName,
    selectModelProvider,
    setProviders,
    updateProvider,
  } =
    useModelProvider()
  const [pendingProviderImport, setPendingProviderImport] =
    useState<ParsedProviderConnection | null>(null)
  const [isImportingProvider, setIsImportingProvider] = useState(false)
  const startupModelRefreshStartedRef = useRef(false)

  const { checkForUpdate } = useAppUpdater()
  const { setServers, setSettings } = useMCPServers()
  const { setAssistants } = useAssistant()
  const { setThreads } = useThreads()
  const navigate = useNavigate()
  const serviceHub = useServiceHub()

  // Local API Server hooks
  const {
    enableOnStartup,
    serverHost,
    serverPort,
    setServerPort,
    apiPrefix,
    apiKey,
    trustedHosts,
    corsEnabled,
    verboseLogs,
    proxyTimeout,
    lastServerModels,
    setLastServerModels,
    defaultModelLocalApiServer,
  } = useLocalApiServer()
  const setServerStatus = useAppState((state) => state.setServerStatus)

  const handleDeepLink = useCallback(
    (urls: string[] | null) => {
      if (!urls) return
      console.log('Received deeplink:', urls.map(redactDeepLinkForLog))

      for (const deeplink of urls) {
        try {
          const importedConnection = parseProviderConnectionDeepLink(deeplink)
          if (importedConnection) {
            setPendingProviderImport(importedConnection)
            return
          }
        } catch (error) {
          toast.error('导入链接无效', {
            description: error instanceof Error ? error.message : undefined,
          })
          return
        }
      }

      const deeplink = urls[0]
      if (!deeplink) return

      try {
        const url = new URL(deeplink)
        const params = url.pathname.split('/').filter((str) => str.length > 0)

        if (params.length < 3) return undefined
        // const action = params[0]
        // const provider = params[1]
        const resource = params.slice(1).join('/')
        // return { action, provider, resource }
        navigate({
          to: route.hub.model,
          search: {
            repo: resource,
          },
        })
      } catch {
        return undefined
      }
    },
    [navigate]
  )

  const handleConfirmProviderImport = useCallback(async () => {
    if (!pendingProviderImport) return

    setIsImportingProvider(true)
    let refreshFailed = false

    try {
      const existingProvider = getProviderByName(pendingProviderImport.provider)
      const targetProvider =
        existingProvider ?? createProviderForImportedConnection(pendingProviderImport)
      let importedProvider = applyProviderConnectionToProvider(
        targetProvider,
        pendingProviderImport,
        { active: true }
      )

      await serviceHub
        .providers()
        .updateSettings(importedProvider.provider, importedProvider.settings)

      try {
        const modelIds = await serviceHub
          .providers()
          .fetchModelsFromProvider(importedProvider)
        importedProvider = withImportedModels(
          importedProvider,
          pendingProviderImport,
          modelIds
        )
      } catch (error) {
        refreshFailed = true
        console.warn('Failed to refresh imported provider models:', error)
        importedProvider = withImportedModels(
          importedProvider,
          pendingProviderImport,
          []
        )
      }

      if (existingProvider) {
        updateProvider(importedProvider.provider, importedProvider)
      } else {
        addProvider(importedProvider)
      }

      const defaultModelId = pendingProviderImport.defaultModel
      const selectedModelId =
        importedProvider.models.find((model) => model.id === defaultModelId)
          ?.id ?? importedProvider.models[0]?.id
      if (selectedModelId) {
        selectModelProvider(importedProvider.provider, selectedModelId)
      }

      setPendingProviderImport(null)
      toast.success('配置已导入', {
        description: refreshFailed ? '模型列表刷新失败，可稍后手动刷新。' : undefined,
      })
    } catch (error) {
      toast.error('配置导入失败', {
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setIsImportingProvider(false)
    }
  }, [
    addProvider,
    getProviderByName,
    pendingProviderImport,
    selectModelProvider,
    serviceHub,
    updateProvider,
  ])

  const refreshStartupProviderModels = useCallback(
    async (providers: ModelProvider[]) => {
      if (!isStartupNetworkAvailable()) return providers

      return Promise.all(
        providers.map(async (provider) => {
          if (!canRefreshProviderModelsOnStartup(provider)) return provider

          try {
            const modelIds = await serviceHub
              .providers()
              .fetchModelsFromProvider(provider)
            return withProviderModelIds(provider, modelIds)
          } catch (error) {
            console.warn(
              `Failed to refresh ${provider.provider} models on startup:`,
              error
            )
            return provider
          }
        })
      )
    },
    [serviceHub]
  )

  useEffect(() => {
    let cancelled = false

    console.log('Initializing DataProvider...')
    serviceHub.providers().getProviders().then(async (providers) => {
      if (cancelled) return
      setProviders(providers)
      const hydratedProviders = useModelProvider.getState().providers

      // Register active remote providers with the backend
      hydratedProviders.forEach((provider) => {
        if (provider.active) {
          registerRemoteProvider(provider)
          registeredProviderNames.add(provider.provider)
        }
      })

      if (startupModelRefreshStartedRef.current) return
      startupModelRefreshStartedRef.current = true

      const refreshedProviders =
        await refreshStartupProviderModels(hydratedProviders)
      if (cancelled) return

      const hasRefreshedProvider = refreshedProviders.some(
        (provider, index) => provider !== hydratedProviders[index]
      )
      if (hasRefreshedProvider) {
        setProviders(refreshedProviders)
        syncRemoteProviders()
      }
    })
    serviceHub
      .mcp()
      .getMCPConfig()
      .then((data) => {
        setServers(data.mcpServers ?? {})
        setSettings(data.mcpSettings ?? DEFAULT_MCP_SETTINGS)
      })
    serviceHub
      .assistants()
      .getAssistants()
      .then((data) => {
        // Only update assistants if we have valid data
        if (data && Array.isArray(data) && data.length > 0) {
          setAssistants(data as unknown as Assistant[])
        } else {
          setAssistants(null)
        }
      })
      .catch((error) => {
        console.warn('Failed to load assistants, keeping default:', error)
      })
    serviceHub.deeplink().getCurrent().then(handleDeepLink)
    serviceHub.deeplink().onOpenUrl(handleDeepLink)

    // Listen for deep link events
    let unsubscribe = () => {}
    serviceHub
      .events()
      .listen(SystemEvent.DEEP_LINK, (event) => {
        const deep_link = event.payload as string
        handleDeepLink([deep_link])
      })
      .then((unsub) => {
        unsubscribe = unsub
      })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [
    handleDeepLink,
    refreshStartupProviderModels,
    serviceHub,
    setAssistants,
    setProviders,
    setServers,
    setSettings,
  ])

  useEffect(() => {
    serviceHub
      .threads()
      .fetchThreads()
      .then((threads) => {
        setThreads(threads)
      })
  }, [serviceHub, setThreads])

  // Sync remote providers with backend when providers change
  const providers = useModelProvider.getState().providers
  useEffect(() => {
    syncRemoteProviders()
  }, [providers])

  // Check for app updates - initial check and periodic interval
  useEffect(() => {
    // Only check for updates if the auto updater is not disabled
    // App might be distributed via other package managers
    // or methods that handle updates differently
    if (isDev()) {
      return
    }

    // Initial check on mount
    checkForUpdate()

    // Set up periodic update checks (singleton - only runs in DataProvider)
    const intervalId = setInterval(() => {
      console.log('Periodic update check triggered')
      checkForUpdate()
    }, Number(UPDATE_CHECK_INTERVAL_MS))

    // Cleanup interval on unmount
    return () => {
      clearInterval(intervalId)
    }
  }, [checkForUpdate])

  useEffect(() => {
    events.on(AppEvent.onModelImported, () => {
      serviceHub.providers().getProviders().then((providers) => {
        setProviders(providers)
        syncRemoteProviders()
      })
    })
  }, [serviceHub, setProviders])

  // Auto-start Local API Server on app startup if enabled
  useEffect(() => {
    if (enableOnStartup) {
      // Check if server is already running
      serviceHub
        .app()
        .getServerStatus()
        .then(async (isRunning) => {
          if (isRunning) {
            console.log('Local API Server is already running')
            setServerStatus('running')
            return
          }

          setServerStatus('pending')

          // Start model(s): prefer user-configured default, fall back to last session's models
          const modelsToStart = (() => {
            if (defaultModelLocalApiServer) {
              return [defaultModelLocalApiServer]
            }
            return lastServerModels
          })()

          if (modelsToStart.length > 0) {
            await Promise.allSettled(
              modelsToStart.map(async ({ model, provider: providerName }) => {
                const provider = getProviderByName(providerName)
                if (!provider) return
                try {
                  await serviceHub.models().startModel(provider, model, true)
                  console.log(`Auto-started server model: ${model}`)
                } catch (err) {
                  console.warn(`Failed to auto-start server model ${model}:`, err)
                }
              })
            )
          }

          return window.core?.api
            ?.startServer({
              host: serverHost,
              port: serverPort,
              prefix: apiPrefix,
              apiKey,
              trustedHosts,
              isCorsEnabled: corsEnabled,
              isVerboseEnabled: verboseLogs,
              proxyTimeout: proxyTimeout,
            })
            .then(async (actualPort: number) => {
              // Store the actual port that was assigned (important for mobile with port 0)
              if (actualPort && actualPort !== serverPort) {
                setServerPort(actualPort)
              }
              setServerStatus('running')
              // Persist whichever models are actually running so next startup can restore them
              const activeModels = await serviceHub.models().getActiveModels().catch(() => [] as string[])
              if (activeModels.length > 0) {
                const allProviders = useModelProvider.getState().providers
                const serverModels = activeModels.flatMap((id) => {
                  const p = allProviders.find((p) => p?.models?.some((m: { id: string }) => m.id === id))
                  return p ? [{ model: id, provider: p.provider }] : []
                })
                if (serverModels.length > 0) setLastServerModels(serverModels)
              }
            })
        })
        .catch((error: unknown) => {
          console.error('Failed to start Local API Server on startup:', error)
          setServerStatus('stopped')
        })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceHub])

  return (
    <Dialog
      open={pendingProviderImport !== null}
      onOpenChange={(open) => {
        if (!open && !isImportingProvider) {
          setPendingProviderImport(null)
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>导入 AI 供应商配置</DialogTitle>
        </DialogHeader>
        {pendingProviderImport && (
          <div className="space-y-3 text-sm">
            <div className="rounded-md border bg-muted/30 p-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Provider</span>
                <span className="font-medium">{pendingProviderImport.provider}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Base URL</span>
                <span className="font-mono text-xs break-all text-right">
                  {pendingProviderImport.baseUrl}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">API Key</span>
                <span className="font-mono text-xs">
                  {maskProviderConnectionApiKey(pendingProviderImport.apiKey)}
                </span>
              </div>
              {pendingProviderImport.defaultModel && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Default Model</span>
                  <span className="font-mono text-xs break-all text-right">
                    {pendingProviderImport.defaultModel}
                  </span>
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              来自外部链接。确认后会覆盖当前供应商的 API Key 和 Base URL。
            </p>
          </div>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setPendingProviderImport(null)}
            disabled={isImportingProvider}
          >
            取消
          </Button>
          <Button
            onClick={handleConfirmProviderImport}
            disabled={isImportingProvider || pendingProviderImport === null}
          >
            {isImportingProvider ? '导入中...' : '确认导入'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
