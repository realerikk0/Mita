import {
  legacyStorage,
  readCanonicalStorageValue,
} from '@/legacy_migrations/storage'

const VIDEO_DEBUG_STORAGE_KEY = 'biyan.videoGeneration.debug'
const VIDEO_DEBUG_PREFIX = '[biyan-video-debug]'

type PlainObject = Record<string, unknown>

export function isVideoGenerationDebugEnabled() {
  try {
    const value = readCanonicalStorageValue(
      VIDEO_DEBUG_STORAGE_KEY,
      legacyStorage.videoGenerationDebug
    )
    return isEnabledFlag(value)
  } catch {
    return false
  }
}

export function videoDebugLog(event: string, payload?: unknown) {
  if (!isVideoGenerationDebugEnabled()) return

  try {
    console.info(VIDEO_DEBUG_PREFIX, event, sanitizeForVideoDebug(payload))
  } catch {
    console.info(VIDEO_DEBUG_PREFIX, event)
  }
}

export function videoDebugError(
  event: string,
  error: unknown,
  payload?: unknown
) {
  if (!isVideoGenerationDebugEnabled()) return

  videoDebugLog(event, {
    ...(isPlainObject(payload) ? payload : { payload }),
    error: errorSnapshot(error),
  })
}

function sanitizeForVideoDebug(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[depth-limit]'
  if (value == null) return value

  if (typeof value === 'string') return sanitizeString(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'function') return '[function]'

  if (Array.isArray(value)) {
    const items = value
      .slice(0, 20)
      .map((item) => sanitizeForVideoDebug(item, depth + 1))
    if (value.length > items.length) {
      items.push(`[+${value.length - items.length} more]`)
    }
    return items
  }

  if (!isPlainObject(value)) return String(value)

  const result: PlainObject = {}
  for (const [key, nestedValue] of Object.entries(value)) {
    result[key] = sanitizeField(key, nestedValue, depth + 1)
  }
  return result
}

function sanitizeField(key: string, value: unknown, depth: number) {
  const normalized = key.toLowerCase()
  if (
    normalized.includes('authorization') ||
    normalized.includes('api_key') ||
    normalized.includes('apikey') ||
    normalized === 'x-api-key' ||
    normalized.includes('token') ||
    normalized.includes('secret') ||
    normalized.includes('password') ||
    normalized.includes('credential')
  ) {
    return '[redacted]'
  }

  if (normalized === 'prompt' && typeof value === 'string') {
    return {
      length: value.length,
      preview: truncate(value, 300),
    }
  }

  return sanitizeForVideoDebug(value, depth)
}

function sanitizeString(value: string) {
  if (value.startsWith('data:')) return dataUrlSummary(value)
  return truncate(sanitizeUrl(value), 600)
}

function sanitizeUrl(value: string) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return value

    const query = url.search ? '?[redacted]' : ''
    const hash = url.hash ? '#[redacted]' : ''
    return `${url.origin}${url.pathname}${query}${hash}`
  } catch {
    return value
  }
}

function dataUrlSummary(value: string) {
  const match = value.match(/^data:([^;,]+)?;base64,(.*)$/)
  if (!match) {
    return {
      kind: 'data-url',
      length: value.length,
    }
  }

  const base64Chars = match[2]?.replace(/\s/g, '').length ?? 0
  return {
    kind: 'data-url',
    mimeType: match[1] || 'unknown',
    base64Chars,
    approxBytes: Math.floor((base64Chars * 3) / 4),
  }
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}... [${value.length} chars]`
}

function errorSnapshot(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack ? truncate(error.stack, 1000) : undefined,
    }
  }

  return sanitizeForVideoDebug(error)
}

function isPlainObject(value: unknown): value is PlainObject {
  return (
    typeof value === 'object' &&
    value !== null &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  )
}

function isEnabledFlag(value: string | null | undefined) {
  if (value == null) return false
  return ['1', 'true', 'on', 'yes'].includes(value.trim().toLowerCase())
}
