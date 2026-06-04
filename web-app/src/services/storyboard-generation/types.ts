export type StoryboardBreakdownShot = {
  title: string
  camera: string
  prompt: string
  duration?: number
}

export type StoryboardBreakdownRequest = {
  provider: ModelProvider
  model: Model
  story: string
  style: string
  aspect: string
  shotCount: number
  template: string
  systemPrompt: string
  durationPerShot: number
  signal?: AbortSignal
}

export type StoryboardBreakdownResult = {
  shots: StoryboardBreakdownShot[]
  storyboardPrompt?: string
  raw?: unknown
}

export interface StoryboardGenerationService {
  breakdownStoryboard(
    request: StoryboardBreakdownRequest
  ): Promise<StoryboardBreakdownResult>
}
