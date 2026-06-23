import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  LoadingRibbonText,
  loadingRibbonStatuses,
} from '../loading-ribbon'

describe('LoadingRibbonText', () => {
  it('renders arbitrary status text as a polite live status', () => {
    render(<LoadingRibbonText label="网络搜索中" />)

    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toHaveAttribute('aria-atomic', 'true')
    expect(status).toHaveTextContent('网络搜索中')
  })

  it.each(['ribbon', 'glint', 'wave'] as const)(
    'marks the %s variant for styling without changing the label',
    (variant) => {
      render(<LoadingRibbonText label="分析代码中" variant={variant} />)

      expect(screen.getByRole('status')).toHaveAttribute(
        'data-loading-ribbon-variant',
        variant
      )
      expect(screen.getByText('分析代码中')).toBeInTheDocument()
    }
  )

  it('can hide the decorative icon for compact text-only rows', () => {
    render(<LoadingRibbonText label="正在生成回复" showIcon={false} />)

    expect(screen.getByRole('status')).toHaveTextContent('正在生成回复')
    expect(screen.queryByTestId('loading-ribbon-icon')).not.toBeInTheDocument()
  })

  it('exports reusable default status labels', () => {
    expect(loadingRibbonStatuses).toEqual(
      expect.arrayContaining([
        '思考中',
        '网络搜索中',
        '正在生成回复',
        '分析代码中',
        '正在调用工具...',
      ])
    )
  })
})
