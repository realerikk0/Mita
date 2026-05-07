import { Button } from '@/components/ui/button'
import { useSilenceModelPromptDismissed } from '@/hooks/useSilenceModelPrompt'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useDownloadStore } from '@/hooks/useDownloadStore'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { useMemo } from 'react'
import { SETUP_SCREEN_QUANTIZATIONS } from '@/constants/models'
import { useLatestSilenceModel } from '@/hooks/useLatestSilenceModel'

export function PromptSilenceModel() {

  const { setDismissedModelName } = useSilenceModelPromptDismissed()
  const serviceHub = useServiceHub()
  const { downloads, localDownloadingModels, addLocalDownloadingModel } =
    useDownloadStore()
  const huggingfaceToken = useGeneralSetting((state) => state.huggingfaceToken)

  const { model: recommendedModel, loading: isLoading } = useLatestSilenceModel()

  const defaultVariant = useMemo(() => {
    if (!recommendedModel) return null

    for (const quantization of SETUP_SCREEN_QUANTIZATIONS) {
      const variant = recommendedModel.quants?.find((quant) =>
        quant.model_id.toLowerCase().includes(quantization)
      )
      if (variant) return variant
    }

    return recommendedModel.quants?.[0]
  }, [recommendedModel])

  const isDownloading = useMemo(() => {
    if (!defaultVariant) return false
    return (
      localDownloadingModels.has(defaultVariant.model_id) ||
      Object.values(downloads).some((d) => d.id === defaultVariant.model_id)
    )
  }, [defaultVariant, localDownloadingModels, downloads])

  const handleDismiss = () => {
    if (recommendedModel) setDismissedModelName(recommendedModel.model_name)
  }

  const handleDownload = () => {
    if (!defaultVariant || !recommendedModel) return

    addLocalDownloadingModel(defaultVariant.model_id)
    serviceHub.models().pullModelWithMetadata(
      defaultVariant.model_id,
      defaultVariant.path,
      (
        recommendedModel.mmproj_models?.find(
          (e) => e.model_id.toLowerCase() === 'mmproj-f16'
        ) || recommendedModel.mmproj_models?.[0]
      )?.path,
      huggingfaceToken,
      true
    )
    setDismissedModelName(recommendedModel.model_name)
  }

  if (isLoading || !recommendedModel) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 p-4 shadow-lg bg-background w-4/5 md:w-100 border rounded-lg">
      <div className="flex items-center gap-2">
        <img src="/images/jan-logo.png" alt="Silence" className="size-5" />
        <h2 className="font-medium">
          {recommendedModel?.display_name ?? recommendedModel?.model_name ?? 'Silence Model'}
          {defaultVariant && (
          <span className="text-muted-foreground">
            {' '}
            ({defaultVariant.file_size})
          </span>
        )}
        </h2>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Get started with {recommendedModel?.display_name ?? 'Silence'}, our recommended local AI model optimized for your device.
      </p>
      <div className="mt-4 flex justify-end space-x-2">
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={handleDismiss}
        >
          Later
        </Button>
        <Button
          onClick={handleDownload}
          disabled={!defaultVariant || isDownloading}
          size="sm"
        >
          {isDownloading ? 'Downloading' : 'Download'}
        </Button>
      </div>
    </div>
  )
}
