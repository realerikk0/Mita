import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: vi.fn(),
}))
vi.mock('@tauri-apps/api/app', () => ({
  getVersion: vi.fn().mockResolvedValue('0.6.633'),
}))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue({
    'X-Client-Session': '00000000-0000-4000-8000-000000000000',
    'X-Client-Version': '0.6.633',
    'X-Request-Time': '1700000000',
    'X-Request-Id': 'a'.repeat(64),
    'X-Request-Token': 'b'.repeat(64),
  }),
}))

import { check } from '@tauri-apps/plugin-updater'
import { invoke } from '@tauri-apps/api/core'
import { DefaultUpdaterService } from '../default'
import { TauriUpdaterService } from '../tauri'

describe('TauriUpdaterService', () => {
  let service: TauriUpdaterService

  beforeEach(() => {
    vi.mocked(check).mockReset()
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    service = new TauriUpdaterService()
  })

  it('extends DefaultUpdaterService', () => {
    expect(service).toBeInstanceOf(DefaultUpdaterService)
  })

  it('returns update metadata from the configured Tauri route', async () => {
    vi.mocked(check).mockResolvedValueOnce({
      version: '0.6.635',
      date: '2026-07-14',
      body: 'B bridge',
      rawJson: {
        version: '0.6.635',
        url: 'https://updates.example/Biyan.tar.gz',
        signature: 'signed',
      },
    } as any)

    await expect(service.check()).resolves.toEqual({
      version: '0.6.635',
      date: '2026-07-14',
      body: 'B bridge',
    })
    expect(invoke).toHaveBeenCalledWith('get_app_update_request_headers', {
      currentVersion: '0.6.633',
    })
    expect(check).toHaveBeenCalledWith({ headers: expect.any(Object) })
    expect(invoke).toHaveBeenCalledWith('record_pending_update_manifest', {
      targetVersion: '0.6.635',
      manifestJson:
        '{"signature":"signed","url":"https://updates.example/Biyan.tar.gz","version":"0.6.635"}',
    })
  })

  it('returns null when the route responds without an update', async () => {
    vi.mocked(check).mockResolvedValueOnce(null)
    await expect(service.check()).resolves.toBeNull()
  })

  it('clears the pending object when a check fails', async () => {
    vi.mocked(check)
      .mockResolvedValueOnce({ version: '0.6.635' } as any)
      .mockRejectedValueOnce(new Error('route unavailable'))
    await service.check()
    await expect(service.check()).resolves.toBeNull()
    await expect(service.downloadUpdateWithProgress(vi.fn())).rejects.toThrow(
      'No checked update available'
    )
  })

  it('downloads and installs the exact Update object returned by check', async () => {
    const aDownload = vi.fn().mockResolvedValue(undefined)
    const aInstall = vi.fn().mockResolvedValue(undefined)
    const bDownload = vi.fn().mockResolvedValue(undefined)
    vi.mocked(check)
      .mockResolvedValueOnce({
        version: '0.6.634',
        download: aDownload,
        install: aInstall,
      } as any)
      .mockResolvedValueOnce({
        version: '0.6.635',
        download: bDownload,
      } as any)

    await service.check()
    await service.downloadUpdateWithProgress(vi.fn())
    await service.installDownloadedUpdate()

    expect(check).toHaveBeenCalledTimes(1)
    expect(aDownload).toHaveBeenCalledTimes(1)
    expect(aInstall).toHaveBeenCalledTimes(1)
    expect(bDownload).not.toHaveBeenCalled()
  })

  it('forwards progress events without rechecking latest', async () => {
    const progress = [
      { event: 'Started', data: { contentLength: 1000 } },
      { event: 'Progress', data: { chunkLength: 500 } },
      { event: 'Finished' },
    ]
    const download = vi.fn().mockImplementation(async (callback) => {
      progress.forEach(callback)
    })
    vi.mocked(check).mockResolvedValueOnce({
      version: '0.6.634',
      download,
      install: vi.fn(),
    } as any)
    const onProgress = vi.fn()

    await service.check()
    await service.downloadUpdateWithProgress(onProgress)

    expect(check).toHaveBeenCalledTimes(1)
    expect(onProgress.mock.calls.map(([event]) => event)).toEqual(progress)
  })

  it('isolates progress callback failures from the signed download', async () => {
    const download = vi.fn().mockImplementation(async (callback) => {
      callback({ event: 'Started' })
    })
    vi.mocked(check).mockResolvedValueOnce({
      version: '0.6.634',
      download,
      install: vi.fn(),
    } as any)
    const badCallback = vi.fn(() => {
      throw new Error('callback failed')
    })

    await service.check()
    await expect(
      service.downloadUpdateWithProgress(badCallback)
    ).resolves.toBeUndefined()
    expect(console.warn).toHaveBeenCalled()
  })

  it('requires a successful check before downloading', async () => {
    await expect(service.downloadUpdateWithProgress(vi.fn())).rejects.toThrow(
      'No checked update available'
    )
    expect(check).not.toHaveBeenCalled()
  })

  it('installs directly only from an already checked object', async () => {
    const download = vi.fn().mockResolvedValue(undefined)
    const install = vi.fn().mockResolvedValue(undefined)
    vi.mocked(check).mockResolvedValueOnce({
      version: '0.6.634',
      download,
      install,
    } as any)

    await service.check()
    await service.installAndRestart()

    expect(check).toHaveBeenCalledTimes(1)
    expect(download).toHaveBeenCalledTimes(1)
    expect(install).toHaveBeenCalledTimes(1)
  })

  it('supports the legacy combined download/install caller', async () => {
    const download = vi.fn().mockResolvedValue(undefined)
    const install = vi.fn().mockResolvedValue(undefined)
    vi.mocked(check).mockResolvedValueOnce({
      version: '0.6.634',
      download,
      install,
    } as any)
    await service.check()

    await service.downloadAndInstallWithProgress(vi.fn())

    expect(check).toHaveBeenCalledTimes(1)
    expect(download).toHaveBeenCalledTimes(1)
    expect(install).toHaveBeenCalledTimes(1)
  })
})
