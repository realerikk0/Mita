import { localStorageKey } from '@/constants/localStorage'
import type { ThreadFolder } from '@/services/projects/types'

import { LEGACY_DEFAULT_ASSISTANT_IDS } from './assistant'

export interface AssistantIdNormalization {
  sourceId?: string
  targetId?: string
}

const LEGACY_ASSISTANT_IDS = new Set(LEGACY_DEFAULT_ASSISTANT_IDS)

function uniqueImportedAssistant(
  legacyId: string,
  validAssistantIds: Set<string>,
  normalizedIdCounts: Map<string, number>
): string | undefined {
  const prefix = `legacy-import-${legacyId}`
  const candidates = [...validAssistantIds].filter(
    (id) =>
      (id === prefix || id.startsWith(`${prefix}-`)) &&
      normalizedIdCounts.get(id) === 1
  )
  return candidates.length === 1 ? candidates[0] : undefined
}

function explicitLegacyMappings(
  normalizations: readonly AssistantIdNormalization[],
  validAssistantIds: Set<string>,
  normalizedIdCounts: Map<string, number>
): Map<string, string> {
  const candidates = new Map<string, Set<string>>()

  for (const { sourceId, targetId } of normalizations) {
    if (
      !sourceId ||
      !targetId ||
      !LEGACY_ASSISTANT_IDS.has(sourceId) ||
      !validAssistantIds.has(targetId) ||
      (targetId !== 'biyan' && normalizedIdCounts.get(targetId) !== 1)
    ) {
      continue
    }
    const targets = candidates.get(sourceId) ?? new Set<string>()
    targets.add(targetId)
    candidates.set(sourceId, targets)
  }

  return new Map(
    [...candidates].flatMap(([sourceId, targets]) =>
      targets.size === 1 ? [[sourceId, [...targets][0]] as const] : []
    )
  )
}

/**
 * Reconcile Project assistant selections after the assistant ID migration.
 *
 * A legacy ID is rewritten only when its target is provable from the same
 * assistant normalization pass or from one unambiguous `legacy-import-*`
 * assistant produced by the Rust migrator. Ambiguous or missing selections
 * are cleared so a Project can never silently inherit the stock Biyan prompt.
 */
export function reconcileProjectAssistantSelections(
  projects: readonly ThreadFolder[],
  normalizations: readonly AssistantIdNormalization[],
  normalizedAssistantIds: readonly string[]
): { projects: ThreadFolder[]; changed: boolean } {
  const validAssistantIds = new Set(normalizedAssistantIds.filter(Boolean))
  const normalizedIdCounts = new Map<string, number>()
  for (const { targetId } of normalizations) {
    if (!targetId) continue
    normalizedIdCounts.set(
      targetId,
      (normalizedIdCounts.get(targetId) ?? 0) + 1
    )
  }
  for (const id of validAssistantIds) {
    if (!normalizedIdCounts.has(id)) normalizedIdCounts.set(id, 1)
  }
  const explicitMappings = explicitLegacyMappings(
    normalizations,
    validAssistantIds,
    normalizedIdCounts
  )
  let changed = false

  const reconciled = projects.map((project) => {
    const currentId = project.assistantId
    if (!currentId) return project

    let targetId: string | undefined
    if (LEGACY_ASSISTANT_IDS.has(currentId)) {
      targetId =
        explicitMappings.get(currentId) ??
        uniqueImportedAssistant(
          currentId,
          validAssistantIds,
          normalizedIdCounts
        )
    } else if (validAssistantIds.has(currentId)) {
      targetId = currentId
    }

    if (targetId === currentId) return project
    changed = true

    const nextProject = { ...project }
    if (targetId) nextProject.assistantId = targetId
    else delete nextProject.assistantId
    return nextProject
  })

  return { projects: reconciled, changed }
}

/**
 * Migrate the canonical Project store in place while preserving all unrelated
 * Zustand state and its version. Invalid storage is left untouched.
 */
export function migratePersistedProjectAssistantSelections(
  normalizations: readonly AssistantIdNormalization[],
  normalizedAssistantIds: readonly string[]
): ThreadFolder[] | undefined {
  try {
    const stored = localStorage.getItem(localStorageKey.threadManagement)
    if (!stored) return undefined

    const data = JSON.parse(stored) as {
      state?: { folders?: ThreadFolder[]; [key: string]: unknown }
      [key: string]: unknown
    }
    if (!Array.isArray(data.state?.folders)) return undefined

    const result = reconcileProjectAssistantSelections(
      data.state.folders,
      normalizations,
      normalizedAssistantIds
    )
    if (!result.changed) return result.projects

    try {
      localStorage.setItem(
        localStorageKey.threadManagement,
        JSON.stringify({
          ...data,
          state: { ...data.state, folders: result.projects },
        })
      )
    } catch {
      // Keep the current session safe and retry persistence on the next load.
    }
    return result.projects
  } catch {
    return undefined
  }
}
