import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DefaultProvidersService } from '../default'

describe('DefaultProvidersService', () => {
  let svc: DefaultProvidersService

  beforeEach(() => {
    svc = new DefaultProvidersService()
    vi.restoreAllMocks()
  })

  describe('getProviders', () => {
    it('returns empty array', async () => {
      const result = await svc.getProviders()
      expect(result).toEqual([])
    })
  })

  describe('fetchModelsFromProvider', () => {
    it('returns empty array', async () => {
      const result = await svc.fetchModelsFromProvider({
        provider: 'test',
        active: false,
        base_url: 'https://example.com',
        models: [],
      } as any)
      expect(result).toEqual([])
    })
  })

  describe('fetchProviderBalance', () => {
    it('does not log provider secrets in the web fallback path', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      await svc.fetchProviderBalance({
        provider: 'xai',
        active: true,
        base_url: 'https://api.x.ai/v1',
        api_key: 'sk-secret',
        api_key_fallbacks: ['sk-fallback-secret'],
        models: [],
        settings: [
          {
            key: 'xai-management-key',
            controller_type: 'input',
            controller_props: { value: 'mgmt-secret' },
          },
        ],
      } as any)

      const logged = JSON.stringify(logSpy.mock.calls)
      expect(logged).not.toContain('sk-secret')
      expect(logged).not.toContain('sk-fallback-secret')
      expect(logged).not.toContain('mgmt-secret')
      expect(logSpy).not.toHaveBeenCalled()
    })
  })

  describe('updateSettings', () => {
    it('resolves without error', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      await expect(
        svc.updateSettings('test-provider', [
          { key: 'api_key', controller_type: 'input', controller_props: { value: 'sk-123' } } as any,
        ])
      ).resolves.toBeUndefined()

      expect(logSpy).not.toHaveBeenCalled()
      expect(JSON.stringify(logSpy.mock.calls)).not.toContain('sk-123')
    })
  })

  describe('fetch', () => {
    it('returns the global fetch function', () => {
      const result = svc.fetch()
      expect(result).toBe(fetch)
    })
  })
})
