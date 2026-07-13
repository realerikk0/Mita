import {
  BIYUAN_DEFAULT_BASE_URL,
  isBiyuanPrimaryApiHost,
  isBiyuanProvider as isBiyuanProviderConfig,
} from '@/constants/biyuan'
import {
  apiQualityForImageEditPreset,
  apiQualityForPreset,
  arrayBufferToBase64,
  imageEditSizeForRatio,
  imageFileExtension,
  imageSizeForRatio,
  isGptImageModel,
  parseDataUrl,
} from '@/lib/image-generation'
import { providerRemoteApiKeyChain } from '@/lib/provider-api-keys'
import {
  parseProviderErrorResponse,
  providerQuotaErrorFromUnknown,
} from '@/lib/provider-quota-error'
import {
  imageGenerationRequestErrorFromUnknown,
  parseImageGenerationErrorResponse,
} from '@/lib/image-generation-errors'
import type {
  ImageApiImage,
  ImageAssetRecord,
  ImageGenerationRequest,
  ImageGenerationService,
  ImportImageAssetRequest,
  SaveImageAssetRequest,
} from './types'
import type { ProjectAssignment } from '@/services/projects/types'

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

type RawChatContentPart = {
  type?: string
  text?: string
}

type RawChatChoice = {
  message?: {
    content?: string | RawChatContentPart[] | null
  }
  delta?: {
    content?: string | null
  }
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
  choices?: RawChatChoice[]
}

type JsonResponseResult = {
  json: RawImageResponse
  apiKey?: string
}

const RETRYABLE_KEY_STATUSES = [401, 403, 429]
const BIYUAN_TASK_POLL_INTERVAL_MS = 2500
const BIYUAN_TASK_TIMEOUT_MS = 600_000

export class DefaultImageGenerationService implements ImageGenerationService {
  protected fetch(): typeof globalThis.fetch {
    return globalThis.fetch.bind(globalThis)
  }

  protected fileSrc(path: string): string {
    return path
  }

  async generateImages(request: ImageGenerationRequest): Promise<ImageApiImage[]> {
    if (this.shouldUseBiyuanGeminiChatCompletions(request)) {
      return this.generateBiyuanGeminiChatImages(request)
    }

    const endpoint = this.endpointForMode(request)
    if (request.mode === 'generate') {
      const { json, apiKey } = await this.postJson(
        endpoint,
        request,
        this.generationBody(request)
      )
      const response = this.shouldPollBiyuanImageTask(request, json)
        ? await this.pollBiyuanImageTask(request, json, apiKey)
        : json
      return this.parseImageResponse(response, request, apiKey)
    }

    const { json, apiKey } = await this.postForm(endpoint, request)
    const response = this.shouldPollBiyuanImageTask(request, json)
      ? await this.pollBiyuanImageTask(request, json, apiKey)
      : json
    return this.parseImageResponse(response, request, apiKey)
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
    request: ImportImageAssetRequest
  ): Promise<ImageAssetRecord> {
    void request
    throw new Error('Image asset import is only available in the desktop app')
  }

  async listAssets(): Promise<ImageAssetRecord[]> {
    return []
  }

  async deleteAsset(assetId: string): Promise<void> {
    void assetId
    return
  }

  async updateAssetProject(
    assetId: string,
    project?: ProjectAssignment
  ): Promise<ImageAssetRecord> {
    void assetId
    void project
    throw new Error('Image asset project updates are only available in the desktop app')
  }

  private endpointForMode(request: ImageGenerationRequest) {
    const baseUrl = request.provider.base_url || 'https://api.openai.com/v1'
    const normalizedBase = baseUrl.replace(/\/$/, '')
    const endpoint =
      request.mode === 'generate'
        ? this.shouldUseBiyuanAsyncGeneration(request)
          ? '/images/generations/async'
          : '/images/generations'
        : this.shouldUseBiyuanAsyncEdit(request)
          ? '/images/edits/async'
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

    if (this.shouldRequestJsonResponseFormat(request.provider)) {
      body.response_format = 'b64_json'
    }

    return body
  }

  private shouldRequestJsonResponseFormat(provider: ModelProvider) {
    return !this.isBiyuanProvider(provider)
  }

  private shouldRequestFormResponseFormat(request: ImageGenerationRequest) {
    return (
      !isGptImageModel(request.model.id) &&
      !isBiyuanPrimaryApiHost(request.provider.base_url)
    )
  }

  private isBiyuanProvider(provider: ModelProvider) {
    return isBiyuanProviderConfig(provider.provider, provider.base_url)
  }

  private isBiyuanGeminiImageModel(model: Model) {
    const id = model.id.toLowerCase()
    return id.startsWith('gemini-') && id.includes('image')
  }

  private shouldUseBiyuanGeminiChatCompletions(
    request: ImageGenerationRequest
  ) {
    return (
      this.isBiyuanProvider(request.provider) &&
      this.isBiyuanGeminiImageModel(request.model)
    )
  }

  private shouldUseBiyuanAsyncGeneration(request: ImageGenerationRequest) {
    return (
      this.isBiyuanProvider(request.provider) &&
      !this.isBiyuanGeminiImageModel(request.model)
    )
  }

  private shouldUseBiyuanAsyncEdit(request: ImageGenerationRequest) {
    return (
      request.mode !== 'generate' &&
      this.isBiyuanProvider(request.provider) &&
      !this.isBiyuanGeminiImageModel(request.model) &&
      (request.sourceAssets?.length ?? 0) > 0
    )
  }

  private async generateBiyuanGeminiChatImages(
    request: ImageGenerationRequest
  ) {
    const endpoint = this.biyuanChatCompletionsEndpoint(request)
    const requestedCount = Math.max(1, request.count)
    const images: ImageApiImage[] = []

    for (let index = 0; index < requestedCount; index++) {
      const { json, apiKey } = await this.postJson(
        endpoint,
        request,
        await this.biyuanGeminiChatBody(request)
      )
      images.push(...(await this.parseImageResponse(json, request, apiKey)))
    }

    return images.slice(0, requestedCount)
  }

  private biyuanChatCompletionsEndpoint(request: ImageGenerationRequest) {
    const baseUrl = request.provider.base_url || BIYUAN_DEFAULT_BASE_URL
    return `${baseUrl.replace(/\/$/, '')}/chat/completions`
  }

  private async biyuanGeminiChatBody(request: ImageGenerationRequest) {
    const sourceAssets = request.sourceAssets ?? []
    const prompt = this.biyuanGeminiPrompt(request)
    const text = `${prompt}\n\nAspect ratio: ${request.ratio}. Quality: ${
      request.qualityPreset === 'hd' ? 'HD' : 'SD'
    }. Return the generated image directly as a Markdown data URL.`

    return {
      model: request.model.id,
      messages: [
        {
          role: 'user',
          content: sourceAssets.length
            ? [
                { type: 'text', text },
                ...(await Promise.all(
                  sourceAssets.map(async (asset) => ({
                    type: 'image_url',
                    image_url: {
                      url: await this.sourceAssetDataUrl(request, asset),
                    },
                  }))
                )),
              ]
            : text,
        },
      ],
      temperature: 0.2,
    }
  }

  private biyuanGeminiPrompt(request: ImageGenerationRequest) {
    const prompt = request.prompt.trim()
    if (prompt) return prompt

    const sourceCount = request.sourceAssets?.length ?? 0
    if (sourceCount > 1) {
      return 'Create a new image based on these reference images.'
    }

    if (sourceCount === 1) {
      return 'Create a fresh variation of this image.'
    }

    return 'Create an image.'
  }

  private async sourceAssetDataUrl(
    request: ImageGenerationRequest,
    asset: ImageAssetRecord
  ) {
    const blob = await this.uploadBlobForSourceAsset(request, asset)
    const mimeType = blob.type || 'image/png'
    const b64Json = await arrayBufferToBase64(await this.blobArrayBuffer(blob))
    return `data:${mimeType};base64,${b64Json}`
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

      const quotaError = await parseProviderErrorResponse(
        response,
        request.provider.provider
      )
      if (quotaError) throw quotaError

      if (
        RETRYABLE_KEY_STATUSES.includes(response.status) &&
        index < attempts.length - 1
      ) {
        await response.body?.cancel()
        continue
      }

      const imageRequestError =
        await parseImageGenerationErrorResponse(response)
      if (imageRequestError) throw imageRequestError

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
        if (providerQuotaErrorFromUnknown(error)) throw error
        if (index < attempts.length - 1) continue
        throw error
      }

      const quotaError = await parseProviderErrorResponse(
        response,
        request.provider.provider
      )
      if (quotaError) throw quotaError

      if (
        RETRYABLE_KEY_STATUSES.includes(response.status) &&
        index < attempts.length - 1
      ) {
        await response.body?.cancel()
        continue
      }

      const imageRequestError =
        await parseImageGenerationErrorResponse(response)
      if (imageRequestError) throw imageRequestError

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

  private async postForm(
    endpoint: string,
    request: ImageGenerationRequest
  ): Promise<JsonResponseResult> {
    const form = await this.imageFormData(request)

    try {
      return await this.postFormWithKeys(endpoint, request, form)
    } catch (error) {
      if (providerQuotaErrorFromUnknown(error)) throw error
      if (imageGenerationRequestErrorFromUnknown(error)) throw error
      if (
        request.mode !== 'variation' ||
        !endpoint.includes('/images/variations')
      ) {
        throw error
      }
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
    const prompt =
      request.prompt.trim() ||
      (this.shouldUseBiyuanAsyncEdit(request) && request.mode === 'variation'
        ? 'Create a fresh variation of this image.'
        : '')
    if (prompt) form.append('prompt', prompt)
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
    if (this.shouldRequestFormResponseFormat(request)) {
      form.append('response_format', 'b64_json')
    }

    const sourceAssets = request.sourceAssets ?? []
    const imageFieldName = sourceAssets.length > 1 ? 'image[]' : 'image'

    for (const sourceAsset of sourceAssets) {
      const blob = await this.uploadBlobForSourceAsset(request, sourceAsset)
      form.append(
        imageFieldName,
        blob,
        this.uploadFileNameForSourceAsset(sourceAsset, blob)
      )
    }

    return form
  }

  private async uploadBlobForSourceAsset(
    request: ImageGenerationRequest,
    asset: ImageAssetRecord
  ) {
    const blob = await this.assetToBlob(asset)
    if (!this.shouldNormalizeSourceImage(request, blob)) return blob

    return this.normalizeImageBlob(blob).catch(() => blob)
  }

  private uploadFileNameForSourceAsset(asset: ImageAssetRecord, blob: Blob) {
    const extension = imageFileExtension(blob.type)
    const fallback = `source.${extension}`
    if (!asset.fileName) return fallback

    const stem = asset.fileName.replace(/\.[^.]+$/, '')
    const currentExtension = asset.fileName.split('.').pop()?.toLowerCase()
    if (currentExtension === extension) return asset.fileName
    if (currentExtension === 'jpeg' && extension === 'jpg') return asset.fileName
    return `${stem || 'source'}.${extension}`
  }

  private shouldNormalizeSourceImage(
    request: ImageGenerationRequest,
    blob: Blob
  ) {
    return (
      this.isBiyuanProvider(request.provider) &&
      isGptImageModel(request.model.id) &&
      request.sourceAssets !== undefined &&
      request.sourceAssets.length > 0 &&
      blob.type !== 'image/png' &&
      typeof document !== 'undefined'
    )
  }

  private async normalizeImageBlob(blob: Blob) {
    const imageUrl = URL.createObjectURL(blob)
    try {
      const image = await this.loadImage(imageUrl)
      const maxDimension = 1536
      const scale = Math.min(
        1,
        maxDimension / Math.max(image.naturalWidth, 1),
        maxDimension / Math.max(image.naturalHeight, 1)
      )
      const width = Math.max(1, Math.round(image.naturalWidth * scale))
      const height = Math.max(1, Math.round(image.naturalHeight * scale))
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context) return blob

      context.drawImage(image, 0, 0, width, height)
      const normalized = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, 'image/png')
      })
      return normalized ?? blob
    } finally {
      URL.revokeObjectURL(imageUrl)
    }
  }

  private async loadImage(src: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('Failed to load source image'))
      image.src = src
    })
  }

  private async postFormWithKeys(
    endpoint: string,
    request: ImageGenerationRequest,
    body: FormData
  ): Promise<JsonResponseResult> {
    const fetchImpl = this.fetch()
    const attempts = this.apiKeyAttempts(request.provider)

    for (let index = 0; index < attempts.length; index++) {
      const apiKey = attempts[index]
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: this.baseHeaders(request.provider, apiKey),
        body,
        signal: request.signal,
      })

      const quotaError = await parseProviderErrorResponse(
        response,
        request.provider.provider
      )
      if (quotaError) throw quotaError

      if (
        RETRYABLE_KEY_STATUSES.includes(response.status) &&
        index < attempts.length - 1
      ) {
        await response.body?.cancel()
        continue
      }

      const imageRequestError =
        await parseImageGenerationErrorResponse(response)
      if (imageRequestError) throw imageRequestError

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

  private async assetToBlob(asset: ImageAssetRecord) {
    const response = await fetch(this.fileSrc(asset.path))
    if (!response.ok) {
      throw new Error(`Unable to read source image ${asset.fileName}`)
    }
    const blob = (await response.blob()) as unknown
    if (blob instanceof Blob) {
      const mimeType = this.imageMimeTypeForAsset(asset, blob.type)
      if (blob.type === mimeType) return blob
      return new Blob([await this.blobArrayBuffer(blob)], {
        type: mimeType,
      })
    }

    const foreignBlob = blob as {
      arrayBuffer: () => Promise<ArrayBuffer>
      type?: string
    }

    return new Blob([await foreignBlob.arrayBuffer()], {
      type: this.imageMimeTypeForAsset(asset, foreignBlob.type),
    })
  }

  private imageMimeTypeForAsset(asset: ImageAssetRecord, blobType?: string) {
    if (blobType?.startsWith('image/')) return blobType
    if (asset.mimeType?.startsWith('image/')) return asset.mimeType

    const fileName = asset.fileName || asset.path
    const extension = fileName.split('.').pop()?.toLowerCase()
    if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
    if (extension === 'webp') return 'image/webp'
    if (extension === 'png') return 'image/png'
    return 'image/png'
  }

  private async blobArrayBuffer(blob: Blob) {
    if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer()

    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as ArrayBuffer)
      reader.onerror = () =>
        reject(reader.error ?? new Error('Failed to read image blob'))
      reader.readAsArrayBuffer(blob)
    })
  }

  private shouldPollBiyuanImageTask(
    request: ImageGenerationRequest,
    response: RawImageResponse
  ) {
    return (
      this.isBiyuanProvider(request.provider) &&
      response.object === 'image.task' &&
      Boolean(response.id) &&
      this.imageItemsFromResponse(response).length === 0
    )
  }

  private async pollBiyuanImageTask(
    request: ImageGenerationRequest,
    initialResponse: RawImageResponse,
    apiKey?: string
  ) {
    const taskId = initialResponse.id
    if (!taskId) return initialResponse

    const taskEndpoint = this.biyuanTaskEndpoint(request, taskId)
    const startedAt = Date.now()
    let currentApiKey = apiKey

    while (Date.now() - startedAt <= BIYUAN_TASK_TIMEOUT_MS) {
      this.throwIfAborted(request.signal)
      let result: JsonResponseResult
      try {
        result = await this.getJson(taskEndpoint, request, currentApiKey)
      } catch (error) {
        if (providerQuotaErrorFromUnknown(error)) throw error
        if (this.isAbortError(error)) throw error
        await this.sleep(BIYUAN_TASK_POLL_INTERVAL_MS, request.signal)
        continue
      }
      currentApiKey = result.apiKey
      const response = result.json
      const status = response.status?.toLowerCase()

      if (this.imageItemsFromResponse(response).length > 0) {
        return response
      }

      if (status === 'succeeded') {
        const contentItems = await this.fetchBiyuanTaskContents(
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

      await this.sleep(BIYUAN_TASK_POLL_INTERVAL_MS, request.signal)
    }

    throw new Error(
      `Image task ${taskId} did not finish within ${BIYUAN_TASK_TIMEOUT_MS / 1000}s`
    )
  }

  private biyuanTaskEndpoint(request: ImageGenerationRequest, taskId: string) {
    const baseUrl = request.provider.base_url || BIYUAN_DEFAULT_BASE_URL
    return `${baseUrl.replace(/\/$/, '')}/images/tasks/${encodeURIComponent(taskId)}`
  }

  private async fetchBiyuanTaskContents(
    request: ImageGenerationRequest,
    taskId: string,
    apiKey?: string
  ) {
    const items: RawImageItem[] = []
    const taskEndpoint = this.biyuanTaskEndpoint(request, taskId)

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
      } catch (error) {
        if (providerQuotaErrorFromUnknown(error)) throw error
        if (index < attempts.length - 1) continue
        return undefined
      }

      const quotaError = await parseProviderErrorResponse(
        response,
        request.provider.provider
      )
      if (quotaError) throw quotaError

      if (
        RETRYABLE_KEY_STATUSES.includes(response.status) &&
        index < attempts.length - 1
      ) {
        await response.body?.cancel()
        continue
      }

      const imageRequestError =
        await parseImageGenerationErrorResponse(response)
      if (imageRequestError) throw imageRequestError

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
          `Provider returned async image task${taskId}${status}${progress}, but no image data was returned yet. Biyan currently needs data[].b64_json or data[].url to save the asset.`
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
      this.imageItemsFromChatChoices(response),
      this.imageItemsFromContainer(response),
      this.imageItemsFromContainer(response.output),
      this.imageItemsFromContainer(response.result),
    ]
    return candidates.find((items) => items && items.length > 0) ?? []
  }

  private imageItemsFromChatChoices(response: RawImageResponse) {
    const choices = response.choices ?? []
    const items: RawImageItem[] = []
    const dataImagePattern =
      /data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\r\n]+)/g

    for (const choice of choices) {
      for (const text of this.chatChoiceTextValues(choice)) {
        for (const match of text.matchAll(dataImagePattern)) {
          items.push({
            b64_json: `data:${match[1]};base64,${match[2].replace(/\s/g, '')}`,
          })
        }
      }
    }

    return items.length ? items : undefined
  }

  private chatChoiceTextValues(choice: RawChatChoice) {
    const values: string[] = []
    const content = choice.message?.content

    if (typeof content === 'string') {
      values.push(content)
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (typeof part.text === 'string') values.push(part.text)
      }
    }

    if (typeof choice.delta?.content === 'string') {
      values.push(choice.delta.content)
    }

    return values
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
