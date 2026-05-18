import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useAutoRunStore } from '@/stores/auto-run-store'
import { Pause, Play, RotateCcw, Square } from 'lucide-react'
import { useMemo, useState } from 'react'

type AutoRunPanelProps = {
  threadId: string
  disabled?: boolean
  blockedReason?: string
  onStart: (maxRounds: number) => void
  onPause: () => void
  onResume: () => void
  onStop: () => void
}

export function AutoRunPanel({
  threadId,
  disabled,
  blockedReason,
  onStart,
  onPause,
  onResume,
  onStop,
}: AutoRunPanelProps) {
  const { t } = useTranslation()
  const run = useAutoRunStore((state) => state.runs[threadId])
  const currentRun = run ?? useAutoRunStore.getState().getRun(threadId)
  const [rounds, setRounds] = useState(currentRun.maxRounds || 3)

  const isRunning = currentRun.status === 'running'
  const isPaused = currentRun.status === 'paused'
  const canResume = isPaused && currentRun.currentRound < currentRun.maxRounds
  const maxRounds = currentRun.maxRounds || rounds
  const startDisabled = Boolean(disabled && !isRunning && !isPaused)

  const progressText = useMemo(() => {
    const max = maxRounds || rounds
    if (isRunning) {
      const current = Math.min(max, Math.max(1, currentRun.currentRound))
      return t('chat:autoRun.status.running', { current, max })
    }
    if (isPaused) {
      return t('chat:autoRun.status.paused', {
        current: currentRun.currentRound,
        max,
      })
    }
    if (currentRun.status === 'completed') {
      return t('chat:autoRun.status.completedWithProgress', {
        current: currentRun.currentRound,
        max,
      })
    }
    if (currentRun.status === 'stopped') {
      return t('chat:autoRun.status.stopped', {
        current: currentRun.currentRound,
        max,
      })
    }
    return `${currentRun.currentRound} / ${max}`
  }, [
    currentRun.currentRound,
    currentRun.status,
    isPaused,
    isRunning,
    maxRounds,
    rounds,
    t,
  ])

  return (
    <div className="flex flex-wrap items-center gap-2 px-1 pb-2 text-xs text-muted-foreground">
      <div className="flex items-center gap-2">
        <Switch
          aria-label={t('chat:autoRun.label')}
          checked={currentRun.enabled || isRunning || isPaused}
          disabled={startDisabled}
          onCheckedChange={(checked) => {
            if (checked) {
              if (startDisabled) return
              onStart(Math.max(1, rounds))
            } else {
              onStop()
            }
          }}
        />
        <span className="font-medium text-foreground">
          {t('chat:autoRun.label')}
        </span>
      </div>

      <label className="flex items-center gap-1">
        <span>{t('chat:autoRun.rounds')}</span>
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

      <span className="min-w-24 tabular-nums">{progressText}</span>

      {isRunning ? (
        <Button variant="outline" size="xs" onClick={onPause}>
          <Pause className="size-3" />
          {t('chat:autoRun.pause')}
        </Button>
      ) : (
        <Button
          variant="outline"
          size="xs"
          disabled={startDisabled && !canResume}
          title={startDisabled ? blockedReason : undefined}
          onClick={() => (canResume ? onResume() : onStart(Math.max(1, rounds)))}
        >
          {canResume ? <RotateCcw className="size-3" /> : <Play className="size-3" />}
          {canResume ? t('chat:autoRun.resume') : t('chat:autoRun.start')}
        </Button>
      )}

      {(isRunning || isPaused || currentRun.status === 'error') && (
        <Button variant="ghost" size="xs" onClick={onStop}>
          <Square className="size-3" />
          {t('chat:autoRun.stop')}
        </Button>
      )}

      {startDisabled && blockedReason && (
        <span className="text-muted-foreground">{blockedReason}</span>
      )}
      {currentRun.status === 'completed' && (
        <span className="text-emerald-600 dark:text-emerald-400">
          {t('chat:autoRun.completed')}
        </span>
      )}
      {currentRun.status === 'error' && (
        <span className="text-destructive">
          {currentRun.lastError ?? t('chat:autoRun.error')}
        </span>
      )}
    </div>
  )
}
