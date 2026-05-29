import {
  type MitaTeamsConfig,
  type MitaTeamsChannelId,
  type MitaTeamsProjectMemory,
  type MitaTeamsRoleConfig,
  type MitaTeamsRoleMemory,
  type MitaTeamsRoleState,
  type MitaTeamsRoleStreamMessage,
  type MitaTeamsRuntime,
  type MitaTeamsTeamEvent,
  normalizeMitaTeamsRuntime,
} from '@/types/mita-teams'

const LIST_LIMIT = 12
const EVENT_LIMIT = 80
const STREAM_LIMIT = 40

const nowIso = () => new Date().toISOString()

const stableId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const trimText = (value: string, max = 240) => {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > max ? `${normalized.slice(0, max - 3)}...` : normalized
}

const uniqueAppend = (base: string[], additions: string[], limit = LIST_LIMIT) => {
  const seen = new Set(base.map((item) => item.toLowerCase()))
  const merged = [...base]

  for (const addition of additions) {
    const normalized = trimText(addition)
    if (!normalized) continue
    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(normalized)
  }

  return merged.slice(-limit)
}

const firstSentences = (text: string, limit = 2) =>
  text
    .split(/(?<=[.!?。！？])\s+/)
    .map((item) => trimText(item, 180))
    .filter(Boolean)
    .slice(0, limit)

function extractMemorySignals(text: string) {
  const lines = text
    .split(/\n+/)
    .map((line) => line.replace(/^[-*•\d.)\s]+/, '').trim())
    .filter(Boolean)

  const facts: string[] = []
  const decisions: string[] = []
  const openQuestions: string[] = []
  const workingNotes: string[] = []

  for (const line of lines) {
    const lower = line.toLowerCase()
    if (
      lower.includes('decision') ||
      lower.includes('decide') ||
      lower.includes('therefore') ||
      line.includes('决定') ||
      line.includes('结论')
    ) {
      decisions.push(line)
    } else if (
      line.endsWith('?') ||
      line.endsWith('？') ||
      lower.includes('question') ||
      lower.includes('need to ask') ||
      line.includes('需要确认')
    ) {
      openQuestions.push(line)
    } else if (
      lower.includes('fact') ||
      lower.includes('found') ||
      lower.includes('confirmed') ||
      line.includes('事实') ||
      line.includes('已确认')
    ) {
      facts.push(line)
    } else {
      workingNotes.push(line)
    }
  }

  if (
    facts.length === 0 &&
    decisions.length === 0 &&
    openQuestions.length === 0
  ) {
    facts.push(...firstSentences(text, 2))
  }

  return {
    facts: facts.slice(0, 4),
    decisions: decisions.slice(0, 4),
    openQuestions: openQuestions.slice(0, 4),
    workingNotes: workingNotes.slice(0, 4),
  }
}

export function getMitaTeamsRuntime(config: MitaTeamsConfig): MitaTeamsRuntime {
  return normalizeMitaTeamsRuntime(config.runtime, config.roles)
}

export function withMitaTeamsRuntime(
  config: MitaTeamsConfig,
  runtime: MitaTeamsRuntime
): MitaTeamsConfig {
  return {
    ...config,
    runtime: normalizeMitaTeamsRuntime(runtime, config.roles),
    updatedAt: nowIso(),
  }
}

export function appendMitaTeamsEvent(
  runtime: MitaTeamsRuntime,
  event: Omit<MitaTeamsTeamEvent, 'id' | 'createdAt'>
): MitaTeamsRuntime {
  return {
    ...runtime,
    teamEvents: [
      ...runtime.teamEvents,
      {
        ...event,
        id: stableId('event'),
        createdAt: nowIso(),
      },
    ].slice(-EVENT_LIMIT),
  }
}

export function appendRoleStreamMessage(
  runtime: MitaTeamsRuntime,
  role: MitaTeamsRoleConfig,
  message: Omit<MitaTeamsRoleStreamMessage, 'id' | 'createdAt' | 'roleId'>
): MitaTeamsRuntime {
  const current = runtime.roleStates[role.id]
  const state: MitaTeamsRoleState = current ?? {
    roleId: role.id,
    status: 'idle',
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
  }

  return {
    ...runtime,
    roleStates: {
      ...runtime.roleStates,
      [role.id]: {
        ...state,
        stream: [
          ...state.stream,
          {
            ...message,
            id: stableId(`role-${role.id}`),
            roleId: role.id,
            createdAt: nowIso(),
          },
        ].slice(-STREAM_LIMIT),
      },
    },
  }
}

export function recordRoleTurnMemory(
  runtime: MitaTeamsRuntime,
  role: MitaTeamsRoleConfig,
  output: string,
  turnId: string,
  model?: ThreadModel,
  channelId?: MitaTeamsChannelId
): MitaTeamsRuntime {
  const signals = extractMemorySignals(output)
  const current = runtime.roleStates[role.id]
  const previousMemory =
    current?.memory ??
    ({
      roleId: role.id,
      version: 0,
      summary: '',
      facts: [],
      decisions: [],
      openQuestions: [],
      workingNotes: [],
      updatedAt: nowIso(),
    } satisfies MitaTeamsRoleMemory)
  const summarySeed = firstSentences(output, 2).join(' ')
  const memory: MitaTeamsRoleMemory = {
    ...previousMemory,
    version: previousMemory.version + 1,
    summary: trimText(summarySeed || previousMemory.summary, 320),
    facts: uniqueAppend(previousMemory.facts, signals.facts),
    decisions: uniqueAppend(previousMemory.decisions, signals.decisions),
    openQuestions: uniqueAppend(
      previousMemory.openQuestions,
      signals.openQuestions
    ),
    workingNotes: uniqueAppend(previousMemory.workingNotes, signals.workingNotes),
    updatedAt: nowIso(),
  }
  const state: MitaTeamsRoleState = {
    roleId: role.id,
    status: 'done',
    stream: [
      ...(current?.stream ?? []),
      {
        id: stableId(`role-${role.id}`),
        turnId,
        roleId: role.id,
        channelId,
        role: 'assistant' as const,
        content: output,
        createdAt: nowIso(),
        model,
      },
    ].slice(-STREAM_LIMIT),
    memory,
    lastTurnId: turnId,
  }

  return appendMitaTeamsEvent(
    {
      ...runtime,
      roleStates: {
        ...runtime.roleStates,
        [role.id]: state,
      },
    },
    {
      type: 'role_completed',
      title: `${role.name} completed a turn`,
      detail: trimText(output, 160),
      roleId: role.id,
      channelId,
    }
  )
}

export function mergeProjectMemory(
  runtime: MitaTeamsRuntime,
  roles: MitaTeamsRoleConfig[]
): MitaTeamsRuntime {
  const previous = runtime.projectMemory
  let changed = false
  let facts = previous.facts
  let decisions = previous.decisions
  let openQuestions = previous.openQuestions
  const sourceVersions: MitaTeamsProjectMemory['sourceRoleMemoryVersions'] = {
    ...previous.sourceRoleMemoryVersions,
  }

  for (const role of roles) {
    const memory = runtime.roleStates[role.id]?.memory
    if (!memory) continue
    if (sourceVersions[role.id] === memory.version) continue

    changed = true
    sourceVersions[role.id] = memory.version
    facts = uniqueAppend(facts, memory.facts, 20)
    decisions = uniqueAppend(decisions, memory.decisions, 20)
    openQuestions = uniqueAppend(openQuestions, memory.openQuestions, 20)
  }

  if (!changed) return runtime

  const summaryParts = [
    decisions[decisions.length - 1],
    facts[facts.length - 1],
    openQuestions.length
      ? `Open question: ${openQuestions[openQuestions.length - 1]}`
      : undefined,
  ].filter(Boolean)

  const projectMemory: MitaTeamsProjectMemory = {
    ...previous,
    version: previous.version + 1,
    summary: trimText(summaryParts.join(' '), 420),
    facts,
    decisions,
    openQuestions,
    milestones: uniqueAppend(previous.milestones, runtime.milestones.map((m) => m.title), 20),
    sourceRoleMemoryVersions: sourceVersions,
    updatedAt: nowIso(),
  }

  return appendMitaTeamsEvent(
    {
      ...runtime,
      projectMemory,
    },
    {
      type: 'memory_merged',
      title: 'Project memory updated',
      detail: projectMemory.summary || 'Role memories were merged.',
    }
  )
}

export function answerMitaTeamsChoice(
  runtime: MitaTeamsRuntime,
  optionId: string
): MitaTeamsRuntime {
  const choice = runtime.userChoiceRequest
  if (!choice || choice.status !== 'pending') return runtime
  const option = choice.options.find((item) => item.id === optionId)
  if (!option) return runtime

  const answered = {
    ...choice,
    status: 'answered' as const,
    selectedOptionId: optionId,
    answeredAt: nowIso(),
  }

  return appendMitaTeamsEvent(
    {
      ...runtime,
      userChoiceRequest: answered,
    },
    {
      type: 'choice_answered',
      title: 'Owner selected an option',
      detail: option?.label ?? optionId,
    }
  )
}

export function roleMemoryText(memory: MitaTeamsRoleMemory): string {
  return [
    memory.summary ? `Summary: ${memory.summary}` : undefined,
    memory.facts.length ? `Facts:\n- ${memory.facts.join('\n- ')}` : undefined,
    memory.decisions.length
      ? `Decisions:\n- ${memory.decisions.join('\n- ')}`
      : undefined,
    memory.openQuestions.length
      ? `Open questions:\n- ${memory.openQuestions.join('\n- ')}`
      : undefined,
    memory.workingNotes.length
      ? `Working notes:\n- ${memory.workingNotes.join('\n- ')}`
      : undefined,
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function projectMemoryText(memory: MitaTeamsProjectMemory): string {
  return [
    memory.summary ? `Summary: ${memory.summary}` : undefined,
    memory.facts.length ? `Facts:\n- ${memory.facts.join('\n- ')}` : undefined,
    memory.decisions.length
      ? `Decisions:\n- ${memory.decisions.join('\n- ')}`
      : undefined,
    memory.openQuestions.length
      ? `Open questions:\n- ${memory.openQuestions.join('\n- ')}`
      : undefined,
    memory.milestones.length
      ? `Milestones:\n- ${memory.milestones.join('\n- ')}`
      : undefined,
  ]
    .filter(Boolean)
    .join('\n\n')
}
