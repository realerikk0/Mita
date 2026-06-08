const CHAT_MODEL_FAMILY_PATTERNS = [
  {
    providers: ['anthropic'],
    patterns: [/(?:^|[/:._-])claude(?:[/:._-]|$)/],
  },
  {
    providers: ['openai', 'azure-openai'],
    patterns: [/(?:^|[/:._-])gpt(?:[/:._-]|$)/],
  },
  {
    providers: ['gemini', 'google'],
    patterns: [/(?:^|[/:._-])gemini(?:[/:._-]|$)/],
  },
  {
    providers: ['xai'],
    patterns: [/(?:^|[/:._-])grok(?:[/:._-]|$)/],
  },
] as const

export function getChatModelFamilySortRank(
  providerName: string,
  modelId = ''
): number {
  const normalizedProvider = providerName.toLowerCase()
  const normalizedModel = modelId.toLowerCase()

  const familyIndex = CHAT_MODEL_FAMILY_PATTERNS.findIndex((family) => {
    return (
      (family.providers as readonly string[]).includes(normalizedProvider) ||
      family.patterns.some((pattern) => pattern.test(normalizedModel))
    )
  })

  return familyIndex === -1 ? CHAT_MODEL_FAMILY_PATTERNS.length : familyIndex
}
