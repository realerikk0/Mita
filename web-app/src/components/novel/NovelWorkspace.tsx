import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import type { Editor } from '@tiptap/react'
import {
  BookOpenText,
  Check,
  Clock3,
  Download,
  Expand,
  History,
  Lightbulb,
  ListTree,
  LoaderCircle,
  Maximize2,
  MessageSquareText,
  Network,
  PanelRight,
  Save,
  SearchCheck,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react'
import { toast } from 'sonner'

import { AiInspector } from './AiInspector'
import { ChapterTree } from './ChapterTree'
import { ManuscriptEditor } from './ManuscriptEditor'
import { NovelAssets } from './NovelAssets'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { route } from '@/constants/routes'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useNovelAutosave } from '@/hooks/useNovelAutosave'
import { useNovelExitGuard } from '@/hooks/useNovelExitGuard'
import { useServiceHub } from '@/hooks/useServiceHub'
import {
  apiQualityForPreset,
  getImageModels,
  imageFileExtension,
  imageSizeForRatio,
} from '@/lib/image-generation'
import {
  cursorToTextAnchor,
  replaceTextAnchor,
  selectionToTextAnchor,
  validateTextAnchor,
} from '@/lib/novel-editor'
import { hashNovelText, resolveTextAnchor } from '@/lib/novel-anchor'
import { runNovelCandidateStreams } from '@/lib/novel-ai'
import { reusableNovelContext } from '@/lib/novel-context'
import { proofNovelText } from '@/lib/novel-proofing'
import { cn } from '@/lib/utils'
import {
  NovelServiceError,
  type AiContextItem,
  type AiSuggestion,
  type Character,
  type CommentThread,
  type ManuscriptUnit,
  type NovelExportInput,
  type NovelProjectBundle,
  type NovelRevision,
  type OutlineNode,
  type Relationship,
  type Clue,
  type TextAnchor,
} from '@/types/novel'

type WorkspaceTab = 'write' | 'characters' | 'relations' | 'outline' | 'clues'
type MetadataKey = 'characters' | 'relationships' | 'outline' | 'clues'
type MetadataItems = Character[] | Relationship[] | OutlineNode[] | Clue[]
const metadataKeys: MetadataKey[] = [
  'characters',
  'relationships',
  'outline',
  'clues',
]

type Props = {
  novelId: string
  unitId: string
}

const tabItems: Array<{
  id: WorkspaceTab
  label: string
  icon: typeof Sparkles
}> = [
  { id: 'write', label: '写作', icon: BookOpenText },
  { id: 'characters', label: '人物', icon: UserRound },
  { id: 'relations', label: '关系', icon: Network },
  { id: 'outline', label: '大纲', icon: ListTree },
  { id: 'clues', label: '线索', icon: Lightbulb },
]

const generatingSuggestions = (items: AiSuggestion[]) =>
  items.some((item) => item.status === 'streaming')

const suggestionsForUnit = (items: AiSuggestion[], unitId: string) =>
  items.filter((suggestion) => suggestion.unitId === unitId)

const suggestionsHash = (items: AiSuggestion[]) =>
  hashNovelText(JSON.stringify(items))

const isLiveEditor = (editor: Editor | null): editor is Editor =>
  Boolean(editor && !editor.isDestroyed)

const reportTransitionFailure = (error: unknown, action: string) => {
  const message =
    error instanceof NovelServiceError && error.code === 'revision_conflict'
      ? '正文存在尚未解决的保存冲突'
      : error instanceof Error
        ? error.message
        : '待保存内容未能落盘'
  toast.error(`${action}已取消：${message}`)
}

export function NovelWorkspace({ novelId, unitId }: Props) {
  const serviceHub = useServiceHub()
  const imageProviders = useModelProvider((state) => state.providers)
  const navigate = useNavigate()
  const [bundle, setBundle] = useState<NovelProjectBundle | null>(null)
  const [activeUnit, setActiveUnit] = useState<ManuscriptUnit | null>(null)
  const activeUnitId = activeUnit?.id
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string>()
  const [tab, setTab] = useState<WorkspaceTab>('write')
  const [editor, setEditor] = useState<Editor | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [focusMode, setFocusMode] = useState(false)
  const [instruction, setInstruction] =
    useState('更克制、更有压迫感，保留情节信息。')
  const [selectedText, setSelectedText] = useState('')
  const [activeAnchor, setActiveAnchor] = useState<TextAnchor | undefined>()
  const [suggestions, setSuggestions] = useState<AiSuggestion[]>([])
  const [contextItems, setContextItems] = useState<AiContextItem[]>([])
  const [commentOpen, setCommentOpen] = useState(false)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [proofingOpen, setProofingOpen] = useState(false)
  const [commentDraft, setCommentDraft] = useState('')
  const [conflictRevision, setConflictRevision] = useState<number>()
  const [revisionsOpen, setRevisionsOpen] = useState(false)
  const [revisions, setRevisions] = useState<NovelRevision[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const generationRef = useRef<string | null>(null)
  const suggestionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const suggestionSavingRef = useRef<Promise<void> | null>(null)
  const suggestionPersistedHashesRef = useRef<Record<string, string>>({})
  const projectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const projectVersionRef = useRef(0)
  const projectPersistedVersionRef = useRef(0)
  const projectSavingRef = useRef<Promise<void> | null>(null)
  const requestedUnitIdRef = useRef(unitId)
  const bundleRef = useRef<NovelProjectBundle | null>(null)
  const activeUnitRef = useRef<ManuscriptUnit | null>(null)
  const suggestionsRef = useRef<AiSuggestion[]>([])
  const metadataTimersRef = useRef<
    Partial<Record<MetadataKey, ReturnType<typeof setTimeout>>>
  >({})
  const metadataVersionsRef = useRef<Record<MetadataKey, number>>({
    characters: 0,
    relationships: 0,
    outline: 0,
    clues: 0,
  })
  const metadataPersistedVersionsRef = useRef<Record<MetadataKey, number>>({
    characters: 0,
    relationships: 0,
    outline: 0,
    clues: 0,
  })
  const metadataSavingRef = useRef<Partial<Record<MetadataKey, Promise<void>>>>(
    {}
  )

  const novelService = serviceHub.novels()
  const windowService = serviceHub.window()
  requestedUnitIdRef.current = unitId
  activeUnitRef.current = activeUnit
  suggestionsRef.current = suggestions

  const persistSuggestions = useCallback(
    async (targetUnitId: string, items: AiSuggestion[]) => {
      if (generatingSuggestions(items)) return
      const requestedHash = suggestionsHash(items)
      if (
        suggestionPersistedHashesRef.current[targetUnitId] === requestedHash
      ) {
        return
      }

      while (suggestionSavingRef.current) {
        await suggestionSavingRef.current
      }
      if (
        suggestionPersistedHashesRef.current[targetUnitId] === requestedHash
      ) {
        return
      }

      const current = bundleRef.current
      if (!current || current.project.id !== novelId) return
      const request = novelService
        .saveSuggestions({
          novelId,
          unitId: targetUnitId,
          items,
          expectedRevision: current.suggestions.revision,
        })
        .then((saved) => {
          const latest = bundleRef.current
          if (!latest || latest.project.id !== novelId) return
          suggestionPersistedHashesRef.current[targetUnitId] = suggestionsHash(
            suggestionsForUnit(saved.items, targetUnitId)
          )
          const next = { ...latest, suggestions: saved }
          bundleRef.current = next
          setBundle(next)
        })
        .catch((error) => {
          toast.error(
            error instanceof Error ? error.message : '候选记录保存失败'
          )
          throw error
        })
        .finally(() => {
          suggestionSavingRef.current = null
        })
      suggestionSavingRef.current = request
      await request

      const latestItems =
        activeUnitRef.current?.id === targetUnitId
          ? suggestionsRef.current
          : suggestionsForUnit(
              bundleRef.current?.suggestions.items ?? [],
              targetUnitId
            )
      if (
        !generatingSuggestions(latestItems) &&
        suggestionPersistedHashesRef.current[targetUnitId] !==
          suggestionsHash(latestItems)
      ) {
        await persistSuggestions(targetUnitId, latestItems)
      }
    },
    [novelId, novelService]
  )

  useEffect(() => {
    bundleRef.current = bundle
  }, [bundle])

  useEffect(() => {
    let canceled = false
    setLoading(true)
    setLoadError(undefined)
    novelService
      .openProject(novelId)
      .then((loaded) => {
        if (canceled) return
        bundleRef.current = loaded
        metadataVersionsRef.current = {
          characters: 0,
          relationships: 0,
          outline: 0,
          clues: 0,
        }
        metadataPersistedVersionsRef.current = {
          characters: 0,
          relationships: 0,
          outline: 0,
          clues: 0,
        }
        projectVersionRef.current = 0
        projectPersistedVersionRef.current = 0
        suggestionPersistedHashesRef.current = Object.fromEntries(
          loaded.units.map((unit) => [
            unit.id,
            suggestionsHash(
              suggestionsForUnit(loaded.suggestions.items, unit.id)
            ),
          ])
        )
        setBundle(loaded)
        const selectedUnit =
          loaded.units.find((unit) => unit.id === requestedUnitIdRef.current) ??
          loaded.units.find(
            (unit) => unit.id === loaded.project.activeUnitId
          ) ??
          loaded.units[0] ??
          null
        setActiveUnit(selectedUnit)
        setSuggestions(
          selectedUnit
            ? loaded.suggestions.items.filter(
                (suggestion) => suggestion.unitId === selectedUnit.id
              )
            : []
        )
      })
      .catch((error) => {
        if (canceled) return
        const message = error instanceof Error ? error.message : '作品加载失败'
        setLoadError(message)
        toast.error(message)
      })
      .finally(() => !canceled && setLoading(false))
    return () => {
      canceled = true
      generationRef.current = null
      abortRef.current?.abort()
      if (suggestionTimerRef.current) {
        clearTimeout(suggestionTimerRef.current)
        suggestionTimerRef.current = null
      }
    }
  }, [novelId, novelService])

  useEffect(() => {
    if (!activeUnitId || generatingSuggestions(suggestions)) {
      return
    }
    if (bundleRef.current?.project.id !== novelId) {
      return
    }
    if (
      suggestionPersistedHashesRef.current[activeUnitId] ===
      suggestionsHash(suggestions)
    ) {
      return
    }
    if (suggestionTimerRef.current) clearTimeout(suggestionTimerRef.current)
    const timer = setTimeout(() => {
      if (suggestionTimerRef.current === timer) {
        suggestionTimerRef.current = null
      }
      if (activeUnitRef.current?.id !== activeUnitId) return
      void persistSuggestions(activeUnitId, suggestionsRef.current).catch(
        () => undefined
      )
    }, 750)
    suggestionTimerRef.current = timer
    return () => {
      clearTimeout(timer)
      if (suggestionTimerRef.current === timer) {
        suggestionTimerRef.current = null
      }
    }
  }, [activeUnitId, novelId, persistSuggestions, suggestions])

  const {
    state: autosaveState,
    schedule: scheduleAutosave,
    flush: flushAutosave,
    reset: resetAutosave,
    hasPending: hasPendingAutosave,
  } = useNovelAutosave({
    novelService,
    initialUnit:
      activeUnit ??
      ({
        id: unitId,
        novelId,
        revision: 0,
      } as ManuscriptUnit),
    onSaved: (saved) => {
      setActiveUnit((current) =>
        current?.id === saved.id
          ? { ...current, revision: saved.revision, updatedAt: saved.updatedAt }
          : current
      )
      const current = bundleRef.current
      if (current) {
        const next = {
          ...current,
          units: current.units.map((unit) =>
            unit.id === saved.id ? { ...unit, ...saved } : unit
          ),
        }
        bundleRef.current = next
        setBundle(next)
      }
    },
    onConflict: setConflictRevision,
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : '自动保存失败'),
  })
  useEffect(() => {
    if (activeUnit) resetAutosave(activeUnit)
    // reset only when switching units, not on revision-only state updates
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeUnitId])

  const flushProject = useCallback(async (): Promise<void> => {
    if (projectTimerRef.current) {
      clearTimeout(projectTimerRef.current)
      projectTimerRef.current = null
    }
    if (projectSavingRef.current) {
      await projectSavingRef.current
      if (projectPersistedVersionRef.current !== projectVersionRef.current) {
        await flushProject()
      }
      return
    }
    if (projectPersistedVersionRef.current === projectVersionRef.current) return
    const current = bundleRef.current
    if (!current) return
    const savingVersion = projectVersionRef.current
    const request = novelService
      .saveProject(current.project, current.project.revision)
      .then((saved) => {
        const latest = bundleRef.current
        if (!latest) return
        const project =
          projectVersionRef.current === savingVersion
            ? saved
            : {
                ...latest.project,
                revision: saved.revision,
                updatedAt: saved.updatedAt,
              }
        const next = { ...latest, project }
        bundleRef.current = next
        setBundle(next)
        projectPersistedVersionRef.current = savingVersion
      })
      .catch((error) => {
        toast.error(error instanceof Error ? error.message : '作品小传保存失败')
        throw error
      })
      .finally(() => {
        projectSavingRef.current = null
      })
    projectSavingRef.current = request
    await request
    if (projectPersistedVersionRef.current !== projectVersionRef.current) {
      await flushProject()
    }
  }, [novelService])

  const updateProjectSynopsis = useCallback(
    (synopsis: string) => {
      const current = bundleRef.current
      if (!current) return
      const next = {
        ...current,
        project: {
          ...current.project,
          synopsis,
          updatedAt: new Date().toISOString(),
        },
      }
      bundleRef.current = next
      setBundle(next)
      projectVersionRef.current += 1
      if (projectTimerRef.current) clearTimeout(projectTimerRef.current)
      projectTimerRef.current = setTimeout(() => {
        void flushProject().catch(() => undefined)
      }, 750)
    },
    [flushProject]
  )

  useEffect(
    () => () => {
      if (projectTimerRef.current) clearTimeout(projectTimerRef.current)
      void flushProject().catch(() => undefined)
    },
    [flushProject]
  )

  useEffect(() => {
    if (!focusMode) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' ||
        (event.metaKey && event.shiftKey && event.key.toLowerCase() === 'f')
      ) {
        event.preventDefault()
        setFocusMode(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    void windowService.setFullscreen(true)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      void windowService.setFullscreen(false)
    }
  }, [focusMode, windowService])

  const buildContext = useCallback(
    (anchor?: TextAnchor, selection?: string) => {
      if (!bundle || !activeUnit) return []
      const adjacent = bundle.units
        .filter(
          (unit) =>
            unit.id !== activeUnit.id &&
            Math.abs(unit.position - activeUnit.position) <= 1 &&
            unit.summary
        )
        .map<AiContextItem>((unit) => ({
          id: `unit-${unit.id}`,
          type: 'adjacent_summary',
          label: `${unit.title}摘要`,
          content: unit.summary,
          included: true,
        }))
      const characters = bundle.characters.items
        .slice(0, 4)
        .map<AiContextItem>((item) => ({
          id: `character-${item.id}`,
          type: 'character',
          label: item.name,
          content: `${item.name}：${item.personality}。${item.biography}`,
          included: true,
        }))
      const outline = bundle.outline.items
        .filter((item) => !item.unitId || item.unitId === activeUnit.id)
        .sort((left, right) => Number(right.locked) - Number(left.locked))
        .slice(0, 3)
        .map<AiContextItem>((item) => ({
          id: `outline-${item.id}`,
          type: 'outline',
          label: `${item.locked ? '锁定约束 · ' : ''}${item.title}`,
          content: [
            item.locked ? '【不可偏离的作者约束】' : '',
            item.intent ? `创作意图：${item.intent}` : '',
            item.summary,
          ]
            .filter(Boolean)
            .join('\n'),
          included: true,
        }))
      const clues = bundle.clues.items
        .filter((item) => item.status !== 'resolved')
        .slice(0, 3)
        .map<AiContextItem>((item) => ({
          id: `clue-${item.id}`,
          type: 'clue',
          label: `未回收：${item.title}`,
          content: item.description,
          included: true,
        }))
      const currentExcerpt = isLiveEditor(editor)
        ? editor.getText().slice(-4000).trim()
        : ''
      const projectSynopsis = bundle.project.synopsis.trim()
      return [
        ...(selection && anchor
          ? [
              {
                id: 'selection',
                type: 'selection' as const,
                label: '当前选区',
                content: selection,
                included: true,
              },
            ]
          : []),
        ...(projectSynopsis
          ? [
              {
                id: 'project-synopsis',
                type: 'outline' as const,
                label: '作品小传 · 核心意图',
                content: projectSynopsis,
                included: true,
              },
            ]
          : []),
        ...(currentExcerpt
          ? [
              {
                id: 'current-unit-excerpt',
                type: 'style_sample' as const,
                label: `${activeUnit.title} · 当前章尾`,
                content: currentExcerpt,
                included: true,
              },
            ]
          : []),
        ...adjacent,
        ...characters,
        ...outline,
        ...clues,
      ]
    },
    [activeUnit, bundle, editor]
  )

  const captureSelection = useCallback(async () => {
    if (!isLiveEditor(editor) || !activeUnit) return null
    const result = await selectionToTextAnchor(editor, activeUnit.id)
    if (!result) return null
    setActiveAnchor(result.anchor)
    setSelectedText(result.selectedText)
    setContextItems(buildContext(result.anchor, result.selectedText))
    setInspectorOpen(true)
    return result
  }, [activeUnit, buildContext, editor])

  const clearAiTarget = useCallback(() => {
    setActiveAnchor(undefined)
    setSelectedText('')
    setContextItems([])
  }, [])

  const addSelectionToSynopsis = useCallback(async () => {
    if (!activeUnit || !isLiveEditor(editor)) return
    const selection = await selectionToTextAnchor(editor, activeUnit.id)
    if (!selection) {
      toast.error('请先划选要加入作品小传的正文')
      return
    }
    const current = bundleRef.current
    if (!current) return
    const synopsis = [
      current.project.synopsis.trim(),
      selection.selectedText.trim(),
    ]
      .filter(Boolean)
      .join('\n\n')
    try {
      updateProjectSynopsis(synopsis)
      await flushProject()
      toast.success('选区已加入作品小传')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '作品小传保存失败')
    }
  }, [activeUnit, editor, flushProject, updateProjectSynopsis])

  const generateCandidates = useCallback(
    async (forcedMode?: AiSuggestion['mode']) => {
      if (!activeUnit || !isLiveEditor(editor)) return
      let anchor: TextAnchor | undefined = activeAnchor
      let selection = selectedText
      if (anchor && !(await validateTextAnchor(editor, anchor))) {
        clearAiTarget()
        anchor = undefined
        selection = ''
      }
      if (!anchor && !editor.state.selection.empty) {
        const captured = await captureSelection()
        anchor = captured?.anchor
        selection = captured?.selectedText ?? ''
      }
      if (!anchor && editor.state.selection.empty) {
        const cursorAnchor = await cursorToTextAnchor(editor, activeUnit.id)
        if (!cursorAnchor) {
          toast.error('请把光标放在一个正文段落中再续写')
          return
        }
        anchor = cursorAnchor
      }
      if (forcedMode === 'proofread' && !selection) {
        toast.error('请先划选需要深度校对的正文')
        return
      }
      const mode = forcedMode ?? (selection ? 'rewrite' : 'continue')
      let context = reusableNovelContext(
        contextItems.length ? contextItems : buildContext(anchor, selection),
        mode
      )
      if (mode === 'continue' && anchor) {
        const resolved = resolveTextAnchor(editor.state.doc, anchor)
        if (!resolved.valid) {
          toast.error('续写位置已经变化，请重新放置光标')
          return
        }
        const textBeforeCursor = editor.state.doc.textBetween(
          Math.max(0, resolved.from - 2000),
          resolved.from,
          '\n',
          '\n'
        )
        const textAfterCursor = editor.state.doc.textBetween(
          resolved.to,
          Math.min(editor.state.doc.content.size, resolved.to + 1000),
          '\n',
          '\n'
        )
        context = [
          {
            id: 'continuation-boundary',
            type: 'selection',
            label: '续写光标附近',
            content: [
              '<cursor_before>',
              textBeforeCursor,
              '</cursor_before>',
              '<cursor_after>',
              textAfterCursor,
              '</cursor_after>',
            ].join('\n'),
            included: true,
          },
          ...context.filter((item) => item.id !== 'current-unit-excerpt'),
        ]
      }
      setContextItems(context)
      const now = new Date().toISOString()
      const slots: AiSuggestion[] = Array.from(
        { length: 3 },
        (_, candidateIndex) => ({
          id: crypto.randomUUID(),
          unitId: activeUnit.id,
          anchor,
          mode,
          candidateIndex,
          instruction,
          content: '',
          status: 'streaming',
          favorite: false,
          stale: false,
          context,
          createdAt: now,
        })
      )
      const generationId = crypto.randomUUID()
      generationRef.current = generationId
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      setSuggestions(slots)
      try {
        await runNovelCandidateStreams({
          mode,
          instruction,
          selection,
          context: context.filter((item) => item.included),
          signal: controller.signal,
          onDelta: (index, delta) => {
            const slotId = slots[index]?.id
            if (!slotId || generationRef.current !== generationId) return
            setSuggestions((current) =>
              current.map((item) =>
                item.id === slotId
                  ? { ...item, content: item.content + delta }
                  : item
              )
            )
          },
          onStatus: (index, status, error) => {
            const slotId = slots[index]?.id
            if (!slotId || generationRef.current !== generationId) return
            setSuggestions((current) =>
              current.map((item) =>
                item.id === slotId ? { ...item, status, error } : item
              )
            )
          },
        })
      } catch (error) {
        if (
          generationRef.current === generationId &&
          !controller.signal.aborted
        ) {
          toast.error(error instanceof Error ? error.message : '生成失败')
        }
      } finally {
        if (generationRef.current === generationId) {
          abortRef.current = null
        }
      }
    },
    [
      activeAnchor,
      activeUnit,
      buildContext,
      captureSelection,
      clearAiTarget,
      contextItems,
      editor,
      instruction,
      selectedText,
    ]
  )

  const generating = suggestions.some((item) => item.status === 'streaming')

  const applySuggestion = async (suggestion: AiSuggestion) => {
    if (!activeUnit || !isLiveEditor(editor)) return
    if (
      suggestion.unitId !== activeUnit.id ||
      (suggestion.anchor && suggestion.anchor.unitId !== activeUnit.id)
    ) {
      setSuggestions((items) =>
        items.map((item) =>
          item.id === suggestion.id ? { ...item, stale: true } : item
        )
      )
      toast.error('这个候选属于其他章节，不能应用到当前正文')
      return
    }
    if (!suggestion.anchor) {
      setSuggestions((items) =>
        items.map((item) =>
          item.id === suggestion.id ? { ...item, stale: true } : item
        )
      )
      toast.error('这个旧候选没有稳定写作位置，请重新生成')
      return
    }
    if (suggestion.anchor) {
      const valid = await validateTextAnchor(editor, suggestion.anchor)
      if (!valid) {
        setSuggestions((items) =>
          items.map((item) =>
            item.id === suggestion.id ? { ...item, stale: true } : item
          )
        )
        toast.error('正文已经变化，这个候选已过期，请重新生成')
        return
      }
      const applied = await replaceTextAnchor(
        editor,
        suggestion.anchor,
        suggestion.content
      )
      if (!applied) return
    }
    setSuggestions((items) =>
      items.map((item) =>
        item.id === suggestion.id
          ? { ...item, status: 'applied', appliedAt: new Date().toISOString() }
          : item
      )
    )
    toast.success('候选已作为一次可撤销修改应用')
    clearAiTarget()
  }

  const flushMetadata = useCallback(
    async (key: MetadataKey): Promise<void> => {
      const timer = metadataTimersRef.current[key]
      if (timer) {
        clearTimeout(timer)
        metadataTimersRef.current[key] = undefined
      }
      const inFlight = metadataSavingRef.current[key]
      if (inFlight) {
        await inFlight
        if (
          metadataPersistedVersionsRef.current[key] !==
          metadataVersionsRef.current[key]
        ) {
          await flushMetadata(key)
        }
        return
      }
      if (
        metadataPersistedVersionsRef.current[key] ===
        metadataVersionsRef.current[key]
      ) {
        return
      }
      const current = bundleRef.current
      if (!current) return
      const savingVersion = metadataVersionsRef.current[key]
      let succeeded = false

      const request = (async () => {
        try {
          if (key === 'characters') {
            const saved = await novelService.saveCharacters({
              novelId,
              items: current.characters.items,
              expectedRevision: current.characters.revision,
            })
            const latest = bundleRef.current
            if (latest) {
              const next = {
                ...latest,
                characters: { ...saved, items: latest.characters.items },
              }
              bundleRef.current = next
              setBundle(next)
            }
          } else if (key === 'relationships') {
            const saved = await novelService.saveRelationships({
              novelId,
              items: current.relationships.items,
              expectedRevision: current.relationships.revision,
            })
            const latest = bundleRef.current
            if (latest) {
              const next = {
                ...latest,
                relationships: { ...saved, items: latest.relationships.items },
              }
              bundleRef.current = next
              setBundle(next)
            }
          } else if (key === 'outline') {
            const saved = await novelService.saveOutline({
              novelId,
              items: current.outline.items,
              expectedRevision: current.outline.revision,
            })
            const latest = bundleRef.current
            if (latest) {
              const next = {
                ...latest,
                outline: { ...saved, items: latest.outline.items },
              }
              bundleRef.current = next
              setBundle(next)
            }
          } else {
            const saved = await novelService.saveClues({
              novelId,
              items: current.clues.items,
              expectedRevision: current.clues.revision,
            })
            const latest = bundleRef.current
            if (latest) {
              const next = {
                ...latest,
                clues: { ...saved, items: latest.clues.items },
              }
              bundleRef.current = next
              setBundle(next)
            }
          }
          succeeded = true
        } catch (error) {
          toast.error(error instanceof Error ? error.message : '资料保存失败')
          throw error
        }
      })()
      metadataSavingRef.current[key] = request
      try {
        await request
      } finally {
        if (metadataSavingRef.current[key] === request) {
          metadataSavingRef.current[key] = undefined
        }
      }
      if (succeeded) {
        metadataPersistedVersionsRef.current[key] = savingVersion
      }

      if (succeeded && metadataVersionsRef.current[key] !== savingVersion) {
        await flushMetadata(key)
      }
    },
    [novelId, novelService]
  )

  const updateCollection = (key: MetadataKey, items: MetadataItems) => {
    const current = bundleRef.current
    if (!current) return
    let next: NovelProjectBundle
    if (key === 'characters') {
      next = {
        ...current,
        characters: {
          ...current.characters,
          items: items as Character[],
          updatedAt: new Date().toISOString(),
        },
      }
    } else if (key === 'relationships') {
      next = {
        ...current,
        relationships: {
          ...current.relationships,
          items: items as Relationship[],
          updatedAt: new Date().toISOString(),
        },
      }
    } else if (key === 'outline') {
      next = {
        ...current,
        outline: {
          ...current.outline,
          items: items as OutlineNode[],
          updatedAt: new Date().toISOString(),
        },
      }
    } else {
      next = {
        ...current,
        clues: {
          ...current.clues,
          items: items as Clue[],
          updatedAt: new Date().toISOString(),
        },
      }
    }
    bundleRef.current = next
    setBundle(next)
    metadataVersionsRef.current[key] += 1
    const timer = metadataTimersRef.current[key]
    if (timer) clearTimeout(timer)
    metadataTimersRef.current[key] = setTimeout(() => {
      void flushMetadata(key).catch(() => undefined)
    }, 750)
  }

  const generateCharacterAvatar = useCallback(
    async (character: Character) => {
      const selected = getImageModels(imageProviders)[0]
      if (!selected) {
        const error = new Error('请先在模型设置中配置一个可用的图片生成模型')
        toast.error(error.message)
        throw error
      }
      const prompt = [
        '原创东方玄幻小说人物设定图，单人半身肖像，干净中性背景，无文字，无水印。',
        `人物：${character.name}，${character.gender}，${character.age}，${character.ethnicity}。`,
        `身材：${character.body}。外貌：${character.appearance}。`,
        `性格与气质：${character.personality}。`,
        `人物经历：${character.biography}`,
        '画面用于作者构思参考，保持原创，不模仿现成影视或动漫 IP。',
      ].join('\n')
      try {
        const [image] = await serviceHub.imageGeneration().generateImages({
          provider: selected.provider,
          model: selected.model,
          prompt,
          ratio: '1:1',
          qualityPreset: 'sd',
          count: 1,
          mode: 'generate',
        })
        if (!image) throw new Error('图片模型没有返回结果')
        const asset = await serviceHub.imageGeneration().saveAsset({
          id: crypto.randomUUID(),
          prompt,
          mode: 'generate',
          provider: selected.provider.provider,
          model: selected.model.id,
          ratio: '1:1',
          size: imageSizeForRatio('1:1', selected.model.id),
          quality: apiQualityForPreset('sd', selected.model.id),
          sourceAssetIds: [],
          revisedPrompt: image.revisedPrompt,
          usage: image.usage,
          status: 'succeeded',
          mimeType: image.mimeType,
          b64Json: image.b64Json,
          extension: imageFileExtension(image.mimeType),
          assetKind: 'generated',
        })
        toast.success(`${character.name}的人物示意图已生成`)
        return asset.path || `data:${image.mimeType};base64,${image.b64Json}`
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : '人物示意图生成失败'
        )
        throw error
      }
    },
    [imageProviders, serviceHub]
  )

  const flushAllMetadata = useCallback(
    () => Promise.all(metadataKeys.map((key) => flushMetadata(key))),
    [flushMetadata]
  )

  useEffect(
    () => () => {
      for (const key of metadataKeys) {
        const timer = metadataTimersRef.current[key]
        if (timer) clearTimeout(timer)
        void flushMetadata(key).catch(() => undefined)
      }
    },
    [flushMetadata]
  )

  const flushBeforeUnitChange = useCallback(async () => {
    generationRef.current = null
    abortRef.current?.abort()
    const currentSuggestions = suggestionsRef.current
    const currentUnit = activeUnitRef.current
    const settledSuggestions = currentSuggestions.map((suggestion) =>
      suggestion.status === 'streaming'
        ? { ...suggestion, status: 'stopped' as const }
        : suggestion
    )
    if (suggestionTimerRef.current) {
      clearTimeout(suggestionTimerRef.current)
      suggestionTimerRef.current = null
    }
    suggestionsRef.current = settledSuggestions
    setSuggestions(settledSuggestions)
    await Promise.all([
      flushAutosave(),
      flushProject(),
      flushAllMetadata(),
      currentUnit
        ? persistSuggestions(currentUnit.id, settledSuggestions)
        : Promise.resolve(),
    ])
  }, [
    flushAllMetadata,
    flushAutosave,
    flushProject,
    persistSuggestions,
  ])

  const hasPendingNovelWrites = useCallback(
    () => {
      const suggestionUnit = activeUnitRef.current
      const suggestionsDirty = Boolean(
        suggestionUnit &&
          suggestionUnit.novelId === novelId &&
          suggestionPersistedHashesRef.current[suggestionUnit.id] !==
            suggestionsHash(suggestionsRef.current)
      )
      return (
        hasPendingAutosave() ||
        generatingSuggestions(suggestionsRef.current) ||
        suggestionsDirty ||
        Boolean(suggestionTimerRef.current || suggestionSavingRef.current) ||
        projectVersionRef.current !== projectPersistedVersionRef.current ||
        Boolean(projectTimerRef.current || projectSavingRef.current) ||
        metadataKeys.some(
          (key) =>
            metadataVersionsRef.current[key] !==
              metadataPersistedVersionsRef.current[key] ||
            Boolean(
              metadataTimersRef.current[key] || metadataSavingRef.current[key]
            )
        )
      )
    },
    [hasPendingAutosave, novelId]
  )

  useNovelExitGuard({
    windowService,
    flush: flushBeforeUnitChange,
    hasPendingWrites: hasPendingNovelWrites,
    onFailure: reportTransitionFailure,
  })

  useEffect(() => {
    const current = bundleRef.current
    if (!current || current.project.id !== novelId) return
    const selected = current.units.find((unit) => unit.id === unitId)
    if (!selected || selected.id === activeUnitId) return
    const nextSuggestions = suggestionsForUnit(
      current.suggestions.items,
      selected.id
    )
    activeUnitRef.current = selected
    suggestionsRef.current = nextSuggestions
    setActiveUnit(selected)
    resetAutosave(selected)
    setSelectedText('')
    setActiveAnchor(undefined)
    setContextItems([])
    setSuggestions(nextSuggestions)
  }, [
    activeUnitId,
    novelId,
    resetAutosave,
    unitId,
  ])

  const createComment = async () => {
    if (!activeAnchor || !commentDraft.trim() || !bundle) return
    const now = new Date().toISOString()
    const thread: CommentThread = {
      id: crypto.randomUUID(),
      anchors: [activeAnchor],
      messages: [
        {
          id: crypto.randomUUID(),
          author: 'user',
          content: commentDraft.trim(),
          createdAt: now,
        },
      ],
      status: 'open',
      createdAt: now,
      updatedAt: now,
    }
    try {
      const saved = await novelService.saveComments({
        novelId,
        items: [...bundle.comments.items, thread],
        expectedRevision: bundle.comments.revision,
      })
      const next = { ...bundle, comments: saved }
      bundleRef.current = next
      setBundle(next)
      if (isLiveEditor(editor)) {
        const resolved = resolveTextAnchor(editor.state.doc, activeAnchor)
        if (resolved.valid) {
          editor
            .chain()
            .focus()
            .setTextSelection({ from: resolved.from, to: resolved.to })
            .setCommentAnchor(thread.id)
            .run()
        }
      }
      setCommentOpen(false)
      setCommentDraft('')
      toast.success('评论已添加')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '评论保存失败')
    }
  }

  const resolveComment = async (thread: CommentThread) => {
    const current = bundleRef.current
    if (!current) return
    const now = new Date().toISOString()
    const items = current.comments.items.map((item) =>
      item.id === thread.id
        ? { ...item, status: 'resolved' as const, updatedAt: now }
        : item
    )
    try {
      const saved = await novelService.saveComments({
        novelId,
        items,
        expectedRevision: current.comments.revision,
      })
      setBundle((latest) => {
        if (!latest) return latest
        const next = { ...latest, comments: saved }
        bundleRef.current = next
        return next
      })
      const anchor = thread.anchors[0]
      if (isLiveEditor(editor) && anchor) {
        const resolved = resolveTextAnchor(editor.state.doc, anchor)
        if (resolved.valid) {
          editor
            .chain()
            .focus()
            .setTextSelection({ from: resolved.from, to: resolved.to })
            .unsetCommentAnchor()
            .run()
        }
      }
      toast.success('评论已解决')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '评论更新失败')
    }
  }

  const createUnit = async () => {
    try {
      await flushBeforeUnitChange()
    } catch (error) {
      reportTransitionFailure(error, '新建章节')
      return
    }
    const current = bundleRef.current
    if (!current) return
    const now = new Date().toISOString()
    const isScreenplay = current.project.kind === 'screenplay'
    const bodyUnits = current.units.filter((unit) =>
      isScreenplay ? unit.kind === 'scene' : unit.kind === 'chapter'
    )
    const nextUnit: ManuscriptUnit = {
      schemaVersion: 1,
      id: crypto.randomUUID(),
      novelId,
      kind: isScreenplay ? 'scene' : 'chapter',
      title: isScreenplay
        ? `场景 ${bodyUnits.length + 1}`
        : `第${bodyUnits.length + 1}章`,
      position:
        current.units.reduce((max, unit) => Math.max(max, unit.position), -1) +
        1,
      summary: '',
      goal: '',
      wordCount: 0,
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
      revision: 0,
      createdAt: now,
      updatedAt: now,
    }
    try {
      const saved = await novelService.saveManuscriptUnit({
        novelId,
        unit: nextUnit,
        expectedRevision: 0,
      })
      const nextBundle = {
        ...current,
        project: {
          ...current.project,
          activeUnitId: saved.id,
          unitOrder: current.project.unitOrder.includes(saved.id)
            ? current.project.unitOrder
            : [...current.project.unitOrder, saved.id],
        },
        units: [...current.units, saved],
      }
      bundleRef.current = nextBundle
      activeUnitRef.current = saved
      suggestionsRef.current = []
      suggestionPersistedHashesRef.current[saved.id] = suggestionsHash([])
      setBundle(nextBundle)
      setActiveUnit(saved)
      resetAutosave(saved)
      setSuggestions([])
      setSelectedText('')
      setActiveAnchor(undefined)
      await navigate({
        to: route.novels.detail as never,
        params: { novelId, unitId: saved.id } as never,
        replace: true,
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '新建章节失败')
    }
  }

  const openRevisions = async () => {
    if (!activeUnit) return
    setRevisionsOpen(true)
    try {
      setRevisions(await novelService.listRevisions(novelId, activeUnit.id))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '版本列表加载失败')
    }
  }

  const exportProject = async (format: NovelExportInput['format']) => {
    try {
      await flushBeforeUnitChange()
      const result = await novelService.exportProject({
        novelId,
        format,
      })
      const blob = new Blob([result.content], { type: result.mimeType })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = result.fileName
      link.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '导出失败')
    }
  }

  const exportCurrentDraft = () => {
    const content = isLiveEditor(editor)
      ? (editor.getJSON() as ManuscriptUnit['content'])
      : activeUnit?.content
    if (!activeUnit || !content) return
    const payload = JSON.stringify(
      {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        reason: 'revision_conflict',
        novelId,
        unit: { ...activeUnit, content },
      },
      null,
      2
    )
    const blob = new Blob([payload], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const safeTitle = activeUnit.title.replace(/[\\/:*?"<>|]/g, '-').trim()
    link.href = url
    link.download = `${safeTitle || '未命名章节'}-本地冲突稿.json`
    link.click()
    URL.revokeObjectURL(url)
    toast.success('本地冲突稿已导出，不会读取或覆盖磁盘版本')
  }

  const restoreRevision = async (revision: NovelRevision) => {
    const targetUnitId = activeUnitRef.current?.id
    if (!targetUnitId) return
    try {
      await flushBeforeUnitChange()
      const currentUnit = bundleRef.current?.units.find(
        (unit) => unit.id === targetUnitId
      )
      if (!currentUnit) throw new Error('当前章节已经不可用')
      const restored = await novelService.restoreRevision(
        novelId,
        targetUnitId,
        revision.id,
        currentUnit.revision
      )
      const current = bundleRef.current
      if (!current) return
      const next = {
        ...current,
        units: current.units.map((unit) =>
          unit.id === restored.id ? restored : unit
        ),
      }
      bundleRef.current = next
      activeUnitRef.current = restored
      setBundle(next)
      setActiveUnit(restored)
      resetAutosave(restored)
      setRevisionsOpen(false)
      toast.success('版本已恢复')
    } catch (error) {
      reportTransitionFailure(error, '恢复版本')
    }
  }

  if (loadError && (!bundle || !activeUnit)) {
    return (
      <div className="flex h-svh flex-col items-center justify-center gap-4 px-6 text-center">
        <BookOpenText className="size-8 text-muted-foreground" />
        <div>
          <h1 className="font-studio text-lg font-semibold">
            无法打开这个作品
          </h1>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            {loadError}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => void navigate({ to: route.novels.index as never })}
          >
            返回作品库
          </Button>
          <Button onClick={() => window.location.reload()}>重新加载</Button>
        </div>
      </div>
    )
  }

  if (loading || !bundle || !activeUnit) {
    return (
      <div className="flex h-svh items-center justify-center text-sm text-muted-foreground">
        <LoaderCircle className="mr-2 size-4 animate-spin" /> 正在打开作品
      </div>
    )
  }

  const proofingIssues = proofNovelText(
    isLiveEditor(editor) ? editor.getText() : ''
  )
  const saveLabel =
    autosaveState === 'saving'
      ? '正在保存'
      : autosaveState === 'dirty'
        ? '等待保存'
        : autosaveState === 'conflict'
          ? '保存冲突'
          : autosaveState === 'error'
            ? '保存失败'
            : '已保存'

  const workspace = (
    <div
      className={cn(
        'flex h-svh min-w-0 flex-col overflow-hidden bg-background',
        focusMode && 'novel-focus-enter'
      )}
    >
      <header className="relative z-20 flex h-14 shrink-0 items-center gap-3 border-b bg-background/92 px-3 backdrop-blur sm:px-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Input
              value={activeUnit.title}
              onChange={(event) => {
                const next = { ...activeUnit, title: event.target.value }
                setActiveUnit(next)
                setBundle((current) =>
                  current
                    ? {
                        ...current,
                        units: current.units.map((unit) =>
                          unit.id === next.id ? next : unit
                        ),
                      }
                    : current
                )
                scheduleAutosave(next)
              }}
              className="h-7 max-w-72 border-0 bg-transparent px-0 font-studio text-sm font-semibold shadow-none focus-visible:ring-0"
            />
            <span className="hidden items-center gap-1 text-[10px] text-muted-foreground sm:inline-flex">
              {autosaveState === 'saving' ? (
                <LoaderCircle className="size-3 animate-spin" />
              ) : (
                <Save className="size-3" />
              )}
              {saveLabel}
            </span>
          </div>
          <div className="mt-0.5 hidden text-[10px] text-muted-foreground md:block">
            {activeUnit.wordCount.toLocaleString()} 字 · revision{' '}
            {activeUnit.revision}
          </div>
        </div>

        {!focusMode && (
          <nav className="hidden items-center gap-0.5 rounded-full border bg-muted/20 p-1 lg:flex">
            {tabItems.map((item) => {
              const Icon = item.icon
              return (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => setTab(item.id)}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] transition',
                    tab === item.id
                      ? 'bg-background text-foreground shadow-xs'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <Icon className="size-3" /> {item.label}
                </button>
              )
            })}
          </nav>
        )}

        <div className="flex items-center gap-0.5">
          {!focusMode && (
            <>
              {proofingIssues.length > 0 && (
                <button
                  type="button"
                  onClick={() => setProofingOpen(true)}
                  className="hidden items-center gap-1 rounded-full bg-amber-500/10 px-2 py-1 text-[10px] text-amber-700 dark:text-amber-300 md:inline-flex"
                  title={proofingIssues[0]?.message}
                >
                  <SearchCheck className="size-3" /> {proofingIssues.length}{' '}
                  条本地提示
                </button>
              )}
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => setCommentsOpen(true)}
                aria-label="查看评论"
                className="relative"
              >
                <MessageSquareText />
                {bundle.comments.items.some(
                  (thread) =>
                    thread.status === 'open' &&
                    thread.anchors.some(
                      (anchor) => anchor.unitId === activeUnit.id
                    )
                ) && (
                  <span className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-primary" />
                )}
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => void openRevisions()}
                aria-label="版本历史"
              >
                <History />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="导出作品"
                  >
                    <Download />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() => void exportProject('biyan-novel')}
                  >
                    彼岩工程包（.biyan-novel）
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => void exportProject('markdown')}
                  >
                    Markdown（.md）
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => void exportProject('txt')}
                  >
                    纯文本（.txt）
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
          {!focusMode && tab === 'write' && (
            <Button
              size="icon-sm"
              variant="ghost"
              className="min-[1100px]:hidden"
              onClick={() => setInspectorOpen(true)}
              aria-label="打开 AI 检查器"
            >
              <PanelRight />
            </Button>
          )}
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => setFocusMode((value) => !value)}
            aria-label={focusMode ? '退出勿扰模式' : '进入勿扰模式'}
          >
            {focusMode ? <X /> : <Maximize2 />}
          </Button>
        </div>
      </header>

      {focusMode ? (
        <div className="relative min-h-0 flex-1">
          <ManuscriptEditor
            content={activeUnit.content}
            onReady={setEditor}
            onChange={(content, wordCount) => {
              const next = {
                ...activeUnit,
                content,
                wordCount,
                updatedAt: new Date().toISOString(),
              }
              setActiveUnit(next)
              scheduleAutosave(next)
            }}
            onTuneSelection={() => void captureSelection()}
            onCommentSelection={() =>
              void captureSelection().then(
                (selection) => selection && setCommentOpen(true)
              )
            }
            onAddToSynopsis={() => void addSelectionToSynopsis()}
            onBlur={() => void flushAutosave().catch(() => undefined)}
          />
          <div className="pointer-events-none absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full border bg-background/85 px-4 py-2 text-[10px] text-muted-foreground shadow-lg backdrop-blur">
            <Expand className="size-3" /> 勿扰写作 · Esc 或 ⌘⇧F 退出 ·{' '}
            {activeUnit.wordCount.toLocaleString()} 字
          </div>
        </div>
      ) : (
        <div
          className={cn(
            'grid min-h-0 flex-1 grid-cols-[210px_minmax(0,1fr)]',
            tab === 'write'
              ? 'min-[1100px]:grid-cols-[224px_minmax(360px,1fr)_304px]'
              : 'min-[1100px]:grid-cols-[224px_minmax(0,1fr)]'
          )}
        >
          <ChapterTree
            project={bundle.project}
            units={bundle.units}
            activeUnitId={activeUnit.id}
            onSwitchProject={() => {
              void navigate({ to: route.novels.index as never }).catch(
                (error) => reportTransitionFailure(error, '切换作品')
              )
            }}
            onCreateUnit={() => void createUnit()}
            onSelect={(unit) => {
              void navigate({
                to: route.novels.detail as never,
                params: { novelId, unitId: unit.id } as never,
                replace: true,
              }).catch((error) => reportTransitionFailure(error, '切换章节'))
            }}
          />

          <section className="min-w-0 bg-background">
            {tab === 'write' ? (
              <ManuscriptEditor
                content={activeUnit.content}
                onReady={setEditor}
                onChange={(content, wordCount) => {
                  const next = {
                    ...activeUnit,
                    content,
                    wordCount,
                    updatedAt: new Date().toISOString(),
                  }
                  setActiveUnit(next)
                  setBundle((current) =>
                    current
                      ? {
                          ...current,
                          units: current.units.map((unit) =>
                            unit.id === next.id ? next : unit
                          ),
                        }
                      : current
                  )
                  scheduleAutosave(next)
                }}
                onTuneSelection={() => void captureSelection()}
                onCommentSelection={() =>
                  void captureSelection().then(
                    (selection) => selection && setCommentOpen(true)
                  )
                }
                onAddToSynopsis={() => void addSelectionToSynopsis()}
                onBlur={() => void flushAutosave().catch(() => undefined)}
              />
            ) : (
              <NovelAssets
                tab={tab}
                characters={bundle.characters.items}
                relationships={bundle.relationships.items}
                outline={bundle.outline.items}
                clues={bundle.clues.items}
                units={bundle.units}
                synopsis={bundle.project.synopsis}
                onSynopsisChange={updateProjectSynopsis}
                onCharactersChange={(items) =>
                  updateCollection('characters', items)
                }
                onRelationshipsChange={(items) =>
                  updateCollection('relationships', items)
                }
                onOutlineChange={(items) => updateCollection('outline', items)}
                onCluesChange={(items) => updateCollection('clues', items)}
                onGenerateCharacterAvatar={generateCharacterAvatar}
                resolveAssetSrc={(source) =>
                  /^(data:|https?:)/i.test(source)
                    ? source
                    : serviceHub.core().convertFileSrc(source)
                }
              />
            )}
          </section>

          {tab === 'write' && (
            <div className="hidden min-h-0 min-[1100px]:block">
              <AiInspector
                instruction={instruction}
                onInstructionChange={setInstruction}
                contextItems={contextItems}
                onToggleContext={(id) =>
                  setContextItems((items) =>
                    items.map((item) =>
                      item.id === id
                        ? { ...item, included: !item.included }
                        : item
                    )
                  )
                }
                suggestions={suggestions}
                selectedText={selectedText}
                generating={generating}
                onGenerate={() => void generateCandidates()}
                onStop={() => abortRef.current?.abort()}
                onApply={(suggestion) => void applySuggestion(suggestion)}
                onReject={(suggestion) =>
                  setSuggestions((items) =>
                    items.map((item) =>
                      item.id === suggestion.id
                        ? { ...item, status: 'rejected' }
                        : item
                    )
                  )
                }
                onFavorite={(suggestion) =>
                  setSuggestions((items) =>
                    items.map((item) =>
                      item.id === suggestion.id
                        ? { ...item, favorite: !item.favorite }
                        : item
                    )
                  )
                }
              />
            </div>
          )}
        </div>
      )}
    </div>
  )

  return (
    <>
      {focusMode ? (
        <div className="fixed inset-0 z-[60] bg-background">{workspace}</div>
      ) : (
        workspace
      )}

      <Sheet open={inspectorOpen} onOpenChange={setInspectorOpen}>
        <SheetContent
          className="z-[70] w-[min(92vw,340px)] p-0"
          overlayClassName="z-[70]"
          side="right"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>AI 创作检查器</SheetTitle>
          </SheetHeader>
          <AiInspector
            instruction={instruction}
            onInstructionChange={setInstruction}
            contextItems={contextItems}
            onToggleContext={(id) =>
              setContextItems((items) =>
                items.map((item) =>
                  item.id === id ? { ...item, included: !item.included } : item
                )
              )
            }
            suggestions={suggestions}
            selectedText={selectedText}
            generating={generating}
            onGenerate={() => void generateCandidates()}
            onStop={() => abortRef.current?.abort()}
            onApply={(suggestion) => void applySuggestion(suggestion)}
            onReject={(suggestion) =>
              setSuggestions((items) =>
                items.map((item) =>
                  item.id === suggestion.id
                    ? { ...item, status: 'rejected' }
                    : item
                )
              )
            }
            onFavorite={(suggestion) =>
              setSuggestions((items) =>
                items.map((item) =>
                  item.id === suggestion.id
                    ? { ...item, favorite: !item.favorite }
                    : item
                )
              )
            }
          />
        </SheetContent>
      </Sheet>

      <Dialog open={commentOpen} onOpenChange={setCommentOpen}>
        <DialogContent
          className="z-[70] max-w-md rounded-xl"
          overlayClassName="z-[70]"
        >
          <DialogHeader>
            <DialogTitle>给选区添加评论</DialogTitle>
            <DialogDescription>
              {selectedText
                ? `“${selectedText.slice(0, 80)}${selectedText.length > 80 ? '…' : ''}”`
                : '当前选区'}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            autoFocus
            value={commentDraft}
            onChange={(event) => setCommentDraft(event.target.value)}
            placeholder="记录意图、问题，或给 AI 的修改方向"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCommentOpen(false)}>
              取消
            </Button>
            <Button onClick={() => void createComment()}>
              <MessageSquareText /> 添加评论
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={commentsOpen} onOpenChange={setCommentsOpen}>
        <DialogContent className="max-w-lg rounded-xl">
          <DialogHeader>
            <DialogTitle>本章评论</DialogTitle>
            <DialogDescription>
              评论保留作者意图；原文变化后无法定位的评论仍会作为孤立记录保存。
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {bundle.comments.items.filter((thread) =>
              thread.anchors.some((anchor) => anchor.unitId === activeUnit.id)
            ).length ? (
              bundle.comments.items
                .filter((thread) =>
                  thread.anchors.some(
                    (anchor) => anchor.unitId === activeUnit.id
                  )
                )
                .map((thread) => (
                  <div key={thread.id} className="rounded-xl border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm leading-5">
                        {thread.messages.at(-1)?.content || '空评论'}
                      </p>
                      <span
                        className={cn(
                          'shrink-0 rounded-full px-2 py-1 text-[10px]',
                          thread.status === 'open'
                            ? 'bg-primary/10 text-primary'
                            : 'bg-muted text-muted-foreground'
                        )}
                      >
                        {thread.status === 'open'
                          ? '待处理'
                          : thread.status === 'resolved'
                            ? '已解决'
                            : '已孤立'}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>
                        {new Date(thread.updatedAt).toLocaleString('zh-CN')}
                      </span>
                      {thread.status === 'open' && (
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => void resolveComment(thread)}
                        >
                          <Check /> 解决
                        </Button>
                      )}
                    </div>
                  </div>
                ))
            ) : (
              <div className="py-10 text-center text-sm text-muted-foreground">
                本章还没有评论
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={proofingOpen} onOpenChange={setProofingOpen}>
        <DialogContent className="max-w-lg rounded-xl">
          <DialogHeader>
            <DialogTitle>本地文字检查</DialogTitle>
            <DialogDescription>
              这些提示完全在本机确定性计算，不会上传正文，也不会自动修改。
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-72 space-y-2 overflow-y-auto">
            {proofingIssues.map((issue) => (
              <div key={issue.id} className="rounded-lg border p-3">
                <div className="flex items-center justify-between gap-3">
                  <strong className="text-sm">{issue.message}</strong>
                  <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                    {issue.source}
                    {issue.suggestion ? ` → ${issue.suggestion}` : ''}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProofingOpen(false)}>
              关闭
            </Button>
            <Button
              onClick={() => {
                setProofingOpen(false)
                setInstruction(
                  '只修正明确的错别字、标点与语病，保持情节、信息和文风不变。'
                )
                void generateCandidates('proofread')
              }}
            >
              <Sparkles /> 对当前选区深度校对
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={conflictRevision !== undefined}
        onOpenChange={(open) => !open && setConflictRevision(undefined)}
      >
        <DialogContent
          className="z-[70] max-w-md rounded-xl"
          overlayClassName="z-[70]"
        >
          <DialogHeader>
            <DialogTitle>检测到保存冲突</DialogTitle>
            <DialogDescription>
              磁盘上的正文已是 revision {conflictRevision}
              。为避免覆盖，当前改动没有被静默写入。
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
            可以重新载入磁盘版本，或先导出当前内容后再处理。
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={exportCurrentDraft}>
              导出本地冲突稿
            </Button>
            <Button onClick={() => window.location.reload()}>
              <Clock3 /> 载入磁盘版本
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={revisionsOpen} onOpenChange={setRevisionsOpen}>
        <DialogContent className="max-w-lg rounded-xl">
          <DialogHeader>
            <DialogTitle>版本历史</DialogTitle>
            <DialogDescription>
              恢复操作会先保留当前版本，并生成新的 revision。
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {revisions.length ? (
              revisions.map((revision) => (
                <div
                  key={revision.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div>
                    <strong className="text-sm">
                      Revision {revision.revision}
                    </strong>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {new Date(revision.createdAt).toLocaleString('zh-CN')} ·{' '}
                      {revision.wordCount} 字
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void restoreRevision(revision)}
                  >
                    <History /> 恢复
                  </Button>
                </div>
              ))
            ) : (
              <div className="py-10 text-center text-sm text-muted-foreground">
                还没有可恢复的版本
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
