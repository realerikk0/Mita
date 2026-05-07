import { Button } from '@/components/ui/button'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useDownloadStore } from '@/hooks/useDownloadStore'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import type { CatalogModel } from '@/services/models/types'
import {
  RECOMMENDED_VISION_MODEL_HF_REPO,
  RECOMMENDED_VISION_QUANTIZATIONS,
} from '@/constants/models'
import { AppEvent, events } from '@janhq/core'

interface PromptVisionModelProps {
  open: boolean
  onClose: () => void
  onDownloadComplete: (modelId: string) => void
}

export function PromptVisionModel({
  open,
  onClose,
  onDownloadComplete,
}: PromptVisionModelProps) {
  const serviceHub = useServiceHub()
  const { downloads, localDownloadingModels, addLocalDownloadingModel } =
    useDownloadStore()
  const { getProviderByName } = useModelProvider()
  const huggingfaceToken = useGeneralSetting((state) => state.huggingfaceToken)

  const [visionModel, setVisionModel] = useState<CatalogModel | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [supportedVariants, setSupportedVariants] = useState<
    Map<string, 'RED' | 'YELLOW' | 'GREEN' | 'GREY'>
  >(new Map())
  const fetchAttempted = useRef(false)
  const downloadStartedModelId = useRef<string | null>(null)

  const llamaProvider = getProviderByName('llamacpp')
  const existingModel = useMemo(() => {
    return llamaProvider?.models.find(
      (m: { id: string }) =>
        m.id.toLowerCase().includes('jan-v2-vl') ||
        m.id.toLowerCase().includes('jan_v2_vl')
    )
  }, [llamaProvider])

  useEffect(() => {
    if (open && existingModel) {
      onDownloadComplete(existingModel.id)
    }
  }, [open, existingModel, onDownloadComplete])

  const fetchVisionModel = useCallback(async () => {
    if (fetchAttempted.current) return
    fetchAttempted.current = true

    try {
      const repo = await serviceHub
        .models()
        .fetchHuggingFaceRepo(RECOMMENDED_VISION_MODEL_HF_REPO, huggingfaceToken)

      if (repo) {
        const catalogModel = serviceHub
          .models()
          .convertHfRepoToCatalogModel(repo)
        setVisionModel(catalogModel)
      }
    } catch (error) {
      console.error('Error fetching recommended vision model:', error)
    } finally {
      setIsLoading(false)
    }
  }, [serviceHub, huggingfaceToken])

  useEffect(() => {
    if (open && !existingModel) {
      fetchVisionModel()
    }
  }, [open, existingModel, fetchVisionModel])

  useEffect(() => {
    const checkModelSupport = async () => {
      if (!visionModel) return

      const variantSupportMap = new Map<
        string,
        'RED' | 'YELLOW' | 'GREEN' | 'GREY'
      >()

      for (const quantization of RECOMMENDED_VISION_QUANTIZATIONS) {
        const variant = visionModel.quants?.find((quant) =>
          quant.model_id.toLowerCase().includes(quantization)
        )

        if (variant) {
          try {
            const supportStatus = await serviceHub
              .models()
              .isModelSupported(variant.path)
            variantSupportMap.set(variant.model_id, supportStatus)
          } catch (error) {
            console.error(
              `Error checking support for ${variant.model_id}:`,
              error
            )
            variantSupportMap.set(variant.model_id, 'GREY')
          }
        }
      }

      setSupportedVariants(variantSupportMap)
    }

    checkModelSupport()
  }, [visionModel, serviceHub])

  const defaultVariant = useMemo(() => {
    if (!visionModel) return null

    const priorityOrder: Array<'GREEN' | 'YELLOW' | 'GREY'> = [
      'GREEN',
      'YELLOW',
      'GREY',
    ]

    for (const status of priorityOrder) {
      for (const quantization of RECOMMENDED_VISION_QUANTIZATIONS) {
        const variant = visionModel.quants?.find((quant) =>
          quant.model_id.toLowerCase().includes(quantization)
        )

        if (variant && supportedVariants.get(variant.model_id) === status) {
          return variant
        }
      }
    }

    for (const quantization of RECOMMENDED_VISION_QUANTIZATIONS) {
      const variant = visionModel.quants?.find((quant) =>
        quant.model_id.toLowerCase().includes(quantization)
      )
      if (variant) return variant
    }

    return visionModel.quants?.[0]
  }, [visionModel, supportedVariants])

  const isDownloading = useMemo(() => {
    if (!defaultVariant) return false
    return (
      localDownloadingModels.has(defaultVariant.model_id) ||
      Object.values(downloads).some((d) => d.id === defaultVariant.model_id)
    )
  }, [defaultVariant, localDownloadingModels, downloads])

  useEffect(() => {
    const handleModelImported = (data: { modelId: string }) => {
      if (
        downloadStartedModelId.current &&
        data.modelId === downloadStartedModelId.current
      ) {
        onDownloadComplete(data.modelId)
        downloadStartedModelId.current = null
      }
    }

    events.on(AppEvent.onModelImported, handleModelImported)

    return () => {
      events.off(AppEvent.onModelImported, handleModelImported)
    }
  }, [onDownloadComplete])

  const handleDownload = () => {
    if (!defaultVariant || !visionModel) return

    downloadStartedModelId.current = defaultVariant.model_id
    addLocalDownloadingModel(defaultVariant.model_id)

    serviceHub.models().pullModelWithMetadata(
      defaultVariant.model_id,
      defaultVariant.path,
      visionModel.mmproj_models?.[0]?.path,
      huggingfaceToken,
      true
    )
  }

  if (!open || existingModel) return null
  if (isLoading) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 p-4 shadow-lg bg-background w-4/5 md:w-100 border rounded-lg">
      <div className="flex items-center gap-2">
        <img src="/images/jan-logo.png" alt="Silence" className="size-5" />
        <h2 className="font-medium">
          Silence Vision Model
          <span className="text-muted-foreground"> (~5GB)</span>
        </h2>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Add vision capabilities to chat with images. Download our
        recommended vision model.
      </p>
      <div className="mt-4 flex justify-end space-x-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
        >
          {isDownloading ? 'Close' : 'Cancel'}
        </Button>
        <Button
          size="sm"
          onClick={handleDownload}
          disabled={!defaultVariant || isDownloading}
        >
          {isDownloading ? 'Downloading' : 'Download'}
        </Button>
      </div>
    </div>
  )
}
