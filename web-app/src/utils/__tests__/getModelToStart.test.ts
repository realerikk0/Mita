import { beforeEach, describe, expect, it, vi } from 'vitest'
import { localStorageKey } from '@/constants/localStorage'
import { getLastUsedModel, getModelToStart } from '../getModelToStart'

const mkProvider = (name: string, modelIds: string[]): ModelProvider =>
  ({
    provider: name,
    active: true,
    api_key: 'test-key',
    base_url: `https://${name}.example.com/v1`,
    models: modelIds.map((id) => ({ id, capabilities: ['completion'] })),
    settings: [],
  }) as ModelProvider

describe('remote-only model resolution', () => {
  beforeEach(() => localStorage.clear())

  it('reads a valid last-used model record', () => {
    localStorage.setItem(
      localStorageKey.lastUsedModel,
      JSON.stringify({ provider: 'remote', model: 'chat' })
    )
    expect(getLastUsedModel()).toEqual({ provider: 'remote', model: 'chat' })
  })

  it('uses a configured remote last-used model', () => {
    const remote = mkProvider('remote', ['chat'])
    localStorage.setItem(
      localStorageKey.lastUsedModel,
      JSON.stringify({ provider: 'remote', model: 'chat' })
    )

    expect(
      getModelToStart({
        getProviderByName: (name) => (name === 'remote' ? remote : undefined),
      })
    ).toEqual({ model: 'chat', provider: remote })
  })

  it('falls back only to the supplied configured remote providers', () => {
    const remote = mkProvider('remote', ['chat'])
    expect(
      getModelToStart({
        getProviderByName: vi.fn(() => undefined),
        providers: [remote],
      })
    ).toEqual({ model: 'chat', provider: remote })
  })

  it('ignores a persisted media model and falls back to a text model', () => {
    const remote = mkProvider('remote', [
      'doubao-seedream-4-5-251128',
      'gpt-5.4',
    ])
    localStorage.setItem(
      localStorageKey.lastUsedModel,
      JSON.stringify({
        provider: 'remote',
        model: 'doubao-seedream-4-5-251128',
      })
    )

    expect(
      getModelToStart({
        getProviderByName: (name) => (name === 'remote' ? remote : undefined),
        providers: [remote],
      })
    ).toEqual({ model: 'gpt-5.4', provider: remote })
  })

  it('never uses the first raw provider model when it is media-only', () => {
    const remote = mkProvider('remote', [
      'doubao-seedance-2-0-260128',
      'claude-opus-4-8',
    ])

    expect(
      getModelToStart({
        getProviderByName: vi.fn(() => undefined),
        providers: [remote],
      })
    ).toEqual({ model: 'claude-opus-4-8', provider: remote })
  })

  it('returns null when every configured model is media-only', () => {
    const remote = mkProvider('remote', [
      'doubao-seedream-4-5-251128',
      'doubao-seedance-2-0-260128',
    ])

    expect(
      getModelToStart({
        getProviderByName: vi.fn(() => undefined),
        providers: [remote],
      })
    ).toBeNull()
  })

  it('rejects retired and loopback providers', () => {
    const retired = mkProvider('llamacpp', ['local'])
    const loopback = {
      ...mkProvider('custom', ['local']),
      base_url: 'http://127.0.0.1:1337/v1',
    }

    expect(
      getModelToStart({
        getProviderByName: vi.fn(() => undefined),
        providers: [retired, loopback],
      })
    ).toBeNull()
  })
})
