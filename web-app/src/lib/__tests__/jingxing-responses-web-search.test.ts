import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'

import {
  buildJingxingNativeWebSearchRequest,
  buildJingxingResponsesChatRequest,
  canUseJingxingNativeWebSearch,
  geminiGenerateContentResponseToOutput,
  JINGXING_WEB_SEARCH_OPTIONS,
  jingxingWebSearchOptionsForDepth,
} from '../jingxing-responses-web-search'

const textMessages = [
  {
    id: 'u1',
    role: 'user',
    parts: [{ type: 'text', text: '查一下新闻' }],
  },
] as unknown as UIMessage[]

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

  it('enables the branch for Jingxing native web search models', () => {
    expect(
      canUseJingxingNativeWebSearch({
        providerName: 'openai',
        modelId: 'gpt-5.4',
        messages: textMessages,
      })
    ).toBe(false)

    for (const modelId of [
      'gpt-5.4',
      'gpt-5.4-pro',
      'gpt-5.3-codex',
      'grok-4.3',
      'gemini-3.5-flash',
      'gemini-3.1-pro-preview',
      'gemini-3-flash-preview',
      'claude-opus-4-8',
    ]) {
      expect(
        canUseJingxingNativeWebSearch({
          providerName: 'jingxing',
          modelId,
          messages: textMessages,
        })
      ).toBe(true)
    }

    expect(
      canUseJingxingNativeWebSearch({
        providerName: 'jingxing',
        modelId: 'claude-sonnet-4-6',
        messages: textMessages,
      })
    ).toBe(true)
  })

  it('enables Biyuan-family providers without matching unrelated hosts', () => {
    expect(
      canUseJingxingNativeWebSearch({
        providerName: 'biyuan',
        modelId: 'gpt-5.4',
        messages: textMessages,
      })
    ).toBe(true)
    expect(
      canUseJingxingNativeWebSearch({
        providerName: 'openai-compatible',
        baseUrl: 'https://api.biyuan.ai/v1',
        modelId: 'gpt-5.4',
        messages: textMessages,
      })
    ).toBe(true)
    expect(
      canUseJingxingNativeWebSearch({
        providerName: 'openai-compatible',
        baseUrl: 'https://api.biyuan.ai.example.com/v1',
        modelId: 'gpt-5.4',
        messages: textMessages,
      })
    ).toBe(false)
    expect(
      canUseJingxingNativeWebSearch({
        providerName: 'third-party-biyuan-proxy',
        baseUrl: 'https://api.example.test/v1',
        modelId: 'gpt-5.4',
        messages: textMessages,
      })
    ).toBe(false)
  })

  it('builds Responses requests with dynamic unified web_search_options', () => {
    for (const modelId of ['gpt-5.4', 'grok-4.3', 'gpt-5.3-codex']) {
      const request = buildJingxingNativeWebSearchRequest({
        modelId,
        baseUrl: 'https://api.jingxing.uk/v1',
        messages: textMessages,
        system: 'You are helpful',
        searchDepth: 'high',
        maxOutputTokens: 512,
      })

      expect(request.transport).toBe('responses')
      expect(request.endpoint).toBe('https://api.jingxing.uk/v1/responses')
      expect(request.body).toMatchObject({
        model: modelId,
        input: [{ role: 'user', content: '查一下新闻' }],
        instructions: 'You are helpful',
        stream: true,
        max_output_tokens: 4096,
        web_search_options: jingxingWebSearchOptionsForDepth('high'),
      })
      expect(request.body).not.toHaveProperty('tools')
      expect(request.body).not.toHaveProperty('tool_choice')
      expect(JSON.stringify(request.body)).not.toContain('x_search')
    }
  })

  it('keeps Responses-only GPT models on streaming Responses requests', () => {
    const proRequest = buildJingxingNativeWebSearchRequest({
      modelId: 'gpt-5.4-pro',
      baseUrl: 'https://api.jingxing.uk/v1',
      messages: textMessages,
    })
    const codexRequest = buildJingxingNativeWebSearchRequest({
      modelId: 'gpt-5.3-codex',
      baseUrl: 'https://api.jingxing.uk/v1',
      messages: textMessages,
    })

    expect(proRequest.transport).toBe('responses')
    expect(proRequest.body).toMatchObject({
      model: 'gpt-5.4-pro',
      stream: true,
      max_output_tokens: 4096,
      web_search_options: JINGXING_WEB_SEARCH_OPTIONS,
      reasoning: { effort: 'medium' },
    })
    expect(codexRequest.transport).toBe('responses')
    expect(codexRequest.body).toMatchObject({
      model: 'gpt-5.3-codex',
      stream: true,
      max_output_tokens: 4096,
      web_search_options: JINGXING_WEB_SEARCH_OPTIONS,
    })
  })

  it('builds response-only chat requests without web search options', () => {
    const request = buildJingxingResponsesChatRequest({
      modelId: 'gpt-5.4-pro',
      baseUrl: 'https://api.jingxing.io/v1',
      messages: textMessages,
      system: 'You are helpful',
      maxOutputTokens: 512,
    })

    expect(request.transport).toBe('responses')
    expect(request.endpoint).toBe('https://api.jingxing.io/v1/responses')
    expect(request.body).toMatchObject({
      model: 'gpt-5.4-pro',
      input: [{ role: 'user', content: '查一下新闻' }],
      instructions: 'You are helpful',
      stream: true,
      max_output_tokens: 4096,
      reasoning: { effort: 'medium' },
    })
    expect(request.body).not.toHaveProperty('web_search_options')
  })

  it('keeps Grok on Responses web search requests', () => {
    const request = buildJingxingNativeWebSearchRequest({
      modelId: 'grok-4.3',
      baseUrl: 'https://api.jingxing.io/v1',
      messages: textMessages,
      searchDepth: 'medium',
    })

    expect(request.transport).toBe('responses')
    expect(request.endpoint).toBe('https://api.jingxing.io/v1/responses')
    expect(request.body).toMatchObject({
      model: 'grok-4.3',
      stream: true,
      web_search_options: JINGXING_WEB_SEARCH_OPTIONS,
    })
  })

  it('builds Claude chat-completions web search requests', () => {
    const request = buildJingxingNativeWebSearchRequest({
      modelId: 'claude-opus-4-8',
      baseUrl: 'https://api.jingxing.io/v1',
      messages: textMessages,
      system: 'You are helpful',
      searchDepth: 'low',
      maxOutputTokens: 1024,
    })

    expect(request.transport).toBe('chat-completions')
    expect(request.endpoint).toBe('https://api.jingxing.io/v1/chat/completions')
    expect(request.body).toEqual({
      model: 'claude-opus-4-8',
      messages: [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: '查一下新闻' },
      ],
      stream: true,
      max_tokens: 4096,
      web_search_options: jingxingWebSearchOptionsForDepth('low'),
    })
    expect(request.body).not.toHaveProperty('input')
    expect(request.body).not.toHaveProperty('tools')
  })

  it('keeps configured native search token budgets above the 4096 floor', () => {
    const request = buildJingxingNativeWebSearchRequest({
      modelId: 'gpt-5.4',
      baseUrl: 'https://api.jingxing.uk/v1',
      messages: textMessages,
      maxOutputTokens: 8192,
    })

    expect(request.body).toMatchObject({
      max_output_tokens: 8192,
    })
  })

  it('builds Gemini generateContent requests with dynamic unified web_search_options', () => {
    for (const modelId of [
      'gemini-3.5-flash',
      'gemini-3.1-pro-preview',
      'gemini-3-flash-preview',
    ]) {
      const request = buildJingxingNativeWebSearchRequest({
        modelId,
        baseUrl: 'https://api.jingxing.uk/v1',
        messages: textMessages,
        system: 'You are helpful',
        searchDepth: 'low',
        maxOutputTokens: 1024,
      })

      expect(request.transport).toBe('gemini-generate-content')
      expect(request.endpoint).toBe(
        `https://api.jingxing.uk/v1beta/models/${modelId}:generateContent`
      )
      expect(request.body).toEqual({
        contents: [
          {
            role: 'user',
            parts: [{ text: '查一下新闻' }],
          },
        ],
        systemInstruction: {
          parts: [{ text: 'You are helpful' }],
        },
        generationConfig: {
          maxOutputTokens: 4096,
        },
        web_search_options: jingxingWebSearchOptionsForDepth('low'),
      })
      expect(request.body).not.toHaveProperty('tools')
      expect(JSON.stringify(request.body)).not.toContain('googleSearch')
      expect(JSON.stringify(request.body)).not.toContain('google_search')
    }
  })

  it('extracts Gemini groundingMetadata as source URLs', () => {
    const output = geminiGenerateContentResponseToOutput({
      candidates: [
        {
          content: {
            parts: [{ text: '答案' }],
          },
          finishReason: 'STOP',
          groundingMetadata: {
            groundingChunks: [
              {
                web: {
                  uri: 'https://example.com/a',
                  title: 'Example A',
                },
              },
            ],
          },
        },
      ],
      usageMetadata: {
        promptTokenCount: 12,
        candidatesTokenCount: 8,
        totalTokenCount: 20,
      },
    })

    expect(output).toEqual({
      text: '答案',
      sources: [{ url: 'https://example.com/a', title: 'Example A' }],
      usage: {
        inputTokens: 12,
        outputTokens: 8,
        totalTokens: 20,
      },
      finishReason: 'stop',
    })
  })
})
