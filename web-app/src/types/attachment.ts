/**
 * Unified attachment type for both images and documents
 */
export type Attachment = {
  name: string
  type: 'image' | 'document'

  // Common fields
  size?: number
  chunkCount?: number
  processing?: boolean
  processed?: boolean
  error?: string

  // For images (before upload)
  base64?: string
  dataUrl?: string
  mimeType?: string
  contentHash?: string // Used for deduplication (different files can have same name)

  // For documents (local files)
  path?: string
  fileType?: string // e.g., 'pdf', 'docx'
  nativeDataUrl?: string
  nativeMediaType?: string

  // After processing. Legacy ids/chunk counts remain readable, but are never
  // produced by the remote-only document path.
  id?: string
  injectionMode?: 'inline' | 'native'
  inlineContent?: string
}

/**
 * Helper to create image attachment
 */
export function createImageAttachment(data: {
  name: string
  base64: string
  dataUrl: string
  mimeType: string
  size: number
}): Attachment {
  return {
    ...data,
    type: 'image',
  }
}

/**
 * Helper to create document attachment
 */
export function createDocumentAttachment(data: {
  name: string
  path?: string
  fileType?: string
  size?: number
  nativeDataUrl?: string
  nativeMediaType?: string
  inlineContent?: string
}): Attachment {
  return {
    ...data,
    type: 'document',
  }
}
