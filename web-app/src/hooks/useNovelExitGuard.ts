import { useCallback, useEffect, useRef } from 'react'
import { useBlocker, type ShouldBlockFn } from '@tanstack/react-router'

import type { WindowService } from '@/services/window/types'

type Options = {
  windowService: Pick<WindowService, 'registerCloseGuard'>
  flush: () => Promise<void>
  hasPendingWrites: () => boolean
  onFailure: (error: unknown, action: string) => void
}

/**
 * Flushes all Novel stores before router transitions and native window close.
 * Router transitions are rejected when persistence fails; Tauri close requests
 * remain paused until the same durable flush has completed successfully.
 */
export function useNovelExitGuard({
  windowService,
  flush,
  hasPendingWrites,
  onFailure,
}: Options) {
  const flushRef = useRef(flush)
  const pendingRef = useRef(hasPendingWrites)
  const failureRef = useRef(onFailure)
  flushRef.current = flush
  pendingRef.current = hasPendingWrites
  failureRef.current = onFailure

  const shouldBlockFn = useCallback<ShouldBlockFn>(async ({ current, next }) => {
    if (current.pathname === next.pathname) return false
    if (!pendingRef.current()) return false
    try {
      await flushRef.current()
      return false
    } catch (error) {
      failureRef.current(error, '离开网文模式')
      return true
    }
  }, [])

  const enableBeforeUnload = useCallback(() => pendingRef.current(), [])

  useBlocker({
    shouldBlockFn,
    enableBeforeUnload,
    withResolver: false,
  })

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined

    void windowService
      .registerCloseGuard(async () => {
        if (!pendingRef.current()) return true
        try {
          await flushRef.current()
          return true
        } catch (error) {
          failureRef.current(error, '关闭窗口')
          return false
        }
      })
      .then((registeredUnlisten) => {
        if (disposed) registeredUnlisten()
        else unlisten = registeredUnlisten
      })
      .catch((error) => failureRef.current(error, '注册关闭保护'))

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [windowService])
}
