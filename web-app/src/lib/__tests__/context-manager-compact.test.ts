import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UIMessage } from '@ai-sdk/react'

// Mock the summarizer so we can inspect exactly which messages get summarized.
const aiMock = vi.hoisted(() => ({ generateText: vi.fn() }))
vi.mock('ai', () => ({ generateText: aiMock.generateText }))

import {
  compactMessages,
  type ContextManagerConfig,
} from '../context-manager'

function msg(
  id: string,
  role: 'user' | 'assistant' | 'system',
  text: string
): UIMessage {
  return { id, role, parts: [{ type: 'text', text }] } as UIMessage
}

describe('compactMessages dropped-set with a pinned summary', () => {
  beforeEach(() => {
    aiMock.generateText.mockReset()
    aiMock.generateText.mockResolvedValue({
      text: 'NEW_SUMMARY',
      usage: { outputTokens: 5 },
    })
  })

  it('summarizes the genuinely dropped turn, not the retained summary', async () => {
    // A prior compaction summary (system) sits at the front and must be kept.
    // The oldest real turn is large and should be the one dropped + summarized.
    const messages: UIMessage[] = [
      // Sized so the old turn is over budget (dropped) but its text still fits
      // under the summary excerpt cap (so nothing is truncated away).
      msg('sum', 'system', 'KEPT_SUMMARY_MARKER prior context'),
      msg('u1', 'user', 'DROPPED_USER '.repeat(60)),
      msg('a1', 'assistant', 'DROPPED_ASSISTANT '.repeat(60)),
      msg('u2', 'user', 'recent question'),
      msg('a2', 'assistant', 'recent answer'),
    ]
    const config: ContextManagerConfig = {
      maxContextTokens: 400,
      maxOutputTokens: 50,
      autoCompact: true,
    }

    const result = await compactMessages(messages, config, {} as never, 0)

    // The summarizer saw the dropped turn...
    const prompt = aiMock.generateText.mock.calls[0][0].prompt as string
    expect(prompt).toContain('DROPPED_USER')
    expect(prompt).toContain('DROPPED_ASSISTANT')
    // ...and NOT the retained prior summary (the old slice(0,N) bug did).
    expect(prompt).not.toContain('KEPT_SUMMARY_MARKER')

    // Output prepends the new summary and keeps the recent turn.
    expect(result.compactedSummary).toBe('NEW_SUMMARY')
    expect(result.messages[0].role).toBe('system')
    expect(result.messages.map((m) => m.id)).toContain('a2')
  })
})
