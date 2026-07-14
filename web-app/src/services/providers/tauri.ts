/**
 * Tauri Providers Service - Desktop implementation
 */

import { predefinedProviders } from '@/constants/providers'
import { providerModels } from '@/constants/models'
import { fetch as fetchTauri } from '@tauri-apps/plugin-http'
import { DefaultProvidersService } from './default'
import { getModelCapabilities } from '@/lib/models'
import type { ProviderModelDescriptor } from '@/lib/provider-models'
import type {
  ProviderBalanceBillingPreference,
  ProviderBalanceLinks,
  ProviderBalanceQuotaWindow,
  ProviderMoneyBalanceTotals,
  ProviderBalanceSubscription,
  ProviderBalanceSubscriptionPlan,
  ProviderBalanceStatus,
  ProviderBalanceTotals,
} from './types'
import { providerRemoteApiKeyChain } from '@/lib/provider-api-keys'
import {
  parseProviderErrorResponse,
  providerQuotaErrorFromUnknown,
} from '@/lib/provider-quota-error'
import {
  BIYUAN_DEFAULT_BASE_URL,
  isBiyuanProvider,
} from '@/constants/biyuan'
import { isRemoteProviderEndpoint } from '@/lib/configured-model-providers'

const tlsCertificateErrorFragments = [
  'certificate',
  'cert',
  'tls',
  'ssl',
  'unknownissuer',
  'unknown issuer',
  'invalid peer certificate',
  'unable to verify',
  'self signed',
  'revocation',
]

const connectionErrorFragments = [
  'fetch',
  'network',
  'dns',
  'connection',
  'connect',
  'timeout',
  'timed out',
  'request error',
  'error sending request',
]

const BALANCE_REQUEST_TIMEOUT_MS = 15_000
const BALANCE_SERVER_ERROR_MAX_ATTEMPTS = 3
const BALANCE_SERVER_ERROR_RETRY_BASE_MS = 300
const BIYUAN_STATUS_REQUEST_TIMEOUT_MS = 2_500

function errorMessageFromUnknown(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error'
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function includesAnyFragment(message: string, fragments: string[]) {
  const normalized = message.toLowerCase()
  return fragments.some((fragment) => normalized.includes(fragment))
}

function providerModelDescriptorFromUnknown(
  value: unknown
): ProviderModelDescriptor | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? trimmed : null
  }
  if (!value || typeof value !== 'object') return null

  const record = value as Record<string, unknown>
  const id =
    typeof record.id === 'string'
      ? record.id.trim()
      : typeof record.model === 'string'
        ? record.model.trim()
        : ''
  if (!id) return null

  const meaningfulKeys = Object.entries(record).filter(
    ([, recordValue]) => recordValue !== undefined && recordValue !== null
  )
  if (
    meaningfulKeys.length === 1 &&
    (meaningfulKeys[0]?.[0] === 'id' || meaningfulKeys[0]?.[0] === 'model')
  ) {
    return id
  }

  return { ...record, id } as ProviderModelDescriptor
}

function providerModelDescriptorsFromArray(
  values: unknown[]
): ProviderModelDescriptor[] {
  return values
    .map(providerModelDescriptorFromUnknown)
    .filter((model): model is ProviderModelDescriptor => Boolean(model))
}

function providerSettingValue(
  provider: ModelProvider,
  keys: string[]
): string {
  const setting = provider.settings?.find((item) => keys.includes(item.key))
  const value = setting?.controller_props?.value
  return typeof value === 'string' ? value.trim() : ''
}

function ensureUrlProtocol(value: string) {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

function joinUrl(baseUrl: string, path: string) {
  return `${ensureUrlProtocol(baseUrl)}${path.startsWith('/') ? path : `/${path}`}`
}

function balanceBaseUrl(provider: ModelProvider) {
  return ensureUrlProtocol(provider.base_url ?? '')
}

function urlOrigin(value: string) {
  try {
    const url = new URL(ensureUrlProtocol(value))
    url.pathname = ''
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return ''
  }
}

function biyuanOriginUrl(provider: ModelProvider) {
  return urlOrigin(balanceBaseUrl(provider) || BIYUAN_DEFAULT_BASE_URL)
}

function biyuanPortalOriginFromApiOrigin(origin: string) {
  try {
    const url = new URL(origin)
    const hostname = url.hostname.toLowerCase()
    if (
      hostname === 'api.biyuan.ai' ||
      hostname === 'api.jingxing.io' ||
      hostname === 'api.jingxing.uk'
    ) {
      url.hostname = hostname.replace(/^api\./, '')
      url.pathname = ''
      url.search = ''
      url.hash = ''
      return url.toString().replace(/\/$/, '')
    }
  } catch {
    return ''
  }
  return ''
}

function biyuanV1BaseUrl(provider: ModelProvider) {
  const baseUrl = balanceBaseUrl(provider)
  if (!baseUrl) {
    return BIYUAN_DEFAULT_BASE_URL
  }

  try {
    const url = new URL(baseUrl)
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts.at(-1)?.toLowerCase() !== 'v1') {
      url.pathname = `/${[...parts, 'v1'].join('/')}`
    }
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    if (/\/v1$/i.test(baseUrl)) return baseUrl
    return joinUrl(baseUrl, '/v1')
  }
}

function biyuanBalanceUrl(provider: ModelProvider) {
  return joinUrl(biyuanV1BaseUrl(provider), '/balance')
}

function biyuanBaseUrlWithoutTrailingV1(provider: ModelProvider) {
  const baseUrl = balanceBaseUrl(provider) || BIYUAN_DEFAULT_BASE_URL
  try {
    const url = new URL(baseUrl)
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts.at(-1)?.toLowerCase() === 'v1') {
      parts.pop()
    }
    url.pathname = parts.length ? `/${parts.join('/')}` : ''
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return baseUrl.replace(/\/v1$/i, '')
  }
}

function biyuanStatusUrl(provider: ModelProvider) {
  const origin = biyuanOriginUrl(provider)
  return joinUrl(
    biyuanPortalOriginFromApiOrigin(origin) ||
      biyuanBaseUrlWithoutTrailingV1(provider),
    '/api/status'
  )
}

function biyuanLegacyTokenUsageUrl(provider: ModelProvider) {
  return joinUrl(biyuanBaseUrlWithoutTrailingV1(provider), '/api/usage/token/')
}

function deepSeekBalanceUrl(provider: ModelProvider) {
  const baseUrl = balanceBaseUrl(provider).replace(/\/v1$/i, '')
  return joinUrl(baseUrl, '/user/balance')
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function numericValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function totalsFromRecord(
  record: Record<string, unknown>,
  keys: { available: string; used?: string; total?: string }
): ProviderBalanceTotals | undefined {
  const available = numericValue(record[keys.available])
  if (available === undefined) return undefined
  const used = keys.used ? numericValue(record[keys.used]) : undefined
  const total = keys.total ? numericValue(record[keys.total]) : undefined
  return {
    available,
    ...(used !== undefined ? { used } : {}),
    ...(total !== undefined ? { total } : {}),
  }
}

type BiyuanQuotaDisplaySettings = {
  quotaPerUnit: number
  currency: 'USD' | 'CNY'
  usdExchangeRate?: number
}

function biyuanQuotaDisplaySettingsFrom(
  response: Record<string, unknown>
): BiyuanQuotaDisplaySettings | undefined {
  const nestedData = asRecord(response.data)
  const data = Object.keys(nestedData).length ? nestedData : response
  const quotaPerUnit = numericValue(data.quota_per_unit)
  if (!quotaPerUnit || quotaPerUnit <= 0) return undefined

  const displayType = stringValue(data.quota_display_type)?.toLowerCase()
  if (displayType === 'cny' || displayType === 'rmb') {
    const usdExchangeRate = numericValue(data.usd_exchange_rate)
    if (!usdExchangeRate || usdExchangeRate <= 0) return undefined
    return {
      quotaPerUnit,
      currency: 'CNY',
      usdExchangeRate,
    }
  }

  return {
    quotaPerUnit,
    currency: 'USD',
  }
}

function moneyTotalsFromBiyuanQuota(
  quotaTotals?: ProviderBalanceTotals,
  settings?: BiyuanQuotaDisplaySettings
): ProviderMoneyBalanceTotals | undefined {
  if (!quotaTotals || !settings) return undefined

  const convert = (value: number) => {
    const usd = value / settings.quotaPerUnit
    return settings.currency === 'CNY'
      ? usd * (settings.usdExchangeRate ?? 1)
      : usd
  }

  return {
    available: convert(quotaTotals.available),
    ...(quotaTotals.used !== undefined
      ? { used: convert(quotaTotals.used) }
      : {}),
    ...(quotaTotals.total !== undefined
      ? { total: convert(quotaTotals.total) }
      : {}),
    currency: settings.currency,
  }
}

function linksFromUnknown(value: unknown): ProviderBalanceLinks | undefined {
  const record = asRecord(value)
  const links: ProviderBalanceLinks = {}
  for (const key of ['billing', 'topup', 'tokens', 'dashboard'] as const) {
    if (typeof record[key] === 'string' && record[key].trim()) {
      links[key] = record[key].trim()
    }
  }
  return Object.keys(links).length > 0 ? links : undefined
}

function tokenLimitFromBiyuan(data: Record<string, unknown>) {
  const available = numericValue(data.total_available)
  const used = numericValue(data.total_used)
  const total = numericValue(data.total_granted)
  const status = numericValue(data.token_status)
  const expiresAt = numericValue(data.expires_at)
  const modelLimitsRecord = asRecord(data.model_limits)
  const modelLimits = Object.keys(modelLimitsRecord).length
    ? (modelLimitsRecord as Record<string, boolean>)
    : undefined
  const hasQuota =
    available !== undefined || used !== undefined || total !== undefined
  const hasMeta =
    status !== undefined ||
    expiresAt !== undefined ||
    data.unlimited_quota === true ||
    data.unlimited_quota === false ||
    data.model_limits_enabled === true ||
    modelLimits !== undefined

  if (!hasQuota && !hasMeta) {
    return undefined
  }

  if (data.unlimited_quota === true) {
    return {
      unlimited: true,
      ...(status !== undefined ? { status } : {}),
      ...(expiresAt !== undefined ? { expiresAt } : {}),
      ...(data.model_limits_enabled === true ? { modelLimitsEnabled: true } : {}),
      ...(modelLimits ? { modelLimits } : {}),
    }
  }

  return {
    ...(available !== undefined ? { available } : {}),
    ...(used !== undefined ? { used } : {}),
    ...(total !== undefined ? { total } : {}),
    ...(data.unlimited_quota === false ? { unlimited: false } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    ...(data.model_limits_enabled === true ? { modelLimitsEnabled: true } : {}),
    ...(modelLimits ? { modelLimits } : {}),
  }
}

const biyuanBillingPreferences = new Set<ProviderBalanceBillingPreference>([
  'subscription_first',
  'wallet_first',
  'subscription_only',
  'wallet_only',
])

function biyuanBillingPreferenceFrom(
  value: unknown
): ProviderBalanceBillingPreference | undefined {
  const preference = stringValue(value)
  return preference &&
    biyuanBillingPreferences.has(preference as ProviderBalanceBillingPreference)
    ? (preference as ProviderBalanceBillingPreference)
    : undefined
}

function quotaWindowFromBiyuan(value: unknown): ProviderBalanceQuotaWindow {
  const record = asRecord(value)
  const limit = numericValue(record.limit)
  const used = numericValue(record.used)
  const available = numericValue(record.available)
  const resetAt = numericValue(record.reset_at)
  const availablePercent =
    available !== undefined && limit !== undefined && limit > 0
      ? available / limit
      : undefined

  return {
    ...(limit !== undefined ? { limit } : {}),
    ...(used !== undefined ? { used } : {}),
    ...(available !== undefined ? { available } : {}),
    ...(resetAt !== undefined ? { resetAt } : {}),
    ...(availablePercent !== undefined ? { availablePercent } : {}),
  }
}

function stringArrayFromUnknown(value: unknown) {
  return Array.isArray(value)
    ? value.map(stringValue).filter((item): item is string => Boolean(item))
    : []
}

function subscriptionPlanFromBiyuan(
  value: unknown
): ProviderBalanceSubscriptionPlan | undefined {
  const record = asRecord(value)
  if (!Object.keys(record).length) return undefined
  const plan = asRecord(record.plan)
  const subscription = asRecord(record.subscription)
  const usage = asRecord(record.usage)
  const entitlements = asRecord(usage.entitlements)
  const title =
    stringValue(plan.title) ??
    stringValue(plan.plan_code)
  if (!title) return undefined
  const planCode = stringValue(plan.plan_code)
  const startTime = numericValue(subscription.start_time)
  const endTime = numericValue(subscription.end_time)
  const status = stringValue(subscription.status)

  return {
    title,
    ...(planCode ? { planCode } : {}),
    ...(startTime !== undefined ? { startTime } : {}),
    ...(endTime !== undefined ? { endTime } : {}),
    ...(status ? { status } : {}),
    weeklyWindow: quotaWindowFromBiyuan(usage.weekly_window),
    fiveHourWindow: quotaWindowFromBiyuan(usage.five_hour_window),
    features: stringArrayFromUnknown(entitlements.features),
  }
}

function subscriptionFromBiyuan(
  value: unknown
): ProviderBalanceSubscription | undefined {
  const record = asRecord(value)
  if (!Object.keys(record).length) return undefined
  const billingPreference = biyuanBillingPreferenceFrom(
    record.billing_preference
  )
  const subscriptions = Array.isArray(record.subscriptions)
    ? record.subscriptions
        .map(subscriptionPlanFromBiyuan)
        .filter(
          (item): item is ProviderBalanceSubscriptionPlan => Boolean(item)
        )
    : []

  return {
    active: record.active === true,
    ...(billingPreference ? { billingPreference } : {}),
    subscriptions,
  }
}

function messageFromProviderErrorBody(value: unknown) {
  const record = asRecord(value)
  const error = asRecord(record.error)
  return stringValue(error.message) ?? stringValue(record.message)
}

async function providerErrorMessageFromResponse(response: Response) {
  const jsonReadable =
    typeof response.clone === 'function' ? response.clone() : response
  if (typeof jsonReadable.json === 'function') {
    try {
      const message = messageFromProviderErrorBody(await jsonReadable.json())
      if (message) return message
    } catch {
      // Fall through to text parsing.
    }
  }

  const textReadable =
    typeof response.clone === 'function' ? response.clone() : response
  if (typeof textReadable.text !== 'function') return undefined

  try {
    const text = await textReadable.text()
    if (!text.trim()) return undefined
    return messageFromProviderErrorBody(JSON.parse(text))
  } catch {
    return undefined
  }
}

function isDeepSeekProvider(provider: ModelProvider) {
  return (
    provider.provider === 'deepseek' ||
    (provider.base_url ?? '').includes('api.deepseek.com')
  )
}

function providerConsoleLink(providerName: string) {
  switch (providerName) {
    case 'jingxing':
    case 'biyuan':
      return 'https://api.biyuan.ai/console'
    case 'openai':
      return 'https://platform.openai.com/usage'
    case 'azure':
      return 'https://oai.azure.com/'
    case 'gemini':
      return 'https://aistudio.google.com/'
    case 'mistral':
      return 'https://console.mistral.ai/usage/'
    case 'groq':
      return 'https://console.groq.com/dashboard/usage'
    case 'huggingface':
      return 'https://huggingface.co/settings/billing'
    case 'nvidia':
      return 'https://build.nvidia.com/'
    case 'minimax':
      return 'https://platform.minimaxi.com/user-center/basic-information/balance'
    case 'anthropic':
      return 'https://console.anthropic.com/settings/billing'
    case 'xai':
      return 'https://console.x.ai/'
    default:
      return undefined
  }
}

export class TauriProvidersService extends DefaultProvidersService {
  private readonly biyuanStatusSettingsCache = new Map<
    string,
    BiyuanQuotaDisplaySettings | undefined
  >()

  fetch(): typeof fetch {
    // Tauri implementation uses Tauri's fetch to avoid CORS issues
    return fetchTauri as typeof fetch
  }

  async getProviders(): Promise<ModelProvider[]> {
    try {
      const builtinProviders = predefinedProviders.map((provider) => {
        let models = provider.models as Model[]
        if (Object.keys(providerModels).includes(provider.provider)) {
          const builtInModels = providerModels[
            provider.provider as unknown as keyof typeof providerModels
          ].models as unknown as string[]

          if (Array.isArray(builtInModels)) {
            models = builtInModels.map((model) => {
              const modelManifest = models.find((e) => e.id === model)
              // TODO: Check chat_template for tool call support
              return {
                ...(modelManifest ?? { id: model, name: model }),
                capabilities: getModelCapabilities(
                  provider.provider,
                  model,
                  provider.base_url
                ),
              } as Model
            })
          }
        }

        return {
          ...provider,
          models,
        }
      }).filter(Boolean)

      return builtinProviders as ModelProvider[]
    } catch (error: unknown) {
      console.error('Error getting providers in Tauri:', error)
      return []
    }
  }

  async fetchModelsFromProvider(
    provider: ModelProvider
  ): Promise<ProviderModelDescriptor[]> {
    if (!isRemoteProviderEndpoint(provider)) {
      throw Object.assign(
        new Error('Provider must use a non-local HTTP(S) endpoint'),
        { code: 'LOCAL_RUNTIME_REMOVED' }
      )
    }

    try {
      const keyChain = providerRemoteApiKeyChain(provider)
      const keyAttempts: (string | undefined)[] =
        keyChain.length > 0 ? keyChain : [undefined]

      let lastStatus = 0
      let lastStatusText = ''

      for (let ki = 0; ki < keyAttempts.length; ki++) {
        const key = keyAttempts[ki]
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        }

        if (key) {
          headers['x-api-key'] = key
          headers['Authorization'] = `Bearer ${key}`
        }

        if (provider.custom_header) {
          provider.custom_header.forEach((header) => {
            headers[header.header] = header.value
          })
        }

        const response = await fetchTauri(
          `${provider.base_url.replace(/\/$/, '')}/models`,
          {
            method: 'GET',
            headers,
          }
        )

        lastStatus = response.status
        lastStatusText = response.statusText

        const quotaError = await parseProviderErrorResponse(
          response,
          provider.provider
        )
        if (quotaError) throw quotaError

        if (
          [401, 403, 429].includes(response.status) &&
          ki < keyAttempts.length - 1
        ) {
          continue
        }

        if (!response.ok) {
          if (response.status === 401) {
            throw new Error(
              `Authentication failed: API key is required or invalid for ${provider.provider}`
            )
          }
          if (response.status === 403) {
            throw new Error(
              `Access forbidden: Check your API key permissions for ${provider.provider}`
            )
          }
          if (response.status === 404) {
            throw new Error(
              `Models endpoint not found for ${provider.provider}. Check the base URL configuration.`
            )
          }
          throw new Error(
            `Failed to fetch models from ${provider.provider}: ${response.status} ${response.statusText}`
          )
        }

        const data = await response.json()

        if (data.data && Array.isArray(data.data)) {
          return providerModelDescriptorsFromArray(data.data)
        }
        if (Array.isArray(data)) {
          return providerModelDescriptorsFromArray(data)
        }
        if (data.models && Array.isArray(data.models)) {
          return providerModelDescriptorsFromArray(data.models)
        }
        console.warn('Unexpected response format from provider API:', data)
        return []
      }

      throw new Error(
        `Failed to fetch models from ${provider.provider}: ${lastStatus} ${lastStatusText}`
      )
    } catch (error) {
      console.error('Error fetching models from provider:', error)
      const quotaError = providerQuotaErrorFromUnknown(error)
      if (quotaError) throw quotaError

      // Preserve structured error messages thrown above
      const structuredErrorPrefixes = [
        'Authentication failed',
        'Access forbidden',
        'Models endpoint not found',
        'Failed to fetch models from',
      ]

      if (
        error instanceof Error &&
        structuredErrorPrefixes.some((prefix) =>
          (error as Error).message.startsWith(prefix)
        )
      ) {
        throw new Error(error.message)
      }

      const errorMessage = errorMessageFromUnknown(error)

      if (includesAnyFragment(errorMessage, tlsCertificateErrorFragments)) {
        throw new Error(
          `TLS certificate verification failed while connecting to ${provider.provider} at ${provider.base_url}. If antivirus, proxy, or corporate HTTPS inspection is enabled, trust its root certificate in the system certificate store or disable HTTPS scanning for this host.`
        )
      }

      // Provide helpful error message for any connection errors
      if (includesAnyFragment(errorMessage, connectionErrorFragments)) {
        throw new Error(
          `Cannot connect to ${provider.provider} at ${provider.base_url}. Please check that the service is running and accessible.`
        )
      }

      // Generic fallback
      throw new Error(
        `Unexpected error while fetching models from ${provider.provider}: ${errorMessage}`
      )
    }
  }

  private async fetchBalanceJson(
    provider: ModelProvider,
    url: string,
    apiKey: string,
    extraHeaders?: Record<string, string>
  ): Promise<ProviderBalanceStatus | { json: unknown }> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...extraHeaders,
    }
    let lastServerError:
      | { status: number; statusText: string; message?: string }
      | undefined

    if (apiKey) {
      headers['x-api-key'] = apiKey
    }

    for (
      let attempt = 0;
      attempt < BALANCE_SERVER_ERROR_MAX_ATTEMPTS;
      attempt += 1
    ) {
      const controller = new AbortController()
      let timedOut = false
      const timeoutId = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, BALANCE_REQUEST_TIMEOUT_MS)

      try {
        const response = await fetchTauri(url, {
          method: 'GET',
          headers,
          signal: controller.signal,
        })

        if (!response.ok) {
          if (response.status >= 500) {
            const isLastAttempt =
              attempt >= BALANCE_SERVER_ERROR_MAX_ATTEMPTS - 1
            lastServerError = {
              status: response.status,
              statusText: response.statusText,
              ...(isLastAttempt
                ? { message: await providerErrorMessageFromResponse(response) }
                : {}),
            }
            if (!isLastAttempt) {
              await delay(
                BALANCE_SERVER_ERROR_RETRY_BASE_MS * 2 ** attempt
              )
              continue
            }
            break
          }
          const bodyMessage = await providerErrorMessageFromResponse(response)
          if (response.status === 401) {
            return {
              state: 'error',
              provider: provider.provider,
              status: 401,
              message: 'API key is missing or invalid. Please re-enter the key.',
            }
          }
          if (response.status === 403) {
            return {
              state: 'error',
              provider: provider.provider,
              status: 403,
              message: 'The account is forbidden. Please contact the provider.',
            }
          }
          if (response.status === 429) {
            return {
              state: 'error',
              provider: provider.provider,
              status: 429,
              retryable: true,
              message: bodyMessage ?? 'Balance lookup is rate limited.',
            }
          }
          return {
            state: 'error',
            provider: provider.provider,
            status: response.status,
            retryable: response.status >= 500,
            message:
              bodyMessage ??
              `Balance lookup failed: ${response.status} ${response.statusText}`,
          }
        }

        return { json: await response.json() }
      } catch (error) {
        return {
          state: 'error',
          provider: provider.provider,
          retryable: true,
          message: timedOut
            ? 'Balance lookup timed out. Please try again.'
            : errorMessageFromUnknown(error),
        }
      } finally {
        clearTimeout(timeoutId)
      }
    }

    return {
      state: 'error',
      provider: provider.provider,
      ...(lastServerError ? { status: lastServerError.status } : {}),
      retryable: true,
      message: lastServerError
        ? lastServerError.message ??
          `Balance lookup failed after retrying server errors: ${lastServerError.status} ${lastServerError.statusText}`
        : 'Balance lookup failed after retrying server errors.',
    }
  }

  private async fetchBiyuanQuotaDisplaySettings(
    provider: ModelProvider
  ): Promise<BiyuanQuotaDisplaySettings | undefined> {
    const url = biyuanStatusUrl(provider)
    if (this.biyuanStatusSettingsCache.has(url)) {
      return this.biyuanStatusSettingsCache.get(url)
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(
      () => controller.abort(),
      BIYUAN_STATUS_REQUEST_TIMEOUT_MS
    )

    try {
      const response = await fetchTauri(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      })
      if (!response.ok) return undefined
      const settings = biyuanQuotaDisplaySettingsFrom(
        asRecord(await response.json())
      )
      this.biyuanStatusSettingsCache.set(url, settings)
      return settings
    } catch {
      return undefined
    } finally {
      clearTimeout(timeoutId)
    }
  }

  private async fetchLegacyBiyuanTokenUsage(
    provider: ModelProvider,
    apiKey: string
  ): Promise<ProviderBalanceStatus> {
    const result = await this.fetchBalanceJson(
      provider,
      biyuanLegacyTokenUsageUrl(provider),
      apiKey
    )
    if ('state' in result) return result

    const response = asRecord(result.json)
    if (response.success === false) {
      return {
        state: 'error',
        provider: provider.provider,
        message:
          stringValue(response.message) ??
          'Legacy Biyuan balance lookup failed.',
      }
    }

    const nestedData = asRecord(response.data)
    const data = Object.keys(nestedData).length ? nestedData : response
    const tokenLimit = tokenLimitFromBiyuan(data)
    if (!tokenLimit) {
      return {
        state: 'error',
        provider: provider.provider,
        message:
          'Legacy Biyuan token usage response did not include quota fields.',
      }
    }

    return {
      state: 'supported',
      provider: provider.provider,
      unit: 'quota',
      fetchedAt: Math.floor(Date.now() / 1000),
      tokenLimit,
      subscription: {
        active: false,
        subscriptions: [],
        unavailable: true,
      },
      raw: result.json,
    }
  }

  async fetchProviderBalance(
    provider: ModelProvider
  ): Promise<ProviderBalanceStatus> {
    const primaryKey = providerRemoteApiKeyChain(provider)[0]?.trim()

    if (isBiyuanProvider(provider.provider, provider.base_url)) {
      if (!primaryKey) {
        return {
          state: 'needs_extra_auth',
          provider: provider.provider,
          reason: 'Enter a Biyuan API key to query account balance.',
          required: ['api key'],
          link: providerConsoleLink('biyuan'),
        }
      }

      const result = await this.fetchBalanceJson(
        provider,
        biyuanBalanceUrl(provider),
        primaryKey
      )
      if ('state' in result) {
        if (
          result.state === 'error' &&
          (result.status === 404 || result.status === 405)
        ) {
          return this.fetchLegacyBiyuanTokenUsage(provider, primaryKey)
        }
        return result
      }

      const data = asRecord(result.json)
      const account = totalsFromRecord(asRecord(data.account), {
        available: 'total_available',
        used: 'total_used',
        total: 'total_granted',
      })
      const displaySettings = account
        ? await this.fetchBiyuanQuotaDisplaySettings(provider)
        : undefined
      const moneyBalance = moneyTotalsFromBiyuanQuota(account, displaySettings)
      const subscription = subscriptionFromBiyuan(data.subscription)

      return {
        state: 'supported',
        provider: provider.provider,
        unit: 'quota',
        fetchedAt: numericValue(data.fetched_at) ?? Math.floor(Date.now() / 1000),
        ...(account ? { accountBalance: account } : {}),
        ...(moneyBalance ? { moneyBalance } : {}),
        tokenLimit: tokenLimitFromBiyuan(data),
        ...(subscription ? { subscription } : {}),
        links: linksFromUnknown(data.links),
        raw: result.json,
      }
    }

    if (provider.provider === 'openrouter') {
      if (!primaryKey) {
        return {
          state: 'needs_extra_auth',
          provider: provider.provider,
          reason: 'Enter an OpenRouter API key to query credits.',
          required: ['api key'],
          link: 'https://openrouter.ai/settings/keys',
        }
      }

      const result = await this.fetchBalanceJson(
        provider,
        joinUrl(balanceBaseUrl(provider), '/credits'),
        primaryKey
      )
      if ('state' in result) return result

      const data = asRecord(asRecord(result.json).data)
      const total = numericValue(data.total_credits)
      const used = numericValue(data.total_usage)
      if (total === undefined || used === undefined) {
        return {
          state: 'error',
          provider: provider.provider,
          message: 'OpenRouter credits response did not include total_credits and total_usage.',
        }
      }

      const available = Math.max(0, total - used)
      const overdrawn =
        used > total ? Number((used - total).toFixed(6)) : undefined

      return {
        state: 'supported',
        provider: provider.provider,
        unit: 'usd',
        currency: 'USD',
        fetchedAt: Math.floor(Date.now() / 1000),
        accountBalance: {
          available,
          used,
          total,
        },
        ...(overdrawn !== undefined
          ? {
              notice: {
                code: 'openrouter_overdrawn',
                tone: 'warning',
                amount: overdrawn,
                currency: 'USD',
              },
            }
          : {}),
        links: {
          billing: 'https://openrouter.ai/settings/credits',
          topup: 'https://openrouter.ai/settings/credits',
        },
        raw: result.json,
      }
    }

    if (isDeepSeekProvider(provider)) {
      if (!primaryKey) {
        return {
          state: 'needs_extra_auth',
          provider: provider.provider,
          reason: 'Enter a DeepSeek API key to query balance.',
          required: ['api key'],
          link: 'https://platform.deepseek.com/api_keys',
        }
      }

      const result = await this.fetchBalanceJson(
        provider,
        deepSeekBalanceUrl(provider),
        primaryKey
      )
      if ('state' in result) return result

      const responseJson = asRecord(result.json)
      const balanceInfos = responseJson.balance_infos
      const balances = Array.isArray(balanceInfos) ? balanceInfos.map(asRecord) : []
      const preferred =
        balances.find((item) => item.currency === 'CNY') ?? balances[0]
      const available = preferred
        ? numericValue(preferred.total_balance)
        : undefined

      if (!preferred || available === undefined) {
        return {
          state: 'error',
          provider: provider.provider,
          message: 'DeepSeek balance response did not include balance_infos.',
        }
      }

      return {
        state: 'supported',
        provider: provider.provider,
        unit: 'currency',
        currency:
          typeof preferred.currency === 'string' ? preferred.currency : 'CNY',
        fetchedAt: Math.floor(Date.now() / 1000),
        accountBalance: {
          available,
          total: available,
        },
        ...(responseJson.is_available === false
          ? {
              notice: {
                code: 'deepseek_unavailable',
                tone: 'warning',
                hideBadge: true,
              },
            }
          : {}),
        links: {
          billing: 'https://platform.deepseek.com/usage',
          topup: 'https://platform.deepseek.com/top_up',
        },
        raw: result.json,
      }
    }

    if (provider.provider === 'xai') {
      const managementKey = providerSettingValue(provider, [
        'management-key',
        'xai-management-key',
      ])
      const teamId = providerSettingValue(provider, [
        'team-id',
        'xai-team-id',
      ])

      if (!managementKey || !teamId) {
        return {
          state: 'needs_extra_auth',
          provider: provider.provider,
          reason: 'xAI billing lookup requires a management key and team id.',
          required: ['management key', 'team id'],
          link: providerConsoleLink('xai'),
        }
      }

      const result = await this.fetchBalanceJson(
        provider,
        `https://management-api.x.ai/v1/billing/teams/${encodeURIComponent(teamId)}/prepaid/balance`,
        managementKey
      )
      if ('state' in result) return result

      const data = asRecord(result.json)
      const nested = asRecord(data.balance)
      const available =
        numericValue(data.balance) ??
        numericValue(data.amount) ??
        numericValue(data.available_balance) ??
        numericValue(nested.amount) ??
        numericValue(nested.available)

      if (available === undefined) {
        return {
          state: 'error',
          provider: provider.provider,
          message: 'xAI balance response did not include a supported balance field.',
        }
      }

      return {
        state: 'supported',
        provider: provider.provider,
        unit: 'currency',
        currency:
          typeof data.currency === 'string'
            ? data.currency
            : typeof nested.currency === 'string'
              ? nested.currency
              : 'USD',
        fetchedAt: Math.floor(Date.now() / 1000),
        accountBalance: { available, total: available },
        links: { billing: providerConsoleLink('xai') },
        raw: result.json,
      }
    }

    if (provider.provider === 'anthropic') {
      const adminKey = providerSettingValue(provider, [
        'admin-api-key',
        'anthropic-admin-api-key',
      ])
      return {
        state: adminKey ? 'unsupported' : 'needs_extra_auth',
        provider: provider.provider,
        reason: adminKey
          ? 'Anthropic exposes admin usage and cost reports, not a real-time account balance.'
          : 'Anthropic usage and cost reports require an Admin API key.',
        ...(adminKey ? {} : { required: ['admin api key'] }),
        link: providerConsoleLink('anthropic'),
      } as ProviderBalanceStatus
    }

    if (provider.provider === 'openai' || provider.provider === 'azure') {
      return {
        state: 'unsupported',
        provider: provider.provider,
        reason:
          provider.provider === 'openai'
            ? 'OpenAI does not expose a reliable balance lookup through ordinary model API keys.'
            : 'Azure OpenAI costs are available through Azure billing, not the Azure OpenAI model key.',
        link: providerConsoleLink(provider.provider),
      }
    }

    const unsupportedLinks = new Set([
      'gemini',
      'mistral',
      'groq',
      'huggingface',
      'nvidia',
      'minimax',
    ])

    if (unsupportedLinks.has(provider.provider)) {
      return {
        state: 'unsupported',
        provider: provider.provider,
        reason: 'This provider does not support automatic balance lookup with the configured model API key.',
        link: providerConsoleLink(provider.provider),
      }
    }

    return {
      state: 'unsupported',
      provider: provider.provider,
      reason: 'Automatic balance lookup is not configured for this provider.',
    }
  }

  async updateSettings(
    providerName: string,
    settings: ProviderSetting[]
  ): Promise<void> {
    void providerName
    void settings
    // Remote provider settings are persisted by the model-provider store.
  }
}
