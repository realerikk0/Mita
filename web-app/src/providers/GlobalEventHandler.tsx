import { useEffect } from 'react'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useHardware } from '@/hooks/useHardware'
import { isPlatformTauri } from '@/lib/platform/utils'

/**
 * GlobalEventHandler handles global events that should be processed across all screens
 * This provider should be mounted at the root level to ensure all screens can benefit from global event handling
 */
export function GlobalEventHandler() {
  const serviceHub = useServiceHub()
  const setHardwareData = useHardware((state) => state.setHardwareData)

  // Re-detect GPU when app becomes visible again (e.g. after system sleep on Linux - #6447)
  useEffect(() => {
    if (!isPlatformTauri()) return

    const handleVisibilityChange = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        await serviceHub.hardware().refreshHardwareInfo()
        const data = await serviceHub.hardware().getHardwareInfo()
        if (data) setHardwareData(data)
      } catch (e) {
        console.error('Failed to refresh hardware info after visibility change:', e)
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [serviceHub, setHardwareData])

  // This component doesn't render anything
  return null
}
