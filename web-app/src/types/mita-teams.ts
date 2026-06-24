export type MitaTeamsMode =
  | 'relay'
  | 'roundtable'
  | 'debate'
  | 'red-team'
  | 'silent'

export type MitaTeamsChannelId = string

export type MitaTeamsRoleId = string

export type MitaTeamsPermission = 'read' | 'tools' | 'write'

export type MitaTeamsWorkspaceView = 'team-chat' | 'role-chat' | 'role-config'

export type MitaTeamsTaskTemplateId =
  | 'code'
  | 'research'
  | 'product'
  | 'writing'
  | 'debugging'

export type MitaTeamsScenarioId = 'market_research'

export type MitaTeamsTaskStatus =
  | 'todo'
  | 'researching'
  | 'implementing'
  | 'reviewing'
  | 'done'

export type MitaTeamsArtifactType =
  | 'decision'
  | 'risk'
  | 'artifact'
  | 'test_result'
  | 'final_draft'

export type MitaTeamsRunStatus =
  | 'idle'
  | 'running'
  | 'waiting-for-user'
  | 'completed'
  | 'stopped'
  | 'failed'

export type MitaTeamsRoleStatus =
  | 'idle'
  | 'running'
  | 'done'
  | 'blocked'
  | 'failed'

export type MitaTeamsExecutionMode = 'parallel' | 'serial' | 'hybrid'

export type MitaTeamsRoleStreamMessage = {
  id: string
  turnId: string
  roleId: MitaTeamsRoleId
  channelId?: MitaTeamsChannelId
  role: 'system' | 'user' | 'assistant'
  content: string
  createdAt: string
  model?: ThreadModel
  sourceRoleIds?: MitaTeamsRoleId[]
}

export type MitaTeamsRoleMemory = {
  roleId: MitaTeamsRoleId
  version: number
  summary: string
  facts: string[]
  decisions: string[]
  openQuestions: string[]
  workingNotes: string[]
  updatedAt: string
}

export type MitaTeamsRoleState = {
  roleId: MitaTeamsRoleId
  status: MitaTeamsRoleStatus
  stream: MitaTeamsRoleStreamMessage[]
  memory: MitaTeamsRoleMemory
  lastTurnId?: string
  lastError?: string
}

export type MitaTeamsProjectMemory = {
  version: number
  summary: string
  facts: string[]
  decisions: string[]
  openQuestions: string[]
  milestones: string[]
  sourceRoleMemoryVersions: Partial<Record<MitaTeamsRoleId, number>>
  updatedAt: string
}

export type MitaTeamsMilestone = {
  id: string
  title: string
  createdAt: string
  sourceRoleId?: MitaTeamsRoleId
}

export type MitaTeamsTokenUsage = {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  estimatedCostUsd?: number
}

export type MitaTeamsChoiceOption = {
  id: string
  label: string
  description?: string
}

export type MitaTeamsUserInputKind =
  | 'single_choice'
  | 'free_text'
  | 'plan_approval'
  | 'keep_role_edits'

export type MitaTeamsChoiceRequest = {
  id: string
  kind?: MitaTeamsUserInputKind
  question: string
  options: MitaTeamsChoiceOption[]
  status: 'pending' | 'answered'
  selectedOptionId?: string
  responseText?: string
  createdAt: string
  answeredAt?: string
}

export type MitaTeamsRoleCallPlan = {
  roleId: MitaTeamsRoleId
  channelId?: MitaTeamsChannelId
  instruction: string
  mode?: MitaTeamsExecutionMode
  dependsOn?: MitaTeamsRoleId[]
  group?: number
  requiredPermission?: MitaTeamsPermission
}

export type MitaTeamsTask = {
  id: string
  title: string
  status: MitaTeamsTaskStatus
  roleId?: MitaTeamsRoleId
  channelId?: MitaTeamsChannelId
  createdAt: string
  updatedAt: string
}

export type MitaTeamsTaskUpdate = {
  id?: string
  title: string
  status: MitaTeamsTaskStatus
  roleId?: MitaTeamsRoleId
  channelId?: MitaTeamsChannelId
}

export type MitaTeamsArtifact = {
  id: string
  type: MitaTeamsArtifactType
  title: string
  summary: string
  content?: string
  roleId?: MitaTeamsRoleId
  channelId?: MitaTeamsChannelId
  createdAt: string
  updatedAt: string
}

export type MitaTeamsArtifactUpdate = {
  id?: string
  type: MitaTeamsArtifactType
  title: string
  summary: string
  content?: string
  roleId?: MitaTeamsRoleId
  channelId?: MitaTeamsChannelId
}

export type MitaTeamsStructuredUpdates = {
  tasks?: MitaTeamsTaskUpdate[]
  artifacts?: MitaTeamsArtifactUpdate[]
}

type MitaTeamsDecisionUpdates = {
  updates?: MitaTeamsStructuredUpdates
}

export type MitaTeamsPlanTask = {
  id: string
  title: string
  description?: string
  roleId?: MitaTeamsRoleId
}

export type MitaTeamsPlanRoleAssignment = {
  roleId: MitaTeamsRoleId
  name: string
  assignment: string
  model?: string
  prompt?: string
}

export type MitaTeamsPlanDraft = {
  id: string
  version: number
  status: 'draft' | 'approved' | 'superseded'
  goal: string
  summary: string
  scope: string[]
  acceptanceCriteria: string[]
  tasks: MitaTeamsPlanTask[]
  roleAssignments: MitaTeamsPlanRoleAssignment[]
  executionOrder: string[]
  revisionPrompt?: string
  createdAt: string
  updatedAt: string
  approvedAt?: string
}

export type MitaTeamsRuntimePhase =
  | 'idle'
  | 'clarifying'
  | 'awaiting_plan_approval'
  | 'awaiting_role_edit_confirmation'
  | 'running'
  | 'completed'

export type MitaTeamsRoleEditableField =
  | 'prompt'
  | 'provider'
  | 'modelId'
  | 'name'
  | 'description'
  | 'permission'
  | 'enabled'

export type MitaTeamsRoleUserEdit = {
  fields: MitaTeamsRoleEditableField[]
  updatedAt: string
}

export type MitaTeamsRoleEditBaseline = Pick<
  MitaTeamsRoleConfig,
  | 'id'
  | 'name'
  | 'description'
  | 'prompt'
  | 'permission'
  | 'provider'
  | 'modelId'
  | 'enabled'
>

export type MitaTeamsOrchestratorDecision =
  | ({
      action: 'configure_team'
      reason: string
      roles: MitaTeamsRoleConfig[]
      channels: MitaTeamsChannelConfig[]
      mode?: MitaTeamsExecutionMode
      calls?: MitaTeamsRoleCallPlan[]
    } & MitaTeamsDecisionUpdates)
  | ({
      action: 'call_roles'
      mode: MitaTeamsExecutionMode
      reason: string
      calls: MitaTeamsRoleCallPlan[]
    } & MitaTeamsDecisionUpdates)
  | ({
      action: 'ask_user'
      reason: string
      question: string
      options: MitaTeamsChoiceOption[]
      // Set only by the JSON-parse fallback (jsonFailureDecision). Marks this
      // ask_user as a mechanical parse failure rather than a genuine
      // owner-facing question, so post-approval handling can recover instead of
      // treating it as a protocol violation.
      parseFallback?: boolean
    } & MitaTeamsDecisionUpdates)
  | ({
      action: 'clarify_user'
      reason: string
      question: string
      inputKind?: 'single_choice' | 'free_text'
      options?: MitaTeamsChoiceOption[]
    } & MitaTeamsDecisionUpdates)
  | ({
      action: 'propose_plan'
      reason: string
      plan: Partial<MitaTeamsPlanDraft>
    } & MitaTeamsDecisionUpdates)
  | ({
      action: 'revise_plan'
      reason: string
      plan: Partial<MitaTeamsPlanDraft>
    } & MitaTeamsDecisionUpdates)
  | ({
      action: 'milestone'
      reason: string
      milestone: string
      next?: MitaTeamsOrchestratorDecision
    } & MitaTeamsDecisionUpdates)
  | ({
      action: 'stop'
      reason: string
      finalResponse: string
    } & MitaTeamsDecisionUpdates)

export type MitaTeamsTeamEvent = {
  id: string
  type:
    | 'run_started'
    | 'decision'
    | 'team_configured'
    | 'role_called'
    | 'role_completed'
    | 'memory_merged'
    | 'milestone'
    | 'choice_requested'
    | 'choice_answered'
    | 'plan_proposed'
    | 'plan_approved'
    | 'plan_revision_requested'
    | 'role_edit_confirmation_requested'
    | 'tasks_updated'
    | 'artifact_recorded'
    | 'json_repair_requested'
    | 'run_completed'
    | 'run_failed'
  title: string
  detail?: string
  roleId?: MitaTeamsRoleId
  channelId?: MitaTeamsChannelId
  createdAt: string
}

export type MitaTeamsRun = {
  id: string
  status: MitaTeamsRunStatus
  currentRound: number
  maxRounds: number
  callCount: number
  executionMode?: MitaTeamsExecutionMode
  activeRoleIds: MitaTeamsRoleId[]
  lastDecision?: MitaTeamsOrchestratorDecision
  startedAt: string
  updatedAt: string
  completedAt?: string
  durationMs?: number
  usage?: MitaTeamsTokenUsage
  error?: string
}

export type MitaTeamsRuntime = {
  version: 1
  phase: MitaTeamsRuntimePhase
  run?: MitaTeamsRun
  projectMemory: MitaTeamsProjectMemory
  roleStates: Partial<Record<MitaTeamsRoleId, MitaTeamsRoleState>>
  tasks: MitaTeamsTask[]
  artifacts: MitaTeamsArtifact[]
  milestones: MitaTeamsMilestone[]
  teamEvents: MitaTeamsTeamEvent[]
  clarificationCount: number
  planDraft?: MitaTeamsPlanDraft
  approvedPlan?: MitaTeamsPlanDraft
  approvedRoleSnapshot?: MitaTeamsRoleConfig[]
  roleEditBaseline?: Partial<Record<MitaTeamsRoleId, MitaTeamsRoleEditBaseline>>
  roleUserEdits?: Partial<Record<MitaTeamsRoleId, MitaTeamsRoleUserEdit>>
  pendingPlanRevision?: string
  userChoiceRequest?: MitaTeamsChoiceRequest
}

export type MitaTeamsChannelConfig = {
  id: MitaTeamsChannelId
  label: string
  description: string
  roleIds: MitaTeamsRoleId[]
}

export type MitaTeamsRoleConfig = {
  id: MitaTeamsRoleId
  name: string
  label: string
  description: string
  prompt: string
  color: string
  permission: MitaTeamsPermission
  provider?: string
  modelId?: string
  enabled: boolean
}

export type MitaTeamsWorkflowControl = 'user_spec'

export type MitaTeamsConfig = {
  enabled: boolean
  scenarioId?: MitaTeamsScenarioId
  workflowControl?: MitaTeamsWorkflowControl
  mode: MitaTeamsMode
  taskTemplateId: MitaTeamsTaskTemplateId
  activeChannel: MitaTeamsChannelId
  activeRoleId: MitaTeamsRoleId
  workspaceView: MitaTeamsWorkspaceView
  channels: MitaTeamsChannelConfig[]
  roundLimit: number
  roles: MitaTeamsRoleConfig[]
  runtime: MitaTeamsRuntime
  createdAt: string
  updatedAt: string
}

export const MITA_TEAMS_METADATA_KEY = 'mitaTeams'
export const MITA_TEAMS_ORCHESTRATOR_ROLE_ID = 'orchestrator'
export const MITA_TEAMS_TASK_CHANNEL_ID = 'task'

export const normalizeMitaTeamsId = (
  value: unknown,
  fallback: string
): string => {
  if (typeof value !== 'string') return fallback
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)

  return normalized || fallback
}

export const isMitaTeamsId = (value: unknown): value is string =>
  typeof value === 'string' && normalizeMitaTeamsId(value, '') === value

export const MITA_TEAMS_CHANNELS: Array<{
  id: MitaTeamsChannelId
  label: string
  description: string
  roleIds: MitaTeamsRoleId[]
}> = [
  {
    id: MITA_TEAMS_TASK_CHANNEL_ID,
    label: 'Current task',
    description:
      'The shared working room for the owner goal and current context.',
    roleIds: [MITA_TEAMS_ORCHESTRATOR_ROLE_ID],
  },
  {
    id: 'research',
    label: 'Research',
    description:
      'Collect evidence, references, code findings, and open questions.',
    roleIds: ['researcher'],
  },
  {
    id: 'discussion',
    label: 'Discussion',
    description: 'Compare options, resolve disagreements, and align the team.',
    roleIds: ['orchestrator', 'architect', 'skeptic'],
  },
  {
    id: 'build',
    label: 'Build log',
    description:
      'Track concrete edits, implementation notes, and verification output.',
    roleIds: ['builder'],
  },
  {
    id: 'review',
    label: 'Review',
    description:
      'Inspect risks, regressions, missing tests, and acceptance gaps.',
    roleIds: ['reviewer', 'skeptic'],
  },
  {
    id: 'final',
    label: 'Final delivery',
    description:
      'Assemble the user-facing answer, artifacts, and next actions.',
    roleIds: ['orchestrator', 'reviewer'],
  },
]

export const MITA_TEAMS_MODES: Array<{
  id: MitaTeamsMode
  label: string
  description: string
}> = [
  {
    id: 'relay',
    label: 'Relay',
    description: 'Research, plan, build, review, then summarize.',
  },
  {
    id: 'roundtable',
    label: 'Roundtable',
    description: 'Collect role perspectives before the coordinator decides.',
  },
  {
    id: 'debate',
    label: 'Debate',
    description: 'Compare options through proposal and rebuttal.',
  },
  {
    id: 'red-team',
    label: 'Red team',
    description: 'Stress-test a candidate answer or implementation.',
  },
  {
    id: 'silent',
    label: 'Silent',
    description: 'Keep internal collaboration quiet and show checkpoints.',
  },
]

export const MITA_TEAMS_TASK_TEMPLATES: Array<{
  id: MitaTeamsTaskTemplateId
  label: string
  description: string
  defaultMode: MitaTeamsMode
  recommendedRoleIds: MitaTeamsRoleId[]
  orchestratorHint: string
  defaultFlow: string[]
}> = [
  {
    id: 'code',
    label: 'Code',
    description: 'Plan, implement, review, and verify software changes.',
    defaultMode: 'relay',
    recommendedRoleIds: ['architect', 'builder', 'reviewer', 'qa'],
    orchestratorHint:
      'For code work, prefer a relay flow: clarify scope, inspect relevant files, design the smallest safe change, implement, review, and verify.',
    defaultFlow: ['Scope', 'Inspect', 'Build', 'Review', 'Verify'],
  },
  {
    id: 'research',
    label: 'Research',
    description:
      'Gather evidence, compare sources, and deliver a sourced answer.',
    defaultMode: 'roundtable',
    recommendedRoleIds: ['researcher', 'skeptic', 'editor'],
    orchestratorHint:
      'For research work, separate evidence from inference, ask for missing constraints, and converge into a cited summary.',
    defaultFlow: ['Question', 'Evidence', 'Compare', 'Synthesize'],
  },
  {
    id: 'product',
    label: 'Product',
    description:
      'Clarify users, prioritize scope, and shape product decisions.',
    defaultMode: 'debate',
    recommendedRoleIds: ['pm', 'architect', 'skeptic', 'editor'],
    orchestratorHint:
      'For product work, make the user journey explicit, compare tradeoffs, and convert discussion into decisions and next steps.',
    defaultFlow: ['User', 'Options', 'Tradeoffs', 'Decision'],
  },
  {
    id: 'writing',
    label: 'Writing',
    description: 'Draft, edit, critique, and polish a deliverable text.',
    defaultMode: 'roundtable',
    recommendedRoleIds: ['editor', 'skeptic', 'pm'],
    orchestratorHint:
      'For writing work, identify audience and purpose, produce a draft, critique it, then polish the final version.',
    defaultFlow: ['Audience', 'Draft', 'Critique', 'Polish'],
  },
  {
    id: 'debugging',
    label: 'Debugging',
    description: 'Reproduce, isolate, fix, and verify defects.',
    defaultMode: 'relay',
    recommendedRoleIds: ['researcher', 'builder', 'reviewer', 'qa'],
    orchestratorHint:
      'For debugging work, reproduce symptoms, isolate the likely cause, apply the narrow fix, then verify the failure mode is gone.',
    defaultFlow: ['Reproduce', 'Isolate', 'Fix', 'Verify'],
  },
]

export const MITA_TEAMS_ROLE_COLORS: Array<{
  label: string
  value: string
}> = [
  { label: 'Coral', value: 'bg-primary' },
  { label: 'Sky', value: 'bg-sky-600' },
  { label: 'Violet', value: 'bg-violet-600' },
  { label: 'Emerald', value: 'bg-emerald-600' },
  { label: 'Rose', value: 'bg-rose-700' },
  { label: 'Slate', value: 'bg-slate-500' },
  { label: 'Amber', value: 'bg-amber-600' },
  { label: 'Cyan', value: 'bg-cyan-600' },
]

export const DEFAULT_MITA_TEAMS_ROLES: MitaTeamsRoleConfig[] = [
  {
    id: MITA_TEAMS_ORCHESTRATOR_ROLE_ID,
    name: 'Orchestrator',
    label: 'Host',
    description: 'Break down the request, choose speakers, and converge.',
    prompt:
      'You are the coordinator. Clarify the goal, decide which roles should speak, merge their contributions, and keep the final answer concise and actionable.',
    color: 'bg-primary',
    permission: 'tools',
    enabled: true,
  },
  {
    id: 'researcher',
    name: 'Researcher',
    label: 'Research',
    description: 'Collect code, document, and external evidence.',
    prompt:
      'You are the researcher. Gather relevant facts, inspect available context, cite uncertainty, and separate evidence from assumptions.',
    color: 'bg-sky-600',
    permission: 'read',
    enabled: true,
  },
  {
    id: 'architect',
    name: 'Architect',
    label: 'Plan',
    description: 'Shape the solution, boundaries, and tradeoffs.',
    prompt:
      'You are the architect. Turn the goal into a coherent approach, identify boundaries, compare tradeoffs, and keep implementation scope controlled.',
    color: 'bg-violet-600',
    permission: 'read',
    enabled: true,
  },
  {
    id: 'builder',
    name: 'Builder',
    label: 'Build',
    description: 'Make concrete edits and run focused verification.',
    prompt:
      'You are the builder. Produce concrete implementation steps or code changes, prefer existing project patterns, and verify the result with focused checks.',
    color: 'bg-emerald-600',
    permission: 'write',
    enabled: true,
  },
  {
    id: 'reviewer',
    name: 'Reviewer',
    label: 'Review',
    description: 'Find regressions, missing tests, and weak assumptions.',
    prompt:
      'You are the reviewer. Look for defects, regressions, missing tests, unclear assumptions, and user-facing risks before the answer is finalized.',
    color: 'bg-rose-700',
    permission: 'read',
    enabled: true,
  },
  {
    id: 'skeptic',
    name: 'Skeptic',
    label: 'Risk',
    description: 'Challenge the plan and preserve minority concerns.',
    prompt:
      'You are the skeptic. Challenge optimistic assumptions, highlight overlooked failure modes, and suggest cheaper or safer alternatives when appropriate.',
    color: 'bg-slate-500',
    permission: 'read',
    enabled: true,
  },
]

const clampRoundLimit = (value: unknown) => {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return 5
  return Math.min(10, Math.max(1, Math.round(numeric)))
}

const isMitaTeamsMode = (value: unknown): value is MitaTeamsMode =>
  MITA_TEAMS_MODES.some((mode) => mode.id === value)

const isMitaTeamsChannelId = (value: unknown): value is MitaTeamsChannelId =>
  isMitaTeamsId(value)

const isMitaTeamsRoleId = (value: unknown): value is MitaTeamsRoleId =>
  isMitaTeamsId(value)

const isMitaTeamsWorkspaceView = (
  value: unknown
): value is MitaTeamsWorkspaceView =>
  value === 'team-chat' || value === 'role-chat' || value === 'role-config'

const isMitaTeamsPermission = (value: unknown): value is MitaTeamsPermission =>
  value === 'read' || value === 'tools' || value === 'write'

const titleFromId = (id: string) =>
  id
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ') || 'Role'

const defaultCoordinatorRole = (model?: ThreadModel): MitaTeamsRoleConfig => ({
  ...DEFAULT_MITA_TEAMS_ROLES[0],
  provider: model?.provider,
  modelId: model?.id,
})

const defaultRoles = (model?: ThreadModel): MitaTeamsRoleConfig[] => [
  defaultCoordinatorRole(model),
]

const defaultTaskChannel = (): MitaTeamsChannelConfig => ({
  ...MITA_TEAMS_CHANNELS[0],
  roleIds: [MITA_TEAMS_ORCHESTRATOR_ROLE_ID],
})

const nowIso = () => new Date().toISOString()

const safeTextArray = (value: unknown, limit = 12): string[] =>
  Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, limit)
    : []

const uniqueIds = (values: unknown[], validIds?: Set<string>): string[] => {
  const seen = new Set<string>()
  const ids: string[] = []

  for (const value of values) {
    const id = normalizeMitaTeamsId(value, '')
    if (!id || seen.has(id)) continue
    if (validIds && !validIds.has(id)) continue
    seen.add(id)
    ids.push(id)
  }

  return ids
}

const uniqueChoiceOptionId = (
  rawId: unknown,
  label: string,
  index: number,
  seen: Set<string>
) => {
  const fallback = `option-${index + 1}`
  const base =
    normalizeMitaTeamsId(rawId, '') ||
    normalizeMitaTeamsId(label, '') ||
    fallback
  let id = base
  let suffix = 2

  while (seen.has(id)) {
    id = `${base}-${suffix}`
    suffix += 1
  }
  seen.add(id)
  return id
}

const createRoleMemory = (
  roleId: MitaTeamsRoleId,
  timestamp = nowIso()
): MitaTeamsRoleMemory => ({
  roleId,
  version: 0,
  summary: '',
  facts: [],
  decisions: [],
  openQuestions: [],
  workingNotes: [],
  updatedAt: timestamp,
})

const createRoleState = (
  role: MitaTeamsRoleConfig,
  timestamp = nowIso()
): MitaTeamsRoleState => ({
  roleId: role.id,
  status: 'idle',
  stream: [],
  memory: createRoleMemory(role.id, timestamp),
})

const createProjectMemory = (timestamp = nowIso()): MitaTeamsProjectMemory => ({
  version: 0,
  summary: '',
  facts: [],
  decisions: [],
  openQuestions: [],
  milestones: [],
  sourceRoleMemoryVersions: {},
  updatedAt: timestamp,
})

const isRunStatus = (value: unknown): value is MitaTeamsRunStatus =>
  value === 'idle' ||
  value === 'running' ||
  value === 'waiting-for-user' ||
  value === 'completed' ||
  value === 'stopped' ||
  value === 'failed'

const isRoleStatus = (value: unknown): value is MitaTeamsRoleStatus =>
  value === 'idle' ||
  value === 'running' ||
  value === 'done' ||
  value === 'blocked' ||
  value === 'failed'

const isExecutionMode = (value: unknown): value is MitaTeamsExecutionMode =>
  value === 'parallel' || value === 'serial' || value === 'hybrid'

const isRuntimePhase = (value: unknown): value is MitaTeamsRuntimePhase =>
  value === 'idle' ||
  value === 'clarifying' ||
  value === 'awaiting_plan_approval' ||
  value === 'awaiting_role_edit_confirmation' ||
  value === 'running' ||
  value === 'completed'

const isUserInputKind = (value: unknown): value is MitaTeamsUserInputKind =>
  value === 'single_choice' ||
  value === 'free_text' ||
  value === 'plan_approval' ||
  value === 'keep_role_edits'

const isTaskTemplateId = (value: unknown): value is MitaTeamsTaskTemplateId =>
  MITA_TEAMS_TASK_TEMPLATES.some((template) => template.id === value)

const isTaskStatus = (value: unknown): value is MitaTeamsTaskStatus =>
  value === 'todo' ||
  value === 'researching' ||
  value === 'implementing' ||
  value === 'reviewing' ||
  value === 'done'

const isArtifactType = (value: unknown): value is MitaTeamsArtifactType =>
  value === 'decision' ||
  value === 'risk' ||
  value === 'artifact' ||
  value === 'test_result' ||
  value === 'final_draft'

const ROLE_EDITABLE_FIELDS: MitaTeamsRoleEditableField[] = [
  'prompt',
  'provider',
  'modelId',
  'name',
  'description',
  'permission',
  'enabled',
]

const isRoleEditableField = (
  value: unknown
): value is MitaTeamsRoleEditableField =>
  typeof value === 'string' &&
  ROLE_EDITABLE_FIELDS.includes(value as MitaTeamsRoleEditableField)

const defaultTaskTemplate = (value?: unknown) =>
  MITA_TEAMS_TASK_TEMPLATES.find((template) => template.id === value) ??
  MITA_TEAMS_TASK_TEMPLATES[0]

const safeOptionalRoleId = (value: unknown) =>
  isMitaTeamsRoleId(value) ? value : undefined

const safeOptionalChannelId = (value: unknown) =>
  isMitaTeamsChannelId(value) ? value : undefined

const normalizeStream = (
  value: unknown,
  roleId: MitaTeamsRoleId
): MitaTeamsRoleStreamMessage[] =>
  Array.isArray(value)
    ? value
        .map((item): MitaTeamsRoleStreamMessage | undefined => {
          if (!item || typeof item !== 'object') return undefined
          const raw = item as Partial<MitaTeamsRoleStreamMessage>
          if (typeof raw.content !== 'string') return undefined
          const streamRole: MitaTeamsRoleStreamMessage['role'] =
            raw.role === 'system' || raw.role === 'user'
              ? raw.role
              : 'assistant'
          const message: MitaTeamsRoleStreamMessage = {
            id: raw.id || `${roleId}-${Date.now()}`,
            turnId: raw.turnId || raw.id || `${roleId}-${Date.now()}`,
            roleId,
            channelId: isMitaTeamsChannelId(raw.channelId)
              ? raw.channelId
              : undefined,
            role: streamRole,
            content: raw.content,
            createdAt: raw.createdAt || nowIso(),
          }
          if (raw.model) message.model = raw.model
          if (Array.isArray(raw.sourceRoleIds)) {
            const sourceRoleIds = raw.sourceRoleIds.filter(isMitaTeamsRoleId)
            if (sourceRoleIds.length > 0) message.sourceRoleIds = sourceRoleIds
          }
          return message
        })
        .filter(
          (item): item is MitaTeamsRoleStreamMessage => item !== undefined
        )
        .slice(-40)
    : []

const normalizeRoleMemory = (
  value: unknown,
  roleId: MitaTeamsRoleId
): MitaTeamsRoleMemory => {
  const fallback = createRoleMemory(roleId)
  if (!value || typeof value !== 'object') return fallback
  const raw = value as Partial<MitaTeamsRoleMemory>
  const version = typeof raw.version === 'number' ? raw.version : 0

  return {
    roleId,
    version,
    summary: typeof raw.summary === 'string' ? raw.summary : '',
    facts: safeTextArray(raw.facts),
    decisions: safeTextArray(raw.decisions),
    openQuestions: safeTextArray(raw.openQuestions),
    workingNotes: safeTextArray(raw.workingNotes),
    updatedAt: raw.updatedAt || fallback.updatedAt,
  }
}

const normalizeProjectMemory = (value: unknown): MitaTeamsProjectMemory => {
  const fallback = createProjectMemory()
  if (!value || typeof value !== 'object') return fallback
  const raw = value as Partial<MitaTeamsProjectMemory>
  const sourceVersions =
    raw.sourceRoleMemoryVersions &&
    typeof raw.sourceRoleMemoryVersions === 'object'
      ? Object.fromEntries(
          Object.entries(raw.sourceRoleMemoryVersions).filter(
            ([roleId, version]) =>
              isMitaTeamsRoleId(roleId) && typeof version === 'number'
          )
        )
      : {}

  return {
    version: typeof raw.version === 'number' ? raw.version : 0,
    summary: typeof raw.summary === 'string' ? raw.summary : '',
    facts: safeTextArray(raw.facts, 20),
    decisions: safeTextArray(raw.decisions, 20),
    openQuestions: safeTextArray(raw.openQuestions, 20),
    milestones: safeTextArray(raw.milestones, 20),
    sourceRoleMemoryVersions: sourceVersions,
    updatedAt: raw.updatedAt || fallback.updatedAt,
  }
}

const normalizeChoiceRequest = (
  value: unknown
): MitaTeamsChoiceRequest | undefined => {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Partial<MitaTeamsChoiceRequest>
  if (typeof raw.question !== 'string') {
    return undefined
  }
  const kind = isUserInputKind(raw.kind) ? raw.kind : 'single_choice'
  const seenOptionIds = new Set<string>()
  const options = (Array.isArray(raw.options) ? raw.options : [])
    .map((option, index): MitaTeamsChoiceOption | undefined => {
      if (!option || typeof option !== 'object') return undefined
      const item = option as Partial<MitaTeamsChoiceOption>
      if (typeof item.label !== 'string') return undefined
      const normalized: MitaTeamsChoiceOption = {
        id: uniqueChoiceOptionId(
          item.id,
          item.label,
          index,
          seenOptionIds
        ),
        label: item.label.trim(),
      }
      if (typeof item.description === 'string') {
        normalized.description = item.description.trim()
      }
      return normalized
    })
    .filter((option): option is MitaTeamsChoiceOption => option !== undefined)
    .slice(0, 4)

  if (kind !== 'free_text' && options.length === 0) return undefined
  const selectedOptionId = normalizeMitaTeamsId(raw.selectedOptionId, '')
  const safeSelectedOptionId = options.find(
    (option) => option.id === selectedOptionId
  )?.id
  const responseText =
    typeof raw.responseText === 'string' && raw.responseText.trim()
      ? raw.responseText.trim()
      : undefined
  const isAnswered =
    raw.status === 'answered' &&
    (safeSelectedOptionId || (kind === 'free_text' && responseText))

  return {
    id: raw.id || `choice-${Date.now()}`,
    kind,
    question: raw.question,
    options,
    status: isAnswered ? 'answered' : 'pending',
    selectedOptionId: safeSelectedOptionId,
    responseText,
    createdAt: raw.createdAt || nowIso(),
    answeredAt: isAnswered ? raw.answeredAt : undefined,
  }
}

const normalizeTaskList = (value: unknown): MitaTeamsTask[] =>
  Array.isArray(value)
    ? value
        .map((task): MitaTeamsTask | undefined => {
          if (!task || typeof task !== 'object') return undefined
          const raw = task as Partial<MitaTeamsTask>
          if (typeof raw.title !== 'string' || !raw.title.trim()) {
            return undefined
          }
          const id =
            normalizeMitaTeamsId(raw.id, '') ||
            normalizeMitaTeamsId(raw.title, `task-${Date.now()}`)
          const now = nowIso()
          return {
            id,
            title: raw.title.trim(),
            status: isTaskStatus(raw.status) ? raw.status : 'todo',
            roleId: safeOptionalRoleId(raw.roleId),
            channelId: safeOptionalChannelId(raw.channelId),
            createdAt: raw.createdAt || now,
            updatedAt: raw.updatedAt || now,
          }
        })
        .filter((task): task is MitaTeamsTask => task !== undefined)
        .slice(-40)
    : []

const normalizeArtifactList = (value: unknown): MitaTeamsArtifact[] =>
  Array.isArray(value)
    ? value
        .map((artifact): MitaTeamsArtifact | undefined => {
          if (!artifact || typeof artifact !== 'object') return undefined
          const raw = artifact as Partial<MitaTeamsArtifact>
          if (
            typeof raw.title !== 'string' ||
            !raw.title.trim() ||
            typeof raw.summary !== 'string' ||
            !raw.summary.trim()
          ) {
            return undefined
          }
          const id =
            normalizeMitaTeamsId(raw.id, '') ||
            normalizeMitaTeamsId(raw.title, `artifact-${Date.now()}`)
          const now = nowIso()
          const normalized: MitaTeamsArtifact = {
            id,
            type: isArtifactType(raw.type) ? raw.type : 'artifact',
            title: raw.title.trim(),
            summary: raw.summary.trim(),
            roleId: safeOptionalRoleId(raw.roleId),
            channelId: safeOptionalChannelId(raw.channelId),
            createdAt: raw.createdAt || now,
            updatedAt: raw.updatedAt || now,
          }
          if (typeof raw.content === 'string' && raw.content.trim()) {
            normalized.content = raw.content.trim()
          }
          return normalized
        })
        .filter(
          (artifact): artifact is MitaTeamsArtifact => artifact !== undefined
        )
        .slice(-60)
    : []

const normalizePlanTaskList = (value: unknown): MitaTeamsPlanTask[] =>
  Array.isArray(value)
    ? value
        .map((task, index): MitaTeamsPlanTask | undefined => {
          if (!task || typeof task !== 'object') return undefined
          const raw = task as Partial<MitaTeamsPlanTask>
          if (typeof raw.title !== 'string' || !raw.title.trim()) {
            return undefined
          }
          const id =
            normalizeMitaTeamsId(raw.id, '') ||
            normalizeMitaTeamsId(raw.title, `plan-task-${index + 1}`)
          const normalized: MitaTeamsPlanTask = {
            id,
            title: raw.title.trim(),
            roleId: safeOptionalRoleId(raw.roleId),
          }
          if (typeof raw.description === 'string' && raw.description.trim()) {
            normalized.description = raw.description.trim()
          }
          return normalized
        })
        .filter((task): task is MitaTeamsPlanTask => task !== undefined)
        .slice(0, 20)
    : []

const normalizePlanRoleAssignments = (
  value: unknown
): MitaTeamsPlanRoleAssignment[] =>
  Array.isArray(value)
    ? value
        .map((assignment): MitaTeamsPlanRoleAssignment | undefined => {
          if (!assignment || typeof assignment !== 'object') return undefined
          const raw = assignment as Partial<MitaTeamsPlanRoleAssignment>
          const roleId = normalizeMitaTeamsId(raw.roleId, '')
          if (!roleId || typeof raw.name !== 'string') return undefined
          const normalized: MitaTeamsPlanRoleAssignment = {
            roleId,
            name: raw.name.trim() || titleFromId(roleId),
            assignment:
              typeof raw.assignment === 'string' && raw.assignment.trim()
                ? raw.assignment.trim()
                : 'Contribute to the approved plan.',
          }
          if (typeof raw.model === 'string' && raw.model.trim()) {
            normalized.model = raw.model.trim()
          }
          if (typeof raw.prompt === 'string' && raw.prompt.trim()) {
            normalized.prompt = raw.prompt.trim()
          }
          return normalized
        })
        .filter(
          (assignment): assignment is MitaTeamsPlanRoleAssignment =>
            assignment !== undefined
        )
        .slice(0, 20)
    : []

const normalizePlanDraft = (value: unknown): MitaTeamsPlanDraft | undefined => {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Partial<MitaTeamsPlanDraft>
  if (typeof raw.goal !== 'string' || !raw.goal.trim()) return undefined
  const now = nowIso()
  return {
    id: raw.id || `plan-${Date.now()}`,
    version: typeof raw.version === 'number' ? Math.max(1, raw.version) : 1,
    status:
      raw.status === 'approved' || raw.status === 'superseded'
        ? raw.status
        : 'draft',
    goal: raw.goal.trim(),
    summary:
      typeof raw.summary === 'string' && raw.summary.trim()
        ? raw.summary.trim()
        : raw.goal.trim(),
    scope: safeTextArray(raw.scope, 20),
    acceptanceCriteria: safeTextArray(raw.acceptanceCriteria, 20),
    tasks: normalizePlanTaskList(raw.tasks),
    roleAssignments: normalizePlanRoleAssignments(raw.roleAssignments),
    executionOrder: safeTextArray(raw.executionOrder, 20),
    revisionPrompt:
      typeof raw.revisionPrompt === 'string' && raw.revisionPrompt.trim()
        ? raw.revisionPrompt.trim()
        : undefined,
    createdAt: raw.createdAt || now,
    updatedAt: raw.updatedAt || now,
    approvedAt: raw.approvedAt,
  }
}

const roleEditBaselineFromRole = (
  role: MitaTeamsRoleConfig
): MitaTeamsRoleEditBaseline => ({
  id: role.id,
  name: role.name,
  description: role.description,
  prompt: role.prompt,
  permission: role.permission,
  provider: role.provider,
  modelId: role.modelId,
  enabled: role.enabled,
})

const normalizeRoleEditBaseline = (
  value: unknown,
  roles: MitaTeamsRoleConfig[]
): Partial<Record<MitaTeamsRoleId, MitaTeamsRoleEditBaseline>> => {
  const raw = value && typeof value === 'object' ? value : {}
  const byId = raw as Partial<Record<MitaTeamsRoleId, Partial<MitaTeamsRoleEditBaseline>>>
  return Object.fromEntries(
    roles.map((role) => {
      const saved = byId[role.id]
      return [
        role.id,
        {
          ...roleEditBaselineFromRole(role),
          ...(saved && typeof saved === 'object' ? saved : {}),
          id: role.id,
        },
      ]
    })
  )
}

const normalizeRoleUserEdits = (
  value: unknown
): Partial<Record<MitaTeamsRoleId, MitaTeamsRoleUserEdit>> => {
  if (!value || typeof value !== 'object') return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([roleId, rawEdit]) => {
        const id = normalizeMitaTeamsId(roleId, '')
        if (!id || !rawEdit || typeof rawEdit !== 'object') return undefined
        const edit = rawEdit as Partial<MitaTeamsRoleUserEdit>
        const fields = Array.isArray(edit.fields)
          ? edit.fields.filter(isRoleEditableField)
          : []
        if (fields.length === 0) return undefined
        return [
          id,
          {
            fields: Array.from(new Set(fields)),
            updatedAt: edit.updatedAt || nowIso(),
          },
        ] as const
      })
      .filter(
        (
          item
        ): item is readonly [MitaTeamsRoleId, MitaTeamsRoleUserEdit] =>
          item !== undefined
      )
  )
}

const normalizeTokenUsage = (
  value: unknown
): MitaTeamsTokenUsage | undefined => {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as MitaTeamsTokenUsage
  const usage: MitaTeamsTokenUsage = {}
  if (typeof raw.promptTokens === 'number')
    usage.promptTokens = raw.promptTokens
  if (typeof raw.completionTokens === 'number') {
    usage.completionTokens = raw.completionTokens
  }
  if (typeof raw.totalTokens === 'number') usage.totalTokens = raw.totalTokens
  if (typeof raw.estimatedCostUsd === 'number') {
    usage.estimatedCostUsd = raw.estimatedCostUsd
  }
  return Object.keys(usage).length ? usage : undefined
}

export function createDefaultMitaTeamsRuntime(
  roles: MitaTeamsRoleConfig[] = defaultRoles(),
  timestamp = nowIso()
): MitaTeamsRuntime {
  return {
    version: 1,
    phase: 'idle',
    projectMemory: createProjectMemory(timestamp),
    roleStates: Object.fromEntries(
      roles.map((role) => [role.id, createRoleState(role, timestamp)])
    ),
    tasks: [],
    artifacts: [],
    milestones: [],
    teamEvents: [],
    clarificationCount: 0,
    roleEditBaseline: Object.fromEntries(
      roles.map((role) => [role.id, roleEditBaselineFromRole(role)])
    ),
    roleUserEdits: {},
  }
}

export function normalizeMitaTeamsRuntime(
  value: unknown,
  roles: MitaTeamsRoleConfig[]
): MitaTeamsRuntime {
  const fallback = createDefaultMitaTeamsRuntime(roles)
  if (!value || typeof value !== 'object') return fallback
  const raw = value as Partial<MitaTeamsRuntime>
  const rawRoleStates =
    raw.roleStates && typeof raw.roleStates === 'object' ? raw.roleStates : {}

  const roleStates = Object.fromEntries(
    roles.map((role) => {
      const saved = rawRoleStates[role.id]
      const savedState =
        saved && typeof saved === 'object'
          ? (saved as Partial<MitaTeamsRoleState>)
          : undefined
      const memory = normalizeRoleMemory(savedState?.memory, role.id)
      return [
        role.id,
        {
          roleId: role.id,
          status: isRoleStatus(savedState?.status) ? savedState.status : 'idle',
          stream: normalizeStream(savedState?.stream, role.id),
          memory,
          lastTurnId: savedState?.lastTurnId,
          lastError: savedState?.lastError,
        } satisfies MitaTeamsRoleState,
      ]
    })
  )

  const run =
    raw.run && typeof raw.run === 'object'
      ? (() => {
          const saved = raw.run as Partial<MitaTeamsRun>
          return {
            id: saved.id || `run-${Date.now()}`,
            status: isRunStatus(saved.status) ? saved.status : 'idle',
            currentRound:
              typeof saved.currentRound === 'number' ? saved.currentRound : 0,
            maxRounds:
              typeof saved.maxRounds === 'number' ? saved.maxRounds : 5,
            callCount:
              typeof saved.callCount === 'number' ? saved.callCount : 0,
            executionMode: isExecutionMode(saved.executionMode)
              ? saved.executionMode
              : undefined,
            activeRoleIds: Array.isArray(saved.activeRoleIds)
              ? saved.activeRoleIds.filter(isMitaTeamsRoleId)
              : [],
            lastDecision: saved.lastDecision,
            startedAt: saved.startedAt || nowIso(),
            updatedAt: saved.updatedAt || nowIso(),
            completedAt: saved.completedAt,
            durationMs:
              typeof saved.durationMs === 'number'
                ? saved.durationMs
                : undefined,
            usage: normalizeTokenUsage(saved.usage),
            error: saved.error,
          } satisfies MitaTeamsRun
        })()
      : undefined

  return {
    version: 1,
    phase: isRuntimePhase(raw.phase) ? raw.phase : 'idle',
    run,
    projectMemory: normalizeProjectMemory(raw.projectMemory),
    roleStates,
    tasks: normalizeTaskList(raw.tasks),
    artifacts: normalizeArtifactList(raw.artifacts),
    milestones: Array.isArray(raw.milestones)
      ? raw.milestones
          .filter((milestone): milestone is MitaTeamsMilestone =>
            Boolean(
              milestone &&
                typeof milestone === 'object' &&
                typeof milestone.title === 'string'
            )
          )
          .slice(-20)
      : [],
    teamEvents: Array.isArray(raw.teamEvents)
      ? raw.teamEvents
          .filter((event): event is MitaTeamsTeamEvent =>
            Boolean(
              event &&
                typeof event === 'object' &&
                typeof event.title === 'string'
            )
          )
          .slice(-60)
      : [],
    clarificationCount:
      typeof raw.clarificationCount === 'number'
        ? Math.min(3, Math.max(0, Math.round(raw.clarificationCount)))
        : 0,
    planDraft: normalizePlanDraft(raw.planDraft),
    approvedPlan: normalizePlanDraft(raw.approvedPlan),
    approvedRoleSnapshot: Array.isArray(raw.approvedRoleSnapshot)
      ? raw.approvedRoleSnapshot
          .map((role) => {
            if (!role || typeof role !== 'object') return undefined
            const saved = role as Partial<MitaTeamsRoleConfig>
            const id = normalizeMitaTeamsId(saved.id, '')
            if (!id) return undefined
            const current = roles.find((item) => item.id === id)
            return current ? { ...current, ...saved, id } : undefined
          })
          .filter((role): role is MitaTeamsRoleConfig => role !== undefined)
      : undefined,
    roleEditBaseline: normalizeRoleEditBaseline(raw.roleEditBaseline, roles),
    roleUserEdits: normalizeRoleUserEdits(raw.roleUserEdits),
    pendingPlanRevision:
      typeof raw.pendingPlanRevision === 'string' &&
      raw.pendingPlanRevision.trim()
        ? raw.pendingPlanRevision.trim()
        : undefined,
    userChoiceRequest: normalizeChoiceRequest(raw.userChoiceRequest),
  }
}

export function createDefaultMitaTeamsConfig(
  model?: ThreadModel,
  taskTemplateId: MitaTeamsTaskTemplateId = 'code'
): MitaTeamsConfig {
  const now = nowIso()
  const roles = defaultRoles(model)
  const channels = [defaultTaskChannel()]
  const taskTemplate = defaultTaskTemplate(taskTemplateId)
  return {
    enabled: true,
    mode: taskTemplate.defaultMode,
    taskTemplateId: taskTemplate.id,
    activeChannel: MITA_TEAMS_TASK_CHANNEL_ID,
    activeRoleId: MITA_TEAMS_ORCHESTRATOR_ROLE_ID,
    workspaceView: 'team-chat',
    channels,
    roundLimit: 5,
    roles,
    runtime: createDefaultMitaTeamsRuntime(roles, now),
    createdAt: now,
    updatedAt: now,
  }
}

export function normalizeMitaTeamsConfig(
  value: unknown,
  model?: ThreadModel
): MitaTeamsConfig | undefined {
  if (!value || typeof value !== 'object') return undefined

  const raw = value as Partial<MitaTeamsConfig>
  if (raw.enabled !== true) return undefined

  const taskTemplateId = isTaskTemplateId(raw.taskTemplateId)
    ? raw.taskTemplateId
    : 'code'
  const fallback = createDefaultMitaTeamsConfig(model, taskTemplateId)
  const rawRoles = Array.isArray(raw.roles) ? raw.roles : []
  const rawChannels = Array.isArray(raw.channels) ? raw.channels : []
  const roleTemplates = DEFAULT_MITA_TEAMS_ROLES.map((role) => ({
    ...role,
    provider: model?.provider,
    modelId: model?.id,
  }))

  const roles = rawRoles.length
    ? rawRoles
        .map((role): MitaTeamsRoleConfig | undefined => {
          if (!role || typeof role !== 'object') return undefined
          const saved = role as Partial<MitaTeamsRoleConfig>
          const id = normalizeMitaTeamsId(saved.id, '')
          if (!id) return undefined

          const template = roleTemplates.find(
            (defaultRole) => defaultRole.id === id
          ) ?? {
            id,
            name: titleFromId(id),
            label: titleFromId(id).slice(0, 12),
            description: '',
            prompt: '',
            color: 'bg-slate-500',
            permission: 'read' as const,
            provider: model?.provider,
            modelId: model?.id,
            enabled: true,
          }

          return {
            ...template,
            ...saved,
            id,
            name: saved.name || template.name,
            label: saved.label || template.label,
            description: saved.description || template.description,
            prompt: saved.prompt || template.prompt,
            color: saved.color || template.color,
            permission: isMitaTeamsPermission(saved.permission)
              ? saved.permission
              : template.permission,
            enabled: saved.enabled !== false,
          }
        })
        .filter((role): role is MitaTeamsRoleConfig => Boolean(role))
    : fallback.roles

  const candidateRoles = roles.length ? roles : fallback.roles
  const safeRoles = candidateRoles.some(
    (role) => role.id === MITA_TEAMS_ORCHESTRATOR_ROLE_ID
  )
    ? candidateRoles
    : [defaultCoordinatorRole(model), ...candidateRoles]
  const safeRoleIds = new Set(safeRoles.map((role) => role.id))

  const channels = rawChannels.length
    ? rawChannels
        .map((channel): MitaTeamsChannelConfig | undefined => {
          if (!channel || typeof channel !== 'object') return undefined
          const saved = channel as Partial<MitaTeamsChannelConfig>
          const id = normalizeMitaTeamsId(saved.id, '')
          if (!id) return undefined

          const template = MITA_TEAMS_CHANNELS.find(
            (item) => item.id === id
          ) ?? {
            id,
            label: titleFromId(id),
            description: '',
            roleIds: [],
          }
          const roleIds = uniqueIds(
            Array.isArray(saved.roleIds) && saved.roleIds.length
              ? saved.roleIds
              : template.roleIds,
            safeRoleIds
          )
          const fallbackRoleIds =
            id === MITA_TEAMS_TASK_CHANNEL_ID &&
            safeRoleIds.has(MITA_TEAMS_ORCHESTRATOR_ROLE_ID)
              ? [MITA_TEAMS_ORCHESTRATOR_ROLE_ID]
              : []

          return {
            ...template,
            ...saved,
            id,
            label: saved.label || template.label,
            description: saved.description || template.description,
            roleIds: roleIds.length ? roleIds : fallbackRoleIds,
          }
        })
        .filter((channel): channel is MitaTeamsChannelConfig =>
          Boolean(channel)
        )
    : fallback.channels

  const candidateChannels = channels.length ? channels : fallback.channels
  const channelsWithTask = candidateChannels.some(
    (channel) => channel.id === MITA_TEAMS_TASK_CHANNEL_ID
  )
    ? candidateChannels
    : [defaultTaskChannel(), ...candidateChannels]

  const safeChannels = channelsWithTask.map((channel) => {
    const roleIds = channel.roleIds.filter((roleId) => safeRoleIds.has(roleId))
    const taskRoleIds =
      channel.id === MITA_TEAMS_TASK_CHANNEL_ID &&
      safeRoleIds.has(MITA_TEAMS_ORCHESTRATOR_ROLE_ID) &&
      !roleIds.includes(MITA_TEAMS_ORCHESTRATOR_ROLE_ID)
        ? [MITA_TEAMS_ORCHESTRATOR_ROLE_ID, ...roleIds]
        : roleIds
    const fallbackRoleId =
      channel.id === MITA_TEAMS_TASK_CHANNEL_ID &&
      safeRoleIds.has(MITA_TEAMS_ORCHESTRATOR_ROLE_ID)
        ? MITA_TEAMS_ORCHESTRATOR_ROLE_ID
        : safeRoles[0]?.id

    return {
      ...channel,
      roleIds: taskRoleIds.length
        ? taskRoleIds
        : fallbackRoleId
          ? [fallbackRoleId]
          : [],
    }
  })
  const safeChannelIds = new Set(safeChannels.map((channel) => channel.id))
  const normalizedActiveRoleId = normalizeMitaTeamsId(raw.activeRoleId, '')
  const normalizedActiveChannel = normalizeMitaTeamsId(raw.activeChannel, '')
  const activeRoleId =
    normalizedActiveRoleId && safeRoleIds.has(normalizedActiveRoleId)
      ? normalizedActiveRoleId
      : (safeRoles[0]?.id ?? MITA_TEAMS_ORCHESTRATOR_ROLE_ID)
  const activeChannel =
    normalizedActiveChannel && safeChannelIds.has(normalizedActiveChannel)
      ? normalizedActiveChannel
      : (safeChannels[0]?.id ?? MITA_TEAMS_TASK_CHANNEL_ID)

  return {
    ...fallback,
    ...raw,
    enabled: true,
    scenarioId: raw.scenarioId === 'market_research' ? raw.scenarioId : undefined,
    workflowControl: raw.workflowControl === 'user_spec' ? 'user_spec' : undefined,
    mode: isMitaTeamsMode(raw.mode) ? raw.mode : fallback.mode,
    taskTemplateId,
    activeChannel,
    activeRoleId,
    workspaceView: isMitaTeamsWorkspaceView(raw.workspaceView)
      ? raw.workspaceView
      : fallback.workspaceView,
    channels: safeChannels,
    roundLimit: clampRoundLimit(raw.roundLimit),
    roles: safeRoles,
    runtime: normalizeMitaTeamsRuntime(raw.runtime, safeRoles),
    createdAt: raw.createdAt || fallback.createdAt,
    updatedAt: raw.updatedAt || nowIso(),
  }
}

export function isMitaTeamsThread(thread?: Thread): boolean {
  return Boolean(normalizeMitaTeamsConfig(thread?.metadata?.mitaTeams))
}

export function patchMitaTeamsConfig(
  config: MitaTeamsConfig,
  patch: Partial<MitaTeamsConfig>
): MitaTeamsConfig {
  return {
    ...config,
    ...patch,
    updatedAt: new Date().toISOString(),
  }
}

export function createMitaTeamsPlanDraft(
  value: Partial<MitaTeamsPlanDraft>,
  fallbackGoal: string,
  previousVersion = 0
): MitaTeamsPlanDraft {
  const now = nowIso()
  return normalizePlanDraft({
    id: value.id || `plan-${Date.now()}`,
    version:
      typeof value.version === 'number'
        ? Math.max(1, value.version)
        : previousVersion + 1,
    status: value.status ?? 'draft',
    goal: value.goal || fallbackGoal,
    summary: value.summary || value.goal || fallbackGoal,
    scope: value.scope,
    acceptanceCriteria: value.acceptanceCriteria,
    tasks: value.tasks,
    roleAssignments: value.roleAssignments,
    executionOrder: value.executionOrder,
    revisionPrompt: value.revisionPrompt,
    createdAt: value.createdAt || now,
    updatedAt: now,
    approvedAt: value.approvedAt,
  })!
}

export function markMitaTeamsRoleUserEdit(
  config: MitaTeamsConfig,
  roleId: MitaTeamsRoleId,
  fields: MitaTeamsRoleEditableField[]
): MitaTeamsConfig {
  const safeFields = fields.filter(isRoleEditableField)
  if (!safeFields.length) return config
  const existing = config.runtime.roleUserEdits?.[roleId]
  const role = config.roles.find((item) => item.id === roleId)
  const nextRuntime: MitaTeamsRuntime = {
    ...config.runtime,
    roleEditBaseline: {
      ...config.runtime.roleEditBaseline,
      ...(role && !config.runtime.roleEditBaseline?.[roleId]
        ? { [roleId]: roleEditBaselineFromRole(role) }
        : {}),
    },
    roleUserEdits: {
      ...config.runtime.roleUserEdits,
      [roleId]: {
        fields: Array.from(
          new Set([...(existing?.fields ?? []), ...safeFields])
        ),
        updatedAt: nowIso(),
      },
    },
  }
  return patchMitaTeamsConfig(config, { runtime: nextRuntime })
}

const hasMitaTeamsRoleUserEdits = (runtime: MitaTeamsRuntime) =>
  Object.values(runtime.roleUserEdits ?? {}).some(
    (edit) => edit && edit.fields.length > 0
  )

const roleColorForIndex = (index: number) =>
  MITA_TEAMS_ROLE_COLORS[index % MITA_TEAMS_ROLE_COLORS.length]?.value ??
  'bg-slate-500'

const parsePlanRoleModel = (model?: string) => {
  if (!model) return {}
  const trimmed = model.trim()
  if (!trimmed) return {}
  const separatorIndex = trimmed.indexOf('/')
  if (separatorIndex <= 0 || separatorIndex === trimmed.length - 1) {
    return { modelId: trimmed }
  }

  return {
    provider: trimmed.slice(0, separatorIndex),
    modelId: trimmed.slice(separatorIndex + 1),
  }
}

const planRoleChannelId = (assignment: MitaTeamsPlanRoleAssignment) => {
  if (assignment.roleId === MITA_TEAMS_ORCHESTRATOR_ROLE_ID) {
    return MITA_TEAMS_TASK_CHANNEL_ID
  }

  const text =
    `${assignment.roleId} ${assignment.name} ${assignment.assignment}`.toLowerCase()
  if (/\b(build|builder|code|coder|implement|generator|template)\b/.test(text)) {
    return 'build'
  }
  if (/\b(review|reviewer|qa|test|risk|critic|skeptic)\b/.test(text)) {
    return 'review'
  }
  if (/\b(research|researcher|inspect|evidence|source|analysis)\b/.test(text)) {
    return 'research'
  }
  if (/\b(architect|design|pm|product|debate|discuss)\b/.test(text)) {
    return 'discussion'
  }

  return 'discussion'
}

const channelTemplateForId = (id: MitaTeamsChannelId): MitaTeamsChannelConfig => {
  const template = MITA_TEAMS_CHANNELS.find((channel) => channel.id === id)
  return template
    ? { ...template, roleIds: [...template.roleIds] }
    : {
        id,
        label: titleFromId(id),
        description: `Shared work channel for ${titleFromId(id)}.`,
        roleIds: [],
      }
}

function materializeApprovedPlanRoles(
  config: MitaTeamsConfig,
  plan: MitaTeamsPlanDraft
) {
  const assignmentsByRoleId = new Map<MitaTeamsRoleId, MitaTeamsPlanRoleAssignment>()
  const existingRoleIds = new Set(config.roles.map((role) => role.id))
  const allowNewPlanRoles = config.workflowControl !== 'user_spec'

  for (const assignment of plan.roleAssignments) {
    const roleId = normalizeMitaTeamsId(assignment.roleId, '')
    if (!roleId || (!allowNewPlanRoles && !existingRoleIds.has(roleId))) {
      continue
    }
    assignmentsByRoleId.set(roleId, { ...assignment, roleId })
  }

  for (const task of plan.tasks) {
    const roleId = normalizeMitaTeamsId(task.roleId ?? '', '')
    if (!roleId || assignmentsByRoleId.has(roleId)) continue
    if (!allowNewPlanRoles && !existingRoleIds.has(roleId)) continue
    assignmentsByRoleId.set(roleId, {
      roleId,
      name: titleFromId(roleId),
      assignment: task.description || `Handle planned task: ${task.title}`,
    })
  }

  const nextRoles = config.roles.map((role) => ({ ...role }))
  const roleIndexById = new Map(nextRoles.map((role, index) => [role.id, index]))
  const fallbackModel = config.roles[0]

  for (const assignment of assignmentsByRoleId.values()) {
    const roleId = normalizeMitaTeamsId(assignment.roleId, '')
    if (!roleId) continue
    const existingIndex = roleIndexById.get(roleId)
    const existing =
      existingIndex !== undefined ? nextRoles[existingIndex] : undefined
    const editedFields = new Set(
      config.runtime.roleUserEdits?.[roleId]?.fields ?? []
    )
    const parsedModel = parsePlanRoleModel(assignment.model)
    const name = editedFields.has('name')
      ? (existing?.name ?? assignment.name)
      : assignment.name
    const description = editedFields.has('description')
      ? (existing?.description ?? assignment.assignment)
      : assignment.assignment
    const prompt = editedFields.has('prompt')
      ? (existing?.prompt ?? assignment.prompt ?? assignment.assignment)
      : (assignment.prompt ?? existing?.prompt ?? assignment.assignment)
    const provider = editedFields.has('provider')
      ? existing?.provider
      : (parsedModel.provider ?? existing?.provider ?? fallbackModel?.provider)
    const modelId = editedFields.has('modelId')
      ? existing?.modelId
      : (parsedModel.modelId ?? existing?.modelId ?? fallbackModel?.modelId)

    const materializedRole: MitaTeamsRoleConfig = {
      id: roleId,
      name,
      label: existing?.label || name.slice(0, 12) || titleFromId(roleId),
      description,
      prompt,
      color: existing?.color ?? roleColorForIndex(nextRoles.length),
      permission: editedFields.has('permission')
        ? (existing?.permission ?? 'tools')
        : (existing?.permission ?? 'tools'),
      provider,
      modelId,
      enabled: editedFields.has('enabled')
        ? (existing?.enabled ?? true)
        : (existing?.enabled ?? true),
    }

    if (existingIndex !== undefined) {
      nextRoles[existingIndex] = {
        ...nextRoles[existingIndex],
        ...materializedRole,
      }
    } else {
      roleIndexById.set(roleId, nextRoles.length)
      nextRoles.push(materializedRole)
    }
  }

  const nextRoleIds = new Set(nextRoles.map((role) => role.id))
  const nextChannels = config.channels.map((channel) => ({
    ...channel,
    roleIds: channel.roleIds.filter((roleId) => nextRoleIds.has(roleId)),
  }))
  const channelIndexById = new Map(
    nextChannels.map((channel, index) => [channel.id, index])
  )

  for (const assignment of assignmentsByRoleId.values()) {
    const roleId = normalizeMitaTeamsId(assignment.roleId, '')
    if (!roleId || !nextRoleIds.has(roleId)) continue
    const channelId = planRoleChannelId(assignment)
    let channelIndex = channelIndexById.get(channelId)
    if (channelIndex === undefined) {
      channelIndex = nextChannels.length
      channelIndexById.set(channelId, channelIndex)
      const channel = channelTemplateForId(channelId)
      nextChannels.push({
        ...channel,
        roleIds: channel.roleIds.filter((item) => nextRoleIds.has(item)),
      })
    }
    const channel = nextChannels[channelIndex]
    if (!channel.roleIds.includes(roleId)) {
      nextChannels[channelIndex] = {
        ...channel,
        roleIds: [...channel.roleIds, roleId],
      }
    }
  }

  return {
    roles: nextRoles,
    channels: nextChannels.map((channel) => {
      if (
        channel.id === MITA_TEAMS_TASK_CHANNEL_ID &&
        !channel.roleIds.includes(MITA_TEAMS_ORCHESTRATOR_ROLE_ID)
      ) {
        return {
          ...channel,
          roleIds: [MITA_TEAMS_ORCHESTRATOR_ROLE_ID, ...channel.roleIds],
        }
      }
      return channel
    }),
  }
}

export function approveMitaTeamsPlan(config: MitaTeamsConfig): MitaTeamsConfig {
  const plan = config.runtime.planDraft
  if (!plan) return config
  const now = nowIso()
  const approvedPlan: MitaTeamsPlanDraft = {
    ...plan,
    status: 'approved',
    updatedAt: now,
    approvedAt: now,
  }
  const materialized = materializeApprovedPlanRoles(config, approvedPlan)
  return patchMitaTeamsConfig(config, {
    roles: materialized.roles,
    channels: materialized.channels,
    activeRoleId: materialized.roles.some(
      (role) => role.id === config.activeRoleId
    )
      ? config.activeRoleId
      : MITA_TEAMS_ORCHESTRATOR_ROLE_ID,
    activeChannel: materialized.channels.some(
      (channel) => channel.id === config.activeChannel
    )
      ? config.activeChannel
      : MITA_TEAMS_TASK_CHANNEL_ID,
    runtime: {
      ...config.runtime,
      phase: 'running',
      approvedPlan,
      approvedRoleSnapshot: materialized.roles.map((role) => ({ ...role })),
      roleEditBaseline: Object.fromEntries(
        materialized.roles.map((role) => [
          role.id,
          roleEditBaselineFromRole(role),
        ])
      ),
      roleUserEdits: {},
      userChoiceRequest: undefined,
      teamEvents: [
        ...config.runtime.teamEvents,
        {
          id: `event-${Date.now()}`,
          type: 'plan_approved' as const,
          title: 'Plan approved',
          detail: approvedPlan.goal,
          roleId: MITA_TEAMS_ORCHESTRATOR_ROLE_ID,
          channelId: MITA_TEAMS_TASK_CHANNEL_ID,
          createdAt: now,
        },
      ].slice(-80),
    },
  })
}

export function requestMitaTeamsPlanRevision(
  config: MitaTeamsConfig,
  revision: string
): MitaTeamsConfig {
  const trimmed = revision.trim()
  if (!trimmed) return config
  const now = nowIso()
  const dirtyRoles = hasMitaTeamsRoleUserEdits(config.runtime)
  return patchMitaTeamsConfig(config, {
    runtime: {
      ...config.runtime,
      phase: dirtyRoles ? 'awaiting_role_edit_confirmation' : 'clarifying',
      pendingPlanRevision: trimmed,
      userChoiceRequest: dirtyRoles
        ? {
            id: `choice-${Date.now()}`,
            kind: 'keep_role_edits',
            question:
              'You changed role prompts or models. Keep those role changes while revising the plan?',
            options: [
              {
                id: 'keep',
                label: 'Keep role edits',
                description: 'Use your edited prompts and models in the revised plan.',
              },
              {
                id: 'discard',
                label: 'Discard role edits',
                description: 'Return roles to the plan baseline before revising.',
              },
            ],
            status: 'pending',
            createdAt: now,
          }
        : undefined,
      teamEvents: [
        ...config.runtime.teamEvents,
        {
          id: `event-${Date.now()}`,
          type: dirtyRoles
            ? ('role_edit_confirmation_requested' as const)
            : ('plan_revision_requested' as const),
          title: dirtyRoles
            ? 'Role edit confirmation requested'
            : 'Plan revision requested',
          detail: trimmed,
          roleId: MITA_TEAMS_ORCHESTRATOR_ROLE_ID,
          channelId: MITA_TEAMS_TASK_CHANNEL_ID,
          createdAt: now,
        },
      ].slice(-80),
    },
  })
}

export function resolveMitaTeamsRoleEditConfirmation(
  config: MitaTeamsConfig,
  keepRoleEdits: boolean
): MitaTeamsConfig {
  const baseline = config.runtime.roleEditBaseline ?? {}
  const editedRoleIds = new Set(Object.keys(config.runtime.roleUserEdits ?? {}))
  const roles = keepRoleEdits
    ? config.roles
    : config.roles.map((role) =>
        editedRoleIds.has(role.id) && baseline[role.id]
          ? { ...role, ...baseline[role.id], id: role.id }
          : role
      )
  return patchMitaTeamsConfig(config, {
    roles,
    runtime: {
      ...config.runtime,
      phase: 'clarifying',
      roleEditBaseline: Object.fromEntries(
        roles.map((role) => [role.id, roleEditBaselineFromRole(role)])
      ),
      roleUserEdits: {},
      userChoiceRequest: undefined,
    },
  })
}

export function renderMitaTeamsSystemInstructions(
  config: MitaTeamsConfig
): string {
  const mode = MITA_TEAMS_MODES.find((item) => item.id === config.mode)
  const taskTemplate = defaultTaskTemplate(config.taskTemplateId)
  const activeRole = config.roles.find(
    (role) => role.id === config.activeRoleId
  )
  const roles = config.roles
    .filter((role) => role.enabled)
    .map((role) => {
      const model = role.modelId
        ? `${role.provider ?? 'provider'}:${role.modelId}`
        : 'unassigned'
      return `- ${role.name} (${role.label}, ${model}, ${role.permission}): ${role.description}
  Prompt: ${role.prompt}`
    })
    .join('\n')
  const channels = config.channels
    .map((channel) => {
      const members = channel.roleIds.length
        ? channel.roleIds.join(', ')
        : 'none'
      return `- #${channel.label} (${channel.id}, roles: ${members}): ${channel.description}`
    })
    .join('\n')
  const directRoleInstruction =
    config.workspaceView === 'role-chat' && activeRole
      ? `\nDirect role chat:
- The owner is talking directly with ${activeRole.name}.
- Answer as ${activeRole.name}, using this role prompt: ${activeRole.prompt}
- This is a private role chat record, separate from channel-hosted team discussion.
- Do not simulate the full team; if team collaboration is needed, route it back through a channel.`
      : ''

  return `Biyan Teams mode is active.
Goal: solve the owner request through role-based collaboration.
Mode: ${mode?.label ?? config.mode} - ${mode?.description ?? ''}
Task template: ${taskTemplate.label} - ${taskTemplate.orchestratorHint}
Recommended roles for this template: ${taskTemplate.recommendedRoleIds.join(', ') || 'none'}.
Round limit: ${config.roundLimit}.
Roles:
${roles}

Channels:
${channels}

Operating rules:
- Act as the Coordinator for this MVP and coordinate the enabled roles.
- New teams start small. First understand the owner's goal, then suggest specific roles or channels only when they would materially improve the work.
- When specialist collaboration is needed, create only the minimum useful roles and put each role only in the relevant channel.
- The initial goal, task template, and mode are fixed after the first owner message; do not change them mid-thread.
- Hosted Biyan Teams discussion always happens in channels. Direct role chats are private role-specific records and are not team rooms.
- Keep the visible answer concise; do not make every role speak every turn.
- Use role-labeled sections only when they help the owner inspect the work.
- Convert disagreement into explicit decisions, risks, and next actions.
- Treat tool outputs as raw records; summarize tool results in assistant prose.
- Do not claim that separate LLMs privately ran unless the Teams runtime scheduled role calls and recorded them in the workspace.${directRoleInstruction}`
}
