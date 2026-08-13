import {
  BookOpen,
  ChevronDown,
  FileText,
  MoreHorizontal,
  Plus,
  Search,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { ManuscriptUnit, NovelProject } from '@/types/novel'

type Props = {
  project: NovelProject
  units: ManuscriptUnit[]
  activeUnitId: string
  onSelect: (unit: ManuscriptUnit) => void
  onCreateUnit: () => void
  onSwitchProject: () => void
}

export function ChapterTree({
  project,
  units,
  activeUnitId,
  onSelect,
  onCreateUnit,
  onSwitchProject,
}: Props) {
  const volumes = units.filter((unit) => unit.kind === 'volume' || unit.kind === 'act')
  const rootUnits = units.filter((unit) => !unit.parentId && !volumes.includes(unit))

  return (
    <aside className="flex min-w-0 flex-col border-r bg-muted/20">
      <div className="border-b p-3">
        <div className="flex items-center gap-2">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <BookOpen className="size-4" />
          </div>
          <button
            type="button"
            onClick={onSwitchProject}
            className="min-w-0 flex-1 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title="返回作品库并切换作品"
          >
            <div className="truncate text-sm font-semibold">{project.title}</div>
            <div className="truncate text-[11px] text-muted-foreground">
              {project.genre || '未分类'} · 本地作品
            </div>
          </button>
          <Button size="icon-xs" variant="ghost" aria-label="作品菜单">
            <MoreHorizontal />
          </Button>
        </div>
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-8 rounded-lg bg-background pl-8 text-xs"
            placeholder="搜索章节"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        <div className="mb-2 flex items-center justify-between px-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {project.kind === 'screenplay' ? '幕与场景' : '卷与章节'}
          </span>
          <Button size="icon-xs" variant="ghost" onClick={onCreateUnit} aria-label="新建章节">
            <Plus />
          </Button>
        </div>

        {volumes.map((volume) => (
          <div key={volume.id} className="mb-3">
            <button
              type="button"
              className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-xs font-semibold hover:bg-accent"
            >
              <ChevronDown className="size-3.5 text-muted-foreground" />
              <span className="truncate">{volume.title}</span>
            </button>
            <div className="mt-0.5 space-y-0.5">
              {units
                .filter((unit) => unit.parentId === volume.id)
                .sort((a, b) => a.position - b.position)
                .map((unit) => (
                  <UnitButton
                    key={unit.id}
                    unit={unit}
                    active={unit.id === activeUnitId}
                    onClick={() => onSelect(unit)}
                  />
                ))}
            </div>
          </div>
        ))}

        {rootUnits
          .sort((a, b) => a.position - b.position)
          .map((unit) => (
            <UnitButton
              key={unit.id}
              unit={unit}
              active={unit.id === activeUnitId}
              onClick={() => onSelect(unit)}
            />
          ))}
      </div>

      <div className="border-t p-3 text-[11px] text-muted-foreground">
        {units.reduce((sum, unit) => sum + unit.wordCount, 0).toLocaleString()} 字 ·{' '}
        {units.filter((unit) => unit.kind === 'chapter' || unit.kind === 'scene').length} 个正文单元
      </div>
    </aside>
  )
}

function UnitButton({
  unit,
  active,
  onClick,
}: {
  unit: ManuscriptUnit
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left transition',
        active
          ? 'bg-primary/10 text-foreground'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground'
      )}
    >
      <FileText className={cn('mt-0.5 size-3.5 shrink-0', active && 'text-primary')} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{unit.title}</span>
        <span className="mt-0.5 block text-[10px] opacity-70">
          {unit.wordCount.toLocaleString()} 字
        </span>
      </span>
    </button>
  )
}
