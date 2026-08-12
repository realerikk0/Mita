export const NOVEL_SCHEMA_VERSION = 1

export type NovelKind = 'web_novel' | 'novel' | 'screenplay'
export type ManuscriptUnitKind = 'volume' | 'chapter' | 'act' | 'scene'

export type TiptapMark = {
  type: string
  attrs?: Record<string, unknown>
}

export type TiptapNode = {
  type: string
  attrs?: Record<string, unknown>
  content?: TiptapNode[]
  marks?: TiptapMark[]
  text?: string
}

export type TiptapDocument = TiptapNode & { type: 'doc' }

export type NovelProject = {
  schemaVersion: number
  id: string
  title: string
  kind: NovelKind
  genre: string
  synopsis: string
  status: 'draft' | 'archived'
  activeUnitId: string
  unitOrder: string[]
  revision: number
  createdAt: string
  updatedAt: string
}

export type NovelProjectSummary = NovelProject & {
  unitCount: number
  wordCount: number
}

export type ManuscriptUnit = {
  schemaVersion: number
  id: string
  novelId: string
  parentId?: string
  kind: ManuscriptUnitKind
  title: string
  position: number
  summary: string
  goal: string
  wordCount: number
  content: TiptapDocument
  revision: number
  createdAt: string
  updatedAt: string
}

export type Character = {
  id: string
  name: string
  role: 'protagonist' | 'supporting' | 'important_extra'
  gender: string
  age: string
  nationality: string
  ethnicity: string
  appearance: string
  body: string
  personality: string
  biography: string
  avatarAsset?: string
  customFields: Record<string, string>
  lockedFields: string[]
  createdAt: string
  updatedAt: string
}

export type Relationship = {
  id: string
  sourceCharacterId: string
  targetCharacterId: string
  direction: 'source_to_target' | 'bidirectional'
  type: string
  description: string
  strength: number
  effectiveUnitId?: string
  clueIds: string[]
  createdAt: string
  updatedAt: string
}

export type OutlineNode = {
  id: string
  parentId?: string
  unitId?: string
  title: string
  summary: string
  intent: string
  position: number
  locked: boolean
  createdAt: string
  updatedAt: string
}

export type Clue = {
  id: string
  title: string
  description: string
  plantedUnitId: string
  plannedResolveUnitId?: string
  resolvedUnitId?: string
  status: 'planned' | 'planted' | 'resolved' | 'abandoned'
  relatedCharacterIds: string[]
  notes: string
  createdAt: string
  updatedAt: string
}

export type TextAnchor = {
  unitId: string
  blockId: string
  fromOffset: number
  toOffset: number
  sourceTextHash: string
}

export type CommentMessage = {
  id: string
  author: 'user' | 'ai'
  content: string
  createdAt: string
}

export type CommentThread = {
  id: string
  anchors: TextAnchor[]
  messages: CommentMessage[]
  status: 'open' | 'resolved' | 'orphaned'
  createdAt: string
  updatedAt: string
}

export type AiContextItem = {
  id: string
  type:
    | 'selection'
    | 'adjacent_summary'
    | 'character'
    | 'outline'
    | 'clue'
    | 'style_sample'
  label: string
  content: string
  included: boolean
}

export type AiSuggestion = {
  id: string
  unitId: string
  anchor?: TextAnchor
  mode: 'continue' | 'rewrite' | 'proofread' | 'blueprint'
  candidateIndex: number
  instruction: string
  content: string
  status: 'streaming' | 'ready' | 'stopped' | 'failed' | 'applied' | 'rejected'
  favorite: boolean
  stale: boolean
  context: AiContextItem[]
  createdAt: string
  appliedAt?: string
  error?: string
}

export type VersionedCollection<T> = {
  schemaVersion: number
  revision: number
  items: T[]
  updatedAt: string
}

export type NovelProjectBundle = {
  project: NovelProject
  units: ManuscriptUnit[]
  characters: VersionedCollection<Character>
  relationships: VersionedCollection<Relationship>
  outline: VersionedCollection<OutlineNode>
  clues: VersionedCollection<Clue>
  comments: VersionedCollection<CommentThread>
  suggestions: VersionedCollection<AiSuggestion>
}

export type CreateNovelProjectInput = {
  title: string
  kind: NovelKind
  genre?: string
  synopsis?: string
  template?: 'blank' | 'cultivation' | 'romance' | 'mystery' | 'screenplay'
  initialContent?: TiptapDocument
}

export type SaveManuscriptUnitInput = {
  novelId: string
  unit: ManuscriptUnit
  expectedRevision: number
}

export type SaveNovelCollectionInput<T> = {
  novelId: string
  items: T[]
  expectedRevision: number
  unitId?: string
}

export type NovelImportInput = {
  title?: string
  kind: NovelKind
  format: 'markdown' | 'txt' | 'docx' | 'biyan-novel'
  fileName: string
  content: string
}

export type NovelExportInput = {
  novelId: string
  format: 'markdown' | 'txt' | 'biyan-novel'
}

export type NovelExportResult = {
  fileName: string
  mimeType: string
  content: string
}

export type NovelRevision = {
  id: string
  novelId: string
  unitId: string
  revision: number
  createdAt: string
  wordCount: number
}

export type NovelServiceErrorCode =
  | 'not_found'
  | 'revision_conflict'
  | 'invalid_data'
  | 'unsupported'
  | 'storage_error'

export class NovelServiceError extends Error {
  readonly code: NovelServiceErrorCode
  readonly currentRevision?: number
  readonly outcomeUnknown: boolean

  constructor(
    code: NovelServiceErrorCode,
    message: string,
    options?: { currentRevision?: number; outcomeUnknown?: boolean }
  ) {
    super(message)
    this.name = 'NovelServiceError'
    this.code = code
    this.currentRevision = options?.currentRevision
    this.outcomeUnknown = options?.outcomeUnknown ?? false
  }
}
