const LEGACY_INTRO_THREAD_TITLES = new Set([
  'What is Jan?',
  'What is Silence?',
])

export function isLegacyIntroThreadTitle(title?: string): boolean {
  return !!title && LEGACY_INTRO_THREAD_TITLES.has(title)
}
