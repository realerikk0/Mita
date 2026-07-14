import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TauriHardwareService } from '../tauri'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

describe('TauriHardwareService – coverage', () => {
  let svc: TauriHardwareService

  beforeEach(() => {
    svc = new TauriHardwareService()
    vi.clearAllMocks()
  })

  describe('refreshHardwareInfo', () => {
    it('invokes plugin:hardware|refresh_system_info', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      vi.mocked(invoke).mockResolvedValue(undefined)

      await svc.refreshHardwareInfo()

      expect(invoke).toHaveBeenCalledWith('plugin:hardware|refresh_system_info')
    })
  })
})
