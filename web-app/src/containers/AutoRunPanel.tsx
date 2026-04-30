import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useAutoRunStore } from '@/stores/auto-run-store'
import { Pause, Play, RotateCcw, Square } from 'lucide-react'
import { useMemo, useState } from 'react'

type AutoRunPanelProps = {
  threadId: string
  disabled?: boolean
  onStart: (maxRounds: number) => void
  onPause: () => void
  onResume: () => void
  onStop: () => void
}

export function AutoRunPanel({
  threadId,
  disabled,
  onStart,
  onPause,
  onResume,
  onStop,
}: AutoRunPanelProps) {
  const run = useAutoRunStore((state) => state.runs[threadId])
  const currentRun = run ?? useAutoRunStore.getState().getRun(threadId)
  const [rounds, setRounds] = useState(currentRun.maxRounds || 3)

  const isRunning = currentRun.status === 'running'
  const isPaused = currentRun.status === 'paused'
  const canResume = isPaused && currentRun.currentRound < currentRun.maxRounds

  const progressText = useMemo(() => {
    return `${currentRun.currentRound} / ${currentRun.maxRounds || rounds}`
  }, [currentRun.currentRound, currentRun.maxRounds, rounds])

  return (
    <div className="flex flex-wrap items-center gap-2 px-1 pb-2 text-xs text-muted-foreground">
      <div className="flex items-center gap-2">
        <Switch
          aria-label="Auto run"
          checked={currentRun.enabled || isRunning || isPaused}
          disabled={disabled && !isRunning && !isPaused}
          onCheckedChange={(checked) => {
            if (checked) {
              onStart(Math.max(1, rounds))
            } else {
              onStop()
            }
          }}
        />
        <span className="font-medium text-foreground">Auto run</span>
      </div>

      <label className="flex items-center gap-1">
        <span>Rounds</span>
        <Input
          className="h-7 w-16 px-2 text-xs"
          min={1}
          max={99}
          type="number"
          value={rounds}
          disabled={isRunning}
          onChange={(event) => {
            const value = Number(event.target.value)
            setRounds(Number.isFinite(value) ? Math.max(1, value) : 1)
          }}
        />
      </label>

      <span className="min-w-12 tabular-nums">{progressText}</span>

      {isRunning ? (
        <Button variant="outline" size="xs" onClick={onPause}>
          <Pause className="size-3" />
          Pause
        </Button>
      ) : (
        <Button
          variant="outline"
          size="xs"
          disabled={disabled && !canResume}
          onClick={() => (canResume ? onResume() : onStart(Math.max(1, rounds)))}
        >
          {canResume ? <RotateCcw className="size-3" /> : <Play className="size-3" />}
          {canResume ? 'Resume' : 'Start'}
        </Button>
      )}

      {(isRunning || isPaused || currentRun.status === 'error') && (
        <Button variant="ghost" size="xs" onClick={onStop}>
          <Square className="size-3" />
          Stop
        </Button>
      )}

      {currentRun.status === 'completed' && (
        <span className="text-emerald-600 dark:text-emerald-400">Completed</span>
      )}
      {currentRun.status === 'error' && (
        <span className="text-destructive">{currentRun.lastError ?? 'Error'}</span>
      )}
    </div>
  )
}
