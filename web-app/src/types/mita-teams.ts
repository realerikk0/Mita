export type MitaTeamsMode =
  | 'relay'
  | 'roundtable'
  | 'debate'
  | 'red-team'
  | 'silent'

export type MitaTeamsChannelId =
  | 'task'
  | 'research'
  | 'discussion'
  | 'build'
  | 'review'
  | 'final'

export type MitaTeamsRoleId =
  | 'orchestrator'
  | 'researcher'
  | 'architect'
  | 'builder'
  | 'reviewer'
  | 'skeptic'

export type MitaTeamsPermission = 'read' | 'tools' | 'write'

export type MitaTeamsWorkspaceView = 'team-chat' | 'role-chat' | 'role-config'

export type MitaTeamsChannelConfig = {
  id: MitaTeamsChannelId
  label: string
  description: string
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

export type MitaTeamsConfig = {
  enabled: boolean
  mode: MitaTeamsMode
  activeChannel: MitaTeamsChannelId
  activeRoleId: MitaTeamsRoleId
  workspaceView: MitaTeamsWorkspaceView
  channels: MitaTeamsChannelConfig[]
  roundLimit: number
  roles: MitaTeamsRoleConfig[]
  createdAt: string
  updatedAt: string
}

export const MITA_TEAMS_METADATA_KEY = 'mitaTeams'

export const MITA_TEAMS_CHANNELS: Array<{
  id: MitaTeamsChannelId
  label: string
  description: string
}> = [
  {
    id: 'task',
    label: 'Current task',
    description: 'The shared working room for the owner goal and current context.',
  },
  {
    id: 'research',
    label: 'Research',
    description: 'Collect evidence, references, code findings, and open questions.',
  },
  {
    id: 'discussion',
    label: 'Discussion',
    description: 'Compare options, resolve disagreements, and align the team.',
  },
  {
    id: 'build',
    label: 'Build log',
    description: 'Track concrete edits, implementation notes, and verification output.',
  },
  {
    id: 'review',
    label: 'Review',
    description: 'Inspect risks, regressions, missing tests, and acceptance gaps.',
  },
  {
    id: 'final',
    label: 'Final delivery',
    description: 'Assemble the user-facing answer, artifacts, and next actions.',
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
    id: 'orchestrator',
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
  MITA_TEAMS_CHANNELS.some((channel) => channel.id === value)

const isMitaTeamsRoleId = (value: unknown): value is MitaTeamsRoleId =>
  DEFAULT_MITA_TEAMS_ROLES.some((role) => role.id === value)

const isMitaTeamsWorkspaceView = (
  value: unknown
): value is MitaTeamsWorkspaceView =>
  value === 'team-chat' || value === 'role-chat' || value === 'role-config'

const defaultCoordinatorRole = (model?: ThreadModel): MitaTeamsRoleConfig => ({
  ...DEFAULT_MITA_TEAMS_ROLES[0],
  provider: model?.provider,
  modelId: model?.id,
})

const defaultTaskChannel = (): MitaTeamsChannelConfig => ({
  ...MITA_TEAMS_CHANNELS[0],
})

export function createDefaultMitaTeamsConfig(
  model?: ThreadModel
): MitaTeamsConfig {
  const now = new Date().toISOString()
  return {
    enabled: true,
    mode: 'relay',
    activeChannel: 'task',
    activeRoleId: 'orchestrator',
    workspaceView: 'team-chat',
    channels: [defaultTaskChannel()],
    roundLimit: 5,
    roles: [defaultCoordinatorRole(model)],
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

  const fallback = createDefaultMitaTeamsConfig(model)
  const rawRoles = Array.isArray(raw.roles) ? raw.roles : []
  const rawChannels = Array.isArray(raw.channels) ? raw.channels : []
  const roleTemplates = DEFAULT_MITA_TEAMS_ROLES.map((role) => ({
    ...role,
    provider: model?.provider,
    modelId: model?.id,
  }))

  const roles = rawRoles.length
    ? rawRoles
        .map((role) => {
          if (!role || typeof role !== 'object') return undefined
          const saved = role as Partial<MitaTeamsRoleConfig>
          if (!isMitaTeamsRoleId(saved.id)) return undefined

          const template =
            roleTemplates.find((defaultRole) => defaultRole.id === saved.id) ??
            defaultCoordinatorRole(model)

          return {
            ...template,
            ...saved,
            id: saved.id,
            name: saved.name || template.name,
            label: saved.label || template.label,
            description: saved.description || template.description,
            prompt: saved.prompt || template.prompt,
            color: saved.color || template.color,
            permission: saved.permission || template.permission,
            enabled: saved.enabled !== false,
          }
        })
        .filter((role): role is MitaTeamsRoleConfig => Boolean(role))
    : fallback.roles

  const safeRoles = roles.length ? roles : fallback.roles

  const channels = rawChannels.length
    ? rawChannels
        .map((channel) => {
          if (!channel || typeof channel !== 'object') return undefined
          const saved = channel as Partial<MitaTeamsChannelConfig>
          if (!isMitaTeamsChannelId(saved.id)) return undefined

          const template =
            MITA_TEAMS_CHANNELS.find((item) => item.id === saved.id) ??
            defaultTaskChannel()

          return {
            ...template,
            ...saved,
            id: saved.id,
            label: saved.label || template.label,
            description: saved.description || template.description,
          }
        })
        .filter((channel): channel is MitaTeamsChannelConfig =>
          Boolean(channel)
        )
    : fallback.channels

  const safeChannels = channels.length ? channels : fallback.channels
  const activeRoleId =
    isMitaTeamsRoleId(raw.activeRoleId) &&
    safeRoles.some((role) => role.id === raw.activeRoleId)
      ? raw.activeRoleId
      : safeRoles[0].id
  const activeChannel =
    isMitaTeamsChannelId(raw.activeChannel) &&
    safeChannels.some((channel) => channel.id === raw.activeChannel)
      ? raw.activeChannel
      : safeChannels[0].id

  return {
    ...fallback,
    ...raw,
    enabled: true,
    mode: isMitaTeamsMode(raw.mode) ? raw.mode : fallback.mode,
    activeChannel,
    activeRoleId,
    workspaceView: isMitaTeamsWorkspaceView(raw.workspaceView)
      ? raw.workspaceView
      : fallback.workspaceView,
    channels: safeChannels,
    roundLimit: clampRoundLimit(raw.roundLimit),
    roles: safeRoles,
    createdAt: raw.createdAt || fallback.createdAt,
    updatedAt: raw.updatedAt || new Date().toISOString(),
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

export function renderMitaTeamsSystemInstructions(
  config: MitaTeamsConfig
): string {
  const mode = MITA_TEAMS_MODES.find((item) => item.id === config.mode)
  const activeRole = config.roles.find((role) => role.id === config.activeRoleId)
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
  const directRoleInstruction =
    config.workspaceView === 'role-chat' && activeRole
      ? `\nDirect role chat:
- The owner is talking directly with ${activeRole.name}.
- Answer as ${activeRole.name}, using this role prompt: ${activeRole.prompt}
- Do not simulate the full team unless the owner asks to return to team collaboration.`
      : ''

  return `Mita Teams mode is active.
Goal: solve the owner request through role-based collaboration.
Mode: ${mode?.label ?? config.mode} - ${mode?.description ?? ''}
Round limit: ${config.roundLimit}.
Roles:
${roles}

Operating rules:
- Act as the Coordinator for this MVP and coordinate the enabled roles.
- New teams start small. First understand the owner's goal, then suggest specific roles or channels only when they would materially improve the work.
- Keep the visible answer concise; do not make every role speak every turn.
- Use role-labeled sections only when they help the owner inspect the work.
- Convert disagreement into explicit decisions, risks, and next actions.
- Treat tool outputs as raw records; summarize tool results in assistant prose.
- Do not claim that separate LLMs privately ran unless a future runtime provides those calls.${directRoleInstruction}`
}
