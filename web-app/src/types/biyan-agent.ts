export type BiyanAgentRole = 'planner' | 'worker' | 'coordinator' | 'verifier'

export type BiyanAgentConfig = {
  id: string
  role: BiyanAgentRole
  name: string
  modelId?: string
  provider?: string
  systemPrompt: string
  enabled: boolean
}

export type BiyanAutoRunStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'stopped'
  | 'completed'
  | 'error'

export type BiyanAutoRunMetadata = {
  status: BiyanAutoRunStatus
  maxRounds: number
  currentRound: number
  enabled: boolean
  runId?: string
  startedAt?: string
  updatedAt?: string
  lastError?: string
}

export type BiyanMessageMetadata = {
  runId: string
  round: number
  mode: 'single-thread'
}

export const DEFAULT_BIYAN_AGENTS: BiyanAgentConfig[] = [
  {
    id: 'biyan-planner',
    role: 'planner',
    name: 'Planner',
    systemPrompt: 'Break the owner request into a quiet, concrete plan before work begins.',
    enabled: false,
  },
  {
    id: 'biyan-worker',
    role: 'worker',
    name: 'Worker',
    systemPrompt: 'Carry out the current plan step and return the concrete result.',
    enabled: false,
  },
  {
    id: 'biyan-coordinator',
    role: 'coordinator',
    name: 'Coordinator',
    systemPrompt: 'Coordinate role outputs and decide whether another round is needed.',
    enabled: false,
  },
  {
    id: 'biyan-verifier',
    role: 'verifier',
    name: 'Verifier',
    systemPrompt: 'Verify the result against the owner request and call out gaps.',
    enabled: false,
  },
]

export const DEFAULT_BIYAN_AUTO_RUN: BiyanAutoRunMetadata = {
  status: 'idle',
  maxRounds: 3,
  currentRound: 0,
  enabled: false,
}
