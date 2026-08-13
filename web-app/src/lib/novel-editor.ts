import {
  Extension,
  Mark,
  Node,
  mergeAttributes,
  type Editor,
  type Extensions,
} from '@tiptap/core'
import { Fragment, Slice } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import CharacterCount from '@tiptap/extension-character-count'
import Highlight from '@tiptap/extension-highlight'
import Placeholder from '@tiptap/extension-placeholder'
import UniqueID from '@tiptap/extension-unique-id'
import StarterKit from '@tiptap/starter-kit'
import { generateId } from 'ai'
import { proofNovelText } from '@/lib/novel-proofing'
import type { TextAnchor } from '@/types/novel'
import {
  applyTextAnchorToTransaction,
  createTextAnchor,
  resolveTextAnchor,
} from '@/lib/novel-anchor'

export type CommentAnchorAttributes = {
  threadId: string | null
}

/** Count each Han character and each Latin/number token as one writing word. */
export function countNovelWords(text: string): number {
  return text.match(/[\p{Script=Han}]|[\p{L}\p{N}]+/gu)?.length ?? 0
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    commentAnchor: {
      setCommentAnchor: (threadId: string) => ReturnType
      unsetCommentAnchor: () => ReturnType
    }
  }
}

/** Lightweight local comment mark; threads themselves are persisted separately. */
export const CommentAnchor = Mark.create({
  name: 'commentAnchor',
  inclusive: false,

  addAttributes() {
    return {
      threadId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-comment-thread-id'),
        renderHTML: (attributes: CommentAnchorAttributes) =>
          attributes.threadId
            ? { 'data-comment-thread-id': attributes.threadId }
            : {},
      },
    }
  },

  parseHTML() {
    return [{ tag: 'mark[data-comment-thread-id]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'mark',
      mergeAttributes(HTMLAttributes, { 'data-novel-comment-anchor': '' }),
      0,
    ]
  },

  addCommands() {
    return {
      setCommentAnchor:
        (threadId) =>
        ({ commands }) =>
          commands.setMark(this.name, { threadId }),
      unsetCommentAnchor:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    }
  },
})

/** Semantic scene separator kept distinct from a general-purpose horizontal rule. */
export const SceneBreak = Node.create({
  name: 'sceneBreak',
  group: 'block',
  atom: true,

  parseHTML() {
    return [{ tag: 'hr[data-novel-scene-break]' }]
  },

  renderHTML() {
    return [
      'hr',
      {
        'data-novel-scene-break': '',
        'class': 'my-8 border-0 text-center',
      },
    ]
  },
})

const proofingPluginKey = new PluginKey<DecorationSet>('novelProofing')

function proofingDecorations(doc: Editor['state']['doc']) {
  const decorations: Decoration[] = []
  doc.descendants((node, position) => {
    if (!node.isTextblock) return true
    const text = node.textBetween(0, node.content.size, '\n', '\n')
    for (const issue of proofNovelText(text)) {
      decorations.push(
        Decoration.inline(position + 1 + issue.from, position + 1 + issue.to, {
          'class': 'novel-proofing-warning',
          'title': issue.message,
          'data-proofing-issue': issue.code,
        })
      )
    }
    return false
  })
  return DecorationSet.create(doc, decorations)
}

/** Local-only deterministic proofing marks. It never changes manuscript text. */
export const NovelProofing = Extension.create({
  name: 'novelProofing',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: proofingPluginKey,
        state: {
          init: (_, state) => proofingDecorations(state.doc),
          apply: (transaction, current) =>
            transaction.docChanged
              ? proofingDecorations(transaction.doc)
              : current.map(transaction.mapping, transaction.doc),
        },
        props: {
          decorations: (state) => proofingPluginKey.getState(state) ?? null,
        },
      }),
    ]
  },
})

/**
 * Minimal writing schema. Images, tables, code/code blocks and collaboration
 * are intentionally absent; every addressable text block receives a stable ID.
 */
export function createNovelExtensions({
  placeholder = '从这里开始写作…',
  generateBlockId = () => generateId(),
}: {
  placeholder?: string
  generateBlockId?: () => string
} = {}): Extensions {
  return [
    StarterKit.configure({
      code: false,
      codeBlock: false,
      horizontalRule: false,
      heading: { levels: [1, 2, 3] },
      link: {
        openOnClick: false,
        autolink: false,
        defaultProtocol: 'https',
      },
    }),
    SceneBreak,
    Highlight.configure({ multicolor: false }),
    Placeholder.configure({ placeholder }),
    CharacterCount,
    NovelProofing,
    UniqueID.configure({
      attributeName: 'id',
      types: ['paragraph', 'heading', 'blockquote', 'listItem'],
      generateID: generateBlockId,
    }),
    CommentAnchor,
  ]
}

function findAddressableBlockAtSelection(editor: Editor) {
  const { $from, $to } = editor.state.selection
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth)
    const blockId = node.attrs.id
    if (!node.isTextblock || typeof blockId !== 'string' || !blockId) continue
    const blockStart = $from.start(depth)
    const blockEnd = $from.end(depth)
    if ($to.pos > blockEnd) return null
    return { node, blockId, blockStart }
  }
  return null
}

export async function selectionToTextAnchor(
  editor: Editor,
  unitId: string
): Promise<{ anchor: TextAnchor; selectedText: string } | null> {
  const selection = editor.state.selection
  if (selection.empty || !unitId.trim()) return null
  const block = await addressableBlockAtSelection(editor)
  if (!block) return null

  const fromOffset = selection.from - block.blockStart
  const toOffset = selection.to - block.blockStart
  const blockText = block.node.textBetween(
    0,
    block.node.content.size,
    '\n',
    '\n'
  )
  if (fromOffset < 0 || toOffset > blockText.length) return null
  const selectedText = blockText.slice(fromOffset, toOffset)
  if (!selectedText) return null

  return {
    anchor: createTextAnchor({
      unitId,
      blockId: block.blockId,
      blockText,
      fromOffset,
      toOffset,
    }),
    selectedText,
  }
}

async function addressableBlockAtSelection(editor: Editor) {
  let block = findAddressableBlockAtSelection(editor)
  if (!block) {
    // Tiptap intentionally defers extension onCreate hooks by one task. Let
    // UniqueID finish its initial, history-free ID pass when selection happens
    // immediately after an editor is constructed.
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    block = findAddressableBlockAtSelection(editor)
  }
  return block
}

/** Capture a collapsed insertion point for AI continuation candidates. */
export async function cursorToTextAnchor(
  editor: Editor,
  unitId: string
): Promise<TextAnchor | null> {
  const selection = editor.state.selection
  if (!selection.empty || !unitId.trim()) return null
  const block = await addressableBlockAtSelection(editor)
  if (!block) return null

  const fromOffset = selection.from - block.blockStart
  const blockText = block.node.textBetween(
    0,
    block.node.content.size,
    '\n',
    '\n'
  )
  if (fromOffset < 0 || fromOffset > blockText.length) return null

  return createTextAnchor({
    unitId,
    blockId: block.blockId,
    blockText,
    fromOffset,
    toOffset: fromOffset,
  })
}

export async function validateTextAnchor(
  editor: Editor,
  anchor: TextAnchor
): Promise<boolean> {
  return resolveTextAnchor(editor.state.doc, anchor).valid
}

/** Candidate acceptance is a single transaction and therefore one undo step. */
export async function replaceTextAnchor(
  editor: Editor,
  anchor: TextAnchor,
  text: string
): Promise<boolean> {
  const transaction = editor.state.tr
  const paragraphs = text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
  const replacement =
    paragraphs.length > 1
      ? new Slice(
          Fragment.fromArray(
            paragraphs.map((paragraph) =>
              editor.schema.nodes.paragraph.create(
                null,
                editor.schema.text(paragraph)
              )
            )
          ),
          1,
          1
        )
      : text
  const resolved = applyTextAnchorToTransaction(
    transaction,
    anchor,
    replacement
  )
  if (!resolved.valid) return false
  editor.view.dispatch(transaction)
  return true
}
