import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import TextareaAutosize from 'react-textarea-autosize'
import {
  AlertTriangle,
  ArrowUp,
  Check,
  ChevronsUpDown,
  Download,
  Eye,
  Film,
  Image as ImageIcon,
  Loader2,
  Minus,
  Music2,
  Plus,
  RotateCcw,
  Scan,
  Video,
  X,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Progress } from '@/components/ui/progress'
import { Switch } from '@/components/ui/switch'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import ProvidersAvatar from '@/containers/ProvidersAvatar'
import { isBiyuanProvider } from '@/constants/biyuan'
import { estimateSeedanceVideoCost } from '@/lib/seedance-video-cost'
import {
  cn,
  getModelDisplayName,
  getModelLogoProvider,
  getProviderTitle,
} from '@/lib/utils'
import type {
  VideoAssetRecord,
  VideoGenerationReference,
  VideoGenerationStatus,
  VideoRatio,
  VideoReferenceKind,
} from '@/services/video-generation/types'

const VIDEO_RATIOS: VideoRatio[] = [
  '16:9',
  '4:3',
  '1:1',
  '3:4',
  '9:16',
  '21:9',
  'adaptive',
]

const DIRECT_VIDEO_DURATION_MIN = 4
const DIRECT_VIDEO_DURATION_MAX = 15
const DIRECT_VIDEO_OFFICIAL_REFERENCE_LIMITS = {
  images: 9,
  videos: 3,
  audio: 3,
  total: 15,
} as const

const TOKEN_FORMATTER = new Intl.NumberFormat('zh-CN', {
  maximumFractionDigits: 0,
})

export type DirectVideoResolution = '480p' | '720p' | '1080p' | '4K'

export type DirectVideoModelOption = {
  provider: ModelProvider
  model: Model
}

export type DirectVideoGenerationInput = {
  provider: ModelProvider
  model: Model
  prompt: string
  ratio: VideoRatio
  duration: number
  resolution: DirectVideoResolution
  generateAudio: boolean
  references: VideoGenerationReference[]
}

export type DirectVideoRuntime = {
  status?: 'idle' | VideoGenerationStatus
  progress?: number
  error?: string
  connectionState?: 'connected' | 'reconnecting'
  retryAt?: number
}

export type VideoReferenceAssetOption = {
  reference: VideoGenerationReference
  displayName: string
  previewSrc?: string
  durationSeconds?: number
}

export type DirectVideoModeProps = {
  videoModels: DirectVideoModelOption[]
  runtime?: DirectVideoRuntime
  result?: ReactNode
  supportsSynchronizedAudio?: (option: DirectVideoModelOption) => boolean
  onPickReferences?: (
    selectedReferences: readonly VideoReferenceAssetOption[]
  ) => Promise<VideoReferenceAssetOption[]>
  loadPricePerMillionCny?: (
    option: DirectVideoModelOption
  ) => Promise<number | undefined>
  disabled?: boolean
  className?: string
  onGenerate: (input: DirectVideoGenerationInput) => void | Promise<void>
}

export type DirectVideoFeedItem = {
  id: string
  prompt: string
  provider?: string
  model: string
  ratio: VideoRatio
  resolution: DirectVideoResolution
  duration: number
  status: VideoGenerationStatus
  progress?: number
  error?: string
  connectionState?: 'connected' | 'reconnecting'
  retryAt?: number
  /** The provider task id is persisted, so this card can resume polling. */
  hasPersistedTask?: boolean
  asset?: VideoAssetRecord
  sourceImageSrc?: string
}

export type DirectVideoFeedProps = {
  items: DirectVideoFeedItem[]
  videoSrc: (asset: VideoAssetRecord) => string
  onPreview?: (asset: VideoAssetRecord) => void
  onDownload?: (asset: VideoAssetRecord) => void | Promise<void>
  onCancel?: (item: DirectVideoFeedItem) => void
  onRetry?: (item: DirectVideoFeedItem) => void
}

function modelKey(option: DirectVideoModelOption) {
  return `${option.provider.provider}:${option.model.id}`
}

function isSeedanceModel(option: DirectVideoModelOption) {
  return /seedance|sd2[.-]?0/i.test(option.model.id)
}

function directVideoResolutionOptions(
  modelId?: string
): DirectVideoResolution[] {
  const normalized = modelId?.toLowerCase() ?? ''
  if (normalized.includes('fast') || normalized.includes('mini')) {
    return ['480p', '720p']
  }
  return ['480p', '720p', '1080p', '4K']
}

const REFERENCE_KIND_LABELS: Record<VideoReferenceKind, string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
}

function referenceLimitForKind(kind: VideoReferenceKind) {
  if (kind === 'image') return DIRECT_VIDEO_OFFICIAL_REFERENCE_LIMITS.images
  if (kind === 'video') return DIRECT_VIDEO_OFFICIAL_REFERENCE_LIMITS.videos
  return DIRECT_VIDEO_OFFICIAL_REFERENCE_LIMITS.audio
}

function referenceKey(reference: VideoGenerationReference) {
  if (reference.asset) {
    return `${reference.kind}:asset:${reference.asset.id}`
  }
  return `${reference.kind}:url:${reference.url?.trim() ?? ''}`
}

function referenceCounts(options: VideoReferenceAssetOption[]) {
  return options.reduce(
    (counts, option) => {
      counts[option.reference.kind] += 1
      return counts
    },
    { image: 0, video: 0, audio: 0 } satisfies Record<
      VideoReferenceKind,
      number
    >
  )
}

function referenceIcon(kind: VideoReferenceKind, className = 'size-4') {
  if (kind === 'image') return <ImageIcon className={className} />
  if (kind === 'video') return <Video className={className} />
  return <Music2 className={className} />
}

function SegmentedButton({
  active,
  disabled,
  children,
  onClick,
}: {
  active: boolean
  disabled?: boolean
  children: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      className={cn(
        'min-h-10 rounded-xl px-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-foreground/80 hover:bg-background/60'
      )}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function RatioGlyph({
  ratio,
  selected,
  size = 19,
  borderWidth = 2,
}: {
  ratio: VideoRatio
  selected?: boolean
  size?: number
  borderWidth?: number
}) {
  if (ratio === 'adaptive') {
    return (
      <span
        aria-hidden="true"
        className="flex items-center justify-center"
        style={{ width: size + 4, height: size + 4 }}
      >
        <Scan
          className={cn(
            selected ? 'text-foreground' : 'text-muted-foreground'
          )}
          style={{ width: size, height: size }}
          strokeWidth={borderWidth}
        />
      </span>
    )
  }

  const [widthRatio, heightRatio] = ratio.split(':').map(Number)
  const width =
    widthRatio >= heightRatio
      ? size
      : Math.max(8, Math.round((size * widthRatio) / heightRatio))
  const height =
    heightRatio >= widthRatio
      ? size
      : Math.max(7, Math.round((size * heightRatio) / widthRatio))

  return (
    <span
      aria-hidden="true"
      className="flex items-center justify-center"
      style={{ width: size + 4, height: size + 4 }}
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

function ReferenceAssetPreview({
  option,
  disabled,
  expanded,
  onRemove,
}: {
  option: VideoReferenceAssetOption
  disabled: boolean
  expanded: boolean
  onRemove: () => void
}) {
  const kind = option.reference.kind
  const imageSrc =
    kind === 'image'
      ? option.previewSrc || option.reference.url
      : undefined
  const videoSrc =
    kind === 'video'
      ? option.previewSrc || option.reference.url
      : undefined

  return (
    <div
      className="group/reference-media relative size-16 shrink-0 overflow-hidden rounded-md border bg-secondary shadow-sm"
      title={option.displayName}
    >
      <div className="flex size-full items-center justify-center overflow-hidden bg-secondary/50 text-muted-foreground">
        {imageSrc ? (
          <img
            src={imageSrc}
            alt={option.displayName}
            className="size-full object-cover"
          />
        ) : videoSrc ? (
          <video
            src={videoSrc}
            aria-label={option.displayName}
            muted
            preload="metadata"
            className="size-full object-cover"
          />
        ) : (
          <div className="flex flex-col items-center gap-1">
            {referenceIcon(kind, 'size-5')}
            <span className="max-w-12 truncate text-[9px]">
              {REFERENCE_KIND_LABELS[kind]}
            </span>
          </div>
        )}
      </div>
      <button
        type="button"
        aria-label={`移除参考${REFERENCE_KIND_LABELS[kind]} ${option.displayName}`}
        disabled={disabled}
        className={cn(
          'absolute right-1 top-1 z-10 flex size-5 items-center justify-center rounded-full bg-background/90 text-foreground opacity-0 shadow transition-opacity hover:bg-background disabled:opacity-40',
          expanded &&
            'group-hover/reference-media:opacity-100 focus:opacity-100'
        )}
        onClick={(event) => {
          event.stopPropagation()
          onRemove()
        }}
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}

function ReferenceMediaStack({
  options,
  disabled,
  loading,
  onAdd,
  onRemove,
}: {
  options: VideoReferenceAssetOption[]
  disabled: boolean
  loading: boolean
  onAdd: () => void
  onRemove: (reference: VideoGenerationReference) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const hasOptions = options.length > 0
  const canAdd =
    options.length < DIRECT_VIDEO_OFFICIAL_REFERENCE_LIMITS.total
  const expandedWidth = Math.max(
    64,
    options.length * 58 + (canAdd ? 48 : 0)
  )
  const collapsedWidth = canAdd ? 90 : 76

  if (!hasOptions) {
    return (
      <button
        type="button"
        aria-label="添加参考素材"
        className="flex size-[58px] shrink-0 items-center justify-center rounded-[10px] border border-dashed border-[#cfcfd3] bg-transparent text-muted-foreground transition-colors hover:border-[#f7693f] hover:text-[#f7693f] disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled || loading}
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
      {options.map((option, index) => {
        const collapsedIndex = Math.min(index, 2)
        const left = expanded ? index * 58 : collapsedIndex * 9
        const rotation = expanded ? 0 : ([-6, 4, -2][collapsedIndex] ?? 0)
        return (
          <div
            key={referenceKey(option.reference)}
            className="absolute top-0 transition-all duration-200"
            style={{
              left,
              zIndex: expanded ? index + 1 : options.length - index,
              transform: `rotate(${rotation}deg)`,
            }}
          >
            <ReferenceAssetPreview
              option={option}
              disabled={disabled || loading}
              expanded={expanded}
              onRemove={() => onRemove(option.reference)}
            />
          </div>
        )
      })}

      {canAdd && (
        <button
          type="button"
          aria-label="添加参考素材"
          className="absolute top-3 flex size-10 items-center justify-center rounded-md border bg-background text-muted-foreground shadow-sm transition-all duration-200 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          style={{
            left: expanded ? options.length * 58 : 50,
            zIndex: options.length + 20,
          }}
          disabled={disabled || loading}
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

function videoStatusLabel(item: DirectVideoFeedItem) {
  if (item.connectionState === 'reconnecting') return '网络波动，正在重连'
  if (item.status === 'succeeded') return '已完成'
  if (item.status === 'failed') {
    return item.hasPersistedTask ? '查询已暂停' : '生成失败'
  }
  if (item.status === 'queued') return '排队中'
  return '生成中'
}

export function DirectVideoFeed({
  items,
  videoSrc,
  onPreview,
  onDownload,
  onCancel,
  onRetry,
}: DirectVideoFeedProps) {
  if (items.length === 0) {
    return (
      <div
        className="flex min-h-[360px] items-center justify-center text-sm text-muted-foreground"
        data-testid="direct-video-feed"
      >
        生成的视频会显示在这里。
      </div>
    )
  }

  return (
    <div className="space-y-5" data-testid="direct-video-feed">
      {items.map((item) => {
        const reconnecting = item.connectionState === 'reconnecting'
        const busy =
          reconnecting || item.status === 'queued' || item.status === 'running'
        const resumableFailure =
          item.status === 'failed' && item.hasPersistedTask && !reconnecting
        const src = item.asset ? videoSrc(item.asset) : ''

        return (
          <section
            key={item.id}
            className="w-full space-y-3 rounded-xl border bg-background p-[18px] shadow-sm"
          >
            <div className="flex items-start gap-2.5">
              {item.sourceImageSrc && (
                <div className="mt-0.5 size-10 shrink-0 rotate-[-7deg] overflow-hidden rounded-sm bg-secondary shadow-sm">
                  <img
                    src={item.sourceImageSrc}
                    alt=""
                    className="size-full object-cover"
                  />
                </div>
              )}
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-foreground">
                  {item.sourceImageSrc && (
                    <span className="text-muted-foreground">参考</span>
                  )}
                  <span className="select-text cursor-text font-medium">
                    {item.prompt}
                  </span>
                  <span className="text-muted-foreground">
                    {item.model} · {item.ratio} · {item.duration} 秒 ·{' '}
                    {item.resolution}
                  </span>
                </div>
                <span
                  className={cn(
                    'inline-flex rounded-full px-2 py-0.5 text-xs',
                    item.status === 'succeeded' &&
                      'bg-emerald-500/10 text-emerald-600',
                    item.status === 'failed' &&
                      !resumableFailure &&
                      !reconnecting &&
                      'bg-destructive/10 text-destructive',
                    item.status === 'running' &&
                      !reconnecting &&
                      'bg-blue-500/10 text-blue-600',
                    item.status === 'queued' &&
                      !reconnecting &&
                      'bg-secondary text-muted-foreground',
                    (reconnecting || resumableFailure) &&
                      'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                  )}
                >
                  {videoStatusLabel(item)}
                </span>
              </div>
            </div>

            <div className="aspect-video w-full max-w-[720px] overflow-hidden rounded-lg bg-neutral-100 dark:bg-secondary">
              {item.asset && src ? (
                <video
                  controls
                  playsInline
                  src={src}
                  className="size-full bg-black object-contain"
                />
              ) : busy ? (
                <div
                  className="flex size-full flex-col items-center justify-center gap-4 px-8"
                  aria-live="polite"
                >
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-5 animate-spin" />
                    {reconnecting
                      ? '网络波动，正在重连'
                      : item.status === 'queued'
                        ? '任务排队中'
                        : '视频生成中'}
                  </div>
                  <div className="w-full max-w-sm space-y-2">
                    <Progress value={item.progress ?? 0} className="h-1.5" />
                    <p className="text-center text-xs text-muted-foreground">
                      {Math.round(item.progress ?? 0)}%
                    </p>
                  </div>
                </div>
              ) : resumableFailure ? (
                <div className="flex size-full flex-col items-center justify-center gap-2 px-8 text-center text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="size-6" />
                  <p className="text-sm font-medium">视频任务查询已暂停</p>
                  <p className="max-w-md text-xs leading-5 text-muted-foreground">
                    任务仍在服务端，可继续查询原任务，不会重新生成。
                  </p>
                  {item.error && (
                    <p className="max-w-md text-xs leading-5 text-muted-foreground">
                      {item.error}
                    </p>
                  )}
                  {onRetry && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-1"
                      onClick={() => onRetry(item)}
                    >
                      <RotateCcw className="size-4" />
                      继续查询
                    </Button>
                  )}
                </div>
              ) : (
                <div className="flex size-full flex-col items-center justify-center gap-2 px-8 text-center text-destructive">
                  <AlertTriangle className="size-6" />
                  <p className="text-sm font-medium">视频生成失败</p>
                  {item.error && (
                    <p className="max-w-md text-xs leading-5 text-destructive/75">
                      {item.error}
                    </p>
                  )}
                  {onRetry && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-1"
                      onClick={() => onRetry(item)}
                    >
                      <RotateCcw className="size-4" />
                      重试
                    </Button>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {item.asset && onPreview && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => onPreview(item.asset!)}
                >
                  <Eye className="size-4" />
                  打开预览
                </Button>
              )}
              {item.status === 'succeeded' && item.asset && onDownload && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => void onDownload(item.asset!)}
                >
                  <Download className="size-4" />
                  下载
                </Button>
              )}
              {busy && onCancel && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onCancel(item)}
                >
                  <X className="size-4" />
                  取消
                </Button>
              )}
              {!item.asset && !busy && (
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Film className="size-3.5" />
                  {resumableFailure
                    ? '任务仍在服务端，可继续查询结果'
                    : '可修改提示词后重新生成'}
                </span>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}

export function DirectVideoMode({
  videoModels,
  runtime,
  result,
  supportsSynchronizedAudio,
  onPickReferences,
  loadPricePerMillionCny,
  disabled = false,
  className,
  onGenerate,
}: DirectVideoModeProps) {
  const seedanceModels = useMemo(
    () => videoModels.filter(isSeedanceModel),
    [videoModels]
  )
  const [selectedModelKey, setSelectedModelKey] = useState(() =>
    seedanceModels[0] ? modelKey(seedanceModels[0]) : ''
  )
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [ratio, setRatio] = useState<VideoRatio>('16:9')
  const [duration, setDuration] = useState(5)
  const [resolution, setResolution] = useState<DirectVideoResolution>('720p')
  const [generateAudio, setGenerateAudio] = useState(true)
  const [selectedReferences, setSelectedReferences] = useState<
    VideoReferenceAssetOption[]
  >([])
  const [referenceImporting, setReferenceImporting] = useState(false)
  const [pricePerMillionCny, setPricePerMillionCny] = useState<number>()
  const [pricingLoading, setPricingLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string>()
  const loadPriceRef = useRef(loadPricePerMillionCny)

  useEffect(() => {
    loadPriceRef.current = loadPricePerMillionCny
  }, [loadPricePerMillionCny])

  useEffect(() => {
    if (
      selectedModelKey &&
      seedanceModels.some((option) => modelKey(option) === selectedModelKey)
    ) {
      return
    }
    setSelectedModelKey(seedanceModels[0] ? modelKey(seedanceModels[0]) : '')
  }, [seedanceModels, selectedModelKey])

  const selectedModel = useMemo(
    () =>
      seedanceModels.find((option) => modelKey(option) === selectedModelKey),
    [seedanceModels, selectedModelKey]
  )
  const canUseReferences = Boolean(
    selectedModel &&
      isBiyuanProvider(
        selectedModel.provider.provider,
        selectedModel.provider.base_url
      )
  )
  const canGenerateSynchronizedAudio = Boolean(
    selectedModel &&
      (supportsSynchronizedAudio
        ? supportsSynchronizedAudio(selectedModel)
        : isSeedanceModel(selectedModel))
  )
  const resolutionOptions = useMemo(
    () => directVideoResolutionOptions(selectedModel?.model.id),
    [selectedModel?.model.id]
  )

  useEffect(() => {
    if (!canUseReferences) setSelectedReferences([])
  }, [canUseReferences])

  useEffect(() => {
    setGenerateAudio(canGenerateSynchronizedAudio)
  }, [canGenerateSynchronizedAudio])

  const pricingRequestKey = selectedModel
    ? `${modelKey(selectedModel)}:${selectedModel.provider.base_url ?? ''}`
    : ''
  const pricingModelRef = useRef(selectedModel)
  pricingModelRef.current = selectedModel

  useEffect(() => {
    let current = true
    setPricePerMillionCny(undefined)
    const loadPrice = loadPriceRef.current
    const pricingModel = pricingModelRef.current
    if (!pricingModel || !loadPrice) {
      setPricingLoading(false)
      return () => {
        current = false
      }
    }

    setPricingLoading(true)
    void loadPrice(pricingModel)
      .then((price) => {
        if (current) setPricePerMillionCny(price)
      })
      .catch(() => {
        if (current) setPricePerMillionCny(undefined)
      })
      .finally(() => {
        if (current) setPricingLoading(false)
      })

    return () => {
      current = false
    }
  }, [pricingRequestKey])

  useEffect(() => {
    if (!resolutionOptions.includes(resolution)) {
      setResolution('720p')
    }
  }, [resolution, resolutionOptions])

  const runtimeReconnecting = runtime?.connectionState === 'reconnecting'
  const runtimeBusy =
    runtimeReconnecting ||
    runtime?.status === 'queued' ||
    runtime?.status === 'running'
  const busy = submitting || runtimeBusy
  // Generation failures already surface on the failed card in the feed, so the
  // composer only shows errors from the submit action itself.
  const errorMessage = submitError
  const hasOnlyAudioReferences =
    selectedReferences.length > 0 &&
    selectedReferences.every((option) => option.reference.kind === 'audio')
  const canSubmit = Boolean(
    !disabled &&
      !busy &&
      selectedModel &&
      prompt.trim() &&
      !hasOnlyAudioReferences
  )
  const costEstimate = useMemo(
    () =>
      selectedModel
        ? estimateSeedanceVideoCost({
            model: selectedModel.model.id,
            ratio,
            resolution,
            duration,
            references: selectedReferences.map((option) => ({
              kind: option.reference.kind,
              durationSeconds: option.durationSeconds,
            })),
            pricePerMillionCny,
          })
        : undefined,
    [
      duration,
      pricePerMillionCny,
      ratio,
      resolution,
      selectedModel,
      selectedReferences,
    ]
  )
  const handlePickReferences = async () => {
    if (
      disabled ||
      busy ||
      referenceImporting ||
      !canUseReferences ||
      !onPickReferences
    ) {
      return
    }

    setSubmitError(undefined)
    setReferenceImporting(true)
    try {
      const picked = await onPickReferences(selectedReferences)
      setSelectedReferences((current) => {
        const next = [...current]
        const seen = new Set(
          current.map((item) => referenceKey(item.reference))
        )
        const counts = referenceCounts(current)

        for (const option of picked) {
          const key = referenceKey(option.reference)
          const kind = option.reference.kind
          if (
            seen.has(key) ||
            next.length >= DIRECT_VIDEO_OFFICIAL_REFERENCE_LIMITS.total ||
            counts[kind] >= referenceLimitForKind(kind)
          ) {
            continue
          }
          seen.add(key)
          counts[kind] += 1
          next.push(option)
        }
        return next
      })
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : '参考素材导入失败'
      )
    } finally {
      setReferenceImporting(false)
    }
  }
  const removeReference = (reference: VideoGenerationReference) => {
    const key = referenceKey(reference)
    setSelectedReferences((current) =>
      current.filter((option) => referenceKey(option.reference) !== key)
    )
  }

  const handleGenerate = async () => {
    if (!canSubmit || !selectedModel) return

    setSubmitError(undefined)
    setSubmitting(true)
    try {
      await onGenerate({
        provider: selectedModel.provider,
        model: selectedModel.model,
        prompt: prompt.trim(),
        ratio,
        duration,
        resolution,
        generateAudio,
        references: canUseReferences
          ? selectedReferences.map((option) => option.reference)
          : [],
      })
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : '视频生成请求提交失败'
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section
      className={cn('w-full space-y-3', className)}
      data-testid="direct-video-mode"
    >
      {result && (
        <div
          className="rounded-xl border bg-background p-3 shadow-sm"
          data-testid="direct-video-result"
        >
          {result}
        </div>
      )}

      <form
        className="w-full overflow-hidden rounded-2xl border bg-background shadow-[0_2px_10px_rgba(0,0,0,0.04)]"
        onSubmit={(event) => {
          event.preventDefault()
          void handleGenerate()
        }}
      >
        <div className="flex gap-3.5 px-[18px] py-4">
          <ReferenceMediaStack
            options={selectedReferences}
            disabled={
              disabled ||
              busy ||
              !canUseReferences ||
              !onPickReferences
            }
            loading={referenceImporting}
            onAdd={() => void handlePickReferences()}
            onRemove={removeReference}
          />

          <div className="min-w-0 flex-1">
            <TextareaAutosize
              aria-label="提示词"
              dir="auto"
              minRows={2}
              maxRows={10}
              value={prompt}
              disabled={disabled || busy}
              placeholder="描述主体、动作、场景、镜头运动与声音……"
              className="min-h-[42px] max-h-[40svh] w-full resize-none overflow-y-auto overscroll-contain border-0 bg-transparent p-0 pt-0.5 text-sm shadow-none outline-0 [scrollbar-gutter:stable] placeholder:text-muted-foreground focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-60"
              onChange={(event) => setPrompt(event.target.value)}
            />
            <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
              支持图片、视频和音频组合参考；最多15项，包括9图、3视频、3音频。
            </p>
            {hasOnlyAudioReferences && (
              <p className="mt-1 text-[11px] leading-4 text-amber-700 dark:text-amber-300">
                音频参考需与至少 1 张图片或 1 个视频组合使用。
              </p>
            )}
          </div>
        </div>

        {runtimeBusy && (
          <div
            className="space-y-1.5 border-t border-black/[0.06] px-[18px] py-2.5 dark:border-white/10"
            aria-live="polite"
          >
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {runtimeReconnecting
                  ? '网络波动，正在重连'
                  : runtime?.status === 'queued'
                    ? '任务排队中'
                    : '视频生成中'}
              </span>
              {typeof runtime?.progress === 'number' && (
                <span>{Math.round(runtime.progress)}%</span>
              )}
            </div>
            <Progress value={runtime?.progress ?? 0} className="h-1.5" />
          </div>
        )}

        {errorMessage && (
          <p
            role="alert"
            className="border-t border-destructive/10 bg-destructive/5 px-[18px] py-2 text-xs text-destructive"
          >
            {errorMessage}
          </p>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-black/[0.06] px-3.5 py-2.5 dark:border-white/10">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Popover open={modelPickerOpen} onOpenChange={setModelPickerOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="Seedance 模型"
                  disabled={disabled || busy || seedanceModels.length === 0}
                  className="box-border flex h-[30px] min-h-[30px] max-w-[260px] items-center gap-1.5 rounded-lg border bg-background px-3 text-xs transition-colors hover:bg-secondary/60 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {selectedModel && (
                    <ProvidersAvatar
                      provider={{
                        provider: getModelLogoProvider(
                          selectedModel.model.id,
                          selectedModel.provider.provider
                        ),
                      }}
                    />
                  )}
                  <span className="truncate font-medium">
                    {selectedModel
                      ? getModelDisplayName(selectedModel.model)
                      : '未配置 Seedance 模型'}
                  </span>
                  <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                side="top"
                align="start"
                sideOffset={10}
                className="w-[min(340px,calc(100vw-2rem))] p-1.5"
              >
                {seedanceModels.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-muted-foreground">
                    尚未配置可用的 Seedance 模型。
                  </p>
                ) : (
                  seedanceModels.map((option) => {
                    const key = modelKey(option)
                    const selected = key === selectedModelKey
                    return (
                      <button
                        key={key}
                        type="button"
                        aria-label={getModelDisplayName(option.model)}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-secondary/70',
                          selected && 'bg-primary/10'
                        )}
                        onClick={() => {
                          setSelectedModelKey(key)
                          setModelPickerOpen(false)
                        }}
                      >
                        <ProvidersAvatar
                          provider={{
                            provider: getModelLogoProvider(
                              option.model.id,
                              option.provider.provider
                            ),
                          }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {getModelDisplayName(option.model)}
                          </span>
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {getProviderTitle(option.provider.provider)}
                          </span>
                        </span>
                        {selected && <Check className="size-4 text-primary" />}
                      </button>
                    )
                  })
                )}
              </PopoverContent>
            </Popover>

            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="视频参数"
                  disabled={disabled || busy || !selectedModel}
                  className="box-border flex h-[30px] min-h-[30px] items-center gap-1.5 rounded-lg border bg-background px-2.5 text-[12px] font-normal leading-none transition-colors hover:bg-secondary/60 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <RatioGlyph
                    ratio={ratio}
                    selected
                    size={13}
                    borderWidth={1.5}
                  />
                  <span>{ratio === 'adaptive' ? '自适应' : ratio}</span>
                  <span className="text-muted-foreground/70">|</span>
                  <span>{duration} 秒</span>
                  <span className="text-muted-foreground/70">|</span>
                  <span>{resolution}</span>
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
                      画面比例
                    </p>
                    <div className="grid grid-cols-4 rounded-[18px] bg-secondary/70 p-1 sm:grid-cols-7">
                      {VIDEO_RATIOS.map((item) => (
                        <button
                          key={item}
                          disabled={disabled || busy}
                          aria-pressed={ratio === item}
                          className={cn(
                            'flex min-h-16 flex-col items-center justify-center gap-1 rounded-[14px] px-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
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
                          <span>{item === 'adaptive' ? '自适应' : item}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2.5">
                    <p className="text-sm font-medium text-muted-foreground">
                      分辨率
                    </p>
                    <div
                      className={cn(
                        'grid rounded-[16px] bg-secondary/70 p-1',
                        resolutionOptions.length === 2
                          ? 'grid-cols-2'
                          : 'grid-cols-4'
                      )}
                    >
                      {resolutionOptions.map((item) => (
                        <SegmentedButton
                          key={item}
                          active={resolution === item}
                          disabled={disabled || busy}
                          onClick={() => setResolution(item)}
                        >
                          {item}
                        </SegmentedButton>
                      ))}
                    </div>
                    <p className="text-[11px] leading-4 text-muted-foreground">
                      标准 Seedance 2.0 支持 480p、720p、1080p 和 4K；
                      Fast、Mini 仅支持 480p 和 720p。
                    </p>
                  </div>

                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <label
                        htmlFor="direct-video-duration"
                        className="text-sm font-medium text-muted-foreground"
                      >
                        视频时长
                      </label>
                      <span className="text-xs font-medium">{duration} 秒</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <input
                        id="direct-video-duration"
                        aria-label="视频时长"
                        type="range"
                        min={DIRECT_VIDEO_DURATION_MIN}
                        max={DIRECT_VIDEO_DURATION_MAX}
                        value={duration}
                        disabled={disabled || busy}
                        className="min-w-0 flex-1 accent-primary"
                        onChange={(event) =>
                          setDuration(Number(event.target.value))
                        }
                      />
                      <div className="flex h-9 items-center overflow-hidden rounded-xl border bg-background">
                        <button
                          type="button"
                          aria-label="减少视频时长"
                          className="flex size-9 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40"
                          disabled={
                            disabled ||
                            busy ||
                            duration <= DIRECT_VIDEO_DURATION_MIN
                          }
                          onClick={() =>
                            setDuration((value) =>
                              Math.max(DIRECT_VIDEO_DURATION_MIN, value - 1)
                            )
                          }
                        >
                          <Minus className="size-3.5" />
                        </button>
                        <span className="min-w-8 text-center text-xs">
                          {duration}
                        </span>
                        <button
                          type="button"
                          aria-label="增加视频时长"
                          className="flex size-9 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40"
                          disabled={
                            disabled ||
                            busy ||
                            duration >= DIRECT_VIDEO_DURATION_MAX
                          }
                          onClick={() =>
                            setDuration((value) =>
                              Math.min(DIRECT_VIDEO_DURATION_MAX, value + 1)
                            )
                          }
                        >
                          <Plus className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 rounded-2xl border bg-background p-3">
                    <Music2 className="size-4 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <label
                        htmlFor="direct-video-generate-audio"
                        className="cursor-pointer text-sm font-medium"
                      >
                        生成同步音频
                      </label>
                      <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                        {canGenerateSynchronizedAudio
                          ? '随画面生成对白、音效和背景音乐；关闭后输出无声视频。'
                          : '当前模型不支持生成同步声音。'}
                      </p>
                    </div>
                    <Switch
                      id="direct-video-generate-audio"
                      aria-label="生成同步音频"
                      checked={generateAudio}
                      disabled={
                        disabled || busy || !canGenerateSynchronizedAudio
                      }
                      onCheckedChange={setGenerateAudio}
                    />
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            {prompt.trim() && selectedModel && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="查看成本预估说明"
                    className="max-w-[220px] text-right text-[11px] leading-4 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {costEstimate?.estimatedTokens ? (
                      <>
                        <span className="block font-medium tabular-nums text-foreground/80">
                          {costEstimate.isLowerBound ? '至少' : ''}约{' '}
                          {TOKEN_FORMATTER.format(
                            costEstimate.estimatedTokens
                          )}{' '}
                          tokens
                        </span>
                        <span className="block tabular-nums">
                          {costEstimate.estimatedPriceCny !== undefined
                            ? `约 ¥${costEstimate.estimatedPriceCny.toFixed(2)}`
                            : pricingLoading
                              ? '正在读取 Biyuan 价格'
                              : '价格暂不可用'}
                        </span>
                      </>
                    ) : (
                      <span className="block">
                        {ratio === 'adaptive'
                          ? '自适应比例：生成后确定费用'
                          : '成本暂不可估算'}
                      </span>
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent
                  side="top"
                  align="end"
                  className="max-w-[320px] text-xs leading-5"
                >
                  按输出尺寸、24 fps、输出时长和可读取的参考视频时长估算。
                  Biyuan 价格来自当前公开计费接口，最终以任务 usage
                  和实际账单为准。
                </TooltipContent>
              </Tooltip>
            )}

            <Button
              type="submit"
              size="icon"
              aria-label={busy ? '正在生成' : '生成视频'}
              title={busy ? '正在生成' : '生成视频'}
              className="size-9 shrink-0 rounded-full bg-[#f36f4f] text-white hover:bg-[#e96346]"
              disabled={!canSubmit}
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ArrowUp className="size-4" />
              )}
            </Button>
          </div>
        </div>
      </form>
    </section>
  )
}
