import { afterEach, describe, expect, it, vi } from 'vitest'

import { DefaultImageGenerationService } from '@/services/image-generation/default'
import { ProviderQuotaError } from '@/lib/provider-quota-error'
import { ModelCapabilities } from '@/types/models'

const provider = {
  provider: 'openai-compatible',
  base_url: 'https://api.example.test/v1',
  api_key: 'bad-key',
  api_key_fallbacks: ['good-key'],
  custom_header: [{ header: 'x-custom', value: 'yes' }],
  models: [],
  settings: [],
} as unknown as ModelProvider

const model = {
  id: 'gpt-image-2',
  capabilities: [ModelCapabilities.IMAGE_GENERATION],
} as Model

const geminiModel = {
  id: 'gemini-2.5-flash-image',
  capabilities: [ModelCapabilities.IMAGE_GENERATION],
} as Model

const sourceAsset = {
  id: 'asset-1',
  prompt: 'source image',
  mode: 'generate',
  provider: 'openai-compatible',
  model: 'gpt-image-2',
  ratio: '1:1',
  size: '1024x1024',
  quality: 'high',
  sourceAssetIds: [],
  createdAt: '2026-05-11T00:00:00Z',
  status: 'succeeded',
  path: 'asset://source.png',
  fileName: 'source.png',
  mimeType: 'image/png',
} as const

const quotaResponse = () =>
  new Response(
    JSON.stringify({
      error: {
        message: '该令牌额度已用尽',
        type: 'new_api_error',
        code: 'pre_consume_token_quota_failed',
        metadata: {
          quota_error: true,
          recharge_url: 'https://api.jingxing.uk/console/topup',
          token_url: 'https://api.jingxing.uk/console/token',
        },
      },
    }),
    { status: 403, headers: { 'content-type': 'application/json' } }
  )

describe('DefaultImageGenerationService', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('posts generation requests to the provider endpoint with key fallback', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('nope', { status: 401 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ b64_json: 'aGVsbG8=', revised_prompt: 'hello' }],
            usage: { total_tokens: 10 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )

    vi.stubGlobal('fetch', fetchMock)

    const service = new DefaultImageGenerationService()
    const result = await service.generateImages({
      provider,
      model,
      prompt: 'moonlit desk',
      ratio: '1:1',
      qualityPreset: 'hd',
      count: 2,
      mode: 'generate',
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.example.test/v1/images/generations'
    )
    const retryInit = fetchMock.mock.calls[1][1] as RequestInit & {
      headers: Record<string, string>
      body: string
    }
    expect(retryInit.headers.Authorization).toBe('Bearer good-key')
    expect(retryInit.headers['x-custom']).toBe('yes')
    expect(JSON.parse(retryInit.body)).toMatchObject({
      model: 'gpt-image-2',
      prompt: 'moonlit desk',
      n: 2,
      size: '1024x1024',
      quality: 'high',
      response_format: 'b64_json',
    })
    expect(result).toEqual([
      {
        b64Json: 'aGVsbG8=',
        mimeType: 'image/png',
        revisedPrompt: 'hello',
        usage: { total_tokens: 10 },
      },
    ])
  })

  it('stops generation key fallback when provider reports quota exhaustion', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(quotaResponse())

    vi.stubGlobal('fetch', fetchMock)

    const service = new DefaultImageGenerationService()
    await expect(
      service.generateImages({
        provider,
        model,
        prompt: 'moonlit desk',
        ratio: '1:1',
        qualityPreset: 'hd',
        count: 1,
        mode: 'generate',
      })
    ).rejects.toBeInstanceOf(ProviderQuotaError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('uses Jingxing async image tasks and polls the task result', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'task_123',
            object: 'image.task',
            status: 'queued',
            progress: '20%',
          }),
          { status: 202, headers: { 'content-type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'task_123',
            object: 'image.task',
            status: 'succeeded',
            data: [{ b64_json: 'aGVsbG8=', revised_prompt: 'hello' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )

    vi.stubGlobal('fetch', fetchMock)

    const service = new DefaultImageGenerationService()
    const result = await service.generateImages({
      provider: {
        ...provider,
        provider: 'jingxing',
        base_url: 'https://api.jingxing.uk/v1',
      },
      model,
      prompt: 'moonlit desk',
      ratio: '16:9',
      qualityPreset: 'sd',
      count: 1,
      mode: 'generate',
    })

    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.jingxing.uk/v1/images/generations/async'
    )
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://api.jingxing.uk/v1/images/generations/tasks/task_123'
    )
    const init = fetchMock.mock.calls[0][1] as RequestInit & { body: string }
    expect(JSON.parse(init.body)).toMatchObject({
      model: 'gpt-image-2',
      prompt: 'moonlit desk',
      n: 1,
      size: '1536x1024',
      quality: 'medium',
    })
    expect(result).toEqual([
      {
        b64Json: 'aGVsbG8=',
        mimeType: 'image/png',
        revisedPrompt: 'hello',
        usage: undefined,
      },
    ])
  })

  it('uses Jingxing synchronous generations endpoint for Gemini image models', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [{ b64_json: 'aGVsbG8=', revised_prompt: 'hello' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )

    vi.stubGlobal('fetch', fetchMock)

    const service = new DefaultImageGenerationService()
    const result = await service.generateImages({
      provider: {
        ...provider,
        provider: 'jingxing',
        base_url: 'https://api.jingxing.uk/v1',
      },
      model: geminiModel,
      prompt: 'blue square',
      ratio: '1:1',
      qualityPreset: 'sd',
      count: 1,
      mode: 'generate',
    })

    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.jingxing.uk/v1/images/generations'
    )
    const init = fetchMock.mock.calls[0][1] as RequestInit & { body: string }
    expect(JSON.parse(init.body)).toMatchObject({
      model: 'gemini-2.5-flash-image',
      prompt: 'blue square',
      n: 1,
      size: '1024x1024',
      quality: 'medium',
    })
    expect(JSON.parse(init.body)).not.toHaveProperty('response_format')
    expect(result[0].b64Json).toBe('aGVsbG8=')
  })

  it('posts edit requests to the edits endpoint with a source asset', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ b64_json: 'ZWRpdA==' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )

    vi.stubGlobal('fetch', fetchMock)

    const service = new DefaultImageGenerationService()
    const result = await service.generateImages({
      provider,
      model,
      prompt: 'make it glass',
      ratio: '1:1',
      qualityPreset: 'sd',
      count: 1,
      mode: 'edit',
      sourceAssets: [sourceAsset],
    })

    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://api.example.test/v1/images/edits'
    )
    const init = fetchMock.mock.calls[1][1] as RequestInit & { body: FormData }
    expect(init.body.get('model')).toBe('gpt-image-2')
    expect(init.body.get('prompt')).toBe('make it glass')
    expect(init.body.get('size')).toBe('1024x1024')
    expect(init.body.get('quality')).toBe('medium')
    expect(init.body.get('response_format')).toBeNull()
    expect(init.body.get('image')).toBeTruthy()
    expect(result[0].b64Json).toBe('ZWRpdA==')
  })

  it('uses Jingxing-compatible gpt-image edit params for reference edits', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ b64_json: 'ZWRpdA==' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )

    vi.stubGlobal('fetch', fetchMock)

    const service = new DefaultImageGenerationService()
    await service.generateImages({
      provider: {
        ...provider,
        provider: 'jingxing',
        base_url: 'https://api.jingxing.uk/v1',
      },
      model,
      prompt: 'remove the background',
      ratio: '3:4',
      qualityPreset: 'hd',
      count: 1,
      mode: 'edit',
      sourceAssets: [sourceAsset],
    })

    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://api.jingxing.uk/v1/images/edits'
    )
    const init = fetchMock.mock.calls[1][1] as RequestInit & { body: FormData }
    expect(init.body.get('model')).toBe('gpt-image-2')
    expect(init.body.get('size')).toBe('1024x1792')
    expect(init.body.get('quality')).toBe('medium')
    expect(init.body.get('response_format')).toBeNull()
  })

  it('appends every source asset as image and never appends a mask', async () => {
    const secondSourceAsset = {
      ...sourceAsset,
      id: 'asset-2',
      path: 'asset://second.png',
      fileName: 'second.png',
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        })
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([4, 5, 6]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ b64_json: 'bXVsdGk=' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )

    vi.stubGlobal('fetch', fetchMock)

    const service = new DefaultImageGenerationService()
    await service.generateImages({
      provider,
      model,
      prompt: 'combine references',
      ratio: '1:1',
      qualityPreset: 'sd',
      count: 1,
      mode: 'edit',
      sourceAssets: [sourceAsset, secondSourceAsset],
    })

    const init = fetchMock.mock.calls[2][1] as RequestInit & { body: FormData }
    expect(init.body.getAll('image')).toHaveLength(2)
    expect(init.body.get('mask')).toBeNull()
  })

  it('falls back from variations to edits when variations are unsupported', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'unsupported' } }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ b64_json: 'dmFyaWF0aW9u' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )

    vi.stubGlobal('fetch', fetchMock)

    const service = new DefaultImageGenerationService()
    const result = await service.generateImages({
      provider,
      model,
      prompt: '',
      ratio: '1:1',
      qualityPreset: 'sd',
      count: 1,
      mode: 'variation',
      sourceAssets: [sourceAsset],
    })

    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://api.example.test/v1/images/variations'
    )
    expect(fetchMock.mock.calls[3][0]).toBe(
      'https://api.example.test/v1/images/edits'
    )
    const fallbackInit = fetchMock.mock.calls[3][1] as RequestInit & {
      body: FormData
    }
    expect(fallbackInit.body.get('prompt')).toBe(
      'Create a fresh variation of this image.'
    )
    expect(result[0].b64Json).toBe('dmFyaWF0aW9u')
  })

  it('does not fall back from variations to edits on quota exhaustion', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        })
      )
      .mockResolvedValueOnce(quotaResponse())

    vi.stubGlobal('fetch', fetchMock)

    const service = new DefaultImageGenerationService()
    await expect(
      service.generateImages({
        provider,
        model,
        prompt: '',
        ratio: '1:1',
        qualityPreset: 'sd',
        count: 1,
        mode: 'variation',
        sourceAssets: [sourceAsset],
      })
    ).rejects.toBeInstanceOf(ProviderQuotaError)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('surfaces quota exhaustion while polling Jingxing async tasks', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'task_123',
            object: 'image.task',
            status: 'queued',
          }),
          { status: 202, headers: { 'content-type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(quotaResponse())

    vi.stubGlobal('fetch', fetchMock)

    const service = new DefaultImageGenerationService()
    await expect(
      service.generateImages({
        provider: {
          ...provider,
          provider: 'jingxing',
          base_url: 'https://api.jingxing.uk/v1',
        },
        model,
        prompt: 'moon',
        ratio: '1:1',
        qualityPreset: 'sd',
        count: 1,
        mode: 'generate',
      })
    ).rejects.toBeInstanceOf(ProviderQuotaError)
  })

  it('downloads url image responses and converts them to base64', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: [{ url: 'https://cdn.example/image.png' }] }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        })
      )

    vi.stubGlobal('fetch', fetchMock)

    const service = new DefaultImageGenerationService()
    const result = await service.generateImages({
      provider: { ...provider, api_key: 'good-key', api_key_fallbacks: [] },
      model,
      prompt: 'moon',
      ratio: '3:2',
      qualityPreset: 'sd',
      count: 1,
      mode: 'generate',
    })

    expect(fetchMock.mock.calls[1][0]).toBe('https://cdn.example/image.png')
    expect(result[0].mimeType).toBe('image/png')
    expect(result[0].b64Json).toBe('AQID')
  })

  it('reports async image task responses clearly when no image data is present', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'task_123',
          object: 'image.task',
          status: 'queued',
          progress: '20%',
        }),
        { status: 202, headers: { 'content-type': 'application/json' } }
      )
    )

    vi.stubGlobal('fetch', fetchMock)

    const service = new DefaultImageGenerationService()
    await expect(
      service.generateImages({
        provider: {
          ...provider,
          provider: 'openai-compatible',
          base_url: 'https://api.example.test/v1',
        },
        model,
        prompt: 'moon',
        ratio: '1:1',
        qualityPreset: 'sd',
        count: 1,
        mode: 'generate',
      })
    ).rejects.toThrow(/async image task task_123 \(queued\) at 20%/)
  })

  it('downloads Jingxing task content when a succeeded task has no data payload', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'task_456',
            object: 'image.task',
            status: 'queued',
          }),
          { status: 202, headers: { 'content-type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'task_456',
            object: 'image.task',
            status: 'succeeded',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        })
      )

    vi.stubGlobal('fetch', fetchMock)

    const service = new DefaultImageGenerationService()
    const result = await service.generateImages({
      provider: {
        ...provider,
        provider: 'jingxing',
        base_url: 'https://api.jingxing.uk/v1',
      },
      model,
      prompt: 'moon',
      ratio: '1:1',
      qualityPreset: 'sd',
      count: 1,
      mode: 'generate',
    })

    expect(fetchMock.mock.calls[2][0]).toBe(
      'https://api.jingxing.uk/v1/images/generations/tasks/task_456/content/0'
    )
    expect(result[0].mimeType).toBe('image/png')
    expect(result[0].b64Json).toBe('AQID')
  })

  it('rejects local image imports outside the desktop app', async () => {
    const service = new DefaultImageGenerationService()

    await expect(
      service.importAsset({
        id: 'local-ref-1',
        sourcePath: '/tmp/ref.png',
      })
    ).rejects.toThrow(/desktop app/)
  })
})
