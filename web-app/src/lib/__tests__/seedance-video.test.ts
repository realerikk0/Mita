import { describe, expect, it } from 'vitest'

import {
  BIYUAN_PUBLIC_SEEDANCE_REFERENCE_CAPABILITIES,
  SEEDANCE_MULTIMODAL_REFERENCE_CAPABILITIES,
  SeedanceValidationError,
  serializeSeedanceReferenceContent,
  validateSeedanceReferences,
  validateSeedanceVideoInput,
  type SeedanceReferenceCapabilities,
  type SeedanceReferenceInput,
} from '../seedance-video'

const image = (index: number): SeedanceReferenceInput => ({
  kind: 'image',
  url: `https://assets.example.test/image-${index}.png`,
})
const video = (index: number): SeedanceReferenceInput => ({
  kind: 'video',
  url: `https://assets.example.test/video-${index}.mp4`,
})
const audio = (index: number): SeedanceReferenceInput => ({
  kind: 'audio',
  url: `https://assets.example.test/audio-${index}.mp3`,
})

function expectCode(run: () => unknown, code: SeedanceValidationError['code']) {
  try {
    run()
    throw new Error('Expected validation to fail')
  } catch (error) {
    expect(error).toBeInstanceOf(SeedanceValidationError)
    expect((error as SeedanceValidationError).code).toBe(code)
  }
}

describe('Seedance video validation', () => {
  it('accepts the official duration, ratio, resolution, and media limits', () => {
    const references = [
      ...Array.from({ length: 9 }, (_, index) => image(index)),
      ...Array.from({ length: 3 }, (_, index) => video(index)),
      ...Array.from({ length: 3 }, (_, index) => audio(index)),
    ]

    expect(
      validateSeedanceVideoInput({
        duration: 4,
        ratio: 'adaptive',
        resolution: '480p',
        references,
        capabilities: SEEDANCE_MULTIMODAL_REFERENCE_CAPABILITIES,
      })
    ).toEqual({ image: 9, video: 3, audio: 3, total: 15 })

    expect(
      validateSeedanceVideoInput({
        modelId: 'seedance-2.0',
        duration: 15,
        ratio: '21:9',
        resolution: '4K',
        capabilities: SEEDANCE_MULTIMODAL_REFERENCE_CAPABILITIES,
      })
    ).toEqual({ image: 0, video: 0, audio: 0, total: 0 })
  })

  it.each([
    [3, 'duration_out_of_range'],
    [16, 'duration_out_of_range'],
    [4.5, 'duration_out_of_range'],
  ] as const)('rejects duration %s', (duration, code) => {
    expectCode(
      () =>
        validateSeedanceVideoInput({
          duration,
          ratio: '16:9',
          resolution: '720p',
        }),
      code
    )
  })

  it('rejects unsupported ratios and resolutions', () => {
    expectCode(
      () =>
        validateSeedanceVideoInput({
          duration: 8,
          ratio: '3:2',
          resolution: '720p',
        }),
      'unsupported_ratio'
    )
    expectCode(
      () =>
        validateSeedanceVideoInput({
          duration: 8,
          ratio: '16:9',
          resolution: '8K',
        }),
      'unsupported_resolution'
    )
  })

  it('restricts Fast and Mini profiles to 480p and 720p', () => {
    expect(() =>
      validateSeedanceVideoInput({
        modelId: 'seedance-2.0-fast',
        duration: 8,
        ratio: '16:9',
        resolution: '720p',
      })
    ).not.toThrow()
    expectCode(
      () =>
        validateSeedanceVideoInput({
          modelId: 'seedance-2.0-mini',
          duration: 8,
          ratio: '16:9',
          resolution: '1080p',
        }),
      'unsupported_resolution'
    )
  })

  it('enforces each official media limit', () => {
    expectCode(
      () =>
        validateSeedanceReferences(
          Array.from({ length: 10 }, (_, index) => image(index)),
          SEEDANCE_MULTIMODAL_REFERENCE_CAPABILITIES
        ),
      'too_many_images'
    )
    expectCode(
      () =>
        validateSeedanceReferences(
          [image(0), ...Array.from({ length: 4 }, (_, index) => video(index))],
          SEEDANCE_MULTIMODAL_REFERENCE_CAPABILITIES
        ),
      'too_many_videos'
    )
    expectCode(
      () =>
        validateSeedanceReferences(
          [image(0), ...Array.from({ length: 4 }, (_, index) => audio(index))],
          SEEDANCE_MULTIMODAL_REFERENCE_CAPABILITIES
        ),
      'too_many_audios'
    )
  })

  it('enforces provider total-media limits independently', () => {
    const capabilities: SeedanceReferenceCapabilities = {
      ...SEEDANCE_MULTIMODAL_REFERENCE_CAPABILITIES,
      maxMedia: 2,
    }
    expectCode(
      () =>
        validateSeedanceReferences(
          [image(0), image(1), video(0)],
          capabilities
        ),
      'too_many_media'
    )
  })

  it('does not allow audio to be the only reference media', () => {
    expectCode(
      () =>
        validateSeedanceReferences(
          [audio(0)],
          SEEDANCE_MULTIMODAL_REFERENCE_CAPABILITIES
        ),
      'audio_requires_visual_reference'
    )
  })

  it('uses the verified Biyuan multimodal content contract', () => {
    const references = [
      ...Array.from({ length: 9 }, (_, index) => image(index)),
      ...Array.from({ length: 3 }, (_, index) => video(index)),
      ...Array.from({ length: 3 }, (_, index) => audio(index)),
    ]

    expect(
      validateSeedanceReferences(
        references,
        BIYUAN_PUBLIC_SEEDANCE_REFERENCE_CAPABILITIES
      )
    ).toEqual({ image: 9, video: 3, audio: 3, total: 15 })

    expectCode(
      () =>
        validateSeedanceReferences(
          Array.from({ length: 10 }, (_, index) => image(index)),
          BIYUAN_PUBLIC_SEEDANCE_REFERENCE_CAPABILITIES
        ),
      'too_many_images'
    )
  })

  it('serializes Biyuan image, video, and audio references as content entries', () => {
    expect(
      serializeSeedanceReferenceContent(
        [image(0), video(0), audio(0)],
        BIYUAN_PUBLIC_SEEDANCE_REFERENCE_CAPABILITIES
      )
    ).toEqual([
      { type: 'image_url', image_url: { url: image(0).url } },
      { type: 'video_url', video_url: { url: video(0).url } },
      { type: 'audio_url', audio_url: { url: audio(0).url } },
    ])
  })

  it('rejects multimodal serialization when a provider has not opted in', () => {
    const legacyCapabilities: SeedanceReferenceCapabilities = {
      maxImages: 1,
      maxVideos: 0,
      maxAudios: 0,
      maxMedia: 1,
      serializeMultimodalContent: false,
    }

    expectCode(
      () =>
        serializeSeedanceReferenceContent(
          [image(0)],
          legacyCapabilities
        ),
      'multimodal_content_not_enabled'
    )
  })

  it('accepts matching data URLs and rejects unsafe or mismatched URLs', () => {
    expect(() =>
      validateSeedanceReferences(
        [{ kind: 'video', url: 'data:video/mp4;base64,AQID' }],
        SEEDANCE_MULTIMODAL_REFERENCE_CAPABILITIES
      )
    ).not.toThrow()

    expectCode(
      () =>
        validateSeedanceReferences(
          [{ kind: 'image', url: 'file:///private/reference.png' }],
          SEEDANCE_MULTIMODAL_REFERENCE_CAPABILITIES
        ),
      'invalid_reference_url'
    )
    expectCode(
      () =>
        validateSeedanceReferences(
          [
            image(0),
            { kind: 'audio', url: 'data:video/mp4;base64,AQID' },
          ],
          SEEDANCE_MULTIMODAL_REFERENCE_CAPABILITIES
        ),
      'reference_mime_mismatch'
    )
  })
})
