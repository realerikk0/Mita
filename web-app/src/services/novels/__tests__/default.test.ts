import { beforeEach, describe, expect, it } from 'vitest'

import { NovelServiceError, type ManuscriptUnit } from '@/types/novel'
import { DefaultNovelService } from '../default'

function document(text: string) {
  return {
    type: 'doc' as const,
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text }],
      },
    ],
  }
}

function editedUnit(unit: ManuscriptUnit, text: string): ManuscriptUnit {
  return { ...unit, content: document(text) }
}

describe('DefaultNovelService', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('creates, persists and lists a project with its initial unit', async () => {
    const first = new DefaultNovelService()
    const created = await first.createProject({
      title: '照骨天书',
      kind: 'web_novel',
      genre: '东方玄幻',
      initialContent: document('发簪落在雨里。'),
    })

    const second = new DefaultNovelService()
    const projects = await second.listProjects()
    const opened = await second.openProject(created.project.id)

    expect(projects).toEqual([
      expect.objectContaining({
        id: created.project.id,
        title: '照骨天书',
        unitCount: 1,
        wordCount: 6,
      }),
    ])
    expect(opened.units[0]).toEqual(
      expect.objectContaining({ title: '第一章', revision: 0 })
    )
  })

  it('enforces expectedRevision and records restorable unit snapshots', async () => {
    const service = new DefaultNovelService()
    const bundle = await service.createProject({
      title: '照骨天书',
      kind: 'web_novel',
    })
    const unit = bundle.units[0]
    const first = await service.saveManuscriptUnit({
      novelId: bundle.project.id,
      unit: editedUnit(unit, '第一版'),
      expectedRevision: 0,
    })
    const second = await service.saveManuscriptUnit({
      novelId: bundle.project.id,
      unit: editedUnit(first, '第二版'),
      expectedRevision: 1,
    })

    await expect(
      service.saveManuscriptUnit({
        novelId: bundle.project.id,
        unit: editedUnit(first, '过期写入'),
        expectedRevision: 1,
      })
    ).rejects.toMatchObject({
      code: 'revision_conflict',
      currentRevision: 2,
      outcomeUnknown: false,
    } satisfies Partial<NovelServiceError>)

    const revisions = await service.listRevisions(bundle.project.id, unit.id)
    expect(revisions.map((revision) => revision.revision)).toEqual([2, 1])

    const restored = await service.restoreRevision(
      bundle.project.id,
      unit.id,
      revisions[1].id,
      second.revision
    )
    expect(restored.revision).toBe(3)
    expect(restored.content).toEqual(document('第一版'))
  })

  it('keeps manuscript-owned structure when saving stale project metadata', async () => {
    const service = new DefaultNovelService()
    const bundle = await service.createProject({
      title: '照骨天书',
      kind: 'web_novel',
    })
    const added = await service.saveManuscriptUnit({
      novelId: bundle.project.id,
      expectedRevision: 0,
      unit: {
        ...bundle.units[0],
        id: 'chapter-new',
        title: '第二章',
        position: 1,
        revision: 0,
      },
    })

    const saved = await service.saveProject(
      { ...bundle.project, title: '照骨天书·修订' },
      bundle.project.revision
    )

    expect(saved.unitOrder).toContain(added.id)
    expect(saved.activeUnitId).toBe(added.id)
  })

  it('versions collections and scopes suggestion replacement to one unit', async () => {
    const service = new DefaultNovelService()
    const bundle = await service.createProject({
      title: '照骨天书',
      kind: 'web_novel',
    })
    const unitId = bundle.units[0].id
    const savedOutline = await service.saveOutline({
      novelId: bundle.project.id,
      expectedRevision: 0,
      items: [
        {
          id: 'outline-1',
          unitId,
          title: '雨夜入局',
          summary: '沈砚秋发现发簪。',
          intent: '埋设第七十章伏笔',
          position: 0,
          locked: true,
          createdAt: '2026-08-12T00:00:00.000Z',
          updatedAt: '2026-08-12T00:00:00.000Z',
        },
      ],
    })
    expect(savedOutline.revision).toBe(1)

    const suggestionBase = {
      mode: 'rewrite' as const,
      candidateIndex: 0,
      instruction: '更克制',
      content: '雨水压低了檐角。',
      status: 'ready' as const,
      favorite: false,
      stale: false,
      context: [],
      createdAt: '2026-08-12T00:00:00.000Z',
    }
    const first = await service.saveSuggestions({
      novelId: bundle.project.id,
      unitId,
      expectedRevision: 0,
      items: [{ ...suggestionBase, id: 'candidate-a', unitId }],
    })
    const second = await service.saveSuggestions({
      novelId: bundle.project.id,
      unitId,
      expectedRevision: first.revision,
      items: [{ ...suggestionBase, id: 'candidate-b', unitId }],
    })

    expect(second.revision).toBe(2)
    expect(second.items.map((item) => item.id)).toEqual(['candidate-b'])
  })

  it('imports plain text and exports markdown or a native archive', async () => {
    const service = new DefaultNovelService()
    const imported = await service.importProject({
      kind: 'novel',
      format: 'txt',
      fileName: '雨夜.txt',
      content: '雨落药铺。\n\n沈砚秋攥紧发簪。',
    })

    const markdown = await service.exportProject({
      novelId: imported.project.id,
      format: 'markdown',
    })
    const archive = await service.exportProject({
      novelId: imported.project.id,
      format: 'biyan-novel',
    })

    expect(markdown.fileName).toBe('雨夜.md')
    expect(markdown.content).toContain('# 第一章')
    expect(markdown.content).toContain('沈砚秋攥紧发簪。')
    expect(JSON.parse(archive.content)).toMatchObject({
      project: { id: imported.project.id, title: '雨夜' },
    })
  })

  it('counts Latin words across adjacent marked text and imports scene breaks', async () => {
    const service = new DefaultNovelService()
    const created = await service.createProject({
      title: 'Marked chapter',
      kind: 'novel',
      initialContent: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Chap', marks: [{ type: 'bold' }] },
              { type: 'text', text: 'ter' },
            ],
          },
        ],
      },
    })
    expect(created.units[0].wordCount).toBe(1)

    const imported = await service.importProject({
      kind: 'novel',
      format: 'markdown',
      fileName: '转场.md',
      content: '第一场\n\n---\n\n第二场',
    })
    expect(imported.units[0].content.content?.map((node) => node.type)).toEqual(
      ['paragraph', 'sceneBreak', 'paragraph']
    )
  })
})
