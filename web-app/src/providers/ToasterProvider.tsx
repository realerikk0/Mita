import { Toaster } from '@/components/ui/sonner'
import { useInterfaceSettings } from '@/hooks/useInterfaceSettings'
import { getToastOffset } from '@/utils/toastPlacement'
import type { CSSProperties } from 'react'

export function ToasterProvider() {
  const notificationPosition = useInterfaceSettings(
    (s) => s.notificationPosition
  )

  return (
    <Toaster
      closeButton
      richColors
      position={notificationPosition}
      offset={getToastOffset(notificationPosition)}
      style={
        {
          '--toast-close-button-start': 'unset',
          '--toast-close-button-end': '0.75rem',
          '--toast-close-button-transform': 'none',
        } as CSSProperties
      }
      visibleToasts={5}
      toastOptions={{
        style: {
          background: 'var(--background)',
          padding: '1rem 2.5rem 1rem 0.8rem',
          alignItems: 'start',
          borderColor: 'var(--border)',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          MozUserSelect: 'none',
          msUserSelect: 'none',
        },
        classNames: {
          toast: 'toast select-none',
          title: 'text-foreground! select-none',
          description: 'text-muted-foreground! select-none',
          closeButton: 'toast-close-button',
        },
      }}
    />
  )
}
