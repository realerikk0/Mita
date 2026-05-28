import { generateText, type LanguageModel } from 'ai'
import { useAssistant } from '@/hooks/useAssistant'
import { useModelProvider } from '@/hooks/useModelProvider'
import { defaultModel } from '@/lib/models'
import { ModelFactory } from '@/lib/model-factory'
import {
  appendMitaTeamsEvent,
  appendRoleStreamMessage,
  mergeProjectMemory,
  projectMemoryText,
  recordRoleTurnMemory,
  roleMemoryText,
  withMitaTeamsRuntime,
} from '@/lib/mita-teams-memory'
import {
  MITA_TEAMS_ORCHESTRATOR_ROLE_ID,
  MITA_TEAMS_TASK_CHANNEL_ID,
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
  type MitaTeamsRuntime,
  type MitaTeamsStructuredUpdates,
  type MitaTeamsTaskStatus,
  type MitaTeamsTaskUpdate,
} from '@/types/mita-teams'

type RoleOutput = {
  roleId: MitaTeamsRoleId
  roleName: string
  channelId?: MitaTeamsChannelId
  output: string
}

type GenerateRoleText = (input: {
  role: MitaTeamsRoleConfig
  prompt: string
  model?: ThreadModel
  abortSignal?: AbortSignal
}) => Promise<string>

type GenerateDecisionText = (input: {
  prompt: string
  model?: ThreadModel
  abortSignal?: AbortSignal
}) => Promise<string>

type MitaTeamsUserControl = {
  mentionedRoleIds: MitaTeamsRoleId[]
  onlyRoleIds: MitaTeamsRoleId[]
  shouldPause: boolean
  shouldContinue: boolean
  shouldConverge: boolean
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

const MAX_ROLE_CALLS_PER_RUN = 16

const nowIso = () => new Date().toISOString()

const stableId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const trimText = (value: string, max = 1200) => {
  const text = value.trim()
  return text.length > max ? `${text.slice(0, max - 3)}...` : text
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

function modelForRole(role: MitaTeamsRoleConfig): ThreadModel | undefined {
  if (!role.provider || !role.modelId) return undefined
  return {
    provider: role.provider,
    id: role.modelId,
  }
}

async function createLanguageModelForRole(
  role: MitaTeamsRoleConfig
): Promise<{ model: LanguageModel; threadModel: ThreadModel }> {
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
  const model = await ModelFactory.createModel(modelId, provider, parameters)

  return {
    model,
    threadModel: {
      provider: providerName,
      id: modelId,
    },
  }
}

async function defaultGenerateRoleText({
  role,
  prompt,
  abortSignal,
}: {
  role: MitaTeamsRoleConfig
  prompt: string
  abortSignal?: AbortSignal
}) {
  const { model } = await createLanguageModelForRole(role)
  const result = await generateText({
    model,
    prompt,
    abortSignal,
    system: role.prompt,
  })

  return result.text
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

  return result.text
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

function buildDecisionPrompt({
  config,
  runtime,
  userText,
  threadTitle,
  recentOutputs,
  userControl,
}: {
  config: MitaTeamsConfig
  runtime: MitaTeamsRuntime
  userText: string
  threadTitle?: string
  recentOutputs: RoleOutput[]
  userControl: MitaTeamsUserControl
}) {
  const roles = config.roles
    .filter((role) => role.enabled)
    .map(
      (role) =>
        `- ${role.id}: ${role.name} (${role.permission}) ${role.description}`
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

Mode: ${modeDescription(config)}
Task template: ${taskTemplate.label}
Template guidance: ${taskTemplate.orchestratorHint}
Recommended role ids: ${taskTemplate.recommendedRoleIds.join(', ') || 'none'}
Default flow: ${taskTemplate.defaultFlow.join(' -> ')}
Round: ${currentRound} / ${maxRounds}

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

Choose exactly one next action. Output valid JSON only.

Allowed shapes:
1. {"action":"configure_team","reason":"...","roles":[{"id":"researcher","name":"Researcher","label":"Research","description":"...","prompt":"...","permission":"read"}],"channels":[{"id":"research","label":"Research","description":"...","roleIds":["researcher"]}],"mode":"parallel|serial|hybrid","calls":[{"roleId":"researcher","channelId":"research","instruction":"...","requiredPermission":"read","group":1}],"updates":{"tasks":[{"title":"Inspect evidence","status":"researching","roleId":"researcher","channelId":"research"}],"artifacts":[{"type":"decision","title":"Scope","summary":"..."}]}}
2. {"action":"call_roles","mode":"parallel|serial|hybrid","reason":"...","calls":[{"roleId":"researcher","channelId":"research","instruction":"...","requiredPermission":"read","group":1}],"updates":{"tasks":[{"title":"Review answer","status":"reviewing"}],"artifacts":[{"type":"risk","title":"Main risk","summary":"..."}]}}
3. {"action":"ask_user","reason":"...","question":"...","options":[{"id":"a","label":"Option A","description":"..."}]}
4. {"action":"milestone","reason":"...","milestone":"..."}
5. {"action":"stop","reason":"...","finalResponse":"...","updates":{"artifacts":[{"type":"final_draft","title":"Final answer","summary":"...","content":"..."}]}}

Rules:
- New teams start with only the Orchestrator and the main task channel.
- If specialist work is needed, first create only the minimum useful roles and channels with configure_team.
- Pick role calls only from enabled roles, and include the most relevant channelId for each call.
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

function buildRolePrompt({
  config,
  role,
  runtime,
  userText,
  call,
  recentOutputs,
}: {
  config: MitaTeamsConfig
  role: MitaTeamsRoleConfig
  runtime: MitaTeamsRuntime
  userText: string
  call: MitaTeamsRoleCallPlan
  recentOutputs: RoleOutput[]
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

Channel for this turn:
${channelContext}

Permission for this turn:
${role.permission}. ${permissionRules}

Orchestrator instruction for this turn:
${call.instruction}

Shared project memory:
${projectMemory}

Your role memory:
${ownMemory}

Recent upstream role outputs:
${renderRecentOutputs(recentOutputs)}

Respond as ${role.name}. Be concise, concrete, and useful. End with any facts, decisions, risks, or open questions that should be remembered.`
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
  return value
    .map((item): MitaTeamsChoiceOption | undefined => {
      if (!item || typeof item !== 'object') return undefined
      const raw = item as Partial<MitaTeamsChoiceOption>
      if (typeof raw.label !== 'string') return undefined
      const option: MitaTeamsChoiceOption = {
        id: raw.id || raw.label,
        label: raw.label,
      }
      if (typeof raw.description === 'string') {
        option.description = raw.description
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
      const channelId =
        requestedChannelId && channelIds.has(requestedChannelId)
          ? requestedChannelId
          : findChannelForRole(config, roleId)?.id
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
  config: MitaTeamsConfig
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
          typeof raw.provider === 'string'
            ? raw.provider
            : (existing?.provider ?? modelSource?.provider),
        modelId:
          typeof raw.modelId === 'string'
            ? raw.modelId
            : (existing?.modelId ?? modelSource?.modelId),
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

function normalizeChannelMembership(
  channels: MitaTeamsChannelConfig[],
  roles: MitaTeamsRoleConfig[]
) {
  const validRoleIds = new Set(roles.map((role) => role.id))

  return channels.map((channel) => {
    const roleIds = channel.roleIds.filter((roleId) => validRoleIds.has(roleId))
    if (
      roleIds.length === 0 &&
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
      roleIds,
    }
  })
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

function parseDecision(
  text: string,
  config: MitaTeamsConfig,
  options: { onlyRoleIds?: MitaTeamsRoleId[] } = {}
): MitaTeamsOrchestratorDecision | undefined {
  const json = extractJsonObject(text)
  if (!json) return undefined

  try {
    const raw = JSON.parse(json) as Record<string, unknown>
    const reason =
      typeof raw.reason === 'string' ? raw.reason : 'Orchestrator decision.'

    if (raw.action === 'configure_team') {
      const roles = normalizeDecisionRoles(raw.roles, config)
      const virtualRoles = mergeRoles(config.roles, roles)
      const channels = normalizeDecisionChannels(
        raw.channels,
        config,
        virtualRoles
      )
      const virtualConfig = {
        ...config,
        roles: virtualRoles,
        channels: mergeChannels(config.channels, channels),
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
        channels,
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
  model,
  generateDecisionText,
  abortSignal,
}: {
  decisionPrompt: string
  config: MitaTeamsConfig
  userControl: MitaTeamsUserControl
  model?: ThreadModel
  generateDecisionText: GenerateDecisionText
  abortSignal?: AbortSignal
}): Promise<{
  decision: MitaTeamsOrchestratorDecision
  repairRequested: boolean
  invalidText?: string
}> {
  const parseOptions = { onlyRoleIds: userControl.onlyRoleIds }
  const firstText = await generateDecisionText({
    prompt: decisionPrompt,
    model,
    abortSignal,
  })
  const firstDecision = parseDecision(firstText, config, parseOptions)
  if (firstDecision) {
    return { decision: firstDecision, repairRequested: false }
  }

  const repairText = await generateDecisionText({
    prompt: buildDecisionRepairPrompt(decisionPrompt, firstText),
    model,
    abortSignal,
  })
  const repairedDecision = parseDecision(repairText, config, parseOptions)
  if (repairedDecision) {
    return {
      decision: repairedDecision,
      repairRequested: true,
      invalidText: firstText,
    }
  }

  return {
    decision: jsonFailureDecision(),
    repairRequested: true,
    invalidText: `${firstText}\n\n${repairText}`,
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
      userChoiceRequest:
        runtime.userChoiceRequest?.status === 'pending'
          ? runtime.userChoiceRequest
          : undefined,
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
  generateRoleText,
  abortSignal,
}: {
  config: MitaTeamsConfig
  runtime: MitaTeamsRuntime
  call: MitaTeamsRoleCallPlan
  userText: string
  recentOutputs: RoleOutput[]
  generateRoleText: GenerateRoleText
  abortSignal?: AbortSignal
}): Promise<{ runtime: MitaTeamsRuntime; output?: RoleOutput }> {
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

  try {
    const prompt = buildRolePrompt({
      config,
      role,
      runtime: nextRuntime,
      userText,
      call,
      recentOutputs,
    })
    const outputText = trimText(
      await generateRoleText({
        role,
        prompt,
        model,
        abortSignal,
      }),
      4000
    )
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
    return {
      runtime: nextRuntime,
      output: {
        roleId: role.id,
        roleName: role.name,
        channelId: call.channelId,
        output: outputText,
      },
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Role call failed unexpectedly'
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
  const baseTaskIds = new Set(branchBase.tasks.map((task) => task.id))
  const currentTaskIds = new Set(current.tasks.map((task) => task.id))
  const newTasks = branch.tasks.filter(
    (task) => !baseTaskIds.has(task.id) && !currentTaskIds.has(task.id)
  )
  const baseArtifactIds = new Set(
    branchBase.artifacts.map((artifact) => artifact.id)
  )
  const currentArtifactIds = new Set(
    current.artifacts.map((artifact) => artifact.id)
  )
  const newArtifacts = branch.artifacts.filter(
    (artifact) =>
      !baseArtifactIds.has(artifact.id) && !currentArtifactIds.has(artifact.id)
  )

  return {
    tasks: [...current.tasks, ...newTasks].slice(-40),
    artifacts: [...current.artifacts, ...newArtifacts].slice(-60),
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
  generateRoleText,
  abortSignal,
  notify,
}: {
  config: MitaTeamsConfig
  runtime: MitaTeamsRuntime
  decision: Extract<MitaTeamsOrchestratorDecision, { action: 'call_roles' }>
  userText: string
  recentOutputs: RoleOutput[]
  generateRoleText: GenerateRoleText
  abortSignal?: AbortSignal
  notify: (runtime: MitaTeamsRuntime) => void
}) {
  let nextRuntime = updateRun(runtime, {
    executionMode: decision.mode,
    activeRoleIds: decision.calls.map((call) => call.roleId),
  })
  const outputs: RoleOutput[] = []

  for (const group of groupCalls(decision)) {
    const groupBase = nextRuntime
    const groupResults = await Promise.all(
      group.map((call) =>
        runRoleCall({
          config,
          runtime: groupBase,
          call,
          userText,
          recentOutputs: [...recentOutputs, ...outputs],
          generateRoleText,
          abortSignal,
        }).then((result) => ({ ...result, roleId: call.roleId }))
      )
    )

    for (const result of groupResults) {
      nextRuntime = mergeRoleBranch({
        current: nextRuntime,
        branch: result.runtime,
        branchBase: groupBase,
        roleId: result.roleId,
      })
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

export async function runMitaTeamsRuntime({
  config,
  userText,
  threadTitle,
  abortSignal,
  onConfigChange,
  generateRoleText = defaultGenerateRoleText,
  generateDecisionText = defaultGenerateDecisionText,
}: RunMitaTeamsRuntimeOptions): Promise<MitaTeamsRuntimeResult> {
  let workingConfig = withMitaTeamsRuntime(config, config.runtime)
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
      })
      const decisionResolution = await generateParsedDecision({
        decisionPrompt,
        config: workingConfig,
        userControl,
        model: orchestrator ? modelForRole(orchestrator) : undefined,
        generateDecisionText,
        abortSignal,
      })
      const decision = decisionResolution.decision

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
    const message =
      error instanceof Error ? error.message : 'Mita Teams runtime failed'
    runtime = completeRun(runtime, 'failed', message)
    notify(runtime)
    return {
      config: workingConfig,
      finalResponse: `Mita Teams 运行失败：${message}`,
      status: 'failed',
    }
  }
}
