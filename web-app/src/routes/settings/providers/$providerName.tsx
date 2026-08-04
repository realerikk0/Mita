import { useEffect, useMemo, useState } from 'react'
import { createFileRoute, Link, useParams } from '@tanstack/react-router'
import { IconLoader, IconRefresh } from '@tabler/icons-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ProviderBalanceCard } from '@/components/ProviderBalanceCard'
import { ProviderQuotaActions } from '@/components/ProviderQuotaActions'
import Capabilities from '@/containers/Capabilities'
import { Card, CardItem } from '@/containers/Card'
import { DialogAddModel } from '@/containers/dialogs/AddModel'
import { DialogDeleteModel } from '@/containers/dialogs/DeleteModel'
import { DialogEditModel } from '@/containers/dialogs/EditModel'
import DeleteProvider from '@/containers/dialogs/DeleteProvider'
import { DynamicControllerSetting } from '@/containers/dynamicControllerSetting'
import { FavoriteModelAction } from '@/containers/FavoriteModelAction'
import HeaderPage from '@/containers/HeaderPage'
import { RenderMarkdown } from '@/containers/RenderMarkdown'
import SettingsMenu from '@/containers/SettingsMenu'
import { route } from '@/constants/routes'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useTranslation } from '@/i18n/react-i18next-compat'
import {
  modelDescriptorsToModels,
  modelIdFromDescriptor,
  providerModelDescriptorHasMetadata,
} from '@/lib/provider-models'
import { providerRemoteApiKeyChain } from '@/lib/provider-api-keys'
import { providerQuotaErrorFromUnknown } from '@/lib/provider-quota-error'
import { getModelDisplayName, getProviderTitle } from '@/lib/utils'
import {
  isRemoteProviderEndpoint,
  RETIRED_LOCAL_PROVIDER_IDS,
} from '@/lib/configured-model-providers'

const LOCAL_ONLY_SETTING_KEYS = new Set([
  'version_backend',
  'device',
  'n_gpu_layers',
  'n_batch',
  'batch_size',
  'ubatch_size',
  'threads',
  'n_threads',
  'n_threads_batch',
  'flash_attn',
  'use_mmap',
  'use_mlock',
  'no_kv_offload',
  'offload_mmproj',
  'cont_batching',
])

export const Route = createFileRoute('/settings/providers/$providerName')({
  component: ProviderDetail,
  validateSearch: (search: Record<string, unknown>): { step?: string } => ({
    step: typeof search.step === 'string' ? search.step : undefined,
  }),
})

function ProviderDetail() {
  const { t } = useTranslation()
  const { providerName } = useParams({ from: Route.id })
  const serviceHub = useServiceHub()
  const { getProviderByName, updateProvider } = useModelProvider()
  const provider = getProviderByName(providerName)
  const [apiKeysDraft, setApiKeysDraft] = useState('')
  const [refreshingModels, setRefreshingModels] = useState(false)

  const retired = RETIRED_LOCAL_PROVIDER_IDS.has(providerName.toLowerCase())
  const remoteSettings = useMemo(
    () =>
      (provider?.settings ?? []).filter(
        (setting) =>
          setting.key !== 'api-key' && !LOCAL_ONLY_SETTING_KEYS.has(setting.key)
      ),
    [provider?.settings]
  )

  useEffect(() => {
    if (provider && !retired) {
      setApiKeysDraft(providerRemoteApiKeyChain(provider).join('\n'))
    }
  }, [provider, retired])

  const commitApiKeys = () => {
    if (!provider || retired) return
    const keys = apiKeysDraft
      .split(/\r?\n/)
      .map((key) => key.trim())
      .filter(Boolean)
    updateProvider(provider.provider, {
      api_key: keys[0] ?? '',
      api_key_fallbacks: keys.slice(1),
    })
  }

  const updateSetting = async (
    settingKey: string,
    value: string | boolean | number
  ) => {
    if (!provider || retired) return
    const settings = provider.settings.map((setting) =>
      setting.key === settingKey
        ? {
            ...setting,
            controller_props: { ...setting.controller_props, value },
          }
        : setting
    )
    const patch: Partial<ModelProvider> = { settings }
    if (settingKey === 'base-url' && typeof value === 'string') {
      patch.base_url = value.trim()
    }
    updateProvider(provider.provider, patch)
    try {
      await serviceHub.providers().updateSettings(provider.provider, settings)
    } catch (error) {
      console.error('Failed to persist provider settings:', error)
      toast.error(t('providers:models'), {
        description: 'Failed to save provider settings.',
      })
    }
  }

  const refreshModels = async () => {
    if (!provider || retired || !isRemoteProviderEndpoint(provider)) {
      toast.error(t('providers:models'), {
        description: t('providers:refreshModelsError'),
      })
      return
    }

    setRefreshingModels(true)
    try {
      const descriptors = await serviceHub
        .providers()
        .fetchModelsFromProvider(provider)
      const fetchedModels = modelDescriptorsToModels(
        provider.provider,
        descriptors,
        provider.base_url
      )
      const fetchedById = new Map(
        fetchedModels.map((candidate) => [candidate.id, candidate])
      )
      const metadataIds = new Set(
        descriptors
          .filter(providerModelDescriptorHasMetadata)
          .map(modelIdFromDescriptor)
      )
      const existingIds = new Set(provider.models.map((model) => model.id))
      const existingModels = provider.models.map((model) => {
        const fetched = fetchedById.get(model.id)
        return fetched && metadataIds.has(model.id)
          ? { ...model, ...fetched, settings: model.settings }
          : model
      })
      const additions = fetchedModels.filter(
        (model) => !existingIds.has(model.id)
      )
      updateProvider(provider.provider, {
        models: [...existingModels, ...additions],
      })
      toast.success(t('providers:models'), {
        description: t('providers:refreshModelsSuccess', {
          count: additions.length,
          provider: provider.provider,
        }),
      })
    } catch (error) {
      const quotaError = providerQuotaErrorFromUnknown(error)
      toast.error(t('providers:models'), {
        description: quotaError ? (
          <ProviderQuotaActions error={quotaError} showMessage />
        ) : (
          t('providers:refreshModelsFailed', { provider: provider.provider })
        ),
      })
    } finally {
      setRefreshingModels(false)
    }
  }

  return (
    <div className="flex h-svh max-h-svh w-full flex-col overflow-hidden">
      <HeaderPage>
        <span className="font-medium text-base font-studio">
          {t('common:settings')}
        </span>
      </HeaderPage>
      <div className="flex min-h-0 flex-1">
        <SettingsMenu />
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 pt-0">
          {retired ? (
            <Card title="Local runtime retired">
              <p className="text-sm leading-relaxed">
                Local model providers are no longer available. Historical model
                metadata remains readable, but you must select a configured
                remote provider before continuing a conversation.
              </p>
              <Button asChild size="sm" className="mt-4">
                <Link to={route.settings.model_providers}>
                  Choose remote provider
                </Link>
              </Button>
            </Card>
          ) : !provider ? (
            <Card title={getProviderTitle(providerName)}>
              <p className="text-sm">Provider not found.</p>
            </Card>
          ) : (
            <div className="flex flex-col gap-3">
              <h1 className="font-medium text-base">
                {getProviderTitle(provider.provider)}
              </h1>

              <Card title={t('common:settings')}>
                <CardItem
                  title="Enable"
                  actions={
                    <Switch
                      aria-label={`Enable ${getProviderTitle(provider.provider)}`}
                      checked={provider.active}
                      onCheckedChange={(active) =>
                        updateProvider(provider.provider, { active })
                      }
                    />
                  }
                />
                {remoteSettings.length === 0 ? (
                  <p className="text-sm">No additional settings.</p>
                ) : (
                  remoteSettings.map((setting) => (
                    <CardItem
                      key={setting.key}
                      title={setting.title}
                      column={
                        setting.controller_type === 'input' &&
                        setting.controller_props.type !== 'number'
                      }
                      description={
                        <RenderMarkdown
                          className="![>p]:text-muted-foreground select-none"
                          content={setting.description}
                        />
                      }
                      actions={
                        <DynamicControllerSetting
                          controllerType={setting.controller_type}
                          controllerProps={setting.controller_props}
                          onChange={(value) =>
                            void updateSetting(setting.key, value)
                          }
                        />
                      }
                    />
                  ))
                )}
                <DeleteProvider provider={provider} />
              </Card>

              <Card title="API keys">
                <CardItem
                  title="Primary and fallback keys"
                  description="Enter one key per line. Keys are tried in order for authentication and quota failures."
                  column
                  actions={
                    <Textarea
                      className="font-mono min-h-24"
                      value={apiKeysDraft}
                      onChange={(event) => setApiKeysDraft(event.target.value)}
                      onBlur={commitApiKeys}
                      placeholder="sk-..."
                      spellCheck={false}
                      autoComplete="off"
                    />
                  }
                />
              </Card>

              <ProviderBalanceCard provider={provider} />

              <Card
                header={
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-foreground font-medium text-base">
                      {t('providers:models')}
                    </h2>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="secondary"
                        size="icon-xs"
                        onClick={() => void refreshModels()}
                        disabled={refreshingModels}
                      >
                        {refreshingModels ? (
                          <IconLoader className="size-4 animate-spin" />
                        ) : (
                          <IconRefresh className="size-4" />
                        )}
                      </Button>
                      <DialogAddModel provider={provider} />
                    </div>
                  </div>
                }
              >
                {provider.models.length === 0 ? (
                  <p className="text-sm">{t('providers:noModelFound')}</p>
                ) : (
                  provider.models.map((model) => (
                    <CardItem
                      key={model.id}
                      title={
                        <div className="flex items-center gap-2">
                          <span className="font-medium line-clamp-1">
                            {getModelDisplayName(model)}
                          </span>
                          <Capabilities capabilities={model.capabilities ?? []} />
                        </div>
                      }
                      actions={
                        <div className="flex items-center gap-1">
                          <DialogEditModel provider={provider} modelId={model.id} />
                          <FavoriteModelAction model={model} />
                          <DialogDeleteModel provider={provider} modelId={model.id} />
                        </div>
                      }
                    />
                  ))
                )}
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
