import { afterEach, describe, expect, it, vi } from 'vitest'

import { ModelCapabilities } from '@/types/models'
import { DefaultStoryboardGenerationService } from '../default'

const provider = {
  provider: 'jingxing',
  base_url: 'https://api.jingxing.uk/v1',
  api_key: 'test-key',
  custom_header: [{ header: 'x-custom', value: 'yes' }],
  models: [],
  settings: [],
} as unknown as ModelProvider

const model = {
  id: 'gpt-5-mini',
  capabilities: [ModelCapabilities.COMPLETION],
} as Model

function sseResponse(parts: string[]) {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream({
      start(controller) {
        parts.forEach((part) => controller.enqueue(encoder.encode(part)))
        controller.close()
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } }
  )
}

describe('DefaultStoryboardGenerationService', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('breaks a story into structured shots through chat completions', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '```json\n{"shots":[{"title":"Wake","camera":"Slow push in","prompt":"A gold robot wakes in a neon city.","duration":4}],"storyboardPrompt":"Create a numbered storyboard sheet."}\n```',
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const service = new DefaultStoryboardGenerationService()
    const result = await service.breakdownStoryboard({
      provider,
      model,
      story: 'A gold robot wakes in a neon city.',
      style: 'Cinematic',
      aspect: '16:9',
      shotCount: 4,
      template: 'board',
      systemPrompt: 'Keep character identity consistent.',
      durationPerShot: 5,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.jingxing.uk/v1/chat/completions'
    )
    const init = fetchMock.mock.calls[0][1] as RequestInit & {
      headers: Record<string, string>
      body: string
    }
    expect(init.headers.Authorization).toBe('Bearer test-key')
    expect(init.headers['x-custom']).toBe('yes')
    expect(JSON.parse(init.body)).toMatchObject({
      model: 'gpt-5-mini',
      temperature: 0.4,
      stream: true,
    })
    expect(init.headers['X-Oneapi-Stream-Ping']).toBe('true')
    const body = JSON.parse(init.body)
    const userMessage = JSON.parse(body.messages[1].content)
    expect(userMessage.task).toContain('exactly 4 shots')
    expect(userMessage.schema.shots).toContain('Exactly 4')
    expect(userMessage.schema.storyboardPrompt).toContain('exactly 4')
    expect(userMessage.storyboardImageContract).toContain(
      'exactly 4 storyboard panels'
    )
    expect(result).toMatchObject({
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
  })

  it('collects split Biyuan SSE chunks and ignores ping comments', async () => {
    const resultJson = JSON.stringify({
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
    const splitAt = Math.floor(resultJson.length / 2)
    const firstChunk = `data: ${JSON.stringify({
      choices: [{ delta: { content: resultJson.slice(0, splitAt) } }],
    })}\n\n`
    const secondChunk = `data: ${JSON.stringify({
      choices: [{ delta: { content: resultJson.slice(splitAt) } }],
    })}\r\n\r\n`
    const wire = `: PING\n\n${firstChunk}: PING\r\n\r\n${secondChunk}data: [DONE]\n\n`
    const splitInsideFrame = Math.floor(firstChunk.length / 2)

    const fetchMock = vi.fn().mockResolvedValueOnce(
      sseResponse([
        wire.slice(0, splitInsideFrame),
        wire.slice(splitInsideFrame, splitInsideFrame + 7),
        wire.slice(splitInsideFrame + 7),
      ])
    )
    vi.stubGlobal('fetch', fetchMock)

    const service = new DefaultStoryboardGenerationService()
    const result = await service.breakdownStoryboard({
      provider,
      model,
      story: 'A gold robot wakes in a neon city.',
      style: 'Cinematic',
      aspect: '16:9',
      shotCount: 4,
      template: 'board',
      systemPrompt: 'Keep character identity consistent.',
      durationPerShot: 5,
    })

    expect(result).toMatchObject({
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
  })

  it('keeps non-Biyuan storyboard providers on the JSON response path', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  shots: [{ prompt: 'A quiet establishing shot.' }],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const service = new DefaultStoryboardGenerationService()
    await service.breakdownStoryboard({
      provider: {
        ...provider,
        provider: 'openai',
        base_url: 'https://api.openai.com/v1',
      },
      model,
      story: 'A quiet scene.',
      style: 'Cinematic',
      aspect: '16:9',
      shotCount: 1,
      template: 'board',
      systemPrompt: 'Keep character identity consistent.',
      durationPerShot: 5,
    })

    const init = fetchMock.mock.calls[0][1] as RequestInit & {
      headers: Record<string, string>
      body: string
    }
    expect(JSON.parse(init.body)).not.toHaveProperty('stream')
    expect(init.headers).not.toHaveProperty('X-Oneapi-Stream-Ping')
  })

  it('rejects a truncated Biyuan stream without a done event', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      sseResponse([
        `data: ${JSON.stringify({
          choices: [{ delta: { content: '{"shots":[' } }],
        })}\n\n`,
      ])
    )
    vi.stubGlobal('fetch', fetchMock)

    const service = new DefaultStoryboardGenerationService()
    await expect(
      service.breakdownStoryboard({
        provider,
        model,
        story: 'A gold robot wakes in a neon city.',
        style: 'Cinematic',
        aspect: '16:9',
        shotCount: 4,
        template: 'board',
        systemPrompt: 'Keep character identity consistent.',
        durationPerShot: 5,
      })
    ).rejects.toThrow('Storyboard breakdown stream ended before completion')
  })

  it('times out a Biyuan stream that only sends heartbeat comments', async () => {
    vi.useFakeTimers()
    const encoder = new TextEncoder()
    let pingCount = 0
    let requestSignal: AbortSignal | undefined

    const fetchMock = vi.fn().mockImplementation(
      async (_endpoint: string, init: RequestInit) =>
        new Response(
          new ReadableStream({
            start(controller) {
              requestSignal = init.signal || undefined
              const pingTimer = setInterval(() => {
                pingCount += 1
                controller.enqueue(encoder.encode(': PING\n\n'))
              }, 10_000)
              requestSignal?.addEventListener(
                'abort',
                () => {
                  clearInterval(pingTimer)
                  controller.error(requestSignal?.reason)
                },
                { once: true }
              )
            },
          }),
          { status: 200, headers: { 'content-type': 'text/event-stream' } }
        )
    )
    vi.stubGlobal('fetch', fetchMock)

    const service = new DefaultStoryboardGenerationService()
    const pending = service.breakdownStoryboard({
      provider,
      model,
      story: 'A gold robot wakes in a neon city.',
      style: 'Cinematic',
      aspect: '16:9',
      shotCount: 4,
      template: 'board',
      systemPrompt: 'Keep character identity consistent.',
      durationPerShot: 5,
    })
    const rejected = expect(pending).rejects.toThrow(
      'Storyboard breakdown timed out after 4 minutes'
    )

    await vi.advanceTimersByTimeAsync(4 * 60 * 1000)
    await rejected

    expect(pingCount).toBeGreaterThan(0)
    expect(requestSignal?.aborted).toBe(true)
  })

  it('clears the Biyuan deadline after a completed stream', async () => {
    vi.useFakeTimers()
    const resultJson = JSON.stringify({
      shots: [{ prompt: 'A quiet establishing shot.' }],
    })
    const fetchMock = vi.fn().mockResolvedValueOnce(
      sseResponse([
        `data: ${JSON.stringify({
          choices: [{ delta: { content: resultJson } }],
        })}\n\n`,
        'data: [DONE]\n\n',
      ])
    )
    vi.stubGlobal('fetch', fetchMock)

    const service = new DefaultStoryboardGenerationService()
    await service.breakdownStoryboard({
      provider,
      model,
      story: 'A quiet scene.',
      style: 'Cinematic',
      aspect: '16:9',
      shotCount: 1,
      template: 'board',
      systemPrompt: 'Keep character identity consistent.',
      durationPerShot: 5,
    })

    expect(vi.getTimerCount()).toBe(0)
  })

  it('asks for a plain image prompt without storyboard layout instructions', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '{"shots":[{"title":"Wake","camera":"Slow push in","prompt":"A gold robot wakes in a neon city.","duration":4}],"storyboardPrompt":"A gold robot wakes in a neon city, cinematic lighting."}',
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const service = new DefaultStoryboardGenerationService()
    await service.breakdownStoryboard({
      provider,
      model,
      story: 'A gold robot wakes in a neon city.',
      style: 'Cinematic',
      aspect: '16:9',
      shotCount: 4,
      template: 'plain',
      systemPrompt: 'Keep character identity consistent.',
      durationPerShot: 5,
    })

    const init = fetchMock.mock.calls[0][1] as RequestInit & {
      body: string
    }
    const body = JSON.parse(init.body)
    const userMessage = JSON.parse(body.messages[1].content)

    expect(userMessage.task).toContain('single plain image')
    expect(userMessage.task).toContain('Do not add storyboard layout')
    expect(userMessage.task).not.toContain('numbered storyboard sheet')
    expect(userMessage.schema.storyboardPrompt).toContain('no extra layout')
    expect(userMessage).not.toHaveProperty('storyboardImageContract')
  })

  it('uses the same normalized fractional shot count in prompts and parsing', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  shots: [
                    {
                      title: 'One',
                      camera: 'Wide',
                      prompt: 'First beat.',
                    },
                    {
                      title: 'Two',
                      camera: 'Push in',
                      prompt: 'Second beat.',
                    },
                    {
                      title: 'Three',
                      camera: 'Close up',
                      prompt: 'Third beat.',
                    },
                    {
                      title: 'Four',
                      camera: 'Orbit',
                      prompt: 'Fourth beat.',
                    },
                  ],
                  storyboardPrompt: 'Create exactly three panels.',
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const service = new DefaultStoryboardGenerationService()
    const result = await service.breakdownStoryboard({
      provider,
      model,
      story: 'Four beats.',
      style: 'Cinematic',
      aspect: '16:9',
      shotCount: 2.6,
      template: 'board',
      systemPrompt: 'Keep character identity consistent.',
      durationPerShot: 5,
    })

    const init = fetchMock.mock.calls[0][1] as RequestInit & {
      body: string
    }
    const body = JSON.parse(init.body)
    const userMessage = JSON.parse(body.messages[1].content)

    expect(userMessage.task).toContain('exactly 3 shots')
    expect(userMessage.shotCount).toBe(3)
    expect(result.shots).toHaveLength(3)
    expect(result.shots.map((shot) => shot.title)).toEqual([
      'One',
      'Two',
      'Three',
    ])
  })

  it('falls back to one shot when the requested shot count is not finite', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  shots: [
                    {
                      title: 'One',
                      camera: 'Wide',
                      prompt: 'First beat.',
                    },
                    {
                      title: 'Two',
                      camera: 'Push in',
                      prompt: 'Second beat.',
                    },
                  ],
                  storyboardPrompt: 'Create one panel.',
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const service = new DefaultStoryboardGenerationService()
    const result = await service.breakdownStoryboard({
      provider,
      model,
      story: 'Two beats.',
      style: 'Cinematic',
      aspect: '16:9',
      shotCount: Number.NaN,
      template: 'board',
      systemPrompt: 'Keep character identity consistent.',
      durationPerShot: 5,
    })

    const init = fetchMock.mock.calls[0][1] as RequestInit & {
      body: string
    }
    const body = JSON.parse(init.body)
    const userMessage = JSON.parse(body.messages[1].content)

    expect(userMessage.task).toContain('exactly 1 shots')
    expect(userMessage.storyboardImageContract).not.toContain('NaN')
    expect(userMessage.shotCount).toBe(1)
    expect(result.shots).toHaveLength(1)
  })
})
