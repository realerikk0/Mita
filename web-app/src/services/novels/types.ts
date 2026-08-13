import type {
  AiSuggestion,
  Character,
  Clue,
  CommentThread,
  CreateNovelProjectInput,
  ManuscriptUnit,
  NovelExportInput,
  NovelExportResult,
  NovelImportInput,
  NovelProject,
  NovelProjectBundle,
  NovelProjectSummary,
  NovelRevision,
  Relationship,
  SaveManuscriptUnitInput,
  SaveNovelCollectionInput,
  OutlineNode,
  VersionedCollection,
} from '@/types/novel'

export interface NovelService {
  listProjects(): Promise<NovelProjectSummary[]>
  createProject(input: CreateNovelProjectInput): Promise<NovelProjectBundle>
  openProject(novelId: string): Promise<NovelProjectBundle>
  deleteProject(novelId: string): Promise<void>
  saveProject(
    project: NovelProject,
    expectedRevision: number
  ): Promise<NovelProject>
  loadManuscriptUnit(
    novelId: string,
    unitId: string
  ): Promise<ManuscriptUnit | null>
  saveManuscriptUnit(input: SaveManuscriptUnitInput): Promise<ManuscriptUnit>
  saveCharacters(
    input: SaveNovelCollectionInput<Character>
  ): Promise<VersionedCollection<Character>>
  saveRelationships(
    input: SaveNovelCollectionInput<Relationship>
  ): Promise<VersionedCollection<Relationship>>
  saveOutline(
    input: SaveNovelCollectionInput<OutlineNode>
  ): Promise<VersionedCollection<OutlineNode>>
  saveClues(
    input: SaveNovelCollectionInput<Clue>
  ): Promise<VersionedCollection<Clue>>
  saveComments(
    input: SaveNovelCollectionInput<CommentThread>
  ): Promise<VersionedCollection<CommentThread>>
  saveSuggestions(
    input: SaveNovelCollectionInput<AiSuggestion>
  ): Promise<VersionedCollection<AiSuggestion>>
  importProject(input: NovelImportInput): Promise<NovelProjectBundle>
  exportProject(input: NovelExportInput): Promise<NovelExportResult>
  listRevisions(novelId: string, unitId: string): Promise<NovelRevision[]>
  restoreRevision(
    novelId: string,
    unitId: string,
    revisionId: string,
    expectedRevision: number
  ): Promise<ManuscriptUnit>
}
