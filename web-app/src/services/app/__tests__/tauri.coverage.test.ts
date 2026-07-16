import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TauriAppService } from '../tauri'
import { localStorageKey } from '@/constants/localStorage'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

const mockWindowCore = {
  api: {
    getAppConfigurations: vi.fn(),
    changeAppDataFolder: vi.fn(),
  },
}

Object.defineProperty(globalThis, 'window', {
  value: { core: mockWindowCore },
  writable: true,
})

describe('TauriAppService – coverage', () => {
  let svc: TauriAppService

  beforeEach(() => {
    svc = new TauriAppService()
    localStorage.clear()
    vi.clearAllMocks()
  })

  describe('factoryReset', () => {
    it('calls factory_reset without params when no keep flags', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      vi.mocked(invoke).mockResolvedValue(undefined)

      await svc.factoryReset()

      expect(invoke).toHaveBeenCalledWith('factory_reset')
    })

    it('calls factory_reset without params when both keep flags false', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      vi.mocked(invoke).mockResolvedValue(undefined)

      await svc.factoryReset({ keepAppData: false, keepConfigurations: false })

      expect(invoke).toHaveBeenCalledWith('factory_reset')
    })

    it('calls factory_reset with params when keepAppData true', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      vi.mocked(invoke).mockResolvedValue(undefined)

      await svc.factoryReset({ keepAppData: true, keepConfigurations: false })

      expect(invoke).toHaveBeenCalledWith('factory_reset', {
        keepAppData: true,
        keepConfigurations: false,
      })
    })

    it('calls factory_reset with params when keepConfigurations true', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      vi.mocked(invoke).mockResolvedValue(undefined)

      await svc.factoryReset({ keepAppData: false, keepConfigurations: true })

      expect(invoke).toHaveBeenCalledWith('factory_reset', {
        keepAppData: false,
        keepConfigurations: true,
      })
    })

    it('clears persisted projects when app data is wiped', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      vi.mocked(invoke).mockResolvedValue(undefined)
      localStorage.setItem(
        localStorageKey.threadManagement,
        JSON.stringify({
          state: { folders: [{ id: 'p1', name: 'Project 1' }] },
          version: 0,
        })
      )

      await svc.factoryReset({ keepAppData: false, keepConfigurations: true })

      expect(localStorage.getItem(localStorageKey.threadManagement)).toBeNull()
    })

    it('keeps persisted projects when app data is preserved', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      vi.mocked(invoke).mockResolvedValue(undefined)
      localStorage.setItem(
        localStorageKey.threadManagement,
        JSON.stringify({
          state: { folders: [{ id: 'p1', name: 'Project 1' }] },
          version: 0,
        })
      )

      await svc.factoryReset({ keepAppData: true, keepConfigurations: false })

      expect(localStorage.getItem(localStorageKey.threadManagement)).not.toBeNull()
    })

  })

  describe('getBiyanDataFolder', () => {
    it('returns undefined on error', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockWindowCore.api.getAppConfigurations.mockRejectedValue(new Error('fail'))

      const result = await svc.getBiyanDataFolder()

      expect(result).toBeUndefined()
      expect(spy).toHaveBeenCalled()
      spy.mockRestore()
    })

    it('returns undefined when config has no data_folder', async () => {
      mockWindowCore.api.getAppConfigurations.mockResolvedValue({})

      const result = await svc.getBiyanDataFolder()

      expect(result).toBeUndefined()
    })
  })

  describe('getServerStatus', () => {
    it('invokes get_server_status and returns boolean', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      vi.mocked(invoke).mockResolvedValue(true)

      const result = await svc.getServerStatus()

      expect(invoke).toHaveBeenCalledWith('get_server_status')
      expect(result).toBe(true)
    })
  })

  describe('readYaml', () => {
    it('invokes read_yaml with path and returns parsed data', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      const mockData = { key: 'value' }
      vi.mocked(invoke).mockResolvedValue(mockData)

      const result = await svc.readYaml('/some/path.yaml')

      expect(invoke).toHaveBeenCalledWith('read_yaml', { path: '/some/path.yaml' })
      expect(result).toEqual(mockData)
    })
  })

  describe('readLogs', () => {
    it('handles null return from invoke', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      vi.mocked(invoke).mockResolvedValue(null)

      const result = await svc.readLogs()

      expect(result).toEqual([])
    })
  })

  describe('parseLogLine', () => {
    it('parses warn level correctly', () => {
      const result = svc.parseLogLine('[2024-01-01][12:00:00Z][app][WARN] warning msg')
      expect(result.level).toBe('warn')
      expect(result.message).toBe('warning msg')
    })

    it('parses debug level correctly', () => {
      const result = svc.parseLogLine('[2024-01-01][12:00:00Z][app][DEBUG] debug msg')
      expect(result.level).toBe('debug')
    })

    it('handles empty string', () => {
      const result = svc.parseLogLine('')
      expect(result.message).toBe('')
      expect(result.level).toBe('info')
    })
  })
})
