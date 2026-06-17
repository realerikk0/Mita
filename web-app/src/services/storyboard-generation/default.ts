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

const RETRYABLE_KEY_STATUSES = [401, 403, 429]

export class DefaultStoryboardGenerationService
  implements StoryboardGenerationService
{
  protected fetch(): typeof globalThis.fetch {
    return globalThis.fetch.bind(globalThis)
  }

  async breakdownStoryboard(
    request: StoryboardBreakdownRequest
  ): Promise<StoryboardBreakdownResult> {
    const response = await this.postJson(
      this.chatCompletionsEndpoint(request.provider),
      request.provider,
      this.breakdownBody(request),
      request.signal
    )

    return this.parseBreakdown(response, request)
  }

  private breakdownBody(request: StoryboardBreakdownRequest) {
    const isPlainImage = request.template === 'plain'
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
        },
        body: JSON.stringify(body),
        signal,
      })

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

      if (!response.ok) {
        throw new Error(await this.errorMessage(response))
      }

      return (await response.json()) as RawChatResponse
    }

    throw new Error('Storyboard breakdown API key rotation exhausted')
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
    if (typeof choiceContent === 'string') return choiceContent
    if (Array.isArray(choiceContent)) {
      return choiceContent
        .map((part) => (part.type === 'text' || !part.type ? part.text : ''))
        .filter(Boolean)
        .join('\n')
    }
    return response.output_text || response.text || response.message || ''
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
