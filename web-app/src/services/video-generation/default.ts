import { isBiyuanProvider } from '@/constants/biyuan'
import { arrayBufferToBase64 } from '@/lib/image-generation'
import { providerRemoteApiKeyChain } from '@/lib/provider-api-keys'
import {
  parseProviderErrorResponse,
  providerQuotaErrorFromUnknown,
} from '@/lib/provider-quota-error'
import { videoDebugLog } from '@/lib/video-generation-debug'
import { videoFileExtension } from '@/lib/video-generation'
import {
  BIYUAN_PUBLIC_SEEDANCE_REFERENCE_CAPABILITIES,
  isSeedanceVideoModel,
  SEEDANCE_STANDARD_VIDEO_DIMENSIONS,
  serializeSeedanceReferenceContent,
  validateSeedanceVideoInput,
  type SeedanceReferenceCapabilities,
  type SeedanceReferenceInput,
} from '@/lib/seedance-video'
import type {
  GenerateVideoRequest,
  PollVideoTaskRequest,
  SaveVideoAssetRequest,
  VideoAssetRecord,
  VideoGenerationService,
  VideoGenerationStatus,
  VideoGenerationTask,
  VideoGenerationReference,
  VideoResolution,
} from './types'
import type { ProjectAssignment } from '@/services/projects/types'

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

type ProviderErrorDetails = {
  code?: string
  message?: string
}

const RETRYABLE_KEY_STATUSES = [401, 403]
const DEFAULT_POLL_INTERVAL_MS = 2500
const DEFAULT_TASK_TIMEOUT_MS = 20 * 60 * 1000
const DEFAULT_REQUEST_RETRY_DELAYS_MS = [500, 1500, 3000] as const
const MAX_RETRY_AFTER_MS = 30_000
const UPSTREAM_TASK_RATE_LIMIT_CODE = 'upstream_task_rate_limited'
const RETRYABLE_NETWORK_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
])
const RETRYABLE_NETWORK_ERROR_MESSAGE =
  /failed to fetch|fetch failed|network(?: request)? failed|networkerror|network socket disconnected|socket hang up|connection (?:reset|closed)|econnreset|timed? ?out/i
const LEGACY_SEEDANCE_REFERENCE_CAPABILITIES: SeedanceReferenceCapabilities =
  Object.freeze({
    maxImages: 1,
    maxVideos: 0,
    maxAudios: 0,
    maxMedia: 1,
    serializeMultimodalContent: false,
  })

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function errorRecord(value: unknown) {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined
}

function isRetryableNetworkError(error: unknown) {
  const visited = new Set<unknown>()
  let current: unknown = error

  for (let depth = 0; current && depth < 6; depth += 1) {
    if (visited.has(current)) break
    visited.add(current)

    const record = errorRecord(current)
    const name = stringValue(record?.name)
    if (name === 'AbortError') return false

    const code = stringValue(record?.code)
    if (code && RETRYABLE_NETWORK_ERROR_CODES.has(code.toUpperCase())) {
      return true
    }

    const message = stringValue(record?.message)
    if (message && RETRYABLE_NETWORK_ERROR_MESSAGE.test(message)) return true
    if (name === 'TypeError' && /fetch/i.test(message ?? '')) return true

    current = record?.cause
  }

  return false
}

function referenceLogSummary(request: GenerateVideoRequest) {
  const references: VideoGenerationReference[] =
    request.references && request.references.length > 0
      ? request.references
      : request.sourceAsset
        ? [{ kind: 'image' as const, asset: request.sourceAsset }]
        : []
  const byKind = { image: 0, video: 0, audio: 0 }

  references.forEach((reference) => {
    byKind[reference.kind] += 1
  })

  return {
    total: references.length,
    byKind,
    localAssets: references.filter((reference) => reference.asset).length,
    remoteOrDataUrls: references.filter((reference) => reference.url).length,
    multimodalContentEnabled:
      request.seedanceReferenceCapabilities?.serializeMultimodalContent ===
      true,
  }
}

function contentTypesForLog(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (
      typeof item === 'object' &&
      item !== null &&
      typeof (item as { type?: unknown }).type === 'string'
    ) {
      return [(item as { type: string }).type]
    }
    return []
  })
}

function legacyImageContent(references: readonly SeedanceReferenceInput[]) {
  return references
    .filter((reference) => reference.kind === 'image')
    .map((reference) => ({
      type: 'image_url' as const,
      image_url: {
        url: reference.url,
      },
    }))
}

function referenceForEarlyValidation(
  reference: VideoGenerationReference
): SeedanceReferenceInput {
  if (reference.url?.trim()) {
    return {
      kind: reference.kind,
      url: reference.url,
    }
  }

  return {
    kind: reference.kind,
    // Validate the declared MIME before reading a potentially large local file.
    url: `data:${reference.asset?.mimeType ?? ''};base64,AA==`,
  }
}

export class DefaultVideoGenerationService implements VideoGenerationService {
  private readonly pollIntervalMs: number
  private readonly timeoutMs: number
  private readonly requestRetryDelaysMs: readonly number[]

  constructor(
    options: {
      pollIntervalMs?: number
      timeoutMs?: number
      /**
       * One entry per recoverable retry. Tests may pass zeroes to avoid
       * waiting while still exercising the production retry path.
       */
      requestRetryDelaysMs?: readonly number[]
    } = {}
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TASK_TIMEOUT_MS
    this.requestRetryDelaysMs = (
      options.requestRetryDelaysMs ?? DEFAULT_REQUEST_RETRY_DELAYS_MS
    ).map((delay) =>
      Number.isFinite(delay) ? Math.max(0, Math.round(delay)) : 0
    )
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
    const endpoint = this.videoGenerationEndpoint(request.provider)
    const body = await this.generationBody(request)
    videoDebugLog('generate:request', {
      endpoint,
      provider: request.provider.provider,
      baseUrl: request.provider.base_url,
      model: request.model.id,
      hasSourceAsset: Boolean(request.sourceAsset),
      sourceAsset: request.sourceAsset
        ? {
            id: request.sourceAsset.id,
            mimeType: request.sourceAsset.mimeType,
            fileName: request.sourceAsset.fileName,
          }
        : undefined,
      references: referenceLogSummary(request),
      requestShape: {
        fields: Object.keys(body).sort(),
        contentTypes: contentTypesForLog(body.content),
      },
    })

    const { json } = await this.postJson(
      endpoint,
      request.provider,
      body,
      request.signal
    )
    const task = this.parseVideoTask(json)
    videoDebugLog('generate:response', {
      task,
      raw: json,
    })
    return task
  }

  async pollVideoTask(
    request: PollVideoTaskRequest
  ): Promise<VideoGenerationTask> {
    const startedAt = Date.now()
    let currentApiKey: string | undefined
    let pollCount = 0

    while (Date.now() - startedAt <= this.timeoutMs) {
      this.throwIfAborted(request.signal)
      pollCount += 1
      const endpoint = this.videoTaskEndpoint(request.provider, request.taskId)
      const result = await this.getJson(
        endpoint,
        request.provider,
        request.signal,
        currentApiKey
      )
      currentApiKey = result.apiKey
      const task = this.parseVideoTask(result.json)
      videoDebugLog(
        task.status === 'succeeded' || task.status === 'failed'
          ? 'poll:terminal'
          : 'poll:progress',
        {
          endpoint,
          pollCount,
          task,
          raw:
            task.status === 'succeeded' || task.status === 'failed'
              ? result.json
              : undefined,
        }
      )

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

  async updateVideoAssetProject(
    assetId: string,
    project?: ProjectAssignment
  ): Promise<VideoAssetRecord> {
    void assetId
    void project
    throw new Error(
      'Video asset project updates are only available in the desktop app'
    )
  }

  private async generationBody(request: GenerateVideoRequest) {
    const requestedReferences = this.requestedReferences(request)
    const isSeedance = isSeedanceVideoModel(request.model.id)
    const referenceCapabilities =
      request.seedanceReferenceCapabilities ??
      (this.usesJingxingCompatibleVideoParams(request.provider)
        ? BIYUAN_PUBLIC_SEEDANCE_REFERENCE_CAPABILITIES
        : LEGACY_SEEDANCE_REFERENCE_CAPABILITIES)

    if (isSeedance) {
      validateSeedanceVideoInput({
        modelId: request.model.id,
        duration: request.duration,
        ratio: request.ratio,
        resolution: request.resolution,
        references: requestedReferences.map(referenceForEarlyValidation),
        capabilities: referenceCapabilities,
      })
    }

    const references = await this.resolveReferences(requestedReferences)
    if (isSeedance) {
      validateSeedanceVideoInput({
        modelId: request.model.id,
        duration: request.duration,
        ratio: request.ratio,
        resolution: request.resolution,
        references,
        capabilities: referenceCapabilities,
      })
    }

    const useMultimodalContent =
      isSeedance &&
      referenceCapabilities.serializeMultimodalContent &&
      references.length > 0
    const content = [
      { type: 'text', text: request.prompt },
      ...(useMultimodalContent
        ? serializeSeedanceReferenceContent(references, referenceCapabilities)
        : isSeedance
          ? []
          : legacyImageContent(references)),
    ]
    const singleImageReference =
      references.length === 1 && references[0]?.kind === 'image'
        ? references[0].url
        : undefined
    const apiResolution =
      request.resolution === '4K' ? '4k' : request.resolution
    const baseBody: Record<string, unknown> = {
      model: request.model.id,
      prompt: request.prompt,
      content,
      ratio: request.ratio,
      duration: request.duration,
      resolution: apiResolution,
      framespersecond: request.fps,
      generate_audio: request.generateAudio ?? false,
      watermark: false,
    }

    if (!this.usesJingxingCompatibleVideoParams(request.provider)) {
      return isSeedance && singleImageReference && !useMultimodalContent
        ? {
            ...baseBody,
            image: singleImageReference,
          }
        : baseBody
    }

    return {
      ...baseBody,
      ...(singleImageReference && !useMultimodalContent
        ? {
            image: singleImageReference,
          }
        : {}),
      ...(request.ratio === 'adaptive'
        ? {}
        : {
            size: this.videoSizeFor(request.resolution, request.ratio),
          }),
      metadata: {
        ratio: request.ratio,
        resolution: apiResolution,
        framespersecond: request.fps,
        fps: request.fps,
        generate_audio: request.generateAudio ?? false,
        watermark: false,
      },
    }
  }

  private usesJingxingCompatibleVideoParams(provider: ModelProvider) {
    return isBiyuanProvider(provider.provider, provider.base_url)
  }

  private videoSizeFor(resolution: VideoResolution, ratio: string) {
    const publishedDimensions =
      SEEDANCE_STANDARD_VIDEO_DIMENSIONS[resolution]?.[
        ratio as keyof (typeof SEEDANCE_STANDARD_VIDEO_DIMENSIONS)[VideoResolution]
      ]
    if (publishedDimensions) {
      return `${publishedDimensions.width}x${publishedDimensions.height}`
    }

    const baseHeight =
      resolution === '4K'
        ? 2160
        : resolution === '1080p'
          ? 1080
          : resolution === '720p'
            ? 720
            : 480
    const [ratioWidth, ratioHeight] = ratio
      .split(':')
      .map((part) => Number.parseInt(part, 10))

    if (!ratioWidth || !ratioHeight) {
      return `${Math.round((baseHeight * 16) / 9)}x${baseHeight}`
    }

    if (ratioWidth >= ratioHeight) {
      return `${Math.round(
        (baseHeight * ratioWidth) / ratioHeight
      )}x${baseHeight}`
    }

    return `${baseHeight}x${Math.round(
      (baseHeight * ratioHeight) / ratioWidth
    )}`
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

  private async sourceAssetDataUrl(asset: { path: string; mimeType: string }) {
    const fileUrl = this.fileSrc(asset.path)
    videoDebugLog('source:read:start', {
      path: asset.path,
      fileUrl,
      mimeType: asset.mimeType,
    })
    const response = await globalThis.fetch(fileUrl)
    if (!response.ok) throw new Error('Unable to read reference media')
    const mimeType =
      response.headers.get('content-type')?.split(';')[0] ||
      asset.mimeType ||
      'image/png'
    const buffer = await response.arrayBuffer()
    const dataUrl = `data:${mimeType};base64,${await arrayBufferToBase64(
      buffer
    )}`
    videoDebugLog('source:read:success', {
      status: response.status,
      contentType: response.headers.get('content-type'),
      mimeType,
      bytes: buffer.byteLength,
    })
    return dataUrl
  }

  private requestedReferences(
    request: GenerateVideoRequest
  ): VideoGenerationReference[] {
    if (request.references && request.references.length > 0) {
      return request.references
    }
    if (!request.sourceAsset) return []
    return [
      {
        kind: 'image',
        asset: request.sourceAsset,
      },
    ]
  }

  private async resolveReferences(
    requested: readonly VideoGenerationReference[]
  ): Promise<SeedanceReferenceInput[]> {
    return Promise.all(
      requested.map(async (reference) => ({
        kind: reference.kind,
        url: await this.referenceUrl(reference),
      }))
    )
  }

  private async referenceUrl(reference: VideoGenerationReference) {
    const directUrl = reference.url?.trim()
    if (directUrl) return directUrl
    if (reference.asset) return this.sourceAssetDataUrl(reference.asset)
    throw new Error(`Missing ${reference.kind} reference URL or local asset`)
  }

  private async postJson(
    endpoint: string,
    provider: ModelProvider,
    body: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<JsonResponseResult> {
    const attempts = this.apiKeyAttempts(provider)
    let requestRetryIndex = 0

    keyAttempts: for (let index = 0; index < attempts.length; index++) {
      const apiKey = attempts[index]
      while (true) {
        // A rejected POST may already have reached the provider, so only retry
        // explicit capacity responses that confirm no task was accepted.
        const response = await this.fetch()(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...this.baseHeaders(provider, apiKey),
          },
          body: JSON.stringify(body),
          signal,
        })
        videoDebugLog('http:post-response', {
          endpoint,
          ok: response.ok,
          status: response.status,
          contentType: response.headers.get('content-type'),
        })

        const capacityError = await this.upstreamCapacityDetails(response)
        if (capacityError) {
          if (requestRetryIndex < this.requestRetryDelaysMs.length) {
            const retryDelayMs = this.retryDelayMs(response, requestRetryIndex)
            requestRetryIndex += 1
            await this.discardResponse(response)
            videoDebugLog('http:post-retry', {
              endpoint,
              reason: UPSTREAM_TASK_RATE_LIMIT_CODE,
              retryAttempt: requestRetryIndex,
              retryDelayMs,
            })
            await this.sleep(retryDelayMs, signal)
            continue
          }
          await this.discardResponse(response)
          throw this.upstreamCapacityError()
        }

        const retry = await this.shouldRetryOrThrow(
          response,
          provider,
          index,
          attempts.length
        )
        if (retry) continue keyAttempts

        return {
          json: (await response.json()) as RawVideoResponse,
          apiKey,
        }
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
    let requestRetryIndex = 0

    keyAttempts: for (let index = 0; index < attempts.length; index++) {
      const apiKey = attempts[index]
      while (true) {
        let response: Response
        try {
          response = await this.fetch()(endpoint, {
            method: 'GET',
            headers: this.baseHeaders(provider, apiKey),
            signal,
          })
        } catch (error) {
          if (providerQuotaErrorFromUnknown(error)) throw error
          this.throwIfAborted(signal)

          if (
            isRetryableNetworkError(error) &&
            requestRetryIndex < this.requestRetryDelaysMs.length
          ) {
            const retryDelayMs =
              this.requestRetryDelaysMs[requestRetryIndex] ?? 0
            requestRetryIndex += 1
            videoDebugLog('http:get-retry', {
              endpoint,
              reason: 'network',
              retryAttempt: requestRetryIndex,
              retryDelayMs,
            })
            await this.sleep(retryDelayMs, signal)
            continue
          }

          if (index < attempts.length - 1) continue keyAttempts
          throw error
        }
        videoDebugLog('http:get-response', {
          endpoint,
          ok: response.ok,
          status: response.status,
          contentType: response.headers.get('content-type'),
        })

        const capacityError = await this.upstreamCapacityDetails(response)
        if (capacityError) {
          if (requestRetryIndex < this.requestRetryDelaysMs.length) {
            const retryDelayMs = this.retryDelayMs(response, requestRetryIndex)
            requestRetryIndex += 1
            await this.discardResponse(response)
            videoDebugLog('http:get-retry', {
              endpoint,
              reason: UPSTREAM_TASK_RATE_LIMIT_CODE,
              retryAttempt: requestRetryIndex,
              retryDelayMs,
            })
            await this.sleep(retryDelayMs, signal)
            continue
          }
          await this.discardResponse(response)
          throw this.upstreamCapacityError()
        }

        const retry = await this.shouldRetryOrThrow(
          response,
          provider,
          index,
          attempts.length
        )
        if (retry) continue keyAttempts

        return {
          json: (await response.json()) as RawVideoResponse,
          apiKey,
        }
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

    if (
      RETRYABLE_KEY_STATUSES.includes(response.status) &&
      index < attemptsLength - 1
    ) {
      await this.discardResponse(response)
      return true
    }

    if (!response.ok) {
      throw new Error(await this.errorMessage(response))
    }

    return false
  }

  private async upstreamCapacityDetails(
    response: Response
  ): Promise<ProviderErrorDetails | undefined> {
    if (response.status !== 429) return undefined
    const details = await this.providerErrorDetails(response)
    return details.code === UPSTREAM_TASK_RATE_LIMIT_CODE ? details : undefined
  }

  private async providerErrorDetails(
    response: Response
  ): Promise<ProviderErrorDetails> {
    const readable =
      typeof response.clone === 'function' ? response.clone() : response
    const text = await readable.text().catch(() => '')
    if (!text) return {}

    try {
      const payload = errorRecord(JSON.parse(text))
      const nestedError = errorRecord(payload?.error)
      return {
        code: stringValue(nestedError?.code) ?? stringValue(payload?.code),
        message:
          stringValue(nestedError?.message) ?? stringValue(payload?.message),
      }
    } catch {
      return {}
    }
  }

  private upstreamCapacityError() {
    const error = new Error(
      '上游视频生成服务当前负载已饱和，请稍后重试。'
    ) as Error & { code?: string }
    error.name = 'UpstreamCapacityError'
    error.code = UPSTREAM_TASK_RATE_LIMIT_CODE
    return error
  }

  private retryDelayMs(response: Response, retryIndex: number) {
    const configuredDelay = this.requestRetryDelaysMs[retryIndex] ?? 0
    const retryAfter = response.headers.get('retry-after')?.trim()
    if (!retryAfter) return configuredDelay

    const retryAfterSeconds = Number(retryAfter)
    const parsedRetryAfterMs = Number.isFinite(retryAfterSeconds)
      ? Math.max(0, retryAfterSeconds * 1000)
      : Date.parse(retryAfter) - Date.now()
    const retryAfterMs = Number.isFinite(parsedRetryAfterMs)
      ? Math.max(0, parsedRetryAfterMs)
      : configuredDelay
    return Math.min(MAX_RETRY_AFTER_MS, Math.max(configuredDelay, retryAfterMs))
  }

  private async discardResponse(response: Response) {
    await response.body?.cancel().catch(() => undefined)
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
      wrapper?.status || response.status || task.status
    )
    return {
      id,
      status,
      progress: this.videoProgress(
        wrapper?.progress ?? response.progress ?? task.progress,
        status
      ),
      videoUrl: this.firstVideoUrl(
        task.video_url,
        task.result_url,
        task.url,
        task.content?.video_url,
        task.content?.result_url,
        task.metadata?.video_url,
        task.metadata?.result_url,
        task.metadata?.url,
        task.video?.video_url,
        task.video?.result_url,
        task.video?.url,
        task.output,
        task.outputs,
        task.result,
        task.content,
        task.metadata,
        task.video,
        wrapper?.video_url,
        wrapper?.result_url,
        wrapper?.url,
        wrapper?.content?.video_url,
        wrapper?.content?.result_url,
        wrapper?.metadata?.video_url,
        wrapper?.metadata?.result_url,
        wrapper?.metadata?.url,
        wrapper?.video?.video_url,
        wrapper?.video?.result_url,
        wrapper?.video?.url,
        wrapper?.output,
        wrapper?.outputs,
        wrapper?.result,
        wrapper?.content,
        wrapper?.metadata,
        wrapper?.video,
        response.video_url,
        response.result_url,
        response.url,
        response.content?.video_url,
        response.content?.result_url,
        response.metadata?.video_url,
        response.metadata?.result_url,
        response.metadata?.url,
        response.video?.video_url,
        response.video?.result_url,
        response.video?.url,
        response.output,
        response.outputs,
        response.result,
        response.content,
        response.metadata,
        response.video
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
    if (
      ['failed', 'failure', 'error', 'cancelled', 'canceled'].includes(
        normalized
      )
    ) {
      return 'failed'
    }
    if (['queued', 'pending'].includes(normalized)) return 'queued'
    return 'running'
  }

  private videoProgress(
    progress: string | number | undefined,
    status: VideoGenerationStatus
  ) {
    if (typeof progress === 'number')
      return Math.max(0, Math.min(100, progress))
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
    this.throwIfAborted(signal)
    if (ms <= 0) return
    if (!signal) {
      await new Promise((resolve) => setTimeout(resolve, ms))
      return
    }

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
