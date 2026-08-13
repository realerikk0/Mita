import { Editor, type Content } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import {
  countNovelWords,
  createNovelExtensions,
  cursorToTextAnchor,
  replaceTextAnchor,
  selectionToTextAnchor,
  validateTextAnchor,
} from '@/lib/novel-editor'

const editors: Editor[] = []

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy())
})

function editorWithContent(content: Content) {
  let nextId = 0
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: createNovelExtensions({
      generateBlockId: () => `block-${++nextId}`,
    }),
    content,
  })
  editors.push(editor)
  return editor
}

describe('createNovelExtensions', () => {
  it('counts Chinese characters and Latin tokens for manuscript stats', () => {
    expect(countNovelWords('雨落发簪。 Chapter 70')).toBe(6)
  })

  it('keeps a minimal schema and installs stable IDs plus comment anchors', async () => {
    const editor = editorWithContent('<p>雨落在发簪上。</p>')
    const names = new Set(
      editor.extensionManager.extensions.map((value) => value.name)
    )

    expect(names).toContain('uniqueID')
    expect(names).toContain('commentAnchor')
    expect(names).toContain('characterCount')
    expect(names).toContain('novelProofing')
    expect(names).not.toContain('code')
    expect(names).not.toContain('codeBlock')
    expect(names).toContain('hardBreak')
    expect(names).toContain('sceneBreak')
    expect(names).toContain('strike')
    expect(names).toContain('underline')
    expect(names).not.toContain('image')
    expect(names).not.toContain('table')

    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    const paragraph = editor.getJSON().content?.[0]
    expect(paragraph?.attrs?.id).toBe('block-1')
  })

  it('serializes lightweight comment marks into editor JSON', () => {
    const editor = editorWithContent('<p>发簪</p>')
    editor.commands.setTextSelection({ from: 1, to: 3 })
    editor.commands.setCommentAnchor('comment-1')

    expect(editor.getJSON().content?.[0]?.content?.[0]?.marks).toEqual([
      { type: 'commentAnchor', attrs: { threadId: 'comment-1' } },
    ])
  })

  it('inserts a semantic scene break that remains undoable', () => {
    const editor = editorWithContent('<p>第一场</p>')
    editor.commands.setTextSelection(4)
    editor.chain().insertContent({ type: 'sceneBreak' }).run()

    expect(
      editor.getJSON().content?.some((node) => node.type === 'sceneBreak')
    ).toBe(true)
    expect(editor.commands.undo()).toBe(true)
    expect(
      editor.getJSON().content?.some((node) => node.type === 'sceneBreak')
    ).toBe(false)
  })

  it('underlines local punctuation issues without changing editor text', () => {
    const editor = editorWithContent('<p>雨落,,发簪。。</p>')
    const original = editor.getText()
    const warnings = editor.view.dom.querySelectorAll('.novel-proofing-warning')

    expect(warnings.length).toBeGreaterThan(0)
    expect(editor.getText()).toBe(original)
  })
})

describe('editor text anchors', () => {
  it('creates a block-relative anchor for a selection', async () => {
    const editor = editorWithContent('<p>甲乙丙丁</p>')
    editor.commands.setTextSelection({ from: 2, to: 4 })

    const selected = await selectionToTextAnchor(editor, 'chapter-1')
    expect(selected).toMatchObject({
      anchor: {
        unitId: 'chapter-1',
        blockId: 'block-1',
        fromOffset: 1,
        toOffset: 3,
      },
      selectedText: '乙丙',
    })
  })

  it('does not anchor a selection spanning multiple blocks', async () => {
    const editor = editorWithContent('<p>第一段</p><p>第二段</p>')
    editor.commands.setTextSelection({ from: 2, to: 8 })
    expect(await selectionToTextAnchor(editor, 'chapter-1')).toBeNull()
  })

  it('validates, applies once, then treats the old anchor as stale', async () => {
    const editor = editorWithContent('<p>她放下发簪。</p>')
    editor.commands.setTextSelection({ from: 2, to: 6 })
    const selected = await selectionToTextAnchor(editor, 'chapter-70')
    expect(selected).not.toBeNull()

    const anchor = selected!.anchor
    expect(await validateTextAnchor(editor, anchor)).toBe(true)
    expect(await replaceTextAnchor(editor, anchor, '掷出发簪')).toBe(true)
    expect(editor.getText()).toBe('她掷出发簪。')
    expect(await validateTextAnchor(editor, anchor)).toBe(false)
    expect(await replaceTextAnchor(editor, anchor, '藏起发簪')).toBe(false)

    expect(editor.commands.undo()).toBe(true)
    expect(editor.getText()).toBe('她放下发簪。')
  })

  it('keeps AI continuation at its generated cursor even after selection moves', async () => {
    const editor = editorWithContent('<p>甲乙丙丁</p>')
    editor.commands.setTextSelection(3)
    const anchor = await cursorToTextAnchor(editor, 'chapter-1')
    expect(anchor).toMatchObject({ fromOffset: 2, toOffset: 2 })

    editor.commands.setTextSelection({ from: 1, to: 2 })
    expect(await replaceTextAnchor(editor, anchor!, '续')).toBe(true)
    expect(editor.getText()).toBe('甲乙续丙丁')
  })

  it('keeps multi-paragraph AI output as separate addressable blocks', async () => {
    const editor = editorWithContent('<p>开头</p>')
    editor.commands.setTextSelection(3)
    const anchor = await cursorToTextAnchor(editor, 'chapter-1')

    expect(await replaceTextAnchor(editor, anchor!, '第一段\n\n第二段')).toBe(
      true
    )
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    const paragraphs = editor
      .getJSON()
      .content?.filter((node) => node.type === 'paragraph')
    expect(paragraphs).toHaveLength(2)
    expect(paragraphs?.map((node) => node.attrs?.id)).toEqual([
      'block-1',
      'block-2',
    ])
    expect(editor.getText({ blockSeparator: '\n\n' })).toBe(
      '开头第一段\n\n第二段'
    )
    expect(editor.commands.undo()).toBe(true)
    expect(editor.getText({ blockSeparator: '\n\n' })).toBe('开头')
    expect(editor.getJSON().content?.[0]?.attrs?.id).toBe('block-1')
  })

  it('merges a multi-paragraph continuation around a middle cursor', async () => {
    const editor = editorWithContent('<p>甲乙</p>')
    editor.commands.setTextSelection(2)
    const anchor = await cursorToTextAnchor(editor, 'chapter-1')

    expect(await replaceTextAnchor(editor, anchor!, '第一段\n\n第二段')).toBe(
      true
    )
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(editor.getText({ blockSeparator: '\n\n' })).toBe(
      '甲第一段\n\n第二段乙'
    )
    expect(editor.getJSON().content?.map((node) => node.attrs?.id)).toEqual([
      'block-1',
      'block-2',
    ])
    expect(editor.commands.undo()).toBe(true)
    expect(editor.getText()).toBe('甲乙')
  })

  it('replaces an empty paragraph with addressable AI paragraphs in one undo', async () => {
    const editor = editorWithContent('<p></p>')
    editor.commands.setTextSelection(1)
    const anchor = await cursorToTextAnchor(editor, 'chapter-1')

    expect(await replaceTextAnchor(editor, anchor!, '第一段\n\n第二段')).toBe(
      true
    )
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(editor.getText({ blockSeparator: '\n\n' })).toBe('第一段\n\n第二段')
    expect(editor.getJSON().content?.map((node) => node.attrs?.id)).toEqual([
      'block-1',
      'block-2',
    ])
    expect(editor.commands.undo()).toBe(true)
    expect(editor.getText()).toBe('')
    expect(editor.getJSON().content?.[0]?.attrs?.id).toBe('block-1')
  })

  it('does not dispatch a multi-paragraph replacement for a stale selection', async () => {
    const editor = editorWithContent('<p>甲乙丙</p>')
    editor.commands.setTextSelection({ from: 2, to: 3 })
    const selected = await selectionToTextAnchor(editor, 'chapter-1')
    expect(selected?.selectedText).toBe('乙')
    editor.commands.insertContentAt({ from: 2, to: 3 }, '改')
    const changed = editor.getJSON()

    expect(
      await replaceTextAnchor(editor, selected!.anchor, '第一段\n\n第二段')
    ).toBe(false)
    expect(editor.getJSON()).toEqual(changed)
  })
})
