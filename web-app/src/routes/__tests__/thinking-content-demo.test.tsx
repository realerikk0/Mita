/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import React from 'react'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: any) => ({ ...config, id: '/thinking-content-demo' }),
}))

vi.mock('streamdown', () => ({
  Streamdown: ({ children }: { children: string }) => <div>{children}</div>,
}))

import { Route } from '../thinking-content-demo'

const renderComponent = () => {
  const Component = Route.component as React.ComponentType
  return render(<Component />)
}

describe('ThinkingContentDemo route', () => {
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
