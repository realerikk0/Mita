import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  isVideoGenerationDebugEnabled,
  videoDebugLog,
} from '../video-generation-debug'

const DEBUG_STORAGE_KEY = 'biyan.videoGeneration.debug'

describe('video generation debug logging', () => {
  beforeEach(() => {
    localStorage.removeItem(DEBUG_STORAGE_KEY)
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
  })

  afterEach(() => {
    localStorage.removeItem(DEBUG_STORAGE_KEY)
    vi.restoreAllMocks()
  })

  it('stays disabled unless explicitly enabled', () => {
    expect(isVideoGenerationDebugEnabled()).toBe(false)

    videoDebugLog('save:start', {
      videoUrl:
        'https://ark-acg-cn-beijing.tos-cn-beijing.volces.com/video.mp4?X-Tos-Signature=secret',
    })

    expect(console.info).not.toHaveBeenCalled()
  })

  it('redacts signed URL query data when debug logging is enabled', () => {
    localStorage.setItem(DEBUG_STORAGE_KEY, '1')

    videoDebugLog('save:start', {
      videoUrl:
        'https://ark-acg-cn-beijing.tos-cn-beijing.volces.com/video.mp4?X-Tos-Signature=secret#token',
    })

    expect(console.info).toHaveBeenCalledTimes(1)
    const payload = vi.mocked(console.info).mock.calls[0]?.[2]
    expect(payload).toMatchObject({
      videoUrl:
        'https://ark-acg-cn-beijing.tos-cn-beijing.volces.com/video.mp4?[redacted]#[redacted]',
    })
  })
})
