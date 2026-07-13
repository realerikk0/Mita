import { isBiyuanProvider } from '@/constants/biyuan'

export type ParsedProviderConnection = {
  provider: string
  name: string
  apiKey: string
  baseUrl: string
  apiVersion: string
  deployment: string
  defaultModel: string
  headers: Record<string, unknown>
  extra: Record<string, unknown>
}

export type ImportedProviderCustomHeader = {
  header: string
  value: string
}

const DEFAULT_PROVIDER_IMPORT_PROVIDER = 'jingxing'
const CANONICAL_BIYUAN_PROVIDER = 'jingxing'

const protectedImportedHeaderNames = new Set([
  'authorization',
  'x-api-key',
  'api-key',
  'content-type',
])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const asString = (value: unknown) =>
  typeof value === 'string' ? value.trim() : ''

const normalizeObject = (value: unknown): Record<string, unknown> =>
  isRecord(value) ? { ...value } : {}

const normalizeBaseUrl = (value: unknown) => {
  const baseUrl = asString(value)
  if (!baseUrl) {
    throw new Error('缺少 Base URL')
  }

  if (!/^https?:\/\//i.test(baseUrl)) {
    throw new Error('Base URL 不正确')
  }

  try {
    const url = new URL(baseUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('Base URL 不正确')
    }
  } catch {
    throw new Error('Base URL 不正确')
  }

  return baseUrl.replace(/\/+$/, '')
}

const searchParamString = (params: URLSearchParams, ...keys: string[]) => {
  for (const key of keys) {
    const value = asString(params.get(key))
    if (value) return value
  }
  return ''
}

const normalizeProviderName = (value: unknown) => {
  const provider = asString(value) || DEFAULT_PROVIDER_IMPORT_PROVIDER
  const normalized = provider.toLowerCase()

  if (!/^[a-z0-9._-]{1,80}$/.test(normalized)) {
    throw new Error('Provider 名称不正确')
  }

  return normalized
}

export function parseProviderConnection(text: string): ParsedProviderConnection {
  let parsed: unknown

  try {
    parsed = JSON.parse(text.trim())
  } catch {
    throw new Error('配置格式不正确')
  }

  if (!isRecord(parsed)) {
    throw new Error('配置格式不正确')
  }

  const isGeneric = parsed._type === 'ai_provider_connection'
  const isNewApi = parsed._type === 'newapi_channel_conn'

  if (!isGeneric && !isNewApi) {
    throw new Error('不支持的配置类型')
  }

  if (parsed.version !== 1) {
    throw new Error('不支持的配置版本')
  }

  const apiKey = asString(parsed.apiKey) || asString(parsed.key)
  if (!apiKey) {
    throw new Error('缺少 API Key')
  }

  const baseUrl = normalizeBaseUrl(asString(parsed.baseUrl) || parsed.url)

  return {
    provider: isNewApi
      ? 'openai-compatible'
      : asString(parsed.provider) || 'openai-compatible',
    name: asString(parsed.name) || 'Imported Provider',
    apiKey,
    baseUrl,
    apiVersion: asString(parsed.apiVersion),
    deployment: asString(parsed.deployment),
    defaultModel: asString(parsed.defaultModel),
    headers: normalizeObject(parsed.headers),
    extra: normalizeObject(parsed.extra),
  }
}

export function parseProviderConnectionDeepLink(
  deeplink: string
): ParsedProviderConnection | null {
  let url: URL

  try {
    url = new URL(deeplink)
  } catch {
    return null
  }

  const importPath = url.pathname.replace(/\/+$/, '')
  if (
    url.protocol !== 'mita:' ||
    url.hostname !== 'provider' ||
    importPath !== '/import'
  ) {
    return null
  }

  const apiKey = searchParamString(url.searchParams, 'apiKey', 'api_key', 'key')
  if (!apiKey) {
    throw new Error('缺少 API Key')
  }

  const baseUrl = normalizeBaseUrl(
    searchParamString(url.searchParams, 'baseUrl', 'base_url', 'url')
  )
  const provider = normalizeProviderName(url.searchParams.get('provider'))

  return {
    provider,
    name: searchParamString(url.searchParams, 'name') || provider,
    apiKey,
    baseUrl,
    apiVersion: searchParamString(url.searchParams, 'apiVersion', 'api_version'),
    deployment: searchParamString(
      url.searchParams,
      'deployment',
      'deploymentName',
      'deployment_name'
    ),
    defaultModel: searchParamString(
      url.searchParams,
      'defaultModel',
      'default_model',
      'model'
    ),
    headers: {},
    extra: {},
  }
}

export const providerConnectionHeadersToCustomHeaders = (
  headers: Record<string, unknown>
): ImportedProviderCustomHeader[] =>
  Object.entries(headers)
    .map(([header, value]) => ({
      header: header.trim(),
      value:
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
          ? String(value).trim()
          : '',
    }))
    .filter(
      ({ header, value }) =>
        header.length > 0 &&
        value.length > 0 &&
        !protectedImportedHeaderNames.has(header.toLowerCase())
    )

export const mergeProviderCustomHeaders = (
  currentHeaders: ImportedProviderCustomHeader[] | null | undefined,
  importedHeaders: ImportedProviderCustomHeader[]
) => {
  const merged = [...(currentHeaders ?? [])]

  importedHeaders.forEach((nextHeader) => {
    const existingIndex = merged.findIndex(
      (currentHeader) =>
        currentHeader.header.toLowerCase() === nextHeader.header.toLowerCase()
    )

    if (existingIndex === -1) {
      merged.push(nextHeader)
      return
    }

    merged[existingIndex] = nextHeader
  })

  return merged
}

export const resolveProviderConnectionImportTarget = (
  providers: ModelProvider[],
  importedConnection: Pick<ParsedProviderConnection, 'provider' | 'baseUrl'>
): {
  providerName: string
  existingProvider: ModelProvider | undefined
} => {
  const importedIsBiyuan = isBiyuanProvider(
    importedConnection.provider,
    importedConnection.baseUrl
  )

  if (!importedIsBiyuan) {
    const existingProvider = providers.find(
      (provider) => provider.provider === importedConnection.provider
    )
    return {
      providerName: existingProvider?.provider ?? importedConnection.provider,
      existingProvider,
    }
  }

  // openai-compatible may point anywhere. Only reuse an exact-id match when
  // its current URL is also Biyuan, so unrelated providers are not overwritten.
  const exactProvider = providers.find(
    (provider) =>
      provider.provider === importedConnection.provider &&
      isBiyuanProvider(provider.provider, provider.base_url)
  )
  if (exactProvider) {
    return {
      providerName: exactProvider.provider,
      existingProvider: exactProvider,
    }
  }

  const familyProvider = providers.find((provider) =>
    isBiyuanProvider(provider.provider, provider.base_url)
  )
  if (familyProvider) {
    return {
      providerName: familyProvider.provider,
      existingProvider: familyProvider,
    }
  }

  return {
    providerName: CANONICAL_BIYUAN_PROVIDER,
    existingProvider: undefined,
  }
}

const providerConnectionSettingMap: Record<
  string,
  keyof Pick<
    ParsedProviderConnection,
    'apiKey' | 'baseUrl' | 'apiVersion' | 'deployment' | 'defaultModel'
  >
> = {
  'api-key': 'apiKey',
  'base-url': 'baseUrl',
  'api-version': 'apiVersion',
  apiVersion: 'apiVersion',
  deployment: 'deployment',
  'deployment-name': 'deployment',
  'default-model': 'defaultModel',
  defaultModel: 'defaultModel',
  model: 'defaultModel',
}

export const applyProviderConnectionToProvider = (
  provider: ModelProvider,
  importedConnection: ParsedProviderConnection,
  options: { active?: boolean } = {}
): ModelProvider => {
  const settings = provider.settings.map((setting) => {
    const importedField = providerConnectionSettingMap[setting.key]
    if (!importedField) return setting

    return {
      ...setting,
      controller_props: {
        ...setting.controller_props,
        value: importedConnection[importedField],
      },
    }
  })
  const importedHeaders = providerConnectionHeadersToCustomHeaders(
    importedConnection.headers
  )

  return {
    ...provider,
    ...(options.active === undefined ? {} : { active: options.active }),
    settings,
    api_key: importedConnection.apiKey,
    base_url: importedConnection.baseUrl,
    custom_header:
      importedHeaders.length > 0
        ? mergeProviderCustomHeaders(provider.custom_header, importedHeaders)
        : provider.custom_header,
  }
}

export const maskProviderConnectionApiKey = (apiKey: string) => {
  const value = apiKey.trim()
  if (value.length <= 8) return `${value.slice(0, 2)}***`
  return `${value.slice(0, 4)}***${value.slice(-4)}`
}
