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

const legacyGptImageModel = {
  id: 'gpt-image-1.5',
  capabilities: [ModelCapabilities.IMAGE_GENERATION],
} as Model

const geminiModel = {
  id: 'gemini-2.5-flash-image',
  capabilities: [ModelCapabilities.IMAGE_GENERATION],
} as Model

const seedreamModel = {
  id: 'doubao-seedream-4-5-251128',
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

  it('omits response_format for Biyuan image generation', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [{ b64_json: 'aGVsbG8=' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const service = new DefaultImageGenerationService()
    const result = await service.generateImages({
      provider: {
        ...provider,
        base_url: 'https://api.biyuan.ai/v1',
      },
      model,
      prompt: 'moonlit desk',
      ratio: '1:1',
      qualityPreset: 'hd',
      count: 1,
      mode: 'generate',
    })

    const init = fetchMock.mock.calls[0][1] as RequestInit & { body: string }
    expect(JSON.parse(init.body)).toMatchObject({
      model: 'gpt-image-2',
      prompt: 'moonlit desk',
      n: 1,
      size: '1024x1024',
      quality: 'high',
    })
    expect(JSON.parse(init.body)).not.toHaveProperty('response_format')
    expect(result[0].b64Json).toBe('aGVsbG8=')
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
      'https://api.jingxing.uk/v1/images/tasks/task_123'
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

  it('uses Jingxing chat completions for Gemini image generation models', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '![image](data:image/png;base64,aGVsbG8=)',
              },
            },
          ],
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
      'https://api.jingxing.uk/v1/chat/completions'
    )
    const init = fetchMock.mock.calls[0][1] as RequestInit & { body: string }
    expect(JSON.parse(init.body)).toMatchObject({
      model: 'gemini-2.5-flash-image',
      messages: [
        {
          role: 'user',
          content: expect.stringContaining('blue square'),
        },
      ],
    })
    expect(JSON.parse(init.body)).not.toHaveProperty('response_format')
    expect(result[0].b64Json).toBe('aGVsbG8=')
  })

  it('uses Jingxing chat completions with image_url parts for Gemini image edits', async () => {
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
            choices: [
              {
                message: {
                  content: '![image](data:image/jpeg;base64,ZWRpdA==)',
                },
              },
            ],
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
      prompt: 'make it glass',
      ratio: '1:1',
      qualityPreset: 'hd',
      count: 1,
      mode: 'edit',
      sourceAssets: [sourceAsset],
    })

    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://api.jingxing.uk/v1/chat/completions'
    )
    const init = fetchMock.mock.calls[1][1] as RequestInit & { body: string }
    const body = JSON.parse(init.body)
    expect(body).toMatchObject({
      model: 'gemini-2.5-flash-image',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: expect.stringContaining('make it glass'),
            },
            {
              type: 'image_url',
              image_url: {
                url: 'data:image/png;base64,AQID',
              },
            },
          ],
        },
      ],
    })
    expect(result[0]).toMatchObject({
      b64Json: 'ZWRpdA==',
      mimeType: 'image/jpeg',
    })
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

  it('keeps response_format for Jingxing non-gpt image edits', async () => {
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
      model: seedreamModel,
      prompt: 'make it glass',
      ratio: '1:1',
      qualityPreset: 'sd',
      count: 1,
      mode: 'edit',
      sourceAssets: [sourceAsset],
    })

    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://api.jingxing.uk/v1/images/edits/async'
    )
    const init = fetchMock.mock.calls[1][1] as RequestInit & { body: FormData }
    expect(init.body.get('model')).toBe('doubao-seedream-4-5-251128')
    expect(init.body.get('response_format')).toBe('b64_json')
  })

  it('omits response_format for Biyuan non-gpt image edits', async () => {
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
        base_url: 'https://api.biyuan.ai/v1',
      },
      model: seedreamModel,
      prompt: 'make it glass',
      ratio: '1:1',
      qualityPreset: 'sd',
      count: 1,
      mode: 'edit',
      sourceAssets: [sourceAsset],
    })

    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://api.biyuan.ai/v1/images/edits'
    )
    const init = fetchMock.mock.calls[1][1] as RequestInit & { body: FormData }
    expect(init.body.get('model')).toBe('doubao-seedream-4-5-251128')
    expect(init.body.get('response_format')).toBeNull()
  })

  it('preserves the reference asset MIME type when the local fetch omits it', async () => {
    const webpSourceAsset = {
      ...sourceAsset,
      path: 'asset://source.webp',
      fileName: 'source.webp',
      mimeType: 'image/webp',
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        blob: () => Promise.resolve(new Blob([new Uint8Array([1, 2, 3])])),
      } as Response)
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
      provider,
      model,
      prompt: 'make it white',
      ratio: '1:1',
      qualityPreset: 'sd',
      count: 1,
      mode: 'edit',
      sourceAssets: [webpSourceAsset],
    })

    const init = fetchMock.mock.calls[1][1] as RequestInit & { body: FormData }
    const uploaded = init.body.get('image') as File
    expect(uploaded.name).toBe('source.webp')
    expect(uploaded.type).toBe('image/webp')
  })

  it('uses the asset MIME type when the local fetch returns a generic blob type', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        blob: () =>
          Promise.resolve(
            new Blob([new Uint8Array([1, 2, 3])], {
              type: 'application/octet-stream',
            })
          ),
      } as Response)
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
      provider,
      model,
      prompt: 'make it white',
      ratio: '1:1',
      qualityPreset: 'sd',
      count: 1,
      mode: 'edit',
      sourceAssets: [sourceAsset],
    })

    const init = fetchMock.mock.calls[1][1] as RequestInit & { body: FormData }
    const uploaded = init.body.get('image') as File
    expect(uploaded.name).toBe('source.png')
    expect(uploaded.type).toBe('image/png')
  })

  it('uses standard gpt-image-2 edit sizes for Jingxing reference edits', async () => {
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
            id: 'task_edit_1',
            object: 'image.task',
            status: 'queued',
          }),
          { status: 202, headers: { 'content-type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'task_edit_1',
            object: 'image.task',
            status: 'succeeded',
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
      ratio: '2:3',
      qualityPreset: 'hd',
      count: 1,
      mode: 'edit',
      sourceAssets: [sourceAsset],
    })

    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://api.jingxing.uk/v1/images/edits/async'
    )
    expect(fetchMock.mock.calls[2][0]).toBe(
      'https://api.jingxing.uk/v1/images/tasks/task_edit_1'
    )
    const init = fetchMock.mock.calls[1][1] as RequestInit & { body: FormData }
    expect(init.body.get('model')).toBe('gpt-image-2')
    expect(init.body.get('size')).toBe('1024x1536')
    expect(init.body.get('quality')).toBe('medium')
    expect(init.body.get('response_format')).toBeNull()
  })

  it('keeps legacy Jingxing gpt-image-1.5 edit sizes for reference edits', async () => {
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
            id: 'task_edit_15',
            object: 'image.task',
            status: 'succeeded',
            data: [{ b64_json: 'ZWRpdA==' }],
          }),
          { status: 202, headers: { 'content-type': 'application/json' } }
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
      model: legacyGptImageModel,
      prompt: 'remove the background',
      ratio: '3:4',
      qualityPreset: 'hd',
      count: 1,
      mode: 'edit',
      sourceAssets: [sourceAsset],
    })

    const init = fetchMock.mock.calls[1][1] as RequestInit & { body: FormData }
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://api.jingxing.uk/v1/images/edits/async'
    )
    expect(init.body.get('model')).toBe('gpt-image-1.5')
    expect(init.body.get('size')).toBe('1024x1792')
    expect(init.body.get('quality')).toBe('medium')
    expect(init.body.get('response_format')).toBeNull()
  })

  it('uses Jingxing async edits for inferred variations with a default prompt', async () => {
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
            id: 'task_variation_1',
            object: 'image.task',
            status: 'queued',
          }),
          { status: 202, headers: { 'content-type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'task_variation_1',
            object: 'image.task',
            status: 'succeeded',
            data: [{ b64_json: 'dmFyaWF0aW9u' }],
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
      prompt: '',
      ratio: '1:1',
      qualityPreset: 'sd',
      count: 1,
      mode: 'variation',
      sourceAssets: [sourceAsset],
    })

    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://api.jingxing.uk/v1/images/edits/async'
    )
    expect(fetchMock.mock.calls[2][0]).toBe(
      'https://api.jingxing.uk/v1/images/tasks/task_variation_1'
    )
    const init = fetchMock.mock.calls[1][1] as RequestInit & { body: FormData }
    expect(init.body.get('prompt')).toBe(
      'Create a fresh variation of this image.'
    )
    expect(result[0].b64Json).toBe('dmFyaWF0aW9u')
  })

  it('appends multiple source assets as image[] and never appends a mask', async () => {
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
    expect(init.body.get('image')).toBeNull()
    expect(init.body.getAll('image[]')).toHaveLength(2)
    expect(init.body.get('mask')).toBeNull()
  })

  it('keeps image[] uploads when Jingxing multi-reference edits use async tasks', async () => {
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
            id: 'task_multi_1',
            object: 'image.task',
            status: 'succeeded',
            data: [{ b64_json: 'bXVsdGk=' }],
          }),
          { status: 202, headers: { 'content-type': 'application/json' } }
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
      prompt: 'combine references',
      ratio: '1:1',
      qualityPreset: 'sd',
      count: 1,
      mode: 'edit',
      sourceAssets: [sourceAsset, secondSourceAsset],
    })

    expect(fetchMock.mock.calls[2][0]).toBe(
      'https://api.jingxing.uk/v1/images/edits/async'
    )
    const init = fetchMock.mock.calls[2][1] as RequestInit & { body: FormData }
    expect(init.body.get('image')).toBeNull()
    expect(init.body.getAll('image[]')).toHaveLength(2)
    expect(init.body.get('mask')).toBeNull()
  })

  it('surfaces image rate limits as retryable request errors', async () => {
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
            error: {
              message: 'Too Many Requests: please wait and try again later.',
            },
          }),
          {
            status: 429,
            statusText: 'Too Many Requests',
            headers: {
              'content-type': 'application/json',
              'retry-after': '12',
            },
          }
        )
      )

    vi.stubGlobal('fetch', fetchMock)

    const service = new DefaultImageGenerationService()
    await expect(
      service.generateImages({
        provider: { ...provider, api_key_fallbacks: [] },
        model,
        prompt: 'make it glass',
        ratio: '1:1',
        qualityPreset: 'sd',
        count: 1,
        mode: 'edit',
        sourceAssets: [sourceAsset],
      })
    ).rejects.toMatchObject({
      name: 'ImageGenerationRequestError',
      kind: 'rate_limited',
      status: 429,
      retryAfterMs: 12_000,
    })
  })

  it('surfaces image gateway timeouts as retryable request errors', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        })
      )
      .mockResolvedValueOnce(
        new Response('<html>524: A timeout occurred</html>', {
          status: 524,
          statusText: 'A Timeout Occurred',
          headers: { 'content-type': 'text/html; charset=UTF-8' },
        })
      )

    vi.stubGlobal('fetch', fetchMock)

    const service = new DefaultImageGenerationService()
    await expect(
      service.generateImages({
        provider,
        model,
        prompt: 'make it glass',
        ratio: '1:1',
        qualityPreset: 'sd',
        count: 1,
        mode: 'edit',
        sourceAssets: [sourceAsset],
      })
    ).rejects.toMatchObject({
      name: 'ImageGenerationRequestError',
      kind: 'timeout',
      status: 524,
      retryAfterMs: 60_000,
    })
  })

  it('surfaces invalid reference image errors with the source image index', async () => {
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
            error: {
              message:
                'Invalid image file or mode for image 2, please check your image file.',
            },
          }),
          {
            status: 400,
            statusText: 'Bad Request',
            headers: { 'content-type': 'application/json' },
          }
        )
      )

    vi.stubGlobal('fetch', fetchMock)

    const service = new DefaultImageGenerationService()
    await expect(
      service.generateImages({
        provider,
        model,
        prompt: 'make it glass',
        ratio: '1:1',
        qualityPreset: 'sd',
        count: 1,
        mode: 'edit',
        sourceAssets: [sourceAsset],
      })
    ).rejects.toMatchObject({
      name: 'ImageGenerationRequestError',
      kind: 'invalid_source_image',
      status: 400,
      retryAfterMs: 0,
      sourceImageIndex: 2,
    })
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
      'https://api.jingxing.uk/v1/images/tasks/task_456/content/0'
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
