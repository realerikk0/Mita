import { invoke } from '@tauri-apps/api/core'
import { Attachment } from '@/types/attachment'
import { MAX_DOCUMENT_FILE_SIZE_MB } from '@/hooks/useAttachments'

type AttachmentProcessingStatus = 'processing' | 'done' | 'error' | 'clear_all'

export type AttachmentIngestProgress = {
  completed: number
  total: number
}

type AttachmentProcessingOptions = {
  attachments: Attachment[]
  modelCapabilities?: readonly string[]
  contextAvailableTokens?: number
  estimateTokens?: (text: string) => number | Promise<number | undefined> | undefined
  updateAttachmentProcessing?: (
    name: string,
    status: AttachmentProcessingStatus,
    updatedAttachment?: Partial<Attachment>
  ) => void
  onIngestProgress?: (state: AttachmentIngestProgress) => void
}

export type AttachmentProcessingResult = {
  processedAttachments: Attachment[]
}

const NATIVE_FILE_CAPABILITIES = new Set([
  'file_input',
  'file-input',
  'files',
  'documents',
  'native_files',
  'native-files',
])

export const supportsNativeFileInput = (
  capabilities?: readonly string[]
): boolean =>
  capabilities?.some((capability) =>
    NATIVE_FILE_CAPABILITIES.has(capability.trim().toLowerCase())
  ) ?? false

const parseDocument = async (path: string, fileType?: string): Promise<string> => {
  const text = await invoke<string>('plugin:document-parser|parse_document', {
    filePath: path,
    fileType: fileType || 'txt',
  })
  if (!text.trim()) {
    throw new Error('The document parser returned no text')
  }
  return text
}

const assertFileSize = (attachment: Attachment) => {
  const limit = MAX_DOCUMENT_FILE_SIZE_MB * 1024 * 1024
  if (typeof attachment.size === 'number' && attachment.size > limit) {
    throw new Error(
      `${attachment.name} exceeds the ${MAX_DOCUMENT_FILE_SIZE_MB} MB document limit`
    )
  }
}

/**
 * Prepares files without indexing, truncation, or summarization.
 * Native provider input is preferred when both the model and attachment can
 * support it; otherwise the neutral parser's complete output is injected.
 */
export const processAttachmentsForSend = async (
  options: AttachmentProcessingOptions
): Promise<AttachmentProcessingResult> => {
  const {
    attachments,
    modelCapabilities,
    contextAvailableTokens,
    estimateTokens,
    updateAttachmentProcessing,
    onIngestProgress,
  } = options

  const processedAttachments: Attachment[] = []
  const nativeFilesSupported = supportsNativeFileInput(modelCapabilities)
  let completed = 0
  let documentTokens = 0

  if (attachments.length > 0) {
    onIngestProgress?.({ completed: 0, total: attachments.length })
  }

  for (const attachment of attachments) {
    try {
      updateAttachmentProcessing?.(attachment.name, 'processing')

      if (attachment.type === 'image') {
        const processed = {
          ...attachment,
          id: attachment.id ?? attachment.contentHash ?? attachment.name,
          processing: false,
          processed: true,
        }
        processedAttachments.push(processed)
        updateAttachmentProcessing?.(attachment.name, 'done', processed)
      } else {
        assertFileSize(attachment)

        if (
          nativeFilesSupported &&
          attachment.nativeDataUrl &&
          attachment.nativeMediaType
        ) {
          const processed: Attachment = {
            ...attachment,
            processing: false,
            processed: true,
            injectionMode: 'native',
          }
          processedAttachments.push(processed)
          updateAttachmentProcessing?.(attachment.name, 'done', processed)
        } else {
          const completeText = attachment.inlineContent
            ? attachment.inlineContent
            : attachment.path
              ? await parseDocument(attachment.path, attachment.fileType)
              : undefined
          if (!completeText) {
            throw new Error(
              `${attachment.name} cannot be parsed because its local path is unavailable`
            )
          }
          const estimated = estimateTokens
            ? await estimateTokens(completeText)
            : Math.ceil(completeText.length / 3.5)
          if (typeof estimated === 'number' && Number.isFinite(estimated)) {
            documentTokens += Math.max(0, estimated)
          }

          if (
            typeof contextAvailableTokens === 'number' &&
            contextAvailableTokens >= 0 &&
            documentTokens > contextAvailableTokens
          ) {
            throw new Error(
              `The complete document text needs about ${documentTokens.toLocaleString()} tokens, but only ${Math.max(0, Math.floor(contextAvailableTokens)).toLocaleString()} tokens remain. Choose a model with a larger context window or remove files; Biyan will not truncate or summarize them.`
            )
          }

          const processed: Attachment = {
            ...attachment,
            processing: false,
            processed: true,
            inlineContent: completeText,
            injectionMode: 'inline',
          }
          processedAttachments.push(processed)
          updateAttachmentProcessing?.(attachment.name, 'done', processed)
        }
      }

      completed += 1
      onIngestProgress?.({ completed, total: attachments.length })
    } catch (error) {
      updateAttachmentProcessing?.(attachment.name, 'error', {
        processing: false,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  return { processedAttachments }
}
