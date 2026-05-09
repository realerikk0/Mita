export type MitaAgentRole = 'planner' | 'worker' | 'coordinator' | 'verifier'

export type MitaAgentConfig = {
  id: string
  role: MitaAgentRole
  name: string
  modelId?: string
  provider?: string
  systemPrompt: string
  enabled: boolean
}

export type MitaAutoRunStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'stopped'
  | 'completed'
  | 'error'

export type MitaAutoRunMetadata = {
  status: MitaAutoRunStatus
  maxRounds: number
  currentRound: number
  enabled: boolean
  runId?: string
  startedAt?: string
  updatedAt?: string
  lastError?: string
}

export type MitaMessageMetadata = {
  runId: string
  round: number
  mode: 'single-thread'
}

export const DEFAULT_MITA_AGENTS: MitaAgentConfig[] = [
  {
    id: 'mita-planner',
    role: 'planner',
    name: 'Planner',
    systemPrompt: 'Break the owner request into a quiet, concrete plan before work begins.',
    enabled: false,
  },
  {
    id: 'mita-worker',
    role: 'worker',
    name: 'Worker',
    systemPrompt: 'Carry out the current plan step and return the concrete result.',
    enabled: false,
  },
  {
    id: 'mita-coordinator',
    role: 'coordinator',
    name: 'Coordinator',
    systemPrompt: 'Coordinate role outputs and decide whether another round is needed.',
    enabled: false,
  },
  {
    id: 'mita-verifier',
    role: 'verifier',
    name: 'Verifier',
    systemPrompt: 'Verify the result against the owner request and call out gaps.',
    enabled: false,
  },
]

export const DEFAULT_MITA_AUTO_RUN: MitaAutoRunMetadata = {
  status: 'idle',
  maxRounds: 3,
  currentRound: 0,
  enabled: false,
}
