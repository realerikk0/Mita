export function isChatModelSelectable(modelId?: string): boolean {
  if (!modelId) return false

  const normalized = modelId.toLowerCase()

  return ![
    /^gpt-image(?:-|$)/,
    /(?:^|[-_.])image(?:[-_.]|$)/,
  ].some((pattern) => pattern.test(normalized))
}
