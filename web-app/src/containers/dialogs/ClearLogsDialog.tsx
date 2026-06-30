import { useRef } from 'react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface ClearLogsDialogProps {
  onClear: () => void
  children: React.ReactNode
}

export function ClearLogsDialog({ onClear, children }: ClearLogsDialogProps) {
  const { t } = useTranslation()
  const clearButtonRef = useRef<HTMLButtonElement>(null)

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') onClear()
  }

  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent
        className="sm:max-w-[425px] max-w-[90vw]"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          clearButtonRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('settings:general.clearLogsTitle')}</DialogTitle>
          <DialogDescription>
            {t('settings:general.clearLogsDesc')}
          </DialogDescription>
          <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <DialogClose asChild>
              <Button
                variant="ghost"
                size="sm"
                className="hover:no-underline w-full sm:w-auto"
              >
                {t('settings:general.cancel')}
              </Button>
            </DialogClose>
            <DialogClose asChild>
              <Button
                ref={clearButtonRef}
                variant="destructive"
                onClick={onClear}
                onKeyDown={handleKeyDown}
                size="sm"
                className="w-full sm:w-auto"
                aria-label={t('settings:general.clearLogs')}
              >
                {t('settings:general.clearLogs')}
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  )
}
