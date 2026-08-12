import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownRight,
  ArrowLeftRight,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  LockKeyhole,
  Network,
  Plus,
  Search,
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
  onCharactersChange: (items: Character[]) => void
  onRelationshipsChange: (items: Relationship[]) => void
  onOutlineChange: (items: OutlineNode[]) => void
  onCluesChange: (items: Clue[]) => void
  onGenerateCharacterAvatar?: (character: Character) => Promise<string>
  resolveAssetSrc?: (source: string) => string
}

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
  onRelationshipsChange,
}: Props) {
  const positions = useMemo(() => {
    const centerX = 50
    const centerY = 45
    return characters.slice(0, 8).map((character, index, array) => {
      const angle =
        (Math.PI * 2 * index) / Math.max(array.length, 1) - Math.PI / 2
      const radius = index === 0 ? 0 : 31
      return {
        character,
        x: index === 0 ? centerX : centerX + Math.cos(angle) * radius,
        y: index === 0 ? centerY : centerY + Math.sin(angle) * radius,
      }
    })
  }, [characters])

  return (
    <div className="relative h-full overflow-hidden bg-[radial-gradient(circle_at_center,color-mix(in_oklab,var(--primary)_5%,transparent),transparent_55%)]">
      <div className="absolute left-5 top-5 z-10">
        <h2 className="font-studio text-lg font-semibold">人物关系图</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          方向、强度与关联线索都可追溯到章节。
        </p>
      </div>
      <Button
        className="absolute right-5 top-5 z-20"
        size="sm"
        disabled={characters.length < 2}
        onClick={() => {
          const now = new Date().toISOString()
          onRelationshipsChange([
            ...relationships,
            {
              id: crypto.randomUUID(),
              sourceCharacterId: characters[0].id,
              targetCharacterId: characters[1].id,
              direction: 'bidirectional',
              type: '待定义关系',
              description: '点击人物详情继续完善这段关系。',
              strength: 50,
              clueIds: [],
              createdAt: now,
              updatedAt: now,
            },
          ])
        }}
      >
        <Plus /> 新增关系
      </Button>
      <svg className="absolute inset-0 size-full" aria-label="人物关系连线">
        {relationships.map((relationship) => {
          const source = positions.find(
            (item) => item.character.id === relationship.sourceCharacterId
          )
          const target = positions.find(
            (item) => item.character.id === relationship.targetCharacterId
          )
          if (!source || !target) return null
          return (
            <g key={relationship.id}>
              <line
                x1={`${source.x}%`}
                y1={`${source.y}%`}
                x2={`${target.x}%`}
                y2={`${target.y}%`}
                stroke="currentColor"
                strokeOpacity={0.15 + relationship.strength / 140}
                strokeWidth={1 + relationship.strength / 40}
                strokeDasharray={
                  relationship.type.includes('敌') ? '6 5' : undefined
                }
              />
            </g>
          )
        })}
      </svg>
      {positions.map(({ character, x, y }, index) => (
        <button
          key={character.id}
          type="button"
          style={{ left: `${x}%`, top: `${y}%` }}
          className="absolute z-10 flex w-28 -translate-x-1/2 -translate-y-1/2 flex-col items-center rounded-xl border bg-background p-3 shadow-sm transition hover:-translate-y-[55%] hover:shadow-md"
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
    </div>
  )
}

function OutlinePanel({ outline, units, onOutlineChange }: Props) {
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
                  position: outline.length,
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
        <div className="space-y-3">
          {outline
            .slice()
            .sort((a, b) => a.position - b.position)
            .map((node, index) => (
              <div
                key={node.id}
                className="rounded-xl border bg-background p-4"
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
                    variant={node.locked ? 'secondary' : 'ghost'}
                    onClick={() =>
                      onOutlineChange(
                        outline.map((item) =>
                          item.id === node.id
                            ? {
                                ...item,
                                locked: !item.locked,
                                updatedAt: new Date().toISOString(),
                              }
                            : item
                        )
                      )
                    }
                    aria-label="锁定大纲节点"
                  >
                    <LockKeyhole />
                  </Button>
                  <ChevronDown className="size-4 text-muted-foreground" />
                </div>
                <Textarea
                  className="mt-3 min-h-20 border-0 bg-muted/35 shadow-none focus-visible:ring-1"
                  value={node.summary}
                  onChange={(event) =>
                    onOutlineChange(
                      outline.map((item) =>
                        item.id === node.id
                          ? {
                              ...item,
                              summary: event.target.value,
                              updatedAt: new Date().toISOString(),
                            }
                          : item
                      )
                    )
                  }
                />
                <div className="mt-2 text-[11px] text-muted-foreground">
                  {node.unitId
                    ? (units.find((unit) => unit.id === node.unitId)?.title ??
                      '关联章节已删除')
                    : '跨章节主线'}
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  )
}

function CluesPanel({ clues, units, onCluesChange }: Props) {
  const unitTitle = (id?: string) =>
    id ? (units.find((unit) => unit.id === id)?.title ?? '未知章节') : '待定'

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
              onCluesChange([
                ...clues,
                {
                  id: crypto.randomUUID(),
                  title: '新线索',
                  description: '补充埋设方式与回收用途。',
                  plantedUnitId: units[0]?.id ?? '',
                  plannedResolveUnitId: units.at(-1)?.id,
                  status: 'planned',
                  relatedCharacterIds: [],
                  notes: '',
                  createdAt: now,
                  updatedAt: now,
                },
              ])
            }}
          >
            <Plus /> 新增线索
          </Button>
        </header>
        <div className="overflow-hidden rounded-xl border bg-background">
          <div className="grid min-w-[760px] grid-cols-[1.4fr_1fr_1fr_8rem_1.6fr] border-b bg-muted/35 px-4 py-2.5 text-[11px] font-semibold text-muted-foreground">
            <span>线索</span>
            <span>埋设</span>
            <span>计划回收</span>
            <span>状态</span>
            <span>说明</span>
          </div>
          {clues.map((clue) => (
            <div
              key={clue.id}
              className="grid min-w-[760px] grid-cols-[1.4fr_1fr_1fr_8rem_1.6fr] items-center border-b px-4 py-3 text-xs last:border-b-0 hover:bg-muted/20"
            >
              <strong className="pr-3">{clue.title}</strong>
              <span>{unitTitle(clue.plantedUnitId)}</span>
              <span>{unitTitle(clue.plannedResolveUnitId)}</span>
              <button
                type="button"
                onClick={() =>
                  onCluesChange(
                    clues.map((item) =>
                      item.id === clue.id
                        ? {
                            ...item,
                            status:
                              item.status === 'resolved'
                                ? 'planted'
                                : 'resolved',
                            resolvedUnitId:
                              item.status === 'resolved'
                                ? undefined
                                : item.plannedResolveUnitId,
                            updatedAt: new Date().toISOString(),
                          }
                        : item
                    )
                  )
                }
                className={cn(
                  'inline-flex w-fit items-center gap-1 rounded-full px-2 py-1',
                  clue.status === 'resolved'
                    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    : 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                )}
              >
                {clue.status === 'resolved' ? (
                  <CheckCircle2 className="size-3" />
                ) : (
                  <CircleDot className="size-3" />
                )}
                {clue.status === 'resolved'
                  ? '已回收'
                  : clue.status === 'planted'
                    ? '已埋设'
                    : '计划中'}
              </button>
              <span className="pr-3 text-muted-foreground">
                {clue.description || clue.notes}
              </span>
            </div>
          ))}
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
