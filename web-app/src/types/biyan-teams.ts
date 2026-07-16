import {
  legacyBiyanTeamsCleanupPatch,
  readLegacyBiyanTeamsMetadata,
} from '@/legacy_migrations/biyan-teams-metadata'

export type BiyanTeamsMode =
  | 'relay'
  | 'roundtable'
  | 'debate'
  | 'red-team'
  | 'silent'

export type BiyanTeamsChannelId = string

export type BiyanTeamsRoleId = string

export type BiyanTeamsPermission = 'read' | 'tools' | 'write'

export type BiyanTeamsWorkspaceView = 'team-chat' | 'role-chat' | 'role-config'

export type BiyanTeamsTaskTemplateId =
  | 'code'
  | 'research'
  | 'product'
  | 'writing'
  | 'debugging'

export type BiyanTeamsScenarioId = 'market_research'

export type BiyanTeamsTaskStatus =
  | 'todo'
  | 'researching'
  | 'implementing'
  | 'reviewing'
  | 'done'

export type BiyanTeamsArtifactType =
  | 'decision'
  | 'risk'
  | 'artifact'
  | 'test_result'
  | 'final_draft'

export type BiyanTeamsRunStatus =
  | 'idle'
  | 'running'
  | 'waiting-for-user'
  | 'completed'
  | 'stopped'
  | 'failed'

export type BiyanTeamsRoleStatus =
  | 'idle'
  | 'running'
  | 'done'
  | 'blocked'
  | 'failed'

export type BiyanTeamsExecutionMode = 'parallel' | 'serial' | 'hybrid'

export type BiyanTeamsRoleStreamMessage = {
  id: string
  turnId: string
  roleId: BiyanTeamsRoleId
  channelId?: BiyanTeamsChannelId
  role: 'system' | 'user' | 'assistant'
  content: string
  createdAt: string
  model?: ThreadModel
  sourceRoleIds?: BiyanTeamsRoleId[]
}

export type BiyanTeamsRoleMemory = {
  roleId: BiyanTeamsRoleId
  version: number
  summary: string
  facts: string[]
  decisions: string[]
  openQuestions: string[]
  workingNotes: string[]
  updatedAt: string
}

export type BiyanTeamsRoleState = {
  roleId: BiyanTeamsRoleId
  status: BiyanTeamsRoleStatus
  stream: BiyanTeamsRoleStreamMessage[]
  memory: BiyanTeamsRoleMemory
  lastTurnId?: string
  lastError?: string
}

export type BiyanTeamsProjectMemory = {
  version: number
  summary: string
  facts: string[]
  decisions: string[]
  openQuestions: string[]
  milestones: string[]
  sourceRoleMemoryVersions: Partial<Record<BiyanTeamsRoleId, number>>
  updatedAt: string
}

export type BiyanTeamsMilestone = {
  id: string
  title: string
  createdAt: string
  sourceRoleId?: BiyanTeamsRoleId
}

export type BiyanTeamsTokenUsage = {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  estimatedCostUsd?: number
}

export type BiyanTeamsChoiceOption = {
  id: string
  label: string
  description?: string
}

export type BiyanTeamsUserInputKind =
  | 'single_choice'
  | 'free_text'
  | 'plan_approval'
  | 'keep_role_edits'
  | 'scenario_offer'

export type BiyanTeamsChoiceRequest = {
  id: string
  kind?: BiyanTeamsUserInputKind
  question: string
  options: BiyanTeamsChoiceOption[]
  status: 'pending' | 'answered'
  selectedOptionId?: string
  responseText?: string
  createdAt: string
  answeredAt?: string
}

export type BiyanTeamsRoleCallPlan = {
  roleId: BiyanTeamsRoleId
  channelId?: BiyanTeamsChannelId
  instruction: string
  mode?: BiyanTeamsExecutionMode
  dependsOn?: BiyanTeamsRoleId[]
  group?: number
  requiredPermission?: BiyanTeamsPermission
}

export type BiyanTeamsTask = {
  id: string
  title: string
  status: BiyanTeamsTaskStatus
  roleId?: BiyanTeamsRoleId
  channelId?: BiyanTeamsChannelId
  createdAt: string
  updatedAt: string
}

export type BiyanTeamsTaskUpdate = {
  id?: string
  title: string
  status: BiyanTeamsTaskStatus
  roleId?: BiyanTeamsRoleId
  channelId?: BiyanTeamsChannelId
}

export type BiyanTeamsArtifact = {
  id: string
  type: BiyanTeamsArtifactType
  title: string
  summary: string
  content?: string
  roleId?: BiyanTeamsRoleId
  channelId?: BiyanTeamsChannelId
  createdAt: string
  updatedAt: string
}

export type BiyanTeamsArtifactUpdate = {
  id?: string
  type: BiyanTeamsArtifactType
  title: string
  summary: string
  content?: string
  roleId?: BiyanTeamsRoleId
  channelId?: BiyanTeamsChannelId
}

export type BiyanTeamsStructuredUpdates = {
  tasks?: BiyanTeamsTaskUpdate[]
  artifacts?: BiyanTeamsArtifactUpdate[]
}

type BiyanTeamsDecisionUpdates = {
  updates?: BiyanTeamsStructuredUpdates
}

export type BiyanTeamsPlanTask = {
  id: string
  title: string
  description?: string
  roleId?: BiyanTeamsRoleId
}

export type BiyanTeamsPlanRoleAssignment = {
  roleId: BiyanTeamsRoleId
  name: string
  assignment: string
  model?: string
  prompt?: string
}

export type BiyanTeamsPlanDraft = {
  id: string
  version: number
  status: 'draft' | 'approved' | 'superseded'
  goal: string
  summary: string
  scope: string[]
  acceptanceCriteria: string[]
  tasks: BiyanTeamsPlanTask[]
  roleAssignments: BiyanTeamsPlanRoleAssignment[]
  executionOrder: string[]
  revisionPrompt?: string
  createdAt: string
  updatedAt: string
  approvedAt?: string
}

export type BiyanTeamsRuntimePhase =
  | 'idle'
  | 'clarifying'
  | 'awaiting_plan_approval'
  | 'awaiting_role_edit_confirmation'
  | 'running'
  | 'completed'

export type BiyanTeamsRoleEditableField =
  | 'prompt'
  | 'provider'
  | 'modelId'
  | 'name'
  | 'description'
  | 'permission'
  | 'enabled'

export type BiyanTeamsRoleUserEdit = {
  fields: BiyanTeamsRoleEditableField[]
  updatedAt: string
}

export type BiyanTeamsRoleEditBaseline = Pick<
  BiyanTeamsRoleConfig,
  | 'id'
  | 'name'
  | 'description'
  | 'prompt'
  | 'permission'
  | 'provider'
  | 'modelId'
  | 'enabled'
>

export type BiyanTeamsOrchestratorDecision =
  | ({
      action: 'configure_team'
      reason: string
      roles: BiyanTeamsRoleConfig[]
      channels: BiyanTeamsChannelConfig[]
      mode?: BiyanTeamsExecutionMode
      calls?: BiyanTeamsRoleCallPlan[]
    } & BiyanTeamsDecisionUpdates)
  | ({
      action: 'call_roles'
      mode: BiyanTeamsExecutionMode
      reason: string
      calls: BiyanTeamsRoleCallPlan[]
    } & BiyanTeamsDecisionUpdates)
  | ({
      action: 'ask_user'
      reason: string
      question: string
      options: BiyanTeamsChoiceOption[]
      // Set only by the JSON-parse fallback (jsonFailureDecision). Marks this
      // ask_user as a mechanical parse failure rather than a genuine
      // owner-facing question, so post-approval handling can recover instead of
      // treating it as a protocol violation.
      parseFallback?: boolean
    } & BiyanTeamsDecisionUpdates)
  | ({
      action: 'clarify_user'
      reason: string
      question: string
      inputKind?: 'single_choice' | 'free_text'
      options?: BiyanTeamsChoiceOption[]
    } & BiyanTeamsDecisionUpdates)
  | ({
      action: 'propose_plan'
      reason: string
      plan: Partial<BiyanTeamsPlanDraft>
    } & BiyanTeamsDecisionUpdates)
  | ({
      action: 'revise_plan'
      reason: string
      plan: Partial<BiyanTeamsPlanDraft>
    } & BiyanTeamsDecisionUpdates)
  | ({
      action: 'milestone'
      reason: string
      milestone: string
      next?: BiyanTeamsOrchestratorDecision
    } & BiyanTeamsDecisionUpdates)
  | ({
      action: 'stop'
      reason: string
      finalResponse: string
    } & BiyanTeamsDecisionUpdates)

export type BiyanTeamsTeamEvent = {
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
  roleId?: BiyanTeamsRoleId
  channelId?: BiyanTeamsChannelId
  createdAt: string
}

export type BiyanTeamsRun = {
  id: string
  status: BiyanTeamsRunStatus
  currentRound: number
  maxRounds: number
  callCount: number
  executionMode?: BiyanTeamsExecutionMode
  activeRoleIds: BiyanTeamsRoleId[]
  lastDecision?: BiyanTeamsOrchestratorDecision
  startedAt: string
  updatedAt: string
  completedAt?: string
  durationMs?: number
  usage?: BiyanTeamsTokenUsage
  error?: string
}

export type BiyanTeamsRuntime = {
  version: 1
  phase: BiyanTeamsRuntimePhase
  run?: BiyanTeamsRun
  projectMemory: BiyanTeamsProjectMemory
  roleStates: Partial<Record<BiyanTeamsRoleId, BiyanTeamsRoleState>>
  tasks: BiyanTeamsTask[]
  artifacts: BiyanTeamsArtifact[]
  milestones: BiyanTeamsMilestone[]
  teamEvents: BiyanTeamsTeamEvent[]
  clarificationCount: number
  planDraft?: BiyanTeamsPlanDraft
  approvedPlan?: BiyanTeamsPlanDraft
  approvedRoleSnapshot?: BiyanTeamsRoleConfig[]
  roleEditBaseline?: Partial<Record<BiyanTeamsRoleId, BiyanTeamsRoleEditBaseline>>
  roleUserEdits?: Partial<Record<BiyanTeamsRoleId, BiyanTeamsRoleUserEdit>>
  pendingPlanRevision?: string
  userChoiceRequest?: BiyanTeamsChoiceRequest
  // Role ids the owner explicitly archived. Auto-injection paths (scenario
  // playbooks, coordinator configure_team) must not re-add or re-enable these.
  archivedRoleIds?: BiyanTeamsRoleId[]
  // Set once the owner has declined the auto-suggested scenario team, so the
  // offer is never re-shown for this thread (consent is asked once, not nagged).
  scenarioOfferDismissed?: boolean
}

export type BiyanTeamsChannelConfig = {
  id: BiyanTeamsChannelId
  label: string
  description: string
  roleIds: BiyanTeamsRoleId[]
}

export type BiyanTeamsRoleConfig = {
  id: BiyanTeamsRoleId
  name: string
  label: string
  description: string
  prompt: string
  color: string
  permission: BiyanTeamsPermission
  provider?: string
  modelId?: string
  enabled: boolean
}

// 'user_spec' = owner explicitly locked the roster; 'open' = owner explicitly
// let the Host add/change roles; undefined = auto (locked iff the owner has
// configured a specialist roster — a bare orchestrator-only group stays open so
// the Host can still build a team).
export type BiyanTeamsWorkflowControl = 'user_spec' | 'open'

export type BiyanTeamsConfig = {
  enabled: boolean
  scenarioId?: BiyanTeamsScenarioId
  workflowControl?: BiyanTeamsWorkflowControl
  mode: BiyanTeamsMode
  taskTemplateId: BiyanTeamsTaskTemplateId
  activeChannel: BiyanTeamsChannelId
  activeRoleId: BiyanTeamsRoleId
  workspaceView: BiyanTeamsWorkspaceView
  channels: BiyanTeamsChannelConfig[]
  roundLimit: number
  roles: BiyanTeamsRoleConfig[]
  runtime: BiyanTeamsRuntime
  createdAt: string
  updatedAt: string
}

export const BIYAN_TEAMS_METADATA_KEY = 'biyanTeams'
export const BIYAN_TEAMS_ORCHESTRATOR_ROLE_ID = 'orchestrator'
export const BIYAN_TEAMS_TASK_CHANNEL_ID = 'task'

/**
 * Read-only bridge for threads created before the Biyan Teams namespace.
 * Canonical metadata always wins when both keys exist. New writes must only use
 * BIYAN_TEAMS_METADATA_KEY.
 */
export function readBiyanTeamsMetadata(
  metadata?: Record<string, unknown>
): unknown {
  return (
    metadata?.[BIYAN_TEAMS_METADATA_KEY] ??
    readLegacyBiyanTeamsMetadata(metadata)
  )
}

export function createBiyanTeamsMetadataPatch(
  config: BiyanTeamsConfig
): Record<string, unknown> {
  return {
    [BIYAN_TEAMS_METADATA_KEY]: config,
    // updateThread merges metadata. Explicit undefined clears the legacy value
    // in memory and is omitted by the persistence serializer.
    ...legacyBiyanTeamsCleanupPatch(),
  }
}

export const normalizeBiyanTeamsId = (
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

export const isBiyanTeamsId = (value: unknown): value is string =>
  typeof value === 'string' && normalizeBiyanTeamsId(value, '') === value

export const BIYAN_TEAMS_CHANNELS: Array<{
  id: BiyanTeamsChannelId
  label: string
  description: string
  roleIds: BiyanTeamsRoleId[]
}> = [
  {
    id: BIYAN_TEAMS_TASK_CHANNEL_ID,
    label: 'Current task',
    description:
      'The shared working room for the owner goal and current context.',
    roleIds: [BIYAN_TEAMS_ORCHESTRATOR_ROLE_ID],
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

export const BIYAN_TEAMS_MODES: Array<{
  id: BiyanTeamsMode
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

export const BIYAN_TEAMS_TASK_TEMPLATES: Array<{
  id: BiyanTeamsTaskTemplateId
  label: string
  description: string
  defaultMode: BiyanTeamsMode
  recommendedRoleIds: BiyanTeamsRoleId[]
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

export const BIYAN_TEAMS_ROLE_COLORS: Array<{
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

export const DEFAULT_BIYAN_TEAMS_ROLES: BiyanTeamsRoleConfig[] = [
  {
    id: BIYAN_TEAMS_ORCHESTRATOR_ROLE_ID,
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

const isBiyanTeamsMode = (value: unknown): value is BiyanTeamsMode =>
  BIYAN_TEAMS_MODES.some((mode) => mode.id === value)

const isBiyanTeamsChannelId = (value: unknown): value is BiyanTeamsChannelId =>
  isBiyanTeamsId(value)

const isBiyanTeamsRoleId = (value: unknown): value is BiyanTeamsRoleId =>
  isBiyanTeamsId(value)

const isBiyanTeamsWorkspaceView = (
  value: unknown
): value is BiyanTeamsWorkspaceView =>
  value === 'team-chat' || value === 'role-chat' || value === 'role-config'

const isBiyanTeamsPermission = (value: unknown): value is BiyanTeamsPermission =>
  value === 'read' || value === 'tools' || value === 'write'

const titleFromId = (id: string) =>
  id
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ') || 'Role'

const defaultCoordinatorRole = (model?: ThreadModel): BiyanTeamsRoleConfig => ({
  ...DEFAULT_BIYAN_TEAMS_ROLES[0],
  provider: model?.provider,
  modelId: model?.id,
})

const defaultRoles = (model?: ThreadModel): BiyanTeamsRoleConfig[] => [
  defaultCoordinatorRole(model),
]

const defaultTaskChannel = (): BiyanTeamsChannelConfig => ({
  ...BIYAN_TEAMS_CHANNELS[0],
  roleIds: [BIYAN_TEAMS_ORCHESTRATOR_ROLE_ID],
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
    const id = normalizeBiyanTeamsId(value, '')
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
    normalizeBiyanTeamsId(rawId, '') ||
    normalizeBiyanTeamsId(label, '') ||
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
  roleId: BiyanTeamsRoleId,
  timestamp = nowIso()
): BiyanTeamsRoleMemory => ({
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
  role: BiyanTeamsRoleConfig,
  timestamp = nowIso()
): BiyanTeamsRoleState => ({
  roleId: role.id,
  status: 'idle',
  stream: [],
  memory: createRoleMemory(role.id, timestamp),
})

const createProjectMemory = (timestamp = nowIso()): BiyanTeamsProjectMemory => ({
  version: 0,
  summary: '',
  facts: [],
  decisions: [],
  openQuestions: [],
  milestones: [],
  sourceRoleMemoryVersions: {},
  updatedAt: timestamp,
})

const isRunStatus = (value: unknown): value is BiyanTeamsRunStatus =>
  value === 'idle' ||
  value === 'running' ||
  value === 'waiting-for-user' ||
  value === 'completed' ||
  value === 'stopped' ||
  value === 'failed'

const isRoleStatus = (value: unknown): value is BiyanTeamsRoleStatus =>
  value === 'idle' ||
  value === 'running' ||
  value === 'done' ||
  value === 'blocked' ||
  value === 'failed'

const isExecutionMode = (value: unknown): value is BiyanTeamsExecutionMode =>
  value === 'parallel' || value === 'serial' || value === 'hybrid'

const isRuntimePhase = (value: unknown): value is BiyanTeamsRuntimePhase =>
  value === 'idle' ||
  value === 'clarifying' ||
  value === 'awaiting_plan_approval' ||
  value === 'awaiting_role_edit_confirmation' ||
  value === 'running' ||
  value === 'completed'

const isUserInputKind = (value: unknown): value is BiyanTeamsUserInputKind =>
  value === 'single_choice' ||
  value === 'free_text' ||
  value === 'plan_approval' ||
  value === 'keep_role_edits' ||
  value === 'scenario_offer'

const isTaskTemplateId = (value: unknown): value is BiyanTeamsTaskTemplateId =>
  BIYAN_TEAMS_TASK_TEMPLATES.some((template) => template.id === value)

const isTaskStatus = (value: unknown): value is BiyanTeamsTaskStatus =>
  value === 'todo' ||
  value === 'researching' ||
  value === 'implementing' ||
  value === 'reviewing' ||
  value === 'done'

const isArtifactType = (value: unknown): value is BiyanTeamsArtifactType =>
  value === 'decision' ||
  value === 'risk' ||
  value === 'artifact' ||
  value === 'test_result' ||
  value === 'final_draft'

const ROLE_EDITABLE_FIELDS: BiyanTeamsRoleEditableField[] = [
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
): value is BiyanTeamsRoleEditableField =>
  typeof value === 'string' &&
  ROLE_EDITABLE_FIELDS.includes(value as BiyanTeamsRoleEditableField)

const defaultTaskTemplate = (value?: unknown) =>
  BIYAN_TEAMS_TASK_TEMPLATES.find((template) => template.id === value) ??
  BIYAN_TEAMS_TASK_TEMPLATES[0]

const safeOptionalRoleId = (value: unknown) =>
  isBiyanTeamsRoleId(value) ? value : undefined

const safeOptionalChannelId = (value: unknown) =>
  isBiyanTeamsChannelId(value) ? value : undefined

const normalizeStream = (
  value: unknown,
  roleId: BiyanTeamsRoleId
): BiyanTeamsRoleStreamMessage[] =>
  Array.isArray(value)
    ? value
        .map((item): BiyanTeamsRoleStreamMessage | undefined => {
          if (!item || typeof item !== 'object') return undefined
          const raw = item as Partial<BiyanTeamsRoleStreamMessage>
          if (typeof raw.content !== 'string') return undefined
          const streamRole: BiyanTeamsRoleStreamMessage['role'] =
            raw.role === 'system' || raw.role === 'user'
              ? raw.role
              : 'assistant'
          const message: BiyanTeamsRoleStreamMessage = {
            id: raw.id || `${roleId}-${Date.now()}`,
            turnId: raw.turnId || raw.id || `${roleId}-${Date.now()}`,
            roleId,
            channelId: isBiyanTeamsChannelId(raw.channelId)
              ? raw.channelId
              : undefined,
            role: streamRole,
            content: raw.content,
            createdAt: raw.createdAt || nowIso(),
          }
          if (raw.model) message.model = raw.model
          if (Array.isArray(raw.sourceRoleIds)) {
            const sourceRoleIds = raw.sourceRoleIds.filter(isBiyanTeamsRoleId)
            if (sourceRoleIds.length > 0) message.sourceRoleIds = sourceRoleIds
          }
          return message
        })
        .filter(
          (item): item is BiyanTeamsRoleStreamMessage => item !== undefined
        )
        .slice(-40)
    : []

const normalizeRoleMemory = (
  value: unknown,
  roleId: BiyanTeamsRoleId
): BiyanTeamsRoleMemory => {
  const fallback = createRoleMemory(roleId)
  if (!value || typeof value !== 'object') return fallback
  const raw = value as Partial<BiyanTeamsRoleMemory>
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

const normalizeProjectMemory = (value: unknown): BiyanTeamsProjectMemory => {
  const fallback = createProjectMemory()
  if (!value || typeof value !== 'object') return fallback
  const raw = value as Partial<BiyanTeamsProjectMemory>
  const sourceVersions =
    raw.sourceRoleMemoryVersions &&
    typeof raw.sourceRoleMemoryVersions === 'object'
      ? Object.fromEntries(
          Object.entries(raw.sourceRoleMemoryVersions).filter(
            ([roleId, version]) =>
              isBiyanTeamsRoleId(roleId) && typeof version === 'number'
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
): BiyanTeamsChoiceRequest | undefined => {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Partial<BiyanTeamsChoiceRequest>
  if (typeof raw.question !== 'string') {
    return undefined
  }
  const kind = isUserInputKind(raw.kind) ? raw.kind : 'single_choice'
  const seenOptionIds = new Set<string>()
  const options = (Array.isArray(raw.options) ? raw.options : [])
    .map((option, index): BiyanTeamsChoiceOption | undefined => {
      if (!option || typeof option !== 'object') return undefined
      const item = option as Partial<BiyanTeamsChoiceOption>
      if (typeof item.label !== 'string') return undefined
      const normalized: BiyanTeamsChoiceOption = {
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
    .filter((option): option is BiyanTeamsChoiceOption => option !== undefined)
    .slice(0, 4)

  if (kind !== 'free_text' && options.length === 0) return undefined
  const selectedOptionId = normalizeBiyanTeamsId(raw.selectedOptionId, '')
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

const normalizeTaskList = (value: unknown): BiyanTeamsTask[] =>
  Array.isArray(value)
    ? value
        .map((task): BiyanTeamsTask | undefined => {
          if (!task || typeof task !== 'object') return undefined
          const raw = task as Partial<BiyanTeamsTask>
          if (typeof raw.title !== 'string' || !raw.title.trim()) {
            return undefined
          }
          const id =
            normalizeBiyanTeamsId(raw.id, '') ||
            normalizeBiyanTeamsId(raw.title, `task-${Date.now()}`)
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
        .filter((task): task is BiyanTeamsTask => task !== undefined)
        .slice(-40)
    : []

const normalizeArtifactList = (value: unknown): BiyanTeamsArtifact[] =>
  Array.isArray(value)
    ? value
        .map((artifact): BiyanTeamsArtifact | undefined => {
          if (!artifact || typeof artifact !== 'object') return undefined
          const raw = artifact as Partial<BiyanTeamsArtifact>
          if (
            typeof raw.title !== 'string' ||
            !raw.title.trim() ||
            typeof raw.summary !== 'string' ||
            !raw.summary.trim()
          ) {
            return undefined
          }
          const id =
            normalizeBiyanTeamsId(raw.id, '') ||
            normalizeBiyanTeamsId(raw.title, `artifact-${Date.now()}`)
          const now = nowIso()
          const normalized: BiyanTeamsArtifact = {
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
          (artifact): artifact is BiyanTeamsArtifact => artifact !== undefined
        )
        .slice(-60)
    : []

const normalizePlanTaskList = (value: unknown): BiyanTeamsPlanTask[] =>
  Array.isArray(value)
    ? value
        .map((task, index): BiyanTeamsPlanTask | undefined => {
          if (!task || typeof task !== 'object') return undefined
          const raw = task as Partial<BiyanTeamsPlanTask>
          if (typeof raw.title !== 'string' || !raw.title.trim()) {
            return undefined
          }
          const id =
            normalizeBiyanTeamsId(raw.id, '') ||
            normalizeBiyanTeamsId(raw.title, `plan-task-${index + 1}`)
          const normalized: BiyanTeamsPlanTask = {
            id,
            title: raw.title.trim(),
            roleId: safeOptionalRoleId(raw.roleId),
          }
          if (typeof raw.description === 'string' && raw.description.trim()) {
            normalized.description = raw.description.trim()
          }
          return normalized
        })
        .filter((task): task is BiyanTeamsPlanTask => task !== undefined)
        .slice(0, 20)
    : []

const normalizePlanRoleAssignments = (
  value: unknown
): BiyanTeamsPlanRoleAssignment[] =>
  Array.isArray(value)
    ? value
        .map((assignment): BiyanTeamsPlanRoleAssignment | undefined => {
          if (!assignment || typeof assignment !== 'object') return undefined
          const raw = assignment as Partial<BiyanTeamsPlanRoleAssignment>
          const roleId = normalizeBiyanTeamsId(raw.roleId, '')
          if (!roleId || typeof raw.name !== 'string') return undefined
          const normalized: BiyanTeamsPlanRoleAssignment = {
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
          (assignment): assignment is BiyanTeamsPlanRoleAssignment =>
            assignment !== undefined
        )
        .slice(0, 20)
    : []

const normalizePlanDraft = (value: unknown): BiyanTeamsPlanDraft | undefined => {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Partial<BiyanTeamsPlanDraft>
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
  role: BiyanTeamsRoleConfig
): BiyanTeamsRoleEditBaseline => ({
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
  roles: BiyanTeamsRoleConfig[]
): Partial<Record<BiyanTeamsRoleId, BiyanTeamsRoleEditBaseline>> => {
  const raw = value && typeof value === 'object' ? value : {}
  const byId = raw as Partial<Record<BiyanTeamsRoleId, Partial<BiyanTeamsRoleEditBaseline>>>
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
): Partial<Record<BiyanTeamsRoleId, BiyanTeamsRoleUserEdit>> => {
  if (!value || typeof value !== 'object') return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([roleId, rawEdit]) => {
        const id = normalizeBiyanTeamsId(roleId, '')
        if (!id || !rawEdit || typeof rawEdit !== 'object') return undefined
        const edit = rawEdit as Partial<BiyanTeamsRoleUserEdit>
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
        ): item is readonly [BiyanTeamsRoleId, BiyanTeamsRoleUserEdit] =>
          item !== undefined
      )
  )
}

const normalizeTokenUsage = (
  value: unknown
): BiyanTeamsTokenUsage | undefined => {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as BiyanTeamsTokenUsage
  const usage: BiyanTeamsTokenUsage = {}
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

export function createDefaultBiyanTeamsRuntime(
  roles: BiyanTeamsRoleConfig[] = defaultRoles(),
  timestamp = nowIso()
): BiyanTeamsRuntime {
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

export function normalizeBiyanTeamsRuntime(
  value: unknown,
  roles: BiyanTeamsRoleConfig[]
): BiyanTeamsRuntime {
  const fallback = createDefaultBiyanTeamsRuntime(roles)
  if (!value || typeof value !== 'object') return fallback
  const raw = value as Partial<BiyanTeamsRuntime>
  const rawRoleStates =
    raw.roleStates && typeof raw.roleStates === 'object' ? raw.roleStates : {}

  const roleStates = Object.fromEntries(
    roles.map((role) => {
      const saved = rawRoleStates[role.id]
      const savedState =
        saved && typeof saved === 'object'
          ? (saved as Partial<BiyanTeamsRoleState>)
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
        } satisfies BiyanTeamsRoleState,
      ]
    })
  )

  const run =
    raw.run && typeof raw.run === 'object'
      ? (() => {
          const saved = raw.run as Partial<BiyanTeamsRun>
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
              ? saved.activeRoleIds.filter(isBiyanTeamsRoleId)
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
          } satisfies BiyanTeamsRun
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
          .filter((milestone): milestone is BiyanTeamsMilestone =>
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
          .filter((event): event is BiyanTeamsTeamEvent =>
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
            const saved = role as Partial<BiyanTeamsRoleConfig>
            const id = normalizeBiyanTeamsId(saved.id, '')
            if (!id) return undefined
            const current = roles.find((item) => item.id === id)
            return current ? { ...current, ...saved, id } : undefined
          })
          .filter((role): role is BiyanTeamsRoleConfig => role !== undefined)
      : undefined,
    roleEditBaseline: normalizeRoleEditBaseline(raw.roleEditBaseline, roles),
    roleUserEdits: normalizeRoleUserEdits(raw.roleUserEdits),
    pendingPlanRevision:
      typeof raw.pendingPlanRevision === 'string' &&
      raw.pendingPlanRevision.trim()
        ? raw.pendingPlanRevision.trim()
        : undefined,
    userChoiceRequest: normalizeChoiceRequest(raw.userChoiceRequest),
    archivedRoleIds: Array.isArray(raw.archivedRoleIds)
      ? Array.from(
          new Set(
            raw.archivedRoleIds.filter(
              (id): id is BiyanTeamsRoleId =>
                typeof id === 'string' && id.length > 0
            )
          )
        )
      : undefined,
    scenarioOfferDismissed: raw.scenarioOfferDismissed === true ? true : undefined,
  }
}

export function createDefaultBiyanTeamsConfig(
  model?: ThreadModel,
  taskTemplateId: BiyanTeamsTaskTemplateId = 'code'
): BiyanTeamsConfig {
  const now = nowIso()
  const roles = defaultRoles(model)
  const channels = [defaultTaskChannel()]
  const taskTemplate = defaultTaskTemplate(taskTemplateId)
  return {
    enabled: true,
    mode: taskTemplate.defaultMode,
    taskTemplateId: taskTemplate.id,
    activeChannel: BIYAN_TEAMS_TASK_CHANNEL_ID,
    activeRoleId: BIYAN_TEAMS_ORCHESTRATOR_ROLE_ID,
    workspaceView: 'team-chat',
    channels,
    roundLimit: 5,
    roles,
    runtime: createDefaultBiyanTeamsRuntime(roles, now),
    createdAt: now,
    updatedAt: now,
  }
}

// The owner has configured a real roster once any non-orchestrator role is
// enabled (a fresh group is orchestrator-only).
export function biyanTeamsHasSpecialistRoster(config: BiyanTeamsConfig): boolean {
  return config.roles.some(
    (role) => role.enabled && role.id !== BIYAN_TEAMS_ORCHESTRATOR_ROLE_ID
  )
}

// Whether the Host is bound to the current roster (cannot add/swap roles).
// Explicit owner choices win; otherwise a configured roster auto-locks while a
// bare orchestrator-only group stays open so the Host can still build a team.
export function isBiyanTeamsTeamLocked(config: BiyanTeamsConfig): boolean {
  if (config.workflowControl === 'user_spec') return true
  if (config.workflowControl === 'open') return false
  return biyanTeamsHasSpecialistRoster(config)
}

export function normalizeBiyanTeamsConfig(
  value: unknown,
  model?: ThreadModel
): BiyanTeamsConfig | undefined {
  if (!value || typeof value !== 'object') return undefined

  const raw = value as Partial<BiyanTeamsConfig>
  if (raw.enabled !== true) return undefined

  const taskTemplateId = isTaskTemplateId(raw.taskTemplateId)
    ? raw.taskTemplateId
    : 'code'
  const fallback = createDefaultBiyanTeamsConfig(model, taskTemplateId)
  const rawRoles = Array.isArray(raw.roles) ? raw.roles : []
  const rawChannels = Array.isArray(raw.channels) ? raw.channels : []
  const roleTemplates = DEFAULT_BIYAN_TEAMS_ROLES.map((role) => ({
    ...role,
    provider: model?.provider,
    modelId: model?.id,
  }))

  const roles = rawRoles.length
    ? rawRoles
        .map((role): BiyanTeamsRoleConfig | undefined => {
          if (!role || typeof role !== 'object') return undefined
          const saved = role as Partial<BiyanTeamsRoleConfig>
          const id = normalizeBiyanTeamsId(saved.id, '')
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
            permission: isBiyanTeamsPermission(saved.permission)
              ? saved.permission
              : template.permission,
            enabled: saved.enabled !== false,
          }
        })
        .filter((role): role is BiyanTeamsRoleConfig => Boolean(role))
    : fallback.roles

  const candidateRoles = roles.length ? roles : fallback.roles
  const safeRoles = candidateRoles.some(
    (role) => role.id === BIYAN_TEAMS_ORCHESTRATOR_ROLE_ID
  )
    ? candidateRoles
    : [defaultCoordinatorRole(model), ...candidateRoles]
  const safeRoleIds = new Set(safeRoles.map((role) => role.id))

  const channels = rawChannels.length
    ? rawChannels
        .map((channel): BiyanTeamsChannelConfig | undefined => {
          if (!channel || typeof channel !== 'object') return undefined
          const saved = channel as Partial<BiyanTeamsChannelConfig>
          const id = normalizeBiyanTeamsId(saved.id, '')
          if (!id) return undefined

          const template = BIYAN_TEAMS_CHANNELS.find(
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
            id === BIYAN_TEAMS_TASK_CHANNEL_ID &&
            safeRoleIds.has(BIYAN_TEAMS_ORCHESTRATOR_ROLE_ID)
              ? [BIYAN_TEAMS_ORCHESTRATOR_ROLE_ID]
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
        .filter((channel): channel is BiyanTeamsChannelConfig =>
          Boolean(channel)
        )
    : fallback.channels

  const candidateChannels = channels.length ? channels : fallback.channels
  const channelsWithTask = candidateChannels.some(
    (channel) => channel.id === BIYAN_TEAMS_TASK_CHANNEL_ID
  )
    ? candidateChannels
    : [defaultTaskChannel(), ...candidateChannels]

  const safeChannels = channelsWithTask.map((channel) => {
    const roleIds = channel.roleIds.filter((roleId) => safeRoleIds.has(roleId))
    const taskRoleIds =
      channel.id === BIYAN_TEAMS_TASK_CHANNEL_ID &&
      safeRoleIds.has(BIYAN_TEAMS_ORCHESTRATOR_ROLE_ID) &&
      !roleIds.includes(BIYAN_TEAMS_ORCHESTRATOR_ROLE_ID)
        ? [BIYAN_TEAMS_ORCHESTRATOR_ROLE_ID, ...roleIds]
        : roleIds
    const fallbackRoleId =
      channel.id === BIYAN_TEAMS_TASK_CHANNEL_ID &&
      safeRoleIds.has(BIYAN_TEAMS_ORCHESTRATOR_ROLE_ID)
        ? BIYAN_TEAMS_ORCHESTRATOR_ROLE_ID
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
  const normalizedActiveRoleId = normalizeBiyanTeamsId(raw.activeRoleId, '')
  const normalizedActiveChannel = normalizeBiyanTeamsId(raw.activeChannel, '')
  const activeRoleId =
    normalizedActiveRoleId && safeRoleIds.has(normalizedActiveRoleId)
      ? normalizedActiveRoleId
      : (safeRoles[0]?.id ?? BIYAN_TEAMS_ORCHESTRATOR_ROLE_ID)
  const activeChannel =
    normalizedActiveChannel && safeChannelIds.has(normalizedActiveChannel)
      ? normalizedActiveChannel
      : (safeChannels[0]?.id ?? BIYAN_TEAMS_TASK_CHANNEL_ID)

  return {
    ...fallback,
    ...raw,
    enabled: true,
    scenarioId: raw.scenarioId === 'market_research' ? raw.scenarioId : undefined,
    workflowControl:
      raw.workflowControl === 'user_spec'
        ? 'user_spec'
        : raw.workflowControl === 'open'
          ? 'open'
          : undefined,
    mode: isBiyanTeamsMode(raw.mode) ? raw.mode : fallback.mode,
    taskTemplateId,
    activeChannel,
    activeRoleId,
    workspaceView: isBiyanTeamsWorkspaceView(raw.workspaceView)
      ? raw.workspaceView
      : fallback.workspaceView,
    channels: safeChannels,
    roundLimit: clampRoundLimit(raw.roundLimit),
    roles: safeRoles,
    runtime: normalizeBiyanTeamsRuntime(raw.runtime, safeRoles),
    createdAt: raw.createdAt || fallback.createdAt,
    updatedAt: raw.updatedAt || nowIso(),
  }
}

export function isBiyanTeamsThread(thread?: Thread): boolean {
  return Boolean(normalizeBiyanTeamsConfig(readBiyanTeamsMetadata(thread?.metadata)))
}

export function patchBiyanTeamsConfig(
  config: BiyanTeamsConfig,
  patch: Partial<BiyanTeamsConfig>
): BiyanTeamsConfig {
  return {
    ...config,
    ...patch,
    updatedAt: new Date().toISOString(),
  }
}

// Archive (soft-disable) a role and record it in runtime.archivedRoleIds so the
// auto-injection paths (scenario playbooks, coordinator configure_team) cannot
// silently re-add or re-enable it. The orchestrator can never be archived.
export function archiveBiyanTeamsRole(
  config: BiyanTeamsConfig,
  roleId: BiyanTeamsRoleId
): BiyanTeamsConfig {
  if (roleId === BIYAN_TEAMS_ORCHESTRATOR_ROLE_ID) return config
  if (!config.roles.some((role) => role.id === roleId)) return config

  const fallbackRoleId =
    config.roles.find((role) => role.enabled && role.id !== roleId)?.id ??
    BIYAN_TEAMS_ORCHESTRATOR_ROLE_ID
  const archivedRoleIds = Array.from(
    new Set([...(config.runtime.archivedRoleIds ?? []), roleId])
  )

  return {
    ...config,
    roles: config.roles.map((role) =>
      role.id === roleId ? { ...role, enabled: false } : role
    ),
    channels: config.channels.map((channel) => ({
      ...channel,
      roleIds: channel.roleIds.filter((id) => id !== roleId),
    })),
    activeRoleId: fallbackRoleId,
    workspaceView: 'team-chat',
    runtime: {
      ...config.runtime,
      archivedRoleIds,
    },
    updatedAt: nowIso(),
  }
}

export function createBiyanTeamsPlanDraft(
  value: Partial<BiyanTeamsPlanDraft>,
  fallbackGoal: string,
  previousVersion = 0
): BiyanTeamsPlanDraft {
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

export function markBiyanTeamsRoleUserEdit(
  config: BiyanTeamsConfig,
  roleId: BiyanTeamsRoleId,
  fields: BiyanTeamsRoleEditableField[]
): BiyanTeamsConfig {
  const safeFields = fields.filter(isRoleEditableField)
  if (!safeFields.length) return config
  const existing = config.runtime.roleUserEdits?.[roleId]
  const role = config.roles.find((item) => item.id === roleId)
  const nextRuntime: BiyanTeamsRuntime = {
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
  return patchBiyanTeamsConfig(config, { runtime: nextRuntime })
}

const hasBiyanTeamsRoleUserEdits = (runtime: BiyanTeamsRuntime) =>
  Object.values(runtime.roleUserEdits ?? {}).some(
    (edit) => edit && edit.fields.length > 0
  )

const roleColorForIndex = (index: number) =>
  BIYAN_TEAMS_ROLE_COLORS[index % BIYAN_TEAMS_ROLE_COLORS.length]?.value ??
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

const planRoleChannelId = (assignment: BiyanTeamsPlanRoleAssignment) => {
  if (assignment.roleId === BIYAN_TEAMS_ORCHESTRATOR_ROLE_ID) {
    return BIYAN_TEAMS_TASK_CHANNEL_ID
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

const channelTemplateForId = (id: BiyanTeamsChannelId): BiyanTeamsChannelConfig => {
  const template = BIYAN_TEAMS_CHANNELS.find((channel) => channel.id === id)
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
  config: BiyanTeamsConfig,
  plan: BiyanTeamsPlanDraft
) {
  const assignmentsByRoleId = new Map<BiyanTeamsRoleId, BiyanTeamsPlanRoleAssignment>()
  const existingRoleIds = new Set(config.roles.map((role) => role.id))
  const allowNewPlanRoles = !isBiyanTeamsTeamLocked(config)

  for (const assignment of plan.roleAssignments) {
    const roleId = normalizeBiyanTeamsId(assignment.roleId, '')
    if (!roleId || (!allowNewPlanRoles && !existingRoleIds.has(roleId))) {
      continue
    }
    assignmentsByRoleId.set(roleId, { ...assignment, roleId })
  }

  for (const task of plan.tasks) {
    const roleId = normalizeBiyanTeamsId(task.roleId ?? '', '')
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
    const roleId = normalizeBiyanTeamsId(assignment.roleId, '')
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

    const materializedRole: BiyanTeamsRoleConfig = {
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
    const roleId = normalizeBiyanTeamsId(assignment.roleId, '')
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
        channel.id === BIYAN_TEAMS_TASK_CHANNEL_ID &&
        !channel.roleIds.includes(BIYAN_TEAMS_ORCHESTRATOR_ROLE_ID)
      ) {
        return {
          ...channel,
          roleIds: [BIYAN_TEAMS_ORCHESTRATOR_ROLE_ID, ...channel.roleIds],
        }
      }
      return channel
    }),
  }
}

export function approveBiyanTeamsPlan(
  config: BiyanTeamsConfig,
  options?: { keepRoleIds?: string[] }
): BiyanTeamsConfig {
  const plan = config.runtime.planDraft
  if (!plan) return config
  const now = nowIso()

  // When the owner edited the team on the approval card (removed roles), keep
  // only the roles they kept (plus the Host) so "approve" runs exactly the
  // displayed team.
  const edited = options?.keepRoleIds !== undefined
  const keepSet = edited
    ? new Set<string>([
        BIYAN_TEAMS_ORCHESTRATOR_ROLE_ID,
        ...(options?.keepRoleIds ?? []).map((id) =>
          normalizeBiyanTeamsId(id, '')
        ),
      ])
    : undefined
  const effectivePlan: BiyanTeamsPlanDraft = keepSet
    ? {
        ...plan,
        roleAssignments: plan.roleAssignments.filter((role) =>
          keepSet.has(role.roleId)
        ),
        tasks: plan.tasks.filter(
          (task) => !task.roleId || keepSet.has(task.roleId)
        ),
      }
    : plan

  const approvedPlan: BiyanTeamsPlanDraft = {
    ...effectivePlan,
    status: 'approved',
    updatedAt: now,
    approvedAt: now,
  }
  // Materialize the kept roles first (so a kept-but-new role is still created),
  // then — for an edited approval — disable the dropped roles and lock the team
  // so the Host cannot reintroduce them during execution.
  const materialized = materializeApprovedPlanRoles(config, approvedPlan)
  const nextRoles = keepSet
    ? materialized.roles.map((role) =>
        keepSet.has(role.id) ? role : { ...role, enabled: false }
      )
    : materialized.roles
  return patchBiyanTeamsConfig(config, {
    ...(edited ? { workflowControl: 'user_spec' as const } : {}),
    roles: nextRoles,
    channels: materialized.channels,
    activeRoleId: nextRoles.some(
      (role) => role.enabled && role.id === config.activeRoleId
    )
      ? config.activeRoleId
      : BIYAN_TEAMS_ORCHESTRATOR_ROLE_ID,
    activeChannel: materialized.channels.some(
      (channel) => channel.id === config.activeChannel
    )
      ? config.activeChannel
      : BIYAN_TEAMS_TASK_CHANNEL_ID,
    runtime: {
      ...config.runtime,
      phase: 'running',
      approvedPlan,
      approvedRoleSnapshot: nextRoles.map((role) => ({ ...role })),
      roleEditBaseline: Object.fromEntries(
        nextRoles.map((role) => [role.id, roleEditBaselineFromRole(role)])
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
          roleId: BIYAN_TEAMS_ORCHESTRATOR_ROLE_ID,
          channelId: BIYAN_TEAMS_TASK_CHANNEL_ID,
          createdAt: now,
        },
      ].slice(-80),
    },
  })
}

export function requestBiyanTeamsPlanRevision(
  config: BiyanTeamsConfig,
  revision: string
): BiyanTeamsConfig {
  const trimmed = revision.trim()
  if (!trimmed) return config
  const now = nowIso()
  const dirtyRoles = hasBiyanTeamsRoleUserEdits(config.runtime)
  return patchBiyanTeamsConfig(config, {
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
          roleId: BIYAN_TEAMS_ORCHESTRATOR_ROLE_ID,
          channelId: BIYAN_TEAMS_TASK_CHANNEL_ID,
          createdAt: now,
        },
      ].slice(-80),
    },
  })
}

export function resolveBiyanTeamsRoleEditConfirmation(
  config: BiyanTeamsConfig,
  keepRoleEdits: boolean
): BiyanTeamsConfig {
  const baseline = config.runtime.roleEditBaseline ?? {}
  const editedRoleIds = new Set(Object.keys(config.runtime.roleUserEdits ?? {}))
  const roles = keepRoleEdits
    ? config.roles
    : config.roles.map((role) =>
        editedRoleIds.has(role.id) && baseline[role.id]
          ? { ...role, ...baseline[role.id], id: role.id }
          : role
      )
  return patchBiyanTeamsConfig(config, {
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

export function renderBiyanTeamsSystemInstructions(
  config: BiyanTeamsConfig
): string {
  const mode = BIYAN_TEAMS_MODES.find((item) => item.id === config.mode)
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
