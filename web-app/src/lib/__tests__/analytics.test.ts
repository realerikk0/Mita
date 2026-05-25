import { describe, expect, it } from 'vitest'

import { sanitizeAnalyticsProperties } from '@/lib/analytics'

describe('analytics sanitizer', () => {
  it('keeps product metadata and strips sensitive content', () => {
    const sanitized = sanitizeAnalyticsProperties({
      platform: 'desktop',
      provider_id: 'openai-compatible',
      model_id: 'gpt-5.4-mini',
      model_capabilities: ['tools', 'vision'],
      attachment_count: 2,
      prompt: 'never send this prompt',
      api_key: 'sk-secret',
      file_name: 'private.pdf',
      response_content: 'assistant body',
      current_url: 'https://example.com/private?token=1',
    })

    expect(sanitized).toMatchObject({
      platform: 'desktop',
      provider_id: 'openai-compatible',
      model_id: 'gpt-5.4-mini',
      model_capabilities: ['tools', 'vision'],
      attachment_count: 2,
    })
    expect(sanitized).not.toHaveProperty('prompt')
    expect(sanitized).not.toHaveProperty('api_key')
    expect(sanitized).not.toHaveProperty('file_name')
    expect(sanitized).not.toHaveProperty('response_content')
    expect(sanitized).not.toHaveProperty('current_url')
  })
})
