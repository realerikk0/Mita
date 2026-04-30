import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { predefinedProviders } from '@/constants/providers'
import { route } from '@/constants/routes'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useNavigate } from '@tanstack/react-router'
import { KeyRound, RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import HeaderPage from './HeaderPage'

const JINGXING_PROVIDER = 'jingxing'
const JINGXING_BASE_URL = 'https://api.jingxing.uk/v1'

function withJingxingSettings(provider: ModelProvider, apiKey: string) {
  return {
    ...provider,
    api_key: apiKey.trim(),
    base_url: provider.base_url || JINGXING_BASE_URL,
    active: true,
    settings: provider.settings.map((setting) => {
      if (setting.key === 'api-key') {
        return {
          ...setting,
          controller_props: {
            ...setting.controller_props,
            value: apiKey.trim(),
          },
        }
      }
      if (setting.key === 'base-url') {
        return {
          ...setting,
          controller_props: {
            ...setting.controller_props,
            value: provider.base_url || JINGXING_BASE_URL,
          },
        }
      }
      return setting
    }),
  } satisfies ModelProvider
}

function SetupScreen() {
  const navigate = useNavigate()
  const serviceHub = useServiceHub()
  const {
    addProvider,
    getProviderByName,
    selectModelProvider,
    updateProvider,
  } = useModelProvider()
  const existingProvider = getProviderByName(JINGXING_PROVIDER)
  const predefinedJingxing = useMemo(
    () =>
      predefinedProviders.find(
        (provider) => provider.provider === JINGXING_PROVIDER
      ) as ModelProvider | undefined,
    []
  )
  const provider =
    existingProvider ?? predefinedJingxing
  const [apiKey, setApiKey] = useState(provider?.api_key ?? '')
  const [isConnecting, setIsConnecting] = useState(false)

  const handleConnect = async () => {
    if (!provider) {
      toast.error('Jingxing provider is not available')
      return
    }

    if (!apiKey.trim()) {
      toast.error('Add your Jingxing API token first')
      return
    }

    setIsConnecting(true)
    try {
      const providerWithKey = withJingxingSettings(provider, apiKey)
      const modelIds = await serviceHub
        .providers()
        .fetchModelsFromProvider(providerWithKey)
      const models = modelIds.map((id) => ({
        id,
        model: id,
        name: id,
        displayName: id,
        capabilities: ['completion'],
        version: '1.0',
        provider: JINGXING_PROVIDER,
      })) as Model[]

      const updatedProvider = {
        ...providerWithKey,
        models,
      }

      if (existingProvider) {
        updateProvider(JINGXING_PROVIDER, updatedProvider)
      } else {
        addProvider(updatedProvider)
      }

      if (models[0]) {
        selectModelProvider(JINGXING_PROVIDER, models[0].id)
      }

      toast.success('Jingxing is ready', {
        description: `${models.length} models loaded`,
      })
      navigate({ to: route.home })
    } catch (error) {
      toast.error('Failed to connect Jingxing', {
        description:
          error instanceof Error ? error.message : 'Please check your token',
      })
    } finally {
      setIsConnecting(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <HeaderPage />
      <div className="flex flex-1 items-center justify-center px-4">
        <div className="w-full max-w-md space-y-5">
          <div className="space-y-2 text-center">
            <h1 className="font-studio text-3xl font-medium">Silence</h1>
            <p className="text-sm text-muted-foreground">
              安安静静地完成主人交代的工作
            </p>
          </div>

          <div className="space-y-3 rounded-lg border bg-background p-4 shadow-xs">
            <div className="space-y-1">
              <div className="text-sm font-medium">Jingxing API Token</div>
              <div className="text-xs text-muted-foreground">
                Silence 使用井陉统一入口拉取模型并发起在线聊天。
              </div>
            </div>
            <Input
              type="password"
              value={apiKey}
              placeholder="sk-..."
              onChange={(event) => setApiKey(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  void handleConnect()
                }
              }}
            />
            <Button
              className="w-full"
              disabled={isConnecting}
              onClick={() => void handleConnect()}
            >
              {isConnecting ? (
                <RefreshCw className="size-4 animate-spin" />
              ) : (
                <KeyRound className="size-4" />
              )}
              Connect Jingxing
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default SetupScreen
