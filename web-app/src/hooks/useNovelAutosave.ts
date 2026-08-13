import { useCallback, useEffect, useRef, useState } from 'react'

import type { NovelService } from '@/services/novels/types'
import { NovelServiceError, type ManuscriptUnit } from '@/types/novel'

export type NovelSaveState = 'saved' | 'dirty' | 'saving' | 'conflict' | 'error'

type Options = {
  novelService: NovelService
  initialUnit: ManuscriptUnit
  delay?: number
  onSaved: (unit: ManuscriptUnit) => void
  onConflict: (currentRevision?: number) => void
  onError?: (error: unknown) => void
}

/**
 * Serializes debounced manuscript saves. Edits made while a request is in
 * flight stay dirty and are committed only after the first revision returns.
 */
export function useNovelAutosave({
  novelService,
  initialUnit,
  delay = 750,
  onSaved,
  onConflict,
  onError,
}: Options) {
  const [state, setState] = useState<NovelSaveState>('saved')
  const latestRef = useRef(initialUnit)
  const expectedRevisionRef = useRef(initialUnit.revision)
  const editVersionRef = useRef(0)
  const dirtyRef = useRef(false)
  const conflictedRef = useRef(false)
  const conflictRevisionRef = useRef<number | undefined>(undefined)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savingRef = useRef<Promise<void> | null>(null)
  const callbacksRef = useRef({ onSaved, onConflict, onError })

  useEffect(() => {
    callbacksRef.current = { onSaved, onConflict, onError }
  }, [onConflict, onError, onSaved])

  const clearTimer = useCallback(() => {
    if (!timerRef.current) return
    clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const flush = useCallback(async (): Promise<void> => {
    clearTimer()
    if (conflictedRef.current) {
      throw new NovelServiceError(
        'revision_conflict',
        'The manuscript has an unresolved revision conflict',
        { currentRevision: conflictRevisionRef.current }
      )
    }

    if (savingRef.current) {
      await savingRef.current
      if (dirtyRef.current && !conflictedRef.current) await flush()
      return
    }

    if (!dirtyRef.current) return

    const snapshot = latestRef.current
    const savingVersion = editVersionRef.current
    dirtyRef.current = false
    setState('saving')

    const request = novelService
      .saveManuscriptUnit({
        novelId: snapshot.novelId,
        unit: snapshot,
        expectedRevision: expectedRevisionRef.current,
      })
      .then((saved) => {
        expectedRevisionRef.current = saved.revision
        latestRef.current =
          editVersionRef.current === savingVersion
            ? saved
            : { ...latestRef.current, revision: saved.revision }
        setState(dirtyRef.current ? 'dirty' : 'saved')
        callbacksRef.current.onSaved(saved)
      })
      .catch((error: unknown) => {
        dirtyRef.current = true
        if (
          error instanceof NovelServiceError &&
          error.code === 'revision_conflict'
        ) {
          conflictedRef.current = true
          conflictRevisionRef.current = error.currentRevision
          setState('conflict')
          callbacksRef.current.onConflict(error.currentRevision)
          throw error
        }
        setState('error')
        callbacksRef.current.onError?.(error)
        throw error
      })
      .finally(() => {
        savingRef.current = null
      })

    savingRef.current = request
    await request

    // A persistent storage error must not recurse forever. A later explicit
    // flush or a newly scheduled edit can retry the still-dirty snapshot.
    if (dirtyRef.current && !conflictedRef.current) await flush()
  }, [clearTimer, novelService])

  const schedule = useCallback(
    (unit: ManuscriptUnit) => {
      latestRef.current = unit
      editVersionRef.current += 1
      dirtyRef.current = true
      clearTimer()
      if (conflictedRef.current) {
        setState('conflict')
        return
      }
      setState('dirty')
      timerRef.current = setTimeout(() => {
        void flush().catch(() => undefined)
      }, delay)
    },
    [clearTimer, delay, flush]
  )

  const reset = useCallback(
    (unit: ManuscriptUnit) => {
      clearTimer()
      latestRef.current = unit
      expectedRevisionRef.current = unit.revision
      editVersionRef.current = 0
      dirtyRef.current = false
      conflictedRef.current = false
      conflictRevisionRef.current = undefined
      setState('saved')
    },
    [clearTimer]
  )

  const hasPending = useCallback(
    () =>
      dirtyRef.current ||
      conflictedRef.current ||
      Boolean(timerRef.current || savingRef.current),
    []
  )

  useEffect(
    () => () => {
      clearTimer()
      if (dirtyRef.current && !conflictedRef.current) {
        void flush().catch(() => undefined)
      }
    },
    [clearTimer, flush]
  )

  return { state, schedule, flush, reset, hasPending }
}
