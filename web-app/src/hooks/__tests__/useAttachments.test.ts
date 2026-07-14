import { describe, expect, it } from 'vitest'
import {
  MAX_DOCUMENT_FILE_SIZE_MB,
  useAttachments,
} from '../useAttachments'

describe('useAttachments', () => {
  it('keeps remote document handling enabled with a fixed 20 MB cap', () => {
    expect(useAttachments.getState()).toEqual({
      enabled: true,
      maxFileSizeMB: MAX_DOCUMENT_FILE_SIZE_MB,
    })
    expect(MAX_DOCUMENT_FILE_SIZE_MB).toBe(20)
  })
})
