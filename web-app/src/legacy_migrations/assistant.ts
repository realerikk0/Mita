export const LEGACY_DEFAULT_ASSISTANT_IDS = ['mita', 'jan', 'silence']

const LEGACY_ASSISTANT_NAMES = new Set(['Mita', 'Jan', 'Silence'])

const LEGACY_ASSISTANT_BRANDING_MARKERS = [
  'Mita is a quiet desktop assistant',
  'You are Mita',
  'your agent identity is Mita',
  'Chinese app name is "幂塔"',
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

export function hasLegacyAssistantBranding(assistant: {
  name?: string
  description?: string
  instructions?: string
}): boolean {
  if (assistant.name && LEGACY_ASSISTANT_NAMES.has(assistant.name)) return true

  const text = [assistant.description ?? '', assistant.instructions ?? ''].join(
    '\n'
  )
  return LEGACY_ASSISTANT_BRANDING_MARKERS.some((marker) =>
    text.includes(marker)
  )
}
