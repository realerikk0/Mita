import { describe, expect, it } from 'vitest'
import { migrateLegacyProviderState } from '../useModelProvider'

const state = (provider: Record<string, unknown>) =>
  ({
    providers: [
      {
        provider: 'jan',
        active: true,
        api_key: 'secret',
        settings: [],
        models: [{ id: 'model-1' }],
        ...provider,
      },
    ],
    selectedProvider: 'jan',
    selectedModel: { id: 'model-1' },
    deletedModels: [],
  }) as any

describe('legacy provider migration', () => {
  it('normalizes a Biyuan-hosted Jan provider to the canonical provider', () => {
    const migrated = migrateLegacyProviderState(
      state({ base_url: 'https://api.biyuan.ai/v1' })
    )

    expect(migrated.providers[0].provider).toBe('jingxing')
    expect(migrated.selectedProvider).toBe('jingxing')
    expect(migrated.selectedModel?.id).toBe('model-1')
  })

  it('preserves a remote third-party endpoint as OpenAI-compatible', () => {
    const migrated = migrateLegacyProviderState(
      state({ base_url: 'https://models.example.test/v1' })
    )

    expect(migrated.providers[0].provider).toBe('openai-compatible')
    expect(migrated.providers[0].base_url).toBe(
      'https://models.example.test/v1'
    )
    expect(migrated.selectedProvider).toBe('openai-compatible')
  })

  it.each([
    ['legacy-first', true],
    ['canonical-first', false],
  ])(
    'preserves both remote configurations independent of persisted order: %s',
    (_label, legacyFirst) => {
      const legacy = {
        provider: 'jan',
        active: true,
        api_key: 'legacy-key',
        base_url: 'https://legacy.example.test/v1',
        settings: [{ key: 'legacy-setting', controller_props: { value: 'a' } }],
        custom_header: { 'X-Legacy': 'a' },
        models: [{ id: 'legacy-model' }],
      }
      const canonical = {
        provider: 'openai-compatible',
        active: true,
        api_key: 'canonical-key',
        base_url: 'https://canonical.example.test/v1',
        settings: [
          { key: 'canonical-setting', controller_props: { value: 'b' } },
        ],
        custom_header: { 'X-Canonical': 'b' },
        models: [{ id: 'canonical-model' }],
      }
      const migrated = migrateLegacyProviderState({
        providers: legacyFirst ? [legacy, canonical] : [canonical, legacy],
        selectedProvider: 'jan',
        selectedModel: { id: 'legacy-model' },
        deletedModels: [],
      } as any)

      expect(
        migrated.providers.find(
          (provider) => provider.provider === 'openai-compatible'
        )
      ).toMatchObject(canonical)
      expect(
        migrated.providers.find(
          (provider) => provider.provider === 'openai-compatible-import-1'
        )
      ).toMatchObject({ ...legacy, provider: 'openai-compatible-import-1' })
      expect(migrated.selectedProvider).toBe('openai-compatible-import-1')
      expect(migrated.selectedModel?.id).toBe('legacy-model')
    }
  )

  it.each([
    'http://localhost:1337/v1',
    'http://127.0.0.1:8080/v1',
    undefined,
  ])('retires local endpoint %s without selecting a paid remote model', (baseUrl) => {
    const migrated = migrateLegacyProviderState(state({ base_url: baseUrl }))

    expect(migrated.providers[0]).toMatchObject({
      provider: 'retired-local-runtime',
      active: false,
    })
    expect(migrated.selectedProvider).toBe('')
    expect(migrated.selectedModel).toBeNull()
  })
})
