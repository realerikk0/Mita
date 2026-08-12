import {
  Bookmark,
  Check,
  ChevronDown,
  CircleAlert,
  Copy,
  LoaderCircle,
  RefreshCw,
  Send,
  Sparkles,
  Square,
  X,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import type { AiContextItem, AiSuggestion } from '@/types/novel'

type Props = {
  instruction: string
  onInstructionChange: (value: string) => void
  contextItems: AiContextItem[]
  onToggleContext: (id: string) => void
  suggestions: AiSuggestion[]
  selectedText?: string
  generating: boolean
  onGenerate: () => void
  onStop: () => void
  onApply: (suggestion: AiSuggestion) => void
  onReject: (suggestion: AiSuggestion) => void
  onFavorite: (suggestion: AiSuggestion) => void
}

export function AiInspector({
  instruction,
  onInstructionChange,
  contextItems,
  onToggleContext,
  suggestions,
  selectedText,
  generating,
  onGenerate,
  onStop,
  onApply,
  onReject,
  onFavorite,
}: Props) {
  return (
    <aside className="flex min-w-0 flex-col border-l bg-background">
      <div className="border-b px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Sparkles className="size-3.5" />
            </span>
            <div>
              <h2 className="text-sm font-semibold">AI 创作</h2>
              <p className="text-[10px] text-muted-foreground">生成候选，不会静默覆盖正文</p>
            </div>
          </div>
          <button type="button" className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
            当前模型 <ChevronDown className="size-3" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-3 border-b p-4">
          {selectedText ? (
            <div className="rounded-lg border-l-2 border-primary bg-muted/35 px-3 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">当前选区</div>
              <p className="mt-1 line-clamp-3 text-xs leading-5">{selectedText}</p>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed px-3 py-3 text-xs text-muted-foreground">
              划选正文可进行调味；未选择时将从光标处续写。
            </div>
          )}

          <Textarea
            value={instruction}
            onChange={(event) => onInstructionChange(event.target.value)}
            placeholder={selectedText ? '例如：更克制、更有压迫感，保留关键信息' : '描述下一段要发生什么'}
            className="min-h-20 resize-none"
          />

          <div>
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">本次上下文</div>
            <div className="flex flex-wrap gap-1.5">
              {contextItems.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => onToggleContext(item.id)}
                  className={cn(
                    'inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-1 text-[10px] transition',
                    item.included
                      ? 'border-primary/25 bg-primary/8 text-foreground'
                      : 'border-dashed text-muted-foreground line-through'
                  )}
                  title={item.content}
                >
                  {item.included ? <Check className="size-2.5 text-primary" /> : <X className="size-2.5" />}
                  <span className="truncate">{item.label}</span>
                </button>
              ))}
            </div>
          </div>

          {generating ? (
            <Button className="w-full" variant="outline" onClick={onStop}>
              <Square className="fill-current" /> 停止生成
            </Button>
          ) : (
            <Button className="w-full" onClick={onGenerate}>
              <Send /> 生成 3 个候选
            </Button>
          )}
        </div>

        <div className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold">候选文字</span>
            {suggestions.length > 0 && (
              <button type="button" className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground" onClick={onGenerate}>
                <RefreshCw className="size-3" /> 全部重生成
              </button>
            )}
          </div>

          {suggestions.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              <Sparkles className="mx-auto mb-2 size-5 opacity-40" />
              候选会逐个流式出现在这里
            </div>
          ) : (
            suggestions
              .slice()
              .sort((a, b) => a.candidateIndex - b.candidateIndex)
              .map((suggestion) => (
                <article key={suggestion.id} className={cn('rounded-xl border p-3 transition', suggestion.favorite && 'border-primary/35 bg-primary/[0.025]')}>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground">
                      候选 {suggestion.candidateIndex + 1}
                      {suggestion.status === 'streaming' && <LoaderCircle className="size-3 animate-spin text-primary" />}
                      {suggestion.status === 'failed' && <CircleAlert className="size-3 text-destructive" />}
                      {suggestion.stale && <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-amber-700 dark:text-amber-300">已过期</span>}
                    </span>
                    <div className="flex gap-0.5">
                      <Button size="icon-xs" variant="ghost" aria-label="复制候选" onClick={() => void navigator.clipboard.writeText(suggestion.content)}><Copy /></Button>
                      <Button size="icon-xs" variant={suggestion.favorite ? 'secondary' : 'ghost'} aria-label="收藏候选" onClick={() => onFavorite(suggestion)}><Bookmark className={suggestion.favorite ? 'fill-current' : undefined} /></Button>
                    </div>
                  </div>
                  <p className="whitespace-pre-wrap text-xs leading-5">{suggestion.content || (suggestion.status === 'failed' ? suggestion.error : '正在构思…')}</p>
                  {suggestion.status === 'ready' && (
                    <div className="mt-3 flex gap-2">
                      <Button size="xs" className="flex-1" disabled={suggestion.stale} onClick={() => onApply(suggestion)}><Check /> 采用</Button>
                      <Button size="xs" variant="outline" onClick={() => onReject(suggestion)}><X /> 拒绝</Button>
                    </div>
                  )}
                </article>
              ))
          )}
        </div>
      </div>
    </aside>
  )
}
