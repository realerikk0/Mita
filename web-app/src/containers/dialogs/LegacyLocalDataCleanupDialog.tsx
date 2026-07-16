import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { IconAlertTriangle, IconTrash } from '@tabler/icons-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { formatBytes } from '@/lib/utils'

export type LegacyLocalDataEntry = {
  path: string
  bytes: number
}

export type LegacyLocalDataInspection = {
  entries: LegacyLocalDataEntry[]
  totalBytes: number
  confirmationToken: string
}

export function LegacyLocalDataCleanupDialog() {
  const [open, setOpen] = useState(false)
  const [inspection, setInspection] =
    useState<LegacyLocalDataInspection | null>(null)
  const [stage, setStage] = useState<'review' | 'confirm'>('review')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const inspect = async () => {
    setLoading(true)
    setError(null)
    setStage('review')
    try {
      const result = await invoke<LegacyLocalDataInspection>(
        'inspect_legacy_local_data'
      )
      setInspection(result)
    } catch (reason) {
      setInspection(null)
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (nextOpen) {
      void inspect()
    } else {
      setStage('review')
      setError(null)
    }
  }

  const cleanup = async () => {
    if (!inspection?.confirmationToken) return
    setLoading(true)
    setError(null)
    try {
      const removedBytes = await invoke<number>('cleanup_legacy_local_data', {
        confirmationToken: inspection.confirmationToken,
      })
      toast.success('Legacy local data removed', {
        description: `${formatBytes(removedBytes)} was removed after integrity revalidation.`,
      })
      setOpen(false)
      setInspection(null)
      setStage('review')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }

  const hasEntries = (inspection?.entries.length ?? 0) > 0

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="destructive" size="sm">
          <IconTrash className="size-4" />
          Inspect legacy local data
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Clean up retired local-model data</DialogTitle>
          <DialogDescription>
            Biyan never removes downloaded models or retired indexing data
            automatically. Review every path before confirming deletion.
          </DialogDescription>
        </DialogHeader>

        {loading && !inspection ? (
          <p className="text-sm text-muted-foreground">Inspecting paths…</p>
        ) : error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </div>
        ) : stage === 'review' ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-md border p-3 text-sm">
              <span>Total selected by the integrity check</span>
              <strong>{formatBytes(inspection?.totalBytes ?? 0)}</strong>
            </div>
            {hasEntries ? (
              <div className="max-h-64 space-y-2 overflow-y-auto">
                {inspection?.entries.map((entry) => (
                  <div key={entry.path} className="rounded-md bg-secondary p-2">
                    <code className="block break-all text-xs">{entry.path}</code>
                    <span className="text-xs text-muted-foreground">
                      {formatBytes(entry.bytes)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No retired local-model or indexing directories were found.
              </p>
            )}
          </div>
        ) : (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4">
            <div className="flex items-start gap-3">
              <IconAlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
              <div className="space-y-1 text-sm">
                <p className="font-medium">This is the final confirmation.</p>
                <p className="text-muted-foreground">
                  Delete {formatBytes(inspection?.totalBytes ?? 0)} from the
                  reviewed paths? The backend will revalidate the Biyan data and
                  confirmation token immediately before deleting anything.
                </p>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={loading}>
              Cancel
            </Button>
          </DialogClose>
          {error ? (
            <Button onClick={() => void inspect()} disabled={loading}>
              Retry inspection
            </Button>
          ) : stage === 'review' ? (
            <Button
              variant="destructive"
              disabled={loading || !hasEntries}
              onClick={() => setStage('confirm')}
            >
              Review deletion
            </Button>
          ) : (
            <Button
              variant="destructive"
              disabled={loading}
              onClick={() => void cleanup()}
            >
              {loading ? 'Revalidating…' : 'Delete reviewed data'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
