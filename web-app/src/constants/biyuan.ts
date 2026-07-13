export const BIYUAN_DEFAULT_BASE_URL = 'https://api.biyuan.ai/v1'
export const BIYUAN_PROVIDER_NAMES = ['biyuan', 'jingxing'] as const

export const BIYUAN_API_HOSTNAMES = [
  'api.biyuan.ai',
  'api.jingxing.io',
  'api.jingxing.uk',
  'jingxing.io',
] as const

const BIYUAN_PROVIDER_NAME_SET = new Set<string>(BIYUAN_PROVIDER_NAMES)
const BIYUAN_API_HOSTNAME_SET = new Set<string>(BIYUAN_API_HOSTNAMES)

function hostnameFromBaseUrl(baseUrl?: string | null): string | undefined {
  const trimmed = baseUrl?.trim()
  if (!trimmed) return undefined

  try {
    const parsed = new URL(
      /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    )
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return undefined
    }
    return parsed.hostname.toLowerCase()
  } catch {
    return undefined
  }
}

export function isBiyuanProviderName(providerName?: string | null): boolean {
  return BIYUAN_PROVIDER_NAME_SET.has(providerName?.trim().toLowerCase() ?? '')
}

export function isBiyuanPrimaryApiHost(baseUrl?: string | null): boolean {
  return hostnameFromBaseUrl(baseUrl) === 'api.biyuan.ai'
}

export function isBiyuanApiHost(baseUrl?: string | null): boolean {
  const hostname = hostnameFromBaseUrl(baseUrl)
  return hostname ? BIYUAN_API_HOSTNAME_SET.has(hostname) : false
}

export function isBiyuanProvider(
  providerName?: string | null,
  baseUrl?: string | null
): boolean {
  return isBiyuanProviderName(providerName) || isBiyuanApiHost(baseUrl)
}
