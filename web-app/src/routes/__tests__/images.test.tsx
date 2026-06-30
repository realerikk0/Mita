/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import '@testing-library/jest-dom'
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ModelCapabilities } from '@/types/models'
import { ProviderQuotaError } from '@/lib/provider-quota-error'
import { ImageGenerationRequestError } from '@/lib/image-generation-errors'
import { useImageGenerationStore } from '@/stores/image-generation-store'
import { useVideoGenerationStore } from '@/stores/video-generation-store'
import { useStoryboardSessionStore } from '@/stores/storyboard-session-store'

const h = vi.hoisted(() => ({
  providers: [] as any[],
  assets: [] as any[],
  generateImages: vi.fn(),
  saveAsset: vi.fn(),
  importAsset: vi.fn(),
  listAssets: vi.fn(),
  deleteAsset: vi.fn(),
  generateVideo: vi.fn(),
  pollVideoTask: vi.fn(),
  saveVideoAsset: vi.fn(),
  listVideoAssets: vi.fn(),
  deleteVideoAsset: vi.fn(),
  breakdownStoryboard: vi.fn(),
  dialogOpen: vi.fn(),
  dialogSave: vi.fn(),
  revealItemInDir: vi.fn(),
  openExternalUrl: vi.fn(),
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
  copyFile: vi.fn(),
  navigate: vi.fn((options: any) => {
    const nextSearch =
      typeof options?.search === 'function'
        ? options.search(h.search)
        : options?.search

    if (nextSearch && typeof nextSearch === 'object') {
      h.search = Object.fromEntries(
        Object.entries(nextSearch).filter(([, value]) => value !== undefined)
      )
    }
  }),
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
  search: {} as Record<string, unknown>,
}))

vi.mock('@janhq/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@janhq/core')>()
  return {
    ...actual,
    fs: {
      ...actual.fs,
      copyFile: h.copyFile,
    },
  }
})

vi.mock('sonner', () => ({
  toast: h.toast,
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: any) => ({ ...config, id: '/images' }),
  useSearch: () => h.search,
  useNavigate: () => h.navigate,
  Link: ({ children, to }: any) => <a href={to}>{children}</a>,
}))

vi.mock('@/containers/HeaderPage', () => ({
  default: ({ children }: any) => (
    <div data-testid="header-page">{children}</div>
  ),
}))

vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: (selector: any) => selector({ providers: h.providers }),
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    imageGeneration: () => ({
      generateImages: h.generateImages,
      saveAsset: h.saveAsset,
      importAsset: h.importAsset,
      listAssets: h.listAssets,
      deleteAsset: h.deleteAsset,
    }),
    videoGeneration: () => ({
      generateVideo: h.generateVideo,
      pollVideoTask: h.pollVideoTask,
      saveVideoAsset: h.saveVideoAsset,
      listVideoAssets: h.listVideoAssets,
      deleteVideoAsset: h.deleteVideoAsset,
    }),
    storyboardGeneration: () => ({
      breakdownStoryboard: h.breakdownStoryboard,
    }),
    dialog: () => ({ open: h.dialogOpen, save: h.dialogSave }),
    core: () => ({ convertFileSrc: h.convertFileSrc }),
    opener: () => ({
      revealItemInDir: h.revealItemInDir,
      openExternalUrl: h.openExternalUrl,
    }),
  }),
}))

vi.mock('@/constants/routes', () => ({
  route: {
    images: '/images',
    settings: { model_providers: '/settings/providers' },
  },
}))

const translations: Record<string, string> = {
  'common:preview': 'Preview',
  'common:cancel': 'Cancel',
  'common:imageGeneration.emptyState': 'Generated images will appear here.',
  'common:imageGeneration.mode.image': 'Image',
  'common:imageGeneration.mode.storyboardVideo': 'Storyboard video',
  'common:imageGeneration.mode.newBadge': 'New',
  'common:imageGeneration.mode.longVideo': 'Long video',
  'common:imageGeneration.mode.soonBadge': 'Coming soon',
  'common:imageGeneration.storyboard.title': 'Storyboard short film',
  'common:imageGeneration.storyboard.newMediaPrefix': 'New Media',
  'common:imageGeneration.storyboard.storyPlaceholder':
    'Describe the single video you want in one sentence.',
  'common:imageGeneration.storyboard.aiBreakdown': 'Optimize prompt',
  'common:imageGeneration.storyboard.regenerateBreakdown':
    'Re-optimize',
  'common:imageGeneration.storyboard.undoPrompt': 'Undo',
  'common:imageGeneration.storyboard.redoPrompt': 'Redo',
  'common:imageGeneration.storyboard.shotScript': 'Shot script',
  'common:imageGeneration.storyboard.generateStoryboard':
    'Generate storyboard image',
  'common:imageGeneration.storyboard.storyboardReady': 'Storyboard ready',
  'common:imageGeneration.storyboard.videoModelRequired':
    'Configure a video model to generate video.',
  'common:imageGeneration.storyboard.generateVideo': 'Generate video',
  'common:imageGeneration.storyboard.downloadStoryboard': 'Download storyboard',
  'common:imageGeneration.storyboard.downloadVideo': 'Download video',
  'common:imageGeneration.storyboard.variantCount': 'Variants',
  'common:imageGeneration.storyboard.prompt': 'Prompt',
  'common:imageGeneration.storyboard.promptEmpty':
    'Click AI breakdown to generate professional prompt variants here.',
  'common:imageGeneration.storyboard.promptTabLabel': 'Prompt {{index}}',
  'common:imageGeneration.storyboard.actions': 'Storyboard actions',
  'common:imageGeneration.storyboard.duration': 'Duration',
  'common:imageGeneration.storyboard.videoModel': 'Video model',
  'common:imageGeneration.storyboard.videoModelMissing':
    'No video model configured',
  'common:imageGeneration.storyboard.searchVideoModels': 'Search video models',
  'common:imageGeneration.storyboard.noVideoModelsFound':
    'No video models found',
  'common:imageGeneration.storyboard.storyLabel': 'Story description',
  'common:imageGeneration.storyboard.visualStyle': 'Visual style',
  'common:imageGeneration.storyboard.templateLabel': 'Storyboard layout',
  'common:imageGeneration.storyboard.aspectRatio': 'Aspect ratio',
  'common:imageGeneration.storyboard.advancedTitle':
    'System prompt and advanced settings',
  'common:imageGeneration.storyboard.advancedHint':
    'Consistency · references · seed',
  'common:imageGeneration.storyboard.systemPrompt': 'System prompt',
  'common:imageGeneration.storyboard.systemPromptHint':
    'Injected into every shot to keep character, color, and composition consistent.',
  'common:imageGeneration.storyboard.characterReferences':
    'Character references',
  'common:imageGeneration.storyboard.references': 'Reference images',
  'common:imageGeneration.storyboard.addReferenceSlot':
    'Add another reference image',
  'common:imageGeneration.storyboard.referenceModelUnsupported':
    'The selected image model does not support reference inputs, so storyboard generation will use text only.',
  'common:imageGeneration.storyboard.seed': 'Random seed',
  'common:imageGeneration.storyboard.consistencyLabel': 'Shot consistency',
  'common:imageGeneration.storyboard.shotScriptHint':
    '{{count}} shots · editable',
  'common:imageGeneration.storyboard.promptHint':
    'AI generated · sent to {{imageModel}}',
  'common:imageGeneration.storyboard.generateStoryboardHint':
    'Generate 1 storyboard image with {{imageModel}} · {{aspect}} · {{quality}}',
  'common:imageGeneration.storyboard.generatedMeta':
    '{{imageModel}} · {{aspect}} · {{quality}}',
  'common:imageGeneration.storyboard.backToScript': 'Back to script',
  'common:imageGeneration.storyboard.nextStep': 'Next · generate video',
  'common:imageGeneration.storyboard.sourceStoryboardTitle':
    'Source · 1 storyboard image',
  'common:imageGeneration.storyboard.sourceStoryboardMeta':
    '{{imageModel}} · {{aspect}} · {{count}} shots',
  'common:imageGeneration.storyboard.sourceStoryboardHint':
    'The video model will use this storyboard image as reference input to generate one complete video.',
  'common:imageGeneration.storyboard.viewStoryboard': 'View storyboard',
  'common:imageGeneration.storyboard.openPreview': 'Open preview',
  'common:imageGeneration.storyboard.previewTitle': 'Storyboard preview',
  'common:imageGeneration.storyboard.noStoryboardPreview':
    'No storyboard image to preview yet.',
  'common:imageGeneration.storyboard.editStoryboard': 'Edit storyboard',
  'common:imageGeneration.storyboard.zoomIn': 'Zoom in',
  'common:imageGeneration.storyboard.zoomOut': 'Zoom out',
  'common:imageGeneration.storyboard.videoDoneMeta':
    'Rendered · {{duration}}s · {{resolution}}',
  'common:imageGeneration.storyboard.saveToMediaLibrary':
    'Save to media library',
  'common:imageGeneration.storyboard.fps': 'Frame rate',
  'common:imageGeneration.storyboard.defaultCamera': 'Default camera',
  'common:imageGeneration.storyboard.motion': 'Motion',
  'common:imageGeneration.storyboard.aiMusic': 'AI music',
  'common:imageGeneration.storyboard.subtitle.compose':
    'Single video generation. Describe your story in one sentence, then use AI and a template to generate professional prompts. Use an image model to create one storyboard image, then a video model can generate one complete video.',
  'common:imageGeneration.storyboard.subtitle.storyboard':
    'Single storyboard image generated by {{imageModel}} · {{template}} · {{count}} shots · {{aspect}} · {{quality}}',
  'common:imageGeneration.storyboard.subtitle.video':
    'After configuring video parameters, {{videoModel}} will use the storyboard image as reference to generate one complete video.',
  'common:imageGeneration.storyboard.styles.cinematic': 'Cinematic',
  'common:imageGeneration.storyboard.styles.animation3d': '3D animation',
  'common:imageGeneration.storyboard.styles.realisticPhoto': 'Realistic photo',
  'common:imageGeneration.storyboard.styles.cyberpunk': 'Cyberpunk',
  'common:imageGeneration.storyboard.styles.watercolor': 'Watercolor',
  'common:imageGeneration.storyboard.styles.minimal': 'Minimal',
  'common:imageGeneration.storyboard.templates.plain.label': 'Plain image',
  'common:imageGeneration.storyboard.templates.plain.description':
    'No layout prompt',
  'common:imageGeneration.storyboard.templates.grid.label': 'Grid shots',
  'common:imageGeneration.storyboard.templates.grid.description':
    'Comic panel layout',
  'common:imageGeneration.storyboard.templates.table.label': 'Shot table',
  'common:imageGeneration.storyboard.templates.table.description':
    'Camera table',
  'common:imageGeneration.storyboard.templates.board.label': 'Visual dev board',
  'common:imageGeneration.storyboard.templates.board.description':
    'Palette/reference/params',
  'common:imageGeneration.storyboard.consistency.standard': 'Standard',
  'common:imageGeneration.storyboard.consistency.strong': 'Strong',
  'common:imageGeneration.storyboard.consistency.lockedCharacter':
    'Lock character',
  'common:imageGeneration.storyboard.camera.auto': 'Auto',
  'common:imageGeneration.storyboard.camera.pushIn': 'Push in',
  'common:imageGeneration.storyboard.camera.pullOut': 'Pull out',
  'common:imageGeneration.storyboard.camera.orbit': 'Orbit',
  'common:imageGeneration.storyboard.camera.truck': 'Truck',
  'common:imageGeneration.storyboard.camera.tiltUp': 'Tilt up',
  'common:imageGeneration.storyboard.camera.handheld': 'Handheld follow',
  'common:imageGeneration.storyboard.motionLevel.light': 'Light',
  'common:imageGeneration.storyboard.motionLevel.medium': 'Medium',
  'common:imageGeneration.storyboard.motionLevel.strong': 'Strong',
  'common:imageGeneration.storyboard.version.original': 'Original',
  'common:imageGeneration.storyboard.version.edited': 'Edit {{index}}',
  'common:imageGeneration.storyboard.version.editedPromptSuffix':
    'edited storyboard version',
  'common:imageGeneration.storyboard.editor.title': 'Edit storyboard',
  'common:imageGeneration.storyboard.editor.tool': 'Tool',
  'common:imageGeneration.storyboard.editor.pan': 'Pan',
  'common:imageGeneration.storyboard.editor.pen': 'Pen',
  'common:imageGeneration.storyboard.editor.rect': 'Box',
  'common:imageGeneration.storyboard.editor.crop': 'Crop',
  'common:imageGeneration.storyboard.editor.color': 'Color',
  'common:imageGeneration.storyboard.editor.colorOption':
    'Choose color {{color}}',
  'common:imageGeneration.storyboard.editor.zoom': 'Zoom',
  'common:imageGeneration.storyboard.editor.undo': 'Undo',
  'common:imageGeneration.storyboard.editor.redo': 'Redo',
  'common:imageGeneration.storyboard.editor.save': 'Save version',
  'common:imageGeneration.storyboard.editor.saved': 'Edited storyboard saved',
  'common:imageGeneration.storyboard.editor.saveFailed':
    'Failed to save edited storyboard',
  'common:imageGeneration.storyboard.step.compose': 'Script & prompt',
  'common:imageGeneration.storyboard.step.storyboard': 'Storyboard',
  'common:imageGeneration.storyboard.step.video': 'Video',
  'common:imageGeneration.noImageModelsAvailable': 'No image models available',
  'common:imageGeneration.openProviders': 'Open Providers',
  'common:imageGeneration.selectImageModel': 'Select image model',
  'common:imageGeneration.provider': 'Provider',
  'common:imageGeneration.imageModel': 'Image model',
  'common:imageGeneration.noImageModelsFound': 'No image models found',
  'common:imageGeneration.today': 'Today',
  'common:imageGeneration.generate': 'Generate',
  'common:imageGeneration.imageSizeSettings': 'Image size settings',
  'common:imageGeneration.quality.sd': 'HD 2K',
  'common:imageGeneration.quality.sdCompact': 'HD 2K',
  'common:imageGeneration.quality.hd': 'Ultra HD 4K',
  'common:imageGeneration.quality.hdCompact': 'Ultra HD 4K',
  'common:imageGeneration.selectRatio': 'Select ratio',
  'common:imageGeneration.selectQuality': 'Select resolution',
  'common:imageGeneration.referenceImage': 'Reference image',
  'common:imageGeneration.reference': 'Reference',
  'common:imageGeneration.chooseReferenceFromComputer': 'Choose from computer',
  'common:imageGeneration.localReferenceImage': 'Local reference image',
  'common:imageGeneration.pastedReferenceImage': 'Pasted reference image',
  'common:imageGeneration.addReferenceImage': 'Add reference image',
  'common:imageGeneration.removeReferenceImage': 'Remove {{prompt}}',
  'common:imageGeneration.imageFiles': 'Image files',
  'common:imageGeneration.clearSource': 'Clear source',
  'common:imageGeneration.promptPlaceholder':
    'Upload a reference image, type a prompt, or describe what you want to generate.',
  'common:imageGeneration.sourceModelUnsupported':
    'Source image requires an edit-capable model.',
  'common:imageGeneration.useSavedAsset': 'Use saved asset',
  'common:imageGeneration.useSourceImage': 'Use source image',
  'common:imageGeneration.usePromptAsSource': 'Use {{prompt}} as source',
  'common:imageGeneration.useAsSource': 'Use as source',
  'common:imageGeneration.openInFileManager': 'Open in Finder / Explorer',
  'common:imageGeneration.openInFinder': 'Open in Finder',
  'common:imageGeneration.openInExplorer': 'Open in Explorer',
  'common:imageGeneration.openInSystemFileManager': 'Open in file manager',
  'common:imageGeneration.status.saved': 'Saved',
  'common:imageGeneration.status.pending': 'Pending',
  'common:imageGeneration.status.running': 'Running',
  'common:imageGeneration.status.succeeded': 'Succeeded',
  'common:imageGeneration.status.failed': 'Failed',
  'common:imageGeneration.toast.referenceImported': 'Reference image imported',
  'common:imageGeneration.toast.waitForReferenceImport':
    'Reference image is still importing. Try again in a moment.',
  'common:imageGeneration.toast.importReferenceFailed':
    'Failed to import reference image',
  'common:imageGeneration.toast.unsupportedReferenceFormat':
    'Use PNG, JPG, or WEBP reference images.',
  'common:imageGeneration.toast.selectEditCapableModel':
    'Select an image model that supports source images',
  'common:imageGeneration.defaultVariationPrompt':
    'Create a fresh variation of this image.',
  'common:imageGeneration.defaultMultiSourcePrompt':
    'Create a new image based on these reference images.',
  'common:imageGeneration.imageCount.one': '{{count}} image',
  'common:imageGeneration.imageCount.other': '{{count}} images',
  'common:imageGeneration.imagePreview': 'Image preview',
  'common:imageGeneration.decreaseCount': 'Decrease count',
  'common:imageGeneration.increaseCount': 'Increase count',
  'common:imageGeneration.reEdit': 'Re-edit',
  'common:imageGeneration.regenerate': 'Regenerate',
  'common:imageGeneration.retry': 'Retry',
  'common:imageGeneration.retryIn': 'Retry in {{seconds}}s',
  'common:imageGeneration.toast.referenceLimitReached':
    'You can use up to {{count}} reference images.',
  'common:imageGeneration.toast.retryCoolingDown':
    'Image service is cooling down. Try again in {{seconds}}s.',
  'common:imageGeneration.errors.rateLimited':
    'Image service is busy. Please try again later.',
  'common:imageGeneration.errors.requestTimeout':
    'Image generation request timed out. Please try again later.',
  'common:providerQuota.title': 'Provider quota exhausted',
  'common:providerQuota.recharge': 'Recharge',
  'common:providerQuota.manageTokens': 'Manage tokens',
  'common:providerQuota.linksUnavailable': 'No links available',
  'common:toast.downloadComplete.title': 'Download complete',
  'common:toast.downloadComplete.description': '{{item}} saved',
  'common:toast.downloadFailed.title': 'Download failed',
  'common:toast.downloadFailed.description': 'Could not save {{item}}',
}

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      (translations[key] ?? key).replace(/\{\{(\w+)\}\}/g, (match, name) =>
        options?.[name] !== undefined ? String(options[name]) : match
      ),
  }),
}))

import { Route } from '../images'

const renderComponent = () => {
  const Component = Route.component as React.ComponentType
  return render(<Component />)
}

describe('Images route', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  beforeEach(() => {
    localStorage.clear()
    act(() => {
      useImageGenerationStore.getState().reset()
      useVideoGenerationStore.getState().reset()
      useStoryboardSessionStore.getState().clear()
    })
    vi.clearAllMocks()
    h.providers = []
    h.assets = []
    h.generateImages.mockResolvedValue([])
    h.saveAsset.mockResolvedValue(null)
    h.importAsset.mockResolvedValue(null)
    h.listAssets.mockResolvedValue([])
    h.generateVideo.mockResolvedValue(null)
    h.pollVideoTask.mockResolvedValue(null)
    h.saveVideoAsset.mockResolvedValue(null)
    h.listVideoAssets.mockResolvedValue([])
    h.deleteVideoAsset.mockResolvedValue(undefined)
    h.breakdownStoryboard.mockResolvedValue(null)
    h.dialogOpen.mockResolvedValue(null)
    h.dialogSave.mockResolvedValue(null)
    h.revealItemInDir.mockResolvedValue(undefined)
    h.openExternalUrl.mockResolvedValue(undefined)
    h.copyFile.mockResolvedValue(undefined)
    h.navigate.mockClear()
    h.toast.success.mockClear()
    h.toast.error.mockClear()
    h.search = {}
  })

  it('shows the no-image-model empty state', async () => {
    renderComponent()

    expect(
      await screen.findByText('No image models available')
    ).toBeInTheDocument()
    expect(screen.getByText('Open Providers')).toBeInTheDocument()
  })

  it('renders image controls when an image generation model is available', async () => {
    h.providers = [
      {
        provider: 'jingxing',
        base_url: 'https://api.jingxing.uk/v1',
        settings: [],
        models: [
          {
            id: 'gpt-image-2',
            capabilities: [ModelCapabilities.IMAGE_GENERATION],
          },
          {
            id: 'gemini-2.5-flash-image',
            capabilities: [ModelCapabilities.IMAGE_GENERATION],
          },
          {
            id: 'gpt-image-1.5',
            capabilities: [ModelCapabilities.IMAGE_GENERATION],
          },
          {
            id: 'gpt-5.4',
            capabilities: [ModelCapabilities.COMPLETION],
          },
        ],
      },
    ]

    renderComponent()

    await waitFor(() => expect(h.listAssets).toHaveBeenCalled())
    expect(screen.queryByText('New Image')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Image model' })
    ).toHaveTextContent('gpt-image-1.5')
    expect(
      screen.getByRole('button', { name: 'Image model' })
    ).not.toHaveTextContent('Jingxing')
    expect(
      within(screen.getByRole('button', { name: 'Image model' })).getByAltText(
        'openai - Logo'
      )
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Image model' })
    ).not.toHaveTextContent('Model ·')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Image model' }))
    })
    expect(
      screen.getByRole('button', { name: 'gemini-2.5-flash-image' })
    ).toBeInTheDocument()
    expect(
      within(
        screen.getByRole('button', { name: 'gemini-2.5-flash-image' })
      ).getByAltText('gemini - Logo')
    ).toBeInTheDocument()
    expect(
      within(screen.getByRole('button', { name: 'gpt-image-2' })).getByAltText(
        'openai - Logo'
      )
    ).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(
        await screen.findByRole('button', { name: 'gpt-image-2' })
      )
    })
    expect(
      screen.getByRole('button', { name: 'Image model' })
    ).toHaveTextContent('gpt-image-2')
    expect(screen.getByText('Today')).toBeInTheDocument()
    expect(screen.queryByText('Queue')).not.toBeInTheDocument()
    expect(screen.queryByText('Assets')).not.toBeInTheDocument()
    expect(screen.queryByText('图片生成')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Image' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Storyboard video' })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Long video' })).toBeDisabled()
    expect(
      screen.queryByRole('button', { name: 'Generate' })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Edit' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Variation' })
    ).not.toBeInTheDocument()
    expect(screen.queryByText('1 image')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Image size settings' })
    ).toHaveTextContent('1:1')
    expect(
      screen.getByRole('button', { name: 'Image size settings' })
    ).toHaveTextContent('HD 2K')
    expect(screen.queryByText('SD')).not.toBeInTheDocument()
    expect(screen.queryByText('HD')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Image size settings' }))
    expect(screen.getByText('Select ratio')).toBeInTheDocument()
    expect(screen.getByText('Select resolution')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '智能' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '21:9' })
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '16:9' }))
    fireEvent.click(screen.getByRole('button', { name: /Ultra HD 4K/ }))
    expect(
      screen.getByRole('button', { name: 'Image size settings' })
    ).toHaveTextContent('16:9')
    expect(
      screen.getByRole('button', { name: 'Image size settings' })
    ).toHaveTextContent('Ultra HD 4K')
  })

  it('keeps long image prompts scrollable inside the pinned composer', async () => {
    h.providers = [
      {
        provider: 'jingxing',
        base_url: 'https://api.jingxing.uk/v1',
        settings: [],
        models: [
          {
            id: 'gpt-image-1.5',
            capabilities: [ModelCapabilities.IMAGE_GENERATION],
          },
        ],
      },
    ]

    renderComponent()

    await waitFor(() => expect(h.listAssets).toHaveBeenCalled())
    const promptInput = screen.getByPlaceholderText(/Upload a reference image/)
    expect(promptInput).toHaveClass(
      'max-h-[40svh]',
      'overflow-y-auto',
      'overscroll-contain',
      '[scrollbar-gutter:stable]'
    )
  })

  it('keeps an in-flight image task visible after leaving and returning to the media route', async () => {
    h.providers = [
      {
        provider: 'jingxing',
        base_url: 'https://api.jingxing.uk/v1',
        settings: [],
        models: [
          {
            id: 'gpt-image-2',
            capabilities: [ModelCapabilities.IMAGE_GENERATION],
          },
        ],
      },
    ]
    let resolveGeneration:
      | ((
          images: Array<{
            b64Json: string
            mimeType: string
            usage?: unknown
          }>
        ) => void)
      | undefined
    h.generateImages.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveGeneration = resolve
        })
    )
    h.saveAsset.mockImplementation((request: any) =>
      Promise.resolve({
        ...request,
        createdAt: '2026-06-08T00:00:00Z',
        path: `/mock/mita/image-assets/${request.id}/image.png`,
        fileName: 'image.png',
      })
    )
    vi.stubGlobal(
      'Image',
      class {
        naturalWidth = 1024
        naturalHeight = 1024
        onload?: () => void
        set src(_value: string) {
          this.onload?.()
        }
      }
    )

    let firstRender: ReturnType<typeof render> | undefined
    await act(async () => {
      firstRender = renderComponent()
    })

    await waitFor(() => expect(h.listAssets).toHaveBeenCalled())
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText(/Upload a reference image/), {
        target: { value: 'moon desk' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
    })

    expect(await screen.findByText('Running')).toBeInTheDocument()

    const listCallsBeforeReturn = h.listAssets.mock.calls.length
    await act(async () => {
      firstRender?.unmount()
    })
    await act(async () => {
      renderComponent()
    })

    await waitFor(() =>
      expect(h.listAssets.mock.calls.length).toBeGreaterThan(
        listCallsBeforeReturn
      )
    )
    expect(screen.getByText('Running')).toBeInTheDocument()

    await act(async () => {
      resolveGeneration?.([
        {
          b64Json: 'aGVsbG8=',
          mimeType: 'image/png',
          usage: { total_tokens: 1234 },
        },
      ])
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(await screen.findByText('Succeeded')).toBeInTheDocument()
    expect(await screen.findByAltText('moon desk')).toBeInTheDocument()
    expect(await screen.findByText('1,234 tokens')).toBeInTheDocument()
  })

  it('switches to storyboard video mode and generates a storyboard image', async () => {
    h.providers = [
      {
        provider: 'jingxing',
        base_url: 'https://api.jingxing.uk/v1',
        settings: [],
        models: [
          {
            id: 'gpt-5-mini',
            capabilities: [ModelCapabilities.COMPLETION],
          },
          {
            id: 'gpt-image-2',
            capabilities: [ModelCapabilities.IMAGE_GENERATION],
          },
        ],
      },
    ]
    h.generateImages.mockResolvedValueOnce([
      {
        b64Json: 'aGVsbG8=',
        mimeType: 'image/png',
        revisedPrompt: 'storyboard',
      },
    ])
    h.saveAsset.mockImplementation((request: any) =>
      Promise.resolve({
        ...request,
        createdAt: '2026-06-04T00:00:00Z',
        path: `/mock/mita/image-assets/${request.id}/image.png`,
        fileName: 'image.png',
      })
    )
    h.breakdownStoryboard.mockResolvedValue({
      shots: [
        {
          title: 'Wake',
          camera: 'Slow push in',
          prompt: 'A gold robot wakes in a neon city.',
          duration: 5,
        },
        {
          title: 'Cross',
          camera: 'Tracking shot',
          prompt: 'The gold robot crosses a glowing corridor.',
          duration: 5,
        },
      ],
      storyboardPrompt: 'LLM storyboard prompt with numbered panels.',
    })
    vi.stubGlobal(
      'Image',
      class {
        naturalWidth = 0
        naturalHeight = 0
        onerror?: () => void
        set src(_value: string) {
          this.onerror?.()
        }
      }
    )

    renderComponent()

    await waitFor(() => expect(h.listAssets).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Storyboard video' }))

    expect(screen.getByText('Storyboard short film')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Plain image/ }))
    fireEvent.change(
      screen.getByPlaceholderText(
        'Describe the single video you want in one sentence.'
      ),
      {
        target: {
          value:
            'A gold robot wakes in a neon city, crosses a corridor, and reaches a rooftop.',
        },
      }
    )
    fireEvent.click(screen.getByRole('button', { name: 'Optimize prompt' }))

    await waitFor(() =>
      expect(h.breakdownStoryboard).toHaveBeenCalledWith(
        expect.objectContaining({
          model: expect.objectContaining({ id: 'gpt-5-mini' }),
          shotCount: 6,
          template: 'plain',
        })
      )
    )
    expect(
      await screen.findByDisplayValue('LLM storyboard prompt with numbered panels.')
    ).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: 'Generate storyboard image' })
    )

    await waitFor(() => expect(h.generateImages).toHaveBeenCalled())
    expect(h.generateImages.mock.calls.at(-1)?.[0]).toMatchObject({
      mode: 'generate',
      model: expect.objectContaining({ id: 'gpt-image-2' }),
      count: 1,
      sourceAssets: [],
    })
    expect(h.generateImages.mock.calls.at(-1)?.[0].prompt).toContain(
      'LLM storyboard prompt'
    )
    expect(h.saveAsset.mock.calls.at(-1)?.[0]).toMatchObject({
      assetKind: 'storyboard',
    })
    expect(await screen.findByText('Storyboard ready')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Original' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Open preview' })
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open preview' }))
    expect(await screen.findByText('Storyboard preview')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    const canvasContext = {
      beginPath: vi.fn(),
      clearRect: vi.fn(),
      closePath: vi.fn(),
      drawImage: vi.fn(),
      lineTo: vi.fn(),
      moveTo: vi.fn(),
      stroke: vi.fn(),
      strokeRect: vi.fn(),
      lineCap: 'round',
      lineJoin: 'round',
      lineWidth: 4,
      strokeStyle: '#f36f4f',
    }
    const getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(canvasContext as any)
    const toDataUrlSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'toDataURL')
      .mockReturnValue('data:image/png;base64,ZWRpdGVk')
    class EditorImage {
      naturalWidth = 80
      naturalHeight = 45
      width = 80
      height = 45
      onload?: () => void
      onerror?: () => void
      set crossOrigin(_value: string) {}
      set src(_value: string) {
        this.onload?.()
      }
    }
    vi.stubGlobal('Image', EditorImage)
    window.Image = EditorImage as any
    fireEvent.click(screen.getByRole('button', { name: 'Edit storyboard' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save version' })).toBeEnabled()
    )

    const canvas = document.querySelector('canvas') as HTMLCanvasElement
    const rectSpy = vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      bottom: 45,
      height: 45,
      left: 0,
      right: 80,
      top: 0,
      width: 80,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    const fireCanvasPointer = (
      type: 'pointerdown' | 'pointermove' | 'pointerup',
      x: number,
      y: number,
      pointerId: number
    ) => {
      const event = new Event(type, { bubbles: true, cancelable: true })
      Object.defineProperties(event, {
        clientX: { value: x },
        clientY: { value: y },
        pointerId: { value: pointerId },
      })
      fireEvent(canvas, event)
    }
    const editorViewport = canvas.closest('.overflow-auto') as HTMLDivElement
    editorViewport.scrollLeft = 120
    editorViewport.scrollTop = 80

    fireEvent.click(screen.getByRole('button', { name: 'Pan' }))
    fireCanvasPointer('pointerdown', 40, 35, 3)
    fireCanvasPointer('pointermove', 10, 15, 3)
    fireCanvasPointer('pointerup', 10, 15, 3)
    expect(editorViewport.scrollLeft).toBe(150)
    expect(editorViewport.scrollTop).toBe(100)

    rectSpy.mockReturnValue({
      bottom: 90,
      height: 90,
      left: 0,
      right: 160,
      top: 0,
      width: 160,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Choose color #2563eb' })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Box' }))
    fireCanvasPointer('pointerdown', 20, 20, 1)
    fireCanvasPointer('pointermove', 70, 50, 1)
    const boxOverlay = document.querySelector('.border-dashed') as HTMLElement
    expect(boxOverlay).toHaveStyle({
      left: '10px',
      top: '10px',
      width: '25px',
      height: '15px',
    })
    fireCanvasPointer('pointerup', 70, 50, 1)
    expect(canvasContext.strokeRect).toHaveBeenCalledWith(10, 10, 25, 15)
    await waitFor(() => expect(canvasContext.strokeRect).toHaveBeenCalled())
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled()
    )
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Redo' })).toBeEnabled()
    )
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }))

    fireEvent.click(screen.getByRole('button', { name: 'Crop' }))
    rectSpy.mockReturnValue({
      bottom: 90,
      height: 90,
      left: 0,
      right: 160,
      top: 0,
      width: 160,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    fireCanvasPointer('pointerdown', 20, 20, 2)
    fireCanvasPointer('pointermove', 70, 50, 2)
    const cropOverlay = document.querySelector('.border-dashed') as HTMLElement
    expect(cropOverlay).toHaveStyle({
      left: '10px',
      top: '10px',
      width: '25px',
      height: '15px',
    })
    fireCanvasPointer('pointerup', 70, 50, 2)
    await waitFor(() => expect(canvas.width).toBe(25))
    expect(canvas.height).toBe(15)

    fireEvent.click(screen.getByRole('button', { name: 'Save version' }))
    await waitFor(() => expect(h.saveAsset).toHaveBeenCalledTimes(2))
    expect(h.saveAsset.mock.calls.at(-1)?.[0]).toMatchObject({
      mode: 'edit',
      mimeType: 'image/png',
      b64Json: 'ZWRpdGVk',
      sourceAssetIds: [expect.any(String)],
    })
    expect(
      await screen.findByRole('button', { name: 'Edit 1' })
    ).toBeInTheDocument()
    rectSpy.mockRestore()
    getContextSpy.mockRestore()
    toDataUrlSpy.mockRestore()
    expect(
      screen.getByText('Configure a video model to generate video.')
    ).toBeInTheDocument()
  })

  it('adds an exact shot-count contract when generating a storyboard sheet directly', async () => {
    h.providers = [
      {
        provider: 'jingxing',
        base_url: 'https://api.jingxing.uk/v1',
        settings: [],
        models: [
          {
            id: 'gpt-image-2',
            capabilities: [ModelCapabilities.IMAGE_GENERATION],
          },
        ],
      },
    ]
    h.generateImages.mockResolvedValueOnce([
      {
        b64Json: 'aGVsbG8=',
        mimeType: 'image/png',
        revisedPrompt: 'storyboard',
      },
    ])
    h.saveAsset.mockImplementation((request: any) =>
      Promise.resolve({
        ...request,
        createdAt: '2026-06-04T00:00:00Z',
        path: `/mock/mita/image-assets/${request.id}/image.png`,
        fileName: 'image.png',
      })
    )
    vi.stubGlobal(
      'Image',
      class {
        naturalWidth = 0
        naturalHeight = 0
        onerror?: () => void
        set src(_value: string) {
          this.onerror?.()
        }
      }
    )

    renderComponent()

    await waitFor(() => expect(h.listAssets).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Storyboard video' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Generate storyboard image' })
    )

    await waitFor(() => expect(h.generateImages).toHaveBeenCalled())
    const prompt = h.generateImages.mock.calls.at(-1)?.[0].prompt
    expect(prompt).toContain('必须且只能包含 6 个分镜')
    expect(prompt).toContain('exactly 6 storyboard panels')
    expect(prompt).toContain('\n\n分镜数量硬性要求')
    expect(prompt).toContain('分镜清单')
    expect(prompt).toContain('1. 镜头 1')
    expect(prompt).toContain('6. 镜头 6')
    expect(prompt.match(/exactly 6 storyboard panels/g)).toHaveLength(1)
  })

  it('does not reuse restored storyboard shots after the story text changes', async () => {
    h.providers = [
      {
        provider: 'jingxing',
        base_url: 'https://api.jingxing.uk/v1',
        settings: [],
        models: [
          {
            id: 'gpt-image-2',
            capabilities: [ModelCapabilities.IMAGE_GENERATION],
          },
        ],
      },
    ]
    h.generateImages.mockResolvedValueOnce([
      {
        b64Json: 'aGVsbG8=',
        mimeType: 'image/png',
        revisedPrompt: 'fresh storyboard',
      },
    ])
    h.saveAsset.mockImplementation((request: any) =>
      Promise.resolve({
        ...request,
        createdAt: '2026-06-22T00:00:00Z',
        path: `/mock/mita/image-assets/${request.id}/image.png`,
        fileName: 'image.png',
      })
    )
    vi.stubGlobal(
      'Image',
      class {
        naturalWidth = 0
        naturalHeight = 0
        onerror?: () => void
        set src(_value: string) {
          this.onerror?.()
        }
      }
    )

    act(() => {
      useStoryboardSessionStore.getState().save({
        stage: 'compose',
        story: 'Old optimized motorcycle storyboard prompt.',
        settings: {
          style: '电影感',
          aspect: '16:9',
          qualityPreset: 'sd',
          variantCount: 1,
          template: 'board',
          consistency: 'lockedCharacter',
        },
        videoSettings: {
          ratio: '16:9',
          resolution: '1080p',
          duration: 8,
          fps: 30,
          camera: '自动',
          motion: 55,
          generateAudio: true,
        },
        shots: [
          {
            id: 'old-shot',
            title: 'Old rider',
            camera: 'Low angle',
            prompt: 'A professional motorcycle rider crosses a muddy forest.',
            duration: 5,
          },
        ],
        promptTabs: [
          {
            id: 'old-tab',
            label: 'Prompt 1',
            prompt: 'Old optimized motorcycle storyboard prompt.',
            shots: [
              {
                id: 'old-shot',
                title: 'Old rider',
                camera: 'Low angle',
                prompt:
                  'A professional motorcycle rider crosses a muddy forest.',
                duration: 5,
              },
            ],
            createdAt: '2026-06-21T00:00:00Z',
          },
        ],
        activePromptTabId: 'old-tab',
        storyboardStatus: 'idle',
        storyboardAsset: undefined,
        storyboardVersions: [],
        activeStoryboardVersionId: '',
        referenceAssets: [],
        selectedVideoModelKey: '',
        videoAsset: undefined,
      } as any)
      useStoryboardSessionStore.getState().setMediaMode('storyboard')
    })

    renderComponent()

    await waitFor(() => expect(h.listAssets).toHaveBeenCalled())
    fireEvent.change(
      screen.getByPlaceholderText(
        'Describe the single video you want in one sentence.'
      ),
      {
        target: {
          value:
            'A rainy highway ambush with two characters moving through sunset mist.',
        },
      }
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Generate storyboard image' })
    )

    await waitFor(() => expect(h.generateImages).toHaveBeenCalled())
    const prompt = h.generateImages.mock.calls.at(-1)?.[0].prompt
    expect(prompt).toContain('A rainy highway ambush')
    expect(prompt).not.toContain('motorcycle')
    expect(prompt).not.toContain('muddy forest')
    expect(prompt).not.toContain('Old optimized motorcycle')
  })

  it('does not reuse restored storyboard reference assets after the story text changes', async () => {
    h.providers = [
      {
        provider: 'jingxing',
        base_url: 'https://api.jingxing.uk/v1',
        settings: [],
        models: [
          {
            id: 'gpt-image-2',
            capabilities: [
              ModelCapabilities.IMAGE_GENERATION,
              ModelCapabilities.IMAGE_TO_IMAGE,
            ],
          },
        ],
      },
    ]
    h.generateImages.mockResolvedValueOnce([
      {
        b64Json: 'aGVsbG8=',
        mimeType: 'image/png',
        revisedPrompt: 'fresh storyboard',
      },
    ])
    h.saveAsset.mockImplementation((request: any) =>
      Promise.resolve({
        ...request,
        createdAt: '2026-06-22T00:00:00Z',
        path: `/mock/mita/image-assets/${request.id}/image.png`,
        fileName: 'image.png',
      })
    )
    vi.stubGlobal(
      'Image',
      class {
        naturalWidth = 0
        naturalHeight = 0
        onerror?: () => void
        set src(_value: string) {
          this.onerror?.()
        }
      }
    )

    act(() => {
      useStoryboardSessionStore.getState().save({
        stage: 'compose',
        story: 'A professional motorcycle rider crosses a muddy forest.',
        settings: {
          style: '电影感',
          aspect: '16:9',
          qualityPreset: 'sd',
          variantCount: 1,
          template: 'board',
          consistency: 'lockedCharacter',
        },
        videoSettings: {
          ratio: '16:9',
          resolution: '1080p',
          duration: 8,
          fps: 30,
          camera: '自动',
          motion: 55,
          generateAudio: true,
        },
        shots: [],
        promptTabs: [],
        activePromptTabId: '',
        storyboardStatus: 'idle',
        storyboardAsset: undefined,
        storyboardVersions: [],
        activeStoryboardVersionId: '',
        referenceAssets: [
          {
            id: 'old-motorcycle-ref',
            prompt: 'old motorcycle rider reference',
            mode: 'edit',
            provider: 'local',
            model: 'reference-image',
            ratio: '1:1',
            size: 'original',
            quality: 'source',
            sourceAssetIds: [],
            createdAt: '2026-06-21T00:00:00Z',
            status: 'succeeded',
            path: '/mock/mita/image-assets/old-motorcycle-ref/image.png',
            fileName: 'image.png',
            mimeType: 'image/png',
            assetKind: 'reference',
          },
        ],
        selectedVideoModelKey: '',
        videoAsset: undefined,
      } as any)
      useStoryboardSessionStore.getState().setMediaMode('storyboard')
    })

    renderComponent()

    await waitFor(() => expect(h.listAssets).toHaveBeenCalled())
    fireEvent.change(
      screen.getByPlaceholderText(
        'Describe the single video you want in one sentence.'
      ),
      {
        target: {
          value:
            'A rainy highway ambush with two characters moving through sunset mist.',
        },
      }
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Generate storyboard image' })
    )

    await waitFor(() => expect(h.generateImages).toHaveBeenCalled())
    expect(h.generateImages.mock.calls.at(-1)?.[0]).toMatchObject({
      mode: 'generate',
      sourceAssets: [],
    })
    expect(h.saveAsset.mock.calls.at(-1)?.[0]).toMatchObject({
      sourceAssetIds: [],
    })
  })

  const REFERENCE_ASSET = {
    id: 'old-motorcycle-ref',
    prompt: 'old motorcycle rider reference',
    mode: 'edit',
    provider: 'local',
    model: 'reference-image',
    ratio: '1:1',
    size: 'original',
    quality: 'source',
    sourceAssetIds: [],
    createdAt: '2026-06-21T00:00:00Z',
    status: 'succeeded',
    path: '/mock/mita/image-assets/old-motorcycle-ref/image.png',
    fileName: 'image.png',
    mimeType: 'image/png',
    assetKind: 'reference',
  }

  // Restores a session whose reference image belongs to an OLD story, on an
  // image-to-image-capable model, with the studio left in storyboard mode.
  const primeImageToImageReferenceSession = () => {
    h.providers = [
      {
        provider: 'jingxing',
        base_url: 'https://api.jingxing.uk/v1',
        settings: [],
        models: [
          {
            id: 'gpt-image-2',
            capabilities: [
              ModelCapabilities.IMAGE_GENERATION,
              ModelCapabilities.IMAGE_TO_IMAGE,
            ],
          },
        ],
      },
    ]
    h.generateImages.mockResolvedValue([
      {
        b64Json: 'aGVsbG8=',
        mimeType: 'image/png',
        revisedPrompt: 'fresh storyboard',
      },
    ])
    h.saveAsset.mockImplementation((request: any) =>
      Promise.resolve({
        ...request,
        createdAt: '2026-06-22T00:00:00Z',
        path: `/mock/mita/image-assets/${request.id}/image.png`,
        fileName: 'image.png',
      })
    )
    vi.stubGlobal(
      'Image',
      class {
        naturalWidth = 0
        naturalHeight = 0
        onerror?: () => void
        set src(_value: string) {
          this.onerror?.()
        }
      }
    )
    act(() => {
      useStoryboardSessionStore.getState().save({
        stage: 'compose',
        story: 'A professional motorcycle rider crosses a muddy forest.',
        settings: {
          style: '电影感',
          aspect: '16:9',
          qualityPreset: 'sd',
          variantCount: 1,
          template: 'board',
          consistency: 'lockedCharacter',
        },
        videoSettings: {
          ratio: '16:9',
          resolution: '1080p',
          duration: 8,
          fps: 30,
          camera: '自动',
          motion: 55,
          generateAudio: true,
        },
        shots: [],
        promptTabs: [],
        activePromptTabId: '',
        storyboardStatus: 'idle',
        storyboardAsset: undefined,
        storyboardVersions: [],
        activeStoryboardVersionId: '',
        referenceAssets: [{ ...REFERENCE_ASSET }],
        selectedVideoModelKey: '',
        videoAsset: undefined,
      } as any)
      useStoryboardSessionStore.getState().setMediaMode('storyboard')
    })
  }

  const editStoryToRainyHighway = () =>
    fireEvent.change(
      screen.getByPlaceholderText(
        'Describe the single video you want in one sentence.'
      ),
      {
        target: {
          value:
            'A rainy highway ambush with two characters moving through sunset mist.',
        },
      }
    )

  const clickGenerateStoryboard = () =>
    fireEvent.click(
      screen.getByRole('button', { name: 'Generate storyboard image' })
    )

  it('keeps restored reference images on screen and holds them after the story text changes', async () => {
    primeImageToImageReferenceSession()
    renderComponent()

    await waitFor(() => expect(h.listAssets).toHaveBeenCalled())
    expect(
      screen.getByAltText('old motorcycle rider reference')
    ).toBeInTheDocument()
    expect(
      screen.queryByTestId('storyboard-references-held')
    ).not.toBeInTheDocument()

    editStoryToRainyHighway()

    // The reference survives the edit (not wiped) but is flagged as held.
    expect(
      screen.getByAltText('old motorcycle rider reference')
    ).toBeInTheDocument()
    expect(
      screen.getByTestId('storyboard-references-held')
    ).toBeInTheDocument()
  })

  it('re-applies held reference images to the edited story for image-to-image generation', async () => {
    primeImageToImageReferenceSession()
    renderComponent()

    await waitFor(() => expect(h.listAssets).toHaveBeenCalled())
    editStoryToRainyHighway()
    fireEvent.click(screen.getByTestId('storyboard-reapply-references'))
    clickGenerateStoryboard()

    await waitFor(() => expect(h.generateImages).toHaveBeenCalled())
    const call = h.generateImages.mock.calls.at(-1)?.[0]
    expect(call.mode).toBe('edit')
    expect(call.sourceAssets.map((asset: any) => asset.id)).toEqual([
      'old-motorcycle-ref',
    ])
    expect(h.saveAsset.mock.calls.at(-1)?.[0]).toMatchObject({
      sourceAssetIds: ['old-motorcycle-ref'],
    })
  })

  it('re-applies the original references after undoing a story edit', async () => {
    primeImageToImageReferenceSession()
    renderComponent()

    await waitFor(() => expect(h.listAssets).toHaveBeenCalled())
    editStoryToRainyHighway()
    expect(screen.getByTestId('storyboard-references-held')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

    // The story is back to its original; the references match again and the
    // held notice is gone, so the next generation conditions on them.
    expect(
      screen.queryByTestId('storyboard-references-held')
    ).not.toBeInTheDocument()
    clickGenerateStoryboard()

    await waitFor(() => expect(h.generateImages).toHaveBeenCalled())
    const call = h.generateImages.mock.calls.at(-1)?.[0]
    expect(call.mode).toBe('edit')
    expect(call.sourceAssets.map((asset: any) => asset.id)).toEqual([
      'old-motorcycle-ref',
    ])
  })

  it('keeps the restored plan but flags it stale, then regenerates from the new story', async () => {
    h.providers = [
      {
        provider: 'jingxing',
        base_url: 'https://api.jingxing.uk/v1',
        settings: [],
        models: [
          {
            id: 'gpt-image-2',
            capabilities: [ModelCapabilities.IMAGE_GENERATION],
          },
        ],
      },
    ]
    h.generateImages.mockResolvedValue([
      {
        b64Json: 'aGVsbG8=',
        mimeType: 'image/png',
        revisedPrompt: 'fresh storyboard',
      },
    ])
    h.saveAsset.mockImplementation((request: any) =>
      Promise.resolve({
        ...request,
        createdAt: '2026-06-22T00:00:00Z',
        path: `/mock/mita/image-assets/${request.id}/image.png`,
        fileName: 'image.png',
      })
    )
    vi.stubGlobal(
      'Image',
      class {
        naturalWidth = 0
        naturalHeight = 0
        onerror?: () => void
        set src(_value: string) {
          this.onerror?.()
        }
      }
    )

    const oldShot = {
      id: 'old-shot',
      title: 'Old rider',
      camera: 'Low angle',
      prompt: 'A professional motorcycle rider crosses a muddy forest.',
      duration: 5,
    }
    act(() => {
      useStoryboardSessionStore.getState().save({
        stage: 'compose',
        story: 'Old optimized motorcycle storyboard prompt.',
        settings: {
          style: '电影感',
          aspect: '16:9',
          qualityPreset: 'sd',
          variantCount: 1,
          template: 'board',
          consistency: 'lockedCharacter',
        },
        videoSettings: {
          ratio: '16:9',
          resolution: '1080p',
          duration: 8,
          fps: 30,
          camera: '自动',
          motion: 55,
          generateAudio: true,
        },
        shots: [oldShot],
        promptTabs: [
          {
            id: 'old-tab',
            label: 'Prompt 1',
            prompt: 'Old optimized motorcycle storyboard prompt.',
            shots: [oldShot],
            createdAt: '2026-06-21T00:00:00Z',
          },
        ],
        activePromptTabId: 'old-tab',
        storyboardStatus: 'idle',
        storyboardAsset: undefined,
        storyboardVersions: [],
        activeStoryboardVersionId: '',
        referenceAssets: [],
        selectedVideoModelKey: '',
        videoAsset: undefined,
      } as any)
      useStoryboardSessionStore.getState().setMediaMode('storyboard')
    })

    renderComponent()

    await waitFor(() => expect(h.listAssets).toHaveBeenCalled())
    // Restored plan matches its story, so nothing is stale yet.
    expect(
      screen.queryByTestId('storyboard-stale-notice')
    ).not.toBeInTheDocument()

    editStoryToRainyHighway()

    // The plan is preserved on screen (not wiped) but flagged for regeneration.
    expect(screen.getByTestId('storyboard-stale-notice')).toBeInTheDocument()

    clickGenerateStoryboard()

    await waitFor(() => expect(h.generateImages).toHaveBeenCalled())
    const prompt = h.generateImages.mock.calls.at(-1)?.[0].prompt
    expect(prompt).toContain('A rainy highway ambush')
    expect(prompt).not.toContain('motorcycle')
    expect(prompt).not.toContain('muddy forest')
  })

  it('does not re-apply held references when a new reference is imported after a story edit', async () => {
    primeImageToImageReferenceSession()
    const newReference = {
      id: 'new-rainy-ref',
      prompt: 'new rainy reference',
      mode: 'edit',
      provider: 'local',
      model: 'reference-image',
      ratio: '1:1',
      size: 'original',
      quality: 'source',
      sourceAssetIds: [],
      createdAt: '2026-06-22T00:00:00Z',
      status: 'succeeded',
      path: '/mock/mita/image-assets/new-rainy-ref/image.png',
      fileName: 'image.png',
      mimeType: 'image/png',
      assetKind: 'reference',
    }
    h.dialogOpen.mockResolvedValue(['/Users/eric/Desktop/rainy.png'])
    h.importAsset.mockResolvedValue(newReference)
    renderComponent()

    await waitFor(() => expect(h.listAssets).toHaveBeenCalled())
    editStoryToRainyHighway()

    // Import a reference for the NEW story while the old one is held.
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Add reference image' })
      )
      await Promise.resolve()
    })
    await waitFor(() => expect(h.importAsset).toHaveBeenCalled())
    await screen.findByAltText('new rainy reference')

    clickGenerateStoryboard()
    await waitFor(() => expect(h.generateImages).toHaveBeenCalled())
    const call = h.generateImages.mock.calls.at(-1)?.[0]
    expect(call.mode).toBe('edit')
    // Only the newly imported reference is used; the held one must not leak back.
    expect(call.sourceAssets.map((asset: any) => asset.id)).toEqual([
      'new-rainy-ref',
    ])
    expect(call.sourceAssets.map((asset: any) => asset.id)).not.toContain(
      'old-motorcycle-ref'
    )
  })

  it('keeps reference images applied across an AI optimize', async () => {
    h.providers = [
      {
        provider: 'jingxing',
        base_url: 'https://api.jingxing.uk/v1',
        settings: [],
        models: [
          {
            id: 'gpt-image-2',
            capabilities: [
              ModelCapabilities.IMAGE_GENERATION,
              ModelCapabilities.IMAGE_TO_IMAGE,
            ],
          },
          {
            id: 'text-model',
            capabilities: [ModelCapabilities.COMPLETION],
          },
        ],
      },
    ]
    h.breakdownStoryboard.mockResolvedValue({
      shots: [
        { title: 'Shot 1', camera: 'wide', prompt: 'neon shot', duration: 2 },
      ],
      storyboardPrompt: 'Optimized neon city storyboard prompt',
    })
    h.generateImages.mockResolvedValue([
      {
        b64Json: 'aGVsbG8=',
        mimeType: 'image/png',
        revisedPrompt: 'fresh storyboard',
      },
    ])
    h.saveAsset.mockImplementation((request: any) =>
      Promise.resolve({
        ...request,
        createdAt: '2026-06-22T00:00:00Z',
        path: `/mock/mita/image-assets/${request.id}/image.png`,
        fileName: 'image.png',
      })
    )
    vi.stubGlobal(
      'Image',
      class {
        naturalWidth = 0
        naturalHeight = 0
        onerror?: () => void
        set src(_value: string) {
          this.onerror?.()
        }
      }
    )

    act(() => {
      useStoryboardSessionStore.getState().save({
        stage: 'compose',
        story: 'A neon city at dusk.',
        settings: {
          style: '电影感',
          aspect: '16:9',
          qualityPreset: 'sd',
          variantCount: 1,
          template: 'board',
          consistency: 'lockedCharacter',
        },
        videoSettings: {
          ratio: '16:9',
          resolution: '1080p',
          duration: 8,
          fps: 30,
          camera: '自动',
          motion: 55,
          generateAudio: true,
        },
        shots: [],
        promptTabs: [],
        activePromptTabId: '',
        storyboardStatus: 'idle',
        storyboardAsset: undefined,
        storyboardVersions: [],
        activeStoryboardVersionId: '',
        referenceAssets: [{ ...REFERENCE_ASSET }],
        // Reference is applied to the current (pre-optimize) story.
        referenceStories: { 'old-motorcycle-ref': 'A neon city at dusk.' },
        selectedVideoModelKey: '',
        videoAsset: undefined,
      } as any)
      useStoryboardSessionStore.getState().setMediaMode('storyboard')
    })

    renderComponent()

    await waitFor(() => expect(h.listAssets).toHaveBeenCalled())
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Optimize prompt' }))
      await Promise.resolve()
    })
    await waitFor(() => expect(h.breakdownStoryboard).toHaveBeenCalled())

    clickGenerateStoryboard()
    await waitFor(() => expect(h.generateImages).toHaveBeenCalled())
    const call = h.generateImages.mock.calls.at(-1)?.[0]
    // The reference survives the optimize refinement and is still used.
    expect(call.mode).toBe('edit')
    expect(call.sourceAssets.map((asset: any) => asset.id)).toEqual([
      'old-motorcycle-ref',
    ])
  })

  it('blocks video generation when the storyboard is stale after a story edit', async () => {
    h.providers = [
      {
        provider: 'jingxing',
        base_url: 'https://api.jingxing.uk/v1',
        settings: [],
        models: [
          {
            id: 'gpt-image-2',
            capabilities: [ModelCapabilities.IMAGE_GENERATION],
          },
          {
            id: 'video-model',
            capabilities: [ModelCapabilities.VIDEO_GENERATION],
          },
        ],
      },
    ]
    vi.stubGlobal(
      'Image',
      class {
        naturalWidth = 0
        naturalHeight = 0
        onerror?: () => void
        set src(_value: string) {
          this.onerror?.()
        }
      }
    )

    const storyboardAsset = {
      id: 'sb-1',
      prompt: 'desert chase storyboard',
      mode: 'generate',
      provider: 'jingxing',
      model: 'gpt-image-2',
      ratio: '16:9',
      size: '1280x720',
      quality: 'standard',
      sourceAssetIds: [],
      createdAt: '2026-06-21T00:00:00Z',
      status: 'succeeded',
      path: '/mock/mita/image-assets/sb-1/image.png',
      fileName: 'image.png',
      mimeType: 'image/png',
      assetKind: 'storyboard',
    }
    act(() => {
      useStoryboardSessionStore.getState().save({
        // Restored straight onto the video step with a storyboard whose plan
        // story no longer matches the current story (stale).
        stage: 'video',
        story: 'A rainy highway ambush at sunset.',
        planStory: 'An old desert chase at noon.',
        settings: {
          style: '电影感',
          aspect: '16:9',
          qualityPreset: 'sd',
          variantCount: 1,
          template: 'board',
          consistency: 'lockedCharacter',
        },
        videoSettings: {
          ratio: '16:9',
          resolution: '1080p',
          duration: 8,
          fps: 30,
          camera: '自动',
          motion: 55,
          generateAudio: true,
        },
        shots: [
          {
            id: 'old-shot',
            title: 'Old',
            camera: 'wide',
            prompt: 'old desert shot',
            duration: 4,
          },
        ],
        promptTabs: [],
        activePromptTabId: '',
        storyboardStatus: 'succeeded',
        storyboardAsset,
        storyboardVersions: [
          {
            id: 'sb-1',
            label: 'Original',
            asset: storyboardAsset,
            kind: 'original',
            createdAt: '2026-06-21T00:00:00Z',
          },
        ],
        activeStoryboardVersionId: 'sb-1',
        referenceAssets: [],
        selectedVideoModelKey: '',
        videoAsset: undefined,
      } as any)
      useStoryboardSessionStore.getState().setMediaMode('storyboard')
    })

    renderComponent()

    await waitFor(() => expect(h.listAssets).toHaveBeenCalled())
    // The stale storyboard cannot be turned into a video for the new story.
    expect(
      screen.getByTestId('storyboard-video-stale-notice')
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Generate video' })
    ).toBeDisabled()
    // And the stepper's video step (numbered "3 Video") is locked too.
    expect(
      screen.getByRole('button', { name: /^\d+\s*Video$/ })
    ).toBeDisabled()
  })

  it('disables the storyboard-page "Next" button into video when the plan is stale', async () => {
    h.providers = [
      {
        provider: 'jingxing',
        base_url: 'https://api.jingxing.uk/v1',
        settings: [],
        models: [
          {
            id: 'gpt-image-2',
            capabilities: [ModelCapabilities.IMAGE_GENERATION],
          },
          {
            id: 'video-model',
            capabilities: [ModelCapabilities.VIDEO_GENERATION],
          },
        ],
      },
    ]
    vi.stubGlobal(
      'Image',
      class {
        naturalWidth = 0
        naturalHeight = 0
        onerror?: () => void
        set src(_value: string) {
          this.onerror?.()
        }
      }
    )

    const storyboardAsset = {
      id: 'sb-1',
      prompt: 'desert chase storyboard',
      mode: 'generate',
      provider: 'jingxing',
      model: 'gpt-image-2',
      ratio: '16:9',
      size: '1280x720',
      quality: 'standard',
      sourceAssetIds: [],
      createdAt: '2026-06-21T00:00:00Z',
      status: 'succeeded',
      path: '/mock/mita/image-assets/sb-1/image.png',
      fileName: 'image.png',
      mimeType: 'image/png',
      assetKind: 'storyboard',
    }
    act(() => {
      useStoryboardSessionStore.getState().save({
        // On the storyboard page, but the story has moved on from the image.
        stage: 'storyboard',
        story: 'A rainy highway ambush at sunset.',
        planStory: 'An old desert chase at noon.',
        settings: {
          style: '电影感',
          aspect: '16:9',
          qualityPreset: 'sd',
          variantCount: 1,
          template: 'board',
          consistency: 'lockedCharacter',
        },
        videoSettings: {
          ratio: '16:9',
          resolution: '1080p',
          duration: 8,
          fps: 30,
          camera: '自动',
          motion: 55,
          generateAudio: true,
        },
        shots: [
          {
            id: 'old-shot',
            title: 'Old',
            camera: 'wide',
            prompt: 'old desert shot',
            duration: 4,
          },
        ],
        promptTabs: [],
        activePromptTabId: '',
        storyboardStatus: 'succeeded',
        storyboardAsset,
        storyboardVersions: [
          {
            id: 'sb-1',
            label: 'Original',
            asset: storyboardAsset,
            kind: 'original',
            createdAt: '2026-06-21T00:00:00Z',
          },
        ],
        activeStoryboardVersionId: 'sb-1',
        referenceAssets: [],
        selectedVideoModelKey: '',
        videoAsset: undefined,
      } as any)
      useStoryboardSessionStore.getState().setMediaMode('storyboard')
    })

    renderComponent()

    await waitFor(() => expect(h.listAssets).toHaveBeenCalled())
    // The sidebar "Next" into the video step is locked, consistent with the
    // stepper, so a stale storyboard can't sneak into video generation.
    expect(
      screen.getByTestId('storyboard-stage-stale-notice')
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Next · generate video/ })
    ).toBeDisabled()
  })

  it('appends the shot-count contract to optimized non-plain storyboard prompts', async () => {
    h.providers = [
      {
        provider: 'jingxing',
        base_url: 'https://api.jingxing.uk/v1',
        settings: [],
        models: [
          {
            id: 'gpt-5-mini',
            capabilities: [ModelCapabilities.COMPLETION],
          },
          {
            id: 'gpt-image-2',
            capabilities: [ModelCapabilities.IMAGE_GENERATION],
          },
        ],
      },
    ]
    h.generateImages.mockResolvedValueOnce([
      {
        b64Json: 'aGVsbG8=',
        mimeType: 'image/png',
        revisedPrompt: 'storyboard',
      },
    ])
    h.saveAsset.mockImplementation((request: any) =>
      Promise.resolve({
        ...request,
        createdAt: '2026-06-04T00:00:00Z',
        path: `/mock/mita/image-assets/${request.id}/image.png`,
        fileName: 'image.png',
      })
    )
    h.breakdownStoryboard.mockResolvedValue({
      shots: [
        {
          title: 'Wake',
          camera: 'Slow push in',
          prompt: 'A gold robot wakes in a neon city.',
          duration: 5,
        },
        {
          title: 'Cross',
          camera: 'Tracking shot',
          prompt: 'The gold robot crosses a glowing corridor.',
          duration: 5,
        },
      ],
      storyboardPrompt: 'LLM cinematic storyboard prompt.',
    })
    vi.stubGlobal(
      'Image',
      class {
        naturalWidth = 0
        naturalHeight = 0
        onerror?: () => void
        set src(_value: string) {
          this.onerror?.()
        }
      }
    )

    renderComponent()

    await waitFor(() => expect(h.listAssets).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Storyboard video' }))
    fireEvent.click(screen.getByRole('button', { name: 'Optimize prompt' }))

    await waitFor(() =>
      expect(h.breakdownStoryboard).toHaveBeenCalledWith(
        expect.objectContaining({
          shotCount: 6,
          template: 'board',
        })
      )
    )
    expect(
      await screen.findByDisplayValue('LLM cinematic storyboard prompt.')
    ).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: 'Generate storyboard image' })
    )

    await waitFor(() => expect(h.generateImages).toHaveBeenCalled())
    const prompt = h.generateImages.mock.calls.at(-1)?.[0].prompt
    expect(prompt).toContain('LLM cinematic storyboard prompt.')
    expect(prompt).toContain('\n\n分镜数量硬性要求')
    expect(prompt).toContain('分镜清单：')
    expect(prompt).toContain('1. Wake: Slow push in.')
    expect(prompt).toContain('6. 镜头 6')
    expect(prompt.match(/exactly 6 storyboard panels/g)).toHaveLength(1)
  })

  it('downloads a generated storyboard without navigating away from the app', async () => {
    h.providers = [
      {
        provider: 'jingxing',
        base_url: 'https://api.jingxing.uk/v1',
        settings: [],
        models: [
          {
            id: 'gpt-image-2',
            capabilities: [ModelCapabilities.IMAGE_GENERATION],
          },
        ],
      },
    ]
    h.generateImages.mockResolvedValueOnce([
      {
        b64Json: 'aGVsbG8=',
        mimeType: 'image/png',
        revisedPrompt: 'storyboard',
      },
    ])
    h.saveAsset.mockImplementation((request: any) =>
      Promise.resolve({
        ...request,
        createdAt: '2026-06-04T00:00:00Z',
        path: `/mock/mita/image-assets/${request.id}/image.png`,
        fileName: 'storyboard.png',
      })
    )
    h.dialogSave.mockResolvedValue('/Users/test/Downloads/storyboard.png')
    vi.stubGlobal(
      'Image',
      class {
        naturalWidth = 0
        naturalHeight = 0
        onerror?: () => void
        set src(_value: string) {
          this.onerror?.()
        }
      }
    )

    renderComponent()

    await waitFor(() => expect(h.listAssets).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Storyboard video' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Generate storyboard image' })
    )

    expect(await screen.findByText('Storyboard ready')).toBeInTheDocument()
    const anchorClick = vi.fn()
    const createElement = document.createElement.bind(document)
    const createElementSpy = vi
      .spyOn(document, 'createElement')
      .mockImplementation((tagName: string, options?: ElementCreationOptions) => {
        const element = createElement(tagName, options)
        if (tagName.toLowerCase() === 'a') {
          Object.defineProperty(element, 'click', {
            configurable: true,
            value: anchorClick,
          })
        }
        return element
      })

    try {
      fireEvent.click(screen.getByRole('button', { name: 'Download storyboard' }))

      await waitFor(() =>
        expect(h.dialogSave).toHaveBeenCalledWith({
          fileName: 'storyboard.png',
          filters: [{ name: 'PNG', extensions: ['png'] }],
        })
      )
      expect(h.copyFile).toHaveBeenCalledWith(
        expect.stringContaining('/mock/mita/image-assets/'),
        '/Users/test/Downloads/storyboard.png'
      )
      expect(h.toast.success).toHaveBeenCalledWith('Download complete', {
        description: 'storyboard.png saved',
      })
      expect(anchorClick).not.toHaveBeenCalled()
    } finally {
      createElementSpy.mockRestore()
    }
  })

  it('falls back to browser download for remote storyboard image URLs', async () => {
    h.providers = [
      {
        provider: 'jingxing',
        base_url: 'https://api.jingxing.uk/v1',
        settings: [],
        models: [
          {
            id: 'gpt-image-2',
            capabilities: [ModelCapabilities.IMAGE_GENERATION],
          },
        ],
      },
    ]
    h.generateImages.mockResolvedValueOnce([
      {
        mimeType: 'image/png',
        b64Json: 'aGVsbG8=',
        revisedPrompt: 'remote storyboard',
      },
    ])
    h.saveAsset.mockImplementation((request: any) =>
      Promise.resolve({
        ...request,
        createdAt: '2026-06-04T00:00:00Z',
        path: 'https://cdn.example.com/storyboard.png',
        fileName: 'storyboard.png',
      })
    )
    vi.stubGlobal(
      'Image',
      class {
        naturalWidth = 1536
        naturalHeight = 864
        onload?: () => void
        set src(_value: string) {
          this.onload?.()
        }
      }
    )
    const anchorClick = vi.fn()
    const createElement = document.createElement.bind(document)
    const createElementSpy = vi
      .spyOn(document, 'createElement')
      .mockImplementation((tagName: string, options?: ElementCreationOptions) => {
        const element = createElement(tagName, options)
        if (tagName.toLowerCase() === 'a') {
          Object.defineProperty(element, 'click', {
            configurable: true,
            value: anchorClick,
          })
        }
        return element
      })

    try {
      renderComponent()
      await waitFor(() => expect(h.listAssets).toHaveBeenCalled())
      fireEvent.click(screen.getByRole('button', { name: 'Storyboard video' }))
      fireEvent.click(
        screen.getByRole('button', { name: 'Generate storyboard image' })
      )

      expect(await screen.findByText('Storyboard ready')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Download storyboard' }))

      await waitFor(() => expect(anchorClick).toHaveBeenCalled())
      expect(h.dialogSave).not.toHaveBeenCalled()
      expect(h.copyFile).not.toHaveBeenCalled()
    } finally {
      createElementSpy.mockRestore()
    }
  })

  it('generates a storyboard video from the storyboard image', async () => {
    h.providers = [
      {
        provider: 'jingxing',
        base_url: 'https://api.jingxing.uk/v1',
        settings: [],
        models: [
          {
            id: 'gpt-image-2',
            capabilities: [ModelCapabilities.IMAGE_GENERATION],
          },
          {
            id: 'seedance-2.0',
            capabilities: [ModelCapabilities.VIDEO_GENERATION],
          },
        ],
      },
    ]
    h.generateImages.mockResolvedValueOnce([
      {
        b64Json: 'aGVsbG8=',
        mimeType: 'image/png',
        revisedPrompt: 'storyboard',
      },
    ])
    h.saveAsset.mockImplementation((request: any) =>
      Promise.resolve({
        ...request,
        createdAt: '2026-06-04T00:00:00Z',
        path: `/mock/mita/image-assets/${request.id}/image.png`,
        fileName: 'image.png',
      })
    )
    h.generateVideo.mockResolvedValueOnce({
      id: 'video-task-1',
      status: 'queued',
      progress: 0,
    })
    h.pollVideoTask.mockResolvedValueOnce({
      id: 'video-task-1',
      status: 'succeeded',
      progress: 100,
      videoUrl: 'https://cdn.example.test/video.mp4',
      usage: { total_tokens: 15000 },
    })
    h.saveVideoAsset.mockImplementation((request: any) =>
      Promise.resolve({
        ...request,
        createdAt: '2026-06-04T00:01:00Z',
        path: '/mock/mita/video-assets/video-asset-1/video.mp4',
        fileName: 'video.mp4',
      })
    )
    vi.stubGlobal(
      'Image',
      class {
        naturalWidth = 0
        naturalHeight = 0
        onerror?: () => void
        set src(_value: string) {
          this.onerror?.()
        }
      }
    )

    renderComponent()

    await waitFor(() => expect(h.listAssets).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Storyboard video' }))
    fireEvent.change(
      screen.getByPlaceholderText(
        'Describe the single video you want in one sentence.'
      ),
      {
        target: {
          value:
            'A gold robot wakes in a neon city, crosses a corridor, and reaches a rooftop.',
        },
      }
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Generate storyboard image' })
    )

    expect(await screen.findByText('Storyboard ready')).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: /Next .* generate video/ })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Generate video' }))

    await waitFor(() => expect(h.generateVideo).toHaveBeenCalledTimes(1))
    expect(h.generateVideo.mock.calls[0][0]).toMatchObject({
      model: expect.objectContaining({ id: 'seedance-2.0' }),
      sourceAsset: expect.objectContaining({
        path: expect.stringContaining('/mock/mita/image-assets/'),
      }),
      ratio: '16:9',
      resolution: '1080p',
      fps: 30,
    })
    await waitFor(() => expect(h.pollVideoTask).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'video-task-1',
        model: expect.objectContaining({ id: 'seedance-2.0' }),
      })
    ))
    await waitFor(() => expect(h.saveVideoAsset).toHaveBeenCalledTimes(1))
    expect(h.saveVideoAsset.mock.calls[0][0]).toMatchObject({
      provider: 'jingxing',
      model: 'seedance-2.0',
      sourceAssetIds: [expect.any(String)],
      usage: { total_tokens: 15000 },
      videoUrl: 'https://cdn.example.test/video.mp4',
      status: 'succeeded',
      assetKind: 'storyboard',
    })
    expect(
      await screen.findByText(/Rendered .* 8s .* 1080p/)
    ).toBeInTheDocument()
    expect(screen.getByText('15,000 tokens')).toBeInTheDocument()
    expect(screen.getByText('Download video')).toBeInTheDocument()
  })

  it('reports storyboard video tasks that finish without a video URL', async () => {
    h.providers = [
      {
        provider: 'jingxing',
        base_url: 'https://api.jingxing.uk/v1',
        settings: [],
        models: [
          {
            id: 'gpt-image-2',
            capabilities: [ModelCapabilities.IMAGE_GENERATION],
          },
          {
            id: 'seedance-2.0',
            capabilities: [ModelCapabilities.VIDEO_GENERATION],
          },
        ],
      },
    ]
    h.generateImages.mockResolvedValueOnce([
      {
        b64Json: 'aGVsbG8=',
        mimeType: 'image/png',
        revisedPrompt: 'storyboard',
      },
    ])
    h.saveAsset.mockImplementation((request: any) =>
      Promise.resolve({
        ...request,
        createdAt: '2026-06-04T00:00:00Z',
        path: `/mock/mita/image-assets/${request.id}/image.png`,
        fileName: 'image.png',
      })
    )
    h.generateVideo.mockResolvedValueOnce({
      id: 'video-task-1',
      status: 'succeeded',
      progress: 100,
    })
    vi.stubGlobal(
      'Image',
      class {
        naturalWidth = 0
        naturalHeight = 0
        onerror?: () => void
        set src(_value: string) {
          this.onerror?.()
        }
      }
    )

    renderComponent()

    await waitFor(() => expect(h.listAssets).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Storyboard video' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Generate storyboard image' })
    )

    expect(await screen.findByText('Storyboard ready')).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: /Next .* generate video/ })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Generate video' }))

    await waitFor(() =>
      expect(h.toast.error).toHaveBeenCalledWith(
        'Video generation finished without a playable video URL'
      )
    )
    expect(h.saveVideoAsset).not.toHaveBeenCalled()
  })

  it('restores the storyboard editing session after leaving and returning', async () => {
    h.providers = [
      {
        provider: 'jingxing',
        base_url: 'https://api.jingxing.uk/v1',
        settings: [],
        models: [
          {
            id: 'gpt-image-2',
            capabilities: [ModelCapabilities.IMAGE_GENERATION],
          },
        ],
      },
    ]
    h.generateImages.mockResolvedValueOnce([
      {
        b64Json: 'aGVsbG8=',
        mimeType: 'image/png',
        revisedPrompt: 'storyboard',
      },
    ])
    h.saveAsset.mockImplementation((request: any) =>
      Promise.resolve({
        ...request,
        createdAt: '2026-06-04T00:00:00Z',
        path: `/mock/mita/image-assets/${request.id}/image.png`,
        fileName: 'image.png',
      })
    )
    vi.stubGlobal(
      'Image',
      class {
        naturalWidth = 0
        naturalHeight = 0
        onerror?: () => void
        set src(_value: string) {
          this.onerror?.()
        }
      }
    )

    let firstRender: ReturnType<typeof render> | undefined
    await act(async () => {
      firstRender = renderComponent()
    })
    await waitFor(() => expect(h.listAssets).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Storyboard video' }))
    fireEvent.change(
      screen.getByPlaceholderText(
        'Describe the single video you want in one sentence.'
      ),
      { target: { value: 'A robot story worth remembering.' } }
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Generate storyboard image' })
    )
    expect(await screen.findByText('Storyboard ready')).toBeInTheDocument()

    const generateCallsBefore = h.generateImages.mock.calls.length

    // Leave the view entirely (unmount), then return with a fresh mount.
    await act(async () => {
      firstRender?.unmount()
    })
    await act(async () => {
      renderComponent()
    })
    await waitFor(() => expect(h.listAssets).toHaveBeenCalled())

    // Lands back in storyboard mode (no re-click) with the storyboard image and
    // its version restored, and no re-generation.
    expect(await screen.findByText('Storyboard ready')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Original' })).toBeInTheDocument()
    expect(h.generateImages.mock.calls.length).toBe(generateCallsBefore)
  })

  it('drops a finished video when its file fails to load (deleted asset)', async () => {
    h.providers = [
      {
        provider: 'jingxing',
        base_url: 'https://api.jingxing.uk/v1',
        settings: [],
        models: [
          {
            id: 'gpt-image-2',
            capabilities: [ModelCapabilities.IMAGE_GENERATION],
          },
          {
            id: 'seedance-2.0',
            capabilities: [ModelCapabilities.VIDEO_GENERATION],
          },
        ],
      },
    ]
    h.generateImages.mockResolvedValueOnce([
      { b64Json: 'aGVsbG8=', mimeType: 'image/png', revisedPrompt: 'storyboard' },
    ])
    h.saveAsset.mockImplementation((request: any) =>
      Promise.resolve({
        ...request,
        createdAt: '2026-06-04T00:00:00Z',
        path: `/mock/mita/image-assets/${request.id}/image.png`,
        fileName: 'image.png',
      })
    )
    h.generateVideo.mockResolvedValueOnce({
      id: 'video-task-1',
      status: 'queued',
      progress: 0,
    })
    h.pollVideoTask.mockResolvedValueOnce({
      id: 'video-task-1',
      status: 'succeeded',
      progress: 100,
      videoUrl: 'https://cdn.example.test/video.mp4',
      usage: { total_tokens: 15000 },
    })
    h.saveVideoAsset.mockImplementation((request: any) =>
      Promise.resolve({
        ...request,
        createdAt: '2026-06-04T00:01:00Z',
        path: '/mock/mita/video-assets/video-asset-1/video.mp4',
        fileName: 'video.mp4',
      })
    )
    vi.stubGlobal(
      'Image',
      class {
        naturalWidth = 0
        naturalHeight = 0
        onerror?: () => void
        set src(_value: string) {
          this.onerror?.()
        }
      }
    )

    renderComponent()
    await waitFor(() => expect(h.listAssets).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Storyboard video' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Generate storyboard image' })
    )
    expect(await screen.findByText('Storyboard ready')).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: /Next .* generate video/ })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Generate video' }))
    expect(await screen.findByText('Download video')).toBeInTheDocument()

    // The video file is gone (e.g. deleted from media history) -> load error.
    const video = document.querySelector('video') as HTMLVideoElement
    await act(async () => {
      fireEvent.error(video)
    })

    await waitFor(() =>
      expect(screen.queryByText('Download video')).not.toBeInTheDocument()
    )
    expect(document.querySelector('video')).not.toBeInTheDocument()
  })

  it('resets the storyboard when its image fails to load (deleted asset)', async () => {
    h.providers = [
      {
        provider: 'jingxing',
        base_url: 'https://api.jingxing.uk/v1',
        settings: [],
        models: [
          {
            id: 'gpt-image-2',
            capabilities: [ModelCapabilities.IMAGE_GENERATION],
          },
        ],
      },
    ]
    h.generateImages.mockResolvedValueOnce([
      { b64Json: 'aGVsbG8=', mimeType: 'image/png', revisedPrompt: 'storyboard' },
    ])
    h.saveAsset.mockImplementation((request: any) =>
      Promise.resolve({
        ...request,
        createdAt: '2026-06-04T00:00:00Z',
        path: `/mock/mita/image-assets/${request.id}/image.png`,
        fileName: 'image.png',
      })
    )
    vi.stubGlobal(
      'Image',
      class {
        naturalWidth = 0
        naturalHeight = 0
        onerror?: () => void
        set src(_value: string) {
          this.onerror?.()
        }
      }
    )

    renderComponent()
    await waitFor(() => expect(h.listAssets).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Storyboard video' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Generate storyboard image' })
    )
    expect(await screen.findByText('Storyboard ready')).toBeInTheDocument()

    // The storyboard image file is gone -> load error resets to compose.
    const storyboardImage = document.querySelector(
      'img.object-contain'
    ) as HTMLImageElement
    await act(async () => {
      fireEvent.error(storyboardImage)
    })

    await waitFor(() =>
      expect(screen.queryByText('Storyboard ready')).not.toBeInTheDocument()
    )
  })

  it('falls back to a surviving version when the active storyboard image fails', async () => {
    h.providers = [
      {
        provider: 'jingxing',
        base_url: 'https://api.jingxing.uk/v1',
        settings: [],
        models: [
          {
            id: 'gpt-image-2',
            capabilities: [ModelCapabilities.IMAGE_GENERATION],
          },
        ],
      },
    ]
    const original: any = {
      id: 'img-original',
      prompt: 'orig',
      mode: 'generate',
      provider: 'jingxing',
      model: 'gpt-image-2',
      ratio: '16:9',
      size: '',
      quality: 'sd',
      sourceAssetIds: [],
      createdAt: '2026-06-01T00:00:00Z',
      status: 'succeeded',
      path: '/mock/mita/image-assets/img-original/image.png',
      fileName: 'image.png',
      mimeType: 'image/png',
      assetKind: 'storyboard',
    }
    const edited: any = {
      ...original,
      id: 'img-edited',
      prompt: 'edited',
      path: '/mock/mita/image-assets/img-edited/image.png',
    }
    useStoryboardSessionStore.getState().save({
      stage: 'storyboard',
      story: 'a tale',
      settings: {
        style: 'cinematic',
        aspect: '16:9',
        qualityPreset: 'sd',
        variantCount: 1,
        template: 'plain',
        consistency: 'standard',
      },
      videoSettings: {
        ratio: '16:9',
        resolution: '1080p',
        duration: 8,
        fps: 30,
        camera: 'auto',
        motion: 55,
        generateAudio: true,
      },
      shots: [],
      promptTabs: [],
      activePromptTabId: '',
      storyboardStatus: 'succeeded',
      storyboardAsset: original,
      storyboardVersions: [
        {
          id: 'v-original',
          label: 'Original',
          kind: 'original',
          createdAt: '2026-06-01T00:00:00Z',
          asset: original,
        },
        {
          id: 'v-edited',
          label: 'Edit 1',
          kind: 'edited',
          createdAt: '2026-06-01T00:01:00Z',
          asset: edited,
        },
      ],
      activeStoryboardVersionId: 'v-original',
      referenceAssets: [],
      selectedVideoModelKey: '',
      videoAsset: undefined,
    } as any)
    useStoryboardSessionStore.getState().setMediaMode('storyboard')

    renderComponent()
    await waitFor(() => expect(h.listAssets).toHaveBeenCalled())
    expect(await screen.findByText('Storyboard ready')).toBeInTheDocument()

    // The active (Original) image file is gone -> load error.
    const img = document.querySelector('img.object-contain') as HTMLImageElement
    await act(async () => {
      fireEvent.error(img)
    })

    // Stays in storyboard (not reset to compose) and falls back to the Edited
    // version; only the deleted Original version is dropped.
    expect(screen.getByText('Storyboard ready')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit 1' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Original' })
    ).not.toBeInTheDocument()
  })

  it('lets storyboard mode switch image models, layout, consistency, and references', async () => {
    h.providers = [
      {
        provider: 'jingxing',
        base_url: 'https://api.jingxing.uk/v1',
        settings: [],
        models: [
          {
            id: 'gpt-image-1.5',
            capabilities: [ModelCapabilities.IMAGE_GENERATION],
          },
          {
            id: 'gpt-image-2',
            capabilities: [
              ModelCapabilities.IMAGE_GENERATION,
              ModelCapabilities.IMAGE_TO_IMAGE,
            ],
          },
        ],
      },
    ]
    const referenceAsset = {
      id: 'story-ref-1',
      prompt: 'hero',
      mode: 'edit',
      provider: 'local',
      model: 'reference-image',
      ratio: '1:1',
      size: 'original',
      quality: 'source',
      sourceAssetIds: [],
      createdAt: '2026-06-06T00:00:00Z',
      status: 'succeeded',
      path: '/mock/mita/image-assets/story-ref-1/image.png',
      fileName: 'image.png',
      mimeType: 'image/png',
      assetKind: 'reference',
    }
    h.dialogOpen.mockResolvedValue(['/Users/eric/Desktop/hero.png'])
    h.importAsset.mockResolvedValue(referenceAsset)

    renderComponent()

    await waitFor(() => expect(h.listAssets).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Storyboard video' }))

    expect(
      screen.getByRole('button', { name: 'Image model' })
    ).toHaveTextContent('gpt-image-1.5')
    fireEvent.click(screen.getByRole('button', { name: 'Image model' }))
    fireEvent.click(await screen.findByRole('button', { name: 'gpt-image-2' }))
    expect(
      screen.getByRole('button', { name: 'Image model' })
    ).toHaveTextContent('gpt-image-2')

    expect(screen.getByText('Storyboard layout')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Plain image/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Shot table/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Strong' }))

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Add reference image' })
      )
      await Promise.resolve()
    })

    await waitFor(() => expect(h.importAsset).toHaveBeenCalled())
    expect(await screen.findByAltText('hero')).toBeInTheDocument()
  })

  it('submits plain prompt requests as generate tasks', async () => {
    h.providers = [
      {
        provider: 'jingxing',
        base_url: 'https://api.jingxing.uk/v1',
        settings: [],
        models: [
          {
            id: 'gpt-image-1.5',
            capabilities: [ModelCapabilities.IMAGE_GENERATION],
          },
        ],
      },
    ]

    renderComponent()

    await waitFor(() => expect(h.listAssets).toHaveBeenCalled())
    const promptInput = screen.getByPlaceholderText(/Upload a reference image/)
    fireEvent.change(promptInput, { target: { value: 'moon desk' } })
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))

    await waitFor(() => expect(h.generateImages).toHaveBeenCalled())
    expect(h.generateImages.mock.calls.at(-1)?.[0]).toMatchObject({
      mode: 'generate',
      prompt: 'moon desk',
      sourceAssets: [],
    })
    expect(promptInput).toHaveValue('')
  })

  it('opens an image asset from history search params', async () => {
    h.providers = [
      {
        provider: 'jingxing',
        base_url: 'https://api.jingxing.uk/v1',
        settings: [],
        models: [
          {
            id: 'gpt-image-2',
            capabilities: [ModelCapabilities.IMAGE_GENERATION],
          },
        ],
      },
    ]
    h.search = { media: 'image', assetId: 'asset-1' }
    h.listAssets.mockResolvedValue([
      {
        id: 'asset-1',
        prompt: 'moon desk',
        mode: 'generate',
        provider: 'jingxing',
        model: 'gpt-image-2',
        ratio: '1:1',
        size: '1024x1024',
        quality: 'high',
        sourceAssetIds: [],
        createdAt: '2026-05-11T00:00:00Z',
        status: 'succeeded',
        path: '/tmp/asset.png',
        fileName: 'image.png',
        mimeType: 'image/png',
      },
    ])

    renderComponent()

    expect(await screen.findByText('Image preview')).toBeInTheDocument()
    expect(screen.getAllByAltText('moon desk').at(-1)).toHaveAttribute(
      'src',
      'asset:///tmp/asset.png'
    )
  })

  it('does not reopen a closed history image preview after storyboard assets are saved', async () => {
    h.providers = [
      {
        provider: 'jingxing',
        base_url: 'https://api.jingxing.uk/v1',
        settings: [],
        models: [
          {
            id: 'gpt-image-2',
            capabilities: [ModelCapabilities.IMAGE_GENERATION],
          },
          {
            id: 'seedance-2.0',
            capabilities: [ModelCapabilities.VIDEO_GENERATION],
          },
        ],
      },
    ]
    h.search = { media: 'image', assetId: 'asset-1' }
    h.listAssets.mockResolvedValue([
      {
        id: 'asset-1',
        prompt: 'stale rain courier storyboard',
        mode: 'generate',
        provider: 'jingxing',
        model: 'gpt-image-2',
        ratio: '16:9',
        size: '1024x576',
        quality: 'high',
        sourceAssetIds: [],
        createdAt: '2026-05-11T00:00:00Z',
        status: 'succeeded',
        path: '/tmp/stale-storyboard.png',
        fileName: 'image.png',
        mimeType: 'image/png',
        assetKind: 'storyboard',
      },
    ])
    h.generateImages.mockResolvedValueOnce([
      {
        b64Json: 'aGVsbG8=',
        mimeType: 'image/png',
        revisedPrompt: 'fresh storyboard',
      },
    ])
    h.saveAsset.mockImplementation((request: any) =>
      Promise.resolve({
        ...request,
        createdAt: '2026-06-04T00:00:00Z',
        path: `/mock/mita/image-assets/${request.id}/image.png`,
        fileName: 'image.png',
      })
    )
    vi.stubGlobal(
      'Image',
      class {
        naturalWidth = 1536
        naturalHeight = 864
        onload?: () => void
        set src(_value: string) {
          this.onload?.()
        }
      }
    )

    renderComponent()

    expect(await screen.findByText('Image preview')).toBeInTheDocument()
    expect(screen.getAllByAltText('stale rain courier storyboard').at(-1))
      .toHaveAttribute('src', 'asset:///tmp/stale-storyboard.png')

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() =>
      expect(screen.queryByText('Image preview')).not.toBeInTheDocument()
    )
    expect(h.navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '/images',
        replace: true,
      })
    )

    fireEvent.click(screen.getByRole('button', { name: 'Storyboard video' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Generate storyboard image' })
    )

    await waitFor(() => expect(h.saveAsset).toHaveBeenCalled())
    expect(await screen.findByText('Storyboard ready')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByText('Image preview')).not.toBeInTheDocument()
    )
  })

  it('opens a storyboard video asset from history search params', async () => {
    h.providers = [
      {
        provider: 'jingxing',
        base_url: 'https://api.jingxing.uk/v1',
        settings: [],
        models: [
          {
            id: 'gpt-image-2',
            capabilities: [ModelCapabilities.IMAGE_GENERATION],
          },
        ],
      },
    ]
    h.search = { media: 'storyboard', videoId: 'video-asset-1' }
    h.listVideoAssets.mockResolvedValue([
      {
        id: 'video-asset-1',
        prompt: 'robot film',
        provider: 'jingxing',
        model: 'seedance-2.0',
        ratio: '16:9',
        resolution: '1080p',
        duration: 8,
        fps: 30,
        sourceAssetIds: ['storyboard-1'],
        createdAt: '2026-06-04T00:00:00Z',
        status: 'succeeded',
        path: '/tmp/video.mp4',
        fileName: 'video.mp4',
        mimeType: 'video/mp4',
        assetKind: 'storyboard',
      },
    ])

    renderComponent()

    expect(await screen.findByText('robot film')).toBeInTheDocument()
    expect(document.querySelector('video')).toHaveAttribute(
      'src',
      'asset:///tmp/video.mp4'
    )
  })

  it('downloads a storyboard video opened from history search params', async () => {
    h.providers = [
      {
        provider: 'jingxing',
        base_url: 'https://api.jingxing.uk/v1',
        settings: [],
        models: [
          {
            id: 'gpt-image-2',
            capabilities: [ModelCapabilities.IMAGE_GENERATION],
          },
        ],
      },
    ]
    h.search = { media: 'storyboard', videoId: 'video-asset-1' }
    h.listVideoAssets.mockResolvedValue([
      {
        id: 'video-asset-1',
        prompt: 'robot film',
        provider: 'jingxing',
        model: 'seedance-2.0',
        ratio: '16:9',
        resolution: '1080p',
        duration: 8,
        fps: 30,
        sourceAssetIds: ['storyboard-1'],
        createdAt: '2026-06-04T00:00:00Z',
        status: 'succeeded',
        path: '/tmp/video.mp4',
        fileName: 'video.mp4',
        mimeType: 'video/mp4',
        assetKind: 'storyboard',
      },
    ])
    h.dialogSave.mockResolvedValue('/Users/test/Downloads/video.mp4')

    renderComponent()

    expect(await screen.findByText('robot film')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Download video' }))

    await waitFor(() =>
      expect(h.dialogSave).toHaveBeenCalledWith({
        fileName: 'video.mp4',
        filters: [{ name: 'MP4', extensions: ['mp4'] }],
      })
    )
    expect(h.copyFile).toHaveBeenCalledWith(
      '/tmp/video.mp4',
      '/Users/test/Downloads/video.mp4'
    )
    expect(h.toast.success).toHaveBeenCalledWith('Download complete', {
      description: 'video.mp4 saved',
    })
  })

  it('shows recharge actions when image generation quota is exhausted', async () => {
    h.providers = [
      {
        provider: 'jingxing',
        base_url: 'https://api.jingxing.uk/v1',
        settings: [],
        models: [
          {
            id: 'gpt-image-2',
            capabilities: [ModelCapabilities.IMAGE_GENERATION],
          },
        ],
      },
    ]
    h.generateImages.mockRejectedValueOnce(
      new ProviderQuotaError({
        message: '该令牌额度已用尽',
        status: 403,
        code: 'pre_consume_token_quota_failed',
        rechargeUrl: 'https://api.jingxing.uk/console/topup',
        tokenUrl: 'https://api.jingxing.uk/console/token',
        metadata: { quota_error: true },
      })
    )

    renderComponent()

    await waitFor(() => expect(h.listAssets).toHaveBeenCalled())
    fireEvent.change(screen.getByPlaceholderText(/Upload a reference image/), {
      target: { value: 'a tiny moon desk' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))

    expect(await screen.findByText('该令牌额度已用尽')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Recharge' }))
    expect(h.openExternalUrl).toHaveBeenCalledWith(
      'https://api.jingxing.uk/console/topup'
    )
    expect(
      screen.getByRole('button', { name: 'Manage tokens' })
    ).toBeInTheDocument()
  })

  it('shows a readable busy error and retry cooldown for image request failures', async () => {
    h.providers = [
      {
        provider: 'jingxing',
        base_url: 'https://api.jingxing.uk/v1',
        settings: [],
        models: [
          {
            id: 'gpt-image-2',
            capabilities: [ModelCapabilities.IMAGE_GENERATION],
          },
        ],
      },
    ]
    h.generateImages.mockRejectedValueOnce(
      new ImageGenerationRequestError({
        message: 'Too Many Requests',
        status: 429,
        statusText: 'Too Many Requests',
        kind: 'rate_limited',
        retryAfterMs: 5_000,
      })
    )

    renderComponent()

    await waitFor(() => expect(h.listAssets).toHaveBeenCalled())
    fireEvent.change(screen.getByPlaceholderText(/Upload a reference image/), {
      target: { value: 'a tiny moon desk' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))

    expect(
      await screen.findByText('Image service is busy. Please try again later.')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry in 5s' })).toBeDisabled()
  })

  it('uses selected source assets for edit and variation inference', async () => {
    h.providers = [
      {
        provider: 'jingxing',
        base_url: 'https://api.jingxing.uk/v1',
        settings: [],
        models: [
          {
            id: 'gpt-image-2',
            capabilities: [
              ModelCapabilities.IMAGE_GENERATION,
              ModelCapabilities.IMAGE_TO_IMAGE,
            ],
          },
        ],
      },
    ]
    h.listAssets.mockResolvedValue([
      {
        id: 'asset-1',
        prompt: 'moon desk',
        mode: 'generate',
        provider: 'jingxing',
        model: 'gpt-image-2',
        ratio: '1:1',
        size: '1024x1024',
        quality: 'high',
        sourceAssetIds: [],
        createdAt: '2026-05-11T00:00:00Z',
        status: 'succeeded',
        path: '/tmp/asset.png',
        fileName: 'image.png',
        mimeType: 'image/png',
      },
    ])

    renderComponent()

    await screen.findByText('moon desk')
    fireEvent.click(screen.getByRole('button', { name: 'Re-edit' }))
    expect(screen.queryByText('Mask')).not.toBeInTheDocument()
    expect(screen.getAllByText('moon desk').length).toBeGreaterThan(0)

    fireEvent.change(screen.getByPlaceholderText(/Upload a reference image/), {
      target: { value: 'make it glass' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))

    await waitFor(() =>
      expect(h.generateImages.mock.calls.at(-1)?.[0]).toMatchObject({
        mode: 'edit',
        prompt: 'make it glass',
        sourceAssets: [expect.objectContaining({ id: 'asset-1' })],
      })
    )

    h.generateImages.mockClear()
    fireEvent.change(screen.getByPlaceholderText(/Upload a reference image/), {
      target: { value: '' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))

    await waitFor(() =>
      expect(h.generateImages.mock.calls.at(-1)?.[0]).toMatchObject({
        mode: 'variation',
        prompt: 'Create a fresh variation of this image.',
        sourceAssets: [expect.objectContaining({ id: 'asset-1' })],
      })
    )
  })

  it('switches to an edit-capable model when re-editing a saved image', async () => {
    h.providers = [
      {
        provider: 'jingxing',
        base_url: 'https://api.jingxing.uk/v1',
        settings: [],
        models: [
          {
            id: 'gpt-image-1.5',
            capabilities: [ModelCapabilities.IMAGE_GENERATION],
          },
          {
            id: 'gpt-image-2',
            capabilities: [
              ModelCapabilities.IMAGE_GENERATION,
              ModelCapabilities.IMAGE_TO_IMAGE,
            ],
          },
        ],
      },
    ]
    h.listAssets.mockResolvedValue([
      {
        id: 'asset-1',
        prompt: 'moon desk',
        mode: 'generate',
        provider: 'jingxing',
        model: 'gpt-image-1.5',
        ratio: '1:1',
        size: '1024x1024',
        quality: 'high',
        sourceAssetIds: [],
        createdAt: '2026-05-11T00:00:00Z',
        status: 'succeeded',
        path: '/tmp/asset.png',
        fileName: 'image.png',
        mimeType: 'image/png',
      },
    ])

    renderComponent()

    await screen.findByText('moon desk')
    expect(
      screen.getByRole('button', { name: 'Image model' })
    ).toHaveTextContent('gpt-image-1.5')

    fireEvent.click(screen.getByRole('button', { name: 'Re-edit' }))

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Image model' })
      ).toHaveTextContent('gpt-image-2')
    )
    expect(
      screen.getByRole('button', { name: 'Remove moon desk' })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear source' })).toBeInTheDocument()
  })

  it('keeps the composer unchanged when re-edit has no edit-capable model', async () => {
    h.providers = [
      {
        provider: 'jingxing',
        base_url: 'https://api.jingxing.uk/v1',
        settings: [],
        models: [
          {
            id: 'gpt-image-1.5',
            capabilities: [ModelCapabilities.IMAGE_GENERATION],
          },
        ],
      },
    ]
    h.listAssets.mockResolvedValue([
      {
        id: 'asset-1',
        prompt: 'moon desk',
        mode: 'generate',
        provider: 'jingxing',
        model: 'gpt-image-1.5',
        ratio: '1:1',
        size: '1024x1024',
        quality: 'high',
        sourceAssetIds: [],
        createdAt: '2026-05-11T00:00:00Z',
        status: 'succeeded',
        path: '/tmp/asset.png',
        fileName: 'image.png',
        mimeType: 'image/png',
      },
    ])

    renderComponent()

    await screen.findByText('moon desk')
    fireEvent.click(screen.getByRole('button', { name: 'Re-edit' }))

    expect(h.toast.error).toHaveBeenCalledWith(
      'Select an image model that supports source images'
    )
    expect(
      screen.queryByRole('button', { name: 'Remove moon desk' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Clear source' })
    ).not.toBeInTheDocument()
  })

  it('clears the source asset and restores prompt-required generation', async () => {
    h.providers = [
      {
        provider: 'jingxing',
        base_url: 'https://api.jingxing.uk/v1',
        settings: [],
        models: [
          {
            id: 'gpt-image-2',
            capabilities: [
              ModelCapabilities.IMAGE_GENERATION,
              ModelCapabilities.IMAGE_TO_IMAGE,
            ],
          },
        ],
      },
    ]
    h.listAssets.mockResolvedValue([
      {
        id: 'asset-1',
        prompt: 'moon desk',
        mode: 'generate',
        provider: 'jingxing',
        model: 'gpt-image-2',
        ratio: '1:1',
        size: '1024x1024',
        quality: 'high',
        sourceAssetIds: [],
        createdAt: '2026-05-11T00:00:00Z',
        status: 'succeeded',
        path: '/tmp/asset.png',
        fileName: 'image.png',
        mimeType: 'image/png',
      },
    ])

    renderComponent()

    await screen.findByText('moon desk')
    fireEvent.click(screen.getByRole('button', { name: 'Re-edit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove moon desk' }))
    fireEvent.change(screen.getByPlaceholderText(/Upload a reference image/), {
      target: { value: '' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))

    await waitFor(() => expect(h.generateImages).not.toHaveBeenCalled())
  })

  it('opens saved image preview instead of using the image area as an edit source', async () => {
    h.providers = [
      {
        provider: 'jingxing',
        base_url: 'https://api.jingxing.uk/v1',
        settings: [],
        models: [
          {
            id: 'gpt-image-2',
            capabilities: [
              ModelCapabilities.IMAGE_GENERATION,
              ModelCapabilities.IMAGE_TO_IMAGE,
            ],
          },
        ],
      },
    ]
    h.listAssets.mockResolvedValue([
      {
        id: 'asset-1',
        prompt: 'moon desk',
        mode: 'generate',
        provider: 'jingxing',
        model: 'gpt-image-2',
        ratio: '1:1',
        size: '1024x1024',
        quality: 'high',
        sourceAssetIds: [],
        createdAt: '2026-05-11T00:00:00Z',
        status: 'succeeded',
        path: '/tmp/asset.png',
        fileName: 'image.png',
        mimeType: 'image/png',
      },
    ])

    renderComponent()

    await screen.findByText('moon desk')
    fireEvent.click(screen.getAllByRole('button', { name: 'Preview' }).at(-1)!)

    expect(screen.getByText('Image preview')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Remove moon desk' })
    ).not.toBeInTheDocument()
  })

  it('imports computer images as references without adding them to history', async () => {
    h.providers = [
      {
        provider: 'jingxing',
        base_url: 'https://api.jingxing.uk/v1',
        settings: [],
        models: [
          {
            id: 'gpt-image-2',
            capabilities: [
              ModelCapabilities.IMAGE_GENERATION,
              ModelCapabilities.IMAGE_TO_IMAGE,
            ],
          },
        ],
      },
    ]
    const referenceAsset = {
      id: 'local-ref-1',
      prompt: 'logo-v1',
      mode: 'edit',
      provider: 'local',
      model: 'reference-image',
      ratio: '1:1',
      size: 'original',
      quality: 'source',
      sourceAssetIds: [],
      createdAt: '2026-05-11T00:00:00Z',
      status: 'succeeded',
      path: '/mock/mita/image-assets/local-ref-1/image.png',
      fileName: 'image.png',
      mimeType: 'image/png',
      assetKind: 'reference',
    }
    const secondReferenceAsset = {
      ...referenceAsset,
      id: 'local-ref-2',
      prompt: 'second-logo',
      path: '/mock/mita/image-assets/local-ref-2/image.png',
    }
    h.listAssets
      .mockResolvedValueOnce([])
      .mockResolvedValue([referenceAsset, secondReferenceAsset])
    h.dialogOpen.mockResolvedValue([
      '/Users/eric/Desktop/logo-v1.png',
      '/Users/eric/Desktop/second-logo.webp',
    ])
    h.importAsset.mockImplementation(({ sourcePath }: { sourcePath: string }) =>
      Promise.resolve(
        sourcePath.endsWith('second-logo.webp')
          ? secondReferenceAsset
          : referenceAsset
      )
    )

    renderComponent()

    await waitFor(() => expect(h.listAssets).toHaveBeenCalled())
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Add reference image' })
      )
      await Promise.resolve()
    })

    await waitFor(() =>
      expect(h.dialogOpen).toHaveBeenCalledWith({
        multiple: true,
        filters: [
          {
            name: 'Image files',
            extensions: ['png', 'jpg', 'jpeg', 'webp'],
          },
        ],
      })
    )
    await waitFor(() => expect(h.importAsset).toHaveBeenCalledTimes(2))
    expect(h.importAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        sourcePath: '/Users/eric/Desktop/logo-v1.png',
        prompt: 'logo-v1',
      })
    )
    expect(h.importAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        sourcePath: '/Users/eric/Desktop/second-logo.webp',
        prompt: 'second-logo',
      })
    )
    expect(screen.queryByText(/reference-image/)).not.toBeInTheDocument()
    expect((await screen.findAllByAltText('logo-v1')).length).toBeGreaterThan(0)
    expect(
      (await screen.findAllByAltText('second-logo')).length
    ).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))

    await waitFor(() =>
      expect(h.generateImages.mock.calls.at(-1)?.[0]).toMatchObject({
        mode: 'edit',
        prompt: 'Create a new image based on these reference images.',
        sourceAssets: [
          expect.objectContaining({ id: 'local-ref-1' }),
          expect.objectContaining({ id: 'local-ref-2' }),
        ],
      })
    )
  })

  it('imports dropped image files as media references', async () => {
    h.providers = [
      {
        provider: 'jingxing',
        base_url: 'https://api.jingxing.uk/v1',
        settings: [],
        models: [
          {
            id: 'gpt-image-2',
            capabilities: [
              ModelCapabilities.IMAGE_GENERATION,
              ModelCapabilities.IMAGE_TO_IMAGE,
            ],
          },
        ],
      },
    ]
    const droppedReferenceAsset = {
      id: 'local-ref-1',
      prompt: 'folder-girl',
      mode: 'edit',
      provider: 'local',
      model: 'reference-image',
      ratio: '1:1',
      size: '4x3',
      quality: 'source',
      sourceAssetIds: [],
      createdAt: '2026-05-11T00:00:00Z',
      status: 'succeeded',
      path: '/mock/mita/image-assets/local-ref-1/image.png',
      fileName: 'image.png',
      mimeType: 'image/png',
      assetKind: 'reference',
    }
    h.listAssets.mockResolvedValue([])
    h.saveAsset.mockResolvedValue(droppedReferenceAsset)
    vi.stubGlobal(
      'Image',
      class {
        naturalWidth = 4
        naturalHeight = 3
        onload?: () => void
        set src(_value: string) {
          this.onload?.()
        }
      }
    )

    renderComponent()

    await waitFor(() => expect(h.listAssets).toHaveBeenCalled())
    const composer = screen
      .getByRole('button', { name: 'Add reference image' })
      .closest('form')
    expect(composer).toBeTruthy()

    const droppedFile = new File(['image-bytes'], 'folder-girl.png', {
      type: 'image/png',
    })
    await act(async () => {
      fireEvent.drop(composer!, {
        dataTransfer: {
          files: [droppedFile],
          items: [],
        },
      })
      await Promise.resolve()
    })

    await waitFor(() =>
      expect(h.saveAsset).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'folder-girl',
          mimeType: 'image/png',
          assetKind: 'reference',
        })
      )
    )
    expect((await screen.findAllByAltText('folder-girl')).length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))

    await waitFor(() =>
      expect(h.generateImages.mock.calls.at(-1)?.[0]).toMatchObject({
        mode: 'variation',
        sourceAssets: [expect.objectContaining({ id: 'local-ref-1' })],
      })
    )
  })

  it('rejects unsupported dropped reference image formats before saving', async () => {
    h.providers = [
      {
        provider: 'jingxing',
        base_url: 'https://api.jingxing.uk/v1',
        settings: [],
        models: [
          {
            id: 'gpt-image-2',
            capabilities: [
              ModelCapabilities.IMAGE_GENERATION,
              ModelCapabilities.IMAGE_TO_IMAGE,
            ],
          },
        ],
      },
    ]
    h.listAssets.mockResolvedValue([])

    renderComponent()

    await waitFor(() => expect(h.listAssets).toHaveBeenCalled())
    const composer = screen
      .getByRole('button', { name: 'Add reference image' })
      .closest('form')
    expect(composer).toBeTruthy()

    const droppedFile = new File(['<svg />'], 'vector.svg', {
      type: 'image/svg+xml',
    })
    await act(async () => {
      fireEvent.drop(composer!, {
        dataTransfer: {
          files: [droppedFile],
          items: [],
        },
      })
      await Promise.resolve()
    })

    expect(h.saveAsset).not.toHaveBeenCalled()
    expect(h.importAsset).not.toHaveBeenCalled()
    expect(h.toast.error).toHaveBeenCalledWith(
      'Use PNG, JPG, or WEBP reference images.'
    )
  })

  it('imports dropped webp reference files when the mime type is missing', async () => {
    h.providers = [
      {
        provider: 'jingxing',
        base_url: 'https://api.jingxing.uk/v1',
        settings: [],
        models: [
          {
            id: 'gpt-image-2',
            capabilities: [
              ModelCapabilities.IMAGE_GENERATION,
              ModelCapabilities.IMAGE_TO_IMAGE,
            ],
          },
        ],
      },
    ]
    const droppedReferenceAsset = {
      id: 'local-ref-1',
      prompt: 'folder-girl',
      mode: 'edit',
      provider: 'local',
      model: 'reference-image',
      ratio: '1:1',
      size: '4x3',
      quality: 'source',
      sourceAssetIds: [],
      createdAt: '2026-05-11T00:00:00Z',
      status: 'succeeded',
      path: '/mock/mita/image-assets/local-ref-1/image.webp',
      fileName: 'image.webp',
      mimeType: 'image/webp',
      assetKind: 'reference',
    }
    h.listAssets.mockResolvedValue([])
    h.saveAsset.mockResolvedValue(droppedReferenceAsset)
    vi.stubGlobal(
      'Image',
      class {
        naturalWidth = 4
        naturalHeight = 3
        onload?: () => void
        set src(_value: string) {
          this.onload?.()
        }
      }
    )

    renderComponent()

    await waitFor(() => expect(h.listAssets).toHaveBeenCalled())
    const composer = screen
      .getByRole('button', { name: 'Add reference image' })
      .closest('form')
    expect(composer).toBeTruthy()

    const droppedFile = new File(['image-bytes'], 'folder-girl.webp')
    await act(async () => {
      fireEvent.drop(composer!, {
        dataTransfer: {
          files: [droppedFile],
          items: [],
        },
      })
      await Promise.resolve()
    })

    await waitFor(() =>
      expect(h.saveAsset).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'folder-girl',
          mimeType: 'image/webp',
          extension: 'webp',
          assetKind: 'reference',
        })
      )
    )
    expect(h.toast.error).not.toHaveBeenCalledWith(
      'Use PNG, JPG, or WEBP reference images.'
    )
  })

  it('regenerates saved image history with original reference assets', async () => {
    h.providers = [
      {
        provider: 'jingxing',
        base_url: 'https://api.jingxing.uk/v1',
        settings: [],
        models: [
          {
            id: 'gpt-image-2',
            capabilities: [
              ModelCapabilities.IMAGE_GENERATION,
              ModelCapabilities.IMAGE_TO_IMAGE,
            ],
          },
        ],
      },
    ]
    const referenceAsset = {
      id: 'local-ref-1',
      prompt: 'blue dress reference',
      mode: 'edit',
      provider: 'local',
      model: 'reference-image',
      ratio: '1:1',
      size: 'original',
      quality: 'source',
      sourceAssetIds: [],
      createdAt: '2026-05-11T00:00:00Z',
      status: 'succeeded',
      path: '/mock/mita/image-assets/local-ref-1/image.png',
      fileName: 'image.png',
      mimeType: 'image/png',
      assetKind: 'reference',
    }
    const generatedAsset = {
      id: 'generated-1',
      prompt: 'keep the reference style',
      mode: 'edit',
      provider: 'jingxing',
      model: 'gpt-image-2',
      ratio: '3:4',
      size: '1024x1536',
      quality: 'high',
      sourceAssetIds: ['local-ref-1'],
      createdAt: '2026-05-11T00:01:00Z',
      status: 'succeeded',
      path: '/mock/mita/image-assets/generated-1/image.png',
      fileName: 'image.png',
      mimeType: 'image/png',
    }
    h.listAssets.mockResolvedValue([generatedAsset, referenceAsset])
    h.generateImages.mockResolvedValueOnce([
      {
        b64Json: 'aGVsbG8=',
        mimeType: 'image/png',
      },
    ])
    h.saveAsset.mockImplementation((request: any) =>
      Promise.resolve({
        ...request,
        createdAt: '2026-05-11T00:02:00Z',
        path: `/mock/mita/image-assets/${request.id}/image.png`,
        fileName: 'image.png',
      })
    )
    vi.stubGlobal(
      'Image',
      class {
        naturalWidth = 1024
        naturalHeight = 1536
        onload?: () => void
        set src(_value: string) {
          this.onload?.()
        }
      }
    )

    renderComponent()

    await screen.findByText('keep the reference style')
    act(() => {
      useImageGenerationStore.getState().setAssets([generatedAsset] as any)
    })
    h.listAssets.mockClear()
    h.listAssets.mockResolvedValue([generatedAsset, referenceAsset])
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }))

    await waitFor(() => expect(h.generateImages).toHaveBeenCalled())
    expect(h.listAssets).toHaveBeenCalled()
    expect(h.generateImages.mock.calls.at(-1)?.[0]).toMatchObject({
      mode: 'edit',
      model: expect.objectContaining({ id: 'gpt-image-2' }),
      prompt: 'keep the reference style',
      ratio: '3:4',
      qualityPreset: 'hd',
      sourceAssets: [expect.objectContaining({ id: 'local-ref-1' })],
    })
  })

  it('does not submit while a reference image is still importing', async () => {
    h.providers = [
      {
        provider: 'jingxing',
        base_url: 'https://api.jingxing.uk/v1',
        settings: [],
        models: [
          {
            id: 'gpt-image-2',
            capabilities: [
              ModelCapabilities.IMAGE_GENERATION,
              ModelCapabilities.IMAGE_TO_IMAGE,
            ],
          },
        ],
      },
    ]
    const referenceAsset = {
      id: 'local-ref-1',
      prompt: 'slow-ref',
      mode: 'edit',
      provider: 'local',
      model: 'reference-image',
      ratio: '1:1',
      size: 'original',
      quality: 'source',
      sourceAssetIds: [],
      createdAt: '2026-05-11T00:00:00Z',
      status: 'succeeded',
      path: '/mock/mita/image-assets/local-ref-1/image.webp',
      fileName: 'image.webp',
      mimeType: 'image/webp',
      assetKind: 'reference',
    }
    let resolveImport!: (asset: typeof referenceAsset) => void
    const importPromise = new Promise<typeof referenceAsset>((resolve) => {
      resolveImport = resolve
    })
    h.dialogOpen.mockResolvedValue(['/Users/eric/Desktop/slow-ref.webp'])
    h.importAsset.mockReturnValue(importPromise)

    renderComponent()

    await waitFor(() => expect(h.listAssets).toHaveBeenCalled())
    fireEvent.change(screen.getByPlaceholderText(/Upload a reference image/), {
      target: { value: 'make it white' },
    })
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Add reference image' })
      )
      await Promise.resolve()
    })

    await waitFor(() => expect(h.importAsset).toHaveBeenCalled())
    const generateButton = screen.getByRole('button', { name: 'Generate' })
    expect(generateButton).toBeDisabled()
    fireEvent.click(generateButton)
    expect(h.generateImages).not.toHaveBeenCalled()

    await act(async () => {
      resolveImport(referenceAsset)
      await importPromise
      await Promise.resolve()
    })

    expect((await screen.findAllByAltText('slow-ref')).length).toBeGreaterThan(
      0
    )
    expect(screen.getByRole('button', { name: 'Generate' })).not.toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
    await waitFor(() =>
      expect(h.generateImages.mock.calls.at(-1)?.[0]).toMatchObject({
        mode: 'edit',
        prompt: 'make it white',
        sourceAssets: [expect.objectContaining({ id: 'local-ref-1' })],
      })
    )
  })

  it('saves pasted images as reference assets', async () => {
    h.providers = [
      {
        provider: 'jingxing',
        base_url: 'https://api.jingxing.uk/v1',
        settings: [],
        models: [
          {
            id: 'gpt-image-2',
            capabilities: [
              ModelCapabilities.IMAGE_GENERATION,
              ModelCapabilities.IMAGE_TO_IMAGE,
            ],
          },
        ],
      },
    ]
    let savedReferencePromise: Promise<any> | undefined
    h.saveAsset.mockImplementation((request: any) => {
      savedReferencePromise = Promise.resolve({
        ...request,
        createdAt: '2026-05-11T00:00:00Z',
        path: `/mock/mita/image-assets/${request.id}/image.png`,
        fileName: 'image.png',
      })
      return savedReferencePromise
    })
    vi.stubGlobal(
      'Image',
      class {
        naturalWidth = 0
        naturalHeight = 0
        onerror?: () => void
        set src(_value: string) {
          this.onerror?.()
        }
      }
    )

    renderComponent()

    await waitFor(() => expect(h.listAssets).toHaveBeenCalled())
    const pastedFile = new File([new Uint8Array([1, 2, 3])], 'paste.png', {
      type: 'image/png',
    })
    await act(async () => {
      fireEvent.paste(screen.getByPlaceholderText(/Upload a reference image/), {
        clipboardData: {
          items: [
            {
              kind: 'file',
              getAsFile: () => pastedFile,
            },
          ],
          files: [],
        },
      })
      await Promise.resolve()
      await Promise.resolve()
    })

    await waitFor(() =>
      expect(h.saveAsset).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'paste',
          provider: 'local',
          model: 'reference-image',
          assetKind: 'reference',
          sourceAssetIds: [],
        })
      )
    )
    await act(async () => {
      await savedReferencePromise
      await Promise.resolve()
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect((await screen.findAllByAltText('paste')).length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
    await waitFor(() =>
      expect(h.generateImages.mock.calls.at(-1)?.[0]).toMatchObject({
        mode: 'variation',
        prompt: 'Create a fresh variation of this image.',
        sourceAssets: [expect.objectContaining({ prompt: 'paste' })],
      })
    )
  })

  it('opens a generated image context menu for preview and Finder access', async () => {
    const originalUserAgent = navigator.userAgent
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      configurable: true,
    })

    try {
      h.providers = [
        {
          provider: 'jingxing',
          base_url: 'https://api.jingxing.uk/v1',
          settings: [],
          models: [
            {
              id: 'gpt-image-2',
              capabilities: [ModelCapabilities.IMAGE_GENERATION],
            },
          ],
        },
      ]
      h.listAssets.mockResolvedValue([
        {
          id: 'asset-1',
          prompt: 'moon desk',
          mode: 'generate',
          provider: 'jingxing',
          model: 'gpt-image-2',
          ratio: '1:1',
          size: '1024x1024',
          quality: 'high',
          sourceAssetIds: [],
          createdAt: '2026-05-11T00:00:00Z',
          status: 'succeeded',
          path: '/tmp/asset.png',
          fileName: 'image.png',
          mimeType: 'image/png',
        },
      ])

      renderComponent()

      const image = (await screen.findAllByAltText('moon desk'))[1]
      fireEvent.contextMenu(image)

      expect(
        screen.getByRole('menuitem', { name: 'Preview' })
      ).toBeInTheDocument()
      expect(
        screen.getByRole('menuitem', { name: 'Open in Finder' })
      ).toBeInTheDocument()

      fireEvent.click(screen.getByRole('menuitem', { name: 'Open in Finder' }))
      await waitFor(() =>
        expect(h.revealItemInDir).toHaveBeenCalledWith('/tmp/asset.png')
      )

      fireEvent.contextMenu(image)
      fireEvent.click(screen.getByRole('menuitem', { name: 'Preview' }))
      expect(screen.getByText('Image preview')).toBeInTheDocument()
    } finally {
      Object.defineProperty(navigator, 'userAgent', {
        value: originalUserAgent,
        configurable: true,
      })
    }
  })
})
