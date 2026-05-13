export type ProviderQuotaErrorDetails = {
  message: string
  status: number
  type?: string
  code?: string
  providerName?: string
  rechargeUrl?: string
  tokenUrl?: string
  metadata?: Record<string, unknown>
}

type ProviderErrorJson = {
  error?: {
    message?: unknown
    type?: unknown
    code?: unknown
    metadata?: unknown
  }
  message?: unknown
}

const QUOTA_ERROR_CODE = 'pre_consume_token_quota_failed'
const ENCODED_PROVIDER_QUOTA_PREFIX = '__MITA_PROVIDER_QUOTA_ERROR__:'

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value
    : undefined
}

function safeHttpUrl(value: unknown): string | undefined {
  const raw = asString(value)
  if (!raw) return undefined

  try {
    const url = new URL(raw)
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.toString()
      : undefined
  } catch {
    return undefined
  }
}

function detailsFromJson(
  json: ProviderErrorJson,
  status: number,
  providerName?: string
): ProviderQuotaErrorDetails | undefined {
  const error = asRecord(json.error)
  const metadata = asRecord(error?.metadata)
  const code = asString(error?.code)
  const type = asString(error?.type)
  const quotaError = metadata?.quota_error === true

  if (status !== 403 || (code !== QUOTA_ERROR_CODE && !quotaError)) {
    return undefined
  }

  return {
    message:
      asString(error?.message) ||
      asString(json.message) ||
      'Provider token quota has been exhausted.',
    status,
    type,
    code,
    providerName,
    rechargeUrl: safeHttpUrl(metadata?.recharge_url),
    tokenUrl: safeHttpUrl(metadata?.token_url),
    metadata,
  }
}

export class ProviderQuotaError extends Error {
  readonly quotaError = true
  readonly status: number
  readonly type?: string
  readonly code?: string
  readonly providerName?: string
  readonly rechargeUrl?: string
  readonly tokenUrl?: string
  readonly metadata?: Record<string, unknown>

  constructor(details: ProviderQuotaErrorDetails) {
    super(details.message)
    this.name = 'ProviderQuotaError'
    this.status = details.status
    this.type = details.type
    this.code = details.code
    this.providerName = details.providerName
    this.rechargeUrl = details.rechargeUrl
    this.tokenUrl = details.tokenUrl
    this.metadata = details.metadata
  }

  toJSON(): ProviderQuotaErrorDetails {
    return {
      message: this.message,
      status: this.status,
      type: this.type,
      code: this.code,
      providerName: this.providerName,
      rechargeUrl: this.rechargeUrl,
      tokenUrl: this.tokenUrl,
      metadata: this.metadata,
    }
  }
}

export async function parseProviderErrorResponse(
  response: Response,
  providerName?: string
): Promise<ProviderQuotaError | undefined> {
  const readable =
    typeof response.clone === 'function' ? response.clone() : response
  if (typeof readable.text !== 'function') return undefined
  const text = await readable.text().catch(() => '')
  if (!text) return undefined

  try {
    const details = detailsFromJson(
      JSON.parse(text) as ProviderErrorJson,
      response.status,
      providerName
    )
    return details ? new ProviderQuotaError(details) : undefined
  } catch {
    return undefined
  }
}

export function encodeProviderQuotaError(error: ProviderQuotaError): string {
  return `${ENCODED_PROVIDER_QUOTA_PREFIX}${JSON.stringify(error.toJSON())}`
}

export function decodeProviderQuotaErrorMessage(
  message: string
): ProviderQuotaError | undefined {
  if (!message.startsWith(ENCODED_PROVIDER_QUOTA_PREFIX)) return undefined

  try {
    const details = JSON.parse(
      message.slice(ENCODED_PROVIDER_QUOTA_PREFIX.length)
    ) as ProviderQuotaErrorDetails
    if (!details?.message || details.status !== 403) return undefined
    return new ProviderQuotaError(details)
  } catch {
    return undefined
  }
}

export function providerQuotaErrorFromUnknown(
  error: unknown
): ProviderQuotaError | undefined {
  if (error instanceof ProviderQuotaError) return error

  if (typeof error === 'string') {
    return decodeProviderQuotaErrorMessage(error)
  }

  const record = asRecord(error)
  if (!record) return undefined

  const directMessage = asString(record.message)
  if (directMessage) {
    const decoded = decodeProviderQuotaErrorMessage(directMessage)
    if (decoded) return decoded
  }

  if (record.quotaError === true) {
    return new ProviderQuotaError({
      message: directMessage || 'Provider token quota has been exhausted.',
      status: typeof record.status === 'number' ? record.status : 403,
      type: asString(record.type),
      code: asString(record.code),
      providerName: asString(record.providerName),
      rechargeUrl: safeHttpUrl(record.rechargeUrl),
      tokenUrl: safeHttpUrl(record.tokenUrl),
      metadata: asRecord(record.metadata),
    })
  }

  if (
    record.status === 403 &&
    (record.code === QUOTA_ERROR_CODE ||
      asRecord(record.metadata)?.quota_error === true)
  ) {
    return new ProviderQuotaError({
      message: directMessage || 'Provider token quota has been exhausted.',
      status: 403,
      type: asString(record.type),
      code: asString(record.code),
      providerName: asString(record.providerName),
      rechargeUrl: safeHttpUrl(record.rechargeUrl),
      tokenUrl: safeHttpUrl(record.tokenUrl),
      metadata: asRecord(record.metadata),
    })
  }

  return providerQuotaErrorFromUnknown(record.cause)
}
