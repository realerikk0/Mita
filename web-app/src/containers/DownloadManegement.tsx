import { DownloadIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Progress } from '@/components/ui/progress'
import { useAppUpdater } from '@/hooks/useAppUpdater'
import { formatBytes } from '@/lib/utils'

/** Displays immutable application-update downloads. Model downloads are retired. */
export function DownloadManagement() {
  const { updateState } = useAppUpdater()

  if (!updateState.isDownloading) return null

  const progress = Math.max(0, Math.min(1, updateState.downloadProgress || 0))
  const sizeLabel =
    updateState.totalBytes > 0
      ? `${formatBytes(updateState.downloadedBytes)} / ${formatBytes(updateState.totalBytes)}`
      : updateState.downloadedBytes > 0
        ? formatBytes(updateState.downloadedBytes)
        : 'Initializing download...'

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="rounded-full relative z-50"
          aria-label="Application update download"
        >
          <DownloadIcon className="size-4 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="font-medium">Application update</span>
            <span className="text-muted-foreground">
              {Math.round(progress * 100)}%
            </span>
          </div>
          <Progress value={progress * 100} className="h-2" />
          <p className="text-xs text-muted-foreground">{sizeLabel}</p>
        </div>
      </PopoverContent>
    </Popover>
  )
}
