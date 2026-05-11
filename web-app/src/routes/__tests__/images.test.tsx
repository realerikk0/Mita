/* eslint-disable @typescript-eslint/no-explicit-any */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import React, { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ModelCapabilities } from '@/types/models'

const h = vi.hoisted(() => ({
  providers: [] as any[],
  assets: [] as any[],
  generateImages: vi.fn(),
  saveAsset: vi.fn(),
  listAssets: vi.fn(),
  deleteAsset: vi.fn(),
  revealItemInDir: vi.fn(),
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
      listAssets: h.listAssets,
      deleteAsset: h.deleteAsset,
    }),
    core: () => ({ convertFileSrc: h.convertFileSrc }),
    opener: () => ({ revealItemInDir: h.revealItemInDir }),
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
  'common:imageGeneration.status.saved': 'Saved',
  'common:imageGeneration.status.pending': 'Pending',
  'common:imageGeneration.status.running': 'Running',
  'common:imageGeneration.status.succeeded': 'Succeeded',
  'common:imageGeneration.status.failed': 'Failed',
  'common:imageGeneration.defaultVariationPrompt':
    'Create a fresh variation of this image.',
  'common:imageGeneration.defaultMaskEditPrompt':
    'Edit this image using the provided mask.',
  'common:imageGeneration.imageCount.one': '{{count}} image',
  'common:imageGeneration.imageCount.other': '{{count}} images',
  'common:imageGeneration.imagePreview': 'Image preview',
  'common:imageGeneration.decreaseCount': 'Decrease count',
  'common:imageGeneration.increaseCount': 'Increase count',
  'common:imageGeneration.reEdit': 'Re-edit',
  'common:imageGeneration.regenerate': 'Regenerate',
  'common:imageGeneration.retry': 'Retry',
  'common:imageGeneration.mask': 'Mask',
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
  beforeEach(() => {
    vi.clearAllMocks()
    h.providers = []
    h.assets = []
    h.generateImages.mockResolvedValue([])
    h.saveAsset.mockResolvedValue(null)
    h.listAssets.mockResolvedValue([])
    h.revealItemInDir.mockResolvedValue(undefined)
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
    fireEvent.change(
      screen.getByPlaceholderText(/Upload a reference image/),
      { target: { value: 'moon desk' } }
    )
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))

    await waitFor(() => expect(h.generateImages).toHaveBeenCalled())
    expect(h.generateImages.mock.calls.at(-1)?.[0]).toMatchObject({
      mode: 'generate',
      prompt: 'moon desk',
      sourceAsset: null,
    })
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
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Reference image' }))
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Use moon desk as source' }))
    expect(screen.getByText('Mask')).toBeInTheDocument()
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
        sourceAsset: expect.objectContaining({ id: 'asset-1' }),
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
        sourceAsset: expect.objectContaining({ id: 'asset-1' }),
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
    fireEvent.click(screen.getByRole('button', { name: 'Reference image' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Use moon desk as source' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear source' }))
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))

    await waitFor(() => expect(h.generateImages).not.toHaveBeenCalled())
  })

  it('opens a generated image context menu for preview and Finder access', async () => {
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
      screen.getByRole('menuitem', { name: 'Open in Finder / Explorer' })
    ).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('menuitem', { name: 'Open in Finder / Explorer' })
    )
    await waitFor(() => expect(h.revealItemInDir).toHaveBeenCalledWith('/tmp/asset.png'))

    fireEvent.contextMenu(image)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Preview' }))
    expect(screen.getByText('Image preview')).toBeInTheDocument()
  })
})
