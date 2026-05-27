import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  createCollection: vi.fn(),
  createFile: vi.fn(),
  deleteCollection: vi.fn(),
  insertChunks: vi.fn(),
  listAttachments: vi.fn(),
  chunkText: vi.fn(),
  parseDocument: vi.fn(),
  embed: vi.fn(),
}))

import VectorDBExt from './index'

describe('VectorDBExt.ingestFileForProject', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as any).__VECTOR_DB_EXTENSION_TEST_MOCKS__ = h
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        core: {
          extensionManager: {
            getByName: vi.fn().mockReturnValue({ embed: h.embed }),
          },
        },
      },
    })
  })

  it('checks duplicates before parsing or embedding', async () => {
    h.listAttachments.mockResolvedValueOnce([
      { id: 'existing', name: 'renamed.pdf', path: '/docs/guide.pdf' },
    ])

    const ext = new VectorDBExt()

    await expect(
      ext.ingestFileForProject(
        'project-1',
        { name: 'guide.pdf', path: '/docs/guide.pdf', type: 'pdf', size: 100 },
        { chunkSize: 512, chunkOverlap: 64 }
      )
    ).rejects.toThrow("File 'guide.pdf' has already been attached to this project")

    expect(h.parseDocument).not.toHaveBeenCalled()
    expect(h.chunkText).not.toHaveBeenCalled()
    expect(h.embed).not.toHaveBeenCalled()
  })

  it('embeds chunks once and uses that dimension to create the collection', async () => {
    h.listAttachments
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'file-1', chunk_count: 2 }])
    h.parseDocument.mockResolvedValue('alpha beta gamma')
    h.chunkText.mockResolvedValue(['alpha', 'beta'])
    h.embed.mockResolvedValue({
      data: [
        { index: 0, embedding: [0.1, 0.2, 0.3] },
        { index: 1, embedding: [0.4, 0.5, 0.6] },
      ],
    })
    h.createFile.mockResolvedValue({ id: 'file-1' })

    const ext = new VectorDBExt()

    const result = await ext.ingestFileForProject(
      'project-1',
      { name: 'guide.pdf', path: '/docs/guide.pdf', type: 'pdf', size: 100 },
      { chunkSize: 512, chunkOverlap: 64 }
    )

    expect(result).toEqual({ id: 'file-1', chunk_count: 2 })
    expect(h.embed).toHaveBeenCalledTimes(1)
    expect(h.embed).toHaveBeenCalledWith(['alpha', 'beta'])
    expect(h.createCollection).toHaveBeenCalledWith('project_project-1', 3)
    expect(h.insertChunks).toHaveBeenCalledWith('project_project-1', 'file-1', [
      { text: 'alpha', embedding: [0.1, 0.2, 0.3] },
      { text: 'beta', embedding: [0.4, 0.5, 0.6] },
    ])
    expect(h.deleteCollection).not.toHaveBeenCalled()
  })
})
