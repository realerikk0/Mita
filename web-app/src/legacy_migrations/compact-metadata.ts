const LEGACY_COMPACT_METADATA_KEY = 'mitaCompact'

export function readLegacyCompactMetadata(
  metadata?: Record<string, unknown>
): unknown {
  return metadata?.[LEGACY_COMPACT_METADATA_KEY]
}
