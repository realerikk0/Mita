import { describe, expect, it } from 'vitest'

import {
  applyProviderConnectionToProvider,
  parseProviderConnection,
  parseProviderConnectionDeepLink,
  resolveProviderConnectionImportTarget,
} from '../provider-connection-import'

describe('parseProviderConnection', () => {
  it('parses the generic provider connection schema', () => {
    const result = parseProviderConnection(
      JSON.stringify({
        _type: 'ai_provider_connection',
        version: 1,
        provider: 'openai-compatible',
        name: 'Jingxing',
        apiKey: ' sk-imported ',
        baseUrl: 'https://api.example.com/v1///',
        apiVersion: '2024-10-21',
        deployment: 'gpt-deployment',
        defaultModel: 'gpt-4.1',
        headers: {
          'X-Custom': 'custom-value',
        },
        extra: {
          region: 'eastus',
        },
      })
    )

    expect(result).toEqual({
      provider: 'openai-compatible',
      name: 'Jingxing',
      apiKey: 'sk-imported',
      baseUrl: 'https://api.example.com/v1',
      apiVersion: '2024-10-21',
      deployment: 'gpt-deployment',
      defaultModel: 'gpt-4.1',
      headers: {
        'X-Custom': 'custom-value',
      },
      extra: {
        region: 'eastus',
      },
    })
  })

  it('parses the legacy newapi channel schema', () => {
    const result = parseProviderConnection(
      JSON.stringify({
        _type: 'newapi_channel_conn',
        version: 1,
        key: 'sk-legacy',
        url: 'https://api.legacy.example.com/',
      })
    )

    expect(result).toMatchObject({
      provider: 'openai-compatible',
      name: 'Imported Provider',
      apiKey: 'sk-legacy',
      baseUrl: 'https://api.legacy.example.com',
    })
  })

  it('rejects invalid JSON', () => {
    expect(() => parseProviderConnection('{bad')).toThrow('配置格式不正确')
  })

  it('rejects unsupported config types', () => {
    expect(() =>
      parseProviderConnection(
        JSON.stringify({
          _type: 'something_else',
          version: 1,
          apiKey: 'sk-test',
          baseUrl: 'https://api.example.com',
        })
      )
    ).toThrow('不支持的配置类型')
  })

  it('rejects unsupported versions', () => {
    expect(() =>
      parseProviderConnection(
        JSON.stringify({
          _type: 'ai_provider_connection',
          version: 2,
          apiKey: 'sk-test',
          baseUrl: 'https://api.example.com',
        })
      )
    ).toThrow('不支持的配置版本')
  })

  it('rejects missing API keys', () => {
    expect(() =>
      parseProviderConnection(
        JSON.stringify({
          _type: 'ai_provider_connection',
          version: 1,
          baseUrl: 'https://api.example.com',
        })
      )
    ).toThrow('缺少 API Key')
  })

  it('rejects invalid base URLs', () => {
    expect(() =>
      parseProviderConnection(
        JSON.stringify({
          _type: 'ai_provider_connection',
          version: 1,
          apiKey: 'sk-test',
          baseUrl: 'ftp://api.example.com',
        })
      )
    ).toThrow('Base URL 不正确')
  })

  it('parses direct provider import deep links', () => {
    const result = parseProviderConnectionDeepLink(
      'biyan://provider/import?provider=jingxing&apiKey=sk-imported&baseUrl=https%3A%2F%2Fapi.example.com%2Fv1%2F&defaultModel=gpt-5.1'
    )

    expect(result).toMatchObject({
      provider: 'jingxing',
      name: 'jingxing',
      apiKey: 'sk-imported',
      baseUrl: 'https://api.example.com/v1',
      defaultModel: 'gpt-5.1',
    })
  })

  it('accepts the retired provider-import scheme at ingress only', () => {
    expect(
      parseProviderConnectionDeepLink(
        'mita://provider/import?provider=jingxing&apiKey=sk-legacy&baseUrl=https%3A%2F%2Fapi.example.com%2Fv1'
      )
    ).toMatchObject({ provider: 'jingxing', apiKey: 'sk-legacy' })
  })

  it('ignores non-provider import deep links', () => {
    expect(parseProviderConnectionDeepLink('biyan://host/action/owner/repo')).toBeNull()
  })

  it('rejects invalid direct provider import deep links', () => {
    expect(() =>
      parseProviderConnectionDeepLink(
        'biyan://provider/import?provider=jingxing&baseUrl=https%3A%2F%2Fapi.example.com%2Fv1'
      )
    ).toThrow('缺少 API Key')
  })
})

describe('resolveProviderConnectionImportTarget', () => {
  const connection = {
    provider: 'biyuan',
    name: 'Biyuan',
    apiKey: 'sk-imported',
    baseUrl: 'https://api.biyuan.ai/v1',
    apiVersion: '',
    deployment: '',
    defaultModel: 'gpt-image-2',
    headers: {},
    extra: {},
  }

  it('prefers an exact existing Biyuan provider before another family member', () => {
    const jingxing = {
      provider: 'jingxing',
      base_url: 'https://api.biyuan.ai/v1',
    } as ModelProvider
    const biyuan = {
      provider: 'biyuan',
      base_url: 'https://api.biyuan.ai/v1',
    } as ModelProvider

    expect(
      resolveProviderConnectionImportTarget([jingxing, biyuan], connection)
    ).toEqual({ providerName: 'biyuan', existingProvider: biyuan })
  })

  it('reuses an existing Biyuan family provider when the exact id is absent', () => {
    const jingxing = {
      provider: 'jingxing',
      base_url: 'https://api.biyuan.ai/v1',
    } as ModelProvider

    expect(
      resolveProviderConnectionImportTarget([jingxing], connection)
    ).toEqual({ providerName: 'jingxing', existingProvider: jingxing })
  })

  it('uses canonical jingxing for a new Biyuan family import', () => {
    expect(resolveProviderConnectionImportTarget([], connection)).toEqual({
      providerName: 'jingxing',
      existingProvider: undefined,
    })
  })

  it('does not overwrite an unrelated openai-compatible provider', () => {
    const thirdParty = {
      provider: 'openai-compatible',
      base_url: 'https://api.example.com/v1',
    } as ModelProvider

    expect(
      resolveProviderConnectionImportTarget([thirdParty], {
        ...connection,
        provider: 'openai-compatible',
      })
    ).toEqual({ providerName: 'jingxing', existingProvider: undefined })
  })
})

describe('applyProviderConnectionToProvider', () => {
  it('keeps fallback keys, models, and model settings while replacing the primary key', () => {
    const modelSettings = { temperature: { value: 0.2 } }
    const provider = {
      provider: 'biyuan',
      active: true,
      api_key: 'sk-old',
      api_key_fallbacks: ['sk-fallback'],
      base_url: 'https://old.example.com/v1',
      models: [
        {
          id: 'gpt-image-2',
          capabilities: ['completion'],
          settings: modelSettings,
        },
      ],
      settings: [
        { key: 'api-key', controller_props: { value: 'sk-old' } },
        {
          key: 'base-url',
          controller_props: { value: 'https://old.example.com/v1' },
        },
      ],
    } as ModelProvider
    const imported = {
      provider: 'biyuan',
      name: 'Biyuan',
      apiKey: 'sk-new',
      baseUrl: 'https://api.biyuan.ai/v1',
      apiVersion: '',
      deployment: '',
      defaultModel: '',
      headers: {},
      extra: {},
    }

    const updated = applyProviderConnectionToProvider(provider, imported)

    expect(updated.api_key).toBe('sk-new')
    expect(updated.api_key_fallbacks).toEqual(['sk-fallback'])
    expect(updated.models).toEqual(provider.models)
    expect(updated.models[0].settings).toBe(modelSettings)
  })
})
