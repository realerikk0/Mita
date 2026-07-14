import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ChatCompletionRole,
  ContentType,
  MessageStatus,
  type ThreadMessage,
} from '@biyan/core'
import {
  buildCompactPrompt,
  mergeExistingSummaries,
  selectMessagesForCompaction,
} from '../context-manager'
import {
  compactThreadMessages,
  getVisibleThreadMessages,
  isArchivedCompactMessage,
  isCompactSummaryMessage,
  parseCompactCommand,
  shouldAutoCompactThread,
} from '../compact-thread'

const aiMock = vi.hoisted(() => ({
  generateId: vi.fn(),
  generateText: vi.fn(),
}))

vi.mock('ai', () => ({
  generateId: aiMock.generateId,
  generateText: aiMock.generateText,
}))

function makeMessage(
  id: string,
  role: ChatCompletionRole,
  text: string,
  createdAt = Number(id)
): ThreadMessage {
  return {
    id,
    object: 'thread.message',
    thread_id: 'thread-1',
    role,
    content: [
      {
        type: ContentType.Text,
        text: { value: text, annotations: [] },
      },
    ],
    status: MessageStatus.Ready,
    created_at: createdAt,
    completed_at: createdAt,
  }
}

function makeReasoningMessage(
  id: string,
  reasoning: string,
  createdAt = Number(id)
): ThreadMessage {
  const message = makeMessage(id, ChatCompletionRole.Assistant, '', createdAt)
  message.content = [
    {
      type: ContentType.Reasoning,
      text: { value: reasoning, annotations: [] },
    },
  ]
  return message
}

describe('compact-thread helpers', () => {
  beforeEach(() => {
    aiMock.generateId.mockReset()
    aiMock.generateText.mockReset()
    aiMock.generateId.mockReturnValue('compact-id')
    aiMock.generateText.mockResolvedValue({
      text: '# Stable Context\n- Preserved state.',
    })
  })

  it('builds the Biyan compact prompt with default and custom instructions', () => {
    const defaultPrompt = buildCompactPrompt()
    expect(defaultPrompt).toContain('BIYAN CONTEXT COMPACTION')
    expect(defaultPrompt).toContain('# Stable Context')
    expect(defaultPrompt).toContain('None.')

    const prompt = buildCompactPrompt('focus on tests')
    expect(prompt).toContain('BIYAN CONTEXT COMPACTION')
    expect(prompt).toContain('# Stable Context')
    expect(prompt).toContain('focus on tests')
    expect(buildCompactPrompt('聚焦测试结果')).toContain('聚焦测试结果')
  })

  it('merges existing summaries without dropping the new summary', () => {
    const merged = mergeExistingSummaries(
      ['# Stable Context\n- Old decision.'],
      '# Current State\n- New work.'
    )
    expect(merged).toContain('Old decision.')
    expect(merged).toContain('New work.')
  })

  it('parses /compact commands only at command boundary', () => {
    expect(parseCompactCommand('/compact')).toEqual({ isCompact: true })
    expect(parseCompactCommand('/compact focus on tool errors')).toEqual({
      isCompact: true,
      instructions: 'focus on tool errors',
    })
    expect(parseCompactCommand('/compactness')).toEqual({ isCompact: false })
    expect(parseCompactCommand('please /compact')).toEqual({ isCompact: false })
  })

  it('selects older messages for compaction and keeps recent messages', () => {
    const messages = [
      makeMessage('1', ChatCompletionRole.User, 'one'),
      makeMessage('2', ChatCompletionRole.Assistant, 'two'),
      makeMessage('3', ChatCompletionRole.User, 'three'),
      makeMessage('4', ChatCompletionRole.Assistant, 'four'),
    ]
    const result = selectMessagesForCompaction(messages, {
      keepRecentMessages: 2,
      maxRecentTokens: 0,
      minMessagesToCompact: 1,
    })
    expect(result.toCompact.map((m) => m.id)).toEqual(['1', '2'])
    expect(result.toKeep.map((m) => m.id)).toEqual(['3', '4'])
  })

  it('filters archived messages and sorts visible messages by created_at', () => {
    const archived = makeMessage('1', ChatCompletionRole.User, 'old', 1)
    archived.metadata = {
      biyanCompact: {
        kind: 'archived',
        compactId: 'c1',
        trigger: 'manual',
        createdAt: 10,
        version: 1,
        summaryMessageId: 's1',
      },
    }
    const summary = makeMessage('s1', ChatCompletionRole.System, 'summary', 2)
    const recent = makeMessage('3', ChatCompletionRole.User, 'recent', 3)

    expect(isArchivedCompactMessage(archived)).toBe(true)
    expect(getVisibleThreadMessages([recent, archived, summary]).map((m) => m.id)).toEqual([
      's1',
      '3',
    ])
  })

  it('detects auto compact when estimated tokens cross the threshold', () => {
    const messages = [
      makeMessage('1', ChatCompletionRole.User, 'A'.repeat(1_000)),
      makeMessage('2', ChatCompletionRole.Assistant, 'B'.repeat(1_000)),
    ]
    const result = shouldAutoCompactThread({
      messages,
      incomingText: 'C'.repeat(1_000),
      maxContextTokens: 500,
      threshold: 0.5,
    })
    expect(result.shouldCompact).toBe(true)
  })

  it('uses the calibrated chars-per-token for the threshold decision', () => {
    const messages = [
      makeMessage('1', ChatCompletionRole.User, 'A'.repeat(1_000)),
      makeMessage('2', ChatCompletionRole.Assistant, 'B'.repeat(1_000)),
    ]
    const opts = {
      messages,
      incomingText: 'C'.repeat(1_000),
      maxContextTokens: 1_200,
      threshold: 0.5, // tokenLimit = 600
    }
    // Default 3.5 chars/token → estimate ~866, over the 600 limit.
    expect(shouldAutoCompactThread(opts).shouldCompact).toBe(true)
    // A token-denser model (6 chars/token) → estimate ~509, under the limit.
    const calibrated = shouldAutoCompactThread({ ...opts, charsPerToken: 6 })
    expect(calibrated.shouldCompact).toBe(false)
    expect(calibrated.tokenEstimate).toBeLessThan(
      shouldAutoCompactThread(opts).tokenEstimate
    )
  })

  it('creates a summary message and archives compacted source messages', async () => {
    const messages = [
      makeMessage('1', ChatCompletionRole.User, 'old user'),
      makeMessage('2', ChatCompletionRole.Assistant, 'old assistant'),
      makeMessage('3', ChatCompletionRole.User, 'recent user'),
      makeMessage('4', ChatCompletionRole.Assistant, 'recent assistant'),
      makeMessage('5', ChatCompletionRole.User, 'latest user'),
      makeMessage('6', ChatCompletionRole.Assistant, 'latest assistant'),
    ]

    const result = await compactThreadMessages({
      threadId: 'thread-1',
      messages,
      model: {} as never,
      trigger: 'manual',
      customInstructions: 'focus on files',
    })

    expect(result.compacted).toBe(true)
    expect(result.summaryMessage).toBeDefined()
    expect(isCompactSummaryMessage(result.summaryMessage!)).toBe(true)
    expect(result.archivedMessages.map((message) => message.id)).toEqual(['1', '2'])
    expect(result.archivedMessages.every(isArchivedCompactMessage)).toBe(true)
    expect(result.summaryMessage?.metadata).toMatchObject({
      biyanCompact: {
        kind: 'summary',
        sourceMessageCount: 2,
        instructions: 'focus on files',
      },
    })
    expect(getVisibleThreadMessages(result.messages).map((message) => message.id)).toEqual([
      'compact-summary-compact-id',
      '3',
      '4',
      '5',
      '6',
    ])
  })

  it('feeds an earlier Biyan summary into the next compaction input', async () => {
    const previousSummary = makeMessage(
      's1',
      ChatCompletionRole.System,
      '# Stable Context\n- old durable decision',
      1
    )
    previousSummary.metadata = {
      biyanCompact: {
        kind: 'summary',
        compactId: 'old-compact',
        trigger: 'manual',
        createdAt: 1,
        version: 1,
        sourceMessageIds: ['1', '2'],
        sourceMessageCount: 2,
      },
    }

    await compactThreadMessages({
      threadId: 'thread-1',
      messages: [
        previousSummary,
        makeMessage('2', ChatCompletionRole.User, 'follow-up', 2),
        makeMessage('3', ChatCompletionRole.Assistant, 'answer', 3),
        makeMessage('4', ChatCompletionRole.User, 'recent', 4),
        makeMessage('5', ChatCompletionRole.Assistant, 'recent answer', 5),
        makeMessage('6', ChatCompletionRole.User, 'latest', 6),
      ],
      model: {} as never,
      trigger: 'manual',
    })

    const prompt = aiMock.generateText.mock.calls[0]?.[0]?.prompt
    expect(prompt).toContain('old durable decision')
    expect(prompt).toContain('biyanCompact=summary')
  })

  it('omits reasoning content from the compaction input', async () => {
    await compactThreadMessages({
      threadId: 'thread-1',
      messages: [
        makeReasoningMessage('1', 'private chain of thought'),
        makeMessage('2', ChatCompletionRole.User, 'user fact'),
        makeMessage('3', ChatCompletionRole.Assistant, 'assistant fact'),
        makeMessage('4', ChatCompletionRole.User, 'recent'),
        makeMessage('5', ChatCompletionRole.Assistant, 'recent answer'),
        makeMessage('6', ChatCompletionRole.User, 'latest'),
      ],
      model: {} as never,
      trigger: 'manual',
    })

    const prompt = aiMock.generateText.mock.calls[0]?.[0]?.prompt
    expect(prompt).not.toContain('private chain of thought')
    expect(prompt).toContain('reasoning omitted')
  })
})
