import type { UIMessage } from '@ai-sdk/react'
import { generateText, type LanguageModel } from 'ai'
import type { ThreadMessage } from '@biyan/core'

/**
 * Approximate token count using a character-based heuristic.
 *
 * Default: 1 token ≈ 3.5 characters (conservative, leaves a safety margin).
 * Callers may pass a per-model calibrated value (see token-calibration-store)
 * once real usage has been observed; otherwise this default is used as a
 * cold-start prior and as the fallback for models that don't report usage
 * (for example, providers with small context windows).
 */
export const DEFAULT_CHARS_PER_TOKEN = 3.5

export function estimateTokens(
  text: string,
  charsPerToken: number = DEFAULT_CHARS_PER_TOKEN
): number {
  if (!text) return 0
  return Math.ceil(text.length / charsPerToken)
}

function messageToText(message: UIMessage): string {
  const parts: string[] = []
  for (const part of message.parts) {
    if (part.type === 'text') {
      parts.push(part.text)
    } else if (part.type === 'dynamic-tool' || part.type.startsWith('tool-')) {
      parts.push(JSON.stringify(part))
    }
  }

  const metadata = message.metadata as
    | { inline_file_contents?: Array<{ name?: string; content?: string }> }
    | undefined
  if (Array.isArray(metadata?.inline_file_contents)) {
    for (const file of metadata.inline_file_contents) {
      if (file?.content) {
        parts.push(`File: ${file.name || 'attachment'}\n${file.content}`)
      }
    }
  }

  return parts.join('\n')
}

export function estimateMessageTokens(
  message: UIMessage,
  charsPerToken: number = DEFAULT_CHARS_PER_TOKEN
): number {
  const text = messageToText(message)
  // Add a small overhead per message for role/formatting tokens
  return estimateTokens(text, charsPerToken) + 4
}

/** Total character count of messages, using the same text basis as the estimator. */
export function totalMessageChars(messages: UIMessage[]): number {
  return messages.reduce((sum, message) => sum + messageToText(message).length, 0)
}

function threadMessageToText(message: ThreadMessage): string {
  const parts: string[] = []
  for (const content of message.content ?? []) {
    if (content.type === 'text' && content.text?.value) {
      parts.push(content.text.value)
    } else if (content.type === 'image_url' && content.image_url?.url) {
      parts.push(`[image: ${content.image_url.url}]`)
    } else if (content.type === 'tool_call') {
      parts.push(
        `[tool_call ${content.tool_name ?? 'unknown'}]\n${JSON.stringify({
          input: content.input,
          output: content.output,
        })}`
      )
    }
  }

  return parts.join('\n')
}

export function estimateThreadMessageTokens(
  message: ThreadMessage,
  charsPerToken: number = DEFAULT_CHARS_PER_TOKEN
): number {
  return estimateTokens(threadMessageToText(message), charsPerToken) + 4
}

export const BIYAN_COMPACT_PROMPT_TEMPLATE = `You are performing BIYAN CONTEXT COMPACTION.

Your job is to create a continuation handoff summary for a future assistant turn. The raw conversation before this compact point may no longer be available, so the summary must preserve everything needed to continue accurately without replaying the full transcript.

Output only Markdown. Do not include private chain-of-thought. Do not mention that you are an AI summarizer.

Preserve these categories, in this order:

# Stable Context
- User's goal and explicit success criteria.
- User preferences, constraints, exclusions, and important assumptions.
- Product, repo, platform, provider, model, or environment facts that remain relevant.
- Durable decisions already made, including rationale when it affects future choices.

# Current State
- What work was completed.
- What is currently in progress.
- The exact next step that should be taken, if any.
- Any blockers, open questions, or risks.

# Technical Details
- Important files, APIs, data shapes, settings, commands, tests, errors, and results.
- For code work, name concrete files/symbols and summarize edits or intended edits.
- Include short exact snippets only when the exact text is necessary to continue; otherwise paraphrase.

# Recent User Intent
- Capture the most recent user requests with extra precision.
- Preserve custom compact instructions supplied by the user.
- If the user changed direction, prioritize the latest direction.

# Tool And Verification State
- Summarize relevant tool calls, searches, reads, builds, tests, screenshots, or failures.
- Note what has not been verified yet.

# Continuation Instructions
- Tell the next assistant how to resume without asking unnecessary recap questions.
- State what should not be repeated or re-done.

If an earlier Biyan compact summary appears in the conversation, treat it as authoritative historical context and merge it into this new summary. Remove duplication, but do not drop durable decisions or unresolved tasks.

If custom compact instructions are provided below, follow them with highest priority unless they conflict with preserving correctness:

<custom_compact_instructions>
{{customInstructions}}
</custom_compact_instructions>`

export function buildCompactPrompt(customInstructions?: string): string {
  return BIYAN_COMPACT_PROMPT_TEMPLATE.replace(
    '{{customInstructions}}',
    customInstructions?.trim() || 'None.'
  )
}

export interface ThreadCompactionSelectionOptions {
  keepRecentMessages?: number
  maxRecentTokens?: number
  minMessagesToCompact?: number
}

export function selectMessagesForCompaction(
  messages: ThreadMessage[],
  options: ThreadCompactionSelectionOptions = {}
): { toCompact: ThreadMessage[]; toKeep: ThreadMessage[] } {
  const keepRecentMessages = options.keepRecentMessages ?? 4
  const maxRecentTokens = options.maxRecentTokens ?? 20_000
  const minMessagesToCompact = options.minMessagesToCompact ?? 2

  if (messages.length <= keepRecentMessages) {
    return { toCompact: [], toKeep: messages }
  }

  let recentTokens = 0
  let keepStart = messages.length
  for (let i = messages.length - 1; i >= 0; i--) {
    const nextTokens = estimateThreadMessageTokens(messages[i])
    const mustKeepForCount = messages.length - i <= keepRecentMessages
    if (!mustKeepForCount && recentTokens + nextTokens > maxRecentTokens) {
      break
    }
    recentTokens += nextTokens
    keepStart = i
  }

  const toCompact = messages.slice(0, keepStart)
  if (toCompact.length < minMessagesToCompact) {
    return { toCompact: [], toKeep: messages }
  }

  return {
    toCompact,
    toKeep: messages.slice(keepStart),
  }
}

export function mergeExistingSummaries(summaries: string[], newSummary: string): string {
  const uniqueSummaries = summaries
    .map((summary) => summary.trim())
    .filter(Boolean)

  if (uniqueSummaries.length === 0) return newSummary.trim()

  return [
    '# Previous Biyan Compact Summaries',
    uniqueSummaries.join('\n\n---\n\n'),
    '# New Compact Summary',
    newSummary.trim(),
  ].join('\n\n')
}

export interface ContextManagerConfig {
  maxContextTokens: number
  maxOutputTokens: number
  autoCompact: boolean
}

export interface TrimResult {
  messages: UIMessage[]
  trimmedCount: number
  compactedSummary?: string
}

interface MessageUnit {
  messages: UIMessage[]
  tokens: number
  /** System-only units (e.g. an injected compaction summary) are always kept. */
  pinned: boolean
}

function isUnitHeader(role: string): boolean {
  return role === 'user' || role === 'system'
}

/**
 * Group messages into atomic conversation units so trimming never splits a
 * tool call from its result (or an assistant answer from the user turn that
 * prompted it). A unit starts at a user/system message and absorbs the
 * following assistant/tool messages until the next user/system message.
 * Leading assistant/tool messages with no header form their own unit.
 *
 * This matters because `convertToModelMessages` expands a tool call and its
 * result into separate model messages; dropping one without the other yields a
 * provider error (e.g. Anthropic "tool_use without tool_result"). Keeping whole
 * units also guarantees the trimmed window starts at a user/system boundary.
 */
function groupIntoUnits(
  messages: UIMessage[],
  charsPerToken: number
): MessageUnit[] {
  const units: MessageUnit[] = []

  for (const message of messages) {
    const startNew = units.length === 0 || isUnitHeader(message.role)
    if (startNew) {
      units.push({
        messages: [message],
        tokens: estimateMessageTokens(message, charsPerToken),
        pinned: message.role === 'system',
      })
    } else {
      const unit = units[units.length - 1]
      unit.messages.push(message)
      unit.tokens += estimateMessageTokens(message, charsPerToken)
    }
  }

  return units
}

/**
 * Trim messages to fit within the context budget.
 *
 * Strategy:
 * 1. Always keep the system prompt (counted separately).
 * 2. Group messages into atomic conversation units (a user/system turn plus its
 *    following assistant/tool messages) so tool-call/result pairs are never
 *    split and the window starts at a user/system boundary.
 * 3. Always keep system-only units (e.g. an injected compaction summary).
 * 4. Walk units backwards from the newest, keeping whole units that fit; drop
 *    the oldest units that don't.
 * 5. Never drop the newest unit, even if it alone exceeds the budget.
 */
export function trimMessages(
  messages: UIMessage[],
  config: ContextManagerConfig,
  systemPromptTokens: number = 0,
  charsPerToken: number = DEFAULT_CHARS_PER_TOKEN
): TrimResult {
  const { maxContextTokens, maxOutputTokens } = config

  if (maxContextTokens <= 0) {
    return { messages, trimmedCount: 0 }
  }

  const inputBudget = maxContextTokens - maxOutputTokens - systemPromptTokens
  if (inputBudget <= 0) {
    return { messages: messages.slice(-1), trimmedCount: messages.length - 1 }
  }

  const units = groupIntoUnits(messages, charsPerToken)
  const keptUnitIndices = new Set<number>()

  // Pinned (system summary) units are always kept; count them against the
  // budget up front.
  let totalTokens = 0
  units.forEach((unit, index) => {
    if (unit.pinned) {
      keptUnitIndices.add(index)
      totalTokens += unit.tokens
    }
  })

  // Keep a contiguous suffix of the newest units that fit. Always keep the
  // newest unit (the floor), even if it alone exceeds the budget.
  let keptAnyTurn = false
  for (let index = units.length - 1; index >= 0; index--) {
    const unit = units[index]
    if (unit.pinned) continue
    const fits = totalTokens + unit.tokens <= inputBudget
    if (!fits && keptAnyTurn) {
      break
    }
    totalTokens += unit.tokens
    keptUnitIndices.add(index)
    keptAnyTurn = true
  }

  // Reassemble kept units in original order.
  const kept: UIMessage[] = []
  units.forEach((unit, index) => {
    if (keptUnitIndices.has(index)) {
      kept.push(...unit.messages)
    }
  })

  return {
    messages: kept,
    trimmedCount: messages.length - kept.length,
  }
}

const COMPACT_SYSTEM_PROMPT =
  'You are a conversation summarizer. Produce a concise summary that preserves ' +
  'key facts, decisions, code snippets, and action items. Use bullet points. ' +
  'Keep the summary under 500 words.'

/**
 * Re-fit kept messages around a freshly generated summary. The summary is
 * always prepended (dropping it defeats compaction); its budget is reserved up
 * front. Prefer the provider's REAL summary token count when available, falling
 * back to a calibrated char estimate of the summary text.
 */
export function refitAroundSummary(
  summaryMessage: UIMessage,
  keptMessages: UIMessage[],
  config: ContextManagerConfig,
  systemPromptTokens: number,
  charsPerToken: number = DEFAULT_CHARS_PER_TOKEN,
  summaryTokensOverride?: number
): { messages: UIMessage[]; trimmedCount: number } {
  const summaryTokens =
    typeof summaryTokensOverride === 'number' && summaryTokensOverride > 0
      ? summaryTokensOverride
      : estimateMessageTokens(summaryMessage, charsPerToken)

  const refit = trimMessages(
    keptMessages,
    config,
    systemPromptTokens + summaryTokens,
    charsPerToken
  )

  return {
    messages: [summaryMessage, ...refit.messages],
    trimmedCount: refit.trimmedCount,
  }
}

/**
 * Summarize older messages that would be trimmed, then prepend the summary
 * as a system-style user message so the model retains context.
 */
export async function compactMessages(
  messages: UIMessage[],
  config: ContextManagerConfig,
  model: LanguageModel,
  systemPromptTokens: number = 0,
  charsPerToken: number = DEFAULT_CHARS_PER_TOKEN
): Promise<TrimResult> {
  const { maxContextTokens, maxOutputTokens } = config

  if (maxContextTokens <= 0) {
    return { messages, trimmedCount: 0 }
  }

  const inputBudget = maxContextTokens - maxOutputTokens - systemPromptTokens
  if (inputBudget <= 0) {
    return { messages: messages.slice(-1), trimmedCount: messages.length - 1 }
  }

  // First figure out which messages would be kept/dropped
  const trimResult = trimMessages(messages, config, systemPromptTokens, charsPerToken)

  if (trimResult.trimmedCount === 0) {
    return trimResult
  }

  // Kept messages are NOT necessarily a contiguous suffix: a pinned system
  // summary is retained out of order. Derive the dropped set by difference
  // (trimMessages preserves message identity) instead of assuming the first N
  // were dropped — otherwise an already-present summary would be re-summarized
  // and a genuinely dropped middle turn would be lost.
  const keptMessages = new Set(trimResult.messages)
  const droppedMessages = messages.filter((m) => !keptMessages.has(m))

  // Build conversation text from dropped messages
  const conversationText = droppedMessages
    .map((m) => {
      const text = m.parts
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('')
      return `${m.role}: ${text}`
    })
    .join('\n\n')

  if (!conversationText.trim()) {
    return trimResult
  }

  // The summarization call itself uses context: system prompt + conversation
  // excerpt + summary output. Cap the excerpt to ~70% of the context budget
  // (in characters, using the same heuristic) so the call doesn't exceed limits.
  const summaryOutputTokens = 512
  const summaryBudgetTokens = Math.max(
    1024,
    maxContextTokens -
      summaryOutputTokens -
      estimateTokens(COMPACT_SYSTEM_PROMPT, charsPerToken)
  )
  const maxExcerptChars = Math.floor(summaryBudgetTokens * charsPerToken)

  const truncated =
    conversationText.length > maxExcerptChars
      ? conversationText.slice(-maxExcerptChars)
      : conversationText

  try {
    const { text: summary, usage } = await generateText({
      model,
      system: COMPACT_SYSTEM_PROMPT,
      prompt: `Summarize this conversation excerpt:\n\n${truncated}`,
      maxOutputTokens: summaryOutputTokens,
    })

    // Inject the summary as a system message so models treat it as context
    // rather than as a user turn (which could confuse turn-taking logic).
    const summaryMessage: UIMessage = {
      id: `compact-summary-${Date.now()}`,
      role: 'system',
      parts: [
        {
          type: 'text',
          text: `[Previous conversation summary]\n${summary}`,
        },
      ],
    }

    // The summary consumes budget too. Prefer the provider's REAL output-token
    // count over a char estimate; reserve it as fixed prefix budget and re-trim
    // only the kept conversation around it.
    const refit = refitAroundSummary(
      summaryMessage,
      trimResult.messages,
      config,
      systemPromptTokens,
      charsPerToken,
      usage?.outputTokens
    )

    return {
      messages: refit.messages,
      trimmedCount: trimResult.trimmedCount + refit.trimmedCount,
      compactedSummary: summary,
    }
  } catch (error) {
    console.warn('Auto-compact summarization failed, falling back to trim:', error)
    return trimResult
  }
}
