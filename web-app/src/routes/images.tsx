import { createFileRoute, Link } from '@tanstack/react-router'
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronsUpDown,
  Copy,
  Crop,
  Download,
  Eye,
  Film,
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  Music,
  Minus,
  MoreHorizontal,
  Pencil,
  Plus,
  Play,
  RefreshCcw,
  Redo2,
  Save,
  SlidersHorizontal,
  Sparkles,
  Square,
  Trash2,
  Undo2,
  Upload,
  WandSparkles,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import {
  type ReactNode,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { toast } from 'sonner'
import { IconLayoutSidebar } from '@tabler/icons-react'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'

import { ProviderQuotaActions } from '@/components/ProviderQuotaActions'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
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
import { getVideoModels, videoFileExtension } from '@/lib/video-generation'
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
import { ModelCapabilities } from '@/types/models'
import { DownloadManagement } from '@/containers/DownloadManegement'
import { useLeftPanel } from '@/hooks/useLeftPanel'
import type {
  ImageAssetRecord,
  ImageGenerationStatus,
} from '@/services/image-generation/types'
import type {
  VideoAssetRecord,
  VideoGenerationStatus,
  VideoResolution,
} from '@/services/video-generation/types'

export const Route = createFileRoute(route.images as '/images')({
  component: Images,
})

function MediaHeader({ children }: { children?: ReactNode }) {
  const { open, setLeftPanel } = useLeftPanel()

  return (
    <div
      className={cn(
        'flex h-[52px] shrink-0 items-center border-b border-black/[0.06] bg-[#fbfbfa] px-[22px] dark:border-white/10 dark:bg-background',
        IS_MACOS && !open && 'pl-24',
        IS_WINDOWS && 'pr-28'
      )}
    >
      <div className="flex h-full min-w-0 flex-1 items-center gap-1">
        {!open && (
          <>
            <DownloadManagement />
            <Button
              variant="ghost"
              size="icon-sm"
              className="relative z-50 rounded-full"
              onClick={() => setLeftPanel(!open)}
              aria-label="Toggle sidebar"
            >
              <IconLayoutSidebar className="relative size-4.5 text-muted-foreground" />
            </Button>
          </>
        )}
        <div className="h-full min-w-0 flex-1">{children}</div>
      </div>
    </div>
  )
}

function TauriDragSpacer() {
  const dragRegionProps =
    IS_TAURI && IS_LINUX
      ? {
          onMouseDown: (event: MouseEvent<HTMLDivElement>) => {
            if (event.button !== 0) return
            void getCurrentWebviewWindow().startDragging()
          },
        }
      : IS_TAURI
        ? { 'data-tauri-drag-region': true as const }
        : {}

  return (
    <div
      className="min-w-0 flex-1 self-stretch cursor-grab select-none active:cursor-grabbing"
      title="Drag window"
      aria-label="Window drag area"
      {...dragRegionProps}
    />
  )
}

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

type ModelPickerOption = {
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

type MediaMode = 'image' | 'storyboard' | 'long-video'

type StoryboardStage = 'compose' | 'storyboard' | 'video'

type StoryboardShot = {
  id: string
  title: string
  camera: string
  prompt: string
  duration: number
}

type StoryboardSettings = {
  style: string
  aspect: ImageRatio
  qualityPreset: ImageQualityPreset
  variantCount: number
  template: 'grid' | 'table' | 'board'
  consistency: 'standard' | 'strong' | 'lockedCharacter'
}

type VideoSettings = {
  ratio: ImageRatio
  resolution: VideoResolution
  duration: number
  fps: number
  camera: string
  motion: number
  generateAudio: boolean
}

type VideoModelOption = {
  provider: ModelProvider
  model: Model
}

type TextModelOption = {
  provider: ModelProvider
  model: Model
}

type StoryPromptTab = {
  id: string
  label: string
  prompt: string
  shots: StoryboardShot[]
  createdAt: string
}

type StoryboardAssetVersion = {
  id: string
  label: string
  asset: ImageAssetRecord
  kind: 'original' | 'edited'
  createdAt: string
}

type StoryboardEditorTool = 'pen' | 'rect' | 'crop'

type CanvasPoint = {
  x: number
  y: number
}

type CanvasRect = {
  x: number
  y: number
  width: number
  height: number
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
const STORYBOARD_STYLES = [
  { value: '电影感', labelKey: 'storyboard.styles.cinematic' },
  { value: '3D 动画', labelKey: 'storyboard.styles.animation3d' },
  { value: '写实摄影', labelKey: 'storyboard.styles.realisticPhoto' },
  { value: '赛博朋克', labelKey: 'storyboard.styles.cyberpunk' },
  { value: '水彩插画', labelKey: 'storyboard.styles.watercolor' },
  { value: '极简留白', labelKey: 'storyboard.styles.minimal' },
] as const
const STORYBOARD_TEMPLATES: Array<{
  value: StoryboardSettings['template']
  label: string
  labelKey: string
  description: string
  descriptionKey: string
}> = [
  {
    value: 'grid',
    label: '网格分镜',
    labelKey: 'storyboard.templates.grid.label',
    description: '分格漫画式',
    descriptionKey: 'storyboard.templates.grid.description',
  },
  {
    value: 'table',
    label: '分镜表',
    labelKey: 'storyboard.templates.table.label',
    description: '镜头表格',
    descriptionKey: 'storyboard.templates.table.description',
  },
  {
    value: 'board',
    label: '视觉开发板',
    labelKey: 'storyboard.templates.board.label',
    description: '含色卡/参考/参数',
    descriptionKey: 'storyboard.templates.board.description',
  },
]
const STORYBOARD_CONSISTENCY_OPTIONS: Array<{
  value: StoryboardSettings['consistency']
  labelKey: string
  prompt: string
}> = [
  {
    value: 'standard',
    labelKey: 'storyboard.consistency.standard',
    prompt: '标准连续性，保持色调、构图和角色设定一致。',
  },
  {
    value: 'strong',
    labelKey: 'storyboard.consistency.strong',
    prompt: '强连续性，严格保持角色外观、服装、材质、镜头语言和色彩方案一致。',
  },
  {
    value: 'lockedCharacter',
    labelKey: 'storyboard.consistency.lockedCharacter',
    prompt:
      '锁定角色，所有分镜必须保持同一主角身份、面部/机械结构、材质、比例和关键服饰完全一致。',
  },
]
const STORYBOARD_ASPECT_OPTIONS: ImageRatio[] = [
  '21:9',
  '16:9',
  '4:3',
  '1:1',
  '3:4',
  '9:16',
]
const VIDEO_ASPECT_OPTIONS: ImageRatio[] = STORYBOARD_ASPECT_OPTIONS
const STORYBOARD_VARIANT_MIN = 1
const STORYBOARD_VARIANT_MAX = 6
const DEFAULT_STORYBOARD_SHOT_COUNT = 6
const VIDEO_DURATION_MIN = 4
const VIDEO_DURATION_MAX = 15
const VIDEO_RESOLUTION_OPTIONS: VideoResolution[] = ['720p', '1080p']
const STORYBOARD_EDITOR_COLORS = [
  '#f36f4f',
  '#2563eb',
  '#16a34a',
  '#facc15',
  '#111827',
  '#ffffff',
] as const
const STORYBOARD_PREVIEW_ZOOM_MIN = 0.35
const STORYBOARD_PREVIEW_ZOOM_MAX = 4
const STORYBOARD_EDITOR_ZOOM_MIN = 0.35
const STORYBOARD_EDITOR_ZOOM_MAX = 3
const STORYBOARD_CAMERA_PRESETS = [
  '缓慢推近',
  '横移跟随',
  '低角度',
  '环绕',
  '缓慢拉远',
  '微距特写',
  '手持跟随',
  '固定镜头',
]

function qualityPresetLabel(t: TranslationFn, preset: ImageQualityPreset) {
  const option = QUALITY_OPTIONS.find((item) => item.value === preset)
  return imageT(t, option?.labelKey ?? `quality.${preset}`)
}

function qualityPresetCompactLabel(
  t: TranslationFn,
  preset: ImageQualityPreset
) {
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
    error.sourceImageIndex ? { index: error.sourceImageIndex } : undefined
  )
}

function retryInSeconds(retryAvailableAt: number | undefined, nowMs: number) {
  if (!retryAvailableAt || retryAvailableAt <= nowMs) return 0
  return Math.ceil((retryAvailableAt - nowMs) / 1000)
}

function clampValue(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function dataUrlToBase64(dataUrl: string) {
  return dataUrl.includes(',') ? (dataUrl.split(',')[1] ?? '') : dataUrl
}

function canvasPointFromEvent(
  event: ReactPointerEvent<HTMLCanvasElement>,
  canvas: HTMLCanvasElement
): CanvasPoint {
  const rect = canvas.getBoundingClientRect()
  const scaleX = canvas.width / Math.max(1, rect.width)
  const scaleY = canvas.height / Math.max(1, rect.height)
  return {
    x: clampValue((event.clientX - rect.left) * scaleX, 0, canvas.width),
    y: clampValue((event.clientY - rect.top) * scaleY, 0, canvas.height),
  }
}

function normalizeCanvasRect(start: CanvasPoint, end: CanvasPoint): CanvasRect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  }
}

function overlayRectFromPoints(
  start: CanvasPoint,
  end: CanvasPoint,
  canvas: HTMLCanvasElement
) {
  const rect = normalizeCanvasRect(start, end)
  const bounds = canvas.getBoundingClientRect()
  const scaleX = bounds.width / Math.max(1, canvas.width)
  const scaleY = bounds.height / Math.max(1, canvas.height)
  return {
    left: rect.x * scaleX,
    top: rect.y * scaleY,
    width: rect.width * scaleX,
    height: rect.height * scaleY,
  }
}

function statusLabel(t: TranslationFn, status: ImageGenerationStatus) {
  return imageT(t, `status.${status}`)
}

function imageModelKey(option: ModelPickerOption) {
  return `${option.provider.provider}::${option.model.id}`
}

function getStoryboardTextModels(
  providers: ModelProvider[]
): TextModelOption[] {
  return providers.flatMap((provider) =>
    provider.models
      .filter((model) => isStoryboardTextModel(model))
      .map((model) => ({ provider, model }))
  )
}

function isStoryboardTextModel(model: Model) {
  const capabilities = model.capabilities ?? []
  return (
    capabilities.includes(ModelCapabilities.COMPLETION) &&
    !capabilities.includes(ModelCapabilities.IMAGE_GENERATION) &&
    !capabilities.includes(ModelCapabilities.VIDEO_GENERATION) &&
    !model.embedding
  )
}

function createId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
}

function defaultStoryboardSettings(): StoryboardSettings {
  return {
    style: '电影感',
    aspect: '16:9',
    qualityPreset: 'sd',
    variantCount: 3,
    template: 'board',
    consistency: 'lockedCharacter',
  }
}

function defaultVideoSettings(): VideoSettings {
  return {
    ratio: '16:9',
    resolution: '1080p',
    duration: 8,
    fps: 30,
    camera: '自动',
    motion: 55,
    generateAudio: true,
  }
}

function storyboardConsistencyPrompt(
  consistency: StoryboardSettings['consistency']
) {
  return (
    STORYBOARD_CONSISTENCY_OPTIONS.find((item) => item.value === consistency)
      ?.prompt ?? STORYBOARD_CONSISTENCY_OPTIONS[0]!.prompt
  )
}

function buildStoryboardShots(story: string, count: number): StoryboardShot[] {
  const trimmed = story.trim()
  const beats = trimmed
    .split(/[。！？.!?\n]+/)
    .map((item) => item.trim())
    .filter(Boolean)
  const fallback =
    trimmed || '一个角色穿过具有电影感的场景，并在结尾完成一个清晰动作。'

  return Array.from({ length: count }, (_, index) => {
    const beat = beats[index % Math.max(1, beats.length)] || fallback
    const camera =
      STORYBOARD_CAMERA_PRESETS[index % STORYBOARD_CAMERA_PRESETS.length]
    return {
      id: createId(),
      title: `镜头 ${index + 1}`,
      camera,
      prompt: `${beat}。${camera}，保持电影级连续性、主体轮廓清晰、角色材质一致，编号分镜 ${index + 1}。`,
      duration: 5,
    }
  })
}

function buildStoryboardPrompt(
  story: string,
  settings: StoryboardSettings,
  shots: StoryboardShot[]
) {
  const templateLabel =
    STORYBOARD_TEMPLATES.find((item) => item.value === settings.template)
      ?.label ?? '视觉开发板'
  const consistencyPrompt = storyboardConsistencyPrompt(settings.consistency)
  const shotLines = shots
    .map(
      (shot, index) =>
        `${index + 1}. ${shot.title}: ${shot.camera}. ${shot.prompt}`
    )
    .join('\n')

  return [
    `创建一张 ${settings.aspect}「${templateLabel}」，整体呈现 ${settings.style} 风格。`,
    `在单张图片内清晰排列 ${shots.length} 个编号分镜，每格标注镜头编号、运镜方式和一句画面描述。`,
    `故事：${story.trim()}`,
    `镜头一致性：${consistencyPrompt}`,
    '排版专业、结构清晰、分区明确，避免文字混乱、低质拼贴、角色不一致。',
    shotLines,
  ].join('\n')
}

function buildVideoPrompt(
  story: string,
  shots: StoryboardShot[],
  videoSettings: VideoSettings
) {
  const shotLines = shots
    .map(
      (shot, index) =>
        `${index + 1}. ${shot.camera}, ${shot.duration}s: ${shot.prompt}`
    )
    .join('\n')

  return [
    '将这张故事板动画化为一支连贯短片。',
    `故事：${story.trim()}`,
    `目标：${videoSettings.duration}s，${videoSettings.ratio}，${videoSettings.resolution}，${videoSettings.fps}fps。`,
    `默认运镜：${videoSettings.camera}。运动幅度：${videoSettings.motion}/100。`,
    '严格保留来源故事板中的角色身份、材质、色板和镜头顺序。',
    shotLines,
  ].join('\n')
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
    reader.onerror = () =>
      reject(reader.error ?? new Error('Failed to read file'))
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
          expanded &&
            'group-hover/reference-thumb:opacity-100 focus:opacity-100'
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
        className="flex size-[58px] shrink-0 items-center justify-center rounded-[10px] border border-dashed border-[#cfcfd3] bg-transparent text-muted-foreground transition-colors hover:border-[#f7693f] hover:text-[#f7693f]"
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
        const rotation = expanded ? 0 : ([-6, 4, -2][collapsedIndex] ?? 0)

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
  triggerAriaLabelKey = 'imageModel',
  fallbackLabelKey = 'selectImageModel',
  searchPlaceholderKey = 'searchImageModels',
  emptyLabelKey = 'noImageModelsFound',
  side = 'bottom',
  align = 'start',
}: {
  imageModels: ModelPickerOption[]
  selectedModelKey: string
  onSelect: (value: string) => void
  triggerClassName?: string
  labelPrefix?: string
  showProviderName?: boolean
  triggerAriaLabelKey?: string
  fallbackLabelKey?: string
  searchPlaceholderKey?: string
  emptyLabelKey?: string
  side?: 'top' | 'bottom'
  align?: 'start' | 'center' | 'end'
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [searchValue, setSearchValue] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  const selected = useMemo(
    () =>
      imageModels.find((option) => imageModelKey(option) === selectedModelKey),
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
    return filteredModels.reduce<Record<string, ModelPickerOption[]>>(
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
    : imageT(t, fallbackLabelKey)
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
          aria-label={imageT(t, triggerAriaLabelKey)}
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
            <TooltipContent>
              {selected?.model.id ?? displayModel}
            </TooltipContent>
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
              placeholder={imageT(t, searchPlaceholderKey)}
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
                {imageT(t, emptyLabelKey)}
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

function StoryboardStepper({
  stage,
  setStage,
  hasStoryboard,
}: {
  stage: StoryboardStage
  setStage: (stage: StoryboardStage) => void
  hasStoryboard: boolean
}) {
  const { t } = useTranslation()
  const steps: Array<{ value: StoryboardStage; label: string }> = [
    { value: 'compose', label: imageT(t, 'storyboard.step.compose') },
    { value: 'storyboard', label: imageT(t, 'storyboard.step.storyboard') },
    { value: 'video', label: imageT(t, 'storyboard.step.video') },
  ]
  const activeIndex = steps.findIndex((item) => item.value === stage)

  return (
    <div className="flex min-w-0 items-center overflow-x-auto py-1">
      {steps.map((step, index) => {
        const disabled = index > 0 && !hasStoryboard
        const done = index < activeIndex
        return (
          <div key={step.value} className="flex shrink-0 items-center">
            {index > 0 && (
              <div
                className={cn(
                  'mx-3 h-px w-12 rounded-full bg-[#e2e2e5]',
                  index <= activeIndex && 'bg-[#f36f4f]'
                )}
              />
            )}
            <button
              type="button"
              disabled={disabled}
              className={cn(
                'flex h-8 items-center gap-2 rounded-lg px-0 text-[13px] transition-colors',
                disabled
                  ? 'cursor-not-allowed text-muted-foreground/45'
                  : 'text-muted-foreground hover:text-foreground',
                index === activeIndex && 'font-semibold text-foreground',
                done && 'text-muted-foreground'
              )}
              onClick={() => !disabled && setStage(step.value)}
            >
              <span
                className={cn(
                  'flex size-6 items-center justify-center rounded-full border border-transparent bg-[#f3f3f2] font-mono text-xs font-semibold text-muted-foreground transition-colors',
                  index === activeIndex && 'bg-[#f36f4f] text-white',
                  done && 'bg-emerald-500/10 text-emerald-600'
                )}
              >
                {done ? <Check className="size-3.5" /> : index + 1}
              </span>
              <span>{step.label}</span>
            </button>
          </div>
        )
      })}
    </div>
  )
}

function StoryboardPreviewDialog({
  open,
  onOpenChange,
  asset,
  src,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  asset?: ImageAssetRecord
  src: string
}) {
  const { t } = useTranslation()
  const [zoom, setZoom] = useState(1)

  useEffect(() => {
    if (open) setZoom(1)
  }, [asset?.id, open])

  const updateZoom = (delta: number) => {
    setZoom((current) =>
      clampValue(
        Number((current + delta).toFixed(2)),
        STORYBOARD_PREVIEW_ZOOM_MIN,
        STORYBOARD_PREVIEW_ZOOM_MAX
      )
    )
  }

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    updateZoom(event.deltaY < 0 ? 0.12 : -0.12)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[88vh] max-w-[92vw] flex-col gap-3 p-0">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
          <DialogTitle className="min-w-0 flex-1 truncate text-base">
            {imageT(t, 'storyboard.previewTitle')}
          </DialogTitle>
          <div className="flex items-center gap-1 rounded-lg bg-secondary p-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={imageT(t, 'storyboard.zoomOut')}
              onClick={() => updateZoom(-0.2)}
            >
              <ZoomOut className="size-4" />
            </Button>
            <span className="min-w-12 text-center font-mono text-xs text-muted-foreground">
              {Math.round(zoom * 100)}%
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={imageT(t, 'storyboard.zoomIn')}
              onClick={() => updateZoom(0.2)}
            >
              <ZoomIn className="size-4" />
            </Button>
          </div>
        </div>

        <div
          className="min-h-0 flex-1 overflow-auto bg-[#f4f5f7] p-6"
          onWheel={handleWheel}
        >
          {asset && src ? (
            <div className="flex min-h-full items-center justify-center">
              <img
                src={src}
                alt={asset.prompt}
                className="max-h-none max-w-none rounded-lg bg-background shadow-sm"
                style={{
                  transform: `scale(${zoom})`,
                  transformOrigin: 'center',
                  maxWidth: zoom <= 1 ? '100%' : 'none',
                }}
              />
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {imageT(t, 'storyboard.noStoryboardPreview')}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function StoryboardImageEditorDialog({
  open,
  onOpenChange,
  asset,
  src,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  asset?: ImageAssetRecord
  src: string
  onSave: (edited: {
    b64Json: string
    mimeType: string
    size: string
  }) => Promise<void>
}) {
  const { t } = useTranslation()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawingRef = useRef<{
    start: CanvasPoint
    last: CanvasPoint
  } | null>(null)
  const [tool, setTool] = useState<StoryboardEditorTool>('pen')
  const [color, setColor] = useState<(typeof STORYBOARD_EDITOR_COLORS)[number]>(
    STORYBOARD_EDITOR_COLORS[0]
  )
  const [zoom, setZoom] = useState(1)
  const [editorCanvas, setEditorCanvas] = useState<HTMLCanvasElement | null>(
    null
  )
  const [ready, setReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [draftRect, setDraftRect] = useState<{
    left: number
    top: number
    width: number
    height: number
  } | null>(null)

  const setCanvasElement = useCallback((canvas: HTMLCanvasElement | null) => {
    canvasRef.current = canvas
    setEditorCanvas(canvas)
  }, [])

  const currentContext = () => canvasRef.current?.getContext('2d') ?? null

  const snapshotCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return ''
    return canvas.toDataURL('image/png')
  }, [])

  const pushHistory = useCallback(() => {
    const snapshot = snapshotCanvas()
    if (!snapshot) return
    setHistory((current) => {
      const next = current.slice(0, historyIndex + 1)
      next.push(snapshot)
      return next
    })
    setHistoryIndex((current) => current + 1)
  }, [historyIndex, snapshotCanvas])

  const drawSnapshot = useCallback((snapshot: string) => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context || !snapshot) return

    const image = new Image()
    image.onload = () => {
      const width = image.naturalWidth || image.width || canvas.width
      const height = image.naturalHeight || image.height || canvas.height
      canvas.width = Math.max(1, width)
      canvas.height = Math.max(1, height)
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      setReady(true)
    }
    image.src = snapshot
  }, [])

  useEffect(() => {
    if (!open || !asset || !src) return

    const canvas = editorCanvas
    const context = canvas?.getContext('2d')
    if (!canvas || !context) {
      setReady(false)
      return
    }

    setReady(false)
    setSaving(false)
    setTool('pen')
    setZoom(1)
    setDraftRect(null)

    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => {
      try {
        const width = image.naturalWidth || image.width || 1024
        const height = image.naturalHeight || image.height || 576
        canvas.width = Math.max(1, width)
        canvas.height = Math.max(1, height)
        context.clearRect(0, 0, canvas.width, canvas.height)
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        const snapshot = canvas.toDataURL('image/png')
        setHistory([snapshot])
        setHistoryIndex(0)
        setReady(true)
      } catch (error) {
        console.error('Failed to initialize storyboard editor:', error)
        setReady(false)
      }
    }
    image.onerror = () => {
      setReady(false)
    }
    image.src = src
  }, [asset, editorCanvas, open, src])

  const undo = () => {
    if (historyIndex <= 0) return
    const nextIndex = historyIndex - 1
    setHistoryIndex(nextIndex)
    drawSnapshot(history[nextIndex]!)
  }

  const redo = () => {
    if (historyIndex >= history.length - 1) return
    const nextIndex = historyIndex + 1
    setHistoryIndex(nextIndex)
    drawSnapshot(history[nextIndex]!)
  }

  const updateZoom = (delta: number) => {
    setZoom((current) =>
      clampValue(
        Number((current + delta).toFixed(2)),
        STORYBOARD_EDITOR_ZOOM_MIN,
        STORYBOARD_EDITOR_ZOOM_MAX
      )
    )
  }

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    updateZoom(event.deltaY < 0 ? 0.1 : -0.1)
  }

  const beginDraw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!ready || !canvasRef.current) return
    const canvas = canvasRef.current
    const point = canvasPointFromEvent(event, canvas)
    drawingRef.current = { start: point, last: point }

    if (tool === 'pen') {
      const context = currentContext()
      if (!context) return
      context.beginPath()
      context.moveTo(point.x, point.y)
      context.lineCap = 'round'
      context.lineJoin = 'round'
      context.lineWidth = Math.max(4, Math.round(canvas.width / 260))
      context.strokeStyle = color
    } else {
      setDraftRect({
        left: 0,
        top: 0,
        width: 0,
        height: 0,
      })
    }

    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Pointer capture is unavailable in some test environments.
    }
  }

  const continueDraw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const state = drawingRef.current
    const canvas = canvasRef.current
    if (!state || !canvas) return

    const point = canvasPointFromEvent(event, canvas)
    if (tool === 'pen') {
      const context = currentContext()
      if (!context) return
      context.lineTo(point.x, point.y)
      context.stroke()
      state.last = point
      return
    }

    const overlay = overlayRectFromPoints(state.start, point, canvas)
    setDraftRect(overlay)
    state.last = point
  }

  const finishDraw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const state = drawingRef.current
    const canvas = canvasRef.current
    const context = currentContext()
    if (!state || !canvas || !context) return

    const point = canvasPointFromEvent(event, canvas)
    const rect = normalizeCanvasRect(state.start, point)

    if (tool === 'pen') {
      context.closePath()
      pushHistory()
    } else if (tool === 'rect' && rect.width > 4 && rect.height > 4) {
      context.lineWidth = Math.max(4, Math.round(canvas.width / 260))
      context.strokeStyle = color
      context.strokeRect(rect.x, rect.y, rect.width, rect.height)
      pushHistory()
    } else if (tool === 'crop' && rect.width > 12 && rect.height > 12) {
      const source = document.createElement('canvas')
      source.width = Math.max(1, Math.round(rect.width))
      source.height = Math.max(1, Math.round(rect.height))
      const sourceContext = source.getContext('2d')
      if (sourceContext) {
        sourceContext.drawImage(
          canvas,
          rect.x,
          rect.y,
          rect.width,
          rect.height,
          0,
          0,
          source.width,
          source.height
        )
        canvas.width = source.width
        canvas.height = source.height
        context.clearRect(0, 0, canvas.width, canvas.height)
        context.drawImage(source, 0, 0)
        pushHistory()
      }
    }

    setDraftRect(null)
    drawingRef.current = null
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // Pointer capture is unavailable in some test environments.
    }
  }

  const saveEditedImage = async () => {
    const canvas = canvasRef.current
    if (!canvas || !ready) return

    setSaving(true)
    try {
      const dataUrl = canvas.toDataURL('image/png')
      await onSave({
        b64Json: dataUrlToBase64(dataUrl),
        mimeType: 'image/png',
        size: `${canvas.width}x${canvas.height}`,
      })
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  const toolOptions: Array<{
    value: StoryboardEditorTool
    labelKey: string
    icon: typeof Pencil
  }> = [
    { value: 'pen', labelKey: 'storyboard.editor.pen', icon: Pencil },
    { value: 'rect', labelKey: 'storyboard.editor.rect', icon: Square },
    { value: 'crop', labelKey: 'storyboard.editor.crop', icon: Crop },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] max-w-[94vw] flex-col gap-0 overflow-hidden p-0">
        <div className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <DialogTitle className="min-w-0 flex-1 truncate text-base">
            {imageT(t, 'storyboard.editor.title')}
          </DialogTitle>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!ready || historyIndex <= 0}
            onClick={undo}
          >
            <Undo2 className="size-4" />
            {imageT(t, 'storyboard.editor.undo')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!ready || historyIndex >= history.length - 1}
            onClick={redo}
          >
            <Redo2 className="size-4" />
            {imageT(t, 'storyboard.editor.redo')}
          </Button>
          <Button
            type="button"
            className="bg-[#f36f4f] text-white hover:bg-[#e96346]"
            size="sm"
            disabled={!ready || saving}
            onClick={() => void saveEditedImage()}
          >
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            {imageT(t, 'storyboard.editor.save')}
          </Button>
        </div>

        <div className="flex min-h-0 flex-1">
          <aside className="flex w-[180px] shrink-0 flex-col gap-4 border-r bg-background p-4">
            <div className="space-y-2">
              <span className="text-xs text-muted-foreground">
                {imageT(t, 'storyboard.editor.tool')}
              </span>
              <div className="grid gap-2">
                {toolOptions.map((item) => {
                  const Icon = item.icon
                  return (
                    <button
                      key={item.value}
                      type="button"
                      className={cn(
                        'flex h-9 items-center gap-2 rounded-lg border px-3 text-sm transition-colors',
                        tool === item.value
                          ? 'border-[#f36f4f] bg-[#fff0eb] text-[#e25f43]'
                          : 'bg-background text-muted-foreground'
                      )}
                      onClick={() => setTool(item.value)}
                    >
                      <Icon className="size-4" />
                      {imageT(t, item.labelKey)}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="space-y-2">
              <span className="text-xs text-muted-foreground">
                {imageT(t, 'storyboard.editor.color')}
              </span>
              <div className="grid grid-cols-3 gap-2">
                {STORYBOARD_EDITOR_COLORS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    aria-label={imageT(t, 'storyboard.editor.colorOption', {
                      color: item,
                    })}
                    className={cn(
                      'size-9 rounded-lg border shadow-sm transition-transform',
                      color === item && 'scale-105 ring-2 ring-[#f36f4f]'
                    )}
                    style={{ backgroundColor: item }}
                    onClick={() => setColor(item)}
                  />
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <span className="text-xs text-muted-foreground">
                {imageT(t, 'storyboard.editor.zoom')}
              </span>
              <div className="flex items-center gap-1 rounded-lg bg-secondary p-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={imageT(t, 'storyboard.zoomOut')}
                  onClick={() => updateZoom(-0.2)}
                >
                  <ZoomOut className="size-4" />
                </Button>
                <span className="min-w-10 text-center font-mono text-xs text-muted-foreground">
                  {Math.round(zoom * 100)}%
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={imageT(t, 'storyboard.zoomIn')}
                  onClick={() => updateZoom(0.2)}
                >
                  <ZoomIn className="size-4" />
                </Button>
              </div>
            </div>
          </aside>

          <div
            className="min-w-0 flex-1 overflow-auto bg-[#f4f5f7] p-6"
            onWheel={handleWheel}
          >
            <div className="flex min-h-full items-center justify-center">
              <div
                className="relative origin-center"
                style={{ transform: `scale(${zoom})` }}
              >
                <canvas
                  ref={setCanvasElement}
                  className={cn(
                    'block max-h-none max-w-none rounded-lg bg-white shadow-sm',
                    tool === 'pen' ? 'cursor-crosshair' : 'cursor-cell',
                    !ready && 'opacity-40'
                  )}
                  onPointerDown={beginDraw}
                  onPointerMove={continueDraw}
                  onPointerUp={finishDraw}
                />
                {draftRect && (
                  <div
                    className={cn(
                      'pointer-events-none absolute border-2 border-dashed',
                      tool === 'crop'
                        ? 'border-emerald-500 bg-emerald-500/10'
                        : 'border-[#f36f4f] bg-[#f36f4f]/10'
                    )}
                    style={draftRect}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function StoryboardSheetPreview({
  shots,
  story,
  settings,
  asset,
  assetSrc,
  status,
  versions,
  activeVersionId,
  onSelectVersion,
  onOpenPreview,
  onOpenEditor,
}: {
  shots: StoryboardShot[]
  story: string
  settings: StoryboardSettings
  asset?: ImageAssetRecord
  assetSrc: (asset: ImageAssetRecord) => string
  status: ImageGenerationStatus | 'idle'
  versions: StoryboardAssetVersion[]
  activeVersionId: string
  onSelectVersion: (id: string) => void
  onOpenPreview: () => void
  onOpenEditor: () => void
}) {
  const { t } = useTranslation()

  if (asset?.path) {
    return (
      <div className="space-y-3">
        <div className="overflow-hidden rounded-lg border bg-background shadow-sm">
          <button
            type="button"
            className="group relative block w-full bg-[#f7f8fa]"
            onClick={onOpenPreview}
          >
            <img
              src={assetSrc(asset)}
              alt={asset.prompt}
              className="max-h-[620px] w-full object-contain"
            />
            <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-lg bg-background/95 px-3 py-1.5 text-xs font-medium opacity-0 shadow transition-opacity group-hover:opacity-100">
              <Eye className="size-3.5" />
              {imageT(t, 'storyboard.openPreview')}
            </span>
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap gap-2">
            {versions.map((version) => (
              <button
                key={version.id}
                type="button"
                className={cn(
                  'h-8 rounded-lg border px-3 text-xs transition-colors',
                  version.id === activeVersionId
                    ? 'border-[#f36f4f] bg-[#fff0eb] text-[#e25f43]'
                    : 'bg-background text-muted-foreground hover:text-foreground'
                )}
                onClick={() => onSelectVersion(version.id)}
              >
                {version.label}
              </button>
            ))}
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onOpenPreview}
            >
              <Eye className="size-4" />
              {imageT(t, 'storyboard.openPreview')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onOpenEditor}
            >
              <Pencil className="size-4" />
              {imageT(t, 'storyboard.editStoryboard')}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border bg-neutral-950 p-5 text-neutral-100 shadow-sm',
        status === 'running' && 'animate-pulse'
      )}
    >
      <div className="mb-4 flex items-end justify-between border-b border-white/10 pb-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-blue-300">
            Storyboard Sheet
          </div>
          <div className="mt-1 text-lg font-semibold">
            {story.trim() || imageT(t, 'storyboard.title')}
          </div>
        </div>
        <div className="font-mono text-[11px] text-neutral-400">
          {settings.aspect} ·{' '}
          {qualityPresetCompactLabel(t, settings.qualityPreset)}
        </div>
      </div>
      <div
        className={cn(
          'grid gap-3',
          shots.length <= 4
            ? 'grid-cols-2'
            : shots.length <= 9
              ? 'grid-cols-3'
              : 'grid-cols-4'
        )}
      >
        {shots.map((shot, index) => (
          <div key={shot.id} className="space-y-1.5">
            <div
              className="relative flex items-start justify-between overflow-hidden rounded bg-white/5 p-2"
              style={{ aspectRatio: settings.aspect.replace(':', '/') }}
            >
              <span className="rounded bg-black/35 px-1.5 py-0.5 font-mono text-[10px] text-neutral-300">
                {String(index + 1).padStart(2, '0')}
              </span>
              <span className="rounded bg-black/25 px-1.5 py-0.5 text-[10px] text-neutral-400">
                {shot.camera}
              </span>
            </div>
            <div className="truncate text-[11px] text-neutral-400">
              {shot.prompt}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function StoryboardVideoMode({
  serviceHub,
  imageModels,
  selectedImageModel,
  selectedImageModelKey,
  onSelectImageModel,
  textModels,
  videoModels,
  assetSrc,
  onAssetSaved,
}: {
  serviceHub: ReturnType<typeof useServiceHub>
  imageModels: ImageModelOption[]
  selectedImageModel?: ImageModelOption
  selectedImageModelKey: string
  onSelectImageModel: (value: string) => void
  textModels: TextModelOption[]
  videoModels: VideoModelOption[]
  assetSrc: (asset: ImageAssetRecord) => string
  onAssetSaved: (asset: ImageAssetRecord) => void
}) {
  const { t } = useTranslation()
  const [stage, setStage] = useState<StoryboardStage>('compose')
  const [story, setStory] = useState(
    'A gold robot wakes in a neon city, crosses a corridor, and reaches a rooftop.'
  )
  const [settings, setSettings] = useState<StoryboardSettings>(() =>
    defaultStoryboardSettings()
  )
  const [videoSettings, setVideoSettings] = useState<VideoSettings>(() =>
    defaultVideoSettings()
  )
  const [shots, setShots] = useState<StoryboardShot[]>([])
  const [promptTabs, setPromptTabs] = useState<StoryPromptTab[]>([])
  const [activePromptTabId, setActivePromptTabId] = useState('')
  const [breakdownStatus, setBreakdownStatus] = useState<'idle' | 'running'>(
    'idle'
  )
  const [storyboardStatus, setStoryboardStatus] = useState<
    ImageGenerationStatus | 'idle'
  >('idle')
  const [storyboardAsset, setStoryboardAsset] = useState<
    ImageAssetRecord | undefined
  >()
  const [storyboardVersions, setStoryboardVersions] = useState<
    StoryboardAssetVersion[]
  >([])
  const [activeStoryboardVersionId, setActiveStoryboardVersionId] = useState('')
  const [storyboardPreviewOpen, setStoryboardPreviewOpen] = useState(false)
  const [storyboardEditorOpen, setStoryboardEditorOpen] = useState(false)
  const [videoStatus, setVideoStatus] =
    useState<VideoGenerationStatus>('queued')
  const [videoProgress, setVideoProgress] = useState(0)
  const [videoAsset, setVideoAsset] = useState<VideoAssetRecord | undefined>()
  const [referenceAssets, setReferenceAssets] = useState<ImageAssetRecord[]>([])
  const [referenceAssetsLoading, setReferenceAssetsLoading] = useState(false)
  const [selectedVideoModelKey, setSelectedVideoModelKey] = useState('')

  const textModel = textModels[0]
  const videoModel = useMemo(
    () =>
      videoModels.find(
        (option) => imageModelKey(option) === selectedVideoModelKey
      ) ?? videoModels[0],
    [selectedVideoModelKey, videoModels]
  )
  const totalDuration = videoSettings.duration
  const activePromptTab = useMemo(
    () => promptTabs.find((tab) => tab.id === activePromptTabId),
    [activePromptTabId, promptTabs]
  )
  const activePrompt = activePromptTab?.prompt ?? ''
  const selectedImageModelCanUseReferences = Boolean(
    selectedImageModel?.model && isImageEditModel(selectedImageModel.model)
  )

  useEffect(() => {
    if (videoModels.length === 0) {
      setSelectedVideoModelKey('')
      return
    }

    setSelectedVideoModelKey((current) =>
      videoModels.some((option) => imageModelKey(option) === current)
        ? current
        : imageModelKey(videoModels[0]!)
    )
  }, [videoModels])

  const updateSettings = (patch: Partial<StoryboardSettings>) => {
    setSettings((current) => ({ ...current, ...patch }))
  }
  const updateVideoSettings = (patch: Partial<VideoSettings>) => {
    setVideoSettings((current) => ({ ...current, ...patch }))
  }
  const updateActivePrompt = (prompt: string) => {
    if (!activePromptTab) return
    setPromptTabs((current) =>
      current.map((tab) =>
        tab.id === activePromptTab.id ? { ...tab, prompt } : tab
      )
    )
  }
  const showStoryboardReferenceLimitToast = useCallback(() => {
    toast.error(
      imageT(t, 'toast.referenceLimitReached', {
        count: MAX_REFERENCE_IMAGES,
      })
    )
  }, [t])
  const importStoryboardReferenceAssets = useCallback(async () => {
    const selected = await serviceHub.dialog().open({
      multiple: true,
      filters: [
        {
          name: imageT(t, 'imageFiles'),
          extensions: ['png', 'jpg', 'jpeg', 'webp'],
        },
      ],
    })
    const sourcePaths = Array.isArray(selected)
      ? selected
      : selected
        ? [selected]
        : []
    if (sourcePaths.length === 0) return

    const remainingSlots = MAX_REFERENCE_IMAGES - referenceAssets.length
    if (remainingSlots <= 0) {
      showStoryboardReferenceLimitToast()
      return
    }

    const pathsToImport = sourcePaths.slice(0, remainingSlots)
    if (sourcePaths.length > remainingSlots) {
      showStoryboardReferenceLimitToast()
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
      setReferenceAssets((current) => [
        ...imported,
        ...current.filter(
          (asset) => !imported.some((nextAsset) => nextAsset.id === asset.id)
        ),
      ])
      imported.forEach(onAssetSaved)
      toast.success(imageT(t, 'toast.referenceImported'))
    } catch (error) {
      console.error('Failed to import storyboard reference image:', error)
      toast.error(imageT(t, 'toast.importReferenceFailed'))
    } finally {
      setReferenceAssetsLoading(false)
    }
  }, [
    onAssetSaved,
    referenceAssets.length,
    serviceHub,
    showStoryboardReferenceLimitToast,
    t,
  ])
  const removeStoryboardReferenceAsset = useCallback((assetId: string) => {
    setReferenceAssets((current) =>
      current.filter((asset) => asset.id !== assetId)
    )
  }, [])

  const fallbackBreakdown = useCallback(() => {
    const nextShots = buildStoryboardShots(story, DEFAULT_STORYBOARD_SHOT_COUNT)
    const perShotDuration = Math.max(
      1,
      Math.round(videoSettings.duration / Math.max(1, nextShots.length))
    )
    return nextShots.map((shot) => ({
      ...shot,
      duration: perShotDuration,
    }))
  }, [story, videoSettings.duration])

  const breakdownStory = useCallback(async () => {
    setBreakdownStatus('running')
    try {
      const variantCount = Math.max(
        STORYBOARD_VARIANT_MIN,
        Math.min(STORYBOARD_VARIANT_MAX, settings.variantCount)
      )
      const nextTabs: StoryPromptTab[] = []

      for (let index = 0; index < variantCount; index++) {
        let timedShots = fallbackBreakdown()
        let nextPrompt = ''

        if (textModel) {
          const result = await serviceHub
            .storyboardGeneration()
            .breakdownStoryboard({
              provider: textModel.provider,
              model: textModel.model,
              story,
              style: settings.style,
              aspect: settings.aspect,
              shotCount: DEFAULT_STORYBOARD_SHOT_COUNT,
              template: settings.template,
              systemPrompt: storyboardConsistencyPrompt(settings.consistency),
              durationPerShot: Math.max(
                1,
                Math.round(
                  videoSettings.duration / DEFAULT_STORYBOARD_SHOT_COUNT
                )
              ),
              variantIndex: index + 1,
              variantCount,
            })
          const fallbackShots = timedShots
          timedShots = Array.from(
            { length: DEFAULT_STORYBOARD_SHOT_COUNT },
            (_, shotIndex) => {
              const shot = result.shots[shotIndex]
              if (!shot) return fallbackShots[shotIndex]
              return {
                id: createId(),
                title: shot.title || `Shot ${shotIndex + 1}`,
                camera:
                  shot.camera ||
                  fallbackShots[shotIndex]?.camera ||
                  'Cinematic frame',
                prompt:
                  shot.prompt || fallbackShots[shotIndex]?.prompt || story,
                duration:
                  shot.duration ||
                  Math.max(
                    1,
                    Math.round(
                      videoSettings.duration / DEFAULT_STORYBOARD_SHOT_COUNT
                    )
                  ),
              }
            }
          ).filter((shot): shot is StoryboardShot => Boolean(shot))
          nextPrompt = result.storyboardPrompt?.trim() ?? ''
        }

        const prompt =
          nextPrompt ||
          `${buildStoryboardPrompt(story, settings, timedShots)}\n变种 ${index + 1}：保持故事一致，调整构图节奏、镜头重点与提示词措辞。`

        nextTabs.push({
          id: createId(),
          label: '',
          prompt,
          shots: timedShots,
          createdAt: new Date().toISOString(),
        })
      }

      const startIndex = promptTabs.length
      const labeledTabs = nextTabs.map((tab, index) => ({
        ...tab,
        label: imageT(t, 'storyboard.promptTabLabel', {
          index: startIndex + index + 1,
        }),
      }))
      setPromptTabs((current) => [...current, ...labeledTabs])
      const lastTab = labeledTabs[labeledTabs.length - 1]
      if (lastTab) {
        setActivePromptTabId(lastTab.id)
        setShots(lastTab.shots)
      }
      setStoryboardAsset(undefined)
      setStoryboardVersions([])
      setActiveStoryboardVersionId('')
      setStoryboardStatus('idle')
      setStage('compose')
    } catch (error) {
      console.warn('Storyboard breakdown fell back to local shots:', error)
      const timedShots = fallbackBreakdown()
      setShots(timedShots)
      const fallbackTab = {
        id: createId(),
        label: imageT(t, 'storyboard.promptTabLabel', {
          index: promptTabs.length + 1,
        }),
        prompt: buildStoryboardPrompt(story, settings, timedShots),
        shots: timedShots,
        createdAt: new Date().toISOString(),
      }
      setPromptTabs((current) => [...current, fallbackTab])
      setActivePromptTabId(fallbackTab.id)
      setStoryboardAsset(undefined)
      setStoryboardVersions([])
      setActiveStoryboardVersionId('')
      setStoryboardStatus('idle')
      setStage('compose')
    } finally {
      setBreakdownStatus('idle')
    }
  }, [
    fallbackBreakdown,
    serviceHub,
    settings,
    story,
    textModel,
    t,
    promptTabs.length,
    videoSettings.duration,
  ])

  const generateStoryboard = useCallback(async () => {
    if (!selectedImageModel) {
      toast.error(imageT(t, 'toast.selectImageModelFirst'))
      return
    }

    const nextShots = activePromptTab?.shots.length
      ? activePromptTab.shots
      : shots.length
        ? shots
        : buildStoryboardShots(story, DEFAULT_STORYBOARD_SHOT_COUNT).map(
            (shot) => ({
              ...shot,
              duration: Math.max(
                1,
                Math.round(
                  videoSettings.duration / DEFAULT_STORYBOARD_SHOT_COUNT
                )
              ),
            })
          )
    const prompt =
      activePrompt.trim() || buildStoryboardPrompt(story, settings, nextShots)
    const sourceAssets =
      referenceAssets.length > 0 && selectedImageModelCanUseReferences
        ? referenceAssets
        : []
    setShots(nextShots)
    setStoryboardStatus('running')

    try {
      const images = await serviceHub.imageGeneration().generateImages({
        provider: selectedImageModel.provider,
        model: selectedImageModel.model,
        prompt,
        ratio: settings.aspect,
        qualityPreset: settings.qualityPreset,
        count: 1,
        mode: sourceAssets.length > 0 ? 'edit' : 'generate',
        sourceAssets,
      })
      const image = images[0]
      if (!image) throw new Error(imageT(t, 'errors.generationFailed'))
      const actualSize = await readImageSize(image)
      const saved = await serviceHub.imageGeneration().saveAsset({
        id: createId(),
        prompt,
        mode: sourceAssets.length > 0 ? 'edit' : 'generate',
        provider: selectedImageModel.provider.provider,
        model: selectedImageModel.model.id,
        ratio: settings.aspect,
        size:
          actualSize ??
          imageSizeForRatio(settings.aspect, selectedImageModel.model.id),
        quality: apiQualityForPreset(
          settings.qualityPreset,
          selectedImageModel.model.id
        ),
        sourceAssetIds: sourceAssets.map((asset) => asset.id),
        revisedPrompt: image.revisedPrompt,
        usage: image.usage,
        status: 'succeeded',
        mimeType: image.mimeType,
        b64Json: image.b64Json,
        extension: imageFileExtension(image.mimeType),
      })
      setStoryboardAsset(saved)
      setStoryboardVersions([
        {
          id: saved.id,
          label: imageT(t, 'storyboard.version.original'),
          asset: saved,
          kind: 'original',
          createdAt: saved.createdAt,
        },
      ])
      setActiveStoryboardVersionId(saved.id)
      onAssetSaved(saved)
      setStoryboardStatus('succeeded')
      setStage('storyboard')
    } catch (error) {
      console.error('Failed to generate storyboard:', error)
      setStoryboardStatus('failed')
      toast.error(
        error instanceof Error
          ? error.message
          : imageT(t, 'errors.generationFailed')
      )
    }
  }, [
    onAssetSaved,
    selectedImageModel,
    serviceHub,
    settings,
    shots,
    story,
    activePrompt,
    activePromptTab,
    referenceAssets,
    selectedImageModelCanUseReferences,
    t,
    videoSettings.duration,
  ])

  const generateVideo = useCallback(async () => {
    if (!videoModel || !storyboardAsset) return

    setVideoStatus('running')
    setVideoProgress(0)
    try {
      const prompt = buildVideoPrompt(story, shots, videoSettings)
      const task = await serviceHub.videoGeneration().generateVideo({
        provider: videoModel.provider,
        model: videoModel.model,
        prompt,
        ratio: videoSettings.ratio,
        duration: totalDuration || videoSettings.duration,
        resolution: videoSettings.resolution,
        fps: videoSettings.fps,
        generateAudio: videoSettings.generateAudio,
        sourceAsset: storyboardAsset,
      })
      setVideoStatus(task.status)
      setVideoProgress(task.progress)
      const finalTask =
        task.status === 'succeeded'
          ? task
          : await serviceHub.videoGeneration().pollVideoTask({
              provider: videoModel.provider,
              model: videoModel.model,
              taskId: task.id,
            })
      setVideoStatus(finalTask.status)
      setVideoProgress(finalTask.progress)
      if (finalTask.status !== 'succeeded' || !finalTask.videoUrl) return

      const saved = await serviceHub.videoGeneration().saveVideoAsset({
        id: createId(),
        prompt,
        provider: videoModel.provider.provider,
        model: videoModel.model.id,
        ratio: videoSettings.ratio,
        resolution: videoSettings.resolution,
        duration: totalDuration || videoSettings.duration,
        fps: videoSettings.fps,
        sourceAssetIds: [storyboardAsset.id],
        usage: finalTask.usage,
        status: 'succeeded',
        mimeType: 'video/mp4',
        videoUrl: finalTask.videoUrl,
        extension: videoFileExtension('video/mp4'),
      })
      setVideoAsset(saved)
    } catch (error) {
      console.error('Failed to generate video:', error)
      setVideoStatus('failed')
      toast.error(
        error instanceof Error
          ? error.message
          : imageT(t, 'errors.generationFailed')
      )
    }
  }, [
    serviceHub,
    shots,
    storyboardAsset,
    story,
    t,
    totalDuration,
    videoModel,
    videoSettings,
  ])

  const videoSrc = videoAsset?.path
    ? /^https?:/i.test(videoAsset.path)
      ? videoAsset.path
      : serviceHub.core().convertFileSrc(videoAsset.path)
    : ''
  const downloadMedia = useCallback((href: string, fileName: string) => {
    if (!href || typeof document === 'undefined') return
    const link = document.createElement('a')
    link.href = href
    link.download = fileName
    link.rel = 'noreferrer'
    document.body.appendChild(link)
    link.click()
    link.remove()
  }, [])

  const selectStoryboardVersion = useCallback(
    (versionId: string) => {
      const version = storyboardVersions.find((item) => item.id === versionId)
      if (!version) return
      setActiveStoryboardVersionId(version.id)
      setStoryboardAsset(version.asset)
    },
    [storyboardVersions]
  )

  const saveEditedStoryboard = useCallback(
    async (edited: { b64Json: string; mimeType: string; size: string }) => {
      if (!storyboardAsset) return

      try {
        const saved = await serviceHub.imageGeneration().saveAsset({
          id: createId(),
          prompt: `${storyboardAsset.prompt} · ${imageT(t, 'storyboard.version.editedPromptSuffix')}`,
          mode: 'edit',
          provider: storyboardAsset.provider,
          model: storyboardAsset.model,
          ratio: storyboardAsset.ratio,
          size: edited.size,
          quality: storyboardAsset.quality,
          sourceAssetIds: [storyboardAsset.id],
          status: 'succeeded',
          mimeType: edited.mimeType,
          b64Json: edited.b64Json,
          extension: imageFileExtension(edited.mimeType),
        })
        const nextVersion: StoryboardAssetVersion = {
          id: saved.id,
          label: imageT(t, 'storyboard.version.edited', {
            index:
              storyboardVersions.filter((item) => item.kind === 'edited')
                .length + 1,
          }),
          asset: saved,
          kind: 'edited',
          createdAt: saved.createdAt,
        }
        setStoryboardVersions((current) => [...current, nextVersion])
        setActiveStoryboardVersionId(saved.id)
        setStoryboardAsset(saved)
        onAssetSaved(saved)
        toast.success(imageT(t, 'storyboard.editor.saved'))
      } catch (error) {
        console.error('Failed to save edited storyboard:', error)
        toast.error(imageT(t, 'storyboard.editor.saveFailed'))
        throw error
      }
    },
    [onAssetSaved, serviceHub, storyboardAsset, storyboardVersions, t]
  )

  const selectedImageModelLabel = selectedImageModel
    ? getModelDisplayName(selectedImageModel.model)
    : imageT(t, 'selectImageModel')
  const videoModelLabel = videoModel
    ? getModelDisplayName(videoModel.model)
    : imageT(t, 'storyboard.videoModelMissing')
  const selectedTemplate =
    STORYBOARD_TEMPLATES.find((item) => item.value === settings.template) ??
    STORYBOARD_TEMPLATES[2]!
  const stageSubtitle =
    stage === 'compose'
      ? imageT(t, 'storyboard.subtitle.compose', {
          imageModel: selectedImageModelLabel,
          videoModel: videoModelLabel,
        })
      : stage === 'storyboard'
        ? imageT(t, 'storyboard.subtitle.storyboard', {
            imageModel: selectedImageModelLabel,
            template: imageT(t, selectedTemplate.labelKey),
            count: shots.length || DEFAULT_STORYBOARD_SHOT_COUNT,
            aspect: settings.aspect,
            quality: qualityPresetCompactLabel(t, settings.qualityPreset),
          })
        : imageT(t, 'storyboard.subtitle.video', {
            videoModel: videoModelLabel,
          })

  return (
    <div className="space-y-4">
      <StoryboardStepper
        stage={stage}
        setStage={setStage}
        hasStoryboard={Boolean(storyboardAsset)}
      />

      <div className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-[760px] space-y-2">
            <h2 className="text-2xl font-semibold tracking-normal text-foreground">
              {stage === 'compose' ? (
                <span>{imageT(t, 'storyboard.title')}</span>
              ) : (
                <span>
                  {stage === 'storyboard'
                    ? imageT(t, 'storyboard.step.storyboard')
                    : imageT(t, 'storyboard.generateVideo')}
                </span>
              )}
            </h2>
            <p className="max-w-[760px] text-sm leading-6 text-muted-foreground">
              {stageSubtitle}
            </p>
          </div>
        </div>
      </div>

      {stage === 'compose' && (
        <div className="space-y-3">
          <section className="rounded-lg border bg-background p-[18px] shadow-sm">
            <div className="grid gap-4 lg:grid-cols-[132px_minmax(0,1fr)_minmax(320px,0.9fr)]">
              <div className="space-y-2">
                <span className="text-xs font-semibold text-muted-foreground">
                  {imageT(t, 'storyboard.references')}
                </span>
                <div className="flex flex-wrap gap-2 lg:flex-col">
                  <button
                    type="button"
                    aria-label={imageT(t, 'addReferenceImage')}
                    className="flex size-[58px] items-center justify-center rounded-lg border border-dashed bg-[#f7f8fa] text-muted-foreground transition-colors hover:border-[#f36f4f] hover:text-[#f36f4f]"
                    disabled={referenceAssetsLoading}
                    onClick={() => void importStoryboardReferenceAssets()}
                  >
                    {referenceAssetsLoading ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Upload className="size-4" />
                    )}
                  </button>
                  {referenceAssets.map((asset) => (
                    <div
                      key={asset.id}
                      className="group relative size-[58px] overflow-hidden rounded-lg border bg-secondary"
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
                      <button
                        type="button"
                        aria-label={imageT(t, 'removeReferenceImage', {
                          prompt: asset.prompt,
                        })}
                        className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-background/90 opacity-0 shadow transition-opacity group-hover:opacity-100"
                        onClick={() => removeStoryboardReferenceAsset(asset.id)}
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  ))}
                </div>
                {referenceAssets.length > 0 &&
                  !selectedImageModelCanUseReferences && (
                    <p className="text-[11px] leading-4 text-amber-700 dark:text-amber-300">
                      {imageT(t, 'storyboard.referenceModelUnsupported')}
                    </p>
                  )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <label className="text-xs font-semibold text-muted-foreground">
                    {imageT(t, 'storyboard.storyLabel')}
                  </label>
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 bg-[#f36f4f] px-3 text-white hover:bg-[#e96346]"
                    disabled={!story.trim() || breakdownStatus === 'running'}
                    onClick={breakdownStory}
                  >
                    {breakdownStatus === 'running' ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <WandSparkles className="size-4" />
                    )}
                    {imageT(t, 'storyboard.aiBreakdown')}
                  </Button>
                </div>
                <Textarea
                  className="min-h-[156px] resize-none rounded-lg border-0 bg-[#f7f8fa] px-4 py-3 text-[15px] leading-6 shadow-none focus-visible:ring-0"
                  value={story}
                  placeholder={imageT(t, 'storyboard.storyPlaceholder')}
                  onChange={(event) => setStory(event.target.value)}
                />
              </div>

              <div className="overflow-hidden rounded-lg border bg-[#f7f8fa]">
                <div className="flex min-h-11 items-center gap-2 border-b bg-background px-3">
                  <WandSparkles className="size-4 text-[#e25f43]" />
                  <span className="shrink-0 text-sm font-medium">
                    {imageT(t, 'storyboard.prompt')}
                  </span>
                  {promptTabs.length > 0 && (
                    <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto py-2">
                      {promptTabs.map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          className={cn(
                            'h-7 shrink-0 rounded-md px-2.5 text-xs transition-colors',
                            tab.id === activePromptTabId
                              ? 'bg-[#f36f4f] text-white shadow-sm'
                              : 'bg-secondary text-muted-foreground hover:text-foreground'
                          )}
                          onClick={() => {
                            setActivePromptTabId(tab.id)
                            setShots(tab.shots)
                          }}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {activePromptTab ? (
                  <Textarea
                    className="min-h-[156px] resize-none rounded-none border-0 bg-transparent px-4 py-3 font-mono text-xs leading-6 shadow-none focus-visible:ring-0"
                    value={activePrompt}
                    onChange={(event) => updateActivePrompt(event.target.value)}
                  />
                ) : (
                  <div className="flex min-h-[156px] items-center justify-center px-6 text-center text-xs leading-5 text-muted-foreground">
                    {imageT(t, 'storyboard.promptEmpty')}
                  </div>
                )}
              </div>
            </div>

            <div className="my-4 h-px bg-black/[0.06] dark:bg-white/10" />

            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-2">
                  <span className="text-xs text-muted-foreground">
                    {imageT(t, 'storyboard.visualStyle')}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {STORYBOARD_STYLES.map((style) => (
                      <button
                        key={style.value}
                        type="button"
                        className={cn(
                          'h-[30px] shrink-0 rounded-full border px-3 text-xs transition-colors',
                          settings.style === style.value
                            ? 'border-[#f36f4f] bg-[#f36f4f] text-white shadow-sm'
                            : 'bg-background text-muted-foreground'
                        )}
                        onClick={() => updateSettings({ style: style.value })}
                      >
                        {imageT(t, style.labelKey)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <span className="text-xs text-muted-foreground">
                    {imageT(t, 'storyboard.consistencyLabel')}
                  </span>
                  <div className="flex rounded-lg bg-[#eef0f3] p-1">
                    {STORYBOARD_CONSISTENCY_OPTIONS.map((item) => (
                      <button
                        key={item.value}
                        type="button"
                        className={cn(
                          'h-7 rounded-md px-3 text-xs',
                          settings.consistency === item.value &&
                            'bg-background shadow-sm'
                        )}
                        onClick={() =>
                          updateSettings({ consistency: item.value })
                        }
                      >
                        {imageT(t, item.labelKey)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <span className="text-xs text-muted-foreground">
                  {imageT(t, 'storyboard.templateLabel')}
                </span>
                <div className="grid gap-2 sm:grid-cols-3">
                  {STORYBOARD_TEMPLATES.map((template) => (
                    <button
                      key={template.value}
                      type="button"
                      className={cn(
                        'min-h-[50px] rounded-lg border bg-background px-3 py-2 text-left transition-colors',
                        settings.template === template.value &&
                          'border-[#f36f4f] bg-[#fff0eb] text-[#e25f43]'
                      )}
                      onClick={() =>
                        updateSettings({ template: template.value })
                      }
                    >
                      <div className="text-xs font-semibold">
                        {imageT(t, template.labelKey)}
                      </div>
                      <div className="mt-1 text-[10.5px] text-muted-foreground">
                        {imageT(t, template.descriptionKey)}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1.5">
                  <span className="text-xs text-muted-foreground">
                    {imageT(t, 'imageModel')}
                  </span>
                  <ImageModelPicker
                    imageModels={imageModels}
                    selectedModelKey={selectedImageModelKey}
                    onSelect={onSelectImageModel}
                    showProviderName
                    triggerClassName="box-border h-8 min-h-8 max-w-[240px] rounded-lg bg-background px-3 text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <span className="text-xs text-muted-foreground">
                    {imageT(t, 'storyboard.aspectRatio')}
                  </span>
                  <div className="flex rounded-lg bg-[#eef0f3] p-1">
                    {STORYBOARD_ASPECT_OPTIONS.map((item) => (
                      <button
                        key={item}
                        type="button"
                        className={cn(
                          'h-7 rounded-md px-3 text-xs',
                          settings.aspect === item && 'bg-background shadow-sm'
                        )}
                        onClick={() => updateSettings({ aspect: item })}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <span className="text-xs text-muted-foreground">
                    {imageT(t, 'storyboard.resolution')}
                  </span>
                  <div className="flex rounded-lg bg-[#eef0f3] p-1">
                    {QUALITY_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={cn(
                          'h-7 rounded-md px-3 text-xs',
                          settings.qualityPreset === option.value &&
                            'bg-background shadow-sm'
                        )}
                        onClick={() =>
                          updateSettings({ qualityPreset: option.value })
                        }
                      >
                        {qualityPresetCompactLabel(t, option.value)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <span className="text-xs text-muted-foreground">
                    {imageT(t, 'storyboard.variantCount')}
                  </span>
                  <div className="box-border flex h-8 items-center overflow-hidden rounded-lg border bg-background">
                    <button
                      type="button"
                      className="flex size-8 items-center justify-center"
                      onClick={() =>
                        updateSettings({
                          variantCount: Math.max(
                            STORYBOARD_VARIANT_MIN,
                            settings.variantCount - 1
                          ),
                        })
                      }
                    >
                      <Minus className="size-3.5" />
                    </button>
                    <span className="min-w-8 text-center text-xs">
                      {settings.variantCount}
                    </span>
                    <button
                      type="button"
                      className="flex size-8 items-center justify-center"
                      onClick={() =>
                        updateSettings({
                          variantCount: Math.min(
                            STORYBOARD_VARIANT_MAX,
                            settings.variantCount + 1
                          ),
                        })
                      }
                    >
                      <Plus className="size-3.5" />
                    </button>
                  </div>
                </div>

                <Button
                  type="button"
                  className="ml-auto h-9 bg-[#f36f4f] px-4 text-white hover:bg-[#e96346]"
                  disabled={
                    storyboardStatus === 'running' ||
                    (!activePrompt.trim() && !story.trim())
                  }
                  onClick={generateStoryboard}
                >
                  {storyboardStatus === 'running' ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Sparkles className="size-4" />
                  )}
                  {imageT(t, 'storyboard.generateStoryboard')}
                </Button>
              </div>
            </div>
          </section>
        </div>
      )}

      {stage === 'storyboard' && (
        <div className="grid gap-5 lg:grid-cols-[1fr_290px]">
          <div className="space-y-3">
            <StoryboardSheetPreview
              shots={shots}
              story={story}
              settings={settings}
              asset={storyboardAsset}
              assetSrc={assetSrc}
              status={storyboardStatus}
              versions={storyboardVersions}
              activeVersionId={activeStoryboardVersionId}
              onSelectVersion={selectStoryboardVersion}
              onOpenPreview={() => setStoryboardPreviewOpen(true)}
              onOpenEditor={() => setStoryboardEditorOpen(true)}
            />
            {storyboardAsset && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-600">
                  <Check className="size-3" />
                  {imageT(t, 'storyboard.storyboardReady')}
                </span>
                <span className="text-xs text-muted-foreground">
                  {imageT(t, 'storyboard.generatedMeta', {
                    imageModel: storyboardAsset.model,
                    aspect: storyboardAsset.ratio,
                    quality: assetQualityLabel(t, storyboardAsset.quality),
                  })}
                </span>
              </div>
            )}
          </div>
          <aside className="space-y-4 rounded-lg border bg-background p-4 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-medium">
              <ImageIcon className="size-4 text-muted-foreground" />
              {imageT(t, 'storyboard.actions')}
            </div>
            {!videoModel && storyboardAsset && (
              <p className="rounded-md bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                {imageT(t, 'storyboard.videoModelRequired')}
              </p>
            )}
            {storyboardAsset && (
              <Button
                type="button"
                variant="secondary"
                className="w-full"
                onClick={() =>
                  downloadMedia(
                    assetSrc(storyboardAsset),
                    storyboardAsset.fileName || 'storyboard.png'
                  )
                }
              >
                <Download className="size-4" />
                {imageT(t, 'storyboard.downloadStoryboard')}
              </Button>
            )}
            <div className="grid gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setStage('compose')}
              >
                <ArrowLeft className="size-4" />
                {imageT(t, 'storyboard.backToScript')}
              </Button>
              <Button
                type="button"
                className="bg-[#f36f4f] text-white hover:bg-[#e96346]"
                disabled={!storyboardAsset}
                onClick={() => setStage('video')}
              >
                {imageT(t, 'storyboard.nextStep')}
                <ArrowRight className="size-4" />
              </Button>
            </div>
          </aside>
        </div>
      )}

      {stage === 'video' && (
        <div className="space-y-5">
          {storyboardAsset && (
            <div className="flex items-center gap-3 rounded-lg border bg-background p-3 shadow-sm">
              <img
                src={assetSrc(storyboardAsset)}
                alt={storyboardAsset.prompt}
                className="h-14 w-24 rounded object-cover"
              />
              <div className="min-w-0 text-sm">
                <div className="font-medium">
                  {imageT(t, 'storyboard.sourceStoryboardTitle')}
                  <span className="ml-2 font-normal text-muted-foreground">
                    {imageT(t, 'storyboard.sourceStoryboardMeta', {
                      imageModel: storyboardAsset.model,
                      aspect: settings.aspect,
                      count: shots.length,
                    })}
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {imageT(t, 'storyboard.sourceStoryboardHint')}
                </div>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="ml-auto"
                onClick={() => setStage('storyboard')}
              >
                <ImageIcon className="size-4" />
                {imageT(t, 'storyboard.viewStoryboard')}
              </Button>
            </div>
          )}
          <div className="grid gap-5 lg:grid-cols-[1fr_312px]">
            <div className="space-y-4">
              <div className="overflow-hidden rounded-lg border bg-neutral-950 text-neutral-100 shadow-sm">
                <div
                  className="flex items-center justify-center"
                  style={{ aspectRatio: videoSettings.ratio.replace(':', '/') }}
                >
                  {videoAsset && videoSrc ? (
                    <video controls src={videoSrc} className="size-full" />
                  ) : videoStatus === 'running' ? (
                    <div className="flex w-2/3 flex-col items-center gap-3">
                      <Film className="size-7 animate-pulse text-[#f36f4f]" />
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-[#f36f4f] transition-all"
                          style={{ width: `${videoProgress}%` }}
                        />
                      </div>
                      <span className="font-mono text-xs text-neutral-400">
                        {videoProgress}%
                      </span>
                    </div>
                  ) : (
                    <div className="flex size-14 items-center justify-center rounded-full bg-white/90 text-neutral-950">
                      <Play className="ml-0.5 size-6" />
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3 bg-neutral-950 px-4 py-3">
                  <Play className="size-4 text-white" />
                  <div className="h-1 flex-1 rounded-full bg-white/15">
                    <div className="h-full w-0 rounded-full bg-white" />
                  </div>
                  <span className="font-mono text-xs text-neutral-500">
                    00:00 / 00:{String(videoSettings.duration).padStart(2, '0')}
                  </span>
                </div>
              </div>
              {videoAsset && videoSrc && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-600">
                    <Check className="size-3" />
                    {imageT(t, 'storyboard.videoDoneMeta', {
                      duration: videoSettings.duration,
                      resolution: videoSettings.resolution,
                    })}
                  </span>
                  <Button type="button" variant="secondary" size="sm">
                    <Save className="size-4" />
                    {imageT(t, 'storyboard.saveToMediaLibrary')}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      downloadMedia(
                        videoSrc,
                        videoAsset.fileName || 'storyboard-video.mp4'
                      )
                    }
                  >
                    <Download className="size-4" />
                    {imageT(t, 'storyboard.downloadVideo')}
                  </Button>
                </div>
              )}
            </div>
            <aside className="space-y-4 rounded-lg border bg-background p-4 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-medium">
                <SlidersHorizontal className="size-4 text-muted-foreground" />
                {imageT(t, 'storyboard.videoParams')}
              </div>
              <div className="space-y-2">
                <span className="text-xs text-muted-foreground">
                  {imageT(t, 'storyboard.videoModel')}
                </span>
                {videoModels.length > 0 ? (
                  <ImageModelPicker
                    imageModels={videoModels}
                    selectedModelKey={selectedVideoModelKey}
                    onSelect={setSelectedVideoModelKey}
                    showProviderName
                    triggerAriaLabelKey="storyboard.videoModel"
                    fallbackLabelKey="storyboard.videoModelMissing"
                    searchPlaceholderKey="storyboard.searchVideoModels"
                    emptyLabelKey="storyboard.noVideoModelsFound"
                    triggerClassName="box-border h-9 min-h-9 w-full justify-between rounded-lg bg-background px-3 text-xs"
                  />
                ) : (
                  <p className="rounded-md bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                    {imageT(t, 'storyboard.videoModelRequired')}
                  </p>
                )}
              </div>
              {videoModels.length > 0 && !videoModel && (
                <p className="rounded-md bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                  {imageT(t, 'storyboard.videoModelRequired')}
                </p>
              )}
              <div className="space-y-2">
                <span className="text-xs text-muted-foreground">
                  {imageT(t, 'storyboard.aspectRatio')}
                </span>
                <div className="grid grid-cols-3 rounded-lg bg-[#eef0f3] p-1">
                  {VIDEO_ASPECT_OPTIONS.map((item) => (
                    <button
                      key={item}
                      type="button"
                      className={cn(
                        'h-7 rounded-md px-3 text-xs',
                        videoSettings.ratio === item &&
                          'bg-background shadow-sm'
                      )}
                      onClick={() => updateVideoSettings({ ratio: item })}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center text-xs text-muted-foreground">
                  <span>{imageT(t, 'storyboard.duration')}</span>
                  <span className="ml-auto">{videoSettings.duration}s</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={VIDEO_DURATION_MIN}
                    max={VIDEO_DURATION_MAX}
                    value={videoSettings.duration}
                    onChange={(event) =>
                      updateVideoSettings({
                        duration: Number(event.target.value),
                      })
                    }
                    className="min-w-0 flex-1"
                  />
                  <div className="box-border flex h-8 items-center overflow-hidden rounded-lg border bg-background">
                    <button
                      type="button"
                      className="flex size-8 items-center justify-center"
                      onClick={() =>
                        updateVideoSettings({
                          duration: Math.max(
                            VIDEO_DURATION_MIN,
                            videoSettings.duration - 1
                          ),
                        })
                      }
                    >
                      <Minus className="size-3.5" />
                    </button>
                    <span className="min-w-8 text-center text-xs">
                      {videoSettings.duration}
                    </span>
                    <button
                      type="button"
                      className="flex size-8 items-center justify-center"
                      onClick={() =>
                        updateVideoSettings({
                          duration: Math.min(
                            VIDEO_DURATION_MAX,
                            videoSettings.duration + 1
                          ),
                        })
                      }
                    >
                      <Plus className="size-3.5" />
                    </button>
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <span className="text-xs text-muted-foreground">
                  {imageT(t, 'storyboard.resolution')}
                </span>
                <div className="flex rounded-lg bg-[#eef0f3] p-1">
                  {VIDEO_RESOLUTION_OPTIONS.map((item) => (
                    <button
                      key={item}
                      type="button"
                      className={cn(
                        'h-7 rounded-md px-3 text-xs',
                        videoSettings.resolution === item &&
                          'bg-background shadow-sm'
                      )}
                      onClick={() => updateVideoSettings({ resolution: item })}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <span className="text-xs text-muted-foreground">
                  {imageT(t, 'storyboard.fps')}
                </span>
                <div className="flex rounded-lg bg-[#eef0f3] p-1">
                  {([24, 30, 60] as const).map((item) => (
                    <button
                      key={item}
                      type="button"
                      className={cn(
                        'h-7 rounded-md px-3 text-xs',
                        videoSettings.fps === item && 'bg-background shadow-sm'
                      )}
                      onClick={() => updateVideoSettings({ fps: item })}
                    >
                      {item}fps
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <span className="text-xs text-muted-foreground">
                  {imageT(t, 'storyboard.defaultCamera')}
                </span>
                <select
                  className="h-9 w-full rounded-lg border bg-background px-3 text-sm"
                  value={videoSettings.camera}
                  onChange={(event) =>
                    updateVideoSettings({ camera: event.target.value })
                  }
                >
                  {[
                    ['自动', 'storyboard.camera.auto'],
                    ['推近', 'storyboard.camera.pushIn'],
                    ['拉远', 'storyboard.camera.pullOut'],
                    ['环绕', 'storyboard.camera.orbit'],
                    ['横移', 'storyboard.camera.truck'],
                    ['上摇', 'storyboard.camera.tiltUp'],
                    ['手持跟随', 'storyboard.camera.handheld'],
                  ].map(([value, labelKey]) => (
                    <option key={value} value={value}>
                      {imageT(t, labelKey)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <div className="flex items-center text-xs text-muted-foreground">
                  <span>{imageT(t, 'storyboard.motion')}</span>
                  <span className="ml-auto">
                    {videoSettings.motion <= 33
                      ? imageT(t, 'storyboard.motionLevel.light')
                      : videoSettings.motion <= 66
                        ? imageT(t, 'storyboard.motionLevel.medium')
                        : imageT(t, 'storyboard.motionLevel.strong')}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={videoSettings.motion}
                  onChange={(event) =>
                    updateVideoSettings({ motion: Number(event.target.value) })
                  }
                  className="w-full"
                />
              </div>
              <label className="flex items-center gap-2 rounded-lg border bg-[#f7f8fa] px-3 py-2 text-sm">
                <Music className="size-4 text-muted-foreground" />
                {imageT(t, 'storyboard.aiMusic')}
                <input
                  type="checkbox"
                  className="ml-auto"
                  checked={videoSettings.generateAudio}
                  onChange={(event) =>
                    updateVideoSettings({ generateAudio: event.target.checked })
                  }
                />
              </label>
              <Button
                type="button"
                className="w-full bg-[#f36f4f] text-white hover:bg-[#e96346]"
                disabled={
                  !videoModel || !storyboardAsset || videoStatus === 'running'
                }
                onClick={generateVideo}
              >
                {videoStatus === 'running' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Film className="size-4" />
                )}
                {imageT(t, 'storyboard.generateVideo')}
              </Button>
            </aside>
          </div>
        </div>
      )}

      <StoryboardPreviewDialog
        open={storyboardPreviewOpen}
        onOpenChange={setStoryboardPreviewOpen}
        asset={storyboardAsset}
        src={storyboardAsset ? assetSrc(storyboardAsset) : ''}
      />
      <StoryboardImageEditorDialog
        open={storyboardEditorOpen}
        onOpenChange={setStoryboardEditorOpen}
        asset={storyboardAsset}
        src={storyboardAsset ? assetSrc(storyboardAsset) : ''}
        onSave={saveEditedStoryboard}
      />
    </div>
  )
}

function Images() {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const providers = useModelProvider((state) => state.providers)
  const imageModels = useMemo(() => getImageModels(providers), [providers])
  const textModels = useMemo(
    () => getStoryboardTextModels(providers),
    [providers]
  )
  const videoModels = useMemo(() => getVideoModels(providers), [providers])
  const [mediaMode, setMediaMode] = useState<MediaMode>('image')
  const [selectedModelKey, setSelectedModelKey] = useState('')
  const [prompt, setPrompt] = useState('')
  const [ratio, setRatio] = useState<ImageRatio>('1:1')
  const [qualityPreset, setQualityPreset] = useState<ImageQualityPreset>('sd')
  const [count, setCount] = useState(1)
  const [assets, setAssets] = useState<ImageAssetRecord[]>([])
  const [sourceAssetIds, setSourceAssetIds] = useState<string[]>([])
  const [sourceAssetRecords, setSourceAssetRecords] = useState<
    ImageAssetRecord[]
  >([])
  const [referenceAssetsLoading, setReferenceAssetsLoading] = useState(false)
  const [tasks, setTasks] = useState<ImageTask[]>([])
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [previewAsset, setPreviewAsset] = useState<ImageAssetRecord | null>(
    null
  )
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

  const mediaModeSwitch = (
    <div className="relative z-30 flex h-full w-full items-center">
      <div className="relative z-40 inline-flex shrink-0 gap-0.5 rounded-[9px] bg-[#f3f3f2] p-[3px] shadow-[0_0_0_0.5px_rgba(0,0,0,0.08)]">
        {(
          [
            {
              value: 'image',
              label: imageT(t, 'mode.image'),
              Icon: ImageIcon,
              badge: undefined,
              disabled: false,
            },
            {
              value: 'storyboard',
              label: imageT(t, 'mode.storyboardVideo'),
              Icon: Film,
              badge: imageT(t, 'mode.newBadge'),
              disabled: false,
            },
            {
              value: 'long-video',
              label: imageT(t, 'mode.longVideo'),
              Icon: Film,
              badge: imageT(t, 'mode.soonBadge'),
              disabled: true,
            },
          ] as const
        ).map(({ value, label, Icon, badge, disabled }) => (
          <button
            key={value}
            type="button"
            disabled={disabled}
            className={cn(
              'flex h-7 items-center gap-[7px] rounded-[7px] px-[13px] text-[13px] transition-colors',
              mediaMode === value
                ? 'bg-white font-semibold text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.10),0_0_0_0.5px_rgba(0,0,0,0.04)]'
                : 'text-muted-foreground hover:text-foreground',
              disabled &&
                'cursor-not-allowed opacity-45 hover:text-muted-foreground'
            )}
            onClick={() => {
              if (!disabled) setMediaMode(value)
            }}
          >
            <Icon className="size-[15px]" />
            {label}
            {badge && (
              <span
                aria-hidden="true"
                className="rounded-[5px] bg-[#fff0eb] px-1.5 py-0.5 text-[10px] font-bold leading-none text-[#f36f4f]"
              >
                {badge}
              </span>
            )}
          </button>
        ))}
      </div>
      <TauriDragSpacer />
    </div>
  )
  const renderImageComposer = ({
    pinned = false,
  }: { pinned?: boolean } = {}) => (
    <form
      className={cn(
        'w-full overflow-hidden rounded-2xl border bg-background shadow-[0_2px_10px_rgba(0,0,0,0.04)]',
        !pinned && 'mt-[22px]'
      )}
      onSubmit={(event) => {
        event.preventDefault()
        startGeneration()
      }}
    >
      <div className="flex gap-3.5 px-[18px] py-4">
        <ReferenceImageStack
          assets={sourceAssets}
          assetSrc={assetSrc}
          loading={referenceAssetsLoading}
          onAdd={() => void importReferenceAssets()}
          onRemove={removeSourceAsset}
        />

        <Textarea
          className="min-h-[58px] flex-1 resize-none border-0 bg-transparent p-0 pt-1.5 text-sm shadow-none focus-visible:ring-0"
          value={prompt}
          placeholder={imageT(t, 'promptPlaceholder')}
          onChange={(event) => setPrompt(event.target.value)}
          onPaste={(event) => {
            const itemFiles = Array.from(event.clipboardData.items ?? [])
              .filter((item) => item.kind === 'file')
              .map((item) => item.getAsFile())
              .filter((file): file is File => Boolean(file))
            const clipboardFiles = Array.from(event.clipboardData.files ?? [])
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

      <div className="flex items-center justify-between gap-3 border-t border-black/[0.06] px-3.5 py-2.5 dark:border-white/10">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <ImageModelPicker
            imageModels={imageModels}
            selectedModelKey={selectedModelKey}
            onSelect={setSelectedModelKey}
            showProviderName
            side="top"
            triggerClassName="box-border h-[30px] min-h-[30px] max-w-[240px] rounded-lg bg-background px-3 text-xs"
          />

          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={imageT(t, 'imageSizeSettings')}
                className="box-border flex h-[30px] min-h-[30px] items-center gap-1 rounded-lg border bg-background px-2 text-[12px] font-normal leading-none transition-colors hover:bg-secondary/60"
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

          <div className="box-border flex h-[30px] min-h-[30px] items-center rounded-lg border bg-background">
            <button
              type="button"
              aria-label={imageT(t, 'decreaseCount')}
              className="flex size-[30px] items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40"
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
              className="flex size-[30px] items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40"
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
  )

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
        (asset) =>
          asset.assetKind !== 'reference' && !taskAssetIds.has(asset.id)
      ),
    [assets, taskAssetIds]
  )
  const leadingSavedHistoryAssets =
    taskGroups.length === 0 ? savedHistoryAssets.slice(0, 1) : []
  const trailingSavedHistoryAssets =
    taskGroups.length === 0 ? savedHistoryAssets.slice(1) : savedHistoryAssets

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
              : (requestError?.kind ?? 'generation'),
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
      const workers = Array.from(
        { length: Math.min(2, pending.length) },
        async () => {
          while (pending.length > 0) {
            const task = pending.shift()
            if (!task || cancelledTasks.current.has(task.id)) continue
            await runTask(task)
          }
        }
      )

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
        if (
          !merged.includes(asset.id) &&
          merged.length < MAX_REFERENCE_IMAGES
        ) {
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
    const sourcePaths = Array.isArray(selected)
      ? selected
      : selected
        ? [selected]
        : []
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
    if (group.tasks.every((task) => task.status === 'succeeded'))
      return 'succeeded'
    return 'failed'
  }

  const cancelGroup = (group: ImageTaskGroup) => {
    group.tasks.forEach((task) => {
      if (task.status === 'pending' || task.status === 'running') {
        cancelTask(task.id)
      }
    })
  }

  const showAssetContextMenu = (event: MouseEvent, asset: ImageAssetRecord) => {
    event.preventDefault()
    setContextMenu({
      asset,
      x: Math.min(event.clientX, window.innerWidth - 220),
      y: Math.min(event.clientY, window.innerHeight - 180),
    })
  }

  const renderSavedHistoryAsset = (asset: ImageAssetRecord) => (
    <section
      key={asset.id}
      className="w-full space-y-3 rounded-xl border bg-background p-[18px] shadow-sm"
    >
      <div className="flex items-start gap-2.5">
        <button
          type="button"
          className="mt-0.5 size-10 shrink-0 rotate-[-7deg] overflow-hidden rounded-sm bg-secondary shadow-sm"
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

      <div className="max-w-[380px] overflow-hidden rounded-lg bg-border">
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
  )

  if (imageModels.length === 0) {
    return (
      <div className="flex h-svh max-h-svh flex-col overflow-hidden">
        <MediaHeader />
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
    <div className="flex h-svh max-h-svh flex-col overflow-hidden bg-[#fbfbfa] dark:bg-background">
      <MediaHeader>{mediaModeSwitch}</MediaHeader>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <main className={cn('h-full overscroll-contain overflow-y-auto')}>
          <div
            className={cn(
              'mx-auto px-[26px] pt-[18px]',
              mediaMode === 'image'
                ? 'max-w-[1040px] pb-[190px]'
                : 'max-w-[1120px] pb-10'
            )}
          >
            {mediaMode === 'image' ? (
              <>
                <h2 className="mt-1 mb-[14px] text-2xl font-semibold tracking-normal text-foreground">
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
                        .filter((asset): asset is ImageAssetRecord =>
                          Boolean(asset)
                        )
                      const source = groupSourceAssets[0]
                      const status = groupStatus(group)
                      const firstAsset = group.tasks.find(
                        (task) => task.asset
                      )?.asset
                      const running = group.tasks.some(
                        (task) =>
                          task.status === 'running' || task.status === 'pending'
                      )

                      return (
                        <section
                          key={group.id}
                          className="w-full space-y-3 rounded-xl border bg-background p-[18px] shadow-sm"
                        >
                          <div className="flex items-start gap-2.5">
                            {source && (
                              <button
                                type="button"
                                className="mt-0.5 size-10 shrink-0 rotate-[-7deg] overflow-hidden rounded-sm bg-secondary shadow-sm"
                                onClick={() =>
                                  editFromAsset(source, group.prompt)
                                }
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
                                <span className="font-medium">
                                  {group.prompt}
                                </span>
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
                              'grid overflow-hidden rounded-lg bg-border',
                              group.tasks.length === 1
                                ? 'max-w-[380px] grid-cols-1'
                                : group.tasks.length === 2
                                  ? 'max-w-[760px] grid-cols-2'
                                  : 'max-w-[760px] grid-cols-2 md:grid-cols-4'
                            )}
                          >
                            {group.tasks.map((task) => {
                              const retrySeconds = retryInSeconds(
                                task.retryAvailableAt,
                                nowMs
                              )

                              return (
                                <div
                                  key={task.id}
                                  className="aspect-square bg-secondary"
                                >
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
                              onClick={() =>
                                firstAsset &&
                                editFromAsset(firstAsset, group.prompt)
                              }
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

                    {leadingSavedHistoryAssets.map(renderSavedHistoryAsset)}
                  </>
                )}

                {(taskGroups.length > 0 || savedHistoryAssets.length > 0) &&
                  trailingSavedHistoryAssets.map(renderSavedHistoryAsset)}
              </>
            ) : (
              <StoryboardVideoMode
                serviceHub={serviceHub}
                imageModels={imageModels}
                selectedImageModel={selectedModel}
                selectedImageModelKey={selectedModelKey}
                onSelectImageModel={setSelectedModelKey}
                textModels={textModels}
                videoModels={videoModels}
                assetSrc={assetSrc}
                onAssetSaved={(asset) =>
                  setAssets((current) => [
                    asset,
                    ...current.filter((item) => item.id !== asset.id),
                  ])
                }
              />
            )}
          </div>
        </main>

        {mediaMode === 'image' && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-[#fbfbfa] via-[#fbfbfa] to-transparent pb-5 pt-8 dark:from-background dark:via-background">
            <div className="pointer-events-auto mx-auto max-w-[1040px] px-[26px]">
              {renderImageComposer({ pinned: true })}
            </div>
          </div>
        )}
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
