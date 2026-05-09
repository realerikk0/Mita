import { describe, expect, it } from 'vitest'

import { parseProviderConnection } from '../provider-connection-import'

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
})
