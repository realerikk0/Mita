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
  })
})
