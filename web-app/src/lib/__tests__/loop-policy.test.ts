import { describe, expect, it } from 'vitest'
import {
  MAX_MCP_TOOL_FOLLOW_UP_ROUNDS,
  countToolCallAssistantRoundsSinceLastUser,
  detectToolCallMonotony,
  isWithinMcpToolFollowUpLimit,
  shouldContinueLoop,
} from '@/lib/agent-loop/loop-policy'

type AnyMessage = Parameters<typeof shouldContinueLoop>[0]['messages'][number]

const userMsg = (id: string): AnyMessage =>
  ({ id, role: 'user', parts: [{ type: 'text', text: 'hi' }] }) as AnyMessage

// Distinct input per id by default so independent rounds are NOT seen as a loop.
const toolRound = (id: string, input: unknown = { q: id }): AnyMessage =>
  ({
    id,
    role: 'assistant',
    parts: [
      {
        type: 'tool-web_search',
        toolCallId: id,
        state: 'output-available',
        input,
        output: 'ok',
      },
    ],
  }) as AnyMessage

// Same tool name + same input → identical signature (a stuck loop).
const sameRound = (id: string): AnyMessage => toolRound(id, { q: 'same' })

const textAssistant = (id: string): AnyMessage =>
  ({ id, role: 'assistant', parts: [{ type: 'text', text: 'done' }] }) as AnyMessage

const liveSignal = () => new AbortController().signal
const abortedSignal = () => {
  const c = new AbortController()
  c.abort()
  return c.signal
}

describe('countToolCallAssistantRoundsSinceLastUser', () => {
  it('counts consecutive tool-call assistant rounds since last user message', () => {
    const messages = [
      userMsg('u1'),
      toolRound('a1'),
      toolRound('a2'),
      toolRound('a3'),
    ]
    expect(countToolCallAssistantRoundsSinceLastUser(messages)).toBe(3)
  })

  it('resets at the most recent user message', () => {
    const messages = [
      userMsg('u1'),
      toolRound('a1'),
      userMsg('u2'),
      toolRound('a2'),
    ]
    expect(countToolCallAssistantRoundsSinceLastUser(messages)).toBe(1)
  })

  it('ignores text-only assistant messages', () => {
    const messages = [userMsg('u1'), textAssistant('a1')]
    expect(countToolCallAssistantRoundsSinceLastUser(messages)).toBe(0)
  })
})

describe('isWithinMcpToolFollowUpLimit', () => {
  it('respects the default cap', () => {
    const messages = [
      userMsg('u1'),
      ...Array.from({ length: MAX_MCP_TOOL_FOLLOW_UP_ROUNDS }, (_, i) =>
        toolRound(`a${i + 1}`)
      ),
    ]
    expect(isWithinMcpToolFollowUpLimit(messages)).toBe(false)
  })

  it('respects a custom cap', () => {
    const messages = [userMsg('u1'), toolRound('a1'), toolRound('a2')]
    expect(isWithinMcpToolFollowUpLimit(messages, 2)).toBe(false)
    expect(isWithinMcpToolFollowUpLimit(messages, 3)).toBe(true)
  })
})

describe('detectToolCallMonotony', () => {
  it('detects two identical tool-call-only rounds back-to-back', () => {
    expect(
      detectToolCallMonotony([userMsg('u1'), sameRound('a1'), sameRound('a2')])
    ).toBe(true)
  })

  it('does not trip when inputs differ', () => {
    expect(
      detectToolCallMonotony([
        userMsg('u1'),
        toolRound('a1', { q: 'alpha' }),
        toolRound('a2', { q: 'beta' }),
      ])
    ).toBe(false)
  })

  it('requires at least windowSize rounds', () => {
    expect(detectToolCallMonotony([userMsg('u1'), sameRound('a1')])).toBe(false)
  })

  it('breaks the window when a text-bearing round interrupts (progress)', () => {
    const toolWithText = {
      id: 'a-mid',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'making progress' },
        { type: 'tool-web_search', toolCallId: 'a-mid', input: { q: 'same' } },
      ],
    } as AnyMessage
    expect(
      detectToolCallMonotony([
        userMsg('u1'),
        sameRound('a1'),
        toolWithText,
        sameRound('a3'),
      ])
    ).toBe(false)
  })

  it('is disabled when windowSize < 2', () => {
    expect(
      detectToolCallMonotony(
        [userMsg('u1'), sameRound('a1'), sameRound('a2')],
        0
      )
    ).toBe(false)
  })

  it('respects a larger window', () => {
    const two = [userMsg('u1'), sameRound('a1'), sameRound('a2')]
    expect(detectToolCallMonotony(two, 3)).toBe(false)
    const three = [...two, sameRound('a3')]
    expect(detectToolCallMonotony(three, 3)).toBe(true)
  })
})

describe('shouldContinueLoop', () => {
  it('stops when there is no live abort controller', () => {
    const decision = shouldContinueLoop({
      messages: [userMsg('u1'), toolRound('a1')],
      hasCompleteToolCalls: true,
      abortSignal: null,
    })
    expect(decision).toEqual({ continue: false, reason: 'aborted' })
  })

  it('stops when the run has been aborted', () => {
    const decision = shouldContinueLoop({
      messages: [userMsg('u1'), toolRound('a1')],
      hasCompleteToolCalls: true,
      abortSignal: abortedSignal(),
    })
    expect(decision).toEqual({ continue: false, reason: 'aborted' })
  })

  it('stops when the latest assistant message has no complete tool calls', () => {
    const decision = shouldContinueLoop({
      messages: [userMsg('u1'), textAssistant('a1')],
      hasCompleteToolCalls: false,
      abortSignal: liveSignal(),
    })
    expect(decision).toEqual({ continue: false, reason: 'no-tool-calls' })
  })

  it('stops with loop-detected before the round budget when calls repeat', () => {
    const decision = shouldContinueLoop({
      messages: [userMsg('u1'), sameRound('a1'), sameRound('a2')],
      hasCompleteToolCalls: true,
      abortSignal: liveSignal(),
    })
    expect(decision).toEqual({ continue: false, reason: 'loop-detected' })
  })

  it('keeps going past repeats when monotony detection is disabled', () => {
    const decision = shouldContinueLoop({
      messages: [userMsg('u1'), sameRound('a1'), sameRound('a2')],
      hasCompleteToolCalls: true,
      abortSignal: liveSignal(),
      monotonyWindow: 0,
    })
    expect(decision).toEqual({ continue: true, reason: 'continue' })
  })

  it('stops when the round budget is exhausted', () => {
    const messages = [
      userMsg('u1'),
      ...Array.from({ length: MAX_MCP_TOOL_FOLLOW_UP_ROUNDS }, (_, i) =>
        toolRound(`a${i + 1}`)
      ),
    ]
    const decision = shouldContinueLoop({
      messages,
      hasCompleteToolCalls: true,
      abortSignal: liveSignal(),
    })
    expect(decision).toEqual({ continue: false, reason: 'round-limit' })
  })

  it('continues when under budget with a live signal and complete tool calls', () => {
    const decision = shouldContinueLoop({
      messages: [userMsg('u1'), toolRound('a1')],
      hasCompleteToolCalls: true,
      abortSignal: liveSignal(),
    })
    expect(decision).toEqual({ continue: true, reason: 'continue' })
  })

  it('honors a custom maxRounds budget', () => {
    const messages = [userMsg('u1'), toolRound('a1'), toolRound('a2')]
    expect(
      shouldContinueLoop({
        messages,
        hasCompleteToolCalls: true,
        abortSignal: liveSignal(),
        maxRounds: 2,
      })
    ).toEqual({ continue: false, reason: 'round-limit' })
    expect(
      shouldContinueLoop({
        messages,
        hasCompleteToolCalls: true,
        abortSignal: liveSignal(),
        maxRounds: 3,
      })
    ).toEqual({ continue: true, reason: 'continue' })
  })
})
