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
