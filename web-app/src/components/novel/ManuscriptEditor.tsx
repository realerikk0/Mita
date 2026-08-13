import { useEffect, useMemo, useRef } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import {
  Bold,
  BookMarked,
  Highlighter,
  Italic,
  MessageSquareText,
  SeparatorHorizontal,
  Sparkles,
  Strikethrough,
  Underline,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { countNovelWords, createNovelExtensions } from '@/lib/novel-editor'
import type { TiptapDocument } from '@/types/novel'
import '@/styles/novel.css'

type Props = {
  content: TiptapDocument
  editable?: boolean
  onReady?: (editor: Editor | null) => void
  onChange: (content: TiptapDocument, wordCount: number) => void
  onTuneSelection: () => void
  onCommentSelection: () => void
  onAddToSynopsis: () => void
  onBlur?: () => void
}

export function ManuscriptEditor({
  content,
  editable = true,
  onReady,
  onChange,
  onTuneSelection,
  onCommentSelection,
  onAddToSynopsis,
  onBlur,
}: Props) {
  const extensions = useMemo(() => createNovelExtensions(), [])
  const contentRef = useRef(JSON.stringify(content))
  const editor = useEditor({
    immediatelyRender: false,
    editable,
    extensions,
    content,
    editorProps: {
      attributes: {
        'class': 'mx-auto w-full max-w-[42rem] px-6 pb-40 pt-8 sm:px-10',
        'spellcheck': 'true',
        'aria-label': '小说正文编辑器',
      },
    },
    onUpdate: ({ editor: current }) => {
      const currentContent = current.getJSON() as TiptapDocument
      const serialized = JSON.stringify(currentContent)
      if (serialized === contentRef.current) return
      contentRef.current = serialized
      onChange(currentContent, countNovelWords(current.getText()))
    },
    onBlur,
  })

  useEffect(() => {
    if (!editor) {
      return
    }
    onReady?.(editor)
    return () => onReady?.(null)
  }, [editor, onReady])

  useEffect(() => {
    editor?.setEditable(editable)
  }, [editable, editor])

  useEffect(() => {
    if (!editor) return
    const incoming = JSON.stringify(content)
    const current = JSON.stringify(editor.getJSON())
    if (incoming !== current) {
      contentRef.current = incoming
      editor.commands.setContent(content, { emitUpdate: false })
    } else {
      contentRef.current = current
    }
  }, [content, editor])

  if (!editor) {
    return <div className="h-full animate-pulse bg-muted/20" />
  }

  return (
    <div
      className="novel-editor relative h-full overflow-y-auto bg-background"
      onBlur={onBlur}
    >
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        className="absolute right-3 top-3 z-10 opacity-60 hover:opacity-100"
        aria-label="插入场景分隔"
        title="插入场景分隔"
        onClick={() =>
          editor.chain().focus().insertContent({ type: 'sceneBreak' }).run()
        }
      >
        <SeparatorHorizontal />
      </Button>
      <BubbleMenu
        editor={editor}
        shouldShow={({ editor: current }) => !current.state.selection.empty}
        options={{ placement: 'top', offset: 8 }}
        className="flex items-center gap-0.5 rounded-full border bg-background/95 p-1 shadow-lg backdrop-blur"
      >
        <Button
          type="button"
          size="icon-xs"
          variant={editor.isActive('bold') ? 'secondary' : 'ghost'}
          aria-label="粗体"
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold />
        </Button>
        <Button
          type="button"
          size="icon-xs"
          variant={editor.isActive('italic') ? 'secondary' : 'ghost'}
          aria-label="斜体"
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic />
        </Button>
        <Button
          type="button"
          size="icon-xs"
          variant={editor.isActive('underline') ? 'secondary' : 'ghost'}
          aria-label="下划线"
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        >
          <Underline />
        </Button>
        <Button
          type="button"
          size="icon-xs"
          variant={editor.isActive('strike') ? 'secondary' : 'ghost'}
          aria-label="删除线"
          onClick={() => editor.chain().focus().toggleStrike().run()}
        >
          <Strikethrough />
        </Button>
        <Button
          type="button"
          size="icon-xs"
          variant={editor.isActive('highlight') ? 'secondary' : 'ghost'}
          aria-label="高亮"
          onClick={() => editor.chain().focus().toggleHighlight().run()}
        >
          <Highlighter />
        </Button>
        <span className="mx-1 h-4 w-px bg-border" />
        <Button
          type="button"
          size="xs"
          variant="ghost"
          onClick={onCommentSelection}
        >
          <MessageSquareText /> 评论
        </Button>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          onClick={onAddToSynopsis}
        >
          <BookMarked /> 加入小传
        </Button>
        <Button type="button" size="xs" onClick={onTuneSelection}>
          <Sparkles /> AI 调味
        </Button>
      </BubbleMenu>
      <EditorContent editor={editor} className="min-h-full" />
    </div>
  )
}
