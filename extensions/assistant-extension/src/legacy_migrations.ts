import type { Assistant } from '@biyan/core'

export const LEGACY_DEFAULT_ASSISTANT_IDS = ['mita', 'jan', 'silence']

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

export const LEGACY_INSTRUCTION_PREFIX =
  'You are Jan, a helpful AI assistant.'

export function hasLegacyAssistantBranding(assistant: Assistant): boolean {
  if (assistant.name === 'Jan' || assistant.name === 'Silence') return true

  const text = [
    assistant.description ?? '',
    assistant.instructions ?? '',
  ].join('\n')

  return LEGACY_ASSISTANT_BRANDING_MARKERS.some((marker) =>
    text.includes(marker)
  )
}
