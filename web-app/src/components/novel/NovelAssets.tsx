import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowDownRight,
  ArrowLeftRight,
  ArrowUp,
  CheckCircle2,
  CircleDot,
  LockKeyhole,
  Network,
  Plus,
  Search,
  Trash2,
  UserRound,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import type {
  Character,
  Clue,
  ManuscriptUnit,
  OutlineNode,
  Relationship,
} from '@/types/novel'

type AssetTab = 'characters' | 'relations' | 'outline' | 'clues'

type Props = {
  tab: AssetTab
  characters: Character[]
  relationships: Relationship[]
  outline: OutlineNode[]
  clues: Clue[]
  units: ManuscriptUnit[]
  synopsis: string
  onCharactersChange: (items: Character[]) => void
  onRelationshipsChange: (items: Relationship[]) => void
  onOutlineChange: (items: OutlineNode[]) => void
  onCluesChange: (items: Clue[]) => void
  onSynopsisChange: (value: string) => void
  onGenerateCharacterAvatar?: (character: Character) => Promise<string>
  resolveAssetSrc?: (source: string) => string
}

const selectClassName =
  'h-8 w-full rounded-md border border-input bg-background px-2 text-xs shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50'

export function NovelAssets(props: Props) {
  if (props.tab === 'characters') return <CharactersPanel {...props} />
  if (props.tab === 'relations') return <RelationsPanel {...props} />
  if (props.tab === 'outline') return <OutlinePanel {...props} />
  return <CluesPanel {...props} />
}

function CharactersPanel({
  characters,
  onCharactersChange,
  onGenerateCharacterAvatar,
  resolveAssetSrc = (source) => source,
}: Props) {
  const [selectedId, setSelectedId] = useState(characters[0]?.id)
  const [generatingAvatar, setGeneratingAvatar] = useState(false)
  const selected = characters.find((item) => item.id === selectedId)
  const charactersRef = useRef(characters)
  useEffect(() => {
    charactersRef.current = characters
  }, [characters])

  const updateCharacter = (
    characterId: string,
    patch: Partial<Character>
  ) => {
    onCharactersChange(
      charactersRef.current.map((item) =>
        item.id === characterId
          ? { ...item, ...patch, updatedAt: new Date().toISOString() }
          : item
      )
    )
  }

  const update = (patch: Partial<Character>) => {
    if (!selected) return
    updateCharacter(selected.id, patch)
  }

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] min-[1100px]:grid-cols-[230px_minmax(0,1fr)] min-[1100px]:grid-rows-1">
      <div className="border-b bg-muted/10 p-3 min-[1100px]:border-b-0 min-[1100px]:border-r">
        <div className="flex items-center justify-between">
          <strong className="text-sm">人物</strong>
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={() => {
              const now = new Date().toISOString()
              const next: Character = {
                id: crypto.randomUUID(),
                name: '新人物',
                role: 'supporting',
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
                createdAt: now,
                updatedAt: now,
              }
              onCharactersChange([...characters, next])
              setSelectedId(next.id)
            }}
          >
            <Plus />
          </Button>
        </div>
        <div className="relative mt-2">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-8 pl-8 text-xs" placeholder="搜索人物" />
        </div>
        <div className="mt-3 flex gap-1 overflow-x-auto min-[1100px]:block min-[1100px]:space-y-1">
          {characters.map((character, index) => (
            <button
              type="button"
              key={character.id}
              onClick={() => setSelectedId(character.id)}
              className={cn(
                'flex min-w-40 items-center gap-2 rounded-lg p-2 text-left min-[1100px]:w-full min-[1100px]:min-w-0',
                selectedId === character.id
                  ? 'bg-primary/10'
                  : 'hover:bg-accent'
              )}
            >
              <span
                className={cn(
                  'flex size-9 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
                  index % 3 === 0 &&
                    'bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-100',
                  index % 3 === 1 &&
                    'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-100',
                  index % 3 === 2 &&
                    'bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-100'
                )}
              >
                {character.name.slice(0, 1)}
              </span>
              <span className="min-w-0">
                <strong className="block truncate text-xs">
                  {character.name}
                </strong>
                <span className="block truncate text-[10px] text-muted-foreground">
                  {character.role === 'protagonist'
                    ? '主角'
                    : character.role === 'supporting'
                      ? '配角'
                      : '重要路人'}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {selected ? (
        <div className="h-full overflow-y-auto p-5 min-[1100px]:p-6 min-[1350px]:p-8">
          <div className="mx-auto max-w-3xl">
            <div className="flex items-start gap-5 border-b pb-6">
              <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl border bg-gradient-to-br from-orange-100 to-stone-200 text-3xl font-semibold text-stone-700 dark:from-orange-950 dark:to-stone-800 dark:text-stone-100">
                {selected.avatarAsset ? (
                  <img
                    src={resolveAssetSrc(selected.avatarAsset)}
                    alt={`${selected.name}的人物示意图`}
                    className="size-full object-cover"
                  />
                ) : (
                  selected.name.slice(0, 1)
                )}
              </div>
              <div className="min-w-0 flex-1">
                <Input
                  className="h-auto border-0 bg-transparent px-0 font-studio text-2xl font-semibold shadow-none focus-visible:ring-0"
                  value={selected.name}
                  onChange={(event) => update({ name: event.target.value })}
                />
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span className="rounded-full bg-primary/10 px-2 py-1 text-primary">
                    主线人物
                  </span>
                  {selected.customFields['境界'] && (
                    <span className="rounded-full bg-muted px-2 py-1">
                      {selected.customFields['境界']}
                    </span>
                  )}
                  <button
                    className="rounded-full border px-2 py-1 hover:bg-accent disabled:cursor-wait disabled:opacity-60"
                    type="button"
                    disabled={generatingAvatar || !onGenerateCharacterAvatar}
                    onClick={() => {
                      if (!onGenerateCharacterAvatar) return
                      const characterId = selected.id
                      setGeneratingAvatar(true)
                      void onGenerateCharacterAvatar(selected)
                        .then((avatarAsset) =>
                          updateCharacter(characterId, { avatarAsset })
                        )
                        .catch(() => undefined)
                        .finally(() => setGeneratingAvatar(false))
                    }}
                  >
                    {generatingAvatar
                      ? '正在生成示意图…'
                      : selected.avatarAsset
                        ? '重新生成示意图'
                        : 'AI 生成人物示意图'}
                  </button>
                </div>
              </div>
            </div>

            <div className="grid gap-4 py-6 sm:grid-cols-2 min-[1350px]:grid-cols-3">
              {(
                [
                  ['gender', '性别'],
                  ['age', '年龄'],
                  ['nationality', '国籍'],
                  ['ethnicity', '族裔 / 肤色'],
                  ['body', '身材'],
                  ['appearance', '外貌'],
                ] as Array<[keyof Character, string]>
              ).map(([key, label]) => (
                <label key={key} className="space-y-1 text-xs font-medium">
                  {label}
                  <Input
                    className="h-8"
                    value={String(selected[key] ?? '')}
                    onChange={(event) => update({ [key]: event.target.value })}
                  />
                </label>
              ))}
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <label className="space-y-1 text-xs font-medium">
                性格
                <Textarea
                  value={selected.personality}
                  onChange={(event) =>
                    update({ personality: event.target.value })
                  }
                />
              </label>
              <label className="space-y-1 text-xs font-medium">
                人物小传
                <Textarea
                  value={selected.biography}
                  onChange={(event) =>
                    update({ biography: event.target.value })
                  }
                />
              </label>
            </div>

            <div className="mt-6 rounded-xl border p-4">
              <div className="flex items-center justify-between">
                <strong className="text-sm">自定义属性</strong>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() =>
                    update({
                      customFields: { ...selected.customFields, 新属性: '' },
                    })
                  }
                >
                  <Plus /> 添加字段
                </Button>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {Object.entries(selected.customFields).map(([key, value]) => (
                  <div
                    key={key}
                    className="grid grid-cols-[7rem_1fr] items-center gap-2"
                  >
                    <span className="truncate text-xs text-muted-foreground">
                      {key}
                    </span>
                    <Input
                      className="h-8"
                      value={value}
                      onChange={(event) =>
                        update({
                          customFields: {
                            ...selected.customFields,
                            [key]: event.target.value,
                          },
                        })
                      }
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <EmptyAsset icon={UserRound} title="还没有人物" action="新建人物" />
      )}
    </div>
  )
}

function RelationsPanel({
  characters,
  relationships,
  clues,
  units,
  onRelationshipsChange,
}: Props) {
  const [selectedRelationshipId, setSelectedRelationshipId] = useState(
    relationships[0]?.id
  )
  const [newSourceId, setNewSourceId] = useState(characters[0]?.id ?? '')
  const [newTargetId, setNewTargetId] = useState(
    characters.find((character) => character.id !== characters[0]?.id)?.id ?? ''
  )
  const markerPrefix = useId().replace(/:/g, '')
  const selectedRelationship = relationships.find(
    (relationship) => relationship.id === selectedRelationshipId
  )

  useEffect(() => {
    if (
      selectedRelationshipId &&
      relationships.some((relationship) => relationship.id === selectedRelationshipId)
    ) {
      return
    }
    setSelectedRelationshipId(relationships[0]?.id)
  }, [relationships, selectedRelationshipId])

  useEffect(() => {
    setNewSourceId((current) =>
      characters.some((character) => character.id === current)
        ? current
        : (characters[0]?.id ?? '')
    )
  }, [characters])

  useEffect(() => {
    setNewTargetId((current) =>
      current !== newSourceId &&
      characters.some((character) => character.id === current)
        ? current
        : (characters.find((character) => character.id !== newSourceId)?.id ?? '')
    )
  }, [characters, newSourceId])

  const positions = useMemo(() => {
    const centerX = 50
    const centerY = 50
    return characters.map((character, index, array) => {
      const angle = (Math.PI * 2 * index) / Math.max(array.length, 1) - Math.PI / 2
      const radius = array.length === 1 ? 0 : 36
      return {
        character,
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius,
      }
    })
  }, [characters])

  const updateRelationship = (
    relationshipId: string,
    patch: Partial<Relationship>
  ) => {
    onRelationshipsChange(
      relationships.map((relationship) =>
        relationship.id === relationshipId
          ? {
              ...relationship,
              ...patch,
              updatedAt: new Date().toISOString(),
            }
          : relationship
      )
    )
  }

  const addRelationship = () => {
    if (!newSourceId || !newTargetId || newSourceId === newTargetId) return
    const now = new Date().toISOString()
    const next: Relationship = {
      id: crypto.randomUUID(),
      sourceCharacterId: newSourceId,
      targetCharacterId: newTargetId,
      direction: 'bidirectional',
      type: '同盟',
      description: '',
      strength: 50,
      clueIds: [],
      createdAt: now,
      updatedAt: now,
    }
    onRelationshipsChange([...relationships, next])
    setSelectedRelationshipId(next.id)
  }

  const removeRelationship = (relationshipId: string) => {
    onRelationshipsChange(
      relationships.filter((relationship) => relationship.id !== relationshipId)
    )
  }

  return (
    <div className="grid h-full min-h-0 overflow-auto min-[1350px]:grid-cols-[minmax(680px,1fr)_340px]">
      <section className="relative min-h-[520px] min-w-[680px] overflow-hidden bg-[radial-gradient(circle_at_center,color-mix(in_oklab,var(--primary)_5%,transparent),transparent_55%)]">
        <div className="absolute left-5 top-5 z-10">
          <h2 className="font-studio text-lg font-semibold">人物关系图</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            箭头表示关系方向，线宽表示关系强度。
          </p>
        </div>

        <svg
          className="absolute inset-0 size-full overflow-visible"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-label="人物关系连线"
        >
          <defs>
            <marker
              id={`${markerPrefix}-arrow`}
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
            </marker>
          </defs>
          {relationships.map((relationship) => {
            const source = positions.find(
              (item) => item.character.id === relationship.sourceCharacterId
            )
            const target = positions.find(
              (item) => item.character.id === relationship.targetCharacterId
            )
            if (!source || !target) return null
            const dx = target.x - source.x
            const dy = target.y - source.y
            const distance = Math.hypot(dx, dy) || 1
            const inset = Math.min(8, distance / 3)
            const unitX = dx / distance
            const unitY = dy / distance
            const x1 = source.x + unitX * inset
            const y1 = source.y + unitY * inset
            const x2 = target.x - unitX * inset
            const y2 = target.y - unitY * inset
            const active = relationship.id === selectedRelationshipId
            return (
              <g
                key={relationship.id}
                className={cn(
                  'cursor-pointer text-muted-foreground transition-colors',
                  active && 'text-primary'
                )}
                onClick={() => setSelectedRelationshipId(relationship.id)}
              >
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="currentColor"
                  strokeOpacity={active ? 0.9 : 0.45}
                  strokeWidth={0.35 + relationship.strength / 150}
                  strokeDasharray={
                    relationship.type.includes('敌') ? '2 1.5' : undefined
                  }
                  markerStart={
                    relationship.direction === 'bidirectional'
                      ? `url(#${markerPrefix}-arrow)`
                      : undefined
                  }
                  markerEnd={`url(#${markerPrefix}-arrow)`}
                  vectorEffect="non-scaling-stroke"
                />
                <text
                  x={(x1 + x2) / 2}
                  y={(y1 + y2) / 2 - 1.5}
                  textAnchor="middle"
                  className="fill-current text-[2.1px] font-semibold"
                >
                  {relationship.type}
                </text>
              </g>
            )
          })}
        </svg>

        {positions.map(({ character, x, y }, index) => (
          <button
            key={character.id}
            type="button"
            style={{ left: `${x}%`, top: `${y}%` }}
            onClick={() => {
              if (newSourceId === character.id) return
              setNewTargetId(character.id)
            }}
            className="absolute z-10 flex w-28 -translate-x-1/2 -translate-y-1/2 flex-col items-center rounded-xl border bg-background p-3 shadow-sm transition hover:-translate-y-[55%] hover:border-primary/40 hover:shadow-md"
            title="设为新关系终点"
          >
            <span
              className={cn(
                'flex size-10 items-center justify-center rounded-full text-sm font-semibold',
                index === 0 ? 'bg-primary text-primary-foreground' : 'bg-muted'
              )}
            >
              {character.name.slice(0, 1)}
            </span>
            <strong className="mt-2 max-w-full truncate text-xs">
              {character.name}
            </strong>
            <span className="mt-0.5 text-[10px] text-muted-foreground">
              {character.customFields['境界'] || '关系节点'}
            </span>
          </button>
        ))}

        <div className="absolute bottom-5 left-5 flex gap-2 rounded-full border bg-background/85 px-3 py-2 text-[11px] text-muted-foreground backdrop-blur">
          <span className="inline-flex items-center gap-1">
            <ArrowDownRight className="size-3" /> 单向
          </span>
          <span className="inline-flex items-center gap-1">
            <ArrowLeftRight className="size-3" /> 双向
          </span>
          <span>{relationships.length} 条关系</span>
        </div>
      </section>

      <aside className="border-t bg-background p-4 min-[1350px]:max-h-full min-[1350px]:overflow-y-auto min-[1350px]:border-l min-[1350px]:border-t-0">
        <div>
          <strong className="text-sm">新增关系</strong>
          <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <select
              aria-label="新关系起点"
              className={selectClassName}
              value={newSourceId}
              onChange={(event) => setNewSourceId(event.target.value)}
            >
              {characters.map((character) => (
                <option key={character.id} value={character.id}>
                  {character.name}
                </option>
              ))}
            </select>
            <ArrowDownRight className="size-4 text-muted-foreground" />
            <select
              aria-label="新关系终点"
              className={selectClassName}
              value={newTargetId}
              onChange={(event) => setNewTargetId(event.target.value)}
            >
              {characters
                .filter((character) => character.id !== newSourceId)
                .map((character) => (
                  <option key={character.id} value={character.id}>
                    {character.name}
                  </option>
                ))}
            </select>
          </div>
          <Button
            className="mt-2 w-full"
            size="sm"
            disabled={
              characters.length < 2 ||
              !newSourceId ||
              !newTargetId ||
              newSourceId === newTargetId
            }
            onClick={addRelationship}
          >
            <Plus /> 新增关系
          </Button>
        </div>

        {relationships.length > 0 && (
          <div className="mt-5">
            <span className="text-[11px] font-semibold text-muted-foreground">
              已有关系
            </span>
            <div className="mt-2 flex gap-1 overflow-x-auto min-[1350px]:block min-[1350px]:space-y-1">
              {relationships.map((relationship) => {
                const source = characters.find(
                  (character) => character.id === relationship.sourceCharacterId
                )
                const target = characters.find(
                  (character) => character.id === relationship.targetCharacterId
                )
                return (
                  <button
                    key={relationship.id}
                    type="button"
                    onClick={() => setSelectedRelationshipId(relationship.id)}
                    className={cn(
                      'min-w-52 rounded-lg border px-3 py-2 text-left text-xs min-[1350px]:w-full',
                      relationship.id === selectedRelationshipId
                        ? 'border-primary/40 bg-primary/5'
                        : 'hover:bg-accent'
                    )}
                  >
                    <strong className="block truncate">
                      {source?.name ?? '未知人物'}{' '}
                      {relationship.direction === 'bidirectional' ? '↔' : '→'}{' '}
                      {target?.name ?? '未知人物'}
                    </strong>
                    <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                      {relationship.type} · 强度 {relationship.strength}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {selectedRelationship && (
          <div className="mt-5 space-y-3 border-t pt-4">
            <div className="flex items-center justify-between">
              <strong className="text-sm">编辑关系</strong>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="删除当前关系"
                onClick={() => removeRelationship(selectedRelationship.id)}
              >
                <Trash2 />
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1 text-[11px] font-medium">
                起点人物
                <select
                  aria-label="关系起点人物"
                  className={selectClassName}
                  value={selectedRelationship.sourceCharacterId}
                  onChange={(event) =>
                    updateRelationship(selectedRelationship.id, {
                      sourceCharacterId: event.target.value,
                    })
                  }
                >
                  {characters.map((character) => (
                    <option
                      key={character.id}
                      value={character.id}
                      disabled={
                        character.id === selectedRelationship.targetCharacterId
                      }
                    >
                      {character.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-[11px] font-medium">
                终点人物
                <select
                  aria-label="关系终点人物"
                  className={selectClassName}
                  value={selectedRelationship.targetCharacterId}
                  onChange={(event) =>
                    updateRelationship(selectedRelationship.id, {
                      targetCharacterId: event.target.value,
                    })
                  }
                >
                  {characters.map((character) => (
                    <option
                      key={character.id}
                      value={character.id}
                      disabled={
                        character.id === selectedRelationship.sourceCharacterId
                      }
                    >
                      {character.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1 text-[11px] font-medium">
                方向
                <select
                  aria-label="关系方向"
                  className={selectClassName}
                  value={selectedRelationship.direction}
                  onChange={(event) =>
                    updateRelationship(selectedRelationship.id, {
                      direction: event.target.value as Relationship['direction'],
                    })
                  }
                >
                  <option value="source_to_target">单向 →</option>
                  <option value="bidirectional">双向 ↔</option>
                </select>
              </label>
              <label className="space-y-1 text-[11px] font-medium">
                类型
                <Input
                  aria-label="关系类型"
                  className="h-8 text-xs"
                  value={selectedRelationship.type}
                  onChange={(event) =>
                    updateRelationship(selectedRelationship.id, {
                      type: event.target.value,
                    })
                  }
                />
              </label>
            </div>

            <label className="block space-y-1 text-[11px] font-medium">
              强度：{selectedRelationship.strength}
              <input
                aria-label="关系强度"
                className="block h-5 w-full accent-primary"
                type="range"
                min={0}
                max={100}
                value={selectedRelationship.strength}
                onChange={(event) =>
                  updateRelationship(selectedRelationship.id, {
                    strength: Number(event.target.value),
                  })
                }
              />
            </label>

            <label className="block space-y-1 text-[11px] font-medium">
              生效章节
              <select
                aria-label="关系生效章节"
                className={selectClassName}
                value={selectedRelationship.effectiveUnitId ?? ''}
                onChange={(event) =>
                  updateRelationship(selectedRelationship.id, {
                    effectiveUnitId: event.target.value || undefined,
                  })
                }
              >
                <option value="">全篇有效</option>
                {units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.title}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1 text-[11px] font-medium">
              关系说明
              <Textarea
                aria-label="关系说明"
                className="min-h-16 text-xs"
                value={selectedRelationship.description}
                onChange={(event) =>
                  updateRelationship(selectedRelationship.id, {
                    description: event.target.value,
                  })
                }
              />
            </label>

            <div>
              <span className="text-[11px] font-medium">关联线索</span>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {clues.length ? (
                  clues.map((clue) => {
                    const linked = selectedRelationship.clueIds.includes(clue.id)
                    return (
                      <button
                        key={clue.id}
                        type="button"
                        aria-pressed={linked}
                        onClick={() =>
                          updateRelationship(selectedRelationship.id, {
                            clueIds: linked
                              ? selectedRelationship.clueIds.filter(
                                  (clueId) => clueId !== clue.id
                                )
                              : [...selectedRelationship.clueIds, clue.id],
                          })
                        }
                        className={cn(
                          'rounded-full border px-2 py-1 text-[10px]',
                          linked
                            ? 'border-primary/35 bg-primary/10 text-primary'
                            : 'text-muted-foreground hover:bg-accent'
                        )}
                      >
                        {clue.title}
                      </button>
                    )
                  })
                ) : (
                  <span className="text-[10px] text-muted-foreground">
                    暂无线索
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </aside>
    </div>
  )
}

function OutlinePanel({
  synopsis,
  outline,
  units,
  onSynopsisChange,
  onOutlineChange,
}: Props) {
  const sortedOutline = useMemo(
    () => outline.slice().sort((a, b) => a.position - b.position),
    [outline]
  )
  const outlineById = useMemo(
    () => new Map(outline.map((node) => [node.id, node])),
    [outline]
  )

  const descendantIds = (nodeId: string) => {
    const descendants = new Set<string>()
    const pending = [nodeId]
    while (pending.length) {
      const parentId = pending.pop()
      for (const node of outline) {
        if (node.parentId !== parentId || descendants.has(node.id)) continue
        descendants.add(node.id)
        pending.push(node.id)
      }
    }
    return descendants
  }

  const depthOf = (node: OutlineNode) => {
    let depth = 0
    let parentId = node.parentId
    const visited = new Set<string>([node.id])
    while (parentId && depth < 6 && !visited.has(parentId)) {
      visited.add(parentId)
      parentId = outlineById.get(parentId)?.parentId
      depth += 1
    }
    return depth
  }

  const updateNode = (nodeId: string, patch: Partial<OutlineNode>) => {
    onOutlineChange(
      outline.map((node) =>
        node.id === nodeId
          ? { ...node, ...patch, updatedAt: new Date().toISOString() }
          : node
      )
    )
  }

  const moveNode = (nodeId: string, delta: -1 | 1) => {
    const from = sortedOutline.findIndex((node) => node.id === nodeId)
    const to = from + delta
    if (from < 0 || to < 0 || to >= sortedOutline.length) return
    const reordered = [...sortedOutline]
    ;[reordered[from], reordered[to]] = [reordered[to], reordered[from]]
    const positions = new Map(
      reordered.map((node, position) => [node.id, position])
    )
    const now = new Date().toISOString()
    onOutlineChange(
      outline.map((node) => {
        const position = positions.get(node.id) ?? node.position
        return position === node.position
          ? node
          : { ...node, position, updatedAt: now }
      })
    )
  }

  const removeNode = (node: OutlineNode) => {
    const now = new Date().toISOString()
    onOutlineChange(
      outline
        .filter((item) => item.id !== node.id)
        .map((item) =>
          item.parentId === node.id
            ? { ...item, parentId: node.parentId, updatedAt: now }
            : item
        )
        .sort((a, b) => a.position - b.position)
        .map((item, position) => ({ ...item, position }))
    )
  }

  return (
    <div className="h-full overflow-y-auto p-6 lg:p-8">
      <div className="mx-auto max-w-4xl">
        <header className="mb-6 flex items-start justify-between">
          <div>
            <h2 className="font-studio text-xl font-semibold">
              作品小传与大纲
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              锁定节点会在 AI 续写时作为不可偏离的约束。
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => {
              const now = new Date().toISOString()
              onOutlineChange([
                ...outline,
                {
                  id: crypto.randomUUID(),
                  title: '新大纲节点',
                  summary: '',
                  intent: '',
                  position:
                    outline.reduce(
                      (highest, node) => Math.max(highest, node.position),
                      -1
                    ) + 1,
                  locked: false,
                  createdAt: now,
                  updatedAt: now,
                },
              ])
            }}
          >
            <Plus /> 新增节点
          </Button>
        </header>

        <section className="mb-6 rounded-xl border bg-background p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">作品小传</h3>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                核心意图、世界观与故事方向，会进入 AI 写作上下文。
              </p>
            </div>
            <span className="text-[10px] text-muted-foreground">
              {synopsis.trim().length} 字
            </span>
          </div>
          <Textarea
            aria-label="作品小传"
            className="mt-3 min-h-28 resize-y bg-muted/20"
            value={synopsis}
            onChange={(event) => onSynopsisChange(event.target.value)}
            placeholder="写下作品的核心意图、主角欲望、主要冲突与最终方向。"
          />
        </section>

        <div className="space-y-3">
          {sortedOutline.map((node, index) => {
            const descendants = descendantIds(node.id)
            const depth = depthOf(node)
            return (
              <div
                key={node.id}
                className="rounded-xl border bg-background p-4"
                style={{ marginLeft: `${Math.min(depth, 5) * 20}px` }}
              >
                <div className="flex items-center gap-3">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                    {index + 1}
                  </span>
                  <Input
                    className="h-8 flex-1 border-0 bg-transparent px-0 font-semibold shadow-none focus-visible:ring-0"
                    value={node.title}
                    onChange={(event) =>
                      onOutlineChange(
                        outline.map((item) =>
                          item.id === node.id
                            ? {
                                ...item,
                                title: event.target.value,
                                updatedAt: new Date().toISOString(),
                              }
                            : item
                        )
                      )
                    }
                  />
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    disabled={index === 0}
                    onClick={() => moveNode(node.id, -1)}
                    aria-label={`上移${node.title}`}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    disabled={index === sortedOutline.length - 1}
                    onClick={() => moveNode(node.id, 1)}
                    aria-label={`下移${node.title}`}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant={node.locked ? 'secondary' : 'ghost'}
                    onClick={() => updateNode(node.id, { locked: !node.locked })}
                    aria-label="锁定大纲节点"
                  >
                    <LockKeyhole />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    onClick={() => removeNode(node)}
                    aria-label={`删除${node.title}`}
                  >
                    <Trash2 />
                  </Button>
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1 text-[11px] font-medium">
                    父节点
                    <select
                      aria-label={`${node.title} 父节点`}
                      className={selectClassName}
                      value={node.parentId ?? ''}
                      onChange={(event) =>
                        updateNode(node.id, {
                          parentId: event.target.value || undefined,
                        })
                      }
                    >
                      <option value="">顶层节点</option>
                      {sortedOutline
                        .filter(
                          (candidate) =>
                            candidate.id !== node.id &&
                            !descendants.has(candidate.id)
                        )
                        .map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {candidate.title}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="space-y-1 text-[11px] font-medium">
                    关联章节
                    <select
                      aria-label={`${node.title} 关联章节`}
                      className={selectClassName}
                      value={node.unitId ?? ''}
                      onChange={(event) =>
                        updateNode(node.id, {
                          unitId: event.target.value || undefined,
                        })
                      }
                    >
                      <option value="">跨章节主线</option>
                      {units.map((unit) => (
                        <option key={unit.id} value={unit.id}>
                          {unit.title}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <Textarea
                  className="mt-3 min-h-20 border-0 bg-muted/35 shadow-none focus-visible:ring-1"
                  aria-label={`${node.title} 内容摘要`}
                  value={node.summary}
                  onChange={(event) =>
                    updateNode(node.id, { summary: event.target.value })
                  }
                  placeholder="谁在这里做了什么，这一节点如何推进故事。"
                />
                <Textarea
                  className="mt-2 min-h-16 border-0 bg-primary/[0.035] shadow-none focus-visible:ring-1"
                  aria-label={`${node.title} 创作意图`}
                  value={node.intent}
                  onChange={(event) =>
                    updateNode(node.id, { intent: event.target.value })
                  }
                  placeholder="这一节点必须实现的创作意图或不可偏离的约束。"
                />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function CluesPanel({
  clues,
  units,
  characters,
  onCluesChange,
}: Props) {
  const [expandedClueId, setExpandedClueId] = useState<string>()

  useEffect(() => {
    if (
      expandedClueId &&
      !clues.some((clue) => clue.id === expandedClueId)
    ) {
      setExpandedClueId(undefined)
    }
  }, [clues, expandedClueId])

  const updateClue = (clueId: string, patch: Partial<Clue>) => {
    onCluesChange(
      clues.map((clue) =>
        clue.id === clueId
          ? { ...clue, ...patch, updatedAt: new Date().toISOString() }
          : clue
      )
    )
  }

  const advanceClue = (clue: Clue) => {
    if (clue.status === 'resolved' || clue.status === 'abandoned') return
    const status: Clue['status'] =
      clue.status === 'planned' ? 'planted' : 'resolved'
    updateClue(clue.id, {
      status,
      resolvedUnitId:
        status === 'resolved'
          ? (clue.plannedResolveUnitId ?? clue.plantedUnitId)
          : undefined,
    })
  }

  return (
    <div className="h-full overflow-auto p-6 lg:p-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6 flex items-start justify-between">
          <div>
            <h2 className="font-studio text-xl font-semibold">伏笔与线索</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              清楚地知道在哪里埋下，又准备在哪里收回。
            </p>
          </div>
          <Button
            size="sm"
            disabled={units.length === 0}
            onClick={() => {
              const now = new Date().toISOString()
              const next: Clue = {
                id: crypto.randomUUID(),
                title: '新线索',
                description: '',
                plantedUnitId: units[0]?.id ?? '',
                plannedResolveUnitId: units.at(-1)?.id,
                status: 'planned',
                relatedCharacterIds: [],
                notes: '',
                createdAt: now,
                updatedAt: now,
              }
              onCluesChange([
                ...clues,
                next,
              ])
              setExpandedClueId(next.id)
            }}
          >
            <Plus /> 新增线索
          </Button>
        </header>

        <div className="overflow-x-auto rounded-xl border bg-background">
          <div className="grid min-w-[960px] grid-cols-[1.25fr_1fr_1fr_8rem_1.45fr_9rem] border-b bg-muted/35 px-3 py-2.5 text-[11px] font-semibold text-muted-foreground">
            <span>线索</span>
            <span>埋设</span>
            <span>计划回收</span>
            <span>状态</span>
            <span>说明</span>
            <span className="text-right">操作</span>
          </div>
          {clues.map((clue) => (
            <div
              key={clue.id}
              className="min-w-[960px] border-b last:border-b-0"
            >
              <div className="grid grid-cols-[1.25fr_1fr_1fr_8rem_1.45fr_9rem] items-center gap-2 px-3 py-2.5 text-xs hover:bg-muted/20">
                <Input
                  aria-label={`${clue.title} 标题`}
                  className="h-8 min-w-0 border-0 bg-transparent px-1 font-semibold shadow-none focus-visible:ring-1"
                  value={clue.title}
                  onChange={(event) =>
                    updateClue(clue.id, { title: event.target.value })
                  }
                />
                <select
                  aria-label={`${clue.title} 埋设章节`}
                  className={selectClassName}
                  value={clue.plantedUnitId}
                  onChange={(event) =>
                    updateClue(clue.id, { plantedUnitId: event.target.value })
                  }
                >
                  {units.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.title}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={`${clue.title} 计划回收章节`}
                  className={selectClassName}
                  value={clue.plannedResolveUnitId ?? ''}
                  onChange={(event) => {
                    const plannedResolveUnitId = event.target.value || undefined
                    updateClue(clue.id, {
                      plannedResolveUnitId,
                      resolvedUnitId:
                        clue.status === 'resolved'
                          ? (plannedResolveUnitId ?? clue.plantedUnitId)
                          : clue.resolvedUnitId,
                    })
                  }}
                >
                  <option value="">待定</option>
                  {units.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.title}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={`${clue.title} 状态`}
                  className={cn(
                    selectClassName,
                    clue.status === 'resolved' &&
                      'border-emerald-500/30 text-emerald-700 dark:text-emerald-300',
                    clue.status === 'abandoned' && 'text-muted-foreground'
                  )}
                  value={clue.status}
                  onChange={(event) => {
                    const status = event.target.value as Clue['status']
                    updateClue(clue.id, {
                      status,
                      resolvedUnitId:
                        status === 'resolved'
                          ? (clue.resolvedUnitId ??
                            clue.plannedResolveUnitId ??
                            clue.plantedUnitId)
                          : undefined,
                    })
                  }}
                >
                  <option value="planned">计划中</option>
                  <option value="planted">已埋设</option>
                  <option value="resolved">已回收</option>
                  <option value="abandoned">已放弃</option>
                </select>
                <Input
                  aria-label={`${clue.title} 说明`}
                  className="h-8 min-w-0 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-1"
                  value={clue.description}
                  onChange={(event) =>
                    updateClue(clue.id, { description: event.target.value })
                  }
                  placeholder="埋设方式与回收用途"
                />
                <div className="flex justify-end gap-1">
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={
                      clue.status === 'resolved' || clue.status === 'abandoned'
                    }
                    aria-label={`推进${clue.title}状态`}
                    onClick={() => advanceClue(clue)}
                  >
                    {clue.status === 'planted' ? (
                      <CheckCircle2 />
                    ) : (
                      <CircleDot />
                    )}
                    推进
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    aria-expanded={expandedClueId === clue.id}
                    onClick={() =>
                      setExpandedClueId((current) =>
                        current === clue.id ? undefined : clue.id
                      )
                    }
                  >
                    详情
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`删除${clue.title}`}
                    onClick={() =>
                      onCluesChange(clues.filter((item) => item.id !== clue.id))
                    }
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>

              {expandedClueId === clue.id && (
                <div className="grid gap-4 border-t bg-muted/15 px-4 py-4 sm:grid-cols-2">
                  <label className="space-y-1 text-[11px] font-medium">
                    作者备注
                    <Textarea
                      aria-label={`${clue.title} 作者备注`}
                      className="min-h-20 bg-background text-xs"
                      value={clue.notes}
                      onChange={(event) =>
                        updateClue(clue.id, { notes: event.target.value })
                      }
                      placeholder="记录证据链、误导方式或回收时必须出现的细节。"
                    />
                  </label>
                  <div>
                    <span className="text-[11px] font-medium">关联人物</span>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {characters.length ? (
                        characters.map((character) => {
                          const linked = clue.relatedCharacterIds.includes(
                            character.id
                          )
                          return (
                            <button
                              key={character.id}
                              type="button"
                              aria-pressed={linked}
                              onClick={() =>
                                updateClue(clue.id, {
                                  relatedCharacterIds: linked
                                    ? clue.relatedCharacterIds.filter(
                                        (characterId) =>
                                          characterId !== character.id
                                      )
                                    : [
                                        ...clue.relatedCharacterIds,
                                        character.id,
                                      ],
                                })
                              }
                              className={cn(
                                'rounded-full border px-2.5 py-1 text-[11px]',
                                linked
                                  ? 'border-primary/35 bg-primary/10 text-primary'
                                  : 'bg-background text-muted-foreground hover:bg-accent'
                              )}
                            >
                              {character.name}
                            </button>
                          )
                        })
                      ) : (
                        <span className="text-[10px] text-muted-foreground">
                          暂无人物
                        </span>
                      )}
                    </div>
                    {clue.status === 'resolved' && (
                      <p className="mt-3 text-[10px] text-emerald-700 dark:text-emerald-300">
                        回收章节：
                        {units.find((unit) => unit.id === clue.resolvedUnitId)
                          ?.title ?? '待确认'}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
          {clues.length === 0 && (
            <div className="py-12 text-center text-sm text-muted-foreground">
              暂无线索，先新增一条准备埋设的伏笔。
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function EmptyAsset({
  icon: Icon,
  title,
  action,
}: {
  icon: typeof Network
  title: string
  action: string
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <span className="mb-3 flex size-12 items-center justify-center rounded-xl bg-muted">
        <Icon className="size-5" />
      </span>
      <strong>{title}</strong>
      <Button className="mt-4" size="sm">
        <Plus /> {action}
      </Button>
    </div>
  )
}
