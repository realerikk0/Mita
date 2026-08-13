import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  AiContextItem,
  AiSuggestion,
  ManuscriptUnit,
  NovelProjectBundle,
} from '@/types/novel'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openProject: vi.fn(),
  saveSuggestions: vi.fn(),
  flushAutosave: vi.fn(),
  resetAutosave: vi.fn(),
  hasPendingAutosave: vi.fn(() => false),
  exitOptions: undefined as
    | {
        flush: () => Promise<void>
        hasPendingWrites: () => boolean
      }
    | undefined,
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
}))

vi.mock('@/hooks/useNovelAutosave', () => ({
  useNovelAutosave: () => ({
    state: 'saved',
    schedule: vi.fn(),
    flush: mocks.flushAutosave,
    reset: mocks.resetAutosave,
    hasPending: mocks.hasPendingAutosave,
  }),
}))

vi.mock('@/hooks/useNovelExitGuard', () => ({
  useNovelExitGuard: (options: typeof mocks.exitOptions) => {
    mocks.exitOptions = options
  },
}))

vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: (selector: (state: { providers: never[] }) => unknown) =>
    selector({ providers: [] }),
}))

vi.mock('@/hooks/useServiceHub', () => {
  const novelService = {
    openProject: mocks.openProject,
    saveSuggestions: mocks.saveSuggestions,
  }
  const serviceHub = {
    novels: () => novelService,
    window: () => ({
      registerCloseGuard: vi.fn().mockResolvedValue(vi.fn()),
      setFullscreen: vi.fn().mockResolvedValue(undefined),
    }),
    imageGeneration: () => ({}),
    core: () => ({ convertFileSrc: (source: string) => source }),
  }
  return { useServiceHub: () => serviceHub }
})

vi.mock('@/components/novel/ManuscriptEditor', async () => {
  const React = await import('react')
  return {
    ManuscriptEditor: ({
      content,
      onReady,
    }: {
      content: ManuscriptUnit['content']
      onReady?: (editor: unknown) => void
    }) => {
      React.useEffect(() => {
        onReady?.({
          isDestroyed: false,
          getText: () => '',
          state: { selection: { empty: true } },
        })
        return () => onReady?.(null)
      }, [onReady])
      return (
        <div data-testid="manuscript">
          {content.content?.[0]?.content?.[0]?.text}
        </div>
      )
    },
  }
})

vi.mock('@/components/novel/ChapterTree', () => ({
  ChapterTree: ({
    units,
    activeUnitId,
    onSelect,
    onSwitchProject,
  }: {
    units: ManuscriptUnit[]
    activeUnitId: string
    onSelect: (unit: ManuscriptUnit) => void
    onSwitchProject: () => void
  }) => (
    <div data-testid="chapter-tree" data-active-unit={activeUnitId}>
      <button onClick={() => onSelect(units[1])}>切到第二章</button>
      <button onClick={onSwitchProject}>切换作品</button>
    </div>
  ),
}))

vi.mock('@/components/novel/AiInspector', () => ({
  AiInspector: ({
    suggestions,
    onReject,
  }: {
    suggestions: AiSuggestion[]
    onReject: (suggestion: AiSuggestion) => void
  }) => (
    <button
      onClick={() => suggestions[0] && onReject(suggestions[0])}
      disabled={!suggestions[0]}
    >
      拒绝候选
    </button>
  ),
}))

vi.mock('@/components/novel/NovelAssets', () => ({
  NovelAssets: () => null,
}))

vi.mock('@/lib/novel-proofing', () => ({ proofNovelText: () => [] }))
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}))

import { NovelWorkspace } from '@/components/novel/NovelWorkspace'
import { reusableNovelContext } from '@/lib/novel-context'

const timestamp = '2026-08-12T00:00:00.000Z'

const unit = (id: string, title: string): ManuscriptUnit => ({
  schemaVersion: 1,
  id,
  novelId: 'novel-1',
  kind: 'chapter',
  title,
  position: id === 'chapter-1' ? 0 : 1,
  summary: '',
  goal: '',
  wordCount: 2,
  content: {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: `${title}正文` }],
      },
    ],
  },
  revision: 0,
  createdAt: timestamp,
  updatedAt: timestamp,
})

const suggestion: AiSuggestion = {
  id: 'suggestion-1',
  unitId: 'chapter-1',
  mode: 'continue',
  candidateIndex: 0,
  instruction: '续写',
  content: '候选正文',
  status: 'ready',
  favorite: false,
  stale: false,
  context: [],
  createdAt: timestamp,
}

const makeBundle = (): NovelProjectBundle => ({
  project: {
    schemaVersion: 1,
    id: 'novel-1',
    title: '照骨簪',
    kind: 'web_novel',
    genre: '东方玄幻',
    synopsis: '',
    status: 'draft',
    activeUnitId: 'chapter-1',
    unitOrder: ['chapter-1', 'chapter-2'],
    revision: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  units: [unit('chapter-1', '第一章'), unit('chapter-2', '第二章')],
  characters: { schemaVersion: 1, revision: 0, items: [], updatedAt: timestamp },
  relationships: { schemaVersion: 1, revision: 0, items: [], updatedAt: timestamp },
  outline: { schemaVersion: 1, revision: 0, items: [], updatedAt: timestamp },
  clues: { schemaVersion: 1, revision: 0, items: [], updatedAt: timestamp },
  comments: { schemaVersion: 1, revision: 0, items: [], updatedAt: timestamp },
  suggestions: {
    schemaVersion: 1,
    revision: 1,
    items: [suggestion],
    updatedAt: timestamp,
  },
})

const renderWorkspace = async (unitId = 'chapter-1') => {
  const view = render(<NovelWorkspace novelId="novel-1" unitId={unitId} />)
  await act(async () => undefined)
  return view
}

describe('NovelWorkspace suggestions and navigation', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mocks.exitOptions = undefined
    mocks.navigate.mockResolvedValue(undefined)
    mocks.openProject.mockImplementation(async () => structuredClone(makeBundle()))
    mocks.saveSuggestions.mockImplementation(async ({ items }) => ({
      ...makeBundle().suggestions,
      revision: 2,
      items,
    }))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not rewrite loaded suggestions and clears pending after a real edit saves', async () => {
    await renderWorkspace()

    await act(async () => vi.advanceTimersByTimeAsync(750))
    expect(mocks.saveSuggestions).not.toHaveBeenCalled()
    expect(mocks.exitOptions?.hasPendingWrites()).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: '拒绝候选' }))
    expect(mocks.exitOptions?.hasPendingWrites()).toBe(true)

    await act(async () => vi.advanceTimersByTimeAsync(750))
    expect(mocks.saveSuggestions).toHaveBeenCalledOnce()
    expect(mocks.exitOptions?.hasPendingWrites()).toBe(false)
  })

  it('navigates first and changes the editor only after the URL prop changes', async () => {
    const view = await renderWorkspace()
    expect(screen.getByTestId('chapter-tree')).toHaveAttribute(
      'data-active-unit',
      'chapter-1'
    )

    fireEvent.click(screen.getByRole('button', { name: '切到第二章' }))
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/novels/$novelId/$unitId',
      params: { novelId: 'novel-1', unitId: 'chapter-2' },
      replace: true,
    })
    expect(screen.getByTestId('chapter-tree')).toHaveAttribute(
      'data-active-unit',
      'chapter-1'
    )
    expect(mocks.flushAutosave).not.toHaveBeenCalled()

    view.rerender(<NovelWorkspace novelId="novel-1" unitId="chapter-2" />)
    await act(async () => undefined)
    expect(screen.getByTestId('chapter-tree')).toHaveAttribute(
      'data-active-unit',
      'chapter-2'
    )
    expect(screen.getByTestId('manuscript')).toHaveTextContent('第二章正文')
    expect(mocks.flushAutosave).not.toHaveBeenCalled()
  })

  it('lets the router guard own project-switch flushing', async () => {
    await renderWorkspace()

    fireEvent.click(screen.getByRole('button', { name: '切换作品' }))

    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/novels/' })
    expect(mocks.flushAutosave).not.toHaveBeenCalled()
  })
})

const context = (
  id: string,
  type: AiContextItem['type']
): AiContextItem => ({
  id,
  type,
  label: id,
  content: id,
  included: true,
})

describe('NovelWorkspace reusable AI context', () => {
  it('drops stale selection and continuation boundaries before continuing', () => {
    const result = reusableNovelContext(
      [
        context('continuation-boundary', 'selection'),
        context('old-selection', 'selection'),
        context('current-unit-excerpt', 'style_sample'),
        context('character-one', 'character'),
      ],
      'continue'
    )

    expect(result.map((item) => item.id)).toEqual([
      'current-unit-excerpt',
      'character-one',
    ])
  })

  it('keeps the current selection for rewrites but never reuses a boundary', () => {
    const result = reusableNovelContext(
      [
        context('continuation-boundary', 'selection'),
        context('current-selection', 'selection'),
        context('outline-one', 'outline'),
      ],
      'rewrite'
    )

    expect(result.map((item) => item.id)).toEqual([
      'current-selection',
      'outline-one',
    ])
  })
})
