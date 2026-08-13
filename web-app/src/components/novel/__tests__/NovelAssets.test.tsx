import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { NovelAssets } from '@/components/novel/NovelAssets'
import type {
  Character,
  Clue,
  ManuscriptUnit,
  OutlineNode,
  Relationship,
} from '@/types/novel'

const character = (id: string, name: string): Character => ({
  id,
  name,
  role: 'protagonist',
  gender: '',
  age: '',
  nationality: '',
  ethnicity: '',
  appearance: '',
  body: '',
  personality: '',
  biography: '',
  customFields: {},
  lockedFields: [],
  createdAt: '2026-08-12T00:00:00.000Z',
  updatedAt: '2026-08-12T00:00:00.000Z',
})

const unit = (id: string, title: string, position: number): ManuscriptUnit => ({
  schemaVersion: 1,
  id,
  novelId: 'novel-1',
  kind: 'chapter',
  title,
  position,
  summary: '',
  goal: '',
  wordCount: 0,
  content: { type: 'doc', content: [{ type: 'paragraph' }] },
  revision: 0,
  createdAt: '2026-08-12T00:00:00.000Z',
  updatedAt: '2026-08-12T00:00:00.000Z',
})

const clue = (id: string, title: string): Clue => ({
  id,
  title,
  description: '',
  plantedUnitId: 'chapter-1',
  plannedResolveUnitId: 'chapter-2',
  status: 'planned',
  relatedCharacterIds: [],
  notes: '',
  createdAt: '2026-08-12T00:00:00.000Z',
  updatedAt: '2026-08-12T00:00:00.000Z',
})

describe('NovelAssets character avatar generation', () => {
  it('merges an async avatar result into the latest character list by id', async () => {
    const original = character('character-1', '沈砚秋')
    const added = character('character-2', '裴照影')
    const onCharactersChange = vi.fn()
    let resolveAvatar: (value: string) => void = () => undefined
    const onGenerateCharacterAvatar = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveAvatar = resolve
        })
    )
    const commonProps = {
      tab: 'characters' as const,
      synopsis: '',
      relationships: [],
      outline: [],
      clues: [],
      units: [],
      onCharactersChange,
      onRelationshipsChange: vi.fn(),
      onOutlineChange: vi.fn(),
      onCluesChange: vi.fn(),
      onSynopsisChange: vi.fn(),
      onGenerateCharacterAvatar,
    }
    const user = userEvent.setup()
    const { rerender } = render(
      <NovelAssets {...commonProps} characters={[original]} />
    )

    await user.click(
      screen.getByRole('button', { name: 'AI 生成人物示意图' })
    )
    rerender(
      <NovelAssets
        {...commonProps}
        characters={[
          { ...original, name: '沈砚秋 · 最新设定' },
          added,
        ]}
      />
    )

    await act(async () => resolveAvatar('/assets/avatar.png'))
    await waitFor(() => expect(onCharactersChange).toHaveBeenCalledTimes(1))

    expect(onCharactersChange).toHaveBeenLastCalledWith([
      expect.objectContaining({
        id: original.id,
        name: '沈砚秋 · 最新设定',
        avatarAsset: '/assets/avatar.png',
      }),
      added,
    ])
  })
})

describe('NovelAssets character custom fields', () => {
  function CustomFieldsHarness({
    initialFields = {},
    onCharactersChange = vi.fn(),
  }: {
    initialFields?: Record<string, string>
    onCharactersChange?: (items: Character[]) => void
  }) {
    const [characters, setCharacters] = useState([
      { ...character('character-1', '沈砚秋'), customFields: initialFields },
    ])
    return (
      <NovelAssets
        tab="characters"
        synopsis=""
        characters={characters}
        relationships={[]}
        outline={[]}
        clues={[]}
        units={[]}
        onCharactersChange={(items) => {
          onCharactersChange(items)
          setCharacters(items)
        }}
        onRelationshipsChange={vi.fn()}
        onOutlineChange={vi.fn()}
        onCluesChange={vi.fn()}
        onSynopsisChange={vi.fn()}
      />
    )
  }

  it('adds unique fields and lets the author edit keys, values, and remove them', async () => {
    const onCharactersChange = vi.fn()
    const user = userEvent.setup()
    render(
      <CustomFieldsHarness
        initialFields={{ 境界: '筑基' }}
        onCharactersChange={onCharactersChange}
      />
    )

    await user.click(screen.getByRole('button', { name: '添加字段' }))
    await user.click(screen.getByRole('button', { name: '添加字段' }))
    expect(screen.getByLabelText('自定义属性名称：新属性')).toBeInTheDocument()
    expect(
      screen.getByLabelText('自定义属性名称：新属性 2')
    ).toBeInTheDocument()

    const keyInput = screen.getByLabelText('自定义属性名称：新属性')
    await user.clear(keyInput)
    await user.type(keyInput, '门派')
    await user.tab()
    await user.type(screen.getByLabelText('自定义属性值：门派'), '天剑宗')

    expect(onCharactersChange).toHaveBeenLastCalledWith([
      expect.objectContaining({
        customFields: {
          境界: '筑基',
          门派: '天剑宗',
          '新属性 2': '',
        },
      }),
    ])

    await user.click(
      screen.getByRole('button', { name: '删除自定义属性：新属性 2' })
    )
    expect(onCharactersChange).toHaveBeenLastCalledWith([
      expect.objectContaining({
        customFields: { 境界: '筑基', 门派: '天剑宗' },
      }),
    ])
  })

  it('keeps the stored key when a renamed field is blank or duplicates another key', async () => {
    const onCharactersChange = vi.fn()
    const user = userEvent.setup()
    render(
      <CustomFieldsHarness
        initialFields={{ 境界: '筑基', 门派: '天剑宗' }}
        onCharactersChange={onCharactersChange}
      />
    )

    const schoolKey = screen.getByLabelText('自定义属性名称：门派')
    await user.clear(schoolKey)
    fireEvent.blur(schoolKey)
    expect(screen.getByRole('alert')).toHaveTextContent('字段名不能为空')
    expect(onCharactersChange).not.toHaveBeenCalled()

    await user.type(schoolKey, '境界')
    fireEvent.blur(schoolKey)
    expect(screen.getByRole('alert')).toHaveTextContent('字段名已存在')
    expect(onCharactersChange).not.toHaveBeenCalled()
    expect(screen.getByLabelText('自定义属性值：门派')).toHaveValue('天剑宗')
  })
})

describe('NovelAssets relationship management', () => {
  it('creates a chosen relationship, edits every structural field, draws direction, and deletes it', async () => {
    const people = [
      character('character-1', '沈砚秋'),
      character('character-2', '裴照影'),
      character('character-3', '洛无咎'),
    ]
    const chapters = [unit('chapter-1', '第三章', 0)]
    const clues = [clue('clue-1', '簪尾缺口')]
    const onRelationshipsChange = vi.fn()

    function Harness() {
      const [relationships, setRelationships] = useState<Relationship[]>([])
      return (
        <NovelAssets
          tab="relations"
          synopsis=""
          characters={people}
          relationships={relationships}
          outline={[]}
          clues={clues}
          units={chapters}
          onCharactersChange={vi.fn()}
          onRelationshipsChange={(items) => {
            onRelationshipsChange(items)
            setRelationships(items)
          }}
          onOutlineChange={vi.fn()}
          onCluesChange={vi.fn()}
          onSynopsisChange={vi.fn()}
        />
      )
    }

    const user = userEvent.setup()
    const { container } = render(<Harness />)

    await user.selectOptions(screen.getByLabelText('新关系起点'), 'character-3')
    await user.selectOptions(screen.getByLabelText('新关系终点'), 'character-1')
    await user.click(screen.getByRole('button', { name: '新增关系' }))

    expect(onRelationshipsChange).toHaveBeenLastCalledWith([
      expect.objectContaining({
        sourceCharacterId: 'character-3',
        targetCharacterId: 'character-1',
        direction: 'bidirectional',
      }),
    ])
    expect(container.querySelector('line[marker-start]')).not.toBeNull()
    expect(container.querySelector('line[marker-end]')).not.toBeNull()

    await user.selectOptions(
      screen.getByLabelText('关系方向'),
      'source_to_target'
    )
    await user.clear(screen.getByLabelText('关系类型'))
    await user.type(screen.getByLabelText('关系类型'), '死敌')
    fireEvent.change(screen.getByLabelText('关系强度'), {
      target: { value: '88' },
    })
    await user.selectOptions(
      screen.getByLabelText('关系生效章节'),
      'chapter-1'
    )
    await user.click(screen.getByRole('button', { name: '簪尾缺口' }))

    const latest = onRelationshipsChange.mock.calls.at(-1)?.[0][0]
    expect(latest).toEqual(
      expect.objectContaining({
        direction: 'source_to_target',
        type: '死敌',
        strength: 88,
        effectiveUnitId: 'chapter-1',
        clueIds: ['clue-1'],
      })
    )
    expect(container.querySelector('line[marker-start]')).toBeNull()
    expect(container.querySelector('line[marker-end]')).not.toBeNull()

    await user.click(screen.getByRole('button', { name: '删除当前关系' }))
    expect(onRelationshipsChange).toHaveBeenLastCalledWith([])
  })
})

describe('NovelAssets outline management', () => {
  it('edits synopsis and hierarchy metadata, reorders nodes, and safely reparents children on delete', async () => {
    const chapters = [unit('chapter-1', '第一章', 0)]
    const initialOutline: OutlineNode[] = [
      {
        id: 'outline-1',
        title: '主线',
        summary: '',
        intent: '',
        position: 0,
        locked: false,
        createdAt: '2026-08-12T00:00:00.000Z',
        updatedAt: '2026-08-12T00:00:00.000Z',
      },
      {
        id: 'outline-2',
        parentId: 'outline-1',
        title: '第二节点',
        summary: '',
        intent: '',
        position: 1,
        locked: false,
        createdAt: '2026-08-12T00:00:00.000Z',
        updatedAt: '2026-08-12T00:00:00.000Z',
      },
    ]
    const onOutlineChange = vi.fn()
    const onSynopsisChange = vi.fn()

    function Harness() {
      const [outline, setOutline] = useState(initialOutline)
      const [synopsis, setSynopsis] = useState('旧小传')
      return (
        <NovelAssets
          tab="outline"
          synopsis={synopsis}
          characters={[]}
          relationships={[]}
          outline={outline}
          clues={[]}
          units={chapters}
          onCharactersChange={vi.fn()}
          onRelationshipsChange={vi.fn()}
          onOutlineChange={(items) => {
            onOutlineChange(items)
            setOutline(items)
          }}
          onCluesChange={vi.fn()}
          onSynopsisChange={(value) => {
            onSynopsisChange(value)
            setSynopsis(value)
          }}
        />
      )
    }

    const user = userEvent.setup()
    render(<Harness />)

    await user.clear(screen.getByLabelText('作品小传'))
    await user.type(screen.getByLabelText('作品小传'), '新的故事核心')
    expect(onSynopsisChange).toHaveBeenLastCalledWith('新的故事核心')

    await user.type(
      screen.getByLabelText('第二节点 创作意图'),
      '必须揭示簪子来源'
    )
    await user.selectOptions(
      screen.getByLabelText('第二节点 关联章节'),
      'chapter-1'
    )
    await user.click(screen.getByRole('button', { name: '上移第二节点' }))
    let latest = onOutlineChange.mock.calls.at(-1)?.[0] as OutlineNode[]
    expect(latest.find((node) => node.id === 'outline-2')).toEqual(
      expect.objectContaining({
        position: 0,
        intent: '必须揭示簪子来源',
        unitId: 'chapter-1',
      })
    )

    await user.click(screen.getByRole('button', { name: '删除主线' }))
    latest = onOutlineChange.mock.calls.at(-1)?.[0] as OutlineNode[]
    expect(latest).toHaveLength(1)
    expect(latest[0]).toEqual(
      expect.objectContaining({ id: 'outline-2', parentId: undefined })
    )
  })
})

describe('NovelAssets clue management', () => {
  it('persists clue detail fields and advances planned to planted to resolved', async () => {
    const people = [character('character-1', '沈砚秋')]
    const chapters = [
      unit('chapter-1', '第三章', 0),
      unit('chapter-2', '第七十章', 1),
    ]
    const onCluesChange = vi.fn()

    function Harness() {
      const [clues, setClues] = useState([clue('clue-1', '簪尾缺口')])
      return (
        <NovelAssets
          tab="clues"
          synopsis=""
          characters={people}
          relationships={[]}
          outline={[]}
          clues={clues}
          units={chapters}
          onCharactersChange={vi.fn()}
          onRelationshipsChange={vi.fn()}
          onOutlineChange={vi.fn()}
          onCluesChange={(items) => {
            onCluesChange(items)
            setClues(items)
          }}
          onSynopsisChange={vi.fn()}
        />
      )
    }

    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: '推进簪尾缺口状态' }))
    expect(screen.getByLabelText('簪尾缺口 状态')).toHaveValue('planted')
    await user.click(screen.getByRole('button', { name: '推进簪尾缺口状态' }))
    expect(screen.getByLabelText('簪尾缺口 状态')).toHaveValue('resolved')

    await user.click(screen.getByRole('button', { name: '详情' }))
    await user.type(
      screen.getByLabelText('簪尾缺口 作者备注'),
      '旧案铸模是最终证据'
    )
    await user.click(screen.getByRole('button', { name: '沈砚秋' }))

    const latest = onCluesChange.mock.calls.at(-1)?.[0][0]
    expect(latest).toEqual(
      expect.objectContaining({
        status: 'resolved',
        resolvedUnitId: 'chapter-2',
        notes: '旧案铸模是最终证据',
        relatedCharacterIds: ['character-1'],
      })
    )

    await user.click(screen.getByRole('button', { name: '删除簪尾缺口' }))
    expect(onCluesChange).toHaveBeenLastCalledWith([])
  })
})
