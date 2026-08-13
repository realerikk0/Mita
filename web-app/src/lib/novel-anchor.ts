import type {
  Node as ProseMirrorNode,
  Slice as ProseMirrorSlice,
} from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import type { TextAnchor, TiptapDocument, TiptapNode } from '@/types/novel'

export type TextAnchorFailureReason =
  | 'unit-mismatch'
  | 'block-missing'
  | 'invalid-range'
  | 'source-changed'

export type TextAnchorValidation =
  | {
      valid: true
      sourceText: string
      blockText: string
    }
  | {
      valid: false
      stale: boolean
      reason: TextAnchorFailureReason
      sourceText?: string
      blockText?: string
    }

export type ResolvedTextAnchor =
  | {
      valid: true
      from: number
      to: number
      sourceText: string
      blockText: string
    }
  | {
      valid: false
      stale: boolean
      reason: TextAnchorFailureReason
      sourceText?: string
      blockText?: string
    }

const FNV_64_OFFSET_BASIS = 0xcbf29ce484222325n
const FNV_64_PRIME = 0x100000001b3n
const UINT_64_MASK = 0xffffffffffffffffn

/** Stable, synchronous UTF-8 hash used only for optimistic stale detection. */
export function hashNovelText(value: string) {
  let hash = FNV_64_OFFSET_BASIS
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte)
    hash = (hash * FNV_64_PRIME) & UINT_64_MASK
  }
  return `fnv1a64:${hash.toString(16).padStart(16, '0')}`
}

export function createTextAnchor({
  unitId,
  blockId,
  blockText,
  fromOffset,
  toOffset,
}: {
  unitId: string
  blockId: string
  blockText: string
  fromOffset: number
  toOffset: number
}): TextAnchor {
  if (!unitId.trim()) throw new Error('TextAnchor requires a unitId.')
  if (!blockId.trim()) throw new Error('TextAnchor requires a blockId.')
  if (
    !Number.isInteger(fromOffset) ||
    !Number.isInteger(toOffset) ||
    fromOffset < 0 ||
    toOffset < fromOffset ||
    toOffset > blockText.length
  ) {
    throw new RangeError('TextAnchor offsets are outside of the source block.')
  }

  return {
    unitId,
    blockId,
    fromOffset,
    toOffset,
    // A collapsed continuation anchor has no selected source to hash. In that
    // case hash the whole block so edits made while AI is generating mark the
    // insertion point stale instead of silently shifting it.
    sourceTextHash: hashNovelText(
      fromOffset === toOffset
        ? blockText
        : blockText.slice(fromOffset, toOffset)
    ),
  }
}

export function validateTextAnchor(
  anchor: TextAnchor,
  blockText: string,
  unitId = anchor.unitId
): TextAnchorValidation {
  if (unitId !== anchor.unitId) {
    return { valid: false, stale: true, reason: 'unit-mismatch' }
  }
  if (
    !Number.isInteger(anchor.fromOffset) ||
    !Number.isInteger(anchor.toOffset) ||
    anchor.fromOffset < 0 ||
    anchor.toOffset < anchor.fromOffset ||
    anchor.toOffset > blockText.length
  ) {
    return {
      valid: false,
      stale: true,
      reason: 'invalid-range',
      blockText,
    }
  }

  const sourceText = blockText.slice(anchor.fromOffset, anchor.toOffset)
  const hashSource =
    anchor.fromOffset === anchor.toOffset ? blockText : sourceText
  if (hashNovelText(hashSource) !== anchor.sourceTextHash) {
    return {
      valid: false,
      stale: true,
      reason: 'source-changed',
      sourceText,
      blockText,
    }
  }

  return { valid: true, sourceText, blockText }
}

export function isTextAnchorStale(
  anchor: TextAnchor,
  blockText: string,
  unitId = anchor.unitId
) {
  return !validateTextAnchor(anchor, blockText, unitId).valid
}

export function applyTextAnchorReplacement(
  anchor: TextAnchor,
  blockText: string,
  replacement: string,
  unitId = anchor.unitId
):
  | { applied: true; text: string }
  | {
      applied: false
      text: string
      stale: boolean
      reason: TextAnchorFailureReason
    } {
  const validation = validateTextAnchor(anchor, blockText, unitId)
  if (!validation.valid) {
    return {
      applied: false,
      text: blockText,
      stale: validation.stale,
      reason: validation.reason,
    }
  }

  return {
    applied: true,
    text:
      blockText.slice(0, anchor.fromOffset) +
      replacement +
      blockText.slice(anchor.toOffset),
  }
}

export function tiptapNodeText(node: TiptapNode): string {
  if (node.type === 'text') return node.text ?? ''
  if (node.type === 'hardBreak') return '\n'
  return (node.content ?? []).map(tiptapNodeText).join('')
}

export function findTiptapBlockById(
  document: TiptapDocument,
  blockId: string
): TiptapNode | undefined {
  const pending: TiptapNode[] = [...(document.content ?? [])]
  while (pending.length > 0) {
    const node = pending.shift()!
    if (node.attrs?.id === blockId) return node
    pending.unshift(...(node.content ?? []))
  }
  return undefined
}

export function validateTextAnchorInDocument(
  anchor: TextAnchor,
  document: TiptapDocument,
  unitId = anchor.unitId
): TextAnchorValidation {
  if (unitId !== anchor.unitId) {
    return { valid: false, stale: true, reason: 'unit-mismatch' }
  }
  const block = findTiptapBlockById(document, anchor.blockId)
  if (!block) {
    return { valid: false, stale: true, reason: 'block-missing' }
  }
  return validateTextAnchor(anchor, tiptapNodeText(block), unitId)
}

/** Resolve a stable block-relative anchor into current ProseMirror positions. */
export function resolveTextAnchor(
  document: ProseMirrorNode,
  anchor: TextAnchor,
  unitId = anchor.unitId
): ResolvedTextAnchor {
  if (unitId !== anchor.unitId) {
    return { valid: false, stale: true, reason: 'unit-mismatch' }
  }

  let block: ProseMirrorNode | undefined
  let blockPosition = -1
  document.descendants((node, position) => {
    if (block) return false
    if (node.isTextblock && node.attrs.id === anchor.blockId) {
      block = node
      blockPosition = position
      return false
    }
    return true
  })

  if (!block) {
    return { valid: false, stale: true, reason: 'block-missing' }
  }

  const blockText = block.textBetween(0, block.content.size, '\n', '\n')
  const validation = validateTextAnchor(anchor, blockText, unitId)
  if (!validation.valid) return validation

  // Marks do not change ProseMirror offsets. The only enabled inline atom is a
  // hard break; textBetween represents it as one newline, matching nodeSize 1.
  return {
    valid: true,
    from: blockPosition + 1 + anchor.fromOffset,
    to: blockPosition + 1 + anchor.toOffset,
    sourceText: validation.sourceText,
    blockText,
  }
}

/** Apply only after the anchor hash has been revalidated against the transaction. */
export function applyTextAnchorToTransaction(
  transaction: Transaction,
  anchor: TextAnchor,
  replacement: string | ProseMirrorSlice,
  unitId = anchor.unitId
): ResolvedTextAnchor {
  const resolved = resolveTextAnchor(transaction.doc, anchor, unitId)
  if (!resolved.valid) return resolved
  if (typeof replacement === 'string') {
    transaction.insertText(replacement, resolved.from, resolved.to)
  } else {
    // An open slice lets its first and last paragraphs merge with the text on
    // either side of the anchor, matching normal ProseMirror paste semantics.
    transaction.replaceRange(resolved.from, resolved.to, replacement)
  }
  return resolved
}
