import {
  isSeedanceVideoModel,
  SEEDANCE_STANDARD_VIDEO_DIMENSIONS,
  seedanceModelProfile,
  type SeedanceReferenceKind,
  type SeedanceVideoDimensions,
  type SeedanceVideoRatio,
  type SeedanceVideoResolution,
} from '@/lib/seedance-video'

export {
  SEEDANCE_STANDARD_VIDEO_DIMENSIONS,
  type SeedanceVideoDimensions,
} from '@/lib/seedance-video'

export type SeedanceCostReference = Readonly<{
  kind: SeedanceReferenceKind
  durationSeconds?: number
}>

export type SeedanceCostEstimateWarning =
  | 'adaptive_ratio'
  | 'invalid_duration'
  | 'unknown_reference_video_duration'
  | 'unsupported_model'
  | 'unsupported_ratio'
  | 'unsupported_resolution'

export type SeedanceVideoCostEstimate = Readonly<{
  estimatedTokens?: number
  estimatedPriceCny?: number
  dimensions?: SeedanceVideoDimensions
  knownReferenceVideoDuration: number
  isLowerBound: boolean
  warnings: readonly SeedanceCostEstimateWarning[]
}>

export type EstimateSeedanceVideoCostInput = Readonly<{
  model: string
  ratio: SeedanceVideoRatio | string
  resolution: SeedanceVideoResolution | string
  duration: number
  references?: readonly SeedanceCostReference[]
  pricePerMillionCny?: number
}>

/**
 * Estimates Seedance output tokens from video pixels at 24 fps. Known
 * reference-video duration contributes to billed processing time. When a
 * reference video has no duration metadata, the result is explicitly marked
 * as a lower bound.
 */
export function estimateSeedanceVideoCost(
  input: EstimateSeedanceVideoCostInput
): SeedanceVideoCostEstimate {
  const warnings: SeedanceCostEstimateWarning[] = []
  const references = input.references ?? []
  const referenceDuration = referenceVideoDuration(references)

  if (
    !isSeedanceVideoModel(input.model) ||
    seedanceModelProfile(input.model) !== 'standard'
  ) {
    warnings.push('unsupported_model')
  }

  if (!Number.isFinite(input.duration) || input.duration <= 0) {
    warnings.push('invalid_duration')
  }

  if (input.ratio === 'adaptive') {
    warnings.push('adaptive_ratio')
  }

  if (referenceDuration.hasUnknownDuration) {
    warnings.push('unknown_reference_video_duration')
  }

  const dimensions = dimensionsFor(input.resolution, input.ratio)
  if (!dimensions && input.ratio !== 'adaptive') {
    if (!(input.resolution in SEEDANCE_STANDARD_VIDEO_DIMENSIONS)) {
      warnings.push('unsupported_resolution')
    } else {
      warnings.push('unsupported_ratio')
    }
  }

  const cannotEstimate =
    warnings.includes('unsupported_model') ||
    warnings.includes('invalid_duration') ||
    warnings.includes('adaptive_ratio') ||
    !dimensions

  if (cannotEstimate) {
    return {
      knownReferenceVideoDuration: referenceDuration.seconds,
      isLowerBound: referenceDuration.hasUnknownDuration,
      warnings,
    }
  }

  const estimatedTokens = Math.ceil(
    ((input.duration + referenceDuration.seconds) *
      dimensions.width *
      dimensions.height *
      24) /
      1024
  )
  const pricePerMillionCny = positiveNumber(input.pricePerMillionCny)

  return {
    estimatedTokens,
    ...(pricePerMillionCny !== undefined
      ? {
          estimatedPriceCny:
            (estimatedTokens * pricePerMillionCny) / 1_000_000,
        }
      : {}),
    dimensions,
    knownReferenceVideoDuration: referenceDuration.seconds,
    isLowerBound: referenceDuration.hasUnknownDuration,
    warnings,
  }
}

/**
 * Parses Biyuan's public `/api/pricing` and `/api/status` payloads. Video
 * pricing is expressed as:
 *
 * model_ratio × 2 × completion_ratio × group_ratio USD / 1M tokens
 *
 * and is converted with `status.data.usd_exchange_rate`.
 */
export function parseBiyuanSeedancePricePerMillionCny(
  pricingResponse: unknown,
  statusResponse: unknown,
  model: string,
  group = 'default'
): number | undefined {
  const pricing = recordValue(pricingResponse)
  const pricingData = Array.isArray(pricing.data) ? pricing.data : []
  const modelPricing = pricingData
    .map(recordValue)
    .find((entry) => stringValue(entry.model_name) === model)
  if (!modelPricing) return undefined

  const modelRatio = positiveNumber(modelPricing.model_ratio)
  const completionRatio = positiveNumber(modelPricing.completion_ratio)
  const groupRatios = recordValue(pricing.group_ratio)
  const groupRatio = positiveNumber(groupRatios[group])
  const status = recordValue(statusResponse)
  const statusData = recordValue(status.data)
  const usdExchangeRate = positiveNumber(
    statusData.usd_exchange_rate ?? status.usd_exchange_rate
  )

  if (
    modelRatio === undefined ||
    completionRatio === undefined ||
    groupRatio === undefined ||
    usdExchangeRate === undefined
  ) {
    return undefined
  }

  return modelRatio * 2 * completionRatio * groupRatio * usdExchangeRate
}

function dimensionsFor(
  resolution: string,
  ratio: string
): SeedanceVideoDimensions | undefined {
  const resolutionTable = (
    SEEDANCE_STANDARD_VIDEO_DIMENSIONS as Readonly<
      Record<string, Readonly<Record<string, SeedanceVideoDimensions>>>
    >
  )[resolution]
  return resolutionTable?.[ratio]
}

function referenceVideoDuration(
  references: readonly SeedanceCostReference[]
) {
  let seconds = 0
  let hasUnknownDuration = false

  references.forEach((reference) => {
    if (reference.kind !== 'video') return
    const duration = positiveNumber(reference.durationSeconds)
    if (duration === undefined) {
      hasUnknownDuration = true
      return
    }
    seconds += duration
  })

  return { seconds, hasUnknownDuration }
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function positiveNumber(value: unknown): number | undefined {
  const number =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : Number.NaN
  return Number.isFinite(number) && number > 0 ? number : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
