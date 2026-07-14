import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

import {
  processAttachmentsForSend,
  supportsNativeFileInput,
} from '../attachmentProcessing'

describe('remote-only attachment processing', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses native provider file input when declared by the model', async () => {
    const attachment = {
      type: 'document' as const,
      name: 'report.pdf',
      nativeDataUrl: 'data:application/pdf;base64,AAAA',
      nativeMediaType: 'application/pdf',
      size: 4,
    }

    const result = await processAttachmentsForSend({
      attachments: [attachment],
      modelCapabilities: ['file_input'],
    })

    expect(supportsNativeFileInput(['file_input'])).toBe(true)
    expect(result.processedAttachments[0]).toMatchObject({
      injectionMode: 'native',
      processed: true,
    })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('injects the parser complete text without indexing or truncation', async () => {
    invoke.mockResolvedValue('complete parsed document')

    const result = await processAttachmentsForSend({
      attachments: [
        {
          type: 'document',
          name: 'report.pdf',
          path: '/tmp/report.pdf',
          fileType: 'pdf',
          size: 1024,
        },
      ],
      modelCapabilities: ['tools'],
      contextAvailableTokens: 100,
      estimateTokens: () => 10,
    })

    expect(invoke).toHaveBeenCalledWith(
      'plugin:document-parser|parse_document',
      { filePath: '/tmp/report.pdf', fileType: 'pdf' }
    )
    expect(result.processedAttachments[0]).toMatchObject({
      injectionMode: 'inline',
      inlineContent: 'complete parsed document',
    })
  })

  it('blocks when complete text exceeds the remaining context', async () => {
    await expect(
      processAttachmentsForSend({
        attachments: [
          {
            type: 'document',
            name: 'large.txt',
            inlineContent: 'full text',
            size: 9,
          },
        ],
        contextAvailableTokens: 5,
        estimateTokens: () => 10,
      })
    ).rejects.toThrow('will not truncate or summarize')
  })

  it('enforces the fixed 20 MB file cap', async () => {
    await expect(
      processAttachmentsForSend({
        attachments: [
          {
            type: 'document',
            name: 'too-large.pdf',
            path: '/tmp/too-large.pdf',
            size: 20 * 1024 * 1024 + 1,
          },
        ],
      })
    ).rejects.toThrow('20 MB document limit')
  })
})
