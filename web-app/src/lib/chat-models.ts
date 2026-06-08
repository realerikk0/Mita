export function isChatModelSelectable(modelId?: string): boolean {
  if (!modelId) return false

  const normalized = modelId.toLowerCase()

  return ![
    /^gpt-image(?:-|$)/,
    /(?:^|[-_.])image(?:[-_.]|$)/,
    /(?:^|[-_.])video(?:[-_.]|$)/,
    /(?:^|[-_.])seedance(?:[-_.]|$)/,
    /(?:^|[-_.])seedane(?:[-_.]|$)/,
    /(?:^|[-_.])transcribe(?:[-_.]|$)/,
    /^whisper(?:-|$)/,
  ].some((pattern) => pattern.test(normalized))
}
