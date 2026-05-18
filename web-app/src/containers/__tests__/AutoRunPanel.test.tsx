import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { AutoRunPanel } from '@/containers/AutoRunPanel'
import { useAutoRunStore } from '@/stores/auto-run-store'
import { DEFAULT_MITA_AUTO_RUN } from '@/types/mita-agent'

const translations: Record<string, string> = {
  'chat:autoRun.label': '自动对话',
  'chat:autoRun.rounds': '轮数',
  'chat:autoRun.start': '开始',
  'chat:autoRun.pause': '暂停',
  'chat:autoRun.resume': '继续',
  'chat:autoRun.stop': '停止',
  'chat:autoRun.completed': '已完成',
  'chat:autoRun.error': '出错',
  'chat:autoRun.status.running': '第 {{current}} / {{max}} 轮运行中',
  'chat:autoRun.status.paused': '已暂停：{{current}} / {{max}}',
  'chat:autoRun.status.stopped': '已停止：{{current}} / {{max}}',
  'chat:autoRun.status.completedWithProgress':
    '已完成：{{current}} / {{max}}',
}

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const template = translations[key] ?? key
      return template.replace(/\{\{(\w+)\}\}/g, (_match, variable) =>
        options?.[variable] !== undefined
          ? String(options[variable])
          : `{{${variable}}}`
      )
    },
  }),
}))

describe('AutoRunPanel', () => {
  const callbacks = {
    onStart: vi.fn(),
    onPause: vi.fn(),
    onResume: vi.fn(),
    onStop: vi.fn(),
  }

  const renderPanel = (
    props: Partial<ComponentProps<typeof AutoRunPanel>> = {}
  ) =>
    render(
      <AutoRunPanel
        threadId="thread-1"
        {...callbacks}
        {...props}
      />
    )

  beforeEach(() => {
    vi.clearAllMocks()
    useAutoRunStore.setState({ runs: {} })
  })

  it('renders localized labels and explains why start is unavailable', () => {
    renderPanel({
      disabled: true,
      blockedReason: '等待当前回复结束',
    })

    expect(screen.getByText('自动对话')).toBeInTheDocument()
    expect(screen.getByText('轮数')).toBeInTheDocument()
    expect(screen.getByText('等待当前回复结束')).toBeInTheDocument()
    const startButton = screen.getByRole('button', { name: /开始/ })
    expect(startButton).toBeDisabled()

    fireEvent.click(startButton)
    expect(callbacks.onStart).not.toHaveBeenCalled()
  })

  it('clamps rounds below 1 before starting', () => {
    renderPanel()

    fireEvent.change(screen.getByRole('spinbutton'), {
      target: { value: '0' },
    })
    fireEvent.click(screen.getByRole('button', { name: /开始/ }))

    expect(callbacks.onStart).toHaveBeenCalledWith(1)
  })

  it('shows a clear running status and wires pause/stop controls', () => {
    useAutoRunStore.getState().setRun('thread-1', {
      ...DEFAULT_MITA_AUTO_RUN,
      status: 'running',
      enabled: true,
      maxRounds: 3,
      currentRound: 1,
    })

    renderPanel()

    expect(screen.getByText('第 1 / 3 轮运行中')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /暂停/ }))
    fireEvent.click(screen.getByRole('button', { name: /停止/ }))

    expect(callbacks.onPause).toHaveBeenCalledTimes(1)
    expect(callbacks.onStop).toHaveBeenCalledTimes(1)
  })

  it('wires paused resume and stop controls', () => {
    useAutoRunStore.getState().setRun('thread-1', {
      ...DEFAULT_MITA_AUTO_RUN,
      status: 'paused',
      enabled: true,
      maxRounds: 3,
      currentRound: 1,
    })

    renderPanel()

    expect(screen.getByText('已暂停：1 / 3')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /继续/ }))
    fireEvent.click(screen.getByRole('button', { name: /停止/ }))

    expect(callbacks.onResume).toHaveBeenCalledTimes(1)
    expect(callbacks.onStop).toHaveBeenCalledTimes(1)
  })
})
