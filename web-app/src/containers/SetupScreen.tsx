import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { predefinedProviders } from '@/constants/providers'
import { route } from '@/constants/routes'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useModelProvider } from '@/hooks/useModelProvider'
import { modelDescriptorsToModels } from '@/lib/provider-models'
import {
  mergeProviderCustomHeaders,
  parseProviderConnection,
  providerConnectionHeadersToCustomHeaders,
  type ImportedProviderCustomHeader,
} from '@/lib/provider-connection-import'
import { useNavigate } from '@tanstack/react-router'
import { ExternalLink, KeyRound, RefreshCw, Upload } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import HeaderPage from './HeaderPage'

const DEFAULT_PROVIDER = 'jingxing'
const BIYUAN_CONSOLE_URL = 'https://api.biyuan.ai/console'

const providerLabels: Record<string, string> = {
  jingxing: '彼源 AI',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  openrouter: 'OpenRouter',
  gemini: 'Gemini',
  xai: 'xAI',
  groq: 'Groq',
  mistral: 'Mistral',
  minimax: 'MiniMax',
  huggingface: 'Hugging Face',
  nvidia: 'NVIDIA',
  azure: 'Azure OpenAI',
}

const providerHints: Record<string, string> = {
  jingxing: '推荐：使用彼源 AI 统一入口，一次配置即可使用聚合模型。',
  openrouter: '适合直接使用 OpenRouter 模型路由。',
  openai: '适合直接使用 OpenAI 官方 API。',
  anthropic: '适合直接使用 Claude 官方 API。',
  gemini: '适合直接使用 Gemini OpenAI-compatible API。',
}

function providerLabel(providerName: string) {
  return providerLabels[providerName] ?? providerName
}

function getProviderSettingValue(
  provider: ModelProvider,
  key: string,
  fallback = ''
) {
  const providerFallback = key === 'api-key' ? provider.api_key : provider.base_url
  return (
    provider.settings.find((setting) => setting.key === key)?.controller_props
      ?.value ??
    providerFallback ??
    fallback
  ) as string
}

function withProviderSettings(
  provider: ModelProvider,
  apiKey: string,
  baseUrl: string,
  importedCustomHeaders: ImportedProviderCustomHeader[] = []
) {
  return {
    ...provider,
    api_key: apiKey.trim(),
    base_url: baseUrl.trim(),
    active: true,
    custom_header:
      importedCustomHeaders.length > 0
        ? mergeProviderCustomHeaders(provider.custom_header, importedCustomHeaders)
        : provider.custom_header,
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
            value: baseUrl.trim(),
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

  const availableProviders = useMemo(
    () =>
      predefinedProviders.filter((provider) =>
        provider.settings.some((setting) => setting.key === 'api-key')
      ) as ModelProvider[],
    []
  )
  const [selectedProviderName, setSelectedProviderName] = useState(
    availableProviders.some((provider) => provider.provider === DEFAULT_PROVIDER)
      ? DEFAULT_PROVIDER
      : availableProviders[0]?.provider || ''
  )
  const existingProvider = getProviderByName(selectedProviderName)
  const predefinedProvider = availableProviders.find(
    (provider) => provider.provider === selectedProviderName
  )
  const provider = existingProvider ?? predefinedProvider
  const [apiKey, setApiKey] = useState(provider?.api_key ?? '')
  const [baseUrl, setBaseUrl] = useState(provider?.base_url ?? '')
  const [isConnecting, setIsConnecting] = useState(false)
  const [isImportOpen, setIsImportOpen] = useState(false)
  const [importDraft, setImportDraft] = useState('')
  const [importedCustomHeaders, setImportedCustomHeaders] = useState<
    ImportedProviderCustomHeader[]
  >([])

  useEffect(() => {
    if (!provider) return
    setApiKey(getProviderSettingValue(provider, 'api-key'))
    setBaseUrl(getProviderSettingValue(provider, 'base-url', provider.base_url))
    setImportedCustomHeaders([])
  }, [provider?.provider])

  const handleImportProviderConnection = () => {
    try {
      const importedConnection = parseProviderConnection(importDraft)
      setApiKey(importedConnection.apiKey)
      setBaseUrl(importedConnection.baseUrl)
      setImportedCustomHeaders(
        providerConnectionHeadersToCustomHeaders(importedConnection.headers)
      )
      setImportDraft('')
      setIsImportOpen(false)
      toast.success('配置已导入')
    } catch (error) {
      toast.error('配置格式不正确', {
        description: error instanceof Error ? error.message : undefined,
      })
    }
  }

  const handleConnect = async () => {
    if (!provider) {
      toast.error('Provider is not available')
      return
    }

    if (!apiKey.trim()) {
      toast.error(`Add your ${providerLabel(provider.provider)} API key first`)
      return
    }

    if (!baseUrl.trim()) {
      toast.error(`Add your ${providerLabel(provider.provider)} Base URL first`)
      return
    }

    setIsConnecting(true)
    try {
      const providerWithKey = withProviderSettings(
        provider,
        apiKey,
        baseUrl,
        importedCustomHeaders
      )
      const modelDescriptors = await serviceHub
        .providers()
        .fetchModelsFromProvider(providerWithKey)
      const models = modelDescriptorsToModels(
        provider.provider,
        modelDescriptors
      )

      if (models.length === 0) {
        throw new Error('No models were returned by this provider')
      }

      const updatedProvider = {
        ...providerWithKey,
        models,
      }

      if (existingProvider) {
        updateProvider(provider.provider, updatedProvider)
      } else {
        addProvider(updatedProvider)
      }

      if (models[0]) {
        selectModelProvider(provider.provider, models[0].id)
      }

      toast.success(`${providerLabel(provider.provider)} is ready`, {
        description: `${models.length} models loaded`,
      })
      navigate({ to: route.home })
    } catch (error) {
      toast.error(`Failed to connect ${providerLabel(provider.provider)}`, {
        description:
          error instanceof Error ? error.message : 'Please check your token',
      })
    } finally {
      setIsConnecting(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <Dialog open={isImportOpen} onOpenChange={setIsImportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>导入配置</DialogTitle>
          </DialogHeader>
          <Textarea
            className="min-h-48 font-mono text-xs"
            placeholder="粘贴 AI Provider 配置 JSON"
            value={importDraft}
            onChange={(event) => setImportDraft(event.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setImportDraft('')
                setIsImportOpen(false)
              }}
            >
              取消
            </Button>
            <Button onClick={handleImportProviderConnection}>导入</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <HeaderPage />
      <div className="flex flex-1 items-center justify-center px-4">
        <div className="w-full max-w-md space-y-5">
          <div className="space-y-2 text-center">
            <h1 className="font-studio text-3xl font-medium">彼岩</h1>
            <p className="text-sm text-muted-foreground">
              安安静静地完成主人交代的工作
            </p>
          </div>

          <div className="space-y-3 rounded-lg border bg-background p-4 shadow-xs">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="text-sm font-medium">Model Provider</div>
                <div className="text-xs text-muted-foreground">
                  选择一个服务商，彼岩会拉取可用模型并开始聊天。
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsImportOpen(true)}
              >
                <Upload className="size-4" />
                导入
              </Button>
            </div>
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none"
              value={selectedProviderName}
              onChange={(event) => setSelectedProviderName(event.target.value)}
            >
              {availableProviders.map((candidate) => (
                <option key={candidate.provider} value={candidate.provider}>
                  {providerLabel(candidate.provider)}
                  {candidate.provider === DEFAULT_PROVIDER ? ' (Recommended)' : ''}
                </option>
              ))}
            </select>
            {provider && (
              <div className="space-y-2 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                <div>
                  {providerHints[provider.provider] ??
                    `使用 ${providerLabel(provider.provider)} 的 OpenAI-compatible 接口。`}
                </div>
                {provider.provider === DEFAULT_PROVIDER && (
                  <a
                    className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                    href={BIYUAN_CONSOLE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    没有彼源 AI 账号？前往注册并充值
                    <ExternalLink className="size-3" />
                  </a>
                )}
              </div>
            )}
            <div className="space-y-1">
              <div className="text-sm font-medium">
                {provider ? providerLabel(provider.provider) : 'Provider'} API Key
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
            <div className="space-y-1">
              <div className="text-sm font-medium">Base URL</div>
            </div>
            <Input
              value={baseUrl}
              placeholder={provider?.base_url || 'https://api.example.com/v1'}
              onChange={(event) => setBaseUrl(event.target.value)}
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
              Connect {provider ? providerLabel(provider.provider) : 'Provider'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default SetupScreen
