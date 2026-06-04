/* eslint-disable @typescript-eslint/no-explicit-any */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ModelCapabilities } from '@/types/models'
import { ProviderQuotaError } from '@/lib/provider-quota-error'
import { ImageGenerationRequestError } from '@/lib/image-generation-errors'

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
  revealItemInDir: vi.fn(),
  openExternalUrl: vi.fn(),
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: any) => ({ ...config, id: '/images' }),
  Link: ({ children, to }: any) => <a href={to}>{children}</a>,
}))

vi.mock('@/containers/HeaderPage', () => ({
  default: ({ children }: any) => <div data-testid="header-page">{children}</div>,
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
    dialog: () => ({ open: h.dialogOpen }),
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
  'common:imageGeneration.storyboard.title': 'Storyboard short film',
  'common:imageGeneration.storyboard.storyPlaceholder':
    'Describe a short story for the storyboard video.',
  'common:imageGeneration.storyboard.aiBreakdown': 'AI breakdown',
  'common:imageGeneration.storyboard.regenerateBreakdown': 'Regenerate breakdown',
  'common:imageGeneration.storyboard.shotScript': 'Shot script',
  'common:imageGeneration.storyboard.generateStoryboard': 'Generate storyboard',
  'common:imageGeneration.storyboard.storyboardReady': 'Storyboard ready',
  'common:imageGeneration.storyboard.videoModelRequired':
    'Configure a video model to generate Seedance clips.',
  'common:imageGeneration.storyboard.generateVideo': 'Generate video',
  'common:imageGeneration.storyboard.downloadStoryboard': 'Download storyboard',
  'common:imageGeneration.storyboard.downloadVideo': 'Download video',
  'common:imageGeneration.storyboard.step.compose': 'Script',
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
    h.revealItemInDir.mockResolvedValue(undefined)
    h.openExternalUrl.mockResolvedValue(undefined)
  })

  it('shows the no-image-model empty state', async () => {
    renderComponent()

    expect(await screen.findByText('No image models available')).toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: 'Image model' })).toHaveTextContent(
      'gpt-image-1.5'
    )
    expect(screen.getByRole('button', { name: 'Image model' })).toHaveTextContent(
      'Jingxing'
    )
    expect(screen.getByRole('button', { name: 'Image model' })).not.toHaveTextContent(
      'Model ·'
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Image model' }))
    })
    expect(screen.getByRole('button', { name: 'gemini-2.5-flash-image' })).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'gpt-image-2' }))
    })
    expect(screen.getByRole('button', { name: 'Image model' })).toHaveTextContent(
      'gpt-image-2'
    )
    expect(screen.getByText('Today')).toBeInTheDocument()
    expect(screen.queryByText('Queue')).not.toBeInTheDocument()
    expect(screen.queryByText('Assets')).not.toBeInTheDocument()
    expect(screen.queryByText('图片生成')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Image' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Storyboard video' })
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Generate' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Variation' })).not.toBeInTheDocument()
    expect(screen.queryByText('1 image')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Image size settings' })).toHaveTextContent(
      '1:1'
    )
    expect(screen.getByRole('button', { name: 'Image size settings' })).toHaveTextContent(
      'HD 2K'
    )
    expect(screen.queryByText('SD')).not.toBeInTheDocument()
    expect(screen.queryByText('HD')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Image size settings' }))
    expect(screen.getByText('Select ratio')).toBeInTheDocument()
    expect(screen.getByText('Select resolution')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '智能' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '21:9' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '16:9' }))
    fireEvent.click(screen.getByRole('button', { name: /Ultra HD 4K/ }))
    expect(screen.getByRole('button', { name: 'Image size settings' })).toHaveTextContent(
      '16:9'
    )
    expect(screen.getByRole('button', { name: 'Image size settings' })).toHaveTextContent(
      'Ultra HD 4K'
    )
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
    h.breakdownStoryboard.mockResolvedValueOnce({
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
    fireEvent.change(
      screen.getByPlaceholderText('Describe a short story for the storyboard video.'),
      {
        target: {
          value:
            'A gold robot wakes in a neon city, crosses a corridor, and reaches a rooftop.',
        },
      }
    )
    fireEvent.click(screen.getByRole('button', { name: 'AI breakdown' }))

    await waitFor(() =>
      expect(h.breakdownStoryboard).toHaveBeenCalledWith(
        expect.objectContaining({
          model: expect.objectContaining({ id: 'gpt-5-mini' }),
          shotCount: 6,
        })
      )
    )
    expect(await screen.findByText('Shot script')).toBeInTheDocument()
    expect(screen.getAllByDisplayValue(/gold robot/i).length).toBeGreaterThan(1)
    fireEvent.click(screen.getByRole('button', { name: 'Generate storyboard' }))

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
    expect(await screen.findByText('Storyboard ready')).toBeInTheDocument()
    expect(
      screen.getByText('Configure a video model to generate Seedance clips.')
    ).toBeInTheDocument()
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
    fireEvent.change(
      screen.getByPlaceholderText(/Upload a reference image/),
      { target: { value: 'a tiny moon desk' } }
    )
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))

    expect(await screen.findByText('该令牌额度已用尽')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Recharge' }))
    expect(h.openExternalUrl).toHaveBeenCalledWith(
      'https://api.jingxing.uk/console/topup'
    )
    expect(screen.getByRole('button', { name: 'Manage tokens' })).toBeInTheDocument()
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
    fireEvent.change(
      screen.getByPlaceholderText(/Upload a reference image/),
      { target: { value: 'a tiny moon desk' } }
    )
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
    fireEvent.click(screen.getByRole('button', { name: 'Use saved asset' }))
    expect(screen.queryByText('Mask')).not.toBeInTheDocument()
    expect(screen.getAllByText('moon desk').length).toBeGreaterThan(0)

    fireEvent.change(
      screen.getByPlaceholderText(/Upload a reference image/),
      { target: { value: 'make it glass' } }
    )
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))

    await waitFor(() =>
      expect(h.generateImages.mock.calls.at(-1)?.[0]).toMatchObject({
        mode: 'edit',
        prompt: 'make it glass',
        sourceAssets: [expect.objectContaining({ id: 'asset-1' })],
      })
    )

    h.generateImages.mockClear()
    fireEvent.change(
      screen.getByPlaceholderText(/Upload a reference image/),
      { target: { value: '' } }
    )
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))

    await waitFor(() =>
      expect(h.generateImages.mock.calls.at(-1)?.[0]).toMatchObject({
        mode: 'variation',
        prompt: 'Create a fresh variation of this image.',
        sourceAssets: [expect.objectContaining({ id: 'asset-1' })],
      })
    )
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
    fireEvent.click(screen.getByRole('button', { name: 'Use saved asset' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove moon desk' }))
    fireEvent.change(
      screen.getByPlaceholderText(/Upload a reference image/),
      { target: { value: '' } }
    )
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))

    await waitFor(() => expect(h.generateImages).not.toHaveBeenCalled())
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
    h.listAssets.mockResolvedValueOnce([]).mockResolvedValue([
      referenceAsset,
      secondReferenceAsset,
    ])
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
      fireEvent.click(screen.getByRole('button', { name: 'Add reference image' }))
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
    expect((await screen.findAllByAltText('second-logo')).length).toBeGreaterThan(0)

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
    fireEvent.change(
      screen.getByPlaceholderText(/Upload a reference image/),
      { target: { value: 'make it white' } }
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add reference image' }))
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

    expect((await screen.findAllByAltText('slow-ref')).length).toBeGreaterThan(0)
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

      expect(screen.getByRole('menuitem', { name: 'Preview' })).toBeInTheDocument()
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
