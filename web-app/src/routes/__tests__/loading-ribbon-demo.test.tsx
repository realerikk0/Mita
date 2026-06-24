/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import React from 'react'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: any) => ({
    ...config,
    id: '/loading-ribbon-demo',
  }),
  notFound: vi.fn(() => new Error('not found')),
}))

import { Route } from '../loading-ribbon-demo'

const renderComponent = () => {
  const Component = Route.component as React.ComponentType
  return render(<Component />)
}

describe('LoadingRibbonDemo route', () => {
  it('registers a preview-only beforeLoad guard', () => {
    expect(Route.beforeLoad).toEqual(expect.any(Function))
  })

  it('renders the focused loading ribbon preview surface', () => {
    const { container } = renderComponent()

    expect(screen.getByText('Silver flowing ribbon text')).toBeInTheDocument()
    expect(container.querySelector('[data-loading-ribbon-demo]')).toBeInTheDocument()
    expect(container.querySelectorAll('[data-loading-ribbon]').length).toBeGreaterThan(0)
  })
})
