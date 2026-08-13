import { streamText } from 'ai'
import { useAssistant } from '@/hooks/useAssistant'
import { useModelProvider } from '@/hooks/useModelProvider'
import { isBiyuanProvider } from '@/constants/biyuan'
import { streamJingxingResponsesChat } from '@/lib/jingxing-responses-web-search'
import { ModelFactory } from '@/lib/model-factory'
import { modelRequiresResponsesEndpoint } from '@/lib/provider-models'
import type { AiContextItem, AiSuggestion } from '@/types/novel'

export const NOVEL_CANDIDATE_COUNT = 3

export type NovelCandidateStreamStatus = Extract<
  AiSuggestion['status'],
  'streaming' | 'ready' | 'stopped' | 'failed'
>

export type NovelCandidateStreamResult = {
  index: number
  text: string
  status: NovelCandidateStreamStatus
  error?: string
}

export type RunNovelCandidateStreamsOptions = {
  mode: AiSuggestion['mode']
  instruction: string
  selection: string
  context: readonly AiContextItem[] | string
  signal?: AbortSignal
  onDelta: (index: number, delta: string) => void
  onStatus: (
    index: number,
    status: NovelCandidateStreamStatus,
    error?: string
  ) => void
}

export type RunNovelBlueprintOptions = {
  title: string
  genre: string
  kindLabel: string
  idea: string
  signal?: AbortSignal
}

const MODE_GUIDANCE: Record<AiSuggestion['mode'], string> = {
  continue: '从给出的正文自然续写，延续叙事视角、节奏、语气与事实。',
  rewrite: '只重写给出的选区，实现作者指令，同时保留上下文中的既定事实。',
  proofread: '只修正明确的语言、标点与一致性问题，不擅自扩写剧情。',
  blueprint: '生成可继续编辑的故事蓝图，清楚列出核心冲突、人物动机与推进节点。',
}

const CANDIDATE_FLAVORS = [
  '保守贴合原文，优先保证衔接和设定一致。',
  '加强场景张力与人物动作，但不要新增未经支持的关键设定。',
  '加强语言质感与节奏变化，同时保持清晰易读。',
] as const

const NOVEL_SYSTEM_PROMPT =
  '你是彼岩网文模式的写作引擎。严格服从作者设定，避免复述提示词；输出只是候选，不得声称已经修改正文。'

const NOVEL_BLUEPRINT_SYSTEM_PROMPT =
  '你是网文故事策划。根据作者的一句话构思生成可执行的故事蓝图，包含核心意图、主角欲望、主要冲突、前三个推进节点和一条可长期回收的伏笔。使用紧凑中文纯文本，不要写创作说明。'

const CONTEXT_LABELS: Record<AiContextItem['type'], string> = {
  selection: '当前选区',
  adjacent_summary: '相邻章节摘要',
  character: '相关人物',
  outline: '大纲节点',
  clue: '未回收线索',
  style_sample: '文风样本',
}

function formatContext(context: readonly AiContextItem[] | string) {
  if (typeof context === 'string') return context.trim()
  return context
    .filter((item) => item.included && item.content.trim())
    .map(
      (item) =>
        `- [${CONTEXT_LABELS[item.type]}] ${item.label}\n${item.content.trim()}`
    )
    .join('\n')
}

export function buildNovelCandidatePrompt({
  mode,
  instruction,
  selection,
  context,
  candidateIndex,
}: Pick<
  RunNovelCandidateStreamsOptions,
  'mode' | 'instruction' | 'selection' | 'context'
> & { candidateIndex: number }) {
  const includedContext = formatContext(context)
  const flavor = CANDIDATE_FLAVORS[candidateIndex] ?? CANDIDATE_FLAVORS[0]

  return [
    `任务：${MODE_GUIDANCE[mode]}`,
    `本候选侧重：${flavor}`,
    `作者指令：\n${instruction.trim() || '保持当前剧情方向，自然推进。'}`,
    `需要处理的正文：\n<selection>\n${selection}\n</selection>`,
    `可用上下文（仅作参考，不要复述标签）：\n<context>\n${includedContext || '无'}\n</context>`,
    '直接输出可放入正文的候选文字，不要解释过程，不要使用 Markdown 代码块。',
  ].join('\n\n')
}

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error) return error
  return 'AI 候选生成失败。'
}

function isAbortError(error: unknown, signal: AbortSignal) {
  return (
    signal.aborted ||
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  )
}

function linkedAbortController(parent?: AbortSignal) {
  const controller = new AbortController()
  const abort = () => controller.abort(parent?.reason)

  if (parent?.aborted) abort()
  else parent?.addEventListener('abort', abort, { once: true })

  return {
    controller,
    dispose: () => parent?.removeEventListener('abort', abort),
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  throw new DOMException('Generation stopped.', 'AbortError')
}

function blueprintPrompt(options: RunNovelBlueprintOptions) {
  return `作品名：${options.title.trim() || '未命名'}\n类型：${options.genre.trim() || '未分类'}\n创作内核：${options.kindLabel}\n作者构思：${options.idea.trim()}`
}

async function readResponsesText(
  stream: ReturnType<typeof streamJingxingResponsesChat>,
  signal?: AbortSignal
) {
  const reader = stream.getReader()
  let text = ''

  try {
    while (true) {
      throwIfAborted(signal)
      const { done, value } = await reader.read()
      if (done) break
      if (value.type === 'abort') {
        throw new DOMException('Generation stopped.', 'AbortError')
      }
      if (value.type === 'error') throw new Error(value.errorText)
      if (value.type === 'text-delta' && value.delta) text += value.delta
    }
    throwIfAborted(signal)
    return text
  } finally {
    reader.releaseLock()
  }
}

/** Generate one editable story blueprint with the user's selected model. */
export async function runNovelBlueprint(
  options: RunNovelBlueprintOptions
): Promise<string> {
  throwIfAborted(options.signal)
  const providerState = useModelProvider.getState()
  const selectedModel = providerState.selectedModel
  const modelId = selectedModel?.id
  const provider = providerState.getProviderByName(
    providerState.selectedProvider
  )
  const parameters = useAssistant.getState().currentAssistant?.parameters ?? {}

  if (!modelId || !provider) {
    throw new Error('未选择可用的 AI 模型或 Provider。')
  }

  const prompt = blueprintPrompt(options)
  if (
    isBiyuanProvider(provider.provider, provider.base_url) &&
    modelRequiresResponsesEndpoint(modelId, selectedModel)
  ) {
    return readResponsesText(
      streamJingxingResponsesChat({
        modelId,
        provider,
        messages: [
          {
            id: 'novel-blueprint',
            role: 'user',
            parts: [{ type: 'text', text: prompt }],
          },
        ],
        system: NOVEL_BLUEPRINT_SYSTEM_PROMPT,
        maxOutputTokens: 4096,
        abortSignal: options.signal,
      }),
      options.signal
    )
  }

  const model = await ModelFactory.createModel(modelId, provider, parameters)
  throwIfAborted(options.signal)
  const result = streamText({
    model,
    system: NOVEL_BLUEPRINT_SYSTEM_PROMPT,
    prompt,
    maxOutputTokens: 4096,
    abortSignal: options.signal,
  })
  let text = ''
  for await (const delta of result.textStream) {
    throwIfAborted(options.signal)
    text += delta
  }
  throwIfAborted(options.signal)
  return text
}

/**
 * Starts three isolated model requests. Each candidate streams into its own
 * slot and reports its own terminal state; no output is ever applied here.
 */
export async function runNovelCandidateStreams(
  options: RunNovelCandidateStreamsOptions
): Promise<NovelCandidateStreamResult[]> {
  const providerState = useModelProvider.getState()
  const modelId = providerState.selectedModel?.id
  const provider = providerState.getProviderByName(
    providerState.selectedProvider
  )
  const parameters = useAssistant.getState().currentAssistant?.parameters ?? {}

  if (!modelId || !provider) {
    const error = '未选择可用的 AI 模型或 Provider。'
    return Array.from({ length: NOVEL_CANDIDATE_COUNT }, (_, index) => {
      options.onStatus(index, 'failed', error)
      return { index, text: '', status: 'failed', error }
    })
  }

  const responsesChatEnabled =
    isBiyuanProvider(provider.provider, provider.base_url) &&
    modelRequiresResponsesEndpoint(modelId, providerState.selectedModel)

  const runCandidate = async (
    index: number
  ): Promise<NovelCandidateStreamResult> => {
    const { controller, dispose } = linkedAbortController(options.signal)
    let text = ''

    if (controller.signal.aborted) {
      options.onStatus(index, 'stopped')
      dispose()
      return { index, text, status: 'stopped' }
    }

    options.onStatus(index, 'streaming')

    try {
      const prompt = buildNovelCandidatePrompt({
        mode: options.mode,
        instruction: options.instruction,
        selection: options.selection,
        context: options.context,
        candidateIndex: index,
      })

      if (responsesChatEnabled) {
        const stream = streamJingxingResponsesChat({
          modelId,
          provider,
          messages: [
            {
              id: `novel-candidate-${index}`,
              role: 'user',
              parts: [{ type: 'text', text: prompt }],
            },
          ],
          system: NOVEL_SYSTEM_PROMPT,
          abortSignal: controller.signal,
        })
        const reader = stream.getReader()

        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            if (controller.signal.aborted || value.type === 'abort') {
              throw new DOMException('Generation stopped.', 'AbortError')
            }
            if (value.type === 'error') {
              throw new Error(value.errorText)
            }
            if (value.type !== 'text-delta' || !value.delta) continue
            text += value.delta
            options.onDelta(index, value.delta)
          }
          if (controller.signal.aborted) {
            throw new DOMException('Generation stopped.', 'AbortError')
          }
        } finally {
          reader.releaseLock()
        }
      } else {
        // Do not share a model/stream object between candidates. Some
        // providers attach request-local state to the LanguageModel instance.
        const model = await ModelFactory.createModel(
          modelId,
          provider,
          parameters
        )
        const result = streamText({
          model,
          abortSignal: controller.signal,
          system: NOVEL_SYSTEM_PROMPT,
          prompt,
        })

        for await (const delta of result.textStream) {
          if (controller.signal.aborted) {
            throw new DOMException('Generation stopped.', 'AbortError')
          }
          text += delta
          options.onDelta(index, delta)
        }
      }

      options.onStatus(index, 'ready')
      return { index, text, status: 'ready' }
    } catch (error) {
      if (isAbortError(error, controller.signal)) {
        options.onStatus(index, 'stopped')
        return { index, text, status: 'stopped' }
      }

      const message = errorMessage(error)
      options.onStatus(index, 'failed', message)
      return { index, text, status: 'failed', error: message }
    } finally {
      dispose()
    }
  }

  return Promise.all(
    Array.from({ length: NOVEL_CANDIDATE_COUNT }, (_, index) =>
      runCandidate(index)
    )
  )
}
