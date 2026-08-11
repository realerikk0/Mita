import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { VideoReferenceKind } from '@/services/video-generation/types'
import {
  DirectVideoFeed,
  DirectVideoMode,
  type VideoReferenceAssetOption,
} from '../DirectVideoMode'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => {
    const translations: Record<string, string> = {
      'common:imageGeneration.storyboard.continueQuery': 'Continue polling',
      'common:imageGeneration.storyboard.abandonVideoTask': 'Abandon task',
    }
    return { t: (key: string) => translations[key] ?? key }
  },
}))

function provider(overrides: Partial<ModelProvider> = {}): ModelProvider {
  return {
    active: true,
    provider: 'jingxing',
    base_url: 'https://api.biyuan.ai/v1',
    settings: [],
    models: [],
    ...overrides,
  }
}

function model(id = 'doubao-seedance-2-0-260128'): Model {
  return {
    id,
    displayName: 'Seedance 2.0',
    capabilities: ['video_generation'],
  }
}

function referenceAsset(
  kind: VideoReferenceKind,
  id: string
): VideoReferenceAssetOption {
  const extension =
    kind === 'image' ? 'png' : kind === 'video' ? 'mp4' : 'mp3'
  return {
    reference: {
      kind,
      asset: {
        id,
        path: `C:\\media\\${id}.${extension}`,
        fileName: `${id}.${extension}`,
        mimeType: `${kind}/${kind === 'audio' ? 'mpeg' : extension}`,
      },
    },
    displayName: `${kind}-${id}`,
    previewSrc:
      kind === 'image' ? `https://example.com/${id}.png` : undefined,
  }
}

describe('DirectVideoMode', () => {
  it('opens the native media picker directly and explains verified capabilities', async () => {
    const user = userEvent.setup()
    const onPickReferences = vi.fn().mockResolvedValue([])

    render(
      <DirectVideoMode
        videoModels={[{ provider: provider(), model: model() }]}
        onPickReferences={onPickReferences}
        onGenerate={vi.fn()}
      />
    )

    expect(
      screen.getByText(
        '支持图片、视频和音频组合参考；最多15项，包括9图、3视频、3音频。'
      )
    ).toBeInTheDocument()
    expect(screen.queryByText(/1 张参考图片/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '添加参考素材' }))
    await waitFor(() => expect(onPickReferences).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('参考素材')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '视频参数' }))
    expect(screen.getByLabelText('生成同步音频')).toBeEnabled()
    expect(screen.getByLabelText('生成同步音频')).toBeChecked()
    expect(
      screen.getByText(
        '随画面生成对白、音效和背景音乐；关闭后输出无声视频。'
      )
    ).toBeInTheDocument()
  })

  it('submits image, video, and audio references through onGenerate', async () => {
    const user = userEvent.setup()
    const onGenerate = vi.fn().mockResolvedValue(undefined)
    const imageReference = referenceAsset('image', 'image-1')
    const videoReference = referenceAsset('video', 'video-1')
    const audioReference = referenceAsset('audio', 'audio-1')
    const onPickReferences = vi
      .fn()
      .mockResolvedValue([imageReference, videoReference, audioReference])
    const selectedProvider = provider()
    const selectedModel = model()

    render(
      <DirectVideoMode
        videoModels={[
          { provider: selectedProvider, model: selectedModel },
          {
            provider: provider({ provider: 'custom-video' }),
            model: model('unrelated-video-model'),
          },
        ]}
        onPickReferences={onPickReferences}
        onGenerate={onGenerate}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Seedance 模型' }))
    expect(
      screen.queryByRole('button', { name: /unrelated-video-model/i })
    ).not.toBeInTheDocument()
    await user.keyboard('{Escape}')

    const submitButton = screen.getByRole('button', {
      name: '生成视频',
    })
    expect(submitButton).toBeDisabled()

    await user.type(
      screen.getByLabelText('提示词'),
      '低机位跟拍跑车驶过雨夜公路'
    )
    await user.click(screen.getByRole('button', { name: '添加参考素材' }))
    await waitFor(() =>
      expect(
        screen.getByRole('button', {
          name: `移除参考音频 ${audioReference.displayName}`,
        })
      ).toBeInTheDocument()
    )
    await user.click(screen.getByRole('button', { name: '视频参数' }))
    await user.click(screen.getByRole('button', { name: '9:16' }))
    await user.click(screen.getByRole('button', { name: '1080p' }))
    fireEvent.change(screen.getByLabelText('视频时长'), {
      target: { value: '12' },
    })
    await user.click(submitButton)

    await waitFor(() => expect(onGenerate).toHaveBeenCalledTimes(1))
    const input = onGenerate.mock.calls[0]?.[0]
    expect(input).toEqual({
      provider: selectedProvider,
      model: selectedModel,
      prompt: '低机位跟拍跑车驶过雨夜公路',
      ratio: '9:16',
      duration: 12,
      resolution: '1080p',
      generateAudio: true,
      references: [
        imageReference.reference,
        videoReference.reference,
        audioReference.reference,
      ],
    })
    expect(input).not.toHaveProperty('fps')
  })

  it('enforces the 9-image limit and allows a selected reference to be removed', async () => {
    const user = userEvent.setup()
    const imageReferences = Array.from({ length: 10 }, (_, index) =>
      referenceAsset('image', `image-${index + 1}`)
    )
    const onPickReferences = vi
      .fn()
      .mockResolvedValueOnce(imageReferences)
      .mockResolvedValueOnce([imageReferences[9]])

    render(
      <DirectVideoMode
        videoModels={[{ provider: provider(), model: model() }]}
        onPickReferences={onPickReferences}
        onGenerate={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: '添加参考素材' }))
    await waitFor(() =>
      expect(
        screen.getAllByRole('button', { name: /移除参考图片/ })
      ).toHaveLength(9)
    )
    expect(
      screen.queryByRole('button', {
        name: `移除参考图片 ${imageReferences[9].displayName}`,
      })
    ).not.toBeInTheDocument()

    await user.click(
      screen.getByRole('button', {
        name: `移除参考图片 ${imageReferences[0].displayName}`,
      })
    )
    expect(
      screen.queryByRole('button', {
        name: `移除参考图片 ${imageReferences[0].displayName}`,
      })
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '添加参考素材' }))
    await waitFor(() =>
      expect(
        screen.getByRole('button', {
          name: `移除参考图片 ${imageReferences[9].displayName}`,
        })
      ).toBeInTheDocument()
    )
  })

  it('requires an image or video when audio is the only reference', async () => {
    const user = userEvent.setup()
    const audioReference = referenceAsset('audio', 'audio-only')
    const imageReference = referenceAsset('image', 'subject')
    const onPickReferences = vi
      .fn()
      .mockResolvedValueOnce([audioReference])
      .mockResolvedValueOnce([imageReference])

    render(
      <DirectVideoMode
        videoModels={[{ provider: provider(), model: model() }]}
        onPickReferences={onPickReferences}
        onGenerate={vi.fn()}
      />
    )

    await user.type(screen.getByLabelText('提示词'), '跟随节奏切换镜头')
    await user.click(screen.getByRole('button', { name: '添加参考素材' }))

    await waitFor(() =>
      expect(
        screen.getByText('音频参考需与至少 1 张图片或 1 个视频组合使用。')
      ).toBeInTheDocument()
    )
    expect(screen.getByRole('button', { name: '生成视频' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: '添加参考素材' }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: '生成视频' })).toBeEnabled()
    )
  })

  it('disables submission and exposes progress while a task is running', async () => {
    const user = userEvent.setup()
    const onGenerate = vi.fn()

    render(
      <DirectVideoMode
        videoModels={[{ provider: provider(), model: model() }]}
        runtime={{ status: 'running', progress: 42 }}
        onGenerate={onGenerate}
      />
    )

    expect(screen.getByText('视频生成中')).toBeInTheDocument()
    expect(screen.getByText('42%')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '正在生成' })).toBeDisabled()
    expect(screen.getByLabelText('提示词')).toBeDisabled()

    await user.click(screen.getByRole('button', { name: '正在生成' }))
    expect(onGenerate).not.toHaveBeenCalled()
  })

  it('keeps the video composer busy while its polling connection recovers', () => {
    render(
      <DirectVideoMode
        videoModels={[{ provider: provider(), model: model() }]}
        runtime={{
          status: 'running',
          progress: 42,
          connectionState: 'reconnecting',
          retryAt: Date.now() + 5_000,
          error: 'stale polling error',
        }}
        onGenerate={vi.fn()}
      />
    )

    expect(screen.getByText('网络波动，正在重连')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '正在生成' })).toBeDisabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps the composer locked while an existing task is manually paused', async () => {
    const user = userEvent.setup()
    const onGenerate = vi.fn()

    render(
      <DirectVideoMode
        videoModels={[{ provider: provider(), model: model() }]}
        runtime={{ status: 'failed', connectionState: 'paused' }}
        onGenerate={onGenerate}
      />
    )

    expect(screen.getByLabelText('提示词')).toBeDisabled()
    const generateButton = screen.getByRole('button', { name: '正在生成' })
    expect(generateButton).toBeDisabled()
    await user.click(generateButton)
    expect(onGenerate).not.toHaveBeenCalled()
  })

  it('does not claim multimodal-reference support for an unverified provider', async () => {
    const user = userEvent.setup()
    const onPickReferences = vi
      .fn()
      .mockResolvedValue([referenceAsset('image', 'image-1')])

    render(
      <DirectVideoMode
        videoModels={[
          {
            provider: provider({
              provider: 'custom',
              base_url: 'https://example.com/v1',
            }),
            model: model(),
          },
        ]}
        onPickReferences={onPickReferences}
        onGenerate={vi.fn()}
      />
    )

    const addButton = screen.getByRole('button', { name: '添加参考素材' })
    expect(addButton).toBeDisabled()
    await user.click(addButton)
    expect(onPickReferences).not.toHaveBeenCalled()
  })

  it('uses model-specific resolution options and exposes a result slot', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <DirectVideoMode
        videoModels={[
          {
            provider: provider(),
            model: model('doubao-seedance-2-0-fast-260128'),
          },
        ]}
        result={<video aria-label="生成结果预览" />}
        onGenerate={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: '视频参数' }))
    expect(screen.getByRole('button', { name: '480p' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '720p' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '1080p' })
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '4K' })).not.toBeInTheDocument()
    expect(screen.getByTestId('direct-video-result')).toContainElement(
      screen.getByLabelText('生成结果预览')
    )

    await user.keyboard('{Escape}')
    rerender(
      <DirectVideoMode
        videoModels={[
          {
            provider: provider(),
            model: model('doubao-seedance-2-0-260128'),
          },
        ]}
        onGenerate={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: '视频参数' }))
    expect(screen.getByRole('button', { name: '1080p' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '4K' })).toBeInTheDocument()
  })

  it('shows a live token and Biyuan price estimate beside generate', async () => {
    const user = userEvent.setup()

    render(
      <DirectVideoMode
        videoModels={[{ provider: provider(), model: model() }]}
        loadPricePerMillionCny={() => Promise.resolve(54.6)}
        onGenerate={vi.fn()}
      />
    )

    await user.type(screen.getByLabelText('提示词'), '海面上的日出')

    expect(screen.getByText(/108,000/)).toBeInTheDocument()
    expect(await screen.findByText('约 ¥5.90')).toBeInTheDocument()
  })

  it('enables synchronized audio by default for Seedance 2.0', async () => {
    const user = userEvent.setup()
    const onGenerate = vi.fn().mockResolvedValue(undefined)

    render(
      <DirectVideoMode
        videoModels={[{ provider: provider(), model: model() }]}
        supportsSynchronizedAudio={() => true}
        onGenerate={onGenerate}
      />
    )

    await user.type(screen.getByLabelText('提示词'), '海边日落延时摄影')
    await user.click(screen.getByRole('button', { name: '视频参数' }))
    expect(screen.getByLabelText('生成同步音频')).toBeChecked()
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: '生成视频' }))

    await waitFor(() => expect(onGenerate).toHaveBeenCalledTimes(1))
    expect(onGenerate.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ generateAudio: true })
    )
  })
})

describe('DirectVideoFeed', () => {
  it('renders the video workspace empty state', () => {
    render(<DirectVideoFeed items={[]} videoSrc={() => ''} />)

    expect(screen.getByTestId('direct-video-feed')).toHaveTextContent(
      '生成的视频会显示在这里。'
    )
  })

  it('renders running progress and supports cancellation', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    const item = {
      id: 'direct-video:task-1',
      prompt: '雨夜跑车',
      provider: 'jingxing',
      model: 'seedance-2.0',
      ratio: '16:9' as const,
      resolution: '720p' as const,
      duration: 5,
      status: 'running' as const,
      progress: 42,
    }

    render(
      <DirectVideoFeed
        items={[item]}
        videoSrc={() => ''}
        onCancel={onCancel}
      />
    )

    expect(screen.getByText('视频生成中')).toBeInTheDocument()
    expect(screen.getByText('42%')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(onCancel).toHaveBeenCalledWith(item)
  })

  it('shows a reconnecting video task as active instead of failed', () => {
    render(
      <DirectVideoFeed
        items={[
          {
            id: 'direct-video:reconnecting',
            prompt: '雨夜跑车',
            model: 'seedance-2.0',
            ratio: '16:9',
            resolution: '720p',
            duration: 5,
            status: 'running',
            progress: 42,
            connectionState: 'reconnecting',
          },
        ]}
        videoSrc={() => ''}
      />
    )

    expect(screen.getAllByText('网络波动，正在重连')).toHaveLength(2)
    expect(screen.queryByText('视频生成失败')).not.toBeInTheDocument()
  })

  it('continues polling a persisted failed task instead of regenerating it', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    const onCancel = vi.fn()
    const item = {
      id: 'direct-video:persisted',
      prompt: '雨夜跑车',
      model: 'seedance-2.0',
      ratio: '16:9' as const,
      resolution: '720p' as const,
      duration: 5,
      status: 'failed' as const,
      error: '网络连接暂时中断',
      connectionState: 'paused' as const,
      hasPersistedTask: true,
      resumePolicy: 'manual' as const,
    }

    render(
      <DirectVideoFeed
        items={[item]}
        videoSrc={() => ''}
        onCancel={onCancel}
        onRetry={onRetry}
      />
    )

    expect(screen.getByText('视频任务查询已暂停')).toBeInTheDocument()
    expect(screen.queryByText('视频生成失败')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Continue polling' }))
    expect(onRetry).toHaveBeenCalledWith(item)
    await user.click(screen.getByRole('button', { name: 'Abandon task' }))
    expect(onCancel).toHaveBeenCalledWith(item)
  })

  it('keeps regenerate available only for a terminal failure without a task', () => {
    render(
      <DirectVideoFeed
        items={[
          {
            id: 'direct-video:terminal-failure',
            prompt: '雨夜跑车',
            model: 'seedance-2.0',
            ratio: '16:9',
            resolution: '720p',
            duration: 5,
            status: 'failed',
            error: '输出视频可能包含敏感内容',
          },
        ]}
        videoSrc={() => ''}
        onCancel={vi.fn()}
        onDownload={vi.fn()}
        onRetry={vi.fn()}
      />
    )

    expect(screen.getByText('视频生成失败')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '下载' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Continue polling' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Abandon task' })
    ).not.toBeInTheDocument()
  })

  it('renders completed video actions for preview and direct download', async () => {
    const user = userEvent.setup()
    const onPreview = vi.fn()
    const onDownload = vi.fn()
    const asset = {
      id: 'video-1',
      prompt: '海边日落',
      provider: 'jingxing',
      model: 'seedance-2.0',
      ratio: '16:9' as const,
      resolution: '1080p' as const,
      duration: 8,
      fps: 24,
      sourceAssetIds: [],
      createdAt: '2026-08-01T00:00:00.000Z',
      status: 'succeeded' as const,
      path: 'C:\\media\\video-1.mp4',
      fileName: 'video-1.mp4',
      mimeType: 'video/mp4',
      assetKind: 'generated' as const,
    }

    render(
      <DirectVideoFeed
        items={[
          {
            id: asset.id,
            prompt: asset.prompt,
            provider: asset.provider,
            model: asset.model,
            ratio: asset.ratio,
            resolution: asset.resolution,
            duration: asset.duration,
            status: asset.status,
            asset,
          },
        ]}
        videoSrc={() => 'asset://video-1.mp4'}
        onPreview={onPreview}
        onDownload={onDownload}
      />
    )

    expect(document.querySelector('video')).toHaveAttribute(
      'src',
      'asset://video-1.mp4'
    )
    await user.click(screen.getByRole('button', { name: '打开预览' }))
    expect(onPreview).toHaveBeenCalledWith(asset)
    await user.click(screen.getByRole('button', { name: '下载' }))
    expect(onDownload).toHaveBeenCalledWith(asset)
  })
})
