import { beforeEach, describe, expect, it } from 'vitest'

import {
  migratePersistedProjectAssistantSelections,
  reconcileProjectAssistantSelections,
} from '../project-assistants'

const project = (assistantId?: string) => ({
  id: 'project-1',
  name: 'Project',
  updated_at: 1,
  assistantId,
})

describe('Project assistant ID migration', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('normalizes a proven stock legacy assistant to biyan', () => {
    const result = reconcileProjectAssistantSelections(
      [project('mita')],
      [{ sourceId: 'mita', targetId: 'biyan' }],
      ['biyan']
    )

    expect(result.changed).toBe(true)
    expect(result.projects[0].assistantId).toBe('biyan')
  })

  it('preserves a custom legacy assistant under the Rust imported ID', () => {
    const result = reconcileProjectAssistantSelections(
      [project('jan')],
      [],
      ['biyan', 'legacy-import-jan-0123456789ab']
    )

    expect(result.projects[0].assistantId).toBe(
      'legacy-import-jan-0123456789ab'
    )
  })

  it('clears an ambiguous legacy selection instead of guessing', () => {
    const result = reconcileProjectAssistantSelections(
      [project('jan')],
      [],
      ['biyan', 'legacy-import-jan', 'legacy-import-jan-0123456789ab']
    )

    expect(result.changed).toBe(true)
    expect(result.projects[0]).not.toHaveProperty('assistantId')
  })

  it('clears a custom import target that collides with an existing assistant', () => {
    const result = reconcileProjectAssistantSelections(
      [project('jan')],
      [
        { sourceId: 'jan', targetId: 'legacy-import-jan' },
        { sourceId: 'legacy-import-jan', targetId: 'legacy-import-jan' },
      ],
      ['biyan', 'legacy-import-jan']
    )

    expect(result.projects[0]).not.toHaveProperty('assistantId')
  })

  it('clears missing custom selections and keeps valid canonical selections', () => {
    const result = reconcileProjectAssistantSelections(
      [project('deleted-assistant'), { ...project('custom'), id: 'project-2' }],
      [],
      ['biyan', 'custom']
    )

    expect(result.projects[0]).not.toHaveProperty('assistantId')
    expect(result.projects[1].assistantId).toBe('custom')
  })

  it('preserves unrelated Project state and the storage version', () => {
    localStorage.setItem(
      'thread-management',
      JSON.stringify({
        state: { folders: [project('mita')], selectedFolder: 'project-1' },
        version: 7,
        checksum: 'keep-me',
      })
    )

    migratePersistedProjectAssistantSelections(
      [{ sourceId: 'mita', targetId: 'biyan' }],
      ['biyan']
    )

    expect(JSON.parse(localStorage.getItem('thread-management')!)).toEqual({
      state: {
        folders: [project('biyan')],
        selectedFolder: 'project-1',
      },
      version: 7,
      checksum: 'keep-me',
    })
  })

  it('leaves damaged storage untouched', () => {
    localStorage.setItem('thread-management', '{broken')

    expect(
      migratePersistedProjectAssistantSelections([], ['biyan'])
    ).toBeUndefined()
    expect(localStorage.getItem('thread-management')).toBe('{broken')
  })
})
