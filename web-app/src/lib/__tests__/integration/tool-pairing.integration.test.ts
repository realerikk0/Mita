//
// 2.2 integration: a trimmed conversation that contains a tool call + result
// must round-trip through convertToModelMessages and a REAL provider without a
// "tool_use without tool_result" style error. Skipped unless integration creds
// are present (see integration-helpers / web-app/.env.integration.local).
//
import { describe, it, expect } from 'vitest'
import type { UIMessage } from '@ai-sdk/react'
import { convertToModelMessages, streamText } from 'ai'
import { trimMessages, type ContextManagerConfig } from '../../context-manager'
import {
  hasOpenAICompatIntegration,
  makeOpenAICompatModel,
} from './integration-helpers'

const runIf = hasOpenAICompatIntegration() ? describe : describe.skip

// A completed tool call + result (one assistant message).
const toolTurn: UIMessage = {
  id: 'a1',
  role: 'assistant',
  parts: [
    {
      type: 'tool-get_weather',
      toolCallId: 'call_1',
      state: 'output-available',
      input: { city: 'Tokyo' },
      output: { tempC: 21, summary: 'clear' },
    },
  ],
} as UIMessage

const history: UIMessage[] = [
  {
    id: 'u1',
    role: 'user',
    parts: [{ type: 'text', text: 'What is the weather in Tokyo?' }],
  } as UIMessage,
  toolTurn,
  {
    id: 'u2',
    role: 'user',
    parts: [
      {
        type: 'text',
        text: 'Thanks. Reply with exactly the word: DONE',
      },
    ],
  } as UIMessage,
]

const config: ContextManagerConfig = {
  maxContextTokens: 8000,
  maxOutputTokens: 64,
  autoCompact: false,
}

runIf('2.2 tool-call/result pairing (live provider)', () => {
  it('keeps the tool call paired with its result after trimming + conversion', () => {
    const trimmed = trimMessages(history, config)
    // Trimming kept the whole tool turn (call + result in one unit).
    expect(trimmed.messages.map((m) => m.id)).toContain('a1')
    const modelMessages = convertToModelMessages(trimmed.messages)
    const hasToolCall = modelMessages.some(
      (m) =>
        m.role === 'assistant' &&
        Array.isArray(m.content) &&
        m.content.some((p) => (p as { type?: string }).type === 'tool-call')
    )
    const hasToolResult = modelMessages.some(
      (m) =>
        m.role === 'tool' &&
        Array.isArray(m.content) &&
        m.content.some((p) => (p as { type?: string }).type === 'tool-result')
    )
    expect(hasToolCall).toBe(true)
    expect(hasToolResult).toBe(true)
  })

  it('a real provider accepts the trimmed tool-bearing history', async () => {
    const trimmed = trimMessages(history, config)
    const result = streamText({
      model: makeOpenAICompatModel(),
      messages: convertToModelMessages(trimmed.messages),
    })
    let text = ''
    for await (const chunk of result.textStream) text += chunk
    // No provider error thrown, and we got a completion back.
    expect(text.trim().length).toBeGreaterThan(0)
  }, 60_000)
})
