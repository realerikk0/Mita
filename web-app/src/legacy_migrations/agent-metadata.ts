import type {
  BiyanAgentConfig,
  BiyanAutoRunMetadata,
  BiyanMessageMetadata,
} from '@/types/biyan-agent'

const LEGACY_AUTO_RUN_KEYS = ['mitaAutoRun', 'silenceAutoRun'] as const
const LEGACY_AGENT_KEYS = ['mitaAgents', 'silenceAgents'] as const
const LEGACY_MESSAGE_KEY = 'mita'

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined
}

function readFirst(metadata: unknown, keys: readonly string[]): unknown {
  const record = asRecord(metadata)
  if (!record) return undefined
  for (const key of keys) {
    if (record[key] !== undefined) return record[key]
  }
  return undefined
}

export function readLegacyAutoRunMetadata(
  metadata: unknown
): BiyanAutoRunMetadata | undefined {
  return readFirst(metadata, LEGACY_AUTO_RUN_KEYS) as
    | BiyanAutoRunMetadata
    | undefined
}

export function readLegacyAgentConfigs(
  metadata: unknown
): BiyanAgentConfig[] | undefined {
  const value = readFirst(metadata, LEGACY_AGENT_KEYS)
  return Array.isArray(value) ? (value as BiyanAgentConfig[]) : undefined
}

export function readLegacyMessageAutoRunMetadata(
  metadata: unknown
): BiyanMessageMetadata | undefined {
  return asRecord(metadata)?.[LEGACY_MESSAGE_KEY] as
    | BiyanMessageMetadata
    | undefined
}

export function normalizeAgentMessageMetadata(
  metadata?: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (!metadata) return undefined
  const normalized = { ...metadata }
  const legacyMessageMetadata = readLegacyMessageAutoRunMetadata(metadata)
  if (normalized.biyan === undefined && legacyMessageMetadata !== undefined) {
    normalized.biyan = legacyMessageMetadata
  }
  delete normalized[LEGACY_MESSAGE_KEY]
  return normalized
}

/** Build a one-time patch that writes only canonical Biyan metadata. */
export function createLegacyAgentMetadataMigrationPatch(
  metadata: unknown
): Record<string, unknown> | undefined {
  const record = asRecord(metadata)
  if (!record) return undefined

  const legacyAutoRun = readLegacyAutoRunMetadata(record)
  const legacyAgents = readLegacyAgentConfigs(record)
  const containsLegacyKey = [...LEGACY_AUTO_RUN_KEYS, ...LEGACY_AGENT_KEYS].some(
    (key) => record[key] !== undefined
  )
  if (!containsLegacyKey) return undefined

  const patch: Record<string, unknown> = {}
  if (record.biyanAutoRun === undefined && legacyAutoRun !== undefined) {
    patch.biyanAutoRun = legacyAutoRun
  }
  if (record.biyanAgents === undefined && legacyAgents !== undefined) {
    patch.biyanAgents = legacyAgents
  }
  for (const key of [...LEGACY_AUTO_RUN_KEYS, ...LEGACY_AGENT_KEYS]) {
    patch[key] = undefined
  }
  return patch
}
