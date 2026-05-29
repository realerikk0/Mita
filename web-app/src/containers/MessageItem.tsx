/* eslint-disable @typescript-eslint/no-explicit-any */
import { memo, useState, useCallback } from 'react'
import type { UIMessage, ChatStatus } from 'ai'
import { RenderMarkdown } from './RenderMarkdown'
import { cn } from '@/lib/utils'
import { twMerge } from 'tailwind-merge'
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
} from '@/components/ai-elements/chain-of-thought'
import { Streamdown } from 'streamdown'
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from '@/components/ai-elements/tool'
import { splitTextByPseudoToolTranscripts } from '@/lib/pseudo-tool-transcript'
import { CopyButton } from './CopyButton'
import { formatDate } from '@/utils/formatDate'
import { useModelProvider } from '@/hooks/useModelProvider'
import { IconRefresh, IconPaperclip, IconArrowDown } from '@tabler/icons-react'
import { AlertTriangleIcon, WrenchIcon } from 'lucide-react'
import { EditMessageDialog } from '@/containers/dialogs/EditMessageDialog'
import { DeleteMessageDialog } from '@/containers/dialogs/DeleteMessageDialog'
import TokenSpeedIndicator from '@/containers/TokenSpeedIndicator'
import { extractFilesFromPrompt, FileMetadata } from '@/lib/fileMetadata'
import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import {
  getMitaCompactMetadata,
  isCompactSummaryMessage,
} from '@/lib/compact-thread'

const CHAT_STATUS = {
  STREAMING: 'streaming',
  SUBMITTED: 'submitted',
} as const

const CONTENT_TYPE = {
  TEXT: 'text',
  FILE: 'file',
  REASONING: 'reasoning',
} as const

export type MessageItemProps = {
  message: UIMessage
  isFirstMessage: boolean
  isLastMessage: boolean
  status: ChatStatus
  reasoningContainerRef?: React.RefObject<HTMLDivElement | null>
  isReasoningAtBottom?: boolean
  onReasoningScroll?: () => void
  onReasoningScrollToBottom?: () => void
  onRegenerate?: (messageId: string) => void
  onEdit?: (messageId: string, newText: string) => void
  onDelete?: (messageId: string) => void
  assistant?: { avatar?: React.ReactNode; name?: string }
  showAssistant?: boolean
  isAnimating?: boolean
  hideActions?: boolean
}

export const MessageItem = memo(
  ({
    message,
    isLastMessage,
    status,
    isAnimating,
    hideActions,
    reasoningContainerRef,
    isReasoningAtBottom,
    onReasoningScroll,
    onReasoningScrollToBottom,
    onRegenerate,
    onEdit,
    onDelete,
  }: MessageItemProps) => {
    const selectedModel = useModelProvider((state) => state.selectedModel)
    const metadata = message.metadata as Record<string, unknown> | undefined
    const createdAt = (metadata?.createdAt as Date) ?? new Date()
    const [previewImage, setPreviewImage] = useState<{
      url: string
      filename?: string
    } | null>(null)


    const handleRegenerate = useCallback(() => {
      onRegenerate?.(message.id)
    }, [onRegenerate, message.id])

    const handleEdit = useCallback(
      (newText: string) => {
        onEdit?.(message.id, newText)
      },
      [onEdit, message.id]
    )

    const handleDelete = useCallback(() => {
      onDelete?.(message.id)
    }, [onDelete, message.id])

    // Get image URLs from file parts for the edit dialog
    const imageUrls = useMemo(() => {
      return message.parts
        .filter((part) => {
          if (part.type !== 'file') return false
          const filePart = part as { type: 'file'; url?: string; mediaType?: string }
          return filePart.url && filePart.mediaType?.startsWith('image/')
        })
        .map((part) => (part as { url: string }).url)
    }, [message.parts])

    const isStreaming = isLastMessage && status === CHAT_STATUS.STREAMING

    // Extract file metadata from message text (for user messages with attachments)
    const attachedFiles = useMemo(() => {
      if (message.role !== 'user') return []

      const textParts = message.parts.filter(
        (part): part is { type: 'text'; text: string } =>
          part.type === CONTENT_TYPE.TEXT
      )

      if (textParts.length === 0) return []

      const { files } = extractFilesFromPrompt(textParts[0].text)
      return files
    }, [message.parts, message.role])

    // Get full text content for copy button
    const getFullTextContent = useCallback(() => {
      return message.parts
        .filter(
          (part): part is { type: 'text'; text: string } =>
            part.type === CONTENT_TYPE.TEXT
        )
        .map((part) => part.text)
        .join('\n')
    }, [message.parts])

    const renderTextPart = (
      part: { type: 'text'; text: string },
      partIndex: number
    ) => {
      if (!part.text || part.text.trim() === '') {
        return null
      }

      const isLastPart = partIndex === message.parts.length - 1

      // For user messages, extract and clean the text from file metadata
      const displayText =
        message.role === 'user'
          ? extractFilesFromPrompt(part.text).cleanPrompt
          : part.text

      if (
        !displayText.trim() &&
        message.role === 'user' &&
        attachedFiles.length === 0
      ) {
        return null
      }

      return (
        <div key={`${message.id}-${partIndex}`} className="w-full">
          {message.role === 'user' ? (
            <div className="flex justify-end w-full h-full text-start wrap-break-word whitespace-normal">
              <div className="bg-secondary relative text-foreground p-2 rounded-md inline-block max-w-[80%]">
                {/* Show attached files if any */}
                {attachedFiles.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-3">
                    {attachedFiles.map((file: FileMetadata, idx: number) => (
                      <div
                        key={`file-${idx}-${file.id}`}
                        className="flex items-center gap-1.5 px-2 py-1 rounded-sm bg-secondary border text-xs"
                      >
                        <IconPaperclip
                          size={14}
                          className="text-muted-foreground"
                        />
                        <span className="font-medium">{file.name}</span>
                        {file.injectionMode && (
                          <span className="text-muted-foreground">
                            ({file.injectionMode})
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {displayText && (
                  <div dir="auto" className="select-text whitespace-pre-wrap">
                    {displayText}
                  </div>
                )}
              </div>
            </div>
          ) : (
            renderAssistantTextPart(part.text, partIndex, isLastPart)
          )}
        </div>
      )
    }

    const renderPseudoToolTranscriptCard = (
      segment: Extract<
        ReturnType<typeof splitTextByPseudoToolTranscripts>[number],
        { type: 'pseudo-tool-transcript' }
      >,
      key: string
    ) => {
      const hasError = Boolean(segment.transcript.parseError)
      const title = hasError
        ? '工具调用格式异常'
        : '模型输出了未执行的工具指令'

      return (
        <details
          key={key}
          className={cn(
            'not-prose my-2 rounded-md border bg-muted/40 px-3 py-2 text-sm',
            hasError
              ? 'border-destructive/25 bg-destructive/5'
              : 'border-amber-300/40 bg-amber-50/60 dark:bg-amber-950/15'
          )}
          data-pseudo-tool-transcript
        >
          <summary className="flex cursor-pointer list-none items-center gap-2 text-muted-foreground">
            {hasError ? (
              <AlertTriangleIcon className="size-4 text-destructive" />
            ) : (
              <WrenchIcon className="size-4 text-amber-600 dark:text-amber-400" />
            )}
            <span className="font-medium text-foreground">{title}</span>
            {segment.transcript.toolName && (
              <span className="rounded-sm bg-background/70 px-1.5 py-0.5 font-mono text-xs">
                {segment.transcript.toolName}
              </span>
            )}
          </summary>
          <div className="mt-2 space-y-2 pl-6">
            {segment.transcript.parseError && (
              <div className="text-xs text-destructive">
                {segment.transcript.parseError}
              </div>
            )}
            <pre className="max-h-48 overflow-auto rounded-md border bg-background p-2 text-xs whitespace-pre-wrap break-words text-foreground">
              {segment.transcript.raw}
            </pre>
          </div>
        </details>
      )
    }

    const renderAssistantTextPart = (
      text: string,
      partIndex: number,
      isLastPart: boolean
    ) => {
      const segments = splitTextByPseudoToolTranscripts(text)
      const markdownCount = segments.filter((segment) => segment.type === 'text')
        .length
      let markdownIndex = 0

      return segments.map((segment, segmentIndex) => {
        if (segment.type === 'pseudo-tool-transcript') {
          return renderPseudoToolTranscriptCard(
            segment,
            `${message.id}-${partIndex}-pseudo-tool-${segmentIndex}`
          )
        }

        if (!segment.text.trim()) return null
        markdownIndex++

        return (
          <RenderMarkdown
            key={`${message.id}-${partIndex}-text-${segmentIndex}`}
            content={segment.text}
            isStreaming={
              isStreaming && isLastPart && markdownIndex === markdownCount
            }
            messageId={message.id}
            isAnimating={isAnimating}
            onApplyContentEdit={
              onEdit && !hideActions
                ? (newContent) => onEdit(message.id, newContent)
                : undefined
            }
            paragraphEditDisabled={hideActions || (isStreaming && isLastPart)}
          />
        )
      })
    }

    const renderFilePart = (
      part: {
        type: 'file'
        filename?: string
        url?: string
        mediaType?: string
      },
      partIndex: number
    ) => {
      const isImage = part.mediaType?.startsWith('image/')

      if (message.role === 'user' && isImage && part.url) {
        return (
          <div
            key={`${message.id}-${partIndex}`}
            className="flex justify-end w-full my-2"
          >
            <div className="flex flex-wrap gap-2 max-w-[80%] justify-end">
              <div className="relative">
                <img
                  src={part.url}
                  alt={part.filename || 'Uploaded attachment'}
                  className="size-20 rounded-lg object-cover border cursor-pointer"
                  onClick={() =>
                    setPreviewImage({ url: part.url!, filename: part.filename })
                  }
                />
              </div>
            </div>
          </div>
        )
      }

      if (message.role === 'assistant' && isImage && part.url) {
        return (
          <div key={`${message.id}-${partIndex}`} className="my-2">
            <img
              src={part.url}
              alt={part.filename || 'Generated image'}
              className="max-w-full rounded-md cursor-pointer"
              onClick={() =>
                setPreviewImage({ url: part.url!, filename: part.filename })
              }
            />
          </div>
        )
      }

      return null
    }

    const renderToolInline = (part: any, partIndex: number) => {
      if (!part.type.startsWith('tool-') || !('state' in part)) {
        return null
      }

      const toolName = part.type.split('-').slice(1).join('-')
      const errorText = part.error || part.errorText || 'Tool execution failed'
      return (
        <Tool
          key={`${message.id}-${partIndex}`}
          state={part.state}
          className="mb-2"
        >
          <ToolHeader
            title={toolName}
            type={`tool-${toolName}` as `tool-${string}`}
            state={part.state}
          />
          <ToolContent title={toolName}>
            {part.input && (
              <ToolInput
                input={part.input}
              />
            )}
            {part.output && (
              <ToolOutput
                output={part.output}
                resolver={(input) => Promise.resolve(input)}
                errorText={undefined}
              />
            )}
            {part.state === 'output-error' && (
              <ToolOutput
                output={undefined}
                errorText={errorText}
                resolver={(input) => Promise.resolve(input)}
              />
            )}
          </ToolContent>
        </Tool>
      )
    }

    // Group consecutive reasoning + tool parts into a single CoT block.
    // Empty text parts and step-start markers (inserted by the AI SDK during
    // multi-step tool use) are absorbed so they don't split the group.
    const isCotPart = (part: any) =>
      part.type === CONTENT_TYPE.REASONING ||
      part.type.startsWith('tool-') ||
      part.type === 'step-start' ||
      (part.type === CONTENT_TYPE.TEXT && (!part.text || part.text.trim() === ''))

    type PartEntry = { part: any; index: number }

    const renderCotGroup = (
      entries: PartEntry[],
      groupKey: string,
      hasFollowingContent: boolean
    ) => {
      const hasReasoning = entries.some(
        (e) => e.part.type === CONTENT_TYPE.REASONING
      )

      // No reasoning in this group — render tool parts directly, no CoT wrapper
      if (!hasReasoning) {
        return entries.map(({ part, index: partIndex }) =>
          renderToolInline(part, partIndex)
        )
      }

      const lastEntryIndex = entries[entries.length - 1].index
      const groupIsStreaming =
        isStreaming && lastEntryIndex === message.parts.length - 1

      return (
        <ChainOfThought
          key={groupKey}
          className="w-full text-muted-foreground"
          isStreaming={groupIsStreaming}
          shouldCollapse={hasFollowingContent}
          defaultOpen={true}
        >
          <ChainOfThoughtHeader />
          <ChainOfThoughtContent>
            {entries.map(({ part, index: partIndex }) => {
              if (part.type === CONTENT_TYPE.REASONING) {
                const isLastMsgPart =
                  partIndex === message.parts.length - 1
                const partIsStreaming = isStreaming && isLastMsgPart

                return (
                  <div
                    key={`${message.id}-r-${partIndex}`}
                    className="relative"
                  >
                    {partIsStreaming && (
                      <div className="absolute top-0 left-0 right-0 h-8 bg-linear-to-br from-neutral-50 mask-t-from-98% dark:from-background to-transparent pointer-events-none z-10" />
                    )}
                    <div
                      ref={partIsStreaming ? reasoningContainerRef : null}
                      onScroll={
                        partIsStreaming ? onReasoningScroll : undefined
                      }
                      className={twMerge(
                        'w-full overflow-auto relative',
                        partIsStreaming
                          ? 'max-h-64 opacity-70 mt-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden'
                          : 'h-auto opacity-100'
                      )}
                    >
                      <Streamdown
                        animate={true}
                        animationDuration={500}
                      >
                        {part.text}
                      </Streamdown>
                    </div>
                    {partIsStreaming && !isReasoningAtBottom && (
                      <Button
                        className="absolute bottom-2 left-[50%] translate-x-[-50%] rounded-full size-7 z-10"
                        onClick={onReasoningScrollToBottom}
                        size="icon"
                        type="button"
                        variant="outline"
                      >
                        <IconArrowDown className="size-3" />
                      </Button>
                    )}
                  </div>
                )
              }

              // Tool part inside CoT
              return renderToolInline(part, partIndex)
            })}
          </ChainOfThoughtContent>
        </ChainOfThought>
      )
    }

    const renderedParts = useMemo(() => {
      const elements: React.ReactNode[] = []
      let cotBuffer: PartEntry[] = []

      const flushCot = (hasFollowing: boolean) => {
        if (cotBuffer.length === 0) return
        const key = `${message.id}-cot-${cotBuffer[0].index}`
        elements.push(renderCotGroup(cotBuffer, key, hasFollowing))
        cotBuffer = []
      }

      for (let i = 0; i < message.parts.length; i++) {
        const part = message.parts[i] as any
        if (isCotPart(part)) {
          cotBuffer.push({ part, index: i })
        } else {
          flushCot(true) // text/file follows → collapse the CoT
          switch (part.type) {
            case CONTENT_TYPE.TEXT:
              elements.push(
                renderTextPart(part as { type: 'text'; text: string }, i)
              )
              break
            case CONTENT_TYPE.FILE:
              elements.push(renderFilePart(part as any, i))
              break
            default:
              break
          }
        }
      }
      flushCot(false) // end of message, no following content → keep open

      return elements
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [message.parts, isStreaming, isReasoningAtBottom])

    if (message.role === 'system' && isCompactSummaryMessage(message)) {
      const compactMetadata = getMitaCompactMetadata(message)
      const summary = getFullTextContent()
      const sourceMessageCount =
        compactMetadata?.kind === 'summary'
          ? compactMetadata.sourceMessageCount
          : 0

      return (
        <div className="w-full mb-4">
          <details className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              Context compacted
              {sourceMessageCount > 0 ? ` · ${sourceMessageCount} messages` : ''}
              {' · '}
              {formatDate(createdAt)}
            </summary>
            <div className="mt-3">
              <RenderMarkdown
                content={summary}
                isStreaming={false}
                messageId={message.id}
                isAnimating={false}
              />
            </div>
          </details>
        </div>
      )
    }

    return (
      <div className="w-full mb-4">

        {/* Render message parts */}
        {renderedParts}

        {/* Message actions for user messages */}
        {message.role === 'user' && !hideActions && (
          <div className="flex items-center justify-end gap-1 text-muted-foreground text-xs mt-4">
            <span className="text-muted-foreground">
              {formatDate(createdAt)}
            </span>
            <CopyButton text={getFullTextContent()} />

            {onEdit && status !== CHAT_STATUS.STREAMING && (
              <EditMessageDialog
                message={getFullTextContent()}
                imageUrls={imageUrls.length > 0 ? imageUrls : undefined}
                onSave={handleEdit}
              />
            )}

            {onDelete && status !== CHAT_STATUS.STREAMING && (
              <DeleteMessageDialog onDelete={handleDelete} />
            )}
          </div>
        )}

        {/* Message actions for assistant messages (non-tool) */}
        {message.role === 'assistant' && (
            <div className="flex items-center gap-2 text-muted-foreground text-xs mt-1">
              {!isStreaming && (
                <span className="text-muted-foreground">
                  {formatDate(createdAt)}
                </span>
              )}
              <div
                className={cn(
                  'flex items-center gap-1',
                  (isStreaming || hideActions) && 'hidden'
                )}
              >
                <CopyButton text={getFullTextContent()} />

                {onEdit && !isStreaming && (
                  <EditMessageDialog
                    message={getFullTextContent()}
                    onSave={handleEdit}
                  />
                )}

                {onDelete && !isStreaming && (
                  <DeleteMessageDialog onDelete={handleDelete} />
                )}

                {selectedModel && onRegenerate && !isStreaming && isLastMessage && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={handleRegenerate}
                    title="Regenerate response"
                  >
                    <IconRefresh size={16} />
                  </Button>
                )}
              </div>

              <TokenSpeedIndicator
                streaming={isStreaming}
                metadata={metadata}
              />
            </div>
          )}

        {/* Image Preview Dialog */}
        {previewImage && (
          <div
            className="fixed inset-0 z-100 bg-black/50 backdrop-blur-md flex items-center justify-center cursor-pointer"
            onClick={() => setPreviewImage(null)}
          >
            <img
              src={previewImage.url}
              alt={previewImage.filename || 'Preview'}
              className="max-h-[90vh] max-w-[90vw] object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}
      </div>
    )
  },
  (prevProps, nextProps) => {
    // Always re-render if streaming and this is the last message
    if (nextProps.isLastMessage && nextProps.status === CHAT_STATUS.STREAMING) {
      return false
    }

    return (
      prevProps.message === nextProps.message &&
      prevProps.isFirstMessage === nextProps.isFirstMessage &&
      prevProps.isLastMessage === nextProps.isLastMessage &&
      prevProps.status === nextProps.status &&
      prevProps.showAssistant === nextProps.showAssistant &&
      prevProps.hideActions === nextProps.hideActions
    )
  }
)

MessageItem.displayName = 'MessageItem'
