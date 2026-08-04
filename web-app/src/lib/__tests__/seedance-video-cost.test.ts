import { describe, expect, it } from 'vitest'

import {
  estimateSeedanceVideoCost,
  parseBiyuanSeedancePricePerMillionCny,
} from '../seedance-video-cost'

const model = 'doubao-seedance-2-0-260128'

describe('Seedance video cost estimation', () => {
  it.each([
    ['720p', 108_000],
    ['1080p', 243_000],
    ['4K', 972_000],
  ] as const)('estimates 5 seconds of 16:9 %s video', (resolution, tokens) => {
    expect(
      estimateSeedanceVideoCost({
        model,
        ratio: '16:9',
        resolution,
        duration: 5,
      })
    ).toMatchObject({
      estimatedTokens: tokens,
      knownReferenceVideoDuration: 0,
      isLowerBound: false,
      warnings: [],
    })
  })

  it('includes known reference-video duration', () => {
    expect(
      estimateSeedanceVideoCost({
        model,
        ratio: '16:9',
        resolution: '720p',
        duration: 5,
        references: [{ kind: 'video', durationSeconds: 3 }],
      })
    ).toMatchObject({
      estimatedTokens: 172_800,
      knownReferenceVideoDuration: 3,
      isLowerBound: false,
    })
  })

  it('marks unknown reference-video duration as a lower bound', () => {
    expect(
      estimateSeedanceVideoCost({
        model,
        ratio: '16:9',
        resolution: '720p',
        duration: 5,
        references: [{ kind: 'video' }],
      })
    ).toMatchObject({
      estimatedTokens: 108_000,
      knownReferenceVideoDuration: 0,
      isLowerBound: true,
      warnings: ['unknown_reference_video_duration'],
    })
  })

  it('does not estimate adaptive output dimensions', () => {
    expect(
      estimateSeedanceVideoCost({
        model,
        ratio: 'adaptive',
        resolution: '720p',
        duration: 5,
      })
    ).toEqual({
      knownReferenceVideoDuration: 0,
      isLowerBound: false,
      warnings: ['adaptive_ratio'],
    })
  })

  it('calculates a CNY estimate when a dynamic price is provided', () => {
    expect(
      estimateSeedanceVideoCost({
        model,
        ratio: '16:9',
        resolution: '720p',
        duration: 5,
        pricePerMillionCny: 54.6,
      }).estimatedPriceCny
    ).toBeCloseTo(5.8968)
  })
})

describe('Biyuan Seedance pricing', () => {
  it('parses model, completion, group, and exchange-rate multipliers', () => {
    expect(
      parseBiyuanSeedancePricePerMillionCny(
        {
          auto_groups: ['default'],
          data: [
            {
              model_name: model,
              model_ratio: 3.9,
              completion_ratio: 1,
            },
          ],
          group_ratio: {
            default: 1,
          },
        },
        {
          data: {
            usd_exchange_rate: 7,
          },
        },
        model
      )
    ).toBeCloseTo(54.6)
  })

  it('returns undefined for incomplete public pricing data', () => {
    expect(
      parseBiyuanSeedancePricePerMillionCny(
        {
          data: [{ model_name: model, model_ratio: 3.9 }],
          group_ratio: { default: 1 },
        },
        { data: { usd_exchange_rate: 7 } },
        model
      )
    ).toBeUndefined()
  })
})
