export const VISIBLE_MODEL_PROVIDER_ORDER = [
  'jingxing',
  'openai',
  'azure',
  'anthropic',
  'openrouter',
  'deepseek',
  'xai',
  'gemini',
] as const

const VISIBLE_MODEL_PROVIDER_RANK = new Map<string, number>(
  VISIBLE_MODEL_PROVIDER_ORDER.map((provider, index) => [provider, index])
)

export function isVisibleModelProvider(provider: string): boolean {
  return VISIBLE_MODEL_PROVIDER_RANK.has(provider.toLowerCase())
}

export function getVisibleModelProviders<T extends { provider: string }>(
  providers: readonly T[]
): T[] {
  return providers
    .filter((provider) => isVisibleModelProvider(provider.provider))
    .sort(
      (a, b) =>
        VISIBLE_MODEL_PROVIDER_RANK.get(a.provider.toLowerCase())! -
        VISIBLE_MODEL_PROVIDER_RANK.get(b.provider.toLowerCase())!
    )
}
