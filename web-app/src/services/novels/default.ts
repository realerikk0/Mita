import { ulid } from 'ulidx'

import {
  NOVEL_SCHEMA_VERSION,
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
  type OutlineNode,
  type Relationship,
  type SaveManuscriptUnitInput,
  type SaveNovelCollectionInput,
  type TiptapDocument,
  type TiptapNode,
  type VersionedCollection,
} from '@/types/novel'
import type { NovelService } from './types'

const STORAGE_KEY = 'biyan-novels-v1'
const MAX_REVISIONS_PER_UNIT = 100

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

type StoredRevision = NovelRevision & {
  unit: ManuscriptUnit
}

type StoredNovel = {
  bundle: NovelProjectBundle
  revisions: Record<string, StoredRevision[]>
}

type NovelStorageState = {
  schemaVersion: number
  novels: Record<string, StoredNovel>
}

type CollectionKey =
  | 'characters'
  | 'relationships'
  | 'outline'
  | 'clues'
  | 'comments'
  | 'suggestions'

const memoryValues = new Map<string, string>()
const memoryStorage: StorageLike = {
  getItem: (key) => memoryValues.get(key) ?? null,
  setItem: (key, value) => {
    memoryValues.set(key, value)
  },
  removeItem: (key) => {
    memoryValues.delete(key)
  },
}

function defaultStorage(): StorageLike {
  try {
    if (typeof localStorage !== 'undefined') return localStorage
  } catch {
    // Sandboxed webviews can deny localStorage access. Keep the prototype usable
    // for the lifetime of the page in that case.
  }
  return memoryStorage
}

function emptyState(): NovelStorageState {
  return { schemaVersion: NOVEL_SCHEMA_VERSION, novels: {} }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function nowIso(): string {
  return new Date().toISOString()
}

function blankDocument(): TiptapDocument {
  return {
    type: 'doc',
    content: [{ type: 'paragraph' }],
  }
}

function emptyCollection<T>(timestamp: string): VersionedCollection<T> {
  return {
    schemaVersion: NOVEL_SCHEMA_VERSION,
    revision: 0,
    items: [],
    updatedAt: timestamp,
  }
}

function documentText(node: TiptapNode): string {
  if (node.text) return node.text
  if (node.type === 'hardBreak' || node.type === 'sceneBreak') return '\n'
  const separator = [
    'doc',
    'blockquote',
    'bulletList',
    'orderedList',
    'listItem',
  ].includes(node.type)
    ? '\n'
    : ''
  return (node.content ?? []).map(documentText).join(separator)
}

function countWords(document: TiptapDocument): number {
  const matches = documentText(document).match(
    /[\p{Script=Han}]|[\p{L}\p{N}]+/gu
  )
  return matches?.length ?? 0
}

function normalizeTitle(value: string): string {
  const title = value.trim()
  if (!title) {
    throw new NovelServiceError('invalid_data', 'Novel title is required')
  }
  return title
}

function safeFileStem(value: string): string {
  const stem = value
    .trim()
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
  return stem || 'untitled'
}

function tiptapFromPlainText(content: string): TiptapDocument {
  const paragraphs = content
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)

  return {
    type: 'doc',
    content:
      paragraphs.length > 0
        ? paragraphs.map((text) => ({
            type: 'paragraph',
            content: [{ type: 'text', text }],
          }))
        : [{ type: 'paragraph' }],
  }
}

function tiptapFromMarkdown(content: string): TiptapDocument {
  const nodes: TiptapNode[] = []
  const lines = content.replace(/\r\n?/g, '\n').split('\n')
  let paragraph: string[] = []

  const flushParagraph = () => {
    const text = paragraph.join(' ').trim()
    if (text) {
      nodes.push({
        type: 'paragraph',
        content: [{ type: 'text', text }],
      })
    }
    paragraph = []
  }

  for (const line of lines) {
    const heading = /^(#{1,3})\s+(.+)$/.exec(line)
    if (heading) {
      flushParagraph()
      nodes.push({
        type: 'heading',
        attrs: { level: heading[1].length },
        content: [{ type: 'text', text: heading[2].trim() }],
      })
      continue
    }

    const quote = /^>\s?(.+)$/.exec(line)
    if (quote) {
      flushParagraph()
      nodes.push({
        type: 'blockquote',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: quote[1].trim() }],
          },
        ],
      })
      continue
    }

    if (/^(---|\*\*\*)\s*$/.test(line.trim())) {
      flushParagraph()
      nodes.push({ type: 'sceneBreak' })
      continue
    }

    if (!line.trim()) {
      flushParagraph()
    } else {
      paragraph.push(line.trim())
    }
  }
  flushParagraph()

  return {
    type: 'doc',
    content: nodes.length > 0 ? nodes : [{ type: 'paragraph' }],
  }
}

function markdownFromNode(node: TiptapNode): string {
  if (node.text) {
    let text = node.text
    for (const mark of node.marks ?? []) {
      if (mark.type === 'bold') text = `**${text}**`
      if (mark.type === 'italic') text = `*${text}*`
      if (mark.type === 'strike') text = `~~${text}~~`
      if (mark.type === 'link' && typeof mark.attrs?.href === 'string') {
        text = `[${text}](${mark.attrs.href})`
      }
    }
    return text
  }

  const content = (node.content ?? []).map(markdownFromNode).join('')
  if (node.type === 'heading') {
    const level = Math.min(6, Math.max(1, Number(node.attrs?.level) || 1))
    return `${'#'.repeat(level)} ${content}\n\n`
  }
  if (node.type === 'paragraph') return `${content}\n\n`
  if (node.type === 'blockquote') {
    return `${content
      .trim()
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n')}\n\n`
  }
  if (node.type === 'sceneBreak') return '---\n\n'
  return content
}

function isBundle(value: unknown): value is NovelProjectBundle {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<NovelProjectBundle>
  return Boolean(
    candidate.project?.id &&
      Array.isArray(candidate.units) &&
      Array.isArray(candidate.characters?.items) &&
      Array.isArray(candidate.relationships?.items) &&
      Array.isArray(candidate.outline?.items) &&
      Array.isArray(candidate.clues?.items) &&
      Array.isArray(candidate.comments?.items) &&
      Array.isArray(candidate.suggestions?.items)
  )
}

export class DefaultNovelService implements NovelService {
  private readonly storage: StorageLike

  constructor(storage: StorageLike = defaultStorage()) {
    this.storage = storage
  }

  async listProjects(): Promise<NovelProjectSummary[]> {
    const state = this.readState()
    return Object.values(state.novels)
      .map(({ bundle }) => this.summary(bundle))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async createProject(
    input: CreateNovelProjectInput
  ): Promise<NovelProjectBundle> {
    const state = this.readState()
    const timestamp = nowIso()
    const novelId = ulid()
    const unitId = ulid()
    const title = normalizeTitle(input.title)
    const content = clone(input.initialContent ?? blankDocument())
    const unit: ManuscriptUnit = {
      schemaVersion: NOVEL_SCHEMA_VERSION,
      id: unitId,
      novelId,
      kind: input.kind === 'screenplay' ? 'scene' : 'chapter',
      title: input.kind === 'screenplay' ? '场景 1' : '第一章',
      position: 0,
      summary: '',
      goal: '',
      wordCount: countWords(content),
      content,
      revision: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    const project: NovelProject = {
      schemaVersion: NOVEL_SCHEMA_VERSION,
      id: novelId,
      title,
      kind: input.kind,
      genre: input.genre?.trim() ?? '',
      synopsis: input.synopsis?.trim() ?? '',
      status: 'draft',
      activeUnitId: unitId,
      unitOrder: [unitId],
      revision: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    const bundle: NovelProjectBundle = {
      project,
      units: [unit],
      characters: emptyCollection<Character>(timestamp),
      relationships: emptyCollection<Relationship>(timestamp),
      outline: emptyCollection<OutlineNode>(timestamp),
      clues: emptyCollection<Clue>(timestamp),
      comments: emptyCollection<CommentThread>(timestamp),
      suggestions: emptyCollection<AiSuggestion>(timestamp),
    }

    if (input.template === 'cultivation') {
      this.applyCultivationTemplate(bundle, timestamp)
    }

    state.novels[novelId] = { bundle, revisions: {} }
    this.writeState(state)
    return clone(bundle)
  }

  private applyCultivationTemplate(
    bundle: NovelProjectBundle,
    timestamp: string
  ) {
    const first = bundle.units[0]
    const chapter3Id = ulid()
    const chapter70Id = ulid()
    first.title = '第一章 雨夜照骨'
    first.summary = '铸簪师沈砚秋在雨夜得到一支能映出谎言的旧簪。'
    first.goal = '建立照骨簪能力与主角失去灵根的困境。'
    if (documentText(first.content).trim() === '') {
      first.content = tiptapFromPlainText(
        '雨打青瓦时，沈砚秋正在替死人修最后一支簪。\n\n簪面忽然映出一张不属于棺中人的脸。'
      )
      first.wordCount = countWords(first.content)
    }
    const skeletonUnit = (
      id: string,
      title: string,
      position: number,
      summary: string,
      goal: string
    ): ManuscriptUnit => ({
      schemaVersion: NOVEL_SCHEMA_VERSION,
      id,
      novelId: bundle.project.id,
      kind: 'chapter',
      title,
      position,
      summary,
      goal,
      wordCount: 0,
      content: blankDocument(),
      revision: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    bundle.units.push(
      skeletonUnit(
        chapter3Id,
        '第三章 发簪入局',
        2,
        '沈砚秋把照骨簪带入宗门试炼，第一次看见长老的谎言。',
        '埋下簪尾缺口与旧案的长期伏笔。'
      ),
      skeletonUnit(
        chapter70Id,
        '第七十章 簪照真骨',
        69,
        '簪尾缺口与旧案证词相合，沈砚秋借此反击掌门。',
        '回收第三章发簪伏笔并反转阵营关系。'
      )
    )
    bundle.project.unitOrder = bundle.units.map((item) => item.id)

    const shenId = ulid()
    const luoId = ulid()
    bundle.characters.items = [
      {
        id: shenId,
        name: '沈砚秋',
        role: 'protagonist',
        gender: '女',
        age: '十九岁',
        nationality: '昭临',
        ethnicity: '东陆人 / 黄皮肤',
        appearance: '眉眼清冷，右手虎口有铸火留下的银白伤痕',
        body: '修长偏瘦，常年锻造使肩背有力',
        personality: '克制、敏锐，对承诺近乎固执',
        biography:
          '幼时被逐出问剑宗，灵根尽毁后随养父学铸簪。她能从簪面照见谎言，却不敢相信任何誓言。',
        customFields: { 门派: '无门散修', 境界: '炼气九层', 本命器: '照骨簪' },
        lockedFields: ['name', 'biography', 'customFields.本命器'],
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: luoId,
        name: '洛无咎',
        role: 'supporting',
        gender: '男',
        age: '二十四岁',
        nationality: '昭临',
        ethnicity: '东陆人 / 黄皮肤',
        appearance: '黑衣束发，左眼下有一道极淡的剑痕',
        body: '高挑挺拔',
        personality: '表面散漫，实则善于用玩笑试探真心',
        biography:
          '问剑宗弃徒，追查十年前宗门铸器案，与沈砚秋目标一致但手段相反。',
        customFields: {
          门派: '问剑宗弃徒',
          境界: '筑基中期',
          立场: '不稳定同盟',
        },
        lockedFields: ['name'],
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ]
    bundle.relationships.items = [
      {
        id: ulid(),
        sourceCharacterId: shenId,
        targetCharacterId: luoId,
        direction: 'bidirectional',
        type: '互相利用的同盟',
        description: '共同追查旧案，但都隐瞒了一半动机。',
        strength: 64,
        effectiveUnitId: first.id,
        clueIds: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ]
    bundle.outline.items = [
      {
        id: ulid(),
        title: '核心意图：真相是否值得信任',
        summary: '一个能照见谎言的人，必须学会分辨善意的隐瞒与恶意的真话。',
        intent: '约束人物选择与结局主题',
        position: 0,
        locked: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: ulid(),
        unitId: chapter3Id,
        title: '发簪入局',
        summary: '照骨簪暴露长老证词矛盾，沈砚秋被迫进入宗门权力中心。',
        intent: '埋下第七十章反击证据',
        position: 1,
        locked: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ]
    const clueId = ulid()
    bundle.clues.items = [
      {
        id: clueId,
        title: '簪尾缺口',
        description: '第三章提到的发簪缺口，会在第七十章与旧案铸模完全吻合。',
        plantedUnitId: chapter3Id,
        plannedResolveUnitId: chapter70Id,
        status: 'planted',
        relatedCharacterIds: [shenId, luoId],
        notes: '第 3 章发簪 — 第 70 章回收，用来反击掌门。',
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ]
    bundle.relationships.items[0].clueIds = [clueId]
  }

  async openProject(novelId: string): Promise<NovelProjectBundle> {
    return clone(this.getStored(this.readState(), novelId).bundle)
  }

  async deleteProject(novelId: string): Promise<void> {
    const state = this.readState()
    this.getStored(state, novelId)
    delete state.novels[novelId]
    this.writeState(state)
  }

  async saveProject(
    project: NovelProject,
    expectedRevision: number
  ): Promise<NovelProject> {
    const state = this.readState()
    const stored = this.getStored(state, project.id)
    this.assertRevision(stored.bundle.project.revision, expectedRevision)
    if (
      project.activeUnitId &&
      !project.unitOrder.includes(project.activeUnitId)
    ) {
      throw new NovelServiceError(
        'invalid_data',
        'The active manuscript unit must be present in unitOrder'
      )
    }
    const requestedUnitIds = new Set(project.unitOrder)
    if (requestedUnitIds.size !== project.unitOrder.length) {
      throw new NovelServiceError(
        'invalid_data',
        'unitOrder cannot contain duplicate manuscript units'
      )
    }
    const currentUnitIds = new Set(stored.bundle.project.unitOrder)
    const structureIsCurrent =
      currentUnitIds.size === requestedUnitIds.size &&
      project.unitOrder.every((unitId) => currentUnitIds.has(unitId))
    const saved: NovelProject = {
      ...clone(project),
      id: stored.bundle.project.id,
      schemaVersion: NOVEL_SCHEMA_VERSION,
      createdAt: stored.bundle.project.createdAt,
      unitOrder: structureIsCurrent
        ? clone(project.unitOrder)
        : stored.bundle.project.unitOrder,
      activeUnitId: structureIsCurrent
        ? project.activeUnitId
        : stored.bundle.project.activeUnitId,
      revision: stored.bundle.project.revision + 1,
      updatedAt: nowIso(),
    }
    stored.bundle.project = saved
    this.writeState(state)
    return clone(saved)
  }

  async loadManuscriptUnit(
    novelId: string,
    unitId: string
  ): Promise<ManuscriptUnit | null> {
    const bundle = this.getStored(this.readState(), novelId).bundle
    const unit = bundle.units.find((item) => item.id === unitId)
    return unit ? clone(unit) : null
  }

  async saveManuscriptUnit(
    input: SaveManuscriptUnitInput
  ): Promise<ManuscriptUnit> {
    const state = this.readState()
    const stored = this.getStored(state, input.novelId)
    if (input.unit.novelId !== input.novelId) {
      throw new NovelServiceError(
        'invalid_data',
        'Manuscript unit belongs to another novel'
      )
    }

    const current = stored.bundle.units.find(
      (item) => item.id === input.unit.id
    )
    this.assertRevision(current?.revision ?? 0, input.expectedRevision)
    const timestamp = nowIso()
    const saved: ManuscriptUnit = {
      ...clone(input.unit),
      schemaVersion: NOVEL_SCHEMA_VERSION,
      createdAt: current?.createdAt ?? input.unit.createdAt ?? timestamp,
      updatedAt: timestamp,
      revision: (current?.revision ?? 0) + 1,
      wordCount: countWords(input.unit.content),
    }

    stored.bundle.units = current
      ? stored.bundle.units.map((item) => (item.id === saved.id ? saved : item))
      : [...stored.bundle.units, saved]
    stored.bundle.units.sort((a, b) => a.position - b.position)

    const project = stored.bundle.project
    stored.bundle.project = {
      ...project,
      activeUnitId: saved.id,
      unitOrder: project.unitOrder.includes(saved.id)
        ? project.unitOrder
        : [...project.unitOrder, saved.id],
      updatedAt: timestamp,
    }

    const revision: StoredRevision = {
      id: ulid(),
      novelId: input.novelId,
      unitId: saved.id,
      revision: saved.revision,
      createdAt: timestamp,
      wordCount: saved.wordCount,
      unit: clone(saved),
    }
    stored.revisions[saved.id] = [
      revision,
      ...(stored.revisions[saved.id] ?? []),
    ].slice(0, MAX_REVISIONS_PER_UNIT)

    this.writeState(state)
    return clone(saved)
  }

  async saveCharacters(
    input: SaveNovelCollectionInput<Character>
  ): Promise<VersionedCollection<Character>> {
    return this.saveCollection(input, 'characters')
  }

  async saveRelationships(
    input: SaveNovelCollectionInput<Relationship>
  ): Promise<VersionedCollection<Relationship>> {
    return this.saveCollection(input, 'relationships')
  }

  async saveOutline(
    input: SaveNovelCollectionInput<OutlineNode>
  ): Promise<VersionedCollection<OutlineNode>> {
    return this.saveCollection(input, 'outline')
  }

  async saveClues(
    input: SaveNovelCollectionInput<Clue>
  ): Promise<VersionedCollection<Clue>> {
    return this.saveCollection(input, 'clues')
  }

  async saveComments(
    input: SaveNovelCollectionInput<CommentThread>
  ): Promise<VersionedCollection<CommentThread>> {
    return this.saveCollection(input, 'comments')
  }

  async saveSuggestions(
    input: SaveNovelCollectionInput<AiSuggestion>
  ): Promise<VersionedCollection<AiSuggestion>> {
    const state = this.readState()
    const stored = this.getStored(state, input.novelId)
    const current = stored.bundle.suggestions
    this.assertRevision(current.revision, input.expectedRevision)
    const items = input.unitId
      ? [
          ...current.items.filter((item) => item.unitId !== input.unitId),
          ...clone(input.items),
        ]
      : clone(input.items)
    const saved: VersionedCollection<AiSuggestion> = {
      schemaVersion: NOVEL_SCHEMA_VERSION,
      revision: current.revision + 1,
      items,
      updatedAt: nowIso(),
    }
    stored.bundle.suggestions = saved
    this.writeState(state)
    return clone(saved)
  }

  async importProject(input: NovelImportInput): Promise<NovelProjectBundle> {
    if (input.format === 'docx') {
      throw new NovelServiceError(
        'unsupported',
        'DOCX import is only available in the desktop app'
      )
    }

    if (input.format === 'biyan-novel') {
      let parsed: unknown
      try {
        parsed = JSON.parse(input.content)
      } catch {
        throw new NovelServiceError('invalid_data', 'Invalid .biyan-novel file')
      }
      if (!isBundle(parsed)) {
        throw new NovelServiceError(
          'invalid_data',
          'The .biyan-novel file has an invalid structure'
        )
      }
      return this.importBundle(parsed, input.title)
    }

    const title =
      input.title?.trim() || input.fileName.replace(/\.[^.]+$/, '').trim()
    const content =
      input.format === 'markdown'
        ? tiptapFromMarkdown(input.content)
        : tiptapFromPlainText(input.content)
    return this.createProject({
      title: title || '未命名作品',
      kind: input.kind,
      initialContent: content,
    })
  }

  async exportProject(input: NovelExportInput): Promise<NovelExportResult> {
    const bundle = await this.openProject(input.novelId)
    const stem = safeFileStem(bundle.project.title)
    if (input.format === 'biyan-novel') {
      return {
        fileName: `${stem}.biyan-novel`,
        mimeType: 'application/vnd.biyan.novel+json',
        content: JSON.stringify(bundle, null, 2),
      }
    }

    const orderedUnits = this.orderedUnits(bundle)
    if (input.format === 'txt') {
      return {
        fileName: `${stem}.txt`,
        mimeType: 'text/plain;charset=utf-8',
        content: orderedUnits
          .map(
            (unit) => `${unit.title}\n\n${documentText(unit.content).trim()}`
          )
          .join('\n\n'),
      }
    }

    return {
      fileName: `${stem}.md`,
      mimeType: 'text/markdown;charset=utf-8',
      content: orderedUnits
        .map(
          (unit) =>
            `# ${unit.title}\n\n${markdownFromNode(unit.content).trim()}`
        )
        .join('\n\n'),
    }
  }

  async listRevisions(
    novelId: string,
    unitId: string
  ): Promise<NovelRevision[]> {
    const stored = this.getStored(this.readState(), novelId)
    return clone(
      (stored.revisions[unitId] ?? []).map((revision) => ({
        id: revision.id,
        novelId: revision.novelId,
        unitId: revision.unitId,
        revision: revision.revision,
        createdAt: revision.createdAt,
        wordCount: revision.wordCount,
      }))
    )
  }

  async restoreRevision(
    novelId: string,
    unitId: string,
    revisionId: string,
    expectedRevision: number
  ): Promise<ManuscriptUnit> {
    const stored = this.getStored(this.readState(), novelId)
    const current = stored.bundle.units.find((unit) => unit.id === unitId)
    if (!current) {
      throw new NovelServiceError('not_found', 'Manuscript unit not found')
    }
    this.assertRevision(current.revision, expectedRevision)
    const snapshot = (stored.revisions[unitId] ?? []).find(
      (revision) => revision.id === revisionId
    )
    if (!snapshot) {
      throw new NovelServiceError('not_found', 'Novel revision not found')
    }
    return this.saveManuscriptUnit({
      novelId,
      unit: { ...clone(snapshot.unit), revision: current.revision },
      expectedRevision,
    })
  }

  private readState(): NovelStorageState {
    const raw = this.storage.getItem(STORAGE_KEY)
    if (!raw) return emptyState()
    try {
      const parsed = JSON.parse(raw) as Partial<NovelStorageState>
      if (!parsed.novels || typeof parsed.novels !== 'object') {
        throw new Error('missing novels map')
      }
      return {
        schemaVersion: NOVEL_SCHEMA_VERSION,
        novels: parsed.novels,
      }
    } catch (error) {
      throw new NovelServiceError(
        'storage_error',
        `Failed to read local novel storage: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  private writeState(state: NovelStorageState): void {
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch (error) {
      throw new NovelServiceError(
        'storage_error',
        `Failed to write local novel storage: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  private getStored(state: NovelStorageState, novelId: string): StoredNovel {
    const stored = state.novels[novelId]
    if (!stored) {
      throw new NovelServiceError('not_found', 'Novel project not found')
    }
    return stored
  }

  private assertRevision(current: number, expected: number): void {
    if (current !== expected) {
      throw new NovelServiceError(
        'revision_conflict',
        `Expected revision ${expected}, but current revision is ${current}`,
        { currentRevision: current }
      )
    }
  }

  private summary(bundle: NovelProjectBundle): NovelProjectSummary {
    return {
      ...clone(bundle.project),
      unitCount: bundle.units.length,
      wordCount: bundle.units.reduce(
        (total, unit) => total + unit.wordCount,
        0
      ),
    }
  }

  private orderedUnits(bundle: NovelProjectBundle): ManuscriptUnit[] {
    const order = new Map(
      bundle.project.unitOrder.map((unitId, index) => [unitId, index])
    )
    return [...bundle.units].sort(
      (a, b) =>
        (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
          (order.get(b.id) ?? Number.MAX_SAFE_INTEGER) ||
        a.position - b.position
    )
  }

  private async saveCollection<T>(
    input: SaveNovelCollectionInput<T>,
    key: CollectionKey
  ): Promise<VersionedCollection<T>> {
    const state = this.readState()
    const stored = this.getStored(state, input.novelId)
    const collections = stored.bundle as unknown as Record<
      CollectionKey,
      VersionedCollection<unknown>
    >
    const current = collections[key]
    this.assertRevision(current.revision, input.expectedRevision)
    const saved: VersionedCollection<T> = {
      schemaVersion: NOVEL_SCHEMA_VERSION,
      revision: current.revision + 1,
      items: clone(input.items),
      updatedAt: nowIso(),
    }
    collections[key] = saved as VersionedCollection<unknown>
    this.writeState(state)
    return clone(saved)
  }

  private importBundle(
    source: NovelProjectBundle,
    titleOverride?: string
  ): NovelProjectBundle {
    const state = this.readState()
    const timestamp = nowIso()
    const novelId = ulid()
    const unitIdMap = new Map(source.units.map((unit) => [unit.id, ulid()]))
    const units = source.units.map((unit) => ({
      ...clone(unit),
      id: unitIdMap.get(unit.id)!,
      novelId,
      parentId: unit.parentId ? unitIdMap.get(unit.parentId) : undefined,
      revision: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    }))
    const fallbackUnitId = units[0]?.id
    if (!fallbackUnitId) {
      throw new NovelServiceError(
        'invalid_data',
        'A novel archive must contain at least one manuscript unit'
      )
    }
    const mapUnitId = (id?: string) =>
      id ? (unitIdMap.get(id) ?? id) : undefined
    const bundle: NovelProjectBundle = {
      ...clone(source),
      project: {
        ...clone(source.project),
        id: novelId,
        title: normalizeTitle(titleOverride ?? source.project.title),
        activeUnitId:
          unitIdMap.get(source.project.activeUnitId) ?? fallbackUnitId,
        unitOrder: source.project.unitOrder
          .map((id) => unitIdMap.get(id))
          .filter((id): id is string => Boolean(id)),
        revision: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      units,
      relationships: {
        ...clone(source.relationships),
        items: source.relationships.items.map((relationship) => ({
          ...clone(relationship),
          effectiveUnitId: mapUnitId(relationship.effectiveUnitId),
        })),
      },
      outline: {
        ...clone(source.outline),
        items: source.outline.items.map((node) => ({
          ...clone(node),
          unitId: mapUnitId(node.unitId),
        })),
      },
      clues: {
        ...clone(source.clues),
        items: source.clues.items.map((clue) => ({
          ...clone(clue),
          plantedUnitId: mapUnitId(clue.plantedUnitId) ?? clue.plantedUnitId,
          plannedResolveUnitId: mapUnitId(clue.plannedResolveUnitId),
          resolvedUnitId: mapUnitId(clue.resolvedUnitId),
        })),
      },
      comments: {
        ...clone(source.comments),
        items: source.comments.items.map((thread) => ({
          ...clone(thread),
          anchors: thread.anchors.map((anchor) => ({
            ...clone(anchor),
            unitId: mapUnitId(anchor.unitId) ?? anchor.unitId,
          })),
        })),
      },
      suggestions: {
        ...clone(source.suggestions),
        revision: 0,
        updatedAt: timestamp,
        items: source.suggestions.items.map((suggestion) => ({
          ...clone(suggestion),
          unitId: mapUnitId(suggestion.unitId) ?? suggestion.unitId,
          anchor: suggestion.anchor
            ? {
                ...clone(suggestion.anchor),
                unitId:
                  mapUnitId(suggestion.anchor.unitId) ?? suggestion.anchor.unitId,
              }
            : undefined,
        })),
      },
    }
    state.novels[novelId] = { bundle, revisions: {} }
    this.writeState(state)
    return clone(bundle)
  }
}
