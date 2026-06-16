//
// 2.4 integration: a real compaction round-trip. compactMessages must call the
// provider, capture the summary (and its real usage), prepend it as a system
// message, and return a budget-fitting result. Skipped unless creds present.
//
import { describe, it, expect } from 'vitest'
import type { UIMessage } from '@ai-sdk/react'
import {
  compactMessages,
  type ContextManagerConfig,
} from '../../context-manager'
import {
  hasOpenAICompatIntegration,
  makeOpenAICompatModel,
} from './integration-helpers'

const runIf = hasOpenAICompatIntegration() ? describe : describe.skip

function turn(id: string, role: 'user' | 'assistant', text: string): UIMessage {
  return { id, role, parts: [{ type: 'text', text }] } as UIMessage
}

runIf('2.4 compaction with real usage (live provider)', () => {
  it('summarizes dropped turns and prepends a budget-fitting summary', async () => {
    // Five sizable turns well over a deliberately small context budget.
    const messages: UIMessage[] = [
      turn('u1', 'user', 'My project is called Mita. ' + 'Detail. '.repeat(80)),
      turn('a1', 'assistant', 'Understood. ' + 'Noted. '.repeat(80)),
      turn('u2', 'user', 'The deadline is Friday. ' + 'More. '.repeat(80)),
      turn('a2', 'assistant', 'Got it. ' + 'Okay. '.repeat(80)),
      turn('u3', 'user', 'Reply with exactly: READY'),
    ]
    const config: ContextManagerConfig = {
      maxContextTokens: 500,
      maxOutputTokens: 50,
      autoCompact: true,
    }

    const result = await compactMessages(
      messages,
      config,
      makeOpenAICompatModel(),
      0
    )

    // A real summary was produced by the provider.
    expect(result.compactedSummary && result.compactedSummary.length).toBeGreaterThan(0)
    expect(result.trimmedCount).toBeGreaterThan(0)
    // It is prepended as a system message.
    expect(result.messages[0].role).toBe('system')
    const firstText = result.messages[0].parts.find((p) => p.type === 'text') as
      | { type: 'text'; text: string }
      | undefined
    expect(firstText?.text).toContain('[Previous conversation summary]')
    // The newest turn is preserved.
    expect(result.messages.map((m) => m.id)).toContain('u3')
  }, 60_000)
})
