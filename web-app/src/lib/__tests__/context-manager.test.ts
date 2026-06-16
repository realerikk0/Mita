import { describe, it, expect } from 'vitest'
import type { UIMessage } from '@ai-sdk/react'
import {
  estimateTokens,
  estimateMessageTokens,
  totalMessageChars,
  trimMessages,
  compactMessages,
  refitAroundSummary,
  type ContextManagerConfig,
} from '../context-manager'

function makeMessage(
  id: string,
  role: 'user' | 'assistant' | 'system',
  text: string
): UIMessage {
  return {
    id,
    role,
    parts: [{ type: 'text' as const, text }],
  }
}

// An assistant message carrying a tool call + its result in one part.
function makeToolMessage(id: string, name = 'web_search', filler = ''): UIMessage {
  return {
    id,
    role: 'assistant',
    parts: [
      {
        type: `tool-${name}` as const,
        toolCallId: id,
        state: 'output-available',
        input: { q: id },
        output: `result ${id} ${filler}`,
      },
    ],
  } as UIMessage
}

// A standalone tool-result message (call and result stored separately).
function makeToolResultMessage(id: string, callId: string): UIMessage {
  return {
    id,
    role: 'assistant',
    parts: [
      {
        type: 'tool-web_search' as const,
        toolCallId: callId,
        state: 'output-available',
        input: { q: callId },
        output: `result for ${callId}`,
      },
    ],
  } as UIMessage
}

describe('estimateTokens', () => {
  it('should return 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0)
  })

  it('should estimate tokens based on character count', () => {
    // 35 chars / 3.5 chars per token = 10 tokens
    const text = 'Hello, this is a test of the token.'
    const result = estimateTokens(text)
    expect(result).toBe(Math.ceil(text.length / 3.5))
  })

  it('should handle short text', () => {
    expect(estimateTokens('Hi')).toBeGreaterThan(0)
  })
})

describe('estimateMessageTokens', () => {
  it('should estimate tokens for a simple text message', () => {
    const msg = makeMessage('1', 'user', 'Hello world')
    const tokens = estimateMessageTokens(msg)
    // text tokens + 4 overhead
    expect(tokens).toBe(estimateTokens('Hello world') + 4)
  })

  it('should include inline file contents in token count', () => {
    const msg = {
      id: '1',
      role: 'user' as const,
      parts: [{ type: 'text' as const, text: 'Check this file' }],
      metadata: {
        inline_file_contents: [
          { name: 'readme.md', content: 'This is a long file content string' },
        ],
      },
    } as unknown as UIMessage
    const tokens = estimateMessageTokens(msg)
    expect(tokens).toBeGreaterThan(estimateTokens('Check this file') + 4)
  })

  it('should handle messages with no text parts', () => {
    const msg: UIMessage = {
      id: '1',
      role: 'assistant',
      parts: [],
    }
    const tokens = estimateMessageTokens(msg)
    expect(tokens).toBe(4) // just overhead
  })
})

describe('trimMessages', () => {
  const defaultConfig: ContextManagerConfig = {
    maxContextTokens: 200,
    maxOutputTokens: 50,
    autoCompact: false,
  }

  it('should return all messages when they fit within budget', () => {
    const messages = [
      makeMessage('1', 'user', 'Hi'),
      makeMessage('2', 'assistant', 'Hello'),
    ]
    const result = trimMessages(messages, defaultConfig)
    expect(result.trimmedCount).toBe(0)
    expect(result.messages).toHaveLength(2)
  })

  it('should not trim when maxContextTokens is 0 (disabled)', () => {
    const messages = Array.from({ length: 100 }, (_, i) =>
      makeMessage(
        String(i),
        i % 2 === 0 ? 'user' : 'assistant',
        'A'.repeat(500)
      )
    )
    const result = trimMessages(messages, {
      maxContextTokens: 0,
      maxOutputTokens: 50,
      autoCompact: false,
    })
    expect(result.trimmedCount).toBe(0)
    expect(result.messages).toHaveLength(100)
  })

  it('should trim oldest messages when conversation exceeds budget', () => {
    // Each message: ~143 tokens text + 4 overhead = ~147 tokens
    // Budget: 200 - 50 = 150 input tokens → only 1 message fits
    const messages = [
      makeMessage('1', 'user', 'A'.repeat(500)),
      makeMessage('2', 'assistant', 'B'.repeat(500)),
      makeMessage('3', 'user', 'C'.repeat(500)),
    ]
    const result = trimMessages(messages, defaultConfig)
    expect(result.trimmedCount).toBeGreaterThan(0)
    // Most recent message should always be kept
    expect(result.messages[result.messages.length - 1].id).toBe('3')
  })

  it('should keep at least the last message even if it exceeds budget', () => {
    const messages = [
      makeMessage('1', 'user', 'A'.repeat(5000)),
    ]
    const result = trimMessages(messages, {
      maxContextTokens: 100,
      maxOutputTokens: 50,
      autoCompact: false,
    })
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0].id).toBe('1')
  })

  it('should account for system prompt tokens', () => {
    const messages = [
      makeMessage('1', 'user', 'Hello'),
      makeMessage('2', 'assistant', 'Hi there'),
    ]
    // With large system prompt, even small messages may not fit
    const result = trimMessages(messages, {
      maxContextTokens: 200,
      maxOutputTokens: 50,
      autoCompact: false,
    }, 180) // leaves only 200-50-180 = negative → only last message
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0].id).toBe('2')
  })

  it('should preserve message order', () => {
    const messages = [
      makeMessage('1', 'user', 'First'),
      makeMessage('2', 'assistant', 'Second'),
      makeMessage('3', 'user', 'Third'),
      makeMessage('4', 'assistant', 'Fourth'),
    ]
    const result = trimMessages(messages, {
      maxContextTokens: 500,
      maxOutputTokens: 50,
      autoCompact: false,
    })
    const ids = result.messages.map((m) => m.id)
    for (let i = 1; i < ids.length; i++) {
      expect(Number(ids[i])).toBeGreaterThan(Number(ids[i - 1]))
    }
  })
})

describe('calibrated chars-per-token', () => {
  it('estimateTokens honors a custom chars-per-token', () => {
    expect(estimateTokens('A'.repeat(70))).toBe(20) // default 3.5
    expect(estimateTokens('A'.repeat(70), 7)).toBe(10)
  })

  it('estimateMessageTokens honors a custom chars-per-token', () => {
    const msg = makeMessage('1', 'user', 'A'.repeat(70))
    expect(estimateMessageTokens(msg)).toBe(24) // 20 + 4
    expect(estimateMessageTokens(msg, 7)).toBe(14) // 10 + 4
  })

  it('totalMessageChars sums the estimator text basis', () => {
    const messages = [
      makeMessage('1', 'user', 'hello'), // 5
      makeMessage('2', 'assistant', 'world!'), // 6
    ]
    expect(totalMessageChars(messages)).toBe(11)
  })

  it('a larger chars-per-token keeps more messages (fewer estimated tokens)', () => {
    const messages = [
      makeMessage('u1', 'user', 'A'.repeat(350)),
      makeMessage('u2', 'user', 'A'.repeat(350)),
    ]
    const config: ContextManagerConfig = {
      maxContextTokens: 200,
      maxOutputTokens: 50,
      autoCompact: false,
    }
    // Default 3.5: each ~104 tokens → only the newest fits in 150.
    expect(trimMessages(messages, config).messages.map((m) => m.id)).toEqual([
      'u2',
    ])
    // Calibrated 7: each ~54 tokens → both fit.
    expect(
      trimMessages(messages, config, 0, 7).messages.map((m) => m.id)
    ).toEqual(['u1', 'u2'])
  })
})

describe('trimMessages tool-call/result pairing', () => {
  const tightConfig: ContextManagerConfig = {
    maxContextTokens: 200,
    maxOutputTokens: 50,
    autoCompact: false,
  }

  it('never leaves a dangling tool/assistant turn at the window start', () => {
    // Old per-message trimming would keep [a1(tool), u2, a2] and drop u1,
    // orphaning the tool turn. Turn-grouping drops the whole [u1, a1] turn.
    const messages = [
      makeMessage('u1', 'user', 'U'.repeat(2000)), // huge → its turn is dropped
      makeToolMessage('a1'), // small tool turn that would otherwise dangle
      makeMessage('u2', 'user', 'hi'),
      makeMessage('a2', 'assistant', 'ok'),
    ]
    const result = trimMessages(messages, tightConfig)
    expect(result.messages.map((m) => m.id)).toEqual(['u2', 'a2'])
    expect(result.messages[0].role).toBe('user')
  })

  it('keeps a multi-message tool turn intact (call + result together)', () => {
    const messages = [
      makeMessage('u0', 'user', 'U'.repeat(2000)), // dropped whole
      makeMessage('a0', 'assistant', 'A'.repeat(2000)),
      makeMessage('u1', 'user', 'go'),
      makeToolMessage('a1'),
      makeToolResultMessage('r1', 'a1'),
    ]
    const result = trimMessages(messages, tightConfig)
    expect(result.messages.map((m) => m.id)).toEqual(['u1', 'a1', 'r1'])
    expect(result.messages[0].role).toBe('user')
  })

  it('always keeps a pinned system summary while trimming old turns', () => {
    const messages = [
      makeMessage('sum', 'system', '[summary] ' + 'S'.repeat(100)),
      makeMessage('u1', 'user', 'U'.repeat(2000)), // old turn → dropped
      makeMessage('a1', 'assistant', 'A'.repeat(2000)),
      makeMessage('u2', 'user', 'hi'),
      makeMessage('a2', 'assistant', 'ok'),
    ]
    const result = trimMessages(messages, tightConfig)
    const ids = result.messages.map((m) => m.id)
    expect(ids).toContain('sum') // pinned summary survives
    expect(ids).toContain('u2')
    expect(ids).toContain('a2')
    expect(ids).not.toContain('u1')
    expect(ids).not.toContain('a1')
  })
})

describe('refitAroundSummary (real-usage re-trim)', () => {
  const config: ContextManagerConfig = {
    maxContextTokens: 300,
    maxOutputTokens: 50,
    autoCompact: false,
  }
  const summary = makeMessage('sum', 'system', 'x') // tiny summary text
  const kept = [
    makeMessage('u1', 'user', 'A'.repeat(350)), // ~104 tokens
    makeMessage('u2', 'user', 'A'.repeat(350)), // ~104 tokens
  ]

  it('always keeps the summary first', () => {
    const res = refitAroundSummary(summary, kept, config, 0)
    expect(res.messages[0].id).toBe('sum')
  })

  it('uses the char estimate of the summary when no real usage is given', () => {
    // inputBudget 250 − tiny summary estimate (~5) → both kept turns fit.
    const res = refitAroundSummary(summary, kept, config, 0)
    expect(res.messages.map((m) => m.id)).toEqual(['sum', 'u1', 'u2'])
    expect(res.trimmedCount).toBe(0)
  })

  it('reserves the real summary token count, trimming more aggressively', () => {
    // A real outputTokens of 150 reserves far more than the summary text would
    // estimate, so only the newest kept turn survives.
    const res = refitAroundSummary(summary, kept, config, 0, 3.5, 150)
    expect(res.messages.map((m) => m.id)).toEqual(['sum', 'u2'])
    expect(res.trimmedCount).toBe(1)
  })

  it('ignores a non-positive usage override and falls back to the estimate', () => {
    const res = refitAroundSummary(summary, kept, config, 0, 3.5, 0)
    expect(res.messages.map((m) => m.id)).toEqual(['sum', 'u1', 'u2'])
  })
})

describe('compactMessages', () => {
  const config: ContextManagerConfig = {
    maxContextTokens: 200,
    maxOutputTokens: 50,
    autoCompact: true,
  }

  const mockModel = {
    modelId: 'test-model',
    provider: 'test',
    specificationVersion: 'v1',
  }

  it('should pass through when no trimming needed', async () => {
    const messages = [
      makeMessage('1', 'user', 'Hi'),
      makeMessage('2', 'assistant', 'Hello'),
    ]
    const result = await compactMessages(
      messages,
      config,
      mockModel as any
    )
    expect(result.trimmedCount).toBe(0)
    expect(result.messages).toHaveLength(2)
  })

  it('should pass through when maxContextTokens is 0', async () => {
    const messages = Array.from({ length: 50 }, (_, i) =>
      makeMessage(String(i), i % 2 === 0 ? 'user' : 'assistant', 'A'.repeat(500))
    )
    const result = await compactMessages(
      messages,
      { maxContextTokens: 0, maxOutputTokens: 50, autoCompact: true },
      mockModel as any
    )
    expect(result.trimmedCount).toBe(0)
    expect(result.messages).toHaveLength(50)
  })

  it('should fall back to trim when summarization fails', async () => {
    // Use messages that exceed context
    const messages = [
      makeMessage('1', 'user', 'A'.repeat(500)),
      makeMessage('2', 'assistant', 'B'.repeat(500)),
      makeMessage('3', 'user', 'C'.repeat(100)),
    ]

    // The mock model doesn't implement the real interface, so generateText
    // will throw. compactMessages should catch and fall back to trimMessages.
    const result = await compactMessages(
      messages,
      config,
      mockModel as any
    )

    expect(result.trimmedCount).toBeGreaterThan(0)
    // Should still return valid messages (fallback to trim)
    expect(result.messages.length).toBeGreaterThan(0)
    // No summary generated on fallback
    expect(result.compactedSummary).toBeUndefined()
  })
})
