import { useCallback, useEffect, useMemo, useState } from 'react'
import { Copy, Minus, Square, X } from 'lucide-react'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { Button } from '@/components/ui/button'

export const WindowControls = () => {
  const appWindow = useMemo(() => getCurrentWebviewWindow(), [])
  const [isMaximized, setIsMaximized] = useState(false)

  const syncMaximizedState = useCallback(async () => {
    try {
      setIsMaximized(await appWindow.isMaximized())
    } catch (error) {
      console.error('Failed to sync window maximized state:', error)
    }
  }, [appWindow])

  useEffect(() => {
    let mounted = true
    let unlisten: (() => void) | undefined

    const syncIfMounted = async () => {
      try {
        const maximized = await appWindow.isMaximized()
        if (mounted) {
          setIsMaximized(maximized)
        }
      } catch (error) {
        console.error('Failed to sync window maximized state:', error)
      }
    }

    void syncIfMounted()

    void appWindow
      .onResized(syncIfMounted)
      .then((cleanup) => {
        if (mounted) {
          unlisten = cleanup
        } else {
          cleanup()
        }
      })
      .catch((error) => {
        console.error('Failed to listen for window resize:', error)
      })

    return () => {
      mounted = false
      unlisten?.()
    }
  }, [appWindow])

  const handleMinimize = async () => {
    await appWindow.minimize()
  }

  const handleMaximize = async () => {
    await appWindow.toggleMaximize()
    await syncMaximizedState()
  }

  const handleClose = async () => {
    await appWindow.close()
  }

  return (
    <div className="absolute top-0 z-50 right-4 h-15">
      <div className="flex items-center h-full">
        <Button
          onClick={handleMinimize}
          aria-label="Minimize"
          variant="ghost"
          size="icon-sm"
        >
          <Minus className="size-4" />
        </Button>
        <Button
          onClick={handleMaximize}
          variant="ghost"
          size="icon-sm"
          aria-label={isMaximized ? 'Restore' : 'Maximize'}
        >
          {isMaximized ? (
            <Copy className="size-3.5" />
          ) : (
            <Square className="size-3" />
          )}
        </Button>
        <Button
          onClick={handleClose}
          variant="ghost"
          size="icon-sm"
          aria-label="Close"
        >
          <X className="size-4" />
        </Button>
      </div>
    </div>
  )
}
