import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockNavigate = vi.fn()
const mockRunNovelBlueprint = vi.fn()
const mockListProjects = vi.fn()
const mockToastInfo = vi.fn()
const mockToastSuccess = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}))

vi.mock('@/hooks/useServiceHub', () => {
  const serviceHub = {
    novels: () => ({
      listProjects: mockListProjects,
    }),
  }
  return { useServiceHub: () => serviceHub }
})

vi.mock('@/lib/novel-ai', () => ({
  runNovelBlueprint: (...args: unknown[]) => mockRunNovelBlueprint(...args),
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    info: (...args: unknown[]) => mockToastInfo(...args),
    success: (...args: unknown[]) => mockToastSuccess(...args),
  },
}))

import { NovelLibrary } from '@/components/novel/NovelLibrary'

describe('NovelLibrary blueprint generation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListProjects.mockResolvedValue([])
  })

  it('does not overwrite an idea edited while the blueprint request is pending', async () => {
    let resolveBlueprint!: (value: string) => void
    mockRunNovelBlueprint.mockReturnValue(
      new Promise<string>((resolve) => {
        resolveBlueprint = resolve
      })
    )
    render(<NovelLibrary />)

    fireEvent.click(screen.getByRole('button', { name: '新建作品' }))
    const idea = await screen.findByLabelText('一句话构思')
    fireEvent.change(idea, { target: { value: '最初构思' } })
    fireEvent.click(screen.getByRole('button', { name: 'AI 生成故事蓝图' }))

    expect(mockRunNovelBlueprint).toHaveBeenCalledWith(
      expect.objectContaining({ idea: '最初构思' })
    )
    fireEvent.change(idea, { target: { value: '作者后来修改的构思' } })
    await act(async () => resolveBlueprint('基于旧构思生成的蓝图'))

    await waitFor(() =>
      expect(screen.getByLabelText('一句话构思')).toHaveValue(
        '作者后来修改的构思'
      )
    )
    expect(mockToastInfo).toHaveBeenCalledWith(
      '构思已更新，本次蓝图未覆盖当前内容'
    )
    expect(mockToastSuccess).not.toHaveBeenCalled()
  })
})
