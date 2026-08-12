import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

import { invoke } from '@tauri-apps/api/core'
import { TauriNovelService } from '../tauri'

describe('TauriNovelService', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset()
  })

  it('uses camelCase Tauri arguments for project and manuscript commands', async () => {
    const service = new TauriNovelService()
    const bundle = { project: { id: 'novel-1' }, units: [] }
    vi.mocked(invoke).mockResolvedValueOnce(bundle)

    expect(
      await service.createProject({ title: '照骨天书', kind: 'web_novel' })
    ).toBe(bundle)
    expect(invoke).toHaveBeenNthCalledWith(1, 'create_novel_project', {
      request: { title: '照骨天书', kind: 'web_novel' },
    })

    vi.mocked(invoke).mockResolvedValueOnce(null)
    await service.loadManuscriptUnit('novel-1', 'chapter-3')
    expect(invoke).toHaveBeenNthCalledWith(2, 'load_manuscript_unit', {
      novelId: 'novel-1',
      unitId: 'chapter-3',
    })
  })

  it('passes collection and restore requests through one request payload', async () => {
    const service = new TauriNovelService()
    vi.mocked(invoke).mockResolvedValue({
      schemaVersion: 1,
      revision: 1,
      items: [],
      updatedAt: '2026-08-12T00:00:00.000Z',
    })

    const collection = {
      novelId: 'novel-1',
      expectedRevision: 0,
      items: [],
    }
    await service.saveCharacters(collection)
    expect(invoke).toHaveBeenCalledWith('save_novel_characters', {
      request: collection,
    })

    await service.restoreRevision('novel-1', 'chapter-3', 'revision-2', 4)
    expect(invoke).toHaveBeenCalledWith('restore_novel_revision', {
      request: {
        novelId: 'novel-1',
        unitId: 'chapter-3',
        revisionId: 'revision-2',
        expectedRevision: 4,
      },
    })
  })

  it('normalizes serializable Rust revision conflicts', async () => {
    vi.mocked(invoke).mockRejectedValue({
      code: 'revision_conflict',
      message: 'The manuscript changed on disk',
      currentRevision: 7,
      outcomeUnknown: false,
    })

    const service = new TauriNovelService()
    await expect(service.openProject('novel-1')).rejects.toMatchObject({
      name: 'NovelServiceError',
      code: 'revision_conflict',
      message: 'The manuscript changed on disk',
      currentRevision: 7,
      outcomeUnknown: false,
    })
  })
})
