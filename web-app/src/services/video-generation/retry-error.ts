const RECOVERABLE_VIDEO_POLLING_ERROR_CODE =
  'recoverable_video_polling_error'

const RECOVERABLE_NETWORK_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
])

const RECOVERABLE_NETWORK_ERROR_MESSAGE =
  /error sending request for url|failed to send request|failed to fetch|fetch failed|network(?: request)? (?:failed|error)|networkerror|network socket disconnected|socket hang up|connection (?:reset|refused|closed)|econnreset|timed? ?out|temporary failure in name resolution|failed to lookup address|dns error|tls handshake/i

const ABORT_ERROR_MESSAGE =
  /(?:operation|request) (?:was )?aborted|the user aborted a request/i

type RecoverableVideoPollingErrorReason = 'network' | 'timeout' | 'capacity'

type RecoverableVideoPollingErrorOptions = {
  cause?: unknown
  reason?: RecoverableVideoPollingErrorReason
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function errorRecord(value: unknown) {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined
}

function errorMessage(value: unknown) {
  return stringValue(value) ?? stringValue(errorRecord(value)?.message)
}

function isAbortError(error: unknown) {
  const visited = new Set<unknown>()
  let current: unknown = error

  for (let depth = 0; current && depth < 6; depth += 1) {
    if (visited.has(current)) break
    visited.add(current)

    const record = errorRecord(current)
    const name = stringValue(record?.name)
    const code = stringValue(record?.code)
    const message = errorMessage(current)
    if (
      name === 'AbortError' ||
      code?.toUpperCase() === 'ABORT_ERR' ||
      (message && ABORT_ERROR_MESSAGE.test(message))
    ) {
      return true
    }

    current = record?.cause
  }

  return false
}

export class RecoverableVideoPollingError extends Error {
  readonly recoverableVideoPollingError = true
  readonly code = RECOVERABLE_VIDEO_POLLING_ERROR_CODE
  readonly reason: RecoverableVideoPollingErrorReason
  readonly cause?: unknown

  constructor(
    message: string,
    options: RecoverableVideoPollingErrorOptions = {}
  ) {
    super(message)
    this.name = 'RecoverableVideoPollingError'
    this.reason = options.reason ?? 'network'
    this.cause = options.cause
  }
}

/**
 * Classifies transport errors that are safe to recover by polling the same
 * already-created video task. It deliberately does not apply to creation
 * requests, which must never be replayed after an ambiguous POST failure.
 */
export function isRecoverableVideoPollingError(error: unknown) {
  if (error instanceof RecoverableVideoPollingError) return true
  if (isAbortError(error)) return false

  const visited = new Set<unknown>()
  let current: unknown = error

  for (let depth = 0; current && depth < 6; depth += 1) {
    if (visited.has(current)) break
    visited.add(current)

    const record = errorRecord(current)
    if (record?.recoverableVideoPollingError === true) return true

    const code = stringValue(record?.code)
    if (
      code &&
      RECOVERABLE_NETWORK_ERROR_CODES.has(code.toUpperCase())
    ) {
      return true
    }

    const message = errorMessage(current)
    if (message && RECOVERABLE_NETWORK_ERROR_MESSAGE.test(message)) return true

    const name = stringValue(record?.name)
    if (name === 'TypeError' && /fetch/i.test(message ?? '')) return true

    current = record?.cause
  }

  return false
}

/** Keeps rejection diagnostics when Tauri returns a primitive instead of Error. */
export function normalizeVideoError(
  error: unknown,
  fallback = 'Video generation failed'
): Error {
  if (error instanceof Error) return error

  const record = errorRecord(error)
  const message = errorMessage(error) ?? stringValue(fallback) ?? 'Unknown error'
  const normalized = new Error(message) as Error & {
    cause?: unknown
    code?: unknown
    status?: unknown
  }
  normalized.name = stringValue(record?.name) ?? 'Error'
  normalized.cause = error

  if (record && 'code' in record) normalized.code = record.code
  if (record && 'status' in record) normalized.status = record.status

  return normalized
}
