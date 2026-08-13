import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  BookOpenText,
  ChevronRight,
  Clapperboard,
  Clock3,
  FileText,
  Import,
  LibraryBig,
  LoaderCircle,
  Plus,
  Search,
  Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { route } from '@/constants/routes'
import { useServiceHub } from '@/hooks/useServiceHub'
import { extractDocxText } from '@/lib/novel-import'
import { runNovelBlueprint } from '@/lib/novel-ai'
import { cn } from '@/lib/utils'
import type {
  CreateNovelProjectInput,
  NovelImportInput,
  NovelKind,
  NovelProjectBundle,
  NovelProjectSummary,
} from '@/types/novel'

const kindLabel: Record<NovelKind, string> = {
  web_novel: '网文',
  novel: '小说',
  screenplay: '剧本',
}

const templateOptions: Array<{
  id: NonNullable<CreateNovelProjectInput['template']>
  title: string
  description: string
  icon: typeof BookOpenText
}> = [
  {
    id: 'blank',
    title: '空白作品',
    description: '从第一段开始，结构完全由你掌控',
    icon: FileText,
  },
  {
    id: 'cultivation',
    title: '东方玄幻',
    description: '预置境界、宗门和伏笔字段',
    icon: Sparkles,
  },
  {
    id: 'mystery',
    title: '悬疑长篇',
    description: '强化线索时间轴与回收状态',
    icon: Search,
  },
  {
    id: 'screenplay',
    title: '影视剧本',
    description: '使用幕、场景与人物资产组织',
    icon: Clapperboard,
  },
]

function formatUpdatedAt(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '刚刚更新'
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function openBundle(
  navigate: ReturnType<typeof useNavigate>,
  bundle: NovelProjectBundle
) {
  void navigate({
    to: route.novels.detail as never,
    params: {
      novelId: bundle.project.id,
      unitId: bundle.project.activeUnitId,
    } as never,
  })
}

export function NovelLibrary() {
  const serviceHub = useServiceHub()
  const navigate = useNavigate()
  const importRef = useRef<HTMLInputElement>(null)
  const [projects, setProjects] = useState<NovelProjectSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [blueprintGenerating, setBlueprintGenerating] = useState(false)
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState<CreateNovelProjectInput>({
    title: '',
    kind: 'web_novel',
    genre: '东方玄幻',
    synopsis: '',
    template: 'cultivation',
  })
  const draftRef = useRef(draft)
  draftRef.current = draft

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setProjects(await serviceHub.novels().listProjects())
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '作品库加载失败')
    } finally {
      setLoading(false)
    }
  }, [serviceHub])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const createProject = async () => {
    const title = draft.title.trim()
    if (!title) {
      toast.error('请先给作品起一个名字')
      return
    }
    setCreating(true)
    try {
      const bundle = await serviceHub.novels().createProject({
        ...draft,
        title,
      })
      setCreateOpen(false)
      openBundle(navigate, bundle)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建作品失败')
    } finally {
      setCreating(false)
    }
  }

  const generateBlueprint = async () => {
    const requestedSynopsis = draft.synopsis ?? ''
    const idea = requestedSynopsis.trim()
    if (!idea) {
      toast.error('先写下一句话构思，AI 才知道故事从哪里长出来')
      return
    }
    setBlueprintGenerating(true)
    try {
      const blueprint = await runNovelBlueprint({
        title: draft.title,
        genre: draft.genre ?? '',
        kindLabel: kindLabel[draft.kind],
        idea,
      })
      if ((draftRef.current.synopsis ?? '') !== requestedSynopsis) {
        toast.info('构思已更新，本次蓝图未覆盖当前内容')
        return
      }
      setDraft((current) =>
        (current.synopsis ?? '') === requestedSynopsis
          ? { ...current, synopsis: blueprint.trim() }
          : current
      )
      toast.success('故事蓝图已生成，可以继续手动调味')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '故事蓝图生成失败')
    } finally {
      setBlueprintGenerating(false)
    }
  }

  const importProject = async (file: File) => {
    const extension = file.name.split('.').pop()?.toLowerCase()
    const format: NovelImportInput['format'] =
      extension === 'md'
        ? 'markdown'
        : extension === 'docx'
          ? 'docx'
          : extension === 'biyan-novel'
            ? 'biyan-novel'
            : 'txt'
    try {
      const content =
        format === 'docx'
          ? extractDocxText(new Uint8Array(await file.arrayBuffer()))
          : await file.text()
      const bundle = await serviceHub.novels().importProject({
        kind: format === 'docx' ? 'novel' : 'web_novel',
        format: format === 'docx' ? 'txt' : format,
        fileName: file.name,
        content,
      })
      openBundle(navigate, bundle)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '导入失败')
    } finally {
      if (importRef.current) importRef.current.value = ''
    }
  }

  const filteredProjects = projects.filter((project) =>
    `${project.title} ${project.genre}`
      .toLowerCase()
      .includes(query.toLowerCase())
  )

  return (
    <main className="h-svh overflow-y-auto bg-neutral-50 px-4 pb-12 pt-14 dark:bg-background sm:px-8">
      <div className="mx-auto w-full max-w-6xl">
        <header className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-3 flex size-10 items-center justify-center rounded-xl border bg-background text-primary shadow-xs">
              <LibraryBig className="size-5" />
            </div>
            <h1 className="font-studio text-3xl font-semibold tracking-tight">
              我的作品
            </h1>
            <p className="mt-2 max-w-xl text-sm text-muted-foreground">
              AI 负责铺开故事，你负责设定、比较与定稿。所有正文都保存在本机。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              ref={importRef}
              className="hidden"
              type="file"
              accept=".md,.txt,.docx,.biyan-novel"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0]
                if (file) void importProject(file)
              }}
            />
            <Button
              variant="outline"
              onClick={() => importRef.current?.click()}
            >
              <Import /> 导入作品
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus /> 新建作品
            </Button>
          </div>
        </header>

        <div className="mb-5 flex items-center justify-between gap-3">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="rounded-full bg-background pl-9"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索作品或类型"
            />
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">
            {projects.length} 部作品
          </span>
        </div>

        {loading ? (
          <div className="flex min-h-72 items-center justify-center text-muted-foreground">
            <LoaderCircle className="mr-2 size-4 animate-spin" />{' '}
            正在扫描本地作品
          </div>
        ) : filteredProjects.length ? (
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredProjects.map((project, index) => (
              <Card
                key={project.id}
                className="group cursor-pointer overflow-hidden rounded-xl bg-background shadow-none transition hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-md"
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    void serviceHub
                      .novels()
                      .openProject(project.id)
                      .then((bundle) => openBundle(navigate, bundle))
                      .catch((error) =>
                        toast.error(
                          error instanceof Error
                            ? error.message
                            : '打开作品失败'
                        )
                      )
                  }
                }}
                onClick={() => {
                  void serviceHub
                    .novels()
                    .openProject(project.id)
                    .then((bundle) => openBundle(navigate, bundle))
                    .catch((error) =>
                      toast.error(
                        error instanceof Error ? error.message : '打开作品失败'
                      )
                    )
                }}
              >
                <div
                  className={cn(
                    'flex h-28 items-end border-b p-4',
                    index % 3 === 0 && 'bg-orange-50 dark:bg-orange-950/20',
                    index % 3 === 1 && 'bg-sky-50 dark:bg-sky-950/20',
                    index % 3 === 2 && 'bg-violet-50 dark:bg-violet-950/20'
                  )}
                >
                  <div className="rounded-full border bg-background/90 px-2.5 py-1 text-xs font-medium">
                    {kindLabel[project.kind]} · {project.genre || '未分类'}
                  </div>
                </div>
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="line-clamp-1 font-studio text-lg font-semibold">
                      {project.title}
                    </h2>
                    <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </div>
                  <p className="mt-2 line-clamp-2 min-h-10 text-sm leading-5 text-muted-foreground">
                    {project.synopsis ||
                      '还没有作品小传，进入后可交给 AI 起草。'}
                  </p>
                  <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {project.unitCount} 章 ·{' '}
                      {project.wordCount.toLocaleString()} 字
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Clock3 className="size-3" />{' '}
                      {formatUpdatedAt(project.updatedAt)}
                    </span>
                  </div>
                </div>
              </Card>
            ))}
          </section>
        ) : (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="flex min-h-72 w-full flex-col items-center justify-center rounded-xl border border-dashed bg-background px-6 text-center transition hover:border-primary/40 hover:bg-primary/[0.02]"
          >
            <div className="mb-4 flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <BookOpenText className="size-6" />
            </div>
            <strong className="font-studio text-lg">写下第一个世界</strong>
            <span className="mt-1 max-w-sm text-sm text-muted-foreground">
              新建空白作品，或让 AI 从一句构思生成故事蓝图。
            </span>
          </button>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-3xl rounded-xl">
          <DialogHeader>
            <DialogTitle>新建作品</DialogTitle>
            <DialogDescription>
              模板只提供结构提示，任何设定都可以随时调整。
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-5 py-2 md:grid-cols-[1fr_1.2fr]">
            <div className="space-y-4">
              <label className="block space-y-1.5 text-sm font-medium">
                作品名称
                <Input
                  autoFocus
                  value={draft.title}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                  placeholder="例如：照骨簪"
                />
              </label>
              <div className="space-y-1.5">
                <span className="text-sm font-medium">创作内核</span>
                <div className="grid grid-cols-3 gap-2">
                  {(['web_novel', 'novel', 'screenplay'] as NovelKind[]).map(
                    (kind) => (
                      <button
                        key={kind}
                        type="button"
                        onClick={() =>
                          setDraft((current) => ({ ...current, kind }))
                        }
                        className={cn(
                          'rounded-lg border px-2 py-2 text-sm transition',
                          draft.kind === kind
                            ? 'border-primary bg-primary/8 text-primary'
                            : 'bg-background hover:bg-accent'
                        )}
                      >
                        {kindLabel[kind]}
                      </button>
                    )
                  )}
                </div>
              </div>
              <label className="block space-y-1.5 text-sm font-medium">
                类型
                <Input
                  value={draft.genre}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      genre: event.target.value,
                    }))
                  }
                  placeholder="东方玄幻 / 都市 / 悬疑…"
                />
              </label>
              <label className="block space-y-1.5 text-sm font-medium">
                一句话构思
                <Textarea
                  value={draft.synopsis}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      synopsis: event.target.value,
                    }))
                  }
                  placeholder="失去灵根的铸簪师，发现每支簪都能照见一个人的谎言。"
                />
              </label>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={blueprintGenerating}
                onClick={() => void generateBlueprint()}
              >
                {blueprintGenerating ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Sparkles />
                )}
                AI 生成故事蓝图
              </Button>
            </div>

            <div>
              <span className="text-sm font-medium">选择模板</span>
              <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                {templateOptions.map((template) => {
                  const Icon = template.icon
                  const selected = draft.template === template.id
                  return (
                    <button
                      type="button"
                      key={template.id}
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          template: template.id,
                          kind:
                            template.id === 'screenplay'
                              ? 'screenplay'
                              : current.kind,
                        }))
                      }
                      className={cn(
                        'rounded-xl border p-3 text-left transition',
                        selected
                          ? 'border-primary bg-primary/6 shadow-[0_0_0_1px_var(--primary)]'
                          : 'hover:bg-accent'
                      )}
                    >
                      <Icon
                        className={cn(
                          'mb-3 size-5',
                          selected ? 'text-primary' : 'text-muted-foreground'
                        )}
                      />
                      <strong className="block text-sm">
                        {template.title}
                      </strong>
                      <span className="mt-1 block text-xs leading-4 text-muted-foreground">
                        {template.description}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button disabled={creating} onClick={() => void createProject()}>
              {creating ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Sparkles />
              )}
              创建并进入写作台
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}
