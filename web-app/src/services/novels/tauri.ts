import { invoke } from '@tauri-apps/api/core'

import {
  NovelServiceError,
  type AiSuggestion,
  type Character,
  type Clue,
  type CommentThread,
  type CreateNovelProjectInput,
  type ManuscriptUnit,
  type NovelExportInput,
  type NovelExportResult,
  type NovelImportInput,
  type NovelProject,
  type NovelProjectBundle,
  type NovelProjectSummary,
  type NovelRevision,
  type NovelServiceErrorCode,
  type OutlineNode,
  type Relationship,
  type SaveManuscriptUnitInput,
  type SaveNovelCollectionInput,
  type VersionedCollection,
} from '@/types/novel'
import type { NovelService } from './types'

type SerializedNovelError = {
  code?: unknown
  message?: unknown
  currentRevision?: unknown
  outcomeUnknown?: unknown
}

const ERROR_CODES = new Set<NovelServiceErrorCode>([
  'not_found',
  'revision_conflict',
  'invalid_data',
  'unsupported',
  'storage_error',
])

function errorPayload(error: unknown): SerializedNovelError | undefined {
  if (error && typeof error === 'object') {
    return error as SerializedNovelError
  }
  if (typeof error !== 'string') return undefined
  try {
    const parsed = JSON.parse(error) as unknown
    return parsed && typeof parsed === 'object'
      ? (parsed as SerializedNovelError)
      : undefined
  } catch {
    return undefined
  }
}

export function novelServiceErrorFromUnknown(error: unknown): NovelServiceError {
  if (error instanceof NovelServiceError) return error
  const payload = errorPayload(error)
  const rawCode = payload?.code
  const code =
    typeof rawCode === 'string' &&
    ERROR_CODES.has(rawCode as NovelServiceErrorCode)
      ? (rawCode as NovelServiceErrorCode)
      : 'storage_error'
  const message =
    typeof payload?.message === 'string'
      ? payload.message
      : error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : 'Novel storage operation failed'
  const currentRevision =
    typeof payload?.currentRevision === 'number'
      ? payload.currentRevision
      : undefined

  return new NovelServiceError(code, message, {
    currentRevision,
    outcomeUnknown: payload?.outcomeUnknown === true,
  })
}

export class TauriNovelService implements NovelService {
  async listProjects(): Promise<NovelProjectSummary[]> {
    return this.command('list_novel_projects')
  }

  async createProject(
    input: CreateNovelProjectInput
  ): Promise<NovelProjectBundle> {
    return this.command('create_novel_project', { request: input })
  }

  async openProject(novelId: string): Promise<NovelProjectBundle> {
    return this.command('open_novel_project', { novelId })
  }

  async deleteProject(novelId: string): Promise<void> {
    return this.command('delete_novel_project', { novelId })
  }

  async saveProject(
    project: NovelProject,
    expectedRevision: number
  ): Promise<NovelProject> {
    return this.command('save_novel_project', {
      request: { project, expectedRevision },
    })
  }

  async loadManuscriptUnit(
    novelId: string,
    unitId: string
  ): Promise<ManuscriptUnit | null> {
    return this.command('load_manuscript_unit', { novelId, unitId })
  }

  async saveManuscriptUnit(
    input: SaveManuscriptUnitInput
  ): Promise<ManuscriptUnit> {
    return this.command('save_manuscript_unit', { request: input })
  }

  async saveCharacters(
    input: SaveNovelCollectionInput<Character>
  ): Promise<VersionedCollection<Character>> {
    return this.command('save_novel_characters', { request: input })
  }

  async saveRelationships(
    input: SaveNovelCollectionInput<Relationship>
  ): Promise<VersionedCollection<Relationship>> {
    return this.command('save_novel_relationships', { request: input })
  }

  async saveOutline(
    input: SaveNovelCollectionInput<OutlineNode>
  ): Promise<VersionedCollection<OutlineNode>> {
    return this.command('save_novel_outline', { request: input })
  }

  async saveClues(
    input: SaveNovelCollectionInput<Clue>
  ): Promise<VersionedCollection<Clue>> {
    return this.command('save_novel_clues', { request: input })
  }

  async saveComments(
    input: SaveNovelCollectionInput<CommentThread>
  ): Promise<VersionedCollection<CommentThread>> {
    return this.command('save_novel_comments', { request: input })
  }

  async saveSuggestions(
    input: SaveNovelCollectionInput<AiSuggestion>
  ): Promise<VersionedCollection<AiSuggestion>> {
    return this.command('save_novel_suggestions', { request: input })
  }

  async importProject(input: NovelImportInput): Promise<NovelProjectBundle> {
    return this.command('import_novel_project', { request: input })
  }

  async exportProject(input: NovelExportInput): Promise<NovelExportResult> {
    return this.command('export_novel_project', { request: input })
  }

  async listRevisions(
    novelId: string,
    unitId: string
  ): Promise<NovelRevision[]> {
    return this.command('list_novel_revisions', { novelId, unitId })
  }

  async restoreRevision(
    novelId: string,
    unitId: string,
    revisionId: string,
    expectedRevision: number
  ): Promise<ManuscriptUnit> {
    return this.command('restore_novel_revision', {
      request: { novelId, unitId, revisionId, expectedRevision },
    })
  }

  private async command<T>(
    name: string,
    args?: Record<string, unknown>
  ): Promise<T> {
    try {
      return await invoke<T>(name, args)
    } catch (error) {
      throw novelServiceErrorFromUnknown(error)
    }
  }
}
