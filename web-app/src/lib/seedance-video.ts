export const SEEDANCE_VIDEO_RATIOS = [
  'adaptive',
  '16:9',
  '9:16',
  '1:1',
  '4:3',
  '3:4',
  '21:9',
] as const

export const SEEDANCE_VIDEO_RESOLUTIONS = [
  '480p',
  '720p',
  '1080p',
  '4K',
] as const

export const SEEDANCE_FAST_VIDEO_RESOLUTIONS = ['480p', '720p'] as const

export const SEEDANCE_VIDEO_DURATION_RANGE = {
  min: 4,
  max: 15,
} as const

export const SEEDANCE_REFERENCE_LIMITS = {
  image: 9,
  video: 3,
  audio: 3,
  total: 15,
} as const

export const SEEDANCE_REFERENCE_SIZE_LIMIT_BYTES = {
  image: 30 * 1024 * 1024,
  video: 200 * 1024 * 1024,
  audio: 15 * 1024 * 1024,
} as const

export const SEEDANCE_REFERENCE_DURATION_LIMITS = {
  min: 2,
  max: 15,
  totalPerKind: 15,
} as const

export type SeedanceVideoRatio = (typeof SEEDANCE_VIDEO_RATIOS)[number]
export type SeedanceVideoResolution =
  (typeof SEEDANCE_VIDEO_RESOLUTIONS)[number]
export type SeedanceModelProfile = 'standard' | 'fast' | 'mini'
export type SeedanceReferenceKind = 'image' | 'video' | 'audio'
export type SeedanceReferenceRole =
  | 'reference_image'
  | 'reference_video'
  | 'reference_audio'
export type FixedSeedanceVideoRatio = Exclude<
  SeedanceVideoRatio,
  'adaptive'
>
export type SeedanceVideoDimensions = Readonly<{
  width: number
  height: number
}>

/** Output dimensions published for the standard Seedance 2.0 model. */
export const SEEDANCE_STANDARD_VIDEO_DIMENSIONS: Readonly<
  Record<
    SeedanceVideoResolution,
    Readonly<Record<FixedSeedanceVideoRatio, SeedanceVideoDimensions>>
  >
> = Object.freeze({
  '480p': Object.freeze({
    '16:9': Object.freeze({ width: 864, height: 480 }),
    '4:3': Object.freeze({ width: 736, height: 552 }),
    '1:1': Object.freeze({ width: 640, height: 640 }),
    '3:4': Object.freeze({ width: 552, height: 736 }),
    '9:16': Object.freeze({ width: 480, height: 864 }),
    '21:9': Object.freeze({ width: 980, height: 420 }),
  }),
  '720p': Object.freeze({
    '16:9': Object.freeze({ width: 1280, height: 720 }),
    '4:3': Object.freeze({ width: 1112, height: 834 }),
    '1:1': Object.freeze({ width: 960, height: 960 }),
    '3:4': Object.freeze({ width: 834, height: 1112 }),
    '9:16': Object.freeze({ width: 720, height: 1280 }),
    '21:9': Object.freeze({ width: 1470, height: 630 }),
  }),
  '1080p': Object.freeze({
    '16:9': Object.freeze({ width: 1920, height: 1080 }),
    '4:3': Object.freeze({ width: 1664, height: 1248 }),
    '1:1': Object.freeze({ width: 1440, height: 1440 }),
    '3:4': Object.freeze({ width: 1248, height: 1664 }),
    '9:16': Object.freeze({ width: 1080, height: 1920 }),
    '21:9': Object.freeze({ width: 2206, height: 946 }),
  }),
  '4K': Object.freeze({
    '16:9': Object.freeze({ width: 3840, height: 2160 }),
    '4:3': Object.freeze({ width: 3326, height: 2494 }),
    '1:1': Object.freeze({ width: 2880, height: 2880 }),
    '3:4': Object.freeze({ width: 2494, height: 3326 }),
    '9:16': Object.freeze({ width: 2160, height: 3840 }),
    '21:9': Object.freeze({ width: 4398, height: 1886 }),
  }),
})

export type SeedanceReferenceInput = {
  kind: SeedanceReferenceKind
  url: string
}

export type SeedanceReferenceCapabilities = Readonly<{
  maxImages: number
  maxVideos: number
  maxAudios: number
  maxMedia: number
  serializeMultimodalContent: boolean
}>

/**
 * Seedance 2.0's official multimodal reference limits. Keep this shared
 * capability object capped at the published limits even if a compatible
 * gateway currently accepts a larger request.
 */
export const SEEDANCE_MULTIMODAL_REFERENCE_CAPABILITIES: SeedanceReferenceCapabilities =
  Object.freeze({
    maxImages: SEEDANCE_REFERENCE_LIMITS.image,
    maxVideos: SEEDANCE_REFERENCE_LIMITS.video,
    maxAudios: SEEDANCE_REFERENCE_LIMITS.audio,
    maxMedia: SEEDANCE_REFERENCE_LIMITS.total,
    serializeMultimodalContent: true,
  })

/**
 * Biyuan's production gateway supports Seedance's official image/video/audio
 * limits. Remote references are serialized under `metadata.content`, while
 * local references are uploaded separately and submitted as media tickets.
 */
export const BIYUAN_PUBLIC_SEEDANCE_REFERENCE_CAPABILITIES: SeedanceReferenceCapabilities =
  SEEDANCE_MULTIMODAL_REFERENCE_CAPABILITIES

export type SeedanceValidationErrorCode =
  | 'duration_out_of_range'
  | 'unsupported_ratio'
  | 'unsupported_resolution'
  | 'too_many_images'
  | 'too_many_videos'
  | 'too_many_audios'
  | 'too_many_media'
  | 'audio_requires_visual_reference'
  | 'multimodal_content_not_enabled'
  | 'ambiguous_reference_source'
  | 'mixed_reference_sources_not_supported'
  | 'invalid_reference_duration'
  | 'reference_duration_total_exceeded'
  | 'invalid_reference_url'
  | 'reference_mime_mismatch'

export class SeedanceValidationError extends Error {
  readonly code: SeedanceValidationErrorCode

  constructor(code: SeedanceValidationErrorCode, message: string) {
    super(message)
    this.name = 'SeedanceValidationError'
    this.code = code
  }
}

export type SeedanceReferenceCounts = {
  image: number
  video: number
  audio: number
  total: number
}

export function isSeedanceVideoModel(modelId?: string | null) {
  const normalized = modelId?.trim().toLowerCase() ?? ''
  return normalized.includes('seedance') || /sd2[.-]?0/.test(normalized)
}

export function seedanceModelProfile(
  modelId?: string | null
): SeedanceModelProfile {
  const normalized = modelId?.trim().toLowerCase() ?? ''
  if (normalized.includes('mini')) return 'mini'
  if (normalized.includes('fast')) return 'fast'
  return 'standard'
}

export function validateSeedanceVideoInput(input: {
  modelId?: string
  duration: number
  ratio: string
  resolution: string
  references?: readonly SeedanceReferenceInput[]
  capabilities?: SeedanceReferenceCapabilities
}) {
  if (
    !Number.isInteger(input.duration) ||
    input.duration < SEEDANCE_VIDEO_DURATION_RANGE.min ||
    input.duration > SEEDANCE_VIDEO_DURATION_RANGE.max
  ) {
    throw new SeedanceValidationError(
      'duration_out_of_range',
      `Seedance duration must be an integer from ${SEEDANCE_VIDEO_DURATION_RANGE.min} to ${SEEDANCE_VIDEO_DURATION_RANGE.max} seconds`
    )
  }

  if (!isSeedanceVideoRatio(input.ratio)) {
    throw new SeedanceValidationError(
      'unsupported_ratio',
      `Unsupported Seedance ratio: ${input.ratio}`
    )
  }

  if (
    !isSeedanceVideoResolutionForModel(input.resolution, input.modelId)
  ) {
    const profile = seedanceModelProfile(input.modelId)
    const supported =
      profile === 'standard'
        ? SEEDANCE_VIDEO_RESOLUTIONS
        : SEEDANCE_FAST_VIDEO_RESOLUTIONS
    throw new SeedanceValidationError(
      'unsupported_resolution',
      `Unsupported Seedance ${profile} resolution: ${input.resolution}. Supported values: ${supported.join(', ')}`
    )
  }

  return validateSeedanceReferences(
    input.references ?? [],
    input.capabilities ?? BIYUAN_PUBLIC_SEEDANCE_REFERENCE_CAPABILITIES
  )
}

export function validateSeedanceReferences(
  references: readonly SeedanceReferenceInput[],
  capabilities: SeedanceReferenceCapabilities
): SeedanceReferenceCounts {
  const counts = referenceCounts(references)
  const imageLimit = effectiveLimit(
    capabilities.maxImages,
    SEEDANCE_REFERENCE_LIMITS.image
  )
  const videoLimit = effectiveLimit(
    capabilities.maxVideos,
    SEEDANCE_REFERENCE_LIMITS.video
  )
  const audioLimit = effectiveLimit(
    capabilities.maxAudios,
    SEEDANCE_REFERENCE_LIMITS.audio
  )
  const mediaLimit = effectiveLimit(
    capabilities.maxMedia,
    SEEDANCE_REFERENCE_LIMITS.total
  )

  if (counts.image > imageLimit) {
    throw new SeedanceValidationError(
      'too_many_images',
      `Seedance accepts at most ${imageLimit} image reference${imageLimit === 1 ? '' : 's'} for this provider`
    )
  }
  if (counts.video > videoLimit) {
    throw new SeedanceValidationError(
      'too_many_videos',
      `Seedance accepts at most ${videoLimit} video reference${videoLimit === 1 ? '' : 's'} for this provider`
    )
  }
  if (counts.audio > audioLimit) {
    throw new SeedanceValidationError(
      'too_many_audios',
      `Seedance accepts at most ${audioLimit} audio reference${audioLimit === 1 ? '' : 's'} for this provider`
    )
  }
  if (counts.total > mediaLimit) {
    throw new SeedanceValidationError(
      'too_many_media',
      `Seedance accepts at most ${mediaLimit} media reference${mediaLimit === 1 ? '' : 's'} for this provider`
    )
  }
  if (counts.audio > 0 && counts.image + counts.video === 0) {
    throw new SeedanceValidationError(
      'audio_requires_visual_reference',
      'Seedance audio references require at least one image or video reference'
    )
  }

  references.forEach(validateReferenceUrl)
  return counts
}

export function serializeSeedanceReferenceContent(
  references: readonly SeedanceReferenceInput[],
  capabilities: SeedanceReferenceCapabilities
) {
  validateSeedanceReferences(references, capabilities)
  if (!capabilities.serializeMultimodalContent && references.length > 0) {
    throw new SeedanceValidationError(
      'multimodal_content_not_enabled',
      'Seedance multimodal content serialization is not enabled for this provider'
    )
  }

  return references.map((reference) => {
    if (reference.kind === 'image') {
      return {
        type: 'image_url' as const,
        role: seedanceReferenceRole(reference.kind),
        image_url: { url: reference.url },
      }
    }
    if (reference.kind === 'video') {
      return {
        type: 'video_url' as const,
        role: seedanceReferenceRole(reference.kind),
        video_url: { url: reference.url },
      }
    }
    return {
      type: 'audio_url' as const,
      role: seedanceReferenceRole(reference.kind),
      audio_url: { url: reference.url },
    }
  })
}

export function seedanceReferenceRole(
  kind: SeedanceReferenceKind
): SeedanceReferenceRole {
  return `reference_${kind}`
}

export function isSeedanceVideoRatio(
  value: string
): value is SeedanceVideoRatio {
  return (SEEDANCE_VIDEO_RATIOS as readonly string[]).includes(value)
}

export function isSeedanceVideoResolution(
  value: string
): value is SeedanceVideoResolution {
  return (SEEDANCE_VIDEO_RESOLUTIONS as readonly string[]).includes(value)
}

export function isSeedanceVideoResolutionForModel(
  value: string,
  modelId?: string | null
) {
  const profile = seedanceModelProfile(modelId)
  if (profile === 'standard') return isSeedanceVideoResolution(value)
  return (SEEDANCE_FAST_VIDEO_RESOLUTIONS as readonly string[]).includes(value)
}

function referenceCounts(
  references: readonly SeedanceReferenceInput[]
): SeedanceReferenceCounts {
  const counts: SeedanceReferenceCounts = {
    image: 0,
    video: 0,
    audio: 0,
    total: references.length,
  }

  references.forEach((reference) => {
    counts[reference.kind] += 1
  })
  return counts
}

function effectiveLimit(configured: number, official: number) {
  if (!Number.isInteger(configured) || configured < 0) return 0
  return Math.min(configured, official)
}

function validateReferenceUrl(reference: SeedanceReferenceInput) {
  const value = reference.url.trim()
  if (!value) {
    throw invalidReferenceUrl(reference.kind)
  }

  if (value.toLowerCase().startsWith('data:')) {
    if (reference.kind === 'video') {
      throw invalidReferenceUrl(reference.kind)
    }
    const commaIndex = value.indexOf(',')
    const header = commaIndex >= 0 ? value.slice(5, commaIndex) : ''
    const payload = commaIndex >= 0 ? value.slice(commaIndex + 1) : ''
    const [mimeType, ...parameters] = header.split(';')
    const isBase64 = parameters.some(
      (parameter) => parameter.toLowerCase() === 'base64'
    )

    if (!mimeType || !isBase64 || !payload.trim()) {
      throw invalidReferenceUrl(reference.kind)
    }
    if (!mimeType.toLowerCase().startsWith(`${reference.kind}/`)) {
      throw new SeedanceValidationError(
        'reference_mime_mismatch',
        `Seedance ${reference.kind} reference must use a ${reference.kind} MIME type`
      )
    }
    return
  }

  try {
    const url = new URL(value)
    if (
      (url.protocol !== 'https:' && url.protocol !== 'http:') ||
      url.username ||
      url.password
    ) {
      throw invalidReferenceUrl(reference.kind)
    }
  } catch (error) {
    if (error instanceof SeedanceValidationError) throw error
    throw invalidReferenceUrl(reference.kind)
  }
}

function invalidReferenceUrl(kind: SeedanceReferenceKind) {
  const supportedSource =
    kind === 'video'
      ? 'an HTTP(S) URL'
      : 'an HTTP(S) URL or a matching base64 data URL'
  return new SeedanceValidationError(
    'invalid_reference_url',
    `Seedance ${kind} reference must use ${supportedSource}`
  )
}
