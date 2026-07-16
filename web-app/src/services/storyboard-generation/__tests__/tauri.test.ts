import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}))

import { fetch as fetchTauri } from '@tauri-apps/plugin-http'
import { ModelCapabilities } from '@/types/models'
import { TauriStoryboardGenerationService } from '../tauri'

const provider = {
  provider: 'biyuan',
  base_url: 'https://api.biyuan.ai/v1',
  api_key: 'test-key',
  models: [],
  settings: [],
} as unknown as ModelProvider

const model = {
  id: 'gpt-5-mini',
  capabilities: [ModelCapabilities.COMPLETION],
} as Model

describe('TauriStoryboardGenerationService', () => {
  beforeEach(() => {
    vi.mocked(fetchTauri).mockReset()
    vi.unstubAllGlobals()
  })

  it('reads a Biyuan storyboard stream through the Tauri HTTP client', async () => {
    const encoder = new TextEncoder()
    const content = JSON.stringify({
      shots: [
        {
          title: 'Wake',
          camera: 'Slow push in',
          prompt: 'A gold robot wakes in a neon city.',
          duration: 4,
        },
      ],
      storyboardPrompt: 'Create a numbered storyboard sheet.',
    })
    const splitAt = Math.floor(content.length / 2)
    const wire = [
      ': PING\n\n',
      `data: ${JSON.stringify({
        choices: [{ delta: { content: content.slice(0, splitAt) } }],
      })}\n\n`,
      ': PING\n\n',
      `data: ${JSON.stringify({
        choices: [
          {
            delta: { content: content.slice(splitAt) },
            finish_reason: 'stop',
          },
        ],
      })}\n\n`,
      'data: [DONE]\n\n',
    ]

    vi.mocked(fetchTauri).mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            wire.forEach((part) => controller.enqueue(encoder.encode(part)))
            controller.close()
          },
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } }
      )
    )
    const webviewFetch = vi.fn()
    vi.stubGlobal('fetch', webviewFetch)

    const service = new TauriStoryboardGenerationService()
    const result = await service.breakdownStoryboard({
      provider,
      model,
      story: 'A gold robot wakes in a neon city.',
      style: 'Cinematic',
      aspect: '16:9',
      shotCount: 1,
      template: 'board',
      systemPrompt: 'Keep character identity consistent.',
      durationPerShot: 5,
    })

    expect(webviewFetch).not.toHaveBeenCalled()
    expect(fetchTauri).toHaveBeenCalledTimes(1)
    const init = vi.mocked(fetchTauri).mock.calls[0][1] as RequestInit & {
      headers: Record<string, string>
      body: string
    }
    expect(init.headers['X-Oneapi-Stream-Ping']).toBe('true')
    expect(JSON.parse(init.body).stream).toBe(true)
    expect(result.storyboardPrompt).toBe(
      'Create a numbered storyboard sheet.'
    )
    expect(result.shots[0]?.prompt).toBe(
      'A gold robot wakes in a neon city.'
    )
  })
})
