import { arrayBufferToBase64 } from '@/lib/image-generation'
import { providerRemoteApiKeyChain } from '@/lib/provider-api-keys'
import {
  parseProviderErrorResponse,
  providerQuotaErrorFromUnknown,
} from '@/lib/provider-quota-error'
import { videoFileExtension } from '@/lib/video-generation'
import type {
  GenerateVideoRequest,
  PollVideoTaskRequest,
  SaveVideoAssetRequest,
  VideoAssetRecord,
  VideoGenerationService,
  VideoGenerationStatus,
  VideoGenerationTask,
} from './types'

type RawVideoResponse = {
  id?: string
  task_id?: string
  object?: string
  model?: string
  status?: string
  progress?: string | number
  url?: string
  video_url?: string
  result_url?: string
  last_frame_url?: string
  metadata?: {
    url?: string
    video_url?: string
    result_url?: string
    last_frame_url?: string
  }
  content?: {
    url?: string
    video_url?: string
    result_url?: string
    last_frame_url?: string
  }
  video?: {
    url?: string
    video_url?: string
    result_url?: string
  }
  output?: RawVideoUrlCandidate
  outputs?: RawVideoUrlCandidate
  result?: RawVideoUrlCandidate
  data?: RawVideoResponse
  usage?: unknown
  error?: { message?: string } | string
  message?: string
  code?: string
}

type RawVideoUrlObject = Pick<
  RawVideoResponse,
  | 'url'
  | 'video_url'
  | 'result_url'
  | 'last_frame_url'
  | 'metadata'
  | 'content'
  | 'video'
  | 'output'
  | 'outputs'
  | 'result'
>

type RawVideoUrlCandidate =
  | string
  | RawVideoUrlObject
  | Array<string | RawVideoUrlObject>
  | null
  | undefined

type JsonResponseResult = {
  json: RawVideoResponse
  apiKey?: string
}

const RETRYABLE_KEY_STATUSES = [401, 403, 429]
const DEFAULT_POLL_INTERVAL_MS = 2500
const DEFAULT_TASK_TIMEOUT_MS = 20 * 60 * 1000

export class DefaultVideoGenerationService implements VideoGenerationService {
  private readonly pollIntervalMs: number
  private readonly timeoutMs: number

  constructor(
    options: {
      pollIntervalMs?: number
      timeoutMs?: number
    } = {}
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TASK_TIMEOUT_MS
  }

  protected fetch(): typeof globalThis.fetch {
    return globalThis.fetch.bind(globalThis)
  }

  protected fileSrc(path: string): string {
    return path
  }

  async generateVideo(
    request: GenerateVideoRequest
  ): Promise<VideoGenerationTask> {
    const { json } = await this.postJson(
      this.videoGenerationEndpoint(request.provider),
      request.provider,
      await this.generationBody(request),
      request.signal
    )
    return this.parseVideoTask(json)
  }

  async pollVideoTask(
    request: PollVideoTaskRequest
  ): Promise<VideoGenerationTask> {
    const startedAt = Date.now()
    let currentApiKey: string | undefined

    while (Date.now() - startedAt <= this.timeoutMs) {
      this.throwIfAborted(request.signal)
      const result = await this.getJson(
        this.videoTaskEndpoint(request.provider, request.taskId),
        request.provider,
        request.signal,
        currentApiKey
      )
      currentApiKey = result.apiKey
      const task = this.parseVideoTask(result.json)

      if (task.status === 'succeeded' || task.status === 'failed') {
        return task
      }

      await this.sleep(this.pollIntervalMs, request.signal)
    }

    throw new Error(`Video task ${request.taskId} did not finish in time`)
  }

  async saveVideoAsset(
    request: SaveVideoAssetRequest
  ): Promise<VideoAssetRecord> {
    const mimeType = request.mimeType || 'video/mp4'
    return {
      ...request,
      createdAt: request.createdAt ?? new Date().toISOString(),
      path: request.videoUrl ?? '',
      fileName: `${request.id}.${request.extension ?? videoFileExtension(mimeType)}`,
      mimeType,
      assetKind: request.assetKind ?? 'generated',
    }
  }

  async listVideoAssets(): Promise<VideoAssetRecord[]> {
    return []
  }

  async deleteVideoAsset(assetId: string): Promise<void> {
    void assetId
    return
  }

  private async generationBody(request: GenerateVideoRequest) {
    return {
      model: request.model.id,
      prompt: request.prompt,
      content: [
        { type: 'text', text: request.prompt },
        ...(request.sourceAsset
          ? [
              {
                type: 'image_url',
                image_url: {
                  url: await this.sourceAssetDataUrl(request.sourceAsset),
                },
              },
            ]
          : []),
      ],
      ratio: request.ratio,
      duration: request.duration,
      resolution: request.resolution,
      framespersecond: request.fps,
      generate_audio: request.generateAudio ?? false,
      watermark: false,
    }
  }

  private videoGenerationEndpoint(provider: ModelProvider) {
    return `${this.normalizedBaseUrl(provider)}/video/generations`
  }

  private videoTaskEndpoint(provider: ModelProvider, taskId: string) {
    return `${this.videoGenerationEndpoint(provider)}/${encodeURIComponent(
      taskId
    )}?show_raw=true&show_usage=true`
  }

  private normalizedBaseUrl(provider: ModelProvider) {
    return (provider.base_url || 'https://api.openai.com/v1').replace(/\/$/, '')
  }

  private async sourceAssetDataUrl(asset: {
    path: string
    mimeType: string
  }) {
    const response = await globalThis.fetch(this.fileSrc(asset.path))
    if (!response.ok) throw new Error('Unable to read storyboard image')
    const mimeType =
      response.headers.get('content-type')?.split(';')[0] ||
      asset.mimeType ||
      'image/png'
    return `data:${mimeType};base64,${await arrayBufferToBase64(
      await response.arrayBuffer()
    )}`
  }

  private async postJson(
    endpoint: string,
    provider: ModelProvider,
    body: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<JsonResponseResult> {
    const attempts = this.apiKeyAttempts(provider)

    for (let index = 0; index < attempts.length; index++) {
      const apiKey = attempts[index]
      const response = await this.fetch()(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.baseHeaders(provider, apiKey),
        },
        body: JSON.stringify(body),
        signal,
      })

      const retry = await this.shouldRetryOrThrow(response, provider, index, attempts.length)
      if (retry) continue

      return {
        json: (await response.json()) as RawVideoResponse,
        apiKey,
      }
    }

    throw new Error('Video generation API key rotation exhausted')
  }

  private async getJson(
    endpoint: string,
    provider: ModelProvider,
    signal?: AbortSignal,
    preferredApiKey?: string
  ): Promise<JsonResponseResult> {
    const attempts = this.apiKeyAttempts(provider, preferredApiKey)

    for (let index = 0; index < attempts.length; index++) {
      const apiKey = attempts[index]
      let response: Response
      try {
        response = await this.fetch()(endpoint, {
          method: 'GET',
          headers: this.baseHeaders(provider, apiKey),
          signal,
        })
      } catch (error) {
        if (providerQuotaErrorFromUnknown(error)) throw error
        if (index < attempts.length - 1) continue
        throw error
      }

      const retry = await this.shouldRetryOrThrow(response, provider, index, attempts.length)
      if (retry) continue

      return {
        json: (await response.json()) as RawVideoResponse,
        apiKey,
      }
    }

    throw new Error('Video generation API key rotation exhausted')
  }

  private async shouldRetryOrThrow(
    response: Response,
    provider: ModelProvider,
    index: number,
    attemptsLength: number
  ) {
    const quotaError = await parseProviderErrorResponse(
      response,
      provider.provider
    )
    if (quotaError) throw quotaError

    if (RETRYABLE_KEY_STATUSES.includes(response.status) && index < attemptsLength - 1) {
      await response.body?.cancel()
      return true
    }

    if (!response.ok) {
      throw new Error(await this.errorMessage(response))
    }

    return false
  }

  private parseVideoTask(response: RawVideoResponse): VideoGenerationTask {
    const wrapper = this.wrapperData(response)
    const task = wrapper?.data ?? response.data ?? response
    const id =
      wrapper?.task_id ||
      response.task_id ||
      task.task_id ||
      task.id ||
      response.id
    if (!id) throw new Error('Video response did not include a task id')

    const status = this.videoStatus(
      task.status || wrapper?.status || response.status
    )
    return {
      id,
      status,
      progress: this.videoProgress(task.progress ?? wrapper?.progress ?? response.progress, status),
      videoUrl: this.firstVideoUrl(
        task.content,
        task.metadata,
        task.video,
        task.video_url,
        task.result_url,
        task.url,
        task.output,
        task.outputs,
        task.result,
        wrapper?.content,
        wrapper?.metadata,
        wrapper?.video,
        wrapper?.video_url,
        wrapper?.result_url,
        wrapper?.url,
        wrapper?.output,
        wrapper?.outputs,
        wrapper?.result,
        response.content,
        response.metadata,
        response.video,
        response.video_url,
        response.result_url,
        response.url,
        response.output,
        response.outputs,
        response.result
      ),
      lastFrameUrl: this.firstVideoUrl(
        task.content?.last_frame_url,
        task.metadata?.last_frame_url,
        task.last_frame_url,
        wrapper?.last_frame_url,
        response.last_frame_url
      ),
      usage: task.usage ?? wrapper?.usage ?? response.usage,
      raw: response,
    }
  }

  private firstVideoUrl(...candidates: RawVideoUrlCandidate[]) {
    for (const candidate of candidates) {
      const url = this.videoUrlFromCandidate(candidate)
      if (url) return url
    }
    return undefined
  }

  private videoUrlFromCandidate(
    candidate: RawVideoUrlCandidate
  ): string | undefined {
    if (!candidate) return undefined
    if (typeof candidate === 'string') return candidate
    if (Array.isArray(candidate)) return this.firstVideoUrl(...candidate)

    return this.firstVideoUrl(
      candidate.video_url,
      candidate.result_url,
      candidate.url,
      candidate.content,
      candidate.metadata,
      candidate.video,
      candidate.output,
      candidate.outputs,
      candidate.result
    )
  }

  private wrapperData(response: RawVideoResponse) {
    if (!response.data) return undefined
    if (
      response.data.task_id ||
      response.data.status ||
      response.data.progress ||
      response.data.data
    ) {
      return response.data
    }
    return undefined
  }

  private videoStatus(status?: string): VideoGenerationStatus {
    const normalized = status?.toLowerCase() ?? ''
    if (['success', 'succeeded', 'completed'].includes(normalized)) {
      return 'succeeded'
    }
    if (['failed', 'failure', 'error', 'cancelled', 'canceled'].includes(normalized)) {
      return 'failed'
    }
    if (['queued', 'pending'].includes(normalized)) return 'queued'
    return 'running'
  }

  private videoProgress(
    progress: string | number | undefined,
    status: VideoGenerationStatus
  ) {
    if (typeof progress === 'number') return Math.max(0, Math.min(100, progress))
    if (typeof progress === 'string') {
      const parsed = Number(progress.replace('%', '').trim())
      if (Number.isFinite(parsed)) return Math.max(0, Math.min(100, parsed))
    }
    return status === 'succeeded' ? 100 : 0
  }

  private baseHeaders(provider: ModelProvider, apiKey?: string) {
    const headers: Record<string, string> = {}

    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`
      headers['x-api-key'] = apiKey
    }

    provider.custom_header?.forEach((customHeader) => {
      headers[customHeader.header] = customHeader.value
    })

    return headers
  }

  private apiKeyAttempts(provider: ModelProvider, preferredApiKey?: string) {
    const keys = providerRemoteApiKeyChain(provider)
    const attempts = preferredApiKey
      ? [preferredApiKey, ...keys.filter((key) => key !== preferredApiKey)]
      : keys
    return attempts.length > 0 ? attempts : [undefined]
  }

  private async sleep(ms: number, signal?: AbortSignal) {
    if (ms <= 0) return
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
        reject(new Error('Video generation canceled'))
      }
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  private throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw new Error('Video generation canceled')
  }

  private async errorMessage(response: Response) {
    const text = await response.text().catch(() => '')
    if (!text) {
      return `Video request failed: ${response.status} ${response.statusText}`
    }

    try {
      const json = JSON.parse(text)
      const message = json?.error?.message || json?.message
      if (message) return String(message)
    } catch {
      // Use raw text below.
    }

    return `Video request failed: ${response.status} ${text}`
  }
}
