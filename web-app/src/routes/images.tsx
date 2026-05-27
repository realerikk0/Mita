import { createFileRoute, Link } from '@tanstack/react-router'
import {
  ArrowUp,
  ChevronsUpDown,
  Copy,
  Eye,
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  Minus,
  MoreHorizontal,
  Plus,
  RefreshCcw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import {
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { toast } from 'sonner'

import HeaderPage from '@/containers/HeaderPage'
import { ProviderQuotaActions } from '@/components/ProviderQuotaActions'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import ProvidersAvatar from '@/containers/ProvidersAvatar'
import { useTranslation } from '@/i18n/react-i18next-compat'
import {
  arrayBufferToBase64,
  apiQualityForImageEditPreset,
  apiQualityForPreset,
  getImageModels,
  imageEditSizeForRatio,
  imageFileExtension,
  imageSizeForRatio,
  isImageEditModel,
  type ImageGenerationMode,
  type ImageQualityPreset,
  type ImageRatio,
} from '@/lib/image-generation'
import { cn, getModelDisplayName, getProviderTitle } from '@/lib/utils'
import { route } from '@/constants/routes'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useServiceHub } from '@/hooks/useServiceHub'
import {
  providerQuotaErrorFromUnknown,
  type ProviderQuotaErrorDetails,
} from '@/lib/provider-quota-error'
import {
  imageGenerationRequestErrorFromUnknown,
  type ImageGenerationRequestErrorDetails,
} from '@/lib/image-generation-errors'
import { trackMitaEvent } from '@/lib/analytics'
import type {
  ImageAssetRecord,
  ImageGenerationStatus,
} from '@/services/image-generation/types'

export const Route = createFileRoute(route.images as '/images')({
  component: Images,
})

type ImageTask = {
  id: string
  batchId: string
  createdAt: string
  prompt: string
  mode: ImageGenerationMode
  providerName: string
  modelId: string
  ratio: ImageRatio
  qualityPreset: ImageQualityPreset
  status: ImageGenerationStatus
  sourceAssetIds: string[]
  message?: string
  quotaError?: ProviderQuotaErrorDetails
  requestError?: ImageGenerationRequestErrorDetails
  retryAvailableAt?: number
  asset?: ImageAssetRecord
}

type ImageModelOption = {
  provider: ModelProvider
  model: Model
}

type ImageTaskGroup = {
  id: string
  createdAt: string
  prompt: string
  mode: ImageGenerationMode
  providerName: string
  modelId: string
  ratio: ImageRatio
  qualityPreset: ImageQualityPreset
  sourceAssetIds: string[]
  tasks: ImageTask[]
}

type AssetContextMenuState = {
  asset: ImageAssetRecord
  x: number
  y: number
} | null

type TranslationFn = (key: string, options?: Record<string, unknown>) => string

const IMAGE_I18N_PREFIX = 'common:imageGeneration'
const MAX_REFERENCE_IMAGES = 8
const imageT = (
  t: TranslationFn,
  key: string,
  options?: Record<string, unknown>
) => t(`${IMAGE_I18N_PREFIX}.${key}`, options)

const COMPOSER_RATIO_ORDER: ImageRatio[] = [
  '16:9',
  '3:2',
  '4:3',
  '1:1',
  '3:4',
  '2:3',
  '9:16',
]
const QUALITY_OPTIONS: Array<{
  value: ImageQualityPreset
  labelKey: string
  compactLabelKey: string
}> = [
  {
    value: 'sd',
    labelKey: 'quality.sd',
    compactLabelKey: 'quality.sdCompact',
  },
  {
    value: 'hd',
    labelKey: 'quality.hd',
    compactLabelKey: 'quality.hdCompact',
  },
]

function qualityPresetLabel(t: TranslationFn, preset: ImageQualityPreset) {
  const option = QUALITY_OPTIONS.find((item) => item.value === preset)
  return imageT(t, option?.labelKey ?? `quality.${preset}`)
}

function qualityPresetCompactLabel(t: TranslationFn, preset: ImageQualityPreset) {
  const option = QUALITY_OPTIONS.find((item) => item.value === preset)
  return imageT(t, option?.compactLabelKey ?? `quality.${preset}`)
}

function assetQualityLabel(t: TranslationFn, quality?: string) {
  switch (quality?.toLowerCase()) {
    case 'standard':
    case 'medium':
    case 'sd':
      return qualityPresetLabel(t, 'sd')
    case 'high':
    case 'hd':
      return qualityPresetLabel(t, 'hd')
    default:
      return quality ?? ''
  }
}

function imageCountLabel(t: TranslationFn, count: number) {
  return imageT(t, count === 1 ? 'imageCount.one' : 'imageCount.other', {
    count,
  })
}

function imageRequestErrorMessage(
  t: TranslationFn,
  error: ImageGenerationRequestErrorDetails
) {
  return imageT(
    t,
    error.kind === 'rate_limited'
      ? 'errors.rateLimited'
      : error.kind === 'invalid_source_image'
        ? error.sourceImageIndex
          ? 'errors.invalidSourceImageWithIndex'
          : 'errors.invalidSourceImage'
        : 'errors.requestTimeout',
    error.sourceImageIndex
      ? { index: error.sourceImageIndex }
      : undefined
  )
}

function retryInSeconds(retryAvailableAt: number | undefined, nowMs: number) {
  if (!retryAvailableAt || retryAvailableAt <= nowMs) return 0
  return Math.ceil((retryAvailableAt - nowMs) / 1000)
}

function statusLabel(t: TranslationFn, status: ImageGenerationStatus) {
  return imageT(t, `status.${status}`)
}

function imageModelKey(option: ImageModelOption) {
  return `${option.provider.provider}::${option.model.id}`
}

function createId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
}

function localPromptFromPath(path: string, fallback: string) {
  const fileName = path.split(/[\\/]/).pop()
  const stem = fileName?.replace(/\.[^.]+$/, '').trim()
  return stem || fallback
}

function openInSystemFileManagerKey() {
  const userAgent =
    typeof navigator === 'undefined' ? '' : navigator.userAgent.toLowerCase()

  if (userAgent.includes('mac')) return 'openInFinder'
  if (userAgent.includes('win')) return 'openInExplorer'
  return 'openInSystemFileManager'
}

async function readImageSize(image: { b64Json: string; mimeType: string }) {
  return new Promise<string | undefined>((resolve) => {
    const preview = new Image()
    preview.onload = () => {
      const width = preview.naturalWidth || preview.width
      const height = preview.naturalHeight || preview.height
      resolve(width && height ? `${width}x${height}` : undefined)
    }
    preview.onerror = () => resolve(undefined)
    preview.src = `data:${image.mimeType};base64,${image.b64Json}`
  })
}

async function fileToArrayBuffer(file: File) {
  if (typeof file.arrayBuffer === 'function') {
    return file.arrayBuffer()
  }

  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.readAsArrayBuffer(file)
  })
}

function RatioGlyph({
  ratio,
  selected,
  size = 19,
  borderWidth = 2,
}: {
  ratio: ImageRatio
  selected?: boolean
  size?: number
  borderWidth?: number
}) {
  const [widthRatio, heightRatio] = ratio.split(':').map(Number)
  const maxSize = size
  const width =
    widthRatio >= heightRatio
      ? maxSize
      : Math.max(8, Math.round((maxSize * widthRatio) / heightRatio))
  const height =
    heightRatio >= widthRatio
      ? maxSize
      : Math.max(7, Math.round((maxSize * heightRatio) / widthRatio))

  return (
    <span
      aria-hidden="true"
      className="flex items-center justify-center"
      style={{ width: maxSize + 4, height: maxSize + 4 }}
    >
      <span
        className={cn(
          'rounded-[4px] border-solid',
          selected ? 'border-foreground' : 'border-muted-foreground'
        )}
        style={{ width, height, borderWidth }}
      />
    </span>
  )
}

function ReferenceThumbnail({
  asset,
  src,
  expanded,
  onRemove,
}: {
  asset: ImageAssetRecord
  src: string
  expanded: boolean
  onRemove: (assetId: string) => void
}) {
  const { t } = useTranslation()
  const [loadState, setLoadState] = useState<'loading' | 'loaded' | 'failed'>(
    src ? 'loading' : 'failed'
  )

  useEffect(() => {
    setLoadState(src ? 'loading' : 'failed')
  }, [src])

  return (
    <>
      {src && loadState !== 'failed' ? (
        <img
          src={src}
          alt={asset.prompt}
          className={cn(
            'size-full object-cover transition-opacity duration-200',
            loadState === 'loaded' ? 'opacity-100' : 'opacity-0'
          )}
          onLoad={() => setLoadState('loaded')}
          onError={() => setLoadState('failed')}
        />
      ) : (
        <div className="flex size-full items-center justify-center">
          <ImageIcon className="size-5 text-muted-foreground" />
        </div>
      )}

      {loadState === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center bg-secondary">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      )}

      <button
        type="button"
        aria-label={imageT(t, 'removeReferenceImage', {
          prompt: asset.prompt,
        })}
        className={cn(
          'absolute right-1 top-1 z-10 flex size-5 items-center justify-center rounded-full bg-background/90 text-foreground opacity-0 shadow transition-opacity hover:bg-background',
          expanded && 'group-hover/reference-thumb:opacity-100 focus:opacity-100'
        )}
        onClick={(event) => {
          event.stopPropagation()
          onRemove(asset.id)
        }}
      >
        <X className="size-3.5" />
      </button>
    </>
  )
}

function ReferenceImageStack({
  assets,
  assetSrc,
  loading,
  onAdd,
  onRemove,
}: {
  assets: ImageAssetRecord[]
  assetSrc: (asset: ImageAssetRecord) => string
  loading: boolean
  onAdd: () => void
  onRemove: (assetId: string) => void
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const hasAssets = assets.length > 0
  const canAdd = assets.length < MAX_REFERENCE_IMAGES
  const expandedWidth = Math.max(64, assets.length * 58 + (canAdd ? 48 : 0))
  const collapsedWidth = canAdd ? 90 : 76

  if (!hasAssets) {
    return (
      <button
        type="button"
        aria-label={imageT(t, 'addReferenceImage')}
        className="flex size-16 shrink-0 items-center justify-center rounded-md border bg-secondary/70 text-muted-foreground transition-colors hover:text-foreground"
        disabled={loading}
        onClick={onAdd}
      >
        {loading ? (
          <Loader2 className="size-5 animate-spin" />
        ) : (
          <Plus className="size-5" />
        )}
      </button>
    )
  }

  return (
    <div
      className="relative h-16 shrink-0 transition-[width] duration-200"
      style={{ width: expanded ? expandedWidth : collapsedWidth }}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      onFocus={() => setExpanded(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setExpanded(false)
        }
      }}
    >
      {assets.map((asset, index) => {
        const collapsedIndex = Math.min(index, 2)
        const left = expanded ? index * 58 : collapsedIndex * 9
        const rotation = expanded ? 0 : [-6, 4, -2][collapsedIndex] ?? 0

        return (
          <div
            key={asset.id}
            className="group/reference-thumb absolute top-0 size-16 overflow-hidden rounded-md border bg-secondary shadow-sm transition-all duration-200"
            style={{
              left,
              zIndex: expanded ? index + 1 : assets.length - index,
              transform: `rotate(${rotation}deg)`,
            }}
          >
            <ReferenceThumbnail
              asset={asset}
              src={asset.path ? assetSrc(asset) : ''}
              expanded={expanded}
              onRemove={onRemove}
            />
          </div>
        )
      })}

      {canAdd && (
        <button
          type="button"
          aria-label={imageT(t, 'addReferenceImage')}
          className="absolute top-3 flex size-10 items-center justify-center rounded-md border bg-background text-muted-foreground shadow-sm transition-all duration-200 hover:text-foreground"
          style={{
            left: expanded ? assets.length * 58 : 50,
            zIndex: assets.length + 20,
          }}
          disabled={loading}
          onClick={onAdd}
        >
          {loading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Plus className="size-4" />
          )}
        </button>
      )}
    </div>
  )
}

function ImageModelPicker({
  imageModels,
  selectedModelKey,
  onSelect,
  triggerClassName,
  labelPrefix,
  showProviderName,
  side = 'bottom',
  align = 'start',
}: {
  imageModels: ImageModelOption[]
  selectedModelKey: string
  onSelect: (value: string) => void
  triggerClassName?: string
  labelPrefix?: string
  showProviderName?: boolean
  side?: 'top' | 'bottom'
  align?: 'start' | 'center' | 'end'
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [searchValue, setSearchValue] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  const selected = useMemo(
    () => imageModels.find((option) => imageModelKey(option) === selectedModelKey),
    [imageModels, selectedModelKey]
  )

  const filteredModels = useMemo(() => {
    const query = searchValue.trim().toLowerCase()
    if (!query) return imageModels

    return imageModels.filter(({ provider, model }) => {
      const searchTarget = [
        provider.provider,
        getProviderTitle(provider.provider),
        model.id,
        getModelDisplayName(model),
        ...(model.capabilities ?? []),
      ]
        .join(' ')
        .toLowerCase()
      return searchTarget.includes(query)
    })
  }, [imageModels, searchValue])

  const groupedModels = useMemo(() => {
    return filteredModels.reduce<Record<string, ImageModelOption[]>>(
      (groups, option) => {
        const key = option.provider.provider
        groups[key] = groups[key] ?? []
        groups[key].push(option)
        return groups
      },
      {}
    )
  }, [filteredModels])

  const displayModel = selected
    ? getModelDisplayName(selected.model)
    : imageT(t, 'selectImageModel')
  const providerLabel = selected
    ? getProviderTitle(selected.provider.provider)
    : imageT(t, 'provider')
  const triggerLabel = showProviderName
    ? `${providerLabel} · ${displayModel}`
    : labelPrefix
      ? `${labelPrefix} · ${displayModel}`
      : displayModel

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (nextOpen) {
          setTimeout(() => searchInputRef.current?.focus(), 100)
        } else {
          requestAnimationFrame(() => setSearchValue(''))
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={imageT(t, 'imageModel')}
          className={cn(
            'relative z-20 flex h-9 max-w-[360px] items-center gap-1.5 rounded-full border px-4 py-1.5',
            triggerClassName
          )}
        >
          {selected && (
            <div className="shrink-0">
              <ProvidersAvatar provider={selected.provider} />
            </div>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className={cn(
                  'truncate text-sm font-medium leading-normal text-foreground',
                  !selected && 'text-muted-foreground'
                )}
              >
                {triggerLabel}
              </span>
            </TooltipTrigger>
            <TooltipContent>{selected?.model.id ?? displayModel}</TooltipContent>
          </Tooltip>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        className="w-auto min-w-70 max-w-[90vw] border bg-background/95 p-0 backdrop-blur-2xl"
        align={align}
        side={side}
      >
        <div className="flex max-h-96 flex-col">
          <div className="relative border-b p-2">
            <input
              ref={searchInputRef}
              value={searchValue}
              onChange={(event) => setSearchValue(event.target.value)}
              placeholder={imageT(t, 'searchImageModels')}
              className="w-full bg-transparent text-sm font-normal outline-0"
            />
            {searchValue.length > 0 && (
              <button
                type="button"
                className="absolute bottom-0 right-2 top-0 flex items-center text-muted-foreground"
                onClick={() => {
                  setSearchValue('')
                  searchInputRef.current?.focus()
                }}
              >
                <X className="size-4" />
              </button>
            )}
          </div>

          <div className="overflow-y-auto py-1">
            {Object.keys(groupedModels).length === 0 ? (
              <div className="px-4 py-3 text-sm text-muted-foreground">
                {imageT(t, 'noImageModelsFound')}
              </div>
            ) : (
              Object.entries(groupedModels).map(([providerKey, models]) => {
                const provider = models[0]?.provider
                if (!provider) return null

                return (
                  <div
                    key={providerKey}
                    className="mx-1.5 my-1.5 rounded-sm bg-secondary/30 py-1 first:mt-0"
                  >
                    <div className="flex items-center gap-1.5 px-2 py-1">
                      <ProvidersAvatar provider={provider} />
                      <span className="text-sm font-medium capitalize text-muted-foreground">
                        {getProviderTitle(provider.provider)}
                      </span>
                    </div>

                    {models.map((option) => {
                      const key = imageModelKey(option)
                      const isSelected = key === selectedModelKey

                      return (
                        <button
                          key={key}
                          type="button"
                          className={cn(
                            'mx-1 mb-1 flex w-[calc(100%-0.5rem)] cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left transition-all duration-200 hover:bg-secondary/40',
                            isSelected &&
                              'bg-primary/15 ring-1 ring-primary/40 hover:bg-primary/15'
                          )}
                          onClick={() => {
                            onSelect(key)
                            setOpen(false)
                          }}
                        >
                          <span className="truncate text-sm">
                            {getModelDisplayName(option.model)}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )
              })
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function Images() {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const providers = useModelProvider((state) => state.providers)
  const imageModels = useMemo(() => getImageModels(providers), [providers])
  const [selectedModelKey, setSelectedModelKey] = useState('')
  const [prompt, setPrompt] = useState('')
  const [ratio, setRatio] = useState<ImageRatio>('1:1')
  const [qualityPreset, setQualityPreset] =
    useState<ImageQualityPreset>('sd')
  const [count, setCount] = useState(1)
  const [assets, setAssets] = useState<ImageAssetRecord[]>([])
  const [sourceAssetIds, setSourceAssetIds] = useState<string[]>([])
  const [sourceAssetRecords, setSourceAssetRecords] = useState<
    ImageAssetRecord[]
  >([])
  const [referenceAssetsLoading, setReferenceAssetsLoading] = useState(false)
  const [tasks, setTasks] = useState<ImageTask[]>([])
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [previewAsset, setPreviewAsset] = useState<ImageAssetRecord | null>(null)
  const [contextMenu, setContextMenu] = useState<AssetContextMenuState>(null)
  const controllers = useRef(new Map<string, AbortController>())
  const cancelledTasks = useRef(new Set<string>())

  useEffect(() => {
    if (imageModels.length === 0) {
      if (selectedModelKey) setSelectedModelKey('')
      return
    }

    const selectedStillExists = imageModels.some(
      (option) => imageModelKey(option) === selectedModelKey
    )
    if (!selectedModelKey || !selectedStillExists) {
      setSelectedModelKey(imageModelKey(imageModels[0]))
    }
  }, [imageModels, selectedModelKey])

  useEffect(() => {
    let mounted = true
    serviceHub
      .imageGeneration()
      .listAssets()
      .then((nextAssets) => {
        if (mounted) setAssets(nextAssets)
      })
      .catch((error) => {
        console.error('Failed to load image assets:', error)
        toast.error(imageT(t, 'toast.loadAssetsFailed'))
      })
    return () => {
      mounted = false
    }
  }, [serviceHub, t])

  useEffect(() => {
    if (!contextMenu) return

    const close = () => setContextMenu(null)
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }

    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [contextMenu])

  const hasRetryCooldown = tasks.some(
    (task) => retryInSeconds(task.retryAvailableAt, nowMs) > 0
  )

  useEffect(() => {
    if (!hasRetryCooldown) return

    const interval = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [hasRetryCooldown])

  const selectedModel = useMemo(() => {
    return imageModels.find(
      ({ provider, model }) =>
        imageModelKey({ provider, model }) === selectedModelKey
    )
  }, [imageModels, selectedModelKey])

  const resolveAssetById = useCallback(
    (id: string) =>
      assets.find((asset) => asset.id === id) ??
      sourceAssetRecords.find((asset) => asset.id === id),
    [assets, sourceAssetRecords]
  )

  const sourceAssets = useMemo(
    () =>
      sourceAssetIds
        .map((id) => resolveAssetById(id))
        .filter((asset): asset is ImageAssetRecord => Boolean(asset)),
    [resolveAssetById, sourceAssetIds]
  )

  const taskGroups = useMemo<ImageTaskGroup[]>(() => {
    const groups = new Map<string, ImageTaskGroup>()
    tasks.forEach((task) => {
      const group = groups.get(task.batchId)
      if (group) {
        group.tasks.push(task)
        return
      }

      groups.set(task.batchId, {
        id: task.batchId,
        createdAt: task.createdAt,
        prompt: task.prompt,
        mode: task.mode,
        providerName: task.providerName,
        modelId: task.modelId,
        ratio: task.ratio,
        qualityPreset: task.qualityPreset,
        sourceAssetIds: task.sourceAssetIds,
        tasks: [task],
      })
    })
    return Array.from(groups.values())
  }, [tasks])

  const taskAssetIds = useMemo(
    () =>
      new Set(
        tasks
          .map((task) => task.asset?.id)
          .filter((id): id is string => Boolean(id))
      ),
    [tasks]
  )

  const savedHistoryAssets = useMemo(
    () =>
      assets.filter(
        (asset) => asset.assetKind !== 'reference' && !taskAssetIds.has(asset.id)
      ),
    [assets, taskAssetIds]
  )

  const assetSrc = useCallback(
    (asset: ImageAssetRecord) =>
      asset.path ? serviceHub.core().convertFileSrc(asset.path) : '',
    [serviceHub]
  )

  const selectedModelCanEdit = selectedModel?.model
    ? isImageEditModel(selectedModel.model)
    : false

  const inferredMode = useMemo<ImageGenerationMode>(() => {
    if (sourceAssets.length === 0) return 'generate'
    if (sourceAssets.length === 1 && !prompt.trim()) return 'variation'
    return 'edit'
  }, [prompt, sourceAssets.length])

  const sourceModelUnsupported = Boolean(
    sourceAssets.length > 0 && !selectedModelCanEdit
  )
  const submitDisabled =
    !selectedModel || sourceModelUnsupported || referenceAssetsLoading

  const updateTask = useCallback((id: string, patch: Partial<ImageTask>) => {
    setTasks((current) =>
      current.map((task) => (task.id === id ? { ...task, ...patch } : task))
    )
  }, [])

  const findTaskModel = useCallback(
    (task: ImageTask) =>
      imageModels.find(
        ({ provider, model }) =>
          provider.provider === task.providerName && model.id === task.modelId
      ),
    [imageModels]
  )

  const runTask = useCallback(
    async (task: ImageTask) => {
      const match = findTaskModel(task)
      if (!match) {
        updateTask(task.id, {
          status: 'failed',
          message: imageT(t, 'errors.modelUnavailable'),
        })
        return
      }

      const sourceAssets = task.sourceAssetIds
        .map((id) => resolveAssetById(id))
        .filter((asset): asset is ImageAssetRecord => Boolean(asset))
      const controller = new AbortController()
      controllers.current.set(task.id, controller)
      updateTask(task.id, {
        status: 'running',
        message: undefined,
        quotaError: undefined,
        requestError: undefined,
        retryAvailableAt: undefined,
      })
      trackMitaEvent('image_generation_started', {
        provider_id: match.provider.provider,
        model_id: match.model.id,
        mode: task.mode,
        ratio: task.ratio,
        quality: task.qualityPreset,
        source_asset_count: sourceAssets.length,
      })

      try {
        const images = await serviceHub.imageGeneration().generateImages({
          provider: match.provider,
          model: match.model,
          prompt: task.prompt,
          ratio: task.ratio,
          qualityPreset: task.qualityPreset,
          count: 1,
          mode: task.mode,
          sourceAssets,
          signal: controller.signal,
        })

        const image = images[0]
        const requestedSize =
          task.mode === 'generate'
            ? imageSizeForRatio(task.ratio, match.model.id)
            : imageEditSizeForRatio(
                task.ratio,
                match.model.id,
                match.provider.provider,
                match.provider.base_url
              )
        const actualSize = await readImageSize(image)
        const saved = await serviceHub.imageGeneration().saveAsset({
          id: task.id,
          prompt: task.prompt,
          mode: task.mode,
          provider: match.provider.provider,
          model: match.model.id,
          ratio: task.ratio,
          size: actualSize ?? requestedSize,
          quality:
            task.mode === 'generate'
              ? apiQualityForPreset(task.qualityPreset, match.model.id)
              : apiQualityForImageEditPreset(
                  task.qualityPreset,
                  match.model.id,
                  match.provider.provider,
                  match.provider.base_url
                ),
          sourceAssetIds: sourceAssets.map((asset) => asset.id),
          revisedPrompt: image.revisedPrompt,
          usage: image.usage,
          status: 'succeeded',
          mimeType: image.mimeType,
          b64Json: image.b64Json,
          extension: imageFileExtension(image.mimeType),
        })

        setAssets((current) => [saved, ...current])
        updateTask(task.id, { status: 'succeeded', asset: saved })
        trackMitaEvent('image_generation_completed', {
          provider_id: match.provider.provider,
          model_id: match.model.id,
          mode: task.mode,
          ratio: task.ratio,
          quality: task.qualityPreset,
          source_asset_count: sourceAssets.length,
          status: 'succeeded',
        })
        trackMitaEvent('image_asset_saved', {
          provider_id: match.provider.provider,
          model_id: match.model.id,
          mode: task.mode,
          ratio: task.ratio,
          quality: task.qualityPreset,
          source_asset_count: sourceAssets.length,
        })
      } catch (error) {
        const quotaError = providerQuotaErrorFromUnknown(error)
        const requestError = imageGenerationRequestErrorFromUnknown(error)
        const message =
          quotaError?.message ||
          (requestError
            ? imageRequestErrorMessage(t, requestError.toJSON())
            : undefined) ||
          (error instanceof Error
            ? error.message
            : imageT(t, 'errors.generationFailed'))
        const failedAt = Date.now()
        if (requestError) setNowMs(failedAt)
        const retryAvailableAt = requestError
          ? failedAt + requestError.retryAfterMs
          : undefined
        updateTask(task.id, {
          status: cancelledTasks.current.has(task.id) ? 'failed' : 'failed',
          message: cancelledTasks.current.has(task.id)
            ? imageT(t, 'status.canceled')
            : message,
          quotaError: cancelledTasks.current.has(task.id)
            ? undefined
            : quotaError?.toJSON(),
          requestError: cancelledTasks.current.has(task.id)
            ? undefined
            : requestError?.toJSON(),
          retryAvailableAt: cancelledTasks.current.has(task.id)
            ? undefined
            : retryAvailableAt,
        })
        trackMitaEvent('image_generation_failed', {
          provider_id: match.provider.provider,
          model_id: match.model.id,
          mode: task.mode,
          ratio: task.ratio,
          quality: task.qualityPreset,
          source_asset_count: sourceAssets.length,
          error_kind: cancelledTasks.current.has(task.id)
            ? 'cancelled'
            : quotaError
              ? 'quota'
              : requestError?.kind ?? 'generation',
        })
      } finally {
        controllers.current.delete(task.id)
        cancelledTasks.current.delete(task.id)
      }
    },
    [findTaskModel, resolveAssetById, serviceHub, t, updateTask]
  )

  const runQueue = useCallback(
    async (nextTasks: ImageTask[]) => {
      const pending = [...nextTasks]
      const workers = Array.from({ length: Math.min(2, pending.length) }, async () => {
        while (pending.length > 0) {
          const task = pending.shift()
          if (!task || cancelledTasks.current.has(task.id)) continue
          await runTask(task)
        }
      })

      await Promise.all(workers)
    },
    [runTask]
  )

  const startGeneration = useCallback(() => {
    if (referenceAssetsLoading) {
      toast.error(imageT(t, 'toast.waitForReferenceImport'))
      return
    }

    if (!selectedModel) {
      toast.error(imageT(t, 'toast.selectImageModelFirst'))
      return
    }

    const cleanPrompt = prompt.trim()
    if (sourceAssets.length === 0 && !cleanPrompt) {
      toast.error(imageT(t, 'toast.describeImageFirst'))
      return
    }

    if (sourceAssets.length > 0 && !selectedModelCanEdit) {
      toast.error(imageT(t, 'toast.selectEditCapableModel'))
      return
    }

    const nextMode = inferredMode
    const taskPrompt =
      cleanPrompt ||
      (nextMode === 'variation'
        ? imageT(t, 'defaultVariationPrompt')
        : imageT(t, 'defaultMultiSourcePrompt'))

    const batchId = createId()
    const createdAt = new Date().toISOString()
    const nextTasks: ImageTask[] = Array.from({ length: count }, () => ({
      id: createId(),
      batchId,
      createdAt,
      prompt: taskPrompt,
      mode: nextMode,
      providerName: selectedModel.provider.provider,
      modelId: selectedModel.model.id,
      ratio,
      qualityPreset,
      sourceAssetIds:
        nextMode === 'generate' ? [] : sourceAssets.map((asset) => asset.id),
      status: 'pending',
    }))

    setTasks((current) => [...nextTasks, ...current])
    setPrompt('')
    void runQueue(nextTasks)
  }, [
    count,
    inferredMode,
    prompt,
    qualityPreset,
    ratio,
    referenceAssetsLoading,
    runQueue,
    selectedModel,
    selectedModelCanEdit,
    sourceAssets,
    t,
  ])

  const retryTask = useCallback(
    (task: ImageTask) => {
      const seconds = retryInSeconds(task.retryAvailableAt, Date.now())
      if (seconds > 0) {
        toast.error(imageT(t, 'toast.retryCoolingDown', { seconds }))
        return
      }

      const retry: ImageTask = {
        ...task,
        id: createId(),
        batchId: createId(),
        createdAt: new Date().toISOString(),
        status: 'pending',
        message: undefined,
        quotaError: undefined,
        requestError: undefined,
        retryAvailableAt: undefined,
        asset: undefined,
      }
      setTasks((current) => [retry, ...current])
      void runQueue([retry])
    },
    [runQueue, t]
  )

  const rerunGroup = useCallback(
    (group: ImageTaskGroup) => {
      const batchId = createId()
      const createdAt = new Date().toISOString()
      const nextTasks: ImageTask[] = group.tasks.map((task) => ({
        ...task,
        id: createId(),
        batchId,
        createdAt,
        status: 'pending',
        message: undefined,
        quotaError: undefined,
        requestError: undefined,
        retryAvailableAt: undefined,
        asset: undefined,
      }))
      setTasks((current) => [...nextTasks, ...current])
      void runQueue(nextTasks)
    },
    [runQueue]
  )

  const regeneratePrompt = useCallback(
    (nextPrompt: string) => {
      if (!selectedModel) {
        toast.error(imageT(t, 'toast.selectImageModelFirst'))
        return
      }

      const cleanPrompt = nextPrompt.trim()
      if (!cleanPrompt) {
        toast.error(imageT(t, 'toast.describeImageFirst'))
        return
      }

      const batchId = createId()
      const createdAt = new Date().toISOString()
      const nextTasks: ImageTask[] = Array.from({ length: count }, () => ({
        id: createId(),
        batchId,
        createdAt,
        prompt: cleanPrompt,
        mode: 'generate',
        providerName: selectedModel.provider.provider,
        modelId: selectedModel.model.id,
        ratio,
        qualityPreset,
        sourceAssetIds: [],
        status: 'pending',
      }))
      setTasks((current) => [...nextTasks, ...current])
      void runQueue(nextTasks)
    },
    [count, qualityPreset, ratio, runQueue, selectedModel, t]
  )

  const cancelTask = (taskId: string) => {
    cancelledTasks.current.add(taskId)
    controllers.current.get(taskId)?.abort()
    updateTask(taskId, {
      status: 'failed',
      message: imageT(t, 'status.canceled'),
    })
  }

  const deleteAsset = async (asset: ImageAssetRecord) => {
    try {
      await serviceHub.imageGeneration().deleteAsset(asset.id)
      setAssets((current) => current.filter((item) => item.id !== asset.id))
      setSourceAssetRecords((current) =>
        current.filter((item) => item.id !== asset.id)
      )
      setSourceAssetIds((current) => current.filter((id) => id !== asset.id))
    } catch (error) {
      console.error('Failed to delete image asset:', error)
      toast.error(imageT(t, 'toast.deleteAssetFailed'))
    }
  }

  const showReferenceLimitToast = useCallback(() => {
    toast.error(
      imageT(t, 'toast.referenceLimitReached', {
        count: MAX_REFERENCE_IMAGES,
      })
    )
  }, [t])

  const addSourceAssets = useCallback((nextAssets: ImageAssetRecord[]) => {
    if (nextAssets.length === 0) return

    setSourceAssetRecords((current) => [
      ...nextAssets,
      ...current.filter(
        (asset) => !nextAssets.some((nextAsset) => nextAsset.id === asset.id)
      ),
    ])
    setSourceAssetIds((current) => {
      const merged = [...current]
      nextAssets.forEach((asset) => {
        if (!merged.includes(asset.id) && merged.length < MAX_REFERENCE_IMAGES) {
          merged.push(asset.id)
        }
      })
      return merged
    })
  }, [])

  const removeSourceAsset = useCallback((assetId: string) => {
    setSourceAssetIds((current) => current.filter((id) => id !== assetId))
  }, [])

  const editFromAsset = useCallback(
    (asset: ImageAssetRecord, nextPrompt?: string) => {
      if (
        !sourceAssetIds.includes(asset.id) &&
        sourceAssetIds.length >= MAX_REFERENCE_IMAGES
      ) {
        showReferenceLimitToast()
        return
      }

      addSourceAssets([asset])
      setPrompt(nextPrompt ?? asset.prompt)
    },
    [addSourceAssets, showReferenceLimitToast, sourceAssetIds]
  )

  const importReferenceAssets = useCallback(async () => {
    const selected = await serviceHub.dialog().open({
      multiple: true,
      filters: [
        {
          name: imageT(t, 'imageFiles'),
          extensions: ['png', 'jpg', 'jpeg', 'webp'],
        },
      ],
    })
    const sourcePaths = Array.isArray(selected) ? selected : selected ? [selected] : []
    if (sourcePaths.length === 0) return

    const remainingSlots = MAX_REFERENCE_IMAGES - sourceAssetIds.length
    if (remainingSlots <= 0) {
      showReferenceLimitToast()
      return
    }

    const pathsToImport = sourcePaths.slice(0, remainingSlots)
    if (sourcePaths.length > remainingSlots) {
      showReferenceLimitToast()
    }

    setReferenceAssetsLoading(true)
    try {
      const imported = await Promise.all(
        pathsToImport.map((sourcePath) =>
          serviceHub.imageGeneration().importAsset({
            id: createId(),
            sourcePath,
            prompt: localPromptFromPath(
              sourcePath,
              imageT(t, 'localReferenceImage')
            ),
          })
        )
      )
      setAssets((current) => [
        ...imported,
        ...current.filter(
          (asset) => !imported.some((nextAsset) => nextAsset.id === asset.id)
        ),
      ])
      addSourceAssets(imported)
      toast.success(imageT(t, 'toast.referenceImported'))
    } catch (error) {
      console.error('Failed to import reference image:', error)
      toast.error(imageT(t, 'toast.importReferenceFailed'))
    } finally {
      setReferenceAssetsLoading(false)
    }
  }, [
    addSourceAssets,
    serviceHub,
    showReferenceLimitToast,
    sourceAssetIds.length,
    t,
  ])

  const savePastedReferenceFiles = useCallback(
    async (files: File[]) => {
      const imageFiles = files.filter((file) => file.type.startsWith('image/'))
      if (imageFiles.length === 0) return

      const remainingSlots = MAX_REFERENCE_IMAGES - sourceAssetIds.length
      if (remainingSlots <= 0) {
        showReferenceLimitToast()
        return
      }

      const filesToSave = imageFiles.slice(0, remainingSlots)
      if (imageFiles.length > remainingSlots) {
        showReferenceLimitToast()
      }

      setReferenceAssetsLoading(true)
      try {
        const savedAssets: ImageAssetRecord[] = []
        for (const file of filesToSave) {
          const mimeType = file.type || 'image/png'
          const b64Json = await arrayBufferToBase64(
            await fileToArrayBuffer(file)
          )
          const size = await readImageSize({ b64Json, mimeType })
          const saved = await serviceHub.imageGeneration().saveAsset({
            id: createId(),
            prompt: localPromptFromPath(
              file.name,
              imageT(t, 'pastedReferenceImage')
            ),
            mode: 'edit',
            provider: 'local',
            model: 'reference-image',
            ratio: '1:1',
            size: size ?? 'original',
            quality: 'source',
            sourceAssetIds: [],
            status: 'succeeded',
            mimeType,
            b64Json,
            extension: imageFileExtension(mimeType),
            assetKind: 'reference',
          })
          savedAssets.push(saved)
        }

        setAssets((current) => [
          ...savedAssets,
          ...current.filter(
            (asset) =>
              !savedAssets.some((nextAsset) => nextAsset.id === asset.id)
          ),
        ])
        addSourceAssets(savedAssets)
        toast.success(imageT(t, 'toast.referenceImported'))
      } catch (error) {
        console.error('Failed to paste reference image:', error)
        toast.error(imageT(t, 'toast.importReferenceFailed'))
      } finally {
        setReferenceAssetsLoading(false)
      }
    },
    [
      addSourceAssets,
      serviceHub,
      showReferenceLimitToast,
      sourceAssetIds.length,
      t,
    ]
  )

  const openAsset = async (asset: ImageAssetRecord) => {
    try {
      await serviceHub.opener().revealItemInDir(asset.path)
    } catch {
      toast.error(imageT(t, 'toast.revealAssetFailed'))
    }
  }

  const copyPrompt = async (text: string) => {
    await navigator.clipboard.writeText(text)
    toast.success(imageT(t, 'toast.promptCopied'))
  }

  const groupStatus = (group: ImageTaskGroup): ImageGenerationStatus => {
    if (group.tasks.some((task) => task.status === 'running')) return 'running'
    if (group.tasks.some((task) => task.status === 'pending')) return 'pending'
    if (group.tasks.every((task) => task.status === 'succeeded')) return 'succeeded'
    return 'failed'
  }

  const cancelGroup = (group: ImageTaskGroup) => {
    group.tasks.forEach((task) => {
      if (task.status === 'pending' || task.status === 'running') {
        cancelTask(task.id)
      }
    })
  }

  const showAssetContextMenu = (
    event: MouseEvent,
    asset: ImageAssetRecord
  ) => {
    event.preventDefault()
    setContextMenu({
      asset,
      x: Math.min(event.clientX, window.innerWidth - 220),
      y: Math.min(event.clientY, window.innerHeight - 180),
    })
  }

  if (imageModels.length === 0) {
    return (
      <div className="flex h-svh max-h-svh flex-col overflow-hidden">
        <HeaderPage />
        <div className="flex flex-1 items-center justify-center px-6">
          <div className="max-w-md space-y-4 text-center">
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-secondary">
              <ImageIcon className="size-5 text-muted-foreground" />
            </div>
            <div className="space-y-2">
              <h1 className="text-lg font-medium text-foreground">
                {imageT(t, 'noImageModelsAvailable')}
              </h1>
              <p className="text-sm text-muted-foreground">
                {imageT(t, 'noImageModelsDescription')}
              </p>
            </div>
            <Button asChild>
              <Link to={route.settings.model_providers}>
                {imageT(t, 'openProviders')}
              </Link>
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-svh max-h-svh flex-col overflow-hidden bg-[#f7f8fa] dark:bg-background">
      <HeaderPage />

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <main className="h-full overscroll-contain overflow-y-auto px-5 pb-48 pt-4">
          <div className="mx-auto max-w-[1120px] space-y-8">
            <h2 className="text-2xl font-semibold tracking-normal text-foreground">
              {imageT(t, 'today')}
            </h2>

            {taskGroups.length === 0 && savedHistoryAssets.length === 0 ? (
              <div className="flex min-h-[360px] items-center justify-center text-sm text-muted-foreground">
                {imageT(t, 'emptyState')}
              </div>
            ) : (
              <>
                {taskGroups.map((group) => {
                  const groupSourceAssets = group.sourceAssetIds
                    .map((id) => resolveAssetById(id))
                    .filter((asset): asset is ImageAssetRecord => Boolean(asset))
                  const source = groupSourceAssets[0]
                  const status = groupStatus(group)
                  const firstAsset = group.tasks.find((task) => task.asset)?.asset
                  const running = group.tasks.some(
                    (task) => task.status === 'running' || task.status === 'pending'
                  )

                  return (
                    <section key={group.id} className="space-y-3">
                      <div className="flex items-start gap-3">
                        {source && (
                          <button
                            type="button"
                            className="mt-1 size-11 shrink-0 rotate-[-7deg] overflow-hidden rounded-sm bg-secondary shadow-sm"
                            onClick={() => editFromAsset(source, group.prompt)}
                            aria-label={imageT(t, 'useSourceImage')}
                          >
                            {source.path ? (
                              <img
                                src={assetSrc(source)}
                                alt={source.prompt}
                                className="size-full object-cover"
                              />
                            ) : (
                              <div className="flex size-full items-center justify-center">
                                <ImageIcon className="size-4 text-muted-foreground" />
                              </div>
                            )}
                          </button>
                        )}
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-foreground">
                            {source && (
                              <span className="text-muted-foreground">
                                {imageT(t, 'reference')}
                              </span>
                            )}
                            <span className="font-medium">{group.prompt}</span>
                            <span className="text-muted-foreground">
                              {group.modelId} · {group.ratio} ·{' '}
                              {qualityPresetLabel(t, group.qualityPreset)} ·{' '}
                              {imageCountLabel(t, group.tasks.length)}
                            </span>
                          </div>
                          <span
                            className={cn(
                              'inline-flex rounded-full px-2 py-0.5 text-xs capitalize',
                              status === 'succeeded' &&
                                'bg-emerald-500/10 text-emerald-600',
                              status === 'failed' &&
                                'bg-destructive/10 text-destructive',
                              status === 'running' &&
                                'bg-blue-500/10 text-blue-600',
                              status === 'pending' &&
                                'bg-secondary text-muted-foreground'
                            )}
                          >
                            {statusLabel(t, status)}
                          </span>
                        </div>
                      </div>

                      <div
                        className={cn(
                          'grid overflow-hidden rounded-sm bg-border',
                          group.tasks.length === 1
                            ? 'max-w-[360px] grid-cols-1'
                            : group.tasks.length === 2
                              ? 'grid-cols-2'
                              : 'grid-cols-2 md:grid-cols-4'
                        )}
                      >
                        {group.tasks.map((task) => {
                          const retrySeconds = retryInSeconds(
                            task.retryAvailableAt,
                            nowMs
                          )

                          return (
                            <div key={task.id} className="aspect-square bg-secondary">
                              {task.asset?.path ? (
                                <img
                                  src={assetSrc(task.asset)}
                                  alt={task.prompt}
                                  className="size-full object-cover"
                                  onContextMenu={(event) =>
                                    showAssetContextMenu(event, task.asset!)
                                  }
                                />
                              ) : (
                                <div className="flex size-full items-center justify-center bg-neutral-100 dark:bg-secondary">
                                  {task.status === 'running' ? (
                                    <Loader2 className="size-6 animate-spin text-muted-foreground" />
                                  ) : task.status === 'failed' ? (
                                    <div className="flex max-w-[86%] flex-col items-center gap-2 text-xs text-destructive">
                                      <button
                                        type="button"
                                        disabled={retrySeconds > 0}
                                        className={cn(
                                          'flex flex-col items-center gap-2',
                                          retrySeconds > 0 &&
                                            'cursor-not-allowed opacity-60'
                                        )}
                                        onClick={() => retryTask(task)}
                                      >
                                        <RefreshCcw className="size-5" />
                                        {retrySeconds > 0
                                          ? imageT(t, 'retryIn', {
                                              seconds: retrySeconds,
                                            })
                                          : imageT(t, 'retry')}
                                      </button>
                                      {task.message && (
                                        <span
                                          className="line-clamp-3 text-center text-[11px] leading-4 text-destructive/75"
                                          title={task.message}
                                        >
                                          {task.message}
                                        </span>
                                      )}
                                      <ProviderQuotaActions
                                        error={task.quotaError}
                                        className="items-center"
                                      />
                                    </div>
                                  ) : (
                                    <ImageIcon className="size-6 text-muted-foreground" />
                                  )}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={!firstAsset}
                          onClick={() => firstAsset && editFromAsset(firstAsset, group.prompt)}
                        >
                          <ImageIcon className="size-4" />
                          {imageT(t, 'reEdit')}
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => rerunGroup(group)}
                        >
                          <RefreshCcw className="size-4" />
                          {imageT(t, 'regenerate')}
                        </Button>
                        {running && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => cancelGroup(group)}
                          >
                            <X className="size-4" />
                            {t('common:cancel')}
                          </Button>
                        )}
                        <Button
                          variant="secondary"
                          size="icon-sm"
                          onClick={() => void copyPrompt(group.prompt)}
                        >
                          <Copy className="size-4" />
                        </Button>
                        <Button variant="secondary" size="icon-sm">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </div>
                    </section>
                  )
                })}

                {savedHistoryAssets.map((asset) => (
                  <section key={asset.id} className="space-y-3">
                    <div className="flex items-start gap-3">
                      <button
                        type="button"
                        className="mt-1 size-11 shrink-0 rotate-[-7deg] overflow-hidden rounded-sm bg-secondary shadow-sm"
                        onClick={() => editFromAsset(asset)}
                        aria-label={imageT(t, 'useSavedAsset')}
                      >
                        {asset.path ? (
                          <img
                            src={assetSrc(asset)}
                            alt={asset.prompt}
                            className="size-full object-cover"
                          />
                        ) : (
                          <div className="flex size-full items-center justify-center">
                            <ImageIcon className="size-4 text-muted-foreground" />
                          </div>
                        )}
                      </button>
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-foreground">
                          <span className="font-medium">{asset.prompt}</span>
                          <span className="text-muted-foreground">
                            {asset.model} · {asset.ratio} ·{' '}
                            {assetQualityLabel(t, asset.quality)}
                          </span>
                        </div>
                        <span className="inline-flex rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-600">
                          {imageT(t, 'status.saved')}
                        </span>
                      </div>
                    </div>

                    <div className="max-w-[360px] overflow-hidden rounded-sm bg-border">
                      <div className="aspect-square bg-secondary">
                        {asset.path ? (
                          <img
                            src={assetSrc(asset)}
                            alt={asset.prompt}
                            className="size-full object-cover"
                            onContextMenu={(event) => showAssetContextMenu(event, asset)}
                          />
                        ) : (
                          <div className="flex size-full items-center justify-center">
                            <ImageIcon className="size-6 text-muted-foreground" />
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => editFromAsset(asset)}
                      >
                        <ImageIcon className="size-4" />
                        {imageT(t, 'reEdit')}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => regeneratePrompt(asset.prompt)}
                      >
                        <RefreshCcw className="size-4" />
                        {imageT(t, 'regenerate')}
                      </Button>
                      <Button
                        variant="secondary"
                        size="icon-sm"
                        onClick={() => void copyPrompt(asset.prompt)}
                      >
                        <Copy className="size-4" />
                      </Button>
                      <Button
                        variant="secondary"
                        size="icon-sm"
                        onClick={() => void deleteAsset(asset)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </section>
                ))}
              </>
            )}
          </div>
        </main>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-[#f7f8fa] via-[#f7f8fa] to-transparent px-4 pb-5 pt-12 dark:from-background dark:via-background">
          <form
            className="pointer-events-auto mx-auto max-w-[960px] rounded-[28px] border bg-background/95 p-4 shadow-lg backdrop-blur"
            onSubmit={(event) => {
              event.preventDefault()
              startGeneration()
            }}
          >
            <div className="flex gap-4">
              <ReferenceImageStack
                assets={sourceAssets}
                assetSrc={assetSrc}
                loading={referenceAssetsLoading}
                onAdd={() => void importReferenceAssets()}
                onRemove={removeSourceAsset}
              />

              <Textarea
                className="min-h-20 flex-1 resize-none border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
                value={prompt}
                placeholder={imageT(t, 'promptPlaceholder')}
                onChange={(event) => setPrompt(event.target.value)}
                onPaste={(event) => {
                  const itemFiles = Array.from(event.clipboardData.items ?? [])
                    .filter((item) => item.kind === 'file')
                    .map((item) => item.getAsFile())
                    .filter((file): file is File => Boolean(file))
                  const clipboardFiles = Array.from(
                    event.clipboardData.files ?? []
                  )
                  const imageFiles = [...itemFiles, ...clipboardFiles].filter(
                    (file, index, allFiles) =>
                      file.type.startsWith('image/') &&
                      allFiles.findIndex(
                        (candidate) =>
                          candidate.name === file.name &&
                          candidate.size === file.size &&
                          candidate.type === file.type
                      ) === index
                  )

                  if (imageFiles.length === 0) return

                  event.preventDefault()
                  void savePastedReferenceFiles(imageFiles)
                }}
              />
            </div>

            {sourceModelUnsupported && (
              <p className="mt-3 text-xs text-destructive">
                {imageT(t, 'sourceModelUnsupported')}
              </p>
            )}

            <div className="mt-4 flex items-center justify-between gap-3">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <ImageModelPicker
                  imageModels={imageModels}
                  selectedModelKey={selectedModelKey}
                  onSelect={setSelectedModelKey}
                  showProviderName
                  side="top"
                  triggerClassName="box-border h-8 min-h-8 max-w-[240px] rounded-lg bg-secondary/60 px-3 text-xs"
                />

                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      aria-label={imageT(t, 'imageSizeSettings')}
                      className="box-border flex h-8 min-h-8 items-center gap-1 rounded-lg border bg-background px-2 text-[12px] font-normal leading-none transition-colors hover:bg-secondary/60"
                    >
                      <RatioGlyph
                        ratio={ratio}
                        selected
                        size={13}
                        borderWidth={1.5}
                      />
                      <span className="text-foreground">{ratio}</span>
                      <span className="text-muted-foreground/70">|</span>
                      <span>{qualityPresetCompactLabel(t, qualityPreset)}</span>
                      {qualityPreset === 'hd' && (
                        <Sparkles className="size-3 text-sky-500" />
                      )}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    side="top"
                    align="center"
                    sideOffset={10}
                    className="w-[calc(100vw-2rem)] max-w-[600px] rounded-[22px] border-0 bg-background/95 p-5 shadow-xl backdrop-blur"
                  >
                    <div className="space-y-5">
                      <div className="space-y-2.5">
                        <p className="text-sm font-medium text-muted-foreground">
                          {imageT(t, 'selectRatio')}
                        </p>
                        <div className="grid grid-cols-4 rounded-[18px] bg-secondary/70 p-1 sm:grid-cols-7">
                          {COMPOSER_RATIO_ORDER.map((item) => (
                            <button
                              key={item}
                              type="button"
                              className={cn(
                                'flex min-h-16 flex-col items-center justify-center gap-1 rounded-[14px] px-1.5 text-xs font-medium transition-colors',
                                ratio === item
                                  ? 'bg-background text-foreground shadow-sm'
                                  : 'text-foreground/80 hover:bg-background/60'
                              )}
                              onClick={() => setRatio(item)}
                            >
                              <RatioGlyph
                                ratio={item}
                                selected={ratio === item}
                                size={15}
                                borderWidth={1.6}
                              />
                              <span>{item}</span>
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-2.5">
                        <p className="text-sm font-medium text-muted-foreground">
                          {imageT(t, 'selectQuality')}
                        </p>
                        <div className="grid rounded-[16px] bg-secondary/70 p-1 sm:grid-cols-2">
                          {QUALITY_OPTIONS.map((option) => (
                            <button
                              key={option.value}
                              type="button"
                              className={cn(
                                'flex h-12 items-center justify-center gap-1.5 rounded-[12px] text-xs font-semibold transition-colors',
                                qualityPreset === option.value
                                  ? 'bg-background text-foreground shadow-sm'
                                  : 'text-foreground/80 hover:bg-background/60'
                              )}
                              onClick={() => setQualityPreset(option.value)}
                            >
                              {qualityPresetLabel(t, option.value)}
                              {option.value === 'hd' && (
                                <Sparkles className="size-3 text-sky-500" />
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>

                <div className="box-border flex h-8 min-h-8 items-center rounded-lg border bg-background">
                  <button
                    type="button"
                    aria-label={imageT(t, 'decreaseCount')}
                    className="flex size-8 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40"
                    disabled={count <= 1}
                    onClick={() => setCount((current) => Math.max(1, current - 1))}
                  >
                    <Minus className="size-3.5" />
                  </button>
                  <span className="min-w-8 text-center text-xs font-medium">
                    {count}
                  </span>
                  <button
                    type="button"
                    aria-label={imageT(t, 'increaseCount')}
                    className="flex size-8 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40"
                    disabled={count >= 8}
                    onClick={() => setCount((current) => Math.min(8, current + 1))}
                  >
                    <Plus className="size-3.5" />
                  </button>
                </div>
              </div>

              <div className="flex shrink-0 items-center">
                <Button
                  type="submit"
                  size="icon"
                  aria-label={imageT(t, 'generate')}
                  className="size-9 rounded-full"
                  disabled={submitDisabled}
                  title={
                    referenceAssetsLoading
                      ? imageT(t, 'toast.waitForReferenceImport')
                      : undefined
                  }
                >
                  <ArrowUp className="size-4" />
                </Button>
              </div>
            </div>
          </form>
        </div>
      </div>

      {contextMenu && (
        <div
          role="menu"
          className="fixed z-50 w-56 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
            onClick={() => {
              setPreviewAsset(contextMenu.asset)
              setContextMenu(null)
            }}
          >
            <Eye className="size-4 text-muted-foreground" />
            {t('common:preview')}
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
            onClick={() => {
              editFromAsset(contextMenu.asset)
              setContextMenu(null)
            }}
          >
            <ImageIcon className="size-4 text-muted-foreground" />
            {imageT(t, 'useAsSource')}
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!contextMenu.asset.path}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-50"
            onClick={() => {
              void openAsset(contextMenu.asset)
              setContextMenu(null)
            }}
          >
            <FolderOpen className="size-4 text-muted-foreground" />
            {imageT(t, openInSystemFileManagerKey())}
          </button>
        </div>
      )}

      <Dialog
        open={Boolean(previewAsset)}
        onOpenChange={(open) => {
          if (!open) setPreviewAsset(null)
        }}
      >
        <DialogContent
          className="max-w-[92vw] border-0 bg-black/95 p-3 shadow-2xl"
          showCloseButton
        >
          <DialogTitle className="sr-only">
            {imageT(t, 'imagePreview')}
          </DialogTitle>
          {previewAsset?.path ? (
            <img
              src={assetSrc(previewAsset)}
              alt={previewAsset.prompt}
              className="max-h-[82vh] w-full object-contain"
            />
          ) : (
            <div className="flex h-[60vh] items-center justify-center text-muted-foreground">
              <ImageIcon className="size-8" />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
