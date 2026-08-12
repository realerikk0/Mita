import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockStreamText = vi.fn()
const mockCreateModel = vi.fn()
const mockProviderGetState = vi.fn()
const mockAssistantGetState = vi.fn()
const mockIsBiyuanProvider = vi.fn()
const mockModelRequiresResponsesEndpoint = vi.fn()
const mockStreamJingxingResponsesChat = vi.fn()

vi.mock('ai', () => ({
  streamText: (...args: unknown[]) => mockStreamText(...args),
}))

vi.mock('@/lib/model-factory', () => ({
  ModelFactory: {
    createModel: (...args: unknown[]) => mockCreateModel(...args),
  },
}))

vi.mock('@/constants/biyuan', () => ({
  isBiyuanProvider: (...args: unknown[]) => mockIsBiyuanProvider(...args),
}))

vi.mock('@/lib/provider-models', () => ({
  modelRequiresResponsesEndpoint: (...args: unknown[]) =>
    mockModelRequiresResponsesEndpoint(...args),
}))

vi.mock('@/lib/jingxing-responses-web-search', () => ({
  streamJingxingResponsesChat: (...args: unknown[]) =>
    mockStreamJingxingResponsesChat(...args),
}))

vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: { getState: () => mockProviderGetState() },
}))

vi.mock('@/hooks/useAssistant', () => ({
  useAssistant: { getState: () => mockAssistantGetState() },
}))

import {
  buildNovelCandidatePrompt,
  runNovelCandidateStreams,
} from '@/lib/novel-ai'
import type { AiContextItem } from '@/types/novel'

async function* chunks(...values: string[]) {
  for (const value of values) yield value
}

function uiChunks(
  ...values: Array<
    | { type: 'text-delta'; id: string; delta: string }
    | { type: 'error'; errorText: string }
    | { type: 'abort' }
    | { type: 'finish' }
  >
) {
  return new ReadableStream({
    start(controller) {
      values.forEach((value) => controller.enqueue(value))
      controller.close()
    },
  })
}

const context: AiContextItem[] = [
  {
    id: 'character-1',
    type: 'character',
    label: '沈砚',
    content: '谨慎，不轻易表态。',
    included: true,
  },
  {
    id: 'clue-1',
    type: 'clue',
    label: '发簪',
    content: '第 70 章回收。',
    included: false,
  },
]

describe('runNovelCandidateStreams', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProviderGetState.mockReturnValue({
      selectedModel: { id: 'writer-model' },
      selectedProvider: 'openai',
      getProviderByName: vi.fn(() => ({
        provider: 'openai',
        api_key: 'secret',
        base_url: 'https://api.openai.com/v1',
      })),
    })
    mockAssistantGetState.mockReturnValue({
      currentAssistant: { parameters: { temperature: 0.72 } },
    })
    mockIsBiyuanProvider.mockReturnValue(false)
    mockModelRequiresResponsesEndpoint.mockReturnValue(false)
    mockCreateModel.mockImplementation(async () => ({
      modelId: `model-${mockCreateModel.mock.calls.length}`,
    }))
    mockStreamText.mockImplementation(() => ({
      textStream: chunks('半', '句'),
    }))
  })

  it('runs three independent streams with indexed deltas and statuses', async () => {
    const onDelta = vi.fn()
    const onStatus = vi.fn()

    const result = await runNovelCandidateStreams({
      mode: 'rewrite',
      instruction: '增强压迫感',
      selection: '雨落在发簪上。',
      context,
      onDelta,
      onStatus,
    })

    expect(mockCreateModel).toHaveBeenCalledTimes(3)
    expect(mockCreateModel).toHaveBeenNthCalledWith(
      1,
      'writer-model',
      expect.objectContaining({ provider: 'openai' }),
      { temperature: 0.72 }
    )
    expect(mockStreamText).toHaveBeenCalledTimes(3)
    expect(mockStreamJingxingResponsesChat).not.toHaveBeenCalled()
    expect(new Set(mockStreamText.mock.calls.map(([value]) => value.model)).size)
      .toBe(3)
    expect(onDelta).toHaveBeenCalledTimes(6)
    expect(onStatus).toHaveBeenCalledWith(0, 'streaming')
    expect(onStatus).toHaveBeenCalledWith(1, 'ready')
    expect(result).toEqual([
      { index: 0, text: '半句', status: 'ready' },
      { index: 1, text: '半句', status: 'ready' },
      { index: 2, text: '半句', status: 'ready' },
    ])
  })

  it('keeps a failed candidate isolated from the other streams', async () => {
    mockStreamText
      .mockImplementationOnce(() => ({ textStream: chunks('甲') }))
      .mockImplementationOnce(() => {
        throw new Error('quota exhausted')
      })
      .mockImplementationOnce(() => ({ textStream: chunks('丙') }))

    const onStatus = vi.fn()
    const result = await runNovelCandidateStreams({
      mode: 'continue',
      instruction: '继续',
      selection: '门开了。',
      context: [],
      onDelta: vi.fn(),
      onStatus,
    })

    expect(result.map((value) => value.status)).toEqual([
      'ready',
      'failed',
      'ready',
    ])
    expect(result[1]).toMatchObject({ error: 'quota exhausted' })
    expect(onStatus).toHaveBeenCalledWith(1, 'failed', 'quota exhausted')
  })

  it('does not start requests when already aborted', async () => {
    const controller = new AbortController()
    controller.abort('user stopped')
    const onStatus = vi.fn()

    const result = await runNovelCandidateStreams({
      mode: 'continue',
      instruction: '',
      selection: '',
      context: [],
      signal: controller.signal,
      onDelta: vi.fn(),
      onStatus,
    })

    expect(mockCreateModel).not.toHaveBeenCalled()
    expect(result.every((value) => value.status === 'stopped')).toBe(true)
    expect(onStatus).toHaveBeenCalledTimes(3)
  })

  it('streams response-only Biyuan models through the Responses endpoint', async () => {
    const selectedModel = {
      id: 'gpt-5.4-pro',
      supported_endpoint_types: ['responses'],
    }
    const provider = {
      provider: 'jingxing',
      api_key: 'secret',
      base_url: 'https://api.jingxing.io/v1',
    }
    mockProviderGetState.mockReturnValue({
      selectedModel,
      selectedProvider: 'jingxing',
      getProviderByName: vi.fn(() => provider),
    })
    mockIsBiyuanProvider.mockReturnValue(true)
    mockModelRequiresResponsesEndpoint.mockReturnValue(true)
    mockStreamJingxingResponsesChat.mockImplementation(() =>
      uiChunks(
        { type: 'text-delta', id: 'text', delta: '半' },
        { type: 'text-delta', id: 'text', delta: '句' },
        { type: 'finish' }
      )
    )
    const onDelta = vi.fn()
    const onStatus = vi.fn()

    const result = await runNovelCandidateStreams({
      mode: 'rewrite',
      instruction: '增强压迫感',
      selection: '雨落在发簪上。',
      context,
      onDelta,
      onStatus,
    })

    expect(mockIsBiyuanProvider).toHaveBeenCalledWith(
      'jingxing',
      'https://api.jingxing.io/v1'
    )
    expect(mockModelRequiresResponsesEndpoint).toHaveBeenCalledWith(
      'gpt-5.4-pro',
      selectedModel
    )
    expect(mockStreamJingxingResponsesChat).toHaveBeenCalledTimes(3)
    expect(mockStreamJingxingResponsesChat).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        modelId: 'gpt-5.4-pro',
        provider,
        system: expect.stringContaining('彼岩网文模式'),
        messages: [
          expect.objectContaining({
            role: 'user',
            parts: [
              expect.objectContaining({
                type: 'text',
                text: expect.stringContaining('增强压迫感'),
              }),
            ],
          }),
        ],
        abortSignal: expect.any(AbortSignal),
      })
    )
    expect(mockCreateModel).not.toHaveBeenCalled()
    expect(mockStreamText).not.toHaveBeenCalled()
    expect(onDelta).toHaveBeenCalledTimes(6)
    expect(result).toEqual([
      { index: 0, text: '半句', status: 'ready' },
      { index: 1, text: '半句', status: 'ready' },
      { index: 2, text: '半句', status: 'ready' },
    ])
  })

  it('isolates Responses endpoint error chunks', async () => {
    mockProviderGetState.mockReturnValue({
      selectedModel: { id: 'gpt-5.4-pro' },
      selectedProvider: 'biyuan',
      getProviderByName: vi.fn(() => ({
        provider: 'biyuan',
        api_key: 'secret',
        base_url: 'https://api.biyuan.ai/v1',
      })),
    })
    mockIsBiyuanProvider.mockReturnValue(true)
    mockModelRequiresResponsesEndpoint.mockReturnValue(true)
    mockStreamJingxingResponsesChat
      .mockImplementationOnce(() =>
        uiChunks({ type: 'text-delta', id: 'a', delta: '甲' })
      )
      .mockImplementationOnce(() =>
        uiChunks({ type: 'error', errorText: 'responses unavailable' })
      )
      .mockImplementationOnce(() =>
        uiChunks({ type: 'text-delta', id: 'c', delta: '丙' })
      )
    const onStatus = vi.fn()

    const result = await runNovelCandidateStreams({
      mode: 'continue',
      instruction: '继续',
      selection: '门开了。',
      context: [],
      onDelta: vi.fn(),
      onStatus,
    })

    expect(result.map((value) => value.status)).toEqual([
      'ready',
      'failed',
      'ready',
    ])
    expect(result[1]).toMatchObject({ error: 'responses unavailable' })
    expect(onStatus).toHaveBeenCalledWith(
      1,
      'failed',
      'responses unavailable'
    )
  })

  it('stops every Responses stream when its parent signal aborts', async () => {
    mockProviderGetState.mockReturnValue({
      selectedModel: { id: 'gpt-5.4-pro' },
      selectedProvider: 'biyuan',
      getProviderByName: vi.fn(() => ({
        provider: 'biyuan',
        api_key: 'secret',
        base_url: 'https://api.biyuan.ai/v1',
      })),
    })
    mockIsBiyuanProvider.mockReturnValue(true)
    mockModelRequiresResponsesEndpoint.mockReturnValue(true)
    mockStreamJingxingResponsesChat.mockImplementation(
      ({ abortSignal }: { abortSignal: AbortSignal }) =>
        new ReadableStream({
          start(streamController) {
            streamController.enqueue({
              type: 'text-delta',
              id: 'text',
              delta: '先',
            })
            abortSignal.addEventListener(
              'abort',
              () => {
                streamController.enqueue({ type: 'abort' })
                streamController.close()
              },
              { once: true }
            )
          },
        })
    )
    const controller = new AbortController()
    const onDelta = vi.fn()
    const onStatus = vi.fn()

    const pending = runNovelCandidateStreams({
      mode: 'continue',
      instruction: '继续',
      selection: '门开了。',
      context: [],
      signal: controller.signal,
      onDelta,
      onStatus,
    })
    await vi.waitFor(() => expect(onDelta).toHaveBeenCalledTimes(3))
    controller.abort('user stopped')
    const result = await pending

    expect(result).toEqual([
      { index: 0, text: '先', status: 'stopped' },
      { index: 1, text: '先', status: 'stopped' },
      { index: 2, text: '先', status: 'stopped' },
    ])
    expect(onStatus).toHaveBeenCalledWith(0, 'stopped')
    expect(onStatus).toHaveBeenCalledWith(1, 'stopped')
    expect(onStatus).toHaveBeenCalledWith(2, 'stopped')
  })

  it('reports every slot as failed when model configuration is missing', async () => {
    mockProviderGetState.mockReturnValue({
      selectedModel: null,
      selectedProvider: 'openai',
      getProviderByName: vi.fn(() => null),
    })
    const onStatus = vi.fn()

    const result = await runNovelCandidateStreams({
      mode: 'blueprint',
      instruction: '生成蓝图',
      selection: '',
      context: [],
      onDelta: vi.fn(),
      onStatus,
    })

    expect(result.every((value) => value.status === 'failed')).toBe(true)
    expect(onStatus).toHaveBeenCalledTimes(3)
    expect(mockCreateModel).not.toHaveBeenCalled()
  })
})

describe('buildNovelCandidatePrompt', () => {
  it('includes only enabled context and varies candidate flavor', () => {
    const first = buildNovelCandidatePrompt({
      mode: 'rewrite',
      instruction: '更克制',
      selection: '他握紧发簪。',
      context,
      candidateIndex: 0,
    })
    const second = buildNovelCandidatePrompt({
      mode: 'rewrite',
      instruction: '更克制',
      selection: '他握紧发簪。',
      context,
      candidateIndex: 1,
    })

    expect(first).toContain('沈砚')
    expect(first).not.toContain('第 70 章回收')
    expect(first).toContain('<selection>\n他握紧发簪。\n</selection>')
    expect(second).not.toBe(first)
  })
})
