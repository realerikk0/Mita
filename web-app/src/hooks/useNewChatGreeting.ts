import { create } from 'zustand'

export const DEFAULT_NEW_CHAT_GREETING_COUNT = 20

type TranslationResourcesLike = Record<
  string,
  Record<string, Record<string, unknown>>
>

type I18nLike = {
  language?: string
  fallbackLng?: string
  resources?: TranslationResourcesLike
}

type NewChatGreetingState = {
  greetingIndex: number
  refreshGreeting: (count?: number) => void
}

const normalizeCount = (count: number) => Math.max(0, Math.floor(count))

export function getRandomGreetingIndex(
  count: number,
  previousIndex?: number,
  random: () => number = Math.random
) {
  const normalizedCount = normalizeCount(count)

  if (normalizedCount <= 1) return 0

  const previous =
    previousIndex === undefined
      ? undefined
      : ((previousIndex % normalizedCount) + normalizedCount) % normalizedCount
  const candidate = Math.floor(random() * (normalizedCount - 1))

  if (previous === undefined) return candidate

  return candidate >= previous ? candidate + 1 : candidate
}

function getDescriptionVariants(
  i18n: I18nLike,
  language?: string
): string[] | undefined {
  if (!language) return undefined

  const variants =
    i18n.resources?.[language]?.chat?.descriptionVariants

  if (!Array.isArray(variants)) return undefined

  return variants.filter(
    (variant): variant is string =>
      typeof variant === 'string' && variant.trim().length > 0
  )
}

export function getNewChatGreetingText(
  i18n: I18nLike,
  fallbackText: string,
  index: number
) {
  const variants =
    getDescriptionVariants(i18n, i18n.language) ??
    getDescriptionVariants(i18n, i18n.fallbackLng)

  if (!variants?.length) return fallbackText

  const normalizedIndex = ((index % variants.length) + variants.length) % variants.length
  return variants[normalizedIndex] ?? fallbackText
}

export const useNewChatGreeting = create<NewChatGreetingState>()((set, get) => ({
  greetingIndex: getRandomGreetingIndex(DEFAULT_NEW_CHAT_GREETING_COUNT),
  refreshGreeting: (count = DEFAULT_NEW_CHAT_GREETING_COUNT) => {
    set({
      greetingIndex: getRandomGreetingIndex(count, get().greetingIndex),
    })
  },
}))

export function refreshNewChatGreeting(count = DEFAULT_NEW_CHAT_GREETING_COUNT) {
  useNewChatGreeting.getState().refreshGreeting(count)
}
