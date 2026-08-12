import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useNovelAutosave } from '@/hooks/useNovelAutosave'
import { DefaultNovelService } from '@/services/novels/default'
import type { ManuscriptUnit } from '@/types/novel'

const edited = (unit: ManuscriptUnit, text: string): ManuscriptUnit => ({
  ...unit,
  content: {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text }],
      },
    ],
  },
})

describe('useNovelAutosave', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('waits 750ms, then persists with the expected revision', async () => {
    const service = new DefaultNovelService()
    const bundle = await service.createProject({
      title: '照骨簪',
      kind: 'web_novel',
    })
    const unit = bundle.units[0]
    const onSaved = vi.fn()
    const { result } = renderHook(() =>
      useNovelAutosave({
        novelService: service,
        initialUnit: unit,
        onSaved,
        onConflict: vi.fn(),
      })
    )

    act(() => result.current.schedule(edited(unit, '雨落发簪。')))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(749)
    })
    expect(onSaved).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({ revision: 1 })
    )
    expect(result.current.state).toBe('saved')
  })

  it('flushes immediately and surfaces a structured revision conflict', async () => {
    const service = new DefaultNovelService()
    const bundle = await service.createProject({
      title: '照骨簪',
      kind: 'web_novel',
    })
    const unit = bundle.units[0]
    await service.saveManuscriptUnit({
      novelId: bundle.project.id,
      unit: edited(unit, '磁盘新稿'),
      expectedRevision: 0,
    })
    const onConflict = vi.fn()
    const { result } = renderHook(() =>
      useNovelAutosave({
        novelService: service,
        initialUnit: unit,
        onSaved: vi.fn(),
        onConflict,
      })
    )

    act(() => result.current.schedule(edited(unit, '本地旧稿')))
    await act(async () => {
      await expect(result.current.flush()).rejects.toMatchObject({
        code: 'revision_conflict',
        currentRevision: 1,
      })
    })

    expect(onConflict).toHaveBeenCalledWith(1)
    expect(result.current.state).toBe('conflict')
    await act(async () => {
      await expect(result.current.flush()).rejects.toMatchObject({
        code: 'revision_conflict',
        currentRevision: 1,
      })
    })
    expect(
      (await service.loadManuscriptUnit(bundle.project.id, unit.id))?.content
    ).toEqual(edited(unit, '磁盘新稿').content)
  })

  it('keeps a failed save dirty without recursively retrying forever', async () => {
    const service = new DefaultNovelService()
    const bundle = await service.createProject({
      title: '照骨簪',
      kind: 'web_novel',
    })
    const unit = bundle.units[0]
    const failure = new Error('disk unavailable')
    const save = vi
      .spyOn(service, 'saveManuscriptUnit')
      .mockRejectedValue(failure)
    const onError = vi.fn()
    const { result } = renderHook(() =>
      useNovelAutosave({
        novelService: service,
        initialUnit: unit,
        onSaved: vi.fn(),
        onConflict: vi.fn(),
        onError,
      })
    )

    act(() => result.current.schedule(edited(unit, '尚未落盘')))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(750)
    })

    expect(save).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(failure)
    expect(result.current.state).toBe('error')
  })

  it('rejects an explicit flush when storage fails', async () => {
    const service = new DefaultNovelService()
    const bundle = await service.createProject({
      title: '照骨簪',
      kind: 'web_novel',
    })
    const unit = bundle.units[0]
    const failure = new Error('disk unavailable')
    vi.spyOn(service, 'saveManuscriptUnit').mockRejectedValue(failure)
    const { result } = renderHook(() =>
      useNovelAutosave({
        novelService: service,
        initialUnit: unit,
        onSaved: vi.fn(),
        onConflict: vi.fn(),
        onError: vi.fn(),
      })
    )

    act(() => result.current.schedule(edited(unit, '切章前的本地稿')))
    await act(async () => {
      await expect(result.current.flush()).rejects.toBe(failure)
    })
    expect(result.current.state).toBe('error')
  })

  it('catches a rejected best-effort flush during unmount', async () => {
    const service = new DefaultNovelService()
    const bundle = await service.createProject({
      title: '照骨簪',
      kind: 'web_novel',
    })
    const unit = bundle.units[0]
    const save = vi
      .spyOn(service, 'saveManuscriptUnit')
      .mockRejectedValue(new Error('window is closing'))
    const { result, unmount } = renderHook(() =>
      useNovelAutosave({
        novelService: service,
        initialUnit: unit,
        onSaved: vi.fn(),
        onConflict: vi.fn(),
        onError: vi.fn(),
      })
    )

    act(() => result.current.schedule(edited(unit, '关闭前的本地稿')))
    unmount()
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(save).toHaveBeenCalledTimes(1)
  })
})
