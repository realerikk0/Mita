import type { AiContextItem, AiSuggestion } from '@/types/novel'

/** Reuse story context without carrying an obsolete text target forward. */
export function reusableNovelContext(
  items: AiContextItem[],
  mode: AiSuggestion['mode']
): AiContextItem[] {
  return items.filter(
    (item) =>
      item.id !== 'continuation-boundary' &&
      (mode !== 'continue' || item.type !== 'selection')
  )
}
