import {
  generateText,
  streamText,
  type LanguageModel,
  type UIMessage,
} from 'ai'
import { useAssistant } from '@/hooks/useAssistant'
import { useModelProvider } from '@/hooks/useModelProvider'
import i18n from '@/i18n/setup'
import { configuredChatModels } from '@/lib/configured-model-providers'
import {
  defaultModel,
  isJingxingNativeWebSearchModel,
} from '@/lib/models'
import { ModelFactory } from '@/lib/model-factory'
import { providerQuotaErrorFromUnknown } from '@/lib/provider-quota-error'
import {
  canUseJingxingNativeWebSearch,
  streamJingxingNativeWebSearch,
} from '@/lib/jingxing-responses-web-search'
import {
  appendMitaTeamsEvent,
  appendRoleStreamMessage,
  mergeProjectMemory,
  projectMemoryText,
  recordRoleTurnMemory,
  roleMemoryText,
  updateRoleStreamMessageContent,
  withMitaTeamsRuntime,
} from '@/lib/mita-teams-memory'
import {
  MITA_TEAMS_ORCHESTRATOR_ROLE_ID,
  MITA_TEAMS_TASK_CHANNEL_ID,
  MITA_TEAMS_CHANNELS,
  MITA_TEAMS_MODES,
  MITA_TEAMS_ROLE_COLORS,
  MITA_TEAMS_TASK_TEMPLATES,
  normalizeMitaTeamsId,
  type MitaTeamsArtifactType,
  type MitaTeamsArtifactUpdate,
  type MitaTeamsChoiceOption,
  type MitaTeamsChannelConfig,
  type MitaTeamsChannelId,
  type MitaTeamsConfig,
  type MitaTeamsExecutionMode,
  type MitaTeamsMilestone,
  type MitaTeamsOrchestratorDecision,
  type MitaTeamsRoleCallPlan,
  type MitaTeamsRoleConfig,
  type MitaTeamsRoleId,
  type MitaTeamsScenarioId,
  type MitaTeamsRuntime,
  type MitaTeamsStructuredUpdates,
  type MitaTeamsTaskStatus,
  type MitaTeamsTaskUpdate,
  type MitaTeamsTokenUsage,
} from '@/types/mita-teams'

type RoleOutput = {
  roleId: MitaTeamsRoleId
  roleName: string
  channelId?: MitaTeamsChannelId
  output: string
}

type GeneratedTextResult =
  | string
  | {
      text: string
      usage?: unknown
    }

type MitaTeamsRoleWebSearchRequest = {
  enabled: boolean
  reason: string
}

type GenerateRoleText = (input: {
  role: MitaTeamsRoleConfig
  prompt: string
  model?: ThreadModel
  webSearch?: MitaTeamsRoleWebSearchRequest
  abortSignal?: AbortSignal
  onDelta?: (delta: string) => void
}) => Promise<GeneratedTextResult>

type GenerateDecisionText = (input: {
  prompt: string
  model?: ThreadModel
  abortSignal?: AbortSignal
}) => Promise<GeneratedTextResult>

type MitaTeamsUserControl = {
  mentionedRoleIds: MitaTeamsRoleId[]
  onlyRoleIds: MitaTeamsRoleId[]
  shouldPause: boolean
  shouldContinue: boolean
  shouldConverge: boolean
}

type MitaTeamsModelFamily =
  | 'chatgpt'
  | 'claude'
  | 'gemini'
  | 'grok'
  | 'general'

type MitaTeamsModelOption = {
  provider: string
  modelId: string
  label: string
  family: MitaTeamsModelFamily
  nativeWebSearch: boolean
}

type MitaTeamsUserWorkflowRoleSpec = {
  name: string
  key: string
  modelId?: string
}

type MitaTeamsUserWorkflowSpec = {
  explicit: boolean
  roles: MitaTeamsUserWorkflowRoleSpec[]
  channelLabel?: string
}

export type RunMitaTeamsRuntimeOptions = {
  config: MitaTeamsConfig
  userText: string
  threadTitle?: string
  abortSignal?: AbortSignal
  onConfigChange?: (config: MitaTeamsConfig) => void
  generateRoleText?: GenerateRoleText
  generateDecisionText?: GenerateDecisionText
}

export type MitaTeamsRuntimeResult = {
  config: MitaTeamsConfig
  finalResponse?: string
  choiceRequestId?: string
  status: 'completed' | 'waiting-for-user' | 'stopped' | 'failed'
}

export type RunMitaTeamsPrivateRoleChatOptions = {
  config: MitaTeamsConfig
  roleId: MitaTeamsRoleId
  userText: string
  abortSignal?: AbortSignal
  onConfigChange?: (config: MitaTeamsConfig) => void
  generateRoleText?: GenerateRoleText
}

export type MitaTeamsPrivateRoleChatResult = {
  config: MitaTeamsConfig
  finalResponse?: string
  status: 'completed' | 'stopped' | 'failed'
}

const MAX_ROLE_CALLS_PER_RUN = 16

const nowIso = () => new Date().toISOString()

const stableId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const trimText = (value: string, max = 1200) => {
  const text = value.trim()
  return text.length > max ? `${text.slice(0, max - 3)}...` : text
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined

const asNonEmptyString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined

const errorMessageFromUnknown = (
  error: unknown,
  fallback: string
): string => {
  const quotaError = providerQuotaErrorFromUnknown(error)
  if (quotaError) {
    const details = [
      quotaError.providerName ? `provider=${quotaError.providerName}` : '',
      quotaError.code ? `code=${quotaError.code}` : '',
      quotaError.rechargeUrl ? `recharge=${quotaError.rechargeUrl}` : '',
    ].filter(Boolean)
    return details.length
      ? `${quotaError.message} (${details.join(', ')})`
      : quotaError.message
  }

  if (error instanceof Error) {
    return error.message || error.name || fallback
  }

  const directText = asNonEmptyString(error)
  if (directText) return directText

  const record = asRecord(error)
  if (!record) return fallback

  const nestedError = asRecord(record.error)
  const nestedCause = asRecord(record.cause)
  const message =
    asNonEmptyString(record.message) ??
    asNonEmptyString(nestedError?.message) ??
    asNonEmptyString(nestedCause?.message) ??
    fallback
  const qualifiers = [
    asNonEmptyString(record.name),
    asNonEmptyString(record.code) ?? asNonEmptyString(nestedError?.code),
    typeof record.status === 'number' || typeof record.status === 'string'
      ? `status=${record.status}`
      : undefined,
    asNonEmptyString(record.statusText),
    asNonEmptyString(record.type) ?? asNonEmptyString(nestedError?.type),
  ].filter((item): item is string => Boolean(item))

  return qualifiers.length ? `${message} (${qualifiers.join(', ')})` : message
}

function roleFailureMessage(
  error: unknown,
  role: MitaTeamsRoleConfig,
  fallback: string
) {
  const message = errorMessageFromUnknown(error, fallback)
  if (/No output generated\.?\s*Check the stream for errors\.?/i.test(message)) {
    return `No output generated by ${role.name}.`
  }
  return message
}

const numberFromUsage = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const usageFromUnknown = (value: unknown): MitaTeamsTokenUsage | undefined => {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const promptTokens = numberFromUsage(
    raw.promptTokens ?? raw.inputTokens ?? raw.prompt_tokens ?? raw.input_tokens
  )
  const completionTokens = numberFromUsage(
    raw.completionTokens ??
      raw.outputTokens ??
      raw.completion_tokens ??
      raw.output_tokens
  )
  const totalTokens =
    numberFromUsage(raw.totalTokens ?? raw.total_tokens) ??
    (promptTokens !== undefined || completionTokens !== undefined
      ? (promptTokens ?? 0) + (completionTokens ?? 0)
      : undefined)
  const estimatedCostUsd = numberFromUsage(
    raw.estimatedCostUsd ?? raw.estimated_cost_usd
  )
  const usage: MitaTeamsTokenUsage = {}

  if (promptTokens !== undefined) usage.promptTokens = promptTokens
  if (completionTokens !== undefined) usage.completionTokens = completionTokens
  if (totalTokens !== undefined) usage.totalTokens = totalTokens
  if (estimatedCostUsd !== undefined) usage.estimatedCostUsd = estimatedCostUsd

  return Object.keys(usage).length ? usage : undefined
}

const normalizeGeneratedText = (
  result: GeneratedTextResult
): { text: string; usage?: MitaTeamsTokenUsage } =>
  typeof result === 'string'
    ? { text: result }
    : {
        text: result.text,
        usage: usageFromUnknown(result.usage),
      }

const addUsage = (
  current?: MitaTeamsTokenUsage,
  incoming?: MitaTeamsTokenUsage
): MitaTeamsTokenUsage | undefined => {
  if (!current && !incoming) return undefined
  const usage: MitaTeamsTokenUsage = {}
  const fields: Array<keyof MitaTeamsTokenUsage> = [
    'promptTokens',
    'completionTokens',
    'totalTokens',
    'estimatedCostUsd',
  ]

  for (const field of fields) {
    const value = (current?.[field] ?? 0) + (incoming?.[field] ?? 0)
    if (value > 0) usage[field] = value
  }

  return Object.keys(usage).length ? usage : undefined
}

const PERMISSION_RANK: Record<MitaTeamsRoleConfig['permission'], number> = {
  read: 0,
  tools: 1,
  write: 2,
}

const TASK_STATUS_ALIASES: Record<string, MitaTeamsTaskStatus> = {
  todo: 'todo',
  pending: 'todo',
  待确认: 'todo',
  待確認: 'todo',
  researching: 'researching',
  research: 'researching',
  研究中: 'researching',
  调研中: 'researching',
  調研中: 'researching',
  implementing: 'implementing',
  build: 'implementing',
  building: 'implementing',
  实现中: 'implementing',
  實作中: 'implementing',
  reviewing: 'reviewing',
  review: 'reviewing',
  待审查: 'reviewing',
  待審查: 'reviewing',
  done: 'done',
  completed: 'done',
  已完成: 'done',
}

const ARTIFACT_TYPE_ALIASES: Record<string, MitaTeamsArtifactType> = {
  'decision': 'decision',
  '决策': 'decision',
  '決策': 'decision',
  'risk': 'risk',
  '风险': 'risk',
  '風險': 'risk',
  'artifact': 'artifact',
  'output': 'artifact',
  '产物': 'artifact',
  '產物': 'artifact',
  'test': 'test_result',
  'test result': 'test_result',
  'test-result': 'test_result',
  'test_result': 'test_result',
  '测试结果': 'test_result',
  '測試結果': 'test_result',
  'final': 'final_draft',
  'final-draft': 'final_draft',
  'final_draft': 'final_draft',
  '最终草稿': 'final_draft',
  '最終草稿': 'final_draft',
}

const permissionMeets = (
  actual: MitaTeamsRoleConfig['permission'],
  required?: MitaTeamsRoleConfig['permission']
) => !required || PERMISSION_RANK[actual] >= PERMISSION_RANK[required]

const normalizeStatusAlias = (
  value: unknown
): MitaTeamsTaskStatus | undefined => {
  if (typeof value !== 'string') return undefined
  return TASK_STATUS_ALIASES[value.trim().toLowerCase()]
}

const normalizeArtifactTypeAlias = (
  value: unknown
): MitaTeamsArtifactType | undefined => {
  if (typeof value !== 'string') return undefined
  return ARTIFACT_TYPE_ALIASES[value.trim().toLowerCase()]
}

function roleById(config: MitaTeamsConfig, roleId: MitaTeamsRoleId) {
  return config.roles.find((role) => role.id === roleId)
}

function channelById(config: MitaTeamsConfig, channelId?: MitaTeamsChannelId) {
  if (!channelId) return undefined
  return config.channels.find((channel) => channel.id === channelId)
}

function modeDescription(config: MitaTeamsConfig) {
  const mode = MITA_TEAMS_MODES.find((item) => item.id === config.mode)
  return mode ? `${mode.label}: ${mode.description}` : config.mode
}

function modeOperationalGuidance(config: MitaTeamsConfig) {
  switch (config.mode) {
    case 'relay':
      return `Relay operating contract:
- Treat relay as staged handoff, not repeated generation by one role.
- For deliverables, create or use at least one producer role and one reviewer/critic role when the task is more than a tiny one-shot answer.
- After a producer returns a draft, do not call the same producer again for the same deliverable unless the output is clearly incomplete or failed.
- Prefer the next call to a reviewer, critic, QA, editor, visual prompt designer, or other downstream role that can review, refine, or verify the draft.
- Only stop after review/verification has happened, or explicitly explain why review is unnecessary.`
    case 'roundtable':
      return `Roundtable operating contract:
- Gather distinct perspectives before deciding.
- Avoid repeatedly calling the same role unless a follow-up question is narrowly necessary.
- Summarize agreements, disagreements, and the coordinator decision.`
    case 'debate':
      return `Debate operating contract:
- Ask roles to propose and challenge different options.
- Include at least one rebuttal or critique step before convergence.`
    case 'red-team':
      return `Red-team operating contract:
- Stress-test the candidate answer or plan before finalizing.
- Record risks, failure modes, and any required fixes.`
    case 'silent':
      return `Silent operating contract:
- Keep internal collaboration quiet.
- Show only useful checkpoints and final deliverables.`
    default:
      return 'Use the selected mode to decide role order and convergence.'
  }
}

type MitaTeamsScenarioPlaybook = {
  id: MitaTeamsScenarioId
  label: string
  taskTemplateId: MitaTeamsConfig['taskTemplateId']
  mode: MitaTeamsConfig['mode']
  flow: MitaTeamsRoleId[]
  roles: Array<
    Omit<MitaTeamsRoleConfig, 'color' | 'provider' | 'modelId' | 'enabled'>
  >
  channels: MitaTeamsChannelConfig[]
  instructions: Record<MitaTeamsRoleId, string>
}

const MARKET_RESEARCH_PLAYBOOK: MitaTeamsScenarioPlaybook = {
  id: 'market_research',
  label: 'Market research',
  taskTemplateId: 'research',
  mode: 'relay',
  flow: ['data_scout', 'market_analyst', 'skeptic'],
  roles: [
    {
      id: 'data_scout',
      name: 'Data Scout',
      label: 'Data',
      description:
        'Checks current market calendars, live variables, and missing evidence before any sector outlook.',
      prompt:
        'You are a market data scout. Verify the current inputs needed for a US sector outlook: next trading day, economic calendar, earnings calendar, index futures, 10Y Treasury yield trend, VIX, DXY, oil, and recent sector ETF relative strength. Use web or native retrieval if your model/provider supports it. If live data is unavailable, do not invent values; list the exact missing inputs the owner must verify.',
      permission: 'read',
    },
    {
      id: 'market_analyst',
      name: 'Market Analyst',
      label: 'Analyst',
      description:
        'Analyzes US market sectors, catalysts, macro signals, and produces a conditional sector outlook.',
      prompt:
        'You are a senior US equity market analyst. Use verified inputs from Data Scout when available. Produce a conditional sector outlook with catalysts, candidate sectors, trigger conditions, and invalidation conditions. Distinguish known facts from speculation and avoid false precision.',
      permission: 'read',
    },
    {
      id: 'skeptic',
      name: 'Skeptic Reviewer',
      label: 'Skeptic',
      description:
        "Fact-checks and stress-tests the analyst's sector predictions, flags overconfidence and missing risks.",
      prompt:
        "You are a skeptical markets fact-checker. Review the Market Analyst's sector outlook. Flag overconfident or unfounded single-day predictions, identify missing risks and counter-scenarios, verify claimed catalysts, and separate signal from noise.",
      permission: 'read',
    },
  ],
  channels: [
    {
      id: 'research',
      label: 'Market Research',
      description:
        'Collect market inputs, analyze sector scenarios, and review uncertainty.',
      roleIds: ['data_scout', 'market_analyst', 'skeptic'],
    },
  ],
  instructions: {
    data_scout:
      'First verify the market inputs for the next US trading day: calendar, earnings, index futures, 10Y yield, VIX, DXY, oil, and sector ETF relative strength. If live data is unavailable, clearly list missing inputs instead of inventing values.',
    market_analyst:
      'Use the Data Scout findings or missing-data list to produce a conditional sector outlook. Include candidate sectors only with explicit trigger conditions and invalidation conditions.',
    skeptic:
      'Stress-test the sector outlook. Flag overconfidence, missing macro/earnings risks, reverse scenarios, and whether the answer is actionable without real-time inputs.',
  },
}

function detectScenarioPlaybook(userText: string) {
  if (isMarketResearchRequest(userText)) {
    return MARKET_RESEARCH_PLAYBOOK
  }
  return undefined
}

function workflowTextKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[`*_~\s，。,.、:：()（）[\]【】"'“”‘’]/g, '')
}

function cleanWorkflowRoleName(value: string) {
  return value
    .replace(/^[\s\d.)、:：#️⃣\uFE0F\u20E3①-⑳一二三四五六七八九十]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function detectUserWorkflowSpec(userText: string): MitaTeamsUserWorkflowSpec {
  const roles: MitaTeamsUserWorkflowRoleSpec[] = []
  const seen = new Set<string>()
  const headingPattern =
    /^#{2,6}\s*(.+?)\s*[·•\-–—]\s*`([^`\n]+)`\s*$/gm
  let match: RegExpExecArray | null

  while ((match = headingPattern.exec(userText))) {
    const name = cleanWorkflowRoleName(match[1] ?? '')
    const modelId = match[2]?.trim()
    const key = workflowTextKey(name)
    if (!name || !key || seen.has(key)) continue
    seen.add(key)
    roles.push({
      name,
      key,
      ...(modelId ? { modelId } : {}),
    })
  }

  const channelMatch = userText.match(/频道名\s*[:：]\s*#?([^\n`*_]+)/)
  const channelLabel = channelMatch?.[1]?.trim()
  const hasWorkflowSignals =
    /(角色卡|按发言顺序|频道名|轮次|模式|工作流|流程|prompt|提示词)/i.test(
      userText
    ) && /```|`[^`\n]+`/.test(userText)

  return {
    explicit: roles.length > 0 && hasWorkflowSignals,
    roles,
    ...(channelLabel ? { channelLabel } : {}),
  }
}

function hasTickerLikeInvestmentTarget(userText: string) {
  return (
    /\$[A-Z]{1,6}\b/.test(userText) ||
    (/\b[A-Z]{2,5}\b/.test(userText) &&
      /(投资|投資|估值|财报|財報|业绩|業績|买入|買入|购入|購入|值得|stock|equity|investment|valuation|earnings|revenue|margin|buy)/i.test(
        userText
      ))
  )
}

function isMarketResearchRequest(userText: string) {
  const hasMarketTopic =
    /(美股|股市|股票|板块|板塊|行业|行業|证券|證券|财报|財報|估值|投资|投資|买入|買入|购入|購入|sector|sectors|equity|equities|stock market|stock|stocks|etf|nasdaq|标普|標普|s&p|vix|fomc|cpi|pce|earnings|valuation|investment)/i.test(
      userText
    ) || hasTickerLikeInvestmentTarget(userText)
  const asksForAnalysis =
    /(研究|分析|涨|漲|上涨|上漲|值得|价值|價值|预测|預測|展望|机会|機會|风险|風險|rise|rally|outlook|which|what|forecast|predict|research|analy[sz]e|worth|buy)/i.test(
      userText
    )

  return hasMarketTopic && asksForAnalysis
}

function detectUserLanguage(userText: string) {
  const hanCount = (userText.match(/[\u3400-\u9fff]/g) ?? []).length
  const latinCount = (userText.match(/[a-z]/gi) ?? []).length
  if (hanCount > 0 && hanCount >= latinCount * 0.2) return 'Chinese'
  if (latinCount > 0) return 'English'
  return 'Unknown'
}

function buildLanguageGuidance(userText: string) {
  const appLanguage = i18n?.language || 'en'
  const userLanguage = detectUserLanguage(userText)
  return `Language guidance:
- User query language: ${userLanguage}.
- App language: ${appLanguage}.
- Think and respond primarily in the user's query language when it is clear.
- Keep visible labels, final wording, and clarifying questions compatible with the app language.
- If the user explicitly asks for another language, follow the user.`
}

function renderScenarioPlaybook(playbook?: MitaTeamsScenarioPlaybook) {
  if (!playbook) return 'Scenario playbook: none.'
  return `Scenario playbook: ${playbook.label}
- Default template: ${playbook.taskTemplateId}
- Default mode: ${playbook.mode}
- Required flow: ${playbook.flow
    .map(
      (roleId) =>
        playbook.roles.find((role) => role.id === roleId)?.name ??
        titleFromId(roleId)
    )
    .join(' -> ')}
- Required steps: verify current/live inputs or list missing evidence; produce conditional analysis; run skeptical review; only then summarize.
- Stop criteria: do not stop until every required flow role has a successful channel output. If live data cannot be retrieved, final answer must clearly state the missing inputs and avoid presenting guesses as predictions.`
}

function modelForRole(role: MitaTeamsRoleConfig): ThreadModel | undefined {
  if (!role.provider || !role.modelId) return undefined
  return {
    provider: role.provider,
    id: role.modelId,
  }
}

const MODEL_FAMILY_LABELS: Record<MitaTeamsModelFamily, string> = {
  chatgpt: 'ChatGPT/OpenAI/GPT',
  claude: 'Claude/Anthropic',
  gemini: 'Gemini/Google',
  grok: 'Grok/xAI',
  general: 'General',
}

const MODEL_FAMILY_GUIDANCE: Record<MitaTeamsModelFamily, string> = {
  chatgpt: 'code development, implementation, debugging, and direct problem solving',
  claude: 'complex research, architecture, long-form reasoning, and hard problem solving',
  gemini: 'UI/UX design, multimodal/interface thinking, and broad information retrieval',
  grok: 'information retrieval, fact checking, skepticism, and separating signal from noise',
  general: 'fallback work when no specialized family is available',
}

const familyFallbacks: Record<MitaTeamsModelFamily, MitaTeamsModelFamily[]> = {
  chatgpt: ['chatgpt', 'claude', 'gemini', 'grok', 'general'],
  claude: ['claude', 'chatgpt', 'gemini', 'grok', 'general'],
  gemini: ['gemini', 'grok', 'claude', 'chatgpt', 'general'],
  grok: ['grok', 'gemini', 'claude', 'chatgpt', 'general'],
  general: ['general', 'chatgpt', 'claude', 'gemini', 'grok'],
}

function modelFamilyFromText(
  providerName: string,
  modelId: string,
  label?: string
): MitaTeamsModelFamily {
  const text = `${providerName} ${modelId} ${label ?? ''}`.toLowerCase()
  if (/(claude|anthropic)/.test(text)) return 'claude'
  if (/(gemini|google)/.test(text)) return 'gemini'
  if (/(grok|xai|\bx\.ai\b)/.test(text)) return 'grok'
  if (/(chatgpt|gpt-|gpt_|gpt\d|openai|\bo[1-9]\b)/.test(text)) {
    return 'chatgpt'
  }
  return 'general'
}

function buildAvailableModelOptions(): MitaTeamsModelOption[] {
  const state = useModelProvider.getState()
  const options: MitaTeamsModelOption[] = []
  const seen = new Set<string>()

  for (const provider of state.providers) {
    for (const model of configuredChatModels(provider)) {
      const key = `${provider.provider}:${model.id}`
      if (seen.has(key)) continue
      seen.add(key)
      options.push({
        provider: provider.provider,
        modelId: model.id,
        label: model.displayName || model.name || model.model || model.id,
        family: modelFamilyFromText(
          provider.provider,
          model.id,
          model.displayName || model.name || model.model
        ),
        nativeWebSearch:
          provider.provider === 'jingxing' &&
          isJingxingNativeWebSearchModel(model.id),
      })
    }
  }

  const selectedProvider = state.selectedProvider
  const selectedModelId = state.selectedModel?.id
  if (selectedProvider && selectedModelId) {
    const selectedKey = `${selectedProvider}:${selectedModelId}`
    const index = options.findIndex(
      (option) =>
        option.provider === selectedProvider && option.modelId === selectedModelId
    )
    if (index > 0) {
      options.unshift(...options.splice(index, 1))
    } else if (!seen.has(selectedKey)) {
      options.unshift({
        provider: selectedProvider,
        modelId: selectedModelId,
        label:
          state.selectedModel?.displayName ||
          state.selectedModel?.name ||
          state.selectedModel?.model ||
          selectedModelId,
        family: modelFamilyFromText(
          selectedProvider,
          selectedModelId,
          state.selectedModel?.displayName ||
            state.selectedModel?.name ||
            state.selectedModel?.model
        ),
        nativeWebSearch:
          selectedProvider === 'jingxing' &&
          isJingxingNativeWebSearchModel(selectedModelId),
      })
    }
  }

  return options.slice(0, 32)
}

function renderModelAssignmentGuide(options: MitaTeamsModelOption[]) {
  const familyGuide = (
    ['chatgpt', 'claude', 'gemini', 'grok'] as MitaTeamsModelFamily[]
  )
    .map(
      (family) =>
        `- ${MODEL_FAMILY_LABELS[family]}: best for ${MODEL_FAMILY_GUIDANCE[family]}.`
    )
    .join('\n')

  if (options.length === 0) {
    return `${familyGuide}

Available configured chat models:
- No configured alternate chat models found. Keep the current role model unless the owner configures more providers.`
  }

  const groupedModels = (
    ['chatgpt', 'claude', 'gemini', 'grok', 'general'] as MitaTeamsModelFamily[]
  )
    .map((family) => {
      const models = options.filter((option) => option.family === family)
      if (models.length === 0) return undefined
      return `- ${MODEL_FAMILY_LABELS[family]}: ${models
        .slice(0, 6)
        .map(
          (model) =>
            `{provider:"${model.provider}", modelId:"${model.modelId}", label:"${model.label}", nativeWebSearch:${model.nativeWebSearch ? 'true' : 'false'}}`
        )
        .join('; ')}`
    })
    .filter(Boolean)
    .join('\n')

  return `${familyGuide}

Available configured chat models. When creating roles, include provider and modelId exactly from this list:
${groupedModels}`
}

function desiredModelFamilyForRole(
  role: Pick<
    MitaTeamsRoleConfig,
    'id' | 'name' | 'label' | 'description' | 'prompt'
  >
): MitaTeamsModelFamily {
  const text = [
    role.id,
    role.name,
    role.label,
    role.description,
    role.prompt,
  ]
    .join(' ')
    .toLowerCase()

  if (
    /(\bui\b|\bux\b|designer?|visual|interface|frontend|prototype|design|界面|体验|視覺|视觉|设计|設計|前端)/.test(
      text
    )
  ) {
    return 'gemini'
  }
  if (
    /(fact|truth|verify|verifier|skeptic|red[-\s]?team|source|web|news|anti[-\s]?hallucination|去伪|去偽|事实|事實|核验|查证|查證|辟谣|闢謠|来源|信源)/.test(
      text
    )
  ) {
    return 'grok'
  }
  if (
    /(code|coder|developer|engineer|builder|implement|debug|fix|qa|test|program|代码|代碼|开发|開發|工程|编程|編程|实现|實作|修复|修復|调试|調試|测试|測試)/.test(
      text
    )
  ) {
    return 'chatgpt'
  }
  if (
    /(research|analyst|architect|planner|strategy|complex|reason|solve|investigate|研究|调研|調研|分析|复杂|複雜|架构|架構|规划|規劃|策略|方案|推理)/.test(
      text
    )
  ) {
    return 'claude'
  }
  if (/(search|retrieval|检索|檢索|搜索|搜尋)/.test(text)) return 'gemini'

  return 'general'
}

function rolePrefersNativeWebSearch(
  role: Pick<
    MitaTeamsRoleConfig,
    'id' | 'name' | 'label' | 'description' | 'prompt'
  >
) {
  const text = [
    role.id,
    role.name,
    role.label,
    role.description,
    role.prompt,
  ]
    .join(' ')
    .toLowerCase()

  return /(data|scout|market|equity|investment|stock|ticker|finance|financial|analyst|fact|truth|verify|verifier|skeptic|source|web|search|retrieval|news|current|live|latest|数据|數據|行情|市场|市場|股票|投资|投資|估值|财报|財報|事实|事實|核验|核驗|查证|查證|来源|信源|检索|檢索|搜索|搜尋|最新|实时|實時|当前|當前)/.test(
    text
  )
}

function findAvailableModel(
  options: MitaTeamsModelOption[],
  provider?: string,
  modelId?: string
) {
  if (!provider || !modelId) return undefined
  return options.find(
    (option) => option.provider === provider && option.modelId === modelId
  )
}

function recommendedModelForRole(
  role: Pick<
    MitaTeamsRoleConfig,
    'id' | 'name' | 'label' | 'description' | 'prompt'
  >,
  options: MitaTeamsModelOption[]
) {
  const desiredFamily = desiredModelFamilyForRole(role)
  if (rolePrefersNativeWebSearch(role)) {
    for (const family of familyFallbacks[desiredFamily]) {
      const match = options.find(
        (option) => option.family === family && option.nativeWebSearch
      )
      if (match) return match
    }
  }

  for (const family of familyFallbacks[desiredFamily]) {
    const match = options.find((option) => option.family === family)
    if (match) return match
  }
  return options[0]
}

function resolveRoleModelConfig(role: MitaTeamsRoleConfig): {
  provider: ProviderObject
  providerName: string
  modelId: string
  parameters: Record<string, unknown>
  threadModel: ThreadModel
} {
  const providerState = useModelProvider.getState()
  const providerName = role.provider ?? providerState.selectedProvider
  const modelId =
    role.modelId ??
    providerState.selectedModel?.id ??
    defaultModel(providerName)
  const provider = providerState.getProviderByName(providerName)

  if (!provider) {
    throw new Error(`Provider ${providerName} is not configured`)
  }

  const parameters = useAssistant.getState().currentAssistant?.parameters ?? {}

  return {
    provider,
    providerName,
    modelId,
    parameters,
    threadModel: {
      provider: providerName,
      id: modelId,
    },
  }
}

async function createLanguageModelForRole(
  role: MitaTeamsRoleConfig
): Promise<{ model: LanguageModel; threadModel: ThreadModel }> {
  const resolved = resolveRoleModelConfig(role)
  const model = await ModelFactory.createModel(
    resolved.modelId,
    resolved.provider,
    resolved.parameters
  )

  return {
    model,
    threadModel: resolved.threadModel,
  }
}

function maxOutputTokensFromParameters(
  parameters: Record<string, unknown>
): number | undefined {
  const value = parameters.max_output_tokens
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined
}

function rolePromptAsUiMessages(prompt: string): UIMessage[] {
  return [
    {
      id: stableId('mita-role-web'),
      role: 'user',
      parts: [{ type: 'text', text: prompt }],
    },
  ] as UIMessage[]
}

function finishUsageFromMetadata(metadata: unknown) {
  const usage = asRecord(metadata)?.usage
  return usage && typeof usage === 'object' ? usage : undefined
}

function appendNativeSearchSources(
  text: string,
  sources: Array<{ url: string; title?: string }>
) {
  if (sources.length === 0 || /(?:^|\n)(?:sources?|来源|參考|参考)[:：]/i.test(text)) {
    return text
  }

  const sourceList = sources
    .slice(0, 6)
    .map((source) => `- ${source.title ? `${source.title} ` : ''}${source.url}`)
    .join('\n')
  return `${text.trim()}\n\nSources:\n${sourceList}`
}

async function generateJingxingNativeWebSearchRoleText({
  resolved,
  role,
  prompt,
  abortSignal,
  onDelta,
}: {
  resolved: ReturnType<typeof resolveRoleModelConfig>
  role: MitaTeamsRoleConfig
  prompt: string
  abortSignal?: AbortSignal
  onDelta?: (delta: string) => void
}) {
  const stream = streamJingxingNativeWebSearch({
    modelId: resolved.modelId,
    provider: resolved.provider,
    messages: rolePromptAsUiMessages(prompt),
    system: role.prompt,
    maxOutputTokens: maxOutputTokensFromParameters(resolved.parameters),
    abortSignal,
  })
  const reader = stream.getReader()
  const sources: Array<{ url: string; title?: string }> = []
  let text = ''
  let usage: unknown

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value || typeof value !== 'object') continue

    if (value.type === 'text-delta' && 'delta' in value) {
      const delta = typeof value.delta === 'string' ? value.delta : ''
      text += delta
      onDelta?.(delta)
      continue
    }

    if (value.type === 'source-url' && 'url' in value) {
      const url = typeof value.url === 'string' ? value.url : ''
      const title =
        'title' in value && typeof value.title === 'string'
          ? value.title
          : undefined
      if (url && !sources.some((source) => source.url === url)) {
        sources.push(title ? { url, title } : { url })
      }
      continue
    }

    if (value.type === 'finish' && 'messageMetadata' in value) {
      usage = finishUsageFromMetadata(value.messageMetadata)
    }
  }

  return {
    text: appendNativeSearchSources(text, sources),
    usage,
  }
}

async function defaultGenerateRoleText({
  role,
  prompt,
  webSearch,
  abortSignal,
  onDelta,
}: Parameters<GenerateRoleText>[0]) {
  const resolved = resolveRoleModelConfig(role)
  const messages = rolePromptAsUiMessages(prompt)

  if (
    webSearch?.enabled &&
    canUseJingxingNativeWebSearch({
      providerName: resolved.providerName,
      modelId: resolved.modelId,
      messages,
    })
  ) {
    return generateJingxingNativeWebSearchRoleText({
      resolved,
      role,
      prompt,
      abortSignal,
      onDelta,
    })
  }

  const model = await ModelFactory.createModel(
    resolved.modelId,
    resolved.provider,
    resolved.parameters
  )
  const result = streamText({
    model,
    prompt,
    abortSignal,
    system: role.prompt,
  })
  let text = ''

  for await (const delta of result.textStream) {
    text += delta
    onDelta?.(delta)
  }

  return {
    text,
    usage: await result.usage,
  }
}

async function defaultGenerateDecisionText({
  prompt,
  model,
  abortSignal,
}: {
  prompt: string
  model?: ThreadModel
  abortSignal?: AbortSignal
}) {
  const role: MitaTeamsRoleConfig = {
    id: MITA_TEAMS_ORCHESTRATOR_ROLE_ID,
    name: 'Orchestrator',
    label: 'Host',
    description: 'Coordinate the team.',
    prompt:
      'You are the Mita Teams Orchestrator. Output compact valid JSON only.',
    color: 'bg-primary',
    permission: 'tools',
    provider: model?.provider,
    modelId: model?.id,
    enabled: true,
  }
  const { model: languageModel } = await createLanguageModelForRole(role)
  const result = await generateText({
    model: languageModel,
    prompt,
    abortSignal,
    system:
      'You are the Mita Teams Orchestrator. Decide the next execution step. Output valid JSON only.',
  })

  return {
    text: result.text,
    usage: result.usage,
  }
}

function renderRecentOutputs(outputs: RoleOutput[]) {
  if (outputs.length === 0) return 'No role outputs yet.'

  return outputs
    .slice(-8)
    .map((item) => {
      const channel = item.channelId ? ` in #${item.channelId}` : ''
      return `## ${item.roleName}${channel}\n${trimText(item.output, 900)}`
    })
    .join('\n\n')
}

function renderChannelRoster(config: MitaTeamsConfig) {
  if (config.channels.length === 0) return 'No channels yet.'

  return config.channels
    .map((channel) => {
      const roleIds = channel.roleIds.length
        ? channel.roleIds.join(', ')
        : 'none'
      return `- ${channel.id}: #${channel.label} roles=[${roleIds}] ${channel.description}`
    })
    .join('\n')
}

function parseUserControl(
  userText: string,
  config: MitaTeamsConfig
): MitaTeamsUserControl {
  const mentionTokens = [...userText.matchAll(/@([^\s@，,。:：]+)/g)].map(
    (match) => match[1]
  )
  const roleMatches = new Set<MitaTeamsRoleId>()

  for (const token of mentionTokens) {
    const normalized = normalizeMitaTeamsId(token, '')
    const lower = token.trim().toLowerCase()
    const role = config.roles.find(
      (item) =>
        item.id === normalized ||
        item.id.toLowerCase() === lower ||
        item.name.toLowerCase() === lower ||
        item.label.toLowerCase() === lower
    )
    if (role) roleMatches.add(role.id)
  }

  const mentionedRoleIds = [...roleMatches]
  const onlyRequested =
    mentionedRoleIds.length > 0 &&
    /(只让|只叫|只要|仅让|僅讓|只让|only|solo)/i.test(userText)
  const shouldContinue = /(继续|繼續|接着|接著|resume|continue)/i.test(userText)
  const shouldPause =
    !shouldContinue &&
    /(暂停|暫停|先停|停一下|\/pause|\bpause\b|\bstop\b)/i.test(userText)
  const shouldConverge =
    /(收敛|收斂|总结|總結|给结论|給結論|converge|final)/i.test(userText)

  return {
    mentionedRoleIds,
    onlyRoleIds: onlyRequested ? mentionedRoleIds : [],
    shouldPause,
    shouldContinue,
    shouldConverge,
  }
}

function renderUserControl(control: MitaTeamsUserControl) {
  const parts = [
    control.mentionedRoleIds.length
      ? `Mentioned roles: ${control.mentionedRoleIds.join(', ')}.`
      : undefined,
    control.onlyRoleIds.length
      ? `Owner requested only these roles to speak: ${control.onlyRoleIds.join(', ')}.`
      : undefined,
    control.shouldConverge
      ? 'Owner requested convergence or a final answer.'
      : undefined,
    control.shouldContinue
      ? 'Owner requested the team to continue.'
      : undefined,
  ].filter(Boolean)

  return parts.length ? parts.join('\n') : 'No explicit owner controls.'
}

function hasReusableTeam(config: MitaTeamsConfig) {
  const hasSpecialistRole = config.roles.some(
    (role) => role.enabled && role.id !== MITA_TEAMS_ORCHESTRATOR_ROLE_ID
  )
  if (!hasSpecialistRole) return false

  const runStatus = config.runtime.run?.status
  const hasRunHistory =
    Boolean(runStatus && runStatus !== 'running') ||
    config.runtime.teamEvents.some(
      (event) =>
        event.type === 'team_configured' ||
        event.type === 'role_called' ||
        event.type === 'run_completed'
    ) ||
    Object.values(config.runtime.roleStates).some(
      (state) => state.stream.length > 0 || state.memory.version > 0
    )

  return hasRunHistory
}

function renderTeamContinuityGuidance(preferTeamReuse: boolean) {
  if (!preferTeamReuse) {
    return 'Team continuity: this appears to be a new Mita Teams task.'
  }

  return `Team continuity: this is a follow-up in an existing Mita Teams thread.
- The current roles and channels are already configured; prefer reusing the configured team with call_roles.
- Use configure_team only to add genuinely missing specialist roles or channels.
- Do not recreate, rename, overwrite, or change the prompt/provider/model of existing roles.
- Do not change the chosen task template, mode, scenario, or established channels unless the owner explicitly asks for a new team structure.`
}

function renderWorkflowControlGuidance(
  workflowSpec?: MitaTeamsUserWorkflowSpec
) {
  if (!workflowSpec?.explicit) return 'Workflow control: automatic team design.'

  const roles = workflowSpec.roles.length
    ? workflowSpec.roles
        .map((role) =>
          role.modelId ? `- ${role.name}: ${role.modelId}` : `- ${role.name}`
        )
        .join('\n')
    : '- Reuse the roles already configured in this thread.'
  const channel = workflowSpec.channelLabel
    ? `\nOwner-defined channel: #${workflowSpec.channelLabel}`
    : ''

  return `Workflow control: the owner supplied an explicit workflow.
Allowed owner-defined roles:
${roles}${channel}
- Do not invent fallback roles, market-research roles, template roles, or extra channels.
- If a needed role/model/channel is missing or unavailable, ask the owner instead of silently replacing it.
- Configure only the roles and channels described by the owner workflow, then call them in the owner-specified order.`
}

function buildDecisionPrompt({
  config,
  runtime,
  userText,
  threadTitle,
  recentOutputs,
  userControl,
  modelOptions,
  scenarioPlaybook,
  languageGuidance,
  preferTeamReuse,
  workflowSpec,
}: {
  config: MitaTeamsConfig
  runtime: MitaTeamsRuntime
  userText: string
  threadTitle?: string
  recentOutputs: RoleOutput[]
  userControl: MitaTeamsUserControl
  modelOptions: MitaTeamsModelOption[]
  scenarioPlaybook?: MitaTeamsScenarioPlaybook
  languageGuidance: string
  preferTeamReuse: boolean
  workflowSpec?: MitaTeamsUserWorkflowSpec
}) {
  const roles = config.roles
    .filter((role) => role.enabled)
    .map(
      (role) =>
        `- ${role.id}: ${role.name} (${role.permission}) model=${role.provider ?? 'unset'}/${role.modelId ?? 'unset'} ${role.description}`
    )
    .join('\n')
  const memory = projectMemoryText(runtime.projectMemory) || 'No memory yet.'
  const maxRounds = runtime.run?.maxRounds ?? config.roundLimit
  const currentRound = runtime.run?.currentRound ?? 0
  const taskTemplate =
    MITA_TEAMS_TASK_TEMPLATES.find(
      (template) => template.id === config.taskTemplateId
    ) ?? MITA_TEAMS_TASK_TEMPLATES[0]

  return `You are the Orchestrator for Mita Teams.

Thread title: ${threadTitle || 'Mita Teams'}
Owner request or latest choice:
${userText}

${languageGuidance}

${renderScenarioPlaybook(scenarioPlaybook)}

Mode: ${modeDescription(config)}
Mode operating guidance:
${modeOperationalGuidance(config)}
Task template: ${taskTemplate.label}
Template guidance: ${taskTemplate.orchestratorHint}
Recommended role ids: ${taskTemplate.recommendedRoleIds.join(', ') || 'none'}
Default flow: ${taskTemplate.defaultFlow.join(' -> ')}
Round: ${currentRound} / ${maxRounds}

${renderTeamContinuityGuidance(preferTeamReuse)}

${renderWorkflowControlGuidance(workflowSpec)}

Available enabled roles:
${roles}

Channels:
${renderChannelRoster(config)}

Project memory:
${memory}

Recent role outputs:
${renderRecentOutputs(recentOutputs)}

Owner controls:
${renderUserControl(userControl)}

Model assignment guide:
${renderModelAssignmentGuide(modelOptions)}

Choose exactly one next action. Output valid JSON only.

Allowed shapes:
1. {"action":"configure_team","reason":"...","roles":[{"id":"researcher","name":"Researcher","label":"Research","description":"...","prompt":"...","permission":"read","provider":"anthropic","modelId":"claude-..."}],"channels":[{"id":"research","label":"Research","description":"...","roleIds":["researcher"]}],"mode":"parallel|serial|hybrid","calls":[{"roleId":"researcher","channelId":"research","instruction":"...","requiredPermission":"read","group":1}],"updates":{"tasks":[{"title":"Inspect evidence","status":"researching","roleId":"researcher","channelId":"research"}],"artifacts":[{"type":"decision","title":"Scope","summary":"..."}]}}
2. {"action":"call_roles","mode":"parallel|serial|hybrid","reason":"...","calls":[{"roleId":"researcher","channelId":"research","instruction":"...","requiredPermission":"read","group":1}],"updates":{"tasks":[{"title":"Review answer","status":"reviewing"}],"artifacts":[{"type":"risk","title":"Main risk","summary":"..."}]}}
3. {"action":"ask_user","reason":"...","question":"...","options":[{"id":"a","label":"Option A","description":"..."}]}
4. {"action":"milestone","reason":"...","milestone":"..."}
5. {"action":"stop","reason":"...","finalResponse":"...","updates":{"artifacts":[{"type":"final_draft","title":"Final answer","summary":"...","content":"..."}]}}

Rules:
- New teams start with only the Orchestrator and the main task channel.
- If specialist work is needed, first create only the minimum useful roles and channels with configure_team.
- For follow-up owner messages in an existing team, prefer call_roles with existing roleIds/channelIds before configuring anything new.
- In follow-up runs, configure_team is additive only: include only new roles/channels that do not already exist.
- Assign each newly created role a provider/modelId from the model assignment guide when a suitable configured model exists.
- Prefer model diversity by role strength: GPT for code/build/debug, Claude for complex research/reasoning, Gemini for UI/UX or broad retrieval, Grok for fact-checking/skepticism.
- If no suitable configured model exists for a role, reuse the current model instead of inventing unavailable provider/modelId values.
- For current market, investment, news, or fact-checking roles, prefer models marked nativeWebSearch:true so roles can retrieve live data before analysis.
- #${MITA_TEAMS_TASK_CHANNEL_ID} / Current task is delivery-only: owner messages, choices, and final answer. Do not schedule specialist role calls or internal agent discussion there.
- Create or use non-task channels such as research, discussion, build, or review for team discussion. Every specialist role call must use a non-task channelId.
- Pick role calls only from enabled roles, and include the most relevant channelId for each call.
- Orchestrator-hosted discussion must stay in channels. Every role call from a team run needs a channelId; direct role chats are separate private records.
- Each channel should include only the roleIds that should participate there.
- Use updates.tasks for visible task-board progress and updates.artifacts for decisions, risks, test results, artifacts, and final drafts.
- Respect permissions: read roles gather and critique, tools roles may request tool-backed work, write roles may plan concrete file edits.
- If the owner mentioned roles, prefer those roles. If the owner requested only those roles, do not call anyone else.
- If the owner asked to converge, prefer stop with a final_draft artifact unless one narrow role call is essential.
- Use hybrid when useful: roles with the same group run in parallel; groups run serially.
- Ask the owner only when a real single-choice decision is needed.
- Stop when the team has reached a useful milestone or can give a clear answer.
- Never claim separate private LLM calls happened unless this runtime actually scheduled role calls.`
}

function webSearchRequirementForRoleCall({
  config,
  role,
  call,
  userText,
}: {
  config: MitaTeamsConfig
  role: MitaTeamsRoleConfig
  call: MitaTeamsRoleCallPlan
  userText: string
}): MitaTeamsRoleWebSearchRequest | undefined {
  const combined = [userText, call.instruction, role.description, role.prompt]
    .join('\n')
    .trim()

  if (config.scenarioId === 'market_research') {
    return {
      enabled: true,
      reason:
        'this task needs current market or investment data before analysis.',
    }
  }

  const mentionsCurrentData =
    /(当前|目前|现在|最新|实时|實時|今日|今天|明日|明天|新闻|新聞|行情|财报|財報|公告|来源|信源|检索|檢索|搜索|搜尋|查证|查證|核验|核驗|current|latest|live|real[-\s]?time|today|tomorrow|news|source|search|verify|fact[-\s]?check)/i.test(
      combined
    )
  const isMarketOrResearch =
    isMarketResearchRequest(combined) ||
    /(market|equity|stock|ticker|investment|valuation|earnings|finance|financial|research|调查|調查|调研|調研|研究|分析|投资|投資|估值|股票|财报|財報)/i.test(
      combined
    )

  if (mentionsCurrentData && (isMarketOrResearch || rolePrefersNativeWebSearch(role))) {
    return {
      enabled: true,
      reason:
        'this role call asks for current market or investment data and source verification.',
    }
  }

  return undefined
}

function renderRoleWebSearchGuidance(
  webSearch?: MitaTeamsRoleWebSearchRequest
) {
  if (!webSearch?.enabled) return ''
  return `Native web search is requested for this role call because ${webSearch.reason}
- Use the assigned model/provider's native web search or retrieval before analysis when available.
- Ground current claims in source names and URLs. Include the latest price/date/filing/earnings facts when relevant.
- If native search is unavailable for your assigned model, rely only on verified upstream role outputs, clearly list missing live inputs, and avoid making a current buy/sell prediction from stale memory.`
}

function buildRolePrompt({
  config,
  role,
  runtime,
  userText,
  call,
  recentOutputs,
  languageGuidance,
  webSearch,
}: {
  config: MitaTeamsConfig
  role: MitaTeamsRoleConfig
  runtime: MitaTeamsRuntime
  userText: string
  call: MitaTeamsRoleCallPlan
  recentOutputs: RoleOutput[]
  languageGuidance: string
  webSearch?: MitaTeamsRoleWebSearchRequest
}) {
  const projectMemory =
    projectMemoryText(runtime.projectMemory) || 'No shared project memory yet.'
  const ownMemory =
    roleMemoryText(
      runtime.roleStates[role.id]?.memory ?? {
        roleId: role.id,
        version: 0,
        summary: '',
        facts: [],
        decisions: [],
        openQuestions: [],
        workingNotes: [],
        updatedAt: nowIso(),
      }
    ) || 'No role memory yet.'
  const channel = channelById(config, call.channelId)
  const channelContext = call.channelId
    ? `#${channel?.label ?? call.channelId}: ${channel?.description ?? 'No channel description.'}`
    : 'Main task channel.'
  const permissionRules =
    role.permission === 'write'
      ? 'You may propose concrete edits and implementation steps. Do not claim files were changed unless the host app executed those changes.'
      : role.permission === 'tools'
        ? 'You may request tool-backed checks or commands, but do not claim file writes.'
        : 'Read-only role: gather, analyze, critique, and summarize. Do not claim tool use, command execution, or file edits.'

  return `You are ${role.name} in Mita Teams.

Role prompt:
${role.prompt}

Owner request:
${userText}

${languageGuidance}

Channel for this turn:
${channelContext}

Permission for this turn:
${role.permission}. ${permissionRules}

Orchestrator instruction for this turn:
${call.instruction}

${renderRoleWebSearchGuidance(webSearch)}

Shared project memory:
${projectMemory}

Your role memory:
${ownMemory}

Recent upstream role outputs:
${renderRecentOutputs(recentOutputs)}

Respond as ${role.name}. Be concise, concrete, and useful. End with any facts, decisions, risks, or open questions that should be remembered.`
}

function buildPrivateRoleChatPrompt({
  role,
  runtime,
  userText,
  languageGuidance,
}: {
  role: MitaTeamsRoleConfig
  runtime: MitaTeamsRuntime
  userText: string
  languageGuidance: string
}) {
  const projectMemory =
    projectMemoryText(runtime.projectMemory) || 'No shared project memory yet.'
  const privateHistory =
    runtime.roleStates[role.id]?.stream
      .filter((message) => !message.channelId)
      .slice(-8)
      .map((message) => {
        const speaker = message.role === 'assistant' ? role.name : 'Owner'
        return `${speaker}: ${trimText(message.content, 800)}`
      })
      .join('\n') || 'No previous private messages.'
  const permissionRules =
    role.permission === 'write'
      ? 'You may propose concrete edits and implementation steps. Do not claim files were changed unless the host app executed those changes.'
      : role.permission === 'tools'
        ? 'You may suggest tool-backed checks, but do not claim tool execution.'
        : 'Read-only role: gather, analyze, critique, and summarize. Do not claim tool use, command execution, or file edits.'

  return `You are ${role.name} in a private Mita Teams role chat.

This is a direct chat between the owner and ${role.name}. It is separate from channel-hosted team discussion. Do not simulate the Orchestrator, other roles, or a team run.

Role prompt:
${role.prompt}

Owner private message:
${userText}

${languageGuidance}

Permission:
${role.permission}. ${permissionRules}

Shared project memory for background only:
${projectMemory}

Recent private chat history:
${privateHistory}

Respond as ${role.name}. Keep the answer concise, concrete, and useful.`
}

function extractJsonObject(text: string) {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return undefined
  return text.slice(start, end + 1)
}

function isRoleId(value: unknown): value is MitaTeamsRoleId {
  return typeof value === 'string' && normalizeMitaTeamsId(value, '') === value
}

function isChannelId(value: unknown): value is MitaTeamsChannelId {
  return typeof value === 'string' && normalizeMitaTeamsId(value, '') === value
}

function isPermission(
  value: unknown
): value is MitaTeamsRoleConfig['permission'] {
  return value === 'read' || value === 'tools' || value === 'write'
}

function isExecutionMode(value: unknown): value is MitaTeamsExecutionMode {
  return value === 'parallel' || value === 'serial' || value === 'hybrid'
}

function titleFromId(id: string) {
  return (
    id
      .split(/[-_]+/)
      .filter(Boolean)
      .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
      .join(' ') || 'Role'
  )
}

function colorForIndex(index: number) {
  return (
    MITA_TEAMS_ROLE_COLORS[index % MITA_TEAMS_ROLE_COLORS.length]?.value ??
    'bg-slate-500'
  )
}

function normalizeChoiceOptions(value: unknown): MitaTeamsChoiceOption[] {
  if (!Array.isArray(value)) return []
  const seenOptionIds = new Set<string>()
  return value
    .map((item, index): MitaTeamsChoiceOption | undefined => {
      if (!item || typeof item !== 'object') return undefined
      const raw = item as Partial<MitaTeamsChoiceOption>
      if (typeof raw.label !== 'string') return undefined
      const label = raw.label.trim()
      if (!label) return undefined
      const fallback = `option-${index + 1}`
      const base =
        normalizeMitaTeamsId(raw.id, '') ||
        normalizeMitaTeamsId(label, '') ||
        fallback
      let id = base
      let suffix = 2
      while (seenOptionIds.has(id)) {
        id = `${base}-${suffix}`
        suffix += 1
      }
      seenOptionIds.add(id)
      const option: MitaTeamsChoiceOption = {
        id,
        label,
      }
      if (typeof raw.description === 'string') {
        option.description = raw.description.trim()
      }
      return option
    })
    .filter((item): item is MitaTeamsChoiceOption => item !== undefined)
    .slice(0, 4)
}

function channelContainsRole(
  channel: MitaTeamsChannelConfig,
  roleId: MitaTeamsRoleId
) {
  return channel.roleIds.includes(roleId)
}

function findChannelForRole(config: MitaTeamsConfig, roleId: MitaTeamsRoleId) {
  return config.channels.find((channel) => channelContainsRole(channel, roleId))
}

function findDiscussionChannelForRole(
  config: MitaTeamsConfig,
  roleId: MitaTeamsRoleId
) {
  return config.channels.find(
    (channel) =>
      channel.id !== MITA_TEAMS_TASK_CHANNEL_ID &&
      channelContainsRole(channel, roleId)
  )
}

function normalizeCalls(
  value: unknown,
  config: MitaTeamsConfig,
  options: { onlyRoleIds?: MitaTeamsRoleId[] } = {}
): MitaTeamsRoleCallPlan[] {
  if (!Array.isArray(value)) return []
  const enabledIds = new Set(
    config.roles.filter((r) => r.enabled).map((r) => r.id)
  )
  const channelIds = new Set(config.channels.map((channel) => channel.id))
  const onlyRoleIds = new Set(options.onlyRoleIds ?? [])

  return value
    .map((item): MitaTeamsRoleCallPlan | undefined => {
      if (!item || typeof item !== 'object') return undefined
      const raw = item as Partial<MitaTeamsRoleCallPlan>
      const roleId = normalizeMitaTeamsId(raw.roleId, '')
      if (!isRoleId(roleId) || !enabledIds.has(roleId)) return undefined
      if (roleId === MITA_TEAMS_ORCHESTRATOR_ROLE_ID) return undefined
      if (onlyRoleIds.size > 0 && !onlyRoleIds.has(roleId)) return undefined
      const role = roleById(config, roleId)
      if (!role) return undefined
      const requiredPermission = isPermission(raw.requiredPermission)
        ? raw.requiredPermission
        : undefined
      if (!permissionMeets(role.permission, requiredPermission))
        return undefined
      const requestedChannelId = normalizeMitaTeamsId(raw.channelId, '')
      let channelId =
        requestedChannelId && channelIds.has(requestedChannelId)
          ? requestedChannelId
          : findChannelForRole(config, roleId)?.id
      if (
        channelId === MITA_TEAMS_TASK_CHANNEL_ID &&
        roleId !== MITA_TEAMS_ORCHESTRATOR_ROLE_ID
      ) {
        channelId = findDiscussionChannelForRole(config, roleId)?.id
      }
      const channel = channelById(config, channelId)
      if (!channel) return undefined
      if (!channelContainsRole(channel, roleId)) return undefined
      const call: MitaTeamsRoleCallPlan = {
        roleId,
        channelId: channel?.id,
        instruction:
          typeof raw.instruction === 'string'
            ? raw.instruction
            : 'Contribute your role perspective.',
      }
      if (requiredPermission) call.requiredPermission = requiredPermission
      if (isExecutionMode(raw.mode)) call.mode = raw.mode
      if (Array.isArray(raw.dependsOn)) {
        const dependsOn = raw.dependsOn
          .map((id) => normalizeMitaTeamsId(id, ''))
          .filter(
            (id): id is MitaTeamsRoleId => isRoleId(id) && enabledIds.has(id)
          )
        if (dependsOn.length > 0) call.dependsOn = dependsOn
      }
      if (typeof raw.group === 'number' && Number.isFinite(raw.group)) {
        call.group = raw.group
      }
      return call
    })
    .filter((item): item is MitaTeamsRoleCallPlan => item !== undefined)
    .slice(0, 8)
}

function normalizeDecisionRoles(
  value: unknown,
  config: MitaTeamsConfig,
  modelOptions: MitaTeamsModelOption[] = []
): MitaTeamsRoleConfig[] {
  if (!Array.isArray(value)) return []
  const orchestrator = roleById(config, MITA_TEAMS_ORCHESTRATOR_ROLE_ID)
  const modelSource = orchestrator ?? config.roles[0]

  return value
    .map((item, index): MitaTeamsRoleConfig | undefined => {
      if (!item || typeof item !== 'object') return undefined
      const raw = item as Partial<MitaTeamsRoleConfig>
      const id = normalizeMitaTeamsId(raw.id, '')
      if (!isRoleId(id) || id === MITA_TEAMS_ORCHESTRATOR_ROLE_ID) {
        return undefined
      }

      const existing = roleById(config, id)
      const name =
        typeof raw.name === 'string' && raw.name.trim()
          ? raw.name.trim()
          : (existing?.name ?? titleFromId(id))
      const prompt =
        typeof raw.prompt === 'string' && raw.prompt.trim()
          ? raw.prompt.trim()
          : (existing?.prompt ??
            `You are ${name}. Contribute only the perspective requested by the Orchestrator.`)
      const recommendedModel = recommendedModelForRole(
        {
          id,
          name,
          label:
            typeof raw.label === 'string' && raw.label.trim()
              ? raw.label.trim()
              : (existing?.label ?? name.slice(0, 12)),
          description:
            typeof raw.description === 'string' && raw.description.trim()
              ? raw.description.trim()
              : (existing?.description ?? `Specialist role for ${name}.`),
          prompt,
        },
        modelOptions
      )
      const explicitModel = findAvailableModel(
        modelOptions,
        typeof raw.provider === 'string' ? raw.provider : undefined,
        typeof raw.modelId === 'string' ? raw.modelId : undefined
      )

      return {
        id,
        name,
        label:
          typeof raw.label === 'string' && raw.label.trim()
            ? raw.label.trim()
            : (existing?.label ?? name.slice(0, 12)),
        description:
          typeof raw.description === 'string' && raw.description.trim()
            ? raw.description.trim()
            : (existing?.description ?? `Specialist role for ${name}.`),
        prompt,
        color:
          typeof raw.color === 'string' && raw.color.trim()
            ? raw.color.trim()
            : (existing?.color ?? colorForIndex(config.roles.length + index)),
        permission: isPermission(raw.permission)
          ? raw.permission
          : (existing?.permission ?? 'read'),
        provider:
          explicitModel?.provider ??
          existing?.provider ??
          recommendedModel?.provider ??
          modelSource?.provider,
        modelId:
          explicitModel?.modelId ??
          existing?.modelId ??
          recommendedModel?.modelId ??
          modelSource?.modelId,
        enabled: raw.enabled !== false,
      }
    })
    .filter((item): item is MitaTeamsRoleConfig => item !== undefined)
    .slice(0, 8)
}

function mergeRoles(
  currentRoles: MitaTeamsRoleConfig[],
  incomingRoles: MitaTeamsRoleConfig[]
) {
  const byId = new Map(currentRoles.map((role) => [role.id, role]))

  for (const role of incomingRoles) {
    const existing = byId.get(role.id)
    byId.set(role.id, existing ? { ...existing, ...role } : role)
  }

  return Array.from(byId.values())
}

function normalizeDecisionChannels(
  value: unknown,
  config: MitaTeamsConfig,
  roles: MitaTeamsRoleConfig[]
): MitaTeamsChannelConfig[] {
  if (!Array.isArray(value)) return []
  const validRoleIds = new Set(roles.map((role) => role.id))

  return value
    .map((item): MitaTeamsChannelConfig | undefined => {
      if (!item || typeof item !== 'object') return undefined
      const raw = item as Partial<MitaTeamsChannelConfig>
      const id = normalizeMitaTeamsId(raw.id, '')
      if (!isChannelId(id)) return undefined

      const existing = channelById(config, id)
      const label =
        typeof raw.label === 'string' && raw.label.trim()
          ? raw.label.trim()
          : (existing?.label ?? titleFromId(id))
      const roleIds = Array.isArray(raw.roleIds)
        ? raw.roleIds
            .map((roleId) => normalizeMitaTeamsId(roleId, ''))
            .filter(
              (roleId): roleId is MitaTeamsRoleId =>
                isRoleId(roleId) && validRoleIds.has(roleId)
            )
        : []
      const fallbackRoleIds =
        existing?.roleIds.filter((roleId) => validRoleIds.has(roleId)) ??
        (id === MITA_TEAMS_TASK_CHANNEL_ID &&
        validRoleIds.has(MITA_TEAMS_ORCHESTRATOR_ROLE_ID)
          ? [MITA_TEAMS_ORCHESTRATOR_ROLE_ID]
          : [])

      return {
        id,
        label,
        description:
          typeof raw.description === 'string' && raw.description.trim()
            ? raw.description.trim()
            : (existing?.description ?? `Focused room for ${label}.`),
        roleIds: roleIds.length ? [...new Set(roleIds)] : fallbackRoleIds,
      }
    })
    .filter((item): item is MitaTeamsChannelConfig => item !== undefined)
    .slice(0, 8)
}

function mergeChannels(
  currentChannels: MitaTeamsChannelConfig[],
  incomingChannels: MitaTeamsChannelConfig[]
) {
  const byId = new Map(currentChannels.map((channel) => [channel.id, channel]))

  for (const channel of incomingChannels) {
    const existing = byId.get(channel.id)
    byId.set(channel.id, existing ? { ...existing, ...channel } : channel)
  }

  return Array.from(byId.values())
}

function defaultDiscussionChannel(roleIds: MitaTeamsRoleId[] = []) {
  const template = MITA_TEAMS_CHANNELS.find(
    (channel) => channel.id === 'discussion'
  )

  return {
    ...(template ?? {
      id: 'discussion',
      label: 'Discussion',
      description:
        'Compare options, resolve disagreements, and align the team.',
      roleIds: [],
    }),
    roleIds,
  } satisfies MitaTeamsChannelConfig
}

function normalizeChannelMembership(
  channels: MitaTeamsChannelConfig[],
  roles: MitaTeamsRoleConfig[]
) {
  const validRoleIds = new Set(roles.map((role) => role.id))
  const taskDiscussionRoleIds = new Set<MitaTeamsRoleId>()

  const normalizedChannels = channels.map((channel) => {
    const roleIds = channel.roleIds.filter((roleId) => validRoleIds.has(roleId))
    if (channel.id === MITA_TEAMS_TASK_CHANNEL_ID) {
      roleIds
        .filter((roleId) => roleId !== MITA_TEAMS_ORCHESTRATOR_ROLE_ID)
        .forEach((roleId) => taskDiscussionRoleIds.add(roleId))

      return {
        ...channel,
        roleIds: validRoleIds.has(MITA_TEAMS_ORCHESTRATOR_ROLE_ID)
          ? [MITA_TEAMS_ORCHESTRATOR_ROLE_ID]
          : [],
      }
    }

    const taskRoleIds =
      channel.id === MITA_TEAMS_TASK_CHANNEL_ID &&
      validRoleIds.has(MITA_TEAMS_ORCHESTRATOR_ROLE_ID) &&
      !roleIds.includes(MITA_TEAMS_ORCHESTRATOR_ROLE_ID)
        ? [MITA_TEAMS_ORCHESTRATOR_ROLE_ID, ...roleIds]
        : roleIds
    if (
      taskRoleIds.length === 0 &&
      channel.id === MITA_TEAMS_TASK_CHANNEL_ID &&
      validRoleIds.has(MITA_TEAMS_ORCHESTRATOR_ROLE_ID)
    ) {
      return {
        ...channel,
        roleIds: [MITA_TEAMS_ORCHESTRATOR_ROLE_ID],
      }
    }

    return {
      ...channel,
      roleIds: taskRoleIds,
    }
  })

  if (taskDiscussionRoleIds.size === 0) return normalizedChannels

  const discussionRoleIds = Array.from(taskDiscussionRoleIds)
  let mergedIntoDiscussion = false
  const channelsWithDiscussion = normalizedChannels.map((channel) => {
    if (channel.id !== 'discussion') return channel
    mergedIntoDiscussion = true
    return {
      ...channel,
      roleIds: Array.from(new Set([...channel.roleIds, ...discussionRoleIds])),
    }
  })

  if (mergedIntoDiscussion) return channelsWithDiscussion

  return [
    ...channelsWithDiscussion,
    defaultDiscussionChannel(discussionRoleIds),
  ]
}

function applyScenarioPlaybook(
  config: MitaTeamsConfig,
  playbook: MitaTeamsScenarioPlaybook | undefined,
  modelOptions: MitaTeamsModelOption[]
): MitaTeamsConfig {
  if (!playbook) return config

  const playbookRoles = normalizeDecisionRoles(
    playbook.roles,
    config,
    modelOptions
  )
  const roles = mergeRoles(config.roles, playbookRoles)
  const channelConfig = { ...config, roles }
  const playbookChannels = normalizeDecisionChannels(
    playbook.channels,
    channelConfig,
    roles
  )
  const channels = normalizeChannelMembership(
    mergeChannels(config.channels, playbookChannels),
    roles
  )
  const activeChannel = channels.some((channel) => channel.id === 'research')
    ? 'research'
    : config.activeChannel
  const nextConfig: MitaTeamsConfig = {
    ...config,
    scenarioId: playbook.id,
    taskTemplateId: playbook.taskTemplateId,
    mode: playbook.mode,
    roles,
    channels,
    activeChannel,
    updatedAt: nowIso(),
  }

  return withMitaTeamsRuntime(nextConfig, nextConfig.runtime)
}

function enforceTaskDeliveryChannel(config: MitaTeamsConfig): MitaTeamsConfig {
  const channels = normalizeChannelMembership(config.channels, config.roles)
  const channelSignature = (items: MitaTeamsChannelConfig[]) =>
    JSON.stringify(
      items.map((channel) => ({
        id: channel.id,
        roleIds: channel.roleIds,
      }))
    )

  if (channelSignature(channels) === channelSignature(config.channels)) {
    return config
  }

  const activeChannel = channels.some(
    (channel) => channel.id === config.activeChannel
  )
    ? config.activeChannel
    : MITA_TEAMS_TASK_CHANNEL_ID

  return withMitaTeamsRuntime(
    {
      ...config,
      channels,
      activeChannel,
      updatedAt: nowIso(),
    },
    config.runtime
  )
}

function isRoleFailureContent(content: string) {
  return /(?:角色(?:运行|私聊)?失败|role .*failed|runtime failed|No output generated|stream for errors)/i.test(
    content
  )
}

function hasSuccessfulRoleOutput(
  runtime: MitaTeamsRuntime,
  roleId: MitaTeamsRoleId
) {
  return (runtime.roleStates[roleId]?.stream ?? []).some(
    (message) =>
      message.role === 'assistant' &&
      message.content.trim().length > 0 &&
      !isRoleFailureContent(message.content)
  )
}

function nextScenarioRequiredCall(
  config: MitaTeamsConfig,
  runtime: MitaTeamsRuntime,
  playbook?: MitaTeamsScenarioPlaybook
): MitaTeamsRoleCallPlan | undefined {
  if (!playbook) return undefined

  for (const roleId of playbook.flow) {
    if (hasSuccessfulRoleOutput(runtime, roleId)) continue
    const role = roleById(config, roleId)
    const channel = findChannelForRole(config, roleId)
    if (!role || !channel) continue
    return {
      roleId,
      channelId: channel.id,
      instruction:
        playbook.instructions[roleId] ??
        `Complete the ${role.name} step required by the ${playbook.label} playbook.`,
      requiredPermission: 'read',
    }
  }

  return undefined
}

function enforceScenarioBeforeStop(
  decision: MitaTeamsOrchestratorDecision,
  config: MitaTeamsConfig,
  runtime: MitaTeamsRuntime,
  playbook?: MitaTeamsScenarioPlaybook
): MitaTeamsOrchestratorDecision {
  if (decision.action !== 'stop') return decision
  const call = nextScenarioRequiredCall(config, runtime, playbook)
  if (!call || !playbook) return decision
  const role = roleById(config, call.roleId)

  return {
    action: 'call_roles',
    mode: 'serial',
    reason: `Scenario playbook requires ${role?.name ?? call.roleId} before stopping.`,
    calls: [call],
    updates: {
      tasks: [
        {
          title: `${role?.name ?? call.roleId} playbook step`,
          status: call.roleId === 'skeptic' ? 'reviewing' : 'researching',
          roleId: call.roleId,
          channelId: call.channelId,
        },
      ],
    },
  }
}

function normalizeTaskUpdates(
  value: unknown,
  config: MitaTeamsConfig
): MitaTeamsTaskUpdate[] {
  if (!Array.isArray(value)) return []
  const roleIds = new Set(config.roles.map((role) => role.id))
  const channelIds = new Set(config.channels.map((channel) => channel.id))

  return value
    .map((item): MitaTeamsTaskUpdate | undefined => {
      if (!item || typeof item !== 'object') return undefined
      const raw = item as Partial<MitaTeamsTaskUpdate>
      if (typeof raw.title !== 'string' || !raw.title.trim()) return undefined
      const status = normalizeStatusAlias(raw.status) ?? 'todo'
      const id = normalizeMitaTeamsId(raw.id, '')
      const roleId = normalizeMitaTeamsId(raw.roleId, '')
      const channelId = normalizeMitaTeamsId(raw.channelId, '')
      const update: MitaTeamsTaskUpdate = {
        title: trimText(raw.title, 120),
        status,
      }
      if (id) update.id = id
      if (roleIds.has(roleId)) update.roleId = roleId
      if (channelIds.has(channelId)) update.channelId = channelId
      return update
    })
    .filter((item): item is MitaTeamsTaskUpdate => item !== undefined)
    .slice(0, 12)
}

function normalizeArtifactUpdates(
  value: unknown,
  config: MitaTeamsConfig
): MitaTeamsArtifactUpdate[] {
  if (!Array.isArray(value)) return []
  const roleIds = new Set(config.roles.map((role) => role.id))
  const channelIds = new Set(config.channels.map((channel) => channel.id))

  return value
    .map((item): MitaTeamsArtifactUpdate | undefined => {
      if (!item || typeof item !== 'object') return undefined
      const raw = item as Partial<MitaTeamsArtifactUpdate>
      if (
        typeof raw.title !== 'string' ||
        !raw.title.trim() ||
        typeof raw.summary !== 'string' ||
        !raw.summary.trim()
      ) {
        return undefined
      }
      const type = normalizeArtifactTypeAlias(raw.type) ?? 'artifact'
      const id = normalizeMitaTeamsId(raw.id, '')
      const roleId = normalizeMitaTeamsId(raw.roleId, '')
      const channelId = normalizeMitaTeamsId(raw.channelId, '')
      const update: MitaTeamsArtifactUpdate = {
        type,
        title: trimText(raw.title, 120),
        summary: trimText(raw.summary, 600),
      }
      if (id) update.id = id
      if (typeof raw.content === 'string' && raw.content.trim()) {
        update.content = trimText(raw.content, 3000)
      }
      if (roleIds.has(roleId)) update.roleId = roleId
      if (channelIds.has(channelId)) update.channelId = channelId
      return update
    })
    .filter((item): item is MitaTeamsArtifactUpdate => item !== undefined)
    .slice(0, 12)
}

function normalizeStructuredUpdates(
  value: unknown,
  config: MitaTeamsConfig
): MitaTeamsStructuredUpdates | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Partial<MitaTeamsStructuredUpdates>
  const tasks = normalizeTaskUpdates(raw.tasks, config)
  const artifacts = normalizeArtifactUpdates(raw.artifacts, config)
  if (tasks.length === 0 && artifacts.length === 0) return undefined
  return {
    ...(tasks.length ? { tasks } : {}),
    ...(artifacts.length ? { artifacts } : {}),
  }
}

function taskIdFromUpdate(update: MitaTeamsTaskUpdate) {
  return update.id ?? normalizeMitaTeamsId(update.title, stableId('task'))
}

function artifactIdFromUpdate(update: MitaTeamsArtifactUpdate) {
  return (
    update.id ??
    normalizeMitaTeamsId(`${update.type}-${update.title}`, stableId('artifact'))
  )
}

function applyStructuredUpdates(
  runtime: MitaTeamsRuntime,
  updates?: MitaTeamsStructuredUpdates,
  source?: { roleId?: MitaTeamsRoleId; channelId?: MitaTeamsChannelId }
): MitaTeamsRuntime {
  if (!updates) return runtime
  const now = nowIso()
  let nextRuntime = runtime

  if (updates.tasks?.length) {
    const tasksById = new Map(runtime.tasks.map((task) => [task.id, task]))
    for (const update of updates.tasks) {
      const id = taskIdFromUpdate(update)
      const existing = tasksById.get(id)
      tasksById.set(id, {
        id,
        title: update.title,
        status: update.status,
        roleId: update.roleId ?? source?.roleId ?? existing?.roleId,
        channelId: update.channelId ?? source?.channelId ?? existing?.channelId,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      })
    }
    nextRuntime = appendMitaTeamsEvent(
      {
        ...nextRuntime,
        tasks: Array.from(tasksById.values()).slice(-40),
      },
      {
        type: 'tasks_updated',
        title: 'Task board updated',
        detail: updates.tasks
          .map((task) => `${task.status}: ${task.title}`)
          .join('\n'),
        roleId: source?.roleId,
        channelId: source?.channelId,
      }
    )
  }

  if (updates.artifacts?.length) {
    const artifactsById = new Map(
      nextRuntime.artifacts.map((artifact) => [artifact.id, artifact])
    )
    for (const update of updates.artifacts) {
      const id = artifactIdFromUpdate(update)
      const existing = artifactsById.get(id)
      artifactsById.set(id, {
        id,
        type: update.type,
        title: update.title,
        summary: update.summary,
        content: update.content ?? existing?.content,
        roleId: update.roleId ?? source?.roleId ?? existing?.roleId,
        channelId: update.channelId ?? source?.channelId ?? existing?.channelId,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      })
    }
    nextRuntime = appendMitaTeamsEvent(
      {
        ...nextRuntime,
        artifacts: Array.from(artifactsById.values()).slice(-60),
      },
      {
        type: 'artifact_recorded',
        title: 'Structured artifact recorded',
        detail: updates.artifacts
          .map((artifact) => `${artifact.type}: ${artifact.title}`)
          .join('\n'),
        roleId: source?.roleId,
        channelId: source?.channelId,
      }
    )
  }

  return nextRuntime
}

function applyTeamConfiguration({
  config,
  runtime,
  decision,
}: {
  config: MitaTeamsConfig
  runtime: MitaTeamsRuntime
  decision: Extract<MitaTeamsOrchestratorDecision, { action: 'configure_team' }>
}) {
  const roles = mergeRoles(config.roles, decision.roles)
  const channels = normalizeChannelMembership(
    mergeChannels(config.channels, decision.channels),
    roles
  )
  const activeRoleId = roles.some((role) => role.id === config.activeRoleId)
    ? config.activeRoleId
    : MITA_TEAMS_ORCHESTRATOR_ROLE_ID
  const activeChannel = channels.some(
    (channel) => channel.id === config.activeChannel
  )
    ? config.activeChannel
    : MITA_TEAMS_TASK_CHANNEL_ID
  const nextConfig = {
    ...config,
    roles,
    channels,
    activeRoleId,
    activeChannel,
    updatedAt: nowIso(),
  }
  const normalizedRuntime = withMitaTeamsRuntime(nextConfig, runtime).runtime

  return {
    config: {
      ...nextConfig,
      runtime: normalizedRuntime,
    },
    runtime: appendMitaTeamsEvent(normalizedRuntime, {
      type: 'team_configured',
      title: 'Mita Teams configured roles and channels',
      detail: decision.reason,
      roleId: MITA_TEAMS_ORCHESTRATOR_ROLE_ID,
      channelId: MITA_TEAMS_TASK_CHANNEL_ID,
    }),
  }
}

function teamConfigurationDelta(
  config: MitaTeamsConfig,
  decision: Extract<MitaTeamsOrchestratorDecision, { action: 'configure_team' }>
) {
  const currentRoleIds = new Set(config.roles.map((role) => role.id))
  const currentChannels = new Map(
    config.channels.map((channel) => [channel.id, channel])
  )
  const roles = decision.roles.filter((role) => !currentRoleIds.has(role.id))
  const channels: MitaTeamsChannelConfig[] = []

  for (const channel of decision.channels) {
    const existing = currentChannels.get(channel.id)
    if (!existing) {
      channels.push(channel)
      continue
    }

    const addedRoleIds = channel.roleIds.filter(
      (roleId) => !existing.roleIds.includes(roleId)
    )
    if (addedRoleIds.length > 0) {
      channels.push({
        ...existing,
        roleIds: Array.from(new Set([...existing.roleIds, ...addedRoleIds])),
      })
    }
  }

  return { roles, channels }
}

function workflowSpecForRole(
  workflowSpec: MitaTeamsUserWorkflowSpec | undefined,
  role: Pick<MitaTeamsRoleConfig, 'id' | 'name' | 'label'>
) {
  if (!workflowSpec?.explicit || workflowSpec.roles.length === 0) {
    return undefined
  }

  const candidates = [
    workflowTextKey(role.name),
    workflowTextKey(role.label),
    workflowTextKey(role.id),
  ].filter(Boolean)

  return workflowSpec.roles.find((spec) =>
    candidates.some((candidate) => workflowKeysMatch(candidate, spec.key))
  )
}

function workflowKeysMatch(candidate: string, specKey: string) {
  if (candidate === specKey) return true

  const shorter = candidate.length <= specKey.length ? candidate : specKey
  const hasUsefulShortKey =
    shorter.length >= 3 || /^[\u4E00-\u9FFF]{2,}$/.test(shorter)
  if (!hasUsefulShortKey) return false

  return candidate.includes(specKey) || specKey.includes(candidate)
}

function roleAllowedByWorkflowSpec(
  workflowSpec: MitaTeamsUserWorkflowSpec | undefined,
  role: Pick<MitaTeamsRoleConfig, 'id' | 'name' | 'label'>
) {
  if (!workflowSpec?.explicit) return true
  if (workflowSpec.roles.length === 0) return true
  return Boolean(workflowSpecForRole(workflowSpec, role))
}

function applyWorkflowRoleModel(
  role: MitaTeamsRoleConfig,
  workflowSpec: MitaTeamsUserWorkflowSpec,
  modelOptions: MitaTeamsModelOption[]
) {
  const spec = workflowSpecForRole(workflowSpec, role)
  if (!spec?.modelId) return role

  const matchedModel = modelOptions.find(
    (option) => option.modelId === spec.modelId
  )
  if (!matchedModel) return role

  return {
    ...role,
    provider: matchedModel.provider,
    modelId: matchedModel.modelId,
  }
}

function constrainDecisionToWorkflowSpec(
  config: MitaTeamsConfig,
  decision: MitaTeamsOrchestratorDecision,
  workflowSpec: MitaTeamsUserWorkflowSpec | undefined,
  modelOptions: MitaTeamsModelOption[]
): MitaTeamsOrchestratorDecision {
  if (!workflowSpec?.explicit) return decision

  if (decision.action === 'configure_team') {
    const roles = decision.roles
      .filter((role) => roleAllowedByWorkflowSpec(workflowSpec, role))
      .map((role) => applyWorkflowRoleModel(role, workflowSpec, modelOptions))
    const allowedRoleIds = new Set([
      ...config.roles
        .filter((role) => roleAllowedByWorkflowSpec(workflowSpec, role))
        .map((role) => role.id),
      ...roles.map((role) => role.id),
    ])
    const channels = decision.channels
      .map((channel) => ({
        ...channel,
        roleIds: channel.roleIds.filter((roleId) => allowedRoleIds.has(roleId)),
      }))
      .filter(
        (channel) =>
          channel.id === MITA_TEAMS_TASK_CHANNEL_ID ||
          channel.roleIds.length > 0
      )
    const channelIds = new Set([
      ...config.channels.map((channel) => channel.id),
      ...channels.map((channel) => channel.id),
    ])
    const calls = decision.calls.filter(
      (call) =>
        allowedRoleIds.has(call.roleId) &&
        (!call.channelId || channelIds.has(call.channelId))
    )

    return {
      ...decision,
      roles,
      channels,
      calls,
    }
  }

  if (decision.action === 'call_roles') {
    const calls = decision.calls.filter((call) => {
      const role = roleById(config, call.roleId)
      return role ? roleAllowedByWorkflowSpec(workflowSpec, role) : false
    })

    return {
      ...decision,
      calls,
    }
  }

  return decision
}

function preferExistingTeamDecision(
  config: MitaTeamsConfig,
  decision: MitaTeamsOrchestratorDecision,
  preferTeamReuse: boolean
): MitaTeamsOrchestratorDecision {
  if (!preferTeamReuse || decision.action !== 'configure_team') {
    return decision
  }

  const delta = teamConfigurationDelta(config, decision)
  if (delta.roles.length === 0 && delta.channels.length === 0) {
    if (decision.calls.length === 0) {
      return {
        action: 'milestone',
        reason: decision.reason,
        milestone: 'Mita Teams reused existing roles and channels.',
      }
    }
    return {
      action: 'call_roles',
      mode: decision.mode ?? 'hybrid',
      reason: decision.reason,
      calls: decision.calls,
      updates: decision.updates,
    }
  }

  return {
    ...decision,
    roles: delta.roles,
    channels: delta.channels,
  }
}

function parseDecision(
  text: string,
  config: MitaTeamsConfig,
  options: {
    onlyRoleIds?: MitaTeamsRoleId[]
    modelOptions?: MitaTeamsModelOption[]
  } = {}
): MitaTeamsOrchestratorDecision | undefined {
  const json = extractJsonObject(text)
  if (!json) return undefined

  try {
    const raw = JSON.parse(json) as Record<string, unknown>
    const reason =
      typeof raw.reason === 'string' ? raw.reason : 'Orchestrator decision.'

    if (raw.action === 'configure_team') {
      const roles = normalizeDecisionRoles(
        raw.roles,
        config,
        options.modelOptions
      )
      const virtualRoles = mergeRoles(config.roles, roles)
      const channels = normalizeDecisionChannels(
        raw.channels,
        config,
        virtualRoles
      )
      const virtualChannels = normalizeChannelMembership(
        mergeChannels(config.channels, channels),
        virtualRoles
      )
      const virtualConfig = {
        ...config,
        roles: virtualRoles,
        channels: virtualChannels,
      }
      const calls = normalizeCalls(raw.calls, virtualConfig, options)
      const updates = normalizeStructuredUpdates(raw.updates, virtualConfig)
      if (roles.length === 0 && channels.length === 0 && calls.length === 0) {
        return undefined
      }
      return {
        action: 'configure_team',
        reason,
        roles,
        channels: virtualChannels,
        mode: isExecutionMode(raw.mode) ? raw.mode : undefined,
        calls,
        updates,
      }
    }

    if (raw.action === 'call_roles') {
      const calls = normalizeCalls(raw.calls, config, options)
      if (calls.length === 0) return undefined
      return {
        action: 'call_roles',
        mode: isExecutionMode(raw.mode) ? raw.mode : 'hybrid',
        reason,
        calls,
        updates: normalizeStructuredUpdates(raw.updates, config),
      }
    }

    if (raw.action === 'ask_user') {
      const options = normalizeChoiceOptions(raw.options)
      if (typeof raw.question !== 'string' || options.length < 2) {
        return undefined
      }
      return {
        action: 'ask_user',
        reason,
        question: raw.question,
        options,
        updates: normalizeStructuredUpdates(raw.updates, config),
      }
    }

    if (raw.action === 'milestone') {
      if (typeof raw.milestone !== 'string') return undefined
      return {
        action: 'milestone',
        reason,
        milestone: raw.milestone,
        updates: normalizeStructuredUpdates(raw.updates, config),
      }
    }

    if (raw.action === 'stop') {
      if (typeof raw.finalResponse !== 'string') return undefined
      return {
        action: 'stop',
        reason,
        finalResponse: raw.finalResponse,
        updates: normalizeStructuredUpdates(raw.updates, config),
      }
    }
  } catch {
    return undefined
  }

  return undefined
}

function buildDecisionRepairPrompt(
  decisionPrompt: string,
  invalidText: string
) {
  return `The previous Orchestrator response was not valid for the Mita Teams decision schema.

Original decision prompt:
${decisionPrompt}

Invalid response:
${trimText(invalidText, 2400)}

Return one corrected JSON object only. Do not include Markdown or explanation.`
}

function jsonFailureDecision(): MitaTeamsOrchestratorDecision {
  return {
    action: 'ask_user',
    reason:
      'The Orchestrator response could not be parsed after one JSON repair attempt.',
    question:
      'Mita Teams could not parse the coordinator decision. What should happen next?',
    options: [
      {
        id: 'retry',
        label: 'Retry orchestration',
        description:
          'Ask the coordinator to decide again with the same context.',
      },
      {
        id: 'stop',
        label: 'Stop here',
        description: 'Pause the team without calling extra roles.',
      },
    ],
  }
}

async function generateParsedDecision({
  decisionPrompt,
  config,
  userControl,
  modelOptions,
  model,
  generateDecisionText,
  abortSignal,
}: {
  decisionPrompt: string
  config: MitaTeamsConfig
  userControl: MitaTeamsUserControl
  modelOptions: MitaTeamsModelOption[]
  model?: ThreadModel
  generateDecisionText: GenerateDecisionText
  abortSignal?: AbortSignal
}): Promise<{
  decision: MitaTeamsOrchestratorDecision
  repairRequested: boolean
  invalidText?: string
  usage?: MitaTeamsTokenUsage
}> {
  const parseOptions = {
    onlyRoleIds: userControl.onlyRoleIds,
    modelOptions,
  }
  const firstResult = normalizeGeneratedText(
    await generateDecisionText({
      prompt: decisionPrompt,
      model,
      abortSignal,
    })
  )
  const firstDecision = parseDecision(firstResult.text, config, parseOptions)
  if (firstDecision) {
    return {
      decision: firstDecision,
      repairRequested: false,
      usage: firstResult.usage,
    }
  }

  const repairResult = normalizeGeneratedText(
    await generateDecisionText({
      prompt: buildDecisionRepairPrompt(decisionPrompt, firstResult.text),
      model,
      abortSignal,
    })
  )
  const repairedDecision = parseDecision(repairResult.text, config, parseOptions)
  if (repairedDecision) {
    return {
      decision: repairedDecision,
      repairRequested: true,
      invalidText: firstResult.text,
      usage: addUsage(firstResult.usage, repairResult.usage),
    }
  }

  return {
    decision: jsonFailureDecision(),
    repairRequested: true,
    invalidText: `${firstResult.text}\n\n${repairResult.text}`,
    usage: addUsage(firstResult.usage, repairResult.usage),
  }
}

function startRuntimeRun(
  runtime: MitaTeamsRuntime,
  config: MitaTeamsConfig
): MitaTeamsRuntime {
  const now = nowIso()
  return appendMitaTeamsEvent(
    {
      ...runtime,
      userChoiceRequest: undefined,
      run: {
        id: stableId('teams-run'),
        status: 'running',
        currentRound: 0,
        maxRounds: config.roundLimit,
        callCount: 0,
        activeRoleIds: [],
        startedAt: now,
        updatedAt: now,
      },
    },
    {
      type: 'run_started',
      title: 'Mita Teams started',
      detail: `${config.roles.filter((role) => role.enabled).length} enabled roles`,
    }
  )
}

function updateRun(
  runtime: MitaTeamsRuntime,
  patch: Partial<NonNullable<MitaTeamsRuntime['run']>>
): MitaTeamsRuntime {
  if (!runtime.run) return runtime
  return {
    ...runtime,
    run: {
      ...runtime.run,
      ...patch,
      updatedAt: nowIso(),
    },
  }
}

function addRunUsage(
  runtime: MitaTeamsRuntime,
  usage?: MitaTeamsTokenUsage
): MitaTeamsRuntime {
  if (!usage) return runtime
  return updateRun(runtime, {
    usage: addUsage(runtime.run?.usage, usage),
  })
}

function advanceRunRound(runtime: MitaTeamsRuntime): MitaTeamsRuntime {
  return updateRun(runtime, {
    currentRound: (runtime.run?.currentRound ?? 0) + 1,
    activeRoleIds: [],
  })
}

function completeRun(
  runtime: MitaTeamsRuntime,
  status: 'completed' | 'failed' | 'waiting-for-user' | 'stopped',
  detail?: string
): MitaTeamsRuntime {
  const isTerminal = status !== 'waiting-for-user'
  const completedAt = isTerminal ? nowIso() : undefined
  const startedAt = runtime.run?.startedAt
  const durationMs =
    completedAt && startedAt
      ? Math.max(
          0,
          new Date(completedAt).getTime() - new Date(startedAt).getTime()
        )
      : runtime.run?.durationMs
  return appendMitaTeamsEvent(
    updateRun(runtime, {
      status,
      activeRoleIds: [],
      completedAt,
      durationMs,
      error: status === 'failed' ? detail : undefined,
    }),
    {
      type: status === 'failed' ? 'run_failed' : 'run_completed',
      title:
        status === 'waiting-for-user'
          ? 'Mita Teams is waiting for the owner'
          : status === 'stopped'
            ? 'Mita Teams stopped'
            : status === 'failed'
              ? 'Mita Teams failed'
              : 'Mita Teams completed',
      detail,
    }
  )
}

function groupCalls(
  decision: Extract<MitaTeamsOrchestratorDecision, { action: 'call_roles' }>
) {
  if (decision.mode === 'parallel') return [decision.calls]
  if (decision.mode === 'serial') return decision.calls.map((call) => [call])

  const groups = new Map<number, MitaTeamsRoleCallPlan[]>()
  decision.calls.forEach((call, index) => {
    const group = call.group ?? index + 1
    groups.set(group, [...(groups.get(group) ?? []), call])
  })

  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, calls]) => calls)
}

function parseRoleStructuredUpdates(
  outputText: string,
  role: MitaTeamsRoleConfig,
  channelId?: MitaTeamsChannelId
): MitaTeamsStructuredUpdates | undefined {
  const tasks: MitaTeamsTaskUpdate[] = []
  const artifacts: MitaTeamsArtifactUpdate[] = []

  for (const rawLine of outputText.split(/\n+/)) {
    const line = rawLine.trim().replace(/^[-*•]\s*/, '')
    if (!line) continue

    const taskMatch = line.match(
      /^(?:Task|任务|任務)\s*(?:\[(.+?)\]|\((.+?)\))?\s*[:：]\s*(.+)$/i
    )
    if (taskMatch) {
      const status =
        normalizeStatusAlias(taskMatch[1] ?? taskMatch[2]) ?? 'todo'
      const title = taskMatch[3]?.trim()
      if (title) {
        tasks.push({
          title,
          status,
          roleId: role.id,
          channelId,
        })
      }
      continue
    }

    const artifactMatch = line.match(
      /^(Decision|Risk|Artifact|Test result|Final draft|决策|決策|风险|風險|产物|產物|测试结果|測試結果|最终草稿|最終草稿)\s*[:：]\s*(.+)$/i
    )
    if (!artifactMatch) continue
    const type = normalizeArtifactTypeAlias(artifactMatch[1]) ?? 'artifact'
    const summary = artifactMatch[2]?.trim()
    if (!summary) continue
    artifacts.push({
      type,
      title: trimText(summary, 80),
      summary,
      roleId: role.id,
      channelId,
    })
  }

  if (tasks.length === 0 && artifacts.length === 0) return undefined
  return {
    ...(tasks.length ? { tasks: tasks.slice(0, 6) } : {}),
    ...(artifacts.length ? { artifacts: artifacts.slice(0, 6) } : {}),
  }
}

async function runRoleCall({
  config,
  runtime,
  call,
  userText,
  recentOutputs,
  languageGuidance,
  generateRoleText,
  abortSignal,
  notify,
}: {
  config: MitaTeamsConfig
  runtime: MitaTeamsRuntime
  call: MitaTeamsRoleCallPlan
  userText: string
  recentOutputs: RoleOutput[]
  languageGuidance: string
  generateRoleText: GenerateRoleText
  abortSignal?: AbortSignal
  notify?: (runtime: MitaTeamsRuntime) => void
}): Promise<{
  runtime: MitaTeamsRuntime
  output?: RoleOutput
  usage?: MitaTeamsTokenUsage
}> {
  const role = roleById(config, call.roleId)
  if (!role) return { runtime }

  const turnId = stableId(`turn-${role.id}`)
  const model = modelForRole(role)
  let nextRuntime = appendRoleStreamMessage(runtime, role, {
    turnId,
    channelId: call.channelId,
    role: 'user',
    content: call.instruction,
    model,
  })
  const currentAfterUserMessage = nextRuntime.roleStates[role.id]
  if (currentAfterUserMessage) {
    nextRuntime = {
      ...nextRuntime,
      roleStates: {
        ...nextRuntime.roleStates,
        [role.id]: {
          ...currentAfterUserMessage,
          status: 'running',
          lastError: undefined,
        },
      },
    }
  }
  nextRuntime = appendMitaTeamsEvent(nextRuntime, {
    type: 'role_called',
    title: `${role.name} started`,
    detail: call.instruction,
    roleId: role.id,
    channelId: call.channelId,
  })
  nextRuntime = appendRoleStreamMessage(nextRuntime, role, {
    turnId,
    channelId: call.channelId,
    role: 'assistant',
    content: '',
    model,
  })
  notify?.(nextRuntime)

  try {
    const webSearch = webSearchRequirementForRoleCall({
      config,
      role,
      call,
      userText,
    })
    const prompt = buildRolePrompt({
      config,
      role,
      runtime: nextRuntime,
      userText,
      call,
      recentOutputs,
      languageGuidance,
      webSearch,
    })
    let streamedText = ''
    const onDelta = (delta: string) => {
      if (!delta) return
      streamedText += delta
      nextRuntime = updateRoleStreamMessageContent(nextRuntime, role, {
        turnId,
        channelId: call.channelId,
        role: 'assistant',
        content: trimText(streamedText, 4000),
        model,
      })
      notify?.(nextRuntime)
    }
    const roleResult = normalizeGeneratedText(
      await generateRoleText({
        role,
        prompt,
        model,
        webSearch,
        abortSignal,
        onDelta,
      })
    )
    const outputText = trimText(roleResult.text || streamedText, 4000)
    if (!outputText) {
      throw new Error(`No output generated by ${role.name}.`)
    }
    nextRuntime = updateRoleStreamMessageContent(nextRuntime, role, {
      turnId,
      channelId: call.channelId,
      role: 'assistant',
      content: outputText,
      model,
    })
    nextRuntime = recordRoleTurnMemory(
      nextRuntime,
      role,
      outputText,
      turnId,
      model,
      call.channelId
    )
    nextRuntime = applyStructuredUpdates(
      nextRuntime,
      parseRoleStructuredUpdates(outputText, role, call.channelId),
      { roleId: role.id, channelId: call.channelId }
    )
    notify?.(nextRuntime)
    return {
      runtime: nextRuntime,
      output: {
        roleId: role.id,
        roleName: role.name,
        channelId: call.channelId,
        output: outputText,
      },
      usage: roleResult.usage,
    }
  } catch (error) {
    if (abortSignal?.aborted) throw error

    const message = roleFailureMessage(
      error,
      role,
      'Role call failed unexpectedly'
    )
    nextRuntime = updateRoleStreamMessageContent(nextRuntime, role, {
      turnId,
      channelId: call.channelId,
      role: 'assistant',
      content: `Mita Teams 角色运行失败：${message}`,
      model,
    })
    const current = nextRuntime.roleStates[role.id]
    nextRuntime = appendMitaTeamsEvent(
      {
        ...nextRuntime,
        roleStates: {
          ...nextRuntime.roleStates,
          [role.id]: {
            ...(current ?? {
              roleId: role.id,
              status: 'failed' as const,
              stream: [],
              memory: {
                roleId: role.id,
                version: 0,
                summary: '',
                facts: [],
                decisions: [],
                openQuestions: [],
                workingNotes: [],
                updatedAt: nowIso(),
              },
            }),
            status: 'failed',
            lastError: message,
          },
        },
      },
      {
        type: 'role_completed',
        title: `${role.name} failed`,
        detail: message,
        roleId: role.id,
        channelId: call.channelId,
      }
    )
    notify?.(nextRuntime)
    return { runtime: nextRuntime }
  }
}

function mergeBranchEvents(
  current: MitaTeamsRuntime,
  branch: MitaTeamsRuntime,
  branchBase: MitaTeamsRuntime
) {
  const baseEventIds = new Set(branchBase.teamEvents.map((event) => event.id))
  const currentEventIds = new Set(current.teamEvents.map((event) => event.id))
  const newEvents = branch.teamEvents.filter(
    (event) => !baseEventIds.has(event.id) && !currentEventIds.has(event.id)
  )

  return [...current.teamEvents, ...newEvents].slice(-80)
}

function mergeBranchStructuredState(
  current: MitaTeamsRuntime,
  branch: MitaTeamsRuntime,
  branchBase: MitaTeamsRuntime
) {
  const baseTasks = new Map(branchBase.tasks.map((task) => [task.id, task]))
  const changedTasks = branch.tasks.filter((task) => {
    const base = baseTasks.get(task.id)
    return (
      !base ||
      task.title !== base.title ||
      task.status !== base.status ||
      task.roleId !== base.roleId ||
      task.channelId !== base.channelId
    )
  })
  const tasksById = new Map(current.tasks.map((task) => [task.id, task]))
  for (const task of changedTasks) {
    tasksById.set(task.id, task)
  }

  const baseArtifacts = new Map(
    branchBase.artifacts.map((artifact) => [artifact.id, artifact])
  )
  const changedArtifacts = branch.artifacts.filter((artifact) => {
    const base = baseArtifacts.get(artifact.id)
    return (
      !base ||
      artifact.type !== base.type ||
      artifact.title !== base.title ||
      artifact.summary !== base.summary ||
      artifact.content !== base.content ||
      artifact.roleId !== base.roleId ||
      artifact.channelId !== base.channelId
    )
  })
  const artifactsById = new Map(
    current.artifacts.map((artifact) => [artifact.id, artifact])
  )
  for (const artifact of changedArtifacts) {
    artifactsById.set(artifact.id, artifact)
  }

  return {
    tasks: Array.from(tasksById.values()).slice(-40),
    artifacts: Array.from(artifactsById.values()).slice(-60),
  }
}

function mergeRoleBranch({
  current,
  branch,
  branchBase,
  roleId,
}: {
  current: MitaTeamsRuntime
  branch: MitaTeamsRuntime
  branchBase: MitaTeamsRuntime
  roleId: MitaTeamsRoleId
}) {
  const branchRoleState = branch.roleStates[roleId]
  const structuredState = mergeBranchStructuredState(
    current,
    branch,
    branchBase
  )

  return {
    ...current,
    ...structuredState,
    roleStates: branchRoleState
      ? {
          ...current.roleStates,
          [roleId]: branchRoleState,
        }
      : current.roleStates,
    teamEvents: mergeBranchEvents(current, branch, branchBase),
  }
}

async function executeRoleCalls({
  config,
  runtime,
  decision,
  userText,
  recentOutputs,
  languageGuidance,
  generateRoleText,
  abortSignal,
  notify,
}: {
  config: MitaTeamsConfig
  runtime: MitaTeamsRuntime
  decision: Extract<MitaTeamsOrchestratorDecision, { action: 'call_roles' }>
  userText: string
  recentOutputs: RoleOutput[]
  languageGuidance: string
  generateRoleText: GenerateRoleText
  abortSignal?: AbortSignal
  notify: (runtime: MitaTeamsRuntime) => void
}) {
  let nextRuntime = updateRun(runtime, {
    executionMode: decision.mode,
    activeRoleIds: decision.calls.map((call) => call.roleId),
  })
  const outputs: RoleOutput[] = []
  notify(nextRuntime)

  for (const group of groupCalls(decision)) {
    const groupBase = nextRuntime
    let streamingRuntime = nextRuntime
    const groupResults = await Promise.all(
      group.map((call) =>
        runRoleCall({
          config,
          runtime: groupBase,
          call,
          userText,
          recentOutputs: [...recentOutputs, ...outputs],
          languageGuidance,
          generateRoleText,
          abortSignal,
          notify: (branchRuntime) => {
            streamingRuntime = mergeRoleBranch({
              current: streamingRuntime,
              branch: branchRuntime,
              branchBase: groupBase,
              roleId: call.roleId,
            })
            notify(streamingRuntime)
          },
        }).then((result) => ({ ...result, roleId: call.roleId }))
      )
    )

    nextRuntime = streamingRuntime
    for (const result of groupResults) {
      nextRuntime = mergeRoleBranch({
        current: nextRuntime,
        branch: result.runtime,
        branchBase: groupBase,
        roleId: result.roleId,
      })
      nextRuntime = addRunUsage(nextRuntime, result.usage)
      if (result.output) outputs.push(result.output)
    }
    nextRuntime = mergeProjectMemory(nextRuntime, config.roles)
    notify(nextRuntime)
  }

  return {
    runtime: updateRun(nextRuntime, {
      currentRound: (nextRuntime.run?.currentRound ?? 0) + 1,
      callCount: (nextRuntime.run?.callCount ?? 0) + decision.calls.length,
      activeRoleIds: [],
    }),
    outputs,
  }
}

function synthesizeFinalResponse(
  runtime: MitaTeamsRuntime,
  outputs: RoleOutput[]
) {
  const finalDraft = [...runtime.artifacts]
    .reverse()
    .find((artifact) => artifact.type === 'final_draft')
  if (finalDraft) {
    return finalDraft.content || finalDraft.summary
  }
  const memory = projectMemoryText(runtime.projectMemory)
  if (memory) {
    return `Mita Teams 已到达一个可交付节点。\n\n${memory}`
  }
  return outputs.length
    ? `Mita Teams 已完成一轮协作。\n\n${renderRecentOutputs(outputs)}`
    : 'Mita Teams 已准备好继续，但当前没有可合成的角色输出。'
}

export async function runMitaTeamsPrivateRoleChat({
  config,
  roleId,
  userText,
  abortSignal,
  onConfigChange,
  generateRoleText = defaultGenerateRoleText,
}: RunMitaTeamsPrivateRoleChatOptions): Promise<MitaTeamsPrivateRoleChatResult> {
  let workingConfig = withMitaTeamsRuntime(config, config.runtime)
  const role = roleById(workingConfig, roleId)

  if (!role) {
    return {
      config: workingConfig,
      finalResponse: '未找到这个 Mita Teams 角色。',
      status: 'failed',
    }
  }

  const notify = (nextRuntime: MitaTeamsRuntime) => {
    workingConfig = withMitaTeamsRuntime(workingConfig, nextRuntime)
    onConfigChange?.(workingConfig)
  }
  const languageGuidance = buildLanguageGuidance(userText)
  const turnId = stableId(`private-${role.id}`)
  const model = modelForRole(role)
  const promptRuntime = workingConfig.runtime
  let runtime = appendRoleStreamMessage(workingConfig.runtime, role, {
    turnId,
    role: 'user',
    content: userText,
    model,
  })
  const currentAfterUserMessage = runtime.roleStates[role.id]

  if (currentAfterUserMessage) {
    runtime = {
      ...runtime,
      roleStates: {
        ...runtime.roleStates,
        [role.id]: {
          ...currentAfterUserMessage,
          status: 'running',
          lastError: undefined,
        },
      },
    }
  }
  runtime = appendRoleStreamMessage(runtime, role, {
    turnId,
    role: 'assistant',
    content: '',
    model,
  })
  notify(runtime)

  try {
    if (abortSignal?.aborted) {
      const stoppedState = runtime.roleStates[role.id]
      if (stoppedState) {
        runtime = {
          ...runtime,
          roleStates: {
            ...runtime.roleStates,
            [role.id]: {
              ...stoppedState,
              status: 'blocked',
            },
          },
        }
        notify(runtime)
      }
      return { config: workingConfig, status: 'stopped' }
    }

    let streamedText = ''
    const onDelta = (delta: string) => {
      if (!delta) return
      streamedText += delta
      runtime = updateRoleStreamMessageContent(runtime, role, {
        turnId,
        role: 'assistant',
        content: trimText(streamedText, 4000),
        model,
      })
      notify(runtime)
    }
    const result = normalizeGeneratedText(
      await generateRoleText({
        role,
        prompt: buildPrivateRoleChatPrompt({
          role,
          runtime: promptRuntime,
          userText,
          languageGuidance,
        }),
        model,
        abortSignal,
        onDelta,
      })
    )
    const outputText = trimText(result.text || streamedText, 4000)
    if (!outputText) {
      throw new Error(`No output generated by ${role.name}.`)
    }
    runtime = updateRoleStreamMessageContent(runtime, role, {
      turnId,
      role: 'assistant',
      content: outputText,
      model,
    })
    const completedState = runtime.roleStates[role.id]
    if (completedState) {
      runtime = {
        ...runtime,
        roleStates: {
          ...runtime.roleStates,
          [role.id]: {
            ...completedState,
            status: 'done',
            lastTurnId: turnId,
            lastError: undefined,
          },
        },
      }
    }
    notify(runtime)

    return {
      config: workingConfig,
      finalResponse: outputText,
      status: 'completed',
    }
  } catch (error) {
    if (abortSignal?.aborted) {
      const stoppedState = runtime.roleStates[role.id]
      if (stoppedState) {
        runtime = {
          ...runtime,
          roleStates: {
            ...runtime.roleStates,
            [role.id]: {
              ...stoppedState,
              status: 'blocked',
            },
          },
        }
        notify(runtime)
      }
      return { config: workingConfig, status: 'stopped' }
    }

    const message = roleFailureMessage(
      error,
      role,
      'Mita Teams role chat failed'
    )
    const current = runtime.roleStates[role.id]
    runtime = updateRoleStreamMessageContent(
      {
        ...runtime,
        roleStates: {
          ...runtime.roleStates,
          [role.id]: {
            ...(current ?? {
              roleId: role.id,
              status: 'failed' as const,
              stream: [],
              memory: {
                roleId: role.id,
                version: 0,
                summary: '',
                facts: [],
                decisions: [],
                openQuestions: [],
                workingNotes: [],
                updatedAt: nowIso(),
              },
            }),
            status: 'failed',
            lastError: message,
          },
        },
      },
      role,
      {
        turnId,
        role: 'assistant',
        content: `Mita Teams 角色私聊失败：${message}`,
        model,
      }
    )
    notify(runtime)

    return {
      config: workingConfig,
      finalResponse: message,
      status: 'failed',
    }
  }
}

export async function runMitaTeamsRuntime({
  config,
  userText,
  threadTitle,
  abortSignal,
  onConfigChange,
  generateRoleText = defaultGenerateRoleText,
  generateDecisionText = defaultGenerateDecisionText,
}: RunMitaTeamsRuntimeOptions): Promise<MitaTeamsRuntimeResult> {
  const initialModelOptions = buildAvailableModelOptions()
  const detectedWorkflowSpec = detectUserWorkflowSpec(userText)
  const workflowSpec =
    detectedWorkflowSpec.explicit || config.workflowControl === 'user_spec'
      ? {
          ...detectedWorkflowSpec,
          explicit: true,
        }
      : undefined
  const preferTeamReuse = hasReusableTeam(config)
  const scenarioPlaybook =
    workflowSpec?.explicit || preferTeamReuse
      ? undefined
      : config.scenarioId === 'market_research'
        ? MARKET_RESEARCH_PLAYBOOK
        : detectScenarioPlaybook(userText)
  const languageGuidance = buildLanguageGuidance(userText)
  let workingConfig = enforceTaskDeliveryChannel(
    applyScenarioPlaybook(
      withMitaTeamsRuntime(config, config.runtime),
      scenarioPlaybook,
      initialModelOptions
    )
  )
  if (workflowSpec?.explicit) {
    workingConfig = {
      ...workingConfig,
      workflowControl: 'user_spec',
      scenarioId: undefined,
      updatedAt: nowIso(),
    }
  }
  let runtime = startRuntimeRun(workingConfig.runtime, workingConfig)
  let recentOutputs: RoleOutput[] = []
  const userControl = parseUserControl(userText, workingConfig)

  const notify = (nextRuntime: MitaTeamsRuntime) => {
    workingConfig = withMitaTeamsRuntime(workingConfig, nextRuntime)
    onConfigChange?.(workingConfig)
  }

  notify(runtime)

  if (userControl.shouldPause) {
    runtime = completeRun(runtime, 'stopped', 'Owner requested pause.')
    notify(runtime)
    return {
      config: workingConfig,
      finalResponse: 'Mita Teams 已暂停。你可以输入“继续”让主持人接着推进。',
      status: 'stopped',
    }
  }

  try {
    while ((runtime.run?.currentRound ?? 0) < workingConfig.roundLimit) {
      if (abortSignal?.aborted) {
        runtime = completeRun(runtime, 'stopped', 'Run aborted')
        notify(runtime)
        return { config: workingConfig, status: 'stopped' }
      }

      runtime = mergeProjectMemory(runtime, workingConfig.roles)
      notify(runtime)

      const orchestrator = roleById(
        workingConfig,
        MITA_TEAMS_ORCHESTRATOR_ROLE_ID
      )
      const decisionPrompt = buildDecisionPrompt({
        config: workingConfig,
        runtime,
        userText,
        threadTitle,
        recentOutputs,
        userControl,
        modelOptions: initialModelOptions,
        scenarioPlaybook,
        languageGuidance,
        preferTeamReuse,
        workflowSpec,
      })
      const decisionResolution = await generateParsedDecision({
        decisionPrompt,
        config: workingConfig,
        userControl,
        modelOptions: initialModelOptions,
        model: orchestrator ? modelForRole(orchestrator) : undefined,
        generateDecisionText,
        abortSignal,
      })
      const decision = preferExistingTeamDecision(
        workingConfig,
        enforceScenarioBeforeStop(
          constrainDecisionToWorkflowSpec(
            workingConfig,
            decisionResolution.decision,
            workflowSpec,
            initialModelOptions
          ),
          workingConfig,
          runtime,
          scenarioPlaybook
        ),
        preferTeamReuse
      )
      runtime = addRunUsage(runtime, decisionResolution.usage)

      if (decisionResolution.repairRequested) {
        runtime = appendMitaTeamsEvent(runtime, {
          type: 'json_repair_requested',
          title: 'Orchestrator JSON repair requested',
          detail: trimText(decisionResolution.invalidText ?? '', 180),
          roleId: MITA_TEAMS_ORCHESTRATOR_ROLE_ID,
        })
        notify(runtime)
      }

      runtime = appendMitaTeamsEvent(
        updateRun(runtime, {
          lastDecision: decision,
        }),
        {
          type: 'decision',
          title: `Orchestrator chose ${decision.action}`,
          detail: decision.reason,
          roleId: MITA_TEAMS_ORCHESTRATOR_ROLE_ID,
        }
      )
      notify(runtime)

      if (decision.updates) {
        runtime = applyStructuredUpdates(runtime, decision.updates, {
          roleId: MITA_TEAMS_ORCHESTRATOR_ROLE_ID,
          channelId: MITA_TEAMS_TASK_CHANNEL_ID,
        })
        notify(runtime)
      }

      if (decision.action === 'configure_team') {
        const applied = applyTeamConfiguration({
          config: workingConfig,
          runtime,
          decision,
        })
        workingConfig = applied.config
        runtime = applied.runtime
        notify(runtime)

        const calls = normalizeCalls(decision.calls, workingConfig, {
          onlyRoleIds: userControl.onlyRoleIds,
        })
        if (calls.length === 0) {
          runtime = advanceRunRound(runtime)
          notify(runtime)
          continue
        }

        const callDecision: Extract<
          MitaTeamsOrchestratorDecision,
          { action: 'call_roles' }
        > = {
          action: 'call_roles',
          mode: decision.mode ?? 'hybrid',
          reason: decision.reason,
          calls,
        }
        const { runtime: afterCalls, outputs } = await executeRoleCalls({
          config: workingConfig,
          runtime,
          decision: callDecision,
          userText,
          recentOutputs,
          languageGuidance,
          generateRoleText,
          abortSignal,
          notify,
        })
        runtime = afterCalls
        recentOutputs = [...recentOutputs, ...outputs].slice(-12)

        if ((runtime.run?.callCount ?? 0) >= MAX_ROLE_CALLS_PER_RUN) {
          break
        }
        continue
      }

      if (decision.action === 'ask_user') {
        runtime = appendMitaTeamsEvent(
          {
            ...updateRun(runtime, { status: 'waiting-for-user' }),
            userChoiceRequest: {
              id: stableId('choice'),
              question: decision.question,
              options: decision.options,
              status: 'pending',
              createdAt: nowIso(),
            },
          },
          {
            type: 'choice_requested',
            title: 'Orchestrator requested owner input',
            detail: decision.question,
            roleId: MITA_TEAMS_ORCHESTRATOR_ROLE_ID,
          }
        )
        notify(runtime)
        return {
          config: workingConfig,
          choiceRequestId: runtime.userChoiceRequest?.id,
          status: 'waiting-for-user',
        }
      }

      if (decision.action === 'milestone') {
        const milestone: MitaTeamsMilestone = {
          id: stableId('milestone'),
          title: decision.milestone,
          createdAt: nowIso(),
          sourceRoleId: MITA_TEAMS_ORCHESTRATOR_ROLE_ID,
        }
        runtime = appendMitaTeamsEvent(
          {
            ...runtime,
            milestones: [...runtime.milestones, milestone].slice(-20),
          },
          {
            type: 'milestone',
            title: decision.milestone,
            detail: decision.reason,
            roleId: MITA_TEAMS_ORCHESTRATOR_ROLE_ID,
          }
        )
        notify(runtime)
        runtime = advanceRunRound(runtime)
        notify(runtime)
        continue
      }

      if (decision.action === 'stop') {
        runtime = completeRun(runtime, 'completed', decision.reason)
        notify(runtime)
        return {
          config: workingConfig,
          finalResponse: decision.finalResponse,
          status: 'completed',
        }
      }

      const { runtime: afterCalls, outputs } = await executeRoleCalls({
        config: workingConfig,
        runtime,
        decision,
        userText,
        recentOutputs,
        languageGuidance,
        generateRoleText,
        abortSignal,
        notify,
      })
      runtime = afterCalls
      recentOutputs = [...recentOutputs, ...outputs].slice(-12)

      if ((runtime.run?.callCount ?? 0) >= MAX_ROLE_CALLS_PER_RUN) {
        break
      }
    }

    runtime = mergeProjectMemory(runtime, workingConfig.roles)
    const finalResponse = synthesizeFinalResponse(runtime, recentOutputs)
    runtime = completeRun(runtime, 'completed', 'Round limit reached.')
    notify(runtime)

    return {
      config: workingConfig,
      finalResponse,
      status: 'completed',
    }
  } catch (error) {
    if (abortSignal?.aborted) {
      runtime = completeRun(runtime, 'stopped', 'Run aborted')
      notify(runtime)
      return { config: workingConfig, status: 'stopped' }
    }

    const message = errorMessageFromUnknown(
      error,
      'Mita Teams runtime failed'
    )
    runtime = completeRun(runtime, 'failed', message)
    notify(runtime)
    return {
      config: workingConfig,
      finalResponse: `Mita Teams 运行失败：${message}`,
      status: 'failed',
    }
  }
}
