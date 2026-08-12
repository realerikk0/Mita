import { describe, expect, it } from 'vitest'
import {
  applyTextAnchorReplacement,
  createTextAnchor,
  findTiptapBlockById,
  hashNovelText,
  validateTextAnchor,
  validateTextAnchorInDocument,
} from '@/lib/novel-anchor'
import type { TiptapDocument } from '@/types/novel'

const document: TiptapDocument = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      attrs: { id: 'block-a' },
      content: [{ type: 'text', text: '他没有回头。' }],
    },
    {
      type: 'paragraph',
      attrs: { id: 'block-b' },
      content: [{ type: 'text', text: '他没有回头。' }],
    },
  ],
}

describe('novel text anchors', () => {
  it('hashes Unicode text deterministically and without normalization', () => {
    expect(hashNovelText('发簪')).toBe(hashNovelText('发簪'))
    expect(hashNovelText('发簪')).not.toBe(hashNovelText('髪簪'))
  })

  it('uses a stable block id when visible text is duplicated', () => {
    const block = findTiptapBlockById(document, 'block-b')!
    const blockText = block.content?.[0]?.text ?? ''
    const anchor = createTextAnchor({
      unitId: 'chapter-3',
      blockId: 'block-b',
      blockText,
      fromOffset: 0,
      toOffset: 1,
    })

    expect(validateTextAnchorInDocument(anchor, document)).toMatchObject({
      valid: true,
      sourceText: '他',
    })
  })

  it('marks the anchor stale when the selected source changes', () => {
    const anchor = createTextAnchor({
      unitId: 'chapter-3',
      blockId: 'block-a',
      blockText: '发簪落在雨里',
      fromOffset: 0,
      toOffset: 2,
    })

    expect(validateTextAnchor(anchor, '玉簪落在雨里')).toMatchObject({
      valid: false,
      stale: true,
      reason: 'source-changed',
    })
  })

  it('applies a replacement only while the source hash matches', () => {
    const original = '她放下发簪。'
    const anchor = createTextAnchor({
      unitId: 'chapter-70',
      blockId: 'block-final',
      blockText: original,
      fromOffset: 1,
      toOffset: 5,
    })

    expect(applyTextAnchorReplacement(anchor, original, '掷出发簪')).toEqual({
      applied: true,
      text: '她掷出发簪。',
    })
    expect(
      applyTextAnchorReplacement(anchor, '她收起发簪。', '掷出发簪')
    ).toMatchObject({
      applied: false,
      text: '她收起发簪。',
      reason: 'source-changed',
    })
  })

  it('rejects invalid ranges at creation time', () => {
    expect(() =>
      createTextAnchor({
        unitId: 'chapter-1',
        blockId: 'block-a',
        blockText: '短句',
        fromOffset: 0,
        toOffset: 3,
      })
    ).toThrow(RangeError)
  })
})
