import {
  ChatCompletionRole,
  ContentType,
  MessageStatus,
  type ThreadMessage,
} from '@janhq/core'
import { generateId, generateText, type LanguageModel } from 'ai'
import {
  DEFAULT_CHARS_PER_TOKEN,
  buildCompactPrompt,
  estimateThreadMessageTokens,
  estimateTokens,
  selectMessagesForCompaction,
} from './context-manager'

export const MITA_COMPACT_METADATA_VERSION = 1
export const DEFAULT_AUTO_COMPACT_THRESHOLD = 0.85
export const DEFAULT_COMPACT_RECENT_MESSAGE_COUNT = 4
export const DEFAULT_COMPACT_RECENT_TOKEN_LIMIT = 20_000

export type MitaCompactTrigger = 'manual' | 'auto'

export type MitaCompactMetadata =
  | {
      kind: 'summary'
      compactId: string
      trigger: MitaCompactTrigger
      createdAt: number
      version: number
      instructions?: string
      sourceMessageIds: string[]
      sourceMessageCount: number
    }
  | {
      kind: 'archived'
      compactId: string
      trigger: MitaCompactTrigger
      createdAt: number
      version: number
      summaryMessageId: string
    }

type MetadataHost = {
  metadata?: unknown
}

export interface CompactThreadMessagesOptions {
  threadId: string
  messages: ThreadMessage[]
  model: LanguageModel
  trigger: MitaCompactTrigger
  customInstructions?: string
  keepRecentMessages?: number
  maxRecentTokens?: number
  maxInputTokens?: number
  maxSummaryOutputTokens?: number
}

export interface CompactThreadMessagesResult {
  compacted: boolean
  compactId?: string
  summary?: string
  summaryMessage?: ThreadMessage
  archivedMessages: ThreadMessage[]
  messages: ThreadMessage[]
  skippedReason?: string
}

export interface AutoCompactCheckOptions {
  messages: ThreadMessage[]
  incomingText?: string
  systemPrompt?: string
  maxContextTokens: number
  threshold?: number
  /** Per-model calibrated chars-per-token (see token-calibration-store). */
  charsPerToken?: number
}

export function parseCompactCommand(input: string):
  | { isCompact: true; instructions?: string }
  | { isCompact: false } {
  const trimmed = input.trim()
  if (!trimmed.startsWith('/compact')) return { isCompact: false }

  const next = trimmed.slice('/compact'.length)
  if (next.length > 0 && !/^\s/.test(next)) return { isCompact: false }

  const instructions = next.trim()
  return {
    isCompact: true,
    ...(instructions ? { instructions } : {}),
  }
}

export function getMitaCompactMetadata(host: MetadataHost): MitaCompactMetadata | undefined {
  const hostMetadata =
    host.metadata && typeof host.metadata === 'object'
      ? (host.metadata as Record<string, unknown>)
      : undefined
  const metadata = hostMetadata?.mitaCompact
  if (!metadata || typeof metadata !== 'object') return undefined
  const kind = (metadata as { kind?: unknown }).kind
  if (kind !== 'summary' && kind !== 'archived') return undefined
  return metadata as MitaCompactMetadata
}

export function isArchivedCompactMessage(host: MetadataHost): boolean {
  return getMitaCompactMetadata(host)?.kind === 'archived'
}

export function isCompactSummaryMessage(host: MetadataHost): boolean {
  return getMitaCompactMetadata(host)?.kind === 'summary'
}

export function getVisibleThreadMessages(messages: ThreadMessage[]): ThreadMessage[] {
  return messages
    .filter((message) => !isArchivedCompactMessage(message))
    .slice()
    .sort((a, b) => (a.created_at || 0) - (b.created_at || 0))
}

export function normalizeAutoCompactThreshold(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return DEFAULT_AUTO_COMPACT_THRESHOLD
  return Math.min(0.95, Math.max(0.5, parsed))
}

export function shouldAutoCompactThread({
  messages,
  incomingText,
  systemPrompt,
  maxContextTokens,
  threshold = DEFAULT_AUTO_COMPACT_THRESHOLD,
  charsPerToken = DEFAULT_CHARS_PER_TOKEN,
}: AutoCompactCheckOptions): {
  shouldCompact: boolean
  tokenEstimate: number
  tokenLimit: number
  threshold: number
} {
  const normalizedThreshold = normalizeAutoCompactThreshold(threshold)
  const tokenLimit = Math.max(0, Math.floor(maxContextTokens * normalizedThreshold))
  const activeMessages = getVisibleThreadMessages(messages)
  const tokenEstimate =
    activeMessages.reduce(
      (total, message) =>
        total + estimateThreadMessageTokens(message, charsPerToken),
      0
    ) +
    estimateTokens(incomingText ?? '', charsPerToken) +
    estimateTokens(systemPrompt ?? '', charsPerToken)

  return {
    shouldCompact: maxContextTokens > 0 && tokenEstimate >= tokenLimit,
    tokenEstimate,
    tokenLimit,
    threshold: normalizedThreshold,
  }
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, Math.max(0, maxChars - 80))}\n\n[truncated for compaction input]`
}

function formatMessageForCompaction(message: ThreadMessage): string {
  const metadata = getMitaCompactMetadata(message)
  const header = [
    `id=${message.id}`,
    `role=${message.role}`,
    message.created_at ? `created_at=${new Date(message.created_at).toISOString()}` : undefined,
    metadata ? `mitaCompact=${metadata.kind}` : undefined,
  ]
    .filter(Boolean)
    .join(' ')

  const content = (message.content ?? [])
    .map((part) => {
      if (part.type === ContentType.Text && part.text?.value) {
        return part.text.value
      }
      if (part.type === ContentType.Reasoning) {
        return '[reasoning omitted from compaction input]'
      }
      if (part.type === ContentType.Image && part.image_url?.url) {
        return `[image: ${part.image_url.url}]`
      }
      if (part.type === ContentType.ToolCall) {
        return `[tool_call ${part.tool_name ?? 'unknown'}]\n${JSON.stringify({
          input: part.input,
          output: part.output,
        })}`
      }
      return ''
    })
    .filter(Boolean)
    .join('\n')

  return `--- MESSAGE ${header} ---\n${truncateText(content, 12_000)}`
}

function chunkMessagesForCompaction(
  messages: ThreadMessage[],
  maxInputTokens: number
): string[] {
  const chunks: string[] = []
  let current: string[] = []
  let currentTokens = 0
  const maxChunkTokens = Math.max(2_000, Math.floor(maxInputTokens * 0.75))

  for (const message of messages) {
    const formatted = formatMessageForCompaction(message)
    const tokens = estimateTokens(formatted)
    if (current.length > 0 && currentTokens + tokens > maxChunkTokens) {
      chunks.push(current.join('\n\n'))
      current = []
      currentTokens = 0
    }

    if (tokens > maxChunkTokens) {
      chunks.push(truncateText(formatted, maxChunkTokens * 3))
      continue
    }

    current.push(formatted)
    currentTokens += tokens
  }

  if (current.length > 0) chunks.push(current.join('\n\n'))
  return chunks
}

async function generateCompactSummary({
  model,
  messages,
  customInstructions,
  maxInputTokens,
  maxSummaryOutputTokens,
}: {
  model: LanguageModel
  messages: ThreadMessage[]
  customInstructions?: string
  maxInputTokens: number
  maxSummaryOutputTokens: number
}): Promise<string> {
  const system = buildCompactPrompt(customInstructions)
  const chunks = chunkMessagesForCompaction(messages, maxInputTokens)
  let runningSummary = ''

  for (let index = 0; index < chunks.length; index++) {
    const prompt = [
      runningSummary
        ? `Existing cumulative Biyan compact summary:\n\n${runningSummary}`
        : '',
      `Conversation chunk ${index + 1} of ${chunks.length} to compact:\n\n${chunks[index]}`,
      'Return the updated complete compact summary, not only a delta.',
    ]
      .filter(Boolean)
      .join('\n\n')

    const result = await generateText({
      model,
      system,
      prompt,
      maxOutputTokens: maxSummaryOutputTokens,
    })
    runningSummary = result.text.trim()
  }

  return runningSummary
}

export async function compactThreadMessages({
  threadId,
  messages,
  model,
  trigger,
  customInstructions,
  keepRecentMessages = DEFAULT_COMPACT_RECENT_MESSAGE_COUNT,
  maxRecentTokens,
  maxInputTokens = 60_000,
  maxSummaryOutputTokens = 2_048,
}: CompactThreadMessagesOptions): Promise<CompactThreadMessagesResult> {
  const activeMessages = getVisibleThreadMessages(messages)
  const selection = selectMessagesForCompaction(activeMessages, {
    keepRecentMessages,
    maxRecentTokens:
      maxRecentTokens ?? (trigger === 'manual' ? 0 : DEFAULT_COMPACT_RECENT_TOKEN_LIMIT),
    minMessagesToCompact: trigger === 'manual' ? 1 : 2,
  })

  if (selection.toCompact.length === 0) {
    return {
      compacted: false,
      archivedMessages: [],
      messages,
      skippedReason: 'not_enough_messages',
    }
  }

  const compactId = generateId()
  const createdAt = Date.now()
  const summary = await generateCompactSummary({
    model,
    messages: selection.toCompact,
    customInstructions,
    maxInputTokens,
    maxSummaryOutputTokens,
  })

  if (!summary.trim()) {
    return {
      compacted: false,
      archivedMessages: [],
      messages,
      skippedReason: 'empty_summary',
    }
  }

  const summaryMessageId = `compact-summary-${compactId}`
  const firstKept = selection.toKeep[0]
  const summaryCreatedAt = firstKept?.created_at
    ? Math.max(0, firstKept.created_at - 1)
    : createdAt
  const sourceMessageIds = selection.toCompact.map((message) => message.id)
  const summaryMessage: ThreadMessage = {
    id: summaryMessageId,
    object: 'thread.message',
    thread_id: threadId,
    role: ChatCompletionRole.System,
    content: [
      {
        type: ContentType.Text,
        text: {
          value: summary.trim(),
          annotations: [],
        },
      },
    ],
    status: MessageStatus.Ready,
    created_at: summaryCreatedAt,
    completed_at: summaryCreatedAt,
    metadata: {
      mitaCompact: {
        kind: 'summary',
        compactId,
        trigger,
        createdAt,
        version: MITA_COMPACT_METADATA_VERSION,
        ...(customInstructions?.trim()
          ? { instructions: customInstructions.trim() }
          : {}),
        sourceMessageIds,
        sourceMessageCount: sourceMessageIds.length,
      } satisfies MitaCompactMetadata,
    },
    type: 'text',
  }

  const compactedIds = new Set(sourceMessageIds)
  const archivedMessages = selection.toCompact.map((message) => ({
    ...message,
    metadata: {
      ...(message.metadata ?? {}),
      mitaCompact: {
        kind: 'archived',
        compactId,
        trigger,
        createdAt,
        version: MITA_COMPACT_METADATA_VERSION,
        summaryMessageId,
      } satisfies MitaCompactMetadata,
    },
  }))
  const archivedById = new Map(archivedMessages.map((message) => [message.id, message]))
  const firstKeptId = firstKept?.id

  const nextMessages: ThreadMessage[] = []
  let summaryInserted = false
  for (const message of messages) {
    if (!summaryInserted && firstKeptId && message.id === firstKeptId) {
      nextMessages.push(summaryMessage)
      summaryInserted = true
    }
    nextMessages.push(compactedIds.has(message.id) ? archivedById.get(message.id)! : message)
  }

  if (!summaryInserted) {
    nextMessages.push(summaryMessage)
  }

  return {
    compacted: true,
    compactId,
    summary,
    summaryMessage,
    archivedMessages,
    messages: nextMessages,
  }
}
