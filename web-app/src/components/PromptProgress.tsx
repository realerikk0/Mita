import { useAppState } from '@/hooks/useAppState'
import { LoadingRibbonText } from '@/components/ai-elements/loading-ribbon'
import { useTranslation } from '@/i18n/react-i18next-compat'

export function PromptProgress() {
  const { t } = useTranslation()
  const promptProgress = useAppState((state) => state.promptProgress)

  const percentage =
    promptProgress && promptProgress.total > 0
      ? Math.round((promptProgress.processed / promptProgress.total) * 100)
      : 0

  // Show progress only when promptProgress exists and has valid data, and not completed
  if (
    !promptProgress ||
    !promptProgress.total ||
    promptProgress.total <= 0 ||
    percentage >= 100
  ) {
    return (
      <LoadingRibbonText
        icon="thinking"
        label={t('chat:generationStatus.thinking')}
        variant="ribbon"
      />
    )
  }

  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
      <LoadingRibbonText
        icon="search"
        label={t('chat:generationStatus.analyzingCodeProgress', {
          percent: percentage,
        })}
        variant="wave"
      />
    </div>
  )
}
