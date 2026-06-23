import type { ComponentPropsWithoutRef, ElementType } from 'react'
import { memo } from 'react'
import {
  BrainCircuitIcon,
  SearchIcon,
  SparklesIcon,
  WrenchIcon,
} from 'lucide-react'

import { cn } from '@/lib/utils'

import './loading-ribbon.css'

export const loadingRibbonStatuses = [
  '思考中',
  '网络搜索中',
  '正在生成回复',
  '分析代码中',
  '正在调用工具...',
] as const

export type LoadingRibbonVariant = 'ribbon' | 'glint' | 'wave'
export type LoadingRibbonSize = 'xs' | 'sm' | 'md'
export type LoadingRibbonIcon = 'sparkles' | 'thinking' | 'search' | 'tool'

export type LoadingRibbonTextProps<TElement extends ElementType = 'span'> =
  Omit<ComponentPropsWithoutRef<TElement>, 'children'> & {
    as?: TElement
    label?: string
    variant?: LoadingRibbonVariant
    size?: LoadingRibbonSize
    showIcon?: boolean
    icon?: LoadingRibbonIcon
    live?: boolean
  }

const iconByName = {
  sparkles: SparklesIcon,
  thinking: BrainCircuitIcon,
  search: SearchIcon,
  tool: WrenchIcon,
} satisfies Record<LoadingRibbonIcon, typeof SparklesIcon>

function LoadingRibbonTextComponent<TElement extends ElementType = 'span'>({
  as,
  className,
  icon = 'sparkles',
  label = loadingRibbonStatuses[0],
  live = true,
  showIcon = true,
  size = 'sm',
  variant = 'ribbon',
  ...props
}: LoadingRibbonTextProps<TElement>) {
  const Component = as ?? 'span'
  const Icon = iconByName[icon]

  return (
    <Component
      aria-atomic={live ? 'true' : undefined}
      aria-live={live ? 'polite' : undefined}
      className={cn('loading-ribbon', className)}
      data-loading-ribbon=""
      data-loading-ribbon-size={size}
      data-loading-ribbon-variant={variant}
      role={live ? 'status' : undefined}
      {...props}
    >
      {showIcon && (
        <Icon
          aria-hidden="true"
          className="loading-ribbon__icon"
          data-testid="loading-ribbon-icon"
        />
      )}
      <span className="loading-ribbon__text" data-loading-ribbon-label={label}>
        {label}
      </span>
    </Component>
  )
}

export const LoadingRibbonText = memo(
  LoadingRibbonTextComponent
) as typeof LoadingRibbonTextComponent
