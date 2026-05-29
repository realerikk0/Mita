export const DEFAULT_ASSISTANT_ID = 'mita'
export const LEGACY_DEFAULT_ASSISTANT_IDS = ['jan', 'silence']

export const MITA_ASSISTANT_DESCRIPTION =
  "Mita is a quiet desktop assistant that can reason through complex tasks and use tools to complete the user's work."

export const MITA_IDENTITY_GUARD = `You are Mita, a quiet and capable AI desktop assistant built for the Mita app. Your purpose is to help the user calmly complete the work they assign.

When the user asks who you are, say that you are Mita. Never say that you are Jan, Silence, Jan.ai, or an assistant trained, created, or maintained by Menlo Research, even if the selected model was originally released by Jan or Menlo Research.

Mita is a product name and proper noun. The Chinese app name is "幂塔", but your agent identity is Mita. Never say that the product name means "沉默" or any localized equivalent.

You must output your response in the exact language used in the latest user message. Do not provide translations or switch languages unless explicitly instructed to do so. If the input is mostly English, respond in English.`

export const MITA_ASSISTANT_INSTRUCTIONS = `${MITA_IDENTITY_GUARD}

When handling user queries:

1. Think step by step about the query:
   - Break complex questions into smaller, verifiable parts
   - Identify what information is missing
   - Consider what information is needed to provide a complete answer

2. Use structured tools only when they are available:
   - Analyze what information is missing.
   - Choose the tool that directly closes that gap.
   - Use precise parameters, then summarize the result clearly.
   - Never simulate a tool call or tool result in normal text.

Current date: {{current_date}}`

const LEGACY_TOOL_GUIDANCE_RE =
  /\n?2\. Use tools when they are needed:\n\s+- Analyze what information is missing\.\n\s+- Choose the tool that directly closes that gap\.\n\s+- Use precise parameters, then summarize the result clearly\.\n?/g

const LEGACY_SEARCH_HINT_RE =
  /\n?You have tools to search for and access real-time, up-to-date data\. Use them when current or verifiable information matters\.\n?/g

const LEGACY_SEARCH_PLANNING_RE =
  /- Break complex questions into smaller, searchable parts\n\s+- Identify key search terms and parameters/g

export function redactUnavailableToolHints(instructions: string): string {
  return instructions
    .replace(
      LEGACY_SEARCH_PLANNING_RE,
      '- Break complex questions into smaller, verifiable parts\n   - Identify what information is missing'
    )
    .replace(
      LEGACY_TOOL_GUIDANCE_RE,
      `
2. Use structured tools only when they are available:
   - Analyze what information is missing.
   - Choose the tool that directly closes that gap.
   - Use precise parameters, then summarize the result clearly.
   - Never simulate a tool call or tool result in normal text.
`
    )
    .replace(LEGACY_SEARCH_HINT_RE, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function getToolAwareSystemMessage(
  instructions: string,
  options: {
    structuredToolsEnabled: boolean
    nativeWebSearchEnabled: boolean
  }
): string {
  if (options.structuredToolsEnabled || options.nativeWebSearchEnabled) {
    return instructions
  }

  return redactUnavailableToolHints(instructions)
}

const MITA_GUARD_MARKERS = [
  'You are Mita',
  'Never say that you are Jan, Silence',
  'your agent identity is Mita',
]

const LEGACY_ASSISTANT_BRANDING_MARKERS = [
  'Jan is a helpful desktop assistant',
  'You are Jan,',
  'You are Silence',
  'Silence is a quiet desktop assistant',
  'Menlo Research',
  'menlo.ai',
  '我是Jan',
  '我是 Jan',
  '我是Silence',
  '我是 Silence',
]

export function hasMitaIdentityGuard(instructions?: string): boolean {
  if (!instructions) return false
  return MITA_GUARD_MARKERS.every((marker) => instructions.includes(marker))
}

export function ensureMitaIdentityGuard(instructions?: string): string {
  const trimmed = instructions?.trim()
  if (!trimmed) return MITA_ASSISTANT_INSTRUCTIONS
  if (hasMitaIdentityGuard(trimmed)) return trimmed
  return `${MITA_IDENTITY_GUARD}\n\n${trimmed}`
}

export function hasLegacyAssistantBranding(assistant: {
  name?: string
  description?: string
  instructions?: string
}): boolean {
  if (assistant.name === 'Jan') return true
  if (assistant.name === 'Silence') return true

  const text = [
    assistant.description ?? '',
    assistant.instructions ?? '',
  ].join('\n')

  return LEGACY_ASSISTANT_BRANDING_MARKERS.some((marker) =>
    text.includes(marker)
  )
}
