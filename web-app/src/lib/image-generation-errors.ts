export type ImageGenerationRequestErrorKind =
  | 'rate_limited'
  | 'timeout'
  | 'invalid_source_image'

export type ImageGenerationRequestErrorDetails = {
  message: string
  status: number
  statusText?: string
  kind: ImageGenerationRequestErrorKind
  retryAfterMs: number
  sourceImageIndex?: number
}

type ProviderErrorJson = {
  error?: {
    message?: unknown
  }
  message?: unknown
}

const DEFAULT_RATE_LIMIT_RETRY_MS = 30_000
const DEFAULT_TIMEOUT_RETRY_MS = 60_000
const INVALID_IMAGE_MESSAGE_PATTERN =
  /invalid image file(?: or mode)?(?: for image\s+(\d+))?/i

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value
    : undefined
}

function retryAfterMs(response: Response, fallback: number) {
  const raw = response.headers.get('retry-after')
  if (!raw) return fallback

  const seconds = Number(raw)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.max(1000, Math.round(seconds * 1000))
  }

  const dateMs = Date.parse(raw)
  if (Number.isFinite(dateMs)) {
    return Math.max(1000, dateMs - Date.now())
  }

  return fallback
}

function messageFromJson(text: string) {
  try {
    const json = JSON.parse(text) as ProviderErrorJson
    return asString(json.error?.message) || asString(json.message)
  } catch {
    return undefined
  }
}

export class ImageGenerationRequestError extends Error {
  readonly imageGenerationRequestError = true
  readonly status: number
  readonly statusText?: string
  readonly kind: ImageGenerationRequestErrorKind
  readonly retryAfterMs: number
  readonly sourceImageIndex?: number

  constructor(details: ImageGenerationRequestErrorDetails) {
    super(details.message)
    this.name = 'ImageGenerationRequestError'
    this.status = details.status
    this.statusText = details.statusText
    this.kind = details.kind
    this.retryAfterMs = details.retryAfterMs
    this.sourceImageIndex = details.sourceImageIndex
  }

  toJSON(): ImageGenerationRequestErrorDetails {
    return {
      message: this.message,
      status: this.status,
      statusText: this.statusText,
      kind: this.kind,
      retryAfterMs: this.retryAfterMs,
      sourceImageIndex: this.sourceImageIndex,
    }
  }
}

export async function parseImageGenerationErrorResponse(
  response: Response
): Promise<ImageGenerationRequestError | undefined> {
  if (![400, 429, 524].includes(response.status)) return undefined

  const text = await response
    .clone()
    .text()
    .catch(() => '')
  const providerMessage = messageFromJson(text)
  const invalidImageMatch =
    response.status === 400
      ? INVALID_IMAGE_MESSAGE_PATTERN.exec(providerMessage || text)
      : null

  if (response.status === 400 && !invalidImageMatch) return undefined

  const kind: ImageGenerationRequestErrorKind =
    response.status === 429
      ? 'rate_limited'
      : response.status === 524
        ? 'timeout'
        : 'invalid_source_image'
  const fallbackMessage =
    kind === 'rate_limited'
      ? 'Image provider is busy. Please wait a moment and retry.'
      : kind === 'timeout'
        ? 'Image request timed out. Please wait a moment and retry.'
        : 'One of the reference images could not be read by the provider.'
  const sourceImageIndex = invalidImageMatch?.[1]
    ? Number(invalidImageMatch[1])
    : undefined

  return new ImageGenerationRequestError({
    message: providerMessage || fallbackMessage,
    status: response.status,
    statusText: response.statusText,
    kind,
    retryAfterMs: retryAfterMs(
      response,
      kind === 'rate_limited'
        ? DEFAULT_RATE_LIMIT_RETRY_MS
        : kind === 'timeout'
          ? DEFAULT_TIMEOUT_RETRY_MS
          : 0
    ),
    sourceImageIndex,
  })
}

export function imageGenerationRequestErrorFromUnknown(
  error: unknown
): ImageGenerationRequestError | undefined {
  if (error instanceof ImageGenerationRequestError) return error

  if (!error || typeof error !== 'object') return undefined
  const record = error as Partial<ImageGenerationRequestErrorDetails> & {
    imageGenerationRequestError?: unknown
    cause?: unknown
  }

  if (
    record.imageGenerationRequestError === true &&
    typeof record.message === 'string' &&
    typeof record.status === 'number' &&
    (record.kind === 'rate_limited' || record.kind === 'timeout')
  ) {
    return new ImageGenerationRequestError({
      message: record.message,
      status: record.status,
      statusText: record.statusText,
      kind: record.kind,
      retryAfterMs:
        typeof record.retryAfterMs === 'number'
          ? record.retryAfterMs
          : record.kind === 'rate_limited'
            ? DEFAULT_RATE_LIMIT_RETRY_MS
            : record.kind === 'timeout'
              ? DEFAULT_TIMEOUT_RETRY_MS
              : 0,
      sourceImageIndex:
        typeof record.sourceImageIndex === 'number'
          ? record.sourceImageIndex
          : undefined,
    })
  }

  return imageGenerationRequestErrorFromUnknown(record.cause)
}
