/* eslint-disable react-refresh/only-export-components */
import { useControllableState } from '@radix-ui/react-use-controllable-state'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import {
  BrainCircuitIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  CircleDotIcon,
  CircleIcon,
  Code2Icon,
  ExternalLinkIcon,
  SearchIcon,
  SparklesIcon,
  WrenchIcon,
  XCircleIcon,
} from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { memo } from 'react'
import { Streamdown } from 'streamdown'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { LoadingRibbonText } from './loading-ribbon'

import './thinking-block.css'

export type ThinkingBlockKind = 'reasoning' | 'tool' | 'search' | 'plan' | 'code'
export type ThinkingBlockStatus =
  | 'idle'
  | 'running'
  | 'complete'
  | 'error'
export type ReasoningStepStatus = 'complete' | 'active' | 'pending' | 'error'

const kindIcons = {
  reasoning: BrainCircuitIcon,
  tool: WrenchIcon,
  search: SearchIcon,
  plan: SparklesIcon,
  code: Code2Icon,
} satisfies Record<ThinkingBlockKind, typeof BrainCircuitIcon>

const statusLabelKeys: Record<ThinkingBlockStatus, string> = {
  idle: 'chat:thinkingBlock.status.idle',
  running: 'chat:thinkingBlock.status.running',
  complete: 'chat:thinkingBlock.status.complete',
  error: 'chat:thinkingBlock.status.error',
}

export const getThinkingBlockStatusLabel = (
  status: ThinkingBlockStatus,
  t: (key: string, options?: Record<string, unknown>) => string
) => t(statusLabelKeys[status])

export type ThinkingBlockProps = ComponentProps<typeof Collapsible> & {
  kind?: ThinkingBlockKind
  status?: ThinkingBlockStatus
  title: ReactNode
  subtitle?: ReactNode
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
}

export const ThinkingBlock = memo(
  ({
    children,
    className,
    defaultOpen = true,
    kind = 'reasoning',
    onOpenChange,
    open,
    status = 'complete',
    subtitle,
    title,
    ...props
  }: ThinkingBlockProps) => {
    const { t } = useTranslation()
    const [isOpen, setIsOpen] = useControllableState({
      prop: open,
      defaultProp: defaultOpen,
      onChange: onOpenChange,
    })
    const Icon = kindIcons[kind]
    const isRunning = status === 'running'

    return (
      <Collapsible
        className={cn('thinking-block not-prose', className)}
        data-testid="thinking-block"
        data-thinking-kind={kind}
        data-thinking-status={status}
        onOpenChange={setIsOpen}
        open={isOpen}
        {...props}
      >
        <CollapsibleTrigger className="thinking-block__trigger">
          <span className="thinking-block__icon" aria-hidden="true">
            <Icon className="size-3.5" />
          </span>
          <span className="thinking-block__heading">
            <span className="thinking-block__title">
              {isRunning ? (
                <LoadingRibbonText
                  icon={kind === 'search' ? 'search' : kind === 'tool' ? 'tool' : 'thinking'}
                  label={
                    typeof title === 'string'
                      ? title
                      : t('chat:generationStatus.thinking')
                  }
                  live={false}
                  showIcon={false}
                  size="sm"
                  variant={kind === 'search' ? 'glint' : kind === 'tool' ? 'wave' : 'ribbon'}
                />
              ) : (
                title
              )}
            </span>
            {subtitle && (
              <span className="thinking-block__subtitle">{subtitle}</span>
            )}
          </span>
          <span
            className="thinking-block__status"
            data-thinking-block-status-label={status}
          >
            {getThinkingBlockStatusLabel(status, t)}
          </span>
          <ChevronDownIcon
            aria-hidden="true"
            className={cn(
              'thinking-block__chevron size-4',
              isOpen && 'thinking-block__chevron--open'
            )}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="thinking-block__content">
          <div className="thinking-block__inner">{children}</div>
        </CollapsibleContent>
      </Collapsible>
    )
  }
)

export type ThinkingMarkdownProps = Omit<ComponentProps<'div'>, 'children'> & {
  children: string
  animate?: boolean
}

export const ThinkingMarkdown = memo(
  ({
    animate = true,
    children,
    className,
    ...props
  }: ThinkingMarkdownProps) => (
    <div className={cn('thinking-markdown', className)} {...props}>
      <Streamdown animate={animate} animationDuration={320}>
        {children}
      </Streamdown>
    </div>
  )
)

export type ReasoningStepProps = ComponentProps<'div'> & {
  icon?: ReactNode
  label: ReactNode
  status?: ReasoningStepStatus
}

const stepIcons: Record<ReasoningStepStatus, ReactNode> = {
  complete: <CheckCircle2Icon className="size-4" aria-hidden="true" />,
  active: <CircleDotIcon className="size-4" aria-hidden="true" />,
  pending: <CircleIcon className="size-4" aria-hidden="true" />,
  error: <XCircleIcon className="size-4" aria-hidden="true" />,
}

export const ReasoningStep = memo(
  ({
    children,
    className,
    icon,
    label,
    status = 'pending',
    ...props
  }: ReasoningStepProps) => (
    <div
      className={cn('thinking-step', className)}
      data-thinking-step={status}
      {...props}
    >
      <span
        className="thinking-step__icon"
        data-thinking-step-icon={status}
        aria-hidden="true"
      >
        {icon ?? stepIcons[status]}
      </span>
      <span className="thinking-step__body">
        <span
          className="thinking-step__label"
          data-thinking-step-status={status}
        >
          {label}
        </span>
        {children && <span className="thinking-step__detail">{children}</span>}
      </span>
    </div>
  )
)

export type SearchSourceListProps = ComponentProps<'div'> & {
  title?: ReactNode
}

export const SearchSourceList = memo(
  ({ children, className, title, ...props }: SearchSourceListProps) => (
    <div className={cn('thinking-sources', className)} {...props}>
      {title && <div className="thinking-sources__title">{title}</div>}
      <div className="thinking-sources__items">{children}</div>
    </div>
  )
)

export type SearchSourceItemProps = ComponentProps<'a'> & {
  domain?: ReactNode
}

export const SearchSourceItem = memo(
  ({
    children,
    className,
    domain,
    href,
    ...props
  }: SearchSourceItemProps) => (
    <a
      className={cn('thinking-source', className)}
      href={href}
      rel="noopener noreferrer"
      target="_blank"
      {...props}
    >
      <SearchIcon className="thinking-source__icon size-3.5" aria-hidden="true" />
      <span className="thinking-source__label">{children}</span>
      {domain && <span className="thinking-source__domain">{domain}</span>}
      <ExternalLinkIcon
        className="thinking-source__external size-3"
        aria-hidden="true"
      />
    </a>
  )
)

export type ToolCallCardProps = Omit<ComponentProps<'div'>, 'children'> & {
  name: string
  status?: ThinkingBlockStatus
  input?: unknown
  output?: unknown
  errorText?: ReactNode
  children?: ReactNode
}

const formatToolName = (name: string) =>
  name.replaceAll('_', ' ').replaceAll('-', ' ').trim()

const formatPayload = (value: unknown) => {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export const ToolCallCard = memo(
  ({
    children,
    className,
    errorText,
    input,
    name,
    output,
    status = 'complete',
    ...props
  }: ToolCallCardProps) => {
    const { t } = useTranslation()
    const hasInput = input !== undefined
    const hasOutput = output !== undefined

    return (
      <div
        className={cn('thinking-tool-card', className)}
        data-thinking-tool-status={status}
        {...props}
      >
        <div className="thinking-tool-card__header">
          <WrenchIcon className="size-3.5" aria-hidden="true" />
          <span className="thinking-tool-card__name">{formatToolName(name)}</span>
          <span className="thinking-tool-card__badge">
            {getThinkingBlockStatusLabel(status, t)}
          </span>
        </div>
        {hasInput && (
          <div className="thinking-tool-card__section">
            <div className="thinking-tool-card__label">
              {t('chat:thinkingBlock.inputLabel')}
            </div>
            <pre
              className="thinking-tool-card__payload"
              data-testid="thinking-tool-input"
            >
              {formatPayload(input)}
            </pre>
          </div>
        )}
        {hasOutput && (
          <div className="thinking-tool-card__section">
            <div className="thinking-tool-card__label">
              {t('chat:thinkingBlock.outputLabel')}
            </div>
            <pre
              className="thinking-tool-card__payload"
              data-testid="thinking-tool-output"
            >
              {formatPayload(output)}
            </pre>
          </div>
        )}
        {errorText && (
          <div className="thinking-tool-card__error">{errorText}</div>
        )}
        {children}
      </div>
    )
  }
)

ThinkingBlock.displayName = 'ThinkingBlock'
ThinkingMarkdown.displayName = 'ThinkingMarkdown'
ReasoningStep.displayName = 'ReasoningStep'
SearchSourceList.displayName = 'SearchSourceList'
SearchSourceItem.displayName = 'SearchSourceItem'
ToolCallCard.displayName = 'ToolCallCard'
