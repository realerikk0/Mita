import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TauriAppService } from '../app/tauri'

// Mock dependencies
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

// Mock EngineManager
vi.mock('@janhq/core', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    EngineManager: {
      instance: () => ({
        engines: new Map([
          ['engine1', {
            getLoadedModels: vi.fn().mockResolvedValue(['model1', 'model2']),
            unload: vi.fn().mockResolvedValue(undefined),
          }],
        ]),
      }),
    },
  }
})

vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn(),
}))

vi.mock('../models', () => ({
  stopAllModels: vi.fn(),
}))

// Mock the global window object
const mockWindow = {
  core: {
    api: {
      installExtensions: vi.fn(),
      relaunch: vi.fn(),
      getAppConfigurations: vi.fn(),
      changeAppDataFolder: vi.fn(),
    },
  },
  localStorage: {
    clear: vi.fn(),
  },
}

Object.defineProperty(window, 'core', {
  value: mockWindow.core,
  writable: true,
})

Object.defineProperty(window, 'localStorage', {
  value: mockWindow.localStorage,
  writable: true,
})

describe('TauriAppService', () => {
  let appService: TauriAppService

  beforeEach(() => {
    appService = new TauriAppService()
    vi.clearAllMocks()
  })

  describe('parseLogLine', () => {
    it('should parse JSONL user log line', () => {
      const logLine = JSON.stringify({
        ts: '2026-06-30T12:00:00Z',
        level: 'warning',
        target: 'settings',
        event: 'app_update.available',
        message: 'Update available',
        context: { version: '1.2.3' },
        appVersion: '1.0.0',
        platform: 'macos',
      })

      const result = appService.parseLogLine(logLine)

      expect(result).toEqual({
        timestamp: '2026-06-30T12:00:00Z',
        level: 'warn',
        target: 'settings',
        event: 'app_update.available',
        message: 'Update available',
        context: { version: '1.2.3' },
        error: undefined,
        appVersion: '1.0.0',
        platform: 'macos',
      })
    })

    it('should parse valid log line', () => {
      const logLine = '[2024-01-01][10:00:00Z][target][INFO] Test message'
      const result = appService.parseLogLine(logLine)

      expect(result).toEqual({
        timestamp: '2024-01-01 10:00:00Z',
        level: 'info',
        target: 'target',
        message: 'Test message',
      })
    })

    it('should handle invalid log line format', () => {
      const logLine = 'Invalid log line'
      const result = appService.parseLogLine(logLine)

      expect(result.message).toBe('Invalid log line')
      expect(result.level).toBe('info')
      expect(result.target).toBe('info')
      expect(typeof result.timestamp).toBe('number')
    })
  })

  describe('readLogs', () => {
    it('should read and parse logs', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      const mockLogs =
        '[2024-01-01][10:00:00Z][target][INFO] Test message\n[2024-01-01][10:01:00Z][target][ERROR] Error message'
      vi.mocked(invoke).mockResolvedValue(mockLogs)

      const result = await appService.readLogs()

      expect(invoke).toHaveBeenCalledWith('read_user_logs', {
        options: undefined,
      })
      expect(result).toHaveLength(2)
      expect(result[0].message).toBe('Test message')
      expect(result[1].message).toBe('Error message')
    })

    it('should handle empty logs', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      vi.mocked(invoke).mockResolvedValue('')

      const result = await appService.readLogs()

      expect(result).toEqual([])
    })

    it('should pass read options to read_user_logs', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      vi.mocked(invoke).mockResolvedValue('')

      await appService.readLogs({ limit: 5 })

      expect(invoke).toHaveBeenCalledWith('read_user_logs', {
        options: { limit: 5 },
      })
    })

    it('should fall back to legacy read_logs command', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      vi.mocked(invoke)
        .mockRejectedValueOnce(new Error('missing command'))
        .mockResolvedValueOnce('[2024-01-01][10:00:00Z][target][INFO] Legacy')

      const result = await appService.readLogs()

      expect(invoke).toHaveBeenNthCalledWith(1, 'read_user_logs', {
        options: undefined,
      })
      expect(invoke).toHaveBeenNthCalledWith(2, 'read_logs')
      expect(result).toHaveLength(1)
      expect(result[0].message).toBe('Legacy')
    })
  })

  describe('user logs commands', () => {
    it('should write user logs', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      const payload = {
        level: 'error' as const,
        target: 'settings',
        event: 'test.event',
        message: 'boom',
      }

      await appService.writeLog(payload)

      expect(invoke).toHaveBeenCalledWith('write_user_log', {
        entry: payload,
      })
    })

    it('should clear user logs', async () => {
      const { invoke } = await import('@tauri-apps/api/core')

      await appService.clearLogs()

      expect(invoke).toHaveBeenCalledWith('clear_user_logs')
    })

    it('should get user logs directory', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      vi.mocked(invoke).mockResolvedValue('/Users/test/Library/Logs/biyan')

      const result = await appService.getLogsDirectory()

      expect(invoke).toHaveBeenCalledWith('get_user_logs_directory')
      expect(result).toBe('/Users/test/Library/Logs/biyan')
    })
  })

  describe('getMitaDataFolder', () => {
    it('should get mita data folder path', async () => {
      const mockConfig = { data_folder: '/path/to/mita/data' }
      mockWindow.core.api.getAppConfigurations.mockResolvedValue(mockConfig)

      const result = await appService.getMitaDataFolder()

      expect(mockWindow.core.api.getAppConfigurations).toHaveBeenCalled()
      expect(result).toBe('/path/to/mita/data')
    })
  })

  describe('relocateMitaDataFolder', () => {
    it('should relocate mita data folder', async () => {
      const newPath = '/new/path/to/mita/data'
      mockWindow.core.api.changeAppDataFolder.mockResolvedValue(undefined)

      await appService.relocateMitaDataFolder(newPath)

      expect(mockWindow.core.api.changeAppDataFolder).toHaveBeenCalledWith({
        newDataFolder: newPath,
      })
    })
  })

  describe('factoryReset', () => {
    it('should perform factory reset', async () => {
      const { invoke } = await import('@tauri-apps/api/core')

      await appService.factoryReset()

      expect(invoke).toHaveBeenCalledWith('factory_reset')
    })
  })
})
