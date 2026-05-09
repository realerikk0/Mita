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
