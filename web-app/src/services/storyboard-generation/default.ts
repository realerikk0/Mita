import { isBiyuanProvider } from '@/constants/biyuan'
import { providerRemoteApiKeyChain } from '@/lib/provider-api-keys'
import { parseProviderErrorResponse } from '@/lib/provider-quota-error'
import type {
  StoryboardBreakdownRequest,
  StoryboardBreakdownResult,
  StoryboardBreakdownShot,
  StoryboardGenerationService,
} from './types'

type RawChatContentPart = {
  type?: string
  text?: string
}

type RawChatChoice = {
  message?: {
    content?: string | RawChatContentPart[] | null
  }
}

type RawChatResponse = {
  choices?: RawChatChoice[]
  output_text?: string
  text?: string
  message?: string
}

type RawChatStreamChunk = {
  choices?: Array<{
    delta?: {
      content?: string | RawChatContentPart[] | null
    }
    finish_reason?: string | null
  }>
  error?: {
    message?: string
  }
}

const RETRYABLE_KEY_STATUSES = [401, 403, 429]
const STREAM_PING_HEADER = 'X-Oneapi-Stream-Ping'
const BIYUAN_STORYBOARD_TIMEOUT_MS = 4 * 60 * 1000

export class DefaultStoryboardGenerationService
  implements StoryboardGenerationService
{
  protected fetch(): typeof globalThis.fetch {
    return globalThis.fetch.bind(globalThis)
  }

  async breakdownStoryboard(
    request: StoryboardBreakdownRequest
  ): Promise<StoryboardBreakdownResult> {
    const endpoint = this.chatCompletionsEndpoint(request.provider)
    const body = this.breakdownBody(request)
    const response =
      body.stream === true
        ? await this.postJsonWithTimeout(
            endpoint,
            request.provider,
            body,
            request.signal
          )
        : await this.postJson(
            endpoint,
            request.provider,
            body,
            request.signal
          )

    return this.parseBreakdown(response, request)
  }

  private async postJsonWithTimeout(
    endpoint: string,
    provider: ModelProvider,
    body: Record<string, unknown>,
    parentSignal?: AbortSignal
  ): Promise<RawChatResponse> {
    const controller = new AbortController()
    let rejectDeadline!: (reason: unknown) => void
    const deadline = new Promise<never>((_, reject) => {
      rejectDeadline = reject
    })

    const abort = (error: Error) => {
      rejectDeadline(error)
      controller.abort(error)
    }
    const onParentAbort = () => {
      const reason = parentSignal?.reason
      const error =
        reason instanceof Error
          ? reason
          : Object.assign(new Error('Storyboard breakdown aborted'), {
              name: 'AbortError',
            })
      abort(error)
    }

    if (parentSignal?.aborted) {
      onParentAbort()
    } else {
      parentSignal?.addEventListener('abort', onParentAbort, { once: true })
    }

    const timeoutId = setTimeout(() => {
      abort(new Error('Storyboard breakdown timed out after 4 minutes'))
    }, BIYUAN_STORYBOARD_TIMEOUT_MS)

    try {
      return await Promise.race([
        this.postJson(endpoint, provider, body, controller.signal),
        deadline,
      ])
    } finally {
      clearTimeout(timeoutId)
      parentSignal?.removeEventListener('abort', onParentAbort)
    }
  }

  private breakdownBody(request: StoryboardBreakdownRequest) {
    const isPlainImage = request.template === 'plain'
    const stream = isBiyuanProvider(
      request.provider.provider,
      request.provider.base_url
    )
    const shotCount = this.normalizedShotCount(request.shotCount)
    const storyboardImageContract = isPlainImage
      ? undefined
      : [
          `The image prompt must require exactly ${shotCount} storyboard panels.`,
          'Do not merge, skip, or add panels.',
          `Keep every shot separately framed and visible in one ${request.aspect} image.`,
          'Avoid asking the image model to render captions, subtitles, watermarks, UI text, or messy typography unless the story explicitly requires text.',
        ].join(' ')
    return {
      model: request.model.id,
      messages: [
        {
          role: 'system',
          content:
            'You are a storyboard director. Return only valid JSON. Do not wrap it in Markdown.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            task: isPlainImage
              ? `Break the story into exactly ${shotCount} shots for an editable video plan and one image-generation prompt for a single plain image. Do not add storyboard layout, panel, grid, table, board, numbering, label, or typography instructions.`
              : `Break the story into exactly ${shotCount} shots for an editable video storyboard and one image-generation prompt for a numbered storyboard sheet.`,
            schema: {
              shots:
                `Exactly ${shotCount} objects with title, camera, prompt, and duration fields.`,
              storyboardPrompt: isPlainImage
                ? 'Single prompt for generating one plain image with no extra layout instructions.'
                : `Single prompt for generating one numbered storyboard image containing exactly ${shotCount} storyboard panels, one panel per shot.`,
            },
            storyboardImageContract,
            story: request.story,
            style: request.style,
            aspect: request.aspect,
            shotCount,
            template: request.template,
            continuityRules: request.systemPrompt,
            durationPerShot: request.durationPerShot,
            variantIndex: request.variantIndex,
            variantCount: request.variantCount,
            variantGuidance:
              request.variantCount && request.variantCount > 1
                ? `Create variation ${request.variantIndex ?? 1} of ${request.variantCount}; keep the story but vary framing, pacing, and prompt wording.`
                : undefined,
          }),
        },
      ],
      temperature: 0.4,
      max_tokens: 1800,
      ...(stream ? { stream: true } : {}),
    }
  }

  private normalizedShotCount(value: unknown) {
    const rounded = Math.round(Number(value))
    return Number.isFinite(rounded) && rounded > 0 ? rounded : 1
  }

  private chatCompletionsEndpoint(provider: ModelProvider) {
    return `${(provider.base_url || 'https://api.openai.com/v1').replace(
      /\/$/,
      ''
    )}/chat/completions`
  }

  private async postJson(
    endpoint: string,
    provider: ModelProvider,
    body: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<RawChatResponse> {
    const attempts = this.apiKeyAttempts(provider)

    for (let index = 0; index < attempts.length; index++) {
      const apiKey = attempts[index]
      const response = await this.fetch()(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.baseHeaders(provider, apiKey),
          ...(body.stream === true ? { [STREAM_PING_HEADER]: 'true' } : {}),
        },
        body: JSON.stringify(body),
        signal,
      })

      if (!response.ok) {
        const quotaError = await parseProviderErrorResponse(
          response,
          provider.provider
        )
        if (quotaError) throw quotaError

        if (
          RETRYABLE_KEY_STATUSES.includes(response.status) &&
          index < attempts.length - 1
        ) {
          await response.body?.cancel()
          continue
        }

        throw new Error(await this.errorMessage(response))
      }

      if (
        body.stream === true &&
        response.headers.get('content-type')?.includes('text/event-stream')
      ) {
        return this.readChatCompletionStream(response)
      }

      return (await response.json()) as RawChatResponse
    }

    throw new Error('Storyboard breakdown API key rotation exhausted')
  }

  private async readChatCompletionStream(
    response: Response
  ): Promise<RawChatResponse> {
    let buffer = ''
    let eventData: string[] = []
    let content = ''
    let completed = false

    const dispatchEvent = () => {
      if (!eventData.length || completed) {
        eventData = []
        return
      }

      const data = eventData.join('\n')
      eventData = []
      if (data === '[DONE]') {
        completed = true
        return
      }

      let chunk: RawChatStreamChunk
      try {
        chunk = JSON.parse(data) as RawChatStreamChunk
      } catch {
        throw new Error('Storyboard breakdown stream returned invalid data')
      }

      if (chunk.error?.message) {
        throw new Error(chunk.error.message)
      }

      chunk.choices?.forEach((choice) => {
        if (choice.finish_reason === 'length') {
          throw new Error('Storyboard breakdown exceeded the output limit')
        }
        content += this.chatContentText(choice.delta?.content)
      })
    }

    const processLine = (rawLine: string) => {
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
      if (!line) {
        dispatchEvent()
        return
      }
      if (line.startsWith(':')) return
      if (line.startsWith('data:')) {
        eventData.push(line.slice(5).trimStart())
      }
    }

    const processText = (text: string) => {
      buffer += text
      let newlineIndex = buffer.indexOf('\n')
      while (newlineIndex >= 0) {
        processLine(buffer.slice(0, newlineIndex))
        buffer = buffer.slice(newlineIndex + 1)
        newlineIndex = buffer.indexOf('\n')
      }
    }

    if (response.body) {
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        processText(decoder.decode(value, { stream: true }))
      }
      processText(decoder.decode())
    } else {
      processText(await response.text())
    }

    if (buffer) processLine(buffer)
    dispatchEvent()

    if (!completed) {
      throw new Error('Storyboard breakdown stream ended before completion')
    }

    return {
      choices: [{ message: { content } }],
    }
  }

  private parseBreakdown(
    response: RawChatResponse,
    request: StoryboardBreakdownRequest
  ): StoryboardBreakdownResult {
    const text = this.responseText(response)
    const parsed = this.parseJson(text)
    const parsedRecord = this.asRecord(parsed)
    const sourceShots = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsedRecord?.shots)
        ? parsedRecord.shots
        : []
    const shotCount = this.normalizedShotCount(request.shotCount)
    const shots = sourceShots
      .slice(0, shotCount)
      .map((shot, index) =>
        this.normalizeShot(shot, index, request.durationPerShot)
      )
      .filter((shot): shot is StoryboardBreakdownShot => Boolean(shot))

    if (!shots.length) {
      throw new Error('Storyboard breakdown did not include shots')
    }

    return {
      shots,
      storyboardPrompt:
        typeof parsedRecord?.storyboardPrompt === 'string'
          ? parsedRecord.storyboardPrompt
          : undefined,
      raw: response,
    }
  }

  private responseText(response: RawChatResponse) {
    const choiceContent = response.choices?.[0]?.message?.content
    const choiceText = this.chatContentText(choiceContent)
    if (choiceText) return choiceText
    return response.output_text || response.text || response.message || ''
  }

  private chatContentText(
    content?: string | RawChatContentPart[] | null
  ): string {
    if (typeof content === 'string') return content
    if (!Array.isArray(content)) return ''
    return content
      .map((part) => (part.type === 'text' || !part.type ? part.text : ''))
      .filter(Boolean)
      .join('\n')
  }

  private parseJson(text: string): unknown {
    const trimmed = text.trim()
    if (!trimmed) throw new Error('Storyboard breakdown response was empty')

    try {
      return JSON.parse(trimmed)
    } catch {
      const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
      if (match?.[1]) return JSON.parse(match[1])

      const start = trimmed.indexOf('{')
      const end = trimmed.lastIndexOf('}')
      if (start >= 0 && end > start) {
        return JSON.parse(trimmed.slice(start, end + 1))
      }
      throw new Error('Storyboard breakdown response was not valid JSON')
    }
  }

  private normalizeShot(
    value: unknown,
    index: number,
    fallbackDuration: number
  ): StoryboardBreakdownShot | undefined {
    const record = this.asRecord(value)
    const title = this.asText(record?.title) || `Shot ${index + 1}`
    const camera = this.asText(record?.camera) || 'Cinematic frame'
    const prompt = this.asText(record?.prompt) || this.asText(record?.visual)
    if (!prompt) return undefined

    const duration = Number(record?.duration)
    return {
      title,
      camera,
      prompt,
      duration:
        Number.isFinite(duration) && duration > 0 ? duration : fallbackDuration,
    }
  }

  private asText(value: unknown) {
    return typeof value === 'string' ? value.trim() : ''
  }

  private asRecord(value: unknown) {
    return value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : undefined
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

  private apiKeyAttempts(provider: ModelProvider) {
    const keys = providerRemoteApiKeyChain(provider)
    return keys.length > 0 ? keys : [undefined]
  }

  private async errorMessage(response: Response) {
    const text = await response.text().catch(() => '')
    if (!text) {
      return `Storyboard breakdown failed: ${response.status} ${response.statusText}`
    }

    try {
      const json = JSON.parse(text)
      const message = json?.error?.message || json?.message
      if (message) return String(message)
    } catch {
      // Use raw text below.
    }

    return `Storyboard breakdown failed: ${response.status} ${text}`
  }
}
