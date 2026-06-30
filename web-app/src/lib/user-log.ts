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

function shouldRedactSensitiveKey(key: string) {
  const normalized = key.toLowerCase()
  return SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part))
}

function shouldRedactPathKey(key: string) {
  const normalized = key.toLowerCase()
  return PATH_KEY_PARTS.some((part) => normalized.includes(part))
}

function compactText(value: string, limit = 500) {
  return value.length > limit ? `${value.slice(0, limit)}...` : value
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[truncated]'
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return compactText(value)
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
      message: compactText(error.message || error.name),
    }
  }
  if (typeof error === 'string') {
    return { message: compactText(error) }
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
  return { message: compactText(String(error)) }
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
    message: payload.message ? compactText(payload.message) : undefined,
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
