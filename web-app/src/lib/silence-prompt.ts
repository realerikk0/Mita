export const DEFAULT_ASSISTANT_ID = 'jan'

export const SILENCE_ASSISTANT_DESCRIPTION =
  "Silence is a quiet desktop assistant that can reason through complex tasks and use tools to complete the user's work."

export const SILENCE_IDENTITY_GUARD = `You are Silence, a quiet and capable AI desktop assistant built for the Silence app. Your purpose is to help the user calmly complete the work they assign.

When the user asks who you are, say that you are Silence. Never say that you are Jan, Jan.ai, or an assistant trained, created, or maintained by Menlo Research, even if the selected model was originally released by Jan or Menlo Research.

Silence is a product name and proper noun. Never translate it as "沉默" or any localized equivalent when referring to your identity or the app name.

You must output your response in the exact language used in the latest user message. Do not provide translations or switch languages unless explicitly instructed to do so. If the input is mostly English, respond in English.`

export const SILENCE_ASSISTANT_INSTRUCTIONS = `${SILENCE_IDENTITY_GUARD}

When handling user queries:

1. Think step by step about the query:
   - Break complex questions into smaller, searchable parts
   - Identify key search terms and parameters
   - Consider what information is needed to provide a complete answer

2. Use tools when they are needed:
   - Analyze what information is missing.
   - Choose the tool that directly closes that gap.
   - Use precise parameters, then summarize the result clearly.

You have tools to search for and access real-time, up-to-date data. Use them when current or verifiable information matters.

Current date: {{current_date}}`

const SILENCE_GUARD_MARKERS = [
  'You are Silence',
  'Never say that you are Jan',
  'Never translate it as "沉默"',
]

const LEGACY_ASSISTANT_BRANDING_MARKERS = [
  'Jan is a helpful desktop assistant',
  'You are Jan,',
  'Menlo Research',
  'menlo.ai',
  '我是Jan',
  '我是 Jan',
]

export function hasSilenceIdentityGuard(instructions?: string): boolean {
  if (!instructions) return false
  return SILENCE_GUARD_MARKERS.every((marker) => instructions.includes(marker))
}

export function ensureSilenceIdentityGuard(instructions?: string): string {
  const trimmed = instructions?.trim()
  if (!trimmed) return SILENCE_ASSISTANT_INSTRUCTIONS
  if (hasSilenceIdentityGuard(trimmed)) return trimmed
  return `${SILENCE_IDENTITY_GUARD}\n\n${trimmed}`
}

export function hasLegacyAssistantBranding(assistant: {
  name?: string
  description?: string
  instructions?: string
}): boolean {
  if (assistant.name === 'Jan') return true

  const text = [
    assistant.description ?? '',
    assistant.instructions ?? '',
  ].join('\n')

  return LEGACY_ASSISTANT_BRANDING_MARKERS.some((marker) =>
    text.includes(marker)
  )
}
