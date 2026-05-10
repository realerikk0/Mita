import type { UIMessage } from '@ai-sdk/react'
import { generateText, type LanguageModel } from 'ai'
import type { ThreadMessage } from '@janhq/core'

/**
 * Approximate token count using a character-based heuristic.
 *
 * On average, 1 token ≈ 4 characters for English text across most
 * tokenizers (GPT, Claude, etc.). This is intentionally conservative
 * so the trimmer leaves a safety margin.
 */
const CHARS_PER_TOKEN = 3.5

export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / CHARS_PER_TOKEN)
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

export function estimateMessageTokens(message: UIMessage): number {
  const text = messageToText(message)
  // Add a small overhead per message for role/formatting tokens
  return estimateTokens(text) + 4
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

export function estimateThreadMessageTokens(message: ThreadMessage): number {
  return estimateTokens(threadMessageToText(message)) + 4
}

export const MITA_COMPACT_PROMPT_TEMPLATE = `You are performing MITA CONTEXT COMPACTION.

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

If an earlier Mita compact summary appears in the conversation, treat it as authoritative historical context and merge it into this new summary. Remove duplication, but do not drop durable decisions or unresolved tasks.

If custom compact instructions are provided below, follow them with highest priority unless they conflict with preserving correctness:

<custom_compact_instructions>
{{customInstructions}}
</custom_compact_instructions>`

export function buildCompactPrompt(customInstructions?: string): string {
  return MITA_COMPACT_PROMPT_TEMPLATE.replace(
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
    '# Previous Mita Compact Summaries',
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

/**
 * Trim messages to fit within the context budget.
 *
 * Strategy:
 * 1. Always keep the system prompt (counted separately) and the most recent message
 * 2. Walk backwards from the newest message, accumulating tokens
 * 3. Drop the oldest messages that don't fit
 * 4. Never drop the first user message if it would leave no context
 */
export function trimMessages(
  messages: UIMessage[],
  config: ContextManagerConfig,
  systemPromptTokens: number = 0
): TrimResult {
  const { maxContextTokens, maxOutputTokens } = config

  if (maxContextTokens <= 0) {
    return { messages, trimmedCount: 0 }
  }

  const inputBudget = maxContextTokens - maxOutputTokens - systemPromptTokens
  if (inputBudget <= 0) {
    return { messages: messages.slice(-1), trimmedCount: messages.length - 1 }
  }

  // Estimate tokens for each message
  const estimates = messages.map((msg) => ({
    message: msg,
    tokens: estimateMessageTokens(msg),
  }))

  // Walk backwards, accumulating tokens
  let totalTokens = 0
  const kept: UIMessage[] = []

  for (let i = estimates.length - 1; i >= 0; i--) {
    const { message, tokens } = estimates[i]
    if (totalTokens + tokens > inputBudget && kept.length > 0) {
      break
    }
    totalTokens += tokens
    kept.unshift(message)
  }

  // Ensure we always have at least the last message
  if (kept.length === 0 && messages.length > 0) {
    kept.push(messages[messages.length - 1])
  }

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
 * Summarize older messages that would be trimmed, then prepend the summary
 * as a system-style user message so the model retains context.
 */
export async function compactMessages(
  messages: UIMessage[],
  config: ContextManagerConfig,
  model: LanguageModel,
  systemPromptTokens: number = 0
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
  const trimResult = trimMessages(messages, config, systemPromptTokens)

  if (trimResult.trimmedCount === 0) {
    return trimResult
  }

  const droppedMessages = messages.slice(0, trimResult.trimmedCount)

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
    maxContextTokens - summaryOutputTokens - estimateTokens(COMPACT_SYSTEM_PROMPT)
  )
  const maxExcerptChars = Math.floor(summaryBudgetTokens * CHARS_PER_TOKEN)

  const truncated =
    conversationText.length > maxExcerptChars
      ? conversationText.slice(-maxExcerptChars)
      : conversationText

  try {
    const { text: summary } = await generateText({
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

    // Re-trim: the summary message itself consumes tokens, so the combined
    // set (summary + kept messages) may exceed the input budget. Run
    // trimMessages again on the merged list to guarantee we stay within
    // the context window.
    const merged = [summaryMessage, ...trimResult.messages]
    const refit = trimMessages(merged, config, systemPromptTokens)

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
