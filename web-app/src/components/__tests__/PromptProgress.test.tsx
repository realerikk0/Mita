import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PromptProgress } from '../PromptProgress'
import { useAppState } from '@/hooks/useAppState'

// Mock the useAppState hook
vi.mock('@/hooks/useAppState', () => ({
  useAppState: vi.fn(),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const values: Record<string, string> = {
        'chat:generationStatus.thinking': 'Thinking',
        'chat:generationStatus.analyzingCodeProgress':
          'Analyzing code {{percent}}%',
      }

      return (values[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_match, name) =>
        options?.[name] === undefined ? _match : String(options[name])
      )
    },
  }),
}))

const mockUseAppState = useAppState as ReturnType<typeof vi.fn>

describe('PromptProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should calculate percentage correctly', () => {
    const mockProgress = {
      cache: 0,
      processed: 75,
      time_ms: 1500,
      total: 150,
    }

    mockUseAppState.mockReturnValue(mockProgress)

    render(<PromptProgress />)

    expect(screen.getByRole('status')).toHaveTextContent('Analyzing code 50%')
    expect(screen.getByRole('status')).toHaveAttribute(
      'data-loading-ribbon-variant',
      'wave'
    )
  })

  it('should handle zero total gracefully', () => {
    const mockProgress = {
      cache: 0,
      processed: 0,
      time_ms: 0,
      total: 0,
    }

    mockUseAppState.mockReturnValue(mockProgress)

    render(<PromptProgress />)

    expect(screen.getByRole('status')).toHaveTextContent('Thinking')
    expect(screen.getByRole('status')).toHaveAttribute(
      'data-loading-ribbon-variant',
      'ribbon'
    )
  })
})
