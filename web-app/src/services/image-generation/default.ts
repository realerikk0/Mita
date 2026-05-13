import {
  apiQualityForImageEditPreset,
  apiQualityForPreset,
  arrayBufferToBase64,
  imageEditSizeForRatio,
  imageFileExtension,
  imageSizeForRatio,
  isJingxingImageProvider,
  isGptImageModel,
  parseDataUrl,
} from '@/lib/image-generation'
import { providerRemoteApiKeyChain } from '@/lib/provider-api-keys'
import type {
  ImageApiImage,
  ImageAssetRecord,
  ImageGenerationRequest,
  ImageGenerationService,
  ImportImageAssetRequest,
  SaveImageAssetRequest,
} from './types'

type RawImageItem = {
  b64_json?: string
  url?: string
  revised_prompt?: string
}

type RawImageItemContainer =
  | RawImageItem[]
  | {
      data?: RawImageItem[]
      images?: RawImageItem[]
      b64_json?: string
      url?: string
      revised_prompt?: string
    }

type RawImageResponse = {
  data?: RawImageItem[]
  images?: RawImageItem[]
  b64_json?: string
  url?: string
  revised_prompt?: string
  output?: RawImageItemContainer
  result?: RawImageItemContainer
  usage?: unknown
  id?: string
  object?: string
  status?: string
  progress?: string
  error?: { message?: string } | string
  message?: string
}

type JsonResponseResult = {
  json: RawImageResponse
  apiKey?: string
}

const RETRYABLE_KEY_STATUSES = [401, 403, 429]
const JINGXING_TASK_POLL_INTERVAL_MS = 2500
const JINGXING_TASK_TIMEOUT_MS = 180_000

export class DefaultImageGenerationService implements ImageGenerationService {
  protected fetch(): typeof globalThis.fetch {
    return globalThis.fetch.bind(globalThis)
  }

  protected fileSrc(path: string): string {
    return path
  }

  async generateImages(request: ImageGenerationRequest): Promise<ImageApiImage[]> {
    const endpoint = this.endpointForMode(request)
    if (request.mode === 'generate') {
      const { json, apiKey } = await this.postJson(
        endpoint,
        request,
        this.generationBody(request)
      )
      const response = this.shouldPollJingxingImageTask(request, json)
        ? await this.pollJingxingImageTask(request, json, apiKey)
        : json
      return this.parseImageResponse(response, request, apiKey)
    }

    const response = await this.postForm(endpoint, request)
    return this.parseImageResponse(response, request)
  }

  async saveAsset(request: SaveImageAssetRequest): Promise<ImageAssetRecord> {
    return {
      ...request,
      createdAt: request.createdAt ?? new Date().toISOString(),
      fileName: `${request.id}.${request.extension ?? imageFileExtension(request.mimeType)}`,
      path: '',
      assetKind: request.assetKind ?? 'generated',
    }
  }

  async importAsset(
    _request: ImportImageAssetRequest
  ): Promise<ImageAssetRecord> {
    throw new Error('Image asset import is only available in the desktop app')
  }

  async listAssets(): Promise<ImageAssetRecord[]> {
    return []
  }

  async deleteAsset(_assetId: string): Promise<void> {
    return
  }

  private endpointForMode(request: ImageGenerationRequest) {
    const baseUrl = request.provider.base_url || 'https://api.openai.com/v1'
    const normalizedBase = baseUrl.replace(/\/$/, '')
    const endpoint =
      request.mode === 'generate'
        ? this.shouldUseJingxingAsyncGeneration(request)
          ? '/images/generations/async'
          : '/images/generations'
        : request.mode === 'variation'
          ? '/images/variations'
          : '/images/edits'
    return `${normalizedBase}${endpoint}`
  }

  private generationBody(request: ImageGenerationRequest) {
    const body: Record<string, unknown> = {
      model: request.model.id,
      prompt: request.prompt,
      n: request.count,
      size: imageSizeForRatio(request.ratio, request.model.id),
      quality: apiQualityForPreset(request.qualityPreset, request.model.id),
    }

    if (!this.isJingxingProvider(request.provider)) {
      body.response_format = 'b64_json'
    }

    return body
  }

  private isJingxingProvider(provider: ModelProvider) {
    return isJingxingImageProvider(provider.provider, provider.base_url)
  }

  private isJingxingGeminiImageModel(model: Model) {
    return model.id.toLowerCase().startsWith('gemini-')
  }

  private shouldUseJingxingAsyncGeneration(request: ImageGenerationRequest) {
    return (
      this.isJingxingProvider(request.provider) &&
      !this.isJingxingGeminiImageModel(request.model)
    )
  }

  private baseHeaders(provider: ModelProvider, apiKey?: string) {
    const headers: Record<string, string> = {}

    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`
      headers['x-api-key'] = apiKey
    }

    if (
      provider.base_url?.includes('localhost:') ||
      provider.base_url?.includes('127.0.0.1:')
    ) {
      headers.Origin = 'tauri://localhost'
    }

    provider.custom_header?.forEach((customHeader) => {
      headers[customHeader.header] = customHeader.value
    })

    return headers
  }

  private async postJson(
    endpoint: string,
    request: ImageGenerationRequest,
    body: Record<string, unknown>
  ): Promise<JsonResponseResult> {
    const fetchImpl = this.fetch()
    const attempts = this.apiKeyAttempts(request.provider)

    for (let index = 0; index < attempts.length; index++) {
      const apiKey = attempts[index]
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.baseHeaders(request.provider, apiKey),
        },
        body: JSON.stringify(body),
        signal: request.signal,
      })

      if (
        RETRYABLE_KEY_STATUSES.includes(response.status) &&
        index < attempts.length - 1
      ) {
        await response.body?.cancel()
        continue
      }

      if (!response.ok) {
        throw new Error(await this.errorMessage(response))
      }

      return {
        json: (await response.json()) as RawImageResponse,
        apiKey,
      }
    }

    throw new Error('Image generation API key rotation exhausted')
  }

  private async getJson(
    endpoint: string,
    request: ImageGenerationRequest,
    preferredApiKey?: string
  ): Promise<JsonResponseResult> {
    const fetchImpl = this.fetch()
    const attempts = this.apiKeyAttempts(request.provider, preferredApiKey)

    for (let index = 0; index < attempts.length; index++) {
      const apiKey = attempts[index]
      let response: Response
      try {
        response = await fetchImpl(endpoint, {
          method: 'GET',
          headers: this.baseHeaders(request.provider, apiKey),
          signal: request.signal,
        })
      } catch (error) {
        if (index < attempts.length - 1) continue
        throw error
      }

      if (
        RETRYABLE_KEY_STATUSES.includes(response.status) &&
        index < attempts.length - 1
      ) {
        await response.body?.cancel()
        continue
      }

      if (!response.ok) {
        throw new Error(await this.errorMessage(response))
      }

      return {
        json: (await response.json()) as RawImageResponse,
        apiKey,
      }
    }

    throw new Error('Image generation API key rotation exhausted')
  }

  private async postForm(endpoint: string, request: ImageGenerationRequest) {
    const form = await this.imageFormData(request)

    try {
      return await this.postFormWithKeys(endpoint, request, form)
    } catch (error) {
      if (request.mode !== 'variation') throw error
      const fallback = endpoint.replace('/images/variations', '/images/edits')
      const fallbackRequest = request.prompt.trim()
        ? request
        : { ...request, prompt: 'Create a fresh variation of this image.' }
      return this.postFormWithKeys(
        fallback,
        request,
        await this.imageFormData(fallbackRequest)
      )
    }
  }

  private async imageFormData(request: ImageGenerationRequest) {
    const form = new FormData()
    form.append('model', request.model.id)
    if (request.prompt.trim()) form.append('prompt', request.prompt.trim())
    form.append('n', String(request.count))
    form.append(
      'size',
      imageEditSizeForRatio(
        request.ratio,
        request.model.id,
        request.provider.provider,
        request.provider.base_url
      )
    )
    form.append(
      'quality',
      apiQualityForImageEditPreset(
        request.qualityPreset,
        request.model.id,
        request.provider.provider,
        request.provider.base_url
      )
    )
    if (!isGptImageModel(request.model.id)) {
      form.append('response_format', 'b64_json')
    }

    for (const sourceAsset of request.sourceAssets ?? []) {
      const blob = await this.assetToBlob(sourceAsset)
      form.append(
        'image',
        blob,
        sourceAsset.fileName || `source.${imageFileExtension(blob.type)}`
      )
    }

    return form
  }

  private async postFormWithKeys(
    endpoint: string,
    request: ImageGenerationRequest,
    body: FormData
  ) {
    const fetchImpl = this.fetch()
    const attempts = this.apiKeyAttempts(request.provider)

    for (let index = 0; index < attempts.length; index++) {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: this.baseHeaders(request.provider, attempts[index]),
        body,
        signal: request.signal,
      })

      if (
        RETRYABLE_KEY_STATUSES.includes(response.status) &&
        index < attempts.length - 1
      ) {
        await response.body?.cancel()
        continue
      }

      if (!response.ok) {
        throw new Error(await this.errorMessage(response))
      }

      return (await response.json()) as RawImageResponse
    }

    throw new Error('Image generation API key rotation exhausted')
  }

  private async assetToBlob(asset: ImageAssetRecord) {
    const response = await fetch(this.fileSrc(asset.path))
    if (!response.ok) {
      throw new Error(`Unable to read source image ${asset.fileName}`)
    }
    const blob = (await response.blob()) as unknown
    if (blob instanceof Blob) return blob

    const foreignBlob = blob as {
      arrayBuffer: () => Promise<ArrayBuffer>
      type?: string
    }

    return new Blob([await foreignBlob.arrayBuffer()], {
      type: foreignBlob.type || asset.mimeType,
    })
  }

  private shouldPollJingxingImageTask(
    request: ImageGenerationRequest,
    response: RawImageResponse
  ) {
    return (
      request.mode === 'generate' &&
      this.isJingxingProvider(request.provider) &&
      response.object === 'image.task' &&
      Boolean(response.id) &&
      this.imageItemsFromResponse(response).length === 0
    )
  }

  private async pollJingxingImageTask(
    request: ImageGenerationRequest,
    initialResponse: RawImageResponse,
    apiKey?: string
  ) {
    const taskId = initialResponse.id
    if (!taskId) return initialResponse

    const taskEndpoint = this.jingxingTaskEndpoint(request, taskId)
    const startedAt = Date.now()
    let currentApiKey = apiKey

    while (Date.now() - startedAt <= JINGXING_TASK_TIMEOUT_MS) {
      this.throwIfAborted(request.signal)
      let result: JsonResponseResult
      try {
        result = await this.getJson(taskEndpoint, request, currentApiKey)
      } catch (error) {
        if (this.isAbortError(error)) throw error
        await this.sleep(JINGXING_TASK_POLL_INTERVAL_MS, request.signal)
        continue
      }
      currentApiKey = result.apiKey
      const response = result.json
      const status = response.status?.toLowerCase()

      if (this.imageItemsFromResponse(response).length > 0) {
        return response
      }

      if (status === 'succeeded') {
        const contentItems = await this.fetchJingxingTaskContents(
          request,
          taskId,
          currentApiKey
        )
        if (contentItems.length > 0) {
          return {
            ...response,
            data: contentItems,
          }
        }
        throw new Error(
          `Image task ${taskId} succeeded but did not include image data`
        )
      }

      if (status === 'failed') {
        throw new Error(this.imageTaskFailureMessage(taskId, response))
      }

      await this.sleep(JINGXING_TASK_POLL_INTERVAL_MS, request.signal)
    }

    throw new Error(
      `Image task ${taskId} did not finish within ${JINGXING_TASK_TIMEOUT_MS / 1000}s`
    )
  }

  private jingxingTaskEndpoint(request: ImageGenerationRequest, taskId: string) {
    const baseUrl = request.provider.base_url || 'https://api.jingxing.uk/v1'
    return `${baseUrl.replace(/\/$/, '')}/images/generations/tasks/${encodeURIComponent(taskId)}`
  }

  private async fetchJingxingTaskContents(
    request: ImageGenerationRequest,
    taskId: string,
    apiKey?: string
  ) {
    const items: RawImageItem[] = []
    const taskEndpoint = this.jingxingTaskEndpoint(request, taskId)

    for (let index = 0; index < request.count; index++) {
      const response = await this.getBinary(
        `${taskEndpoint}/content/${index}`,
        request,
        apiKey
      )

      if (!response) {
        if (index === 0) return []
        break
      }

      const mimeType =
        response.headers.get('content-type')?.split(';')[0] || 'image/png'
      const b64Json = await arrayBufferToBase64(await response.arrayBuffer())
      items.push({
        b64_json: `data:${mimeType};base64,${b64Json}`,
      })
    }

    return items
  }

  private async getBinary(
    endpoint: string,
    request: ImageGenerationRequest,
    preferredApiKey?: string
  ) {
    const fetchImpl = this.fetch()
    const attempts = this.apiKeyAttempts(request.provider, preferredApiKey)

    for (let index = 0; index < attempts.length; index++) {
      const apiKey = attempts[index]
      let response: Response
      try {
        response = await fetchImpl(endpoint, {
          method: 'GET',
          headers: this.baseHeaders(request.provider, apiKey),
          redirect: 'follow',
          signal: request.signal,
        })
      } catch {
        if (index < attempts.length - 1) continue
        return undefined
      }

      if (
        RETRYABLE_KEY_STATUSES.includes(response.status) &&
        index < attempts.length - 1
      ) {
        await response.body?.cancel()
        continue
      }

      if (response.ok) return response
      await response.body?.cancel()
      return undefined
    }

    return undefined
  }

  private imageTaskFailureMessage(taskId: string, response: RawImageResponse) {
    const detail =
      typeof response.error === 'string'
        ? response.error
        : response.error?.message || response.message
    return detail
      ? `Image task ${taskId} failed: ${detail}`
      : `Image task ${taskId} failed`
  }

  private async parseImageResponse(
    response: RawImageResponse,
    request?: ImageGenerationRequest,
    apiKey?: string
  ) {
    const items = this.imageItemsFromResponse(response)
    if (!items.length) {
      if (response.object === 'image.task') {
        const taskId = response.id ? ` ${response.id}` : ''
        const status = response.status ? ` (${response.status})` : ''
        const progress = response.progress ? ` at ${response.progress}` : ''
        throw new Error(
          `Provider returned async image task${taskId}${status}${progress}, but no image data was returned yet. Mita currently needs data[].b64_json or data[].url to save the asset.`
        )
      }
      throw new Error('Image response did not include any image data')
    }

    return Promise.all(
      items.map(async (item): Promise<ImageApiImage> => {
        if (item.b64_json) {
          const parsed = parseDataUrl(item.b64_json)
          return {
            b64Json: parsed.b64Json,
            mimeType: parsed.mimeType,
            revisedPrompt: item.revised_prompt,
            usage: response.usage,
          }
        }

        if (item.url) {
          const imageUrl = this.resolveImageUrl(item.url, request?.provider)
          const imageResponse = await this.fetch()(imageUrl, {
            headers: this.shouldSendProviderHeaders(imageUrl, request?.provider)
              ? this.baseHeaders(request!.provider, apiKey)
              : undefined,
            signal: request?.signal,
          })
          if (!imageResponse.ok) {
            throw new Error(`Unable to download generated image ${item.url}`)
          }
          const mimeType =
            imageResponse.headers.get('content-type')?.split(';')[0] ||
            'image/png'
          return {
            b64Json: await arrayBufferToBase64(await imageResponse.arrayBuffer()),
            mimeType,
            revisedPrompt: item.revised_prompt,
            usage: response.usage,
          }
        }

        throw new Error('Image item did not include b64_json or url')
      })
    )
  }

  private imageItemsFromResponse(response: RawImageResponse) {
    const candidates = [
      response.data,
      this.imageItemsFromContainer(response),
      this.imageItemsFromContainer(response.output),
      this.imageItemsFromContainer(response.result),
    ]
    return candidates.find((items) => items && items.length > 0) ?? []
  }

  private imageItemsFromContainer(container?: RawImageItemContainer) {
    if (!container) return undefined
    if (Array.isArray(container)) return container
    if (container.data?.length) return container.data
    if (container.images?.length) return container.images
    if (container.b64_json || container.url) {
      return [
        {
          b64_json: container.b64_json,
          url: container.url,
          revised_prompt: container.revised_prompt,
        },
      ]
    }
    return undefined
  }

  private resolveImageUrl(url: string, provider?: ModelProvider) {
    if (!provider) return url

    try {
      return new URL(url).toString()
    } catch {
      const baseUrl = provider.base_url || 'https://api.openai.com/v1'
      const parsedBase = new URL(baseUrl)
      if (url.startsWith('/')) {
        return `${parsedBase.origin}${url}`
      }
      return `${baseUrl.replace(/\/$/, '')}/${url.replace(/^\//, '')}`
    }
  }

  private shouldSendProviderHeaders(url: string, provider?: ModelProvider) {
    if (!provider?.base_url) return false

    try {
      return new URL(url).origin === new URL(provider.base_url).origin
    } catch {
      return false
    }
  }

  private apiKeyAttempts(provider: ModelProvider, preferredApiKey?: string) {
    const keys = providerRemoteApiKeyChain(provider)
    const attempts = preferredApiKey
      ? [preferredApiKey, ...keys.filter((key) => key !== preferredApiKey)]
      : keys
    return attempts.length > 0 ? attempts : [undefined]
  }

  private async sleep(ms: number, signal?: AbortSignal) {
    if (!signal) {
      await new Promise((resolve) => setTimeout(resolve, ms))
      return
    }

    this.throwIfAborted(signal)
    await new Promise<void>((resolve, reject) => {
      const timeout = globalThis.setTimeout(() => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      }, ms)
      const onAbort = () => {
        globalThis.clearTimeout(timeout)
        reject(new Error('Image generation canceled'))
      }
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  private throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) {
      throw new Error('Image generation canceled')
    }
  }

  private isAbortError(error: unknown) {
    return error instanceof Error && /aborted|canceled|cancelled/i.test(error.message)
  }

  private async errorMessage(response: Response) {
    const text = await response.text().catch(() => '')
    if (!text) {
      return `Image request failed: ${response.status} ${response.statusText}`
    }

    try {
      const json = JSON.parse(text)
      const message = json?.error?.message || json?.message
      if (message) return String(message)
    } catch {
      // Use raw text below.
    }

    return `Image request failed: ${response.status} ${text}`
  }
}
