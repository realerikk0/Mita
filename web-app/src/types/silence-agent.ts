export type SilenceAgentRole = 'planner' | 'worker' | 'coordinator' | 'verifier'

export type SilenceAgentConfig = {
  id: string
  role: SilenceAgentRole
  name: string
  modelId?: string
  provider?: string
  systemPrompt: string
  enabled: boolean
}

export type SilenceAutoRunStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'stopped'
  | 'completed'
  | 'error'

export type SilenceAutoRunMetadata = {
  status: SilenceAutoRunStatus
  maxRounds: number
  currentRound: number
  enabled: boolean
  runId?: string
  startedAt?: string
  updatedAt?: string
  lastError?: string
}

export type SilenceMessageMetadata = {
  runId: string
  round: number
  mode: 'single-thread'
}

export const DEFAULT_SILENCE_AGENTS: SilenceAgentConfig[] = [
  {
    id: 'silence-planner',
    role: 'planner',
    name: 'Planner',
    systemPrompt: 'Break the owner request into a quiet, concrete plan before work begins.',
    enabled: false,
  },
  {
    id: 'silence-worker',
    role: 'worker',
    name: 'Worker',
    systemPrompt: 'Carry out the current plan step and return the concrete result.',
    enabled: false,
  },
  {
    id: 'silence-coordinator',
    role: 'coordinator',
    name: 'Coordinator',
    systemPrompt: 'Coordinate role outputs and decide whether another round is needed.',
    enabled: false,
  },
  {
    id: 'silence-verifier',
    role: 'verifier',
    name: 'Verifier',
    systemPrompt: 'Verify the result against the owner request and call out gaps.',
    enabled: false,
  },
]

export const DEFAULT_SILENCE_AUTO_RUN: SilenceAutoRunMetadata = {
  status: 'idle',
  maxRounds: 3,
  currentRound: 0,
  enabled: false,
}
