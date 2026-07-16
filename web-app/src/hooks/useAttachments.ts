import { create } from 'zustand'

/**
 * Document attachments are a remote-only feature. Files are either sent through
 * a provider's native file-input support or parsed locally and injected in full.
 * The limit is deliberately fixed so it cannot drift from the parser's hard cap.
 */
export const MAX_DOCUMENT_FILE_SIZE_MB = 20

type AttachmentsStore = {
  enabled: true
  maxFileSizeMB: typeof MAX_DOCUMENT_FILE_SIZE_MB
}

export const useAttachments = create<AttachmentsStore>()(() => ({
  enabled: true,
  maxFileSizeMB: MAX_DOCUMENT_FILE_SIZE_MB,
}))
