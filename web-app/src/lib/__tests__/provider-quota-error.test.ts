import { describe, expect, it } from 'vitest'

import {
  ProviderQuotaError,
  decodeProviderQuotaErrorMessage,
  encodeProviderQuotaError,
  parseProviderErrorResponse,
  providerQuotaErrorFromUnknown,
} from '@/lib/provider-quota-error'

const quotaBody = {
  error: {
    message: '该令牌额度已用尽，请充值后继续使用。',
    type: 'new_api_error',
    code: 'pre_consume_token_quota_failed',
    metadata: {
      quota_error: true,
      recharge_url: 'https://api.jingxing.uk/console/topup',
      token_url: 'https://api.jingxing.uk/console/token',
    },
  },
}

describe('provider quota error helpers', () => {
  it('parses quota error response details and links', async () => {
    const error = await parseProviderErrorResponse(
      new Response(JSON.stringify(quotaBody), { status: 403 }),
      'jingxing'
    )

    expect(error).toBeInstanceOf(ProviderQuotaError)
    expect(error?.message).toBe('该令牌额度已用尽，请充值后继续使用。')
    expect(error?.code).toBe('pre_consume_token_quota_failed')
    expect(error?.rechargeUrl).toBe('https://api.jingxing.uk/console/topup')
    expect(error?.tokenUrl).toBe('https://api.jingxing.uk/console/token')
    expect(error?.providerName).toBe('jingxing')
  })

  it('rejects non-http metadata links', async () => {
    const error = await parseProviderErrorResponse(
      new Response(
        JSON.stringify({
          error: {
            message: 'quota',
            code: 'pre_consume_token_quota_failed',
            metadata: {
              quota_error: true,
              recharge_url: 'javascript:alert(1)',
              token_url: 'file:///tmp/token',
            },
          },
        }),
        { status: 403 }
      )
    )

    expect(error?.rechargeUrl).toBeUndefined()
    expect(error?.tokenUrl).toBeUndefined()
  })

  it('encodes and decodes quota errors for stream error messages', () => {
    const error = new ProviderQuotaError({
      message: 'quota',
      status: 403,
      code: 'pre_consume_token_quota_failed',
      rechargeUrl: 'https://example.test/topup',
    })

    const encoded = encodeProviderQuotaError(error)
    expect(providerQuotaErrorFromUnknown(encoded)?.rechargeUrl).toBe(
      'https://example.test/topup'
    )
    expect(decodeProviderQuotaErrorMessage(encoded)?.message).toBe('quota')
  })
})

