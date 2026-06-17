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
    })
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
