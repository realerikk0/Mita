import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'

import { canUseJingxingNativeWebSearch } from '../jingxing-responses-web-search'

describe('canUseJingxingNativeWebSearch', () => {
  it('keeps native web search enabled after assistant source annotations', () => {
    const messages = [
      {
        id: 'u1',
        role: 'user',
        parts: [{ type: 'text', text: '查一下 POET 下次财报' }],
      },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'POET 下次财报预计在 2026-05-14。' },
          {
            type: 'source-url',
            sourceId: 'web-1',
            url: 'https://example.com',
            title: 'Example',
          },
        ],
      },
      {
        id: 'u2',
        role: 'user',
        parts: [{ type: 'text', text: '继续查' }],
      },
    ] as unknown as UIMessage[]

    expect(
      canUseJingxingNativeWebSearch({
        providerName: 'jingxing',
        modelId: 'gpt-5.4',
        messages,
      })
    ).toBe(true)
  })

  it('does not use native web search when the user message contains files', () => {
    const messages = [
      {
        id: 'u1',
        role: 'user',
        parts: [
          { type: 'text', text: '分析这张图' },
          {
            type: 'file',
            mediaType: 'image/png',
            url: 'data:image/png;base64,abc',
          },
        ],
      },
    ] as unknown as UIMessage[]

    expect(
      canUseJingxingNativeWebSearch({
        providerName: 'jingxing',
        modelId: 'gpt-5.4',
        messages,
      })
    ).toBe(false)
  })

  it('only enables the branch for Jingxing native web search models', () => {
    const messages = [
      {
        id: 'u1',
        role: 'user',
        parts: [{ type: 'text', text: '查一下新闻' }],
      },
    ] as unknown as UIMessage[]

    expect(
      canUseJingxingNativeWebSearch({
        providerName: 'openai',
        modelId: 'gpt-5.4',
        messages,
      })
    ).toBe(false)

    expect(
      canUseJingxingNativeWebSearch({
        providerName: 'jingxing',
        modelId: 'gemini-3.5-flash',
        messages,
      })
    ).toBe(false)

    expect(
      canUseJingxingNativeWebSearch({
        providerName: 'jingxing',
        modelId: 'claude-sonnet-4-6',
        messages,
      })
    ).toBe(false)
  })
})
