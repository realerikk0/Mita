/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import React from 'react'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: any) => ({ ...config, id: '/thinking-content-demo' }),
  notFound: vi.fn(() => new Error('not found')),
}))

vi.mock('streamdown', () => ({
  Streamdown: ({ children }: { children: string }) => <div>{children}</div>,
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const values: Record<string, string> = {
        'chat:generationStatus.thinking': 'Thinking',
        'chat:thinkingBlock.status.idle': 'Idle',
        'chat:thinkingBlock.status.running': 'Running',
        'chat:thinkingBlock.status.complete': 'Complete',
        'chat:thinkingBlock.status.error': 'Error',
        'chat:thinkingBlock.inputLabel': 'Input',
        'chat:thinkingBlock.outputLabel': 'Output',
      }

      return values[key] ?? key
    },
  }),
}))

import { Route } from '../thinking-content-demo'

const renderComponent = () => {
  const Component = Route.component as React.ComponentType
  return render(<Component />)
}

describe('ThinkingContentDemo route', () => {
  it('registers a preview-only beforeLoad guard', () => {
    expect(Route.beforeLoad).toEqual(expect.any(Function))
  })

  it('renders reasoning, tool, search, plan, and code examples', () => {
    const { container } = renderComponent()

    expect(screen.getByText('Thinking content system')).toBeInTheDocument()
    expect(screen.getByText('Reasoning')).toBeInTheDocument()
    expect(screen.getByText('Tool call')).toBeInTheDocument()
    expect(screen.getByText('Sources')).toBeInTheDocument()
    expect(screen.getByText('Implementation plan')).toBeInTheDocument()
    expect(screen.getByText('Code analysis')).toBeInTheDocument()
    expect(
      container.querySelector('[data-thinking-kind="reasoning"]')
    ).toBeInTheDocument()
    expect(container.querySelector('[data-thinking-kind="tool"]')).toBeInTheDocument()
    expect(container.querySelector('[data-thinking-kind="search"]')).toBeInTheDocument()
    expect(container.querySelector('[data-thinking-kind="plan"]')).toBeInTheDocument()
    expect(container.querySelector('[data-thinking-kind="code"]')).toBeInTheDocument()
  })
})
