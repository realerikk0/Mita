import { useAppState } from '@/hooks/useAppState'
import { LoadingRibbonText } from '@/components/ai-elements/loading-ribbon'

export function PromptProgress() {
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
        label="思考中"
        variant="ribbon"
      />
    )
  }

  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
      <LoadingRibbonText
        icon="search"
        label={`分析代码中 ${percentage}%`}
        variant="wave"
      />
    </div>
  )
}
