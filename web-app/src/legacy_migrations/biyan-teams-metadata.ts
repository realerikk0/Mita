const LEGACY_BIYAN_TEAMS_METADATA_KEY = 'mitaTeams'
const CANONICAL_BIYAN_TEAMS_METADATA_KEY = 'biyanTeams'

export function readLegacyBiyanTeamsMetadata(
  metadata?: Record<string, unknown>
): unknown {
  return metadata?.[LEGACY_BIYAN_TEAMS_METADATA_KEY]
}

export function legacyBiyanTeamsCleanupPatch(): Record<string, undefined> {
  return { [LEGACY_BIYAN_TEAMS_METADATA_KEY]: undefined }
}

export function createLegacyBiyanTeamsMigrationPatch(
  metadata?: Record<string, unknown>
): Record<string, unknown> | undefined {
  const legacyValue = readLegacyBiyanTeamsMetadata(metadata)
  if (
    !metadata ||
    metadata[CANONICAL_BIYAN_TEAMS_METADATA_KEY] !== undefined ||
    legacyValue === undefined
  ) {
    return undefined
  }

  return {
    [CANONICAL_BIYAN_TEAMS_METADATA_KEY]: legacyValue,
    ...legacyBiyanTeamsCleanupPatch(),
  }
}

export const legacyBiyanTeamsMetadataKeyForTests =
  LEGACY_BIYAN_TEAMS_METADATA_KEY
