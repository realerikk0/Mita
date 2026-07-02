import { invoke } from '@tauri-apps/api/core'
import { isPlatformTauri } from '@/lib/platform/utils'
import type { UserLogPayload } from '@/services/app/types'

type LogLevel = NonNullable<UserLogPayload['level']>

const SENSITIVE_KEY_PARTS = [
  'api_key',
  'apikey',
  'authorization',
  'auth_token',
  'access_token',
  'refresh_token',
  'bearer',
  'cookie',
  'password',
  'secret',
  'token',
]

const PATH_KEY_PARTS = ['path', 'folder', 'directory', 'file']
const MAX_TEXT_LEN = 500

function shouldRedactSensitiveKey(key: string) {
  const normalized = key.toLowerCase()
  return SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part))
}

function shouldRedactPathKey(key: string) {
  const normalized = key.toLowerCase()
  return PATH_KEY_PARTS.some((part) => normalized.includes(part))
}

function redactUrlToken(rawToken: string) {
  const match = rawToken.match(/^(.+?)([.,)\]}'"]*)$/)
  const core = match?.[1] ?? rawToken
  const suffix = match?.[2] ?? ''

  try {
    const url = new URL(core)
    if (!['http:', 'https:'].includes(url.protocol)) return rawToken
    return `${url.protocol}//${url.host}${url.pathname}${url.search ? '?[redacted]' : ''}${url.hash ? '#[redacted]' : ''}${suffix}`
  } catch {
    return rawToken
  }
}

export function sanitizeUserLogText(value: string, limit = MAX_TEXT_LEN) {
  const compact = value.replace(/[\r\n]+/g, ' ')
  const redacted = compact
    .replace(/https?:\/\/[^\s]+/gi, (token) => redactUrlToken(token))
    .replace(/\b(Bearer|Basic)\s+[^\s,;'"&]+/gi, '$1 [redacted]')
    .replace(
      /\b(api_key|apikey|apiKey|access_token|accessToken|refresh_token|refreshToken|auth_token|authToken|session_token|sessionToken|token|password|secret)\s*([:=])\s*[^\s,;'"&]+/gi,
      '$1$2[redacted]'
    )
    .replace(/\bauthorization\s*[:=]\s*[^\s,;'"&]+/gi, 'authorization: [redacted]')
    .replace(/\bcookie\s*[:=]\s*[^'"&]+/gi, 'cookie: [redacted]')
    .replace(/\/Users\/[^/\s]+/g, '/Users/[redacted]')
    .replace(/([A-Za-z]:\\Users\\)[^\\\s]+/g, '$1[redacted]')

  return redacted.length > limit ? `${redacted.slice(0, limit)}...` : redacted
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[truncated]'
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return sanitizeUserLogText(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value

  if (Array.isArray(value)) {
    return value.slice(0, 10).map((item) => sanitizeValue(item, depth + 1))
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    return Object.fromEntries(
      Object.entries(record)
        .slice(0, 30)
        .map(([key, item]) => {
          if (shouldRedactSensitiveKey(key)) return [key, '[redacted]']
          if (shouldRedactPathKey(key)) return [key, '[redacted-path]']
          return [key, sanitizeValue(item, depth + 1)]
        })
    )
  }

  return String(value)
}

function normalizeError(error: unknown) {
  if (!error) return undefined
  if (error instanceof Error) {
    return {
      name: error.name,
      message: sanitizeUserLogText(error.message || error.name),
    }
  }
  if (typeof error === 'string') {
    return { message: sanitizeUserLogText(error) }
  }
  if (typeof error === 'object') {
    const record = error as Record<string, unknown>
    return sanitizeValue({
      name: record.name,
      message: record.message,
      code: record.code,
      status: record.status,
      statusText: record.statusText,
    })
  }
  return { message: sanitizeUserLogText(String(error)) }
}

function canWriteUserLog() {
  try {
    return isPlatformTauri()
  } catch {
    return false
  }
}

export async function writeUserLog(payload: UserLogPayload): Promise<void> {
  if (!canWriteUserLog()) return

  const safePayload: UserLogPayload = {
    level: payload.level ?? 'info',
    target: payload.target ?? 'web-app',
    event: payload.event,
    message: payload.message ? sanitizeUserLogText(payload.message) : undefined,
    context: sanitizeValue(payload.context),
    error: normalizeError(payload.error),
  }

  try {
    await invoke('write_user_log', { entry: safePayload })
  } catch {
    // Logging must never interrupt product flows.
  }
}

export function logUserAction(
  event: string,
  message?: string,
  context?: unknown
) {
  return writeUserLog({
    level: 'info',
    target: 'web-app',
    event,
    message,
    context,
  })
}

export function logUserWarning(
  event: string,
  message?: string,
  context?: unknown
) {
  return writeUserLog({
    level: 'warn',
    target: 'web-app',
    event,
    message,
    context,
  })
}

export function logUserError(
  event: string,
  error: unknown,
  context?: unknown,
  target = 'web-app'
) {
  return writeUserLog({
    level: 'error',
    target,
    event,
    message:
      error instanceof Error
        ? error.message || error.name
        : typeof error === 'string'
          ? error
          : 'Unexpected error',
    context,
    error,
  })
}

export function logUserLevel(
  level: LogLevel,
  event: string,
  message?: string,
  context?: unknown,
  target = 'web-app'
) {
  return writeUserLog({ level, target, event, message, context })
}
